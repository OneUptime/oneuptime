import RunnerJobService, {
  RUNNER_JOB_UNSTORABLE_CHARACTER_REPLACEMENT,
  Service as RunnerJobServiceClass,
} from "../../../Server/Services/RunnerJobService";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import RunnerJobOrigin from "../../../Types/Runbook/RunnerJobOrigin";
import { KUBECTL_REDACTED_MARKER } from "../../../Utils/AiRemediation/KubectlOutputRedactor";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * Contract under test — a Runner's result is always storable.
 *
 * RunnerJob.output and RunnerJob.errorMessage are Postgres text columns, and
 * Postgres rejects U+0000 anywhere in a text value — at BIND time, so every
 * text parameter of the UPDATE counts, including the one the statement's
 * CASE does not pick for the row's origin. A NUL byte is ordinary in what a
 * Runner reports (`kubectl logs` of a log rotated with copytruncate, a
 * ConfigMap value `describe` prints verbatim, a script writing binary), and
 * before round four the whole result POST then failed with a 500 on every
 * attempt: the Runner retried it as if the server were down, the lease
 * lapsed, and the job read "result unknown" although the command had run.
 *
 * So RunnerJobService.submitResult, for every origin and before the
 * redaction passes read the text:
 *
 * - replaces each U+0000 with U+FFFD (visible, rather than silently closing
 *   up the text);
 * - replaces a lone UTF-16 surrogate half (no UTF-8 encoding exists for it)
 *   with U+FFFD too, keeping whole surrogate pairs;
 * - leaves every other character exactly as it was.
 *
 * Postgres is replaced by a captured query that refuses a NUL in any text
 * parameter the way Postgres does (22021), so "the result is accepted" is
 * asserted, not only "the parameter looks clean".
 * ---------------------------------------------------------------------------
 */

const JOB_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const AGENT_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

const NUL: string = String.fromCharCode(0);
const FFFD: string = String.fromCharCode(0xfffd);
const HIGH_SURROGATE: string = String.fromCharCode(0xd83d);
const LOW_SURROGATE: string = String.fromCharCode(0xde80);
// U+1F680, a whole pair: a character like any other.
const ROCKET: string = HIGH_SURROGATE + LOW_SURROGATE;

const SECRET_VALUE: string = "c3VwZXItc2VjcmV0LXBhc3N3b3Jk";

// Parameter positions in the UPDATE (1-based $n minus one).
const RAW_OUTPUT_PARAM: number = 1;
const RAW_ERROR_MESSAGE_PARAM: number = 3;
const REDACTED_OUTPUT_PARAM: number = 9;
const REDACTED_ERROR_MESSAGE_PARAM: number = 10;

interface CapturedQuery {
  sql: string;
  params: Array<unknown>;
}

// What Postgres answers when a text parameter carries U+0000.
class PostgresInvalidByteSequenceError extends Error {
  public readonly code: string = "22021";

  public constructor() {
    super('invalid byte sequence for encoding "UTF8": 0x00');
  }
}

function containsNul(value: unknown): boolean {
  if (typeof value === "string") {
    return value.includes(NUL);
  }

  if (Array.isArray(value)) {
    return value.some((item: unknown) => {
      return containsNul(item);
    });
  }

  return false;
}

// Every text parameter, flattened (the origins list is an array of text).
function textParams(query: CapturedQuery): Array<string> {
  const texts: Array<string> = [];

  for (const param of query.params) {
    if (typeof param === "string") {
      texts.push(param);
    } else if (Array.isArray(param)) {
      for (const item of param) {
        if (typeof item === "string") {
          texts.push(item);
        }
      }
    }
  }

  return texts;
}

// A lone surrogate half anywhere in the text.
function hasLoneSurrogate(text: string): boolean {
  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);

    if (code >= 0xd800 && code <= 0xdbff) {
      const next: number = text.charCodeAt(index + 1);

      if (next >= 0xdc00 && next <= 0xdfff) {
        index++;
        continue;
      }

      return true;
    }

    if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }

  return false;
}

