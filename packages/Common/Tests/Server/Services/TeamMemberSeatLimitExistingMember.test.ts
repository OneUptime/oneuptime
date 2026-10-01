import Project from "../../../Models/DatabaseModels/Project";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import Semaphore, {
  SemaphoreMutex,
} from "../../../Server/Infrastructure/Semaphore";
import AuditLogService from "../../../Server/Services/AuditLogService";
import BillingService from "../../../Server/Services/BillingService";
import MailService from "../../../Server/Services/MailService";
import ProjectSCIMService from "../../../Server/Services/ProjectSCIMService";
import ProjectService from "../../../Server/Services/ProjectService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamPermissionService from "../../../Server/Services/TeamPermissionService";
import TeamService from "../../../Server/Services/TeamService";
import UserService from "../../../Server/Services/UserService";
import CountBy from "../../../Server/Types/Database/CountBy";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import FindBy from "../../../Server/Types/Database/FindBy";
import FindOneBy from "../../../Server/Types/Database/FindOneBy";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import Errors from "../../../Server/Utils/Errors";
import ProductAnalytics from "../../../Server/Utils/ProductAnalytics";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SubscriptionPlan, {
  PlanType,
} from "../../../Types/Billing/SubscriptionPlan";
import Email from "../../../Types/Email";
import EmailMessage from "../../../Types/Email/EmailMessage";
import HashedString from "../../../Types/HashedString";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The seat limit and the free plan's one-member limit count people, not
 * memberships: getUniqueTeamMemberCountInProject counts the distinct users
 * with any membership in the project, pending invitations included. Adding
 * someone who is already in the project to another team leaves that count
 * where it was, yet TeamMemberService.onBeforeCreate refused it whenever the
 * project was at its limit - and on the free plan, whose limit is the owner
 * alone, the owner could never be added to a second team at all.
 *
 * Everything runs through TeamMemberService.create. The memberships live in
 * an in-memory table behind the service's own reads, so the member count, the
 * new membership lookup, the duplicate-invite guard and the seat sync after
 * the write all see the same rows.
 */

jest.mock("../../../Server/EnvironmentConfig", () => {
  const config: Record<string, unknown> = {
    ...jest.requireActual("../../../Server/EnvironmentConfig"),
  };

  // Preserve the configurable getter when TypeScript imports this namespace.
  Object.defineProperty(config, "__esModule", { value: true });

  Object.defineProperty(config, "IsBillingEnabled", {
    configurable: true,
    enumerable: true,
    get: (): boolean => {
      return true;
    },
  });

  return config;
});

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const OWNERS_TEAM_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const ENGINEERING_TEAM_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const OWNER_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const MEMBER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const COLLEAGUE_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);
const OUTSIDER_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const MEMBER_EMAIL: Email = new Email("member@company.com");
const OUTSIDER_EMAIL: Email = new Email("outsider@company.com");
const SUBSCRIPTION_ID: string = "sub_team_members";
const PLAN_ID: string = "price_growth_monthly";

// The TeamMember table, as TeamMemberService's own reads see it.
let memberships: Array<TeamMember>;

// The users who have an account on this installation.
let accounts: Array<User>;

let project: Project;
let saveSpy: jest.Mock;
let createUserSpy: jest.SpyInstance;
let findUserSpy: jest.SpyInstance;
let sendMailSpy: jest.SpyInstance;
let billingSpy: jest.SpyInstance;

function membership(data: {
  userId: ObjectID;
  teamId?: ObjectID | undefined;
  projectId?: ObjectID | undefined;
  hasAcceptedInvitation?: boolean | undefined;
}): TeamMember {
  const row: TeamMember = new TeamMember(ObjectID.generate());
  row.projectId = data.projectId || PROJECT_ID;
  row.teamId = data.teamId || OWNERS_TEAM_ID;
  row.userId = data.userId;
  row.hasAcceptedInvitation = data.hasAcceptedInvitation ?? true;
  return row;
}

