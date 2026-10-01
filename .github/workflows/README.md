# Workflows этого репозитория (кода)

| Файл | Назначение |
|---|---|
| `ci.yml` | lint + typecheck + test + build + сверка версий на каждый push/PR |
| `deploy-pages.yml` | сборка и публикация на GitHub Pages, **только** с ветки `main` |

**Workflow отправки уведомлений (`family-notifications.yml`) здесь НЕ живёт.**
Он должен находиться в **приватном репозитории данных** `family-hub-data`: там лежат
семейные JSON и VAPID-ключ в Secrets, и там же работает GITHUB_TOKEN без прав на
что-либо ещё. Шаблон появится в `infra/notifications/` на ЭТАПЕ 3 и переносится владельцем.
