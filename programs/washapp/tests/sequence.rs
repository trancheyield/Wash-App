// SC-002 у SVM: 100 сідованих послідовностей deposit/redeem/accrue двох
// вкладників із warp між кроками; після кожного кроку — `assert_pool_invariant`
// (`assets == senior + junior == vault.amount`) і збереження демо-токена
// (усі гаманці + vault + treasury == supply демо-мінта). Відмови (мінімум
// junior, пил, вичерпаний транш) — частина сценарію: стан після них не
// зсувається, а частка застосованих кроків тримається сторожем, щоб тест не
// зеленів на самих відмовах.
mod common;

use common::{
    accrue, assert_pool_invariant, ata, deposit, fund_user, mint_supply, open_tranche_atas,
    pool_session, redeem, token_amount, ConfigSetup, PoolSetup, Session, GENESIS_TS, USER_A,
    USER_B,
};
use solana_pubkey::Pubkey;
use washapp::math::Tranche;

const SEQUENCES: u64 = 100;
const STEPS: usize = 24;
const START_BALANCE: u64 = 100_000_000_000;

// xorshift64*: детермінований генератор без залежностей — послідовність
// відтворюється за номером.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    fn below(&mut self, n: u64) -> u64 {
        if n == 0 {
            0
        } else {
            self.next() % n
        }
    }
}

fn assert_conservation(session: &Session, s: &ConfigSetup, p: &PoolSetup) {
    let after = session.snapshot();
    let held: u64 = [USER_A, USER_B]
        .iter()
        .map(|u| token_amount(&after, &ata(u, &s.mint)))
        .sum::<u64>()
        + token_amount(&after, &p.vault)
        + token_amount(&after, &s.treasury);
    assert_eq!(held, mint_supply(&after, &s.mint), "демо-токен не зберігся");
}

fn step(
    session: &mut Session,
    s: &ConfigSetup,
    p: &PoolSetup,
    rng: &mut Rng,
    user: Pubkey,
) -> bool {
    let after = session.snapshot();
    let tranche = if rng.below(2) == 0 {
        Tranche::Senior
    } else {
        Tranche::Junior
    };
    let tranche_mint = match tranche {
        Tranche::Senior => p.senior_mint,
        Tranche::Junior => p.junior_mint,
    };
    let ix = match rng.below(5) {
        0 => accrue(s, p),
        1 | 2 => {
            let balance = token_amount(&after, &ata(&user, &s.mint));
            deposit(s, p, user, tranche, rng.below(balance) + 1)
        }
        _ => {
            let shares = token_amount(&after, &ata(&user, &tranche_mint));
            redeem(s, p, user, tranche, rng.below(shares.saturating_mul(2)) + 1)
        }
    };
    session.run(&ix, &[]).raw_result.is_ok()
}

#[test]
fn random_sequences_keep_the_invariant_after_every_step() {
    let mut applied = 0u64;
    let mut total = 0u64;
    for seed in 1..=SEQUENCES {
        let (mut session, s, p) = pool_session();
        for user in [USER_A, USER_B] {
            fund_user(&mut session, &s, user, START_BALANCE);
            open_tranche_atas(&mut session, &p, user);
        }
        let mut rng = Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1);
        let mut now = GENESIS_TS;
        for i in 0..STEPS {
            now += rng.below(120) as i64 + 1;
            session.harness.warp(2 + i as u64, now);
            let user = if rng.below(2) == 0 { USER_A } else { USER_B };
            if step(&mut session, &s, &p, &mut rng, user) {
                applied += 1;
            }
            total += 1;
            assert_pool_invariant(&session.snapshot(), &p.pool);
            assert_conservation(&session, &s, &p);
        }
    }
    // Сторож: тест не має сенсу, якщо майже всі кроки — відмови.
    let share = applied * 100 / total;
    println!("застосовано {applied} із {total} кроків ({share} %)");
    assert!(share >= 40, "лише {share} % кроків застосовано");
}
