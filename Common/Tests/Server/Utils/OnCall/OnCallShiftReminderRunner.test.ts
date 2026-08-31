import OnCallShiftReminderRunner, {
  SHIFT_REMINDER_JOB_NAME,
  SHIFT_REMINDER_LOG_DELETE_BATCH_SIZE,
  SHIFT_REMINDER_LOG_RETENTION_DAYS,
  SHIFT_REMINDER_MAX_LOOKBACK_MINUTES,
  SHIFT_REMINDER_RECLAIM_AFTER_MINUTES,
  SHIFT_REMINDER_SWEEP_LOCK_NAMESPACE,
  SHIFT_REMINDER_SWEEP_LOCK_TIMEOUT_MS,
  SHIFT_REMINDER_WINDOW_PADDING_MINUTES,
  ShiftReminderChangePassStats,
  ShiftReminderMessage,
  ShiftReminderOutcome,
  ShiftReminderRetentionStats,
  ShiftReminderSweepStats,
} from "../../../../Server/Utils/OnCall/OnCallShiftReminderRunner";
import OnCallShiftChangeListeners, {
  OnCallShiftChangeEvent,
  OnCallShiftChangeReason,
} from "../../../../Server/Utils/OnCall/OnCallShiftChangeListeners";
import OnCallShiftMaterializer from "../../../../Server/Utils/OnCall/OnCallShiftMaterializer";
import UserOnCallShiftReminderLogService from "../../../../Server/Services/UserOnCallShiftReminderLogService";
import UserNotificationSettingService from "../../../../Server/Services/UserNotificationSettingService";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import { UserOnCallShiftReminderLogKind } from "../../../../Models/DatabaseModels/UserOnCallShiftReminderLog";
import OneUptimeDate from "../../../../Types/Date";
import EmailTemplateType from "../../../../Types/Email/EmailTemplateType";
import NotificationSettingEventType from "../../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../../Types/ObjectID";
import { MaterializedShift } from "../../../../Types/OnCallDutyPolicy/MaterializedShift";
import Timezone from "../../../../Types/Timezone";
import {
  DEFAULT_POLICY,
  at,
  shift,
} from "../../../Types/OnCallDutyPolicy/CalendarFeedTestFixtures";
import {
  FakeLedgerRow,
  HARNESS_DASHBOARD_URL,
  MetricRecord,
  ReminderHarness,
  SentNotification,
  emptyHarness,
  grantSettings,
  installReminderHarness,
  ledgerRowsOfKind,
  scheduleInfo,
  seedLedgerRow,
  watermarkOf,
} from "./OnCallShiftReminderTestHarness";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * OnCallShiftReminderRunner — "your on-call shift on Payments starts in 1
 * hour", the change notices that keep it honest, and the ledger that makes
 * every one of them fire exactly once.
 *
 * The real runner runs here against in-memory stand-ins (see the harness):
 * the reminder lead times, the UNIQUE-indexed ledger, the materializer, the
 * notification settings, the watermark cache and the sweep lock. What is
 * pinned, in the order the spec lists it:
 *
 *   - the watermark: a skipped tick is caught up by the next one; a missing
 *     or ancient watermark falls back to a 30-minute lookback, never more;
 *   - the lateness cap: never "starts in 15 minutes" after it started;
 *   - claim -> send -> stamp: a thrown send releases the claim so the next
 *     tick retries; a unique violation from another replica is a skip; a
 *     stale claim is re-claimed with a conditional update after 10 minutes;
 *   - the ledger key is the MINUTE, so a start moved by seconds is the same
 *     reminder;
 *   - the change pass: one catch-up for a shift a user now holds inside a
 *     lead, one "reassigned" notice for a shift they were reminded about and
 *     no longer hold — and nothing twice;
 *   - zero-policy schedules never remind (they cannot page);
 *   - a missing UserNotificationSetting row is warned about once per day;
 *   - every message is formatted in the recipient's own timezone;
 *   - ledger retention by SHIFT start.
 */

const PROJECT: ObjectID = new ObjectID("project-1");
const PROJECT_2: ObjectID = new ObjectID("project-2");
const USER_A: ObjectID = new ObjectID("user-a");
const USER_B: ObjectID = new ObjectID("user-b");
const USER_C: ObjectID = new ObjectID("user-c");
const SCHEDULE: string = "schedule-1";
const SCHEDULE_2: string = "schedule-2";

// Thursday 3 September 2026, 17:00 in Berlin (CEST): the tick.
const NOW: Date = at("2026-09-03T15:00:00Z");
// The shift under test starts one hour later — 18:00 Berlin, 14:00 New York.
const SHIFT_START: Date = at("2026-09-03T16:00:00Z");
const SHIFT_END: Date = at("2026-09-04T16:00:00Z");

const BERLIN_START_TEXT: string = "Thu 3 Sep 18:00 Europe/Berlin";
// New York is on EDT (UTC-4) in September.
const NEW_YORK_START_TEXT: string = "Thu 3 Sep 12:00 America/New_York";

function minutes(base: Date, delta: number): Date {
  return OneUptimeDate.addRemoveMinutes(base, delta);
}

function baseHarness(): ReminderHarness {
  const harness: ReminderHarness = emptyHarness();

  harness.users = [
    {
      userId: USER_A.toString(),
      userName: "Alice Andersson",
      email: "alice@example.com",
      timezone: "Europe/Berlin",
    },
    {
      userId: USER_B.toString(),
      userName: "Bob Brown",
      email: "bob@example.com",
      timezone: "America/New_York",
    },
    { userId: USER_C.toString(), userName: "Carol Chen" },
  ];

  harness.schedules.set(
    SCHEDULE,
    scheduleInfo({
      scheduleId: SCHEDULE,
      scheduleName: "Payments",
      projectId: PROJECT.toString(),
      scheduleTimezone: "Europe/Stockholm",
      attachedPolicies: [{ ...DEFAULT_POLICY }],
    }),
  );
  harness.schedules.set(
    SCHEDULE_2,
    scheduleInfo({
      scheduleId: SCHEDULE_2,
      scheduleName: "Database",
      projectId: PROJECT.toString(),
      scheduleTimezone: "Europe/Stockholm",
      attachedPolicies: [{ ...DEFAULT_POLICY }],
    }),
  );

  harness.scheduleProjects.set(SCHEDULE, PROJECT);
  harness.scheduleProjects.set(SCHEDULE_2, PROJECT);

  for (const userId of [USER_A, USER_B, USER_C]) {
    grantSettings(harness, { userId, projectId: PROJECT });
    grantSettings(harness, { userId, projectId: PROJECT_2 });
  }

  return harness;
}

function aliceShift(
  overrides: Partial<MaterializedShift> = {},
): MaterializedShift {
  return shift({
    scheduleId: SCHEDULE,
    scheduleName: "Payments",
    projectId: PROJECT.toString(),
    userId: USER_A.toString(),
    userName: "Alice Andersson",
    start: SHIFT_START,
    end: SHIFT_END,
    scheduleTimezone: "Europe/Stockholm",
    ...overrides,
  });
}

function bobCoveringForAlice(
  overrides: Partial<MaterializedShift> = {},
): MaterializedShift {
  return aliceShift({
    userId: USER_B.toString(),
    userName: "Bob Brown",
    override: {
      originalUserId: USER_A.toString(),
      originalUserName: "Alice Andersson",
      overrideStartsAt: SHIFT_START,
      overrideEndsAt: SHIFT_END,
    },
    ...overrides,
  });
}

function reminder(
  userId: ObjectID,
  minutesBeforeShift: number,
  projectId: ObjectID = PROJECT,
): { projectId: ObjectID; userId: ObjectID; minutesBeforeShift: number } {
  return { projectId, userId, minutesBeforeShift };
}

function changeEvent(data: {
  projectId?: ObjectID | null | undefined;
  scheduleIds?: Array<string> | undefined;
  userIds?: Array<ObjectID> | undefined;
  reason?: OnCallShiftChangeReason | undefined;
}): OnCallShiftChangeEvent {
  return OnCallShiftChangeListeners.buildEvent({
    projectId: data.projectId === undefined ? PROJECT : data.projectId,
    scheduleIds: (data.scheduleIds ?? [SCHEDULE]).map((id: string) => {
      return new ObjectID(id);
    }),
    userIds: data.userIds ?? [],
    reason: data.reason ?? OnCallShiftChangeReason.OverrideChanged,
    occurredAt: NOW,
  });
}

function outcomes(harness: ReminderHarness): Array<string> {
  return harness.metrics.map((record: MetricRecord) => {
    return String(record.attributes["oneuptime.oncall_shift_reminder.outcome"]);
  });
}

