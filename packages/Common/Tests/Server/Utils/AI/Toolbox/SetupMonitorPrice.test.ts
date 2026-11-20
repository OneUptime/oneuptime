jest.mock("../../../../../Server/EnvironmentConfig", () => {
  const flag: typeof import("../../../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../../../Enterprise/TestBillingFlag",
    ) as typeof import("../../../Enterprise/TestBillingFlag");

  return flag.withLiveBillingFlag(
    jest.requireActual("../../../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

import AIToolbox from "../../../../../Server/Utils/AI/Toolbox/Index";
import { describeMonitorPriceForPerson } from "../../../../../Server/Utils/AI/Toolbox/SetupPlan";
import { SetUpServiceMonitorTool } from "../../../../../Server/Utils/AI/Toolbox/SetupServiceMonitorTools";
import { SetUpWebsiteMonitoringTool } from "../../../../../Server/Utils/AI/Toolbox/SetupTools";
import {
  PlannedToolCall,
  PreparedMutation,
  SetupActionRefusal,
  ToolContext,
} from "../../../../../Server/Utils/AI/Toolbox/ToolTypes";
import AlertSeverityService from "../../../../../Server/Services/AlertSeverityService";
import IncidentSeverityService from "../../../../../Server/Services/IncidentSeverityService";
import MonitorProbeService from "../../../../../Server/Services/MonitorProbeService";
import MonitorService from "../../../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../../../Server/Services/MonitorStatusService";
import PayAsYouGoBillingService, {
  PAY_AS_YOU_GO_PAYMENT_REQUIRED_MESSAGE,
} from "../../../../../Server/Services/PayAsYouGoBillingService";
import ProbeService from "../../../../../Server/Services/ProbeService";
import ProjectMilestoneService from "../../../../../Server/Services/ProjectMilestoneService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import ServiceService from "../../../../../Server/Services/ServiceService";
import ActiveMonitorLimit from "../../../../../Server/Utils/Billing/ActiveMonitorLimit";
import AlertSeverity from "../../../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../../../Models/DatabaseModels/IncidentSeverity";
import MonitorStatus from "../../../../../Models/DatabaseModels/MonitorStatus";
import Project from "../../../../../Models/DatabaseModels/Project";
import ProjectMilestone from "../../../../../Models/DatabaseModels/ProjectMilestone";
import Service from "../../../../../Models/DatabaseModels/Service";
import {
  AI_ACTION_LINES,
  AIActionSentence,
  describeAIActionSentence,
  isKnownAIActionSentence,
} from "../../../../../Types/AI/AIActionWords";
import ActivationMilestone from "../../../../../Types/Analytics/ActivationMilestone";
import {
  ACTIVE_MONITOR_PRICE_IN_USD_PER_MONTH,
  formatPriceInUSD,
} from "../../../../../Types/Billing/PayAsYouGoPricing";
import { PlanType } from "../../../../../Types/Billing/SubscriptionPlan";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import PositiveNumber from "../../../../../Types/PositiveNumber";
import { createTranslator, Translator } from "../../../../../Types/Translator";
import { setTestBillingEnabled } from "../../../Enterprise/TestBillingFlag";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHAT A NEW MONITOR COSTS, ON ASK AI'S SETUP CARD (#9995).
 *
 * On OneUptime Cloud's Free plan every monitor that runs checks is billed
 * as it is used. The website guided setup said so, at its price, before it
 * started checking; Ask AI's card did not, so a plan of a website monitor
 * and a service's four recommended monitors added five to the bill unsaid.
 *
 * Now each monitor line of the card - a website's or an API's, a service's
 * recommended one - says what it costs a month there: the guided setup's
 * price (ACTIVE_MONITOR_PRICE_IN_USD_PER_MONTH), by the guided setup's rule
 * for when a price is quoted (isPayAsYouGoPriceQuoted: the Free plan of an
 * install that bills). A plan that includes monitors, and an install
 * without billing, are told nothing new.
 */

type Spy = jest.SpyInstance;

const PROJECT_ID: ObjectID = new ObjectID(
  "99950000-0000-4000-8000-000000000001",
);
const OPERATIONAL_ID: string = "99950000-0000-4000-8000-000000000002";
const OFFLINE_ID: string = "99950000-0000-4000-8000-000000000003";
const INCIDENT_SEVERITY_ID: string = "99950000-0000-4000-8000-000000000004";
const ALERT_SEVERITY_ID: string = "99950000-0000-4000-8000-000000000005";
const SERVICE_ID: string = "99950000-0000-4000-8000-000000000006";

const ctx: ToolContext = {
  projectId: PROJECT_ID,
  props: {
    userId: new ObjectID("99950000-0000-4000-8000-000000000007"),
    tenantId: PROJECT_ID,
  },
};

const PRICE: string = formatPriceInUSD(ACTIVE_MONITOR_PRICE_IN_USD_PER_MONTH);
const PRICE_LINE: string = `On the Free plan, this monitor is billed as you use it, at ${PRICE} a month.`;

function model<T>(type: { new (): T }, values: Record<string, unknown>): T {
  const record: T = new type();
  Object.assign(record as unknown as Record<string, unknown>, values);
  return record;
}

// The project's plan, as the server reads it for its limits.
function onPlan(plan: PlanType | null): Spy {
  return jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
    plan: plan,
    isSubscriptionUnpaid: false,
  } as never);
}

/*
 * A project the setup can build monitors in: its statuses and severities,
 * the locations a new monitor starts with, no monitor of the address yet,
 * the checkout service sending every kind of data, and pay as you go set
 * up with room for every monitor.
 */
function project(): void {
  jest
    .spyOn(MonitorStatusService, "findBy")
    .mockResolvedValue([
      model(MonitorStatus, { _id: OPERATIONAL_ID, isOperationalState: true }),
      model(MonitorStatus, { _id: OFFLINE_ID, isOfflineState: true }),
    ] as never);
  jest
    .spyOn(IncidentSeverityService, "findBy")
    .mockResolvedValue([
      model(IncidentSeverity, { _id: INCIDENT_SEVERITY_ID, name: "Critical" }),
    ] as never);
  jest.spyOn(IncidentSeverityService, "findOneById").mockResolvedValue(
    model(IncidentSeverity, {
      _id: INCIDENT_SEVERITY_ID,
      name: "Critical",
    }) as never,
  );
  jest
    .spyOn(AlertSeverityService, "findBy")
    .mockResolvedValue([
      model(AlertSeverity, { _id: ALERT_SEVERITY_ID }),
    ] as never);
  jest.spyOn(ProjectService, "findOneById").mockResolvedValue(
    model(Project, {
      _id: PROJECT_ID.toString(),
      name: "Acme",
      doNotAddGlobalProbesByDefaultOnNewMonitors: false,
    }) as never,
  );
  jest.spyOn(ProbeService, "countBy").mockImplementation((async (args: {
    query: { isGlobalProbe: boolean };
  }): Promise<PositiveNumber> => {
    return new PositiveNumber(args.query.isGlobalProbe ? 2 : 0);
  }) as never);
  jest
    .spyOn(MonitorProbeService, "countBy")
    .mockResolvedValue(new PositiveNumber(2) as never);
  jest.spyOn(MonitorService, "findBy").mockResolvedValue([] as never);
  jest.spyOn(ServiceService, "findOneBy").mockResolvedValue(
    model(Service, {
      _id: SERVICE_ID,
      name: "checkout",
      lastSeenAt: new Date(),
    }) as never,
  );
  jest.spyOn(ProjectMilestoneService, "findBy").mockResolvedValue(
    [
      ActivationMilestone.FirstTracesReceived,
      ActivationMilestone.FirstMetricsReceived,
      ActivationMilestone.FirstExceptionsReceived,
      ActivationMilestone.FirstLogsReceived,
    ].map((milestone: ActivationMilestone) => {
      return model(ProjectMilestone, { milestone: milestone });
    }) as never,
  );
  jest
    .spyOn(PayAsYouGoBillingService, "canUsePayAsYouGo")
    .mockResolvedValue(true as never);
  jest.spyOn(ActiveMonitorLimit, "getRefusal").mockResolvedValue(null as never);
}

// A card's line, as the English Dashboard reads it.
function linesOf(prepared: PreparedMutation): Array<string> {
  return (prepared.description || []).map(
    (sentence: AIActionSentence): string => {
      return describeAIActionSentence(sentence);
    },
  );
}

const WEBSITE: JSONObject = { address: "example.com" };

const SERVICE_MONITORS: Array<JSONObject> = [
  "errors",
  "slow_requests",
  "exceptions",
  "error_logs",
].map((monitor: string): JSONObject => {
  return { service: "checkout", monitor: monitor };
});

beforeEach(() => {
  setTestBillingEnabled(true);
});

afterEach(() => {
  jest.restoreAllMocks();
  setTestBillingEnabled(false);
});

describe("the price a monitor line says", () => {
  test("is the guided setup's, on OneUptime Cloud's Free plan", async () => {
    onPlan(PlanType.Free);

    const sentence: AIActionSentence | null =
      await describeMonitorPriceForPerson(ctx);

    expect(sentence?.template).toBe(AI_ACTION_LINES.monitorBilledOnFreePlan);
    expect(isKnownAIActionSentence(sentence!)).toBe(true);
    expect(describeAIActionSentence(sentence!)).toBe(PRICE_LINE);
    // The website guided setup's price, the one the invoice bills.
    expect(PRICE).toBe(`$${ACTIVE_MONITOR_PRICE_IN_USD_PER_MONTH}`);
  });

  test.each([PlanType.Growth, PlanType.Scale, PlanType.Enterprise])(
    "is nothing on the %s plan, which includes monitors",
    async (plan: PlanType) => {
      onPlan(plan);

      expect(await describeMonitorPriceForPerson(ctx)).toBeNull();
    },
  );

  test("is nothing on an install without billing, whose plan is never read", async () => {
    setTestBillingEnabled(false);
    const plan: Spy = onPlan(PlanType.Free);

    expect(await describeMonitorPriceForPerson(ctx)).toBeNull();
    expect(plan).not.toHaveBeenCalled();
  });

  test("is nothing when the plan is not known, or cannot be read: a price is never guessed", async () => {
    onPlan(null);
    expect(await describeMonitorPriceForPerson(ctx)).toBeNull();

    jest.restoreAllMocks();
    jest
      .spyOn(ProjectService, "getCurrentPlan")
      .mockRejectedValue(new Error("Database not connected") as never);
    expect(await describeMonitorPriceForPerson(ctx)).toBeNull();
  });

  test("is read for the project the card is for", async () => {
    const plan: Spy = onPlan(PlanType.Free);

    await describeMonitorPriceForPerson(ctx);

    expect(plan).toHaveBeenCalledWith(PROJECT_ID);
  });
});

describe("a website or API monitor's card", () => {
  test("on the Free plan, with pay as you go set up: says what the monitor costs a month, last", async () => {
    project();
    onPlan(PlanType.Free);

    const prepared: PreparedMutation =
      await SetUpWebsiteMonitoringTool.prepareMutation!(WEBSITE, ctx);
    const lines: Array<string> = linesOf(prepared);

    expect(lines[lines.length - 1]).toBe(PRICE_LINE);
    expect(lines.slice(0, -1).join(" ")).toBe(
      "A website monitor checks https://example.com every 5 minutes. It is checked from 2 locations. If it does not answer, or answers with an error, OneUptime opens an incident (Critical). A status change needs both connected probes to agree. You own this monitor, so you are emailed when its status changes.",
    );
    for (const sentence of prepared.description || []) {
      expect(isKnownAIActionSentence(sentence)).toBe(true);
    }

    // Nothing stops the card: it shows, with the price on it.
    expect(
      await SetUpWebsiteMonitoringTool.checkBeforeApproval!(
        prepared.arguments,
        {
          ...ctx,
          plannedCalls: [
            { name: "set_up_website_monitoring", arguments: WEBSITE },
          ],
        },
      ),
    ).toBeNull();
  });

  test.each([PlanType.Growth, PlanType.Scale, PlanType.Enterprise])(
    "on the %s plan: says nothing new",
    async (plan: PlanType) => {
      project();
      onPlan(plan);

      const lines: Array<string> = linesOf(
        await SetUpWebsiteMonitoringTool.prepareMutation!(WEBSITE, ctx),
      );

      expect(lines).not.toContain(PRICE_LINE);
      expect(lines.join(" ")).not.toContain(PRICE);
      expect(lines[lines.length - 1]).toBe(
        "You own this monitor, so you are emailed when its status changes.",
      );
    },
  );

  test("on an install without billing: says nothing new", async () => {
    setTestBillingEnabled(false);
    project();
    onPlan(PlanType.Free);

    const lines: Array<string> = linesOf(
      await SetUpWebsiteMonitoringTool.prepareMutation!(WEBSITE, ctx),
    );

    expect(lines).not.toContain(PRICE_LINE);
  });

  test("on the Free plan without pay as you go set up: no card at all, but what is needed", async () => {
    project();
    onPlan(PlanType.Free);
    jest
      .spyOn(PayAsYouGoBillingService, "canUsePayAsYouGo")
      .mockResolvedValue(false as never);

    const refused: SetupActionRefusal | null =
      await SetUpWebsiteMonitoringTool.checkBeforeApproval!(WEBSITE, {
        ...ctx,
        plannedCalls: [
          { name: "set_up_website_monitoring", arguments: WEBSITE },
        ],
      });

    expect(refused?.toldModel).toContain(
      PAY_AS_YOU_GO_PAYMENT_REQUIRED_MESSAGE,
    );
  });
});

describe("a service's recommended monitor's card", () => {
  test("on the Free plan, with pay as you go set up: says what the monitor costs a month, after what it opens", async () => {
    project();
    onPlan(PlanType.Free);

    const prepared: PreparedMutation =
      await SetUpServiceMonitorTool.prepareMutation!(SERVICE_MONITORS[0]!, ctx);

    expect(linesOf(prepared)).toEqual([
      "It reads the data checkout sends and opens an alert for your team: alerts never appear on a status page.",
      PRICE_LINE,
    ]);
  });

  test.each([PlanType.Growth, PlanType.Scale, PlanType.Enterprise])(
    "on the %s plan: says nothing new",
    async (plan: PlanType) => {
      project();
      onPlan(plan);

      expect(
        linesOf(
          await SetUpServiceMonitorTool.prepareMutation!(
            SERVICE_MONITORS[0]!,
            ctx,
          ),
        ),
      ).toEqual([
        "It reads the data checkout sends and opens an alert for your team: alerts never appear on a status page.",
      ]);
    },
  );

  test("on an install without billing: says nothing new", async () => {
    setTestBillingEnabled(false);
    project();

    expect(
      linesOf(
        await SetUpServiceMonitorTool.prepareMutation!(
          SERVICE_MONITORS[0]!,
          ctx,
        ),
      ),
    ).not.toContain(PRICE_LINE);
  });
});

describe("a plan of five monitors", () => {
  /*
   * The issue's plan: a website monitor and the checkout service's four
   * recommended monitors. Each is a line the person can skip, and each
   * line says what it adds: five monitors, five times the price, before
   * anything is approved.
   */
  test("says the price on each of its five monitor lines, on the Free plan with pay as you go set up", async () => {
    project();
    onPlan(PlanType.Free);

    const plannedCalls: Array<PlannedToolCall> = [
      { name: "set_up_website_monitoring", arguments: WEBSITE },
      ...SERVICE_MONITORS.map((args: JSONObject): PlannedToolCall => {
        return { name: "set_up_service_monitor", arguments: args };
      }),
    ];
    const planCtx: ToolContext = { ...ctx, plannedCalls: plannedCalls };

    const cards: Array<PreparedMutation> = [
      await SetUpWebsiteMonitoringTool.prepareMutation!(WEBSITE, planCtx),
      ...(await Promise.all(
        SERVICE_MONITORS.map((args: JSONObject): Promise<PreparedMutation> => {
          return SetUpServiceMonitorTool.prepareMutation!(args, planCtx);
        }),
      )),
    ];

    expect(
      cards.map((card: PreparedMutation): number => {
        return linesOf(card).filter((line: string): boolean => {
          return line === PRICE_LINE;
        }).length;
      }),
    ).toEqual([1, 1, 1, 1, 1]);

    // The plan has room for all five, so every card shows.
    for (const call of plannedCalls) {
      expect([
        call.name,
        await AIToolbox.getToolByName(call.name)!.checkBeforeApproval!(
          call.arguments,
          planCtx,
        ),
      ]).toEqual([call.name, null]);
    }
  });
});

describe("in every Dashboard language", () => {
  const LOCALES: string = path.resolve(
    __dirname,
    "../../../../../../App/FeatureSet/Dashboard/src/Locales",
  );

  function reader(language: string): Translator {
    const locale: Record<string, string> = JSON.parse(
      fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
    ) as Record<string, string>;

    return createTranslator((text: string): string | undefined => {
      return locale[text];
    }, language);
  }

  const languages: Array<string> = fs
    .readdirSync(LOCALES)
    .filter((file: string): boolean => {
      return file.endsWith(".json") && file !== "en.json";
    })
    .map((file: string): string => {
      return file.replace(/\.json$/, "");
    });

  test("the Dashboard has every language it is worded in", () => {
    expect(languages.length).toBeGreaterThanOrEqual(17);
  });

  test.each(languages)(
    "%s words the line itself, with the price as the guided setup writes it",
    async (language: string) => {
      onPlan(PlanType.Free);

      const sentence: AIActionSentence =
        (await describeMonitorPriceForPerson(ctx))!;
      const read: string = describeAIActionSentence(sentence, reader(language));

      expect([language, read === PRICE_LINE]).toEqual([language, false]);
      expect([language, read.includes(PRICE)]).toEqual([language, true]);
    },
  );
});
