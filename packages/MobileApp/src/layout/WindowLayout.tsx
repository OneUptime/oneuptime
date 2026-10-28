import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Platform, useWindowDimensions } from "react-native";
import {
  SafeAreaInsetsContext,
  type EdgeInsets,
} from "react-native-safe-area-context";
import { getDefaultHeaderHeight } from "@react-navigation/elements";
import {
  READABLE_CONTENT_WIDTH,
  ZERO_INSETS,
  computeWindowLayout,
  getContentGutters,
  type ContentGutters,
  type LayoutInsets,
  type PaneArrangement,
  type PaneGeometry,
  type WindowLayout,
} from "./windowLayout";
import {
  UNKNOWN_POSTURE,
  getWindowPosture,
  type FoldReport,
  type PostureSource,
  type WindowPosture,
} from "./windowPosture";
import { getPlatformPostureSource } from "./postureSource";
import {
  getListPaneWidthPreference,
  setListPaneWidthPreference,
} from "../storage/listPaneWidth";

/*
 * The window's layout, worked out once from the real window and the real
 * safe-area insets.
 *
 * Panes hand their contents adjusted insets (a pane that does not touch the
 * window's left edge has no left inset), so a hook deep inside a pane must
 * not recompute the window's layout from the insets it can see: it would
 * come out a few points different from the navigator's. The provider at the
 * app root computes it from the real ones, and everything below reads that.
 *
 * The provider also listens to the platform for how the window folds
 * (windowPosture.ts) and remembers where the reader left the divider; both
 * are part of the layout everything below reads.
 */
const WindowLayoutContext: React.Context<WindowLayout | null> =
  createContext<WindowLayout | null>(null);

/** Moves the divider between a list and its detail, and remembers where. */
export interface ListPaneWidthControl {
  /** The reader's list width, or null to put the divider back where the layout puts it. */
  setPreferredListPaneWidth: (width: number | null) => void;
}

const NO_LIST_PANE_WIDTH_CONTROL: ListPaneWidthControl = Object.freeze({
  setPreferredListPaneWidth: (): void => {
    // Without a provider there is no layout to move the divider in.
  },
});

const ListPaneWidthContext: React.Context<ListPaneWidthControl> =
  createContext<ListPaneWidthControl>(NO_LIST_PANE_WIDTH_CONTROL);

function useInsetsInContext(): LayoutInsets {
  const insets: EdgeInsets | null = useContext(SafeAreaInsetsContext);
  return insets ?? ZERO_INSETS;
}

function useComputedWindowLayout(
  report: FoldReport | null = null,
  preferredListPaneWidth: number | null = null,
): WindowLayout {
  const { width, height } = useWindowDimensions();
  const insets: LayoutInsets = useInsetsInContext();

  return useMemo((): WindowLayout => {
    const posture: WindowPosture = report
      ? getWindowPosture(report, { width, height })
      : UNKNOWN_POSTURE;
    return computeWindowLayout(
      { width, height },
      {
        top: insets.top,
        right: insets.right,
        bottom: insets.bottom,
        left: insets.left,
      },
      { posture, preferredListPaneWidth },
    );
  }, [
    width,
    height,
    insets.top,
    insets.right,
    insets.bottom,
    insets.left,
    report,
    preferredListPaneWidth,
  ]);
}

/*
 * The latest report from the posture source. A source that has said nothing
 * yet - the app has just started - reads as no report, so the window keeps
 * today's layout until the platform has spoken.
 */
function usePostureReport(source: PostureSource | null): FoldReport | null {
  const [report, setReport] = useState<FoldReport | null>(
    (): FoldReport | null => {
      return source?.getCurrent() ?? null;
    },
  );

  useEffect((): (() => void) | undefined => {
    if (!source) {
      setReport(null);
      return undefined;
    }
    // A report may have arrived between the first render and this effect.
    setReport(source.getCurrent());
    return source.subscribe((next: FoldReport | null): void => {
      setReport(next);
    });
  }, [source]);

  return report;
}

/*
 * Where the reader left the divider. It is read from storage once; moving the
 * divider before that read returns wins over what the read finds.
 */
