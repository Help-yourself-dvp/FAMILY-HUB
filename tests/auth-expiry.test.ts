/**
 * Срок действия ключа: факт от GitHub, а не наша оценка.
 *
 * Дефект до 0.1.4: приложение всегда показывало «оценка истечения: +365 дней», хотя
 * владелец при создании ключа выбрал «No expiration» — дата врала. Теперь срок берётся
 * из заголовка `github-authentication-token-expiration`, а его отсутствие означает
 * бессрочный ключ.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { PatAuthStrategy } from '../src/data/remote/authStrategy';

const TOKEN = 'github_pat_11TEST_abcdefghijklmnopqrstuvwxyz';

beforeEach(async () => {
  await new PatAuthStrategy().clear();
});

describe('PatAuthStrategy: срок ключа', () => {
  it('сразу после вставки срок НЕ выдумывается: он неизвестен', async () => {
    const a = new PatAuthStrategy();
    await a.setToken(TOKEN);
    const d = await a.describe();
    expect(d.kind).toBe('pat');
    expect(d.expiresAt).toBeNull();
    expect(d.neverExpires).toBe(false);
    expect(d.expiresIsEstimate).toBe(true); // «ещё не спросили GitHub»
    expect(d.daysLeft).toBeNull();
  });

  it('заголовок GitHub с датой становится фактом, а не оценкой', async () => {
    const a = new PatAuthStrategy();
    await a.setToken(TOKEN);
    await a.noteTokenExpiration('2027-05-01 00:00:00 UTC');
    const d = await a.describe();
    expect(d.expiresAt).toBe('2027-05-01T00:00:00.000Z');
    expect(d.neverExpires).toBe(false);
    expect(d.expiresIsEstimate).toBe(false);
    expect(d.daysLeft).toBeGreaterThan(100);
  });

  it('отсутствие заголовка = ключ бессрочный', async () => {
    const a = new PatAuthStrategy();
    await a.setToken(TOKEN);
    await a.noteTokenExpiration(null);
    const d = await a.describe();
    expect(d.neverExpires).toBe(true);
    expect(d.expiresAt).toBeNull();
    expect(d.daysLeft).toBeNull();
  });

  it('повторные ответы с тем же заголовком не ломают состояние', async () => {
    const a = new PatAuthStrategy();
    await a.setToken(TOKEN);
    await a.noteTokenExpiration(null);
    await a.noteTokenExpiration(null);
    expect((await a.describe()).neverExpires).toBe(true);
  });

  it('бессрочный ключ позже может оказаться срочным (замена ключа на сервере)', async () => {
    const a = new PatAuthStrategy();
    await a.setToken(TOKEN);
    await a.noteTokenExpiration(null);
    await a.noteTokenExpiration('2026-12-31 23:59:59 UTC');
    const d = await a.describe();
    expect(d.expiresAt).toBe('2026-12-31T23:59:59.000Z');
    expect(d.neverExpires).toBe(false);
  });

  it('явно указанный пользователем срок — факт с самого начала', async () => {
    const a = new PatAuthStrategy();
    await a.setToken(TOKEN, '2028-01-02T03:04:05.000Z');
    const d = await a.describe();
    expect(d.expiresAt).toBe('2028-01-02T03:04:05.000Z');
    expect(d.expiresIsEstimate).toBe(false);
  });

  it('очистка стирает всё, включая срок', async () => {
    const a = new PatAuthStrategy();
    await a.setToken(TOKEN);
    await a.noteTokenExpiration('2027-05-01 00:00:00 UTC');
    await a.clear();
    const d = await a.describe();
    expect(d.kind).toBe('none');
    expect(d.expiresAt).toBeNull();
  });

  it('мусорный заголовок не роняет и не портит состояние', async () => {
    const a = new PatAuthStrategy();
    await a.setToken(TOKEN);
    await a.noteTokenExpiration('когда-нибудь');
    const d = await a.describe();
    // Не ISO-дата → игнорируем: срок остаётся неизвестным, а не «NaN».
    expect(d.expiresAt).toBeNull();
    expect(d.neverExpires).toBe(false);
  });
});
