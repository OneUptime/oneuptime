import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import ProbeSyslogIngestService, {
  DEFAULT_SERVICE_NAME,
  ProbeSyslogIngestResult,
} from "../../FeatureSet/Telemetry/Services/ProbeSyslogIngestService";
import LogDropFilterService from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import LogPipelineService from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import Probe from "Common/Models/DatabaseModels/Probe";
import LogService from "Common/Server/Services/LogService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import ProbeService from "Common/Server/Services/ProbeService";
import TelemetryMilestones from "Common/Server/Utils/Activation/TelemetryMilestones";
import NetworkDeviceHydrationUtil from "Common/Server/Utils/Monitor/NetworkDeviceHydrationUtil";
import NetworkFlowDeviceMatcher from "Common/Server/Utils/NetworkFlow/NetworkFlowDeviceMatcher";
import SyslogDeviceMatcher from "Common/Server/Utils/Syslog/SyslogDeviceMatcher";
import TelemetryIngestAttribution, {
  TelemetryIngestAttributionResource,
} from "Common/Server/Utils/Telemetry/TelemetryIngestAttribution";
import TelemetryIngestionBudgetCounter, {
  TelemetryIngestionBudgetCounterDecision,
  TelemetryIngestionBudgetCounterMode,
  TelemetryIngestionBudgetCounterOutcome,
  TelemetryIngestionBudgetCounterRequest,
} from "Common/Server/Utils/Telemetry/TelemetryIngestionBudgetCounter";
import TelemetryIngestionBudgetSettings from "Common/Server/Utils/Telemetry/TelemetryIngestionBudgetSettings";
import { TelemetryIngestionBudgetJobCharge } from "Common/Server/Utils/Telemetry/TelemetryIngestionBudget";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import {
  getEmptyTelemetryIngestionBudgetStoredSettings,
  TELEMETRY_INGESTION_BUDGET_BYTES_PER_GB,
  TelemetryIngestionBudgetScope,
  TelemetryIngestionBudgetStoredSettings,
} from "Common/Types/Telemetry/TelemetryIngestionBudget";

/*
 * THE SYSLOG A PROBE FORWARDS MEETS ITS PROJECT'S BUDGETS (#10716).
 *
 * A probe forwards what a network hears, for the devices of any number of
 * projects, and each line is stored as a log of its device's project. Those
 * logs were billed from the stored rows like any other, but met no budget:
 * a project over its daily logs budget kept storing them, no team's or
 * label's budget counted them, and the usage metrics left them out.
 *
 * Now a batch is decided project by project, before a row is built: each
 * project's share - its devices' lines, at the bytes each device sent -
 * against its daily logs budget, in Drop mode (a probe cannot usefully be
 * refused, and no rate applies), with no ingestion key; then each line is
 * offered to the project's attribution with its device's service, and the
 * attribution is settled once, before the rows are stored.
 *
 * The real ingest, device matcher and budget decision run here; stubbed
 * are the databases (the probe, its devices, the services, the insert),
 * the budget's settings and counter (Valkey), and - where a test says so -
 * the attribution, which TelemetryIngestAttribution's own suites and
 * FluentSyslogTeamBudgetsValkey test against a real Valkey.
 */

type MockedFn = jest.Mock;

const NOW: Date = new Date("2026-11-22T10:00:00.000Z");
const GB: number = TELEMETRY_INGESTION_BUDGET_BYTES_PER_GB;

const PROBE: ObjectID = ObjectID.generate();
const SHOP: ObjectID = ObjectID.generate();
const WAREHOUSE: ObjectID = ObjectID.generate();

const device: (data: {
  projectId: ObjectID;
  name: string;
  hostname: string;
}) => NetworkDevice = (data: {
  projectId: ObjectID;
  name: string;
  hostname: string;
}): NetworkDevice => {
  const value: NetworkDevice = new NetworkDevice(ObjectID.generate());
  value.projectId = data.projectId;
  value.name = data.name;
  value.hostname = data.hostname;
  return value;
};

