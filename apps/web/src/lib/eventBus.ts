/**
 * Lightweight typed event bus using React Context.
 * Replaces window.dispatchEvent / window.addEventListener for cross-component events.
 */
import { createContext, useCallback, useContext, useEffect, useRef } from "react";

// ── Event map ─────────────────────────────────────────────────────────────────
export type AppEventMap = {
  "cap:request-delete-active-video": undefined;
  "cap:escape": undefined;
};

export type AppEventName = keyof AppEventMap;

type Listener<T> = (payload: T) => void;
type ListenerMap = {
  [K in AppEventName]?: Set<Listener<AppEventMap[K]>>;
};

// ── Bus implementation ────────────────────────────────────────────────────────
export class EventBus {
  private listeners: ListenerMap = {};

  on<K extends AppEventName>(event: K, listener: Listener<AppEventMap[K]>): () => void {
    if (!this.listeners[event]) {
      (this.listeners[event] as Set<Listener<AppEventMap[K]>>) = new Set();
    }
    (this.listeners[event] as Set<Listener<AppEventMap[K]>>).add(listener);
    return () => {
      (this.listeners[event] as Set<Listener<AppEventMap[K]>>).delete(listener);
    };
  }

  emit<K extends AppEventName>(event: K, payload: AppEventMap[K]): void {
    (this.listeners[event] as Set<Listener<AppEventMap[K]>> | undefined)?.forEach((fn) => fn(payload));
  }
}

// ── React context ─────────────────────────────────────────────────────────────
import { createElement, type ReactNode } from "react";

const EventBusContext = createContext<EventBus | null>(null);

export function EventBusProvider({ children }: { children: ReactNode }) {
  const busRef = useRef<EventBus>(new EventBus());
  return createElement(EventBusContext.Provider, { value: busRef.current }, children);
}

export function useEventBus(): EventBus {
  const bus = useContext(EventBusContext);
  if (!bus) throw new Error("useEventBus must be used within EventBusProvider");
  return bus;
}

export function useEventBusOn<K extends AppEventName>(
  event: K,
  listener: Listener<AppEventMap[K]>
): void {
  const bus = useEventBus();
  const listenerRef = useRef(listener);
  listenerRef.current = listener;

  useEffect(() => {
    return bus.on(event, (payload) => listenerRef.current(payload));
  }, [bus, event]);
}

export function useEventBusEmit(): <K extends AppEventName>(event: K, payload: AppEventMap[K]) => void {
  const bus = useEventBus();
  return useCallback(<K extends AppEventName>(event: K, payload: AppEventMap[K]) => {
    bus.emit(event, payload);
  }, [bus]);
}
