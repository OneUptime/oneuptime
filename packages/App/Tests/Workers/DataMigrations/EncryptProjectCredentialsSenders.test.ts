import ProjectSmtpConfig from "Common/Models/DatabaseModels/ProjectSmtpConfig";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import UserWebhook from "Common/Models/DatabaseModels/UserWebhook";
import WorkspaceProjectAuthToken from "Common/Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "Common/Models/DatabaseModels/WorkspaceUserAuthToken";
import CodeRepository from "Common/Models/DatabaseModels/CodeRepository";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import CodeRepositoryService from "Common/Server/Services/CodeRepositoryService";
import ProjectSmtpConfigService from "Common/Server/Services/ProjectSmtpConfigService";
import StatusPageService from "Common/Server/Services/StatusPageService";
import UserWebhookService from "Common/Server/Services/UserWebhookService";
import WebhookService from "Common/Server/Services/WebhookService";
import WorkspaceProjectAuthTokenService from "Common/Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "Common/Server/Services/WorkspaceUserAuthTokenService";
import Encryption from "Common/Server/Utils/Encryption";
import logger from "Common/Server/Utils/Logger";
import { PROJECT_SMTP_CONFIG_SEND_SELECT } from "Common/Server/Utils/Mail/ProjectSmtpConfigSelect";
import MattermostConnection, {
  MattermostConnectionData,
} from "Common/Server/Utils/Workspace/Mattermost/MattermostConnection";
import { StoredRow } from "Common/Tests/Server/TestingUtils/InMemoryRepository";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Email from "Common/Types/Email";
import EmailMessage from "Common/Types/Email/EmailMessage";
import EmailServer from "Common/Types/Email/EmailServer";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import Exception from "Common/Types/Exception/Exception";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import API from "Common/Utils/API";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";
import crypto from "crypto";
import fs from "fs";
import Handlebars from "handlebars";
import nodemailer, { Transporter } from "nodemailer";
import Path from "path";
import {
  GRAPH_CLIENT_ID,
  GRAPH_CLIENT_SECRET,
  GRAPH_CONFIG_ID,
  JWT_CLIENT_ID,
  MATTERMOST_ACCESS_TOKEN,
  MATTERMOST_AUTH_TOKEN,
  MATTERMOST_BOT_USER_ID,
  MATTERMOST_CONNECTION_ID,
  MATTERMOST_SERVER_URL,
  MATTERMOST_TEAM_ID,
  migrateProjectCredentials,
  PROJECT_ID,
  ProjectCredentialTables,
  REPOSITORY_ID,
  REPOSITORY_SECRET,
  SIGNING_SECRET,
  SLACK_BOT_TOKEN,
  SLACK_CONNECTION_ID,
  SLACK_USER_LINK_ID,
  SLACK_USER_TOKEN,
  SMTP_CLIENT_ID,
  SMTP_CLIENT_SECRET,
  SMTP_HOST,
  SMTP_JWT_CONFIG_ID,
  SMTP_OAUTH_CONFIG_ID,
  SMTP_PASSWORD,
  SMTP_PASSWORD_CONFIG_ID,
  SMTP_USERNAME,
  TEAMS_CONNECTION_ID,
  TEAMS_GRAPH_TOKEN,
  USER_ID,
  useProjectCredentialTables,
  WEBHOOK_ID,
  WEBHOOK_URL,
} from "./Fixtures/ProjectCredentialsAsWritten";

