import MonitorRecommendationCatalog, {
  MonitorRecommendationResourceTypeDefinition,
} from "../../../../Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import MonitorRecommendationUtil from "../../../../Types/Monitor/Recommendation/MonitorRecommendationUtil";
import {
  MonitorRecommendation,
  MonitorRecommendationArgs,
  MonitorRecommendationNotificationMode,
  MonitorRecommendationNotificationSettings,
} from "../../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import { CriteriaIncident } from "../../../../Types/Monitor/CriteriaIncident";
import { CriteriaAlert } from "../../../../Types/Monitor/CriteriaAlert";
import ObjectID from "../../../../Types/ObjectID";

/*
 * What the Alert / Incident / Both choice on the recommendations create form
 * actually does to a generated monitor.
 *
 * The reason this file exists separately from MonitorRecommendationUtil.test.ts
 * is that `createIncidents` / `createAlerts` are the two flags the monitor
 * evaluator reads to decide whether a threshold breach turns into a record.
 * They are booleans on a criteria instance, they have no UI on the
 * recommendation card, and getting them wrong is invisible until production:
 *
 *   - set both on a criteria that has no incidents/alerts to create, and the
 *     auto-resolve path counts that criteria as breach-producing, so a
 *     recovered monitor never closes the incident it opened;
 *   - set neither on the criteria that DOES have them, and the monitor
 *     silently watches a threshold and tells nobody;
 *   - empty the arrays instead of clearing the flag, and the user's later
 *     "actually I do want incidents" costs them re-authoring every title,
 *     description and severity by hand.
 *
 * None of those three failures produce an error, a validation failure, or a
 * visible difference on the recommendations page. They only show up the next
 * time something actually breaks.
 */

const ONLINE_STATUS_ID: ObjectID = ObjectID.generate();
const OFFLINE_STATUS_ID: ObjectID = ObjectID.generate();
const DEFAULT_STATUS_ID: ObjectID = ObjectID.generate();
const INCIDENT_SEVERITY_ID: ObjectID = ObjectID.generate();
const ALERT_SEVERITY_ID: ObjectID = ObjectID.generate();
const RESOURCE_IDENTIFIER: string = ObjectID.generate().toString();

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

/*
 * The recovery ("Healthy") criteria is identified structurally — empty
 * incidents AND empty alerts — rather than by its name, because the eight
 * template modules name it inconsistently once a template overrides
 * `criteriaName`. Empty-arrays IS the property that makes flipping a flag on it
 * meaningless-at-best and harmful-at-worst, so it is the right thing to key on.
 */
function isRecoveryCriteriaInstance(
  criteriaInstance: MonitorCriteriaInstance,
): boolean {
  return (
    (criteriaInstance.data?.incidents || []).length === 0 &&
    (criteriaInstance.data?.alerts || []).length === 0
  );
}

function getRecoveryCriteriaInstances(
  monitorStep: MonitorStep,
): Array<MonitorCriteriaInstance> {
  return getCriteriaInstances(monitorStep).filter(isRecoveryCriteriaInstance);
}

/*
 * Every criteria instance that ships something to create — the "Unhealthy"
 * ones. Ceph's Monitor Disk template ships two of them (a CRIT tier and a LOW
 * tier), so this is deliberately a list and not a single instance.
 */
function getBreachCriteriaInstances(
  monitorStep: MonitorStep,
): Array<MonitorCriteriaInstance> {
  return getCriteriaInstances(monitorStep).filter(
    (criteriaInstance: MonitorCriteriaInstance) => {
      return !isRecoveryCriteriaInstance(criteriaInstance);
    },
  );
}

