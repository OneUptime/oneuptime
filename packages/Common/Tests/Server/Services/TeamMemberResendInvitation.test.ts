import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * RESEND INVITATION (#9519): A PENDING PERSON'S INVITATION EMAIL, SENT AGAIN.
 *
 * Inviting the same address to the same team is refused while the
 * invitation waits, so an invitation whose email never reached its person
 * could only be sent again by removing them and inviting them back.
 * TeamMemberService.resendInvitation sends the InviteMember email again
 * from their row:
 *
 *   - the same email a new invitation sends, with a new sign-up link and
 *     registration token for someone who has not signed up, the sign-in
 *     link for someone who has, and the person sending it named;
 *   - for whoever may invite to that team, by their own permissions;
 *   - held to the per-address limit every invitation is held to, with when
 *     to come back;
 *   - never for a membership that is gone or another project's, someone who
 *     has joined, or on a server with no email set up;
 *   - one at a time: a second press while the first is with the mail
 *     service sends nothing more;
 *   - waited for: the address it went to, or why it did not go - and a
 *     send the mail service refused gives the address its count back.
 */

let mockIsBillingEnabled: boolean = false;

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  return {
    ...actual,
    get IsBillingEnabled(): boolean {
      return mockIsBillingEnabled;
    },
  };
});

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

import EmailVerificationToken from "../../../Models/DatabaseModels/EmailVerificationToken";
import Project from "../../../Models/DatabaseModels/Project";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import Redis from "../../../Server/Infrastructure/Redis";
import Semaphore, {
  SemaphoreLockTimeoutError,
  SemaphoreMutex,
} from "../../../Server/Infrastructure/Semaphore";
import EmailVerificationTokenService from "../../../Server/Services/EmailVerificationTokenService";
import MailService from "../../../Server/Services/MailService";
import ProjectService from "../../../Server/Services/ProjectService";
import TeamMemberService, {
  RESEND_INVITATION_LOCK_NAMESPACE,
} from "../../../Server/Services/TeamMemberService";
import TeamPermissionService from "../../../Server/Services/TeamPermissionService";
import UserService from "../../../Server/Services/UserService";
import PublicMessageRateLimit, {
  PublicMessageRateLimitException,
  TeamMessageKind,
} from "../../../Server/Utils/RateLimit/PublicMessageRateLimit";
import ServerSendingStatus from "../../../Server/Utils/ServerSending/ServerSendingStatus";
import InvitationInviterUtil from "../../../Server/Utils/TeamMember/InvitationInviter";
import EmptyResponseData from "../../../Types/API/EmptyResponse";
import Hostname from "../../../Types/API/Hostname";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Protocol from "../../../Types/API/Protocol";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "../../../Types/Email";
import EmailMessage from "../../../Types/Email/EmailMessage";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import HashedString from "../../../Types/HashedString";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import UserType from "../../../Types/UserType";
import {
  RESEND_INVITATION_LOCK_TIMEOUT_IN_MS,
  RESEND_INVITATION_REFUSALS,
  RESEND_INVITATION_SEND_TIMEOUT_IN_MS,
  ResentInvitation,
} from "../../../Types/Team/ResendInvitation";
import FakeCounterRedis from "../TestingUtils/Redis/FakeCounterRedis";

type MockedFn = ReturnType<typeof jest.fn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "95190000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "95190000-0000-4000-8000-000000000002",
);
const TEAM_ID: ObjectID = new ObjectID("95190000-0000-4000-8000-000000000003");
const MEMBERSHIP_ID: ObjectID = new ObjectID(
  "95190000-0000-4000-8000-000000000004",
);
const GRACE_ID: ObjectID = new ObjectID("95190000-0000-4000-8000-000000000005");
const ADA_ID: ObjectID = new ObjectID("95190000-0000-4000-8000-000000000006");

const GRACE_EMAIL: string = "grace@example.com";
const PROJECT_NAME: string = "Acme Production";

const INVITER: { name: string; email: string } = {
  name: "Ada Walker",
  email: "ada@example.com",
};

