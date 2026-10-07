use layer_math_photoshop::{
    CompileSpec, InputSpec, Program,
    output::{Policy, Range, decode16, encode16},
};
use std::{collections::BTreeMap, sync::atomic::AtomicBool};

fn compile(expr: &str) -> Program {
    Program::compile(CompileSpec {
        channels: 1,
        inputs: vec![],
        parameters: BTreeMap::new(),
        expressions: BTreeMap::from([("shared".into(), expr.into())]),
    })
    .unwrap()
}
fn value(expr: &str) -> f64 {
    compile(expr).evaluate(&[], 1, None).unwrap()[0]
}

#[test]
fn published_conformance_vectors() {
    for (expr, expected) in [
        ("combine(0.2,0.4,op_screen())", 0.52),
        ("combine(0.2,0,op_screen())", 0.2),
        ("combine(0.2,1,op_screen())", 1.0),
        ("combine(2,0.25,op_screen())", 1.75),
        ("combine(-0.2,0.4,op_screen())", 0.28),
        ("combine(0.2,0.4,op_multiply())", 0.08),
        ("combine(0.2,0.4,op_difference())", 0.2),
        ("combine(0.2,0.4,op_exclusion())", 0.44),
        ("combine(0.2,0.8,op_overlay())", 0.32),
        ("combine(0.8,0.2,op_overlay())", 0.68),
        ("combine(0.2,0.8,op_hard_light())", 0.68),
        ("combine(0.25,0.75,op_soft_light())", 0.375),
        ("iif(0,1/0,0.25)", 0.25),
        ("mtf(0.5,0.25)", 0.25),
        ("-2^2", -4.0),
        ("2^3^2", 512.0),
        ("2^-2", 0.25),
        ("0 && 1/0", 0.0),
        ("1 || sqrt(-1)", 1.0),
        ("!0 + !1", 1.0),
        ("mix(1,3,1.5)", 4.0),
        ("1+2*3 == 7 && 2 < 3", 1.0),
    ] {
        assert!((value(expr) - expected).abs() < 1e-12, "{expr}");
    }
}
#[test]
fn invalid_domains_and_overflow() {
    for expr in [
        "1/0",
        "sqrt(-1)",
        "ln(0)",
        "pow(-1,0.5)",
        "clamp(0,2,1)",
        "mtf(0,0.5)",
        "mtf(0.5,2)",
        "1e39",
        "1e308*2",
        "combine(1,0,op_divide())",
    ] {
        let error = compile(expr).evaluate(&[], 1, None).unwrap_err();
        assert!(
            error.offset.is_some() && error.pixel == Some(0),
            "{expr}: {error}"
        );
    }
}
#[test]
fn all_photoshop_integer_codes_roundtrip() {
    let codes: Vec<u16> = (0..=32768).collect();
    let samples = decode16(&codes).unwrap();
    let mut range = Range::default();
    range.include(&samples).unwrap();
    assert_eq!(encode16(&samples, range, Policy::Preserve).unwrap(), codes);
    assert!(decode16(&[32769]).is_err());
}
#[test]
fn global_range_shared_across_tiles_and_channels() {
    let mut range = Range::default();
    range.include(&[-2.0, 0.0, 1.0]).unwrap();
    range.include(&[2.0]).unwrap();
    assert!(encode16(&[0.0], range, Policy::Preserve).is_err());
    assert_eq!(
        encode16(&[-2.0, 0.0, 1.0], range, Policy::Rescale).unwrap(),
        [0, 16384, 24576]
    );
    assert_eq!(encode16(&[2.0], range, Policy::Rescale).unwrap(), [32768]);
    assert_eq!(
        encode16(&[-2.0, 2.0], range, Policy::Clip).unwrap(),
        [0, 32768]
    );
    let mut constant = Range::default();
    constant.include(&[2.0, 2.0]).unwrap();
    assert!(encode16(&[2.0], constant, Policy::Rescale).is_err());
    let saved = constant;
    assert!(constant.include(&[f64::NAN]).is_err());
    assert_eq!(constant.samples, saved.samples);
}
#[test]
fn channels_parameters_and_input_validation() {
    let p = Program::compile(CompileSpec {
        channels: 3,
        inputs: vec![
            InputSpec {
                name: "RGB".into(),
                channels: 3,
            },
            InputSpec {
                name: "Mono".into(),
                channels: 1,
            },
        ],
        parameters: BTreeMap::from([("gain".into(), 2.0)]),
        expressions: BTreeMap::from([
            ("r".into(), "RGB[2]".into()),
            ("g".into(), "Mono*gain".into()),
            ("b".into(), "RGB".into()),
        ]),
    })
    .unwrap();
    assert_eq!(
        p.evaluate(&[&[1.0, 2.0, 3.0], &[4.0]], 1, None).unwrap(),
        [3.0, 8.0, 3.0]
    );
    assert!(p.evaluate(&[&[1.0, 2.0], &[4.0]], 1, None).is_err());
    assert!(
        p.evaluate(&[&[f64::NAN, 2.0, 3.0], &[4.0]], 1, None)
            .is_err()
    );
    assert!(
        p.evaluate(&[&[1.0, 2.0, 3.0], &[4.0]], 1, Some(&AtomicBool::new(true)))
            .is_err()
    );
}
#[test]
fn descriptors_and_dead_branches_are_checked() {
    for expr in [
        "op_screen()",
        "1+op_screen()",
        "combine(1,2,3)",
        "iif(0,unknown,1)",
        "combine(1,2,op_screen(1))",
        "min(1)",
        "op_magic()",
        "1;2",
        "1e",
        "1 2",
        "A[3]",
    ] {
        let json = serde_json::json!({"channels":1,"inputs":[],"expressions":{"shared":expr}});
        assert!(Program::from_json(&json.to_string()).is_err(), "{expr}");
    }
}
#[test]
fn malformed_input_and_complexity_are_bounded() {
    let mut seed = 42u64;
    let alphabet = b"abc012+-*/^()[],.!<>&| \xff";
    for _ in 0..4000 {
        let mut bytes = Vec::new();
        for _ in 0..(seed as usize % 120) {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
            bytes.push(alphabet[(seed >> 32) as usize % alphabet.len()]);
        }
        let expr = String::from_utf8_lossy(&bytes);
        let json = serde_json::json!({"channels":1,"inputs":[],"expressions":{"shared":expr}});
        if let Ok(p) = Program::from_json(&json.to_string()) {
            let _ = p.evaluate(&[], 1, None);
        }
        seed = seed.wrapping_add(1);
    }
    for expr in [
        format!("{}1{}", "(".repeat(1000), ")".repeat(1000)),
        "1+".repeat(1000) + "1",
    ] {
        let json = serde_json::json!({"channels":1,"inputs":[],"expressions":{"shared":expr}});
        assert!(Program::from_json(&json.to_string()).is_err());
    }
}
#[test]
fn randomized_screen_against_expanded_reference() {
    let p = Program::from_json(r#"{"channels":1,"inputs":[{"name":"A","channels":1},{"name":"B","channels":1}],"expressions":{"shared":"combine(A,B,op_screen())"}}"#).unwrap();
    let a: Vec<_> = (0..10000).map(|i| f64::from(i) / 2000.0 - 2.0).collect();
    let b: Vec<_> = (0..10000)
        .map(|i| f64::from((i * 7919) % 10000) / 2000.0 - 2.0)
        .collect();
    let out = p.evaluate(&[&a, &b], a.len(), None).unwrap();
    for i in 0..a.len() {
        assert!((out[i] - (a[i] + b[i] - a[i] * b[i])).abs() < 1e-12);
    }
}
