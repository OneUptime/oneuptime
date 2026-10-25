import { TurnContext } from "./Botbuilder";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import logger from "../../Logger";
import ProductBrandingText from "../../ProductBrandingText";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import WorkspaceActionAnswers from "../WorkspaceActionAnswers";
import WorkspaceProjectResolver from "../WorkspaceProjectResolution";
import WorkspaceConnectRequest, {
  WorkspaceConnectButton,
  WorkspaceConnectLink,
  WorkspaceConnectRequestAgainKind,
  WorkspaceConnectRequestTeamsPlace,
  WorkspacePendingActionKind,
  WorkspacePressDescription,
} from "../WorkspaceConnectRequest";
import WorkspaceMemberActions, {
  WorkspaceEventType,
} from "../WorkspaceMemberActions";
import { WorkspaceCommandName } from "../WorkspaceCommands";
import WorkspaceConnectPromptOnce, {
  WorkspaceConnectPromptClaim,
  WorkspaceConversationPerson,
} from "../WorkspaceConnectPromptOnce";
import {
  MicrosoftTeamsAlertActionType,
  MicrosoftTeamsAlertEpisodeActionType,
  MicrosoftTeamsIncidentActionType,
  MicrosoftTeamsIncidentEpisodeActionType,
  MicrosoftTeamsPageActionType,
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
  does:
    | "addNote"
    | "changeState"
    | "executeOnCallPolicy"
    | "changeSeverity"
    | "assignRole"
    | "pageSomeone"
    | "editCustomFields";
  eventType: WorkspaceEventType;
  // The button's title as the card draws it, without its emoji.
  button: string;
  /*
   * An item of the card's menu (…), not a button: chosen from the menu
   * again, which the answer says, since there is no button to find.
   */
  isMenuItem?: boolean | undefined;
}

/*
 * The incident card's menu (…), each item named as the menu draws it: its
 * form, opened and submitted.
 */
function incidentMenuPresses(): Array<[string, FormPress]> {
  const items: Array<{
    does: FormPress["does"];
    button: string;
    actions: Array<string>;
  }> = [
    {
      does: "changeSeverity",
      button: "Change Severity",
      actions: [
        MicrosoftTeamsIncidentActionType.ViewChangeIncidentSeverity,
        MicrosoftTeamsIncidentActionType.SubmitChangeIncidentSeverity,
      ],
    },
    {
      does: "assignRole",
      button: "Assign Role",
      actions: [
        MicrosoftTeamsIncidentActionType.ViewAssignIncidentRole,
        MicrosoftTeamsIncidentActionType.SubmitAssignIncidentRole,
      ],
    },
    {
      does: "pageSomeone",
      button: "Page Someone",
      actions: [
        MicrosoftTeamsIncidentActionType.ViewPageAboutIncident,
        MicrosoftTeamsIncidentActionType.SubmitPageAboutIncident,
      ],
    },
    {
      does: "editCustomFields",
      button: "Edit Custom Fields",
      actions: [
        MicrosoftTeamsIncidentActionType.ViewEditIncidentCustomFields,
        MicrosoftTeamsIncidentActionType.SubmitEditIncidentCustomFields,
      ],
    },
  ];

  return items.flatMap(
    (item: {
      does: FormPress["does"];
      button: string;
      actions: Array<string>;
    }): Array<[string, FormPress]> => {
      return item.actions.map((action: string): [string, FormPress] => {
        return [
          action,
          {
            does: item.does,
            eventType: WorkspaceEventType.Incident,
            button: item.button,
            isMenuItem: true,
          },
        ];
      });
    },
  );
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
          {
            does: "executeOnCallPolicy",
            eventType,
            button: "Execute On-Call Policy",
          },
        ];
      },
    ),
  ];
}

const FORM_PRESSES: ReadonlyMap<string, FormPress> = new Map<string, FormPress>(
  [
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
    ...incidentMenuPresses(),
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
  ],
);

// Creating a record: the bot command that opens its form.
const CREATE_PRESSES: ReadonlyMap<
  string,
  { purpose: string; command: string }
