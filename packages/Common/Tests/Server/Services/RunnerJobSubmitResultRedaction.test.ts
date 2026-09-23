import RunnerJobService, {
  Service as RunnerJobServiceClass,
} from "../../../Server/Services/RunnerJobService";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import RunnerJobOrigin, {
  AI_COMMAND_JOB_ORIGINS,
} from "../../../Types/Runbook/RunnerJobOrigin";
import RunnerJobStatus from "../../../Types/Runbook/RunnerJobStatus";
import { KUBECTL_REDACTED_MARKER } from "../../../Utils/AiRemediation/KubectlOutputRedactor";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — RunnerJobService.submitResult, the one write that
 * puts a Runner's output on the RunnerJob row the dashboard displays:
 *
 * - for an AI-origin job (an investigation's or a remediation's kubectl)
 *   the stored output and error message go through the same two redaction
 *   passes KubectlJobRunner applies before a model sees them, so a Secret
 *   value the command printed never lands on the row;
 * - a Runbook-origin job's output is the operator's own script's output
 *   and is stored verbatim;
 * - the origin is read inside the UPDATE itself (a CASE on the row's
 *   origin column), so the lease check and the write remain one atomic
 *   statement and one round trip;
 * - the lease guard is unchanged: only the assigned agent, only from
 *   Claimed/Running, and "no row" means "not ours any more".
 *
 * Postgres is replaced by a captured query so the statement and its
 * parameters can be asserted on exactly; the CASE is evaluated here the way
 * Postgres would, from the captured SQL and parameters, for each origin.
 */

const JOB_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const AGENT_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

const SECRET_VALUE: string = "c3VwZXItc2VjcmV0LXBhc3N3b3Jk";
const BEARER_TOKEN: string =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJvbmV1cHRpbWUifQ.abcdefghijklmnopqrstuvwxyz0123456789";

const SECRET_OUTPUT: string = [
  "[stdout]",
  "apiVersion: v1",
  "kind: Secret",
  "metadata:",
  "  name: db-credentials",
  "  namespace: web",
  "data:",
  `  password: ${SECRET_VALUE}`,
  "type: Opaque",
].join("\n");

interface CapturedQuery {
  sql: string;
  params: Array<unknown>;
}

/*
 * Evaluate a `"<column>" = CASE WHEN "origin" = ANY($n::text[]) THEN $a::text
 * ELSE $b::text END` assignment the way Postgres would for a row of the
 * given origin — so the test asserts what is STORED, not just which
 * parameters were sent.
 */
function storedValueFor(data: {
  query: CapturedQuery;
  column: "output" | "errorMessage";
  origin: RunnerJobOrigin;
}): unknown {
  const pattern: RegExp = new RegExp(
    `"${data.column}" = CASE\\s+WHEN "origin" = ANY\\(\\$(\\d+)::text\\[\\]\\) THEN \\$(\\d+)::text\\s+ELSE \\$(\\d+)::text\\s+END`,
  );
  const match: RegExpMatchArray | null = data.query.sql.match(pattern);

  if (!match) {
    throw new Error(
      `The UPDATE does not pick "${data.column}" by origin:\n${data.query.sql}`,
    );
  }

  const originsParam: Array<string> = data.query.params[
    Number(match[1]) - 1
  ] as Array<string>;
  const thenParam: unknown = data.query.params[Number(match[2]) - 1];
  const elseParam: unknown = data.query.params[Number(match[3]) - 1];

  return originsParam.includes(data.origin) ? thenParam : elseParam;
}

