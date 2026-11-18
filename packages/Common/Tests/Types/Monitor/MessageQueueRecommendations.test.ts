import { describe, expect, test } from "@jest/globals";
import {
  MessageQueueAlertTemplate,
  getAllMessageQueueAlertTemplates,
  getMessageQueueAlertTemplatesFor,
} from "../../../Types/Monitor/MessageQueueAlertTemplates";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import MonitorRecommendationCatalog from "../../../Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import MonitorRecommendationUtil from "../../../Types/Monitor/Recommendation/MonitorRecommendationUtil";
import {
  MonitorRecommendation,
  MonitorRecommendationArgs,
  MonitorRecommendationResourceType,
} from "../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import { parseMessageQueueIdentifier } from "../../../Types/MessageQueue/MessageQueueIdentity";
import ObjectID from "../../../Types/ObjectID";
import {
  METRIC_FIXTURES,
  MetricFixture,
} from "../MessageQueue/MessagingTelemetryFixtures";

/*
 * A QUEUE'S RECOMMENDATIONS (#9307): the broker-health templates
 * (MessageQueueAlertTemplates) offered for ONE queue - only those whose
 * metric its broker reported with a series that resolves to it, each a
 * monitor over exactly those series.
 */

const ALL: Array<MessageQueueAlertTemplate> =
  getAllMessageQueueAlertTemplates();

function fixtureFor(template: MessageQueueAlertTemplate): MetricFixture {
  const fixture: MetricFixture | undefined = METRIC_FIXTURES.find(
    (candidate: MetricFixture): boolean => {
      return (
        candidate.metricName === template.metricName &&
        candidate.expected?.system === template.system
      );
    },
  );

  if (!fixture) {
    throw new Error(`No stored datapoint fixture for ${template.id}`);
  }

  return fixture;
}

const ARGS: MonitorRecommendationArgs = {
  resourceIdentifier: "0d000000-0000-4000-8000-000000000001",
  onlineMonitorStatusId: ObjectID.getZeroObjectID(),
  offlineMonitorStatusId: ObjectID.getZeroObjectID(),
  defaultIncidentSeverityId: ObjectID.getZeroObjectID(),
  defaultAlertSeverityId: ObjectID.getZeroObjectID(),
  monitorName: "orders",
};

describe("the templates there are", () => {
  test("are listed, in catalog order, each with a unique id", () => {
    expect(ALL.length).toBeGreaterThan(0);
    expect(
      new Set(
        ALL.map((template: MessageQueueAlertTemplate): string => {
          return template.id;
        }),
      ).size,
    ).toBe(ALL.length);
  });

  test("the list is a copy, never the catalog's own array", () => {
    getAllMessageQueueAlertTemplates().pop();

    expect(getAllMessageQueueAlertTemplates().length).toBe(ALL.length);
  });
});

describe("which templates one queue is offered", () => {
  const template: MessageQueueAlertTemplate = ALL[0]!;
  const reported: Record<string, Array<Record<string, unknown>>> = {
    [template.metricId]: [{ ...fixtureFor(template).attributes }],
  };

  test("a template whose metric the broker reported for the queue", () => {
    expect(
      getMessageQueueAlertTemplatesFor({
        observedSeriesByMetric: reported,
      }).map((candidate: MessageQueueAlertTemplate): string => {
        return candidate.id;
      }),
    ).toEqual([template.id]);
  });

  test("nothing when no metric was reported", () => {
    expect(getMessageQueueAlertTemplatesFor({})).toEqual([]);
    expect(
      getMessageQueueAlertTemplatesFor({ observedSeriesByMetric: null }),
    ).toEqual([]);
    expect(
      getMessageQueueAlertTemplatesFor({
        observedSeriesByMetric: { [template.metricId]: [] },
      }),
    ).toEqual([]);
  });

  test("nothing for a series that resolves to no queue", () => {
    expect(
      getMessageQueueAlertTemplatesFor({
        observedSeriesByMetric: { [template.metricId]: [{ unrelated: "x" }] },
      }),
    ).toEqual([]);
  });

  test("nothing for another queue's series", () => {
    const other: ReturnType<typeof parseMessageQueueIdentifier> =
      parseMessageQueueIdentifier(
        `${template.system}:somewhere-else-entirely:not-this-queue`,
      );

    if (!other) {
      // A system whose identifier takes another shape: the resolver test covers it.
      return;
    }

    expect(
      getMessageQueueAlertTemplatesFor({
        observedSeriesByMetric: reported,
        identity: other,
      }),
    ).toEqual([]);
  });

  test("every template is offered once its own metric is reported", () => {
    for (const candidate of ALL) {
      expect(
        getMessageQueueAlertTemplatesFor({
          observedSeriesByMetric: {
            [candidate.metricId]: [{ ...fixtureFor(candidate).attributes }],
          },
        }).map((offered: MessageQueueAlertTemplate): string => {
          return offered.id;
        }),
      ).toEqual([candidate.id]);
    }
  });
});

