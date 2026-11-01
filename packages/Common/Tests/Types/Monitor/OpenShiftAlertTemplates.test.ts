import { JSONObject } from "../../../Types/JSON";
import {
  OpenShiftObjectAttribute,
  getOpenShiftStatusLogAttributes,
} from "../../../Types/Kubernetes/OpenShiftObjectAttributes";
import { OpenShiftResourceType } from "../../../Types/Kubernetes/OpenShiftObjectParser";
import ObjectID from "../../../Types/ObjectID";
import { CheckOn, FilterType } from "../../../Types/Monitor/CriteriaFilter";
import { getAllKubernetesAlertTemplates } from "../../../Types/Monitor/KubernetesAlertTemplates";
import { KUBERNETES_CLUSTER_NAME_LOG_ATTRIBUTE } from "../../../Types/Monitor/KubernetesEventAlertTemplates";
import { LogMonitorGroupResult } from "../../../Types/Monitor/LogMonitor/LogMonitorResponse";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import { MonitorStepLogMonitorUtil } from "../../../Types/Monitor/MonitorStepLogMonitor";
import MonitorType from "../../../Types/Monitor/MonitorType";
import {
  OPENSHIFT_OPERATOR_DEGRADED_TEMPLATE_ID,
  OPENSHIFT_OPERATOR_UNAVAILABLE_TEMPLATE_ID,
  OPENSHIFT_STATUS_GROUP_BY,
  OPENSHIFT_STATUS_MIN_SNAPSHOTS,
  OPENSHIFT_STATUS_WINDOW_SECONDS,
  OPENSHIFT_UPDATE_FAILING_TEMPLATE_ID,
  OpenShiftAlertTemplate,
  getAllOpenShiftAlertTemplates,
} from "../../../Types/Monitor/OpenShiftAlertTemplates";
import MonitorRecommendationCatalog from "../../../Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import MonitorRecommendationUtil from "../../../Types/Monitor/Recommendation/MonitorRecommendationUtil";
import {
  MonitorRecommendation,
  MonitorRecommendationArgs,
  MonitorRecommendationResourceType,
} from "../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import LogMonitorCriteria from "../../../Server/Utils/Monitor/Criteria/LogMonitorCriteria";
import {
  PlainValue,
  toOtlpAnyValue,
} from "../../Helpers/KubernetesEventRecords";
import { describe, expect, test } from "@jest/globals";

/*
 * The OpenShift alerts: Logs monitors over the ClusterOperator and
 * ClusterVersion snapshots the openshift preset sends. What they must get
 * right is what a person would be woken for:
 *
 *   - a condition seen in two snapshots alerts, a moment's flip during an
 *     update does not;
 *   - the snapshot that says it is over resolves the alert, and silence does
 *     not, because an agent that stops says nothing about the operator;
 *   - that snapshot is this cluster's: the logs that resolve a group replace
 *     the monitor's filters, so another cluster's healthy operator of the
 *     same name must not close this one's alert;
 *   - only an OpenShift cluster is offered them.
 */

const CLUSTER: string = "ocp-prod-eu";
const OTHER_CLUSTER: string = "ocp-staging";

function buildArgs(
  overrides?: Partial<MonitorRecommendationArgs>,
): MonitorRecommendationArgs {
  return {
    resourceIdentifier: CLUSTER,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "OpenShift Production",
    ...overrides,
  };
}

function templateOf(id: string): OpenShiftAlertTemplate {
  return getAllOpenShiftAlertTemplates().find(
    (template: OpenShiftAlertTemplate): boolean => {
      return template.id === id;
    },
  )!;
}

function stepFor(id: string, clusterIdentifier: string = CLUSTER): MonitorStep {
  return templateOf(id).getMonitorStep({
    clusterIdentifier,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "OpenShift Production",
  });
}

function criteriaOf(step: MonitorStep): Array<MonitorCriteriaInstance> {
  return step.data?.monitorCriteria.data?.monitorCriteriaInstanceArray || [];
}

/*
 * A record as ingest stores it: what the collector sends, with what ingest
 * stamps from the object in the record's body.
 */
