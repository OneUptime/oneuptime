import TeamMemberAPI from "../../../Server/API/TeamMemberAPI";
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import ProjectSCIMService from "../../../Server/Services/ProjectSCIMService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamPermissionService from "../../../Server/Services/TeamPermissionService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import Label from "../../../Models/DatabaseModels/Label";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import TeamPermission from "../../../Models/DatabaseModels/TeamPermission";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import UserType from "../../../Types/UserType";
import { getJestSpyOn } from "../../Spy";
import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

type SpyInstance = ReturnType<typeof getJestSpyOn>;

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
  };
});

/*
 * POST /team-member/:id/leave removes the caller's own membership as root -
 * a member needs no permission to manage teams to leave one - after checking
 * only that the membership is theirs. Leaving a team lifts its blocks from
 * the person who leaves (a block on one team wins over an allow on another),
 * so a member of Engineering (Incident Member over the whole project) and of
 * Contractors (Incident Member blocked for the Security label) left
 * Contractors and read and changed the Security incidents. Now leaving is
 * held to what a removal by anyone else is held to
 * (TeamMemberService.assertRemoverMayLiftBlocks), with the leaver's own
 * permissions in the team's project, whatever project the request names.
 */

const ROUTE: string = "/team-member/:id/leave";

const PROJECT_ID: ObjectID = new ObjectID(
  "42000000-0000-4000-8000-000000000001",
);
// The project the request names: not the team's.
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "42000000-0000-4000-8000-000000000002",
);
const USER_ID: ObjectID = new ObjectID("42000000-0000-4000-8000-000000000003");
const ENGINEERING_ID: ObjectID = new ObjectID(
  "42000000-0000-4000-8000-000000000011",
);
const CONTRACTORS_ID: ObjectID = new ObjectID(
  "42000000-0000-4000-8000-000000000012",
);
const SECURITY: ObjectID = new ObjectID("42000000-0000-4000-8000-000000000021");
const IN_ENGINEERING: ObjectID = new ObjectID(
  "42000000-0000-4000-8000-000000000031",
);
const IN_CONTRACTORS: ObjectID = new ObjectID(
  "42000000-0000-4000-8000-000000000032",
);

function membershipOf(
  id: ObjectID,
  teamId: ObjectID,
  accepted: boolean,
): TeamMember {
  const member: TeamMember = new TeamMember();
  member._id = id.toString();
  member.userId = USER_ID;
  member.projectId = PROJECT_ID;
  member.teamId = teamId;
  member.hasAcceptedInvitation = accepted;
  return member;
}

// The leaver's permissions in the team's project, as AccessTokenService reads them.
function leaverProps(): DatabaseCommonInteractionProps {
  const rows: Array<UserPermission> = [
    {
      _type: "UserPermission",
      permission: Permission.IncidentMember,
      labelIds: [],
      isBlockPermission: false,
      scope: PermissionScope.All,
      teamId: ENGINEERING_ID,
    },
    {
      _type: "UserPermission",
      permission: Permission.IncidentMember,
      labelIds: [SECURITY],
      isBlockPermission: true,
      scope: PermissionScope.All,
      teamId: CONTRACTORS_ID,
    },
  ];

  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    userGlobalAccessPermission: {
      _type: "UserGlobalAccessPermission",
      projectIds: [PROJECT_ID],
      globalPermissions: [Permission.Public, Permission.User],
    },
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: rows,
      },
    },
  };
}

// Contractors' block row.
function contractorsBlock(): TeamPermission {
  const block: TeamPermission = new TeamPermission();
  block._id = ObjectID.generate().toString();
  block.teamId = CONTRACTORS_ID;
  block.projectId = PROJECT_ID;
  block.permission = Permission.IncidentMember;
  block.isBlockPermission = true;
  block.scope = PermissionScope.All;

  const label: Label = new Label();
  label._id = SECURITY.toString();
  block.labels = [label];

  const team: Team = new Team();
  team._id = CONTRACTORS_ID.toString();
  team.name = "Contractors";
  block.team = team;

  return block;
}

let membership: TeamMember;
let deleteMembership: SpyInstance;
let permissionsRead: SpyInstance;

