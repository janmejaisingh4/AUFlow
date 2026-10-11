use anchor_lang::prelude::*;

use crate::constants::{
    CONFIG_SEED, DEFAULT_LIQUIDATION_BONUS_BPS, DEFAULT_LIQUIDATION_THRESHOLD_BPS,
    DEFAULT_MAX_LTV_BPS,
};
use crate::state::GlobalConfig;

#[derive(Accounts)]
pub struct InitializeProtocol<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + GlobalConfig::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump,
    )]
    pub config: Account<'info, GlobalConfig>,

    pub system_program: Program<'info, System>,
}

pub fn process_initialize_protocol(
    ctx: Context<InitializeProtocol>,
    auditor_pubkey: Pubkey,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.auditor_pubkey = auditor_pubkey;
    config.max_ltv_bps = DEFAULT_MAX_LTV_BPS;
    config.liquidation_threshold_bps = DEFAULT_LIQUIDATION_THRESHOLD_BPS;
    config.liquidation_bonus_bps = DEFAULT_LIQUIDATION_BONUS_BPS;
    config.bump = ctx.bumps.config;
    Ok(())
}
