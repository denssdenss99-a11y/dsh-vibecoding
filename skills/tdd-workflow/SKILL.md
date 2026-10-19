---
name: tdd-workflow
description: Автономный фреймворк Agentic Engineering 3.0 (Spec Gatekeeper, 90% Certainty Rule, 3-Strike Deadlock Breaker, Compound Memory, Live Server Daemon, Anti-MenuGen Invariant).
---

# ⚡ Автономный режим Agentic Engineering 3.0 (Software 3.0 OS)

Когда активирован этот режим или получен префикс `/vibe`:

## 📜 12 ЗОЛОТЫХ ПРАВИЛ АГЕНТНОЙ ИНЖЕНЕРИИ
1. **Сначала план, потом код (`scope.md`):** В задачах уровня Tier 2 категорически запрещено писать код без утвержденного `scope.md`. Разработка ведется строго по текущему незавершенному чекбоксу.
2. **Правило 90% уверенности (Supabase Protocol):** Если ты не уверен в архитектуре, связях сущностей или контрактах API хотя бы на 90% — категорически запрещено генерировать код. Задай уточняющие вопросы через `ask_user_question`.
3. **Атомарные шаги (Atomic Feature Loop):** Один шаг — один компонент/файл. Запрещено касаться смежных модулей (Brownfield Blast Radius).
4. **Git как точки сохранения (Save Points):** Фиксируй каждое работающее состояние через `checkpoint_create`. Перед слиянием ветки выполняй сквош (`squash: true`).
5. **Дай ИИ глаза и уши:** Автоматическая верификация через `verify_deliverable` (Headless Chrome + Pre-commit Bugbot аудит секретов и синтаксиса).
6. **Включай глубокое мышление (`ultrathink`):** При сложной отладке, рефакторинге или наступлении Strike 2 активируй режим расширенных рассуждений.
7. **Слушай сервер (Background Tasks):** Запускай бэкенд-сервисы через `server_daemon` и считывай логи `stdout`/`stderr` в реальном времени до сдачи работы пользователю.
8. **Автоматизируй DevOps (SSH & VPS Deploy):** Устраняй недельное горлышко деплоя. Генерируй готовые Nginx, SSL Certbot, Systemd и Docker манифесты через `devops_provision`.
9. **Веди долговременную память (`memory.md`):** С каждой итерацией обновляй `.dsh/memory/memory.md` через инструмент `memory_manage`.
10. **Протокол трех попыток (3-Strike Rule):**
    - **Strike 1:** Трехкомпонентная диагностика [Raw Terminal Log + Expected vs Actual].
    - **Strike 2:** Запрет на изменение кода! Обязательный Root Cause Analysis (RCA) и 3 альтернативы.
    - **Strike 3:** Автоматический откат `checkpoint_restore`, запись в `Failed Approaches` и сброс контекста (`/clear`).
11. **Требуй максимальной простоты (KISS):** Запрещен enterprise-оверинжиниринг и раздувание бойлерплейта (антипаттерн micro-GPT).
12. **Сохраняй понимание (Director & Judge):** Человек — архитектор и директор. Агент обязан обеспечивать persistent связывание сущностей (защита от потери платежей Stripe по email).

---

## 🚀 1. Умный Fast-Path и Spec Gatekeeper
- **Оцени запрос перед вопросами:**
  - ⚡ **FAST-PATH АКТИВАЦИЯ (БЕЗ ВОПРОСОВ):**
    Если запрос пользователя понятен, содержит ключевые вводные ЛИБО дает творческую свободу («придумай сам», «сделай», «начни», «без вопросов»):
    - **ЗАПРЕЩЕНО** задавать формальные/бюрократические вопросы!
    - Вызывай `complete_interview({ taskName, requirementsSummary, subtaskCount: 1, complexity, bypassReason: "comprehensive_prompt" })`.
    - В сложных задачах (Tier 2) вызови `scope_manage({ action: "init", taskName, milestones })` и переходи к реализации первого шага.
  - ❓ **КОГДА ЗАДАВАТЬ ВОПРОСЫ:**
    Задавай вопросы через `ask_user_question` **только** при реальной архитектурной развилке или когда уверенность ниже 90%.

---

## 📄 2. Brownfield Scope Lock & Whitelist файлов
- В `scope.md` для каждого шага объявляются целевые файлы:
  `- [ ] Step 1: Auth API [files: src/auth.js, test/auth.test.js]`
- **ИНВАРИАНТ:** Агенту запрещено редактировать любые файлы вне этого списка!
- После успешного прогона тестов вызови `scope_manage({ action: "advance" })`, чтобы закрыть шаг и разблокировать следующий.

---

## 🛑 3. Протокол борьбы с зацикливанием (3-Strike Machine)
- Если тесты падают или сборка ломается:
  - **Strike 1:** Проанализируй 3-компонентный лог, внеси одну точечную правку.
  - **Strike 2:** Включается программная блокировка редактирования файлов!
    - Сформулируй первопричину сбоя (RCA).
    - Предложи 3 альтернативных пути.
    - Вызови `strike_guard({ action: "submit_rca", solutionSummary: "..." })` для снятия блокировки.
  - **Strike 3:** Плагин автоматически выполняет откат к последнему чекпоинту и сохраняет тупиковую ветку в `memory.md`. Рекомендуется очистить контекст (`/clear`).

---

## 👂 4. Фоновые серверы и верификация (Live Server Daemon)
- Для веб-серверов (Node.js, FastAPI, Next.js):
  - Запусти сервер в фоне: `server_daemon({ action: "start", command: "npm run dev", port: 3000 })`.
  - Считай логи и проверь отсутствие исключений: `server_daemon({ action: "logs", lines: 30 })`.
  - Запусти тесты `run_tdd_cycle` или смоук-тест `verify_deliverable`.
  - Останови сервер по окончании верификации: `server_daemon({ action: "stop" })`.

---

## 🛡️ 5. Pre-Commit Bugbot и Anti-MenuGen Invariant
- Инструмент `verify_deliverable` автоматически инспектирует код:
  - **Утечки секретов:** блокирует коммиты с приватными API-ключами.
  - **Anti-MenuGen:** в платежных шлюзах и вебхуках запрещен поиск пользователей строго по строке `email`. Обязательно использование persistent `user_id` или `stripe_customer_id`.
  - **Zero Dead Code:** каждый файл в `src/` обязан импортироваться в точке входа.

---

## 🚀 6. Zero DevOps Bottleneck (Production Deployment)
- Когда проект готов к выкатке, вызови `devops_provision({ appName, port, domain, framework })`.
- Получи готовый комплект: Nginx reverse proxy с SSL, Systemd юнит с авто-перезапуском, Dockerfile и setup.sh для TimeWeb VPS / Amvera.
