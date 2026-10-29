import {
  getUserOverrideFormFields,
  prepareUserOverrideForCreate,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/UserOverrides/UserOverrideForm";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLogTimeline from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import OnCallDutyPolicyUserOverride from "../../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import OnCallDutyPolicyEscalationRuleService, {
  AwayOverride,
  OnCallRuleExecutionOutcome,
} from "../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyEscalationRuleTeamService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleTeamService";
import OnCallDutyPolicyEscalationRuleUserService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleUserService";
import OnCallDutyPolicyExecutionLogService from "../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyExecutionLogTimelineService from "../../../Server/Services/OnCallDutyPolicyExecutionLogTimelineService";
import OnCallDutyPolicyFeedService from "../../../Server/Services/OnCallDutyPolicyFeedService";
import OnCallDutyPolicyScheduleService, {
  CurrentOnCallInSchedule,
  ResolvedShiftSegments,
} from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import OnCallDutyPolicyTimeLogService from "../../../Server/Services/OnCallDutyPolicyTimeLogService";
import OnCallDutyPolicyUserOverrideService from "../../../Server/Services/OnCallDutyPolicyUserOverrideService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
import UserService from "../../../Server/Services/UserService";
import logger from "../../../Server/Utils/Logger";
import OnCallShiftMaterializer, {
  MaterializeResult,
} from "../../../Server/Utils/OnCall/OnCallShiftMaterializer";
import ProjectMembership from "../../../Server/Utils/TeamMember/ProjectMembership";
import URL from "../../../Types/API/URL";
import CalendarEvent from "../../../Types/Calendar/CalendarEvent";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import OneUptimeDate from "../../../Types/Date";
import EventInterval from "../../../Types/Events/EventInterval";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  getAwayTimelineMessage,
  readAwayUntil,
} from "../../../Types/OnCallDutyPolicy/AwayTimelineMessage";
import { MaterializedShift } from "../../../Types/OnCallDutyPolicy/MaterializedShift";
import OnCallDutyExecutionLogTimelineStatus from "../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import { ON_CALL_LEVEL_PAGED_NOBODY_TIMELINE_MESSAGE } from "../../../Types/OnCallDutyPolicy/OnCallEmptyLevel";
import OnCallCalendarFeedUtil, {
  OnCallCalendarFeedKind,
} from "../../../Types/OnCallDutyPolicy/OnCallCalendarFeedUtil";
import ScheduleTimelineUtil from "../../../Types/OnCallDutyPolicy/ScheduleTimeline";
import UserOverrideUtil, {
  OverrideEventMeta,
} from "../../../Types/OnCallDutyPolicy/UserOverrideUtil";
import Permission from "../../../Types/Permission";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import Field from "../../../UI/Components/Forms/Types/Field";
import FeedMarkdown from "../../../Utils/Markdown/FeedMarkdown";
import {
  at,
  rotation,
} from "../../Types/OnCallDutyPolicy/CalendarFeedTestFixtures";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import {
  FakeDb,
  emptyDb,
  installFakeDb,
  makeAttachment,
  makeLayer,
  makeLayerUser,
  makeOverride,
  makeSchedule,
  makeUser,
  oid,
} from "../Utils/OnCall/OnCallResolverTestHarness";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * SKIP SOMEBODY UNTIL A DATE, WITHOUT NAMING WHO COVERS - ON THE SERVER.
 *
 * A customer asked to "skip user X until [date]" in an on-call schedule for
 * holidays, without picking a replacement: while they are away, the next
 * person in the rotation takes each of their turns, and afterwards they are
 * back in their usual place. That is a user override with nobody picked
 * under "Who covers?" - the Add User Override form's default now.
 *
 * These fill the real form in (getUserOverrideFormFields and the page's
 * prepareUserOverrideForCreate), save it through the real
 * OnCallDutyPolicyUserOverrideService.create, and then ask every server path
 * that answers "who is on call" - with only the tables in memory
 * (OnCallResolverTestHarness):
 *
 *   - the schedule a page goes through (getCurrentOnCallInSchedule), now
 *     and at a given moment;
 *   - the stored roster and the hand-off notifications it sends;
 *   - an escalation rule that names the person directly (getAwayOverride,
 *     startRuleExecution), which does not page them and says until when;
 *   - the calendar feeds' resolver and materializer, the schedule
 *     timeline's wire shape and the feed's wording;
 *   - a policy's own skip against a global one, a skip against a named
 *     cover, and everybody away at once.
 *
 * On OneUptime Cloud user overrides are on the Growth plan, so billing is
 * pinned on with the plans CI configures (packages/Common/test-setup.sh).
 */
jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    IsBillingEnabled: true,
    getAllEnvVars: () => {
      return {
        SUBSCRIPTION_PLAN_BASIC:
          "Free,price_basic_monthly,price_basic_yearly,0,0,1,0",
        SUBSCRIPTION_PLAN_GROWTH:
          "Growth,price_growth_monthly,price_growth_yearly,22,20,2,14",
        SUBSCRIPTION_PLAN_SCALE:
          "Scale,price_scale_monthly,price_scale_yearly,99,84,3,14",
        SUBSCRIPTION_PLAN_ENTERPRISE:
          "Enterprise,price_enterprise_monthly,price_enterprise_yearly,-1,-1,4,14",
      };
    },
  };
});

