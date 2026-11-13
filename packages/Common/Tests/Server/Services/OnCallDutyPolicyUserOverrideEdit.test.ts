import { OnCallDutyPolicyFeedEventType } from "../../../Models/DatabaseModels/OnCallDutyPolicyFeed";
import OnCallDutyPolicyFeedService from "../../../Server/Services/OnCallDutyPolicyFeedService";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import OnCallDutyPolicyUserOverrideService from "../../../Server/Services/OnCallDutyPolicyUserOverrideService";
import UserService from "../../../Server/Services/UserService";
import ColumnWriteRefusedException from "../../../Server/Types/Database/Permissions/ColumnWriteRefusedException";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import {
  USER_OVERRIDE_ENDED_REFUSAL,
  USER_OVERRIDE_END_IN_PAST_REFUSAL,
  USER_OVERRIDE_STARTED_REFUSAL,
  USER_OVERRIDE_START_IN_PAST_REFUSAL,
} from "../../../Types/OnCallDutyPolicy/UserOverrideEdit";
import Permission from "../../../Types/Permission";
import FeedMarkdown, {
  MarkdownText,
} from "../../../Utils/Markdown/FeedMarkdown";
import { customDomainCaller } from "../API/CustomDomainCallers";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { LimitTransactions } from "../TestingUtils/LimitTransactionsInMemory";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { useUserOverrideTimesInMemory } from "../TestingUtils/UserOverrideTimesInMemory";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A USER OVERRIDE CAN BE EDITED (issue #7631): who covers, until it ends;
 * when it starts, until it starts; when it ends, until it ends - and a
 * moved time never to the past. One that has ended stays as it was; who
 * is away and its policy never change. Each edit of a policy's override
 * says once, in the policy's feed and the chat channels it posts to, what
 * changed (UserOverrideEdit, OnCallDutyPolicyUserOverrideService).
 *
 * These run the whole update through the real service - its permission
 * checks, its hooks, the lock an edit of its times is written under - as a
 * member of the project, with the override table in memory.
 *
 * And the schedules: an edit refreshes the schedules of the people the
 * override named BEFORE it as well as after (audit M2), so a schedule that
 * showed the old cover stops showing them at once.
 */

jest.mock("../../../Server/Utils/Logger");

const PROJECT: string = "7631aaaa-0000-4000-8000-000000000001";
const POLICY: string = "7631aaaa-0000-4000-8000-0000000000b1";

// Jane and Kim are away; Bob and Carol cover.
const JANE: string = "7631aaaa-0000-4000-8000-0000000000c1";
const BOB: string = "7631aaaa-0000-4000-8000-0000000000c2";
const CAROL: string = "7631aaaa-0000-4000-8000-0000000000c3";
const KIM: string = "7631aaaa-0000-4000-8000-0000000000c4";

const NAMES: Record<string, string> = {
  [JANE]: "Jane Doe",
  [BOB]: "Bob Lee",
  [CAROL]: "Carol Ng",
  [KIM]: "Kim Ito",
};

// Half a minute into 12:00: the pickers hold minutes, so 12:00 is still now.
const NOW: Date = new Date("2026-11-13T12:00:30.000Z");
const THIS_MINUTE: Date = new Date("2026-11-13T12:00:00.000Z");
const LAST_MINUTE: Date = new Date("2026-11-13T11:59:00.000Z");

// Tomorrow, Jane covered by Bob on the policy.
const UPCOMING: string = "7631aaaa-0000-4000-8000-0000000000d1";
const UPCOMING_STARTS: Date = new Date("2026-11-14T09:00:00.000Z");
const UPCOMING_ENDS: Date = new Date("2026-11-14T17:00:00.000Z");

// Under way since this morning - saved to the second, from the API - Kim covered by Bob.
const RUNNING: string = "7631aaaa-0000-4000-8000-0000000000d2";
const RUNNING_STARTS: Date = new Date("2026-11-13T08:00:45.000Z");
const RUNNING_ENDS: Date = new Date("2026-11-13T20:00:00.000Z");

// Yesterday, Jane covered by Carol: over.
const ENDED: string = "7631aaaa-0000-4000-8000-0000000000d3";

// Next week, Jane away on every policy, the rotation covering.
const GLOBAL: string = "7631aaaa-0000-4000-8000-0000000000d4";

const rowsAtStart: () => Array<StoredRow> = (): Array<StoredRow> => {
  return [
    {
      _id: UPCOMING,
      projectId: PROJECT,
      onCallDutyPolicyId: POLICY,
      overrideUserId: JANE,
      routeAlertsToUserId: BOB,
      startsAt: UPCOMING_STARTS,
      endsAt: UPCOMING_ENDS,
      createdAt: new Date("2026-11-01T10:00:00.000Z"),
      version: 1,
    },
    {
      _id: RUNNING,
      projectId: PROJECT,
      onCallDutyPolicyId: POLICY,
      overrideUserId: KIM,
      routeAlertsToUserId: BOB,
      startsAt: RUNNING_STARTS,
      endsAt: RUNNING_ENDS,
      createdAt: new Date("2026-11-02T10:00:00.000Z"),
      version: 1,
    },
    {
      _id: ENDED,
      projectId: PROJECT,
      onCallDutyPolicyId: POLICY,
      overrideUserId: JANE,
      routeAlertsToUserId: CAROL,
      startsAt: new Date("2026-11-12T09:00:00.000Z"),
      endsAt: new Date("2026-11-12T17:00:00.000Z"),
      createdAt: new Date("2026-11-03T10:00:00.000Z"),
      version: 1,
    },
    {
      _id: GLOBAL,
      projectId: PROJECT,
      onCallDutyPolicyId: null,
      overrideUserId: JANE,
      routeAlertsToUserId: null,
      startsAt: new Date("2026-11-20T00:00:00.000Z"),
      endsAt: new Date("2026-11-21T00:00:00.000Z"),
      createdAt: new Date("2026-11-04T10:00:00.000Z"),
      version: 1,
    },
  ];
};

const USERS: Array<StoredRow> = Object.keys(NAMES).map(
  (id: string): StoredRow => {
    return { _id: id, name: NAMES[id], timezone: "UTC" };
  },
);

let table: InMemoryTable;
let limit: LimitTransactions;

// A member of the project holding `permissions` over all of it.
const member: (
  permissions?: Array<Permission>,
) => DatabaseCommonInteractionProps = (
  permissions?: Array<Permission>,
): DatabaseCommonInteractionProps => {
  return {
    ...customDomainCaller({
      permissions: permissions || [Permission.OnCallMember],
      projectId: new ObjectID(PROJECT),
    }),
    ...ON_HIGHEST_PLAN,
  };
};

const edit: (
  id: string,
  data: Record<string, unknown>,
  props?: DatabaseCommonInteractionProps,
) => Promise<void> = async (
  id: string,
  data: Record<string, unknown>,
  props?: DatabaseCommonInteractionProps,
): Promise<void> => {
  await OnCallDutyPolicyUserOverrideService.updateOneById({
    id: new ObjectID(id),
    data: data as never,
    props: props || member(),
  });
};

const refusalOf: (promise: Promise<unknown>) => Promise<Error> = async (
  promise: Promise<unknown>,
): Promise<Error> => {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }

  throw new Error("Expected the edit to be refused, but it went through.");
};

