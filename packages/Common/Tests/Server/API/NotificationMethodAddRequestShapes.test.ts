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

// Billing on, as on OneUptime Cloud, so every balance check runs.
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
import UserSmsAPI from "../../../Server/API/UserSmsAPI";
import UserTelegramAPI from "../../../Server/API/UserTelegramAPI";
import UserWhatsAppAPI from "../../../Server/API/UserWhatsAppAPI";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import ApiKeyService from "../../../Server/Services/ApiKeyService";
import CallService from "../../../Server/Services/CallService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import MailService from "../../../Server/Services/MailService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import ProjectService from "../../../Server/Services/ProjectService";
import SmsService from "../../../Server/Services/SmsService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamPermissionService from "../../../Server/Services/TeamPermissionService";
import UserCallService from "../../../Server/Services/UserCallService";
import UserEmailService from "../../../Server/Services/UserEmailService";
import UserIncomingCallNumberService from "../../../Server/Services/UserIncomingCallNumberService";
import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
import UserService from "../../../Server/Services/UserService";
import UserSmsService from "../../../Server/Services/UserSmsService";
import UserTelegramService from "../../../Server/Services/UserTelegramService";
import UserWhatsAppService from "../../../Server/Services/UserWhatsAppService";
import WhatsAppService from "../../../Server/Services/WhatsAppService";
import CreatePermission from "../../../Server/Types/Database/Permissions/CreatePermission";
import APIKeyAccessPermission from "../../../Server/Utils/APIKey/AccessPermission";
import PlanCutoffCredentialAccess from "../../../Server/Utils/Billing/PlanCutoffCredentialAccess";
import ChannelVerification from "../../../Server/Utils/ChannelVerification";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import MultiTenantQuery from "../../../Server/Utils/MultiTenantQuery";
import RealtimeAccessChanges from "../../../Server/Utils/Realtime/RealtimeAccessChanges";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import TwilioAccountAvailability from "../../../Server/Utils/TwilioAccountAvailability";
import UserPermissionUtil from "../../../Server/Utils/UserPermission/UserPermission";
import VerificationCode from "../../../Server/Utils/VerificationCode";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import UserNotificationSetting from "../../../Models/DatabaseModels/UserNotificationSetting";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
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
 * EVERY WAY A REQUEST CAN NAME ITS PROJECT, WHEN SOMEBODY ADDS ONE OF THEIR
 * OWN NOTIFICATION METHODS - over real HTTP.
 *
 * NotificationMethodsAddedOnlyByMembers holds the rule with the tenantid
 * header and a project named in the row. A request can name its project in
 * more ways than that (ProjectMiddleware.getProjectId): a projectid header,
 * a tenantid query parameter, a projectId at the top of the body, an id in
 * another case, and the multi-tenant header that asks across the caller's
 * own projects. And a project can refuse a member: it can require SSO for
 * sign-in, or a master admin can have blocked it. Here each of those is
 * tried by somebody who is not a member, by a member who has not signed in
 * the way the project requires, by a member of a blocked project and with
 * the project's own API key - against every method that sends a code, which
 * the project pays for. None of them adds anything, sends anything or has
 * the project's settings read for them; a member adding their own the way
 * the dashboard does still works.
 *
 * Stubbed as in NotificationMethodsAddedOnlyByMembers: the session and
 * project lookups the middleware makes, the plan, the senders (recorded,
 * not sent), Redis, and the tables, held in memory. The memberships are
 * worked out by OneUptime's own AccessTokenService from the rows below.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-0000000000a1",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-0000000000a2",
);
// Requires SSO for sign-in; MEMBER is in it but signed in with a password.
const SSO_PROJECT_ID: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-0000000000a3",
);
// Blocked by a master admin; MEMBER is in it.
const BLOCKED_PROJECT_ID: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-0000000000a4",
);

const PROJECT_TEAM: string = "7f000000-0000-4000-8000-0000000000e1";
const OTHER_PROJECT_TEAM: string = "7f000000-0000-4000-8000-0000000000e2";
const SSO_PROJECT_TEAM: string = "7f000000-0000-4000-8000-0000000000e3";
const BLOCKED_PROJECT_TEAM: string = "7f000000-0000-4000-8000-0000000000e4";