const PROJECT: string = "0e300000-0000-4000-8000-000000000001";
const POLICY: string = "0e300000-0000-4000-8000-000000000002";
const OTHER_POLICY: string = "0e300000-0000-4000-8000-000000000003";
const SCHEDULE: string = "0e300000-0000-4000-8000-000000000004";
const LAYER: string = "0e300000-0000-4000-8000-000000000005";
const RULE: string = "0e300000-0000-4000-8000-000000000006";
const EXECUTION_LOG: string = "0e300000-0000-4000-8000-000000000007";
const INCIDENT: string = "0e300000-0000-4000-8000-000000000008";

/*
 * Alex, Sam and Kim take turns of a day, handing over at 09:00 UTC: Alex
 * from Tuesday 3 March 2026, Sam on Wednesday, Kim on Thursday, Alex again
 * on Friday. Alex is going on holiday.
 */
const ALEX: string = "0e300000-0000-4000-8000-0000000000a1";
const SAM: string = "0e300000-0000-4000-8000-0000000000b1";
const KIM: string = "0e300000-0000-4000-8000-0000000000c1";
// Not in the schedule: named to cover in the tests that name somebody.
const RIA: string = "0e300000-0000-4000-8000-0000000000d1";

const NOW: Date = at("2026-03-03T12:00:00Z");
const BACK_ON_FRIDAY: Date = at("2026-03-06T12:00:00Z");

let db: FakeDb;
let savedCount: number;

function callerProps(callerId: string): DatabaseCommonInteractionProps {
  return {
    userId: new ObjectID(callerId),
    tenantId: new ObjectID(PROJECT),
    currentPlan: PlanType.Growth,
    userTenantAccessPermission: {
      [PROJECT]: {
        _type: "UserTenantAccessPermission",
        projectId: new ObjectID(PROJECT),
        permissions: [
          {
            _type: "UserPermission",
            permission: Permission.OnCallMember,
            labelIds: [],
            scope: PermissionScope.All,
            isBlockPermission: false,
          },
        ],
      },
    },
  };
}

function fieldKey(field: Field<OnCallDutyPolicyUserOverride>): string {
  return Object.keys(field.field || {})[0] as string;
}

function pickerValueKey(field: Field<OnCallDutyPolicyUserOverride>): string {
  const valueKey: string | undefined = field.peoplePicker?.kinds[0]?.valueKey;

  if (!valueKey) {
    throw new Error(`${field.title} is not a people picker.`);
  }

  return valueKey;
}

/*
 * The Add User Override form filled in as the dashboard does - its defaults,
 * the answers given, every field's own check, the model ModelForm builds,
 * the page's onBeforeCreate - and the JSON the API reads. With no
 * `whoCovers`, "Who covers?" is left as it starts: the rotation.
 */
function fillInForm(answers: {
  signedInAs: string;
  whoIsAway?: string | undefined;
  whoCovers?: string | undefined;
  starts?: Date | undefined;
  ends: Date;
  policy?: string | undefined;
}): OnCallDutyPolicyUserOverride {
  const fields: Array<Field<OnCallDutyPolicyUserOverride>> =
    getUserOverrideFormFields<OnCallDutyPolicyUserOverride>({
      currentUserId: answers.signedInAs,
      awayUserId: answers.whoIsAway,
    });

  const byQuestion: (title: string) => Field<OnCallDutyPolicyUserOverride> = (
    title: string,
  ): Field<OnCallDutyPolicyUserOverride> => {
    const field: Field<OnCallDutyPolicyUserOverride> | undefined = fields.find(
      (candidate: Field<OnCallDutyPolicyUserOverride>): boolean => {
        return candidate.title === title;
      },
    );

    if (!field) {
      throw new Error(`The form does not ask "${title}".`);
    }

    return field;
  };

  const values: JSONObject = {};

  for (const field of fields) {
    if (field.defaultValue !== undefined) {
      values[fieldKey(field)] = field.defaultValue as string;
    }

    if (field.getDefaultValue && values[fieldKey(field)] === undefined) {
      values[fieldKey(field)] = field.getDefaultValue(values) as string;
    }
  }

  if (answers.whoCovers) {
    values[pickerValueKey(byQuestion("Who covers?"))] = answers.whoCovers;
  }

  if (answers.starts) {
    values[fieldKey(byQuestion("Starts"))] = OneUptimeDate.toString(
      answers.starts,
    );
  }

  values[fieldKey(byQuestion("Ends"))] = OneUptimeDate.toString(answers.ends);

  for (const field of fields) {
    expect(field.customValidation?.(values) ?? null).toBeNull();
  }

  const model: OnCallDutyPolicyUserOverride = BaseModel.fromJSON(
    values,
    OnCallDutyPolicyUserOverride,
  ) as OnCallDutyPolicyUserOverride;

  const prepared: OnCallDutyPolicyUserOverride = prepareUserOverrideForCreate(
    model,
    {
      projectId: new ObjectID(PROJECT),
      onCallDutyPolicyId: answers.policy
        ? new ObjectID(answers.policy)
        : undefined,
    },
  );

  return BaseModel.fromJSON(
    BaseModel.toJSON(prepared, OnCallDutyPolicyUserOverride),
    OnCallDutyPolicyUserOverride,
  ) as OnCallDutyPolicyUserOverride;
}

async function bookTimeAway(
  answers: Parameters<typeof fillInForm>[0],
): Promise<OnCallDutyPolicyUserOverride> {
  return OnCallDutyPolicyUserOverrideService.create({
    data: fillInForm(answers),
    props: callerProps(answers.signedInAs),
  });
}