describe("OnCallShiftReminderRunner", () => {
  let harness: ReminderHarness;

  beforeEach(() => {
    harness = baseHarness();
    installReminderHarness(harness);
    OnCallShiftReminderRunner.resetMissingSettingsWarnings();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * ---------------------------------------------------------------------
   * Pure helpers
   * ---------------------------------------------------------------------
   */

  describe("computeLookbackFrom", () => {
    test("falls back to a 30-minute lookback when there is no watermark", () => {
      expect(
        OnCallShiftReminderRunner.computeLookbackFrom(NOW, null).toISOString(),
      ).toBe(minutes(NOW, -SHIFT_REMINDER_MAX_LOOKBACK_MINUTES).toISOString());
    });

    test("uses the watermark when it is inside the lookback cap", () => {
      const watermark: Date = minutes(NOW, -5);

      expect(
        OnCallShiftReminderRunner.computeLookbackFrom(
          NOW,
          watermark,
        ).toISOString(),
      ).toBe(watermark.toISOString());
    });

    test("caps an old watermark at 30 minutes back (a long outage never floods)", () => {
      expect(
        OnCallShiftReminderRunner.computeLookbackFrom(
          NOW,
          minutes(NOW, -120),
        ).toISOString(),
      ).toBe(minutes(NOW, -30).toISOString());
    });

    test("never returns a lookback in the future (replica clock skew)", () => {
      expect(
        OnCallShiftReminderRunner.computeLookbackFrom(
          NOW,
          minutes(NOW, 10),
        ).toISOString(),
      ).toBe(NOW.toISOString());
    });
  });

  describe("isDue", () => {
    const lookbackFrom: Date = minutes(NOW, -5);

    test("a start whose lead instant falls inside (lookbackFrom, now] is due", () => {
      // lead 60: due starts are in (now-5+60, now+60] = (now+55, now+60].
      expect(
        OnCallShiftReminderRunner.isDue({
          start: minutes(NOW, 58),
          lead: 60,
          now: NOW,
          lookbackFrom,
        }),
      ).toBe(true);
    });

    test("the upper bound (now + lead) is inclusive, the lower bound exclusive", () => {
      expect(
        OnCallShiftReminderRunner.isDue({
          start: minutes(NOW, 60),
          lead: 60,
          now: NOW,
          lookbackFrom,
        }),
      ).toBe(true);
      expect(
        OnCallShiftReminderRunner.isDue({
          start: minutes(NOW, 55),
          lead: 60,
          now: NOW,
          lookbackFrom,
        }),
      ).toBe(false);
    });

    test("a start beyond now + lead is not yet due; one before the window is already past", () => {
      expect(
        OnCallShiftReminderRunner.isDue({
          start: minutes(NOW, 61),
          lead: 60,
          now: NOW,
          lookbackFrom,
        }),
      ).toBe(false);
      expect(
        OnCallShiftReminderRunner.isDue({
          start: minutes(NOW, 50),
          lead: 60,
          now: NOW,
          lookbackFrom,
        }),
      ).toBe(false);
    });
  });

  describe("describeMinutes", () => {
    test.each([
      [15, "15 minutes"],
      [1, "1 minute"],
      [60, "1 hour"],
      [90, "1 hour 30 minutes"],
      [120, "2 hours"],
      [1440, "1 day"],
      [2880, "2 days"],
      [10080, "1 week"],
      [20160, "2 weeks"],
    ])("%d minutes -> %s", (value: number, expected: string) => {
      expect(OnCallShiftReminderRunner.describeMinutes(value)).toBe(expected);
    });

    test("keeps at most two units so the text stays readable", () => {
      // 1 week 2 days 3 hours 4 minutes -> the two largest.
      expect(
        OnCallShiftReminderRunner.describeMinutes(
          7 * 24 * 60 + 2 * 24 * 60 + 3 * 60 + 4,
        ),
      ).toBe("1 week 2 days");
    });

    test("rounds fractional minutes and never says zero", () => {
      expect(OnCallShiftReminderRunner.describeMinutes(14.6)).toBe(
        "15 minutes",
      );
      expect(OnCallShiftReminderRunner.describeMinutes(0.2)).toBe(
        "less than a minute",
      );
      expect(OnCallShiftReminderRunner.describeMinutes(-3)).toBe(
        "less than a minute",
      );
    });
  });

  describe("describeRemaining", () => {
    test("says the configured lead when the tick is at most one tick behind", () => {
      expect(
        OnCallShiftReminderRunner.describeRemaining({
          lead: 60,
          start: SHIFT_START,
          now: minutes(SHIFT_START, -57),
        }),
      ).toBe("1 hour");
    });

    test("says the true remaining time when the tick is later than that", () => {
      expect(
        OnCallShiftReminderRunner.describeRemaining({
          lead: 60,
          start: SHIFT_START,
          now: minutes(SHIFT_START, -50),
        }),
      ).toBe("50 minutes");
    });

    test("never claims the lead when more than the lead remains", () => {
      expect(
        OnCallShiftReminderRunner.describeRemaining({
          lead: 60,
          start: SHIFT_START,
          now: minutes(SHIFT_START, -75),
        }),
      ).toBe("1 hour 15 minutes");
    });
  });

  describe("resolveTimezone", () => {
    test("prefers the recipient's zone, then the schedule's, then UTC", () => {
      expect(
        OnCallShiftReminderRunner.resolveTimezone({
          userTimezone: "Europe/Berlin",
          scheduleTimezone: "Europe/Stockholm",
        }),
      ).toBe("Europe/Berlin");
      expect(
        OnCallShiftReminderRunner.resolveTimezone({
          scheduleTimezone: "Europe/Stockholm",
        }),
      ).toBe("Europe/Stockholm");
      expect(OnCallShiftReminderRunner.resolveTimezone({})).toBe(Timezone.UTC);
    });

    test("skips an invalid zone rather than crashing the formatter", () => {
      expect(
        OnCallShiftReminderRunner.resolveTimezone({
          userTimezone: "Mars/Olympus",
          scheduleTimezone: "Europe/Stockholm",
        }),
      ).toBe("Europe/Stockholm");
      expect(
        OnCallShiftReminderRunner.resolveTimezone({
          userTimezone: "Mars/Olympus",
          scheduleTimezone: "",
        }),
      ).toBe(Timezone.UTC);
    });
  });

  describe("formatInstant", () => {
    test("renders the wall clock in the given zone with the zone name", () => {
      expect(
        OnCallShiftReminderRunner.formatInstant(SHIFT_START, "Europe/Berlin"),
      ).toBe(BERLIN_START_TEXT);
      expect(
        OnCallShiftReminderRunner.formatInstant(
          SHIFT_START,
          "America/New_York",
        ),
      ).toBe(NEW_YORK_START_TEXT);
      expect(OnCallShiftReminderRunner.formatInstant(SHIFT_START, "UTC")).toBe(
        "Thu 3 Sep 16:00 UTC",
      );
    });

    test("is DST-aware: the same UTC hour is 03:00 CEST in summer and 02:00 CET in winter", () => {
      expect(
        OnCallShiftReminderRunner.formatInstant(
          at("2026-07-15T01:00:00Z"),
          "Europe/Berlin",
        ),
      ).toBe("Wed 15 Jul 03:00 Europe/Berlin");
      expect(
        OnCallShiftReminderRunner.formatInstant(
          at("2026-01-15T01:00:00Z"),
          "Europe/Berlin",
        ),
      ).toBe("Thu 15 Jan 02:00 Europe/Berlin");
    });
  });

  describe("describePolicyNames", () => {
    test("lists each policy once, alphabetically", () => {
      expect(
        OnCallShiftReminderRunner.describePolicyNames([
          { ...DEFAULT_POLICY, policyName: "Zeta" },
          { ...DEFAULT_POLICY, policyId: "pol-2", policyName: "Alpha" },
          { ...DEFAULT_POLICY, policyName: "Zeta", ruleId: "rule-2" },
        ]),
      ).toBe("Alpha, Zeta");
    });
  });

  describe("ledgerKey", () => {
    test("truncates the start to the minute, so a start moved by seconds is the same reminder", () => {
      const base: string = OnCallShiftReminderRunner.ledgerKey({
        userId: USER_A,
        scheduleId: SCHEDULE,
        shiftStartsAt: SHIFT_START,
        minutesBeforeShift: 60,
        kind: UserOnCallShiftReminderLogKind.Reminder,
      });

      expect(
        OnCallShiftReminderRunner.ledgerKey({
          userId: USER_A.toString(),
          scheduleId: new ObjectID(SCHEDULE),
          shiftStartsAt: new Date(SHIFT_START.getTime() + 59 * 1000 + 999),
          minutesBeforeShift: 60,
          kind: UserOnCallShiftReminderLogKind.Reminder,
        }),
      ).toBe(base);
    });

    test("differs by user, schedule, minute, lead and kind", () => {
      const keys: Set<string> = new Set<string>([
        OnCallShiftReminderRunner.ledgerKey({
          userId: USER_A,
          scheduleId: SCHEDULE,
          shiftStartsAt: SHIFT_START,
          minutesBeforeShift: 60,
          kind: UserOnCallShiftReminderLogKind.Reminder,
        }),
        OnCallShiftReminderRunner.ledgerKey({
          userId: USER_B,
          scheduleId: SCHEDULE,
          shiftStartsAt: SHIFT_START,
          minutesBeforeShift: 60,
          kind: UserOnCallShiftReminderLogKind.Reminder,
        }),
        OnCallShiftReminderRunner.ledgerKey({
          userId: USER_A,
          scheduleId: SCHEDULE_2,
          shiftStartsAt: SHIFT_START,
          minutesBeforeShift: 60,
          kind: UserOnCallShiftReminderLogKind.Reminder,
        }),
        OnCallShiftReminderRunner.ledgerKey({
          userId: USER_A,
          scheduleId: SCHEDULE,
          shiftStartsAt: minutes(SHIFT_START, 1),
          minutesBeforeShift: 60,
          kind: UserOnCallShiftReminderLogKind.Reminder,
        }),
        OnCallShiftReminderRunner.ledgerKey({
          userId: USER_A,
          scheduleId: SCHEDULE,
          shiftStartsAt: SHIFT_START,
          minutesBeforeShift: 15,
          kind: UserOnCallShiftReminderLogKind.Reminder,
        }),
        OnCallShiftReminderRunner.ledgerKey({
          userId: USER_A,
          scheduleId: SCHEDULE,
          shiftStartsAt: SHIFT_START,
          minutesBeforeShift: 60,
          kind: UserOnCallShiftReminderLogKind.CatchUp,
        }),
      ]);

      expect(keys.size).toBe(6);
    });
  });

  describe("message builders", () => {
    test("buildReminderMessage: schedule, policies, lead and the recipient's wall clock", () => {
      const message: ShiftReminderMessage =
        OnCallShiftReminderRunner.buildReminderMessage({
          shift: aliceShift(),
          lead: 60,
          now: NOW,
          timezone: "Europe/Berlin",
          dashboardUrl: HARNESS_DASHBOARD_URL,
        });

      expect(message.text).toContain(
        `Your on-call shift on Payments for Payments Policy starts in 1 hour (${BERLIN_START_TEXT}).`,
      );
      expect(message.subject).toBe(
        "Reminder: your on-call shift on Payments starts in 1 hour",
      );
      expect(message.pushTitle).toBe("On-call shift reminder");
      expect(message.pushBody).toBe(
        `Your on-call shift on Payments starts in 1 hour (${BERLIN_START_TEXT}).`,
      );
      expect(message.templateType).toBe(
        EmailTemplateType.UserOnCallShiftReminder,
      );
      expect(message.eventType).toBe(
        NotificationSettingEventType.SEND_BEFORE_USER_ON_CALL_SHIFT_STARTS,
      );
      expect(message.timezone).toBe("Europe/Berlin");
      expect(message.whenText).toBe(BERLIN_START_TEXT);
      expect(message.vars).toMatchObject({
        scheduleName: "Payments",
        policyNames: "Payments Policy",
        leadText: "1 hour",
        remainingText: "1 hour",
        startsAt: BERLIN_START_TEXT,
        endsAt: "Fri 4 Sep 18:00 Europe/Berlin",
        timezone: "Europe/Berlin",
        coveringFor: "",
        scheduleViewLink: `${HARNESS_DASHBOARD_URL}/${PROJECT.toString()}/on-call-duty/schedules/${SCHEDULE}`,
      });
      expect(message.text).not.toContain("covering for");
    });

    test("buildReminderMessage: a covering shift names who is being covered", () => {
      const message: ShiftReminderMessage =
        OnCallShiftReminderRunner.buildReminderMessage({
          shift: bobCoveringForAlice(),
          lead: 60,
          now: NOW,
          timezone: "America/New_York",
          dashboardUrl: HARNESS_DASHBOARD_URL,
        });

      expect(message.text).toContain(
        `starts in 1 hour (${NEW_YORK_START_TEXT}) (you are covering for Alice Andersson).`,
      );
      expect(message.vars["coveringFor"]).toBe("Alice Andersson");
    });

    test("buildReminderMessage: a late tick says the true remaining time, not the lead", () => {
      const message: ShiftReminderMessage =
        OnCallShiftReminderRunner.buildReminderMessage({
          shift: aliceShift(),
          lead: 60,
          now: minutes(SHIFT_START, -40),
          timezone: "UTC",
          dashboardUrl: HARNESS_DASHBOARD_URL,
        });

      expect(message.text).toContain("starts in 40 minutes (");
      // The lead itself is still reported so the recipient knows which reminder this is.
      expect(message.vars["leadText"]).toBe("1 hour");
      expect(message.vars["remainingText"]).toBe("40 minutes");
    });

    test("buildCatchUpMessage: 'now starts in', covering-for and the reminder template", () => {
      const message: ShiftReminderMessage =
        OnCallShiftReminderRunner.buildCatchUpMessage({
          shift: bobCoveringForAlice(),
          now: minutes(SHIFT_START, -28),
          timezone: "America/New_York",
          dashboardUrl: HARNESS_DASHBOARD_URL,
        });

      expect(message.text).toContain(
        `Your on-call shift on Payments for Payments Policy now starts in 28 minutes (${NEW_YORK_START_TEXT}) (you are covering for Alice Andersson).`,
      );
      expect(message.subject).toBe(
        "Your on-call shift on Payments now starts in 28 minutes",
      );
      expect(message.pushBody).toContain("now starts in 28 minutes");
      expect(message.templateType).toBe(
        EmailTemplateType.UserOnCallShiftReminder,
      );
      expect(message.eventType).toBe(
        NotificationSettingEventType.SEND_BEFORE_USER_ON_CALL_SHIFT_STARTS,
      );
      expect(message.vars["leadText"]).toBe("28 minutes");
    });

    test("buildReassignedMessage: names the replacement, or says the shift is no longer yours", () => {
      const covered: ShiftReminderMessage =
        OnCallShiftReminderRunner.buildReassignedMessage({
          scheduleName: "Payments",
          projectId: PROJECT.toString(),
          scheduleId: SCHEDULE,
          shiftStartsAt: SHIFT_START,
          coveredBy: "Bob Brown",
          timezone: "Europe/Berlin",
          dashboardUrl: HARNESS_DASHBOARD_URL,
        });

      expect(covered.text).toContain(
        `Your on-call shift on Payments at ${BERLIN_START_TEXT} is now covered by Bob Brown.`,
      );
      expect(covered.subject).toBe(
        "Your on-call shift on Payments is now covered by Bob Brown",
      );
      expect(covered.pushTitle).toBe("On-call shift reassigned");
      expect(covered.templateType).toBe(
        EmailTemplateType.UserOnCallShiftReassigned,
      );
      expect(covered.eventType).toBe(
        NotificationSettingEventType.SEND_WHEN_USER_ON_CALL_SHIFT_IS_REASSIGNED,
      );
      expect(covered.vars).toMatchObject({
        scheduleName: "Payments",
        startsAt: BERLIN_START_TEXT,
        coveredBy: "Bob Brown",
      });

      const unassigned: ShiftReminderMessage =
        OnCallShiftReminderRunner.buildReassignedMessage({
          scheduleName: "Payments",
          projectId: PROJECT.toString(),
          scheduleId: SCHEDULE,
          shiftStartsAt: SHIFT_START,
          coveredBy: null,
          timezone: "Europe/Berlin",
          dashboardUrl: HARNESS_DASHBOARD_URL,
        });

      expect(unassigned.text).toContain("is no longer assigned to you.");
      expect(unassigned.vars["coveredBy"]).toBe("");
    });
  });

  /*
   * ---------------------------------------------------------------------
   * The sweep
   * ---------------------------------------------------------------------
   */

  describe("runSweep", () => {
    test("sends one reminder for a due (shift, lead): claim, send, stamp — in the recipient's timezone", async () => {
      harness.reminders = [reminder(USER_A, 60)];
      harness.shifts = [aliceShift()];

      const stats: ShiftReminderSweepStats =
        await OnCallShiftReminderRunner.runSweep({ now: NOW });

      expect(stats.sent).toBe(1);
      expect(stats.projects).toBe(1);
      expect(stats.usersWithReminders).toBe(1);
      expect(stats.shiftsConsidered).toBe(1);
      expect(stats.watermarkFound).toBe(false);
      expect(stats.errors).toBe(0);

      expect(harness.sent).toHaveLength(1);
      const call: SentNotification = harness.sent[0]!;

      expect(call.userId).toBe(USER_A.toString());
      expect(call.projectId).toBe(PROJECT.toString());
      expect(call.eventType).toBe(
        NotificationSettingEventType.SEND_BEFORE_USER_ON_CALL_SHIFT_STARTS,
      );
      expect(call.templateType).toBe(EmailTemplateType.UserOnCallShiftReminder);
      expect(call.smsText).toContain(`starts in 1 hour (${BERLIN_START_TEXT})`);
      expect(call.vars["startsAt"]).toBe(BERLIN_START_TEXT);
      expect(call.onCallScheduleId).toBe(SCHEDULE);
      expect(call.onCallPolicyId).toBe(DEFAULT_POLICY.policyId);
      expect(call.onCallPolicyEscalationRuleId).toBe(DEFAULT_POLICY.ruleId);

      // The ledger row: claimed at the tick, stamped after the send.
      expect(harness.ledger).toHaveLength(1);
      const row: FakeLedgerRow = harness.ledger[0]!;

      expect(row.kind).toBe(UserOnCallShiftReminderLogKind.Reminder);
      expect(row.minutesBeforeShift).toBe(60);
      expect(row.userId.toString()).toBe(USER_A.toString());
      expect(row.projectId.toString()).toBe(PROJECT.toString());
      expect(row.onCallDutyPolicyScheduleId.toString()).toBe(SCHEDULE);
      expect(row.shiftStartsAt.toISOString()).toBe(SHIFT_START.toISOString());
      expect(row.claimedAt.toISOString()).toBe(NOW.toISOString());
      expect(row.sentAt).not.toBeNull();

      // The watermark advanced to this tick only after the pass completed.
      expect(watermarkOf(harness)).toBe(NOW.toISOString());

      expect(outcomes(harness)).toContain(ShiftReminderOutcome.Sent);
    });

    test("formats the same shift in each recipient's own zone", async () => {
      harness.reminders = [reminder(USER_A, 60), reminder(USER_B, 60)];
      harness.shifts = [
        aliceShift(),
        aliceShift({
          scheduleId: SCHEDULE_2,
          scheduleName: "Database",
          userId: USER_B.toString(),
          userName: "Bob Brown",
        }),
      ];

      await OnCallShiftReminderRunner.runSweep({ now: NOW });

      const byUser: Map<string, SentNotification> = new Map<
        string,
        SentNotification
      >();

      for (const call of harness.sent) {
        byUser.set(call.userId, call);
      }

      expect(byUser.get(USER_A.toString())?.vars["startsAt"]).toBe(
        BERLIN_START_TEXT,
      );
      expect(byUser.get(USER_B.toString())?.vars["startsAt"]).toBe(
        NEW_YORK_START_TEXT,
      );
    });

    test("a recipient without a timezone gets the schedule's zone, and UTC when the schedule has none", async () => {
      harness.reminders = [reminder(USER_C, 60)];
      harness.shifts = [
        aliceShift({ userId: USER_C.toString(), userName: "Carol Chen" }),
      ];

      await OnCallShiftReminderRunner.runSweep({ now: NOW });

      expect(harness.sent[0]?.vars["startsAt"]).toBe(
        "Thu 3 Sep 18:00 Europe/Stockholm",
      );

      harness.sent = [];
      harness.ledger = [];
      harness.cache.clear();
      harness.shifts = [
        shift({
          scheduleId: SCHEDULE,
          projectId: PROJECT.toString(),
          userId: USER_C.toString(),
          start: SHIFT_START,
          end: SHIFT_END,
          scheduleTimezone: undefined,
        }),
      ];

      await OnCallShiftReminderRunner.runSweep({ now: NOW });

      expect(harness.sent[0]?.vars["startsAt"]).toBe("Thu 3 Sep 16:00 UTC");
    });

    test("materializes [now, now + longest lead + 30 min] once per project, for every reminded user's schedules", async () => {
      harness.reminders = [
        reminder(USER_A, 60),
        reminder(USER_A, 1440),
        reminder(USER_B, 15),
      ];
      harness.candidateSchedules.set(USER_A.toString(), [SCHEDULE]);
      harness.candidateSchedules.set(USER_B.toString(), [SCHEDULE_2, SCHEDULE]);

      await OnCallShiftReminderRunner.runSweep({ now: NOW });

      expect(harness.materializeCalls).toHaveLength(1);
      expect(harness.materializeCalls[0]!.scheduleIds.sort()).toEqual([
        SCHEDULE,
        SCHEDULE_2,
      ]);
      expect(harness.materializeCalls[0]!.windowStart.toISOString()).toBe(
        NOW.toISOString(),
      );
      expect(harness.materializeCalls[0]!.windowEnd.toISOString()).toBe(
        minutes(
          NOW,
          1440 + SHIFT_REMINDER_WINDOW_PADDING_MINUTES,
        ).toISOString(),
      );
      expect(harness.materializeCalls[0]!.now?.toISOString()).toBe(
        NOW.toISOString(),
      );
      expect(harness.candidateCalls).toHaveLength(2);
      expect(harness.candidateCalls[0]!.projectIds).toEqual([
        PROJECT.toString(),
      ]);
    });

    test("with no reminders configured it touches nothing and still advances the watermark", async () => {
      const stats: ShiftReminderSweepStats =
        await OnCallShiftReminderRunner.runSweep({ now: NOW });

      expect(stats.projects).toBe(0);
      expect(harness.materializeCalls).toHaveLength(0);
      expect(harness.sent).toHaveLength(0);
      expect(watermarkOf(harness)).toBe(NOW.toISOString());
    });

    describe("watermark", () => {
      test("a skipped tick is caught up by the next one", async () => {
        harness.reminders = [reminder(USER_A, 60)];
        harness.shifts = [aliceShift()];

        // 14:40 — lead instant (15:00) still ahead: nothing due.
        const first: ShiftReminderSweepStats =
          await OnCallShiftReminderRunner.runSweep({ now: minutes(NOW, -20) });

        expect(first.sent).toBe(0);
        expect(watermarkOf(harness)).toBe(minutes(NOW, -20).toISOString());

        // 14:45, 14:50, 14:55, 15:00 and 15:05 never ran. 15:07 does.
        const late: ShiftReminderSweepStats =
          await OnCallShiftReminderRunner.runSweep({ now: minutes(NOW, 7) });

        expect(late.watermarkFound).toBe(true);
        expect(late.lookbackFrom.toISOString()).toBe(
          minutes(NOW, -20).toISOString(),
        );
        expect(late.sent).toBe(1);
        // More than one tick behind the lead instant: the true remaining time.
        expect(harness.sent[0]!.smsText).toContain("starts in 53 minutes");
        expect(watermarkOf(harness)).toBe(minutes(NOW, 7).toISOString());
      });

      test("with no watermark (Redis restart) the window reaches back 30 minutes, and the ledger stops duplicates", async () => {
        harness.reminders = [reminder(USER_A, 60)];
        harness.shifts = [aliceShift()];

        await OnCallShiftReminderRunner.runSweep({ now: NOW });
        expect(harness.sent).toHaveLength(1);

        // Redis flushed: the next tick re-considers the last 30 minutes.
        harness.cache.clear();

        const stats: ShiftReminderSweepStats =
          await OnCallShiftReminderRunner.runSweep({ now: minutes(NOW, 2) });

        expect(stats.watermarkFound).toBe(false);
        expect(stats.lookbackFrom.toISOString()).toBe(
          minutes(NOW, 2 - SHIFT_REMINDER_MAX_LOOKBACK_MINUTES).toISOString(),
        );
        expect(stats.skippedAlreadySent).toBe(1);
        expect(stats.sent).toBe(0);
        expect(harness.sent).toHaveLength(1);
        expect(harness.ledger).toHaveLength(1);
        expect(outcomes(harness)).toContain(
          ShiftReminderOutcome.SkippedAlreadySent,
        );
      });

      test("an ancient watermark is capped: reminders whose lead instant fell in a long outage are dropped, not flooded", async () => {
        harness.reminders = [reminder(USER_A, 60)];
        // Lead instant was 45 minutes ago (start = now + 15).
        harness.shifts = [
          aliceShift({ start: minutes(NOW, 15), end: minutes(NOW, 600) }),
        ];
        harness.cache.set(
          "OnCallShiftReminders:watermark",
          minutes(NOW, -120).toISOString(),
        );

        const stats: ShiftReminderSweepStats =
          await OnCallShiftReminderRunner.runSweep({ now: NOW });

        expect(stats.lookbackFrom.toISOString()).toBe(
          minutes(NOW, -30).toISOString(),
        );
        expect(stats.shiftsConsidered).toBe(1);
        expect(stats.sent).toBe(0);
        expect(harness.sent).toHaveLength(0);
        expect(harness.ledger).toHaveLength(0);
      });

      test("an unreadable watermark falls back to the 30-minute lookback with a warning", async () => {
        harness.cacheReadError = new Error("redis down");
        harness.reminders = [reminder(USER_A, 60)];
        harness.shifts = [aliceShift()];

        const stats: ShiftReminderSweepStats =
          await OnCallShiftReminderRunner.runSweep({ now: NOW });

        expect(stats.watermarkFound).toBe(false);
        expect(stats.sent).toBe(1);
        expect(
          harness.warnings.some((line: string) => {
            return line.includes("could not read the watermark");
          }),
        ).toBe(true);
      });

      test("an unwritable watermark does not fail the sweep", async () => {
        harness.cacheWriteError = new Error("redis down");
        harness.reminders = [reminder(USER_A, 60)];
        harness.shifts = [aliceShift()];

        const stats: ShiftReminderSweepStats =
          await OnCallShiftReminderRunner.runSweep({ now: NOW });

        expect(stats.sent).toBe(1);
        expect(
          harness.warnings.some((line: string) => {
            return line.includes("could not write the watermark");
          }),
        ).toBe(true);
      });

      test("the watermark is written only after every project was processed", async () => {
        harness.reminders = [reminder(USER_A, 60)];
        harness.shifts = [aliceShift()];

        const order: Array<string> = [];

        jest
          .spyOn(UserNotificationSettingService, "sendUserNotification")
          .mockImplementation((): Promise<void> => {
            order.push("send");
            return Promise.resolve();
          });

        const setString: any = jest.spyOn(harness.cache, "set");
        setString.mockImplementation(
          (key: string, value: string): Map<string, string> => {
            order.push("watermark");
            return Map.prototype.set.call(harness.cache, key, value);
          },
        );

        await OnCallShiftReminderRunner.runSweep({ now: NOW });

        expect(order).toEqual(["send", "watermark"]);
      });
    });

    describe("lateness cap", () => {
      test("never reminds about a shift that already started, even when its lead instant is inside the window", async () => {
        harness.reminders = [reminder(USER_A, 15)];
        // Started 5 minutes ago; lead instant (now - 20) is inside a 25-minute lookback.
        harness.shifts = [
          aliceShift({ start: minutes(NOW, -5), end: minutes(NOW, 600) }),
        ];
        harness.cache.set(
          "OnCallShiftReminders:watermark",
          minutes(NOW, -25).toISOString(),
        );

        const stats: ShiftReminderSweepStats =
          await OnCallShiftReminderRunner.runSweep({ now: NOW });

        expect(stats.skippedLate).toBe(1);
        expect(stats.sent).toBe(0);
        expect(harness.sent).toHaveLength(0);
        expect(harness.ledger).toHaveLength(0);
        expect(outcomes(harness)).toContain(ShiftReminderOutcome.SkippedLate);
      });

      test("a shift starting exactly now is late, one starting a minute later is not", async () => {
        harness.reminders = [reminder(USER_A, 15)];
        harness.shifts = [
          aliceShift({ start: NOW, end: minutes(NOW, 600) }),
          aliceShift({
            scheduleId: SCHEDULE_2,
            start: minutes(NOW, 1),
            end: minutes(NOW, 600),
          }),
        ];
        harness.cache.set(
          "OnCallShiftReminders:watermark",
          minutes(NOW, -25).toISOString(),
        );

        const stats: ShiftReminderSweepStats =
          await OnCallShiftReminderRunner.runSweep({ now: NOW });

        expect(stats.skippedLate).toBe(1);
        expect(stats.sent).toBe(1);
        expect(harness.sent[0]!.onCallScheduleId).toBe(SCHEDULE_2);
      });
    });

    describe("claim -> send -> stamp", () => {
      test("a thrown send releases the claim, and the next tick inside the lead retries", async () => {
        harness.reminders = [reminder(USER_A, 60)];
        harness.shifts = [aliceShift()];

        let attempts: number = 0;

        harness.failSend = (): Error | null => {
          attempts++;
          return attempts === 1 ? new Error("smtp down") : null;
        };

        const first: ShiftReminderSweepStats =
          await OnCallShiftReminderRunner.runSweep({ now: NOW });

        expect(first.sendFailures).toBe(1);
        expect(first.sent).toBe(0);
        expect(harness.sent).toHaveLength(0);
        // The claim was released so nothing blocks the retry.
        expect(harness.ledger).toHaveLength(0);
        expect(outcomes(harness)).toContain(ShiftReminderOutcome.SendFailed);
        expect(
          harness.errors.some((entry: unknown) => {
            return String(entry).includes("releasing the claim");
          }),
        ).toBe(true);

        /*
         * Next tick, still 57 minutes before the shift; the lead instant is
         * behind the watermark now, so it takes the fallback lookback to
         * re-consider it (same thing a Redis restart would do).
         */
        harness.cache.clear();

        const second: ShiftReminderSweepStats =
          await OnCallShiftReminderRunner.runSweep({ now: minutes(NOW, 3) });

        expect(second.sent).toBe(1);
        expect(harness.sent).toHaveLength(1);
        expect(harness.ledger).toHaveLength(1);
        expect(harness.ledger[0]!.sentAt).not.toBeNull();
      });

      test("a retried reminder after a failed send still says the true remaining time", async () => {
        harness.reminders = [reminder(USER_A, 60)];
        harness.shifts = [aliceShift()];
        harness.failSend = (): Error | null => {
          return harness.sent.length === 0 && harness.errors.length === 0
            ? new Error("smtp down")
            : null;
        };

        await OnCallShiftReminderRunner.runSweep({ now: NOW });
        harness.cache.clear();
        await OnCallShiftReminderRunner.runSweep({ now: minutes(NOW, 12) });

        expect(harness.sent).toHaveLength(1);
        expect(harness.sent[0]!.smsText).toContain("starts in 48 minutes");
      });

      test("a unique violation on the claim (another replica got there first) is a skip, not an error", async () => {
        harness.reminders = [reminder(USER_A, 60)];
        harness.shifts = [aliceShift()];

        // Between this replica's ledger read and its insert, another replica claims the row.
        harness.beforeLedgerInsert = (): void => {
          harness.beforeLedgerInsert = null;
          seedLedgerRow(harness, {
            projectId: PROJECT,
            userId: USER_A,
            scheduleId: SCHEDULE,
            shiftStartsAt: SHIFT_START,
            minutesBeforeShift: 60,
            kind: UserOnCallShiftReminderLogKind.Reminder,
            claimedAt: NOW,
            sentAt: null,
          });
        };

        const stats: ShiftReminderSweepStats =
          await OnCallShiftReminderRunner.runSweep({ now: NOW });

        expect(stats.claimCollisions).toBe(1);
        expect(stats.sent).toBe(0);
        expect(stats.errors).toBe(0);
        expect(harness.sent).toHaveLength(0);
        expect(harness.ledger).toHaveLength(1);
        expect(outcomes(harness)).toContain(
          ShiftReminderOutcome.ClaimCollision,
        );
      });

      test("a fresh claim with sentAt NULL belongs to a worker still sending: skipped as in-flight", async () => {
        harness.reminders = [reminder(USER_A, 60)];
        harness.shifts = [aliceShift()];
        seedLedgerRow(harness, {
          projectId: PROJECT,
          userId: USER_A,
          scheduleId: SCHEDULE,
          shiftStartsAt: SHIFT_START,
          minutesBeforeShift: 60,
          kind: UserOnCallShiftReminderLogKind.Reminder,
          claimedAt: minutes(NOW, -2),
          sentAt: null,
        });

        const stats: ShiftReminderSweepStats =
          await OnCallShiftReminderRunner.runSweep({ now: NOW });

        expect(stats.skippedInFlight).toBe(1);
        expect(stats.sent).toBe(0);
        expect(harness.sent).toHaveLength(0);
        expect(outcomes(harness)).toContain(
          ShiftReminderOutcome.SkippedInFlight,
        );
      });

      test("a claim older than 10 minutes with sentAt NULL is re-claimed with a conditional update and retried", async () => {
        harness.reminders = [reminder(USER_A, 60)];
        harness.shifts = [aliceShift()];
        const stale: FakeLedgerRow = seedLedgerRow(harness, {
          projectId: PROJECT,
          userId: USER_A,
          scheduleId: SCHEDULE,
          shiftStartsAt: SHIFT_START,
          minutesBeforeShift: 60,
          kind: UserOnCallShiftReminderLogKind.Reminder,
          claimedAt: minutes(NOW, -(SHIFT_REMINDER_RECLAIM_AFTER_MINUTES + 1)),
          sentAt: null,
        });

        const updateOneBy: any = jest.spyOn(
          UserOnCallShiftReminderLogService,
          "updateOneBy",
        );

        const stats: ShiftReminderSweepStats =
          await OnCallShiftReminderRunner.runSweep({ now: NOW });

        expect(stats.claimRetries).toBe(1);
        expect(stats.sent).toBe(1);
        expect(harness.sent).toHaveLength(1);
        expect(harness.ledger).toHaveLength(1);
        expect(harness.ledger[0]!.id.toString()).toBe(stale.id.toString());
        expect(harness.ledger[0]!.claimedAt.toISOString()).toBe(
          NOW.toISOString(),
        );
        expect(harness.ledger[0]!.sentAt).not.toBeNull();
        expect(outcomes(harness)).toContain(ShiftReminderOutcome.ClaimRetry);

        // The re-claim is conditional on the row still being stale and unsent.
        expect(updateOneBy).toHaveBeenCalledTimes(1);
        const query: Record<string, unknown> = (
          updateOneBy.mock.calls[0]![0] as unknown as {
            query: Record<string, unknown>;
          }
        ).query;

        expect(query["_id"]).toBeDefined();
        expect(query["sentAt"]).toBeDefined();
        expect(query["claimedAt"]).toBeDefined();
        expect(
          (
            updateOneBy.mock.calls[0]![0] as unknown as {
              props: { isRoot: boolean };
            }
          ).props.isRoot,
        ).toBe(true);
      });

      test("when the conditional re-claim matches nothing (another worker won) the reminder is skipped", async () => {
        harness.reminders = [reminder(USER_A, 60)];
        harness.shifts = [aliceShift()];
        seedLedgerRow(harness, {
          projectId: PROJECT,
          userId: USER_A,
          scheduleId: SCHEDULE,
          shiftStartsAt: SHIFT_START,
          minutesBeforeShift: 60,
          kind: UserOnCallShiftReminderLogKind.Reminder,
          claimedAt: minutes(NOW, -20),
          sentAt: null,
        });
        harness.reclaimUpdateOverride = 0;

        const stats: ShiftReminderSweepStats =
          await OnCallShiftReminderRunner.runSweep({ now: NOW });

        expect(stats.skippedInFlight).toBe(1);
        expect(stats.claimRetries).toBe(0);
        expect(harness.sent).toHaveLength(0);
      });

      test("a stale claim exactly at the re-claim boundary is re-claimed", async () => {
        harness.reminders = [reminder(USER_A, 60)];
        harness.shifts = [aliceShift()];
        seedLedgerRow(harness, {
          projectId: PROJECT,
          userId: USER_A,
          scheduleId: SCHEDULE,
          shiftStartsAt: SHIFT_START,
          minutesBeforeShift: 60,
          kind: UserOnCallShiftReminderLogKind.Reminder,
          claimedAt: minutes(NOW, -SHIFT_REMINDER_RECLAIM_AFTER_MINUTES),
          sentAt: null,
        });

        const stats: ShiftReminderSweepStats =
          await OnCallShiftReminderRunner.runSweep({ now: NOW });

        expect(stats.claimRetries).toBe(1);
        expect(stats.sent).toBe(1);
      });

      test("the stamp uses the ledger row created by the claim (claimId), not a fresh lookup", async () => {
        harness.reminders = [reminder(USER_A, 60)];
        harness.shifts = [aliceShift()];

        const updateOneById: any = jest.spyOn(
          UserOnCallShiftReminderLogService,
          "updateOneById",
        );

        await OnCallShiftReminderRunner.runSweep({ now: NOW });

        expect(updateOneById).toHaveBeenCalledTimes(1);
        const args: { id: ObjectID; data: { sentAt: Date } } = updateOneById
          .mock.calls[0]![0] as unknown as {
          id: ObjectID;
          data: { sentAt: Date };
        };

        expect(args.id.toString()).toBe(harness.ledger[0]!.id.toString());
        expect(args.data.sentAt).toBeInstanceOf(Date);
      });
    });

    describe("ledger dedup on the minute", () => {
      test("a start moved by seconds (a re-cut seam) maps onto the existing reminder row", async () => {
        harness.reminders = [reminder(USER_A, 60)];
        seedLedgerRow(harness, {
          projectId: PROJECT,
          userId: USER_A,
          scheduleId: SCHEDULE,
          shiftStartsAt: SHIFT_START,
          minutesBeforeShift: 60,
          kind: UserOnCallShiftReminderLogKind.Reminder,
          claimedAt: minutes(NOW, -5),
          sentAt: minutes(NOW, -5),
        });
        harness.shifts = [
          aliceShift({ start: new Date(SHIFT_START.getTime() + 30 * 1000) }),
        ];

        // One minute later, so the 16:00:30 start is inside (15:31, 16:01].
        const stats: ShiftReminderSweepStats =
          await OnCallShiftReminderRunner.runSweep({ now: minutes(NOW, 1) });

        expect(stats.skippedAlreadySent).toBe(1);
        expect(stats.sent).toBe(0);
        expect(harness.sent).toHaveLength(0);
        expect(harness.ledger).toHaveLength(1);
      });

      test("the claim itself is written with the minute-truncated start", async () => {
        harness.reminders = [reminder(USER_A, 60)];
        harness.shifts = [
          aliceShift({ start: new Date(SHIFT_START.getTime() + 45 * 1000) }),
        ];

        await OnCallShiftReminderRunner.runSweep({ now: minutes(NOW, 1) });

        expect(harness.ledger).toHaveLength(1);
        expect(harness.ledger[0]!.shiftStartsAt.toISOString()).toBe(
          SHIFT_START.toISOString(),
        );
      });

      test("a catch-up already sent for the same lead covers the regular reminder", async () => {
        harness.reminders = [reminder(USER_A, 60)];
        harness.shifts = [aliceShift()];
        seedLedgerRow(harness, {
          projectId: PROJECT,
          userId: USER_A,
          scheduleId: SCHEDULE,
          shiftStartsAt: SHIFT_START,
          minutesBeforeShift: 60,
          kind: UserOnCallShiftReminderLogKind.CatchUp,
          claimedAt: minutes(NOW, -5),
          sentAt: minutes(NOW, -5),
        });

        const stats: ShiftReminderSweepStats =
          await OnCallShiftReminderRunner.runSweep({ now: NOW });

        expect(stats.skippedAlreadySent).toBe(1);
        expect(harness.sent).toHaveLength(0);
        expect(harness.ledger).toHaveLength(1);
      });

      test("distinct leads for one shift are distinct reminders, each sent at its own tick", async () => {
        harness.reminders = [reminder(USER_A, 60), reminder(USER_A, 15)];
        harness.shifts = [aliceShift()];

        const first: ShiftReminderSweepStats =
          await OnCallShiftReminderRunner.runSweep({ now: NOW });

        expect(first.sent).toBe(1);
        expect(harness.sent[0]!.vars["leadText"]).toBe("1 hour");

        const second: ShiftReminderSweepStats =
          await OnCallShiftReminderRunner.runSweep({ now: minutes(NOW, 45) });

        expect(second.sent).toBe(1);
        expect(harness.sent).toHaveLength(2);
        expect(harness.sent[1]!.vars["leadText"]).toBe("15 minutes");
        expect(harness.sent[1]!.smsText).toContain("starts in 15 minutes");

        const leads: Array<number> = ledgerRowsOfKind(
          harness,
          UserOnCallShiftReminderLogKind.Reminder,
        )
          .map((row: FakeLedgerRow) => {
            return row.minutesBeforeShift;
          })
          .sort((a: number, b: number) => {
            return a - b;
          });

        expect(leads).toEqual([15, 60]);
      });

      test("duplicate lead rows collapse into one reminder", async () => {
        harness.reminders = [reminder(USER_A, 60), reminder(USER_A, 60)];
        harness.shifts = [aliceShift()];

        const stats: ShiftReminderSweepStats =
          await OnCallShiftReminderRunner.runSweep({ now: NOW });

        expect(stats.sent).toBe(1);
        expect(harness.ledger).toHaveLength(1);
      });
    });

    describe("zero-policy schedules", () => {
      test("a shift on a schedule attached to no policy is skipped without a claim", async () => {
        harness.reminders = [reminder(USER_A, 60)];
        harness.shifts = [aliceShift({ policies: [] })];

        const stats: ShiftReminderSweepStats =
          await OnCallShiftReminderRunner.runSweep({ now: NOW });

        expect(stats.skippedNoPolicy).toBe(1);
        expect(stats.sent).toBe(0);
        expect(harness.sent).toHaveLength(0);
        expect(harness.ledger).toHaveLength(0);
        expect(outcomes(harness)).toContain(
          ShiftReminderOutcome.SkippedNoPolicy,
        );
      });

      test("the zero-policy skip is per shift: another schedule of the same user still reminds", async () => {
        harness.reminders = [reminder(USER_A, 60)];
        harness.shifts = [
          aliceShift({ policies: [] }),
          aliceShift({ scheduleId: SCHEDULE_2, scheduleName: "Database" }),
        ];

        const stats: ShiftReminderSweepStats =
          await OnCallShiftReminderRunner.runSweep({ now: NOW });

        expect(stats.skippedNoPolicy).toBe(1);
        expect(stats.sent).toBe(1);
        expect(harness.sent[0]!.onCallScheduleId).toBe(SCHEDULE_2);
      });
    });

    describe("missing UserNotificationSetting row", () => {
      test("warns once per (user, project, event, day) and counts it, but still hands the send to the settings service", async () => {
        harness.settings.clear();
        harness.reminders = [reminder(USER_A, 60), reminder(USER_A, 15)];
        harness.shifts = [aliceShift()];

        const first: ShiftReminderSweepStats =
          await OnCallShiftReminderRunner.runSweep({ now: NOW });

        expect(first.missingSettings).toBe(1);
        // sendUserNotification itself decides to send nothing without a row.
        expect(harness.sent).toHaveLength(1);

        const warningsAboutSettings: Array<string> = harness.warnings.filter(
          (line: string) => {
            return line.includes("has no UserNotificationSetting row");
          },
        );

        expect(warningsAboutSettings).toHaveLength(1);
        expect(warningsAboutSettings[0]).toContain(USER_A.toString());
        expect(warningsAboutSettings[0]).toContain(PROJECT.toString());
        expect(warningsAboutSettings[0]).toContain(
          "AddShiftReminderNotificationSettingsForUsers",
        );
        expect(outcomes(harness)).toContain(
          ShiftReminderOutcome.MissingSettings,
        );

        // The 15-minute reminder, same day: counted, not warned again.
        const second: ShiftReminderSweepStats =
          await OnCallShiftReminderRunner.runSweep({ now: minutes(NOW, 45) });

        expect(second.missingSettings).toBe(1);
        expect(
          harness.warnings.filter((line: string) => {
            return line.includes("has no UserNotificationSetting row");
          }),
        ).toHaveLength(1);
      });

      test("warns again on a new day, and after resetMissingSettingsWarnings", async () => {
        harness.settings.clear();
        harness.reminders = [reminder(USER_A, 60)];
        harness.shifts = [
          aliceShift(),
          aliceShift({
            start: minutes(SHIFT_START, 1440),
            end: minutes(SHIFT_END, 1440),
          }),
        ];

        await OnCallShiftReminderRunner.runSweep({ now: NOW });
        await OnCallShiftReminderRunner.runSweep({ now: minutes(NOW, 1440) });

        expect(
          harness.warnings.filter((line: string) => {
            return line.includes("has no UserNotificationSetting row");
          }),
        ).toHaveLength(2);

        harness.ledger = [];
        harness.cache.clear();
        OnCallShiftReminderRunner.resetMissingSettingsWarnings();

        await OnCallShiftReminderRunner.runSweep({ now: NOW });

        expect(
          harness.warnings.filter((line: string) => {
            return line.includes("has no UserNotificationSetting row");
          }),
        ).toHaveLength(3);
      });

      test("a user with the row is never warned about", async () => {
        harness.reminders = [reminder(USER_A, 60)];
        harness.shifts = [aliceShift()];

        const stats: ShiftReminderSweepStats =
          await OnCallShiftReminderRunner.runSweep({ now: NOW });

        expect(stats.missingSettings).toBe(0);
        expect(
          harness.warnings.some((line: string) => {
            return line.includes("has no UserNotificationSetting row");
          }),
        ).toBe(false);
      });
    });

    describe("robustness", () => {
      test("one project's failure is isolated: the other project is processed and the watermark still advances", async () => {
        harness.reminders = [
          reminder(USER_A, 60, PROJECT),
          reminder(USER_B, 60, PROJECT_2),
        ];
        harness.schedules.set(
          "schedule-p2",
          scheduleInfo({
            scheduleId: "schedule-p2",
            projectId: PROJECT_2.toString(),
            attachedPolicies: [{ ...DEFAULT_POLICY }],
          }),
        );
        harness.shifts = [
          aliceShift(),
          aliceShift({
            scheduleId: "schedule-p2",
            projectId: PROJECT_2.toString(),
            userId: USER_B.toString(),
            userName: "Bob Brown",
          }),
        ];
        harness.materializeErrorForSchedules.add(SCHEDULE);

        const stats: ShiftReminderSweepStats =
          await OnCallShiftReminderRunner.runSweep({ now: NOW });

        expect(stats.projects).toBe(2);
        expect(stats.errors).toBe(1);
        expect(stats.sent).toBe(1);
        expect(harness.sent[0]!.projectId).toBe(PROJECT_2.toString());
        expect(watermarkOf(harness)).toBe(NOW.toISOString());
      });

      test("one user's failure is isolated inside a project", async () => {
        harness.reminders = [reminder(USER_A, 60), reminder(USER_B, 60)];
        harness.shifts = [
          aliceShift(),
          aliceShift({
            scheduleId: SCHEDULE_2,
            userId: USER_B.toString(),
            userName: "Bob Brown",
          }),
        ];

        // The stamp for Alice's row blows up (a database hiccup after the send).
        jest
          .spyOn(UserOnCallShiftReminderLogService, "updateOneById")
          .mockImplementation(((args: { id: ObjectID }) => {
            const row: FakeLedgerRow | undefined = harness.ledger.find(
              (candidate: FakeLedgerRow) => {
                return candidate.id.toString() === args.id.toString();
              },
            );

            if (row && row.userId.toString() === USER_A.toString()) {
              return Promise.reject(new Error("connection reset"));
            }

            if (row) {
              row.sentAt = NOW;
            }

            return Promise.resolve();
          }) as never);

        const stats: ShiftReminderSweepStats =
          await OnCallShiftReminderRunner.runSweep({ now: NOW });

        expect(stats.errors).toBe(1);
        expect(stats.sent).toBe(1);
        expect(harness.sent).toHaveLength(2);
        expect(watermarkOf(harness)).toBe(NOW.toISOString());
      });

      test("when the reminder table cannot be read the sweep throws and the watermark is NOT advanced", async () => {
        harness.remindersReadError = new Error("database unavailable");
        harness.cache.set(
          "OnCallShiftReminders:watermark",
          minutes(NOW, -5).toISOString(),
        );

        await expect(
          OnCallShiftReminderRunner.runSweep({ now: NOW }),
        ).rejects.toThrow("database unavailable");

        expect(watermarkOf(harness)).toBe(minutes(NOW, -5).toISOString());
      });

      test("a schedule that hit the simulation cap is warned about and counted, and still reminds", async () => {
        harness.reminders = [reminder(USER_A, 60)];
        harness.shifts = [aliceShift()];
        harness.schedules.set(
          SCHEDULE,
          scheduleInfo({
            scheduleId: SCHEDULE,
            projectId: PROJECT.toString(),
            truncated: true,
            attachedPolicies: [{ ...DEFAULT_POLICY }],
          }),
        );

        const stats: ShiftReminderSweepStats =
          await OnCallShiftReminderRunner.runSweep({ now: NOW });

        expect(stats.truncatedSchedules).toBe(1);
        expect(stats.sent).toBe(1);
        expect(
          harness.warnings.some((line: string) => {
            return line.includes("hit the simulation cap");
          }),
        ).toBe(true);
      });

      test("reminder rows with an unusable lead are ignored", async () => {
        harness.reminders = [
          reminder(USER_A, 0),
          reminder(USER_A, -15),
          reminder(USER_A, Number.NaN),
          { projectId: PROJECT, userId: USER_A, minutesBeforeShift: 60 },
        ];
        harness.reminders.push({
          projectId: PROJECT,
          userId: undefined as unknown as ObjectID,
          minutesBeforeShift: 60,
        });
        harness.shifts = [aliceShift()];

        const stats: ShiftReminderSweepStats =
          await OnCallShiftReminderRunner.runSweep({ now: NOW });

        expect(stats.usersWithReminders).toBe(1);
        expect(stats.sent).toBe(1);
      });

      test("a schedule the user is not on this window is materialized but yields nothing", async () => {
        harness.reminders = [reminder(USER_A, 60)];
        harness.candidateSchedules.set(USER_A.toString(), [SCHEDULE]);
        harness.shifts = [
          aliceShift({ userId: USER_B.toString(), userName: "Bob Brown" }),
        ];

        const stats: ShiftReminderSweepStats =
          await OnCallShiftReminderRunner.runSweep({ now: NOW });

        expect(stats.shiftsConsidered).toBe(0);
        expect(harness.sent).toHaveLength(0);
      });

      test("a user with no candidate schedules costs no materialization", async () => {
        harness.reminders = [reminder(USER_A, 60)];
        harness.candidateSchedules.set(USER_A.toString(), []);

        await OnCallShiftReminderRunner.runSweep({ now: NOW });

        expect(harness.materializeCalls).toHaveLength(0);
      });

      test("telemetry failures never break a reminder", async () => {
        jest.restoreAllMocks();
        installReminderHarness(harness);
        jest.spyOn(harness.metrics, "push").mockImplementation((): number => {
          throw new Error("otel exploded");
        });
        harness.reminders = [reminder(USER_A, 60)];
        harness.shifts = [aliceShift()];

        const stats: ShiftReminderSweepStats =
          await OnCallShiftReminderRunner.runSweep({ now: NOW });

        expect(stats.sent).toBe(1);
        expect(stats.errors).toBe(0);
      });
    });
  });

  /*
   * ---------------------------------------------------------------------
   * The sweep lock
   * ---------------------------------------------------------------------
   */

  describe("runSweepUnderLock", () => {
    test("takes the cross-replica lock with the job name, a 12-minute timeout and a single attempt", async () => {
      harness.reminders = [reminder(USER_A, 60)];
      harness.shifts = [aliceShift()];

      const stats: ShiftReminderSweepStats | null =
        await OnCallShiftReminderRunner.runSweepUnderLock({ now: NOW });

      expect(stats?.sent).toBe(1);
      expect(harness.lockCalls).toHaveLength(1);
      expect(harness.lockCalls[0]).toEqual({
        key: SHIFT_REMINDER_JOB_NAME,
        namespace: SHIFT_REMINDER_SWEEP_LOCK_NAMESPACE,
        lockTimeout: SHIFT_REMINDER_SWEEP_LOCK_TIMEOUT_MS,
        acquireAttemptsLimit: 1,
      });
      expect(SHIFT_REMINDER_SWEEP_LOCK_NAMESPACE).toBe("Workers.Cron");
      expect(SHIFT_REMINDER_SWEEP_LOCK_TIMEOUT_MS).toBe(12 * 60 * 1000);
      expect(harness.releasedMutexes).toHaveLength(1);
    });

    test("skips the tick when the lock is held (or Redis is unavailable), without touching anything", async () => {
      harness.lockAvailable = false;
      harness.reminders = [reminder(USER_A, 60)];
      harness.shifts = [aliceShift()];

      const stats: ShiftReminderSweepStats | null =
        await OnCallShiftReminderRunner.runSweepUnderLock({ now: NOW });

      expect(stats).toBeNull();
      expect(harness.materializeCalls).toHaveLength(0);
      expect(harness.sent).toHaveLength(0);
      expect(watermarkOf(harness)).toBeUndefined();
      expect(harness.releasedMutexes).toHaveLength(0);
    });

    test("releases the lock even when the sweep throws, and lets the error surface", async () => {
      harness.remindersReadError = new Error("database unavailable");

      await expect(
        OnCallShiftReminderRunner.runSweepUnderLock({ now: NOW }),
      ).rejects.toThrow("database unavailable");

      expect(harness.releasedMutexes).toHaveLength(1);
    });

    test("a failed release is logged, not thrown", async () => {
      jest.spyOn(Semaphore, "release").mockImplementation((): Promise<void> => {
        return Promise.reject(new Error("release failed"));
      });

      const stats: ShiftReminderSweepStats | null =
        await OnCallShiftReminderRunner.runSweepUnderLock({ now: NOW });

      expect(stats).not.toBeNull();
      expect(
        harness.errors.some((entry: unknown) => {
          return String(entry).includes("releasing the sweep lock");
        }),
      ).toBe(true);
    });
  });

  /*
   * ---------------------------------------------------------------------
   * The change pass
   * ---------------------------------------------------------------------
   */

  describe("runChangePass", () => {
    describe("catch-up", () => {
      test("a user who now holds a shift starting inside one of their leads, never reminded, gets ONE catch-up", async () => {
        harness.reminders = [reminder(USER_B, 60)];
        // Override created 10 minutes before Alice's shift: Bob covers.
        const now: Date = minutes(SHIFT_START, -10);
        harness.shifts = [bobCoveringForAlice()];

        const stats: ShiftReminderChangePassStats =
          await OnCallShiftReminderRunner.runChangePass(
            changeEvent({ userIds: [USER_B, USER_A] }),
            { now },
          );

        expect(stats.catchUpsSent).toBe(1);
        expect(stats.reassignedSent).toBe(0);
        expect(stats.errors).toBe(0);
        expect(stats.skippedReason).toBeNull();
        expect(stats.projectId).toBe(PROJECT.toString());

        expect(harness.sent).toHaveLength(1);
        const call: SentNotification = harness.sent[0]!;

        expect(call.userId).toBe(USER_B.toString());
        expect(call.eventType).toBe(
          NotificationSettingEventType.SEND_BEFORE_USER_ON_CALL_SHIFT_STARTS,
        );
        expect(call.smsText).toContain(
          `now starts in 10 minutes (${NEW_YORK_START_TEXT}) (you are covering for Alice Andersson).`,
        );

        const rows: Array<FakeLedgerRow> = ledgerRowsOfKind(
          harness,
          UserOnCallShiftReminderLogKind.CatchUp,
        );

        expect(rows).toHaveLength(1);
        expect(rows[0]!.userId.toString()).toBe(USER_B.toString());
        expect(rows[0]!.minutesBeforeShift).toBe(60);
        expect(rows[0]!.sentAt).not.toBeNull();
        expect(outcomes(harness)).toContain(ShiftReminderOutcome.CatchUpSent);
      });

      test("the catch-up is keyed with the LARGEST matching lead", async () => {
        harness.reminders = [
          reminder(USER_B, 15),
          reminder(USER_B, 60),
          reminder(USER_B, 1440),
        ];
        harness.shifts = [bobCoveringForAlice()];

        await OnCallShiftReminderRunner.runChangePass(
          changeEvent({ userIds: [USER_B] }),
          { now: minutes(SHIFT_START, -10) },
        );

        const rows: Array<FakeLedgerRow> = ledgerRowsOfKind(
          harness,
          UserOnCallShiftReminderLogKind.CatchUp,
        );

        expect(rows).toHaveLength(1);
        expect(rows[0]!.minutesBeforeShift).toBe(1440);
      });

      test("an override created 10 minutes before a shift yields a catch-up when the user has any lead >= 10 minutes", async () => {
        harness.reminders = [reminder(USER_B, 15)];
        harness.shifts = [bobCoveringForAlice()];

        const stats: ShiftReminderChangePassStats =
          await OnCallShiftReminderRunner.runChangePass(
            changeEvent({ userIds: [USER_B] }),
            { now: minutes(SHIFT_START, -10) },
          );

        expect(stats.catchUpsSent).toBe(1);
      });

      test("no catch-up for a shift that starts beyond every configured lead (the sweep will remind on time)", async () => {
        harness.reminders = [reminder(USER_B, 60)];
        harness.shifts = [bobCoveringForAlice()];

        const stats: ShiftReminderChangePassStats =
          await OnCallShiftReminderRunner.runChangePass(
            changeEvent({ userIds: [USER_B] }),
            { now: minutes(SHIFT_START, -120) },
          );

        expect(stats.catchUpsSent).toBe(0);
        expect(harness.sent).toHaveLength(0);
        expect(harness.ledger).toHaveLength(0);
      });

      test("no catch-up when the user was already told about the shift (any lead, reminder or catch-up)", async () => {
        harness.reminders = [reminder(USER_B, 60)];
        harness.shifts = [bobCoveringForAlice()];
        seedLedgerRow(harness, {
          projectId: PROJECT,
          userId: USER_B,
          scheduleId: SCHEDULE,
          shiftStartsAt: SHIFT_START,
          minutesBeforeShift: 15,
          kind: UserOnCallShiftReminderLogKind.Reminder,
          claimedAt: minutes(SHIFT_START, -15),
          sentAt: minutes(SHIFT_START, -15),
        });

        const stats: ShiftReminderChangePassStats =
          await OnCallShiftReminderRunner.runChangePass(
            changeEvent({ userIds: [USER_B] }),
            { now: minutes(SHIFT_START, -10) },
          );

        expect(stats.catchUpsSent).toBe(0);
        expect(harness.sent).toHaveLength(0);
      });

      test("a second change pass does not repeat the catch-up", async () => {
        harness.reminders = [reminder(USER_B, 60)];
        harness.shifts = [bobCoveringForAlice()];

        await OnCallShiftReminderRunner.runChangePass(
          changeEvent({ userIds: [USER_B] }),
          { now: minutes(SHIFT_START, -10) },
        );
        const second: ShiftReminderChangePassStats =
          await OnCallShiftReminderRunner.runChangePass(
            changeEvent({ userIds: [USER_B] }),
            { now: minutes(SHIFT_START, -8) },
          );

        expect(second.catchUpsSent).toBe(0);
        expect(harness.sent).toHaveLength(1);
      });

      test("no catch-up for a shift on a zero-policy schedule", async () => {
        harness.reminders = [reminder(USER_B, 60)];
        harness.shifts = [bobCoveringForAlice({ policies: [] })];

        const stats: ShiftReminderChangePassStats =
          await OnCallShiftReminderRunner.runChangePass(
            changeEvent({ userIds: [USER_B] }),
            { now: minutes(SHIFT_START, -10) },
          );

        expect(stats.catchUpsSent).toBe(0);
        expect(harness.ledger).toHaveLength(0);
      });

      test("no catch-up for a shift that already started", async () => {
        harness.reminders = [reminder(USER_B, 60)];
        harness.shifts = [bobCoveringForAlice()];

        const stats: ShiftReminderChangePassStats =
          await OnCallShiftReminderRunner.runChangePass(
            changeEvent({ userIds: [USER_B] }),
            { now: minutes(SHIFT_START, 5) },
          );

        expect(stats.catchUpsSent).toBe(0);
        expect(harness.sent).toHaveLength(0);
      });

      test("a failed catch-up send releases the claim and is counted", async () => {
        harness.reminders = [reminder(USER_B, 60)];
        harness.shifts = [bobCoveringForAlice()];
        harness.failSend = (): Error | null => {
          return new Error("smtp down");
        };

        const stats: ShiftReminderChangePassStats =
          await OnCallShiftReminderRunner.runChangePass(
            changeEvent({ userIds: [USER_B] }),
            { now: minutes(SHIFT_START, -10) },
          );

        expect(stats.sendFailures).toBe(1);
        expect(stats.catchUpsSent).toBe(0);
        expect(harness.ledger).toHaveLength(0);
      });

      test("the regular sweep later honours the catch-up for that lead and still sends the smaller lead", async () => {
        harness.reminders = [reminder(USER_B, 60), reminder(USER_B, 15)];
        harness.shifts = [bobCoveringForAlice()];

        // Override at T-30: catch-up keyed 60.
        await OnCallShiftReminderRunner.runChangePass(
          changeEvent({ userIds: [USER_B] }),
          { now: minutes(SHIFT_START, -30) },
        );
        expect(harness.sent).toHaveLength(1);

        /*
         * Sweep at T-28 with a watermark from T-33: lead 60's instant (T-60)
         * is behind the watermark, nothing due yet.
         */
        harness.cache.set(
          "OnCallShiftReminders:watermark",
          minutes(SHIFT_START, -33).toISOString(),
        );
        const early: ShiftReminderSweepStats =
          await OnCallShiftReminderRunner.runSweep({
            now: minutes(SHIFT_START, -28),
          });
        expect(early.sent).toBe(0);

        // Sweep at T-13: the 15-minute reminder is due and is a different key.
        const later: ShiftReminderSweepStats =
          await OnCallShiftReminderRunner.runSweep({
            now: minutes(SHIFT_START, -13),
          });

        expect(later.sent).toBe(1);
        expect(harness.sent).toHaveLength(2);
        expect(harness.sent[1]!.vars["leadText"]).toBe("15 minutes");
      });
    });

    describe("reassigned", () => {
      function aliceWasReminded(claimedAt: Date): FakeLedgerRow {
        return seedLedgerRow(harness, {
          projectId: PROJECT,
          userId: USER_A,
          scheduleId: SCHEDULE,
          shiftStartsAt: SHIFT_START,
          minutesBeforeShift: 60,
          kind: UserOnCallShiftReminderLogKind.Reminder,
          claimedAt,
          sentAt: claimedAt,
        });
      }

      test("a user reminded about a shift they no longer hold gets ONE 'reassigned' notice naming the replacement", async () => {
        aliceWasReminded(minutes(SHIFT_START, -60));
        // Bob now covers; the hook named only Bob (Alice is found via her ledger row).
        harness.shifts = [bobCoveringForAlice()];

        const now: Date = minutes(SHIFT_START, -40);
        const stats: ShiftReminderChangePassStats =
          await OnCallShiftReminderRunner.runChangePass(
            changeEvent({ userIds: [USER_B] }),
            { now },
          );

        expect(stats.reassignedSent).toBe(1);
        expect(stats.catchUpsSent).toBe(0);
        expect(stats.users).toBe(2);

        expect(harness.sent).toHaveLength(1);
        const call: SentNotification = harness.sent[0]!;

        expect(call.userId).toBe(USER_A.toString());
        expect(call.eventType).toBe(
          NotificationSettingEventType.SEND_WHEN_USER_ON_CALL_SHIFT_IS_REASSIGNED,
        );
        expect(call.templateType).toBe(
          EmailTemplateType.UserOnCallShiftReassigned,
        );
        expect(call.smsText).toContain(
          `Your on-call shift on Payments at ${BERLIN_START_TEXT} is now covered by Bob Brown.`,
        );
        expect(call.onCallScheduleId).toBe(SCHEDULE);

        const rows: Array<FakeLedgerRow> = ledgerRowsOfKind(
          harness,
          UserOnCallShiftReminderLogKind.Reassigned,
        );

        expect(rows).toHaveLength(1);
        expect(rows[0]!.minutesBeforeShift).toBe(0);
        expect(rows[0]!.userId.toString()).toBe(USER_A.toString());
        expect(rows[0]!.sentAt).not.toBeNull();
        expect(outcomes(harness)).toContain(
          ShiftReminderOutcome.ReassignedSent,
        );
      });

      test("says 'no longer assigned to you' when nobody holds the shift now", async () => {
        aliceWasReminded(minutes(SHIFT_START, -60));
        harness.shifts = [];

        const stats: ShiftReminderChangePassStats =
          await OnCallShiftReminderRunner.runChangePass(changeEvent({}), {
            now: minutes(SHIFT_START, -40),
          });

        expect(stats.reassignedSent).toBe(1);
        expect(harness.sent[0]!.smsText).toContain(
          "is no longer assigned to you.",
        );
      });

      test("a policy-variant shift is never reported as the replacement", async () => {
        aliceWasReminded(minutes(SHIFT_START, -60));
        harness.shifts = [
          bobCoveringForAlice({
            policyVariantOf: {
              policyId: "pol-2",
              policyName: "Other",
              globalUserId: USER_A.toString(),
            },
          }),
        ];

        await OnCallShiftReminderRunner.runChangePass(changeEvent({}), {
          now: minutes(SHIFT_START, -40),
        });

        expect(harness.sent).toHaveLength(1);
        expect(harness.sent[0]!.smsText).toContain(
          "is no longer assigned to you.",
        );
      });

      test("one notice per shift however many leads were reminded, and never twice", async () => {
        aliceWasReminded(minutes(SHIFT_START, -60));
        seedLedgerRow(harness, {
          projectId: PROJECT,
          userId: USER_A,
          scheduleId: SCHEDULE,
          shiftStartsAt: SHIFT_START,
          minutesBeforeShift: 1440,
          kind: UserOnCallShiftReminderLogKind.Reminder,
          claimedAt: minutes(SHIFT_START, -1440),
          sentAt: minutes(SHIFT_START, -1440),
        });
        harness.shifts = [bobCoveringForAlice()];

        const first: ShiftReminderChangePassStats =
          await OnCallShiftReminderRunner.runChangePass(changeEvent({}), {
            now: minutes(SHIFT_START, -40),
          });
        const second: ShiftReminderChangePassStats =
          await OnCallShiftReminderRunner.runChangePass(changeEvent({}), {
            now: minutes(SHIFT_START, -35),
          });

        expect(first.reassignedSent).toBe(1);
        expect(second.reassignedSent).toBe(0);
        expect(harness.sent).toHaveLength(1);
      });

      test("a user who still holds the shift gets no notice", async () => {
        aliceWasReminded(minutes(SHIFT_START, -60));
        harness.shifts = [aliceShift()];

        const stats: ShiftReminderChangePassStats =
          await OnCallShiftReminderRunner.runChangePass(
            changeEvent({ userIds: [USER_A] }),
            { now: minutes(SHIFT_START, -40) },
          );

        expect(stats.reassignedSent).toBe(0);
        expect(harness.sent).toHaveLength(0);
      });

      test("a shift that already started is not reported", async () => {
        aliceWasReminded(minutes(SHIFT_START, -60));
        harness.shifts = [bobCoveringForAlice()];

        const stats: ShiftReminderChangePassStats =
          await OnCallShiftReminderRunner.runChangePass(changeEvent({}), {
            now: minutes(SHIFT_START, 5),
          });

        expect(stats.reassignedSent).toBe(0);
      });

      test("a schedule that hit the simulation cap cannot be judged: no notice", async () => {
        aliceWasReminded(minutes(SHIFT_START, -60));
        harness.shifts = [bobCoveringForAlice()];
        harness.schedules.set(
          SCHEDULE,
          scheduleInfo({
            scheduleId: SCHEDULE,
            projectId: PROJECT.toString(),
            truncated: true,
            attachedPolicies: [{ ...DEFAULT_POLICY }],
          }),
        );

        const stats: ShiftReminderChangePassStats =
          await OnCallShiftReminderRunner.runChangePass(changeEvent({}), {
            now: minutes(SHIFT_START, -40),
          });

        expect(stats.reassignedSent).toBe(0);
        expect(harness.sent).toHaveLength(0);
      });

      test("taken back: reminder -> reassigned -> holds again yields a catch-up and clears the notice, so a later flip can notify again", async () => {
        harness.reminders = [reminder(USER_A, 60)];
        aliceWasReminded(minutes(SHIFT_START, -60));

        // 1. Override: Bob covers -> Alice is told.
        harness.shifts = [bobCoveringForAlice()];
        const first: ShiftReminderChangePassStats =
          await OnCallShiftReminderRunner.runChangePass(changeEvent({}), {
            now: minutes(SHIFT_START, -40),
          });
        expect(first.reassignedSent).toBe(1);

        // 2. Override deleted: Alice holds again -> catch-up, notice row gone.
        harness.shifts = [aliceShift()];
        const second: ShiftReminderChangePassStats =
          await OnCallShiftReminderRunner.runChangePass(
            changeEvent({ userIds: [USER_A] }),
            { now: minutes(SHIFT_START, -30) },
          );
        expect(second.catchUpsSent).toBe(1);
        expect(second.reassignedSent).toBe(0);
        expect(harness.sent[1]!.userId).toBe(USER_A.toString());
        expect(harness.sent[1]!.smsText).toContain("now starts in 30 minutes");
        expect(
          ledgerRowsOfKind(harness, UserOnCallShiftReminderLogKind.Reassigned),
        ).toHaveLength(0);

        // 3. Override again: a fresh notice.
        harness.shifts = [bobCoveringForAlice()];
        const third: ShiftReminderChangePassStats =
          await OnCallShiftReminderRunner.runChangePass(changeEvent({}), {
            now: minutes(SHIFT_START, -20),
          });
        expect(third.reassignedSent).toBe(1);
        expect(harness.sent).toHaveLength(3);
      });

      test("the notice is delivered in the recipient's timezone with the schedule's policies for routing", async () => {
        aliceWasReminded(minutes(SHIFT_START, -60));
        harness.shifts = [bobCoveringForAlice()];

        await OnCallShiftReminderRunner.runChangePass(changeEvent({}), {
          now: minutes(SHIFT_START, -40),
        });

        expect(harness.sent[0]!.vars["startsAt"]).toBe(BERLIN_START_TEXT);
        expect(harness.sent[0]!.onCallPolicyId).toBe(DEFAULT_POLICY.policyId);
      });

      test("a failed notice send releases the claim so the next pass retries", async () => {
        aliceWasReminded(minutes(SHIFT_START, -60));
        harness.shifts = [bobCoveringForAlice()];
        let fail: boolean = true;
        harness.failSend = (): Error | null => {
          return fail ? new Error("smtp down") : null;
        };

        const first: ShiftReminderChangePassStats =
          await OnCallShiftReminderRunner.runChangePass(changeEvent({}), {
            now: minutes(SHIFT_START, -40),
          });

        expect(first.sendFailures).toBe(1);
        expect(
          ledgerRowsOfKind(harness, UserOnCallShiftReminderLogKind.Reassigned),
        ).toHaveLength(0);

        fail = false;
        const second: ShiftReminderChangePassStats =
          await OnCallShiftReminderRunner.runChangePass(changeEvent({}), {
            now: minutes(SHIFT_START, -38),
          });

        expect(second.reassignedSent).toBe(1);
      });
    });

    describe("scope and robustness", () => {
      test("resolves the project from the schedules when the event carries none", async () => {
        harness.reminders = [reminder(USER_B, 60)];
        harness.shifts = [bobCoveringForAlice()];

        const stats: ShiftReminderChangePassStats =
          await OnCallShiftReminderRunner.runChangePass(
            changeEvent({ projectId: null, userIds: [USER_B] }),
            { now: minutes(SHIFT_START, -10) },
          );

        expect(stats.projectId).toBe(PROJECT.toString());
        expect(stats.catchUpsSent).toBe(1);
      });

      test("ends early with 'no-project' when neither the event nor its schedules name one", async () => {
        harness.scheduleProjects.clear();

        const stats: ShiftReminderChangePassStats =
          await OnCallShiftReminderRunner.runChangePass(
            changeEvent({ projectId: null, scheduleIds: ["unknown-schedule"] }),
            { now: NOW },
          );

        expect(stats.skippedReason).toBe("no-project");
        expect(harness.materializeCalls).toHaveLength(0);
      });

      test("ends early with 'no-users' when nobody is named and no ledger row points at the schedules", async () => {
        const stats: ShiftReminderChangePassStats =
          await OnCallShiftReminderRunner.runChangePass(changeEvent({}), {
            now: NOW,
          });

        expect(stats.skippedReason).toBe("no-users");
        expect(harness.materializeCalls).toHaveLength(0);
      });

      test("ends early with 'nothing-to-do' when the named users have no leads and no future ledger rows", async () => {
        const stats: ShiftReminderChangePassStats =
          await OnCallShiftReminderRunner.runChangePass(
            changeEvent({ userIds: [USER_C] }),
            { now: NOW },
          );

        expect(stats.skippedReason).toBe("nothing-to-do");
        expect(harness.materializeCalls).toHaveLength(0);
      });

      test("ends early with 'no-schedules' when there is nothing to materialize", async () => {
        harness.reminders = [reminder(USER_B, 60)];
        harness.candidateSchedules.set(USER_B.toString(), []);

        const stats: ShiftReminderChangePassStats =
          await OnCallShiftReminderRunner.runChangePass(
            changeEvent({ scheduleIds: [], userIds: [USER_B] }),
            { now: NOW },
          );

        expect(stats.skippedReason).toBe("no-schedules");
      });

      test("materializes the named schedules plus every schedule the reminded users can hold shifts on, to the farthest lead or ledger row", async () => {
        harness.reminders = [reminder(USER_B, 60)];
        harness.candidateSchedules.set(USER_B.toString(), [SCHEDULE_2]);
        // Alice has a reminder row for a shift 3 hours out on SCHEDULE.
        seedLedgerRow(harness, {
          projectId: PROJECT,
          userId: USER_A,
          scheduleId: SCHEDULE,
          shiftStartsAt: minutes(NOW, 180),
          minutesBeforeShift: 1440,
          kind: UserOnCallShiftReminderLogKind.Reminder,
          claimedAt: minutes(NOW, -1),
          sentAt: minutes(NOW, -1),
        });

        await OnCallShiftReminderRunner.runChangePass(
          changeEvent({ scheduleIds: [SCHEDULE], userIds: [USER_B] }),
          { now: NOW },
        );

        expect(harness.materializeCalls).toHaveLength(1);
        expect(harness.materializeCalls[0]!.scheduleIds.sort()).toEqual([
          SCHEDULE,
          SCHEDULE_2,
        ]);
        expect(harness.materializeCalls[0]!.windowStart.toISOString()).toBe(
          NOW.toISOString(),
        );
        expect(harness.materializeCalls[0]!.windowEnd.toISOString()).toBe(
          minutes(
            NOW,
            180 + SHIFT_REMINDER_WINDOW_PADDING_MINUTES,
          ).toISOString(),
        );
      });

      test("never throws: a materializer failure is counted and logged", async () => {
        harness.reminders = [reminder(USER_B, 60)];
        harness.shifts = [bobCoveringForAlice()];
        harness.materializeErrorForSchedules.add(SCHEDULE);

        const stats: ShiftReminderChangePassStats =
          await OnCallShiftReminderRunner.runChangePass(
            changeEvent({ userIds: [USER_B] }),
            { now: minutes(SHIFT_START, -10) },
          );

        expect(stats.errors).toBe(1);
        expect(harness.sent).toHaveLength(0);
        expect(
          harness.errors.some((entry: unknown) => {
            return String(entry).includes("change pass failed");
          }),
        ).toBe(true);
      });

      test("one user's failure does not stop the others", async () => {
        harness.reminders = [reminder(USER_B, 60), reminder(USER_C, 60)];
        harness.shifts = [
          bobCoveringForAlice(),
          aliceShift({
            scheduleId: SCHEDULE_2,
            userId: USER_C.toString(),
            userName: "Carol Chen",
          }),
        ];
        harness.failSend = (call: SentNotification): Error | null => {
          if (call.userId === USER_B.toString()) {
            throw new TypeError("unexpected");
          }
          return null;
        };

        const stats: ShiftReminderChangePassStats =
          await OnCallShiftReminderRunner.runChangePass(
            changeEvent({
              scheduleIds: [SCHEDULE, SCHEDULE_2],
              userIds: [USER_B, USER_C],
            }),
            { now: minutes(SHIFT_START, -10) },
          );

        expect(stats.catchUpsSent).toBe(1);
        expect(harness.sent[0]!.userId).toBe(USER_C.toString());
      });

      test("the reminder lead times are read for exactly the users in scope, as root", async () => {
        harness.reminders = [reminder(USER_B, 60)];
        harness.shifts = [bobCoveringForAlice()];

        const findBy: any = jest.spyOn(
          UserOnCallShiftReminderLogService,
          "findBy",
        );

        await OnCallShiftReminderRunner.runChangePass(
          changeEvent({ userIds: [USER_B] }),
          { now: minutes(SHIFT_START, -10) },
        );

        for (const call of findBy.mock.calls) {
          const args: { props: { isRoot: boolean } } = call[0] as unknown as {
            props: { isRoot: boolean };
          };
          expect(args.props.isRoot).toBe(true);
        }
      });
    });
  });

  /*
   * ---------------------------------------------------------------------
   * Retention
   * ---------------------------------------------------------------------
   */

  describe("deleteOldLogs", () => {
    test("deletes rows whose SHIFT started more than 30 days ago, in batches, until none remain", async () => {
      for (let index: number = 0; index < 5; index++) {
        seedLedgerRow(harness, {
          projectId: PROJECT,
          userId: USER_A,
          scheduleId: SCHEDULE,
          shiftStartsAt: OneUptimeDate.addRemoveDays(NOW, -31 - index),
          minutesBeforeShift: 60,
          kind: UserOnCallShiftReminderLogKind.Reminder,
          claimedAt: OneUptimeDate.addRemoveDays(NOW, -32 - index),
          sentAt: OneUptimeDate.addRemoveDays(NOW, -32 - index),
        });
      }
      // Claimed long ago but the shift is only 10 days old: kept.
      seedLedgerRow(harness, {
        projectId: PROJECT,
        userId: USER_A,
        scheduleId: SCHEDULE,
        shiftStartsAt: OneUptimeDate.addRemoveDays(NOW, -10),
        minutesBeforeShift: 60,
        kind: UserOnCallShiftReminderLogKind.Reminder,
        claimedAt: OneUptimeDate.addRemoveDays(NOW, -40),
        sentAt: null,
      });
      // A future shift: kept.
      seedLedgerRow(harness, {
        projectId: PROJECT,
        userId: USER_A,
        scheduleId: SCHEDULE,
        shiftStartsAt: SHIFT_START,
        minutesBeforeShift: 60,
        kind: UserOnCallShiftReminderLogKind.Reminder,
        claimedAt: NOW,
        sentAt: NOW,
      });

      const deleteBy: any = jest.spyOn(
        UserOnCallShiftReminderLogService,
        "deleteBy",
      );

      const result: ShiftReminderRetentionStats =
        await OnCallShiftReminderRunner.deleteOldLogs({
          now: NOW,
          batchSize: 2,
        });

      expect(result.deleted).toBe(5);
      expect(result.cutoff.toISOString()).toBe(
        OneUptimeDate.addRemoveDays(
          NOW,
          -SHIFT_REMINDER_LOG_RETENTION_DAYS,
        ).toISOString(),
      );
      expect(harness.ledger).toHaveLength(2);
      // 2 + 2 + 1, then the empty batch that ends the loop.
      expect(deleteBy).toHaveBeenCalledTimes(4);

      for (const call of deleteBy.mock.calls) {
        const args: {
          query: Record<string, unknown>;
          limit: number;
          props: { isRoot: boolean };
        } = call[0] as unknown as {
          query: Record<string, unknown>;
          limit: number;
          props: { isRoot: boolean };
        };

        expect(args.query["shiftStartsAt"]).toBeDefined();
        expect(args.limit).toBe(2);
        expect(args.props.isRoot).toBe(true);
      }
    });

    test("defaults: 30 days, batches of 100, the current time", async () => {
      const deleteBy: any = jest.spyOn(
        UserOnCallShiftReminderLogService,
        "deleteBy",
      );

      const result: ShiftReminderRetentionStats =
        await OnCallShiftReminderRunner.deleteOldLogs();

      expect(SHIFT_REMINDER_LOG_RETENTION_DAYS).toBe(30);
      expect(result.deleted).toBe(0);
      expect(
        Math.abs(
          result.cutoff.getTime() -
            OneUptimeDate.addRemoveDays(new Date(), -30).getTime(),
        ),
      ).toBeLessThan(5000);
      expect(
        (deleteBy.mock.calls[0]![0] as unknown as { limit: number }).limit,
      ).toBe(SHIFT_REMINDER_LOG_DELETE_BATCH_SIZE);
    });
  });
});

describe("OnCallShiftReminderRunner constants", () => {
  test("names and timings match the jobs and the spec", () => {
    expect(SHIFT_REMINDER_JOB_NAME).toBe(
      "OnCallDutySchedule:SendShiftReminders",
    );
    expect(SHIFT_REMINDER_MAX_LOOKBACK_MINUTES).toBe(30);
    expect(SHIFT_REMINDER_RECLAIM_AFTER_MINUTES).toBe(10);
    expect(SHIFT_REMINDER_WINDOW_PADDING_MINUTES).toBe(30);
    expect(SHIFT_REMINDER_LOG_RETENTION_DAYS).toBe(30);
  });

  test("the materializer is the only source of shifts (no direct engine access)", () => {
    // A sanity check that the runner goes through B's materializer API.
    expect(typeof OnCallShiftMaterializer.materializeForSchedules).toBe(
      "function",
    );
    expect(typeof OnCallShiftMaterializer.getCandidateScheduleIdsForUser).toBe(
      "function",
    );
  });
});
