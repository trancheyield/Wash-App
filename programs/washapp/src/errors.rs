use anchor_lang::prelude::*;

#[error_code]
pub enum WashError {
    #[msg("parameter is out of its allowed range")]
    ParameterOutOfRange,
    #[msg("arithmetic overflow")]
    Overflow,
    #[msg("tranche has shares but no assets")]
    TrancheWipedOut,
}