function useStoredListPaneWidth(): [number | null, (width: number | null) => void] {
  const [preferred, setPreferred] = useState<number | null>(null);
  const movedSinceStart: React.MutableRefObject<boolean> = useRef(false);

  useEffect((): (() => void) => {
    let active: boolean = true;
    getListPaneWidthPreference()
      .then((stored: number | null): void => {
        if (active && stored !== null && !movedSinceStart.current) {
          setPreferred(stored);
        }
      })
      .catch((): void => {
        // Nothing stored, or storage unreadable: the divider starts where the layout puts it.
      });
    return (): void => {
      active = false;
    };
  }, []);

  const update: (width: number | null) => void = useCallback(
    (width: number | null): void => {
      movedSinceStart.current = true;
      setPreferred(width);
      setListPaneWidthPreference(width).catch((): void => {
        // Not remembered this time; the divider still moved.
      });
    },
    [],
  );

  return [preferred, update];
}

export interface WindowLayoutProviderProps {
  children: React.ReactNode;
  /**
   * Where reports of the window's folds come from. Omitted: the platform's
   * own (the native module on Android, the browser on the web). null: none,
   * so every window keeps the layout its size gives it.
   */
  postureSource?: PostureSource | null;
}

/** Put this inside the SafeAreaProvider, above everything that lays itself out by the window. */
export function WindowLayoutProvider({
  children,
  postureSource,
}: WindowLayoutProviderProps): React.JSX.Element {
  const source: PostureSource | null = useMemo((): PostureSource | null => {
    return postureSource === undefined
      ? getPlatformPostureSource()
      : postureSource;
  }, [postureSource]);
  const report: FoldReport | null = usePostureReport(source);
  const [preferredListPaneWidth, setPreferredListPaneWidth] =
    useStoredListPaneWidth();
  const layout: WindowLayout = useComputedWindowLayout(
    report,
    preferredListPaneWidth,
  );
  const control: ListPaneWidthControl = useMemo((): ListPaneWidthControl => {
    return { setPreferredListPaneWidth };
  }, [setPreferredListPaneWidth]);

  return (
    <WindowLayoutContext.Provider value={layout}>
      <ListPaneWidthContext.Provider value={control}>
        {children}
      </ListPaneWidthContext.Provider>
    </WindowLayoutContext.Provider>
  );
}

/**
 * The current window's layout. Re-renders whenever the window changes size:
 * a fold, an unfold, a rotation, a split-screen divider dragged - and when
 * the phone is half folded or opened flat, where the platform reports it.
 *
 * Without a provider (a component rendered on its own in a test) it works the
 * layout out from what it can see, with no posture.
 */
export function useWindowLayout(): WindowLayout {
  const provided: WindowLayout | null = useContext(WindowLayoutContext);
  const computed: WindowLayout = useComputedWindowLayout();
  return provided ?? computed;
}

/** Moves the divider between a list and its detail (see ListPaneWidthControl). */
export function useListPaneWidthControl(): ListPaneWidthControl {
  return useContext(ListPaneWidthContext);
}

export type PaneKind = "full" | "list" | "detail";

export interface PaneLayout extends PaneGeometry {
  /**
   * "full" for a screen that has the whole content area, "list" and
   * "detail" for the two halves of a list and its detail.
   */
  kind: PaneKind;
  /**
   * "stacked" for the two halves of a tabletop fold, the list below the
   * detail; omitted, the panes sit in a row (or there is just the one).
   */
  arrangement?: PaneArrangement;
  /** The pane's height; omitted, the window's (panes in a row are full height). */
  height?: number;
  /**
   * The window insets at the pane's top and bottom edges. Omitted, the
   * window's own: a pane above a tabletop fold has no bottom inset, the one
   * below it no top inset.
   */
  insetTop?: number;
  insetBottom?: number;
  /**
   * Whether the pane reaches the window's bottom edge, where the tab bar
   * floats over content. Omitted, it does.
   */
  reachesBottom?: boolean;
}

/** A pane as screens read it: its height always given. */
export type ResolvedPaneLayout = PaneLayout & { height: number };

const PaneContext: React.Context<PaneLayout | null> =
  createContext<PaneLayout | null>(null);

