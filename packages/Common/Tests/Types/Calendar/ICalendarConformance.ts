/*
 * A strict RFC 5545 reader for tests: it parses an iCalendar body the way a
 * fussy calendar client would and lists every rule the body breaks, instead
 * of stopping at the first one.
 *
 * It exists because "the body contains BEGIN:VEVENT" is not what Google
 * Calendar, Outlook or Apple Calendar check. They read physical lines split on
 * CRLF, unfold continuation lines, split every content line into a name,
 * parameters and a value, and then expect each component to carry the
 * properties RFC 5545 makes mandatory, with values of the right type. A body
 * that a lenient substring test accepts can still be one these clients drop
 * silently - which, for a subscribed calendar, looks exactly like "nothing is
 * displayed".
 *
 * What is checked (section numbers are RFC 5545's):
 *
 *   wire format     no byte-order mark; every line ends in CRLF and no bare CR
 *                   or LF appears anywhere (3.1); no physical line is longer
 *                   than 75 octets of UTF-8 (3.1); a continuation line starts
 *                   with exactly one space or tab and carries something; no
 *                   fold splits a character (a lone UTF-16 surrogate would mean
 *                   a 4-octet character was cut in two).
 *   content lines   name *(";" param) ":" value (3.1); names are iana-token /
 *                   x-name; parameter values are paramtext or quoted-string
 *                   (3.2); values carry no control character but HTAB.
 *   structure       BEGIN/END balanced and matched; one VCALENDAR; VERSION:2.0
 *                   and PRODID exactly once (3.7.3, 3.7.4); CALSCALE and METHOD
 *                   at most once; at least one component (3.6) unless the
 *                   caller accepts an empty calendar.
 *   VEVENT          exactly one UID and DTSTAMP (3.6.1); one DTSTART; DTEND or
 *                   DURATION but not both; UIDs unique in the calendar.
 *   value types     DATE-TIME as YYYYMMDDTHHMMSS[Z] that is a real instant
 *                   (3.3.5); DTSTAMP and LAST-MODIFIED in UTC (3.8.7.2,
 *                   3.8.7.3); a TZID parameter names a VTIMEZONE in the body
 *                   (3.2.19); a floating time is reported; VALUE=DATE as
 *                   YYYYMMDD (3.3.4); DTEND after DTSTART; SEQUENCE a
 *                   non-negative integer; STATUS and TRANSP from their
 *                   enumerations; URL an absolute http(s) URI; DURATION and
 *                   REFRESH-INTERVAL ISO 8601 durations (RFC 7986 5.7).
 *   TEXT            in every TEXT property a backslash starts one of the four
 *                   escapes \\ \; \, \n (or \N), and a ";" or "," is escaped
 *                   unless the property is a list (CATEGORIES) (3.3.11).
 */

export interface ICalendarProperty {
  name: string;
  parameters: Record<string, string>;
  value: string;
  // 1-based index of the (unfolded) content line, for messages.
  line: number;
}

export interface ICalendarComponent {
  name: string;
  properties: Array<ICalendarProperty>;
  components: Array<ICalendarComponent>;
}

export interface ConformanceOptions {
  /*
   * RFC 5545 3.6 asks for at least one component in a VCALENDAR. The feeds
   * deliberately serve a calendar with none when there is nothing to show
   * (the reason travels in X-WR-CALDESC); a test of such a body says so.
   */
  allowNoComponents?: boolean | undefined;
}

export interface ConformanceReport {
  problems: Array<string>;
  calendar: ICalendarComponent | null;
}

export interface ParsedEvent {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  description: string;
  url: string | null;
  sequence: number | null;
  dtStamp: Date;
  properties: Array<ICalendarProperty>;
}

const CRLF: string = "\r\n";

const MAX_LINE_OCTETS: number = 75;

const NAME_PATTERN: RegExp = /^[A-Za-z0-9-]+$/;

/*
 * Any control character except HTAB (RFC 5545 3.1: CONTROL). Walked by code
 * point rather than matched with a character-class regex, which ESLint's
 * no-control-regex refuses.
 */
