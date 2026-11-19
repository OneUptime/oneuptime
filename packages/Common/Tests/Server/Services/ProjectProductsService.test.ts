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
 *  - Usage is one statement, kept per project for five minutes, and read
 *    again as soon as a product's first record, its records deleted or its
 *    first data change it (#7465).
 *  - Only someone who may edit the project shows or hides a product; a
 *    product hidden while in use is kept hidden on purpose.
 *  - Pins are the caller's own, five at most, known products only.
 *  - Nothing hides a product by itself: a list an older version set from
 *    the project's goals hides nothing, and is never written again.
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

import { DATA_OBSERVABILITY_KINDS } from "../../../Server/Utils/DataObservability/DataObservabilityEngines";
import { OBJECT_STORE_KINDS } from "../../../Types/DataObservability/StoragePaths";
import { DataStoreKind } from "../../../Types/DataSecurity/DataStoreKind";
import ProjectProductsService, {
  CHOOSE_PRODUCTS_PERMISSIONS,
  PRODUCT_RECORD_MODELS,
  PRODUCT_USAGE_RECORDS,
  ProductUsageRecord,
  ProjectProductsCaller,
  USAGE_TTL_IN_MS,
  getUsageStatement,
} from "../../../Server/Services/ProjectProductsService";
import ProjectMilestoneService from "../../../Server/Services/ProjectMilestoneService";
import ProjectService from "../../../Server/Services/ProjectService";
import ProjectUserPreferenceService from "../../../Server/Services/ProjectUserPreferenceService";
import logger from "../../../Server/Utils/Logger";
import ProjectUsageCache from "../../../Server/Utils/ProjectProducts/ProjectUsageCache";
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
  PRODUCT_USAGE_MILESTONES,
  PRODUCT_USAGE_TABLES,
  ProductUsage,
} from "../../../Types/Product/ProductUsage";
import {
  HIDEABLE_PRODUCTS,
  ProjectProductsChosenBy,
  parseProjectProductSettings,
} from "../../../Types/Product/ProjectProducts";
import { ProjectProductsAnswer } from "../../../Types/Product/ProjectProductsAnswer";
import UserType from "../../../Types/UserType";

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
  test("every product used by records has a record model or the records it counts, and only those", () => {
    expect(
      [
        ...Object.keys(PRODUCT_RECORD_MODELS),
        ...Object.keys(PRODUCT_USAGE_RECORDS),
      ].sort(),
    ).toEqual([...PRODUCTS_USED_BY_RECORDS].sort());

    // A product is counted one way: by its main record, or by some records.
    for (const product of Object.keys(PRODUCT_USAGE_RECORDS)) {
      expect(Object.keys(PRODUCT_RECORD_MODELS)).not.toContain(product);
    }
  });

  test("the usage statement asks every table once, by the project, leaving deleted rows out", () => {
    const statement: string = getUsageStatement();

    for (const product of Object.keys(
      PRODUCT_RECORD_MODELS,
    ) as Array<ProductKey>) {
      const modelType: { new (): BaseModel } = PRODUCT_RECORD_MODELS[
        product
      ] as { new (): BaseModel };
      const tableName: string = new modelType().tableName as string;

      expect(statement).toContain(
        `EXISTS (SELECT 1 FROM "${tableName}" WHERE "projectId" = $1 AND "deletedAt" IS NULL) AS "${product}"`,
      );
    }

    const countedTables: number = Object.values(PRODUCT_USAGE_RECORDS).reduce(
      (
        total: number,
        records: ReadonlyArray<ProductUsageRecord> | undefined,
      ) => {
        return total + (records || []).length;
      },
      0,
    );

    expect(statement.startsWith("SELECT EXISTS")).toBe(true);
    // Still one statement: one EXISTS per table it asks.
    expect(statement.match(/EXISTS \(/g)?.length).toBe(
      Object.keys(PRODUCT_RECORD_MODELS).length + countedTables,
    );
  });

  /*
   * #7325: the six products that had no answer, each by what its own first
   * page counts.
   */
  test("Inventory counts its items, none archived", () => {
    expect(getUsageStatement()).toContain(
      `(EXISTS (SELECT 1 FROM "InventoryItem" WHERE "projectId" = $1 AND "deletedAt" IS NULL AND ("isArchived" = false))) AS "${ProductKey.Inventory}"`,
    );
  });

  test("App Platforms counts its environments, none archived", () => {
    expect(getUsageStatement()).toContain(
      `(EXISTS (SELECT 1 FROM "CloudResource" WHERE "projectId" = $1 AND "deletedAt" IS NULL AND ("isArchived" = false AND "cloudResourceKind" = 'environment'))) AS "${ProductKey.AppPlatforms}"`,
    );
  });

  test("Data Observability counts the databases it watches and the buckets with paths watched", () => {
    const where: string =
      PRODUCT_USAGE_RECORDS[ProductKey.DataObservability]![0]!.where;

    expect(where.startsWith(`"isArchived" = false AND ("kind" IN (`)).toBe(
      true,
    );

    // Every kind it can watch is a table of its, as its Overview counts them.
    for (const kind of DATA_OBSERVABILITY_KINDS) {
      expect(where).toContain(`'${kind}'`);
    }

    // A bucket counts only once paths of it are watched.
    expect(where).toContain(
      `"kind" IN (${OBJECT_STORE_KINDS.map((kind: string) => {
        return `'${kind}'`;
      }).join(", ")}) AND "watchedPaths" IS NOT NULL`,
    );
    expect(DATA_OBSERVABILITY_KINDS).not.toContain(DataStoreKind.AwsS3Bucket);
  });

  test("Data Security counts every data store, none archived", () => {
    expect(getUsageStatement()).toContain(
      `(EXISTS (SELECT 1 FROM "DataStore" WHERE "projectId" = $1 AND "deletedAt" IS NULL AND ("isArchived" = false))) AS "${ProductKey.DataSecurity}"`,
    );
  });

  test("Security Events counts a source it reads that is on: a connection, your logs, your other data", () => {
    expect(getUsageStatement()).toContain(
      `(EXISTS (SELECT 1 FROM "SecurityEventConnection" WHERE "projectId" = $1 AND "deletedAt" IS NULL AND ("isEnabled" = true)) OR EXISTS (SELECT 1 FROM "SecurityLogSource" WHERE "projectId" = $1 AND "deletedAt" IS NULL AND ("isEnabled" = true)) OR EXISTS (SELECT 1 FROM "SecurityTelemetrySource" WHERE "projectId" = $1 AND "deletedAt" IS NULL AND ("isEnabled" = true))) AS "${ProductKey.SecurityEvents}"`,
    );
  });

  test("AI / LLM is counted by its first AI call, as the telemetry products by their first data", () => {
    expect(PRODUCT_USAGE_MILESTONES[ProductKey.Llm]).toEqual([
      ActivationMilestone.FirstLlmCallsReceived,
    ]);
    expect(PRODUCTS_USED_BY_RECORDS).not.toContain(ProductKey.Llm);
  });

  test("every table a product counts is one ProjectUsageCache follows", () => {
    const fromRecords: Record<string, Array<ProductKey>> = {};

    for (const [product, records] of Object.entries(
      PRODUCT_USAGE_RECORDS,
    ) as Array<[ProductKey, ReadonlyArray<ProductUsageRecord>]>) {
      for (const record of records) {
        const tableName: string = new record.modelType().tableName as string;
        fromRecords[tableName] = [...(fromRecords[tableName] || []), product];
      }
    }

    const sorted: (
      map: Readonly<Record<string, ReadonlyArray<ProductKey>>>,
    ) => Record<string, Array<ProductKey>> = (
      map: Readonly<Record<string, ReadonlyArray<ProductKey>>>,
    ): Record<string, Array<ProductKey>> => {
      return Object.fromEntries(
        Object.entries(map).map(
          ([table, products]: [string, ReadonlyArray<ProductKey>]) => {
            return [table, [...products].sort()];
          },
        ),
      );
    };

    expect(sorted(PRODUCT_USAGE_TABLES)).toEqual(sorted(fromRecords));
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

  test("it says what a member hid, and that a member chose it", async () => {
    row.productSettings = {
      hidden: ["kubernetes", "docker"],
      chosenBy: "member",
    };

    const answer: ProjectProductsAnswer =
      await ProjectProductsService.getAnswer(MEMBER());

    expect(answer.hidden).toEqual([ProductKey.Kubernetes, ProductKey.Docker]);
    expect(answer.chosenBy).toBe(ProjectProductsChosenBy.Member);
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
    // Nothing to set up, so nothing is said.
    expect(answer.usage[ProductKey.AIChat]).toBeUndefined();
    expect(answer.usage[ProductKey.ProjectSettings]).toBeUndefined();
  });

  test("the six products #7325 left unanswered say whether they are in use", async () => {
    records = {
      [ProductKey.Inventory]: true,
      [ProductKey.DataSecurity]: true,
      [ProductKey.SecurityEvents]: true,
    };
    milestones = [ActivationMilestone.FirstLlmCallsReceived];

    const answer: ProjectProductsAnswer =
      await ProjectProductsService.getAnswer(OWNER());

    expect(answer.usage[ProductKey.Inventory]).toBe(ProductUsage.InUse);
    expect(answer.usage[ProductKey.DataSecurity]).toBe(ProductUsage.InUse);
    expect(answer.usage[ProductKey.SecurityEvents]).toBe(ProductUsage.InUse);
    expect(answer.usage[ProductKey.Llm]).toBe(ProductUsage.InUse);
    // Each is something you set up: "Not set up" while it has nothing.
    expect(answer.usage[ProductKey.AppPlatforms]).toBe(ProductUsage.NotSetUp);
    expect(answer.usage[ProductKey.DataObservability]).toBe(
      ProductUsage.NotSetUp,
    );

    // And still from the one statement.
    expect(usageQueries()).toBe(1);
  });

  test("AI / LLM is not set up until its first AI call arrives", async () => {
    milestones = [ActivationMilestone.FirstTracesReceived];

    const answer: ProjectProductsAnswer =
      await ProjectProductsService.getAnswer(OWNER());

    // Traces are not AI calls: an app's spans say nothing of AI.
    expect(answer.usage[ProductKey.Traces]).toBe(ProductUsage.InUse);
    expect(answer.usage[ProductKey.Llm]).toBe(ProductUsage.NotSetUp);
  });

  test("a product counted by some records is left out for a member who may read none of them", async () => {
    records = {
      [ProductKey.Inventory]: true,
      [ProductKey.SecurityEvents]: true,
      [ProductKey.DataSecurity]: true,
    };
    milestones = [ActivationMilestone.FirstLlmCallsReceived];

    const answer: ProjectProductsAnswer =
      await ProjectProductsService.getAnswer(MONITOR_READER());

    expect(answer.usage[ProductKey.Inventory]).toBeUndefined();
    expect(answer.usage[ProductKey.SecurityEvents]).toBeUndefined();
    expect(answer.usage[ProductKey.DataSecurity]).toBeUndefined();
    // The milestones are every member's to read.
    expect(answer.usage[ProductKey.Llm]).toBe(ProductUsage.InUse);
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
    const start: number = new Date("2026-11-12T10:00:00.000Z").getTime();
    const now: SpyInstance<typeof Date.now> = jest
      .spyOn(Date, "now")
      .mockReturnValue(start);

    await ProjectProductsService.getAnswer(OWNER());
    now.mockReturnValue(start + USAGE_TTL_IN_MS - 1);
    await ProjectProductsService.getAnswer(OWNER());
    expect(usageQueries()).toBe(1);

    now.mockReturnValue(start + USAGE_TTL_IN_MS + 1);
    await ProjectProductsService.getAnswer(OWNER());
    expect(usageQueries()).toBe(2);
  });

  test("forgetting asks again", async () => {
    await ProjectProductsService.getProjectUsage(PROJECT_ID);
    await ProjectProductsService.getProjectUsage(PROJECT_ID);
    expect(usageQueries()).toBe(1);

    await ProjectProductsService.forgetUsage(PROJECT_ID);
    await ProjectProductsService.getProjectUsage(PROJECT_ID);

    expect(usageQueries()).toBe(2);
  });

  test("the time is ProjectUsageCache's: five minutes", () => {
    expect(USAGE_TTL_IN_MS).toBe(ProjectUsageCache.TTL_MS);
    expect(USAGE_TTL_IN_MS).toBe(5 * 60 * 1000);
  });
});

/*
 * #7465: the products menu kept "Not set up" on Monitors, On-Call Duty and
 * Logs for minutes after each was set up, through a reload, while Home
 * counted the monitors and the policy - the answer's usage was kept five
 * minutes, and nothing that set a product up told it.
 */
describe("the answer follows what the project uses (#7465)", () => {
  const usageOf: (
    answer: ProjectProductsAnswer,
    product: ProductKey,
  ) => ProductUsage | undefined = (
    answer: ProjectProductsAnswer,
    product: ProductKey,
  ): ProductUsage | undefined => {
    return answer.usage[product];
  };

  test("the project's first monitor: the next answer says Monitors is in use, not Not set up", async () => {
    expect(
      usageOf(
        await ProjectProductsService.getAnswer(OWNER()),
        ProductKey.Monitors,
      ),
    ).toBe(ProductUsage.NotSetUp);

    records = { [ProductKey.Monitors]: true };
    // What DatabaseService does once the monitor is written.
    await ProjectUsageCache.afterCreate({
      tableName: "Monitor",
      row: { projectId: PROJECT_ID },
    });

    expect(
      usageOf(
        await ProjectProductsService.getAnswer(OWNER()),
        ProductKey.Monitors,
      ),
    ).toBe(ProductUsage.InUse);
  });

  test("the project's first on-call policy: the next answer says On-Call Duty is in use", async () => {
    await ProjectProductsService.getAnswer(OWNER());

    records = { [ProductKey.OnCall]: true };
    await ProjectUsageCache.afterCreate({
      tableName: "OnCallDutyPolicy",
      row: { projectId: PROJECT_ID },
    });

    expect(
      usageOf(
        await ProjectProductsService.getAnswer(MEMBER()),
        ProductKey.OnCall,
      ),
    ).toBe(ProductUsage.InUse);
  });

  test("the project's first logs: the next answer says Logs is in use", async () => {
    expect(
      usageOf(await ProjectProductsService.getAnswer(OWNER()), ProductKey.Logs),
    ).toBe(ProductUsage.NotSetUp);

    milestones = [ActivationMilestone.FirstLogsReceived];
    // What ProjectMilestoneService does once it keeps the milestone.
    await ProjectUsageCache.afterMilestoneReached({
      projectId: PROJECT_ID,
      milestone: ActivationMilestone.FirstLogsReceived,
    });

    expect(
      usageOf(await ProjectProductsService.getAnswer(OWNER()), ProductKey.Logs),
    ).toBe(ProductUsage.InUse);
  });

  test("the last monitor deleted: the next answer says Not set up again", async () => {
    records = { [ProductKey.Monitors]: true };
    await ProjectProductsService.getAnswer(OWNER());

    records = {};
    await ProjectUsageCache.afterDelete({
      tableName: "Monitor",
      rows: [{ projectId: PROJECT_ID }],
    });

    expect(
      usageOf(
        await ProjectProductsService.getAnswer(OWNER()),
        ProductKey.Monitors,
      ),
    ).toBe(ProductUsage.NotSetUp);
  });

  test("nothing set up meanwhile: every answer comes from the one statement", async () => {
    for (let page: number = 0; page < 10; page++) {
      await ProjectProductsService.getAnswer(page % 2 ? OWNER() : MEMBER());
    }

    // A note, a label: records of no product change nothing.
    await ProjectUsageCache.afterCreate({
      tableName: "Label",
      row: { projectId: PROJECT_ID },
    });
    await ProjectProductsService.getAnswer(OWNER());

    expect(usageQueries()).toBe(1);
  });

  test("another project's first monitor leaves this project's answer kept", async () => {
    await ProjectProductsService.getAnswer(OWNER());

    await ProjectUsageCache.afterCreate({
      tableName: "Monitor",
      row: { projectId: new ObjectID("99999999-9999-4999-8999-999999999999") },
    });
    await ProjectProductsService.getAnswer(OWNER());

    expect(usageQueries()).toBe(1);
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
      chosenBy: "member",
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
    row.productSettings = { hidden: ["kubernetes"], chosenBy: "member" };

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

/*
 * Choosing a project's goals used to hide every product they did not name:
 * a project that answered "Know when my website or API is down" had 37
 * products moved under More products, all "Not set up", although nobody
 * hid them. Only a member hides a product now, and a list the goals stored
 * then hides nothing.
 */
describe("nothing hides a product by itself", () => {
  // As the goals stored it: everything but the seven essentials hidden.
  const GOALS_LIST: JSONObject = {
    hidden: HIDEABLE_PRODUCTS.filter((product: ProductKey): boolean => {
      return ![
        ProductKey.Monitors,
        ProductKey.Incidents,
        ProductKey.Alerts,
        ProductKey.OnCall,
        ProductKey.StatusPages,
        ProductKey.ScheduledMaintenance,
        ProductKey.Slos,
      ].includes(product);
    }),
    keptHiddenWithData: [],
    chosenBy: "goals",
    changedAt: "2026-11-12T10:00:00.000Z",
    changedByUserId: null,
  };

  const updates: () => number = (): number => {
    return queries.filter((query: { sql: string }): boolean => {
      return query.sql.startsWith("UPDATE");
    }).length;
  };

  test("a new project with nothing set up hides nothing", async () => {
    const answer: ProjectProductsAnswer =
      await ProjectProductsService.getAnswer(OWNER());

    // Every product counted by its records is "Not set up" (or nothing yet)...
    expect(answer.usage[ProductKey.Kubernetes]).toBe(ProductUsage.NotSetUp);
    expect(answer.usage[ProductKey.Logs]).toBe(ProductUsage.NotSetUp);
    // ...and still shown.
    expect(answer.hidden).toEqual([]);
    expect(answer.chosenBy).toBeNull();
    expect(answer.hiddenWithData).toEqual([]);
  });

  test("a list the goals set hides nothing, for anyone who asks", async () => {
    row.productSettings = { ...GOALS_LIST };

    for (const asker of [OWNER(), MEMBER(), MONITOR_READER()]) {
      const answer: ProjectProductsAnswer =
        await ProjectProductsService.getAnswer(asker);

      expect(answer.hidden).toEqual([]);
      expect(answer.chosenBy).toBeNull();
    }
  });

  test("Home asks about none of a goals list's products, though they have data", async () => {
    row.productSettings = { ...GOALS_LIST };
    records = { [ProductKey.Kubernetes]: true };
    milestones = [ActivationMilestone.FirstLogsReceived];

    const answer: ProjectProductsAnswer =
      await ProjectProductsService.getAnswer(OWNER());

    expect(answer.usage[ProductKey.Kubernetes]).toBe(ProductUsage.InUse);
    expect(answer.usage[ProductKey.Logs]).toBe(ProductUsage.InUse);
    expect(answer.hiddenWithData).toEqual([]);
  });

  test("reading the answer never writes the project's list", async () => {
    row.productSettings = { ...GOALS_LIST };

    await ProjectProductsService.getAnswer(OWNER());
    await ProjectProductsService.getAnswer(MEMBER());

    expect(updates()).toBe(0);
    expect(row.productSettings).toEqual(GOALS_LIST);
  });

  test("a member hiding one product on a goals list hides that one only", async () => {
    row.productSettings = { ...GOALS_LIST };

    await ProjectProductsService.setProductShown(OWNER(), {
      product: ProductKey.Kubernetes,
      isShown: false,
    });

    expect(stored()).toMatchObject({
      hidden: [ProductKey.Kubernetes],
      keptHiddenWithData: [],
      chosenBy: ProjectProductsChosenBy.Member,
      changedByUserId: OWNER_ID.toString(),
    });
    expect((await ProjectProductsService.getAnswer(MEMBER())).hidden).toEqual([
      ProductKey.Kubernetes,
    ]);
  });

  test("a member showing one product on a goals list leaves nothing hidden", async () => {
    row.productSettings = { ...GOALS_LIST };

    await ProjectProductsService.setProductShown(OWNER(), {
      product: ProductKey.Logs,
      isShown: true,
    });

    expect(stored()).toMatchObject({
      hidden: [],
      chosenBy: ProjectProductsChosenBy.Member,
    });
  });

  test("a list a member chose is kept, whatever it hides", async () => {
    row.productSettings = { ...GOALS_LIST, chosenBy: "member" };

    const answer: ProjectProductsAnswer =
      await ProjectProductsService.getAnswer(OWNER());

    expect(answer.hidden).toEqual(GOALS_LIST["hidden"]);
    expect(answer.chosenBy).toBe(ProjectProductsChosenBy.Member);
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
