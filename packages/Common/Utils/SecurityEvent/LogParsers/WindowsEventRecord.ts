import { JSONObject, JSONValue } from "../../../Types/JSON";
import { parseEventTime } from "../NormalizerHelpers";
import { MAX_JSON_LINE_LENGTH } from "./SecurityLogLine";

/*
 * One Windows event, whichever way it reached OneUptime's logs:
 *
 *   - the OpenTelemetry Collector's windowseventlog receiver - what
 *     OneUptime's own host agent and its host guide run. Its log body is a
 *     map (channel, computer, event_id.id, provider.name, event_data...),
 *     which the log keeps as the OTLP value it arrived as
 *     ({"kvlistValue":{"values":[...]}}). event_data is a flat map of the
 *     event's named fields from collector v0.15x on, and a "data" list of
 *     one-field maps before.
 *   - a shipper that writes the event as JSON: NXLog (EventID, SourceName,
 *     the event's fields at the top), Fluent Bit's winevtlog input
 *     (EventID, ProviderName and StringInserts, the fields by position),
 *     Winlogbeat (winlog.event_id, winlog.event_data) and any JSON with an
 *     EventID and a provider.
 *   - the event's own XML, as the collector sends it with raw: true and
 *     as Windows Event Forwarding exports it.
 *
 * Whatever the shape, the event becomes one record: its id, provider,
 * channel, computer, time and its fields by their Windows names
 * (TargetUserName, LogonType, CommandLine...), so the rules and the parser
 * read one thing.
 *
 * Everything here reads text anybody can put in a log, so every walk is a
 * single bounded pass: JSON is parsed only below MAX_JSON_LINE_LENGTH,
 * nesting is followed only so deep, and XML is read with indexOf, never a
 * regular expression.
 */

export interface WindowsEventRecord {
  eventId: number;
  // The provider as Windows names it: "Microsoft-Windows-Security-Auditing".
  provider: string;
  channel: string;
  computer: string;
  time: Date | null;
  recordId: string;
  // The level as the source wrote it: "Warning", "Information", "3"...
  level: string;
  keywords: string;
  // The rendered message, when the source sent one.
  message: string;
  // The account the event was logged under (System/Security UserID).
  userSid: string;
  // The event's fields (EventData, and UserData for events that use it).
  data: Record<string, string>;
}

// The most fields one event keeps.
export const MAX_WINDOWS_EVENT_FIELDS: number = 200;
// The longest value of one field an event keeps.
export const MAX_WINDOWS_FIELD_VALUE_LENGTH: number = 4096;
// How deep an OTLP value or a JSON shipper's object is followed.
const MAX_DEPTH: number = 8;

/*
 * The fields Fluent Bit's winevtlog input sends by position only
 * (StringInserts), named in the order Windows writes them, for the events
 * that matter most and change least: a sign-in, a failed one, a process.
 * Later versions of an event add fields at the end, never before.
 */
export const STRING_INSERT_FIELDS: Record<string, ReadonlyArray<string>> = {
  "microsoft-windows-security-auditing:4624": [
    "SubjectUserSid",
    "SubjectUserName",
    "SubjectDomainName",
    "SubjectLogonId",
    "TargetUserSid",
    "TargetUserName",
    "TargetDomainName",
    "TargetLogonId",
    "LogonType",
    "LogonProcessName",
    "AuthenticationPackageName",
    "WorkstationName",
    "LogonGuid",
    "TransmittedServices",
    "LmPackageName",
    "KeyLength",
    "ProcessId",
    "ProcessName",
    "IpAddress",
    "IpPort",
    "ImpersonationLevel",
    "RestrictedAdminMode",
    "TargetOutboundUserName",
    "TargetOutboundDomainName",
    "VirtualAccount",
    "TargetLinkedLogonId",
    "ElevatedToken",
  ],
  "microsoft-windows-security-auditing:4625": [
    "SubjectUserSid",
    "SubjectUserName",
    "SubjectDomainName",
    "SubjectLogonId",
    "TargetUserSid",
    "TargetUserName",
    "TargetDomainName",
    "Status",
    "FailureReason",
    "SubStatus",
    "LogonType",
    "LogonProcessName",
    "AuthenticationPackageName",
    "WorkstationName",
    "TransmittedServices",
    "LmPackageName",
    "KeyLength",
    "ProcessId",
    "ProcessName",
    "IpAddress",
    "IpPort",
  ],
  "microsoft-windows-security-auditing:4688": [
    "SubjectUserSid",
    "SubjectUserName",
    "SubjectDomainName",
    "SubjectLogonId",
    "NewProcessId",
    "NewProcessName",
    "TokenElevationType",
    "ProcessId",
    "CommandLine",
    "TargetUserSid",
    "TargetUserName",
    "TargetDomainName",
    "TargetLogonId",
    "ParentProcessName",
    "MandatoryLabel",
  ],
};

