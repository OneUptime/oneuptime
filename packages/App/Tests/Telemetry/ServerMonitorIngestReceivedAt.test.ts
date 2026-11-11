/*
 * WHEN ONEUPTIME RECEIVED A SERVER AGENT'S REPORT (dataReceivedAt, issue
 * #6647).
 *
 * The server monitor ingest route answers the agent at once and queues its
 * report for a Telemetry worker, which evaluates it. A page that evaluation
 * starts used to be timed from when the worker created the incident or
 * alert, so a queue that fell behind did not show in the time it took to
 * page. Now:
 *
 *   - the route reads the server's clock as the report reaches it, before
 *     anything is checked or queued, and queues that moment with it;
 *   - the worker puts it on the report it evaluates (dataReceivedAt), in
 *     place of anything the agent wrote there, and never after now;
 *   - requestReceivedAt stays the moment the report is evaluated: what the
 *     monitor's online check counts from, unchanged.
 *
 * OnCallPageTiming.getMonitorDataReceivedAt reads the stamp back, as the
 * monitor's evaluation does when it starts a page.
 *
 * The route's own handler is driven off the router's stack; the queue,
 * MonitorResource and the services are mocked at their module boundary.
 */

jest.mock(
  "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService",
  () => {
    return {
      __esModule: true,
      default: {
        addServerMonitorIngestJob: jest.fn(),
      },
    };
  },
);

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

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEmptySuccessResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
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

import ServerMonitorAPI from "../../FeatureSet/Telemetry/API/ServerMonitorIngest/ServerMonitor";
import { processServerMonitorFromQueue } from "../../FeatureSet/Telemetry/Jobs/ServerMonitorIngest/ProcessServerMonitorIngest";
import TelemetryQueueService, {
  ServerMonitorIngestJobData,
} from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import MonitorService from "Common/Server/Services/MonitorService";
import OnCallPageTiming from "Common/Server/Utils/OnCall/OnCallPageTiming";
import Response from "Common/Server/Utils/Response";
import { ExpressRouter, RequestHandler } from "Common/Server/Utils/Express";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

const SECRET_KEY: string = "b1946ac9-2492-4b0f-9b2f-ee9b6cbe36ba";
const MONITOR_ID: string = "8f14e45f-ceea-467a-9575-1b0d0d3e7a9c";
const INGEST_PATH: string = "/server-monitor/response/ingest/:secretkey";

// When the route received the report; when the worker got to it.
const RECEIVED_AT: Date = new Date("2026-11-10T09:29:20.000Z");
const EVALUATED_AT: Date = new Date("2026-11-10T09:31:05.000Z");
// The agent's own word, which is never the receipt.
const AGENTS_CLOCK: string = "2020-01-01T00:00:00.000Z";

const addServerMonitorIngestJob: jest.Mock =
  TelemetryQueueService.addServerMonitorIngestJob as unknown as jest.Mock;
const sendEmptySuccessResponse: jest.Mock =
  Response.sendEmptySuccessResponse as unknown as jest.Mock;
const monitorResource: jest.Mock =
  MonitorResourceUtil.monitorResource as unknown as jest.Mock;
const findOneBy: jest.Mock = MonitorService.findOneBy as unknown as jest.Mock;

// Express 4 keeps these on each stack layer; its typings leave them out.
interface RouteLayer {
  route?:
    | {
        path: string;
        methods: Record<string, boolean>;
        stack: Array<{ handle: RequestHandler }>;
      }
    | undefined;
}

// The route's own handler: the last one in its stack.
function handlerFor(
  router: ExpressRouter,
  method: string,
  path: string,
): RequestHandler {
  const layers: Array<RouteLayer> = (
    router as unknown as { stack: Array<RouteLayer> }
  ).stack;

  const layer: RouteLayer | undefined = layers.find((candidate: RouteLayer) => {
    return (
      candidate.route?.path === path &&
      Boolean(candidate.route.methods[method.toLowerCase()])
    );
  });

  if (!layer?.route) {
    throw new Error(`${method} ${path} is not registered`);
  }

  return layer.route.stack[layer.route.stack.length - 1]!.handle;
}