const stored: (id: string, column: string) => unknown = (
  id: string,
  column: string,
): unknown => {
  return table.get(id)?.[column];
};

const storedTime: (id: string, column: string) => string = (
  id: string,
  column: string,
): string => {
  return OneUptimeDate.fromString(stored(id, column) as Date).toISOString();
};

// What each feed entry the edits wrote says.
const feedEntries: () => Array<{
  type: OnCallDutyPolicyFeedEventType;
  text: string;
  policyId: string;
  workspace: unknown;
}> = (): Array<{
  type: OnCallDutyPolicyFeedEventType;
  text: string;
  policyId: string;
  workspace: unknown;
}> => {
  return (
    OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem as unknown as jest.Mock
  ).mock.calls.map((call: Array<unknown>) => {
    const item: {
      onCallDutyPolicyFeedEventType: OnCallDutyPolicyFeedEventType;
      feedInfoInMarkdown: string;
      onCallDutyPolicyId: ObjectID;
      workspaceNotification: unknown;
    } = call[0] as {
      onCallDutyPolicyFeedEventType: OnCallDutyPolicyFeedEventType;
      feedInfoInMarkdown: string;
      onCallDutyPolicyId: ObjectID;
      workspaceNotification: unknown;
    };

    return {
      type: item.onCallDutyPolicyFeedEventType,
      text: item.feedInfoInMarkdown,
      policyId: item.onCallDutyPolicyId.toString(),
      workspace: item.workspaceNotification,
    };
  });
};

