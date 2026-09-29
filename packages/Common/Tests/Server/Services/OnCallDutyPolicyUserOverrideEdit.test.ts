import OnCallDutyPolicyUserOverrideService from "../../../Server/Services/OnCallDutyPolicyUserOverrideService";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import ObjectID from "../../../Types/ObjectID";
import logger from "../../../Server/Utils/Logger";
import { describe, expect, test, afterEach } from "@jest/globals";

/*
 * Audit finding M2: an override edit that changes overrideUserId from A to A2
 * used to refresh only A2's schedules. Schedules that contained A (but NOT A2)
 * therefore kept showing the substitute forever — until the next natural
 * handoff — because refreshRostersForUserInProject selects schedules by the
 * NEW user only.
 *
 * The fix captures each affected override's PRE-update {projectId,
 * overrideUserId} in onBeforeUpdate (carryForward), and onUpdateSuccess then
 * refreshes rosters for BOTH the OLD users (from carryForward) and the NEW
 * users (looked up post-update by id), deduped by "projectId:overrideUserId".
 *
 * The private refreshRostersForOverrideUser lazy-requires
 * OnCallDutyPolicyScheduleService and calls its
 * refreshRostersForUserInProject({projectId, userId}). Because the test imports
 * the very same singleton the lazy require resolves to, spying that public
 * method observes exactly which {projectId, userId} pairs are refreshed.
 *
 * The hooks are protected, so they are invoked via (service as any).
 */

// Fixed ids so assertions read clearly. ObjectID accepts arbitrary strings.
const P1: ObjectID = new ObjectID("p1");
const USER_A: ObjectID = new ObjectID("A");
const USER_A2: ObjectID = new ObjectID("A2");
const OV1: ObjectID = new ObjectID("ov1");

// Build a minimal root UpdateBy the hooks accept.
function fakeUpdateBy(): any {
  return {
    query: { _id: OV1 },
    data: {},
    props: { isRoot: true },
  };
}

// The set of userId strings refreshRostersForUserInProject was called with.
function refreshedUserIds(spy: jest.SpyInstance): Array<string> {
  return spy.mock.calls.map((call: Array<unknown>): string => {
    const arg: { projectId: ObjectID; userId: ObjectID } = call[0] as {
      projectId: ObjectID;
      userId: ObjectID;
    };
    return arg.userId.toString();
  });
}

