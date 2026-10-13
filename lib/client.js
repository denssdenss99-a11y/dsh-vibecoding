// lib/client.js — Browser UI for dsh-vibecoding in DeepSeek Harness (DSH).
// Sleek single round wave button in the composer toolbar beside model selector & send button.

window.__ModuleLoader__.load({
  id: "dsh-vibecoding",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const react = require("react");
    const { createElement: h, useState } = react;

    const CSS = `
.vibe-wave-btn-wrap {
  display: inline-flex;
  align-items: center;
  position: relative;
  user-select: none;
  vertical-align: middle;
}

.vibe-wave-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  cursor: pointer;
  outline: none;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.05);
  color: var(--dsw-alias-label-secondary, #9ca3af);
  transition: all 0.22s cubic-bezier(0.4, 0, 0.2, 1);
  box-sizing: border-box;
  padding: 0;
  margin: 0 4px;
}

.vibe-wave-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.25);
  color: #ffffff;
  transform: translateY(-1px) scale(1.05);
}

.vibe-wave-btn.active {
  background: linear-gradient(135deg, #06b6d4 0%, #10b981 100%);
  border-color: rgba(255, 255, 255, 0.4);
  color: #ffffff;
  box-shadow: 0 0 14px rgba(6, 182, 212, 0.55), 0 2px 6px rgba(0, 0, 0, 0.3);
  transform: translateY(-1px);
}

.vibe-wave-btn.active:hover {
  box-shadow: 0 0 18px rgba(6, 182, 212, 0.75), 0 3px 8px rgba(0, 0, 0, 0.35);
  transform: translateY(-2px) scale(1.06);
}

.vibe-wave-svg {
  width: 17px;
  height: 17px;
  display: block;
  transition: transform 0.2s ease;
}

.vibe-wave-btn:hover .vibe-wave-svg {
  transform: scale(1.08);
}

.vibe-wave-popover {
  position: absolute;
  bottom: 42px;
  right: 0;
  width: 280px;
  padding: 12px 14px;
  background: #18181b;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6), 0 0 1px rgba(255, 255, 255, 0.2);
  z-index: 9999;
  font-size: 12px;
  line-height: 1.5;
  color: #d4d4d8;
  pointer-events: auto;
  text-align: left;
}

.vibe-wave-popover-header {
  font-weight: 600;
  color: #f4f4f5;
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.vibe-wave-status-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 6px;
  font-weight: 700;
  letter-spacing: 0.5px;
}

.vibe-wave-status-badge.on {
  background: rgba(16, 185, 129, 0.25);
  color: #34d399;
  border: 1px solid rgba(16, 185, 129, 0.4);
}

.vibe-wave-status-badge.off {
  background: rgba(255, 255, 255, 0.08);
  color: #a1a1aa;
}

.vibe-wave-steps {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 6px;
}

.vibe-wave-step {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 11px;
}

.vibe-wave-num {
  color: #06b6d4;
  font-weight: 600;
  font-size: 10px;
}
`;

    if (typeof document !== "undefined" && !document.getElementById("dsh-vibecoding-wave-css")) {
      const style = document.createElement("style");
      style.id = "dsh-vibecoding-wave-css";
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    function WaveIcon() {
      return h(
        "svg",
        {
          className: "vibe-wave-svg",
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: "2.2",
          strokeLinecap: "round",
          strokeLinejoin: "round"
        },
        h("path", { d: "M2 12c3.2-5 6.4-5 9.6 0s6.4 5 9.6 0" }),
        h("path", {
          d: "M4 16.5c2.6-3.2 5.2-3.2 7.8 0s5.2 3.2 7.8 0",
          strokeWidth: "1.8",
          strokeOpacity: "0.6"
        })
      );
    }

    const VIBE_DIRECTIVE = "[🎯 TDD-Vibe: Сначала задай 2-4 вопроса через ask_user_question и не пиши код до ответов!] ";

    function VibeWaveButton() {
      const [isActive, setIsActive] = useState(false);
      const [showPopover, setShowPopover] = useState(false);

      const toggleMode = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const nextState = !isActive;
        setIsActive(nextState);

        const editor = document.querySelector('.uV2eYG_input, [contenteditable="true"], textarea');
        if (editor) {
          editor.focus();
          if (editor.tagName === 'TEXTAREA' || editor.tagName === 'INPUT') {
            let val = editor.value || '';
            if (nextState) {
              if (!val.includes(VIBE_DIRECTIVE)) {
                editor.value = VIBE_DIRECTIVE + val;
              }
            } else {
              editor.value = val.replace(VIBE_DIRECTIVE, '').replace('/vibe ', '');
            }
            editor.dispatchEvent(new Event('input', { bubbles: true }));
          } else {
            // Contenteditable in DSH
            let text = editor.innerText || editor.textContent || '';
            if (nextState) {
              if (!text.includes(VIBE_DIRECTIVE)) {
                try {
                  const sel = window.getSelection();
                  const range = document.createRange();
                  range.selectNodeContents(editor);
                  range.collapse(true);
                  sel.removeAllRanges();
                  sel.addRange(range);
                  document.execCommand('insertText', false, VIBE_DIRECTIVE);
                } catch {
                  editor.textContent = VIBE_DIRECTIVE + text;
                }
              }
            } else {
              editor.textContent = text.replace(VIBE_DIRECTIVE, '').replace('/vibe ', '');
            }
          }
        }
      };

      return h(
        "div",
        {
          className: "vibe-wave-btn-wrap",
          onMouseEnter: () => setShowPopover(true),
          onMouseLeave: () => setShowPopover(false)
        },
        h(
          "button",
          {
            type: "button",
            className: `vibe-wave-btn ${isActive ? "active" : ""}`,
            onClick: toggleMode,
            "aria-label": "TDD Vibe Mode Toggle",
            title: isActive ? "TDD Vibe Mode: ВКЛ" : "TDD Vibe Mode: ВЫКЛ"
          },
          h(WaveIcon, null)
        ),
        showPopover
          ? h(
              "div",
              { className: "vibe-wave-popover" },
              h(
                "div",
                { className: "vibe-wave-popover-header" },
                h("span", null, "🌊 TDD Vibe Mode"),
                h(
                  "span",
                  { className: `vibe-wave-status-badge ${isActive ? "on" : "off"}` },
                  isActive ? "АКТИВЕН" : "ВЫКЛ"
                )
              ),
              h(
                "div",
                { style: { color: "#a1a1aa", fontSize: "11px", marginBottom: "4px" } },
                "Строгий 5-этапный пайплайн с защитой от багов:"
              ),
              h(
                "div",
                { className: "vibe-wave-steps" },
                h("div", { className: "vibe-wave-step" }, h("span", { className: "vibe-wave-num" }, "1."), "Опрос перед написанием кода (ask_user_question)"),
                h("div", { className: "vibe-wave-step" }, h("span", { className: "vibe-wave-num" }, "2."), "Спецификация (якорь контекста в docs/specs)"),
                h("div", { className: "vibe-wave-step" }, h("span", { className: "vibe-wave-num" }, "3."), "Красные тесты ДО кода → зеленый автолуп"),
                h("div", { className: "vibe-wave-step" }, h("span", { className: "vibe-wave-num" }, "4."), "Изоляция в Git Worktrees"),
                h("div", { className: "vibe-wave-step" }, h("span", { className: "vibe-wave-num" }, "5."), "Оркестратор + быстрые воркеры")
              )
            )
          : null
      );
    }

    const inject = ["slots"];

    function apply(ctx) {
      // Sole placement: Right side of composer toolbar (beside send button & model selector)
      ctx.slots.inject("conversation.input.right", () =>
        ctx.slots.register(
          {
            name: "conversation.input.right",
            id: "vibecoding-wave-button",
            order: 40
          },
          VibeWaveButton
        )
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
