import { describe, expect, test } from "@jest/globals";
import {
  getLayerPreviewEvents,
  LayerPreviewResult,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerShiftPreview";
import OnCallDutyPolicyScheduleLayer from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import User from "../../../Models/DatabaseModels/User";
import CalendarEvent from "../../../Types/Calendar/CalendarEvent";
import OneUptimeDate from "../../../Types/Date";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import ObjectID from "../../../Types/ObjectID";
import RestrictionTimes, {
  RestrictionType,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import ScheduleShiftUtil, {
  OnCallShift,
} from "../../../Types/OnCallDutyPolicy/ScheduleShiftUtil";
import { UserOverrideRecord } from "../../../Types/OnCallDutyPolicy/UserOverrideUtil";

/*
 * https://github.com/OneUptime/oneuptime/issues/3411
 *
 * getLayerPreviewEvents is the single source behind the per-layer card's live
 * "<name> on call now" line and the "Who is on call, and when" table under it.
 * It used to return LayerUtil's raw rotation, so during a shift override both
 * kept naming the originally-scheduled user - on the same page whose calendar,
 * and whose alert routing, named the substitute.
 *
 * These tests work at the events level rather than through the React tree: the
 * card derives everything it prints from these events via
 * ScheduleShiftUtil.groupEventsIntoShifts / getCurrentAndNextShift, so pinning
 * the events pins the claim, without a DOM in the way.
 */

const USER_A: string = "aaaaaaaa-1111-4111-8111-111111111111";
const USER_B: string = "bbbbbbbb-2222-4222-8222-222222222222";
const POLICY_ID: string = "44444444-4444-4444-8444-444444444444";
const OTHER_POLICY_ID: string = "55555555-5555-4555-8555-555555555555";

function makeUser(id: string): User {
  const user: User = new User();
  user.id = new ObjectID(id);
  user.name = `User ${id.slice(0, 4)}` as any;
  user.email = `${id}@example.com` as any;
  return user;
}

function makeLayerUser(userId: string): OnCallDutyPolicyScheduleLayerUser {
  const layerUser: OnCallDutyPolicyScheduleLayerUser =
    new OnCallDutyPolicyScheduleLayerUser();
  layerUser.userId = new ObjectID(userId);
  layerUser.user = makeUser(userId);
  layerUser.order = 1;
  return layerUser;
}

/*
 * A 24/7 layer that started a month ago and rotates daily. With a single
 * assigned user it puts exactly one person on call at every instant, so "who
 * does the preview say is on call now" has one correct answer whenever the
 * suite runs.
 */
function makeLayer(): OnCallDutyPolicyScheduleLayer {
  const layer: OnCallDutyPolicyScheduleLayer =
    new OnCallDutyPolicyScheduleLayer();
  const now: Date = OneUptimeDate.getCurrentDate();

  layer.id = new ObjectID("33333333-3333-4333-8333-333333333333");
  layer.startsAt = OneUptimeDate.addRemoveDays(now, -30);
  layer.handOffTime = OneUptimeDate.addRemoveDays(now, -30);
  layer.rotation = Recurring.fromJSON({
    _type: "Recurring",
    value: {
      intervalType: EventInterval.Day,
      intervalCount: { _type: "PositiveNumber", value: 1 },
    },
  } as any) as any;

  const restrictionTimes: RestrictionTimes = new RestrictionTimes();
  restrictionTimes.restictionType = RestrictionType.None;
  restrictionTimes.dayRestrictionTimes = null;
  layer.restrictionTimes = restrictionTimes as any;

  return layer;
}

function override(
  onCallDutyPolicyId: string | null,
  hoursBefore: number = 1,
  hoursAfter: number = 1,
): UserOverrideRecord {
  const now: Date = OneUptimeDate.getCurrentDate();
  return {
    overrideUserId: USER_A,
    routeAlertsToUserId: USER_B,
    startsAt: OneUptimeDate.addRemoveHours(now, -hoursBefore),
    endsAt: OneUptimeDate.addRemoveHours(now, hoursAfter),
    onCallDutyPolicyId,
  };
}

function preview(params: {
  overrides?: Array<UserOverrideRecord> | undefined;
  currentOnCallDutyPolicyId?: string | undefined;
}): LayerPreviewResult {
  return getLayerPreviewEvents({
    layer: makeLayer(),
    users: [makeLayerUser(USER_A)],
    timezone: "UTC",
    numberOfShifts: 6,
    overrides: params.overrides,
    currentOnCallDutyPolicyId: params.currentOnCallDutyPolicyId,
  });
}

// Exactly how the card resolves the name it prints next to the live dot.
function onCallNowUserId(result: LayerPreviewResult): string | null {
  const shifts: Array<OnCallShift> = ScheduleShiftUtil.groupEventsIntoShifts(
    result.events,
  );
  return (
    ScheduleShiftUtil.getCurrentAndNextShift(shifts, result.now).current
      ?.userId || null
  );
}

describe("Per-layer preview honours shift overrides (issue #3411)", () => {
  test("without overrides the rotation user is on call - the baseline the bug hid behind", () => {
    expect(onCallNowUserId(preview({}))).toBe(USER_A);
  });

  test("a GLOBAL override puts the substitute on call now", () => {
    expect(onCallNowUserId(preview({ overrides: [override(null)] }))).toBe(
      USER_B,
    );
  });

  test("a POLICY-SCOPED override applies when the layer is previewed in that policy's context", () => {
    expect(
      onCallNowUserId(
        preview({
          overrides: [override(POLICY_ID)],
          currentOnCallDutyPolicyId: POLICY_ID,
        }),
      ),
    ).toBe(USER_B);
  });

  test("a POLICY-SCOPED override does NOT apply without a policy context", () => {
    expect(onCallNowUserId(preview({ overrides: [override(POLICY_ID)] }))).toBe(
      USER_A,
    );
  });

  test("an override scoped to a DIFFERENT policy never applies", () => {
    expect(
      onCallNowUserId(
        preview({
          overrides: [override(OTHER_POLICY_ID)],
          currentOnCallDutyPolicyId: POLICY_ID,
        }),
      ),
    ).toBe(USER_A);
  });

  test("the rotation resumes for the original user once the override window ends", () => {
    const result: LayerPreviewResult = preview({
      overrides: [override(null)],
    });

    /*
     * Read at shift level, the way the card does. An override splits one turn
     * into three segments, so an event-level probe would depend on which side of
     * a rotation boundary "now" happens to land on.
     */
    const shifts: Array<OnCallShift> = ScheduleShiftUtil.groupEventsIntoShifts(
      result.events,
    );

    expect(
      ScheduleShiftUtil.getCurrentAndNextShift(shifts, result.now).current
        ?.userId,
    ).toBe(USER_B);

    // Two hours out is past the override's end; the layer's own user is back.
    const afterWindow: Date = OneUptimeDate.addRemoveHours(result.now, 2);

    expect(
      ScheduleShiftUtil.getCurrentAndNextShift(shifts, afterWindow).current
        ?.userId,
    ).toBe(USER_A);
  });

  test("the substituted window is bounded by the override, not by the whole turn", () => {
    const result: LayerPreviewResult = preview({
      overrides: [override(null, 1, 1)],
    });

    const covering: CalendarEvent | undefined = result.events.find(
      (event: CalendarEvent) => {
        return event.title === USER_B;
      },
    );

    expect(covering).toBeDefined();

    /*
     * The substitution must not swallow the rest of the turn. Two hours of
     * override cannot produce a segment longer than two hours - a check that
     * would fail if a future change substituted whole events instead of
     * splitting them.
     */
    const seconds: number = OneUptimeDate.getDifferenceInSeconds(
      covering!.end,
      covering!.start,
    );
    expect(seconds).toBeLessThanOrEqual(2 * 60 * 60 + 5);
    expect(seconds).toBeGreaterThan(0);
  });

  test("an empty override list leaves the events untouched", () => {
    const withEmpty: LayerPreviewResult = preview({ overrides: [] });
    const without: LayerPreviewResult = preview({});

    expect(
      withEmpty.events.map((e: CalendarEvent) => {
        return e.title;
      }),
    ).toEqual(
      without.events.map((e: CalendarEvent) => {
        return e.title;
      }),
    );
  });
});
