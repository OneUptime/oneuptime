import OneUptimeDate from "../../Types/Date";
import { SYSLOG_STRUCTURED_ATTRIBUTE_PREFIX } from "../../Types/Syslog/SyslogAttribute";
import { readOwnValue, writeOwnValue } from "../LookupTable";

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

// Where a part of a text sits in it: from `start` up to, not including, `end`.
export interface SyslogTextSpan {
  start: number;
  end: number;
}

/*
 * One RFC 5424 structured-data parameter as the line wrote it: its
 * element's SD-ID and its own name, before they are made safe for an
 * attribute key, its value with the escapes read, and where that value
 * sits between its quotes in the structured data, escapes and all.
 */
export interface SyslogStructuredDataParam {
  sdId: string;
  name: string;
  value: string;
  valueSpan: SyslogTextSpan;
}

/*
 * Where each part a reading took out of a line sits in the line (`raw`):
 * the header's fields, the structured data, and the message, which always
 * ends the line. So a copy of the line can be put together again from its
 * parts (SyslogRawCopies). A field the line does not have has no span.
 */
export interface SyslogLineLayout {
  hostname?: SyslogTextSpan | undefined;
  appName?: SyslogTextSpan | undefined;
  procId?: SyslogTextSpan | undefined;
  msgId?: SyslogTextSpan | undefined;
  structuredData?: SyslogTextSpan | undefined;
  message: SyslogTextSpan;
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
  // Where the fields above sit in `raw` (parseSyslogMessage fills it in).
  layout?: SyslogLineLayout | undefined;
}

// The header a message came with, for callers that treat the two apart.
export enum SyslogHeaderFormat {
  Rfc5424 = "rfc5424",
  Rfc3164 = "rfc3164",
  // A priority or nothing, and then text.
  None = "none",
}

/*
 * What a header reading found, before the message is cleaned up: its
 * fields, and where each sits in the text the reading was given.
 */
interface HeaderReading {
  fields: ParsedSyslogMessage;
  spans: Omit<SyslogLineLayout, "message">;
}

interface StructuredDataElement {
  sdId: string;
  params: Array<SyslogStructuredDataParam>;
  // Where its closing "]" is.
  close: number;
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

const BYTE_ORDER_MARK: RegExp = /^\uFEFF/;

const WHITESPACE: RegExp = /\s/;

// What RFC 5424 escapes in a parameter's value: '"', '\' and ']'.
const ESCAPED_IN_PARAM_VALUE: RegExp = /["\\\]]/g;

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
  // Where `remaining` starts in the line.
  let offset: number = 0;
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

    offset = priorityMatch[0]!.length;
    remaining = remaining.slice(offset);
  }

  const rfc5424Reading: HeaderReading | null = parseRfc5424(remaining);

  if (rfc5424Reading) {
    const rfc5424Parsed: ParsedSyslogMessage = rfc5424Reading.fields;
    const message: string = stripBom(rfc5424Parsed.message ?? "");

    return withLayout(
      {
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
        message: message,
      },
      rfc5424Reading.spans,
      offset,
    );
  }

  const rfc3164Reading: HeaderReading | null = parseRfc3164(remaining);

  if (rfc3164Reading) {
    const rfc3164Parsed: ParsedSyslogMessage = rfc3164Reading.fields;
    const message: string = stripBom(rfc3164Parsed.message ?? "");

    return withLayout(
      {
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
      },
      rfc3164Reading.spans,
      offset,
    );
  }

  return withLayout(
    {
      raw: trimmed,
      priority,
      severity,
      facility,
      message: stripBom(remaining.trim()),
    },
    {},
    offset,
  );
}

/*
 * The parsed line with where each of its parts sits in it. `spans` are in
 * the text after the priority, which starts at `offset`. The message is
 * what ends the line: every reading takes it from the end, and only cuts
 * from its start.
 *
 * Each span is checked against the text it names, and a reading whose
 * parts are not where it says has no layout at all: a copy of the line is
 * then never put together from parts that may not be its own.
 */
