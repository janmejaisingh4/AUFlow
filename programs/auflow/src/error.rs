use anchor_lang::prelude::*;

#[error_code]
pub enum AuFlowError {
    #[msg("Unauthorized admin/auditor key.")]
    Unauthorized,
    #[msg("Requested loan exceeds maximum allowed LTV ratio.")]
    ExceedsMaxLTV,
    #[msg("Position is healthily collateralized and cannot be liquidated.")]
    PositionHealthy,
    #[msg("Stale or invalid oracle price feed.")]
    InvalidOraclePrice,
    #[msg("Unbacked mint request: exceeds physical vault reserves.")]
    ExceedsVaultReserves,
    #[msg("Invalid metal type.")]
    InvalidMetalType,
    #[msg("Arithmetic overflow.")]
    MathOverflow,
    #[msg("Zero collateral or debt amount.")]
    ZeroAmount,
}
