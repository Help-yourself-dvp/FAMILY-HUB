/** Настройки · подключение к семейному репозиторию и пошаговая инструкция */
import { useEffect, useState } from 'react';
import { kvGet, KV_KEYS } from '../../data/db';
import { auth } from '../../data/remote/authStrategy';
import { GitHubClient } from '../../data/remote/githubClient';
import { syncNow } from '../../data/sync/engine';
import { useSyncState } from '../../app/hooks';
import { setRemoteConfig, clearRemoteConfig } from '../../app/bootstrap';
import { Banner, Field, Sheet } from '../../design/ui';
import { describeError } from './helpers';

export default function ConnectionSection() {
  const sync = useSyncState();
  const [owner, setOwner] = useState('');
  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState('main');
  const [token, setToken] = useState('');
  const [savedToken, setSavedToken] = useState(false);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [daysLeft, setDaysLeft] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  const applyExpiry = (iso: string | null) => {
    setExpiresAt(iso);
    setDaysLeft(iso ? Math.floor((Date.parse(iso) - Date.now()) / 86_400_000) : null);
  };

  useEffect(() => {
    void (async () => {
      setOwner((await kvGet<string>(KV_KEYS.remoteOwner)) ?? '');
      setRepo((await kvGet<string>(KV_KEYS.remoteRepo)) ?? '');
      setBranch((await kvGet<string>(KV_KEYS.remoteBranch)) ?? 'main');
      const d = await auth.current().describe();
      setSavedToken(d.kind !== 'none');
      applyExpiry(d.expiresAt);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- applyExpiry стабилен по смыслу
  }, []);

  // Чистое инлайн-выражение: вызов методов класса при рендере линтер считает небезопасным
  const trimmedToken = token.trim();
  const classicToken =
    trimmedToken.length > 0 && (trimmedToken.startsWith('ghp_') || trimmedToken.startsWith('gho_'));

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
        setResult({ tone: 'err', text: 'Нет ключа доступа. Вставьте токен или откройте инструкцию.' });
        return;
      }
      await setRemoteConfig(owner, repo, branch);

      const cfg = { owner: owner.trim(), repo: repo.trim(), branch: branch.trim() || 'main' };
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
      applyExpiry(d.expiresAt);
      setResult({
        tone: 'ok',
        text: `Подключено: ${user.login} → ${cfg.owner}/${cfg.repo} (${repoInfo.defaultBranch}). Можно синхронизироваться.`,
      });
      await syncNow('after-connect');
    } catch (e) {
      setResult({ tone: 'err', text: describeError(e) });
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm('Отключить синхронизацию? Локальные данные останутся на устройстве.')) return;
    await auth.current().clear();
    await clearRemoteConfig();
    setSavedToken(false);
    applyExpiry(null);
    setResult({ tone: 'ok', text: 'Синхронизация отключена. Приложение работает в локальном режиме.' });
  };

  return (
    <section className="stack">
      <h2 className="section-title">Семейный репозиторий</h2>
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
              <div className="strong">Локальный режим</div>
              <div className="small">
                Приложение полностью работает, но данные видны только на этом устройстве.
                Чтобы делиться списками с семьёй, подключите приватный репозиторий.
              </div>
            </div>
          </Banner>
        )}

        {daysLeft !== null && daysLeft < 45 && (
          <Banner tone={daysLeft < 0 ? 'err' : 'warn'}>
            <div className="grow">
              <div className="strong">
                {daysLeft < 0 ? 'Ключ доступа истёк' : `Ключ доступа истекает через ${daysLeft} дн.`}
              </div>
              <div className="small">
                GitHub ограничивает срок действия ключа годом — это не ошибка приложения.
                Перевыпустите его по инструкции и вставьте новый.
              </div>
            </div>
            <button type="button" className="btn btn--sm" onClick={() => setGuideOpen(true)}>
              Инструкция
            </button>
          </Banner>
        )}

        <Field label="Владелец (ваш логин GitHub)">
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
          label={savedToken ? 'Ключ доступа (сохранён — введите, чтобы заменить)' : 'Ключ доступа (fine-grained PAT)'}
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
          <button type="button" className="btn btn--primary grow" disabled={busy} onClick={() => void connect()}>
            {busy ? 'Проверяем…' : 'Проверить и подключить'}
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => setGuideOpen(true)}>
            Инструкция
          </button>
        </div>

        {savedToken && (
          <button type="button" className="btn btn--danger btn--block btn--sm" onClick={() => void disconnect()}>
            Отключить синхронизацию
          </button>
        )}

        <div className="tiny muted">
          Ключ сохранён: {savedToken ? 'да' : 'нет'}
          {expiresAt ? ` · оценка истечения: ${new Date(expiresAt).toLocaleDateString('ru-RU')}` : ''}
        </div>
      </div>

      <PatGuideSheet open={guideOpen} onClose={() => setGuideOpen(false)} />
    </section>
  );
}

/**
 * Пошаговая инструкция для человека с ЛЮБЫМ уровнем подготовки (Universal Guide §4).
 * Генерация fine-grained PAT — главная точка трения при подключении семьи
 * (краш-тест, роль «Новичок»), поэтому каждый шаг расписан до уровня «куда нажать».
 */
function PatGuideSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} title="Как подключить семью" onClose={onClose}>
      <div className="stack">
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
          <div className="strong">Шаг 2. Создайте ключ доступа (fine-grained PAT)</div>
          <ol className="small" style={{ paddingLeft: 20, margin: 0, lineHeight: 1.6 }}>
            <li>
              Откройте <span className="mono">https://github.com/settings/personal-access-tokens/new</span>
            </li>
            <li>
              Token name: <span className="mono">Family Hub (мой телефон)</span>
            </li>
            <li>
              Expiration: <b>максимальный срок</b> (GitHub не даёт больше года)
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
          <div className="strong">Шаг 3. Вставьте в приложение</div>
          <div className="small">
            Владелец = ваш логин GitHub, Репозиторий = <span className="mono">family-hub-data</span>,
            Ветка = <span className="mono">main</span>, Ключ = то, что скопировали. Затем нажмите
            «Проверить и подключить».
          </div>
        </div>

        <div className="card stack" style={{ gap: 8 }}>
          <div className="strong">Шаг 4. Повторите на втором телефоне</div>
          <div className="small">
            Каждому члену семьи нужен <b>свой</b> ключ: так приложение честно показывает, кто что
            добавил, и вы сможете отозвать доступ к одному телефону, не трогая остальные.
          </div>
        </div>

        <Banner tone="warn">
          <div className="grow small">
            <b>Через год</b> ключ истечёт — это ограничение GitHub, а не ошибка. Приложение
            напомнит заранее и продолжит работать локально, пока вы не вставите новый ключ.
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
