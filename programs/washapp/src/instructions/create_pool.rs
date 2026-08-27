use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::{
    DEMO_MINT_DECIMALS, JUNIOR_MINT_SEED, MAX_BPS, MAX_TIME_SCALE, SENIOR_MINT_SEED, VAULT_SEED,
};
use crate::errors::WashError;
use crate::state::{Config, Pool};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct PoolParams {
    pub yield_rate_bps: u16,
    pub senior_rate_bps: u16,
    pub min_junior_bps: u16,
    pub perf_fee_bps: u16,
    pub time_scale: u32,
}

impl PoolParams {
    // `senior_rate > yield_rate` дозволено свідомо: waterfall дає senior рівно
    // стільки, скільки покриває дохід, а решту обрізає сам.
    pub fn validate(&self) -> Result<()> {
        require!(
            self.yield_rate_bps <= MAX_BPS,
            WashError::ParameterOutOfRange
        );
        require!(
            self.senior_rate_bps <= MAX_BPS,
            WashError::ParameterOutOfRange
        );
        require!(self.perf_fee_bps <= MAX_BPS, WashError::ParameterOutOfRange);
        // Мінімум junior у 100 % заблокував би будь-який senior-депозит.
        require!(
            self.min_junior_bps < MAX_BPS,
            WashError::ParameterOutOfRange
        );
        require!(
            (1..=MAX_TIME_SCALE).contains(&self.time_scale),
            WashError::ParameterOutOfRange
        );
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(id: u16)]
pub struct CreatePool<'info> {
    // Базовий токен пулу — лише демо-мінт: дохід у `accrue` карбується під
    // підписом `Config`, з чужим мінтом він би не працював.
    #[account(
        seeds = [Config::SEED],
        bump = config.bump,
        has_one = mint,
        constraint = config.authority == operator.key() @ WashError::Unauthorized,
    )]
    pub config: Account<'info, Config>,
    pub mint: Account<'info, Mint>,
    #[account(
        init,
        payer = operator,
        space = 8 + Pool::INIT_SPACE,
        seeds = [Pool::SEED, &id.to_le_bytes()],
        bump,
    )]
    pub pool: Account<'info, Pool>,
    #[account(
        init,
        payer = operator,
        seeds = [VAULT_SEED, pool.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = pool,
    )]
    pub vault: Account<'info, TokenAccount>,
    // Транші в тих самих знаках, що й базовий токен: перша частка = 1 базова одиниця.
    #[account(
        init,
        payer = operator,
        seeds = [SENIOR_MINT_SEED, pool.key().as_ref()],
        bump,
        mint::decimals = DEMO_MINT_DECIMALS,
        mint::authority = pool,
    )]
    pub senior_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = operator,
        seeds = [JUNIOR_MINT_SEED, pool.key().as_ref()],
        bump,
        mint::decimals = DEMO_MINT_DECIMALS,
        mint::authority = pool,
    )]
    pub junior_mint: Account<'info, Mint>,
    #[account(mut)]
    pub operator: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn create_pool_handler(ctx: Context<CreatePool>, id: u16, params: PoolParams) -> Result<()> {
    params.validate()?;
    let now = Clock::get()?.unix_timestamp;
    let pool = &mut ctx.accounts.pool;
    pool.id = id;
    pool.operator = ctx.accounts.operator.key();
    pool.mint = ctx.accounts.mint.key();
    pool.vault = ctx.accounts.vault.key();
    pool.senior_mint = ctx.accounts.senior_mint.key();
    pool.junior_mint = ctx.accounts.junior_mint.key();
    pool.yield_rate_bps = params.yield_rate_bps;
    pool.senior_rate_bps = params.senior_rate_bps;
    pool.min_junior_bps = params.min_junior_bps;
    pool.perf_fee_bps = params.perf_fee_bps;
    pool.time_scale = params.time_scale;
    pool.assets = 0;
    pool.senior_assets = 0;
    pool.junior_assets = 0;
    pool.model_time = 0;
    // Модельний годинник стартує з моменту створення: перший `accrue` не
    // нараховує дохід за час до появи пулу.
    pool.last_accrued_ts = now;
    pool.loss_count = 0;
    pool.created_at = now;
    pool.bump = ctx.bumps.pool;
    Ok(())
}
