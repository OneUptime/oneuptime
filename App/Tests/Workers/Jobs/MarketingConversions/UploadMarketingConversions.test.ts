import MarketingConversion from "Common/Models/DatabaseModels/MarketingConversion";
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";
import MarketingConversionService from "Common/Server/Services/MarketingConversionService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserService from "Common/Server/Services/UserService";
import ConversionUploadProvider, {
  ConversionSkip,
  ConversionUploadBatchResult,
} from "Common/Server/Utils/Marketing/ConversionUploadProvider";
import SubscriptionPlan from "Common/Types/Billing/SubscriptionPlan";
import Email from "Common/Types/Email";
import ObjectID from "Common/Types/ObjectID";
import {
  MarketingConversionType,
  MarketingConversionUploadStatus,
} from "Common/Types/Marketing/MarketingConversion";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { SpyInstance } from "jest-mock";

jest.mock(
  "../../../../FeatureSet/Workers/Utils/Cron",
  (): { __esModule: boolean; default: ReturnType<typeof jest.fn> } => {
    return {
      __esModule: true,
      default: jest.fn(),
    };
  },
);

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/MarketingConversionService", () => {
  return {
    __esModule: true,
    default: {
      create: jest.fn(),
      findBy: jest.fn(),
      findOneById: jest.fn(),
      updateOneById: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Types/Database/QueryHelper", () => {
  return {
    __esModule: true,
    default: {
      any: jest.fn((value: unknown): Record<string, unknown> => {
        return { operator: "any", value };
      }),
      greaterThanEqualTo: jest.fn((value: unknown): Record<string, unknown> => {
        return { operator: "greaterThanEqualTo", value };
      }),
      notNull: jest.fn((): Record<string, unknown> => {
        return { operator: "notNull" };
      }),
    },
  };
});

import {
  discoverPaidConversions,
  discoverSignUpConversions,
  getMonthlyRevenueInUSDCents,
  getProviderState,
  setProviderState,
  uploadToProvider,
} from "../../../../FeatureSet/Workers/Jobs/MarketingConversions/UploadMarketingConversions";

class TestProvider extends ConversionUploadProvider {
  public override readonly key: string = "test-provider";
  public override readonly displayName: string = "Test Provider";
  public override readonly maxBatchSize: number;
  public skipReasons: Map<string, ConversionSkip> = new Map<
    string,
    ConversionSkip
  >();
  public uploadedBatches: Array<Array<MarketingConversion>> = [];
  public permanentFailures: Map<number, string> = new Map<number, string>();
  public uploadError: Error | null = null;

  public constructor(maxBatchSize: number = 500) {
    super();
    this.maxBatchSize = maxBatchSize;
  }

  public override isConfigured(): boolean {
    return true;
  }

  public override getSkipReason(
    conversion: MarketingConversion,
  ): ConversionSkip | null {
    return this.skipReasons.get(conversion.id?.toString() || "") || null;
  }

  public override async upload(
    conversions: Array<MarketingConversion>,
  ): Promise<ConversionUploadBatchResult> {
    this.uploadedBatches.push(conversions);
    if (this.uploadError) {
      throw this.uploadError;
    }
    return { permanentFailures: this.permanentFailures };
  }
}

const makeConversion: (data: {
  id: string;
  type?: MarketingConversionType | undefined;
  clickIds?: MarketingConversion["clickIds"];
  uploadState?: MarketingConversion["uploadState"];
}) => MarketingConversion = (data: {
  id: string;
  type?: MarketingConversionType | undefined;
  clickIds?: MarketingConversion["clickIds"];
  uploadState?: MarketingConversion["uploadState"];
}): MarketingConversion => {
  const conversion: MarketingConversion = new MarketingConversion();
  conversion.id = new ObjectID(data.id);
  conversion.conversionType = data.type || MarketingConversionType.SignUp;
  conversion.clickIds = data.clickIds || { gclid: `${data.id}-click` };
  conversion.conversionAt = new Date("2026-07-22T10:00:00.000Z");
  if (data.uploadState) {
    conversion.uploadState = data.uploadState;
  }
  return conversion;
};

