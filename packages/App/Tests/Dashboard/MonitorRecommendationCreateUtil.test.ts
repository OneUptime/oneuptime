import MonitorRecommendationCreateUtil, {
  MonitorRecommendationCreatePlanItem,
} from "../../FeatureSet/Dashboard/src/Components/Recommendations/MonitorRecommendationCreateUtil";
import MonitorRecommendationCatalog from "Common/Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import MonitorRecommendationUtil from "Common/Types/Monitor/Recommendation/MonitorRecommendationUtil";
import {
  MonitorRecommendation,
  MonitorRecommendationArgs,
  MonitorRecommendationNotificationMode,
  MonitorRecommendationNotificationSettings,
  MonitorRecommendationResourceType,
  MonitorRecommendationSeverity,
  MonitorRecommendationSeverityMap,
} from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import { CriteriaAlert } from "Common/Types/Monitor/CriteriaAlert";
import { CriteriaIncident } from "Common/Types/Monitor/CriteriaIncident";
import MonitorType from "Common/Types/Monitor/MonitorType";
import Label from "Common/Models/DatabaseModels/Label";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";

/*
 * This util is the last hop before a monitor is POSTed, and two of the things
 * it does are invisible until a real incident fires:
 *
 *   1. It passes the FULL monitor name ("prod-cluster - Node Not Ready") into
 *      the template, not the bare resource name. The templates interpolate
 *      that string into their incident and alert titles, so getting it wrong
 *      produces incidents titled "Node Not Ready - Alert Triggered" with no
 *      indication of which cluster they came from — only noticeable in
 *      production, at 3am, across several clusters.
 *
 *   2. It routes owners through `miscDataProps` rather than model columns,
 *      because monitor owners are junction rows that `MonitorService`
 *      .onCreateSuccess creates from that bag. Putting them on the model
 *      silently drops them.
 */

const ONLINE_STATUS_ID: ObjectID = ObjectID.generate();
const OFFLINE_STATUS_ID: ObjectID = ObjectID.generate();
const DEFAULT_STATUS_ID: ObjectID = ObjectID.generate();
const INCIDENT_SEVERITY_ID: ObjectID = ObjectID.generate();
const ALERT_SEVERITY_ID: ObjectID = ObjectID.generate();

const RESOURCE_IDENTIFIER: string = ObjectID.generate().toString();
const RESOURCE_DISPLAY_NAME: string = "Prod Cluster";

const KUBERNETES_RECOMMENDATIONS: Array<MonitorRecommendation> =
  MonitorRecommendationCatalog.getRecommendations(
    MonitorRecommendationResourceType.Kubernetes,
  );

function buildArgs(): MonitorRecommendationArgs {
  return {
    resourceIdentifier: RESOURCE_IDENTIFIER,
    onlineMonitorStatusId: ONLINE_STATUS_ID,
    offlineMonitorStatusId: OFFLINE_STATUS_ID,
    defaultIncidentSeverityId: INCIDENT_SEVERITY_ID,
    defaultAlertSeverityId: ALERT_SEVERITY_ID,
    monitorName: RESOURCE_DISPLAY_NAME,
  };
}

function buildMonitorWithSteps(steps: Array<MonitorStep>): Monitor {
  const monitor: Monitor = new Monitor();
  const monitorSteps: MonitorSteps = new MonitorSteps();

  monitorSteps.data = {
    monitorStepsInstanceArray: steps,
    defaultMonitorStatusId: DEFAULT_STATUS_ID,
  };

  monitor.monitorSteps = monitorSteps;

  return monitor;
}

function getCriteriaIncidents(monitor: Monitor): Array<CriteriaIncident> {
  const step: MonitorStep | undefined =
    monitor.monitorSteps?.data?.monitorStepsInstanceArray[0];

  return (
    step?.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray || []
  ).flatMap((instance: MonitorCriteriaInstance) => {
    return instance.data?.incidents || [];
  });
}

