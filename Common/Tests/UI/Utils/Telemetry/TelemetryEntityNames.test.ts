import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * A telemetry row's primaryEntityId is polymorphic: it can be a Service,
 * a RUM application, a host, a cluster, an incident, … Every viewer used
 * to resolve it against the Service table only, so a RUM application's
 * metrics page showed "Service: 84858d6c-…" as its locked filter. The
 * resolver under test is the single place that knows every table an id
 * can live in and how to label it, so these tests pin the registry, the
 * query plan (Service first, then fan out), hints, restrictions, failure
 * isolation, caching (hits, short-lived misses, expired hits refreshed
 * from their own table), non-UUID input and in-flight dedup.
 */

const getListMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrapper is load bearing: jest.mock is hoisted above the
 * compiled requires, so getListMock is still unassigned when the factory
 * runs.
 */
jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});

import TelemetryEntityNameResolver, {
  DEFAULT_TELEMETRY_ENTITY_LABEL,
  getTelemetryEntityDisplay,
  getTelemetryEntityTypeLabel,
  MISS_CACHE_TTL_IN_MS,
  ResolvedTelemetryEntity,
  TELEMETRY_ENTITY_RESOLUTION_ORDER,
  TELEMETRY_ENTITY_TYPES,
  TelemetryEntityNameMap,
} from "../../../../UI/Utils/Telemetry/TelemetryEntityNames";
import { UNKNOWN_SERVICE_NAME } from "../../../../UI/Utils/TelemetryService";
import Alert from "../../../../Models/DatabaseModels/Alert";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Host from "../../../../Models/DatabaseModels/Host";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IoTFleet from "../../../../Models/DatabaseModels/IoTFleet";
import RumApplication from "../../../../Models/DatabaseModels/RumApplication";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import Service from "../../../../Models/DatabaseModels/Service";
import Includes from "../../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../../Types/ObjectID";
import ServiceType from "../../../../Types/Telemetry/ServiceType";

const PROJECT_ID: string = "9e1b6b0e-0000-4000-8000-000000000001";
const SERVICE_ID: string = "11111111-0000-4000-8000-000000000001";
const SERVICE_ID_2: string = "11111111-0000-4000-8000-000000000002";
const RUM_ID: string = "22222222-0000-4000-8000-000000000001";
const HOST_ID: string = "33333333-0000-4000-8000-000000000001";
const CLUSTER_ID: string = "44444444-0000-4000-8000-000000000001";
const INCIDENT_ID: string = "55555555-0000-4000-8000-000000000001";
const MISSING_ID: string = "99999999-0000-4000-8000-000000000001";

type ModelType = { new (): BaseModel };

interface FakeRow {
  id: ObjectID;
  [field: string]: unknown;
}

interface GetListArgs {
  modelType: ModelType;
  query: { projectId: ObjectID; _id: Includes };
  limit: number;
  skip: number;
  select: Record<string, boolean>;
  sort: Record<string, unknown>;
}

interface IssuedRequest {
  entityType: ServiceType;
  ids: Array<string>;
}

// Rows each fake table holds, keyed by the entity type that owns the table.
let tables: Partial<Record<ServiceType, Array<FakeRow>>> = {};
// Tables whose getList rejects (e.g. the role cannot read that model).
let failingTypes: Set<ServiceType> = new Set();

const row: (id: string, fields: Record<string, unknown>) => FakeRow = (
  id: string,
  fields: Record<string, unknown>,
): FakeRow => {
  return { id: new ObjectID(id), ...fields };
};

const entityTypeForModel: (modelType: ModelType) => ServiceType = (
  modelType: ModelType,
): ServiceType => {
  const match: [string, { modelType?: ModelType | undefined }] | undefined =
    Object.entries(TELEMETRY_ENTITY_TYPES).find(
      (entry: [string, { modelType?: ModelType | undefined }]): boolean => {
        return entry[1].modelType === modelType;
      },
    );
  if (!match) {
    throw new Error(`Unexpected model queried: ${modelType.name}`);
  }
  return match[0] as ServiceType;
};

const includedIds: (includes: Includes) => Array<string> = (
  includes: Includes,
): Array<string> => {
  return (includes.values as Array<string | ObjectID>).map(
    (value: string | ObjectID): string => {
      return value.toString();
    },
  );
};

const argsOf: (callIndex: number) => GetListArgs = (
  callIndex: number,
): GetListArgs => {
  return getListMock.mock.calls[callIndex]![0] as GetListArgs;
};

const issuedRequests: () => Array<IssuedRequest> = (): Array<IssuedRequest> => {
  return getListMock.mock.calls.map((call: Array<unknown>): IssuedRequest => {
    const args: GetListArgs = call[0] as GetListArgs;
    return {
      entityType: entityTypeForModel(args.modelType),
      ids: includedIds(args.query._id),
    };
  });
};

const requestedTypes: () => Array<ServiceType> = (): Array<ServiceType> => {
  return issuedRequests().map((request: IssuedRequest): ServiceType => {
    return request.entityType;
  });
};

const fakeGetList: (
  args: GetListArgs,
) => Promise<{ data: Array<FakeRow> }> = async (
  args: GetListArgs,
): Promise<{ data: Array<FakeRow> }> => {
  const entityType: ServiceType = entityTypeForModel(args.modelType);
  if (failingTypes.has(entityType)) {
    throw new Error(`403: cannot read ${entityType}`);
  }
  const ids: Array<string> = includedIds(args.query._id);
  return {
    data: (tables[entityType] || []).filter((item: FakeRow): boolean => {
      return ids.includes(item.id.toString());
    }),
  };
};

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

const deferred: <T>() => Deferred<T> = <T>(): Deferred<T> => {
  let resolve: (value: T) => void = (): void => {};
  const promise: Promise<T> = new Promise<T>((res: (value: T) => void) => {
    resolve = res;
  });
  return { promise, resolve };
};

const flushPromises: () => Promise<void> = async (): Promise<void> => {
  for (let i: number = 0; i < 10; i++) {
    await Promise.resolve();
  }
};

// Hit TTL of the resolver's positive cache (not exported by the module).
const HIT_CACHE_TTL_IN_MS: number = 60 * 1000;
const START_TIME: number = 1_800_000_000_000;

/*
 * Named structurally: jest.spyOn from @jest/globals returns jest-mock's
 * SpyInstance, which does not assign to the global jest.SpiedFunction.
 */
interface NowSpy {
  mockReturnValue: (value: number) => unknown;
}

// Freeze Date.now at `at`; move the clock with the returned spy.
const freezeNow: (at: number) => NowSpy = (at: number): NowSpy => {
  return jest.spyOn(Date, "now").mockReturnValue(at) as unknown as NowSpy;
};

const missCacheKeys: () => Array<string> = (): Array<string> => {
  return Object.keys(
    (
      TelemetryEntityNameResolver as unknown as {
        missCache: Record<string, number>;
      }
    ).missCache,
  );
};

const requestsFor: (entityType: ServiceType) => Array<IssuedRequest> = (
  entityType: ServiceType,
): Array<IssuedRequest> => {
  return issuedRequests().filter((request: IssuedRequest): boolean => {
    return request.entityType === entityType;
  });
};

