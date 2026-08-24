import UserNotificationMethodAdminService, {
  AdminNotificationMethodView,
} from "../../../Server/Services/UserNotificationMethodAdminService";
import OnCallReadinessService, {
  IDENTIFIER_MASK,
  ReadinessMethodType,
} from "../../../Server/Services/OnCallReadinessService";
import MailService from "../../../Server/Services/MailService";
import ProjectService from "../../../Server/Services/ProjectService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserCallService from "../../../Server/Services/UserCallService";
import UserEmailService from "../../../Server/Services/UserEmailService";
import UserMicrosoftTeamsService from "../../../Server/Services/UserMicrosoftTeamsService";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import UserPushService from "../../../Server/Services/UserPushService";
import UserSlackService from "../../../Server/Services/UserSlackService";
import UserService from "../../../Server/Services/UserService";
import UserSmsService from "../../../Server/Services/UserSmsService";
import UserTelegramService from "../../../Server/Services/UserTelegramService";
import UserWebhookService from "../../../Server/Services/UserWebhookService";
import UserWhatsAppService from "../../../Server/Services/UserWhatsAppService";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import UserCall from "../../../Models/DatabaseModels/UserCall";
import UserEmail from "../../../Models/DatabaseModels/UserEmail";
import UserMicrosoftTeams from "../../../Models/DatabaseModels/UserMicrosoftTeams";
import UserPush from "../../../Models/DatabaseModels/UserPush";
import UserSlack from "../../../Models/DatabaseModels/UserSlack";
import UserSMS from "../../../Models/DatabaseModels/UserSMS";
import UserTelegram from "../../../Models/DatabaseModels/UserTelegram";
import UserWebhook from "../../../Models/DatabaseModels/UserWebhook";
import UserWhatsApp from "../../../Models/DatabaseModels/UserWhatsApp";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "../../../Types/Email";
import BadDataException from "../../../Types/Exception/BadDataException";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Phone from "../../../Types/Phone";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The service that lets a project administrator set up somebody else's
 * notification methods.
 *
 * Everything here is tested against the REAL masking, not a stub of it. That is
 * the whole point of testing this layer separately from the router: the claim
 * is that a raw phone number sitting in the database cannot come back out of
 * this service, and the only way to test that claim is to put a raw phone
 * number in one end and read what comes out of the other. A masking test that
 * stubbed the masker proves nothing.
 *
 * The properties this file exists to pin, in the order they matter:
 *
 *   1. AN ADMIN-ADDED METHOD IS NOT LIVE. The row is written with the TARGET's
 *      user id and with isVerified untouched, which is what makes the method
 *      service send a verification code to the address itself. Nothing in this
 *      service can mark a method verified, and neither can the administrator
 *      afterwards — the verify endpoints compare the row's owner against the
 *      signed-in caller. If a future edit sets isVerified, or writes the
 *      ACTOR's user id instead of the target's, an administrator's own phone
 *      becomes a live delivery address on a colleague's account. Both are
 *      asserted on the row that is actually handed to the create.
 *
 *   2. NOTHING RAW COMES BACK. Every view this service returns goes through one
 *      function, and these tests scan the whole returned structure for the raw
 *      values they planted rather than checking a field by name.
 *
 *   3. THE OWNER IS ALWAYS TOLD. An admin adding a colleague's work phone and
 *      an attacker adding a number of their own are the same request from the
 *      server's side. The only party who always knows which it was is the
 *      account holder, so the mail is not decoration — it is the control.
 *
 *   4. MEMBERSHIP IS A CLAIM ABOUT A PROJECT. Holding an administrative
 *      permission somewhere is not a licence to write for a user id anywhere.
 *
 *   5. THE FIVE UNADDABLE CHANNELS STAY UNADDABLE. Push has no value to type,
 *      Telegram needs the account holder to talk to the bot, Slack and
 *      Microsoft Teams are pointers at the owner's own OAuth workspace link,
 *      and a webhook would be live the instant it was written because
 *      UserWebhook has no verification at all.
 */

const RAW_EMAIL: string = "jane.ops@example.com";
const RAW_PHONE: string = "+14155554821";
const RAW_TELEGRAM_HANDLE: string = "@janeops_oncall";
const RAW_SLACK_USERNAME: string = "ops.jane.slack";
const RAW_TEAMS_USERNAME: string = "Jane Ops (Teams)";
const RAW_WEBHOOK_NAME: string = "payments-hook";
const RAW_DEVICE_NAME: string = "Jane's iPhone";

const ALL_RAW_VALUES: Array<string> = [
  RAW_EMAIL,
  RAW_PHONE,
  RAW_TELEGRAM_HANDLE,
  RAW_SLACK_USERNAME,
  RAW_TEAMS_USERNAME,
  RAW_WEBHOOK_NAME,
  RAW_DEVICE_NAME,
];

let projectId: ObjectID;
let targetUserId: ObjectID;
let actorUserId: ObjectID;
let emailMethodId: ObjectID;
let smsMethodId: ObjectID;

