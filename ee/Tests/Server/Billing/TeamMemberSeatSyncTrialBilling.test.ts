// First, so the Stripe client the enterprise module builds is the mocked one.
import { Stripe, mockStripe } from "./Helpers/Stripe.mock";
import getJestMockFunction from "Common/Tests/MockType";
import Project from "Common/Models/DatabaseModels/Project";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import Semaphore, {
  SemaphoreMutex,
} from "Common/Server/Infrastructure/Semaphore";
import ProjectService from "Common/Server/Services/ProjectService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import { OnCreate } from "Common/Server/Types/Database/Hooks";
import logger from "Common/Server/Utils/Logger";
import ProductAnalytics from "Common/Server/Utils/ProductAnalytics";
import SubscriptionPlan from "Common/Types/Billing/SubscriptionPlan";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import { stubProjectDirectory } from "Common/Tests/Server/TestingUtils/ProjectDirectory";
import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";
import EnterpriseModule from "../../../Server/Index";

/*
 * "I started a trial but I was charged when I added users to the team."
 *
 * Every invitation and removal recounts the project's people and puts that
 * count on its flat-fee subscription: TeamMemberService.onCreateSuccess ->
 * updateSubscriptionSeatsByUniqueTeamMembersInProject ->
 * BillingService.changeQuantity -> Stripe. Here only Stripe, the database
 * and the lock are stand-ins, so what reaches Stripe is what an invitation
 * really sends - and that alone decides whether the customer is charged.
 */

/*
 * OneUptime Cloud: the real enterprise module is registered, so core's
 * BillingService hands changeQuantity to the module's StripeBillingProvider,
 * as on oneuptime.com.
 */
beforeAll(() => {
  EnterpriseEdition.resetForTests();
  EnterpriseEdition.register(EnterpriseModule);
});

afterAll(() => {
  EnterpriseEdition.resetForTests();
});

jest.mock("Common/Server/EnvironmentConfig", () => {
  const config: Record<string, unknown> = {
    ...jest.requireActual("Common/Server/EnvironmentConfig"),
  };

  // Preserve the configurable getter when TypeScript imports this namespace.
  Object.defineProperty(config, "__esModule", { value: true });

  Object.defineProperty(config, "IsBillingEnabled", {
    configurable: true,
    enumerable: true,
    get: (): boolean => {
      return true;
    },
  });

  return config;
});

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const TEAM_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const MEMBER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const SUBSCRIPTION_ID: string = "sub_flat_fee_123";
const ITEM_ID: string = "si_flat_fee_123";

// Growth, billed yearly: $20 a month, so $240 a seat for the year.
const PLAN_ID: string = "price_growth_yearly";

let project: Project;

// What Stripe holds: the subscription's status, trial and seat count.
let stripeStatus: Stripe.Subscription.Status;
let stripeTrialEnd: number | null;
let stripeSeats: number;

let memberCountSpy: jest.SpyInstance;

interface SeatUpdate {
  projectId: ObjectID;
  subscriptionId: string;
  planId: string;
  seats: number | null;
}

function daysFromNow(days: number): number {
  return OneUptimeDate.toUnixTimestamp(
    OneUptimeDate.addRemoveDays(OneUptimeDate.getCurrentDate(), days),
  );
}

function updateCalls(): Array<[string, Stripe.SubscriptionUpdateParams]> {
  return (
    mockStripe.subscriptions.update as unknown as {
      mock: { calls: Array<[string, Stripe.SubscriptionUpdateParams]> };
    }
  ).mock.calls;
}

// Whether Stripe was asked, in any way, to raise an invoice right now.
function wasAskedToInvoice(): boolean {
  return (
    updateCalls().some((call: [string, Stripe.SubscriptionUpdateParams]) => {
      return call[1].proration_behavior !== "none";
    }) ||
    (
      mockStripe.invoices.create as unknown as {
        mock: { calls: Array<unknown> };
      }
    ).mock.calls.length > 0 ||
    (
      mockStripe.subscriptionItems.update as unknown as {
        mock: { calls: Array<unknown> };
      }
    ).mock.calls.length > 0
  );
}

