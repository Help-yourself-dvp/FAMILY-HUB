import { EmptyState } from '../../design/ui';

/** Дела — ЭТАП 7. Заглушка честная: явно сказано, что модуль ещё не реализован. */
export default function TasksScreen() {
  return (
    <div className="screen">
      <header className="screen-header">
        <div>
          <h1 className="screen-title">Дела</h1>
          <div className="screen-subtitle">модуль ещё не реализован</div>
        </div>
      </header>
      <EmptyState
        emoji="🧾"
        title="ЭТАП 7"
        hint="Название, исполнитель, срок, статус, повторение и история появятся после проверки синхронизации (ЭТАП 1) и покупок (ЭТАП 4)."
      />
    </div>
  );
}
