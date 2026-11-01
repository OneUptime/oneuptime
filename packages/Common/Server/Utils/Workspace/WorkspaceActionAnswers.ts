import AlertEpisodeStateTimeline from "../../../Models/DatabaseModels/AlertEpisodeStateTimeline";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import IncidentEpisodeStateTimeline from "../../../Models/DatabaseModels/IncidentEpisodeStateTimeline";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import User from "../../../Models/DatabaseModels/User";
import URL from "../../../Types/API/URL";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import WorkspaceNoteReactionUtil, {
  WorkspaceNoteType,
} from "../../../Types/Workspace/WorkspaceNoteReaction";
import AcknowledgedStateUtil from "../../../Utils/AcknowledgedState";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import ResolvedStateUtil from "../../../Utils/ResolvedState";
import ScheduledMaintenanceStartUtil from "../../../Utils/ScheduledMaintenanceStart";
import { StateListType } from "../../../Utils/StateOrder";
import AlertEpisodeService from "../../Services/AlertEpisodeService";
import AlertEpisodeStateTimelineService from "../../Services/AlertEpisodeStateTimelineService";
import AlertService from "../../Services/AlertService";
import AlertStateService from "../../Services/AlertStateService";
import AlertStateTimelineService from "../../Services/AlertStateTimelineService";
import IncidentEpisodeService from "../../Services/IncidentEpisodeService";
import IncidentEpisodeStateTimelineService from "../../Services/IncidentEpisodeStateTimelineService";
import IncidentService from "../../Services/IncidentService";
import IncidentStateService from "../../Services/IncidentStateService";
import IncidentStateTimelineService from "../../Services/IncidentStateTimelineService";
import ScheduledMaintenanceService from "../../Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "../../Services/ScheduledMaintenanceStateService";
import ScheduledMaintenanceStateTimelineService from "../../Services/ScheduledMaintenanceStateTimelineService";
import UserService from "../../Services/UserService";
import logger from "../Logger";
import ProductBrandingText from "../ProductBrandingText";
import CaptureSpan from "../Telemetry/CaptureSpan";
import {
  WorkspaceConnectButton,
  WorkspaceConnectRequestAgain,
  WorkspaceConnectRequestAgainKind,
  WorkspacePendingActionKind,
} from "./WorkspaceConnectRequest";
import WorkspaceMemberActions, {
  WorkspaceEventRecord,
  WorkspaceEventType,
} from "./WorkspaceMemberActions";
import WorkspaceMessageTime from "./WorkspaceMessageTime";

/*
 * WHAT A BUTTON IN SLACK OR MICROSOFT TEAMS ANSWERS, IN THE SAME WORDS IN BOTH.
 *
 * A press is answered where it was made - in Slack, a message only the person
 * who pressed sees, in the channel or thread they pressed in; in Microsoft
 * Teams, a reply in the conversation - and these are its words:
 *
 *   - somebody whose account is not connected yet is asked to connect it,
 *     with what they pressed and what happens once they have
 *     (getConnectPrompt): "Connect your Slack account to acknowledge this
 *     incident. It takes one click, and OneUptime acknowledges it for you as
 *     soon as you're connected.";
 *   - a press that comes too late says who got there first, and when, as
 *     news rather than as an error (getAlreadyAnswer): "Incident INC-2 was
 *     already acknowledged by Simon Lee at 6:07 PM.";
 *   - once an account is connected from such a prompt, what became of the
 *     press (getConnectedAnswer).
 *
 * Each answer is Markdown both chats show (a moment is written for each
 * reader's own clock: WorkspaceMessageTime), with one line of plain text for
 * a notification. Names and record numbers are text (mdText): a name is
 * whoever chose it. The product's name is the one the installation goes by
 * (ProductBrandingText).
 */

export interface WorkspaceAnswer {
  // Markdown, as both chats show it.
  markdown: string;
  // One line of plain text: what a notification or a preview shows.
  text: string;
}

// What a press that comes too late was trying to do (getAlreadyAnswer).
export enum WorkspaceLatePress {
  Acknowledge = "Acknowledge",
  Resolve = "Resolve",
  MarkAsOngoing = "MarkAsOngoing",
  MarkAsComplete = "MarkAsComplete",
  // Execute On-Call Policy on a record that is resolved already.
  ExecuteOnCallPolicy = "ExecuteOnCallPolicy",
  // Page Someone about an incident that is resolved already.
  Page = "Page",
}