/*
 * EVERY USE OF A PROJECT'S CREDENTIALS SENDS WITH THEM AS WRITTEN, BEFORE
 * AND AFTER THE DATA MIGRATION ENCRYPTS THEM (#8989).
 *
 * A project's SMTP configs, its Slack, Microsoft Teams and Mattermost
 * connections, its members' chat account links, webhook notification
 * methods and code repositories are seeded as they were stored before
 * their credentials were kept encrypted, behind the real services. Each use
 * reads them as it does - through the service, a status page's through its
 * smtpConfig relation - and sends through the real Notification
 * MailService, MicrosoftGraphMailProvider and SMTPOAuthService, with only
 * what is outside OneUptime stood in for: the mail transports, the OAuth
 * token endpoint, Microsoft Graph and the Notification service's own API.
 *
 * Each sends once with the rows as written, then the real
 * EncryptProjectCredentials runs over the same rows, and it sends again:
 * with the same credentials, which are the ones written - never the
 * ciphertext stored. A credential saved afterwards is stored encrypted, and
 * no credential reaches a log line or an error, on a send that works or
 * one that fails.
 */

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    EXTERNAL_FAULT: {},
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      getLogLevel: jest.fn().mockReturnValue("INFO"),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

// The server's own mail settings, which a project's mail never goes through.
jest.mock("../../../FeatureSet/Notification/Config", () => {
  return {
    getEmailServerType: jest.fn(),
    getGlobalSMTPConfig: jest.fn(),
    getSendgridConfig: jest.fn(),
    getGlobalEmailProviderServer: jest.fn(),
  };
});

// A project's mail server resolves to a public address (MailService's egress check).
jest.mock("Common/Server/Utils/DataSource/EgressGuard", () => {
  return {
    __esModule: true,
    default: {
      assertHostnameAllowed: jest.fn(),
    },
  };
});

jest.mock("nodemailer", () => {
  return { __esModule: true, default: { createTransport: jest.fn() } };
});

import SMTPOAuthService from "../../../FeatureSet/Notification/Services/SMTPOAuthService";
import MailService from "../../../FeatureSet/Notification/Services/MailService";
import "../../../FeatureSet/Notification/Utils/Handlebars";

type SendMail = (mail: unknown) => Promise<{ messageId: string }>;

interface TokenRequest {
  tokenUrl: string;
  form: Record<string, string>;
}

type RequestToken = (
  tokenUrl: unknown,
  form: Record<string, string>,
) => Promise<{ statusCode: number; bodyText: string }>;

const OAUTH_ACCESS_TOKEN: string = "access-token-from-the-token-endpoint";

let tables: ProjectCredentialTables;
let sendMail: Mock<SendMail>;
let requestToken: Mock<RequestToken>;
let tokenRequests: Array<TokenRequest>;
let fetched: Array<{ url: string; headers: Record<string, string> }>;

// A Google service account's key pair, made for this run: none is kept.
const { privateKey: JWT_PRIVATE_KEY, publicKey: JWT_PUBLIC_KEY } =
  crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });

// Every credential the rows hold, as written.
const EVERY_CREDENTIAL: Array<string> = [
  SMTP_PASSWORD,
  SMTP_CLIENT_SECRET,
  GRAPH_CLIENT_SECRET,
  SLACK_BOT_TOKEN,
  TEAMS_GRAPH_TOKEN,
  MATTERMOST_ACCESS_TOKEN,
  SLACK_USER_TOKEN,
  SIGNING_SECRET,
  REPOSITORY_SECRET,
  JWT_PRIVATE_KEY,
];

function emailMessage(): EmailMessage {
  return {
    toEmail: new Email("alice@example.test"),
    subject: "Incident #12: Checkout API is down",
    isSubjectLiteral: true,
    templateType: EmailTemplateType.SimpleMessage,
    vars: { subject: "Incident #12", message: "Checkout API is down" },
    body: "",
  };
}

// The options each mail transport was made with.
function transportOptions(): Array<Record<string, unknown>> {
  return (
    jest.mocked(nodemailer.createTransport).mock.calls as Array<Array<unknown>>
  ).map((call: Array<unknown>): Record<string, unknown> => {
    return call[0] as Record<string, unknown>;
  });
}

