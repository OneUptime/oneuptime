import Incident from "../../../Models/DatabaseModels/Incident";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import IncidentSubscriberAudience, {
  IncidentSubscriberAudienceExcludedStatusPage,
  IncidentSubscriberAudienceExclusionReason,
  IncidentSubscriberAudienceNamedStatusPage,
  IncidentSubscriberAudienceResult,
  IncidentSubscriberAudienceStatusPage,
} from "../../../Types/StatusPage/IncidentSubscriberAudience";
import StatusPageVisibility from "../../../Types/StatusPage/StatusPageVisibility";
import { WORKSPACE_CHECKBOX_TICKED_VALUE } from "../../../Types/Workspace/WorkspaceMessagePayload";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import DatabaseRequestType from "../../Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../Types/Database/Permissions/ColumnPermission";
import ColumnRefusalMessage from "../../Types/Database/Permissions/ColumnRefusalMessage";
import logger from "../Logger";
import IncidentSubscriberAudienceBuilder from "../StatusPage/IncidentSubscriberAudienceBuilder";
import NewIncidentSubscriberNotificationDefaultReader from "../StatusPage/NewIncidentSubscriberNotificationDefaultReader";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * "NOTIFY STATUS PAGE SUBSCRIBERS" ON THE CHATS' DECLARE INCIDENT FORMS, AND
 * WHAT THE CONFIRMATION SAYS ABOUT THEM (#7917, #7916).
 *
 * Declare New Incident in the Dashboard asks whether status page subscribers
 * are told about the new incident, in a box that starts as the project says
 * (Incidents > Settings > Subscriber Notifications, #7606:
 * NewIncidentSubscriberNotificationDefault). Slack's modal and Microsoft
 * Teams' card asked nothing, so an incident declared there took the
 * project's answer with no way to change it, and the confirmation said
 * nothing about subscribers either way. Mattermost has no Declare Incident
 * form, so it has nothing to ask.
 *
 * The form. Both chats ask it now, with the Dashboard's own name for the box
 * and its own question under it - "Unticked by default in this project."
 * added where it starts unticked, as on the Dashboard - starting ticked or
 * unticked from the same project column the Dashboard reads, read once per
 * form, as OneUptime (NewIncidentSubscriberNotificationDefaultReader). It
 * sits right after the monitors, as the Dashboard's Resources Affected step
 * puts it after them: status pages show an incident through its monitors.
 * It is not asked:
 *
 *   - of a member who may not give a new incident the choice: the
 *     Dashboard's form shows the box only to who holds the column's create
 *     permission (ModelForm), and the server refuses the column to anyone
 *     else (ColumnPermission) - so may the chats (mayChoose);
 *   - for an incident that will be private (declared in a private alert's
 *     own channel): no status page shows a private incident, so the box
 *     could change nothing, and the form already says it will be private.
 *
 * The answer. What the box was left at is what the incident is created
 * with (shouldStatusPageSubscribersBeNotifiedOnIncidentCreated), either way.
 * A form that did not ask - one opened before it asked, or one it was not
 * asked on - follows the project's switch, as every chat form did before
 * (NewIncidentSubscriberNotificationDefaultReader
 * .applyToIncidentDeclaredWithoutBox). An answer from somebody who may not
 * give one - a Teams card submitted by someone other than who asked for it,
 * or a form opened before their role changed - is refused, with why, and
 * nothing is declared (getRefusal): the box is theirs to use only where the
 * Dashboard would let them use it.
 *
 * The confirmation. One more line, after what the incident is linked to, in
 * both places it goes (the channel, or the person's direct messages with
 * the app), saying plainly what happens, from the incident as created and
 * from who it reaches - the status pages that show it, as the Dashboard's
 * review works them out before declaring (IncidentSubscriberAudienceBuilder,
 * read as the member, so a status page they may not read is counted, never
 * named):
 *
 *   - the subscribers of these status pages will be notified, by name. The
 *     notification goes out from a job a moment later
 *     (Incident:SendNotificationToSubscribers), so the line never says they
 *     were: nothing has been sent when it is posted;
 *   - or that they were not, and why, in a few words: the incident is
 *     private (or hidden from status pages), the box was off (and how to tell
 *     them later: a public note posted in OneUptime with the note's own box
 *     ticked - a chat note on such an incident stays quiet,
 *     PublicNoteSubscriberNotificationDefault), the incident has no
 *     monitors, or the status pages that show it have no subscribers yet or
 *     send them nothing - each page in the Dashboard's own words for it.
 *
 * A confirmation whose audience cannot be worked out says so, and never
 * guesses. The words are in English, as every other chat answer is
 * (WorkspaceActionAnswers, WorkspaceNoteForm); Microsoft Teams and Slack
 * read the same lines.
 */

// The field, as each chat names it: Slack's block and action, Teams' input.
export const WORKSPACE_NOTIFY_SUBSCRIBERS_FIELD: string =
  "notifyStatusPageSubscribers";

// The incident's column the answer is saved in.
export const INCIDENT_NOTIFY_SUBSCRIBERS_COLUMN: keyof Incident =
  "shouldStatusPageSubscribersBeNotifiedOnIncidentCreated";

// How many status pages a line names before it counts the rest.
export const WORKSPACE_NOTIFY_SUBSCRIBERS_PAGES_NAMED: number = 5;

/*
 * The words of the field, and of the confirmation's line. The box's name and
 * its question are the Dashboard's (Pages/Incidents/Create.tsx,
 * NewIncidentNotifyDefaultCopy), and each status page's reason is the
 * Dashboard's "Not notified" line for it (IncidentStatusPageScopeCopy):
 * WorkspaceIncidentSubscriberNotification.test pins both.
 */
export const WORKSPACE_NOTIFY_SUBSCRIBERS_TEXT: {
  label: string;
  box: string;
  question: string;
  questionUntickedByDefault: string;
  willNotify: string;
  notNotified: string;
  privateReason: string;
  hiddenReason: string;
  boxOffReason: string;
  boxOffHint: string;
  noMonitorsReason: string;
  noStatusPageReason: string;
  couldNotWorkOut: string;
  noSubscribersYet: string;
  notListingMonitors: string;
  morePages: string;
  oneMorePage: string;
  hiddenPages: string;
  oneHiddenPage: string;
  moreHiddenPages: string;
  oneMoreHiddenPage: string;
} = {
  // Above the box: what the field is about.
  label: "Status Page Subscribers",
  // Beside the box: the Dashboard box's own name.
  box: "Notify Status Page Subscribers",
  question:
    "Should status page subscribers be notified when this incident is created?",
  questionUntickedByDefault:
    "Should status page subscribers be notified when this incident is created? Unticked by default in this project.",
  willNotify: "Status page subscribers will be notified:",
  notNotified: "Status page subscribers were not notified:",
  privateReason: "the incident is private.",
  hiddenReason: "the incident is hidden from status pages.",
  boxOffReason: "Notify Status Page Subscribers was off.",
  boxOffHint:
    "To tell them later, post a public note in OneUptime with Notify Status Page Subscribers ticked.",
  noMonitorsReason: "the incident has no monitors, so no status page shows it.",
  noStatusPageReason: "no status page shows this incident's monitors.",
  couldNotWorkOut:
    "Could not work out which status page subscribers will be notified.",
  noSubscribersYet: "no subscribers yet",
  notListingMonitors: "lists none of these monitors",
  morePages: "{{number}} more status pages",
  oneMorePage: "1 more status page",
  hiddenPages: "{{number}} status pages you do not have access to",
  oneHiddenPage: "1 status page you do not have access to",
  moreHiddenPages: "{{number}} more status pages you do not have access to",
  oneMoreHiddenPage: "1 more status page you do not have access to",
};

/*
 * Why a status page that lists the incident's monitors will not tell its
 * subscribers, in the Dashboard's words for its "Not notified" list - each
 * after the page's name, in brackets.
 */
export const WORKSPACE_NOTIFY_SUBSCRIBERS_EXCLUSION_TEXT: Record<
  IncidentSubscriberAudienceExclusionReason,
  string
> = {
  [IncidentSubscriberAudienceExclusionReason.OutsideIncidentScope]:
    "not one of the pages this incident is limited to",
  [IncidentSubscriberAudienceExclusionReason.OnlyShowsScopedIncidents]:
    "only shows incidents limited to it",
  [IncidentSubscriberAudienceExclusionReason.HidesIncidents]:
    "does not show incidents",
  [IncidentSubscriberAudienceExclusionReason.NotificationsOff]:
    "does not send notifications to its subscribers",
  [IncidentSubscriberAudienceExclusionReason.AlreadyNotified]:
    "already sent this notification in full",
};

// The field a form shows: how it starts, and what it says under the box.
export interface WorkspaceNotifySubscribersField {
  isTickedByDefault: boolean;
  description: string;
}

// "A", "A and B", "A, B and C".
function joinWithAnd(items: Array<MarkdownText>): MarkdownText {
  if (items.length <= 1) {
    return items[0] || FeedMarkdown.empty();
  }

  return mdText`${FeedMarkdown.join(items.slice(0, -1))} and ${items[items.length - 1]!}`;
}

// A count into its sentence: "3 more status pages".
function withNumber(text: string, count: number): string {
  return text.split("{{number}}").join(String(count));
}

/*
 * The first WORKSPACE_NOTIFY_SUBSCRIBERS_PAGES_NAMED items, and how many
 * more - one past the cap is named too: "and 1 more" would hide just that
 * one.
 */
function capItems(items: Array<MarkdownText>): {
  named: Array<MarkdownText>;
  moreCount: number;
} {
  const named: Array<MarkdownText> =
    items.length > WORKSPACE_NOTIFY_SUBSCRIBERS_PAGES_NAMED + 1
      ? items.slice(0, WORKSPACE_NOTIFY_SUBSCRIBERS_PAGES_NAMED)
      : items;

  return { named: named, moreCount: items.length - named.length };
}

export default class WorkspaceIncidentSubscriberNotification {
  /*
   * Whether `props` may give a new incident the choice: the column's create
   * permission, by the rule the server's column check holds every create to
   * (ColumnPermissions.getModelColumnsByPermissions) - which is the rule the
   * Dashboard's form shows the box by. OneUptime itself and a server admin
   * always may, as they may everywhere.
   */
  public static mayChoose(props: DatabaseCommonInteractionProps): boolean {
    if (props.isRoot || props.isMasterAdmin) {
      return true;
    }

    /*
     * A copy: reading the rows writes the global permissions everybody holds
     * onto the props it reads, and the create that follows takes the
     * member's own props.
     */
    return ColumnPermissions.getModelColumnsByPermissions(
      Incident,
      ColumnPermissions.getColumnCheckRows({ ...props }),
      DatabaseRequestType.Create,
    ).columns.includes(INCIDENT_NOTIFY_SUBSCRIBERS_COLUMN);
  }

  /*
   * How the box starts for a form about to open, read alongside the form's
   * other reads: as the project says, once, as OneUptime. Null - and nothing
   * read - for a member the form does not ask (mayChoose).
   */
  @CaptureSpan()
  public static async readTickedByDefault(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<boolean | null> {
    if (!this.mayChoose(data.props)) {
      return null;
    }

    return await NewIncidentSubscriberNotificationDefaultReader.isTickedByDefault(
      data.projectId,
    );
  }

  /*
   * The field the form shows, or null when it asks nothing: for a member it
   * does not ask (readTickedByDefault answered null), or an incident that
   * will be private.
   */
  public static getField(data: {
    isTickedByDefault: boolean | null;
    isPrivate: boolean;
  }): WorkspaceNotifySubscribersField | null {
    if (data.isTickedByDefault === null || data.isPrivate) {
      return null;
    }

    return {
      isTickedByDefault: data.isTickedByDefault,
      description: data.isTickedByDefault
        ? WORKSPACE_NOTIFY_SUBSCRIBERS_TEXT.question
        : WORKSPACE_NOTIFY_SUBSCRIBERS_TEXT.questionUntickedByDefault,
    };
  }

  /*
   * The answer a submitted form carries: true or false, or null when the
   * form had no box. Slack sends a box's ticked options - its one option, or
   * none - and Microsoft Teams a toggle's "true" or "false". Anything else
   * is no answer.
   */
  public static readSubmitted(value: unknown): boolean | null {
    if (Array.isArray(value)) {
      return value.some((option: unknown): boolean => {
        return String(option) === WORKSPACE_CHECKBOX_TICKED_VALUE;
      });
    }

    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "string") {
      const answer: string = value.trim().toLowerCase();

      if (answer === "true") {
        return true;
      }

      if (answer === "false") {
        return false;
      }
    }

    return null;
  }

  /*
   * Why an answer is refused, or null when it is not: only an answer from a
   * member who may not give one is (mayChoose). It is told to them where
   * they submitted the form, and nothing is declared.
   */
  public static getRefusal(data: {
    props: DatabaseCommonInteractionProps;
    choice: boolean | null;
  }): string | null {
    if (data.choice === null || this.mayChoose(data.props)) {
      return null;
    }

    const whoMay: string = ColumnRefusalMessage.getWhoMay(
      "create",
      ColumnPermissions.getColumnWriteList(
        new Incident(),
        INCIDENT_NOTIFY_SUBSCRIBERS_COLUMN,
        DatabaseRequestType.Create,
      ),
    );

    return `You do not have permission to choose whether status page subscribers are notified, so the incident was not declared. ${whoMay} Open the form again to declare it without this choice.`;
  }

  /*
   * Writes the answer onto the incident being declared. A form that did not
   * ask follows the project's switch, as every chat form did before.
   */
  @CaptureSpan()
  public static async applyToIncident(data: {
    incident: Incident;
    projectId: ObjectID;
    choice: boolean | null;
  }): Promise<void> {
    if (data.choice === null) {
      await NewIncidentSubscriberNotificationDefaultReader.applyToIncidentDeclaredWithoutBox(
        {
          incident: data.incident,
          projectId: data.projectId,
        },
      );
      return;
    }

    data.incident.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated =
      data.choice;
  }

  /*
   * The confirmation's line about status page subscribers, for the incident
   * as it was created (`created`, as IncidentService.create gave it back) -
   * falling back on what was sent to be created (`declared`) for what the
   * create did not give back. It never throws: the incident exists, and a
   * confirmation that failed would read as a declare that failed, which
   * invites a second one.
   */
  @CaptureSpan()
  public static async getConfirmationLine(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    created: Incident;
    declared: Incident;
  }): Promise<MarkdownText> {
    const text: typeof WORKSPACE_NOTIFY_SUBSCRIBERS_TEXT =
      WORKSPACE_NOTIFY_SUBSCRIBERS_TEXT;

    if (
      StatusPageVisibility.isPrivate(data.created) ||
      StatusPageVisibility.isPrivate(data.declared)
    ) {
      return mdText`${text.notNotified} ${text.privateReason}`;
    }

    const notifies: boolean | undefined =
      data.created.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated ??
      data.declared.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated;

    // Only an explicit false: the column's own default notifies them.
    if (notifies === false) {
      return mdText`${text.notNotified} ${text.boxOffReason} ${text.boxOffHint}`;
    }

    const incidentId: ObjectID | null = data.created.id;

    if (!incidentId) {
      return mdText`${text.couldNotWorkOut}`;
    }

    try {
      /*
       * Read as the member, as the Dashboard's review reads it for them: a
       * status page they may not read is counted, never named. They just
       * declared the incident, so they hold one of the permissions that
       * may see who it reaches (IncidentSubscriberAudienceBuilder
       * .PERMISSIONS lists every one that may declare an incident).
       */
      const props: DatabaseCommonInteractionProps = { ...data.props };

      const audience: IncidentSubscriberAudienceResult =
        await IncidentSubscriberAudienceBuilder.build({
          projectId: data.projectId,
          props: props,
          incidentId: incidentId,
        });

      return this.describeAudience(audience);
    } catch (err) {
      logger.warn(
        "Could not work out which status page subscribers an incident declared from chat notifies; the confirmation says so.",
        {
          projectId: data.projectId.toString(),
          incidentId: incidentId.toString(),
        },
      );
      logger.warn(err, { projectId: data.projectId.toString() });
      return mdText`${text.couldNotWorkOut}`;
    }
  }

  /*
   * The line for an audience. Pure, and the one place each reason is said.
   *
   *   - Hidden from status pages: nothing is sent, whatever pages it reaches.
   *   - Someone will be told: the status pages, by name - those with
   *     subscribers, then the pages the member may not read, as a count.
   *   - Otherwise why not: no monitors; each status page that would show it
   *     and why it will not tell anyone (no subscribers yet, or the
   *     Dashboard's reason for leaving it out); or no status page shows the
   *     incident's monitors.
   */
  public static describeAudience(
    audience: IncidentSubscriberAudienceResult,
  ): MarkdownText {
    const text: typeof WORKSPACE_NOTIFY_SUBSCRIBERS_TEXT =
      WORKSPACE_NOTIFY_SUBSCRIBERS_TEXT;

    if (audience.isHiddenFromStatusPages) {
      return mdText`${text.notNotified} ${text.hiddenReason}`;
    }

    if (IncidentSubscriberAudience.reachesAnyone(audience)) {
      const reached: Array<IncidentSubscriberAudienceStatusPage> =
        audience.statusPages.filter(
          (statusPage: IncidentSubscriberAudienceStatusPage): boolean => {
            return (
              IncidentSubscriberAudience.getTotal(statusPage.subscriberCounts) >
              0
            );
          },
        );

      const { named, moreCount } = capItems(
        reached.map(
          (statusPage: IncidentSubscriberAudienceStatusPage): MarkdownText => {
            return mdText`**${statusPage.name}**`;
          },
        ),
      );

      const items: Array<MarkdownText> = [...named];

      if (moreCount > 0) {
        items.push(
          mdText`${moreCount === 1 ? text.oneMorePage : withNumber(text.morePages, moreCount)}`,
        );
      }

      const hiddenCount: number = audience.hiddenStatusPageCount;

      if (hiddenCount > 0) {
        const isAfterNames: boolean = items.length > 0;

        items.push(
          mdText`${
            hiddenCount === 1
              ? isAfterNames
                ? text.oneMoreHiddenPage
                : text.oneHiddenPage
              : withNumber(
                  isAfterNames ? text.moreHiddenPages : text.hiddenPages,
                  hiddenCount,
                )
          }`,
        );
      }

      return mdText`${text.willNotify} ${joinWithAnd(items)}.`;
    }

    if (!audience.hasMonitors) {
      return mdText`${text.notNotified} ${text.noMonitorsReason}`;
    }

    // Each status page that would show it, and why it tells no one.
    const pages: Array<MarkdownText> = [
      ...audience.statusPages.map(
        (statusPage: IncidentSubscriberAudienceStatusPage): MarkdownText => {
          return mdText`**${statusPage.name}** (${text.noSubscribersYet})`;
        },
      ),
      ...audience.excludedStatusPages.map(
        (
          statusPage: IncidentSubscriberAudienceExcludedStatusPage,
        ): MarkdownText => {
          return mdText`**${statusPage.name}** (${WORKSPACE_NOTIFY_SUBSCRIBERS_EXCLUSION_TEXT[statusPage.reason]})`;
        },
      ),
      // Only for an incident limited to status pages, which no chat declares.
      ...audience.selectedStatusPagesNotListingMonitors.map(
        (
          statusPage: IncidentSubscriberAudienceNamedStatusPage,
        ): MarkdownText => {
          return mdText`**${statusPage.name}** (${text.notListingMonitors})`;
        },
      ),
    ];

    if (pages.length === 0) {
      return mdText`${text.notNotified} ${text.noStatusPageReason}`;
    }

    const { named, moreCount } = capItems(pages);

    const items: Array<MarkdownText> = [...named];

    if (moreCount > 0) {
      items.push(
        mdText`${moreCount === 1 ? text.oneMorePage : withNumber(text.morePages, moreCount)}`,
      );
    }

    return mdText`${text.notNotified} ${joinWithAnd(items)}.`;
  }
}
