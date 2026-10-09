import StandardWebhookSignature, {
  STANDARD_WEBHOOK_TOLERANCE_IN_SECONDS,
  StandardWebhookFailure,
  StandardWebhookHeaders,
  StandardWebhookVerification,
} from "../../../../Server/Utils/Webhook/StandardWebhookSignature";
import crypto from "crypto";
import { describe, expect, test } from "@jest/globals";

/*
 * Svix-signed webhooks - how Huntress delivers its events - verified the
 * way Svix documents (docs.svix.com/receiving/verifying-payloads/how-manual):
 * an HMAC-SHA256 of "<id>.<timestamp>.<raw body>" with the base64 key after
 * "whsec_", sent as "v1,<base64>" in svix-signature, accepted only within
 * five minutes of the timestamp.
 */

// Svix's own published test vector.
const SVIX_SECRET: string = "whsec_plJ3nmyCDGBKInavdOK15jsl";
const SVIX_BODY: string = '{"event_type":"ping","data":{"success":true}}';
const SVIX_MESSAGE_ID: string = "msg_loFOjxBNrRLzqYUf";
const SVIX_TIMESTAMP: string = "1731705121";
const SVIX_SIGNATURE: string = "v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=";
const SVIX_SIGNED_AT: Date = new Date(Number(SVIX_TIMESTAMP) * 1000);

function headers(
  overrides: Partial<StandardWebhookHeaders> = {},
): StandardWebhookHeaders {
  return {
    id: SVIX_MESSAGE_ID,
    timestamp: SVIX_TIMESTAMP,
    signature: SVIX_SIGNATURE,
    ...overrides,
  };
}

function verify(
  overrides: Partial<StandardWebhookHeaders> = {},
  data: { secret?: string; body?: string; now?: Date } = {},
): StandardWebhookVerification {
  return StandardWebhookSignature.verify({
    secret: data.secret ?? SVIX_SECRET,
    headers: headers(overrides),
    body: data.body ?? SVIX_BODY,
    now: data.now ?? SVIX_SIGNED_AT,
  });
}

function expectFailure(
  result: StandardWebhookVerification,
  failure: StandardWebhookFailure,
): void {
  expect(result.verified).toBe(false);

  if (result.verified) {
    return;
  }

  expect(result.failure).toBe(failure);
  expect(result.message.length).toBeGreaterThan(10);
}

describe("StandardWebhookSignature.sign", () => {
  test("matches Svix's published test vector", () => {
    expect(
      StandardWebhookSignature.sign({
        secret: SVIX_SECRET,
        messageId: SVIX_MESSAGE_ID,
        timestamp: SVIX_TIMESTAMP,
        body: SVIX_BODY,
      }),
    ).toBe(SVIX_SIGNATURE);
  });

  test("refuses to sign with something that is not a secret", () => {
    expect(() => {
      StandardWebhookSignature.sign({
        secret: "not-a-secret!",
        messageId: "m",
        timestamp: "1",
        body: "{}",
      });
    }).toThrow("The signing secret is not a valid webhook secret.");
  });
});

