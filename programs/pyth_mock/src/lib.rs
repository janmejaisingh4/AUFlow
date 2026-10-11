use anchor_lang::prelude::*;

declare_id!("FQe9htidwUatxPXqwXEe1g1943AmjCjHnSxgNe9zVd2C");

const FEED_SIZE: usize = 3312;
const MAGIC: u32 = 0xa1b2c3d4;
const VERSION: u32 = 2;
const ACCOUNT_TYPE_PRICE: u32 = 3;
const OFF_EXPO: usize = 20;
const OFF_TIMESTAMP: usize = 96;
const OFF_AGG_PRICE: usize = 208;
const OFF_AGG_STATUS: usize = 224;
const PRICE_STATUS_TRADING: u8 = 1;

#[program]
pub mod pyth_mock {
    use super::*;

    pub fn init_feed(ctx: Context<InitFeed>) -> Result<()> {
        let mut data = ctx.accounts.feed.try_borrow_mut_data()?;
        require!(data.len() >= FEED_SIZE, PythMockError::InvalidSize);
        data.fill(0);
        write_header(&mut data[..]);
        Ok(())
    }

    pub fn set_price(ctx: Context<SetPrice>, price: i64, expo: i32) -> Result<()> {
        let clock = Clock::get()?;
        let mut data = ctx.accounts.feed.try_borrow_mut_data()?;
        require!(data.len() >= FEED_SIZE, PythMockError::InvalidSize);
        write_header(&mut data[..]);
        data[OFF_EXPO..OFF_EXPO + 4].copy_from_slice(&expo.to_le_bytes());
        data[OFF_TIMESTAMP..OFF_TIMESTAMP + 8]
            .copy_from_slice(&clock.unix_timestamp.to_le_bytes());
        data[OFF_AGG_PRICE..OFF_AGG_PRICE + 8].copy_from_slice(&price.to_le_bytes());
        data[OFF_AGG_STATUS] = PRICE_STATUS_TRADING;
        Ok(())
    }
}

fn write_header(data: &mut [u8]) {
    data[0..4].copy_from_slice(&MAGIC.to_le_bytes());
    data[4..8].copy_from_slice(&VERSION.to_le_bytes());
    data[8..12].copy_from_slice(&ACCOUNT_TYPE_PRICE.to_le_bytes());
}

#[derive(Accounts)]
pub struct InitFeed<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = FEED_SIZE,
        seeds = [b"feed", payer.key().as_ref()],
        bump,
    )]
    /// CHECK: raw legacy Pyth layout bytes
    pub feed: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetPrice<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"feed", authority.key().as_ref()],
        bump,
    )]
    /// CHECK: raw legacy Pyth layout bytes
    pub feed: UncheckedAccount<'info>,
}

#[error_code]
pub enum PythMockError {
    #[msg("Feed account must be 3312 bytes.")]
    InvalidSize,
}
