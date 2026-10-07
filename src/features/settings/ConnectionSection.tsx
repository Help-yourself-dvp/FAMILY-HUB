/**
 * Настройки · подключение к семейному репозиторию, инструкция и код для второго телефона.
 *
 * Семейная модель доступа (ревизия решения 2026-10-01 по просьбе владельца):
 * аккаунт GitHub создаёт только тот, кто заводит семейное хранилище. Остальные
 * члены семьи подключаются КОДОМ, сгенерированным на первом телефоне: аккаунт им
 * не нужен вовсе. Код = владелец + репозиторий + ветка + семейный ключ.
 */
import { useEffect, useState } from 'react';
import { kvGet, KV_KEYS } from '../../data/db';
import { auth, type AuthDescription } from '../../data/remote/authStrategy';
import { GitHubClient } from '../../data/remote/githubClient';
import { encodeSetupCode, parseSetupCode, SetupCodeError } from '../../data/remote/setupCode';
import { syncNow } from '../../data/sync/engine';
import { useSyncState } from '../../app/hooks';
import { setRemoteConfig, clearRemoteConfig } from '../../app/bootstrap';
import { Icon, Banner, Field, Sheet } from '../../design/ui';
import { describeError } from './helpers';

interface Cfg {
  owner: string;
  repo: string;
  branch: string;
}