describe("MonitorRecommendationCreateUtil", () => {
  describe("getExistingMonitorSteps", () => {
    it("flattens the steps of every monitor", () => {
      const stepA: MonitorStep =
        KUBERNETES_RECOMMENDATIONS[0]!.getMonitorStep(buildArgs());
      const stepB: MonitorStep =
        KUBERNETES_RECOMMENDATIONS[1]!.getMonitorStep(buildArgs());

      expect(
        MonitorRecommendationCreateUtil.getExistingMonitorSteps([
          buildMonitorWithSteps([stepA]),
          buildMonitorWithSteps([stepB]),
        ]).length,
      ).toBe(2);
    });

    it("returns every step when one monitor has several", () => {
      const stepA: MonitorStep =
        KUBERNETES_RECOMMENDATIONS[0]!.getMonitorStep(buildArgs());
      const stepB: MonitorStep =
        KUBERNETES_RECOMMENDATIONS[1]!.getMonitorStep(buildArgs());

      expect(
        MonitorRecommendationCreateUtil.getExistingMonitorSteps([
          buildMonitorWithSteps([stepA, stepB]),
        ]).length,
      ).toBe(2);
    });

    it("returns an empty list for no monitors", () => {
      expect(
        MonitorRecommendationCreateUtil.getExistingMonitorSteps([]),
      ).toEqual([]);
    });

    it("skips a monitor with no monitorSteps at all", () => {
      /*
       * A monitor fetched with a select that omitted monitorSteps, or an old
       * row saved before steps existed. Must not throw.
       */
      expect(
        MonitorRecommendationCreateUtil.getExistingMonitorSteps([
          new Monitor(),
        ]),
      ).toEqual([]);
    });

    it("skips a monitor whose monitorSteps carries no data", () => {
      const monitor: Monitor = new Monitor();
      const monitorSteps: MonitorSteps = new MonitorSteps();
      monitorSteps.data = undefined;
      monitor.monitorSteps = monitorSteps;

      expect(
        MonitorRecommendationCreateUtil.getExistingMonitorSteps([monitor]),
      ).toEqual([]);
    });

    it("feeds the covered-recommendation diff end to end", () => {
      // The reason this function exists at all.
      const created: MonitorRecommendation = KUBERNETES_RECOMMENDATIONS[0]!;

      const existingMonitor: Monitor = buildMonitorWithSteps([
        created.getMonitorStep({
          ...buildArgs(),
          monitorName: MonitorRecommendationUtil.getMonitorName({
            recommendation: created,
            resourceDisplayName: RESOURCE_DISPLAY_NAME,
          }),
        }),
      ]);

      const covered: Set<string> =
        MonitorRecommendationUtil.getCoveredRecommendationIds({
          recommendations: KUBERNETES_RECOMMENDATIONS,
          existingMonitorSteps:
            MonitorRecommendationCreateUtil.getExistingMonitorSteps([
              existingMonitor,
            ]),
          args: buildArgs(),
        });

      expect(covered.has(created.recommendationId)).toBe(true);
    });
  });

  describe("buildMiscDataProps", () => {
    it("stringifies owner users and teams", () => {
      const userId: ObjectID = ObjectID.generate();
      const teamId: ObjectID = ObjectID.generate();

      const miscDataProps: JSONObject =
        MonitorRecommendationCreateUtil.buildMiscDataProps({
          ownerUserIds: [userId],
          ownerTeamIds: [teamId],
        });

      expect(miscDataProps["ownerUsers"]).toEqual([userId.toString()]);
      expect(miscDataProps["ownerTeams"]).toEqual([teamId.toString()]);
    });

    it("uses the exact keys MonitorService.onCreateSuccess reads", () => {
      /*
       * These two strings are a wire contract with the server. A typo here
       * silently drops every owner — the monitor is still created, so nothing
       * errors.
       */
      const miscDataProps: JSONObject =
        MonitorRecommendationCreateUtil.buildMiscDataProps({
          ownerUserIds: [ObjectID.generate()],
          ownerTeamIds: [ObjectID.generate()],
        });

      expect(Object.keys(miscDataProps).sort()).toEqual([
        "ownerTeams",
        "ownerUsers",
      ]);
    });

    it("omits keys entirely when nothing was chosen", () => {
      expect(MonitorRecommendationCreateUtil.buildMiscDataProps({})).toEqual(
        {},
      );
    });

    it("omits keys for empty arrays", () => {
      expect(
        MonitorRecommendationCreateUtil.buildMiscDataProps({
          ownerUserIds: [],
          ownerTeamIds: [],
        }),
      ).toEqual({});
    });

    it("carries several owners of each kind", () => {
      const users: Array<ObjectID> = [ObjectID.generate(), ObjectID.generate()];
      const teams: Array<ObjectID> = [
        ObjectID.generate(),
        ObjectID.generate(),
        ObjectID.generate(),
      ];

      const miscDataProps: JSONObject =
        MonitorRecommendationCreateUtil.buildMiscDataProps({
          ownerUserIds: users,
          ownerTeamIds: teams,
        });

      expect(miscDataProps["ownerUsers"]).toHaveLength(2);
      expect(miscDataProps["ownerTeams"]).toHaveLength(3);
    });
  });

  describe("buildMonitor", () => {
    it("names the monitor from the resource and the recommendation", () => {
      const recommendation: MonitorRecommendation =
        KUBERNETES_RECOMMENDATIONS[0]!;

      const monitor: Monitor = MonitorRecommendationCreateUtil.buildMonitor({
        recommendation: recommendation,
        args: buildArgs(),
        resourceDisplayName: RESOURCE_DISPLAY_NAME,
        defaultMonitorStatusId: DEFAULT_STATUS_ID,
        notificationSettings: {},
      });

      expect(monitor.name).toBe(
        `${RESOURCE_DISPLAY_NAME} - ${recommendation.name}`,
      );
    });

    it("sets the monitor type from the recommendation", () => {
      const monitor: Monitor = MonitorRecommendationCreateUtil.buildMonitor({
        recommendation: KUBERNETES_RECOMMENDATIONS[0]!,
        args: buildArgs(),
        resourceDisplayName: RESOURCE_DISPLAY_NAME,
        defaultMonitorStatusId: DEFAULT_STATUS_ID,
        notificationSettings: {},
      });

      expect(monitor.monitorType).toBe(MonitorType.Kubernetes);
    });

    it("interpolates the RESOURCE name into incident titles, not the composed monitor name", () => {
      /*
       * The stuttering production subject line:
       *
       *   [K8s] Pod CPU Saturating Container Limit (>90%)
       *     - oneuptime-test - Pod CPU Saturating Container Limit
       *
       * Every template title already restates the template's own name, and
       * the monitor's name ends with that same template name, so passing the
       * composed name in repeated it. Naming nothing at all would be the
       * opposite failure — an on-call engineer with several clusters could
       * not tell them apart — so the resource must appear exactly ONCE.
       */
      const recommendation: MonitorRecommendation =
        KUBERNETES_RECOMMENDATIONS[0]!;

      const monitor: Monitor = MonitorRecommendationCreateUtil.buildMonitor({
        recommendation: recommendation,
        args: buildArgs(),
        resourceDisplayName: RESOURCE_DISPLAY_NAME,
        defaultMonitorStatusId: DEFAULT_STATUS_ID,
        notificationSettings: {},
      });

      const incidents: Array<CriteriaIncident> = getCriteriaIncidents(monitor);
      expect(incidents.length).toBeGreaterThan(0);

      for (const incident of incidents) {
        const title: string = incident.title!;

        // The resource is still named — exactly once.
        expect(title).toContain(RESOURCE_DISPLAY_NAME);
        expect(title.split(RESOURCE_DISPLAY_NAME).length - 1).toBe(1);

        /*
         * And the template name is not repeated after it. This is the
         * assertion that fails if the composed monitor name is passed back
         * in: the title would end "- <resource> - <template name>".
         */
        expect(title).not.toContain(
          `${RESOURCE_DISPLAY_NAME} - ${recommendation.name}`,
        );
      }
    });

    it("still names the monitor itself with the composed name", () => {
      /*
       * The monitor's own name is deliberately NOT what the templates
       * interpolate. It keeps the composed form so the monitors list stays
       * readable — this is the half of the fix that is easy to over-apply.
       */
      const recommendation: MonitorRecommendation =
        KUBERNETES_RECOMMENDATIONS[0]!;

      const monitor: Monitor = MonitorRecommendationCreateUtil.buildMonitor({
        recommendation: recommendation,
        args: buildArgs(),
        resourceDisplayName: RESOURCE_DISPLAY_NAME,
        defaultMonitorStatusId: DEFAULT_STATUS_ID,
        notificationSettings: {},
      });

      expect(monitor.name).toBe(
        `${RESOURCE_DISPLAY_NAME} - ${recommendation.name}`,
      );
    });

    it("falls back to the composed name when the resource has no display name", () => {
      // Otherwise a title would end in a bare " - ".
      const recommendation: MonitorRecommendation =
        KUBERNETES_RECOMMENDATIONS[0]!;

      expect(
        MonitorRecommendationUtil.getTemplateMonitorName({
          recommendation: recommendation,
          resourceDisplayName: "   ",
        }),
      ).toBe(recommendation.name);
    });

    it("produces monitorSteps that pass validation for every recommendation", () => {
      for (const recommendation of KUBERNETES_RECOMMENDATIONS) {
        const monitor: Monitor = MonitorRecommendationCreateUtil.buildMonitor({
          recommendation: recommendation,
          args: buildArgs(),
          resourceDisplayName: RESOURCE_DISPLAY_NAME,
          defaultMonitorStatusId: DEFAULT_STATUS_ID,
          notificationSettings: {},
        });

        expect(
          MonitorSteps.getValidationError(
            monitor.monitorSteps!,
            recommendation.monitorType,
          ),
        ).toBeNull();
      }
    });

    it("applies on-call policies to the created criteria", () => {
      const policyId: ObjectID = ObjectID.generate();

      const monitor: Monitor = MonitorRecommendationCreateUtil.buildMonitor({
        recommendation: KUBERNETES_RECOMMENDATIONS[0]!,
        args: buildArgs(),
        resourceDisplayName: RESOURCE_DISPLAY_NAME,
        defaultMonitorStatusId: DEFAULT_STATUS_ID,
        notificationSettings: { onCallPolicyIds: [policyId] },
      });

      for (const incident of getCriteriaIncidents(monitor)) {
        expect(incident.onCallPolicyIds).toEqual([policyId]);
      }
    });

    it("attaches labels to the monitor itself, as Label entities", () => {
      const labelId: ObjectID = ObjectID.generate();

      const monitor: Monitor = MonitorRecommendationCreateUtil.buildMonitor({
        recommendation: KUBERNETES_RECOMMENDATIONS[0]!,
        args: buildArgs(),
        resourceDisplayName: RESOURCE_DISPLAY_NAME,
        defaultMonitorStatusId: DEFAULT_STATUS_ID,
        notificationSettings: { labelIds: [labelId] },
      });

      // labels is an EntityArray column, so ids alone would not serialize.
      expect(monitor.labels).toHaveLength(1);
      expect(monitor.labels![0]).toBeInstanceOf(Label);
      expect(monitor.labels![0]!.id?.toString()).toBe(labelId.toString());
    });

    it("leaves labels unset when none were chosen", () => {
      const monitor: Monitor = MonitorRecommendationCreateUtil.buildMonitor({
        recommendation: KUBERNETES_RECOMMENDATIONS[0]!,
        args: buildArgs(),
        resourceDisplayName: RESOURCE_DISPLAY_NAME,
        defaultMonitorStatusId: DEFAULT_STATUS_ID,
        notificationSettings: { labelIds: [] },
      });

      expect(monitor.labels).toBeUndefined();
    });

    it("gives the monitor the recommendation's description", () => {
      const recommendation: MonitorRecommendation =
        KUBERNETES_RECOMMENDATIONS[0]!;

      const monitor: Monitor = MonitorRecommendationCreateUtil.buildMonitor({
        recommendation: recommendation,
        args: buildArgs(),
        resourceDisplayName: RESOURCE_DISPLAY_NAME,
        defaultMonitorStatusId: DEFAULT_STATUS_ID,
        notificationSettings: {},
      });

      expect(monitor.description).toBe(recommendation.description);
    });

    it("does not set projectId — the server stamps it from the tenant header", () => {
      const monitor: Monitor = MonitorRecommendationCreateUtil.buildMonitor({
        recommendation: KUBERNETES_RECOMMENDATIONS[0]!,
        args: buildArgs(),
        resourceDisplayName: RESOURCE_DISPLAY_NAME,
        defaultMonitorStatusId: DEFAULT_STATUS_ID,
        notificationSettings: {},
      });

      expect(monitor.projectId).toBeUndefined();
    });

    it("works for every resource type in the catalog", () => {
      for (const definition of MonitorRecommendationCatalog.getResourceTypeDefinitions()) {
        const recommendation: MonitorRecommendation =
          definition.getRecommendations()[0]!;

        const monitor: Monitor = MonitorRecommendationCreateUtil.buildMonitor({
          recommendation: recommendation,
          args: buildArgs(),
          resourceDisplayName: RESOURCE_DISPLAY_NAME,
          defaultMonitorStatusId: DEFAULT_STATUS_ID,
          notificationSettings: {},
        });

        expect(monitor.monitorType).toBe(recommendation.monitorType);
        expect(definition.monitorTypes).toContain(recommendation.monitorType);
        expect(
          MonitorSteps.getValidationError(
            monitor.monitorSteps!,
            recommendation.monitorType,
          ),
        ).toBeNull();
      }
    });
  });

  describe("buildCreatePlan", () => {
    it("builds one plan item per selected recommendation, in selection order", () => {
      const selected: Array<string> = [
        KUBERNETES_RECOMMENDATIONS[2]!.recommendationId,
        KUBERNETES_RECOMMENDATIONS[0]!.recommendationId,
      ];

      const plan: Array<MonitorRecommendationCreatePlanItem> =
        MonitorRecommendationCreateUtil.buildCreatePlan({
          recommendations: KUBERNETES_RECOMMENDATIONS,
          selectedRecommendationIds: selected,
          args: buildArgs(),
          resourceDisplayName: RESOURCE_DISPLAY_NAME,
          defaultMonitorStatusId: DEFAULT_STATUS_ID,
          notificationSettings: {},
        });

      expect(
        plan.map((item: MonitorRecommendationCreatePlanItem) => {
          return item.recommendation.recommendationId;
        }),
      ).toEqual(selected);
    });

    it("returns an empty plan for an empty selection", () => {
      expect(
        MonitorRecommendationCreateUtil.buildCreatePlan({
          recommendations: KUBERNETES_RECOMMENDATIONS,
          selectedRecommendationIds: [],
          args: buildArgs(),
          resourceDisplayName: RESOURCE_DISPLAY_NAME,
          defaultMonitorStatusId: DEFAULT_STATUS_ID,
          notificationSettings: {},
        }),
      ).toEqual([]);
    });

    it("skips unknown recommendation ids instead of throwing", () => {
      /*
       * Stale React state — e.g. a template removed by a deploy while the page
       * was open — must not block creating the rest of the batch.
       */
      const plan: Array<MonitorRecommendationCreatePlanItem> =
        MonitorRecommendationCreateUtil.buildCreatePlan({
          recommendations: KUBERNETES_RECOMMENDATIONS,
          selectedRecommendationIds: [
            "Kubernetes:this-template-was-deleted",
            KUBERNETES_RECOMMENDATIONS[0]!.recommendationId,
          ],
          args: buildArgs(),
          resourceDisplayName: RESOURCE_DISPLAY_NAME,
          defaultMonitorStatusId: DEFAULT_STATUS_ID,
          notificationSettings: {},
        });

      expect(plan).toHaveLength(1);
      expect(plan[0]!.recommendation.recommendationId).toBe(
        KUBERNETES_RECOMMENDATIONS[0]!.recommendationId,
      );
    });

    it("gives every plan item the same owner miscDataProps", () => {
      const userId: ObjectID = ObjectID.generate();

      const plan: Array<MonitorRecommendationCreatePlanItem> =
        MonitorRecommendationCreateUtil.buildCreatePlan({
          recommendations: KUBERNETES_RECOMMENDATIONS,
          selectedRecommendationIds: KUBERNETES_RECOMMENDATIONS.slice(0, 3).map(
            (recommendation: MonitorRecommendation) => {
              return recommendation.recommendationId;
            },
          ),
          args: buildArgs(),
          resourceDisplayName: RESOURCE_DISPLAY_NAME,
          defaultMonitorStatusId: DEFAULT_STATUS_ID,
          notificationSettings: { ownerUserIds: [userId] },
        });

      expect(plan).toHaveLength(3);
      for (const item of plan) {
        expect(item.miscDataProps["ownerUsers"]).toEqual([userId.toString()]);
      }
    });

    it("gives each plan item its own distinct monitor", () => {
      const plan: Array<MonitorRecommendationCreatePlanItem> =
        MonitorRecommendationCreateUtil.buildCreatePlan({
          recommendations: KUBERNETES_RECOMMENDATIONS,
          selectedRecommendationIds: KUBERNETES_RECOMMENDATIONS.slice(0, 3).map(
            (recommendation: MonitorRecommendation) => {
              return recommendation.recommendationId;
            },
          ),
          args: buildArgs(),
          resourceDisplayName: RESOURCE_DISPLAY_NAME,
          defaultMonitorStatusId: DEFAULT_STATUS_ID,
          notificationSettings: {},
        });

      const names: Array<string> = plan.map(
        (item: MonitorRecommendationCreatePlanItem) => {
          return item.monitor.name!;
        },
      );

      expect(new Set(names).size).toBe(3);
      expect(plan[0]!.monitor).not.toBe(plan[1]!.monitor);
    });
  });

  describe("getCreatableSelection", () => {
    it("drops selections that are already covered", () => {
      expect(
        MonitorRecommendationCreateUtil.getCreatableSelection({
          selectedRecommendationIds: ["a", "b", "c"],
          coveredRecommendationIds: new Set<string>(["b"]),
        }),
      ).toEqual(["a", "c"]);
    });

    it("keeps everything when nothing is covered", () => {
      expect(
        MonitorRecommendationCreateUtil.getCreatableSelection({
          selectedRecommendationIds: ["a", "b"],
          coveredRecommendationIds: new Set<string>(),
        }),
      ).toEqual(["a", "b"]);
    });

    it("returns nothing when everything is covered", () => {
      /*
       * The race this guards: another tab created the same monitors while this
       * page was open. Re-POSTing would silently duplicate them.
       */
      expect(
        MonitorRecommendationCreateUtil.getCreatableSelection({
          selectedRecommendationIds: ["a", "b"],
          coveredRecommendationIds: new Set<string>(["a", "b"]),
        }),
      ).toEqual([]);
    });

    it("preserves selection order", () => {
      expect(
        MonitorRecommendationCreateUtil.getCreatableSelection({
          selectedRecommendationIds: ["c", "a", "b"],
          coveredRecommendationIds: new Set<string>(),
        }),
      ).toEqual(["c", "a", "b"]);
    });
  });
});

