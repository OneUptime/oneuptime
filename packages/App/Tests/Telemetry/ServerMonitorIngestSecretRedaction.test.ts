/*
 * https://github.com/OneUptime/oneuptime/issues/3360
 *
 * The infrastructure agent sends its secret TWICE: once as the last path
 * segment of the ingest URL, and once inside the JSON body
 * (InfrastructureAgent/model/server_monitor_report.go:
 * `SecretKey string \`json:"secretKey"\``). Only the URL copy authenticates.
 * The body copy used to survive `JSONFunctions.deserialize` -- which copies
 * every key it is given and does not care that `ServerMonitorResponse`
 * declares no `secretKey` -- and become `dataToProcess`, at which point
 * MonitorResource persists it into three Viewer-readable places:
 * MonitorLog.logBody, Monitor.serverMonitorResponse and
 * MonitorProbe.lastMonitoringLog.
 *
 * This suite pins the boundary: whatever the agent puts in the body, the
 * object handed to MonitorResourceUtil.monitorResource carries no credential.
 * That is the "never at rest" half of the fix -- redaction inside
 * MonitorLogUtil is the net underneath it, not a substitute, because the other
 * two sinks never go through MonitorLogUtil at all.
 *
 * MonitorResource is mocked wholesale: it is the assertion target here, and
 * importing it for real drags in the isolated-vm sandbox the criteria
 * evaluator uses.
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

import { processServerMonitorFromQueue } from "../../FeatureSet/Telemetry/Jobs/ServerMonitorIngest/ProcessServerMonitorIngest";
import { ServerMonitorIngestJobData } from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import MonitorService from "Common/Server/Services/MonitorService";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const SECRET: string = "b1946ac9-2492-4b0f-9b2f-ee9b6cbe36ba";

const MONITOR_ID: string = "8f14e45f-ceea-467a-9575-1b0d0d3e7a9c";

const monitorResource: jest.Mock =
  MonitorResourceUtil.monitorResource as unknown as jest.Mock;

const findOneBy: jest.Mock = MonitorService.findOneBy as unknown as jest.Mock;

type AgentBodyFunction = () => JSONObject;

/*
 * Byte-for-byte the JSON the Go agent marshals: `reqData` wraps the report
 * under a `serverMonitorResponse` key, and the API handler stores that whole
 * object as the job's `serverMonitorResponse`. Hence the double nesting below
 * -- it is not a typo, it is the wire format.
 */
const agentBody: AgentBodyFunction = (): JSONObject => {
  return {
    serverMonitorResponse: {
      secretKey: SECRET,
      basicInfrastructureMetrics: {
        cpuMetrics: { percentUsed: 12.5, cores: 8 },
        memoryMetrics: { total: 16_777_216, percentUsed: 75, cached: 4096 },
      },
      requestReceivedAt: "2026-08-23T10:00:00.000Z",
      onlyCheckRequestReceivedAt: false,
      processes: [
        { pid: 1, name: "systemd", command: "/sbin/init" },
        { pid: 42, name: "node", command: "node index.js" },
      ],
      hostname: "web-01.internal",
    },
  };
};

type JobDataFunction = (body?: JSONObject) => ServerMonitorIngestJobData;

const jobData: JobDataFunction = (
  body?: JSONObject,
): ServerMonitorIngestJobData => {
  return {
    secretKey: SECRET,
    serverMonitorResponse: body ?? agentBody(),
    ingestionTimestamp: new Date("2026-08-23T10:00:00.000Z"),
  };
};

type ProcessedPayloadFunction = () => JSONObject;

const processedPayload: ProcessedPayloadFunction = (): JSONObject => {
  expect(monitorResource).toHaveBeenCalledTimes(1);

  const calls: Array<Array<unknown>> = monitorResource.mock
    .calls as unknown as Array<Array<unknown>>;

  return calls[0]![0] as JSONObject;
};

describe("processServerMonitorFromQueue", () => {
  beforeEach(() => {
    monitorResource.mockClear();
    findOneBy.mockReset();

    const monitor: Monitor = new Monitor();
    monitor._id = MONITOR_ID;

    findOneBy.mockImplementation(() => {
      return Promise.resolve(monitor);
    });
  });

  it("does not pass the agent's secret on to the monitor pipeline", async () => {
    await processServerMonitorFromQueue(jobData());

    const payload: JSONObject = processedPayload();

    expect(payload["secretKey"]).toBeUndefined();
    expect("secretKey" in payload).toBe(false);
    expect(JSON.stringify(payload)).not.toContain(SECRET);
  });

  it("still authenticates using the secret from the URL", async () => {
    /*
     * Stripping the body copy must not break authentication -- the URL copy is
     * what the lookup uses, and it is untouched.
     */
    await processServerMonitorFromQueue(jobData());

    expect(findOneBy).toHaveBeenCalledTimes(1);

    const query: JSONObject = (
      (
        findOneBy.mock.calls as unknown as Array<Array<JSONObject>>
      )[0]![0] as JSONObject
    )["query"] as JSONObject;

    expect((query["serverMonitorSecretKey"] as ObjectID).toString()).toBe(
      SECRET,
    );
  });

  it("forwards every observation the beat carried", async () => {
    await processServerMonitorFromQueue(jobData());

    const payload: JSONObject = processedPayload();

    expect(payload["hostname"]).toBe("web-01.internal");
    expect(payload["onlyCheckRequestReceivedAt"]).toBe(false);
    expect(payload["basicInfrastructureMetrics"]).toEqual({
      cpuMetrics: { percentUsed: 12.5, cores: 8 },
      memoryMetrics: { total: 16_777_216, percentUsed: 75, cached: 4096 },
    });
    expect(payload["processes"]).toEqual([
      { pid: 1, name: "systemd", command: "/sbin/init" },
      { pid: 42, name: "node", command: "node index.js" },
    ]);
  });

  it("still stamps the fields the pipeline depends on", async () => {
    /*
     * These three assignments happen after the strip. If redaction ever ran
     * over the object again afterwards, or replaced it, monitorId would be
     * lost and the evaluation would be scoped to nothing.
     */
    await processServerMonitorFromQueue(jobData());

    const payload: JSONObject = processedPayload();

    expect((payload["monitorId"] as ObjectID).toString()).toBe(MONITOR_ID);
    expect(payload["requestReceivedAt"] instanceof Date).toBe(true);
    expect(payload["timeNow"] instanceof Date).toBe(true);
  });

  it("strips a credential the agent nested inside the metrics block", async () => {
    /*
     * Defence against a payload that is not the shape we expect. A body-copy
     * strip that only looked at the top level would be trivially bypassed by a
     * future agent version that moved the field.
     */
    const body: JSONObject = agentBody();

    (
      (body["serverMonitorResponse"] as JSONObject)[
        "basicInfrastructureMetrics"
      ] as JSONObject
    )["apiKey"] = SECRET;

    await processServerMonitorFromQueue(jobData(body));

    expect(JSON.stringify(processedPayload())).not.toContain(SECRET);
  });

  it("refuses a beat whose monitor cannot be found", async () => {
    findOneBy.mockImplementation(() => {
      return Promise.resolve(null);
    });

    await expect(processServerMonitorFromQueue(jobData())).rejects.toThrow();

    expect(monitorResource).not.toHaveBeenCalled();
  });

  it("refuses a beat with no secret key at all", async () => {
    await expect(
      processServerMonitorFromQueue({
        ...jobData(),
        secretKey: "",
      }),
    ).rejects.toThrow();

    expect(monitorResource).not.toHaveBeenCalled();
  });
});
