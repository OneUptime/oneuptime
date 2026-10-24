import { createHmac } from "crypto";
import { describe, expect, test } from "@jest/globals";
import WebhookDestination, {
  AUDIT_LOG_EXPORT_WEBHOOK_EVENT,
  describeWebhookFailure,
  signWebhookBody,
  toWebhookBody,
} from "../../../Server/AuditLogExport/Destinations/WebhookDestination";
import {
  AuditLogExportDeliveryError,
  AuditLogExportHttpTransport,
} from "../../../Server/AuditLogExport/Destinations/Types";
import { AuditLogExportSettings } from "Common/Server/Utils/AuditLog/Export/AuditLogExportSettings";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "Common/Server/Utils/DataSource/HttpFetch";
import AuditLogExportDestinationType from "Common/Types/AuditLog/Export/AuditLogExportDestinationType";
import {
  AUDIT_LOG_EXPORT_RECORD_KEYS,
  AuditLogExportRecord,
} from "Common/Types/AuditLog/Export/AuditLogExportRecord";
import Dictionary from "Common/Types/Dictionary";
import {
  auditLogRecord,
  batchOf,
  deliveryOf,
  settingsOf,
} from "./AuditLogExportTestData";

/*
 * The webhook destination, against a fake endpoint that does what a
 * receiver does: checks the credential header and the signature over the
 * exact bytes it got, parses the body in the format it was told, and can
 * answer anything a real endpoint answers.
 */

const URL_OF_ENDPOINT: string = "https://93.184.216.34/oneuptime/audit";
const SIGNING_SECRET: string = "whsec-long-enough-secret";

interface ReceivedBatch {
  headers: Dictionary<string>;
  body: string;
  entries: Array<Record<string, unknown>>;
}

interface FakeEndpoint {
  transport: AuditLogExportHttpTransport;
  received: Array<ReceivedBatch>;
}

function fakeEndpoint(options: {
  // The status the endpoint answers a request with, by its entry count and its turn.
  answer?: (entryCount: number, call: number) => number;
  expectedCredential?: { header: string; value: string } | undefined;
}): FakeEndpoint {
  const received: Array<ReceivedBatch> = [];
  let call: number = 0;

  return {
    received,
    transport: async (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
      call++;
      const headers: Dictionary<string> = request.headers || {};
      const body: string = String(request.body);

      if (options.expectedCredential) {
        if (
          headers[options.expectedCredential.header] !==
          options.expectedCredential.value
        ) {
          throw new Error(
            'Data source responded with HTTP 401: {"error":"unauthorized"}',
          );
        }
      }

      const entries: Array<Record<string, unknown>> =
        headers["Content-Type"] === "application/x-ndjson"
          ? body
              .split("\n")
              .filter((line: string): boolean => {
                return line.length > 0;
              })
              .map((line: string): Record<string, unknown> => {
                return JSON.parse(line) as Record<string, unknown>;
              })
          : (JSON.parse(body) as Array<Record<string, unknown>>);

      const status: number = options.answer
        ? options.answer(entries.length, call)
        : 200;

      if (status >= 300) {
        throw new Error(`Data source responded with HTTP ${status}: refused`);
      }

      received.push({ headers, body, entries });

      return { statusCode: status, bodyText: "", bodyJson: undefined };
    },
  };
}

const settings: (
  config?: Record<string, unknown>,
  secrets?: Record<string, unknown>,
) => AuditLogExportSettings = (
  config: Record<string, unknown> = {},
  secrets: Record<string, unknown> = {},
): AuditLogExportSettings => {
  return settingsOf({
    type: AuditLogExportDestinationType.Webhook,
    config: { url: URL_OF_ENDPOINT, ...config } as never,
    secrets: secrets as never,
  });
};

const records: Array<AuditLogExportRecord> = [
  auditLogRecord({ createdAt: "2026-10-24T09:15:03.000Z" }),
  auditLogRecord({ createdAt: "2026-10-24T09:15:04.000Z" }),
  auditLogRecord({ createdAt: "2026-10-24T09:15:05.000Z" }),
  auditLogRecord({ createdAt: "2026-10-24T09:15:06.000Z" }),
];

const failureOf: (
  run: () => Promise<unknown>,
) => Promise<AuditLogExportDeliveryError> = async (
  run: () => Promise<unknown>,
): Promise<AuditLogExportDeliveryError> => {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(AuditLogExportDeliveryError);
    return error as AuditLogExportDeliveryError;
  }

  throw new Error("Expected the delivery to fail.");
};