// A config as every sender reads it: through the service, decrypted.
async function readConfig(id: string): Promise<ProjectSmtpConfig> {
  const config: ProjectSmtpConfig | null =
    await ProjectSmtpConfigService.findOneById({
      id: new ObjectID(id),
      select: PROJECT_SMTP_CONFIG_SEND_SELECT,
      props: { isRoot: true },
    });

  expect(config).not.toBeNull();

  return config!;
}

async function sendThrough(configId: string): Promise<void> {
  const emailServer: EmailServer | undefined =
    ProjectSmtpConfigService.toEmailServer(await readConfig(configId));

  await MailService.send(emailMessage(), { emailServer: emailServer });
}

// Every line logged, at any level, as one text.
function loggedText(): string {
  return JSON.stringify(
    (["debug", "info", "warn", "error"] as const).map(
      (level: "debug" | "info" | "warn" | "error") => {
        return (logger[level] as unknown as jest.Mock).mock.calls;
      },
    ),
    (_key: string, value: unknown): unknown => {
      return value instanceof Error
        ? { ...value, message: value.message, stack: value.stack }
        : value;
    },
  );
}

function expectNoCredentialIn(text: string): void {
  for (const credential of EVERY_CREDENTIAL) {
    // As a log line or an error would hold it: JSON-escaped.
    expect(text).not.toContain(JSON.stringify(credential).slice(1, -1));
  }
}

/*
 * Sends with the rows as written, runs the migration, and sends again:
 * what each send went out with, as `capture` reads it from the stand-ins.
 */
async function beforeAndAfter<T>(
  send: () => Promise<void>,
  capture: () => T,
): Promise<{ before: T; after: T }> {
  await send();
  const before: T = capture();

  sendMail.mockClear();
  requestToken.mockClear();
  jest.mocked(nodemailer.createTransport).mockClear();
  tokenRequests.length = 0;
  fetched.length = 0;
  await MailService.cleanup();

  await migrateProjectCredentials(tables);

  await send();
  const after: T = capture();

  return { before, after };
}

// Each value a table holds encrypted now, decrypting to the value written.
async function expectStoredEncrypted(
  row: StoredRow | undefined,
  column: string,
  written: string,
): Promise<void> {
  const stored: string = String(row?.[column]);

  expect([column, Encryption.looksEncrypted(stored)]).toEqual([column, true]);
  expect(stored).not.toContain(written);
  expect(await Encryption.decrypt(stored)).toBe(written);
}

beforeAll(async () => {
  // The email templates' partials, registered as the Notification service registers them.
  const partialsDir: string = Path.resolve(
    __dirname,
    "../../../FeatureSet/Notification/Templates/Partials",
  );
  const partialNames: Array<string> = fs
    .readdirSync(partialsDir)
    .filter((name: string): boolean => {
      return name.endsWith(".hbs");
    })
    .map((name: string): string => {
      return name.slice(0, -4);
    });
  const deadline: number = Date.now() + 15000;

  while (
    partialNames.some((name: string): boolean => {
      return typeof Handlebars.partials[name] !== "function";
    })
  ) {
    if (Date.now() >= deadline) {
      throw new Error("Email partial registration did not finish");
    }

    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 10);
    });
  }
});

