import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import CreatorTeams from "../../../../Server/Utils/Rules/CreatorTeams";
import ObjectID from "../../../../Types/ObjectID";
/*
 * jest itself is the global one: @jest/globals types spyOn and fn as mocks
 * the global jest.SpiedFunction annotations here do not accept.
 */
import { afterEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test - the creator's team an incident or alert owner rule
 * adds (Server/Utils/Rules/CreatorTeams).
 *
 * Of the teams a rule lists under Creator's Team, the ones the person who
 * created the event is an accepted member of, in the event's project. Not
 * "every team of the creator": people are in the project's Members team by
 * default, so that would make everyone an owner. An event a monitor, a
 * workflow or an API key creates has no creator, and gets no team.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const CREATOR_ID: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-000000000001",
);
const PLATFORM: string = "30000000-0000-4000-8000-00000000000a";
const SRE: string = "30000000-0000-4000-8000-00000000000b";
const PAYMENTS: string = "30000000-0000-4000-8000-00000000000c";
const MEMBERS: string = "30000000-0000-4000-8000-00000000000d";

function listed(...teamIds: Array<string>): Array<{ id: ObjectID }> {
  return teamIds.map((teamId: string): { id: ObjectID } => {
    return { id: new ObjectID(teamId) };
  });
}

function memberOf(
  ...teamIds: Array<string>
): jest.SpiedFunction<typeof TeamMemberService.getTeamIdsForUser> {
  return jest.spyOn(TeamMemberService, "getTeamIdsForUser").mockResolvedValue(
    teamIds.map((teamId: string): ObjectID => {
      return new ObjectID(teamId);
    }),
  );
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("CreatorTeams", () => {
  const creatorTeams: () => CreatorTeams = (): CreatorTeams => {
    return new CreatorTeams({
      projectId: PROJECT_ID,
      creatorUserId: CREATOR_ID,
    });
  };

  it("picks nothing for a creator in none of the teams listed", async () => {
    memberOf(MEMBERS);

    expect(await creatorTeams().pick(listed(PLATFORM, SRE))).toEqual([]);
  });

  it("picks the one team listed the creator is in", async () => {
    memberOf(MEMBERS, SRE);

    expect(await creatorTeams().pick(listed(PLATFORM, SRE))).toEqual([SRE]);
  });

  it("picks every team listed the creator is in, in the rule's order", async () => {
    memberOf(SRE, MEMBERS, PLATFORM);

    expect(await creatorTeams().pick(listed(PLATFORM, PAYMENTS, SRE))).toEqual([
      PLATFORM,
      SRE,
    ]);
  });

  // Never Members because it is a team of theirs: only the teams listed.
  it("never picks a team of the creator's the rule does not list", async () => {
    memberOf(MEMBERS, PLATFORM);

    expect(await creatorTeams().pick(listed(PLATFORM))).toEqual([PLATFORM]);
  });

  it("reads the creator's membership in the event's project", async () => {
    const read: jest.SpiedFunction<typeof TeamMemberService.getTeamIdsForUser> =
      memberOf(PLATFORM);

    await creatorTeams().pick(listed(PLATFORM));

    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0]![0].toString()).toBe(CREATOR_ID.toString());
    expect(read.mock.calls[0]![1].toString()).toBe(PROJECT_ID.toString());
  });

  it("reads it once, however many rules ask", async () => {
    const read: jest.SpiedFunction<typeof TeamMemberService.getTeamIdsForUser> =
      memberOf(PLATFORM, SRE);
    const teams: CreatorTeams = creatorTeams();

    expect(await teams.pick(listed(PLATFORM))).toEqual([PLATFORM]);
    expect(await teams.pick(listed(SRE, PAYMENTS))).toEqual([SRE]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("does not read it for a rule that lists no team", async () => {
    const read: jest.SpiedFunction<typeof TeamMemberService.getTeamIdsForUser> =
      memberOf(PLATFORM);

    expect(await creatorTeams().pick([])).toEqual([]);
    expect(await creatorTeams().pick(undefined)).toEqual([]);
    expect(await creatorTeams().pick(null)).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });

  it("compares ids whatever their case", async () => {
    memberOf(PLATFORM.toUpperCase());

    expect(await creatorTeams().pick(listed(PLATFORM))).toEqual([PLATFORM]);
  });

  /*
   * An incident a monitor, a workflow, a form or an API key creates names no
   * creator: the rule still matches, and adds no creator's team.
   */
  it("picks nothing, and reads nothing, for an event with no creator", async () => {
    const read: jest.SpiedFunction<typeof TeamMemberService.getTeamIdsForUser> =
      memberOf(PLATFORM);

    for (const teams of [
      new CreatorTeams({ projectId: PROJECT_ID, creatorUserId: undefined }),
      new CreatorTeams({ projectId: PROJECT_ID, creatorUserId: null }),
      new CreatorTeams({ projectId: undefined, creatorUserId: CREATOR_ID }),
    ]) {
      expect(teams.hasCreator()).toBe(false);
      expect(await teams.pick(listed(PLATFORM))).toEqual([]);
    }

    expect(read).not.toHaveBeenCalled();
    expect(creatorTeams().hasCreator()).toBe(true);
  });
});
