import AuditLogAction from "../../../Types/AuditLog/AuditLogAction";
import { JSONObject } from "../../../Types/JSON";
import { SECURITY_LOG_SOURCE_ATTRIBUTE } from "../../../Types/SecurityEvent/SecurityLogFormat";
import {
  SecurityTelemetrySourceDefinition,
  SecurityTelemetrySourceKind,
  getSecurityTelemetrySourceDefinition,
} from "../../../Types/SecurityEvent/SecurityTelemetrySource";
import { markdownCodeSpan } from "../../Markdown/MarkdownEscape";
import {
  AUDIT_ATTRIBUTES,
  AUDIT_SECURITY_RESOURCE_TYPES,
  AuditChangeWords,
  AuditResourceType,
  classifyAuditRecord,
  describeAuditTarget,
  getAuditChangeWords,
  quoteAuditRecordName,
} from "./AuditLogSignals";

/*
 * EVENTS STORED BEFORE #10663 SAY WHAT A NEW ONE SAYS: NO NAME ITS READERS
 * MAY NOT READ.
 *
 * Until #10663 an event about a change in OneUptime named its record - an
 * API key, a custom role, a team - in its message ("alice created the API
 * key "terraform""), its target ("API Key: terraform") and
 * `audit.resource_name`, whoever read it. New events name a record only
 * where every reader of security events reads it (AuditLogSignals). The
 * ones already stored, and what was made of them, are reworded here, once,
 * by a data migration (Workers/DataMigrations/
 * WithholdAuditRecordNamesInSecurityEvents):
 *
 *   - an event, or a copy of one a detection or a case's evidence kept
 *     (withholdAuditRecordNameInEvent): its name taken out of the three,
 *     the message said as a new event says it ("alice created an API key"),
 *     the target by its type and id. The ClickHouse table's own rows are
 *     reworded the same way, in SQL (AuditRecordNamesRepair);
 *   - text a detection, a case, an alert or an incident was written with,
 *     and their feeds, where it quotes an event (withholdAuditRecordNames
 *     InSampleLines): the "Sample event:" line reworded.
 *
 * A message is reworded by the words it was said with (getAuditChangeWords):
 * the last place it says a change's words, then a quoted name to its end,
 * is said with the words of a record it does not name. The words name the
 * change's verb ("created the API key"), so an actor's own quoted name
 * ("The API key "ci"", "with the permissions the API key "terraform" gave
 * it") is never taken for the record's.
 */

// The audit log's own source, as each of its events says it.
export const AUDIT_LOG_SOURCE_KIND: string =
  SecurityTelemetrySourceKind.AuditLog;

const AUDIT_LOG_SOURCE: SecurityTelemetrySourceDefinition =
  getSecurityTelemetrySourceDefinition(SecurityTelemetrySourceKind.AuditLog);

// What a message says of a change, and how it says it without a name.
export interface AuditChangeSaying extends AuditChangeWords {
  resourceType: string;
  action: string;
}

/*
 * Every way the scan says a change it reports: each type it reads, each
 * action on it that is a signal, with its words. Longer words first, so a
 * search through them finds "took a custom role away from an API key"
 * before anything it holds.
 */
export function getAuditChangeSayings(): Array<AuditChangeSaying> {
  const sayings: Array<AuditChangeSaying> = [];

  for (const resourceType of AUDIT_SECURITY_RESOURCE_TYPES) {
    for (const action of Object.values(AuditLogAction) as Array<string>) {
      if (!classifyAuditRecord({ resourceType, action })) {
        continue;
      }

      const words: AuditChangeWords | null = getAuditChangeWords(
        resourceType,
        action,
      );

      if (words) {
        sayings.push({ resourceType, action, ...words });
      }
    }
  }

  return sayings.sort((a: AuditChangeSaying, b: AuditChangeSaying): number => {
    return b.named.length - a.named.length;
  });
}

// What a change's words are found by: " created the API key "".
export function getNamedWordsNeedle(saying: AuditChangeWords): string {
  return ` ${saying.named} "`;
}

/*
 * A message said with these words, without the record's name: what it
 * says before the last place it says them, then the words of a record it
 * does not name. Null when it does not end with them and a quoted name.
 */
