import {
  ColumnWidths,
  EMPTY_COLUMN_WIDTHS,
  getColumnWidthsPreferenceKey,
  readColumnWidths,
  toColumnWidthsJSON,
  withColumnWidth,
} from "./ColumnWidths";
import ColumnWidthsStore from "./ColumnWidthsStore";
import UserPreferences, {
  UserPreferenceType,
} from "../../../../Utils/UserPreferences";
import User from "../../../Utils/User";
import { JSONObject } from "../../../../Types/JSON";
import React, { useCallback, useEffect, useRef } from "react";

/*
 * The widths a person gave a table's columns, remembered for them.
 *
 * In the browser (UserPreferences' TableColumnWidths), one entry per person
 * and per table, where a table's column choices and page size already
 * are - not on the server:
 *
 *   - A width belongs to the screen it was set on: a column made wide to
 *     read whole names on a large monitor is too wide on a laptop, and the
 *     laptop keeps its own.
 *   - Every page with a table would otherwise wait for a read before it
 *     could draw its columns, or draw them once at their own widths and
 *     then jump to the person's.
 *   - Nothing needs to be granted: no write permission, no plan, no saved
 *     view to name - a person narrowing a column they do not care about
 *     should not meet any of those.
 *
 * The person is part of the entry (ColumnWidths'
 * getColumnWidthsPreferenceKey), and signing out clears the browser's
 * entries (User.logout), so whoever signs in next on a shared browser finds
 * every table as the product draws it.
 *
 * Every read and write is guarded: a browser that refuses storage (a
 * private window, a full or blocked one) still sizes the columns for as
 * long as the page is open.
 *
 * The widths are held in a ColumnWidthsStore, which only what draws them
 * reads: keeping one draws the header row again, never the table's rows.
 */

export interface UseColumnWidthsResult {
  store: ColumnWidthsStore;
  /*
   * One column's width - null gives it back to the table. drawnIds are the
   * columns the table draws now, kept first when there are more widths
   * than a table remembers.
   */
  setColumnWidth: (
    columnId: string,
    width: number | null,
    drawnIds?: ReadonlyArray<string> | undefined,
  ) => void;
  // Every column back to the table's own width.
  resetColumnWidths: () => void;
}

const getPersonId: () => string = (): string => {
  try {
    return User.getUserId()?.toString() || "";
  } catch {
    return "";
  }
};

export const readStoredColumnWidths: (
  preferenceKey: string | null,
) => ColumnWidths = (preferenceKey: string | null): ColumnWidths => {
  if (!preferenceKey) {
    return EMPTY_COLUMN_WIDTHS;
  }

  try {
    return readColumnWidths(
      UserPreferences.getUserPreferenceByTypeAsJSON({
        key: preferenceKey,
        userPreferenceType: UserPreferenceType.TableColumnWidths,
      }),
    );
  } catch {
    return EMPTY_COLUMN_WIDTHS;
  }
};

export const writeStoredColumnWidths: (
  preferenceKey: string | null,
  widths: ColumnWidths,
) => void = (preferenceKey: string | null, widths: ColumnWidths): void => {
  if (!preferenceKey) {
    return;
  }

  try {
    const json: JSONObject | null = toColumnWidthsJSON(widths);

    if (!json) {
      UserPreferences.removeUserPreferenceByType({
        key: preferenceKey,
        userPreferenceType: UserPreferenceType.TableColumnWidths,
      });
      return;
    }

    UserPreferences.saveUserPreferenceByTypeAsJSON({
      key: preferenceKey,
      userPreferenceType: UserPreferenceType.TableColumnWidths,
      value: json,
    });
  } catch {
    // Not remembered: the widths still hold while the page is open.
  }
};

const useColumnWidths: (data: {
  /*
   * Which table this is, the same for every page that draws it (a
   * ModelTable's userPreferencesKey, a table's id). Null: the widths are
   * not remembered past the page.
   */
  tableKey: string | null | undefined;
}) => UseColumnWidthsResult = (data: {
  tableKey: string | null | undefined;
}): UseColumnWidthsResult => {
  const preferenceKey: string | null = data.tableKey
    ? getColumnWidthsPreferenceKey({
        tableKey: data.tableKey,
        personId: getPersonId(),
      })
    : null;

  const storeRef: React.MutableRefObject<ColumnWidthsStore | null> =
    useRef<ColumnWidthsStore | null>(null);

  if (!storeRef.current) {
    storeRef.current = new ColumnWidthsStore(
      readStoredColumnWidths(preferenceKey),
    );
  }

  const store: ColumnWidthsStore = storeRef.current;

  // Where a change is written: the table drawn now.
  const keyRef: React.MutableRefObject<string | null> = useRef<string | null>(
    preferenceKey,
  );
  keyRef.current = preferenceKey;

  const loadedKeyRef: React.MutableRefObject<string | null> = useRef<
    string | null
  >(preferenceKey);

  // Another table (a page that reuses its component) reads its own widths.
  useEffect(() => {
    if (loadedKeyRef.current === preferenceKey) {
      return;
    }

    loadedKeyRef.current = preferenceKey;
    store.setWidths(readStoredColumnWidths(preferenceKey));
  }, [preferenceKey, store]);

  /*
   * The same table open in another tab: what is sized there is sized here
   * too, rather than the two tabs overwriting each other's widths.
   */
  useEffect(() => {
    if (!preferenceKey || typeof window === "undefined") {
      return undefined;
    }

    const storageKey: string = `${UserPreferenceType.TableColumnWidths}.${preferenceKey}`;

    const onStorage: (event: StorageEvent) => void = (
      event: StorageEvent,
    ): void => {
      if (event.key !== storageKey && event.key !== null) {
        return;
      }

      store.setWidths(readStoredColumnWidths(preferenceKey));
    };

    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener("storage", onStorage);
    };
  }, [preferenceKey, store]);

  const setColumnWidth: UseColumnWidthsResult["setColumnWidth"] = useCallback(
    (
      columnId: string,
      width: number | null,
      drawnIds?: ReadonlyArray<string> | undefined,
    ): void => {
      const next: ColumnWidths = withColumnWidth({
        widths: store.getWidths(),
        columnId: columnId,
        width: width,
        drawnIds: drawnIds,
      });

      store.setWidths(next);
      writeStoredColumnWidths(keyRef.current, next);
    },
    [store],
  );

  const resetColumnWidths: () => void = useCallback((): void => {
    store.setWidths(EMPTY_COLUMN_WIDTHS);
    writeStoredColumnWidths(keyRef.current, EMPTY_COLUMN_WIDTHS);
  }, [store]);

  return {
    store: store,
    setColumnWidth: setColumnWidth,
    resetColumnWidths: resetColumnWidths,
  };
};

export default useColumnWidths;
