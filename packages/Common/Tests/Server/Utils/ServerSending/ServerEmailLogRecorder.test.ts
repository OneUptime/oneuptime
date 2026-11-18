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

import ServerEmailLog from "../../../../Models/DatabaseModels/ServerEmailLog";
import ServerEmailLogService from "../../../../Server/Services/ServerEmailLogService";
import ServicesIndex from "../../../../Server/Services/Index";
import logger from "../../../../Server/Utils/Logger";
import ServerEmailLogRecorder, {
  SERVER_EMAIL_LOG_LINK,
  SERVER_EMAIL_LOG_RECIPIENT,
  SERVER_EMAIL_LOG_REDACTED,
  ServerEmailLogFacts,
} from "../../../../Server/Utils/ServerSending/ServerEmailLogRecorder";
import ServerEmailLogWriter from "../../../../Server/Utils/ServerSending/ServerEmailLogWriter";
import ColumnLength from "../../../../Types/Database/ColumnLength";
import Email from "../../../../Types/Email";
import {
  CLOUD_SERVER_EMAIL_LOG_RETENTION_IN_DAYS,
  SERVER_EMAIL_LOG_RETENTION_IN_DAYS,
  getServerEmailLogRetentionInDays,
} from "../../../../Types/Email/ServerEmailLog";
import MailStatus from "../../../../Types/Mail/MailStatus";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHAT THE SERVER'S EMAIL LOG KEEPS OF AN EMAIL (#6878).
 *
 * Which emails leave a row, what a row holds - never the message, a link or
 * a token, and a project's subject never - how long rows are kept, and
 * that a row that cannot be written stops nothing and names nobody.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "68780000-0000-4000-8000-000000000021",
);
const RECIPIENT: string = "alice@example.test";

// The first half of a surrogate pair, left just before the ellipsis.
const HALF_A_CHARACTER_AT_THE_CUT: RegExp = /[\uD800-\uDBFF]…$/;

function facts(
  overrides: Partial<ServerEmailLogFacts> = {},
): ServerEmailLogFacts {
  return {
    isServerSettings: true,
    toEmail: new Email(RECIPIENT),
    subject: "Password Reset Request for OneUptime",
    templateType: "ForgotPassword.hbs",
    isSent: true,
    statusMessage: "Email sent.",
    ...overrides,
  };
}

