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
import TableColumnType from "../../../Types/Database/TableColumnType";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { DEFAULT_ENTITY_RISK_CASE_THRESHOLD } from "../../../Types/SecurityCase/SecurityEntityRisk";
import { getJestSpyOn } from "../../Spy";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * A new project opens security cases from entity risk; a project that
 * existed before does not until someone turns it on.
 *
 * The switch is turned on by ProjectService.onBeforeCreate when the create
 * request leaves it unset - every project created in the dashboard - and
 * NOT by its column's default, which stays off: an upgrade must open no case
 * nobody asked for, and a default reaches the generated Terraform provider
 * as a static default that would flip Terraform-managed projects on their
 * next apply. The threshold's column holds 100 for every project.
 */
jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...jest.requireActual("../../../Server/EnvironmentConfig"),
    IsBillingEnabled: false,
    NotificationSlackWebhookOnCreateProject: "",
  };
});

const USER_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");

function userProps(): DatabaseCommonInteractionProps {
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

describe("the entity risk columns", () => {
  it("risk cases are a switch that is off in its column, so every project that exists keeps them off", () => {
    const metadata: ReturnType<Project["getTableColumnMetadata"]> =
      new Project().getTableColumnMetadata("enableSecurityRiskCases");

    expect(metadata?.type).toBe(TableColumnType.Boolean);
    expect(metadata?.required).toBe(true);
    expect(metadata?.defaultValue).toBe(false);
    expect(metadata?.isDefaultValueColumn).toBe(true);
    expect(metadata?.description?.length).toBeLessThanOrEqual(150);
  });

  it("the threshold is a number, 100 for every project", () => {
    const metadata: ReturnType<Project["getTableColumnMetadata"]> =
      new Project().getTableColumnMetadata("securityRiskCaseThreshold");

    expect(DEFAULT_ENTITY_RISK_CASE_THRESHOLD).toBe(100);
    expect(metadata?.type).toBe(TableColumnType.Number);
    expect(metadata?.required).toBe(true);
    expect(metadata?.defaultValue).toBe(DEFAULT_ENTITY_RISK_CASE_THRESHOLD);
    expect(metadata?.isDefaultValueColumn).toBe(true);
    expect(metadata?.description?.length).toBeLessThanOrEqual(150);
  });

  it("only a Project Owner or Admin changes either, as they change the project's AI triage", () => {
    const project: Project = new Project();

    for (const column of [
      "enableSecurityRiskCases",
      "securityRiskCaseThreshold",
      "enableAutomaticSecurityCaseTriage",
    ]) {
      expect(project.getColumnAccessControlFor(column)?.update).toEqual([
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
      ]);
    }
  });
});

describe("ProjectService.applyNewProjectSecurityDefaults", () => {
  it("turns risk cases on when the request leaves them unset or null", () => {
    const unset: { enableSecurityRiskCases?: boolean | null } = {};
    const asNull: { enableSecurityRiskCases?: boolean | null } = {
      enableSecurityRiskCases: null,
    };

    ProjectService.applyNewProjectSecurityDefaults(unset);
    ProjectService.applyNewProjectSecurityDefaults(asNull);

    expect(unset.enableSecurityRiskCases).toBe(true);
    expect(asNull.enableSecurityRiskCases).toBe(true);
  });

  it("keeps what the request says", () => {
    const off: { enableSecurityRiskCases?: boolean | null } = {
      enableSecurityRiskCases: false,
    };

    ProjectService.applyNewProjectSecurityDefaults(off);

    expect(off.enableSecurityRiskCases).toBe(false);
  });

  it("leaves the threshold to its column", () => {
    const project: Project = new Project();

    ProjectService.applyNewProjectSecurityDefaults(project);

    expect(project.securityRiskCaseThreshold).toBeUndefined();
  });
});

describe("ProjectService.onBeforeCreate: entity risk for a new project", () => {
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

  it("a project created in the dashboard opens cases from risk", async () => {
    const project: Project = new Project();
    project.name = "Acme";

    const created: Project = await runOnBeforeCreate(project);

    expect(created.enableSecurityRiskCases).toBe(true);
  });

  it("a create request that turns it off keeps it off", async () => {
    const project: Project = new Project();
    project.name = "Acme";
    project.enableSecurityRiskCases = false;

    const created: Project = await runOnBeforeCreate(project);

    expect(created.enableSecurityRiskCases).toBe(false);
  });

  it("applies to a root create too", async () => {
    const project: Project = new Project();
    project.name = "Seeded";

    const created: Project = await runOnBeforeCreate(project, {
      userId: USER_ID,
      isRoot: true,
    });

    expect(created.enableSecurityRiskCases).toBe(true);
  });

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
});
