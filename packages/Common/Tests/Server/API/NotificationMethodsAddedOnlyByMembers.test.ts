jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn().mockReturnValue(null),
      isConnected: jest.fn().mockReturnValue(false),
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
      getLogLevel: jest.fn().mockReturnValue("ERROR"),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

/*
 * Billing on, as on OneUptime Cloud, so every balance check runs.
 */
jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  return { ...actual, IsBillingEnabled: true };
});

import BaseAPI from "../../../Server/API/BaseAPI";
import UserCallAPI from "../../../Server/API/UserCallAPI";
import UserEmailAPI from "../../../Server/API/UserEmailAPI";
import UserIncomingCallNumberAPI from "../../../Server/API/UserIncomingCallNumberAPI";
import UserMicrosoftTeamsAPI from "../../../Server/API/UserMicrosoftTeamsAPI";
import UserNotificationSettingAPI from "../../../Server/API/UserNotificationSettingAPI";
import UserPushAPI from "../../../Server/API/UserPushAPI";
import UserSlackAPI from "../../../Server/API/UserSlackAPI";
import UserSmsAPI from "../../../Server/API/UserSmsAPI";
import UserTelegramAPI from "../../../Server/API/UserTelegramAPI";
import UserWebhookAPI from "../../../Server/API/UserWebhookAPI";
import UserWhatsAppAPI from "../../../Server/API/UserWhatsAppAPI";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import Redis from "../../../Server/Infrastructure/Redis";
import CreatePermission from "../../../Server/Types/Database/Permissions/CreatePermission";
import CallService from "../../../Server/Services/CallService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import MailService from "../../../Server/Services/MailService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import ProjectService from "../../../Server/Services/ProjectService";
import ProjectUserProfileService from "../../../Server/Services/ProjectUserProfileService";
import SmsService from "../../../Server/Services/SmsService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamPermissionService from "../../../Server/Services/TeamPermissionService";
import UserCallService from "../../../Server/Services/UserCallService";
import UserEmailService from "../../../Server/Services/UserEmailService";
import UserIncomingCallNumberService from "../../../Server/Services/UserIncomingCallNumberService";
import UserMicrosoftTeamsService from "../../../Server/Services/UserMicrosoftTeamsService";
import UserNotificationEmailRollupSettingService from "../../../Server/Services/UserNotificationEmailRollupSettingService";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
import UserOnCallShiftReminderService from "../../../Server/Services/UserOnCallShiftReminderService";
import UserPushService from "../../../Server/Services/UserPushService";
import UserService from "../../../Server/Services/UserService";
import UserSlackService from "../../../Server/Services/UserSlackService";
import UserSmsService from "../../../Server/Services/UserSmsService";
import UserTelegramService from "../../../Server/Services/UserTelegramService";
import UserWebhookService from "../../../Server/Services/UserWebhookService";
import UserWhatsAppService from "../../../Server/Services/UserWhatsAppService";
import WhatsAppService from "../../../Server/Services/WhatsAppService";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import RealtimeAccessChanges from "../../../Server/Utils/Realtime/RealtimeAccessChanges";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import TwilioAccountAvailability from "../../../Server/Utils/TwilioAccountAvailability";
import UserPermissionUtil from "../../../Server/Utils/UserPermission/UserPermission";
import VerificationCode from "../../../Server/Utils/VerificationCode";
import ChannelVerification from "../../../Server/Utils/ChannelVerification";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ProjectUserProfile from "../../../Models/DatabaseModels/ProjectUserProfile";
import UserNotificationEmailRollupSetting from "../../../Models/DatabaseModels/UserNotificationEmailRollupSetting";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import UserOnCallShiftReminder from "../../../Models/DatabaseModels/UserOnCallShiftReminder";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import Phone from "../../../Types/Phone";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import CookieParser from "cookie-parser";
import express from "express";
import http from "http";
import { AddressInfo } from "net";
import timers from "timers";

if (
  typeof (globalThis as unknown as { setImmediate?: unknown }).setImmediate !==
  "function"
) {
  (globalThis as unknown as { setImmediate: unknown }).setImmediate =
    timers.setImmediate;
}