beforeEach(() => {
  stubProjectDirectory({});
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);

  table = useInMemoryTable(OnCallDutyPolicyUserOverrideService, rowsAtStart());
  limit = useUserOverrideTimesInMemory({
    overrides: (): Array<StoredRow> => {
      return table.rows;
    },
    users: (): Array<StoredRow> => {
      return USERS;
    },
  });

  jest
    .spyOn(OnCallDutyPolicyService, "getOnCallDutyPolicyName")
    .mockResolvedValue("Payments");
  jest
    .spyOn(OnCallDutyPolicyService, "getOnCallDutyPolicyLinkInDashboard")
    .mockResolvedValue(URL.fromString("https://oneuptime.example/policy"));
  jest.spyOn(UserService, "getTimezoneForUser").mockResolvedValue(null);
  jest
    .spyOn(UserService, "getUserMarkdownString")
    .mockImplementation(
      async (data: { userId: ObjectID }): Promise<MarkdownText> => {
        return FeedMarkdown.asMarkdown(
          NAMES[data.userId.toString().toLowerCase()] || "somebody",
        );
      },
    );
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
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("who covers", () => {
  test("changes on an override that has not started, and the policy's feed says what it was, once", async () => {
    await edit(UPCOMING, { routeAlertsToUserId: new ObjectID(CAROL) });

    expect(String(stored(UPCOMING, "routeAlertsToUserId")).toLowerCase()).toBe(
      CAROL,
    );

    const entries: ReturnType<typeof feedEntries> = feedEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0]!.type).toBe(
      OnCallDutyPolicyFeedEventType.UserOverrideChanged,
    );
    expect(entries[0]!.policyId.toLowerCase()).toBe(POLICY);
    expect(entries[0]!.text).toContain(
      "Changed a User Override Rule for user **Jane Doe**",
    );
    expect(entries[0]!.text).toContain(
      "All alerts will be routed to **Carol Ng**",
    );
    expect(entries[0]!.text).toContain(
      "Changed: who covers (it was **Bob Lee**).",
    );
    // Posted to the chat channels the policy posts to, as an add is.
    expect(entries[0]!.workspace).toEqual({
      sendWorkspaceNotification: true,
      leadWithAuthor: true,
    });
  });

  test("changes on an override under way: whoever covers from now on", async () => {
    await edit(RUNNING, { routeAlertsToUserId: new ObjectID(CAROL) });

    expect(String(stored(RUNNING, "routeAlertsToUserId")).toLowerCase()).toBe(
      CAROL,
    );
  });

  test("a change of who covers alone takes no lock: it cannot make an overlap", async () => {
    await edit(UPCOMING, { routeAlertsToUserId: new ObjectID(CAROL) });

    expect(limit.opened).toBe(0);
  });

  test("an override that names who covers becomes a skip, and the feed says the rotation covers now", async () => {
    await edit(UPCOMING, { routeAlertsToUserId: null });

    expect(stored(UPCOMING, "routeAlertsToUserId")).toBeNull();

    const text: string = feedEntries()[0]!.text;

    expect(text).toContain("Nobody is named to cover");
    expect(text).toContain("Changed: who covers (it was **Bob Lee**).");
  });

  test("a skip gets somebody to cover, and the feed says it was the rotation", async () => {
    await edit(UPCOMING, { routeAlertsToUserId: null });
    await edit(UPCOMING, { routeAlertsToUserId: new ObjectID(KIM) });

    expect(String(stored(UPCOMING, "routeAlertsToUserId")).toLowerCase()).toBe(
      KIM,
    );
    expect(feedEntries()[1]!.text).toContain(
      "Changed: who covers (it was the next person in the rotation).",
    );
  });

  test("may not be the person who is away, in any case", async () => {
    const refusal: Error = await refusalOf(
      edit(UPCOMING, {
        routeAlertsToUserId: new ObjectID(JANE.toUpperCase()),
      }),
    );

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal.message).toBe(
      "The person who is away cannot cover for themselves. Pick someone else to cover, or nobody, to skip them in the rotation.",
    );
    expect(String(stored(UPCOMING, "routeAlertsToUserId")).toLowerCase()).toBe(
      BOB,
    );
    expect(feedEntries()).toHaveLength(0);
  });
});

