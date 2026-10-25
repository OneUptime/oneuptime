import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { paramsInclude } from "./routeParams";

/*
 * What a list keeps when it moves between layouts.
 *
 * A list is the one screen that changes place when a foldable folds or
 * unfolds: on a narrow window it is the bottom of the stack, on a wide one
 * it is the left pane. React cannot move a component from one parent to
 * another, so the list is drawn afresh in its new place - and anything it
 * held in local state would start over: the search somebody typed, the
 * filter they picked, how far down they had scrolled. Lists keep those in
 * the navigator instead, through the hooks below, so they come back exactly
 * as they were. (The screens opened from a list never move, so they need
 * none of this: their state survives a fold on its own.)
 */

/** The screen open in the detail pane beside a list. */
export interface DetailSelection {
  name: string;
  params?: Record<string, unknown>;
}

interface ListPaneValue {
  /** What is open on the right, or null while the detail pane is empty. */
  selection: DetailSelection | null;
}

const ListPaneContext: React.Context<ListPaneValue | null> =
  createContext<ListPaneValue | null>(null);

/** Marks a list as drawn beside its detail, and says what is open there. */
export function ListPaneProvider({
  selection,
  children,
}: {
  selection: DetailSelection | null;
  children: React.ReactNode;
}): React.JSX.Element {
  const value: ListPaneValue = useMemo((): ListPaneValue => {
    return { selection };
  }, [selection]);
  return (
    <ListPaneContext.Provider value={value}>
      {children}
    </ListPaneContext.Provider>
  );
}

export interface ListPaneState {
  /** Whether this list is drawn beside a detail pane right now. */
  besideDetail: boolean;
  /** Whether this screen, opened with these params, is the one on the right. */
  isOpen: (name: string, params?: Record<string, unknown>) => boolean;
}

/**
 * How a list should draw its rows: whether it sits beside a detail pane (rows
 * then open on the right, so they lose their "go forward" chevron), and which
 * row is the one open there, so it can be marked as selected.
 */
export function useListPane(): ListPaneState {
  const value: ListPaneValue | null = useContext(ListPaneContext);
  return useMemo((): ListPaneState => {
    const selection: DetailSelection | null = value?.selection ?? null;
    return {
      besideDetail: value !== null,
      isOpen: (name: string, params?: Record<string, unknown>): boolean => {
        if (!selection || selection.name !== name) {
          return false;
        }
        /*
         * A row names the record it opens; the open screen may carry more
         * params than that, so only the row's own keys have to match.
         */
        return params === undefined || paramsInclude(selection.params, params);
      },
    };
  }, [value]);
}

interface PaneStateStore {
  values: Map<string, unknown>;
  /** The list route's key: a new list (after a reset) starts afresh. */
  scope: string;
}

const PaneStateContext: React.Context<PaneStateStore | null> =
  createContext<PaneStateStore | null>(null);

/** Owned by the navigator, which outlives every change of layout. */
export function PaneStateScope({
  scope,
  children,
}: {
  scope: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const values: Map<string, unknown> = useRef(
    new Map<string, unknown>(),
  ).current;
  const store: PaneStateStore = useMemo((): PaneStateStore => {
    return { values, scope };
  }, [values, scope]);
  return (
    <PaneStateContext.Provider value={store}>
      {children}
    </PaneStateContext.Provider>
  );
}

function useStoreKey(key: string): {
  store: PaneStateStore | null;
  storeKey: string;
} {
  const store: PaneStateStore | null = useContext(PaneStateContext);
  return { store, storeKey: store ? `${store.scope}:${key}` : key };
}

/**
 * `useState` for a list's view state - its search, filter, selected segment
 * - that survives the list being drawn afresh in another pane. Outside a
 * navigator that can move it, it is plain `useState`.
 */
export function usePaneState<T>(
  key: string,
  initialValue: T,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const { store, storeKey } = useStoreKey(key);
  const [value, setValue] = useState<T>((): T => {
    return store && store.values.has(storeKey)
      ? (store.values.get(storeKey) as T)
      : initialValue;
  });

  useEffect((): void => {
    store?.values.set(storeKey, value);
  }, [store, storeKey, value]);

  return [value, setValue];
}

export interface PaneScrollRestoration {
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onContentSizeChange: (width: number, height: number) => void;
  scrollEventThrottle: number;
}

/**
 * Brings a list back to where it was scrolled when it is drawn afresh in
 * another pane. The position is put back as soon as the content is tall
 * enough to hold it - which, with the rows already loaded, is the first
 * layout.
 */
export function usePaneScrollRestoration(
  key: string,
  scrollTo: (offsetY: number) => void,
): PaneScrollRestoration {
  const { store, storeKey } = useStoreKey(key);
  const savedOffset: React.MutableRefObject<number> = useRef<number>(
    typeof store?.values.get(storeKey) === "number"
      ? (store.values.get(storeKey) as number)
      : 0,
  );
  const restored: React.MutableRefObject<boolean> = useRef<boolean>(
    savedOffset.current <= 0,
  );
  const scrollToRef: React.MutableRefObject<(offsetY: number) => void> =
    useRef(scrollTo);
  scrollToRef.current = scrollTo;

  const onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void =
    useCallback(
      (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
        const offsetY: number = event.nativeEvent?.contentOffset?.y ?? 0;
        store?.values.set(storeKey, offsetY);
      },
      [store, storeKey],
    );

  const onContentSizeChange: (width: number, height: number) => void =
    useCallback((_width: number, height: number): void => {
      if (restored.current || height <= savedOffset.current) {
        return;
      }
      restored.current = true;
      scrollToRef.current(savedOffset.current);
    }, []);

  return { onScroll, onContentSizeChange, scrollEventThrottle: 32 };
}
