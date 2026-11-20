import EmailVerificationToken from "../../../Models/DatabaseModels/EmailVerificationToken";
import Project from "../../../Models/DatabaseModels/Project";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import EmailVerificationTokenService from "../../../Server/Services/EmailVerificationTokenService";
import MailService from "../../../Server/Services/MailService";
import ProjectSCIMService from "../../../Server/Services/ProjectSCIMService";
import ProjectService from "../../../Server/Services/ProjectService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamPermissionService from "../../../Server/Services/TeamPermissionService";
import TeamService from "../../../Server/Services/TeamService";
import UserService from "../../../Server/Services/UserService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import Errors from "../../../Server/Utils/Errors";
import InvitationInviterUtil from "../../../Server/Utils/TeamMember/InvitationInviter";
import { IsBillingEnabled } from "../../../Server/EnvironmentConfig";
import PublicMessageRateLimit, {
  PublicMessageSendPermit,
  TeamMessageKind,
} from "../../../Server/Utils/RateLimit/PublicMessageRateLimit";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "../../../Types/Email";
import EmailMessage from "../../../Types/Email/EmailMessage";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import HashedString from "../../../Types/HashedString";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

/*
 * A MEMBERSHIP MADE FOR A PERSON PICKED BY ID EMAILS THEM (#8421).
 *
 * An invitation by address - Users > Invite User, a team's Members >
 * Invite, the Admin Dashboard's project Users > Invite User - sends the
 * person the InviteMember email. A membership made for a person picked by
 * id sent nothing, on any server: the Admin Dashboard's Add to Project on a
 * user and on several users at once, and a membership made through the API
 * by user id. The membership waited for them, unless it was accepted for
 * them, and they found out only if they happened to sign in; someone with no
 * account yet was never sent their link.
 *
 * Now the person is sent the same email, by the same rules: the sign-up link
 * with its token while their account has no password, the sign-in link once
 * it has one, "You've Been Added to ..." when the membership is accepted on
 * create, and the same per-address limit. Not for OneUptime's own writes,
 * which decide whom they email (SCIM names the address itself), not for the
 * person who makes it for themselves, and not for someone who has a
 * membership in the project already: they have their invitation, or are in.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "81000000-0000-4000-8000-000000000001",
);
const TEAM_ID: ObjectID = new ObjectID("81000000-0000-4000-8000-000000000002");
const PERSON_ID: ObjectID = new ObjectID(
  "81000000-0000-4000-8000-000000000003",
);
const ADMIN_ID: ObjectID = new ObjectID("81000000-0000-4000-8000-000000000004");

const PERSON_EMAIL: Email = new Email("person@company.com");
const PROJECT_NAME: string = "Acme Production";

// Calls a protected hook without widening the service's public surface.
function callHook(name: string, ...args: Array<unknown>): Promise<unknown> {
  const hooks: Record<
    string,
    (...hookArgs: Array<unknown>) => Promise<unknown>
  > = TeamMemberService as unknown as Record<
    string,
    (...hookArgs: Array<unknown>) => Promise<unknown>
  >;

  return hooks[name]!.apply(TeamMemberService, args);
}

// A master admin acting from the Admin Dashboard: Add to Project.
function masterAdminProps(): DatabaseCommonInteractionProps {
  return {
    isMasterAdmin: true,
    userId: ADMIN_ID,
  } as DatabaseCommonInteractionProps;
}

// A project admin, in their project: the API by user id.
function projectAdminProps(): DatabaseCommonInteractionProps {
  return {
    userId: ADMIN_ID,
    tenantId: PROJECT_ID,
  } as DatabaseCommonInteractionProps;
}

// An API key: a request with no person behind it.
function apiKeyProps(): DatabaseCommonInteractionProps {
  return { tenantId: PROJECT_ID } as DatabaseCommonInteractionProps;
}

function rootProps(): DatabaseCommonInteractionProps {
  return { isRoot: true } as DatabaseCommonInteractionProps;
}

function addById(data: {
  props: DatabaseCommonInteractionProps;
  hasAcceptedInvitation?: boolean | undefined;
  email?: string | undefined;
  userId?: ObjectID | undefined;
}): CreateBy<TeamMember> {
  const member: TeamMember = new TeamMember();
  member.projectId = PROJECT_ID;
  member.teamId = TEAM_ID;
  member.userId = data.userId || PERSON_ID;

  if (data.hasAcceptedInvitation !== undefined) {
    member.hasAcceptedInvitation = data.hasAcceptedInvitation;
  }

  const create: CreateBy<TeamMember> = {
    data: member,
    props: data.props,
  } as CreateBy<TeamMember>;

  if (data.email) {
    create.miscDataProps = { email: data.email };
  }

  return create;
}

// Somebody who has signed up: an account with a password.
function signedUpPerson(): User {
  const user: User = new User(PERSON_ID);
  user._id = PERSON_ID.toString();
  user.email = PERSON_EMAIL;
  user.password = new HashedString("already-registered", true);

  return user;
}

// Somebody who has not signed up yet: an account with no password.
function notSignedUpPerson(): User {
  const user: User = new User(PERSON_ID);
  user._id = PERSON_ID.toString();
  user.email = PERSON_EMAIL;

  return user;
}

let sendMailSpy: jest.SpyInstance;
let createTokenSpy: jest.SpyInstance;
let findPersonSpy: jest.SpyInstance;
let findByEmailSpy: jest.SpyInstance;
let hasMembershipSpy: jest.SpyInstance;
let isMemberSpy: jest.SpyInstance;
let duplicateLookupSpy: jest.SpyInstance;
let askSpy: jest.SpyInstance;
let giveBackSpy: jest.Mock;

beforeEach(() => {
  stubProjectDirectory({});

  /*
   * Who invited them is read as its own account (InvitationInviter), held
   * on its own below: here the invitation names nobody.
   */
  jest.spyOn(InvitationInviterUtil, "read").mockResolvedValue(null);

  jest.spyOn(TeamService, "findOneBy").mockResolvedValue(new Team(TEAM_ID));
  jest
    .spyOn(TeamPermissionService, "assertCanGrantTeamPermissions")
    .mockResolvedValue(undefined);
  jest
    .spyOn(ProjectSCIMService, "countBy")
    .mockResolvedValue(new PositiveNumber(0));
  jest
    .spyOn(TeamMemberService, "getUniqueTeamMemberCountInProject")
    .mockResolvedValue(1);

  // Not on this team: the duplicate-invite guard lets it through.
  duplicateLookupSpy = jest
    .spyOn(TeamMemberService, "findOneBy")
    .mockResolvedValue(null);

  // Not in the project at all, unless a test says otherwise.
  hasMembershipSpy = jest
    .spyOn(
      TeamMemberService as unknown as {
        hasMembershipInProject: (data: unknown) => Promise<boolean>;
      },
      "hasMembershipInProject",
    )
    .mockResolvedValue(false);
  isMemberSpy = jest
    .spyOn(TeamMemberService, "isUserMemberOfProject")
    .mockResolvedValue(false);

  jest
    .spyOn(ProjectService, "findOneById")
    .mockResolvedValue({ name: PROJECT_NAME } as Project);
  jest
    .spyOn(DatabaseConfig, "getHost")
    .mockResolvedValue(new Hostname("oneuptime.test"));
  jest
    .spyOn(DatabaseConfig, "getHttpProtocol")
    .mockResolvedValue(Protocol.HTTPS);

  sendMailSpy = jest
    .spyOn(MailService, "sendMail")
    .mockResolvedValue(undefined as never);

  createTokenSpy = jest
    .spyOn(EmailVerificationTokenService, "create")
    .mockImplementation(async (data: unknown): Promise<never> => {
      const token: EmailVerificationToken = (
        data as { data: EmailVerificationToken }
      ).data;
      return token as never;
    });

  findPersonSpy = jest
    .spyOn(UserService, "findOneById")
    .mockResolvedValue(signedUpPerson());
  findByEmailSpy = jest
    .spyOn(UserService, "findOneBy")
    .mockResolvedValue(signedUpPerson());
  jest
    .spyOn(UserService, "createByEmail")
    .mockResolvedValue(notSignedUpPerson());

  giveBackSpy = jest.fn(async (): Promise<void> => {});
  askSpy = jest
    .spyOn(PublicMessageRateLimit, "assertTeamMaySend")
    .mockResolvedValue({
      giveBack: giveBackSpy,
    } as unknown as PublicMessageSendPermit);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function mails(): Array<EmailMessage> {
  return sendMailSpy.mock.calls.map((call: Array<unknown>): EmailMessage => {
    return call[0] as EmailMessage;
  });
}

