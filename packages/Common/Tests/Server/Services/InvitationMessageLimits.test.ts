import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * AN INVITATION IS COUNTED PER ADDRESS.
 *
 * Inviting someone to a project emails them "You have been invited to
 * <project>" with a link to join, and adding a private user to a status page
 * emails them "You have been invited to <status page>" with a link to set a
 * password - each from this installation's mail server unless the page has
 * its own. Nothing counted them per address.
 *
 * Now each address is counted in the project that invites it, invitations
 * to its teams and to its private status pages together: ten in an hour,
 * then the invitation is refused with 429, before an account is made for
 * the invitee or anything is written or sent (#10179, which also keeps a
 * project to one invitation email to a person per window).
 * Only what is sent counts: an invitation that fails before its email goes
 * out gives its count back, and nothing is counted for someone already in
 * the project who is added to another of its teams (they are told, not
 * invited), for a user who signs in with SSO, or for a page that takes only
 * SSO. The team is never counted, so inviting many colleagues goes on.
 */

jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn(),
      isConnected: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      getLogLevel: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import Project from "../../../Models/DatabaseModels/Project";
import StatusPagePrivateUser from "../../../Models/DatabaseModels/StatusPagePrivateUser";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import Redis from "../../../Server/Infrastructure/Redis";
import EmailVerificationTokenService from "../../../Server/Services/EmailVerificationTokenService";
import MailService from "../../../Server/Services/MailService";
import ProjectSCIMService from "../../../Server/Services/ProjectSCIMService";
import ProjectService from "../../../Server/Services/ProjectService";
import StatusPagePrivateUserService from "../../../Server/Services/StatusPagePrivateUserService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamPermissionService from "../../../Server/Services/TeamPermissionService";
import TeamService from "../../../Server/Services/TeamService";
import UserService from "../../../Server/Services/UserService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import Errors from "../../../Server/Utils/Errors";
import PublicMessageRateLimit, {
  PublicMessageRateLimitException,
  TeamMessageKind,
} from "../../../Server/Utils/RateLimit/PublicMessageRateLimit";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "../../../Types/Email";
import EmailMessage from "../../../Types/Email/EmailMessage";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import EmailVerificationToken from "../../../Models/DatabaseModels/EmailVerificationToken";
import HashedString from "../../../Types/HashedString";
import FakeCounterRedis from "../TestingUtils/Redis/FakeCounterRedis";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { runInvitationHooks } from "../TestingUtils/TeamMemberInvitations";
import InvitationEmailWindow from "../../../Server/Utils/TeamMember/InvitationEmailWindow";
import InvitationInviterUtil from "../../../Server/Utils/TeamMember/InvitationInviter";

type MockedFn = ReturnType<typeof jest.fn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "71000000-0000-4000-8000-000000000001",
);
const TEAM_ID: ObjectID = new ObjectID("71000000-0000-4000-8000-000000000002");
const INVITER_ID: ObjectID = new ObjectID(
  "71000000-0000-4000-8000-000000000003",
);
const PAGE_ID: string = "71000000-0000-4000-8000-000000000010";
const SSO_PAGE_ID: string = "71000000-0000-4000-8000-000000000011";

const ADDRESS: string = "someone@example.com";

const INVITATION_REFUSAL: string =
  "Too many invitations were sent to this email address in the last hour. Please try again later.";

let redis: FakeCounterRedis;
let sendMail: MockedFn;
let createUser: MockedFn;
let currentTime: number;
let testIndex: number = 0;

