// lib/client.js — Modern Agentic Engineering HUD for DeepSeek Harness (DSH) Web.
// Provides dynamic status badges (Strikes 0..3, Tier 1/2), Panic Rollback button, and Session Wrap-up button.

window.__ModuleLoader__.load({
  id: "dsh-vibecoding",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const react = require("react");
    const { createElement: h, useState, useEffect } = react;

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

.vibe-wave-btn.strike-warn {
  background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%) !important;
  box-shadow: 0 0 14px rgba(245, 158, 11, 0.6) !important;
}

.vibe-wave-btn.strike-lock {
  background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%) !important;
  box-shadow: 0 0 16px rgba(239, 68, 68, 0.8) !important;
  animation: vibe-pulse 1.5s infinite;
}

@keyframes vibe-pulse {
  0% { transform: scale(1); }
  50% { transform: scale(1.08); }
  100% { transform: scale(1); }
}

.vibe-wave-svg {
  width: 17px;
  height: 17px;
  display: block;
}

.vibe-hud-popover {
  position: absolute;
  bottom: 42px;
  right: 0;
  width: 320px;
  padding: 14px;
  background: #18181b;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6), 0 0 1px rgba(255, 255, 255, 0.2);
  z-index: 9999;
  font-size: 12px;
  line-height: 1.5;
  color: #d4d4d8;
  text-align: left;
}

.vibe-hud-header {
  font-weight: 600;
  color: #f4f4f5;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.vibe-badge {
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 6px;
  font-weight: 700;
  letter-spacing: 0.5px;
}

.vibe-badge.on {
  background: rgba(16, 185, 129, 0.25);
  color: #34d399;
  border: 1px solid rgba(16, 185, 129, 0.4);
}

.vibe-badge.off {
  background: rgba(255, 255, 255, 0.08);
  color: #a1a1aa;
}

.vibe-hud-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  font-size: 11px;
}

.vibe-hud-actions {
  display: flex;
  gap: 6px;
  margin-top: 10px;
}

.vibe-action-btn {
  flex: 1;
  padding: 6px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.06);
  color: #e4e4e7;
  transition: all 0.15s ease;
  text-align: center;
}

.vibe-action-btn:hover {
  background: rgba(255, 255, 255, 0.14);
  color: #ffffff;
}

