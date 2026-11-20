import OnCallDutyPolicyEscalationRuleTeam from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleUser from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import ActivationMilestone from "../../../Types/Analytics/ActivationMilestone";
import { MonitorRecommendationCreatePlanItem } from "../../../Types/Monitor/Recommendation/MonitorRecommendationCreateUtil";
import ObjectID from "../../../Types/ObjectID";
import { DEFAULT_ESCALATE_AFTER_IN_MINUTES } from "../../../Types/OnCallDutyPolicy/EscalationRuleDefaults";
import {
  MAX_LEVEL_WAIT_IN_MINUTES,
  MAX_POLICY_REPEAT_TIMES,
  OnCallPolicyLevelCreate,
  OnCallPolicyLevelMembers,
  buildLevelMembers,
  buildLevelWait,
  buildOnCallPolicyLevel,
  buildPolicyRepeat,
  readLevelWaitInMinutes,
  readPolicyRepeatTimes,
} from "../../../Utils/GuidedSetup/OnCallPolicyRecords";
import {
  ServiceMonitorDefaultMissing,
  TELEMETRY_RECOMMENDED_TEMPLATE_IDS,
  buildServiceMonitorArgs,
  buildServiceMonitorPlan,
  getServiceRecommendation,
  getTelemetryRecommendations,
  getTelemetryRecommendedTemplateIds,
  pickServiceMonitorDefaults,
} from "../../../Utils/GuidedSetup/ServiceMonitorRecords";
import { MonitorRecommendationNotificationMode } from "../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import { describe, expect, test } from "@jest/globals";

/*
 * THE RECORDS TWO WAYS IN SHARE (#7244, #7243).
 *
 * The guided on-call setup and Ask AI write a policy's levels, waits and
 * repeats with Common's OnCallPolicyRecords; the telemetry guided setup,
 * the Recommendations tabs and Ask AI pick and build a service's monitors
 * with ServiceMonitorRecords. These pin what each builds, so a change to
 * one way in is a change to both.
 */

const PROJECT: ObjectID = new ObjectID("78780000-0000-4000-8000-000000000001");
const POLICY: ObjectID = new ObjectID("78780000-0000-4000-8000-000000000002");
const RULE: ObjectID = new ObjectID("78780000-0000-4000-8000-000000000003");
const ANA: string = "78780000-0000-4000-8000-000000000004";
const TEAM: string = "78780000-0000-4000-8000-000000000005";
const SERVICE: string = "78780000-0000-4000-8000-000000000006";

