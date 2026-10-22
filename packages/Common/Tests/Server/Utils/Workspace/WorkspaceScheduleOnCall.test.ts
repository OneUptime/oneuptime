import OnCallDutyPolicySchedule from "../../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import WorkspaceNotificationRule from "../../../../Models/DatabaseModels/WorkspaceNotificationRule";
import OnCallDutyPolicyScheduleService from "../../../../Server/Services/OnCallDutyPolicyScheduleService";
import WorkspaceScheduleOnCall, {
  ScheduleOnCall,
  ScheduleOnCallPerson,
} from "../../../../Server/Utils/Workspace/WorkspaceScheduleOnCall";
import ObjectID from "../../../../Types/ObjectID";
import IncidentNotificationRule from "../../../../Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

jest.mock("../../../../Server/Utils/Logger");

/*
 * WHO IS ON CALL IN THE SCHEDULES A RULE NAMES.
 *
 * A rule that creates a channel can name on-call schedules: whoever is on
 * call in them when the channel is created joins it, without being paged.
 * "On call" is the schedule's roster - what its page, the on-call user
 * groups and `/oneuptime oncall` say - and only the project's own schedules
 * are read.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();

const PRIMARY: ObjectID = ObjectID.generate();
const SECONDARY: ObjectID = ObjectID.generate();
const DATABASE: ObjectID = ObjectID.generate();
const EMPTY: ObjectID = ObjectID.generate();

const JANE: ObjectID = ObjectID.generate();
const RAJ: ObjectID = ObjectID.generate();

function schedule(
  id: ObjectID,
  name: string,
  onCall: ObjectID | null,
): OnCallDutyPolicySchedule {
  const model: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
  model.id = id;
  model.name = name;

  if (onCall) {
    model.currentUserIdOnRoster = onCall;
  }

  return model;
}

function rule(data: {
  scheduleIds?: Array<ObjectID | string> | undefined;
  createsChannel?: boolean | undefined;
}): WorkspaceNotificationRule {
  const model: WorkspaceNotificationRule = new WorkspaceNotificationRule();
  model.id = ObjectID.generate();

  model.notificationRule = {
    _type: "IncidentNotificationRule",
    shouldCreateNewChannel: data.createsChannel !== false,
    inviteUsersToNewChannel: [],
    inviteTeamsToNewChannel: [],
    inviteOnCallSchedulesToNewChannel: data.scheduleIds as Array<ObjectID>,
  } as unknown as IncidentNotificationRule as never;

  return model;
}

function stubSchedules(
  schedules: Array<OnCallDutyPolicySchedule>,
): SpyInstance<typeof OnCallDutyPolicyScheduleService.findBy> {
  return jest
    .spyOn(OnCallDutyPolicyScheduleService, "findBy")
    .mockResolvedValue(schedules);
}

function onCallOf(people: Array<ScheduleOnCallPerson>): Array<{
  userId: string;
  scheduleNames: Array<string>;
}> {
  return people.map((person: ScheduleOnCallPerson) => {
    return {
      userId: person.userId.toString(),
      scheduleNames: person.scheduleNames,
    };
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("WorkspaceScheduleOnCall.getPeopleOnCall", () => {
  const schedules: Map<string, ScheduleOnCall> = new Map<
    string,
    ScheduleOnCall
  >([
    [
      PRIMARY.toString().toLowerCase(),
      { name: "Payments Primary", userId: JANE },
    ],
    [
      SECONDARY.toString().toLowerCase(),
      { name: "Payments Secondary", userId: RAJ },
    ],
    [DATABASE.toString().toLowerCase(), { name: "Database", userId: JANE }],
    [EMPTY.toString().toLowerCase(), { name: "Weekend", userId: null }],
  ]);

  test("the person on call in each schedule, in the rule's order", () => {
    expect(
      onCallOf(
        WorkspaceScheduleOnCall.getPeopleOnCall({
          scheduleIds: [SECONDARY, PRIMARY],
          schedules: schedules,
        }),
      ),
    ).toEqual([
      { userId: RAJ.toString(), scheduleNames: ["Payments Secondary"] },
      { userId: JANE.toString(), scheduleNames: ["Payments Primary"] },
    ]);
  });

  test("somebody on call in two schedules is there once, with both", () => {
    expect(
      onCallOf(
        WorkspaceScheduleOnCall.getPeopleOnCall({
          scheduleIds: [PRIMARY, SECONDARY, DATABASE],
          schedules: schedules,
        }),
      ),
    ).toEqual([
      {
        userId: JANE.toString(),
        scheduleNames: ["Payments Primary", "Database"],
      },
      { userId: RAJ.toString(), scheduleNames: ["Payments Secondary"] },
    ]);
  });

  test("a schedule nobody is on call in, or one that is not the project's, adds nobody", () => {
    expect(
      WorkspaceScheduleOnCall.getPeopleOnCall({
        scheduleIds: [EMPTY, ObjectID.generate()],
        schedules: schedules,
      }),
    ).toEqual([]);
  });
});

describe("WorkspaceScheduleOnCall.getPeopleOnCallByRule", () => {
  test("every rule's schedules are read in ONE query, of the project's schedules only, with their rosters", async () => {
    const findBy: SpyInstance<typeof OnCallDutyPolicyScheduleService.findBy> =
      stubSchedules([
        schedule(PRIMARY, "Payments Primary", JANE),
        schedule(SECONDARY, "Payments Secondary", RAJ),
      ]);

    const payments: WorkspaceNotificationRule = rule({
      scheduleIds: [PRIMARY.toString(), SECONDARY.toString()],
    });
    const primaryOnly: WorkspaceNotificationRule = rule({
      scheduleIds: [PRIMARY],
    });

    const byRule: Map<
      string,
      Array<ScheduleOnCallPerson>
    > = await WorkspaceScheduleOnCall.getPeopleOnCallByRule({
      projectId: PROJECT_ID,
      notificationRules: [payments, primaryOnly],
    });

    expect(findBy).toHaveBeenCalledTimes(1);

    const query: Record<string, unknown> = findBy.mock.calls[0]![0]
      .query as Record<string, unknown>;

    // Another project's schedule named in a rule is never read.
    expect(query["projectId"]).toEqual(PROJECT_ID);
    expect(findBy.mock.calls[0]![0].select).toMatchObject({
      _id: true,
      name: true,
      currentUserIdOnRoster: true,
    });
    expect(findBy.mock.calls[0]![0].props).toEqual({ isRoot: true });

    expect(onCallOf(byRule.get(payments.id!.toString())!)).toEqual([
      { userId: JANE.toString(), scheduleNames: ["Payments Primary"] },
      { userId: RAJ.toString(), scheduleNames: ["Payments Secondary"] },
    ]);

    expect(onCallOf(byRule.get(primaryOnly.id!.toString())!)).toEqual([
      { userId: JANE.toString(), scheduleNames: ["Payments Primary"] },
    ]);
  });

  test("a schedule the query does not find - deleted, or another project's - adds nobody", async () => {
    stubSchedules([schedule(PRIMARY, "Payments Primary", JANE)]);

    const otherProjects: WorkspaceNotificationRule = rule({
      scheduleIds: [ObjectID.generate()],
    });

    const byRule: Map<
      string,
      Array<ScheduleOnCallPerson>
    > = await WorkspaceScheduleOnCall.getPeopleOnCallByRule({
      projectId: PROJECT_ID,
      notificationRules: [otherProjects],
    });

    expect(byRule.get(otherProjects.id!.toString())).toEqual([]);
  });

  test("rules that name no schedule, or create no channel, read nothing", async () => {
    const findBy: SpyInstance<typeof OnCallDutyPolicyScheduleService.findBy> =
      stubSchedules([]);

    const ruleWithoutSchedules: WorkspaceNotificationRule = rule({});
    const postsOnly: WorkspaceNotificationRule = rule({
      scheduleIds: [PRIMARY],
      createsChannel: false,
    });
    const saved: WorkspaceNotificationRule = new WorkspaceNotificationRule();
    saved.id = ObjectID.generate();

    const byRule: Map<
      string,
      Array<ScheduleOnCallPerson>
    > = await WorkspaceScheduleOnCall.getPeopleOnCallByRule({
      projectId: PROJECT_ID,
      notificationRules: [ruleWithoutSchedules, postsOnly, saved],
    });

    expect(findBy).not.toHaveBeenCalled();
    expect(byRule.size).toBe(0);
  });
});
