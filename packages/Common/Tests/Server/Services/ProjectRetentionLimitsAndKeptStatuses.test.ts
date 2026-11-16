import ProjectService, {
  KEPT_POSTMORTEM_STATUS_NOT_THE_PROJECTS_MESSAGE,
} from "../../../Server/Services/ProjectService";
import IncidentPostmortemStatusService from "../../../Server/Services/IncidentPostmortemStatusService";
import ResolvedRecordRetention from "../../../Server/Utils/Retention/ResolvedRecordRetention";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import TablePermission from "../../../Server/Types/Database/Permissions/TablePermission";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import logger from "../../../Server/Utils/Logger";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "../../../Models/DatabaseModels/Project";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import TableColumnType from "../../../Types/Database/TableColumnType";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  ResolvedRecordKind,
  ResolvedRecordRetentionServerLimits,
} from "../../../Types/Retention/ResolvedRecordRetention";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * ISSUES #6941 AND #6945, on the project: which postmortem statuses keep an
 * incident from the retention (Project.keepIncidentsInPostmortemStatusIds:
 * the Completed status unless the project chooses others), and where a new
 * project starts (the server's default, Admin Dashboard > Settings > Data
 * Retention). What is pinned: only Project Owners and Admins choose the
 * statuses, as the rest of the setting; a choice is a list of the project's
 * own statuses, never empty and never another project's; and a new project
 * gets the server's default - Never when there is none, or when it cannot
 * be read - written as OneUptime once the project exists.
 */

const COLUMN: string = "keepIncidentsInPostmortemStatusIds";

const PROJECT_ID: ObjectID = new ObjectID(
  "e6945000-0000-4000-8000-000000000001",
);
const STATUS_A: string = "e6945a00-0000-4000-8000-000000000001";
const STATUS_B: string = "e6945b00-0000-4000-8000-000000000002";

interface ProjectHookAccess {
  onBeforeUpdate(updateBy: UpdateBy<Project>): Promise<OnUpdate<Project>>;
  findRowsAndHoldUpdateToThem(
    updateBy: UpdateBy<Project>,
    select: unknown,
  ): Promise<Array<Project>>;
}

const hooks: ProjectHookAccess = ProjectService as unknown as ProjectHookAccess;

function permissionRow(permission: Permission): UserPermission {
  return {
    _type: "UserPermission",
    permission,
    labelIds: [],
    isBlockPermission: false,
  };
}

function propsWith(
  ...permissions: Array<Permission>
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: permissions.map(permissionRow),
  };

  return {
    userId: ObjectID.generate(),
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
  } as DatabaseCommonInteractionProps;
}

function mayWrite(
  data: Record<string, unknown>,
  requestType: DatabaseRequestType,
  ...permissions: Array<Permission>
): boolean {
  const props: DatabaseCommonInteractionProps = propsWith(...permissions);

  try {
    TablePermission.checkTableLevelPermissions(Project, props, requestType);
    ColumnPermissions.checkDataColumnPermissions(
      Project,
      data as unknown as BaseModel,
      props,
      requestType,
    );
    return true;
  } catch {
    return false;
  }
}

function project(id: ObjectID = PROJECT_ID): Project {
  const row: Project = new Project();
  row.id = id;
  return row;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Project.keepIncidentsInPostmortemStatusIds: the column", () => {
  const model: Project = new Project();

  it("is an optional list, empty on every project: the Completed status, as before", () => {
    const metadata: { type: TableColumnType; required?: boolean } =
      model.getTableColumnMetadata(COLUMN) as unknown as {
        type: TableColumnType;
        required?: boolean;
      };

    expect(metadata.type).toBe(TableColumnType.JSON);
    expect(metadata.required).toBe(false);
  });

  it("is read and written as the postmortem switch above it is: Owners and Admins write it, nobody names it on a new project", () => {
    expect(model.getColumnAccessControlFor(COLUMN)).toEqual(
      model.getColumnAccessControlFor("keepIncidentsWithCompletedPostmortem"),
    );
    expect(model.getColumnAccessControlFor(COLUMN)?.update).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
    ]);
    expect(model.getColumnAccessControlFor(COLUMN)?.create).toEqual([]);
  });

  it.each([Permission.ProjectOwner, Permission.ProjectAdmin])(
    "%s may choose the statuses",
    (permission: Permission) => {
      expect(
        mayWrite(
          { [COLUMN]: [STATUS_A] },
          DatabaseRequestType.Update,
          permission,
        ),
      ).toBe(true);
    },
  );

  it.each([
    Permission.ProjectMember,
    Permission.IncidentAdmin,
    Permission.EditIncidentPostmortemStatus,
    Permission.Viewer,
  ])("%s may not", (permission: Permission) => {
    expect(
      mayWrite(
        { [COLUMN]: [STATUS_A] },
        DatabaseRequestType.Update,
        permission,
      ),
    ).toBe(false);
  });
});