// A record a press is about, as an answer names it.
export interface WorkspaceRecordName {
  // "Incident INC-2", "Alert Episode #3".
  label: string;
  // The record in OneUptime, when the link could be built.
  link: string | null;
}

// A state change of a record: who made it, and when.
interface StateChange {
  stateId?: ObjectID | undefined;
  startsAt?: Date | undefined;
  createdByUserId?: ObjectID | undefined;
}

// Where a press that comes too late finds the record (getAlreadyAnswer).
enum LateStanding {
  Acknowledged = "Acknowledged",
  Resolved = "Resolved",
  Ongoing = "Ongoing",
  Complete = "Complete",
}

const RECORD_TITLES: Record<WorkspaceEventType, string> = {
  [WorkspaceEventType.Incident]: "Incident",
  [WorkspaceEventType.Alert]: "Alert",
  [WorkspaceEventType.IncidentEpisode]: "Incident Episode",
  [WorkspaceEventType.AlertEpisode]: "Alert Episode",
  [WorkspaceEventType.ScheduledMaintenance]: "Scheduled Maintenance",
};

// How long a record's state timeline is read, oldest first.
const TIMELINE_READ_LIMIT: number = 1000;

export default class WorkspaceActionAnswers {
  // "Slack", "Microsoft Teams".
  public static getWorkspaceName(workspaceType: WorkspaceType): string {
    return workspaceType === WorkspaceType.MicrosoftTeams
      ? "Microsoft Teams"
      : "Slack";
  }

  // The Connect button's title: "Connect Slack account".
  public static getConnectButtonTitle(workspaceType: WorkspaceType): string {
    return `Connect ${this.getWorkspaceName(workspaceType)} account`;
  }

  /*
   * What a press that OneUptime can finish asks to be connected for:
   * "acknowledge this incident", "mark this scheduled maintenance event as
   * ongoing". A pinned message names the message by how it was chosen in
   * that chat - "save the message you pinned as a private note on this
   * incident" (WorkspaceNoteReactionUtil.getSavedMessageWords) - as the
   * prompt is not next to it.
   */
  public static getPendingActionPurpose(data: {
    kind: WorkspacePendingActionKind;
    eventType: WorkspaceEventType;
    // The chat the press is in: how a pinned message is named.
    workspaceType?: WorkspaceType | undefined;
    /*
     * The note a message will be saved as, when it is not the one its kind
     * asks for: a 📣 on a private incident saves it as a private note
     * (WorkspaceReactionNote.getNoteTypeSavedAs) - "save the message you
     * reacted to as a private note on this incident".
     */
    noteSavedAs?: WorkspaceNoteType | undefined;
  }): string {
    const noun: string = WorkspaceMemberActions.getNoun(data.eventType);

    switch (data.kind) {
      case WorkspacePendingActionKind.Acknowledge:
        return `acknowledge this ${noun}`;
      case WorkspacePendingActionKind.Resolve:
        return `resolve this ${noun}`;
      case WorkspacePendingActionKind.MarkAsOngoing:
        return `mark this ${noun} as ongoing`;
      case WorkspacePendingActionKind.MarkAsComplete:
        return `mark this ${noun} as complete`;
      case WorkspacePendingActionKind.SavePrivateNote:
        return `save ${WorkspaceNoteReactionUtil.getSavedMessageWords({
          noteType: WorkspaceNoteType.Private,
          workspaceType: data.workspaceType,
        })} as a private note on this ${noun}`;
      case WorkspacePendingActionKind.SavePublicNote:
        return `save ${WorkspaceNoteReactionUtil.getSavedMessageWords({
          noteType: WorkspaceNoteType.Public,
          workspaceType: data.workspaceType,
        })} as a ${
          data.noteSavedAs === WorkspaceNoteType.Private ? "private" : "public"
        } note on this ${noun}`;
    }
  }

