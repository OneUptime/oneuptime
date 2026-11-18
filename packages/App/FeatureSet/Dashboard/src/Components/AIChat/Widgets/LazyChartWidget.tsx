/*
 * Type-only on purpose: the one place the chart is loaded is the import()
 * below, so recharts stays out of the first load of every Dashboard page.
 */
import type ChartWidget from "./ChartWidget";
import type { ComponentProps } from "./ChartWidget";
import ChunkLoadRecovery, {
  ChunkLoadRecoveryVariant,
} from "Common/UI/Components/NewVersion/ChunkLoadRecovery";
import ChartSkeleton from "Common/UI/Components/Skeleton/ChartSkeleton";
import {
  LazyLibrary,
  LazyLibraryLoad,
  useLazyLibraryLoad,
} from "Common/UI/Utils/LazyLibrary";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A chart Ask AI draws in an answer, or an investigation shows as evidence.
 * The Ask AI panel is part of every Dashboard page (App.tsx), and drew its
 * charts through a static import: recharts and Common's chart library were
 * in the first load of every page, some 183 KiB gzipped, though most pages
 * are read without a chat that draws a chart (issue #9335). So the chart is
 * a file of its own, asked for as the panel opens (loadChartWidget,
 * AskAiPanel.tsx) and there by the time an answer draws one.
 */
const chartWidget: LazyLibrary<typeof ChartWidget> = new LazyLibrary<
  typeof ChartWidget
>(async (): Promise<typeof ChartWidget> => {
  return (await import("./ChartWidget")).default;
});

// Loads the chart, once however many ask; a failed load is retried.
export const loadChartWidget: () => Promise<typeof ChartWidget> = (): Promise<
  typeof ChartWidget
> => {
  return chartWidget.load();
};

// ChartWidget's plot (h-60) and, over a time axis, the zoom hint's row (min-h-6).
export const CHART_PLOT_HEIGHT_IN_PX: number = 240;
export const CHART_ZOOM_ROW_HEIGHT_IN_PX: number = 24;

// As tall as the chart ChartWidget draws for the widget, so nothing moves when it arrives.
export const getChartSkeletonHeightInPx: (props: ComponentProps) => number = (
  props: ComponentProps,
): number => {
  return props.widget.data.xIsTime !== false
    ? CHART_PLOT_HEIGHT_IN_PX + CHART_ZOOM_ROW_HEIGHT_IN_PX
    : CHART_PLOT_HEIGHT_IN_PX;
};

const LazyChartWidget: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const load: LazyLibraryLoad<typeof ChartWidget> = useLazyLibraryLoad(
    chartWidget,
    true,
  );

  if (load.error) {
    /*
     * Its file did not arrive - usually a new version deployed while the tab
     * was open. The chart's place says so and offers the new version, as
     * every part of a page whose code will not download does
     * (ChunkLoadRecovery). Not thrown: the Ask AI panel is drawn outside the
     * page's error boundary (App.tsx), so the answer and the rest of the
     * page stay.
     */
    return (
      <ChunkLoadRecovery
        error={load.error}
        variant={ChunkLoadRecoveryVariant.Part}
      />
    );
  }

  if (!load.library) {
    return <ChartSkeleton heightInPx={getChartSkeletonHeightInPx(props)} />;
  }

  const Chart: typeof ChartWidget = load.library;

  return <Chart {...props} />;
};

export default LazyChartWidget;