// Somebody who has registered, so an invitation needs no registration token.
function account(id: ObjectID, email: Email): User {
  const user: User = new User(id);
  user.email = email;
  user.password = new HashedString("already-registered", true);
  return user;
}

function queryValue(query: unknown, column: string): string {
  return String((query as Record<string, unknown>)[column]);
}

/*
 * The rows whose columns equal every value in the query. Every query the
 * create path makes of this table is a plain equality on ids, so comparing
 * the values as strings is enough.
 */
function rowsMatching(query: unknown): Array<TeamMember> {
  return memberships.filter((row: TeamMember): boolean => {
    return Object.keys(query as Record<string, unknown>).every(
      (column: string): boolean => {
        return queryValue(row, column) === queryValue(query, column);
      },
    );
  });
}

function peopleInProject(): Promise<number> {
  return TeamMemberService.getUniqueTeamMemberCountInProject(PROJECT_ID);
}

/*
 * A project admin adding someone to a team from the dashboard - the team's
 * member list, or the Teams tab of the person's own page.
 */
function addToTeam(
  userId: ObjectID,
  options?: {
    teamId?: ObjectID | undefined;
    currentPlan?: PlanType | undefined;
  },
): CreateBy<TeamMember> {
  const member: TeamMember = new TeamMember();
  member.projectId = PROJECT_ID;
  member.teamId = options?.teamId || ENGINEERING_TEAM_ID;
  member.userId = userId;

  return {
    data: member,
    props: {
      userId: OWNER_ID,
      tenantId: PROJECT_ID,
      currentPlan: options?.currentPlan,
    } as DatabaseCommonInteractionProps,
  };
}

// The same, from the invite form, which names the person by email only.
function inviteByEmail(email: Email): CreateBy<TeamMember> {
  const member: TeamMember = new TeamMember();
  member.projectId = PROJECT_ID;
  member.teamId = ENGINEERING_TEAM_ID;

  return {
    data: member,
    props: {
      userId: OWNER_ID,
      tenantId: PROJECT_ID,
    } as DatabaseCommonInteractionProps,
    miscDataProps: { email: email.toString() },
  };
}

/*
 * Three people - the owner, the member and a colleague - in a project whose
 * seat limit is three, with all three seats billed. Someone else is a member
 * of another project, which counts for nothing here.
 */
function projectAtItsSeatLimit(memberHasAccepted: boolean = true): void {
  project.seatLimit = 3;
  project.paymentProviderSubscriptionSeats = 3;

  memberships.push(
    membership({ userId: OWNER_ID }),
    membership({
      userId: MEMBER_ID,
      hasAcceptedInvitation: memberHasAccepted,
    }),
    membership({ userId: COLLEAGUE_ID }),
    membership({
      userId: OUTSIDER_ID,
      projectId: OTHER_PROJECT_ID,
      teamId: ObjectID.generate(),
    }),
  );

  accounts.push(
    account(MEMBER_ID, MEMBER_EMAIL),
    account(OUTSIDER_ID, OUTSIDER_EMAIL),
  );
}

// A free-plan project: its owner, alone, is the one member it may have.
function freeProjectWithItsOwner(): void {
  project.paymentProviderSubscriptionSeats = 1;

  memberships.push(membership({ userId: OWNER_ID }));
}

