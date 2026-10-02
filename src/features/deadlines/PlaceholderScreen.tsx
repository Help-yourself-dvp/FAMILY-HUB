import { EmptyState } from '../../design/ui';

/** Сроки — ЭТАП 6. Здесь же будет общий движок рекурренции и ICS-канал уведомлений. */
export default function DeadlinesScreen() {
  return (
    <div className="screen">
      <header className="screen-header">
        <div>
          <div className="screen-subtitle">модуль ещё не реализован</div>
        </div>
      </header>
      <EmptyState
        emoji="📅"
        title="ЭТАП 6"
        hint="Документы, автомобиль, страховки, дни рождения. Даты хранятся как календарные (YYYY-MM-DD), а не как метки времени — иначе напоминания сдвигались бы на сутки при переходе на летнее время."
      />
    </div>
  );
}
