import { describe, expect, test } from "@jest/globals";
import KubernetesEventAttribute, {
  KUBERNETES_EVENT_DOMAIN,
  KUBERNETES_EVENTS_RESOURCE_NAME,
  KubernetesEventType,
  getKubernetesEventLogAttributes,
  parseKubernetesEventPlainObject,
} from "../../../Types/Kubernetes/KubernetesEvent";
import {
  KUBERNETES_CLUSTER_NAME_LOG_ATTRIBUTE,
  KUBERNETES_WARNING_EVENTS_GROUP_BY,
  KUBERNETES_WARNING_EVENTS_TEMPLATE_ID,
  KUBERNETES_WARNING_EVENTS_WINDOW_SECONDS,
  KubernetesEventAlertTemplate,
  buildKubernetesWarningEventsLogMonitor,
  getAllKubernetesEventAlertTemplates,
  getKubernetesWarningEventsTemplate,
} from "../../../Types/Monitor/KubernetesEventAlertTemplates";
import { getAllKubernetesAlertTemplates } from "../../../Types/Monitor/KubernetesAlertTemplates";
import MonitorRecommendationCatalog from "../../../Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import MonitorRecommendationUtil, {
  MonitorRecommendationFingerprint,
} from "../../../Types/Monitor/Recommendation/MonitorRecommendationUtil";
import {
  MonitorRecommendation,
  MonitorRecommendationArgs,
  MonitorRecommendationResourceType,
  buildRecommendationId,
} from "../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorStepLogMonitor, {
  MonitorStepLogMonitorUtil,
} from "../../../Types/Monitor/MonitorStepLogMonitor";
import MonitorType from "../../../Types/Monitor/MonitorType";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import ObjectID from "../../../Types/ObjectID";
import Query from "../../../Types/BaseDatabase/Query";
import Log from "../../../Models/AnalyticsModels/Log";
import {
  issue5179Events,
  kubernetesEventObject,
  normalPodEvent,
} from "../../Helpers/KubernetesEventRecords";

/*
 * Follow-up of #5201: a built-in monitor template for Kubernetes warning
 * events. Issue #5179 put a cluster's warnings - kernel-monitor's OOMKilling
 * on a node, an HPA's FailedGetResourceMetric - on its Events page; being
 * told when one happens took a Logs monitor built by hand from the docs.
 * The Warning Events template is that monitor, offered on every cluster's
 * Recommendations page.
 */

const CLUSTER: string = "aks-prod-westeurope";
const OTHER_CLUSTER: string = "eks-staging";

function buildArgs(
  overrides?: Partial<MonitorRecommendationArgs>,
): MonitorRecommendationArgs {
  return {
    resourceIdentifier: CLUSTER,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "aks-prod-westeurope",
    ...overrides,
  };
}

function template(): KubernetesEventAlertTemplate {
  return getKubernetesWarningEventsTemplate();
}

function stepFor(clusterIdentifier: string = CLUSTER): MonitorStep {
  return template().getMonitorStep({
    clusterIdentifier: clusterIdentifier,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: clusterIdentifier,
  });
}

function criteriaOf(step: MonitorStep): Array<MonitorCriteriaInstance> {
  return step.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray || [];
}

function recommendation(): MonitorRecommendation {
  const found: MonitorRecommendation | undefined =
    MonitorRecommendationCatalog.getRecommendationById(
      buildRecommendationId(
        MonitorRecommendationResourceType.Kubernetes,
        KUBERNETES_WARNING_EVENTS_TEMPLATE_ID,
      ),
    );

  if (!found) {
    throw new Error("The Warning Events recommendation is not in the catalog");
  }

  return found;
}

