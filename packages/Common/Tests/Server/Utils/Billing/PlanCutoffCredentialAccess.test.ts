import PlanCutoffCredentialAccess from "../../../../Server/Utils/Billing/PlanCutoffCredentialAccess";
import ProjectService, {
  CurrentPlan,
} from "../../../../Server/Services/ProjectService";
import ApiKey from "../../../../Models/DatabaseModels/ApiKey";
import ProjectSCIM from "../../../../Models/DatabaseModels/ProjectSCIM";
import StatusPageSCIM from "../../../../Models/DatabaseModels/StatusPageSCIM";
import {
  getApiKeysStoppedMessage,
  getScimStoppedMessage,
  PlanCutoffCredential,
} from "../../../../Types/Billing/PlanCutoffCredentials";
import { PlanType } from "../../../../Types/Billing/SubscriptionPlan";
import BadDataException from "../../../../Types/Exception/BadDataException";
import PaymentRequiredException from "../../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../../Types/ObjectID";
import { setTestBillingEnabled } from "../../Enterprise/TestBillingFlag";
import { getJestSpyOn } from "../../../Spy";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../../Enterprise/TestBillingFlag",
    ) as typeof import("../../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

/*
 * Whether a project's API keys and SCIM connections work on its plan
 * (PlanCutoffCredentialAccess), asked where each authenticates. The plan is
 * the one every request is held to (ProjectService.getCurrentPlan, stubbed
 * here), compared the way every plan check compares
 * (BillingPermissions.getMissingPlan).
 */

const PLAN_ENVIRONMENT: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC: "Free,price_free_month,price_free_year,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH:
    "Growth,price_growth_month,price_growth_year,22,20,2,14",
  SUBSCRIPTION_PLAN_SCALE:
    "Scale,price_scale_month,price_scale_year,99,84,3,14",
  SUBSCRIPTION_PLAN_ENTERPRISE:
    "Enterprise,price_enterprise_month,price_enterprise_year,-1,-1,4,14",
};

const PROJECT_ID: ObjectID = new ObjectID(
  "7a000000-0000-4000-8000-000000000001",
);

const ALL_PLANS: ReadonlyArray<PlanType> = [
  PlanType.Free,
  PlanType.Growth,
  PlanType.Scale,
  PlanType.Enterprise,
];

const SCIM_CREDENTIALS: ReadonlyArray<PlanCutoffCredential> = [
  PlanCutoffCredential.ProjectSCIM,
  PlanCutoffCredential.StatusPageSCIM,
];

const savedPlanEnvironment: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("SUBSCRIPTION_PLAN_")) {
      savedPlanEnvironment[key] = process.env[key];
      delete process.env[key];
    }
  }

  Object.assign(process.env, PLAN_ENVIRONMENT);
});

afterAll(() => {
  for (const key of Object.keys(PLAN_ENVIRONMENT)) {
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(savedPlanEnvironment)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }

  setTestBillingEnabled(false);
});

let getCurrentPlan: ReturnType<typeof getJestSpyOn>;

const onPlan: (plan: PlanType | null, isSubscriptionUnpaid?: boolean) => void = (
  plan: PlanType | null,
  isSubscriptionUnpaid?: boolean,
): void => {
  getCurrentPlan.mockResolvedValue({
    plan: plan,
    isSubscriptionUnpaid: Boolean(isSubscriptionUnpaid),
  } as CurrentPlan);
};

beforeEach(() => {
  setTestBillingEnabled(true);
  getCurrentPlan = getJestSpyOn(ProjectService, "getCurrentPlan");
  onPlan(PlanType.Free);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the plan each credential needs", () => {
  test("API keys need Growth, the plan the ApiKey table is sold on", () => {
    expect(
      PlanCutoffCredentialAccess.getRequiredPlan(PlanCutoffCredential.ApiKey),
    ).toBe(PlanType.Growth);
    expect(new ApiKey().getCreateBillingPlan()).toBe(PlanType.Growth);
  });

  test("project SCIM needs Scale, the plan the ProjectSCIM table is sold on", () => {
    expect(
      PlanCutoffCredentialAccess.getRequiredPlan(
        PlanCutoffCredential.ProjectSCIM,
      ),
    ).toBe(PlanType.Scale);
    expect(new ProjectSCIM().getCreateBillingPlan()).toBe(PlanType.Scale);
  });

  test("status page SCIM needs Scale, the plan the StatusPageSCIM table is sold on", () => {
    expect(
      PlanCutoffCredentialAccess.getRequiredPlan(
        PlanCutoffCredential.StatusPageSCIM,
      ),
    ).toBe(PlanType.Scale);
    expect(new StatusPageSCIM().getCreateBillingPlan()).toBe(PlanType.Scale);
  });
});