describe("ProjectService.applyResolvedRecordRetentionRules: the statuses' shape", () => {
  it("a list is stored lower case, each id once", () => {
    const data: Record<string, unknown> = {
      [COLUMN]: [STATUS_A.toUpperCase(), STATUS_B, STATUS_A],
    };

    ProjectService.applyResolvedRecordRetentionRules(data);

    expect(data[COLUMN]).toEqual([STATUS_A, STATUS_B]);
  });

  it("empty (null) is the Completed status, and is stored as null", () => {
    const data: Record<string, unknown> = { [COLUMN]: null };

    ProjectService.applyResolvedRecordRetentionRules(data);

    expect(data[COLUMN]).toBeNull();
  });

  it.each([
    ["an empty list", [], "Pick at least one postmortem status"],
    ["one id that is not in a list", STATUS_A, "as a list of their ids"],
    ["a name for an id", [STATUS_A, "Completed"], "is named by its id"],
    [
      "51 statuses",
      Array.from({ length: 51 }, (_: unknown, index: number): string => {
        return `e6945c00-0000-4000-8000-${String(index).padStart(12, "0")}`;
      }),
      "at most 50",
    ],
  ])("%s is refused", (_label: string, value: unknown, message: string) => {
    expect(() => {
      ProjectService.applyResolvedRecordRetentionRules({ [COLUMN]: value });
    }).toThrow(message);
  });

  it("a write that leaves it out is not judged on it", () => {
    const data: Record<string, unknown> = { incidentRetentionInDays: 90 };

    ProjectService.applyResolvedRecordRetentionRules(data);

    expect(COLUMN in data).toBe(false);
  });
});