function hasControlCharacter(value: string): boolean {
  for (let index: number = 0; index < value.length; index++) {
    const code: number = value.charCodeAt(index);

    if ((code < 0x20 && code !== 0x09) || code === 0x7f) {
      return true;
    }
  }

  return false;
}

// paramtext: any VALUE-CHAR except DQUOTE, ";", ":" and ",".
function isParamText(value: string): boolean {
  return (
    !hasControlCharacter(value) &&
    !value.includes('"') &&
    !value.includes(";") &&
    !value.includes(":") &&
    !value.includes(",")
  );
}

// quoted-string: DQUOTE *QSAFE-CHAR DQUOTE.
function isQuotedString(value: string): boolean {
  return (
    value.length >= 2 &&
    value.startsWith('"') &&
    value.endsWith('"') &&
    !value.slice(1, -1).includes('"') &&
    !hasControlCharacter(value)
  );
}

const LONE_SURROGATE_PATTERN: RegExp =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/;

const DATE_TIME_PATTERN: RegExp =
  /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/;

const DATE_PATTERN: RegExp = /^(\d{4})(\d{2})(\d{2})$/;

const DURATION_PATTERN: RegExp =
  /^[+-]?P(?:\d+W|(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+S)?)?)$/;

const ABSOLUTE_HTTP_URI_PATTERN: RegExp = /^https?:\/\/[^\s/?#]+[^\s]*$/;

const INTEGER_PATTERN: RegExp = /^\d+$/;

const SURROUNDING_QUOTES_PATTERN: RegExp = /^"|"$/g;

/*
 * The TEXT properties a feed may carry. CATEGORIES is a list of TEXT values
 * separated by unescaped commas, so its commas are separators, not errors.
 */
const TEXT_PROPERTIES: Array<string> = [
  "SUMMARY",
  "DESCRIPTION",
  "LOCATION",
  "COMMENT",
  "CONTACT",
  "UID",
  "NAME",
  "X-WR-CALNAME",
  "X-WR-CALDESC",
  "X-WR-TIMEZONE",
];

const LIST_TEXT_PROPERTIES: Array<string> = ["CATEGORIES", "RESOURCES"];

const DATE_TIME_PROPERTIES: Array<string> = [
  "DTSTART",
  "DTEND",
  "DTSTAMP",
  "LAST-MODIFIED",
  "CREATED",
  "RECURRENCE-ID",
];

const UTC_ONLY_PROPERTIES: Array<string> = [
  "DTSTAMP",
  "LAST-MODIFIED",
  "CREATED",
];

const EVENT_STATUSES: Array<string> = ["TENTATIVE", "CONFIRMED", "CANCELLED"];

const TRANSPARENCIES: Array<string> = ["OPAQUE", "TRANSPARENT"];

function octetLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/*
 * Split one unfolded content line into name, parameters and value. Quoted
 * parameter values may contain ";" and ":", so this walks the line instead of
 * splitting it.
 */
function splitContentLine(
  text: string,
  lineNumber: number,
  problems: Array<string>,
): ICalendarProperty | null {
  let index: number = 0;
  let name: string = "";

  while (index < text.length && text[index] !== ";" && text[index] !== ":") {
    name += text[index];
    index++;
  }

  if (index >= text.length) {
    problems.push(`line ${lineNumber}: no ":" separates name and value`);
    return null;
  }

  if (!NAME_PATTERN.test(name)) {
    problems.push(`line ${lineNumber}: "${name}" is not a valid property name`);
  }

  const parameters: Record<string, string> = {};

  while (text[index] === ";") {
    index++;

    let parameterName: string = "";

    while (index < text.length && text[index] !== "=") {
      parameterName += text[index];
      index++;
    }

    if (text[index] !== "=") {
      problems.push(
        `line ${lineNumber}: parameter "${parameterName}" has no "="`,
      );
      return null;
    }

    index++;

    let parameterValue: string = "";

    if (text[index] === '"') {
      const closing: number = text.indexOf('"', index + 1);

      if (closing === -1) {
        problems.push(`line ${lineNumber}: unterminated quoted parameter`);
        return null;
      }

      parameterValue = text.slice(index, closing + 1);
      index = closing + 1;

      if (!isQuotedString(parameterValue)) {
        problems.push(
          `line ${lineNumber}: parameter ${parameterName} has an invalid quoted value`,
        );
      }
    } else {
      while (
        index < text.length &&
        text[index] !== ";" &&
        text[index] !== ":"
      ) {
        parameterValue += text[index];
        index++;
      }

      for (const piece of parameterValue.split(",")) {
        if (!isParamText(piece)) {
          problems.push(
            `line ${lineNumber}: parameter ${parameterName} value "${piece}" must be quoted`,
          );
        }
      }
    }

    if (!NAME_PATTERN.test(parameterName)) {
      problems.push(
        `line ${lineNumber}: "${parameterName}" is not a valid parameter name`,
      );
    }

    parameters[parameterName.toUpperCase()] = parameterValue;
  }

  if (text[index] !== ":") {
    problems.push(`line ${lineNumber}: expected ":" after the parameters`);
    return null;
  }

  const value: string = text.slice(index + 1);

  if (hasControlCharacter(value)) {
    problems.push(
      `line ${lineNumber}: the value of ${name} has a control character`,
    );
  }

  return {
    name: name.toUpperCase(),
    parameters,
    value,
    line: lineNumber,
  };
}

/*
 * The physical-line rules, then the unfolded content lines. Problems are
 * appended to `problems`; the returned list is what a client would go on to
 * parse.
 */
function readContentLines(
  body: string,
  problems: Array<string>,
): Array<{ text: string; line: number }> {
  if (body.charCodeAt(0) === 0xfeff) {
    problems.push("the body starts with a byte-order mark");
  }

  if (!body.endsWith(CRLF)) {
    problems.push("the body does not end with CRLF");
  }

  const physical: Array<string> = body.split(CRLF);

  if (physical[physical.length - 1] === "") {
    physical.pop();
  }

  const contentLines: Array<{ text: string; line: number }> = [];

  physical.forEach((line: string, index: number) => {
    const lineNumber: number = index + 1;

    if (line.includes("\r") || line.includes("\n")) {
      problems.push(`physical line ${lineNumber}: bare CR or LF`);
    }

    if (octetLength(line) > MAX_LINE_OCTETS) {
      problems.push(
        `physical line ${lineNumber}: ${octetLength(line)} octets (more than ${MAX_LINE_OCTETS})`,
      );
    }

    if (LONE_SURROGATE_PATTERN.test(line)) {
      problems.push(
        `physical line ${lineNumber}: a fold splits a character in two`,
      );
    }

    if (line.startsWith(" ") || line.startsWith("\t")) {
      const previous: { text: string; line: number } | undefined =
        contentLines[contentLines.length - 1];

      if (!previous) {
        problems.push(
          `physical line ${lineNumber}: a continuation line with nothing to continue`,
        );
        return;
      }

      if (line.length === 1) {
        problems.push(
          `physical line ${lineNumber}: an empty continuation line`,
        );
      }

      previous.text += line.slice(1);
      return;
    }

    if (line === "") {
      problems.push(`physical line ${lineNumber}: an empty line`);
      return;
    }

    contentLines.push({ text: line, line: lineNumber });
  });

  return contentLines;
}

export function parseICalendar(
  body: string,
  problems: Array<string> = [],
): ICalendarComponent | null {
  const contentLines: Array<{ text: string; line: number }> = readContentLines(
    body,
    problems,
  );

  const stack: Array<ICalendarComponent> = [];
  const roots: Array<ICalendarComponent> = [];

  for (const contentLine of contentLines) {
    const property: ICalendarProperty | null = splitContentLine(
      contentLine.text,
      contentLine.line,
      problems,
    );

    if (!property) {
      continue;
    }

    if (property.name === "BEGIN") {
      const component: ICalendarComponent = {
        name: property.value.toUpperCase(),
        properties: [],
        components: [],
      };

      const parent: ICalendarComponent | undefined = stack[stack.length - 1];

      if (parent) {
        parent.components.push(component);
      } else {
        roots.push(component);
      }

      stack.push(component);
      continue;
    }

    if (property.name === "END") {
      const open: ICalendarComponent | undefined = stack.pop();

      if (!open) {
        problems.push(
          `line ${property.line}: END:${property.value} closes nothing`,
        );
        continue;
      }

      if (open.name !== property.value.toUpperCase()) {
        problems.push(
          `line ${property.line}: END:${property.value} closes BEGIN:${open.name}`,
        );
      }

      continue;
    }

    const current: ICalendarComponent | undefined = stack[stack.length - 1];

    if (!current) {
      problems.push(
        `line ${property.line}: ${property.name} sits outside any component`,
      );
      continue;
    }

    current.properties.push(property);
  }

  for (const unclosed of stack) {
    problems.push(`BEGIN:${unclosed.name} is never closed`);
  }

  if (roots.length !== 1 || roots[0]?.name !== "VCALENDAR") {
    problems.push(
      `expected exactly one VCALENDAR at the top, found ${
        roots
          .map((root: ICalendarComponent) => {
            return root.name;
          })
          .join(", ") || "nothing"
      }`,
    );
  }

  return roots[0] && roots[0].name === "VCALENDAR" ? roots[0] : null;
}

export function propertiesNamed(
  component: ICalendarComponent,
  name: string,
): Array<ICalendarProperty> {
  return component.properties.filter((property: ICalendarProperty) => {
    return property.name === name;
  });
}

export function firstValue(
  component: ICalendarComponent,
  name: string,
): string | null {
  const property: ICalendarProperty | undefined = propertiesNamed(
    component,
    name,
  )[0];

  return property ? property.value : null;
}

/* RFC 5545 3.3.11, in reverse. */
export function unescapeText(value: string): string {
  let result: string = "";

  for (let index: number = 0; index < value.length; index++) {
    const char: string = value[index]!;

    if (char !== "\\") {
      result += char;
      continue;
    }

    const next: string | undefined = value[index + 1];
    index++;

    if (next === "n" || next === "N") {
      result += "\n";
    } else if (next === "\\" || next === ";" || next === ",") {
      result += next;
    } else {
      result += `\\${next ?? ""}`;
    }
  }

  return result;
}

function checkTextValue(
  property: ICalendarProperty,
  isList: boolean,
  problems: Array<string>,
): void {
  const value: string = property.value;

  for (let index: number = 0; index < value.length; index++) {
    const char: string = value[index]!;

    if (char === "\\") {
      const next: string | undefined = value[index + 1];

      if (!next || !["\\", ";", ",", "n", "N"].includes(next)) {
        problems.push(
          `line ${property.line}: ${property.name} has a backslash that escapes nothing`,
        );
      }

      index++;
      continue;
    }

    if (char === ";" || (char === "," && !isList)) {
      problems.push(
        `line ${property.line}: ${property.name} has an unescaped "${char}"`,
      );
    }
  }
}

/*
 * A DATE-TIME as an instant. Floating times (no Z, no TZID) are not an
 * instant at all and come back null; so does a value that is not a real
 * calendar date (20260231T...).
 */
export function readDateTime(
  value: string,
): { date: Date; isUtc: boolean } | null {
  const match: RegExpMatchArray | null = value.match(DATE_TIME_PATTERN);

  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute, second, zone] = match;

  const date: Date = new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ),
  );

  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day) ||
    date.getUTCHours() !== Number(hour) ||
    date.getUTCMinutes() !== Number(minute) ||
    date.getUTCSeconds() !== Number(second)
  ) {
    return null;
  }

  return { date, isUtc: zone === "Z" };
}

