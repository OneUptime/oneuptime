import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { escapeRegExp } from "../../../Utils/RegExpEscape";

/*
 * Guard (issue #7277): every Dashboard page that draws availability from
 * heartbeats tells HeartbeatAvailabilityUtil.buildAvailabilitySeries the zone
 * its heartbeat request's buckets followed. AnalyticsModelAPI.aggregate puts
 * the reader's zone on a request whose buckets are days or longer
 * (AggregationIntervalUtil.withReaderTimezone), so the server starts them at
 * the reader's midnight. A builder told nothing walks UTC's days instead: in
 * New York every point lands on the evening before, and across a clock
 * change the reader's days stop being 24 hours long.
 *
 * The zone the builder is given is the request's only while both read it for
 * the same window: the page passes getReaderTimezone the chart's own window,
 * and names no zone and pins no interval on its requests, which would change
 * what the request carries. A page that comes to need either on some other
 * request should narrow the last check to its heartbeat request, not drop it.
 */

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src",
);

function sourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") {
        files.push(...sourceFiles(full));
      }
      continue;
    }

    if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) {
      files.push(full);
    }
  }

  return files;
}

const BUILDER_CALL: string =
  "HeartbeatAvailabilityUtil.buildAvailabilitySeries(";

const PAGES: Array<{ file: string; source: string }> = sourceFiles(
  DASHBOARD_SRC,
)
  .map((file: string) => {
    return { file, source: fs.readFileSync(file, "utf8") };
  })
  .filter((page: { source: string }) => {
    return page.source.includes(BUILDER_CALL);
  });

function relative(file: string): string {
  return path.relative(DASHBOARD_SRC, file);
}

// The builder call, from its name to the "});" that closes it.
function builderCallBody(source: string): string {
  const call: string = source.slice(source.indexOf(BUILDER_CALL));
  return call.slice(0, call.indexOf("});") + 3);
}

// The expression a property of the builder call is set to, such as "startDate".
function argument(callBody: string, name: string): string {
  const match: RegExpMatchArray | null = callBody.match(
    new RegExp(`\\n\\s*${escapeRegExp(name)}: ([A-Za-z_.]+),\\n`),
  );
  return match ? match[1]! : "";
}

describe("Heartbeat availability charts walk the reader's days", () => {
  test("finds the host, Docker host, Podman host and Kubernetes cluster overviews", () => {
    expect(
      PAGES.map((page: { file: string }) => {
        return relative(page.file);
      }).sort(),
    ).toEqual(
      [
        "Pages/Docker/View/Overview.tsx",
        "Pages/Host/View/Overview.tsx",
        "Pages/Kubernetes/View/Index.tsx",
        "Pages/Podman/View/Overview.tsx",
      ].sort(),
    );
  });

  test.each(
    PAGES.map((page: { file: string; source: string }) => {
      return [relative(page.file), page.source];
    }),
  )(
    "%s gives the builder the reader's zone for the chart's own window",
    (_file: string, source: string) => {
      const callBody: string = builderCallBody(source);
      const windowStart: string = argument(callBody, "windowStart");
      const windowEnd: string = argument(callBody, "windowEnd");

      expect(windowStart).not.toBe("");
      expect(windowEnd).not.toBe("");
      expect(callBody.replace(/\s+/g, " ")).toMatch(
        new RegExp(
          `timezone: AggregationIntervalUtil\\.getReaderTimezone\\(\\{ ?startDate: ${escapeRegExp(windowStart)}, endDate: ${escapeRegExp(windowEnd)},? ?\\}\\)`,
        ),
      );
    },
  );

  test.each(
    PAGES.map((page: { file: string; source: string }) => {
      return [relative(page.file), page.source];
    }),
  )(
    "%s leaves its requests' zone and interval to AnalyticsModelAPI.aggregate",
    (_file: string, source: string) => {
      const builderCall: string = builderCallBody(source);
      const rest: string = source.replace(builderCall, "");

      expect(source).toContain("AnalyticsModelAPI.aggregate<Metric>(");
      expect(rest).not.toContain("aggregationInterval");
      expect(rest).not.toMatch(/\btimezone:/);
    },
  );
});
