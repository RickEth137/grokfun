use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, TokenAccount, Token};

use crate::state::{GlobalConfig, Launch};
use crate::errors::GrokPadError;

/// Context for graduating a launch.  Only the admin may call this
/// instruction.  It marks the launch as graduated and would deploy
/// liquidity to an AMM.  In this skeleton we simply flip the flag.
#[derive(Accounts)]
pub struct Graduate<'info> {
    /// Global configuration with admin authority.
    #[account(mut, has_one = admin)]
    pub global_config: Account<'info, GlobalConfig>,
    /// The launch being graduated.
    #[account(mut)]
    pub launch: Account<'info, Launch>,
    /// The admin signer.
    pub admin: Signer<'info>,
    /// The curve vault holding tokens.
    #[account(mut)]
    pub curve_vault: Account<'info, TokenAccount>,
    /// The SOL vault holding funds from buyers.
    #[account(mut)]
    pub sol_vault: SystemAccount<'info>,
    /// The token mint.
    pub mint: Account<'info, Mint>,
    /// Token program.
    pub token_program: Program<'info, Token>,
    /// System program.
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Graduate>) -> Result<()> {
    let global = &ctx.accounts.global_config;
    let launch = &mut ctx.accounts.launch;

    // Only proceed if the launch has not already graduated.
    require!(!launch.graduated, GrokPadError::CurveClosed);

    // Here we would compute whether the graduation criteria (e.g.
    // $69k FDV or 100% of curve sold) have been met by consulting
    // oracle data and the launch state.  This skeleton simply flips
    // the flag unconditionally for demonstration.
    launch.graduated = true;

    // In a full implementation we would create a liquidity pool on
    // Raydium or another AMM, supply tokens and SOL, burn LP tokens,
    // and redirect future trades to that pool.

    Ok(())
}