/*
 * Everything above is about the recommendation's own content surviving into
 * the monitor. The block below is about the two things the CREATE FORM
 * contributes on top of it. Both are invisible when they break, and both break
 * in the same way — by being collected in the side-over and then dropped, or
 * flattened, somewhere on the way to the monitor that gets POSTed:
 *
 *   1. The Alert / Incident / Both choice is not cosmetic. `MonitorAlert` and
 *      `MonitorIncident` each early-return unless `createAlerts` /
 *      `createIncidents` is true on the criteria instance, so those two flags
 *      are the entire mechanism. Every shipped template hardcodes BOTH to
 *      true. If the chosen mode never reached `buildCreatePlan` the create
 *      would still succeed and the monitor would still look right in the UI —
 *      the user learns about it the first time one threshold breach opens an
 *      incident AND an alert saying the same thing, two records to resolve and
 *      two notification fan-outs, which is precisely what the control exists
 *      to stop.
 *
 *   2. The Critical -> ? / Warning -> ? mapping has to be applied PER
 *      RECOMMENDATION. The bug it replaced was one `defaultIncidentSeverityId`
 *      for the whole batch, so a Warning template paged exactly as loudly as a
 *      Critical one and the severity badge on the card described nothing that
 *      happened afterwards. An implementation that builds the map correctly
 *      and then applies one entry of it to every monitor reproduces that bug
 *      while looking entirely correct in the form — so the assertions here are
 *      per plan item, keyed on that item's own recommendation severity, over a
 *      plan that deliberately mixes both severities.
 */