describe("ProjectService: the statuses are the project's own", () => {
  function stubProjects(
    rows: Array<Project>,
  ): SpyInstance<ProjectHookAccess["findRowsAndHoldUpdateToThem"]> {
    return jest
      .spyOn(hooks, "findRowsAndHoldUpdateToThem")
      .mockResolvedValue(rows as never);
  }

  it("statuses of the project are written", async () => {
    stubProjects([project()]);
    const count: SpyInstance<typeof IncidentPostmortemStatusService.countBy> =
      jest
        .spyOn(IncidentPostmortemStatusService, "countBy")
        .mockResolvedValue(new PositiveNumber(2));

    const result: OnUpdate<Project> = await hooks.onBeforeUpdate({
      query: { _id: PROJECT_ID.toString() },
      data: { [COLUMN]: [STATUS_A, STATUS_B] },
      props: { isRoot: true },
    } as unknown as UpdateBy<Project>);

    expect((result.updateBy.data as Record<string, unknown>)[COLUMN]).toEqual([
      STATUS_A,
      STATUS_B,
    ]);

    const query: Record<string, unknown> = count.mock.calls[0]![0]
      .query as Record<string, unknown>;

    expect((query["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect(count.mock.calls[0]![0].props).toEqual({ isRoot: true });
  });

  it("one that is not the project's - another project's, or none at all - is refused", async () => {
    stubProjects([project()]);
    jest
      .spyOn(IncidentPostmortemStatusService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));

    await expect(
      hooks.onBeforeUpdate({
        query: { _id: PROJECT_ID.toString() },
        data: { [COLUMN]: [STATUS_A, STATUS_B] },
        props: { isRoot: true },
      } as unknown as UpdateBy<Project>),
    ).rejects.toThrow(KEPT_POSTMORTEM_STATUS_NOT_THE_PROJECTS_MESSAGE);
  });

  it("each project the update writes is checked for its own statuses", async () => {
    const other: ObjectID = new ObjectID(
      "e6945000-0000-4000-8000-000000000002",
    );
    stubProjects([project(), project(other)]);
    const count: SpyInstance<typeof IncidentPostmortemStatusService.countBy> =
      jest
        .spyOn(IncidentPostmortemStatusService, "countBy")
        .mockResolvedValueOnce(new PositiveNumber(1))
        .mockResolvedValueOnce(new PositiveNumber(0));

    await expect(
      hooks.onBeforeUpdate({
        query: {},
        data: { [COLUMN]: [STATUS_A] },
        props: { isRoot: true },
      } as unknown as UpdateBy<Project>),
    ).rejects.toThrow(KEPT_POSTMORTEM_STATUS_NOT_THE_PROJECTS_MESSAGE);
    expect(count).toHaveBeenCalledTimes(2);
  });

  it("going back to the Completed status (null) reads nothing", async () => {
    const find: SpyInstance<ProjectHookAccess["findRowsAndHoldUpdateToThem"]> =
      stubProjects([project()]);
    const count: SpyInstance<typeof IncidentPostmortemStatusService.countBy> =
      jest.spyOn(IncidentPostmortemStatusService, "countBy");

    await hooks.onBeforeUpdate({
      query: { _id: PROJECT_ID.toString() },
      data: { [COLUMN]: null },
      props: { isRoot: true },
    } as unknown as UpdateBy<Project>);

    expect(find).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
  });

  it("an empty list is refused before anything is read", async () => {
    const find: SpyInstance<ProjectHookAccess["findRowsAndHoldUpdateToThem"]> =
      stubProjects([project()]);

    await expect(
      hooks.onBeforeUpdate({
        query: { _id: PROJECT_ID.toString() },
        data: { [COLUMN]: [] },
        props: { isRoot: true },
      } as unknown as UpdateBy<Project>),
    ).rejects.toThrow("Pick at least one postmortem status");
    expect(find).not.toHaveBeenCalled();
  });
});

describe("ProjectService.applyServerRetentionDefaults: where a new project starts", () => {
  function serverDefaults(
    incident: number,
    alert: number,
  ): SpyInstance<typeof ResolvedRecordRetention.getServerLimits> {
    return jest
      .spyOn(ResolvedRecordRetention, "getServerLimits")
      .mockImplementation(
        async (
          kind: ResolvedRecordKind,
        ): Promise<ResolvedRecordRetentionServerLimits> => {
          return {
            maximumInDays: undefined,
            defaultInDays:
              kind === ResolvedRecordKind.Incident ? incident : alert,
          };
        },
      );
  }

  it("writes the server's default for each kind, as OneUptime", async () => {
    serverDefaults(365, 90);
    const update: SpyInstance<typeof ProjectService.updateOneById> = jest
      .spyOn(ProjectService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await ProjectService.applyServerRetentionDefaults(PROJECT_ID);

    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]![0]).toEqual({
      id: PROJECT_ID,
      data: { incidentRetentionInDays: 365, alertRetentionInDays: 90 },
      props: { isRoot: true },
    });
  });

  it("writes only the kind the server has a default for", async () => {
    serverDefaults(0, 30);
    const update: SpyInstance<typeof ProjectService.updateOneById> = jest
      .spyOn(ProjectService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await ProjectService.applyServerRetentionDefaults(PROJECT_ID);

    expect(update.mock.calls[0]![0].data).toEqual({ alertRetentionInDays: 30 });
  });

  it("with no default on the server, writes nothing: the project starts at Never, as every project did", async () => {
    serverDefaults(0, 0);
    const update: SpyInstance<typeof ProjectService.updateOneById> = jest
      .spyOn(ProjectService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await ProjectService.applyServerRetentionDefaults(PROJECT_ID);

    expect(update).not.toHaveBeenCalled();
  });

  it("limits that cannot be read are logged, and the project starts at Never", async () => {
    jest
      .spyOn(ResolvedRecordRetention, "getServerLimits")
      .mockRejectedValue(new Error("connection refused"));
    const update: SpyInstance<typeof ProjectService.updateOneById> = jest.spyOn(
      ProjectService,
      "updateOneById",
    );
    const errorLog: SpyInstance<typeof logger.error> = jest
      .spyOn(logger, "error")
      .mockImplementation((() => {
        return undefined;
      }) as never);

    await expect(
      ProjectService.applyServerRetentionDefaults(PROJECT_ID),
    ).resolves.toBeUndefined();
    expect(update).not.toHaveBeenCalled();
    expect(String(errorLog.mock.calls[0]![0])).toContain(
      "keeps every one until its owners pick a length",
    );
  });

  it("a write that fails is logged, never thrown: the project exists, and keeps everything", async () => {
    serverDefaults(30, 30);
    jest
      .spyOn(ProjectService, "updateOneById")
      .mockRejectedValue(new Error("deadlock detected"));
    jest.spyOn(logger, "error").mockImplementation((() => {
      return undefined;
    }) as never);

    await expect(
      ProjectService.applyServerRetentionDefaults(PROJECT_ID),
    ).resolves.toBeUndefined();
  });
});
