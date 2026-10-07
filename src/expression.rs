use crate::{CompileSpec, Error};

const MAX_BYTES: usize = 8192;
const MAX_NODES: usize = 1024;
const MAX_DEPTH: usize = 64;

pub(crate) fn identifier(s: &str) -> bool {
    let mut chars = s.bytes();
    matches!(chars.next(), Some(b'a'..=b'z' | b'A'..=b'Z' | b'_'))
        && s.len() <= 64
        && chars.all(|c| c.is_ascii_alphanumeric() || c == b'_')
}

#[derive(Clone, Debug, PartialEq)]
enum Token {
    Number(f64),
    Name(String),
    Symbol(String),
    End,
}
struct Lexer<'a> {
    text: &'a str,
    pos: usize,
}
impl Lexer<'_> {
    fn next(&mut self) -> Result<(Token, usize), Error> {
        let bytes = self.text.as_bytes();
        while self.pos < bytes.len() && bytes[self.pos].is_ascii_whitespace() {
            self.pos += 1;
        }
        let start = self.pos;
        if start == bytes.len() {
            return Ok((Token::End, start));
        }
        let c = bytes[start];
        if c.is_ascii_digit() || c == b'.' {
            while self.pos < bytes.len()
                && (bytes[self.pos].is_ascii_digit() || bytes[self.pos] == b'.')
            {
                self.pos += 1;
            }
            if self.pos < bytes.len() && matches!(bytes[self.pos], b'e' | b'E') {
                self.pos += 1;
                if self.pos < bytes.len() && matches!(bytes[self.pos], b'+' | b'-') {
                    self.pos += 1;
                }
                while self.pos < bytes.len() && bytes[self.pos].is_ascii_digit() {
                    self.pos += 1;
                }
            }
            let n: f64 = self.text[start..self.pos]
                .parse()
                .map_err(|_| Error::at("Invalid number", start))?;
            if !n.is_finite() {
                return Err(Error::at("Non-finite constant", start));
            }
            return Ok((Token::Number(n), start));
        }
        if c.is_ascii_alphabetic() || c == b'_' {
            self.pos += 1;
            while self.pos < bytes.len()
                && (bytes[self.pos].is_ascii_alphanumeric() || bytes[self.pos] == b'_')
            {
                self.pos += 1;
            }
            return Ok((Token::Name(self.text[start..self.pos].into()), start));
        }
        for symbol in [
            "&&", "||", "<=", ">=", "==", "!=", "+", "-", "*", "/", "^", "!", "<", ">", "(", ")",
            "[", "]", ",",
        ] {
            if self.text[start..].starts_with(symbol) {
                self.pos += symbol.len();
                return Ok((Token::Symbol(symbol.into()), start));
            }
        }
        Err(Error::at("Unexpected character", start))
    }
}