function readDate(value: string): Date | null {
  const match: RegExpMatchArray | null = value.match(DATE_PATTERN);

  if (!match) {
    return null;
  }

  const date: Date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );

  return Number.isNaN(date.getTime()) || date.getUTCDate() !== Number(match[3])
    ? null
    : date;
}

/*
 * The instant a DTSTART/DTEND stands for: UTC date-times exactly, VALUE=DATE
 * as UTC midnight, TZID times as if they were UTC (the zone is checked to
 * exist, not converted - every feed here is UTC).
 */
function readTimeProperty(
  property: ICalendarProperty,
  timezoneIds: Set<string>,
  problems: Array<string>,
): Date | null {
  const valueType: string = (property.parameters["VALUE"] || "").toUpperCase();

  if (valueType === "DATE") {
    const date: Date | null = readDate(property.value);

    if (!date) {
      problems.push(
        `line ${property.line}: ${property.name} "${property.value}" is not a DATE`,
      );
    }

    return date;
  }

  const parsed: { date: Date; isUtc: boolean } | null = readDateTime(
    property.value,
  );

  if (!parsed) {
    problems.push(
      `line ${property.line}: ${property.name} "${property.value}" is not a DATE-TIME`,
    );
    return null;
  }

  const tzid: string | undefined = property.parameters["TZID"];

  if (parsed.isUtc && tzid) {
    problems.push(
      `line ${property.line}: ${property.name} is in UTC and also names TZID ${tzid}`,
    );
  }

  if (!parsed.isUtc) {
    if (UTC_ONLY_PROPERTIES.includes(property.name)) {
      problems.push(`line ${property.line}: ${property.name} must be in UTC`);
    } else if (!tzid) {
      problems.push(
        `line ${property.line}: ${property.name} is a floating time (no Z and no TZID)`,
      );
    } else if (!timezoneIds.has(tzid.replace(SURROUNDING_QUOTES_PATTERN, ""))) {
      problems.push(
        `line ${property.line}: ${property.name} names TZID ${tzid}, which no VTIMEZONE defines`,
      );
    }
  }

  return parsed.date;
}

