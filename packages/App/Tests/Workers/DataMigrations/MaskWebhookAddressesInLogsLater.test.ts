import MaskWebhookAddressesInLogs from "../../../FeatureSet/Workers/DataMigrations/MaskWebhookAddressesInLogs";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import WebhookLogService from "Common/Server/Services/WebhookLogService";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import logger from "Common/Server/Utils/Logger";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHAT A SERVER OF THE RELEASE BEFORE LOGGED DURING THE UPGRADE IS MASKED A
 * DAY LATER (#9266).
 *
 * MaskWebhookAddressesInLogs masks every webhook address the notification
 * logs kept, at the upgrade. A server of the release before, still running
 * while it rolls out, goes on logging addresses whole, which only it shows
 * (harmless to it), but which stay in the logs. So a day later the
 * CredentialsAtRest:EncryptInPlace job runs maskLogs once more over the
 * rows written or changed since: the same statements, narrowed by when the
 * row was created or updated; whether every page was read and written; and
 * stopped by the run's deadline.
 */

const SINCE: Date = new Date("2026-11-16T08:00:00.000Z");
const SLACK_HOOK: string =
  "https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX";

interface Statement {
  table: string;
  sql: string;
  params: Array<unknown>;
}

let statements: Array<Statement>;
let logRows: Array<Record<string, unknown>>;
let failLogWrite: boolean;
let failLineWrite: boolean;

function stubRepositories(): void {
  jest.spyOn(WebhookLogService, "getRepository").mockReturnValue({
    metadata: { tableName: "WebhookLog" },
    manager: {
      query: async (sql: string, params: Array<unknown> = []) => {
        statements.push({ table: "WebhookLog", sql: sql, params: params });

        if (sql.startsWith("SELECT")) {
          return logRows;
        }

        if (failLogWrite) {
          throw new Error(`write failed for ${JSON.stringify(params)}`);
        }

        return [];
      },
    },
  } as never);

  jest.spyOn(UserOnCallLogTimelineService, "getRepository").mockReturnValue({
    metadata: { tableName: "UserOnCallLogTimeline" },
    manager: {
      query: async (sql: string, params: Array<unknown> = []) => {
        statements.push({
          table: "UserOnCallLogTimeline",
          sql: sql,
          params: params,
        });

        if (failLineWrite) {
          throw new Error("write failed");
        }

        return [];
      },
    },
  } as never);
}

beforeEach(() => {
  statements = [];
  logRows = [
    {
      _id: "a",
      webhookUrl: SLACK_HOOK,
      statusMessage: `Could not reach ${SLACK_HOOK}.`,
    },
  ];
  failLogWrite = false;
  failLineWrite = false;
  stubRepositories();
  jest.spyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("maskLogs, over what was logged since", () => {
  test("reads the webhook logs written or changed since, and masks what it finds", async () => {
    expect(
      await new MaskWebhookAddressesInLogs().maskLogs({ since: SINCE }),
    ).toBe(true);

    const [read, write] = statements.filter((statement: Statement) => {
      return statement.table === "WebhookLog";
    });

    expect(read!.sql).toBe(
      `SELECT "_id", "webhookUrl", "statusMessage" FROM "WebhookLog" WHERE "webhookUrl" IS NOT NULL AND ("createdAt" >= $1 OR "updatedAt" >= $1) ORDER BY "_id" ASC LIMIT ${MaskWebhookAddressesInLogs.PAGE_SIZE}`,
    );
    expect(read!.params).toEqual([SINCE]);
    expect(write!.sql).toContain(`UPDATE "WebhookLog"`);
    expect(write!.params[1]).toEqual(["https://hooks.slack.com/•••"]);
  });

  test("masks the on-call log's lines written or changed since", async () => {
    await new MaskWebhookAddressesInLogs().maskLogs({ since: SINCE });

    const [line] = statements.filter((statement: Statement) => {
      return statement.table === "UserOnCallLogTimeline";
    });

    expect(line!.sql).toBe(
      `UPDATE "UserOnCallLogTimeline" SET "statusMessage" = $1 WHERE "statusMessage" ~ $2 AND ("createdAt" >= $3 OR "updatedAt" >= $3)`,
    );
    expect(line!.params).toEqual([
      "Sending webhook.",
      MaskWebhookAddressesInLogs.SENDING_LINE_WITH_ADDRESS,
      SINCE,
    ]);
  });

  test("the upgrade's run reads every log, as it did", async () => {
    await new MaskWebhookAddressesInLogs().migrate();

    const [read] = statements;
    const line: Statement | undefined = statements.find(
      (statement: Statement) => {
        return statement.table === "UserOnCallLogTimeline";
      },
    );

    expect(read!.sql).toBe(
      `SELECT "_id", "webhookUrl", "statusMessage" FROM "WebhookLog" WHERE "webhookUrl" IS NOT NULL ORDER BY "_id" ASC LIMIT ${MaskWebhookAddressesInLogs.PAGE_SIZE}`,
    );
    expect(read!.params).toEqual([]);
    expect(line!.sql).toBe(
      `UPDATE "UserOnCallLogTimeline" SET "statusMessage" = $1 WHERE "statusMessage" ~ $2`,
    );
  });

  test("a page it cannot write, or a line, says it is not done", async () => {
    failLogWrite = true;

    expect(
      await new MaskWebhookAddressesInLogs().maskLogs({ since: SINCE }),
    ).toBe(false);

    failLogWrite = false;
    failLineWrite = true;

    expect(
      await new MaskWebhookAddressesInLogs().maskLogs({ since: SINCE }),
    ).toBe(false);

    // No address in any log line.
    expect(JSON.stringify(jest.mocked(logger.error).mock.calls)).not.toContain(
      SLACK_HOOK,
    );
  });

  test("a run whose deadline has passed reads nothing, and is not done", async () => {
    const deadline: JobDeadline = new JobDeadline();

    deadline.end(new Error("the run's time limit"));

    expect(
      await new MaskWebhookAddressesInLogs().maskLogs({
        since: SINCE,
        deadline: deadline,
      }),
    ).toBe(false);
    expect(statements).toEqual([]);
  });
});
