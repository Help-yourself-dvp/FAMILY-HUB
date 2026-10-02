/**
 * Единая точка получения времени. Инъекция нужна для тестов (перекос часов —
 * один из зафиксированных рисков, PROJECT.md §6.10).
 */
export interface Clock {
  now(): number;
  iso(): string;
}

const systemClock: Clock = {
  now: () => Date.now(),
  iso: () => new Date().toISOString(),
};

let active: Clock = systemClock;

export const clock = {
  now: () => active.now(),
  iso: () => active.iso(),
  /** Только для тестов. */
  setForTests(c: Clock | null): void {
    active = c ?? systemClock;
  },
};