describe("RunnerJobService.submitResult output redaction at rest", () => {
  let queries: Array<CapturedQuery>;
  let queryMock: jest.Mock;

  beforeEach(() => {
    queries = [];
    queryMock = jest
      .fn()
      .mockImplementation(
        async (sql: string, params: Array<unknown>): Promise<unknown> => {
          queries.push({ sql, params });
          return [[{ _id: JOB_ID.toString() }], 1];
        },
      );
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue({
      query: queryMock,
    } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function lastQuery(): CapturedQuery {
    const query: CapturedQuery | undefined = queries[queries.length - 1];

    if (!query) {
      throw new Error("submitResult never queried the database");
    }

    return query;
  }

  it("masks a Secret data value before it is stored for an investigation job, and keeps the key", async () => {
    const written: boolean = await RunnerJobService.submitResult({
      jobId: JOB_ID,
      agentId: AGENT_ID,
      success: true,
      output: SECRET_OUTPUT,
      exitCode: 0,
    });

    expect(written).toBe(true);
    expect(queryMock).toHaveBeenCalledTimes(1);

    const stored: string = storedValueFor({
      query: lastQuery(),
      column: "output",
      origin: RunnerJobOrigin.AiInvestigation,
    }) as string;

    expect(stored).not.toContain(SECRET_VALUE);
    expect(stored).toContain(KUBECTL_REDACTED_MARKER);
    expect(stored).toContain("password:");
    expect(stored).toContain("kind: Secret");
  });

  it("masks the same way for a remediation job", async () => {
    await RunnerJobService.submitResult({
      jobId: JOB_ID,
      agentId: AGENT_ID,
      success: true,
      output: SECRET_OUTPUT,
    });

    const stored: string = storedValueFor({
      query: lastQuery(),
      column: "output",
      origin: RunnerJobOrigin.AiRemediation,
    }) as string;

    expect(stored).not.toContain(SECRET_VALUE);
    expect(stored).toContain(KUBECTL_REDACTED_MARKER);
  });

  it("stores a Runbook-origin job's output verbatim", async () => {
    await RunnerJobService.submitResult({
      jobId: JOB_ID,
      agentId: AGENT_ID,
      success: true,
      output: SECRET_OUTPUT,
    });

    expect(
      storedValueFor({
        query: lastQuery(),
        column: "output",
        origin: RunnerJobOrigin.Runbook,
      }),
    ).toBe(SECRET_OUTPUT);
  });

  it("redacts the error message of an AI job too — kubectl prints the offending object on stderr", async () => {
    const errorMessage: string = `Exit code 1: could not patch, applied object was: ${SECRET_OUTPUT}`;

    await RunnerJobService.submitResult({
      jobId: JOB_ID,
      agentId: AGENT_ID,
      success: false,
      output: "",
      exitCode: 1,
      errorMessage,
    });

    const query: CapturedQuery = lastQuery();

    const storedForAi: string = storedValueFor({
      query,
      column: "errorMessage",
      origin: RunnerJobOrigin.AiInvestigation,
    }) as string;
    expect(storedForAi).not.toContain(SECRET_VALUE);
    expect(storedForAi).toContain("Exit code 1");

    expect(
      storedValueFor({
        query,
        column: "errorMessage",
        origin: RunnerJobOrigin.Runbook,
      }),
    ).toBe(errorMessage);
  });

  it("also applies the tool-result pass, so a bearer token in plain describe output is masked", async () => {
    const output: string = `[stdout]\nAnnotations: auth-header: Bearer ${BEARER_TOKEN}\n`;

    await RunnerJobService.submitResult({
      jobId: JOB_ID,
      agentId: AGENT_ID,
      success: true,
      output,
    });

    const stored: string = storedValueFor({
      query: lastQuery(),
      column: "output",
      origin: RunnerJobOrigin.AiInvestigation,
    }) as string;

    expect(stored).not.toContain(BEARER_TOKEN);
  });

  it("leaves an absent output and error message null for every origin", async () => {
    await RunnerJobService.submitResult({
      jobId: JOB_ID,
      agentId: AGENT_ID,
      success: false,
    });

    const query: CapturedQuery = lastQuery();

    for (const origin of [
      RunnerJobOrigin.Runbook,
      RunnerJobOrigin.AiInvestigation,
      RunnerJobOrigin.AiRemediation,
    ]) {
      expect(storedValueFor({ query, column: "output", origin })).toBeNull();
      expect(
        storedValueFor({ query, column: "errorMessage", origin }),
      ).toBeNull();
    }
  });

  it("decides by the row's origin inside the one UPDATE — both AI origins, no prior lookup", async () => {
    await RunnerJobService.submitResult({
      jobId: JOB_ID,
      agentId: AGENT_ID,
      success: true,
      output: "ok",
    });

    expect(queryMock).toHaveBeenCalledTimes(1);

    const query: CapturedQuery = lastQuery();
    expect(query.sql).toMatch(/^\s*UPDATE "RunnerJob"/);
    expect(query.sql).toContain('WHEN "origin" = ANY(');
    expect(query.params).toContainEqual(AI_COMMAND_JOB_ORIGINS);
    expect(AI_COMMAND_JOB_ORIGINS).toEqual([
      RunnerJobOrigin.AiRemediation,
      RunnerJobOrigin.AiInvestigation,
    ]);
  });

  it("keeps the lease guard: the assigned agent, from Claimed or Running only, and no row means not ours", async () => {
    queryMock.mockImplementationOnce(
      async (sql: string, params: Array<unknown>): Promise<unknown> => {
        queries.push({ sql, params });
        return [[], 0];
      },
    );

    const written: boolean = await RunnerJobService.submitResult({
      jobId: JOB_ID,
      agentId: AGENT_ID,
      success: true,
      output: "ok",
      exitCode: 0,
    });

    expect(written).toBe(false);

    const query: CapturedQuery = lastQuery();
    expect(query.sql).toContain('"assignedAgentId" = $6::uuid');
    expect(query.sql).toContain('"status" IN ($7, $8)');
    expect(query.params[0]).toBe(RunnerJobStatus.Succeeded);
    expect(query.params[4]).toBe(JOB_ID.toString());
    expect(query.params[5]).toBe(AGENT_ID.toString());
    expect(query.params[6]).toBe(RunnerJobStatus.Claimed);
    expect(query.params[7]).toBe(RunnerJobStatus.Running);
  });

  it("refuses to write without a database connection", async () => {
    (PostgresAppInstance.getDataSource as jest.Mock).mockReturnValue(null);

    await expect(
      RunnerJobService.submitResult({
        jobId: JOB_ID,
        agentId: AGENT_ID,
        success: true,
        output: "ok",
      }),
    ).rejects.toBeInstanceOf(BadDataException);
  });

  it("redactAiJobText is the pure transform the row gets: kubectl redaction, then the tool-result pass", () => {
    const text: string = `${SECRET_OUTPUT}\nauth: Bearer ${BEARER_TOKEN}`;
    const redacted: string = RunnerJobServiceClass.redactAiJobText(text);

    expect(redacted).not.toContain(SECRET_VALUE);
    expect(redacted).not.toContain(BEARER_TOKEN);
    expect(redacted).toContain("kind: Secret");
  });
});
