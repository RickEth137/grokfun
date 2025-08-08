use anchor_lang::prelude::*;

#[error_code]
pub enum GrokPadError {
    #[msg("Token name must end with 'grok'")]
    InvalidNameSuffix,
}
