// lib/client.js — Browser UI for dsh-vibecoding in DeepSeek Harness (DSH).
// Provides an interactive '🎯 TDD Vibe Mode' button directly inside the composer toolbar.

window.__ModuleLoader__.load({
  id: "dsh-vibecoding",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const react = require("react");
    const { createElement: h, useState } = react;

    const CSS = `
.vibe-dock-wrap {
  display: inline-flex;
  align-items: center;
  position: relative;
  font-family: inherit;
  font-size: 13px;
  user-select: none;
  margin-right: 6px;
}

.vibe-dock-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border-radius: 14px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: var(--dsw-alias-label-secondary, #a1a1aa);
}

.vibe-dock-button:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.25);
  color: var(--dsw-alias-label-primary, #ffffff);
}

.vibe-dock-button.active {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(6, 182, 212, 0.2));
  border-color: rgba(16, 185, 129, 0.5);
  color: #34d399;
  box-shadow: 0 0 12px rgba(16, 185, 129, 0.25);
}

.vibe-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
}

.vibe-badge {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 6px;
  background: rgba(16, 185, 129, 0.2);
  color: #34d399;
  font-weight: 600;
  letter-spacing: 0.5px;
}

.vibe-tooltip {
  position: absolute;
  bottom: 36px;
  left: 0;
  width: 280px;
  padding: 12px 14px;
  background: #18181b;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  z-index: 1000;
  font-size: 12px;
  line-height: 1.5;
  color: #d4d4d8;
  pointer-events: auto;
}

.vibe-tooltip-title {
  font-weight: 600;
  color: #f4f4f5;
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.vibe-step-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 6px;
}

.vibe-step-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 11px;
}

.vibe-step-num {
  color: #34d399;
  font-weight: 600;
}
`;

    // Inject CSS once
    if (typeof document !== "undefined" && !document.getElementById("dsh-vibecoding-css")) {
      const style = document.createElement("style");
      style.id = "dsh-vibecoding-css";
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    function VibeDockButton() {
      const [isActive, setIsActive] = useState(false);
      const [showPopover, setShowPopover] = useState(false);

      const toggleMode = (e) => {
        e.preventDefault();
        const nextState = !isActive;
        setIsActive(nextState);

        // Find the input composer textarea and prefill '/vibe ' if empty
        const textarea = document.querySelector('textarea, [contenteditable="true"]');
        if (textarea) {
          if (nextState) {
            if (textarea.tagName === 'TEXTAREA') {
              if (!textarea.value.trim().startsWith('/vibe')) {
                textarea.value = '/vibe ' + textarea.value;
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
              }
              textarea.focus();
            }
          }
        }
      };

      return h(
        "div",
        {
          className: "vibe-dock-wrap",
          onMouseEnter: () => setShowPopover(true),
          onMouseLeave: () => setShowPopover(false)
        },
        h(
          "button",
          {
            type: "button",
            className: `vibe-dock-button ${isActive ? "active" : ""}`,
            onClick: toggleMode,
            title: "Нажмите для переключения 5-этапного TDD режима"
          },
          h("span", { className: "vibe-icon" }, "🎯"),
          h("span", null, "TDD Vibe"),
          isActive ? h("span", { className: "vibe-badge" }, "ON") : null
        ),
        showPopover
          ? h(
              "div",
              { className: "vibe-tooltip" },
              h(
                "div",
                { className: "vibe-tooltip-title" },
                h("span", null, "🎯 5-Phase TDD Pipeline"),
                isActive ? h("span", { className: "vibe-badge" }, "ACTIVE") : null
              ),
              h(
                "div",
                { style: { color: "#a1a1aa", fontSize: "11px" } },
                "Нажмите кнопку, чтобы активировать жесткий TDD контракт и изоляцию веток:"
              ),
              h(
                "div",
                { className: "vibe-step-list" },
                h("div", { className: "vibe-step-item" }, h("span", { className: "vibe-step-num" }, "1."), "Опрос перед кодом (уточнение требований)"),
                h("div", { className: "vibe-step-item" }, h("span", { className: "vibe-step-num" }, "2."), "Спецификация (якорь контекста в docs/specs)"),
                h("div", { className: "vibe-step-item" }, h("span", { className: "vibe-step-num" }, "3."), "Тесты ДО кода (красный тест -> правка -> зеленый)"),
                h("div", { className: "vibe-step-item" }, h("span", { className: "vibe-step-num" }, "4."), "Изоляция в Git Worktree"),
                h("div", { className: "vibe-step-item" }, h("span", { className: "vibe-step-num" }, "5."), "Оркестратор + быстрые воркеры")
              )
            )
          : null
      );
    }

    const inject = ["slots"];

    function apply(ctx) {
      // 1. Inject into composer toolbar left slot (beside plan mode / model selector)
      ctx.slots.inject("conversation.input.left", () =>
        ctx.slots.register(
          {
            name: "conversation.input.left",
            id: "vibecoding-chip",
            order: 10
          },
          VibeDockButton
        )
      );

      // 2. Also register into composer dock for fallback
      ctx.slots.inject("conversation.input.dock", () =>
        ctx.slots.register(
          {
            name: "conversation.input.dock",
            id: "vibecoding-dock-button",
            order: 10
          },
          VibeDockButton
        )
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