export default function ConnectionSection() {
  const sync = useSyncState();
  const [owner, setOwner] = useState('');
  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState('main');
  const [token, setToken] = useState('');
  const [savedToken, setSavedToken] = useState(false);
  const [desc, setDesc] = useState<AuthDescription | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  // ---- код подключения для второго устройства ----
  const [codeOpen, setCodeOpen] = useState(false);
  const [code, setCode] = useState('');
  const [codeCopied, setCodeCopied] = useState(false);
  const [codeInput, setCodeInput] = useState('');

  useEffect(() => {
    void (async () => {
      setOwner((await kvGet<string>(KV_KEYS.remoteOwner)) ?? '');
      setRepo((await kvGet<string>(KV_KEYS.remoteRepo)) ?? '');
      setBranch((await kvGet<string>(KV_KEYS.remoteBranch)) ?? 'main');
      const d = await auth.current().describe();
      setSavedToken(d.kind !== 'none');
      setDesc(d);
    })();
  }, []);

  // Чистое инлайн-выражение: вызов методов класса при рендере линтер считает небезопасным
  const trimmedToken = token.trim();
  const classicToken =
    trimmedToken.length > 0 && (trimmedToken.startsWith('ghp_') || trimmedToken.startsWith('gho_'));

  /** Общая часть подключения: проверка ключа, приватности репозитория, запуск синхронизации. */
  const verifyAndConnect = async (cfg: Cfg): Promise<void> => {
    await setRemoteConfig(cfg.owner, cfg.repo, cfg.branch);

    const client = new GitHubClient(cfg, () => auth.getToken());
    const user = await client.verifyToken();
    const repoInfo = await client.verifyRepo();

    if (!repoInfo.private) {
      setResult({
        tone: 'err',
        text: `Репозиторий ${cfg.owner}/${cfg.repo} ПУБЛИЧНЫЙ. Семейные данные должны лежать в приватном репозитории.`,
      });
      return;
    }

    setSavedToken(true);
    const d = await auth.current().describe();
    setDesc(d);
    setResult({
      tone: 'ok',
      text: `Подключено: ${user.login} → ${cfg.owner}/${cfg.repo} (${repoInfo.defaultBranch}). Можно синхронизироваться.`,
    });
    await syncNow('after-connect');
  };

  const connect = async () => {
    setBusy(true);
    setResult(null);
    try {
      if (!owner.trim() || !repo.trim()) {
        setResult({ tone: 'err', text: 'Укажите владельца и название репозитория' });
        return;
      }
      if (token.trim()) {
        await auth.current().setToken(token.trim());
        setToken('');
      }
      const t = await auth.getToken();
      if (!t) {
        setResult({
          tone: 'err',
          text: 'Нет ключа доступа. Вставьте токен, вставьте код или откройте инструкцию.',
        });
        return;
      }
      await verifyAndConnect({
        owner: owner.trim(),
        repo: repo.trim(),
        branch: branch.trim() || 'main',
      });
    } catch (e) {
      setResult({ tone: 'err', text: describeError(e) });
    } finally {
      setBusy(false);
    }
  };

  const connectByCode = async () => {
    setBusy(true);
    setResult(null);
    try {
      const payload = parseSetupCode(codeInput);
      await auth.current().setToken(payload.token);
      setOwner(payload.owner);
      setRepo(payload.repo);
      setBranch(payload.branch);
      setCodeInput('');
      await verifyAndConnect(payload);
    } catch (e) {
      setResult({
        tone: 'err',
        text: e instanceof SetupCodeError ? e.message : describeError(e),
      });
    } finally {
      setBusy(false);
    }
  };

  const makeCode = async () => {
    setResult(null);
    try {
      const t = await auth.getToken();
      if (!t || !owner.trim() || !repo.trim()) {
        setResult({
          tone: 'err',
          text: 'Сначала подключите синхронизацию: код составляется из рабочего подключения.',
        });
        return;
      }
      setCode(
        encodeSetupCode({
          owner: owner.trim(),
          repo: repo.trim(),
          branch: branch.trim() || 'main',
          token: t,
        }),
      );
      setCodeOpen(true);
      setCodeCopied(false);
    } catch (e) {
      setResult({ tone: 'err', text: describeError(e) });
    }
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCodeCopied(true);
    } catch {
      // Буфер обмена может быть закрыт браузером (несecure-контекст, разрешения).
      setResult({
        tone: 'err',
        text: 'Браузер не дал скопировать. Выделите код ниже и скопируйте вручную.',
      });
    }
  };

  const disconnect = async () => {
    if (!window.confirm('Отключить синхронизацию? Локальные данные останутся на устройстве.'))
      return;
    await auth.current().clear();
    await clearRemoteConfig();
    setSavedToken(false);
    setDesc(await auth.current().describe());
    setCodeOpen(false);
    setCode('');
    setResult({
      tone: 'ok',
      text: 'Синхронизация отключена. Приложение работает в локальном режиме.',
    });
  };

  return (
    <section className="stack">
      <details className="acc">
        <summary className="acc-summary">
          <span className="grow">Семейный репозиторий</span>
          <span className="acc-hint">Хранилище семьи, код подключения, срок ключа</span>
          <Icon name="chevron" size={18} className="chev" />
        </summary>
        <div className="acc-body stack">
          <div className="card stack">
            {sync.configured ? (
              <Banner tone="ok">
                <div className="grow">
                  <div className="strong">Синхронизация подключена</div>
                  <div className="small mono">
                    {owner}/{repo} · {branch}
                  </div>
                </div>
              </Banner>
            ) : (
              <Banner tone="warn">
                <div className="grow">
                  <div className="strong">Хранилище не подключено</div>
                  <div className="small">
                    Приложение полностью работает, но данные видны только на этом устройстве. Чтобы
                    делиться списками с семьёй, подключите приватный репозиторий.
                  </div>
                </div>
              </Banner>
            )}

            {desc?.kind === 'pat' &&
              desc.expiresAt &&
              desc.daysLeft !== null &&
              desc.daysLeft < 45 && (
                <Banner tone={desc.daysLeft < 0 ? 'err' : 'warn'}>
                  <div className="grow">
                    <div className="strong">
                      {desc.daysLeft < 0
                        ? 'Ключ доступа истёк'
                        : `Ключ доступа истекает через ${desc.daysLeft} дн.`}
                    </div>
                    <div className="small">
                      Срок взят из ответа GitHub, это не ошибка приложения. Перевыпустите ключ по
                      инструкции и вставьте новый — либо создайте бессрочный.
                    </div>
                  </div>
                  <button type="button" className="btn btn--sm" onClick={() => setGuideOpen(true)}>
                    Инструкция
                  </button>
                </Banner>
              )}

            <Field label="Владелец (логин GitHub того, кто создал хранилище)">
              <input
                className="input mono"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                placeholder="например: ivanov-family"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </Field>
            <Field label="Репозиторий с данными" hint="Приватный. Например: family-hub-data">
              <input
                className="input mono"
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                placeholder="family-hub-data"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </Field>
            <Field label="Ветка">
              <input
                className="input mono"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder="main"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </Field>

            <Field
              label={
                savedToken
                  ? 'Ключ доступа (сохранён — введите, чтобы заменить)'
                  : 'Ключ доступа (fine-grained PAT)'
              }
              hint="Хранится только в этом браузере. В код приложения не попадает и в журнал не пишется."
            >
              <input
                className="input mono"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={savedToken ? '••••••••••••••••' : 'github_pat_…'}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="off"
              />
            </Field>

            {classicToken && (
              <Banner tone="warn">
                <div className="grow small">
                  Это классический токен (ghp_…). Он даёт доступ <b>ко всем</b> вашим репозиториям.
                  Лучше создать fine-grained (github_pat_…) с правом только на один репозиторий.
                </div>
              </Banner>
            )}

            {result && <Banner tone={result.tone}>{result.text}</Banner>}

            <div className="row" style={{ gap: 'var(--sp-2)' }}>
              <button
                type="button"
                className="btn btn--primary grow"
                disabled={busy}
                onClick={() => void connect()}
              >
                {busy ? 'Проверяем…' : 'Проверить и подключить'}
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => setGuideOpen(true)}>
                Инструкция
              </button>
            </div>

            {savedToken && (
              <button
                type="button"
                className="btn btn--danger btn--block btn--sm"
                onClick={() => void disconnect()}
              >
                Отключить синхронизацию
              </button>
            )}

            <div className="tiny muted">{expiryLine(desc, savedToken)}</div>
          </div>

          {/* ---------------- Второй телефон и остальные члены семьи ---------------- */}
          <div className="card stack">
            <div className="strong">Второй телефон и другие члены семьи</div>
            <p className="small" style={{ margin: 0, lineHeight: 1.55, color: 'var(--text-2)' }}>
              Аккаунт GitHub нужен <b>только тому, кто создал хранилище</b>. Остальным — не нужен:
              они подключаются кодом с этого телефона. Код содержит семейный ключ, поэтому
              передавайте его только внутри семьи (например, себе в мессенджер).
            </p>

            {codeOpen && code ? (
              <div className="stack" style={{ gap: 'var(--sp-2)' }}>
                <div className="mono small" style={{ wordBreak: 'break-all', lineHeight: 1.5 }}>
                  {code}
                </div>
                <div className="row" style={{ gap: 'var(--sp-2)' }}>
                  <button
                    type="button"
                    className="btn btn--sm btn--primary"
                    onClick={() => void copyCode()}
                  >
                    {codeCopied ? 'Скопировано' : 'Скопировать код'}
                  </button>
                  <button
                    type="button"
                    className="btn btn--sm btn--ghost"
                    onClick={() => setCodeOpen(false)}
                  >
                    Скрыть
                  </button>
                </div>
                <div className="tiny muted">
                  На втором телефоне: Настройки → «Семейный репозиторий» → вставьте код в поле ниже
                  → «Подключить по коду». Ни аккаунта, ни создания ключа там не потребуется.
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="btn btn--block"
                disabled={busy}
                onClick={() => void makeCode()}
              >
                Получить код для второго устройства
              </button>
            )}

            <Field
              label="Подключить это устройство по коду"
              hint="Вставьте код, полученный на первом телефоне семьи."
            >
              <textarea
                className="input mono"
                rows={3}
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value)}
                placeholder="FHSETUP1.…"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </Field>
            <button
              type="button"
              className="btn btn--primary btn--block"
              disabled={busy}
              onClick={() => void connectByCode()}
            >
              {busy ? 'Подключаем…' : 'Подключить по коду'}
            </button>
          </div>

          <PatGuideSheet open={guideOpen} onClose={() => setGuideOpen(false)} />
        </div>
      </details>
    </section>
  );
}