  /*
   * Asks somebody whose account is not connected to connect it, to do what
   * they pressed:
   *
   *   🔗 **Connect your Slack account to acknowledge this incident.** It
   *   takes one click, and OneUptime acknowledges it for you as soon as
   *   you're connected.
   *
   * The Connect button goes with it (each chat draws its own). `purpose`
   * completes "to ...". When OneUptime cannot finish the press for them -
   * a form opens only on a fresh press - it says what to press again. So it
   * does when the button opens the settings page without the press, and,
   * with no button at all, it says where the settings are.
   *
   * In a workspace connected to more than one project, it names the project
   * (`projectName`): an account is connected in each project on its own, and
   * somebody connected in another of them would otherwise be asked to
   * connect an account they connected -
   *
   *   🔗 **Connect your Slack account in IRM Non-Prod to acknowledge this
   *   incident.**
   */
  public static getConnectPrompt(data: {
    workspaceType: WorkspaceType;
    purpose: string;
    pendingAction?: { kind: WorkspacePendingActionKind } | undefined;
    again?: WorkspaceConnectRequestAgain | undefined;
    // OneClick when left out.
    button?: WorkspaceConnectButton | undefined;
    // The project, named in a workspace connected to more than one.
    projectName?: string | null | undefined;
  }): WorkspaceAnswer {
    const workspaceName: string = this.getWorkspaceName(data.workspaceType);
    const productName: string = ProductBrandingText.getProductName();
    const button: WorkspaceConnectButton =
      data.button || WorkspaceConnectButton.OneClick;
    const projectName: string = (data.projectName || "").trim();

    const ask: MarkdownText = projectName
      ? mdText`🔗 **Connect your ${workspaceName} account in ${projectName} to ${data.purpose}.**`
      : mdText`🔗 **Connect your ${workspaceName} account to ${data.purpose}.**`;
    const text: string = projectName
      ? `Connect your ${workspaceName} account in ${projectName} to ${data.purpose}`
      : `Connect your ${workspaceName} account to ${data.purpose}`;

    if (button !== WorkspaceConnectButton.OneClick) {
      const then: MarkdownText = mdText`Once you're connected, ${this.getAgainPhrase(
        data.again || { kind: WorkspaceConnectRequestAgainKind.Button },
        data.workspaceType,
      )}.`;

      if (button === WorkspaceConnectButton.None) {
        return {
          markdown:
            mdText`${ask} In ${productName}, go to **User Settings → Workspace → ${workspaceName}** and press **Connect my account with ${workspaceName}**. ${then}`.toString(),
          text: text,
        };
      }

      return {
        markdown: mdText`${ask} ${then}`.toString(),
        text: text,
      };
    }

    let next: MarkdownText;

    if (data.pendingAction) {
      next = mdText`It takes one click, and ${productName} ${this.getFinishPhrase(
        data.pendingAction.kind,
      )} for you as soon as you're connected.`;
    } else if (data.again) {
      next = mdText`It takes one click. Then ${this.getAgainPhrase(
        data.again,
        data.workspaceType,
      )}.`;
    } else {
      next = mdText`It takes one click.`;
    }

    return {
      markdown: mdText`${ask} ${next}`.toString(),
      text: text,
    };
  }

  /*
   * What an account connected from a Connect button is told, where the
   * press was: that it is connected, then what became of the press - done,
   * done already by somebody else, refused, or to be pressed again.
   *
   *   ✅ **Your Slack account is connected to OneUptime.** You acknowledged
   *   **Incident INC-2**.
   */
  public static getConnectedAnswer(data: {
    workspaceType: WorkspaceType;
    // What became of the press, if it was finished or answered.
    outcome?: WorkspaceAnswer | undefined;
    again?: WorkspaceConnectRequestAgain | undefined;
  }): WorkspaceAnswer {
    const workspaceName: string = this.getWorkspaceName(data.workspaceType);
    const productName: string = ProductBrandingText.getProductName();

    const connected: MarkdownText = mdText`✅ **Your ${workspaceName} account is connected to ${productName}.**`;
    const connectedText: string = `Your ${workspaceName} account is connected to ${productName}`;

    if (data.outcome) {
      return {
        markdown: mdText`${connected} ${FeedMarkdown.asMarkdown(
          this.withoutLeadingCheckMark(data.outcome.markdown),
        )}`.toString(),
        text: `${connectedText}. ${data.outcome.text}`,
      };
    }

    if (data.again) {
      return {
        markdown: mdText`${connected} Now ${this.getAgainPhrase(
          data.again,
          data.workspaceType,
        )}.`.toString(),
        text: `${connectedText}. Now ${this.getAgainText(
          data.again,
          data.workspaceType,
        )}.`,
      };
    }

    return {
      markdown: connected.toString(),
      text: connectedText,
    };
  }

