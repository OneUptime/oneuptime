import { TurnContext } from "botbuilder";
import URL from "../../../../Types/API/URL";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import logger from "../../Logger";
import ProductBrandingText from "../../ProductBrandingText";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import WorkspaceActionAnswers from "../WorkspaceActionAnswers";
import WorkspaceConnectRequest, {
  WorkspaceConnectRequestAgainKind,
  WorkspaceConnectRequestTeamsPlace,
  WorkspacePendingActionKind,
  WorkspacePressDescription,
} from "../WorkspaceConnectRequest";
import WorkspaceMemberActions, {
  WorkspaceEventType,
} from "../WorkspaceMemberActions";
import {
  CREATE_INCIDENT_COMMAND,
  CREATE_MAINTENANCE_COMMAND,
  MicrosoftTeamsAlertActionType,
  MicrosoftTeamsAlertEpisodeActionType,
  MicrosoftTeamsIncidentActionType,
  MicrosoftTeamsIncidentEpisodeActionType,
  MicrosoftTeamsScheduledMaintenanceActionType,
} from "./Actions/ActionTypes";
import MicrosoftTeamsActionAnswer from "./MicrosoftTeamsActionAnswer";
import MicrosoftTeamsServiceUrl from "./MicrosoftTeamsServiceUrl";

/*
 * "CONNECT YOUR MICROSOFT TEAMS ACCOUNT TO ACKNOWLEDGE THIS INCIDENT."
 *
 * What somebody whose Microsoft Teams account is not connected to OneUptime
 * is told when they press a button on a card or type a command to the bot:
 * a reply where they did it, mentioning them, with a Connect button
 * (MicrosoftTeamsActionAnswer). It used to be a line of plain text naming no
 * one, with a link to a settings page where the account could be connected
 * after a few more clicks, and then "try again".
 *
 * The button opens their own Microsoft Teams settings page in OneUptime,
 * which connects their account in one step; then OneUptime finishes what
 * they pressed - Acknowledge, Resolve, Mark as Ongoing, Mark as Complete -
 * as the member it is now connected to, and answers in the same
 * conversation, or says what to press or type again
 * (WorkspaceConnectRequest, WorkspaceConnectCompletion).
 */

interface PendingPress {
  kind: WorkspacePendingActionKind;
  eventType: WorkspaceEventType;
}

const PENDING_PRESSES: ReadonlyMap<string, PendingPress> = new Map<
  string,
  PendingPress
>([
  [
    MicrosoftTeamsIncidentActionType.AckIncident,
    {
      kind: WorkspacePendingActionKind.Acknowledge,
      eventType: WorkspaceEventType.Incident,
    },
  ],
  [
    MicrosoftTeamsIncidentActionType.ResolveIncident,
    {
      kind: WorkspacePendingActionKind.Resolve,
      eventType: WorkspaceEventType.Incident,
    },
  ],
  [
    MicrosoftTeamsAlertActionType.AckAlert,
    {
      kind: WorkspacePendingActionKind.Acknowledge,
      eventType: WorkspaceEventType.Alert,
    },
  ],
  [
    MicrosoftTeamsAlertActionType.ResolveAlert,
    {
      kind: WorkspacePendingActionKind.Resolve,
      eventType: WorkspaceEventType.Alert,
    },
  ],
  [
    MicrosoftTeamsIncidentEpisodeActionType.AckIncidentEpisode,
    {
      kind: WorkspacePendingActionKind.Acknowledge,
      eventType: WorkspaceEventType.IncidentEpisode,
    },
  ],
  [
    MicrosoftTeamsIncidentEpisodeActionType.ResolveIncidentEpisode,
    {
      kind: WorkspacePendingActionKind.Resolve,
      eventType: WorkspaceEventType.IncidentEpisode,
    },
  ],
  [
    MicrosoftTeamsAlertEpisodeActionType.AckAlertEpisode,
    {
      kind: WorkspacePendingActionKind.Acknowledge,
      eventType: WorkspaceEventType.AlertEpisode,
    },
  ],
  [
    MicrosoftTeamsAlertEpisodeActionType.ResolveAlertEpisode,
    {
      kind: WorkspacePendingActionKind.Resolve,
      eventType: WorkspaceEventType.AlertEpisode,
    },
  ],
  [
    MicrosoftTeamsScheduledMaintenanceActionType.MarkAsOngoing,
    {
      kind: WorkspacePendingActionKind.MarkAsOngoing,
      eventType: WorkspaceEventType.ScheduledMaintenance,
    },
  ],
  [
    MicrosoftTeamsScheduledMaintenanceActionType.MarkAsComplete,
    {
      kind: WorkspacePendingActionKind.MarkAsComplete,
      eventType: WorkspaceEventType.ScheduledMaintenance,
    },
  ],
]);

