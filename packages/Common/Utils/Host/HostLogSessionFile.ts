import { HostLogSessionLevel } from "../../Types/Host/HostLogSession";
import { JSONObject } from "../../Types/JSON";

/*
 * A log session's lines as a file (#9966): what a vendor's support asks for
 * when an app misbehaves on a device - a Logcat text file, as
 * `logcat -v threadtime` prints it:
 *
 *   11-19 14:03:07.123  1234  1250 I ActivityManager: Start proc 4321:com.example/u0a190
 *
 * the date and time to the millisecond, the process and thread ids, the
 * priority letter, the tag padded to eight, then the message - each line of
 * a message on a line of its own, with the same prefix, as Logcat writes
 * it. A buffer's lines start with Logcat's own "--------- beginning of main".
 *
 * The lines are the ones OneUptime keeps of the session - the agent's
 * redaction and the project's scrub rules already applied - read with the
 * reader's own permissions (Server/Utils/Host/HostLogSessionLines). Times
 * are in UTC, with the year in the header, since threadtime has none and a
 * device's own zone is not known. The header is written as Logcat's
 * dividers are, so tools that read Logcat's text read past it.
 *
 * A file holds at most MAX_LINES lines and MAX_BYTES bytes; one cut short
 * says so at its end, with how many lines the session has.
 */

export const HOST_LOG_SESSION_FILE_MAX_LINES: number = 100_000;

export const HOST_LOG_SESSION_FILE_MAX_BYTES: number = 32 * 1024 * 1024;

// Logcat's own divider, which a reader of its text skips.
export const LOGCAT_DIVIDER: string = "---------";

// What OneUptime keeps of a line the agent read from a session.
export interface HostLogSessionLine {
  time?: Date | string | undefined;
  severityNumber?: number | string | undefined;
  severityText?: string | undefined;
  body?: string | undefined;
  attributes?: JSONObject | undefined;
}

// The session a file is of, as its header says it.
export interface HostLogSessionFileHeader {
  sessionId: string;
  deviceName: string;
  requestedBy?: string | undefined;
  requestedAt?: Date | undefined;
  note?: string | undefined;
  minimumLevel?: HostLogSessionLevel | undefined;
}

export interface HostLogSessionFile {
  fileName: string;
  content: string;
  // Lines of the session in the file, not counting the header.
  lineCount: number;
  // Whether the session has lines the file could not hold.
  isTruncated: boolean;
}

export type LogcatPriority = "V" | "D" | "I" | "W" | "E" | "F";

const LEVEL_WORDS: Record<HostLogSessionLevel, string> = {
  [HostLogSessionLevel.Info]: "Info",
  [HostLogSessionLevel.Debug]: "Debug",
  [HostLogSessionLevel.Verbose]: "Verbose",
};

// A severity's word, as OneUptime keeps it (LogSeverity) or as OTLP writes it.
const PRIORITY_BY_SEVERITY_TEXT: Record<string, LogcatPriority> = {
  trace: "V",
  verbose: "V",
  debug: "D",
  information: "I",
  info: "I",
  warning: "W",
  warn: "W",
  error: "E",
  fatal: "F",
  assert: "F",
};

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

// UTF-8 bytes of a text, without TextEncoder: Common runs where it may not be.
export function utf8Length(text: string): number {
  let bytes: number = 0;

  for (const character of text) {
    const code: number = character.codePointAt(0)!;
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }

  return bytes;
}

function toDate(value: Date | string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }

  const date: Date = value instanceof Date ? value : new Date(value);
  return isNaN(date.getTime()) ? undefined : date;
}

