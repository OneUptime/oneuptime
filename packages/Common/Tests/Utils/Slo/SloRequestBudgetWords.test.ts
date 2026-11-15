import { describe, expect, test } from "@jest/globals";
import SliType from "../../../Types/ServiceLevelObjective/SliType";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import SloWindowType from "../../../Types/ServiceLevelObjective/SloWindowType";
import FeedMarkdown from "../../../Utils/Markdown/FeedMarkdown";
import {
  DEFAULT_SLO_BURN_RATE_DESCRIPTION_TEMPLATE,
  DEFAULT_SLO_REQUEST_BURN_RATE_DESCRIPTION_TEMPLATE,
  SloBurnRateTemplateContext,
  SloBurnRateTemplateVariable,
  SloBurnRateTemplateVariables,
  buildSloBurnRateTemplateVariables,
  buildSloPolicyTierTemplateVariables,
  getSloBurnRateDescriptionTemplate,
  renderSloBurnRateTemplate,
} from "../../../Utils/Slo/SloBurnRateTemplate";
import {
  SLO_FEED_UPDATE_COLUMNS,
  SloFeedColumn,
  SloFeedColumnChange,
  SloFeedMarkdown,
  SloFeedMarkdownParts,
  SloFeedValueKind,
  getSloDeploymentGateChangedFeedParts,
  getSloFeedBudgetRemainingDetail,
  getSloFeedColumnChanges,
  getSloPolicyTierChangedFeedParts,
  getSloStatusChangedFeedMarkdown,
} from "../../../Utils/Slo/SloFeedMarkdown";

/*
 * A request SLO's budget is counted in requests, and every place that says
 * how much budget is left - the feed, the chat posts of the error budget
 * policy, alert and incident templates - says it in requests: "1,234 failed
 * requests", "12 slow requests", "over budget by 50 failed requests". Never
 * a duration, and never the "( minutes)" an empty minutes value would leave.
 * A Monitor Uptime SLO's words are pinned as they always were.
 */

const LINK: ReturnType<typeof FeedMarkdown.asMarkdown> =
  FeedMarkdown.asMarkdown("[SLO Checkout](https://oneuptime.com/slo)");

function contextOf(
  overrides: Partial<SloBurnRateTemplateContext> = {},
): SloBurnRateTemplateContext {
  return {
    sloId: "slo-1",
    sloName: "Checkout",
    sloLink: "https://oneuptime.com/slo",
    sloStatus: SloStatus.AtRisk,
    ruleName: "Fast burn",
    burnRateThreshold: 14.4,
    longWindowBurnRate: 20,
    shortWindowBurnRate: 30,
    longWindowInMinutes: 60,
    shortWindowInMinutes: 5,
    targetPercentage: 99.9,
    currentSliPercentage: 99.95,
    errorBudgetRemainingPercentage: 42.5,
    errorBudgetRemainingSeconds: 1102,
    windowType: SloWindowType.Rolling,
    windowDays: 30,
    timezone: undefined,
    ...overrides,
  };
}

describe("getSloFeedBudgetRemainingDetail", () => {
  test("a time-based SLO says a duration, as before", () => {
    expect(
      getSloFeedBudgetRemainingDetail({
        errorBudgetRemainingPercentage: 42.5,
        errorBudgetRemainingSeconds: 1500,
      }).toString(),
    ).toBe("**Error budget remaining**: 42.5% (25 minutes)");

    expect(
      getSloFeedBudgetRemainingDetail({
        errorBudgetRemainingPercentage: -10,
        errorBudgetRemainingSeconds: -300,
      }).toString(),
    ).toBe("**Error budget remaining**: -10% (over budget by 5 minutes)");
  });

  test("a request SLO says its failed or slow requests", () => {
    expect(
      getSloFeedBudgetRemainingDetail({
        errorBudgetRemainingPercentage: 42.5,
        errorBudgetRemainingSeconds: 0,
        requestBudget: {
          sliType: SliType.RequestSuccess,
          remainingEvents: 1234.4,
        },
      }).toString(),
    ).toBe("**Error budget remaining**: 42.5% (1,234 failed requests)");

    expect(
      getSloFeedBudgetRemainingDetail({
        errorBudgetRemainingPercentage: -5,
        errorBudgetRemainingSeconds: 0,
        requestBudget: {
          sliType: SliType.RequestLatency,
          remainingEvents: -50,
        },
      }).toString(),
    ).toBe("**Error budget remaining**: -5% (over budget by 50 slow requests)");
  });
});