beforeEach(() => {
  TelemetryEntityNameResolver.clearCache();
  getListMock.mockReset();
  tables = {
    [ServiceType.OpenTelemetry]: [
      row(SERVICE_ID, { name: "checkout-api" }),
      row(SERVICE_ID_2, { name: "payments-api" }),
    ],
    [ServiceType.RealUserMonitor]: [row(RUM_ID, { name: "checkout-web" })],
    [ServiceType.Host]: [row(HOST_ID, { name: "prod-db-1" })],
    [ServiceType.KubernetesCluster]: [
      row(CLUSTER_ID, { name: "prod-eu-west" }),
    ],
    [ServiceType.Incident]: [row(INCIDENT_ID, { title: "API is down" })],
  };
  failingTypes = new Set();
  getListMock.mockImplementation((...args: Array<unknown>) => {
    return fakeGetList(args[0] as GetListArgs);
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("TELEMETRY_ENTITY_TYPES registry", () => {
  const allServiceTypes: Array<ServiceType> = Object.values(
    ServiceType,
  ) as Array<ServiceType>;

  test("has an entry for every ServiceType", () => {
    expect(Object.keys(TELEMETRY_ENTITY_TYPES).sort()).toEqual(
      [...allServiceTypes].sort(),
    );
  });

  test.each(allServiceTypes)(
    "%s has a non-empty label",
    (type: ServiceType) => {
      expect(TELEMETRY_ENTITY_TYPES[type].label.trim().length).toBeGreaterThan(
        0,
      );
    },
  );

  test.each(
    allServiceTypes.filter((type: ServiceType): boolean => {
      return type !== ServiceType.Unknown;
    }),
  )(
    "%s has a modelType and name fields that are real columns on it",
    (type: ServiceType) => {
      const config: (typeof TELEMETRY_ENTITY_TYPES)[ServiceType] =
        TELEMETRY_ENTITY_TYPES[type];
      expect(config.modelType).toBeDefined();
      expect(config.nameFields.length).toBeGreaterThan(0);
      const model: BaseModel = new config.modelType!();
      for (const field of config.nameFields) {
        expect({ type, field, isColumn: model.isTableColumn(field) }).toEqual({
          type,
          field,
          isColumn: true,
        });
      }
    },
  );

  test("Unknown has no table and no name fields (its id is the projectId)", () => {
    expect(TELEMETRY_ENTITY_TYPES[ServiceType.Unknown].modelType).toBe(
      undefined,
    );
    expect(TELEMETRY_ENTITY_TYPES[ServiceType.Unknown].nameFields).toEqual([]);
    expect(TELEMETRY_ENTITY_TYPES[ServiceType.Unknown].label).toBe("Service");
  });

  test("maps the core entity types to the expected models and labels", () => {
    expect(TELEMETRY_ENTITY_TYPES[ServiceType.OpenTelemetry]).toMatchObject({
      label: "Service",
      modelType: Service,
      nameFields: ["name"],
    });
    expect(TELEMETRY_ENTITY_TYPES[ServiceType.RealUserMonitor]).toMatchObject({
      label: "RUM Application",
      modelType: RumApplication,
      nameFields: ["name", "appIdentifier"],
    });
    expect(TELEMETRY_ENTITY_TYPES[ServiceType.Host]).toMatchObject({
      label: "Host",
      modelType: Host,
      nameFields: ["name", "hostIdentifier"],
    });
  });

  test("IoTDevice telemetry resolves against the IoT fleet table", () => {
    expect(TELEMETRY_ENTITY_TYPES[ServiceType.IoTDevice].modelType).toBe(
      IoTFleet,
    );
    expect(TELEMETRY_ENTITY_TYPES[ServiceType.IoTDevice].label).toBe(
      "IoT Fleet",
    );
  });

  test("Incident, Alert and ScheduledMaintenance are named by title", () => {
    expect(TELEMETRY_ENTITY_TYPES[ServiceType.Incident]).toMatchObject({
      modelType: Incident,
      nameFields: ["title"],
    });
    expect(TELEMETRY_ENTITY_TYPES[ServiceType.Alert]).toMatchObject({
      modelType: Alert,
      nameFields: ["title"],
    });
    expect(
      TELEMETRY_ENTITY_TYPES[ServiceType.ScheduledMaintenance],
    ).toMatchObject({
      modelType: ScheduledMaintenance,
      nameFields: ["title"],
    });
  });

  test("every model type is used by exactly one entity type", () => {
    const models: Array<ModelType> = allServiceTypes
      .map((type: ServiceType): ModelType | undefined => {
        return TELEMETRY_ENTITY_TYPES[type].modelType;
      })
      .filter((model: ModelType | undefined): boolean => {
        return Boolean(model);
      }) as Array<ModelType>;
    expect(new Set(models).size).toBe(models.length);
  });
});

describe("TELEMETRY_ENTITY_RESOLUTION_ORDER", () => {
  test("starts with Service (the common case resolves in one request)", () => {
    expect(TELEMETRY_ENTITY_RESOLUTION_ORDER[0]).toBe(
      ServiceType.OpenTelemetry,
    );
  });

  test("covers every table-backed type exactly once and never Unknown", () => {
    const expected: Array<ServiceType> = (
      Object.values(ServiceType) as Array<ServiceType>
    ).filter((type: ServiceType): boolean => {
      return type !== ServiceType.Unknown;
    });
    expect([...TELEMETRY_ENTITY_RESOLUTION_ORDER].sort()).toEqual(
      expected.sort(),
    );
    expect(new Set(TELEMETRY_ENTITY_RESOLUTION_ORDER).size).toBe(
      TELEMETRY_ENTITY_RESOLUTION_ORDER.length,
    );
    expect(TELEMETRY_ENTITY_RESOLUTION_ORDER).not.toContain(
      ServiceType.Unknown,
    );
  });
});

describe("getTelemetryEntityTypeLabel", () => {
  test.each([
    [ServiceType.OpenTelemetry, "Service"],
    [ServiceType.RealUserMonitor, "RUM Application"],
    [ServiceType.Host, "Host"],
    [ServiceType.DockerHost, "Docker Host"],
    [ServiceType.PodmanHost, "Podman Host"],
    [ServiceType.KubernetesCluster, "Kubernetes Cluster"],
    [ServiceType.ProxmoxCluster, "Proxmox Cluster"],
    [ServiceType.CephCluster, "Ceph Cluster"],
    [ServiceType.DockerSwarmCluster, "Docker Swarm Cluster"],
    [ServiceType.VMwareVCenter, "vCenter"],
    [ServiceType.IoTDevice, "IoT Fleet"],
    [ServiceType.ServerlessFunction, "Serverless Function"],
    [ServiceType.CloudResource, "Cloud Resource"],
    [ServiceType.NetworkDevice, "Network Device"],
    [ServiceType.Monitor, "Monitor"],
    [ServiceType.Incident, "Incident"],
    [ServiceType.Alert, "Alert"],
    [ServiceType.ScheduledMaintenance, "Scheduled Maintenance"],
    [ServiceType.Unknown, "Service"],
  ])("%s -> %s", (type: ServiceType, label: string) => {
    expect(getTelemetryEntityTypeLabel(type)).toBe(label);
  });

  test("accepts the enum's string value", () => {
    expect(getTelemetryEntityTypeLabel("RealUserMonitor")).toBe(
      "RUM Application",
    );
  });

  test.each([
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
    ["unknown string", "NotAType"],
    ["prototype key", "toString"],
    ["prototype key __proto__", "__proto__"],
    ["wrong case", "realusermonitor"],
  ])(
    "falls back to the default label for %s",
    (_name: string, value: string | null | undefined) => {
      expect(getTelemetryEntityTypeLabel(value)).toBe(
        DEFAULT_TELEMETRY_ENTITY_LABEL,
      );
    },
  );

  test("the default label is Service so Service pages keep their chip key", () => {
    expect(DEFAULT_TELEMETRY_ENTITY_LABEL).toBe("Service");
  });
});

describe("getTelemetryEntityDisplay", () => {
  const nameMap: TelemetryEntityNameMap = {
    [RUM_ID]: {
      id: RUM_ID,
      name: "checkout-web",
      entityType: ServiceType.RealUserMonitor,
      typeLabel: "RUM Application",
    },
    [SERVICE_ID]: {
      id: SERVICE_ID,
      name: "checkout-api",
      entityType: ServiceType.OpenTelemetry,
      typeLabel: "Service",
    },
  };

  test("resolved entity: key is the type label, value is the name", () => {
    expect(getTelemetryEntityDisplay({ id: RUM_ID, nameMap })).toEqual({
      key: "RUM Application",
      value: "checkout-web",
    });
  });

  test("resolved entity wins over caller fallbacks", () => {
    expect(
      getTelemetryEntityDisplay({
        id: RUM_ID,
        nameMap,
        fallbackKey: "Service",
        fallbackValue: "stale-name",
      }),
    ).toEqual({ key: "RUM Application", value: "checkout-web" });
  });

  test("resolved Service keeps the Service key", () => {
    expect(
      getTelemetryEntityDisplay({
        id: SERVICE_ID,
        nameMap,
        fallbackKey: "Service",
      }),
    ).toEqual({ key: "Service", value: "checkout-api" });
  });

  test("resolved entity with a blank type label uses the fallback key", () => {
    expect(
      getTelemetryEntityDisplay({
        id: HOST_ID,
        nameMap: {
          [HOST_ID]: {
            id: HOST_ID,
            name: "prod-db-1",
            entityType: ServiceType.Host,
            typeLabel: "",
          },
        },
        fallbackKey: "Resource",
      }),
    ).toEqual({ key: "Resource", value: "prod-db-1" });
  });

  test("unresolved id: fallback key and fallback value", () => {
    expect(
      getTelemetryEntityDisplay({
        id: MISSING_ID,
        nameMap,
        fallbackKey: "Service",
        fallbackValue: "legacy-name",
      }),
    ).toEqual({ key: "Service", value: "legacy-name" });
  });

  test("unresolved id without fallbacks: default key and the raw id", () => {
    expect(getTelemetryEntityDisplay({ id: MISSING_ID, nameMap })).toEqual({
      key: DEFAULT_TELEMETRY_ENTITY_LABEL,
      value: MISSING_ID,
    });
  });

  test("undefined name map behaves like unresolved", () => {
    expect(
      getTelemetryEntityDisplay({ id: RUM_ID, nameMap: undefined }),
    ).toEqual({ key: "Service", value: RUM_ID });
  });

  test("empty-string fallbacks are treated as absent", () => {
    expect(
      getTelemetryEntityDisplay({
        id: MISSING_ID,
        nameMap: {},
        fallbackKey: "",
        fallbackValue: "",
      }),
    ).toEqual({ key: DEFAULT_TELEMETRY_ENTITY_LABEL, value: MISSING_ID });
  });
});

describe("TelemetryEntityNameResolver.resolve — inputs", () => {
  test("empty id list returns {} without any request", async () => {
    await expect(
      TelemetryEntityNameResolver.resolve({ ids: [], projectId: PROJECT_ID }),
    ).resolves.toEqual({});
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("blank, null and undefined ids are ignored", async () => {
    await expect(
      TelemetryEntityNameResolver.resolve({
        ids: ["", "   ", null, undefined],
        projectId: PROJECT_ID,
      }),
    ).resolves.toEqual({});
    expect(getListMock).not.toHaveBeenCalled();
  });

  test.each([
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
  ])(
    "missing projectId (%s) returns {} and issues no request",
    async (_name: string, projectId: string | null | undefined) => {
      await expect(
        TelemetryEntityNameResolver.resolve({
          ids: [SERVICE_ID, RUM_ID],
          projectId,
        }),
      ).resolves.toEqual({});
      expect(getListMock).not.toHaveBeenCalled();
    },
  );

  test("accepts ObjectID instances for ids and projectId", async () => {
    const result: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [new ObjectID(SERVICE_ID)],
        projectId: new ObjectID(PROJECT_ID),
      });
    expect(result[SERVICE_ID]?.name).toBe("checkout-api");
  });

  test("duplicate ids (strings, ObjectIDs, padded) are queried once", async () => {
    await TelemetryEntityNameResolver.resolve({
      ids: [SERVICE_ID, new ObjectID(SERVICE_ID), ` ${SERVICE_ID} `],
      projectId: PROJECT_ID,
    });
    expect(issuedRequests()).toEqual([
      { entityType: ServiceType.OpenTelemetry, ids: [SERVICE_ID] },
    ]);
    expect(argsOf(0).limit).toBe(1);
  });

  test("the projectId id resolves to Unknown Service without a request", async () => {
    const result: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [PROJECT_ID],
        projectId: PROJECT_ID,
      });
    expect(result).toEqual({
      [PROJECT_ID]: {
        id: PROJECT_ID,
        name: UNKNOWN_SERVICE_NAME,
        entityType: ServiceType.Unknown,
        typeLabel: "Service",
      },
    });
    expect(UNKNOWN_SERVICE_NAME).toBe("Unknown Service");
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("the projectId id is never sent to a table alongside real ids", async () => {
    const result: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [PROJECT_ID, SERVICE_ID],
        projectId: new ObjectID(PROJECT_ID),
      });
    expect(result[PROJECT_ID]?.name).toBe(UNKNOWN_SERVICE_NAME);
    expect(result[SERVICE_ID]?.name).toBe("checkout-api");
    expect(issuedRequests()).toEqual([
      { entityType: ServiceType.OpenTelemetry, ids: [SERVICE_ID] },
    ]);
  });
});

describe("TelemetryEntityNameResolver.resolve — query plan", () => {
  test("Service ids resolve with a single Service request", async () => {
    const result: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [SERVICE_ID_2, SERVICE_ID],
        projectId: PROJECT_ID,
      });
    expect(result).toEqual({
      [SERVICE_ID]: {
        id: SERVICE_ID,
        name: "checkout-api",
        entityType: ServiceType.OpenTelemetry,
        typeLabel: "Service",
      },
      [SERVICE_ID_2]: {
        id: SERVICE_ID_2,
        name: "payments-api",
        entityType: ServiceType.OpenTelemetry,
        typeLabel: "Service",
      },
    });
    expect(getListMock).toHaveBeenCalledTimes(1);
    expect(requestedTypes()).toEqual([ServiceType.OpenTelemetry]);
  });

  test("query shape: projectId + Includes of sorted ids, limit, select with name fields", async () => {
    await TelemetryEntityNameResolver.resolve({
      ids: [SERVICE_ID_2, SERVICE_ID],
      projectId: PROJECT_ID,
    });
    const args: GetListArgs = argsOf(0);
    expect(args.modelType).toBe(Service);
    expect(args.query.projectId).toBeInstanceOf(ObjectID);
    expect(args.query.projectId.toString()).toBe(PROJECT_ID);
    expect(args.query._id).toBeInstanceOf(Includes);
    expect(includedIds(args.query._id)).toEqual([SERVICE_ID, SERVICE_ID_2]);
    expect(args.limit).toBe(2);
    expect(args.skip).toBe(0);
    expect(args.select).toEqual({ _id: true, name: true });
    expect(args.sort).toEqual({});
  });

  test("select includes every name fallback field of the queried table", async () => {
    await TelemetryEntityNameResolver.resolve({
      ids: [RUM_ID],
      projectId: PROJECT_ID,
      typeHints: { [RUM_ID]: ServiceType.RealUserMonitor },
    });
    expect(argsOf(0).select).toEqual({
      _id: true,
      name: true,
      appIdentifier: true,
    });

    getListMock.mockClear();
    await TelemetryEntityNameResolver.resolve({
      ids: [INCIDENT_ID],
      projectId: PROJECT_ID,
      typeHints: { [INCIDENT_ID]: ServiceType.Incident },
    });
    expect(argsOf(0).select).toEqual({ _id: true, title: true });
  });

  test("unresolved ids fan out after Service to every other table, in resolution order", async () => {
    const result: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [SERVICE_ID, RUM_ID, HOST_ID],
        projectId: PROJECT_ID,
      });

    expect(result[SERVICE_ID]).toMatchObject({
      name: "checkout-api",
      entityType: ServiceType.OpenTelemetry,
      typeLabel: "Service",
    });
    expect(result[RUM_ID]).toEqual({
      id: RUM_ID,
      name: "checkout-web",
      entityType: ServiceType.RealUserMonitor,
      typeLabel: "RUM Application",
    });
    expect(result[HOST_ID]).toEqual({
      id: HOST_ID,
      name: "prod-db-1",
      entityType: ServiceType.Host,
      typeLabel: "Host",
    });

    const requests: Array<IssuedRequest> = issuedRequests();
    // Service first with every id…
    expect(requests[0]).toEqual({
      entityType: ServiceType.OpenTelemetry,
      ids: [SERVICE_ID, RUM_ID, HOST_ID].sort(),
    });
    // …then every other table, with only what Service did not resolve.
    expect(
      requests.slice(1).map((request: IssuedRequest): ServiceType => {
        return request.entityType;
      }),
    ).toEqual(TELEMETRY_ENTITY_RESOLUTION_ORDER.slice(1));
    for (const request of requests.slice(1)) {
      expect(request.ids).toEqual([RUM_ID, HOST_ID].sort());
    }
    expect(argsOf(1).limit).toBe(2);
  });

  test("the fan-out waits for Service, then runs the other tables in parallel", async () => {
    const serviceResponse: Deferred<{ data: Array<FakeRow> }> = deferred();
    const rumResponse: Deferred<{ data: Array<FakeRow> }> = deferred();

    getListMock.mockImplementation((...callArgs: Array<unknown>) => {
      const args: GetListArgs = callArgs[0] as GetListArgs;
      const type: ServiceType = entityTypeForModel(args.modelType);
      if (type === ServiceType.OpenTelemetry) {
        return serviceResponse.promise;
      }
      if (type === ServiceType.RealUserMonitor) {
        return rumResponse.promise;
      }
      return fakeGetList(args);
    });

    const pending: Promise<TelemetryEntityNameMap> =
      TelemetryEntityNameResolver.resolve({
        ids: [RUM_ID],
        projectId: PROJECT_ID,
      });

    await flushPromises();
    expect(requestedTypes()).toEqual([ServiceType.OpenTelemetry]);

    serviceResponse.resolve({ data: [] });
    await flushPromises();

    // Every other table has been asked although RUM has not answered yet.
    expect(requestedTypes()).toEqual(TELEMETRY_ENTITY_RESOLUTION_ORDER);

    rumResponse.resolve({ data: [row(RUM_ID, { name: "checkout-web" })] });
    const result: TelemetryEntityNameMap = await pending;
    expect(result[RUM_ID]?.name).toBe("checkout-web");
  });

  test("an id that exists nowhere is simply absent from the result", async () => {
    const result: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [MISSING_ID, SERVICE_ID],
        projectId: PROJECT_ID,
      });
    expect(Object.keys(result)).toEqual([SERVICE_ID]);
    expect(getListMock).toHaveBeenCalledTimes(
      TELEMETRY_ENTITY_RESOLUTION_ORDER.length,
    );
  });

  test("results only contain requested ids even if a table returns extra rows", async () => {
    getListMock.mockImplementation((...callArgs: Array<unknown>) => {
      const args: GetListArgs = callArgs[0] as GetListArgs;
      const type: ServiceType = entityTypeForModel(args.modelType);
      // A misbehaving backend that ignores the _id filter.
      return Promise.resolve({ data: tables[type] || [] });
    });

    const result: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [SERVICE_ID],
        projectId: PROJECT_ID,
      });
    expect(Object.keys(result)).toEqual([SERVICE_ID]);
  });

  test("a row without an id is ignored", async () => {
    getListMock.mockResolvedValue({
      data: [{ id: null, name: "ghost" }, row(SERVICE_ID, { name: "real" })],
    });
    const result: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [SERVICE_ID],
        projectId: PROJECT_ID,
      });
    expect(result).toEqual({
      [SERVICE_ID]: {
        id: SERVICE_ID,
        name: "real",
        entityType: ServiceType.OpenTelemetry,
        typeLabel: "Service",
      },
    });
  });

  test("a response without data is treated as empty", async () => {
    getListMock.mockResolvedValue({});
    await expect(
      TelemetryEntityNameResolver.resolve({
        ids: [SERVICE_ID],
        projectId: PROJECT_ID,
        entityTypes: [ServiceType.OpenTelemetry],
      }),
    ).resolves.toEqual({});
  });

  test("works with real model instances, not just plain rows", async () => {
    const app: RumApplication = new RumApplication();
    app._id = RUM_ID;
    app.name = "checkout-web";
    tables[ServiceType.RealUserMonitor] = [app as unknown as FakeRow];

    const host: Host = new Host();
    host._id = HOST_ID;
    host.hostIdentifier = "ip-10-0-0-1";
    tables[ServiceType.Host] = [host as unknown as FakeRow];

    const result: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [RUM_ID, HOST_ID],
        projectId: PROJECT_ID,
      });
    expect(result[RUM_ID]?.name).toBe("checkout-web");
    expect(result[HOST_ID]?.name).toBe("ip-10-0-0-1");
  });
});

