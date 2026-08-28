import { generateKeyPairSync } from "crypto";
import DetectionRule from "../../../../Models/DatabaseModels/DetectionRule";
import GoogleSecOpsConnection from "../../../../Models/DatabaseModels/GoogleSecOpsConnection";
import logger from "../../../../Server/Utils/Logger";
import ConnectorErrorMessage, {
  MAX_CONNECTOR_ERROR_MESSAGE_LENGTH,
} from "../../../../Server/Utils/SecurityEvent/ConnectorErrorMessage";
import GoogleSecOpsClient, {
  FetchLike,
  FetchResponseLike,
} from "../../../../Server/Utils/SecurityEvent/GoogleSecOps/GoogleSecOpsClient";
import { getMaxLengthFromTableColumnType } from "../../../../Types/Database/ColumnLength";
import { TableColumnMetadata } from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { getJestSpyOn } from "../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ConnectorErrorMessage is the guard rail that keeps a security-event
 * background loop from being killed by its own error bookkeeping.
 *
 * The outage it exists for: GoogleSecOpsPoller.pollAllDueConnections
 * caught a per-connection poll failure and then wrote { lastPolledAt,
 * lastError } back onto the row with a bare, unguarded updateOneById.
 * lastError was TableColumnType.LongText — varchar(500) — while a Google
 * SecOps client error is a fixed prefix plus up to 500 characters of
 * echoed response body, so it overflowed. DatabaseService's
 * checkMaxLengthOfFields turns an overflow into a BadDataException, the
 * throw escaped the catch block and the whole loop with it, nothing was
 * stamped, and every remaining connection in that tick was skipped. What
 * the customer saw was a connector that never polled whose row still read
 * lastPolledAt = null AND lastError = null — the two columns meant to
 * explain the outage were exactly the ones the outage prevented from
 * being written. DetectionRuleEvaluator.evaluateAllDueRules had the same
 * unguarded write against DetectionRule.lastError, and ClickHouse errors
 * echo the whole compiled query, so it was likelier still to trip.
 *
 * So this file pins both halves of the fix, plus the column widening that
 * makes the clamp sufficient:
 *
 *   - toMessage: every thrown shape becomes a non-empty string that is
 *     never longer than MAX_CONNECTOR_ERROR_MESSAGE_LENGTH, with the
 *     truncation marker counted inside the limit rather than added on
 *     top of it.
 *   - recordFailure: the bookkeeping write runs inside its own
 *     try/catch and NEVER rethrows — sync throw, async rejection and
 *     non-Error rejection alike — so the loop always advances.
 *   - the lastError columns on both models are unbounded text, so a
 *     clamped message can no longer be rejected on its way in.
 *
 * The regression cases are built by driving the real GoogleSecOpsClient
 * against an injected fetch rather than by copying a magic number, so a
 * change to its error templates shows up here.
 */

/*
 * Mirrors of the two private constants in ConnectorErrorMessage.ts. They
 * are deliberately duplicated: the exact stored text is the contract with
 * whoever reads the column, so a silent edit to either should fail here.
 */
const TRUNCATION_MARKER: string = "... (truncated)";
const UNKNOWN_ERROR_MESSAGE: string = "Unknown error.";

// The width lastError used to be declared at, i.e. varchar(500).
const OLD_LAST_ERROR_COLUMN_MAX_LENGTH: number = 500;

type Spy = ReturnType<typeof getJestSpyOn>;

function repeatToLength(seed: string, length: number): string {
  return seed.repeat(Math.ceil(length / seed.length)).slice(0, length);
}

