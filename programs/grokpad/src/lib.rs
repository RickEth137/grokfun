use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, Transfer},
};
use anchor_lang::solana_program::system_program; // for owner ID checks

declare_id!("PQghCjXvt7v7YYDo4rsgWJzxEQhSJmFLGjM5DPikuJE");

const LAUNCH_SEED: &[u8] = b"launch";
const STATE_SEED: &[u8] = b"launch_state";
const VAULT_SOL_SEED: &[u8] = b"vault_sol";

#[program]
pub mod grokpad {
    use super::*;

    pub fn initialize_launch(
        ctx: Context<InitializeLaunch>,
        base_price_lamports: u64,
        slope_lamports: u64,
        fee_bps: u16,
        creator_fee_bps: u16,
        graduation_target_lamports: u64,
    ) -> Result<()> {
        require!(fee_bps <= 1000, GrokError::FeeTooHigh); // Max 10%
        require!(creator_fee_bps <= 1000, GrokError::FeeTooHigh); // Max 10%
        // Runtime safety: ensure vault SOL PDA is a system-owned account (rent-exempt zero data)
        require!(ctx.accounts.vault_sol_pda.owner == &system_program::ID, GrokError::InvalidOwner);
        // creator / platform fee recipient are recorded exactly as passed; no further validation here (could add allowlist logic later)
        
        let mint = &ctx.accounts.mint;
        let state = &mut ctx.accounts.state_pda;
        state.mint = mint.key();
        state.decimals = mint.decimals;
        state.base_price_lamports = base_price_lamports;
        state.slope_lamports = slope_lamports;
        state.fee_bps = fee_bps;
        state.creator_fee_bps = creator_fee_bps;
        state.platform_fee_recipient = ctx.accounts.platform_fee_recipient.key();
        state.creator = ctx.accounts.creator.key();
        state.graduation_target_lamports = graduation_target_lamports;
        state.graduated = false;

        let supply = ctx.accounts.vault_ata.amount;
        state.supply_remaining = supply;
        state.tokens_sold = 0;
        state.reserves_lamports = 0;
        state.platform_fee_accrued = 0;
        state.creator_fee_accrued = 0;
        Ok(())
    }