describe("TelemetryEntityNameResolver.resolve — typeHints", () => {
  test("a hinted RUM id is resolved with exactly one RumApplication request", async () => {
    const result: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [RUM_ID],
        projectId: PROJECT_ID,
        typeHints: { [RUM_ID]: ServiceType.RealUserMonitor },
      });
    expect(result).toEqual({
      [RUM_ID]: {
        id: RUM_ID,
        name: "checkout-web",
        entityType: ServiceType.RealUserMonitor,
        typeLabel: "RUM Application",
      },
    });
    expect(issuedRequests()).toEqual([
      { entityType: ServiceType.RealUserMonitor, ids: [RUM_ID] },
    ]);
  });

  test("hinted ids are grouped per table; unhinted ids still go Service-first", async () => {
    const result: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [RUM_ID, HOST_ID, SERVICE_ID],
        projectId: PROJECT_ID,
        typeHints: {
          [RUM_ID]: ServiceType.RealUserMonitor,
          [HOST_ID]: ServiceType.Host,
        },
      });
    expect(result[RUM_ID]?.typeLabel).toBe("RUM Application");
    expect(result[HOST_ID]?.typeLabel).toBe("Host");
    expect(result[SERVICE_ID]?.typeLabel).toBe("Service");

    const requests: Array<IssuedRequest> = issuedRequests();
    expect(requests).toHaveLength(3);
    // The hinted requests are issued together, before the Service pass.
    expect(
      requests
        .slice(0, 2)
        .map((request: IssuedRequest): string => {
          return request.entityType;
        })
        .sort(),
    ).toEqual([ServiceType.Host, ServiceType.RealUserMonitor].sort());
    expect(requests).toContainEqual({
      entityType: ServiceType.RealUserMonitor,
      ids: [RUM_ID],
    });
    expect(requests).toContainEqual({
      entityType: ServiceType.Host,
      ids: [HOST_ID],
    });
    expect(requests[2]).toEqual({
      entityType: ServiceType.OpenTelemetry,
      ids: [SERVICE_ID],
    });
  });

  test("several ids hinted to the same table share one request", async () => {
    tables[ServiceType.OpenTelemetry] = [
      row(SERVICE_ID, { name: "a" }),
      row(SERVICE_ID_2, { name: "b" }),
    ];
    await TelemetryEntityNameResolver.resolve({
      ids: [SERVICE_ID, SERVICE_ID_2],
      projectId: PROJECT_ID,
      typeHints: {
        [SERVICE_ID]: ServiceType.OpenTelemetry,
        [SERVICE_ID_2]: ServiceType.OpenTelemetry,
      },
    });
    expect(issuedRequests()).toEqual([
      {
        entityType: ServiceType.OpenTelemetry,
        ids: [SERVICE_ID, SERVICE_ID_2],
      },
    ]);
  });

  test("a hinted id that misses its table falls through to the general pass", async () => {
    // Hinted as RUM, but it is actually a Host.
    const result: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [HOST_ID],
        projectId: PROJECT_ID,
        typeHints: { [HOST_ID]: ServiceType.RealUserMonitor },
      });
    expect(result[HOST_ID]).toEqual({
      id: HOST_ID,
      name: "prod-db-1",
      entityType: ServiceType.Host,
      typeLabel: "Host",
    });
    const types: Array<ServiceType> = requestedTypes();
    expect(types[0]).toBe(ServiceType.RealUserMonitor);
    expect(types[1]).toBe(ServiceType.OpenTelemetry);
    expect(types).toContain(ServiceType.Host);
  });

  test("a hinted id that misses is never asked of its hinted table again", async () => {
    await TelemetryEntityNameResolver.resolve({
      ids: [HOST_ID, MISSING_ID],
      projectId: PROJECT_ID,
      typeHints: { [HOST_ID]: ServiceType.RealUserMonitor },
    });
    const rumRequests: Array<IssuedRequest> = issuedRequests().filter(
      (request: IssuedRequest): boolean => {
        return request.entityType === ServiceType.RealUserMonitor;
      },
    );
    // One hinted request for HOST_ID, one fan-out request for MISSING_ID only.
    expect(rumRequests).toEqual([
      { entityType: ServiceType.RealUserMonitor, ids: [HOST_ID] },
      { entityType: ServiceType.RealUserMonitor, ids: [MISSING_ID] },
    ]);
  });

  test("a hinted Service id that misses skips the Service pass for that id", async () => {
    await TelemetryEntityNameResolver.resolve({
      ids: [RUM_ID],
      projectId: PROJECT_ID,
      typeHints: { [RUM_ID]: ServiceType.OpenTelemetry },
    });
    const serviceRequests: Array<IssuedRequest> = issuedRequests().filter(
      (request: IssuedRequest): boolean => {
        return request.entityType === ServiceType.OpenTelemetry;
      },
    );
    expect(serviceRequests).toEqual([
      { entityType: ServiceType.OpenTelemetry, ids: [RUM_ID] },
    ]);
    expect(requestedTypes()).toContain(ServiceType.RealUserMonitor);
  });

  test("a hinted id whose table fails falls through to the general pass", async () => {
    failingTypes.add(ServiceType.KubernetesCluster);
    tables[ServiceType.OpenTelemetry] = [
      row(CLUSTER_ID, { name: "actually-a-service" }),
    ];
    const result: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [CLUSTER_ID],
        projectId: PROJECT_ID,
        typeHints: { [CLUSTER_ID]: ServiceType.KubernetesCluster },
      });
    expect(result[CLUSTER_ID]).toMatchObject({
      name: "actually-a-service",
      entityType: ServiceType.OpenTelemetry,
    });
  });

  test("hints outside the allowed entityTypes are ignored", async () => {
    const result: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [RUM_ID],
        projectId: PROJECT_ID,
        typeHints: { [RUM_ID]: ServiceType.RealUserMonitor },
        entityTypes: [ServiceType.OpenTelemetry],
      });
    expect(result).toEqual({});
    expect(requestedTypes()).toEqual([ServiceType.OpenTelemetry]);
  });

  test("undefined hints and hints for ids not requested are ignored", async () => {
    await TelemetryEntityNameResolver.resolve({
      ids: [SERVICE_ID],
      projectId: PROJECT_ID,
      typeHints: {
        [SERVICE_ID]: undefined,
        [RUM_ID]: ServiceType.RealUserMonitor,
      },
    });
    expect(issuedRequests()).toEqual([
      { entityType: ServiceType.OpenTelemetry, ids: [SERVICE_ID] },
    ]);
  });

  test("an Unknown hint never queries a table", async () => {
    const result: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [PROJECT_ID],
        projectId: PROJECT_ID,
        typeHints: { [PROJECT_ID]: ServiceType.Unknown },
      });
    expect(result[PROJECT_ID]?.name).toBe(UNKNOWN_SERVICE_NAME);
    expect(getListMock).not.toHaveBeenCalled();
  });
});

