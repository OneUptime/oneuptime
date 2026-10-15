import ObjectID from "../../../../../Types/ObjectID";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import ProductBrandingText from "../../../ProductBrandingText";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import WorkspaceActionAnswers, {
  WorkspaceAnswer,
} from "../../WorkspaceActionAnswers";
import WorkspaceConnectRequest, {
  WorkspaceConnectLink,
  WorkspaceConnectRequestAgainKind,
  WorkspacePendingActionKind,
  WorkspacePressDescription,
} from "../../WorkspaceConnectRequest";
import WorkspaceMemberActions, {
  WorkspaceEventType,
} from "../../WorkspaceMemberActions";
import WorkspaceCommands, {
  WorkspaceCommandName,
} from "../../WorkspaceCommands";
import WorkspaceConnectPromptOnce, {
  WorkspaceConnectPromptClaim,
  WorkspaceConversationPerson,
} from "../../WorkspaceConnectPromptOnce";
import SlackActionType from "./ActionTypes";
import SlackActionAnswer, {
  SlackAnswerDelivery,
  SlackAnswerPlace,
} from "./Answer";

/*
 * "CONNECT YOUR SLACK ACCOUNT TO ACKNOWLEDGE THIS INCIDENT."
 *
 * What somebody whose Slack account is not connected to OneUptime is told
 * when they press a button, submit a form or run a command - where they did
 * it (SlackActionAnswer), with a Connect button. The button opens their own
 * Slack settings page in OneUptime, which connects their account in one
 * step; then OneUptime finishes what they pressed - acknowledges, resolves,
 * marks a maintenance event as ongoing or complete - as the member their
 * account is now connected to, or, for a form, a command or a question,
 * tells them to press it again (WorkspaceConnectRequest,
 * WorkspaceConnectCompletion).
 */

// What a press asks to be connected for (describe).
export type SlackPressDescription = WorkspacePressDescription;

interface PendingPress {
  kind: WorkspacePendingActionKind;
  eventType: WorkspaceEventType;
}

// Presses OneUptime can finish once the account is connected.
const PENDING_PRESSES: Partial<Record<SlackActionType, PendingPress>> = {
  [SlackActionType.AcknowledgeIncident]: {
    kind: WorkspacePendingActionKind.Acknowledge,
    eventType: WorkspaceEventType.Incident,
  },
  [SlackActionType.ResolveIncident]: {
    kind: WorkspacePendingActionKind.Resolve,
    eventType: WorkspaceEventType.Incident,
  },
  [SlackActionType.AcknowledgeAlert]: {
    kind: WorkspacePendingActionKind.Acknowledge,
    eventType: WorkspaceEventType.Alert,
  },
  [SlackActionType.ResolveAlert]: {
    kind: WorkspacePendingActionKind.Resolve,
    eventType: WorkspaceEventType.Alert,
  },
  [SlackActionType.AcknowledgeIncidentEpisode]: {
    kind: WorkspacePendingActionKind.Acknowledge,
    eventType: WorkspaceEventType.IncidentEpisode,
  },
  [SlackActionType.ResolveIncidentEpisode]: {
    kind: WorkspacePendingActionKind.Resolve,
    eventType: WorkspaceEventType.IncidentEpisode,
  },
  [SlackActionType.AcknowledgeAlertEpisode]: {
    kind: WorkspacePendingActionKind.Acknowledge,
    eventType: WorkspaceEventType.AlertEpisode,
  },
  [SlackActionType.ResolveAlertEpisode]: {
    kind: WorkspacePendingActionKind.Resolve,
    eventType: WorkspaceEventType.AlertEpisode,
  },
  [SlackActionType.MarkScheduledMaintenanceAsOngoing]: {
    kind: WorkspacePendingActionKind.MarkAsOngoing,
    eventType: WorkspaceEventType.ScheduledMaintenance,
  },
  [SlackActionType.MarkScheduledMaintenanceAsComplete]: {
    kind: WorkspacePendingActionKind.MarkAsComplete,
    eventType: WorkspaceEventType.ScheduledMaintenance,
  },
};

// What a form does, the record it is on, and the button that opens it.
interface FormPress {
  does: "addNote" | "changeState" | "executeOnCallPolicy";
  eventType: WorkspaceEventType;
  // The button's title as the message draws it, without its emoji.
  button: string;
}