let teamMemberFindOneBy: jest.SpyInstance;
let mailSpy: jest.SpyInstance;
let clearCacheSpy: jest.SpyInstance;

let emailFindBy: jest.SpyInstance;
let smsFindBy: jest.SpyInstance;
let callFindBy: jest.SpyInstance;
let whatsAppFindBy: jest.SpyInstance;
let pushFindBy: jest.SpyInstance;
let telegramFindBy: jest.SpyInstance;
let slackFindBy: jest.SpyInstance;
let microsoftTeamsFindBy: jest.SpyInstance;
let webhookFindBy: jest.SpyInstance;

let emailCreate: jest.SpyInstance;
let smsCreate: jest.SpyInstance;
let smsFindOneBy: jest.SpyInstance;
let smsDelete: jest.SpyInstance;
let smsResend: jest.SpyInstance;
let slackFindOneBy: jest.SpyInstance;
let slackDelete: jest.SpyInstance;
let microsoftTeamsFindOneBy: jest.SpyInstance;
let microsoftTeamsDelete: jest.SpyInstance;
let deletionImpact: jest.SpyInstance;

function props(): DatabaseCommonInteractionProps {
  return {
    tenantId: projectId,
    userId: actorUserId,
  };
}

/* Every string anywhere in a returned structure, however deeply nested. */
function everyStringIn(value: unknown): Array<string> {
  if (typeof value === "string") {
    return [value];
  }

  if (value instanceof ObjectID || value instanceof Date) {
    return [value.toString()];
  }

  if (Array.isArray(value)) {
    return value.flatMap(everyStringIn);
  }

  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(
      everyStringIn,
    );
  }

  return [];
}

function expectNothingRawIn(value: unknown): void {
  const strings: string = everyStringIn(value).join(" || ");

  for (const raw of ALL_RAW_VALUES) {
    expect(strings).not.toContain(raw);
  }
}

function buildEmailRow(): UserEmail {
  const row: UserEmail = new UserEmail();
  row._id = emailMethodId.toString();
  row.projectId = projectId;
  row.userId = targetUserId;
  row.email = new Email(RAW_EMAIL);
  row.isVerified = true;
  return row;
}

function buildSmsRow(): UserSMS {
  const row: UserSMS = new UserSMS();
  row._id = smsMethodId.toString();
  row.projectId = projectId;
  row.userId = targetUserId;
  row.phone = new Phone(RAW_PHONE);
  row.isVerified = false;
  return row;
}

function buildTelegramRow(): UserTelegram {
  const row: UserTelegram = new UserTelegram();
  row._id = ObjectID.generate().toString();
  row.projectId = projectId;
  row.userId = targetUserId;
  row.telegramUserHandle = RAW_TELEGRAM_HANDLE;
  row.isVerified = true;
  return row;
}

/*
 * Born verified: a UserSlack / UserMicrosoftTeams row is a pointer at the
 * owner's own OAuth workspace link, so creation is verification and there is
 * no verification-code flow for these two channels at all.
 */
function buildSlackRow(): UserSlack {
  const row: UserSlack = new UserSlack();
  row._id = ObjectID.generate().toString();
  row.projectId = projectId;
  row.userId = targetUserId;
  row.slackUserName = RAW_SLACK_USERNAME;
  row.isVerified = true;
  return row;
}

function buildMicrosoftTeamsRow(): UserMicrosoftTeams {
  const row: UserMicrosoftTeams = new UserMicrosoftTeams();
  row._id = ObjectID.generate().toString();
  row.projectId = projectId;
  row.userId = targetUserId;
  row.microsoftTeamsUserName = RAW_TEAMS_USERNAME;
  row.isVerified = true;
  return row;
}

function buildWebhookRow(): UserWebhook {
  const row: UserWebhook = new UserWebhook();
  row._id = ObjectID.generate().toString();
  row.projectId = projectId;
  row.userId = targetUserId;
  row.name = RAW_WEBHOOK_NAME;
  return row;
}

function buildPushRow(): UserPush {
  const row: UserPush = new UserPush();
  row._id = ObjectID.generate().toString();
  row.projectId = projectId;
  row.userId = targetUserId;
  row.deviceName = RAW_DEVICE_NAME;
  row.isVerified = true;
  return row;
}