function collectTimezoneIds(calendar: ICalendarComponent): Set<string> {
  const ids: Set<string> = new Set<string>();

  for (const component of calendar.components) {
    if (component.name === "VTIMEZONE") {
      const tzid: string | null = firstValue(component, "TZID");

      if (tzid) {
        ids.add(tzid);
      }
    }
  }

  return ids;
}

/*
 * STANDARD and DAYLIGHT, the sub-components of a VTIMEZONE, carry their
 * DTSTART as a local time by definition (RFC 5545 3.6.5), so a time without Z
 * or TZID is what they must hold there, not a floating time.
 */
const LOCAL_TIME_COMPONENTS: Array<string> = ["STANDARD", "DAYLIGHT"];

function checkValueTypes(
  component: ICalendarComponent,
  timezoneIds: Set<string>,
  problems: Array<string>,
): void {
  for (const property of component.properties) {
    if (
      LOCAL_TIME_COMPONENTS.includes(component.name) &&
      property.name === "DTSTART"
    ) {
      if (!readDateTime(property.value)) {
        problems.push(
          `line ${property.line}: ${property.name} "${property.value}" is not a DATE-TIME`,
        );
      }

      continue;
    }

    if (TEXT_PROPERTIES.includes(property.name)) {
      checkTextValue(property, false, problems);
    }

    if (LIST_TEXT_PROPERTIES.includes(property.name)) {
      checkTextValue(property, true, problems);
    }

    if (DATE_TIME_PROPERTIES.includes(property.name)) {
      readTimeProperty(property, timezoneIds, problems);
    }

    if (property.name === "SEQUENCE" && !INTEGER_PATTERN.test(property.value)) {
      problems.push(
        `line ${property.line}: SEQUENCE "${property.value}" is not a non-negative integer`,
      );
    }

    if (
      property.name === "URL" &&
      !ABSOLUTE_HTTP_URI_PATTERN.test(property.value)
    ) {
      problems.push(
        `line ${property.line}: URL "${property.value}" is not an absolute http(s) URI`,
      );
    }

    if (
      (property.name === "DURATION" ||
        property.name === "REFRESH-INTERVAL" ||
        property.name === "X-PUBLISHED-TTL") &&
      !DURATION_PATTERN.test(property.value)
    ) {
      problems.push(
        `line ${property.line}: ${property.name} "${property.value}" is not a duration`,
      );
    }

    if (
      property.name === "REFRESH-INTERVAL" &&
      (property.parameters["VALUE"] || "").toUpperCase() !== "DURATION"
    ) {
      problems.push(
        `line ${property.line}: REFRESH-INTERVAL must carry VALUE=DURATION (RFC 7986)`,
      );
    }
  }
}

