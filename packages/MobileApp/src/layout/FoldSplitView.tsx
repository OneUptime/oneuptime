import React, { useContext, useMemo } from "react";
import { ScrollView, View, type ScrollViewProps } from "react-native";
import { HeaderHeightContext } from "@react-navigation/elements";
import { useTheme } from "../theme";
import { spacing } from "../theme/tokens";
import PaneGap from "../components/PaneGap";
import { useScreenPadding } from "../hooks/useScreenPadding";
import {
  PaneProvider,
  useContentGutters,
  usePane,
  useWindowLayout,
  type PaneLayout,
  type ResolvedPaneLayout,
} from "./WindowLayout";
import { READABLE_CONTENT_WIDTH, type WindowLayout } from "./windowLayout";
import { getFoldSplit, type FoldSplit } from "./foldSplit";

/*
 * A one-pane screen in two halves when a tabletop fold runs across it
 * (foldSplit.ts): what is worth reading above the fold, the rows to tap
 * below it, the band around the crease between them.
 */

/**
 * How a tabletop fold splits the screen this is called in, or null where the
 * screen stays one scroll. The screen starts where the bar above it ends.
 */
export function useFoldSplit(): FoldSplit | null {
  const layout: WindowLayout = useWindowLayout();
  // The bar above this screen; nothing outside a navigator (a test).
  const headerHeight: number | undefined = useContext(HeaderHeightContext);

  return useMemo((): FoldSplit | null => {
    return getFoldSplit(layout, headerHeight ?? 0);
  }, [layout, headerHeight]);
}

export interface FoldSplitViewProps {
  split: FoldSplit;
  /** What is worth reading from across the table: above the fold. */
  above: React.ReactNode;
  /**
   * The rows to tap: below the fold, on the half lying on the table. None
   * for a screen with nothing to tap there yet (loading, or no project):
   * the half stays empty, with no line on the crease above an empty half.
   */
  below?: React.ReactNode;
  /**
   * Names the halves and the band: "<id>-above", "<id>-below", "<id>-gap"
   * and its line "<id>-fold-line".
   */
  testID: string;
}

/**
 * The two halves, each a pane of its own (WindowLayout's PaneProvider): the
 * one above the fold ends at the band, with no bottom inset and no tab bar
 * over it; the one below starts at the band and reaches the window's bottom
 * edge, where the bar floats. In that order for a screen reader too: the
 * half above the fold is read first.
 */
export function FoldSplitView({
  split,
  above,
  below,
  testID,
}: FoldSplitViewProps): React.JSX.Element {
  const { theme } = useTheme();
  const pane: ResolvedPaneLayout = usePane();
  const hasBelow: boolean =
    below !== null && below !== undefined && below !== false;

  const abovePane: PaneLayout = useMemo((): PaneLayout => {
    return {
      kind: pane.kind,
      arrangement: "stacked",
      width: pane.width,
      height: split.aboveHeight,
      insetLeft: pane.insetLeft,
      insetRight: pane.insetRight,
      // Its bottom edge is the fold's band, not the window's.
      insetBottom: 0,
      reachesBottom: false,
    };
  }, [
    pane.kind,
    pane.width,
    pane.insetLeft,
    pane.insetRight,
    split.aboveHeight,
  ]);

  const belowPane: PaneLayout = useMemo((): PaneLayout => {
    return {
      kind: pane.kind,
      arrangement: "stacked",
      width: pane.width,
      height: split.belowHeight,
      insetLeft: pane.insetLeft,
      insetRight: pane.insetRight,
      // Its top edge is the fold's band.
      insetTop: 0,
    };
  }, [
    pane.kind,
    pane.width,
    pane.insetLeft,
    pane.insetRight,
    split.belowHeight,
  ]);

  return (
    <View
      testID={testID}
      style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
    >
      <View testID={`${testID}-above`} style={{ height: split.aboveHeight }}>
        <PaneProvider pane={abovePane}>{above}</PaneProvider>
      </View>
      {hasBelow ? (
        <PaneGap
          size={split.gap}
          stacked
          testID={`${testID}-gap`}
          lineTestID={`${testID}-fold-line`}
        />
      ) : (
        <View testID={`${testID}-gap`} style={{ height: split.gap }} />
      )}
      <View testID={`${testID}-below`} style={{ flex: 1 }}>
        {hasBelow ? (
          <PaneProvider pane={belowPane}>{below}</PaneProvider>
        ) : null}
      </View>
    </View>
  );
}

export interface FoldPaneScrollViewProps {
  testID: string;
  /** The width cards and text stop growing at (windowLayout.ts). */
  readableWidth?: number;
  /** The space between the sections. */
  gap?: number;
  refreshControl?: ScrollViewProps["refreshControl"];
  contentInsetAdjustmentBehavior?: ScrollViewProps["contentInsetAdjustmentBehavior"];
  children: React.ReactNode;
}

/**
 * One half's scroll, padded for the pane it is drawn in: the screen's gutters
 * at its readable width, and at its end room for the tab bar only below the
 * fold, where the bar floats.
 */
export function FoldPaneScrollView({
  testID,
  readableWidth = READABLE_CONTENT_WIDTH,
  gap = spacing.xxl,
  refreshControl,
  contentInsetAdjustmentBehavior,
  children,
}: FoldPaneScrollViewProps): React.JSX.Element {
  const { theme } = useTheme();
  const paddingBottom: number = useScreenPadding();
  const gutters: ReturnType<typeof useContentGutters> =
    useContentGutters(readableWidth);

  return (
    <ScrollView
      testID={testID}
      style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
      contentInsetAdjustmentBehavior={contentInsetAdjustmentBehavior}
      contentContainerStyle={{
        padding: spacing.xl,
        ...gutters,
        paddingBottom,
        gap,
      }}
      refreshControl={refreshControl}
    >
      {children}
    </ScrollView>
  );
}