function storedAttributes(data: {
  resourceType: string;
  object: PlainValue;
  clusterName: string;
}): Record<string, unknown> {
  const attributes: Record<string, unknown> = {
    [OpenShiftObjectAttribute.ResourceName]: data.resourceType,
    [KUBERNETES_CLUSTER_NAME_LOG_ATTRIBUTE]: data.clusterName,
  };

  return {
    ...attributes,
    ...getOpenShiftStatusLogAttributes({
      attributes,
      objectKvList: toOtlpAnyValue(data.object)["kvlistValue"] as JSONObject,
    }),
  };
}

function operatorRecord(
  conditions: Record<string, string>,
  clusterName: string = CLUSTER,
): Record<string, unknown> {
  return storedAttributes({
    resourceType: OpenShiftResourceType.ClusterOperators,
    clusterName,
    object: {
      apiVersion: "config.openshift.io/v1",
      kind: "ClusterOperator",
      metadata: { name: "authentication" },
      status: {
        conditions: Object.entries(conditions).map(
          ([type, status]: [string, string]): PlainValue => {
            return { type, status };
          },
        ),
      },
    },
  });
}

function versionRecord(
  conditions: Record<string, string>,
  clusterName: string = CLUSTER,
): Record<string, unknown> {
  return storedAttributes({
    resourceType: OpenShiftResourceType.ClusterVersions,
    clusterName,
    object: {
      apiVersion: "config.openshift.io/v1",
      kind: "ClusterVersion",
      metadata: { name: "version" },
      status: {
        conditions: Object.entries(conditions).map(
          ([type, status]: [string, string]): PlainValue => {
            return { type, status };
          },
        ),
      },
    },
  });
}

function matches(
  filter: Record<string, unknown> | undefined,
  record: Record<string, unknown>,
): boolean {
  return Object.entries(filter || {}).every(
    ([key, value]: [string, unknown]): boolean => {
      return record[key] === value;
    },
  );
}

function counts(id: string, record: Record<string, unknown>): boolean {
  return matches(
    stepFor(id).data?.logMonitor?.attributes as Record<string, unknown>,
    record,
  );
}

function resolves(id: string, record: Record<string, unknown>): boolean {
  return matches(
    stepFor(id).data?.logMonitor?.resolvedByAttributes as Record<
      string,
      unknown
    >,
    record,
  );
}

const CASES: Array<{
  id: string;
  resourceType: string;
  attribute: string;
  problem: string;
  recovered: string;
  severity: string;
}> = [
  {
    id: OPENSHIFT_OPERATOR_UNAVAILABLE_TEMPLATE_ID,
    resourceType: "clusteroperators",
    attribute: "openshift.condition.available",
    problem: "False",
    recovered: "True",
    severity: "Critical",
  },
  {
    id: OPENSHIFT_OPERATOR_DEGRADED_TEMPLATE_ID,
    resourceType: "clusteroperators",
    attribute: "openshift.condition.degraded",
    problem: "True",
    recovered: "False",
    severity: "Warning",
  },
  {
    id: OPENSHIFT_UPDATE_FAILING_TEMPLATE_ID,
    resourceType: "clusterversions",
    attribute: "openshift.condition.failing",
    problem: "True",
    recovered: "False",
    severity: "Critical",
  },
];