describe("TelemetryEntityNameResolver.resolve — entityTypes restriction", () => {
  test("Service-only never queries RumApplication (or any other table)", async () => {
    const result: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [SERVICE_ID, RUM_ID],
        projectId: PROJECT_ID,
        entityTypes: [ServiceType.OpenTelemetry],
      });
    expect(Object.keys(result)).toEqual([SERVICE_ID]);
    expect(requestedTypes()).toEqual([ServiceType.OpenTelemetry]);
  });

  test("a cached RUM entity is not returned to a Service-only caller", async () => {
    await TelemetryEntityNameResolver.resolve({
      ids: [RUM_ID],
      projectId: PROJECT_ID,
    });
    getListMock.mockClear();

    const serviceOnly: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [RUM_ID],
        projectId: PROJECT_ID,
        entityTypes: [ServiceType.OpenTelemetry],
      });
    expect(serviceOnly).toEqual({});
    expect(requestedTypes()).toEqual([ServiceType.OpenTelemetry]);

    // The unrestricted caller still gets it from cache.
    getListMock.mockClear();
    const unrestricted: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [RUM_ID],
        projectId: PROJECT_ID,
      });
    expect(unrestricted[RUM_ID]?.name).toBe("checkout-web");
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("the first allowed type (in resolution order) is queried first, the rest in parallel", async () => {
    // Given out of order on purpose.
    const result: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [HOST_ID],
        projectId: PROJECT_ID,
        entityTypes: [ServiceType.Host, ServiceType.RealUserMonitor],
      });
    expect(result[HOST_ID]?.name).toBe("prod-db-1");
    expect(requestedTypes()).toEqual([
      ServiceType.RealUserMonitor,
      ServiceType.Host,
    ]);
  });

  test("a single non-Service type issues exactly one request", async () => {
    await TelemetryEntityNameResolver.resolve({
      ids: [MISSING_ID],
      projectId: PROJECT_ID,
      entityTypes: [ServiceType.KubernetesCluster],
    });
    expect(requestedTypes()).toEqual([ServiceType.KubernetesCluster]);
  });

  test("an empty entityTypes array means no restriction", async () => {
    const result: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [CLUSTER_ID],
        projectId: PROJECT_ID,
        entityTypes: [],
      });
    expect(result[CLUSTER_ID]?.typeLabel).toBe("Kubernetes Cluster");
    expect(getListMock).toHaveBeenCalledTimes(
      TELEMETRY_ENTITY_RESOLUTION_ORDER.length,
    );
  });

  test("the Unknown bucket is available to Service-only callers", async () => {
    const result: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [PROJECT_ID],
        projectId: PROJECT_ID,
        entityTypes: [ServiceType.OpenTelemetry],
      });
    expect(result[PROJECT_ID]?.entityType).toBe(ServiceType.Unknown);
  });

  test("entityTypes [Unknown] resolves the projectId only and queries nothing", async () => {
    const result: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [PROJECT_ID, SERVICE_ID],
        projectId: PROJECT_ID,
        entityTypes: [ServiceType.Unknown],
      });
    expect(Object.keys(result)).toEqual([PROJECT_ID]);
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("the Unknown bucket is not returned when neither Unknown nor Service is allowed", async () => {
    const result: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [PROJECT_ID],
        projectId: PROJECT_ID,
        entityTypes: [ServiceType.Host],
      });
    expect(result).toEqual({});
  });
});

