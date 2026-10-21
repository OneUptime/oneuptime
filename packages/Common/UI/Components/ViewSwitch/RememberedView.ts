import { useCallback, useEffect, useState } from "react";

/*
 * A choice of view a reader makes once and finds again: which of a page's
 * views it opens on (Timeline | Table on the status timelines),
 * remembered in their browser - a page opened later opens on it too - and
 * the same in every copy of the switch on the page at once.
 *
 * Browser storage can be missing or refuse writes (a private window, blocked
 * site data), so every access is guarded and the choice still holds for the
 * rest of the session. A stored value that is not one of the views - written
 * by an older version, or by hand - reads as the default.
 *
 * The status timelines' Timeline | Table switch remembers its choice this way
 * (StatusTimeline/StatusTimelineView).
 */
export interface RememberedViewOptions<T extends string> {
  storageKey: string;
  values: ReadonlyArray<T>;
  defaultValue: T;
}

export default class RememberedView<T extends string> {
  public readonly storageKey: string;
  public readonly values: ReadonlyArray<T>;
  public readonly defaultValue: T;
  private sessionValue: T | null = null;

  public constructor(options: RememberedViewOptions<T>) {
    this.storageKey = options.storageKey;
    this.values = options.values;
    this.defaultValue = options.defaultValue;
  }

  // The event every copy of the switch listens on, one per stored choice.
  public getChangeEventName(): string {
    return `oneuptime:remembered-view:${this.storageKey}`;
  }

  public isValue(value: unknown): value is T {
    return (
      typeof value === "string" &&
      (this.values as ReadonlyArray<string>).includes(value)
    );
  }

  public read(): T {
    try {
      const stored: string | null =
        typeof window !== "undefined" && window.localStorage
          ? window.localStorage.getItem(this.storageKey)
          : null;

      if (this.isValue(stored)) {
        return stored;
      }
    } catch {
      // Storage is unavailable; this session's choice still holds.
    }

    return this.sessionValue || this.defaultValue;
  }

  public write(value: T): void {
    this.sessionValue = value;

    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem(this.storageKey, value);
      }
    } catch {
      // Not remembered past this session; the session value above holds.
    }

    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent<T>(this.getChangeEventName(), { detail: value }),
      );
    }
  }

  // Forget this session's choice. Tests only.
  public resetForTesting(): void {
    this.sessionValue = null;
  }
}

/*
 * The remembered view, and a setter that remembers a new one: a component
 * re-renders when the choice changes anywhere on the page.
 */
export function useRememberedView<T extends string>(
  remembered: RememberedView<T>,
): [T, (value: T) => void] {
  const [value, setValueState] = useState<T>(() => {
    return remembered.read();
  });

  useEffect(() => {
    const onChange: (event: Event) => void = (event: Event): void => {
      const next: unknown = (event as CustomEvent<unknown>).detail;

      if (remembered.isValue(next)) {
        setValueState(next);
      }
    };

    const eventName: string = remembered.getChangeEventName();

    window.addEventListener(eventName, onChange);

    return () => {
      window.removeEventListener(eventName, onChange);
    };
  }, [remembered]);

  const setValue: (next: T) => void = useCallback(
    (next: T): void => {
      setValueState(next);
      remembered.write(next);
    },
    [remembered],
  );

  return [value, setValue];
}
