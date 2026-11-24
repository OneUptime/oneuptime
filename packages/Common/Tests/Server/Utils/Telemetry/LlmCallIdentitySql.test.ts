import { describe, expect, test } from "@jest/globals";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import {
  buildLlmPersonSql,
  buildLlmTeamSql,
} from "../../../../Server/Utils/Telemetry/LlmCallIdentitySql";
import { buildSpanGroupSql } from "../../../../Server/Utils/Telemetry/LlmUsageReader";
import { SCRUB_HASH_TOKEN_SQL_PATTERN } from "../../../../Server/Utils/Telemetry/ScrubPlaceholderSql";
import {
  LLM_USAGE_HIDDEN_GROUP_KEY,
  LlmUsageDimension,
} from "../../../../Types/Telemetry/LlmUsageApi";
import {
  SCRUB_MASK_MARK,
  SCRUB_REDACTED_PLACEHOLDER,
} from "../../../../Types/Telemetry/ScrubRule";

/*
 * WHO MADE AN AI CALL, ASKED IN CLICKHOUSE (#10631).
 *
 * One expression for a call's person and one for its team, which the Usage
 * tab groups its spend by (LlmUsageReader) and the conversation list reads
 * its people by (LlmConversationService), so the two - and the Calls table
 * and a conversation's calls, which read them with LlmCallIdentity - always
 * name a call's person alike: the email when no scrub rule touched it, else
 * the id when no rule touched it, else the hidden key when a rule hid
 * either, else ''.
 *
 * These pin the statement: its text, and every text it compares with bound
 * as a parameter. App/Tests/Telemetry/LlmUsageCountingClickhouse.test.ts
 * runs it against a real ClickHouse, under both analyzers, and holds it to
 * LlmCallIdentity value by value.
 */

const EMAIL: string = "ifNull(llmUserEmail, '')";
const USER_ID: string = "ifNull(llmUserId, '')";
const TEAM: string = "ifNull(llmTeam, '')";

// A statement's text with its parameters' numbers left out: each statement numbers its own.
function withoutParameterNumbers(sql: string): string {
  return sql.replace(/\{p\d+:String\}/g, "{p}");
}

// Whether a value holds what a scrub rule left, as ScrubPlaceholderSql asks it.
function holds(expression: string): string {
  return `((position(${expression}, {p}) > 0 OR position(${expression}, {p}) > 0) OR match(${expression}, {p}))`;
}

// What each holds() compares with, in its order.
const PLACEHOLDER_TEXTS: Array<string> = [
  SCRUB_REDACTED_PLACEHOLDER,
  SCRUB_MASK_MARK,
  SCRUB_HASH_TOKEN_SQL_PATTERN,
];

function values(statement: Statement): Array<unknown> {
  return Object.values(statement.query_params);
}

describe("a call's person", () => {
  const statement: Statement = buildLlmPersonSql();

  test("is its email, else its id, each past what a rule left; else the hidden key when a rule hid either; else ''", () => {
    expect(withoutParameterNumbers(statement.query)).toBe(
      `multiIf(${EMAIL} != '' AND NOT ${holds(EMAIL)}, ${EMAIL}, ${USER_ID} != '' AND NOT ${holds(USER_ID)}, ${USER_ID}, ${holds(EMAIL)} OR ${holds(USER_ID)}, {p}, '')`,
    );
  });

  test("binds every text it compares with, and the hidden key, as parameters", () => {
    expect(values(statement)).toEqual([
      ...PLACEHOLDER_TEXTS,
      ...PLACEHOLDER_TEXTS,
      ...PLACEHOLDER_TEXTS,
      ...PLACEHOLDER_TEXTS,
      LLM_USAGE_HIDDEN_GROUP_KEY,
    ]);
    expect(statement.query).not.toContain(SCRUB_REDACTED_PLACEHOLDER);
    expect(statement.query).not.toContain(SCRUB_MASK_MARK);
    expect(statement.query).not.toContain("HASHED");
  });

  test("is built anew each time, so a statement that appends it twice binds each copy", () => {
    expect(buildLlmPersonSql()).not.toBe(buildLlmPersonSql());
    expect(buildLlmPersonSql().query).toBe(statement.query);
  });

  test("is what the Usage tab groups its spend by person by", () => {
    expect(
      withoutParameterNumbers(
        buildSpanGroupSql(LlmUsageDimension.Employee)!.query,
      ),
    ).toBe(withoutParameterNumbers(statement.query));
  });
});

describe("a call's team", () => {
  const statement: Statement = buildLlmTeamSql();

  test("is its name, or the hidden key when a rule hid it", () => {
    expect(withoutParameterNumbers(statement.query)).toBe(
      `if(${holds(TEAM)}, {p}, ${TEAM})`,
    );
    expect(values(statement)).toEqual([
      ...PLACEHOLDER_TEXTS,
      LLM_USAGE_HIDDEN_GROUP_KEY,
    ]);
  });

  test("is what the Usage tab groups its spend by team by", () => {
    expect(
      withoutParameterNumbers(buildSpanGroupSql(LlmUsageDimension.Team)!.query),
    ).toBe(withoutParameterNumbers(statement.query));
  });
});

describe("the other dimensions", () => {
  test("group by the stored model and provider, a service by itself, and none by nothing", () => {
    expect(buildSpanGroupSql(LlmUsageDimension.Model)!.query).toBe(
      "ifNull(llmRequestModel, '')",
    );
    expect(buildSpanGroupSql(LlmUsageDimension.Provider)!.query).toBe(
      "ifNull(llmSystem, '')",
    );
    expect(buildSpanGroupSql(LlmUsageDimension.Service)).toBeNull();
    expect(buildSpanGroupSql(LlmUsageDimension.None)).toBeNull();
  });
});