describe("each template's Logs monitor", () => {
  test("the issue's three are here: operators degraded or unavailable, the update failing", () => {
    expect(
      getAllOpenShiftAlertTemplates()
        .map((template: OpenShiftAlertTemplate): string => {
          return template.id;
        })
        .sort(),
    ).toEqual(
      CASES.map((entry: { id: string }): string => {
        return entry.id;
      }).sort(),
    );
  });

  test.each(CASES)(
    "$id counts this cluster's $resourceType whose $attribute is $problem",
    (entry: (typeof CASES)[number]) => {
      expect(stepFor(entry.id).data?.logMonitor?.attributes).toEqual({
        "k8s.resource.name": entry.resourceType,
        "resource.k8s.cluster.name": CLUSTER,
        [entry.attribute]: entry.problem,
      });
    },
  );

  test.each(CASES)(
    "$id raises one alert per object, and looks far enough back for two snapshots",
    (entry: (typeof CASES)[number]) => {
      const logMonitor: MonitorStep["data"] = stepFor(entry.id).data;

      expect(logMonitor?.logMonitor?.groupByAttributes).toEqual([
        "k8s.object.name",
      ]);
      expect(logMonitor?.logMonitor?.lastXSecondsOfLogs).toBe(
        OPENSHIFT_STATUS_WINDOW_SECONDS,
      );
    },
  );

  test.each(CASES)(
    "$id is a Logs step, with nothing else set",
    (entry: (typeof CASES)[number]) => {
      const step: MonitorStep = stepFor(entry.id);

      expect(step.data?.logMonitor).toBeDefined();
      expect(step.data?.kubernetesMonitor).toBeUndefined();
      expect(step.data?.metricMonitor).toBeUndefined();
      expect(step.data?.logMonitor?.body).toBe("");
      expect(step.data?.logMonitor?.severityTexts).toEqual([]);
    },
  );

  test("the window fits two snapshots at the slowest interval inventory keeps up with", () => {
    // KubernetesResourceService hard-deletes rows unseen for 15 minutes.
    const stalestIntervalInSeconds: number = 15 * 60;

    expect(OPENSHIFT_STATUS_WINDOW_SECONDS).toBeGreaterThanOrEqual(
      OPENSHIFT_STATUS_MIN_SNAPSHOTS * stalestIntervalInSeconds,
    );
  });

  test.each(CASES)("$id is $severity", (entry: (typeof CASES)[number]) => {
    expect(templateOf(entry.id).severity).toBe(entry.severity);
  });

  test.each(CASES)(
    "$id threads each cluster's identifier into both of its filters",
    (entry: (typeof CASES)[number]) => {
      const logMonitor: MonitorStep["data"] = stepFor(
        entry.id,
        OTHER_CLUSTER,
      ).data;

      expect(
        logMonitor?.logMonitor?.attributes["resource.k8s.cluster.name"],
      ).toBe(OTHER_CLUSTER);
      expect(
        logMonitor?.logMonitor?.resolvedByAttributes?.[
          "resource.k8s.cluster.name"
        ],
      ).toBe(OTHER_CLUSTER);
    },
  );
});

describe("two snapshots alert, one does not", () => {
  const group: (logCount: number) => LogMonitorGroupResult = (
    logCount: number,
  ): LogMonitorGroupResult => {
    return {
      fingerprint: "authentication",
      labels: { "k8s.object.name": "authentication" },
      logCount,
    };
  };

  async function breaches(id: string, logCount: number): Promise<boolean> {
    const step: MonitorStep = stepFor(id);
    const unhealthy: MonitorCriteriaInstance = criteriaOf(step)[0]!;

    const message: string | null =
      await LogMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: {
          projectId: ObjectID.generate(),
          logCount,
          logQuery: {},
          monitorId: ObjectID.generate(),
          groupByAttributes: OPENSHIFT_STATUS_GROUP_BY,
          groupBreakdown: [group(logCount)],
          totalGroupCount: 1,
          resolvedGroups: [],
        },
        monitorStep: step,
        criteriaFilter: unhealthy.data!.filters[0]!,
      } as never);

    return message !== null;
  }

  test.each(CASES)(
    "$id: one snapshot is a moment's flip",
    async (entry: (typeof CASES)[number]) => {
      expect(await breaches(entry.id, 1)).toBe(false);
    },
  );

  test.each(CASES)(
    "$id: two are a condition that holds",
    async (entry: (typeof CASES)[number]) => {
      expect(await breaches(entry.id, 2)).toBe(true);
    },
  );

  test.each(CASES)(
    "$id: more still alerts",
    async (entry: (typeof CASES)[number]) => {
      expect(await breaches(entry.id, 6)).toBe(true);
    },
  );

  test("the filter counts logs, as the Logs evaluator reads them", () => {
    for (const entry of CASES) {
      expect(criteriaOf(stepFor(entry.id))[0]?.data?.filters).toEqual([
        {
          checkOn: CheckOn.LogCount,
          filterType: FilterType.GreaterThanOrEqualTo,
          value: OPENSHIFT_STATUS_MIN_SNAPSHOTS,
        },
      ]);
    }
  });
});