describe("in the recommendation catalog", () => {
  function recommendationsFor(
    observed: Record<string, Array<Record<string, unknown>>> | undefined,
  ): Array<MonitorRecommendation> {
    return MonitorRecommendationCatalog.getRecommendations(
      MonitorRecommendationResourceType.MessageQueue,
      observed ? { messageQueueObservedSeries: observed } : {},
    );
  }

  const template: MessageQueueAlertTemplate = ALL[0]!;
  const reported: Record<string, Array<Record<string, unknown>>> = {
    [template.metricId]: [{ ...fixtureFor(template).attributes }],
  };

  test("a queue is offered what its broker reported, as MessageQueue recommendations; nothing otherwise", () => {
    expect(
      recommendationsFor(reported).map(
        (recommendation: MonitorRecommendation): string => {
          return recommendation.recommendationId;
        },
      ),
    ).toEqual([`MessageQueue:${template.id}`]);
    expect(recommendationsFor(undefined)).toEqual([]);
    expect(recommendationsFor({})).toEqual([]);
  });

  test("each recommended monitor reads the queue's own series, and is valid as the API takes it", () => {
    const recommendation: MonitorRecommendation =
      recommendationsFor(reported)[0]!;
    const step: MonitorStep = recommendation.getMonitorStep(ARGS);
    const query: Record<string, unknown> = step.data!.metricMonitor!
      .metricViewConfig.queryConfigs[0]!.metricQueryData.filterData as Record<
      string,
      unknown
    >;

    expect(recommendation.monitorType).toBe(MonitorType.Metrics);
    expect(query["metricName"]).toBe(template.metricName);
    expect(
      Object.keys(query["attributes"] as Record<string, unknown>).length,
    ).toBeGreaterThan(0);
    expect(
      MonitorStep.getValidationError(step, recommendation.monitorType),
    ).toBeNull();
  });

  test("a monitor made for one queue covers it, and never another system's queue", () => {
    const other: MessageQueueAlertTemplate = ALL.find(
      (candidate: MessageQueueAlertTemplate): boolean => {
        return candidate.system !== template.system;
      },
    )!;
    const mine: Array<MonitorRecommendation> = recommendationsFor(reported);
    const theirs: Array<MonitorRecommendation> = recommendationsFor({
      [other.metricId]: [{ ...fixtureFor(other).attributes }],
    });
    const made: MonitorStep = mine[0]!.getMonitorStep(ARGS);

    expect(
      MonitorRecommendationUtil.getCoveredRecommendationIds({
        recommendations: mine,
        existingMonitorSteps: [made],
        args: ARGS,
      }),
    ).toEqual(new Set<string>([mine[0]!.recommendationId]));
    expect(
      MonitorRecommendationUtil.getCoveredRecommendationIds({
        recommendations: theirs,
        existingMonitorSteps: [made],
        args: ARGS,
      }).size,
    ).toBe(0);
  });
});