interface OnCallNow {
  userId: string;
  coveredUserId: string | null;
  isSkip: boolean;
  coveredUntil: string | null;
}

async function onCallInSchedule(
  options: { policy?: string | undefined; at?: Date | undefined } = {},
): Promise<OnCallNow | null> {
  const onCall: CurrentOnCallInSchedule | null =
    await OnCallDutyPolicyScheduleService.getCurrentOnCallInSchedule(
      oid(SCHEDULE),
      {
        onCallDutyPolicyId: oid(options.policy || POLICY),
        at: options.at,
      },
    );

  return onCall
    ? {
        userId: onCall.userId.toString(),
        coveredUserId: onCall.coveredUserId?.toString() || null,
        isSkip: Boolean(onCall.isSkip),
        coveredUntil: onCall.coveredUntil
          ? onCall.coveredUntil.toISOString()
          : null,
      }
    : null;
}

async function awayFor(
  userId: string,
  policy: string = POLICY,
): Promise<{ coverUserId: string | null; endsAt: string } | null> {
  const away: AwayOverride | null =
    await OnCallDutyPolicyEscalationRuleService.getAwayOverride({
      userId: oid(userId),
      onCallDutyPolicyId: oid(policy),
      projectId: oid(PROJECT),
    });

  return away
    ? {
        coverUserId: away.coverUserId?.toString() || null,
        endsAt: away.endsAt.toISOString(),
      }
    : null;
}

function setNow(now: Date): void {
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(now);
}

beforeEach(() => {
  stubProjectDirectory({});

  db = emptyDb();
  savedCount = 0;

  db.schedules.push(
    makeSchedule({
      id: SCHEDULE,
      projectId: PROJECT,
      name: "Payments primary",
      timezone: "UTC",
    }),
  );
  db.layers.push(
    makeLayer({
      id: LAYER,
      scheduleId: SCHEDULE,
      projectId: PROJECT,
      name: "Layer 1",
      startsAt: at("2026-03-03T09:00:00Z"),
      handOffTime: at("2026-03-03T09:00:00Z"),
      rotation: rotation(EventInterval.Day, 1),
    }),
  );

  for (const [index, userId] of [ALEX, SAM, KIM].entries()) {
    db.layerUsers.push(
      makeLayerUser({
        id: `0e300000-0000-4000-8000-00000000010${index}`,
        scheduleId: SCHEDULE,
        layerId: LAYER,
        projectId: PROJECT,
        userId,
        order: index + 1,
      }),
    );
  }

  db.users.push(
    makeUser({ id: ALEX, name: "Alex Kim", timezone: "UTC" }),
    makeUser({ id: SAM, name: "Sam Lee", timezone: "UTC" }),
    makeUser({ id: KIM, name: "Kim Ito", timezone: "UTC" }),
    makeUser({ id: RIA, name: "Ria Das", timezone: "UTC" }),
  );

  installFakeDb(db);
  setNow(NOW);

  // What create saves is what everything else reads.
  jest
    .spyOn(OnCallDutyPolicyUserOverrideService, "getRepository")
    .mockReturnValue({
      save: async (
        data: OnCallDutyPolicyUserOverride,
      ): Promise<OnCallDutyPolicyUserOverride> => {
        savedCount++;
        data._id = `0e300000-0000-4000-8000-${String(900 + savedCount).padStart(12, "0")}`;
        db.overrides.push(data as unknown as Record<string, unknown>);
        return data;
      },
    } as never);

  jest
    .spyOn(OnCallDutyPolicyService, "getOnCallDutyPolicyName")
    .mockResolvedValue("Payments");
  jest
    .spyOn(OnCallDutyPolicyService, "getOnCallDutyPolicyLinkInDashboard")
    .mockResolvedValue(URL.fromString("https://oneuptime.example/policy"));
  jest.spyOn(UserService, "getTimezoneForUser").mockResolvedValue(null);
  jest
    .spyOn(UserService, "getUserMarkdownString")
    .mockImplementation(async (data: { userId: ObjectID }) => {
      return FeedMarkdown.asMarkdown(`user-${data.userId.toString()}`);
    });
  jest
    .spyOn(OnCallDutyPolicyFeedService, "createOnCallDutyPolicyFeedItem")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(OnCallDutyPolicyScheduleService, "refreshRostersForUserInProject")
    .mockResolvedValue(undefined);
  jest
    .spyOn(OnCallDutyPolicyScheduleService, "getScheduleIdsForUsersInProject")
    .mockResolvedValue([]);
  jest
    .spyOn(OnCallDutyPolicyScheduleService, "propagateShiftConfigChange")
    .mockResolvedValue(undefined);

  for (const level of ["debug", "info", "warn"] as const) {
    jest.spyOn(logger, level).mockImplementation(() => {
      return undefined as never;
    });
  }
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Booking time away with nobody picked to cover", () => {
  test("is saved as a skip: the person away, and no cover", async () => {
    const saved: OnCallDutyPolicyUserOverride = await bookTimeAway({
      signedInAs: ALEX,
      ends: BACK_ON_FRIDAY,
    });

    expect(saved.overrideUserId?.toString()).toBe(ALEX);
    expect(saved.routeAlertsToUserId).toBeFalsy();
    expect(db.overrides).toHaveLength(1);
    expect(db.overrides[0]!["routeAlertsToUserId"]).toBeFalsy();
  });

  test("a cover picked is saved as before", async () => {
    const saved: OnCallDutyPolicyUserOverride = await bookTimeAway({
      signedInAs: ALEX,
      whoCovers: RIA,
      ends: BACK_ON_FRIDAY,
    });

    expect(saved.routeAlertsToUserId?.toString()).toBe(RIA);
  });

  test("booked for somebody else from their row in the layer, it skips them", async () => {
    const saved: OnCallDutyPolicyUserOverride = await bookTimeAway({
      signedInAs: KIM,
      whoIsAway: ALEX,
      ends: BACK_ON_FRIDAY,
    });

    expect(saved.overrideUserId?.toString()).toBe(ALEX);
    expect(saved.routeAlertsToUserId).toBeFalsy();
  });

  test("the server still refuses the same person away and covering", async () => {
    const override: OnCallDutyPolicyUserOverride = fillInForm({
      signedInAs: ALEX,
      ends: BACK_ON_FRIDAY,
    });

    override.routeAlertsToUserId = new ObjectID(ALEX.toUpperCase());

    await expect(
      OnCallDutyPolicyUserOverrideService.create({
        data: override,
        props: callerProps(ALEX),
      }),
    ).rejects.toThrow(
      "Override user and route alerts to user cannot be the same",
    );
    expect(db.overrides).toHaveLength(0);
  });

  test("a policy's own skip says in its feed what happens to their turns", async () => {
    await bookTimeAway({
      signedInAs: ALEX,
      ends: BACK_ON_FRIDAY,
      policy: POLICY,
    });

    const feed: Array<unknown> = (
      OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem as unknown as {
        mock: { calls: Array<Array<{ feedInfoInMarkdown: string }>> };
      }
    ).mock.calls.map((call: Array<{ feedInfoInMarkdown: string }>) => {
      return call[0]!.feedInfoInMarkdown;
    });

    expect(feed).toHaveLength(1);
    expect(String(feed[0])).toContain("Nobody is named to cover");
    expect(String(feed[0])).toContain(
      "each of their turns goes to the next person in the rotation",
    );
    expect(String(feed[0])).not.toContain("All alerts will be routed to");
  });
});