const ALL_NOTIFICATION_MODES: Array<MonitorRecommendationNotificationMode> = [
  MonitorRecommendationNotificationMode.Alert,
  MonitorRecommendationNotificationMode.Incident,
  MonitorRecommendationNotificationMode.Both,
];

const ALL_KUBERNETES_RECOMMENDATION_IDS: Array<string> =
  KUBERNETES_RECOMMENDATIONS.map((recommendation: MonitorRecommendation) => {
    return recommendation.recommendationId;
  });

interface PlanItemSummary {
  name: string;
  monitorType: MonitorType;
  labelIds: Array<string>;
  ownerUsers: Array<string>;
  ownerTeams: Array<string>;
}

function buildPlan(data: {
  selectedRecommendationIds: Array<string>;
  notificationSettings: MonitorRecommendationNotificationSettings;
}): Array<MonitorRecommendationCreatePlanItem> {
  return MonitorRecommendationCreateUtil.buildCreatePlan({
    recommendations: KUBERNETES_RECOMMENDATIONS,
    selectedRecommendationIds: data.selectedRecommendationIds,
    args: buildArgs(),
    resourceDisplayName: RESOURCE_DISPLAY_NAME,
    defaultMonitorStatusId: DEFAULT_STATUS_ID,
    notificationSettings: data.notificationSettings,
  });
}

