/*
 * The package entry, not the `/extend-expect` subpath the older tests use:
 * the matchers are already registered by Tests/jest.setup.ts, and only this
 * specifier resolves to the type augmentation that makes them visible to
 * TypeScript.
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import * as React from "react";
import { describe, expect, it } from "@jest/globals";
import { JSONObject } from "../../../Types/JSON";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import MonitorEvaluationSummary from "../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorSummarySnapshot from "../../../Types/Monitor/MonitorSummarySnapshot";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import MonitorSummarySnapshotUtil, {
  MonitorSummaryDataToProcess,
  MonitorSummaryInfoProps,
} from "../../../Utils/Monitor/MonitorSummarySnapshotUtil";
/*
 * The Dashboard resolves its own copy of react, which would give the
 * component a different hook dispatcher than the one react-dom renders
 * with. Pinned in Common's jest moduleNameMapper - see
 * Tests/UI/Rum/ReplayStage.test.tsx for why the path-based version broke CI.
 */
import SummaryInfo from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/SummaryInfo";

/*
 * End to end for the read half of the feature: a snapshot that came out of
 * the incident's jsonb column has to reach the same per-monitor-type view
 * the monitor page renders, and actually put the check on screen.
 *
 * The pure mapping is covered in Tests/Utils/Monitor/MonitorSummarySnapshotUtil.test.ts.
 * What that one cannot catch is the shape mismatch that renders nothing:
 * SummaryInfo takes probeMonitorResponse*s* (plural, because a monitor can
 * have several steps), so handing it the bare object silently produces an
 * empty card - which is indistinguishable from "this monitor had no data",
 * the exact bug this feature exists to fix.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const MONITOR_STEP_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const PROBE_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");

const CAPTURED_AT: Date = new Date("2026-07-31T10:00:00.000Z");

const EVALUATION_SUMMARY: MonitorEvaluationSummary = {
  evaluatedAt: CAPTURED_AT,
  criteriaResults: [
    {
      criteriaId: "criteria-1",
      criteriaName: "Site Is Offline",
      filterCondition: FilterCondition.Any,
      met: true,
      message: "Monitor is offline",
      filters: [],
    },
  ],
  events: [],
};

/*
 * Build the snapshot the way the server does, push it through the jsonb
 * round trip, and read it back the way the browser does - so the test
 * exercises the real storage path rather than an in-memory object.
 */
function storeAndReadBack(input: {
  monitorType: MonitorType;
  dataToProcess?: MonitorSummaryDataToProcess | undefined;
  probeName?: string | undefined;
}): MonitorSummarySnapshot {
  const snapshot: MonitorSummarySnapshot | null =
    MonitorSummarySnapshotUtil.buildSnapshot({
      monitorType: input.monitorType,
      dataToProcess: input.dataToProcess,
      monitorId: MONITOR_ID.toString(),
      monitorName: "Production API",
      probeName: input.probeName,
      evaluationSummary: EVALUATION_SUMMARY,
      capturedAt: CAPTURED_AT,
    });

  const stored: JSONObject = JSON.parse(
    JSON.stringify(MonitorSummarySnapshotUtil.serialize(snapshot)),
  ) as JSONObject;

  return MonitorSummarySnapshotUtil.deserialize(stored)!;
}

function renderSnapshot(snapshot: MonitorSummarySnapshot): void {
  const props: MonitorSummaryInfoProps =
    MonitorSummarySnapshotUtil.toSummaryInfoProps(snapshot);

  render(<SummaryInfo {...props} />);
}

