use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, Transfer as TokenTransfer};
use anchor_spl::token_2022::{self, Token2022, Transfer as Token2022Transfer};
use anchor_spl::token_interface::{Mint, TokenAccount};

use crate::constants::{CDP_SEED, POOL_AUTHORITY_SEED, VAULT_SEED};
use crate::error::AuFlowError;
use crate::state::{CdpPosition, GlobalConfig};
use crate::utils::{
    collateral_value_micro_usd, get_valid_pyth_price, ltv_bps, validate_metal_type,
};

#[derive(Accounts)]
#[instruction(metal_type: u8)]
pub struct OpenCdpPosition<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(seeds = [crate::constants::CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, GlobalConfig>>,

    #[account(
        init,
        payer = owner,
        space = 8 + CdpPosition::INIT_SPACE,
        seeds = [CDP_SEED, owner.key().as_ref(), &[metal_type]],
        bump,
    )]
    pub cdp: Box<Account<'info, CdpPosition>>,

    #[account(
        init,
        payer = owner,
        seeds = [VAULT_SEED, cdp.key().as_ref()],
        bump,
        token::mint = commodity_mint,
        token::authority = cdp,
        token::token_program = token_2022_program,
    )]
    pub collateral_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    pub commodity_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        token::mint = commodity_mint,
        token::authority = owner,
        token::token_program = token_2022_program,
    )]
    pub owner_collateral_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub stablecoin_mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: Pyth legacy price feed account validated in handler.
    pub pyth_price_feed: UncheckedAccount<'info>,

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
        token::authority = owner,
        token::token_program = token_program,
    )]
    pub owner_stablecoin_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub token_2022_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

pub fn process_open_cdp_position(
    ctx: Context<OpenCdpPosition>,
    metal_type: u8,
    collateral_amount: u64,
    debt_amount: u64,
) -> Result<()> {
    require!(collateral_amount > 0 && debt_amount > 0, AuFlowError::ZeroAmount);
    validate_metal_type(metal_type)?;

    let clock = Clock::get()?;
    let price = get_valid_pyth_price(&ctx.accounts.pyth_price_feed.to_account_info(), &clock)?;
    let collateral_value = collateral_value_micro_usd(collateral_amount, &price)?;
    let position_ltv = ltv_bps(debt_amount, collateral_value)?;

    require!(
        position_ltv <= ctx.accounts.config.max_ltv_bps as u64,
        AuFlowError::ExceedsMaxLTV
    );

    token_2022::transfer(
        CpiContext::new(
            ctx.accounts.token_2022_program.to_account_info(),
            Token2022Transfer {
                from: ctx.accounts.owner_collateral_account.to_account_info(),
                to: ctx.accounts.collateral_vault.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        ),
        collateral_amount,
    )?;

    let pool_seeds = &[POOL_AUTHORITY_SEED, &[ctx.bumps.pool_authority]];
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TokenTransfer {
                from: ctx.accounts.liquidity_pool.to_account_info(),
                to: ctx.accounts.owner_stablecoin_account.to_account_info(),
                authority: ctx.accounts.pool_authority.to_account_info(),
            },
            &[pool_seeds],
        ),
        debt_amount,
    )?;

    let cdp = &mut ctx.accounts.cdp;
    cdp.owner = ctx.accounts.owner.key();
    cdp.metal_type = metal_type;
    cdp.collateral_amount = collateral_amount;
    cdp.debt_amount = debt_amount;
    cdp.bump = ctx.bumps.cdp;

    Ok(())
}