beforeEach(() => {
  jest.clearAllMocks();

  tables = useProjectCredentialTables({ jwtPrivateKey: JWT_PRIVATE_KEY });

  sendMail = jest.fn<SendMail>();
  sendMail.mockResolvedValue({ messageId: "mail-1" });
  jest.mocked(nodemailer.createTransport).mockReturnValue({
    sendMail,
    close: jest.fn(),
  } as unknown as Transporter);

  // The OAuth token endpoint, as SMTPOAuthService asks it.
  tokenRequests = [];
  requestToken = jest.fn<RequestToken>();
  requestToken.mockImplementation(
    async (
      tokenUrl: unknown,
      form: Record<string, string>,
    ): Promise<{ statusCode: number; bodyText: string }> => {
      tokenRequests.push({ tokenUrl: String(tokenUrl), form: { ...form } });

      return {
        statusCode: 200,
        bodyText: JSON.stringify({
          access_token: OAUTH_ACCESS_TOKEN,
          expires_in: 3600,
          token_type: "Bearer",
        }),
      };
    },
  );
  jest
    .spyOn(
      SMTPOAuthService as unknown as { requestToken: RequestToken },
      "requestToken",
    )
    .mockImplementation(requestToken);

  // No token is cached: every send asks for one.
  jest.spyOn(GlobalCache, "getJSONObject").mockResolvedValue(null as never);
  jest.spyOn(GlobalCache, "setJSON").mockResolvedValue(undefined as never);

  // Microsoft Graph's sendMail.
  fetched = [];
  jest.spyOn(global, "fetch").mockImplementation((async (
    url: unknown,
    init?: { headers?: Record<string, string> },
  ): Promise<Response> => {
    fetched.push({ url: String(url), headers: { ...(init?.headers || {}) } });

    return new Response(null, { status: 202 });
  }) as never);

  // The Notification service's own API, which Common's senders post to.
  jest
    .spyOn(API, "post")
    .mockResolvedValue(new HTTPResponse<JSONObject>(200, {}, {}) as never);
});

afterEach(async () => {
  jest.restoreAllMocks();
  await MailService.cleanup();
});