    pub fn buy(ctx: Context<Buy>, amount: u64, max_cost_lamports: u64) -> Result<()> {
        let state = &mut ctx.accounts.state_pda;
        require!(amount > 0, GrokError::ZeroAmount);
        require!(!state.graduated, GrokError::LaunchGraduated);
        require!(amount <= state.supply_remaining, GrokError::NotEnoughSupply);
        // Runtime checks for UncheckedAccount safety
        require_keys_eq!(ctx.accounts.platform_fee_recipient.key(), state.platform_fee_recipient, GrokError::InvalidOwner);
        require_keys_eq!(ctx.accounts.creator.key(), state.creator, GrokError::InvalidOwner);
        require!(ctx.accounts.vault_sol_pda.owner == &system_program::ID, GrokError::InvalidOwner);

        // Units = base (whole token) units considering decimals.
        let scale = 10u128.pow(state.decimals as u32);
        let units = amount as u128 / scale;
        require!(units > 0, GrokError::ZeroUnits);

        let sold_units_before = state.tokens_sold as u128 / scale;

        let cost_u128 = linear_buy_cost(
            state.base_price_lamports as u128,
            state.slope_lamports as u128,
            sold_units_before,
            units,
        );
        require!(cost_u128 <= u64::MAX as u128, GrokError::Overflow);
        let cost = cost_u128 as u64;
        require!(cost <= max_cost_lamports, GrokError::SlippageExceeded);

        let platform_fee = cost.saturating_mul(state.fee_bps as u64) / 10_000;
        let creator_fee = cost.saturating_mul(state.creator_fee_bps as u64) / 10_000;
        let net = cost
            .checked_sub(platform_fee)
            .and_then(|v| v.checked_sub(creator_fee))
            .ok_or(GrokError::Underflow)?;

        // Transfer SOL to vault PDA.
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to: ctx.accounts.vault_sol_pda.to_account_info(),
                },
            ),
            cost,
        )?;

        // Transfer tokens from vault to buyer using authority PDA.
        let mint_key = ctx.accounts.mint.key();
        let authority_bump = ctx.bumps.authority_pda;
        let authority_seeds: &[&[u8]] = &[LAUNCH_SEED, mint_key.as_ref(), &[authority_bump]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_ata.to_account_info(),
                    to: ctx.accounts.buyer_ata.to_account_info(),
                    authority: ctx.accounts.authority_pda.to_account_info(),
                },
                &[authority_seeds],
            ),
            amount,
        )?;

        // State updates.
        state.tokens_sold = state.tokens_sold.checked_add(amount).ok_or(GrokError::Overflow)?;
        state.supply_remaining = state
            .supply_remaining
            .checked_sub(amount)
            .ok_or(GrokError::Underflow)?;
        state.platform_fee_accrued = state
            .platform_fee_accrued
            .checked_add(platform_fee)
            .ok_or(GrokError::Overflow)?;
        state.creator_fee_accrued = state
            .creator_fee_accrued
            .checked_add(creator_fee)
            .ok_or(GrokError::Overflow)?;
        state.reserves_lamports = state
            .reserves_lamports
            .checked_add(net)
            .ok_or(GrokError::Overflow)?;

        if !state.graduated && state.reserves_lamports >= state.graduation_target_lamports {
            state.graduated = true;
            msg!("Graduated: reserves {}", state.reserves_lamports);
        }

        Ok(())
    }

    pub fn sell(ctx: Context<Sell>, amount: u64, min_payout_lamports: u64) -> Result<()> {
        let state = &mut ctx.accounts.state_pda;
        require!(amount > 0, GrokError::ZeroAmount);
        require!(!state.graduated, GrokError::LaunchGraduated);
        // Runtime checks for UncheckedAccount safety
        require_keys_eq!(ctx.accounts.platform_fee_recipient.key(), state.platform_fee_recipient, GrokError::InvalidOwner);
        require_keys_eq!(ctx.accounts.creator.key(), state.creator, GrokError::InvalidOwner);
        require!(ctx.accounts.vault_sol_pda.owner == &system_program::ID, GrokError::InvalidOwner);

        let scale = 10u128.pow(state.decimals as u32);
        let units = amount as u128 / scale;
        require!(units > 0, GrokError::ZeroUnits);

        let total_units_sold = state.tokens_sold as u128 / scale;
        require!(units <= total_units_sold, GrokError::Underflow);

        // Refund is the cost of the last 'units' sold (reverse of buy order).
        let start_units = total_units_sold - units;
        let refund_u128 = linear_buy_cost(
            state.base_price_lamports as u128,
            state.slope_lamports as u128,
            start_units,
            units,
        );
        require!(refund_u128 <= u64::MAX as u128, GrokError::Overflow);
        let refund_gross = refund_u128 as u64;

        let platform_fee = refund_gross.saturating_mul(state.fee_bps as u64) / 10_000;
        let creator_fee = refund_gross.saturating_mul(state.creator_fee_bps as u64) / 10_000;
        let refund_net = refund_gross
            .checked_sub(platform_fee)
            .and_then(|v| v.checked_sub(creator_fee))
            .ok_or(GrokError::Underflow)?;
        require!(refund_net >= min_payout_lamports, GrokError::SlippageExceeded);
        require!(refund_net <= state.reserves_lamports, GrokError::Underflow);

        // Transfer tokens back to vault (seller signs).
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.seller_ata.to_account_info(),
                    to: ctx.accounts.vault_ata.to_account_info(),
                    authority: ctx.accounts.seller.to_account_info(),
                },
            ),
            amount,
        )?;

        // Pay seller from vault SOL PDA.
        let mint_key = ctx.accounts.mint.key();
        let vault_sol_bump = ctx.bumps.vault_sol_pda;
        let vault_sol_seeds: &[&[u8]] = &[VAULT_SOL_SEED, mint_key.as_ref(), &[vault_sol_bump]];
        anchor_lang::system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.vault_sol_pda.to_account_info(),
                    to: ctx.accounts.seller.to_account_info(),
                },
                &[vault_sol_seeds],
            ),
            refund_net,
        )?;

        // State updates.
        state.platform_fee_accrued = state
            .platform_fee_accrued
            .checked_add(platform_fee)
            .ok_or(GrokError::Overflow)?;
        state.creator_fee_accrued = state
            .creator_fee_accrued
            .checked_add(creator_fee)
            .ok_or(GrokError::Overflow)?;
        state.reserves_lamports = state
            .reserves_lamports
            .checked_sub(refund_net)
            .ok_or(GrokError::Underflow)?;
        state.tokens_sold = state
            .tokens_sold
            .checked_sub(amount)
            .ok_or(GrokError::Underflow)?;
        state.supply_remaining = state
            .supply_remaining
            .checked_add(amount)
            .ok_or(GrokError::Overflow)?;
        Ok(())
    }

    pub fn withdraw_fees(ctx: Context<WithdrawFees>) -> Result<()> {
        let state = &mut ctx.accounts.state_pda;
        // Verify recipients
        require_keys_eq!(ctx.accounts.platform_fee_recipient.key(), state.platform_fee_recipient, GrokError::InvalidOwner);
        require_keys_eq!(ctx.accounts.creator.key(), state.creator, GrokError::InvalidOwner);
        // Nothing to do
        if state.platform_fee_accrued == 0 && state.creator_fee_accrued == 0 { return Ok(()); }

        // Ensure vault owned by system
        require!(ctx.accounts.vault_sol_pda.owner == &system_program::ID, GrokError::InvalidOwner);
        // Seeds for vault signer
        let mint_key = ctx.accounts.mint.key();
        let vault_sol_bump = ctx.bumps.vault_sol_pda;
        let vault_sol_seeds: &[&[u8]] = &[VAULT_SOL_SEED, mint_key.as_ref(), &[vault_sol_bump]];

        // Platform fee transfer
        if state.platform_fee_accrued > 0 { 
            let amount = state.platform_fee_accrued;
            anchor_lang::system_program::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.system_program.to_account_info(),
                    anchor_lang::system_program::Transfer {
                        from: ctx.accounts.vault_sol_pda.to_account_info(),
                        to: ctx.accounts.platform_fee_recipient.to_account_info(),
                    },
                    &[vault_sol_seeds],
                ),
                amount,
            )?;
            state.reserves_lamports = state.reserves_lamports.checked_sub(amount).ok_or(GrokError::Underflow)?;
            state.platform_fee_accrued = 0;
        }
        // Creator fee transfer
        if state.creator_fee_accrued > 0 { 
            let amount = state.creator_fee_accrued;
            anchor_lang::system_program::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.system_program.to_account_info(),
                    anchor_lang::system_program::Transfer {
                        from: ctx.accounts.vault_sol_pda.to_account_info(),
                        to: ctx.accounts.creator.to_account_info(),
                    },
                    &[vault_sol_seeds],
                ),
                amount,
            )?;
            state.reserves_lamports = state.reserves_lamports.checked_sub(amount).ok_or(GrokError::Underflow)?;
            state.creator_fee_accrued = 0;
        }

        Ok(())
    }
}