const leave: (userType?: UserType) => Promise<void> = async (
  userType?: UserType,
): Promise<void> => {
  const req: ExpressRequest = {
    params: { id: membership.id!.toString() },
    query: {},
    body: {},
    headers: {},
    tenantId: OTHER_PROJECT_ID,
    userType: userType || UserType.User,
    userAuthorization: { userId: USER_ID },
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    send: jest.fn(),
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  const next: NextFunction = jest.fn() as unknown as NextFunction;

  await mockRouter.match("POST", ROUTE).handlerFunction(req, res, next);

  expect(next).not.toHaveBeenCalled();
};

describe("POST /team-member/:id/leave lifts the team's blocks only for someone who could grant them", () => {
  beforeAll(() => {
    mockRouter.routes.length = 0;
    new TeamMemberAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    getJestSpyOn(TeamMemberService, "findOneById").mockImplementation(
      (async (): Promise<TeamMember> => {
        return membership;
      }) as never,
    );
    deleteMembership = getJestSpyOn(
      TeamMemberService,
      "deleteOneById",
    ).mockResolvedValue(1);

    // Push Groups is off.
    getJestSpyOn(ProjectSCIMService, "countBy").mockResolvedValue(
      new PositiveNumber(0),
    );

    permissionsRead = getJestSpyOn(
      AccessTokenService,
      "getDatabaseCommonInteractionPropsByUserAndProject",
    ).mockResolvedValue(leaverProps());

    // The leaver keeps the other of their two memberships.
    getJestSpyOn(TeamMemberService, "countBy").mockResolvedValue(
      new PositiveNumber(1),
    );

    // Contractors blocks Incident Member for Security; Engineering blocks nothing.
    getJestSpyOn(TeamPermissionService, "findAllBy").mockImplementation(
      (async (findBy: {
        query: Record<string, unknown>;
      }): Promise<Array<TeamPermission>> => {
        return findBy.query["teamId"]?.toString() === CONTRACTORS_ID.toString()
          ? [contractorsBlock()]
          : [];
      }) as never,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a member of Engineering does not leave Contractors, whose block they cannot lift", async () => {
    membership = membershipOf(IN_CONTRACTORS, CONTRACTORS_ID, true);

    await leave();

    expect(Response.sendErrorResponse).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      new NotAuthorizedException(
        "You cannot leave the Contractors team: it blocks Incident Member for its members, and lifting that block needs Incident Member at an equal or broader scope in your own access. Ask a project owner to remove you from the team.",
      ),
    );
    expect(deleteMembership).not.toHaveBeenCalled();
    expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
  });

  test("the leaver is weighed with their own permissions in the team's project, not the request's", async () => {
    membership = membershipOf(IN_CONTRACTORS, CONTRACTORS_ID, true);

    await leave();

    expect(permissionsRead).toHaveBeenCalledWith({
      userId: USER_ID,
      projectId: PROJECT_ID,
    });
  });

  test("they leave Engineering, which blocks nothing", async () => {
    membership = membershipOf(IN_ENGINEERING, ENGINEERING_ID, true);

    await leave();

    expect(Response.sendErrorResponse).not.toHaveBeenCalled();
    expect(deleteMembership).toHaveBeenCalledWith({
      id: IN_ENGINEERING,
      props: { isRoot: true },
    });
    expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
  });

  test("leaving Contractors as their last team of the project is leaving the project: nothing is lifted", async () => {
    membership = membershipOf(IN_CONTRACTORS, CONTRACTORS_ID, true);
    getJestSpyOn(TeamMemberService, "countBy").mockResolvedValue(
      new PositiveNumber(0),
    );

    await leave();

    expect(Response.sendErrorResponse).not.toHaveBeenCalled();
    expect(deleteMembership).toHaveBeenCalledWith({
      id: IN_CONTRACTORS,
      props: { isRoot: true },
    });
  });

  test("declining a pending invitation holds no permission and reads none", async () => {
    membership = membershipOf(IN_CONTRACTORS, CONTRACTORS_ID, false);

    await leave();

    expect(permissionsRead).not.toHaveBeenCalled();
    expect(deleteMembership).toHaveBeenCalledWith({
      id: IN_CONTRACTORS,
      props: { isRoot: true },
    });
  });

  test("a master admin leaves without the check", async () => {
    membership = membershipOf(IN_CONTRACTORS, CONTRACTORS_ID, true);

    await leave(UserType.MasterAdmin);

    expect(permissionsRead).not.toHaveBeenCalled();
    expect(deleteMembership).toHaveBeenCalledWith({
      id: IN_CONTRACTORS,
      props: { isRoot: true },
    });
  });
});
