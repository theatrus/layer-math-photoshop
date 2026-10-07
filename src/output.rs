//! Accumulate one global range over the entire snapshot, then encode tiles.
use crate::Error;

#[derive(Clone, Copy, Debug)]
pub struct Range {
    pub min: f64,
    pub max: f64,
    pub samples: u64,
}
impl Default for Range {
    fn default() -> Self {
        Self {
            min: f64::INFINITY,
            max: f64::NEG_INFINITY,
            samples: 0,
        }
    }
}
impl Range {
    pub fn include(&mut self, samples: &[f64]) -> Result<(), Error> {
        let mut next = *self;
        for &v in samples {
            if !v.is_finite() || !(v as f32).is_finite() {
                return Err(Error::new("Invalid or overflowing output"));
            }
            next.min = next.min.min(v);
            next.max = next.max.max(v);
            next.samples = next
                .samples
                .checked_add(1)
                .ok_or_else(|| Error::new("Sample count overflow"))?;
        }
        *self = next;
        Ok(())
    }
    pub fn out_of_range(&self) -> bool {
        self.min < 0.0 || self.max > 1.0
    }
}
#[derive(Clone, Copy)]
pub enum Policy {
    Preserve,
    Clip,
    Rescale,
}
pub fn encode16(samples: &[f64], range: Range, policy: Policy) -> Result<Vec<u16>, Error> {
    if range.samples == 0
        || !range.min.is_finite()
        || !range.max.is_finite()
        || range.min > range.max
    {
        return Err(Error::new("A valid global range is required"));
    }
    if range.out_of_range() {
        match policy {
            Policy::Preserve => {
                return Err(Error::new("Choose Rescale, Clip, or New 32-bit document"));
            }
            Policy::Rescale if range.min == range.max => {
                return Err(Error::new(
                    "Constant out-of-range output requires Clip or New 32-bit document",
                ));
            }
            _ => (),
        }
    }
    samples
        .iter()
        .map(|&v| {
            if !v.is_finite() || v < range.min || v > range.max {
                return Err(Error::new("Sample does not match analyzed range"));
            }
            let v = match policy {
                Policy::Rescale if range.out_of_range() => {
                    (v - range.min) / (range.max - range.min)
                }
                Policy::Clip => v.clamp(0.0, 1.0),
                _ => v,
            };
            Ok((v * 32768.0).round() as u16)
        })
        .collect()
}
pub fn decode16(samples: &[u16]) -> Result<Vec<f64>, Error> {
    samples
        .iter()
        .map(|&v| {
            if v <= 32768 {
                Ok(f64::from(v) / 32768.0)
            } else {
                Err(Error::new("Photoshop 16-bit code exceeds 32768"))
            }
        })
        .collect()
}
