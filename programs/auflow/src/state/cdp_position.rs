use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct CdpPosition {
    pub owner: Pubkey,
    pub metal_type: u8,
    pub collateral_amount: u64,
    pub debt_amount: u64,
    pub bump: u8,
}