const makeUser: (data: {
  id: string;
  email: string;
  clickId: string;
  createdAt: Date;
}) => User = (data: {
  id: string;
  email: string;
  clickId: string;
  createdAt: Date;
}): User => {
  const user: User = new User();
  user.id = new ObjectID(data.id);
  user.email = new Email(data.email);
  user.clickIds = { gclid: data.clickId };
  user.createdAt = data.createdAt;
  return user;
};

const makeProject: (data: {
  id: string;
  email: string;
  clickId: string;
  planId: string;
  seats?: number | undefined;
}) => Project = (data: {
  id: string;
  email: string;
  clickId: string;
  planId: string;
  seats?: number | undefined;
}): Project => {
  const project: Project = new Project();
  project.id = new ObjectID(data.id);
  project.createdOwnerEmail = new Email(data.email);
  project.clickIds = { gclid: data.clickId };
  project.paymentProviderPlanId = data.planId;
  project.paymentProviderSubscriptionSeats = data.seats || 1;
  return project;
};

const getCallArgument: (
  spy: SpyInstance<any>,
  callIndex?: number | undefined,
) => any = (spy: SpyInstance<any>, callIndex: number = 0): any => {
  return spy.mock.calls[callIndex]?.[0] as any;
};

const mockStatePersistence: () => {
  findOneSpy: SpyInstance<any>;
  updateSpy: SpyInstance<any>;
} = (): {
  findOneSpy: SpyInstance<any>;
  updateSpy: SpyInstance<any>;
} => {
  const conversions: Map<string, MarketingConversion> = new Map<
    string,
    MarketingConversion
  >();
  const findOneSpy: SpyInstance<any> = jest
    .spyOn(MarketingConversionService, "findOneById")
    .mockImplementation(
      async (args: any): Promise<MarketingConversion | null> => {
        return conversions.get(args.id.toString()) || null;
      },
    );
  const updateSpy: SpyInstance<any> = jest
    .spyOn(MarketingConversionService, "updateOneById")
    .mockImplementation(async (args: any): Promise<void> => {
      const existing: MarketingConversion =
        conversions.get(args.id.toString()) || new MarketingConversion();
      existing.id = args.id;
      existing.uploadState = args.data.uploadState;
      conversions.set(args.id.toString(), existing);
    });

  return { findOneSpy, updateSpy };
};

