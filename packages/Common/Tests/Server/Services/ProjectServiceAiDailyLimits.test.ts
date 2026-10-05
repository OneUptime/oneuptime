import DatabaseConfig from "../../../Server/DatabaseConfig";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { getJestSpyOn } from "../../Spy";

/*
 * What ProjectService lets anyone store in the project's own daily AI
 * limits (Project.aiDailyTokenLimit and Project.aiDailySpendLimitInUSD).
 * Who may write them is the columns' access control
 * (ProjectAiDailyLimitsPermission.test.ts); this is what may be written:
 *
 *   - nothing (null, or a blank field) is no limit;
 *   - a typed "200000" is the number 200000;
 *   - anything else must be a whole number within the limit's bounds, at
 *     least 1 - a limit of 0 is refused, pointing at Enable AI, the
 *     project's one AI switch;
 *   - the spend limit counts AI credits, so where AI is not billed it
 *     cannot be set (clearing it always can);
 *   - a write that does not carry a limit leaves it alone.
 *
 * Billing is switched per test (IsBillingEnabled is read through a getter),
 * so both kinds of install are covered here. Nothing below the service
 * boundary runs: no database, no Stripe.
 */

type MockBillingGlobal = typeof globalThis & {
  __projectAiDailyLimitsTestBillingEnabled: boolean;
};

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  const mocked: Record<string, unknown> = {
    ...actual,
    NotificationSlackWebhookOnCreateProject: "",
    NotificationSlackWebhookOnSubscriptionUpdate: "",
  };
  const mockGlobal: MockBillingGlobal = globalThis as MockBillingGlobal;
  mockGlobal.__projectAiDailyLimitsTestBillingEnabled = false;

  Object.defineProperty(mocked, "IsBillingEnabled", {
    configurable: true,
    enumerable: true,
    get: (): boolean => {
      return mockGlobal.__projectAiDailyLimitsTestBillingEnabled;
    },
  });

  return mocked;
});

function setBillingEnabled(value: boolean): void {
  (globalThis as MockBillingGlobal).__projectAiDailyLimitsTestBillingEnabled =
    value;
}

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");

type Data = Record<string, unknown>;

const TOKEN_ERROR: string =
  "The daily AI token limit must be a whole number from 1 to 2,000,000,000. Leave it empty for no limit. To turn OneUptime AI off, use Enable AI.";

const SPEND_ERROR: string =
  "The daily AI spend limit must be a whole number of US dollars from 1 to 1,000,000. Leave it empty for no limit. To turn OneUptime AI off, use Enable AI.";

const SPEND_NOT_BILLED_ERROR: string =
  "The daily AI spend limit counts AI credits, which this server does not bill, so it can only be set where billing is enabled. Use the daily AI token limit instead.";

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
  ProjectService.applyAiDailyLimitRules(data);
  return data;
}

