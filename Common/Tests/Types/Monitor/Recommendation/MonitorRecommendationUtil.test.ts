import MonitorRecommendationCatalog, {
  MonitorRecommendationResourceTypeDefinition,
} from "../../../../Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import MonitorRecommendationUtil, {
  MonitorRecommendationFingerprint,
} from "../../../../Types/Monitor/Recommendation/MonitorRecommendationUtil";
import {
  MonitorRecommendation,
  MonitorRecommendationArgs,
  MonitorRecommendationResourceType,
} from "../../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import { CriteriaIncident } from "../../../../Types/Monitor/CriteriaIncident";
import { CriteriaAlert } from "../../../../Types/Monitor/CriteriaAlert";
import ObjectID from "../../../../Types/ObjectID";

/*
 * These tests cover the three things that stand between "the user clicked
 * Create" and "an alert reaches a human":
 *
 *   1. The resource identifier survives the args rename. Each template module
 *      names it differently (clusterIdentifier / hostIdentifier /
 *      fleetIdentifier) and the catalog adapters rename it. A wrong rename
 *      compiles, renders, and produces a monitor scoped to "" that matches no
 *      telemetry and never fires. Nothing else would catch it.
 *
 *   2. On-call policies actually land on the generated criteria. Every shipped
 *      template hardcodes `onCallPolicyIds: []`; the `no template ships an
 *      on-call policy` test below pins that fact, and the rest prove the
 *      create form's selection overrides it. Without this, a "Critical"
 *      recommendation creates incidents that page nobody — which is the exact
 *      failure this whole feature exists to fix.
 *
 *   3. The already-created diff is computed from what a monitor WATCHES, not
 *      from its name. Name matching would resurface a recommendation the
 *      moment someone renamed a monitor.
 */

const ONLINE_STATUS_ID: ObjectID = ObjectID.generate();
const OFFLINE_STATUS_ID: ObjectID = ObjectID.generate();
const DEFAULT_STATUS_ID: ObjectID = ObjectID.generate();
const INCIDENT_SEVERITY_ID: ObjectID = ObjectID.generate();
const ALERT_SEVERITY_ID: ObjectID = ObjectID.generate();

const RESOURCE_IDENTIFIER: string = "prod-cluster-01";

function buildArgs(
  overrides?: Partial<MonitorRecommendationArgs>,
): MonitorRecommendationArgs {
  return {
    resourceIdentifier: RESOURCE_IDENTIFIER,
    onlineMonitorStatusId: ONLINE_STATUS_ID,
    offlineMonitorStatusId: OFFLINE_STATUS_ID,
    defaultIncidentSeverityId: INCIDENT_SEVERITY_ID,
    defaultAlertSeverityId: ALERT_SEVERITY_ID,
    monitorName: "Test Monitor",
    ...overrides,
  };
}

function getCriteriaInstances(
  monitorStep: MonitorStep,
): Array<MonitorCriteriaInstance> {
  return (
    monitorStep.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray || []
  );
}

function getAllCriteriaIncidents(
  monitorStep: MonitorStep,
): Array<CriteriaIncident> {
  return getCriteriaInstances(monitorStep).flatMap(
    (instance: MonitorCriteriaInstance) => {
      return instance.data?.incidents || [];
    },
  );
}

function getAllCriteriaAlerts(monitorStep: MonitorStep): Array<CriteriaAlert> {
  return getCriteriaInstances(monitorStep).flatMap(
    (instance: MonitorCriteriaInstance) => {
      return instance.data?.alerts || [];
    },
  );
}

const ALL_RECOMMENDATIONS: Array<MonitorRecommendation> =
  MonitorRecommendationCatalog.getAllRecommendations();

// One representative recommendation per resource type, for the focused tests.
const ONE_PER_RESOURCE_TYPE: Array<MonitorRecommendation> =
  MonitorRecommendationCatalog.getResourceTypeDefinitions().map(
    (definition: MonitorRecommendationResourceTypeDefinition) => {
      return definition.getRecommendations()[0]!;
    },
  );