beforeEach(() => {
  jest.clearAllMocks();
  stubProjectDirectory({});

  // Who invited them is held in TeamMemberInvitationEmailById: nobody here.
  jest.spyOn(InvitationInviterUtil, "read").mockResolvedValue(null);

  redis = new FakeCounterRedis();
  (Redis.getClient as unknown as MockedFn).mockReturnValue(redis);
  (Redis.isConnected as unknown as MockedFn).mockReturnValue(true);

  testIndex++;
  currentTime = Date.UTC(2033, 0, 1) + testIndex * 24 * 60 * 60 * 1000;
  jest.spyOn(Date, "now").mockImplementation((): number => {
    return currentTime;
  });

  sendMail = jest
    .spyOn(MailService, "sendMail")
    .mockResolvedValue(undefined as never) as unknown as MockedFn;
  jest
    .spyOn(DatabaseConfig, "getHost")
    .mockResolvedValue(new Hostname("oneuptime.example.com"));
  jest
    .spyOn(DatabaseConfig, "getHttpProtocol")
    .mockResolvedValue(Protocol.HTTPS);
});

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * The invitations PROJECT_ID's counter holds for an address in this hour -
 * each counted under the cap on every project's invitations too: the same
 * number here, where no other project invites (#10179).
 */
function invitationsCountedFor(address: string): number {
  const inProject: number = redis.count(
    PublicMessageRateLimit.getProjectContactCounterKey({
      counterName: TeamMessageKind.Invitation,
      projectId: PROJECT_ID,
      contact: PublicMessageRateLimit.forEmail(address),
    }),
  );

  expect(
    redis.count(
      PublicMessageRateLimit.getContactCounterKey({
        counterName: TeamMessageKind.Invitation,
        contact: PublicMessageRateLimit.forEmail(address),
      }),
    ),
  ).toBe(inProject);

  return inProject;
}

function mailsOf(templateType: EmailTemplateType): Array<EmailMessage> {
  return sendMail.mock.calls
    .map((call: Array<unknown>): EmailMessage => {
      return call[0] as EmailMessage;
    })
    .filter((message: EmailMessage): boolean => {
      return message.templateType === templateType;
    });
}

describe("an invitation to a project", () => {
  type BeforeCreate = (createBy: CreateBy<TeamMember>) => Promise<unknown>;

  /*
   * The membership's onBeforeCreate, with the invitation it plans sent once
   * the membership is made (runInvitationHooks, #10180).
   */
  const onBeforeCreate: BeforeCreate = (
    createBy: CreateBy<TeamMember>,
  ): Promise<unknown> => {
    return runInvitationHooks(createBy);
  };

  let existingUser: User | null;
  let isMemberOfProject: boolean;
  let hasMembershipInProject: boolean;
  let alreadyOnTeam: boolean;

  function invitee(): User {
    const user: User = new User(ObjectID.generate());
    user.email = new Email(ADDRESS);
    return user;
  }

  // A project owner inviting from project settings.
  function ownerProps(): DatabaseCommonInteractionProps {
    return {
      userId: INVITER_ID,
      tenantId: PROJECT_ID,
    } as DatabaseCommonInteractionProps;
  }

  function invitation(
    address: string = ADDRESS,
    props: DatabaseCommonInteractionProps = ownerProps(),
  ): CreateBy<TeamMember> {
    const member: TeamMember = new TeamMember();
    member.projectId = PROJECT_ID;
    member.teamId = TEAM_ID;

    return {
      data: member,
      props: props,
      miscDataProps: { email: address },
    } as CreateBy<TeamMember>;
  }

  beforeEach(() => {
    existingUser = null;
    isMemberOfProject = false;
    hasMembershipInProject = false;
    alreadyOnTeam = false;

    jest.spyOn(TeamService, "findOneBy").mockResolvedValue(new Team(TEAM_ID));
    jest
      .spyOn(TeamPermissionService, "assertCanGrantTeamPermissions")
      .mockResolvedValue(undefined);
    jest
      .spyOn(ProjectSCIMService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(TeamMemberService, "findOneBy")
      .mockImplementation(async (): Promise<TeamMember | null> => {
        return alreadyOnTeam ? new TeamMember(ObjectID.generate()) : null;
      });
    jest
      .spyOn(TeamMemberService, "getUniqueTeamMemberCountInProject")
      .mockResolvedValue(0);
    jest
      .spyOn(TeamMemberService, "isUserMemberOfProject")
      .mockImplementation(async (): Promise<boolean> => {
        return isMemberOfProject;
      });
    jest
      .spyOn(
        TeamMemberService as unknown as {
          hasMembershipInProject: (data: unknown) => Promise<boolean>;
        },
        "hasMembershipInProject",
      )
      .mockImplementation(async (): Promise<boolean> => {
        return hasMembershipInProject || isMemberOfProject;
      });
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue({ name: "Acme Production" } as Project);
    jest
      .spyOn(UserService, "findOneBy")
      .mockImplementation(async (): Promise<User | null> => {
        return existingUser;
      });
    jest.spyOn(UserService, "findOneById").mockResolvedValue(invitee());
    createUser = jest
      .spyOn(UserService, "createByEmail")
      .mockImplementation(async (): Promise<User> => {
        return invitee();
      }) as unknown as MockedFn;
    jest
      .spyOn(EmailVerificationTokenService, "create")
      .mockResolvedValue(new EmailVerificationToken());
  });

  test("invitations to one address: ten in an hour, then refused before anything is made", async () => {
    const refusals: Array<unknown> = [];

    for (let round: number = 0; round < 30; round++) {
      try {
        await onBeforeCreate(invitation());
      } catch (err) {
        refusals.push(err);
      }
    }

    // Before: thirty invitations in the project's words to one address.
    expect(mailsOf(EmailTemplateType.InviteMember)).toHaveLength(10);
    expect(refusals).toHaveLength(20);
    expect(refusals[0]).toBeInstanceOf(PublicMessageRateLimitException);
    expect((refusals[0] as Error).message).toBe(INVITATION_REFUSAL);
    expect(
      (refusals[0] as PublicMessageRateLimitException).retryAfterSeconds,
    ).toBeGreaterThan(0);

    // A refused invitation makes no account for the invitee.
    expect(createUser).toHaveBeenCalledTimes(10);
  });

  test("an hour on, the address may be invited again", async () => {
    for (let round: number = 0; round < 11; round++) {
      await onBeforeCreate(invitation()).catch((): void => {});
    }

    currentTime += 60 * 60 * 1000;

    await expect(onBeforeCreate(invitation())).resolves.toBeDefined();
    expect(mailsOf(EmailTemplateType.InviteMember)).toHaveLength(11);
  });

  test("the address in capitals, or with a +tag, is the same address", async () => {
    const spellings: Array<string> = [
      ADDRESS,
      "Someone@Example.com",
      "someone+invite@example.com",
    ];

    let sent: number = 0;

    for (let round: number = 0; round < 12; round++) {
      try {
        await onBeforeCreate(invitation(spellings[round % 3]!));
        sent++;
      } catch {
        // refused
      }
    }

    expect(sent).toBe(10);
  });

  test("fifty different colleagues are all invited", async () => {
    for (let index: number = 0; index < 50; index++) {
      await onBeforeCreate(invitation(`colleague${index}@example.com`));
    }

    expect(mailsOf(EmailTemplateType.InviteMember)).toHaveLength(50);
  });

  test("a member who has not signed up yet, added to team after team, is sent their way in each time and never counted", async () => {
    // invitee() has no password: the email carries a new sign-up link.
    existingUser = invitee();
    isMemberOfProject = true;

    for (let round: number = 0; round < 20; round++) {
      await onBeforeCreate(invitation());
    }

    const mails: Array<EmailMessage> = mailsOf(EmailTemplateType.InviteMember);

    expect(mails).toHaveLength(20);
    expect(mails[0]!.subject).toBe("You have been added to Acme Production");
    expect(invitationsCountedFor(ADDRESS)).toBe(0);
  });

  test("a member who has signed up, added by address to team after team, is neither emailed nor counted (#8568)", async () => {
    const member: User = invitee();
    member.password = new HashedString("already-registered", true);
    existingUser = member;
    isMemberOfProject = true;

    for (let round: number = 0; round < 20; round++) {
      await onBeforeCreate(invitation());
    }

    expect(sendMail).not.toHaveBeenCalled();
    expect(invitationsCountedFor(ADDRESS)).toBe(0);
  });

  test("a master admin adding someone, accepted already, is not counted", async () => {
    existingUser = invitee();

    for (let round: number = 0; round < 15; round++) {
      const create: CreateBy<TeamMember> = invitation(ADDRESS, {
        isMasterAdmin: true,
        userId: INVITER_ID,
      } as DatabaseCommonInteractionProps);
      create.data.hasAcceptedInvitation = true;

      await onBeforeCreate(create);
    }

    expect(mailsOf(EmailTemplateType.InviteMember)).toHaveLength(15);
    expect(invitationsCountedFor(ADDRESS)).toBe(0);
  });

  test("an invitation refused as already made gives its count back", async () => {
    existingUser = invitee();
    alreadyOnTeam = true;

    for (let round: number = 0; round < 20; round++) {
      await expect(onBeforeCreate(invitation())).rejects.toThrow(
        Errors.TeamMemberService.ALREADY_INVITED,
      );
    }

    expect(mailsOf(EmailTemplateType.InviteMember)).toHaveLength(0);
    expect(invitationsCountedFor(ADDRESS)).toBe(0);

    // So the address may still be invited where it is not on the team.
    alreadyOnTeam = false;
    await expect(onBeforeCreate(invitation())).resolves.toBeDefined();
  });

  test("an invitation whose account cannot be made gives its count back", async () => {
    createUser.mockRejectedValue(new Error("database away") as never);

    for (let round: number = 0; round < 15; round++) {
      await expect(onBeforeCreate(invitation())).rejects.toThrow(
        "database away",
      );
    }

    expect(invitationsCountedFor(ADDRESS)).toBe(0);
  });

  // A membership made for a person picked by id, not named by address.
  function invitationById(
    props: DatabaseCommonInteractionProps = ownerProps(),
  ): CreateBy<TeamMember> {
    const member: TeamMember = new TeamMember();
    member.projectId = PROJECT_ID;
    member.teamId = TEAM_ID;
    member.userId = ObjectID.generate();

    return { data: member, props: props } as CreateBy<TeamMember>;
  }

  test("an invitation by user id is emailed, and counted by the account's address as one by address is", async () => {
    /*
     * Before #8421 it sent nothing and counted nothing: the person never
     * heard of it. Now it is the same invitation, held to the same limit -
     * and, from one project to one person, emailed once per window
     * (#10179): the other fourteen are made, and send and count nothing.
     */
    const refusals: Array<unknown> = [];

    for (let round: number = 0; round < 15; round++) {
      try {
        await onBeforeCreate(invitationById());
      } catch (err) {
        refusals.push(err);
      }
    }

    expect(mailsOf(EmailTemplateType.InviteMember)).toHaveLength(1);
    expect(refusals).toHaveLength(0);
    expect(invitationsCountedFor(ADDRESS)).toBe(1);

    // An hour on, the window is over: emailed and counted again.
    currentTime += 60 * 60 * 1000;
    await onBeforeCreate(invitationById());

    expect(mailsOf(EmailTemplateType.InviteMember)).toHaveLength(2);

    // Every one is sent to the account's address.
    for (const mail of mailsOf(EmailTemplateType.InviteMember)) {
      expect(mail.toEmail.toString()).toBe(ADDRESS);
    }
  });

  test("invitations by id and by address to one address share its ten", async () => {
    const person: User = invitee();
    jest.spyOn(UserService, "findOneById").mockResolvedValue(person);

    /*
     * The person declines each time (InvitationEmailWindow.end), so each
     * invitation by id is emailed, and counted, as a new one is.
     */
    for (let round: number = 0; round < 6; round++) {
      await onBeforeCreate(invitationById());
      await InvitationEmailWindow.end({
        projectId: PROJECT_ID,
        userIds: [person.id!],
      });
    }

    for (let round: number = 0; round < 4; round++) {
      await onBeforeCreate(invitation());
    }

    await expect(onBeforeCreate(invitationById())).rejects.toThrow(
      INVITATION_REFUSAL,
    );
    await expect(onBeforeCreate(invitation())).rejects.toThrow(
      INVITATION_REFUSAL,
    );
    expect(mailsOf(EmailTemplateType.InviteMember)).toHaveLength(10);
  });

  test("a master admin adding someone by id, accepted already, is told and not counted", async () => {
    for (let round: number = 0; round < 15; round++) {
      const create: CreateBy<TeamMember> = invitationById({
        isMasterAdmin: true,
        userId: INVITER_ID,
      } as DatabaseCommonInteractionProps);
      create.data.hasAcceptedInvitation = true;

      await onBeforeCreate(create);
    }

    const mails: Array<EmailMessage> = mailsOf(EmailTemplateType.InviteMember);

    expect(mails).toHaveLength(15);
    expect(mails[0]!.subject).toBe("You have been added to Acme Production");
    expect(redis.keys()).toEqual([]);
  });

  test("someone already in the project, added by id to team after team, is neither emailed nor counted", async () => {
    hasMembershipInProject = true;

    for (let round: number = 0; round < 20; round++) {
      await onBeforeCreate(invitationById());
    }

    expect(sendMail).not.toHaveBeenCalled();
    expect(redis.keys()).toEqual([]);
  });

  test("an invitation by id refused as already made gives its count back", async () => {
    /*
     * The membership is there by the time the duplicate guard looks, though
     * the first look did not see it: two adds of the same person at once.
     */
    alreadyOnTeam = true;

    for (let round: number = 0; round < 20; round++) {
      await expect(onBeforeCreate(invitationById())).rejects.toThrow(
        Errors.TeamMemberService.ALREADY_INVITED,
      );
    }

    expect(sendMail).not.toHaveBeenCalled();
    expect(invitationsCountedFor(ADDRESS)).toBe(0);
  });

  test("while the counter cannot be reached, invitations go on", async () => {
    (Redis.isConnected as unknown as MockedFn).mockReturnValue(false);

    for (let round: number = 0; round < 15; round++) {
      await onBeforeCreate(invitation());
    }

    expect(mailsOf(EmailTemplateType.InviteMember)).toHaveLength(15);
  });
});

describe("an invitation to a private status page", () => {
  let users: InMemoryTable;

  function privateUser(
    address: string = ADDRESS,
    statusPageId: string = PAGE_ID,
  ): StatusPagePrivateUser {
    const user: StatusPagePrivateUser = new StatusPagePrivateUser();
    user.projectId = PROJECT_ID;
    user.statusPageId = new ObjectID(statusPageId);
    user.email = new Email(address);
    return user;
  }

  async function add(user: StatusPagePrivateUser): Promise<void> {
    await StatusPagePrivateUserService.create({
      data: user,
      props: { isRoot: true },
    });
  }

  // Adds the address and removes it again, `rounds` times: what each add did.
  async function addAndRemove(
    rounds: number,
    make: () => StatusPagePrivateUser = (): StatusPagePrivateUser => {
      return privateUser();
    },
  ): Promise<Array<unknown>> {
    const outcomes: Array<unknown> = [];

    for (let round: number = 0; round < rounds; round++) {
      try {
        await add(make());
        outcomes.push("sent");
      } catch (err) {
        outcomes.push(err);
      }

      users.rows = [];
    }

    return outcomes;
  }

  beforeEach(() => {
    useInMemoryTable(StatusPageService, [
      {
        _id: PAGE_ID,
        projectId: PROJECT_ID.toString(),
        name: "Acme Internal",
        pageTitle: "Acme Internal Status",
        requireSsoForLogin: false,
        version: 1,
      },
      {
        _id: SSO_PAGE_ID,
        projectId: PROJECT_ID.toString(),
        name: "Acme SSO",
        requireSsoForLogin: true,
        version: 1,
      },
    ] as Array<StoredRow>);
    users = useInMemoryTable(StatusPagePrivateUserService, []);
    jest
      .spyOn(StatusPageService, "getStatusPageURL")
      .mockResolvedValue("https://status.acme.com");
  });

  test("one address added and removed: ten invitations in an hour, then refused before anything is written", async () => {
    const outcomes: Array<unknown> = await addAndRemove(25);

    expect(
      outcomes.filter((outcome: unknown): boolean => {
        return outcome === "sent";
      }),
    ).toHaveLength(10);
    expect(mailsOf(EmailTemplateType.StatusPageWelcomeEmail)).toHaveLength(10);
    expect(outcomes[10]).toBeInstanceOf(PublicMessageRateLimitException);
    expect((outcomes[10] as Error).message).toBe(INVITATION_REFUSAL);
    expect(users.inserts).toHaveLength(10);
  });

  test("one count with the invitations to projects: ten in all", async () => {
    // Five invitations this hour from the page's own project to the address.
    for (let round: number = 0; round < 5; round++) {
      await PublicMessageRateLimit.assertTeamMaySend({
        kind: TeamMessageKind.Invitation,
        projectId: PROJECT_ID,
        contacts: [PublicMessageRateLimit.forEmail(ADDRESS)],
      });
    }

    const outcomes: Array<unknown> = await addAndRemove(8);

    expect(
      outcomes.filter((outcome: unknown): boolean => {
        return outcome === "sent";
      }),
    ).toHaveLength(5);
  });

  test("a user who signs in with SSO is sent no invitation, and is never counted", async () => {
    await addAndRemove(15, (): StatusPagePrivateUser => {
      const user: StatusPagePrivateUser = privateUser();
      user.isSsoUser = true;
      return user;
    });

    expect(mailsOf(EmailTemplateType.StatusPageWelcomeEmail)).toHaveLength(0);
    expect(invitationsCountedFor(ADDRESS)).toBe(0);
  });

  test("a page that takes only SSO sends no invitation, and nothing is counted", async () => {
    await addAndRemove(15, (): StatusPagePrivateUser => {
      return privateUser(ADDRESS, SSO_PAGE_ID);
    });

    expect(mailsOf(EmailTemplateType.StatusPageWelcomeEmail)).toHaveLength(0);
    expect(invitationsCountedFor(ADDRESS)).toBe(0);
  });

  test("an add whose INSERT fails sends nothing and gives its count back", async () => {
    (users.repository.save as MockedFn).mockRejectedValueOnce(
      new Error("connection lost"),
    );

    await expect(add(privateUser())).rejects.toThrow("connection lost");

    expect(mailsOf(EmailTemplateType.StatusPageWelcomeEmail)).toHaveLength(0);
    expect(invitationsCountedFor(ADDRESS)).toBe(0);
  });

  test("an address invited already to the page is refused as before, and costs it nothing", async () => {
    await add(privateUser());

    await expect(add(privateUser())).rejects.toThrow(
      "This user is already invited to this status page.",
    );

    expect(invitationsCountedFor(ADDRESS)).toBe(1);
  });

  test("a hundred readers added at once are all invited", async () => {
    for (let index: number = 0; index < 100; index++) {
      await add(privateUser(`reader${index}@example.com`));
    }

    expect(mailsOf(EmailTemplateType.StatusPageWelcomeEmail)).toHaveLength(100);
  });
});
