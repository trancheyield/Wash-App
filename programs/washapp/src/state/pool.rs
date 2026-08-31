use anchor_lang::prelude::*;

use crate::math::{PoolBalances, Rates, Tranche};

// Supply траншів тут не дублюється — читається з мінтів `senior_mint`/`junior_mint`.
#[account]
#[derive(InitSpace)]
pub struct Pool {
    pub id: u16,
    pub operator: Pubkey,
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub senior_mint: Pubkey,
    pub junior_mint: Pubkey,
    pub yield_rate_bps: u16,
    pub senior_rate_bps: u16,
    pub min_junior_bps: u16,
    pub perf_fee_bps: u16,
    // Модельних секунд на секунду ланцюга; 1 — звичайний час.
    pub time_scale: u32,
    pub assets: u64,
    pub senior_assets: u64,
    pub junior_assets: u64,
    pub model_time: u64,
    pub last_accrued_ts: i64,
    pub loss_count: u32,
    pub created_at: i64,
    pub bump: u8,
}

impl Pool {
    pub const SEED: &'static [u8] = crate::constants::POOL_SEED;

    pub fn tranche_mint(&self, tranche: Tranche) -> Pubkey {
        match tranche {
            Tranche::Senior => self.senior_mint,
            Tranche::Junior => self.junior_mint,
        }
    }

    pub fn rates(&self) -> Rates {
        Rates {
            yield_bps: self.yield_rate_bps,
            senior_bps: self.senior_rate_bps,
            fee_bps: self.perf_fee_bps,
        }
    }

    pub fn balances(&self, senior_supply: u64, junior_supply: u64) -> PoolBalances {
        PoolBalances {
            assets: self.assets,
            senior_assets: self.senior_assets,
            junior_assets: self.junior_assets,
            senior_supply,
            junior_supply,
        }
    }

    // Supply не пишеться: його змінюють mint/burn через CPI.
    pub fn set_balances(&mut self, next: &PoolBalances) {
        self.assets = next.assets;
        self.senior_assets = next.senior_assets;
        self.junior_assets = next.junior_assets;
    }
}