describe("ConnectorErrorMessage.toMessage", () => {
  describe("extracting a message from whatever was thrown", () => {
    test("an Error contributes its .message, unchanged", () => {
      expect(
        ConnectorErrorMessage.toMessage(new Error("token exchange failed")),
      ).toBe("token exchange failed");
    });

    test("an Error subclass contributes its .message too", () => {
      expect(
        ConnectorErrorMessage.toMessage(
          new BadDataException(
            "Region must be a Google SecOps regional prefix.",
          ),
        ),
      ).toBe("Region must be a Google SecOps regional prefix.");
    });

    test("a thrown string is used as-is", () => {
      expect(ConnectorErrorMessage.toMessage("ECONNRESET")).toBe("ECONNRESET");
    });

    test("a thrown number is stringified", () => {
      expect(ConnectorErrorMessage.toMessage(503)).toBe("503");
    });

    test("zero and false are stringified, not mistaken for absent values", () => {
      /*
       * The absent-value branch tests `error !== null && error !== undefined`
       * rather than truthiness, so falsy-but-present values keep their text.
       */
      expect(ConnectorErrorMessage.toMessage(0)).toBe("0");
      expect(ConnectorErrorMessage.toMessage(false)).toBe("false");
    });

    test("a plain object is stringified", () => {
      expect(ConnectorErrorMessage.toMessage({ status: 403 })).toBe(
        "[object Object]",
      );
    });

    test("an object with a custom toString contributes that text", () => {
      const thrown: { toString: () => string } = {
        toString: (): string => {
          return "ClickHouse: TABLE_DOESNT_EXIST";
        },
      };

      expect(ConnectorErrorMessage.toMessage(thrown)).toBe(
        "ClickHouse: TABLE_DOESNT_EXIST",
      );
    });

    test("an array is stringified", () => {
      expect(ConnectorErrorMessage.toMessage(["a", "b"])).toBe("a,b");
    });
  });

  describe("values that carry nothing usable", () => {
    test("null becomes the unknown-error fallback", () => {
      expect(ConnectorErrorMessage.toMessage(null)).toBe(UNKNOWN_ERROR_MESSAGE);
    });

    test("undefined becomes the unknown-error fallback", () => {
      expect(ConnectorErrorMessage.toMessage(undefined)).toBe(
        UNKNOWN_ERROR_MESSAGE,
      );
    });

    test("an Error with an empty message becomes the fallback", () => {
      expect(ConnectorErrorMessage.toMessage(new Error(""))).toBe(
        UNKNOWN_ERROR_MESSAGE,
      );
    });

    test("an Error with a whitespace-only message becomes the fallback", () => {
      expect(ConnectorErrorMessage.toMessage(new Error("  \n\t  "))).toBe(
        UNKNOWN_ERROR_MESSAGE,
      );
    });

    test("an empty or whitespace-only thrown string becomes the fallback", () => {
      expect(ConnectorErrorMessage.toMessage("")).toBe(UNKNOWN_ERROR_MESSAGE);
      expect(ConnectorErrorMessage.toMessage("   ")).toBe(
        UNKNOWN_ERROR_MESSAGE,
      );
    });

    test('no input shape ever yields "" or the literal "undefined"', () => {
      /*
       * Both read like a bug in the recorder rather than a failure worth
       * chasing, which is the whole point of having a fallback string.
       */
      const emptyish: Array<unknown> = [
        null,
        undefined,
        "",
        "   ",
        new Error(""),
        new Error("   "),
      ];

      for (const value of emptyish) {
        const message: string = ConnectorErrorMessage.toMessage(value);
        expect(message).toBe(UNKNOWN_ERROR_MESSAGE);
        expect(message).not.toBe("");
        expect(message).not.toBe("undefined");
        expect(message.trim().length).toBeGreaterThan(0);
      }
    });
  });

  describe("trimming", () => {
    test("leading and trailing whitespace is stripped from a thrown string", () => {
      expect(ConnectorErrorMessage.toMessage("  \n  poll failed  \t ")).toBe(
        "poll failed",
      );
    });

    test("leading and trailing whitespace is stripped from an Error message", () => {
      expect(
        ConnectorErrorMessage.toMessage(new Error("\n poll failed \n")),
      ).toBe("poll failed");
    });

    test("interior whitespace is left alone", () => {
      expect(ConnectorErrorMessage.toMessage("line one\n  line two")).toBe(
        "line one\n  line two",
      );
    });
  });

  describe("the length clamp", () => {
    test("a message of exactly the limit is returned untouched", () => {
      const exact: string = repeatToLength(
        "abcdefghij",
        MAX_CONNECTOR_ERROR_MESSAGE_LENGTH,
      );

      const message: string = ConnectorErrorMessage.toMessage(new Error(exact));

      // Boundary: the source compares with <=, so this must not be clamped.
      expect(message).toBe(exact);
      expect(message.length).toBe(MAX_CONNECTOR_ERROR_MESSAGE_LENGTH);
      expect(message.endsWith(TRUNCATION_MARKER)).toBe(false);
    });

    test("one character over the limit is clamped, and the marker is counted inside the limit", () => {
      const overLimit: string = repeatToLength(
        "abcdefghij",
        MAX_CONNECTOR_ERROR_MESSAGE_LENGTH + 1,
      );

      const message: string = ConnectorErrorMessage.toMessage(
        new Error(overLimit),
      );

      expect(message.length).toBeLessThanOrEqual(
        MAX_CONNECTOR_ERROR_MESSAGE_LENGTH,
      );

      /*
       * Appending the marker on top of a full-length prefix would push the
       * result past the limit, which is precisely the class of bug this
       * helper exists to prevent — so the result lands exactly on it.
       */
      expect(message.length).toBe(MAX_CONNECTOR_ERROR_MESSAGE_LENGTH);
      expect(message.endsWith(TRUNCATION_MARKER)).toBe(true);

      const keptPrefix: string = message.slice(
        0,
        message.length - TRUNCATION_MARKER.length,
      );
      expect(keptPrefix.length).toBe(
        MAX_CONNECTOR_ERROR_MESSAGE_LENGTH - TRUNCATION_MARKER.length,
      );
      // The surviving text is a real prefix of the input, not a re-render.
      expect(overLimit.startsWith(keptPrefix)).toBe(true);
    });

    test("a very long message is clamped to the same bound", () => {
      const huge: string = repeatToLength("clickhouse query fragment ", 50000);

      const message: string = ConnectorErrorMessage.toMessage(new Error(huge));

      expect(huge.length).toBe(50000);
      expect(message.length).toBe(MAX_CONNECTOR_ERROR_MESSAGE_LENGTH);
      expect(message.endsWith(TRUNCATION_MARKER)).toBe(true);
      expect(
        huge.startsWith(
          message.slice(0, message.length - TRUNCATION_MARKER.length),
        ),
      ).toBe(true);
    });

    test("no input can produce a string longer than the limit", () => {
      const cases: Array<unknown> = [
        new Error(repeatToLength("x", 10)),
        new Error(repeatToLength("x", MAX_CONNECTOR_ERROR_MESSAGE_LENGTH)),
        new Error(repeatToLength("x", MAX_CONNECTOR_ERROR_MESSAGE_LENGTH + 1)),
        repeatToLength("y", 12345),
        {
          toString: (): string => {
            return repeatToLength("z", 9000);
          },
        },
        null,
        undefined,
      ];

      for (const value of cases) {
        expect(
          ConnectorErrorMessage.toMessage(value).length,
        ).toBeLessThanOrEqual(MAX_CONNECTOR_ERROR_MESSAGE_LENGTH);
      }
    });

    test("trimming happens before the length check, so padding alone never truncates", () => {
      /*
       * A full-width message wrapped in whitespace is exactly the limit
       * once trimmed. Measuring before the trim would clamp it and lose
       * the tail of a message that fits.
       */
      const exact: string = repeatToLength(
        "abcdefghij",
        MAX_CONNECTOR_ERROR_MESSAGE_LENGTH,
      );

      const message: string = ConnectorErrorMessage.toMessage(
        new Error(`   ${exact}   `),
      );

      expect(message).toBe(exact);
      expect(message.endsWith(TRUNCATION_MARKER)).toBe(false);
    });
  });
});

