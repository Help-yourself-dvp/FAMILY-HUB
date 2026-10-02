/**
 * Формат сроков из GitHub: приложение пишет RemoteFile { entities }, а не массив.
 * Чистый адаптер, чтобы проверять формат на фикстурах, не читая семейные данные.
 */
export function deadlineRows(file) {
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