function sentMail(): EmailMessage {
  expect(sendMailSpy).toHaveBeenCalledTimes(1);

  return mails()[0]!;
}

describe("Add to Project: a person who has signed up is emailed the invitation", () => {
  test("one InviteMember email, to the account's own address (the bug: none)", async () => {
    await callHook("onBeforeCreate", addById({ props: masterAdminProps() }));

    const mail: EmailMessage = sentMail();

    expect(mail.templateType).toBe(EmailTemplateType.InviteMember);
    expect(mail.toEmail.toString()).toBe(PERSON_EMAIL.toString());
  });

  test("it invites them, with the sign-in link: they have an account", async () => {
    await callHook("onBeforeCreate", addById({ props: masterAdminProps() }));

    const mail: EmailMessage = sentMail();

    expect(mail.subject).toBe(`You have been invited to ${PROJECT_NAME}`);
    expect(mail.isSubjectLiteral).toBe(true);
    expect(mail.vars["isInvitationAccepted"]).toBe("false");
    expect(mail.vars["isNewUser"]).toBe("false");
    expect(mail.vars["projectName"]).toBe(PROJECT_NAME);
    expect(mail.vars["signInLink"]).toBe("https://oneuptime.test/accounts");
    expect(mail.vars["homeUrl"]).toBe("https://oneuptime.test/");
  });

  test("no registration token is minted for an account that cannot be claimed", async () => {
    await callHook("onBeforeCreate", addById({ props: masterAdminProps() }));

    expect(createTokenSpy).not.toHaveBeenCalled();
    expect(sentMail().vars["registerLink"]).not.toContain("token=");
  });

  test("accepted for them, it says they have been added, with nothing to accept", async () => {
    await callHook(
      "onBeforeCreate",
      addById({ props: masterAdminProps(), hasAcceptedInvitation: true }),
    );

    const mail: EmailMessage = sentMail();

    expect(mail.subject).toBe(`You have been added to ${PROJECT_NAME}`);
    expect(mail.vars["isInvitationAccepted"]).toBe("true");
    expect(mail.vars["isNewUser"]).toBe("false");
  });

  test("the email is the project's and the person's, for its log", async () => {
    await callHook("onBeforeCreate", addById({ props: masterAdminProps() }));

    expect(sendMailSpy.mock.calls[0]![1]).toEqual({
      projectId: PROJECT_ID,
      userId: PERSON_ID,
    });
  });

  test("the person is read as OneUptime, for their address and whether they have signed up", async () => {
    await callHook("onBeforeCreate", addById({ props: masterAdminProps() }));

    expect(findPersonSpy).toHaveBeenCalledWith({
      id: PERSON_ID,
      select: { _id: true, email: true, password: true },
      props: { isRoot: true },
    });
  });

  test("the membership is still the one asked for: the same person and team", async () => {
    const create: CreateBy<TeamMember> = addById({
      props: masterAdminProps(),
    });

    await callHook("onBeforeCreate", create);

    expect(create.data.userId!.toString()).toBe(PERSON_ID.toString());
    expect(create.data.teamId!.toString()).toBe(TEAM_ID.toString());
    expect(create.data.hasAcceptedInvitation).toBeFalsy();
  });
});

