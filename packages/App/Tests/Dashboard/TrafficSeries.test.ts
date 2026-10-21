import { describe, expect, test } from "@jest/globals";
import { fillTrafficSeriesGaps } from "../../FeatureSet/Dashboard/src/Components/NetworkTraffic/TrafficSeries";
import { NetworkTrafficSeriesPoint } from "Common/Types/NetFlow/NetworkTraffic";

/*
 * The API returns only the buckets that carried traffic. Before they are
 * drawn the silent ones are put back as zero, or a device that talked for
 * five minutes at each end of a day would draw one continuous line, and the
 * peak would be read off the busy buckets alone.
 */

const START: string = "2026-10-01T10:00:00.000Z";
const END: string = "2026-10-01T10:10:00.000Z";

describe("fillTrafficSeriesGaps", () => {
  test("puts back every silent bucket of the window as zero, in order", () => {
    const filled: Array<NetworkTrafficSeriesPoint> = fillTrafficSeriesGaps(
      [
        { time: "2026-10-01 10:02:00", octets: 200 },
        { time: "2026-10-01 10:07:00", octets: 700 },
      ],
      60,
      START,
      END,
    );

    expect(filled).toHaveLength(10);
    expect(
      filled.map((point: NetworkTrafficSeriesPoint): number => {
        return point.octets;
      }),
    ).toEqual([0, 0, 200, 0, 0, 0, 0, 700, 0, 0]);
  });

  test("keeps the API's own points as they were sent", () => {
    const busy: NetworkTrafficSeriesPoint = {
      time: "2026-10-01 10:02:00",
      octets: 200,
    };

    const filled: Array<NetworkTrafficSeriesPoint> = fillTrafficSeriesGaps(
      [busy],
      60,
      START,
      END,
    );

    expect(filled).toContainEqual(busy);
  });

  test("with in and out (an interface filter), a silent bucket is zero both ways", () => {
    const filled: Array<NetworkTrafficSeriesPoint> = fillTrafficSeriesGaps(
      [
        {
          time: "2026-10-01 10:01:00",
          octets: 300,
          inOctets: 200,
          outOctets: 100,
        },
      ],
      60,
      START,
      END,
    );

    expect(filled[0]).toEqual({
      time: expect.any(String),
      octets: 0,
      inOctets: 0,
      outOctets: 0,
    });
    expect(filled[1]).toEqual({
      time: "2026-10-01 10:01:00",
      octets: 300,
      inOctets: 200,
      outOctets: 100,
    });
  });

  test("without in and out, a silent bucket has neither", () => {
    const filled: Array<NetworkTrafficSeriesPoint> = fillTrafficSeriesGaps(
      [{ time: "2026-10-01 10:01:00", octets: 300 }],
      60,
      START,
      END,
    );

    expect(filled[0]).toEqual({ time: expect.any(String), octets: 0 });
  });

  test("an empty series over a window is a flat zero line", () => {
    const filled: Array<NetworkTrafficSeriesPoint> = fillTrafficSeriesGaps(
      [],
      60,
      START,
      END,
    );

    for (const point of filled) {
      expect(point.octets).toBe(0);
    }
  });

  test("wider buckets are filled at their own width", () => {
    const filled: Array<NetworkTrafficSeriesPoint> = fillTrafficSeriesGaps(
      [{ time: "2026-10-01 10:05:00", octets: 50 }],
      300,
      START,
      END,
    );

    expect(
      filled.map((point: NetworkTrafficSeriesPoint): number => {
        return point.octets;
      }),
    ).toEqual([0, 50]);
  });
});
