import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Guard (issue #2825): every Dashboard page that draws availability from
 * heartbeats leaves out the time OneUptime itself was not receiving. A page
 * that calls HeartbeatAvailabilityUtil.buildAvailabilitySeries must
 *
 *   - fetch the gaps for its window (fetchReceivingGaps),
 *   - hand them to the builder (receivingGaps:), so silent buckets in them
 *     are "not monitored" and out of the badge,
 *   - shade them on the chart (getNotMonitoredRegions) and break the line
 *     there (connectNulls: false) instead of joining across it.
 *
 * Otherwise a restart of OneUptime reads as every host's downtime again on
 * that page.
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

const PAGES: Array<{ file: string; source: string }> = sourceFiles(
  DASHBOARD_SRC,
)
  .map((file: string) => {
    return { file, source: fs.readFileSync(file, "utf8") };
  })
  .filter((page: { source: string }) => {
    return page.source.includes(
      "HeartbeatAvailabilityUtil.buildAvailabilitySeries(",
    );
  });

function relative(file: string): string {
  return path.relative(DASHBOARD_SRC, file);
}

describe("Heartbeat availability charts leave out OneUptime's own downtime", () => {
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
  )("%s fetches the gaps, judges with them, shades them and breaks the line", (_file: string, source: string) => {
    expect(source).toContain("fetchReceivingGaps(");
    expect(source).toContain("getNotMonitoredRegions(");
    expect(source).toContain("connectNulls: false");

    const call: string = source.slice(
      source.indexOf("HeartbeatAvailabilityUtil.buildAvailabilitySeries("),
    );
    const callBody: string = call.slice(0, call.indexOf("});") + 3);
    expect(callBody).toContain("receivingGaps:");
  });
});