describe("Add to Project: a person who has not signed up yet is sent their sign-up link", () => {
  beforeEach(() => {
    findPersonSpy.mockResolvedValue(notSignedUpPerson());
  });

  test("the email's button creates their account, and carries a registration token", async () => {
    await callHook("onBeforeCreate", addById({ props: masterAdminProps() }));

    const mail: EmailMessage = sentMail();

    expect(mail.vars["isNewUser"]).toBe("true");
    expect(mail.vars["registerLink"]).toContain("/accounts/register");
    expect(createTokenSpy).toHaveBeenCalledTimes(1);

    const token: EmailVerificationToken = createTokenSpy.mock.calls[0]![0][
      "data"
    ] as EmailVerificationToken;

    expect(mail.vars["registerLink"]).toContain(token.token!.toString());
  });

  test("the token is bound to this account and its address", async () => {
    await callHook("onBeforeCreate", addById({ props: masterAdminProps() }));

    const token: EmailVerificationToken = createTokenSpy.mock.calls[0]![0][
      "data"
    ] as EmailVerificationToken;

    expect(token.userId!.toString()).toBe(PERSON_ID.toString());
    expect(token.email!.toString()).toBe(PERSON_EMAIL.toString());
  });

  test("accepted for them, it says they were added and to create their account", async () => {
    await callHook(
      "onBeforeCreate",
      addById({ props: masterAdminProps(), hasAcceptedInvitation: true }),
    );

    const mail: EmailMessage = sentMail();

    expect(mail.subject).toBe(`You have been added to ${PROJECT_NAME}`);
    expect(mail.vars["isInvitationAccepted"]).toBe("true");
    expect(mail.vars["isNewUser"]).toBe("true");
  });

  test("no second account is made for them", async () => {
    await callHook("onBeforeCreate", addById({ props: masterAdminProps() }));

    expect(UserService.createByEmail).not.toHaveBeenCalled();
  });

  test("a token that cannot be minted fails the membership and gives the count back", async () => {
    createTokenSpy.mockRejectedValue(new Error("database away") as never);

    await expect(
      callHook("onBeforeCreate", addById({ props: masterAdminProps() })),
    ).rejects.toThrow("database away");

    expect(sendMailSpy).not.toHaveBeenCalled();
    expect(giveBackSpy).toHaveBeenCalledTimes(1);
  });
});

