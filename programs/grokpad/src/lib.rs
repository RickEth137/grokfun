use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, Transfer},
};

declare_id!("SiWK8bFxB4zU9BTzH9C9PQ364sedNxXLTCQ84o5WvKm");

#[program]
pub mod grokpad {
    use super::*;

    pub fn initialize_launch(
        ctx: Context<InitializeLaunch>,
        fee_bps: u16,
        creator_fee_bps: u16,
        base_price_lamports: u64,
        slope_lamports: u64,
        graduation_target_lamports: u64,
    ) -> Result<()> {
        require!(fee_bps as u32 + creator_fee_bps as u32 <= 10_000, GrokError::InvalidFees);

        let state = &mut ctx.accounts.state_pda;
        state.mint = ctx.accounts.mint.key();
        state.creator = ctx.accounts.creator.key();
        state.platform = ctx.accounts.platform_fee_recipient.key();
        state.vault_token = ctx.accounts.vault_ata.key();
        state.bump_authority = ctx.bumps.authority_pda;
        state.bump_state = ctx.bumps.state_pda; // state_pda bump
        state.bump_vault_sol = ctx.bumps.vault_sol_pda;
        state.fee_bps = fee_bps;
        state.creator_fee_bps = creator_fee_bps;
        state.reserves_lamports = 0;
        state.supply_remaining = ctx.accounts.vault_ata.amount;
        state.base_price_lamports = base_price_lamports;
        state.slope_lamports = slope_lamports;
        state.tokens_sold = 0;
        state.graduation_target_lamports = graduation_target_lamports;
        state.graduated = false;

        // Initialize accrued fee trackers
        state.platform_fee_accrued = 0;
        state.creator_fee_accrued = 0;
        Ok(())
    }

