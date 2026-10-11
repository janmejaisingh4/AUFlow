use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct ReserveState {
    pub metal_type: u8,
    pub total_weight_grams: u64,
    pub merkle_root: [u8; 32],
    pub last_updated_ts: i64,
    pub bump: u8,
}