describe("whoever adds them by id, the person is told", () => {
  test.each([
    ["a master admin (Add to Project)", masterAdminProps],
    ["a project admin through the API", projectAdminProps],
    ["an API key", apiKeyProps],
  ])(
    "%s",
    async (_who: string, props: () => DatabaseCommonInteractionProps) => {
      await callHook("onBeforeCreate", addById({ props: props() }));

      expect(sentMail().toEmail.toString()).toBe(PERSON_EMAIL.toString());
    },
  );

  test("a person named by the relation rather than its id column is told too", async () => {
    const member: TeamMember = new TeamMember();
    member.projectId = PROJECT_ID;
    member.teamId = TEAM_ID;
    member.user = new User(PERSON_ID);

    await callHook("onBeforeCreate", {
      data: member,
      props: masterAdminProps(),
    } as CreateBy<TeamMember>);

    expect(sentMail().toEmail.toString()).toBe(PERSON_EMAIL.toString());
  });
});

describe("the invitation by id is held to the address's limit", () => {
  test("it asks for the person's address, as an invitation", async () => {
    await callHook("onBeforeCreate", addById({ props: masterAdminProps() }));

    expect(askSpy).toHaveBeenCalledTimes(1);
    expect(askSpy).toHaveBeenCalledWith({
      kind: TeamMessageKind.Invitation,
      contacts: [PublicMessageRateLimit.forEmail(PERSON_EMAIL)],
    });
  });

  test("past its limit the membership is refused, and nobody is emailed", async () => {
    askSpy.mockRejectedValue(new Error("Too many invitations") as never);

    await expect(
      callHook("onBeforeCreate", addById({ props: masterAdminProps() })),
    ).rejects.toThrow("Too many invitations");

    expect(sendMailSpy).not.toHaveBeenCalled();
    expect(createTokenSpy).not.toHaveBeenCalled();
  });

  test("a membership accepted for them is told, and not counted", async () => {
    await callHook(
      "onBeforeCreate",
      addById({ props: masterAdminProps(), hasAcceptedInvitation: true }),
    );

    expect(askSpy).not.toHaveBeenCalled();
    expect(sendMailSpy).toHaveBeenCalledTimes(1);
  });

  test("an add refused as already made sends nothing and gives the count back", async () => {
    duplicateLookupSpy.mockResolvedValue(new TeamMember(ObjectID.generate()));

    await expect(
      callHook("onBeforeCreate", addById({ props: masterAdminProps() })),
    ).rejects.toThrow(Errors.TeamMemberService.ALREADY_INVITED);

    expect(sendMailSpy).not.toHaveBeenCalled();
    expect(createTokenSpy).not.toHaveBeenCalled();
    expect(giveBackSpy).toHaveBeenCalledTimes(1);
  });
});