describe("what resolves an alert", () => {
  test.each(CASES)(
    "$id is resolved by a log, never by silence",
    (entry: (typeof CASES)[number]) => {
      expect(
        MonitorStepLogMonitorUtil.isResolvedByLog(
          stepFor(entry.id).data?.logMonitor,
        ),
      ).toBe(true);
    },
  );

  test.each(CASES)(
    "$id: the logs that resolve it name the cluster, as they replace the monitor's filters",
    (entry: (typeof CASES)[number]) => {
      const query: { attributes?: unknown } =
        MonitorStepLogMonitorUtil.toResolvedByQuery(
          stepFor(entry.id).data!.logMonitor!,
        ) as { attributes?: unknown };

      expect(query.attributes).toEqual({
        "k8s.resource.name": entry.resourceType,
        "resource.k8s.cluster.name": CLUSTER,
        [entry.attribute]: entry.recovered,
      });
    },
  );

  test.each(CASES)(
    "$id: the two filters differ only in the condition's status",
    (entry: (typeof CASES)[number]) => {
      const logMonitor: MonitorStep["data"] = stepFor(entry.id).data;

      expect({
        ...logMonitor?.logMonitor?.attributes,
        [entry.attribute]: entry.recovered,
      }).toEqual(logMonitor?.logMonitor?.resolvedByAttributes);
    },
  );

  test("the healthy criteria raises nothing", () => {
    for (const entry of CASES) {
      const healthy: MonitorCriteriaInstance = criteriaOf(
        stepFor(entry.id),
      )[1]!;

      expect(healthy.data?.filters).toEqual([
        { checkOn: CheckOn.LogCount, filterType: FilterType.EqualTo, value: 0 },
      ]);
      expect(healthy.data?.alerts).toEqual([]);
      expect(healthy.data?.incidents).toEqual([]);
    }
  });
});

describe("what ingest stamps is what the alerts read", () => {
  const FINE: Record<string, string> = {
    Available: "True",
    Progressing: "False",
    Degraded: "False",
  };

  test("a degraded operator's snapshot is counted by the Degraded alert alone", () => {
    const record: Record<string, unknown> = operatorRecord({
      ...FINE,
      Degraded: "True",
    });

    expect(counts(OPENSHIFT_OPERATOR_DEGRADED_TEMPLATE_ID, record)).toBe(true);
    expect(counts(OPENSHIFT_OPERATOR_UNAVAILABLE_TEMPLATE_ID, record)).toBe(
      false,
    );
    expect(record["k8s.object.name"]).toBe("authentication");
  });

  test("an operator down and saying Degraded too raises both", () => {
    const record: Record<string, unknown> = operatorRecord({
      Available: "False",
      Progressing: "False",
      Degraded: "True",
    });

    expect(counts(OPENSHIFT_OPERATOR_DEGRADED_TEMPLATE_ID, record)).toBe(true);
    expect(counts(OPENSHIFT_OPERATOR_UNAVAILABLE_TEMPLATE_ID, record)).toBe(
      true,
    );
  });

  test("a healthy operator's snapshot is counted by neither, and resolves both", () => {
    const record: Record<string, unknown> = operatorRecord(FINE);

    expect(counts(OPENSHIFT_OPERATOR_DEGRADED_TEMPLATE_ID, record)).toBe(false);
    expect(counts(OPENSHIFT_OPERATOR_UNAVAILABLE_TEMPLATE_ID, record)).toBe(
      false,
    );
    expect(resolves(OPENSHIFT_OPERATOR_DEGRADED_TEMPLATE_ID, record)).toBe(
      true,
    );
    expect(resolves(OPENSHIFT_OPERATOR_UNAVAILABLE_TEMPLATE_ID, record)).toBe(
      true,
    );
  });

  test("a rollout neither alerts nor keeps an alert open", () => {
    const record: Record<string, unknown> = operatorRecord({
      ...FINE,
      Progressing: "True",
    });

    expect(counts(OPENSHIFT_OPERATOR_DEGRADED_TEMPLATE_ID, record)).toBe(false);
    expect(resolves(OPENSHIFT_OPERATOR_DEGRADED_TEMPLATE_ID, record)).toBe(
      true,
    );
  });

  test("a condition an operator reports as Unknown neither alerts nor resolves", () => {
    const record: Record<string, unknown> = operatorRecord({
      ...FINE,
      Degraded: "Unknown",
    });

    expect(counts(OPENSHIFT_OPERATOR_DEGRADED_TEMPLATE_ID, record)).toBe(false);
    expect(resolves(OPENSHIFT_OPERATOR_DEGRADED_TEMPLATE_ID, record)).toBe(
      false,
    );
  });

  test("another cluster's snapshot is never counted, and never resolves this one's alert", () => {
    const degraded: Record<string, unknown> = operatorRecord(
      { ...FINE, Degraded: "True" },
      OTHER_CLUSTER,
    );
    const recovered: Record<string, unknown> = operatorRecord(
      FINE,
      OTHER_CLUSTER,
    );

    expect(counts(OPENSHIFT_OPERATOR_DEGRADED_TEMPLATE_ID, degraded)).toBe(
      false,
    );
    expect(resolves(OPENSHIFT_OPERATOR_DEGRADED_TEMPLATE_ID, recovered)).toBe(
      false,
    );
  });

  test("a failing update's snapshot is counted, and one that no longer fails resolves it", () => {
    const failing: Record<string, unknown> = versionRecord({
      Available: "True",
      Failing: "True",
    });
    const recovered: Record<string, unknown> = versionRecord({
      Available: "True",
      Failing: "False",
    });

    expect(counts(OPENSHIFT_UPDATE_FAILING_TEMPLATE_ID, failing)).toBe(true);
    expect(resolves(OPENSHIFT_UPDATE_FAILING_TEMPLATE_ID, failing)).toBe(false);
    expect(counts(OPENSHIFT_UPDATE_FAILING_TEMPLATE_ID, recovered)).toBe(false);
    expect(resolves(OPENSHIFT_UPDATE_FAILING_TEMPLATE_ID, recovered)).toBe(
      true,
    );
  });

  test("an update under way is no failure", () => {
    expect(
      counts(
        OPENSHIFT_UPDATE_FAILING_TEMPLATE_ID,
        versionRecord({
          Available: "True",
          Progressing: "True",
          Failing: "False",
        }),
      ),
    ).toBe(false);
  });

  test("an operator's record never counts toward the update's alert", () => {
    expect(
      counts(
        OPENSHIFT_UPDATE_FAILING_TEMPLATE_ID,
        operatorRecord({ Available: "True", Failing: "True" }),
      ),
    ).toBe(false);
  });

  test("every record names what the alerts group by", () => {
    for (const record of [operatorRecord(FINE), versionRecord(FINE)]) {
      for (const key of OPENSHIFT_STATUS_GROUP_BY) {
        expect(typeof record[key]).toBe("string");
      }
    }
  });
});