// The report as the Go agent posts it: wrapped under serverMonitorResponse.
function agentBody(extra: JSONObject = {}): JSONObject {
  return {
    serverMonitorResponse: {
      hostname: "web-01.internal",
      requestReceivedAt: AGENTS_CLOCK,
      onlyCheckRequestReceivedAt: false,
      basicInfrastructureMetrics: {
        cpuMetrics: { percentUsed: 12.5, cores: 8 },
      },
      ...extra,
    },
  };
}

async function post(data: {
  secretKey?: string | undefined;
  body: JSONObject;
}): Promise<jest.Mock> {
  const next: jest.Mock = jest.fn() as unknown as jest.Mock;

  await (
    handlerFor(ServerMonitorAPI, "POST", INGEST_PATH) as unknown as (
      ...args: Array<unknown>
    ) => Promise<void>
  )(
    {
      params: data.secretKey === undefined ? {} : { secretkey: data.secretKey },
      headers: {},
      body: data.body,
    },
    {},
    next,
  );

  return next;
}

// A job as the worker reads it back from the queue: its moments as text.
function fromQueue(
  job: ServerMonitorIngestJobData,
): ServerMonitorIngestJobData {
  return JSON.parse(JSON.stringify(job)) as ServerMonitorIngestJobData;
}

function evaluated(): JSONObject {
  expect(monitorResource).toHaveBeenCalledTimes(1);
  return monitorResource.mock.calls[0]![0] as JSONObject;
}

let reads: number;
let clockStart: Date;
let clock: SpyInstance<typeof OneUptimeDate.getCurrentDate>;

beforeEach(() => {
  jest.clearAllMocks();

  reads = 0;
  clockStart = RECEIVED_AT;

  // The server's clock, a second later at each read: a later read would show.
  clock = jest
    .spyOn(OneUptimeDate, "getCurrentDate")
    .mockImplementation((): Date => {
      return new Date(clockStart.getTime() + 1000 * reads++);
    });

  addServerMonitorIngestJob.mockResolvedValue(undefined as never);

  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID;
  findOneBy.mockResolvedValue(monitor as never);
});

afterEach(() => {
  clock.mockRestore();
});

