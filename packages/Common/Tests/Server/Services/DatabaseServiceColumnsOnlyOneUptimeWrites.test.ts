import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import DatabaseService from "../../../Server/Services/DatabaseService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import ColumnWriteRefusedException from "../../../Server/Types/Database/Permissions/ColumnWriteRefusedException";
import ColumnsOnlyOneUptimeWrites from "../../../Server/Utils/Database/ColumnsOnlyOneUptimeWrites";
import ServerSetColumns from "../../../Server/Utils/Database/ServerSetColumns";
import logger from "../../../Server/Utils/Logger";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ServerOwned from "../../../Types/Database/ServerOwned";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { customDomainCaller } from "../API/CustomDomainCallers";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A COLUMN ONLY ONEUPTIME WRITES TAKES NO VALUE FROM A CREATE OR AN UPDATE
 * MADE THROUGH THE API (#10053), through DatabaseService, with the table in
 * memory.
 *
 * A network site's rollup state is OneUptime's alone (ServerOwned.Always):
 * when its health was last rolled up, its place in the site tree, the
 * status its devices roll up to. Its lists let a project owner update them,
 * and the API used to take the value.
 *
 *   - a person's create drops the values, under both names of a reference,
 *     and creates the site with the rest;
 *   - a person's update that names one is refused, naming every such
 *     column, and writes nothing;
 *   - OneUptime itself, a server admin, a value OneUptime's own code marked
 *     (ServerSetColumns) and a service's hook keep writing them.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10053000-0000-4000-8000-000000000001",
);
const SITE_ID: string = "10053000-0000-4000-8000-0000000000a1";
const STATUS_ID: string = "10053000-0000-4000-8000-0000000000b1";
const ROLLED_UP_AT: Date = new Date("2026-11-19T10:00:00.000Z");

const OWNER: DatabaseCommonInteractionProps = {
  ...customDomainCaller({
    permissions: [Permission.ProjectOwner],
    projectId: PROJECT_ID,
  }),
  ...ON_HIGHEST_PLAN,
};

const ROOT: DatabaseCommonInteractionProps = {
  isRoot: true,
  tenantId: PROJECT_ID,
};

const SERVER_ADMIN: DatabaseCommonInteractionProps = {
  ...customDomainCaller({
    permissions: [],
    projectId: PROJECT_ID,
    isMasterAdmin: true,
  }),
  isMasterAdmin: true,
  ...ON_HIGHEST_PLAN,
};

// A network site service with no hooks of its own.
class PlainNetworkSiteService extends DatabaseService<NetworkSite> {
  public constructor() {
    super(NetworkSite);
  }
}

/*
 * One whose create hook rolls the new site's health up, as OneUptime's own
 * code does for the person who creates it.
 */
class RollsUpOnCreateService extends DatabaseService<NetworkSite> {
  public constructor() {
    super(NetworkSite);
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<NetworkSite>,
  ): Promise<OnCreate<NetworkSite>> {
    ServerSetColumns.set(createBy.data, { lastRollupAt: ROLLED_UP_AT });
    return { createBy: createBy, carryForward: null };
  }
}

function newSite(extra?: (site: NetworkSite) => void): NetworkSite {
  const site: NetworkSite = new NetworkSite();
  site.projectId = PROJECT_ID;
  site.name = "Frankfurt";
  extra?.(site);
  return site;
}

function storedSite(): StoredRow {
  return {
    _id: SITE_ID,
    projectId: PROJECT_ID.toString(),
    name: "Frankfurt",
    slug: "frankfurt",
    depth: 0,
    materializedPath: `/${SITE_ID}/`,
    lastRollupAt: null,
  };
}

async function refusalOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Expected the write to be refused, but it went through.");
}