describe("the Warning Events template's Logs monitor", () => {
  test("is a Logs step over the cluster's Warning events, and nothing else", () => {
    const step: MonitorStep = stepFor();

    expect(step.data?.kubernetesMonitor).toBeUndefined();
    expect(step.data?.metricMonitor).toBeUndefined();
    expect(step.data?.logMonitor?.attributes).toEqual({
      "event.domain": "k8s",
      "k8s.resource.name": "events",
      "resource.k8s.cluster.name": CLUSTER,
      "k8s.event.type": "Warning",
    });
    // No severity, body or service narrowing: the Event's type says it.
    expect(step.data?.logMonitor?.severityTexts).toEqual([]);
    expect(step.data?.logMonitor?.body).toBe("");
    expect(step.data?.logMonitor?.telemetryServiceIds).toEqual([]);
  });

  test("names the attributes by the keys ingest stamps on an Event", () => {
    const filter: MonitorStepLogMonitor =
      buildKubernetesWarningEventsLogMonitor(CLUSTER);

    expect(Object.keys(filter.attributes).sort()).toEqual(
      [
        KubernetesEventAttribute.Domain,
        KubernetesEventAttribute.ResourceName,
        KubernetesEventAttribute.Type,
        KUBERNETES_CLUSTER_NAME_LOG_ATTRIBUTE,
      ].sort(),
    );
    expect(filter.attributes[KubernetesEventAttribute.Domain]).toBe(
      KUBERNETES_EVENT_DOMAIN,
    );
    expect(filter.attributes[KubernetesEventAttribute.ResourceName]).toBe(
      KUBERNETES_EVENTS_RESOURCE_NAME,
    );
    expect(filter.attributes[KubernetesEventAttribute.Type]).toBe(
      KubernetesEventType.Warning,
    );
  });

  test("raises one alert per namespace, kind, object and reason", () => {
    expect(stepFor().data?.logMonitor?.groupByAttributes).toEqual([
      "k8s.namespace.name",
      "k8s.object.kind",
      "k8s.object.name",
      "k8s.event.reason",
    ]);
    expect(KUBERNETES_WARNING_EVENTS_GROUP_BY).toEqual([
      KubernetesEventAttribute.Namespace,
      KubernetesEventAttribute.ObjectKind,
      KubernetesEventAttribute.ObjectName,
      KubernetesEventAttribute.Reason,
    ]);
    // Resolved when the warnings stop, not by a log of their own.
    expect(stepFor().data?.logMonitor?.resolvedByAttributes).toBeUndefined();
  });

  test("looks five minutes back on every check", () => {
    expect(KUBERNETES_WARNING_EVENTS_WINDOW_SECONDS).toBe(300);
    expect(stepFor().data?.logMonitor?.lastXSecondsOfLogs).toBe(300);
  });

  test("asks the logs for exactly those records, over the five minutes before the check", () => {
    const until: Date = new Date("2026-10-26T12:00:00.000Z");
    const query: Query<Log> = MonitorStepLogMonitorUtil.toQuery(
      stepFor().data!.logMonitor!,
      until,
    );

    expect(query.attributes).toEqual({
      "event.domain": "k8s",
      "k8s.resource.name": "events",
      "resource.k8s.cluster.name": CLUSTER,
      "k8s.event.type": "Warning",
    });
    expect(query.severityText).toBeUndefined();
    expect(query.body).toBeUndefined();
    expect(query.primaryEntityId).toBeUndefined();

    const time: InBetween<Date> = query.time as InBetween<Date>;
    expect(time.startValue.toISOString()).toBe("2026-10-26T11:55:00.000Z");
    expect(time.endValue.toISOString()).toBe("2026-10-26T12:00:00.000Z");
  });

  test("fires on any warning and recovers on none", () => {
    const [unhealthy, healthy] = criteriaOf(stepFor());

    expect(unhealthy?.data?.filters).toEqual([
      {
        checkOn: CheckOn.LogCount,
        filterType: FilterType.GreaterThan,
        value: 0,
      },
    ]);
    expect(healthy?.data?.filters).toEqual([
      { checkOn: CheckOn.LogCount, filterType: FilterType.EqualTo, value: 0 },
    ]);
    expect(healthy?.data?.alerts).toEqual([]);
    expect(healthy?.data?.incidents).toEqual([]);
  });

  test("its alert and incident say what fired, on which cluster, and resolve by themselves", () => {
    const step: MonitorStep = template().getMonitorStep({
      clusterIdentifier: CLUSTER,
      onlineMonitorStatusId: ObjectID.generate(),
      offlineMonitorStatusId: ObjectID.generate(),
      defaultIncidentSeverityId: ObjectID.generate(),
      defaultAlertSeverityId: ObjectID.generate(),
      monitorName: "Payments cluster",
    });
    const unhealthy: MonitorCriteriaInstance = criteriaOf(step)[0]!;

    expect(unhealthy.data?.alerts[0]?.title).toBe(
      "[K8s] Warning Event - Payments cluster",
    );
    expect(unhealthy.data?.incidents[0]?.title).toBe(
      "[K8s] Warning Event - Payments cluster",
    );
    expect(unhealthy.data?.alerts[0]?.autoResolveAlert).toBe(true);
    expect(unhealthy.data?.incidents[0]?.autoResolveIncident).toBe(true);
    expect(unhealthy.data?.alerts[0]?.description).toContain(
      "Kubernetes reported a warning event on Payments cluster.",
    );
    // As every template ships: the create form's choice picks one or both.
    expect(unhealthy.data?.createAlerts).toBe(true);
    expect(unhealthy.data?.createIncidents).toBe(true);
  });

  test("threads each cluster's identifier into its own monitor", () => {
    expect(
      stepFor(OTHER_CLUSTER).data?.logMonitor?.attributes[
        "resource.k8s.cluster.name"
      ],
    ).toBe(OTHER_CLUSTER);
  });
});