const SHOP_SWITCH: NetworkDevice = device({
  projectId: SHOP,
  name: "Shop Switch",
  hostname: "10.0.0.2",
});
const SHOP_FIREWALL: NetworkDevice = device({
  projectId: SHOP,
  name: "Shop Firewall",
  hostname: "10.0.0.3",
});
const WAREHOUSE_ROUTER: NetworkDevice = device({
  projectId: WAREHOUSE,
  name: "Warehouse Router",
  hostname: "10.1.0.1",
});

const DEVICES_BY_ADDRESS: Record<string, Array<NetworkDevice>> = {
  "10.0.0.2": [SHOP_SWITCH],
  "10.0.0.3": [SHOP_FIREWALL],
  "10.1.0.1": [WAREHOUSE_ROUTER],
};

// A line as a device sent it, and the JSON the probe posts for it.
const fromProbe: (
  line: string,
  sourceIpAddress: string,
  overrides?: JSONObject,
) => JSONObject = (
  line: string,
  sourceIpAddress: string,
  overrides?: JSONObject,
): JSONObject => {
  return {
    sourceIpAddress: sourceIpAddress,
    facility: 23,
    severity: 3,
    timestamp: NOW.toISOString(),
    message: line.replace(/^<\d+>/, ""),
    receivedAt: NOW.toISOString(),
    raw: line,
    ...(overrides || {}),
  };
};

const SWITCH_LINE: string =
  "<187>1 2026-11-22T09:59:59Z shop-sw1 - - - - Interface Gi0/1 changed state to down";
const FIREWALL_LINE: string =
  "<187>1 2026-11-22T09:59:59Z shop-fw1 - - - - Policy 12 denied 203.0.113.9 ü";
const ROUTER_LINE: string =
  "<187>1 2026-11-22T09:59:59Z wh-rtr1 - - - - BGP neighbor 192.0.2.1 Down";

const bytesOf: (line: string) => number = (line: string): number => {
  return Buffer.byteLength(line, "utf8");
};

// One service id a project and service name, as the services table keeps them.
const serviceIds: Map<string, ObjectID> = new Map();

const serviceIdFor: (projectId: ObjectID, name: string) => ObjectID = (
  projectId: ObjectID,
  name: string,
): ObjectID => {
  const key: string = `${projectId.toString()}:${name}`;

  if (!serviceIds.has(key)) {
    serviceIds.set(key, ObjectID.generate());
  }

  return serviceIds.get(key)!;
};

let insertedRows: Array<JSONObject> = [];
let probeProjectId: ObjectID | null = SHOP;
// Each project's daily logs budget, in bytes, or none.
let budgets: Map<string, number> = new Map();
// What each project's day has used, as the counter keeps it.
let used: Map<string, number> = new Map();
let counted: Array<TelemetryIngestionBudgetCounterRequest> = [];
let steps: Array<string> = [];

const logsBudget: (bytes: number) => TelemetryIngestionBudgetStoredSettings = (
  bytes: number,
): TelemetryIngestionBudgetStoredSettings => {
  const settings: TelemetryIngestionBudgetStoredSettings =
    getEmptyTelemetryIngestionBudgetStoredSettings();
  settings[ProductType.Logs] = {
    dailyBudgetInGB: bytes / GB,
    rateLimitInMBPerSecond: null,
  };
  return settings;
};

const bodiesOf: (projectId: ObjectID) => Array<unknown> = (
  projectId: ObjectID,
): Array<unknown> => {
  return insertedRows
    .filter((row: JSONObject): boolean => {
      return row["projectId"] === projectId.toString();
    })
    .map((row: JSONObject): unknown => {
      return row["body"];
    });
};

const ingest: (
  messages: Array<JSONObject>,
) => Promise<ProbeSyslogIngestResult> = (
  messages: Array<JSONObject>,
): Promise<ProbeSyslogIngestResult> => {
  return ProbeSyslogIngestService.processSyslogMessages(PROBE, messages);
};