// A button that opens a form: what the form does, its record, the button.
interface FormPress {
  does: "addNote" | "changeState" | "executeOnCallPolicy";
  eventType: WorkspaceEventType;
  // The button's title as the card draws it, without its emoji.
  button: string;
}

function formPresses(
  eventType: WorkspaceEventType,
  actions: {
    addNote: Array<string>;
    changeState: Array<string>;
    executeOnCallPolicy: Array<string>;
  },
  changeStateButton: string,
): Array<[string, FormPress]> {
  return [
    ...actions.addNote.map((action: string): [string, FormPress] => {
      return [action, { does: "addNote", eventType, button: "Add Note" }];
    }),
    ...actions.changeState.map((action: string): [string, FormPress] => {
      return [
        action,
        { does: "changeState", eventType, button: changeStateButton },
      ];
    }),
    ...actions.executeOnCallPolicy.map(
      (action: string): [string, FormPress] => {
        return [
          action,
          { does: "executeOnCallPolicy", eventType, button: "Execute On Call" },
        ];
      },
    ),
  ];
}

const FORM_PRESSES: ReadonlyMap<string, FormPress> = new Map<
  string,
  FormPress
>([
  ...formPresses(
    WorkspaceEventType.Incident,
    {
      addNote: [
        MicrosoftTeamsIncidentActionType.ViewAddIncidentNote,
        MicrosoftTeamsIncidentActionType.SubmitIncidentNote,
        MicrosoftTeamsIncidentActionType.AddIncidentNote,
      ],
      changeState: [
        MicrosoftTeamsIncidentActionType.ViewChangeIncidentState,
        MicrosoftTeamsIncidentActionType.SubmitChangeIncidentState,
      ],
      executeOnCallPolicy: [
        MicrosoftTeamsIncidentActionType.ViewExecuteIncidentOnCallPolicy,
        MicrosoftTeamsIncidentActionType.SubmitExecuteIncidentOnCallPolicy,
        MicrosoftTeamsIncidentActionType.ExecuteIncidentOnCallPolicy,
      ],
    },
    "Change Incident State",
  ),
  ...formPresses(
    WorkspaceEventType.Alert,
    {
      addNote: [
        MicrosoftTeamsAlertActionType.ViewAddAlertNote,
        MicrosoftTeamsAlertActionType.SubmitAlertNote,
        MicrosoftTeamsAlertActionType.AddAlertNote,
      ],
      changeState: [
        MicrosoftTeamsAlertActionType.ViewChangeAlertState,
        MicrosoftTeamsAlertActionType.SubmitChangeAlertState,
      ],
      executeOnCallPolicy: [
        MicrosoftTeamsAlertActionType.ViewExecuteAlertOnCallPolicy,
        MicrosoftTeamsAlertActionType.SubmitExecuteAlertOnCallPolicy,
        MicrosoftTeamsAlertActionType.ExecuteAlertOnCallPolicy,
      ],
    },
    "Change Alert State",
  ),
  ...formPresses(
    WorkspaceEventType.IncidentEpisode,
    {
      addNote: [
        MicrosoftTeamsIncidentEpisodeActionType.ViewAddIncidentEpisodeNote,
        MicrosoftTeamsIncidentEpisodeActionType.SubmitIncidentEpisodeNote,
        MicrosoftTeamsIncidentEpisodeActionType.AddIncidentEpisodeNote,
      ],
      changeState: [
        MicrosoftTeamsIncidentEpisodeActionType.ViewChangeIncidentEpisodeState,
        MicrosoftTeamsIncidentEpisodeActionType.SubmitChangeIncidentEpisodeState,
      ],
      executeOnCallPolicy: [
        MicrosoftTeamsIncidentEpisodeActionType.ViewExecuteIncidentEpisodeOnCallPolicy,
        MicrosoftTeamsIncidentEpisodeActionType.SubmitExecuteIncidentEpisodeOnCallPolicy,
        MicrosoftTeamsIncidentEpisodeActionType.ExecuteIncidentEpisodeOnCallPolicy,
      ],
    },
    "Change Episode State",
  ),
  ...formPresses(
    WorkspaceEventType.AlertEpisode,
    {
      addNote: [
        MicrosoftTeamsAlertEpisodeActionType.ViewAddAlertEpisodeNote,
        MicrosoftTeamsAlertEpisodeActionType.SubmitAlertEpisodeNote,
        MicrosoftTeamsAlertEpisodeActionType.AddAlertEpisodeNote,
      ],
      changeState: [
        MicrosoftTeamsAlertEpisodeActionType.ViewChangeAlertEpisodeState,
        MicrosoftTeamsAlertEpisodeActionType.SubmitChangeAlertEpisodeState,
      ],
      executeOnCallPolicy: [
        MicrosoftTeamsAlertEpisodeActionType.ViewExecuteAlertEpisodeOnCallPolicy,
        MicrosoftTeamsAlertEpisodeActionType.SubmitExecuteAlertEpisodeOnCallPolicy,
        MicrosoftTeamsAlertEpisodeActionType.ExecuteAlertEpisodeOnCallPolicy,
      ],
    },
    "Change Episode State",
  ),
  ...formPresses(
    WorkspaceEventType.ScheduledMaintenance,
    {
      addNote: [
        MicrosoftTeamsScheduledMaintenanceActionType.ViewAddScheduledMaintenanceNote,
        MicrosoftTeamsScheduledMaintenanceActionType.SubmitScheduledMaintenanceNote,
        MicrosoftTeamsScheduledMaintenanceActionType.AddScheduledMaintenanceNote,
      ],
      changeState: [
        MicrosoftTeamsScheduledMaintenanceActionType.ViewChangeScheduledMaintenanceState,
        MicrosoftTeamsScheduledMaintenanceActionType.SubmitChangeScheduledMaintenanceState,
      ],
      executeOnCallPolicy: [],
    },
    "Change State",
  ),
]);

