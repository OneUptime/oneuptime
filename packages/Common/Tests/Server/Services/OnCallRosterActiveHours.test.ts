import moment from "moment-timezone";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleSchedule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import User from "../../../Models/DatabaseModels/User";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import OnCallDutyPolicyEscalationRuleScheduleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyScheduleService, {
  ScheduleLayerProps,
  ScheduleRosterInformation,
} from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import OnCallDutyPolicyTimeLogService from "../../../Server/Services/OnCallDutyPolicyTimeLogService";
import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
import UserService from "../../../Server/Services/UserService";
import logger from "../../../Server/Utils/Logger";
import EscalationRuleReach, {
  PolicyReachOfPerson,
} from "../../../Server/Utils/OnCall/EscalationRuleReach";
import OnCallHandoffPosts from "../../../Server/Utils/OnCall/OnCallHandoffPosts";
import ProjectMembership from "../../../Server/Utils/TeamMember/ProjectMembership";
import WorkspaceUserGroupSync from "../../../Server/Utils/Workspace/UserGroups/WorkspaceUserGroupSync";
import URL from "../../../Types/API/URL";
import OneUptimeDate from "../../../Types/Date";
import { EmailEnvelope } from "../../../Types/Email/EmailMessage";
import EventInterval from "../../../Types/Events/EventInterval";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../Types/ObjectID";
import { LayerProps } from "../../../Types/OnCallDutyPolicy/Layer";
import { UserOverrideRecord } from "../../../Types/OnCallDutyPolicy/UserOverrideUtil";
import Timezone from "../../../Types/Timezone";
import {
  dailyRestriction,
  rotation,
  tzInstant,
} from "../../Types/OnCallDutyPolicy/CalendarFeedTestFixtures";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A SCHEDULE OF NIGHTS, AS THE ROSTER REFRESH WORKS IT OUT AND TELLS IT
 * (#11268, #11270).
 *
 * The customer's schedule, through the real service: one layer of weekly
 * turns handing off on Mondays at 09:00 (08:00Z), on call from 17:00 to
 * 07:00 in Europe/Warsaw, paged by two on-call policies (a team policy and a
 * major-incident policy). Its layers, the overrides and the stored roster
 * are stood in for; the engine, the roster, the refresh and the hand-off are
 * the real ones.
 *
 *   - #11268: the roster said Thursday's shift ended at 11:59 PM, and after
 *     midnight that it started at 00:00; the timeline said 17:00 to 07:00.
 *     The "You are now on-call" email said the same as the roster.
 *   - #11270: each person heard "You are now on-call" every evening and "You
 *     are no longer on-call" every morning of their turn, once per policy -
 *     fourteen of each a week. Now once when the turn starts and once when
 *     it ends, with when the turn ends in the email; their time logs still
 *     start and end every night.
 */

const WARSAW: string = "Europe/Warsaw";
const NEW_YORK: string = "America/New_York";

const PROJECT_ID: ObjectID = new ObjectID(
  "11268000-0000-4000-8000-000000000001",
);
const SCHEDULE_ID: ObjectID = new ObjectID(
  "11268000-0000-4000-8000-000000000002",
);
const TEAM_POLICY: ObjectID = new ObjectID(
  "11268000-0000-4000-8000-000000000003",
);
const MAJOR_POLICY: ObjectID = new ObjectID(
  "11268000-0000-4000-8000-000000000004",
);
const ALICE: ObjectID = new ObjectID("11268000-0000-4000-8000-0000000000a1");
const BOB: ObjectID = new ObjectID("11268000-0000-4000-8000-0000000000b1");

const NAMES: Record<string, string> = {
  [ALICE.toString()]: "alice",
  [BOB.toString()]: "bob",
};

function person(id: ObjectID): User {
  const user: User = new User();
  user.id = id;
  return user;
}

function wallClock(date: Date | null | undefined, tz: string): string | null {
  return date ? moment.tz(date, tz).format("ddd, MMM D, HH:mm") : null;
}

// The customer's layer, with the turns and hand-off of their API call.
function nightsLayer(tz: string, users?: Array<ObjectID>): LayerProps {
  return {
    users: (users || [ALICE, BOB]).map(person),
    startDateTimeOfLayer: tzInstant("2026-11-23 09:00", tz),
    handOffTime: tzInstant("2026-11-30 09:00", tz),
    rotation: rotation(EventInterval.Week, 1),
    restrictionTimes: dailyRestriction("17:00", "07:00", tz),
    timezone: tz,
    layerId: "11268000-0000-4000-8000-0000000000c1",
    layerName: "Nights",
  };
}

function attachment(data: {
  policyId: ObjectID;
  policyName: string;
}): OnCallDutyPolicyEscalationRuleSchedule {
  const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
  policy.id = data.policyId;
  policy.name = data.policyName;

  const rule: OnCallDutyPolicyEscalationRule =
    new OnCallDutyPolicyEscalationRule();
  rule.id = ObjectID.generate();
  rule.name = "Nights first";
  rule.order = 1;

  const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
  schedule.id = SCHEDULE_ID;
  schedule.name = "Nights";
  schedule.timezone = Timezone.EuropeWarsaw;

  const row: OnCallDutyPolicyEscalationRuleSchedule =
    new OnCallDutyPolicyEscalationRuleSchedule();
  row.id = ObjectID.generate();
  row.projectId = PROJECT_ID;
  row.pageNextInRotation = false;
  row.onCallDutyPolicy = policy;
  row.onCallDutyPolicyEscalationRule = rule;
  row.onCallDutyPolicySchedule = schedule;
  return row;
}

let clock: Date;
let layers: Array<LayerProps>;
let stored: OnCallDutyPolicySchedule;

interface Sent {
  person: string;
  eventType: NotificationSettingEventType;
  policyId: string;
  at: string | null;
  email: EmailEnvelope;
}

let sent: Array<Sent>;
let timeLogStarts: Array<string>;
let timeLogEnds: Array<string>;

beforeEach(() => {
  sent = [];
  timeLogStarts = [];
  timeLogEnds = [];
  layers = [nightsLayer(WARSAW)];
  stored = new OnCallDutyPolicySchedule();
  stored.id = SCHEDULE_ID;

  jest.spyOn(logger, "debug").mockImplementation((() => {}) as never);
  jest.spyOn(logger, "error").mockImplementation((() => {}) as never);

  /*
   * The clock alone is the test's: every read of the time - the roster's
   * "now", what is in the future, when a time log starts - is of it.
   */
  jest.useFakeTimers({
    doNotFake: [
      "nextTick",
      "setImmediate",
      "setTimeout",
      "setInterval",
      "clearTimeout",
      "clearInterval",
      "queueMicrotask",
    ],
  });

  // The schedule's layers and their people, and nobody away.
  jest
    .spyOn(OnCallDutyPolicyScheduleService, "getScheduleLayerProps")
    .mockImplementation(async (): Promise<ScheduleLayerProps> => {
      return {
        layerProps: layers,
        projectId: PROJECT_ID,
        scheduleUserIds: [ALICE, BOB],
      };
    });
  jest
    .spyOn(
      OnCallDutyPolicyScheduleService as unknown as {
        fetchOverridesForSchedule: () => Promise<Array<UserOverrideRecord>>;
      },
      "fetchOverridesForSchedule",
    )
    .mockResolvedValue([]);

  // The stored roster, read and written as the refresh reads and writes it.
  jest.spyOn(Semaphore, "lock").mockRejectedValue(new Error("no Redis here"));
  jest
    .spyOn(OnCallDutyPolicyScheduleService, "findOneById")
    .mockImplementation((async () => {
      const copy: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
      copy.id = SCHEDULE_ID;
      copy.currentUserIdOnRoster = stored.currentUserIdOnRoster!;
      copy.rosterStartAt = stored.rosterStartAt!;
      copy.rosterHandoffAt = stored.rosterHandoffAt!;
      copy.nextUserIdOnRoster = stored.nextUserIdOnRoster!;
      copy.rosterNextStartAt = stored.rosterNextStartAt!;
      copy.rosterNextHandoffAt = stored.rosterNextHandoffAt!;
      copy.rosterTurnKey = stored.rosterTurnKey!;
      return copy;
    }) as never);
  jest
    .spyOn(OnCallDutyPolicyScheduleService, "updateOneById")
    .mockImplementation((async (data: { data: Record<string, unknown> }) => {
      Object.assign(stored, data.data);
    }) as never);
  jest
    .spyOn(WorkspaceUserGroupSync, "requestSyncForSchedules")
    .mockResolvedValue(undefined as never);

  // Two policies page the schedule, each from one rule.
  jest
    .spyOn(OnCallDutyPolicyEscalationRuleScheduleService, "findBy")
    .mockResolvedValue([
      attachment({ policyId: TEAM_POLICY, policyName: "Team" }),
      attachment({ policyId: MAJOR_POLICY, policyName: "Major incident" }),
    ] as never);

  // Both are members, and nothing else on the policies pages them.
  jest
    .spyOn(ProjectMembership, "getMemberUserIds")
    .mockImplementation((async (data: { userIds: Array<ObjectID> }) => {
      return new Set<string>(
        data.userIds.map((userId: ObjectID): string => {
          return userId.toString().toLowerCase();
        }),
      );
    }) as never);
  jest
    .spyOn(EscalationRuleReach, "readPolicyPathsOfPerson")
    .mockResolvedValue(new Map() as PolicyReachOfPerson);

  jest
    .spyOn(UserService, "getTimezoneForUser")
    .mockResolvedValue(Timezone.EuropeWarsaw);
  jest
    .spyOn(OnCallDutyPolicyService, "getOnCallDutyPolicyLinkInDashboard")
    .mockImplementation((async (_projectId: ObjectID, policyId: ObjectID) => {
      return URL.fromString(
        `https://oneuptime.test/dashboard/on-call-duty/policies/${policyId.toString()}`,
      );
    }) as never);
  jest
    .spyOn(UserNotificationSettingService, "sendUserNotification")
    .mockImplementation((async (data: {
      userId: ObjectID;
      eventType: NotificationSettingEventType;
      onCallPolicyId: ObjectID;
      emailEnvelope: EmailEnvelope;
    }) => {
      sent.push({
        person: NAMES[data.userId.toString()] || "?",
        eventType: data.eventType,
        policyId: data.onCallPolicyId.toString(),
        at: wallClock(clock, WARSAW),
        email: data.emailEnvelope,
      });
    }) as never);
  jest
    .spyOn(OnCallDutyPolicyTimeLogService, "startTimeLogForUser")
    .mockImplementation((async (data: { userId: ObjectID }) => {
      timeLogStarts.push(
        `${NAMES[data.userId.toString()]} ${wallClock(clock, WARSAW)}`,
      );
    }) as never);
  jest
    .spyOn(OnCallDutyPolicyTimeLogService, "endTimeLogForUser")
    .mockImplementation((async (data: { userId: ObjectID }) => {
      timeLogEnds.push(
        `${NAMES[data.userId.toString()]} ${wallClock(clock, WARSAW)}`,
      );
    }) as never);
  jest.spyOn(OnCallHandoffPosts, "post").mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function setClock(now: Date): void {
  clock = now;
  jest.setSystemTime(now);
}

async function rosterAt(now: Date): Promise<ScheduleRosterInformation> {
  setClock(now);
  return await OnCallDutyPolicyScheduleService.getCurrrentUserIdAndHandoffTimeInSchedule(
    SCHEDULE_ID,
  );
}

describe("REGRESSION #11268: the roster states the shift the timeline shows", () => {
  test("Thursday 17:00 in Warsaw: on call until 07:00 Friday, not 11:59 PM", async () => {
    const roster: ScheduleRosterInformation = await rosterAt(
      tzInstant("2026-11-26 17:00", WARSAW),
    );

    expect(roster.currentUserId?.toString()).toBe(ALICE.toString());
    expect(wallClock(roster.rosterStartAt, WARSAW)).toBe("Thu, Nov 26, 17:00");
    expect(wallClock(roster.handOffTimeAt, WARSAW)).toBe("Fri, Nov 27, 07:00");

    expect(roster.nextUserId?.toString()).toBe(ALICE.toString());
    expect(wallClock(roster.nextRosterStartAt, WARSAW)).toBe(
      "Fri, Nov 27, 17:00",
    );
    expect(wallClock(roster.nextHandOffTimeAt, WARSAW)).toBe(
      "Sat, Nov 28, 07:00",
    );

    expect(roster.currentTurnKey).toBe(roster.nextTurnKey);
    expect(wallClock(roster.currentTurnEndsAt, WARSAW)).toBe(
      "Mon, Nov 30, 07:00",
    );
  });

  test("REGRESSION: after midnight the shift still started at 17:00, not at 00:00", async () => {
    const roster: ScheduleRosterInformation = await rosterAt(
      tzInstant("2026-11-27 02:15", WARSAW),
    );

    expect(wallClock(roster.rosterStartAt, WARSAW)).toBe("Thu, Nov 26, 17:00");
    expect(wallClock(roster.handOffTimeAt, WARSAW)).toBe("Fri, Nov 27, 07:00");
  });

  test("in New York, the same", async () => {
    layers = [nightsLayer(NEW_YORK)];

    const roster: ScheduleRosterInformation = await rosterAt(
      tzInstant("2026-11-26 21:00", NEW_YORK),
    );

    expect(wallClock(roster.rosterStartAt, NEW_YORK)).toBe(
      "Thu, Nov 26, 17:00",
    );
    expect(wallClock(roster.handOffTimeAt, NEW_YORK)).toBe(
      "Fri, Nov 27, 07:00",
    );
  });

  test("between windows: nobody on call, and the next window next", async () => {
    const roster: ScheduleRosterInformation = await rosterAt(
      tzInstant("2026-11-27 12:00", WARSAW),
    );

    expect(roster.currentUserId).toBeNull();
    expect(roster.handOffTimeAt).toBeNull();
    expect(roster.nextUserId?.toString()).toBe(ALICE.toString());
    expect(wallClock(roster.nextRosterStartAt, WARSAW)).toBe(
      "Fri, Nov 27, 17:00",
    );
    expect(wallClock(roster.nextHandOffTimeAt, WARSAW)).toBe(
      "Sat, Nov 28, 07:00",
    );
  });

  test("a schedule with no layers has no roster", async () => {
    layers = [];

    const roster: ScheduleRosterInformation = await rosterAt(
      tzInstant("2026-11-26 17:00", WARSAW),
    );

    expect(roster.currentUserId).toBeNull();
    expect(roster.nextUserId).toBeNull();
  });
});

/*
 * The refresh, run as OnCallDutySchedule:RefreshHandoffTime runs it: at each
 * moment the stored roster is due - its hand-off, or with nobody on call the
 * next shift's start - from `from` until `to`.
 */
async function runTheRefreshes(from: Date, to: Date): Promise<number> {
  let now: Date = from;
  let refreshes: number = 0;

  for (let guard: number = 0; guard < 500; guard++) {
    setClock(now);
    await OnCallDutyPolicyScheduleService.refreshCurrentUserIdAndHandoffTimeInSchedule(
      SCHEDULE_ID,
    );
    refreshes++;

    const due: Date | undefined =
      stored.rosterHandoffAt || stored.rosterNextStartAt;

    if (!due || due.getTime() > to.getTime()) {
      break;
    }

    // The cron runs every minute, at the minute: the first one due.
    now = new Date(Math.ceil(due.getTime() / 60000) * 60000);
  }

  return refreshes;
}

function toldOf(eventType: NotificationSettingEventType): Array<string> {
  return sent
    .filter((one: Sent): boolean => {
      return one.eventType === eventType;
    })
    .map((one: Sent): string => {
      return `${one.person} ${one.at} ${
        one.policyId === TEAM_POLICY.toString() ? "Team" : "Major incident"
      }`;
    });
}

describe("REGRESSION #11270: a turn of nights is told once, as it starts and as it ends", () => {
  test("two weeks, two policies: two notices each way per turn, not fourteen", async () => {
    await runTheRefreshes(
      tzInstant("2026-11-23 12:00", WARSAW),
      tzInstant("2026-12-07 12:00", WARSAW),
    );

    expect(
      toldOf(NotificationSettingEventType.SEND_WHEN_USER_IS_ON_CALL_ROSTER),
    ).toEqual([
      "alice Mon, Nov 23, 17:00 Team",
      "alice Mon, Nov 23, 17:00 Major incident",
      "bob Mon, Nov 30, 17:00 Team",
      "bob Mon, Nov 30, 17:00 Major incident",
    ]);

    expect(
      toldOf(
        NotificationSettingEventType.SEND_WHEN_USER_IS_NO_LONGER_ACTIVE_ON_ON_CALL_ROSTER,
      ),
    ).toEqual([
      "alice Mon, Nov 30, 07:00 Team",
      "alice Mon, Nov 30, 07:00 Major incident",
      "bob Mon, Dec 7, 07:00 Team",
      "bob Mon, Dec 7, 07:00 Major incident",
    ]);

    // Bob hears he is next once, as Alice's last night begins; Alice, as Bob's does.
    expect(
      toldOf(
        NotificationSettingEventType.SEND_WHEN_USER_IS_NEXT_ON_CALL_ROSTER,
      ),
    ).toEqual([
      "alice Mon, Nov 23, 12:00 Team",
      "alice Mon, Nov 23, 12:00 Major incident",
      "bob Sun, Nov 29, 17:00 Team",
      "bob Sun, Nov 29, 17:00 Major incident",
      "alice Sun, Dec 6, 17:00 Team",
      "alice Sun, Dec 6, 17:00 Major incident",
    ]);

    // The time logs are the record: every night started and ended, per policy.
    expect(timeLogStarts).toHaveLength(14 * 2);
    expect(timeLogEnds).toHaveLength(14 * 2);
    expect(timeLogStarts.slice(0, 4)).toEqual([
      "alice Mon, Nov 23, 17:00",
      "alice Mon, Nov 23, 17:00",
      "alice Tue, Nov 24, 17:00",
      "alice Tue, Nov 24, 17:00",
    ]);
  });

  test("the email says the shift ends at 07:00 the next morning, and when the turn ends", async () => {
    await runTheRefreshes(
      tzInstant("2026-11-23 12:00", WARSAW),
      tzInstant("2026-11-23 18:00", WARSAW),
    );

    const nowOnCall: Sent = sent.find((one: Sent): boolean => {
      return (
        one.eventType ===
          NotificationSettingEventType.SEND_WHEN_USER_IS_ON_CALL_ROSTER &&
        one.policyId === TEAM_POLICY.toString()
      );
    })!;

    const format: (date: Date) => string = (date: Date): string => {
      return OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
        date: date,
        timezones: [Timezone.EuropeWarsaw],
      });
    };

    const vars: Record<string, string> = nowOnCall.email.vars as Record<
      string,
      string
    >;

    expect(vars["rosterStartsAt"]).toBe(
      format(tzInstant("2026-11-23 17:00", WARSAW)),
    );
    expect(vars["rosterEndsAt"]).toBe(
      format(tzInstant("2026-11-24 07:00", WARSAW)),
    );
    expect(vars["rosterTurnEndsAt"]).toBe(
      format(tzInstant("2026-11-30 07:00", WARSAW)),
    );
    expect(vars["rosterEndsAt"]).not.toContain("11:59");
  });

  test("the stored roster keeps the turn through the day, and names the next window", async () => {
    await runTheRefreshes(
      tzInstant("2026-11-23 12:00", WARSAW),
      tzInstant("2026-11-24 07:00", WARSAW),
    );

    expect(stored.currentUserIdOnRoster).toBeNull();
    expect(wallClock(stored.rosterNextStartAt, WARSAW)).toBe(
      "Tue, Nov 24, 17:00",
    );
    expect(wallClock(stored.rosterNextHandoffAt, WARSAW)).toBe(
      "Wed, Nov 25, 07:00",
    );
    expect(stored.rosterTurnKey).toContain(ALICE.toString());
  });

  test("a turn kept before the stored roster had one: told as before, once", async () => {
    // As stored before this was kept: Alice on call Monday night, no turn.
    stored.currentUserIdOnRoster = ALICE;
    stored.rosterStartAt = tzInstant("2026-11-23 17:00", WARSAW);
    stored.rosterHandoffAt = tzInstant("2026-11-23 23:59", WARSAW);

    await runTheRefreshes(
      tzInstant("2026-11-24 00:00", WARSAW),
      tzInstant("2026-11-26 12:00", WARSAW),
    );

    // Every refresh after the first knows the turn.
    expect(
      toldOf(NotificationSettingEventType.SEND_WHEN_USER_IS_ON_CALL_ROSTER),
    ).toEqual([]);
    expect(
      toldOf(
        NotificationSettingEventType.SEND_WHEN_USER_IS_NO_LONGER_ACTIVE_ON_ON_CALL_ROSTER,
      ),
    ).toEqual([]);
  });
});
