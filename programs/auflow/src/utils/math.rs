use anchor_lang::prelude::*;
use pyth_sdk_solana::Price;

use crate::constants::{BPS_DENOMINATOR, STABLECOIN_DECIMALS};
use crate::error::AuFlowError;

/// Collateral amount is in gram base units (token decimals = 0). Returns value in stablecoin
/// micro-units (6 decimals) using the Pyth USD price.
pub fn collateral_value_micro_usd(collateral_amount: u64, price: &Price) -> Result<u128> {
    if collateral_amount == 0 {
        return Ok(0);
    }

    let amount = collateral_amount as u128;
    let price_abs = price.price.unsigned_abs() as u128;

    // value_micro = amount * |price| * 10^(expo + STABLECOIN_DECIMALS)
    let exp = price.expo as i32 + STABLECOIN_DECIMALS as i32;

    let product = amount
        .checked_mul(price_abs)
        .ok_or(AuFlowError::MathOverflow)?;

    scale_by_exponent(product, exp)
}

fn scale_by_exponent(value: u128, exp: i32) -> Result<u128> {
    if exp >= 0 {
        let factor = pow10(exp as u32)?;
        value
            .checked_mul(factor)
            .ok_or(AuFlowError::MathOverflow.into())
    } else {
        let factor = pow10((-exp) as u32)?;
        Ok(value / factor)
    }
}

fn pow10(n: u32) -> Result<u128> {
    10u128
        .checked_pow(n)
        .ok_or(AuFlowError::MathOverflow.into())
}

/// LTV in basis points: debt_micro / collateral_value_micro * 10_000
pub fn ltv_bps(debt_micro: u64, collateral_value_micro: u128) -> Result<u64> {
    if debt_micro == 0 {
        return Ok(0);
    }
    require!(collateral_value_micro > 0, AuFlowError::InvalidOraclePrice);

    let debt = debt_micro as u128;
    let ltv = debt
        .checked_mul(BPS_DENOMINATOR)
        .and_then(|v| v.checked_div(collateral_value_micro))
        .ok_or(AuFlowError::MathOverflow)?;

    u64::try_from(ltv).map_err(|_| AuFlowError::MathOverflow.into())
}

/// Inverse of [`collateral_value_micro_usd`]: stablecoin micro-units to gram base units.
pub fn collateral_amount_from_micro_usd(value_micro: u128, price: &Price) -> Result<u64> {
    if value_micro == 0 {
        return Ok(0);
    }

    let price_abs = price.price.unsigned_abs() as u128;
    require!(price_abs > 0, AuFlowError::InvalidOraclePrice);

    let exp = price.expo as i32 + STABLECOIN_DECIMALS as i32;

    let mut numerator = value_micro;
    if exp >= 0 {
        let factor = pow10(exp as u32)?;
        numerator = numerator
            .checked_mul(factor)
            .ok_or(AuFlowError::MathOverflow)?;
    } else {
        let factor = pow10((-exp) as u32)?;
        numerator /= factor;
    }

    let amount = numerator
        .checked_div(price_abs)
        .ok_or(AuFlowError::MathOverflow)?;

    u64::try_from(amount).map_err(|_| AuFlowError::MathOverflow.into())
}

pub fn validate_metal_type(metal_type: u8) -> Result<()> {
    require!(
        metal_type == crate::constants::METAL_AUGOLD
            || metal_type == crate::constants::METAL_AUSILVER,
        AuFlowError::InvalidMetalType
    );
    Ok(())
}
