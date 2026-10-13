import OneUptimeDate from "../../Types/Date";

/*
 * Reads one syslog message: the priority, then either an RFC 5424 header
 * (version, timestamp, host, app, process id, message id, structured data)
 * or an RFC 3164 one (timestamp, host, tag), then the message.
 *
 * It is the one reader for every way syslog reaches OneUptime - posted to
 * /syslog/v1/logs or forwarded by a probe that listens for it - so the two
 * can never disagree about what a line says.
 *
 * Devices send plenty that neither RFC describes, and none of it is
 * dropped: a line with a priority and an unreadable header keeps its whole
 * text as the message, and a line with no priority at all is still read.
 * The shapes below come up often enough to have a rule of their own:
 *
 *   - No hostname. ExtremeXOS leaves it out by default ("May 29 12:17:20
 *     SNTP: <Warn> ..."), so the word after the timestamp is the tag. A
 *     word that ends in a colon is read as the tag, not as a host.
 *   - No tag. Firewalls send their whole event as key=value pairs.
 *   - CEF. "CEF:0|Vendor|..." after the host is the message, not a tag
 *     named CEF.
 */

export interface ParsedSyslogStructuredData {
  [sdId: string]: {
    [key: string]: string;
  };
}

export interface ParsedSyslogMessage {
  raw: string;
  message: string;
  /*
   * Everything after the header, as the device wrote it: for an RFC 3164
   * line the text after the host name, with its tag still on it. A vendor's
   * own format often starts where a tag would be ("00076 ports: port 3 is
   * now on-line"), so this, not `message`, is what vendor parsers read.
   * Absent when it would be the same as `message`.
   */
  content?: string | undefined;
  priority?: number | undefined;
  severity?: number | undefined;
  facility?: number | undefined;
  version?: number | undefined;
  timestamp?: Date | undefined;
  hostname?: string | undefined;
  appName?: string | undefined;
  procId?: string | undefined;
  msgId?: string | undefined;
  structuredDataRaw?: string | undefined;
  structuredData?: ParsedSyslogStructuredData | undefined;
}

// The header a message came with, for callers that treat the two apart.
export enum SyslogHeaderFormat {
  Rfc5424 = "rfc5424",
  Rfc3164 = "rfc3164",
  // A priority or nothing, and then text.
  None = "none",
}

const PRIORITY: RegExp = /^<(\d{1,3})>/;

/*
 * An RFC 5424 version: one to three digits, not starting with 0. A year
 * ("2026 Oct 13 10:11:12 nexus1 ...", as NX-OS writes its time) is not one.
 */
const VERSION: RegExp = /^[1-9]\d{0,2}$/;

const NIL_TIMESTAMP: RegExp = /^NILVALUE$/i;