describe("OnCallDutyPolicyUserOverrideService update-roster refresh (audit M2)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Keep best-effort logger.error noise out of the test output.
  function silenceLoggerError(): void {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
  }

  /*
   * ----------------------------------------------------------------------- *
   * (1) onBeforeUpdate captures the OLD override user into carryForward.
   * ----------------------------------------------------------------------- *
   */
  test("onBeforeUpdate captures the pre-update {projectId, overrideUserId} into carryForward", async () => {
    silenceLoggerError();

    // findBy returns the row(s) that match the update query, PRE-update.
    const findBy: jest.SpyInstance = jest
      .spyOn(OnCallDutyPolicyUserOverrideService, "findBy")
      .mockResolvedValue([{ projectId: P1, overrideUserId: USER_A }] as any);

    const onUpdate: any = await (
      OnCallDutyPolicyUserOverrideService as any
    ).onBeforeUpdate(fakeUpdateBy());

    expect(findBy).toHaveBeenCalledTimes(1);

    const carryForward: Array<{
      projectId: ObjectID;
      overrideUserId: ObjectID;
    }> = onUpdate.carryForward;

    expect(Array.isArray(carryForward)).toBe(true);
    expect(carryForward).toHaveLength(1);
    expect(carryForward[0]!.projectId.toString()).toBe(P1.toString());
    expect(carryForward[0]!.overrideUserId.toString()).toBe(USER_A.toString());

    // The original updateBy is threaded through unchanged.
    expect(onUpdate.updateBy.query["_id"].toString()).toBe(OV1.toString());
  });

  /*
   * ----------------------------------------------------------------------- *
   * (2) onUpdateSuccess refreshes BOTH the old (A) and the new (A2) users.
   * ----------------------------------------------------------------------- *
   */
  test("onUpdateSuccess refreshes rosters for BOTH the old (A) and new (A2) override users", async () => {
    silenceLoggerError();

    // The post-update row for OV1 now points at the NEW user A2.
    jest
      .spyOn(OnCallDutyPolicyUserOverrideService, "findOneById")
      .mockResolvedValue({ projectId: P1, overrideUserId: USER_A2 } as any);

    const refresh: jest.SpyInstance = jest
      .spyOn(OnCallDutyPolicyScheduleService, "refreshRostersForUserInProject")
      .mockResolvedValue(undefined);

    const onUpdate: any = {
      updateBy: fakeUpdateBy(),
      // OLD user captured by onBeforeUpdate.
      carryForward: [{ projectId: P1, overrideUserId: USER_A }],
    };

    await (OnCallDutyPolicyUserOverrideService as any).onUpdateSuccess(
      onUpdate,
      [OV1],
    );

    const userIds: Array<string> = refreshedUserIds(refresh);

    // Both the vacated user A and the substitute A2 have their rosters recomputed.
    expect(userIds).toContain(USER_A.toString());
    expect(userIds).toContain(USER_A2.toString());
    expect(refresh).toHaveBeenCalledTimes(2);

    // Every refresh is scoped to the correct project.
    for (const call of refresh.mock.calls) {
      const arg: { projectId: ObjectID; userId: ObjectID } = call[0] as {
        projectId: ObjectID;
        userId: ObjectID;
      };
      expect(arg.projectId.toString()).toBe(P1.toString());
    }
  });

  /*
   * ----------------------------------------------------------------------- *
   * (3) DEDUP: an unchanged override user (A -> A) is refreshed exactly once.
   * ----------------------------------------------------------------------- *
   */
  test("onUpdateSuccess dedupes: when old == new (A -> A) the roster refresh runs exactly ONCE", async () => {
    silenceLoggerError();

    // Post-update row still points at A (only e.g. the times changed).
    jest
      .spyOn(OnCallDutyPolicyUserOverrideService, "findOneById")
      .mockResolvedValue({ projectId: P1, overrideUserId: USER_A } as any);

    const refresh: jest.SpyInstance = jest
      .spyOn(OnCallDutyPolicyScheduleService, "refreshRostersForUserInProject")
      .mockResolvedValue(undefined);

    const onUpdate: any = {
      updateBy: fakeUpdateBy(),
      carryForward: [{ projectId: P1, overrideUserId: USER_A }],
    };

    await (OnCallDutyPolicyUserOverrideService as any).onUpdateSuccess(
      onUpdate,
      [OV1],
    );

    // Same {p1, A} from both the old and new side: refreshed a single time.
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refreshedUserIds(refresh)).toEqual([USER_A.toString()]);
  });

  /*
   * ----------------------------------------------------------------------- *
   * (4) onBeforeUpdate is best-effort: a findBy failure yields empty
   *     carryForward and does NOT reject the update path.
   * ----------------------------------------------------------------------- *
   */
  test("onBeforeUpdate is resilient: if findBy throws, it returns an empty carryForward and does not reject", async () => {
    silenceLoggerError();

    jest
      .spyOn(OnCallDutyPolicyUserOverrideService, "findBy")
      .mockRejectedValue(new Error("db unavailable"));

    const onUpdate: any = await (
      OnCallDutyPolicyUserOverrideService as any
    ).onBeforeUpdate(fakeUpdateBy());

    expect(Array.isArray(onUpdate.carryForward)).toBe(true);
    expect(onUpdate.carryForward).toHaveLength(0);
    // The updateBy is still threaded through so the CRUD update proceeds.
    expect(onUpdate.updateBy).toBeTruthy();
  });
});
