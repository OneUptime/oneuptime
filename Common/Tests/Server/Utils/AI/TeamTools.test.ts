import { QueryTeamsTool } from "../../../../Server/Utils/AI/Toolbox/TeamTools";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import TeamService from "../../../../Server/Services/TeamService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import Team from "../../../../Models/DatabaseModels/Team";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../Models/DatabaseModels/User";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import { JSONObject } from "../../../../Types/JSON";
import Email from "../../../../Types/Email";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * query_teams answers "who is on the platform team?" / "which team should own
 * this?". These tests lock in what the model relies on: the detail mode
 * surfaces member NAMES (emails are redacted by the serializer, so a name is
 * the only member identifier the model can read back), list mode carries a
 * member count per team, tenancy is pinned from ctx (never an argument), and
 * empty results are honest (rowCount 0, no widget).
 */

const ctx: ToolContext = {
  projectId: ObjectID.generate(),
  props: { isRoot: true },
};

const TEAM_ID: ObjectID = ObjectID.generate();

function buildTeam(data?: {
  id?: ObjectID;
  name?: string;
  description?: string;
}): Team {
  const team: Team = new Team();
  team._id = (data?.id ?? TEAM_ID).toString();
  team.name = data?.name ?? "Platform";
  team.description = data?.description ?? "Owns shared infrastructure.";
  return team;
}

function buildMember(data: {
  name: string;
  email: string;
  teamId?: ObjectID;
  hasAcceptedInvitation?: boolean;
}): TeamMember {
  const member: TeamMember = new TeamMember();
  member._id = ObjectID.generate().toString();
  if (data.teamId) {
    member.teamId = data.teamId;
  }
  member.hasAcceptedInvitation = data.hasAcceptedInvitation ?? true;

  const user: User = new User();
  user._id = ObjectID.generate().toString();
  user.name = new Name(data.name);
  user.email = new Email(data.email);
  member.user = user;

  return member;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("query_teams — detail mode", () => {
  test("returns the team's members by name, with emails redacted for the LLM", async () => {
    jest
      .spyOn(TeamService, "findOneById")
      .mockResolvedValue(buildTeam() as never);

    const membersSpy: jest.SpyInstance = jest
      .spyOn(TeamMemberService, "findBy")
      .mockResolvedValue([
        buildMember({ name: "Sam Iyer", email: "sam@acme.com" }),
        buildMember({
          name: "Riya Patel",
          email: "riya@acme.com",
          hasAcceptedInvitation: false,
        }),
      ] as never);

    const result: ToolExecutionResult = await QueryTeamsTool.execute(
      { teamId: TEAM_ID.toString() },
      ctx,
    );

    // One team header row + two member rows.
    expect(result.rowCount).toBe(3);
    expect(result.dataForLlm).toContain("Platform");
    expect(result.dataForLlm).toContain("Sam Iyer");
    expect(result.dataForLlm).toContain("Riya Patel");
    expect(result.dataForLlm).toContain("invited (not yet accepted)");

    // The serializer must strip emails — names are the usable identifier.
    expect(result.dataForLlm).not.toContain("sam@acme.com");
    expect(result.dataForLlm).toContain("[redacted-email]");
    expect(result.redactionCount).toBeGreaterThanOrEqual(2);

    expect(result.citationLabel).toBe('Team "Platform" (2 members)');
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.Teams,
    });
    expect(result.widget).toBeDefined();

    /*
     * teamId is an untrusted model argument, so the member fetch must be
     * pinned to the tenant from ctx and run under the user's own props.
     */
    const callArgs: JSONObject = membersSpy.mock.calls[0]?.[0] as JSONObject;
    const query: JSONObject = callArgs["query"] as JSONObject;
    expect(String(query["teamId"])).toBe(TEAM_ID.toString());
    expect(query["projectId"]).toBe(ctx.projectId);
    expect(callArgs["props"]).toBe(ctx.props);
  });

  test("a missing team is honest: zero rows, no widget", async () => {
    jest.spyOn(TeamService, "findOneById").mockResolvedValue(null as never);
    const membersSpy: jest.SpyInstance = jest
      .spyOn(TeamMemberService, "findBy")
      .mockResolvedValue([] as never);

    const result: ToolExecutionResult = await QueryTeamsTool.execute(
      { teamId: TEAM_ID.toString() },
      ctx,
    );

    expect(result.rowCount).toBe(0);
    expect(result.widget).toBeUndefined();
    // No team, no member fetch.
    expect(membersSpy).not.toHaveBeenCalled();
  });
});