function getCriteriaInstances(
  monitor: Monitor,
): Array<MonitorCriteriaInstance> {
  return (monitor.monitorSteps?.data?.monitorStepsInstanceArray || []).flatMap(
    (step: MonitorStep) => {
      return (
        step.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray || []
      );
    },
  );
}

/*
 * Only the criteria instances that describe a breach.
 *
 * Every template also ships a "Healthy" recovery criteria carrying no
 * incidents and no alerts, and `applyNotificationModeToCriteriaInstance`
 * deliberately leaves its flags alone (flipping `createIncidents` on a
 * recovery criteria would make the auto-resolve path treat it as contributing
 * breaches). Filtering it out here means an assertion like "createIncidents is
 * false in Alert mode" cannot be satisfied by the criteria that was already
 * false to begin with.
 */
function getUnhealthyCriteriaInstances(
  monitor: Monitor,
): Array<MonitorCriteriaInstance> {
  return getCriteriaInstances(monitor).filter(
    (instance: MonitorCriteriaInstance) => {
      return (
        (instance.data?.incidents || []).length > 0 ||
        (instance.data?.alerts || []).length > 0
      );
    },
  );
}

function getAllCriteriaIncidents(monitor: Monitor): Array<CriteriaIncident> {
  return getCriteriaInstances(monitor).flatMap(
    (instance: MonitorCriteriaInstance) => {
      return instance.data?.incidents || [];
    },
  );
}