describe("feed items of a request SLO", () => {
  test("a status change says the budget in requests", () => {
    const markdown: SloFeedMarkdown = getSloStatusChangedFeedMarkdown({
      sloMarkdownLink: LINK,
      previousStatus: SloStatus.Healthy,
      newStatus: SloStatus.AtRisk,
      measurement: {
        sliPercentage: 99.91,
        targetPercentage: 99.9,
        errorBudgetRemainingPercentage: 10,
        errorBudgetRemainingSeconds: 0,
        requestBudget: {
          sliType: SliType.RequestSuccess,
          remainingEvents: 12,
        },
        currentBurnRate: 2,
        currentBurnRateWindowInMinutes: 60,
        atRiskThresholdPercentage: 20,
      },
    });

    expect(markdown.moreInformationInMarkdown).toContain(
      "**Error budget remaining**: 10% (12 failed requests)",
    );
    expect(markdown.moreInformationInMarkdown).not.toContain("second");
  });

  test("a tier change and a deploy gate flip say it in requests too", () => {
    const tierChange: SloFeedMarkdownParts = getSloPolicyTierChangedFeedParts({
      sloMarkdownLink: LINK,
      previousTierName: null,
      newTier: { name: "Caution", thresholdPercentage: 50, whatWeDo: "Look." },
      isEscalation: true,
      errorBudgetRemainingPercentage: 40,
      errorBudgetRemainingSeconds: 0,
      requestBudget: { sliType: SliType.RequestLatency, remainingEvents: 40 },
    });

    expect(
      tierChange.details.map((detail: { toString: () => string }) => {
        return detail.toString();
      }),
    ).toContain("**Error budget remaining**: 40% (40 slow requests)");

    const gateChange: SloFeedMarkdownParts =
      getSloDeploymentGateChangedFeedParts({
        sloMarkdownLink: LINK,
        tierName: "Budget exhausted",
        isAllowed: false,
        errorBudgetRemainingPercentage: -1,
        errorBudgetRemainingSeconds: 0,
        requestBudget: {
          sliType: SliType.RequestSuccess,
          remainingEvents: -3,
        },
      });

    expect(
      gateChange.details.map((detail: { toString: () => string }) => {
        return detail.toString();
      }),
    ).toContain(
      "**Error budget remaining**: -1% (over budget by 3 failed requests)",
    );
  });
});

describe("what the feed records of a change to what an SLO measures", () => {
  function columnOf(name: string): SloFeedColumn {
    const column: SloFeedColumn | undefined = SLO_FEED_UPDATE_COLUMNS.find(
      (candidate: SloFeedColumn): boolean => {
        return candidate.column === name;
      },
    );

    expect(column).toBeDefined();
    return column!;
  }

  test("the SLI type, the services and the latency threshold are watched", () => {
    expect(columnOf("sliType").kind).toBe(SloFeedValueKind.Text);
    expect(columnOf("services").kind).toBe(SloFeedValueKind.EntityList);
    expect(columnOf("latencyThresholdInMilliseconds").kind).toBe(
      SloFeedValueKind.Milliseconds,
    );
  });

  test("a latency threshold reads in milliseconds", () => {
    const changes: Array<SloFeedColumnChange> = getSloFeedColumnChanges({
      columns: [columnOf("latencyThresholdInMilliseconds")],
      before: { latencyThresholdInMilliseconds: 300 },
      after: { latencyThresholdInMilliseconds: 450 },
    });

    expect(changes).toHaveLength(1);
    expect(changes[0]!.from?.toString()).toBe("300 ms");
    expect(changes[0]!.to.toString()).toBe("450 ms");
  });

  test("the services read by their names", () => {
    const changes: Array<SloFeedColumnChange> = getSloFeedColumnChanges({
      columns: [columnOf("services")],
      before: { services: [{ _id: "a", name: "checkout" }] },
      after: {
        services: [
          { _id: "a", name: "checkout" },
          { _id: "b", name: "payments" },
        ],
      },
    });

    expect(changes).toHaveLength(1);
    expect(changes[0]!.to.toString()).toContain("payments");
  });

  test("the worker's request counts are not watched: they would post every tick", () => {
    const watched: Array<string> = SLO_FEED_UPDATE_COLUMNS.map(
      (column: SloFeedColumn): string => {
        return column.column;
      },
    );

    for (const workerColumn of [
      "goodEventCount",
      "totalEventCount",
      "errorBudgetTotalEvents",
      "errorBudgetRemainingEvents",
      "firstAccumulatedBucketStartAt",
      "lastAccumulatedBucketEndAt",
      "eventAccumulationFingerprint",
    ]) {
      expect(watched).not.toContain(workerColumn);
    }
  });
});

