import OnCallDutyPolicyUserOverride from "../../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import DatabaseService from "../../../Server/Services/DatabaseService";
import OnCallDutyPolicyEscalationRuleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyFeedService from "../../../Server/Services/OnCallDutyPolicyFeedService";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import OnCallDutyPolicyUserOverrideService, {
  USER_OVERRIDE_TIMES_LIMIT_NAME,
} from "../../../Server/Services/OnCallDutyPolicyUserOverrideService";
import UserService from "../../../Server/Services/UserService";
import ProjectLimitLock from "../../../Server/Utils/Database/ProjectLimitLock";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import Timezone from "../../../Types/Timezone";
import FeedMarkdown from "../../../Utils/Markdown/FeedMarkdown";
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
  FakeDb,
  emptyDb,
  installFakeDb,
  makeLayer,
  makeLayerUser,
  makeOverride,
  makeSchedule,
  oid,
} from "../Utils/OnCall/OnCallResolverTestHarness";
import { rotation } from "../../Types/OnCallDutyPolicy/CalendarFeedTestFixtures";
import EventInterval from "../../../Types/Events/EventInterval";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ONE PERSON'S OVERRIDES MAY NOT OVERLAP IN ONE SCOPE (issue #7630).
 *
 * "Override 1: User A is covered by User B from 1:00 PM to 5:00 PM.
 *  Override 2: User A is covered by User C from 3:00 PM to 4:00 PM.
 *  --> Both overrides are successfully created and overlap in the
 *  schedule. [...] It is unclear who the system will actually page during
 *  the overlapping hours."
 *
 * Now the server refuses an override - added, or with its times changed -
 * that overlaps another override of the same person in the same scope:
 * both on one policy, or both global. It names the one it overlaps, in the
 * caller's time zone, and says what to do. Back to back is fine, and so is
 * a policy's own override over a global one: on its policy, the policy's
 * own is used. The add, or the edit, is decided in the transaction that
 * writes it, under the project's lock on override times
 * (ProjectLimitLock), so two that would overlap cannot both pass.
 *
 * These run the whole add and edit through the real service as a member
 * of the project, with the override table in memory. The lock itself, with
 * creates and edits racing on a real Postgres, is held in
 * UserOverrideOverlapPostgres.
 *
 * And overlaps saved before the rule: paging and the schedules pick the
 * same one of them - the one that names who covers over a skip, then the
 * one that starts first, then the one added first.
 */

jest.mock("../../../Server/Utils/Logger");

const PROJECT: string = "7630aaaa-0000-4000-8000-000000000001";
const OTHER_PROJECT: string = "7630aaaa-0000-4000-8000-000000000002";
const POLICY: string = "7630aaaa-0000-4000-8000-0000000000b1";
const OTHER_POLICY: string = "7630aaaa-0000-4000-8000-0000000000b2";

const JANE: string = "7630aaaa-0000-4000-8000-0000000000c1";
const BOB: string = "7630aaaa-0000-4000-8000-0000000000c2";
const CAROL: string = "7630aaaa-0000-4000-8000-0000000000c3";
const KIM: string = "7630aaaa-0000-4000-8000-0000000000c4";
// Known by email alone.
const PAT: string = "7630aaaa-0000-4000-8000-0000000000c5";
// No longer a user at all.
const GONE: string = "7630aaaa-0000-4000-8000-0000000000c6";
// Reads times in India.
const ASHA: string = "7630aaaa-0000-4000-8000-0000000000c7";

const USERS: Array<StoredRow> = [
  { _id: JANE, name: "Jane Doe", timezone: "UTC" },
  { _id: BOB, name: "Bob Lee", timezone: "UTC" },
  { _id: CAROL, name: "Carol Ng", timezone: "UTC" },
  { _id: KIM, name: "Kim Ito", timezone: "UTC" },
  { _id: PAT, email: "pat@example.com" },
  { _id: ASHA, name: "Asha Rao", timezone: "Asia/Kolkata" },
];

const NOW: Date = new Date("2026-11-13T10:00:00.000Z");

// "13:00" today, or a whole ISO time.
const at: (time: string) => Date = (time: string): Date => {
  return new Date(time.includes("T") ? time : `2026-11-13T${time}:00.000Z`);
};

// Jane covered by Bob from 1:00 PM to 5:00 PM today, on the policy: the issue's Override 1.
const JANE_BY_BOB: string = "7630aaaa-0000-4000-8000-0000000000d1";

