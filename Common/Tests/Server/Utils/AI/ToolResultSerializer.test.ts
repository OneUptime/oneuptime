import ToolResultSerializer, {
  SerializedResult,
} from "../../../../Server/Utils/AI/Toolbox/Serializer";
import { JSONObject } from "../../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

describe("ToolResultSerializer.redact", () => {
  test("redacts email addresses", () => {
    const result: { text: string; count: number } = ToolResultSerializer.redact(
      "user john.doe@example.com logged in",
    );
    expect(result.text).toBe("user [redacted-email] logged in");
    expect(result.count).toBe(1);
  });

  test("redacts JWTs", () => {
    const jwt: string = `eyJhbGciOiJIUzI1NiJ9.${"a".repeat(20)}.${"b".repeat(10)}`;
    const result: { text: string; count: number } = ToolResultSerializer.redact(
      `token=${jwt} used`,
    );
    expect(result.text).toContain("[redacted-jwt]");
    expect(result.text).not.toContain(jwt);
  });

  test("redacts bearer tokens", () => {
    const result: { text: string; count: number } = ToolResultSerializer.redact(
      "Authorization: Bearer abcdefghijklmnop1234567890",
    );
    expect(result.text).not.toContain("abcdefghijklmnop1234567890");
    expect(result.text).toContain("[redacted");
  });

  test("redacts IPv4 addresses", () => {
    const result: { text: string; count: number } = ToolResultSerializer.redact(
      "request from 203.0.113.42 failed",
    );
    expect(result.text).toBe("request from [redacted-ip] failed");
  });

  test("redacts long hex strings", () => {
    const hex: string = "deadbeef".repeat(5);
    const result: { text: string; count: number } = ToolResultSerializer.redact(
      `session ${hex} expired`,
    );
    expect(result.text).toContain("[redacted-hex]");
  });

  test("preserves 32-char OTel trace IDs and 16-char span IDs", () => {
    /*
     * Exactly 32 hex = W3C/OTel trace ID; exactly 16 hex = span ID. Both must
     * survive so the model can pivot search_logs -> get_trace.
     */
    const traceId: string = "4bf92f3577b34da6a3ce929d0e0e4736";
    const spanId: string = "00f067aa0ba902b7";
    const result: { text: string; count: number } = ToolResultSerializer.redact(
      `traceId=${traceId} spanId=${spanId}`,
    );
    expect(result.text).toContain(traceId);
    expect(result.text).toContain(spanId);
    expect(result.text).not.toContain("[redacted-hex]");
    expect(result.count).toBe(0);
  });

  test("still redacts hex secrets longer than a trace ID (33+ chars)", () => {
    const sha256: string = "a".repeat(64);
    const result: { text: string; count: number } = ToolResultSerializer.redact(
      `digest ${sha256} verified`,
    );
    expect(result.text).toContain("[redacted-hex]");
    expect(result.text).not.toContain(sha256);
  });

  test("redacts key=value secrets and keeps the key via capture groups", () => {
    const result: { text: string; count: number } = ToolResultSerializer.redact(
      "config: password=supersecretvalue retries=3",
    );
    expect(result.text).toContain("password=[redacted]");
    expect(result.text).not.toContain("supersecretvalue");
    expect(result.text).toContain("retries=3");
  });

  test("leaves benign text untouched", () => {
    const text: string = "p95 latency is 230ms for checkout";
    const result: { text: string; count: number } =
      ToolResultSerializer.redact(text);
    expect(result.text).toBe(text);
    expect(result.count).toBe(0);
  });
});

