import OnCallDutyPolicyEscalationRuleScheduleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyFeedService from "../../../Server/Services/OnCallDutyPolicyFeedService";
import OnCallDutyPolicyTimeLogService from "../../../Server/Services/OnCallDutyPolicyTimeLogService";
import logger from "../../../Server/Utils/Logger";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * https://github.com/OneUptime/oneuptime/issues/3411
 *
 * The persisted roster columns on OnCallDutyPolicySchedule (currentUserIdOnRoster
 * and friends) are derived state, and one of their inputs is WHICH on-call
 * policies escalate to the schedule: getSingleAttachedPolicyId resolves the
 * roster in a policy's context only when exactly one policy is attached, which
 * is what makes that policy's POLICY-SCOPED user overrides count.
 *
 * Attaching or detaching a schedule therefore changes the correct answer. Every
 * other input - layers, layer users, overrides - already refreshes the roster on
 * change; this one did not, so after attaching a schedule to its first policy
 * the roster kept the pre-attach, policy-blind answer until the next natural
 * hand-off. The schedule page's "X is currently on the roster" banner and the
 * "On Call Now" column then named the originally-scheduled user for the whole
 * override window while alert routing - which always resolves live, with the
 * policy id - paged the substitute.
 *
 * The hooks are protected, so they are invoked through `as any`, the same way
 * OnCallDutyPolicyUserOverrideEdit.test.ts does.
 */

const PROJECT_ID: ObjectID = new ObjectID("project-1");
const SCHEDULE_ID: ObjectID = new ObjectID("schedule-1");
const OTHER_SCHEDULE_ID: ObjectID = new ObjectID("schedule-2");
const POLICY_ID: ObjectID = new ObjectID("policy-1");
const RULE_ID: ObjectID = new ObjectID("rule-1");
const LINK_ID: ObjectID = new ObjectID("link-1");

function silenceLoggerError(): void {
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
}

/*
 * Everything the hooks touch besides the roster refresh: feed items, time logs
 * and the live roster lookup. Stubbed so each test asserts one thing - which
 * schedules got their roster re-resolved.
 */
function stubCollaborators(options?: {
  currentUserInSchedule?: ObjectID | null;
}): void {
  jest
    .spyOn(OnCallDutyPolicyScheduleService, "getCurrentUserIdInSchedule")
    .mockResolvedValue(
      options?.currentUserInSchedule === undefined
        ? null
        : options.currentUserInSchedule,
    );

  jest
    .spyOn(OnCallDutyPolicyFeedService, "createOnCallDutyPolicyFeedItem")
    .mockResolvedValue(undefined as never);

  jest
    .spyOn(OnCallDutyPolicyTimeLogService, "startTimeLogForUser")
    .mockResolvedValue(undefined as never);

  jest
    .spyOn(OnCallDutyPolicyTimeLogService, "endTimeLogForUser")
    .mockResolvedValue(undefined as never);
}

/*
 * Typed loosely on purpose: jest.SpiedFunction is invariant in its call
 * signature, so the precise spy type does not widen to SpiedFunction<any> and
 * every call site would need the exact generic restated.
 */
function spyOnRosterRefresh(): any {
  return jest
    .spyOn(
      OnCallDutyPolicyScheduleService,
      "refreshCurrentUserIdAndHandoffTimeInSchedule",
    )
    .mockResolvedValue({
      currentUserId: null,
      handOffTimeAt: null,
      nextUserId: null,
      nextHandOffTimeAt: null,
      rosterStartAt: null,
      nextRosterStartAt: null,
    });
}

function refreshedScheduleIds(spy: any): Array<string> {
  return spy.mock.calls.map((call: Array<unknown>): string => {
    return (call[0] as ObjectID).toString();
  });
}

function linkRow(scheduleId: ObjectID): any {
  return {
    id: LINK_ID,
    projectId: PROJECT_ID,
    onCallDutyPolicyScheduleId: scheduleId,
    onCallDutyPolicySchedule: { name: "Primary schedule" },
    onCallDutyPolicyEscalationRule: { name: "Rule 1", id: RULE_ID, order: 1 },
    onCallDutyPolicy: { name: "Payments", id: POLICY_ID },
    createdByUserId: null,
  };
}