    pub fn buy(ctx: Context<Buy>, amount: u64) -> Result<()> {
        msg!("BUY ENTER (handler start)");
        require!(amount > 0, GrokError::ZeroAmount);
        // This is a bit rigid. A better approach might be to use the mint's decimals dynamically.
        // For now, we'll keep it as a hardcoded constant assuming 9 decimals.
        const DECIMALS: u64 = 1_000_000_000;
        require!(amount % DECIMALS == 0, GrokError::NonIntegralAmount);

        let units = amount / DECIMALS;
        let state = &mut ctx.accounts.state_pda;

        require!(!state.graduated, GrokError::LaunchGraduated);
        require!(amount <= state.supply_remaining, GrokError::NotEnoughSupply);

        // --- 1. Calculate Cost ---
        let sold_units_before = state.tokens_sold / DECIMALS;
        let cost_u128 = linear_buy_cost(
            state.base_price_lamports,
            state.slope_lamports,
            sold_units_before,
            units,
        );
        require!(cost_u128 <= u64::MAX as u128, GrokError::Overflow);
        let cost = cost_u128 as u64;

        let platform_fee = cost.saturating_mul(state.fee_bps as u64) / 10_000;
        let creator_fee = cost.saturating_mul(state.creator_fee_bps as u64) / 10_000;
        let net = cost
            .checked_sub(platform_fee)
            .and_then(|v| v.checked_sub(creator_fee))
            .ok_or(GrokError::Underflow)?;

        // --- 2. Transfer SOL from Buyer to Vault ---
        msg!("Transferring {} lamports from buyer to SOL vault.", cost);
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to: ctx.accounts.vault_sol_pda.to_account_info(),
                },
            ),
            cost,
        )?;

        // --- 3. Transfer Tokens from Vault to Buyer ---
        msg!("Transferring {} tokens from vault to buyer.", amount);
        let mint_key = ctx.accounts.mint.key();
        let authority_seeds = &[
            b"launch".as_ref(),
            mint_key.as_ref(),
            &[state.bump_authority],
        ];
        let signer_seeds = &[&authority_seeds[..]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_ata.to_account_info(),
                    to: ctx.accounts.buyer_ata.to_account_info(),
                    authority: ctx.accounts.authority_pda.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
        )?;

        // --- 4. Update State ---
        state.tokens_sold = state.tokens_sold.checked_add(amount).ok_or(GrokError::Overflow)?;
        state.supply_remaining = state.supply_remaining.checked_sub(amount).ok_or(GrokError::Underflow)?;
        state.platform_fee_accrued = state.platform_fee_accrued.checked_add(platform_fee).ok_or(GrokError::Overflow)?;
        state.creator_fee_accrued = state.creator_fee_accrued.checked_add(creator_fee).ok_or(GrokError::Overflow)?;
        state.reserves_lamports = state.reserves_lamports.checked_add(net).ok_or(GrokError::Overflow)?;

        // --- 5. Check for Graduation ---
        if !state.graduated && state.reserves_lamports >= state.graduation_target_lamports {
            state.graduated = true;
            msg!("Congratulations! Launch has graduated with {} lamports in reserves.", state.reserves_lamports);
        }

        msg!("BUY EXIT: Success.");
        Ok(())
    }

    pub fn sell(ctx: Context<Sell>, amount: u64) -> Result<()> {
        require!(amount > 0, GrokError::ZeroAmount);
        const DECIMALS: u64 = 1_000_000_000;
        require!(amount % DECIMALS == 0, GrokError::NonIntegralAmount);
        let units = amount / DECIMALS;
        let state = &mut ctx.accounts.state_pda;
        require!(!state.graduated, GrokError::LaunchGraduated);

        let sold_units_total = state.tokens_sold / DECIMALS;
        require!(units <= sold_units_total, GrokError::Underflow);

        let tokens_sold_before_units = sold_units_total - units;
        let refund_u128 = linear_buy_cost(
            state.base_price_lamports,
            state.slope_lamports,
            tokens_sold_before_units,
            units,
        );
        require!(refund_u128 <= u64::MAX as u128, GrokError::Overflow);
        let refund = refund_u128 as u64;

        let platform_fee = refund.saturating_mul(state.fee_bps as u64) / 10_000;
        let creator_fee = refund.saturating_mul(state.creator_fee_bps as u64) / 10_000;
        let net = refund
            .checked_sub(platform_fee)
            .and_then(|v| v.checked_sub(creator_fee))
            .ok_or(GrokError::Underflow)?;

        // --- 1. Transfer Tokens from Seller back to Vault ---
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

        // --- 2. Transfer Net SOL from Vault to Seller ---
        let mint_key = ctx.accounts.mint.key();
        let vault_sol_seeds = &[
            b"vault_sol".as_ref(),
            mint_key.as_ref(),
            &[state.bump_vault_sol],
        ];
        let signer_seeds = &[&vault_sol_seeds[..]];

        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.vault_sol_pda.to_account_info(),
                    to: ctx.accounts.seller.to_account_info(),
                },
                signer_seeds,
            ),
            net,
        )?;

        // --- 3. Update State ---
        state.platform_fee_accrued = state.platform_fee_accrued
            .checked_add(platform_fee)
            .ok_or(GrokError::Overflow)?;
        state.creator_fee_accrued = state.creator_fee_accrued
            .checked_add(creator_fee)
            .ok_or(GrokError::Overflow)?;
        state.reserves_lamports = state.reserves_lamports.checked_sub(net).ok_or(GrokError::Underflow)?;
        state.tokens_sold = state.tokens_sold.checked_sub(amount).ok_or(GrokError::Underflow)?;
        state.supply_remaining = state.supply_remaining.checked_add(amount).ok_or(GrokError::Overflow)?;

        msg!("SELL EXIT: Success.");
        Ok(())
    }

    pub fn withdraw_fees(ctx: Context<WithdrawFees>) -> Result<()> {
        let state = &mut ctx.accounts.state_pda;
        let creator_fee = state.creator_fee_accrued;
        let platform_fee = state.platform_fee_accrued;

        require!(creator_fee > 0 || platform_fee > 0, GrokError::NoFeesToWithdraw);

        let mint_key = state.mint;
        let vault_sol_seeds = &[
            b"vault_sol".as_ref(),
            mint_key.as_ref(),
            &[state.bump_vault_sol],
        ];
        let signer_seeds = &[&vault_sol_seeds[..]];

        if creator_fee > 0 {
            system_program::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: ctx.accounts.vault_sol_pda.to_account_info(),
                        to: ctx.accounts.creator.to_account_info(),
                    },
                    signer_seeds,
                ),
                creator_fee,
            )?;
            state.creator_fee_accrued = 0;
        }

        if platform_fee > 0 {
            system_program::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: ctx.accounts.vault_sol_pda.to_account_info(),
                        to: ctx.accounts.platform_fee_recipient.to_account_info(),
                    },
                    signer_seeds,
                ),
                platform_fee,
            )?;
            state.platform_fee_accrued = 0;
        }

        Ok(())
    }
}

// ---------- Helper (pure math) ----------
pub fn linear_buy_cost(
    base_price: u64,
    slope: u64,
    tokens_sold_before: u64,
    buy_amount: u64,
) -> u128 {
    let b = base_price as u128;
    let s = slope as u128;
    let sold0 = tokens_sold_before as u128;
    let n = buy_amount as u128;
    n * b + s * (n * sold0 + n * (n - 1) / 2)
}

// ---------- Accounts & State ----------

#[account]
pub struct Launch {
    // --- PDAs and Keys (32 bytes each)
    pub mint: Pubkey,
    pub creator: Pubkey,
    pub platform: Pubkey,
    pub vault_token: Pubkey,

    // --- Bonding Curve & State (8 bytes each)
    pub reserves_lamports: u64,
    pub supply_remaining: u64,
    pub base_price_lamports: u64,
    pub slope_lamports: u64,
    pub tokens_sold: u64,
    pub graduation_target_lamports: u64,
    pub platform_fee_accrued: u64,
    pub creator_fee_accrued: u64,

    // --- Fees (2 bytes each)
    pub fee_bps: u16,
    pub creator_fee_bps: u16,