function checkEvent(
  event: ICalendarComponent,
  timezoneIds: Set<string>,
  seenUids: Map<string, number>,
  problems: Array<string>,
): void {
  const uids: Array<ICalendarProperty> = propertiesNamed(event, "UID");
  const where: string = uids[0] ? `VEVENT ${uids[0].value}` : "a VEVENT";

  for (const required of ["UID", "DTSTAMP", "DTSTART"]) {
    const count: number = propertiesNamed(event, required).length;

    if (count !== 1) {
      problems.push(
        `${where}: ${count} ${required} properties (exactly one required)`,
      );
    }
  }

  const dtEnds: Array<ICalendarProperty> = propertiesNamed(event, "DTEND");
  const durations: Array<ICalendarProperty> = propertiesNamed(
    event,
    "DURATION",
  );

  if (dtEnds.length > 1 || durations.length > 1) {
    problems.push(`${where}: DTEND or DURATION appears more than once`);
  }

  if (dtEnds.length > 0 && durations.length > 0) {
    problems.push(`${where}: has both DTEND and DURATION`);
  }

  if (dtEnds.length === 0 && durations.length === 0) {
    problems.push(`${where}: has neither DTEND nor DURATION`);
  }

  for (const single of [
    "SUMMARY",
    "DESCRIPTION",
    "LOCATION",
    "URL",
    "STATUS",
    "TRANSP",
    "SEQUENCE",
    "LAST-MODIFIED",
  ]) {
    if (propertiesNamed(event, single).length > 1) {
      problems.push(`${where}: ${single} appears more than once`);
    }
  }

  const uid: string | null = firstValue(event, "UID");

  if (uid !== null) {
    if (uid.trim() === "") {
      problems.push(`${where}: an empty UID`);
    }

    const previous: number | undefined = seenUids.get(uid);

    if (previous !== undefined) {
      problems.push(`${where}: UID repeats the event on line ${previous}`);
    } else {
      seenUids.set(uid, uids[0]?.line ?? 0);
    }
  }

  const startProperty: ICalendarProperty | undefined = propertiesNamed(
    event,
    "DTSTART",
  )[0];
  const endProperty: ICalendarProperty | undefined = dtEnds[0];

  if (startProperty && endProperty) {
    const ignored: Array<string> = [];
    const start: Date | null = readTimeProperty(
      startProperty,
      timezoneIds,
      ignored,
    );
    const end: Date | null = readTimeProperty(
      endProperty,
      timezoneIds,
      ignored,
    );

    const startType: string = (
      startProperty.parameters["VALUE"] || "DATE-TIME"
    ).toUpperCase();
    const endType: string = (
      endProperty.parameters["VALUE"] || "DATE-TIME"
    ).toUpperCase();

    if (startType !== endType) {
      problems.push(
        `${where}: DTSTART is a ${startType} but DTEND is a ${endType}`,
      );
    }

    if (start && end && end.getTime() <= start.getTime()) {
      problems.push(`${where}: DTEND is not after DTSTART`);
    }
  }

  const status: string | null = firstValue(event, "STATUS");

  if (status !== null && !EVENT_STATUSES.includes(status)) {
    problems.push(`${where}: STATUS "${status}" is not an event status`);
  }

  const transparency: string | null = firstValue(event, "TRANSP");

  if (transparency !== null && !TRANSPARENCIES.includes(transparency)) {
    problems.push(
      `${where}: TRANSP "${transparency}" is not OPAQUE or TRANSPARENT`,
    );
  }
}

