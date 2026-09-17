import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import LineChartElement from "Common/UI/Components/Charts/Line/LineChart";
import SeriesPoint from "Common/UI/Components/Charts/Types/SeriesPoints";
import ChartCurve from "Common/UI/Components/Charts/Types/ChartCurve";
import XAxisType from "Common/UI/Components/Charts/Types/XAxis/XAxisType";
import YAxisType from "Common/UI/Components/Charts/Types/YAxis/YAxisType";
import {
  XAxis as ChartXAxis,
  XAxisAggregateType,
} from "Common/UI/Components/Charts/Types/XAxis/XAxis";
import YAxis, {
  YAxisPrecision,
} from "Common/UI/Components/Charts/Types/YAxis/YAxis";
import ValueFormatter from "Common/Utils/ValueFormatter";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import API from "Common/UI/Utils/API/API";
import KubernetesNetworkUtils, {
  NetworkThroughputSeries,
} from "../Utils/KubernetesNetworkUtils";

export interface ComponentProps {
  clusterIdentifier: string;
  nodeName?: string | undefined;
  startDate: Date;
  endDate: Date;
  heightInPx?: number | undefined;
  syncId?: string | undefined;
}

const KubernetesNetworkThroughputChart: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [series, setSeries] = useState<Array<SeriesPoint>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const startMs: number = props.startDate.getTime();
  const endMs: number = props.endDate.getTime();

  useEffect(() => {
    let cancelled: boolean = false;

    const load: () => Promise<void> = async (): Promise<void> => {
      setIsLoading(true);
      setError("");
      try {
        const result: NetworkThroughputSeries =
          await KubernetesNetworkUtils.fetchNetworkThroughput({
            clusterIdentifier: props.clusterIdentifier,
            nodeName: props.nodeName,
            startDate: new Date(startMs),
            endDate: new Date(endMs),
          });
        if (cancelled) {
          return;
        }
        const next: Array<SeriesPoint> = [];
        if (result.receive.length > 0) {
          next.push({ seriesName: "Received", data: result.receive });
        }
        if (result.transmit.length > 0) {
          next.push({ seriesName: "Transmitted", data: result.transmit });
        }
        setSeries(next);
      } catch (err) {
        if (!cancelled) {
          setError(API.getFriendlyMessage(err));
        }
      }
      if (!cancelled) {
        setIsLoading(false);
      }
    };

    load().catch((err: Error) => {
      if (!cancelled) {
        setError(API.getFriendlyMessage(err));
      }
    });

    return () => {
      cancelled = true;
    };
    // startMs/endMs track the date props by value so identical ranges don't refetch.
  }, [props.clusterIdentifier, props.nodeName, startMs, endMs]);

  if (isLoading) {
    return <div className="h-48 animate-pulse rounded-md bg-gray-50" />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (series.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-gray-400">
        No network traffic reported for the selected time range.
      </div>
    );
  }

  const xAxis: ChartXAxis = {
    legend: "Time",
    options: {
      type: XAxisType.Time,
      min: props.startDate,
      max: props.endDate,
      aggregateType: XAxisAggregateType.Average,
    },
  };

  const yAxis: YAxis = {
    legend: "B/s",
    options: {
      type: YAxisType.Number,
      min: 0,
      max: "auto",
      precision: YAxisPrecision.NoDecimals,
      formatter: (value: number): string => {
        return ValueFormatter.formatValue(value, "By/s");
      },
    },
  };

  const syncId: string =
    props.syncId ||
    `k8s-network-throughput-${props.clusterIdentifier}${
      props.nodeName ? `-${props.nodeName}` : ""
    }`;

  return (
    <LineChartElement
      data={series}
      xAxis={xAxis}
      yAxis={yAxis}
      curve={ChartCurve.MONOTONE}
      heightInPx={props.heightInPx ?? 300}
      showLegend={series.length > 1}
      sync={true}
      syncid={syncId}
    />
  );
};

export default KubernetesNetworkThroughputChart;
