import { JSONObject, JSONValue } from "../../../../Types/JSON";

/*
 * Prepares tool results for the LLM prompt: redacts likely secrets/PII,
 * truncates long fields, and caps total payload size. Everything that enters
 * the prompt (and therefore leaves for the LLM provider, and is previewed in
 * LlmLog.requestPrompt) passes through here first.
 */

const MAX_ROWS: number = 50;
const MAX_FIELD_LENGTH: number = 500;
const MAX_PAYLOAD_BYTES: number = 16 * 1024;

interface RedactionRule {
  name: string;
  regex: RegExp;
  replacement: string;
}

/*
 * These are security redactions, not the fingerprint-normalization regexes
 * (those normalize numbers/uuids for grouping and do not cover credentials).
 */
const REDACTION_RULES: Array<RedactionRule> = [
  {
    name: "jwt",
    regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g,
    replacement: "[redacted-jwt]",
  },
  {
    name: "bearer",
    regex: /Bearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi,
    replacement: "Bearer [redacted-token]",
  },
  {
    name: "email",
    regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    replacement: "[redacted-email]",
  },
  {
    name: "ipv4",
    regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    replacement: "[redacted-ip]",
  },
  {
    name: "hex-secret",
    regex: /\b[0-9a-fA-F]{32,}\b/g,
    replacement: "[redacted-hex]",
  },
  {
    name: "key-value-secret",
    regex:
      /\b(password|passwd|secret|api[_-]?key|access[_-]?token|authorization)\b(\s*[:=]\s*)("[^"]{4,}"|'[^']{4,}'|[^\s,;&]{4,})/gi,
    replacement: "$1$2[redacted]",
  },
];

export interface SerializedResult {
  text: string;
  rowCount: number;
  redactionCount: number;
  isTruncated: boolean;
  bytes: number;
}

export default class ToolResultSerializer {
  // Single pass per rule: count and substitute ($1/$2 groups) together.
  private static applyRedactionRule(
    text: string,
    rule: RedactionRule,
  ): { text: string; count: number } {
    let count: number = 0;

    const result: string = text.replace(
      rule.regex,
      (...matchArgs: Array<unknown>): string => {
        count++;
        return rule.replacement.replace(
          /\$(\d)/g,
          (_full: string, groupIndex: string): string => {
            return String(matchArgs[Number(groupIndex)] ?? "");
          },
        );
      },
    );

    return { text: result, count };
  }

  public static redact(text: string): { text: string; count: number } {
    let redacted: string = text;
    let count: number = 0;

    for (const rule of REDACTION_RULES) {
      const applied: { text: string; count: number } = this.applyRedactionRule(
        redacted,
        rule,
      );
      redacted = applied.text;
      count += applied.count;
    }

    return { text: redacted, count };
  }

  // Byte-accurate truncation (substring counts UTF-16 units, not bytes).
  private static truncateToBytes(text: string, maxBytes: number): string {
    if (Buffer.byteLength(text, "utf8") <= maxBytes) {
      return text;
    }
    return Buffer.from(text, "utf8").subarray(0, maxBytes).toString("utf8");
  }

  private static truncateField(value: string): {
    value: string;
    truncated: boolean;
  } {
    if (value.length <= MAX_FIELD_LENGTH) {
      return { value, truncated: false };
    }
    return {
      value: `${value.substring(0, MAX_FIELD_LENGTH)}… [truncated]`,
      truncated: true,
    };
  }

  private static serializeValue(value: JSONValue): string {
    if (value === null || value === undefined) {
      return "";
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (typeof value === "object") {
      return JSON.stringify(value);
    }
    return String(value);
  }

  /*
   * Serialize rows as a compact markdown-ish record list. Applies row cap,
   * per-field truncation, redaction and total payload cap.
   */
  public static serializeRows(
    rows: Array<JSONObject>,
    totalRowCount?: number,
  ): SerializedResult {
    let isTruncated: boolean = false;
    let redactionCount: number = 0;

    let rowsToSerialize: Array<JSONObject> = rows;
    if (rows.length > MAX_ROWS) {
      rowsToSerialize = rows.slice(0, MAX_ROWS);
      isTruncated = true;
    }

    const lines: Array<string> = [];

    for (const row of rowsToSerialize) {
      const parts: Array<string> = [];

      for (const key of Object.keys(row)) {
        const rawValue: string = this.serializeValue(row[key] as JSONValue);
        if (!rawValue) {
          continue;
        }

        const redacted: { text: string; count: number } = this.redact(rawValue);
        redactionCount += redacted.count;

        const truncated: { value: string; truncated: boolean } =
          this.truncateField(redacted.text);
        if (truncated.truncated) {
          isTruncated = true;
        }

        parts.push(`${key}=${truncated.value}`);
      }

      lines.push(`- ${parts.join(" | ")}`);
    }

    let text: string = lines.join("\n");

    if (Buffer.byteLength(text, "utf8") > MAX_PAYLOAD_BYTES) {
      isTruncated = true;
      while (
        lines.length > 1 &&
        Buffer.byteLength(lines.join("\n"), "utf8") > MAX_PAYLOAD_BYTES
      ) {
        lines.pop();
      }
      // A single oversized row can still exceed the cap — hard-slice it.
      text = `${this.truncateToBytes(lines.join("\n"), MAX_PAYLOAD_BYTES)}\n… [payload truncated]`;
    }

    const rowCount: number = totalRowCount ?? rows.length;

    if (rows.length === 0) {
      text = "(no rows found)";
    }

    return {
      text,
      rowCount,
      redactionCount,
      isTruncated,
      bytes: Buffer.byteLength(text, "utf8"),
    };
  }

  // Serialize free-form text (e.g. a rendered trace tree).
  public static serializeText(
    text: string,
    rowCount: number,
  ): SerializedResult {
    const redacted: { text: string; count: number } = this.redact(text);
    let output: string = redacted.text;
    let isTruncated: boolean = false;

    if (Buffer.byteLength(output, "utf8") > MAX_PAYLOAD_BYTES) {
      output = `${this.truncateToBytes(output, MAX_PAYLOAD_BYTES)}… [payload truncated]`;
      isTruncated = true;
    }

    if (!output) {
      output = "(no data found)";
    }

    return {
      text: output,
      rowCount,
      redactionCount: redacted.count,
      isTruncated,
      bytes: Buffer.byteLength(output, "utf8"),
    };
  }
}
