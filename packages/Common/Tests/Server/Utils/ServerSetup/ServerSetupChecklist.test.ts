import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";

/*
 * THE SERVER'S SETUP CHECKLIST, READ FROM WHAT THE SERVER IS (#6824).
 *
 * ServerSetupChecklist reads every fact the checks need - the settings row
 * (email, SMS and calls as #6825's ServerSendingStatus words them, the
 * sign-up switch, the update check, the admins' choices), the global
 * probes, the last backup, the global LLM providers, single sign-on, and the
 * server's own settings (HTTP_PROTOCOL, DISABLE_UPDATE_CHECK, VAPID keys) -
 * and answers the checklist from them. A read that fails costs one check,
 * never the page. Choices and hides are written as OneUptime, with who made
 * them. Every read and write is stood in for here.
 */

// A stood-in service method, as @jest/globals' jest.fn() types it.
type ServiceMethod = Mock<(...args: Array<unknown>) => unknown>;

let storedConfig: Record<string, unknown> | null = null;
const findOneById: ServiceMethod = jest.fn();
const writeServerSetupChoices: ServiceMethod = jest.fn();
const probeCountBy: ServiceMethod = jest.fn();
const backupFindOneBy: ServiceMethod = jest.fn();
const llmCountBy: ServiceMethod = jest.fn();
const ssoCountBy: ServiceMethod = jest.fn();
const oidcCountBy: ServiceMethod = jest.fn();
const userFindBy: ServiceMethod = jest.fn();
let isEnterprise: boolean = false;

const mockEnv: {
  httpProtocol: string;
  disableUpdateCheck: boolean;
  vapidPublic: string | undefined;
  vapidPrivate: string | undefined;
} = {
  httpProtocol: "http",
  disableUpdateCheck: false,
  vapidPublic: undefined,
  vapidPrivate: undefined,
};

jest.mock("../../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  const protocol: { default: Record<string, unknown> } = jest.requireActual(
    "../../../../Types/API/Protocol",
  ) as { default: Record<string, unknown> };
  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "HttpProtocol", {
    get: (): unknown => {
      return mockEnv.httpProtocol === "https"
        ? protocol.default["HTTPS"]
        : protocol.default["HTTP"];
    },
  });
  Object.defineProperty(mocked, "DisableUpdateCheck", {
    get: (): boolean => {
      return mockEnv.disableUpdateCheck;
    },
  });
  Object.defineProperty(mocked, "VapidPublicKey", {
    get: (): string | undefined => {
      return mockEnv.vapidPublic;
    },
  });
  Object.defineProperty(mocked, "VapidPrivateKey", {
    get: (): string | undefined => {
      return mockEnv.vapidPrivate;
    },
  });

  return mocked;
});

const service: (calls: Record<string, ServiceMethod>) => unknown = (
  calls: Record<string, ServiceMethod>,
): unknown => {
  const methods: Record<string, unknown> = {};

  for (const [name, mock] of Object.entries(calls)) {
    methods[name] = (...args: Array<unknown>): unknown => {
      return mock(...args);
    };
  }

  return { __esModule: true, default: methods };
};

jest.mock("../../../../Server/Services/GlobalConfigService", () => {
  return service({ findOneById, writeServerSetupChoices });
});
jest.mock("../../../../Server/Services/ProbeService", () => {
  return service({ countBy: probeCountBy });
});
jest.mock("../../../../Server/Services/BackupRunService", () => {
  return service({ findOneBy: backupFindOneBy });
});
jest.mock("../../../../Server/Services/LlmProviderService", () => {
  return service({ countBy: llmCountBy });
});
jest.mock("../../../../Server/Services/GlobalSsoService", () => {
  return service({ countBy: ssoCountBy });
});
jest.mock("../../../../Server/Services/GlobalOidcService", () => {
  return service({ countBy: oidcCountBy });
});
jest.mock("../../../../Server/Services/UserService", () => {
  return service({ findBy: userFindBy });
});
jest.mock("../../../../Server/Enterprise/EnterpriseEdition", () => {
  return {
    __esModule: true,
    default: {
      isLoaded: (): boolean => {
        return isEnterprise;
      },
    },
  };
});
jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

