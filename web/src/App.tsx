import { useEffect, useState } from "react";
import { api, type AppState } from "./api";

type Action = "load" | "increment" | "decrement" | "reset" | "refresh";
type TrackProps = Record<string, string | number | boolean>;

// Pendo Track Event names: one per successful action, plus one for any failed
// API call. Pendo matches them exactly (case-sensitive) against the track types
// registered for this app, so keep them verbatim.
const TRACK_EVENTS: Record<Action | "action-failed", string> = {
  load: "demo-load",
  increment: "demo-increment",
  decrement: "demo-decrement",
  reset: "demo-reset",
  refresh: "demo-refresh",
  "action-failed": "demo-action-failed",
};

// Seam for Pendo. Novus installs the Pendo agent, which provides window.pendo
// at runtime; this fires a Track Event for each action. No-op when the agent
// isn't present (local dev), so the app and Playwright mocks both stay simple.
function trackEvent(name: keyof typeof TRACK_EVENTS, props?: TrackProps) {
  if (typeof window !== "undefined") {
    try {
      window.pendo?.track?.(TRACK_EVENTS[name], props);
    } catch {
      // Analytics must never break the app or turn a success into a failure.
    }
  }
}

// Properties for each successful action's Track Event. `prev` is the state on
// screen when the action started; `next` is the state the API returned.
function successProps(action: Action, prev: AppState, next: AppState): TrackProps {
  switch (action) {
    case "load":
      return { counter: next.counter, lastAction: next.lastAction };
    case "increment":
    case "decrement":
      return { counter: next.counter, previousCounter: prev.counter };
    case "reset":
      // The new value is always 0, so record what the reset cleared instead.
      return { previousCounter: prev.counter, previousLastAction: prev.lastAction };
    case "refresh":
      // Server state is shared by every visitor; flag refetches that found changes.
      return {
        counter: next.counter,
        previousCounter: prev.counter,
        lastAction: next.lastAction,
        counterChanged: next.counter !== prev.counter,
      };
  }
}

// React StrictMode runs mount effects twice in development. Module-level (a ref
// would reset on that remount) so the initial load, and its single demo-load
// event, happen once per page.
let didInitialLoad = false;

export default function App() {
  const [state, setState] = useState<AppState>({ counter: 0, lastAction: "none" });
  const [error, setError] = useState<string | null>(null);

  const run = async (name: Action, fn: () => Promise<AppState>) => {
    const prev = state;
    try {
      setError(null);
      const next = await fn();
      setState(next);
      trackEvent(name, successProps(name, prev, next));
    } catch (e) {
      const err = e as Error;
      setError(err.message);
      trackEvent("action-failed", {
        action: name,
        // Capped because Pendo limits a Track Event's properties to 512 bytes.
        errorMessage: err.message.slice(0, 100),
        errorName: err.name,
        counter: prev.counter,
      });
    }
  };

  useEffect(() => {
    if (didInitialLoad) return;
    didInitialLoad = true;
    run("load", api.getState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 480, margin: "4rem auto", textAlign: "center" }}>
      <h1>QAWolf Demo</h1>

      <p data-testid="counter-value" style={{ fontSize: "3rem", margin: "1rem 0" }}>
        {state.counter}
      </p>
      <p data-testid="last-action" style={{ color: "#666" }}>
        Last action: {state.lastAction}
      </p>

      <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
        <button data-testid="btn-increment" onClick={() => run("increment", api.increment)}>
          Increment
        </button>
        <button data-testid="btn-decrement" onClick={() => run("decrement", api.decrement)}>
          Decrement
        </button>
        <button data-testid="btn-reset" onClick={() => run("reset", api.reset)}>
          Reset
        </button>
        <button data-testid="btn-refresh" onClick={() => run("refresh", api.getState)}>
          Refresh
        </button>
      </div>

      {error && (
        <p data-testid="error" style={{ color: "crimson", marginTop: 16 }}>
          {error}
        </p>
      )}
    </main>
  );
}