describe("POST /server-monitor/response/ingest/:secretkey: when OneUptime received the report", () => {
  test("is queued with the moment it reached the route - the first read of the clock", async () => {
    const next: jest.Mock = await post({
      secretKey: SECRET_KEY,
      body: agentBody(),
    });

    expect(next).not.toHaveBeenCalled();
    expect(sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
    expect(addServerMonitorIngestJob).toHaveBeenCalledTimes(1);

    const job: JSONObject = addServerMonitorIngestJob.mock
      .calls[0]![0] as JSONObject;

    expect(Object.keys(job).sort()).toEqual([
      "receivedAt",
      "secretKey",
      "serverMonitorResponse",
    ]);
    expect(job["receivedAt"]).toBeInstanceOf(Date);
    expect(job["receivedAt"]).toEqual(RECEIVED_AT);
    expect(job["secretKey"]).toBe(SECRET_KEY);
  });

  test("a body that says when it was received is not believed", async () => {
    await post({
      secretKey: SECRET_KEY,
      body: {
        ...agentBody({ dataReceivedAt: AGENTS_CLOCK }),
        receivedAt: AGENTS_CLOCK,
      },
    });

    const job: JSONObject = addServerMonitorIngestJob.mock
      .calls[0]![0] as JSONObject;

    expect(job["receivedAt"]).toEqual(RECEIVED_AT);
  });

  test("a report with no secret key is refused and queued with nothing", async () => {
    const next: jest.Mock = await post({ body: agentBody() });

    expect(next).toHaveBeenCalledTimes(1);
    expect(addServerMonitorIngestJob).not.toHaveBeenCalled();
  });
});

describe("the worker puts the receipt on the report it evaluates", () => {
  function job(data: {
    receivedAt: unknown;
    body?: JSONObject | undefined;
  }): ServerMonitorIngestJobData {
    return fromQueue({
      secretKey: SECRET_KEY,
      serverMonitorResponse: data.body || agentBody(),
      ingestionTimestamp: data.receivedAt as Date,
    });
  }

  beforeEach(() => {
    clockStart = EVALUATED_AT;
  });

  test("read back from the queue as text: the moment the route received it", async () => {
    await processServerMonitorFromQueue(job({ receivedAt: RECEIVED_AT }));

    const report: JSONObject = evaluated();

    expect(report["dataReceivedAt"]).toBeInstanceOf(Date);
    expect(report["dataReceivedAt"]).toEqual(RECEIVED_AT);
    // What a page its evaluation starts is timed from.
    expect(OnCallPageTiming.getMonitorDataReceivedAt(report)).toEqual(
      RECEIVED_AT,
    );
  });

  test("requestReceivedAt stays the moment it is evaluated - what the online check counts from", async () => {
    await processServerMonitorFromQueue(job({ receivedAt: RECEIVED_AT }));

    const report: JSONObject = evaluated();

    expect(report["requestReceivedAt"]).toEqual(EVALUATED_AT);
    expect(report["requestReceivedAt"]).not.toEqual(report["dataReceivedAt"]);
  });

  test("what the agent wrote there is replaced by OneUptime's own stamp", async () => {
    await processServerMonitorFromQueue(
      job({
        receivedAt: RECEIVED_AT,
        body: agentBody({ dataReceivedAt: AGENTS_CLOCK }),
      }),
    );

    expect(evaluated()["dataReceivedAt"]).toEqual(RECEIVED_AT);
  });

  test.each([
    ["no stamp", undefined],
    ["a stamp that is no moment", "soon"],
  ])(
    "a job with %s: what the agent wrote there is taken off, and the page is timed as before",
    async (_what: string, receivedAt: unknown) => {
      await processServerMonitorFromQueue(
        job({
          receivedAt: receivedAt,
          body: agentBody({ dataReceivedAt: AGENTS_CLOCK }),
        }),
      );

      const report: JSONObject = evaluated();

      expect("dataReceivedAt" in report).toBe(false);
      expect(OnCallPageTiming.getMonitorDataReceivedAt(report)).toBeUndefined();
    },
  );

  test("a stamp after now - the ingest server's clock ahead of the worker's - is now", async () => {
    await processServerMonitorFromQueue(
      job({ receivedAt: new Date(EVALUATED_AT.getTime() + 60 * 60 * 1000) }),
    );

    const report: JSONObject = evaluated();
    const stamped: number = (report["dataReceivedAt"] as Date).getTime();

    expect(stamped).toBeGreaterThanOrEqual(EVALUATED_AT.getTime());
    expect(stamped).toBeLessThanOrEqual(EVALUATED_AT.getTime() + 1000 * reads);
  });

  test("the route's job, through the queue, to the report evaluated: one moment end to end", async () => {
    clockStart = RECEIVED_AT;
    await post({ secretKey: SECRET_KEY, body: agentBody() });

    const queued: ServerMonitorIngestJobData = {
      secretKey: SECRET_KEY,
      serverMonitorResponse: (
        addServerMonitorIngestJob.mock.calls[0]![0] as JSONObject
      )["serverMonitorResponse"] as JSONObject,
      ingestionTimestamp: (
        addServerMonitorIngestJob.mock.calls[0]![0] as JSONObject
      )["receivedAt"] as Date,
    };

    // The worker gets to it a minute and three quarters later.
    clockStart = EVALUATED_AT;
    reads = 0;

    await processServerMonitorFromQueue(fromQueue(queued));

    expect(OnCallPageTiming.getMonitorDataReceivedAt(evaluated())).toEqual(
      RECEIVED_AT,
    );
  });
});