/*
 * A PERSON'S OWN NOTIFICATION METHODS ARE ADDED, VERIFIED AND SENT CODES ONLY
 * IN A PROJECT THEY ARE A MEMBER OF - over real HTTP.
 *
 * The routes the dashboard uses to add an email address, an SMS, call or
 * WhatsApp number or an incoming call number, and to verify them, run here
 * behind the real request middleware (a signed session, the tenantid header,
 * the project's sign-in rules), BaseAPI, DatabaseService with its whole
 * permission layer, and the channels' own services. The membership a request
 * carries is worked out by OneUptime's own AccessTokenService from the
 * project's team memberships, and a code is sent for a member only by the
 * same rule (ProjectMembership), both read from the memberships below.
 * Stubbed: the session and project lookups the middleware makes, the plan,
 * the senders (recorded, not sent), Redis, and the tables, held in memory.
 *
 * Every one of these methods sends a verification message the project pays
 * for - through its own Twilio account, or from its prepaid balance, which
 * its real on-call SMS and calls need - so the people who may add one to a
 * project are the people in it:
 *
 *   - a member adds their own, whatever their role;
 *   - nobody else does: not a member of another project (an owner there,
 *     even), not somebody whose invitation is not accepted yet, not a former
 *     member, not a fresh sign-up - with the project in the header, in the
 *     body only, or with their own project in the header and this one in
 *     the body. Their add is refused before the service's hooks run: no row,
 *     no message, and nothing about the project (whether SMS is on, its
 *     balance) said back;
 *   - a row somebody holds in a project they are no longer a member of gets
 *     no new code, is not verified, and its status is not reported;
 *   - a member's adds are counted: a number added, removed and added again
 *     sends a code each time, so adding is held to a budget too.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "7e000000-0000-4000-8000-0000000000a1",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "7e000000-0000-4000-8000-0000000000a2",
);

const PROJECT_TEAM: string = "7e000000-0000-4000-8000-0000000000e1";
const NARROW_ROLE_TEAM: string = "7e000000-0000-4000-8000-0000000000e2";
const OTHER_PROJECT_TEAM: string = "7e000000-0000-4000-8000-0000000000e3";

// Members of PROJECT_ID.
const MEMBER: ObjectID = new ObjectID("7e000000-0000-4000-8000-0000000000b1");
const MONITOR_VIEWER: ObjectID = new ObjectID(
  "7e000000-0000-4000-8000-0000000000b2",
);

// Not members of PROJECT_ID.
const OWNER_OF_OTHER_PROJECT: ObjectID = new ObjectID(
  "7e000000-0000-4000-8000-0000000000c1",
);
const INVITEE: ObjectID = new ObjectID("7e000000-0000-4000-8000-0000000000c2");
const FORMER_MEMBER: ObjectID = new ObjectID(
  "7e000000-0000-4000-8000-0000000000c3",
);
const NEWCOMER: ObjectID = new ObjectID("7e000000-0000-4000-8000-0000000000c4");

const NOT_MEMBERS: Array<[string, ObjectID]> = [
  ["the owner of another project", OWNER_OF_OTHER_PROJECT],
  ["somebody whose invitation is not accepted yet", INVITEE],
  ["a former member", FORMER_MEMBER],
  ["a fresh sign-up who belongs to no project", NEWCOMER],
];

const PROJECT_TWILIO_SID: string = "AC_PROJECT_OWN_ACCOUNT";

interface Sent {
  channel: string;
  to: string;
  projectId: string | undefined;
  viaTwilioAccountSid: string | undefined;
  body?: string | undefined;
}

const sent: Array<Sent> = [];

let server: http.Server | null = null;
let port: number = 0;

function sessionOf(userId: ObjectID): string {
  return JSONWebToken.signUserLoginToken({
    tokenData: {
      userId: userId,
      email: new Email(`${userId.toString()}@example.com`),
      name: new Name("Someone"),
      timezone: null,
      isMasterAdmin: false,
      isGlobalLogin: true,
      sessionId: ObjectID.generate(),
    },
    expiresInSeconds: 15 * 60,
  });
}

interface HttpResult {
  status: number;
  body: JSONObject;
}

function post(data: {
  path: string;
  as: ObjectID;
  tenant?: ObjectID | undefined;
  body: JSONObject;
}): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (e: Error) => void) => {
      const payload: string = JSON.stringify(data.body);

      const headers: http.OutgoingHttpHeaders = {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
        authorization: "Bearer " + sessionOf(data.as),
        "x-forwarded-for": "203.0.113.7",
      };

      if (data.tenant) {
        headers["tenantid"] = data.tenant.toString();
      }

      const request: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: port,
          path: "/api" + data.path,
          method: "POST",
          headers,
        },
        (response: http.IncomingMessage) => {
          const chunks: Array<Buffer> = [];

          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });

          response.on("end", () => {
            const text: string = Buffer.concat(chunks).toString("utf8");
            let body: JSONObject = {};

            try {
              body = text ? (JSON.parse(text) as JSONObject) : {};
            } catch {
              body = { raw: text };
            }

            resolve({ status: response.statusCode || 0, body });
          });
        },
      );

      request.on("error", reject);
      request.write(payload);
      request.end();
    },
  );
}

/*
 * The five methods that send a code. `address` is what the code goes to;
 * each add below uses a fresh one, as somebody pumping messages would.
 */
