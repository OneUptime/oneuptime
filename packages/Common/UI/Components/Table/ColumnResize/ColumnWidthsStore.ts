import { ColumnWidths, EMPTY_COLUMN_WIDTHS } from "./ColumnWidths";
import { useCallback, useSyncExternalStore } from "react";

/*
 * A table's column widths, held apart from the table's own state.
 *
 * A width kept when an edge is let go must not draw the table's rows again:
 * on a list of hundreds of rows that took a second, the page frozen just
 * as the person let go. So the widths live here, and only what draws them
 * reads them - the header row (TableHeader) and the rules that let a sized
 * column's values use its width (SizedColumnsStyle) - each drawn again on
 * its own. The table itself only reads whether any column is sized, which
 * changes when the first one is and when they are all reset.
 */
export default class ColumnWidthsStore {
  private widths: ColumnWidths;
  private listeners: Set<() => void> = new Set();

  public constructor(widths?: ColumnWidths | undefined) {
    this.widths = widths || EMPTY_COLUMN_WIDTHS;
  }

  public getWidths(): ColumnWidths {
    return this.widths;
  }

  public setWidths(widths: ColumnWidths): void {
    if (widths === this.widths) {
      return;
    }

    this.widths = widths;

    for (const listener of Array.from(this.listeners)) {
      listener();
    }
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);

    return (): void => {
      this.listeners.delete(listener);
    };
  }
}

const EMPTY_STORE: ColumnWidthsStore = new ColumnWidthsStore();

// Every width, drawn again whenever one changes.
export const useColumnWidthsSnapshot: (
  store: ColumnWidthsStore | null | undefined,
) => ColumnWidths = (
  store: ColumnWidthsStore | null | undefined,
): ColumnWidths => {
  const source: ColumnWidthsStore = store || EMPTY_STORE;

  const subscribe: (listener: () => void) => () => void = useCallback(
    (listener: () => void): (() => void) => {
      return source.subscribe(listener);
    },
    [source],
  );

  const getSnapshot: () => ColumnWidths = useCallback((): ColumnWidths => {
    return source.getWidths();
  }, [source]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};

/*
 * One thing read off the widths - whether any column is sized - drawn again
 * only when it changes: a primitive, so a width kept anywhere else in the
 * table leaves the reader as it was.
 */
export const useColumnWidthsValue: <V extends string | number | boolean>(
  store: ColumnWidthsStore | null | undefined,
  read: (widths: ColumnWidths) => V,
) => V = <V extends string | number | boolean>(
  store: ColumnWidthsStore | null | undefined,
  read: (widths: ColumnWidths) => V,
): V => {
  const source: ColumnWidthsStore = store || EMPTY_STORE;

  const subscribe: (listener: () => void) => () => void = useCallback(
    (listener: () => void): (() => void) => {
      return source.subscribe(listener);
    },
    [source],
  );

  const getSnapshot: () => V = (): V => {
    return read(source.getWidths());
  };

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};