function withLayout(
  parsed: ParsedSyslogMessage,
  spans: Omit<SyslogLineLayout, "message">,
  offset: number,
): ParsedSyslogMessage {
  const line: string = parsed.raw;

  if (!line.endsWith(parsed.message)) {
    return parsed;
  }

  const layout: SyslogLineLayout = {
    message: {
      start: line.length - parsed.message.length,
      end: line.length,
    },
  };

  const expected: Array<[keyof Omit<SyslogLineLayout, "message">, unknown]> = [
    ["hostname", parsed.hostname],
    ["appName", parsed.appName],
    ["procId", parsed.procId],
    ["msgId", parsed.msgId],
    ["structuredData", parsed.structuredDataRaw],
  ];

  let previousEnd: number = 0;

  for (const [part, value] of expected) {
    const span: SyslogTextSpan | undefined = spans[part];

    if (value === undefined && span === undefined) {
      continue;
    }

    if (value === undefined || span === undefined) {
      return parsed;
    }

    const inLine: SyslogTextSpan = {
      start: span.start + offset,
      end: span.end + offset,
    };

    // Each part in the order a header writes them, none over another.
    if (
      inLine.start < previousEnd ||
      inLine.end > layout.message.start ||
      line.slice(inLine.start, inLine.end) !== value
    ) {
      return parsed;
    }

    layout[part] = inLine;
    previousEnd = inLine.end;
  }

  return { ...parsed, layout: layout };
}

function parseRfc5424(payload: string): HeaderReading | null {
  const tokens: Array<{ text: string; start: number }> = splitTokens(
    payload,
    7,
  );

  if (tokens.length < 7) {
    return null;
  }

  const versionToken: string = tokens[0]!.text;

  if (!VERSION.test(versionToken)) {
    return null;
  }

  const version: number = parseInt(versionToken, 10);
  const timestampToken: string = tokens[1]!.text
    .trim()
    .replace(NIL_TIMESTAMP, "-");
  const hostnameToken: string = tokens[2]!.text;
  const appNameToken: string = tokens[3]!.text;
  const procIdToken: string = tokens[4]!.text;
  const msgIdToken: string = tokens[5]!.text;
  const structuredDataAndMessage: string = tokens[6]!.text;

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
    structuredDataStart?: number;
    message?: string;
    structuredData?: ParsedSyslogStructuredData;
  } = extractStructuredData(structuredDataAndMessage);

  const tokenSpan: (
    token: { text: string; start: number },
    value: string | undefined,
  ) => SyslogTextSpan | undefined = (
    token: { text: string; start: number },
    value: string | undefined,
  ): SyslogTextSpan | undefined => {
    return value === undefined
      ? undefined
      : { start: token.start, end: token.start + token.text.length };
  };

  const structuredDataRaw: string | undefined =
    structuredDataParsed.structuredDataRaw;

  return {
    fields: {
      raw: payload,
      version,
      timestamp,
      hostname,
      appName,
      procId,
      msgId,
      structuredDataRaw: structuredDataRaw,
      structuredData: structuredDataParsed.structuredData,
      message: structuredDataParsed.message ?? "",
    },
    spans: {
      hostname: tokenSpan(tokens[2]!, hostname),
      appName: tokenSpan(tokens[3]!, appName),
      procId: tokenSpan(tokens[4]!, procId),
      msgId: tokenSpan(tokens[5]!, msgId),
      structuredData:
        structuredDataRaw === undefined
          ? undefined
          : {
              start:
                tokens[6]!.start +
                (structuredDataParsed.structuredDataStart ?? 0),
              end:
                tokens[6]!.start +
                (structuredDataParsed.structuredDataStart ?? 0) +
                structuredDataRaw.length,
            },
    },
  };
}

