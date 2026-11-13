import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * A PROJECT'S PRODUCTS AND A PERSON'S PINS, ON THE SERVER (issue #6814),
 * with the project's row, its usage statement, its milestones and the
 * person's pins answered here.
 *
 *  - One answer: the products the project hides, the caller's pins, what
 *    is in use - only for what the caller may read - the plan each needs,
 *    and, for whoever may choose, the hidden products with data.
 *  - Usage is one statement, kept per project for five minutes.
 *  - Only someone who may edit the project shows or hides a product; a
 *    product hidden while in use is kept hidden on purpose.
 *  - Pins are the caller's own, five at most, known products only.
 *  - The goals set a project's products until a member changes them.
 */

let mockIsBillingEnabled: boolean = false;

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = { ...actual, __esModule: true };

  Object.defineProperty(mocked, "IsBillingEnabled", {
    get: (): boolean => {
      return mockIsBillingEnabled;
    },
  });

  return mocked;
});

import ProjectProductsService, {
  CHOOSE_PRODUCTS_PERMISSIONS,
  PRODUCT_RECORD_MODELS,
  ProjectProductsCaller,
  USAGE_TTL_IN_MS,
  getUsageStatement,
} from "../../../Server/Services/ProjectProductsService";
import ProjectMilestoneService from "../../../Server/Services/ProjectMilestoneService";
import ProjectService from "../../../Server/Services/ProjectService";
import ProjectUserPreferenceService from "../../../Server/Services/ProjectUserPreferenceService";
import logger from "../../../Server/Utils/Logger";
import ServerProducts from "../../../Server/Utils/ServerProducts/ServerProducts";
import {
  ServerProductOffReason,
  ServerProductsOff,
} from "../../../Types/Product/ServerProducts";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ActivationMilestone from "../../../Types/Analytics/ActivationMilestone";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SubscriptionPlan, {
  PlanType,
} from "../../../Types/Billing/SubscriptionPlan";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import ProductKey, { PRODUCT_KEYS } from "../../../Types/Product/ProductKey";
import {
  PRODUCTS_USED_BY_RECORDS,
  ProductUsage,
} from "../../../Types/Product/ProductUsage";
import {
  ProjectProductsChosenBy,
  getProductsHiddenByGoals,
  parseProjectProductSettings,
} from "../../../Types/Product/ProjectProducts";
import { ProjectProductsAnswer } from "../../../Types/Product/ProjectProductsAnswer";
import UserType from "../../../Types/UserType";
import ProjectGoal from "../../../Types/WelcomeChecklist/ProjectGoal";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OWNER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const MEMBER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const MONITOR_READER_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

interface ProjectRow {
  productSettings: unknown;
  planName?: PlanType | undefined;
  paymentProviderPlanId?: string | undefined;
}

let row: ProjectRow;
// The usage statement's answer: product key -> has a record.
let records: Partial<Record<ProductKey, boolean>>;
let milestones: Array<ActivationMilestone>;
let pins: Record<string, Array<ProductKey>>;
let queries: Array<{ sql: string; parameters: Array<unknown> }>;
let usageQueryShouldFail: boolean;
let findProjectSpy: SpyInstance<typeof ProjectService.findOneById>;
// What the server switched off for every project (#6815).
let offOnServer: ServerProductsOff;

const PLAN_ORDER: Array<PlanType> = [
  PlanType.Free,
  PlanType.Growth,
  PlanType.Scale,
  PlanType.Enterprise,
];

function permission(value: Permission): UserPermission {
  return {
    _type: "UserPermission",
    permission: value,
    labelIds: [],
  } as UserPermission;
}

function caller(
  userId: ObjectID,
  permissions: Array<Permission>,
  extra?: Partial<DatabaseCommonInteractionProps>,
): ProjectProductsCaller {
  const tenant: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: permissions.map(permission),
  };

  return {
    projectId: PROJECT_ID,
    userId: userId,
    props: {
      tenantId: PROJECT_ID,
      userId: userId,
      userType: UserType.User,
      userTenantAccessPermission: { [PROJECT_ID.toString()]: tenant },
      ...extra,
    },
  };
}

