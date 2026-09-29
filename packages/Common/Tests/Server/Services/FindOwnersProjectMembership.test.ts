import AlertEpisodeOwnerTeamService from "../../../Server/Services/AlertEpisodeOwnerTeamService";
import AlertEpisodeOwnerUserService from "../../../Server/Services/AlertEpisodeOwnerUserService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertOwnerTeamService from "../../../Server/Services/AlertOwnerTeamService";
import AlertOwnerUserService from "../../../Server/Services/AlertOwnerUserService";
import AlertService from "../../../Server/Services/AlertService";
import IncidentEpisodeOwnerTeamService from "../../../Server/Services/IncidentEpisodeOwnerTeamService";
import IncidentEpisodeOwnerUserService from "../../../Server/Services/IncidentEpisodeOwnerUserService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentOwnerTeamService from "../../../Server/Services/IncidentOwnerTeamService";
import IncidentOwnerUserService from "../../../Server/Services/IncidentOwnerUserService";
import IncidentService from "../../../Server/Services/IncidentService";
import MonitorOwnerTeamService from "../../../Server/Services/MonitorOwnerTeamService";
import MonitorOwnerUserService from "../../../Server/Services/MonitorOwnerUserService";
import MonitorService from "../../../Server/Services/MonitorService";
import ScheduledMaintenanceOwnerTeamService from "../../../Server/Services/ScheduledMaintenanceOwnerTeamService";
import ScheduledMaintenanceOwnerUserService from "../../../Server/Services/ScheduledMaintenanceOwnerUserService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import ServiceLevelObjectiveOwnerTeamService from "../../../Server/Services/ServiceLevelObjectiveOwnerTeamService";
import ServiceLevelObjectiveOwnerUserService from "../../../Server/Services/ServiceLevelObjectiveOwnerUserService";
import ServiceLevelObjectiveService from "../../../Server/Services/ServiceLevelObjectiveService";
import StatusPageOwnerTeamService from "../../../Server/Services/StatusPageOwnerTeamService";
import StatusPageOwnerUserService from "../../../Server/Services/StatusPageOwnerUserService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A user removed from the project used to stay a direct owner of its
 * incidents, alerts, monitors, ... findOwners returned them, the owner
 * notification jobs "sent" them a notification that went nowhere (their
 * notification settings were removed with the membership) and still wrote
 * "Owners have been notified ... Notified: <user>" into the feed. When they
 * were the only direct owner, the jobs' fallback to the project owners - which
 * only happens when findOwners returns nobody - never ran.
 *
 * findOwners now returns project members only. Every owner-notification job
 * gets its recipients from it, so the feed lists only people who could be
 * notified and an owner list of ex-members falls back to the project owners.
 */

const PROJECT_ID: ObjectID = new ObjectID("project-1");
const RESOURCE_ID: ObjectID = new ObjectID("resource-1");
const TEAM_ID: ObjectID = new ObjectID("team-1");

const MEMBER_OWNER: string = "user-member";
const DEPARTED_OWNER: string = "user-departed";
const TEAM_MEMBER: string = "user-team-member";
const PENDING_INVITEE: string = "user-pending";

function user(id: string): User {
  const model: User = new User();
  model._id = id;
  return model;
}

interface FindOwnersCase {
  name: string;
  findOwners: (id: ObjectID) => Promise<Array<User>>;
  ownerUserService: any;
  ownerTeamService: any;
  // How the service expands owner teams.
  teamLookup: "getUsersInTeams" | "getUsersInTeam";
}

const CASES: Array<FindOwnersCase> = [
  {
    name: "IncidentService",
    findOwners: (id: ObjectID) => {
      return IncidentService.findOwners(id);
    },
    ownerUserService: IncidentOwnerUserService,
    ownerTeamService: IncidentOwnerTeamService,
    teamLookup: "getUsersInTeams",
  },
  {
    name: "AlertService",
    findOwners: (id: ObjectID) => {
      return AlertService.findOwners(id);
    },
    ownerUserService: AlertOwnerUserService,
    ownerTeamService: AlertOwnerTeamService,
    teamLookup: "getUsersInTeams",
  },
  {
    name: "IncidentEpisodeService",
    findOwners: (id: ObjectID) => {
      return IncidentEpisodeService.findOwners(id);
    },
    ownerUserService: IncidentEpisodeOwnerUserService,
    ownerTeamService: IncidentEpisodeOwnerTeamService,
    teamLookup: "getUsersInTeam",
  },
  {
    name: "AlertEpisodeService",
    findOwners: (id: ObjectID) => {
      return AlertEpisodeService.findOwners(id);
    },
    ownerUserService: AlertEpisodeOwnerUserService,
    ownerTeamService: AlertEpisodeOwnerTeamService,
    teamLookup: "getUsersInTeams",
  },
  {
    name: "ScheduledMaintenanceService",
    findOwners: (id: ObjectID) => {
      return ScheduledMaintenanceService.findOwners(id);
    },
    ownerUserService: ScheduledMaintenanceOwnerUserService,
    ownerTeamService: ScheduledMaintenanceOwnerTeamService,
    teamLookup: "getUsersInTeams",
  },
  {
    name: "MonitorService",
    findOwners: (id: ObjectID) => {
      return MonitorService.findOwners(id);
    },
    ownerUserService: MonitorOwnerUserService,
    ownerTeamService: MonitorOwnerTeamService,
    teamLookup: "getUsersInTeams",
  },
  {
    name: "StatusPageService",
    findOwners: (id: ObjectID) => {
      return StatusPageService.findOwners(id);
    },
    ownerUserService: StatusPageOwnerUserService,
    ownerTeamService: StatusPageOwnerTeamService,
    teamLookup: "getUsersInTeams",
  },
  {
    name: "ServiceLevelObjectiveService",
    findOwners: (id: ObjectID) => {
      return ServiceLevelObjectiveService.findOwners(id);
    },
    ownerUserService: ServiceLevelObjectiveOwnerUserService,
    ownerTeamService: ServiceLevelObjectiveOwnerTeamService,
    teamLookup: "getUsersInTeams",
  },
];