// A member of PROJECT_ID, SSO_PROJECT_ID and BLOCKED_PROJECT_ID.
const MEMBER: ObjectID = new ObjectID("7f000000-0000-4000-8000-0000000000b1");

// The owner of OTHER_PROJECT_ID, and nothing in PROJECT_ID.
const OUTSIDER: ObjectID = new ObjectID("7f000000-0000-4000-8000-0000000000c1");

// PROJECT_ID's own API key, holding Project Owner.
const API_KEY: ObjectID = new ObjectID("7f000000-0000-4000-8000-0000000000d9");

const PROJECT_TWILIO_SID: string = "AC_PROJECT_OWN_ACCOUNT";

const PROJECTS_WITH_TWILIO: Array<string> = [
  PROJECT_ID.toString(),
  SSO_PROJECT_ID.toString(),
  BLOCKED_PROJECT_ID.toString(),
];

interface Sent {
  channel: string;
  to: string;
  projectId: string | undefined;
  viaTwilioAccountSid: string | undefined;
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

/*
 * One request, named the way a client chooses: a session or the project's
 * API key, and the project in any of the places the middleware reads it.
 */
interface RequestShape {
  path: string;
  // A signed session of this person.
  as?: ObjectID | undefined;
  // Or an API key.
  apiKey?: ObjectID | undefined;
  // The tenantid header, exactly as sent.
  tenantHeader?: string | undefined;
  // The projectid header, exactly as sent.
  projectIdHeader?: string | undefined;
  // ?tenantid= on the address.
  tenantQuery?: string | undefined;
  // The is-multi-tenant-query header: a request across the caller's projects.
  acrossProjects?: boolean | undefined;
  body: JSONObject;
}

function post(shape: RequestShape): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (e: Error) => void) => {
      const payload: string = JSON.stringify(shape.body);

      const headers: http.OutgoingHttpHeaders = {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
        "x-forwarded-for": "203.0.113.9",
      };

      if (shape.as) {
        headers["authorization"] = "Bearer " + sessionOf(shape.as);
      }

      if (shape.apiKey) {
        headers["apikey"] = shape.apiKey.toString();
      }

      if (shape.tenantHeader) {
        headers["tenantid"] = shape.tenantHeader;
      }

      if (shape.projectIdHeader) {
        headers["projectid"] = shape.projectIdHeader;
      }

      if (shape.acrossProjects) {
        headers["is-multi-tenant-query"] = "true";
      }

      const query: string = shape.tenantQuery
        ? "?tenantid=" + encodeURIComponent(shape.tenantQuery)
        : "";

      const request: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: port,
          path: "/api" + shape.path + query,
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

// The five methods that send a code the project pays for.
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
      return `+1555110${(1000 + n).toString()}`;
    },
    sendChannel: "sms",
  },
  {
    name: "an SMS number",
    path: "/user-sms",
    service: UserSmsService as unknown as DatabaseService<BaseModel>,
    addressField: "phone",
    addressNumber: (n: number): string => {
      return `+1555120${(1000 + n).toString()}`;
    },
    sendChannel: "sms",
  },
  {
    name: "a call number",
    path: "/user-call",
    service: UserCallService as unknown as DatabaseService<BaseModel>,
    addressField: "phone",
    addressNumber: (n: number): string => {
      return `+1555130${(1000 + n).toString()}`;
    },
    sendChannel: "call",
  },
  {
    name: "a WhatsApp number",
    path: "/user-whatsapp",
    service: UserWhatsAppService as unknown as DatabaseService<BaseModel>,
    addressField: "phone",
    addressNumber: (n: number): string => {
      return `+1555140${(1000 + n).toString()}`;
    },
    sendChannel: "whatsapp",
  },
  {
    name: "an email address",
    path: "/user-email",
    service: UserEmailService as unknown as DatabaseService<BaseModel>,
    addressField: "email",
    addressNumber: (n: number): string => {
      return `someone.else+${n}@example.com`;
    },
    sendChannel: "email",
  },
];

