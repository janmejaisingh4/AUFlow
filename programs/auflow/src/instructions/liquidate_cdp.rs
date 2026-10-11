use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, Transfer as TokenTransfer};
use anchor_spl::token_2022::{self, Token2022, Transfer as Token2022Transfer};
use anchor_spl::token_interface::{Mint, TokenAccount};

use crate::constants::{BPS_DENOMINATOR, CDP_SEED, POOL_AUTHORITY_SEED, VAULT_SEED};
use crate::error::AuFlowError;
use crate::state::{CdpPosition, GlobalConfig};
use crate::utils::{
    collateral_amount_from_micro_usd, collateral_value_micro_usd, get_valid_pyth_price,
    ltv_bps,
};

#[derive(Accounts)]
pub struct LiquidateCdp<'info> {
    #[account(mut)]
    pub liquidator: Signer<'info>,

    #[account(seeds = [crate::constants::CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, GlobalConfig>>,

    #[account(
        mut,
        seeds = [CDP_SEED, cdp.owner.as_ref(), &[cdp.metal_type]],
        bump = cdp.bump,
    )]
    pub cdp: Box<Account<'info, CdpPosition>>,

    #[account(
        mut,
        seeds = [VAULT_SEED, cdp.key().as_ref()],
        bump,
        token::mint = commodity_mint,
        token::authority = cdp,
        token::token_program = token_2022_program,
    )]
    pub collateral_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    pub commodity_mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: Pyth legacy price feed account validated in handler.
    pub pyth_price_feed: UncheckedAccount<'info>,

    pub stablecoin_mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: PDA signer for stablecoin liquidity pool transfers.
    #[account(
        seeds = [POOL_AUTHORITY_SEED],
        bump,
    )]
    pub pool_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        token::mint = stablecoin_mint,
        token::authority = pool_authority,
        token::token_program = token_program,
    )]
    pub liquidity_pool: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = stablecoin_mint,
        token::authority = liquidator,
        token::token_program = token_program,
    )]
    pub liquidator_stablecoin_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = commodity_mint,
        token::authority = liquidator,
        token::token_program = token_2022_program,
    )]
    pub liquidator_collateral_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub token_2022_program: Program<'info, Token2022>,
}

pub fn process_liquidate_cdp(ctx: Context<LiquidateCdp>) -> Result<()> {
    let cdp = &ctx.accounts.cdp;
    require!(cdp.debt_amount > 0, AuFlowError::ZeroAmount);

    let clock = Clock::get()?;
    let price = get_valid_pyth_price(&ctx.accounts.pyth_price_feed.to_account_info(), &clock)?;
    let collateral_value = collateral_value_micro_usd(cdp.collateral_amount, &price)?;
    let current_ltv = ltv_bps(cdp.debt_amount, collateral_value)?;

    require!(
        current_ltv >= ctx.accounts.config.liquidation_threshold_bps as u64,
        AuFlowError::PositionHealthy
    );

    let debt_repay = cdp.debt_amount;
    let bonus_bps = ctx.accounts.config.liquidation_bonus_bps as u128;
    let seize_value_micro = (debt_repay as u128)
        .checked_mul(BPS_DENOMINATOR + bonus_bps)
        .and_then(|v| v.checked_div(BPS_DENOMINATOR))
        .ok_or(AuFlowError::MathOverflow)?;

    let mut seize_amount = collateral_amount_from_micro_usd(seize_value_micro, &price)?;
    seize_amount = seize_amount.min(cdp.collateral_amount);

    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TokenTransfer {
                from: ctx.accounts.liquidator_stablecoin_account.to_account_info(),
                to: ctx.accounts.liquidity_pool.to_account_info(),
                authority: ctx.accounts.liquidator.to_account_info(),
            },
        ),
        debt_repay,
    )?;

    let cdp_bump = ctx.accounts.cdp.bump;
    let metal_type = ctx.accounts.cdp.metal_type;
    let owner = ctx.accounts.cdp.owner;
    let cdp_seeds = &[CDP_SEED, owner.as_ref(), &[metal_type], &[cdp_bump]];

    token_2022::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_2022_program.to_account_info(),
            Token2022Transfer {
                from: ctx.accounts.collateral_vault.to_account_info(),
                to: ctx
                    .accounts
                    .liquidator_collateral_account
                    .to_account_info(),
                authority: ctx.accounts.cdp.to_account_info(),
            },
            &[cdp_seeds],
        ),
        seize_amount,
    )?;

    let cdp = &mut ctx.accounts.cdp;
    cdp.debt_amount = 0;
    cdp.collateral_amount = cdp
        .collateral_amount
        .checked_sub(seize_amount)
        .ok_or(AuFlowError::MathOverflow)?;

    Ok(())
}
