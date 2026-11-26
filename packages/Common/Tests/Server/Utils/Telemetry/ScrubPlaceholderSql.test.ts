import { describe, expect, test } from "@jest/globals";
import crypto from "crypto";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import ScrubAction from "../../../../Server/Utils/Telemetry/ScrubAction";
import ScrubHashToken from "../../../../Server/Utils/Telemetry/ScrubHashToken";
import {
  SCRUB_HASH_TOKEN_SQL_PATTERN,
  buildHoldsScrubHashTokenSql,
  buildHoldsScrubPlaceholderSql,
  buildHoldsSharedScrubPlaceholderSql,
  buildIsScrubPseudonymSql,
} from "../../../../Server/Utils/Telemetry/ScrubPlaceholderSql";
import LogScrubAction from "../../../../Types/Log/LogScrubAction";
import LogScrubPatternType from "../../../../Types/Log/LogScrubPatternType";
import {
  SCRUB_MASK_MARK,
  SCRUB_REDACTED_PLACEHOLDER,
  ScrubPlaceholderKind,
  getScrubPlaceholderKind,
} from "../../../../Types/Telemetry/ScrubRule";

/*
 * The question Types/Telemetry/ScrubRule asks of a value - what a scrub
 * rule left in it (#10435) - written for ClickHouse, for the reads that
 * count and group where the values are stored. The statements bind every
 * text they compare with, and the token pattern ClickHouse matches reads
 * the same values as the check the browser and the scans run.
 */

const PROJECT_ID: string = "0192f1a0-0000-7000-8000-00000000c0b1";

function params(statement: Statement): Array<unknown> {
  return Object.values(statement.query_params);
}

// The values a rule can leave, and values it never does.
const CORPUS: Array<string> = [
  ...[LogScrubAction.Redact, LogScrubAction.Mask, LogScrubAction.Hash].map(
    (action: LogScrubAction): string => {
      return ScrubAction.apply({
        match: "jane@example.com",
        action,
        patternType: LogScrubPatternType.Email,
        projectId: PROJECT_ID,
      });
    },
  ),
  ScrubHashToken.ofValue({ projectId: PROJECT_ID, value: "user-42" }),
  `[HASHED:${crypto.createHash("sha256").update("x").digest("hex").substring(0, 8)}]`,
  "auth0|[HASHED:3f9a1c0e7b2d4a68]",
  "[HASHED:3f9a1c0e7b2d4a6]",
  "[HASHED:3F9A1C0E7B2D4A68]",
  "[HASHED:3f9a1c0e7b2d4a6g]",
  "[HASHED:3f9a",
  "jane@example.com",
  "user-42",
  "[Redacted]",
];

describe("asking ClickHouse what a scrub rule left", () => {
  test("a shared placeholder is Redact's text or a mask's stars, both bound", () => {
    const statement: Statement = buildHoldsSharedScrubPlaceholderSql(
      "ifNull(llmUserEmail, '')",
    );

    expect(statement.query).toBe(
      "(position(ifNull(llmUserEmail, ''), {p0:String}) > 0 OR position(ifNull(llmUserEmail, ''), {p1:String}) > 0)",
    );
    expect(params(statement)).toEqual([
      SCRUB_REDACTED_PLACEHOLDER,
      SCRUB_MASK_MARK,
    ]);
  });

  test("a token is matched by its pattern, bound", () => {
    const statement: Statement = buildHoldsScrubHashTokenSql("userId");

    expect(statement.query).toBe("match(userId, {p0:String})");
    expect(params(statement)).toEqual([SCRUB_HASH_TOKEN_SQL_PATTERN]);
  });

  test("anything a rule left is either of them", () => {
    const statement: Statement = buildHoldsScrubPlaceholderSql("userId");

    expect(statement.query).toBe(
      "((position(userId, {p0:String}) > 0 OR position(userId, {p1:String}) > 0) OR match(userId, {p2:String}))",
    );
  });

  test("a pseudonym is a token and nothing shared", () => {
    const statement: Statement = buildIsScrubPseudonymSql("userId");

    expect(statement.query).toBe(
      "(match(userId, {p0:String}) AND NOT (position(userId, {p1:String}) > 0 OR position(userId, {p2:String}) > 0))",
    );
  });

  test("the token pattern holds the values the check in the browser calls hashed", () => {
    const pattern: RegExp = new RegExp(SCRUB_HASH_TOKEN_SQL_PATTERN);

    for (const value of CORPUS) {
      const kind: ScrubPlaceholderKind | null = getScrubPlaceholderKind(value);
      const sqlHolds: boolean = pattern.test(value);

      if (kind === ScrubPlaceholderKind.Hashed) {
        expect([value, sqlHolds]).toEqual([value, true]);
      }

      if (kind === null) {
        expect([value, sqlHolds]).toEqual([value, false]);
      }
    }
  });
});