/**
 * Gives everything inside it one pane's geometry, and the safe-area insets of
 * only the window edges that pane touches: a list pane beside a detail pane
 * has no right inset to keep clear, a detail pane beside a list has no left
 * one, and stacked panes share the top and bottom between them. Headers and
 * sheets inside read the insets they actually need.
 */
export function PaneProvider({
  pane,
  children,
}: {
  pane: PaneLayout;
  children: React.ReactNode;
}): React.JSX.Element {
  const insets: EdgeInsets | null = useContext(SafeAreaInsetsContext);
  const paneInsets: EdgeInsets | null = useMemo((): EdgeInsets | null => {
    if (!insets) {
      return null;
    }
    return {
      top: pane.insetTop ?? insets.top,
      bottom: pane.insetBottom ?? insets.bottom,
      left: pane.insetLeft,
      right: pane.insetRight,
    };
  }, [insets, pane.insetLeft, pane.insetRight, pane.insetTop, pane.insetBottom]);

  return (
    <PaneContext.Provider value={pane}>
      <SafeAreaInsetsContext.Provider value={paneInsets}>
        {children}
      </SafeAreaInsetsContext.Provider>
    </PaneContext.Provider>
  );
}

/**
 * The pane this screen is drawn in. Outside a list and its detail, that is
 * the whole content area beside the navigation.
 */
export function usePane(): ResolvedPaneLayout {
  const pane: PaneLayout | null = useContext(PaneContext);
  const layout: WindowLayout = useWindowLayout();
  const insets: LayoutInsets = useInsetsInContext();

  return useMemo((): ResolvedPaneLayout => {
    if (pane) {
      return { ...pane, height: pane.height ?? layout.height };
    }
    return {
      kind: "full",
      width: layout.contentWidth,
      height: layout.height,
      insetLeft: insets.left,
      insetRight: insets.right,
    };
  }, [pane, layout.contentWidth, layout.height, insets.left, insets.right]);
}

/** What the header rule needs to know about the platform: React Native's Platform, or a stand-in in a test. */
export interface HeaderPlatform {
  OS: string;
  isPad?: boolean;
}

/**
 * The height a header drawn in JavaScript (the list pane's, Home's) must be
 * given to match the bar iOS draws itself, or undefined to keep React
 * Navigation's own.
 *
 * React Navigation draws an iPhone's header 32 points tall whenever the
 * window is wider than it is tall, taking it for a phone on its side. The
 * iPhone Duo held open is wider than tall but 669 points tall - a regular
 * height, where iOS draws its ordinary 44-point bar - and a 32-point header
 * there is too short for the 44-point project switcher, and ends above the
 * native bar of the detail pane beside it. Only that case is corrected:
 * a phone on its side (a compact height) keeps the 32-point bar iOS uses
 * too, and every other window keeps React Navigation's height exactly.
 */
export function getHeaderHeightOverride(
  layout: Pick<WindowLayout, "width" | "height" | "heightClass">,
  topInset: number,
  platform: HeaderPlatform = Platform as HeaderPlatform,
): number | undefined {
  if (platform.OS !== "ios" || platform.isPad) {
    return undefined;
  }
  if (layout.width <= layout.height || layout.heightClass === "compact") {
    return undefined;
  }
  // The height React Navigation gives the same window held upright.
  return getDefaultHeaderHeight(
    { width: layout.height, height: layout.width },
    false,
    topInset,
  );
}

/** getHeaderHeightOverride for the current window and its top inset. */
export function useHeaderHeightOverride(): number | undefined {
  const layout: WindowLayout = useWindowLayout();
  const insets: LayoutInsets = useInsetsInContext();
  return useMemo((): number | undefined => {
    return getHeaderHeightOverride(layout, insets.top);
  }, [layout, insets.top]);
}

/**
 * The left and right padding for a screen's scrolling content: clear of the
 * safe area on each side, and centred at a readable width once the pane is
 * wider than that. Spread it after the screen's own padding.
 */
export function useContentGutters(
  readableWidth: number = READABLE_CONTENT_WIDTH,
): ContentGutters {
  const pane: ResolvedPaneLayout = usePane();
  return useMemo((): ContentGutters => {
    return getContentGutters(pane, readableWidth);
  }, [pane, readableWidth]);
}