afterEach(() => {
  ServerEmailLogRecorder.register(null);
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("which emails the log keeps", () => {
  test.each([
    ["no project, sent", true, undefined, true, true],
    ["no project, failed", true, undefined, false, true],
    ["a project's, failed", true, PROJECT_ID, false, true],
    [
      "a project's, sent: in the project's Email Logs",
      true,
      PROJECT_ID,
      true,
      false,
    ],
    ["a project's own mail server, failed", false, PROJECT_ID, false, false],
    ["a project's own mail server, sent", false, PROJECT_ID, true, false],
    ["not the server's settings, no project", false, undefined, false, false],
  ])(
    "%s",
    (
      _name: string,
      isServerSettings: boolean,
      projectId: ObjectID | undefined,
      isSent: boolean,
      isKept: boolean,
    ) => {
      expect(
        ServerEmailLogRecorder.isKept({ isServerSettings, projectId, isSent }),
      ).toBe(isKept);
    },
  );

  test("tells the writer only what the log keeps, once each", async () => {
    const written: Array<ServerEmailLogFacts> = [];

    ServerEmailLogRecorder.register(
      async (told: ServerEmailLogFacts): Promise<void> => {
        written.push(told);
      },
    );

    await ServerEmailLogRecorder.record(facts());
    await ServerEmailLogRecorder.record(
      facts({ projectId: PROJECT_ID, isSent: true }),
    );
    await ServerEmailLogRecorder.record(
      facts({ isServerSettings: false, isSent: false }),
    );

    expect(written).toHaveLength(1);
    expect(written[0]!.projectId).toBeUndefined();
  });

  test("keeps nothing, and throws nothing, before a writer is registered", async () => {
    expect(ServerEmailLogRecorder.isRegistered()).toBe(false);

    await expect(
      ServerEmailLogRecorder.record(facts()),
    ).resolves.toBeUndefined();
  });

  test("a writer that throws never reaches the email", async () => {
    ServerEmailLogRecorder.register(async (): Promise<void> => {
      throw new Error("database is down");
    });

    await expect(
      ServerEmailLogRecorder.record(facts()),
    ).resolves.toBeUndefined();
  });
});

describe("what a subject or an answer keeps", () => {
  test("a link, with its token, is taken out", () => {
    expect(
      ServerEmailLogRecorder.scrub(
        "Reset: https://oneuptime.example.test/accounts/reset-password/6f1c2a7e-93b4-4d2f-8a51-0c7e9d3b2f64 now",
      ),
    ).toBe(`Reset: ${SERVER_EMAIL_LOG_LINK} now`);
    expect(
      ServerEmailLogRecorder.scrub("See www.example.test/verify?token=abc123"),
    ).toBe(`See ${SERVER_EMAIL_LOG_LINK}`);
  });

  test("a run long enough to be a token is redacted; words and numbers stay", () => {
    expect(
      ServerEmailLogRecorder.scrub(
        "Your code 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b expires",
      ),
    ).toBe(`Your code ${SERVER_EMAIL_LOG_REDACTED} expires`);
    expect(
      ServerEmailLogRecorder.scrub(
        "Donaudampfschifffahrtsgesellschaftskapitän 123456789012345678901234567",
      ),
    ).toBe(
      "Donaudampfschifffahrtsgesellschaftskapitän 123456789012345678901234567",
    );
  });

  test("an SMTP answer keeps its words", () => {
    expect(
      ServerEmailLogRecorder.scrub(
        "550 5.1.1 <alice@example.test>: Recipient address rejected",
      ),
    ).toBe("550 5.1.1 <alice@example.test>: Recipient address rejected");
  });

  test("is no longer than its column, and never cuts a character in two", () => {
    const long: string = "a ".repeat(400) + "😀".repeat(200);
    const kept: string = ServerEmailLogRecorder.scrub(long)!;

    expect(kept.length).toBeLessThanOrEqual(ColumnLength.LongText);
    expect(kept.endsWith("…")).toBe(true);
    expect(HALF_A_CHARACTER_AT_THE_CUT.test(kept)).toBe(false);
  });

  test("nothing stays nothing", () => {
    expect(ServerEmailLogRecorder.scrub(undefined)).toBeUndefined();
    expect(ServerEmailLogRecorder.scrub("   ")).toBeUndefined();
  });

  test("a line about an email never names whom it was for", () => {
    expect(
      ServerEmailLogRecorder.withoutRecipient(
        `could not write the row of ${RECIPIENT} (${RECIPIENT.toUpperCase()})`,
        new Email(RECIPIENT),
      ),
    ).not.toContain(RECIPIENT);
    expect(
      ServerEmailLogRecorder.withoutRecipient(
        `could not write the row of ${RECIPIENT}`,
        new Email(RECIPIENT),
      ),
    ).toBe(`could not write the row of ${SERVER_EMAIL_LOG_RECIPIENT}`);
  });
});

describe("the row", () => {
  test("of an email of no project: to whom, its subject, its template, how it went", () => {
    const row: ServerEmailLog = ServerEmailLogWriter.toRow(facts());

    expect(row.toEmail?.toString()).toBe(RECIPIENT);
    expect(row.subject).toBe("Password Reset Request for OneUptime");
    expect(row.templateType).toBe("ForgotPassword.hbs");
    expect(row.status).toBe(MailStatus.Success);
    expect(row.statusMessage).toBe("Email sent.");
    expect(row.projectId).toBeUndefined();
  });

  test("of a project's failed email: its project and template, never its subject", () => {
    const row: ServerEmailLog = ServerEmailLogWriter.toRow(
      facts({
        projectId: PROJECT_ID,
        subject: "Incident #12: a private incident's title",
        templateType: "IncidentCreated.hbs",
        isSent: false,
        statusMessage: "535 5.7.8 Authentication failed",
      }),
    );

    expect(row.subject).toBeUndefined();
    expect(row.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(row.templateType).toBe("IncidentCreated.hbs");
    expect(row.status).toBe(MailStatus.Error);
    expect(row.statusMessage).toBe("535 5.7.8 Authentication failed");
  });

  test("holds only the columns the log has", () => {
    const row: ServerEmailLog = ServerEmailLogWriter.toRow(facts());
    const json: Record<string, unknown> = JSON.parse(
      JSON.stringify(row),
    ) as Record<string, unknown>;

    expect(Object.keys(json)).not.toEqual(
      expect.arrayContaining(["body", "html", "vars", "text"]),
    );
  });

  test("a row that cannot be written is logged without whom it was for", async () => {
    jest
      .spyOn(ServerEmailLogService, "create")
      .mockRejectedValue(new Error(`value too long: ${RECIPIENT}`) as never);

    await ServerEmailLogWriter.write(facts());

    const lines: string = JSON.stringify(jest.mocked(logger.error).mock.calls);

    expect(lines).toContain("could not keep");
    expect(lines).not.toContain(RECIPIENT);
  });

  test("is written as root", async () => {
    const create: ReturnType<typeof jest.spyOn> = jest
      .spyOn(ServerEmailLogService, "create")
      .mockResolvedValue(new ServerEmailLog() as never);

    ServerEmailLogWriter.startWriting();
    await ServerEmailLogRecorder.record(facts());

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0]).toMatchObject({
      props: { isRoot: true },
    });
  });
});

describe("how long a row is kept", () => {
  test("30 days on a self-hosted server, 3 on OneUptime Cloud", () => {
    expect(getServerEmailLogRetentionInDays(false)).toBe(30);
    expect(getServerEmailLogRetentionInDays(true)).toBe(3);
    expect(SERVER_EMAIL_LOG_RETENTION_IN_DAYS).toBe(30);
    expect(CLOUD_SERVER_EMAIL_LOG_RETENTION_IN_DAYS).toBe(3);
  });

  test("the service deletes rows older than that, by when they were written", () => {
    expect(ServerEmailLogService.hardDeleteItemByColumnName).toBe("createdAt");
    expect(ServerEmailLogService.hardDeleteItemsOlderThanDays).toBe(
      getServerEmailLogRetentionInDays(false),
    );
  });

  test("the daily purge reads the service: it is in the service list", () => {
    expect(ServicesIndex).toContain(ServerEmailLogService);
  });
});

describe("the writer is registered when the Notification service starts", () => {
  beforeEach(() => {
    ServerEmailLogRecorder.register(null);
  });

  test("startWriting registers it", () => {
    ServerEmailLogWriter.startWriting();

    expect(ServerEmailLogRecorder.isRegistered()).toBe(true);
  });
});