describe("whether a plan includes a credential", () => {
  test.each([
    [PlanType.Free, false],
    [PlanType.Growth, true],
    [PlanType.Scale, true],
    [PlanType.Enterprise, true],
  ])("API keys on %s: %s", (plan: PlanType, expected: boolean) => {
    expect(
      PlanCutoffCredentialAccess.isOnPlan({
        credential: PlanCutoffCredential.ApiKey,
        currentPlan: plan,
      }),
    ).toBe(expected);
  });

  test.each([
    [PlanType.Free, false],
    [PlanType.Growth, false],
    [PlanType.Scale, true],
    [PlanType.Enterprise, true],
  ])("SCIM on %s: %s", (plan: PlanType, expected: boolean) => {
    for (const credential of SCIM_CREDENTIALS) {
      expect(
        PlanCutoffCredentialAccess.isOnPlan({
          credential,
          currentPlan: plan,
        }),
      ).toBe(expected);
    }
  });

  test("no plan at all (billing off) includes everything", () => {
    for (const credential of [
      PlanCutoffCredential.ApiKey,
      ...SCIM_CREDENTIALS,
    ]) {
      expect(
        PlanCutoffCredentialAccess.isOnPlan({ credential, currentPlan: null }),
      ).toBe(true);
    }
  });
});

describe("with billing off (self-hosted)", () => {
  beforeEach(() => {
    setTestBillingEnabled(false);
  });

  test.each(ALL_PLANS)(
    "nothing is missing, whatever the stored plan (%s), and the plan is not even read",
    async (plan: PlanType) => {
      onPlan(plan);

      for (const credential of [
        PlanCutoffCredential.ApiKey,
        ...SCIM_CREDENTIALS,
      ]) {
        expect(
          await PlanCutoffCredentialAccess.getMissingPlan({
            projectId: PROJECT_ID,
            credential,
          }),
        ).toBeNull();
        expect(
          await PlanCutoffCredentialAccess.getRefusal({
            projectId: PROJECT_ID,
            credential,
          }),
        ).toBeNull();
      }

      expect(getCurrentPlan).not.toHaveBeenCalled();
    },
  );
});

