import { describe, expect, test } from "@jest/globals";
import {
  CompiledScrubRule,
  ScrubEngineRule,
  compileScrubRule,
} from "../../../../../Server/Utils/Telemetry/ScrubEngine/CompiledScrubRule";
import LogScrubEngine from "../../../../../Server/Utils/Telemetry/ScrubEngine/LogScrubEngine";
import TraceScrubEngine, {
  readSpanUserValues,
} from "../../../../../Server/Utils/Telemetry/ScrubEngine/TraceScrubEngine";
import ScrubHashToken from "../../../../../Server/Utils/Telemetry/ScrubHashToken";
import {
  HashedUserPair,
  readHashedUserPair,
  readHashedUsersOfLogLine,
} from "../../../../../Server/Utils/SecurityEvent/UserVault/HashedUserPairs";
import {
  MAX_USER_VAULT_ENTRIES_PER_BATCH,
  MAX_USER_VAULT_LOG_LINES_PER_BATCH,
  SecurityUserVaultBatch,
} from "../../../../../Server/Utils/SecurityEvent/UserVault/SecurityUserVaultWriter";
import { JSONObject } from "../../../../../Types/JSON";
import LogScrubAction from "../../../../../Types/Log/LogScrubAction";
import LogScrubField from "../../../../../Types/Log/LogScrubField";
import LogScrubPatternType from "../../../../../Types/Log/LogScrubPatternType";
import ObjectID from "../../../../../Types/ObjectID";
import TraceScrubField from "../../../../../Types/Trace/TraceScrubField";
import { googleAuditEntry } from "../../../../Utils/SecurityEvent/LogParsers/GoogleCloudAuditFixtures";