describe("A schedule pages the next person in the rotation while somebody is skipped", () => {
  test("Alex's turn goes to Sam, the next person, and says whose turn it is", async () => {
    await expect(onCallInSchedule()).resolves.toEqual({
      userId: ALEX,
      coveredUserId: null,
      isSkip: false,
      coveredUntil: null,
    });

    await bookTimeAway({ signedInAs: ALEX, ends: BACK_ON_FRIDAY });

    await expect(onCallInSchedule()).resolves.toEqual({
      userId: SAM,
      coveredUserId: ALEX,
      isSkip: true,
      coveredUntil: BACK_ON_FRIDAY.toISOString(),
    });
  });

  test("everybody else's turns stay theirs: Sam on Wednesday, Kim on Thursday", async () => {
    await bookTimeAway({ signedInAs: ALEX, ends: BACK_ON_FRIDAY });

    expect(
      (await onCallInSchedule({ at: at("2026-03-04T12:00:00Z") }))?.userId,
    ).toBe(SAM);
    expect(
      (await onCallInSchedule({ at: at("2026-03-05T12:00:00Z") }))?.userId,
    ).toBe(KIM);
  });

  test("once it ends Alex is back in her usual place, mid-turn included", async () => {
    // Away until Friday 12:00: Friday is Alex's turn again, from 09:00.
    await bookTimeAway({ signedInAs: ALEX, ends: BACK_ON_FRIDAY });

    // Friday morning, still away: the next person (Sam) has the turn.
    expect(
      (await onCallInSchedule({ at: at("2026-03-06T10:00:00Z") }))?.userId,
    ).toBe(SAM);

    // Friday afternoon, back: Alex has the rest of her turn.
    await expect(
      onCallInSchedule({ at: at("2026-03-06T13:00:00Z") }),
    ).resolves.toEqual({
      userId: ALEX,
      coveredUserId: null,
      isSkip: false,
      coveredUntil: null,
    });
  });

  test("a skip that has not started yet changes nothing now", async () => {
    await bookTimeAway({
      signedInAs: ALEX,
      starts: at("2026-03-03T15:00:00Z"),
      ends: BACK_ON_FRIDAY,
    });

    expect((await onCallInSchedule())?.userId).toBe(ALEX);
    expect(
      (await onCallInSchedule({ at: at("2026-03-03T16:00:00Z") }))?.userId,
    ).toBe(SAM);
  });

  test("a policy's own skip is for that policy's pages only", async () => {
    await bookTimeAway({
      signedInAs: ALEX,
      ends: BACK_ON_FRIDAY,
      policy: POLICY,
    });

    expect((await onCallInSchedule({ policy: POLICY }))?.userId).toBe(SAM);
    expect((await onCallInSchedule({ policy: OTHER_POLICY }))?.userId).toBe(
      ALEX,
    );
  });

  test("a cover named for the same time wins over the skip", async () => {
    await bookTimeAway({ signedInAs: ALEX, ends: BACK_ON_FRIDAY });
    await bookTimeAway({
      signedInAs: ALEX,
      whoCovers: RIA,
      ends: at("2026-03-03T18:00:00Z"),
    });

    await expect(onCallInSchedule()).resolves.toEqual({
      userId: RIA,
      coveredUserId: ALEX,
      isSkip: false,
      coveredUntil: "2026-03-03T18:00:00.000Z",
    });

    // After the cover, the skip goes on: the rotation picks Sam.
    expect(
      (await onCallInSchedule({ at: at("2026-03-03T20:00:00Z") }))?.userId,
    ).toBe(SAM);
  });

  test("a policy's own skip wins over a global cover, for that policy", async () => {
    await bookTimeAway({
      signedInAs: ALEX,
      whoCovers: RIA,
      ends: BACK_ON_FRIDAY,
    });
    await bookTimeAway({
      signedInAs: ALEX,
      ends: BACK_ON_FRIDAY,
      policy: POLICY,
    });

    expect((await onCallInSchedule({ policy: POLICY }))?.userId).toBe(SAM);
    expect((await onCallInSchedule({ policy: OTHER_POLICY }))?.userId).toBe(
      RIA,
    );
  });

  test("the next person away too: the turn goes on to the one after them", async () => {
    await bookTimeAway({ signedInAs: ALEX, ends: BACK_ON_FRIDAY });
    await bookTimeAway({ signedInAs: SAM, ends: BACK_ON_FRIDAY });

    expect((await onCallInSchedule())?.userId).toBe(KIM);
  });

  test("everybody away: nobody is on call, as in a coverage gap", async () => {
    for (const person of [ALEX, SAM, KIM]) {
      await bookTimeAway({ signedInAs: person, ends: BACK_ON_FRIDAY });
    }

    await expect(onCallInSchedule()).resolves.toBeNull();
  });
});