describe("with billing on (OneUptime Cloud)", () => {
  test.each([
    [PlanType.Free, PlanType.Growth],
    [PlanType.Growth, null],
    [PlanType.Scale, null],
    [PlanType.Enterprise, null],
  ])(
    "a project on %s is missing %s for its API keys",
    async (plan: PlanType, missing: PlanType | null) => {
      onPlan(plan);

      expect(
        await PlanCutoffCredentialAccess.getMissingPlan({
          projectId: PROJECT_ID,
          credential: PlanCutoffCredential.ApiKey,
        }),
      ).toBe(missing);
    },
  );

  test.each([
    [PlanType.Free, PlanType.Scale],
    [PlanType.Growth, PlanType.Scale],
    [PlanType.Scale, null],
    [PlanType.Enterprise, null],
  ])(
    "a project on %s is missing %s for its SCIM connections, project and status page alike",
    async (plan: PlanType, missing: PlanType | null) => {
      onPlan(plan);

      for (const credential of SCIM_CREDENTIALS) {
        expect(
          await PlanCutoffCredentialAccess.getMissingPlan({
            projectId: PROJECT_ID,
            credential,
          }),
        ).toBe(missing);
      }
    },
  );

  test("reads the plan of the credential's own project", async () => {
    onPlan(PlanType.Growth);

    await PlanCutoffCredentialAccess.getMissingPlan({
      projectId: PROJECT_ID,
      credential: PlanCutoffCredential.ApiKey,
    });

    expect(getCurrentPlan).toHaveBeenCalledTimes(1);
    expect(String(getCurrentPlan.mock.calls[0]![0])).toBe(
      PROJECT_ID.toString(),
    );
  });

  /*
   * A trial is its plan (a Growth trial reads as Growth), and so is a
   * subscription that is past due (still active: Stripe is retrying). Both
   * reach here as the plan; neither is a downgrade.
   */
  test("a trial or a past-due subscription counts as its plan", async () => {
    onPlan(PlanType.Growth, false);

    expect(
      await PlanCutoffCredentialAccess.getMissingPlan({
        projectId: PROJECT_ID,
        credential: PlanCutoffCredential.ApiKey,
      }),
    ).toBeNull();
  });

  /*
   * An unpaid subscription is not a plan change. It is held to the unpaid
   * checks the rest of billing makes on each record, as before - this check
   * neither adds to them nor lifts them.
   */
  test("an unpaid subscription on the plan is not cut off here", async () => {
    onPlan(PlanType.Scale, true);

    for (const credential of [
      PlanCutoffCredential.ApiKey,
      ...SCIM_CREDENTIALS,
    ]) {
      expect(
        await PlanCutoffCredentialAccess.getMissingPlan({
          projectId: PROJECT_ID,
          credential,
        }),
      ).toBeNull();
    }
  });

  test("an unpaid subscription below the plan is still below it", async () => {
    onPlan(PlanType.Free, true);

    expect(
      await PlanCutoffCredentialAccess.getMissingPlan({
        projectId: PROJECT_ID,
        credential: PlanCutoffCredential.ApiKey,
      }),
    ).toBe(PlanType.Growth);
  });

  test("a project whose plan is not known (no plan read) misses nothing", async () => {
    onPlan(null);

    expect(
      await PlanCutoffCredentialAccess.getMissingPlan({
        projectId: PROJECT_ID,
        credential: PlanCutoffCredential.ApiKey,
      }),
    ).toBeNull();
  });

  /*
   * A project that does not exist, or has no plan yet, fails every request
   * of the project the same way (CommonAPI reads the same plan): the
   * credential is not let through on a plan nobody could read.
   */
  test("a plan that cannot be read fails closed", async () => {
    getCurrentPlan.mockRejectedValue(
      new BadDataException("Project does not have any plans"),
    );

    await expect(
      PlanCutoffCredentialAccess.getMissingPlan({
        projectId: PROJECT_ID,
        credential: PlanCutoffCredential.ApiKey,
      }),
    ).rejects.toThrow("Project does not have any plans");
  });

  test("an upgrade turns the same project's keys back on, with nothing else changed", async () => {
    onPlan(PlanType.Free);

    expect(
      await PlanCutoffCredentialAccess.getMissingPlan({
        projectId: PROJECT_ID,
        credential: PlanCutoffCredential.ApiKey,
      }),
    ).toBe(PlanType.Growth);

    onPlan(PlanType.Growth);

    expect(
      await PlanCutoffCredentialAccess.getMissingPlan({
        projectId: PROJECT_ID,
        credential: PlanCutoffCredential.ApiKey,
      }),
    ).toBeNull();
  });
});

describe("the refusal", () => {
  test("for an API key below Growth is a 402 that names Growth and says the keys are kept", async () => {
    onPlan(PlanType.Free);

    const refusal: PaymentRequiredException | null =
      await PlanCutoffCredentialAccess.getRefusal({
        projectId: PROJECT_ID,
        credential: PlanCutoffCredential.ApiKey,
      });

    expect(refusal).toBeInstanceOf(PaymentRequiredException);
    expect(refusal!.code).toBe(402);
    expect(refusal!.message).toBe(getApiKeysStoppedMessage(PlanType.Growth));
  });

  test.each(SCIM_CREDENTIALS)(
    "for %s below Scale is a 402 that names Scale",
    async (credential: PlanCutoffCredential) => {
      onPlan(PlanType.Growth);

      const refusal: PaymentRequiredException | null =
        await PlanCutoffCredentialAccess.getRefusal({
          projectId: PROJECT_ID,
          credential,
        });

      expect(refusal!.code).toBe(402);
      expect(refusal!.message).toBe(getScimStoppedMessage(PlanType.Scale));
    },
  );

  test("is none on the plan", async () => {
    onPlan(PlanType.Scale);

    for (const credential of [
      PlanCutoffCredential.ApiKey,
      ...SCIM_CREDENTIALS,
    ]) {
      expect(
        await PlanCutoffCredentialAccess.getRefusal({
          projectId: PROJECT_ID,
          credential,
        }),
      ).toBeNull();
    }
  });
});
