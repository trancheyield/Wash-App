#!/usr/bin/env bash
# Збірка ончейн-частини у WSL з репозиторію, що лежить на Windows-диску.
#
# Кликати з PowerShell, не з Git Bash:
#   wsl.exe -e bash /mnt/<диск>/<шлях до репо>/scripts/wsl-build.sh <команда>
#
# 1. Git Bash переписує аргумент виду /mnt/<диск>/... у Windows-шлях ще до того,
#    як його побачить wsl — тому виклик іде з PowerShell.
# 2. Скрипт передається файлом, не рядком через `bash -c`: лапки й долари
#    у рядку проходять два шари інтерпретації.
# 3. PATH прописаний явно: неінтерактивний shell не читає ~/.profile.

set -euo pipefail

export PATH="$HOME/.avm/bin:$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$ROOT/.build.log"
CMD="${1:-build-sbf}"
PROGRAM=washapp
SO="target/deploy/washapp.so"
# Ключ програми — поза репозиторієм: за замовчуванням у домашній теці WSL,
# інше місце — через змінну оточення.
KEYS="${WASH_PROGRAM_KEYPAIR:-$HOME/.config/washapp/washapp-keypair.json}"

cd "$ROOT"

# Увесь вивід іде у файл зсередини скрипта: прогрес-бар cargo перезаписує
# рядок кареткою, і при зовнішньому перенаправленні причини падіння у файлі
# не лишається.
run() {
  echo "── $* ──" >>"$LOG"
  if ! "$@" >>"$LOG" 2>&1; then
    echo "ПОМИЛКА: $*"
    echo "── останні 40 рядків $LOG ──"
    tail -40 "$LOG"
    exit 1
  fi
}

# `anchor build` без ключа згенерував би новий і мовчки розійшовся з declare_id!.
sync_keypair() {
  mkdir -p target/deploy
  if [[ -f "$KEYS" ]]; then
    cp "$KEYS" target/deploy/washapp-keypair.json
  fi
}

# Артефакт у мережу — SBPFv0. `anchor build` пише v3 (`e_flags = 3`), який
# Agave 3.1.10 не запускає; перевіряємо заголовок, а не вірю команді збірки.
check_v0() {
  local flags
  flags="$(readelf -h "$SO" | awk '/Flags:/ {print $2}')"
  if [[ "$flags" != "0x0" ]]; then
    echo "ПОМИЛКА: $SO має e_flags=$flags, очікувалось 0x0 (SBPFv0)"
    exit 1
  fi
}

# Кадр `try_accounts` під v0 — 4 КіБ, і збірка про це каже рядком, не помилкою.
check_frame() {
  if grep -qE 'overwrites values in the frame|exceeded max offset' "$LOG"; then
    echo "ПОМИЛКА: переповнення кадру стека (див. $LOG):"
    grep -E 'overwrites values in the frame|exceeded max offset' "$LOG" | head -5
    exit 1
  fi
}

: >"$LOG"

echo "anchor:  $(anchor --version)"
echo "solana:  $(solana --version)"
echo "sbf:     $(cargo-build-sbf --version | head -1)"
echo "лог:     $LOG"
echo

case "$CMD" in
  build-sbf)
    # cargo-build-sbf без ключа в target/deploy генерує випадковий — і деплой
    # пішов би не під declare_id!.
    sync_keypair
    run cargo-build-sbf --manifest-path "programs/$PROGRAM/Cargo.toml"
    check_frame
    check_v0
    echo "OK — $SO: $(stat -c %s "$SO") байтів, SBPFv0"
    ;;
  idl)
    sync_keypair
    run anchor build
    echo "OK — IDL у target/idl/washapp.json"
    echo "УВАГА: anchor build перезаписав $SO артефактом v3 — перед test/деплоєм: $0 build-sbf"
    ;;
  build)
    # anchor build пише v3 у той самий target/deploy — SBF-збірка йде останньою.
    "$0" idl
    "$0" build-sbf
    ;;
  fmt)
    run cargo fmt --all
    echo "OK — формат вирівняний"
    ;;
  fmt-check)
    run cargo fmt --all --check
    echo "OK — формат чистий"
    ;;
  clippy)
    run cargo clippy --workspace --all-targets -- -D warnings
    echo "OK — clippy чистий"
    ;;
  test)
    if [[ ! -f "$SO" ]]; then
      echo "немає $SO — спершу: $0 build-sbf" >&2
      exit 1
    fi
    check_v0
    run cargo test --workspace
    echo "OK — тести пройшли"
    ;;
  fixtures)
    # Генератори фікстур — тести під `#[ignore]` (pda.json, accounts/*.json,
    # waterfall.json): результат комітиться і звіряється з TS-боку.
    if [[ ! -f "$SO" ]]; then
      echo "немає $SO — спершу: $0 build-sbf" >&2
      exit 1
    fi
    run cargo test --workspace -- --ignored
    echo "OK — фікстури перегенеровано (git status покаже, що змінилось)"
    ;;
  gate)
    "$0" fmt-check
    "$0" clippy
    "$0" build-sbf
    "$0" test
    ;;
  *)
    echo "невідома команда: $CMD (build-sbf | idl | build | fmt | fmt-check | clippy | test | fixtures | gate)" >&2
    exit 2
    ;;
esac
