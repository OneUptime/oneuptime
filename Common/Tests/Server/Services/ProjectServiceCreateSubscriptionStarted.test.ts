import ProjectService from "../../../Server/Services/ProjectService";
import BillingService from "../../../Server/Services/BillingService";
import MarketingEventUtil from "../../../Server/Utils/Marketing/MarketingEventUtil";
import ProductAnalytics from "../../../Server/Utils/ProductAnalytics";
import Project from "../../../Models/DatabaseModels/Project";
import SubscriptionPlan from "../../../Types/Billing/SubscriptionPlan";
import { MarketingEvent } from "../../../Types/Marketing/MarketingEvent";
import { resolveEmittedMarketingEvent } from "../Utils/Marketing/EmittedMarketingEvent";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, it, afterEach } from "@jest/globals";

/*
 * A project created directly on a paid plan never passes through changePlan,
 * so before subscription_started existed the most bid-worthy self-serve
 * conversion there is - ad click, signup, pick Growth, pay - emitted nothing
 * at all. This suite covers the event that closes that gap, and in particular
 * the two things a receiver cannot recover if they are wrong: the dedup key,
 * and the fact that this is new business rather than expansion.
 *
 * Everything below the service boundary is spied: no database, no Stripe, no
 * queue, no analytics client.
 */

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...jest.requireActual("../../../Server/EnvironmentConfig"),
    IsBillingEnabled: true,

    /*
     * config.env carries real incoming webhook URLs, and project creation
     * announces itself on one. Blanked so the suite cannot post to Slack.
     */
    NotificationSlackWebhookOnCreateProject: "",
    NotificationSlackWebhookOnSubscriptionUpdate: "",
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OWNER_EMAIL: string = "owner@example.com";
const CREATED_AT: Date = new Date("2026-08-24T10:00:00.000Z");

const GROWTH_MONTHLY_PLAN_ID: string = "price_monthly_growth";
const GROWTH_YEARLY_PLAN_ID: string = "price_yearly_growth";
const FREE_MONTHLY_PLAN_ID: string = "price_monthly_free";
const ENTERPRISE_MONTHLY_PLAN_ID: string = "price_monthly_enterprise";

// Growth: $49/mo, or $45/mo when billed yearly.
const GROWTH_MONTHLY_AMOUNT: number = 49;
const GROWTH_YEARLY_AMOUNT: number = 45;

/*
 * The three plan shapes that matter here. Enterprise carries the -1 amount
 * sentinel that means "priced by a human", which is what isCustomPricing
 * reads.
 */
const GROWTH_PLAN: SubscriptionPlan = new SubscriptionPlan(
  GROWTH_MONTHLY_PLAN_ID,
  GROWTH_YEARLY_PLAN_ID,
  "Growth",
  GROWTH_MONTHLY_AMOUNT,
  GROWTH_YEARLY_AMOUNT,
  2,
  14,
);

const FREE_PLAN: SubscriptionPlan = new SubscriptionPlan(
  FREE_MONTHLY_PLAN_ID,
  "price_yearly_free",
  "Free",
  0,
  0,
  1,
  0,
);

const ENTERPRISE_PLAN: SubscriptionPlan = new SubscriptionPlan(
  ENTERPRISE_MONTHLY_PLAN_ID,
  "price_yearly_enterprise",
  "Enterprise",
  -1,
  -1,
  4,
  0,
);

function fakeProject(overrides?: Record<string, unknown>): Project {
  return {
    id: PROJECT_ID,
    _id: PROJECT_ID.toString(),
    name: "Acme",
    createdAt: CREATED_AT,
    createdOwnerEmail: OWNER_EMAIL,
    paymentProviderPlanId: GROWTH_MONTHLY_PLAN_ID,
    planName: "Growth",

    // The attribution the creating user carried, copied onto the project row.
    utmSource: "google",
    utmMedium: "cpc",
    utmCampaign: "brand-uk",
    utmTerm: "status page",
    utmContent: "hero-cta",
    clickIds: { gclid: "gclid_abc123" },
    ...overrides,
  } as unknown as Project;
}