const FORM_PRESSES: Partial<Record<SlackActionType, FormPress>> = {
  [SlackActionType.ViewAddIncidentNote]: {
    does: "addNote",
    eventType: WorkspaceEventType.Incident,
    button: "Add Note",
  },
  [SlackActionType.SubmitIncidentNote]: {
    does: "addNote",
    eventType: WorkspaceEventType.Incident,
    button: "Add Note",
  },
  [SlackActionType.ViewChangeIncidentState]: {
    does: "changeState",
    eventType: WorkspaceEventType.Incident,
    button: "Change Incident State",
  },
  [SlackActionType.SubmitChangeIncidentState]: {
    does: "changeState",
    eventType: WorkspaceEventType.Incident,
    button: "Change Incident State",
  },
  [SlackActionType.ViewExecuteIncidentOnCallPolicy]: {
    does: "executeOnCallPolicy",
    eventType: WorkspaceEventType.Incident,
    button: "Execute On-Call Policy",
  },
  [SlackActionType.SubmitExecuteIncidentOnCallPolicy]: {
    does: "executeOnCallPolicy",
    eventType: WorkspaceEventType.Incident,
    button: "Execute On-Call Policy",
  },
  [SlackActionType.ViewAddAlertNote]: {
    does: "addNote",
    eventType: WorkspaceEventType.Alert,
    button: "Add Note",
  },
  [SlackActionType.SubmitAlertNote]: {
    does: "addNote",
    eventType: WorkspaceEventType.Alert,
    button: "Add Note",
  },
  [SlackActionType.ViewChangeAlertState]: {
    does: "changeState",
    eventType: WorkspaceEventType.Alert,
    button: "Change Alert State",
  },
  [SlackActionType.SubmitChangeAlertState]: {
    does: "changeState",
    eventType: WorkspaceEventType.Alert,
    button: "Change Alert State",
  },
  [SlackActionType.ViewExecuteAlertOnCallPolicy]: {
    does: "executeOnCallPolicy",
    eventType: WorkspaceEventType.Alert,
    button: "Execute On-Call Policy",
  },
  [SlackActionType.SubmitExecuteAlertOnCallPolicy]: {
    does: "executeOnCallPolicy",
    eventType: WorkspaceEventType.Alert,
    button: "Execute On-Call Policy",
  },
  [SlackActionType.ViewAddIncidentEpisodeNote]: {
    does: "addNote",
    eventType: WorkspaceEventType.IncidentEpisode,
    button: "Add Note",
  },
  [SlackActionType.SubmitIncidentEpisodeNote]: {
    does: "addNote",
    eventType: WorkspaceEventType.IncidentEpisode,
    button: "Add Note",
  },
  [SlackActionType.ViewChangeIncidentEpisodeState]: {
    does: "changeState",
    eventType: WorkspaceEventType.IncidentEpisode,
    button: "Change Episode State",
  },
  [SlackActionType.SubmitChangeIncidentEpisodeState]: {
    does: "changeState",
    eventType: WorkspaceEventType.IncidentEpisode,
    button: "Change Episode State",
  },
  [SlackActionType.ViewExecuteIncidentEpisodeOnCallPolicy]: {
    does: "executeOnCallPolicy",
    eventType: WorkspaceEventType.IncidentEpisode,
    button: "Execute On-Call Policy",
  },
  [SlackActionType.SubmitExecuteIncidentEpisodeOnCallPolicy]: {
    does: "executeOnCallPolicy",
    eventType: WorkspaceEventType.IncidentEpisode,
    button: "Execute On-Call Policy",
  },
  [SlackActionType.ViewAddAlertEpisodeNote]: {
    does: "addNote",
    eventType: WorkspaceEventType.AlertEpisode,
    button: "Add Note",
  },
  [SlackActionType.SubmitAlertEpisodeNote]: {
    does: "addNote",
    eventType: WorkspaceEventType.AlertEpisode,
    button: "Add Note",
  },
  [SlackActionType.ViewChangeAlertEpisodeState]: {
    does: "changeState",
    eventType: WorkspaceEventType.AlertEpisode,
    button: "Change Episode State",
  },
  [SlackActionType.SubmitChangeAlertEpisodeState]: {
    does: "changeState",
    eventType: WorkspaceEventType.AlertEpisode,
    button: "Change Episode State",
  },
  [SlackActionType.ViewExecuteAlertEpisodeOnCallPolicy]: {
    does: "executeOnCallPolicy",
    eventType: WorkspaceEventType.AlertEpisode,
    button: "Execute On-Call Policy",
  },
  [SlackActionType.SubmitExecuteAlertEpisodeOnCallPolicy]: {
    does: "executeOnCallPolicy",
    eventType: WorkspaceEventType.AlertEpisode,
    button: "Execute On-Call Policy",
  },
  [SlackActionType.ViewAddScheduledMaintenanceNote]: {
    does: "addNote",
    eventType: WorkspaceEventType.ScheduledMaintenance,
    button: "Add Note",
  },
  [SlackActionType.SubmitScheduledMaintenanceNote]: {
    does: "addNote",
    eventType: WorkspaceEventType.ScheduledMaintenance,
    button: "Add Note",
  },
  [SlackActionType.ViewChangeScheduledMaintenanceState]: {
    does: "changeState",
    eventType: WorkspaceEventType.ScheduledMaintenance,
    button: "Change State",
  },
  [SlackActionType.SubmitChangeScheduledMaintenanceState]: {
    does: "changeState",
    eventType: WorkspaceEventType.ScheduledMaintenance,
    button: "Change State",
  },
};