/*
 * The two client error templates that used to overflow varchar(500).
 * These are produced by driving the real GoogleSecOpsClient against an
 * injected fetch, so the assertions track the client rather than a copy
 * of its format strings.
 */
describe("ConnectorErrorMessage.toMessage on the real Google SecOps client errors", () => {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });

  const SERVICE_ACCOUNT_JSON: string = JSON.stringify({
    client_email: "poller@example.iam.gserviceaccount.com",
    private_key: privateKey,
    token_uri: "https://oauth2.example.com/token",
  });

  const INSTANCE: string =
    "projects/my-project/locations/us/instances/3f0a-instance";

  /*
   * A Google error body is JSON and routinely far longer than the 500
   * characters the client keeps of it.
   */
  const HUGE_ERROR_BODY: string = JSON.stringify({
    error: {
      code: 403,
      status: "PERMISSION_DENIED",
      message: repeatToLength(
        "caller does not have permission chronicle.legacies.legacyFetchAlertsView; ",
        4000,
      ),
    },
  });

  function makeClient(
    responses: Array<{ status: number; body: string }>,
  ): GoogleSecOpsClient {
    let callIndex: number = 0;

    const fetchImplementation: FetchLike = (): Promise<FetchResponseLike> => {
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

    return new GoogleSecOpsClient({
      region: "us",
      instanceResourceName: INSTANCE,
      serviceAccountJson: SERVICE_ACCOUNT_JSON,
      fetchImplementation,
    });
  }

  async function captureFetchAlertsError(
    responses: Array<{ status: number; body: string }>,
  ): Promise<Error> {
    try {
      await makeClient(responses).fetchDetectionAlerts({
        startTime: new Date("2026-08-21T09:00:00.000Z"),
        endTime: new Date("2026-08-21T10:00:00.000Z"),
      });
    } catch (error) {
      return error as Error;
    }

    throw new Error("expected the client to throw");
  }

  test("a failed alerts fetch overflows the old column, and toMessage keeps it storable", async () => {
    const error: Error = await captureFetchAlertsError([
      {
        status: 200,
        body: JSON.stringify({ access_token: "test-token", expires_in: 3600 }),
      },
      { status: 403, body: HUGE_ERROR_BODY },
    ]);

    const prefix: string = "Google SecOps alerts fetch failed (HTTP 403): ";
    const rawMessage: string = error.message;

    expect(rawMessage.startsWith(prefix)).toBe(true);

    /*
     * The template is a 46-character prefix plus responseText.slice(0, 500).
     * 546 > 500, so under the old TableColumnType.LongText declaration
     * checkMaxLengthOfFields threw BadDataException on the poller's own
     * recovery write — which is how lastPolledAt and lastError both stayed
     * null while the connector silently stopped polling.
     */
    expect(prefix.length).toBe(46);
    expect(rawMessage.length).toBe(prefix.length + 500);
    expect(rawMessage.length).toBeGreaterThan(OLD_LAST_ERROR_COLUMN_MAX_LENGTH);
    expect(rawMessage.length).toBeGreaterThan(
      getMaxLengthFromTableColumnType(TableColumnType.LongText)!,
    );

    const stored: string = ConnectorErrorMessage.toMessage(error);

    expect(stored.length).toBeLessThanOrEqual(
      MAX_CONNECTOR_ERROR_MESSAGE_LENGTH,
    );
    // 546 fits inside 1000, so the whole diagnostic survives the clamp.
    expect(stored).toBe(rawMessage);
  });

  test("a failed token exchange overflows the old column too, and toMessage keeps it storable", async () => {
    const error: Error = await captureFetchAlertsError([
      { status: 401, body: HUGE_ERROR_BODY },
    ]);

    const prefix: string = "Google token exchange failed (HTTP 401): ";
    const rawMessage: string = error.message;

    expect(rawMessage.startsWith(prefix)).toBe(true);

    // Same shape as above: prefix + 500 characters of echoed body > 500.
    expect(rawMessage.length).toBe(prefix.length + 500);
    expect(rawMessage.length).toBeGreaterThan(OLD_LAST_ERROR_COLUMN_MAX_LENGTH);

    const stored: string = ConnectorErrorMessage.toMessage(error);

    expect(stored.length).toBeLessThanOrEqual(
      MAX_CONNECTOR_ERROR_MESSAGE_LENGTH,
    );
    expect(stored).toBe(rawMessage);
  });

  test("a ClickHouse-style error that echoes a whole compiled query is clamped", () => {
    /*
     * The evaluator side of the same bug: a ClickHouse failure echoes the
     * compiled query back, so its messages run to thousands of characters
     * rather than the client's bounded 546.
     */
    const echoedQuery: string = repeatToLength(
      "SELECT count() FROM security_event WHERE projectId = {p0:String} AND ",
      8000,
    );

    const error: Error = new Error(
      `Code: 47. DB::Exception: Missing columns while processing query: ${echoedQuery}`,
    );

    expect(error.message.length).toBeGreaterThan(
      OLD_LAST_ERROR_COLUMN_MAX_LENGTH,
    );

    const stored: string = ConnectorErrorMessage.toMessage(error);

    expect(stored.length).toBe(MAX_CONNECTOR_ERROR_MESSAGE_LENGTH);
    expect(stored.endsWith(TRUNCATION_MARKER)).toBe(true);
    // The head of the message — the part that names the failure — is kept.
    expect(stored.startsWith("Code: 47. DB::Exception:")).toBe(true);
  });
});

