use anchor_lang::prelude::*;

use crate::state::GlobalConfig;

/// Parameters that can be updated via the admin instruction.  Each
/// field is optional; if a value is `None` it will not be modified.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct AdminArgs {
    pub curve_fee_bps: Option<u16>,
    pub amm_fee_bps: Option<u16>,
    pub creator_kickback_bps: Option<u16>,
    pub graduation_target_usd: Option<u64>,
    pub treasury: Option<Pubkey>,
    pub paused: Option<bool>,
}

/// Context for the admin instruction.  Only the admin specified in
/// `GlobalConfig` may invoke this.
#[derive(Accounts)]
pub struct Admin<'info> {
    #[account(mut, has_one = admin)]
    pub global_config: Account<'info, GlobalConfig>,
    pub admin: Signer<'info>,
}

pub fn handler(ctx: Context<Admin>, args: AdminArgs) -> Result<()> {
    let global = &mut ctx.accounts.global_config;
    if let Some(fee) = args.curve_fee_bps {
        global.curve_fee_bps = fee;
    }
    if let Some(fee) = args.amm_fee_bps {
        global.amm_fee_bps = fee;
    }
    if let Some(kickback) = args.creator_kickback_bps {
        global.creator_kickback_bps = kickback;
    }
    if let Some(target) = args.graduation_target_usd {
        global.graduation_target_usd = target;
    }
    if let Some(treasury) = args.treasury {
        global.treasury = treasury;
    }
    if let Some(paused) = args.paused {
        global.paused = paused;
    }
    Ok(())
}