describe("a project's own mail server", () => {
  test("signing in with a password: signed in with the password as written", async () => {
    const sent: {
      before: Array<Record<string, unknown>>;
      after: Array<Record<string, unknown>>;
    } = await beforeAndAfter(async (): Promise<void> => {
      await sendThrough(SMTP_PASSWORD_CONFIG_ID);
    }, transportOptions);

    expect(sent.before).toHaveLength(1);
    expect(sent.before[0]).toMatchObject({
      host: SMTP_HOST,
      auth: { user: SMTP_USERNAME, pass: SMTP_PASSWORD },
    });
    expect(sent.after).toHaveLength(1);
    expect(sent.after[0]).toMatchObject({
      host: SMTP_HOST,
      auth: { user: SMTP_USERNAME, pass: SMTP_PASSWORD },
    });
    expect(sendMail).toHaveBeenCalledTimes(1);

    await expectStoredEncrypted(
      tables.smtpConfigs.get(SMTP_PASSWORD_CONFIG_ID),
      "password",
      SMTP_PASSWORD,
    );
  });

  test("signing in with OAuth: the token asked for with the client secret as written", async () => {
    const asked: { before: Array<TokenRequest>; after: Array<TokenRequest> } =
      await beforeAndAfter(
        async (): Promise<void> => {
          await sendThrough(SMTP_OAUTH_CONFIG_ID);
        },
        (): Array<TokenRequest> => {
          return [...tokenRequests];
        },
      );

    for (const requests of [asked.before, asked.after]) {
      expect(requests).toHaveLength(1);
      expect(requests[0]!.form).toMatchObject({
        grant_type: "client_credentials",
        client_id: SMTP_CLIENT_ID,
        client_secret: SMTP_CLIENT_SECRET,
      });
    }

    expect(transportOptions()[0]).toMatchObject({
      auth: {
        type: "OAuth2",
        user: SMTP_USERNAME,
        accessToken: OAUTH_ACCESS_TOKEN,
      },
    });

    await expectStoredEncrypted(
      tables.smtpConfigs.get(SMTP_OAUTH_CONFIG_ID),
      "clientSecret",
      SMTP_CLIENT_SECRET,
    );
  });

  test("a Google service account: the token asked for with an assertion signed by the private key as written", async () => {
    const asked: { before: Array<TokenRequest>; after: Array<TokenRequest> } =
      await beforeAndAfter(
        async (): Promise<void> => {
          await sendThrough(SMTP_JWT_CONFIG_ID);
        },
        (): Array<TokenRequest> => {
          return [...tokenRequests];
        },
      );

    for (const requests of [asked.before, asked.after]) {
      expect(requests).toHaveLength(1);
      expect(requests[0]!.form["grant_type"]).toBe(
        "urn:ietf:params:oauth:grant-type:jwt-bearer",
      );

      // Signed with the key as written: its public half verifies it.
      const [header, payload, signature] = String(
        requests[0]!.form["assertion"],
      ).split(".");

      expect(
        crypto.verify(
          "RSA-SHA256",
          Buffer.from(`${header}.${payload}`),
          JWT_PUBLIC_KEY,
          Buffer.from(String(signature), "base64url"),
        ),
      ).toBe(true);
      expect(
        JSON.parse(Buffer.from(String(payload), "base64url").toString()),
      ).toMatchObject({ iss: JWT_CLIENT_ID, sub: SMTP_USERNAME });
    }

    await expectStoredEncrypted(
      tables.smtpConfigs.get(SMTP_JWT_CONFIG_ID),
      "clientSecret",
      JWT_PRIVATE_KEY,
    );
  });

  test("Microsoft Graph: the token asked for with the client secret as written, and the mail sent with it", async () => {
    const sent: {
      before: { tokens: Array<TokenRequest>; graph: typeof fetched };
      after: { tokens: Array<TokenRequest>; graph: typeof fetched };
    } = await beforeAndAfter(
      async (): Promise<void> => {
        await sendThrough(GRAPH_CONFIG_ID);
      },
      () => {
        return { tokens: [...tokenRequests], graph: [...fetched] };
      },
    );

    for (const side of [sent.before, sent.after]) {
      expect(side.tokens).toHaveLength(1);
      expect(side.tokens[0]!.form).toMatchObject({
        client_id: GRAPH_CLIENT_ID,
        client_secret: GRAPH_CLIENT_SECRET,
      });
      expect(side.graph).toHaveLength(1);
      expect(side.graph[0]!.url).toContain("graph.microsoft.com");
      expect(side.graph[0]!.headers["Authorization"]).toBe(
        `Bearer ${OAUTH_ACCESS_TOKEN}`,
      );
    }

    await expectStoredEncrypted(
      tables.smtpConfigs.get(GRAPH_CONFIG_ID),
      "clientSecret",
      GRAPH_CLIENT_SECRET,
    );
  });

  test("a status page's subscriber email: the page's config read through the smtpConfig relation, decrypted", async () => {
    const STATUS_PAGE_ID: string = "89890000-0000-4000-8000-000000000061";

    // The page, joined with its config as it is stored at the time of the read.
    jest.spyOn(StatusPageService, "getRepository").mockReturnValue({
      find: async (): Promise<Array<StatusPage>> => {
        const page: StatusPage = new StatusPage();
        page._id = STATUS_PAGE_ID;
        page.projectId = new ObjectID(PROJECT_ID);
        page.smtpConfig = Object.assign(new ProjectSmtpConfig(), {
          ...tables.smtpConfigs.get(SMTP_PASSWORD_CONFIG_ID),
        });

        return [page];
      },
    } as never);

    const sent: {
      before: Array<Record<string, unknown>>;
      after: Array<Record<string, unknown>>;
    } = await beforeAndAfter(async (): Promise<void> => {
      const page: StatusPage | null = await StatusPageService.findOneBy({
        query: { _id: STATUS_PAGE_ID },
        select: { _id: true, smtpConfig: PROJECT_SMTP_CONFIG_SEND_SELECT },
        props: { isRoot: true },
      });

      await MailService.send(emailMessage(), {
        emailServer: ProjectSmtpConfigService.toEmailServer(page!.smtpConfig),
      });
    }, transportOptions);

    expect(sent.before[0]).toMatchObject({
      auth: { user: SMTP_USERNAME, pass: SMTP_PASSWORD },
    });
    expect(sent.after[0]).toMatchObject({
      auth: { user: SMTP_USERNAME, pass: SMTP_PASSWORD },
    });
  });

  test("a password saved after the migration is stored encrypted, and is the one signed in with", async () => {
    await migrateProjectCredentials(tables);

    const NEW_PASSWORD: string = "a new password, set after the upgrade";

    await ProjectSmtpConfigService.updateOneById({
      id: new ObjectID(SMTP_PASSWORD_CONFIG_ID),
      data: { password: NEW_PASSWORD },
      props: { isRoot: true },
    });

    await expectStoredEncrypted(
      tables.smtpConfigs.get(SMTP_PASSWORD_CONFIG_ID),
      "password",
      NEW_PASSWORD,
    );

    await sendThrough(SMTP_PASSWORD_CONFIG_ID);

    expect(transportOptions()[0]).toMatchObject({
      auth: { user: SMTP_USERNAME, pass: NEW_PASSWORD },
    });
  });

  test("no credential reaches a log line on any of these sends", async () => {
    await beforeAndAfter(async (): Promise<void> => {
      for (const id of [
        SMTP_PASSWORD_CONFIG_ID,
        SMTP_OAUTH_CONFIG_ID,
        SMTP_JWT_CONFIG_ID,
        GRAPH_CONFIG_ID,
      ]) {
        await sendThrough(id);
      }
    }, transportOptions);

    expectNoCredentialIn(loggedText());
  });
});