beforeEach(() => {
  for (const silenced of ["debug", "info", "warn", "error"]) {
    getJestSpyOn(logger, silenced).mockImplementation((): void => {
      return undefined;
    });
  }

  stubProjectDirectory({});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the columns only OneUptime writes, as a model has them", () => {
  test("are a network site's rollup state, under both names of its status", () => {
    const columns: Array<string> = ColumnsOnlyOneUptimeWrites.getColumns(
      new NetworkSite(),
    );

    expect(columns).toEqual(
      expect.arrayContaining([
        "lastRollupAt",
        "depth",
        "materializedPath",
        "currentMonitorStatusId",
        "currentMonitorStatus",
      ]),
    );
    expect(columns).not.toContain("name");
    expect(columns).not.toContain("parentSiteId");

    for (const column of columns) {
      const declared: ServerOwned | undefined =
        new NetworkSite().getTableColumnMetadata(column)?.serverOwned;
      // The relation names the record its ID column holds, which declares it.
      expect([column, declared ?? "relation"]).toEqual([
        column,
        column === "currentMonitorStatus" ? "relation" : ServerOwned.Always,
      ]);
    }
  });

  test("may be written by OneUptime itself and a server admin, and by nobody else", () => {
    expect(ColumnsOnlyOneUptimeWrites.mayWrite(ROOT)).toBe(true);
    expect(ColumnsOnlyOneUptimeWrites.mayWrite(SERVER_ADMIN)).toBe(true);
    expect(ColumnsOnlyOneUptimeWrites.mayWrite(OWNER)).toBe(false);
    expect(
      ColumnsOnlyOneUptimeWrites.mayWrite(
        customDomainCaller({
          permissions: [Permission.ProjectOwner],
          projectId: PROJECT_ID,
          isApiKey: true,
        }),
      ),
    ).toBe(false);
  });
});

describe("a create through the API", () => {
  let service: PlainNetworkSiteService;
  let sites: InMemoryTable;

  beforeEach(() => {
    service = new PlainNetworkSiteService();
    sites = useInMemoryTable(service, []);
  });

  test("drops what only OneUptime writes, and creates the site with the rest", async () => {
    await service.create({
      data: newSite((site: NetworkSite) => {
        site.lastRollupAt = ROLLED_UP_AT;
        site.depth = 7;
        site.materializedPath = "/made/up/";
        site.currentMonitorStatusId = new ObjectID(STATUS_ID);
      }),
      props: OWNER,
    });

    expect(sites.inserts).toHaveLength(1);
    const row: StoredRow = sites.inserts[0]!;
    expect(row["name"]).toBe("Frankfurt");
    expect(row["lastRollupAt"]).toBeUndefined();
    expect(row["depth"]).not.toBe(7);
    expect(row["materializedPath"]).not.toBe("/made/up/");
    expect(row["currentMonitorStatusId"]).toBeUndefined();
  });

  test("drops a status named by its relation, not only by its ID", async () => {
    await service.create({
      data: newSite((site: NetworkSite) => {
        (site as unknown as Record<string, unknown>)["currentMonitorStatus"] = {
          _id: STATUS_ID,
        };
      }),
      props: OWNER,
    });

    const row: StoredRow = sites.inserts[0]!;
    expect(row["currentMonitorStatusId"]).toBeUndefined();
    expect(row["currentMonitorStatus"]).toBeUndefined();
  });

  test("by an API key drops them too", async () => {
    await service.create({
      data: newSite((site: NetworkSite) => {
        site.lastRollupAt = ROLLED_UP_AT;
      }),
      props: {
        ...customDomainCaller({
          permissions: [Permission.ProjectOwner],
          projectId: PROJECT_ID,
          isApiKey: true,
        }),
        ...ON_HIGHEST_PLAN,
      },
    });

    expect(sites.inserts[0]!["lastRollupAt"]).toBeUndefined();
  });

  test("by OneUptime itself keeps them", async () => {
    await service.create({
      data: newSite((site: NetworkSite) => {
        site.lastRollupAt = ROLLED_UP_AT;
        site.currentMonitorStatusId = new ObjectID(STATUS_ID);
      }),
      props: ROOT,
    });

    const row: StoredRow = sites.inserts[0]!;
    expect(new Date(row["lastRollupAt"] as Date).toISOString()).toBe(
      ROLLED_UP_AT.toISOString(),
    );
    expect(String(row["currentMonitorStatusId"])).toBe(STATUS_ID);
  });

  test("keeps a value OneUptime's own code filled in for the person", async () => {
    const site: NetworkSite = newSite();
    ServerSetColumns.set(site, { lastRollupAt: ROLLED_UP_AT });

    await service.create({ data: site, props: OWNER });

    expect(
      new Date(sites.inserts[0]!["lastRollupAt"] as Date).toISOString(),
    ).toBe(ROLLED_UP_AT.toISOString());
  });
});

