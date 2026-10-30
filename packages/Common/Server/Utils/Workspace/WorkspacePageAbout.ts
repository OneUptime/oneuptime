import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import { MarkdownText, mdText } from "../../../Utils/Markdown/FeedMarkdown";
import AlertService from "../../Services/AlertService";
import IncidentService from "../../Services/IncidentService";
import { OnCallPageRecordType } from "../../Services/OnCallPageService";
import QueryHelper from "../../Types/Database/QueryHelper";
import CaptureSpan from "../Telemetry/CaptureSpan";
import WorkspaceActionAnswers, {
  WorkspaceRecordName,
} from "./WorkspaceActionAnswers";
import WorkspaceMemberActions, {
  WorkspaceEventRecord,
  WorkspaceEventType,
} from "./WorkspaceMemberActions";

/*
 * WHAT A PAGE FROM A CHAT IS ABOUT: WHERE IT IS ASKED FOR DECIDES.
 *
 * "If I am paging someone from an incident channel, it's because of that
 * incident. You should not create an alert for it." (the maintainer, block
 * 31). `/oneuptime page` in Slack and "page" typed to the Microsoft Teams
 * bot made a new alert for every page, wherever it was asked for, so a page
 * from an incident's own channel was about an alert nobody needed - one more
 * record to close - and the incident's feed never heard of it.
 *
 *   IN AN INCIDENT'S OR AN ALERT'S OWN CHANNEL - the one OneUptime made for
 *   it (a notification rule's "create a channel": inc-42) - while it is
 *   still open, a page is about that incident or alert. Nothing new is
 *   created: the people are paged for it, through their own on-call rules,
 *   its channel shows the page, and its feed says who paged whom. A message
 *   is optional there - the incident says what the page is about - and,
 *   given, is the page's message (OnCallPersonPage).
 *
 *   ANYWHERE ELSE - another channel, a group chat, a message to the app, the
 *   app's Home, or the channel of an incident or alert that is resolved - a
 *   page is about something new: OneUptime creates an alert for it, whose
 *   title is the message, as it always did. A page needs a record to be
 *   acknowledged; an alert is the internal "somebody needs to look at this",
 *   which no status page shows. The person paging is told so in the words
 *   they see before they page (the form) and as they page (the answer), and
 *   in the channel of a resolved incident they are told why.
 *
 * Only the channel the record was made for counts: a channel many records
 * are posted to (#incidents) belongs to none of them, and a page there is
 * about something new.
 *
 * Slack and Microsoft Teams both ask here, so the two cannot drift apart.
 */

// The open incident or alert a page from its own channel is about.
export interface WorkspacePageRecord {
  type: OnCallPageRecordType;
  // As the member read it, in their project.
  event: WorkspaceEventRecord;
  // "Incident INC-18", "Alert ALT-3", with its link when it could be built.
  name: WorkspaceRecordName;
  title: string;
}

export interface WorkspacePageSubject {
  /*
   * The open incident or alert the page is about; null for a page about
   * something new, which creates an alert.
   */
  record: WorkspacePageRecord | null;
  /*
   * A page about something new asked in the channel of an incident or an
   * alert that is resolved: that record, which the form names as the
   * reason the page is about something new.
   */
  resolvedRecord?: WorkspaceRecordName | undefined;
}

// A run of white space in a title: a heading is one line.
const WHITE_SPACE_RUN: RegExp = /\s+/g;

// A page about something new: a new alert.
export const WORKSPACE_PAGE_NEW_ALERT_SUBJECT: WorkspacePageSubject = {
  record: null,
};

// What a form's value says the page is about: "incident:<id>", "alert:<id>".
const VALUE_KINDS: Record<string, OnCallPageRecordType> = {
  incident: OnCallPageRecordType.Incident,
  alert: OnCallPageRecordType.Alert,
};