const OWNER: () => ProjectProductsCaller = (): ProjectProductsCaller => {
  return caller(OWNER_ID, [Permission.ProjectOwner]);
};
const MEMBER: () => ProjectProductsCaller = (): ProjectProductsCaller => {
  return caller(MEMBER_ID, [Permission.ProjectMember]);
};
// Reads monitors and nothing else of the project's records.
const MONITOR_READER: () => ProjectProductsCaller =
  (): ProjectProductsCaller => {
    return caller(MONITOR_READER_ID, [Permission.ReadProjectMonitor]);
  };

const usageQueries: () => number = (): number => {
  return queries.filter((query: { sql: string }): boolean => {
    return query.sql.startsWith("SELECT EXISTS");
  }).length;
};

const stored: () => ReturnType<typeof parseProjectProductSettings> = () => {
  return parseProjectProductSettings(row.productSettings);
};

beforeEach(() => {
  mockIsBillingEnabled = false;
  row = { productSettings: null };
  records = {};
  milestones = [];
  pins = {};
  queries = [];
  usageQueryShouldFail = false;
  offOnServer = {};
  ProjectProductsService.forgetUsage();

  jest
    .spyOn(ServerProducts, "getOff")
    .mockImplementation((async (): Promise<ServerProductsOff> => {
      return { ...offOnServer };
    }) as never);

  findProjectSpy = jest
    .spyOn(ProjectService, "findOneById")
    .mockImplementation((async (): Promise<unknown> => {
      return { ...row };
    }) as never);

  jest.spyOn(ProjectService, "getRepository").mockReturnValue({
    manager: {
      query: async (
        sql: string,
        parameters: Array<unknown>,
      ): Promise<unknown> => {
        queries.push({ sql: sql, parameters: parameters });

        if (sql.startsWith("SELECT EXISTS")) {
          if (usageQueryShouldFail) {
            throw new Error("database is down");
          }

          const answer: JSONObject = {};

          for (const product of PRODUCTS_USED_BY_RECORDS) {
            answer[product] = records[product] === true;
          }

          return [answer];
        }

        if (sql.startsWith(`UPDATE "Project" SET "productSettings" = $1`)) {
          row.productSettings = JSON.parse(parameters[0] as string);
          return [];
        }

        throw new Error(`Unexpected query: ${sql}`);
      },
    },
  } as never);

  jest
    .spyOn(ProjectMilestoneService, "getReachedMilestones")
    .mockImplementation((async (): Promise<unknown> => {
      return milestones.map((milestone: ActivationMilestone) => {
        return {
          milestone: milestone,
          reachedAt: new Date(),
          wasBackfilled: false,
        };
      });
    }) as never);

  jest
    .spyOn(ProjectUserPreferenceService, "getPinnedProducts")
    .mockImplementation((async (data: {
      userId: ObjectID;
    }): Promise<unknown> => {
      return [...(pins[data.userId.toString()] || [])];
    }) as never);

  jest
    .spyOn(ProjectUserPreferenceService, "setPinnedProducts")
    .mockImplementation((async (data: {
      userId: ObjectID;
      pinned: Array<ProductKey>;
    }): Promise<unknown> => {
      pins[data.userId.toString()] = [...data.pinned];
      return undefined;
    }) as never);

  jest
    .spyOn(SubscriptionPlan, "isFeatureAccessibleOnCurrentPlan")
    .mockImplementation(((feature: PlanType, current: PlanType): boolean => {
      return PLAN_ORDER.indexOf(feature) <= PLAN_ORDER.indexOf(current);
    }) as never);

  jest.spyOn(logger, "error").mockImplementation((() => {}) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the products each product counts", () => {
  test("every product used by records has a record model, and only those", () => {
    expect(Object.keys(PRODUCT_RECORD_MODELS).sort()).toEqual(
      [...PRODUCTS_USED_BY_RECORDS].sort(),
    );
  });

  test("the usage statement asks every table once, by the project, leaving deleted rows out", () => {
    const statement: string = getUsageStatement();

    for (const product of PRODUCTS_USED_BY_RECORDS) {
      const modelType: { new (): BaseModel } = PRODUCT_RECORD_MODELS[
        product
      ] as { new (): BaseModel };
      const tableName: string = new modelType().tableName as string;

      expect(statement).toContain(
        `EXISTS (SELECT 1 FROM "${tableName}" WHERE "projectId" = $1 AND "deletedAt" IS NULL) AS "${product}"`,
      );
    }

    expect(statement.startsWith("SELECT EXISTS")).toBe(true);
    expect(statement.match(/EXISTS \(/g)?.length).toBe(
      PRODUCTS_USED_BY_RECORDS.length,
    );
  });
});

describe("the answer", () => {
  test("a project nobody chose for hides nothing, and a member pins nothing yet", async () => {
    const answer: ProjectProductsAnswer =
      await ProjectProductsService.getAnswer(MEMBER());

    expect(answer.hidden).toEqual([]);
    expect(answer.chosenBy).toBeNull();
    expect(answer.pinned).toEqual([]);
    expect(answer.canChooseProducts).toBe(false);
    expect(answer.hiddenWithData).toEqual([]);
    expect(answer.neededPlans).toEqual({});
  });

  test("it says what the project hides, and where the list came from", async () => {
    row.productSettings = {
      hidden: ["kubernetes", "docker"],
      chosenBy: "goals",
    };

    const answer: ProjectProductsAnswer =
      await ProjectProductsService.getAnswer(MEMBER());

    expect(answer.hidden).toEqual([ProductKey.Kubernetes, ProductKey.Docker]);
    expect(answer.chosenBy).toBe(ProjectProductsChosenBy.Goals);
  });

  test("it gives each person their own pins", async () => {
    pins[OWNER_ID.toString()] = [ProductKey.Logs, ProductKey.Monitors];
    pins[MEMBER_ID.toString()] = [ProductKey.StatusPages];

    expect((await ProjectProductsService.getAnswer(OWNER())).pinned).toEqual([
      ProductKey.Logs,
      ProductKey.Monitors,
    ]);
    expect((await ProjectProductsService.getAnswer(MEMBER())).pinned).toEqual([
      ProductKey.StatusPages,
    ]);
  });

  test("records and first data say what is in use", async () => {
    records = { [ProductKey.Monitors]: true, [ProductKey.Hosts]: true };
    milestones = [ActivationMilestone.FirstLogsReceived];

    const answer: ProjectProductsAnswer =
      await ProjectProductsService.getAnswer(OWNER());

    expect(answer.usage[ProductKey.Monitors]).toBe(ProductUsage.InUse);
    expect(answer.usage[ProductKey.Hosts]).toBe(ProductUsage.InUse);
    expect(answer.usage[ProductKey.Logs]).toBe(ProductUsage.InUse);
    expect(answer.usage[ProductKey.Traces]).toBe(ProductUsage.NotSetUp);
    expect(answer.usage[ProductKey.Kubernetes]).toBe(ProductUsage.NotSetUp);
    // No incidents is good news, not a step undone.
    expect(answer.usage[ProductKey.Incidents]).toBe(ProductUsage.NothingYet);
    // Nobody can tell cheaply, so nothing is said.
    expect(answer.usage[ProductKey.Inventory]).toBeUndefined();
    expect(answer.usage[ProductKey.ProjectSettings]).toBeUndefined();
  });

  test("a member sees what is in use only for what they may read", async () => {
    records = { [ProductKey.Monitors]: true, [ProductKey.Workflows]: true };
    milestones = [ActivationMilestone.FirstLogsReceived];

    const answer: ProjectProductsAnswer =
      await ProjectProductsService.getAnswer(MONITOR_READER());

    expect(answer.usage[ProductKey.Monitors]).toBe(ProductUsage.InUse);
    expect(answer.usage[ProductKey.Workflows]).toBeUndefined();
    expect(answer.usage[ProductKey.StatusPages]).toBeUndefined();
    // The milestones are every member's to read.
    expect(answer.usage[ProductKey.Logs]).toBe(ProductUsage.InUse);
  });

  test("a master admin sees everything in use", async () => {
    records = { [ProductKey.Workflows]: true };

    const answer: ProjectProductsAnswer =
      await ProjectProductsService.getAnswer(
        caller(MEMBER_ID, [], { isMasterAdmin: true }),
      );

    expect(answer.usage[ProductKey.Workflows]).toBe(ProductUsage.InUse);
    expect(answer.canChooseProducts).toBe(true);
  });

  test("whoever may edit the project may choose its products", async () => {
    expect(CHOOSE_PRODUCTS_PERMISSIONS).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProject,
    ]);

    for (const holder of [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProject,
    ]) {
      expect(
        (await ProjectProductsService.getAnswer(caller(MEMBER_ID, [holder])))
          .canChooseProducts,
      ).toBe(true);
    }

    expect(
      (
        await ProjectProductsService.getAnswer(
          caller(MEMBER_ID, [Permission.ProjectMember, Permission.Viewer]),
        )
      ).canChooseProducts,
    ).toBe(false);
  });

  test("whoever may choose hears about a hidden product with data; others do not", async () => {
    row.productSettings = {
      hidden: ["logs", "traces", "kubernetes"],
      keptHiddenWithData: ["traces"],
      chosenBy: "member",
    };
    milestones = [
      ActivationMilestone.FirstLogsReceived,
      ActivationMilestone.FirstTracesReceived,
    ];

    expect(
      (await ProjectProductsService.getAnswer(OWNER())).hiddenWithData,
    ).toEqual([ProductKey.Logs]);
    expect(
      (await ProjectProductsService.getAnswer(MEMBER())).hiddenWithData,
    ).toEqual([]);
  });

  test("usage that cannot be read leaves the marks out, not the answer", async () => {
    usageQueryShouldFail = true;
    row.productSettings = { hidden: ["kubernetes"] };

    const answer: ProjectProductsAnswer =
      await ProjectProductsService.getAnswer(OWNER());

    expect(answer.usage).toEqual({});
    expect(answer.hidden).toEqual([ProductKey.Kubernetes]);
  });

  test("a project that does not exist is not found", async () => {
    findProjectSpy.mockImplementation((async (): Promise<unknown> => {
      return null;
    }) as never);

    await expect(ProjectProductsService.getAnswer(OWNER())).rejects.toThrow(
      "Project not found.",
    );
  });
});

