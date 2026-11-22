import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * LOGS FROM FLUENT BIT, FLUENTD AND SYSLOG, AND A BATCH'S ATTRIBUTION
 * (#10102): their batches count against the teams' and labels' budgets of
 * the services they are filed under, and in the usage metrics, as an OTLP
 * batch's do.
 *
 *   - The handlers carry the size the request path counted - read before
 *     they reshape the body - for a project whose batches are attributed,
 *     and nothing for any other.
 *   - Fluent files every entry of a batch under one service: it is offered
 *     once, with all of them, and a used-up budget drops the whole batch.
 *   - Syslog files each line under the service the line names: each line is
 *     offered with its service, a used-up budget drops that service's lines,
 *     and the rest of the batch is stored.
 *   - Either is settled once, after its records.
 *
 * Drives the real handlers and the real ingest walks, with an attribution
 * that drops what a test says, and every backend touchpoint stubbed: the
 * queue, the service lookup, the writer, the pipelines and the device
 * matcher. The attribution itself, against a real Valkey, is
 * FluentSyslogTeamBudgetsValkey.test.ts's.
 */

const addFluentLogIngestJob: jest.Mock = jest.fn();
const addSyslogIngestJob: jest.Mock = jest.fn();

jest.mock(
  "../../FeatureSet/Telemetry/Services/Queue/FluentLogsQueueService",
  () => {
    return {
      __esModule: true,
      default: {
        addFluentLogIngestJob: (...args: Array<unknown>): unknown => {
          return addFluentLogIngestJob(...args);
        },
      },
    };
  },
);

jest.mock(
  "../../FeatureSet/Telemetry/Services/Queue/SyslogQueueService",
  () => {
    return {
      __esModule: true,
      default: {
        addSyslogIngestJob: (...args: Array<unknown>): unknown => {
          return addSyslogIngestJob(...args);
        },
      },
    };
  },
);

jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEmptySuccessResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
      sendCustomResponse: jest.fn(),
    },
  };
});

import FluentLogsIngestService from "../../FeatureSet/Telemetry/Services/FluentLogsIngestService";
import SyslogIngestService from "../../FeatureSet/Telemetry/Services/SyslogIngestService";
import LogPipelineService from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import LogDropFilterService from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import SyslogDeviceMatcher from "Common/Server/Utils/Syslog/SyslogDeviceMatcher";
import TelemetryFanInWriter from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import TelemetryIngestAttribution, {
  TelemetryIngestAttributionResource,
} from "Common/Server/Utils/Telemetry/TelemetryIngestAttribution";
import TelemetryIngestAttributionSettings from "Common/Server/Utils/Telemetry/TelemetryIngestAttributionSettings";
import { TelemetryIngestionBudgetCharge } from "Common/Server/Utils/Telemetry/TelemetryIngestionBudget";
import { JSONObject } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";

const PROJECT: ObjectID = ObjectID.generate();

// An attribution that drops the services a test names, as used-up budgets would.
class StubAttribution {
  public offered: Array<TelemetryIngestAttributionResource> = [];
  public settled: number = 0;

  public constructor(private readonly dropped: Array<string> = []) {}

  public async admitResource(
    resource: TelemetryIngestAttributionResource,
  ): Promise<boolean> {
    this.offered.push({ ...resource });
    return !this.dropped.includes(resource.name);
  }

  public getDroppedResourceCount(): number {
    return new Set(
      this.offered
        .map((resource: TelemetryIngestAttributionResource) => {
          return resource.name;
        })
        .filter((name: string) => {
          return this.dropped.includes(name);
        }),
    ).size;
  }

  public async settle(): Promise<void> {
    this.settled++;
  }
}

let submittedRows: Array<JSONObject> = [];
const serviceIds: Map<string, ObjectID> = new Map();

const serviceIdFor: (name: string) => ObjectID = (name: string): ObjectID => {
  if (!serviceIds.has(name)) {
    serviceIds.set(name, ObjectID.generate());
  }

  return serviceIds.get(name)!;
};

