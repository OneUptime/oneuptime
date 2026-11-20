import EmailVerificationToken from "../../../Models/DatabaseModels/EmailVerificationToken";
import Project from "../../../Models/DatabaseModels/Project";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import EmailVerificationTokenService from "../../../Server/Services/EmailVerificationTokenService";
import MailService from "../../../Server/Services/MailService";
import ProjectSCIMService from "../../../Server/Services/ProjectSCIMService";
import ProjectService from "../../../Server/Services/ProjectService";
import TeamMemberService, {
  TeamMemberService as TeamMemberServiceClass,
} from "../../../Server/Services/TeamMemberService";
import TeamPermissionService from "../../../Server/Services/TeamPermissionService";
import TeamService from "../../../Server/Services/TeamService";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
import UserService from "../../../Server/Services/UserService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "../../../Types/Email";
import EmailMessage from "../../../Types/Email/EmailMessage";
import HashedString from "../../../Types/HashedString";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

/*
 * THE LANGUAGE AN INVITATION IS WRITTEN IN, AND WHAT THE PROJECT SEES OF
 * IT (#9897, Types/Team/InvitationEmailWords).
 *
 * The invitation email is written in the invitee's own language when their
 * account picked one, else in the inviter's, else in English - subject and
 * body (EmailEnvelope.language). The project's email log, which its
 * members and viewers read, keeps the subject in the language the email has
 * for an invitee with no language of their own (projectLogSubject): the
 * inviter's, else English. So the project reads the same subject whether
 * the address had an account that reads German, had one that picked no
 * language, or had none - and whoever invites learns nothing new of it.
 *
 * Run through TeamMemberService.onBeforeCreate, as the invite forms and the
 * API reach it, with the database stood in for.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "98971111-1111-4111-8111-111111111111",
);
const TEAM_ID: ObjectID = new ObjectID("98972222-2222-4222-8222-222222222222");
const INVITEE_ID: ObjectID = new ObjectID(
  "98973333-3333-4333-8333-333333333333",
);
const INVITER_ID: ObjectID = new ObjectID(
  "98975555-5555-4555-8555-555555555555",
);

const INVITEE_EMAIL: Email = new Email("grete@firma.example");
const PROJECT_NAME: string = "Acme Production";

// What each account's language is in the world a test sets up.
let inviteeLanguage: string | null = null;
let inviterLanguage: string | null = null;
let inviteeLanguageRead: "answers" | "fails" = "answers";

let findUserSpy: jest.SpyInstance;
let findUserByIdSpy: jest.SpyInstance;
let sendMailSpy: jest.SpyInstance;

// Calls a protected hook without widening the service's public surface.
function callHook(
  service: unknown,
  name: string,
  ...args: Array<unknown>
): Promise<unknown> {
  const hooks: Record<
    string,
    (...hookArgs: Array<unknown>) => Promise<unknown>
  > = service as Record<
    string,
    (...hookArgs: Array<unknown>) => Promise<unknown>
  >;

  return hooks[name]!.apply(service, args);
}

// An invitation by address, as the invite forms send it - from Ada, by default.
function inviteBy(
  props: Partial<DatabaseCommonInteractionProps> = {
    userId: INVITER_ID,
    tenantId: PROJECT_ID,
  },
  isAccepted?: boolean,
): CreateBy<TeamMember> {
  const member: TeamMember = new TeamMember();
  member.projectId = PROJECT_ID;
  member.teamId = TEAM_ID;

  if (isAccepted !== undefined) {
    member.hasAcceptedInvitation = isAccepted;
  }

  return {
    data: member,
    props: props as DatabaseCommonInteractionProps,
    miscDataProps: { email: INVITEE_EMAIL.toString() },
  } as CreateBy<TeamMember>;
}

// The account at the address, as the hook reads it: its id and password.
function accountAtAddress(): User {
  const user: User = new User(INVITEE_ID);
  user._id = INVITEE_ID.toString();
  user.email = INVITEE_EMAIL;
  user.password = new HashedString("signed-up", true);
  return user;
}

// An account read by its id: the inviter's, or the invitee's language.
function accountById(id: ObjectID): User | null {
  if (id.toString() === INVITER_ID.toString()) {
    const ada: User = new User(INVITER_ID);
    ada._id = INVITER_ID.toString();
    ada.name = new Name("Ada Walker");
    ada.email = new Email("ada@walk.example");

    if (inviterLanguage) {
      ada.language = inviterLanguage;
    }

    return ada;
  }

  if (id.toString() === INVITEE_ID.toString()) {
    if (inviteeLanguageRead === "fails") {
      throw new Error("The database did not answer");
    }

    const grete: User = new User(INVITEE_ID);
    grete._id = INVITEE_ID.toString();

    if (inviteeLanguage) {
      grete.language = inviteeLanguage;
    }

    return grete;
  }

  return null;
}

// The invitation email the hook asked the mail service for.
function invitationEmail(): EmailMessage {
  expect(sendMailSpy).toHaveBeenCalledTimes(1);
  return sendMailSpy.mock.calls[0]![0] as EmailMessage;
}

// How often the invitee's language was read, by their account's id.
function inviteeLanguageReads(): number {
  return findUserByIdSpy.mock.calls.filter((call: Array<unknown>): boolean => {
    const args: { id: ObjectID; select: Record<string, boolean> } = call[0] as {
      id: ObjectID;
      select: Record<string, boolean>;
    };

    return (
      args.id.toString() === INVITEE_ID.toString() &&
      Boolean(args.select["language"])
    );
  }).length;
}

// Where the address stands before the invitation.
enum Address {
  // Nobody has it: the invitation makes the account.
  NoAccount = "no account",
  // An account that picked no language.
  AccountWithNoLanguage = "an account that picked no language",
  // An account that reads German.
  GermanAccount = "an account that reads German",
}

function setUpAddress(address: Address): void {
  inviteeLanguage = address === Address.GermanAccount ? "de" : null;
  findUserSpy.mockResolvedValue(
    address === Address.NoAccount ? null : accountAtAddress(),
  );
}

beforeEach(() => {
  inviteeLanguage = null;
  inviterLanguage = null;
  inviteeLanguageRead = "answers";

  stubProjectDirectory({});

  jest.spyOn(TeamService, "findOneBy").mockResolvedValue(new Team(TEAM_ID));
  jest
    .spyOn(TeamPermissionService, "assertCanGrantTeamPermissions")
    .mockResolvedValue(undefined);
  jest
    .spyOn(ProjectSCIMService, "countBy")
    .mockResolvedValue(new PositiveNumber(0));

  jest.spyOn(TeamMemberService, "findOneBy").mockResolvedValue(null);
  jest
    .spyOn(TeamMemberService, "getUniqueTeamMemberCountInProject")
    .mockResolvedValue(0);
  jest
    .spyOn(TeamMemberService, "isUserMemberOfProject")
    .mockResolvedValue(false);
  jest
    .spyOn(TeamMemberServiceClass, "readInvitationSsoManagedBy")
    .mockResolvedValue(null);

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
  jest
    .spyOn(EmailVerificationTokenService, "create")
    .mockResolvedValue(new EmailVerificationToken());

  findUserSpy = jest.spyOn(UserService, "findOneBy").mockResolvedValue(null);
  findUserByIdSpy = jest
    .spyOn(UserService, "findOneById")
    .mockImplementation(async (args: unknown): Promise<User | null> => {
      return accountById((args as { id: ObjectID }).id);
    });
  jest.spyOn(UserService, "createByEmail").mockImplementation(async () => {
    const created: User = new User(INVITEE_ID);
    created._id = INVITEE_ID.toString();
    created.email = INVITEE_EMAIL;
    return created;
  });
  jest
    .spyOn(UserService, "updateOneById")
    .mockResolvedValue(undefined as never);

  jest
    .spyOn(
      UserNotificationSettingService,
      "addDefaultNotificationSettingsForUser",
    )
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(UserNotificationRuleService, "addDefaultNotificationRuleForUser")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(TeamMemberService, "refreshTokens")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(
      TeamMemberService,
      "updateSubscriptionSeatsByUniqueTeamMembersInProject",
    )
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the email is written in the invitee's language, else the inviter's, else English", () => {
  test("an account that reads German, invited by Ada who reads French: German", async () => {
    setUpAddress(Address.GermanAccount);
    inviterLanguage = "fr";

    await callHook(TeamMemberService, "onBeforeCreate", inviteBy());

    const mail: EmailMessage = invitationEmail();

    expect(mail.language).toBe("de");
    expect(mail.subject).toBe(
      `Ada Walker hat Sie zu ${PROJECT_NAME} eingeladen`,
    );
    expect(mail.isSubjectLiteral).toBe(true);
  });

  test.each([Address.AccountWithNoLanguage, Address.NoAccount])(
    "%s, invited by Ada who reads French: Ada's French",
    async (address: Address) => {
      setUpAddress(address);
      inviterLanguage = "fr";

      await callHook(TeamMemberService, "onBeforeCreate", inviteBy());

      const mail: EmailMessage = invitationEmail();

      expect(mail.language).toBe("fr");
      expect(mail.subject).toBe(
        `Ada Walker vous a invité à rejoindre ${PROJECT_NAME}`,
      );
    },
  );

  test("an account that picked English stays English, though Ada reads French", async () => {
    setUpAddress(Address.AccountWithNoLanguage);
    inviteeLanguage = "en";
    inviterLanguage = "fr";

    await callHook(TeamMemberService, "onBeforeCreate", inviteBy());

    const mail: EmailMessage = invitationEmail();

    expect("language" in mail).toBe(false);
    expect(mail.subject).toBe(`Ada Walker invited you to ${PROJECT_NAME}`);
  });

  test("nobody picked a language: English, exactly as it always was", async () => {
    setUpAddress(Address.NoAccount);

    await callHook(TeamMemberService, "onBeforeCreate", inviteBy());

    const mail: EmailMessage = invitationEmail();

    expect("language" in mail).toBe(false);
    expect(mail.subject).toBe(`Ada Walker invited you to ${PROJECT_NAME}`);
    expect(mail.projectLogSubject).toBe(mail.subject);
  });

  test("a regional language reads as its own: Ada's de-AT is German", async () => {
    setUpAddress(Address.NoAccount);
    inviterLanguage = "de-AT";

    await callHook(TeamMemberService, "onBeforeCreate", inviteBy());

    expect(invitationEmail().language).toBe("de");
  });

  test("one OneUptime makes itself (SCIM) names no inviter: the invitee's language, else English", async () => {
    setUpAddress(Address.AccountWithNoLanguage);
    inviteeLanguage = "ja";

    await callHook(
      TeamMemberService,
      "onBeforeCreate",
      inviteBy({ isRoot: true }, false),
    );

    const mail: EmailMessage = invitationEmail();

    expect(mail.language).toBe("ja");
    expect(mail.subject).toBe(`${PROJECT_NAME} に招待されました`);
    expect(mail.projectLogSubject).toBe(
      `You have been invited to ${PROJECT_NAME}`,
    );
  });

  test("an invitation accepted for them says they were added, in their language", async () => {
    setUpAddress(Address.GermanAccount);

    await callHook(
      TeamMemberService,
      "onBeforeCreate",
      inviteBy({ userId: INVITER_ID, isMasterAdmin: true }, true),
    );

    const mail: EmailMessage = invitationEmail();

    expect(mail.language).toBe("de");
    expect(mail.subject).toBe(
      `Ada Walker hat Sie zu ${PROJECT_NAME} hinzugefügt`,
    );
    expect(mail.projectLogSubject).toBe(
      `Ada Walker added you to ${PROJECT_NAME}`,
    );
  });

  test("a language that cannot be read is none: the invitation goes, in the inviter's", async () => {
    setUpAddress(Address.AccountWithNoLanguage);
    inviteeLanguageRead = "fails";
    inviterLanguage = "fr";

    await callHook(TeamMemberService, "onBeforeCreate", inviteBy());

    expect(invitationEmail().language).toBe("fr");
  });
});

describe("the project's email log reads the same subject whoever the address belongs to", () => {
  /*
   * What the project's members and viewers read in Notification Logs >
   * Email: the subject in the inviter's language. An account the invitation
   * makes has no language, so a subject in the invitee's language would say
   * the address had an account - and what it reads.
   */
  test.each([
    ["Ada reads French", "fr", "Ada Walker vous a invité à rejoindre"],
    ["Ada picked no language", null, "Ada Walker invited you to"],
  ])(
    "%s: one log subject for every address, whatever the email itself is written in",
    async (_case: string, adaLanguage: string | null, logOpening: string) => {
      const logSubjects: Array<string | undefined> = [];
      const subjects: Array<string> = [];

      for (const address of [
        Address.NoAccount,
        Address.AccountWithNoLanguage,
        Address.GermanAccount,
      ]) {
        sendMailSpy.mockClear();
        setUpAddress(address);
        inviterLanguage = adaLanguage;

        await callHook(TeamMemberService, "onBeforeCreate", inviteBy());

        const mail: EmailMessage = invitationEmail();

        logSubjects.push(mail.projectLogSubject);
        subjects.push(mail.subject);
      }

      expect(new Set(logSubjects).size).toBe(1);
      expect(logSubjects[0]).toBe(`${logOpening} ${PROJECT_NAME}`);

      // The German account's own email is German; the log never says so.
      expect(subjects[2]).toBe(
        `Ada Walker hat Sie zu ${PROJECT_NAME} eingeladen`,
      );
      expect(logSubjects[2]).not.toContain("eingeladen");
    },
  );

  test("the invitee's language is read once, by id, for a new account and an existing one alike", async () => {
    const reads: Array<number> = [];

    for (const address of [
      Address.NoAccount,
      Address.AccountWithNoLanguage,
      Address.GermanAccount,
    ]) {
      findUserByIdSpy.mockClear();
      sendMailSpy.mockClear();
      setUpAddress(address);

      await callHook(TeamMemberService, "onBeforeCreate", inviteBy());

      invitationEmail();
      reads.push(inviteeLanguageReads());
    }

    expect(reads).toEqual([1, 1, 1]);
  });
});
