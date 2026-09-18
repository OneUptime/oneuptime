import ToolResultSerializer, {
  SerializedResult,
} from "../../../../../Server/Utils/AI/Toolbox/Serializer";
import { JSONObject } from "../../../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * Everything an AI tool returns goes through this serializer on its way into
 * the prompt - which means on its way OUT to the LLM provider, and into the
 * LlmLog preview a project member can read. Two properties matter, and both
 * are only ever exercised here:
 *
 *   1. credentials and personal data are redacted before they leave;
 *   2. the identifiers the toolbox pivots on (W3C trace and span ids) are
 *      NOT redacted, or search_logs -> get_trace stops working.
 *
 * The caps matter too: a tool that answers with more than the model can read
 * has to say so, or the model reports a slice as the whole picture.
 */

const MAX_ROWS: number = 50;
const MAX_FIELD_LENGTH: number = 500;
const MAX_PAYLOAD_BYTES: number = 16 * 1024;

function redactionOf(text: string): string {
  return ToolResultSerializer.redact(text).text;
}

function countOf(text: string): number {
  return ToolResultSerializer.redact(text).count;
}

describe("ToolResultSerializer.redact - credentials", () => {
  test("a JWT is replaced wholesale", () => {
    const jwt: string =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk";

    expect(redactionOf(`token=${jwt}`)).toContain("[redacted-jwt]");
    expect(redactionOf(`token=${jwt}`)).not.toContain("eyJhbGciOi");
  });

  test("a bare Bearer token keeps the scheme and loses the token", () => {
    const out: string = redactionOf(
      "sent Bearer abcdefghijklmnopqrstuvwxyz0123456789 upstream",
    );

    expect(out).toBe("sent Bearer [redacted-token] upstream");
  });

  test("a full Authorization header loses the token twice over", () => {
    /*
     * Two rules fire here - the Bearer rule, then the labelled-secret rule
     * over "authorization: …". Belt and braces is the right answer for a
     * credential; what matters is that nothing of the token survives.
     */
    const out: string = redactionOf(
      "Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789",
    );

    expect(out).toContain("[redacted");
    expect(out).not.toContain("abcdefghijklmnop");
  });

  test("a PEM private key block is removed including its body", () => {
    const key: string = [
      "-----BEGIN RSA PRIVATE KEY-----",
      "MIIEpAIBAAKCAQEA1234567890abcdef",
      "ZmFrZSBrZXkgbWF0ZXJpYWwgZm9yIHRoZSB0ZXN0",
      "-----END RSA PRIVATE KEY-----",
    ].join("\n");

    const out: string = redactionOf(`key:\n${key}\nafter`);

    expect(out).toContain("[redacted-private-key]");
    expect(out).not.toContain("MIIEpAIBAAKCAQEA");
    /* Only the block goes; the surrounding text stays readable. */
    expect(out).toContain("after");
  });

  test("provider key formats are each recognised", () => {
    const cases: Array<[string, string]> = [
      ["AKIAIOSFODNN7EXAMPLE", "[redacted-aws-key]"],
      ["ghp_012345678901234567890123456789012345", "[redacted-github-token]"],
      ["xoxb-1234567890-abcdefghij", "[redacted-slack-token]"],
      /* AIza + exactly 35 characters, which is the shape Google issues. */
      [`AIza${"a".repeat(35)}`, "[redacted-google-api-key]"],
    ];

    for (const [secret, marker] of cases) {
      const out: string = redactionOf(`value ${secret} end`);

      expect(out).toContain(marker);
      expect(out).not.toContain(secret);
    }
  });

  test("a labelled secret keeps its label so the model can still reason about the shape", () => {
    const out: string = redactionOf('password: "hunter2000"');

    expect(out).toContain("password");
    expect(out).toContain("[redacted]");
    expect(out).not.toContain("hunter2000");
  });

  test("labelled secrets are matched whatever the separator, quoting or case", () => {
    for (const line of [
      "PASSWORD=hunter2000",
      "api_key: 'abcd1234efgh'",
      "Access-Token = abcd1234efgh",
      'authorization:"abcd1234efgh"',
    ]) {
      expect(redactionOf(line)).toContain("[redacted]");
      expect(redactionOf(line)).not.toContain("hunter2000");
      expect(redactionOf(line)).not.toContain("abcd1234efgh");
    }
  });
});