function viewFor(
  methods: Array<AdminNotificationMethodView>,
  methodType: ReadinessMethodType,
): AdminNotificationMethodView {
  const view: AdminNotificationMethodView | undefined = methods.find(
    (candidate: AdminNotificationMethodView): boolean => {
      return candidate.methodType === methodType;
    },
  );

  if (!view) {
    throw new Error(`no view for ${methodType}`);
  }

  return view;
}

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();

  projectId = ObjectID.generate();
  targetUserId = ObjectID.generate();
  actorUserId = ObjectID.generate();
  emailMethodId = ObjectID.generate();
  smsMethodId = ObjectID.generate();

  teamMemberFindOneBy = jest
    .spyOn(TeamMemberService, "findOneBy")
    .mockResolvedValue({ _id: ObjectID.generate().toString() } as never);

  mailSpy = jest
    .spyOn(MailService, "sendMail")
    .mockResolvedValue(undefined as never);

  clearCacheSpy = jest
    .spyOn(OnCallReadinessService, "clearCache")
    .mockImplementation((): void => {
      return undefined;
    });

  const owner: User = new User();
  owner._id = targetUserId.toString();
  owner.name = new Name("Jane Ops");
  owner.email = new Email("jane.login@example.com");

  const actor: User = new User();
  actor._id = actorUserId.toString();
  actor.name = new Name("Alex Admin");
  actor.email = new Email("alex.admin@example.com");

  jest
    .spyOn(UserService, "findOneById")
    .mockImplementation((data: any): Promise<User | null> => {
      return Promise.resolve(
        data.id.toString() === targetUserId.toString() ? owner : actor,
      );
    });

  const project: Project = new Project();
  project._id = projectId.toString();
  project.name = "Payments";

  jest.spyOn(ProjectService, "findOneById").mockResolvedValue(project as never);

  emailFindBy = jest
    .spyOn(UserEmailService, "findBy")
    .mockResolvedValue([buildEmailRow()] as never);
  smsFindBy = jest
    .spyOn(UserSmsService, "findBy")
    .mockResolvedValue([buildSmsRow()] as never);
  callFindBy = jest
    .spyOn(UserCallService, "findBy")
    .mockResolvedValue([] as never);
  whatsAppFindBy = jest
    .spyOn(UserWhatsAppService, "findBy")
    .mockResolvedValue([] as never);
  pushFindBy = jest
    .spyOn(UserPushService, "findBy")
    .mockResolvedValue([buildPushRow()] as never);
  telegramFindBy = jest
    .spyOn(UserTelegramService, "findBy")
    .mockResolvedValue([buildTelegramRow()] as never);
  slackFindBy = jest
    .spyOn(UserSlackService, "findBy")
    .mockResolvedValue([buildSlackRow()] as never);
  microsoftTeamsFindBy = jest
    .spyOn(UserMicrosoftTeamsService, "findBy")
    .mockResolvedValue([buildMicrosoftTeamsRow()] as never);
  webhookFindBy = jest
    .spyOn(UserWebhookService, "findBy")
    .mockResolvedValue([buildWebhookRow()] as never);

  jest
    .spyOn(UserEmailService, "findOneBy")
    .mockResolvedValue(buildEmailRow() as never);
  smsFindOneBy = jest
    .spyOn(UserSmsService, "findOneBy")
    .mockResolvedValue(buildSmsRow() as never);
  jest.spyOn(UserCallService, "findOneBy").mockResolvedValue(null as never);
  jest.spyOn(UserWhatsAppService, "findOneBy").mockResolvedValue(null as never);
  jest.spyOn(UserPushService, "findOneBy").mockResolvedValue(null as never);
  jest.spyOn(UserTelegramService, "findOneBy").mockResolvedValue(null as never);
  slackFindOneBy = jest
    .spyOn(UserSlackService, "findOneBy")
    .mockResolvedValue(buildSlackRow() as never);
  microsoftTeamsFindOneBy = jest
    .spyOn(UserMicrosoftTeamsService, "findOneBy")
    .mockResolvedValue(buildMicrosoftTeamsRow() as never);
  jest.spyOn(UserWebhookService, "findOneBy").mockResolvedValue(null as never);

  emailCreate = jest
    .spyOn(UserEmailService, "create")
    .mockImplementation((data: any): Promise<UserEmail> => {
      const created: UserEmail = data.data as UserEmail;
      created._id = ObjectID.generate().toString();
      return Promise.resolve(created);
    });

  smsCreate = jest
    .spyOn(UserSmsService, "create")
    .mockImplementation((data: any): Promise<UserSMS> => {
      const created: UserSMS = data.data as UserSMS;
      created._id = ObjectID.generate().toString();
      return Promise.resolve(created);
    });

  jest
    .spyOn(UserCallService, "create")
    .mockImplementation((data: any): Promise<UserCall> => {
      const created: UserCall = data.data as UserCall;
      created._id = ObjectID.generate().toString();
      return Promise.resolve(created);
    });

  jest
    .spyOn(UserWhatsAppService, "create")
    .mockImplementation((data: any): Promise<UserWhatsApp> => {
      const created: UserWhatsApp = data.data as UserWhatsApp;
      created._id = ObjectID.generate().toString();
      return Promise.resolve(created);
    });

  smsDelete = jest
    .spyOn(UserSmsService, "deleteOneById")
    .mockResolvedValue(undefined as never);

  slackDelete = jest
    .spyOn(UserSlackService, "deleteOneById")
    .mockResolvedValue(undefined as never);

  microsoftTeamsDelete = jest
    .spyOn(UserMicrosoftTeamsService, "deleteOneById")
    .mockResolvedValue(undefined as never);

  smsResend = jest
    .spyOn(UserSmsService, "resendVerificationCode")
    .mockResolvedValue(undefined as never);

  deletionImpact = jest
    .spyOn(UserNotificationRuleService, "getNotificationMethodDeletionImpact")
    .mockResolvedValue({
      projectId: projectId,
      userId: targetUserId,
      isOnCallResponder: true,
      reachedVia: [],
      rulesDeletedCount: 4,
      coverageLost: [
        { ruleType: "x", rulesRemoved: 1 },
        { ruleType: "y", rulesRemoved: 1 },
      ],
      handoffNotificationsLost: [],
      reachability: "NotReachable",
      verifiedMethodCountAfterDeletion: 0,
      isFallbackEnabled: true,
      isTruncated: false,
    } as never);
});