/** Человекочитаемая строка о сроке ключа: факт от GitHub, а не наша оценка. */
function expiryLine(d: AuthDescription | null, saved: boolean): string {
  if (!saved || !d || d.kind === 'none') return 'Ключ сохранён: нет';
  if (d.neverExpires) return 'Ключ сохранён: да · срок: без срока (по данным GitHub)';
  if (!d.expiresAt)
    return 'Ключ сохранён: да · срок: станет известен после первого запроса к GitHub';
  const date = new Date(d.expiresAt).toLocaleDateString('ru-RU');
  return `Ключ сохранён: да · срок: до ${date}${d.expiresIsEstimate ? ' (оценка)' : ' (по данным GitHub)'}`;
}

/**
 * Пошаговая инструкция для человека с ЛЮБЫМ уровнем подготовки (Universal Guide §4).
 * Генерация fine-grained PAT — главная точка трения при подключении семьи
 * (краш-тест, роль «Новичок»), поэтому каждый шаг расписан до уровня «куда нажать».
 *
 * С 0.1.3 инструкция соответствует семейной модели: шаги 1–3 проходит один человек
 * (владелец хранилища), шаг 4 для остальных — вставить код, без аккаунта GitHub.
 */
function PatGuideSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} title="Как подключить семью" onClose={onClose}>
      <div className="stack">
        <Banner tone="info">
          <div className="grow small">
            <b>Кому нужен аккаунт GitHub:</b> только тому, кто создаёт семейное хранилище (шаги
            1–2). Остальные члены семьи подключаются кодом за одну минуту и без аккаунта (шаг 4).
          </div>
        </Banner>

        <div className="card stack" style={{ gap: 8 }}>
          <div className="strong">Шаг 1. Создайте приватный репозиторий для данных</div>
          <ol className="small" style={{ paddingLeft: 20, margin: 0, lineHeight: 1.6 }}>
            <li>
              Откройте <span className="mono">https://github.com/new</span>
            </li>
            <li>
              Repository name: <span className="mono">family-hub-data</span>
            </li>
            <li>
              Visibility: <b>Private</b> — обязательно
            </li>
            <li>
              Отметьте <b>Add a README file</b> и нажмите Create repository
            </li>
          </ol>
        </div>

        <div className="card stack" style={{ gap: 8 }}>
          <div className="strong">Шаг 2. Создайте семейный ключ доступа (fine-grained PAT)</div>
          <ol className="small" style={{ paddingLeft: 20, margin: 0, lineHeight: 1.6 }}>
            <li>
              Откройте{' '}
              <span className="mono">https://github.com/settings/personal-access-tokens/new</span>
            </li>
            <li>
              Token name: <span className="mono">Family Hub (семейный ключ)</span>
            </li>
            <li>
              Expiration: можно выбрать <b>No expiration</b> — тогда ключ не придётся перевыпускать
              раз в год, а приложение покажет «без срока». Минус: утечённый ключ останется
              действующим, пока вы не отзовёте его вручную. Если это смущает — поставьте срок 1 год:
              приложение заранее напомнит о продлении (срок оно берёт из ответа GitHub, а не
              придумывает).
            </li>
            <li>Resource owner: ваш логин</li>
            <li>
              Repository access: <b>Only select repositories</b> →{' '}
              <span className="mono">family-hub-data</span>
            </li>
            <li>
              Permissions → Repository permissions → <b>Contents</b> → <b>Read and write</b>
            </li>
            <li>
              Нажмите Generate token и <b>сразу скопируйте</b> ключ — он показывается один раз
            </li>
          </ol>
        </div>

        <div className="card stack" style={{ gap: 8 }}>
          <div className="strong">Шаг 3. Вставьте в приложение на этом телефоне</div>
          <div className="small">
            Владелец = ваш логин GitHub, Репозиторий = <span className="mono">family-hub-data</span>
            , Ветка = <span className="mono">main</span>, Ключ = то, что скопировали. Затем нажмите
            «Проверить и подключить».
          </div>
        </div>

        <div className="card stack" style={{ gap: 8 }}>
          <div className="strong">Шаг 4. Подключите остальных — кодом, без аккаунтов</div>
          <ol className="small" style={{ paddingLeft: 20, margin: 0, lineHeight: 1.6 }}>
            <li>На этом телефоне: кнопка «Получить код для второго устройства».</li>
            <li>Скопируйте код и передайте члену семьи (хоть себе в мессенджер).</li>
            <li>
              На его телефоне: Настройки → «Семейный репозиторий» → вставить код → «Подключить по
              коду». Готово, аккаунт GitHub не нужен.
            </li>
          </ol>
          <div className="tiny muted">
            Код равносилен семейному ключу: не публикуйте его и не пересылайте посторонним. Если
            захотите отзываемый доступ для отдельного телефона — выпустите для него отдельный ключ
            по шагу 2 и вставьте вручную вместо кода.
          </div>
        </div>

        <Banner tone="warn">
          <div className="grow small">
            <b>Через год</b> ключ истечёт — это ограничение GitHub, а не ошибка. Приложение напомнит
            заранее и продолжит работать локально, пока вы не вставите новый ключ. После замены
            ключа обновите код подключения на остальных телефонах.
          </div>
        </Banner>

        <Banner tone="info">
          <div className="grow small">
            <b>Как отозвать доступ:</b>{' '}
            <span className="mono">https://github.com/settings/personal-access-tokens</span> →
            выбрать токен → Revoke. Данные в репозитории при этом не пострадают.
          </div>
        </Banner>

        <button type="button" className="btn btn--primary btn--block" onClick={onClose}>
          Понятно
        </button>
      </div>
    </Sheet>
  );
}
