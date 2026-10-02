import { EmptyState } from '../../design/ui';

/** Дела — ЭТАП 7. Заглушка честная: явно сказано, что модуль ещё не реализован. */
export default function TasksScreen() {
  return (
    <div className="screen">
      <header className="screen-header">
        <div>
          <div className="screen-subtitle">модуль ещё не реализован</div>
        </div>
      </header>
      <EmptyState
        emoji="🧾"
        title="В разработке"
        hint="Название, исполнитель, срок, статус, повторение и история — следующий большой модуль после покупок и сроков."
      />
    </div>
  );
}
