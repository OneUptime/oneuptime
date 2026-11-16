import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import Label from "../../../Models/DatabaseModels/Label";
import DatabaseService from "../../../Server/Services/DatabaseService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import ColumnPermissionsForTest from "../../../Server/Types/Database/Permissions/ColumnPermission";
import ColumnWriteRefusedException from "../../../Server/Types/Database/Permissions/ColumnWriteRefusedException";
import ServerSetColumns from "../../../Server/Utils/Database/ServerSetColumns";
import logger from "../../../Server/Utils/Logger";
import PasswordHash from "../../../Server/Utils/PasswordHash";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Color from "../../../Types/Color";
import HashedString from "../../../Types/HashedString";
import ObjectID from "../../../Types/ObjectID";
import DashboardViewConfigUtil from "../../../Utils/Dashboard/DashboardViewConfig";
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
 * A SERVER-SET COLUMN ON A CREATE, THROUGH THE WHOLE CREATE (#6541).
 *
 * The create's column check runs on the record as its hooks, the defaults
 * and the hashing leave it, and used to let every computed column through
 * whatever its create list said: a value the caller sent there was kept
 * whenever the service did not write over it. Now DatabaseService asks the
 * caller's values in server-set columns before the hooks run
 * (ColumnPermission.checkComputedColumnsSentOnCreate), and hands the check
 * after them the server-set columns its own steps wrote
 * (columnsSetByServer). Asked here through DatabaseService.create, with the
 * table in memory:
 *
 *   - what a hook writes in a column nobody may create is saved, for a
 *     member's create;
 *   - the same column sent by the member is refused before any hook runs,
 *     and nothing is written;
 *   - a salt the hashing mints is saved; a salt the member sends is refused;
 *   - OneUptime's own value, marked on the record, is saved as it is;
 *   - OneUptime itself is not asked;
 *   - the check that asks without creating answers as the create does.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "65410000-0000-4000-8000-00000000d001",
);

function member(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions: permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

async function refusalOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Expected the create to be refused, but it went through.");
}

// What the hook below writes when the create leaves the key out.
const HOOK_KEY: string = "the key the hook wrote";

/*
 * A label service whose create hook writes the label's sort key - a
 * server-set column nobody may create or read - before the create's column
 * check runs, as a service's hook writes a number, a token or a flag.
 */
class HookWritesTheKeyService extends DatabaseService<Label> {
  public hookRuns: number = 0;

  public constructor() {
    super(Label);
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Label>,
  ): Promise<OnCreate<Label>> {
    this.hookRuns++;

    if (createBy.data.nameSortKey === undefined) {
      createBy.data.nameSortKey = HOOK_KEY;
    }

    return { createBy: createBy, carryForward: null };
  }
}