interface CodeChannel {
  name: string;
  path: string;
  service: DatabaseService<BaseModel>;
  addressField: "phone" | "email";
  addressNumber: (n: number) => string;
  sendChannel: string;
}

const CODE_CHANNELS: Array<CodeChannel> = [
  {
    name: "an incoming call number",
    path: "/user-incoming-call-number",
    service:
      UserIncomingCallNumberService as unknown as DatabaseService<BaseModel>,
    addressField: "phone",
    addressNumber: (n: number): string => {
      return `+1555010${(1000 + n).toString()}`;
    },
    sendChannel: "sms",
  },
  {
    name: "an SMS number",
    path: "/user-sms",
    service: UserSmsService as unknown as DatabaseService<BaseModel>,
    addressField: "phone",
    addressNumber: (n: number): string => {
      return `+1555020${(1000 + n).toString()}`;
    },
    sendChannel: "sms",
  },
  {
    name: "a call number",
    path: "/user-call",
    service: UserCallService as unknown as DatabaseService<BaseModel>,
    addressField: "phone",
    addressNumber: (n: number): string => {
      return `+1555030${(1000 + n).toString()}`;
    },
    sendChannel: "call",
  },
  {
    name: "a WhatsApp number",
    path: "/user-whatsapp",
    service: UserWhatsAppService as unknown as DatabaseService<BaseModel>,
    addressField: "phone",
    addressNumber: (n: number): string => {
      return `+1555040${(1000 + n).toString()}`;
    },
    sendChannel: "whatsapp",
  },
  {
    name: "an email address",
    path: "/user-email",
    service: UserEmailService as unknown as DatabaseService<BaseModel>,
    addressField: "email",
    addressNumber: (n: number): string => {
      return `someone+${n}@example.com`;
    },
    sendChannel: "email",
  },
];

/*
 * A person's other rows of a project, created the same way and by the same
 * grant: refused before their hooks run, for somebody who is not a member.
 */
interface OwnRowModel {
  name: string;
  path: string;
  service: DatabaseService<BaseModel>;
  data: JSONObject;
}

const OTHER_OWN_ROWS: Array<OwnRowModel> = [
  {
    name: "a notification rule",
    path: "/user-notification-rule",
    service:
      UserNotificationRuleService as unknown as DatabaseService<BaseModel>,
    data: { notifyAfterMinutes: 0 },
  },
  {
    name: "a notification setting",
    path: "/user-notification-setting",
    service:
      UserNotificationSettingService as unknown as DatabaseService<BaseModel>,
    data: { alertByEmail: true },
  },
  {
    name: "an email rollup setting",
    path: "/user-notification-email-rollup-setting",
    service:
      UserNotificationEmailRollupSettingService as unknown as DatabaseService<BaseModel>,
    data: {},
  },
  {
    name: "an on-call shift reminder",
    path: "/user-on-call-shift-reminder",
    service:
      UserOnCallShiftReminderService as unknown as DatabaseService<BaseModel>,
    data: { remindBeforeMinutes: 30 },
  },
  {
    name: "a webhook",
    path: "/user-webhook",
    service: UserWebhookService as unknown as DatabaseService<BaseModel>,
    data: { name: "Pager", webhookUrl: "https://example.com/hook" },
  },
  {
    name: "a Telegram account",
    path: "/user-telegram",
    service: UserTelegramService as unknown as DatabaseService<BaseModel>,
    data: {},
  },
  {
    name: "a push device",
    path: "/user-push",
    service: UserPushService as unknown as DatabaseService<BaseModel>,
    data: {
      deviceToken: "ExponentPushToken[abcdefghijklmnop]",
      deviceType: "iOS",
      deviceName: "Phone",
    },
  },
  {
    name: "a Slack account",
    path: "/user-slack",
    service: UserSlackService as unknown as DatabaseService<BaseModel>,
    data: {},
  },
  {
    name: "a Microsoft Teams account",
    path: "/user-microsoft-teams",
    service: UserMicrosoftTeamsService as unknown as DatabaseService<BaseModel>,
    data: {},
  },
  {
    name: "a project user profile",
    path: "/project-user-profile",
    service: ProjectUserProfileService as unknown as DatabaseService<BaseModel>,
    data: {},
  },
];