/*
 * Everything wrong with `body`, as a list a test can print. An empty list is
 * a body a strict client reads without complaint.
 */
export function checkICalendarConformance(
  body: string,
  options?: ConformanceOptions | undefined,
): ConformanceReport {
  const problems: Array<string> = [];

  if (typeof body !== "string" || body.length === 0) {
    return { problems: ["the body is empty"], calendar: null };
  }

  const calendar: ICalendarComponent | null = parseICalendar(body, problems);

  if (!calendar) {
    return { problems, calendar: null };
  }

  const versions: Array<ICalendarProperty> = propertiesNamed(
    calendar,
    "VERSION",
  );

  if (versions.length !== 1 || versions[0]?.value !== "2.0") {
    problems.push(
      `VCALENDAR: VERSION must appear once as 2.0, found ${JSON.stringify(
        versions.map((property: ICalendarProperty) => {
          return property.value;
        }),
      )}`,
    );
  }

  const productIds: Array<ICalendarProperty> = propertiesNamed(
    calendar,
    "PRODID",
  );

  if (productIds.length !== 1 || !productIds[0]?.value.trim()) {
    problems.push(
      `VCALENDAR: PRODID must appear exactly once and not be empty`,
    );
  }

  for (const atMostOnce of [
    "CALSCALE",
    "METHOD",
    "NAME",
    "X-WR-CALNAME",
    "X-WR-CALDESC",
    "X-WR-TIMEZONE",
    "REFRESH-INTERVAL",
    "X-PUBLISHED-TTL",
    "LAST-MODIFIED",
  ]) {
    if (propertiesNamed(calendar, atMostOnce).length > 1) {
      problems.push(`VCALENDAR: ${atMostOnce} appears more than once`);
    }
  }

  const calendarScale: string | null = firstValue(calendar, "CALSCALE");

  if (calendarScale !== null && calendarScale !== "GREGORIAN") {
    problems.push(`VCALENDAR: CALSCALE "${calendarScale}" is not GREGORIAN`);
  }

  if (calendar.components.length === 0 && !options?.allowNoComponents) {
    problems.push(
      "VCALENDAR: no component at all (RFC 5545 3.6 asks for at least one)",
    );
  }

  const timezoneIds: Set<string> = collectTimezoneIds(calendar);

  checkValueTypes(calendar, timezoneIds, problems);

  const seenUids: Map<string, number> = new Map<string, number>();

  const walk: (component: ICalendarComponent) => void = (
    component: ICalendarComponent,
  ): void => {
    for (const child of component.components) {
      checkValueTypes(child, timezoneIds, problems);

      if (child.name === "VEVENT") {
        checkEvent(child, timezoneIds, seenUids, problems);
      }

      walk(child);
    }
  };

  walk(calendar);

  return { problems, calendar };
}