// A dashboard service with no hooks of its own: the hashing mints the salt.
class PlainDashboardService extends DatabaseService<Dashboard> {
  public constructor() {
    super(Dashboard);
  }
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

describe("a value a create's hook writes in a server-set column", () => {
  let service: HookWritesTheKeyService;
  let labels: InMemoryTable;

  beforeEach(() => {
    service = new HookWritesTheKeyService();
    labels = useInMemoryTable(service, []);
  });

  function newLabel(extra?: (label: Label) => void): Label {
    const label: Label = new Label();
    label.projectId = PROJECT_ID;
    label.name = "Payments";
    label.color = new Color("#ef4444");
    extra?.(label);
    return label;
  }

  function inserted(): StoredRow {
    expect(labels.inserts).toHaveLength(1);
    return labels.inserts[0]!;
  }

  test.each([
    ["a Project Owner", [Permission.ProjectOwner]],
    ["a Project Admin", [Permission.ProjectAdmin]],
    [
      "someone holding Create Label",
      [Permission.CreateProjectLabel, Permission.ReadProjectLabel],
    ],
  ])(
    "is saved for %s, who may not create the column: the create's own steps wrote it",
    async (_who: string, permissions: Array<Permission>) => {
      await service.create({
        data: newLabel(),
        props: member(permissions),
      });

      expect(service.hookRuns).toBe(1);
      expect(inserted()["nameSortKey"]).toBe(HOOK_KEY);
    },
  );

  test("sent by the member, is refused with the column's name before any hook runs, and nothing is written", async () => {
    const error: unknown = await refusalOf(
      service.create({
        data: newLabel((label: Label): void => {
          label.nameSortKey = "0000 first of all";
        }),
        props: member([Permission.ProjectOwner]),
      }),
    );

    expect(error).toBeInstanceOf(ColumnWriteRefusedException);
    expect((error as ColumnWriteRefusedException).columnName).toBe(
      "nameSortKey",
    );
    expect((error as Error).message).toContain("No permission allows it");
    expect(service.hookRuns).toBe(0);
    expect(labels.inserts).toEqual([]);
  });

  test("marked as OneUptime's by its own code, is saved as it is for a member", async () => {
    await service.create({
      data: newLabel((label: Label): void => {
        ServerSetColumns.set(label, { nameSortKey: "OneUptime's own key" });
      }),
      props: member([Permission.ProjectOwner]),
    });

    expect(inserted()["nameSortKey"]).toBe("OneUptime's own key");
  });

  test("sent by OneUptime itself, is not asked about: it is saved as it is", async () => {
    await service.create({
      data: newLabel((label: Label): void => {
        label.nameSortKey = "root's own key";
      }),
      props: { isRoot: true },
    });

    expect(inserted()["nameSortKey"]).toBe("root's own key");
  });

  test("asked without creating, the member's value is refused as the create refuses it", async () => {
    const error: unknown = await refusalOf(
      service.checkCallerMayCreate({
        data: newLabel((label: Label): void => {
          label.nameSortKey = "0000 first of all";
        }),
        props: member([Permission.ProjectOwner]),
      }),
    );

    expect(error).toBeInstanceOf(ColumnWriteRefusedException);
    expect((error as ColumnWriteRefusedException).columnName).toBe(
      "nameSortKey",
    );
    expect(labels.inserts).toEqual([]);
  });

  test("asked without creating, a create that leaves it out is allowed", async () => {
    await expect(
      service.checkCallerMayCreate({
        data: newLabel(),
        props: member([Permission.ProjectOwner]),
      }),
    ).resolves.toBeUndefined();
  });
});

/*
 * What the check of the record as written is told the create's own steps
 * wrote: every server-set column the record holds a value in that the
 * caller did not give one - never one the caller gave, which the ask before
 * the hooks held to its list. A create not asked before its hooks hands over
 * none, so every value is then the caller's.
 */
describe("the server-set columns a create hands the check of the record as written", () => {
  interface WithColumnsSetByServer {
    checkCreateBeforeHooks(createBy: CreateBy<Label>): Promise<Array<string>>;
    getColumnsSetByServerOnCreate(
      createBy: CreateBy<Label>,
      record: Label,
    ): Array<string>;
  }

  let service: HookWritesTheKeyService;

  beforeEach(() => {
    service = new HookWritesTheKeyService();
    useInMemoryTable(service, []);
  });

  function withKey(key: string | undefined): Label {
    const label: Label = new Label();
    label.projectId = PROJECT_ID;
    label.name = "Payments";

    if (key !== undefined) {
      label.nameSortKey = key;
    }

    return label;
  }

  test("are the ones the create wrote after the caller was asked, not the ones the caller sent", async () => {
    const internals: WithColumnsSetByServer =
      service as unknown as WithColumnsSetByServer;

    // Everything OneUptime itself writes is its own.
    const fromOneUptime: CreateBy<Label> = {
      data: withKey("root's own"),
      props: { isRoot: true },
    };
    await internals.checkCreateBeforeHooks(fromOneUptime);

    expect(
      internals.getColumnsSetByServerOnCreate(
        fromOneUptime,
        withKey("root's own"),
      ),
    ).toEqual(["nameSortKey"]);

    const asked: CreateBy<Label> = {
      data: withKey(undefined),
      props: member([Permission.ProjectOwner]),
    };
    await internals.checkCreateBeforeHooks(asked);

    // The caller sent no key: the one the record holds now is the create's.
    expect(
      internals.getColumnsSetByServerOnCreate(asked, withKey(HOOK_KEY)),
    ).toEqual(["nameSortKey"]);
  });

  test("a create that was not asked before its hooks hands over none", () => {
    const internals: WithColumnsSetByServer =
      service as unknown as WithColumnsSetByServer;

    expect(
      internals.getColumnsSetByServerOnCreate(
        { data: withKey(undefined), props: member([Permission.ProjectOwner]) },
        withKey(HOOK_KEY),
      ),
    ).toEqual([]);
  });

  test("a column the caller may create and sent is the caller's, not the create's", async () => {
    const internals: WithColumnsSetByServer =
      service as unknown as WithColumnsSetByServer;

    // The key is the caller's to give here, as if its list named them.
    const asked: CreateBy<Label> = {
      data: withKey("the caller's own"),
      props: member([Permission.ProjectOwner]),
    };

    getJestSpyOn(
      ColumnPermissionsForTest,
      "checkComputedColumnsSentOnCreate",
    ).mockReturnValue(["nameSortKey"] as never);

    await internals.checkCreateBeforeHooks(asked);

    expect(
      internals.getColumnsSetByServerOnCreate(
        asked,
        withKey("the caller's own"),
      ),
    ).toEqual([]);
  });
});

describe("a salt the hashing mints on a create", () => {
  let service: PlainDashboardService;
  let dashboards: InMemoryTable;

  beforeEach(() => {
    service = new PlainDashboardService();
    dashboards = useInMemoryTable(service, []);
  });

  function newDashboard(extra?: (dashboard: Dashboard) => void): Dashboard {
    const dashboard: Dashboard = new Dashboard();
    dashboard.projectId = PROJECT_ID;
    dashboard.name = "Checkout";
    dashboard.dashboardViewConfig =
      DashboardViewConfigUtil.createDefaultDashboardViewConfig();
    extra?.(dashboard);
    return dashboard;
  }

  test("is saved with the password it was minted for, for a member who may not create the salt", async () => {
    await service.create({
      data: newDashboard((dashboard: Dashboard): void => {
        dashboard.masterPassword = new HashedString("correct horse battery");
      }),
      props: member([Permission.ProjectOwner]),
    });

    expect(dashboards.inserts).toHaveLength(1);

    const row: StoredRow = dashboards.inserts[0]!;
    const salt: unknown = row["masterPasswordSalt"];

    expect(salt).toMatch(/^[0-9a-f]{64}$/);
    await expect(
      PasswordHash.verify({
        plainValue: "correct horse battery",
        storedValue: String(row["masterPassword"]),
        salt: salt as string,
      }),
    ).resolves.toBe(true);
  });

  test("sent by the member, is refused before any hook runs, and nothing is written", async () => {
    const error: unknown = await refusalOf(
      service.create({
        data: newDashboard((dashboard: Dashboard): void => {
          dashboard.masterPasswordSalt = "a salt the member chose";
        }),
        props: member([Permission.ProjectOwner]),
      }),
    );

    expect(error).toBeInstanceOf(ColumnWriteRefusedException);
    expect((error as ColumnWriteRefusedException).columnName).toBe(
      "masterPasswordSalt",
    );
    expect(dashboards.inserts).toEqual([]);
  });
});
