import Project from "../../../Models/DatabaseModels/Project";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import MailService from "../../../Server/Services/MailService";
import ProjectSCIMService from "../../../Server/Services/ProjectSCIMService";
import ProjectService from "../../../Server/Services/ProjectService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamPermissionService from "../../../Server/Services/TeamPermissionService";
import TeamService from "../../../Server/Services/TeamService";
import UserService from "../../../Server/Services/UserService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import RelationIdUtil from "../../../Server/Utils/Database/RelationIdUtil";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "../../../Types/Email";
import BadDataException from "../../../Types/Exception/BadDataException";
import HashedString from "../../../Types/HashedString";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

/*
 * A membership names its team and its person, each under two names: the ID
 * column (`teamId`, `userId`) and the relation (`team`, `user`). The checks
 * that decide whether the membership may be created - whether the inviter
 * may grant the team's permissions, whether the person is already in the
 * project (which makes the membership accepted) - read the team and the
 * person under either name, refuse two names that disagree, and leave the
 * membership written under the ID columns alone, so the team and person
 * checked are the ones stored.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-7ea1-4aaa-8bbb-000000000001",
);
const TEAM_ID: ObjectID = new ObjectID("0193c0de-7ea1-4aaa-8bbb-0000000000a1");
const OTHER_TEAM_ID: string = "0193c0de-7ea1-4aaa-8bbb-0000000000a2";
const USER_ID: ObjectID = new ObjectID("0193c0de-7ea1-4aaa-8bbb-0000000000b1");
const OTHER_USER_ID: string = "0193c0de-7ea1-4aaa-8bbb-0000000000b2";
const INVITER_ID: ObjectID = new ObjectID(
  "0193c0de-7ea1-4aaa-8bbb-0000000000c1",
);

const PROJECT_USER_PROPS: DatabaseCommonInteractionProps = {
  userId: INVITER_ID,
  tenantId: PROJECT_ID,
};

let grantCheck: jest.SpyInstance;
let teamLookup: jest.SpyInstance;
let memberCheck: jest.SpyInstance;

beforeEach(() => {
  stubProjectDirectory({});

  teamLookup = jest
    .spyOn(TeamService, "findOneBy")
    .mockResolvedValue(new Team(TEAM_ID));
  grantCheck = jest
    .spyOn(TeamPermissionService, "assertCanGrantTeamPermissions")
    .mockResolvedValue(undefined);
  jest
    .spyOn(ProjectSCIMService, "countBy")
    .mockResolvedValue(new PositiveNumber(0));
  jest.spyOn(TeamMemberService, "findOneBy").mockResolvedValue(null);
  jest
    .spyOn(TeamMemberService, "getUniqueTeamMemberCountInProject")
    .mockResolvedValue(0);
  memberCheck = jest
    .spyOn(TeamMemberService, "isUserMemberOfProject")
    .mockResolvedValue(false);
  jest
    .spyOn(ProjectService, "findOneById")
    .mockResolvedValue({ name: "Acme Production" } as Project);
  jest
    .spyOn(DatabaseConfig, "getHost")
    .mockResolvedValue(new Hostname("oneuptime.test"));
  jest
    .spyOn(DatabaseConfig, "getHttpProtocol")
    .mockResolvedValue(Protocol.HTTPS);
  jest.spyOn(MailService, "sendMail").mockResolvedValue(undefined as never);

  const user: User = new User(USER_ID);
  user._id = USER_ID.toString();
  user.email = new Email("member@company.com");
  user.isEmailVerified = true;
  user.password = new HashedString("already-registered", true);

  jest.spyOn(UserService, "findOneById").mockResolvedValue(user);
  jest.spyOn(UserService, "findOneBy").mockResolvedValue(user);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function newMembership(values: Record<string, unknown>): TeamMember {
  const member: TeamMember = new TeamMember();
  member.projectId = PROJECT_ID;

  for (const [key, value] of Object.entries(values)) {
    (member as unknown as Record<string, unknown>)[key] = value;
  }

  return member;
}

async function create(member: TeamMember): Promise<unknown> {
  const createBy: CreateBy<TeamMember> = {
    data: member,
    props: PROJECT_USER_PROPS,
  } as CreateBy<TeamMember>;

  try {
    await (
      TeamMemberService as unknown as {
        onBeforeCreate: (createBy: CreateBy<TeamMember>) => Promise<unknown>;
      }
    ).onBeforeCreate(createBy);

    return "created";
  } catch (error) {
    return error;
  }
}

function has(data: unknown, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(data, key);
}

describe("the team", () => {
  test("named under the relation alone is the team whose grant is checked, and is written under teamId alone", async () => {
    const member: TeamMember = newMembership({
      team: { _id: TEAM_ID.toString() },
      userId: USER_ID,
    });

    expect(await create(member)).toBe("created");

    expect(String(grantCheck.mock.calls[0]![0].teamId)).toBe(
      TEAM_ID.toString(),
    );
    expect(member.teamId?.toString()).toBe(TEAM_ID.toString());
    expect(has(member, "team")).toBe(false);
  });

  test("named twice, differently, is refused before any team is read", async () => {
    const outcome: unknown = await create(
      newMembership({
        teamId: TEAM_ID,
        team: { _id: OTHER_TEAM_ID },
        userId: USER_ID,
      }),
    );

    expect(outcome).toBeInstanceOf(BadDataException);
    expect((outcome as Error).message).toBe(
      RelationIdUtil.getConflictMessage("Team", ["teamId", "team"]),
    );
    expect(teamLookup).not.toHaveBeenCalled();
    expect(grantCheck).not.toHaveBeenCalled();
  });

  test("named twice, the same, is the one team", async () => {
    const member: TeamMember = newMembership({
      teamId: TEAM_ID,
      team: { _id: TEAM_ID.toString().toUpperCase() },
      userId: USER_ID,
    });

    expect(await create(member)).toBe("created");
    expect(member.teamId?.toString().toLowerCase()).toBe(
      TEAM_ID.toString().toLowerCase(),
    );
    expect(has(member, "team")).toBe(false);
  });
});

describe("the person", () => {
  test("named under the relation alone is the person whose membership of the project is asked about", async () => {
    const member: TeamMember = newMembership({
      teamId: TEAM_ID,
      user: { _id: USER_ID.toString() },
    });

    expect(await create(member)).toBe("created");

    expect(String(memberCheck.mock.calls[0]![0].userId)).toBe(
      USER_ID.toString(),
    );
    expect(member.userId?.toString()).toBe(USER_ID.toString());
    expect(has(member, "user")).toBe(false);
  });

  test("named twice, differently, is refused before anything is read", async () => {
    const outcome: unknown = await create(
      newMembership({
        teamId: TEAM_ID,
        userId: USER_ID,
        user: { _id: OTHER_USER_ID },
      }),
    );

    expect(outcome).toBeInstanceOf(BadDataException);
    expect((outcome as Error).message).toBe(
      RelationIdUtil.getConflictMessage("User", ["userId", "user"]),
    );
    expect(teamLookup).not.toHaveBeenCalled();
    expect(memberCheck).not.toHaveBeenCalled();
  });
});
