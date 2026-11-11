import ProjectService from "../../../Server/Services/ProjectService";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import TablePermission from "../../../Server/Types/Database/Permissions/TablePermission";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "../../../Models/DatabaseModels/Project";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import TableColumnType from "../../../Types/Database/TableColumnType";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import {
  DEFAULT_KEEP_INCIDENTS_WITH_COMPLETED_POSTMORTEM,
  DEFAULT_RESOLVED_RECORD_RETENTION_IN_DAYS,
  RESOLVED_RECORD_RETENTION_CHOICES_IN_DAYS,
  ResolvedRecordKind,
  getResolvedRecordRetentionRefusal,
} from "../../../Types/Retention/ResolvedRecordRetention";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * ISSUE #6903: a project chooses how long a resolved incident and a
 * resolved alert stay before the Workers jobs delete them with everything
 * they carry - Project.incidentRetentionInDays and
 * Project.alertRetentionInDays, 0 (keep every one) for every project until
 * a Project Owner or Admin picks 30, 60, 90, 180, 365, 730 or 1095 days -
 * and whether an incident with a completed postmortem stays however old it
 * is (Project.keepIncidentsWithCompletedPostmortem, on). Deleting history is
 * a project-wide decision, so only the project's Owners and Admins write
 * them - not the incident or alert roles, who work with single records; and
 * whatever is written is one of the choices, by the Dashboard, the API and
 * Terraform alike, so a typo never deletes more than was meant.
 */

const INCIDENT_COLUMN: string = "incidentRetentionInDays";
const ALERT_COLUMN: string = "alertRetentionInDays";
const KEEP_COLUMN: string = "keepIncidentsWithCompletedPostmortem";

const RETENTION_COLUMNS: Array<{
  column: string;
  kind: ResolvedRecordKind;
  title: string;
}> = [
  {
    column: INCIDENT_COLUMN,
    kind: ResolvedRecordKind.Incident,
    title: "Incident Retention (Days)",
  },
  {
    column: ALERT_COLUMN,
    kind: ResolvedRecordKind.Alert,
    title: "Alert Retention (Days)",
  },
];

const PROJECT_ID: ObjectID = new ObjectID(
  "e6903000-0000-4000-8000-000000000001",
);

const INCIDENT_REFUSAL: string = getResolvedRecordRetentionRefusal(
  ResolvedRecordKind.Incident,
);
const ALERT_REFUSAL: string = getResolvedRecordRetentionRefusal(
  ResolvedRecordKind.Alert,
);

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

// Whether a caller holding these may write the data on a project.
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

interface ColumnMetadata {
  type: TableColumnType;
  required?: boolean;
  isDefaultValueColumn?: boolean;
  defaultValue?: unknown;
  title?: string;
  description?: string;
  example?: unknown;
}

function metadataOf(column: string): ColumnMetadata {
  return new Project().getTableColumnMetadata(
    column,
  ) as unknown as ColumnMetadata;
}

interface ProjectHookAccess {
  onBeforeUpdate(updateBy: UpdateBy<Project>): Promise<OnUpdate<Project>>;
  onBeforeCreate(createBy: CreateBy<Project>): Promise<unknown>;
}

const hooks: ProjectHookAccess = ProjectService as unknown as ProjectHookAccess;

// Everyone with a place in a project who is not one of its Owners or Admins.
const REFUSED_WRITERS: Array<Permission> = [
  Permission.ProjectMember,
  Permission.EditProject,
  Permission.Viewer,
  Permission.ReadProject,
  Permission.ProjectUser,
  Permission.IncidentAdmin,
  Permission.IncidentMember,
  Permission.EditProjectIncident,
  Permission.DeleteProjectIncident,
  Permission.EditIncidentPostmortemStatus,
  Permission.AlertAdmin,
  Permission.AlertMember,
  Permission.EditAlert,
  Permission.DeleteAlert,
];

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(RETENTION_COLUMNS)(
  "Project.$column: the column",
  ({ column, title }: { column: string; title: string }) => {
    const project: Project = new Project();

    it("is a required number of days, 0 - keep every one - unless someone picks a length", () => {
      const metadata: ColumnMetadata = metadataOf(column);

      expect(metadata.type).toBe(TableColumnType.Number);
      expect(metadata.required).toBe(true);
      expect(metadata.isDefaultValueColumn).toBe(true);
      expect(metadata.defaultValue).toBe(0);
      expect(metadata.defaultValue).toBe(
        DEFAULT_RESOLVED_RECORD_RETENTION_IN_DAYS,
      );
      expect(metadata.title).toBe(title);
      expect(RESOLVED_RECORD_RETENTION_CHOICES_IN_DAYS).toContain(
        metadata.example,
      );
    });

    it("its description names every choice, Never as 0, and that what is not resolved stays", () => {
      const description: string = metadataOf(column).description || "";

      for (const days of RESOLVED_RECORD_RETENTION_CHOICES_IN_DAYS) {
        expect(description).toContain(String(days));
      }

      expect(description).toMatch(
        /0 to keep every (incident|alert) \(the default\)/,
      );
      expect(description).toMatch(/that are not resolved are never deleted/);
    });

    it("a Project Owner or Project Admin writes it, and nobody names it on a new project", () => {
      expect(project.getColumnAccessControlFor(column)?.update).toEqual([
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
      ]);
      expect(project.getColumnAccessControlFor(column)?.create).toEqual([]);
    });

    it("is read as the project's other settings are: the settings page says it to everyone", () => {
      expect(project.getColumnAccessControlFor(column)).toEqual(
        project.getColumnAccessControlFor("discoveredDeviceRetentionInDays"),
      );
    });

    it.each([Permission.ProjectOwner, Permission.ProjectAdmin])(
      "the column layer lets %s write a length or Never",
      (permission: Permission) => {
        expect(
          mayWrite({ [column]: 90 }, DatabaseRequestType.Update, permission),
        ).toBe(true);
        expect(
          mayWrite({ [column]: 0 }, DatabaseRequestType.Update, permission),
        ).toBe(true);
      },
    );

    it.each(REFUSED_WRITERS)("and refuses %s", (permission: Permission) => {
      expect(
        mayWrite({ [column]: 90 }, DatabaseRequestType.Update, permission),
      ).toBe(false);
    });

    it("is not set when a project is created, even by its future owner", () => {
      expect(
        mayWrite(
          { name: "Acme Retail", [column]: 30 },
          DatabaseRequestType.Create,
          Permission.User,
        ),
      ).toBe(false);
      expect(
        mayWrite(
          { name: "Acme Retail" },
          DatabaseRequestType.Create,
          Permission.User,
        ),
      ).toBe(true);
    });
  },
);