describe("who is not emailed about a membership made by id", () => {
  test("OneUptime's own writes (SSO, a marketplace, a new project's owner, SCIM's later teams)", async () => {
    await callHook("onBeforeCreate", addById({ props: rootProps() }));

    expect(sendMailSpy).not.toHaveBeenCalled();
    expect(findPersonSpy).not.toHaveBeenCalled();
    expect(hasMembershipSpy).not.toHaveBeenCalled();
    expect(askSpy).not.toHaveBeenCalled();
  });

  test("a person who adds themselves", async () => {
    await callHook(
      "onBeforeCreate",
      addById({ props: masterAdminProps(), userId: ADMIN_ID }),
    );

    expect(sendMailSpy).not.toHaveBeenCalled();
    expect(findPersonSpy).not.toHaveBeenCalled();
  });

  test("a member of the project, added to another team (Teams > Invite, Add to Team)", async () => {
    hasMembershipSpy.mockResolvedValue(true);
    isMemberSpy.mockResolvedValue(true);

    const create: CreateBy<TeamMember> = addById({
      props: projectAdminProps(),
    });

    await callHook("onBeforeCreate", create);

    expect(sendMailSpy).not.toHaveBeenCalled();
    expect(askSpy).not.toHaveBeenCalled();
    // Still on the team at once, with nothing to accept.
    expect(create.data.hasAcceptedInvitation).toBe(true);
  });

  test("a person invited already, added to another team: their invitation waits", async () => {
    hasMembershipSpy.mockResolvedValue(true);

    const create: CreateBy<TeamMember> = addById({
      props: projectAdminProps(),
    });

    await callHook("onBeforeCreate", create);

    expect(sendMailSpy).not.toHaveBeenCalled();
    expect(createTokenSpy).not.toHaveBeenCalled();
    expect(create.data.hasAcceptedInvitation).toBe(false);
  });

  test("the membership asked about is this project's and this person's", async () => {
    hasMembershipSpy.mockResolvedValue(true);

    await callHook("onBeforeCreate", addById({ props: masterAdminProps() }));

    expect(hasMembershipSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      userId: PERSON_ID,
    });
    expect(findPersonSpy).not.toHaveBeenCalled();
  });

  test("an account that is not there: nothing is sent, and nothing throws", async () => {
    findPersonSpy.mockResolvedValue(null);

    await expect(
      callHook("onBeforeCreate", addById({ props: masterAdminProps() })),
    ).resolves.toBeDefined();

    expect(sendMailSpy).not.toHaveBeenCalled();
    expect(askSpy).not.toHaveBeenCalled();
  });

  test("an account with no address: nothing is sent", async () => {
    const person: User = new User(PERSON_ID);
    person._id = PERSON_ID.toString();
    findPersonSpy.mockResolvedValue(person);

    await callHook("onBeforeCreate", addById({ props: masterAdminProps() }));

    expect(sendMailSpy).not.toHaveBeenCalled();
    expect(askSpy).not.toHaveBeenCalled();
  });
});