describe("query_teams — list mode", () => {
  test("lists teams with a member count per team", async () => {
    const otherTeamId: ObjectID = ObjectID.generate();

    const teamsSpy: jest.SpyInstance = jest
      .spyOn(TeamService, "findBy")
      .mockResolvedValue([
        buildTeam({ id: TEAM_ID, name: "Platform" }),
        buildTeam({
          id: otherTeamId,
          name: "SRE",
          description: "Runs on-call.",
        }),
      ] as never);
    jest
      .spyOn(TeamService, "countBy")
      .mockResolvedValue(new PositiveNumber(2) as never);

    const membersSpy: jest.SpyInstance = jest
      .spyOn(TeamMemberService, "findBy")
      .mockResolvedValue([
        buildMember({ name: "A", email: "a@x.com", teamId: TEAM_ID }),
        buildMember({ name: "B", email: "b@x.com", teamId: TEAM_ID }),
        buildMember({ name: "C", email: "c@x.com", teamId: TEAM_ID }),
        buildMember({ name: "D", email: "d@x.com", teamId: otherTeamId }),
      ] as never);

    const result: ToolExecutionResult = await QueryTeamsTool.execute({}, ctx);

    expect(result.rowCount).toBe(2);
    expect(result.dataForLlm).toContain("Platform");
    expect(result.dataForLlm).toContain("SRE");
    expect(result.dataForLlm).toContain("memberCount=3");
    expect(result.dataForLlm).toContain("memberCount=1");
    expect(result.citationLabel).toBe("Teams (2 found)");
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.Teams,
    });
    expect(result.widget).toBeDefined();

    // The team query must run under the requesting user's props, never root+.
    const teamCallArgs: JSONObject = teamsSpy.mock.calls[0]?.[0] as JSONObject;
    expect(teamCallArgs["props"]).toBe(ctx.props);
    expect(teamCallArgs["limit"]).toBe(10);

    // The member-count join fetch is pinned to the tenant from ctx.
    const memberCallArgs: JSONObject = membersSpy.mock
      .calls[0]?.[0] as JSONObject;
    const memberQuery: JSONObject = memberCallArgs["query"] as JSONObject;
    expect(memberQuery["projectId"]).toBe(ctx.projectId);
    expect(memberCallArgs["props"]).toBe(ctx.props);
  });

  test("clamps the limit argument", async () => {
    const teamsSpy: jest.SpyInstance = jest
      .spyOn(TeamService, "findBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(TeamService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);

    const result: ToolExecutionResult = await QueryTeamsTool.execute(
      { limit: 999, skip: -5 },
      ctx,
    );

    expect(result.citationLabel).toBe("Teams (0 found)");

    const callArgs: JSONObject = teamsSpy.mock.calls[0]?.[0] as JSONObject;
    expect(callArgs["limit"]).toBe(25);
    expect(callArgs["skip"]).toBe(0);
  });

  test("tells the model when it is looking at one page of a longer list", async () => {
    jest
      .spyOn(TeamService, "findBy")
      .mockResolvedValue([
        buildTeam({ id: TEAM_ID, name: "Platform" }),
        buildTeam({ id: ObjectID.generate(), name: "SRE" }),
      ] as never);
    jest
      .spyOn(TeamService, "countBy")
      .mockResolvedValue(new PositiveNumber(7) as never);
    jest.spyOn(TeamMemberService, "findBy").mockResolvedValue([] as never);

    const result: ToolExecutionResult = await QueryTeamsTool.execute({}, ctx);

    expect(result.dataForLlm).toContain(
      "Showing rows 1–2 of 7 total. Pass skip to page further.",
    );
    expect(result.citationLabel).toBe("Teams (2 of 7)");
  });

  test("an empty project is honest: zero rows and no widget", async () => {
    jest.spyOn(TeamService, "findBy").mockResolvedValue([] as never);
    jest
      .spyOn(TeamService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);
    const membersSpy: jest.SpyInstance = jest
      .spyOn(TeamMemberService, "findBy")
      .mockResolvedValue([] as never);

    const result: ToolExecutionResult = await QueryTeamsTool.execute({}, ctx);

    expect(result.rowCount).toBe(0);
    expect(result.widget).toBeUndefined();
    // No teams on this page — no member-count fetch either.
    expect(membersSpy).not.toHaveBeenCalled();
  });
});

describe("query_teams — permissions", () => {
  test("required permissions derive from the model read ACL", () => {
    expect(QueryTeamsTool.requiredPermissions.length).toBeGreaterThan(0);
  });
});
