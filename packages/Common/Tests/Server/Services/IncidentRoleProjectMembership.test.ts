import IncidentEpisodeRoleMemberService from "../../../Server/Services/IncidentEpisodeRoleMemberService";
import IncidentMemberService from "../../../Server/Services/IncidentMemberService";
import IncidentRoleService from "../../../Server/Services/IncidentRoleService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import logger from "../../../Server/Utils/Logger";
import IncidentEpisodeRoleMember from "../../../Models/DatabaseModels/IncidentEpisodeRoleMember";
import IncidentMember from "../../../Models/DatabaseModels/IncidentMember";
import IncidentRole from "../../../Models/DatabaseModels/IncidentRole";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Incident roles could be given to someone who is not a member of the
 * project: whoever first changed an incident's state became its commander
 * with no membership check, and IncidentMemberService only refused
 * duplicates. A removed user (or a master admin acting on the project) could
 * so end up commanding an incident they cannot even open.
 */

const PROJECT_ID: ObjectID = new ObjectID("project-1");
const INCIDENT_ID: ObjectID = new ObjectID("incident-1");
const EPISODE_ID: ObjectID = new ObjectID("episode-1");
const ROLE_ID: ObjectID = new ObjectID("role-commander");
const USER_ID: ObjectID = new ObjectID("user-1");

function incidentMember(): IncidentMember {
  const member: IncidentMember = new IncidentMember();
  member.incidentId = INCIDENT_ID;
  member.userId = USER_ID;
  member.incidentRoleId = ROLE_ID;
  return member;
}

function episodeRoleMember(): IncidentEpisodeRoleMember {
  const member: IncidentEpisodeRoleMember = new IncidentEpisodeRoleMember();
  member.incidentEpisodeId = EPISODE_ID;
  member.userId = USER_ID;
  member.incidentRoleId = ROLE_ID;
  return member;
}

describe("incident roles are for project members only", () => {
  let memberCheck: any;

  beforeEach(() => {
    memberCheck = jest
      .spyOn(TeamMemberService, "isUserMemberOfProject")
      .mockResolvedValue(true);
    jest.spyOn(logger, "debug").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("IncidentMemberService.onBeforeCreate", () => {
    test("refuses a user who is not a member of the project", async () => {
      memberCheck.mockResolvedValue(false);
      const duplicateCheck: any = jest
        .spyOn(IncidentMemberService, "findOneBy")
        .mockResolvedValue(null);

      const data: IncidentMember = incidentMember();
      data.projectId = PROJECT_ID;

      await expect(
        (IncidentMemberService as any).onBeforeCreate({
          data,
          props: { isRoot: true },
        }),
      ).rejects.toThrow(BadDataException);

      expect(memberCheck).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        userId: USER_ID,
      });
      expect(duplicateCheck).not.toHaveBeenCalled();
    });

    test("reads the project from the request's tenant when the row has none", async () => {
      memberCheck.mockResolvedValue(false);

      await expect(
        (IncidentMemberService as any).onBeforeCreate({
          data: incidentMember(),
          props: { tenantId: PROJECT_ID, userId: new ObjectID("admin") },
        }),
      ).rejects.toThrow(
        "This user is not a member of this project and cannot be assigned a role on this incident.",
      );

      expect(memberCheck.mock.calls[0]![0].projectId).toBe(PROJECT_ID);
    });

    test("accepts a member, and still refuses a duplicate", async () => {
      jest.spyOn(IncidentMemberService, "findOneBy").mockResolvedValue(null);

      const data: IncidentMember = incidentMember();
      data.projectId = PROJECT_ID;

      await expect(
        (IncidentMemberService as any).onBeforeCreate({
          data,
          props: { isRoot: true },
        }),
      ).resolves.toMatchObject({ carryForward: null });

      jest
        .spyOn(IncidentMemberService, "findOneBy")
        .mockResolvedValue(incidentMember());

      await expect(
        (IncidentMemberService as any).onBeforeCreate({
          data,
          props: { isRoot: true },
        }),
      ).rejects.toThrow("already assigned");
    });
  });

  describe("IncidentEpisodeRoleMemberService.onBeforeCreate", () => {
    test("refuses a user who is not a member of the project", async () => {
      memberCheck.mockResolvedValue(false);

      const data: IncidentEpisodeRoleMember = episodeRoleMember();
      data.projectId = PROJECT_ID;

      await expect(
        (IncidentEpisodeRoleMemberService as any).onBeforeCreate({
          data,
          props: { isRoot: true },
        }),
      ).rejects.toThrow(BadDataException);

      expect(memberCheck).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        userId: USER_ID,
      });
    });

    test("accepts a member", async () => {
      await expect(
        (IncidentEpisodeRoleMemberService as any).onBeforeCreate({
          data: episodeRoleMember(),
          props: { tenantId: PROJECT_ID },
        }),
      ).resolves.toMatchObject({ carryForward: null });

      expect(memberCheck.mock.calls[0]![0].projectId).toBe(PROJECT_ID);
    });
  });

  describe("IncidentStateTimelineService.autoAssignIncidentCommander", () => {
    function stubNoCommanderYet(): any {
      const primaryRole: IncidentRole = new IncidentRole();
      primaryRole._id = ROLE_ID.toString();

      jest
        .spyOn(IncidentRoleService, "findOneBy")
        .mockResolvedValue(primaryRole);
      // No commander on the incident, and the user holds no role on it.
      jest.spyOn(IncidentMemberService, "findOneBy").mockResolvedValue(null);

      return jest
        .spyOn(IncidentMemberService, "create")
        .mockImplementation(async (createBy: any) => {
          return createBy.data;
        });
    }

    function autoAssign(): Promise<void> {
      return (IncidentStateTimelineService as any).autoAssignIncidentCommander({
        incidentId: INCIDENT_ID,
        projectId: PROJECT_ID,
        userId: USER_ID,
      });
    }

    test("does not make a non-member who changed the state the commander", async () => {
      const create: any = stubNoCommanderYet();
      memberCheck.mockResolvedValue(false);

      await autoAssign();

      expect(memberCheck).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        userId: USER_ID,
      });
      expect(create).not.toHaveBeenCalled();
    });

    test("makes a member who changed the state the commander", async () => {
      const create: any = stubNoCommanderYet();

      await autoAssign();

      expect(create).toHaveBeenCalledTimes(1);
      const written: IncidentMember = create.mock.calls[0]![0].data;
      expect(written.incidentId).toBe(INCIDENT_ID);
      expect(written.projectId).toBe(PROJECT_ID);
      expect(written.userId).toBe(USER_ID);
      expect(written.incidentRoleId!.toString()).toBe(ROLE_ID.toString());
    });

    test("an incident that already has a commander is not looked at further", async () => {
      const primaryRole: IncidentRole = new IncidentRole();
      primaryRole._id = ROLE_ID.toString();
      jest
        .spyOn(IncidentRoleService, "findOneBy")
        .mockResolvedValue(primaryRole);
      jest
        .spyOn(IncidentMemberService, "findOneBy")
        .mockResolvedValue(incidentMember());
      const create: any = jest.spyOn(IncidentMemberService, "create");

      await autoAssign();

      expect(memberCheck).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    });
  });
});
