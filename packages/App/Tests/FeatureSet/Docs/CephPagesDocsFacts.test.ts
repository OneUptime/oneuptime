import { describe, expect, test } from "@jest/globals";
import { readPage } from "./DocsContentSupport";
import {
  CEPH_CLUSTER_FULL_PERCENT,
  CEPH_CLUSTER_NEARFULL_PERCENT,
  CEPH_OSD_BACKFILLFULL_PERCENT,
  CEPH_OSD_FULL_PERCENT,
  CEPH_OSD_LATENCY_WARNING_MS,
  CEPH_OSD_NEARFULL_PERCENT,
  CEPH_POOL_FULL_PERCENT,
  CEPH_POOL_NEARFULL_PERCENT,
} from "../../../FeatureSet/Dashboard/src/Pages/Ceph/Utils/CephHealth";

/*
 * The Ceph agent page's "What the cluster's pages show" (telemetry/ceph)
 * says the rules the cluster's pages judge it by (Pages/Ceph/Utils/
 * CephHealth): change a line there, and these words go stale. The
 * translations hold the same numbers line for line
 * (InfrastructureAgentDocsTranslations).
 */

const PAGE: string = "telemetry/ceph";
const HEADING: string = "## What the cluster's pages show";

function section(): string {
  const text: string = readPage("en", PAGE);
  const start: number = text.indexOf(HEADING);
  expect(start).toBeGreaterThan(-1);
  const end: number = text.indexOf("\n## ", start + 1);
  return text.slice(start, end);
}

describe("telemetry/ceph: what the cluster's pages show", () => {
  test("sits after What the agent collects, before the cluster log section", () => {
    const text: string = readPage("en", PAGE);
    const collects: number = text.indexOf("## What the agent collects");
    const pages: number = text.indexOf(HEADING);
    const log: number = text.indexOf("## Optional — Ship the Ceph cluster log");
    expect(collects).toBeGreaterThan(-1);
    expect(pages).toBeGreaterThan(collects);
    expect(log).toBeGreaterThan(pages);
  });

  test("says the cluster's raw capacity lines as the rules draw them", () => {
    expect(section()).toContain(
      `raw capacity past ${CEPH_CLUSTER_NEARFULL_PERCENT}% (critical past ${CEPH_CLUSTER_FULL_PERCENT}%)`,
    );
  });

  test("says the OSD ratios and the latency line as the rules draw them", () => {
    const text: string = section();
    expect(text).toContain(
      `nearfull ratio (${CEPH_OSD_NEARFULL_PERCENT}%) or backfillfull ratio (${CEPH_OSD_BACKFILLFULL_PERCENT}%)`,
    );
    expect(text).toContain(
      `apply latency past ${CEPH_OSD_LATENCY_WARNING_MS} ms`,
    );
    expect(text).toContain(`Past the full ratio (${CEPH_OSD_FULL_PERCENT}%)`);
  });

  test("says the pool lines as the rules draw them", () => {
    const text: string = section();
    expect(text).toContain(
      `A pool past ${CEPH_POOL_NEARFULL_PERCENT}% of its writable space`,
    );
    expect(text).toContain(`past ${CEPH_POOL_FULL_PERCENT}% it is critical`);
  });

  test("names the Dashboard's own words, in bold", () => {
    const text: string = section();
    for (const label of [
      "**Overview**",
      "**Healthy**",
      "**Degraded**",
      "**Unhealthy**",
      "**Needs attention**",
      "**OSDs**",
      "**Pools**",
      "**Daemons**",
      "**Stopped reporting**",
      "**Health Unknown**",
    ]) {
      expect({ label, found: text.includes(label) }).toEqual({
        label,
        found: true,
      });
    }
  });

  test("says Ceph's own checks stay as Ceph names them, and that a cluster's own ratios raise its own", () => {
    const text: string = section();
    expect(text).toContain(
      "with the checks it raised as Ceph names them, such as `OSD_DOWN` or `PG_DEGRADED`",
    );
    expect(text).toContain(
      "A cluster set to others raises its own `OSD_NEARFULL`, `OSD_BACKFILLFULL` and `OSD_FULL` checks at its own lines",
    );
  });

  test("names Needs attention where the page used to name the old checks card", () => {
    const text: string = readPage("en", PAGE);
    expect(text).not.toContain("Active Health Checks");
    expect(text).toContain(
      "and of the checks the Overview's **Needs attention** shows)",
    );
  });
});