describe("ToolResultSerializer.redact - personal data", () => {
  test("an email address is removed", () => {
    const out: string = redactionOf("user alice@example.com signed in");

    expect(out).toContain("[redacted-email]");
    expect(out).not.toContain("alice@example.com");
  });

  test("an IPv4 address is removed", () => {
    expect(redactionOf("from 203.0.113.42")).toContain("[redacted-ip]");
  });

  test("a grouped card number is removed", () => {
    expect(redactionOf("card 4111 1111 1111 1111")).toContain(
      "[redacted-card]",
    );
    expect(redactionOf("card 4111-1111-1111-1111")).toContain(
      "[redacted-card]",
    );
  });
});

describe("ToolResultSerializer.redact - what must survive", () => {
  /*
   * These two are the reason the hex rule starts at 33 characters and the
   * card rule insists on separators. Redacting either would leave the model
   * unable to pass the id back to the next tool.
   */
  test("a 32-hex W3C trace id is left alone", () => {
    const traceId: string = "4bf92f3577b34da6a3ce929d0e0e4736";

    expect(redactionOf(`trace ${traceId}`)).toContain(traceId);
  });

  test("a 16-hex span id is left alone", () => {
    const spanId: string = "00f067aa0ba902b7";

    expect(redactionOf(`span ${spanId}`)).toContain(spanId);
  });

  test("an all-numeric 16-character span id is not mistaken for a card number", () => {
    const spanId: string = "1234567890123456";

    expect(redactionOf(`span ${spanId}`)).toContain(spanId);
  });

  test("a 33-hex run IS redacted: that is past every id length and reads as a secret", () => {
    const blob: string = "a".repeat(33);

    expect(redactionOf(`digest ${blob}`)).toContain("[redacted-hex]");
  });

  test("ordinary log prose is returned untouched, and counts nothing", () => {
    const line: string = "Checkout failed for order 8812: inventory locked";

    expect(redactionOf(line)).toBe(line);
    expect(countOf(line)).toBe(0);
  });
});

describe("ToolResultSerializer.redact - counting", () => {
  test("every match is counted, including repeats of one rule", () => {
    expect(countOf("a@b.com c@d.com")).toBe(2);
  });

  test("matches from different rules add up", () => {
    expect(countOf("a@b.com from 10.0.0.1")).toBe(2);
  });
});

