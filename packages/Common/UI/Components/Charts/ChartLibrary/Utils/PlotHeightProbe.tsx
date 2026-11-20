import React from "react";
import { usePlotArea } from "recharts";
import { getMostValueAxisTicks } from "../../Utils/ValueAxisTicks";

/*
 * THE PLOT'S HEIGHT, AS RECHARTS LAID IT OUT (issue #10117).
 *
 * A value axis is stepped in about five round ticks, but never more than
 * its plot has room for (ValueAxisTicks' getMostValueAxisTicks): on a short
 * card six ticks sat 16px apart, recharts hid every other label, and the
 * axis read "250 KB/s", "750 KB/s", "1.25 MB/s", its zero gone. The plot's
 * height is only known once recharts has laid the chart out, legend and
 * time axis and all, so PlotHeightProbe reads it from inside the chart
 * (recharts 3 hands any child its context), and the chart steps its axes
 * again only when the ticks the plot has room for change.
 */

export interface PlotRoom {
  // The most ticks the plot has room for; undefined until it is laid out.
  mostTicks: number | undefined;
  // What PlotHeightProbe hands the plot's height to.
  onPlotHeight: (plotHeightInPx: number) => void;
}

// The ticks a chart's plot has room for, as its PlotHeightProbe measures it.
export function usePlotRoom(): PlotRoom {
  const [mostTicks, setMostTicks] = React.useState<number | undefined>(
    undefined,
  );
  const onPlotHeight: (plotHeightInPx: number) => void = React.useCallback(
    (plotHeightInPx: number): void => {
      // The same count draws nothing again: React keeps the state it has.
      setMostTicks(getMostValueAxisTicks(plotHeightInPx));
    },
    [],
  );

  return { mostTicks: mostTicks, onPlotHeight: onPlotHeight };
}

// Draws nothing: hands the chart its plot's height, each time it changes.
const PlotHeightProbe: React.FunctionComponent<{
  onPlotHeight: (plotHeightInPx: number) => void;
}> = (props: { onPlotHeight: (plotHeightInPx: number) => void }): null => {
  const plotArea: ReturnType<typeof usePlotArea> = usePlotArea();
  const plotHeightInPx: number | undefined = plotArea
    ? Math.round(plotArea.height)
    : undefined;

  React.useEffect((): void => {
    if (plotHeightInPx !== undefined && plotHeightInPx > 0) {
      props.onPlotHeight(plotHeightInPx);
    }
  }, [plotHeightInPx, props.onPlotHeight]);

  return null;
};

export default PlotHeightProbe;