describe("RunnerJobService.submitResult stores text Postgres can hold", () => {
  let queries: Array<CapturedQuery>;
  let postgresLikeQuery: jest.Mock;

  beforeEach(() => {
    queries = [];
    postgresLikeQuery = jest
      .fn()
      .mockImplementation(
        async (sql: string, params: Array<unknown>): Promise<unknown> => {
          queries.push({ sql, params });

          if (containsNul(params)) {
            throw new PostgresInvalidByteSequenceError();
          }

          return [[{ _id: JOB_ID.toString() }], 1];
        },
      );
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue({
      query: postgresLikeQuery,
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

  /*
   * The stand-in refuses what Postgres refuses; without this the tests
   * below would pass against a database that accepts anything.
   */
  it("negative control: the stand-in database refuses a NUL in any text parameter, as Postgres does", async () => {
    await expect(
      postgresLikeQuery("SELECT $1::text", [`a${NUL}b`]),
    ).rejects.toBeInstanceOf(PostgresInvalidByteSequenceError);
    await expect(
      postgresLikeQuery("SELECT $1::text[]", [["ok", `x${NUL}`]]),
    ).rejects.toBeInstanceOf(PostgresInvalidByteSequenceError);
    await expect(
      postgresLikeQuery("SELECT $1::text", ["no nul"]),
    ).resolves.toBeDefined();
  });

  it("accepts a kubectl logs output with NUL bytes, stored with U+FFFD where each NUL was", async () => {
    const output: string = `[stdout]\n2026-09-23T10:00:00Z GET /health 200\n${NUL}${NUL}${NUL}2026-09-23T10:00:01Z GET /health 200\n`;

    const accepted: boolean = await RunnerJobService.submitResult({
      jobId: JOB_ID,
      agentId: AGENT_ID,
      success: true,
      output,
      exitCode: 0,
    });

    expect(accepted).toBe(true);
    const query: CapturedQuery = lastQuery();
    expect(query.params[RAW_OUTPUT_PARAM]).toBe(
      `[stdout]\n2026-09-23T10:00:00Z GET /health 200\n${FFFD}${FFFD}${FFFD}2026-09-23T10:00:01Z GET /health 200\n`,
    );
    expect(query.params[REDACTED_OUTPUT_PARAM]).toBe(
      query.params[RAW_OUTPUT_PARAM],
    );

    for (const text of textParams(query)) {
      expect(text.includes(NUL)).toBe(false);
    }
  });

  it("accepts a NUL in the error message too, for both the verbatim and the redacted copy", async () => {
    const accepted: boolean = await RunnerJobService.submitResult({
      jobId: JOB_ID,
      agentId: AGENT_ID,
      success: false,
      output: `partial${NUL}`,
      exitCode: 1,
      errorMessage: `Exit code 1: error: unexpected byte ${NUL} in stream`,
    });

    expect(accepted).toBe(true);
    const query: CapturedQuery = lastQuery();
    expect(query.params[RAW_ERROR_MESSAGE_PARAM]).toBe(
      `Exit code 1: error: unexpected byte ${FFFD} in stream`,
    );
    expect(query.params[REDACTED_ERROR_MESSAGE_PARAM]).toBe(
      `Exit code 1: error: unexpected byte ${FFFD} in stream`,
    );
    expect(query.params[RAW_OUTPUT_PARAM]).toBe(`partial${FFFD}`);
  });

  /*
   * The origin is decided inside the UPDATE, so one submission carries the
   * text for every origin. A NUL in a runbook step's output failed the write
   * the same way before round four (the runbook lane on master had the same
   * defect).
   */
  it("covers every origin: the verbatim copy a runbook row keeps is cleaned too", async () => {
    await RunnerJobService.submitResult({
      jobId: JOB_ID,
      agentId: AGENT_ID,
      success: true,
      output: `binary${NUL}blob`,
    });

    const query: CapturedQuery = lastQuery();
    expect(query.sql).toContain(
      `WHEN "origin" = ANY($9::text[]) THEN $10::text`,
    );
    expect(query.sql).toContain("ELSE $2::text");
    expect(query.params[8]).toContain(RunnerJobOrigin.AiInvestigation);
    expect(query.params[8]).not.toContain(RunnerJobOrigin.Runbook);
    expect(query.params[RAW_OUTPUT_PARAM]).toBe(`binary${FFFD}blob`);
  });

  /*
   * Cleaned BEFORE redaction: a NUL next to a Secret value (describe prints
   * ConfigMap/Secret data verbatim) must not stop the value being masked.
   */
  it("still masks a Secret value for an AI job when the output also carries a NUL", async () => {
    const output: string = [
      "[stdout]",
      "apiVersion: v1",
      "kind: Secret",
      "data:",
      `  password: ${SECRET_VALUE}`,
      `  blob: AAAA${NUL}BBBB`,
      "type: Opaque",
    ].join("\n");

    const accepted: boolean = await RunnerJobService.submitResult({
      jobId: JOB_ID,
      agentId: AGENT_ID,
      success: true,
      output,
    });

    expect(accepted).toBe(true);
    const redacted: string = lastQuery().params[
      REDACTED_OUTPUT_PARAM
    ] as string;
    expect(redacted).not.toContain(SECRET_VALUE);
    expect(redacted).toContain(KUBECTL_REDACTED_MARKER);
    expect(redacted.includes(NUL)).toBe(false);
  });

  it("replaces a lone surrogate half with U+FFFD and keeps a whole pair", async () => {
    await RunnerJobService.submitResult({
      jobId: JOB_ID,
      agentId: AGENT_ID,
      success: true,
      output: `cut here ${HIGH_SURROGATE}| orphan ${LOW_SURROGATE}| whole ${ROCKET} | reversed ${LOW_SURROGATE}${HIGH_SURROGATE}`,
    });

    const stored: string = lastQuery().params[RAW_OUTPUT_PARAM] as string;
    expect(stored).toBe(
      `cut here ${FFFD}| orphan ${FFFD}| whole ${ROCKET} | reversed ${FFFD}${FFFD}`,
    );
    expect(hasLoneSurrogate(stored)).toBe(false);
    expect(
      hasLoneSurrogate(lastQuery().params[REDACTED_OUTPUT_PARAM] as string),
    ).toBe(false);
  });

  /*
   * Negative control: ordinary text — control characters Postgres does
   * accept, non-Latin scripts, emoji, an empty string — is bound exactly
   * as it arrived.
   */
  it("negative control: text without an unstorable character is bound unchanged", async () => {
    const output: string = `clean output\ttab\r\nbell\u0007 ünïcödé 日本語 ${ROCKET} ${FFFD}`;

    const accepted: boolean = await RunnerJobService.submitResult({
      jobId: JOB_ID,
      agentId: AGENT_ID,
      success: true,
      output,
      errorMessage: "",
    });

    expect(accepted).toBe(true);
    expect(lastQuery().params[RAW_OUTPUT_PARAM]).toBe(output);
    expect(lastQuery().params[RAW_ERROR_MESSAGE_PARAM]).toBe("");
  });

  it("negative control: an absent output and error message stay null", async () => {
    await RunnerJobService.submitResult({
      jobId: JOB_ID,
      agentId: AGENT_ID,
      success: false,
    });

    const query: CapturedQuery = lastQuery();
    expect(query.params[RAW_OUTPUT_PARAM]).toBeNull();
    expect(query.params[RAW_ERROR_MESSAGE_PARAM]).toBeNull();
    expect(query.params[REDACTED_OUTPUT_PARAM]).toBeNull();
    expect(query.params[REDACTED_ERROR_MESSAGE_PARAM]).toBeNull();
  });

  it("toStorableText is the pure transform: NUL and lone halves become U+FFFD, nothing else moves", () => {
    expect(RUNNER_JOB_UNSTORABLE_CHARACTER_REPLACEMENT).toBe(FFFD);
    expect(RunnerJobServiceClass.toStorableText("")).toBe("");
    expect(RunnerJobServiceClass.toStorableText(NUL)).toBe(FFFD);
    expect(RunnerJobServiceClass.toStorableText(`${NUL}${NUL}`)).toBe(
      `${FFFD}${FFFD}`,
    );
    expect(RunnerJobServiceClass.toStorableText(`a${NUL}b${NUL}c`)).toBe(
      `a${FFFD}b${FFFD}c`,
    );
    expect(RunnerJobServiceClass.toStorableText(HIGH_SURROGATE)).toBe(FFFD);
    expect(RunnerJobServiceClass.toStorableText(LOW_SURROGATE)).toBe(FFFD);
    expect(RunnerJobServiceClass.toStorableText(ROCKET)).toBe(ROCKET);
    expect(
      RunnerJobServiceClass.toStorableText(`${ROCKET}${HIGH_SURROGATE}`),
    ).toBe(`${ROCKET}${FFFD}`);
    // Called twice, the same answer: the global patterns keep no state.
    expect(RunnerJobServiceClass.toStorableText(`x${NUL}`)).toBe(`x${FFFD}`);
    expect(RunnerJobServiceClass.toStorableText(`x${NUL}`)).toBe(`x${FFFD}`);
  });
});
