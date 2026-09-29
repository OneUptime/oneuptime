import React from "react";

/**
 * Calls `onChange` when a chart is redrawn over other buckets (a zoom, a
 * reset, a new range), before the browser paints, and never on the first
 * render. The buckets are the labels the chart draws on its x-axis.
 *
 * A chart's click selections (a dot, a bar) point at the buckets they were
 * made on; once those are gone the selection matches nothing, and a
 * selection that dims the rest of the chart would dim all of it.
 */
export default function useChartBucketsChange(
  categoryLabels: Array<string>,
  onChange: () => void,
): void {
  const bucketKey: string = React.useMemo((): string => {
    return categoryLabels.join("\u0000");
  }, [categoryLabels]);
  const lastBucketKeyRef: React.MutableRefObject<string> =
    React.useRef<string>(bucketKey);
  const onChangeRef: React.MutableRefObject<() => void> =
    React.useRef<() => void>(onChange);
  onChangeRef.current = onChange;

  React.useLayoutEffect(() => {
    if (lastBucketKeyRef.current === bucketKey) {
      return;
    }
    lastBucketKeyRef.current = bucketKey;
    onChangeRef.current();
  }, [bucketKey]);
}
