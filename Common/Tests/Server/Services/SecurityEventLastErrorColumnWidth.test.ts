import { generateKeyPairSync } from "crypto";
import fs from "fs";
import path from "path";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DetectionRule from "../../../Models/DatabaseModels/DetectionRule";
import GoogleSecOpsConnection from "../../../Models/DatabaseModels/GoogleSecOpsConnection";
import { AddDetectionRuleAndGoogleSecOpsConnection1788000000000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1788000000000-AddDetectionRuleAndGoogleSecOpsConnection";
import { WidenSecurityEventLastErrorColumns1789800000000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1789800000000-WidenSecurityEventLastErrorColumns";
import SchemaMigrations from "../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import DetectionRuleService from "../../../Server/Services/DetectionRuleService";
import GoogleSecOpsConnectionService from "../../../Server/Services/GoogleSecOpsConnectionService";
import { REDACTED, redactLogString } from "../../../Server/Utils/LogRedaction";
import ConnectorErrorMessage, {
  MAX_CONNECTOR_ERROR_MESSAGE_LENGTH,
} from "../../../Server/Utils/SecurityEvent/ConnectorErrorMessage";
import GoogleSecOpsClient, {
  FetchLike,
  FetchResponseLike,
} from "../../../Server/Utils/SecurityEvent/GoogleSecOps/GoogleSecOpsClient";
import ColumnLength, {
  getMaxLengthFromTableColumnType,
} from "../../../Types/Database/ColumnLength";
import ColumnType from "../../../Types/Database/ColumnType";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { beforeAll, describe, expect, test } from "@jest/globals";

/*
 * GoogleSecOpsConnection.lastError and DetectionRule.lastError must stay
 * unbounded text. This file exists because narrowing either of them back
 * is not a cosmetic regression — it silently stops the connector polling
 * loops altogether.
 *
 * What happened: both columns were declared TableColumnType.LongText, i.e.
 * varchar(500), and DatabaseService.checkMaxLengthOfFields rejects any
 * string longer than a column's declared max with a BadDataException. The
 * poller's catch block writes { lastPolledAt, lastError } to record a
 * failed poll, and a Google SecOps client error is a short prefix plus an
 * echo of whatever Google sent back — comfortably past the bound. So the
 * write that was recording the failure became a second failure, threw out
 * of the catch block, and took pollAllDueConnections down with it:
 * nothing stamped, every remaining connection in that tick skipped,
 * repeated every minute forever. The customer's row read lastPolledAt =
 * null AND lastError = null, because the two columns meant to explain the
 * outage were exactly the ones the outage prevented from being written.
 * DetectionRuleEvaluator had the identical pattern on DetectionRule
 * .lastError, where ClickHouse errors echo the whole compiled query.
 *
 * THE CURRENT CONTRACT — and why the old cap is gone. GoogleSecOpsClient
 * used to clip every echoed body with `.slice(0, BODY_ECHO_LIMIT)`, and an
 * earlier version of this file leaned on that cap as its bound: read the
 * number out of the client, assert the stored value was prefix + exactly
 * that many characters. That cap was deliberately removed. The echo sites
 * now run the body through the client's own redactErrorBody() (which
 * decodes nested JSON before handing it to redactLogString /
 * redactLogValue), which strips credentials but truncates nothing — an
 * operator gets the WHOLE redacted diagnostic. GoogleSecOpsPoller stores it
 * with ConnectorErrorMessage.toMessage(error, { truncate: false }), opting
 * out of the connector clamp entirely, which is only safe because
 * lastError is unbounded `text`. So the property that makes echoing a
 * customer-supplied body safe is REDACTION, not length, and the property
 * that makes storing it safe is that the column has no maximum at all.
 *
 * Five things have to line up, and a regression in any one of them brings
 * the silent outage — or a stored credential — back:
 *   1. both entities declare VeryLongText / `text` with no length, so
 *      getMaxLengthFromTableColumnType returns undefined and the length
 *      check cannot reject a stored error at all,
 *   2. the widest message the producers can actually emit really is
 *      accepted — pinned end to end, from every one of the client's own
 *      failure paths through ConnectorErrorMessage.toMessage to the real
 *      DatabaseService length check, with the poller's own
 *      { truncate: false } storing it whole,
 *   3. every echoed body is redacted, so a private_key / client_secret /
 *      token in a response body — including one buried in nested JSON
 *      inside an error message — never reaches the column verbatim,
 *   4. the migration widens the live Postgres columns with ALTER COLUMN
 *      ... TYPE text rather than DROP + ADD, which would discard every
 *      error already stored, and
 *   5. the migration is registered in SchemaMigrations/Index.ts — an
 *      unregistered migration never runs, so production would stay on
 *      varchar(500) while every entity-level assertion here still passed.
 *      That combination is precisely how this failure comes back.
 *
 * Pure metadata, source text, mocked query runners and an injected fetch —
 * no Postgres and no network anywhere.
 */

const SCHEMA_MIGRATIONS_DIRECTORY: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "Server",
  "Infrastructure",
  "Postgres",
  "SchemaMigrations",
);

const MIGRATION_SOURCE: string = fs.readFileSync(
  path.join(
    SCHEMA_MIGRATIONS_DIRECTORY,
    "1789800000000-WidenSecurityEventLastErrorColumns.ts",
  ),
  "utf8",
);

const MIGRATIONS_INDEX_SOURCE: string = fs.readFileSync(
  path.join(SCHEMA_MIGRATIONS_DIRECTORY, "Index.ts"),
  "utf8",
);

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

/*
 * The real token endpoint, not an example.com stand-in: the client now
 * refuses a token_uri outside Google's hosts, because that URL is
 * customer-supplied and whatever answers it is echoed (redacted, and in
 * full) straight into lastError. Nothing here reaches the network — the
 * fetch is injected — so the host only has to satisfy that check.
 */
const SERVICE_ACCOUNT_JSON: string = JSON.stringify({
  client_email: "poller@example.iam.gserviceaccount.com",
  private_key: privateKey,
  token_uri: "https://oauth2.googleapis.com/token",
});

const INSTANCE: string =
  "projects/my-project/locations/us/instances/3f0a-instance";

/*
 * The client no longer clips what it echoes, so the width of a stored error
 * is the width of the body Google sent. This is deliberately FAR wider than
 * MAX_CONNECTOR_ERROR_MESSAGE_LENGTH — four times it — for two reasons:
 * the resulting message is one the connector clamp WOULD cut if the poller
 * had not opted out, so the untruncated-storage path is genuinely
 * exercised rather than trivially satisfied, and it is far past the
 * varchar(500) bound whose reappearance is the outage this file guards.
 * It is a local constant on purpose: nothing in the client bounds it any
 * more, so there is nothing left to read out of the client.
 */
const OVERSIZED_RESPONSE_BODY_LENGTH: number =
  MAX_CONNECTOR_ERROR_MESSAGE_LENGTH * 4;

const OVERSIZED_RESPONSE_BODY: string = "x".repeat(
  OVERSIZED_RESPONSE_BODY_LENGTH,
);

/*
 * Credential-shaped values, in the shapes a token endpoint or a Chronicle
 * error envelope actually carries them. None of these is real; what matters
 * is that each one is the sort of value the redactor must never let through
 * into a column an operator reads in the dashboard.
 */
const LEAKED_CLIENT_SECRET: string = "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9a3b";
const LEAKED_ACCESS_TOKEN: string =
  "ya29.c.b0Aaekm1J7NotARealTokenValue0123456789";
const LEAKED_PRIVATE_KEY_BODY: string =
  "MIIBVgIBADANBgkqhkiG9w0BAQEFAASCAUAwggE8AgEAAkEANotARealKey";
const LEAKED_PRIVATE_KEY_PEM: string = `-----BEGIN PRIVATE KEY-----\n${LEAKED_PRIVATE_KEY_BODY}\n-----END PRIVATE KEY-----\n`;

const LEAKED_SECRETS: Array<string> = [
  LEAKED_CLIENT_SECRET,
  LEAKED_ACCESS_TOKEN,
  LEAKED_PRIVATE_KEY_BODY,
];

/*
 * Credentials sitting in their own fields, which is what an OAuth error
 * response or a misconfigured proxy echo looks like.
 */
const FLAT_CREDENTIAL_BODY: string = JSON.stringify({
  error: {
    code: 403,
    status: "PERMISSION_DENIED",
    message: "The caller does not have permission.",
    client_secret: LEAKED_CLIENT_SECRET,
    access_token: LEAKED_ACCESS_TOKEN,
    private_key: LEAKED_PRIVATE_KEY_PEM,
  },
});

/*
 * The case commit c0f9e0c2db fixed: the credential JSON is a STRING inside
 * the error message, so its key quotes arrive escaped. A purely textual
 * redactor never sees `"client_secret":` in that form and walks straight
 * past it — which is why redactErrorBody decodes the outer JSON before
 * redacting. The test below asserts both halves of that: the raw textual
 * pass really is fooled, and the client's echo is not.
 */
const NESTED_CREDENTIAL_BODY: string = JSON.stringify({
  error: {
    code: 400,
    status: "INVALID_ARGUMENT",
    message: JSON.stringify({
      client_secret: LEAKED_CLIENT_SECRET,
      access_token: LEAKED_ACCESS_TOKEN,
      private_key: LEAKED_PRIVATE_KEY_PEM,
    }),
  },
});

function makeFetch(
  responses: Array<{ status: number; body: string }>,
): FetchLike {
  let callIndex: number = 0;

  return (): Promise<FetchResponseLike> => {
    const response: { status: number; body: string } =
      responses[Math.min(callIndex, responses.length - 1)]!;
    callIndex++;

    return Promise.resolve({
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      text: (): Promise<string> => {
        return Promise.resolve(response.body);
      },
    });
  };
}

function successfulTokenResponse(): { status: number; body: string } {
  return {
    status: 200,
    body: JSON.stringify({ access_token: "test-token", expires_in: 3600 }),
  };
}

/*
 * Drives the REAL client so the error under test is the one the poller
 * would actually catch, not a hand-written approximation of it.
 */
async function thrownClientError(
  responses: Array<{ status: number; body: string }>,
): Promise<Error> {
  const client: GoogleSecOpsClient = new GoogleSecOpsClient({
    region: "us",
    instanceResourceName: INSTANCE,
    serviceAccountJson: SERVICE_ACCOUNT_JSON,
    fetchImplementation: makeFetch(responses),
  });

  try {
    await client.fetchDetectionAlerts({
      startTime: new Date("2026-08-21T09:00:00.000Z"),
      endTime: new Date("2026-08-21T10:00:00.000Z"),
    });
  } catch (error) {
    return error as Error;
  }

  throw new Error("Expected GoogleSecOpsClient to throw, but it did not");
}

/*
 * Exactly what GoogleSecOpsPoller.ts writes into lastError: the connector
 * clamp explicitly disabled, then one more redaction pass. Both halves are
 * reproduced here rather than approximated, because "the value the poller
 * stores fits the column" is the whole claim of this file.
 */
function storedLastError(error: Error): string {
  return redactLogString(
    ConnectorErrorMessage.toMessage(error, { truncate: false }),
  );
}

interface LastErrorColumn {
  label: string;
  table: string;
  target: unknown;
  propertyName: string;
  newInstance: () => DatabaseBaseModel;
  /*
   * Runs the real DatabaseService length check over a row whose lastError
   * is `value`. This is the exact call the poller's recovery write makes
   * on its way to the database.
   */
  checkLastError: (value: string) => void;
  /*
   * A sibling column on the same model that is still declared LongText —
   * the shape lastError used to have. Used to prove the length check
   * really does reject at 500, so the tests above are falsifiable.
   */
  longTextSibling: string;
  checkLongTextSibling: (value: string) => void;
}

const LAST_ERROR_COLUMNS: Array<LastErrorColumn> = [
  {
    label: "GoogleSecOpsConnection.lastError",
    table: "GoogleSecOpsConnection",
    target: GoogleSecOpsConnection,
    propertyName: "lastError",
    newInstance: (): DatabaseBaseModel => {
      return new GoogleSecOpsConnection();
    },
    checkLastError: (value: string): void => {
      const connection: GoogleSecOpsConnection = new GoogleSecOpsConnection();
      connection.lastError = value;
      GoogleSecOpsConnectionService["checkMaxLengthOfFields"](connection);
    },
    longTextSibling: "cursor",
    checkLongTextSibling: (value: string): void => {
      const connection: GoogleSecOpsConnection = new GoogleSecOpsConnection();
      connection.cursor = value;
      GoogleSecOpsConnectionService["checkMaxLengthOfFields"](connection);
    },
  },
  {
    label: "DetectionRule.lastError",
    table: "DetectionRule",
    target: DetectionRule,
    propertyName: "lastError",
    newInstance: (): DatabaseBaseModel => {
      return new DetectionRule();
    },
    checkLastError: (value: string): void => {
      const rule: DetectionRule = new DetectionRule();
      rule.lastError = value;
      DetectionRuleService["checkMaxLengthOfFields"](rule);
    },
    longTextSibling: "description",
    checkLongTextSibling: (value: string): void => {
      const rule: DetectionRule = new DetectionRule();
      rule.description = value;
      DetectionRuleService["checkMaxLengthOfFields"](rule);
    },
  },
];

function columnArgs(column: LastErrorColumn): ColumnMetadataArgs {
  const args: ColumnMetadataArgs | undefined = getMetadataArgsStorage()
    .columns.filter((candidate: ColumnMetadataArgs) => {
      return candidate.target === column.target;
    })
    .find((candidate: ColumnMetadataArgs) => {
      return candidate.propertyName === column.propertyName;
    });

  if (!args) {
    throw new Error(`${column.label} has no TypeORM @Column metadata`);
  }

  return args;
}

function metadataFor(column: LastErrorColumn): TableColumnMetadata {
  return column.newInstance().getTableColumnMetadata(column.propertyName);
}

function makeQueryRunner(): { runner: QueryRunner; query: jest.Mock } {
  const query: jest.Mock = jest.fn().mockResolvedValue(undefined);
  return { runner: { query } as unknown as QueryRunner, query };
}

function executedSql(query: jest.Mock): Array<string> {
  return query.mock.calls.map((call: Array<unknown>) => {
    return String(call[0]);
  });
}

describe("security-event lastError entity declarations", () => {
  test.each(LAST_ERROR_COLUMNS)(
    "$label is a text column, not a bounded varchar",
    (column: LastErrorColumn) => {
      // ColumnType.VeryLongText is what makes TypeORM emit Postgres `text`.
      expect(columnArgs(column).options.type).toBe(ColumnType.VeryLongText);
      expect(ColumnType.VeryLongText).toBe("text");
    },
  );

  test.each(LAST_ERROR_COLUMNS)(
    "$label declares no length — a length on a text column is what regenerates drift",
    (column: LastErrorColumn) => {
      expect(columnArgs(column).options.length).toBeUndefined();
    },
  );

  test.each(LAST_ERROR_COLUMNS)(
    "$label stays nullable, so a connector that has never failed stores nothing",
    (column: LastErrorColumn) => {
      expect(columnArgs(column).options.nullable).toBe(true);
    },
  );

  test.each(LAST_ERROR_COLUMNS)(
    "$label reports TableColumnType.VeryLongText",
    (column: LastErrorColumn) => {
      expect(metadataFor(column).type).toBe(TableColumnType.VeryLongText);
    },
  );

  test.each(LAST_ERROR_COLUMNS)(
    "$label has no max length, so checkMaxLengthOfFields cannot reject a value written to it",
    (column: LastErrorColumn) => {
      /*
       * The invariant the outage turned on. checkMaxLengthOfFields only
       * validates a column when getMaxLengthFromTableColumnType returns a
       * number; undefined means the guard is skipped entirely, so the
       * poller's own error-recording write can never be the thing that
       * throws. Back when this was LongText it returned 500, the write
       * threw, and the poll loop died with it.
       */
      expect(
        getMaxLengthFromTableColumnType(metadataFor(column).type),
      ).toBeUndefined();
    },
  );

  test.each(LAST_ERROR_COLUMNS)(
    "$label stays readable on relation queries and optional",
    (column: LastErrorColumn) => {
      const metadata: TableColumnMetadata = metadataFor(column);
      expect(metadata.canReadOnRelationQuery).toBe(true);
      expect(metadata.required).toBeFalsy();
    },
  );

  test("the old LongText declaration really was the 500-character bound", () => {
    /*
     * Guards the premise of the whole fix. If LongText ever stopped
     * meaning 500, every "this used to overflow" claim below would be
     * describing a bound that no longer exists.
     */
    expect(getMaxLengthFromTableColumnType(TableColumnType.LongText)).toBe(
      ColumnLength.LongText,
    );
    expect(ColumnLength.LongText).toBe(500);
  });
});

describe("the widest error the producers can emit is storable", () => {
  let tokenExchangeError: Error;
  let alertsFetchError: Error;
  let widestClientError: Error;

  beforeAll(async () => {
    // Fails at the JWT-bearer token exchange: the first echo site.
    tokenExchangeError = await thrownClientError([
      { status: 503, body: OVERSIZED_RESPONSE_BODY },
    ]);

    // Token succeeds, the alerts call fails: the second echo site.
    alertsFetchError = await thrownClientError([
      successfulTokenResponse(),
      { status: 500, body: OVERSIZED_RESPONSE_BODY },
    ]);

    widestClientError =
      alertsFetchError.message.length >= tokenExchangeError.message.length
        ? alertsFetchError
        : tokenExchangeError;
  });

  test("each HTTP failure echoes the WHOLE response body, with nothing clipped off the end", () => {
    /*
     * What replaced the cap. There is no longer a number to read out of
     * the client and compare against; the assertion is that the body the
     * client was handed survives into the message in one piece, tail
     * included. A `.slice(0, N)` reintroduced at either site fails here,
     * because the last character of the body would stop being the last
     * character of the message.
     */
    for (const error of [tokenExchangeError, alertsFetchError]) {
      expect(error.message).toContain(OVERSIZED_RESPONSE_BODY);
      expect(error.message.endsWith(OVERSIZED_RESPONSE_BODY)).toBe(true);

      // ...and ahead of it, a non-empty prefix naming the HTTP status.
      const prefix: string = error.message.slice(
        0,
        error.message.length - OVERSIZED_RESPONSE_BODY_LENGTH,
      );
      expect(prefix.length).toBeGreaterThan(0);
      expect(prefix).toContain("HTTP");
    }
  });

  test("the message width tracks the body width — nothing bounds it but the body itself", async () => {
    /*
     * Falsifies the test above from the other side. Hand the same failure
     * path a body twice as wide and the message grows by exactly the extra
     * characters: no cap, no ceiling, no rounding. Any truncation
     * anywhere on this path — in the client, in the redactor, in the
     * exception — would make the two messages converge instead.
     */
    const narrow: Error = await thrownClientError([
      successfulTokenResponse(),
      { status: 500, body: OVERSIZED_RESPONSE_BODY },
    ]);
    const wide: Error = await thrownClientError([
      successfulTokenResponse(),
      { status: 500, body: OVERSIZED_RESPONSE_BODY + OVERSIZED_RESPONSE_BODY },
    ]);

    expect(wide.message.length - narrow.message.length).toBe(
      OVERSIZED_RESPONSE_BODY_LENGTH,
    );
  });

  test("the widest client error overflows the bound lastError used to carry", () => {
    /*
     * This is the string that killed the poller. Prefix + echoed body is
     * larger than varchar(500), so writing it back onto the row raised
     * BadDataException from inside the catch block. It is also past the
     * connector clamp, which is exactly why the poller opts out of that
     * clamp and why the column has to be unbounded rather than merely
     * wider.
     */
    const oldMaxLength: number = getMaxLengthFromTableColumnType(
      TableColumnType.LongText,
    )!;

    expect(widestClientError.message.length).toBeGreaterThan(oldMaxLength);

    // The overflow is not marginal: the echoed body alone dwarfs the old column.
    expect(OVERSIZED_RESPONSE_BODY_LENGTH).toBeGreaterThan(oldMaxLength);
    expect(widestClientError.message.length).toBeGreaterThan(
      MAX_CONNECTOR_ERROR_MESSAGE_LENGTH,
    );
  });

  test("the poller's { truncate: false } stores the widest client error whole", () => {
    /*
     * GoogleSecOpsPoller writes ConnectorErrorMessage.toMessage(error,
     * { truncate: false }). The operator is meant to get the complete
     * redacted diagnostic, so the returned value must be the message
     * unchanged — no clamp, and specifically no "... (truncated)" marker,
     * whose presence would mean part of the diagnostic was thrown away.
     */
    const stored: string = ConnectorErrorMessage.toMessage(widestClientError, {
      truncate: false,
    });

    expect(stored).toBe(widestClientError.message);
    expect(stored).not.toContain("... (truncated)");
    expect(stored.length).toBeGreaterThan(MAX_CONNECTOR_ERROR_MESSAGE_LENGTH);
  });

  test("the DEFAULT toMessage still clamps, so the cap stays pinned for callers that use it", () => {
    /*
     * Opting out is per call site. Every caller that does NOT pass
     * { truncate: false } must still be clamped to
     * MAX_CONNECTOR_ERROR_MESSAGE_LENGTH with the marker, or a narrow
     * destination somewhere else in the codebase silently starts
     * overflowing.
     */
    for (const error of [
      tokenExchangeError,
      alertsFetchError,
      new Error("y".repeat(MAX_CONNECTOR_ERROR_MESSAGE_LENGTH * 10)),
    ]) {
      const clamped: string = ConnectorErrorMessage.toMessage(error);

      expect(clamped.length).toBe(MAX_CONNECTOR_ERROR_MESSAGE_LENGTH);
      expect(clamped.endsWith("... (truncated)")).toBe(true);
    }
  });

  test.each(LAST_ERROR_COLUMNS)(
    "$label accepts the widest client error stored WHOLE — the real length check does not reject it",
    (column: LastErrorColumn) => {
      /*
       * The end-to-end guard: the same value the poller would store —
       * untruncated and redacted, exactly as GoogleSecOpsPoller builds it
       * — run through the same DatabaseService validation that used to
       * throw. Pre-fix (LongText/varchar(500)) this raised
       * BadDataException, the throw escaped pollAllDueConnections, and the
       * tick died.
       */
      const stored: string = storedLastError(widestClientError);

      expect(stored.length).toBeGreaterThan(MAX_CONNECTOR_ERROR_MESSAGE_LENGTH);
      expect(() => {
        return column.checkLastError(stored);
      }).not.toThrow();
    },
  );

  test.each(LAST_ERROR_COLUMNS)(
    "$longTextSibling on the same model still rejects that very string, so the check is real",
    (column: LastErrorColumn) => {
      /*
       * Falsifies the test above. checkMaxLengthOfFields is not a no-op:
       * hand the identical string to a sibling column that is still
       * LongText and it throws exactly as lastError used to. The only
       * thing that changed is the declared column type.
       */
      const stored: string = storedLastError(widestClientError);

      expect(
        getMaxLengthFromTableColumnType(
          column.newInstance().getTableColumnMetadata(column.longTextSibling)
            .type,
        ),
      ).toBe(ColumnLength.LongText);

      expect(() => {
        return column.checkLongTextSibling(stored);
      }).toThrow(`${column.longTextSibling} length cannot be more than`);
    },
  );

  test.each(LAST_ERROR_COLUMNS)(
    "$label accepts a clamped ClickHouse-sized error too",
    (column: LastErrorColumn) => {
      /*
       * The evaluator's side: a ClickHouse error echoes the whole
       * compiled query, so it has no natural bound. That caller keeps the
       * default clamp, which cuts it to exactly
       * MAX_CONNECTOR_ERROR_MESSAGE_LENGTH — still double the old
       * varchar(500), so widening the column is what makes even the
       * clamped value storable.
       */
      const clickhouseError: Error = new Error(
        `Code: 47. DB::Exception: Missing columns while processing query: ${"SELECT ".repeat(
          MAX_CONNECTOR_ERROR_MESSAGE_LENGTH,
        )}`,
      );

      const stored: string = ConnectorErrorMessage.toMessage(clickhouseError);

      expect(stored.length).toBe(MAX_CONNECTOR_ERROR_MESSAGE_LENGTH);
      expect(stored.length).toBeGreaterThan(
        getMaxLengthFromTableColumnType(TableColumnType.LongText)!,
      );
      expect(() => {
        return column.checkLastError(stored);
      }).not.toThrow();
    },
  );
});

interface InBandFailure {
  label: string;
  /* The 200 body Chronicle answers with. */
  body: string;
  /* Everything the client's message carries ahead of the echoed text. */
  prefix: string;
  /*
   * Whether this path echoes the body it could not read. An empty body has
   * nothing to echo, and a body that is not JSON at all is reported by
   * kind rather than quoted — so those two are prefix-only, and pinning
   * that distinction is what stops a future change from quietly turning a
   * fixed string into an unbounded echo without a test noticing.
   */
  echoesBody: boolean;
}

/*
 * The failures Chronicle reports on an HTTP 200. They are not covered by the
 * two HTTP paths above because before the client learned to read the stream
 * envelope they did not reach lastError at all — an unreadable body was
 * reported as a healthy poll that found nothing. Each of them now echoes the
 * text it could not read, in full, which is a new way for the stored value
 * to grow, so each has to clear the same end-to-end path: the poller's
 * untruncated toMessage and the real length check on both columns.
 */
const IN_BAND_FAILURES: Array<InBandFailure> = [
  {
    label: "an empty body",
    body: "",
    prefix: "Google SecOps alerts fetch returned an empty body.",
    echoesBody: false,
  },
  {
    label: "a body that is not JSON",
    body: `<html>${OVERSIZED_RESPONSE_BODY}</html>`,
    prefix: "Google SecOps alerts fetch returned a non-JSON body.",
    echoesBody: false,
  },
  {
    label: "a shape the parser does not recognize",
    body: JSON.stringify([{ somethingElseEntirely: OVERSIZED_RESPONSE_BODY }]),
    prefix:
      "Google SecOps alerts fetch returned an unrecognized response shape: ",
    echoesBody: true,
  },
  {
    label: "a query Chronicle rejected in band",
    body: JSON.stringify([
      {
        validSnapshotQuery: false,
        queryValidationErrors: [{ message: OVERSIZED_RESPONSE_BODY }],
      },
    ]),
    prefix:
      "Google SecOps alerts query was rejected by Chronicle on an HTTP 200: ",
    echoesBody: true,
  },
];

describe("the failures Chronicle reports on an HTTP 200 are storable too", () => {
  test.each(IN_BAND_FAILURES)(
    "$label is echoed in full and stored whole",
    async (failure: InBandFailure) => {
      const error: Error = await thrownClientError([
        successfulTokenResponse(),
        { status: 200, body: failure.body },
      ]);

      expect(error.message.startsWith(failure.prefix)).toBe(true);

      if (failure.echoesBody) {
        /*
         * The echo is complete, not clipped — same contract as the HTTP
         * paths, and the same reason the column has to be unbounded: this
         * message is already past MAX_CONNECTOR_ERROR_MESSAGE_LENGTH.
         */
        expect(error.message).toContain(OVERSIZED_RESPONSE_BODY);
        expect(error.message.length).toBeGreaterThan(
          MAX_CONNECTOR_ERROR_MESSAGE_LENGTH,
        );
      } else {
        // Reported by kind, so the body never widens the stored value at all.
        expect(error.message).toBe(failure.prefix);
      }

      /*
       * The poller opts out of the clamp, so lastError carries the whole
       * thing however wide it is.
       */
      const stored: string = ConnectorErrorMessage.toMessage(error, {
        truncate: false,
      });

      expect(stored).toBe(error.message);
      expect(stored).not.toContain("... (truncated)");

      for (const column of LAST_ERROR_COLUMNS) {
        expect(() => {
          return column.checkLastError(storedLastError(error));
        }).not.toThrow();
      }
    },
  );
});

/*
 * Redaction is what makes echoing a customer-supplied body safe now that
 * nothing clips it. The body is attacker-influenced (a token endpoint that
 * mirrors the request, a proxy that dumps headers) and, worse, routinely
 * carries the tenant's OWN credentials back — and lastError is rendered in
 * the dashboard and swept up by support bundles. So the property that used
 * to be "at most 500 characters reach the column" is now "no credential
 * reaches the column at all", and it has to hold on every path that echoes.
 */
interface RedactedEchoCase {
  label: string;
  responses: Array<{ status: number; body: string }>;
}

const REDACTED_ECHO_CASES: Array<RedactedEchoCase> = [
  {
    label: "the token exchange echoing credential fields",
    responses: [{ status: 400, body: FLAT_CREDENTIAL_BODY }],
  },
  {
    label: "the token exchange echoing credentials nested inside a message",
    responses: [{ status: 400, body: NESTED_CREDENTIAL_BODY }],
  },
  {
    label: "the alerts fetch echoing credential fields",
    responses: [
      successfulTokenResponse(),
      { status: 403, body: FLAT_CREDENTIAL_BODY },
    ],
  },
  {
    label: "the alerts fetch echoing credentials nested inside a message",
    responses: [
      successfulTokenResponse(),
      { status: 403, body: NESTED_CREDENTIAL_BODY },
    ],
  },
  {
    label: "an unrecognized HTTP 200 shape echoing credential fields",
    responses: [
      successfulTokenResponse(),
      {
        status: 200,
        body: JSON.stringify({
          client_secret: LEAKED_CLIENT_SECRET,
          access_token: LEAKED_ACCESS_TOKEN,
          private_key: LEAKED_PRIVATE_KEY_PEM,
        }),
      },
    ],
  },
  {
    label: "an in-band query rejection echoing credentials nested in a message",
    responses: [
      successfulTokenResponse(),
      {
        status: 200,
        body: JSON.stringify([
          {
            validSnapshotQuery: false,
            queryValidationErrors: [
              {
                message: JSON.stringify({
                  client_secret: LEAKED_CLIENT_SECRET,
                  access_token: LEAKED_ACCESS_TOKEN,
                  private_key: LEAKED_PRIVATE_KEY_PEM,
                }),
              },
            ],
          },
        ]),
      },
    ],
  },
];

describe("the echoed body is redacted, which is what replaced the cap", () => {
  test("a purely textual pass really is fooled by nested credential JSON", () => {
    /*
     * The premise behind redactErrorBody decoding the outer JSON first
     * (commit c0f9e0c2db). Inside a JSON string the credential's key quotes
     * arrive escaped as \" , which no textual rule keyed on `"key":` can
     * match — so running redactLogString over the raw body leaves the
     * secret in the clear. If this ever stops being true the decode step
     * has become redundant, and the case below stops proving anything.
     */
    expect(redactLogString(NESTED_CREDENTIAL_BODY)).toContain(
      LEAKED_CLIENT_SECRET,
    );
  });

  test.each(REDACTED_ECHO_CASES)(
    "$label never puts the credential in lastError",
    async (echoCase: RedactedEchoCase) => {
      const error: Error = await thrownClientError(echoCase.responses);
      const stored: string = storedLastError(error);

      for (const secret of LEAKED_SECRETS) {
        expect(error.message).not.toContain(secret);
        expect(stored).not.toContain(secret);
      }

      /*
       * Falsifiable: the body really did reach the message, and the reason
       * the secret is missing from it is that the redactor replaced the
       * value — not that the client quietly dropped the whole echo, which
       * would satisfy "does not contain" while destroying the diagnostic
       * this column exists to carry.
       */
      expect(error.message).toContain(REDACTED);
      expect(stored).toContain(REDACTED);

      // And the redacted echo is still stored whole, on an unbounded column.
      for (const column of LAST_ERROR_COLUMNS) {
        expect(() => {
          return column.checkLastError(stored);
        }).not.toThrow();
      }
    },
  );
});

describe("WidenSecurityEventLastErrorColumns1789800000000 SQL contract", () => {
  const migration: WidenSecurityEventLastErrorColumns1789800000000 =
    new WidenSecurityEventLastErrorColumns1789800000000();

  test("up() widens both tables' lastError to text", async () => {
    const { runner, query } = makeQueryRunner();
    await migration.up(runner);

    const statements: Array<string> = executedSql(query);
    expect(statements).toHaveLength(LAST_ERROR_COLUMNS.length);

    for (const column of LAST_ERROR_COLUMNS) {
      expect(statements).toContain(
        `ALTER TABLE "${column.table}" ALTER COLUMN "${column.propertyName}" TYPE text`,
      );
    }
  });

  test("up() alters in place and never drops the column", async () => {
    /*
     * The DDL TypeORM generates for varchar -> text is DROP COLUMN +
     * ADD COLUMN, which would throw away every error already stored on
     * upgrade — including the ones a customer is mid-investigation on.
     * varchar -> text is binary-coercible, so ALTER ... TYPE is enough.
     */
    const { runner, query } = makeQueryRunner();
    await migration.up(runner);

    for (const sql of executedSql(query)) {
      expect(sql).toContain("ALTER COLUMN");
      expect(sql).toContain("TYPE text");
      expect(sql).not.toContain("DROP");
      expect(sql).not.toContain("DELETE");
    }

    expect(MIGRATION_SOURCE).not.toContain("DROP COLUMN");
  });

  test("up() touches no column other than the two lastError columns", async () => {
    const { runner, query } = makeQueryRunner();
    await migration.up(runner);

    const altered: Array<string> = executedSql(query)
      .map((sql: string) => {
        const match: RegExpMatchArray | null = sql.match(
          /ALTER TABLE "(\w+)" ALTER COLUMN "(\w+)"/,
        );
        return match ? `${match[1]}.${match[2]}` : sql;
      })
      .sort();

    expect(altered).toEqual(
      LAST_ERROR_COLUMNS.map((column: LastErrorColumn) => {
        return `${column.table}.${column.propertyName}`;
      }).sort(),
    );
  });

  test("the migration widens exactly the columns the entities declare as text", async () => {
    /*
     * Catches the half-applied fix: widening the entity but not the
     * migration (or vice versa) leaves Postgres rejecting values the
     * model claims fit.
     */
    const { runner, query } = makeQueryRunner();
    await migration.up(runner);
    const statements: Array<string> = executedSql(query);

    for (const column of LAST_ERROR_COLUMNS) {
      expect(columnArgs(column).options.type).toBe(ColumnType.VeryLongText);
      expect(statements).toContain(
        `ALTER TABLE "${column.table}" ALTER COLUMN "${column.propertyName}" TYPE ${ColumnType.VeryLongText}`,
      );
    }
  });

  test("down() truncates oversized rows BEFORE narrowing, so the revert cannot fail", async () => {
    const { runner, query } = makeQueryRunner();
    await migration.down(runner);

    const statements: Array<string> = executedSql(query);

    /*
     * Per table, not globally: down() finishes one table before starting
     * the next, so what matters is that each table's clipping UPDATE
     * lands ahead of that same table's narrowing ALTER.
     */
    for (const column of LAST_ERROR_COLUMNS) {
      const clipIndex: number = statements.findIndex((sql: string) => {
        return (
          sql.startsWith(`UPDATE "${column.table}"`) &&
          sql.includes(`SET "${column.propertyName}" = LEFT(`) &&
          sql.includes(String(ColumnLength.LongText))
        );
      });
      const narrowIndex: number = statements.indexOf(
        `ALTER TABLE "${column.table}" ALTER COLUMN "${column.propertyName}" TYPE character varying(${ColumnLength.LongText})`,
      );

      expect(clipIndex).toBeGreaterThanOrEqual(0);
      expect(narrowIndex).toBeGreaterThanOrEqual(0);
      expect(clipIndex).toBeLessThan(narrowIndex);
    }
  });

  test("down() restores exactly the width the creating migration used", async () => {
    const createTables: AddDetectionRuleAndGoogleSecOpsConnection1788000000000 =
      new AddDetectionRuleAndGoogleSecOpsConnection1788000000000();
    const { runner: createRunner, query: createQuery } = makeQueryRunner();
    await createTables.up(createRunner);

    const { runner: downRunner, query: downQuery } = makeQueryRunner();
    await migration.down(downRunner);

    const createStatements: Array<string> = executedSql(createQuery);
    const downStatements: Array<string> = executedSql(downQuery);

    for (const column of LAST_ERROR_COLUMNS) {
      /*
       * Scope the search to the statement that creates THIS table — a
       * bare substring match would be satisfied by any of the other
       * varchar(500) columns in the same migration.
       */
      const declaringStatement: string | undefined = createStatements.find(
        (sql: string) => {
          return (
            sql.startsWith(`CREATE TABLE "${column.table}" (`) &&
            sql.includes(
              `"${column.propertyName}" character varying(${ColumnLength.LongText})`,
            )
          );
        },
      );

      // Production really is on varchar(500) until this migration runs.
      expect(declaringStatement).toBeDefined();

      expect(downStatements).toContain(
        `ALTER TABLE "${column.table}" ALTER COLUMN "${column.propertyName}" TYPE character varying(${ColumnLength.LongText})`,
      );
    }
  });

  test("the class name carries its own timestamp, matching the file name", () => {
    expect(migration.name).toBe(
      "WidenSecurityEventLastErrorColumns1789800000000",
    );
  });
});

describe("WidenSecurityEventLastErrorColumns1789800000000 registration", () => {
  /*
   * The nastiest way this bug comes back: everything above passes on an
   * unregistered migration, because entity metadata does not care whether
   * the DDL ever ran. Postgres would stay at varchar(500), the poller's
   * recovery write would keep throwing, and the loop would keep dying —
   * with a green test suite.
   */
  test("is imported in SchemaMigrations/Index.ts", () => {
    expect(MIGRATIONS_INDEX_SOURCE).toContain(
      `import { WidenSecurityEventLastErrorColumns1789800000000 } from "./1789800000000-WidenSecurityEventLastErrorColumns";`,
    );
  });

  test("is listed in the exported migration array", () => {
    expect(SchemaMigrations).toContain(
      WidenSecurityEventLastErrorColumns1789800000000,
    );
    expect(MIGRATIONS_INDEX_SOURCE).toContain(
      "  WidenSecurityEventLastErrorColumns1789800000000,",
    );
  });

  test("is registered exactly once", () => {
    const occurrences: number = SchemaMigrations.filter(
      (migration: unknown) => {
        return migration === WidenSecurityEventLastErrorColumns1789800000000;
      },
    ).length;
    expect(occurrences).toBe(1);
  });

  /*
   * Ordering is by TIMESTAMP, not by position in the array. TypeORM's
   * MigrationExecutor.getMigrations() parses the trailing 13 digits off
   * each class name and sorts by that, ignoring the order the classes were
   * registered in — and this repo's array genuinely does deviate from
   * timestamp order in places, so array position is not even accidentally
   * the same thing. Asserting on indexOf would therefore pass for a
   * migration appended to the end of the array with a timestamp that sorts
   * it BEFORE the table it alters, which is exactly the mistake worth
   * catching: widening a column on a table that does not exist yet fails
   * outright, and the generator stamps new migrations with Date.now(),
   * which is behind the hand-picked timestamps already in this directory.
   */
  function migrationTimestamp(migration: unknown): number {
    /*
     * Resolve the name the way MigrationExecutor does: it instantiates each
     * registered class and reads `instance.name || instance.constructor.name`.
     * That distinction is load-bearing here — InitialMigration's class name
     * carries no timestamp at all and only its instance `name` property does,
     * so reading the constructor's own `.name` would parse NaN for it.
     */
    const Migration: new () => { name?: string } = migration as new () => {
      name?: string;
    };
    const instance: { name?: string } = new Migration();
    const className: string = instance.name || Migration.name;

    return Number(className.slice(-13));
  }

  test("sorts after the migration that created both tables", () => {
    const createTimestamp: number = migrationTimestamp(
      AddDetectionRuleAndGoogleSecOpsConnection1788000000000,
    );
    const widenTimestamp: number = migrationTimestamp(
      WidenSecurityEventLastErrorColumns1789800000000,
    );

    // NaN would silently satisfy neither comparison below; rule it out first.
    expect(Number.isFinite(createTimestamp)).toBe(true);
    expect(Number.isFinite(widenTimestamp)).toBe(true);

    expect(widenTimestamp).toBeGreaterThan(createTimestamp);
  });

  /*
   * And nothing registered anywhere sorts between the two by accident
   * while claiming the same timestamp — a duplicate would make the
   * relative order of those two migrations depend on Array.prototype.sort
   * stability rather than on anything intentional.
   */
  test("does not collide with another registered migration's timestamp", () => {
    const widenTimestamp: number = migrationTimestamp(
      WidenSecurityEventLastErrorColumns1789800000000,
    );

    const collisions: Array<unknown> = SchemaMigrations.filter(
      (migration: unknown) => {
        return (
          migration !== WidenSecurityEventLastErrorColumns1789800000000 &&
          migrationTimestamp(migration) === widenTimestamp
        );
      },
    );

    expect(collisions).toHaveLength(0);
  });
});