const tables: Map<string, InMemoryTable> = new Map();
let projects: InMemoryTable;
let settings: InMemoryTable;
let createHooks: Array<ReturnType<typeof jest.spyOn>> = [];

function projectRow(id: ObjectID, name: string): StoredRow {
  return {
    _id: id.toString(),
    name: name,
    enableSmsNotifications: true,
    enableCallNotifications: true,
    enableWhatsAppNotifications: true,
    smsOrCallCurrentBalanceInUSDCents: 100000,
  };
}

function projectRows(): Array<StoredRow> {
  return [
    projectRow(PROJECT_ID, "A project"),
    projectRow(OTHER_PROJECT_ID, "Another project"),
    projectRow(SSO_PROJECT_ID, "A project that requires SSO"),
    projectRow(BLOCKED_PROJECT_ID, "A blocked project"),
  ];
}

function membership(
  id: string,
  userId: ObjectID,
  projectId: ObjectID,
  teamId: string,
): StoredRow {
  return {
    _id: id,
    userId: userId.toString(),
    projectId: projectId.toString(),
    teamId: teamId,
    hasAcceptedInvitation: true,
  };
}

function membershipRows(): Array<StoredRow> {
  return [
    membership(
      "7f000000-0000-4000-8000-0000000000f1",
      MEMBER,
      PROJECT_ID,
      PROJECT_TEAM,
    ),
    membership(
      "7f000000-0000-4000-8000-0000000000f2",
      MEMBER,
      SSO_PROJECT_ID,
      SSO_PROJECT_TEAM,
    ),
    membership(
      "7f000000-0000-4000-8000-0000000000f3",
      MEMBER,
      BLOCKED_PROJECT_ID,
      BLOCKED_PROJECT_TEAM,
    ),
    membership(
      "7f000000-0000-4000-8000-0000000000f4",
      OUTSIDER,
      OTHER_PROJECT_ID,
      OTHER_PROJECT_TEAM,
    ),
  ];
}

function teamPermission(
  id: string,
  teamId: string,
  projectId: ObjectID,
  permission: Permission,
): StoredRow {
  return {
    _id: id,
    teamId: teamId,
    projectId: projectId.toString(),
    permission: permission,
    isBlockPermission: false,
  };
}