import ServerSetupChecklist, {
  getCallAndSmsSentThrough,
  getEmailSentThrough,
  SERVER_SETUP_CONFIG_SELECT,
} from "../../../../Server/Utils/ServerSetup/ServerSetupChecklist";
import { SERVER_CHANNEL_SETUP_SELECT } from "../../../../Server/Utils/ServerSending/ServerChannelSetup";
import GlobalConfig, {
  EmailServerType,
} from "../../../../Models/DatabaseModels/GlobalConfig";
import User from "../../../../Models/DatabaseModels/User";
import { BackupRunStatus } from "../../../../Types/Backup/BackupRunTypes";
import { CallAndSmsProvider } from "../../../../Types/CallAndSMS/CallAndSmsProvider";
import MailTransportType from "../../../../Types/Email/MailTransportType";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { ServerSendingChannel } from "../../../../Types/ServerSending/ServerSendingStatus";
import ServerSetupChecklistUtil, {
  ServerSetupCheckId,
  ServerSetupCheckResult,
  ServerSetupChecklistAnswer,
  ServerSetupChoiceKind,
  ServerSetupChoices,
  ServerSetupFacts,
  ServerSetupStatus,
} from "../../../../Types/ServerSetup/ServerSetupChecklist";

const ADA: string = "a1a1a1a1-0000-4000-8000-000000000001";
const GRACE: string = "b2b2b2b2-0000-4000-8000-000000000002";
const EARLIER: string = "2026-11-10T09:30:00.000Z";

const SMTP: Record<string, unknown> = {
  emailServerType: EmailServerType.CustomSMTP,
  smtpHost: "smtp.example.com",
  smtpPort: 587,
  smtpUsername: "ops@example.com",
  smtpPassword: "secret",
  smtpFromEmail: "ops@example.com",
  smtpFromName: "OneUptime",
};

const TWILIO: Record<string, unknown> = {
  twilioAccountSID: "AC123",
  twilioAuthToken: "secret",
  twilioPrimaryPhoneNumber: "+14155550100",
};

function row(values: Record<string, unknown> = {}): GlobalConfig {
  return Object.assign(new GlobalConfig(), values);
}

function count(value: number): Promise<PositiveNumber> {
  return Promise.resolve(new PositiveNumber(value));
}

function find(
  answer: ServerSetupChecklistAnswer,
  id: ServerSetupCheckId,
): ServerSetupCheckResult {
  return ServerSetupChecklistUtil.getCheck(answer, id)!;
}