describe("listing", () => {
  test("returns every channel, masked, and never a raw value", async () => {
    const methods: Array<AdminNotificationMethodView> =
      await UserNotificationMethodAdminService.listMethodsForUser({
        projectId: projectId,
        userId: targetUserId,
      });

    expect(methods).toHaveLength(7);

    /*
     * The real maskIdentifier, not a stub, so these are the exact shapes an
     * administrator sees on screen.
     */
    expect(viewFor(methods, ReadinessMethodType.Email).maskedIdentifier).toBe(
      `j${IDENTIFIER_MASK}@example.com`,
    );
    expect(viewFor(methods, ReadinessMethodType.SMS).maskedIdentifier).toBe(
      `+1 ${IDENTIFIER_MASK} ${IDENTIFIER_MASK} 4821`,
    );
    expect(
      viewFor(methods, ReadinessMethodType.Telegram).maskedIdentifier,
    ).toBe(`@ja${IDENTIFIER_MASK}`);
    expect(viewFor(methods, ReadinessMethodType.Slack).maskedIdentifier).toBe(
      `op${IDENTIFIER_MASK}`,
    );
    expect(
      viewFor(methods, ReadinessMethodType.MicrosoftTeams).maskedIdentifier,
    ).toBe(`Ja${IDENTIFIER_MASK}`);

    // Born verified: the OAuth workspace link IS the verification.
    expect(viewFor(methods, ReadinessMethodType.Slack).isVerified).toBe(true);
    expect(
      viewFor(methods, ReadinessMethodType.MicrosoftTeams).isVerified,
    ).toBe(true);

    /*
     * Scanned as a whole rather than field by field, so a view that grew a raw
     * field this test never thought of still fails.
     */
    expectNothingRawIn(methods);
  });

  test("selects no column that carries a credential", async () => {
    await UserNotificationMethodAdminService.listMethodsForUser({
      projectId: projectId,
      userId: targetUserId,
    });

    /*
     * UserWebhook.webhookUrl is a bearer credential — anyone holding a
     * Slack/Discord/Teams hook url can post as the integration — and
     * UserPush.deviceToken addresses the device directly. Neither may be
     * selected on this path at all: a value that is never read cannot be
     * leaked by a later serialiser.
     */
    const webhookSelect: any = webhookFindBy.mock.calls[0]![0].select;
    expect(webhookSelect.webhookUrl).toBeUndefined();
    expect(webhookSelect.secret).toBeUndefined();

    const pushSelect: any = pushFindBy.mock.calls[0]![0].select;
    expect(pushSelect.deviceToken).toBeUndefined();

    /*
     * And the telegram CHAT ID, which is the addressable target a bot sends to.
     * The handle is the human-facing label and is the one an owner recognises.
     */
    const telegramSelect: any = telegramFindBy.mock.calls[0]![0].select;
    expect(telegramSelect.telegramChatId).toBeUndefined();
    expect(telegramSelect.telegramUserHandle).toBe(true);

    /*
     * Same rule for the two workspace channels: the Slack member id and the
     * Teams user id are the addressable targets the workspace bot sends to,
     * and the username is the label the owner recognises.
     */
    const slackSelect: any = slackFindBy.mock.calls[0]![0].select;
    expect(slackSelect.slackUserId).toBeUndefined();
    expect(slackSelect.slackUserName).toBe(true);

    const teamsSelect: any = microsoftTeamsFindBy.mock.calls[0]![0].select;
    expect(teamsSelect.microsoftTeamsUserId).toBeUndefined();
    expect(teamsSelect.microsoftTeamsUserName).toBe(true);

    // Verification codes are live account-takeover material. Never selected.
    for (const spy of [emailFindBy, smsFindBy, callFindBy, whatsAppFindBy]) {
      const select: any = spy.mock.calls[0]![0].select;
      expect(select.verificationCode).toBeUndefined();
    }
  });

  test("reads only this user's rows, in this project", async () => {
    await UserNotificationMethodAdminService.listMethodsForUser({
      projectId: projectId,
      userId: targetUserId,
    });

    for (const spy of [
      emailFindBy,
      smsFindBy,
      telegramFindBy,
      slackFindBy,
      microsoftTeamsFindBy,
      webhookFindBy,
    ]) {
      const call: any = spy.mock.calls[0]![0];

      expect(call.query.projectId.toString()).toBe(projectId.toString());
      expect(call.query.userId.toString()).toBe(targetUserId.toString());

      /*
       * isRoot, necessarily: the models are scoped to their owner, so a
       * non-root read on behalf of an administrator would be refused. It is
       * also exactly why the router above this is the only gate there is.
       */
      expect(call.props.isRoot).toBe(true);
    }
  });

  test("marks the five channels an administrator cannot create", async () => {
    const methods: Array<AdminNotificationMethodView> =
      await UserNotificationMethodAdminService.listMethodsForUser({
        projectId: projectId,
        userId: targetUserId,
      });

    expect(viewFor(methods, ReadinessMethodType.Email).isAdminAddable).toBe(
      true,
    );
    expect(viewFor(methods, ReadinessMethodType.SMS).isAdminAddable).toBe(true);

    expect(viewFor(methods, ReadinessMethodType.Push).isAdminAddable).toBe(
      false,
    );
    expect(viewFor(methods, ReadinessMethodType.Telegram).isAdminAddable).toBe(
      false,
    );
    expect(viewFor(methods, ReadinessMethodType.Slack).isAdminAddable).toBe(
      false,
    );
    expect(
      viewFor(methods, ReadinessMethodType.MicrosoftTeams).isAdminAddable,
    ).toBe(false);
    expect(viewFor(methods, ReadinessMethodType.Webhook).isAdminAddable).toBe(
      false,
    );
  });
});