describe("the plan each product needs", () => {
  test("without billing, nothing", async () => {
    row.planName = PlanType.Free;

    expect(
      (await ProjectProductsService.getAnswer(OWNER())).neededPlans,
    ).toEqual({});
  });

  test("on the Free plan, the products whose records need Growth say so", async () => {
    mockIsBillingEnabled = true;
    row.planName = PlanType.Free;

    const needed: Partial<Record<ProductKey, PlanType>> = (
      await ProjectProductsService.getAnswer(OWNER())
    ).neededPlans;

    expect(needed[ProductKey.Workflows]).toBe(PlanType.Growth);
    expect(needed[ProductKey.Forms]).toBe(PlanType.Growth);
    expect(needed[ProductKey.Code]).toBe(PlanType.Growth);
    expect(needed[ProductKey.Monitors]).toBeUndefined();
    // Every product it names is one whose record needs that plan.
    for (const [product, plan] of Object.entries(needed)) {
      const modelType: { new (): BaseModel } = PRODUCT_RECORD_MODELS[
        product as ProductKey
      ] as { new (): BaseModel };

      expect(new modelType().getCreateBillingPlan()).toBe(plan);
    }
  });

  test("on the Growth plan, nothing", async () => {
    mockIsBillingEnabled = true;
    row.planName = PlanType.Growth;

    expect(
      (await ProjectProductsService.getAnswer(OWNER())).neededPlans,
    ).toEqual({});
  });

  test("plans that are not set up say nothing", async () => {
    mockIsBillingEnabled = true;
    row.planName = PlanType.Free;
    jest
      .spyOn(SubscriptionPlan, "isFeatureAccessibleOnCurrentPlan")
      .mockImplementation((() => {
        throw new BadDataException("Invalid Plan");
      }) as never);

    expect(
      (await ProjectProductsService.getAnswer(OWNER())).neededPlans,
    ).toEqual({});
  });
});