describe("Attaching / detaching a schedule re-resolves its persisted roster (issue #3411)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("onCreateSuccess refreshes the attached schedule's roster", async () => {
    silenceLoggerError();
    stubCollaborators();

    jest
      .spyOn(OnCallDutyPolicyEscalationRuleScheduleService, "findOneById")
      .mockResolvedValue(linkRow(SCHEDULE_ID));

    const refresh: any = spyOnRosterRefresh();

    await (
      OnCallDutyPolicyEscalationRuleScheduleService as any
    ).onCreateSuccess({}, { id: LINK_ID });

    expect(refreshedScheduleIds(refresh)).toEqual([SCHEDULE_ID.toString()]);
  });

  /*
   * The refresh has to happen even when the schedule currently pages nobody:
   * that is precisely the state where the roster is most misleading, and the
   * notification/time-log code below the refresh returns early there. Placing
   * the refresh after those early returns would have made this case a silent
   * no-op.
   */
  test("onCreateSuccess refreshes even when nobody is on call in the schedule", async () => {
    silenceLoggerError();
    stubCollaborators({ currentUserInSchedule: null });

    jest
      .spyOn(OnCallDutyPolicyEscalationRuleScheduleService, "findOneById")
      .mockResolvedValue(linkRow(SCHEDULE_ID));

    const refresh: any = spyOnRosterRefresh();

    await (
      OnCallDutyPolicyEscalationRuleScheduleService as any
    ).onCreateSuccess({}, { id: LINK_ID });

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("a failing roster refresh does not fail the attach", async () => {
    silenceLoggerError();
    stubCollaborators();

    jest
      .spyOn(OnCallDutyPolicyEscalationRuleScheduleService, "findOneById")
      .mockResolvedValue(linkRow(SCHEDULE_ID));

    jest
      .spyOn(
        OnCallDutyPolicyScheduleService,
        "refreshCurrentUserIdAndHandoffTimeInSchedule",
      )
      .mockRejectedValue(new Error("redis down"));

    await expect(
      (OnCallDutyPolicyEscalationRuleScheduleService as any).onCreateSuccess(
        {},
        { id: LINK_ID },
      ),
    ).resolves.toBeDefined();
  });

  test("onDeleteSuccess refreshes the detached schedule's roster", async () => {
    silenceLoggerError();
    stubCollaborators();

    const refresh: any = spyOnRosterRefresh();

    await (
      OnCallDutyPolicyEscalationRuleScheduleService as any
    ).onDeleteSuccess(
      { carryForward: { deletedItems: [linkRow(SCHEDULE_ID)] } },
      [LINK_ID],
    );

    expect(refreshedScheduleIds(refresh)).toEqual([SCHEDULE_ID.toString()]);
  });

  /*
   * Removing one schedule from several escalation rules of the same policy is
   * ONE context change. Refreshing per row would re-diff the same roster
   * repeatedly, and each diff can emit a hand-off page - so a tidy-up that
   * removes three rules must not ring the same phone three times.
   */
  test("onDeleteSuccess refreshes each affected schedule exactly once", async () => {
    silenceLoggerError();
    stubCollaborators();

    const refresh: any = spyOnRosterRefresh();

    await (
      OnCallDutyPolicyEscalationRuleScheduleService as any
    ).onDeleteSuccess(
      {
        carryForward: {
          deletedItems: [
            linkRow(SCHEDULE_ID),
            linkRow(SCHEDULE_ID),
            linkRow(OTHER_SCHEDULE_ID),
          ],
        },
      },
      [LINK_ID],
    );

    expect(refreshedScheduleIds(refresh).sort()).toEqual(
      [OTHER_SCHEDULE_ID.toString(), SCHEDULE_ID.toString()].sort(),
    );
  });

  test("onDeleteSuccess refreshes before the per-item early return for an uncovered schedule", async () => {
    silenceLoggerError();
    stubCollaborators({ currentUserInSchedule: null });

    const refresh: any = spyOnRosterRefresh();

    await (
      OnCallDutyPolicyEscalationRuleScheduleService as any
    ).onDeleteSuccess(
      { carryForward: { deletedItems: [linkRow(SCHEDULE_ID)] } },
      [LINK_ID],
    );

    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
