import React, { FunctionComponent, ReactElement, useMemo } from "react";
import Log from "Common/Models/AnalyticsModels/Log";
import LogSeverity from "Common/Types/Log/LogSeverity";
import { BarChart } from "Common/UI/Components/Charts/ChartLibrary/BarChart/BarChart";

export interface ComponentProps {
  logs: Array<Log>;
  height?: number;
  from?: Date | null; // optional time filter lower bound
  to?: Date | null; // optional upper bound
}

interface BucketData {
  [key: string]: number | string;
  bucket: string;
}

const ORDERED_SEVERITIES: Array<LogSeverity> = [
  LogSeverity.Fatal,
  LogSeverity.Error,
  LogSeverity.Warning,
  LogSeverity.Information,
  LogSeverity.Debug,
  LogSeverity.Trace,
];

const LogVolumeChart: FunctionComponent<ComponentProps> = ({
  logs,
  height = 120,
  from,
  to,
}: ComponentProps): ReactElement => {
  const { data, categories } = useMemo(() => {
    if (logs.length === 0) {
      return { data: [] as Array<BucketData>, categories: [] as Array<string> };
    }
    const times: Array<number> = logs
      .filter((l) => {
        return l.time;
      })
      .map((l) => {
        return new Date(l.time as Date).getTime();
      });
    if (times.length === 0) {
      return { data: [], categories: [] };
    }
    const min: number = from ? from.getTime() : Math.min(...times);
    const max: number = to ? to.getTime() : Math.max(...times);
    const range: number = Math.max(max - min, 60_000); // at least 1 min
    const targetBuckets = 60; // aim ~60 bars
    const bucketSize: number = Math.max(
      Math.floor(range / targetBuckets),
      1000,
    ); // >=1s
    const bucketCount: number = Math.ceil(range / bucketSize);

    const buckets: Array<BucketData> = new Array(bucketCount)
      .fill(null)
      .map((_, i) => {
        const bucketStart = min + i * bucketSize;
        return {
          bucket: new Date(bucketStart).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
        } as BucketData;
      });

    const severitySet = new Set<LogSeverity>();

    logs.forEach((log) => {
      if (!log.time) {
        return;
      }
      const t = new Date(log.time as Date).getTime();
      if (t < min || t > max) {
        return;
      }
      const idx = Math.min(Math.floor((t - min) / bucketSize), bucketCount - 1);
      const sev = (log.severityText as LogSeverity) || LogSeverity.Information;
      severitySet.add(sev);
      const bucket = buckets[idx];
      if (bucket) {
        bucket[sev] = ((bucket[sev] as number) || 0) + 1;
      }
    });

    // Fill missing severities with 0 for consistent stacking
    buckets.forEach((b) => {
      ORDERED_SEVERITIES.forEach((sev) => {
        if (severitySet.has(sev) && typeof b[sev] === "undefined") {
          b[sev] = 0;
        }
      });
    });

    const categories: Array<string> = ORDERED_SEVERITIES.filter((sev) => {
      return severitySet.has(sev);
    });
    return { data: buckets, categories };
  }, [logs, from, to]);

  if (data.length === 0) {
    return (
      <div className="h-[120px] flex items-center justify-center text-xs text-gray-400">
        No data for chart
      </div>
    );
  }

  return (
    <div style={{ height }} className="w-full">
      <BarChart
        data={data}
        index="bucket"
        categories={categories}
        showLegend={true}
        showYAxis={false}
        showGridLines={false}
        startEndOnly={true}
        autoMinValue={true}
        className="text-[10px]"
        valueFormatter={(v: number) => {
          return v.toString();
        }}
        type="stacked"
        barCategoryGap={2}
        yAxisWidth={0}
        showTooltip={true}
        legendPosition="left"
      />
    </div>
  );
};

export default LogVolumeChart;