describe("ToolResultSerializer.serializeRows", () => {
  test("an empty result says so rather than returning a blank prompt", () => {
    const result: SerializedResult = ToolResultSerializer.serializeRows([]);

    expect(result.text).toBe("(no rows found)");
    expect(result.rowCount).toBe(0);
    expect(result.isTruncated).toBe(false);
  });

  test("a row is rendered as key=value pairs on one line", () => {
    const result: SerializedResult = ToolResultSerializer.serializeRows([
      { service: "checkout", statusCode: 500 },
    ]);

    expect(result.text).toBe("- service=checkout | statusCode=500");
    expect(result.rowCount).toBe(1);
  });

  test("empty and null fields are dropped instead of printed as noise", () => {
    const result: SerializedResult = ToolResultSerializer.serializeRows([
      { service: "checkout", note: "", detail: null },
    ]);

    expect(result.text).toBe("- service=checkout");
  });

  test("a nested object field is rendered as JSON", () => {
    const result: SerializedResult = ToolResultSerializer.serializeRows([
      { attributes: { region: "eu-west-1" } },
    ]);

    expect(result.text).toContain('attributes={"region":"eu-west-1"}');
  });

  test("a Date field is rendered as an ISO timestamp", () => {
    const when: Date = new Date("2026-09-05T10:00:00.000Z");
    const result: SerializedResult = ToolResultSerializer.serializeRows([
      { time: when } as unknown as JSONObject,
    ]);

    expect(result.text).toContain("time=2026-09-05T10:00:00.000Z");
  });

  test("redaction runs per field and the count is reported to the caller", () => {
    const result: SerializedResult = ToolResultSerializer.serializeRows([
      { user: "alice@example.com", ip: "203.0.113.42" },
    ]);

    expect(result.text).toContain("[redacted-email]");
    expect(result.text).toContain("[redacted-ip]");
    expect(result.redactionCount).toBe(2);
    expect(result.text).not.toContain("alice@example.com");
  });

  test("a long field is cut and says it was cut", () => {
    const long: string = "x".repeat(MAX_FIELD_LENGTH + 100);
    const result: SerializedResult = ToolResultSerializer.serializeRows([
      { body: long },
    ]);

    expect(result.isTruncated).toBe(true);
    expect(result.text).toContain("… [truncated]");
    expect(result.text.length).toBeLessThan(long.length);
  });

  test("a field exactly at the limit is left whole", () => {
    const exact: string = "x".repeat(MAX_FIELD_LENGTH);
    const result: SerializedResult = ToolResultSerializer.serializeRows([
      { body: exact },
    ]);

    expect(result.isTruncated).toBe(false);
    expect(result.text).not.toContain("[truncated]");
  });

  test("beyond the row cap the model is told what it is NOT seeing", () => {
    const rows: Array<JSONObject> = [];

    for (let index: number = 0; index < MAX_ROWS + 10; index++) {
      rows.push({ index: index });
    }

    const result: SerializedResult = ToolResultSerializer.serializeRows(rows);

    expect(result.isTruncated).toBe(true);
    expect(result.text).toContain(`showing the first ${MAX_ROWS} of 60 rows`);
    /* The 51st row is gone; the 50th is still there. */
    expect(result.text).toContain("index=49");
    expect(result.text).not.toContain("index=50");
  });

  test("the reported row count is the total the caller knows, not the slice", () => {
    const result: SerializedResult = ToolResultSerializer.serializeRows(
      [{ a: 1 }],
      4200,
    );

    expect(result.rowCount).toBe(4200);
  });

  test("the payload is capped in BYTES and says it was capped", () => {
    const rows: Array<JSONObject> = [];

    for (let index: number = 0; index < MAX_ROWS; index++) {
      rows.push({ index: index, body: "y".repeat(MAX_FIELD_LENGTH) });
    }

    const result: SerializedResult = ToolResultSerializer.serializeRows(rows);

    expect(result.isTruncated).toBe(true);
    expect(result.text).toContain("[payload truncated]");
  });

  test("one oversized row is hard-sliced rather than returned whole", () => {
    const oneBigRow: Array<JSONObject> = [];
    const wide: JSONObject = {};

    /* Many fields, each under the per-field cap, well past the payload cap. */
    for (let index: number = 0; index < 200; index++) {
      wide[`field${index}`] = "z".repeat(MAX_FIELD_LENGTH);
    }
    oneBigRow.push(wide);

    const result: SerializedResult =
      ToolResultSerializer.serializeRows(oneBigRow);

    expect(result.isTruncated).toBe(true);
    expect(result.text).toContain("[payload truncated]");
    expect(Buffer.byteLength(result.text, "utf8")).toBeLessThan(
      MAX_PAYLOAD_BYTES + 200,
    );
  });

  test("bytes reports the size of the text actually returned", () => {
    const result: SerializedResult = ToolResultSerializer.serializeRows([
      { service: "checkout" },
    ]);

    expect(result.bytes).toBe(Buffer.byteLength(result.text, "utf8"));
  });
});

describe("ToolResultSerializer.serializeText", () => {
  test("free-form text is redacted and its count reported", () => {
    const result: SerializedResult = ToolResultSerializer.serializeText(
      "root span for alice@example.com",
      1,
    );

    expect(result.text).toContain("[redacted-email]");
    expect(result.redactionCount).toBe(1);
    expect(result.rowCount).toBe(1);
  });

  test("empty text says so rather than returning nothing", () => {
    const result: SerializedResult = ToolResultSerializer.serializeText("", 0);

    expect(result.text).toBe("(no data found)");
    expect(result.isTruncated).toBe(false);
  });

  test("oversized text is byte-capped and marked", () => {
    const result: SerializedResult = ToolResultSerializer.serializeText(
      "q".repeat(MAX_PAYLOAD_BYTES + 1000),
      1,
    );

    expect(result.isTruncated).toBe(true);
    expect(result.text).toContain("[payload truncated]");
  });

  test("multi-byte characters are cut on a byte boundary without exploding", () => {
    /* 3 bytes each, so this is comfortably past the cap in bytes. */
    const result: SerializedResult = ToolResultSerializer.serializeText(
      "☃".repeat(MAX_PAYLOAD_BYTES),
      1,
    );

    expect(result.isTruncated).toBe(true);
    expect(Buffer.byteLength(result.text, "utf8")).toBeLessThan(
      MAX_PAYLOAD_BYTES + 100,
    );
  });

  test("text under the cap is returned as-is", () => {
    const result: SerializedResult = ToolResultSerializer.serializeText(
      "a short trace tree",
      3,
    );

    expect(result.text).toBe("a short trace tree");
    expect(result.isTruncated).toBe(false);
    expect(result.rowCount).toBe(3);
  });
});