const TOO_MANY: string =
  "Too many invitations were sent to this email address in the last hour. Please try again later.";

let redis: FakeCounterRedis;
let sendMail: MockedFn;
let mintToken: MockedFn;
let lock: MockedFn;
let release: MockedFn;
let checkCallerMayCreate: MockedFn;
let assertCanGrant: MockedFn;
let membership: TeamMember | null;
let grace: User | null;
let isMemberOfProject: boolean;
let isEmailNotSetUp: boolean;
let currentTime: number;
let testIndex: number = 0;

// Ada, a project admin, resending from Settings > Users.
function adminProps(): DatabaseCommonInteractionProps {
  return {
    userId: ADA_ID,
    tenantId: PROJECT_ID,
  } as DatabaseCommonInteractionProps;
}

// A master admin, in the Admin Dashboard: in no project.
function masterAdminProps(): DatabaseCommonInteractionProps {
  return {
    userId: ADA_ID,
    isMasterAdmin: true,
    userType: UserType.MasterAdmin,
  } as DatabaseCommonInteractionProps;
}

function pendingMembership(): TeamMember {
  const row: TeamMember = new TeamMember(MEMBERSHIP_ID);
  row.projectId = PROJECT_ID;
  row.teamId = TEAM_ID;
  row.userId = GRACE_ID;
  row.hasAcceptedInvitation = false;
  return row;
}

// Grace has not signed up yet: her account has no password.
function invitedGrace(): User {
  const user: User = new User(GRACE_ID);
  user.email = new Email(GRACE_EMAIL);
  return user;
}

function resend(
  props: DatabaseCommonInteractionProps = adminProps(),
  projectId: ObjectID | null = PROJECT_ID,
): Promise<ResentInvitation> {
  return TeamMemberService.resendInvitation({
    teamMemberId: MEMBERSHIP_ID,
    projectId: projectId,
    props: props,
  });
}

function sentMails(): Array<EmailMessage> {
  return sendMail.mock.calls.map((call: Array<unknown>): EmailMessage => {
    return call[0] as EmailMessage;
  });
}

function sentOptions(): Array<Record<string, unknown>> {
  return sendMail.mock.calls.map(
    (call: Array<unknown>): Record<string, unknown> => {
      return call[1] as Record<string, unknown>;
    },
  );
}

// The invitations counted for Grace's address in this hour.
function invitationsCounted(): number {
  return redis.count(
    PublicMessageRateLimit.getContactCounterKey({
      counterName: TeamMessageKind.Invitation,
      contact: PublicMessageRateLimit.forEmail(GRACE_EMAIL),
    }),
  );
}