describe("a send that fails says why, without the credential", () => {
  test("the mail server refuses the password: neither the error nor a log line holds it", async () => {
    await migrateProjectCredentials(tables);

    sendMail.mockRejectedValue(
      Object.assign(
        new Error("Invalid login: 535 5.7.8 Authentication credentials invalid"),
        { code: "EAUTH", responseCode: 535 },
      ),
    );

    let error: unknown = null;

    try {
      await sendThrough(SMTP_PASSWORD_CONFIG_ID);
    } catch (err) {
      error = err;
    }

    // It signed in with the password as written, and the server said no.
    expect(sendMail).toHaveBeenCalled();
    expect(transportOptions()[0]).toMatchObject({
      auth: { user: SMTP_USERNAME, pass: SMTP_PASSWORD },
    });
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("535");
    expectNoCredentialIn(
      JSON.stringify({
        message: (error as Error).message,
        error: error,
      }),
    );
    expectNoCredentialIn(loggedText());
  });

  test("the token endpoint refuses the client secret: neither the error nor a log line holds it", async () => {
    await migrateProjectCredentials(tables);

    requestToken.mockImplementation(
      async (
        tokenUrl: unknown,
        form: Record<string, string>,
      ): Promise<{ statusCode: number; bodyText: string }> => {
        tokenRequests.push({ tokenUrl: String(tokenUrl), form: { ...form } });

        return {
          statusCode: 401,
          bodyText: JSON.stringify({
            error: "invalid_client",
            error_description: "AADSTS7000215: Invalid client secret provided.",
          }),
        };
      },
    );

    let error: unknown = null;

    try {
      await sendThrough(SMTP_OAUTH_CONFIG_ID);
    } catch (err) {
      error = err;
    }

    // The secret as written went to the endpoint, which refused it.
    expect(tokenRequests[0]!.form["client_secret"]).toBe(SMTP_CLIENT_SECRET);
    expect(error).toBeInstanceOf(Exception);
    expect((error as Error).message).toContain("invalid_client");
    expectNoCredentialIn(
      JSON.stringify({ message: (error as Error).message, error: error }),
    );
    expectNoCredentialIn(loggedText());
  });
});