describe("StandardWebhookSignature.verify", () => {
  test("accepts Svix's published test vector", () => {
    expect(verify()).toEqual({
      verified: true,
      messageId: SVIX_MESSAGE_ID,
      signedAt: SVIX_SIGNED_AT,
    });
  });

  test("accepts a secret pasted without its whsec_ prefix, or with white space around it", () => {
    expect(verify({}, { secret: "plJ3nmyCDGBKInavdOK15jsl" }).verified).toBe(
      true,
    );
    expect(verify({}, { secret: `  ${SVIX_SECRET}\n` }).verified).toBe(true);
  });

  test("accepts any one of several signatures (a secret being rotated)", () => {
    expect(
      verify({
        signature: `v1,${Buffer.from("other").toString("base64")} ${SVIX_SIGNATURE}`,
      }).verified,
    ).toBe(true);
  });

  test("ignores signatures of other versions", () => {
    expectFailure(
      verify({ signature: SVIX_SIGNATURE.replace("v1,", "v1a,") }),
      StandardWebhookFailure.SignatureMismatch,
    );
  });

  test("refuses a body that is not the one signed - even re-serialized JSON", () => {
    expectFailure(
      verify({}, { body: JSON.stringify(JSON.parse(SVIX_BODY), null, 2) }),
      StandardWebhookFailure.SignatureMismatch,
    );
    expectFailure(
      verify({}, { body: SVIX_BODY.replace("true", "false") }),
      StandardWebhookFailure.SignatureMismatch,
    );
  });

  test("refuses a different message id or timestamp than the one signed", () => {
    expectFailure(
      verify({ id: "msg_somethingElse" }),
      StandardWebhookFailure.SignatureMismatch,
    );
    expectFailure(
      verify(
        { timestamp: String(Number(SVIX_TIMESTAMP) + 1) },
        { now: SVIX_SIGNED_AT },
      ),
      StandardWebhookFailure.SignatureMismatch,
    );
  });

  test("refuses a signature made with another secret", () => {
    const otherSecret: string = `whsec_${crypto.randomBytes(24).toString("base64")}`;

    expectFailure(
      verify({}, { secret: otherSecret }),
      StandardWebhookFailure.SignatureMismatch,
    );
  });

  test("refuses a truncated or garbled signature", () => {
    expectFailure(
      verify({ signature: SVIX_SIGNATURE.slice(0, -4) }),
      StandardWebhookFailure.SignatureMismatch,
    );
    expectFailure(
      verify({ signature: "v1" }),
      StandardWebhookFailure.SignatureMismatch,
    );
    expectFailure(
      verify({ signature: "garbage" }),
      StandardWebhookFailure.SignatureMismatch,
    );
  });

  test.each([
    ["id", { id: null }],
    ["timestamp", { timestamp: null }],
    ["signature", { signature: null }],
  ])("refuses a request without its %s header", (_name: string, missing: Partial<StandardWebhookHeaders>) => {
    expectFailure(verify(missing), StandardWebhookFailure.MissingHeaders);
  });

  test("refuses a timestamp that is not whole seconds", () => {
    expectFailure(
      verify({ timestamp: "2026-10-09T03:00:00Z" }),
      StandardWebhookFailure.InvalidTimestamp,
    );
    expectFailure(
      verify({ timestamp: "1731705121.5" }),
      StandardWebhookFailure.InvalidTimestamp,
    );
  });

  test("accepts a request signed up to five minutes ago or ahead, and refuses one outside that", () => {
    const tolerance: number = STANDARD_WEBHOOK_TOLERANCE_IN_SECONDS * 1000;

    expect(tolerance).toBe(5 * 60 * 1000);
    expect(
      verify({}, { now: new Date(SVIX_SIGNED_AT.getTime() + tolerance) })
        .verified,
    ).toBe(true);
    expect(
      verify({}, { now: new Date(SVIX_SIGNED_AT.getTime() - tolerance) })
        .verified,
    ).toBe(true);
    expectFailure(
      verify({}, { now: new Date(SVIX_SIGNED_AT.getTime() + tolerance + 1000) }),
      StandardWebhookFailure.TimestampOutsideTolerance,
    );
    expectFailure(
      verify({}, { now: new Date(SVIX_SIGNED_AT.getTime() - tolerance - 1000) }),
      StandardWebhookFailure.TimestampOutsideTolerance,
    );
  });

  test("checks the time before the secret, so a replayed request is refused as old", () => {
    expectFailure(
      verify({}, { now: new Date(SVIX_SIGNED_AT.getTime() + 86400 * 1000) }),
      StandardWebhookFailure.TimestampOutsideTolerance,
    );
  });

  test("refuses to verify with a saved secret that is not one", () => {
    expectFailure(
      verify({}, { secret: "whsec_" }),
      StandardWebhookFailure.InvalidSecret,
    );
  });

  test("a request Huntress retries later is signed afresh and verifies", () => {
    const secret: string = `whsec_${crypto.randomBytes(32).toString("base64")}`;
    const body: string = '{"event_type":"incident_report.created","id":1}';
    const retriedAt: Date = new Date("2026-10-09T09:00:00Z");
    const timestamp: string = String(Math.floor(retriedAt.getTime() / 1000));

    expect(
      StandardWebhookSignature.verify({
        secret,
        headers: {
          id: "msg_first",
          timestamp,
          signature: StandardWebhookSignature.sign({
            secret,
            messageId: "msg_first",
            timestamp,
            body,
          }),
        },
        body,
        now: retriedAt,
      }),
    ).toEqual({
      verified: true,
      messageId: "msg_first",
      signedAt: new Date(Number(timestamp) * 1000),
    });
  });
});

describe("StandardWebhookSignature.readHeaders", () => {
  test("reads Svix's headers", () => {
    expect(
      StandardWebhookSignature.readHeaders({
        "svix-id": "msg_1",
        "svix-timestamp": " 123 ",
        "svix-signature": "v1,abc",
      }),
    ).toEqual({ id: "msg_1", timestamp: "123", signature: "v1,abc" });
  });

  test("reads the Standard Webhooks names too", () => {
    expect(
      StandardWebhookSignature.readHeaders({
        "webhook-id": "msg_2",
        "webhook-timestamp": "456",
        "webhook-signature": "v1,def",
      }),
    ).toEqual({ id: "msg_2", timestamp: "456", signature: "v1,def" });
  });

  test("prefers Svix's names, and reads the first of a repeated header", () => {
    expect(
      StandardWebhookSignature.readHeaders({
        "svix-id": ["msg_a", "msg_b"],
        "webhook-id": "msg_c",
        "svix-timestamp": "1",
        "svix-signature": "v1,x",
      }).id,
    ).toBe("msg_a");
  });

  test("an absent, empty or enormous header is not read", () => {
    expect(
      StandardWebhookSignature.readHeaders({
        "svix-id": "",
        "svix-timestamp": "x".repeat(5000),
      }),
    ).toEqual({ id: null, timestamp: null, signature: null });
  });
});

describe("StandardWebhookSignature.decodeSecret", () => {
  test("a Svix secret decodes to its key", () => {
    const key: Buffer = crypto.randomBytes(24);

    expect(
      StandardWebhookSignature.decodeSecret(
        `whsec_${key.toString("base64")}`,
      ),
    ).toEqual(key);
    expect(StandardWebhookSignature.isValidSecret(SVIX_SECRET)).toBe(true);
  });

  test.each([
    ["nothing", ""],
    ["only the prefix", "whsec_"],
    ["not base64", "whsec_not base64!"],
    ["too short a key", `whsec_${Buffer.from("short").toString("base64")}`],
    [
      "the webhook URL pasted by mistake",
      "https://oneuptime.com/api/huntress/webhook/abc",
    ],
    ["an enormous paste", `whsec_${"A".repeat(5000)}`],
  ])("%s is not a secret", (_name: string, secret: string) => {
    expect(StandardWebhookSignature.decodeSecret(secret)).toBeNull();
    expect(StandardWebhookSignature.isValidSecret(secret)).toBe(false);
  });

  test("null and undefined are not secrets", () => {
    expect(StandardWebhookSignature.isValidSecret(null)).toBe(false);
    expect(StandardWebhookSignature.isValidSecret(undefined)).toBe(false);
  });
});