/*
 * The events of a conforming body, read the way a client reads them: TEXT
 * values unescaped, times as instants. Throws when the body does not conform,
 * so a test that reads events has also checked the body.
 */
export function readEvents(
  body: string,
  options?: ConformanceOptions | undefined,
): Array<ParsedEvent> {
  const report: ConformanceReport = checkICalendarConformance(body, options);

  if (report.problems.length > 0 || !report.calendar) {
    throw new Error(
      `The calendar body does not conform:\n${report.problems.join("\n")}`,
    );
  }

  return report.calendar.components
    .filter((component: ICalendarComponent) => {
      return component.name === "VEVENT";
    })
    .map((event: ICalendarComponent): ParsedEvent => {
      const sequence: string | null = firstValue(event, "SEQUENCE");
      const ignored: Array<string> = [];
      const timezoneIds: Set<string> = collectTimezoneIds(report.calendar!);

      const instantOf: (name: string) => Date = (name: string): Date => {
        const property: ICalendarProperty | undefined = propertiesNamed(
          event,
          name,
        )[0];

        const date: Date | null = property
          ? readTimeProperty(property, timezoneIds, ignored)
          : null;

        return date || new Date(Number.NaN);
      };

      return {
        uid: unescapeText(firstValue(event, "UID") || ""),
        start: instantOf("DTSTART"),
        end: instantOf("DTEND"),
        summary: unescapeText(firstValue(event, "SUMMARY") || ""),
        description: unescapeText(firstValue(event, "DESCRIPTION") || ""),
        url: firstValue(event, "URL"),
        sequence: sequence === null ? null : Number(sequence),
        dtStamp: instantOf("DTSTAMP"),
        properties: event.properties,
      };
    });
}

/* The calendar-level TEXT property `name`, unescaped, or null. */
export function readCalendarText(body: string, name: string): string | null {
  const calendar: ICalendarComponent | null = parseICalendar(body, []);

  if (!calendar) {
    return null;
  }

  const value: string | null = firstValue(calendar, name);

  return value === null ? null : unescapeText(value);
}