describe("a person named by address is emailed as before, once", () => {
  test("an invitation by address that also names an id sends one email, to the address", async () => {
    const otherAddress: Email = new Email("named@company.com");
    const named: User = signedUpPerson();
    named.email = otherAddress;
    findByEmailSpy.mockResolvedValue(named);

    await callHook(
      "onBeforeCreate",
      addById({ props: projectAdminProps(), email: otherAddress.toString() }),
    );

    expect(sentMail().toEmail.toString()).toBe(otherAddress.toString());
    /*
     * The by-id path is not asked: the address decides. That path reads the
     * person for their address and password (getInviteeToEmailById); the
     * email's own reads of the account by id - whether SSO manages them
     * (#9819), the language it picked (#9897) - are no part of it.
     */
    expect(hasMembershipSpy).not.toHaveBeenCalled();
    expect(findPersonSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ password: true }),
      }),
    );
  });

  /*
   * #8568: by address and by id now agree on a member who has signed up -
   * neither emails them about another team. By address, one who has not
   * signed up yet is still sent their way in, a new sign-up link (theirs
   * lasts 7 days), and a pending invitee a reminder: that form says it
   * emails them, and it is how an invitation is sent again.
   */
  test("a member who has signed up, named by address for another team, is not emailed, as by id", async () => {
    isMemberSpy.mockResolvedValue(true);
    hasMembershipSpy.mockResolvedValue(true);

    await callHook(
      "onBeforeCreate",
      addById({ props: projectAdminProps(), email: PERSON_EMAIL.toString() }),
    );
    await callHook("onBeforeCreate", addById({ props: projectAdminProps() }));

    expect(sendMailSpy).not.toHaveBeenCalled();
    expect(askSpy).not.toHaveBeenCalled();
  });

  test("a member who has not signed up yet, named by address, is sent a new sign-up link", async () => {
    isMemberSpy.mockResolvedValue(true);
    findByEmailSpy.mockResolvedValue(notSignedUpPerson());

    await callHook(
      "onBeforeCreate",
      addById({ props: projectAdminProps(), email: PERSON_EMAIL.toString() }),
    );

    const mail: EmailMessage = sentMail();

    expect(mail.subject).toBe(`You have been added to ${PROJECT_NAME}`);
    expect(mail.vars["isNewUser"]).toBe("true");
    expect(createTokenSpy).toHaveBeenCalledTimes(1);
    // Told, not invited: not counted.
    expect(askSpy).not.toHaveBeenCalled();
  });

  test("a pending invitee who has signed up, named by address for another team, is reminded and counted", async () => {
    // Invited to another team, not joined: not a member yet.
    isMemberSpy.mockResolvedValue(false);

    await callHook(
      "onBeforeCreate",
      addById({ props: projectAdminProps(), email: PERSON_EMAIL.toString() }),
    );

    expect(sentMail().subject).toBe(`You have been invited to ${PROJECT_NAME}`);
    expect(askSpy).toHaveBeenCalledTimes(1);
  });

  test("whether they are a member is asked only of an accepted membership by address with a password", async () => {
    // Not a member, not signed up, invited: nothing to ask at the send.
    findByEmailSpy.mockResolvedValue(notSignedUpPerson());

    await callHook(
      "onBeforeCreate",
      addById({ props: projectAdminProps(), email: PERSON_EMAIL.toString() }),
    );

    // By the per-address limit and by the acceptance; the send asks nothing.
    expect(isMemberSpy).toHaveBeenCalledTimes(2);
    expect(sendMailSpy).toHaveBeenCalledTimes(1);
  });
});

describe("TeamMemberService.getInviteeToEmailById", () => {
  test("no person named: nobody, and nothing read", async () => {
    await expect(
      TeamMemberService.getInviteeToEmailById({
        props: masterAdminProps(),
        projectId: PROJECT_ID,
        userId: null,
      }),
    ).resolves.toBeNull();

    expect(hasMembershipSpy).not.toHaveBeenCalled();
    expect(findPersonSpy).not.toHaveBeenCalled();
  });

  test("OneUptime's own write: nobody, and nothing read", async () => {
    await expect(
      TeamMemberService.getInviteeToEmailById({
        props: rootProps(),
        projectId: PROJECT_ID,
        userId: PERSON_ID,
      }),
    ).resolves.toBeNull();

    expect(hasMembershipSpy).not.toHaveBeenCalled();
  });

  test("the person themselves, their id spelled in capitals: nobody", async () => {
    await expect(
      TeamMemberService.getInviteeToEmailById({
        props: { userId: new ObjectID(PERSON_ID.toString().toUpperCase()) },
        projectId: PROJECT_ID,
        userId: PERSON_ID,
      }),
    ).resolves.toBeNull();

    expect(hasMembershipSpy).not.toHaveBeenCalled();
  });

  test("someone in the project already: nobody, and their account is not read", async () => {
    hasMembershipSpy.mockResolvedValue(true);

    await expect(
      TeamMemberService.getInviteeToEmailById({
        props: masterAdminProps(),
        projectId: PROJECT_ID,
        userId: PERSON_ID,
      }),
    ).resolves.toBeNull();

    expect(findPersonSpy).not.toHaveBeenCalled();
  });

  test("someone new to the project: their account, with its address and password column", async () => {
    findPersonSpy.mockResolvedValue(notSignedUpPerson());

    const invitee: User | null = await TeamMemberService.getInviteeToEmailById({
      props: projectAdminProps(),
      projectId: PROJECT_ID,
      userId: PERSON_ID,
    });

    expect(invitee?.id?.toString()).toBe(PERSON_ID.toString());
    expect(invitee?.email?.toString()).toBe(PERSON_EMAIL.toString());
    expect(invitee?.password).toBeUndefined();
  });

  test("an account that is not there: nobody", async () => {
    findPersonSpy.mockResolvedValue(null);

    await expect(
      TeamMemberService.getInviteeToEmailById({
        props: masterAdminProps(),
        projectId: PROJECT_ID,
        userId: PERSON_ID,
      }),
    ).resolves.toBeNull();
  });
});

