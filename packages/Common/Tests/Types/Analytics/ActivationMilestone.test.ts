import ActivationMilestone, {
  ACTIVATION_EVENT_AREA,
  ACTIVATION_MILESTONE_DETAILS,
  ACTIVATION_MILESTONE_OF_TELEMETRY_KIND,
  ACTIVATION_SETUP_STEPS,
  ACTIVATION_SET_UP_TEXT,
  ALL_ACTIVATION_MILESTONES,
  ActivationMilestoneDetail,
  ActivationSetupSummary,
  ActivationTelemetryKind,
  DELIVERED_NOTIFICATION_STATUSES,
  getActivationMilestoneDetail,
  getActivationMilestoneEventName,
  getActivationSetupSummary,
  getActivationStuckAt,
  isActivationMilestone,
  isNotificationDeliveredStatus,
} from "../../../Types/Analytics/ActivationMilestone";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";
import { describe, expect, test } from "@jest/globals";

/*
 * The activation milestones' own vocabulary (issue #6830). A value is the
 * stored string AND the second half of an event's name, so these pin that
 * every value is a name the rule allows, that each has its words, and the
 * small rules the Admin Dashboard and the notification hook read.
 */

const SNAKE_CASE: RegExp = /^[a-z]+(_[a-z]+)*$/;

