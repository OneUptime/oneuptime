import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A monitor that trips opens an incident, and the incident page said
 * nothing about what the monitor actually saw - the "Monitor Summary" card
 * lived only on the monitor page, fed by live data that does not last
 * (MonitorLog's ClickHouse TTL defaults to one day, and
 * MonitorProbe.lastMonitoringLog is overwritten by the next check).
 *
 * The behaviour lives in Common and is tested there:
 *   Common/Tests/Utils/Monitor/MonitorSummarySnapshotUtil.test.ts
 *     - what gets captured, for all 31 monitor types
 *   Common/Tests/Server/Utils/Monitor/MonitorSummaryPersistence.test.ts
 *     - that it lands on the incident / alert row
 *   Common/Tests/UI/Monitor/MonitorSummarySnapshotRender.test.tsx
 *     - that a stored capture renders the right per-type view
 *
 * What none of those can reach is the Dashboard wiring: the App suite runs
 * in plain Node with no renderer. So the wiring is pinned here by reading
 * the sources, the way IncidentMetricSeriesScope.test.ts does. Sources are
 * whitespace-squashed and comment-stripped first so a prettier re-wrap
 * cannot turn a real regression check into a red herring.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function readSource(...relativeParts: Array<string>): string {
  return squash(
    stripComments(
      fs.readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8"),
    ),
  );
}

const SUMMARY_CARD: string = readSource(
  "Components",
  "Monitor",
  "MonitorSummarySnapshotCard.tsx",
);

const INCIDENT_VIEW: string = readSource(
  "Pages",
  "Incidents",
  "View",
  "Index.tsx",
);

const ALERT_VIEW: string = readSource("Pages", "Alerts", "View", "Index.tsx");

describe("The Monitor Summary card is on both the incident and the alert page", () => {
  test("the incident page renders it, scoped to that incident", () => {
    expect(INCIDENT_VIEW).toContain(
      "<MonitorSummarySnapshotCard incidentId={modelId} />",
    );
    expect(INCIDENT_VIEW).toContain(
      'import MonitorSummarySnapshotCard from "../../../Components/Monitor/MonitorSummarySnapshotCard"',
    );
  });

  test("the alert page renders it, scoped to that alert", () => {
    expect(ALERT_VIEW).toContain(
      "<MonitorSummarySnapshotCard alertId={modelId} />",
    );
    expect(ALERT_VIEW).toContain(
      'import MonitorSummarySnapshotCard from "../../../Components/Monitor/MonitorSummarySnapshotCard"',
    );
  });
});

describe("The Monitor Summary card reads the stored capture", () => {
  test("selects the stored snapshot column on both models", () => {
    /*
     * Without the column in the select, ModelAPI returns the row with
     * monitorSummary undefined and the card silently renders nothing -
     * exactly the bug it exists to fix.
     */
    const selects: Array<string> = SUMMARY_CARD.split("monitorSummary: true");

    // Once for the Incident fetch, once for the Alert fetch.
    expect(selects.length - 1).toBe(2);
  });

  test("falls back to createdStateLog for rows created before the column existed", () => {
    expect(SUMMARY_CARD).toContain("createdStateLog: true");
    expect(SUMMARY_CARD).toContain("fromLegacyCreatedStateLog");
  });

  test("asks the monitor for its type, which the legacy fallback needs and the page does not otherwise know", () => {
    expect(SUMMARY_CARD).toContain("monitorType: true");
  });

  test("routes rendering through the shared per-monitor-type mapper rather than re-deriving it", () => {
    expect(SUMMARY_CARD).toContain("MonitorSummarySnapshotUtil.deserialize");
    expect(SUMMARY_CARD).toContain(
      "MonitorSummarySnapshotUtil.toSummaryInfoProps",
    );
    expect(SUMMARY_CARD).toContain("<SummaryInfo {...summaryInfoProps} />");
  });

  test("renders nothing at all when there is no capture to show", () => {
    /*
     * Manual monitors and hand-declared incidents have no summary. An
     * empty card on those pages is worse than no card.
     */
    expect(SUMMARY_CARD).toContain(
      "MonitorSummarySnapshotUtil.hasRenderableContent",
    );
    expect(SUMMARY_CARD).toContain("if (!snapshot) { return <Fragment />; }");
  });

  test("degrades to nothing when the fetch fails instead of breaking the page", () => {
    /*
     * The card hand-rolls its own ModelAPI call, so it bypasses
     * ModelDetail's permission filtering: a viewer without read access to
     * monitors gets a hard failure from the relation select rather than a
     * hidden row.
     */
    expect(SUMMARY_CARD).toContain("catch (err)");
    expect(SUMMARY_CARD).toContain("setSnapshot(null)");
  });
});
