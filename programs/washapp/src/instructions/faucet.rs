use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount};

use crate::errors::WashError;
use crate::state::Config;

#[derive(Accounts)]
pub struct Faucet<'info> {
    #[account(seeds = [Config::SEED], bump = config.bump, has_one = mint)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub mint: Account<'info, Mint>,
    // ATA створюється тут же: перший крок демо — порожній гаманець.
    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = mint,
        associated_token::authority = owner,
    )]
    pub owner_ata: Account<'info, TokenAccount>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn faucet_handler(ctx: Context<Faucet>, amount: u64) -> Result<()> {
    require!(amount > 0, WashError::ZeroAmount);
    require!(
        amount <= ctx.accounts.config.faucet_cap,
        WashError::FaucetCapExceeded
    );
    let bump = [ctx.accounts.config.bump];
    let signer: &[&[&[u8]]] = &[&[Config::SEED, &bump]];
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.owner_ata.to_account_info(),
                authority: ctx.accounts.config.to_account_info(),
            },
            signer,
        ),
        amount,
    )
}