describe("a project's chat connections", () => {
  async function connection(
    workspaceType: WorkspaceType,
  ): Promise<WorkspaceProjectAuthToken> {
    const auth: WorkspaceProjectAuthToken | null =
      await WorkspaceProjectAuthTokenService.getProjectAuth({
        projectId: new ObjectID(PROJECT_ID),
        workspaceType: workspaceType,
      });

    expect(auth).not.toBeNull();

    return auth!;
  }

  test("Slack, Microsoft Teams and Mattermost: each sender's token reads as written, before and after", async () => {
    const read: () => Promise<Array<string | undefined>> = async (): Promise<
      Array<string | undefined>
    > => {
      return [
        (await connection(WorkspaceType.Slack)).authToken,
        (await connection(WorkspaceType.MicrosoftTeams)).authToken,
        (await connection(WorkspaceType.Mattermost)).authToken,
      ];
    };

    const before: Array<string | undefined> = await read();

    await migrateProjectCredentials(tables);

    const after: Array<string | undefined> = await read();

    expect(before).toEqual([
      SLACK_BOT_TOKEN,
      TEAMS_GRAPH_TOKEN,
      MATTERMOST_AUTH_TOKEN,
    ]);
    expect(after).toEqual(before);

    // Every connection of the project, as the workspace senders list them.
    const all: Array<WorkspaceProjectAuthToken> =
      await WorkspaceProjectAuthTokenService.getProjectAuths({
        projectId: new ObjectID(PROJECT_ID),
      });

    expect(
      all
        .map((auth: WorkspaceProjectAuthToken): string => {
          return String(auth.authToken);
        })
        .sort(),
    ).toEqual(
      [SLACK_BOT_TOKEN, TEAMS_GRAPH_TOKEN, MATTERMOST_AUTH_TOKEN].sort(),
    );

    await expectStoredEncrypted(
      tables.projectAuthTokens.get(SLACK_CONNECTION_ID),
      "authToken",
      SLACK_BOT_TOKEN,
    );
    await expectStoredEncrypted(
      tables.projectAuthTokens.get(TEAMS_CONNECTION_ID),
      "authToken",
      TEAMS_GRAPH_TOKEN,
    );
    await expectStoredEncrypted(
      tables.projectAuthTokens.get(MATTERMOST_CONNECTION_ID),
      "authToken",
      MATTERMOST_AUTH_TOKEN,
    );
  });

  test("Mattermost: the connection posts with the bot's access token as written, on its server", async () => {
    await migrateProjectCredentials(tables);

    const connectionData: MattermostConnectionData =
      MattermostConnection.fromAuthToken(
        String((await connection(WorkspaceType.Mattermost)).authToken),
      );

    expect(connectionData).toEqual({
      serverUrl: MATTERMOST_SERVER_URL,
      accessToken: MATTERMOST_ACCESS_TOKEN,
      teamId: MATTERMOST_TEAM_ID,
      botUserId: MATTERMOST_BOT_USER_ID,
    });
  });

  test("a token the connect flow writes after the migration is stored encrypted, and read as written", async () => {
    await migrateProjectCredentials(tables);

    const NEW_SLACK_TOKEN: string = "xoxb-0000000005-0000000006-reconnected";

    await WorkspaceProjectAuthTokenService.saveRefreshedAuthToken({
      projectId: new ObjectID(PROJECT_ID),
      workspaceType: WorkspaceType.Slack,
      workspaceProjectId: "T0000000001",
      authToken: NEW_SLACK_TOKEN,
      authTokenExpiresAt: new Date("2030-01-01T00:00:00.000Z"),
    });

    await expectStoredEncrypted(
      tables.projectAuthTokens.get(SLACK_CONNECTION_ID),
      "authToken",
      NEW_SLACK_TOKEN,
    );
    expect((await connection(WorkspaceType.Slack)).authToken).toBe(
      NEW_SLACK_TOKEN,
    );
  });

  test("Mattermost's default team, changed after the migration: the token rewritten encrypted, with the same access token", async () => {
    await migrateProjectCredentials(tables);

    const OTHER_TEAM_ID: string = "bbbbbbbbbbbbbbbbbbbbbbbbbb";

    await WorkspaceProjectAuthTokenService.updateMattermostTeams({
      projectId: new ObjectID(PROJECT_ID),
      workspaceProjectId: MATTERMOST_TEAM_ID,
      defaultTeam: {
        id: OTHER_TEAM_ID,
        name: "other",
        displayName: "Other",
      },
    });

    const stored: string = String(
      tables.projectAuthTokens.get(MATTERMOST_CONNECTION_ID)?.["authToken"],
    );

    expect(Encryption.looksEncrypted(stored)).toBe(true);
    expect(
      MattermostConnection.fromAuthToken(
        String((await connection(WorkspaceType.Mattermost)).authToken),
      ),
    ).toEqual({
      serverUrl: MATTERMOST_SERVER_URL,
      accessToken: MATTERMOST_ACCESS_TOKEN,
      teamId: OTHER_TEAM_ID,
      botUserId: MATTERMOST_BOT_USER_ID,
    });
  });

  test("a member's Slack sign-in token reads as written, before and after", async () => {
    const read: () => Promise<string | undefined> = async (): Promise<
      string | undefined
    > => {
      const link: WorkspaceUserAuthToken | null =
        await WorkspaceUserAuthTokenService.getUserAuth({
          projectId: new ObjectID(PROJECT_ID),
          userId: new ObjectID(USER_ID),
          workspaceType: WorkspaceType.Slack,
        });

      return link?.authToken;
    };

    expect(await read()).toBe(SLACK_USER_TOKEN);

    await migrateProjectCredentials(tables);

    expect(await read()).toBe(SLACK_USER_TOKEN);

    await expectStoredEncrypted(
      tables.userAuthTokens.get(SLACK_USER_LINK_ID),
      "authToken",
      SLACK_USER_TOKEN,
    );
  });
});