async function refusalOf(
  promise: Promise<unknown>,
): Promise<Error | undefined> {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }

  return undefined;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIsBillingEnabled = false;

  redis = new FakeCounterRedis();
  (Redis.getClient as unknown as MockedFn).mockReturnValue(redis);
  (Redis.isConnected as unknown as MockedFn).mockReturnValue(true);

  testIndex++;
  currentTime = Date.UTC(2034, 0, 1) + testIndex * 24 * 60 * 60 * 1000;
  jest.spyOn(Date, "now").mockImplementation((): number => {
    return currentTime;
  });

  membership = pendingMembership();
  grace = invitedGrace();
  isMemberOfProject = false;
  isEmailNotSetUp = false;

  jest
    .spyOn(TeamMemberService, "findOneById")
    .mockImplementation(async (): Promise<TeamMember | null> => {
      return membership;
    });
  checkCallerMayCreate = jest
    .spyOn(TeamMemberService, "checkCallerMayCreate")
    .mockResolvedValue(undefined) as unknown as MockedFn;
  assertCanGrant = jest
    .spyOn(TeamPermissionService, "assertCanGrantTeamPermissions")
    .mockResolvedValue(undefined) as unknown as MockedFn;
  jest
    .spyOn(TeamMemberService, "isUserMemberOfProject")
    .mockImplementation(async (): Promise<boolean> => {
      return isMemberOfProject;
    });
  jest
    .spyOn(UserService, "findOneById")
    .mockImplementation(async (): Promise<User | null> => {
      return grace;
    });
  jest
    .spyOn(ServerSendingStatus, "isEmailKnownNotSetUp")
    .mockImplementation(async (): Promise<boolean> => {
      return isEmailNotSetUp;
    });
  jest.spyOn(InvitationInviterUtil, "read").mockResolvedValue(INVITER);
  jest
    .spyOn(ProjectService, "findOneById")
    .mockResolvedValue({ name: PROJECT_NAME } as Project);
  jest
    .spyOn(DatabaseConfig, "getHost")
    .mockResolvedValue(new Hostname("oneuptime.example.com"));
  jest
    .spyOn(DatabaseConfig, "getHttpProtocol")
    .mockResolvedValue(Protocol.HTTPS);
  mintToken = jest
    .spyOn(EmailVerificationTokenService, "create")
    .mockResolvedValue(new EmailVerificationToken()) as unknown as MockedFn;

  lock = jest
    .spyOn(Semaphore, "lock")
    .mockResolvedValue({} as SemaphoreMutex) as unknown as MockedFn;
  release = jest
    .spyOn(Semaphore, "release")
    .mockResolvedValue(undefined) as unknown as MockedFn;

  sendMail = jest
    .spyOn(MailService, "sendMail")
    .mockResolvedValue(
      new HTTPResponse<EmptyResponseData>(200, {}, {}),
    ) as unknown as MockedFn;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the email it sends", () => {
  test("is the invitation email again, to the person's address, with a new sign-up link and token", async () => {
    await expect(resend()).resolves.toEqual({ email: GRACE_EMAIL });

    expect(sentMails()).toHaveLength(1);

    const mail: EmailMessage = sentMails()[0]!;

    expect(mail.templateType).toBe(EmailTemplateType.InviteMember);
    expect(mail.toEmail.toString()).toBe(GRACE_EMAIL);
    expect(mail.vars["isNewUser"]).toBe("true");
    expect(mail.vars["isInvitationAccepted"]).toBe("false");
    expect(mail.vars["projectName"]).toBe(PROJECT_NAME);
    // A registration token minted for this email, as a new invitation mints one.
    expect(mintToken).toHaveBeenCalledTimes(1);
    expect(mail.vars["registerLink"]).toMatch(
      /^https:\/\/oneuptime\.example\.com\/accounts\/register\?email=grace%40example\.com&token=[0-9a-f-]{36}$/,
    );
  });

  test("names the person who sent it again, in the subject and the first line", async () => {
    await resend();

    const mail: EmailMessage = sentMails()[0]!;

    expect(mail.subject).toBe(`Ada Walker invited you to ${PROJECT_NAME}`);
    expect(mail.isSubjectLiteral).toBe(true);
    expect(mail.vars["inviterName"]).toBe("Ada Walker");
    expect(mail.vars["inviterLabel"]).toBe("Ada Walker (ada@example.com)");
    expect(InvitationInviterUtil.read).toHaveBeenCalledWith({
      props: adminProps(),
      inviteeUserId: GRACE_ID,
    });
  });

  test("someone who has signed up since is sent the sign-in link, with no token", async () => {
    grace!.password = new HashedString("signed-up", true);

    await resend();

    const mail: EmailMessage = sentMails()[0]!;

    expect(mail.vars["isNewUser"]).toBe("false");
    expect(mail.vars["registerLink"]).toBe(
      "https://oneuptime.example.com/accounts/register?email=grace%40example.com",
    );
    expect(mintToken).not.toHaveBeenCalled();
  });

  test("is the project's, so its Email Log row says Invitation Sent again once it went", async () => {
    await resend();

    expect(sentOptions()[0]).toEqual({
      projectId: PROJECT_ID,
      userId: GRACE_ID,
      timeoutInMs: RESEND_INVITATION_SEND_TIMEOUT_IN_MS,
    });
  });

  test("on a self-hosted server, a reply reaches the person who sent it", async () => {
    mockIsBillingEnabled = false;

    await resend();

    expect(sentMails()[0]!.replyToEmail?.toString()).toBe(INVITER.email);
  });

  test("on OneUptime Cloud, a reply goes where it always went", async () => {
    mockIsBillingEnabled = true;

    await resend();

    expect(sentMails()[0]!.replyToEmail).toBeUndefined();
  });
});