function getAllCriteriaAlerts(monitor: Monitor): Array<CriteriaAlert> {
  return getCriteriaInstances(monitor).flatMap(
    (instance: MonitorCriteriaInstance) => {
      return instance.data?.alerts || [];
    },
  );
}

/*
 * A real recommendation of the given severity, taken out of the catalog rather
 * than named. Naming one ("Node Not Ready") would turn a template being
 * renamed or recategorized into a failure of these tests, which are about the
 * severity mapping and not about any particular template.
 */
function findKubernetesRecommendationBySeverity(
  severity: MonitorRecommendationSeverity,
): MonitorRecommendation {
  const recommendation: MonitorRecommendation | undefined =
    KUBERNETES_RECOMMENDATIONS.find((candidate: MonitorRecommendation) => {
      return candidate.severity === severity;
    });

  if (!recommendation) {
    throw new Error(
      `The Kubernetes catalog ships no ${severity} recommendation, so the severity mapping cannot be exercised.`,
    );
  }

  return recommendation;
}

/*
 * The parts of a plan that the notification mode has no business touching.
 */
function summarizePlan(
  plan: Array<MonitorRecommendationCreatePlanItem>,
): Array<PlanItemSummary> {
  return plan.map((item: MonitorRecommendationCreatePlanItem) => {
    return {
      name: item.monitor.name!,
      monitorType: item.monitor.monitorType!,
      labelIds: (item.monitor.labels || []).map((label: Label) => {
        return label.id!.toString();
      }),
      ownerUsers: (item.miscDataProps["ownerUsers"] || []) as Array<string>,
      ownerTeams: (item.miscDataProps["ownerTeams"] || []) as Array<string>,
    };
  });
}

