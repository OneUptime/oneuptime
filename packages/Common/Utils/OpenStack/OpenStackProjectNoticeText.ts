import { JSONObject } from "../../Types/JSON";
import {
  OpenStackBlastRadius,
  OpenStackBlastRadiusCount,
  describeOpenStackBlastRadiusCounts,
} from "../../Types/OpenStack/OpenStackBlastRadius";
import { OpenStackProjectNoticeEvent } from "../../Types/OpenStack/OpenStackProjectNotice";
import FeedMarkdown, { MarkdownText, mdText } from "../Markdown/FeedMarkdown";

/*
 * WHAT A PROJECT'S NOTICE SAYS.
 *
 * Written from the facts a notice holds and nothing else: never an incident's title or description,
 * which name hosts and every other project on them. So what one project reads can only be about that
 * project, by construction: nothing else is in the facts to leak.
 *
 * Every word from a cloud goes through reportedValue, in the email and in the webhook: a project or
 * region can be called anything, and nothing in a name acts in a mail client, a chat room or whatever
 * reads the webhook. The email's image-free template and this text load nothing from outside.
 */

export interface OpenStackProjectNoticeFacts {
  event: OpenStackProjectNoticeEvent;
  projectId: string;
  projectName: string | null;
  // Our own words for the part: describeOpenStackPartToAProject.
  partWords: string;
  partKind: string;
  // Which row of a project's own page this belongs to, if any.
  service?: string | null | undefined;
  regionName: string | null;
  zoneName?: string | null | undefined;
  // What this project holds on it, and only this project.
  holdings: Partial<Pick<OpenStackBlastRadius, OpenStackBlastRadiusCount>>;
  occurredAt: string;
  // A maintenance event's window.
  startsAt?: string | null | undefined;
  endsAt?: string | null | undefined;
}

export interface OpenStackProjectNoticeMessage {
  subject: string;
  markdown: string;
  webhook: JSONObject;
}

// What goes in a subject line: one short line, whatever a name holds.
const SUBJECT_NAME_LENGTH: number = 80;

function toOneLine(value: string): string {
  let line: string = "";
  for (const character of value) {
    if (line.length >= SUBJECT_NAME_LENGTH) {
      return `${line}...`;
    }
    const code: number = character.charCodeAt(0);
    // Control characters, line breaks among them: a header holds none.
    line += code < 32 || code === 127 ? " " : character;
  }
  return line.trim();
}

function reported(value: string | null | undefined): string {
  return FeedMarkdown.reportedValue(value || "");
}

function toUtc(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const at: Date = new Date(value);
  return Number.isNaN(at.getTime())
    ? null
    : `${at.toISOString().substring(0, 16).replace("T", " ")} UTC`;
}

function toLowerStart(words: string): string {
  return words.substring(0, 1).toLowerCase() + words.substring(1);
}

/*
 * A name from a cloud as text and only text. In a code span, because in a sentence a mail client's
 * Markdown would make a link of a project called https://example.com, and nobody chose to send that.
 */
function nameOf(value: string | null | undefined): MarkdownText {
  return FeedMarkdown.code(reported(value));
}

function whereItIs(facts: OpenStackProjectNoticeFacts): MarkdownText {
  if (facts.zoneName && facts.regionName) {
    return mdText` in availability zone ${nameOf(facts.zoneName)}, region ${nameOf(facts.regionName)}`;
  }
  if (facts.zoneName) {
    return mdText` in availability zone ${nameOf(facts.zoneName)}`;
  }
  return facts.regionName
    ? mdText` in region ${nameOf(facts.regionName)}`
    : FeedMarkdown.empty();
}

