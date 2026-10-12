import URL from "../../../../../Types/API/URL";
import ObjectID from "../../../../../Types/ObjectID";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import logger from "../../../Logger";
import ProductBrandingText from "../../../ProductBrandingText";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import WorkspaceActionAnswers, {
  WorkspaceAnswer,
} from "../../WorkspaceActionAnswers";
import WorkspaceConnectRequest, {
  WorkspaceConnectRequestAgain,
  WorkspaceConnectRequestAgainKind,
  WorkspacePendingAction,
  WorkspacePendingActionKind,
} from "../../WorkspaceConnectRequest";
import WorkspaceMemberActions, {
  WorkspaceEventType,
} from "../../WorkspaceMemberActions";
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
export interface SlackPressDescription {
  // Completes "Connect your Slack account to ...".
  purpose: string;
  pendingAction?: WorkspacePendingAction | undefined;
  again?: WorkspaceConnectRequestAgain | undefined;
}

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
    button: "Execute On Call",
  },
  [SlackActionType.SubmitExecuteIncidentOnCallPolicy]: {
    does: "executeOnCallPolicy",
    eventType: WorkspaceEventType.Incident,
    button: "Execute On Call",
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
    button: "Execute On Call",
  },
  [SlackActionType.SubmitExecuteAlertOnCallPolicy]: {
    does: "executeOnCallPolicy",
    eventType: WorkspaceEventType.Alert,
    button: "Execute On Call",
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
    button: "Execute On Call",
  },
  [SlackActionType.SubmitExecuteIncidentEpisodeOnCallPolicy]: {
    does: "executeOnCallPolicy",
    eventType: WorkspaceEventType.IncidentEpisode,
    button: "Execute On Call",
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
    button: "Execute On Call",
  },
  [SlackActionType.SubmitExecuteAlertEpisodeOnCallPolicy]: {
    does: "executeOnCallPolicy",
    eventType: WorkspaceEventType.AlertEpisode,
    button: "Execute On Call",
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

// Creating a record: the command, and the shortcut that opens the same form.
interface CreatePress {
  purpose: string;
  command: string;
  shortcut: string;
}

const CREATE_INCIDENT: CreatePress = {
  purpose: "declare an incident",
  command: SlackActionType.NewIncident,
  shortcut: "Create New Incident",
};

const CREATE_SCHEDULED_MAINTENANCE: CreatePress = {
  purpose: "create a scheduled maintenance event",
  command: SlackActionType.NewScheduledMaintenance,
  shortcut: "Create Scheduled Event",
};

const CREATE_PRESSES: Partial<Record<SlackActionType, CreatePress>> = {
  [SlackActionType.NewIncident]: CREATE_INCIDENT,
  [SlackActionType.SubmitNewIncident]: CREATE_INCIDENT,
  [SlackActionType.NewScheduledMaintenance]: CREATE_SCHEDULED_MAINTENANCE,
  [SlackActionType.SubmitNewScheduledMaintenance]: CREATE_SCHEDULED_MAINTENANCE,
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

    const create: CreatePress | undefined = CREATE_PRESSES[actionType];

    if (create) {
      return {
        purpose: create.purpose,
        again:
          data.payloadType === "shortcut"
            ? {
                kind: WorkspaceConnectRequestAgainKind.Button,
                label: create.shortcut,
              }
            : {
                kind: WorkspaceConnectRequestAgainKind.Command,
                label: create.command,
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
   * connect, with a link to the settings page without the press.
   */
  @CaptureSpan()
  public static async prompt(data: {
    projectId: ObjectID;
    place: SlackAnswerPlace;
    slackTeamId?: string | undefined;
    description: SlackPressDescription;
  }): Promise<SlackAnswerDelivery> {
    const answer: WorkspaceAnswer = WorkspaceActionAnswers.getConnectPrompt({
      workspaceType: WorkspaceType.Slack,
      purpose: data.description.purpose,
      pendingAction: data.description.pendingAction,
      again: data.description.again,
    });

    let connectUrl: URL | undefined = undefined;

    try {
      const { token } = await WorkspaceConnectRequest.create({
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
        },
      });

      connectUrl = await WorkspaceConnectRequest.getConnectUrl({
        workspaceType: WorkspaceType.Slack,
        projectId: data.projectId,
        token: token,
      });
    } catch (err) {
      logger.error(
        "Could not record a Slack press to finish once the account is connected.",
        { projectId: data.projectId.toString() },
      );
      logger.error(err, { projectId: data.projectId.toString() });

      try {
        connectUrl = await WorkspaceConnectRequest.getSettingsUrl({
          workspaceType: WorkspaceType.Slack,
          projectId: data.projectId,
        });
      } catch (linkError) {
        logger.debug("Could not build the Slack settings link either.");
        logger.debug(linkError);
      }
    }

    return await SlackActionAnswer.answer({
      place: data.place,
      answer: answer,
      connectUrl: connectUrl,
    });
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
