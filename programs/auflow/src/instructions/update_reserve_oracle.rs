use anchor_lang::prelude::*;

use crate::constants::RESERVE_SEED;
use crate::error::AuFlowError;
use crate::state::{GlobalConfig, ReserveState};
use crate::utils::validate_metal_type;

#[derive(Accounts)]
#[instruction(metal_type: u8)]
pub struct UpdateReserveOracle<'info> {
    #[account(mut)]
    pub auditor: Signer<'info>,

    #[account(
        seeds = [crate::constants::CONFIG_SEED],
        bump = config.bump,
        constraint = config.auditor_pubkey == auditor.key() @ AuFlowError::Unauthorized,
    )]
    pub config: Account<'info, GlobalConfig>,

    #[account(
        init_if_needed,
        payer = auditor,
        space = 8 + ReserveState::INIT_SPACE,
        seeds = [RESERVE_SEED, &[metal_type][..]],
        bump,
    )]
    pub reserve: Account<'info, ReserveState>,

    pub system_program: Program<'info, System>,
}

pub fn process_update_reserve_oracle(
    ctx: Context<UpdateReserveOracle>,
    metal_type: u8,
    total_weight_grams: u64,
    merkle_root: [u8; 32],
) -> Result<()> {
    validate_metal_type(metal_type)?;

    let clock = Clock::get()?;
    let reserve = &mut ctx.accounts.reserve;
    reserve.metal_type = metal_type;
    reserve.total_weight_grams = total_weight_grams;
    reserve.merkle_root = merkle_root;
    reserve.last_updated_ts = clock.unix_timestamp;
    reserve.bump = ctx.bumps.reserve;
    Ok(())
}