#[derive(Clone, Copy)]
enum Blend {
    Add,
    Subtract,
    Multiply,
    Divide,
    Min,
    Max,
    Screen,
    Difference,
    Exclusion,
    Overlay,
    HardLight,
    SoftLight,
}
impl Blend {
    fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "op_add" => Self::Add,
            "op_subtract" => Self::Subtract,
            "op_multiply" => Self::Multiply,
            "op_divide" => Self::Divide,
            "op_min" => Self::Min,
            "op_max" => Self::Max,
            "op_screen" => Self::Screen,
            "op_difference" => Self::Difference,
            "op_exclusion" => Self::Exclusion,
            "op_overlay" => Self::Overlay,
            "op_hard_light" => Self::HardLight,
            "op_soft_light" => Self::SoftLight,
            _ => return None,
        })
    }
}
enum Kind {
    Constant(f64),
    Input(usize, Option<usize>),
    Unary(String, Box<Expr>),
    Binary(String, Box<Expr>, Box<Expr>),
    Call(String, Vec<Expr>),
    Descriptor(Blend),
    Combine(Box<Expr>, Box<Expr>, Blend),
}
pub(crate) struct Expr {
    kind: Kind,
    pub offset: usize,
    depth: usize,
}
impl Expr {
    fn number(&self) -> Result<(), Error> {
        if matches!(self.kind, Kind::Descriptor(_)) {
            Err(Error::at(
                "Operator descriptor is only valid as combine's third argument",
                self.offset,
            ))
        } else {
            Ok(())
        }
    }
    pub fn eval(
        &self,
        inputs: &[&[f64]],
        spec: &CompileSpec,
        pixel: usize,
        channel: usize,
    ) -> Result<f64, Error> {
        let eval = |expr: &Expr| expr.eval(inputs, spec, pixel, channel);
        let fail = |s: &str| Error::at(s, self.offset);
        let truth = |v: bool| if v { 1.0 } else { 0.0 };
        let divide = |a: f64, b: f64| {
            if b == 0.0 {
                Err(fail("Division by zero"))
            } else {
                Ok(a / b)
            }
        };
        let value = match &self.kind {
            Kind::Constant(v) => *v,
            Kind::Input(i, selected) => {
                let c = spec.inputs[*i].channels;
                inputs[*i][pixel * c + selected.unwrap_or(if c == 1 { 0 } else { channel })]
            }
            Kind::Unary(op, x) => {
                let x = eval(x)?;
                match op.as_str() {
                    "-" => -x,
                    "!" => truth(x == 0.0),
                    _ => x,
                }
            }
            Kind::Binary(op, a, b) => {
                let a = eval(a)?;
                if op == "&&" && a == 0.0 {
                    return Ok(0.0);
                }
                if op == "||" && a != 0.0 {
                    return Ok(1.0);
                }
                let b = eval(b)?;
                match op.as_str() {
                    "+" => a + b,
                    "-" => a - b,
                    "*" => a * b,
                    "/" => divide(a, b)?,
                    "^" => a.powf(b),
                    "<" => truth(a < b),
                    "<=" => truth(a <= b),
                    ">" => truth(a > b),
                    ">=" => truth(a >= b),
                    "==" => truth(a == b),
                    "!=" => truth(a != b),
                    "&&" | "||" => truth(b != 0.0),
                    _ => unreachable!(),
                }
            }
            Kind::Call(name, args) => {
                let a = eval(&args[0])?;
                if name == "iif" {
                    return eval(&args[if a != 0.0 { 1 } else { 2 }]);
                }
                let b = if args.len() >= 2 {
                    eval(&args[1])?
                } else {
                    0.0
                };
                let c = if args.len() >= 3 {
                    eval(&args[2])?
                } else {
                    0.0
                };
                match name.as_str() {
                    "abs" => a.abs(),
                    "sqrt" => a.sqrt(),
                    "exp" => a.exp(),
                    "ln" => a.ln(),
                    "min" => a.min(b),
                    "max" => a.max(b),
                    "pow" => a.powf(b),
                    "mix" => {
                        let left = (1.0 - c) * a;
                        let right = c * b;
                        if !left.is_finite() || !right.is_finite() {
                            return Err(fail("Non-finite mix intermediate"));
                        }
                        left + right
                    }
                    "clamp" => {
                        if b > c {
                            return Err(fail("clamp requires lo <= hi"));
                        }
                        a.clamp(b, c)
                    }
                    "mtf" => {
                        if !(0.0 < a && a < 1.0 && (0.0..=1.0).contains(&b)) {
                            return Err(fail("mtf requires 0 < m < 1 and 0 <= x <= 1"));
                        }
                        if b == 0.0 || b == 1.0 {
                            b
                        } else {
                            ((a - 1.0) * b) / ((2.0 * a - 1.0) * b - a)
                        }
                    }
                    _ => unreachable!(),
                }
            }
            Kind::Combine(a, b, blend) => {
                let a = eval(a)?;
                let b = eval(b)?;
                match blend {
                    Blend::Add => a + b,
                    Blend::Subtract => a - b,
                    Blend::Multiply => a * b,
                    Blend::Divide => divide(a, b)?,
                    Blend::Min => a.min(b),
                    Blend::Max => a.max(b),
                    Blend::Screen => 1.0 - (1.0 - a) * (1.0 - b),
                    Blend::Difference => (a - b).abs(),
                    Blend::Exclusion => a + b - 2.0 * a * b,
                    Blend::Overlay => {
                        if a <= 0.5 {
                            2.0 * a * b
                        } else {
                            1.0 - 2.0 * (1.0 - a) * (1.0 - b)
                        }
                    }
                    Blend::HardLight => {
                        if b <= 0.5 {
                            2.0 * a * b
                        } else {
                            1.0 - 2.0 * (1.0 - a) * (1.0 - b)
                        }
                    }
                    Blend::SoftLight => {
                        if b <= 0.5 {
                            a - (1.0 - 2.0 * b) * a * (1.0 - a)
                        } else {
                            let d = if a <= 0.25 {
                                ((16.0 * a - 12.0) * a + 4.0) * a
                            } else {
                                a.sqrt()
                            };
                            if !d.is_finite() {
                                return Err(fail("Non-finite soft-light intermediate"));
                            }
                            a + (2.0 * b - 1.0) * (d - a)
                        }
                    }
                }
            }
            Kind::Descriptor(_) => unreachable!("type-checked during compilation"),
        };
        if value.is_finite() {
            Ok(value)
        } else {
            Err(fail("Invalid numeric domain or non-finite intermediate"))
        }
    }
}