/*
 * WHO INVITED THEM (#7471): the invitation names the person who made it,
 * read as their own account, in its subject and its first line - and, on a
 * self-hosted server, a reply reaches them. One that names nobody reads as
 * it always did.
 */
describe("the invitation names who made it", () => {
  const ADA: { name: string; email: string } = {
    name: "Ada Walker",
    email: "ada@company.com",
  };

  test("asks who made it: the request's person, as against the person invited", async () => {
    const readSpy: jest.SpyInstance = jest
      .spyOn(InvitationInviterUtil, "read")
      .mockResolvedValue(ADA);

    await callHook("onBeforeCreate", addById({ props: projectAdminProps() }));

    expect(readSpy).toHaveBeenCalledTimes(1);
    const asked: {
      props: DatabaseCommonInteractionProps;
      inviteeUserId: ObjectID;
    } = readSpy.mock.calls[0]![0] as {
      props: DatabaseCommonInteractionProps;
      inviteeUserId: ObjectID;
    };

    expect(asked.props.userId?.toString()).toBe(ADMIN_ID.toString());
    expect(asked.inviteeUserId.toString()).toBe(PERSON_ID.toString());
  });

  test("its subject and its template's variables name them", async () => {
    jest.spyOn(InvitationInviterUtil, "read").mockResolvedValue(ADA);

    await callHook("onBeforeCreate", addById({ props: projectAdminProps() }));

    const mail: EmailMessage = sentMail();

    expect(mail.subject).toBe(`Ada Walker invited you to ${PROJECT_NAME}`);
    expect(mail.isSubjectLiteral).toBe(true);
    expect(mail.vars["inviterLabel"]).toBe("Ada Walker (ada@company.com)");
    expect(mail.vars["inviterName"]).toBe("Ada Walker");
  });

  test("accepted for them, the subject says who added them", async () => {
    jest.spyOn(InvitationInviterUtil, "read").mockResolvedValue(ADA);

    await callHook(
      "onBeforeCreate",
      addById({ props: masterAdminProps(), hasAcceptedInvitation: true }),
    );

    expect(sentMail().subject).toBe(`Ada Walker added you to ${PROJECT_NAME}`);
  });

  test("a reply goes where the server's kind says: to them on a self-hosted server", async () => {
    jest.spyOn(InvitationInviterUtil, "read").mockResolvedValue(ADA);

    await callHook("onBeforeCreate", addById({ props: projectAdminProps() }));

    expect(sentMail().replyToEmail?.toString()).toBe(
      InvitationInviterUtil.getReplyTo({
        inviter: ADA,
        isSelfHosted: !IsBillingEnabled,
      })?.toString(),
    );
  });

  test("naming nobody, nothing of theirs is set, and no reply is redirected", async () => {
    await callHook("onBeforeCreate", addById({ props: projectAdminProps() }));

    const mail: EmailMessage = sentMail();

    expect(mail.subject).toBe(`You have been invited to ${PROJECT_NAME}`);
    expect(mail.vars).not.toHaveProperty("inviterLabel");
    expect(mail.vars).not.toHaveProperty("inviterName");
    expect(mail.replyToEmail).toBeUndefined();
  });
});