describe("usage is kept per project for a few minutes", () => {
  test("a second answer within the time asks the database nothing", async () => {
    await ProjectProductsService.getAnswer(OWNER());
    await ProjectProductsService.getAnswer(MEMBER());

    expect(usageQueries()).toBe(1);
    expect(queries[0]!.parameters).toEqual([PROJECT_ID.toString()]);
  });

  test("after the time it asks again", async () => {
    const start: Date = new Date("2026-11-12T10:00:00.000Z");
    const now: SpyInstance<typeof OneUptimeDate.getCurrentDate> = jest
      .spyOn(OneUptimeDate, "getCurrentDate")
      .mockReturnValue(start);

    await ProjectProductsService.getAnswer(OWNER());
    now.mockReturnValue(new Date(start.getTime() + USAGE_TTL_IN_MS - 1));
    await ProjectProductsService.getAnswer(OWNER());
    expect(usageQueries()).toBe(1);

    now.mockReturnValue(new Date(start.getTime() + USAGE_TTL_IN_MS + 1));
    await ProjectProductsService.getAnswer(OWNER());
    expect(usageQueries()).toBe(2);
  });

  test("a fresh read, or forgetting, asks again", async () => {
    await ProjectProductsService.getProjectUsage(PROJECT_ID);
    await ProjectProductsService.getProjectUsage(PROJECT_ID, {
      isFreshRead: true,
    });
    ProjectProductsService.forgetUsage(PROJECT_ID);
    await ProjectProductsService.getProjectUsage(PROJECT_ID);

    expect(usageQueries()).toBe(3);
  });
});