describe("Project.keepIncidentsWithCompletedPostmortem: the column", () => {
  const project: Project = new Project();

  it("is a required switch, on unless someone turns it off", () => {
    const metadata: ColumnMetadata = metadataOf(KEEP_COLUMN);

    expect(metadata.type).toBe(TableColumnType.Boolean);
    expect(metadata.required).toBe(true);
    expect(metadata.isDefaultValueColumn).toBe(true);
    expect(metadata.defaultValue).toBe(true);
    expect(metadata.defaultValue).toBe(
      DEFAULT_KEEP_INCIDENTS_WITH_COMPLETED_POSTMORTEM,
    );
    expect(metadata.example).toBe(true);
    expect(metadata.title).toBe("Keep Incidents With a Completed Postmortem");
    expect(metadata.description).toContain("never deleted");
  });

  it("is written and read as the retention it qualifies", () => {
    expect(project.getColumnAccessControlFor(KEEP_COLUMN)).toEqual(
      project.getColumnAccessControlFor(INCIDENT_COLUMN),
    );
  });

  it.each([Permission.ProjectOwner, Permission.ProjectAdmin])(
    "%s may turn it off",
    (permission: Permission) => {
      expect(
        mayWrite(
          { [KEEP_COLUMN]: false },
          DatabaseRequestType.Update,
          permission,
        ),
      ).toBe(true);
    },
  );

  it.each(REFUSED_WRITERS)("%s may not", (permission: Permission) => {
    expect(
      mayWrite(
        { [KEEP_COLUMN]: false },
        DatabaseRequestType.Update,
        permission,
      ),
    ).toBe(false);
  });
});

