pub const CONFIG_SEED: &[u8] = b"config";
pub const RESERVE_SEED: &[u8] = b"reserve";
pub const MINT_AUTHORITY_SEED: &[u8] = b"mint";
pub const CDP_SEED: &[u8] = b"cdp";
pub const VAULT_SEED: &[u8] = b"vault";
pub const POOL_AUTHORITY_SEED: &[u8] = b"pool";

pub const DEFAULT_MAX_LTV_BPS: u16 = 7_500;
pub const DEFAULT_LIQUIDATION_THRESHOLD_BPS: u16 = 8_500;
pub const DEFAULT_LIQUIDATION_BONUS_BPS: u16 = 500;

pub const METAL_AUGOLD: u8 = 0;
pub const METAL_AUSILVER: u8 = 1;

pub const BPS_DENOMINATOR: u128 = 10_000;

/// Maximum age of a Pyth price update (seconds).
pub const MAX_ORACLE_AGE_SECS: u64 = 60;

/// Stablecoin assumed 6 decimal places (micro-USD units).
pub const STABLECOIN_DECIMALS: u32 = 6;