interface Spies {
  membershipRead: any;
}

function stubOwners(
  c: FindOwnersCase,
  data: {
    directOwners: Array<string>;
    teamOwners: Array<ObjectID>;
    teamUsers: Array<string>;
    members: Array<string>;
  },
): Spies {
  jest.spyOn(c.ownerUserService, "findBy").mockResolvedValue(
    data.directOwners.map((id: string) => {
      return {
        projectId: PROJECT_ID,
        userId: new ObjectID(id),
        user: user(id),
      };
    }) as never,
  );
  jest.spyOn(c.ownerTeamService, "findBy").mockResolvedValue(
    data.teamOwners.map((teamId: ObjectID) => {
      return { projectId: PROJECT_ID, teamId: teamId };
    }) as never,
  );
  jest
    .spyOn(TeamMemberService, c.teamLookup)
    .mockResolvedValue(data.teamUsers.map(user) as never);

  return {
    membershipRead: jest.spyOn(TeamMemberService, "findBy").mockResolvedValue(
      data.members.map((id: string) => {
        const member: TeamMember = new TeamMember();
        member.userId = new ObjectID(id);
        return member;
      }) as never,
    ),
  };
}

function ids(users: Array<User>): Array<string> {
  return users.map((owner: User): string => {
    return owner.id!.toString();
  });
}

describe.each(
  CASES.map((c: FindOwnersCase): [string, FindOwnersCase] => {
    return [c.name, c];
  }),
)(
  "%s.findOwners - project members only",
  (_name: string, c: FindOwnersCase) => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    test("drops a direct owner who left the project and a team member who never accepted", async () => {
      const spies: Spies = stubOwners(c, {
        directOwners: [MEMBER_OWNER, DEPARTED_OWNER],
        teamOwners: [TEAM_ID],
        teamUsers: [TEAM_MEMBER, PENDING_INVITEE],
        members: [MEMBER_OWNER, TEAM_MEMBER],
      });

      const owners: Array<User> = await c.findOwners(RESOURCE_ID);

      expect(ids(owners).sort()).toEqual([MEMBER_OWNER, TEAM_MEMBER].sort());

      // One membership read, in the resource's project, accepted only.
      expect(spies.membershipRead).toHaveBeenCalledTimes(1);
      const query: any = spies.membershipRead.mock.calls[0]![0].query;
      expect(query.projectId).toBe(PROJECT_ID);
      expect(query.hasAcceptedInvitation).toBe(true);
      expect(
        (
          Object.values(
            query.userId.objectLiteralParameters,
          )[0] as Array<string>
        ).sort(),
      ).toEqual(
        [MEMBER_OWNER, DEPARTED_OWNER, TEAM_MEMBER, PENDING_INVITEE].sort(),
      );
    });

    test("returns nobody when the only owner left, so the jobs fall back to the project owners", async () => {
      stubOwners(c, {
        directOwners: [DEPARTED_OWNER],
        teamOwners: [],
        teamUsers: [],
        members: [],
      });

      await expect(c.findOwners(RESOURCE_ID)).resolves.toEqual([]);
    });

    test("keeps every owner who is still a member", async () => {
      stubOwners(c, {
        directOwners: [MEMBER_OWNER],
        teamOwners: [TEAM_ID],
        teamUsers: [TEAM_MEMBER],
        members: [MEMBER_OWNER, TEAM_MEMBER],
      });

      const owners: Array<User> = await c.findOwners(RESOURCE_ID);

      expect(ids(owners).sort()).toEqual([MEMBER_OWNER, TEAM_MEMBER].sort());
    });

    test("no owners: no membership read", async () => {
      const spies: Spies = stubOwners(c, {
        directOwners: [],
        teamOwners: [],
        teamUsers: [],
        members: [],
      });

      await expect(c.findOwners(RESOURCE_ID)).resolves.toEqual([]);
      expect(spies.membershipRead).not.toHaveBeenCalled();
    });
  },
);