    // --- Bumps & Flags (1 byte each)
    pub bump_authority: u8,
    pub bump_state: u8,
    pub bump_vault_sol: u8,
    pub graduated: bool,
    // Note: Reordering fields from largest to smallest minimizes padding.
    // The struct data size is 200 bytes. With padding to align to an 8-byte
    // boundary, the total struct size becomes 208 bytes.
}

#[derive(Accounts)]
#[instruction(fee_bps: u16, creator_fee_bps: u16, base_price_lamports: u64, slope_lamports: u64, graduation_target_lamports: u64)]
pub struct InitializeLaunch<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub creator: SystemAccount<'info>,
    pub platform_fee_recipient: SystemAccount<'info>,
    pub mint: Account<'info, Mint>,

    #[account(
        seeds = [b"launch", mint.key().as_ref()],
        bump,
    )]
    /// CHECK: authority PDA for token vault
    pub authority_pda: UncheckedAccount<'info>,

    #[account(
        init,
        payer = payer,
        seeds = [b"launch_state", mint.key().as_ref()],
        bump,
        // 8 (discriminator) + 208 (Launch struct size with padding) = 216
        space = 8 + 4*32 + 8*8 + 2*2 + 4*1 + 4 // explicit calc with padding
    )]
    pub state_pda: Account<'info, Launch>,

    #[account(
        init,
        payer = payer,
        seeds = [b"vault_sol", mint.key().as_ref()],
        bump,
        space = 0
    )]
    pub vault_sol_pda: SystemAccount<'info>,

    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = authority_pda
    )]
    pub vault_ata: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
pub struct Buy<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        seeds = [b"launch_state", mint.key().as_ref()],
        bump = state_pda.bump_state
    )]
    pub state_pda: Account<'info, Launch>,

    #[account(
        mut,
        seeds = [b"vault_sol", mint.key().as_ref()],
        bump = state_pda.bump_vault_sol
    )]
    pub vault_sol_pda: SystemAccount<'info>,

    #[account(seeds = [b"launch", mint.key().as_ref()], bump = state_pda.bump_authority)]
    /// CHECK: Authority PDA, seeds are checked.
    pub authority_pda: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = vault_ata.key() == state_pda.vault_token @ GrokError::InvalidVault,
        associated_token::mint = mint,
        associated_token::authority = authority_pda
    )]
    pub vault_ata: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = buyer,
        associated_token::mint = mint,
        associated_token::authority = buyer
    )]
    pub buyer_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Sell<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        seeds = [b"launch_state", mint.key().as_ref()],
        bump = state_pda.bump_state
    )]
    pub state_pda: Account<'info, Launch>,
    #[account(
        mut,
        seeds = [b"vault_sol", mint.key().as_ref()],
        bump = state_pda.bump_vault_sol
    )]
    pub vault_sol_pda: SystemAccount<'info>,
    #[account(seeds = [b"launch", mint.key().as_ref()], bump = state_pda.bump_authority)]
    /// CHECK: Authority PDA, seeds are checked.
    pub authority_pda: UncheckedAccount<'info>,
    #[account(
        mut,
        constraint = vault_ata.key() == state_pda.vault_token @ GrokError::InvalidVault,
        associated_token::mint = mint,
        associated_token::authority = authority_pda
    )]
    pub vault_ata: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = seller_ata.amount > 0 @ GrokError::ZeroBalance,
        associated_token::mint = mint,
        associated_token::authority = seller
    )]
    pub seller_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawFees<'info> {
    #[account(
        mut,
        constraint = creator.key() == state_pda.creator @ GrokError::InvalidCreator
    )]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"launch_state", state_pda.mint.as_ref()],
        bump = state_pda.bump_state
    )]
    pub state_pda: Account<'info, Launch>,

    #[account(
        mut,
        seeds = [b"vault_sol", state_pda.mint.as_ref()],
        bump = state_pda.bump_vault_sol
    )]
    pub vault_sol_pda: SystemAccount<'info>,

    #[account(
        mut,
        constraint = platform_fee_recipient.key() == state_pda.platform @ GrokError::InvalidPlatformRecipient
    )]
    /// CHECK: The platform fee recipient is validated against the state.
    pub platform_fee_recipient: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

// ---------- Errors ----------
#[error_code]
pub enum GrokError {
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Arithmetic underflow")]
    Underflow,
    #[msg("Zero amount")]
    ZeroAmount,
    #[msg("Not enough supply")]
    NotEnoughSupply,
    #[msg("Invalid fee configuration")]
    InvalidFees,
    #[msg("Amount not a whole token")]
    NonIntegralAmount,
    #[msg("The provided vault ATA does not match the one in the launch state.")]
    InvalidVault,
    #[msg("Seller has no tokens to sell.")]
    ZeroBalance,
    #[msg("The signer is not the authorized creator for this launch.")]
    InvalidCreator,
    #[msg("The provided platform fee recipient does not match the one in the launch state.")]
    InvalidPlatformRecipient,
    #[msg("There are no fees to withdraw at this time.")]
    NoFeesToWithdraw,
    #[msg("This launch has met its graduation target and is closed.")]
    LaunchGraduated,
}