describe("what an alert says", () => {
  test.each(CASES)(
    "$id says what fired, on which cluster, and resolves by itself",
    (entry: (typeof CASES)[number]) => {
      const unhealthy: MonitorCriteriaInstance = criteriaOf(
        stepFor(entry.id),
      )[0]!;
      const alert: {
        title: string;
        description?: string;
        autoResolveAlert?: boolean;
      } = unhealthy.data!.alerts[0]!;
      const incident: { title: string; autoResolveIncident?: boolean } =
        unhealthy.data!.incidents[0]!;

      expect(alert.title).toContain("[OpenShift]");
      expect(alert.title).toContain("OpenShift Production");
      expect(alert.description).toContain("OpenShift Production");
      expect(alert.autoResolveAlert).toBe(true);
      expect(incident.autoResolveIncident).toBe(true);
    },
  );

  test("both an alert and an incident ship, as every template does", () => {
    for (const entry of CASES) {
      const unhealthy: MonitorCriteriaInstance = criteriaOf(
        stepFor(entry.id),
      )[0]!;

      expect(unhealthy.data?.createAlerts).toBe(true);
      expect(unhealthy.data?.createIncidents).toBe(true);
      expect(unhealthy.data?.changeMonitorStatus).toBe(true);
    }
  });

  test("a description is plain text: it is drawn as such on the card", () => {
    for (const template of getAllOpenShiftAlertTemplates()) {
      expect(template.description).not.toContain("`");
      expect(template.summary).not.toContain("`");
      expect(template.category).toBe("OpenShift");
    }
  });
});