describe("a policy's levels, waits and repeats", () => {
  test("a new level pages who is picked, after a new escalation rule's default wait", () => {
    const level: OnCallPolicyLevelCreate = buildOnCallPolicyLevel({
      projectId: PROJECT,
      policyId: POLICY,
      userIds: [ANA],
      teamIds: [TEAM],
    });

    expect(level.rule.projectId?.toString()).toBe(PROJECT.toString());
    expect(level.rule.onCallDutyPolicyId?.toString()).toBe(POLICY.toString());
    expect(level.rule.escalateAfterInMinutes).toBe(
      DEFAULT_ESCALATE_AFTER_IN_MINUTES,
    );
    // Named after its level by the server, as any rule created without a name.
    expect(level.rule.name).toBeUndefined();
    expect(level.miscDataProps).toEqual({ users: [ANA], teams: [TEAM] });

    // The project is the request's when none is given.
    expect(
      buildOnCallPolicyLevel({ policyId: POLICY, userIds: [], teamIds: [] })
        .rule.projectId,
    ).toBeUndefined();
  });

  test("a wait, and starting over, are the updates the policy's own forms save", () => {
    expect(buildLevelWait(5)).toEqual({ escalateAfterInMinutes: 5 });
    expect(buildPolicyRepeat(3)).toEqual({
      repeatPolicyIfNoOneAcknowledges: true,
      repeatPolicyIfNoOneAcknowledgesNoOfTimes: 3,
    });
  });

  test("people and teams added to a level are a row each, on its rule and policy", () => {
    const members: OnCallPolicyLevelMembers = buildLevelMembers({
      projectId: PROJECT,
      policyId: POLICY,
      ruleId: RULE,
      userIds: [ANA],
      teamIds: [TEAM],
    });

    expect(members.users).toHaveLength(1);
    expect(members.teams).toHaveLength(1);

    const user: OnCallDutyPolicyEscalationRuleUser = members.users[0]!;
    const team: OnCallDutyPolicyEscalationRuleTeam = members.teams[0]!;

    expect(user.userId?.toString()).toBe(ANA);
    expect(user.onCallDutyPolicyEscalationRuleId?.toString()).toBe(
      RULE.toString(),
    );
    expect(user.onCallDutyPolicyId?.toString()).toBe(POLICY.toString());
    expect(user.projectId?.toString()).toBe(PROJECT.toString());
    expect(team.teamId?.toString()).toBe(TEAM);
    expect(team.onCallDutyPolicyEscalationRuleId?.toString()).toBe(
      RULE.toString(),
    );
  });

  test("a wait is 1 to 1440 whole minutes, and the repeats 1 to 10 - the guided setup's own bounds", () => {
    expect(MAX_LEVEL_WAIT_IN_MINUTES).toBe(1440);
    expect(MAX_POLICY_REPEAT_TIMES).toBe(10);
    expect(readLevelWaitInMinutes(5)).toBe(5);
    expect(readLevelWaitInMinutes("5")).toBe(5);
    expect(readLevelWaitInMinutes(0)).toBeNull();
    expect(readLevelWaitInMinutes(1441)).toBeNull();
    expect(readLevelWaitInMinutes(2.5)).toBeNull();
    expect(readPolicyRepeatTimes(1)).toBe(1);
    expect(readPolicyRepeatTimes(10)).toBe(10);
    expect(readPolicyRepeatTimes(11)).toBeNull();
    expect(readPolicyRepeatTimes("twice")).toBeNull();
  });
});