beforeEach(() => {
  jest.clearAllMocks();
  SyslogDeviceMatcher.clearCaches();
  submittedRows = [];

  jest.spyOn(NetworkDeviceService, "findBy").mockResolvedValue([] as never);
  jest
    .spyOn(OTelIngestService, "telemetryServiceFromName")
    .mockImplementation((async (data: {
      serviceName: string;
    }): Promise<TelemetryServiceMetadata> => {
      return {
        serviceName: data.serviceName,
        primaryEntityId: serviceIdFor(data.serviceName),
        primaryEntityType: ServiceType.OpenTelemetry,
        dataRententionInDays: 30,
        serviceRetentionConfig: null,
        serviceRetentionInDays: 30,
        projectRetentionConfig: null,
        projectRetentionInDays: 15,
      };
    }) as never);
  jest.spyOn(TelemetryFanInWriter, "submit").mockImplementation((async (
    _service: unknown,
    rows: Array<JSONObject>,
  ): Promise<{ flushed: Promise<void> }> => {
    submittedRows.push(...rows);
    return { flushed: Promise.resolve() };
  }) as never);
  jest
    .spyOn(LogPipelineService, "loadPipelines")
    .mockResolvedValue([] as never);
  jest
    .spyOn(LogDropFilterService, "loadDropFilters")
    .mockResolvedValue([] as never);
  jest
    .spyOn(LogScrubRuleService, "loadScrubRules")
    .mockResolvedValue([] as never);
  addFluentLogIngestJob.mockResolvedValue(undefined as never);
  addSyslogIngestJob.mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  SyslogDeviceMatcher.clearCaches();
});

const workerRequest: (data: {
  body: JSONObject;
  headers?: Record<string, string>;
  attribution: StubAttribution | null;
}) => ExpressRequest = (data: {
  body: JSONObject;
  headers?: Record<string, string>;
  attribution: StubAttribution | null;
}): ExpressRequest => {
  return {
    projectId: PROJECT,
    body: data.body,
    headers: data.headers || {},
    query: {},
    telemetryIngestAttribution:
      data.attribution as unknown as TelemetryIngestAttribution | null,
  } as unknown as ExpressRequest;
};

const offers: (
  attribution: StubAttribution,
) => Array<[string, string, string, number]> = (
  attribution: StubAttribution,
): Array<[string, string, string, number]> => {
  return attribution.offered.map(
    (resource: TelemetryIngestAttributionResource) => {
      return [
        resource.name,
        resource.primaryEntityId.toString(),
        resource.primaryEntityType,
        resource.records,
      ];
    },
  );
};

const bodies: () => Array<unknown> = (): Array<unknown> => {
  return submittedRows.map((row: JSONObject) => {
    return row["body"];
  });
};

describe("a Fluent Bit or Fluentd batch, in the worker", () => {
  const ENTRIES: Array<JSONObject> = [
    { message: "paid", level: "info" },
    { message: "shipped", level: "info" },
    { message: "refunded", level: "warn" },
  ];

  const ingest: (data: {
    attribution: StubAttribution | null;
  }) => Promise<void> = async (data: {
    attribution: StubAttribution | null;
  }): Promise<void> => {
    await FluentLogsIngestService.processFluentLogsFromQueue(
      workerRequest({
        body: { entries: ENTRIES },
        headers: { "x-oneuptime-service-name": "checkout" },
        attribution: data.attribution,
      }),
    );
  };

  test("offers its one service once, with every entry, and settles the batch once", async () => {
    const attribution: StubAttribution = new StubAttribution();

    await ingest({ attribution });

    expect(offers(attribution)).toEqual([
      [
        "checkout",
        serviceIdFor("checkout").toString(),
        ServiceType.OpenTelemetry,
        3,
      ],
    ]);
    expect(attribution.settled).toBe(1);
    expect(bodies()).toEqual(["paid", "shipped", "refunded"]);
  });

  test("stores none of a batch a used-up budget of its service's team or label drops, and settles it all the same", async () => {
    const attribution: StubAttribution = new StubAttribution(["checkout"]);

    await ingest({ attribution });

    expect(submittedRows).toEqual([]);
    expect(attribution.settled).toBe(1);
  });

  test("stores the whole batch, as before, for a project that needs no attribution", async () => {
    await ingest({ attribution: null });

    expect(bodies()).toEqual(["paid", "shipped", "refunded"]);
  });
});