describe("alert and incident templates of a request SLO", () => {
  test("{{errorBudgetRemaining}} is the bad requests left, signed once overspent", () => {
    const variables: SloBurnRateTemplateVariables =
      buildSloBurnRateTemplateVariables(
        contextOf({
          requestBudget: {
            sliType: SliType.RequestSuccess,
            remainingEvents: 1234,
          },
        }),
      );

    expect(variables[SloBurnRateTemplateVariable.ErrorBudgetRemaining]).toBe(
      "1,234 failed requests",
    );
    expect(
      variables[SloBurnRateTemplateVariable.ErrorBudgetRemainingMinutes],
    ).toBe("");

    const overspent: SloBurnRateTemplateVariables =
      buildSloBurnRateTemplateVariables(
        contextOf({
          requestBudget: {
            sliType: SliType.RequestLatency,
            remainingEvents: -12,
          },
        }),
      );

    expect(overspent[SloBurnRateTemplateVariable.ErrorBudgetRemaining]).toBe(
      "-12 slow requests",
    );

    // Less than half a request over is no overspend the count shows.
    const barely: SloBurnRateTemplateVariables =
      buildSloBurnRateTemplateVariables(
        contextOf({
          requestBudget: {
            sliType: SliType.RequestLatency,
            remainingEvents: -0.4,
          },
        }),
      );

    expect(barely[SloBurnRateTemplateVariable.ErrorBudgetRemaining]).toBe(
      "0 slow requests",
    );
  });

  test("a time-based SLO keeps its duration and minutes", () => {
    const variables: SloBurnRateTemplateVariables =
      buildSloBurnRateTemplateVariables(contextOf());

    expect(variables[SloBurnRateTemplateVariable.ErrorBudgetRemaining]).toBe(
      "18m 22s",
    );
    expect(
      variables[SloBurnRateTemplateVariable.ErrorBudgetRemainingMinutes],
    ).toBe("18.37");
  });

  test("a policy tier's templates say it in requests too", () => {
    const variables: SloBurnRateTemplateVariables =
      buildSloPolicyTierTemplateVariables({
        ...contextOf(),
        requestBudget: { sliType: SliType.RequestSuccess, remainingEvents: 7 },
        policyTier: { name: "Caution", thresholdPercentage: 50, whatWeDo: "" },
      });

    expect(variables[SloBurnRateTemplateVariable.ErrorBudgetRemaining]).toBe(
      "7 failed requests",
    );
  });

  test("the request SLO's built-in description names the budget in requests", () => {
    const description: string | null = renderSloBurnRateTemplate(
      DEFAULT_SLO_REQUEST_BURN_RATE_DESCRIPTION_TEMPLATE,
      buildSloBurnRateTemplateVariables(
        contextOf({
          requestBudget: {
            sliType: SliType.RequestSuccess,
            remainingEvents: 40,
          },
        }),
      ),
    );

    expect(description).toContain(
      "Error budget remaining: 42.5% (40 failed requests).",
    );
    expect(description).not.toContain("minutes)");
  });

  test("the time-based built-in description is what it always was", () => {
    expect(DEFAULT_SLO_BURN_RATE_DESCRIPTION_TEMPLATE).toContain(
      "({{errorBudgetRemainingMinutes}} minutes)",
    );
    expect(DEFAULT_SLO_REQUEST_BURN_RATE_DESCRIPTION_TEMPLATE).toBe(
      DEFAULT_SLO_BURN_RATE_DESCRIPTION_TEMPLATE.replace(
        "{{errorBudgetRemainingMinutes}} minutes",
        "{{errorBudgetRemaining}}",
      ),
    );
  });

  test("a rule that kept the built-in text follows the request SLO's own; a rule's own text is its own", () => {
    expect(
      getSloBurnRateDescriptionTemplate({
        template: DEFAULT_SLO_BURN_RATE_DESCRIPTION_TEMPLATE,
        isRequestSli: true,
      }),
    ).toBe(DEFAULT_SLO_REQUEST_BURN_RATE_DESCRIPTION_TEMPLATE);

    expect(
      getSloBurnRateDescriptionTemplate({
        template: `  ${DEFAULT_SLO_BURN_RATE_DESCRIPTION_TEMPLATE}\n`,
        isRequestSli: true,
      }),
    ).toBe(DEFAULT_SLO_REQUEST_BURN_RATE_DESCRIPTION_TEMPLATE);

    expect(
      getSloBurnRateDescriptionTemplate({
        template: DEFAULT_SLO_BURN_RATE_DESCRIPTION_TEMPLATE,
        isRequestSli: false,
      }),
    ).toBe(DEFAULT_SLO_BURN_RATE_DESCRIPTION_TEMPLATE);

    expect(
      getSloBurnRateDescriptionTemplate({
        template: "Ours: {{errorBudgetRemainingMinutes}}",
        isRequestSli: true,
      }),
    ).toBe("Ours: {{errorBudgetRemainingMinutes}}");

    expect(
      getSloBurnRateDescriptionTemplate({ template: "", isRequestSli: true }),
    ).toBeUndefined();
    expect(
      getSloBurnRateDescriptionTemplate({
        template: undefined,
        isRequestSli: false,
      }),
    ).toBeUndefined();
  });
});