const tables: Map<string, InMemoryTable> = new Map();
let projects: InMemoryTable;
let createHooks: Array<{
  name: string;
  spy: ReturnType<typeof jest.spyOn>;
}> = [];

// What a project row reads like, for the hooks that ask about the project.
function projectRows(): Array<StoredRow> {
  return [
    {
      _id: PROJECT_ID.toString(),
      name: "A project",
      enableSmsNotifications: true,
      enableCallNotifications: true,
      enableWhatsAppNotifications: true,
      enableTelegramNotifications: true,
      smsOrCallCurrentBalanceInUSDCents: 100000,
    },
    {
      _id: OTHER_PROJECT_ID.toString(),
      name: "Another project",
      enableSmsNotifications: false,
      enableCallNotifications: false,
      enableWhatsAppNotifications: false,
      smsOrCallCurrentBalanceInUSDCents: 0,
    },
  ];
}

/*
 * Who belongs where. The invitee holds an invitation to the project they
 * have not accepted; the former member, nothing any more.
 */
function membershipRows(): Array<StoredRow> {
  return [
    {
      _id: "7e000000-0000-4000-8000-0000000000f1",
      userId: MEMBER.toString(),
      projectId: PROJECT_ID.toString(),
      teamId: PROJECT_TEAM,
      hasAcceptedInvitation: true,
    },
    {
      _id: "7e000000-0000-4000-8000-0000000000f2",
      userId: MONITOR_VIEWER.toString(),
      projectId: PROJECT_ID.toString(),
      teamId: NARROW_ROLE_TEAM,
      hasAcceptedInvitation: true,
    },
    {
      _id: "7e000000-0000-4000-8000-0000000000f3",
      userId: OWNER_OF_OTHER_PROJECT.toString(),
      projectId: OTHER_PROJECT_ID.toString(),
      teamId: OTHER_PROJECT_TEAM,
      hasAcceptedInvitation: true,
    },
    {
      _id: "7e000000-0000-4000-8000-0000000000f4",
      userId: INVITEE.toString(),
      projectId: PROJECT_ID.toString(),
      teamId: PROJECT_TEAM,
      hasAcceptedInvitation: false,
    },
  ];
}

function teamPermissionRows(): Array<StoredRow> {
  return [
    {
      _id: "7e000000-0000-4000-8000-0000000000d1",
      teamId: PROJECT_TEAM,
      projectId: PROJECT_ID.toString(),
      permission: Permission.ProjectMember,
      isBlockPermission: false,
    },
    {
      _id: "7e000000-0000-4000-8000-0000000000d2",
      teamId: NARROW_ROLE_TEAM,
      projectId: PROJECT_ID.toString(),
      permission: Permission.MonitorViewer,
      isBlockPermission: false,
    },
    {
      _id: "7e000000-0000-4000-8000-0000000000d3",
      teamId: OTHER_PROJECT_TEAM,
      projectId: OTHER_PROJECT_ID.toString(),
      permission: Permission.ProjectOwner,
      isBlockPermission: false,
    },
  ];
}

beforeAll(async () => {
  const app: express.Express = express();
  app.use(CookieParser());
  app.use(express.json());
  app.use("/api", new UserIncomingCallNumberAPI().getRouter());
  app.use("/api", new UserSmsAPI().getRouter());
  app.use("/api", new UserCallAPI().getRouter());
  app.use("/api", new UserEmailAPI().getRouter());
  app.use("/api", new UserWhatsAppAPI().getRouter());
  app.use("/api", new UserTelegramAPI().getRouter());
  app.use("/api", new UserSlackAPI().getRouter());
  app.use("/api", new UserMicrosoftTeamsAPI().getRouter());
  app.use("/api", new UserWebhookAPI().getRouter());
  app.use("/api", new UserPushAPI().getRouter());
  app.use("/api", new UserNotificationSettingAPI().getRouter());
  app.use(
    "/api",
    new BaseAPI<UserNotificationRule, DatabaseService<BaseModel>>(
      UserNotificationRule,
      UserNotificationRuleService as unknown as DatabaseService<BaseModel>,
    ).getRouter(),
  );
  app.use(
    "/api",
    new BaseAPI<UserOnCallShiftReminder, DatabaseService<BaseModel>>(
      UserOnCallShiftReminder,
      UserOnCallShiftReminderService as unknown as DatabaseService<BaseModel>,
    ).getRouter(),
  );
  app.use(
    "/api",
    new BaseAPI<UserNotificationEmailRollupSetting, DatabaseService<BaseModel>>(
      UserNotificationEmailRollupSetting,
      UserNotificationEmailRollupSettingService as unknown as DatabaseService<BaseModel>,
    ).getRouter(),
  );
  app.use(
    "/api",
    new BaseAPI<ProjectUserProfile, DatabaseService<BaseModel>>(
      ProjectUserProfile,
      ProjectUserProfileService as unknown as DatabaseService<BaseModel>,
    ).getRouter(),
  );
  app.use(expressErrorHandler);

  const startedServer: http.Server = http.createServer(app);

  await new Promise<void>((resolve: () => void) => {
    startedServer.listen(0, "127.0.0.1", resolve);
  });

  server = startedServer;
  port = (startedServer.address() as AddressInfo).port;
});