function headline(facts: OpenStackProjectNoticeFacts): MarkdownText {
  const where: MarkdownText = whereItIs(facts);

  switch (facts.event) {
    case OpenStackProjectNoticeEvent.IncidentOpened:
      return mdText`**${facts.partWords}${where} has an incident.**`;
    case OpenStackProjectNoticeEvent.IncidentResolved:
      return mdText`**The incident on ${toLowerStart(facts.partWords)}${where} is resolved.**`;
    case OpenStackProjectNoticeEvent.MaintenancePlanned:
      return mdText`**Maintenance is planned on ${toLowerStart(facts.partWords)}${where}.**`;
    case OpenStackProjectNoticeEvent.MaintenanceEnded:
      return mdText`**The maintenance on ${toLowerStart(facts.partWords)}${where} has ended.**`;
  }
}

function subjectOf(facts: OpenStackProjectNoticeFacts, name: string): string {
  const part: string = toLowerStart(facts.partWords);

  switch (facts.event) {
    case OpenStackProjectNoticeEvent.IncidentOpened:
      return `OpenStack notice for ${name}: incident on ${part}`;
    case OpenStackProjectNoticeEvent.IncidentResolved:
      return `OpenStack notice for ${name}: incident on ${part} resolved`;
    case OpenStackProjectNoticeEvent.MaintenancePlanned:
      return `OpenStack notice for ${name}: maintenance planned on ${part}`;
    case OpenStackProjectNoticeEvent.MaintenanceEnded:
      return `OpenStack notice for ${name}: maintenance on ${part} ended`;
  }
}

export function writeOpenStackProjectNotice(
  facts: OpenStackProjectNoticeFacts,
): OpenStackProjectNoticeMessage {
  const name: string = reported(facts.projectName || facts.projectId);
  const nameInText: MarkdownText = nameOf(facts.projectName || facts.projectId);
  const holdings: string = describeOpenStackBlastRadiusCounts(facts.holdings);
  const startsAt: string | null = toUtc(facts.startsAt);
  const endsAt: string | null = toUtc(facts.endsAt);
  const occurredAt: string | null = toUtc(facts.occurredAt);

  const isOver: boolean =
    facts.event === OpenStackProjectNoticeEvent.IncidentResolved ||
    facts.event === OpenStackProjectNoticeEvent.MaintenanceEnded;

  const sections: Array<MarkdownText> = [headline(facts)];

  if (holdings) {
    sections.push(
      isOver
        ? mdText`Project ${nameInText} holds ${holdings} there.`
        : mdText`This affects project ${nameInText}: ${holdings}.`,
    );
  } else {
    sections.push(mdText`This is about project ${nameInText}.`);
  }

  if (facts.event === OpenStackProjectNoticeEvent.MaintenancePlanned) {
    if (startsAt && endsAt) {
      sections.push(mdText`Planned from ${startsAt} to ${endsAt}.`);
    } else if (startsAt) {
      sections.push(mdText`Planned to start at ${startsAt}.`);
    }
    sections.push(mdText`You will be told again when it has ended.`);
  } else if (facts.event === OpenStackProjectNoticeEvent.IncidentOpened) {
    if (occurredAt) {
      sections.push(mdText`Started at ${occurredAt}.`);
    }
    sections.push(mdText`You will be told again when it is resolved.`);
  } else if (occurredAt) {
    sections.push(mdText`Over at ${occurredAt}.`);
  }

  sections.push(
    mdText`You are told because whoever runs this cloud set this address to hear about this project. They can change that.`,
  );

  const markdown: string = FeedMarkdown.join(sections, "\n\n").toString();

  return {
    subject: subjectOf(facts, toOneLine(name)),
    markdown,
    webhook: {
      kind: "openstack.project.notice",
      event: facts.event,
      occurredAt: facts.occurredAt,
      project: {
        id: reported(facts.projectId),
        name: facts.projectName ? reported(facts.projectName) : null,
      },
      part: {
        kind: facts.partKind,
        description: facts.partWords,
        regionName: facts.regionName ? reported(facts.regionName) : null,
        availabilityZone: facts.zoneName ? reported(facts.zoneName) : null,
      },
      holdings: facts.holdings as JSONObject,
      window:
        facts.startsAt || facts.endsAt
          ? { startsAt: facts.startsAt || null, endsAt: facts.endsAt || null }
          : null,
      message: markdown,
    },
  };
}
