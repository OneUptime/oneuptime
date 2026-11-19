import { describe, expect, test } from "@jest/globals";
import {
  buildRumCustomSignalTemplate,
  getAllRumAlertTemplates,
  getRumAlertTemplateById,
  getRumAlertTemplates,
  getRumCustomSignalTemplateId,
  RUM_CUSTOM_SIGNAL_SESSIONS_THRESHOLD,
  RumAlertTemplate,
  RumAlertTemplateArgs,
  RumAlertTemplateContext,
} from "../../../Types/Monitor/RumAlertTemplates";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import ObjectID from "../../../Types/ObjectID";
import MonitorStepMetricMonitor from "../../../Types/Monitor/MonitorStepMetricMonitor";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MonitorRecommendationUtil from "../../../Types/Monitor/Recommendation/MonitorRecommendationUtil";
import MonitorRecommendationCatalog from "../../../Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import {
  MonitorRecommendation,
  MonitorRecommendationResourceType,
} from "../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import {
  SESSION_REPLAY_SIGNAL_ID_ATTRIBUTE,
  SESSION_REPLAY_SIGNAL_SESSIONS_METRIC,
} from "../../../Types/Rum/SessionReplaySignalMetric";
import { SESSION_REPLAY_MAX_CUSTOM_SIGNALS } from "../../../Types/Rum/SessionReplayFrustrationSignals";

/*
 * An alert on a signal of a RUM application's own (issue #6518): one
 * "Sessions hit <signal>" recommendation per signal that is switched on,
 * offered once the application records, each a Metrics monitor that sums
 * the sessions which hit the signal over 15 minutes - the signal picked by
 * its id, so a rename keeps the monitor counting it and keeps its card
 * marked as created.
 */

const APP_ID: string = "0193c0de-2222-4aaa-8bbb-000000000002";

const RECORDING: RumAlertTemplateContext = {
  sessionReplayEnabled: true,
  sessionReplayHasRecorded: true,
};

const PAYMENT_FAILED: { id: string; name: string } = {
  id: "signal-payment",
  name: "Payment failed",
};

const CHAT_OPENED: { id: string; name: string } = {
  id: "signal-chat",
  name: "Support chat opened",
};

function args(): RumAlertTemplateArgs {
  return {
    rumApplicationId: APP_ID,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Checkout",
  };
}

function customTemplates(
  context: RumAlertTemplateContext,
): Array<RumAlertTemplate> {
  return getRumAlertTemplates(context).filter(
    (template: RumAlertTemplate): boolean => {
      return template.id.startsWith("rum-custom-signal-");
    },
  );
}

function metricMonitorOf(step: MonitorStep): MonitorStepMetricMonitor {
  return step.data?.metricMonitor as MonitorStepMetricMonitor;
}

