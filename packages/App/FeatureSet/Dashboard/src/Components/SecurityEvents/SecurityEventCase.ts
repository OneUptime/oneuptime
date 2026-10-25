import {
  SECURITY_EVENT_ENTITY_FIELDS,
  SecurityEntity,
  SecurityEntityType,
  entitiesFromObservables,
  mergeSecurityEntities,
} from "Common/Types/SecurityCase/SecurityEntity";
import SecurityCasePriorityLevel, {
  securityCasePriorityLevelFromSeverity,
} from "Common/Types/SecurityCase/SecurityCasePriorityLevel";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "Common/Utils/Markdown/FeedMarkdown";

/*
 * A case opened by hand from one security event, as the event's detail
 * panel offers it: what the event was, how bad, and who and what it names.
 * The event's own text is untrusted, so it reaches the case's Markdown only
 * as code: a message can never become a link or a heading there.
 *
 * React-free so the draft is pinned in a plain test.
 */

export interface SecurityEventForCase {
  time?: Date | undefined;
  eventUid?: string | undefined;
  className?: string | undefined;
  activityName?: string | undefined;
  severityName?: string | undefined;
  message?: string | undefined;
  productName?: string | undefined;
  vendorName?: string | undefined;
  principalUser?: string | undefined;
  principalHost?: string | undefined;
  principalIp?: string | undefined;
  principalProcess?: string | undefined;
  processName?: string | undefined;
  parentProcessName?: string | undefined;
  targetUser?: string | undefined;
  targetHost?: string | undefined;
  targetIp?: string | undefined;
  observables?: Array<string> | undefined;
  mitreTactics?: Array<string> | undefined;
  mitreTechniques?: Array<string> | undefined;
}

export interface SecurityCaseDraft {
  title: string;
  description: string;
  // The level its severity reads as; the project's priority of it is set on the case.
  priorityLevel: SecurityCasePriorityLevel;
  entities: Array<SecurityEntity>;
  mitreTactics: Array<string>;
  mitreTechniques: Array<string>;
}

// The longest title a case opened from an event is given.
export const CASE_FROM_EVENT_TITLE_LIMIT: number = 200;

// The most of an event's message the case quotes.
export const CASE_FROM_EVENT_MESSAGE_LIMIT: number = 2000;

const TYPED_FIELDS: Array<keyof SecurityEventForCase> = [
  "principalUser",
  "principalHost",
  "principalIp",
  "principalProcess",
  "processName",
  "parentProcessName",
  "targetUser",
  "targetHost",
  "targetIp",
];

function oneLine(text: string, limit: number): string {
  // Only the start is used, so only the start is read.
  const start: string = text.slice(0, limit * 2);
  let line: string = "";
  let lastWasSpace: boolean = false;

  for (const character of start) {
    const isSpace: boolean = character.trim() === "";

    if (isSpace) {
      if (!lastWasSpace && line.length > 0) {
        line += " ";
      }
      lastWasSpace = true;
      continue;
    }

    line += character;
    lastWasSpace = false;
  }

  line = line.trim();

  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
}

// The entities an event names: its typed columns first, then its other observables.
export function getEventEntities(
  event: SecurityEventForCase,
): Array<SecurityEntity> {
  const typed: Array<SecurityEntity> = [];

  for (const field of TYPED_FIELDS) {
    const value: unknown = event[field];
    const type: SecurityEntityType | undefined =
      SECURITY_EVENT_ENTITY_FIELDS[field];

    if (typeof value === "string" && value.trim() && type) {
      typed.push({ type, value: value.trim() });
    }
  }

  return mergeSecurityEntities(
    typed,
    entitiesFromObservables(event.observables),
  );
}

export function buildCaseFromSecurityEvent(
  event: SecurityEventForCase,
): SecurityCaseDraft {
  const what: string = (event.className || "").trim() || "Security event";
  const detail: string = oneLine(
    (event.activityName || "").trim() || (event.message || "").trim(),
    CASE_FROM_EVENT_TITLE_LIMIT,
  );
  const title: string = oneLine(
    detail ? `${what}: ${detail}` : what,
    CASE_FROM_EVENT_TITLE_LIMIT,
  );

  const facts: Array<MarkdownText> = [];

  if (event.time) {
    facts.push(mdText`**Time:** ${new Date(event.time).toISOString()}`);
  }

  if (event.severityName) {
    facts.push(mdText`**Severity:** ${event.severityName}`);
  }

  const source: string = [event.vendorName, event.productName]
    .filter((part: string | undefined): boolean => {
      return Boolean(part && part.trim());
    })
    .join(" ");

  if (source) {
    facts.push(mdText`**Source:** ${source}`);
  }

  if (event.eventUid) {
    facts.push(mdText`**Event ID:** ${FeedMarkdown.code(event.eventUid)}`);
  }

  const message: string = (event.message || "").slice(
    0,
    CASE_FROM_EVENT_MESSAGE_LIMIT,
  );

  const opening: MarkdownText = event.className
    ? mdText`Opened by hand from a ${event.className} security event.`
    : mdText`Opened by hand from a security event.`;

  const description: MarkdownText = mdText`${opening}${
    facts.length > 0
      ? mdText`\n\n${FeedMarkdown.bulletList(facts)}`
      : FeedMarkdown.empty()
  }${
    message.trim()
      ? mdText`\n\n**Message:** ${FeedMarkdown.code(oneLine(message, CASE_FROM_EVENT_MESSAGE_LIMIT))}`
      : FeedMarkdown.empty()
  }`;

  return {
    title,
    description: description.toString(),
    priorityLevel: securityCasePriorityLevelFromSeverity(event.severityName),
    entities: getEventEntities(event),
    mitreTactics: [...(event.mitreTactics || [])],
    mitreTechniques: [...(event.mitreTechniques || [])],
  };
}
