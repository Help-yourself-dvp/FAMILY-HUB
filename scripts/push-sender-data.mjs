/**
 * Формат сроков из GitHub: приложение пишет RemoteFile { entities }, а не массив.
 * Чистый адаптер, чтобы проверять формат на фикстурах, не читая семейные данные.
 */
/** Общий разбор конверта RemoteFile { entities }: годится и для покупок (0.5.6). */
export function entityRows(file) {
  // Совместимость с ранним/ручным массивом, если такой файл уже существует.
  if (Array.isArray(file)) return file;
  if (
    file &&
    typeof file === 'object' &&
    file.entities &&
    typeof file.entities === 'object' &&
    !Array.isArray(file.entities)
  ) {
    return Object.values(file.entities);
  }
  return null;
}

/** Историческое имя для сроков и дел: поведение то же, что у entityRows. */
export function deadlineRows(file) {
  return entityRows(file);
}
