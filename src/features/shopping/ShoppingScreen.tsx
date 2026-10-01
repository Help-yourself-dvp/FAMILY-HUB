/**
 * Покупки — сквозной срез ЭТАПА 1 (ТЗ §15, сокращённый до необходимого для
 * проверки синхронизации). Полный модуль с категориями, магазином, историей,
 * шаблонами и «повторить корзину» — ЭТАП 4.
 */
import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useLocation } from 'react-router-dom';
import { db, kvGet, kvSet } from '../../data/db';
import { shoppingRepo, type NewShoppingInput } from '../../data/repositories';
import { parseItem } from '../../domain/normalize';
import { formatQty } from '../../domain/quantity';
import { HORIZONS, HORIZON_LABEL, type Horizon, type ShoppingItem } from '../../domain/types';
import { Banner, EmptyState, Field, Icon, Sheet, Skeleton, Switch } from '../../design/ui';
import { useSyncState } from '../../app/hooks';

export default function ShoppingScreen({ ready }: { ready: boolean }) {
  const location = useLocation() as { state?: { compose?: boolean } };
  // Инициализатор, а не эффект: состояние ставится один раз при монтировании маршрута
  const [composeOpen, setComposeOpen] = useState(() => location.state?.compose === true);
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    void kvGet<boolean>('shopping.showDone').then((v) => setShowDone(Boolean(v)));
  }, []);

  const items = useLiveQuery(() => db.shopping.toArray(), [], undefined);
  const members = useLiveQuery(() => db.members.toArray(), [], undefined);
  const sync = useSyncState();

  const groups = useMemo(() => {
    if (!items) return null;
    const live = items.filter((i) => !i.deletedAt);
    const active = live.filter((i) => !i.done);
    const done = live.filter((i) => i.done);
    const byHorizon = new Map<Horizon, ShoppingItem[]>();
    for (const h of HORIZONS) byHorizon.set(h, []);
    for (const i of active) byHorizon.get(i.horizon)?.push(i);
    for (const list of byHorizon.values())
      list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    done.sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''));
    return { byHorizon, done, activeCount: active.length, doneCount: done.length };
  }, [items]);

  if (!ready || !groups) {
    return (
      <div className="screen">
        <Header count={0} />
        <Skeleton />
      </div>
    );
  }

  return (
    <div className="screen">
      <Header count={groups.activeCount} />

      {!sync.configured && (
        <Banner tone="warn">
          <div className="grow">
            <div className="strong">Локальный режим</div>
            <div className="small">
              Данные только на этом устройстве. Чтобы делиться списком с семьёй, подключите
              репозиторий в настройках.
            </div>
          </div>
        </Banner>
      )}

      {groups.activeCount === 0 && groups.doneCount === 0 && (
        <EmptyState
          emoji="🛒"
          title="Список пуст"
          hint="Нажмите «+» внизу экрана и добавьте первую покупку"
        />
      )}

      {HORIZONS.map((h) => {
        const list = groups.byHorizon.get(h) ?? [];
        if (list.length === 0) return null;
        return (
          <section key={h} className="stack" aria-labelledby={`h-${h}`}>
            <div className="row row--between">
              <h2 className="section-title" id={`h-${h}`}>
                {HORIZON_LABEL[h]} · {list.length}
              </h2>
            </div>
            <div className="stack">
              {list.map((item) => (
                <ShoppingRow
                  key={item.id}
                  item={item}
                  author={members?.find((m) => m.id === item.updatedBy)}
                />
              ))}
            </div>
          </section>
        );
      })}

      {groups.doneCount > 0 && (
        <section className="stack">
          <div className="row row--between">
            <h2 className="section-title">Куплено · {groups.doneCount}</h2>
            <div className="row">
              <Switch
                checked={showDone}
                label="Показывать завершённые"
                onChange={(v) => {
                  setShowDone(v);
                  void kvSet('shopping.showDone', v);
                }}
              />
              {showDone && (
                <button
                  type="button"
                  className="btn btn--sm btn--ghost"
                  onClick={() => void shoppingRepo.clearDone()}
                >
                  Очистить
                </button>
              )}
            </div>
          </div>
          {showDone && (
            <div className="stack">
              {groups.done.map((item) => (
                <ShoppingRow
                  key={item.id}
                  item={item}
                  author={members?.find((m) => m.id === item.updatedBy)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      <button
        type="button"
        className="btn btn--primary btn--block"
        style={{ marginTop: 'var(--sp-2)' }}
        onClick={() => setComposeOpen(true)}
      >
        <Icon name="plus" size={20} /> Добавить покупку
      </button>

      {composeOpen && <AddShoppingSheet onClose={() => setComposeOpen(false)} />}
    </div>
  );
}

function Header({ count }: { count: number }) {
  return (
    <header className="screen-header">
      <div>
        <h1 className="screen-title">Покупки</h1>
        <div className="screen-subtitle">{count > 0 ? `${count} в списке` : 'ничего не нужно'}</div>
      </div>
    </header>
  );
}

function ShoppingRow({
  item,
  author,
}: {
  item: ShoppingItem;
  author?: { name: string; color: string } | null;
}) {
  const meta = [
    item.qty !== null ? `${formatQty(item.qty)}${item.unit ? ` ${item.unit}` : ''}` : null,
    item.category,
    item.store,
    item.note === 'демо' ? 'демо' : item.note,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className={`item${item.done ? ' item--done' : ''}`}>
      <button
        type="button"
        role="checkbox"
        aria-checked={item.done}
        aria-label={
          item.done ? `Снять отметку с ${item.title}` : `Отметить ${item.title} как купленное`
        }
        className="checkbox"
        onClick={() => void shoppingRepo.toggleDone(item.id)}
      />
      <div className="grow">
        <div className="row" style={{ gap: 6, minWidth: 0 }}>
          {author && (
            <span
              className="dot"
              style={{ color: author.color, flex: '0 0 auto' }}
              title={`Последнее изменение: ${author.name}`}
            />
          )}
          <div className="item-title truncate">{item.title}</div>
        </div>
        {meta && <div className="item-meta truncate">{meta}</div>}
      </div>
      <button
        type="button"
        className="icon-btn"
        aria-label={`Удалить ${item.title}`}
        onClick={() => void shoppingRepo.remove(item.id)}
      >
        <Icon name="trash" size={20} />
      </button>
    </div>
  );
}

/**
 * Монтируется только когда открыт: состояние формы создаётся свежим при каждом
 * открытии, поэтому эффект-сброс не нужен (и не провоцирует каскадные рендеры).
 */
export function AddShoppingSheet({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const [horizon, setHorizon] = useState<Horizon>('now');
  const [category, setCategory] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useMemo(() => (text.trim() ? parseItem(text) : null), [text]);

  const submit = async () => {
    const raw = text.trim();
    if (!raw) {
      setError('Введите название');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Быстрый ввод «молоко 2, хлеб, бананы 2 кг» полностью появится в ЭТАПЕ 5.
      // Уже сейчас строка разбирается на название/количество/единицу.
      const parsed: NewShoppingInput = {
        ...parseItem(raw),
        category: category.trim() || null,
        horizon,
      };
      if (!parsed.title) {
        setError('Не удалось разобрать название');
        return;
      }
      await shoppingRepo.add(parsed);
      setText('');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Неизвестная ошибка');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open title="Новая покупка" onClose={onClose}>
      <div className="stack">
        <Field
          label="Что купить"
          hint={
            preview && preview.qty !== null
              ? `Разобрано: «${preview.title}» · ${formatQty(preview.qty)}${preview.unit ? ` ${preview.unit}` : ''}`
              : 'Можно диктовать голосом — используется системная диктовка клавиатуры'
          }
          error={error}
        >
          <input
            className="input"
            value={text}
            autoFocus
            enterKeyHint="done"
            placeholder="Например: бананы 2 кг"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
          />
        </Field>

        <div className="field">
          <span className="field-label">Когда</span>
          <div className="chips" role="group" aria-label="Временной горизонт">
            {HORIZONS.map((h) => (
              <button
                key={h}
                type="button"
                className="chip"
                aria-pressed={horizon === h}
                onClick={() => setHorizon(h)}
              >
                {HORIZON_LABEL[h]}
              </button>
            ))}
          </div>
        </div>

        <Field label="Категория" hint="Необязательно. Полный список категорий — ЭТАП 4">
          <input
            className="input"
            value={category}
            placeholder="Например: Молочное"
            onChange={(e) => setCategory(e.target.value)}
          />
        </Field>

        <button
          type="button"
          className="btn btn--primary btn--block"
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy ? 'Добавляем…' : 'Добавить'}
        </button>
      </div>
    </Sheet>
  );
}