afterAll(async () => {
  const startedServer: http.Server | null = server;
  server = null;

  if (startedServer) {
    await new Promise<void>((resolve: () => void) => {
      startedServer.close(() => {
        resolve();
      });
    });
  }
});

beforeEach(() => {
  sent.length = 0;

  // The session and the project, as the middleware reads them.
  jest
    .spyOn(UserService, "updateLastActive")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(ProjectService, "updateLastActive")
    .mockResolvedValue(undefined as never);
  jest.spyOn(UserService, "isUserBlocked").mockResolvedValue(false as never);
  jest
    .spyOn(UserService, "isUserMasterAdmin")
    .mockResolvedValue(false as never);
  jest
    .spyOn(ProjectService, "isProjectBlocked")
    .mockResolvedValue(false as never);
  jest
    .spyOn(ProjectService, "getRequireSsoForLogin")
    .mockResolvedValue(false as never);
  jest
    .spyOn(ProjectService, "getRequireSsoWithSsoProviderId")
    .mockResolvedValue(null as never);
  jest
    .spyOn(GlobalConfigService, "getRequireSsoForLogin")
    .mockResolvedValue(false as never);
  jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
    plan: PlanType.Free,
    isSubscriptionUnpaid: false,
  } as never);

  // Every permission set is rebuilt from the memberships below.
  jest
    .spyOn(UserPermissionUtil, "getUserTenantAccessPermissionFromCache")
    .mockResolvedValue(null as never);
  jest
    .spyOn(UserPermissionUtil, "getUserGlobalAccessPermissionFromCache")
    .mockResolvedValue(null as never);
  jest.spyOn(GlobalCache, "setJSON").mockResolvedValue(undefined as never);
  jest.spyOn(GlobalCache, "deleteKey").mockResolvedValue(undefined as never);
  jest.spyOn(RealtimeAccessChanges, "announce").mockReturnValue(undefined);
  jest
    .spyOn(TeamMemberService, "getTeamIdsForUser")
    .mockResolvedValue([] as never);

  // The project sends through its own Twilio account.
  jest
    .spyOn(ProjectCallSMSConfigService, "getProjectDefaultTwilioConfig")
    .mockImplementation((async (
      projectId: ObjectID | undefined,
    ): Promise<unknown> => {
      if (projectId && projectId.toString() === PROJECT_ID.toString()) {
        return {
          accountSid: PROJECT_TWILIO_SID,
          authToken: "project-token",
          primaryPhoneNumber: new Phone("+15550000001"),
          secondaryPhoneNumbers: [],
        };
      }

      return undefined;
    }) as never);
  jest
    .spyOn(TwilioAccountAvailability, "isAccountAvailableForProject")
    .mockResolvedValue(true as never);

  // The senders: recorded, never sent.
  jest.spyOn(SmsService, "sendSms").mockImplementation((async (
    sms: { to: Phone; message: string },
    options: {
      projectId?: ObjectID;
      customTwilioConfig?: { accountSid?: string };
    },
  ): Promise<JSONObject> => {
    sent.push({
      channel: "sms",
      to: sms.to.toString(),
      projectId: options?.projectId?.toString(),
      viaTwilioAccountSid: options?.customTwilioConfig?.accountSid,
      body: sms.message,
    });
    return {};
  }) as never);
  jest.spyOn(CallService, "makeCall").mockImplementation((async (
    call: { to: Phone },
    options: {
      projectId?: ObjectID;
      customTwilioConfig?: { accountSid?: string };
    },
  ): Promise<JSONObject> => {
    sent.push({
      channel: "call",
      to: call.to.toString(),
      projectId: options?.projectId?.toString(),
      viaTwilioAccountSid: options?.customTwilioConfig?.accountSid,
    });
    return {};
  }) as never);
  jest.spyOn(WhatsAppService, "sendWhatsAppMessage").mockImplementation((async (
    message: { to: Phone },
    options: { projectId?: ObjectID },
  ): Promise<JSONObject> => {
    sent.push({
      channel: "whatsapp",
      to: message.to.toString(),
      projectId: options?.projectId?.toString(),
      viaTwilioAccountSid: undefined,
    });
    return {};
  }) as never);
  jest.spyOn(MailService, "sendMail").mockImplementation((async (
    mail: { toEmail: Email },
    options: { projectId?: ObjectID },
  ): Promise<void> => {
    sent.push({
      channel: "email",
      to: mail.toEmail.toString(),
      projectId: options?.projectId?.toString(),
      viaTwilioAccountSid: undefined,
    });
  }) as never);

  projects = useInMemoryTable(ProjectService, projectRows());
  useInMemoryTable(TeamMemberService, membershipRows());
  useInMemoryTable(TeamPermissionService, teamPermissionRows());

  tables.clear();
  createHooks = [];

  for (const channel of CODE_CHANNELS) {
    tables.set(channel.path, useInMemoryTable(channel.service, []));
    createHooks.push({
      name: channel.name,
      spy: jest.spyOn(
        channel.service as unknown as Record<string, () => unknown>,
        "onBeforeCreate",
      ),
    });
  }

  for (const model of OTHER_OWN_ROWS) {
    tables.set(model.path, useInMemoryTable(model.service, []));
    createHooks.push({
      name: model.name,
      spy: jest.spyOn(
        model.service as unknown as Record<string, () => unknown>,
        "onBeforeCreate",
      ),
    });
  }
});