function applyMode(data: {
  recommendation: MonitorRecommendation;
  notificationMode: MonitorRecommendationNotificationMode | undefined;
}): MonitorStep {
  return MonitorRecommendationUtil.applyNotificationSettingsToMonitorStep({
    monitorStep: data.recommendation.getMonitorStep(buildArgs()),
    notificationSettings: { notificationMode: data.notificationMode },
    severity: data.recommendation.severity,
  });
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

const ALL_MODES: Array<MonitorRecommendationNotificationMode> = [
  MonitorRecommendationNotificationMode.Alert,
  MonitorRecommendationNotificationMode.Incident,
  MonitorRecommendationNotificationMode.Both,
];

describe("MonitorRecommendationNotificationMode", () => {
  describe("the shipped template baseline the modes are measured against", () => {
    /*
     * Everything below this describe block is a statement about how a mode
     * CHANGES the templates. Those statements are only meaningful if the
     * starting point is known, and the starting point lives in eight
     * independently maintained `<X>AlertTemplates.ts` modules that nothing
     * else forces to agree. If one of them ever ships, say, an unhealthy
     * criteria with `createAlerts: false`, then "mode Both leaves both on"
     * would still pass while quietly meaning something different. These two
     * tests are the canary for that.
     */

    it("has recommendations to test at all", () => {
      // Guards every for-loop in this file against a vacuous pass.
      expect(ALL_RECOMMENDATIONS.length).toBeGreaterThan(0);
      expect(ONE_PER_RESOURCE_TYPE.length).toBe(9);
    });

    it("ships every unhealthy criteria with createIncidents AND createAlerts true, and both arrays populated", () => {
      for (const recommendation of ALL_RECOMMENDATIONS) {
        const monitorStep: MonitorStep =
          recommendation.getMonitorStep(buildArgs());

        const breachInstances: Array<MonitorCriteriaInstance> =
          getBreachCriteriaInstances(monitorStep);

        expect(breachInstances.length).toBeGreaterThan(0);

        for (const criteriaInstance of breachInstances) {
          expect(criteriaInstance.data?.createIncidents).toBe(true);
          expect(criteriaInstance.data?.createAlerts).toBe(true);
          expect(
            (criteriaInstance.data?.incidents || []).length,
          ).toBeGreaterThan(0);
          expect((criteriaInstance.data?.alerts || []).length).toBeGreaterThan(
            0,
          );
        }
      }
    });

    it("ships exactly one recovery criteria per recommendation, with both flags false and both arrays empty", () => {
      for (const recommendation of ALL_RECOMMENDATIONS) {
        const recoveryInstances: Array<MonitorCriteriaInstance> =
          getRecoveryCriteriaInstances(
            recommendation.getMonitorStep(buildArgs()),
          );

        expect(recoveryInstances.length).toBe(1);

        expect(recoveryInstances[0]!.data?.createIncidents).toBe(false);
        expect(recoveryInstances[0]!.data?.createAlerts).toBe(false);
        expect(recoveryInstances[0]!.data?.incidents).toEqual([]);
        expect(recoveryInstances[0]!.data?.alerts).toEqual([]);
      }
    });

    it("ships at least one recommendation with more than one unhealthy criteria", () => {
      /*
       * Ceph's monitor-disk template tiers CRIT and LOW into two unhealthy
       * criteria on one monitor. Without a multi-criteria template in the
       * catalog, "the mode is applied to EVERY unhealthy criteria" below could
       * never fail — a buggy implementation that only touched the first
       * criteria instance would pass every other test in this file.
       */
      const multiCriteriaRecommendations: Array<MonitorRecommendation> =
        ALL_RECOMMENDATIONS.filter((recommendation: MonitorRecommendation) => {
          return (
            getBreachCriteriaInstances(
              recommendation.getMonitorStep(buildArgs()),
            ).length > 1
          );
        });

      expect(multiCriteriaRecommendations.length).toBeGreaterThan(0);
    });
  });

  describe("applyNotificationSettingsToMonitorStep — notification mode", () => {
    it("mode Alert leaves alerts on and turns incidents off, on every unhealthy criteria", () => {
      for (const recommendation of ALL_RECOMMENDATIONS) {
        const monitorStep: MonitorStep = applyMode({
          recommendation: recommendation,
          notificationMode: MonitorRecommendationNotificationMode.Alert,
        });

        for (const criteriaInstance of getBreachCriteriaInstances(
          monitorStep,
        )) {
          expect(criteriaInstance.data?.createAlerts).toBe(true);
          expect(criteriaInstance.data?.createIncidents).toBe(false);
        }
      }
    });

    it("mode Incident leaves incidents on and turns alerts off, on every unhealthy criteria", () => {
      for (const recommendation of ALL_RECOMMENDATIONS) {
        const monitorStep: MonitorStep = applyMode({
          recommendation: recommendation,
          notificationMode: MonitorRecommendationNotificationMode.Incident,
        });

        for (const criteriaInstance of getBreachCriteriaInstances(
          monitorStep,
        )) {
          expect(criteriaInstance.data?.createIncidents).toBe(true);
          expect(criteriaInstance.data?.createAlerts).toBe(false);
        }
      }
    });

    it("mode Both leaves both on, on every unhealthy criteria", () => {
      for (const recommendation of ALL_RECOMMENDATIONS) {
        const monitorStep: MonitorStep = applyMode({
          recommendation: recommendation,
          notificationMode: MonitorRecommendationNotificationMode.Both,
        });

        for (const criteriaInstance of getBreachCriteriaInstances(
          monitorStep,
        )) {
          expect(criteriaInstance.data?.createIncidents).toBe(true);
          expect(criteriaInstance.data?.createAlerts).toBe(true);
        }
      }
    });

    it("an absent mode leaves the flags exactly as the template shipped them", () => {
      /*
       * The backwards-compatible path. `notificationMode` is optional, and any
       * caller that predates it — older tests, MonitorRecommendationCreateUtil
       * before the form gained the toggle, any future programmatic caller —
       * passes settings without it. Those callers must keep creating
       * both-incident-and-alert monitors rather than silently inheriting a
       * default someone else picked, so `undefined` is a distinct state from
       * `Both` and not a synonym for it.
       */
      for (const recommendation of ALL_RECOMMENDATIONS) {
        const monitorStep: MonitorStep = applyMode({
          recommendation: recommendation,
          notificationMode: undefined,
        });

        for (const criteriaInstance of getBreachCriteriaInstances(
          monitorStep,
        )) {
          expect(criteriaInstance.data?.createIncidents).toBe(true);
          expect(criteriaInstance.data?.createAlerts).toBe(true);
        }
      }
    });

    it("settings that carry no mode at all leave the flags alone too", () => {
      /*
       * Same guarantee as above, reached the other way: a settings object that
       * only sets on-call policies / labels / severities must not disturb the
       * flags as a side effect of the severity or owner writes.
       */
      const settingsWithoutMode: MonitorRecommendationNotificationSettings = {
        onCallPolicyIds: [ObjectID.generate()],
        labelIds: [ObjectID.generate()],
        ownerTeamIds: [ObjectID.generate()],
        ownerUserIds: [ObjectID.generate()],
      };

      for (const recommendation of ONE_PER_RESOURCE_TYPE) {
        const monitorStep: MonitorStep =
          MonitorRecommendationUtil.applyNotificationSettingsToMonitorStep({
            monitorStep: recommendation.getMonitorStep(buildArgs()),
            notificationSettings: settingsWithoutMode,
            severity: recommendation.severity,
          });

        for (const criteriaInstance of getBreachCriteriaInstances(
          monitorStep,
        )) {
          expect(criteriaInstance.data?.createIncidents).toBe(true);
          expect(criteriaInstance.data?.createAlerts).toBe(true);
        }
      }
    });

    it("never marks the recovery criteria as incident- or alert-producing, under ANY mode", () => {
      /*
       * The highest-value assertion in this file, and the one most likely to be
       * broken by an innocent-looking simplification of
       * `applyNotificationModeToCriteriaInstance` (dropping its
       * "only if the array is non-empty" guards reads like dead code).
       *
       * The recovery criteria is what fires when a monitor comes back healthy.
       * `createIncidents: true` on it means the auto-resolve path treats it as
       * a criteria that contributes breaches, so the recovery never resolves
       * the incident the unhealthy criteria opened. The monitor would look
       * correct on the create form, create correctly, alert correctly — and
       * then leave a permanently open incident behind after every recovery,
       * with nothing in the config visibly wrong. `Both` is the dangerous mode
       * here precisely because it is the one that turns everything else on.
       */
      for (const recommendation of ALL_RECOMMENDATIONS) {
        for (const notificationMode of ALL_MODES) {
          const monitorStep: MonitorStep = applyMode({
            recommendation: recommendation,
            notificationMode: notificationMode,
          });

          const recoveryInstances: Array<MonitorCriteriaInstance> =
            getRecoveryCriteriaInstances(monitorStep);

          expect(recoveryInstances.length).toBe(1);

          for (const criteriaInstance of recoveryInstances) {
            expect(criteriaInstance.data?.createIncidents).toBe(false);
            expect(criteriaInstance.data?.createAlerts).toBe(false);
            // Still nothing to create, so the flags stayed meaningful.
            expect(criteriaInstance.data?.incidents).toEqual([]);
            expect(criteriaInstance.data?.alerts).toEqual([]);
          }
        }
      }
    });

    it("keeps the incident config intact when mode Alert switches incidents off", () => {
      /*
       * Turning a mode off must clear the flag and nothing else. If the
       * implementation instead emptied `incidents`, the switch would be
       * one-way: the user who later opens the monitor's criteria form and
       * flips "Create Incidents" back on would find an empty incident with no
       * title, no description and no severity — and would have to re-author by
       * hand the exact text the template wrote for them.
       */
      for (const recommendation of ONE_PER_RESOURCE_TYPE) {
        const templateStep: MonitorStep =
          recommendation.getMonitorStep(buildArgs());
        const alertOnlyStep: MonitorStep = applyMode({
          recommendation: recommendation,
          notificationMode: MonitorRecommendationNotificationMode.Alert,
        });

        const templateIncidents: Array<CriteriaIncident> =
          getBreachCriteriaInstances(templateStep).flatMap(
            (criteriaInstance: MonitorCriteriaInstance) => {
              return criteriaInstance.data?.incidents || [];
            },
          );
        const alertOnlyIncidents: Array<CriteriaIncident> =
          getBreachCriteriaInstances(alertOnlyStep).flatMap(
            (criteriaInstance: MonitorCriteriaInstance) => {
              return criteriaInstance.data?.incidents || [];
            },
          );

        expect(alertOnlyIncidents.length).toBe(templateIncidents.length);
        expect(alertOnlyIncidents.length).toBeGreaterThan(0);

        alertOnlyIncidents.forEach(
          (incident: CriteriaIncident, index: number) => {
            expect(incident.title).toBe(templateIncidents[index]!.title);
            expect(incident.description).toBe(
              templateIncidents[index]!.description,
            );
            expect(incident.incidentSeverityId).toEqual(INCIDENT_SEVERITY_ID);
          },
        );
      }
    });

    it("keeps the alert config intact when mode Incident switches alerts off", () => {
      // The mirror image of the test above; the two toggles must behave alike.
      for (const recommendation of ONE_PER_RESOURCE_TYPE) {
        const templateStep: MonitorStep =
          recommendation.getMonitorStep(buildArgs());
        const incidentOnlyStep: MonitorStep = applyMode({
          recommendation: recommendation,
          notificationMode: MonitorRecommendationNotificationMode.Incident,
        });

        const templateAlerts: Array<CriteriaAlert> = getBreachCriteriaInstances(
          templateStep,
        ).flatMap((criteriaInstance: MonitorCriteriaInstance) => {
          return criteriaInstance.data?.alerts || [];
        });
        const incidentOnlyAlerts: Array<CriteriaAlert> =
          getBreachCriteriaInstances(incidentOnlyStep).flatMap(
            (criteriaInstance: MonitorCriteriaInstance) => {
              return criteriaInstance.data?.alerts || [];
            },
          );

        expect(incidentOnlyAlerts.length).toBe(templateAlerts.length);
        expect(incidentOnlyAlerts.length).toBeGreaterThan(0);

        incidentOnlyAlerts.forEach((alert: CriteriaAlert, index: number) => {
          expect(alert.title).toBe(templateAlerts[index]!.title);
          expect(alert.description).toBe(templateAlerts[index]!.description);
          expect(alert.alertSeverityId).toEqual(ALERT_SEVERITY_ID);
        });
      }
    });

    it("applies the mode alongside on-call policies and severities rather than instead of them", () => {
      /*
       * The mode write and the owner/severity writes happen in the same pass
       * over the criteria instances. A short-circuit in either direction —
       * returning early once the mode is handled, or skipping the mode when
       * other settings are present — would leave half of the create form's
       * choices on the floor.
       */
      const policyId: ObjectID = ObjectID.generate();
      const criticalIncidentSeverityId: ObjectID = ObjectID.generate();
      const warningIncidentSeverityId: ObjectID = ObjectID.generate();

      for (const recommendation of ONE_PER_RESOURCE_TYPE) {
        const monitorStep: MonitorStep =
          MonitorRecommendationUtil.applyNotificationSettingsToMonitorStep({
            monitorStep: recommendation.getMonitorStep(buildArgs()),
            notificationSettings: {
              notificationMode: MonitorRecommendationNotificationMode.Incident,
              onCallPolicyIds: [policyId],
              incidentSeverityIdBySeverity: {
                Critical: criticalIncidentSeverityId,
                Warning: warningIncidentSeverityId,
              },
            },
            severity: recommendation.severity,
          });

        const expectedIncidentSeverityId: ObjectID =
          recommendation.severity === "Critical"
            ? criticalIncidentSeverityId
            : warningIncidentSeverityId;

        for (const criteriaInstance of getBreachCriteriaInstances(
          monitorStep,
        )) {
          expect(criteriaInstance.data?.createIncidents).toBe(true);
          expect(criteriaInstance.data?.createAlerts).toBe(false);

          for (const incident of criteriaInstance.data?.incidents || []) {
            expect(incident.onCallPolicyIds).toEqual([policyId]);
            expect(incident.incidentSeverityId).toEqual(
              expectedIncidentSeverityId,
            );
          }
        }
      }
    });

    it("does not throw on a step with no criteria instances", () => {
      /*
       * The mode pass runs before anything reads a criteria instance's arrays.
       * A hand-built or partially-deserialized step must not take the create
       * flow down.
       */
      for (const notificationMode of ALL_MODES) {
        expect(() => {
          MonitorRecommendationUtil.applyNotificationSettingsToMonitorStep({
            monitorStep: new MonitorStep(),
            notificationSettings: { notificationMode: notificationMode },
            severity: "Critical",
          });
        }).not.toThrow();
      }
    });
  });

  describe("buildMonitorSteps with a notification mode", () => {
    it("threads the mode through to the created monitor's criteria for every resource type", () => {
      /*
       * `buildMonitorSteps` is what the create flow actually calls;
       * `applyNotificationSettingsToMonitorStep` is an implementation detail it
       * happens to expose. If the wiring between them were dropped, every test
       * above would still pass and the shipped feature would do nothing.
       */
      for (const recommendation of ONE_PER_RESOURCE_TYPE) {
        for (const notificationMode of ALL_MODES) {
          const monitorSteps: MonitorSteps =
            MonitorRecommendationUtil.buildMonitorSteps({
              recommendation: recommendation,
              args: buildArgs(),
              defaultMonitorStatusId: DEFAULT_STATUS_ID,
              notificationSettings: { notificationMode: notificationMode },
            });

          const monitorStep: MonitorStep =
            monitorSteps.data!.monitorStepsInstanceArray[0]!;

          const expectsIncidents: boolean =
            notificationMode !== MonitorRecommendationNotificationMode.Alert;
          const expectsAlerts: boolean =
            notificationMode !== MonitorRecommendationNotificationMode.Incident;

          for (const criteriaInstance of getBreachCriteriaInstances(
            monitorStep,
          )) {
            expect(criteriaInstance.data?.createIncidents).toBe(
              expectsIncidents,
            );
            expect(criteriaInstance.data?.createAlerts).toBe(expectsAlerts);
          }
        }
      }
    });

    it("still passes MonitorSteps.getValidationError under every mode, for every recommendation", () => {
      /*
       * `MonitorSteps.getValidationError` is the same client-side gate the
       * monitor create form runs before POSTing, and it validates the incident
       * and alert payloads regardless of whether their create flag is on. So a
       * mode implementation that "disabled" a side by blanking a title or a
       * severity id instead of clearing the flag would fail here — at submit
       * time in production, with a message about a field the user was never
       * shown, and only for the mode they happened to pick.
       */
      for (const recommendation of ALL_RECOMMENDATIONS) {
        for (const notificationMode of ALL_MODES) {
          const monitorSteps: MonitorSteps =
            MonitorRecommendationUtil.buildMonitorSteps({
              recommendation: recommendation,
              args: buildArgs(),
              defaultMonitorStatusId: DEFAULT_STATUS_ID,
              notificationSettings: { notificationMode: notificationMode },
            });

          expect(
            MonitorSteps.getValidationError(
              monitorSteps,
              recommendation.monitorType,
            ),
          ).toBeNull();
        }
      }
    });

    it("builds independent steps, so one monitor's mode does not leak into the next", () => {
      /*
       * The recommendations page creates a batch of monitors in one submit, and
       * `applyNotificationSettingsToMonitorStep` mutates the step it is given.
       * If the template modules ever returned a shared/cached criteria instance
       * instead of a fresh one, choosing Alert for one recommendation would
       * silently rewrite the flags of every monitor built before it in the same
       * batch.
       */
      const recommendation: MonitorRecommendation = ONE_PER_RESOURCE_TYPE[0]!;

      const incidentOnly: MonitorSteps =
        MonitorRecommendationUtil.buildMonitorSteps({
          recommendation: recommendation,
          args: buildArgs(),
          defaultMonitorStatusId: DEFAULT_STATUS_ID,
          notificationSettings: {
            notificationMode: MonitorRecommendationNotificationMode.Incident,
          },
        });

      MonitorRecommendationUtil.buildMonitorSteps({
        recommendation: recommendation,
        args: buildArgs(),
        defaultMonitorStatusId: DEFAULT_STATUS_ID,
        notificationSettings: {
          notificationMode: MonitorRecommendationNotificationMode.Alert,
        },
      });

      for (const criteriaInstance of getBreachCriteriaInstances(
        incidentOnly.data!.monitorStepsInstanceArray[0]!,
      )) {
        expect(criteriaInstance.data?.createIncidents).toBe(true);
        expect(criteriaInstance.data?.createAlerts).toBe(false);
      }
    });
  });
});
