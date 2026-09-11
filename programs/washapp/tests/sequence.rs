// SC-002 у SVM: 100 сідованих послідовностей deposit/redeem/accrue/record_loss
// двох вкладників із warp між кроками; після кожного кроку — `assert_pool_invariant`
// (`assets == senior + junior == vault.amount`) і збереження демо-токена
// (усі гаманці + vault + treasury == supply демо-мінта). Крок «збиток» іде
// після окремого `accrue` в тому самому слоті, тож стан до збитку видно, і
// SC-003 звіряється байт у байт (T024). Відмови (мінімум junior, пил,
// вичерпаний транш, нульовий збиток) — частина сценарію: стан після них не
// зсувається, а частка застосованих кроків тримається сторожем, щоб тест не
// зеленів на самих відмовах.
mod common;

use common::{
    accrue, assert_pool_invariant, ata, deposit, fund_user, loss_event_state, mint_supply,
    open_tranche_atas, pda, pool_session, pool_state, record_loss, redeem, token_amount,
    ConfigSetup, PoolSetup, Session, GENESIS_TS, OPERATOR, USER_A, USER_B,
};
use mollusk_svm::result::Check;
use solana_pubkey::Pubkey;
use washapp::math::{loss_amount, Tranche};

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

#[derive(Default)]
struct Tally {
    applied: u64,
    total: u64,
    losses_on_junior: u64,
    losses_into_senior: u64,
}

// SC-003 на живому пулі: `accrue` того самого слоту робить стан до збитку
// видимим, `record_loss` далі не нараховує нічого (elapsed = 0).
fn loss_step(
    session: &mut Session,
    s: &ConfigSetup,
    p: &PoolSetup,
    rng: &mut Rng,
    tally: &mut Tally,
) -> bool {
    session.run(&accrue(s, p), &[Check::success()]);
    let before = pool_state(&session.snapshot(), &p.pool);
    let loss_bps = rng.below(2_500) as u16 + 1;
    let ix = record_loss(session, s, p, OPERATOR, loss_bps);
    if session.run(&ix, &[]).raw_result.is_err() {
        // Єдина відмова тут — нульовий збиток на порожньому чи пиловому пулі.
        assert_eq!(loss_amount(before.assets, loss_bps).unwrap(), 0);
        return false;
    }
    let after = session.snapshot();
    let pool = pool_state(&after, &p.pool);
    let event = loss_event_state(&after, &pda::loss_event(&p.pool, before.loss_count).0);
    let amount = loss_amount(before.assets, loss_bps).unwrap();
    assert_eq!(event.amount, amount);
    assert_eq!(event.assets_before, before.assets);
    assert_eq!(event.junior_loss + event.senior_loss, amount);
    assert_eq!(pool.loss_count, before.loss_count + 1);
    if amount <= before.junior_assets {
        assert_eq!(
            pool.senior_assets, before.senior_assets,
            "senior зачеплено при L ≤ junior"
        );
        assert_eq!(pool.junior_assets, before.junior_assets - amount);
        tally.losses_on_junior += 1;
    } else {
        assert_eq!(pool.junior_assets, 0);
        assert_eq!(
            pool.senior_assets,
            before.senior_assets - (amount - before.junior_assets)
        );
        tally.losses_into_senior += 1;
    }
    true
}

fn step(
    session: &mut Session,
    s: &ConfigSetup,
    p: &PoolSetup,
    rng: &mut Rng,
    user: Pubkey,
    tally: &mut Tally,
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
    let ix = match rng.below(6) {
        0 => accrue(s, p),
        1 => return loss_step(session, s, p, rng, tally),
        2 | 3 => {
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
    let mut tally = Tally::default();
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
            if step(&mut session, &s, &p, &mut rng, user, &mut tally) {
                tally.applied += 1;
            }
            tally.total += 1;
            assert_pool_invariant(&session.snapshot(), &p.pool);
            assert_conservation(&session, &s, &p);
        }
    }
    // Сторож: тест не має сенсу, якщо майже всі кроки — відмови або якщо
    // котрась гілка waterfall жодного разу не спрацювала.
    let share = tally.applied * 100 / tally.total;
    println!(
        "застосовано {} із {} кроків ({share} %); збитків на junior {}, до senior {}",
        tally.applied, tally.total, tally.losses_on_junior, tally.losses_into_senior
    );
    assert!(share >= 40, "лише {share} % кроків застосовано");
    assert!(
        tally.losses_on_junior >= 50,
        "гілка L ≤ junior майже не траплялась"
    );
    assert!(
        tally.losses_into_senior >= 10,
        "гілка L > junior майже не траплялась"
    );
}