describe("ProjectService project creation - subscription_started", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  interface CreateSpies {
    createCustomer: jest.SpyInstance;
    subscribeToPlan: jest.SpyInstance;
    updateOneById: jest.SpyInstance;
    capture: jest.SpyInstance;
    emitInBackground: jest.SpyInstance;
  }

  /*
   * The nine default-row seeders run after the conversion is captured and each
   * one writes to a different table. None of them are what is under test, so
   * they are stubbed out wholesale.
   */
  const DEFAULT_SEEDERS: Array<string> = [
    "addDefaultIncidentSeverity",
    "addDefaultAlertSeverity",
    "addDefaultProjectTeams",
    "addDefaultMonitorStatus",
    "addDefaultIncidentState",
    "addDefaultScheduledMaintenanceState",
    "addDefaultAlertState",
    "addDefaultIncidentRoles",
    "addDefaultNetworkSiteTypes",
  ];

  function setup(data?: {
    // The plan the payment provider is told about. Growth monthly by default.
    plan?: SubscriptionPlan;
  }): CreateSpies {
    const createCustomer: jest.SpyInstance = jest
      .spyOn(BillingService, "createCustomer")
      .mockResolvedValue("cus_created_123" as never);

    jest
      .spyOn(SubscriptionPlan, "getSubscriptionPlanById")
      .mockReturnValue(data?.plan ?? GROWTH_PLAN);

    const subscribeToPlan: jest.SpyInstance = jest
      .spyOn(BillingService, "subscribeToPlan")
      .mockResolvedValue({
        subscriptionId: "sub_main_created",
        meteredSubscriptionId: "sub_metered_created",
        trialEndsAt: null,
      } as never);

    const updateOneById: jest.SpyInstance = jest
      .spyOn(ProjectService, "updateOneById")
      .mockResolvedValue(undefined as never);

    for (const seeder of DEFAULT_SEEDERS) {
      jest
        .spyOn(
          ProjectService as unknown as Record<string, () => unknown>,
          seeder,
        )
        .mockResolvedValue(undefined as never);
    }

    const capture: jest.SpyInstance = jest
      .spyOn(ProductAnalytics, "capture")
      .mockReturnValue(undefined);

    const emitInBackground: jest.SpyInstance = jest
      .spyOn(MarketingEventUtil, "emitInBackground")
      .mockReturnValue(undefined);

    return {
      createCustomer,
      subscribeToPlan,
      updateOneById,
      capture,
      emitInBackground,
    };
  }

  /*
   * onCreateSuccess is the hook the create path runs once the row exists; it
   * is protected, so it is reached the way the framework reaches it.
   */
  async function createProject(project: Project): Promise<void> {
    await (
      ProjectService as unknown as {
        onCreateSuccess: (
          onCreate: unknown,
          createdItem: Project,
        ) => Promise<Project>;
      }
    ).onCreateSuccess({}, project);
  }

  function getEmittedEvent(spies: CreateSpies): MarketingEvent {
    return resolveEmittedMarketingEvent(
      spies.emitInBackground.mock.calls[0]![0],
    );
  }

  function getEmittedData(spies: CreateSpies): JSONObject {
    return getEmittedEvent(spies).data;
  }

  describe("emitting the conversion", () => {
    it("should emit subscription_started when a project is created on a paid plan", async () => {
      const spies: CreateSpies = setup();

      await createProject(fakeProject());

      expect(spies.emitInBackground).toHaveBeenCalledTimes(1);
      expect(getEmittedEvent(spies).eventType).toBe("subscription_started");
    });

    it("should key the event on the project id alone, with no timestamp", async () => {
      /*
       * This is the assertion the whole event stands on. The queue retries
       * delivery, and the receiver dedupes on eventId - a project has exactly
       * one first subscription, so the id must be stable across attempts. Put
       * an instant in it, the way a plan change has to, and every retry lands
       * as another net-new conversion.
       */
      const spies: CreateSpies = setup();

      await createProject(fakeProject());

      expect(getEmittedEvent(spies).eventId).toBe(
        `subscription_started:${PROJECT_ID.toString()}`,
      );
    });

    it("should carry the owner's address as the identity", async () => {
      const spies: CreateSpies = setup();

      await createProject(fakeProject());

      expect(getEmittedEvent(spies).email).toBe(OWNER_EMAIL);
    });

    it("should date the conversion from the project's creation, not from the emit", async () => {
      /*
       * occurredAt is what the receiver orders on, and the conversion happened
       * when the project was created. Reading the clock here instead would
       * date every replayed or delayed emit to whenever the queue got round
       * to it.
       */
      const spies: CreateSpies = setup();

      await createProject(fakeProject());

      expect(getEmittedEvent(spies).occurredAt).toBe(CREATED_AT.toISOString());
    });

    it("should mark the conversion as paid", async () => {
      const spies: CreateSpies = setup();

      await createProject(fakeProject());

      expect(getEmittedData(spies)["is_paid_conversion"]).toBe(true);
    });

    it("should capture the same conversion in product analytics", async () => {
      const spies: CreateSpies = setup();

      await createProject(fakeProject());

      expect(spies.capture).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "server/subscription_started",
          distinctId: OWNER_EMAIL,
          properties: expect.objectContaining({
            new_plan: "Growth",
            is_paid_conversion: true,
          }),
        }),
      );
    });
  });

  /*
   * Net-new revenue and expansion revenue are different numbers, and once one
   * is reported as the other nothing downstream can separate them again. This
   * event exists precisely because a first subscription has no previous tier
   * to have moved from.
   */
  describe("distinctness from an upgrade", () => {
    it("should never emit a first subscription as subscription_upgraded", async () => {
      const spies: CreateSpies = setup();

      await createProject(fakeProject());

      const emittedTypes: Array<string> = spies.emitInBackground.mock.calls.map(
        (call: Array<unknown>) => {
          return resolveEmittedMarketingEvent(call[0]).eventType as string;
        },
      );

      expect(emittedTypes).toEqual(["subscription_started"]);
      expect(emittedTypes).not.toContain("subscription_upgraded");
      expect(emittedTypes).not.toContain("subscription_downgraded");
    });

    it("should not describe a first subscription as a movement between tiers", async () => {
      // There is no old plan, so nothing that implies one may be reported.
      const spies: CreateSpies = setup();

      await createProject(fakeProject());

      expect(getEmittedData(spies)).not.toHaveProperty("is_upgrade");
      expect(getEmittedData(spies)).not.toHaveProperty("old_plan");
      expect(getEmittedData(spies)).not.toHaveProperty(
        "old_monthly_amount_in_usd",
      );
    });
  });

  describe("what counts as revenue", () => {
    it("should stay silent for a project created on the free plan", async () => {
      /*
       * Every project is subscribed at the payment provider, free ones
       * included, so creation alone is not the signal - the paid check is the
       * only thing keeping this a revenue event rather than a signup event
       * under another name.
       */
      const spies: CreateSpies = setup({ plan: FREE_PLAN });

      await createProject(
        fakeProject({ paymentProviderPlanId: FREE_MONTHLY_PLAN_ID }),
      );

      expect(spies.emitInBackground).not.toHaveBeenCalled();
      expect(spies.capture).not.toHaveBeenCalledWith(
        expect.objectContaining({ event: "server/subscription_started" }),
      );
    });

    it("should stay silent when the project has no owner email", async () => {
      /*
       * The address is the identity the conversion joins on. Without one there
       * is nothing for a receiver to attach the revenue to.
       */
      const spies: CreateSpies = setup();

      await createProject(fakeProject({ createdOwnerEmail: null }));

      expect(spies.emitInBackground).not.toHaveBeenCalled();
      expect(spies.capture).not.toHaveBeenCalledWith(
        expect.objectContaining({ event: "server/subscription_started" }),
      );
    });

    it("should still emit for a custom-priced plan, which is paid without a published amount", async () => {
      const spies: CreateSpies = setup({ plan: ENTERPRISE_PLAN });

      await createProject(
        fakeProject({ paymentProviderPlanId: ENTERPRISE_MONTHLY_PLAN_ID }),
      );

      expect(spies.emitInBackground).toHaveBeenCalledTimes(1);
      expect(getEmittedData(spies)["is_paid_conversion"]).toBe(true);
      expect(getEmittedData(spies)["has_custom_pricing"]).toBe(true);
    });
  });

  describe("the amount reported", () => {
    it("should report the monthly amount and its currency for a monthly plan", async () => {
      const spies: CreateSpies = setup();

      await createProject(fakeProject());

      expect(getEmittedData(spies)["new_monthly_amount_in_usd"]).toBe(
        GROWTH_MONTHLY_AMOUNT,
      );

      // One seat at creation, so value is the monthly amount itself.
      expect(getEmittedData(spies)["value"]).toBe(GROWTH_MONTHLY_AMOUNT);
      expect(getEmittedData(spies)["currency"]).toBe("USD");
      expect(getEmittedData(spies)["seats"]).toBe(1);
    });

    it("should report the yearly plan's per-month amount, not the monthly one", async () => {
      /*
       * Yearly is discounted. Reporting the monthly sticker price for a
       * customer on yearly overstates the recurring revenue on every yearly
       * conversion, which is the bid signal these events feed.
       */
      const spies: CreateSpies = setup();

      await createProject(
        fakeProject({ paymentProviderPlanId: GROWTH_YEARLY_PLAN_ID }),
      );

      expect(getEmittedData(spies)["new_monthly_amount_in_usd"]).toBe(
        GROWTH_YEARLY_AMOUNT,
      );
      expect(getEmittedData(spies)["value"]).toBe(GROWTH_YEARLY_AMOUNT);
    });

    it("should omit the amount entirely for a custom-priced plan", async () => {
      /*
       * The -1 sentinel means "not published here", not "free". Sending it as
       * a value - or as a zero, or a null - would be a made-up number in a
       * revenue field, and a receiver has no way to tell it from a real one.
       * Absent is the only honest answer.
       */
      const spies: CreateSpies = setup({ plan: ENTERPRISE_PLAN });

      await createProject(
        fakeProject({ paymentProviderPlanId: ENTERPRISE_MONTHLY_PLAN_ID }),
      );

      expect(getEmittedData(spies)["value"]).toBeUndefined();
      expect(getEmittedData(spies)["currency"]).toBeUndefined();
      expect(
        getEmittedData(spies)["new_monthly_amount_in_usd"],
      ).toBeUndefined();

      expect(getEmittedData(spies)).not.toHaveProperty("value");
      expect(getEmittedData(spies)).not.toHaveProperty("currency");
      expect(getEmittedData(spies)).not.toHaveProperty(
        "new_monthly_amount_in_usd",
      );
    });
  });

  /*
   * The campaign that produced the project is the whole point of reporting the
   * conversion: without it the revenue cannot be attributed to the spend that
   * bought it. This event deliberately carries more of it than the plan-change
   * event does - term and content included.
   */
  describe("attribution", () => {
    it("should copy the campaign off the project row onto the event", async () => {
      const spies: CreateSpies = setup();

      await createProject(fakeProject());

      expect(getEmittedEvent(spies).attribution).toEqual(
        expect.objectContaining({
          utmSource: "google",
          utmMedium: "cpc",
          utmCampaign: "brand-uk",
          utmTerm: "status page",
          utmContent: "hero-cta",
          clickIds: { gclid: "gclid_abc123" },
        }),
      );
    });

    it("should carry the campaign in the event payload as well", async () => {
      const spies: CreateSpies = setup();

      await createProject(fakeProject());

      expect(getEmittedData(spies)).toEqual(
        expect.objectContaining({
          utm_source: "google",
          utm_medium: "cpc",
          utm_campaign: "brand-uk",
          utm_term: "status page",
          utm_content: "hero-cta",
          click_ids: { gclid: "gclid_abc123" },
        }),
      );
    });

    it("should still emit a conversion that carried no campaign at all", async () => {
      const spies: CreateSpies = setup();

      await createProject(
        fakeProject({
          utmSource: null,
          utmMedium: null,
          utmCampaign: null,
          utmTerm: null,
          utmContent: null,
          clickIds: null,
        }),
      );

      expect(spies.emitInBackground).toHaveBeenCalledTimes(1);
      expect(getEmittedData(spies)["utm_source"]).toBe("");
      expect(getEmittedData(spies)["click_ids"]).toEqual({});
    });
  });

  describe("ordering against the project row", () => {
    it("should report the conversion only after the subscription ids are written down", async () => {
      /*
       * The write is what makes the subscription real to OneUptime, and the
       * conversion describes a subscription that exists. Same ordering the
       * plan-change path uses.
       */
      const spies: CreateSpies = setup();

      await createProject(fakeProject());

      expect(spies.updateOneById).toHaveBeenCalled();
      expect(spies.emitInBackground).toHaveBeenCalled();

      const writeOrder: number =
        spies.updateOneById.mock.invocationCallOrder[0]!;
      const emitOrder: number =
        spies.emitInBackground.mock.invocationCallOrder[0]!;

      expect(emitOrder).toBeGreaterThan(writeOrder);
    });
  });
});
