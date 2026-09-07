#!/usr/bin/env bash
# Деплой і перевірка програми на devnet із WSL. Кликати з PowerShell (див. wsl-build.sh):
#   wsl.exe -e bash /mnt/<диск>/<шлях до репо>/scripts/wsl-deploy.sh <deploy|verify|status>
#
# deploy  — заливає target/deploy/washapp.so (лише SBPFv0) під declare_id! програми;
#           upgrade authority — окремий ключ поза репо, створюється за потреби.
# verify  — байткод у мережі байт у байт дорівнює локальному .so і має e_flags 0x0.
# status  — `solana program show` + баланс деплоєра.
#
# RPC — SOLANA_RPC_URL із .env у корені (Helius; публічний devnet ріже деплой на
# сотнях транзакцій), інакше публічний devnet.

set -euo pipefail

export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$ROOT/.build.log"
CMD="${1:-status}"
SO="$ROOT/target/deploy/washapp.so"
KEYS_DIR="${WASH_KEYS_DIR:-$HOME/.config/washapp}"
PROGRAM_KEYPAIR="${WASH_PROGRAM_KEYPAIR:-$KEYS_DIR/washapp-keypair.json}"
DEPLOYER="${WASH_DEPLOYER_KEYPAIR:-$KEYS_DIR/devnet-deployer.json}"

url_from_env() {
  if [[ -f "$ROOT/.env" ]]; then
    sed -n 's/^SOLANA_RPC_URL=//p' "$ROOT/.env" | head -1 | tr -d '\r'
  fi
}
URL="${SOLANA_RPC_URL:-$(url_from_env)}"
URL="${URL:-devnet}"
# Ключ Helius сидить у query-рядку — у вивід іде лише хост.
URL_SHOWN="$(printf '%s' "$URL" | sed 's#\(https\?://[^/?]*\).*#\1#')"

cd "$ROOT"

run() {
  echo "── ${*//$URL/$URL_SHOWN} ──" >>"$LOG"
  if ! "$@" >>"$LOG" 2>&1; then
    echo "ПОМИЛКА: ${*//$URL/$URL_SHOWN}"
    echo "── останні 40 рядків $LOG ──"
    tail -40 "$LOG" | sed "s#$URL#$URL_SHOWN#g"
    exit 1
  fi
}

check_v0() {
  local so="$1" flags
  flags="$(readelf -h "$so" | awk '/Flags:/ {print $2}')"
  if [[ "$flags" != "0x0" ]]; then
    echo "ПОМИЛКА: $so має e_flags=$flags, очікувалось 0x0 (SBPFv0) — спершу wsl-build.sh build-sbf"
    exit 1
  fi
}

require_program_keypair() {
  if [[ ! -f "$PROGRAM_KEYPAIR" ]]; then
    echo "немає ключа програми $PROGRAM_KEYPAIR (бекап — поза репозиторієм)" >&2
    exit 1
  fi
}

# Deployer — не id.json: id.json спільний для всіх проектів на цій машині, а
# upgrade authority має жити поряд із рештою ключів проекту.
ensure_deployer() {
  if [[ ! -f "$DEPLOYER" ]]; then
    mkdir -p "$(dirname "$DEPLOYER")"
    run solana-keygen new --no-bip39-passphrase --silent --outfile "$DEPLOYER"
    echo "створено deployer $DEPLOYER"
  fi
}

# `solana rent` друкує SOL із заокругленням — беремо лампорти з JSON.
rent_lamports() {
  solana rent "$1" --url "$URL" --output json | sed -n 's/.*"rentExemptMinimumLamports": *\([0-9]*\).*/\1/p'
}

PROGRAM_ID="$(solana-keygen pubkey "$PROGRAM_KEYPAIR" 2>/dev/null || echo 2Yq39tVgTH5e8be8YdssyhvM6339f2WG6QweNmxGpBbf)"

: >"$LOG"
echo "solana:   $(solana --version)"
echo "rpc:      $URL_SHOWN"
echo "програма: $PROGRAM_ID"
echo "лог:      $LOG"
echo

case "$CMD" in
  deploy)
    require_program_keypair
    ensure_deployer
    check_v0 "$SO"
    size="$(stat -c %s "$SO")"
    # Місце під апгрейди: ProgramData фіксує довжину на весь час життя програми.
    max_len=$(( size * 3 / 2 ))
    rent="$(rent_lamports "$max_len")"
    buffer_rent="$(rent_lamports "$size")"
    balance="$(solana balance "$(solana-keygen pubkey "$DEPLOYER")" --url "$URL" --lamports | awk '{print $1}')"
    # CLI вимагає ренту буфера і ProgramData разом, хоч буфер повертається
    # deployer-у перед оплатою ProgramData; після деплою лишається лише ProgramData.
    need=$(( rent + buffer_rent + 50000000 ))
    echo "deployer: $(solana-keygen pubkey "$DEPLOYER")  $(( balance / 1000000 ))e-3 SOL"
    echo ".so:      $size байтів, max-len $max_len; рента ProgramData $(( rent / 1000000 ))e-3 SOL + буфер $(( buffer_rent / 1000000 ))e-3 SOL (повертається)"
    if (( balance < need )); then
      echo "ПОМИЛКА: на deployer $(( balance / 1000000 ))e-3 SOL, треба ≥ $(( need / 1000000 ))e-3 — faucet.solana.com або: solana airdrop 5 $(solana-keygen pubkey "$DEPLOYER") --url devnet"
      exit 1
    fi
    run solana program deploy "$SO" \
      --program-id "$PROGRAM_KEYPAIR" \
      --upgrade-authority "$DEPLOYER" \
      --keypair "$DEPLOYER" \
      --max-len "$max_len" \
      --url "$URL" \
      --commitment confirmed
    echo "OK — задеплоєно $PROGRAM_ID"
    "$0" verify
    ;;
  verify)
    check_v0 "$SO"
    dump="$(mktemp --suffix=.so)"
    run solana program dump "$PROGRAM_ID" "$dump" --url "$URL"
    size="$(stat -c %s "$SO")"
    # Дамп — увесь ProgramData, за .so ідуть нулі до max-len.
    if ! cmp -s -n "$size" "$SO" "$dump"; then
      echo "ПОМИЛКА: байткод у мережі відрізняється від $SO"
      rm -f "$dump"
      exit 1
    fi
    if tail -c +"$((size + 1))" "$dump" | tr -d '\0' | grep -q .; then
      echo "ПОМИЛКА: за межами $size байтів у ProgramData не нулі"
      rm -f "$dump"
      exit 1
    fi
    check_v0 "$dump"
    rm -f "$dump"
    echo "OK — байткод у мережі = $SO ($size байтів), SBPFv0"
    ;;
  status)
    if ! solana program show "$PROGRAM_ID" --url "$URL" 2>/dev/null | sed "s#$URL#$URL_SHOWN#g"; then
      echo "програма $PROGRAM_ID у мережі відсутня — $0 deploy"
    fi
    if [[ -f "$DEPLOYER" ]]; then
      echo "deployer: $(solana-keygen pubkey "$DEPLOYER")  $(solana balance "$(solana-keygen pubkey "$DEPLOYER")" --url "$URL")"
    else
      echo "deployer: ще не створено ($DEPLOYER)"
    fi
    ;;
  *)
    echo "usage: $0 <deploy|verify|status>" >&2
    exit 2
    ;;
esac