const RFC3164_HEADER: RegExp =
  /^(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+(\S+)\s+(.*)$/;

// A tag word (no spaces, colons, brackets, quotes or "="), an optional [pid], then ":".
const RFC3164_TAG_WITH_COLON: RegExp = /^([^\s:=[\]"']+)(?:\[([^\]]*)\])?:\s*/;

// The same shape, as the whole of the word after the timestamp.
const TAG_IN_PLACE_OF_HOST: RegExp = /^([^\s:=[\]"']+)(?:\[([^\]]*)\])?:$/;

// A word that is a key=value pair rather than a tag.
const KEY_VALUE_TOKEN: RegExp = /[=]/;

const FIRST_WORD: RegExp = /^(\S+)/;

const WORD_WITH_PROCESS_ID: RegExp = /^([^[]+)\[(.+)\]$/;

// "CEF:0|" - the start of a Common Event Format message.
const CEF_START: RegExp = /^CEF:\d+\|/;

const UNSAFE_KEY_CHARACTER: RegExp = /[^A-Za-z0-9_.-]/g;

const BYTE_ORDER_MARK: RegExp = /^﻿/;

export function getSyslogHeaderFormat(
  parsed: Pick<ParsedSyslogMessage, "version" | "timestamp" | "hostname">,
): SyslogHeaderFormat {
  if (parsed.version !== undefined) {
    return SyslogHeaderFormat.Rfc5424;
  }

  if (parsed.timestamp !== undefined || parsed.hostname !== undefined) {
    return SyslogHeaderFormat.Rfc3164;
  }

  return SyslogHeaderFormat.None;
}

export function parseSyslogMessage(raw: string): ParsedSyslogMessage | null {
  if (!raw) {
    return null;
  }

  const trimmed: string = raw.trim();

  if (!trimmed) {
    return null;
  }

  let remaining: string = trimmed;
  let priority: number | undefined;
  let severity: number | undefined;
  let facility: number | undefined;

  const priorityMatch: RegExpMatchArray | null = remaining.match(PRIORITY);

  if (priorityMatch) {
    priority = parseInt(priorityMatch[1]!, 10);

    if (!isNaN(priority)) {
      severity = priority % 8;
      facility = Math.floor(priority / 8);
    }

    remaining = remaining.slice(priorityMatch[0]!.length);
  }

  const rfc5424Parsed: ParsedSyslogMessage | null = parseRfc5424(remaining);

  if (rfc5424Parsed) {
    return {
      raw: trimmed,
      priority,
      severity: rfc5424Parsed.severity ?? severity,
      facility: rfc5424Parsed.facility ?? facility,
      version: rfc5424Parsed.version,
      timestamp: rfc5424Parsed.timestamp,
      hostname: rfc5424Parsed.hostname,
      appName: rfc5424Parsed.appName,
      procId: rfc5424Parsed.procId,
      msgId: rfc5424Parsed.msgId,
      structuredDataRaw: rfc5424Parsed.structuredDataRaw,
      structuredData: rfc5424Parsed.structuredData,
      message: stripBom(rfc5424Parsed.message ?? ""),
    };
  }

  const rfc3164Parsed: ParsedSyslogMessage | null = parseRfc3164(remaining);

  if (rfc3164Parsed) {
    const message: string = stripBom(rfc3164Parsed.message ?? "");

    return {
      raw: trimmed,
      priority,
      severity,
      facility,
      timestamp: rfc3164Parsed.timestamp,
      hostname: rfc3164Parsed.hostname,
      appName: rfc3164Parsed.appName,
      procId: rfc3164Parsed.procId,
      message: message,
      ...(rfc3164Parsed.content !== undefined &&
      rfc3164Parsed.content !== message
        ? { content: rfc3164Parsed.content }
        : {}),
    };
  }

  return {
    raw: trimmed,
    priority,
    severity,
    facility,
    message: stripBom(remaining.trim()),
  };
}

function parseRfc5424(payload: string): ParsedSyslogMessage | null {
  const tokens: Array<string> = splitTokens(payload, 7);

  if (tokens.length < 7) {
    return null;
  }

  const versionToken: string = tokens[0]!;

  if (!VERSION.test(versionToken)) {
    return null;
  }

  const version: number = parseInt(versionToken, 10);
  const timestampToken: string = tokens[1]!.trim().replace(NIL_TIMESTAMP, "-");
  const hostnameToken: string = tokens[2]!;
  const appNameToken: string = tokens[3]!;
  const procIdToken: string = tokens[4]!;
  const msgIdToken: string = tokens[5]!;
  const structuredDataAndMessage: string = tokens[6]!;

  const timestamp: Date | undefined =
    timestampToken && timestampToken !== "-"
      ? OneUptimeDate.parseRfc5424Timestamp(timestampToken)
      : undefined;

  const hostname: string | undefined =
    hostnameToken && hostnameToken !== "-" ? hostnameToken : undefined;

  const appName: string | undefined =
    appNameToken && appNameToken !== "-" ? appNameToken : undefined;

  const procId: string | undefined =
    procIdToken && procIdToken !== "-" ? procIdToken : undefined;

  const msgId: string | undefined =
    msgIdToken && msgIdToken !== "-" ? msgIdToken : undefined;

  const structuredDataParsed: {
    structuredDataRaw?: string;
    message?: string;
    structuredData?: ParsedSyslogStructuredData;
  } = extractStructuredData(structuredDataAndMessage);

  return {
    raw: payload,
    version,
    timestamp,
    hostname,
    appName,
    procId,
    msgId,
    structuredDataRaw: structuredDataParsed.structuredDataRaw,
    structuredData: structuredDataParsed.structuredData,
    message: structuredDataParsed.message ?? "",
  };
}

function parseRfc3164(payload: string): ParsedSyslogMessage | null {
  const match: RegExpMatchArray | null = payload.match(RFC3164_HEADER);

  if (!match) {
    return null;
  }

  const timestampToken: string = match[1]!;
  let hostname: string | undefined = match[2]!;
  let rest: string = match[3] ?? "";

  const timestamp: Date | undefined =
    OneUptimeDate.parseRfc3164Timestamp(timestampToken);

  let appName: string | undefined;
  let procId: string | undefined;

  /*
   * No hostname. A device that leaves it out (ExtremeXOS does by default)
   * puts its tag right after the timestamp, and a host name never ends in
   * a colon - so "vlan:" is the tag, and there is no host. The same goes
   * for "CEF:0|...": that is where the message starts.
   */
  const tagInPlaceOfHost: RegExpMatchArray | null =
    hostname.match(TAG_IN_PLACE_OF_HOST);

  if (CEF_START.test(hostname)) {
    return {
      raw: payload,
      timestamp,
      // Everything after the timestamp, as written.
      message: payload
        .slice(payload.indexOf(hostname, timestampToken.length))
        .trim(),
    };
  }

  if (tagInPlaceOfHost) {
    appName = tagInPlaceOfHost[1]?.trim();
    procId = tagInPlaceOfHost[2]?.trim() || undefined;
    hostname = undefined;

    return {
      raw: payload,
      timestamp,
      appName,
      procId,
      message: rest.trim(),
      content: payload
        .slice(payload.indexOf(match[2]!, timestampToken.length))
        .trim(),
    };
  }

  let message: string = rest.trim();
  const content: string = message;

  // "CEF:0|Vendor|..." is the message itself, not a tag named CEF.
  if (CEF_START.test(message)) {
    return {
      raw: payload,
      timestamp,
      hostname,
      message,
    };
  }

  /*
   * The tag is one word at the start, optionally with a [pid], ended by a
   * colon. Looking for the FIRST colon anywhere in the line instead read
   * key=value logs as a tag: a Sophos line's first colon sits inside
   * timestamp="2024-05-02T11:03:12", so everything before it became the app
   * name and the message lost its first pairs.
   */
  rest = message;
  const tagMatch: RegExpMatchArray | null = rest.match(RFC3164_TAG_WITH_COLON);

  if (tagMatch) {
    appName = tagMatch[1]?.trim();
    procId = tagMatch[2]?.trim() || undefined;
    message = rest.slice(tagMatch[0].length).trim();
  } else {
    const firstTokenMatch: RegExpMatchArray | null = rest.match(FIRST_WORD);

    /*
     * A first word that is a key=value pair is the start of the message,
     * not a tag - firewalls (Sophos, Fortinet) send their whole event as
     * pairs with no tag at all.
     */
    if (firstTokenMatch && !KEY_VALUE_TOKEN.test(firstTokenMatch[1]!)) {
      const firstToken: string = firstTokenMatch[1]!;
      const procMatch: RegExpMatchArray | null =
        firstToken.match(WORD_WITH_PROCESS_ID);

      if (procMatch) {
        appName = procMatch[1]?.trim();
        procId = procMatch[2]?.trim();
      } else {
        appName = firstToken.trim();
      }

      message = rest.slice(firstToken.length).trim();
    }
  }

  return {
    raw: payload,
    timestamp,
    hostname,
    appName,
    procId,
    message,
    content,
  };
}

function splitTokens(source: string, expected: number): Array<string> {
  const tokens: Array<string> = [];
  let remaining: string = source.trimStart();

  for (let i: number = 0; i < expected - 1; i++) {
    if (!remaining) {
      tokens.push("");
      continue;
    }

    const match: RegExpMatchArray | null = remaining.match(FIRST_WORD);

    if (!match) {
      tokens.push("");
      remaining = "";
      continue;
    }

    const token: string = match[1]!;
    tokens.push(token);
    remaining = remaining.slice(token.length).trimStart();
  }

  tokens.push(remaining);

  return tokens;
}

function extractStructuredData(value: string): {
  structuredDataRaw?: string;
  message?: string;
  structuredData?: ParsedSyslogStructuredData;
} {
  const trimmed: string = value.trimStart();

  if (!trimmed) {
    return { message: "" };
  }

  if (trimmed.startsWith("-")) {
    return { message: trimmed.slice(1).trimStart() };
  }

  if (!trimmed.startsWith("[")) {
    return { message: trimmed };
  }

  let depth: number = 0;

  for (let i: number = 0; i < trimmed.length; i++) {
    const char: string = trimmed[i]!;

    if (char === "[") {
      depth++;
    } else if (char === "]") {
      depth--;

      if (depth === 0) {
        let peekIndex: number = i + 1;

        while (peekIndex < trimmed.length && trimmed[peekIndex] === " ") {
          peekIndex++;
        }

        if (trimmed[peekIndex] === "[") {
          i = peekIndex - 1;
          continue;
        }

        const structuredDataRaw: string = trimmed.slice(0, i + 1).trimEnd();
        const message: string = trimmed.slice(i + 1).trimStart();

        return {
          structuredDataRaw,
          structuredData: parseStructuredData(structuredDataRaw),
          message,
        };
      }
    }
  }

  const structuredDataRaw: string = trimmed.trim();

  return {
    structuredDataRaw,
    structuredData: parseStructuredData(structuredDataRaw),
    message: "",
  };
}

function parseStructuredData(raw: string): ParsedSyslogStructuredData {
  const result: ParsedSyslogStructuredData = {};
  const sdRegex: RegExp = /\[([^\s\]]+)((?:\s+[^\s=]+="[^"]*")*)\]/g;
  let match: RegExpExecArray | null;

  while ((match = sdRegex.exec(raw)) !== null) {
    const sdIdRaw: string = match[1]!;
    const params: string = match[2] ?? "";
    const sdId: string = sanitizeKey(sdIdRaw);

    if (!result[sdId]) {
      result[sdId] = {};
    }

    const paramRegex: RegExp = /([^\s=]+)="([^"]*)"/g;
    let paramMatch: RegExpExecArray | null;

    while ((paramMatch = paramRegex.exec(params)) !== null) {
      const keyRaw: string = paramMatch[1]!;
      const value: string = paramMatch[2] ?? "";
      const key: string = sanitizeKey(keyRaw);
      const entry: { [key: string]: string } = result[sdId] ?? {};
      entry[key] = value;
      result[sdId] = entry;
    }
  }

  return result;
}

export function sanitizeSyslogAttributeKey(key: string): string {
  return key.replace(UNSAFE_KEY_CHARACTER, "_");
}

function sanitizeKey(key: string): string {
  return sanitizeSyslogAttributeKey(key);
}

function stripBom(value: string): string {
  if (!value) {
    return value;
  }

  let output: string = value.replace(BYTE_ORDER_MARK, "");

  if (output.startsWith("BOM")) {
    output = output.slice(3);
  }

  return output.trimStart();
}
