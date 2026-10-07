import RunbookService from "../../../../Server/Services/RunbookService";
import RunbookRunAccess from "../../../../Server/Utils/Runbook/RunbookRunAccess";
import Runbook from "../../../../Models/DatabaseModels/Runbook";
import RunbookExecution from "../../../../Models/DatabaseModels/RunbookExecution";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../Types/Permission";
import {
  RUNBOOK_ADVANCE_PERMISSIONS,
  RUNBOOK_ADVANCE_REFUSED_MESSAGE,
  RUNBOOK_RUN_GRANULAR_PERMISSIONS,
  RUNBOOK_RUN_PERMISSIONS,
  RUNBOOK_RUN_REFUSED_MESSAGE,
  RUNBOOK_RUN_ROLE_PERMISSIONS,
} from "../../../../Types/Runbook/RunbookRunPermissions";
import {
  RUNBOOK_ADVANCE_PERMISSIONS as SERVER_ADVANCE_PERMISSIONS,
  RUNBOOK_EXECUTE_PERMISSIONS,
} from "../../../../Server/Utils/Runbook/RunbookExecutePermission";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { SpyInstance } from "jest-mock";

/*
 * WHICH RUNBOOKS A CALLER RUNS.
 *
 * The run permissions let a caller in (RunbookExecutePermission). Then a
 * role runs the runbooks ITS grant reaches: the runbook is read with the
 * caller's rows of the run roles alone - allows and blocks - so their labels
 * and owned scope decide, and a grant that only shows runbooks (Viewer,
 * Runbook Viewer) widens nothing. Before, the route read the runbook as
 * OneUptime and a Runbook Member limited to some labels ran every runbook
 * in the project. The granular run permissions are about runs, which carry
 * no labels: they reach every runbook of the project, as they always did.
 *
 * The read decides; here it is faked by what rows it was handed, and the
 * label filtering itself is the CRUD path's own (and tested there).
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const RUNBOOK_ID: ObjectID = ObjectID.generate();
const LABEL_ID: ObjectID = ObjectID.generate();

function row(
  permission: Permission,
  options?: { isBlock?: boolean; labels?: Array<ObjectID> },
): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: options?.labels || [],
    isBlockPermission: Boolean(options?.isBlock),
  };
}

function propsWith(rows: Array<UserPermission>): DatabaseCommonInteractionProps {
  return {
    userId: ObjectID.generate(),
    tenantId: PROJECT_ID,
    userGlobalAccessPermission: {
      _type: "UserGlobalAccessPermission",
      globalPermissions: [Permission.Public, Permission.User],
      projectIds: [PROJECT_ID],
    },
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: [row(Permission.ProjectUser), ...rows],
      },
    },
  };
}

function rowsHandedToTheRead(call: number): Array<UserPermission> {
  const props: DatabaseCommonInteractionProps = (
    findRunbook.mock.calls[call]![0] as { props: DatabaseCommonInteractionProps }
  ).props;

  return (
    props.userTenantAccessPermission?.[PROJECT_ID.toString()]?.permissions ||
    []
  );
}

let findRunbook: SpyInstance<typeof RunbookService.findOneById>;

/*
 * The read answers "found" when `reaches` says the rows it was handed reach
 * the runbook.
 */
function readFinds(
  reaches: (rows: Array<UserPermission>) => boolean,
): void {
  findRunbook.mockImplementation((async (data: {
    props: DatabaseCommonInteractionProps;
  }): Promise<Runbook | null> => {
    const rows: Array<UserPermission> =
      data.props.userTenantAccessPermission?.[PROJECT_ID.toString()]
        ?.permissions || [];

    return reaches(rows) ? new Runbook(RUNBOOK_ID) : null;
  }) as never);
}

const ROLES_READ_REACHES: (rows: Array<UserPermission>) => boolean = (
  rows: Array<UserPermission>,
): boolean => {
  // A role row without labels reaches the runbook; a labelled one does not.
  return rows.some((candidate: UserPermission): boolean => {
    return (
      !candidate.isBlockPermission &&
      RUNBOOK_RUN_ROLE_PERMISSIONS.includes(candidate.permission) &&
      candidate.labelIds.length === 0
    );
  });
};