describe("The stored roster and its hand-off notifications", () => {
  beforeEach(() => {
    db.attachments.push(
      makeAttachment({
        id: "0e300000-0000-4000-8000-000000000201",
        scheduleId: SCHEDULE,
        projectId: PROJECT,
        policyId: POLICY,
        policyName: "Payments",
        ruleId: RULE,
        ruleName: "First responders",
      }),
    );
  });

  test("the roster names who has the turn now, until Alex is back mid-turn", async () => {
    // Away from 11:00 to 18:00 today: Alex's turn runs to 09:00 tomorrow.
    await bookTimeAway({
      signedInAs: ALEX,
      starts: at("2026-03-03T11:00:00Z"),
      ends: at("2026-03-03T18:00:00Z"),
    });

    const roster: {
      currentUserId: ObjectID | null;
      handOffTimeAt: Date | null;
      nextUserId: ObjectID | null;
      nextRosterStartAt: Date | null;
    } =
      await OnCallDutyPolicyScheduleService.getCurrrentUserIdAndHandoffTimeInSchedule(
        oid(SCHEDULE),
        { onCallDutyPolicyId: oid(POLICY) },
      );

    expect(roster.currentUserId?.toString()).toBe(SAM);
    // Sam hands back the moment Alex is back...
    expect(roster.handOffTimeAt?.toISOString()).toBe(
      "2026-03-03T18:00:00.000Z",
    );
    // ...to Alex, for the rest of her turn.
    expect(roster.nextUserId?.toString()).toBe(ALEX);
    expect(roster.nextRosterStartAt?.toISOString()).toBe(
      "2026-03-03T18:00:00.000Z",
    );
  });

  test("the person who takes over is told they are on call, and Alex that she is not", async () => {
    // The roster as it was before the skip: Alex on call, Sam next.
    db.schedules[0]!["currentUserIdOnRoster"] = oid(ALEX);
    db.schedules[0]!["rosterStartAt"] = at("2026-03-03T09:00:00Z");
    db.schedules[0]!["rosterHandoffAt"] = at("2026-03-04T09:00:00Z");
    db.schedules[0]!["nextUserIdOnRoster"] = oid(SAM);
    db.schedules[0]!["rosterNextStartAt"] = at("2026-03-04T09:00:01Z");
    db.schedules[0]!["rosterNextHandoffAt"] = at("2026-03-05T09:00:00Z");

    await bookTimeAway({ signedInAs: ALEX, ends: BACK_ON_FRIDAY });

    jest.spyOn(Semaphore, "lock").mockRejectedValue(new Error("no lock here"));
    const updates: Array<JSONObject> = [];
    jest
      .spyOn(OnCallDutyPolicyScheduleService, "updateOneById")
      .mockImplementation(async (data: { data: unknown }) => {
        updates.push(data.data as JSONObject);
        return undefined as never;
      });
    jest
      .spyOn(OnCallDutyPolicyTimeLogService, "startTimeLogForUser")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(OnCallDutyPolicyTimeLogService, "endTimeLogForUser")
      .mockResolvedValue(undefined as never);

    const told: Array<{ userId: string; eventType: string }> = [];
    jest
      .spyOn(UserNotificationSettingService, "sendUserNotification")
      .mockImplementation(
        async (data: { userId: ObjectID; eventType: unknown }) => {
          told.push({
            userId: data.userId.toString(),
            eventType: String(data.eventType),
          });
        },
      );

    await OnCallDutyPolicyScheduleService.refreshCurrentUserIdAndHandoffTimeInSchedule(
      oid(SCHEDULE),
    );

    // Alex: no longer on call. Sam: on call now - in Alex's place.
    expect(told).toEqual(
      expect.arrayContaining([
        {
          userId: ALEX,
          eventType: "When user is no longer active on on-call roster",
        },
        { userId: SAM, eventType: "When user is on-call roster" },
      ]),
    );

    expect(String(updates[0]!["currentUserIdOnRoster"])).toBe(SAM);
  });
});

