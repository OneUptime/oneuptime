import MonitorRecommendationCreateUtil, {
  MonitorRecommendationCreatePlanItem,
} from "../../FeatureSet/Dashboard/src/Components/MonitorRecommendations/MonitorRecommendationCreateUtil";
import MonitorRecommendationCatalog from "Common/Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import MonitorRecommendationUtil from "Common/Types/Monitor/Recommendation/MonitorRecommendationUtil";
import {
  MonitorRecommendation,
  MonitorRecommendationArgs,
  MonitorRecommendationResourceType,
} from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
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

const RESOURCE_IDENTIFIER: string = "prod-cluster-01";
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

    it("interpolates the FULL monitor name into incident titles", () => {
      /*
       * The bug this pins: passing the bare resource name would title every
       * incident after the resource, and passing the bare recommendation name
       * would title it after the check with no resource — either way, an
       * on-call engineer with several clusters cannot tell them apart.
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
        expect(incident.title).toContain(RESOURCE_DISPLAY_NAME);
        expect(incident.title).toContain(recommendation.name);
      }
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

        expect(monitor.monitorType).toBe(definition.monitorType);
        expect(
          MonitorSteps.getValidationError(
            monitor.monitorSteps!,
            definition.monitorType,
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