describe("which applications are offered an alert on their own signals", () => {
  test("one per signal, after the shipped ones, once the application records", () => {
    const templates: Array<RumAlertTemplate> = getRumAlertTemplates({
      ...RECORDING,
      customSignals: [PAYMENT_FAILED, CHAT_OPENED],
    });
    const custom: Array<RumAlertTemplate> = templates.slice(-2);

    expect(
      custom.map((template: RumAlertTemplate): string => {
        return template.id;
      }),
    ).toEqual([
      "rum-custom-signal-signal-payment",
      "rum-custom-signal-signal-chat",
    ]);
    expect(
      custom.map((template: RumAlertTemplate): string => {
        return template.name;
      }),
    ).toEqual([
      'Sessions Hit "Payment failed"',
      'Sessions Hit "Support chat opened"',
    ]);
  });

  test("none before the application records, or with replay off, or with nothing known", () => {
    const signals: RumAlertTemplateContext = {
      customSignals: [PAYMENT_FAILED],
    };

    expect(customTemplates(signals)).toEqual([]);
    expect(customTemplates({ ...signals, sessionReplayEnabled: true })).toEqual(
      [],
    );
    expect(
      customTemplates({
        ...signals,
        sessionReplayEnabled: false,
        sessionReplayHasRecorded: true,
      }),
    ).toEqual([]);
    expect(customTemplates(RECORDING)).toEqual([]);
    expect(customTemplates({ ...RECORDING, customSignals: null })).toEqual([]);
  });

  test("leaves out a signal it could not name or tell apart, and offers at most twenty", () => {
    const many: Array<{ id: string; name: string }> = [];

    for (let index: number = 0; index < 30; index++) {
      many.push({ id: `signal-${index}`, name: `Signal ${index}` });
    }

    expect(
      customTemplates({
        ...RECORDING,
        customSignals: [
          { id: "", name: "No id" },
          { id: "signal-x", name: "   " },
          { id: "signal-y", name: "n".repeat(41) },
          { id: "i".repeat(65), name: "Long id" },
          PAYMENT_FAILED,
          { id: PAYMENT_FAILED.id, name: "Same id twice" },
        ],
      }).map((template: RumAlertTemplate): string => {
        return template.name;
      }),
    ).toEqual(['Sessions Hit "Payment failed"']);

    expect(customTemplates({ ...RECORDING, customSignals: many })).toHaveLength(
      SESSION_REPLAY_MAX_CUSTOM_SIGNALS,
    );
  });

  test("are the application's, not the catalog's: no id resolves to one without the context", () => {
    expect(
      getAllRumAlertTemplates().some((template: RumAlertTemplate): boolean => {
        return template.id.startsWith("rum-custom-signal-");
      }),
    ).toBe(false);
    expect(
      getRumAlertTemplateById(getRumCustomSignalTemplateId(PAYMENT_FAILED.id)),
    ).toBeUndefined();
  });

  test("reach the RUM recommendations through the catalog's context", () => {
    const recommendations: Array<MonitorRecommendation> =
      MonitorRecommendationCatalog.getRecommendations(
        MonitorRecommendationResourceType.RumApplication,
        { ...RECORDING, customSignals: [PAYMENT_FAILED] },
      );
    const recommendation: MonitorRecommendation | undefined =
      recommendations.find((candidate: MonitorRecommendation): boolean => {
        return candidate.templateId === "rum-custom-signal-signal-payment";
      });

    expect(recommendation?.recommendationId).toBe(
      "RumApplication:rum-custom-signal-signal-payment",
    );
    expect(recommendation?.category).toBe("Session Replay");
    expect(recommendation?.monitorType).toBe(MonitorType.Metrics);
  });
});

