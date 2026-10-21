/*
 * Incoming Request and Incoming Email monitors are fed by a sender outside
 * OneUptime, which keeps sending whether or not the monitor is archived. An
 * archived monitor must open nothing from what arrives: the ingest jobs skip
 * the evaluation (monitorResource) for it, the same way they skip a disabled
 * monitor, and read the archive flag along with the other pause flags to
 * decide.
 *
 * An email to an archived Incoming Email monitor is still recorded, as it is
 * for a disabled one - the Monitor Summary keeps showing the last email - but
 * it evaluates nothing, so it opens no incident or alert.
 */

jest.mock("Common/Server/Utils/Monitor/MonitorResource", () => {
  return {
    __esModule: true,
    default: {
      monitorResource: jest.fn(() => {
        return Promise.resolve({});
      }),
    },
  };
});

jest.mock("Common/Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
      updateColumnsByIdWithoutHooks: jest.fn(() => {
        return Promise.resolve();
      }),
      getEnabledMonitorQuery: jest.fn(() => {
        return {};
      }),
    },
  };
});

jest.mock("Common/Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: {
      getActiveProjectStatusQuery: jest.fn(() => {
        return {};
      }),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
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

import { processIncomingEmailFromQueue } from "../../FeatureSet/Telemetry/Jobs/ProbeIngest/ProcessProbeIngest";
import { processIncomingRequestFromQueue } from "../../FeatureSet/Telemetry/Jobs/IncomingRequestIngest/ProcessIncomingRequestIngest";
import {
  IncomingRequestIngestJobData,
  ProbeIngestJobData,
} from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import { isNonActionableIngestError } from "../../FeatureSet/Telemetry/Utils/NonActionableIngestError";
import BadDataException from "Common/Types/Exception/BadDataException";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import MonitorService from "Common/Server/Services/MonitorService";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import fs from "fs";
import path from "path";

const EMAIL_SECRET: string = "c1946ac9-2492-4b0f-9b2f-ee9b6cbe36ba";
const REQUEST_SECRET: string = "2d229271-17c4-4b4f-9a3b-3c6ff1a1a2ee";
const MONITOR_ID: string = "9f14e45f-ceea-467a-9575-1b0d0d3e7a9c";
const PROJECT_ID: string = "4c6e0b8a-9c15-4f8b-a1d2-7e5f4c3b2a19";

const monitorResource: jest.Mock =
  MonitorResourceUtil.monitorResource as unknown as jest.Mock;
const findOneBy: jest.Mock = MonitorService.findOneBy as unknown as jest.Mock;
const updateColumns: jest.Mock =
  MonitorService.updateColumnsByIdWithoutHooks as unknown as jest.Mock;

function monitor(isArchived: boolean): Monitor {
  const row: Monitor = new Monitor();
  row._id = MONITOR_ID;
  row.projectId = new ObjectID(PROJECT_ID);
  row.isArchived = isArchived;
  row.disableActiveMonitoring = false;
  row.disableActiveMonitoringBecauseOfManualIncident = false;
  row.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent = false;
  return row;
}

function emailJob(): ProbeIngestJobData {
  return {
    jobType: "incoming-email",
    ingestionTimestamp: new Date("2026-10-01T10:00:00.000Z"),
    incomingEmail: {
      secretKey: EMAIL_SECRET,
      emailFrom: "alerts@acme.example",
      emailTo: `monitor-${EMAIL_SECRET}@inbound.oneuptime.example`,
      emailSubject: "Nightly backup completed",
      emailBody: "Backup finished.",
      emailBodyHtml: "<p>Backup finished.</p>",
      emailHeaders: {},
      attachments: [],
    },
  } as unknown as ProbeIngestJobData;
}

function requestJob(): IncomingRequestIngestJobData {
  return {
    secretKey: REQUEST_SECRET,
    requestHeaders: { "content-type": "application/json" },
    requestBody: { status: "ok" },
    requestMethod: "POST",
    ingestionTimestamp: new Date("2026-10-01T10:00:00.000Z"),
  };
}

function lastSelect(): JSONObject {
  const call: Array<unknown> | undefined =
    findOneBy.mock.calls[findOneBy.mock.calls.length - 1];
  return ((call?.[0] as { select?: JSONObject }) || {}).select || {};
}

beforeEach(() => {
  monitorResource.mockClear();
  updateColumns.mockClear();
  findOneBy.mockReset();
});

describe("an email to an archived Incoming Email monitor", () => {
  it("is recorded but evaluates nothing, so it opens no incident or alert", async () => {
    findOneBy.mockResolvedValue(monitor(true) as never);

    await processIncomingEmailFromQueue(emailJob());

    expect(updateColumns).toHaveBeenCalledTimes(1);
    expect(monitorResource).not.toHaveBeenCalled();
  });

  it("is read with the archive flag", async () => {
    findOneBy.mockResolvedValue(monitor(true) as never);

    await processIncomingEmailFromQueue(emailJob());

    expect(lastSelect()["isArchived"]).toBe(true);
  });

  it("is evaluated again once the monitor is unarchived", async () => {
    findOneBy.mockResolvedValue(monitor(false) as never);

    await processIncomingEmailFromQueue(emailJob());

    expect(monitorResource).toHaveBeenCalledTimes(1);
  });
});

describe("a request to an archived Incoming Request monitor", () => {
  it("evaluates nothing", async () => {
    findOneBy.mockResolvedValue(monitor(true) as never);

    await processIncomingRequestFromQueue(requestJob());

    expect(monitorResource).not.toHaveBeenCalled();
  });

  it("is read with the archive flag", async () => {
    findOneBy.mockResolvedValue(monitor(true) as never);

    await processIncomingRequestFromQueue(requestJob());

    expect(lastSelect()["isArchived"]).toBe(true);
  });

  it("is evaluated again once the monitor is unarchived", async () => {
    findOneBy.mockResolvedValue(monitor(false) as never);

    await processIncomingRequestFromQueue(requestJob());

    expect(monitorResource).toHaveBeenCalledTimes(1);
  });
});

describe("the telemetry worker", () => {
  it("treats a result refused for an archived monitor as expected, not as a job to retry", () => {
    /*
     * MonitorResource throws MonitorArchived for a result that still reaches
     * an archived monitor; the telemetry job swallows the non-actionable
     * refusals (not found, disabled) instead of failing and retrying them,
     * and archived must be one of them. The worker's catch returns on what
     * isNonActionableIngestError accepts.
     */
    expect(
      isNonActionableIngestError(
        new BadDataException(ExceptionMessages.MonitorDisabled),
      ),
    ).toBe(true);
    expect(
      isNonActionableIngestError(
        new BadDataException(ExceptionMessages.MonitorArchived),
      ),
    ).toBe(true);

    const source: string = fs.readFileSync(
      path.join(
        __dirname,
        "../../FeatureSet/Telemetry/Jobs/TelemetryIngest/ProcessTelemetry.ts",
      ),
      "utf8",
    );
    const guardStart: number = source.indexOf(
      "if (isNonActionableIngestError(error)) {",
    );

    expect(guardStart).toBeGreaterThan(-1);

    const guard: string = source.slice(
      guardStart,
      source.indexOf("logger.error(`Error processing telemetry job:`);"),
    );

    expect(guard).toContain("return;");
  });
});