beforeEach(() => {
  memberships = [];
  accounts = [];

  project = new Project(PROJECT_ID);
  project.name = "Acme Production";
  project.paymentProviderSubscriptionId = SUBSCRIPTION_ID;
  project.paymentProviderPlanId = PLAN_ID;

  jest
    .spyOn(TeamMemberService, "findBy")
    .mockImplementation(
      async (findBy: FindBy<TeamMember>): Promise<Array<TeamMember>> => {
        return rowsMatching(findBy.query);
      },
    );
  jest
    .spyOn(TeamMemberService, "findOneBy")
    .mockImplementation(
      async (findOneBy: FindOneBy<TeamMember>): Promise<TeamMember | null> => {
        return rowsMatching(findOneBy.query)[0] || null;
      },
    );
  jest
    .spyOn(TeamMemberService, "countBy")
    .mockImplementation(
      async (countBy: CountBy<TeamMember>): Promise<PositiveNumber> => {
        return new PositiveNumber(rowsMatching(countBy.query).length);
      },
    );

  saveSpy = jest.fn(async (row: TeamMember): Promise<TeamMember> => {
    row.id = ObjectID.generate();
    memberships.push(row);
    return row;
  });
  jest
    .spyOn(TeamMemberService, "getRepository")
    .mockReturnValue({ save: saveSpy } as never);
  jest
    .spyOn(TeamMemberService, "onTriggerRealtime")
    .mockResolvedValue(undefined);
  jest
    .spyOn(TeamMemberService, "onTriggerWorkflow")
    .mockResolvedValue(undefined);
  jest.spyOn(TeamMemberService, "refreshTokens").mockResolvedValue(undefined);
  jest.spyOn(AuditLogService, "recordCreate").mockResolvedValue(undefined);
  jest
    .spyOn(ModelPermission, "checkCreatePermissions")
    .mockReturnValue(undefined);
  jest.spyOn(ProductAnalytics, "captureForUser").mockImplementation(() => {});

  // The admin may add people to the team, and SCIM does not own it.
  jest
    .spyOn(TeamService, "findOneBy")
    .mockResolvedValue(new Team(ENGINEERING_TEAM_ID));
  jest
    .spyOn(TeamPermissionService, "assertCanGrantTeamPermissions")
    .mockResolvedValue(undefined);
  jest
    .spyOn(ProjectSCIMService, "countBy")
    .mockResolvedValue(new PositiveNumber(0));

  jest
    .spyOn(ProjectService, "findOneById")
    .mockImplementation(async (): Promise<Project> => {
      return Object.assign(new Project(PROJECT_ID), project);
    });

  // The seat sync that runs after every membership write.
  jest.spyOn(Semaphore, "lock").mockResolvedValue({} as SemaphoreMutex);
  jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);
  jest
    .spyOn(SubscriptionPlan, "getSubscriptionPlanById")
    .mockReturnValue(
      new SubscriptionPlan(PLAN_ID, "price_yearly", "Growth", 20, 200, 1, 14),
    );
  jest.spyOn(ProjectService, "updateSubscriptionSeats").mockResolvedValue(1);
  billingSpy = jest
    .spyOn(BillingService, "changeQuantity")
    .mockResolvedValue(undefined);

  // The invitation email.
  findUserSpy = jest
    .spyOn(UserService, "findOneBy")
    .mockImplementation(
      async (findOneBy: FindOneBy<User>): Promise<User | null> => {
        const email: string = queryValue(findOneBy.query, "email");

        return (
          accounts.find((user: User): boolean => {
            return user.email?.toString() === email;
          }) || null
        );
      },
    );
  createUserSpy = jest
    .spyOn(UserService, "createByEmail")
    .mockImplementation(async (): Promise<User> => {
      return new User(ObjectID.generate());
    });
  jest
    .spyOn(DatabaseConfig, "getHost")
    .mockResolvedValue(new Hostname("oneuptime.test"));
  jest
    .spyOn(DatabaseConfig, "getHttpProtocol")
    .mockResolvedValue(Protocol.HTTPS);
  sendMailSpy = jest
    .spyOn(MailService, "sendMail")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("TeamMemberService.create - a project at its seat limit", () => {
  test.each([
    ["an accepted member", true],
    ["a pending invitee", false],
  ])(
    "%s can be added to another team, which takes no seat",
    async (_who: string, hasAccepted: boolean) => {
      projectAtItsSeatLimit(hasAccepted);

      const saved: TeamMember = await TeamMemberService.create(
        addToTeam(MEMBER_ID),
      );

      expect(saveSpy).toHaveBeenCalledTimes(1);
      expect(saved.userId?.toString()).toBe(MEMBER_ID.toString());
      expect(saved.teamId?.toString()).toBe(ENGINEERING_TEAM_ID.toString());
      await expect(peopleInProject()).resolves.toBe(3);

      // The seat sync after the write counted the same three people.
      expect(billingSpy).not.toHaveBeenCalled();
    },
  );

  test("someone new is still refused, and nothing is written", async () => {
    projectAtItsSeatLimit();

    await expect(
      TeamMemberService.create(addToTeam(OUTSIDER_ID)),
    ).rejects.toThrow(Errors.TeamMemberService.LIMIT_REACHED);

    expect(saveSpy).not.toHaveBeenCalled();
    await expect(peopleInProject()).resolves.toBe(3);
  });

  test("adding a member to a team they are already in is still a duplicate", async () => {
    projectAtItsSeatLimit();

    await expect(
      TeamMemberService.create(
        addToTeam(MEMBER_ID, { teamId: OWNERS_TEAM_ID }),
      ),
    ).rejects.toThrow(Errors.TeamMemberService.ALREADY_INVITED);

    expect(saveSpy).not.toHaveBeenCalled();
  });
});

describe("TeamMemberService.create - the free plan", () => {
  test("the owner can be added to another team", async () => {
    freeProjectWithItsOwner();

    const saved: TeamMember = await TeamMemberService.create(
      addToTeam(OWNER_ID, { currentPlan: PlanType.Free }),
    );

    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saved.userId?.toString()).toBe(OWNER_ID.toString());
    expect(saved.teamId?.toString()).toBe(ENGINEERING_TEAM_ID.toString());
    await expect(peopleInProject()).resolves.toBe(1);
    expect(billingSpy).not.toHaveBeenCalled();
  });

  test("a second person is still refused", async () => {
    freeProjectWithItsOwner();

    await expect(
      TeamMemberService.create(
        addToTeam(MEMBER_ID, { currentPlan: PlanType.Free }),
      ),
    ).rejects.toThrow(Errors.TeamMemberService.LIMIT_REACHED_FOR_FREE_PLAN);

    expect(saveSpy).not.toHaveBeenCalled();
    await expect(peopleInProject()).resolves.toBe(1);
  });
});