describe("a member's webhook notification method", () => {
  test("is signed with the secret as written, before and after", async () => {
    const send: () => Promise<void> = async (): Promise<void> => {
      const webhook: UserWebhook | null = await UserWebhookService.findOneById(
        {
          id: new ObjectID(WEBHOOK_ID),
          select: { webhookUrl: true, secret: true },
          props: { isRoot: true },
        },
      );

      await WebhookService.sendWebhook({
        url: webhook!.webhookUrl!,
        eventType: "test",
        payload: { message: "Checkout API is down" },
        secret: webhook!.secret || undefined,
      });
    };

    const sent: { before: Array<JSONObject>; after: Array<JSONObject> } =
      await beforeAndAfter(send, (): Array<JSONObject> => {
        return (jest.mocked(API.post).mock.calls as Array<Array<unknown>>).map(
          (call: Array<unknown>): JSONObject => {
            return (call[0] as { data: JSONObject }).data;
          },
        );
      });

    for (const side of [sent.before, sent.after]) {
      expect(side[side.length - 1]).toMatchObject({
        url: WEBHOOK_URL,
        secret: SIGNING_SECRET,
      });
    }

    await expectStoredEncrypted(
      tables.webhooks.get(WEBHOOK_ID),
      "secret",
      SIGNING_SECRET,
    );
  });
});

describe("a code repository's webhook secret", () => {
  test("reads as written, before and after", async () => {
    const read: () => Promise<string | undefined> = async (): Promise<
      string | undefined
    > => {
      const repository: CodeRepository | null =
        await CodeRepositoryService.findOneById({
          id: new ObjectID(REPOSITORY_ID),
          select: { secretToken: true },
          props: { isRoot: true },
        });

      return repository?.secretToken;
    };

    expect(await read()).toBe(REPOSITORY_SECRET);

    await migrateProjectCredentials(tables);

    expect(await read()).toBe(REPOSITORY_SECRET);

    await expectStoredEncrypted(
      tables.repositories.get(REPOSITORY_ID),
      "secretToken",
      REPOSITORY_SECRET,
    );
  });
});
