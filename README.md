# dsh-vibecoding 3.3 ⚡
## Vibe SOP Agentic Engineering OS for DeepSeek Harness

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![DSH Plugin](https://img.shields.io/badge/DSH-Plugin-blue.svg)](https://github.com/deepseek-ai/deepseek-harness)
[![Version: 3.3.0](https://img.shields.io/badge/version-3.3.0-brightgreen.svg)](package.json)

> *«Можно делегировать написание кода, но нельзя делегировать понимание»*  
> — Манифест вайбкодинга (Software 3.0)

**dsh-vibecoding 3.3 (Vibe SOP Edition)** — ультра-легковесный плагин агентной инженерии для [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness). Создан на основе боевых бенчмарков и принципов «Манифеста вайбкодинга».

Плагин экономит до **85% токенов** по сравнению с тяжелыми enterprise-обертками и обеспечивает автономную, устойчивую разработку без галлюцинаций.

---

### 🛡️ 12 Золотых Правил Vibe SOP (Directives):

1. **Классификация поставки на шаге 0 (Delivery Archetype):**
   - `[STANDALONE / DEMO / GAME]`: Прототипы, игры, песочницы, виджеты. **Zero-Build Step**: чистый модульный JS/ESM, CDN с fallback или скрипты в `libs/`. Обязан открываться по двойному клику (`file://`) и через статический сервер. Без bare imports в HTML.
   - `[FULLSTACK / PRODUCTION APP]`: Долгосрочные сервисы, дашборды. Стандартный бандлер (Vite), `package.json`, типизация.
2. **Сначала план, потом код (`scope.md`):** Агент создает лаконичный план из 3–5 пунктов в `scope.md` через стандартный `write` перед началом кодинга.
3. **Правило 90% уверенности:** Если детали схемы БД, контрактов или физики ясны менее чем на 90% — кодинг запрещен, агент задает уточняющие вопросы.
4. **Атомарные шаги:** Один промпт — одна фича. Без расползания скоупа.
5. **Защита от сбоев ОС и окружения (OS Guardrails):**
   - Защита от кириллицы/пробелов: при создании `package.json` всегда использовать нейтральный ASCII-slug (`"name": "app"` или `"sandbox"`), не копируя имя директории.
   - Защита кэша: использовать `--prefer-offline` или прямую загрузку вендоров.
6. **Git как точки сохранения:** Нативный `git commit -am "savepoint: ..."` после каждой работающей фичи.
7. **Жесткий откат при двух ошибках (2-Strike Rollback):** Если команда или тест падает 2 раза подряд — агент останавливается, выполняет `git reset --hard HEAD` к последнему сейвпоинту, пишет 1 строку RCA и меняет стратегию вместо нагромождения костылей.
8. **Инварианты предметной области (No Dead Code):**
   - Для физических движков (Matter.js, Cannon.js, Rapier): обязательная предзагрузка вспомогательных библиотек (например `poly-decomp`) до инстанцирования тел.
   - Синтез Web Audio строго по первому пользовательскому жесту.
9. **Многоуровневая верификация (`browser_smoke`):**
   - Математика/алгоритмы: нативный раннер тестов (`node --test`).
   - Браузер и визуал: Headless Chrome по CDP (`browser_smoke`), проверяющий отсутствие `console.error` и `window.onerror`.
10. **Долговременная память (`memory.md`):** Фиксация архитектуры и статуса в `.dsh/memory/memory.md` в конце сессии.
11. **DSH Write Convention:** Никогда не передавать `justification` в инструмент `write` без `sandbox_permissions`.
12. **Автономная сдача под ключ:** Поставка проекта на диск, smoke-проверка, выдача рабочей ссылки и инструкции запуска без заминок.

---

### 🧰 Арсенал инструментов (Lean 5-Tool Suite):

* **`browser_smoke`**: Нативный CDP-верификатор в Headless Chrome. За 1–2 секунды ловит любые ошибки консоли и исключения в рантайме.
* **`worktree_create`**: Создание изолированного Git worktree для безопасных экспериментов.
* **`worktree_merge`**: Атомарное слияние ветки с поддержкой squash.
* **`worktree_list`**: Список активных ворктри.
* **`worktree_remove`**: Безопасная очистка ворктри.

---

### 🚀 Быстрый старт:

```bash
# Установка плагина в DSH:
dsh plugin install dsh-vibecoding

# Или через GitHub:
git clone https://github.com/denssdenss99-a11y/dsh-vibecoding.git
```