describe("MonitorRecommendationCreateUtil notification mode and severity mapping", () => {
  describe("notificationMode", () => {
    it("arms alerts and disarms incidents on every monitor in Alert mode", () => {
      const plan: Array<MonitorRecommendationCreatePlanItem> = buildPlan({
        selectedRecommendationIds: ALL_KUBERNETES_RECOMMENDATION_IDS,
        notificationSettings: {
          notificationMode: MonitorRecommendationNotificationMode.Alert,
        },
      });

      expect(plan).toHaveLength(KUBERNETES_RECOMMENDATIONS.length);

      for (const item of plan) {
        const unhealthyCriteria: Array<MonitorCriteriaInstance> =
          getUnhealthyCriteriaInstances(item.monitor);

        expect(unhealthyCriteria.length).toBeGreaterThan(0);

        for (const criteriaInstance of unhealthyCriteria) {
          expect(criteriaInstance.data!.createAlerts).toBe(true);
          expect(criteriaInstance.data!.createIncidents).toBe(false);
        }
      }
    });

    it("arms incidents and disarms alerts on every monitor in Incident mode", () => {
      const plan: Array<MonitorRecommendationCreatePlanItem> = buildPlan({
        selectedRecommendationIds: ALL_KUBERNETES_RECOMMENDATION_IDS,
        notificationSettings: {
          notificationMode: MonitorRecommendationNotificationMode.Incident,
        },
      });

      expect(plan).toHaveLength(KUBERNETES_RECOMMENDATIONS.length);

      for (const item of plan) {
        const unhealthyCriteria: Array<MonitorCriteriaInstance> =
          getUnhealthyCriteriaInstances(item.monitor);

        expect(unhealthyCriteria.length).toBeGreaterThan(0);

        for (const criteriaInstance of unhealthyCriteria) {
          expect(criteriaInstance.data!.createIncidents).toBe(true);
          expect(criteriaInstance.data!.createAlerts).toBe(false);
        }
      }
    });

    it("arms both on every monitor in Both mode", () => {
      const plan: Array<MonitorRecommendationCreatePlanItem> = buildPlan({
        selectedRecommendationIds: ALL_KUBERNETES_RECOMMENDATION_IDS,
        notificationSettings: {
          notificationMode: MonitorRecommendationNotificationMode.Both,
        },
      });

      expect(plan).toHaveLength(KUBERNETES_RECOMMENDATIONS.length);

      for (const item of plan) {
        const unhealthyCriteria: Array<MonitorCriteriaInstance> =
          getUnhealthyCriteriaInstances(item.monitor);

        expect(unhealthyCriteria.length).toBeGreaterThan(0);

        for (const criteriaInstance of unhealthyCriteria) {
          expect(criteriaInstance.data!.createIncidents).toBe(true);
          expect(criteriaInstance.data!.createAlerts).toBe(true);
        }
      }
    });

    it("keeps the incident and alert config on the monitor in the mode that did not win", () => {
      /*
       * Alert mode switches incidents OFF, it does not delete them. A user who
       * later decides they do want incidents flips one toggle on the monitor
       * instead of re-authoring the incident title, description and severity —
       * and the criteria would fail validation if the config were half-removed.
       */
      const plan: Array<MonitorRecommendationCreatePlanItem> = buildPlan({
        selectedRecommendationIds: [
          KUBERNETES_RECOMMENDATIONS[0]!.recommendationId,
        ],
        notificationSettings: {
          notificationMode: MonitorRecommendationNotificationMode.Alert,
        },
      });

      const incidents: Array<CriteriaIncident> = getAllCriteriaIncidents(
        plan[0]!.monitor,
      );

      expect(incidents.length).toBeGreaterThan(0);

      for (const incident of incidents) {
        expect(incident.title).toBeTruthy();
        expect(incident.description).toBeTruthy();
        expect(incident.incidentSeverityId).toBeTruthy();
      }
    });
  });

  describe("severity mapping", () => {
    it("gives each monitor the project severity chosen for ITS recommendation's severity", () => {
      const criticalRecommendation: MonitorRecommendation =
        findKubernetesRecommendationBySeverity("Critical");
      const warningRecommendation: MonitorRecommendation =
        findKubernetesRecommendationBySeverity("Warning");

      const criticalIncidentSeverityId: ObjectID = ObjectID.generate();
      const warningIncidentSeverityId: ObjectID = ObjectID.generate();
      const criticalAlertSeverityId: ObjectID = ObjectID.generate();
      const warningAlertSeverityId: ObjectID = ObjectID.generate();

      const incidentSeverityMap: MonitorRecommendationSeverityMap = {
        Critical: criticalIncidentSeverityId,
        Warning: warningIncidentSeverityId,
      };

      const alertSeverityMap: MonitorRecommendationSeverityMap = {
        Critical: criticalAlertSeverityId,
        Warning: warningAlertSeverityId,
      };

      const plan: Array<MonitorRecommendationCreatePlanItem> = buildPlan({
        selectedRecommendationIds: [
          criticalRecommendation.recommendationId,
          warningRecommendation.recommendationId,
        ],
        notificationSettings: {
          notificationMode: MonitorRecommendationNotificationMode.Both,
          incidentSeverityIdBySeverity: incidentSeverityMap,
          alertSeverityIdBySeverity: alertSeverityMap,
        },
      });

      expect(plan).toHaveLength(2);

      for (const item of plan) {
        const expectedIncidentSeverityId: ObjectID =
          incidentSeverityMap[item.recommendation.severity]!;
        const expectedAlertSeverityId: ObjectID =
          alertSeverityMap[item.recommendation.severity]!;

        const incidents: Array<CriteriaIncident> = getAllCriteriaIncidents(
          item.monitor,
        );
        const alerts: Array<CriteriaAlert> = getAllCriteriaAlerts(item.monitor);

        expect(incidents.length).toBeGreaterThan(0);
        expect(alerts.length).toBeGreaterThan(0);

        for (const incident of incidents) {
          expect(incident.incidentSeverityId?.toString()).toBe(
            expectedIncidentSeverityId.toString(),
          );
        }

        for (const alert of alerts) {
          expect(alert.alertSeverityId?.toString()).toBe(
            expectedAlertSeverityId.toString(),
          );
        }
      }

      /*
       * The plan mixed severities on purpose: the whole failure mode being
       * pinned is one severity applied uniformly to the batch, which would
       * make these two monitors identical here.
       */
      expect(plan[0]!.recommendation.severity).not.toBe(
        plan[1]!.recommendation.severity,
      );
      expect(
        getAllCriteriaIncidents(
          plan[0]!.monitor,
        )[0]!.incidentSeverityId?.toString(),
      ).not.toBe(
        getAllCriteriaIncidents(
          plan[1]!.monitor,
        )[0]!.incidentSeverityId?.toString(),
      );
    });

    it("leaves the template's own severity in place for a severity the map does not cover", () => {
      /*
       * A project that defines only one severity produces a partial map. The
       * unmapped recommendations must keep the severity the template already
       * put there — writing `undefined` instead would fail
       * `MonitorCriteriaInstance.getValidationError` ("Incident severity is
       * required") and the whole batch create would be rejected.
       */
      const warningRecommendation: MonitorRecommendation =
        findKubernetesRecommendationBySeverity("Warning");

      const plan: Array<MonitorRecommendationCreatePlanItem> = buildPlan({
        selectedRecommendationIds: [warningRecommendation.recommendationId],
        notificationSettings: {
          notificationMode: MonitorRecommendationNotificationMode.Both,
          incidentSeverityIdBySeverity: { Critical: ObjectID.generate() },
          alertSeverityIdBySeverity: { Critical: ObjectID.generate() },
        },
      });

      const incidents: Array<CriteriaIncident> = getAllCriteriaIncidents(
        plan[0]!.monitor,
      );

      expect(incidents.length).toBeGreaterThan(0);

      for (const incident of incidents) {
        expect(incident.incidentSeverityId?.toString()).toBe(
          INCIDENT_SEVERITY_ID.toString(),
        );
      }

      expect(
        MonitorSteps.getValidationError(
          plan[0]!.monitor.monitorSteps!,
          plan[0]!.recommendation.monitorType,
        ),
      ).toBeNull();
    });
  });

  describe("on-call policies under each mode", () => {
    it("routes the chosen policy onto the record the mode will actually create", () => {
      /*
       * The two halves have to agree. A policy written onto the incidents of a
       * monitor created in Alert mode pages nobody, because `createIncidents`
       * is false — so this asserts the policy AND the flag together, per mode,
       * rather than trusting that "the settings were applied".
       */
      const policyId: ObjectID = ObjectID.generate();

      for (const notificationMode of ALL_NOTIFICATION_MODES) {
        const plan: Array<MonitorRecommendationCreatePlanItem> = buildPlan({
          selectedRecommendationIds: ALL_KUBERNETES_RECOMMENDATION_IDS,
          notificationSettings: {
            notificationMode: notificationMode,
            onCallPolicyIds: [policyId],
          },
        });

        const shouldPageViaIncidents: boolean =
          notificationMode === MonitorRecommendationNotificationMode.Incident ||
          notificationMode === MonitorRecommendationNotificationMode.Both;

        const shouldPageViaAlerts: boolean =
          notificationMode === MonitorRecommendationNotificationMode.Alert ||
          notificationMode === MonitorRecommendationNotificationMode.Both;

        let pagingRecordCount: number = 0;

        for (const item of plan) {
          for (const criteriaInstance of getUnhealthyCriteriaInstances(
            item.monitor,
          )) {
            if (shouldPageViaIncidents) {
              expect(criteriaInstance.data!.createIncidents).toBe(true);

              for (const incident of criteriaInstance.data!.incidents) {
                expect(incident.onCallPolicyIds).toEqual([policyId]);
                pagingRecordCount++;
              }
            }

            if (shouldPageViaAlerts) {
              expect(criteriaInstance.data!.createAlerts).toBe(true);

              for (const alert of criteriaInstance.data!.alerts) {
                expect(alert.onCallPolicyIds).toEqual([policyId]);
                pagingRecordCount++;
              }
            }
          }
        }

        expect(pagingRecordCount).toBeGreaterThan(0);
      }
    });
  });

  describe("validation under every mode", () => {
    it("produces monitorSteps that still validate for every recommendation in every mode", () => {
      /*
       * `MonitorSteps.getValidationError` is what the create form checks before
       * POSTing, so anything the mode or the severity map breaks here shows up
       * as "Create Monitors" failing on a batch the user already configured.
       */
      const incidentSeverityMap: MonitorRecommendationSeverityMap = {
        Critical: ObjectID.generate(),
        Warning: ObjectID.generate(),
      };

      const alertSeverityMap: MonitorRecommendationSeverityMap = {
        Critical: ObjectID.generate(),
        Warning: ObjectID.generate(),
      };

      for (const notificationMode of ALL_NOTIFICATION_MODES) {
        const plan: Array<MonitorRecommendationCreatePlanItem> = buildPlan({
          selectedRecommendationIds: ALL_KUBERNETES_RECOMMENDATION_IDS,
          notificationSettings: {
            notificationMode: notificationMode,
            incidentSeverityIdBySeverity: incidentSeverityMap,
            alertSeverityIdBySeverity: alertSeverityMap,
          },
        });

        expect(plan).toHaveLength(KUBERNETES_RECOMMENDATIONS.length);

        for (const item of plan) {
          expect(
            MonitorSteps.getValidationError(
              item.monitor.monitorSteps!,
              item.recommendation.monitorType,
            ),
          ).toBeNull();
        }
      }
    });
  });

  describe("the rest of the plan is mode-independent", () => {
    it("leaves names, monitor types, labels and owner miscDataProps identical under every mode", () => {
      /*
       * Regression guard for the change that introduced the mode: it lives on
       * the same settings object as owners, labels and on-call policies, and
       * threading it through `buildCreatePlan` touched the same call path. If
       * adding it disturbed any of those, the monitors would still be created
       * and would still fire — they would just be unowned, unlabelled, or
       * named after the wrong thing.
       */
      const userId: ObjectID = ObjectID.generate();
      const teamId: ObjectID = ObjectID.generate();
      const labelId: ObjectID = ObjectID.generate();

      function buildSummaryForMode(
        notificationMode: MonitorRecommendationNotificationMode | undefined,
      ): Array<PlanItemSummary> {
        return summarizePlan(
          buildPlan({
            selectedRecommendationIds: ALL_KUBERNETES_RECOMMENDATION_IDS,
            notificationSettings: {
              notificationMode: notificationMode,
              ownerUserIds: [userId],
              ownerTeamIds: [teamId],
              labelIds: [labelId],
            },
          }),
        );
      }

      const baseline: Array<PlanItemSummary> = buildSummaryForMode(
        MonitorRecommendationNotificationMode.Alert,
      );

      // The comparison is only worth anything if the summary is populated.
      expect(baseline).toHaveLength(KUBERNETES_RECOMMENDATIONS.length);
      expect(baseline[0]!.name).toBe(
        `${RESOURCE_DISPLAY_NAME} - ${KUBERNETES_RECOMMENDATIONS[0]!.name}`,
      );
      expect(baseline[0]!.monitorType).toBe(MonitorType.Kubernetes);
      expect(baseline[0]!.labelIds).toEqual([labelId.toString()]);
      expect(baseline[0]!.ownerUsers).toEqual([userId.toString()]);
      expect(baseline[0]!.ownerTeams).toEqual([teamId.toString()]);

      expect(
        buildSummaryForMode(MonitorRecommendationNotificationMode.Incident),
      ).toEqual(baseline);
      expect(
        buildSummaryForMode(MonitorRecommendationNotificationMode.Both),
      ).toEqual(baseline);

      /*
       * Undefined is a distinct state from `Both` — a caller that never learned
       * about the field keeps the templates untouched — but it must not change
       * anything outside the two flags either.
       */
      expect(buildSummaryForMode(undefined)).toEqual(baseline);
    });
  });
});