function rewordWith(message: string, saying: AuditChangeWords): string | null {
  const needle: string = getNamedWordsNeedle(saying);
  const at: number = message.lastIndexOf(needle);

  if (
    at < 0 ||
    !message.endsWith('"') ||
    message.length <= at + needle.length
  ) {
    return null;
  }

  return `${message.slice(0, at)} ${saying.unnamed}`;
}

/*
 * An event's message said without its record's name, as a new event says
 * it, by the change its attributes say it was. Its words are chosen by the
 * type and the action, so nothing else in the message is touched: the
 * message ends with them and the name as the event said it
 * (quoteAuditRecordName) - or, failing that, with them and some quoted
 * name. An MCP client's authorization that names the client it was made
 * through names the actor's, which is kept. Unchanged when it says no name.
 */
export function withholdAuditRecordNameInMessage(data: {
  message: string;
  resourceType: string;
  action: string;
  resourceName?: string | undefined;
  mcpClientName?: string | undefined;
}): string {
  if (
    data.resourceType === AuditResourceType.McpClientAuthorization &&
    (data.mcpClientName || "").trim()
  ) {
    return data.message;
  }

  const words: AuditChangeWords | null = getAuditChangeWords(
    data.resourceType,
    data.action,
  );

  if (!words) {
    return data.message;
  }

  const quotedName: string = quoteAuditRecordName(data.resourceName || "");
  const tail: string = ` ${words.named}${quotedName}`;

  if (quotedName && data.message.endsWith(tail)) {
    return `${data.message.slice(0, data.message.length - tail.length)} ${words.unnamed}`;
  }

  return rewordWith(data.message, words) ?? data.message;
}

/*
 * A message without its record's name when it is not known what change it
 * was - text that quotes an event: the words it says last decide, of the
 * types whose names are withheld (all, unless `isNameWithheld` says). An
 * MCP client's authorization is left as it is: what it quotes may be the
 * client, the actor's, and text says nothing of which.
 */
export function withholdAuditRecordNameInSentence(
  sentence: string,
  isNameWithheld?: ((resourceType: string) => boolean) | undefined,
): string {
  let best: { at: number; reworded: string } | null = null;

  for (const saying of getAuditChangeSayings()) {
    if (
      saying.resourceType === AuditResourceType.McpClientAuthorization ||
      (isNameWithheld && !isNameWithheld(saying.resourceType))
    ) {
      continue;
    }

    const at: number = sentence.lastIndexOf(getNamedWordsNeedle(saying));
    const reworded: string | null = rewordWith(sentence, saying);

    if (reworded !== null && (!best || at > best.at)) {
      best = { at, reworded };
    }
  }

  return best ? best.reworded : sentence;
}