async function inviteBringingTheProjectTo(people: number): Promise<void> {
  memberCountSpy.mockResolvedValue(people);

  await TeamMemberService.updateSubscriptionSeatsByUniqueTeamMembersInProject(
    PROJECT_ID,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  stubProjectDirectory({});

  project = new Project(PROJECT_ID);
  project.paymentProviderSubscriptionId = SUBSCRIPTION_ID;
  project.paymentProviderPlanId = PLAN_ID;
  project.paymentProviderSubscriptionSeats = 1;

  stripeStatus = "trialing";
  stripeTrialEnd = daysFromNow(14);
  stripeSeats = 1;

  mockStripe.subscriptions.retrieve = getJestMockFunction().mockImplementation(
    async (): Promise<Stripe.Subscription> => {
      return {
        id: SUBSCRIPTION_ID,
        status: stripeStatus,
        trial_end: stripeTrialEnd,
        items: {
          data: [{ id: ITEM_ID, quantity: stripeSeats }],
        },
      } as unknown as Stripe.Subscription;
    },
  );

  mockStripe.subscriptions.update = getJestMockFunction().mockImplementation(
    async (
      _subscriptionId: string,
      params: Stripe.SubscriptionUpdateParams,
    ): Promise<Record<string, unknown>> => {
      stripeSeats = params.items?.[0]?.quantity ?? stripeSeats;
      return {};
    },
  );

  jest.spyOn(Semaphore, "lock").mockResolvedValue({} as SemaphoreMutex);
  jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);
  jest
    .spyOn(ProjectService, "findOneById")
    .mockImplementation(async (): Promise<Project> => {
      return Object.assign(new Project(PROJECT_ID), project);
    });
  jest
    .spyOn(ProjectService, "updateSubscriptionSeats")
    .mockImplementation((async (update: SeatUpdate): Promise<number> => {
      project.setColumnValue("paymentProviderSubscriptionSeats", update.seats);
      return 1;
    }) as never);
  memberCountSpy = jest
    .spyOn(TeamMemberService, "getUniqueTeamMemberCountInProject")
    .mockResolvedValue(1);
  jest
    .spyOn(SubscriptionPlan, "getSubscriptionPlanById")
    .mockReturnValue(
      new SubscriptionPlan(
        "price_growth_monthly",
        PLAN_ID,
        "Growth",
        22,
        20,
        2,
        14,
      ),
    );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("inviting people while the project is on its trial", () => {
  test("puts the new seat on the subscription without raising an invoice", async () => {
    await inviteBringingTheProjectTo(2);

    expect(updateCalls()).toEqual([
      [
        SUBSCRIPTION_ID,
        {
          items: [{ id: ITEM_ID, quantity: 2 }],
          proration_behavior: "none",
        },
      ],
    ]);
    expect(wasAskedToInvoice()).toBe(false);
    expect(project.paymentProviderSubscriptionSeats).toBe(2);
  });

  test("raises no invoice for any of five invitations in a row", async () => {
    // Inviting a team is several invitations, one after another.
    for (let people: number = 2; people <= 6; people++) {
      await inviteBringingTheProjectTo(people);
    }

    expect(updateCalls()).toHaveLength(5);
    expect(wasAskedToInvoice()).toBe(false);

    // Stripe holds every seat, for the invoice that ends the trial.
    expect(stripeSeats).toBe(6);
    expect(project.paymentProviderSubscriptionSeats).toBe(6);
  });

  test("raises no invoice when someone is removed either", async () => {
    project.paymentProviderSubscriptionSeats = 4;
    stripeSeats = 4;

    await inviteBringingTheProjectTo(3);

    expect(updateCalls()[0]![1]).toEqual({
      items: [{ id: ITEM_ID, quantity: 3 }],
      proration_behavior: "none",
    });
    expect(wasAskedToInvoice()).toBe(false);
  });

  test("goes all the way from the invitation hook", async () => {
    /*
     * The hook TeamMemberService runs once a pending invitation is saved:
     * it refreshes the person's tokens, syncs the seats and records the
     * invitation for analytics.
     */
    jest.spyOn(TeamMemberService, "refreshTokens").mockResolvedValue(undefined);
    jest.spyOn(ProductAnalytics, "captureForUser").mockImplementation(() => {});
    const errorSpy: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation(() => {});

    memberCountSpy.mockResolvedValue(2);

    const invited: TeamMember = new TeamMember(MEMBER_ID);
    invited.projectId = PROJECT_ID;
    invited.teamId = TEAM_ID;
    invited.userId = ObjectID.generate();
    invited.hasAcceptedInvitation = false;

    const onCreate: OnCreate<TeamMember> = {
      createBy: {
        data: invited,
        props: { isRoot: true, tenantId: PROJECT_ID },
      },
      carryForward: null,
    };

    await (
      TeamMemberService as unknown as {
        onCreateSuccess: (
          onCreate: OnCreate<TeamMember>,
          createdItem: TeamMember,
        ) => Promise<TeamMember>;
      }
    ).onCreateSuccess(onCreate, invited);

    expect(errorSpy).not.toHaveBeenCalled();
    expect(updateCalls()).toEqual([
      [
        SUBSCRIPTION_ID,
        {
          items: [{ id: ITEM_ID, quantity: 2 }],
          proration_behavior: "none",
        },
      ],
    ]);
    expect(wasAskedToInvoice()).toBe(false);
  });
});

describe("inviting people once the project is past its trial", () => {
  test("prorates the new seat and invoices it straight away", async () => {
    /*
     * The reported case: a project on Growth billed yearly after an upgrade
     * from Free, which carries no trial. Each of its invitations was
     * invoiced like this, for the seat's price over the rest of the year.
     */
    stripeStatus = "active";
    stripeTrialEnd = null;

    await inviteBringingTheProjectTo(2);

    expect(updateCalls()).toEqual([
      [
        SUBSCRIPTION_ID,
        {
          items: [{ id: ITEM_ID, quantity: 2 }],
          proration_behavior: "always_invoice",
        },
      ],
    ]);
  });

  test("invoices straight away once a trial has lapsed", async () => {
    stripeStatus = "active";
    stripeTrialEnd = daysFromNow(-1);

    await inviteBringingTheProjectTo(2);

    expect(updateCalls()[0]![1].proration_behavior).toBe("always_invoice");
  });
});

describe("when the seats already match", () => {
  test("asks Stripe for nothing when it already holds the count", async () => {
    /*
     * The acknowledged count was lost (a provider timeout) but Stripe applied
     * the change: reconciliation finds Stripe right and leaves it alone.
     */
    project.paymentProviderSubscriptionSeats = null as unknown as number;
    stripeSeats = 3;
    stripeStatus = "active";
    stripeTrialEnd = null;

    await inviteBringingTheProjectTo(3);

    expect(updateCalls()).toHaveLength(0);
    expect(project.paymentProviderSubscriptionSeats).toBe(3);
  });
});