describe("ActivationMilestone", () => {
  test("every value is a lower-case, underscore name, unique, and short enough for its column", () => {
    const values: Array<string> = Object.values(ActivationMilestone);

    expect(new Set(values).size).toBe(values.length);

    for (const value of values) {
      expect(value).toMatch(SNAKE_CASE);
      expect(value.length).toBeLessThanOrEqual(100);
    }
  });

  test("every milestone has its words, once, and the list holds nothing else", () => {
    const listed: Array<ActivationMilestone> = ACTIVATION_MILESTONE_DETAILS.map(
      (detail: ActivationMilestoneDetail): ActivationMilestone => {
        return detail.milestone;
      },
    );

    expect([...listed].sort()).toEqual(
      [...Object.values(ActivationMilestone)].sort(),
    );
    expect(new Set(listed).size).toBe(listed.length);
    expect(ALL_ACTIVATION_MILESTONES).toEqual(listed);

    for (const detail of ACTIVATION_MILESTONE_DETAILS) {
      expect(detail.title.trim().length).toBeGreaterThan(0);
      expect(detail.missingText.trim().length).toBeGreaterThan(0);
      expect(getActivationMilestoneDetail(detail.milestone)).toBe(detail);
    }
  });

  test("the first-hour milestones are listed in the order a project meets them", () => {
    const order: Array<ActivationMilestone> = [...ALL_ACTIVATION_MILESTONES];

    expect(order.indexOf(ActivationMilestone.FirstMonitorCreated)).toBe(0);
    expect(
      order.indexOf(ActivationMilestone.FirstCheckResultReceived),
    ).toBeGreaterThan(order.indexOf(ActivationMilestone.FirstMonitorCreated));
    expect(
      order.indexOf(ActivationMilestone.FirstNotificationDelivered),
    ).toBeGreaterThan(
      order.indexOf(ActivationMilestone.FirstCheckResultReceived),
    );
  });

  test("an event's name is activation/<milestone>", () => {
    expect(ACTIVATION_EVENT_AREA).toBe("activation");

    for (const milestone of ALL_ACTIVATION_MILESTONES) {
      expect(getActivationMilestoneEventName(milestone)).toBe(
        `activation/${milestone}`,
      );
    }

    expect(
      getActivationMilestoneEventName(ActivationMilestone.FirstMonitorCreated),
    ).toBe("activation/first_monitor_created");
  });

  test("isActivationMilestone knows the values and nothing else", () => {
    for (const milestone of ALL_ACTIVATION_MILESTONES) {
      expect(isActivationMilestone(milestone)).toBe(true);
    }

    for (const value of [
      "",
      "FirstMonitorCreated",
      "first_monitor",
      "activation/first_monitor_created",
      null,
      undefined,
      1,
      {},
    ]) {
      expect(isActivationMilestone(value)).toBe(false);
    }
  });

  describe("where a project is stuck", () => {
    test("the setup steps are a monitor, its result, and a person reached", () => {
      expect(ACTIVATION_SETUP_STEPS).toEqual([
        ActivationMilestone.FirstMonitorCreated,
        ActivationMilestone.FirstCheckResultReceived,
        ActivationMilestone.FirstNotificationDelivered,
      ]);
    });

    test("a new project is stuck at its first monitor", () => {
      expect(getActivationStuckAt([])).toBe(
        ActivationMilestone.FirstMonitorCreated,
      );
      expect(getActivationSetupSummary([])).toEqual({
        stuckAt: ActivationMilestone.FirstMonitorCreated,
        isSetUp: false,
        text: "No monitor yet",
      });
    });

    test("each step reached moves it to the next, in order, whatever else it has", () => {
      expect(
        getActivationStuckAt([
          ActivationMilestone.FirstMonitorCreated,
          ActivationMilestone.FirstLogsReceived,
          ActivationMilestone.SecondMemberJoined,
        ]),
      ).toBe(ActivationMilestone.FirstCheckResultReceived);

      const summary: ActivationSetupSummary = getActivationSetupSummary(
        new Set([
          ActivationMilestone.FirstMonitorCreated,
          ActivationMilestone.FirstCheckResultReceived,
        ]),
      );

      expect(summary.stuckAt).toBe(
        ActivationMilestone.FirstNotificationDelivered,
      );
      expect(summary.text).toBe("Nobody reachable yet");
      expect(summary.isSetUp).toBe(false);
    });

    test("a step reached out of order does not skip the one before it", () => {
      expect(
        getActivationStuckAt([
          ActivationMilestone.FirstNotificationDelivered,
          ActivationMilestone.FirstCheckResultReceived,
        ]),
      ).toBe(ActivationMilestone.FirstMonitorCreated);
    });

    test("a project with every step is set up", () => {
      const summary: ActivationSetupSummary = getActivationSetupSummary([
        ...ACTIVATION_SETUP_STEPS,
      ]);

      expect(summary).toEqual({
        stuckAt: null,
        isSetUp: true,
        text: ACTIVATION_SET_UP_TEXT,
      });
      expect(getActivationStuckAt(new Set(ALL_ACTIVATION_MILESTONES))).toBe(
        null,
      );
    });
  });

  describe("a delivered on-call notification", () => {
    test("is one the provider accepted, one answered, passed on or a call that rang", () => {
      expect([...DELIVERED_NOTIFICATION_STATUSES].sort()).toEqual(
        [
          UserNotificationStatus.Sent,
          UserNotificationStatus.Acknowledged,
          UserNotificationStatus.PassedOn,
          UserNotificationStatus.NotAnswered,
        ].sort(),
      );

      for (const status of DELIVERED_NOTIFICATION_STATUSES) {
        expect(isNotificationDeliveredStatus(status)).toBe(true);
      }
    });

    test("is never one still on its way, one that failed or one skipped", () => {
      for (const status of [
        UserNotificationStatus.Sending,
        UserNotificationStatus.Error,
        UserNotificationStatus.Skipped,
        "",
        null,
        undefined,
        "sent",
      ]) {
        expect(isNotificationDeliveredStatus(status)).toBe(false);
      }
    });

    test("every status is decided one way or the other", () => {
      const decided: Array<string> = [
        ...DELIVERED_NOTIFICATION_STATUSES,
        UserNotificationStatus.Sending,
        UserNotificationStatus.Error,
        UserNotificationStatus.Skipped,
      ];

      expect([...decided].sort()).toEqual(
        [...Object.values(UserNotificationStatus)].sort(),
      );
    });
  });

  test("every telemetry kind has its own milestone", () => {
    const milestones: Array<ActivationMilestone> = Object.values(
      ActivationTelemetryKind,
    ).map((kind: ActivationTelemetryKind): ActivationMilestone => {
      return ACTIVATION_MILESTONE_OF_TELEMETRY_KIND[kind];
    });

    expect(new Set(milestones).size).toBe(
      Object.values(ActivationTelemetryKind).length,
    );
    expect(milestones.sort()).toEqual(
      [
        ActivationMilestone.FirstLogsReceived,
        ActivationMilestone.FirstTracesReceived,
        ActivationMilestone.FirstMetricsReceived,
        ActivationMilestone.FirstExceptionsReceived,
        ActivationMilestone.FirstProfilesReceived,
      ].sort(),
    );
  });
});