function toInteger(value: unknown): number {
  const number: number =
    typeof value === "number" ? value : parseInt(String(value ?? ""), 10);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export default class HostLogSessionFileWriter {
  private readonly header: HostLogSessionFileHeader;
  private readonly maxLines: number;
  private readonly maxBytes: number;
  private readonly parts: Array<string> = [];
  private readonly buffersSeen: Set<string> = new Set<string>();
  private bytes: number = 0;
  private lines: number = 0;
  private isFull: boolean = false;

  public constructor(
    header: HostLogSessionFileHeader,
    limits: { maxLines?: number; maxBytes?: number } = {},
  ) {
    this.header = header;
    this.maxLines = limits.maxLines ?? HOST_LOG_SESSION_FILE_MAX_LINES;
    this.maxBytes = limits.maxBytes ?? HOST_LOG_SESSION_FILE_MAX_BYTES;

    for (const line of HostLogSessionFileWriter.headerLines(header)) {
      this.write(line);
    }
  }

  // The priority letter Logcat writes for a line's severity.
  public static priorityOf(line: HostLogSessionLine): LogcatPriority {
    const number: number = toInteger(line.severityNumber);

    if (number >= 1 && number <= 24) {
      const priorities: Array<LogcatPriority> = ["V", "D", "I", "W", "E", "F"];
      return priorities[Math.floor((number - 1) / 4)]!;
    }

    return (
      PRIORITY_BY_SEVERITY_TEXT[text(line.severityText).trim().toLowerCase()] ||
      "I"
    );
  }

  // "11-19 14:03:07.123": threadtime's date and time, in UTC.
  public static formatTime(date: Date): string {
    return `${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())} ${pad2(
      date.getUTCHours(),
    )}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}.${date
      .getUTCMilliseconds()
      .toString()
      .padStart(3, "0")}`;
  }

  // "2026-11-19 14:02 UTC", for the header.
  public static formatHeaderTime(date: Date): string {
    return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(
      date.getUTCDate(),
    )} ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())} UTC`;
  }

  /*
   * A line as `logcat -v threadtime` prints it: one per line of its
   * message, each with the same prefix. A line with no time is not one the
   * device sent, and is left out.
   */
  public static formatLine(line: HostLogSessionLine): Array<string> {
    const time: Date | undefined = toDate(line.time);

    if (!time) {
      return [];
    }

    const attributes: JSONObject = line.attributes || {};
    const pid: string = toInteger(attributes["process.pid"])
      .toString()
      .padStart(5, " ");
    const tid: string = toInteger(attributes["thread.id"])
      .toString()
      .padStart(5, " ");
    const tag: string = text(attributes["android.log.tag"]).padEnd(8, " ");
    const prefix: string = `${HostLogSessionFileWriter.formatTime(time)} ${pid} ${tid} ${HostLogSessionFileWriter.priorityOf(line)} ${tag}: `;

    return text(line.body)
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((messageLine: string): string => {
        return `${prefix}${messageLine}`;
      });
  }

  // What the file's first lines say of the session, as Logcat's dividers.
  public static headerLines(header: HostLogSessionFileHeader): Array<string> {
    const asked: string = [
      `${LOGCAT_DIVIDER} OneUptime log session ${header.sessionId} on ${HostLogSessionFileWriter.oneLine(header.deviceName)}`,
      header.requestedBy
        ? `, requested by ${HostLogSessionFileWriter.oneLine(header.requestedBy)}`
        : "",
      header.requestedAt
        ? ` on ${HostLogSessionFileWriter.formatHeaderTime(header.requestedAt)}`
        : "",
    ].join("");

    const lines: Array<string> = [asked];

    if (header.note) {
      lines.push(
        `${LOGCAT_DIVIDER} Note: ${HostLogSessionFileWriter.oneLine(header.note)}`,
      );
    }

    const level: string =
      LEVEL_WORDS[header.minimumLevel || HostLogSessionLevel.Info] || "Info";

    lines.push(
      `${LOGCAT_DIVIDER} ${level} and above, as logcat -v threadtime, times in UTC`,
    );

    return lines;
  }

  private static oneLine(value: string): string {
    return value.replace(/\s+/g, " ").trim();
  }

  // The file's name: the device's, the session's and the day it was asked for.
  public static fileName(header: HostLogSessionFileHeader): string {
    const device: string =
      header.deviceName
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .replace(/^[-.]+|[-.]+$/g, "")
        .substring(0, 60) || "device";
    const when: string = header.requestedAt
      ? `-${header.requestedAt.toISOString().slice(0, 16).replace(/[:T]/g, "-")}`
      : "";

    return `${device}-log-session${when}.txt`;
  }

  /*
   * Adds a line of the session, in order. False once the file is full: the
   * line was not added, and the caller stops reading.
   */
  public add(line: HostLogSessionLine): boolean {
    if (this.isFull) {
      return false;
    }

    const formatted: Array<string> = HostLogSessionFileWriter.formatLine(line);

    if (formatted.length === 0) {
      return true;
    }

    if (this.lines >= this.maxLines) {
      this.isFull = true;
      return false;
    }

    const buffer: string = text(line.attributes?.["android.log.buffer"]).trim();
    const divider: Array<string> =
      buffer && !this.buffersSeen.has(buffer)
        ? [`${LOGCAT_DIVIDER} beginning of ${buffer}`]
        : [];
    const added: Array<string> = [...divider, ...formatted];
    const addedBytes: number = added.reduce(
      (sum: number, value: string): number => {
        return sum + utf8Length(value) + 1;
      },
      0,
    );

    if (this.bytes + addedBytes > this.maxBytes) {
      this.isFull = true;
      return false;
    }

    if (buffer) {
      this.buffersSeen.add(buffer);
    }

    for (const value of added) {
      this.write(value);
    }

    this.lines++;
    return true;
  }

  // Whether a line was refused: the file holds all it can.
  public get full(): boolean {
    return this.isFull;
  }

  public get lineCount(): number {
    return this.lines;
  }

  /*
   * The file. `totalLineCount`, when known, is how many lines the session
   * has: a file that holds fewer says so at its end.
   */
  public finish(
    data: { totalLineCount?: number | undefined } = {},
  ): HostLogSessionFile {
    const total: number | undefined = data.totalLineCount;
    const isTruncated: boolean =
      this.isFull || (total !== undefined && total > this.lines);
    const parts: Array<string> = [...this.parts];

    if (isTruncated) {
      const limit: string = `A file holds at most ${this.maxLines} lines and ${Math.round(this.maxBytes / (1024 * 1024))} MB; read the rest in Logs.`;

      parts.push(
        total !== undefined && total > this.lines
          ? `${LOGCAT_DIVIDER} OneUptime: the first ${this.lines} lines of ${total}. ${limit}`
          : `${LOGCAT_DIVIDER} OneUptime: the first ${this.lines} lines. ${limit}`,
      );
    } else if (this.lines === 0) {
      parts.push(
        `${LOGCAT_DIVIDER} OneUptime: no lines from this session yet.`,
      );
    }

    return {
      fileName: HostLogSessionFileWriter.fileName(this.header),
      content: parts.join("\n") + "\n",
      lineCount: this.lines,
      isTruncated: isTruncated,
    };
  }

  private write(value: string): void {
    this.parts.push(value);
    this.bytes += utf8Length(value) + 1;
  }
}