/*
 * WHAT THE SCRUB ENGINES KEEP FOR SECURITY EVENTS' USER VAULT (#10632).
 *
 * An ingest batch whose logs or traces Security Events reads, and whose
 * rules hash, hands the engines its user batch; the engines tell it what
 * the places Security Events reads a user held before the rules and what
 * the rules left. The batch keeps a user only where its token is worked
 * out of it again with the project's key, and for a log line only where
 * Security Events' own log parsers read a user. Run here through the real
 * engines and parsers, with the project's real tokens:
 *
 *   - a span's enduser.id and user.id and an AI call's user, hashed by an
 *     Email, a Named Attributes or a custom rule, whole or in part;
 *   - a cloud audit log's principal and an SSH sign-in's account in a log
 *     line;
 *   - and never: what Redact or Mask left, an email hashed anywhere else
 *     (a URL, a message, a line the scan does not read), a token a sender
 *     wrote, a value with two tokens - nor past the batch's bounds.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10632000-0000-4000-8000-0000000000a1",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "10632000-0000-4000-8000-0000000000a2",
);

function tokenOf(value: string, projectId: ObjectID = PROJECT_ID): string {
  return ScrubHashToken.ofValue({ projectId, value });
}

function rule(
  patternType: string,
  action: string,
  more: Partial<ScrubEngineRule> = {},
): CompiledScrubRule {
  const compiled: CompiledScrubRule | null = compileScrubRule({
    _id: "10632000-0000-4000-8000-0000000000f1",
    projectId: PROJECT_ID,
    patternType,
    scrubAction: action,
    ...more,
  });

  expect(compiled).not.toBeNull();

  return compiled!;
}

const EMAIL_HASH_SPANS: CompiledScrubRule = rule(
  LogScrubPatternType.Email,
  LogScrubAction.Hash,
  { fieldsToScrub: TraceScrubField.All },
);
const EMAIL_HASH_LOGS: CompiledScrubRule = rule(
  LogScrubPatternType.Email,
  LogScrubAction.Hash,
  { fieldsToScrub: LogScrubField.Both },
);

function newBatch(signal: "log" | "trace"): SecurityUserVaultBatch {
  return new SecurityUserVaultBatch({ projectId: PROJECT_ID, signal });
}

function kept(batch: SecurityUserVaultBatch): Record<string, string> {
  const entries: Record<string, string> = {};

  for (const entry of batch.getEntries()) {
    entries[entry.token] = entry.user;
  }

  return entries;
}

function span(attributes: JSONObject, more: JSONObject = {}): JSONObject {
  return {
    projectId: PROJECT_ID.toString(),
    name: "POST /login",
    kind: "SPAN_KIND_SERVER",
    statusMessage: "",
    attributes: { "http.route": "/login", ...attributes },
    events: [],
    links: [],
    ...more,
  };
}

function scrubSpan(
  row: JSONObject,
  rules: Array<CompiledScrubRule>,
  batch: SecurityUserVaultBatch | null,
): JSONObject {
  return TraceScrubEngine.scrubSpan(row, rules, null, {
    countValues: false,
    hashedUsers: batch,
  });
}

function logRow(body: string, attributes: JSONObject = {}): JSONObject {
  return {
    projectId: PROJECT_ID.toString(),
    body,
    severityText: "INFO",
    attributes,
  };
}

function scrubLog(
  row: JSONObject,
  rules: Array<CompiledScrubRule>,
  batch: SecurityUserVaultBatch | null,
): JSONObject {
  return LogScrubEngine.scrubLog(row, rules, null, {
    countValues: false,
    hashedUsers: batch,
  });
}

function copy(row: JSONObject): JSONObject {
  return JSON.parse(JSON.stringify(row)) as JSONObject;
}

describe("a token's user, worked out of a value before and after the rules", () => {
  test("the whole value", () => {
    expect(
      readHashedUserPair({
        projectId: PROJECT_ID,
        before: "mallory@acme.com",
        after: tokenOf("mallory@acme.com"),
      }),
    ).toEqual({ token: tokenOf("mallory@acme.com"), user: "mallory@acme.com" });
  });

  test("a part of it, with the rest of the value its own", () => {
    expect(
      readHashedUserPair({
        projectId: PROJECT_ID,
        before: "auth0|5f7c8ec7c33c",
        after: `auth0|${tokenOf("5f7c8ec7c33c")}`,
      }),
    ).toEqual({ token: tokenOf("5f7c8ec7c33c"), user: "5f7c8ec7c33c" });
  });

  /*
   * #10935: an Email Address Hash rule hashes an address written in a
   * percent-encoded URL as the address it reads as, so its token is the
   * plain address's: the vault keeps that address as the user.
   */
  test("an email address a Hash rule read decoded, kept as the address it reads as", () => {
    expect(
      readHashedUserPair({
        projectId: PROJECT_ID,
        before: "mallory%40acme.com",
        after: tokenOf("mallory@acme.com"),
      }),
    ).toEqual({ token: tokenOf("mallory@acme.com"), user: "mallory@acme.com" });
    expect(
      readHashedUserPair({
        projectId: PROJECT_ID,
        before: "user=mallory%40acme.com",
        after: `user=${tokenOf("mallory@acme.com")}`,
      }),
    ).toEqual({ token: tokenOf("mallory@acme.com"), user: "mallory@acme.com" });
    // A token of neither reading is no pair.
    expect(
      readHashedUserPair({
        projectId: PROJECT_ID,
        before: "mallory%40acme.com",
        after: tokenOf("eve@acme.com"),
      }),
    ).toBeNull();
  });

  test("spaces around what a rule hashed are no part of the user", () => {
    expect(
      readHashedUserPair({
        projectId: PROJECT_ID,
        before: " mallory@acme.com ",
        after: ` ${tokenOf("mallory@acme.com")} `,
      }),
    ).toEqual({ token: tokenOf("mallory@acme.com"), user: "mallory@acme.com" });
  });

  test.each([
    [
      "another project's token",
      "mallory@acme.com",
      tokenOf("mallory@acme.com", OTHER_PROJECT_ID),
    ],
    [
      "a token that is not the value's",
      "mallory@acme.com",
      tokenOf("eve@acme.com"),
    ],
    [
      "values that do not line up",
      "auth0|5f7c8ec7c33c",
      `google|${tokenOf("5f7c8ec7c33c")}`,
    ],
    [
      "two tokens in one value",
      "a@acme.com,b@acme.com",
      `${tokenOf("a@acme.com")},${tokenOf("b@acme.com")}`,
    ],
    [
      "a token of the form before keys",
      "mallory@acme.com",
      "[HASHED:8c87b489]",
    ],
    ["what Redact left", "mallory@acme.com", "[REDACTED]"],
    ["what Mask left", "mallory@acme.com", "m***@***.com"],
    [
      "a token the sender wrote",
      tokenOf("eve@acme.com"),
      tokenOf("eve@acme.com"),
    ],
    ["nothing before", "", tokenOf("mallory@acme.com")],
  ])("never %s", (_label: string, before: string, after: string) => {
    expect(
      readHashedUserPair({ projectId: PROJECT_ID, before, after }),
    ).toBeNull();
  });
});