describe("ToolResultSerializer.serializeRows", () => {
  test("caps rows at 50 and marks truncation", () => {
    const rows: Array<JSONObject> = [];
    for (let i: number = 0; i < 80; i++) {
      rows.push({ index: i, value: `row-${i}` });
    }

    const result: SerializedResult = ToolResultSerializer.serializeRows(rows);
    expect(result.isTruncated).toBe(true);
    expect(result.rowCount).toBe(80);
    expect(result.text.split("\n").length).toBeLessThanOrEqual(51);
  });

  test("tells the model how many rows were hidden when capped", () => {
    const rows: Array<JSONObject> = [];
    for (let i: number = 0; i < 80; i++) {
      rows.push({ index: i, value: `row-${i}` });
    }

    const result: SerializedResult = ToolResultSerializer.serializeRows(rows);
    expect(result.text).toContain("first 50 of 80 rows");
  });

  test("does not add a truncation marker when rows fit", () => {
    const rows: Array<JSONObject> = [{ index: 1 }, { index: 2 }];
    const result: SerializedResult = ToolResultSerializer.serializeRows(rows);
    expect(result.isTruncated).toBe(false);
    expect(result.text).not.toContain("showing the first");
  });

  test("truncates long field values", () => {
    const result: SerializedResult = ToolResultSerializer.serializeRows([
      { body: "x".repeat(2000) },
    ]);
    expect(result.isTruncated).toBe(true);
    expect(result.text).toContain("[truncated]");
    expect(result.text.length).toBeLessThan(700);
  });

  test("caps total payload size", () => {
    const rows: Array<JSONObject> = [];
    for (let i: number = 0; i < 50; i++) {
      rows.push({ body: "y".repeat(490) });
    }
    const result: SerializedResult = ToolResultSerializer.serializeRows(rows);
    expect(Buffer.byteLength(result.text, "utf8")).toBeLessThanOrEqual(
      17 * 1024,
    );
    expect(result.isTruncated).toBe(true);
  });

  test("reports zero rows honestly", () => {
    const result: SerializedResult = ToolResultSerializer.serializeRows([]);
    expect(result.rowCount).toBe(0);
    expect(result.text).toBe("(no rows found)");
  });

  test("redacts inside rows", () => {
    const result: SerializedResult = ToolResultSerializer.serializeRows([
      { body: "contact admin@corp.com now" },
    ]);
    expect(result.text).toContain("[redacted-email]");
    expect(result.redactionCount).toBe(1);
  });
});

describe("ToolResultSerializer.redact — additional credential formats", () => {
  test("redacts PEM private key blocks", () => {
    const key: string = `-----BEGIN RSA PRIVATE KEY-----
MIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Qu
KUpRKfFLfRYC9AIKjbJTWit+CqvjWYzvQwECAwEAAQ==
-----END RSA PRIVATE KEY-----`;
    const result: { text: string; count: number } = ToolResultSerializer.redact(
      `key:\n${key}`,
    );
    expect(result.text).toContain("[redacted-private-key]");
    expect(result.text).not.toContain("MIIBOgIBAAJBAKj34");
  });

  test("redacts AWS access key ids", () => {
    const result: { text: string; count: number } = ToolResultSerializer.redact(
      "aws_key=AKIAIOSFODNN7EXAMPLE region=us-east-1",
    );
    expect(result.text).toContain("[redacted-aws-key]");
    expect(result.text).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  test("redacts GitHub tokens", () => {
    const token: string = `ghp_${"a".repeat(36)}`;
    const result: { text: string; count: number } = ToolResultSerializer.redact(
      `remote https://${token}@github.com/x/y`,
    );
    expect(result.text).toContain("[redacted-github-token]");
    expect(result.text).not.toContain(token);
  });

  test("redacts Slack tokens", () => {
    const result: { text: string; count: number } = ToolResultSerializer.redact(
      "SLACK_TOKEN=xoxb-1234567890-abcdefghijklmnop",
    );
    expect(result.text).toContain("[redacted-slack-token]");
    expect(result.text).not.toContain("xoxb-1234567890-abcdefghijklmnop");
  });

  test("redacts Google API keys", () => {
    const apiKey: string = `AIza${"a".repeat(35)}`;
    const result: { text: string; count: number } = ToolResultSerializer.redact(
      `key=${apiKey}`,
    );
    expect(result.text).toContain("[redacted-google-api-key]");
    expect(result.text).not.toContain(apiKey);
  });

  test("redacts grouped payment card numbers", () => {
    const result: { text: string; count: number } = ToolResultSerializer.redact(
      "charge 4111 1111 1111 1111 ok",
    );
    expect(result.text).toContain("[redacted-card]");
    expect(result.text).not.toContain("4111 1111 1111 1111");
  });

  test("does not redact a bare 16-digit number (span-id collision guard)", () => {
    /*
     * An all-numeric 16-char span id must survive; only the space/dash-grouped
     * card form is redacted, so a bare 16-digit run stays intact.
     */
    const numeric: string = "1234567890123456";
    const result: { text: string; count: number } = ToolResultSerializer.redact(
      `value=${numeric}`,
    );
    expect(result.text).toContain(numeric);
  });
});
