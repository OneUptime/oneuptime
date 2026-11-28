import CappedListServer, {
  CappedListCall,
  namesSortingFirst,
} from "../../../App/Dashboard/CappedListServer";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Host from "../../../../Models/DatabaseModels/Host";
import Incident from "../../../../Models/DatabaseModels/Incident";
import RumApplication from "../../../../Models/DatabaseModels/RumApplication";
import Service from "../../../../Models/DatabaseModels/Service";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import ObjectID from "../../../../Types/ObjectID";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import TelemetryEntityNameResolver, {
  MISS_CACHE_TTL_IN_MS,
  TelemetryEntityChipMarks,
  TelemetryEntityLookupResult,
  TelemetryEntityNameMap,
  getTelemetryEntityChipMarks,
  withTelemetryEntityChipMarks,
} from "../../../../UI/Utils/Telemetry/TelemetryEntityNames";
import ModelAPI, { ListResult } from "../../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../../UI/Utils/PermissionGate";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHICH IDS NAME NOTHING ANY MORE, AS THE ENTITY RESOLVER SETTLES THEM
 * (#11213).
 *
 * A chip a link or a saved view brought names a service, a host or a
 * cluster by its id. Once the record is deleted - or out of the reader's
 * reach - every read answers nothing, and the explorers' chips read as the
 * raw id. The resolver says which ids it settled as naming nothing: every
 * table it asked about them answered, and none had them. An id a table
 * failed to answer for is never among them: it may be there. And it says
 * which records it found are archived, to a reader who may read their
 * archive switch - the server refuses a whole read that selects a column
 * its reader may not. ModelAPI answers from a project faked whole
 * (CappedListServer), its services past the first 10,000.
 */

const PROJECT_ID: string = "9e1b6b0e-0000-4000-8000-000000000213";
const LATE_SERVICE_ID: string = "a1000000-0000-4000-8000-0000000000a1";
const ARCHIVED_SERVICE_ID: string = "a1000000-0000-4000-8000-0000000000a2";
const UNNAMED_HOST_ID: string = "b2000000-0000-4000-8000-0000000000b1";
const DELETED_ID: string = "dead0000-0000-4000-8000-00000000dead";
const OTHER_DELETED_ID: string = "dead0000-0000-4000-8000-00000000d00d";

let server: CappedListServer;
// The tables whose reads fail, while listed.
let failing: Set<unknown>;
let now: number = 1_700_000_000_000;

const lookup: (data: {
  ids: Array<string>;
  typeHints?: Record<string, ServiceType> | undefined;
  entityTypes?: Array<ServiceType> | undefined;
}) => Promise<TelemetryEntityLookupResult> = (data: {
  ids: Array<string>;
  typeHints?: Record<string, ServiceType> | undefined;
  entityTypes?: Array<ServiceType> | undefined;
}): Promise<TelemetryEntityLookupResult> => {
  return TelemetryEntityNameResolver.lookup({
    ids: data.ids,
    projectId: PROJECT_ID,
    typeHints: data.typeHints,
    entityTypes: data.entityTypes,
  });
};

beforeEach(() => {
  TelemetryEntityNameResolver.clearCache();
  failing = new Set<unknown>();
  now = 1_700_000_000_000;
  jest.spyOn(Date, "now").mockImplementation((): number => {
    return now;
  });

  server = new CappedListServer();
  server.add(
    Service,
    namesSortingFirst(LIMIT_PER_PROJECT + 50).map(
      (name: string): Record<string, unknown> => {
        return { _id: ObjectID.generate().toString(), name: name };
      },
    ),
  );
  server.add(Service, [
    { _id: LATE_SERVICE_ID, name: "wbkiosk-payments" },
    { _id: ARCHIVED_SERVICE_ID, name: "wbkiosk-legacy", isArchived: true },
  ]);
  // A host with no name and no identifier: there, all the same.
  server.add(Host, [{ _id: UNNAMED_HOST_ID, name: "", hostIdentifier: "" }]);

  jest.spyOn(ModelAPI, "getList").mockImplementation((async (
    options: Parameters<typeof ModelAPI.getList<BaseModel>>[0],
  ): Promise<ListResult<BaseModel>> => {
    if (failing.has(options.modelType)) {
      throw new Error("You may not read these.");
    }

    // As the server answers: a read that selects a column its reader may not read is refused whole.
    const model: BaseModel = new options.modelType();

    for (const column of Object.keys(options.select || {})) {
      if (!PermissionGate.canReadColumn(model, column)) {
        throw new Error(`You may not read ${column} of these.`);
      }
    }

    return server.list(options);
  }) as never);
  /*
   * A member who reads the project's services and hosts reads their
   * archive switch too (its read permissions are the tables'); one test
   * takes it away.
   */
  jest.spyOn(PermissionGate, "canReadColumn").mockReturnValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("TelemetryEntityNameResolver.lookup - the ids that name nothing", () => {
  test("an id no table holds is settled as naming nothing, once every table answered", async () => {
    const result: TelemetryEntityLookupResult = await lookup({
      ids: [DELETED_ID, LATE_SERVICE_ID],
    });

    expect(result.names[LATE_SERVICE_ID]?.name).toBe("wbkiosk-payments");
    expect(result.notFound).toEqual([DELETED_ID]);

    // Service first, then every other table, each asked about it.
    const askedTables: Set<string> = new Set<string>(
      server.calls.map((call: CappedListCall): string => {
        return new (call.modelType as { new (): BaseModel })().tableName || "";
      }),
    );

    expect(askedTables.has("Service")).toBe(true);
    expect(askedTables.has("RumApplication")).toBe(true);
    expect(askedTables.has("Host")).toBe(true);
  });

  test("a service past the project's 10,000th is named, never said to be gone", async () => {
    const result: TelemetryEntityLookupResult = await lookup({
      ids: [LATE_SERVICE_ID],
    });

    expect(result.notFound).toEqual([]);
    expect(result.names[LATE_SERVICE_ID]?.name).toBe("wbkiosk-payments");
  });

  test("an id a table failed to answer for is never said to be gone: it may be there", async () => {
    failing.add(Host);

    const result: TelemetryEntityLookupResult = await lookup({
      ids: [DELETED_ID],
    });

    expect(result.names[DELETED_ID]).toBeUndefined();
    expect(result.notFound).toEqual([]);

    // Nor while that miss is remembered.
    const again: TelemetryEntityLookupResult = await lookup({
      ids: [DELETED_ID],
    });

    expect(again.notFound).toEqual([]);
  });

  test("a hinted id that its table and every other answered without is gone", async () => {
    const result: TelemetryEntityLookupResult = await lookup({
      ids: [DELETED_ID],
      typeHints: { [DELETED_ID]: ServiceType.RealUserMonitor },
    });

    expect(result.notFound).toEqual([DELETED_ID]);
    expect(
      server.callsFor(RumApplication as { new (): BaseModel }).length,
    ).toBeGreaterThan(0);
  });

  test("a hinted id whose own table failed is not settled, however the rest answered", async () => {
    failing.add(RumApplication);

    const result: TelemetryEntityLookupResult = await lookup({
      ids: [DELETED_ID],
      typeHints: { [DELETED_ID]: ServiceType.RealUserMonitor },
    });

    expect(result.notFound).toEqual([]);
  });

  test("only the tables asked about count: Service-only, gone from Service is gone", async () => {
    const result: TelemetryEntityLookupResult = await lookup({
      ids: [DELETED_ID],
      entityTypes: [ServiceType.OpenTelemetry],
    });

    expect(result.notFound).toEqual([DELETED_ID]);
    expect(
      server.calls.every((call: CappedListCall): boolean => {
        return call.modelType === Service;
      }),
    ).toBe(true);
  });

  test("a row with no name is there all the same: neither named nor gone", async () => {
    const result: TelemetryEntityLookupResult = await lookup({
      ids: [UNNAMED_HOST_ID],
      typeHints: { [UNNAMED_HOST_ID]: ServiceType.Host },
    });

    expect(result.names[UNNAMED_HOST_ID]).toBeUndefined();
    expect(result.notFound).toEqual([]);
  });

  test("the project's own id is the Unknown Service, never gone", async () => {
    const result: TelemetryEntityLookupResult = await lookup({
      ids: [PROJECT_ID],
    });

    expect(result.names[PROJECT_ID]?.entityType).toBe(ServiceType.Unknown);
    expect(result.notFound).toEqual([]);
  });

  test("a settled miss is remembered: asked again soon, it is gone without a read", async () => {
    await lookup({ ids: [DELETED_ID] });

    const readsBefore: number = server.calls.length;
    const again: TelemetryEntityLookupResult = await lookup({
      ids: [DELETED_ID],
    });

    expect(again.notFound).toEqual([DELETED_ID]);
    expect(server.calls.length).toBe(readsBefore);

    // Once the miss is old, it is read again - and still gone.
    now += MISS_CACHE_TTL_IN_MS + 1;

    const later: TelemetryEntityLookupResult = await lookup({
      ids: [DELETED_ID],
    });

    expect(later.notFound).toEqual([DELETED_ID]);
    expect(server.calls.length).toBeGreaterThan(readsBefore);
  });

  test("several gone at once, each said once, in order", async () => {
    const result: TelemetryEntityLookupResult = await lookup({
      ids: [OTHER_DELETED_ID, DELETED_ID, DELETED_ID],
    });

    expect(result.notFound).toEqual([DELETED_ID, OTHER_DELETED_ID].sort());
  });

  test("resolve() answers the names alone, as it always did", async () => {
    const names: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [DELETED_ID, LATE_SERVICE_ID],
        projectId: PROJECT_ID,
      });

    expect(Object.keys(names)).toEqual([LATE_SERVICE_ID]);
  });
});

describe("TelemetryEntityNameResolver.lookup - archived records", () => {
  test("a record read as archived is named, and marked archived", async () => {
    const result: TelemetryEntityLookupResult = await lookup({
      ids: [ARCHIVED_SERVICE_ID, LATE_SERVICE_ID],
    });

    expect(result.names[ARCHIVED_SERVICE_ID]).toMatchObject({
      name: "wbkiosk-legacy",
      isArchived: true,
    });
    expect(result.names[LATE_SERVICE_ID]?.isArchived).toBeUndefined();
    expect(result.notFound).toEqual([]);
  });

  test("whether a record is archived is read only of the tables whose records can be", async () => {
    await lookup({
      ids: [DELETED_ID],
      typeHints: { [DELETED_ID]: ServiceType.Incident },
    });

    const incidentRead: CappedListCall | undefined = server.callsFor(
      Incident as { new (): BaseModel },
    )[0];

    expect(incidentRead?.select).toEqual({ _id: true, title: true });
    expect(server.callsFor(Service)[0]?.select).toEqual({
      _id: true,
      name: true,
      isArchived: true,
    });
  });

  test("a reader who may not read a table's archive switch is never asked for it: its records are still named, unmarked", async () => {
    jest.mocked(PermissionGate.canReadColumn).mockImplementation(((
      model: unknown,
      column: string,
    ): boolean => {
      return !(model instanceof Service && column === "isArchived");
    }) as never);

    const result: TelemetryEntityLookupResult = await lookup({
      ids: [ARCHIVED_SERVICE_ID, LATE_SERVICE_ID],
    });

    expect(result.names[ARCHIVED_SERVICE_ID]?.name).toBe("wbkiosk-legacy");
    expect(result.names[ARCHIVED_SERVICE_ID]?.isArchived).toBeUndefined();
    expect(result.names[LATE_SERVICE_ID]?.name).toBe("wbkiosk-payments");
    expect(result.notFound).toEqual([]);

    expect(server.callsFor(Service).length).toBeGreaterThan(0);

    for (const call of server.callsFor(Service)) {
      expect(call.select["isArchived"]).toBeUndefined();
    }
  });
});

describe("getTelemetryEntityChipMarks - what a chip naming an entity is drawn as", () => {
  const names: TelemetryEntityNameMap = {
    [LATE_SERVICE_ID]: {
      id: LATE_SERVICE_ID,
      name: "wbkiosk-payments",
      entityType: ServiceType.OpenTelemetry,
      typeLabel: "Service",
    },
    [ARCHIVED_SERVICE_ID]: {
      id: ARCHIVED_SERVICE_ID,
      name: "wbkiosk-legacy",
      entityType: ServiceType.OpenTelemetry,
      typeLabel: "Service",
      isArchived: true,
    },
  };
  const notFound: ReadonlySet<string> = new Set<string>([DELETED_ID]);

  test.each<
    [
      string,
      Parameters<typeof getTelemetryEntityChipMarks>[0],
      TelemetryEntityChipMarks,
    ]
  >([
    [
      "gone, by every read",
      { id: DELETED_ID, names, notFound },
      { isNotFound: true },
    ],
    [
      "gone, written with spaces round it",
      { id: ` ${DELETED_ID} `, names, notFound },
      { isNotFound: true },
    ],
    ["named by the lookup", { id: LATE_SERVICE_ID, names, notFound }, {}],
    [
      "archived, by the lookup",
      { id: ARCHIVED_SERVICE_ID, names, notFound },
      { isArchived: true },
    ],
    [
      "named by something else (a loaded service), though the lookup gave up",
      { id: DELETED_ID, knownName: "checkout", names, notFound },
      {},
    ],
    [
      "named by something else that says it is archived",
      {
        id: DELETED_ID,
        knownName: "checkout",
        isKnownArchived: true,
        names,
        notFound,
      },
      { isArchived: true },
    ],
    [
      "not looked up yet, or still in flight",
      { id: OTHER_DELETED_ID, names, notFound },
      {},
    ],
    ["with no lookup at all", { id: DELETED_ID }, {}],
  ])(
    "%s",
    (
      _case: string,
      data: Parameters<typeof getTelemetryEntityChipMarks>[0],
      expected: TelemetryEntityChipMarks,
    ) => {
      expect(getTelemetryEntityChipMarks(data)).toEqual(expected);
    },
  );

  test("marking keeps the chip as it was, and takes off marks it no longer has", () => {
    const chip: {
      facetKey: string;
      value: string;
      isNotFound?: boolean | undefined;
      isArchived?: boolean | undefined;
    } = { facetKey: "primaryEntityId", value: DELETED_ID };

    // Nothing to say: the same chip.
    expect(withTelemetryEntityChipMarks(chip, {})).toBe(chip);

    const gone: typeof chip = withTelemetryEntityChipMarks(chip, {
      isNotFound: true,
    });

    expect(gone).toEqual({ ...chip, isNotFound: true });
    expect(chip.isNotFound).toBeUndefined();

    // Named since: gone no more.
    const named: typeof chip = withTelemetryEntityChipMarks(gone, {});

    expect("isNotFound" in named).toBe(false);
    expect(named.value).toBe(DELETED_ID);

    expect(withTelemetryEntityChipMarks(gone, { isArchived: true })).toEqual({
      ...chip,
      isArchived: true,
    });
  });
});