describe("adding", () => {
  test("writes the row for the TARGET and leaves it unverified", async () => {
    smsFindBy.mockResolvedValue([] as never);

    await UserNotificationMethodAdminService.addMethodForUser({
      projectId: projectId,
      targetUserId: targetUserId,
      actorUserId: actorUserId,
      methodType: "SMS",
      value: RAW_PHONE,
      props: props(),
    });

    const created: UserSMS = smsCreate.mock.calls[0]![0].data as UserSMS;

    /*
     * The TARGET's id, not the actor's. A row written with the admin's id would
     * be the admin's own method — harmless — but a row written with the
     * target's id and the ADMIN's number is the redirect this whole design
     * exists to prevent, and the two are one typo apart.
     */
    expect(created.userId!.toString()).toBe(targetUserId.toString());
    expect(created.projectId!.toString()).toBe(projectId.toString());
    expect(created.phone!.toString()).toBe(RAW_PHONE);

    /*
     * UNVERIFIED, by not being set at all. This is the property everything
     * else rests on: the method service's onCreateSuccess sends a verification
     * code to the number itself precisely because isVerified is falsy, and the
     * verify endpoints then refuse anybody but the row's owner. Setting this
     * true here would make an administrator's typing immediately live.
     */
    expect(created.isVerified).toBeFalsy();

    // And nothing about the row is verified afterwards either.
    expect(smsCreate.mock.calls[0]![0].props.isRoot).toBe(true);
  });

  test("refuses the five channels the owner has to add themselves", async () => {
    for (const methodType of [
      "Push",
      "Telegram",
      "Slack",
      "Microsoft Teams",
      "Webhook",
      "Carrier Pigeon",
    ]) {
      await expect(
        UserNotificationMethodAdminService.addMethodForUser({
          projectId: projectId,
          targetUserId: targetUserId,
          actorUserId: actorUserId,
          methodType: methodType,
          value: "anything",
          props: props(),
        }),
      ).rejects.toThrow(BadDataException);
    }

    /*
     * One sentence for "no such channel" and for "that channel exists but an
     * administrator may not create it": naming which one it was describes the
     * shape of the feature to somebody probing it.
     */
    await expect(
      UserNotificationMethodAdminService.addMethodForUser({
        projectId: projectId,
        targetUserId: targetUserId,
        actorUserId: actorUserId,
        methodType: "Webhook",
        value: "https://hooks.example.com/abc",
        props: props(),
      }),
    ).rejects.toThrow(/can only add Email, SMS, Call and WhatsApp/);
  });

  test("validates the value before writing anything", async () => {
    smsFindBy.mockResolvedValue([] as never);

    await expect(
      UserNotificationMethodAdminService.addMethodForUser({
        projectId: projectId,
        targetUserId: targetUserId,
        actorUserId: actorUserId,
        methodType: "Email",
        value: "not-an-email",
        props: props(),
      }),
    ).rejects.toThrow(BadDataException);

    /*
     * Refused before the row exists rather than stored and discovered later by
     * a page that fails to deliver — which, on this surface, means discovered
     * during an incident.
     */
    expect(emailCreate).not.toHaveBeenCalled();
  });

  test("refuses a duplicate rather than creating a second row", async () => {
    await expect(
      UserNotificationMethodAdminService.addMethodForUser({
        projectId: projectId,
        targetUserId: targetUserId,
        actorUserId: actorUserId,
        methodType: "SMS",
        value: RAW_PHONE,
        props: props(),
      }),
    ).rejects.toThrow(/already has a SMS notification method/);

    /*
     * Two identical rows are not merely untidy: they show up as two entries an
     * admin has to tell apart on a masked list, each with its own verification
     * state, and a rule pointed at the unverified one looks correct and pages
     * nobody.
     */
    expect(smsCreate).not.toHaveBeenCalled();
  });

  test("refuses a target who is not a member of the project", async () => {
    teamMemberFindOneBy.mockResolvedValue(null as never);

    await expect(
      UserNotificationMethodAdminService.addMethodForUser({
        projectId: projectId,
        targetUserId: targetUserId,
        actorUserId: actorUserId,
        methodType: "SMS",
        value: RAW_PHONE,
        props: props(),
      }),
    ).rejects.toThrow(/not a member of this project/);

    expect(smsCreate).not.toHaveBeenCalled();

    /*
     * Membership is read with root props and NO cache.
     * TeamMemberService.getTeamIdsForUser would answer the same question with
     * one fewer query, but it memoises for 60 seconds — and a security decision
     * that keeps saying "yes" for a minute after somebody was removed from the
     * project is not a security decision.
     */
    const call: any = teamMemberFindOneBy.mock.calls[0]![0];

    expect(call.query.hasAcceptedInvitation).toBe(true);
    expect(call.props.isRoot).toBe(true);
  });

  test("tells the owner, naming the actor and the mask", async () => {
    smsFindBy.mockResolvedValue([] as never);

    await UserNotificationMethodAdminService.addMethodForUser({
      projectId: projectId,
      targetUserId: targetUserId,
      actorUserId: actorUserId,
      methodType: "SMS",
      value: RAW_PHONE,
      props: props(),
    });

    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });

    expect(mailSpy).toHaveBeenCalled();

    const mail: any = mailSpy.mock.calls[0]![0];
    const recipientOptions: any = mailSpy.mock.calls[0]![1];

    // To the OWNER, never to the admin who made the change.
    expect(mail.toEmail.toString()).toBe("jane.login@example.com");
    expect(recipientOptions.userId.toString()).toBe(targetUserId.toString());

    /*
     * The actor is named by email as well as by name: display names are not
     * unique and are user-editable, so "Alex added a phone number" is not
     * something the reader can act on. An address is.
     */
    expect(mail.vars.message).toContain("Alex Admin");
    expect(mail.vars.message).toContain("alex.admin@example.com");

    /*
     * And the instruction that makes the mail a control rather than a notice:
     * an addition is inert until the owner verifies it, so "do not verify it"
     * is an action they can take.
     */
    expect(mail.vars.message).toContain("cannot be used to notify you");
    expect(mail.vars.message).toContain("do not verify it");

    // The MASK, never the number — this mail crosses an untrusted transport.
    expect(mail.vars.message).toContain(`+1 ${IDENTIFIER_MASK}`);
    expectNothingRawIn(mail.vars);
  });

  test("does not mail somebody about their own change", async () => {
    smsFindBy.mockResolvedValue([] as never);

    await UserNotificationMethodAdminService.addMethodForUser({
      projectId: projectId,
      targetUserId: targetUserId,
      actorUserId: targetUserId,
      methodType: "SMS",
      value: RAW_PHONE,
      props: props(),
    });

    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });

    // A person who just did the thing does not need to be warned about it.
    expect(mailSpy).not.toHaveBeenCalled();
  });

  test("drops the readiness cache so the change is visible immediately", async () => {
    smsFindBy.mockResolvedValue([] as never);

    await UserNotificationMethodAdminService.addMethodForUser({
      projectId: projectId,
      targetUserId: targetUserId,
      actorUserId: actorUserId,
      methodType: "SMS",
      value: RAW_PHONE,
      props: props(),
    });

    /*
     * The readiness service holds this user's method list for 60 seconds, and
     * the page the admin is looking at re-reads readiness the moment this
     * returns. Left alone it would redraw the responder exactly as they were,
     * which reads as "the add did not work".
     */
    expect(clearCacheSpy).toHaveBeenCalled();
  });

  test("returns the created method already masked", async () => {
    smsFindBy.mockResolvedValue([] as never);

    const created: AdminNotificationMethodView =
      await UserNotificationMethodAdminService.addMethodForUser({
        projectId: projectId,
        targetUserId: targetUserId,
        actorUserId: actorUserId,
        methodType: "SMS",
        value: RAW_PHONE,
        props: props(),
      });

    expect(created.maskedIdentifier).toBe(
      `+1 ${IDENTIFIER_MASK} ${IDENTIFIER_MASK} 4821`,
    );
    expect(created.isVerified).toBe(false);

    expectNothingRawIn(created);
  });
});

