/*
 * An archived monitor opens no incidents and no alerts.
 *
 * Probes, workers and ingest stop asking for archived monitors
 * (MonitorService.getEnabledMonitorQuery, the probe claim), but a result can
 * still reach one: a probe that claimed it a moment before it was archived,
 * an incoming request or an email that arrives afterwards. Every result goes
 * through MonitorResourceUtil.monitorResource, so that is where an archived
 * monitor's result is refused - before the per-monitor lock is taken, before
 * any criteria is evaluated, and so before anything could open an incident,
 * an alert, or change the monitor's status.
 */

jest.mock("isolated-vm", () => {
  return {};
});

jest.mock("../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator", () => {
  return {
    __esModule: true,
    default: {
      processMonitorStep: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      findBy: jest.fn(),
      updateColumnsByIdWithoutHooks: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Infrastructure/Semaphore", () => {
  return {
    __esModule: true,
    default: {
      lock: jest.fn(),
      release: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      trace: jest.fn(),
    },
  };
});

import Monitor from "../../../../Models/DatabaseModels/Monitor";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import MonitorService from "../../../../Server/Services/MonitorService";
import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import MonitorResourceUtil from "../../../../Server/Utils/Monitor/MonitorResource";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ExceptionMessages from "../../../../Types/Exception/ExceptionMessages";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const MONITOR_ID: ObjectID = new ObjectID(
  "3a000000-0000-4000-8000-000000000001",
);

const findOneById: jest.Mock =
  MonitorService.findOneById as unknown as jest.Mock;
const lock: jest.Mock = Semaphore.lock as unknown as jest.Mock;
const processMonitorStep: jest.Mock =
  MonitorCriteriaEvaluator.processMonitorStep as unknown as jest.Mock;

function monitor(values: Partial<Monitor>): Monitor {
  const row: Monitor = new Monitor();
  row.id = MONITOR_ID;
  row._id = MONITOR_ID.toString();
  row.projectId = ObjectID.generate();
  row.monitorType = MonitorType.Website;
  Object.assign(row, values);
  return row;
}

function probeResult(): ProbeMonitorResponse {
  return {
    monitorId: MONITOR_ID,
    probeId: ObjectID.generate(),
    isOnline: false,
    monitoredAt: new Date(),
  } as unknown as ProbeMonitorResponse;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("a result for an archived monitor", () => {
  test("is refused as archived, and nothing is evaluated or locked", async () => {
    findOneById.mockResolvedValue(monitor({ isArchived: true }) as never);

    await expect(
      MonitorResourceUtil.monitorResource(probeResult()),
    ).rejects.toThrow(new BadDataException(ExceptionMessages.MonitorArchived));

    expect(lock).not.toHaveBeenCalled();
    expect(processMonitorStep).not.toHaveBeenCalled();
  });

  test("archived is the reason given even when the monitor is also disabled", async () => {
    findOneById.mockResolvedValue(
      monitor({ isArchived: true, disableActiveMonitoring: true }) as never,
    );

    await expect(
      MonitorResourceUtil.monitorResource(probeResult()),
    ).rejects.toThrow(ExceptionMessages.MonitorArchived);
  });

  test("a disabled monitor that is not archived still gets the disabled answer", async () => {
    findOneById.mockResolvedValue(
      monitor({ isArchived: false, disableActiveMonitoring: true }) as never,
    );

    await expect(
      MonitorResourceUtil.monitorResource(probeResult()),
    ).rejects.toThrow(ExceptionMessages.MonitorDisabled);
  });

  test("the monitor is read with all four pause flags", async () => {
    findOneById.mockResolvedValue(monitor({ isArchived: true }) as never);

    await MonitorResourceUtil.monitorResource(probeResult()).catch(() => {
      // Refused, as above.
    });

    const select: Record<string, unknown> = (
      findOneById.mock.calls[0]![0] as { select: Record<string, unknown> }
    ).select;

    expect(select["isArchived"]).toBe(true);
    expect(select["disableActiveMonitoring"]).toBe(true);
    expect(select["disableActiveMonitoringBecauseOfManualIncident"]).toBe(true);
    expect(
      select["disableActiveMonitoringBecauseOfScheduledMaintenanceEvent"],
    ).toBe(true);
  });

  test("the refusal is one the ingest workers treat as expected, not as a failure to retry", () => {
    expect(ExceptionMessages.MonitorArchived).toBe(
      "Monitor is archived. Unarchive it to start monitoring again.",
    );
    expect(ExceptionMessages.MonitorArchived).not.toBe(
      ExceptionMessages.MonitorDisabled,
    );
  });
});