describe("the webhook destination", () => {
  test("posts the batch as a JSON array, in order, each entry in the export schema", async () => {
    const endpoint: FakeEndpoint = fakeEndpoint({});

    const receipt: { location: string } = await new WebhookDestination({
      transport: endpoint.transport,
    }).deliver(deliveryOf({ settings: settings(), batch: batchOf(records) }));

    expect(receipt.location).toBe(URL_OF_ENDPOINT);
    expect(endpoint.received).toHaveLength(1);

    const batch: ReceivedBatch = endpoint.received[0]!;

    expect(batch.headers["Content-Type"]).toBe("application/json");
    expect(batch.headers["X-OneUptime-Event"]).toBe(
      AUDIT_LOG_EXPORT_WEBHOOK_EVENT,
    );
    expect(batch.headers["X-OneUptime-Batch-Id"]).toBe(records[0]!.id);
    expect(batch.headers["X-OneUptime-Entry-Count"]).toBe("4");
    expect(
      batch.entries.map((entry: Record<string, unknown>): unknown => {
        return entry["id"];
      }),
    ).toEqual(
      records.map((record: AuditLogExportRecord): string => {
        return record.id;
      }),
    );
    expect(Object.keys(batch.entries[0]!)).toEqual([
      ...AUDIT_LOG_EXPORT_RECORD_KEYS,
    ]);
  });

  test("NDJSON sends one entry per line", async () => {
    const endpoint: FakeEndpoint = fakeEndpoint({});

    await new WebhookDestination({ transport: endpoint.transport }).deliver(
      deliveryOf({
        settings: settings({ bodyFormat: "ndjson" }),
        batch: batchOf(records),
      }),
    );

    const batch: ReceivedBatch = endpoint.received[0]!;

    expect(batch.headers["Content-Type"]).toBe("application/x-ndjson");
    expect(batch.body.split("\n")).toHaveLength(records.length + 1);
    expect(batch.body.endsWith("\n")).toBe(true);
  });

  test("sends the credential in the Authorization header, or the one the export names", async () => {
    const bearer: FakeEndpoint = fakeEndpoint({
      expectedCredential: { header: "Authorization", value: "Bearer s3cr3t" },
    });

    await new WebhookDestination({ transport: bearer.transport }).deliver(
      deliveryOf({
        settings: settings({}, { headerValue: "Bearer s3cr3t" }),
        batch: batchOf(records),
      }),
    );
    expect(bearer.received).toHaveLength(1);

    const datadog: FakeEndpoint = fakeEndpoint({
      expectedCredential: { header: "DD-API-KEY", value: "dd-key" },
    });

    await new WebhookDestination({ transport: datadog.transport }).deliver(
      deliveryOf({
        settings: settings(
          { headerName: "DD-API-KEY" },
          { headerValue: "dd-key" },
        ),
        batch: batchOf(records),
      }),
    );
    expect(datadog.received[0]!.headers["Authorization"]).toBeUndefined();
  });

  test("signs the exact body with the signing secret, as OneUptime's webhooks do", async () => {
    const endpoint: FakeEndpoint = fakeEndpoint({});

    await new WebhookDestination({ transport: endpoint.transport }).deliver(
      deliveryOf({
        settings: settings({}, { signingSecret: SIGNING_SECRET }),
        batch: batchOf(records),
      }),
    );

    const batch: ReceivedBatch = endpoint.received[0]!;
    const expected: string = `sha256=${createHmac("sha256", SIGNING_SECRET)
      .update(batch.body, "utf8")
      .digest("hex")}`;

    expect(batch.headers["X-OneUptime-Signature"]).toBe(expected);
    expect(signWebhookBody(SIGNING_SECRET, batch.body)).toBe(expected);
  });

  test("without a signing secret there is no signature header", async () => {
    const endpoint: FakeEndpoint = fakeEndpoint({});

    await new WebhookDestination({ transport: endpoint.transport }).deliver(
      deliveryOf({ settings: settings(), batch: batchOf(records) }),
    );

    expect(
      endpoint.received[0]!.headers["X-OneUptime-Signature"],
    ).toBeUndefined();
  });

  test("a body too large for the endpoint is split in halves until it fits", async () => {
    const endpoint: FakeEndpoint = fakeEndpoint({
      // The endpoint takes two entries at a time.
      answer: (entryCount: number): number => {
        return entryCount > 2 ? 413 : 200;
      },
    });

    await new WebhookDestination({ transport: endpoint.transport }).deliver(
      deliveryOf({ settings: settings(), batch: batchOf(records) }),
    );

    expect(
      endpoint.received.map((batch: ReceivedBatch): number => {
        return batch.entries.length;
      }),
    ).toEqual([2, 2]);
    expect(
      endpoint.received.map((batch: ReceivedBatch): string => {
        return batch.headers["X-OneUptime-Batch-Id"]!;
      }),
    ).toEqual([`${records[0]!.id}-1`, `${records[0]!.id}-2`]);
    // Every entry arrived once, in order.
    expect(
      endpoint.received
        .flatMap((batch: ReceivedBatch): Array<Record<string, unknown>> => {
          return batch.entries;
        })
        .map((entry: Record<string, unknown>): unknown => {
          return entry["id"];
        }),
    ).toEqual(
      records.map((record: AuditLogExportRecord): string => {
        return record.id;
      }),
    );
  });

  test("an endpoint that refuses even one entry as too large says to raise its limit", async () => {
    const endpoint: FakeEndpoint = fakeEndpoint({
      answer: (): number => {
        return 413;
      },
    });

    const error: AuditLogExportDeliveryError = await failureOf(() => {
      return new WebhookDestination({ transport: endpoint.transport }).deliver(
        deliveryOf({ settings: settings(), batch: batchOf(records) }),
      );
    });

    expect(error.message).toBe(
      "The webhook endpoint refused even one entry as too large (HTTP 413). Raise its limit on the size of a request.",
    );
    expect(error.retryable).toBe(false);
  });

  test("a refused credential is not retried, and the credential is never in the message", async () => {
    const endpoint: FakeEndpoint = fakeEndpoint({
      expectedCredential: { header: "Authorization", value: "Bearer right" },
    });

    const error: AuditLogExportDeliveryError = await failureOf(() => {
      return new WebhookDestination({ transport: endpoint.transport }).deliver(
        deliveryOf({
          settings: settings({}, { headerValue: "Bearer wrong-token-value" }),
          batch: batchOf(records),
        }),
      );
    });

    expect(
      error.message.startsWith(
        "The webhook endpoint refused the credential (HTTP 401). Check the Credential, and the Header name it is sent in.",
      ),
    ).toBe(true);
    expect(error.retryable).toBe(false);
    expect(error.message).not.toContain("wrong-token-value");
  });

  test("an endpoint that is down is worth trying again", async () => {
    const down: FakeEndpoint = fakeEndpoint({
      answer: (): number => {
        return 502;
      },
    });

    const error: AuditLogExportDeliveryError = await failureOf(() => {
      return new WebhookDestination({ transport: down.transport }).deliver(
        deliveryOf({ settings: settings(), batch: batchOf(records) }),
      );
    });

    expect(error.retryable).toBe(true);

    const unreachable: AuditLogExportDeliveryError = await failureOf(() => {
      return new WebhookDestination({
        transport: async (): Promise<DataSourceHttpResponse> => {
          throw new Error("connect ETIMEDOUT 93.184.216.34:443");
        },
      }).deliver(deliveryOf({ settings: settings(), batch: batchOf(records) }));
    });

    expect(unreachable.message).toBe(
      "Could not reach the webhook endpoint: connect ETIMEDOUT 93.184.216.34:443. Check the URL. It is retried automatically.",
    );
    expect(unreachable.retryable).toBe(true);
  });

  test.each([
    [
      301,
      "redirected to another address (HTTP 301), and redirects are not followed",
    ],
    [404, "Nothing answers at this URL (HTTP 404). Check the URL."],
    [405, "does not take POST requests at this URL (HTTP 405)"],
    [400, "refused the body (HTTP 400). Check that it takes the Body format"],
    [429, "is busy or failing (HTTP 429). It is retried automatically."],
    [418, "did not accept the audit log entries (HTTP 418)."],
  ])(
    "HTTP %s is worded for the person fixing it",
    (status: number, words: string) => {
      expect(
        describeWebhookFailure({
          ok: false,
          status,
          bodyText: "",
          bodyJson: undefined,
        }),
      ).toContain(words);
    },
  );

  test("the JSON array body is valid JSON even for one entry", () => {
    const body: { body: string; contentType: string } = toWebhookBody({
      records: [records[0]!],
      format: "json-array",
    });

    expect(JSON.parse(body.body)).toHaveLength(1);
  });
});