describe("the recommendations", () => {
  function kubernetes(
    kubernetesProvider?: string | null,
  ): Array<MonitorRecommendation> {
    return MonitorRecommendationCatalog.getRecommendations(
      MonitorRecommendationResourceType.Kubernetes,
      kubernetesProvider === undefined ? undefined : { kubernetesProvider },
    );
  }

  function ids(recommendations: Array<MonitorRecommendation>): Array<string> {
    return recommendations.map((recommendation: MonitorRecommendation) => {
      return recommendation.templateId;
    });
  }

  function recommendation(id: string): MonitorRecommendation {
    return kubernetes("OpenShift").find(
      (candidate: MonitorRecommendation): boolean => {
        return candidate.templateId === id;
      },
    )!;
  }

  const OPENSHIFT_IDS: Array<string> = CASES.map(
    (entry: { id: string }): string => {
      return entry.id;
    },
  );

  test("an OpenShift cluster is offered them, after everything else, as Logs monitors", () => {
    const offered: Array<MonitorRecommendation> = kubernetes("OpenShift");

    expect(ids(offered).slice(-3).sort()).toEqual([...OPENSHIFT_IDS].sort());
    expect(offered.length).toBe(kubernetes().length + 3);

    for (const id of OPENSHIFT_IDS) {
      expect(recommendation(id).monitorType).toBe(MonitorType.Logs);
      expect(recommendation(id).category).toBe("OpenShift");
    }
  });

  test.each([
    [undefined],
    [null],
    ["unknown"],
    [""],
    ["EKS"],
    ["GKE"],
    ["AKS"],
    ["openshift"],
    ["Tencent EKS"],
  ])(
    "a cluster whose provider is %j is not",
    (provider: string | null | undefined) => {
      for (const id of OPENSHIFT_IDS) {
        expect(ids(kubernetes(provider))).not.toContain(id);
      }
    },
  );

  test("the set everything else is checked against holds them", () => {
    const all: Array<string> = ids(
      MonitorRecommendationCatalog.getAllRecommendations(
        MonitorRecommendationResourceType.Kubernetes,
      ),
    );

    for (const id of OPENSHIFT_IDS) {
      expect(all).toContain(id);
    }
  });

  test("a Kubernetes monitor's Quick Setup never offers them: they are not Kubernetes steps", () => {
    const quickSetup: Array<string> = getAllKubernetesAlertTemplates().map(
      (template: { id: string }): string => {
        return template.id;
      },
    );

    for (const id of OPENSHIFT_IDS) {
      expect(quickSetup).not.toContain(id);
    }
  });

  test.each(OPENSHIFT_IDS)(
    "%s builds the cluster's monitor from the page's args",
    (id: string) => {
      const step: MonitorStep = recommendation(id).getMonitorStep(buildArgs());

      expect(
        step.data?.logMonitor?.attributes["resource.k8s.cluster.name"],
      ).toBe(CLUSTER);
    },
  );

  test.each(OPENSHIFT_IDS)(
    "%s: a monitor made from it covers it, on its own cluster only",
    (id: string) => {
      const created: MonitorStep = recommendation(id).getMonitorStep(
        buildArgs({ monitorName: "a renamed monitor" }),
      );

      expect(
        MonitorRecommendationUtil.getCoveredRecommendationIds({
          recommendations: [recommendation(id)],
          existingMonitorSteps: [created],
          args: buildArgs(),
        }).has(recommendation(id).recommendationId),
      ).toBe(true);

      expect(
        MonitorRecommendationUtil.getCoveredRecommendationIds({
          recommendations: [recommendation(id)],
          existingMonitorSteps: [created],
          args: buildArgs({ resourceIdentifier: OTHER_CLUSTER }),
        }).has(recommendation(id).recommendationId),
      ).toBe(false);
    },
  );

  test("one alert's monitor covers no other", () => {
    for (const id of OPENSHIFT_IDS) {
      const created: MonitorStep =
        recommendation(id).getMonitorStep(buildArgs());
      const covered: Set<string> =
        MonitorRecommendationUtil.getCoveredRecommendationIds({
          recommendations: OPENSHIFT_IDS.map(recommendation),
          existingMonitorSteps: [created],
          args: buildArgs(),
        });

      expect(Array.from(covered)).toEqual([
        recommendation(id).recommendationId,
      ]);
    }
  });
});
