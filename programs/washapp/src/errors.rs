use anchor_lang::prelude::*;

// Коди стабільні: нові варіанти лише в кінець — клієнт і фікстури тримають номери.
#[error_code]
pub enum WashError {
    #[msg("parameter is out of its allowed range")]
    ParameterOutOfRange,
    #[msg("arithmetic overflow")]
    Overflow,
    #[msg("tranche has shares but no assets")]
    TrancheWipedOut,
    #[msg("junior share would fall below the pool minimum")]
    SubordinationBreached,
    #[msg("vault holds less than the requested amount")]
    InsufficientLiquidity,
    #[msg("free collateral is less than the requested amount")]
    InsufficientFreeCollateral,
    #[msg("contract is not active")]
    ContractNotActive,
    #[msg("loss is below the contract trigger")]
    LossBelowTrigger,
    #[msg("loss event is outside the contract term")]
    LossOutsideTerm,
    #[msg("contract has not expired yet")]
    NotExpired,
    #[msg("signer is not allowed to do this")]
    Unauthorized,
    #[msg("amount must be greater than zero")]
    ZeroAmount,
    #[msg("faucet request exceeds the cap")]
    FaucetCapExceeded,
    #[msg("protection pool has shares but no collateral")]
    CollateralWipedOut,
}