  /*
   * What a press that OneUptime finished says: "✅ You acknowledged
   * **Incident INC-2**." The record's own channels hear of the change from
   * its state timeline, as for a change made anywhere else.
   */
  @CaptureSpan()
  public static async getDoneAnswer(data: {
    event: WorkspaceEventRecord;
    kind: WorkspacePendingActionKind;
  }): Promise<WorkspaceAnswer> {
    const record: WorkspaceRecordName = await this.getRecordName(data.event);
    const verb: string = this.getDoneVerb(data.kind);

    return {
      markdown:
        mdText`✅ You ${verb} ${this.getRecordMarkdown(record)}.`.toString(),
      text: `You ${verb} ${record.label}`,
    };
  }

  /*
   * What a press that comes too late says, as news and not as an error:
   * where the record is already, who took it there and when - the change of
   * its state timeline that took it there, the latest one if it was
   * reopened since. The moment reads in each reader's own time.
   *
   *   ✅ **Incident INC-2** was already acknowledged by **Simon Lee** at 6:07 PM.
   *
   * A change nobody made by hand (a monitor, a workflow, the schedule) has
   * no name; a record whose change cannot be found says only where it is.
   * Acknowledging a record that is resolved says it is resolved. Executing
   * an on-call policy for a resolved record says that nobody was paged.
   *
   * Acknowledge pressed by somebody a person's page paged into the record
   * answered their page (OnCallPersonPageAnswer.onAcknowledgePressed,
   * `answeredPageCount`): that is what the press did, so it is said first,
   * and who is on the record after it:
   *
   *   ✅ You acknowledged the page for **Incident INC-2**, so paging
   *   stopped. **Simon Lee** acknowledged the incident at 6:07 PM.
   */
  @CaptureSpan()
  public static async getAlreadyAnswer(data: {
    event: WorkspaceEventRecord;
    press: WorkspaceLatePress;
    // The presser's own person's pages the press answered.
    answeredPageCount?: number | undefined;
  }): Promise<WorkspaceAnswer> {
    const record: WorkspaceRecordName = await this.getRecordName(data.event);

    let standing: LateStanding = LateStanding.Resolved;
    let change: StateChange | null = null;

    try {
      const found: { standing: LateStanding; change: StateChange | null } =
        await this.findLateStanding(data);

      standing = found.standing;
      change = found.change;
    } catch (err) {
      logger.error(
        "Could not read who changed the record's state; answering without it.",
        { projectId: data.event.projectId.toString() },
      );
      logger.error(err, { projectId: data.event.projectId.toString() });
      standing = this.getDefaultStanding(data.press);
    }

    const name: string | null = change?.createdByUserId
      ? await this.getUserName(change.createdByUserId)
      : null;

    const verb: string = this.getStandingVerb(standing);
    const recordMarkdown: MarkdownText = this.getRecordMarkdown(record);

    // The press answered the presser's own page (see above).
    if (
      data.press === WorkspaceLatePress.Acknowledge &&
      standing === LateStanding.Acknowledged &&
      (data.answeredPageCount || 0) > 0
    ) {
      return this.getPageAcknowledgedAnswer({
        event: data.event,
        record: record,
        acknowledgedBy: name,
        acknowledgedAt: change?.startsAt,
      });
    }

    let markdown: MarkdownText;
    let text: string;

    if (change?.startsAt && name) {
      markdown = mdText`${recordMarkdown} was already ${verb} by **${name}** at ${WorkspaceMessageTime.time(
        change.startsAt,
      )}`;
      text = `${record.label} was already ${verb} by ${name}`;
    } else if (change?.startsAt) {
      markdown = mdText`${recordMarkdown} was already ${verb} at ${WorkspaceMessageTime.time(
        change.startsAt,
      )}`;
      text = `${record.label} was already ${verb}`;
    } else {
      markdown = mdText`${recordMarkdown} is already ${verb}`;
      text = `${record.label} is already ${verb}`;
    }

    if (data.press === WorkspaceLatePress.ExecuteOnCallPolicy) {
      return {
        markdown:
          mdText`${markdown}, so no on-call policy was started.`.toString(),
        text: `${text}, so no on-call policy was started`,
      };
    }

    if (data.press === WorkspaceLatePress.Page) {
      return {
        markdown: mdText`${markdown}, so nobody was paged.`.toString(),
        text: `${text}, so nobody was paged`,
      };
    }

    return {
      markdown: mdText`✅ ${markdown}.`.toString(),
      text: text,
    };
  }

