import DatabaseConfig from "../../../Server/DatabaseConfig";
import ProjectService, {
  NEW_PROJECT_AI_DEFAULT_COLUMNS,
  NewProjectAiDefaultColumn,
  NewProjectAiDefaults,
} from "../../../Server/Services/ProjectService";
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
import TableColumnType from "../../../Types/Database/TableColumnType";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { getJestSpyOn } from "../../Spy";

/*
 * New projects start with every AI feature on - but fixing, and the pull
 * requests that are part of it.
 *
 * Each per-feature AI switch on Project is switched on by
 * ProjectService.onBeforeCreate when the create request leaves it unset —
 * every project created in the dashboard — and NOT by a column default:
 * a default would reach the generated Terraform provider as a static
 * default and flip existing Terraform-managed projects on their next
 * apply, and a backfill would start spending existing projects' AI budget.
 *
 * Pinned here:
 *  - unset becomes on; an explicit value (either way) is kept;
 *  - the list covers every boolean AI feature switch the model has, so a
 *    switch added later cannot be left off for new projects by accident;
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

type AiFlags = NewProjectAiDefaults;

/*
 * The fixing switches: fixing new incidents and alerts changes
 * infrastructure, so a project turns it on itself.
 */
const FIX_SWITCHES: Array<string> = [
  "enableAutomaticIncidentRemediation",
  "enableAutomaticAlertRemediation",
];

/*
 * The pull requests that are part of fixing (Types/AI/AutomaticFixSwitches):
 * they open only while fixing is on, and come on with it, so a new project
 * starts with them off like fixing.
 */
const FIX_PULL_REQUEST_SWITCHES: Array<string> = [
  "enableAutomaticIncidentCodeFixes",
  "enableIncidentInstrumentationFixTasks",
  "enableAutomaticAlertCodeFixes",
  "enableAlertInstrumentationFixTasks",
];

// The switches a new project starts without.
const OFF_FOR_NEW_PROJECTS: Array<string> = [
  ...FIX_SWITCHES,
  ...FIX_PULL_REQUEST_SWITCHES,
];

// The six switches, written out so a column dropped from the list fails here.
const AI_SWITCHES: Array<NewProjectAiDefaultColumn> = [
  "enableAutomaticIncidentInvestigation",
  "enableAutomaticAlertInvestigation",
  "enableAutomaticPostmortemDraft",
  "enableAiInsights",
  "enableInsightFixTasks",
  "autoArchiveNonActionableExceptions",
];

function allSwitches(value: boolean | null): AiFlags {
  const flags: AiFlags = {};

  for (const column of AI_SWITCHES) {
    flags[column] = value;
  }

  return flags;
}

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

describe("NEW_PROJECT_AI_DEFAULT_COLUMNS", () => {
  it("lists the six per-feature AI switches", () => {
    expect([...NEW_PROJECT_AI_DEFAULT_COLUMNS].sort()).toEqual(
      [...AI_SWITCHES].sort(),
    );
  });

  /*
   * Found from the model rather than from the list: every Boolean column
   * whose name, title or description mentions AI is a feature switch,
   * except the ones named below. The balance and notification-sent columns
   * are bookkeeping, Enable AI defaults to true in the column, and the
   * automatic-fix switches - with the pull requests that are part of
   * fixing - start off on purpose.
   */
  it("covers every boolean AI feature switch on the Project model", () => {
    const project: Project = new Project();
    const mentionsAi: RegExp = /\bAI\b|Ai[A-Z]/;
    const notFeatureSwitches: Array<string> = [
      "enableAi",
      "enableAutoRechargeAiBalance",
      "lowAiBalanceNotificationSentToOwners",
      "failedAiBalanceChargeNotificationSentToOwners",
      "notEnabledAiNotificationSentToOwners",
      ...OFF_FOR_NEW_PROJECTS,
    ];

    const aiBooleanColumns: Array<string> = Object.keys(project)
      .filter((column: string) => {
        const metadata: ReturnType<Project["getTableColumnMetadata"]> =
          project.getTableColumnMetadata(column);

        return (
          metadata?.type === TableColumnType.Boolean &&
          mentionsAi.test(`${column} ${metadata.title} ${metadata.description}`)
        );
      })
      .filter((column: string) => {
        return !notFeatureSwitches.includes(column);
      });

    expect(aiBooleanColumns.sort()).toEqual([...AI_SWITCHES].sort());
  });
});