beforeEach(() => {
  SyslogDeviceMatcher.clearCaches();
  NetworkFlowDeviceMatcher.clearCaches();
  insertedRows = [];
  probeProjectId = SHOP;
  budgets = new Map();
  used = new Map();
  counted = [];
  steps = [];

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);

  jest.spyOn(ProbeService, "findOneById").mockImplementation((async () => {
    const probe: Probe = new Probe(PROBE);

    if (probeProjectId) {
      probe.projectId = probeProjectId;
    }

    return probe;
  }) as never);
  jest
    .spyOn(NetworkDeviceHydrationUtil, "findDevicesByProbeAndSource")
    .mockImplementation((async (data: { sourceIpAddress: string }) => {
      return DEVICES_BY_ADDRESS[data.sourceIpAddress] || [];
    }) as never);
  jest.spyOn(NetworkDeviceService, "findBy").mockImplementation((async (data: {
    query: { projectId: ObjectID };
  }) => {
    return Object.values(DEVICES_BY_ADDRESS)
      .flat()
      .filter((candidate: NetworkDevice): boolean => {
        return (
          candidate.projectId?.toString() === data.query.projectId.toString()
        );
      });
  }) as never);
  jest
    .spyOn(OTelIngestService, "telemetryServiceFromName")
    .mockImplementation((async (data: {
      serviceName: string;
      projectId: ObjectID;
    }): Promise<TelemetryServiceMetadata> => {
      return {
        serviceName: data.serviceName,
        primaryEntityId: serviceIdFor(data.projectId, data.serviceName),
        primaryEntityType: ServiceType.OpenTelemetry,
        dataRententionInDays: 30,
        serviceRetentionConfig: null,
        serviceRetentionInDays: 30,
        projectRetentionConfig: null,
        projectRetentionInDays: 15,
      };
    }) as never);
  jest.spyOn(LogService, "insertJsonRows").mockImplementation((async (
    rows: Array<JSONObject>,
  ): Promise<void> => {
    steps.push("insert");
    insertedRows.push(...rows);
  }) as never);
  jest.spyOn(TelemetryMilestones, "markInserted").mockImplementation(() => {});
  // No project needs attributing unless a test says so.
  jest
    .spyOn(TelemetryIngestAttribution, "forBatch")
    .mockResolvedValue(null as never);
  jest
    .spyOn(LogPipelineService, "loadPipelines")
    .mockResolvedValue([] as never);
  jest
    .spyOn(LogDropFilterService, "loadDropFilters")
    .mockResolvedValue([] as never);
  jest
    .spyOn(LogScrubRuleService, "loadScrubRules")
    .mockResolvedValue([] as never);

  // The budgets: none in force unless a test sets one; the counter in memory.
  jest
    .spyOn(TelemetryIngestionBudgetSettings, "getInstanceSettings")
    .mockResolvedValue({
      budgets: getEmptyTelemetryIngestionBudgetStoredSettings(),
      warningPercent: 80,
      resetTime: "00:00",
      timezone: "UTC",
    });
  jest
    .spyOn(TelemetryIngestionBudgetSettings, "getProjectOverrides")
    .mockImplementation((async (projectId: ObjectID) => {
      const bytes: number | undefined = budgets.get(projectId.toString());
      return bytes === undefined ? null : logsBudget(bytes);
    }) as never);
  jest
    .spyOn(TelemetryIngestionBudgetCounter, "consume")
    .mockImplementation(
      async (
        request: TelemetryIngestionBudgetCounterRequest,
      ): Promise<TelemetryIngestionBudgetCounterDecision> => {
        steps.push(`count:${request.projectId}`);
        counted.push(request);

        const before: number = used.get(request.projectId) || 0;
        const budget: number = request.scopes[0]!.dailyBudgetBytes || 0;

        if (budget > 0 && before >= budget) {
          return {
            outcome:
              TelemetryIngestionBudgetCounterOutcome.DailyBudgetExhausted,
            scopeIndex: 0,
            isFirstExhaustion: false,
          };
        }

        used.set(request.projectId, before + request.bytes);
        return { outcome: TelemetryIngestionBudgetCounterOutcome.Admitted };
      },
    );
});