describe("a syslog batch, in the worker", () => {
  const LINES: Array<string> = [
    "<13>1 2026-11-22T10:00:00Z web-01 checkout - - - paid",
    "<13>1 2026-11-22T10:00:01Z web-01 cart - - - added",
    "<13>1 2026-11-22T10:00:02Z web-01 checkout - - - shipped",
    // A line that names no service is filed under the default one.
    "disk almost full",
    "<13>1 2026-11-22T10:00:03Z web-01 checkout - - - refunded",
  ];

  const ingest: (data: {
    attribution: StubAttribution | null;
  }) => Promise<void> = async (data: {
    attribution: StubAttribution | null;
  }): Promise<void> => {
    await SyslogIngestService.processSyslogFromQueue(
      workerRequest({
        body: { messages: LINES },
        attribution: data.attribution,
      }),
    );
  };

  test("offers each line with the service it is filed under, one record a line, and settles the batch once", async () => {
    const attribution: StubAttribution = new StubAttribution();

    await ingest({ attribution });

    const checkout: string = serviceIdFor("checkout").toString();
    const cart: string = serviceIdFor("cart").toString();
    const syslog: string = serviceIdFor("Syslog").toString();

    expect(offers(attribution)).toEqual([
      ["checkout", checkout, ServiceType.OpenTelemetry, 1],
      ["cart", cart, ServiceType.OpenTelemetry, 1],
      ["checkout", checkout, ServiceType.OpenTelemetry, 1],
      ["Syslog", syslog, ServiceType.OpenTelemetry, 1],
      ["checkout", checkout, ServiceType.OpenTelemetry, 1],
    ]);
    expect(attribution.settled).toBe(1);
    expect(bodies()).toEqual([
      "paid",
      "added",
      "shipped",
      "disk almost full",
      "refunded",
    ]);
  });

  test("skips the lines of a service whose team's or label's budget is used up, and stores the rest", async () => {
    const attribution: StubAttribution = new StubAttribution(["checkout"]);

    await ingest({ attribution });

    expect(bodies()).toEqual(["added", "disk almost full"]);
    expect(
      submittedRows.map((row: JSONObject) => {
        return row["primaryEntityId"];
      }),
    ).toEqual([
      serviceIdFor("cart").toString(),
      serviceIdFor("Syslog").toString(),
    ]);
    expect(attribution.settled).toBe(1);
  });

  test("a dropped line is never matched to a network device: the work after it is not done", async () => {
    const attribution: StubAttribution = new StubAttribution([
      "checkout",
      "cart",
      "Syslog",
    ]);
    const findDevice: jest.SpiedFunction<
      typeof SyslogDeviceMatcher.findDeviceInProject
    > = jest.spyOn(SyslogDeviceMatcher, "findDeviceInProject");

    await ingest({ attribution });

    expect(submittedRows).toEqual([]);
    expect(findDevice).not.toHaveBeenCalled();
    expect(attribution.settled).toBe(1);
  });

  test("stores every line, as before, for a project that needs no attribution", async () => {
    await ingest({ attribution: null });

    expect(bodies()).toEqual([
      "paid",
      "added",
      "shipped",
      "disk almost full",
      "refunded",
    ]);
  });
});

/*
 * The handlers: the size the worker shares a batch out at is read before
 * they reshape its body - the request path's count when it counted, else
 * the same measure of the body as it arrived - for a project whose batches
 * are attributed only.
 */