describe("the automatic-fix switches", () => {
  it.each(OFF_FOR_NEW_PROJECTS)(
    "%s is a Boolean AI switch that defaults to off in the column",
    (column: string) => {
      const project: Project = new Project();
      const metadata: ReturnType<Project["getTableColumnMetadata"]> =
        project.getTableColumnMetadata(column);

      expect(metadata?.type).toBe(TableColumnType.Boolean);
      expect(metadata?.defaultValue).toBe(false);
      expect(metadata?.required).toBe(true);
      expect(`${metadata?.title} ${metadata?.description}`).toMatch(/\bAI\b/);
    },
  );

  it("is never a new project's default", () => {
    for (const column of OFF_FOR_NEW_PROJECTS) {
      expect(
        NEW_PROJECT_AI_DEFAULT_COLUMNS as ReadonlyArray<string>,
      ).not.toContain(column);
    }
  });

  it("stays unset when a new project gets its AI defaults, so the column's off applies", () => {
    const project: Project = new Project();

    ProjectService.applyNewProjectAiDefaults(project);

    for (const column of OFF_FOR_NEW_PROJECTS) {
      expect({
        [column]: (project as unknown as Record<string, unknown>)[column],
      }).toEqual({ [column]: undefined });
    }
  });

  it("keeps an explicit on in a create request", async () => {
    const user: User = new User();
    getJestSpyOn(UserService, "findOneById").mockResolvedValue(user as never);
    getJestSpyOn(
      DatabaseConfig,
      "shouldDisableUserProjectCreation",
    ).mockResolvedValue(false as never);

    const project: Project = new Project();
    project.name = "Acme";
    project.enableAutomaticIncidentRemediation = true;
    project.enableAutomaticIncidentCodeFixes = true;

    const created: Project = await runOnBeforeCreate(project);

    expect(created.enableAutomaticIncidentRemediation).toBe(true);
    expect(created.enableAutomaticIncidentCodeFixes).toBe(true);
    expect(created.enableAutomaticAlertRemediation).toBeUndefined();
    // The server turns no pull-request switch on with fixing.
    expect(created.enableIncidentInstrumentationFixTasks).toBeUndefined();

    jest.restoreAllMocks();
  });

  it.each(FIX_PULL_REQUEST_SWITCHES)(
    "%s says it is part of fixing, names its fixing switch, and starts off",
    (column: string) => {
      const description: string | undefined =
        new Project().getTableColumnMetadata(column).description;
      const fixColumn: string = column.includes("Incident")
        ? "enableAutomaticIncidentRemediation"
        : "enableAutomaticAlertRemediation";

      expect(description).toContain("Part of fixing: it acts only while");
      expect(description).toContain(fixColumn);
      expect(description).toContain("Off for new projects.");
      expect(description).not.toContain(
        "On for new projects created in OneUptime",
      );
    },
  );

  it.each(FIX_SWITCHES)(
    "%s names the pull-request switches it holds, and says the API sets them in the same request",
    (column: string) => {
      const description: string | undefined =
        new Project().getTableColumnMetadata(column).description;
      const pullRequests: Array<string> = FIX_PULL_REQUEST_SWITCHES.filter(
        (pullRequest: string): boolean => {
          return (
            pullRequest.includes("Incident") === column.includes("Incident")
          );
        },
      );

      expect(pullRequests).toHaveLength(2);
      for (const pullRequest of pullRequests) {
        expect(description).toContain(pullRequest);
      }
      expect(description).toContain(
        "they open pull requests only while this is on",
      );
      expect(description).toContain(
        "through the API, set them in the same request",
      );
    },
  );
});

describe("ProjectService.applyNewProjectAiDefaults", () => {
  it("turns every AI switch on when the request leaves them unset", () => {
    const data: AiFlags = {};

    ProjectService.applyNewProjectAiDefaults(data);

    expect(data).toEqual(allSwitches(true));
  });

  it("treats null like unset", () => {
    const data: AiFlags = allSwitches(null);

    ProjectService.applyNewProjectAiDefaults(data);

    expect(data).toEqual(allSwitches(true));
  });

  it.each(AI_SWITCHES)(
    "keeps an explicit off for %s and turns the others on",
    (column: NewProjectAiDefaultColumn) => {
      const data: AiFlags = { [column]: false };

      ProjectService.applyNewProjectAiDefaults(data);

      expect(data).toEqual({ ...allSwitches(true), [column]: false });
    },
  );

  it("keeps every switch off when the request turns them all off", () => {
    const data: AiFlags = allSwitches(false);

    ProjectService.applyNewProjectAiDefaults(data);

    expect(data).toEqual(allSwitches(false));
  });

  it("keeps an explicit on", () => {
    const data: AiFlags = allSwitches(true);

    ProjectService.applyNewProjectAiDefaults(data);

    expect(data).toEqual(allSwitches(true));
  });

  it("leaves Enable AI and the AI balance auto-recharge alone", () => {
    const project: Project = new Project();

    ProjectService.applyNewProjectAiDefaults(project);

    expect(project.enableAi).toBeUndefined();
    expect(project.enableAutoRechargeAiBalance).toBeUndefined();
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

  it("a project created in the dashboard starts with every AI switch on", async () => {
    const project: Project = new Project();
    project.name = "Acme";

    const created: Project = await runOnBeforeCreate(project);

    for (const column of AI_SWITCHES) {
      expect({ [column]: created[column] }).toEqual({ [column]: true });
    }
  });

  it("a create request that turns them off keeps them off", async () => {
    const project: Project = new Project();
    project.name = "Acme";

    for (const column of AI_SWITCHES) {
      project[column] = false;
    }

    const created: Project = await runOnBeforeCreate(project);

    for (const column of AI_SWITCHES) {
      expect({ [column]: created[column] }).toEqual({ [column]: false });
    }
  });

  it("applies to a root create too (a seeded or admin-created project)", async () => {
    const project: Project = new Project();
    project.name = "Seeded";

    const created: Project = await runOnBeforeCreate(project, {
      userId: USER_ID,
      isRoot: true,
    });

    for (const column of AI_SWITCHES) {
      expect({ [column]: created[column] }).toEqual({ [column]: true });
    }
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

describe("Project AI switch columns", () => {
  const project: Project = new Project();

  it.each(AI_SWITCHES)(
    "%s defaults off in the column, so no existing project is switched on",
    (column: string) => {
      expect(project.getTableColumnMetadata(column).defaultValue).toBe(false);
    },
  );

  it.each(AI_SWITCHES)(
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

  it.each(AI_SWITCHES)(
    "the description of %s says new projects start with it on",
    (column: string) => {
      const description: string | undefined =
        project.getTableColumnMetadata(column).description;

      expect(description).toContain("On for new projects created in OneUptime");
      expect(description).not.toMatch(/off by default/i);
    },
  );

  it("the incident description points at the separate postmortem setting", () => {
    expect(
      project.getTableColumnMetadata("enableAutomaticIncidentInvestigation")
        .description,
    ).toContain("Enable Automatic Postmortem Draft");
  });
});