afterEach(() => {
  jest.restoreAllMocks();
  SyslogDeviceMatcher.clearCaches();
  NetworkFlowDeviceMatcher.clearCaches();
});

describe("a probe's batch, against its projects' daily logs budgets", () => {
  test("with no budget in force, every line is stored and nothing is counted", async () => {
    const result: ProbeSyslogIngestResult = await ingest([
      fromProbe(SWITCH_LINE, "10.0.0.2"),
      fromProbe(ROUTER_LINE, "10.1.0.1"),
    ]);

    expect(result).toMatchObject({ written: 2, droppedByBudget: 0 });
    expect(counted).toEqual([]);
  });

  test("each project's share is counted once, in Drop mode, with no key, at the bytes its devices sent", async () => {
    budgets.set(SHOP.toString(), GB);
    budgets.set(WAREHOUSE.toString(), GB);

    const result: ProbeSyslogIngestResult = await ingest([
      fromProbe(SWITCH_LINE, "10.0.0.2"),
      fromProbe(ROUTER_LINE, "10.1.0.1"),
      fromProbe(FIREWALL_LINE, "10.0.0.3"),
      fromProbe(SWITCH_LINE, "10.0.0.2"),
    ]);

    expect(result).toMatchObject({ written: 4, droppedByBudget: 0 });
    expect(
      counted.map((request: TelemetryIngestionBudgetCounterRequest) => {
        return {
          projectId: request.projectId,
          mode: request.mode,
          bytes: request.bytes,
          scopes: request.scopes.map((scope: { scope: string }) => {
            return scope.scope;
          }),
          signal: request.signalSlug,
        };
      }),
    ).toEqual([
      {
        projectId: SHOP.toString(),
        mode: TelemetryIngestionBudgetCounterMode.Drop,
        bytes: 2 * bytesOf(SWITCH_LINE) + bytesOf(FIREWALL_LINE),
        // The project's budget alone: no ingestion key sent it.
        scopes: [TelemetryIngestionBudgetScope.Project],
        signal: "logs",
      },
      {
        projectId: WAREHOUSE.toString(),
        mode: TelemetryIngestionBudgetCounterMode.Drop,
        bytes: bytesOf(ROUTER_LINE),
        scopes: [TelemetryIngestionBudgetScope.Project],
        signal: "logs",
      },
    ]);
    // Decided before a row is stored, all of them at once.
    expect(steps).toEqual([
      `count:${SHOP.toString()}`,
      `count:${WAREHOUSE.toString()}`,
      "insert",
    ]);
  });

  test("a project whose budget is used up has its share dropped, and counted as dropped; the rest of the batch is stored", async () => {
    budgets.set(SHOP.toString(), 10);
    budgets.set(WAREHOUSE.toString(), GB);
    used.set(SHOP.toString(), 10);

    const result: ProbeSyslogIngestResult = await ingest([
      fromProbe(SWITCH_LINE, "10.0.0.2"),
      fromProbe(ROUTER_LINE, "10.1.0.1"),
      fromProbe(FIREWALL_LINE, "10.0.0.3"),
    ]);

    expect(result).toMatchObject({
      written: 1,
      droppedByBudget: 2,
      droppedByFilter: 0,
    });
    expect(bodiesOf(SHOP)).toEqual([]);
    expect(bodiesOf(WAREHOUSE)).toEqual([
      ROUTER_LINE.replace(/^.* - - - - /, ""),
    ]);
    // What the counter was told it refused: the project's share, exactly.
    expect(counted[0]).toMatchObject({
      projectId: SHOP.toString(),
      mode: TelemetryIngestionBudgetCounterMode.Drop,
      bytes: bytesOf(SWITCH_LINE) + bytesOf(FIREWALL_LINE),
    });
  });

  test("a line from no device, kept for the probe's project, counts against that project", async () => {
    budgets.set(SHOP.toString(), GB);

    const stranger: string =
      "<187>1 2026-11-22T09:59:59Z unknown-sw - - - - Interface Gi0/9 changed state to down";
    const result: ProbeSyslogIngestResult = await ingest([
      fromProbe(stranger, "203.0.113.77"),
    ]);

    expect(result).toMatchObject({ written: 1, keptUnmatched: 1 });
    expect(counted).toHaveLength(1);
    expect(counted[0]).toMatchObject({
      projectId: SHOP.toString(),
      bytes: bytesOf(stranger),
    });
  });

  test("what is never kept - malformed, or from no device on a global probe - counts nothing", async () => {
    probeProjectId = null;
    budgets.set(SHOP.toString(), GB);

    const result: ProbeSyslogIngestResult = await ingest([
      { sourceIpAddress: "10.0.0.2" },
      fromProbe(SWITCH_LINE, "203.0.113.77"),
    ]);

    expect(result).toMatchObject({
      written: 0,
      malformed: 1,
      droppedUnmatched: 1,
    });
    expect(counted).toEqual([]);
  });

  test("a message from a probe older than raw counts at its text", () => {
    expect(
      ProbeSyslogIngestService.getCountedBytes({
        sourceIpAddress: "10.0.0.2",
        facility: 1,
        severity: 5,
        timestamp: NOW,
        receivedAt: NOW,
        message: "Interface Gi0/1 changed state to down ü",
      }),
    ).toBe(bytesOf("Interface Gi0/1 changed state to down ü"));
    expect(
      ProbeSyslogIngestService.getCountedBytes({
        sourceIpAddress: "10.0.0.2",
        facility: 1,
        severity: 5,
        timestamp: NOW,
        receivedAt: NOW,
        message: "short",
        raw: SWITCH_LINE,
      }),
    ).toBe(bytesOf(SWITCH_LINE));
  });
});