let table: InMemoryTable;
let limit: LimitTransactions;

const savedRow: (data: {
  id: string;
  away?: string | undefined;
  cover?: string | null | undefined;
  policy?: string | null | undefined;
  project?: string | undefined;
  from: string;
  until: string;
  addedAt?: string | undefined;
}) => StoredRow = (data: {
  id: string;
  away?: string | undefined;
  cover?: string | null | undefined;
  policy?: string | null | undefined;
  project?: string | undefined;
  from: string;
  until: string;
  addedAt?: string | undefined;
}): StoredRow => {
  return {
    _id: data.id,
    projectId: data.project || PROJECT,
    onCallDutyPolicyId: data.policy === undefined ? POLICY : data.policy,
    overrideUserId: data.away || JANE,
    routeAlertsToUserId: data.cover === undefined ? BOB : data.cover,
    startsAt: at(data.from),
    endsAt: at(data.until),
    createdAt: at(data.addedAt || "2026-11-01T09:00"),
    version: 1,
  };
};

const member: (userId?: string) => DatabaseCommonInteractionProps = (
  userId?: string,
): DatabaseCommonInteractionProps => {
  const props: DatabaseCommonInteractionProps = {
    ...customDomainCaller({
      permissions: [Permission.OnCallMember],
      projectId: new ObjectID(PROJECT),
    }),
    ...ON_HIGHEST_PLAN,
  };

  if (userId) {
    props.userId = new ObjectID(userId);
  }

  return props;
};

const add: (data: {
  away?: string | undefined;
  cover?: string | null | undefined;
  policy?: string | null | undefined;
  from: string;
  until: string;
  props?: DatabaseCommonInteractionProps | undefined;
}) => Promise<OnCallDutyPolicyUserOverride> = async (data: {
  away?: string | undefined;
  cover?: string | null | undefined;
  policy?: string | null | undefined;
  from: string;
  until: string;
  props?: DatabaseCommonInteractionProps | undefined;
}): Promise<OnCallDutyPolicyUserOverride> => {
  const override: OnCallDutyPolicyUserOverride =
    new OnCallDutyPolicyUserOverride();
  override.projectId = new ObjectID(PROJECT);
  override.overrideUserId = new ObjectID(data.away || JANE);

  const cover: string | null = data.cover === undefined ? CAROL : data.cover;

  if (cover) {
    override.routeAlertsToUserId = new ObjectID(cover);
  }

  const policy: string | null =
    data.policy === undefined ? POLICY : data.policy;

  if (policy) {
    override.onCallDutyPolicyId = new ObjectID(policy);
  }

  override.startsAt = at(data.from);
  override.endsAt = at(data.until);

  return await OnCallDutyPolicyUserOverrideService.create({
    data: override,
    props: data.props || member(),
  });
};