describe("the monitor an alert on a signal creates", () => {
  const template: RumAlertTemplate =
    buildRumCustomSignalTemplate(PAYMENT_FAILED);
  const step: MonitorStep = template.getMonitorStep(args());

  test("is a Warning about the session replay, on the application's own series", () => {
    expect(template.severity).toBe("Warning");
    expect(template.category).toBe("Session Replay");
    expect(template.requirement).toBe("SessionReplayRecording");
    expect(template.monitorType).toBe(MonitorType.Metrics);
    expect(template.description).toBe(
      `Alert when ${RUM_CUSTOM_SIGNAL_SESSIONS_THRESHOLD} or more recorded sessions hit your signal "Payment failed" within 15 minutes. A session counts once, when the signal first fires in it.`,
    );
    /* The Health page's "budget" search finds the budget alerts only. */
    expect(`${template.name} ${template.description}`).not.toMatch(/budget/i);
  });

  test("sums the sessions that hit the signal, by its id, over 15 minutes, for this application", () => {
    const monitor: MonitorStepMetricMonitor = metricMonitorOf(step);
    const query: MetricQueryConfigData | undefined =
      monitor.metricViewConfig.queryConfigs[0];

    expect(
      monitor.telemetryServiceIds?.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([APP_ID]);
    expect(monitor.rollingTime).toBe(RollingTime.Past15Minutes);
    expect(monitor.metricViewConfig.queryConfigs).toHaveLength(1);
    expect(query?.metricQueryData.filterData.metricName).toBe(
      SESSION_REPLAY_SIGNAL_SESSIONS_METRIC,
    );
    expect(query?.metricQueryData.filterData.attributes).toEqual({
      [SESSION_REPLAY_SIGNAL_ID_ATTRIBUTE]: "signal-payment",
    });
    expect(query?.metricQueryData.filterData.aggegationType).toBe(
      MetricsAggregationType.Sum,
    );
  });

  test("opens at five sessions in the window, and reads the window as their sum", () => {
    const instances: Array<MonitorCriteriaInstance> =
      step.data?.monitorCriteria.data?.monitorCriteriaInstanceArray || [];

    expect(instances).toHaveLength(2);

    const breach: CriteriaFilter | undefined = instances[0]?.data?.filters[0];
    const recovery: CriteriaFilter | undefined = instances[1]?.data?.filters[0];

    expect(breach?.checkOn).toBe(CheckOn.MetricValue);
    expect(breach?.filterType).toBe(FilterType.GreaterThanOrEqualTo);
    expect(breach?.value).toBe(RUM_CUSTOM_SIGNAL_SESSIONS_THRESHOLD);
    expect(breach?.metricMonitorOptions?.metricAggregationType).toBe(
      EvaluateOverTimeType.Sum,
    );
    expect(breach?.metricMonitorOptions?.metricAlias).toBe(
      metricMonitorOf(step).metricViewConfig.queryConfigs[0]?.metricAliasData
        ?.metricVariable,
    );
    expect(recovery?.filterType).toBe(FilterType.LessThan);
    expect(recovery?.value).toBe(RUM_CUSTOM_SIGNAL_SESSIONS_THRESHOLD);
    expect(recovery?.metricMonitorOptions?.metricAggregationType).toBe(
      EvaluateOverTimeType.Sum,
    );

    expect(instances[0]?.data?.incidents[0]?.title).toBe(
      '[RUM] Sessions hit "Payment failed" - Checkout',
    );
    expect(instances[0]?.data?.alerts[0]?.description).toContain(
      "See sessions",
    );
    expect(instances[1]?.data?.createIncidents).toBe(false);
  });

  test("keeps its fingerprint across a rename, so the created card stays created", () => {
    const renamed: MonitorStep = buildRumCustomSignalTemplate({
      id: PAYMENT_FAILED.id,
      name: "Payment declined",
    }).getMonitorStep(args());
    const other: MonitorStep =
      buildRumCustomSignalTemplate(CHAT_OPENED).getMonitorStep(args());

    expect(
      MonitorRecommendationUtil.serializeFingerprint(
        MonitorRecommendationUtil.getFingerprintFromMonitorStep(renamed)!,
      ),
    ).toBe(
      MonitorRecommendationUtil.serializeFingerprint(
        MonitorRecommendationUtil.getFingerprintFromMonitorStep(step)!,
      ),
    );
    expect(
      MonitorRecommendationUtil.serializeFingerprint(
        MonitorRecommendationUtil.getFingerprintFromMonitorStep(other)!,
      ),
    ).not.toBe(
      MonitorRecommendationUtil.serializeFingerprint(
        MonitorRecommendationUtil.getFingerprintFromMonitorStep(step)!,
      ),
    );
  });

  test("survives the trip through the stored monitor steps", () => {
    const restored: MonitorStep = MonitorStep.fromJSON(step.toJSON());

    expect(
      metricMonitorOf(restored).metricViewConfig.queryConfigs[0]
        ?.metricQueryData.filterData.attributes,
    ).toEqual({ [SESSION_REPLAY_SIGNAL_ID_ATTRIBUTE]: "signal-payment" });
  });
});