function teamPermissionRows(): Array<StoredRow> {
  return [
    teamPermission(
      "7f000000-0000-4000-8000-0000000000d1",
      PROJECT_TEAM,
      PROJECT_ID,
      Permission.ProjectMember,
    ),
    teamPermission(
      "7f000000-0000-4000-8000-0000000000d2",
      SSO_PROJECT_TEAM,
      SSO_PROJECT_ID,
      Permission.ProjectMember,
    ),
    teamPermission(
      "7f000000-0000-4000-8000-0000000000d3",
      BLOCKED_PROJECT_TEAM,
      BLOCKED_PROJECT_ID,
      Permission.ProjectMember,
    ),
    teamPermission(
      "7f000000-0000-4000-8000-0000000000d4",
      OTHER_PROJECT_TEAM,
      OTHER_PROJECT_ID,
      Permission.ProjectOwner,
    ),
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
  app.use(
    "/api",
    new BaseAPI<UserNotificationSetting, DatabaseService<BaseModel>>(
      UserNotificationSetting,
      UserNotificationSettingService as unknown as DatabaseService<BaseModel>,
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

  // The session and the projects, as the middleware reads them.
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
  jest.spyOn(ProjectService, "isProjectBlocked").mockImplementation((async (
    projectId: ObjectID,
  ): Promise<boolean> => {
    return projectId.toString().toLowerCase() === BLOCKED_PROJECT_ID.toString();
  }) as never);
  jest
    .spyOn(ProjectService, "getRequireSsoForLogin")
    .mockImplementation((async (projectId: ObjectID): Promise<boolean> => {
      return projectId.toString().toLowerCase() === SSO_PROJECT_ID.toString();
    }) as never);
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

  // PROJECT_ID's own API key, which may do anything a Project Owner may.
  jest.spyOn(ApiKeyService, "findApiKey").mockImplementation((async (
    apiKey: ObjectID,
  ): Promise<unknown> => {
    if (apiKey.toString() !== API_KEY.toString()) {
      return null;
    }

    return { id: API_KEY, projectId: PROJECT_ID, name: "Automation" };
  }) as never);
  jest
    .spyOn(PlanCutoffCredentialAccess, "getRefusal")
    .mockResolvedValue(null as never);
  jest
    .spyOn(APIKeyAccessPermission, "getDefaultApiGlobalPermission")
    .mockResolvedValue({
      projectIds: [PROJECT_ID],
      globalPermissions: [Permission.Public],
      _type: "UserGlobalAccessPermission",
    } as never);
  jest
    .spyOn(APIKeyAccessPermission, "getApiTenantAccessPermission")
    .mockResolvedValue({
      projectId: PROJECT_ID,
      permissions: [Permission.ProjectOwner, Permission.CurrentUser].map(
        (permission: Permission) => {
          return {
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
            _type: "UserPermission",
          };
        },
      ),
      _type: "UserTenantAccessPermission",
    } as never);

  // The projects send through their own Twilio account.
  jest
    .spyOn(ProjectCallSMSConfigService, "getProjectDefaultTwilioConfig")
    .mockImplementation((async (
      projectId: ObjectID | undefined,
    ): Promise<unknown> => {
      if (
        projectId &&
        PROJECTS_WITH_TWILIO.includes(projectId.toString().toLowerCase())
      ) {
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
    sms: { to: Phone },
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
    createHooks.push(
      jest.spyOn(
        channel.service as unknown as Record<string, () => unknown>,
        "onBeforeCreate",
      ),
    );
  }

  settings = useInMemoryTable(UserNotificationSettingService, []);
  createHooks.push(
    jest.spyOn(
      UserNotificationSettingService as unknown as Record<
        string,
        () => unknown
      >,
      "onBeforeCreate",
    ),
  );
});

afterEach(() => {
  jest.restoreAllMocks();
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
  data: JSONObject = { projectId: PROJECT_ID.toString() },
): JSONObject {
  return {
    data: {
      ...data,
      [channel.addressField]: channel.addressNumber(n),
    },
  };
}

function errorOf(result: HttpResult): unknown {
  return result.body["error"] ?? result.body["message"];
}

function projectWasRead(): boolean {
  return projects.repository.find.mock.calls.length > 0;
}

function anyCreateHookRan(): boolean {
  return createHooks.some((spy: ReturnType<typeof jest.spyOn>): boolean => {
    return spy.mock.calls.length > 0;
  });
}

function nothingAdded(): boolean {
  return (
    Array.from(tables.values()).every((table: InMemoryTable): boolean => {
      return table.inserts.length === 0;
    }) && settings.inserts.length === 0
  );
}

/*
 * What every refused add below must leave behind: no row, no message, no
 * hook run, and nothing about the project read for the caller.
 */
function expectNothingDone(): void {
  expect(nothingAdded()).toBe(true);
  expect(sent).toEqual([]);
  expect(anyCreateHookRan()).toBe(false);
  expect(projectWasRead()).toBe(false);
}

describe.each(CODE_CHANNELS)(
  "$name added by somebody who is not a member, however the request names the project",
  (channel: CodeChannel) => {
    test("in a tenantid query parameter", async () => {
      const result: HttpResult = await post({
        path: channel.path,
        as: OUTSIDER,
        tenantQuery: PROJECT_ID.toString(),
        body: addBody(channel, 1),
      });
      await settle();

      expect(result.status).toBe(422);
      expect(errorOf(result)).toBe(
        CreatePermission.NOT_A_PROJECT_MEMBER_MESSAGE,
      );
      expectNothingDone();
    });

    test("in a projectid header", async () => {
      const result: HttpResult = await post({
        path: channel.path,
        as: OUTSIDER,
        projectIdHeader: PROJECT_ID.toString(),
        body: addBody(channel, 2),
      });
      await settle();

      expect(result.status).toBe(422);
      expect(errorOf(result)).toBe(
        CreatePermission.NOT_A_PROJECT_MEMBER_MESSAGE,
      );
      expectNothingDone();
    });

    test("in a projectId at the top of the body", async () => {
      const result: HttpResult = await post({
        path: channel.path,
        as: OUTSIDER,
        body: {
          ...addBody(channel, 3),
          projectId: PROJECT_ID.toString(),
        },
      });
      await settle();

      expect(result.status).toBe(422);
      expect(errorOf(result)).toBe(
        CreatePermission.NOT_A_PROJECT_MEMBER_MESSAGE,
      );
      expectNothingDone();
    });

    test("in the tenantid header, in upper case", async () => {
      const result: HttpResult = await post({
        path: channel.path,
        as: OUTSIDER,
        tenantHeader: PROJECT_ID.toString().toUpperCase(),
        body: addBody(channel, 4, {
          projectId: PROJECT_ID.toString().toUpperCase(),
        }),
      });
      await settle();

      expect(result.status).toBe(422);
      expect(errorOf(result)).toBe(
        CreatePermission.NOT_A_PROJECT_MEMBER_MESSAGE,
      );
      expectNothingDone();
    });

    /*
     * A request is made in one project or across the caller's projects,
     * never both: refused before anything is read for the project
     * (MultiTenantQuery).
     */
    test("in the tenantid header, asking across their own projects too", async () => {
      const result: HttpResult = await post({
        path: channel.path,
        as: OUTSIDER,
        tenantHeader: PROJECT_ID.toString(),
        acrossProjects: true,
        body: addBody(channel, 5),
      });
      await settle();

      expect(result.status).toBe(400);
      expect(errorOf(result)).toBe(MultiTenantQuery.WITH_PROJECT_MESSAGE);
      expect(projectWasRead()).toBe(false);
      expectNothingDone();
    });

    test("only in the row, asking across their own projects", async () => {
      const result: HttpResult = await post({
        path: channel.path,
        as: OUTSIDER,
        acrossProjects: true,
        body: addBody(channel, 6),
      });
      await settle();

      expect(result.status).toBe(400);
      expect(errorOf(result)).toBe(CreatePermission.PROJECT_REQUIRED_MESSAGE);
      expectNothingDone();
    });

    test("only in the row's project relation, with their own project in the header", async () => {
      const result: HttpResult = await post({
        path: channel.path,
        as: OUTSIDER,
        tenantHeader: OTHER_PROJECT_ID.toString(),
        body: addBody(channel, 7, {
          project: { _id: PROJECT_ID.toString() },
        }),
      });
      await settle();

      expect(result.status).toBe(400);
      expect(errorOf(result)).toBe(CreatePermission.PROJECT_MISMATCH_MESSAGE);
      expectNothingDone();
    });
  },
);

describe.each(CODE_CHANNELS)(
  "$name added by a member, the ways a member's request can go",
  (channel: CodeChannel) => {
    test("the tenantid header in upper case is the same project: added, and its code goes out on the project's account", async () => {
      const result: HttpResult = await post({
        path: channel.path,
        as: MEMBER,
        tenantHeader: PROJECT_ID.toString().toUpperCase(),
        body: addBody(channel, 11),
      });
      await settle();

      expect(result.status).toBe(200);

      const inserts: Array<StoredRow> = tables.get(channel.path)!.inserts;
      expect(inserts).toHaveLength(1);
      expect(String(inserts[0]!["projectId"]).toLowerCase()).toBe(
        PROJECT_ID.toString(),
      );
      expect(String(inserts[0]!["userId"]).toLowerCase()).toBe(
        MEMBER.toString(),
      );

      expect(sent).toHaveLength(1);
      expect(sent[0]!.channel).toBe(channel.sendChannel);
      expect(sent[0]!.to).toBe(channel.addressNumber(11));
      expect(String(sent[0]!.projectId).toLowerCase()).toBe(
        PROJECT_ID.toString(),
      );
    });

    /*
     * A change is made in one project at a time: a create that asks across
     * the caller's projects instead of naming one is asked for the project,
     * even when the row names a project they are in. The dashboard always
     * names it.
     */
    test("a request across their own projects that names none is asked for the project", async () => {
      const result: HttpResult = await post({
        path: channel.path,
        as: MEMBER,
        acrossProjects: true,
        body: addBody(channel, 12),
      });
      await settle();

      expect(result.status).toBe(400);
      expect(errorOf(result)).toBe(CreatePermission.PROJECT_REQUIRED_MESSAGE);
      expectNothingDone();
    });

    test("a row naming another project in its relation is refused, and that project is not described", async () => {
      const result: HttpResult = await post({
        path: channel.path,
        as: MEMBER,
        tenantHeader: PROJECT_ID.toString(),
        body: addBody(channel, 13, {
          project: { _id: OTHER_PROJECT_ID.toString() },
        }),
      });
      await settle();

      expect(result.status).toBe(400);
      expect(errorOf(result)).toBe(CreatePermission.PROJECT_MISMATCH_MESSAGE);
      expectNothingDone();
    });
  },
);

/*
 * A project that requires SSO for sign-in lets its members in only once
 * they have signed in with SSO. MEMBER is in it, but signed in with a
 * password: nothing of theirs is added to it until they sign in with SSO,
 * whether the request names the project or asks across their projects.
 */
describe.each(CODE_CHANNELS)(
  "$name added to a project that requires SSO, by a member who has not signed in with it",
  (channel: CodeChannel) => {
    test("naming the project in the tenantid header", async () => {
      const result: HttpResult = await post({
        path: channel.path,
        as: MEMBER,
        tenantHeader: SSO_PROJECT_ID.toString(),
        body: addBody(channel, 21, {
          projectId: SSO_PROJECT_ID.toString(),
        }),
      });
      await settle();

      expect(result.status).toBe(406);
      expectNothingDone();
    });

    test("asking across their own projects, with the project in the row", async () => {
      const result: HttpResult = await post({
        path: channel.path,
        as: MEMBER,
        acrossProjects: true,
        body: addBody(channel, 22, {
          projectId: SSO_PROJECT_ID.toString(),
        }),
      });
      await settle();

      expect(result.status).toBe(400);
      expect(errorOf(result)).toBe(CreatePermission.PROJECT_REQUIRED_MESSAGE);
      expectNothingDone();
    });

    // One project or across projects, never both (MultiTenantQuery).
    test("naming the project and asking across their own projects too is refused before the project is asked about", async () => {
      const result: HttpResult = await post({
        path: channel.path,
        as: MEMBER,
        tenantHeader: SSO_PROJECT_ID.toString(),
        acrossProjects: true,
        body: addBody(channel, 23, {
          projectId: SSO_PROJECT_ID.toString(),
        }),
      });
      await settle();

      expect(result.status).toBe(400);
      expect(errorOf(result)).toBe(MultiTenantQuery.WITH_PROJECT_MESSAGE);
      expectNothingDone();
    });

    test("while their own project that does not require SSO, named in the tenantid header, takes theirs (the control)", async () => {
      const result: HttpResult = await post({
        path: channel.path,
        as: MEMBER,
        tenantHeader: PROJECT_ID.toString(),
        body: addBody(channel, 24),
      });
      await settle();

      expect(result.status).toBe(200);
      expect(tables.get(channel.path)!.inserts).toHaveLength(1);
      expect(sent).toHaveLength(1);
      expect(String(sent[0]!.projectId).toLowerCase()).toBe(
        PROJECT_ID.toString(),
      );
    });
  },
);

describe.each(CODE_CHANNELS)(
  "$name added to a project a master admin blocked, by one of its members",
  (channel: CodeChannel) => {
    test("naming the project in the tenantid header", async () => {
      const result: HttpResult = await post({
        path: channel.path,
        as: MEMBER,
        tenantHeader: BLOCKED_PROJECT_ID.toString(),
        body: addBody(channel, 31, {
          projectId: BLOCKED_PROJECT_ID.toString(),
        }),
      });
      await settle();

      expect(result.status).toBe(403);
      expectNothingDone();
    });

    test("asking across their own projects, with the project in the row", async () => {
      const result: HttpResult = await post({
        path: channel.path,
        as: MEMBER,
        acrossProjects: true,
        body: addBody(channel, 32, {
          projectId: BLOCKED_PROJECT_ID.toString(),
        }),
      });
      await settle();

      expect(result.status).toBe(400);
      expect(errorOf(result)).toBe(CreatePermission.PROJECT_REQUIRED_MESSAGE);
      expectNothingDone();
    });
  },
);

/*
 * A project's API key names no person, so it owns no notification method:
 * whatever else it may do in the project, it adds none, and the add is
 * refused before any hook could read the project or send a code.
 */
describe.each(CODE_CHANNELS)(
  "$name added with the project's own API key",
  (channel: CodeChannel) => {
    test("is refused, and nothing is sent", async () => {
      const result: HttpResult = await post({
        path: channel.path,
        apiKey: API_KEY,
        tenantHeader: PROJECT_ID.toString(),
        body: addBody(channel, 41, {
          projectId: PROJECT_ID.toString(),
          userId: MEMBER.toString(),
        }),
      });
      await settle();

      expect(result.status).toBeGreaterThanOrEqual(400);
      expect(result.status).toBeLessThan(500);
      expectNothingDone();
    });
  },
);

/*
 * The rule is the same for a person's rows that send nothing: one of their
 * notification settings, here.
 */
describe("a notification setting added by a member who has not signed in with the SSO their project requires", () => {
  function settingBody(projectId: ObjectID): JSONObject {
    return {
      data: {
        projectId: projectId.toString(),
        userId: MEMBER.toString(),
        eventType:
          NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION,
        alertByEmail: true,
      },
    };
  }

  test("naming the project is refused by its sign-in rules", async () => {
    const result: HttpResult = await post({
      path: "/user-notification-setting",
      as: MEMBER,
      tenantHeader: SSO_PROJECT_ID.toString(),
      body: settingBody(SSO_PROJECT_ID),
    });
    await settle();

    expect(result.status).toBe(406);
    expectNothingDone();
  });

  test("asking across their own projects is asked for the project, and nothing is added", async () => {
    const result: HttpResult = await post({
      path: "/user-notification-setting",
      as: MEMBER,
      acrossProjects: true,
      body: settingBody(SSO_PROJECT_ID),
    });
    await settle();

    expect(result.status).toBe(400);
    expect(errorOf(result)).toBe(CreatePermission.PROJECT_REQUIRED_MESSAGE);
    expectNothingDone();
  });

  test("while in a project that does not require SSO, naming it, theirs is added (the control)", async () => {
    const result: HttpResult = await post({
      path: "/user-notification-setting",
      as: MEMBER,
      tenantHeader: PROJECT_ID.toString(),
      body: settingBody(PROJECT_ID),
    });
    await settle();

    expect(result.status).toBe(200);
    expect(settings.inserts).toHaveLength(1);
    expect(String(settings.inserts[0]!["projectId"]).toLowerCase()).toBe(
      PROJECT_ID.toString(),
    );
  });
});

/*
 * The routes that act on a row someone already has - a new code, a code
 * checked, where the code stands - take no project from the request, and
 * answer only the person whose row it is. A project's API key names no
 * person: it is refused before any row is read, and gets no code sent.
 */
describe("a code asked for with the project's own API key", () => {
  const ROW_ID: string = "7f000000-0000-4000-8000-000000000201";
  const CODE: string = "135790";

  let numbers: InMemoryTable;

  beforeEach(() => {
    numbers = useInMemoryTable(UserIncomingCallNumberService, [
      {
        _id: ROW_ID,
        projectId: PROJECT_ID.toString(),
        userId: MEMBER.toString(),
        phone: "+15551109999",
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

  test("a new code: refused before the row is read, and nothing is sent", async () => {
    const result: HttpResult = await post({
      path: "/user-incoming-call-number/resend-verification-code",
      apiKey: API_KEY,
      tenantHeader: PROJECT_ID.toString(),
      body: { itemId: ROW_ID },
    });

    expect(result.status).toBe(400);
    expect(errorOf(result)).toBe("Invalid user ID");
    expect(numbers.repository.find.mock.calls).toHaveLength(0);
    expect(sent).toEqual([]);
    expect(numbers.updates).toEqual([]);
  });

  test("checking the code: refused, and the row is not verified", async () => {
    const result: HttpResult = await post({
      path: "/user-incoming-call-number/verify",
      apiKey: API_KEY,
      tenantHeader: PROJECT_ID.toString(),
      body: { itemId: ROW_ID, code: CODE },
    });

    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.status).toBeLessThan(500);
    expect(numbers.get(ROW_ID)!["isVerified"]).toBe(false);
    expect(numbers.updates).toEqual([]);
  });

  test("where the code stands: refused before the row is read", async () => {
    const result: HttpResult = await post({
      path: "/user-incoming-call-number/verification-status",
      apiKey: API_KEY,
      tenantHeader: PROJECT_ID.toString(),
      body: { itemId: ROW_ID },
    });

    expect(result.status).toBe(400);
    expect(errorOf(result)).toBe("Invalid user ID");
    expect(numbers.repository.find.mock.calls).toHaveLength(0);
  });

  test("the row's own member still gets a new code (the control)", async () => {
    const result: HttpResult = await post({
      path: "/user-incoming-call-number/resend-verification-code",
      as: MEMBER,
      tenantHeader: PROJECT_ID.toString(),
      body: { itemId: ROW_ID },
    });

    expect(result.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("+15551109999");
    expect(sent[0]!.viaTwilioAccountSid).toBe(PROJECT_TWILIO_SID);
  });
});

/*
 * Telegram's two routes for a person's own unverified account - the code
 * to send the bot, and a new one - ask for a person first too, before the
 * row is read, and then that the row is theirs.
 */
describe("a Telegram account's code asked for by somebody other than its owner", () => {
  const ROW_ID: string = "7f000000-0000-4000-8000-000000000301";

  let accounts: InMemoryTable;
  let rotations: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    accounts = useInMemoryTable(UserTelegramService, [
      {
        _id: ROW_ID,
        projectId: PROJECT_ID.toString(),
        userId: MEMBER.toString(),
        isVerified: false,
        verificationCode: "123456",
      },
    ]);

    // The new code itself: what the route hands on to, once it may.
    rotations = jest
      .spyOn(UserTelegramService, "regenerateVerificationCode")
      .mockResolvedValue("654321" as never);
  });

  test.each([
    ["/user-telegram/verification-info"],
    ["/user-telegram/resend-verification-code"],
  ])(
    "%s with the project's API key: refused before the row is read",
    async (path: string) => {
      const result: HttpResult = await post({
        path: path,
        apiKey: API_KEY,
        tenantHeader: PROJECT_ID.toString(),
        body: { itemId: ROW_ID },
      });

      expect(result.status).toBe(400);
      expect(errorOf(result)).toBe("Invalid user ID");
      expect(accounts.repository.find.mock.calls).toHaveLength(0);
      expect(accounts.updates).toEqual([]);
      expect(rotations).not.toHaveBeenCalled();
    },
  );

  test.each([
    ["/user-telegram/verification-info"],
    ["/user-telegram/resend-verification-code"],
  ])(
    "%s by somebody else signed in: refused as not theirs",
    async (path: string) => {
      const result: HttpResult = await post({
        path: path,
        as: OUTSIDER,
        tenantHeader: OTHER_PROJECT_ID.toString(),
        body: { itemId: ROW_ID },
      });

      expect(result.status).toBe(400);
      expect(errorOf(result)).toBe("Invalid user ID");
      expect(accounts.updates).toEqual([]);
      expect(rotations).not.toHaveBeenCalled();
    },
  );

  test("its owner, a member, gets a new code (the control)", async () => {
    const result: HttpResult = await post({
      path: "/user-telegram/resend-verification-code",
      as: MEMBER,
      tenantHeader: PROJECT_ID.toString(),
      body: { itemId: ROW_ID },
    });

    expect(result.status).toBe(200);
    expect(rotations).toHaveBeenCalledTimes(1);
    expect(String(rotations.mock.calls[0]![0])).toBe(ROW_ID);
  });
});