describe("when it starts", () => {
  test("moves on an override that has not started, under the lock that refuses overlaps", async () => {
    const startsAt: Date = new Date("2026-11-14T10:00:00.000Z");

    await edit(UPCOMING, { startsAt: startsAt });

    expect(storedTime(UPCOMING, "startsAt")).toBe(startsAt.toISOString());
    expect(limit.opened).toBe(1);
    // The override read again under the lock, the person's others read, then the write.
    expect(limit.events).toEqual([
      "lock",
      "find OnCallDutyPolicyUserOverride",
      "find OnCallDutyPolicyUserOverride",
      "update OnCallDutyPolicyUserOverride",
    ]);
    expect(feedEntries()[0]!.text).toContain(
      "Changed: when it starts (it was **",
    );
  });

  test("moves to this minute: a picker's now is the start of the current minute", async () => {
    await edit(UPCOMING, { startsAt: THIS_MINUTE });

    expect(storedTime(UPCOMING, "startsAt")).toBe(THIS_MINUTE.toISOString());
  });

  test("never moves to the past", async () => {
    const refusal: Error = await refusalOf(
      edit(UPCOMING, { startsAt: LAST_MINUTE }),
    );

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal.message).toBe(USER_OVERRIDE_START_IN_PAST_REFUSAL);
    expect(storedTime(UPCOMING, "startsAt")).toBe(
      UPCOMING_STARTS.toISOString(),
    );
    expect(limit.opened).toBe(0);
  });

  test("never moves once the override has started: pages already went by it", async () => {
    const refusal: Error = await refusalOf(
      edit(RUNNING, { startsAt: new Date("2026-11-13T15:00:00.000Z") }),
    );

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal.message).toBe(USER_OVERRIDE_STARTED_REFUSAL);
    expect(storedTime(RUNNING, "startsAt")).toBe(RUNNING_STARTS.toISOString());
    expect(feedEntries()).toHaveLength(0);
  });

  test("sent back as it is, to the minute, is no change - though it was saved to the second", async () => {
    const endsAt: Date = new Date("2026-11-13T22:00:00.000Z");

    // The dialog sends every field: 8:00, the minute the picker holds.
    await edit(RUNNING, {
      startsAt: new Date("2026-11-13T08:00:00.000Z"),
      endsAt: endsAt,
      routeAlertsToUserId: new ObjectID(BOB),
    });

    // The start stays to the second; only the end moved.
    expect(storedTime(RUNNING, "startsAt")).toBe(RUNNING_STARTS.toISOString());
    expect(storedTime(RUNNING, "endsAt")).toBe(endsAt.toISOString());

    const text: string = feedEntries()[0]!.text;

    expect(text).toContain("Changed: when it ends (it was **");
    expect(text).not.toContain("when it starts");
    expect(text).not.toContain("who covers (it was");
  });

  test("may not come after the end, as the edit leaves it", async () => {
    const refusal: Error = await refusalOf(
      edit(UPCOMING, { startsAt: new Date("2026-11-14T18:00:00.000Z") }),
    );

    expect(refusal.message).toBe(
      "An override has to end after it starts. Pick an end time later than its start time.",
    );
    expect(storedTime(UPCOMING, "startsAt")).toBe(
      UPCOMING_STARTS.toISOString(),
    );
  });

  test("may not be taken away", async () => {
    const refusal: Error = await refusalOf(edit(UPCOMING, { startsAt: null }));

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal.message).toBe(
      "An override always has a start time and an end time, so neither can be removed. Pick another time instead.",
    );
    expect(storedTime(UPCOMING, "startsAt")).toBe(
      UPCOMING_STARTS.toISOString(),
    );
  });
});

