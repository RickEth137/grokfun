use anchor_lang::prelude::*;

use crate::state::Launch;
use crate::errors::GrokPadError;

/// Context for setting metadata on a launch.  Only the creator may
/// update their metadata, and only if the launch has not been
/// graduated.
#[derive(Accounts)]
pub struct SetMetadata<'info> {
    #[account(mut, has_one = creator)]
    pub launch: Account<'info, Launch>,
    /// The creator who signed the launch.
    pub creator: Signer<'info>,
}

pub fn handler(ctx: Context<SetMetadata>, uri: String) -> Result<()> {
    let launch = &mut ctx.accounts.launch;
    // Prevent metadata changes after graduation.
    require!(!launch.graduated, GrokPadError::CurveClosed);
    launch.metadata_uri = uri;
    Ok(())
}