use anchor_lang::prelude::*;
use pyth_sdk_solana::state::{load_price_account, PriceStatus, SolanaPriceAccount};
use pyth_sdk_solana::Price;

use crate::constants::MAX_ORACLE_AGE_SECS;
use crate::error::AuFlowError;

/// Loads and validates a Pyth legacy price feed account.
pub fn get_valid_pyth_price(
    price_account: &AccountInfo,
    clock: &Clock,
) -> Result<Price> {
    let data = price_account
        .try_borrow_data()
        .map_err(|_| error!(AuFlowError::InvalidOraclePrice))?;

    let price_feed: &SolanaPriceAccount =
        load_price_account(&data).map_err(|_| error!(AuFlowError::InvalidOraclePrice))?;

    let current_price = if price_feed.agg.status == PriceStatus::Trading {
        Price {
            conf: price_feed.agg.conf,
            expo: price_feed.expo,
            price: price_feed.agg.price,
            publish_time: price_feed.timestamp,
        }
    } else {
        Price {
            conf: price_feed.prev_conf,
            expo: price_feed.expo,
            price: price_feed.prev_price,
            publish_time: price_feed.prev_timestamp,
        }
    };

    require!(current_price.price > 0, AuFlowError::InvalidOraclePrice);
    require!(
        clock.unix_timestamp.saturating_sub(current_price.publish_time)
            <= MAX_ORACLE_AGE_SECS as i64,
        AuFlowError::InvalidOraclePrice
    );

    Ok(current_price)
}