function cap(value: string): string {
  return value.length > MAX_WINDOWS_FIELD_VALUE_LENGTH
    ? value.slice(0, MAX_WINDOWS_FIELD_VALUE_LENGTH)
    : value;
}

function asObject(value: unknown): JSONObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : null;
}

// A scalar as text; "" for anything else.
function scalarText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  return "";
}

function firstText(object: JSONObject, keys: ReadonlyArray<string>): string {
  for (const key of keys) {
    const text: string = scalarText(object[key]).trim();

    if (text) {
      return text;
    }
  }

  return "";
}

// A whole number 1 to 65535 (an event id), else 0.
function readEventId(value: unknown): number {
  const text: string = scalarText(value).trim();

  if (!text || text.length > 5) {
    return 0;
  }

  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);

    if (code < 48 || code > 57) {
      return 0;
    }
  }

  const id: number = Number(text);

  return id >= 1 && id <= 65535 ? id : 0;
}

/*
 * An OTLP value as the plain value it carries: {"stringValue":"x"} is "x",
 * a kvlistValue an object, an arrayValue a list. Followed MAX_DEPTH deep.
 */
export function readOtlpAnyValue(value: unknown, depth: number = 0): unknown {
  const wrapper: JSONObject | null = asObject(value);

  if (!wrapper || depth > MAX_DEPTH) {
    return null;
  }

  for (const key of ["stringValue", "string_value"]) {
    if (wrapper[key] !== undefined) {
      return scalarText(wrapper[key]);
    }
  }

  for (const key of [
    "intValue",
    "int_value",
    "doubleValue",
    "double_value",
    "boolValue",
    "bool_value",
  ]) {
    if (wrapper[key] !== undefined) {
      return scalarText(wrapper[key]);
    }
  }

  const kvlist: JSONObject | null =
    asObject(wrapper["kvlistValue"]) || asObject(wrapper["kvlist_value"]);

  if (kvlist) {
    const result: JSONObject = {};
    const values: unknown = kvlist["values"];

    if (Array.isArray(values)) {
      for (const entry of values.slice(0, MAX_WINDOWS_EVENT_FIELDS * 2)) {
        const pair: JSONObject | null = asObject(entry);
        const key: string = pair ? scalarText(pair["key"]) : "";

        if (!pair || key === "__proto__") {
          continue;
        }

        result[key] = readOtlpAnyValue(pair["value"], depth + 1) as JSONValue;
      }
    }

    return result;
  }

  const array: JSONObject | null =
    asObject(wrapper["arrayValue"]) || asObject(wrapper["array_value"]);

  if (array) {
    const values: unknown = array["values"];

    return Array.isArray(values)
      ? values.slice(0, MAX_WINDOWS_EVENT_FIELDS).map((item: unknown) => {
          return readOtlpAnyValue(item, depth + 1);
        })
      : [];
  }

  return null;
}

function addField(
  data: Record<string, string>,
  name: string,
  value: unknown,
): void {
  const key: string = name.trim();

  if (
    !key ||
    key === "__proto__" ||
    Object.keys(data).length >= MAX_WINDOWS_EVENT_FIELDS ||
    Object.prototype.hasOwnProperty.call(data, key)
  ) {
    return;
  }

  const text: string = scalarText(value);

  data[key] = cap(text);
}

/*
 * The collector's event_data: a flat map of named fields (param1, param2...
 * for unnamed ones), or - before v0.15x - a "data" list of one-field maps.
 */