describe("An escalation rule that names somebody away does not page them", () => {
  test("getAwayOverride: a skip in force, with nobody to cover, until when", async () => {
    expect(await awayFor(ALEX)).toBeNull();

    await bookTimeAway({ signedInAs: ALEX, ends: BACK_ON_FRIDAY });

    await expect(awayFor(ALEX)).resolves.toEqual({
      coverUserId: null,
      endsAt: BACK_ON_FRIDAY.toISOString(),
    });

    // The cover-only routing a rule used to ask reroutes nobody for a skip.
    expect(
      await OnCallDutyPolicyEscalationRuleService.getRouteAlertToUserId({
        userId: oid(ALEX),
        onCallDutyPolicyId: oid(POLICY),
        projectId: oid(PROJECT),
      }),
    ).toBeNull();
  });

  test("getAwayOverride: a named cover in the same scope wins over a skip", async () => {
    await bookTimeAway({ signedInAs: ALEX, ends: BACK_ON_FRIDAY });
    await bookTimeAway({
      signedInAs: ALEX,
      whoCovers: RIA,
      ends: at("2026-03-03T18:00:00Z"),
    });

    expect((await awayFor(ALEX))?.coverUserId).toBe(RIA);
  });

  test("getAwayOverride: a policy's own skip wins over a global cover", async () => {
    await bookTimeAway({
      signedInAs: ALEX,
      whoCovers: RIA,
      ends: BACK_ON_FRIDAY,
    });
    await bookTimeAway({
      signedInAs: ALEX,
      ends: BACK_ON_FRIDAY,
      policy: POLICY,
    });

    expect((await awayFor(ALEX, POLICY))?.coverUserId).toBeNull();
    expect((await awayFor(ALEX, OTHER_POLICY))?.coverUserId).toBe(RIA);
  });

  describe("startRuleExecution", () => {
    let timeline: Array<OnCallDutyPolicyExecutionLogTimeline>;
    let paged: Array<{ userId: string; overridedByUserId: string | null }>;

    async function runRule(data: {
      users?: Array<string> | undefined;
      teams?: Array<{ id: string; members: Array<string> }> | undefined;
      withSchedule?: boolean | undefined;
    }): Promise<OnCallRuleExecutionOutcome> {
      jest
        .spyOn(OnCallDutyPolicyEscalationRuleUserService, "findBy")
        .mockResolvedValue(
          (data.users || []).map((userId: string) => {
            return { userId: oid(userId) };
          }) as never,
        );
      jest
        .spyOn(OnCallDutyPolicyEscalationRuleTeamService, "findBy")
        .mockResolvedValue(
          (data.teams || []).map((team: { id: string }) => {
            return { teamId: oid(team.id) };
          }) as never,
        );
      jest
        .spyOn(TeamMemberService, "getUsersInTeams")
        .mockImplementation(async (teamIds: Array<ObjectID>) => {
          const team: { id: string; members: Array<string> } | undefined = (
            data.teams || []
          ).find((candidate: { id: string }) => {
            return candidate.id === teamIds[0]?.toString();
          });

          return (team?.members || []).map((userId: string) => {
            const user: { id: ObjectID } = { id: oid(userId) };
            return user as never;
          });
        });

      // The schedule attachment of the rule, if it pages one.
      db.attachments.length = 0;

      if (data.withSchedule) {
        db.attachments.push(
          makeAttachment({
            id: "0e300000-0000-4000-8000-000000000301",
            scheduleId: SCHEDULE,
            projectId: PROJECT,
            policyId: POLICY,
            ruleId: RULE,
          }),
        );
      }

      return await OnCallDutyPolicyEscalationRuleService.startRuleExecution(
        oid(RULE),
        {
          projectId: oid(PROJECT),
          triggeredByIncidentId: oid(INCIDENT),
          userNotificationEventType: UserNotificationEventType.IncidentCreated,
          onCallPolicyExecutionLogId: oid(EXECUTION_LOG),
          onCallPolicyId: oid(POLICY),
        },
      );
    }

    beforeEach(() => {
      timeline = [];
      paged = [];

      jest
        .spyOn(OnCallDutyPolicyEscalationRuleService, "findOneById")
        .mockResolvedValue({
          _id: RULE,
          id: oid(RULE),
          order: 1,
          escalateAfterInMinutes: 10,
        } as unknown as OnCallDutyPolicyEscalationRule);
      jest
        .spyOn(OnCallDutyPolicyExecutionLogService, "updateOneById")
        .mockResolvedValue(undefined as never);
      // Whether a level's pages went out, read back from the timeline.
      jest
        .spyOn(OnCallDutyPolicyExecutionLogTimelineService, "findBy")
        .mockImplementation((async (query: {
          query: { _id?: { value?: Array<ObjectID> } };
        }) => {
          const ids: Array<string> = (query.query._id?.value || []).map(
            (id: ObjectID): string => {
              return id.toString();
            },
          );

          return timeline.filter(
            (row: OnCallDutyPolicyExecutionLogTimeline): boolean => {
              return ids.includes(row.id?.toString() || "");
            },
          );
        }) as never);
      jest
        .spyOn(OnCallDutyPolicyExecutionLogTimelineService, "create")
        .mockImplementation(
          async (data: { data: OnCallDutyPolicyExecutionLogTimeline }) => {
            timeline.push(data.data);
            data.data.id = oid(
              `0e300000-0000-4000-8000-${String(500 + timeline.length).padStart(12, "0")}`,
            );
            return data.data;
          },
        );
      jest
        .spyOn(
          UserNotificationRuleService,
          "startUserNotificationRulesExecution",
        )
        .mockImplementation(
          async (
            userId: ObjectID,
            options: { overridedByUserId?: ObjectID | undefined },
          ) => {
            paged.push({
              userId: userId.toString(),
              overridedByUserId: options.overridedByUserId?.toString() || null,
            });
          },
        );
      jest
        .spyOn(ProjectMembership, "getMemberUserIds")
        .mockImplementation(async () => {
          return new Set<string>([ALEX, SAM, KIM, RIA]);
        });
    });

    function awayLines(): Array<OnCallDutyPolicyExecutionLogTimeline> {
      return timeline.filter((row: OnCallDutyPolicyExecutionLogTimeline) => {
        return readAwayUntil(row.statusMessage) !== null;
      });
    }

    test("named directly: not paged, and the timeline says until when", async () => {
      await bookTimeAway({ signedInAs: ALEX, ends: BACK_ON_FRIDAY });

      await runRule({ users: [ALEX, KIM] });

      expect(paged).toEqual([{ userId: KIM, overridedByUserId: null }]);

      expect(awayLines()).toHaveLength(1);
      expect(awayLines()[0]!.alertSentToUserId?.toString()).toBe(ALEX);
      expect(awayLines()[0]!.status).toBe(
        OnCallDutyExecutionLogTimelineStatus.Skipped,
      );
      expect(awayLines()[0]!.statusMessage).toBe(
        getAwayTimelineMessage(BACK_ON_FRIDAY),
      );
      expect(readAwayUntil(awayLines()[0]!.statusMessage)?.toISOString()).toBe(
        BACK_ON_FRIDAY.toISOString(),
      );
    });

    test("through a team: not paged either, and the line names the team", async () => {
      const TEAM: string = "0e300000-0000-4000-8000-000000000401";

      await bookTimeAway({ signedInAs: ALEX, ends: BACK_ON_FRIDAY });

      await runRule({ teams: [{ id: TEAM, members: [ALEX, SAM] }] });

      expect(
        paged.map((page: { userId: string }) => {
          return page.userId;
        }),
      ).toEqual([SAM]);
      expect(awayLines()[0]!.userBelongsToTeamId?.toString()).toBe(TEAM);
    });

    test("a named cover is paged in their place, as before", async () => {
      await bookTimeAway({
        signedInAs: ALEX,
        whoCovers: RIA,
        ends: BACK_ON_FRIDAY,
      });

      await runRule({ users: [ALEX] });

      expect(paged).toEqual([{ userId: RIA, overridedByUserId: ALEX }]);
      expect(awayLines()).toHaveLength(0);
    });

    test("through the schedule: the next person in the rotation is paged, covering Alex", async () => {
      await bookTimeAway({ signedInAs: ALEX, ends: BACK_ON_FRIDAY });

      await runRule({ withSchedule: true });

      expect(paged).toEqual([{ userId: SAM, overridedByUserId: ALEX }]);
      expect(awayLines()).toHaveLength(0);
    });

    test("only Alex named, and away: the rule reaches nobody, says so, and the run moves on from it at once", async () => {
      await bookTimeAway({ signedInAs: ALEX, ends: BACK_ON_FRIDAY });

      const outcome: OnCallRuleExecutionOutcome = await runRule({
        users: [ALEX],
      });

      expect(paged).toEqual([]);
      expect(
        timeline.map((row: OnCallDutyPolicyExecutionLogTimeline) => {
          return row.statusMessage;
        }),
      ).toEqual([
        getAwayTimelineMessage(BACK_ON_FRIDAY),
        ON_CALL_LEVEL_PAGED_NOBODY_TIMELINE_MESSAGE,
      ]);
      // Nobody to wait for: the next level is paged now, not 10 minutes on.
      expect(outcome.movesOnAtOnce).toBe(true);
    });

    test("Alex away and Kim paged: the level holds the run for its wait, as before", async () => {
      await bookTimeAway({ signedInAs: ALEX, ends: BACK_ON_FRIDAY });

      const outcome: OnCallRuleExecutionOutcome = await runRule({
        users: [ALEX, KIM],
      });

      expect(paged).toEqual([{ userId: KIM, overridedByUserId: null }]);
      expect(outcome.movesOnAtOnce).toBe(false);
    });

    test("everybody in the schedule away: the schedule has nobody on call", async () => {
      for (const person of [ALEX, SAM, KIM]) {
        await bookTimeAway({ signedInAs: person, ends: BACK_ON_FRIDAY });
      }

      await runRule({ withSchedule: true });

      expect(paged).toEqual([]);
      expect(timeline[0]!.statusMessage).toBe(
        "Skipped because no active users are found in this schedule.",
      );
    });

    test("before the time away starts, and after it ends, they are paged", async () => {
      await bookTimeAway({
        signedInAs: ALEX,
        starts: at("2026-03-04T00:00:00Z"),
        ends: BACK_ON_FRIDAY,
      });

      await runRule({ users: [ALEX] });
      expect(paged).toEqual([{ userId: ALEX, overridedByUserId: null }]);

      paged.length = 0;
      setNow(at("2026-03-06T13:00:00Z"));
      await runRule({ users: [ALEX] });
      expect(paged).toEqual([{ userId: ALEX, overridedByUserId: null }]);
    });
  });
});