describe("TelemetryEntityNameResolver.resolve — failure isolation", () => {
  test("a failing Service table does not stop the fan-out", async () => {
    failingTypes.add(ServiceType.OpenTelemetry);
    const result: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [SERVICE_ID, RUM_ID],
        projectId: PROJECT_ID,
      });
    expect(result[SERVICE_ID]).toBeUndefined();
    expect(result[RUM_ID]?.name).toBe("checkout-web");
  });

  test("one failing table in the fan-out leaves the others resolved", async () => {
    failingTypes.add(ServiceType.RealUserMonitor);
    const result: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [SERVICE_ID, RUM_ID, HOST_ID, CLUSTER_ID, INCIDENT_ID],
        projectId: PROJECT_ID,
      });
    expect(result[SERVICE_ID]?.name).toBe("checkout-api");
    expect(result[RUM_ID]).toBeUndefined();
    expect(result[HOST_ID]?.name).toBe("prod-db-1");
    expect(result[CLUSTER_ID]?.name).toBe("prod-eu-west");
    expect(result[INCIDENT_ID]?.name).toBe("API is down");
  });

  test("a synchronous throw from getList is isolated as well", async () => {
    getListMock.mockImplementation((...callArgs: Array<unknown>) => {
      const args: GetListArgs = callArgs[0] as GetListArgs;
      if (entityTypeForModel(args.modelType) === ServiceType.Host) {
        throw new Error("boom");
      }
      return fakeGetList(args);
    });
    const result: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [HOST_ID, CLUSTER_ID],
        projectId: PROJECT_ID,
      });
    expect(result[HOST_ID]).toBeUndefined();
    expect(result[CLUSTER_ID]?.name).toBe("prod-eu-west");
  });

  test("every table failing resolves to {} instead of rejecting", async () => {
    getListMock.mockRejectedValue(new Error("offline"));
    await expect(
      TelemetryEntityNameResolver.resolve({
        ids: [SERVICE_ID, RUM_ID],
        projectId: PROJECT_ID,
      }),
    ).resolves.toEqual({});
  });

  test("failures are only remembered briefly: the call after the miss TTL retries", async () => {
    /*
     * A failed table leaves its ids in the short-lived miss cache (so a
     * live view does not hammer a table the role cannot read), but never
     * as a hit: once the miss TTL passes the lookup is retried.
     */
    const nowSpy: NowSpy = freezeNow(START_TIME);
    failingTypes.add(ServiceType.OpenTelemetry);
    await TelemetryEntityNameResolver.resolve({
      ids: [SERVICE_ID],
      projectId: PROJECT_ID,
      entityTypes: [ServiceType.OpenTelemetry],
    });
    failingTypes.clear();
    nowSpy.mockReturnValue(START_TIME + MISS_CACHE_TTL_IN_MS + 1);
    const result: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [SERVICE_ID],
        projectId: PROJECT_ID,
        entityTypes: [ServiceType.OpenTelemetry],
      });
    expect(result[SERVICE_ID]?.name).toBe("checkout-api");
    expect(getListMock).toHaveBeenCalledTimes(2);
  });
});

describe("TelemetryEntityNameResolver.resolve — name fields", () => {
  test("RumApplication without a name falls back to appIdentifier", async () => {
    tables[ServiceType.RealUserMonitor] = [
      row(RUM_ID, { name: undefined, appIdentifier: "checkout-web-prod" }),
    ];
    const result: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [RUM_ID],
        projectId: PROJECT_ID,
        typeHints: { [RUM_ID]: ServiceType.RealUserMonitor },
      });
    expect(result[RUM_ID]).toEqual({
      id: RUM_ID,
      name: "checkout-web-prod",
      entityType: ServiceType.RealUserMonitor,
      typeLabel: "RUM Application",
    });
  });

  test("Host without a name falls back to hostIdentifier", async () => {
    tables[ServiceType.Host] = [
      row(HOST_ID, { name: null, hostIdentifier: "ip-10-0-0-12" }),
    ];
    const result: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [HOST_ID],
        projectId: PROJECT_ID,
        typeHints: { [HOST_ID]: ServiceType.Host },
      });
    expect(result[HOST_ID]?.name).toBe("ip-10-0-0-12");
  });

  test("KubernetesCluster without a name falls back to clusterIdentifier", async () => {
    tables[ServiceType.KubernetesCluster] = [
      row(CLUSTER_ID, { clusterIdentifier: "eks-prod" }),
    ];
    const result: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [CLUSTER_ID],
        projectId: PROJECT_ID,
        typeHints: { [CLUSTER_ID]: ServiceType.KubernetesCluster },
      });
    expect(result[CLUSTER_ID]?.name).toBe("eks-prod");
  });

  test("a blank name is skipped in favour of the next field", async () => {
    tables[ServiceType.RealUserMonitor] = [
      row(RUM_ID, { name: "   ", appIdentifier: "web-app" }),
    ];
    const result: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [RUM_ID],
        projectId: PROJECT_ID,
        typeHints: { [RUM_ID]: ServiceType.RealUserMonitor },
      });
    expect(result[RUM_ID]?.name).toBe("web-app");
  });

  test("the name wins over the fallback field when both are present", async () => {
    tables[ServiceType.Host] = [
      row(HOST_ID, { name: "Primary DB", hostIdentifier: "ip-10-0-0-12" }),
    ];
    const result: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [HOST_ID],
        projectId: PROJECT_ID,
        typeHints: { [HOST_ID]: ServiceType.Host },
      });
    expect(result[HOST_ID]?.name).toBe("Primary DB");
  });

  test("names are trimmed", async () => {
    tables[ServiceType.OpenTelemetry] = [
      row(SERVICE_ID, { name: "  checkout-api \n" }),
    ];
    const result: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [SERVICE_ID],
        projectId: PROJECT_ID,
      });
    expect(result[SERVICE_ID]?.name).toBe("checkout-api");
  });

  test("a row with no usable name in any field is not resolved (and not cached as a hit)", async () => {
    const nowSpy: NowSpy = freezeNow(START_TIME);
    tables[ServiceType.OpenTelemetry] = [row(SERVICE_ID, { name: "" })];
    const first: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [SERVICE_ID],
        projectId: PROJECT_ID,
        entityTypes: [ServiceType.OpenTelemetry],
      });
    expect(first).toEqual({});

    tables[ServiceType.OpenTelemetry] = [row(SERVICE_ID, { name: "renamed" })];
    // Past the (short) miss TTL, but well inside the hit TTL.
    nowSpy.mockReturnValue(START_TIME + MISS_CACHE_TTL_IN_MS + 1);
    const second: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [SERVICE_ID],
        projectId: PROJECT_ID,
        entityTypes: [ServiceType.OpenTelemetry],
      });
    expect(second[SERVICE_ID]?.name).toBe("renamed");
  });

  test("Incident is named by its title, not a name column", async () => {
    tables[ServiceType.Incident] = [
      row(INCIDENT_ID, { name: "ignored", title: "Checkout latency spike" }),
    ];
    const result: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [INCIDENT_ID],
        projectId: PROJECT_ID,
        typeHints: { [INCIDENT_ID]: ServiceType.Incident },
      });
    expect(result[INCIDENT_ID]).toEqual({
      id: INCIDENT_ID,
      name: "Checkout latency spike",
      entityType: ServiceType.Incident,
      typeLabel: "Incident",
    });
  });

  test("non-string names are stringified", async () => {
    tables[ServiceType.OpenTelemetry] = [row(SERVICE_ID, { name: 42 })];
    const result: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [SERVICE_ID],
        projectId: PROJECT_ID,
      });
    expect(result[SERVICE_ID]?.name).toBe("42");
  });
});