beforeEach(() => {
  storedConfig = null;
  isEnterprise = false;
  mockEnv.httpProtocol = "http";
  mockEnv.disableUpdateCheck = false;
  mockEnv.vapidPublic = undefined;
  mockEnv.vapidPrivate = undefined;

  findOneById.mockReset();
  findOneById.mockImplementation(async () => {
    return storedConfig ? row(storedConfig) : null;
  });
  writeServerSetupChoices.mockReset();
  writeServerSetupChoices.mockImplementation(async () => {});
  probeCountBy.mockReset();
  probeCountBy.mockImplementation(() => {
    return count(0);
  });
  backupFindOneBy.mockReset();
  backupFindOneBy.mockImplementation(async () => {
    return null;
  });
  llmCountBy.mockReset();
  llmCountBy.mockImplementation(() => {
    return count(0);
  });
  ssoCountBy.mockReset();
  ssoCountBy.mockImplementation(() => {
    return count(0);
  });
  oidcCountBy.mockReset();
  oidcCountBy.mockImplementation(() => {
    return count(0);
  });
  userFindBy.mockReset();
  userFindBy.mockImplementation(async () => {
    return [];
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what it reads", () => {
  test("the settings row as OneUptime, with every column the channels and checks need, and the choices", async () => {
    storedConfig = {};

    await ServerSetupChecklist.getAnswer();

    const call: { select: Record<string, unknown>; props: unknown } =
      findOneById.mock.calls[0]![0] as {
        select: Record<string, unknown>;
        props: unknown;
      };

    expect(call.props).toEqual({ isRoot: true });
    expect(call.select).toEqual(SERVER_SETUP_CONFIG_SELECT);

    for (const column of Object.keys(SERVER_CHANNEL_SETUP_SELECT)) {
      expect(call.select[column]).toBe(true);
    }

    for (const column of [
      "serverSendingHealth",
      "disableSignup",
      "latestReleaseCheckedAt",
      "updateCheckLastFailure",
      "serverSetupChoices",
    ]) {
      expect(call.select[column]).toBe(true);
    }
  });

  test("a fresh server: every required check open", async () => {
    storedConfig = {};

    const answer: ServerSetupChecklistAnswer =
      await ServerSetupChecklist.getAnswer();

    expect(answer.openRequired).toEqual([
      ServerSetupCheckId.Email,
      ServerSetupCheckId.Https,
      ServerSetupCheckId.Signups,
    ]);
    expect(find(answer, ServerSetupCheckId.Email).reason).toBe(
      "Nothing is set up under Settings > Emails yet.",
    );
  });

  test("a finished server: email and Twilio have worked, HTTPS, sign-ups off, a probe, a backup, VAPID, AI, SSO", async () => {
    mockEnv.httpProtocol = "https";
    mockEnv.vapidPublic = "public";
    mockEnv.vapidPrivate = "private";
    isEnterprise = true;
    storedConfig = {
      ...SMTP,
      ...TWILIO,
      disableSignup: true,
      latestReleaseCheckedAt: new Date(EARLIER),
      serverSendingHealth: {
        email: { lastSucceededAt: EARLIER },
        sms: { lastSucceededAt: EARLIER },
        call: { lastSucceededAt: EARLIER },
      },
    };
    probeCountBy.mockImplementation(() => {
      return count(1);
    });
    backupFindOneBy.mockImplementation(async () => {
      return {
        status: BackupRunStatus.Succeeded,
        finishedAt: new Date(EARLIER),
        error: null,
      };
    });
    llmCountBy.mockImplementation(() => {
      return count(1);
    });
    oidcCountBy.mockImplementation(() => {
      return count(1);
    });

    const answer: ServerSetupChecklistAnswer =
      await ServerSetupChecklist.getAnswer();

    expect(answer.openRequired).toEqual([]);
    expect(
      answer.checks.map((check: ServerSetupCheckResult) => {
        return [check.id, check.status];
      }),
    ).toEqual([
      [ServerSetupCheckId.Email, ServerSetupStatus.Done],
      [ServerSetupCheckId.Https, ServerSetupStatus.Done],
      [ServerSetupCheckId.Signups, ServerSetupStatus.Done],
      [ServerSetupCheckId.SmsAndCalls, ServerSetupStatus.Done],
      [ServerSetupCheckId.Probes, ServerSetupStatus.Done],
      [ServerSetupCheckId.Backups, ServerSetupStatus.Done],
      [ServerSetupCheckId.UpdateChecks, ServerSetupStatus.Done],
      [ServerSetupCheckId.BrowserPush, ServerSetupStatus.Done],
      [ServerSetupCheckId.AiProvider, ServerSetupStatus.Done],
      [ServerSetupCheckId.SingleSignOn, ServerSetupStatus.Done],
    ]);
    expect(find(answer, ServerSetupCheckId.Email)).toMatchObject({
      sentThrough: "smtp.example.com",
      time: EARLIER,
    });
    expect(find(answer, ServerSetupCheckId.Backups)).toMatchObject({
      time: EARLIER,
      hasScheduledBackups: true,
    });
    expect(find(answer, ServerSetupCheckId.UpdateChecks).time).toBe(EARLIER);
  });

  test("email set up but nothing sent since it was saved is untested, not done", async () => {
    storedConfig = { ...SMTP };

    const answer: ServerSetupChecklistAnswer =
      await ServerSetupChecklist.getAnswer();

    expect(find(answer, ServerSetupCheckId.Email).status).toBe(
      ServerSetupStatus.Untested,
    );
    expect(answer.openRequired).toContain(ServerSetupCheckId.Email);
  });

  test("email failing says since when and what the mail server said", async () => {
    storedConfig = {
      ...SMTP,
      serverSendingHealth: {
        email: {
          lastSucceededAt: null,
          lastFailedAt: EARLIER,
          failingSince: EARLIER,
          lastFailure: "535 5.7.8 Authentication failed",
        },
      },
    };

    const email: ServerSetupCheckResult = find(
      await ServerSetupChecklist.getAnswer(),
      ServerSetupCheckId.Email,
    );

    expect(email).toMatchObject({
      status: ServerSetupStatus.Failing,
      time: EARLIER,
      reason: "535 5.7.8 Authentication failed",
      sentThrough: "smtp.example.com",
    });
  });

  test("probes: only the server's global probes, and connected ones for reporting", async () => {
    storedConfig = {};
    probeCountBy.mockImplementation((data: unknown) => {
      const query: Record<string, unknown> = (
        data as { query: Record<string, unknown> }
      ).query;

      return count(query["connectionStatus"] ? 0 : 2);
    });

    const probes: ServerSetupCheckResult = find(
      await ServerSetupChecklist.getAnswer(),
      ServerSetupCheckId.Probes,
    );

    expect(probes.status).toBe(ServerSetupStatus.NotSetUp);
    for (const call of probeCountBy.mock.calls) {
      expect(
        (call[0] as { query: Record<string, unknown> }).query,
      ).toMatchObject({ isGlobalProbe: true });
    }
  });

  test("backups: the latest finished backup run, newest first, as OneUptime", async () => {
    storedConfig = {};
    backupFindOneBy.mockImplementation(async () => {
      return {
        status: BackupRunStatus.Failed,
        finishedAt: new Date(EARLIER),
        error: "The bucket refused the upload.",
      };
    });

    const backups: ServerSetupCheckResult = find(
      await ServerSetupChecklist.getAnswer(),
      ServerSetupCheckId.Backups,
    );

    expect(backups).toMatchObject({
      status: ServerSetupStatus.Failing,
      reason: "The bucket refused the upload.",
      time: EARLIER,
    });

    const call: Record<string, unknown> = backupFindOneBy.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(call["props"]).toEqual({ isRoot: true });
    expect(call["sort"]).toEqual({ createdAt: "DESC" });
    expect((call["query"] as Record<string, unknown>)["kind"]).toBe("backup");
  });

  test("update checks: off when DISABLE_UPDATE_CHECK, failing when the last attempt failed", async () => {
    storedConfig = { updateCheckLastFailure: "unreachable" };

    expect(
      find(
        await ServerSetupChecklist.getAnswer(),
        ServerSetupCheckId.UpdateChecks,
      ).status,
    ).toBe(ServerSetupStatus.Failing);

    mockEnv.disableUpdateCheck = true;

    expect(
      find(
        await ServerSetupChecklist.getAnswer(),
        ServerSetupCheckId.UpdateChecks,
      ).status,
    ).toBe(ServerSetupStatus.NotSetUp);
  });

  test("browser push needs both VAPID keys", async () => {
    storedConfig = {};
    mockEnv.vapidPublic = "public";

    expect(
      find(
        await ServerSetupChecklist.getAnswer(),
        ServerSetupCheckId.BrowserPush,
      ).status,
    ).toBe(ServerSetupStatus.NotSetUp);

    mockEnv.vapidPrivate = "private";

    expect(
      find(
        await ServerSetupChecklist.getAnswer(),
        ServerSetupCheckId.BrowserPush,
      ).status,
    ).toBe(ServerSetupStatus.Done);
  });

  test("an LLM provider is a global one; single sign-on an enabled global SSO or OIDC provider", async () => {
    storedConfig = {};

    await ServerSetupChecklist.getAnswer();

    expect((llmCountBy.mock.calls[0]![0] as { query: unknown }).query).toEqual({
      isGlobalLlm: true,
    });
    expect((ssoCountBy.mock.calls[0]![0] as { query: unknown }).query).toEqual({
      isEnabled: true,
    });
    expect((oidcCountBy.mock.calls[0]![0] as { query: unknown }).query).toEqual(
      { isEnabled: true },
    );

    ssoCountBy.mockImplementation(() => {
      return count(1);
    });

    expect(
      find(
        await ServerSetupChecklist.getAnswer(),
        ServerSetupCheckId.SingleSignOn,
      ).status,
    ).toBe(ServerSetupStatus.Done);
  });

  test("a read that fails costs its check, never the checklist", async () => {
    storedConfig = { ...SMTP };
    probeCountBy.mockImplementation(async () => {
      throw new Error("probes down");
    });
    backupFindOneBy.mockImplementation(async () => {
      throw new Error("no table");
    });
    llmCountBy.mockImplementation(async () => {
      throw new Error("down");
    });
    ssoCountBy.mockImplementation(async () => {
      throw new Error("down");
    });

    const answer: ServerSetupChecklistAnswer =
      await ServerSetupChecklist.getAnswer();

    expect(answer.checks).toHaveLength(10);
    expect(find(answer, ServerSetupCheckId.Email).status).toBe(
      ServerSetupStatus.Untested,
    );
    expect(find(answer, ServerSetupCheckId.Probes).status).toBe(
      ServerSetupStatus.NotSetUp,
    );
    expect(find(answer, ServerSetupCheckId.AiProvider).status).toBe(
      ServerSetupStatus.NotSetUp,
    );
  });
});

describe("what took each channel", () => {
  test("email: the mail server's host, or the provider by name - never a key or a username", () => {
    expect(getEmailSentThrough(null)).toBeNull();
    expect(getEmailSentThrough({})).toBeNull();
    expect(getEmailSentThrough(row(SMTP))).toBe("smtp.example.com");
    expect(
      getEmailSentThrough(row({ ...SMTP, smtpHost: "  smtp.example.com " })),
    ).toBe("smtp.example.com");
    expect(
      getEmailSentThrough(
        row({ smtpTransportType: MailTransportType.MicrosoftGraph }),
      ),
    ).toBe("Microsoft Graph");
    expect(
      getEmailSentThrough(
        row({
          emailServerType: EmailServerType.AmazonSES,
          amazonSesRegion: "US-EAST-1",
        }),
      ),
    ).toBe("Amazon SES (us-east-1)");
    expect(
      getEmailSentThrough(row({ emailServerType: EmailServerType.AmazonSES })),
    ).toBe("Amazon SES");

    for (const [type, name] of [
      [EmailServerType.Sendgrid, "SendGrid"],
      [EmailServerType.Mailgun, "Mailgun"],
      [EmailServerType.Postmark, "Postmark"],
      [EmailServerType.Resend, "Resend"],
    ] as Array<[EmailServerType, string]>) {
      expect(
        getEmailSentThrough(
          row({ emailServerType: type, sendgridApiKey: "SG.secret" }),
        ),
      ).toBe(name);
    }
  });

  test("SMS and calls: the gateway's host name, never its path or secret; Twilio otherwise", () => {
    expect(getCallAndSmsSentThrough(null)).toBe("Twilio");
    expect(getCallAndSmsSentThrough(row(TWILIO))).toBe("Twilio");
    expect(
      getCallAndSmsSentThrough(
        row({
          callAndSmsProvider: CallAndSmsProvider.Gateway,
          callAndSmsGatewayUrl: "https://sms.example.com/send?token=secret",
          callAndSmsGatewaySecret: "secret",
        }),
      ),
    ).toBe("sms.example.com");
  });
});

describe("who chose", () => {
  test("a choice shown is named by who made it, read as OneUptime", async () => {
    storedConfig = {
      serverSetupChoices: {
        choices: {
          [ServerSetupCheckId.SmsAndCalls]: {
            kind: ServerSetupChoiceKind.Skipped,
            at: EARLIER,
            byUserId: ADA,
          },
        },
        hiddenBy: {},
      },
    };
    userFindBy.mockImplementation(async () => {
      return [
        Object.assign(new User(), {
          _id: ADA,
          name: new Name("Ada Lovelace"),
        }),
      ];
    });

    const sms: ServerSetupCheckResult = find(
      await ServerSetupChecklist.getAnswer(),
      ServerSetupCheckId.SmsAndCalls,
    );

    expect(sms.status).toBe(ServerSetupStatus.Skipped);
    expect(sms.choice).toMatchObject({ byUserId: ADA, byName: "Ada Lovelace" });
    expect((userFindBy.mock.calls[0]![0] as { props: unknown }).props).toEqual({
      isRoot: true,
    });
  });

  test("no choice shown, nobody is looked up; a failed lookup leaves the name out", async () => {
    storedConfig = {};

    await ServerSetupChecklist.getAnswer();

    expect(userFindBy).not.toHaveBeenCalled();

    storedConfig = {
      serverSetupChoices: {
        choices: {
          [ServerSetupCheckId.Backups]: {
            kind: ServerSetupChoiceKind.Confirmed,
            at: EARLIER,
            byUserId: ADA,
          },
        },
      },
    };
    userFindBy.mockImplementation(async () => {
      throw new Error("down");
    });

    const backups: ServerSetupCheckResult = find(
      await ServerSetupChecklist.getAnswer(),
      ServerSetupCheckId.Backups,
    );

    expect(backups.status).toBe(ServerSetupStatus.Confirmed);
    expect(backups.choice?.byName).toBeUndefined();
  });
});

describe("making a choice, and hiding the card", () => {
  test("a choice is written with who made it and when, keeping the others", async () => {
    storedConfig = {
      serverSetupChoices: {
        choices: {
          [ServerSetupCheckId.Probes]: {
            kind: ServerSetupChoiceKind.Skipped,
            at: EARLIER,
            byUserId: GRACE,
          },
        },
        hiddenBy: { [GRACE]: { at: EARLIER, openRequired: [] } },
      },
    };

    await ServerSetupChecklist.choose({
      check: ServerSetupCheckId.SmsAndCalls,
      kind: ServerSetupChoiceKind.Skipped,
      byUserId: new ObjectID(ADA),
    });

    const written: ServerSetupChoices = ServerSetupChecklistUtil.readChoices(
      writeServerSetupChoices.mock.calls[0]![0],
    );

    expect(written.choices[ServerSetupCheckId.SmsAndCalls]).toMatchObject({
      kind: ServerSetupChoiceKind.Skipped,
      byUserId: ADA,
    });
    expect(written.choices[ServerSetupCheckId.Probes]?.byUserId).toBe(GRACE);
    expect(written.hiddenBy[GRACE]).toBeDefined();
  });

  test("undone with null; a choice the check does not allow is refused and nothing written", async () => {
    storedConfig = {
      serverSetupChoices: {
        choices: {
          [ServerSetupCheckId.Backups]: {
            kind: ServerSetupChoiceKind.Confirmed,
            at: EARLIER,
            byUserId: ADA,
          },
        },
      },
    };

    await ServerSetupChecklist.choose({
      check: ServerSetupCheckId.Backups,
      kind: null,
      byUserId: new ObjectID(ADA),
    });

    expect(
      ServerSetupChecklistUtil.readChoices(
        writeServerSetupChoices.mock.calls[0]![0],
      ).choices,
    ).toEqual({});

    writeServerSetupChoices.mockClear();

    await expect(
      ServerSetupChecklist.choose({
        check: ServerSetupCheckId.Email,
        kind: ServerSetupChoiceKind.Skipped,
        byUserId: new ObjectID(ADA),
      }),
    ).rejects.toThrow();
    expect(writeServerSetupChoices).not.toHaveBeenCalled();
  });

  test("hiding keeps the required checks open now, for that admin only", async () => {
    storedConfig = { ...SMTP, disableSignup: true };

    await ServerSetupChecklist.hideFor(new ObjectID(ADA));

    const written: ServerSetupChoices = ServerSetupChecklistUtil.readChoices(
      writeServerSetupChoices.mock.calls[0]![0],
    );

    expect(Object.keys(written.hiddenBy)).toEqual([ADA]);
    expect(written.hiddenBy[ADA]?.openRequired).toEqual([
      ServerSetupCheckId.Email,
      ServerSetupCheckId.Https,
    ]);

    // Read back, it is hidden for Ada - and only for her.
    storedConfig = {
      ...storedConfig,
      serverSetupChoices: writeServerSetupChoices.mock.calls[0]![0],
    };

    expect(
      (
        await ServerSetupChecklist.getAnswer({
          readerUserId: new ObjectID(ADA),
        })
      ).isHiddenForReader,
    ).toBe(true);
    expect(
      (
        await ServerSetupChecklist.getAnswer({
          readerUserId: new ObjectID(GRACE),
        })
      ).isHiddenForReader,
    ).toBe(false);
    expect((await ServerSetupChecklist.getAnswer()).isHiddenForReader).toBe(
      false,
    );
  });
});

describe("facts", () => {
  test("HTTPS follows HTTP_PROTOCOL, sign-ups the switch", async () => {
    mockEnv.httpProtocol = "https";

    const facts: ServerSetupFacts = await ServerSetupChecklist.readFacts(
      row({ disableSignup: true }),
    );

    expect(facts.isHttpsSetUp).toBe(true);
    expect(facts.areSignupsClosed).toBe(true);
    expect(facts.email.channel).toBe(ServerSendingChannel.Email);
    expect(facts.sms.channel).toBe(ServerSendingChannel.SMS);
    expect(facts.call.channel).toBe(ServerSendingChannel.Call);
  });

  test("no settings row at all reads as a fresh server", async () => {
    const facts: ServerSetupFacts = await ServerSetupChecklist.readFacts(null);

    expect(facts.areSignupsClosed).toBe(false);
    expect(facts.choices).toEqual({ choices: {}, hiddenBy: {} });
    expect(facts.emailSentThrough).toBeNull();
  });
});