.vibe-action-btn.rollback:hover {
  background: rgba(239, 68, 68, 0.3);
  border-color: rgba(239, 68, 68, 0.5);
  color: #fca5a5;
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

    function getSessionId() {
      try {
        const url = new URL(window.location.href);
        const fromParam = url.searchParams.get('sid') || url.searchParams.get('session') || url.searchParams.get('chatId');
        if (fromParam) return fromParam;
        const parts = window.location.pathname.split('/').filter(Boolean);
        const last = parts[parts.length - 1];
        if (last && last !== 'chat' && last !== 'sessions' && last !== 'web') return last;
      } catch {}
      return 'default';
    }

    function VibeWaveButton() {
      const [isActive, setIsActive] = useState(true);
      const [strikes, setStrikes] = useState(0);
      const [isCodeLocked, setIsCodeLocked] = useState(false);
      const [showPopover, setShowPopover] = useState(false);
      const [isPending, setIsPending] = useState(false);
      const [actionStatus, setActionStatus] = useState('');
      const [sid, setSid] = useState(() => getSessionId());

      const updateSid = () => {
        const currentSid = getSessionId();
        setSid((prev) => (prev !== currentSid ? currentSid : prev));
      };

      useEffect(() => {
        window.addEventListener('popstate', updateSid);
        return () => window.removeEventListener('popstate', updateSid);
      }, []);

      const fetchState = () => {
        fetch(`/dsh-vibecoding/state?sid=${encodeURIComponent(sid)}`)
          .then((res) => res.json())
          .then((data) => {
            if (typeof data.active === 'boolean') setIsActive(data.active);
            if (typeof data.strikes === 'number') setStrikes(data.strikes);
            if (typeof data.isCodeLocked === 'boolean') setIsCodeLocked(data.isCodeLocked);
          })
          .catch(() => {});
      };

      useEffect(() => {
        fetchState();
        const interval = setInterval(fetchState, 5000);
        return () => clearInterval(interval);
      }, [sid]);

      const toggleMode = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isPending) return;

        const nextState = !isActive;
        setIsActive(nextState);
        setIsPending(true);

        fetch('/dsh-vibecoding/state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ active: nextState, sid })
        })
          .catch(() => setIsActive((prev) => !prev))
          .finally(() => setIsPending(false));
      };

      const handlePanicRollback = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setActionStatus('Откат...');
        fetch(`/dsh-vibecoding/rollback?sid=${encodeURIComponent(sid)}`, { method: 'POST' })
          .then((res) => res.json())
          .then((data) => {
            if (data.success) {
              setActionStatus(`↺ Откачено к ${data.restoredTag}`);
              fetchState();
            } else {
              setActionStatus(`Ошибка: ${data.error}`);
            }
          })
          .catch((err) => setActionStatus(`Сбой: ${err.message}`))
          .finally(() => setTimeout(() => setActionStatus(''), 3500));
      };

      const handleWrapup = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setActionStatus('Сохранение...');
        fetch(`/dsh-vibecoding/wrapup?sid=${encodeURIComponent(sid)}`, { method: 'POST' })
          .then((res) => res.json())
          .then((data) => {
            if (data.success) {
              setActionStatus('✅ memory.md обновлен');
            } else {
              setActionStatus(`Ошибка: ${data.error}`);
            }
          })
          .catch((err) => setActionStatus(`Сбой: ${err.message}`))
          .finally(() => setTimeout(() => setActionStatus(''), 3500));
      };

      let btnClass = `vibe-wave-btn ${isActive ? 'active' : ''}`;
      if (strikes === 1) btnClass += ' strike-warn';
      if (strikes >= 2 || isCodeLocked) btnClass += ' strike-lock';

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
            disabled: isPending,
            className: btnClass,
            onClick: toggleMode,
            onFocus: () => setShowPopover(true),
            onBlur: () => setShowPopover(false),
            "aria-label": "Agentic Engineering Mode Toggle",
            title: `Vibe Harvester 3.0: ${isActive ? 'ВКЛ' : 'ВЫКЛ'} (Стрики: ${strikes}/3)`
          },
          h(WaveIcon, null)
        ),
        showPopover
          ? h(
              "div",
              { className: "vibe-hud-popover" },
              h(
                "div",
                { className: "vibe-hud-header" },
                h("span", null, "⚡ Agentic Harvester 3.0"),
                h(
                  "span",
                  { className: `vibe-badge ${isActive ? "on" : "off"}` },
                  isActive ? "АКТИВЕН" : "ВЫКЛ"
                )
              ),
              h("div", { className: "vibe-hud-row" },
                h("span", { style: { color: "#a1a1aa" } }, "Счетчик зацикливаний:"),
                h("span", { style: { fontWeight: "bold", color: strikes === 0 ? "#34d399" : strikes === 1 ? "#fbbf24" : "#f87171" } },
                  `${strikes} / 3 Strikes ${isCodeLocked ? '🔒 (RCA)' : ''}`
                )
              ),
              h("div", { className: "vibe-hud-row" },
                h("span", { style: { color: "#a1a1aa" } }, "Spec Gatekeeper:"),
                h("span", null, "📄 scope.md (90% Rule)")
              ),
              h("div", { className: "vibe-hud-row" },
                h("span", { style: { color: "#a1a1aa" } }, "Compound Memory:"),
                h("span", null, "🧠 .dsh/memory/memory.md")
              ),
              actionStatus ? h("div", { style: { color: "#38bdf8", fontSize: "11px", marginTop: "6px" } }, actionStatus) : null,
              h(
                "div",
                { className: "vibe-hud-actions" },
                h(
                  "button",
                  {
                    type: "button",
                    className: "vibe-action-btn rollback",
                    onClick: handlePanicRollback,
                    title: "Мгновенный откат к последнему чекпоинту"
                  },
                  "↺ Rollback"
                ),
                h(
                  "button",
                  {
                    type: "button",
                    className: "vibe-action-btn",
                    onClick: handleWrapup,
                    title: "Сохранить прогресс в memory.md"
                  },
                  "📦 Wrap-up"
                )
              )
            )
          : null
      );
    }

    const inject = ["slots"];

    function apply(ctx) {
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
