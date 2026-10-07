//! SDK-independent evaluator. Samples are normalized, interleaved f64 values.
mod expression;
pub mod ffi;
pub mod output;

use expression::Expr;
use serde::Deserialize;
use std::{
    collections::BTreeMap,
    fmt,
    sync::atomic::{AtomicBool, Ordering},
};

pub const MAX_INPUTS: usize = 32;
pub const MAX_TILE_SAMPLES: usize = 1_048_576;
pub const MAX_INPUT_SAMPLES: usize = 8_388_608;

#[derive(Debug, Clone, PartialEq)]
pub struct Error {
    pub message: String,
    pub offset: Option<usize>,
    pub pixel: Option<usize>,
    pub channel: Option<usize>,
}
impl Error {
    pub(crate) fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            offset: None,
            pixel: None,
            channel: None,
        }
    }
    pub(crate) fn at(message: impl Into<String>, offset: usize) -> Self {
        Self {
            offset: Some(offset),
            ..Self::new(message)
        }
    }
}
impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.message)?;
        if let Some(n) = self.offset {
            write!(f, " at byte {n}")?;
        }
        if let Some(n) = self.pixel {
            write!(f, ", tile pixel {n}")?;
        }
        if let Some(n) = self.channel {
            write!(f, ", channel {n}")?;
        }
        Ok(())
    }
}
impl std::error::Error for Error {}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InputSpec {
    pub name: String,
    pub channels: usize,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CompileSpec {
    pub channels: usize,
    pub inputs: Vec<InputSpec>,
    #[serde(default)]
    pub parameters: BTreeMap<String, f64>,
    pub expressions: BTreeMap<String, String>,
}

pub struct Program {
    spec: CompileSpec,
    expressions: Vec<Expr>,
}
impl Program {
    pub fn compile(spec: CompileSpec) -> Result<Self, Error> {
        if !matches!(spec.channels, 1 | 3) {
            return Err(Error::new("Output must have 1 or 3 channels"));
        }
        if spec.inputs.len() > MAX_INPUTS {
            return Err(Error::new("Too many inputs (maximum 32)"));
        }
        if spec.parameters.len() > 128 {
            return Err(Error::new("Too many parameters (maximum 128)"));
        }
        let mut names = std::collections::HashSet::new();
        for input in &spec.inputs {
            if !matches!(input.channels, 1 | 3) {
                return Err(Error::new("Inputs must have 1 or 3 channels"));
            }
            if !expression::identifier(&input.name) || !names.insert(input.name.as_str()) {
                return Err(Error::new("Invalid or duplicate input name"));
            }
        }
        for (name, value) in &spec.parameters {
            if !expression::identifier(name) || !names.insert(name.as_str()) || !value.is_finite() {
                return Err(Error::new("Invalid, duplicate, or non-finite parameter"));
            }
        }
        let keys: &[&str] =
            if spec.expressions.len() == 1 && spec.expressions.contains_key("shared") {
                &["shared"]
            } else if spec.channels == 3
                && spec.expressions.len() == 3
                && ["r", "g", "b"]
                    .iter()
                    .all(|k| spec.expressions.contains_key(*k))
            {
                &["r", "g", "b"]
            } else {
                return Err(Error::new(
                    "Provide shared, or exactly r/g/b expressions for RGB",
                ));
            };
        let expressions = keys
            .iter()
            .map(|key| expression::parse(&spec.expressions[*key], &spec))
            .collect::<Result<_, _>>()?;
        Ok(Self { spec, expressions })
    }
    pub fn from_json(json: &str) -> Result<Self, Error> {
        if json.len() > 65_536 {
            return Err(Error::new("Compile request exceeds 64 KiB"));
        }
        Self::compile(
            serde_json::from_str(json)
                .map_err(|e| Error::new(format!("Invalid compile request: {e}")))?,
        )
    }
    pub fn channels(&self) -> usize {
        self.spec.channels
    }
    pub fn input_count(&self) -> usize {
        self.spec.inputs.len()
    }
    pub fn input_channels(&self, index: usize) -> usize {
        self.spec.inputs[index].channels
    }

    /// Inputs are immutable for the call; cancellation never returns partial output.
    pub fn evaluate(
        &self,
        inputs: &[&[f64]],
        pixels: usize,
        cancel: Option<&AtomicBool>,
    ) -> Result<Vec<f64>, Error> {
        let count = pixels
            .checked_mul(self.channels())
            .filter(|n| *n <= MAX_TILE_SAMPLES)
            .ok_or_else(|| Error::new("Tile exceeds sample limit"))?;
        if pixels == 0 || inputs.len() != self.input_count() {
            return Err(Error::new("Invalid tile size or input count"));
        }
        let mut total = 0usize;
        for (i, input) in inputs.iter().enumerate() {
            let expected = pixels
                .checked_mul(self.input_channels(i))
                .ok_or_else(|| Error::new("Input size overflow"))?;
            total = total
                .checked_add(expected)
                .filter(|n| *n <= MAX_INPUT_SAMPLES)
                .ok_or_else(|| Error::new("Input sample budget exceeded"))?;
            if input.len() != expected {
                return Err(Error::new(format!(
                    "Wrong buffer length for {}",
                    self.spec.inputs[i].name
                )));
            }
        }
        let mut output = Vec::with_capacity(count);
        for pixel in 0..pixels {
            if pixel % 256 == 0 && cancel.is_some_and(|c| c.load(Ordering::Relaxed)) {
                return Err(Error::new("Cancelled"));
            }
            // Reject invalid samples even when an expression does not reference them.
            for (i, input) in inputs.iter().enumerate() {
                let channels = self.input_channels(i);
                for channel in 0..channels {
                    if !input[pixel * channels + channel].is_finite() {
                        return Err(Error {
                            pixel: Some(pixel),
                            channel: Some(channel),
                            ..Error::new(format!("Non-finite input {}", self.spec.inputs[i].name))
                        });
                    }
                }
            }
            for channel in 0..self.channels() {
                let expr = &self.expressions[if self.expressions.len() == 1 {
                    0
                } else {
                    channel
                }];
                let value = expr
                    .eval(inputs, &self.spec, pixel, channel)
                    .and_then(|value| {
                        if !(value as f32).is_finite() {
                            Err(Error::at("Float32 output overflow", expr.offset))
                        } else {
                            Ok(value)
                        }
                    })
                    .map_err(|mut e| {
                        e.pixel = Some(pixel);
                        e.channel = Some(channel);
                        e
                    })?;
                output.push(value);
            }
        }
        Ok(output)
    }
}