describe("ConnectorErrorMessage.recordFailure", () => {
  const LABEL: string =
    "GoogleSecOpsPoller: connection 22222222-2222-4222-8222-222222222222";

  let errorSpy: Spy;

  beforeEach(() => {
    // Silence the deliberate error logging; assertions read the spy instead.
    errorSpy = getJestSpyOn(logger, "error").mockImplementation((() => {
      return undefined;
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function loggedLines(): Array<string> {
    return errorSpy.mock.calls.map((call: Array<unknown>): string => {
      const body: unknown = call[0];

      if (body instanceof Error) {
        return body.message;
      }

      return String(body);
    });
  }

  describe("the happy path", () => {
    test("awaits write() exactly once and does not throw", async () => {
      let calls: number = 0;

      await ConnectorErrorMessage.recordFailure({
        label: LABEL,
        write: async (): Promise<void> => {
          calls++;
          return Promise.resolve();
        },
      });

      expect(calls).toBe(1);
    });

    test("really awaits the write — it does not resolve before write() finishes", async () => {
      /*
       * The callers stamp lastPolledAt / lastEvaluatedAt through this
       * write; returning before it settles would let the next loop
       * iteration race the bookkeeping.
       */
      let finished: boolean = false;

      await ConnectorErrorMessage.recordFailure({
        label: LABEL,
        write: async (): Promise<void> => {
          await Promise.resolve();
          await Promise.resolve();
          finished = true;
        },
      });

      expect(finished).toBe(true);
    });

    test("logs nothing when the write succeeds", async () => {
      await ConnectorErrorMessage.recordFailure({
        label: LABEL,
        write: async (): Promise<void> => {
          return Promise.resolve();
        },
      });

      expect(errorSpy).not.toHaveBeenCalled();
    });

    test("resolves with undefined", async () => {
      await expect(
        ConnectorErrorMessage.recordFailure({
          label: LABEL,
          write: async (): Promise<void> => {
            return Promise.resolve();
          },
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("a failing write is swallowed", () => {
    test("an async rejection never escapes", async () => {
      /*
       * The regression: this rejection used to be an unguarded
       * updateOneById inside the loop's catch block, so it escaped
       * pollAllDueConnections and skipped every remaining connection.
       */
      await expect(
        ConnectorErrorMessage.recordFailure({
          label: LABEL,
          write: async (): Promise<void> => {
            throw new Error("connection terminated unexpectedly");
          },
        }),
      ).resolves.not.toThrow();
    });

    test("a BadDataException from the length check never escapes", async () => {
      /*
       * The exact exception checkMaxLengthOfFields raises when a value is
       * longer than its column's declared max — the thing that actually
       * took the poller down.
       */
      let threw: boolean = false;

      try {
        await ConnectorErrorMessage.recordFailure({
          label: LABEL,
          write: async (): Promise<void> => {
            throw new BadDataException(
              "lastError cannot be more than 500 characters.",
            );
          },
        });
      } catch {
        threw = true;
      }

      expect(threw).toBe(false);
    });

    test("a synchronous throw — before the callback's first await — is swallowed too", async () => {
      /*
       * A callback that throws while building its arguments never returns
       * a promise at all, so only a try/catch around the call itself (not
       * a .catch() on the result) covers it.
       */
      let threw: boolean = false;

      try {
        await ConnectorErrorMessage.recordFailure({
          label: LABEL,
          write: ((): Promise<void> => {
            throw new Error("thrown before any await");
          }) as () => Promise<void>,
        });
      } catch {
        threw = true;
      }

      expect(threw).toBe(false);
      expect(errorSpy).toHaveBeenCalled();
    });

    test("a non-Error rejection value is swallowed", async () => {
      await expect(
        ConnectorErrorMessage.recordFailure({
          label: LABEL,
          write: async (): Promise<void> => {
            return Promise.reject("pool exhausted");
          },
        }),
      ).resolves.not.toThrow();

      expect(errorSpy).toHaveBeenCalled();
      expect(loggedLines().join("\n")).toContain("pool exhausted");
    });

    test("a rejection with null is swallowed", async () => {
      await expect(
        ConnectorErrorMessage.recordFailure({
          label: LABEL,
          write: async (): Promise<void> => {
            return Promise.reject(null);
          },
        }),
      ).resolves.not.toThrow();
    });
  });

  describe("the failure is reported instead of being lost", () => {
    test("logs the failure, naming the item the caller labelled", async () => {
      await ConnectorErrorMessage.recordFailure({
        label: LABEL,
        write: async (): Promise<void> => {
          throw new Error("connection terminated unexpectedly");
        },
      });

      expect(errorSpy).toHaveBeenCalled();

      const lines: Array<string> = loggedLines();

      // The label is what ties the log line back to a specific connection.
      expect(
        lines.some((line: string): boolean => {
          return line.includes(LABEL);
        }),
      ).toBe(true);
    });

    test("logs the underlying error as well as the label", async () => {
      await ConnectorErrorMessage.recordFailure({
        label: LABEL,
        write: async (): Promise<void> => {
          throw new Error("connection terminated unexpectedly");
        },
      });

      expect(loggedLines().join("\n")).toContain(
        "connection terminated unexpectedly",
      );
    });

    test("a label from the evaluator side is reported the same way", async () => {
      const ruleLabel: string =
        "DetectionRuleEvaluator: rule 11111111-1111-4111-8111-111111111111";

      await ConnectorErrorMessage.recordFailure({
        label: ruleLabel,
        write: async (): Promise<void> => {
          throw new Error("clickhouse unavailable");
        },
      });

      expect(loggedLines().join("\n")).toContain(ruleLabel);
    });
  });

  describe("the loop keeps going", () => {
    test("a failing write for one item does not stop the items after it", async () => {
      /*
       * The shape of the outage in miniature: item two's bookkeeping write
       * throws. Before the fix that throw escaped the whole loop and item
       * three was never attempted.
       */
      const attempted: Array<string> = [];

      for (const id of ["one", "two", "three"]) {
        await ConnectorErrorMessage.recordFailure({
          label: `GoogleSecOpsPoller: connection ${id}`,
          write: async (): Promise<void> => {
            attempted.push(id);

            if (id === "two") {
              throw new Error("value too long for type character varying(500)");
            }
          },
        });
      }

      expect(attempted).toEqual(["one", "two", "three"]);
    });
  });
});

describe("the lastError columns the clamp writes into", () => {
  test("GoogleSecOpsConnection.lastError is unbounded text", () => {
    const metadata: TableColumnMetadata =
      new GoogleSecOpsConnection().getTableColumnMetadata("lastError");

    expect(metadata.type).toBe(TableColumnType.VeryLongText);
  });

  test("GoogleSecOpsConnection.lastError has no max length, so a clamped message cannot be rejected", () => {
    const metadata: TableColumnMetadata =
      new GoogleSecOpsConnection().getTableColumnMetadata("lastError");

    /*
     * checkMaxLengthOfFields only length-checks a column when
     * getMaxLengthFromTableColumnType returns a value, so undefined here
     * means the write can no longer throw on length at all.
     */
    expect(getMaxLengthFromTableColumnType(metadata.type)).toBeUndefined();
  });

  test("DetectionRule.lastError is unbounded text", () => {
    const metadata: TableColumnMetadata =
      new DetectionRule().getTableColumnMetadata("lastError");

    expect(metadata.type).toBe(TableColumnType.VeryLongText);
  });

  test("DetectionRule.lastError has no max length either", () => {
    const metadata: TableColumnMetadata =
      new DetectionRule().getTableColumnMetadata("lastError");

    expect(getMaxLengthFromTableColumnType(metadata.type)).toBeUndefined();
  });

  test("the old declaration really was the 500-character bound", () => {
    // Guards the premise of the fix rather than the fix itself.
    expect(getMaxLengthFromTableColumnType(TableColumnType.LongText)).toBe(
      OLD_LAST_ERROR_COLUMN_MAX_LENGTH,
    );
  });

  test("the clamp alone would not have been enough on the old column", () => {
    /*
     * Why the widening AND the clamp both had to land: a message clamped
     * to 1000 characters still overflows varchar(500). The clamp bounds
     * what is stored; the text column is what accepts it.
     */
    expect(MAX_CONNECTOR_ERROR_MESSAGE_LENGTH).toBeGreaterThan(
      OLD_LAST_ERROR_COLUMN_MAX_LENGTH,
    );
  });

  test("a clamped 50000-character error passes the length check both models now apply", () => {
    const stored: string = ConnectorErrorMessage.toMessage(
      new Error(repeatToLength("clickhouse query fragment ", 50000)),
    );

    for (const model of [new GoogleSecOpsConnection(), new DetectionRule()]) {
      const metadata: TableColumnMetadata =
        model.getTableColumnMetadata("lastError");
      const maxLength: number | undefined = getMaxLengthFromTableColumnType(
        metadata.type,
      );

      // Mirrors DatabaseService.checkMaxLengthOfFields: no max, no check.
      expect(maxLength).toBeUndefined();
      expect(stored.length).toBeLessThanOrEqual(
        MAX_CONNECTOR_ERROR_MESSAGE_LENGTH,
      );
    }
  });

  test("both columns stay nullable and optional, so a successful run can clear them", () => {
    const connectionMetadata: TableColumnMetadata =
      new GoogleSecOpsConnection().getTableColumnMetadata("lastError");
    const ruleMetadata: TableColumnMetadata =
      new DetectionRule().getTableColumnMetadata("lastError");

    expect(connectionMetadata.required).toBeFalsy();
    expect(ruleMetadata.required).toBeFalsy();
  });
});