describe("who may send it", () => {
  test("whoever may invite to that team, asked with their own props, of that team in that project", async () => {
    await resend();

    expect(checkCallerMayCreate).toHaveBeenCalledTimes(1);

    const asked: { data: TeamMember; props: DatabaseCommonInteractionProps } =
      checkCallerMayCreate.mock.calls[0]![0] as {
        data: TeamMember;
        props: DatabaseCommonInteractionProps;
      };

    expect(asked.props).toEqual(adminProps());
    expect(asked.data.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(asked.data.teamId?.toString()).toBe(TEAM_ID.toString());
    expect(asked.data.userId?.toString()).toBe(GRACE_ID.toString());
    // And whether they may hand on that team's permissions.
    expect(assertCanGrant).toHaveBeenCalledWith({
      teamId: TEAM_ID,
      projectId: PROJECT_ID,
      props: adminProps(),
    });
  });

  test("someone who may not invite to that team is refused, and nothing is counted, minted or sent", async () => {
    checkCallerMayCreate.mockRejectedValue(
      new NotAuthorizedException(
        "You do not have permissions to create Team Member.",
      ) as never,
    );

    const refusal: Error | undefined = await refusalOf(resend());

    expect(refusal).toBeInstanceOf(NotAuthorizedException);
    expect(sendMail).not.toHaveBeenCalled();
    expect(mintToken).not.toHaveBeenCalled();
    expect(invitationsCounted()).toBe(0);
  });

  test("someone who may not hand on the team's permissions is refused before anything is sent", async () => {
    assertCanGrant.mockRejectedValue(
      new NotAuthorizedException(
        "You cannot grant Project Owner because your own access does not include that permission at an equal or broader scope.",
      ) as never,
    );

    await expect(resend()).rejects.toBeInstanceOf(NotAuthorizedException);
    expect(sendMail).not.toHaveBeenCalled();
    expect(invitationsCounted()).toBe(0);
  });

  test("by the real permission check: a viewer of the project may not invite, so may not resend", async () => {
    checkCallerMayCreate.mockRestore();

    const viewer: DatabaseCommonInteractionProps = {
      userId: ADA_ID,
      tenantId: PROJECT_ID,
      userType: UserType.User,
      userTenantAccessPermission: {
        [PROJECT_ID.toString()]: {
          _type: "UserTenantAccessPermission",
          projectId: PROJECT_ID,
          permissions: [
            {
              _type: "UserPermission",
              permission: Permission.Viewer,
              labelIds: [],
              scope: PermissionScope.All,
              isBlockPermission: false,
            },
          ],
        },
      },
    } as unknown as DatabaseCommonInteractionProps;

    const refusal: Error | undefined = await refusalOf(resend(viewer));

    expect(refusal).toBeInstanceOf(NotAuthorizedException);
    // Refused for creating team members: what inviting takes.
    expect(refusal?.message).toContain("Team Member");
    expect(sendMail).not.toHaveBeenCalled();
    expect(invitationsCounted()).toBe(0);
  });

  test("a master admin, in the Admin Dashboard, sends it in the membership's own project", async () => {
    await expect(resend(masterAdminProps(), null)).resolves.toEqual({
      email: GRACE_EMAIL,
    });
    expect(sentOptions()[0]!["projectId"]).toEqual(PROJECT_ID);
  });
});

describe("when there is nothing to send", () => {
  test("someone who accepted already has no invitation waiting: refused, nothing sent or counted", async () => {
    membership!.hasAcceptedInvitation = true;

    const refusal: Error | undefined = await refusalOf(resend());

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal?.message).toBe(RESEND_INVITATION_REFUSALS.joined);
    expect(sendMail).not.toHaveBeenCalled();
    expect(invitationsCounted()).toBe(0);
  });

  test("someone who joined through another team of the project is refused alike", async () => {
    isMemberOfProject = true;

    await expect(resend()).rejects.toThrow(RESEND_INVITATION_REFUSALS.joined);
    expect(sendMail).not.toHaveBeenCalled();
  });

  test("someone removed meanwhile: their invitation is gone, and nothing is sent", async () => {
    membership = null;

    const refusal: Error | undefined = await refusalOf(resend());

    expect(refusal).toBeInstanceOf(NotFoundException);
    expect(refusal?.message).toBe(RESEND_INVITATION_REFUSALS.notInvited);
    expect(checkCallerMayCreate).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
    expect(invitationsCounted()).toBe(0);
  });

  test("another project's invitation is answered as one that is gone, telling nothing about it", async () => {
    membership!.projectId = OTHER_PROJECT_ID;

    const refusal: Error | undefined = await refusalOf(resend());

    expect(refusal).toBeInstanceOf(NotFoundException);
    expect(refusal?.message).toBe(RESEND_INVITATION_REFUSALS.notInvited);
    expect(checkCallerMayCreate).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  test("an account gone with its address is answered as an invitation that is gone", async () => {
    grace = null;

    await expect(resend()).rejects.toThrow(
      RESEND_INVITATION_REFUSALS.notInvited,
    );
    expect(sendMail).not.toHaveBeenCalled();
  });

  test("a project gone since gives the address its count back", async () => {
    (ProjectService.findOneById as unknown as MockedFn).mockResolvedValue(
      null as never,
    );

    await expect(resend()).rejects.toThrow(
      RESEND_INVITATION_REFUSALS.notInvited,
    );
    expect(sendMail).not.toHaveBeenCalled();
    expect(invitationsCounted()).toBe(0);
  });
});

describe("a server that cannot send email at all", () => {
  test("sends nothing, counts nothing, and says who can fix it", async () => {
    isEmailNotSetUp = true;

    const refusal: Error | undefined = await refusalOf(resend());

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal?.message).toBe(RESEND_INVITATION_REFUSALS.emailNotSetUp);
    expect(refusal?.message).toContain("Ask your server's admin");
    expect(sendMail).not.toHaveBeenCalled();
    expect(mintToken).not.toHaveBeenCalled();
    expect(invitationsCounted()).toBe(0);
  });

  test("tells a master admin where to set it up, and the link that works meanwhile", async () => {
    isEmailNotSetUp = true;

    await expect(resend(masterAdminProps(), null)).rejects.toThrow(
      RESEND_INVITATION_REFUSALS.emailNotSetUpForMasterAdmin,
    );
    expect(sendMail).not.toHaveBeenCalled();
  });
});

describe("the per-address limit", () => {
  test("is the one every invitation is held to: counted with them", async () => {
    await resend();

    expect(invitationsCounted()).toBe(1);
  });

  test("past it, refused with when to come back, and nothing is minted or sent", async () => {
    for (let round: number = 0; round < 10; round++) {
      await resend();
    }

    expect(sentMails()).toHaveLength(10);

    const refusal: Error | undefined = await refusalOf(resend());

    expect(refusal).toBeInstanceOf(PublicMessageRateLimitException);
    expect(refusal?.message).toBe(TOO_MANY);
    expect(
      (refusal as PublicMessageRateLimitException).retryAfterSeconds,
    ).toBeGreaterThan(0);
    expect(
      (refusal as PublicMessageRateLimitException).retryAfterSeconds,
    ).toBeLessThanOrEqual(60 * 60);
    expect(sentMails()).toHaveLength(10);
    expect(mintToken).toHaveBeenCalledTimes(10);
  });

  test("an hour on, it may be sent again", async () => {
    for (let round: number = 0; round < 11; round++) {
      await resend().catch((): void => {});
    }

    currentTime += 60 * 60 * 1000;

    await expect(resend()).resolves.toEqual({ email: GRACE_EMAIL });
    expect(sentMails()).toHaveLength(11);
  });
});

describe("what the mail service says", () => {
  test("a refusal says the email was not sent, in OneUptime's words then its own, and gives the count back", async () => {
    sendMail.mockResolvedValue(
      new HTTPErrorResponse(
        400,
        { message: "535 5.7.8 Authentication failed" },
        {},
      ) as never,
    );

    const refusal: Error | undefined = await refusalOf(resend());

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal?.message).toBe(
      `The invitation email to ${GRACE_EMAIL} was not sent. 535 5.7.8 Authentication failed`,
    );
    expect(invitationsCounted()).toBe(0);
  });

  test("no answer in time: it may still go out, so nobody is told it did not, and the count stays", async () => {
    sendMail.mockRejectedValue(
      new Error(
        "Request failed to notification. Connection timed out",
      ) as never,
    );

    const refusal: Error | undefined = await refusalOf(resend());

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal?.message).toContain("may not have been sent");
    expect(refusal?.message).toContain(GRACE_EMAIL);
    expect(invitationsCounted()).toBe(1);
  });
});