  /*
   * A late Acknowledge that answered the presser's page about the record
   * (getAlreadyAnswer): what the press did, then who is on the record -
   * "**Simon Lee** acknowledged the incident at 6:07 PM." - or only when,
   * or nothing more when that cannot be told.
   */
  private static getPageAcknowledgedAnswer(data: {
    event: WorkspaceEventRecord;
    record: WorkspaceRecordName;
    acknowledgedBy: string | null;
    acknowledgedAt: Date | undefined;
  }): WorkspaceAnswer {
    const noun: string =
      data.event.type === WorkspaceEventType.Alert ? "alert" : "incident";
    const answered: MarkdownText = mdText`✅ You acknowledged the page for ${this.getRecordMarkdown(data.record)}, so paging stopped.`;
    const text: string = `You acknowledged the page for ${data.record.label}, so paging stopped`;

    if (data.acknowledgedAt && data.acknowledgedBy) {
      return {
        markdown:
          mdText`${answered} **${data.acknowledgedBy}** acknowledged the ${noun} at ${WorkspaceMessageTime.time(data.acknowledgedAt)}.`.toString(),
        text: text,
      };
    }

    if (data.acknowledgedAt) {
      return {
        markdown:
          mdText`${answered} The ${noun} was acknowledged at ${WorkspaceMessageTime.time(data.acknowledgedAt)}.`.toString(),
        text: text,
      };
    }

    return { markdown: answered.toString(), text: text };
  }

  // The record as answers name it: "Incident INC-2", with its link.
  @CaptureSpan()
  public static async getRecordName(
    event: WorkspaceEventRecord,
  ): Promise<WorkspaceRecordName> {
    const number: string =
      event.numberWithPrefix ||
      (event.number !== null && event.number !== undefined
        ? `#${event.number}`
        : "");

    const label: string = number
      ? `${RECORD_TITLES[event.type]} ${number}`
      : RECORD_TITLES[event.type];

    let link: string | null = null;

    try {
      link = (await this.getRecordLink(event)).toString();
    } catch (err) {
      logger.debug("Could not build the record's link for a chat answer.");
      logger.debug(err);
    }

    return { label: label, link: link };
  }

  // "**[Incident INC-2](link)**", or "**Incident INC-2**" with no link.
  public static getRecordMarkdown(record: WorkspaceRecordName): MarkdownText {
    return record.link
      ? mdText`**[${record.label}](${record.link})**`
      : mdText`**${record.label}**`;
  }

  /*
   * "press Add Note again", "choose Change Severity from the menu again",
   * "run /oneuptime incident again", "ask your question again", with the
   * button, the menu item or the command in bold. A command is run in Slack
   * (a slash command) and typed to the bot in Microsoft Teams: "type
   * incident again". A menu item is chosen, not pressed: it is not a button
   * to find on the message.
   */
  public static getAgainPhrase(
    again: WorkspaceConnectRequestAgain,
    workspaceType?: WorkspaceType | undefined,
  ): MarkdownText {
    switch (again.kind) {
      case WorkspaceConnectRequestAgainKind.Command: {
        const verb: string = this.getCommandVerb(workspaceType);

        return again.label
          ? mdText`${verb} **${again.label}** again`
          : mdText`${verb} the command again`;
      }
      case WorkspaceConnectRequestAgainKind.Question:
        return mdText`ask your question again`;
      case WorkspaceConnectRequestAgainKind.MenuItem:
        return again.label
          ? mdText`choose **${again.label}** from the menu again`
          : mdText`choose it from the menu again`;
      case WorkspaceConnectRequestAgainKind.Button:
        return again.label
          ? mdText`press **${again.label}** again`
          : mdText`press the button again`;
    }
  }