describe("a span's users", () => {
  test("are its enduser.id, its user.id and an AI call's user, as text", () => {
    expect(
      readSpanUserValues(
        span({ "enduser.id": "jane", "user.id": 42 }, { llmUserId: "dev" }),
      ),
    ).toEqual(["jane", "", "dev"]);
    expect(readSpanUserValues({})).toEqual(["", "", ""]);
  });

  test("an Email rule that hashes enduser.id: the user is kept, the span holds the token", () => {
    const batch: SecurityUserVaultBatch = newBatch("trace");
    const stored: JSONObject = scrubSpan(
      span({ "enduser.id": "mallory@acme.com" }),
      [EMAIL_HASH_SPANS],
      batch,
    );

    expect((stored["attributes"] as JSONObject)["enduser.id"]).toBe(
      tokenOf("mallory@acme.com"),
    );
    expect(kept(batch)).toEqual({
      [tokenOf("mallory@acme.com")]: "mallory@acme.com",
    });
  });

  test("a Named Attributes rule that hashes user.id, whatever it holds", () => {
    const batch: SecurityUserVaultBatch = newBatch("trace");

    scrubSpan(
      span({ "user.id": "u_48213" }),
      [
        rule(LogScrubPatternType.NamedKeys, LogScrubAction.Hash, {
          attributeKeys: ["user.id"],
          fieldsToScrub: TraceScrubField.Attributes,
        }),
      ],
      batch,
    );

    expect(kept(batch)).toEqual({ [tokenOf("u_48213")]: "u_48213" });
  });

  test("an AI call's user, as its user column holds it", () => {
    const batch: SecurityUserVaultBatch = newBatch("trace");
    const stored: JSONObject = scrubSpan(
      span({ "user.email": "dev@acme.com" }, { llmUserId: "dev@acme.com" }),
      [EMAIL_HASH_SPANS],
      batch,
    );

    expect(stored["llmUserId"]).toBe(tokenOf("dev@acme.com"));
    expect(kept(batch)).toEqual({ [tokenOf("dev@acme.com")]: "dev@acme.com" });
  });

  test("a custom rule that hashes part of a user id keeps that part", () => {
    const batch: SecurityUserVaultBatch = newBatch("trace");

    scrubSpan(
      span({ "enduser.id": "auth0|5f7c8ec7c33c" }),
      [
        rule(LogScrubPatternType.Custom, LogScrubAction.Hash, {
          customRegex: "[0-9a-f]{12}",
          fieldsToScrub: TraceScrubField.All,
        }),
      ],
      batch,
    );

    expect(kept(batch)).toEqual({ [tokenOf("5f7c8ec7c33c")]: "5f7c8ec7c33c" });
  });

  test.each([
    ["redacts", LogScrubAction.Redact],
    ["masks", LogScrubAction.Mask],
  ])(
    "an Email rule that %s keeps nothing",
    (_label: string, action: string) => {
      const batch: SecurityUserVaultBatch = newBatch("trace");

      scrubSpan(
        span({ "enduser.id": "mallory@acme.com" }),
        [
          rule(LogScrubPatternType.Email, action, {
            fieldsToScrub: TraceScrubField.All,
          }),
        ],
        batch,
      );

      expect(batch.size).toBe(0);
    },
  );

  test("an email hashed anywhere else in the span is never kept", () => {
    const batch: SecurityUserVaultBatch = newBatch("trace");
    const stored: JSONObject = scrubSpan(
      span(
        {
          "url.full": "https://acme.example/reset?email=eve@acme.com",
          "enduser.id": "u_48213",
        },
        { name: "send reset to bob@acme.com" },
      ),
      [EMAIL_HASH_SPANS],
      batch,
    );

    // The rule ran - the URL and the name hold tokens - but no user changed.
    expect(String((stored["attributes"] as JSONObject)["url.full"])).toContain(
      tokenOf("eve@acme.com"),
    );
    expect(String(stored["name"])).toContain(tokenOf("bob@acme.com"));
    expect(batch.size).toBe(0);
  });

  test("a token the sender wrote as a user is never kept", () => {
    const batch: SecurityUserVaultBatch = newBatch("trace");

    scrubSpan(
      span({
        "enduser.id": tokenOf("eve@acme.com"),
        "http.request.header.from": "eve@acme.com",
      }),
      [EMAIL_HASH_SPANS],
      batch,
    );

    expect(batch.size).toBe(0);
  });

  test("a span is scrubbed the same with the batch or without it", () => {
    const row: JSONObject = span(
      { "enduser.id": "mallory@acme.com", "user.id": "auth0|x" },
      { llmUserId: "dev@acme.com" },
    );

    expect(scrubSpan(copy(row), [EMAIL_HASH_SPANS], newBatch("trace"))).toEqual(
      scrubSpan(copy(row), [EMAIL_HASH_SPANS], null),
    );
  });

  test("a batch keeps each token once, and no more than its bound", () => {
    const batch: SecurityUserVaultBatch = newBatch("trace");

    for (let index: number = 0; index < 3; index++) {
      scrubSpan(
        span({ "enduser.id": "mallory@acme.com" }),
        [EMAIL_HASH_SPANS],
        batch,
      );
    }

    expect(batch.size).toBe(1);

    for (
      let index: number = 0;
      index < MAX_USER_VAULT_ENTRIES_PER_BATCH + 5;
      index++
    ) {
      batch.recordHashedUser({
        token: tokenOf(`user-${index}@acme.com`),
        user: `user-${index}@acme.com`,
      });
    }

    expect(batch.size).toBe(MAX_USER_VAULT_ENTRIES_PER_BATCH);
  });

  test("what is no token of today, or no user, is never kept", () => {
    const batch: SecurityUserVaultBatch = newBatch("trace");

    batch.recordHashedUser({ token: "[HASHED:8c87b489]", user: "a@acme.com" });
    batch.recordHashedUser({ token: tokenOf("x"), user: "[REDACTED]" });
    batch.recordHashedUser({ token: tokenOf("y"), user: "   " });
    batch.recordHashedUser({ token: tokenOf("z"), user: "x".repeat(600) });

    expect(batch.size).toBe(0);
  });
});