// The member's refusal, when they may not page about the record: "... page someone about this incident".
const PAGE_ABOUT_ACTIONS: Record<OnCallPageRecordType, string> = {
  [OnCallPageRecordType.Incident]: "page someone about this incident",
  [OnCallPageRecordType.Alert]: "page someone about this alert",
};

export default class WorkspacePageAbout {
  /*
   * The incident or alert a channel was made for - its own channel, which
   * a notification rule created - read as OneUptime: which channels are a
   * record's own is OneUptime's to know, and nothing of the record is told
   * from it. The newest, should two claim one channel. Null for any other
   * channel: one many records are posted to belongs to none.
   */
  @CaptureSpan()
  public static async findChannelRecord(data: {
    projectId: ObjectID;
    channelId: string | undefined;
  }): Promise<{ type: OnCallPageRecordType; id: ObjectID } | null> {
    const channelId: string = (data.channelId || "").trim();

    if (!channelId) {
      return null;
    }

    const query: {
      projectId: ObjectID;
      postUpdatesToWorkspaceChannels: ReturnType<
        typeof QueryHelper.jsonContains
      >;
    } = {
      projectId: data.projectId,
      postUpdatesToWorkspaceChannels: QueryHelper.jsonContains([
        { id: channelId },
      ]),
    };

    const [incident, alert]: [Incident | null, Alert | null] =
      await Promise.all([
        IncidentService.findOneBy({
          query: query,
          select: {
            _id: true,
            createdAt: true,
          },
          sort: {
            createdAt: SortOrder.Descending,
          },
          props: {
            isRoot: true,
          },
        }),
        AlertService.findOneBy({
          query: query,
          select: {
            _id: true,
            createdAt: true,
          },
          sort: {
            createdAt: SortOrder.Descending,
          },
          props: {
            isRoot: true,
          },
        }),
      ]);

    const createdAt: (record: Incident | Alert | null) => number = (
      record: Incident | Alert | null,
    ): number => {
      return record?.createdAt ? new Date(record.createdAt).getTime() : 0;
    };

    if (incident?.id && (!alert?.id || createdAt(incident) >= createdAt(alert))) {
      return { type: OnCallPageRecordType.Incident, id: incident.id };
    }

    if (alert?.id) {
      return { type: OnCallPageRecordType.Alert, id: alert.id };
    }

    return null;
  }

  /*
   * What a page asked for in `channelId` is about (see the header), read as
   * the member (`props`): the open incident or alert the channel was made
   * for, or something new. Throws NotAuthorizedException - why they may not
   * read the channel's record, for the chat to tell them - when the channel
   * is a record's own and the member may not read it: the page there would
   * be about it, and nothing is paged.
   */
  @CaptureSpan()
  public static async read(data: {
    projectId: ObjectID;
    channelId: string | undefined;
    props: DatabaseCommonInteractionProps;
  }): Promise<WorkspacePageSubject> {
    const owner: { type: OnCallPageRecordType; id: ObjectID } | null =
      await WorkspacePageAbout.findChannelRecord({
        projectId: data.projectId,
        channelId: data.channelId,
      });

    if (!owner) {
      return WORKSPACE_PAGE_NEW_ALERT_SUBJECT;
    }

    return await WorkspacePageAbout.readRecord({
      type: owner.type,
      id: owner.id,
      props: data.props,
    });
  }

  /*
   * What a form's value says its page is about (toValue), read again as the
   * member who submits it: an incident or an alert, or - for an empty value
   * or one no form of OneUptime's writes - something new. A record resolved
   * since the form opened makes it a page about something new, said as such
   * (resolvedRecord). Throws as `read` does.
   */
  @CaptureSpan()
  public static async readValue(data: {
    value: string | undefined;
    props: DatabaseCommonInteractionProps;
  }): Promise<WorkspacePageSubject> {
    const parsed: { type: OnCallPageRecordType; id: ObjectID } | null =
      WorkspacePageAbout.parseValue(data.value);

    if (!parsed) {
      return WORKSPACE_PAGE_NEW_ALERT_SUBJECT;
    }

    return await WorkspacePageAbout.readRecord({
      type: parsed.type,
      id: parsed.id,
      props: data.props,
    });
  }