describe("when it ends", () => {
  test("moves later on an override under way, to extend it", async () => {
    const endsAt: Date = new Date("2026-11-14T08:00:00.000Z");

    await edit(RUNNING, { endsAt: endsAt });

    expect(storedTime(RUNNING, "endsAt")).toBe(endsAt.toISOString());
    expect(feedEntries()).toHaveLength(1);
  });

  test("moves to now, to end it now", async () => {
    await edit(RUNNING, { endsAt: THIS_MINUTE });

    expect(storedTime(RUNNING, "endsAt")).toBe(THIS_MINUTE.toISOString());
  });

  test("never moves to the past", async () => {
    const refusal: Error = await refusalOf(
      edit(RUNNING, { endsAt: LAST_MINUTE }),
    );

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal.message).toBe(USER_OVERRIDE_END_IN_PAST_REFUSAL);
    expect(storedTime(RUNNING, "endsAt")).toBe(RUNNING_ENDS.toISOString());
  });

  test("may not come before the start", async () => {
    const refusal: Error = await refusalOf(
      edit(UPCOMING, { endsAt: new Date("2026-11-14T08:00:00.000Z") }),
    );

    expect(refusal.message).toBe(
      "An override has to end after it starts. Pick an end time later than its start time.",
    );
    expect(storedTime(UPCOMING, "endsAt")).toBe(UPCOMING_ENDS.toISOString());
  });

  test("moves with the start, both at once", async () => {
    const startsAt: Date = new Date("2026-11-15T09:00:00.000Z");
    const endsAt: Date = new Date("2026-11-15T17:00:00.000Z");

    await edit(UPCOMING, { startsAt: startsAt, endsAt: endsAt });

    expect(storedTime(UPCOMING, "startsAt")).toBe(startsAt.toISOString());
    expect(storedTime(UPCOMING, "endsAt")).toBe(endsAt.toISOString());

    const text: string = feedEntries()[0]!.text;

    expect(text).toContain("when it starts (it was **");
    expect(text).toContain("; when it ends (it was **");
  });
});

describe("what does not change", () => {
  test("an override that has ended: nothing about it, not even who covers", async () => {
    for (const data of [
      { routeAlertsToUserId: new ObjectID(BOB) },
      { endsAt: new Date("2026-11-14T08:00:00.000Z") },
    ]) {
      const refusal: Error = await refusalOf(edit(ENDED, data));

      expect(refusal).toBeInstanceOf(BadDataException);
      expect(refusal.message).toBe(USER_OVERRIDE_ENDED_REFUSAL);
    }

    expect(String(stored(ENDED, "routeAlertsToUserId")).toLowerCase()).toBe(
      CAROL,
    );
    expect(feedEntries()).toHaveLength(0);
  });

  test("who is away: that would be another override", async () => {
    const refusal: Error = await refusalOf(
      edit(UPCOMING, { overrideUserId: new ObjectID(KIM) }),
    );

    expect(refusal).toBeInstanceOf(ColumnWriteRefusedException);
    expect((refusal as ColumnWriteRefusedException).columnName).toBe(
      "overrideUserId",
    );
    expect(String(stored(UPCOMING, "overrideUserId")).toLowerCase()).toBe(JANE);
  });

  test("its policy, or whether it is global", async () => {
    const refusal: Error = await refusalOf(
      edit(GLOBAL, { onCallDutyPolicyId: new ObjectID(POLICY) }),
    );

    expect(refusal).toBeInstanceOf(ColumnWriteRefusedException);
    expect(stored(GLOBAL, "onCallDutyPolicyId")).toBeNull();
  });

  test("an edit that sends every field as it is writes nothing to the feed", async () => {
    await edit(UPCOMING, {
      routeAlertsToUserId: new ObjectID(BOB),
      startsAt: UPCOMING_STARTS,
      endsAt: UPCOMING_ENDS,
    });

    expect(feedEntries()).toHaveLength(0);
    // Both times were the saved ones: no lock was needed.
    expect(limit.opened).toBe(0);
  });
});

describe("who may edit", () => {
  test.each([
    ["a project owner", [Permission.ProjectOwner]],
    ["a project admin", [Permission.ProjectAdmin]],
    ["a project member", [Permission.ProjectMember]],
    ["an on-call admin", [Permission.OnCallAdmin]],
    ["an on-call member", [Permission.OnCallMember]],
    [
      "someone holding the permission to edit overrides, who reads the policies",
      [
        Permission.EditOnCallDutyPolicyUserOverride,
        Permission.ReadOnCallDutyPolicyUserOverride,
        Permission.ReadProjectOnCallDutyPolicy,
      ],
    ],
  ])("%s edits one", async (_who: string, permissions: Array<Permission>) => {
    await edit(
      UPCOMING,
      { routeAlertsToUserId: new ObjectID(CAROL) },
      member(permissions),
    );

    expect(String(stored(UPCOMING, "routeAlertsToUserId")).toLowerCase()).toBe(
      CAROL,
    );
  });

  test.each([
    ["a viewer", [Permission.Viewer]],
    ["an on-call viewer", [Permission.OnCallViewer]],
    [
      "someone who may only add and delete them",
      [
        Permission.CreateOnCallDutyPolicyUserOverride,
        Permission.DeleteOnCallDutyPolicyUserOverride,
        Permission.ReadOnCallDutyPolicyUserOverride,
        Permission.ReadProjectOnCallDutyPolicy,
      ],
    ],
  ])(
    "%s may not, and nothing changes",
    async (_who: string, permissions: Array<Permission>) => {
      const refusal: Error = await refusalOf(
        edit(
          UPCOMING,
          { routeAlertsToUserId: new ObjectID(CAROL) },
          member(permissions),
        ),
      );

      expect(refusal).toBeInstanceOf(NotAuthorizedException);
      expect(
        String(stored(UPCOMING, "routeAlertsToUserId")).toLowerCase(),
      ).toBe(BOB);
    },
  );

  test("a global override is edited by a member over the whole project, and says nothing in any policy's feed", async () => {
    await edit(GLOBAL, { routeAlertsToUserId: new ObjectID(BOB) });

    expect(String(stored(GLOBAL, "routeAlertsToUserId")).toLowerCase()).toBe(
      BOB,
    );
    expect(feedEntries()).toHaveLength(0);
  });
});