// The fields of an event, or of a copy of one, that can hold its record's name.
export interface AuditRecordNameFields {
  message: string;
  targetResource?: string | undefined;
  attributes: JSONObject;
  vendorName?: string | undefined;
  productName?: string | undefined;
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/*
 * Whether an event, or a copy of one, is the audit log's and still names
 * its record: its source the audit log - as its attributes say, or its
 * vendor and product where a copy kept fewer attributes - and a name in
 * `audit.resource_name`.
 */
export function isAuditEventNamingItsRecord(event: {
  attributes: JSONObject;
  vendorName?: string | undefined;
  productName?: string | undefined;
}): boolean {
  const attributes: JSONObject = event.attributes || {};
  const isAuditLogs: boolean =
    attributes[SECURITY_LOG_SOURCE_ATTRIBUTE] === AUDIT_LOG_SOURCE_KIND ||
    (event.vendorName === AUDIT_LOG_SOURCE.vendorName &&
      event.productName === AUDIT_LOG_SOURCE.productName);

  return (
    isAuditLogs && textOf(attributes[AUDIT_ATTRIBUTES.resourceName]) !== ""
  );
}

/*
 * An event, or a copy of one, as a new one would be written: for the audit
 * log's event about a record whose name is withheld (isNameWithheld, by its
 * type), the name taken out of its attributes, its message and its target.
 * Null when there is nothing to take out.
 */
export function withholdAuditRecordNameInEvent<
  TEvent extends AuditRecordNameFields,
>(data: {
  event: TEvent;
  isNameWithheld: (resourceType: string) => boolean;
}): TEvent | null {
  const attributes: JSONObject = data.event.attributes || {};

  if (
    !isAuditEventNamingItsRecord({
      attributes,
      vendorName: data.event.vendorName,
      productName: data.event.productName,
    })
  ) {
    return null;
  }

  const resourceType: string = textOf(
    attributes[AUDIT_ATTRIBUTES.resourceType],
  );

  if (!resourceType || !data.isNameWithheld(resourceType)) {
    return null;
  }

  const withheld: JSONObject = { ...attributes };
  delete withheld[AUDIT_ATTRIBUTES.resourceName];

  const event: TEvent = {
    ...data.event,
    attributes: withheld,
    message: withholdAuditRecordNameInMessage({
      message: data.event.message || "",
      resourceType,
      action: textOf(attributes[AUDIT_ATTRIBUTES.action]),
      resourceName: textOf(attributes[AUDIT_ATTRIBUTES.resourceName]),
      mcpClientName: textOf(attributes[AUDIT_ATTRIBUTES.mcpClientName]),
    }),
  };

  if (data.event.targetResource !== undefined) {
    event.targetResource = describeAuditTarget({
      resourceType,
      resourceId: textOf(attributes[AUDIT_ATTRIBUTES.resourceId]),
      resourceName: "",
    });
  }

  return event;
}

/*
 * How an event is quoted in what was written of it: a match's sample
 * (DetectionRuleEvaluator, SecurityCaseMarkdown) and a case opened from
 * one by hand (the Dashboard's SecurityEventCase).
 */
export const SAMPLE_EVENT_PREFIXES: ReadonlyArray<string> = [
  "Sample event: ",
  "**Message:** ",
];

// A code span's fence and what it holds (markdownCodeSpan): "`x`" or "`` x ``".
const CODE_SPAN_PATTERN: RegExp = /^(`+)( ?)([\s\S]*?)\2\1$/;

/*
 * One sample event as a line quotes it - bare, or as a code span - said
 * without its record's name, quoted again the way it was.
 */
function withholdInQuotedSample(
  quotedSample: string,
  isNameWithheld?: ((resourceType: string) => boolean) | undefined,
): string {
  const span: RegExpMatchArray | null = quotedSample.match(CODE_SPAN_PATTERN);

  if (!span) {
    return withholdAuditRecordNameInSentence(quotedSample, isNameWithheld);
  }

  const inside: string = span[3] || "";
  const reworded: string = withholdAuditRecordNameInSentence(
    inside,
    isNameWithheld,
  );

  return reworded === inside ? quotedSample : markdownCodeSpan(reworded);
}

/*
 * Text that quotes an event - a detection's, a case's, an alert's or an
 * incident's description, or a feed item holding it - with each line that
 * quotes one ("Sample event: ...", "**Message:** ...") said without the
 * name of the record it is about. Everything else is as it was.
 */
export function withholdAuditRecordNamesInSampleLines(
  text: string,
  isNameWithheld?: ((resourceType: string) => boolean) | undefined,
): string {
  if (
    !text ||
    !SAMPLE_EVENT_PREFIXES.some((prefix: string): boolean => {
      return text.includes(prefix);
    })
  ) {
    return text;
  }

  return text
    .split("\n")
    .map((line: string): string => {
      for (const prefix of SAMPLE_EVENT_PREFIXES) {
        const at: number = line.indexOf(prefix);

        if (at < 0) {
          continue;
        }

        const before: string = line.slice(0, at + prefix.length);
        const sample: string = line.slice(at + prefix.length);
        // A line may end in spaces, as a feed's Markdown writes it.
        const trailing: string = sample.match(/\s*$/)?.[0] || "";
        const quoted: string = sample.slice(0, sample.length - trailing.length);

        return `${before}${withholdInQuotedSample(quoted, isNameWithheld)}${trailing}`;
      }

      return line;
    })
    .join("\n");
}

/*
 * Text with one quoted event a line - a case feed's list of the events
 * added as evidence ("10:02 · Low · alice created the API key "x"") - each
 * line said without the name of the record it is about.
 */
export function withholdAuditRecordNamesInEachLine(
  text: string,
  isNameWithheld?: ((resourceType: string) => boolean) | undefined,
): string {
  if (!text) {
    return text;
  }

  return text
    .split("\n")
    .map((line: string): string => {
      const trailing: string = line.match(/\s*$/)?.[0] || "";
      const content: string = line.slice(0, line.length - trailing.length);

      return `${withholdAuditRecordNameInSentence(content, isNameWithheld)}${trailing}`;
    })
    .join("\n");
}
