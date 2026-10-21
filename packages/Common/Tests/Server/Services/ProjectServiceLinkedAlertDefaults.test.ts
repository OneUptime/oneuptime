import DatabaseConfig from "../../../Server/DatabaseConfig";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { getJestSpyOn } from "../../Spy";

/*
 * A new project's linked alert switches come from the database default.
 *
 * "Acknowledge Linked Alerts When Incident Is Acknowledged" and "Resolve
 * Linked Alerts When Incident Is Resolved" are on by default as COLUMN
 * defaults (1797300000000-TurnOnLinkedAlertSwitchesByDefault), not set by a
 * create hook. That only works while nothing on the way to the INSERT
 * writes a value for them: TypeORM leaves an unset column out of the
 * statement and Postgres fills in true, while an explicit false - from a
 * hook, a forced default or a create request - would silently keep every
 * new project off.
 *
 * Pinned here, without a database:
 *  - ProjectService.onBeforeCreate leaves both switches unset, for a
 *    dashboard create and a root create alike;
 *  - neither column has a forced create-time default (DatabaseService's
 *    generateDefaultValues);
 *  - a create request cannot set them: the column permission check that runs
 *    after the hook refuses the column for a project creator.
 * IncidentAlertPostgres.test.ts checks the migrated default on a real insert.
 */
jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...jest.requireActual("../../../Server/EnvironmentConfig"),
    IsBillingEnabled: false,
    NotificationSlackWebhookOnCreateProject: "",
  };
});

const USER_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");

const SWITCHES: Array<
  | "acknowledgeLinkedAlertsWhenIncidentAcknowledged"
  | "resolveLinkedAlertsWhenIncidentResolved"
> = [
  "acknowledgeLinkedAlertsWhenIncidentAcknowledged",
  "resolveLinkedAlertsWhenIncidentResolved",
];

function userProps(): DatabaseCommonInteractionProps {
  // What a signed-in dashboard user carries when creating a project.
  return {
    userId: USER_ID,
    userGlobalAccessPermission: {
      globalPermissions: [Permission.Public, Permission.User],
      projectIds: [],
      _type: "UserGlobalAccessPermission",
    },
  } as DatabaseCommonInteractionProps;
}

async function runOnBeforeCreate(
  project: Project,
  props: DatabaseCommonInteractionProps = userProps(),
): Promise<Project> {
  const result: OnCreate<Project> = await (
    ProjectService as unknown as {
      onBeforeCreate: (
        createBy: CreateBy<Project>,
      ) => Promise<OnCreate<Project>>;
    }
  ).onBeforeCreate({
    data: project,
    props,
  } as CreateBy<Project>);

  return result.createBy.data;
}

function valueOf(project: Project, column: string): unknown {
  return (project as unknown as Record<string, unknown>)[column];
}

describe("a new project's linked alert switches", () => {
  beforeEach(() => {
    getJestSpyOn(UserService, "findOneById").mockResolvedValue(
      new User() as never,
    );
    getJestSpyOn(
      DatabaseConfig,
      "shouldDisableUserProjectCreation",
    ).mockResolvedValue(false as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("are left unset by a dashboard create, so the database default applies", async () => {
    const project: Project = new Project();
    project.name = "Acme";

    const created: Project = await runOnBeforeCreate(project);

    for (const column of SWITCHES) {
      expect({ column, value: valueOf(created, column) }).toEqual({
        column,
        value: undefined,
      });
    }

    // The hook did run: it sets the number prefixes on the same create.
    expect(created.incidentNumberPrefix).toBe("INC-");
  });

  it("are left unset by a root create (a seeded or admin-created project)", async () => {
    const project: Project = new Project();
    project.name = "Seeded";

    const created: Project = await runOnBeforeCreate(project, {
      userId: USER_ID,
      isRoot: true,
    });

    for (const column of SWITCHES) {
      expect({ column, value: valueOf(created, column) }).toEqual({
        column,
        value: undefined,
      });
    }
  });

  it("have no forced create-time default that would override the column default", () => {
    const project: Project = new Project();

    for (const column of SWITCHES) {
      const metadata: TableColumnMetadata =
        project.getTableColumnMetadata(column);

      expect({
        column,
        forced: Boolean(metadata.forceGetDefaultValueOnCreate),
      }).toEqual({ column, forced: false });
    }
  });

  it("a create request can carry neither switch, so no create starts a project off", () => {
    for (const column of SWITCHES) {
      for (const value of [false, true]) {
        const project: Project = new Project();
        project.name = "Acme";
        (project as unknown as Record<string, unknown>)[column] = value;

        expect(() => {
          ColumnPermissions.checkDataColumnPermissions(
            Project,
            project,
            userProps(),
            DatabaseRequestType.Create,
          );
        }).toThrow(new RegExp(column));
      }
    }
  });

  // Control: the same check lets a plain create through.
  it("a create request without them passes the column permission check", async () => {
    const project: Project = new Project();
    project.name = "Acme";

    const created: Project = await runOnBeforeCreate(project);

    expect(() => {
      ColumnPermissions.checkDataColumnPermissions(
        Project,
        created,
        userProps(),
        DatabaseRequestType.Create,
      );
    }).not.toThrow();
  });
});