describe("TeamMemberService.create - inviting by email at the seat limit", () => {
  test("a member's address is allowed and creates no user", async () => {
    projectAtItsSeatLimit();

    const saved: TeamMember = await TeamMemberService.create(
      inviteByEmail(MEMBER_EMAIL),
    );

    expect(createUserSpy).not.toHaveBeenCalled();
    expect(saved.userId?.toString()).toBe(MEMBER_ID.toString());
    expect(saveSpy).toHaveBeenCalledTimes(1);
    await expect(peopleInProject()).resolves.toBe(3);
    expect(billingSpy).not.toHaveBeenCalled();

    // Looked up once, before the limit check, and that answer reused.
    expect(findUserSpy).toHaveBeenCalledTimes(1);

    expect(sendMailSpy).toHaveBeenCalledTimes(1);
    const mail: EmailMessage = sendMailSpy.mock.calls[0]![0] as EmailMessage;
    expect(mail.toEmail.toString()).toBe(MEMBER_EMAIL.toString());
  });

  test.each([
    ["an address with no account", new Email("nobody@company.com")],
    ["the address of someone outside the project", OUTSIDER_EMAIL],
  ])(
    "%s is refused without creating a user",
    async (_who: string, email: Email) => {
      projectAtItsSeatLimit();

      await expect(
        TeamMemberService.create(inviteByEmail(email)),
      ).rejects.toThrow(Errors.TeamMemberService.LIMIT_REACHED);

      expect(createUserSpy).not.toHaveBeenCalled();
      expect(sendMailSpy).not.toHaveBeenCalled();
      expect(saveSpy).not.toHaveBeenCalled();
    },
  );
});