describe("one at a time", () => {
  test("holds the person's invitation in the project while it is sent, and gives it back", async () => {
    await resend();

    expect(lock).toHaveBeenCalledTimes(1);
    expect(lock).toHaveBeenCalledWith(
      expect.objectContaining({
        key: `${PROJECT_ID.toString()}-${GRACE_ID.toString()}`,
        namespace: RESEND_INVITATION_LOCK_NAMESPACE,
        lockTimeout: RESEND_INVITATION_LOCK_TIMEOUT_IN_MS,
        acquireAttemptsLimit: 1,
      }),
    );
    expect(release).toHaveBeenCalledTimes(1);
  });

  test("gives it back when the send failed too", async () => {
    sendMail.mockResolvedValue(
      new HTTPErrorResponse(400, { message: "Mailbox full" }, {}) as never,
    );

    await refusalOf(resend());

    expect(release).toHaveBeenCalledTimes(1);
  });

  test("a double click sends once: the second press, while the first is being sent, is refused", async () => {
    let releaseFirstSend: (() => void) | null = null;
    let isHeld: boolean = false;

    lock.mockImplementation(async (): Promise<SemaphoreMutex> => {
      if (isHeld) {
        throw new SemaphoreLockTimeoutError("Acquire timeout");
      }

      isHeld = true;
      return {} as SemaphoreMutex;
    });
    release.mockImplementation(async (): Promise<void> => {
      isHeld = false;
    });
    sendMail.mockImplementation((async (): Promise<
      HTTPResponse<EmptyResponseData>
    > => {
      await new Promise<void>((resolve: () => void) => {
        releaseFirstSend = resolve;
      });
      return new HTTPResponse<EmptyResponseData>(200, {}, {});
    }) as never);

    const first: Promise<ResentInvitation> = resend();

    // The first is with the mail service now.
    await new Promise<void>((resolve: () => void) => {
      const wait: () => void = (): void => {
        if (releaseFirstSend) {
          resolve();
          return;
        }

        setTimeout(wait, 0);
      };

      wait();
    });

    const second: Error | undefined = await refusalOf(resend());

    expect(second).toBeInstanceOf(BadDataException);
    expect(second?.message).toBe(RESEND_INVITATION_REFUSALS.alreadySending);

    releaseFirstSend!();

    await expect(first).resolves.toEqual({ email: GRACE_EMAIL });
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(invitationsCounted()).toBe(1);
  });

  test("without Valkey, it is sent unlocked rather than refused", async () => {
    lock.mockRejectedValue(new Error("Redis client is not connected") as never);

    await expect(resend()).resolves.toEqual({ email: GRACE_EMAIL });
    expect(release).not.toHaveBeenCalled();
  });
});
