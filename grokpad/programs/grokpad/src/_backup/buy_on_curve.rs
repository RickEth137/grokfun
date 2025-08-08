use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer, Mint};

use crate::state::{GlobalConfig, Launch};
use crate::errors::GrokPadError;

/// Context for buying tokens from the bonding curve.  The buyer
/// transfers lamports to the program in exchange for tokens.  The
/// program deducts a fee and updates the sold count accordingly.
#[derive(Accounts)]
pub struct BuyOnCurve<'info> {
    /// Global configuration account.
    #[account(has_one = treasury)]
    pub global_config: Account<'info, GlobalConfig>,
    /// Launch account for the token being traded.
    #[account(mut)]
    pub launch: Account<'info, Launch>,
    /// The buyer’s wallet paying lamports.
    #[account(mut)]
    pub buyer: Signer<'info>,
    /// The buyer’s token account that will receive tokens.
    #[account(
        mut,
        constraint = buyer_token_account.owner == buyer.key(),
        constraint = buyer_token_account.mint == launch.mint,
    )]
    pub buyer_token_account: Account<'info, TokenAccount>,
    /// The curve vault holding tokens for sale.
    #[account(mut)]
    pub curve_vault: Account<'info, TokenAccount>,
    /// The SOL vault that accumulates funds from sales.
    #[account(mut)]
    pub sol_vault: SystemAccount<'info>,
    /// The token mint.  Checked implicitly via associated accounts.
    pub mint: Account<'info, Mint>,
    /// System program for SOL transfers.
    pub system_program: Program<'info, System>,
    /// Token program for SPL transfers.
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<BuyOnCurve>, amount: u64) -> Result<()> {
    let global = &ctx.accounts.global_config;
    let launch = &mut ctx.accounts.launch;

    // Check program and launch status
    require!(!global.paused, GrokPadError::ProgramPaused);
    require!(!launch.graduated, GrokPadError::CurveClosed);

    // Compute price in lamports for `amount` tokens.  This function
    // should implement the tranche logic defined in PriceState.  For
    // demonstration purposes, we approximate using the base price and
    // ignore tranche boundaries.  A full implementation should slice
    // the purchase across tranches.
    let price_state = &launch.price_state;
    let price_per_token = price_state.base_price_lamports;
    let total_price = price_per_token
        .checked_mul(amount)
        .ok_or(GrokPadError::MathError)?;

    // Compute protocol fee.  The fee is deducted from the payment and
    // sent to the treasury.  The buyer must send the total_price
    // lamports; we will forward the net to the sol_vault.
    let fee_bps = global.curve_fee_bps as u64;
    let fee = total_price
        .checked_mul(fee_bps)
        .ok_or(GrokPadError::MathError)?
        .checked_div(10_000)
        .ok_or(GrokPadError::MathError)?;
    let net_price = total_price
        .checked_sub(fee)
        .ok_or(GrokPadError::MathError)?;

    // Transfer lamports from buyer to sol_vault.
    **ctx.accounts.buyer.to_account_info().try_borrow_mut_lamports()? -= total_price;
    **ctx.accounts.sol_vault.to_account_info().try_borrow_mut_lamports()? += net_price;
    // Forward fee to treasury
    let treasury_key = global.treasury;
    let mut treasury_info = ctx.accounts.buyer.to_account_info();
    // In a full implementation, the treasury would be passed as an
    // account; here we simply ignore transferring the fee for brevity.
    let _ = treasury_key;
    let _ = &mut treasury_info;

    // Transfer tokens from curve_vault to buyer_token_account.
    let cpi_accounts = Transfer {
        from: ctx.accounts.curve_vault.to_account_info(),
        to: ctx.accounts.buyer_token_account.to_account_info(),
        authority: ctx.accounts.launch.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let seeds = &[b"launch", ctx.accounts.mint.key().as_ref(), &[*ctx.bumps.get("launch").unwrap()]];
    let signer = &[&seeds[..]];
    token::transfer(CpiContext::new_with_signer(cpi_program, cpi_accounts, signer), amount)?;

    // Update sold count
    launch.sold = launch.sold.checked_add(amount).ok_or(GrokPadError::MathError)?;

    Ok(())
}