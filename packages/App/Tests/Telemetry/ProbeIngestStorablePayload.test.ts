/*
 * The two jsonb writes the probe ingest worker makes itself, before (or
 * instead of) handing the payload to monitorResource:
 *
 *   - Monitor.incomingEmailMonitorRequest, the last email an Incoming Email
 *     monitor received;
 *   - MonitorTest.monitorStepProbeResponse, a "test monitor" run's result.
 *
 * Postgres refuses a NUL anywhere in a jsonb value ("unsupported Unicode
 * escape sequence"), and both payloads are whatever an outside party sent:
 * an email body or attachment name, the body an endpoint returned. One NUL
 * failed the write - and the email write comes BEFORE monitorResource, so
 * the email was never evaluated and the job failed on every retry.
 *
 * The writes are stubbed to refuse exactly what Postgres refuses
 * (Common/Tests/Helpers/PostgresJsonbInput). MonitorResource is mocked
 * wholesale: it is an assertion target here, and importing it for real drags
 * in the isolated-vm sandbox the criteria evaluator uses.
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
      updateColumnsByIdWithoutHooks: jest.fn(),
      getEnabledMonitorQuery: jest.fn(() => {
        return {};
      }),
    },
  };
});

jest.mock("Common/Server/Services/MonitorTestService", () => {
  return {
    __esModule: true,
    default: {
      mergeStepProbeResponse: jest.fn(),
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

import {
  processIncomingEmailFromQueue,
  processProbeFromQueue,
} from "../../FeatureSet/Telemetry/Jobs/ProbeIngest/ProcessProbeIngest";
import {
  IncomingEmailJobData,
  ProbeIngestJobData,
} from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import MonitorService from "Common/Server/Services/MonitorService";
import MonitorTestService from "Common/Server/Services/MonitorTestService";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import { MonitorStepProbeResponse } from "Common/Models/DatabaseModels/MonitorProbe";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import IncomingEmailMonitorRequest from "Common/Types/Monitor/IncomingEmailMonitor/IncomingEmailMonitorRequest";
import ObjectID from "Common/Types/ObjectID";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import {
  assertJsonbAccepts,
  jsonbWouldRefuse,
} from "Common/Tests/Helpers/PostgresJsonbInput";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const EMAIL_SECRET: string = "b1946ac9-2492-4b0f-9b2f-ee9b6cbe36ba";
const MONITOR_ID: string = "8f14e45f-ceea-467a-9575-1b0d0d3e7a9c";
const PROJECT_ID: string = "3c6e0b8a-9c15-4f8b-a1d2-7e5f4c3b2a19";
const TEST_ID: string = "6f1c3c8e-2b7a-4d4e-9f0a-1c2d3e4f5a6b";
const STEP_ID: string = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

const monitorResource: jest.Mock =
  MonitorResourceUtil.monitorResource as unknown as jest.Mock;

const findOneBy: jest.Mock = MonitorService.findOneBy as unknown as jest.Mock;

const updateColumns: jest.Mock =
  MonitorService.updateColumnsByIdWithoutHooks as unknown as jest.Mock;

const mergeStepProbeResponse: jest.Mock =
  MonitorTestService.mergeStepProbeResponse as unknown as jest.Mock;

// The first bytes of a ZIP archive, as a probe or a mail parser decodes them.
const ZIP_TEXT: string = "PK\u0003\u0004\u0014\u0000\u0000\u0000\u0008\u0000";
const STORED_ZIP_TEXT: string =
  "PK\u0003\u0004\u0014\uFFFD\uFFFD\uFFFD\u0008\uFFFD";

type EmailJobFunction = (
  overrides?: Partial<IncomingEmailJobData>,
) => ProbeIngestJobData;

const emailJob: EmailJobFunction = (
  overrides?: Partial<IncomingEmailJobData>,
): ProbeIngestJobData => {
  return {
    jobType: "incoming-email",
    ingestionTimestamp: new Date("2026-10-06T10:00:00.000Z"),
    incomingEmail: {
      secretKey: EMAIL_SECRET,
      emailFrom: "backups@acme.example",
      emailTo: `monitor-${EMAIL_SECRET}@inbound.oneuptime.example`,
      emailSubject: "Nightly backup\u0000 completed",
      emailBody: `Backup log follows:\n${ZIP_TEXT}`,
      emailBodyHtml: "<pre>\u0000</pre>",
      emailHeaders: {
        "X-Backup-Run": "run\u000042",
      },
      attachments: [
        {
          filename: "backup\u0000.zip",
          contentType: "application/zip",
          size: 2048,
        },
      ],
      ...overrides,
    },
  } as ProbeIngestJobData;
};

type PersistedEmailFunction = () => JSONObject;

// What was written to Monitor.incomingEmailMonitorRequest.
const persistedEmail: PersistedEmailFunction = (): JSONObject => {
  expect(updateColumns).toHaveBeenCalledTimes(1);

  const input: JSONObject = (
    updateColumns.mock.calls as unknown as Array<Array<JSONObject>>
  )[0]![0] as JSONObject;

  return (input["data"] as JSONObject)[
    "incomingEmailMonitorRequest"
  ] as JSONObject;
};

type RefuseLikePostgresFunction = (write: {
  data: JSONObject;
}) => Promise<void>;

// Every column value, checked the way the driver binds it.
const refuseLikePostgres: RefuseLikePostgresFunction = (write: {
  data: JSONObject;
}): Promise<void> => {
  for (const value of Object.values(write.data)) {
    assertJsonbAccepts(value);
  }

  return Promise.resolve();
};

beforeEach(() => {
  monitorResource.mockClear();
  updateColumns.mockReset();
  mergeStepProbeResponse.mockReset();
  findOneBy.mockReset();

  updateColumns.mockImplementation(refuseLikePostgres);

  mergeStepProbeResponse.mockImplementation(
    (data: {
      monitorStepProbeResponse: MonitorStepProbeResponse;
    }): Promise<void> => {
      // The service binds JSON.stringify(monitorStepProbeResponse)::jsonb.
      assertJsonbAccepts(data.monitorStepProbeResponse);
      return Promise.resolve();
    },
  );

  findOneBy.mockImplementation(() => {
    const monitor: Monitor = new Monitor();
    monitor._id = MONITOR_ID;
    monitor.projectId = new ObjectID(PROJECT_ID);
    monitor.incomingEmailSecretKey = new ObjectID(EMAIL_SECRET);
    return Promise.resolve(monitor);
  });
});

describe("An Incoming Email monitor's email with NUL in it", () => {
  it("is stored, then evaluated - the job no longer fails before monitorResource", async () => {
    await expect(
      processIncomingEmailFromQueue(emailJob()),
    ).resolves.toBeUndefined();

    expect(updateColumns).toHaveBeenCalledTimes(1);
    expect(monitorResource).toHaveBeenCalledTimes(1);
    expect(jsonbWouldRefuse(persistedEmail())).toBe(false);
  });

  it("stores U+FFFD wherever the email held NUL", async () => {
    await processIncomingEmailFromQueue(emailJob());

    const stored: JSONObject = persistedEmail();

    expect(stored["emailSubject"]).toBe("Nightly backup\uFFFD completed");
    expect(stored["emailBody"]).toBe(`Backup log follows:\n${STORED_ZIP_TEXT}`);
    expect(stored["emailBodyHtml"]).toBe("<pre>\uFFFD</pre>");
    expect(stored["emailHeaders"]).toEqual({ "X-Backup-Run": "run\uFFFD42" });
    expect(stored["attachments"]).toEqual([
      {
        filename: "backup\uFFFD.zip",
        contentType: "application/zip",
        size: 2048,
      },
    ]);
  });

  it("still masks the monitor's own address in the stored copy", async () => {
    await processIncomingEmailFromQueue(
      emailJob({
        emailBody: `Sent to monitor-${EMAIL_SECRET}@inbound.oneuptime.example\u0000`,
      }),
    );

    const stored: JSONObject = persistedEmail();

    expect(JSON.stringify(stored).includes(EMAIL_SECRET)).toBe(false);
    expect(stored["emailBody"]).toBe(
      "Sent to monitor-[REDACTED]@inbound.oneuptime.example\uFFFD",
    );
  });

  it("is evaluated exactly as it arrived", async () => {
    await processIncomingEmailFromQueue(emailJob());

    const evaluated: IncomingEmailMonitorRequest = (
      monitorResource.mock.calls as unknown as Array<Array<unknown>>
    )[0]![0] as IncomingEmailMonitorRequest;

    // Criteria such as "Email body contains" see the NUL the sender sent.
    expect(evaluated.emailBody).toBe(`Backup log follows:\n${ZIP_TEXT}`);
    expect(evaluated.emailSubject).toBe("Nightly backup\u0000 completed");
    expect(evaluated.emailReceivedAt).toBeInstanceOf(Date);
    expect(evaluated.monitorId).toBeInstanceOf(ObjectID);
  });

  it("stores the dates as the JSON strings the driver always wrote", async () => {
    await processIncomingEmailFromQueue(emailJob());

    const stored: JSONObject = persistedEmail();
    const evaluated: IncomingEmailMonitorRequest = (
      monitorResource.mock.calls as unknown as Array<Array<unknown>>
    )[0]![0] as IncomingEmailMonitorRequest;

    expect(stored["emailReceivedAt"]).toBe(
      evaluated.emailReceivedAt.toISOString(),
    );
    expect(stored["monitorId"]).toEqual(
      JSON.parse(JSON.stringify(new ObjectID(MONITOR_ID))),
    );
  });

  it("writes an email with nothing to replace exactly as before", async () => {
    await processIncomingEmailFromQueue(
      emailJob({
        emailSubject: "Nightly backup completed",
        emailBody: "Backup finished in 42 minutes. 0 errors.",
        emailBodyHtml: "<p>Backup finished.</p>",
        emailHeaders: { "X-Backup-Run": "run-42" },
        attachments: [],
      }),
    );

    const evaluated: IncomingEmailMonitorRequest = (
      monitorResource.mock.calls as unknown as Array<Array<unknown>>
    )[0]![0] as IncomingEmailMonitorRequest;

    // The driver stringifies the value it is given; same JSON either way.
    expect(JSON.stringify(persistedEmail())).toBe(JSON.stringify(evaluated));
  });
});

describe("A monitor test run whose response held NUL", () => {
  type MonitorTestJobFunction = (
    probeResponse: ProbeMonitorResponse,
  ) => ProbeIngestJobData;

  // The shape the probe ingest API enqueues for a "test monitor" run.
  const monitorTestJob: MonitorTestJobFunction = (
    probeResponse: ProbeMonitorResponse,
  ): ProbeIngestJobData => {
    return {
      jobType: "monitor-test",
      testId: TEST_ID,
      ingestionTimestamp: new Date("2026-10-06T10:00:00.000Z"),
      probeMonitorResponse: {
        probeMonitorResponse: JSONFunctions.serialize(
          probeResponse as unknown as JSONObject,
        ),
      },
    };
  };

  const probeResponse: ProbeMonitorResponse = {
    projectId: new ObjectID(PROJECT_ID),
    monitorId: new ObjectID(MONITOR_ID),
    monitorStepId: new ObjectID(STEP_ID),
    probeId: new ObjectID("44444444-4444-4444-8444-444444444444"),
    isOnline: true,
    responseCode: 200,
    responseBody: ZIP_TEXT,
    responseHeaders: { "content-type": "application/zip" },
    failureCause: "",
    monitoredAt: new Date("2026-10-06T09:59:59.000Z"),
  } as unknown as ProbeMonitorResponse;

  it("merges a storable copy into MonitorTest.monitorStepProbeResponse", async () => {
    await expect(
      processProbeFromQueue(monitorTestJob(probeResponse)),
    ).resolves.toBeUndefined();

    expect(mergeStepProbeResponse).toHaveBeenCalledTimes(1);

    const input: {
      testId: ObjectID;
      monitorStepProbeResponse: MonitorStepProbeResponse;
    } = (
      mergeStepProbeResponse.mock.calls as unknown as Array<
        Array<{
          testId: ObjectID;
          monitorStepProbeResponse: MonitorStepProbeResponse;
        }>
      >
    )[0]![0]!;

    expect(input.testId.toString()).toBe(TEST_ID);

    const stored: ProbeMonitorResponse = input.monitorStepProbeResponse[
      STEP_ID
    ] as ProbeMonitorResponse;

    expect(stored.responseBody).toBe(STORED_ZIP_TEXT);
    expect(stored.responseCode).toBe(200);
    expect(stored.monitoredAt).toBeInstanceOf(Date);
    expect(jsonbWouldRefuse(input.monitorStepProbeResponse)).toBe(false);
  });

  it("does not evaluate a test run as a check result", async () => {
    await processProbeFromQueue(monitorTestJob(probeResponse));

    expect(monitorResource).not.toHaveBeenCalled();
  });
});