describe("UploadMarketingConversions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .spyOn(Date, "now")
      .mockReturnValue(new Date("2026-07-22T12:00:00.000Z").getTime());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("signup discovery", () => {
    test("creates one attributed conversion per newly discovered user", async () => {
      const firstCreatedAt: Date = new Date("2026-07-20T08:00:00.000Z");
      const secondCreatedAt: Date = new Date("2026-07-21T09:00:00.000Z");
      const users: Array<User> = [
        makeUser({
          id: "user-one",
          email: "one@example.com",
          clickId: "gclid-one",
          createdAt: firstCreatedAt,
        }),
        makeUser({
          id: "user-two",
          email: "two@example.com",
          clickId: "gclid-two",
          createdAt: secondCreatedAt,
        }),
      ];

      const userFindSpy: SpyInstance<any> = jest
        .spyOn(UserService, "findBy")
        .mockResolvedValue(users as never);
      jest
        .spyOn(MarketingConversionService, "findBy")
        .mockResolvedValue([] as never);
      const createSpy: SpyInstance<any> = jest
        .spyOn(MarketingConversionService, "create")
        .mockImplementation(async (args: any): Promise<MarketingConversion> => {
          return args.data;
        });

      await discoverSignUpConversions();

      expect(userFindSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({ clickIds: expect.anything() }),
          select: {
            _id: true,
            email: true,
            clickIds: true,
            createdAt: true,
          },
        }),
      );
      expect(createSpy).toHaveBeenCalledTimes(2);
      expect(getCallArgument(createSpy, 0).data).toMatchObject({
        conversionType: MarketingConversionType.SignUp,
        userId: users[0]?.id,
        email: "one@example.com",
        clickIds: { gclid: "gclid-one" },
        conversionAt: firstCreatedAt,
      });
      expect(getCallArgument(createSpy, 1).data).toMatchObject({
        conversionType: MarketingConversionType.SignUp,
        userId: users[1]?.id,
        email: "two@example.com",
        clickIds: { gclid: "gclid-two" },
        conversionAt: secondCreatedAt,
      });
    });

    test("skips users that already have a signup conversion", async () => {
      const existingUser: User = makeUser({
        id: "existing-user",
        email: "existing@example.com",
        clickId: "existing-click",
        createdAt: new Date("2026-07-20T08:00:00.000Z"),
      });
      const newUser: User = makeUser({
        id: "new-user",
        email: "new@example.com",
        clickId: "new-click",
        createdAt: new Date("2026-07-21T08:00:00.000Z"),
      });
      const existingConversion: MarketingConversion = makeConversion({
        id: "existing-conversion",
      });
      existingConversion.userId = existingUser.id!;

      jest
        .spyOn(UserService, "findBy")
        .mockResolvedValue([existingUser, newUser] as never);
      jest
        .spyOn(MarketingConversionService, "findBy")
        .mockResolvedValue([existingConversion] as never);
      const createSpy: SpyInstance<any> = jest
        .spyOn(MarketingConversionService, "create")
        .mockImplementation(async (args: any): Promise<MarketingConversion> => {
          return args.data;
        });

      await discoverSignUpConversions();

      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(getCallArgument(createSpy).data.userId).toEqual(newUser.id);
    });

    test("tolerates a uniqueness race without aborting discovery", async () => {
      const users: Array<User> = [
        makeUser({
          id: "racing-user",
          email: "race@example.com",
          clickId: "racing-click",
          createdAt: new Date("2026-07-21T08:00:00.000Z"),
        }),
        makeUser({
          id: "following-user",
          email: "following@example.com",
          clickId: "following-click",
          createdAt: new Date("2026-07-21T09:00:00.000Z"),
        }),
      ];
      jest.spyOn(UserService, "findBy").mockResolvedValue(users as never);
      jest
        .spyOn(MarketingConversionService, "findBy")
        .mockResolvedValue([] as never);
      const createSpy: SpyInstance<any> = jest
        .spyOn(MarketingConversionService, "create")
        .mockRejectedValueOnce(new Error("duplicate key") as never)
        .mockImplementationOnce(
          async (args: any): Promise<MarketingConversion> => {
            return args.data;
          },
        );

      await expect(discoverSignUpConversions()).resolves.toBeUndefined();
      expect(createSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("paid subscription discovery", () => {
    test("calculates monthly and annual-plan MRR with seats", () => {
      const plan: SubscriptionPlan = new SubscriptionPlan(
        "monthly-plan",
        "yearly-plan",
        "Growth",
        49,
        490 / 12,
        1,
        14,
      );
      jest
        .spyOn(SubscriptionPlan, "getSubscriptionPlanById")
        .mockReturnValue(plan);

      expect(
        getMonthlyRevenueInUSDCents(
          makeProject({
            id: "monthly-project",
            email: "monthly@example.com",
            clickId: "monthly-click",
            planId: "monthly-plan",
            seats: 3,
          }),
        ),
      ).toBe(14700);
      expect(
        getMonthlyRevenueInUSDCents(
          makeProject({
            id: "yearly-project",
            email: "yearly@example.com",
            clickId: "yearly-click",
            planId: "yearly-plan",
            seats: 2,
          }),
        ),
      ).toBe(8167);
    });

    test("returns unknown revenue for missing, unknown and custom plans", () => {
      const projectWithoutPlan: Project = makeProject({
        id: "no-plan-project",
        email: "none@example.com",
        clickId: "none-click",
        planId: "placeholder",
      });
      delete projectWithoutPlan.paymentProviderPlanId;

      expect(getMonthlyRevenueInUSDCents(projectWithoutPlan)).toBeUndefined();

      jest
        .spyOn(SubscriptionPlan, "getSubscriptionPlanById")
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(
          new SubscriptionPlan("custom-plan", "", "Enterprise", -1, -1, 4, 0),
        );

      expect(
        getMonthlyRevenueInUSDCents(
          makeProject({
            id: "unknown-project",
            email: "unknown@example.com",
            clickId: "unknown-click",
            planId: "unknown-plan",
          }),
        ),
      ).toBeUndefined();
      expect(
        getMonthlyRevenueInUSDCents(
          makeProject({
            id: "custom-project",
            email: "custom@example.com",
            clickId: "custom-click",
            planId: "custom-plan",
          }),
        ),
      ).toBeUndefined();
    });

    test("creates a paid conversion with MRR only for projects not seen before", async () => {
      const existingProject: Project = makeProject({
        id: "existing-project",
        email: "existing@example.com",
        clickId: "existing-click",
        planId: "monthly-plan",
      });
      const newProject: Project = makeProject({
        id: "new-project",
        email: "new@example.com",
        clickId: "new-click",
        planId: "monthly-plan",
        seats: 4,
      });
      const existingConversion: MarketingConversion = makeConversion({
        id: "existing-paid-conversion",
        type: MarketingConversionType.PaidSubscription,
      });
      existingConversion.projectId = existingProject.id!;

      jest
        .spyOn(ProjectService, "findBy")
        .mockResolvedValue([existingProject, newProject] as never);
      jest
        .spyOn(MarketingConversionService, "findBy")
        .mockResolvedValue([existingConversion] as never);
      jest
        .spyOn(SubscriptionPlan, "getSubscriptionPlanById")
        .mockReturnValue(
          new SubscriptionPlan(
            "monthly-plan",
            "yearly-plan",
            "Growth",
            25,
            250 / 12,
            1,
            14,
          ),
        );
      const createSpy: SpyInstance<any> = jest
        .spyOn(MarketingConversionService, "create")
        .mockImplementation(async (args: any): Promise<MarketingConversion> => {
          return args.data;
        });

      await discoverPaidConversions();

      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(getCallArgument(createSpy).data).toMatchObject({
        conversionType: MarketingConversionType.PaidSubscription,
        projectId: newProject.id,
        email: "new@example.com",
        clickIds: { gclid: "new-click" },
        conversionValueInUSDCents: 10000,
      });
      expect(getCallArgument(createSpy).data.conversionAt).toBeInstanceOf(Date);
    });
  });

  describe("provider state", () => {
    test("reads an empty state and a provider-specific state", () => {
      const conversion: MarketingConversion = makeConversion({
        id: "state-conversion",
        uploadState: {
          google: {
            status: MarketingConversionUploadStatus.Uploaded,
            attempts: 1,
          },
        },
      });

      expect(getProviderState(conversion, "meta")).toEqual({});
      expect(getProviderState(conversion, "google")).toEqual({
        status: MarketingConversionUploadStatus.Uploaded,
        attempts: 1,
      });
    });

    test("merges against current persisted state instead of stale scan state", async () => {
      const conversion: MarketingConversion = makeConversion({
        id: "merge-state",
        uploadState: {
          google: { status: MarketingConversionUploadStatus.Uploaded },
        },
      });
      jest.spyOn(MarketingConversionService, "findOneById").mockResolvedValue({
        uploadState: {
          google: { status: MarketingConversionUploadStatus.Uploaded },
          meta: { status: MarketingConversionUploadStatus.Uploaded },
        },
      } as never);
      const updateSpy: SpyInstance<any> = jest
        .spyOn(MarketingConversionService, "updateOneById")
        .mockResolvedValue(undefined as never);

      await setProviderState({
        conversion,
        providerKey: "microsoft",
        state: {
          status: MarketingConversionUploadStatus.Failed,
          attempts: 5,
        },
      });

      expect(getCallArgument(updateSpy).data.uploadState).toEqual({
        google: { status: MarketingConversionUploadStatus.Uploaded },
        meta: { status: MarketingConversionUploadStatus.Uploaded },
        microsoft: {
          status: MarketingConversionUploadStatus.Failed,
          attempts: 5,
        },
      });
      expect(conversion.uploadState).toEqual(
        getCallArgument(updateSpy).data.uploadState,
      );
    });
  });

  describe("provider upload", () => {
    beforeEach(() => {
      mockStatePersistence();
    });

    test("filters completed, exhausted and temporarily unconfigured conversions", async () => {
      const completed: MarketingConversion = makeConversion({
        id: "completed",
        uploadState: {
          "test-provider": {
            status: MarketingConversionUploadStatus.Uploaded,
          },
        },
      });
      const exhausted: MarketingConversion = makeConversion({
        id: "exhausted",
        uploadState: {
          "test-provider": { attempts: 5 },
        },
      });
      const permanentSkip: MarketingConversion = makeConversion({
        id: "permanent-skip",
      });
      const configGap: MarketingConversion = makeConversion({
        id: "config-gap",
      });
      const uploadable: MarketingConversion = makeConversion({
        id: "uploadable",
      });
      jest
        .spyOn(MarketingConversionService, "findBy")
        .mockResolvedValue([
          completed,
          exhausted,
          permanentSkip,
          configGap,
          uploadable,
        ] as never);
      const provider: TestProvider = new TestProvider();
      provider.skipReasons.set(permanentSkip.id!.toString(), {
        reason: "expired click",
        isPermanent: true,
      });
      provider.skipReasons.set(configGap.id!.toString(), {
        reason: "conversion action not configured",
        isPermanent: false,
      });

      await uploadToProvider(provider);

      expect(provider.uploadedBatches).toHaveLength(1);
      expect(provider.uploadedBatches[0]).toEqual([uploadable]);
      expect(getProviderState(permanentSkip, provider.key)).toMatchObject({
        status: MarketingConversionUploadStatus.Skipped,
        error: "expired click",
      });
      expect(getProviderState(configGap, provider.key)).toEqual({});
      expect(getProviderState(uploadable, provider.key)).toMatchObject({
        status: MarketingConversionUploadStatus.Uploaded,
      });
    });

    test("records indexed permanent failures independently from successes", async () => {
      const success: MarketingConversion = makeConversion({ id: "success" });
      const failure: MarketingConversion = makeConversion({ id: "failure" });
      jest
        .spyOn(MarketingConversionService, "findBy")
        .mockResolvedValue([success, failure] as never);
      const provider: TestProvider = new TestProvider();
      provider.permanentFailures.set(1, "invalid click id");

      await uploadToProvider(provider);

      expect(getProviderState(success, provider.key)).toMatchObject({
        status: MarketingConversionUploadStatus.Uploaded,
      });
      expect(getProviderState(failure, provider.key)).toEqual({
        status: MarketingConversionUploadStatus.Failed,
        error: "invalid click id",
      });
    });

    test("increments a transport failure while leaving the conversion pending", async () => {
      const conversion: MarketingConversion = makeConversion({
        id: "retry-pending",
        uploadState: {
          "test-provider": { attempts: 3 },
        },
      });
      jest
        .spyOn(MarketingConversionService, "findBy")
        .mockResolvedValue([conversion] as never);
      const provider: TestProvider = new TestProvider();
      provider.uploadError = new Error("temporary outage");

      await uploadToProvider(provider);

      expect(getProviderState(conversion, provider.key)).toEqual({
        attempts: 4,
        error: "temporary outage",
      });
    });

    test("marks the fifth transport failure terminal", async () => {
      const conversion: MarketingConversion = makeConversion({
        id: "retry-exhausted",
        uploadState: {
          "test-provider": { attempts: 4 },
        },
      });
      jest
        .spyOn(MarketingConversionService, "findBy")
        .mockResolvedValue([conversion] as never);
      const provider: TestProvider = new TestProvider();
      provider.uploadError = new Error("authentication failed");

      await uploadToProvider(provider);

      expect(getProviderState(conversion, provider.key)).toEqual({
        status: MarketingConversionUploadStatus.Failed,
        attempts: 5,
        error: "authentication failed",
      });
    });

    test("honors a provider's smaller batch limit", async () => {
      const conversions: Array<MarketingConversion> = [
        makeConversion({ id: "batch-one" }),
        makeConversion({ id: "batch-two" }),
        makeConversion({ id: "batch-three" }),
      ];
      jest
        .spyOn(MarketingConversionService, "findBy")
        .mockResolvedValue(conversions as never);
      const provider: TestProvider = new TestProvider(2);

      await uploadToProvider(provider);

      expect(provider.uploadedBatches).toHaveLength(1);
      expect(provider.uploadedBatches[0]).toEqual(conversions.slice(0, 2));
      expect(getProviderState(conversions[2]!, provider.key)).toEqual({});
    });

    test("does not call the provider when every candidate is filtered", async () => {
      const completed: MarketingConversion = makeConversion({
        id: "already-complete",
        uploadState: {
          "test-provider": {
            status: MarketingConversionUploadStatus.Uploaded,
          },
        },
      });
      jest
        .spyOn(MarketingConversionService, "findBy")
        .mockResolvedValue([completed] as never);
      const provider: TestProvider = new TestProvider();

      await uploadToProvider(provider);

      expect(provider.uploadedBatches).toHaveLength(0);
    });
  });
});