describe("removing", () => {
  test("deletes the row and tells the owner what they lost", async () => {
    await UserNotificationMethodAdminService.deleteMethodForUser({
      projectId: projectId,
      targetUserId: targetUserId,
      actorUserId: actorUserId,
      methodType: "SMS",
      methodId: smsMethodId,
      props: props(),
    });

    expect(smsDelete).toHaveBeenCalled();
    expect(smsDelete.mock.calls[0]![0].id.toString()).toBe(
      smsMethodId.toString(),
    );

    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });

    const mail: any = mailSpy.mock.calls[0]![0];

    /*
     * Deletion gets its own sentence rather than the generic one. It is the
     * only one of the two actions that can leave a responder silently
     * unreachable, which is the failure this whole epic exists to stop
     * happening unnoticed.
     */
    expect(mail.subject).toContain("removed");
    expect(mail.vars.message).toContain("notification rules that used it");
    expect(mail.vars.message).toContain("may no longer be paged");

    // Still the mask: the owner's own number is not echoed back over SMTP.
    expect(mail.vars.message).toContain(`+1 ${IDENTIFIER_MASK}`);
    expectNothingRawIn(mail.vars);
  });

  test("deletes a Slack account through its own service, and the mail carries only the mask", async () => {
    /*
     * Delete is the one verb an administrator gets on the workspace channels:
     * they cannot add one (the OAuth link is the owner's) and there is no code
     * to resend, but a leaver's Slack account still has to be clearable.
     */
    const slackMethodId: ObjectID = ObjectID.generate();

    await UserNotificationMethodAdminService.deleteMethodForUser({
      projectId: projectId,
      targetUserId: targetUserId,
      actorUserId: actorUserId,
      methodType: "Slack",
      methodId: slackMethodId,
      props: props(),
    });

    expect(slackDelete).toHaveBeenCalled();
    expect(slackDelete.mock.calls[0]![0].id.toString()).toBe(
      slackMethodId.toString(),
    );

    // The ownership lookup is scoped to the project and the user, like SMS.
    const lookup: any = slackFindOneBy.mock.calls[0]![0];
    expect(lookup.query._id.toString()).toBe(slackMethodId.toString());
    expect(lookup.query.projectId.toString()).toBe(projectId.toString());
    expect(lookup.query.userId.toString()).toBe(targetUserId.toString());

    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });

    const mail: any = mailSpy.mock.calls[0]![0];

    expect(mail.subject).toContain("removed");
    expect(mail.vars.message).toContain(`op${IDENTIFIER_MASK}`);
    expectNothingRawIn(mail.vars);
  });

  test("deletes a Microsoft Teams account through its own service", async () => {
    const teamsMethodId: ObjectID = ObjectID.generate();

    await UserNotificationMethodAdminService.deleteMethodForUser({
      projectId: projectId,
      targetUserId: targetUserId,
      actorUserId: actorUserId,
      methodType: "Microsoft Teams",
      methodId: teamsMethodId,
      props: props(),
    });

    expect(microsoftTeamsDelete).toHaveBeenCalled();
    expect(microsoftTeamsDelete.mock.calls[0]![0].id.toString()).toBe(
      teamsMethodId.toString(),
    );

    const lookup: any = microsoftTeamsFindOneBy.mock.calls[0]![0];
    expect(lookup.query._id.toString()).toBe(teamsMethodId.toString());
    expect(lookup.query.projectId.toString()).toBe(projectId.toString());
    expect(lookup.query.userId.toString()).toBe(targetUserId.toString());

    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });

    const mail: any = mailSpy.mock.calls[0]![0];

    expect(mail.vars.message).toContain(`Ja${IDENTIFIER_MASK}`);
    expectNothingRawIn(mail.vars);
  });

  test("refuses a Slack method that belongs to somebody else", async () => {
    slackFindOneBy.mockResolvedValue(null as never);

    await expect(
      UserNotificationMethodAdminService.deleteMethodForUser({
        projectId: projectId,
        targetUserId: targetUserId,
        actorUserId: actorUserId,
        methodType: "Slack",
        methodId: ObjectID.generate(),
        props: props(),
      }),
    ).rejects.toThrow(/could not be found for this user/);

    expect(slackDelete).not.toHaveBeenCalled();
  });

  test("refuses a method that belongs to somebody else", async () => {
    /*
     * The row is looked up by (id, projectId, userId) together, so a row
     * belonging to another user simply does not come back — and "not found" and
     * "not yours" are deliberately the same answer, because in both cases the
     * caller named a row they have no business naming.
     */
    smsFindOneBy.mockResolvedValue(null as never);

    await expect(
      UserNotificationMethodAdminService.deleteMethodForUser({
        projectId: projectId,
        targetUserId: targetUserId,
        actorUserId: actorUserId,
        methodType: "SMS",
        methodId: smsMethodId,
        props: props(),
      }),
    ).rejects.toThrow(/could not be found for this user/);

    expect(smsDelete).not.toHaveBeenCalled();
  });

  test("scopes the ownership lookup to the project and the user", async () => {
    await UserNotificationMethodAdminService.deleteMethodForUser({
      projectId: projectId,
      targetUserId: targetUserId,
      actorUserId: actorUserId,
      methodType: "SMS",
      methodId: smsMethodId,
      props: props(),
    });

    const call: any = smsFindOneBy.mock.calls[0]![0];

    expect(call.query._id.toString()).toBe(smsMethodId.toString());
    expect(call.query.projectId.toString()).toBe(projectId.toString());
    expect(call.query.userId.toString()).toBe(targetUserId.toString());
  });

  test("refuses a target who is not a member of the project", async () => {
    teamMemberFindOneBy.mockResolvedValue(null as never);

    await expect(
      UserNotificationMethodAdminService.deleteMethodForUser({
        projectId: projectId,
        targetUserId: targetUserId,
        actorUserId: actorUserId,
        methodType: "SMS",
        methodId: smsMethodId,
        props: props(),
      }),
    ).rejects.toThrow(/not a member of this project/);

    expect(smsDelete).not.toHaveBeenCalled();
  });

  test("previews the cost without deleting anything", async () => {
    const preview: unknown =
      await UserNotificationMethodAdminService.getDeletionPreview({
        projectId: projectId,
        targetUserId: targetUserId,
        methodType: "SMS",
        methodId: smsMethodId,
      });

    expect(preview).toEqual({
      rulesDeletedCount: 4,
      coverageLostCount: 2,
      verifiedMethodCountAfterDeletion: 0,
      reachability: "NotReachable",
      isFallbackEnabled: true,
      isTruncated: false,
    });

    expect(smsDelete).not.toHaveBeenCalled();

    /*
     * The impact is computed by the rules service, which reads EVERY rule for
     * the user rather than a page and derives each rule's severity from the
     * column its rule type dictates. That method was written for this caller
     * and had no production caller until now.
     */
    const call: any = deletionImpact.mock.calls[0]![0];
    expect(call.methodType).toBe(ReadinessMethodType.SMS);
    expect(call.methodId.toString()).toBe(smsMethodId.toString());
  });

  test("the preview refuses a method that is not this user's", async () => {
    smsFindOneBy.mockResolvedValue(null as never);

    await expect(
      UserNotificationMethodAdminService.getDeletionPreview({
        projectId: projectId,
        targetUserId: targetUserId,
        methodType: "SMS",
        methodId: smsMethodId,
      }),
    ).rejects.toThrow(/could not be found for this user/);

    /*
     * Otherwise the preview is a probe: it would report rule counts for a
     * method id belonging to another user or another project.
     */
    expect(deletionImpact).not.toHaveBeenCalled();
  });
});