struct Parser<'a> {
    lexer: Lexer<'a>,
    token: Token,
    offset: usize,
    nodes: usize,
    spec: &'a CompileSpec,
}
impl<'a> Parser<'a> {
    fn advance(&mut self) -> Result<Token, Error> {
        let (token, offset) = self.lexer.next()?;
        self.offset = offset;
        Ok(std::mem::replace(&mut self.token, token))
    }
    fn is(&self, symbol: &str) -> bool {
        self.token == Token::Symbol(symbol.into())
    }
    fn expect(&mut self, symbol: &str) -> Result<(), Error> {
        if !self.is(symbol) {
            return Err(Error::at(format!("Expected '{symbol}'"), self.offset));
        }
        self.advance()?;
        Ok(())
    }
    fn node(&mut self, kind: Kind, offset: usize, depth: usize) -> Result<Expr, Error> {
        self.nodes += 1;
        if self.nodes > MAX_NODES || depth > MAX_DEPTH {
            return Err(Error::at("Expression complexity limit exceeded", offset));
        }
        Ok(Expr {
            kind,
            offset,
            depth,
        })
    }
    fn expr(&mut self, min_bp: u8, recursion: usize) -> Result<Expr, Error> {
        if recursion > MAX_DEPTH {
            return Err(Error::at("Expression nesting limit exceeded", self.offset));
        }
        let pos = self.offset;
        let mut lhs = match self.advance()? {
            Token::Number(v) => self.node(Kind::Constant(v), pos, 1)?,
            Token::Symbol(s) if s == "(" => {
                let e = self.expr(0, recursion + 1)?;
                self.expect(")")?;
                e
            }
            Token::Symbol(s) if ["+", "-", "!"].contains(&s.as_str()) => {
                let e = self.expr(13, recursion + 1)?;
                e.number()?;
                let depth = e.depth + 1;
                self.node(Kind::Unary(s, Box::new(e)), pos, depth)?
            }
            Token::Name(name) => {
                if self.is("(") {
                    self.call(name, pos, recursion + 1)?
                } else if let Some(i) = self.spec.inputs.iter().position(|i| i.name == name) {
                    let selected = if self.is("[") {
                        self.advance()?;
                        let offset = self.offset;
                        let index = match self.advance()? {
                            Token::Number(v)
                                if v >= 0.0
                                    && v.fract() == 0.0
                                    && v < self.spec.inputs[i].channels as f64 =>
                            {
                                v as usize
                            }
                            _ => {
                                return Err(Error::at(
                                    "Channel index is outside the input",
                                    offset,
                                ));
                            }
                        };
                        self.expect("]")?;
                        Some(index)
                    } else {
                        None
                    };
                    self.node(Kind::Input(i, selected), pos, 1)?
                } else if let Some(v) = self.spec.parameters.get(&name) {
                    self.node(Kind::Constant(*v), pos, 1)?
                } else {
                    return Err(Error::at(
                        format!("Unknown input or parameter '{name}'"),
                        pos,
                    ));
                }
            }
            _ => return Err(Error::at("Expected a numeric expression", pos)),
        };
        while let Token::Symbol(s) = &self.token {
            let op = s.clone();
            let (left, right) = match op.as_str() {
                "||" => (1, 2),
                "&&" => (3, 4),
                "==" | "!=" => (5, 6),
                "<" | "<=" | ">" | ">=" => (7, 8),
                "+" | "-" => (9, 10),
                "*" | "/" => (11, 12),
                "^" => (15, 14),
                _ => break,
            };
            if left < min_bp {
                break;
            }
            let pos = self.offset;
            self.advance()?;
            let rhs = self.expr(right, recursion + 1)?;
            lhs.number()?;
            rhs.number()?;
            let depth = 1 + lhs.depth.max(rhs.depth);
            lhs = self.node(Kind::Binary(op, Box::new(lhs), Box::new(rhs)), pos, depth)?;
        }
        Ok(lhs)
    }
    fn call(&mut self, name: String, pos: usize, recursion: usize) -> Result<Expr, Error> {
        self.expect("(")?;
        let mut args = Vec::new();
        if !self.is(")") {
            loop {
                if args.len() == 3 {
                    return Err(Error::at("Too many function arguments", pos));
                }
                args.push(self.expr(0, recursion + 1)?);
                if !self.is(",") {
                    break;
                }
                self.advance()?;
            }
        }
        self.expect(")")?;
        if let Some(blend) = Blend::parse(&name) {
            if !args.is_empty() {
                return Err(Error::at("Operator descriptor takes no arguments", pos));
            }
            return self.node(Kind::Descriptor(blend), pos, 1);
        }
        let expected = match name.as_str() {
            "abs" | "sqrt" | "exp" | "ln" => 1,
            "min" | "max" | "pow" | "mtf" => 2,
            "iif" | "clamp" | "mix" | "combine" => 3,
            _ => return Err(Error::at(format!("Unknown function '{name}'"), pos)),
        };
        if args.len() != expected {
            return Err(Error::at(
                format!("{name} requires {expected} arguments"),
                pos,
            ));
        }
        let depth = 1 + args.iter().map(|a| a.depth).max().unwrap_or(0);
        if name == "combine" {
            let descriptor = args.pop().unwrap();
            let blend = match descriptor.kind {
                Kind::Descriptor(b) => b,
                _ => {
                    return Err(Error::at(
                        "combine requires an op_*() descriptor",
                        descriptor.offset,
                    ));
                }
            };
            let b = args.pop().unwrap();
            let a = args.pop().unwrap();
            a.number()?;
            b.number()?;
            self.node(Kind::Combine(Box::new(a), Box::new(b), blend), pos, depth)
        } else {
            for arg in &args {
                arg.number()?;
            }
            self.node(Kind::Call(name, args), pos, depth)
        }
    }
}
pub(crate) fn parse(text: &str, spec: &CompileSpec) -> Result<Expr, Error> {
    if text.len() > MAX_BYTES {
        return Err(Error::new("Expression exceeds 8192 bytes"));
    }
    let mut parser = Parser {
        lexer: Lexer { text, pos: 0 },
        token: Token::End,
        offset: 0,
        nodes: 0,
        spec,
    };
    parser.advance()?;
    let expr = parser.expr(0, 0)?;
    expr.number()?;
    if parser.token != Token::End {
        return Err(Error::at("Unexpected trailing token", parser.offset));
    }
    Ok(expr)
}
