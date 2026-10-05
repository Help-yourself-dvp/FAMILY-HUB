/** Чистые функции ленты (подписки) для отправителя; семейные данные сюда не попадают. */
export const CALENDAR_TIMEZONE: string;
export const FEED_REFRESH: string;

export type FeedSection = 'deadlines' | 'tasks';

export function escapeIcsText(raw: string): string;
export function foldIcsLine(line: string): string;
export function reminderSteps(deadline: { remindersDays?: unknown }): number[];
export function alarmTrigger(days: number): string;
export function feedableDeadlines(deadlines: unknown): Array<Record<string, unknown>>;
export function feedableTasks(tasks: unknown): Array<Record<string, unknown>>;

export function buildFeedIcs(input: {
  section: FeedSection;
  deadlines?: unknown;
  tasks?: unknown;
}): string;

export function newFeedSlug(random?: () => string): string;
export function feedUrl(input: {
  owner: string;
  repo: string;
  branch?: string;
  slug: string;
}): string;
export function feedPath(slug: string): string;