describe("a create's hook", () => {
  test("still fills in what only OneUptime writes, for the person's create", async () => {
    const service: RollsUpOnCreateService = new RollsUpOnCreateService();
    const sites: InMemoryTable = useInMemoryTable(service, []);

    await service.create({
      data: newSite((site: NetworkSite) => {
        // What the person sends is dropped before the hook runs.
        site.lastRollupAt = new Date("2000-01-01T00:00:00.000Z");
      }),
      props: OWNER,
    });

    expect(
      new Date(sites.inserts[0]!["lastRollupAt"] as Date).toISOString(),
    ).toBe(ROLLED_UP_AT.toISOString());
  });
});

describe("an update through the API", () => {
  let service: PlainNetworkSiteService;
  let sites: InMemoryTable;

  beforeEach(() => {
    service = new PlainNetworkSiteService();
    sites = useInMemoryTable(service, [storedSite()]);
  });

  test("that names one is refused with its name, and writes nothing", async () => {
    const refusal: unknown = await refusalOf(
      service.updateOneById({
        id: new ObjectID(SITE_ID),
        data: { name: "Frankfurt 2", lastRollupAt: ROLLED_UP_AT },
        props: OWNER,
      }),
    );

    expect(refusal).toBeInstanceOf(ColumnWriteRefusedException);
    expect((refusal as ColumnWriteRefusedException).columnName).toBe(
      "lastRollupAt",
    );
    expect((refusal as Error).message).toBe(
      "User is not allowed to update on lastRollupAt column of Network Site. No permission allows it: the column is changed by the server, not by a request.",
    );
    expect(sites.updates).toHaveLength(0);
    expect(sites.get(SITE_ID)!["name"]).toBe("Frankfurt");
  });

  test("that names several is refused naming each", async () => {
    const refusal: unknown = await refusalOf(
      service.updateOneById({
        id: new ObjectID(SITE_ID),
        data: { lastRollupAt: ROLLED_UP_AT, depth: 3 },
        props: OWNER,
      }),
    );

    expect((refusal as Error).message).toBe(
      "User is not allowed to update on depth, lastRollupAt columns of Network Site. No permission allows it: these columns are changed by the server, not by a request.",
    );
    expect(sites.updates).toHaveLength(0);
  });

  test("that names a status by its relation is refused with that name", async () => {
    const refusal: unknown = await refusalOf(
      service.updateOneById({
        id: new ObjectID(SITE_ID),
        data: {
          currentMonitorStatus: { _id: STATUS_ID },
        } as unknown as Record<string, never>,
        props: OWNER,
      }),
    );

    expect(refusal).toBeInstanceOf(ColumnWriteRefusedException);
    expect((refusal as Error).message).toContain("currentMonitorStatus");
    expect(sites.updates).toHaveLength(0);
  });

  test("that names none goes through", async () => {
    await service.updateOneById({
      id: new ObjectID(SITE_ID),
      data: { name: "Frankfurt 2" },
      props: OWNER,
    });

    expect(sites.get(SITE_ID)!["name"]).toBe("Frankfurt 2");
  });

  test("by OneUptime itself, or a server admin, is written", async () => {
    await service.updateOneById({
      id: new ObjectID(SITE_ID),
      data: { lastRollupAt: ROLLED_UP_AT },
      props: ROOT,
    });
    expect(
      new Date(sites.get(SITE_ID)!["lastRollupAt"] as Date).toISOString(),
    ).toBe(ROLLED_UP_AT.toISOString());

    await service.updateOneById({
      id: new ObjectID(SITE_ID),
      data: { depth: 2 },
      props: SERVER_ADMIN,
    });
    expect(Number(sites.get(SITE_ID)!["depth"])).toBe(2);
  });

  test("of a value OneUptime's own code filled in for the person is written", async () => {
    const data: Record<string, unknown> = {};
    ServerSetColumns.set(data, { lastRollupAt: ROLLED_UP_AT });

    await service.updateOneById({
      id: new ObjectID(SITE_ID),
      data: data as Record<string, never>,
      props: OWNER,
    });

    expect(
      new Date(sites.get(SITE_ID)!["lastRollupAt"] as Date).toISOString(),
    ).toBe(ROLLED_UP_AT.toISOString());
  });
});
