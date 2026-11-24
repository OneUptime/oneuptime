import { describe, expect, test } from "@jest/globals";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import {
  SeededRandom,
  seededRandom,
  shuffled,
} from "../../Helpers/SeededRandom";
import {
  APP_ENGINE_ERROR_LABEL,
  CLOUD_RUN_ERROR_LABEL,
  CONTAINER_APP_ERROR_LABEL,
  CloudAppPlatformFigure,
  CloudAppPlatformMetricRead,
  CloudAppPlatformPoint,
  CloudAppPlatformProfile,
  CloudAppPlatformSplitPoint,
  CloudAppPlatformSummary,
  getCloudAppPlatformListReads,
  getCloudAppPlatformProfile,
  readCloudAppPlatformSplit,
  summarizeCloudAppPlatformSeries,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/Utils/CloudAppPlatformMetrics";
import { getCloudAppPlatformTilesGridClassName } from "../../../../App/FeatureSet/Dashboard/src/Components/AppPlatforms/CloudAppPlatformMonitorCard";

/*
 * A PLATFORM SECTION'S FIGURES, FROM WHAT ITS CLOUD CONNECTION STORES
 * (#10837, #10838).
 *
 * A Container App's Requests are read once per status code category since
 * #10837, a Cloud Run service's request count per response_code_class and
 * an App Engine service's per response_code: the section reads each once,
 * grouped by that label, for its requests and the 5xx among them. These
 * pin how those groups add up - every request counts, the 5xx are the
 * label's server errors, and the share is of the requests whose code was
 * read, so requests stored whole (a Container App's, before the split)
 * never read as 0% - and what each platform's section shows: a Container
 * App's share of 5xx, an App Engine service's CPU and memory.
 */

const MINUTE_MS: number = 60 * 1000;
const START: number = Date.parse("2026-11-24T10:00:00.000Z");

function at(minute: number): Date {
  return new Date(START + minute * MINUTE_MS);
}

function point(
  minute: number,
  label: string,
  y: number,
): CloudAppPlatformSplitPoint {
  return { x: at(minute), label, y };
}

function valuesOf(points: Array<CloudAppPlatformPoint>): Array<string> {
  return points.map((each: CloudAppPlatformPoint): string => {
    return `${(each.x.getTime() - START) / MINUTE_MS}:${each.y}`;
  });
}

describe("a request count read by its response code", () => {
  test("a Container App's: every request counts, its 5xx category is its server errors, of the requests that carry a category", () => {
    const split: ReturnType<typeof readCloudAppPlatformSplit> =
      readCloudAppPlatformSplit({
        points: [
          point(0, "2xx", 90),
          point(0, "4xx", 6),
          point(0, "5xx", 4),
          // A minute with no 5xx at all: none was answered with one.
          point(1, "2xx", 50),
          // A minute stored before the split: its errors are not known.
          point(2, "", 70),
          // A minute of both.
          point(3, "", 10),
          point(3, "5xx", 5),
        ],
        errorLabel: CONTAINER_APP_ERROR_LABEL,
        scale: 1,
      });

    expect(valuesOf(split.requests)).toEqual(["0:100", "1:50", "2:70", "3:15"]);
    expect(valuesOf(split.serverErrors)).toEqual(["0:4", "1:0"]);
    expect(valuesOf(split.classifiedRequests)).toEqual(["0:100", "1:50"]);

    const summary: CloudAppPlatformSummary = summarizeCloudAppPlatformSeries({
      [CloudAppPlatformFigure.Requests]: split.requests,
      [CloudAppPlatformFigure.ServerErrors]: split.serverErrors,
      [CloudAppPlatformFigure.ClassifiedRequests]: split.classifiedRequests,
    });

    expect(summary.requests).toBe(235);
    expect(summary.serverErrors).toBe(4);
    // 4 of the 150 with a category, never 4 of 235.
    expect(summary.serverErrorRatePercent).toBeCloseTo((4 / 150) * 100, 9);
  });

  test("requests none of which carries a category: their share is unknown, never 0%", () => {
    const split: ReturnType<typeof readCloudAppPlatformSplit> =
      readCloudAppPlatformSplit({
        points: [point(0, "", 4200), point(1, " ", 100)],
        errorLabel: CONTAINER_APP_ERROR_LABEL,
        scale: 1,
      });
    const summary: CloudAppPlatformSummary = summarizeCloudAppPlatformSeries({
      [CloudAppPlatformFigure.Requests]: split.requests,
      [CloudAppPlatformFigure.ServerErrors]: split.serverErrors,
      [CloudAppPlatformFigure.ClassifiedRequests]: split.classifiedRequests,
    });

    expect(summary.requests).toBe(4300);
    expect(summary.serverErrors).toBeNull();
    expect(summary.serverErrorRatePercent).toBeNull();
  });

  test("requests that carry a category and no 5xx: 0%, read, not unknown", () => {
    const split: ReturnType<typeof readCloudAppPlatformSplit> =
      readCloudAppPlatformSplit({
        points: [point(0, "2xx", 300), point(0, "4xx", 12)],
        errorLabel: CONTAINER_APP_ERROR_LABEL,
        scale: 1,
      });

    expect(
      summarizeCloudAppPlatformSeries({
        [CloudAppPlatformFigure.Requests]: split.requests,
        [CloudAppPlatformFigure.ServerErrors]: split.serverErrors,
        [CloudAppPlatformFigure.ClassifiedRequests]: split.classifiedRequests,
      }).serverErrorRatePercent,
    ).toBe(0);
  });

  test("a Cloud Monitoring rate is scaled to a minute's count, its 5xx by its own label", () => {
    const run: ReturnType<typeof readCloudAppPlatformSplit> =
      readCloudAppPlatformSplit({
        points: [
          point(0, "2xx", 3),
          point(0, "4xx", 0.25),
          point(0, "5xx", 0.5),
        ],
        errorLabel: CLOUD_RUN_ERROR_LABEL,
        scale: 60,
      });

    expect(valuesOf(run.requests)).toEqual(["0:225"]);
    expect(valuesOf(run.serverErrors)).toEqual(["0:30"]);
    expect(valuesOf(run.classifiedRequests)).toEqual(["0:225"]);

    const appEngine: ReturnType<typeof readCloudAppPlatformSplit> =
      readCloudAppPlatformSplit({
        points: [point(0, "200", 9), point(0, "404", 1), point(0, "503", 2)],
        errorLabel: APP_ENGINE_ERROR_LABEL,
        scale: 60,
      });

    expect(valuesOf(appEngine.serverErrors)).toEqual(["0:120"]);
  });

  test("a figure read on its own, with no split, is a share of every request, as before", () => {
    const summary: CloudAppPlatformSummary = summarizeCloudAppPlatformSeries({
      [CloudAppPlatformFigure.Requests]: [
        { x: at(0), y: 1000 },
        { x: at(1), y: 1000 },
      ],
      // App Runner's 5xxStatusResponses: one point of the two minutes.
      [CloudAppPlatformFigure.ServerErrors]: [{ x: at(0), y: 20 }],
    });

    expect(summary.serverErrorRatePercent).toBe(1);
  });

  test("a seeded sweep: however the points come, the categories add up to the requests, and the share is the 5xx of those with one", () => {
    const random: SeededRandom = seededRandom(10837);

    for (let draw: number = 0; draw < 200; draw++) {
      const points: Array<CloudAppPlatformSplitPoint> = [];
      let total: number = 0;
      let classified: number = 0;
      let errors: number = 0;
      const unknownMinutes: Set<number> = new Set<number>();

      for (let minute: number = 0; minute < 1 + random(10); minute++) {
        for (const category of ["2xx", "3xx", "4xx", "5xx", ""]) {
          if (random(3) === 0) {
            continue;
          }

          const count: number = 1 + random(500);

          total += count;
          points.push(point(minute, category, count));

          if (!category) {
            unknownMinutes.add(minute);
          }
        }
      }

      // What the share is of: the minutes whose every request carries a category.
      for (const each of points) {
        const minute: number = (each.x.getTime() - START) / MINUTE_MS;

        if (!unknownMinutes.has(minute)) {
          classified += each.y;
          errors += each.label === "5xx" ? each.y : 0;
        }
      }

      const split: ReturnType<typeof readCloudAppPlatformSplit> =
        readCloudAppPlatformSplit({
          points: shuffled(points, random),
          errorLabel: CONTAINER_APP_ERROR_LABEL,
          scale: 1,
        });
      const summary: CloudAppPlatformSummary = summarizeCloudAppPlatformSeries({
        [CloudAppPlatformFigure.Requests]: split.requests,
        [CloudAppPlatformFigure.ServerErrors]: split.serverErrors,
        [CloudAppPlatformFigure.ClassifiedRequests]: split.classifiedRequests,
      });

      expect(summary.requests).toBe(points.length > 0 ? total : null);
      expect(summary.serverErrorRatePercent).toEqual(
        classified > 0 ? (errors / classified) * 100 : null,
      );
      // Every interval read once, in order.
      expect(
        split.requests.map((each: CloudAppPlatformPoint): number => {
          return each.x.getTime();
        }),
      ).toEqual(
        Array.from(
          new Set(
            points.map((each: CloudAppPlatformSplitPoint): number => {
              return each.x.getTime();
            }),
          ),
        ).sort((a: number, b: number): number => {
          return a - b;
        }),
      );
    }
  });
});

describe("what each platform's section and list read", () => {
  function profileOf(type: string): CloudAppPlatformProfile {
    return getCloudAppPlatformProfile(type)!;
  }

  function figuresOf(profile: CloudAppPlatformProfile): Array<string> {
    return profile.tiles.map((tile: { figure: string }): string => {
      return tile.figure;
    });
  }

  test("a Container App's section: its requests, their 5xx share, response time, CPU, memory and restarts", () => {
    const profile: CloudAppPlatformProfile = profileOf(
      "Microsoft.App/containerApps",
    );

    expect(figuresOf(profile)).toEqual([
      CloudAppPlatformFigure.Requests,
      CloudAppPlatformFigure.ServerErrors,
      CloudAppPlatformFigure.ResponseTime,
      CloudAppPlatformFigure.Cpu,
      CloudAppPlatformFigure.Memory,
      CloudAppPlatformFigure.Restarts,
    ]);

    const requests: CloudAppPlatformMetricRead = profile
      .reads({})
      .find((read: CloudAppPlatformMetricRead): boolean => {
        return read.figure === CloudAppPlatformFigure.Requests;
      })!;

    expect([
      requests.storedName,
      requests.aggregationType,
      requests.errorLabel?.attribute,
    ]).toEqual([
      "azure_requests_total",
      AggregationType.Sum,
      "metadata_statuscodecategory",
    ]);
    // No read of a 5xx metric of its own: they are its Requests' category.
    expect(
      profile.reads({}).filter((read: CloudAppPlatformMetricRead): boolean => {
        return read.figure === CloudAppPlatformFigure.ServerErrors;
      }),
    ).toEqual([]);
  });

  test("a Container App's list reads its requests by category and its response time", () => {
    expect(
      getCloudAppPlatformListReads({
        type: "Microsoft.App/containerApps",
        readings: {},
      }).map((read: CloudAppPlatformMetricRead) => {
        return [read.figure, read.errorLabel?.attribute || null];
      }),
    ).toEqual([
      [CloudAppPlatformFigure.Requests, "metadata_statuscodecategory"],
      [CloudAppPlatformFigure.ResponseTime, null],
    ]);
  });

  test("an App Engine service's section: its requests, their 5xx share, p95, CPU and memory (#10838)", () => {
    const profile: CloudAppPlatformProfile = profileOf("gae_app");

    expect(figuresOf(profile)).toEqual([
      CloudAppPlatformFigure.Requests,
      CloudAppPlatformFigure.ServerErrors,
      CloudAppPlatformFigure.Latency,
      CloudAppPlatformFigure.Cpu,
      CloudAppPlatformFigure.Memory,
    ]);
    // Its list reads no CPU or memory: a list shows requests, errors and latency.
    expect(
      getCloudAppPlatformListReads({ type: "gae_app", readings: {} }).map(
        (read: CloudAppPlatformMetricRead): string => {
          return read.figure;
        },
      ),
    ).toEqual([
      CloudAppPlatformFigure.Requests,
      CloudAppPlatformFigure.Latency,
    ]);
  });

  test("six tiles lay out two rows of three until all fit on one, five on one row from 64rem", () => {
    expect(getCloudAppPlatformTilesGridClassName(6)).toContain(
      "[@container(min-width:40rem)]:grid-cols-3",
    );
    expect(getCloudAppPlatformTilesGridClassName(6)).toContain(
      "[@container(min-width:80rem)]:grid-cols-6",
    );
    expect(getCloudAppPlatformTilesGridClassName(6)).not.toContain(
      "grid-cols-5",
    );

    for (const count of [2, 3, 5]) {
      expect(getCloudAppPlatformTilesGridClassName(count)).toContain(
        "[@container(min-width:64rem)]:grid-cols-5",
      );
    }
  });
});
