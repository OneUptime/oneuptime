import StripeBillingProvider, {
  METERED_BILLING_START_METADATA_KEY,
} from "../../../Server/Billing/StripeBillingProvider";
import BillingService from "Common/Server/Services/BillingService";
import type BillingProvider from "Common/Server/Types/Billing/BillingProvider";
import {
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import PayAsYouGoBillingService from "Common/Server/Services/PayAsYouGoBillingService";
import MonitorService from "Common/Server/Services/MonitorService";
import MonitorStatusService from "Common/Server/Services/MonitorStatusService";
import ProjectService from "Common/Server/Services/ProjectService";
import TelemetryUsageBillingService from "Common/Server/Services/TelemetryUsageBillingService";
import LogService from "Common/Server/Services/LogService";
import MetricService from "Common/Server/Services/MetricService";
import SpanService from "Common/Server/Services/SpanService";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import ProfileService from "Common/Server/Services/ProfileService";
import ProfileSampleService from "Common/Server/Services/ProfileSampleService";
import RumSessionService from "Common/Server/Services/RumSessionService";
import SecurityEventService from "Common/Server/Services/SecurityEventService";
import AllMeteredPlans, {
  ActiveMonitoringMeteredPlan,
  LogDataIngestMeteredPlan,
  MetricsDataIngestMeteredPlan,
  ProfilesDataIngestMeteredPlan,
  SecurityEventsDataIngestMeteredPlan,
  SessionReplayDataIngestMeteredPlan,
  TracesDataIngestMetredPlan,
} from "Common/Server/Types/Billing/MeteredPlan/AllMeteredPlans";
import ServerMeteredPlan from "Common/Server/Types/Billing/MeteredPlan/ServerMeteredPlan";
import CreateBy from "Common/Server/Types/Database/CreateBy";
import MonitorStepsProjectValidator from "Common/Server/Utils/Monitor/MonitorStepsProjectValidator";
import ActiveMonitorLimit from "Common/Server/Utils/Billing/ActiveMonitorLimit";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import Project from "Common/Models/DatabaseModels/Project";
import TelemetryUsageBilling from "Common/Models/DatabaseModels/TelemetryUsageBilling";
import SubscriptionPlan, {
  PlanType,
} from "Common/Types/Billing/SubscriptionPlan";
import Decimal from "Common/Types/Decimal";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import * as EnvironmentConfig from "Common/Server/EnvironmentConfig";
import { getJestSpyOn } from "Common/Tests/Spy";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import Stripe from "stripe";

jest.mock("Common/Server/EnvironmentConfig", () => {
  return {
    __esModule: true,
    ...(jest.requireActual(
      "Common/Server/EnvironmentConfig",
    ) as typeof EnvironmentConfig),
    IsBillingEnabled: true,
  };
});

/*
 * Stripe rate-limits GET /v1/subscriptions/:id per endpoint, on top of the
 * account-wide limit. When the pay-as-you-go check read the project's
 * subscription before its card, a non-manual monitor create went from one
 * subscription read to four - and the SaaS E2E job, whose Stripe test account
 * every other environment running this code shares, failed on 429
 * endpoint-rate for exactly that endpoint.
 *
 * These tests are the budget. They drive the real billing services against a
 * recording Stripe client and count what reaches it. A number going up here
 * is a regression in how often production calls Stripe, not a detail to
 * update.
 */

const CUSTOMER_ID: string = "cus_budget";
const SUBSCRIPTION_ID: string = "sub_flat_fee";
const METERED_SUBSCRIPTION_ID: string = "sub_metered";

const GROWTH_PLAN: SubscriptionPlan = new SubscriptionPlan(
  "growth",
  "growth_yearly",
  PlanType.Growth,
  20,
  200,
  1,
  14,
);

type MonitorHooks = {
  onBeforeCreate: (input: CreateBy<Monitor>) => Promise<unknown>;
};

interface RecordingStripe {
  calls: Array<string>;
  retrieveSubscription: jest.Mock;
  createUsageRecord: jest.Mock;
}

/*
 * Installed on the Stripe billing provider core's BillingService hands every
 * call to (the enterprise module's, as on OneUptime Cloud), so every Stripe
 * request any billing service makes is recorded here in order.
 */
function installRecordingStripe(
  provider: StripeBillingProvider,
): RecordingStripe {
  const calls: Array<string> = [];

  const recorded: (
    name: string,
    answer: (...args: Array<any>) => unknown,
  ) => jest.Mock = (
    name: string,
    answer: (...args: Array<any>) => unknown,
  ): jest.Mock => {
    return jest.fn(async (...args: Array<any>): Promise<unknown> => {
      calls.push(name);
      return answer(...args);
    });
  };

  // One item per metered product, so every usage write finds its price.
  const meteredItems: Array<{ id: string; price: { id: string } }> =
    AllMeteredPlans.map(
      (plan: ServerMeteredPlan): { id: string; price: { id: string } } => {
        return {
          id: `si_${plan.getProductType()}`,
          price: { id: plan.getPriceId() },
        };
      },
    );

  const retrieveSubscription: jest.Mock = recorded(
    "subscriptions.retrieve",
    (subscriptionId: string): Partial<Stripe.Subscription> => {
      return {
        id: subscriptionId,
        customer: CUSTOMER_ID,
        status: "active",
        collection_method: "charge_automatically",
        items: {
          data: subscriptionId === METERED_SUBSCRIPTION_ID ? meteredItems : [],
        } as unknown as Stripe.ApiList<Stripe.SubscriptionItem>,
      };
    },
  );

  const createUsageRecord: jest.Mock = recorded(
    "subscriptionItems.createUsageRecord",
    (): Record<string, unknown> => {
      return {};
    },
  );

  (provider as unknown as { stripe: unknown }).stripe = {
    paymentMethods: {
      list: recorded(
        "paymentMethods.list",
        (
          params: Stripe.PaymentMethodListParams,
        ): { data: Array<Partial<Stripe.PaymentMethod>> } => {
          return { data: params.type === "card" ? [{ id: "pm_card" }] : [] };
        },
      ),
    },
    subscriptions: { retrieve: retrieveSubscription },
    subscriptionItems: {
      create: recorded(
        "subscriptionItems.create",
        (): Partial<Stripe.SubscriptionItem> => {
          return { id: "si_new" };
        },
      ),
      createUsageRecord: createUsageRecord,
    },
    customers: {
      retrieve: recorded("customers.retrieve", (): Partial<Stripe.Customer> => {
        return {
          id: CUSTOMER_ID,
          metadata: {
            [METERED_BILLING_START_METADATA_KEY]: "2020-01-01T00:00:00.000Z",
          },
        };
      }),
      update: recorded("customers.update", (): Record<string, unknown> => {
        return {};
      }),
    },
  };

  return { calls, retrieveSubscription, createUsageRecord };
}

function subscriptionReadsOf(
  stripe: RecordingStripe,
  subscriptionId: string,
): number {
  return stripe.retrieveSubscription.mock.calls.filter(
    (call: Array<unknown>): boolean => {
      return call[0] === subscriptionId;
    },
  ).length;
}

function callsTo(stripe: RecordingStripe, name: string): number {
  return stripe.calls.filter((call: string): boolean => {
    return call === name;
  }).length;
}

describe("Stripe rate-limit budget for pay-as-you-go billing", () => {
  let projectId: ObjectID;
  let stripe: RecordingStripe;

  beforeEach(() => {
    jest.restoreAllMocks();

    /*
     * The billing services are process-wide singletons with their own caches.
     * A project nobody has asked about yet starts every one of them cold.
     */
    projectId = ObjectID.generate();

    const owner: Project = new Project();
    owner.id = projectId;

    getJestSpyOn(ProjectService, "findOneById").mockResolvedValue(
      Object.assign(new Project(), {
        paymentProviderPlanId: "growth",
        paymentProviderCustomerId: CUSTOMER_ID,
        paymentProviderSubscriptionId: SUBSCRIPTION_ID,
        paymentProviderMeteredSubscriptionId: METERED_SUBSCRIPTION_ID,
      }),
    );
    getJestSpyOn(ProjectService, "findOneBy").mockResolvedValue(owner);
    getJestSpyOn(ProjectService, "updateOneById").mockResolvedValue(1);
    getJestSpyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
      plan: PlanType.Growth,
      isSubscriptionUnpaid: false,
    });
    getJestSpyOn(SubscriptionPlan, "getSubscriptionPlanById").mockReturnValue(
      GROWTH_PLAN,
    );
    getJestSpyOn(BillingService, "isBillingEnabled").mockReturnValue(true);
    /*
     * The project's one active monitor, counted and written on the project
     * under the active monitor limit's lock (ActiveMonitorLimit, which reads
     * Postgres): what the usage write reports.
     */
    getJestSpyOn(ActiveMonitorLimit, "refreshCount").mockResolvedValue(1);

    const provider: StripeBillingProvider = new StripeBillingProvider();
    installFakeEnterpriseModule({
      billingProvider: provider as BillingProvider,
    });
    stripe = installRecordingStripe(provider);
  });

  afterEach(() => {
    uninstallEnterpriseModule();
    jest.restoreAllMocks();
  });

  it("answers a paid plan's pay-as-you-go allow check without payment-provider reads", async () => {
    await expect(
      PayAsYouGoBillingService.canUsePayAsYouGo(projectId),
    ).resolves.toBe(true);
    await expect(
      PayAsYouGoBillingService.canUsePayAsYouGo(projectId, {
        useCache: false,
      }),
    ).resolves.toBe(true);

    expect(stripe.retrieveSubscription).not.toHaveBeenCalled();
    expect(stripe.calls).toEqual([]);
  });

  it("creates a non-manual monitor on a card-holding Growth project with at most one subscription read", async () => {
    getJestSpyOn(
      MonitorStepsProjectValidator,
      "validateMonitorStepsBelongToProject",
    ).mockResolvedValue(undefined);
    getJestSpyOn(
      MonitorService,
      "validateDependencyConfiguration",
    ).mockResolvedValue(undefined);
    const operational: MonitorStatus = new MonitorStatus();
    operational.id = ObjectID.generate();
    getJestSpyOn(MonitorStatusService, "findOneBy").mockResolvedValue(
      operational,
    );

    const monitor: Monitor = new Monitor();
    monitor.monitorType = MonitorType.Website;
    await (MonitorService as unknown as MonitorHooks).onBeforeCreate({
      data: monitor,
      props: { isRoot: true, tenantId: projectId },
    });

    // The billing step of MonitorService.onCreateSuccess.
    await ActiveMonitoringMeteredPlan.reportQuantityToBillingProvider(
      projectId,
    );

    expect(callsTo(stripe, "subscriptions.retrieve")).toBeLessThanOrEqual(1);

    /*
     * The one read left is the metered subscription's items, which the usage
     * write cannot do without - the same read 13.0.0 made.
     */
    expect(stripe.retrieveSubscription.mock.calls).toEqual([
      [METERED_SUBSCRIPTION_ID],
    ]);
    expect(stripe.createUsageRecord).toHaveBeenCalledWith(
      `si_${ProductType.ActiveMonitoring}`,
      { quantity: 1 },
    );
    expect(stripe.calls).toEqual([
      "subscriptions.retrieve", // the metered subscription's items
      "subscriptionItems.createUsageRecord",
    ]);
  });

  it("reads the flat-fee subscription once in a whole metered billing pass over one project", async () => {
    /*
     * The catch-up window has nothing staged yet and every product has
     * telemetry yesterday only, so each plan stages that one day, as a
     * regular daily pass does.
     */
    const now: Date = new Date();
    const yesterday: string = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1),
    )
      .toISOString()
      .slice(0, 10);
    getJestSpyOn(TelemetryUsageBillingService, "findBy").mockResolvedValue([]);

    for (const service of [
      LogService,
      MetricService,
      SpanService,
      ExceptionInstanceService,
      ProfileService,
      ProfileSampleService,
      SecurityEventService,
    ]) {
      getJestSpyOn(service, "groupTelemetryUsageByService").mockResolvedValue(
        [],
      );
      getJestSpyOn(service, "getDaysWithRows").mockResolvedValue([yesterday]);
    }
    getJestSpyOn(
      RumSessionService,
      "groupSessionReplayUsageByEntity",
    ).mockResolvedValue([]);
    getJestSpyOn(RumSessionService, "getDaysWithRows").mockResolvedValue([
      yesterday,
    ]);
    getJestSpyOn(
      TelemetryUsageBillingService,
      "waiveUnreportedUsageBilling",
    ).mockResolvedValue(undefined);
    getJestSpyOn(
      TelemetryUsageBillingService,
      "getUnreportedUsageBilling",
    ).mockResolvedValue([
      Object.assign(new TelemetryUsageBilling(), {
        id: ObjectID.generate(),
        totalCostInUSD: new Decimal(1.25),
      }),
    ]);
    getJestSpyOn(
      TelemetryUsageBillingService,
      "updateOneById",
    ).mockResolvedValue(1);

    // The order ReportTelemetryMeteredPlan walks a project's plans in.
    const billingPass: Array<ServerMeteredPlan> = [
      LogDataIngestMeteredPlan,
      MetricsDataIngestMeteredPlan,
      TracesDataIngestMetredPlan,
      ActiveMonitoringMeteredPlan,
      ProfilesDataIngestMeteredPlan,
      SessionReplayDataIngestMeteredPlan,
      SecurityEventsDataIngestMeteredPlan,
    ];

    for (const plan of billingPass) {
      await plan.reportQuantityToBillingProvider(projectId, {});
    }

    // Only the telemetry cutoff asks about an invoice agreement, and only once.
    expect(subscriptionReadsOf(stripe, SUBSCRIPTION_ID)).toBe(1);

    // Paid plans authorize usage without reading payment methods.
    expect(callsTo(stripe, "paymentMethods.list")).toBe(0);

    // Every usage write still reads the metered items it writes against.
    expect(subscriptionReadsOf(stripe, METERED_SUBSCRIPTION_ID)).toBe(
      billingPass.length,
    );
    expect(stripe.createUsageRecord).toHaveBeenCalledTimes(billingPass.length);
  });
});