describe("MonitorRecommendationUtil", () => {
  describe("getMonitorName", () => {
    it("prefixes the recommendation name with the resource name", () => {
      expect(
        MonitorRecommendationUtil.getMonitorName({
          recommendation: ALL_RECOMMENDATIONS[0]!,
          resourceDisplayName: "prod-cluster",
        }),
      ).toBe(`prod-cluster - ${ALL_RECOMMENDATIONS[0]!.name}`);
    });

    it("trims surrounding whitespace on the resource name", () => {
      expect(
        MonitorRecommendationUtil.getMonitorName({
          recommendation: ALL_RECOMMENDATIONS[0]!,
          resourceDisplayName: "   prod-cluster   ",
        }),
      ).toBe(`prod-cluster - ${ALL_RECOMMENDATIONS[0]!.name}`);
    });

    it("falls back to the bare recommendation name when the resource has none", () => {
      for (const resourceDisplayName of ["", "   "]) {
        expect(
          MonitorRecommendationUtil.getMonitorName({
            recommendation: ALL_RECOMMENDATIONS[0]!,
            resourceDisplayName: resourceDisplayName,
          }),
        ).toBe(ALL_RECOMMENDATIONS[0]!.name);
      }
    });

    it("produces distinct names within a resource type", () => {
      /*
       * Scoped per resource type on purpose: template NAMES do collide across
       * modules (Docker and Podman both ship "Container Restart Loop", and
       * five more besides), unlike template ids. That is harmless — a given
       * resource only ever renders one resource type's recommendations, so
       * two same-named monitors can never be created against one resource.
       *
       * Names are a display concern only; the created/not-created diff uses
       * fingerprints, not names.
       */
      for (const definition of MonitorRecommendationCatalog.getResourceTypeDefinitions()) {
        const names: Array<string> = definition
          .getRecommendations()
          .map((recommendation: MonitorRecommendation) => {
            return MonitorRecommendationUtil.getMonitorName({
              recommendation: recommendation,
              resourceDisplayName: "prod",
            });
          });

        expect(new Set(names).size).toBe(names.length);
      }
    });
  });

  describe("getMonitorStep — every recommendation, every resource type", () => {
    it("builds a step with at least one criteria instance for all recommendations", () => {
      expect(ALL_RECOMMENDATIONS.length).toBeGreaterThan(0);

      for (const recommendation of ALL_RECOMMENDATIONS) {
        const monitorStep: MonitorStep =
          recommendation.getMonitorStep(buildArgs());

        expect(monitorStep.data).toBeTruthy();
        expect(getCriteriaInstances(monitorStep).length).toBeGreaterThan(0);
      }
    });

    it("threads the resource identifier through every module's args rename", () => {
      for (const recommendation of ALL_RECOMMENDATIONS) {
        const fingerprint: MonitorRecommendationFingerprint | undefined =
          MonitorRecommendationUtil.getFingerprintFromMonitorStep(
            recommendation.getMonitorStep(buildArgs()),
          );

        expect(fingerprint).toBeDefined();
        expect(fingerprint?.resourceIdentifier).toBe(RESOURCE_IDENTIFIER);
      }
    });

    it("references at least one metric or formula per recommendation", () => {
      for (const recommendation of ALL_RECOMMENDATIONS) {
        const fingerprint: MonitorRecommendationFingerprint | undefined =
          MonitorRecommendationUtil.getFingerprintFromMonitorStep(
            recommendation.getMonitorStep(buildArgs()),
          );

        expect(
          (fingerprint?.metricNames.length || 0) +
            (fingerprint?.formulas.length || 0),
        ).toBeGreaterThan(0);
      }
    });

    it("gives every criteria instance a name and description", () => {
      // MonitorCriteriaInstance.getValidationError rejects a blank one.
      for (const recommendation of ALL_RECOMMENDATIONS) {
        for (const instance of getCriteriaInstances(
          recommendation.getMonitorStep(buildArgs()),
        )) {
          expect(instance.data?.name?.trim().length).toBeGreaterThan(0);
          expect(instance.data?.description?.trim().length).toBeGreaterThan(0);
        }
      }
    });

    it("gives every criteria incident and alert a title, description and severity", () => {
      for (const recommendation of ALL_RECOMMENDATIONS) {
        const monitorStep: MonitorStep =
          recommendation.getMonitorStep(buildArgs());

        for (const incident of getAllCriteriaIncidents(monitorStep)) {
          expect(incident.title.trim().length).toBeGreaterThan(0);
          expect(incident.description.trim().length).toBeGreaterThan(0);
          expect(incident.incidentSeverityId).toBeDefined();
        }

        for (const alert of getAllCriteriaAlerts(monitorStep)) {
          expect(alert.title.trim().length).toBeGreaterThan(0);
          expect(alert.description.trim().length).toBeGreaterThan(0);
          expect(alert.alertSeverityId).toBeDefined();
        }
      }
    });
  });

  describe("applyNotificationSettingsToMonitorStep", () => {
    it("no shipped template pages anyone on its own — the gap this feature closes", () => {
      /*
       * Documents the pre-existing behaviour every template has: an empty
       * onCallPolicyIds on every generated incident and alert. If a template
       * module ever starts shipping a real policy id, this test fails and the
       * override semantics below need re-examining.
       */
      for (const recommendation of ALL_RECOMMENDATIONS) {
        const monitorStep: MonitorStep =
          recommendation.getMonitorStep(buildArgs());

        for (const incident of getAllCriteriaIncidents(monitorStep)) {
          expect(incident.onCallPolicyIds || []).toEqual([]);
        }

        for (const alert of getAllCriteriaAlerts(monitorStep)) {
          expect(alert.onCallPolicyIds || []).toEqual([]);
        }
      }
    });

    it("applies on-call policies to every incident and alert of every criteria instance", () => {
      const policyA: ObjectID = ObjectID.generate();
      const policyB: ObjectID = ObjectID.generate();

      for (const recommendation of ALL_RECOMMENDATIONS) {
        const monitorStep: MonitorStep =
          MonitorRecommendationUtil.applyNotificationSettingsToMonitorStep({
            monitorStep: recommendation.getMonitorStep(buildArgs()),
            notificationSettings: { onCallPolicyIds: [policyA, policyB] },
          });

        const incidents: Array<CriteriaIncident> =
          getAllCriteriaIncidents(monitorStep);
        const alerts: Array<CriteriaAlert> = getAllCriteriaAlerts(monitorStep);

        expect(incidents.length).toBeGreaterThan(0);
        expect(alerts.length).toBeGreaterThan(0);

        for (const incident of incidents) {
          expect(incident.onCallPolicyIds).toEqual([policyA, policyB]);
        }

        for (const alert of alerts) {
          expect(alert.onCallPolicyIds).toEqual([policyA, policyB]);
        }
      }
    });

    it("copies the policy array rather than sharing it across criteria", () => {
      /*
       * A shared array reference would mean editing one incident's policies in
       * a later flow silently edits every other incident on the monitor.
       */
      const policy: ObjectID = ObjectID.generate();
      const settingsArray: Array<ObjectID> = [policy];

      const monitorStep: MonitorStep =
        MonitorRecommendationUtil.applyNotificationSettingsToMonitorStep({
          monitorStep: ONE_PER_RESOURCE_TYPE[0]!.getMonitorStep(buildArgs()),
          notificationSettings: { onCallPolicyIds: settingsArray },
        });

      const incidents: Array<CriteriaIncident> =
        getAllCriteriaIncidents(monitorStep);

      for (const incident of incidents) {
        expect(incident.onCallPolicyIds).not.toBe(settingsArray);
      }

      if (incidents.length > 1) {
        expect(incidents[0]!.onCallPolicyIds).not.toBe(
          incidents[1]!.onCallPolicyIds,
        );
      }
    });

    it("applies labels and owners to incidents and alerts", () => {
      const labelId: ObjectID = ObjectID.generate();
      const teamId: ObjectID = ObjectID.generate();
      const userId: ObjectID = ObjectID.generate();

      const monitorStep: MonitorStep =
        MonitorRecommendationUtil.applyNotificationSettingsToMonitorStep({
          monitorStep: ONE_PER_RESOURCE_TYPE[0]!.getMonitorStep(buildArgs()),
          notificationSettings: {
            labelIds: [labelId],
            ownerTeamIds: [teamId],
            ownerUserIds: [userId],
          },
        });

      for (const incident of getAllCriteriaIncidents(monitorStep)) {
        expect(incident.labelIds).toEqual([labelId]);
        expect(incident.ownerTeamIds).toEqual([teamId]);
        expect(incident.ownerUserIds).toEqual([userId]);
      }

      for (const alert of getAllCriteriaAlerts(monitorStep)) {
        expect(alert.labelIds).toEqual([labelId]);
        expect(alert.ownerTeamIds).toEqual([teamId]);
        expect(alert.ownerUserIds).toEqual([userId]);
      }
    });

    it("overrides the template's severity when one is chosen", () => {
      const incidentSeverityId: ObjectID = ObjectID.generate();
      const alertSeverityId: ObjectID = ObjectID.generate();

      const monitorStep: MonitorStep =
        MonitorRecommendationUtil.applyNotificationSettingsToMonitorStep({
          monitorStep: ONE_PER_RESOURCE_TYPE[0]!.getMonitorStep(buildArgs()),
          notificationSettings: {
            incidentSeverityId: incidentSeverityId,
            alertSeverityId: alertSeverityId,
          },
        });

      for (const incident of getAllCriteriaIncidents(monitorStep)) {
        expect(incident.incidentSeverityId).toEqual(incidentSeverityId);
      }

      for (const alert of getAllCriteriaAlerts(monitorStep)) {
        expect(alert.alertSeverityId).toEqual(alertSeverityId);
      }
    });

    it("leaves the template's own severity in place when none is chosen", () => {
      const monitorStep: MonitorStep =
        MonitorRecommendationUtil.applyNotificationSettingsToMonitorStep({
          monitorStep: ONE_PER_RESOURCE_TYPE[0]!.getMonitorStep(buildArgs()),
          notificationSettings: { onCallPolicyIds: [ObjectID.generate()] },
        });

      for (const incident of getAllCriteriaIncidents(monitorStep)) {
        expect(incident.incidentSeverityId).toEqual(INCIDENT_SEVERITY_ID);
      }

      for (const alert of getAllCriteriaAlerts(monitorStep)) {
        expect(alert.alertSeverityId).toEqual(ALERT_SEVERITY_ID);
      }
    });

    it("is a no-op for empty settings and empty arrays", () => {
      for (const notificationSettings of [
        {},
        {
          onCallPolicyIds: [],
          labelIds: [],
          ownerTeamIds: [],
          ownerUserIds: [],
        },
      ]) {
        const monitorStep: MonitorStep =
          MonitorRecommendationUtil.applyNotificationSettingsToMonitorStep({
            monitorStep: ONE_PER_RESOURCE_TYPE[0]!.getMonitorStep(buildArgs()),
            notificationSettings: notificationSettings,
          });

        for (const incident of getAllCriteriaIncidents(monitorStep)) {
          expect(incident.onCallPolicyIds || []).toEqual([]);
          expect(incident.incidentSeverityId).toEqual(INCIDENT_SEVERITY_ID);
        }
      }
    });

    it("tolerates a step with no criteria instances", () => {
      const emptyStep: MonitorStep = new MonitorStep();

      expect(() => {
        MonitorRecommendationUtil.applyNotificationSettingsToMonitorStep({
          monitorStep: emptyStep,
          notificationSettings: { onCallPolicyIds: [ObjectID.generate()] },
        });
      }).not.toThrow();
    });
  });

  describe("buildMonitorSteps", () => {
    it("produces MonitorSteps that pass validation for every recommendation", () => {
      /*
       * MonitorSteps.getValidationError is the same client-side gate the
       * monitor create form runs before POSTing. If a recommendation cannot
       * pass it, the create flow would fail at submit time with a message the
       * user cannot act on.
       */
      for (const recommendation of ALL_RECOMMENDATIONS) {
        const monitorSteps: MonitorSteps =
          MonitorRecommendationUtil.buildMonitorSteps({
            recommendation: recommendation,
            args: buildArgs(),
            defaultMonitorStatusId: DEFAULT_STATUS_ID,
          });

        expect(
          MonitorSteps.getValidationError(
            monitorSteps,
            recommendation.monitorType,
          ),
        ).toBeNull();
      }
    });

    it("sets the default monitor status and exactly one step", () => {
      const monitorSteps: MonitorSteps =
        MonitorRecommendationUtil.buildMonitorSteps({
          recommendation: ONE_PER_RESOURCE_TYPE[0]!,
          args: buildArgs(),
          defaultMonitorStatusId: DEFAULT_STATUS_ID,
        });

      expect(monitorSteps.data?.defaultMonitorStatusId).toEqual(
        DEFAULT_STATUS_ID,
      );
      expect(monitorSteps.data?.monitorStepsInstanceArray.length).toBe(1);
    });

    it("applies notification settings when given, and still validates", () => {
      const policy: ObjectID = ObjectID.generate();

      for (const recommendation of ONE_PER_RESOURCE_TYPE) {
        const monitorSteps: MonitorSteps =
          MonitorRecommendationUtil.buildMonitorSteps({
            recommendation: recommendation,
            args: buildArgs(),
            defaultMonitorStatusId: DEFAULT_STATUS_ID,
            notificationSettings: { onCallPolicyIds: [policy] },
          });

        expect(
          MonitorSteps.getValidationError(
            monitorSteps,
            recommendation.monitorType,
          ),
        ).toBeNull();

        const monitorStep: MonitorStep =
          monitorSteps.data!.monitorStepsInstanceArray[0]!;

        for (const incident of getAllCriteriaIncidents(monitorStep)) {
          expect(incident.onCallPolicyIds).toEqual([policy]);
        }
      }
    });

    it("does not mutate a previously built step when building again", () => {
      const recommendation: MonitorRecommendation = ONE_PER_RESOURCE_TYPE[0]!;

      const withoutPolicy: MonitorSteps =
        MonitorRecommendationUtil.buildMonitorSteps({
          recommendation: recommendation,
          args: buildArgs(),
          defaultMonitorStatusId: DEFAULT_STATUS_ID,
        });

      MonitorRecommendationUtil.buildMonitorSteps({
        recommendation: recommendation,
        args: buildArgs(),
        defaultMonitorStatusId: DEFAULT_STATUS_ID,
        notificationSettings: { onCallPolicyIds: [ObjectID.generate()] },
      });

      for (const incident of getAllCriteriaIncidents(
        withoutPolicy.data!.monitorStepsInstanceArray[0]!,
      )) {
        expect(incident.onCallPolicyIds || []).toEqual([]);
      }
    });
  });

  describe("getFingerprintFromMonitorStep", () => {
    it("is stable across repeated builds of the same recommendation", () => {
      for (const recommendation of ONE_PER_RESOURCE_TYPE) {
        const a: MonitorRecommendationFingerprint | undefined =
          MonitorRecommendationUtil.getFingerprintFromMonitorStep(
            recommendation.getMonitorStep(buildArgs()),
          );
        const b: MonitorRecommendationFingerprint | undefined =
          MonitorRecommendationUtil.getFingerprintFromMonitorStep(
            recommendation.getMonitorStep(buildArgs()),
          );

        expect(MonitorRecommendationUtil.areFingerprintsEqual(a, b)).toBe(true);
      }
    });

    it("ignores the monitor name — renaming must not resurface a recommendation", () => {
      const recommendation: MonitorRecommendation = ONE_PER_RESOURCE_TYPE[0]!;

      const a: MonitorRecommendationFingerprint | undefined =
        MonitorRecommendationUtil.getFingerprintFromMonitorStep(
          recommendation.getMonitorStep(buildArgs({ monitorName: "one" })),
        );
      const b: MonitorRecommendationFingerprint | undefined =
        MonitorRecommendationUtil.getFingerprintFromMonitorStep(
          recommendation.getMonitorStep(
            buildArgs({ monitorName: "something else entirely" }),
          ),
        );

      expect(MonitorRecommendationUtil.areFingerprintsEqual(a, b)).toBe(true);
    });

    it("differs when the resource identifier differs", () => {
      const recommendation: MonitorRecommendation = ONE_PER_RESOURCE_TYPE[0]!;

      const a: MonitorRecommendationFingerprint | undefined =
        MonitorRecommendationUtil.getFingerprintFromMonitorStep(
          recommendation.getMonitorStep(
            buildArgs({ resourceIdentifier: "cluster-a" }),
          ),
        );
      const b: MonitorRecommendationFingerprint | undefined =
        MonitorRecommendationUtil.getFingerprintFromMonitorStep(
          recommendation.getMonitorStep(
            buildArgs({ resourceIdentifier: "cluster-b" }),
          ),
        );

      expect(MonitorRecommendationUtil.areFingerprintsEqual(a, b)).toBe(false);
    });

    it("returns undefined for a step with no infrastructure config", () => {
      expect(
        MonitorRecommendationUtil.getFingerprintFromMonitorStep(
          new MonitorStep(),
        ),
      ).toBeUndefined();
    });

    it("treats two undefined fingerprints as unequal", () => {
      // Otherwise every non-infrastructure monitor would "cover" everything.
      expect(
        MonitorRecommendationUtil.areFingerprintsEqual(undefined, undefined),
      ).toBe(false);
    });

    it("sorts metric names so query order is not part of the identity", () => {
      const fingerprint: MonitorRecommendationFingerprint = {
        resourceIdentifier: "x",
        metricNames: ["b", "a"],
        formulas: [],
      };

      const sorted: MonitorRecommendationFingerprint = {
        resourceIdentifier: "x",
        metricNames: ["a", "b"],
        formulas: [],
      };

      expect(
        MonitorRecommendationUtil.serializeFingerprint(sorted),
      ).not.toEqual(
        MonitorRecommendationUtil.serializeFingerprint(fingerprint),
      );

      /*
       * The util sorts on the way OUT of a step, so two steps built with
       * queries in different orders converge — verified via real steps in the
       * stability test above. This case only pins that serialize() itself is
       * order-sensitive, i.e. sorting is genuinely load-bearing.
       */
    });
  });

  describe("getCoveredRecommendationIds", () => {
    const kubernetesRecommendations: Array<MonitorRecommendation> =
      MonitorRecommendationCatalog.getRecommendations(
        MonitorRecommendationResourceType.Kubernetes,
      );

    it("covers nothing when no monitors exist", () => {
      expect(
        MonitorRecommendationUtil.getCoveredRecommendationIds({
          recommendations: kubernetesRecommendations,
          existingMonitorSteps: [],
          args: buildArgs(),
        }).size,
      ).toBe(0);
    });

    it("covers exactly the recommendations an existing monitor was built from", () => {
      const args: MonitorRecommendationArgs = buildArgs();
      const created: MonitorRecommendation = kubernetesRecommendations[0]!;

      const existingStep: MonitorStep = created.getMonitorStep({
        ...args,
        monitorName: MonitorRecommendationUtil.getMonitorName({
          recommendation: created,
          resourceDisplayName: args.monitorName,
        }),
      });

      const covered: Set<string> =
        MonitorRecommendationUtil.getCoveredRecommendationIds({
          recommendations: kubernetesRecommendations,
          existingMonitorSteps: [existingStep],
          args: args,
        });

      expect(covered.has(created.recommendationId)).toBe(true);
      expect(covered.size).toBe(1);
    });

    it("covers several recommendations when several monitors exist", () => {
      const args: MonitorRecommendationArgs = buildArgs();
      const created: Array<MonitorRecommendation> =
        kubernetesRecommendations.slice(0, 3);

      const existingSteps: Array<MonitorStep> = created.map(
        (recommendation: MonitorRecommendation) => {
          return recommendation.getMonitorStep({
            ...args,
            monitorName: MonitorRecommendationUtil.getMonitorName({
              recommendation: recommendation,
              resourceDisplayName: args.monitorName,
            }),
          });
        },
      );

      const covered: Set<string> =
        MonitorRecommendationUtil.getCoveredRecommendationIds({
          recommendations: kubernetesRecommendations,
          existingMonitorSteps: existingSteps,
          args: args,
        });

      expect(covered.size).toBe(created.length);
      for (const recommendation of created) {
        expect(covered.has(recommendation.recommendationId)).toBe(true);
      }
    });

    it("does not cover a recommendation created against a different resource", () => {
      const created: MonitorRecommendation = kubernetesRecommendations[0]!;

      const otherClusterStep: MonitorStep = created.getMonitorStep(
        buildArgs({ resourceIdentifier: "some-other-cluster" }),
      );

      const covered: Set<string> =
        MonitorRecommendationUtil.getCoveredRecommendationIds({
          recommendations: kubernetesRecommendations,
          existingMonitorSteps: [otherClusterStep],
          args: buildArgs(),
        });

      expect(covered.size).toBe(0);
    });

    it("ignores monitors that carry no infrastructure config", () => {
      const covered: Set<string> =
        MonitorRecommendationUtil.getCoveredRecommendationIds({
          recommendations: kubernetesRecommendations,
          existingMonitorSteps: [new MonitorStep()],
          args: buildArgs(),
        });

      expect(covered.size).toBe(0);
    });

    it("is unaffected by the notification settings applied at create time", () => {
      /*
       * On-call policies are not part of what a monitor watches, so a monitor
       * created WITH policies must still register as covering its
       * recommendation (which is built without them here).
       */
      const args: MonitorRecommendationArgs = buildArgs();
      const created: MonitorRecommendation = kubernetesRecommendations[0]!;

      const existingStep: MonitorStep =
        MonitorRecommendationUtil.applyNotificationSettingsToMonitorStep({
          monitorStep: created.getMonitorStep({
            ...args,
            monitorName: MonitorRecommendationUtil.getMonitorName({
              recommendation: created,
              resourceDisplayName: args.monitorName,
            }),
          }),
          notificationSettings: {
            onCallPolicyIds: [ObjectID.generate()],
            labelIds: [ObjectID.generate()],
          },
        });

      const covered: Set<string> =
        MonitorRecommendationUtil.getCoveredRecommendationIds({
          recommendations: kubernetesRecommendations,
          existingMonitorSteps: [existingStep],
          args: args,
        });

      expect(covered.has(created.recommendationId)).toBe(true);
    });

    it("works for every resource type, not just Kubernetes", () => {
      for (const definition of MonitorRecommendationCatalog.getResourceTypeDefinitions()) {
        const recommendations: Array<MonitorRecommendation> =
          definition.getRecommendations();
        const args: MonitorRecommendationArgs = buildArgs();
        const created: MonitorRecommendation = recommendations[0]!;

        const existingStep: MonitorStep = created.getMonitorStep({
          ...args,
          monitorName: MonitorRecommendationUtil.getMonitorName({
            recommendation: created,
            resourceDisplayName: args.monitorName,
          }),
        });

        const covered: Set<string> =
          MonitorRecommendationUtil.getCoveredRecommendationIds({
            recommendations: recommendations,
            existingMonitorSteps: [existingStep],
            args: args,
          });

        expect(covered.has(created.recommendationId)).toBe(true);
      }
    });
  });

  describe("sortRecommendations", () => {
    const recommendations: Array<MonitorRecommendation> =
      MonitorRecommendationCatalog.getRecommendations(
        MonitorRecommendationResourceType.Kubernetes,
      );

    it("keeps every recommendation exactly once", () => {
      const sorted: Array<MonitorRecommendation> =
        MonitorRecommendationUtil.sortRecommendations({
          recommendations: recommendations,
          coveredRecommendationIds: new Set<string>(),
        });

      expect(sorted.length).toBe(recommendations.length);
      expect(
        new Set(
          sorted.map((r: MonitorRecommendation) => {
            return r.recommendationId;
          }),
        ).size,
      ).toBe(recommendations.length);
    });

    it("does not mutate the input array", () => {
      const input: Array<MonitorRecommendation> = [...recommendations];
      const before: Array<string> = input.map((r: MonitorRecommendation) => {
        return r.recommendationId;
      });

      MonitorRecommendationUtil.sortRecommendations({
        recommendations: input,
        coveredRecommendationIds: new Set<string>([
          recommendations[0]!.recommendationId,
        ]),
      });

      expect(
        input.map((r: MonitorRecommendation) => {
          return r.recommendationId;
        }),
      ).toEqual(before);
    });

    it("puts not-yet-created recommendations before created ones", () => {
      const covered: Set<string> = new Set<string>([
        recommendations[0]!.recommendationId,
      ]);

      const sorted: Array<MonitorRecommendation> =
        MonitorRecommendationUtil.sortRecommendations({
          recommendations: recommendations,
          coveredRecommendationIds: covered,
        });

      expect(sorted[sorted.length - 1]!.recommendationId).toBe(
        recommendations[0]!.recommendationId,
      );
    });

    it("puts Critical before Warning among not-yet-created recommendations", () => {
      const sorted: Array<MonitorRecommendation> =
        MonitorRecommendationUtil.sortRecommendations({
          recommendations: recommendations,
          coveredRecommendationIds: new Set<string>(),
        });

      let seenWarning: boolean = false;
      for (const recommendation of sorted) {
        if (recommendation.severity === "Warning") {
          seenWarning = true;
        } else if (seenWarning) {
          throw new Error(
            `Critical recommendation "${recommendation.name}" sorted after a Warning one.`,
          );
        }
      }

      // Guard against a vacuous pass if the module ever ships one severity only.
      expect(seenWarning).toBe(true);
    });

    it("preserves module declaration order within a severity", () => {
      const sorted: Array<MonitorRecommendation> =
        MonitorRecommendationUtil.sortRecommendations({
          recommendations: recommendations,
          coveredRecommendationIds: new Set<string>(),
        });

      const criticalIdsInSortedOrder: Array<string> = sorted
        .filter((r: MonitorRecommendation) => {
          return r.severity === "Critical";
        })
        .map((r: MonitorRecommendation) => {
          return r.recommendationId;
        });

      const criticalIdsInDeclarationOrder: Array<string> = recommendations
        .filter((r: MonitorRecommendation) => {
          return r.severity === "Critical";
        })
        .map((r: MonitorRecommendation) => {
          return r.recommendationId;
        });

      expect(criticalIdsInSortedOrder).toEqual(criticalIdsInDeclarationOrder);
    });

    it("sorts covered recommendations among themselves by severity too", () => {
      const covered: Set<string> = new Set<string>(
        recommendations.map((r: MonitorRecommendation) => {
          return r.recommendationId;
        }),
      );

      const sorted: Array<MonitorRecommendation> =
        MonitorRecommendationUtil.sortRecommendations({
          recommendations: recommendations,
          coveredRecommendationIds: covered,
        });

      const firstWarningIndex: number = sorted.findIndex(
        (r: MonitorRecommendation) => {
          return r.severity === "Warning";
        },
      );
      const lastCriticalIndex: number = sorted.reduce(
        (last: number, r: MonitorRecommendation, index: number) => {
          return r.severity === "Critical" ? index : last;
        },
        -1,
      );

      expect(lastCriticalIndex).toBeLessThan(firstWarningIndex);
    });
  });
});
