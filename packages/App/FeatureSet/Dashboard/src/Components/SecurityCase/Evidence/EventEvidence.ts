import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import SecurityCaseEvidence from "Common/Models/DatabaseModels/SecurityCaseEvidence";
import ObjectID from "Common/Types/ObjectID";
import SecurityCaseEvidenceKind from "Common/Types/SecurityCase/SecurityCaseEvidenceKind";
import {
  SecurityCaseEventSnapshot,
  readSecurityCaseEventSnapshot,
} from "Common/Types/SecurityCase/SecurityCaseEventEvidence";

/*
 * A security event kept on a case (SecurityCaseEvidenceKind.Event), as the
 * case's Evidence page reads it: the event as OneUptime kept it - never
 * read again from the events table, where it may be past its retention -
 * the line of facts under its name, and the same event as the Events
 * explorer's panel draws one. React-free, so a plain test pins it.
 */

// Whether a piece of evidence is a kept security event.
export function isEventEvidence(
  evidence: Pick<SecurityCaseEvidence, "kind">,
): boolean {
  return evidence.kind === SecurityCaseEvidenceKind.Event;
}

// The event a piece of evidence keeps; null for a file, a link, or a snapshot that does not read.
export function readEventEvidence(
  evidence: Pick<SecurityCaseEvidence, "kind" | "eventSnapshot">,
): SecurityCaseEventSnapshot | null {
  if (!isEventEvidence(evidence)) {
    return null;
  }

  return readSecurityCaseEventSnapshot(evidence.eventSnapshot);
}

/*
 * The small line under a kept event's name: when it happened, how severe it
 * was, what kind of event, and where it came from - each left out where
 * the event did not say. `formatTime` writes the time as the reader reads
 * dates.
 */
export function getEventEvidenceMeta(data: {
  snapshot: SecurityCaseEventSnapshot;
  formatTime: (time: Date) => string;
}): string {
  return getEventEvidenceMetaParts(data).join(" · ");
}

/*
 * The same line's parts, each drawn in an isolate of its own: the time in
 * the reader's language, the event's words as the event wrote them - so a
 * Persian date and an English vendor each read their own way.
 */
export function getEventEvidenceMetaParts(data: {
  snapshot: SecurityCaseEventSnapshot;
  formatTime: (time: Date) => string;
}): Array<string> {
  const snapshot: SecurityCaseEventSnapshot = data.snapshot;
  const time: Date | null = snapshot.time ? new Date(snapshot.time) : null;
  const source: string = [snapshot.vendorName, snapshot.productName]
    .map((part: string): string => {
      return part.trim();
    })
    .filter((part: string, index: number, parts: Array<string>): boolean => {
      // "Okta Okta" says nothing twice: a product named like its vendor is said once.
      return Boolean(part) && parts.indexOf(part) === index;
    })
    .join(" ");

  return [
    time && !Number.isNaN(time.getTime()) ? data.formatTime(time) : "",
    snapshot.severityName,
    snapshot.className,
    source,
  ]
    .map((part: string): string => {
      return part.trim();
    })
    .filter((part: string): boolean => {
      return Boolean(part);
    });
}

/*
 * The kept event as a SecurityEvent, for the panel the Events explorer opens
 * on one: every column the snapshot keeps, under its own name.
 */
export function toSecurityEvent(
  snapshot: SecurityCaseEventSnapshot,
): SecurityEvent {
  const event: SecurityEvent = new SecurityEvent();

  if (snapshot.time) {
    event.time = new Date(snapshot.time);
  }

  event.eventUid = snapshot.eventUid;

  if (snapshot.sourceId && ObjectID.isValidUUID(snapshot.sourceId)) {
    event.primaryEntityId = new ObjectID(snapshot.sourceId);
  }

  const columns: Array<[string, unknown]> = [
    ["severityName", snapshot.severityName],
    ["className", snapshot.className],
    ["categoryName", snapshot.categoryName],
    ["activityName", snapshot.activityName],
    ["statusName", snapshot.statusName],
    ["message", snapshot.message],
    ["vendorName", snapshot.vendorName],
    ["productName", snapshot.productName],
    ["ruleName", snapshot.ruleName],
    ["principalUser", snapshot.principalUser],
    ["principalHost", snapshot.principalHost],
    ["principalIp", snapshot.principalIp],
    ["targetUser", snapshot.targetUser],
    ["targetHost", snapshot.targetHost],
    ["targetIp", snapshot.targetIp],
    ["processName", snapshot.processName],
    ["processCommandLine", snapshot.processCommandLine],
    ["observables", snapshot.observables],
    ["mitreTactics", snapshot.mitreTactics],
    ["mitreTechniques", snapshot.mitreTechniques],
    ["attributes", snapshot.attributes],
  ];

  for (const [column, value] of columns) {
    event.setColumnValue(column, value as never);
  }

  if (snapshot.targetPort !== null) {
    event.setColumnValue("targetPort", snapshot.targetPort);
  }

  return event;
}