describe("a log line's users, as Security Events' log parsers read them", () => {
  function googleAuditLine(principal: string): string {
    return JSON.stringify(
      googleAuditEntry("activity", {
        authenticationInfo: { principalEmail: principal },
      }),
    );
  }

  test("a Google Cloud audit log's principal an Email rule hashed", () => {
    const batch: SecurityUserVaultBatch = newBatch("log");
    const stored: JSONObject = scrubLog(
      logRow(googleAuditLine("alice@example.com")),
      [EMAIL_HASH_LOGS],
      batch,
    );

    expect(String(stored["body"])).toContain(tokenOf("alice@example.com"));
    expect(String(stored["body"])).not.toContain("alice@example.com");
    expect(kept(batch)[tokenOf("alice@example.com")]).toBe("alice@example.com");
    expect(batch.logLinesReadAgain).toBe(1);
  });

  test("only the users the parser reads: a service account in the record's name is not one", () => {
    const batch: SecurityUserVaultBatch = newBatch("log");

    scrubLog(
      logRow(googleAuditLine("alice@example.com")),
      [EMAIL_HASH_LOGS],
      batch,
    );

    // The entry names app@acme-prod.iam.gserviceaccount.com as its resource.
    expect(
      Object.values(kept(batch)).includes(
        "app@acme-prod.iam.gserviceaccount.com",
      ),
    ).toBe(false);
  });

  test("an SSH sign-in's account a custom rule hashed", () => {
    const batch: SecurityUserVaultBatch = newBatch("log");

    scrubLog(
      logRow(
        "Nov 20 10:00:00 bastion sshd[4242]: Failed password for deploy from 203.0.113.7 port 52314 ssh2",
      ),
      [
        rule(LogScrubPatternType.Custom, LogScrubAction.Hash, {
          customRegex: "deploy",
          fieldsToScrub: LogScrubField.Body,
        }),
      ],
      batch,
    );

    expect(kept(batch)).toEqual({ [tokenOf("deploy")]: "deploy" });
  });

  test("an email hashed in a line the log scan never reads is never kept", () => {
    const batch: SecurityUserVaultBatch = newBatch("log");

    scrubLog(
      logRow("Sent the weekly digest to mallory@acme.com"),
      [EMAIL_HASH_LOGS],
      batch,
    );

    expect(batch.size).toBe(0);
    expect(batch.logLinesReadAgain).toBe(1);
  });

  test("an email hashed in a security line's message, but no user, is never kept", () => {
    const batch: SecurityUserVaultBatch = newBatch("log");

    // The account is root; the email is in the line's own words, not its user.
    scrubLog(
      logRow(
        "Nov 20 10:00:00 bastion sshd[4242]: Failed password for root from 203.0.113.7 port 52314 ssh2 (reported to soc@acme.com)",
      ),
      [EMAIL_HASH_LOGS],
      batch,
    );

    expect(batch.size).toBe(0);
  });

  test("a line the rules did not change is never read again", () => {
    const batch: SecurityUserVaultBatch = newBatch("log");

    scrubLog(
      logRow(
        "Nov 20 10:00:00 bastion sshd[4242]: Failed password for root from 203.0.113.7 port 52314 ssh2",
      ),
      [EMAIL_HASH_LOGS],
      batch,
    );

    expect(batch.logLinesReadAgain).toBe(0);
  });

  test("a line whose tokens the batch already kept is not read again", () => {
    const batch: SecurityUserVaultBatch = newBatch("log");

    for (let index: number = 0; index < 5; index++) {
      scrubLog(
        logRow(googleAuditLine("alice@example.com")),
        [EMAIL_HASH_LOGS],
        batch,
      );
    }

    expect(batch.logLinesReadAgain).toBe(1);
    expect(batch.size).toBeGreaterThanOrEqual(1);
  });

  test("a different line is read, even one whose token an earlier line held but did not name as its user", () => {
    const batch: SecurityUserVaultBatch = newBatch("log");

    // alice acts on bob's key: bob's email is in the record, not its user.
    scrubLog(
      logRow(
        JSON.stringify(
          googleAuditEntry("activity", {
            authenticationInfo: { principalEmail: "alice@example.com" },
            resourceName: "projects/-/serviceAccounts/bob@example.com",
          }),
        ),
      ),
      [EMAIL_HASH_LOGS],
      batch,
    );
    // Then bob acts himself.
    scrubLog(
      logRow(googleAuditLine("bob@example.com")),
      [EMAIL_HASH_LOGS],
      batch,
    );

    expect(batch.logLinesReadAgain).toBe(2);
    expect(kept(batch)[tokenOf("bob@example.com")]).toBe("bob@example.com");
    expect(kept(batch)[tokenOf("alice@example.com")]).toBe("alice@example.com");
  });

  test("a batch reads at most its bound of lines again", () => {
    const batch: SecurityUserVaultBatch = newBatch("log");

    for (
      let index: number = 0;
      index < MAX_USER_VAULT_LOG_LINES_PER_BATCH + 3;
      index++
    ) {
      batch.recordScrubbedLogLine({
        bodyBefore: `Sent the digest to user-${index}@acme.com`,
        attributesBefore: {},
        logRow: logRow(
          `Sent the digest to ${tokenOf(`user-${index}@acme.com`)}`,
        ),
      });
    }

    expect(batch.logLinesReadAgain).toBe(MAX_USER_VAULT_LOG_LINES_PER_BATCH);
  });

  test("a line is scrubbed the same with the batch or without it", () => {
    const row: JSONObject = logRow(googleAuditLine("alice@example.com"), {
      "client.address": "203.0.113.7",
    });

    expect(scrubLog(copy(row), [EMAIL_HASH_LOGS], newBatch("log"))).toEqual(
      scrubLog(copy(row), [EMAIL_HASH_LOGS], null),
    );
  });

  test("a line read into a different number of events pairs nothing", () => {
    const pairs: Array<HashedUserPair> = readHashedUsersOfLogLine({
      projectId: PROJECT_ID,
      // Before: no record at all; after: a sign-in naming a token.
      bodyBefore: "nothing to see here",
      attributesBefore: {},
      logRow: logRow(
        `Nov 20 10:00:00 bastion sshd[4242]: Failed password for ${tokenOf("root")} from 203.0.113.7 port 52314 ssh2`,
      ),
    });

    expect(pairs).toEqual([]);
  });
});
