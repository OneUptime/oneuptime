import DatabaseConfig from "../../../Server/DatabaseConfig";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import {
  PROJECT_AI_RUN_LIMIT_BOUNDS,
  PROJECT_AI_RUN_LIMIT_COLUMNS,
  ProjectAiRunLimitColumn,
} from "../../../Types/AI/ProjectAiRunLimits";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { getJestSpyOn } from "../../Spy";

/*
 * What ProjectService lets anyone store in the project's own limits on one
 * AI run (issue #6440): Project.aiRunMaxModelCalls, aiRunMaxToolCalls,
 * aiRunMaxTokens and aiRunTimeLimitInMinutes. Who may write them is the
 * columns' access control (ProjectAiRunLimits.test.ts); this is what may
 * be written:
 *
 *   - nothing (null, or a blank field) is no limit - or, for the time, the
 *     default 120 minutes;
 *   - a typed "50" is the number 50;
 *   - anything else must be a whole number within the limit's bounds;
 *   - a write that does not carry a limit leaves it alone;
 *   - a new project starts with none of them.
 *
 * Nothing below the service boundary runs: no database.
 */

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  return {
    ...actual,
    NotificationSlackWebhookOnCreateProject: "",
    NotificationSlackWebhookOnSubscriptionUpdate: "",
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "21111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("26666666-6666-4666-8666-666666666666");

type Data = Record<string, unknown>;

const ERRORS: Record<ProjectAiRunLimitColumn, string> = {
  aiRunMaxModelCalls:
    "The limit of model calls per run must be a whole number from 1 to 100,000. Leave it empty for no limit.",
  aiRunMaxToolCalls:
    "The limit of tool calls per run must be a whole number from 1 to 100,000. Leave it empty for no limit.",
  aiRunMaxTokens:
    "The limit of tokens per run must be a whole number from 1,000 to 2,000,000,000. Leave it empty for no limit.",
  aiRunTimeLimitInMinutes:
    "The time limit per run must be a whole number from 1 to 1,440. Leave it empty for the default.",
};

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

async function runOnBeforeUpdate(data: Data): Promise<Data> {
  const result: OnUpdate<Project> = await (
    ProjectService as unknown as {
      onBeforeUpdate: (
        updateBy: UpdateBy<Project>,
      ) => Promise<OnUpdate<Project>>;
    }
  ).onBeforeUpdate({
    query: { _id: PROJECT_ID.toString() },
    data: data,
    props: { tenantId: PROJECT_ID, userId: USER_ID },
  } as unknown as UpdateBy<Project>);

  return result.updateBy.data as unknown as Data;
}

async function runOnBeforeCreate(project: Project): Promise<Project> {
  const result: OnCreate<Project> = await (
    ProjectService as unknown as {
      onBeforeCreate: (
        createBy: CreateBy<Project>,
      ) => Promise<OnCreate<Project>>;
    }
  ).onBeforeCreate({
    data: project,
    props: userProps(),
  } as CreateBy<Project>);

  return result.createBy.data;
}

function rules(data: Data): Data {
  ProjectService.applyAiRunLimitRules(data);
  return data;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(
  PROJECT_AI_RUN_LIMIT_COLUMNS.map((column: ProjectAiRunLimitColumn) => {
    return [column];
  }),
)("ProjectService: %s", (column: ProjectAiRunLimitColumn) => {
  const bounds: { min: number; max: number } =
    PROJECT_AI_RUN_LIMIT_BOUNDS[column];

  it("stores its bounds and a value between them as they are", () => {
    for (const value of [bounds.min, bounds.min + 1, bounds.max]) {
      expect(rules({ [column]: value })).toEqual({ [column]: value });
    }
  });

  it("stores a typed number as the number", () => {
    expect(rules({ [column]: String(bounds.min + 9) })).toEqual({
      [column]: bounds.min + 9,
    });
    expect(rules({ [column]: ` ${bounds.min} ` })).toEqual({
      [column]: bounds.min,
    });
  });

  it("stores a blank one as not set", () => {
    expect(rules({ [column]: "" })).toEqual({ [column]: null });
    expect(rules({ [column]: "   " })).toEqual({ [column]: null });
  });

  it("keeps null, which clears it", () => {
    expect(rules({ [column]: null })).toEqual({ [column]: null });
  });

  it("refuses a value outside its bounds, a fraction and what is not a number", () => {
    for (const value of [
      bounds.min - 1,
      bounds.max + 1,
      0,
      -1,
      bounds.min + 0.5,
      "2.5",
      "abc",
      true,
      { value: 5 },
    ]) {
      expect(() => {
        rules({ [column]: value });
      }).toThrow(new BadDataException(ERRORS[column]));
    }
  });

  it("refuses an invalid value on update before anything is written", async () => {
    await expect(runOnBeforeUpdate({ [column]: 0 })).rejects.toThrow(
      ERRORS[column],
    );
  });

  it("passes a valid value through an update, and a cleared field as not set", async () => {
    expect(await runOnBeforeUpdate({ [column]: bounds.min + 1 })).toEqual({
      [column]: bounds.min + 1,
    });
    expect(await runOnBeforeUpdate({ [column]: "" })).toEqual({
      [column]: null,
    });
  });
});

describe("ProjectService run limits, together", () => {
  it("leaves a write that carries none of them alone", () => {
    expect(rules({ name: "Renamed" })).toEqual({ name: "Renamed" });
    expect(rules({ aiRunMaxToolCalls: undefined })).toEqual({
      aiRunMaxToolCalls: undefined,
    });
  });

  it("checks every limit a write carries", () => {
    expect(
      rules({
        aiRunMaxModelCalls: "60",
        aiRunMaxToolCalls: 250,
        aiRunMaxTokens: "",
        aiRunTimeLimitInMinutes: 45,
      }),
    ).toEqual({
      aiRunMaxModelCalls: 60,
      aiRunMaxToolCalls: 250,
      aiRunMaxTokens: null,
      aiRunTimeLimitInMinutes: 45,
    });

    expect(() => {
      rules({ aiRunMaxModelCalls: 60, aiRunTimeLimitInMinutes: 5_000 });
    }).toThrow(new BadDataException(ERRORS.aiRunTimeLimitInMinutes));
  });

  it("works on a Project model instance, as the hooks hand it one", () => {
    const project: Project = new Project();
    project.aiRunMaxToolCalls = "300" as unknown as number;

    ProjectService.applyAiRunLimitRules(
      project as unknown as Record<string, unknown>,
    );

    expect(project.aiRunMaxToolCalls).toBe(300);
    // An instance carries every column: the unset ones are left unset.
    expect(project.aiRunMaxModelCalls).toBeUndefined();
    expect(project.aiRunMaxTokens).toBeUndefined();
    expect(project.aiRunTimeLimitInMinutes).toBeUndefined();
  });

  it("an update of a daily limit and a run limit checks both", async () => {
    await expect(
      runOnBeforeUpdate({ aiDailyTokenLimit: 200_000, aiRunMaxTokens: 10 }),
    ).rejects.toThrow(ERRORS.aiRunMaxTokens);
  });
});

describe("a new project", () => {
  beforeEach(() => {
    getJestSpyOn(UserService, "findOneById").mockResolvedValue(
      new User() as never,
    );
    getJestSpyOn(
      DatabaseConfig,
      "shouldDisableUserProjectCreation",
    ).mockResolvedValue(false as never);
  });

  /*
   * No project starts with a limit on its runs: the old fixed limits were
   * never stored, so none is copied into a project now.
   */
  it("starts with no limits per run", async () => {
    const project: Project = new Project();
    project.name = "Acme";

    const created: Project = await runOnBeforeCreate(project);

    expect(created.aiRunMaxModelCalls).toBeUndefined();
    expect(created.aiRunMaxToolCalls).toBeUndefined();
    expect(created.aiRunMaxTokens).toBeUndefined();
    expect(created.aiRunTimeLimitInMinutes).toBeUndefined();
  });

  it("refuses an invalid limit before the project is set up", async () => {
    const project: Project = new Project();
    project.name = "Acme";
    project.aiRunMaxModelCalls = -10;

    await expect(runOnBeforeCreate(project)).rejects.toThrow(
      ERRORS.aiRunMaxModelCalls,
    );
  });
});