describe.each([
  ["with billing on", true],
  ["with billing off", false],
])("ProjectService daily AI limits %s", (_name: string, billing: boolean) => {
  beforeEach(() => {
    setBillingEnabled(billing);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    setBillingEnabled(false);
  });

  describe("the token limit", () => {
    it.each([[1], [200000], [2_000_000_000]])(
      "stores %s as it is",
      (value: number) => {
        expect(rules({ aiDailyTokenLimit: value })).toEqual({
          aiDailyTokenLimit: value,
        });
      },
    );

    it("stores a typed number as the number", () => {
      expect(rules({ aiDailyTokenLimit: "200000" })).toEqual({
        aiDailyTokenLimit: 200000,
      });
      expect(rules({ aiDailyTokenLimit: " 5000 " })).toEqual({
        aiDailyTokenLimit: 5000,
      });
    });

    it("stores a blank one as no limit", () => {
      expect(rules({ aiDailyTokenLimit: "" })).toEqual({
        aiDailyTokenLimit: null,
      });
      expect(rules({ aiDailyTokenLimit: "   " })).toEqual({
        aiDailyTokenLimit: null,
      });
    });

    it("keeps null, which clears the limit", () => {
      expect(rules({ aiDailyTokenLimit: null })).toEqual({
        aiDailyTokenLimit: null,
      });
    });

    it.each([
      [0],
      [-1],
      [1.5],
      ["2.5"],
      [2_000_000_001],
      ["abc"],
      [true],
      [{ value: 5 }],
    ])("refuses %p, pointing at Enable AI", (value: unknown) => {
      expect(() => {
        rules({ aiDailyTokenLimit: value });
      }).toThrow(new BadDataException(TOKEN_ERROR));
    });
  });

  describe("the spend limit", () => {
    it("can always be cleared", () => {
      expect(rules({ aiDailySpendLimitInUSD: null })).toEqual({
        aiDailySpendLimitInUSD: null,
      });
      expect(rules({ aiDailySpendLimitInUSD: "" })).toEqual({
        aiDailySpendLimitInUSD: null,
      });
    });

    it.each([[0], [-5], [2.5], [1_000_001], ["x"]])(
      "refuses %p",
      (value: unknown) => {
        expect(() => {
          rules({ aiDailySpendLimitInUSD: value });
        }).toThrow(new BadDataException(SPEND_ERROR));
      },
    );

    if (billing) {
      it.each([[1], [25], [1_000_000]])(
        "stores $%s where AI is billed",
        (value: number) => {
          expect(rules({ aiDailySpendLimitInUSD: value })).toEqual({
            aiDailySpendLimitInUSD: value,
          });
        },
      );

      it("stores a typed number as the number", () => {
        expect(rules({ aiDailySpendLimitInUSD: "25" })).toEqual({
          aiDailySpendLimitInUSD: 25,
        });
      });
    } else {
      /*
       * Where AI is not billed nothing is spent, so a spend limit would
       * limit nothing: it is refused rather than stored to mislead.
       */
      it.each([[1], [25], ["25"]])(
        "refuses $%p where AI is not billed, and says to use the token limit",
        (value: unknown) => {
          expect(() => {
            rules({ aiDailySpendLimitInUSD: value });
          }).toThrow(new BadDataException(SPEND_NOT_BILLED_ERROR));
        },
      );
    }
  });

  it("leaves a write that carries neither limit alone", () => {
    expect(rules({ name: "Renamed" })).toEqual({ name: "Renamed" });
    expect(rules({ aiDailyTokenLimit: undefined })).toEqual({
      aiDailyTokenLimit: undefined,
    });
  });

  it("works on a Project model instance, as the hooks hand it one", () => {
    const project: Project = new Project();
    project.aiDailyTokenLimit = "300" as unknown as number;

    ProjectService.applyAiDailyLimitRules(
      project as unknown as Record<string, unknown>,
    );

    expect(project.aiDailyTokenLimit).toBe(300);
    // An instance carries every column: the unset one is left unset.
    expect(project.aiDailySpendLimitInUSD).toBeUndefined();
  });

  describe("onBeforeUpdate", () => {
    it("refuses a limit of 0 before anything is written", async () => {
      await expect(runOnBeforeUpdate({ aiDailyTokenLimit: 0 })).rejects.toThrow(
        TOKEN_ERROR,
      );
    });

    it("stores a cleared field as no limit", async () => {
      expect(await runOnBeforeUpdate({ aiDailyTokenLimit: "" })).toEqual({
        aiDailyTokenLimit: null,
      });
    });

    it("passes a valid limit through", async () => {
      expect(
        await runOnBeforeUpdate({ aiDailyTokenLimit: 200000 }),
      ).toEqual({ aiDailyTokenLimit: 200000 });
    });

    it("leaves an update of something else alone", async () => {
      expect(await runOnBeforeUpdate({ name: "Renamed" })).toEqual({
        name: "Renamed",
      });
    });
  });

  describe("onBeforeCreate", () => {
    it("refuses an invalid limit before the project is set up", async () => {
      const findUser: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
        UserService,
        "findOneById",
      ).mockResolvedValue(new User() as never);

      const project: Project = new Project();
      project.name = "Acme";
      project.aiDailyTokenLimit = -10;

      await expect(runOnBeforeCreate(project)).rejects.toThrow(TOKEN_ERROR);
      expect(findUser).not.toHaveBeenCalled();
    });
  });
});

describe("a new project", () => {
  beforeEach(() => {
    setBillingEnabled(false);
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

  // Like every other AI limit: none applies until someone sets one.
  it("starts with no daily AI limits", async () => {
    const project: Project = new Project();
    project.name = "Acme";

    const created: Project = await runOnBeforeCreate(project);

    expect(created.aiDailyTokenLimit).toBeUndefined();
    expect(created.aiDailySpendLimitInUSD).toBeUndefined();
  });
});