/* ---------------- Accounts ---------------- */

#[account]
pub struct LaunchState {
    pub mint: Pubkey,
    pub decimals: u8,
    pub base_price_lamports: u64,
    pub slope_lamports: u64,
    pub fee_bps: u16,
    pub creator_fee_bps: u16,
    pub platform_fee_recipient: Pubkey,
    pub creator: Pubkey,
    pub graduation_target_lamports: u64,
    pub graduated: bool,

    pub supply_remaining: u64,
    pub tokens_sold: u64,
    pub reserves_lamports: u64,
    pub platform_fee_accrued: u64,
    pub creator_fee_accrued: u64,
}
impl LaunchState {
    pub const LEN: usize = 8
        + 32 + 1
        + 8 + 8
        + 2 + 2
        + 32 + 32
        + 8 + 1
        + 8 + 8 + 8 + 8 + 8;
}

#[derive(Accounts)]
#[instruction(fee_bps: u16, creator_fee_bps: u16)]
pub struct InitializeLaunch<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub creator: UncheckedAccount<'info>,
    pub platform_fee_recipient: UncheckedAccount<'info>,
    pub mint: Account<'info, Mint>,

    #[account(
        seeds = [LAUNCH_SEED, mint.key().as_ref()],
        bump
    )]
    pub authority_pda: UncheckedAccount<'info>,

    #[account(
        init,
        payer = payer,
        space = LaunchState::LEN,
        seeds = [STATE_SEED, mint.key().as_ref()],
        bump
    )]
    pub state_pda: Account<'info, LaunchState>,

    #[account(
        init,
        payer = payer,
        space = 0,
        seeds = [VAULT_SOL_SEED, mint.key().as_ref()],
        bump
    )]
    pub vault_sol_pda: UncheckedAccount<'info>, // changed from SystemAccount to avoid macro bug

    #[account(
        init,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = authority_pda
    )]
    pub vault_ata: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Buy<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        seeds = [STATE_SEED, mint.key().as_ref()],
        bump,
    )]
    pub state_pda: Account<'info, LaunchState>,
    #[account(
        seeds = [LAUNCH_SEED, mint.key().as_ref()],
        bump
    )]
    pub authority_pda: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [VAULT_SOL_SEED, mint.key().as_ref()],
        bump
    )]
    pub vault_sol_pda: UncheckedAccount<'info>, // changed from SystemAccount
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = authority_pda
    )]
    pub vault_ata: Account<'info, TokenAccount>,
    #[account(
        init,
        payer = buyer,
        associated_token::mint = mint,
        associated_token::authority = buyer
    )]
    pub buyer_ata: Account<'info, TokenAccount>,
    /// CHECK:
    pub platform_fee_recipient: UncheckedAccount<'info>,
    /// CHECK:
    pub creator: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Sell<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        seeds = [STATE_SEED, mint.key().as_ref()],
        bump,
    )]
    pub state_pda: Account<'info, LaunchState>,
    #[account(
        seeds = [LAUNCH_SEED, mint.key().as_ref()],
        bump
    )]
    pub authority_pda: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [VAULT_SOL_SEED, mint.key().as_ref()],
        bump
    )]
    pub vault_sol_pda: UncheckedAccount<'info>, // changed from SystemAccount
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = authority_pda
    )]
    pub vault_ata: Account<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = seller
    )]
    pub seller_ata: Account<'info, TokenAccount>,
    /// CHECK:
    pub platform_fee_recipient: UncheckedAccount<'info>,
    /// CHECK:
    pub creator: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct WithdrawFees<'info> {
    /// Anyone can trigger; not restricted
    pub caller: Signer<'info>,
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        seeds = [STATE_SEED, mint.key().as_ref()],
        bump,
    )]
    pub state_pda: Account<'info, LaunchState>,
    #[account(
        mut,
        seeds = [VAULT_SOL_SEED, mint.key().as_ref()],
        bump
    )]
    pub vault_sol_pda: UncheckedAccount<'info>,
    /// CHECK: validated against state
    #[account(mut)]
    pub platform_fee_recipient: UncheckedAccount<'info>,
    /// CHECK: validated against state
    #[account(mut)]
    pub creator: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