describe("resending a verification code", () => {
  test("asks the channel's own service to send it again", async () => {
    await UserNotificationMethodAdminService.resendVerificationCodeForUser({
      projectId: projectId,
      targetUserId: targetUserId,
      methodType: "SMS",
      methodId: smsMethodId,
    });

    expect(smsResend).toHaveBeenCalledWith(smsMethodId);

    /*
     * It discloses nothing: the code goes to the number on the row, which is
     * the one thing on it the administrator cannot read. That is what makes
     * this the useful lever after adding a method — "I added your work mobile,
     * here is another code" rather than re-typing the number.
     */
    expect(mailSpy).not.toHaveBeenCalled();
  });

  test("refuses a channel with no verification concept", async () => {
    jest
      .spyOn(UserWebhookService, "findOneBy")
      .mockResolvedValue(buildWebhookRow() as never);

    await expect(
      UserNotificationMethodAdminService.resendVerificationCodeForUser({
        projectId: projectId,
        targetUserId: targetUserId,
        methodType: "Webhook",
        methodId: ObjectID.generate(),
      }),
    ).rejects.toThrow(/do not use a verification code/);
  });

  test("refuses the workspace channels - the OAuth link is the verification, there is no code", async () => {
    for (const methodType of ["Slack", "Microsoft Teams"]) {
      await expect(
        UserNotificationMethodAdminService.resendVerificationCodeForUser({
          projectId: projectId,
          targetUserId: targetUserId,
          methodType: methodType,
          methodId: ObjectID.generate(),
        }),
      ).rejects.toThrow(/do not use a verification code/);
    }
  });

  test("refuses a method that is not this user's", async () => {
    smsFindOneBy.mockResolvedValue(null as never);

    await expect(
      UserNotificationMethodAdminService.resendVerificationCodeForUser({
        projectId: projectId,
        targetUserId: targetUserId,
        methodType: "SMS",
        methodId: smsMethodId,
      }),
    ).rejects.toThrow(/could not be found for this user/);

    expect(smsResend).not.toHaveBeenCalled();
  });
});

describe("the mail cannot break the write", () => {
  test("a failed notification leaves the method in place", async () => {
    smsFindBy.mockResolvedValue([] as never);
    mailSpy.mockRejectedValue(new Error("smtp is down") as never);

    const created: AdminNotificationMethodView =
      await UserNotificationMethodAdminService.addMethodForUser({
        projectId: projectId,
        targetUserId: targetUserId,
        actorUserId: actorUserId,
        methodType: "SMS",
        value: RAW_PHONE,
        props: props(),
      });

    /*
     * The row is already committed by the time the mail is attempted, so
     * throwing then would report a failure for a change that happened — and the
     * caller would be entitled to believe it did not, and to try again.
     */
    expect(created.methodId).toBeDefined();
    expect(smsCreate).toHaveBeenCalled();
  });
});