  // The same as plain text: "press Add Note again".
  public static getAgainText(
    again: WorkspaceConnectRequestAgain,
    workspaceType?: WorkspaceType | undefined,
  ): string {
    switch (again.kind) {
      case WorkspaceConnectRequestAgainKind.Command: {
        const verb: string = this.getCommandVerb(workspaceType);

        return again.label
          ? `${verb} ${again.label} again`
          : `${verb} the command again`;
      }
      case WorkspaceConnectRequestAgainKind.Question:
        return "ask your question again";
      case WorkspaceConnectRequestAgainKind.MenuItem:
        return again.label
          ? `choose ${again.label} from the menu again`
          : "choose it from the menu again";
      case WorkspaceConnectRequestAgainKind.Button:
        return again.label
          ? `press ${again.label} again`
          : "press the button again";
    }
  }

  // How a command is given: run in Slack, typed to the bot in Microsoft Teams.
  private static getCommandVerb(
    workspaceType: WorkspaceType | undefined,
  ): string {
    return workspaceType === WorkspaceType.MicrosoftTeams ? "type" : "run";
  }

  // "acknowledges it", as the prompt promises it.
  private static getFinishPhrase(kind: WorkspacePendingActionKind): string {
    switch (kind) {
      case WorkspacePendingActionKind.Acknowledge:
        return "acknowledges it";
      case WorkspacePendingActionKind.Resolve:
        return "resolves it";
      case WorkspacePendingActionKind.MarkAsOngoing:
        return "marks it as ongoing";
      case WorkspacePendingActionKind.MarkAsComplete:
        return "marks it as complete";
      case WorkspacePendingActionKind.SavePrivateNote:
      case WorkspacePendingActionKind.SavePublicNote:
        return "saves it";
    }
  }

  // "acknowledged", as "You acknowledged ..." says it.
  public static getDoneVerb(kind: WorkspacePendingActionKind): string {
    switch (kind) {
      case WorkspacePendingActionKind.Acknowledge:
        return "acknowledged";
      case WorkspacePendingActionKind.Resolve:
        return "resolved";
      case WorkspacePendingActionKind.MarkAsOngoing:
        return "marked as ongoing";
      case WorkspacePendingActionKind.MarkAsComplete:
        return "completed";
      case WorkspacePendingActionKind.SavePrivateNote:
        return "saved the message as a private note on";
      case WorkspacePendingActionKind.SavePublicNote:
        return "saved the message as a public note on";
    }
  }

  private static getStandingVerb(standing: LateStanding): string {
    switch (standing) {
      case LateStanding.Acknowledged:
        return "acknowledged";
      case LateStanding.Resolved:
        return "resolved";
      case LateStanding.Ongoing:
        return "marked as ongoing";
      case LateStanding.Complete:
        return "completed";
    }
  }

  // Where a late press finds the record, when its timeline cannot be read.
  private static getDefaultStanding(press: WorkspaceLatePress): LateStanding {
    switch (press) {
      case WorkspaceLatePress.Acknowledge:
        return LateStanding.Acknowledged;
      case WorkspaceLatePress.MarkAsOngoing:
        return LateStanding.Ongoing;
      case WorkspaceLatePress.MarkAsComplete:
        return LateStanding.Complete;
      case WorkspaceLatePress.Resolve:
      case WorkspaceLatePress.ExecuteOnCallPolicy:
      case WorkspaceLatePress.Page:
        return LateStanding.Resolved;
    }
  }

