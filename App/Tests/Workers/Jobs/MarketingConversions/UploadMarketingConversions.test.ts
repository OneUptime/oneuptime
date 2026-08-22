import MarketingConversion from "Common/Models/DatabaseModels/MarketingConversion";
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";
import Attribution from "Common/Server/Utils/Attribution";
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
      isNull: jest.fn((): Record<string, unknown> => {
        return { operator: "isNull" };
      }),
    },
  };
});

import {
  discoverPaidConversions,
  discoverSignUpConversions,
  getMonthlyRevenueInUSDCents,
  getProviderState,
  linkConversionChains,
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

  protected override getProviderSkipReason(
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

interface AttributionFixture {
  // Omitted entirely for a visitor a campaign reached without any ad click.
  clickId?: string | undefined;
  utmSource?: string | undefined;
  utmMedium?: string | undefined;
  utmCampaign?: string | undefined;
  utmTerm?: string | undefined;
  utmContent?: string | undefined;
  utmUrl?: string | undefined;
  firstTouchAttribution?: Record<string, unknown> | undefined;
}

type ApplyAttributionFunction = (
  target: User | Project,
  data: AttributionFixture,
) => void;

/*
 * Assigned through a loose record rather than field by field: the utm* columns
 * on User and Project are declared `?: string`, and under
 * exactOptionalPropertyTypes assigning a possibly-undefined value to one of
 * those is an error even though leaving it unset is exactly what the fixture
 * means.
 */
const applyAttribution: ApplyAttributionFunction = (
  target: User | Project,
  data: AttributionFixture,
): void => {
  const writable: Record<string, unknown> = target as unknown as Record<
    string,
    unknown
  >;

  writable["clickIds"] = data.clickId ? { gclid: data.clickId } : {};

  for (const key of [
    "utmSource",
    "utmMedium",
    "utmCampaign",
    "utmTerm",
    "utmContent",
    "utmUrl",
    "firstTouchAttribution",
  ]) {
    const value: unknown = (data as unknown as Record<string, unknown>)[key];

    if (value !== undefined) {
      writable[key] = value;
    }
  }
};

const makeUser: (
  data: {
    id: string;
    email: string;
    createdAt: Date;
  } & AttributionFixture,
) => User = (
  data: {
    id: string;
    email: string;
    createdAt: Date;
  } & AttributionFixture,
): User => {
  const user: User = new User();
  user.id = new ObjectID(data.id);
  user.email = new Email(data.email);
  user.createdAt = data.createdAt;
  applyAttribution(user, data);
  return user;
};

const makeProject: (
  data: {
    id: string;
    email: string;
    planId: string;
    seats?: number | undefined;
  } & AttributionFixture,
) => Project = (
  data: {
    id: string;
    email: string;
    planId: string;
    seats?: number | undefined;
  } & AttributionFixture,
): Project => {
  const project: Project = new Project();
  project.id = new ObjectID(data.id);
  project.createdOwnerEmail = new Email(data.email);
  project.paymentProviderPlanId = data.planId;
  project.paymentProviderSubscriptionSeats = data.seats || 1;
  applyAttribution(project, data);
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
    .mockImplementation(async (args: any): Promise<number> => {
      const existing: MarketingConversion =
        conversions.get(args.id.toString()) || new MarketingConversion();
      existing.id = args.id;
      existing.uploadState = args.data.uploadState;
      conversions.set(args.id.toString(), existing);
      return 1;
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
          select: expect.objectContaining({
            _id: true,
            email: true,
            clickIds: true,
            createdAt: true,
            utmSource: true,
            utmCampaign: true,
            firstTouchAttribution: true,
          }),
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

  /*
   * -------------------------------------------------------------------------
   * Which rows discovery is willing to see.
   *
   * Both passes used to require `clickIds notNull`, so a conversion carrying
   * utm_campaign and no ad click id never became a ledger row at all — a
   * newsletter, a sponsorship, a conference link, or any Google campaign with
   * auto-tagging switched off. That is the right filter for deciding what to
   * UPLOAD, and the providers still apply it; it is the wrong filter for
   * deciding what to RECORD, because the ledger is also what campaigns are
   * reported from.
   *
   * QueryHelper has no OR, so each filter is its own scan and the results are
   * de-duplicated in memory — which is why "a user matching both" is a case
   * worth its own test.
   * -------------------------------------------------------------------------
   */
  describe("attribution filters", () => {
    type MockDiscoveryFunction = (users: Array<User>) => {
      userFindSpy: SpyInstance<any>;
      createSpy: SpyInstance<any>;
    };

    const mockDiscovery: MockDiscoveryFunction = (
      users: Array<User>,
    ): { userFindSpy: SpyInstance<any>; createSpy: SpyInstance<any> } => {
      const userFindSpy: SpyInstance<any> = jest
        .spyOn(UserService, "findBy")
        .mockImplementation(async (args: any): Promise<Array<User>> => {
          const query: Record<string, unknown> = args.query as Record<
            string,
            unknown
          >;

          // Stand in for Postgres: return only the rows the filter selects.
          return users.filter((user: User) => {
            if (query["clickIds"]) {
              return Object.keys(user.clickIds || {}).length > 0;
            }

            if (query["utmSource"]) {
              return Boolean(user.utmSource);
            }

            return false;
          });
        });

      jest
        .spyOn(MarketingConversionService, "findBy")
        .mockResolvedValue([] as never);

      const createSpy: SpyInstance<any> = jest
        .spyOn(MarketingConversionService, "create")
        .mockImplementation(async (args: any): Promise<MarketingConversion> => {
          return args.data;
        });

      return { userFindSpy, createSpy };
    };

    test("scans once per attribution filter", async () => {
      const { userFindSpy } = mockDiscovery([]);

      await discoverSignUpConversions();

      expect(userFindSpy).toHaveBeenCalledTimes(2);
      expect(getCallArgument(userFindSpy, 0).query).toMatchObject({
        clickIds: { operator: "notNull" },
      });
      expect(getCallArgument(userFindSpy, 1).query).toMatchObject({
        utmSource: { operator: "notNull" },
      });
    });

    test("records a signup that carried a campaign but no ad click id", async () => {
      const { createSpy } = mockDiscovery([
        makeUser({
          id: "utm-only-user",
          email: "reader@example.com",
          createdAt: new Date("2026-07-20T08:00:00.000Z"),
          utmSource: "newsletter",
          utmMedium: "email",
          utmCampaign: "july-digest",
        }),
      ]);

      await discoverSignUpConversions();

      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(getCallArgument(createSpy, 0).data).toMatchObject({
        conversionType: MarketingConversionType.SignUp,
        clickIds: {},
        utmSource: "newsletter",
        utmMedium: "email",
        utmCampaign: "july-digest",
      });
    });

    test("records a user matching both filters exactly once", async () => {
      const { createSpy } = mockDiscovery([
        makeUser({
          id: "both-filters-user",
          email: "both@example.com",
          createdAt: new Date("2026-07-20T08:00:00.000Z"),
          clickId: "gclid-both",
          utmSource: "google",
        }),
      ]);

      await discoverSignUpConversions();

      expect(createSpy).toHaveBeenCalledTimes(1);
    });

    test("copies every attribution column onto the conversion", async () => {
      const { createSpy } = mockDiscovery([
        makeUser({
          id: "full-attribution-user",
          email: "buyer@example.com",
          createdAt: new Date("2026-07-20T08:00:00.000Z"),
          clickId: "gclid-full",
          utmSource: "google",
          utmMedium: "cpc",
          utmCampaign: "pagerduty-alternative",
          utmTerm: "pagerduty alternative",
          utmContent: "ad-variant-a",
          utmUrl: "https://oneuptime.com/compare/pagerduty?gclid=gclid-full",
          firstTouchAttribution: {
            utmSource: "reddit",
            landingUrl: "https://oneuptime.com/blog/slo",
          },
        }),
      ]);

      await discoverSignUpConversions();

      expect(getCallArgument(createSpy, 0).data).toMatchObject({
        clickIds: { gclid: "gclid-full" },
        utmSource: "google",
        utmMedium: "cpc",
        utmCampaign: "pagerduty-alternative",
        utmTerm: "pagerduty alternative",
        utmContent: "ad-variant-a",
        utmUrl: "https://oneuptime.com/compare/pagerduty?gclid=gclid-full",
        firstTouchAttribution: {
          utmSource: "reddit",
          landingUrl: "https://oneuptime.com/blog/slo",
        },
      });
    });

    test("stores the hashed email so the conversion can be joined later", async () => {
      const { createSpy } = mockDiscovery([
        makeUser({
          id: "hashed-user",
          email: "Buyer@Example.com",
          createdAt: new Date("2026-07-20T08:00:00.000Z"),
          clickId: "gclid-hash",
        }),
      ]);

      await discoverSignUpConversions();

      expect(getCallArgument(createSpy, 0).data.emailHash).toBe(
        Attribution.hashEmail("buyer@example.com"),
      );
    });

    test("records a paid subscription that carried a campaign but no click id", async () => {
      jest
        .spyOn(ProjectService, "findBy")
        .mockImplementation(async (args: any): Promise<Array<Project>> => {
          const query: Record<string, unknown> = args.query as Record<
            string,
            unknown
          >;

          if (!query["utmSource"]) {
            return [];
          }

          return [
            makeProject({
              id: "utm-only-project",
              email: "owner@example.com",
              planId: "monthly-plan",
              utmSource: "conference",
              utmCampaign: "kubecon-2026",
            }),
          ];
        });
      jest
        .spyOn(MarketingConversionService, "findBy")
        .mockResolvedValue([] as never);
      const createSpy: SpyInstance<any> = jest
        .spyOn(MarketingConversionService, "create")
        .mockImplementation(async (args: any): Promise<MarketingConversion> => {
          return args.data;
        });

      await discoverPaidConversions();

      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(getCallArgument(createSpy, 0).data).toMatchObject({
        conversionType: MarketingConversionType.PaidSubscription,
        clickIds: {},
        utmSource: "conference",
        utmCampaign: "kubecon-2026",
        emailHash: Attribution.hashEmail("owner@example.com"),
      });
    });
  });

  /*
   * -------------------------------------------------------------------------
   * Joining a person's conversions into one chain.
   *
   * The four conversion types are written by four unrelated code paths that
   * each see one moment: a booked meeting has no user, a signup has no
   * booking, a paid subscription knows only a project. Nothing said that a
   * demo in June, a signup in July and a subscription in October were one
   * customer — so "revenue this demo campaign produced" could not be computed
   * at all.
   *
   * emailHash is the only key that survives the gaps between them.
   * -------------------------------------------------------------------------
   */
  describe("conversion chains", () => {
    const ADA_HASH: string = Attribution.hashEmail("ada@example.com")!;
    const GRACE_HASH: string = Attribution.hashEmail("grace@example.com")!;

    type MakeChainRowFunction = (data: {
      id: string;
      emailHash?: string | undefined;
      conversionAt: string;
      createdAt?: string | undefined;
      attributedToConversionId?: string | undefined;
    }) => MarketingConversion;

    const makeChainRow: MakeChainRowFunction = (data: {
      id: string;
      emailHash?: string | undefined;
      conversionAt: string;
      createdAt?: string | undefined;
      attributedToConversionId?: string | undefined;
    }): MarketingConversion => {
      const conversion: MarketingConversion = new MarketingConversion();
      conversion.id = new ObjectID(data.id);
      conversion.emailHash = data.emailHash ?? ADA_HASH;
      conversion.conversionAt = new Date(data.conversionAt);
      conversion.createdAt = new Date(data.createdAt ?? data.conversionAt);
      if (data.attributedToConversionId) {
        conversion.attributedToConversionId = new ObjectID(
          data.attributedToConversionId,
        );
      }
      return conversion;
    };

    type MockChainScanFunction = (data: {
      unlinked: Array<MarketingConversion>;
      related: Array<MarketingConversion>;
    }) => SpyInstance<any>;

    /*
     * The pass makes two reads per page: the unlinked rows, then every
     * conversion belonging to the people on that page.
     *
     * The unlinked read is answered from a set that SHRINKS as rows are
     * linked, because that is what the query does in Postgres — a row that has
     * just been given an attributedToConversionId no longer matches
     * `attributedToConversionId IS NULL`. The pass relies on exactly that to
     * make progress without stepping over rows it has not read, so a mock that
     * kept returning the same page would be testing a different function.
     */
    const mockChainScan: MockChainScanFunction = (data: {
      unlinked: Array<MarketingConversion>;
      related: Array<MarketingConversion>;
    }): SpyInstance<any> => {
      const linkedIdSet: Set<string> = new Set<string>();

      jest
        .spyOn(MarketingConversionService, "findBy")
        .mockImplementation(
          async (args: any): Promise<Array<MarketingConversion>> => {
            const query: Record<string, unknown> = args.query as Record<
              string,
              unknown
            >;

            if (!query["attributedToConversionId"]) {
              return data.related;
            }

            const remaining: Array<MarketingConversion> = data.unlinked.filter(
              (conversion: MarketingConversion) => {
                return !linkedIdSet.has(conversion.id!.toString());
              },
            );

            const skip: number = (args.skip as number) || 0;

            return remaining.slice(skip);
          },
        );

      return jest
        .spyOn(MarketingConversionService, "updateOneById")
        .mockImplementation(async (args: any): Promise<number> => {
          linkedIdSet.add(args.id.toString());
          return 1;
        });
    };

    type LinkedIdsFunction = (
      updateSpy: SpyInstance<any>,
    ) => Array<[string, string]>;

    const linkedIds: LinkedIdsFunction = (
      updateSpy: SpyInstance<any>,
    ): Array<[string, string]> => {
      return updateSpy.mock.calls.map((call: Array<any>) => {
        const args: any = call[0];
        return [
          args.id.toString(),
          args.data.attributedToConversionId.toString(),
        ] as [string, string];
      });
    };

    test("points a later conversion at the person's first one", async () => {
      const demo: MarketingConversion = makeChainRow({
        id: "aaaaaaaa-0000-4000-8000-000000000001",
        conversionAt: "2026-06-01T10:00:00.000Z",
      });
      const signUp: MarketingConversion = makeChainRow({
        id: "aaaaaaaa-0000-4000-8000-000000000002",
        conversionAt: "2026-07-01T10:00:00.000Z",
      });

      const updateSpy: SpyInstance<any> = mockChainScan({
        unlinked: [demo, signUp],
        related: [demo, signUp],
      });

      await linkConversionChains();

      expect(linkedIds(updateSpy)).toEqual([
        [signUp.id!.toString(), demo.id!.toString()],
      ]);
    });

    /*
     * Every row points at the chain ROOT, not at its immediate predecessor, so
     * attributing a whole customer journey is a group-by rather than a
     * recursive walk.
     */
    test("points every later conversion at the same root", async () => {
      const demo: MarketingConversion = makeChainRow({
        id: "aaaaaaaa-0000-4000-8000-000000000001",
        conversionAt: "2026-06-01T10:00:00.000Z",
      });
      const signUp: MarketingConversion = makeChainRow({
        id: "aaaaaaaa-0000-4000-8000-000000000002",
        conversionAt: "2026-07-01T10:00:00.000Z",
      });
      const paid: MarketingConversion = makeChainRow({
        id: "aaaaaaaa-0000-4000-8000-000000000003",
        conversionAt: "2026-10-01T10:00:00.000Z",
      });

      const updateSpy: SpyInstance<any> = mockChainScan({
        unlinked: [demo, signUp, paid],
        related: [demo, signUp, paid],
      });

      await linkConversionChains();

      expect(linkedIds(updateSpy)).toEqual([
        [signUp.id!.toString(), demo.id!.toString()],
        [paid.id!.toString(), demo.id!.toString()],
      ]);
    });

    /*
     * The root has nothing to point at. Leaving the column null rather than
     * self-referencing is what makes "the roots" a query.
     */
    test("leaves the root unlinked", async () => {
      const onlyConversion: MarketingConversion = makeChainRow({
        id: "aaaaaaaa-0000-4000-8000-000000000001",
        conversionAt: "2026-06-01T10:00:00.000Z",
      });

      const updateSpy: SpyInstance<any> = mockChainScan({
        unlinked: [onlyConversion],
        related: [onlyConversion],
      });

      await linkConversionChains();

      expect(updateSpy).not.toHaveBeenCalled();
    });

    test("never links conversions belonging to different people", async () => {
      const adaDemo: MarketingConversion = makeChainRow({
        id: "aaaaaaaa-0000-4000-8000-000000000001",
        conversionAt: "2026-06-01T10:00:00.000Z",
      });
      const graceSignUp: MarketingConversion = makeChainRow({
        id: "bbbbbbbb-0000-4000-8000-000000000002",
        emailHash: GRACE_HASH,
        conversionAt: "2026-07-01T10:00:00.000Z",
      });

      const updateSpy: SpyInstance<any> = mockChainScan({
        unlinked: [adaDemo, graceSignUp],
        related: [adaDemo, graceSignUp],
      });

      await linkConversionChains();

      expect(updateSpy).not.toHaveBeenCalled();
    });

    /*
     * A Cal booking is stamped with the MEETING's start time, which can be
     * weeks after the person asked for it. Ordering on conversionAt alone
     * would make someone who booked on Monday and signed up on Tuesday, for a
     * meeting on Friday, look like they signed up first — and the booking, the
     * thing the campaign actually produced, would hang off the signup.
     */
    test("orders a future-dated booking by when it was actually made", async () => {
      const booking: MarketingConversion = makeChainRow({
        id: "aaaaaaaa-0000-4000-8000-000000000001",
        // Booked on the 1st, for a meeting on the 20th.
        createdAt: "2026-06-01T10:00:00.000Z",
        conversionAt: "2026-06-20T10:00:00.000Z",
      });
      const signUp: MarketingConversion = makeChainRow({
        id: "aaaaaaaa-0000-4000-8000-000000000002",
        conversionAt: "2026-06-02T10:00:00.000Z",
      });

      const updateSpy: SpyInstance<any> = mockChainScan({
        unlinked: [booking, signUp],
        related: [booking, signUp],
      });

      await linkConversionChains();

      expect(linkedIds(updateSpy)).toEqual([
        [signUp.id!.toString(), booking.id!.toString()],
      ]);
    });

    test("links a root that is older than the scan window", async () => {
      // The root is not in the unlinked page — it is already linked, or old.
      const oldDemo: MarketingConversion = makeChainRow({
        id: "aaaaaaaa-0000-4000-8000-000000000001",
        conversionAt: "2025-01-01T10:00:00.000Z",
      });
      const recentPaid: MarketingConversion = makeChainRow({
        id: "aaaaaaaa-0000-4000-8000-000000000003",
        conversionAt: "2026-07-01T10:00:00.000Z",
      });

      const updateSpy: SpyInstance<any> = mockChainScan({
        unlinked: [recentPaid],
        related: [oldDemo, recentPaid],
      });

      await linkConversionChains();

      expect(linkedIds(updateSpy)).toEqual([
        [recentPaid.id!.toString(), oldDemo.id!.toString()],
      ]);
    });

    /*
     * The pagination is the subtle part of this pass, because the result set
     * shrinks underneath it: a linked row stops matching the query. Chain roots
     * never get a link, so a page made entirely of them would be re-read
     * forever unless the offset steps past it — and stepping past it must not
     * step over rows that have not been read yet.
     *
     * This builds a first page that is nothing but roots, with linkable rows
     * behind it, so a cursor that fails to advance never reaches them and a
     * cursor that advances too eagerly skips them.
     */
    test("reaches linkable rows sitting behind a full page of roots", async () => {
      const CHAIN_LINK_PAGE_SIZE: number = 500;

      const roots: Array<MarketingConversion> = Array.from(
        { length: CHAIN_LINK_PAGE_SIZE },
        (_unused: unknown, index: number) => {
          return makeChainRow({
            id: `cccccccc-0000-4000-8000-${String(index).padStart(12, "0")}`,
            emailHash: `hash-${index}`,
            conversionAt: "2026-06-01T10:00:00.000Z",
          });
        },
      );

      const demo: MarketingConversion = makeChainRow({
        id: "dddddddd-0000-4000-8000-000000000001",
        conversionAt: "2026-06-01T10:00:00.000Z",
      });
      const signUp: MarketingConversion = makeChainRow({
        id: "dddddddd-0000-4000-8000-000000000002",
        conversionAt: "2026-07-01T10:00:00.000Z",
      });

      const updateSpy: SpyInstance<any> = mockChainScan({
        unlinked: [...roots, demo, signUp],
        related: [...roots, demo, signUp],
      });

      await linkConversionChains();

      expect(linkedIds(updateSpy)).toEqual([
        [signUp.id!.toString(), demo.id!.toString()],
      ]);
    });

    test("only considers rows that have no link and have an email hash", async () => {
      const findBySpy: SpyInstance<any> = jest
        .spyOn(MarketingConversionService, "findBy")
        .mockResolvedValue([] as never);
      jest
        .spyOn(MarketingConversionService, "updateOneById")
        .mockResolvedValue(undefined as never);

      await linkConversionChains();

      expect(getCallArgument(findBySpy, 0).query).toMatchObject({
        emailHash: { operator: "notNull" },
        attributedToConversionId: { operator: "isNull" },
      });
    });

    /*
     * A row that already has a link is never revised. That keeps the pass
     * idempotent and stops a late-arriving row silently re-parenting history
     * that has already been reported.
     */
    test("makes no writes when everything is already linked", async () => {
      const findBySpy: SpyInstance<any> = jest
        .spyOn(MarketingConversionService, "findBy")
        .mockResolvedValue([] as never);
      const updateSpy: SpyInstance<any> = jest
        .spyOn(MarketingConversionService, "updateOneById")
        .mockResolvedValue(undefined as never);

      await linkConversionChains();

      expect(updateSpy).not.toHaveBeenCalled();
      // One page read, no follow-up read for a page with nothing in it.
      expect(findBySpy).toHaveBeenCalledTimes(1);
    });

    test("keeps going when one row's write fails", async () => {
      const demo: MarketingConversion = makeChainRow({
        id: "aaaaaaaa-0000-4000-8000-000000000001",
        conversionAt: "2026-06-01T10:00:00.000Z",
      });
      const signUp: MarketingConversion = makeChainRow({
        id: "aaaaaaaa-0000-4000-8000-000000000002",
        conversionAt: "2026-07-01T10:00:00.000Z",
      });
      const paid: MarketingConversion = makeChainRow({
        id: "aaaaaaaa-0000-4000-8000-000000000003",
        conversionAt: "2026-10-01T10:00:00.000Z",
      });

      const linkedIdSet: Set<string> = new Set<string>();

      jest
        .spyOn(MarketingConversionService, "findBy")
        .mockImplementation(
          async (args: any): Promise<Array<MarketingConversion>> => {
            if (
              !(args.query as Record<string, unknown>)[
                "attributedToConversionId"
              ]
            ) {
              return [demo, signUp, paid];
            }

            return [demo, signUp, paid].filter(
              (conversion: MarketingConversion) => {
                return !linkedIdSet.has(conversion.id!.toString());
              },
            );
          },
        );

      const updateSpy: SpyInstance<any> = jest
        .spyOn(MarketingConversionService, "updateOneById")
        .mockImplementationOnce(async (): Promise<number> => {
          throw new Error("write conflict");
        })
        .mockImplementation(async (args: any): Promise<number> => {
          linkedIdSet.add(args.id.toString());
          return 1;
        });

      await expect(linkConversionChains()).resolves.toBeUndefined();

      /*
       * signUp fails, paid succeeds; the next pass retries signUp, which now
       * succeeds. The failure costs a retry, not the link.
       */
      expect(updateSpy).toHaveBeenCalledTimes(3);
      expect(linkedIdSet.has(signUp.id!.toString())).toBe(true);
      expect(linkedIdSet.has(paid.id!.toString())).toBe(true);
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

    /*
     * The MeetingBooked rows the Cal webhook writes share this ledger and this
     * job. No provider has a conversion action for a booked meeting, and every
     * provider's mapping is `isSignUp ? signup : purchase` -- so an unscreened
     * booking would be uploaded as a purchase. The screen lives in
     * ConversionUploadProvider.getSkipReason; what matters here is that the job
     * honours it and settles the row instead of retrying it forever.
     */
    /*
     * conversionType is a plain varchar, so a value the enum does not name can
     * reach the worker — from a rolled-back deploy, a hand-written row, or a
     * future type an older worker has not learned yet. The base-class screen
     * refuses it before any provider is asked, which is the one behaviour that
     * has to hold whatever the allowlist currently contains.
     */
    test("skips a conversion type no ad platform has a mapping for", async () => {
      const unknownType: MarketingConversion = makeConversion({
        id: "unknown-type",
        type: "SomeFutureType" as MarketingConversionType,
      });
      jest
        .spyOn(MarketingConversionService, "findBy")
        .mockResolvedValue([unknownType] as never);
      const provider: TestProvider = new TestProvider();

      await uploadToProvider(provider);

      expect(provider.uploadedBatches).toHaveLength(0);
      expect(getProviderState(unknownType, provider.key)).toMatchObject({
        status: MarketingConversionUploadStatus.Skipped,
        error:
          "Conversion type SomeFutureType has no ad platform conversion mapping",
      });
    });

    /*
     * Every type the ledger records is uploadable now — including the two
     * sales-led ones, which is the entire point of the change. What must still
     * be excluded is the type nothing has a mapping for.
     */
    test("uploads every mapped conversion type and nothing else", async () => {
      const signUp: MarketingConversion = makeConversion({
        id: "mixed-signup",
        type: MarketingConversionType.SignUp,
      });
      const meeting: MarketingConversion = makeConversion({
        id: "mixed-meeting",
        type: MarketingConversionType.MeetingBooked,
      });
      const paid: MarketingConversion = makeConversion({
        id: "mixed-paid",
        type: MarketingConversionType.PaidSubscription,
      });
      const unknownType: MarketingConversion = makeConversion({
        id: "mixed-unknown",
        type: "SomeFutureType" as MarketingConversionType,
      });
      jest
        .spyOn(MarketingConversionService, "findBy")
        .mockResolvedValue([signUp, meeting, paid, unknownType] as never);
      const provider: TestProvider = new TestProvider();

      await uploadToProvider(provider);

      expect(provider.uploadedBatches).toEqual([[signUp, meeting, paid]]);
    });

    // Permanent, so the next run filters it out rather than re-skipping it.
    test("settles the unmappable conversion so a later run never revisits it", async () => {
      const unknownType: MarketingConversion = makeConversion({
        id: "unknown-settled",
        type: "SomeFutureType" as MarketingConversionType,
      });
      const findBySpy: SpyInstance<any> = jest
        .spyOn(MarketingConversionService, "findBy")
        .mockResolvedValue([unknownType] as never);
      const provider: TestProvider = new TestProvider();

      await uploadToProvider(provider);

      const updateCallsAfterFirstRun: number = (
        MarketingConversionService.updateOneById as unknown as jest.Mock
      ).mock.calls.length;

      findBySpy.mockResolvedValue([unknownType] as never);
      await uploadToProvider(provider);

      expect(
        (MarketingConversionService.updateOneById as unknown as jest.Mock).mock
          .calls.length,
      ).toBe(updateCallsAfterFirstRun);
      expect(provider.uploadedBatches).toHaveLength(0);
    });
  });
});
