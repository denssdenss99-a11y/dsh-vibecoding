# dsh-vibecoding 3.2 ⚡
## Vibe Manifesto Agentic Engineering OS for DeepSeek Harness

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![DSH Plugin](https://img.shields.io/badge/DSH-Plugin-blue.svg)](https://github.com/deepseek-ai/deepseek-harness)
[![Version: 3.2.0](https://img.shields.io/badge/version-3.2.0-brightgreen.svg)](package.json)

> *«Можно делегировать написание кода, но нельзя делегировать понимание»*  
> — Манифест вайбкодинга (Software 3.0)

**dsh-vibecoding 3.2 (Vibe Manifesto Edition)** — ультра-легковесный плагин агентной инженерии для [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness). Создан по мотивам «Манифеста вайбкодинга» Андрея Карпати, Chris (@Greg Isenberg) и Andrew Codesmith.

Плагин устраняет оверхед и «синдром энтерпрайз-переусложнения»: вместо десятков фиктивных тулов он внедряет **12 Золотых Правил Манифеста**, нативную проверку браузера через CDP (`browser_smoke`) и инструменты Git-изоляции (`worktree`).

---

### 🛡️ 12 Золотых Правил Манифеста (Directives):

1. **Сначала план, потом код (`scope.md`):** Агент создает лаконичный план из 3–5 пунктов в `scope.md` через стандартный `write` перед началом кодинга.
2. **Правило 90% уверенности:** Если детали схемы БД, API или сущностей ясны менее чем на 90% — кодинг запрещен, агент задает уточняющие вопросы.
3. **Атомарные шаги:** Один промпт — одна фича. Без расползания скоупа.
4. **Git как точки сохранения:** Нативный `git commit -am "savepoint: ..."` после каждой работающей фичи. При поломке — откат `git reset --hard HEAD`.
5. **Дай ИИ глаза и уши (`browser_smoke`):** Реальная проверка локального веб-сервера через Headless Chrome по CDP. Ловит 100% `console.error` и `window.onerror` до сдачи проекта.
6. **Правило трех попыток (3-Strike Rule):** Если команда или фикс упал дважды — запрещен слепой перебор однострочников! Остановка, 3 строки RCA и проверка одной гипотезы.
7. **Инварианты Matter.js и кинетики:** 
   - Обязательная установка `poly-decomp` (`npm i matter-js poly-decomp`) при нарезке полигонов.
   - Импульс разлета по нормали среза (`cutPerp`) для эффекта разрушения.
   - Синтез Web Audio по жесту пользователя.
8. **Максимальная простота (KISS):** Использовать стандартный стек (Vite, TypeScript, npm). Запрет на самодельные серверы и громоздкие абстракции.
9. **Слушай сервер:** Запуск dev-сервера в фоне через стандартный рантайм фоновых задач DSH.
10. **Долговременная память (`memory.md`):** Фиксация архитектуры и статуса в `.dsh/memory/memory.md` в конце сессии.
11. **DSH Write Convention:** Никогда не передавать `justification` в инструмент `write` без `sandbox_permissions`.
12. **Автономная сдача без ступора:** Полный цикл поставки под ключ с рабочей ссылкой и тестами.

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
