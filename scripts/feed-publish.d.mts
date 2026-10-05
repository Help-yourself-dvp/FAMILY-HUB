/** Цикл публикации ленты (подписки) с внедрённым I/O; семейные данные сюда не попадают. */
export const FEED_SECTIONS: readonly ['deadlines', 'tasks'];

export interface FeedSettings {
  sections: { deadlines: boolean; tasks: boolean };
  slugs: { deadlines: string; tasks: string };
  previousSlugs: string[];
}

export function parseFeedSettings(raw: unknown): FeedSettings | null;

/** Внедрённые зависимости: чтение/запись семейного хранилища и публикация файлов. */
export interface FeedPublishDeps {
  env: { family: string; public: string; publicToken: string };
  getJson: (path: string) => Promise<unknown>;
  putJson: (path: string, data: unknown, message: string) => Promise<void>;
  publishIcs: (args: { section: string; slug: string; content: string }) => Promise<void>;
  deleteIcs: (slug: string) => Promise<boolean>;
  log?: (message: string) => void;
  annotation?: (level: string, message: string) => void;
  now?: () => string;
}

export interface FeedPublishSummary {
  enabled: boolean;
  published: number;
  removed: number;
}

export function runFeedPublish(deps: FeedPublishDeps): Promise<FeedPublishSummary>;