function parseRfc3164(payload: string): HeaderReading | null {
  const match: RegExpMatchArray | null = payload.match(RFC3164_HEADER);

  if (!match) {
    return null;
  }

  const timestampToken: string = match[1]!;
  let hostname: string | undefined = match[2]!;
  let rest: string = match[3] ?? "";

  // The header starts the text, and the rest ends it.
  const hostStart: number = payload.indexOf(hostname, timestampToken.length);
  const restStart: number = payload.length - rest.length;

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
      fields: {
        raw: payload,
        timestamp,
        // Everything after the timestamp, as written.
        message: payload
          .slice(payload.indexOf(hostname, timestampToken.length))
          .trim(),
      },
      spans: {},
    };
  }

  if (tagInPlaceOfHost) {
    appName = tagInPlaceOfHost[1]?.trim();
    procId = tagInPlaceOfHost[2]?.trim() || undefined;

    const tag: TagSpans = tagSpans(hostStart, tagInPlaceOfHost);

    hostname = undefined;

    return {
      fields: {
        raw: payload,
        timestamp,
        appName,
        procId,
        message: rest.trim(),
        content: payload
          .slice(payload.indexOf(match[2]!, timestampToken.length))
          .trim(),
      },
      spans: {
        appName: appName === undefined ? undefined : tag.appName,
        procId: procId === undefined ? undefined : tag.procId,
      },
    };
  }

  const hostSpan: SyslogTextSpan = {
    start: hostStart,
    end: hostStart + hostname.length,
  };

  let message: string = rest.trim();
  const content: string = message;
  // Where the trimmed rest - its tag first - starts in the text.
  const contentStart: number =
    restStart + (rest.length - rest.trimStart().length);

  // "CEF:0|Vendor|..." is the message itself, not a tag named CEF.
  if (CEF_START.test(message)) {
    return {
      fields: {
        raw: payload,
        timestamp,
        hostname,
        message,
      },
      spans: { hostname: hostSpan },
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
  let appNameSpan: SyslogTextSpan | undefined;
  let procIdSpan: SyslogTextSpan | undefined;

  if (tagMatch) {
    appName = tagMatch[1]?.trim();
    procId = tagMatch[2]?.trim() || undefined;
    message = rest.slice(tagMatch[0].length).trim();

    const tag: TagSpans = tagSpans(contentStart, tagMatch);

    appNameSpan = tag.appName;
    procIdSpan = procId === undefined ? undefined : tag.procId;
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

        // A word has no spaces, so neither part has any to trim.
        appNameSpan = {
          start: contentStart,
          end: contentStart + procMatch[1]!.length,
        };
        procIdSpan = {
          start: contentStart + procMatch[1]!.length + 1,
          end: contentStart + procMatch[1]!.length + 1 + procMatch[2]!.length,
        };
      } else {
        appName = firstToken.trim();
        appNameSpan = {
          start: contentStart,
          end: contentStart + firstToken.length,
        };
      }

      message = rest.slice(firstToken.length).trim();
    }
  }

  return {
    fields: {
      raw: payload,
      timestamp,
      hostname,
      appName,
      procId,
      message,
      content,
    },
    spans: {
      hostname: hostSpan,
      appName: appNameSpan,
      procId: procIdSpan,
    },
  };
}

interface TagSpans {
  appName: SyslogTextSpan;
  procId: SyslogTextSpan | undefined;
}

/*
 * Where a tag's name and process id sit, for a match of "name[pid]:" that
 * starts at `start`: the name is one word, and the process id is what is
 * between the brackets, its spaces trimmed off as the reading trims them.
 */
function tagSpans(start: number, tag: RegExpMatchArray): TagSpans {
  const name: string = tag[1]!;
  const inBrackets: string | undefined = tag[2];

  if (inBrackets === undefined) {
    return {
      appName: { start: start, end: start + name.length },
      procId: undefined,
    };
  }

  const leading: number = inBrackets.length - inBrackets.trimStart().length;
  const procIdStart: number = start + name.length + 1 + leading;

  return {
    appName: { start: start, end: start + name.length },
    procId: {
      start: procIdStart,
      end: procIdStart + inBrackets.trim().length,
    },
  };
}

// The first words of `source` and what is left after them, with where each starts.
function splitTokens(
  source: string,
  expected: number,
): Array<{ text: string; start: number }> {
  const tokens: Array<{ text: string; start: number }> = [];
  let remaining: string = source.trimStart();

  for (let i: number = 0; i < expected - 1; i++) {
    // `remaining` is always what ends `source`.
    const start: number = source.length - remaining.length;

    if (!remaining) {
      tokens.push({ text: "", start: start });
      continue;
    }

    const match: RegExpMatchArray | null = remaining.match(FIRST_WORD);

    if (!match) {
      tokens.push({ text: "", start: start });
      remaining = "";
      continue;
    }

    const token: string = match[1]!;
    tokens.push({ text: token, start: start });
    remaining = remaining.slice(token.length).trimStart();
  }

  tokens.push({ text: remaining, start: source.length - remaining.length });

  return tokens;
}

