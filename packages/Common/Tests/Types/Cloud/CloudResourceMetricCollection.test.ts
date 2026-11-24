import { describe, expect, test } from "@jest/globals";
import {
  CLOUD_METRIC_ERROR_MAX_LENGTH,
  CloudMetricCollectionState,
  CloudMetricNotRead,
  CloudMetricNotReadKind,
  readCloudMetricNotRead,
  readCloudResourceMetricCollection,
  readCloudResourceMetricStatus,
  sortCloudMetricsNotRead,
  trimCloudMetricError,
} from "../../../Types/Cloud/CloudResourceMetricCollection";

/*
 * How a cloud resource's metrics were collected (#10291), as the server
 * keeps and answers it: read defensively, what will not pass first.
 */

const SINCE: string = "2026-11-19T10:00:00.000Z";
const AT: string = "2026-11-19T12:00:00.000Z";

function notRead(
  name: string,
  kind: CloudMetricNotReadKind,
): CloudMetricNotRead {
  return { name, kind, error: "e", since: SINCE, at: AT };
}

describe("a metric not read", () => {
  test("is read with its times as ISO times; one without a name, a kind it knows or its times is none", () => {
    expect(
      readCloudMetricNotRead({
        name: "ByteHitRatio",
        kind: "unsupported",
        error: "Sampling type is not found.",
        since: "2026-11-19T10:00:00Z",
        at: "2026-11-19T12:00:00Z",
        until: "2026-11-20T12:00:00Z",
      }),
    ).toEqual({
      name: "ByteHitRatio",
      kind: CloudMetricNotReadKind.Unsupported,
      error: "Sampling type is not found.",
      since: SINCE,
      at: AT,
      until: "2026-11-20T12:00:00.000Z",
    });
    expect(
      readCloudMetricNotRead({ name: "A", kind: "busy", since: SINCE, at: AT }),
    ).toBeNull();
    expect(
      readCloudMetricNotRead({ kind: "failed", since: SINCE, at: AT }),
    ).toBeNull();
    expect(
      readCloudMetricNotRead({ name: "A", kind: "failed", since: "x", at: AT }),
    ).toBeNull();
    expect(readCloudMetricNotRead([])).toBeNull();
    // No error: an empty one.
    expect(
      readCloudMetricNotRead({
        name: "A",
        kind: "failed",
        since: SINCE,
        at: AT,
      })?.error,
    ).toBe("");
  });

  test("Azure's words on one line, cut at the most a status keeps", () => {
    expect(trimCloudMetricError("  Too   many\nqueries ")).toBe(
      "Too many queries",
    );

    const long: string = trimCloudMetricError("y".repeat(1000));

    expect(long).toHaveLength(CLOUD_METRIC_ERROR_MAX_LENGTH);
    expect(long.endsWith("…")).toBe(true);
  });

  test("what will not pass first, then by name", () => {
    expect(
      sortCloudMetricsNotRead([
        notRead("b", CloudMetricNotReadKind.Throttled),
        notRead("z", CloudMetricNotReadKind.Failed),
        notRead("a", CloudMetricNotReadKind.Throttled),
        notRead("m", CloudMetricNotReadKind.Unsupported),
      ]).map((metric: CloudMetricNotRead): string => {
        return `${metric.kind}:${metric.name}`;
      }),
    ).toEqual(["unsupported:m", "failed:z", "throttled:a", "throttled:b"]);
  });
});

describe("what a connection keeps of a resource", () => {
  test("its failure and its metrics, by lowercased name; what is not one, dropped", () => {
    expect(
      readCloudResourceMetricStatus({
        failed: { error: "busy", since: SINCE, at: AT },
        metrics: {
          CpuPercentage: {
            name: "CpuPercentage",
            kind: "throttled",
            error: "ServerBusy",
            since: SINCE,
            at: AT,
          },
          broken: { name: "x" },
        },
      }),
    ).toEqual({
      failed: { error: "busy", since: SINCE, at: AT },
      metrics: {
        cpupercentage: {
          name: "CpuPercentage",
          kind: CloudMetricNotReadKind.Throttled,
          error: "ServerBusy",
          since: SINCE,
          at: AT,
        },
      },
    });
    expect(readCloudResourceMetricStatus(null)).toEqual({});
    expect(
      readCloudResourceMetricStatus({ failed: { error: "x", since: "never" } }),
    ).toEqual({});
  });
});

describe("the server's answer", () => {
  test("read as the page shows it; null when it says nothing of the resource", () => {
    expect(
      readCloudResourceMetricCollection({
        collection: {
          state: "partial",
          lastReadAt: "2026-11-19T12:00:00Z",
          metrics: [
            notRead("CpuPercentage", CloudMetricNotReadKind.Throttled),
            notRead("ByteHitRatio", CloudMetricNotReadKind.Unsupported),
            { name: "bad" },
          ],
        },
      }),
    ).toEqual({
      state: CloudMetricCollectionState.Partial,
      lastReadAt: AT,
      metrics: [
        notRead("ByteHitRatio", CloudMetricNotReadKind.Unsupported),
        notRead("CpuPercentage", CloudMetricNotReadKind.Throttled),
      ],
    });
    expect(
      readCloudResourceMetricCollection({
        collection: {
          state: "failed",
          lastReadAt: null,
          failedSince: SINCE,
          error: "Azure metrics request failed with HTTP 529.",
        },
      }),
    ).toEqual({
      state: CloudMetricCollectionState.Failed,
      lastReadAt: null,
      failedSince: SINCE,
      error: "Azure metrics request failed with HTTP 529.",
      metrics: [],
    });
    expect(readCloudResourceMetricCollection({ collection: null })).toBeNull();
    expect(
      readCloudResourceMetricCollection({ collection: { state: "fine" } }),
    ).toBeNull();
    expect(readCloudResourceMetricCollection(undefined)).toBeNull();
  });
});