  /*
   * What a form carries of what its page is about, for its submission to
   * read again (readValue): "incident:<id>", "alert:<id>", or "" for
   * something new.
   */
  public static toValue(about: WorkspacePageSubject): string {
    if (!about.record) {
      return "";
    }

    return `${about.record.type === OnCallPageRecordType.Incident ? "incident" : "alert"}:${about.record.event.id.toString()}`;
  }

  // A form's value, read: null for one no form of OneUptime's writes.
  public static parseValue(
    value: string | undefined | null,
  ): { type: OnCallPageRecordType; id: ObjectID } | null {
    const text: string = (value || "").trim();
    const separator: number = text.indexOf(":");

    if (separator === -1) {
      return null;
    }

    const type: OnCallPageRecordType | undefined =
      VALUE_KINDS[text.substring(0, separator)];
    const id: string = text.substring(separator + 1).trim();

    if (!type || !ObjectID.isValidUUID(id)) {
      return null;
    }

    return { type: type, id: new ObjectID(id) };
  }

  /*
   * The page's targets about the record, as OnCallPageService takes them:
   * its incident's or its alert's id.
   */
  public static getRecordAbout(record: WorkspacePageRecord): {
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
  } {
    return record.type === OnCallPageRecordType.Incident
      ? { incidentId: record.event.id }
      : { alertId: record.event.id };
  }

  /*
   * What a form about the record opens with, the way an incident's own
   * forms do: "🚨 **INC-18** Checkout is down", the number linked to the
   * record.
   */
  public static getHeading(record: WorkspacePageRecord): MarkdownText {
    const number: string =
      record.event.numberWithPrefix ||
      (record.event.number !== null ? `#${record.event.number}` : "");
    const title: string = record.title.replace(WHITE_SPACE_RUN, " ").trim();

    if (!number) {
      return mdText`🚨 ${title}`;
    }

    const numberMarkdown: MarkdownText = record.name.link
      ? mdText`**[${number}](${record.name.link})**`
      : mdText`**${number}**`;

    return title
      ? mdText`🚨 ${numberMarkdown} ${title}`
      : mdText`🚨 ${numberMarkdown}`;
  }

  /*
   * What the answer says the page is about, after "Paging Nawaz": "about
   * Incident INC-18", or "about a new alert". Text.
   */
  public static getAboutWords(about: WorkspacePageSubject): string {
    return about.record ? `about ${about.record.name.label}` : "about a new alert";
  }

  /*
   * The record, read as the member - one they may not read is refused with
   * why - and where it stands: open, the page is about it; resolved, the
   * page is about something new, and says why.
   */
  private static async readRecord(data: {
    type: OnCallPageRecordType;
    id: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<WorkspacePageSubject> {
    const eventType: WorkspaceEventType =
      data.type === OnCallPageRecordType.Incident
        ? WorkspaceEventType.Incident
        : WorkspaceEventType.Alert;

    const found: {
      record: Incident | Alert;
      event: WorkspaceEventRecord;
    } = await WorkspaceMemberActions.readEventForMember<Incident | Alert>({
      event: { type: eventType, id: data.id },
      props: data.props,
      select: {
        title: true,
      },
      action: PAGE_ABOUT_ACTIONS[data.type],
    });

    const name: WorkspaceRecordName =
      await WorkspaceActionAnswers.getRecordName(found.event);

    if ((await WorkspaceMemberActions.getStanding(found.event)).isResolved) {
      return { record: null, resolvedRecord: name };
    }

    return {
      record: {
        type: data.type,
        event: found.event,
        name: name,
        title: found.record.title?.toString() || "",
      },
    };
  }

  // The record as an answer names it: "**[Incident INC-18](link)**".
  public static getRecordMarkdown(record: WorkspacePageRecord): MarkdownText {
    return WorkspaceActionAnswers.getRecordMarkdown(record.name);
  }
}