/* ---------------- Helpers ---------------- */

fn linear_buy_cost(
    base_price: u128,
    slope: u128,
    sold_before_units: u128,
    units: u128,
) -> u128 {
    // Sum_{i=0}^{units-1} (base_price + slope*(sold_before_units + i))
    let units_minus1 = units.saturating_sub(1);
    base_price
        .saturating_mul(units)
        .saturating_add(
            slope
                .saturating_mul(
                    sold_before_units
                        .saturating_mul(units)
                        .saturating_add(units_minus1.saturating_mul(units) / 2),
                ),
        )
}

/* ---------------- Errors ---------------- */

#[error_code]
pub enum GrokError {
    #[msg("Fee too high")]
    FeeTooHigh,
    #[msg("Amount must be > 0")]
    ZeroAmount,
    #[msg("Computed zero units")]
    ZeroUnits,
    #[msg("Not enough supply")]
    NotEnoughSupply,
    #[msg("Underflow")]
    Underflow,
    #[msg("Overflow")]
    Overflow,
    #[msg("Slippage exceeded")]
    SlippageExceeded,
    #[msg("Launch already graduated")]
    LaunchGraduated,
    #[msg("Bump not found")]
    BumpNotFound,
    #[msg("Invalid owner")] // added for runtime check on vault_sol_pda
    InvalidOwner,
}
