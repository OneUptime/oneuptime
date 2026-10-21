import fillFlowSeriesGaps, {
  FlowSeriesPointLike,
} from "../NetworkDevice/FlowSeriesUtil";
import { NetworkTrafficSeriesPoint } from "Common/Types/NetFlow/NetworkTraffic";

/*
 * Traffic over time, with the silent buckets put back. The API returns only
 * buckets that carried traffic (a plain GROUP BY); without the gaps a device
 * that talked for five minutes at each end of a day would draw one
 * continuous line, and the average and peak would be taken over the busy
 * buckets alone. The gap filling is the device page's long-standing one
 * (FlowSeriesUtil), which keys buckets the way the chart places them.
 *
 * Plain logic, free of React, so App/Tests can read it.
 */
export function fillTrafficSeriesGaps(
  series: Array<NetworkTrafficSeriesPoint>,
  bucketSeconds: number,
  windowStartAt: string,
  windowEndAt: string,
): Array<NetworkTrafficSeriesPoint> {
  const hasDirections: boolean = series.some(
    (point: NetworkTrafficSeriesPoint): boolean => {
      return point.inOctets !== undefined || point.outOctets !== undefined;
    },
  );

  const byTime: Map<string, NetworkTrafficSeriesPoint> = new Map(
    series.map(
      (
        point: NetworkTrafficSeriesPoint,
      ): [string, NetworkTrafficSeriesPoint] => {
        return [point.time, point];
      },
    ),
  );

  const filled: Array<FlowSeriesPointLike> = fillFlowSeriesGaps(
    series.map((point: NetworkTrafficSeriesPoint): FlowSeriesPointLike => {
      return { time: point.time, octets: point.octets, packets: 0 };
    }),
    bucketSeconds,
    windowStartAt,
    windowEndAt,
  );

  return filled.map((point: FlowSeriesPointLike): NetworkTrafficSeriesPoint => {
    const original: NetworkTrafficSeriesPoint | undefined = byTime.get(
      point.time,
    );

    if (original) {
      return original;
    }

    const empty: NetworkTrafficSeriesPoint = {
      time: point.time,
      octets: 0,
    };

    if (hasDirections) {
      empty.inOctets = 0;
      empty.outOctets = 0;
    }

    return empty;
  });
}
