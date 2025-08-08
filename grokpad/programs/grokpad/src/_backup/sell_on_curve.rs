use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer, Mint};

use crate::state::{GlobalConfig, Launch};
use crate::errors::GrokPadError;

/// Context for selling tokens back to the bonding curve.  Sellers
/// transfer tokens to the curve vault and receive lamports in
/// exchange.  A fee is deducted from the payout.
#[derive(Accounts)]
pub struct SellOnCurve<'info> {
    /// Global configuration account.
    #[account(has_one = treasury)]
    pub global_config: Account<'info, GlobalConfig>,
    /// Launch account for the token being traded.
    #[account(mut)]
    pub launch: Account<'info, Launch>,
    /// The seller’s wallet that will receive lamports.
    #[account(mut)]
    pub seller: Signer<'info>,
    /// The seller’s token account that will be debited.
    #[account(
        mut,
        constraint = seller_token_account.owner == seller.key(),
        constraint = seller_token_account.mint == launch.mint,
    )]
    pub seller_token_account: Account<'info, TokenAccount>,
    /// The curve vault that receives the returned tokens.
    #[account(mut)]
    pub curve_vault: Account<'info, TokenAccount>,
    /// The SOL vault used to pay out sellers.
    #[account(mut)]
    pub sol_vault: SystemAccount<'info>,
    /// The token mint.
    pub mint: Account<'info, Mint>,
    /// System program.
    pub system_program: Program<'info, System>,
    /// Token program.
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<SellOnCurve>, amount: u64) -> Result<()> {
    let global = &ctx.accounts.global_config;
    let launch = &mut ctx.accounts.launch;

    require!(!global.paused, GrokPadError::ProgramPaused);
    require!(!launch.graduated, GrokPadError::CurveClosed);

    // Compute refund price.  For simplicity this mirrors the buy
    // function using base price.  A complete implementation must
    // incorporate tranche logic and slippage.
    let price_state = &launch.price_state;
    let price_per_token = price_state.base_price_lamports;
    let total_price = price_per_token
        .checked_mul(amount)
        .ok_or(GrokPadError::MathError)?;
    let fee_bps = global.curve_fee_bps as u64;
    let fee = total_price
        .checked_mul(fee_bps)
        .ok_or(GrokPadError::MathError)?
        .checked_div(10_000)
        .ok_or(GrokPadError::MathError)?;
    let net_price = total_price
        .checked_sub(fee)
        .ok_or(GrokPadError::MathError)?;

    // Transfer tokens from seller to curve_vault.
    let cpi_accounts = Transfer {
        from: ctx.accounts.seller_token_account.to_account_info(),
        to: ctx.accounts.curve_vault.to_account_info(),
        authority: ctx.accounts.seller.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    token::transfer(CpiContext::new(cpi_program, cpi_accounts), amount)?;

    // Pay out lamports to seller.
    **ctx.accounts.sol_vault.to_account_info().try_borrow_mut_lamports()? -= net_price;
    **ctx.accounts.seller.to_account_info().try_borrow_mut_lamports()? += net_price;

    // Collect fee to treasury (stubbed) similar to buy.
    let _treasury = global.treasury;

    // Decrement sold count.
    launch.sold = launch.sold.checked_sub(amount).ok_or(GrokPadError::MathError)?;

    Ok(())
}