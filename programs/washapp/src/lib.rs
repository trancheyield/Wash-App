use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod math;
pub mod state;

use instructions::*;

declare_id!("2Yq39tVgTH5e8be8YdssyhvM6339f2WG6QweNmxGpBbf");

#[program]
pub mod washapp {
    use super::*;

    pub fn init_config(ctx: Context<InitConfig>, faucet_cap: u64) -> Result<()> {
        instructions::init_config_handler(ctx, faucet_cap)
    }
}