function extractStructuredData(value: string): {
  structuredDataRaw?: string;
  // Where the structured data starts in `value`.
  structuredDataStart?: number;
  message?: string;
  structuredData?: ParsedSyslogStructuredData;
} {
  const trimmed: string = value.trimStart();
  const start: number = value.length - trimmed.length;

  if (!trimmed) {
    return { message: "" };
  }

  if (trimmed.startsWith("-")) {
    return { message: trimmed.slice(1).trimStart() };
  }

  if (!trimmed.startsWith("[")) {
    return { message: trimmed };
  }

  const reading: { elements: Array<StructuredDataElement>; close: number } =
    readStructuredDataElements(trimmed);

  // Never closed: all of it is the structured data, and there is no message.
  if (reading.close === -1) {
    return {
      structuredDataRaw: trimmed.trim(),
      structuredDataStart: start,
      structuredData: structuredDataOf(reading.elements),
      message: "",
    };
  }

  return {
    structuredDataRaw: trimmed.slice(0, reading.close + 1),
    structuredDataStart: start,
    structuredData: structuredDataOf(reading.elements),
    message: trimmed.slice(reading.close + 1).trimStart(),
  };
}

/*
 * Reads RFC 5424 structured data - the text that starts with its first
 * "[", the message after it or not - into its parameters: each one's SD-ID
 * and name as written, its value with the escapes read, and where that
 * value sits in `structuredData`.
 *
 * The same reading the line's own gets, so it finds the same parameters in
 * a line's `structuredDataRaw` that parseSyslogMessage found in the line.
 */
export function readSyslogStructuredData(structuredData: string): {
  structuredData: ParsedSyslogStructuredData;
  params: Array<SyslogStructuredDataParam>;
} {
  if (!structuredData.startsWith("[")) {
    return { structuredData: {}, params: [] };
  }

  const elements: Array<StructuredDataElement> =
    readStructuredDataElements(structuredData).elements;

  return {
    structuredData: structuredDataOf(elements),
    params: elements.flatMap(
      (element: StructuredDataElement): Array<SyslogStructuredDataParam> => {
        return element.params;
      },
    ),
  };
}

/*
 * RFC 5424 structured data is one element after another: "[", an SD-ID,
 * name="value" parameters each after a space, "]". In a value, '"', '\'
 * and ']' are written '\"', '\\' and '\]', and a backslash before any
 * other character is a backslash (RFC 5424 6.3.3).
 *
 * Devices get it wrong, and a line is read as well as it can be:
 *
 *   - A "]" inside a quoted value does not end its element, escaped or not.
 *   - An element that does not read with its escapes - a Windows path that
 *     ends in a backslash, path="C:\" - is read as written, a value ending
 *     at the next quote, as before escapes were read.
 *   - An element that reads neither way keeps no parameters, and ends where
 *     its brackets close, counted as before.
 *   - Elements may have spaces between them.
 *
 * `text` starts with "[". `close` is where the last element's "]" is, or
 * -1 when an element never closes: then everything is the structured data.
 * Each element is read once, so this takes time in line with the text.
 */
function readStructuredDataElements(text: string): {
  elements: Array<StructuredDataElement>;
  close: number;
} {
  const elements: Array<StructuredDataElement> = [];
  let open: number = 0;

  for (;;) {
    const element: StructuredDataElement | null =
      readStructuredDataElement(text, open, true) ||
      readStructuredDataElement(text, open, false);

    let close: number;

    if (element) {
      elements.push(element);
      close = element.close;
    } else {
      close = closingBracketByDepth(text, open);

      if (close === -1) {
        return { elements: elements, close: -1 };
      }
    }

    let next: number = close + 1;

    while (next < text.length && text[next] === " ") {
      next++;
    }

    if (text[next] !== "[") {
      return { elements: elements, close: close };
    }

    open = next;
  }
}

/*
 * One element, at the "[" at `open`: "[" SD-ID, then each parameter after
 * one or more spaces, then "]" - exactly as the pattern
 * \[([^\s\]]+)((?:\s+[^\s=]+="VALUE")*)\] reads it, where a VALUE is
 * (?:[^"\\]|\\[\s\S])* with its escapes read, or [^"]* without. Null when
 * the element does not read so.
 */
