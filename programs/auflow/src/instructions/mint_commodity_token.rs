use anchor_lang::prelude::*;
use anchor_spl::token_2022::{self, MintTo, Token2022};
use anchor_spl::token_interface::{Mint, TokenAccount};

use crate::constants::MINT_AUTHORITY_SEED;
use crate::error::AuFlowError;
use crate::state::{GlobalConfig, ReserveState};
use crate::utils::validate_metal_type;

#[derive(Accounts)]
#[instruction(metal_type: u8)]
pub struct MintCommodityToken<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(seeds = [crate::constants::CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, GlobalConfig>,

    #[account(
        seeds = [crate::constants::RESERVE_SEED, &[metal_type]],
        bump = reserve.bump,
    )]
    pub reserve: Account<'info, ReserveState>,

    /// Commodity mint (Token-2022), authority = mint_authority PDA.
    #[account(
        mut,
        mint::token_program = token_program,
    )]
    pub commodity_mint: InterfaceAccount<'info, Mint>,

    /// CHECK: PDA mint authority (`[b"mint", metal_type]`) signer for mint_to CPI.
    #[account(
        seeds = [MINT_AUTHORITY_SEED, &[metal_type]],
        bump,
    )]
    pub mint_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        token::mint = commodity_mint,
        token::authority = user,
        token::token_program = token_program,
    )]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Program<'info, Token2022>,
}

pub fn process_mint_commodity_token(
    ctx: Context<MintCommodityToken>,
    metal_type: u8,
    amount: u64,
) -> Result<()> {
    require!(amount > 0, AuFlowError::ZeroAmount);
    validate_metal_type(metal_type)?;

    let reserve = &ctx.accounts.reserve;
    let mint = &ctx.accounts.commodity_mint;

    let new_supply = mint
        .supply
        .checked_add(amount)
        .ok_or(AuFlowError::MathOverflow)?;
    require!(
        new_supply <= reserve.total_weight_grams,
        AuFlowError::ExceedsVaultReserves
    );

    let seeds = &[MINT_AUTHORITY_SEED, &[metal_type], &[ctx.bumps.mint_authority]];
    let signer = &[&seeds[..]];

    token_2022::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.commodity_mint.to_account_info(),
                to: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.mint_authority.to_account_info(),
            },
            signer,
        ),
        amount,
    )?;

    Ok(())
}