function readCollectorEventData(
  eventData: unknown,
  data: Record<string, string>,
): void {
  const object: JSONObject | null = asObject(eventData);

  if (!object) {
    return;
  }

  const list: unknown = object["data"];

  if (Array.isArray(list)) {
    let anonymous: number = 1;

    for (const item of list.slice(0, MAX_WINDOWS_EVENT_FIELDS)) {
      const field: JSONObject | null = asObject(item);

      if (field) {
        for (const name of Object.keys(field)) {
          if (name) {
            addField(data, name, field[name]);
          } else {
            addField(data, `param${anonymous}`, field[name]);
            anonymous++;
          }
        }
      } else {
        addField(data, `param${anonymous}`, item);
        anonymous++;
      }
    }
  }

  for (const name of Object.keys(object)) {
    if (name === "data" || name === "binary" || name === "name") {
      continue;
    }

    addField(data, name, object[name]);
  }
}

// UserData's fields, as the collector maps them ({ name, data: {...} }).
function readCollectorUserData(
  userData: unknown,
  data: Record<string, string>,
): void {
  const fields: JSONObject | null = asObject(asObject(userData)?.["data"]);

  if (!fields) {
    return;
  }

  for (const name of Object.keys(fields)) {
    addField(data, name, fields[name]);
  }
}

function keywordsText(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((item: unknown): string => {
        return scalarText(item);
      })
      .filter((item: string): boolean => {
        return item.length > 0;
      })
      .join(", ");
  }

  return scalarText(value);
}

// The collector's map: { event_id: { id }, provider: { name }, ... }.
function fromCollectorMap(body: JSONObject): WindowsEventRecord | null {
  const eventIdValue: unknown = body["event_id"];
  const eventId: number = readEventId(
    asObject(eventIdValue)?.["id"] ?? eventIdValue,
  );
  const providerValue: unknown = body["provider"];
  const provider: string =
    scalarText(asObject(providerValue)?.["name"]).trim() ||
    scalarText(providerValue).trim();

  if (!eventId || !provider) {
    return null;
  }

  const data: Record<string, string> = {};

  readCollectorEventData(body["event_data"], data);
  readCollectorUserData(body["user_data"], data);

  return {
    eventId,
    provider,
    channel: scalarText(body["channel"]).trim(),
    computer: scalarText(body["computer"]).trim(),
    time: parseEventTime(scalarText(body["system_time"]) || null),
    recordId: scalarText(body["record_id"]).trim(),
    level: scalarText(body["level"]).trim(),
    keywords: keywordsText(body["keywords"]),
    message: scalarText(body["message"]),
    userSid: scalarText(asObject(body["security"])?.["user_id"]).trim(),
    data,
  };
}

/*
 * The top-level keys NXLog, Fluent Bit and other JSON shippers use for the
 * event itself - never one of its fields - spelled exactly as they write
 * them: NXLog's own ProcessID sits beside an event's ProcessId field.
 */
const SHIPPER_SYSTEM_KEYS: ReadonlySet<string> = new Set<string>([
  // NXLog (im_msvistalog).
  "EventTime",
  "EventReceivedTime",
  "Hostname",
  "Keywords",
  "EventType",
  "SeverityValue",
  "Severity",
  "EventID",
  "SourceName",
  "ProviderGuid",
  "Version",
  "Task",
  "OpcodeValue",
  "Opcode",
  "RecordNumber",
  "ProcessID",
  "ThreadID",
  "Channel",
  "Message",
  "Category",
  "AccountName",
  "AccountType",
  "Domain",
  "UserID",
  "SourceModuleName",
  "SourceModuleType",
  // Fluent Bit (winevtlog).
  "ProviderName",
  "Qualifiers",
  "Level",
  "TimeCreated",
  "EventRecordID",
  "ActivityID",
  "RelatedActivityID",
  "Computer",
  "StringInserts",
  // Other shippers.
  "@timestamp",
  "@metadata",
  "timestamp",
  "host",
  "EventId",
  "eventId",
  "Provider",
  "Provider_Name",
  "providerName",
  "ComputerName",
  "LevelText",
  "UserSID",
  "EventData",
  "UserData",
  "event_data",
  "user_data",
]);