describe("TelemetryEntityNameResolver — cache", () => {
  test("a cache hit avoids a second request", async () => {
    const first: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [SERVICE_ID, RUM_ID],
        projectId: PROJECT_ID,
      });
    const requestsAfterFirst: number = getListMock.mock.calls.length;
    expect(requestsAfterFirst).toBeGreaterThan(0);

    const second: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [RUM_ID, SERVICE_ID],
        projectId: PROJECT_ID,
      });
    expect(second).toEqual(first);
    expect(getListMock.mock.calls.length).toBe(requestsAfterFirst);
  });

  test("only the uncached ids are queried on a partial cache hit", async () => {
    await TelemetryEntityNameResolver.resolve({
      ids: [SERVICE_ID],
      projectId: PROJECT_ID,
    });
    getListMock.mockClear();

    const result: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [SERVICE_ID, SERVICE_ID_2],
        projectId: PROJECT_ID,
      });
    expect(result[SERVICE_ID]?.name).toBe("checkout-api");
    expect(result[SERVICE_ID_2]?.name).toBe("payments-api");
    expect(issuedRequests()).toEqual([
      { entityType: ServiceType.OpenTelemetry, ids: [SERVICE_ID_2] },
    ]);
  });

  test("a hint for a cached id does not trigger a request", async () => {
    await TelemetryEntityNameResolver.resolve({
      ids: [RUM_ID],
      projectId: PROJECT_ID,
      typeHints: { [RUM_ID]: ServiceType.RealUserMonitor },
    });
    getListMock.mockClear();
    await TelemetryEntityNameResolver.resolve({
      ids: [RUM_ID],
      projectId: PROJECT_ID,
      typeHints: { [RUM_ID]: ServiceType.RealUserMonitor },
    });
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("misses are only cached briefly, so a newly created resource resolves once the miss TTL passes", async () => {
    const nowSpy: NowSpy = freezeNow(START_TIME);
    await TelemetryEntityNameResolver.resolve({
      ids: [MISSING_ID],
      projectId: PROJECT_ID,
      entityTypes: [ServiceType.OpenTelemetry],
    });
    tables[ServiceType.OpenTelemetry]!.push(
      row(MISSING_ID, { name: "brand-new" }),
    );
    nowSpy.mockReturnValue(START_TIME + MISS_CACHE_TTL_IN_MS + 1);
    const result: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [MISSING_ID],
        projectId: PROJECT_ID,
        entityTypes: [ServiceType.OpenTelemetry],
      });
    expect(result[MISSING_ID]?.name).toBe("brand-new");
    expect(getListMock).toHaveBeenCalledTimes(2);
  });

  test("the cache is scoped per project", async () => {
    const otherProject: string = "9e1b6b0e-0000-4000-8000-000000000002";
    await TelemetryEntityNameResolver.resolve({
      ids: [SERVICE_ID],
      projectId: PROJECT_ID,
    });
    getListMock.mockClear();
    await TelemetryEntityNameResolver.resolve({
      ids: [SERVICE_ID],
      projectId: otherProject,
      entityTypes: [ServiceType.OpenTelemetry],
    });
    expect(getListMock).toHaveBeenCalledTimes(1);
    expect(argsOf(0).query.projectId.toString()).toBe(otherProject);
  });

  test("clearCache forces a fresh request", async () => {
    await TelemetryEntityNameResolver.resolve({
      ids: [SERVICE_ID],
      projectId: PROJECT_ID,
    });
    TelemetryEntityNameResolver.clearCache();
    tables[ServiceType.OpenTelemetry] = [
      row(SERVICE_ID, { name: "checkout-api-renamed" }),
    ];
    const result: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [SERVICE_ID],
        projectId: PROJECT_ID,
      });
    expect(result[SERVICE_ID]?.name).toBe("checkout-api-renamed");
    expect(getListMock).toHaveBeenCalledTimes(2);
  });

  test("entries expire after the TTL (60s)", async () => {
    const start: number = 1_800_000_000_000;
    /*
     * Named structurally: jest.spyOn from @jest/globals returns jest-mock's
     * SpyInstance, which does not assign to the global jest.SpiedFunction.
     */
    const nowSpy: { mockReturnValue: (value: number) => unknown } = jest
      .spyOn(Date, "now")
      .mockReturnValue(start);

    await TelemetryEntityNameResolver.resolve({
      ids: [SERVICE_ID],
      projectId: PROJECT_ID,
    });
    expect(getListMock).toHaveBeenCalledTimes(1);

    nowSpy.mockReturnValue(start + 59 * 1000);
    await TelemetryEntityNameResolver.resolve({
      ids: [SERVICE_ID],
      projectId: PROJECT_ID,
    });
    expect(getListMock).toHaveBeenCalledTimes(1);

    nowSpy.mockReturnValue(start + 61 * 1000);
    await TelemetryEntityNameResolver.resolve({
      ids: [SERVICE_ID],
      projectId: PROJECT_ID,
    });
    expect(getListMock).toHaveBeenCalledTimes(2);
  });

  test("callers get the same entity values from cache as from the network", async () => {
    const fromNetwork: ResolvedTelemetryEntity | undefined = (
      await TelemetryEntityNameResolver.resolve({
        ids: [HOST_ID],
        projectId: PROJECT_ID,
      })
    )[HOST_ID];
    const fromCache: ResolvedTelemetryEntity | undefined = (
      await TelemetryEntityNameResolver.resolve({
        ids: [HOST_ID],
        projectId: PROJECT_ID,
      })
    )[HOST_ID];
    expect(fromCache).toEqual(fromNetwork);
  });
});

describe("TelemetryEntityNameResolver — in-flight dedup", () => {
  test("concurrent identical calls share one set of requests", async () => {
    const results: Array<TelemetryEntityNameMap> = await Promise.all([
      TelemetryEntityNameResolver.resolve({
        ids: [SERVICE_ID, RUM_ID],
        projectId: PROJECT_ID,
      }),
      TelemetryEntityNameResolver.resolve({
        ids: [SERVICE_ID, RUM_ID],
        projectId: PROJECT_ID,
      }),
      // Same set in a different order, as ObjectIDs.
      TelemetryEntityNameResolver.resolve({
        ids: [new ObjectID(RUM_ID), new ObjectID(SERVICE_ID)],
        projectId: new ObjectID(PROJECT_ID),
      }),
    ]);
    expect(results[0]![RUM_ID]?.name).toBe("checkout-web");
    expect(results[0]![SERVICE_ID]?.name).toBe("checkout-api");
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
    expect(getListMock).toHaveBeenCalledTimes(
      TELEMETRY_ENTITY_RESOLUTION_ORDER.length,
    );
    expect(
      requestedTypes().filter((type: ServiceType): boolean => {
        return type === ServiceType.OpenTelemetry;
      }),
    ).toHaveLength(1);
  });

  test("concurrent calls with different options are not merged", async () => {
    await Promise.all([
      TelemetryEntityNameResolver.resolve({
        ids: [RUM_ID],
        projectId: PROJECT_ID,
        entityTypes: [ServiceType.OpenTelemetry],
      }),
      TelemetryEntityNameResolver.resolve({
        ids: [RUM_ID],
        projectId: PROJECT_ID,
        typeHints: { [RUM_ID]: ServiceType.RealUserMonitor },
      }),
    ]);
    expect(requestedTypes().sort()).toEqual(
      [ServiceType.OpenTelemetry, ServiceType.RealUserMonitor].sort(),
    );
  });

  test("once a call settles, the next identical call is served by the cache, not the stale promise", async () => {
    const nowSpy: NowSpy = freezeNow(START_TIME);
    await TelemetryEntityNameResolver.resolve({
      ids: [MISSING_ID],
      projectId: PROJECT_ID,
      entityTypes: [ServiceType.OpenTelemetry],
    });
    tables[ServiceType.OpenTelemetry]!.push(
      row(MISSING_ID, { name: "appeared" }),
    );
    /*
     * Past the miss TTL the identical call must issue a new request; a
     * settled promise left in the in-flight map would replay the miss.
     */
    nowSpy.mockReturnValue(START_TIME + MISS_CACHE_TTL_IN_MS + 1);
    const result: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [MISSING_ID],
        projectId: PROJECT_ID,
        entityTypes: [ServiceType.OpenTelemetry],
      });
    expect(result[MISSING_ID]?.name).toBe("appeared");
  });

  test("clearCache also drops in-flight entries", async () => {
    const serviceResponse: Deferred<{ data: Array<FakeRow> }> = deferred();
    getListMock.mockImplementationOnce(() => {
      return serviceResponse.promise;
    });

    const stuck: Promise<TelemetryEntityNameMap> =
      TelemetryEntityNameResolver.resolve({
        ids: [SERVICE_ID],
        projectId: PROJECT_ID,
        entityTypes: [ServiceType.OpenTelemetry],
      });
    TelemetryEntityNameResolver.clearCache();

    const fresh: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [SERVICE_ID],
        projectId: PROJECT_ID,
        entityTypes: [ServiceType.OpenTelemetry],
      });
    expect(fresh[SERVICE_ID]?.name).toBe("checkout-api");
    expect(getListMock).toHaveBeenCalledTimes(2);

    serviceResponse.resolve({ data: [] });
    await expect(stuck).resolves.toEqual({});
  });
});