/*
 * A command, and the shortcut that opens the same form (if one does): run
 * again as it was typed - `/oneuptime incident`, or an older app's
 * /incident - or as `/oneuptime <word>` when that is not known (a form's
 * submission).
 */
interface CommandPress {
  purpose: string;
  command: WorkspaceCommandName;
  shortcut?: string | undefined;
}

const CREATE_INCIDENT: CommandPress = {
  purpose: "declare an incident",
  command: WorkspaceCommandName.Incident,
  shortcut: "Create New Incident",
};

const CREATE_SCHEDULED_MAINTENANCE: CommandPress = {
  purpose: "create a scheduled maintenance event",
  command: WorkspaceCommandName.Maintenance,
  shortcut: "Create Scheduled Event",
};

const PAGE_SOMEONE: CommandPress = {
  purpose: "page someone",
  command: WorkspaceCommandName.Page,
};

const COMMAND_PRESSES: Partial<Record<SlackActionType, CommandPress>> = {
  [SlackActionType.NewIncident]: CREATE_INCIDENT,
  [SlackActionType.SubmitNewIncident]: CREATE_INCIDENT,
  [SlackActionType.NewScheduledMaintenance]: CREATE_SCHEDULED_MAINTENANCE,
  [SlackActionType.SubmitNewScheduledMaintenance]: CREATE_SCHEDULED_MAINTENANCE,
  [SlackActionType.ShowOnCall]: {
    purpose: "see who is on call",
    command: WorkspaceCommandName.OnCall,
  },
  /*
   * A page is never sent for somebody once they connect: they run the
   * command again, so nobody is woken by a page its sender has forgotten.
   */
  [SlackActionType.PageSomeone]: PAGE_SOMEONE,
  [SlackActionType.SubmitPageSomeone]: PAGE_SOMEONE,
};

export default class SlackConnectPrompt {
  /*
   * What a press asks to be connected for, and what happens once it is:
   * the press finished for them, or a form, a command or a shortcut to use
   * again. Nothing about the record is read: the person may not read it yet.
   */
  public static describe(data: {
    actionType: string | undefined;
    actionValue?: string | undefined;
    payloadType?: string | undefined;
    // How a slash command was typed: "/oneuptime incident" (SlackAction).
    command?: string | undefined;
  }): SlackPressDescription {
    const actionType: SlackActionType = data.actionType as SlackActionType;

    const pending: PendingPress | undefined = PENDING_PRESSES[actionType];

    if (pending) {
      const purpose: string = WorkspaceActionAnswers.getPendingActionPurpose({
        kind: pending.kind,
        eventType: pending.eventType,
      });

      // An id OneUptime wrote on its own button; anything else is not finished.
      if (data.actionValue && ObjectID.isValidUUID(data.actionValue)) {
        return {
          purpose: purpose,
          pendingAction: {
            kind: pending.kind,
            eventType: pending.eventType,
            eventId: new ObjectID(data.actionValue),
          },
        };
      }

      return { purpose: purpose };
    }

    const form: FormPress | undefined = FORM_PRESSES[actionType];

    if (form) {
      return {
        purpose: SlackConnectPrompt.getFormPurpose(form),
        again: {
          kind: WorkspaceConnectRequestAgainKind.Button,
          label: form.button,
        },
      };
    }

    const commandPress: CommandPress | undefined = COMMAND_PRESSES[actionType];

    if (commandPress) {
      return {
        purpose: commandPress.purpose,
        again:
          data.payloadType === "shortcut" && commandPress.shortcut
            ? {
                kind: WorkspaceConnectRequestAgainKind.Button,
                label: commandPress.shortcut,
              }
            : {
                kind: WorkspaceConnectRequestAgainKind.Command,
                label:
                  data.command ||
                  WorkspaceCommands.getUsage({
                    workspaceType: WorkspaceType.Slack,
                    command: commandPress.command,
                  }),
              },
      };
    }

    return {
      purpose: `use ${ProductBrandingText.getProductName()} from Slack`,
    };
  }