// Creating a record: the bot command that opens its form.
const CREATE_PRESSES: ReadonlyMap<string, { purpose: string; command: string }> =
  new Map<string, { purpose: string; command: string }>([
    [
      MicrosoftTeamsIncidentActionType.NewIncident,
      { purpose: "declare an incident", command: CREATE_INCIDENT_COMMAND },
    ],
    [
      MicrosoftTeamsIncidentActionType.SubmitNewIncident,
      { purpose: "declare an incident", command: CREATE_INCIDENT_COMMAND },
    ],
    [
      MicrosoftTeamsScheduledMaintenanceActionType.NewScheduledMaintenance,
      {
        purpose: "create a scheduled maintenance event",
        command: CREATE_MAINTENANCE_COMMAND,
      },
    ],
    [
      MicrosoftTeamsScheduledMaintenanceActionType.SubmitNewScheduledMaintenance,
      {
        purpose: "create a scheduled maintenance event",
        command: CREATE_MAINTENANCE_COMMAND,
      },
    ],
  ]);

export default class MicrosoftTeamsConnectPrompt {
  /*
   * What a press on a card asks to be connected for, and what happens once
   * it is: finished for them, or a form or a command to use again. Nothing
   * about the record is read: the person may not read it yet.
   */
  public static describe(data: {
    actionType: string;
    actionValue?: string | undefined;
  }): WorkspacePressDescription {
    const pending: PendingPress | undefined = PENDING_PRESSES.get(
      data.actionType,
    );

    if (pending) {
      const purpose: string = WorkspaceActionAnswers.getPendingActionPurpose({
        kind: pending.kind,
        eventType: pending.eventType,
      });

      // An id OneUptime wrote on its own card; anything else is not finished.
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

    const form: FormPress | undefined = FORM_PRESSES.get(data.actionType);

    if (form) {
      return {
        purpose: MicrosoftTeamsConnectPrompt.getFormPurpose(form),
        again: {
          kind: WorkspaceConnectRequestAgainKind.Button,
          label: form.button,
        },
      };
    }

    const create: { purpose: string; command: string } | undefined =
      CREATE_PRESSES.get(data.actionType);

    if (create) {
      return MicrosoftTeamsConnectPrompt.describeCommand(create);
    }

    return {
      purpose: `use ${ProductBrandingText.getProductName()} from Microsoft Teams`,
    };
  }

  /*
   * A command typed to the bot - "create incident" - from an account not
   * connected yet: typed again once it is.
   */
  public static describeCommand(data: {
    purpose: string;
    command: string;
  }): WorkspacePressDescription {
    return {
      purpose: data.purpose,
      again: {
        kind: WorkspaceConnectRequestAgainKind.Command,
        label: data.command,
      },
    };
  }

  /*
   * Answers a press - a card's button, a command - from a Microsoft Teams
   * account not connected to OneUptime, in the conversation it was made in,
   * mentioning who made it, with a Connect button for that account in the
   * project. The press is recorded to be finished, or answered, there once
   * it is connected. When it cannot be recorded (the cache is down), the
   * answer still says to connect, with a link to the settings page without
   * the press. Never throws.
   */
  @CaptureSpan()
  public static async prompt(data: {
    turnContext: TurnContext;
    projectId: ObjectID;
    description: WorkspacePressDescription;
  }): Promise<void> {
    const activity: JSONObject = data.turnContext
      .activity as unknown as JSONObject;

    const teamsUserId: string =
      ((activity["from"] as JSONObject | undefined)?.["aadObjectId"] as
        | string
        | undefined) || "";

    let connectUrl: URL | undefined = undefined;

    try {
      if (!teamsUserId) {
        throw new Error("The press names no Microsoft Entra user.");
      }

      const { token } = await WorkspaceConnectRequest.create({
        workspaceType: WorkspaceType.MicrosoftTeams,
        projectId: data.projectId,
        workspaceUserId: teamsUserId,
        purpose: data.description.purpose,
        pendingAction: data.description.pendingAction,
        again: data.description.again,
        teams: MicrosoftTeamsConnectPrompt.getPlace(activity),
      });

      connectUrl = await WorkspaceConnectRequest.getConnectUrl({
        workspaceType: WorkspaceType.MicrosoftTeams,
        projectId: data.projectId,
        token: token,
      });
    } catch (err) {
      logger.error(
        "Could not record a Microsoft Teams press to finish once the account is connected.",
        { projectId: data.projectId.toString() },
      );
      logger.error(err, { projectId: data.projectId.toString() });

      try {
        connectUrl = await WorkspaceConnectRequest.getSettingsUrl({
          workspaceType: WorkspaceType.MicrosoftTeams,
          projectId: data.projectId,
        });
      } catch (linkError) {
        logger.debug("Could not build the Microsoft Teams settings link either.");
        logger.debug(linkError);
      }
    }

    await MicrosoftTeamsActionAnswer.reply({
      turnContext: data.turnContext,
      answer: WorkspaceActionAnswers.getConnectPrompt({
        workspaceType: WorkspaceType.MicrosoftTeams,
        purpose: data.description.purpose,
        pendingAction: data.description.pendingAction,
        again: data.description.again,
      }),
      connectUrl: connectUrl,
    });
  }

  /*
   * Where a press was made, to answer there later: the conversation its
   * activity came in (a channel post's thread, a chat) and the Bot
   * Connector it came from, and the person, to mention. A serviceUrl that
   * is not a Microsoft host is not kept.
   */
  public static getPlace(
    activity: JSONObject,
  ): WorkspaceConnectRequestTeamsPlace | undefined {
    const conversation: JSONObject =
      (activity["conversation"] as JSONObject | undefined) || {};
    const from: JSONObject = (activity["from"] as JSONObject | undefined) || {};
    const channelData: JSONObject =
      (activity["channelData"] as JSONObject | undefined) || {};

    const serviceUrl: unknown = activity["serviceUrl"];
    const conversationId: unknown = conversation["id"];

    if (
      typeof serviceUrl !== "string" ||
      !MicrosoftTeamsServiceUrl.isTrusted(serviceUrl) ||
      typeof conversationId !== "string" ||
      !conversationId
    ) {
      return undefined;
    }

    const place: WorkspaceConnectRequestTeamsPlace = {
      serviceUrl: serviceUrl,
      conversationId: conversationId,
    };

    const conversationType: unknown = conversation["conversationType"];
    const tenantId: unknown =
      (channelData["tenant"] as JSONObject | undefined)?.["id"] ||
      conversation["tenantId"];

    if (typeof conversationType === "string" && conversationType) {
      place.conversationType = conversationType;
    }

    if (typeof tenantId === "string" && tenantId) {
      place.tenantId = tenantId;
    }

    if (typeof from["id"] === "string" && from["id"]) {
      place.userTeamsId = from["id"] as string;
    }

    if (typeof from["name"] === "string" && from["name"]) {
      place.userName = from["name"] as string;
    }

    return place;
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