  /*
   * Where the record is, and the change of its timeline that took it there:
   * resolved, for a record that is (whatever was pressed); else
   * acknowledged. For a scheduled maintenance event: complete, else ongoing.
   */
  private static async findLateStanding(data: {
    event: WorkspaceEventRecord;
    press: WorkspaceLatePress;
  }): Promise<{ standing: LateStanding; change: StateChange | null }> {
    const { event } = data;

    if (event.type === WorkspaceEventType.ScheduledMaintenance) {
      const states: Array<ScheduledMaintenanceState> =
        await ScheduledMaintenanceStateService.getAllScheduledMaintenanceStates(
          {
            projectId: event.projectId,
            props: {
              isRoot: true,
            },
          },
        );

      const timeline: Array<StateChange> = await this.readTimeline(event);

      const isComplete: boolean = ScheduledMaintenanceStartUtil.isComplete({
        states: states,
        state: { _id: event.currentStateId },
      });

      if (isComplete) {
        return {
          standing: LateStanding.Complete,
          change: this.last(
            ScheduledMaintenanceStartUtil.getCompleteRows({
              states: states,
              timeline: timeline,
            }),
          ),
        };
      }

      return {
        standing: LateStanding.Ongoing,
        change: this.last(
          ScheduledMaintenanceStartUtil.getStartRows({
            states: states,
            timeline: timeline,
          }),
        ),
      };
    }

    const list: StateListType.IncidentState | StateListType.AlertState =
      event.type === WorkspaceEventType.Alert ||
      event.type === WorkspaceEventType.AlertEpisode
        ? StateListType.AlertState
        : StateListType.IncidentState;

    const states: Array<IncidentState | AlertState> =
      list === StateListType.AlertState
        ? await AlertStateService.getAllAlertStates({
            projectId: event.projectId,
            props: {
              isRoot: true,
            },
          })
        : await IncidentStateService.getAllIncidentStates({
            projectId: event.projectId,
            props: {
              isRoot: true,
            },
          });

    const timeline: Array<StateChange> = await this.readTimeline(event);

    if (
      ResolvedStateUtil.isResolved({
        list: list,
        states: states,
        stateId: event.currentStateId,
      })
    ) {
      return {
        standing: LateStanding.Resolved,
        change: this.last(
          ResolvedStateUtil.getResolutionRows({
            list: list,
            states: states,
            timeline: timeline,
          }),
        ),
      };
    }

    return {
      standing: LateStanding.Acknowledged,
      change: this.last(
        AcknowledgedStateUtil.getAcknowledgementRows({
          list: list,
          states: states,
          timeline: timeline,
        }),
      ),
    };
  }