describe("what ingest stamps on an Event is what the alert counts", () => {
  const NOW: Date = new Date("2026-10-26T12:00:00.000Z");

  /*
   * An Event's record, as ingest stores it: the attributes it stamps, the
   * receiver's own k8s.resource.name, and the agent's cluster as a resource
   * attribute.
   */
  function storedAttributes(
    eventObject: Parameters<typeof parseKubernetesEventPlainObject>[0],
    clusterName: string,
  ): Record<string, unknown> {
    return {
      ...getKubernetesEventLogAttributes(
        parseKubernetesEventPlainObject(eventObject)!,
      ),
      "k8s.resource.name": "events",
      "resource.k8s.cluster.name": clusterName,
    };
  }

  function counts(attributes: Record<string, unknown>): boolean {
    const filter: MonitorStepLogMonitor =
      buildKubernetesWarningEventsLogMonitor(CLUSTER);

    return Object.entries(filter.attributes).every(
      ([key, value]: [string, unknown]): boolean => {
        return attributes[key] === value;
      },
    );
  }

  test("every warning of issue #5179 is counted, with every attribute it is grouped by", () => {
    for (const fields of issue5179Events(NOW)) {
      const attributes: Record<string, unknown> = storedAttributes(
        kubernetesEventObject(fields),
        CLUSTER,
      );

      expect({ reason: fields.reason, counted: counts(attributes) }).toEqual({
        reason: fields.reason,
        counted: true,
      });

      for (const key of KUBERNETES_WARNING_EVENTS_GROUP_BY) {
        expect({ key, value: typeof attributes[key] }).toEqual({
          key,
          value: "string",
        });
      }
    }
  });

  test("a Normal event is not counted", () => {
    expect(
      counts(
        storedAttributes(
          kubernetesEventObject(normalPodEvent(1, NOW)),
          CLUSTER,
        ),
      ),
    ).toBe(false);
  });

  test("another cluster's warning is not counted", () => {
    const oom: ReturnType<typeof issue5179Events>[number] =
      issue5179Events(NOW)[0]!;

    expect(
      counts(storedAttributes(kubernetesEventObject(oom), OTHER_CLUSTER)),
    ).toBe(false);
  });
});

