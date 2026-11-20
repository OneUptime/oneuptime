import RedactDataSecurityIssueExplanationLogs from "../../../FeatureSet/Workers/DataMigrations/RedactDataSecurityIssueExplanationLogs";
import LlmLogService from "Common/Server/Services/LlmLogService";
import logger from "Common/Server/Utils/Logger";
import LlmLogStatus from "Common/Types/LlmLogStatus";
import ObjectID from "Common/Types/ObjectID";
import { DataSource } from "Common/node_modules/typeorm";

/*
 * TAKING DATA SECURITY ISSUES OUT OF THE AI LOGS, ON A REAL POSTGRES (#10361).
 *
 * RedactDataSecurityIssueExplanationLogs writes Explain with AI's AI Logs
 * rows as a call writes one now. Only Postgres can show its statements do
 * what they say:
 *
 *   - every preview of a row of that feature becomes the words a call that
 *     keeps none writes, a preview it never held stays empty, and a failed
 *     call's error becomes the words a call that keeps no error details
 *     writes - deleted rows too;
 *   - no other feature's row, and nothing else of the row, changes;
 *   - it walks more rows than a page, and changes nothing the second time.
 *
 * Opt in with RUN_POSTGRES_LLM_LOG_REDACTION_TESTS=true against a Postgres -
 * the Postgres Schema Drift workflow's database, right after its drift
 * check, whose "LlmLog" table's structure is cloned into a unique schema
 * (search_path holds only that schema), or any Postgres, where the table is
 * made with the columns the migration reads. Dropped afterwards.
 * Credentials from DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * LLM_LOG_REDACTION_TEST_DATABASE_NAME or DATABASE_NAME, endpoint from
 * LLM_LOG_REDACTION_TEST_DATABASE_HOST / _PORT (default localhost:5400).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_LLM_LOG_REDACTION_TESTS"] === "true"
    ? describe
    : describe.skip;

// A statement that waits on a lock fails instead of hanging the suite.
const LOCK_TIMEOUT_MS: number = 5000;

const DASHES: RegExp = /-/g;

const FEATURE: string = "DataSecurityIssueExplanation";
const NOT_KEPT: string =
  "[Redacted — this content is private to the requesting user]";
const ERROR_WITHOUT_DETAILS: string =
  "The LLM provider request failed. Review the provider under Project Settings → AI → LLM Providers, then try again.";

const PROMPT: string =
  "Issue: Anyone on the internet can read it\nStore: acme-card-exports (AWS S3 Bucket, eu-north-1)\nCloud id: arn:aws:s3:::acme-card-exports";
const ANSWER: string =
  "Turn on Block Public Access for acme-card-exports in eu-north-1.";
const ECHOED_ERROR: string =
  '400 Bad Request: could not parse "Store: acme-card-exports (AWS S3 Bucket, eu-north-1)"';

interface LogRow {
  _id: string;
  feature: string | null;
  status: string | null;
  statusMessage: string | null;
  requestPrompt: string | null;
  responsePreview: string | null;
  deletedAt: Date | null;
}

describePostgres("Explain with AI's AI Logs rows (Postgres)", () => {
  const schema: string = `llm_log_redaction_${ObjectID.generate()
    .toString()
    .replace(DASHES, "")}`;

  let database: DataSource;

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["LLM_LOG_REDACTION_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["LLM_LOG_REDACTION_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["LLM_LOG_REDACTION_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: [],
      schema,
      synchronize: false,
      extra: {
        options: `-c search_path=${schema} -c lock_timeout=${LOCK_TIMEOUT_MS}`,
      },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    const migrated: Array<{ exists: boolean }> = await database.query(
      `SELECT to_regclass('public."LlmLog"') IS NOT NULL AS "exists"`,
    );

    await database.query(
      migrated[0]?.exists
        ? `CREATE TABLE "${schema}"."LlmLog" (LIKE public."LlmLog" INCLUDING DEFAULTS)`
        : `CREATE TABLE "${schema}"."LlmLog" ("_id" uuid PRIMARY KEY, "projectId" uuid, "feature" varchar(100), "status" varchar(100), "statusMessage" varchar(500), "requestPrompt" text, "responsePreview" text, "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(), "deletedAt" timestamptz, "version" integer NOT NULL DEFAULT 1)`,
    );
  }, 120000);

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(async () => {
    await database.query(`DELETE FROM "LlmLog"`);
    jest
      .spyOn(LlmLogService, "getRepository")
      .mockReturnValue({ manager: database.manager } as never);
    jest.spyOn(logger, "info").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function insert(row: Partial<LogRow>): Promise<string> {
    const id: string = row._id || ObjectID.generate().toString();

    await database.query(
      `INSERT INTO "LlmLog" ("_id", "projectId", "feature", "status", "statusMessage", "requestPrompt", "responsePreview", "deletedAt", "createdAt", "updatedAt", "version") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now(), 1)`,
      [
        id,
        ObjectID.generate().toString(),
        row.feature ?? FEATURE,
        row.status ?? LlmLogStatus.Success,
        row.statusMessage ?? null,
        row.requestPrompt ?? null,
        row.responsePreview ?? null,
        row.deletedAt ?? null,
      ],
    );

    return id;
  }

  async function read(id: string): Promise<LogRow> {
    const rows: Array<LogRow> = await database.query(
      `SELECT "_id", "feature", "status", "statusMessage", "requestPrompt", "responsePreview", "deletedAt" FROM "LlmLog" WHERE "_id" = $1`,
      [id],
    );

    return rows[0]!;
  }

  test("each preview of Explain's rows is replaced, a preview never held stays empty, and a failed call's error is replaced", async () => {
    const answered: string = await insert({
      requestPrompt: PROMPT,
      responsePreview: ANSWER,
    });
    const failed: string = await insert({
      status: LlmLogStatus.Error,
      statusMessage: ECHOED_ERROR,
      requestPrompt: PROMPT,
    });
    const deleted: string = await insert({
      requestPrompt: PROMPT,
      responsePreview: ANSWER,
      deletedAt: new Date("2026-11-01T00:00:00.000Z"),
    });
    const overBudget: string = await insert({
      status: LlmLogStatus.BudgetExceeded,
      statusMessage: "This project has used its daily AI token limit.",
      requestPrompt: PROMPT,
    });

    await new RedactDataSecurityIssueExplanationLogs().migrate();

    expect(await read(answered)).toMatchObject({
      requestPrompt: NOT_KEPT,
      responsePreview: NOT_KEPT,
      statusMessage: null,
    });
    expect(await read(failed)).toMatchObject({
      requestPrompt: NOT_KEPT,
      responsePreview: null,
      statusMessage: ERROR_WITHOUT_DETAILS,
    });
    expect(await read(deleted)).toMatchObject({
      requestPrompt: NOT_KEPT,
      responsePreview: NOT_KEPT,
    });
    // A refusal before the call quotes no prompt: its words stay.
    expect(await read(overBudget)).toMatchObject({
      requestPrompt: NOT_KEPT,
      statusMessage: "This project has used its daily AI token limit.",
    });

    const everything: string = JSON.stringify(
      await database.query(`SELECT * FROM "LlmLog"`),
    );

    expect(everything).not.toContain("acme-card-exports");
    expect(everything).not.toContain("eu-north-1");
  });

  test("no other feature's row changes, and nothing else of a row does", async () => {
    const other: string = await insert({
      feature: "AI Data Check Draft",
      status: LlmLogStatus.Error,
      statusMessage: ECHOED_ERROR,
      requestPrompt: PROMPT,
      responsePreview: ANSWER,
    });
    const explained: string = await insert({
      requestPrompt: PROMPT,
      responsePreview: ANSWER,
    });

    await new RedactDataSecurityIssueExplanationLogs().migrate();

    expect(await read(other)).toMatchObject({
      feature: "AI Data Check Draft",
      statusMessage: ECHOED_ERROR,
      requestPrompt: PROMPT,
      responsePreview: ANSWER,
    });
    expect(await read(explained)).toMatchObject({
      feature: FEATURE,
      status: LlmLogStatus.Success,
    });
  });

  test("walks more rows than a page, and the second run changes nothing", async () => {
    const count: number =
      RedactDataSecurityIssueExplanationLogs.PAGE_SIZE * 2 + 7;

    await database.query(
      `INSERT INTO "LlmLog" ("_id", "projectId", "feature", "status", "requestPrompt", "responsePreview", "createdAt", "updatedAt", "version") SELECT gen_random_uuid(), gen_random_uuid(), $1, $2, $3, $4, now(), now(), 1 FROM generate_series(1, $5)`,
      [FEATURE, LlmLogStatus.Success, PROMPT, ANSWER, count],
    );

    await new RedactDataSecurityIssueExplanationLogs().migrate();

    const left: Array<{ count: string }> = await database.query(
      `SELECT COUNT(*) AS "count" FROM "LlmLog" WHERE "requestPrompt" <> $1 OR "responsePreview" <> $1`,
      [NOT_KEPT],
    );

    expect(Number(left[0]!.count)).toBe(0);

    const before: Array<{ updatedAt: Date }> = await database.query(
      `SELECT "updatedAt" FROM "LlmLog" ORDER BY "_id" LIMIT 1`,
    );
    const statements: Array<string> = [];
    const query: (
      sql: string,
      parameters?: Array<unknown>,
    ) => Promise<unknown> = database.manager.query.bind(database.manager);

    jest.spyOn(LlmLogService, "getRepository").mockReturnValue({
      manager: {
        query: async (
          sql: string,
          parameters?: Array<unknown>,
        ): Promise<unknown> => {
          statements.push(sql);
          return await query(sql, parameters);
        },
      },
    } as never);

    await new RedactDataSecurityIssueExplanationLogs().migrate();

    // Nothing left to read, so nothing written.
    expect(statements).toEqual([
      RedactDataSecurityIssueExplanationLogs.SELECT_FIRST_PAGE,
    ]);

    const after: Array<{ updatedAt: Date }> = await database.query(
      `SELECT "updatedAt" FROM "LlmLog" ORDER BY "_id" LIMIT 1`,
    );

    expect(after[0]!.updatedAt).toEqual(before[0]!.updatedAt);
  });
});
