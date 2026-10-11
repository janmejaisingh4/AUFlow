use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;
pub mod utils;

pub use instructions::*;

declare_id!("4oAhHznC9vvn8bgEHE1qahGx3a4etjsWCTyP6EXDpbuZ");

#[program]
pub mod auflow {
    use super::*;

    /// REQ01: Bootstrap global protocol parameters and config PDA.
    pub fn initialize_protocol(
        ctx: Context<InitializeProtocol>,
        auditor_pubkey: Pubkey,
    ) -> Result<()> {
        process_initialize_protocol(ctx, auditor_pubkey)
    }

    /// REQ03: Auditor attestation of vault weight + merkle root (Proof-of-Reserve).
    pub fn update_reserve_oracle(
        ctx: Context<UpdateReserveOracle>,
        metal_type: u8,
        total_weight_grams: u64,
        merkle_root: [u8; 32],
    ) -> Result<()> {
        process_update_reserve_oracle(ctx, metal_type, total_weight_grams, merkle_root)
    }

    /// REQ02: Mint Token-2022 commodity tokens against on-chain reserve caps.
    pub fn mint_commodity_token(
        ctx: Context<MintCommodityToken>,
        metal_type: u8,
        amount: u64,
    ) -> Result<()> {
        process_mint_commodity_token(ctx, metal_type, amount)
    }

    /// REQ04: Open CDP — deposit collateral and borrow stablecoins atomically.
    pub fn open_cdp_position(
        ctx: Context<OpenCdpPosition>,
        metal_type: u8,
        collateral_amount: u64,
        debt_amount: u64,
    ) -> Result<()> {
        process_open_cdp_position(ctx, metal_type, collateral_amount, debt_amount)
    }

    /// REQ05: Liquidate undercollateralized CDP using live Pyth pricing.
    pub fn liquidate_cdp(ctx: Context<LiquidateCdp>) -> Result<()> {
        process_liquidate_cdp(ctx)
    }
}