beforeEach(() => {
  findRunbook = jest.spyOn(RunbookService, "findOneById");
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the lists", () => {
  test("the run list is RunbookExecution's create list; Runbook Member is on it, Runbook Viewer is not", () => {
    expect([...RUNBOOK_RUN_PERMISSIONS].sort()).toEqual(
      [...new RunbookExecution().getCreatePermissions()].sort(),
    );
    expect(RUNBOOK_RUN_PERMISSIONS).toContain(Permission.RunbookMember);
    expect(RUNBOOK_RUN_PERMISSIONS).not.toContain(Permission.RunbookViewer);
    expect(RUNBOOK_EXECUTE_PERMISSIONS).toEqual([...RUNBOOK_RUN_PERMISSIONS]);
    expect(SERVER_ADVANCE_PERMISSIONS).toEqual([
      ...RUNBOOK_ADVANCE_PERMISSIONS,
    ]);
  });

  test("the run roles are the run permissions on Runbook's read list, and the rest are granular", () => {
    const runbookReaders: Array<Permission> = new Runbook().getReadPermissions();

    expect([...RUNBOOK_RUN_ROLE_PERMISSIONS].sort()).toEqual(
      RUNBOOK_RUN_PERMISSIONS.filter((permission: Permission): boolean => {
        return runbookReaders.includes(permission);
      }).sort(),
    );
    expect([...RUNBOOK_RUN_GRANULAR_PERMISSIONS].sort()).toEqual(
      RUNBOOK_RUN_PERMISSIONS.filter((permission: Permission): boolean => {
        return !runbookReaders.includes(permission);
      }).sort(),
    );
  });
});

describe("RunbookRunAccess.assertMayStart", () => {
  test("a Runbook Member whose grant reaches the runbook may start it, read with that grant alone", async () => {
    readFinds(ROLES_READ_REACHES);

    await expect(
      RunbookRunAccess.assertMayStart({
        databaseProps: propsWith([
          row(Permission.RunbookMember),
          row(Permission.Viewer),
        ]),
        projectId: PROJECT_ID,
        runbookId: RUNBOOK_ID,
      }),
    ).resolves.toBeUndefined();

    expect(findRunbook).toHaveBeenCalledTimes(1);
    expect(
      rowsHandedToTheRead(0).map((handed: UserPermission) => {
        return handed.permission;
      }),
    ).toEqual([Permission.RunbookMember]);
  });

  test("a Runbook Member limited to a label the runbook does not carry may not, however widely a Viewer grant shows it", async () => {
    readFinds(ROLES_READ_REACHES);

    await expect(
      RunbookRunAccess.assertMayStart({
        databaseProps: propsWith([
          row(Permission.RunbookMember, { labels: [LABEL_ID] }),
          row(Permission.Viewer),
          row(Permission.RunbookViewer),
        ]),
        projectId: PROJECT_ID,
        runbookId: RUNBOOK_ID,
      }),
    ).rejects.toThrow(new NotAuthorizedException(RUNBOOK_RUN_REFUSED_MESSAGE));

    // The Viewer rows never reached the read.
    expect(
      rowsHandedToTheRead(0).map((handed: UserPermission) => {
        return handed.permission;
      }),
    ).toEqual([Permission.RunbookMember]);
  });

  test("the caller's blocks on the run roles go to the read with their allows", async () => {
    readFinds(ROLES_READ_REACHES);

    await RunbookRunAccess.assertMayStart({
      databaseProps: propsWith([
        row(Permission.RunbookMember),
        row(Permission.RunbookMember, { isBlock: true, labels: [LABEL_ID] }),
        row(Permission.ReadRunbook),
      ]),
      projectId: PROJECT_ID,
      runbookId: RUNBOOK_ID,
    });

    expect(rowsHandedToTheRead(0)).toEqual([
      row(Permission.RunbookMember),
      row(Permission.RunbookMember, { isBlock: true, labels: [LABEL_ID] }),
    ]);
  });

  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.RunbookAdmin,
  ])("%s runs the runbooks its own grant reaches", async (role: Permission) => {
    readFinds(ROLES_READ_REACHES);

    await expect(
      RunbookRunAccess.assertMayStart({
        databaseProps: propsWith([row(role)]),
        projectId: PROJECT_ID,
        runbookId: RUNBOOK_ID,
      }),
    ).resolves.toBeUndefined();
  });

  test("Create Runbook Execution alone reaches every runbook of the project: it is about runs, which carry no labels", async () => {
    findRunbook.mockResolvedValue(null as never);

    await expect(
      RunbookRunAccess.assertMayStart({
        databaseProps: propsWith([row(Permission.CreateRunbookExecution)]),
        projectId: PROJECT_ID,
        runbookId: RUNBOOK_ID,
      }),
    ).resolves.toBeUndefined();

    expect(findRunbook).not.toHaveBeenCalled();
  });

  test("a role that does not reach the runbook is not widened by a granular permission the caller does not hold", async () => {
    readFinds(ROLES_READ_REACHES);

    await expect(
      RunbookRunAccess.assertMayStart({
        databaseProps: propsWith([
          row(Permission.RunbookMember, { labels: [LABEL_ID] }),
          row(Permission.ReadRunbook),
          row(Permission.EditRunbookExecution),
        ]),
        projectId: PROJECT_ID,
        runbookId: RUNBOOK_ID,
      }),
    ).rejects.toThrow(RUNBOOK_RUN_REFUSED_MESSAGE);
  });

  test("a team's block on Create Runbook Execution takes the granular reach away", async () => {
    await expect(
      RunbookRunAccess.assertMayStart({
        databaseProps: propsWith([
          row(Permission.CreateRunbookExecution),
          row(Permission.CreateRunbookExecution, { isBlock: true }),
        ]),
        projectId: PROJECT_ID,
        runbookId: RUNBOOK_ID,
      }),
    ).rejects.toThrow(RUNBOOK_RUN_REFUSED_MESSAGE);
  });

  test("a refusal from the read itself is a refusal, not an error", async () => {
    findRunbook.mockRejectedValue(
      new NotAuthorizedException("You do not have permission") as never,
    );

    await expect(
      RunbookRunAccess.assertMayStart({
        databaseProps: propsWith([row(Permission.RunbookMember)]),
        projectId: PROJECT_ID,
        runbookId: RUNBOOK_ID,
      }),
    ).rejects.toThrow(RUNBOOK_RUN_REFUSED_MESSAGE);
  });

  test("any other failure of the read is not swallowed", async () => {
    findRunbook.mockRejectedValue(new Error("database unavailable") as never);

    await expect(
      RunbookRunAccess.assertMayStart({
        databaseProps: propsWith([row(Permission.RunbookMember)]),
        projectId: PROJECT_ID,
        runbookId: RUNBOOK_ID,
      }),
    ).rejects.toThrow("database unavailable");
  });

  test("a master admin is not asked", async () => {
    await expect(
      RunbookRunAccess.assertMayStart({
        databaseProps: { ...propsWith([]), isMasterAdmin: true },
        projectId: PROJECT_ID,
        runbookId: RUNBOOK_ID,
      }),
    ).resolves.toBeUndefined();
    expect(findRunbook).not.toHaveBeenCalled();
  });

  test("a Runbook Viewer reaches nothing to run", async () => {
    findRunbook.mockResolvedValue(new Runbook(RUNBOOK_ID) as never);

    await expect(
      RunbookRunAccess.assertMayStart({
        databaseProps: propsWith([row(Permission.RunbookViewer)]),
        projectId: PROJECT_ID,
        runbookId: RUNBOOK_ID,
      }),
    ).rejects.toThrow(RUNBOOK_RUN_REFUSED_MESSAGE);
    expect(findRunbook).not.toHaveBeenCalled();
  });
});

