use anchor_lang::prelude::*;

#[account]
pub struct GlobalConfig {
    pub admin: Pubkey,
    pub treasury: Pubkey,
    pub curve_fee_bps: u16,
    pub amm_fee_bps: u16,
    pub graduation_mc_lamports: u64,
}
impl Space for GlobalConfig {
    const INIT_SPACE: usize = 32 + 32 + 2 + 2 + 8;
}

#[account]
pub struct Launch {
    pub creator: Pubkey,
    pub mint: Pubkey,
    pub curve_vault: Pubkey,
    pub sol_vault: Pubkey,
    pub sold: u64,
    pub price_state: PriceState,
    pub graduated: bool,
    pub metadata_uri: String,
}
impl Space for Launch {
    const INIT_SPACE: usize = 32*4 + 8 + PriceState::INIT_SPACE + 1 + 4 + 256;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct PriceState {
    pub tranche_size: u64,
    pub base_price_lamports: u64,
    pub step_bps: u16,
}
impl PriceState {
    pub const INIT_SPACE: usize = 8 + 8 + 2;
}