// NXLog, Fluent Bit and other JSON with an EventID and a provider.
function fromShipperJson(body: JSONObject): WindowsEventRecord | null {
  const eventId: number = readEventId(
    body["EventID"] ?? body["EventId"] ?? body["eventId"],
  );
  const provider: string =
    firstText(body, [
      "ProviderName",
      "SourceName",
      "Provider_Name",
      "providerName",
    ]) ||
    scalarText(asObject(body["Provider"])?.["Name"]).trim() ||
    scalarText(body["Provider"]).trim();

  if (!eventId || !provider) {
    return null;
  }

  const data: Record<string, string> = {};
  const eventData: JSONObject | null =
    asObject(body["EventData"]) || asObject(body["event_data"]);
  const userData: JSONObject | null =
    asObject(body["UserData"]) || asObject(body["user_data"]);

  if (eventData) {
    readCollectorEventData(eventData, data);
  }

  if (userData) {
    for (const name of Object.keys(userData)) {
      const inner: JSONObject | null = asObject(userData[name]);

      if (inner) {
        for (const field of Object.keys(inner)) {
          addField(data, field, inner[field]);
        }
      } else {
        addField(data, name, userData[name]);
      }
    }
  }

  // Fluent Bit names the fields by position only.
  const inserts: unknown = body["StringInserts"];

  if (Array.isArray(inserts)) {
    const names: ReadonlyArray<string> =
      STRING_INSERT_FIELDS[`${provider.toLowerCase()}:${eventId}`] || [];

    inserts
      .slice(0, MAX_WINDOWS_EVENT_FIELDS)
      .forEach((value: unknown, index: number): void => {
        addField(data, names[index] || `param${index + 1}`, value);
      });
  }

  // NXLog writes the event's fields at the top, beside its own keys.
  for (const key of Object.keys(body)) {
    if (SHIPPER_SYSTEM_KEYS.has(key)) {
      continue;
    }

    const value: unknown = body[key];

    if (value === null || typeof value === "object") {
      continue;
    }

    addField(data, key, value);
  }

  return {
    eventId,
    provider,
    channel: firstText(body, ["Channel", "channel"]),
    computer: firstText(body, ["Computer", "Hostname", "ComputerName"]),
    time: parseEventTime(
      firstText(body, ["TimeCreated", "EventTime", "@timestamp", "timestamp"]) ||
        null,
    ),
    recordId: firstText(body, ["EventRecordID", "RecordNumber"]),
    level: firstText(body, ["Level", "Severity", "LevelText"]),
    keywords: keywordsText(body["Keywords"]),
    message: scalarText(body["Message"]),
    userSid: firstText(body, ["UserID", "UserSID"]),
    data,
  };
}

// Winlogbeat: the event under "winlog", in Elastic Common Schema.
function fromWinlogbeat(body: JSONObject): WindowsEventRecord | null {
  const winlog: JSONObject | null = asObject(body["winlog"]);

  if (!winlog) {
    return null;
  }

  const eventId: number = readEventId(winlog["event_id"]);
  const provider: string = scalarText(winlog["provider_name"]).trim();

  if (!eventId || !provider) {
    return null;
  }

  const data: Record<string, string> = {};
  const eventData: JSONObject | null = asObject(winlog["event_data"]);
  const userData: JSONObject | null = asObject(winlog["user_data"]);

  for (const fields of [eventData, userData]) {
    if (!fields) {
      continue;
    }

    for (const name of Object.keys(fields)) {
      addField(data, name, fields[name]);
    }
  }

  return {
    eventId,
    provider,
    channel: scalarText(winlog["channel"]).trim(),
    computer: scalarText(winlog["computer_name"]).trim(),
    time: parseEventTime(scalarText(body["@timestamp"]) || null),
    recordId: scalarText(winlog["record_id"]).trim(),
    level: scalarText(asObject(body["log"])?.["level"]).trim(),
    keywords: keywordsText(winlog["keywords"]),
    message: scalarText(body["message"]),
    userSid: scalarText(asObject(winlog["user"])?.["identifier"]).trim(),
    data,
  };
}

const XML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