describe("TelemetryEntityNameResolver — miss cache", () => {
  /*
   * An id that resolves nowhere (a deleted service still in retention, a
   * table the role cannot read) used to be searched across every table
   * each time a live view's id set changed. Misses are now remembered for
   * a short TTL, keyed by project + id + the tables that were searched.
   */

  test("the miss TTL is positive and shorter than the hit TTL", () => {
    expect(MISS_CACHE_TTL_IN_MS).toBeGreaterThan(0);
    expect(MISS_CACHE_TTL_IN_MS).toBeLessThan(HIT_CACHE_TTL_IN_MS);
  });

  test("an id that resolved nowhere is not searched again within the miss TTL", async () => {
    const nowSpy: NowSpy = freezeNow(START_TIME);
    await expect(
      TelemetryEntityNameResolver.resolve({
        ids: [MISSING_ID],
        projectId: PROJECT_ID,
      }),
    ).resolves.toEqual({});
    expect(getListMock).toHaveBeenCalledTimes(
      TELEMETRY_ENTITY_RESOLUTION_ORDER.length,
    );

    getListMock.mockClear();
    nowSpy.mockReturnValue(START_TIME + MISS_CACHE_TTL_IN_MS - 1);
    await expect(
      TelemetryEntityNameResolver.resolve({
        ids: [MISSING_ID],
        projectId: PROJECT_ID,
      }),
    ).resolves.toEqual({});
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("after the miss TTL the id is searched across every table again", async () => {
    const nowSpy: NowSpy = freezeNow(START_TIME);
    await TelemetryEntityNameResolver.resolve({
      ids: [MISSING_ID],
      projectId: PROJECT_ID,
    });
    getListMock.mockClear();

    nowSpy.mockReturnValue(START_TIME + MISS_CACHE_TTL_IN_MS + 1);
    await TelemetryEntityNameResolver.resolve({
      ids: [MISSING_ID],
      projectId: PROJECT_ID,
    });
    expect(requestedTypes()).toEqual(TELEMETRY_ENTITY_RESOLUTION_ORDER);
    for (const request of issuedRequests()) {
      expect(request.ids).toEqual([MISSING_ID]);
    }
  });

  test("a remembered miss is left out of the next batch without holding back the other ids", async () => {
    freezeNow(START_TIME);
    await TelemetryEntityNameResolver.resolve({
      ids: [MISSING_ID],
      projectId: PROJECT_ID,
    });
    getListMock.mockClear();

    const result: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [MISSING_ID, SERVICE_ID_2],
        projectId: PROJECT_ID,
      });
    expect(Object.keys(result)).toEqual([SERVICE_ID_2]);
    expect(result[SERVICE_ID_2]?.name).toBe("payments-api");
    expect(issuedRequests()).toEqual([
      { entityType: ServiceType.OpenTelemetry, ids: [SERVICE_ID_2] },
    ]);
  });

  test("the miss key includes the allowed types: a Service-only miss does not block an unrestricted lookup", async () => {
    freezeNow(START_TIME);
    await expect(
      TelemetryEntityNameResolver.resolve({
        ids: [RUM_ID],
        projectId: PROJECT_ID,
        entityTypes: [ServiceType.OpenTelemetry],
      }),
    ).resolves.toEqual({});
    expect(requestedTypes()).toEqual([ServiceType.OpenTelemetry]);

    // The same Service-only lookup is remembered…
    getListMock.mockClear();
    await TelemetryEntityNameResolver.resolve({
      ids: [RUM_ID],
      projectId: PROJECT_ID,
      entityTypes: [ServiceType.OpenTelemetry],
    });
    expect(getListMock).not.toHaveBeenCalled();

    // …but a lookup allowed to search every table still finds the RUM app.
    getListMock.mockClear();
    const unrestricted: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [RUM_ID],
        projectId: PROJECT_ID,
      });
    expect(unrestricted[RUM_ID]).toEqual({
      id: RUM_ID,
      name: "checkout-web",
      entityType: ServiceType.RealUserMonitor,
      typeLabel: "RUM Application",
    });
    expect(requestsFor(ServiceType.RealUserMonitor)).toEqual([
      { entityType: ServiceType.RealUserMonitor, ids: [RUM_ID] },
    ]);
  });

  test("misses are remembered per project", async () => {
    const otherProject: string = "9e1b6b0e-0000-4000-8000-000000000002";
    freezeNow(START_TIME);
    await TelemetryEntityNameResolver.resolve({
      ids: [MISSING_ID],
      projectId: PROJECT_ID,
      entityTypes: [ServiceType.OpenTelemetry],
    });
    getListMock.mockClear();

    await TelemetryEntityNameResolver.resolve({
      ids: [MISSING_ID],
      projectId: otherProject,
      entityTypes: [ServiceType.OpenTelemetry],
    });
    expect(getListMock).toHaveBeenCalledTimes(1);
    expect(argsOf(0).query.projectId.toString()).toBe(otherProject);
  });

  test("a hit that lands while a miss for the same lookup is remembered clears that miss", async () => {
    freezeNow(START_TIME);
    const plainResponse: Deferred<{ data: Array<FakeRow> }> = deferred();
    const hintedResponse: Deferred<{ data: Array<FakeRow> }> = deferred();
    getListMock
      .mockImplementationOnce(() => {
        return plainResponse.promise;
      })
      .mockImplementationOnce(() => {
        return hintedResponse.promise;
      });

    /*
     * Two concurrent lookups over the same tables (so the same miss key)
     * that are not deduplicated because their hints differ.
     */
    const plain: Promise<TelemetryEntityNameMap> =
      TelemetryEntityNameResolver.resolve({
        ids: [MISSING_ID],
        projectId: PROJECT_ID,
        entityTypes: [ServiceType.OpenTelemetry],
      });
    const hinted: Promise<TelemetryEntityNameMap> =
      TelemetryEntityNameResolver.resolve({
        ids: [MISSING_ID],
        projectId: PROJECT_ID,
        entityTypes: [ServiceType.OpenTelemetry],
        typeHints: { [MISSING_ID]: ServiceType.OpenTelemetry },
      });
    await flushPromises();
    expect(getListMock).toHaveBeenCalledTimes(2);

    plainResponse.resolve({ data: [] });
    await expect(plain).resolves.toEqual({});
    expect(
      missCacheKeys().filter((key: string): boolean => {
        return key.includes(MISSING_ID);
      }),
    ).toHaveLength(1);

    hintedResponse.resolve({
      data: [row(MISSING_ID, { name: "just-created" })],
    });
    expect((await hinted)[MISSING_ID]?.name).toBe("just-created");
    expect(
      missCacheKeys().filter((key: string): boolean => {
        return key.includes(MISSING_ID);
      }),
    ).toEqual([]);

    getListMock.mockClear();
    const again: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [MISSING_ID],
        projectId: PROJECT_ID,
        entityTypes: [ServiceType.OpenTelemetry],
      });
    expect(again[MISSING_ID]?.name).toBe("just-created");
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("a later hit after the miss TTL replaces the expired miss entry", async () => {
    const nowSpy: NowSpy = freezeNow(START_TIME);
    await TelemetryEntityNameResolver.resolve({
      ids: [MISSING_ID],
      projectId: PROJECT_ID,
    });
    expect(missCacheKeys()).toHaveLength(1);

    tables[ServiceType.Host]!.push(row(MISSING_ID, { name: "late-host" }));
    nowSpy.mockReturnValue(START_TIME + MISS_CACHE_TTL_IN_MS + 1);
    const result: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [MISSING_ID],
        projectId: PROJECT_ID,
      });
    expect(result[MISSING_ID]).toMatchObject({
      name: "late-host",
      entityType: ServiceType.Host,
    });
    expect(missCacheKeys()).toEqual([]);
  });

  test("clearCache forgets misses", async () => {
    freezeNow(START_TIME);
    await TelemetryEntityNameResolver.resolve({
      ids: [MISSING_ID],
      projectId: PROJECT_ID,
      entityTypes: [ServiceType.OpenTelemetry],
    });
    tables[ServiceType.OpenTelemetry]!.push(
      row(MISSING_ID, { name: "brand-new" }),
    );

    TelemetryEntityNameResolver.clearCache();
    expect(missCacheKeys()).toEqual([]);

    // Same instant: only the cleared miss could have suppressed this.
    const result: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [MISSING_ID],
        projectId: PROJECT_ID,
        entityTypes: [ServiceType.OpenTelemetry],
      });
    expect(result[MISSING_ID]?.name).toBe("brand-new");
    expect(getListMock).toHaveBeenCalledTimes(2);
  });

  test("ids left unresolved by a failing table are remembered too", async () => {
    const nowSpy: NowSpy = freezeNow(START_TIME);
    failingTypes.add(ServiceType.RealUserMonitor);
    await expect(
      TelemetryEntityNameResolver.resolve({
        ids: [RUM_ID],
        projectId: PROJECT_ID,
      }),
    ).resolves.toEqual({});
    expect(requestedTypes()).toContain(ServiceType.RealUserMonitor);

    getListMock.mockClear();
    failingTypes.clear();
    await expect(
      TelemetryEntityNameResolver.resolve({
        ids: [RUM_ID],
        projectId: PROJECT_ID,
      }),
    ).resolves.toEqual({});
    expect(getListMock).not.toHaveBeenCalled();

    nowSpy.mockReturnValue(START_TIME + MISS_CACHE_TTL_IN_MS + 1);
    const result: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [RUM_ID],
        projectId: PROJECT_ID,
      });
    expect(result[RUM_ID]?.name).toBe("checkout-web");
  });

  test("a hinted id that resolved nowhere is remembered as well", async () => {
    freezeNow(START_TIME);
    await TelemetryEntityNameResolver.resolve({
      ids: [MISSING_ID],
      projectId: PROJECT_ID,
      typeHints: { [MISSING_ID]: ServiceType.RealUserMonitor },
    });
    expect(getListMock).toHaveBeenCalledTimes(
      TELEMETRY_ENTITY_RESOLUTION_ORDER.length,
    );

    getListMock.mockClear();
    await TelemetryEntityNameResolver.resolve({
      ids: [MISSING_ID],
      projectId: PROJECT_ID,
      typeHints: { [MISSING_ID]: ServiceType.RealUserMonitor },
    });
    expect(getListMock).not.toHaveBeenCalled();
  });
});