function readStructuredDataElement(
  text: string,
  open: number,
  withEscapes: boolean,
): StructuredDataElement | null {
  let position: number = open + 1;

  while (
    position < text.length &&
    text[position] !== "]" &&
    !isWhitespace(text[position]!)
  ) {
    position++;
  }

  if (position === open + 1) {
    return null;
  }

  const sdId: string = text.slice(open + 1, position);
  const params: Array<SyslogStructuredDataParam> = [];

  for (;;) {
    if (position >= text.length) {
      return null;
    }

    if (text[position] === "]") {
      return { sdId: sdId, params: params, close: position };
    }

    if (!isWhitespace(text[position]!)) {
      return null;
    }

    while (position < text.length && isWhitespace(text[position]!)) {
      position++;
    }

    const nameStart: number = position;

    while (
      position < text.length &&
      text[position] !== "=" &&
      !isWhitespace(text[position]!)
    ) {
      position++;
    }

    if (position === nameStart || text[position] !== "=") {
      return null;
    }

    const name: string = text.slice(nameStart, position);

    if (text[position + 1] !== '"') {
      return null;
    }

    position += 2;

    const valueStart: number = position;
    let value: string = "";
    let unread: number = position;

    for (;;) {
      if (position >= text.length) {
        return null;
      }

      const character: string = text[position]!;

      if (character === '"') {
        break;
      }

      if (withEscapes && character === "\\") {
        if (position + 1 >= text.length) {
          return null;
        }

        const escaped: string = text[position + 1]!;

        if (escaped === '"' || escaped === "\\" || escaped === "]") {
          value += text.slice(unread, position) + escaped;
          unread = position + 2;
        }

        // Any other character after it: both are kept as they are.
        position += 2;
        continue;
      }

      position++;
    }

    value += text.slice(unread, position);

    params.push({
      sdId: sdId,
      name: name,
      value: value,
      valueSpan: { start: valueStart, end: position },
    });

    // Past the closing quote.
    position++;
  }
}

// The "]" that closes the element at `open`, its brackets counted; -1 if none.
function closingBracketByDepth(text: string, open: number): number {
  let depth: number = 0;

  for (let i: number = open; i < text.length; i++) {
    const character: string = text[i]!;

    if (character === "[") {
      depth++;
    } else if (character === "]") {
      depth--;

      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

/*
 * The elements as the record keeps them, one entry per SD-ID - two
 * elements with one SD-ID share it - each parameter under its name, made
 * safe for an attribute key.
 */
function structuredDataOf(
  elements: Array<StructuredDataElement>,
): ParsedSyslogStructuredData {
  const result: ParsedSyslogStructuredData = {};

  for (const element of elements) {
    const sdId: string = sanitizeKey(element.sdId);

    /*
     * The element's own entry only, written as the result's own key. An
     * SD-ID and a parameter name are whatever the sender wrote, and a
     * plain read of an SD-ID named __proto__ found the prototype every
     * object shares: its parameters were then written onto it, into every
     * object of the process that read the line (a probe's syslog
     * listener, the syslog ingest). One named constructor wrote onto the
     * Object function. Each is an element like any other now.
     */
    let entry: { [key: string]: string } | undefined = readOwnValue(
      result,
      sdId,
    );

    if (!entry) {
      entry = {};
      writeOwnValue(result, sdId, entry);
    }

    for (const param of element.params) {
      writeOwnValue(entry, sanitizeKey(param.name), param.value);
    }
  }

  return result;
}

function isWhitespace(character: string): boolean {
  return WHITESPACE.test(character);
}

/*
 * A parameter's value as RFC 5424 writes it between its quotes: '"', '\'
 * and ']' escaped with a backslash.
 */
export function escapeSyslogStructuredDataValue(value: string): string {
  return value.replace(ESCAPED_IN_PARAM_VALUE, "\\$&");
}

export function sanitizeSyslogAttributeKey(key: string): string {
  return key.replace(UNSAFE_KEY_CHARACTER, "_");
}

/*
 * The attribute a structured-data parameter is kept as, whichever way the
 * line arrived: syslog.structured.<SD-ID>.<name>, each made safe.
 */
export function syslogStructuredDataAttributeKey(
  sdId: string,
  name: string,
): string {
  return `${SYSLOG_STRUCTURED_ATTRIBUTE_PREFIX}${sanitizeSyslogAttributeKey(sdId)}.${sanitizeSyslogAttributeKey(name)}`;
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
