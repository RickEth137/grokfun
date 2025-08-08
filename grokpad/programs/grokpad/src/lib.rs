use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, Transfer},
};

declare_id!("24rtdj9var5RBGafZqMpm9sJKJH957XXptXctQbHwnCR");

#[program]
pub mod grokpad {
    use super::*;

    pub fn buy(ctx: Context<Buy>, amount: u64) -> Result<()> {
        // In Anchor 0.30+/0.31, bumps are generated as fields on the struct
        let bump: u8 = ctx.bumps.pda;

        let signer_seeds: &[&[u8]] = &[
            b"launch",
            ctx.accounts.mint.key().as_ref(),
            &[bump],
        ];

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault_ata.to_account_info(),
                to:   ctx.accounts.buyer_ata.to_account_info(),
                authority: ctx.accounts.pda.to_account_info(),
            },
            &[signer_seeds],
        );

        token::transfer(cpi_ctx, amount)
    }
}

#[derive(Accounts)]
pub struct Buy<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = buyer
    )]
    pub buyer_ata: Account<'info, TokenAccount>,

    /// CHECK: PDA only signs via seeds
    #[account(
        seeds = [b"launch", mint.key().as_ref()],
        bump
    )]
    pub pda: UncheckedAccount<'info>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = pda
    )]
    pub vault_ata: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
