import { OnCallDutyPolicyFeedEventType } from "../../../Models/DatabaseModels/OnCallDutyPolicyFeed";
import OnCallDutyPolicyFeedService from "../../../Server/Services/OnCallDutyPolicyFeedService";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import OnCallDutyPolicyUserOverrideService from "../../../Server/Services/OnCallDutyPolicyUserOverrideService";
import UserService from "../../../Server/Services/UserService";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import ObjectID from "../../../Types/ObjectID";
import { GLOBAL_USER_OVERRIDE_EDIT_REFUSAL } from "../../../Types/OnCallDutyPolicy/GlobalUserOverrideAccess";
import {
  USER_OVERRIDE_ENDED_REFUSAL,
  USER_OVERRIDE_END_NOW_ENDS_THIS_MINUTE_REFUSAL,
  USER_OVERRIDE_END_NOW_NOT_STARTED_REFUSAL,
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
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { SpyInstance } from "jest-mock";

/*
 * END NOW (issue #7899): an override under way, ended at the server's own
 * now - the start of this minute, as a picker holds it, or now itself for
 * one that started in it - so a browser or a phone whose clock is a minute
 * out still ends it. It is an edit of the override's end by the caller,
 * through the real service: the same permission, the same rules and
 * refusals, the same lock, and the policy's feed says what changed.
 *
 * And an override that overlapped another before overlaps were refused can
 * be ended now: shortened, it adds no time, so it makes no overlap.
 */

jest.mock("../../../Server/Utils/Logger");

const PROJECT: string = "7899aaaa-0000-4000-8000-000000000001";
const POLICY: string = "7899aaaa-0000-4000-8000-0000000000b1";

const JANE: string = "7899aaaa-0000-4000-8000-0000000000c1";
const BOB: string = "7899aaaa-0000-4000-8000-0000000000c2";
const CAROL: string = "7899aaaa-0000-4000-8000-0000000000c3";
const KIM: string = "7899aaaa-0000-4000-8000-0000000000c4";

const NAMES: Record<string, string> = {
  [JANE]: "Jane Doe",
  [BOB]: "Bob Lee",
  [CAROL]: "Carol Ng",
  [KIM]: "Kim Ito",
};

// Half a minute into 12:00: End Now ends at 12:00.
const NOW: Date = new Date("2026-11-13T12:00:30.000Z");
const THIS_MINUTE: Date = new Date("2026-11-13T12:00:00.000Z");

// Under way since this morning, Kim covered by Bob on the policy.
const RUNNING: string = "7899aaaa-0000-4000-8000-0000000000d1";
const RUNNING_ENDS: Date = new Date("2026-11-13T20:00:00.000Z");

// Tomorrow, Jane covered by Bob on the policy.
const UPCOMING: string = "7899aaaa-0000-4000-8000-0000000000d2";

// Yesterday, Jane covered by Carol: over.
const ENDED: string = "7899aaaa-0000-4000-8000-0000000000d3";

// Under way, Jane away on every policy, the rotation covering.
const GLOBAL_RUNNING: string = "7899aaaa-0000-4000-8000-0000000000d4";

// Started ten seconds into this minute, Carol covered by Kim.
const STARTED_THIS_MINUTE: string = "7899aaaa-0000-4000-8000-0000000000d5";

// Under way, ending twenty seconds from now, Jane covered by Kim on the policy.
const ENDING_THIS_MINUTE: string = "7899aaaa-0000-4000-8000-0000000000d6";

const row: (data: {
  id: string;
  away: string;
  cover: string | null;
  policy: string | null;
  from: string;
  until: string;
}) => StoredRow = (data: {
  id: string;
  away: string;
  cover: string | null;
  policy: string | null;
  from: string;
  until: string;
}): StoredRow => {
  return {
    _id: data.id,
    projectId: PROJECT,
    onCallDutyPolicyId: data.policy,
    overrideUserId: data.away,
    routeAlertsToUserId: data.cover,
    startsAt: new Date(data.from),
    endsAt: new Date(data.until),
    createdAt: new Date("2026-11-01T10:00:00.000Z"),
    version: 1,
  };
};

const rowsAtStart: () => Array<StoredRow> = (): Array<StoredRow> => {
  return [
    row({
      id: RUNNING,
      away: KIM,
      cover: BOB,
      policy: POLICY,
      from: "2026-11-13T08:00:45.000Z",
      until: RUNNING_ENDS.toISOString(),
    }),
    row({
      id: UPCOMING,
      away: JANE,
      cover: BOB,
      policy: POLICY,
      from: "2026-11-14T09:00:00.000Z",
      until: "2026-11-14T17:00:00.000Z",
    }),
    row({
      id: ENDED,
      away: JANE,
      cover: CAROL,
      policy: POLICY,
      from: "2026-11-12T09:00:00.000Z",
      until: "2026-11-12T17:00:00.000Z",
    }),
    row({
      id: GLOBAL_RUNNING,
      away: JANE,
      cover: null,
      policy: null,
      from: "2026-11-13T06:00:00.000Z",
      until: "2026-11-13T22:00:00.000Z",
    }),
    row({
      id: STARTED_THIS_MINUTE,
      away: CAROL,
      cover: KIM,
      policy: POLICY,
      from: "2026-11-13T12:00:10.000Z",
      until: "2026-11-13T18:00:00.000Z",
    }),
    row({
      id: ENDING_THIS_MINUTE,
      away: JANE,
      cover: KIM,
      policy: POLICY,
      from: "2026-11-13T09:00:00.000Z",
      until: "2026-11-13T12:00:50.000Z",
    }),
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
  data?: { labelIds?: Array<ObjectID> },
) => DatabaseCommonInteractionProps = (
  permissions?: Array<Permission>,
  data?: { labelIds?: Array<ObjectID> },
): DatabaseCommonInteractionProps => {
  return {
    ...customDomainCaller({
      permissions: permissions || [Permission.OnCallMember],
      projectId: new ObjectID(PROJECT),
      labelIds: data?.labelIds,
    }),
    ...ON_HIGHEST_PLAN,
  };
};

const endNow: (
  id: string,
  props?: DatabaseCommonInteractionProps,
) => Promise<Date> = async (
  id: string,
  props?: DatabaseCommonInteractionProps,
): Promise<Date> => {
  return await OnCallDutyPolicyUserOverrideService.endNow({
    id: new ObjectID(id),
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

  throw new Error("Expected End Now to be refused, but it went through.");
};

const storedEnd: (id: string) => string = (id: string): string => {
  return OneUptimeDate.fromString(
    table.get(id)?.["endsAt"] as Date,
  ).toISOString();
};

// What each feed entry the edits wrote says.
const feedEntries: () => Array<{
  type: OnCallDutyPolicyFeedEventType;
  text: string;
}> = (): Array<{ type: OnCallDutyPolicyFeedEventType; text: string }> => {
  return (
    OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem as unknown as jest.Mock
  ).mock.calls.map((call: Array<unknown>) => {
    const item: {
      onCallDutyPolicyFeedEventType: OnCallDutyPolicyFeedEventType;
      feedInfoInMarkdown: string;
    } = call[0] as {
      onCallDutyPolicyFeedEventType: OnCallDutyPolicyFeedEventType;
      feedInfoInMarkdown: string;
    };

    return {
      type: item.onCallDutyPolicyFeedEventType,
      text: item.feedInfoInMarkdown,
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

describe("End Now on an override under way", () => {
  test("ends it at the start of this minute, by the server's clock", async () => {
    const endsAt: Date = await endNow(RUNNING);

    expect(endsAt.toISOString()).toBe(THIS_MINUTE.toISOString());
    expect(storedEnd(RUNNING)).toBe(THIS_MINUTE.toISOString());
  });

  test("writes it as an edit of its end by the caller: the update, with their props, under the lock", async () => {
    const props: DatabaseCommonInteractionProps = member();
    const update: SpyInstance<
      typeof OnCallDutyPolicyUserOverrideService.updateOneById
    > = jest.spyOn(OnCallDutyPolicyUserOverrideService, "updateOneById");

    await endNow(RUNNING, props);

    expect(update).toHaveBeenCalledTimes(1);

    const call: { id: ObjectID; data: unknown; props: unknown } = update.mock
      .calls[0]![0] as unknown as {
      id: ObjectID;
      data: unknown;
      props: unknown;
    };

    expect(call.id.toString()).toBe(RUNNING);
    expect(Object.keys(call.data as Record<string, unknown>)).toEqual([
      "endsAt",
    ]);
    expect(call.props).toBe(props);
    // Its times moved: checked for overlaps under the project's lock.
    expect(limit.opened).toBe(1);
  });

  test("the policy's feed says, once, that when it ends changed", async () => {
    await endNow(RUNNING);

    const entries: Array<{
      type: OnCallDutyPolicyFeedEventType;
      text: string;
    }> = feedEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0]!.type).toBe(
      OnCallDutyPolicyFeedEventType.UserOverrideChanged,
    );
    expect(entries[0]!.text).toContain("Kim Ito");
    expect(entries[0]!.text).toContain("Changed: when it ends (it was");
  });

  test("one that started in this very minute ends at now itself, after its start", async () => {
    const endsAt: Date = await endNow(STARTED_THIS_MINUTE);

    expect(endsAt.toISOString()).toBe(NOW.toISOString());
    expect(storedEnd(STARTED_THIS_MINUTE)).toBe(NOW.toISOString());
  });

  test("a global one is ended by a member over the whole project, and says nothing in any policy's feed", async () => {
    await endNow(GLOBAL_RUNNING);

    expect(storedEnd(GLOBAL_RUNNING)).toBe(THIS_MINUTE.toISOString());
    expect(feedEntries()).toHaveLength(0);
  });
});

describe("End Now refuses, saying why, and changes nothing", () => {
  test("an override that has not started: there is nothing to end, delete it instead", async () => {
    const refusal: Error = await refusalOf(endNow(UPCOMING));

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal.message).toBe(USER_OVERRIDE_END_NOW_NOT_STARTED_REFUSAL);
    expect(storedEnd(UPCOMING)).toBe("2026-11-14T17:00:00.000Z");
  });

  test("an override that has ended", async () => {
    const refusal: Error = await refusalOf(endNow(ENDED));

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal.message).toBe(USER_OVERRIDE_ENDED_REFUSAL);
    expect(storedEnd(ENDED)).toBe("2026-11-12T17:00:00.000Z");
  });

  test("an override that ends within this minute anyway", async () => {
    const refusal: Error = await refusalOf(endNow(ENDING_THIS_MINUTE));

    expect(refusal.message).toBe(
      USER_OVERRIDE_END_NOW_ENDS_THIS_MINUTE_REFUSAL,
    );
    expect(storedEnd(ENDING_THIS_MINUTE)).toBe("2026-11-13T12:00:50.000Z");
  });

  test("an override that is not there", async () => {
    const refusal: Error = await refusalOf(
      endNow("7899aaaa-0000-4000-8000-0000000000ff"),
    );

    expect(refusal).toBeInstanceOf(NotFoundException);
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
    "%s may not: End Now takes the permission to edit overrides",
    async (_who: string, permissions: Array<Permission>) => {
      const refusal: Error = await refusalOf(
        endNow(RUNNING, member(permissions)),
      );

      expect(refusal).toBeInstanceOf(NotAuthorizedException);
      expect(storedEnd(RUNNING)).toBe(RUNNING_ENDS.toISOString());
    },
  );

  /*
   * A global override takes the permission over the whole project to be
   * edited, End Now included: its update runs the edit's hook with the
   * caller's props ("writes it as an edit of its end by the caller"),
   * whose refusal of a member limited to labels or to owned policies
   * OnCallDutyPolicyUserOverrideGlobalAccess holds. The hook is asked
   * here with End Now's own change.
   */
  test("a global one, for a member whose permission is limited to labels: the edit's hook refuses it", async () => {
    jest
      .spyOn(
        OnCallDutyPolicyUserOverrideService as unknown as Record<
          string,
          () => Promise<unknown>
        >,
        "findRowsAndHoldUpdateToThem",
      )
      .mockResolvedValue([
        {
          _id: GLOBAL_RUNNING,
          id: new ObjectID(GLOBAL_RUNNING),
          projectId: new ObjectID(PROJECT),
          onCallDutyPolicyId: undefined,
          overrideUserId: new ObjectID(JANE),
          startsAt: new Date("2026-11-13T06:00:00.000Z"),
          endsAt: new Date("2026-11-13T22:00:00.000Z"),
        },
      ] as never);

    const refusal: Error = await refusalOf(
      (
        OnCallDutyPolicyUserOverrideService as unknown as {
          onBeforeUpdate: (updateBy: unknown) => Promise<unknown>;
        }
      ).onBeforeUpdate({
        query: { _id: GLOBAL_RUNNING },
        data: { endsAt: THIS_MINUTE },
        props: member([Permission.OnCallMember], {
          labelIds: [new ObjectID("7899aaaa-0000-4000-8000-0000000000e1")],
        }),
      }),
    );

    expect(refusal.message).toBe(GLOBAL_USER_OVERRIDE_EDIT_REFUSAL);
    expect(refusal).toBeInstanceOf(NotAuthorizedException);
  });
});

describe("End Now on an override that overlapped another before the rule", () => {
  // Kim covered by Carol on the policy from 10:00 to 15:00: overlaps RUNNING.
  const OVERLAPPING: string = "7899aaaa-0000-4000-8000-0000000000f1";

  beforeEach(() => {
    table.rows.push(
      row({
        id: OVERLAPPING,
        away: KIM,
        cover: CAROL,
        policy: POLICY,
        from: "2026-11-13T10:00:00.000Z",
        until: "2026-11-13T15:00:00.000Z",
      }),
    );
  });

  test("ends it, though its shorter times still overlap the other: it adds no time", async () => {
    await endNow(RUNNING);

    expect(storedEnd(RUNNING)).toBe(THIS_MINUTE.toISOString());
  });

  test("ends the other one too", async () => {
    await endNow(OVERLAPPING);

    expect(storedEnd(OVERLAPPING)).toBe(THIS_MINUTE.toISOString());
  });
});