describe("TelemetryEntityNameResolver — expired hits", () => {
  /*
   * An expired hit already says which table the id lives in, so its
   * refresh goes straight there instead of probing Services and then every
   * other table again.
   */

  test("an expired RUM hit is refreshed with exactly one RumApplication request and no Service request", async () => {
    const nowSpy: NowSpy = freezeNow(START_TIME);
    await TelemetryEntityNameResolver.resolve({
      ids: [RUM_ID],
      projectId: PROJECT_ID,
    });
    getListMock.mockClear();
    tables[ServiceType.RealUserMonitor] = [
      row(RUM_ID, { name: "checkout-web-v2" }),
    ];

    // Still fresh: served from cache with the old name.
    nowSpy.mockReturnValue(START_TIME + HIT_CACHE_TTL_IN_MS - 1);
    const fresh: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [RUM_ID],
        projectId: PROJECT_ID,
      });
    expect(fresh[RUM_ID]?.name).toBe("checkout-web");
    expect(getListMock).not.toHaveBeenCalled();

    nowSpy.mockReturnValue(START_TIME + HIT_CACHE_TTL_IN_MS + 1);
    const refreshed: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [RUM_ID],
        projectId: PROJECT_ID,
      });
    expect(refreshed[RUM_ID]).toEqual({
      id: RUM_ID,
      name: "checkout-web-v2",
      entityType: ServiceType.RealUserMonitor,
      typeLabel: "RUM Application",
    });
    expect(issuedRequests()).toEqual([
      { entityType: ServiceType.RealUserMonitor, ids: [RUM_ID] },
    ]);
  });

  test("expired hits in several tables refresh in one request per table, with no fan-out", async () => {
    const nowSpy: NowSpy = freezeNow(START_TIME);
    await TelemetryEntityNameResolver.resolve({
      ids: [SERVICE_ID, RUM_ID, HOST_ID],
      projectId: PROJECT_ID,
    });
    getListMock.mockClear();

    nowSpy.mockReturnValue(START_TIME + HIT_CACHE_TTL_IN_MS + 1);
    const result: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [SERVICE_ID, RUM_ID, HOST_ID],
        projectId: PROJECT_ID,
      });
    expect(Object.keys(result).sort()).toEqual(
      [SERVICE_ID, RUM_ID, HOST_ID].sort(),
    );
    const requests: Array<IssuedRequest> = issuedRequests();
    expect(requests).toHaveLength(3);
    expect(requests).toContainEqual({
      entityType: ServiceType.OpenTelemetry,
      ids: [SERVICE_ID],
    });
    expect(requests).toContainEqual({
      entityType: ServiceType.RealUserMonitor,
      ids: [RUM_ID],
    });
    expect(requests).toContainEqual({
      entityType: ServiceType.Host,
      ids: [HOST_ID],
    });
  });

  test("an expired hit whose refresh misses falls through to the general pass without asking its table again", async () => {
    const nowSpy: NowSpy = freezeNow(START_TIME);
    await TelemetryEntityNameResolver.resolve({
      ids: [RUM_ID],
      projectId: PROJECT_ID,
    });
    getListMock.mockClear();
    // The RUM application is gone from its table.
    tables[ServiceType.RealUserMonitor] = [];

    nowSpy.mockReturnValue(START_TIME + HIT_CACHE_TTL_IN_MS + 1);
    await expect(
      TelemetryEntityNameResolver.resolve({
        ids: [RUM_ID],
        projectId: PROJECT_ID,
      }),
    ).resolves.toEqual({});

    const types: Array<ServiceType> = requestedTypes();
    expect(types[0]).toBe(ServiceType.RealUserMonitor);
    expect(types[1]).toBe(ServiceType.OpenTelemetry);
    expect([...types].sort()).toEqual(
      [...TELEMETRY_ENTITY_RESOLUTION_ORDER].sort(),
    );
    expect(requestsFor(ServiceType.RealUserMonitor)).toHaveLength(1);

    // …and that full miss is now remembered.
    getListMock.mockClear();
    await TelemetryEntityNameResolver.resolve({
      ids: [RUM_ID],
      projectId: PROJECT_ID,
    });
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("an expired hit whose refresh misses can still resolve in another table", async () => {
    const nowSpy: NowSpy = freezeNow(START_TIME);
    await TelemetryEntityNameResolver.resolve({
      ids: [RUM_ID],
      projectId: PROJECT_ID,
    });
    tables[ServiceType.RealUserMonitor] = [];
    tables[ServiceType.Host]!.push(row(RUM_ID, { name: "now-a-host" }));

    nowSpy.mockReturnValue(START_TIME + HIT_CACHE_TTL_IN_MS + 1);
    const result: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [RUM_ID],
        projectId: PROJECT_ID,
      });
    expect(result[RUM_ID]).toEqual({
      id: RUM_ID,
      name: "now-a-host",
      entityType: ServiceType.Host,
      typeLabel: "Host",
    });
  });

  test("an expired hit of a type the caller does not allow is not used as a hint", async () => {
    const nowSpy: NowSpy = freezeNow(START_TIME);
    await TelemetryEntityNameResolver.resolve({
      ids: [RUM_ID],
      projectId: PROJECT_ID,
    });
    getListMock.mockClear();

    nowSpy.mockReturnValue(START_TIME + HIT_CACHE_TTL_IN_MS + 1);
    await expect(
      TelemetryEntityNameResolver.resolve({
        ids: [RUM_ID],
        projectId: PROJECT_ID,
        entityTypes: [ServiceType.OpenTelemetry],
      }),
    ).resolves.toEqual({});
    expect(issuedRequests()).toEqual([
      { entityType: ServiceType.OpenTelemetry, ids: [RUM_ID] },
    ]);
  });

  test("a caller's explicit hint wins over the expired hit's table", async () => {
    const nowSpy: NowSpy = freezeNow(START_TIME);
    await TelemetryEntityNameResolver.resolve({
      ids: [RUM_ID],
      projectId: PROJECT_ID,
    });
    getListMock.mockClear();

    nowSpy.mockReturnValue(START_TIME + HIT_CACHE_TTL_IN_MS + 1);
    const result: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [RUM_ID],
        projectId: PROJECT_ID,
        typeHints: { [RUM_ID]: ServiceType.Host },
      });
    expect(requestedTypes()[0]).toBe(ServiceType.Host);
    expect(result[RUM_ID]?.name).toBe("checkout-web");
  });
});

describe("TelemetryEntityNameResolver.resolve — non-UUID ids", () => {
  /*
   * Postgres rejects a malformed value in `_id IN (...)`, failing the whole
   * query. The fake below does the same, so an id such as a service *name*
   * that slipped into the id list would leave every valid id beside it
   * unresolved if the resolver sent it.
   */
  beforeEach(() => {
    getListMock.mockImplementation((...args: Array<unknown>) => {
      const getListArgs: GetListArgs = args[0] as GetListArgs;
      const invalid: Array<string> = includedIds(getListArgs.query._id).filter(
        (id: string): boolean => {
          return !ObjectID.isValidUUID(id);
        },
      );
      if (invalid.length > 0) {
        return Promise.reject(
          new Error(`invalid input syntax for type uuid: "${invalid[0]}"`),
        );
      }
      return fakeGetList(getListArgs);
    });
  });

  test.each([
    ["a service name", "checkout"],
    ["a dashed non-uuid", "not-a-uuid"],
    ["digits", "12345"],
    ["a uuid missing a digit", "11111111-0000-4000-8000-00000000000"],
    ["a uuid without dashes", "11111111000040008000000000000001"],
    ["a braced uuid", "{11111111-0000-4000-8000-000000000001}"],
  ])("%s is dropped without any request", async (_name: string, id: string) => {
    await expect(
      TelemetryEntityNameResolver.resolve({
        ids: [id],
        projectId: PROJECT_ID,
      }),
    ).resolves.toEqual({});
    expect(getListMock).not.toHaveBeenCalled();
    expect(missCacheKeys()).toEqual([]);
  });

  test("non-UUID ids do not poison the batch: the valid ids beside them still resolve", async () => {
    const result: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: ["checkout", SERVICE_ID, RUM_ID, PROJECT_ID, "frontend"],
        projectId: PROJECT_ID,
      });

    expect(Object.keys(result).sort()).toEqual(
      [SERVICE_ID, RUM_ID, PROJECT_ID].sort(),
    );
    expect(result[SERVICE_ID]?.name).toBe("checkout-api");
    expect(result[RUM_ID]?.name).toBe("checkout-web");
    expect(result[PROJECT_ID]).toEqual({
      id: PROJECT_ID,
      name: UNKNOWN_SERVICE_NAME,
      entityType: ServiceType.Unknown,
      typeLabel: "Service",
    });

    const sentIds: Array<string> = issuedRequests().flatMap(
      (request: IssuedRequest): Array<string> => {
        return request.ids;
      },
    );
    expect(sentIds.length).toBeGreaterThan(0);
    expect(sentIds).not.toContain("checkout");
    expect(sentIds).not.toContain("frontend");
    expect(sentIds).not.toContain(PROJECT_ID);
  });

  test("a non-UUID id with a type hint is dropped too", async () => {
    await expect(
      TelemetryEntityNameResolver.resolve({
        ids: ["checkout"],
        projectId: PROJECT_ID,
        typeHints: { checkout: ServiceType.RealUserMonitor },
      }),
    ).resolves.toEqual({});
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("a hinted valid id still resolves in one request next to a dropped one", async () => {
    const result: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: ["checkout", RUM_ID],
        projectId: PROJECT_ID,
        typeHints: {
          checkout: ServiceType.RealUserMonitor,
          [RUM_ID]: ServiceType.RealUserMonitor,
        },
      });
    expect(Object.keys(result)).toEqual([RUM_ID]);
    expect(issuedRequests()).toEqual([
      { entityType: ServiceType.RealUserMonitor, ids: [RUM_ID] },
    ]);
  });

  test("an upper-case UUID is still a valid id and is queried", async () => {
    await TelemetryEntityNameResolver.resolve({
      ids: [SERVICE_ID.toUpperCase()],
      projectId: PROJECT_ID,
      entityTypes: [ServiceType.OpenTelemetry],
    });
    expect(issuedRequests()).toEqual([
      {
        entityType: ServiceType.OpenTelemetry,
        ids: [SERVICE_ID.toUpperCase()],
      },
    ]);
  });

  test("the projectId still maps to Unknown Service even when it is not UUID-shaped", async () => {
    const result: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: ["project-slug", "checkout"],
        projectId: "project-slug",
      });
    expect(result).toEqual({
      "project-slug": {
        id: "project-slug",
        name: UNKNOWN_SERVICE_NAME,
        entityType: ServiceType.Unknown,
        typeLabel: "Service",
      },
    });
    expect(getListMock).not.toHaveBeenCalled();
  });
});
