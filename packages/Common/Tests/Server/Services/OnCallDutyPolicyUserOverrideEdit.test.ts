import { OnCallDutyPolicyFeedEventType } from "../../../Models/DatabaseModels/OnCallDutyPolicyFeed";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import OnCallDutyPolicyEscalationRuleScheduleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyFeedService from "../../../Server/Services/OnCallDutyPolicyFeedService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUtil from "../../../Server/Utils/Workspace/Workspace";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import OnCallDutyPolicyUserOverrideService from "../../../Server/Services/OnCallDutyPolicyUserOverrideService";
import UserService from "../../../Server/Services/UserService";
import PendingInviteeProfiles, {
  WithheldProfile,
} from "../../../Server/Utils/TeamMember/PendingInviteeProfiles";
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
    // Earlier: it adds time, which another override may hold.
    const startsAt: Date = new Date("2026-11-14T08:00:00.000Z");

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

  /*
   * Issue #7899: moved later, an override is only shortened - it adds no
   * time, so it cannot make an overlap, and the person's others are not
   * read. It is still read again under the lock, in order.
   */
  test("moves later, under the lock, without reading the person's other overrides: it adds no time", async () => {
    const startsAt: Date = new Date("2026-11-14T10:00:00.000Z");

    await edit(UPCOMING, { startsAt: startsAt });

    expect(storedTime(UPCOMING, "startsAt")).toBe(startsAt.toISOString());
    expect(limit.opened).toBe(1);
    expect(limit.events).toEqual([
      "lock",
      "find OnCallDutyPolicyUserOverride",
      "update OnCallDutyPolicyUserOverride",
    ]);
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

/*
 * What the policy's chat channels hear of an edit (issue #7549): one short
 * line, the override as it is now, said as an added one is - each moment
 * in its reader's own zone - not the feed's entry with what it was and the
 * times in the zones of both people.
 */
describe("the line the policy's chat channels get", () => {
  const chatLines: () => Array<string | undefined> = (): Array<
    string | undefined
  > => {
    return (
      OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem as unknown as jest.Mock
    ).mock.calls.map((call: Array<unknown>): string | undefined => {
      return (call[0] as { chatInfoInMarkdown?: string | undefined })
        .chatInfoInMarkdown;
    });
  };

  // A moment as the line writes it: the reader's own day and time.
  const moment: (date: Date) => string = (date: Date): string => {
    // To the second, in UTC: "2026-11-14T09:00:00Z".
    const iso: string = `${date.toISOString().slice(0, 19)}Z`;

    return `{{DATE(${iso}, SHORT)}} at {{TIME(${iso})}}`;
  };

  test("a new cover: who covers for whom now, from when to when", async () => {
    await edit(UPCOMING, { routeAlertsToUserId: new ObjectID(CAROL) });

    expect(chatLines()).toEqual([
      `✏️ Changed an override on [Payments](https://oneuptime.example/policy): Carol Ng covers for Jane Doe from ${moment(UPCOMING_STARTS)} to ${moment(UPCOMING_ENDS)}.`,
    ]);
  });

  test("a cover taken off: the person is away, and the rotation covers", async () => {
    await edit(UPCOMING, { routeAlertsToUserId: null });

    expect(chatLines()).toEqual([
      `✏️ Changed an override on [Payments](https://oneuptime.example/policy): Jane Doe is away from ${moment(UPCOMING_STARTS)} to ${moment(UPCOMING_ENDS)}, and their turns go to the next person in the rotation.`,
    ]);
  });

  test("new times: the times it has now", async () => {
    const endsAt: Date = new Date("2026-11-14T18:00:00.000Z");

    await edit(UPCOMING, { endsAt: endsAt });

    expect(chatLines()).toEqual([
      `✏️ Changed an override on [Payments](https://oneuptime.example/policy): Bob Lee covers for Jane Doe from ${moment(UPCOMING_STARTS)} to ${moment(endsAt)}.`,
    ]);
  });

  test("leaves what it was, and the times in both people's zones, to the feed", async () => {
    await edit(UPCOMING, { routeAlertsToUserId: new ObjectID(CAROL) });

    const line: string = chatLines()[0] || "";

    expect(line).toContain("✏️ Changed an override on");
    expect(line).not.toContain("it was");
    expect(line).not.toContain("Changed:");
    expect(line).not.toContain("User Override Rule");
    expect(line).not.toContain("Bob Lee");
    // The feed's entry still says it.
    expect(feedEntries()[0]!.text).toContain(
      "Changed: who covers (it was **Bob Lee**).",
    );
  });

  test("an edit that changes nothing, or a global override's, posts no line", async () => {
    await edit(UPCOMING, {
      routeAlertsToUserId: new ObjectID(BOB),
      startsAt: UPCOMING_STARTS,
      endsAt: UPCOMING_ENDS,
    });
    await edit(GLOBAL, { routeAlertsToUserId: new ObjectID(BOB) });

    expect(chatLines()).toEqual([]);
  });

  /*
   * EACH WORKSPACE'S LINE NAMES ITS PEOPLE AS THAT WORKSPACE KNOWS THEM
   * (#7967), as a hand-off's line does: "@jane.doe" in Slack, where Jane
   * connected her account, and her OneUptime name in Microsoft Teams, where
   * she did not. Mattermost reads the times in words on the policy's clock
   * (#7970). The policy's feed keeps OneUptime's names.
   */
  describe("in each workspace, its people as it knows them (#7967)", () => {
    const byWorkspace: () => Array<
      Partial<Record<WorkspaceType, string>> | undefined
    > = (): Array<Partial<Record<WorkspaceType, string>> | undefined> => {
      return (
        OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem as unknown as jest.Mock
      ).mock.calls.map((call: Array<unknown>) => {
        return (
          call[0] as {
            chatInfoByWorkspaceType?: Partial<Record<WorkspaceType, string>>;
          }
        ).chatInfoByWorkspaceType;
      });
    };

    beforeEach(() => {
      jest
        .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuths")
        .mockResolvedValue(
          [
            WorkspaceType.Slack,
            WorkspaceType.MicrosoftTeams,
            WorkspaceType.Mattermost,
          ].map((workspaceType: WorkspaceType): WorkspaceProjectAuthToken => {
            const auth: WorkspaceProjectAuthToken =
              new WorkspaceProjectAuthToken();
            auth.workspaceType = workspaceType;
            auth.authToken = "token";
            return auth;
          }),
        );

      // Jane and Carol connected Slack and Mattermost; nobody connected Teams.
      jest
        .spyOn(WorkspaceUtil, "getUserStringForWorkspace")
        .mockImplementation((async (data: {
          userId: ObjectID;
          workspaceType: WorkspaceType;
        }): Promise<string> => {
          const name: string =
            NAMES[data.userId.toString().toLowerCase()] || "somebody";

          if (
            data.workspaceType === WorkspaceType.MicrosoftTeams ||
            name === "Bob Lee"
          ) {
            return `${name} `;
          }

          return `@${name.toLowerCase().replace(" ", ".")} `;
        }) as never);

      // The policy pages one schedule, set in New York.
      jest
        .spyOn(OnCallDutyPolicyEscalationRuleScheduleService, "findBy")
        .mockResolvedValue([
          {
            onCallDutyPolicySchedule: { timezone: "America/New_York" },
          },
        ] as never);
    });

    test("a new cover: Slack and Mattermost name them by the accounts they connected, Teams by their OneUptime names", async () => {
      await edit(UPCOMING, { routeAlertsToUserId: new ObjectID(CAROL) });

      const lines: Partial<Record<WorkspaceType, string>> =
        byWorkspace()[0] || {};

      expect(lines[WorkspaceType.Slack]).toBe(
        `✏️ Changed an override on [Payments](https://oneuptime.example/policy): @carol.ng covers for @jane.doe from ${moment(UPCOMING_STARTS)} to ${moment(UPCOMING_ENDS)}.`,
      );
      expect(lines[WorkspaceType.MicrosoftTeams]).toBe(
        `✏️ Changed an override on [Payments](https://oneuptime.example/policy): Carol Ng covers for Jane Doe from ${moment(UPCOMING_STARTS)} to ${moment(UPCOMING_ENDS)}.`,
      );
    });

    test("Mattermost reads the override's times in words, on its policy's clock (#7970)", async () => {
      await edit(UPCOMING, { routeAlertsToUserId: new ObjectID(CAROL) });

      expect(byWorkspace()[0]?.[WorkspaceType.Mattermost]).toBe(
        "✏️ Changed an override on [Payments](https://oneuptime.example/policy): @carol.ng covers for @jane.doe from Sat, Nov 14 at 4:00 AM EST to Sat, Nov 14 at 12:00 PM EST.",
      );
    });

    test("a cover taken off: the person, as each workspace knows them", async () => {
      await edit(UPCOMING, { routeAlertsToUserId: null });

      expect(byWorkspace()[0]?.[WorkspaceType.Slack]).toContain(
        ": @jane.doe is away from ",
      );
      expect(byWorkspace()[0]?.[WorkspaceType.MicrosoftTeams]).toContain(
        ": Jane Doe is away from ",
      );
    });

    test("the policy's feed, and the line for a workspace with none of its own, keep OneUptime's names", async () => {
      await edit(UPCOMING, { routeAlertsToUserId: new ObjectID(CAROL) });

      expect(feedEntries()[0]!.text).toContain(
        "for user **Jane Doe** for the [On-Call Policy Payments]",
      );
      expect(feedEntries()[0]!.text).not.toContain("@");
      expect(chatLines()[0]).toContain("Carol Ng covers for Jane Doe");
    });

    test("an edit that posts no line names nobody anywhere", async () => {
      await edit(GLOBAL, { routeAlertsToUserId: new ObjectID(BOB) });

      expect(byWorkspace()).toEqual([]);
      expect(WorkspaceUtil.getUserStringForWorkspace).not.toHaveBeenCalled();
    });
  });
});

/*
 * A COVER WHO HAS NOT JOINED THE PROJECT YET (#10670): an edit can make
 * someone invited who has not accepted the cover - the server takes them,
 * from the Dashboard, the API, Terraform and the MCP server alike - and
 * nothing pages them until they join. The feed entry and the channels'
 * line say the override as it is now, and so that nobody is paged in place
 * of the person away until then. Through the real update, as a member.
 */
describe("a cover who hasn't joined the project yet (#10670)", () => {
  // Invited to the project, and not joined yet.
  const IVY: string = "7631aaaa-0000-4000-8000-0000000000c9";

  // The line the first edit posted to the channels.
  const chatLine: () => string = (): string => {
    const call: Array<unknown> | undefined = (
      OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem as unknown as jest.Mock
    ).mock.calls[0];

    return String(
      (call?.[0] as { chatInfoInMarkdown?: string } | undefined)
        ?.chatInfoInMarkdown,
    );
  };

  const ivyIsInvited: (inviteeName: string | null) => void = (
    inviteeName: string | null,
  ): void => {
    jest
      .spyOn(PendingInviteeProfiles, "readWithheldProfilesInProject")
      .mockImplementation(
        async (data: {
          userIds: Array<string>;
        }): Promise<Map<string, WithheldProfile>> => {
          return new Map<string, WithheldProfile>(
            data.userIds
              .filter((userId: string): boolean => {
                return userId.toLowerCase() === IVY;
              })
              .map((userId: string): [string, WithheldProfile] => {
                return [
                  userId.toLowerCase(),
                  {
                    inviteeName: inviteeName,
                    inviteeEmail: "ivy@invited.example",
                  },
                ];
              }),
          );
        },
      );
  };

  test("is taken as the cover, and the lines say nobody is paged in place of the person away until they join", async () => {
    ivyIsInvited("Ivy");

    await edit(UPCOMING, { routeAlertsToUserId: new ObjectID(IVY) });

    expect(String(stored(UPCOMING, "routeAlertsToUserId")).toLowerCase()).toBe(
      IVY,
    );

    const text: string = feedEntries()[0]!.text;

    expect(text).toContain("All alerts will be routed to **Ivy**");
    expect(text).toContain(
      "**Ivy** hasn't joined the project yet, so nobody is paged in place of **Jane Doe** until they do.",
    );
    expect(text).toContain("Changed: who covers (it was **Bob Lee**).");
    expect(chatLine()).toBe(
      "✏️ Changed an override on [Payments](https://oneuptime.example/policy): Ivy covers for Jane Doe from {{DATE(2026-11-14T09:00:00Z, SHORT)}} at {{TIME(2026-11-14T09:00:00Z)}} to {{DATE(2026-11-14T17:00:00Z, SHORT)}} at {{TIME(2026-11-14T17:00:00Z)}}, but Ivy hasn't joined the project yet, so nobody is paged in place of Jane Doe until they do.",
    );
  });

  test.each([
    ["no name typed", null],
    ["only spaces typed", "   "],
    ["an address typed as the name", "ivy@invited.example"],
  ])(
    "with %s: someone who hasn't joined the project yet, never an address",
    async (_label: string, inviteeName: string | null) => {
      ivyIsInvited(inviteeName);

      await edit(UPCOMING, { routeAlertsToUserId: new ObjectID(IVY) });

      const text: string = feedEntries()[0]!.text;

      expect(text).toContain(
        "All alerts will be routed to **someone who hasn't joined the project yet**",
      );
      expect(text).toContain(
        "Nobody is paged in place of **Jane Doe** until they join the project.",
      );
      expect(chatLine()).toContain(
        ": someone who hasn't joined the project yet covers for Jane Doe from ",
      );
      expect(chatLine()).toMatch(
        /, so nobody is paged in place of Jane Doe until they join\.$/,
      );

      for (const line of [text, chatLine()]) {
        expect(line).not.toContain("ivy@invited.example");
      }
    },
  );

  test("an edit of the times alone says it again: the line is the override as it is now", async () => {
    ivyIsInvited("Ivy");

    await edit(UPCOMING, { routeAlertsToUserId: new ObjectID(IVY) });
    await edit(UPCOMING, { endsAt: new Date("2026-11-14T18:00:00.000Z") });

    const calls: Array<Array<unknown>> = (
      OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem as unknown as jest.Mock
    ).mock.calls;

    expect(calls).toHaveLength(2);
    expect(
      (calls[1]![0] as { chatInfoInMarkdown?: string }).chatInfoInMarkdown,
    ).toContain(
      ", but Ivy hasn't joined the project yet, so nobody is paged in place of Jane Doe until they do.",
    );
  });

  test("a cover who has joined takes over from them: no word of it", async () => {
    ivyIsInvited("Ivy");

    await edit(UPCOMING, { routeAlertsToUserId: new ObjectID(IVY) });
    await edit(UPCOMING, { routeAlertsToUserId: new ObjectID(CAROL) });

    const second: { feedInfoInMarkdown: string; chatInfoInMarkdown?: string } =
      (
        OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem as unknown as jest.Mock
      ).mock.calls[1]![0] as {
        feedInfoInMarkdown: string;
        chatInfoInMarkdown?: string;
      };

    expect(second.feedInfoInMarkdown).toContain(
      "Changed: who covers (it was **Ivy**).",
    );
    expect(second.feedInfoInMarkdown).not.toContain("hasn't joined");
    expect(second.chatInfoInMarkdown).not.toContain("hasn't joined");
  });

  test("taken off for the rotation to cover: no word of it", async () => {
    ivyIsInvited("Ivy");

    await edit(UPCOMING, { routeAlertsToUserId: new ObjectID(IVY) });
    await edit(UPCOMING, { routeAlertsToUserId: null });

    const second: { chatInfoInMarkdown?: string } = (
      OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem as unknown as jest.Mock
    ).mock.calls[1]![0] as { chatInfoInMarkdown?: string };

    expect(second.chatInfoInMarkdown).toContain(
      "and their turns go to the next person in the rotation.",
    );
    expect(second.chatInfoInMarkdown).not.toContain("hasn't joined");
  });
});

describe("who may edit", () => {
  test.each([
    ["a Project Owner", [Permission.ProjectOwner]],
    ["a Project Admin", [Permission.ProjectAdmin]],
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
