import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import DataStore from "../../../../../Models/DatabaseModels/DataStore";
import RumApplication from "../../../../../Models/DatabaseModels/RumApplication";
import Service from "../../../../../Models/DatabaseModels/Service";
import Queue from "../../../../../Server/Infrastructure/Queue";
import AIService, {
  AILogRequest,
} from "../../../../../Server/Services/AIService";
import AnalyticsDatabaseService, {
  Results,
} from "../../../../../Server/Services/AnalyticsDatabaseService";
import DataStoreFindingService from "../../../../../Server/Services/DataStoreFindingService";
import DataStoreService from "../../../../../Server/Services/DataStoreService";
import RumApplicationService from "../../../../../Server/Services/RumApplicationService";
import ServiceService from "../../../../../Server/Services/ServiceService";
import DataSecurityFieldSuggestion from "../../../../../Server/Utils/AI/DataSecurity/FieldSuggestion";
import { Statement } from "../../../../../Server/Utils/AnalyticsDatabase/Statement";
import DataSecurityRunner from "../../../../../Server/Utils/DataSecurity/DataSecurityRunner";
import {
  ContentScanOptions,
  DataStoreLocationKind,
} from "../../../../../Server/Utils/DataSecurity/DataSecurityScanTypes";
import { withPendingFields } from "../../../../../Server/Utils/DataSecurity/FieldSuggestionState";
import {
  scanProjectTelemetry,
  shareUnplacedAttributesByOwner,
  TelemetrySampleSource,
  TelemetryStoreScan,
} from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryDataScanner";
import {
  CONVENTION_ATTRIBUTE_NAMESPACES,
  describeUnplacedAttribute,
  getTelemetryAttributeKey,
  isConventionAttributeKey,
  MAX_UNPLACED_ATTRIBUTES_PER_SERVICE,
  shareUnplacedAttributes,
} from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryUnplacedAttributes";
import LlmConversationPrivacy from "../../../../../Server/Utils/LlmObservability/LlmConversationPrivacy";
import logger from "../../../../../Server/Utils/Logger";
import { DataStoreKind } from "../../../../../Types/DataSecurity/DataStoreKind";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  compileShadowDetectors,
  getShadowStoreKey,
  ShadowScanDetector,
} from "../../../../../Utils/DataSecurity/ShadowCount";
import { UnplacedField } from "../../../../../Utils/DataSecurity/UnplacedFields";

