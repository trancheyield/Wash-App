# Wash App

Structured credit on Solana: a deposit into a lending pool is sliced into a **senior**
tranche with a capped, predictable yield and a **junior** tranche that takes the residual
yield and absorbs losses first. A separate **loss-protection** market lets anyone buy or
sell cover against a loss event in a specific pool, settled automatically on chain.

The lending pool in this repository is a simulation (yield accrues at a configured rate
on a scaled model clock; loss events are recorded by the pool operator). Integration with
external lending protocols is out of scope.

## Layout

- `programs/washapp` — Anchor program: pool, tranches, waterfall, protection market
- `packages/chain` — Codama-generated client on `@solana/kit`, PDAs, readers, builders
- `packages/shared` — waterfall math mirror, formatting, form schemas
- `apps/web` — React SPA (pool page, positions, protection, operator panel)
- `tools/demo` — devnet init and the scripted scenario: deposit → yield → loss → redeem (payout arrives with the protection market)

## Commands

```bash
pnpm install
pnpm gate            # biome + tsc + vitest across the workspace
pnpm dev             # web on :5173
pnpm demo:init       # devnet: config, demo mint and pool 0 (idempotent)
pnpm demo:scenario   # devnet: fresh wallet → faucet → deposits → 60 s → accrue → loss → redeem, timings to fixtures/demo-run.json
```

Both demo commands read `SOLANA_RPC_URL` and `WASH_KEYS_DIR` from `.env` (see `.env.example`);
the operator and deployer keypairs live outside the repository.

On-chain (WSL, from PowerShell):

```
wsl.exe -e bash <repo>/scripts/wsl-build.sh gate      # fmt-check, clippy, build-sbf, tests
wsl.exe -e bash <repo>/scripts/wsl-deploy.sh deploy   # devnet
```

The network artifact is built with `cargo-build-sbf` (SBPFv0); `anchor build` is used
only to emit the IDL for `pnpm codama`.