interface Offer {
  projectId: string;
  resource: TelemetryIngestAttributionResource;
}

describe("a probe's batch, against its teams' and labels' budgets and the usage metrics", () => {
  let offers: Array<Offer> = [];
  let forBatch: Array<{
    projectId: string;
    bytes: number | null;
    gateCharge: TelemetryIngestionBudgetJobCharge | null | undefined;
  }> = [];
  // The services whose team's budget is used up, by name.
  let usedUpServices: Set<string> = new Set();

  beforeEach(() => {
    offers = [];
    forBatch = [];
    usedUpServices = new Set();

    jest
      .spyOn(TelemetryIngestAttribution, "forBatch")
      .mockImplementation((async (data: {
        projectId: ObjectID | string;
        bytes: number | null;
        gateCharge?: TelemetryIngestionBudgetJobCharge | null | undefined;
      }) => {
        const projectId: string = data.projectId.toString();

        forBatch.push({
          projectId: projectId,
          bytes: data.bytes,
          gateCharge: data.gateCharge,
        });

        return {
          admitResource: async (
            resource: TelemetryIngestAttributionResource,
          ): Promise<boolean> => {
            offers.push({ projectId, resource });
            return !usedUpServices.has(resource.name);
          },
          settle: async (): Promise<void> => {
            steps.push(`settle:${projectId}`);
          },
        } as unknown as TelemetryIngestAttribution;
      }) as never);
  });

  test("each project's attribution is asked for at its share, and offered each line with its device's service, one record each", async () => {
    budgets.set(SHOP.toString(), GB);

    await ingest([
      fromProbe(SWITCH_LINE, "10.0.0.2"),
      fromProbe(ROUTER_LINE, "10.1.0.1"),
      fromProbe(FIREWALL_LINE, "10.0.0.3"),
      fromProbe(SWITCH_LINE, "10.0.0.2"),
    ]);

    expect(
      forBatch.map((batch: { projectId: string; bytes: number | null }) => {
        return { projectId: batch.projectId, bytes: batch.bytes };
      }),
    ).toEqual([
      {
        projectId: SHOP.toString(),
        bytes: 2 * bytesOf(SWITCH_LINE) + bytesOf(FIREWALL_LINE),
      },
      { projectId: WAREHOUSE.toString(), bytes: bytesOf(ROUTER_LINE) },
    ]);

    // What the shop's budget counted rides along, for what a team drops to be taken back off it.
    expect(forBatch[0]!.gateCharge).toMatchObject({
      countedBytes: 2 * bytesOf(SWITCH_LINE) + bytesOf(FIREWALL_LINE),
      isExact: true,
      scopes: [
        expect.objectContaining({
          scope: TelemetryIngestionBudgetScope.Project,
          scopeId: SHOP.toString(),
        }),
      ],
    });
    // No budget for the warehouse: nothing was counted to take back.
    expect(forBatch[1]!.gateCharge).toBeNull();

    expect(
      offers.map((offer: Offer) => {
        return [offer.projectId, offer.resource.name, offer.resource.records];
      }),
    ).toEqual([
      [SHOP.toString(), "Shop Switch", 1],
      [WAREHOUSE.toString(), "Warehouse Router", 1],
      [SHOP.toString(), "Shop Firewall", 1],
      [SHOP.toString(), "Shop Switch", 1],
    ]);

    // Each offered under the service its log is filed under.
    for (const offer of offers) {
      const row: JSONObject | undefined = insertedRows.find(
        (candidate: JSONObject): boolean => {
          return (
            candidate["primaryEntityId"] ===
            offer.resource.primaryEntityId.toString()
          );
        },
      );

      expect({ name: offer.resource.name, filed: Boolean(row) }).toEqual({
        name: offer.resource.name,
        filed: true,
      });
    }
  });

  test("a device's lines whose team's budget is used up are dropped; the rest of its project's are stored", async () => {
    usedUpServices = new Set(["Shop Switch"]);

    const result: ProbeSyslogIngestResult = await ingest([
      fromProbe(SWITCH_LINE, "10.0.0.2"),
      fromProbe(FIREWALL_LINE, "10.0.0.3"),
      fromProbe(ROUTER_LINE, "10.1.0.1"),
    ]);

    expect(result).toMatchObject({ written: 2, droppedByBudget: 1 });
    expect(bodiesOf(WAREHOUSE)).toEqual([
      ROUTER_LINE.replace(/^.* - - - - /, ""),
    ]);
    expect(bodiesOf(SHOP)).toEqual([FIREWALL_LINE.replace(/^.* - - - - /, "")]);
  });

  test("every project's attribution is settled once, before the batch's rows are stored", async () => {
    await ingest([
      fromProbe(SWITCH_LINE, "10.0.0.2"),
      fromProbe(ROUTER_LINE, "10.1.0.1"),
    ]);

    expect(steps).toEqual([
      `settle:${SHOP.toString()}`,
      `settle:${WAREHOUSE.toString()}`,
      "insert",
    ]);
  });

  test("a project whose daily budget is used up is not attributed: its share is dropped before", async () => {
    budgets.set(SHOP.toString(), 10);
    used.set(SHOP.toString(), 10);

    await ingest([
      fromProbe(SWITCH_LINE, "10.0.0.2"),
      fromProbe(ROUTER_LINE, "10.1.0.1"),
    ]);

    expect(
      forBatch.map((batch: { projectId: string }) => {
        return batch.projectId;
      }),
    ).toEqual([WAREHOUSE.toString()]);
    expect(
      offers.map((offer: Offer) => {
        return offer.resource.name;
      }),
    ).toEqual(["Warehouse Router"]);
  });

  test("a line from no device is offered under the shared service of its project", async () => {
    await ingest([
      fromProbe(
        "<187>1 2026-11-22T09:59:59Z unknown-sw - - - - Interface Gi0/9 changed state to down",
        "203.0.113.77",
      ),
    ]);

    expect(
      offers.map((offer: Offer) => {
        return [offer.projectId, offer.resource.name];
      }),
    ).toEqual([[SHOP.toString(), DEFAULT_SERVICE_NAME]]);
  });
});