// XML text as it was meant: the five named entities and numeric ones.
export function decodeXmlText(text: string): string {
  if (text.indexOf("&") === -1) {
    return text;
  }

  let output: string = "";
  let index: number = 0;

  while (index < text.length) {
    const amp: number = text.indexOf("&", index);

    if (amp === -1) {
      output += text.slice(index);
      break;
    }

    output += text.slice(index, amp);
    const semicolon: number = text.indexOf(";", amp);

    if (semicolon === -1 || semicolon - amp > 10) {
      output += "&";
      index = amp + 1;
      continue;
    }

    const entity: string = text.slice(amp, semicolon + 1);
    const named: string | undefined = XML_ENTITIES[entity];

    if (named !== undefined) {
      output += named;
    } else if (entity.startsWith("&#")) {
      const isHex: boolean = entity.charAt(2) === "x" || entity.charAt(2) === "X";
      const code: number = parseInt(
        entity.slice(isHex ? 3 : 2, -1),
        isHex ? 16 : 10,
      );

      output +=
        Number.isFinite(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : entity;
    } else {
      output += entity;
    }

    index = semicolon + 1;
  }

  return output;
}

// The text between <tag ...> and </tag>, from `from`; null when absent.
function xmlElementText(
  xml: string,
  tag: string,
  from: number,
  until: number,
): string | null {
  const open: number = xml.indexOf(`<${tag}`, from);

  if (open === -1 || open >= until) {
    return null;
  }

  const afterName: string = xml.charAt(open + tag.length + 1);

  if (afterName !== ">" && afterName !== " " && afterName !== "/") {
    return null;
  }

  const close: number = xml.indexOf(">", open);

  if (close === -1 || close >= until) {
    return null;
  }

  if (xml.charAt(close - 1) === "/") {
    return "";
  }

  const end: number = xml.indexOf(`</${tag}>`, close);

  if (end === -1 || end > until) {
    return null;
  }

  return decodeXmlText(xml.slice(close + 1, end));
}

// An attribute's value inside one tag's text: Name='x' or Name="x".
function xmlAttribute(tagText: string, name: string): string {
  for (const quote of ["'", '"']) {
    const marker: string = `${name}=${quote}`;
    const at: number = tagText.indexOf(marker);

    if (at === -1) {
      continue;
    }

    const before: string = at === 0 ? " " : tagText.charAt(at - 1);

    if (before !== " " && before !== "\t" && before !== "\n") {
      continue;
    }

    const start: number = at + marker.length;
    const end: number = tagText.indexOf(quote, start);

    return end === -1 ? "" : decodeXmlText(tagText.slice(start, end));
  }

  return "";
}

// The text of the opening tag <tag ...>, from `from`; "" when absent.
function xmlOpeningTag(xml: string, tag: string, from: number, until: number): string {
  const open: number = xml.indexOf(`<${tag}`, from);

  if (open === -1 || open >= until) {
    return "";
  }

  const close: number = xml.indexOf(">", open);

  return close === -1 || close > until ? "" : xml.slice(open, close + 1);
}

/*
 * The fields of <EventData>: each <Data Name='X'>value</Data>, in one
 * forward pass; an unnamed <Data> is param1, param2... in order.
 */
function readXmlEventData(
  xml: string,
  start: number,
  end: number,
  data: Record<string, string>,
): void {
  let index: number = start;
  let anonymous: number = 1;

  while (index < end && Object.keys(data).length < MAX_WINDOWS_EVENT_FIELDS) {
    const open: number = xml.indexOf("<Data", index);

    if (open === -1 || open >= end) {
      return;
    }

    const tagEnd: number = xml.indexOf(">", open);

    if (tagEnd === -1 || tagEnd >= end) {
      return;
    }

    const tagText: string = xml.slice(open, tagEnd + 1);
    const name: string = xmlAttribute(tagText, "Name");
    let value: string = "";
    let next: number = tagEnd + 1;

    if (xml.charAt(tagEnd - 1) !== "/") {
      const close: number = xml.indexOf("</Data>", tagEnd);

      if (close === -1 || close > end) {
        return;
      }

      value = decodeXmlText(xml.slice(tagEnd + 1, close));
      next = close + "</Data>".length;
    }

    if (name) {
      addField(data, name, value);
    } else {
      addField(data, `param${anonymous}`, value);
      anonymous++;
    }

    index = next;
  }
}

/*
 * The fields of <UserData>: the children of its one element, each
 * <Name>value</Name> (the audit log cleared names its account this way).
 */
function readXmlUserData(
  xml: string,
  start: number,
  end: number,
  data: Record<string, string>,
): void {
  // Past the wrapper element's own opening tag.
  const wrapperOpen: number = xml.indexOf("<", start);

  if (wrapperOpen === -1 || wrapperOpen >= end) {
    return;
  }

  let index: number = xml.indexOf(">", wrapperOpen) + 1;

  while (
    index > 0 &&
    index < end &&
    Object.keys(data).length < MAX_WINDOWS_EVENT_FIELDS
  ) {
    const open: number = xml.indexOf("<", index);

    if (open === -1 || open >= end || xml.charAt(open + 1) === "/") {
      return;
    }

    const tagEnd: number = xml.indexOf(">", open);

    if (tagEnd === -1 || tagEnd >= end) {
      return;
    }

    let nameEnd: number = open + 1;

    while (
      nameEnd < tagEnd &&
      xml.charAt(nameEnd) !== " " &&
      xml.charAt(nameEnd) !== "/"
    ) {
      nameEnd++;
    }

    const name: string = xml.slice(open + 1, nameEnd);

    if (xml.charAt(tagEnd - 1) === "/") {
      addField(data, name, "");
      index = tagEnd + 1;
      continue;
    }

    const close: number = xml.indexOf(`</${name}>`, tagEnd);

    if (close === -1 || close > end) {
      return;
    }

    addField(data, name, decodeXmlText(xml.slice(tagEnd + 1, close)));
    index = close + name.length + 3;
  }
}

// The event's own XML: <Event><System>...</System><EventData>...</EventData></Event>.
function fromXml(xml: string): WindowsEventRecord | null {
  const systemStart: number = xml.indexOf("<System");
  const systemEnd: number = xml.indexOf("</System>");

  if (systemStart === -1 || systemEnd === -1 || systemEnd < systemStart) {
    return null;
  }

  const providerTag: string = xmlOpeningTag(xml, "Provider", systemStart, systemEnd);
  const provider: string = xmlAttribute(providerTag, "Name");
  const eventId: number = readEventId(
    (xmlElementText(xml, "EventID", systemStart, systemEnd) || "").trim(),
  );

  if (!eventId || !provider) {
    return null;
  }

  const timeTag: string = xmlOpeningTag(xml, "TimeCreated", systemStart, systemEnd);
  const securityTag: string = xmlOpeningTag(xml, "Security", systemStart, systemEnd);
  const data: Record<string, string> = {};

  const eventDataStart: number = xml.indexOf("<EventData", systemEnd);
  const eventDataEnd: number = xml.indexOf("</EventData>", systemEnd);

  if (eventDataStart !== -1 && eventDataEnd > eventDataStart) {
    readXmlEventData(xml, eventDataStart, eventDataEnd, data);
  }

  const userDataStart: number = xml.indexOf("<UserData>", systemEnd);
  const userDataEnd: number = xml.indexOf("</UserData>", systemEnd);

  if (userDataStart !== -1 && userDataEnd > userDataStart) {
    readXmlUserData(
      xml,
      userDataStart + "<UserData>".length,
      userDataEnd,
      data,
    );
  }

  const renderingStart: number = xml.indexOf("<RenderingInfo", systemEnd);
  const message: string =
    renderingStart === -1
      ? ""
      : xmlElementText(xml, "Message", renderingStart, xml.length) || "";

  return {
    eventId,
    provider,
    channel: (xmlElementText(xml, "Channel", systemStart, systemEnd) || "").trim(),
    computer: (
      xmlElementText(xml, "Computer", systemStart, systemEnd) || ""
    ).trim(),
    time: parseEventTime(xmlAttribute(timeTag, "SystemTime") || null),
    recordId: (
      xmlElementText(xml, "EventRecordID", systemStart, systemEnd) || ""
    ).trim(),
    level: (xmlElementText(xml, "Level", systemStart, systemEnd) || "").trim(),
    keywords: (
      xmlElementText(xml, "Keywords", systemStart, systemEnd) || ""
    ).trim(),
    message,
    userSid: xmlAttribute(securityTag, "UserID"),
    data,
  };
}

/*
 * The Windows event a log line holds, or null for any other line. The
 * line's attributes can name the record's computer when the body does not
 * (the collector's host.name).
 */
export function readWindowsEventRecord(
  body: string,
): WindowsEventRecord | null {
  const text: string = (body || "").trim();

  if (!text || text.length > MAX_JSON_LINE_LENGTH) {
    return null;
  }

  if (text.startsWith("<Event")) {
    return fromXml(text);
  }

  if (!text.startsWith("{")) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  const object: JSONObject | null = asObject(parsed);

  if (!object) {
    return null;
  }

  if (object["kvlistValue"] || object["kvlist_value"]) {
    const map: JSONObject | null = asObject(readOtlpAnyValue(object));

    return map ? fromCollectorMap(map) : null;
  }

  if (object["event_id"] !== undefined && object["provider"] !== undefined) {
    return fromCollectorMap(object);
  }

  if (object["winlog"]) {
    return fromWinlogbeat(object);
  }

  return fromShipperJson(object);
}
