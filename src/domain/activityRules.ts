/**
 * «Семейная лента»: порядок записей. Просьба владельца 06.10.2026 — «сортировать по
 * участнику, по дате, по типу» выпадающим списком, чтобы найти изменения конкретного
 * человека, не занимая место кнопками.
 *
 * Сортировка живёт в домене (а не в экране), чтобы её можно было проверить тестом без
 * браузера: экран только рисует выбор.
 */
import type { ActivityEntry, EntityKind } from './types';

export type ActivitySort = 'new' | 'old' | 'member' | 'kind';

export const ACTIVITY_SORT_LABEL: Record<ActivitySort, string> = {
  new: 'Сначала новые',
  old: 'Сначала старые',
  member: 'По участнику',
  kind: 'По типу',
};

/** Русские названия разделов: в самой записи они английские (EntityKind). */
export const ENTITY_KIND_LABEL: Record<EntityKind, string> = {
  shopping: 'Покупки',
  tasks: 'Дела',
  deadlines: 'Сроки',
  dictionary: 'Словарь',
  members: 'Участники',
};

/** Новые сначала — прежний порядок ленты; иначе — от старых к новым. */
function byTime(a: ActivityEntry, b: ActivityEntry): number {
  return b.at.localeCompare(a.at) || a.id.localeCompare(b.id);
}

/**
 * Порядок записей для выбранной сортировки. Внутри группы — всегда «сначала новые»,
 * чтобы список был предсказуем и одинаков на всех телефонах (без случайных перестановок).
 */
export function sortActivity(entries: ActivityEntry[], sort: ActivitySort): ActivityEntry[] {
  const list = [...entries];
  switch (sort) {
    case 'old':
      return list.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
    case 'member':
      return list.sort((a, b) => a.actorName.localeCompare(b.actorName, 'ru') || byTime(a, b));
    case 'kind':
      return list.sort(
        (a, b) =>
          ENTITY_KIND_LABEL[a.kind].localeCompare(ENTITY_KIND_LABEL[b.kind], 'ru') || byTime(a, b),
      );
    default:
      return list.sort(byTime);
  }
}
