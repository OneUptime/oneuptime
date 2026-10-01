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
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { getJestSpyOn } from "../../Spy";

/*
 * New projects start with AI investigating their incidents and alerts.
 *
 * The two automatic-investigation opt-ins are switched on by
 * ProjectService.onBeforeCreate when the create request leaves them unset —
 * every project created in the dashboard — and NOT by a column default:
 * a default would reach the generated Terraform provider as a static
 * default and flip existing Terraform-managed projects on their next
 * apply, and a backfill would start spending existing projects' AI budget.
 *
 * Pinned here:
 *  - unset becomes on; an explicit value (either way) is kept;
 *  - postmortem drafting is NOT switched on (its own opt-in, off);
 *  - the hook really runs on a dashboard create and the result still
 *    passes the column permission check a non-root create goes through
 *    AFTER the hook (a server-set column the creator may not write would
 *    fail every project creation).
 *
 * Nothing below the service boundary runs: no database, no Stripe.
 */
jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...jest.requireActual("../../../Server/EnvironmentConfig"),
    IsBillingEnabled: false,
    NotificationSlackWebhookOnCreateProject: "",
  };
});

const USER_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");

type AiFlags = {
  enableAutomaticIncidentInvestigation?: boolean | null | undefined;
  enableAutomaticAlertInvestigation?: boolean | null | undefined;
};

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

describe("ProjectService.applyNewProjectAiDefaults", () => {
  it("turns both automatic investigations on when the request leaves them unset", () => {
    const data: AiFlags = {};

    ProjectService.applyNewProjectAiDefaults(data);

    expect(data).toEqual({
      enableAutomaticIncidentInvestigation: true,
      enableAutomaticAlertInvestigation: true,
    });
  });

  it("treats null like unset", () => {
    const data: AiFlags = {
      enableAutomaticIncidentInvestigation: null,
      enableAutomaticAlertInvestigation: null,
    };

    ProjectService.applyNewProjectAiDefaults(data);

    expect(data.enableAutomaticIncidentInvestigation).toBe(true);
    expect(data.enableAutomaticAlertInvestigation).toBe(true);
  });

  it("keeps an explicit off, for each flag on its own", () => {
    const incidentOff: AiFlags = {
      enableAutomaticIncidentInvestigation: false,
    };
    ProjectService.applyNewProjectAiDefaults(incidentOff);
    expect(incidentOff).toEqual({
      enableAutomaticIncidentInvestigation: false,
      enableAutomaticAlertInvestigation: true,
    });

    const alertOff: AiFlags = { enableAutomaticAlertInvestigation: false };
    ProjectService.applyNewProjectAiDefaults(alertOff);
    expect(alertOff).toEqual({
      enableAutomaticIncidentInvestigation: true,
      enableAutomaticAlertInvestigation: false,
    });
  });

  it("keeps an explicit on", () => {
    const data: AiFlags = {
      enableAutomaticIncidentInvestigation: true,
      enableAutomaticAlertInvestigation: true,
    };

    ProjectService.applyNewProjectAiDefaults(data);

    expect(data).toEqual({
      enableAutomaticIncidentInvestigation: true,
      enableAutomaticAlertInvestigation: true,
    });
  });

  it("does not switch postmortem drafting on", () => {
    const project: Project = new Project();

    ProjectService.applyNewProjectAiDefaults(project);

    expect(project.enableAutomaticPostmortemDraft).toBeUndefined();
  });
});

describe("ProjectService.onBeforeCreate: AI defaults for a new project", () => {
  beforeEach(() => {
    const user: User = new User();

    getJestSpyOn(UserService, "findOneById").mockResolvedValue(user as never);
    getJestSpyOn(
      DatabaseConfig,
      "shouldDisableUserProjectCreation",
    ).mockResolvedValue(false as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("a project created in the dashboard investigates incidents and alerts, and does not draft postmortems", async () => {
    const project: Project = new Project();
    project.name = "Acme";

    const created: Project = await runOnBeforeCreate(project);

    expect(created.enableAutomaticIncidentInvestigation).toBe(true);
    expect(created.enableAutomaticAlertInvestigation).toBe(true);
    expect(created.enableAutomaticPostmortemDraft).toBeUndefined();
  });

  it("a create request that turns them off keeps them off", async () => {
    const project: Project = new Project();
    project.name = "Acme";
    project.enableAutomaticIncidentInvestigation = false;
    project.enableAutomaticAlertInvestigation = false;

    const created: Project = await runOnBeforeCreate(project);

    expect(created.enableAutomaticIncidentInvestigation).toBe(false);
    expect(created.enableAutomaticAlertInvestigation).toBe(false);
  });

  it("applies to a root create too (a seeded or admin-created project)", async () => {
    const project: Project = new Project();
    project.name = "Seeded";

    const created: Project = await runOnBeforeCreate(project, {
      userId: USER_ID,
      isRoot: true,
    });

    expect(created.enableAutomaticIncidentInvestigation).toBe(true);
    expect(created.enableAutomaticAlertInvestigation).toBe(true);
  });

  /*
   * DatabaseService checks the create's columns against the caller's
   * permissions AFTER onBeforeCreate. The defaults the hook sets must be
   * columns a project creator may write, or every dashboard project
   * creation fails with "User is not allowed to create on ...".
   */
  it("what the hook sets still passes the column permission check of a non-root create", async () => {
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

  // Negative control: the check above really does refuse server-only columns.
  it("negative control: the same check refuses a column a creator may not write", () => {
    const project: Project = new Project();
    project.name = "Acme";
    project.enableAi = false;

    expect(() => {
      ColumnPermissions.checkDataColumnPermissions(
        Project,
        project,
        userProps(),
        DatabaseRequestType.Create,
      );
    }).toThrow(/enableAi/);
  });
});

describe("Project automatic AI columns", () => {
  const project: Project = new Project();

  it.each([
    "enableAutomaticIncidentInvestigation",
    "enableAutomaticAlertInvestigation",
    "enableAutomaticPostmortemDraft",
  ])(
    "%s defaults off in the column, so no existing project is switched on",
    (column: string) => {
      expect(project.getTableColumnMetadata(column).defaultValue).toBe(false);
    },
  );

  it.each([
    "enableAutomaticIncidentInvestigation",
    "enableAutomaticAlertInvestigation",
    "enableAutomaticPostmortemDraft",
  ])(
    "%s may be set by the project's creator and changed only by an owner or admin",
    (column: string) => {
      const acl: ReturnType<Project["getColumnAccessControlFor"]> =
        project.getColumnAccessControlFor(column);

      expect(acl?.create).toEqual([Permission.User]);
      expect([...(acl?.update || [])].sort()).toEqual(
        [Permission.ProjectOwner, Permission.ProjectAdmin].sort(),
      );
    },
  );

  it("the descriptions say new projects start with investigations on", () => {
    for (const column of [
      "enableAutomaticIncidentInvestigation",
      "enableAutomaticAlertInvestigation",
    ]) {
      expect(project.getTableColumnMetadata(column).description).toContain(
        "On for new projects created in OneUptime",
      );
    }
  });

  it("the incident description points at the separate postmortem setting", () => {
    expect(
      project.getTableColumnMetadata("enableAutomaticIncidentInvestigation")
        .description,
    ).toContain("Enable Automatic Postmortem Draft");
    expect(
      project.getTableColumnMetadata("enableAutomaticPostmortemDraft")
        .description,
    ).toContain("Off by default");
  });
});