describe("the size a Fluent or syslog request carries for its attribution", () => {
  const countedAt: (bytes: number) => TelemetryIngestionBudgetCharge = (
    bytes: number,
  ): TelemetryIngestionBudgetCharge => {
    return {
      projectId: PROJECT.toString(),
      signal: ProductType.Logs,
      dayId: "20261122T0000Z",
      dayTtlSeconds: 1000,
      countedBytes: bytes,
      isExact: true,
      isPending: false,
      scopes: [],
    };
  };

  const send: (data: {
    handler: (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ) => Promise<void>;
    body: unknown;
    rawBody?: string;
    charge?: TelemetryIngestionBudgetCharge | null;
  }) => Promise<TelemetryRequest> = async (data: {
    handler: (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ) => Promise<void>;
    body: unknown;
    rawBody?: string;
    charge?: TelemetryIngestionBudgetCharge | null;
  }): Promise<TelemetryRequest> => {
    const req: Record<string, unknown> = {
      projectId: PROJECT,
      body: data.body,
      headers: {},
      ...(data.rawBody !== undefined ? { rawBody: data.rawBody } : {}),
      ...(data.charge !== undefined
        ? { telemetryIngestionBudgetCharge: data.charge }
        : {}),
    };
    const next: jest.Mock = jest.fn();

    await data.handler(
      req as unknown as ExpressRequest,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );

    expect(next).not.toHaveBeenCalled();

    return req as unknown as TelemetryRequest;
  };

  const FLUENT_RAW: string = JSON.stringify([
    { message: "paid", level: "info" },
    { message: "shipped", level: "info" },
  ]);
  const SYSLOG_RAW: string =
    "<13>1 2026-11-22T10:00:00Z web-01 checkout - - - paid\n<13>1 2026-11-22T10:00:01Z web-01 cart - - - added";

  const handlers: Array<{
    name: string;
    handler: (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ) => Promise<void>;
    body: () => unknown;
    rawBody?: string;
    measured: number;
    queued: jest.Mock;
  }> = [
    {
      name: "Fluent",
      handler: (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        return FluentLogsIngestService.ingestFluentLogs(req, res, next);
      },
      body: (): unknown => {
        return JSON.parse(FLUENT_RAW);
      },
      rawBody: FLUENT_RAW,
      measured: Buffer.byteLength(FLUENT_RAW, "utf8"),
      queued: addFluentLogIngestJob,
    },
    {
      name: "syslog",
      handler: (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        return SyslogIngestService.ingestSyslog(req, res, next);
      },
      body: (): unknown => {
        return SYSLOG_RAW;
      },
      measured: Buffer.byteLength(SYSLOG_RAW, "utf8"),
      queued: addSyslogIngestJob,
    },
  ];

  for (const kind of handlers) {
    test(`${kind.name}: a project that needs no attribution carries nothing, and its body is not measured`, async () => {
      jest
        .spyOn(TelemetryIngestAttributionSettings, "isAttributedProject")
        .mockResolvedValue(false);

      const req: TelemetryRequest = await send({
        handler: kind.handler,
        body: kind.body(),
        ...(kind.rawBody !== undefined ? { rawBody: kind.rawBody } : {}),
        charge: null,
      });

      expect(kind.queued).toHaveBeenCalledTimes(1);
      expect(req.telemetryIngestBytes).toBe(undefined);
    });

    test(`${kind.name}: an attributed project carries what the request path counted, read before the body was reshaped`, async () => {
      jest
        .spyOn(TelemetryIngestAttributionSettings, "isAttributedProject")
        .mockResolvedValue(true);

      const req: TelemetryRequest = await send({
        handler: kind.handler,
        body: kind.body(),
        ...(kind.rawBody !== undefined ? { rawBody: kind.rawBody } : {}),
        charge: countedAt(777),
      });

      expect(kind.queued).toHaveBeenCalledTimes(1);
      expect(req.telemetryIngestBytes).toBe(777);
      // The queued body is the reshaped one.
      expect(Object.keys(req.body as JSONObject)).toEqual([
        kind.name === "Fluent" ? "entries" : "messages",
      ]);
    });

    test(`${kind.name}: with no budget in force, it carries the body as it arrived, measured as the request path measures one`, async () => {
      jest
        .spyOn(TelemetryIngestAttributionSettings, "isAttributedProject")
        .mockResolvedValue(true);

      const req: TelemetryRequest = await send({
        handler: kind.handler,
        body: kind.body(),
        ...(kind.rawBody !== undefined ? { rawBody: kind.rawBody } : {}),
        charge: null,
      });

      expect(req.telemetryIngestBytes).toBe(kind.measured);
      // Not the reshaped body's size, which is more.
      expect(
        Buffer.byteLength(JSON.stringify(req.body), "utf8"),
      ).toBeGreaterThan(kind.measured);
    });
  }
});