describe("the Warning Events recommendation", () => {
  test("is offered on every cluster, after the metric templates, as a Logs monitor", () => {
    const recommendations: Array<MonitorRecommendation> =
      MonitorRecommendationCatalog.getRecommendations(
        MonitorRecommendationResourceType.Kubernetes,
      );
    const last: MonitorRecommendation =
      recommendations[recommendations.length - 1]!;

    expect(recommendations).toHaveLength(
      getAllKubernetesAlertTemplates().length +
        getAllKubernetesEventAlertTemplates().length,
    );
    expect(last.templateId).toBe(KUBERNETES_WARNING_EVENTS_TEMPLATE_ID);
    expect(last.recommendationId).toBe("Kubernetes:k8s-warning-events");
    expect(last.monitorType).toBe(MonitorType.Logs);
    expect(last.category).toBe("Events");
    expect(last.severity).toBe("Warning");
    expect(last.name).toBe("Warning Events");
    expect(last.summary).toBe(
      "Kubernetes reports a warning event: one alert per object and reason.",
    );
  });

  test("a Kubernetes monitor's Quick Setup never offers it: it is not a Kubernetes step", () => {
    expect(
      getAllKubernetesAlertTemplates().map(
        (candidate: { id: string }): string => {
          return candidate.id;
        },
      ),
    ).not.toContain(KUBERNETES_WARNING_EVENTS_TEMPLATE_ID);
  });

  test("builds the cluster's Logs monitor from the Recommendations page's args", () => {
    const step: MonitorStep = recommendation().getMonitorStep(buildArgs());

    expect(step.data?.logMonitor?.attributes["resource.k8s.cluster.name"]).toBe(
      CLUSTER,
    );
    expect(step.data?.kubernetesMonitor).toBeUndefined();
  });

  test("its fingerprint names the cluster, as a Kubernetes monitor's does", () => {
    const fingerprint: MonitorRecommendationFingerprint | undefined =
      MonitorRecommendationUtil.getFingerprintFromMonitorStep(
        recommendation().getMonitorStep(buildArgs()),
      );

    expect(fingerprint?.resourceIdentifier).toBe(CLUSTER);
    expect(fingerprint?.configKind).toBe("logMonitor");
    expect(fingerprint?.criteriaFilters.sort()).toEqual(
      [
        `${CheckOn.LogCount}|${FilterType.GreaterThan}|0|`,
        `${CheckOn.LogCount}|${FilterType.EqualTo}|0|`,
      ].sort(),
    );
  });

  test("a monitor made from it covers it, on its own cluster only", () => {
    const created: MonitorStep = recommendation().getMonitorStep(
      buildArgs({ monitorName: "a renamed monitor" }),
    );

    expect(
      MonitorRecommendationUtil.getCoveredRecommendationIds({
        recommendations: [recommendation()],
        existingMonitorSteps: [created],
        args: buildArgs(),
      }).has(recommendation().recommendationId),
    ).toBe(true);

    expect(
      MonitorRecommendationUtil.getCoveredRecommendationIds({
        recommendations: [recommendation()],
        existingMonitorSteps: [created],
        args: buildArgs({ resourceIdentifier: OTHER_CLUSTER }),
      }).has(recommendation().recommendationId),
    ).toBe(false);
  });

  test("a Logs monitor that asks something else does not cover it", () => {
    const variants: Array<(logMonitor: MonitorStepLogMonitor) => void> = [
      // Every warning of the cluster as one count: no alert per object.
      (logMonitor: MonitorStepLogMonitor): void => {
        logMonitor.groupByAttributes = [];
      },
      // Another window.
      (logMonitor: MonitorStepLogMonitor): void => {
        logMonitor.lastXSecondsOfLogs = 3600;
      },
      // Only OOM kills.
      (logMonitor: MonitorStepLogMonitor): void => {
        logMonitor.attributes["k8s.event.reason"] = "OOMKilling";
      },
      // Normal events.
      (logMonitor: MonitorStepLogMonitor): void => {
        logMonitor.attributes["k8s.event.type"] = "Normal";
      },
    ];

    for (const change of variants) {
      const step: MonitorStep = recommendation().getMonitorStep(buildArgs());
      change(step.data!.logMonitor!);

      expect(
        MonitorRecommendationUtil.getCoveredRecommendationIds({
          recommendations: [recommendation()],
          existingMonitorSteps: [step],
          args: buildArgs(),
        }).has(recommendation().recommendationId),
      ).toBe(false);
    }
  });

  test("covers none of the cluster's metric recommendations, and none of them covers it", () => {
    const all: Array<MonitorRecommendation> =
      MonitorRecommendationCatalog.getRecommendations(
        MonitorRecommendationResourceType.Kubernetes,
      );
    const warningStep: MonitorStep =
      recommendation().getMonitorStep(buildArgs());

    expect([
      ...MonitorRecommendationUtil.getCoveredRecommendationIds({
        recommendations: all,
        existingMonitorSteps: [warningStep],
        args: buildArgs(),
      }),
    ]).toEqual([recommendation().recommendationId]);

    const metricSteps: Array<MonitorStep> = all
      .filter((candidate: MonitorRecommendation): boolean => {
        return candidate.monitorType === MonitorType.Kubernetes;
      })
      .map((candidate: MonitorRecommendation): MonitorStep => {
        return candidate.getMonitorStep(buildArgs());
      });

    expect(
      MonitorRecommendationUtil.getCoveredRecommendationIds({
        recommendations: [recommendation()],
        existingMonitorSteps: metricSteps,
        args: buildArgs(),
      }).size,
    ).toBe(0);
  });

  test("a filter value other than the cluster's text never names a cluster", () => {
    const step: MonitorStep = recommendation().getMonitorStep(buildArgs());
    (step.data!.logMonitor!.attributes as Record<string, unknown>)[
      "resource.k8s.cluster.name"
    ] = 42;

    expect(
      MonitorRecommendationUtil.getFingerprintFromMonitorStep(step)
        ?.resourceIdentifier,
    ).toBe("");
  });

  test("every unhealthy filter counts logs, as the Logs evaluator reads them", () => {
    const filters: Array<CriteriaFilter> = criteriaOf(stepFor()).flatMap(
      (instance: MonitorCriteriaInstance): Array<CriteriaFilter> => {
        return instance.data?.filters || [];
      },
    );

    expect(
      filters.every((filter: CriteriaFilter): boolean => {
        return filter.checkOn === CheckOn.LogCount;
      }),
    ).toBe(true);
  });
});