  /*
   * A question to OneUptime AI - an @mention, a direct message to the app,
   * `/oneuptime ask` - from a Slack account not connected yet: asked again
   * once it is, since its answer is read with the asker's permissions.
   */
  public static describeQuestion(): SlackPressDescription {
    return {
      purpose: `ask ${ProductBrandingText.getProductName()} AI`,
      again: { kind: WorkspaceConnectRequestAgainKind.Question },
    };
  }

  /*
   * Answers a press from a Slack account that is not connected to
   * OneUptime, where it was made, with a Connect button for that account in
   * the project. The press is recorded to be finished once it is connected.
   * When it cannot be recorded (the cache is down), the answer still says to
   * connect, with a link to the settings page without the press
   * (WorkspaceConnectRequest.getConnectLink).
   */
  @CaptureSpan()
  public static async prompt(data: {
    projectId: ObjectID;
    place: SlackAnswerPlace;
    slackTeamId?: string | undefined;
    description: SlackPressDescription;
  }): Promise<SlackAnswerDelivery> {
    const link: WorkspaceConnectLink =
      await WorkspaceConnectRequest.getConnectLink({
        workspaceType: WorkspaceType.Slack,
        projectId: data.projectId,
        workspaceUserId: data.place.slackUserId,
        purpose: data.description.purpose,
        pendingAction: data.description.pendingAction,
        again: data.description.again,
        slack: {
          teamId: data.slackTeamId,
          channelId: data.place.slackChannelId,
          threadTs: data.place.slackThreadTs,
          responseUrl: data.place.responseUrl,
          directMessageChannelId: data.place.slackDirectMessageChannelId,
        },
      });

    const answer: WorkspaceAnswer = WorkspaceActionAnswers.getConnectPrompt({
      workspaceType: WorkspaceType.Slack,
      purpose: data.description.purpose,
      pendingAction: data.description.pendingAction,
      again: data.description.again,
      button: link.button,
    });

    return await SlackActionAnswer.answer({
      place: data.place,
      answer: answer,
      connectUrl: link.url,
    });
  }

  /*
   * A question to OneUptime AI in a message - an @mention, a direct
   * message, a reply in a conversation with OneUptime AI - from a Slack
   * account not connected yet: prompted as `prompt` does, once in the
   * conversation (a thread, a direct message), and not again there while
   * the Connect button it carries works (WorkspaceConnectPromptOnce). How
   * the prompt was delivered - None when it could not be, and the next
   * message there is prompted - or null when they were asked there already.
   * Never throws.
   */
  @CaptureSpan()
  public static async promptOnce(data: {
    projectId: ObjectID;
    place: SlackAnswerPlace;
    slackTeamId?: string | undefined;
    description: SlackPressDescription;
    // The conversation, and who is asking in it.
    conversation: WorkspaceConversationPerson;
  }): Promise<SlackAnswerDelivery | null> {
    const claim: WorkspaceConnectPromptClaim | null =
      await WorkspaceConnectPromptOnce.claim(data.conversation);

    if (!claim) {
      return null;
    }

    const delivery: SlackAnswerDelivery = await SlackConnectPrompt.prompt({
      projectId: data.projectId,
      place: data.place,
      slackTeamId: data.slackTeamId,
      description: data.description,
    });

    if (delivery === SlackAnswerDelivery.None) {
      await claim.release();
    }

    return delivery;
  }

  // "add a note to this incident", "change the state of this alert".
  private static getFormPurpose(form: FormPress): string {
    const noun: string = WorkspaceMemberActions.getNoun(form.eventType);

    switch (form.does) {
      case "addNote":
        return `add a note to this ${noun}`;
      case "changeState":
        return `change the state of this ${noun}`;
      case "executeOnCallPolicy":
        return `execute an on-call policy for this ${noun}`;
    }
  }
}