describe("showing and hiding a product", () => {
  test("someone who may not edit the project is refused", async () => {
    await expect(
      ProjectProductsService.setProductShown(MEMBER(), {
        product: ProductKey.Kubernetes,
        isShown: false,
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
    await expect(
      ProjectProductsService.showEveryProduct(MEMBER()),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
    expect(row.productSettings).toBeNull();
  });

  test("an unknown product, a value that is not a yes or no, or Project Settings is refused", async () => {
    await expect(
      ProjectProductsService.setProductShown(OWNER(), {
        product: "ufo",
        isShown: false,
      }),
    ).rejects.toBeInstanceOf(BadDataException);
    await expect(
      ProjectProductsService.setProductShown(OWNER(), {
        product: ProductKey.Kubernetes,
        isShown: "no",
      }),
    ).rejects.toBeInstanceOf(BadDataException);
    await expect(
      ProjectProductsService.setProductShown(OWNER(), {
        product: ProductKey.ProjectSettings,
        isShown: false,
      }),
    ).rejects.toThrow("Users, Teams and Project Settings are always shown.");
    expect(row.productSettings).toBeNull();
  });

  test("hiding writes the member's list straight to the project's row", async () => {
    const update: SpyInstance<typeof ProjectService.updateOneById> = jest.spyOn(
      ProjectService,
      "updateOneById",
    );

    await ProjectProductsService.setProductShown(OWNER(), {
      product: ProductKey.Kubernetes,
      isShown: false,
    });

    expect(update).not.toHaveBeenCalled();
    expect(stored()).toMatchObject({
      hidden: [ProductKey.Kubernetes],
      keptHiddenWithData: [],
      chosenBy: ProjectProductsChosenBy.Member,
      changedByUserId: OWNER_ID.toString(),
    });
    const write: { sql: string; parameters: Array<unknown> } = queries.find(
      (query: { sql: string }): boolean => {
        return query.sql.startsWith("UPDATE");
      },
    )!;
    expect(write.sql).toBe(
      `UPDATE "Project" SET "productSettings" = $1 WHERE "_id" = $2`,
    );
    expect(write.parameters[1]).toBe(PROJECT_ID.toString());
  });

  test("hiding a product with data keeps it hidden on purpose", async () => {
    records = { [ProductKey.Kubernetes]: true };

    await ProjectProductsService.setProductShown(OWNER(), {
      product: ProductKey.Kubernetes,
      isShown: false,
    });

    expect(stored()?.keptHiddenWithData).toEqual([ProductKey.Kubernetes]);
    // So Home does not ask about it.
    expect(
      (await ProjectProductsService.getAnswer(OWNER())).hiddenWithData,
    ).toEqual([]);
  });

  test("showing it again takes it off the list", async () => {
    row.productSettings = {
      hidden: ["kubernetes", "docker"],
      keptHiddenWithData: ["kubernetes"],
      chosenBy: "goals",
    };

    await ProjectProductsService.setProductShown(OWNER(), {
      product: ProductKey.Kubernetes,
      isShown: true,
    });

    expect(stored()).toMatchObject({
      hidden: [ProductKey.Docker],
      keptHiddenWithData: [],
      chosenBy: ProjectProductsChosenBy.Member,
    });
  });

  test("Show Every Product hides nothing, as the member's choice", async () => {
    row.productSettings = { hidden: ["kubernetes"], chosenBy: "goals" };

    await ProjectProductsService.showEveryProduct(OWNER());

    expect(stored()).toMatchObject({
      hidden: [],
      chosenBy: ProjectProductsChosenBy.Member,
      changedByUserId: OWNER_ID.toString(),
    });
  });
});

describe("pins", () => {
  test("anybody in the project keeps their own, in order", async () => {
    expect(
      await ProjectProductsService.setPinnedProducts(MEMBER(), [
        "logs",
        "monitors",
      ]),
    ).toEqual([ProductKey.Logs, ProductKey.Monitors]);
    expect(pins[MEMBER_ID.toString()]).toEqual([
      ProductKey.Logs,
      ProductKey.Monitors,
    ]);
    expect(pins[OWNER_ID.toString()]).toBeUndefined();
  });

  test("an empty list unpins everything", async () => {
    pins[MEMBER_ID.toString()] = [ProductKey.Logs];

    await ProjectProductsService.setPinnedProducts(MEMBER(), []);

    expect(pins[MEMBER_ID.toString()]).toEqual([]);
  });

  test("not a list, an unknown product, a repeat or a sixth pin is refused", async () => {
    await expect(
      ProjectProductsService.setPinnedProducts(MEMBER(), "logs"),
    ).rejects.toBeInstanceOf(BadDataException);
    await expect(
      ProjectProductsService.setPinnedProducts(MEMBER(), ["logs", "ufo"]),
    ).rejects.toBeInstanceOf(BadDataException);
    await expect(
      ProjectProductsService.setPinnedProducts(MEMBER(), ["logs", "logs"]),
    ).rejects.toBeInstanceOf(BadDataException);
    await expect(
      ProjectProductsService.setPinnedProducts(MEMBER(), [
        "monitors",
        "incidents",
        "alerts",
        "on-call",
        "status-pages",
        "logs",
      ]),
    ).rejects.toThrow("You can pin up to 5 products.");
    expect(pins[MEMBER_ID.toString()]).toBeUndefined();
  });

  test("a product the project hides can be pinned", async () => {
    row.productSettings = { hidden: ["kubernetes"] };

    await ProjectProductsService.setPinnedProducts(MEMBER(), ["kubernetes"]);

    expect((await ProjectProductsService.getAnswer(MEMBER())).pinned).toEqual([
      ProductKey.Kubernetes,
    ]);
  });
});

describe("the goals set a new project's products", () => {
  test("a project nobody chose for gets the goals' list, and what it uses stays shown", async () => {
    records = { [ProductKey.Proxmox]: true };

    await ProjectProductsService.applyGoals({
      projectId: PROJECT_ID,
      goals: [ProjectGoal.Uptime],
    });

    expect(stored()).toMatchObject({
      hidden: getProductsHiddenByGoals({
        goals: [ProjectGoal.Uptime],
        inUse: [ProductKey.Proxmox],
      }),
      chosenBy: ProjectProductsChosenBy.Goals,
      changedByUserId: null,
    });
    expect(stored()?.hidden).not.toContain(ProductKey.Proxmox);
    expect(stored()?.hidden).toContain(ProductKey.Ceph);
  });

  test("it reads what is in use afresh, whatever is kept", async () => {
    await ProjectProductsService.getProjectUsage(PROJECT_ID);
    records = { [ProductKey.Ceph]: true };

    await ProjectProductsService.applyGoals({
      projectId: PROJECT_ID,
      goals: [ProjectGoal.Uptime],
    });

    expect(stored()?.hidden).not.toContain(ProductKey.Ceph);
  });

  test("goals that hide nothing leave every product shown", async () => {
    await ProjectProductsService.applyGoals({
      projectId: PROJECT_ID,
      goals: [ProjectGoal.Explore],
    });

    expect(stored()?.hidden).toEqual([]);
  });

  test("a list a member chose is left as it is", async () => {
    row.productSettings = { hidden: ["kubernetes"], chosenBy: "member" };

    await ProjectProductsService.applyGoals({
      projectId: PROJECT_ID,
      goals: [ProjectGoal.Uptime],
    });

    expect(stored()?.hidden).toEqual([ProductKey.Kubernetes]);
    expect(
      queries.filter((query: { sql: string }): boolean => {
        return query.sql.startsWith("UPDATE");
      }),
    ).toHaveLength(0);
  });

  test("a failure never stops the goals being kept", async () => {
    usageQueryShouldFail = true;

    await expect(
      ProjectProductsService.applyGoals({
        projectId: PROJECT_ID,
        goals: [ProjectGoal.Uptime],
      }),
    ).resolves.toBeUndefined();
    expect(row.productSettings).toBeNull();
    expect(logger.error).toHaveBeenCalled();
  });
});

describe("the keys", () => {
  test("every product the usage statement names is a known product", () => {
    for (const product of Object.keys(PRODUCT_RECORD_MODELS)) {
      expect(PRODUCT_KEYS).toContain(product);
    }
  });
});

/*
 * THE SERVER'S OFF LIST (#6815) rides along in every answer, and is
 * stronger than the project's choice and a person's pins.
 */
describe("products switched off on the server", () => {
  test("every answer says what is off, and why, the same for every person", async () => {
    offOnServer = {
      [ProductKey.StatusPages]: ServerProductOffReason.SwitchedOff,
      [ProductKey.Logs]: ServerProductOffReason.TelemetryIngestionStopped,
    };

    for (const asker of [OWNER(), MEMBER(), MONITOR_READER()]) {
      const answer: ProjectProductsAnswer =
        await ProjectProductsService.getAnswer(asker);

      expect(answer.offOnServer).toEqual(offOnServer);
    }
  });

  test("nothing off: the answer says so", async () => {
    expect(
      (await ProjectProductsService.getAnswer(OWNER())).offOnServer,
    ).toEqual({});
  });

  test("Home does not ask about a hidden product with data that is off on the server", async () => {
    row = {
      productSettings: {
        hidden: [ProductKey.Logs, ProductKey.Traces],
        chosenBy: ProjectProductsChosenBy.Member,
      },
    };
    milestones = [
      ActivationMilestone.FirstLogsReceived,
      ActivationMilestone.FirstTracesReceived,
    ];
    offOnServer = { [ProductKey.Logs]: ServerProductOffReason.SwitchedOff };

    const answer: ProjectProductsAnswer =
      await ProjectProductsService.getAnswer(OWNER());

    expect(answer.hiddenWithData).toEqual([ProductKey.Traces]);
  });

  test("showing a product that is off is refused, saying who can switch it on, and nothing is written", async () => {
    row = {
      productSettings: {
        hidden: [ProductKey.StatusPages],
        chosenBy: ProjectProductsChosenBy.Member,
      },
    };
    offOnServer = {
      [ProductKey.StatusPages]: ServerProductOffReason.SwitchedOff,
    };

    const refusal: Promise<void> = ProjectProductsService.setProductShown(
      OWNER(),
      { product: ProductKey.StatusPages, isShown: true },
    );

    await expect(refusal).rejects.toBeInstanceOf(BadDataException);
    await expect(refusal).rejects.toThrow(
      "Status Pages is switched off on this server. A server admin can switch it on in Admin Dashboard > Settings > Products. Nothing was deleted.",
    );
    expect(stored()?.hidden).toEqual([ProductKey.StatusPages]);
  });

  test("hiding a product that is off is allowed: it is ready for when the server switches it on", async () => {
    offOnServer = {
      [ProductKey.StatusPages]: ServerProductOffReason.SwitchedOff,
    };

    await ProjectProductsService.setProductShown(OWNER(), {
      product: ProductKey.StatusPages,
      isShown: false,
    });

    expect(stored()?.hidden).toEqual([ProductKey.StatusPages]);
  });

  test("pinning a product that is off is refused", async () => {
    offOnServer = {
      [ProductKey.Logs]: ServerProductOffReason.TelemetryIngestionStopped,
    };

    await expect(
      ProjectProductsService.setPinnedProducts(MEMBER(), [
        ProductKey.Monitors,
        ProductKey.Logs,
      ]),
    ).rejects.toThrow("DISABLE_TELEMETRY_INGESTION");
    expect(pins[MEMBER_ID.toString()]).toBeUndefined();
  });

  test("a pin made before the product was switched off is kept, and others can still change", async () => {
    pins[MEMBER_ID.toString()] = [ProductKey.Logs];
    offOnServer = { [ProductKey.Logs]: ServerProductOffReason.SwitchedOff };

    await ProjectProductsService.setPinnedProducts(MEMBER(), [
      ProductKey.Logs,
      ProductKey.Monitors,
    ]);

    expect(pins[MEMBER_ID.toString()]).toEqual([
      ProductKey.Logs,
      ProductKey.Monitors,
    ]);
  });

  test("unpinning a product that is off is allowed", async () => {
    pins[MEMBER_ID.toString()] = [ProductKey.Logs, ProductKey.Monitors];
    offOnServer = { [ProductKey.Logs]: ServerProductOffReason.SwitchedOff };

    await ProjectProductsService.setPinnedProducts(MEMBER(), [
      ProductKey.Monitors,
    ]);

    expect(pins[MEMBER_ID.toString()]).toEqual([ProductKey.Monitors]);
  });
});