describe("ProjectService.applyResolvedRecordRetentionRules: what a project may store", () => {
  it.each([...RESOLVED_RECORD_RETENTION_CHOICES_IN_DAYS, 0])(
    "%p days is stored as written, for incidents and for alerts",
    (days: number) => {
      const data: Record<string, unknown> = {
        [INCIDENT_COLUMN]: days,
        [ALERT_COLUMN]: days,
      };

      ProjectService.applyResolvedRecordRetentionRules(data);

      expect(data).toEqual({ [INCIDENT_COLUMN]: days, [ALERT_COLUMN]: days });
    },
  );

  it("a choice written as text, as a form or Terraform may send it, is stored as the number", () => {
    const data: Record<string, unknown> = {
      [INCIDENT_COLUMN]: " 365 ",
      [ALERT_COLUMN]: "0",
    };

    ProjectService.applyResolvedRecordRetentionRules(data);

    expect(data).toEqual({ [INCIDENT_COLUMN]: 365, [ALERT_COLUMN]: 0 });
  });

  it("a write that leaves them out is not judged on them, and does not gain them", () => {
    const data: Record<string, unknown> = {
      name: "Renamed",
      [KEEP_COLUMN]: false,
    };

    ProjectService.applyResolvedRecordRetentionRules(data);

    expect(data).toEqual({ name: "Renamed", [KEEP_COLUMN]: false });
  });

  it("each column is judged on its own: an alert value is not refused for an incident one", () => {
    const data: Record<string, unknown> = { [ALERT_COLUMN]: 730 };

    ProjectService.applyResolvedRecordRetentionRules(data);

    expect(data).toEqual({ [ALERT_COLUMN]: 730 });
  });

  it.each([
    [null],
    [45],
    [7],
    [14],
    [1],
    [-30],
    [30.5],
    [366],
    [3650],
    ["30 days"],
    ["never"],
    [""],
    [true],
    [{ days: 30 }],
    [[30]],
  ])("%p is refused, with the choices", (value: unknown) => {
    expect(() => {
      ProjectService.applyResolvedRecordRetentionRules({
        incidentRetentionInDays: value,
      });
    }).toThrow(new BadDataException(INCIDENT_REFUSAL));

    expect(() => {
      ProjectService.applyResolvedRecordRetentionRules({
        alertRetentionInDays: value,
      });
    }).toThrow(new BadDataException(ALERT_REFUSAL));
  });

  it("a refusal names the setting that was wrong", () => {
    expect(() => {
      ProjectService.applyResolvedRecordRetentionRules({
        incidentRetentionInDays: 90,
        alertRetentionInDays: 45,
      });
    }).toThrow(new BadDataException(ALERT_REFUSAL));
  });

  it("works on a Project model instance, as onBeforeCreate hands it one", () => {
    const project: Project = new Project();
    project.name = "Acme Retail";
    project.incidentRetentionInDays = 1095;
    project.alertRetentionInDays = 30;

    ProjectService.applyResolvedRecordRetentionRules(project);

    expect(project.incidentRetentionInDays).toBe(1095);
    expect(project.alertRetentionInDays).toBe(30);
    expect(project.name).toBe("Acme Retail");
  });

  it("starts unset on a new Project model: the database's default applies", () => {
    const project: Project = new Project();

    expect(project.incidentRetentionInDays).toBeUndefined();
    expect(project.alertRetentionInDays).toBeUndefined();
    expect(project.keepIncidentsWithCompletedPostmortem).toBeUndefined();
  });
});

describe("ProjectService: the rule runs on every write of the project", () => {
  it("an update with days that are not a choice is refused before anything is read", async () => {
    const find: SpyInstance<typeof ProjectService.findBy> = jest.spyOn(
      ProjectService,
      "findBy",
    );

    await expect(
      hooks.onBeforeUpdate({
        query: { _id: PROJECT_ID.toString() },
        data: { incidentRetentionInDays: 45 },
        props: { isRoot: true },
      } as unknown as UpdateBy<Project>),
    ).rejects.toThrow(INCIDENT_REFUSAL);
    await expect(
      hooks.onBeforeUpdate({
        query: { _id: PROJECT_ID.toString() },
        data: { alertRetentionInDays: 7 },
        props: { isRoot: true },
      } as unknown as UpdateBy<Project>),
    ).rejects.toThrow(ALERT_REFUSAL);
    expect(find).not.toHaveBeenCalled();
  });

  it("an update with a choice written as text is written as the number", async () => {
    const result: OnUpdate<Project> = await hooks.onBeforeUpdate({
      query: { _id: PROJECT_ID.toString() },
      data: { incidentRetentionInDays: "180", alertRetentionInDays: "60" },
      props: { isRoot: true },
    } as unknown as UpdateBy<Project>);

    const data: Record<string, unknown> = result.updateBy.data as Record<
      string,
      unknown
    >;

    expect(data[INCIDENT_COLUMN]).toBe(180);
    expect(data[ALERT_COLUMN]).toBe(60);
  });

  it("an update to Never is written as 0", async () => {
    const result: OnUpdate<Project> = await hooks.onBeforeUpdate({
      query: { _id: PROJECT_ID.toString() },
      data: { incidentRetentionInDays: 0 },
      props: { isRoot: true },
    } as unknown as UpdateBy<Project>);

    expect(
      (result.updateBy.data as Record<string, unknown>)[INCIDENT_COLUMN],
    ).toBe(0);
  });

  it("an update that empties one is refused: the columns always hold a value", async () => {
    await expect(
      hooks.onBeforeUpdate({
        query: { _id: PROJECT_ID.toString() },
        data: { alertRetentionInDays: null },
        props: { isRoot: true },
      } as unknown as UpdateBy<Project>),
    ).rejects.toThrow(ALERT_REFUSAL);
  });

  it("an update of the postmortem switch alone is not judged on the lengths", async () => {
    const result: OnUpdate<Project> = await hooks.onBeforeUpdate({
      query: { _id: PROJECT_ID.toString() },
      data: { keepIncidentsWithCompletedPostmortem: false },
      props: { isRoot: true },
    } as unknown as UpdateBy<Project>);

    expect(result.updateBy.data as Record<string, unknown>).toEqual({
      keepIncidentsWithCompletedPostmortem: false,
    });
  });

  it("a project created with days that are not a choice is refused", async () => {
    const project: Project = new Project();
    project.name = "Acme Retail";
    project.alertRetentionInDays = 3;

    await expect(
      hooks.onBeforeCreate({
        data: project,
        props: { isRoot: true },
      } as unknown as CreateBy<Project>),
    ).rejects.toThrow(ALERT_REFUSAL);
  });
});