describe("Calendar feeds, my shifts, reminders and the timeline say who has the turn, and why", () => {
  const WINDOW_START: Date = at("2026-03-03T00:00:00Z");
  const WINDOW_END: Date = at("2026-03-08T00:00:00Z");

  test("the resolver hands Alex's turns to Sam, marked as a skip", async () => {
    await bookTimeAway({ signedInAs: ALEX, ends: BACK_ON_FRIDAY });

    const resolved: ResolvedShiftSegments | null =
      await OnCallDutyPolicyScheduleService.getResolvedShiftSegments({
        scheduleId: oid(SCHEDULE),
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
      });

    const skipped: Array<CalendarEvent> = (resolved?.segments || []).filter(
      (segment: CalendarEvent) => {
        return UserOverrideUtil.isSkipMeta(
          UserOverrideUtil.getOverrideMeta(segment),
        );
      },
    );

    expect(skipped.length).toBeGreaterThan(0);

    for (const segment of skipped) {
      const meta: OverrideEventMeta | null =
        UserOverrideUtil.getOverrideMeta(segment);

      expect(segment.title).toBe(SAM);
      expect(meta?.originalUserId).toBe(ALEX);
    }

    // Nobody away is on call anywhere in the window.
    for (const segment of resolved?.segments || []) {
      if (segment.title !== ALEX) {
        continue;
      }

      expect(
        segment.start.getTime() >= BACK_ON_FRIDAY.getTime() ||
          segment.end.getTime() <= NOW.getTime(),
      ).toBe(true);
    }
  });

  test("materialized shifts carry the skip, and the feed says the rotation picked who", async () => {
    await bookTimeAway({ signedInAs: ALEX, ends: BACK_ON_FRIDAY });

    const result: MaterializeResult =
      await OnCallShiftMaterializer.materializeForSchedule({
        scheduleId: oid(SCHEDULE),
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        now: NOW,
      });

    const skippedShifts: Array<MaterializedShift> = result.shifts.filter(
      (shift: MaterializedShift) => {
        return Boolean(shift.override?.isSkip);
      },
    );

    expect(skippedShifts.length).toBeGreaterThan(0);
    expect(skippedShifts[0]!.userName).toBe("Sam Lee");
    expect(skippedShifts[0]!.override?.originalUserName).toBe("Alex Kim");

    const description: string = OnCallCalendarFeedUtil.buildDescription(
      skippedShifts[0]!,
      {
        kind: OnCallCalendarFeedKind.Schedule,
        dashboardUrl: "https://oneuptime.example/dashboard",
        variantIndex: null,
      },
    );

    expect(description).toContain("Skipped: Alex Kim is away from");
    expect(description).toContain(
      "so the next person in the rotation has this turn (global override)",
    );
    expect(
      OnCallCalendarFeedUtil.buildSummary(
        skippedShifts[0]!,
        OnCallCalendarFeedKind.Schedule,
      ),
    ).toContain("(covering for Alex Kim)");

    // A named cover's shift keeps its Override line, and no skip flag.
    db.overrides.length = 0;
    db.overrides.push(
      makeOverride({
        id: "0e300000-0000-4000-8000-000000000601",
        projectId: PROJECT,
        overrideUserId: ALEX,
        routeAlertsToUserId: RIA,
        startsAt: NOW,
        endsAt: BACK_ON_FRIDAY,
      }),
    );

    const covered: MaterializeResult =
      await OnCallShiftMaterializer.materializeForSchedule({
        scheduleId: oid(SCHEDULE),
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        now: NOW,
      });

    const coveredShift: MaterializedShift | undefined = covered.shifts.find(
      (shift: MaterializedShift) => {
        return Boolean(shift.override);
      },
    );

    expect(coveredShift?.override?.isSkip).toBeUndefined();
  });

  test("the schedule timeline's wire shape carries the skip, and reads it back", async () => {
    await bookTimeAway({ signedInAs: ALEX, ends: BACK_ON_FRIDAY });

    const result: MaterializeResult =
      await OnCallShiftMaterializer.materializeForSchedule({
        scheduleId: oid(SCHEDULE),
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        now: NOW,
      });

    const skippedShift: MaterializedShift = result.shifts.find(
      (shift: MaterializedShift) => {
        return Boolean(shift.override?.isSkip);
      },
    )!;

    const json: JSONObject = ScheduleTimelineUtil.toTimelineShift(
      skippedShift,
      { from: WINDOW_START, to: WINDOW_END },
    ) as unknown as JSONObject;

    expect((json["override"] as JSONObject)["isSkip"]).toBe(true);

    // The dashboard reads it back.
    const parsed: JSONObject = ScheduleTimelineUtil.parseResponse({
      from: WINDOW_START.toISOString(),
      to: WINDOW_END.toISOString(),
      generatedAt: NOW.toISOString(),
      schedules: [
        {
          scheduleId: SCHEDULE,
          scheduleName: "Payments primary",
          scheduleTimezone: "UTC",
          shifts: [json],
        },
      ],
    }) as unknown as JSONObject;

    expect(
      (
        (
          (parsed["schedules"] as Array<JSONObject>)[0]![
            "shifts"
          ] as Array<JSONObject>
        )[0]!["override"] as JSONObject
      )["isSkip"],
    ).toBe(true);
  });
});
