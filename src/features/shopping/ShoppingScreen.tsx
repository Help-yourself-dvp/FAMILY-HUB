/**
 * Покупки — сквозной срез ЭТАПА 1 (ТЗ §15, сокращённый до необходимого для
 * проверки синхронизации). Полный модуль с категориями, магазином, историей,
 * шаблонами и «повторить корзину» — ЭТАП 4.
 */
import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, kvGet, kvSet } from '../../data/db';
import { shoppingRepo, type NewShoppingInput } from '../../data/repositories';
import { canonicalKey, parseItem } from '../../domain/normalize';
import { formatQty } from '../../domain/quantity';
import { HORIZONS, HORIZON_LABEL, type Horizon, type ShoppingItem } from '../../domain/types';
import { Banner, EmptyState, Field, Icon, Sheet, Skeleton, Switch } from '../../design/ui';
import { useSyncState } from '../../app/hooks';

export default function ShoppingScreen({
  ready,
  composeKey,
}: {
  ready: boolean;
  /** Ключ навигации с запросом «открыть форму добавления» (FAB «+»). */
  composeKey: string | null;
}) {
  const [composeOpen, setComposeOpen] = useState(false);
  // Корректировка состояния во время рендера (штатный паттерн React вместо эффекта):
  // новый composeKey = новый запрос открытия формы, даже если экран уже открыт.
  const [seenComposeKey, setSeenComposeKey] = useState<string | null>(null);
  if (composeKey && composeKey !== seenComposeKey) {
    setSeenComposeKey(composeKey);
    setComposeOpen(true);
  }
  const [showDone, setShowDone] = useState(false);
  const [editing, setEditing] = useState<ShoppingItem | null>(null);
  const [groupBy, setGroupBy] = useState<'horizon' | 'category'>('horizon');

  useEffect(() => {
    void kvGet<'horizon' | 'category'>('shopping.groupBy').then((v) =>
      setGroupBy(v === 'category' ? 'category' : 'horizon'),
    );
  }, []);

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
    // Группировка по категориям (приёмка 0.1.5): «вся молочка рядом» в магазине.
    const byCategory = new Map<string, ShoppingItem[]>();
    for (const i of active) {
      const key = i.category?.trim() || 'Без категории';
      const list = byCategory.get(key) ?? [];
      list.push(i);
      byCategory.set(key, list);
    }
    const categoryNames = [...byCategory.keys()].sort((a, b) =>
      a === 'Без категории' ? 1 : b === 'Без категории' ? -1 : a.localeCompare(b, 'ru'),
    );
    for (const list of byHorizon.values())
      list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    for (const list of byCategory.values())
      list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    done.sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''));
    return {
      byHorizon,
      byCategory,
      categoryNames,
      done,
      activeCount: active.length,
      doneCount: done.length,
    };
  }, [items]);

  if (!ready || !groups) {
    return (
      <div className="screen">
        <Skeleton />
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="row row--between" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
        <div className="screen-subtitle" style={{ padding: 0 }}>
          {groups.activeCount > 0 ? `${groups.activeCount} в списке` : 'ничего не нужно'}
        </div>
        <div className="chips" role="group" aria-label="Группировка списка">
          <button
            type="button"
            className="chip"
            aria-pressed={groupBy === 'horizon'}
            onClick={() => {
              setGroupBy('horizon');
              void kvSet('shopping.groupBy', 'horizon');
            }}
          >
            По сроку
          </button>
          <button
            type="button"
            className="chip"
            aria-pressed={groupBy === 'category'}
            onClick={() => {
              setGroupBy('category');
              void kvSet('shopping.groupBy', 'category');
            }}
          >
            По категориям
          </button>
        </div>
      </div>

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

      {groupBy === 'horizon' &&
        HORIZONS.map((h) => {
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
                    onEdit={setEditing}
                  />
                ))}
              </div>
            </section>
          );
        })}

      {groupBy === 'category' &&
        groups.categoryNames.map((name) => {
          const list = groups.byCategory.get(name) ?? [];
          if (list.length === 0) return null;
          return (
            <section key={name} className="stack" aria-labelledby={`c-${name}`}>
              <div className="row row--between">
                <h2 className="section-title" id={`c-${name}`}>
                  {name} · {list.length}
                </h2>
              </div>
              <div className="stack">
                {list.map((item) => (
                  <ShoppingRow
                    key={item.id}
                    item={item}
                    author={members?.find((m) => m.id === item.updatedBy)}
                    onEdit={setEditing}
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
                <div className="row" style={{ gap: 6 }}>
                  <button
                    type="button"
                    className="btn btn--sm btn--ghost"
                    onClick={() => void shoppingRepo.repeatBasket()}
                  >
                    Повторить корзину
                  </button>
                  <button
                    type="button"
                    className="btn btn--sm btn--ghost"
                    onClick={() => void shoppingRepo.clearDone()}
                  >
                    Очистить
                  </button>
                </div>
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
                  onEdit={setEditing}
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
      {editing && <AddShoppingSheet editing={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ShoppingRow({
  item,
  author,
  onEdit,
}: {
  item: ShoppingItem;
  author?: { name: string; color: string } | null;
  onEdit: (item: ShoppingItem) => void;
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
      <button
        type="button"
        className="grow item-hit"
        aria-label={`Изменить «${item.title}»`}
        onClick={() => onEdit(item)}
      >
        <div className="row" style={{ gap: 6, minWidth: 0 }}>
          {author && (
            <span
              className="dot"
              style={{ color: author.color, flex: '0 0 auto' }}
              title={`Последнее изменение: ${author.name}`}
            />
          )}
          {/* Без truncate: длинное название переносится и читается целиком (приёмка 0.1.5) */}
          <div className="item-title">{item.title}</div>
        </div>
        {meta && <div className="item-meta">{meta}</div>}
      </button>
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
export function AddShoppingSheet({
  onClose,
  editing,
}: {
  onClose: () => void;
  editing?: ShoppingItem | null;
}) {
  const [text, setText] = useState(() =>
    editing
      ? `${editing.title}${editing.qty !== null ? ` ${formatQty(editing.qty)}${editing.unit ?? ''}` : ''}`
      : '',
  );
  const [horizon, setHorizon] = useState<Horizon>(editing?.horizon ?? 'now');
  const [category, setCategory] = useState(editing?.category ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const knownCategories = useLiveQuery(
    async () => {
      // ВАЖНО: equals(null) бросает «Invalid key» (null — не ключ IndexedDB).
      // Дефект 0.1.6: исключение падало при открытии формы -> белый экран на обоих
      // телефонах. Выборка живых строк — только фильтром в JS.
      const rows = await db.shopping.toArray();
      const set = new Set<string>();
      for (const r of rows) if (!r.deletedAt && r.category?.trim()) set.add(r.category.trim());
      return [...set].sort((a, b) => a.localeCompare(b, 'ru'));
    },
    [],
    undefined,
  );
  // ЭТАП 4: ввод в один тап — недавние уникальные названия с их количеством/категорией.
  const recent = useLiveQuery(
    async () => {
      const rows = await db.shopping.orderBy('updatedAt').reverse().limit(60).toArray();
      const seen = new Map<string, ShoppingItem>();
      for (const r of rows) {
        if (r.deletedAt) continue;
        if (!seen.has(r.canonicalKey)) seen.set(r.canonicalKey, r);
      }
      return [...seen.values()].slice(0, 8);
    },
    [],
    undefined,
  );
  const sameTitle = useLiveQuery(async () => {
    const key = canonicalKey(parseItem(text).title);
    if (!key) return undefined;
    return db.shopping.where('canonicalKey').equals(key).first();
  }, [text]);

  const preview = useMemo(() => (text.trim() ? parseItem(text) : null), [text]);

  // Клавиатура на телефонах выше полей категории и кнопок: при фокусе поле
  // подъезжает к центру видимой области (приёмка 0.1.7).
  const revealOnFocus = (e: React.FocusEvent<HTMLElement>) => {
    const el = e.currentTarget;
    window.setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250);
  };

  // Массовый ввод (просьба владельца): «бананы 4 шт, хлеб, порошок» — каждая часть
  // разбирается отдельно; категория подтягивается из прошлых покупок с тем же
  // названием, чтобы в магазине группа «По категориям» наполнялась сама.
  // Справочник категорий (приёмка 0.3.3): список семьи хранится в kv и
  // пополняется сам — любая сохранённая категория попадает в список. Плюс все
  // категории уже лежащих позиций (они приходят с синхронизацией с других
  // устройств), поэтому список общий для семьи без отдельного файла.
  const catList = useLiveQuery(async () => {
    const items = await db.shopping.toArray();
    const saved = (await kvGet<string[]>('shopping.categories')) ?? [];
    const set = new Set<string>(saved);
    for (const i of items) {
      const c = i.category?.trim();
      if (c) set.add(c);
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'ru'));
  }, []);
  const [catTouched, setCatTouched] = useState(false);

  const segments = useMemo(
    () =>
      text
        .split(/[,;\n]+/u)
        .map((x) => x.trim())
        .filter(Boolean),
    [text],
  );

  // Одна позиция и категория ещё не тронута рукой — подставляем категорию
  // прошлой покупки с тем же названием (владелец видел это как «магию» сохранения;
  // теперь она видна сразу в поле).
  useEffect(() => {
    if (editing || catTouched) return;
    const single = segments[0];
    if (segments.length !== 1 || !single) return;
    let alive = true;
    void db.shopping
      .where('canonicalKey')
      .equals(canonicalKey(single))
      .first()
      .then((prev) => {
        if (alive && prev?.category) setCategory(prev.category);
      });
    return () => {
      alive = false;
    };
  }, [segments, editing, catTouched]);

  const submit = async () => {
    const raw = text.trim();
    if (!raw) {
      setError('Введите название');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (!editing && segments.length > 1) {
        let added = 0;
        for (const seg of segments) {
          const parsedSeg: NewShoppingInput = {
            ...parseItem(seg),
            category: category.trim() || null,
            horizon,
          };
          if (!parsedSeg.title) continue;
          if (!parsedSeg.category) {
            const prev = await db.shopping
              .where('canonicalKey')
              .equals(canonicalKey(parsedSeg.title))
              .first();
            if (prev?.category) parsedSeg.category = prev.category;
          }
          await shoppingRepo.add(parsedSeg);
          if (parsedSeg.category) await rememberCategory(parsedSeg.category);
          added += 1;
        }
        if (added === 0) {
          setError('Не удалось разобрать ни одной позиции');
          return;
        }
        setText('');
        onClose();
        return;
      }
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
      if (editing) {
        // Правка доступна любому участнику семьи и попадает в семейную ленту
        // (приёмка 0.1.5): update пишет rev+1 и событие 'updated'.
        await shoppingRepo.update(editing.id, {
          title: parsed.title,
          qty: parsed.qty,
          unit: parsed.unit,
          category: parsed.category,
          horizon: parsed.horizon,
        });
      } else {
        await shoppingRepo.add(parsed);
      }
      if (parsed.category) await rememberCategory(parsed.category);
      setText('');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Неизвестная ошибка');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open title={editing ? 'Изменить покупку' : 'Новая покупка'} onClose={onClose}>
      <div className="stack">
        <Field
          label="Что купить"
          hint={
            !editing && segments.length > 1
              ? `Добавим ${segments.length} поз.: ${segments
                  .map((sg) => parseItem(sg).title || sg)
                  .join(', ')}`
              : preview && preview.qty !== null
                ? `Разобрано: «${preview.title}» · ${formatQty(preview.qty)}${
                    preview.unit ? ` ${preview.unit}` : ''
                  }`
                : 'Можно через запятую: «бананы 4 шт, хлеб, порошок». Есть голосовой ввод.'
          }
          error={error}
        >
          <input
            className="input"
            value={text}
            autoFocus
            enterKeyHint="done"
            placeholder="Например: бананы 4 шт, хлеб, порошок"
            onChange={(e) => setText(e.target.value)}
            onFocus={revealOnFocus}
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

        {!editing && catList && catList.length > 0 && (
          <div className="field">
            <span className="field-label">Категория — тап выберите из списка семьи</span>
            <div className="chips" role="group" aria-label="Категории">
              {catList.map((cn) => (
                <button
                  key={cn}
                  type="button"
                  className="chip"
                  aria-pressed={category === cn}
                  onClick={() => {
                    setCategory(cn);
                    setCatTouched(true);
                  }}
                >
                  {cn}
                </button>
              ))}
            </div>
          </div>
        )}

        <Field
          label="Категория"
          hint="Можно выбрать из списка выше или вписать свою — она добавится в список семьи и в следующий раз будет на кнопке."
        >
          <input
            className="input"
            value={category}
            placeholder="Например: Молочное"
            onChange={(e) => {
              setCategory(e.target.value);
              setCatTouched(true);
            }}
            onFocus={revealOnFocus}
          />
        </Field>
        {!editing && recent && recent.length > 0 && (
          <div className="field">
            <span className="field-label">Часто покупают — тап добавьте сразу</span>
            <div className="chips" role="group" aria-label="Быстрое добавление из истории">
              {recent.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="chip"
                  onClick={() => {
                    void shoppingRepo.add({
                      title: r.title,
                      qty: r.qty,
                      unit: r.unit,
                      category: r.category,
                      horizon: r.horizon,
                    });
                  }}
                >
                  {r.title}
                </button>
              ))}
            </div>
          </div>
        )}
        {(knownCategories?.length || sameTitle?.category) && (
          <div className="chips" role="group" aria-label="Быстрые категории">
            {sameTitle?.category && sameTitle.category !== category && (
              <button
                type="button"
                className="chip chip--accent"
                onClick={() => setCategory(sameTitle.category as string)}
              >
                обычно: {sameTitle.category}
              </button>
            )}
            {(knownCategories ?? [])
              .filter((c) => c !== sameTitle?.category)
              .slice(0, 6)
              .map((c) => (
                <button
                  key={c}
                  type="button"
                  className="chip"
                  aria-pressed={category === c}
                  onClick={() => setCategory(c)}
                >
                  {c}
                </button>
              ))}
          </div>
        )}

        {/* Липкий низ: финальная кнопка видна всегда, даже поверх клавиатуры (приёмка 0.1.8) */}
        <div className="sheet-footer">
          <button
            type="button"
            className="btn btn--primary btn--block"
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy
              ? 'Сохраняем…'
              : editing
                ? 'Сохранить'
                : segments.length > 1
                  ? `Добавить ${segments.length}`
                  : 'Добавить'}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

/** Новая категория пополняет справочник семьи на этом устройстве (kv). */
async function rememberCategory(name: string): Promise<void> {
  const cur = (await kvGet<string[]>('shopping.categories')) ?? [];
  if (cur.includes(name)) return;
  await kvSet(
    'shopping.categories',
    [...cur, name].sort((a, b) => a.localeCompare(b, 'ru')),
  );
}
