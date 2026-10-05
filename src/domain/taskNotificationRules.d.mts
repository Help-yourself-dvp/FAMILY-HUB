/** Чистые поля задач; настоящие данные не читаются этим модулем. */
export interface TaskNotificationInput {
  id: string;
  title: string;
  status: string;
  assigneeId: string | null;
  dueDate: string | null;
  deletedAt?: string | null;
  assignmentId?: string | null;
  assignedBy?: string | null;
}
export interface TaskNotificationEvent {
  kind: 'assigned' | 'due';
  tag: string;
  title: string;
  body: string;
  route: '#/tasks';
}
export function taskNotificationEvents(
  task: TaskNotificationInput,
  recipientIds: readonly string[],
  today: string,
): TaskNotificationEvent[];