describe("RunbookRunAccess.assertMayAdvance", () => {
  test("Edit Runbook Execution moves along the runs of every runbook of the project", async () => {
    findRunbook.mockResolvedValue(null as never);

    await expect(
      RunbookRunAccess.assertMayAdvance({
        databaseProps: propsWith([row(Permission.EditRunbookExecution)]),
        projectId: PROJECT_ID,
        runbookId: RUNBOOK_ID,
      }),
    ).resolves.toBeUndefined();
  });

  test("but it does not start one", async () => {
    await expect(
      RunbookRunAccess.assertMayStart({
        databaseProps: propsWith([row(Permission.EditRunbookExecution)]),
        projectId: PROJECT_ID,
        runbookId: RUNBOOK_ID,
      }),
    ).rejects.toThrow(RUNBOOK_RUN_REFUSED_MESSAGE);
  });

  test("a Runbook Member limited to other labels may not move a run of this runbook along", async () => {
    readFinds(ROLES_READ_REACHES);

    await expect(
      RunbookRunAccess.assertMayAdvance({
        databaseProps: propsWith([
          row(Permission.RunbookMember, { labels: [LABEL_ID] }),
          row(Permission.Viewer),
        ]),
        projectId: PROJECT_ID,
        runbookId: RUNBOOK_ID,
      }),
    ).rejects.toThrow(
      new NotAuthorizedException(RUNBOOK_ADVANCE_REFUSED_MESSAGE),
    );
  });
});
