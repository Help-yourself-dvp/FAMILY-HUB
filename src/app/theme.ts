/** Тема: системная / светлая / тёмная (ТЗ §24). Хранится ЛОКАЛЬНО, в общий файл не уходит (§2.3). */
import { kvGet, kvSet, KV_KEYS } from '../data/db';

export type ThemeMode = 'system' | 'light' | 'dark';
export const THEME_MODES: ThemeMode[] = ['system', 'light', 'dark'];
export const THEME_LABEL: Record<ThemeMode, string> = {
  system: 'Системная',
  light: 'Светлая',
  dark: 'Тёмная',
};

function apply(mode: ThemeMode): void {
  const root = document.documentElement;
  const dark =
    mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  // theme-color для браузерной строки и иконки
  const meta = document.querySelector('meta[name="theme-color"]:not([media])');
  if (meta) meta.setAttribute('content', dark ? '#0b0e15' : '#f4f6fb');
}

export async function initTheme(): Promise<ThemeMode> {
  const saved = (await kvGet<ThemeMode>(KV_KEYS.theme)) ?? 'system';
  apply(saved);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    void kvGet<ThemeMode>(KV_KEYS.theme).then((m) => apply(m ?? 'system'));
  });
  return saved;
}

export async function setTheme(mode: ThemeMode): Promise<void> {
  await kvSet(KV_KEYS.theme, mode);
  apply(mode);
}