/*
 * Audit M2: an edit refreshes the schedules of the people the override
 * named before it, as well as after it. The hooks are protected, so they
 * are reached through a cast.
 */
describe("the schedules an edit refreshes", () => {
  interface UpdateHooks {
    onBeforeUpdate: (updateBy: unknown) => Promise<{
      updateBy: unknown;
      carryForward: {
        pairs: Array<{ projectId: ObjectID; overrideUserId: ObjectID }>;
        before: Array<{ id: string }>;
      };
    }>;
    onUpdateSuccess: (
      onUpdate: unknown,
      updatedItemIds: Array<ObjectID>,
    ) => Promise<unknown>;
  }

  const hooks: UpdateHooks =
    OnCallDutyPolicyUserOverrideService as unknown as UpdateHooks;

  const refreshedUserIds: () => Array<string> = (): Array<string> => {
    return (
      OnCallDutyPolicyScheduleService.refreshRostersForUserInProject as unknown as jest.Mock
    ).mock.calls.map((call: Array<unknown>): string => {
      return (call[0] as { userId: ObjectID }).userId.toString().toLowerCase();
    });
  };

  test("the edit's hook reads the override as it is, for after the write", async () => {
    const onUpdate: Awaited<ReturnType<UpdateHooks["onBeforeUpdate"]>> =
      await hooks.onBeforeUpdate({
        query: { _id: new ObjectID(UPCOMING) },
        data: { endsAt: new Date("2026-11-14T18:00:00.000Z") },
        props: { isRoot: true },
      });

    expect(onUpdate.carryForward.pairs).toHaveLength(1);
    expect(
      onUpdate.carryForward.pairs[0]!.overrideUserId.toString().toLowerCase(),
    ).toBe(JANE);
    expect(onUpdate.carryForward.before[0]!.id.toLowerCase()).toBe(UPCOMING);
  });

  test("refreshes both the person the override named before (A) and after (A2)", async () => {
    // OneUptime itself moved the override to Kim: only it may.
    table.get(UPCOMING)!["overrideUserId"] = KIM;

    await hooks.onUpdateSuccess(
      {
        updateBy: { query: {}, data: {}, props: { isRoot: true } },
        carryForward: {
          pairs: [
            {
              projectId: new ObjectID(PROJECT),
              overrideUserId: new ObjectID(JANE),
            },
          ],
          before: [],
        },
      },
      [new ObjectID(UPCOMING)],
    );

    expect(refreshedUserIds().sort()).toEqual([JANE, KIM].sort());
  });

  test("refreshes one person once when they stay the same", async () => {
    await edit(UPCOMING, { endsAt: new Date("2026-11-14T18:00:00.000Z") });

    expect(refreshedUserIds()).toEqual([JANE]);
  });

  test("a read of the overrides that fails fails the edit: nothing is written unchecked", async () => {
    getJestSpyOn(
      OnCallDutyPolicyUserOverrideService,
      "findRowsAndHoldUpdateToThem",
    ).mockRejectedValue(new Error("db unavailable"));

    const refusal: Error = await refusalOf(
      edit(UPCOMING, { routeAlertsToUserId: new ObjectID(CAROL) }),
    );

    expect(refusal.message).toBe("db unavailable");
    expect(String(stored(UPCOMING, "routeAlertsToUserId")).toLowerCase()).toBe(
      BOB,
    );
  });
});