const edit: (
  id: string,
  data: Record<string, unknown>,
) => Promise<void> = async (
  id: string,
  data: Record<string, unknown>,
): Promise<void> => {
  await OnCallDutyPolicyUserOverrideService.updateOneById({
    id: new ObjectID(id),
    data: data as never,
    props: member(),
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

  throw new Error("Expected it to be refused, but it went through.");
};

// A time as the refusal says it: in the caller's zone, UTC for a caller without one.
const said: (time: string, timezone?: Timezone) => string = (
  time: string,
  timezone?: Timezone,
): string => {
  return OneUptimeDate.getDateAsFormattedStringInTimezone({
    date: at(time),
    timezone: timezone || Timezone.UTC,
  });
};

const ISSUE_REFUSAL: string = `Jane Doe is already covered by Bob Lee on this policy from ${said("13:00")} to ${said("17:00")}. Change the times, or edit that override.`;

describe("through the service", () => {
  beforeEach(() => {
    stubProjectDirectory({});
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);

    // The caller reads every policy: the parent an override is read through.
    jest
      .spyOn(
        DatabaseService as unknown as {
          findReadableParentIds: (data: {
            ids: Array<string>;
          }) => Promise<Array<string>>;
        },
        "findReadableParentIds",
      )
      .mockImplementation(
        async (data: { ids: Array<string> }): Promise<Array<string>> => {
          return [...data.ids];
        },
      );

    table = useInMemoryTable(OnCallDutyPolicyUserOverrideService, [
      savedRow({ id: JANE_BY_BOB, from: "13:00", until: "17:00" }),
    ]);
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
      .mockResolvedValue(FeedMarkdown.asMarkdown("a person"));
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

  describe("adding one that overlaps another of the same person, in the same scope, is refused", () => {
    test("the issue's case: Jane covered by Carol from 3:00 PM to 4:00 PM, inside Bob's 1:00 PM to 5:00 PM", async () => {
      const refusal: Error = await refusalOf(
        add({ cover: CAROL, from: "15:00", until: "16:00" }),
      );

      expect(refusal).toBeInstanceOf(BadDataException);
      expect(refusal.message).toBe(ISSUE_REFUSAL);
      // Nothing saved, nothing said in the feed.
      expect(table.inserts).toHaveLength(0);
      expect(
        OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem,
      ).not.toHaveBeenCalled();
    });

    test.each([
      ["one around it", "12:00", "18:00"],
      ["one that ends inside it", "12:00", "13:01"],
      ["one that starts inside it", "16:59", "19:00"],
      ["one at the very same times", "13:00", "17:00"],
    ])("%s", async (_how: string, from: string, until: string) => {
      const refusal: Error = await refusalOf(add({ from, until }));

      expect(refusal.message).toBe(ISSUE_REFUSAL);
      expect(table.inserts).toHaveLength(0);
    });

    test("a skip at the same time: whoever covers, it is still Jane away twice", async () => {
      const refusal: Error = await refusalOf(
        add({ cover: null, from: "14:00", until: "15:00" }),
      );

      expect(refusal.message).toBe(ISSUE_REFUSAL);
    });

    test("one that names who covers, over a skip: the refusal says the rotation covers in that one", async () => {
      table.rows.push(
        savedRow({
          id: "7630aaaa-0000-4000-8000-0000000000d2",
          away: KIM,
          cover: null,
          from: "13:00",
          until: "17:00",
        }),
      );

      const refusal: Error = await refusalOf(
        add({ away: KIM, cover: BOB, from: "14:00", until: "15:00" }),
      );

      expect(refusal.message).toBe(
        `Kim Ito is already away on this policy from ${said("13:00")} to ${said("17:00")}, with the next person in the rotation covering. Change the times, or edit that override.`,
      );
    });

    test("two global ones: the refusal says it applies on every policy", async () => {
      await add({
        policy: null,
        from: "2026-11-20T00:00",
        until: "2026-11-21T00:00",
      });

      const refusal: Error = await refusalOf(
        add({
          policy: null,
          cover: BOB,
          from: "2026-11-20T12:00",
          until: "2026-11-22T00:00",
        }),
      );

      expect(refusal.message).toBe(
        `Jane Doe is already covered by Carol Ng on every policy from ${said("2026-11-20T00:00")} to ${said("2026-11-21T00:00")}. Change the times, or edit that override.`,
      );
      expect(table.inserts).toHaveLength(1);
    });

    test("with the person away written in another case, it is still the same person", async () => {
      const refusal: Error = await refusalOf(
        add({ away: JANE.toUpperCase(), from: "15:00", until: "16:00" }),
      );

      expect(refusal.message).toBe(ISSUE_REFUSAL);
    });

    test("an override that has ended still counts: two can't say different things about the same past hour", async () => {
      table.rows.push(
        savedRow({
          id: "7630aaaa-0000-4000-8000-0000000000d3",
          from: "2026-11-12T09:00",
          until: "2026-11-12T17:00",
        }),
      );

      await expect(
        add({ from: "2026-11-12T16:00", until: "2026-11-12T18:00" }),
      ).rejects.toThrow(BadDataException);
    });
  });

  describe("adding one that does not overlap goes through", () => {
    test.each([
      ["back to back, after it", "17:00", "19:00"],
      ["back to back, before it", "11:00", "13:00"],
    ])("%s", async (_how: string, from: string, until: string) => {
      await add({ from, until });

      expect(table.inserts).toHaveLength(1);
    });

    test("the same times on another policy", async () => {
      await add({ policy: OTHER_POLICY, from: "15:00", until: "16:00" });

      expect(table.inserts).toHaveLength(1);
    });

    test("a global one over the policy's own: on that policy, the policy's own is used", async () => {
      await add({ policy: null, from: "15:00", until: "16:00" });

      expect(table.inserts).toHaveLength(1);
    });

    test("somebody else away at the same times", async () => {
      await add({ away: KIM, from: "15:00", until: "16:00" });

      expect(table.inserts).toHaveLength(1);
    });

    test("the same person, the same times, in another project", async () => {
      table.rows.splice(0, table.rows.length);
      table.rows.push(
        savedRow({
          id: JANE_BY_BOB,
          project: OTHER_PROJECT,
          from: "13:00",
          until: "17:00",
        }),
      );

      await add({ from: "15:00", until: "16:00" });

      expect(table.inserts).toHaveLength(1);
    });
  });

  describe("the refusal names the one it overlaps as the caller reads it", () => {
    test("in the caller's own time zone", async () => {
      const refusal: Error = await refusalOf(
        add({ from: "15:00", until: "16:00", props: member(ASHA) }),
      );

      expect(refusal.message).toBe(
        `Jane Doe is already covered by Bob Lee on this policy from ${said("13:00", Timezone.AsiaKolkata)} to ${said("17:00", Timezone.AsiaKolkata)}. Change the times, or edit that override.`,
      );
      expect(said("13:00", Timezone.AsiaKolkata)).not.toBe(said("13:00"));
    });

    test("in UTC for an API key, which has none", async () => {
      const props: DatabaseCommonInteractionProps = {
        ...customDomainCaller({
          permissions: [Permission.OnCallMember],
          projectId: new ObjectID(PROJECT),
          isApiKey: true,
        }),
        ...ON_HIGHEST_PLAN,
      };

      const refusal: Error = await refusalOf(
        add({ from: "15:00", until: "16:00", props }),
      );

      expect(refusal.message).toBe(ISSUE_REFUSAL);
    });

    test("by email for someone without a name, and as someone else for a person who is gone", async () => {
      table.rows.push(
        savedRow({
          id: "7630aaaa-0000-4000-8000-0000000000d4",
          away: PAT,
          cover: GONE,
          from: "13:00",
          until: "17:00",
        }),
      );

      const refusal: Error = await refusalOf(
        add({ away: PAT, from: "15:00", until: "16:00" }),
      );

      expect(refusal.message).toBe(
        `pat@example.com is already covered by Someone else on this policy from ${said("13:00")} to ${said("17:00")}. Change the times, or edit that override.`,
      );
    });

    test("where it overlaps two saved before the rule, it names the one that starts first", async () => {
      table.rows.push(
        savedRow({
          id: "7630aaaa-0000-4000-8000-0000000000d5",
          cover: KIM,
          from: "12:00",
          until: "14:00",
          addedAt: "2026-11-02T09:00",
        }),
      );

      const refusal: Error = await refusalOf(
        add({ from: "13:30", until: "16:00" }),
      );

      expect(refusal.message).toBe(
        `Jane Doe is already covered by Kim Ito on this policy from ${said("12:00")} to ${said("14:00")}. Change the times, or edit that override.`,
      );
    });

    test("where a skip that starts first and one that names who covers are both in the way, it names the one that covers: the one used there, as the dialog names it", async () => {
      // Saved before the rule: a skip of Jane from 12:00 PM, into Bob's 1:00 PM to 5:00 PM.
      table.rows.push(
        savedRow({
          id: "7630aaaa-0000-4000-8000-0000000000d6",
          cover: null,
          from: "12:00",
          until: "14:00",
          addedAt: "2026-11-02T09:00",
        }),
      );

      const refusal: Error = await refusalOf(
        add({ from: "13:30", until: "16:00" }),
      );

      expect(refusal.message).toBe(ISSUE_REFUSAL);
      expect(table.inserts).toHaveLength(0);
    });
  });

  describe("an add is decided under the project's lock on override times", () => {
    test("it takes the lock, reads Jane's other overrides in that transaction, then saves", async () => {
      const run: ReturnType<typeof jest.spyOn> = jest.spyOn(
        ProjectLimitLock,
        "run",
      );

      await add({ from: "17:00", until: "19:00" });

      expect(run).toHaveBeenCalledTimes(1);

      const lockedOn: { limitName: string; projectId: ObjectID } = run.mock
        .calls[0]![0] as { limitName: string; projectId: ObjectID };

      expect(lockedOn.limitName).toBe(USER_OVERRIDE_TIMES_LIMIT_NAME);
      expect(lockedOn.projectId.toString().toLowerCase()).toBe(PROJECT);
      expect(limit.events).toEqual([
        "lock",
        "find OnCallDutyPolicyUserOverride",
        "save OnCallDutyPolicyUserOverride",
      ]);
    });

    test("a refused add reads who is named, for the refusal, and saves nothing", async () => {
      await refusalOf(add({ from: "15:00", until: "16:00" }));

      expect(limit.events).toEqual([
        "lock",
        "find OnCallDutyPolicyUserOverride",
        "find User",
      ]);
    });
  });

  describe("moving an override's times onto another of the same person is refused", () => {
    const LATER: string = "7630aaaa-0000-4000-8000-0000000000e1";

    beforeEach(() => {
      // Jane covered by Kim from 6:00 PM to 8:00 PM.
      table.rows.push(
        savedRow({ id: LATER, cover: KIM, from: "18:00", until: "20:00" }),
      );
    });

    test("its end, into the next one", async () => {
      const refusal: Error = await refusalOf(
        edit(JANE_BY_BOB, { endsAt: at("19:00") }),
      );

      expect(refusal.message).toBe(
        `Jane Doe is already covered by Kim Ito on this policy from ${said("18:00")} to ${said("20:00")}. Change the times, or edit that override.`,
      );
      expect(
        OneUptimeDate.fromString(
          table.get(JANE_BY_BOB)!["endsAt"] as Date,
        ).toISOString(),
      ).toBe(at("17:00").toISOString());
    });

    test("its start, back into the one before", async () => {
      const refusal: Error = await refusalOf(
        edit(LATER, { startsAt: at("16:00") }),
      );

      expect(refusal.message).toBe(ISSUE_REFUSAL);
    });

    test("its end, up to the next one's start, is back to back and goes through", async () => {
      await edit(JANE_BY_BOB, { endsAt: at("18:00") });

      expect(
        OneUptimeDate.fromString(
          table.get(JANE_BY_BOB)!["endsAt"] as Date,
        ).toISOString(),
      ).toBe(at("18:00").toISOString());
      expect(limit.events).toEqual([
        "lock",
        "find OnCallDutyPolicyUserOverride",
        "find OnCallDutyPolicyUserOverride",
        "update OnCallDutyPolicyUserOverride",
      ]);
    });

    test("an override never overlaps itself: it moves over its own times", async () => {
      await edit(JANE_BY_BOB, { startsAt: at("14:00"), endsAt: at("17:30") });

      expect(
        OneUptimeDate.fromString(
          table.get(JANE_BY_BOB)!["startsAt"] as Date,
        ).toISOString(),
      ).toBe(at("14:00").toISOString());
    });

    test("a global one moves over the policy's own: it is the other scope", async () => {
      const GLOBAL: string = "7630aaaa-0000-4000-8000-0000000000e2";

      table.rows.push(
        savedRow({
          id: GLOBAL,
          policy: null,
          from: "2026-11-14T09:00",
          until: "2026-11-14T10:00",
        }),
      );

      await edit(GLOBAL, { startsAt: at("12:00"), endsAt: at("21:00") });

      expect(
        OneUptimeDate.fromString(
          table.get(GLOBAL)!["startsAt"] as Date,
        ).toISOString(),
      ).toBe(at("12:00").toISOString());
    });
  });

  describe("two saved before the rule that overlap", () => {
    const OVERLAPPING: string = "7630aaaa-0000-4000-8000-0000000000f1";

    beforeEach(() => {
      // Jane covered by Carol from 3:00 PM to 7:00 PM, saved before the rule.
      table.rows.push(
        savedRow({
          id: OVERLAPPING,
          cover: CAROL,
          from: "15:00",
          until: "19:00",
        }),
      );
    });

    test("who covers still changes: that makes no overlap", async () => {
      await edit(OVERLAPPING, { routeAlertsToUserId: new ObjectID(KIM) });

      expect(String(table.get(OVERLAPPING)!["routeAlertsToUserId"])).toBe(KIM);
    });

    test("times that keep the overlap are refused", async () => {
      const refusal: Error = await refusalOf(
        edit(OVERLAPPING, { endsAt: at("20:00") }),
      );

      expect(refusal.message).toBe(ISSUE_REFUSAL);
    });

    test("times that end the overlap go through", async () => {
      await edit(OVERLAPPING, { startsAt: at("17:00") });

      expect(
        OneUptimeDate.fromString(
          table.get(OVERLAPPING)!["startsAt"] as Date,
        ).toISOString(),
      ).toBe(at("17:00").toISOString());
    });
  });
});

/*
 * OVERLAPS SAVED BEFORE THE RULE: paging and the schedules pick the same
 * one of them (UserOverrideOverlap.compareUse) - the one that names who
 * covers over a skip, then the one that starts first, then the one added
 * first - whatever order the database hands them back in.
 */
describe("where overrides saved before the rule overlap, paging and the schedule pick the same one", () => {
  const SCHEDULE: string = "7630aaaa-0000-4000-8000-000000000a01";
  const LAYER: string = "7630aaaa-0000-4000-8000-000000000a02";
  const AT_NOON: Date = at("12:00");

  let db: FakeDb;

  // A global override of Jane's, saved before the rule.
  const legacy: (data: {
    id: string;
    cover: string | null;
    from: string;
    addedAt: string;
  }) => StoredRow = (data: {
    id: string;
    cover: string | null;
    from: string;
    addedAt: string;
  }): StoredRow => {
    return {
      ...makeOverride({
        id: data.id,
        projectId: PROJECT,
        overrideUserId: JANE,
        routeAlertsToUserId: data.cover,
        startsAt: at(data.from),
        endsAt: at("18:00"),
      }),
      createdAt: at(data.addedAt),
    };
  };

  // Who covers Jane right now: as paging decides, and as her schedule does.
  const whoCovers: () => Promise<{
    paging: string | null;
    schedule: string;
  }> = async (): Promise<{ paging: string | null; schedule: string }> => {
    const away: { coverUserId: ObjectID | null } | null =
      await OnCallDutyPolicyEscalationRuleService.getAwayOverride({
        userId: oid(JANE),
        projectId: oid(PROJECT),
        at: AT_NOON,
      });

    const onCall: ObjectID | null =
      await OnCallDutyPolicyScheduleService.getCurrentUserIdInSchedule(
        oid(SCHEDULE),
        {},
      );

    return {
      paging: away?.coverUserId ? away.coverUserId.toString() : null,
      schedule: onCall ? onCall.toString() : "",
    };
  };

  beforeEach(() => {
    db = emptyDb();

    // Jane is on call all day.
    db.schedules.push(
      makeSchedule({ id: SCHEDULE, projectId: PROJECT, timezone: "UTC" }),
    );
    db.layers.push(
      makeLayer({
        id: LAYER,
        scheduleId: SCHEDULE,
        projectId: PROJECT,
        startsAt: at("2026-01-01T00:00"),
        handOffTime: at("2026-01-01T09:00"),
        rotation: rotation(EventInterval.Day, 1),
      }),
    );
    db.layerUsers.push(
      makeLayerUser({
        id: "7630aaaa-0000-4000-8000-000000000a03",
        scheduleId: SCHEDULE,
        layerId: LAYER,
        projectId: PROJECT,
        userId: JANE,
      }),
    );

    installFakeDb(db);
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(AT_NOON);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the one that starts first", async () => {
    db.overrides.push(
      legacy({
        id: "7630aaaa-0000-4000-8000-000000000a11",
        cover: CAROL,
        from: "09:00",
        addedAt: "2026-11-01T09:00",
      }),
      legacy({
        id: "7630aaaa-0000-4000-8000-000000000a12",
        cover: BOB,
        from: "08:00",
        addedAt: "2026-11-02T09:00",
      }),
    );

    await expect(whoCovers()).resolves.toEqual({
      paging: BOB,
      schedule: BOB,
    });
  });

  test("of two that start together, the one added first - whichever the database hands back first", async () => {
    const addedSecond: StoredRow = legacy({
      id: "7630aaaa-0000-4000-8000-000000000a21",
      cover: BOB,
      from: "08:00",
      addedAt: "2026-11-02T09:00",
    });
    const addedFirst: StoredRow = legacy({
      id: "7630aaaa-0000-4000-8000-000000000a22",
      cover: CAROL,
      from: "08:00",
      addedAt: "2026-11-01T09:00",
    });

    db.overrides.push(addedSecond, addedFirst);

    await expect(whoCovers()).resolves.toEqual({
      paging: CAROL,
      schedule: CAROL,
    });

    db.overrides.reverse();

    await expect(whoCovers()).resolves.toEqual({
      paging: CAROL,
      schedule: CAROL,
    });
  });

  test("one that names who covers over a skip, even one that starts later", async () => {
    db.overrides.push(
      legacy({
        id: "7630aaaa-0000-4000-8000-000000000a31",
        cover: null,
        from: "08:00",
        addedAt: "2026-11-01T09:00",
      }),
      legacy({
        id: "7630aaaa-0000-4000-8000-000000000a32",
        cover: BOB,
        from: "11:00",
        addedAt: "2026-11-02T09:00",
      }),
    );

    expect((await whoCovers()).paging).toBe(BOB);
  });
});
