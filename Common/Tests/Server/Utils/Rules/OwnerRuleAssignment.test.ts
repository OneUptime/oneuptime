import MonitorOwnerTeam from "../../../../Models/DatabaseModels/MonitorOwnerTeam";
import MonitorOwnerUser from "../../../../Models/DatabaseModels/MonitorOwnerUser";
import ObjectID from "../../../../Types/ObjectID";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import OwnerRuleAssignment, {
  OwnersToAssign,
} from "../../../../Server/Utils/Rules/OwnerRuleAssignment";
import { describe, expect, it } from "@jest/globals";

/*
 * Contract under test - owner rules never create a second owner row for a user
 * or team that already owns the resource.
 *
 * Owner rows have no unique constraint, so a duplicate is not an error: it is
 * an owner listed twice and notified twice. A rule run meets existing owners
 * on nearly every resource it touches, which is why this filter sits in front
 * of every owner rule engine.
 */

const MONITOR_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const USER_A: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const USER_B: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const TEAM_A: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const TEAM_B: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");

function ownerUser(userId: ObjectID): MonitorOwnerUser {
  const row: MonitorOwnerUser = new MonitorOwnerUser();
  row.userId = userId;
  row.monitorId = MONITOR_ID;
  return row;
}

function ownerTeam(teamId: ObjectID): MonitorOwnerTeam {
  const row: MonitorOwnerTeam = new MonitorOwnerTeam();
  row.teamId = teamId;
  row.monitorId = MONITOR_ID;
  return row;
}

interface FakeServices {
  ownerUserService: DatabaseService<MonitorOwnerUser>;
  ownerTeamService: DatabaseService<MonitorOwnerTeam>;
  userFindBy: jest.Mock;
  teamFindBy: jest.Mock;
}

function fakeServices(data: {
  existingUsers?: Array<MonitorOwnerUser>;
  existingTeams?: Array<MonitorOwnerTeam>;
}): FakeServices {
  const userFindBy: jest.Mock = jest.fn(async () => {
    return data.existingUsers || [];
  });
  const teamFindBy: jest.Mock = jest.fn(async () => {
    return data.existingTeams || [];
  });

  return {
    ownerUserService: {
      findBy: userFindBy,
    } as unknown as DatabaseService<MonitorOwnerUser>,
    ownerTeamService: {
      findBy: teamFindBy,
    } as unknown as DatabaseService<MonitorOwnerTeam>,
    userFindBy: userFindBy,
    teamFindBy: teamFindBy,
  };
}

function ids(values: Array<ObjectID>): Array<string> {
  return values.map((value: ObjectID): string => {
    return value.toString();
  });
}

describe("OwnerRuleAssignment.getOwnersNotYetAssigned", () => {
  it("drops users and teams that already own the resource", async () => {
    const services: FakeServices = fakeServices({
      existingUsers: [ownerUser(USER_A)],
      existingTeams: [ownerTeam(TEAM_B)],
    });

    const result: OwnersToAssign =
      await OwnerRuleAssignment.getOwnersNotYetAssigned({
        ownerUserService: services.ownerUserService,
        ownerTeamService: services.ownerTeamService,
        resourceIdColumn: "monitorId",
        resourceId: MONITOR_ID,
        userIds: [USER_A, USER_B],
        teamIds: [TEAM_A, TEAM_B],
      });

    expect(ids(result.userIds)).toEqual([USER_B.toString()]);
    expect(ids(result.teamIds)).toEqual([TEAM_A.toString()]);
  });

  it("asks only about this resource and these owners, by the given column", async () => {
    const services: FakeServices = fakeServices({});

    await OwnerRuleAssignment.getOwnersNotYetAssigned({
      ownerUserService: services.ownerUserService,
      ownerTeamService: services.ownerTeamService,
      resourceIdColumn: "monitorId",
      resourceId: MONITOR_ID,
      userIds: [USER_A],
      teamIds: [TEAM_A],
    });

    const userQuery: Record<string, unknown> = (
      services.userFindBy.mock.calls[0]![0] as {
        query: Record<string, unknown>;
      }
    ).query;
    const teamQuery: Record<string, unknown> = (
      services.teamFindBy.mock.calls[0]![0] as {
        query: Record<string, unknown>;
      }
    ).query;

    expect(Object.keys(userQuery).sort()).toEqual(["monitorId", "userId"]);
    expect(String(userQuery["monitorId"])).toBe(MONITOR_ID.toString());
    expect(Object.keys(teamQuery).sort()).toEqual(["monitorId", "teamId"]);
  });

  it("collapses duplicates and blanks in its input", async () => {
    const services: FakeServices = fakeServices({});

    const result: OwnersToAssign =
      await OwnerRuleAssignment.getOwnersNotYetAssigned({
        ownerUserService: services.ownerUserService,
        ownerTeamService: services.ownerTeamService,
        resourceIdColumn: "monitorId",
        resourceId: MONITOR_ID,
        userIds: [USER_A, USER_A.toString(), ""],
        teamIds: [TEAM_A, TEAM_A],
      });

    expect(ids(result.userIds)).toEqual([USER_A.toString()]);
    expect(ids(result.teamIds)).toEqual([TEAM_A.toString()]);
  });

  it("does not query for an empty owner set", async () => {
    const services: FakeServices = fakeServices({});

    const result: OwnersToAssign =
      await OwnerRuleAssignment.getOwnersNotYetAssigned({
        ownerUserService: services.ownerUserService,
        ownerTeamService: services.ownerTeamService,
        resourceIdColumn: "monitorId",
        resourceId: MONITOR_ID,
        userIds: [],
        teamIds: [TEAM_A],
      });

    expect(services.userFindBy).not.toHaveBeenCalled();
    expect(services.teamFindBy).toHaveBeenCalledTimes(1);
    expect(result.userIds).toEqual([]);
  });

  it("returns everything when nobody owns the resource yet", async () => {
    const services: FakeServices = fakeServices({});

    const result: OwnersToAssign =
      await OwnerRuleAssignment.getOwnersNotYetAssigned({
        ownerUserService: services.ownerUserService,
        ownerTeamService: services.ownerTeamService,
        resourceIdColumn: "monitorId",
        resourceId: MONITOR_ID,
        userIds: [USER_A, USER_B],
        teamIds: [],
      });

    expect(ids(result.userIds)).toEqual([USER_A.toString(), USER_B.toString()]);
  });
});
