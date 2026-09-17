import Monitor from "../../../../Models/DatabaseModels/Monitor";
import Probe from "../../../../Models/DatabaseModels/Probe";
import ProbeService from "../../../../Server/Services/ProbeService";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import MonitorSummaryCapture from "../../../../Server/Utils/Monitor/MonitorSummaryCapture";
import MonitorSummarySnapshot from "../../../../Types/Monitor/MonitorSummarySnapshot";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import ServerMonitorResponse from "../../../../Types/Monitor/ServerMonitor/ServerMonitorResponse";
import { afterEach, describe, expect, it, jest } from "@jest/globals";

/*
 * The one thing the pure snapshot builder cannot do for itself: turn the
 * probe id on a check into the probe NAME, which every probeable summary
 * view renders as its "Probe" card.
 *
 * MonitorResource already has that name in hand for probeable monitors and
 * passes it down for free. Network Device monitors are the gap - they are
 * deliberately NOT "probeable" (the device owns its polling schedule) yet
 * their walks and traps still arrive as a ProbeMonitorResponse carrying a
 * probeId, so without the lookup below their incidents would show
 * "Probe: -".
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROBE_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");

function monitor(monitorType: MonitorType): Monitor {
  const model: Monitor = new Monitor();
  model._id = MONITOR_ID.toString();
  model.projectId = PROJECT_ID;
  model.monitorType = monitorType;
  model.name = "Core Switch";
  return model;
}

function probeCheck(): DataToProcess {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    monitorStepId: new ObjectID("33333333-3333-4333-8333-333333333333"),
    probeId: PROBE_ID,
    failureCause: "Interface down",
    monitoredAt: new Date("2026-07-31T10:00:00.000Z"),
  } as unknown as DataToProcess;
}

function namedProbe(name: string): Probe {
  const probe: Probe = new Probe();
  probe._id = PROBE_ID.toString();
  probe.name = name;
  return probe;
}

describe("MonitorSummaryCapture.capture", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("uses the probe name the caller already resolved, without a database round trip", async () => {
    jest.spyOn(ProbeService, "findOneById");

    const snapshot: MonitorSummarySnapshot | null =
      await MonitorSummaryCapture.capture({
        monitor: monitor(MonitorType.Website),
        dataToProcess: probeCheck(),
        probeName: "US West Probe",
      });

    expect(snapshot?.probeName).toBe("US West Probe");
    expect(ProbeService.findOneById).not.toHaveBeenCalled();
  });

  it("looks the probe name up for a Network Device monitor, whose caller never resolves one", async () => {
    jest
      .spyOn(ProbeService, "findOneById")
      .mockResolvedValue(namedProbe("Rack 3 Probe"));

    const snapshot: MonitorSummarySnapshot | null =
      await MonitorSummaryCapture.capture({
        monitor: monitor(MonitorType.NetworkDevice),
        dataToProcess: probeCheck(),
        probeName: undefined,
      });

    expect(snapshot?.probeName).toBe("Rack 3 Probe");
    expect(snapshot?.probeId).toBe(PROBE_ID.toString());
  });

  it("captures without a probe name when the probe has been deleted", async () => {
    jest.spyOn(ProbeService, "findOneById").mockResolvedValue(null);

    const snapshot: MonitorSummarySnapshot | null =
      await MonitorSummaryCapture.capture({
        monitor: monitor(MonitorType.NetworkDevice),
        dataToProcess: probeCheck(),
      });

    expect(snapshot).not.toBeNull();
    expect(snapshot?.probeName).toBeUndefined();
    expect(snapshot?.probeMonitorResponse).toBeDefined();
  });

  it("does not go looking for a probe on a check that has none", async () => {
    jest.spyOn(ProbeService, "findOneById");

    const serverResponse: ServerMonitorResponse = {
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
      hostname: "prod-db-01",
      requestReceivedAt: new Date("2026-07-31T10:00:00.000Z"),
      onlyCheckRequestReceivedAt: false,
    } as unknown as ServerMonitorResponse;

    const snapshot: MonitorSummarySnapshot | null =
      await MonitorSummaryCapture.capture({
        monitor: monitor(MonitorType.Server),
        dataToProcess: serverResponse,
      });

    expect(ProbeService.findOneById).not.toHaveBeenCalled();
    expect(snapshot?.serverMonitorResponse?.hostname).toBe("prod-db-01");
  });

  it("stamps the monitor's own identity onto the capture", async () => {
    const snapshot: MonitorSummarySnapshot | null =
      await MonitorSummaryCapture.capture({
        monitor: monitor(MonitorType.Ping),
        dataToProcess: probeCheck(),
        probeName: "US West Probe",
      });

    expect(snapshot?.monitorId).toBe(MONITOR_ID.toString());
    expect(snapshot?.monitorName).toBe("Core Switch");
    expect(snapshot?.capturedAt).toBeDefined();
  });

  it("captures nothing for a manual monitor", async () => {
    expect(
      await MonitorSummaryCapture.capture({
        monitor: monitor(MonitorType.Manual),
        dataToProcess: probeCheck(),
      }),
    ).toBeNull();
  });

  it("captures nothing for a monitor with no type rather than guessing one", async () => {
    const typeless: Monitor = monitor(MonitorType.Website);
    delete typeless.monitorType;

    expect(
      await MonitorSummaryCapture.capture({
        monitor: typeless,
        dataToProcess: probeCheck(),
      }),
    ).toBeNull();
  });

  it("swallows a failed lookup instead of failing the ingest job", async () => {
    /*
     * This runs inside the probe / telemetry queue workers, where a throw
     * fails the whole job and retries forever - costing the incident
     * itself, which matters far more than its evidence.
     */
    jest
      .spyOn(ProbeService, "findOneById")
      .mockRejectedValue(new Error("connection terminated unexpectedly"));

    await expect(
      MonitorSummaryCapture.capture({
        monitor: monitor(MonitorType.NetworkDevice),
        dataToProcess: probeCheck(),
      }),
    ).resolves.toBeNull();
  });

  it("prefers the evaluation summary handed in by the pipeline", async () => {
    const snapshot: MonitorSummarySnapshot | null =
      await MonitorSummaryCapture.capture({
        monitor: monitor(MonitorType.Website),
        dataToProcess: {
          ...(probeCheck() as unknown as ProbeMonitorResponse),
        } as unknown as DataToProcess,
        probeName: "US West Probe",
        evaluationSummary: {
          evaluatedAt: new Date("2026-07-31T10:00:00.000Z"),
          criteriaResults: [],
          events: [
            {
              type: "criteria-met",
              title: "Criteria met",
            },
          ],
        },
      });

    expect(snapshot?.evaluationSummary?.events[0]?.title).toBe("Criteria met");
  });
});
