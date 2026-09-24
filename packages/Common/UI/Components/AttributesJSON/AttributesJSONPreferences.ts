import { useCallback, useEffect, useState } from "react";
import {
  ATTRIBUTES_JSON_FORMATS,
  AttributesJSONFormat,
} from "../../../Utils/Telemetry/AttributesJSON";

/*
 * Two small per-viewer choices for attribute sections, both remembered:
 *
 *   format   flat or nested - what "Copy JSON" copies and the JSON view shows.
 *            Picking one in any format menu makes it the default everywhere,
 *            so someone who always wants nested JSON picks it once.
 *   view     list or JSON - how an attribute section opens, so someone who
 *            reads attributes as JSON does not switch on every span.
 *
 * Browser storage can be missing or refuse writes (private windows, blocked
 * site data), so every access is guarded and the in-memory value still works
 * for the rest of the session. Instances mounted at the same time are kept in
 * step through a window event: a panel shows the copy button and the JSON
 * view side by side, and both must agree on the format.
 */

export type AttributesView = "list" | "json";

export const ATTRIBUTES_VIEWS: ReadonlyArray<AttributesView> = ["list", "json"];

interface PreferenceDefinition<T extends string> {
  storageKey: string;
  eventName: string;
  allowed: ReadonlyArray<T>;
  defaultValue: T;
}

export const ATTRIBUTES_JSON_FORMAT_PREFERENCE: PreferenceDefinition<AttributesJSONFormat> =
  {
    storageKey: "oneuptime.attributes-json-format",
    eventName: "oneuptime:attributes-json-format-change",
    allowed: ATTRIBUTES_JSON_FORMATS,
    defaultValue: "flat",
  };

export const ATTRIBUTES_VIEW_PREFERENCE: PreferenceDefinition<AttributesView> =
  {
    storageKey: "oneuptime.attributes-view",
    eventName: "oneuptime:attributes-view-change",
    allowed: ATTRIBUTES_VIEWS,
    defaultValue: "list",
  };

// Each preference's value for this session, used when storage is unavailable.
const sessionValues: Map<string, string> = new Map<string, string>();

function isAllowed<T extends string>(
  definition: PreferenceDefinition<T>,
  value: unknown,
): value is T {
  return definition.allowed.includes(value as T);
}

export function readPreference<T extends string>(
  definition: PreferenceDefinition<T>,
): T {
  try {
    const stored: string | null =
      typeof window !== "undefined" && window.localStorage
        ? window.localStorage.getItem(definition.storageKey)
        : null;

    if (isAllowed(definition, stored)) {
      return stored;
    }
  } catch {
    // Storage is unavailable; fall back to this session's choice.
  }

  const sessionValue: string | undefined = sessionValues.get(
    definition.storageKey,
  );

  return isAllowed(definition, sessionValue)
    ? sessionValue
    : definition.defaultValue;
}

export function writePreference<T extends string>(
  definition: PreferenceDefinition<T>,
  value: T,
): void {
  sessionValues.set(definition.storageKey, value);

  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(definition.storageKey, value);
    }
  } catch {
    // Not persisted; the session value above still applies.
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<T>(definition.eventName, { detail: value }),
    );
  }
}

// Forget this session's in-memory choices. Tests only.
export function resetPreferencesForTesting(): void {
  sessionValues.clear();
}

function usePreference<T extends string>(
  definition: PreferenceDefinition<T>,
): [T, (value: T) => void] {
  const [value, setValueState] = useState<T>(() => {
    return readPreference(definition);
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const handleChange: (event: Event) => void = (event: Event): void => {
      const next: unknown = (event as CustomEvent<unknown>).detail;

      if (isAllowed(definition, next)) {
        setValueState(next);
      }
    };

    window.addEventListener(definition.eventName, handleChange);

    return () => {
      window.removeEventListener(definition.eventName, handleChange);
    };
  }, [definition]);

  const setValue: (next: T) => void = useCallback(
    (next: T): void => {
      setValueState(next);
      writePreference(definition, next);
    },
    [definition],
  );

  return [value, setValue];
}

export function useAttributesJSONFormat(): [
  AttributesJSONFormat,
  (format: AttributesJSONFormat) => void,
] {
  return usePreference(ATTRIBUTES_JSON_FORMAT_PREFERENCE);
}

export function useAttributesView(): [
  AttributesView,
  (view: AttributesView) => void,
] {
  return usePreference(ATTRIBUTES_VIEW_PREFERENCE);
}

export const ATTRIBUTES_JSON_FORMAT_LABELS: Readonly<
  Record<AttributesJSONFormat, string>
> = {
  flat: "Flat",
  nested: "Nested",
};

export const ATTRIBUTES_JSON_FORMAT_DESCRIPTIONS: Readonly<
  Record<AttributesJSONFormat, string>
> = {
  flat: "Dotted keys, exactly as recorded",
  nested: "Dots expanded into objects",
};
