/**
 * Одна чистая политика для приложения и Node sender. Без базы/сети/логов.
 * Открытое назначенное дело: отдельное назначение другим и дата сегодня.
 * Поля assignmentId/assignedBy optional: старые записи не дают ложную рассылку назначений.
 */
export function taskNotificationEvents(task, recipientIds, today) {
  if (
    !task ||
    task.deletedAt ||
    task.status !== 'open' ||
    !task.assigneeId ||
    !recipientIds.includes(task.assigneeId)
  )
    return [];
  const recipient = task.assigneeId;
  const events = [];
  if (
    typeof task.assignmentId === 'string' &&
    task.assignmentId &&
    typeof task.assignedBy === 'string' &&
    task.assignedBy &&
    !recipientIds.includes(task.assignedBy)
  ) {
    events.push({
      kind: 'assigned',
      tag: `task.${task.id}.${recipient}.assigned.${task.assignmentId}.json`,
      title: 'Family Hub: вам назначено дело',
      body: `Вам назначено дело «${task.title}».`,
      route: '#/tasks',
    });
  }
  if (task.dueDate === today) {
    events.push({
      kind: 'due',
      tag: `task.${task.id}.${recipient}.due.${task.dueDate}.json`,
      title: 'Family Hub: дело на сегодня',
      body: `Сегодня нужно выполнить «${task.title}».`,
      route: '#/tasks',
    });
  }
  return events;
}
