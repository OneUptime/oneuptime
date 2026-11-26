import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";
import CappedListServer, {
  CappedListCall,
  namesSortingFirst,
} from "./CappedListServer";
import {
  SERVICE_SCOPE_FACET_KEY,
  TELEMETRY_SCOPE_KIND_FIELD,
  TELEMETRY_SCOPE_KINDS,
  TELEMETRY_SCOPE_SEARCH_PAGE_SIZE,
  TelemetryScopeKind,
  createTelemetryScopeChoicesAPI,
  decodeTelemetryScopeValue,
  encodeTelemetryScopeValue,
  getTelemetryScopeKind,
  getTelemetryScopeSearchKinds,
  readTelemetryResourceScopeHeldOptions,
  readTelemetryScopeChoices,
  searchTelemetryScope,
  takeFairShares,
  toTelemetryScopeKey,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetryResourceScope";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import Host from "../../../Models/DatabaseModels/Host";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import Service from "../../../Models/DatabaseModels/Service";
import Includes from "../../../Types/BaseDatabase/Includes";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import MultiSearch from "../../../Types/BaseDatabase/MultiSearch";
import Search from "../../../Types/BaseDatabase/Search";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { CloudResourceKind } from "../../../Types/Cloud/CloudResourceKind";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import { RESOURCE_FACET_CATALOG_KEYS } from "../../../Types/Telemetry/ResourceFacetCatalog";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import TelemetryEntityNameResolver from "../../../UI/Utils/Telemetry/TelemetryEntityNames";
import { getJestSpyOn } from "../../Spy";

/*
 * THE KINDS A TELEMETRY SCOPE HOLDS, HOW THEY ARE SEARCHED AND HOW WHAT IT
 * HOLDS IS NAMED (#10921).
 *
 * Logs > Insights' scope picker searches the services and every kind of
 * resource the page offers on the server, and names what its scope holds
 * by the ids it holds (TelemetryResourceScope). These pin the parts: the
 * kinds and their tables - the very tables and identifiers the explorers'
 * sidebars list them from on the server - a scope value's shape, the fair
 * share of a page each kind gets, a search's reads, and the naming of
 * held values: a service, another entity the logs name as their own, a
 * resource of a kind, one gone. ModelAPI answers from a project faked
 * whole (CappedListServer).
 */

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const LATE_ID: string = "a1000000-0000-4000-8000-0000000000aa";
const DELETED_ID: string = "a1000000-0000-4000-8000-0000000000dd";
const RUM_ID: string = "a2000000-0000-4000-8000-0000000000aa";
const LATE_HOST_ID: string = "b1000000-0000-4000-8000-0000000000aa";
const ARCHIVED_HOST_ID: string = "b1000000-0000-4000-8000-0000000000ac";
const DELETED_HOST_ID: string = "b1000000-0000-4000-8000-0000000000dd";
const ENVIRONMENT_ID: string = "c1000000-0000-4000-8000-0000000000aa";

let server: CappedListServer;

beforeEach(() => {
  server = new CappedListServer();
  TelemetryEntityNameResolver.clearCache();
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
  getJestSpyOn(PermissionGate, "canReadColumn").mockReturnValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function kindOf(facetKey: string): TelemetryScopeKind {
  const kind: TelemetryScopeKind | undefined = getTelemetryScopeKind(facetKey);

  expect(kind).toBeDefined();

  return kind!;
}

describe("the kinds a scope holds", () => {
  test("services first, then every resource kind of the catalog, in its order", () => {
    expect(
      TELEMETRY_SCOPE_KINDS.map((kind: TelemetryScopeKind): string => {
        return kind.facetKey;
      }),
    ).toEqual([SERVICE_SCOPE_FACET_KEY, ...RESOURCE_FACET_CATALOG_KEYS]);
    expect(kindOf(SERVICE_SCOPE_FACET_KEY).modelType).toBe(Service);
    expect(kindOf("hostId").modelType).toBe(Host);
    expect(kindOf("kubernetesClusterId").modelType).toBe(KubernetesCluster);
    expect(kindOf("rumApplicationId").modelType).toBe(RumApplication);
  });

  test("each kind's table has its name, its identifier and an archive switch", () => {
    for (const kind of TELEMETRY_SCOPE_KINDS) {
      const model: BaseModel = new kind.modelType();

      expect(model.hasColumn("name")).toBe(true);
      expect(model.hasColumn("isArchived")).toBe(true);

      if (kind.identifierField) {
        expect(model.hasColumn(kind.identifierField)).toBe(true);
      }
    }
  });

  test("each kind's label is a key every Dashboard language words", () => {
    const localesDirectory: string = path.resolve(
      __dirname,
      "../../../../App/FeatureSet/Dashboard/src/Locales",
    );

    for (const file of fs.readdirSync(localesDirectory)) {
      if (!file.endsWith(".json")) {
        continue;
      }

      const locale: Record<string, unknown> = JSON.parse(
        fs.readFileSync(path.join(localesDirectory, file), "utf8"),
      ) as Record<string, unknown>;

      for (const kind of TELEMETRY_SCOPE_KINDS) {
        expect([file, typeof locale[kind.label]]).toEqual([file, "string"]);
      }
    }
  });

  /*
   * The server lists each kind for the explorers' sidebars from a table of
   * its own (ResourceFacetResolver): the same tables, identifiers and base
   * queries here, so the picker finds a resource exactly as a sidebar's
   * search does.
   */
  test("each kind is searched by the identifier, and within the rows, the server's sidebars list it by", () => {
    const resolver: string = fs
      .readFileSync(
        path.resolve(
          __dirname,
          "../../../Server/Utils/Telemetry/ResourceFacetResolver.ts",
        ),
        "utf8",
      )
      .replace(/\s+/g, " ");

    for (const kind of TELEMETRY_SCOPE_KINDS) {
      if (kind.facetKey === SERVICE_SCOPE_FACET_KEY) {
        expect(resolver).toContain('["primaryEntityId", serviceListing]');
        expect(resolver).toContain("identifierField: null, };");
        continue;
      }

      const entry: RegExpMatchArray | null = resolver.match(
        new RegExp(
          `\\[ ?"${kind.facetKey}", \\{ service: (\\w+)Service, identifierField: (null|"(\\w+)")`,
        ),
      );

      expect([kind.facetKey, entry]).not.toEqual([kind.facetKey, null]);
      expect(entry![1]).toBe(new kind.modelType().constructor.name);
      expect([kind.facetKey, entry![3] || null]).toEqual([
        kind.facetKey,
        kind.identifierField,
      ]);
    }

    // Cloud resources: environments only, on both sides.
    expect(resolver).toContain(
      "baseQuery: { cloudResourceKind: CloudResourceKind.Environment }",
    );
    expect(kindOf("cloudResourceId").baseQuery).toEqual({
      cloudResourceKind: CloudResourceKind.Environment,
    });
  });

  test("a facet key that is no kind has none", () => {
    expect(getTelemetryScopeKind("monitorId")).toBeUndefined();
    expect(getTelemetryScopeKind("")).toBeUndefined();
  });
});

describe("a scope's value", () => {
  test("is its kind's facet key, then the record's id", () => {
    expect(encodeTelemetryScopeValue("hostId", LATE_HOST_ID)).toBe(
      `hostId:${LATE_HOST_ID}`,
    );
    expect(decodeTelemetryScopeValue(`hostId:${LATE_HOST_ID}`)).toEqual({
      facetKey: "hostId",
      id: LATE_HOST_ID,
    });
  });

  test("is split at its first colon, and one with no facet key has none", () => {
    expect(decodeTelemetryScopeValue("hostId:a:b")).toEqual({
      facetKey: "hostId",
      id: "a:b",
    });
    expect(decodeTelemetryScopeValue(LATE_ID)).toEqual({
      facetKey: "",
      id: LATE_ID,
    });
    expect(decodeTelemetryScopeValue(`:${LATE_ID}`)).toEqual({
      facetKey: "",
      id: `:${LATE_ID}`,
    });
  });

  test("is known by its whole value, lower-cased", () => {
    expect(toTelemetryScopeKey(` hostId:${LATE_HOST_ID.toUpperCase()} `)).toBe(
      `hostid:${LATE_HOST_ID}`,
    );
  });
});

describe("the kinds a page searches", () => {
  test("services always, the kinds asked for and the kinds the scope holds, each once, in the kinds' order", () => {
    expect(
      getTelemetryScopeSearchKinds({ resourceFacetKeys: [], values: [] }),
    ).toEqual([SERVICE_SCOPE_FACET_KEY]);

    expect(
      getTelemetryScopeSearchKinds({
        resourceFacetKeys: ["kubernetesClusterId", "hostId", "hostId"],
        values: [
          `rumApplicationId:${RUM_ID}`,
          `hostId:${LATE_HOST_ID}`,
          `primaryEntityId:${LATE_ID}`,
        ],
      }),
    ).toEqual([
      SERVICE_SCOPE_FACET_KEY,
      "hostId",
      "kubernetesClusterId",
      "rumApplicationId",
    ]);
  });

  test("a facet key that names no kind is left out", () => {
    expect(
      getTelemetryScopeSearchKinds({
        resourceFacetKeys: ["monitorId", "statusCode"],
        values: [`severityText:Error`, LATE_ID],
      }),
    ).toEqual([SERVICE_SCOPE_FACET_KEY]);
  });
});

describe("a fair share of a page for each kind", () => {
  test("one of each in turn until the page is full, each kind in its order", () => {
    const shares: Array<Array<number>> = takeFairShares(
      [
        Array.from({ length: 100 }, (_: unknown, index: number) => {
          return index;
        }),
        Array.from({ length: 10 }, (_: unknown, index: number) => {
          return 1000 + index;
        }),
        [],
        Array.from({ length: 100 }, (_: unknown, index: number) => {
          return 2000 + index;
        }),
      ],
      50,
    );

    expect(
      shares.map((share: Array<number>): number => {
        return share.length;
      }),
    ).toEqual([20, 10, 0, 20]);
    // Each kind's own first ones, in their order.
    expect(shares[0]!.slice(0, 3)).toEqual([0, 1, 2]);
    expect(shares[1]).toEqual(
      Array.from({ length: 10 }, (_: unknown, index: number) => {
        return 1000 + index;
      }),
    );
  });

  test("everything, when it all fits", () => {
    expect(takeFairShares([[1, 2], [3]], 50)).toEqual([[1, 2], [3]]);
  });

  test("nothing for a page of none, or kinds that found none", () => {
    expect(takeFairShares([[1, 2], [3]], 0)).toEqual([[], []]);
    expect(takeFairShares([[], []], 50)).toEqual([[], []]);
    expect(takeFairShares([], 50)).toEqual([]);
  });
});

describe("one search over the kinds", () => {
  beforeEach(() => {
    server.add(
      Service,
      namesSortingFirst(LIMIT_PER_PROJECT + 50).map(
        (name: string): Record<string, unknown> => {
          return { _id: ObjectID.generate().toString(), name: name };
        },
      ),
    );
    server.add(Service, [
      { _id: LATE_ID, name: "WB kiosk api", serviceColor: "#22c55e" },
    ]);
    server.add(Host, [
      {
        _id: LATE_HOST_ID,
        name: "WB kiosk host",
        hostIdentifier: "kiosk-01",
      },
      {
        _id: ARCHIVED_HOST_ID,
        name: "WB kiosk old host",
        hostIdentifier: "kiosk-00",
        isArchived: true,
      },
    ]);
    server.add(CloudResource, [
      {
        _id: ENVIRONMENT_ID,
        name: "WB kiosk prod",
        resourceIdentifier: "env-1",
        cloudResourceKind: CloudResourceKind.Environment,
      },
      {
        _id: ObjectID.generate().toString(),
        name: "WB kiosk bucket",
        resourceIdentifier: "bucket-1",
        cloudResourceKind: "Bucket",
      },
    ]);
    server.install();
  });

  test("reads a page of each kind, by name and identifier, sorted by name, archived kept and read with their switch", async () => {
    const found: { records: Array<Service>; count: number } =
      await searchTelemetryScope({
        kinds: [SERVICE_SCOPE_FACET_KEY, "hostId", "cloudResourceId"],
        searchText: "WB kiosk",
      });

    expect(
      found.records.map((record: Service): string => {
        return `${record.name}|${String(record._id)}`;
      }),
    ).toEqual([
      `WB kiosk api|primaryEntityId:${LATE_ID}`,
      `WB kiosk host|hostId:${LATE_HOST_ID}`,
      `WB kiosk old host|hostId:${ARCHIVED_HOST_ID}`,
      // Environments only: a bucket is never a row's own resource.
      `WB kiosk prod|cloudResourceId:${ENVIRONMENT_ID}`,
    ]);
    expect(found.count).toBe(4);

    const kindsOf: Array<unknown> = found.records.map((record: Service) => {
      return (record as unknown as Record<string, unknown>)[
        TELEMETRY_SCOPE_KIND_FIELD
      ];
    });

    expect(kindsOf).toEqual([
      SERVICE_SCOPE_FACET_KEY,
      "hostId",
      "hostId",
      "cloudResourceId",
    ]);
    expect(
      (found.records[2] as unknown as Record<string, unknown>)["isArchived"],
    ).toBe(true);
    expect(
      String(
        (found.records[0] as unknown as Record<string, unknown>)[
          "serviceColor"
        ],
      ),
    ).toBe("#22c55e");

    const serviceRead: CappedListCall = server.callsFor(Service)[0]!;

    expect(serviceRead.query["name"]).toBeInstanceOf(Search);
    expect(serviceRead.limit).toBe(TELEMETRY_SCOPE_SEARCH_PAGE_SIZE);
    expect(serviceRead.sort).toEqual({ name: SortOrder.Ascending });
    expect(serviceRead.select).toEqual({
      _id: true,
      name: true,
      serviceColor: true,
      isArchived: true,
    });

    const hostRead: CappedListCall = server.callsFor(Host)[0]!;
    const hostSearch: MultiSearch = Object.values(hostRead.query).find(
      (value: unknown): boolean => {
        return value instanceof MultiSearch;
      },
    ) as MultiSearch;

    expect(hostSearch.fields).toEqual(["name", "hostIdentifier"]);
    expect(hostRead.query["isArchived"]).toBeUndefined();
    expect(hostRead.select).toEqual({
      _id: true,
      name: true,
      hostIdentifier: true,
      isArchived: true,
    });

    expect(server.callsFor(CloudResource)[0]!.query["cloudResourceKind"]).toBe(
      CloudResourceKind.Environment,
    );
  });

  test("with nothing typed, a page of each kind, no search", async () => {
    await searchTelemetryScope({
      kinds: [SERVICE_SCOPE_FACET_KEY, "hostId"],
      searchText: "",
    });

    expect(server.callsFor(Service)[0]!.query).toEqual({});
    expect(server.callsFor(Host)[0]!.query).toEqual({});
  });

  test("never reads a kind it was not asked for, nor the first 10,000 of one", async () => {
    await searchTelemetryScope({
      kinds: [SERVICE_SCOPE_FACET_KEY],
      searchText: "WB",
    });

    expect(server.callsFor(Host)).toHaveLength(0);
    expect(server.callsFor(CloudResource)).toHaveLength(0);

    for (const call of server.calls) {
      expect(call.limit).toBeLessThanOrEqual(TELEMETRY_SCOPE_SEARCH_PAGE_SIZE);
    }
  });

  test("a kind the reader may not read finds nothing; the other kinds' records are still offered", async () => {
    const list: typeof server.list = server.list.bind(server);

    jest.spyOn(server, "list").mockImplementation(((
      options: Parameters<typeof server.list>[0],
    ) => {
      if (options.modelType === Host) {
        throw new Error("You do not have permission to read hosts.");
      }

      return list(options);
    }) as never);

    const found: { records: Array<Service>; count: number } =
      await searchTelemetryScope({
        kinds: [SERVICE_SCOPE_FACET_KEY, "hostId"],
        searchText: "WB kiosk",
      });

    expect(
      found.records.map((record: Service): string => {
        return record.name || "";
      }),
    ).toEqual(["WB kiosk api"]);
  });

  test("a reader who may not read a kind's archive switch is never asked for it", async () => {
    jest.mocked(PermissionGate.canReadColumn).mockImplementation(((
      model: unknown,
      column: string,
    ): boolean => {
      return !(model instanceof Host && column === "isArchived");
    }) as never);

    await searchTelemetryScope({
      kinds: [SERVICE_SCOPE_FACET_KEY, "hostId"],
      searchText: "WB kiosk",
    });

    expect(server.callsFor(Host)[0]!.select["isArchived"]).toBeUndefined();
    expect(server.callsFor(Service)[0]!.select["isArchived"]).toBe(true);
  });

  test("a page of 50 across the kinds, a fair share each", async () => {
    server.add(
      Host,
      namesSortingFirst(LIMIT_PER_PROJECT + 50, "AH").map(
        (name: string): Record<string, unknown> => {
          return { _id: ObjectID.generate().toString(), name: name };
        },
      ),
    );

    const found: { records: Array<Service>; count: number } =
      await searchTelemetryScope({
        kinds: [SERVICE_SCOPE_FACET_KEY, "hostId"],
        searchText: "",
      });

    expect(found.records).toHaveLength(TELEMETRY_SCOPE_SEARCH_PAGE_SIZE);
    expect(
      found.records.filter((record: Service): boolean => {
        return String(record._id).startsWith("hostId:");
      }),
    ).toHaveLength(TELEMETRY_SCOPE_SEARCH_PAGE_SIZE / 2);
    // Every match counted, of both kinds: past either one's first 10,000.
    expect(found.count).toBeGreaterThan(2 * LIMIT_PER_PROJECT);
  });
});

describe("what a scope holds, named by its values", () => {
  beforeEach(() => {
    server.add(Service, [{ _id: LATE_ID, name: "WB kiosk api" }]);
    server.add(RumApplication, [{ _id: RUM_ID, name: "checkout-web" }]);
    server.add(Host, [
      { _id: LATE_HOST_ID, name: "WB kiosk host", hostIdentifier: "kiosk-01" },
      {
        _id: ARCHIVED_HOST_ID,
        name: "",
        hostIdentifier: "kiosk-00",
        isArchived: true,
      },
    ]);
    server.install();
  });

  test("every value is answered: a service, the project's own, another entity, a host, an archived one, one gone, one of no kind", async () => {
    const values: Array<string> = [
      `primaryEntityId:${LATE_ID}`,
      `primaryEntityId:${PROJECT_ID}`,
      `primaryEntityId:${RUM_ID}`,
      `primaryEntityId:${DELETED_ID}`,
      `hostId:${LATE_HOST_ID}`,
      `hostId:${ARCHIVED_HOST_ID}`,
      `hostId:${DELETED_HOST_ID}`,
      `monitorId:${LATE_ID}`,
    ];

    const named: Map<string, DropdownOption> =
      await readTelemetryResourceScopeHeldOptions({
        values: values,
        projectId: PROJECT_ID,
      });

    const read: (value: string) => DropdownOption = (
      value: string,
    ): DropdownOption => {
      return named.get(toTelemetryScopeKey(value))!;
    };

    expect(read(values[0]!)).toMatchObject({
      value: values[0],
      label: "WB kiosk api",
      isUserContent: true,
    });
    expect(read(values[1]!)).toMatchObject({
      value: values[1],
      label: "Unknown Service",
      isUserContent: false,
    });
    expect(read(values[2]!)).toMatchObject({
      value: values[2],
      label: "checkout-web",
    });

    for (const gone of [values[3]!, values[6]!, values[7]!]) {
      expect(read(gone)).toEqual({
        value: gone,
        label: "No longer available",
        isUserContent: false,
        isNotFound: true,
      });
    }

    expect(read(values[4]!)).toEqual({
      value: values[4],
      label: "WB kiosk host",
      isUserContent: true,
    });
    // No name: named by its identifier, and marked.
    expect(read(values[5]!)).toEqual({
      value: values[5],
      label: "kiosk-00",
      isUserContent: true,
      isArchived: true,
    });
  });

  test("a resource kind's values are read by their ids, in pages of 500, never a list", async () => {
    const values: Array<string> = Array.from({ length: 600 }, (): string => {
      return `hostId:${ObjectID.generate().toString()}`;
    });

    await readTelemetryResourceScopeHeldOptions({
      values: [...values, `hostId:${LATE_HOST_ID}`],
      projectId: PROJECT_ID,
    });

    const reads: Array<CappedListCall> = server.callsFor(Host);

    expect(reads).toHaveLength(2);

    for (const call of reads) {
      expect(call.query["_id"]).toBeInstanceOf(Includes);
      expect(call.limit).toBeLessThanOrEqual(500);
    }
  });

  test("each value once, its own letter case kept in its option", async () => {
    const value: string = `hostId:${LATE_HOST_ID.toUpperCase()}`;

    const named: Map<string, DropdownOption> =
      await readTelemetryResourceScopeHeldOptions({
        values: [value, value.toLowerCase()],
        projectId: PROJECT_ID,
      });

    expect(named.size).toBe(1);
    expect(named.get(toTelemetryScopeKey(value))!.value).toBe(value);
    expect(named.get(toTelemetryScopeKey(value))!.label).toBe("WB kiosk host");
  });
});

describe("the picker's reads, answered over its kinds", () => {
  beforeEach(() => {
    server.add(Service, [{ _id: LATE_ID, name: "WB kiosk api" }]);
    server.add(Host, [
      { _id: LATE_HOST_ID, name: "WB kiosk host", hostIdentifier: "kiosk-01" },
    ]);
    server.add(Monitor, [{ _id: LATE_ID, name: "WB kiosk monitor" }]);
    server.install();
  });

  test("a read of what it holds names each value it can, and leaves out one gone for the picker to call not found", async () => {
    const result: ListResult<BaseModel> = await readTelemetryScopeChoices(
      {
        modelType: Service,
        query: {
          _id: new Includes([
            `hostId:${LATE_HOST_ID}`,
            `hostId:${DELETED_HOST_ID}`,
            `primaryEntityId:${LATE_ID}`,
          ]),
        },
        select: { _id: true, name: true },
        sort: {},
        limit: 3,
        skip: 0,
      } as never,
      [SERVICE_SCOPE_FACET_KEY],
    );

    expect(
      result.data.map((record: BaseModel): string => {
        return `${String(record._id)}|${(record as Service).name}`;
      }),
    ).toEqual([
      `hostId:${LATE_HOST_ID}|WB kiosk host`,
      `primaryEntityId:${LATE_ID}|WB kiosk api`,
    ]);
  });

  test("a search is one search of each kind it is handed", async () => {
    const result: ListResult<BaseModel> = await readTelemetryScopeChoices(
      {
        modelType: Service,
        query: { name: new Search("WB kiosk") },
        select: { _id: true, name: true },
        sort: { name: "Ascending" },
        limit: 50,
        skip: 0,
      } as never,
      [SERVICE_SCOPE_FACET_KEY, "hostId"],
    );

    expect(
      result.data.map((record: BaseModel): string => {
        return (record as Service).name || "";
      }),
    ).toEqual(["WB kiosk api", "WB kiosk host"]);
  });

  test("any other model is read as ModelAPI reads it", async () => {
    const result: ListResult<BaseModel> = await readTelemetryScopeChoices(
      {
        modelType: Monitor,
        query: { name: new Search("WB kiosk") },
        select: { _id: true, name: true },
        sort: {},
        limit: 50,
        skip: 0,
      } as never,
      [SERVICE_SCOPE_FACET_KEY],
    );

    expect(result.data).toHaveLength(1);
    expect(server.callsFor(Monitor)).toHaveLength(1);
  });

  test("the API answers its list reads over its kinds, and hands anything else to the shared ModelAPI", async () => {
    const api: typeof ModelAPI = createTelemetryScopeChoicesAPI([
      SERVICE_SCOPE_FACET_KEY,
      "hostId",
    ]);

    const result: ListResult<BaseModel> = await api.getList<BaseModel>({
      modelType: Service,
      query: { name: new Search("WB kiosk") },
      select: { _id: true, name: true },
      sort: {},
      limit: 50,
      skip: 0,
    } as never);

    expect(result.data).toHaveLength(2);
    expect(api.getCommonHeaders).toBe(ModelAPI.getCommonHeaders);
  });
});