afterEach(() => {
  jest.restoreAllMocks();
  (Redis.getClient as unknown as ReturnType<typeof jest.fn>).mockReturnValue(
    null,
  );
  (Redis.isConnected as unknown as ReturnType<typeof jest.fn>).mockReturnValue(
    false,
  );
});

async function settle(): Promise<void> {
  // Mail goes out fire-and-forget: give it a turn.
  await new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, 20);
  });
}

function addBody(
  channel: CodeChannel,
  n: number,
  projectId: ObjectID = PROJECT_ID,
): JSONObject {
  return {
    data: {
      projectId: projectId.toString(),
      [channel.addressField]: channel.addressNumber(n),
    },
  };
}

/*
 * The refusal's words: a route's own refusal answers { message }, and one
 * thrown through to the error handler answers { error }.
 */
function errorOf(result: HttpResult): unknown {
  return result.body["error"] ?? result.body["message"];
}

function projectWasRead(): boolean {
  return projects.repository.find.mock.calls.length > 0;
}

function anyCreateHookRan(): boolean {
  return createHooks.some(
    (hook: { spy: ReturnType<typeof jest.spyOn> }): boolean => {
      return hook.spy.mock.calls.length > 0;
    },
  );
}

describe.each(CODE_CHANNELS)("adding $name", (channel: CodeChannel) => {
  describe.each(NOT_MEMBERS)("%s", (_who: string, person: ObjectID) => {
    test("adds nothing, sends nothing, and learns nothing about the project", async () => {
      const result: HttpResult = await post({
        path: channel.path,
        as: person,
        tenant: PROJECT_ID,
        body: addBody(channel, 1),
      });
      await settle();

      expect(result.status).toBe(422);
      expect(errorOf(result)).toBe(
        CreatePermission.NOT_A_PROJECT_MEMBER_MESSAGE,
      );
      expect(tables.get(channel.path)!.inserts).toEqual([]);
      expect(sent).toEqual([]);
      // Refused before the service's hooks: the project was not even asked.
      expect(anyCreateHookRan()).toBe(false);
      expect(projectWasRead()).toBe(false);
    });

    test("with the project in the body only, adds nothing and is asked for the project", async () => {
      const result: HttpResult = await post({
        path: channel.path,
        as: person,
        body: addBody(channel, 2),
      });
      await settle();

      expect(result.status).toBe(400);
      expect(errorOf(result)).toBe(CreatePermission.PROJECT_REQUIRED_MESSAGE);
      expect(tables.get(channel.path)!.inserts).toEqual([]);
      expect(sent).toEqual([]);
      expect(anyCreateHookRan()).toBe(false);
    });
  });

  test("the owner of another project, naming their own project in the header and this one in the body, adds nothing", async () => {
    const result: HttpResult = await post({
      path: channel.path,
      as: OWNER_OF_OTHER_PROJECT,
      tenant: OTHER_PROJECT_ID,
      body: addBody(channel, 3, PROJECT_ID),
    });
    await settle();

    expect(result.status).toBe(400);
    expect(errorOf(result)).toBe(CreatePermission.PROJECT_MISMATCH_MESSAGE);
    expect(tables.get(channel.path)!.inserts).toEqual([]);
    expect(sent).toEqual([]);
    // This project's settings are not described back to them.
    expect(anyCreateHookRan()).toBe(false);
    expect(projectWasRead()).toBe(false);
  });

  test("a member adds their own, and its code goes out on the project's account", async () => {
    const result: HttpResult = await post({
      path: channel.path,
      as: MEMBER,
      tenant: PROJECT_ID,
      body: addBody(channel, 4),
    });
    await settle();

    expect(result.status).toBe(200);

    const inserts: Array<StoredRow> = tables.get(channel.path)!.inserts;
    expect(inserts).toHaveLength(1);
    expect(String(inserts[0]!["projectId"]).toLowerCase()).toBe(
      PROJECT_ID.toString(),
    );
    expect(String(inserts[0]!["userId"]).toLowerCase()).toBe(MEMBER.toString());

    expect(sent).toHaveLength(1);
    expect(sent[0]!.channel).toBe(channel.sendChannel);
    expect(sent[0]!.to).toBe(channel.addressNumber(4));
    expect(sent[0]!.projectId).toBe(PROJECT_ID.toString());
  });

  test("a member whose only role is Monitor Viewer adds their own too: any member may", async () => {
    const result: HttpResult = await post({
      path: channel.path,
      as: MONITOR_VIEWER,
      tenant: PROJECT_ID,
      body: addBody(channel, 5),
    });
    await settle();

    expect(result.status).toBe(200);
    expect(tables.get(channel.path)!.inserts).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  test("a member naming another project in the body is refused, and that project is not described", async () => {
    const result: HttpResult = await post({
      path: channel.path,
      as: MEMBER,
      tenant: PROJECT_ID,
      body: addBody(channel, 6, OTHER_PROJECT_ID),
    });
    await settle();

    expect(result.status).toBe(400);
    expect(errorOf(result)).toBe(CreatePermission.PROJECT_MISMATCH_MESSAGE);
    expect(tables.get(channel.path)!.inserts).toEqual([]);
    expect(sent).toEqual([]);
    expect(projectWasRead()).toBe(false);
  });
});

describe.each(OTHER_OWN_ROWS)("adding $name", (model: OwnRowModel) => {
  test.each(NOT_MEMBERS)(
    "%s adds nothing, and its hooks never run",
    async (_who: string, person: ObjectID) => {
      const result: HttpResult = await post({
        path: model.path,
        as: person,
        tenant: PROJECT_ID,
        body: {
          data: { ...model.data, projectId: PROJECT_ID.toString() },
        },
      });
      await settle();

      expect(result.status).toBe(422);
      expect(errorOf(result)).toBe(
        CreatePermission.NOT_A_PROJECT_MEMBER_MESSAGE,
      );
      expect(tables.get(model.path)!.inserts).toEqual([]);
      expect(anyCreateHookRan()).toBe(false);
      expect(sent).toEqual([]);
    },
  );
});

/*
 * A row in a project its owner is not a member of (any more) - left behind
 * by a removal that did not finish, or added before an add had to come from
 * a member. It gets no new code, is not verified, and its status is not
 * reported: the route answers as if it did not exist.
 */
describe("a row its owner holds in a project they are not a member of", () => {
  const ROW_ID: string = "7e000000-0000-4000-8000-000000000101";
  const CODE: string = "424242";

  let incoming: InMemoryTable;

  beforeEach(() => {
    incoming = useInMemoryTable(UserIncomingCallNumberService, [
      {
        _id: ROW_ID,
        projectId: PROJECT_ID.toString(),
        userId: FORMER_MEMBER.toString(),
        phone: "+15550109999",
        isVerified: false,
        verificationCode: VerificationCode.hashCode({
          code: CODE,
          channelId: new ObjectID(ROW_ID),
        }),
        verificationCodeExpiresAt: ChannelVerification.getExpiresAt(),
        // Long past the resend cooldown.
        verificationCodeSentAt: new Date(Date.now() - 60 * 60 * 1000),
        verificationFailedAttempts: 0,
      },
    ]);
  });

  test("gets no new code", async () => {
    const result: HttpResult = await post({
      path: "/user-incoming-call-number/resend-verification-code",
      as: FORMER_MEMBER,
      tenant: PROJECT_ID,
      body: { itemId: ROW_ID },
    });

    expect(result.status).toBe(400);
    expect(errorOf(result)).toBe("Item with ID " + ROW_ID + " not found");
    expect(sent).toEqual([]);
    expect(incoming.updates).toEqual([]);
    // Nothing about the project is read for them either.
    expect(projectWasRead()).toBe(false);
  });

  test("is not verified, even with the right code", async () => {
    const result: HttpResult = await post({
      path: "/user-incoming-call-number/verify",
      as: FORMER_MEMBER,
      tenant: PROJECT_ID,
      body: { itemId: ROW_ID, code: CODE },
    });

    expect(result.status).toBe(400);
    expect(errorOf(result)).toBe("Item not found");
    expect(incoming.get(ROW_ID)!["isVerified"]).toBe(false);
    expect(incoming.updates).toEqual([]);
  });

  test("has no status reported", async () => {
    const result: HttpResult = await post({
      path: "/user-incoming-call-number/verification-status",
      as: FORMER_MEMBER,
      tenant: PROJECT_ID,
      body: { itemId: ROW_ID },
    });

    expect(result.status).toBe(400);
    expect(errorOf(result)).toBe("Item not found");
    expect(projectWasRead()).toBe(false);
  });

  test("while the same row of a member still gets its code (the control)", async () => {
    incoming.rows[0]!["userId"] = MEMBER.toString();

    const result: HttpResult = await post({
      path: "/user-incoming-call-number/resend-verification-code",
      as: MEMBER,
      tenant: PROJECT_ID,
      body: { itemId: ROW_ID },
    });

    expect(result.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("+15550109999");
    expect(sent[0]!.viaTwilioAccountSid).toBe(PROJECT_TWILIO_SID);
  });
});

/*
 * A member's adds are counted: adding a number, removing it and adding it
 * again sends a code each time. A counter store that counts, in memory.
 */
describe("adding is held to a budget", () => {
  class CountingRedis {
    public counters: Map<string, number> = new Map<string, number>();

    public pipeline(): CountingPipeline {
      return new CountingPipeline(this);
    }
  }

  class CountingPipeline {
    private commands: Array<() => [null, number]> = [];

    public constructor(private store: CountingRedis) {}

    public incr(key: string): CountingPipeline {
      this.commands.push((): [null, number] => {
        const next: number = (this.store.counters.get(key) || 0) + 1;
        this.store.counters.set(key, next);
        return [null, next];
      });
      return this;
    }

    public expire(): CountingPipeline {
      this.commands.push((): [null, number] => {
        return [null, 1];
      });
      return this;
    }

    public async exec(): Promise<Array<[null, number]>> {
      return this.commands.map((command: () => [null, number]) => {
        return command();
      });
    }
  }

  beforeEach(() => {
    (Redis.getClient as unknown as ReturnType<typeof jest.fn>).mockReturnValue(
      new CountingRedis(),
    );
    (
      Redis.isConnected as unknown as ReturnType<typeof jest.fn>
    ).mockReturnValue(true);
  });

  test("the sixth SMS number a member adds within the window is refused, and sends nothing", async () => {
    const smsChannel: CodeChannel = CODE_CHANNELS[1]!;

    for (let n: number = 0; n < 5; n++) {
      const result: HttpResult = await post({
        path: smsChannel.path,
        as: MEMBER,
        tenant: PROJECT_ID,
        body: addBody(smsChannel, 10 + n),
      });

      expect(result.status).toBe(200);
    }

    expect(sent).toHaveLength(5);

    const refused: HttpResult = await post({
      path: smsChannel.path,
      as: MEMBER,
      tenant: PROJECT_ID,
      body: addBody(smsChannel, 99),
    });

    expect(refused.status).toBe(429);
    expect(errorOf(refused)).toBe(
      "Too many notification methods added. Please try again later.",
    );
    expect(sent).toHaveLength(5);
    expect(tables.get(smsChannel.path)!.inserts).toHaveLength(5);
  });

  test("a member setting up every kind of method at once is not refused", async () => {
    for (const [index, channel] of CODE_CHANNELS.entries()) {
      const result: HttpResult = await post({
        path: channel.path,
        as: MEMBER,
        tenant: PROJECT_ID,
        body: addBody(channel, 20 + index),
      });

      expect(result.status).toBe(200);
    }

    await settle();

    expect(sent).toHaveLength(CODE_CHANNELS.length);
  });
});