  /*
   * The record's state timeline as OneUptime reads it - the state, when,
   * and who: the person pressing may read the record (the press was
   * authorized), and its timeline says the same to them in OneUptime.
   */
  private static async readTimeline(
    event: WorkspaceEventRecord,
  ): Promise<Array<StateChange>> {
    switch (event.type) {
      case WorkspaceEventType.Incident: {
        const rows: Array<IncidentStateTimeline> =
          await IncidentStateTimelineService.findBy({
            query: { incidentId: event.id, projectId: event.projectId },
            select: {
              incidentStateId: true,
              startsAt: true,
              createdByUserId: true,
            },
            sort: { startsAt: SortOrder.Ascending },
            skip: 0,
            limit: TIMELINE_READ_LIMIT,
            props: { isRoot: true },
          });

        return rows.map((row: IncidentStateTimeline): StateChange => {
          return this.toChange(
            row.incidentStateId,
            row.startsAt,
            row.createdByUserId,
          );
        });
      }
      case WorkspaceEventType.Alert: {
        const rows: Array<AlertStateTimeline> =
          await AlertStateTimelineService.findBy({
            query: { alertId: event.id, projectId: event.projectId },
            select: {
              alertStateId: true,
              startsAt: true,
              createdByUserId: true,
            },
            sort: { startsAt: SortOrder.Ascending },
            skip: 0,
            limit: TIMELINE_READ_LIMIT,
            props: { isRoot: true },
          });

        return rows.map((row: AlertStateTimeline): StateChange => {
          return this.toChange(
            row.alertStateId,
            row.startsAt,
            row.createdByUserId,
          );
        });
      }
      case WorkspaceEventType.IncidentEpisode: {
        const rows: Array<IncidentEpisodeStateTimeline> =
          await IncidentEpisodeStateTimelineService.findBy({
            query: { incidentEpisodeId: event.id, projectId: event.projectId },
            select: {
              incidentStateId: true,
              startsAt: true,
              createdByUserId: true,
            },
            sort: { startsAt: SortOrder.Ascending },
            skip: 0,
            limit: TIMELINE_READ_LIMIT,
            props: { isRoot: true },
          });

        return rows.map((row: IncidentEpisodeStateTimeline): StateChange => {
          return this.toChange(
            row.incidentStateId,
            row.startsAt,
            row.createdByUserId,
          );
        });
      }
      case WorkspaceEventType.AlertEpisode: {
        const rows: Array<AlertEpisodeStateTimeline> =
          await AlertEpisodeStateTimelineService.findBy({
            query: { alertEpisodeId: event.id, projectId: event.projectId },
            select: {
              alertStateId: true,
              startsAt: true,
              createdByUserId: true,
            },
            sort: { startsAt: SortOrder.Ascending },
            skip: 0,
            limit: TIMELINE_READ_LIMIT,
            props: { isRoot: true },
          });

        return rows.map((row: AlertEpisodeStateTimeline): StateChange => {
          return this.toChange(
            row.alertStateId,
            row.startsAt,
            row.createdByUserId,
          );
        });
      }
      case WorkspaceEventType.ScheduledMaintenance: {
        const rows: Array<ScheduledMaintenanceStateTimeline> =
          await ScheduledMaintenanceStateTimelineService.findBy({
            query: {
              scheduledMaintenanceId: event.id,
              projectId: event.projectId,
            },
            select: {
              scheduledMaintenanceStateId: true,
              startsAt: true,
              createdByUserId: true,
            },
            sort: { startsAt: SortOrder.Ascending },
            skip: 0,
            limit: TIMELINE_READ_LIMIT,
            props: { isRoot: true },
          });

        return rows.map(
          (row: ScheduledMaintenanceStateTimeline): StateChange => {
            return this.toChange(
              row.scheduledMaintenanceStateId,
              row.startsAt,
              row.createdByUserId,
            );
          },
        );
      }
    }
  }

  private static toChange(
    stateId: ObjectID | undefined,
    startsAt: Date | undefined,
    createdByUserId: ObjectID | undefined,
  ): StateChange {
    const change: StateChange = {};

    if (stateId) {
      change.stateId = stateId;
    }

    if (startsAt) {
      change.startsAt = new Date(startsAt);
    }

    if (createdByUserId) {
      change.createdByUserId = createdByUserId;
    }

    return change;
  }

  private static last(changes: Array<StateChange>): StateChange | null {
    return changes.length > 0 ? changes[changes.length - 1]! : null;
  }

  // The person's name, else their email; null when neither can be read.
  private static async getUserName(userId: ObjectID): Promise<string | null> {
    try {
      const user: User | null = await UserService.findOneBy({
        query: { _id: userId },
        select: { name: true, email: true },
        props: { isRoot: true },
      });

      const name: string =
        user?.name?.toString().trim() || user?.email?.toString().trim() || "";

      return name || null;
    } catch (err) {
      logger.debug("Could not read the name of who changed the record.");
      logger.debug(err);
      return null;
    }
  }

  private static async getRecordLink(
    event: WorkspaceEventRecord,
  ): Promise<URL> {
    switch (event.type) {
      case WorkspaceEventType.Incident:
        return await IncidentService.getIncidentLinkInDashboard(
          event.projectId,
          event.id,
        );
      case WorkspaceEventType.Alert:
        return await AlertService.getAlertLinkInDashboard(
          event.projectId,
          event.id,
        );
      case WorkspaceEventType.IncidentEpisode:
        return await IncidentEpisodeService.getEpisodeLinkInDashboard(
          event.projectId,
          event.id,
        );
      case WorkspaceEventType.AlertEpisode:
        return await AlertEpisodeService.getEpisodeLinkInDashboard(
          event.projectId,
          event.id,
        );
      case WorkspaceEventType.ScheduledMaintenance:
        return await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(
          event.projectId,
          event.id,
        );
    }
  }

  // An outcome as it follows "Your account is connected.": without its own ✅.
  private static withoutLeadingCheckMark(markdown: string): string {
    return markdown.startsWith("✅ ") ? markdown.substring(2) : markdown;
  }
}