describe("A stored monitor summary renders the check that caused the incident", () => {
  it("renders a website check, including the probe that ran it", () => {
    renderSnapshot(
      storeAndReadBack({
        monitorType: MonitorType.Website,
        probeName: "US West Probe",
        dataToProcess: {
          projectId: PROJECT_ID,
          monitorId: MONITOR_ID,
          monitorStepId: MONITOR_STEP_ID,
          probeId: PROBE_ID,
          isOnline: false,
          responseCode: 503,
          responseTimeInMs: 1234,
          failureCause: "Connection refused",
          monitoredAt: CAPTURED_AT,
        } as unknown as MonitorSummaryDataToProcess,
      }),
    );

    expect(screen.getByText("503")).toBeInTheDocument();
    /*
     * The probe name is the whole reason MonitorSummaryCapture resolves it
     * server-side - the old log only ever had the id, so this card would
     * otherwise read "Probe: -".
     */
    expect(screen.getByText("US West Probe")).toBeInTheDocument();
  });

  it("renders a server check's hostname rather than an empty card", () => {
    /*
     * SummaryInfo has no guard for a Server monitor with no response - it
     * renders an empty <div>. Routing the payload into serverMonitorResponse
     * is what keeps this card populated.
     */
    renderSnapshot(
      storeAndReadBack({
        monitorType: MonitorType.Server,
        dataToProcess: {
          projectId: PROJECT_ID,
          monitorId: MONITOR_ID,
          hostname: "prod-db-01",
          requestReceivedAt: CAPTURED_AT,
          onlyCheckRequestReceivedAt: false,
        } as unknown as MonitorSummaryDataToProcess,
      }),
    );

    expect(screen.getByText("prod-db-01")).toBeInTheDocument();
  });

  it("renders an incoming request, including the check time the snapshot supplies", () => {
    renderSnapshot(
      storeAndReadBack({
        monitorType: MonitorType.IncomingRequest,
        dataToProcess: {
          projectId: PROJECT_ID,
          monitorId: MONITOR_ID,
          requestMethod: "POST",
          incomingRequestReceivedAt: CAPTURED_AT,
          checkedAt: CAPTURED_AT,
          requestBody: { status: "degraded" },
        } as unknown as MonitorSummaryDataToProcess,
      }),
    );

    expect(screen.getByText("POST")).toBeInTheDocument();
    /*
     * The live card fills this from the monitor's *current* heartbeat time.
     * A frozen capture has no such thing, so toSummaryInfoProps substitutes
     * the moment this very request was checked - without it the card loses
     * a field on every incident.
     */
    expect(screen.getByText("Monitor Status Check At")).toBeInTheDocument();
  });

  it("renders an incoming email's subject and sender", () => {
    renderSnapshot(
      storeAndReadBack({
        monitorType: MonitorType.IncomingEmail,
        dataToProcess: {
          projectId: PROJECT_ID,
          monitorId: MONITOR_ID,
          emailFrom: "alerts@example.com",
          emailTo: "monitor@oneuptime.com",
          emailSubject: "Backup failed",
          emailBody: "The nightly backup did not complete.",
          emailReceivedAt: CAPTURED_AT,
          checkedAt: CAPTURED_AT,
        } as unknown as MonitorSummaryDataToProcess,
      }),
    );

    expect(screen.getByText("Backup failed")).toBeInTheDocument();
    expect(screen.getByText("alerts@example.com")).toBeInTheDocument();
  });

  it("renders the criteria evaluation that decided to open the incident", () => {
    /*
     * For a telemetry monitor there is no per-probe check to show, so the
     * evaluation log IS the summary - and it is the part that answers "why
     * did this fire?".
     */
    renderSnapshot(
      storeAndReadBack({
        monitorType: MonitorType.Logs,
        dataToProcess: {
          projectId: PROJECT_ID,
          monitorId: MONITOR_ID,
          logCount: 412,
        } as unknown as MonitorSummaryDataToProcess,
      }),
    );

    expect(screen.getByText(/Site Is Offline/)).toBeInTheDocument();
  });

  it("does not tell the reader to wait a few minutes for data that is already here", () => {
    /*
     * SummaryInfo's empty state for a probeable monitor is "No summary
     * available for the selected probe. Should be few minutes for summary
     * to show up." On an incident from last quarter that is nonsense, and
     * it is exactly what a bare (unwrapped) probe response produces.
     */
    renderSnapshot(
      storeAndReadBack({
        monitorType: MonitorType.Ping,
        probeName: "US West Probe",
        dataToProcess: {
          projectId: PROJECT_ID,
          monitorId: MONITOR_ID,
          monitorStepId: MONITOR_STEP_ID,
          probeId: PROBE_ID,
          isOnline: false,
          failureCause: "Host unreachable",
          monitoredAt: CAPTURED_AT,
        } as unknown as MonitorSummaryDataToProcess,
      }),
    );

    expect(screen.queryByText(/few minutes for summary/)).toBeNull();
    expect(screen.getByText("Host unreachable")).toBeInTheDocument();
  });
});