describe("a service's recommended monitors", () => {
  test("the monitors offered follow the project's first data, or the setup's three when it is not known", () => {
    expect(getTelemetryRecommendedTemplateIds(null)).toEqual([
      ...TELEMETRY_RECOMMENDED_TEMPLATE_IDS,
    ]);
    expect(
      getTelemetryRecommendedTemplateIds([
        ActivationMilestone.FirstLogsReceived,
      ]),
    ).toEqual(["service-unhandled-exceptions", "service-error-log-spike"]);
    expect(
      getTelemetryRecommendations([
        ActivationMilestone.FirstTracesReceived,
      ]).map((recommendation: { templateId: string }): string => {
        return recommendation.templateId;
      }),
    ).toEqual(["service-error-burst", "service-unhandled-exceptions"]);
    expect(getServiceRecommendation("service-error-burst")?.name).toBe(
      "Error Burst",
    );
    expect(getServiceRecommendation("no-such-template")).toBeNull();
  });

  test("the defaults are a Recommendations tab's: the first operational and offline status, the first severities - else what is missing", () => {
    const id: (value: string) => ObjectID = (value: string): ObjectID => {
      return new ObjectID(value);
    };
    const operational: string = "78780000-0000-4000-8000-0000000000a1";
    const offline: string = "78780000-0000-4000-8000-0000000000a2";
    const incident: string = "78780000-0000-4000-8000-0000000000a3";
    const alert: string = "78780000-0000-4000-8000-0000000000a4";

    expect(
      pickServiceMonitorDefaults({
        statuses: [
          { id: id("78780000-0000-4000-8000-0000000000a9") },
          { id: id(operational), isOperationalState: true },
          { id: id(offline), isOfflineState: true },
        ],
        incidentSeverities: [{ id: id(incident) }],
        alertSeverities: [{ id: id(alert) }],
      }),
    ).toEqual({
      defaults: {
        onlineMonitorStatusId: id(operational),
        offlineMonitorStatusId: id(offline),
        defaultMonitorStatusId: id(operational),
        defaultIncidentSeverityId: id(incident),
        defaultAlertSeverityId: id(alert),
      },
    });

    expect(
      pickServiceMonitorDefaults({
        statuses: [{ id: id(offline), isOfflineState: true }],
        incidentSeverities: [{ id: id(incident) }],
        alertSeverities: [{ id: id(alert) }],
      }),
    ).toEqual({ missing: ServiceMonitorDefaultMissing.OperationalStatus });
    expect(
      pickServiceMonitorDefaults({
        statuses: [{ id: id(operational), isOperationalState: true }],
        incidentSeverities: [{ id: id(incident) }],
        alertSeverities: [{ id: id(alert) }],
      }),
    ).toEqual({ missing: ServiceMonitorDefaultMissing.OfflineStatus });
    expect(
      pickServiceMonitorDefaults({
        statuses: [
          { id: id(operational), isOperationalState: true },
          { id: id(offline), isOfflineState: true },
        ],
        incidentSeverities: [],
        alertSeverities: [{ id: id(alert) }],
      }),
    ).toEqual({ missing: ServiceMonitorDefaultMissing.IncidentSeverity });
    expect(
      pickServiceMonitorDefaults({
        statuses: [
          { id: id(operational), isOperationalState: true },
          { id: id(offline), isOfflineState: true },
        ],
        incidentSeverities: [{ id: id(incident) }],
        alertSeverities: [],
      }),
    ).toEqual({ missing: ServiceMonitorDefaultMissing.AlertSeverity });
  });

  test("each monitor opens an alert for the team, on the service, named after it", () => {
    const defaults: {
      onlineMonitorStatusId: ObjectID;
      offlineMonitorStatusId: ObjectID;
      defaultMonitorStatusId: ObjectID;
      defaultIncidentSeverityId: ObjectID;
      defaultAlertSeverityId: ObjectID;
    } = {
      onlineMonitorStatusId: ObjectID.generate(),
      offlineMonitorStatusId: ObjectID.generate(),
      defaultMonitorStatusId: ObjectID.generate(),
      defaultIncidentSeverityId: ObjectID.generate(),
      defaultAlertSeverityId: ObjectID.generate(),
    };
    const recommendation: ReturnType<typeof getServiceRecommendation> =
      getServiceRecommendation("service-error-burst")!;

    expect(
      buildServiceMonitorArgs({
        service: { id: SERVICE, name: "checkout" },
        defaults: defaults,
      }),
    ).toEqual({
      resourceIdentifier: SERVICE,
      onlineMonitorStatusId: defaults.onlineMonitorStatusId,
      offlineMonitorStatusId: defaults.offlineMonitorStatusId,
      defaultIncidentSeverityId: defaults.defaultIncidentSeverityId,
      defaultAlertSeverityId: defaults.defaultAlertSeverityId,
      monitorName: "checkout",
    });

    const plan: Array<MonitorRecommendationCreatePlanItem> =
      buildServiceMonitorPlan({
        service: { id: SERVICE, name: "checkout" },
        recommendations: [recommendation],
        recommendationIds: [recommendation.recommendationId],
        defaults: defaults,
      });

    expect(plan).toHaveLength(1);
    expect(plan[0]!.monitor.name).toBe("checkout - Error Burst");
    expect(plan[0]!.miscDataProps).toEqual({});

    // Alerts only: every criteria that opens something opens an alert.
    for (const step of plan[0]!.monitor.monitorSteps?.data
      ?.monitorStepsInstanceArray || []) {
      for (const criteria of step.data?.monitorCriteria.data
        ?.monitorCriteriaInstanceArray || []) {
        expect(criteria.data?.createIncidents).toBe(false);
      }
    }
    expect(MonitorRecommendationNotificationMode.Alert).toBe("Alert");
  });
});