/*
 * The attributes a telemetry scan could not place (#10371): kept as a
 * content scan keeps the columns it could not place - by name and shape,
 * never a value - at most MAX_UNPLACED_ATTRIBUTES_PER_SERVICE of a service
 * a scan, shared across its stores, never OneUptime's keys, OpenTelemetry's
 * conventions or free text; and asked about by OneUptime AI as a column is.
 * The ClickHouse reads are stand-ins, answered by source.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-0000000d7001",
);
const CHECKOUT: string = "0192f1a0-0000-7000-8000-0000000da101";
const BILLING: string = "0192f1a0-0000-7000-8000-0000000da102";

type SourceRows = Partial<Record<TelemetrySampleSource, Array<JSONObject>>>;

let ownerRows: SourceRows = {};
let sampleRows: SourceRows = {};

function answer(rows: Array<JSONObject>): Results {
  return {
    json: (): Promise<unknown> => {
      return Promise.resolve({ data: rows });
    },
  } as unknown as Results;
}

function sourceOf(statement: Statement): TelemetrySampleSource | null {
  const query: string = statement.query;

  if (query.includes("MetricItemV3") || query.includes("MetricItemAggMV1m")) {
    return TelemetrySampleSource.Metrics;
  }

  if (
    query.includes("RumSessionV1") ||
    Object.values(statement.query_params).includes("RealUserMonitor")
  ) {
    return null;
  }

  if (query.includes("LogItemV3")) {
    return TelemetrySampleSource.Logs;
  }

  if (query.includes("ExceptionItemV3")) {
    return TelemetrySampleSource.Exceptions;
  }

  return query.includes("isLlmSpan = 1")
    ? TelemetrySampleSource.AiConversations
    : TelemetrySampleSource.Traces;
}

function policyNumbers(count: number, seed: number): Array<string> {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    return `PL-${String(1000000 + seed * 1000 + index * 37)}`;
  });
}

// Spans whose policy_ref holds policy numbers, beside OpenTelemetry's and OneUptime's keys.
function spans(owner: string, count: number): Array<JSONObject> {
  return policyNumbers(count, 1).map((policy: string, index: number) => {
    return {
      ownerId: owner,
      readAttributes: [
        ["policy_ref", policy],
        ["http.route", `/api/v1/policies/${index}`],
        ["resource.k8s.pod.name", `checkout-7d9f8b-${index}x2lp`],
        ["oneuptime.service.id", owner],
        ["claim.note", `Customer called about the renewal ${"x".repeat(90)}`],
      ],
      readEvents: [],
    };
  });
}

function options(
  overrides: Partial<ContentScanOptions> = {},
): ContentScanOptions {
  return {
    limits: {
      maxObjects: 2000,
      maxBytesPerObject: 65536,
      maxBytesTotal: 52428800,
      maxRowsPerTable: 1000,
      maxTables: 200,
      deadline: new Date(Date.now() + 60 * 60 * 1000),
    },
    customDetectors: [],
    extraHints: [],
    disabledDataTypeIds: new Set(),
    allowedValues: new Set(),
    exclusions: [],
    fingerprintKey: "test-key",
    ...overrides,
  };
}

async function scan(
  shadowDetectorsByStore?: Map<string, Array<ShadowScanDetector>>,
): Promise<Array<TelemetryStoreScan>> {
  return await scanProjectTelemetry({
    projectId: PROJECT_ID,
    sampleSize: 100,
    since: new Date(Date.now() - 60 * 60 * 1000),
    options: options(),
    shadowDetectorsByStore,
  });
}

function storeOf(
  scans: Array<TelemetryStoreScan>,
  kind: DataStoreKind,
  owner: string = CHECKOUT,
): TelemetryStoreScan {
  const found: TelemetryStoreScan | undefined = scans.find(
    (item: TelemetryStoreScan): boolean => {
      return item.kind === kind && item.serviceId === owner;
    },
  );

  expect(found).toBeDefined();

  return found!;
}

function locationsOf(fields: Array<UnplacedField> | undefined): Array<string> {
  return (fields || []).map((field: UnplacedField): string => {
    return field.location;
  });
}

function unplaced(location: string, valueCount: number): UnplacedField {
  return {
    location,
    locationKind: DataStoreLocationKind.Attribute,
    neighbours: [],
    shapes: [{ shape: "AA-9999999", share: 1 }],
    valueCount,
    averageLength: 10,
  };
}

beforeEach(() => {
  ownerRows = {
    [TelemetrySampleSource.Traces]: [{ ownerId: CHECKOUT, records: "40" }],
  };
  sampleRows = {
    [TelemetrySampleSource.Traces]: spans(CHECKOUT, 20),
  };

  jest
    .spyOn(AnalyticsDatabaseService.prototype, "executeQuery")
    .mockImplementation((async (statement: Statement): Promise<Results> => {
      const source: TelemetrySampleSource | null = sourceOf(statement);

      if (!source || statement.query.includes(" AS newestMinutePoints, ")) {
        return answer([]);
      }

      const rows: SourceRows = statement.query.includes(" AS records FROM ")
        ? ownerRows
        : sampleRows;

      return answer(rows[source] || []);
    }) as never);
  jest
    .spyOn(LlmConversationPrivacy, "getRestrictedServiceIds")
    .mockResolvedValue([]);
  jest.spyOn(logger, "warn").mockImplementation((): void => {});

  const checkout: Service = new Service();
  checkout._id = CHECKOUT;
  checkout.name = "checkout";
  const billing: Service = new Service();
  billing._id = BILLING;
  billing.name = "billing";
  jest
    .spyOn(ServiceService, "findBy")
    .mockResolvedValue([checkout, billing] as never);
  jest
    .spyOn(RumApplicationService, "findBy")
    .mockResolvedValue([] as Array<RumApplication> as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("which attributes are kept", () => {
  test("an attribute's key is read from every place a telemetry scan names one", () => {
    expect(getTelemetryAttributeKey("attributes.policy_ref")).toBe(
      "policy_ref",
    );
    expect(getTelemetryAttributeKey("attributes.resource.k8s.pod.name")).toBe(
      "k8s.pod.name",
    );
    expect(getTelemetryAttributeKey("events.checkout.policy_ref")).toBe(
      "policy_ref",
    );
    expect(getTelemetryAttributeKey("spans.attributes.member_no")).toBe(
      "member_no",
    );
    expect(
      getTelemetryAttributeKey("sessions.identifiedUserTraits.member_no"),
    ).toBe("member_no");
    expect(getTelemetryAttributeKey("body")).toBeNull();
  });

  test("OneUptime's own keys and OpenTelemetry's conventions are never kept", () => {
    for (const key of [
      "oneuptime.service.id",
      "service.name",
      "k8s.pod.name",
      "host.name",
      "process.pid",
      "telemetry.sdk.language",
      "http.route",
      "db.statement",
      "exception.type",
      "gen_ai.request.model",
    ]) {
      expect({ key, skipped: isConventionAttributeKey(key) }).toEqual({
        key,
        skipped: true,
      });
    }

    for (const key of ["policy_ref", "app.customer.number", "enduser.id"]) {
      expect({ key, skipped: isConventionAttributeKey(key) }).toEqual({
        key,
        skipped: false,
      });
    }

    expect(CONVENTION_ATTRIBUTE_NAMESPACES).toContain("oneuptime");
  });

  test("free text, a body, a message and a metric's name are never kept", () => {
    expect(
      describeUnplacedAttribute({
        location: "attributes.claim.note",
        locationKind: DataStoreLocationKind.Attribute,
        values: Array.from({ length: 10 }, () => {
          return `Customer called about the renewal ${"x".repeat(90)}`;
        }),
        neighbours: [],
      }),
    ).toBeNull();

    for (const location of ["body", "message", "stackTrace", "name"]) {
      expect(
        describeUnplacedAttribute({
          location,
          locationKind:
            location === "name"
              ? DataStoreLocationKind.Field
              : DataStoreLocationKind.Body,
          values: policyNumbers(10, 2),
          neighbours: [],
        }),
      ).toBeNull();
    }
  });

  test("an attribute of the company's own is described as a column would be", () => {
    const field: UnplacedField | null = describeUnplacedAttribute({
      location: "attributes.policy_ref",
      locationKind: DataStoreLocationKind.Attribute,
      values: policyNumbers(10, 3),
      neighbours: ["attributes.policy_ref", "attributes.claim.state"],
    });

    expect(field).toMatchObject({
      location: "attributes.policy_ref",
      locationKind: DataStoreLocationKind.Attribute,
      neighbours: ["claim.state"],
      shapes: [{ shape: "AA-9999999", share: 1 }],
      valueCount: 10,
    });
    // A session's user label is kept as a field: it has no key of its own.
    expect(
      describeUnplacedAttribute({
        location: "sessions.identifiedUserLabel",
        locationKind: DataStoreLocationKind.Field,
        values: policyNumbers(10, 4),
        neighbours: [],
      }),
    ).not.toBeNull();
  });
});

describe(`at most ${MAX_UNPLACED_ATTRIBUTES_PER_SERVICE} of a service a scan, shared across its stores`, () => {
  test("given out in turn, the attributes with the most values first in each store", () => {
    const logs: Array<UnplacedField> = Array.from(
      { length: 40 },
      (_value: unknown, index: number): UnplacedField => {
        return unplaced(`attributes.log_${index}`, index + 1);
      },
    );
    const traces: Array<UnplacedField> = Array.from(
      { length: 40 },
      (_value: unknown, index: number): UnplacedField => {
        return unplaced(`attributes.span_${index}`, index + 1);
      },
    );
    const shared: Array<Array<UnplacedField>> = shareUnplacedAttributes([
      logs,
      traces,
    ]);

    expect(shared[0]).toHaveLength(25);
    expect(shared[1]).toHaveLength(25);
    expect(shared[0]![0]!.location).toBe("attributes.log_39");
    expect(shared[1]![24]!.location).toBe("attributes.span_15");
  });

  test("a store with few gives the rest of the share to the others", () => {
    const shared: Array<Array<UnplacedField>> = shareUnplacedAttributes([
      [unplaced("attributes.a", 5)],
      Array.from({ length: 80 }, (_value: unknown, index: number) => {
        return unplaced(`attributes.b_${index}`, 5);
      }),
    ]);

    expect(shared[0]).toHaveLength(1);
    expect(shared[1]).toHaveLength(MAX_UNPLACED_ATTRIBUTES_PER_SERVICE - 1);
  });

  test("each service has its own share", () => {
    const many: () => Array<UnplacedField> = (): Array<UnplacedField> => {
      return Array.from({ length: 60 }, (_value: unknown, index: number) => {
        return unplaced(`attributes.k_${index}`, 5);
      });
    };
    const scans: Array<TelemetryStoreScan> = [
      {
        serviceId: CHECKOUT,
        kind: DataStoreKind.TelemetryTraces,
        result: { unplacedFields: many() } as never,
      },
      {
        serviceId: CHECKOUT,
        kind: DataStoreKind.TelemetryLogs,
        result: { unplacedFields: many() } as never,
      },
      {
        serviceId: BILLING,
        kind: DataStoreKind.TelemetryTraces,
        result: { unplacedFields: many() } as never,
      },
    ];

    shareUnplacedAttributesByOwner(scans);

    expect(
      scans[0]!.result.unplacedFields!.length +
        scans[1]!.result.unplacedFields!.length,
    ).toBe(MAX_UNPLACED_ATTRIBUTES_PER_SERVICE);
    expect(scans[2]!.result.unplacedFields).toHaveLength(
      MAX_UNPLACED_ATTRIBUTES_PER_SERVICE,
    );
  });
});

describe("a telemetry scan", () => {
  test("keeps a span attribute no detector placed, and none of the conventions' keys or free text", async () => {
    const traces: TelemetryStoreScan = storeOf(
      await scan(),
      DataStoreKind.TelemetryTraces,
    );

    expect(locationsOf(traces.result.unplacedFields)).toEqual([
      "attributes.policy_ref",
    ]);
    expect(traces.result.unplacedFields![0]).toMatchObject({
      locationKind: DataStoreLocationKind.Attribute,
      shapes: [{ shape: "AA-9999999", share: 1 }],
      valueCount: 20,
    });
    // Names and shapes, never a value.
    expect(JSON.stringify(traces.result.unplacedFields)).not.toContain(
      policyNumbers(1, 1)[0],
    );
  });

  test(`keeps at most ${MAX_UNPLACED_ATTRIBUTES_PER_SERVICE} of a service's attributes`, async () => {
    sampleRows = {
      [TelemetrySampleSource.Traces]: [
        {
          ownerId: CHECKOUT,
          readAttributes: Array.from(
            { length: 70 },
            (_value: unknown, index: number): [string, string] => {
              return [`app.ref_${index}`, "PL-1234567"];
            },
          ),
          readEvents: [],
        },
      ].flatMap((row: JSONObject) => {
        return Array.from({ length: 6 }, () => {
          return row;
        });
      }),
    };

    const traces: TelemetryStoreScan = storeOf(
      await scan(),
      DataStoreKind.TelemetryTraces,
    );

    expect(traces.result.unplacedFields).toHaveLength(
      MAX_UNPLACED_ATTRIBUTES_PER_SERVICE,
    );
  });

  test("counts a draft being proven in shadow on the store it runs on, and makes no finding of it", async () => {
    const detectors: Array<ShadowScanDetector> = compileShadowDetectors([
      {
        key: "proposal-1:AsDrafted",
        definition: { pattern: "\\b[A-Z]{2}-?\\d{7}\\b" },
      },
    ]);
    const scans: Array<TelemetryStoreScan> = await scan(
      new Map([
        [getShadowStoreKey(DataStoreKind.TelemetryTraces, CHECKOUT), detectors],
      ]),
    );
    const traces: TelemetryStoreScan = storeOf(
      scans,
      DataStoreKind.TelemetryTraces,
    );

    expect(traces.result.shadowCounts!["proposal-1:AsDrafted"]).toMatchObject({
      matched: 20,
      matchedFields: {
        "attributes.policy_ref": { values: 20, matched: 20 },
      },
    });
    // No finding of it, and policy_ref is still a field no detector placed.
    expect(
      traces.result.locations.some((location: { location: string }) => {
        return location.location === "attributes.policy_ref";
      }),
    ).toBe(false);
    expect(locationsOf(traces.result.unplacedFields)).toEqual([
      "attributes.policy_ref",
    ]);
  });
});

describe("a span attribute is asked about, as a column is", () => {
  test("OneUptime AI is asked what attributes.policy_ref holds, by its name and shapes", async () => {
    const traces: TelemetryStoreScan = storeOf(
      await scan(),
      DataStoreKind.TelemetryTraces,
    );
    const storeId: ObjectID = ObjectID.generate();
    const store: DataStore = new DataStore(storeId);

    store.projectId = PROJECT_ID;
    store.kind = DataStoreKind.TelemetryTraces;
    store.isArchived = false;
    store.fieldSuggestionState = withPendingFields({
      previous: null,
      pending: traces.result.unplacedFields || [],
      scannedAt: new Date(),
    });

    jest
      .spyOn(DataStoreService, "findOneById")
      .mockResolvedValue(store as never);
    jest
      .spyOn(DataStoreService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(DataStoreFindingService, "findBy")
      .mockResolvedValue([] as never);
    jest.spyOn(AIService, "isProjectAIEnabled").mockResolvedValue(true);
    jest.spyOn(DataSecurityRunner, "getScanSetup").mockResolvedValue({
      setting: { disabledDataTypeIds: [] },
      options: {},
      customTypes: new Map(),
    } as never);
    jest.spyOn(Queue, "addJob").mockResolvedValue(undefined as never);
    jest.spyOn(logger, "info").mockImplementation((): void => {});

    const execute: jest.SpiedFunction<typeof AIService.executeWithLogging> =
      jest
        .spyOn(AIService, "executeWithLogging")
        .mockResolvedValue({ content: '{"fields":[]}' } as never);

    await DataSecurityFieldSuggestion.suggestForStore({
      projectId: PROJECT_ID,
      dataStoreId: storeId,
    });

    expect(execute).toHaveBeenCalledTimes(1);

    const request: AILogRequest = execute.mock.calls[0]![0] as AILogRequest;
    const data: JSONObject = JSON.parse(
      request.messages[1]!.content as string,
    ) as JSONObject;

    expect(data["store"]).toBe(DataStoreKind.TelemetryTraces);
    expect(data["fields"]).toEqual([
      expect.objectContaining({
        location: "attributes.policy_ref",
        kind: DataStoreLocationKind.Attribute,
        shapes: [["AA-9999999", 1]],
      }),
    ]);
    expect(JSON.stringify(request.messages)).not.toContain("PL-1");
  });
});
