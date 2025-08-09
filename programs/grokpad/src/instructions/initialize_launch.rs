use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, TokenAccount, Token, MintTo};

use crate::state::{GlobalConfig, Launch, PriceState};
use crate::errors::GrokPadError;

pub fn initialize_launch(
    ctx: Context<InitializeLaunch>,
    name: String,
    _symbol: String,
    price_state: PriceState,
) -> Result<()> {
    require!(name.ends_with("grok"), GrokPadError::InvalidNameSuffix);

    let full_supply: u64 = 1_000_000_000;

    let cpi_accounts = MintTo {
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.curve_vault.to_account_info(),
        authority: ctx.accounts.launch.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();

    // Anchor 0.31: bumps are fields, not a map.
    let mint_key = ctx.accounts.mint.key();
    let bump = ctx.bumps.launch;
    let seeds: &[&[u8]] = &[b"launch", mint_key.as_ref(), &[bump]];
    let signer: &[&[&[u8]]] = &[seeds];

    token::mint_to(
        CpiContext::new_with_signer(cpi_program, cpi_accounts, signer),
        full_supply,
    )?;

    let launch = &mut ctx.accounts.launch;
    launch.creator = ctx.accounts.creator.key();
    launch.mint = mint_key;
    launch.curve_vault = ctx.accounts.curve_vault.key();
    launch.sol_vault = ctx.accounts.sol_vault.key();
    launch.sold = 0;
    launch.price_state = price_state;
    launch.graduated = false;
    launch.metadata_uri = String::new();

    Ok(())
}

#[derive(Accounts)]
#[instruction(name: String, _symbol: String)]
pub struct InitializeLaunch<'info> {
    #[account(mut, has_one = admin)]
    pub global_config: Account<'info, GlobalConfig>,

    pub admin: Signer<'info>,

    #[account(
        init,
        payer = creator,
        space = 8 + Launch::INIT_SPACE,
        seeds = [b"launch", mint.key().as_ref()],
        bump
    )]
    pub launch: Account<'info, Launch>,

    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(mut)]
    pub mint: Account<'info, Mint>,

    #[account(mut, constraint = curve_vault.mint == mint.key())]
    pub curve_vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub sol_vault: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}
