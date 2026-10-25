import React, { createContext, useContext, useMemo } from "react";
import { useWindowDimensions } from "react-native";
import {
  SafeAreaInsetsContext,
  type EdgeInsets,
} from "react-native-safe-area-context";
import {
  READABLE_CONTENT_WIDTH,
  ZERO_INSETS,
  computeWindowLayout,
  getContentGutters,
  type ContentGutters,
  type LayoutInsets,
  type PaneGeometry,
  type WindowLayout,
} from "./windowLayout";

/*
 * The window's layout, worked out once from the real window and the real
 * safe-area insets.
 *
 * Panes hand their contents adjusted insets (a pane that does not touch the
 * window's left edge has no left inset), so a hook deep inside a pane must
 * not recompute the window's layout from the insets it can see: it would
 * come out a few points different from the navigator's. The provider at the
 * app root computes it from the real ones, and everything below reads that.
 */
const WindowLayoutContext: React.Context<WindowLayout | null> =
  createContext<WindowLayout | null>(null);

function useInsetsInContext(): LayoutInsets {
  const insets: EdgeInsets | null = useContext(SafeAreaInsetsContext);
  return insets ?? ZERO_INSETS;
}

function useComputedWindowLayout(): WindowLayout {
  const { width, height } = useWindowDimensions();
  const insets: LayoutInsets = useInsetsInContext();

  return useMemo((): WindowLayout => {
    return computeWindowLayout(
      { width, height },
      {
        top: insets.top,
        right: insets.right,
        bottom: insets.bottom,
        left: insets.left,
      },
    );
  }, [width, height, insets.top, insets.right, insets.bottom, insets.left]);
}

/** Put this inside the SafeAreaProvider, above everything that lays itself out by the window. */
export function WindowLayoutProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const layout: WindowLayout = useComputedWindowLayout();
  return (
    <WindowLayoutContext.Provider value={layout}>
      {children}
    </WindowLayoutContext.Provider>
  );
}

/**
 * The current window's layout. Re-renders whenever the window changes size:
 * a fold, an unfold, a rotation, a split-screen divider dragged.
 *
 * Without a provider (a component rendered on its own in a test) it works the
 * layout out from what it can see.
 */
export function useWindowLayout(): WindowLayout {
  const provided: WindowLayout | null = useContext(WindowLayoutContext);
  const computed: WindowLayout = useComputedWindowLayout();
  return provided ?? computed;
}

export type PaneKind = "full" | "list" | "detail";

export interface PaneLayout extends PaneGeometry {
  /**
   * "full" for a screen that has the whole content area, "list" and
   * "detail" for the two halves of a list and its detail side by side.
   */
  kind: PaneKind;
}

const PaneContext: React.Context<PaneLayout | null> =
  createContext<PaneLayout | null>(null);

/**
 * Gives everything inside it one pane's geometry, and the safe-area insets of
 * only the window edges that pane touches: a list pane beside a detail pane
 * has no right inset to keep clear, a detail pane beside a list has no left
 * one. Headers and sheets inside read the insets they actually need.
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
      top: insets.top,
      bottom: insets.bottom,
      left: pane.insetLeft,
      right: pane.insetRight,
    };
  }, [insets, pane.insetLeft, pane.insetRight]);

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
export function usePane(): PaneLayout {
  const pane: PaneLayout | null = useContext(PaneContext);
  const layout: WindowLayout = useWindowLayout();
  const insets: LayoutInsets = useInsetsInContext();

  return useMemo((): PaneLayout => {
    return (
      pane ?? {
        kind: "full",
        width: layout.contentWidth,
        insetLeft: insets.left,
        insetRight: insets.right,
      }
    );
  }, [pane, layout.contentWidth, insets.left, insets.right]);
}

/**
 * The left and right padding for a screen's scrolling content: clear of the
 * safe area on each side, and centred at a readable width once the pane is
 * wider than that. Spread it after the screen's own padding.
 */
export function useContentGutters(
  readableWidth: number = READABLE_CONTENT_WIDTH,
): ContentGutters {
  const pane: PaneLayout = usePane();
  return useMemo((): ContentGutters => {
    return getContentGutters(pane, readableWidth);
  }, [pane, readableWidth]);
}
