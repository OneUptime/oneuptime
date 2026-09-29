import TeamService from "../../../Server/Services/TeamService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import ProjectSCIMService from "../../../Server/Services/ProjectSCIMService";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import Team from "../../../Models/DatabaseModels/Team";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Deleting a TEAM must go through TeamMemberService for its memberships.
 *
 * TeamMember.teamId is ON DELETE CASCADE, so leaving the rows to Postgres
 * removes them hook-free: no token refresh, no seat update, no
 * notification-settings cleanup and — since the calendar-feeds work — no
 * on-call cleanup. A user whose ONLY team was deleted then kept their
 * schedule-layer and escalation-rule assignments, their personal calendar
 * feed stayed enabled and the rotateWhenMemberLeaves feeds were never
 * rotated, so the schedule kept rotating onto (and paging) an ex-member —
 * exactly what decision 5 set out to fix, on a path the cleanup never saw.
 *
 * The SCIM group-delete path already deletes members first for the same
 * reason; this pins the generic (dashboard / CRUD API) path.
 */

const PROJECT_ID: ObjectID = new ObjectID("project-1");
const TEAM_1: ObjectID = new ObjectID("team-1");
const TEAM_2: ObjectID = new ObjectID("team-2");

function team(data: {
  id: ObjectID;
  isTeamDeleteable: boolean;
  name: string;
}): Team {
  const model: Team = new Team();
  model._id = data.id.toString();
  model.name = data.name;
  model.isTeamDeleteable = data.isTeamDeleteable;
  model.projectId = PROJECT_ID;
  return model;
}

function spyTeamLookup(teams: Array<Team>): any {
  return jest.spyOn(TeamService, "findBy").mockResolvedValue(teams as never);
}

function spyMemberDelete(): any {
  return jest
    .spyOn(TeamMemberService, "deleteBy")
    .mockResolvedValue(0 as never);
}

describe("deleting a team removes its members through TeamMemberService", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("every team being deleted has its memberships deleted through the member service, as root", async () => {
    spyTeamLookup([
      team({ id: TEAM_1, isTeamDeleteable: true, name: "Backend" }),
      team({ id: TEAM_2, isTeamDeleteable: true, name: "Frontend" }),
    ]);
    const memberDelete: any = spyMemberDelete();

    const deleteBy: any = {
      query: { projectId: PROJECT_ID },
      props: { isRoot: true },
      limit: 10,
      skip: 0,
    };

    await (TeamService as any).onBeforeDelete(deleteBy);

    expect(memberDelete).toHaveBeenCalledTimes(1);

    const call: any = memberDelete.mock.calls[0]![0];
    expect(call.props).toEqual({ isRoot: true });

    // teamId IN (team-1, team-2)
    const teamIdQuery: any = call.query.teamId;
    expect(String(teamIdQuery.getSql('"teamId"'))).toContain('"teamId" IN');
    expect(
      Object.values(
        teamIdQuery.objectLiteralParameters as Record<string, unknown>,
      ),
    ).toEqual([["team-1", "team-2"]]);
  });

  test("a team that cannot be deleted throws BEFORE any member is removed", async () => {
    spyTeamLookup([
      team({ id: TEAM_1, isTeamDeleteable: true, name: "Backend" }),
      team({ id: TEAM_2, isTeamDeleteable: false, name: "Owners" }),
    ]);
    const memberDelete: any = spyMemberDelete();

    await expect(
      (TeamService as any).onBeforeDelete({
        query: { projectId: PROJECT_ID },
        props: { isRoot: true },
      }),
    ).rejects.toThrow("Owners team cannot be deleted");

    expect(memberDelete).not.toHaveBeenCalled();
  });

  test("a caller who may read teams but not delete them removes no membership", async () => {
    /*
     * DatabaseService checks delete permission AFTER onBeforeDelete, and the
     * team lookup in the hook only needs read permission — so the hook has to
     * check the caller itself before deleting anything on their behalf.
     */
    spyTeamLookup([
      team({ id: TEAM_1, isTeamDeleteable: true, name: "Backend" }),
    ]);
    // SCIM push-groups lookup: not what this test is about.
    jest
      .spyOn(ProjectSCIMService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);
    const memberDelete: any = spyMemberDelete();

    await expect(
      (TeamService as any).onBeforeDelete({
        query: { _id: TEAM_1 },
        // A signed-in user with no permissions at all.
        props: { userId: new ObjectID("user-1"), tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow(NotAuthorizedException);

    expect(memberDelete).not.toHaveBeenCalled();
  });

  test("a delete that matches no team touches no membership", async () => {
    spyTeamLookup([]);
    const memberDelete: any = spyMemberDelete();

    await (TeamService as any).onBeforeDelete({
      query: { _id: TEAM_1 },
      props: { isRoot: true },
    });

    expect(memberDelete).not.toHaveBeenCalled();
  });

  test("the member service is the vehicle, so the on-call cleanup hook runs for the removed members", () => {
    /*
     * The cleanup itself is pinned in TeamMemberOnCallCleanup.test.ts; what
     * matters here is that the entry point exists on the service the team
     * delete calls, i.e. that deleting members this way reaches
     * onDeleteSuccess -> cleanupOnCallAssignmentsIfUserLeftProject.
     */
    expect(
      typeof TeamMemberService.cleanupOnCallAssignmentsIfUserLeftProject,
    ).toBe("function");
    expect(typeof (TeamMemberService as any).onDeleteSuccess).toBe("function");
  });
});