> = new Map<string, { purpose: string; command: string }>([
  [
    MicrosoftTeamsIncidentActionType.NewIncident,
    {
      purpose: "declare an incident",
      command: WorkspaceCommandName.Incident,
    },
  ],
  [
    MicrosoftTeamsIncidentActionType.SubmitNewIncident,
    {
      purpose: "declare an incident",
      command: WorkspaceCommandName.Incident,
    },
  ],
  [
    MicrosoftTeamsScheduledMaintenanceActionType.NewScheduledMaintenance,
    {
      purpose: "create a scheduled maintenance event",
      command: WorkspaceCommandName.Maintenance,
    },
  ],
  [
    MicrosoftTeamsScheduledMaintenanceActionType.SubmitNewScheduledMaintenance,
    {
      purpose: "create a scheduled maintenance event",
      command: WorkspaceCommandName.Maintenance,
    },
  ],
  /*
   * A page is never sent for somebody once they connect: they type the
   * command again, so nobody is woken by a page its sender has forgotten.
   */
  [
    MicrosoftTeamsPageActionType.SubmitPageSomeone,
    {
      purpose: "page someone",
      command: WorkspaceCommandName.Page,
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
          kind: form.isMenuItem
            ? WorkspaceConnectRequestAgainKind.MenuItem
            : WorkspaceConnectRequestAgainKind.Button,
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
   * A command typed to the bot - "incident" - from an account not connected
   * yet: typed again once it is.
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
   * the press. True once the reply is sent. Never throws.
   */
  @CaptureSpan()
  public static async prompt(data: {
    turnContext: TurnContext;
    projectId: ObjectID;
    description: WorkspacePressDescription;
  }): Promise<boolean> {
    const activity: JSONObject = data.turnContext
      .activity as unknown as JSONObject;

    const teamsUserId: string =
      ((activity["from"] as JSONObject | undefined)?.["aadObjectId"] as
        | string
        | undefined) || "";

    /*
     * A press that names no Microsoft Entra user cannot be matched to who
     * signs in later: it is not recorded, and the button opens the settings
     * page alone.
     */
    const link: WorkspaceConnectLink = teamsUserId
      ? await WorkspaceConnectRequest.getConnectLink({
          workspaceType: WorkspaceType.MicrosoftTeams,
          projectId: data.projectId,
          workspaceUserId: teamsUserId,
          purpose: data.description.purpose,
          pendingAction: data.description.pendingAction,
          again: data.description.again,
          teams: MicrosoftTeamsConnectPrompt.getPlace(activity),
        })
      : await MicrosoftTeamsConnectPrompt.getSettingsLink(data.projectId);

    // In an organization connected to more than one project: which one.
    const tenantId: unknown =
      (
        (activity["channelData"] as JSONObject | undefined)?.["tenant"] as
          | JSONObject
          | undefined
      )?.["id"] ||
      (activity["conversation"] as JSONObject | undefined)?.["tenantId"];

    return await MicrosoftTeamsActionAnswer.reply({
      turnContext: data.turnContext,
      answer: WorkspaceActionAnswers.getConnectPrompt({
        workspaceType: WorkspaceType.MicrosoftTeams,
        purpose: data.description.purpose,
        pendingAction: data.description.pendingAction,
        again: data.description.again,
        button: link.button,
        projectName:
          await WorkspaceProjectResolver.getSharedWorkspaceProjectName({
            workspaceType: WorkspaceType.MicrosoftTeams,
            workspaceId: typeof tenantId === "string" ? tenantId : undefined,
            projectId: data.projectId,
          }),
      }),
      connectUrl: link.url,
    });
  }

  /*
   * A question to OneUptime AI - typed in a personal chat, or after
   * @OneUptime in a channel or a group chat - from a Microsoft Teams
   * account not connected yet: prompted as `prompt` does, once in the
   * conversation (a channel's thread, a chat), and not again there while
   * the Connect button it carries works (WorkspaceConnectPromptOnce). The
   * card stays in the conversation, so asking again there is answered by
   * it. True once the reply is sent, false when it could not be (and the
   * next question there is prompted), null when they were asked there
   * already. Never throws.
   */
  @CaptureSpan()
  public static async promptOnce(data: {
    turnContext: TurnContext;
    projectId: ObjectID;
    description: WorkspacePressDescription;
  }): Promise<boolean | null> {
    const claim: WorkspaceConnectPromptClaim | null =
      await WorkspaceConnectPromptOnce.claim(
        MicrosoftTeamsConnectPrompt.getConversation(
          data.turnContext.activity as unknown as JSONObject,
        ),
      );

    if (!claim) {
      return null;
    }

    const isPrompted: boolean = await MicrosoftTeamsConnectPrompt.prompt(data);

    if (!isPrompted) {
      await claim.release();
    }

    return isPrompted;
  }

  /*
   * The conversation an activity came in, and who sent it, for its one
   * Connect prompt: a channel's thread ("<channel>;messageid=<post>"), a
   * group chat or a personal chat, in the sender's Microsoft 365 tenant.
   */
  public static getConversation(
    activity: JSONObject,
  ): WorkspaceConversationPerson {
    const conversation: JSONObject =
      (activity["conversation"] as JSONObject | undefined) || {};
    const from: JSONObject = (activity["from"] as JSONObject | undefined) || {};
    const tenantId: unknown =
      (
        (activity["channelData"] as JSONObject | undefined)?.["tenant"] as
          | JSONObject
          | undefined
      )?.["id"] || conversation["tenantId"];

    return {
      workspaceType: WorkspaceType.MicrosoftTeams,
      workspaceId: typeof tenantId === "string" ? tenantId : "",
      conversationId:
        typeof conversation["id"] === "string" ? conversation["id"] : "",
      // The Microsoft Entra object id, else the Teams id.
      workspaceUserId:
        (typeof from["aadObjectId"] === "string" && from["aadObjectId"]) ||
        (typeof from["id"] === "string" ? from["id"] : ""),
    };
  }

  // The settings page alone, for a press that cannot be recorded.
  private static async getSettingsLink(
    projectId: ObjectID,
  ): Promise<WorkspaceConnectLink> {
    try {
      return {
        button: WorkspaceConnectButton.SettingsPage,
        url: await WorkspaceConnectRequest.getSettingsUrl({
          workspaceType: WorkspaceType.MicrosoftTeams,
          projectId: projectId,
        }),
      };
    } catch (err) {
      logger.debug(
        "No address of this server's own to link a Connect button to.",
      );
      logger.debug(err);
      return { button: WorkspaceConnectButton.None };
    }
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
      case "changeSeverity":
        return `change the severity of this ${noun}`;
      case "assignRole":
        return `assign a role on this ${noun}`;
      case "pageSomeone":
        return `page someone about this ${noun}`;
      case "editCustomFields":
        return `edit the custom fields of this ${noun}`;
    }
  }
}
