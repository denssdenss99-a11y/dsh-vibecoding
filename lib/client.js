// lib/client.js — Clean Vibe Toggle Button for DeepSeek Harness (DSH) Web.
// Toggles Vibe Mode on/off with zero intrusive popovers or blocking windows.

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

.vibe-wave-svg {
  width: 17px;
  height: 17px;
  display: block;
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
      const [isPending, setIsPending] = useState(false);
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

      const btnClass = `vibe-wave-btn ${isActive ? 'active' : ''}`;
      const tooltip = isActive
        ? 'Vibe Mode: ВКЛ (нажмите, чтобы выключить)'
        : 'Vibe Mode: ВЫКЛ (нажмите, чтобы включить)';

      return h(
        "div",
        { className: "vibe-wave-btn-wrap" },
        h(
          "button",
          {
            type: "button",
            disabled: isPending,
            className: btnClass,
            onClick: toggleMode,
            "aria-label": "Vibe Mode Toggle",
            title: tooltip
          },
          h(WaveIcon, null)
        )
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
