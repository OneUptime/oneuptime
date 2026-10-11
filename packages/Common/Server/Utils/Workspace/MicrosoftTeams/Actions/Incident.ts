import { MicrosoftTeamsIncidentActionType } from "./ActionTypes";
import logger from "../../../Logger";
import ObjectID from "../../../../../Types/ObjectID";
import IncidentService from "../../../../Services/IncidentService";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import { TurnContext } from "botbuilder";
import { JSONObject, JSONValue } from "../../../../../Types/JSON";
import IncidentPublicNoteService from "../../../../Services/IncidentPublicNoteService";
import IncidentInternalNoteService from "../../../../Services/IncidentInternalNoteService";
import OnCallDutyPolicyService from "../../../../Services/OnCallDutyPolicyService";
import OnCallDutyPolicy from "../../../../../Models/DatabaseModels/OnCallDutyPolicy";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import Label from "../../../../../Models/DatabaseModels/Label";
import URL from "../../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import WorkspaceProjectReferenceValidator from "../../WorkspaceProjectReferenceValidator";
import WorkspaceActionAuthorization from "../../WorkspaceActionAuthorization";
import WorkspaceMemberActions, {
  WorkspaceEventRecord,
  WorkspaceEventStateOption,
  WorkspaceEventStateOptions,
  WorkspaceEventType,
} from "../../WorkspaceMemberActions";
import IncidentStateTimeline from "../../../../../Models/DatabaseModels/IncidentStateTimeline";
import IncidentPublicNote from "../../../../../Models/DatabaseModels/IncidentPublicNote";
import IncidentInternalNote from "../../../../../Models/DatabaseModels/IncidentInternalNote";
import OnCallDutyPolicyExecutionLog from "../../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import ColumnLength from "../../../../../Types/Database/ColumnLength";
import { truncateToLength } from "../../../Database/TruncateColumnValue";
import MicrosoftTeamsCardChoices, {
  MicrosoftTeamsCardChoiceList,
} from "../MicrosoftTeamsCardChoices";
import MicrosoftTeamsReplies from "../MicrosoftTeamsReplies";
import FeedMarkdown, {
  mdText,
} from "../../../../../Utils/Markdown/FeedMarkdown";

// Incident.title is a LongText column.
const MICROSOFT_TEAMS_INCIDENT_TITLE_MAX_LENGTH: number = ColumnLength.LongText;

// The lists the "Create New Incident" card offers.
export interface MicrosoftTeamsNewIncidentFormChoices {
  severities: MicrosoftTeamsCardChoiceList;
  monitors: MicrosoftTeamsCardChoiceList;
  monitorStatuses: MicrosoftTeamsCardChoiceList;
  labels: MicrosoftTeamsCardChoiceList;
  onCallDutyPolicies: MicrosoftTeamsCardChoiceList;
}

export default class MicrosoftTeamsIncidentActions {
  // What a change-state card says instead of opening with nothing to pick.
  public static readonly NO_STATES_MESSAGE: string =
    "No incident states are available to you in this project. Ask a project admin for access to them.";

  @CaptureSpan()
  public static isIncidentAction(data: { actionType: string }): boolean {
    // Check if the action is related to incidents
    return (
      data.actionType === MicrosoftTeamsIncidentActionType.AckIncident ||
      data.actionType === MicrosoftTeamsIncidentActionType.ResolveIncident ||
      data.actionType === MicrosoftTeamsIncidentActionType.ViewIncident ||
      data.actionType === MicrosoftTeamsIncidentActionType.IncidentCreated ||
      data.actionType ===
        MicrosoftTeamsIncidentActionType.IncidentStateChanged ||
      data.actionType ===
        MicrosoftTeamsIncidentActionType.ViewAddIncidentNote ||
      data.actionType === MicrosoftTeamsIncidentActionType.SubmitIncidentNote ||
      data.actionType ===
        MicrosoftTeamsIncidentActionType.ExecuteIncidentOnCallPolicy ||
      data.actionType ===
        MicrosoftTeamsIncidentActionType.ViewExecuteIncidentOnCallPolicy ||
      data.actionType ===
        MicrosoftTeamsIncidentActionType.SubmitExecuteIncidentOnCallPolicy ||
      data.actionType ===
        MicrosoftTeamsIncidentActionType.ViewChangeIncidentState ||
      data.actionType ===
        MicrosoftTeamsIncidentActionType.SubmitChangeIncidentState ||
      data.actionType === MicrosoftTeamsIncidentActionType.NewIncident ||
      data.actionType === MicrosoftTeamsIncidentActionType.SubmitNewIncident
    );
  }

  @CaptureSpan()
  public static async handleBotIncidentAction(data: {
    actionType: string;
    actionValue: string;
    value: JSONObject;
    projectId: ObjectID;
    oneUptimeUserId: ObjectID;
    databaseProps: DatabaseCommonInteractionProps;
    turnContext: TurnContext;
  }): Promise<void> {
    const {
      actionType,
      actionValue,
      value,
      projectId,
      databaseProps,
      turnContext,
    } = data;

    if (actionType === MicrosoftTeamsIncidentActionType.AckIncident) {
      if (!actionValue) {
        await turnContext.sendActivity(
          "Unable to acknowledge: missing incident id.",
        );
        return;
      }

      const incidentId: ObjectID = new ObjectID(actionValue);

      const incident: WorkspaceEventRecord =
        await WorkspaceMemberActions.authorize({
          props: databaseProps,
          modelType: IncidentStateTimeline,
          action: "acknowledge this incident",
          event: { type: WorkspaceEventType.Incident, id: incidentId },
        });

      /*
       * Acknowledged by the member, as the dashboard acknowledges it for
       * them (WorkspaceMemberActions). A refusal is theirs to read:
       * handleBotInvokeActivity tells them.
       */
      await WorkspaceMemberActions.acknowledge({
        event: incident,
        props: databaseProps,
      });

      await turnContext.sendActivity("✅ Incident acknowledged.");
      return;
    }

    if (actionType === MicrosoftTeamsIncidentActionType.ResolveIncident) {
      if (!actionValue) {
        await turnContext.sendActivity(
          "Unable to resolve: missing incident id.",
        );
        return;
      }

      const incidentId: ObjectID = new ObjectID(actionValue);

      const incident: WorkspaceEventRecord =
        await WorkspaceMemberActions.authorize({
          props: databaseProps,
          modelType: IncidentStateTimeline,
          action: "resolve this incident",
          event: { type: WorkspaceEventType.Incident, id: incidentId },
        });

      // Resolved by the member, as the dashboard resolves it for them.
      await WorkspaceMemberActions.resolve({
        event: incident,
        props: databaseProps,
      });

      await turnContext.sendActivity("✅ Incident resolved.");
      return;
    }

    if (actionType === MicrosoftTeamsIncidentActionType.ViewIncident) {
      if (!actionValue) {
        await turnContext.sendActivity(
          "Unable to view incident: missing incident id.",
        );
        return;
      }

      const incident: Incident | null = await IncidentService.findOneBy({
        query: {
          _id: actionValue,
          projectId: projectId,
        },
        select: {
          _id: true,
          title: true,
          description: true,
          currentIncidentState: {
            name: true,
          },
          incidentSeverity: {
            name: true,
          },
          createdAt: true,
          declaredAt: true,
        },
        // Read as the member: an incident they may not read is not shown.
        props: databaseProps,
      });

      if (!incident) {
        await turnContext.sendActivity("Incident not found.");
        return;
      }

      const declaredAt: Date | undefined =
        incident.declaredAt || incident.createdAt || undefined;
      // The title and the state and severity names are plain text, escaped as MarkdownEscape says a title must be.
      const message: string =
        mdText`**Incident Details**\n\n**Title:** ${incident.title}\n**Description:** ${FeedMarkdown.asChatMarkdown(incident.description || "No description")}\n**State:** ${incident.currentIncidentState?.name || "Unknown"}\n**Severity:** ${incident.incidentSeverity?.name || "Unknown"}\n**Declared At:** ${declaredAt ? new Date(declaredAt).toLocaleString() : "Unknown"}`.toString();

      await turnContext.sendActivity(message);
      return;
    }

    if (actionType === MicrosoftTeamsIncidentActionType.ViewAddIncidentNote) {
      if (!actionValue) {
        await turnContext.sendActivity(
          "Unable to add note: missing incident id.",
        );
        return;
      }

      // Send the input card
      const card: JSONObject = this.buildAddIncidentNoteCard(actionValue);
      await turnContext.sendActivity({
        attachments: [
          {
            contentType: "application/vnd.microsoft.card.adaptive",
            content: card,
          },
        ],
      });
      return;
    }

    if (actionType === MicrosoftTeamsIncidentActionType.SubmitIncidentNote) {
      if (!actionValue) {
        await turnContext.sendActivity(
          "Unable to add note: missing incident id.",
        );
        return;
      }

      // Check if form data is provided
      const noteType: JSONValue = value["noteType"];
      const note: JSONValue = value["note"];

      if (noteType && note) {
        // Submit the note
        const incidentId: ObjectID = new ObjectID(actionValue);

        if (noteType !== "public" && noteType !== "private") {
          await turnContext.sendActivity(
            "Unable to add note: invalid note type.",
          );
          return;
        }

        await WorkspaceActionAuthorization.assertCanCreate({
          props: databaseProps,
          modelType:
            noteType === "public" ? IncidentPublicNote : IncidentInternalNote,
          action:
            noteType === "public"
              ? "add a public note to this incident"
              : "add a private note to this incident",
          resources: [{ service: IncidentService, id: incidentId }],
        });

        // Posted by the member, as the dashboard posts it for them.
        if (noteType === "public") {
          await IncidentPublicNoteService.addNote({
            incidentId: incidentId,
            note: note.toString(),
            projectId: projectId,
            props: databaseProps,
          });
        } else {
          await IncidentInternalNoteService.addNote({
            incidentId: incidentId,
            note: note.toString(),
            projectId: projectId,
            props: databaseProps,
          });
        }

        await MicrosoftTeamsReplies.sendBestEffort(
          turnContext,
          "✅ Note added successfully.",
        );

        /*
         * The action is done: a refused reply or a failed delete of the
         * form must not read as a failed action, which invites a repeat.
         */
        await MicrosoftTeamsReplies.deleteBestEffort(
          turnContext,
          turnContext.activity.replyToId,
        );

        return;
      }
      await turnContext.sendActivity("Unable to add note: missing note data.");
      return;
    }

    if (
      actionType ===
      MicrosoftTeamsIncidentActionType.ViewExecuteIncidentOnCallPolicy
    ) {
      if (!actionValue) {
        await turnContext.sendActivity(
          "Unable to execute on-call policy: missing incident id.",
        );
        return;
      }

      /*
       * Asked as the submit asks it, before the card is shown, and the card
       * then offers the policies the member may read.
       */
      await WorkspaceActionAuthorization.assertCanCreate({
        props: databaseProps,
        modelType: OnCallDutyPolicyExecutionLog,
        action: "execute an on-call policy for this incident",
        resources: [
          { service: IncidentService, id: new ObjectID(actionValue) },
        ],
      });

      // Send the input card
      const card: JSONObject | null = await this.buildExecuteOnCallPolicyCard(
        actionValue,
        projectId,
        databaseProps,
      );
      if (!card) {
        await turnContext.sendActivity(
          "No on-call policies are available to you in this project yet. Add one in the OneUptime Dashboard under On-Call Duty > Policies, or ask a project admin for access to one.",
        );
        return;
      }
      await turnContext.sendActivity({
        attachments: [
          {
            contentType: "application/vnd.microsoft.card.adaptive",
            content: card,
          },
        ],
      });
      return;
    }

    if (
      actionType ===
      MicrosoftTeamsIncidentActionType.SubmitExecuteIncidentOnCallPolicy
    ) {
      if (!actionValue) {
        await turnContext.sendActivity(
          "Unable to execute on-call policy: missing incident id.",
        );
        return;
      }

      // Check if form data is provided
      const onCallPolicyId: JSONValue = value["onCallPolicy"];

      if (onCallPolicyId) {
        // Execute the policy
        const incidentId: ObjectID = new ObjectID(actionValue);
        const policyId: ObjectID = new ObjectID(onCallPolicyId.toString());

        const incident: WorkspaceEventRecord =
          await WorkspaceMemberActions.authorize({
            props: databaseProps,
            modelType: OnCallDutyPolicyExecutionLog,
            action: "execute an on-call policy for this incident",
            event: { type: WorkspaceEventType.Incident, id: incidentId },
            resources: [{ service: OnCallDutyPolicyService, id: policyId }],
          });

        /*
         * Executed by the member, as the dashboard's Execute On-Call Policy
         * executes it for them: an execution log triggered by the incident.
         */
        await WorkspaceMemberActions.executeOnCallPolicy({
          event: incident,
          onCallDutyPolicyId: policyId,
          props: databaseProps,
        });

        await MicrosoftTeamsReplies.sendBestEffort(
          turnContext,
          "✅ On-call policy executed successfully.",
        );

        /*
         * The action is done: a refused reply or a failed delete of the
         * form must not read as a failed action, which invites a repeat.
         */
        await MicrosoftTeamsReplies.deleteBestEffort(
          turnContext,
          turnContext.activity.replyToId,
        );

        return;
      }
      await turnContext.sendActivity(
        "Unable to execute on-call policy: missing policy id.",
      );
      return;
    }

    if (
      actionType === MicrosoftTeamsIncidentActionType.ViewChangeIncidentState
    ) {
      if (!actionValue) {
        await turnContext.sendActivity(
          "Unable to change incident state: missing incident id.",
        );
        return;
      }

      /*
       * Asked as the submit asks it, before the card is shown, of the
       * record as the submit reads it, with the state it is in. The card
       * then offers the states the member may read that it may
       * move into next (Common/Utils/StateMove), so it never offers a move
       * its timeline would refuse.
       */
      const incident: WorkspaceEventRecord =
        await WorkspaceMemberActions.authorize({
          props: databaseProps,
          modelType: IncidentStateTimeline,
          action: "change the state of this incident",
          event: {
            type: WorkspaceEventType.Incident,
            id: new ObjectID(actionValue),
          },
        });

      const stateOptions: WorkspaceEventStateOptions =
        await WorkspaceMemberActions.findStateOptions({
          event: incident,
          props: databaseProps,
        });

      if (stateOptions.options.length === 0) {
        await turnContext.sendActivity(
          stateOptions.hasNoLaterState
            ? WorkspaceMemberActions.getNoLaterStateMessage(
                WorkspaceEventType.Incident,
              )
            : MicrosoftTeamsIncidentActions.NO_STATES_MESSAGE,
        );
        return;
      }

      const card: JSONObject = this.buildChangeIncidentStateCard(
        actionValue,
        stateOptions.options,
      );

      await turnContext.sendActivity({
        attachments: [
          {
            contentType: "application/vnd.microsoft.card.adaptive",
            content: card,
          },
        ],
      });
      return;
    }

    if (
      actionType === MicrosoftTeamsIncidentActionType.SubmitChangeIncidentState
    ) {
      if (!actionValue) {
        await turnContext.sendActivity(
          "Unable to change incident state: missing incident id.",
        );
        return;
      }

      // Check if form data is provided
      const incidentStateId: JSONValue = value["incidentState"];

      if (incidentStateId) {
        // Update the state
        const incidentId: ObjectID = new ObjectID(actionValue);

        const incident: WorkspaceEventRecord =
          await WorkspaceMemberActions.authorize({
            props: databaseProps,
            modelType: IncidentStateTimeline,
            action: "change the state of this incident",
            event: { type: WorkspaceEventType.Incident, id: incidentId },
          });

        /*
         * The state change the dashboard makes: a row in the incident's
         * state timeline, created by the member (WorkspaceMemberActions).
         */
        await WorkspaceMemberActions.changeState({
          event: incident,
          stateId: new ObjectID(incidentStateId.toString()),
          props: databaseProps,
        });

        await MicrosoftTeamsReplies.sendBestEffort(
          turnContext,
          "✅ Incident state changed successfully.",
        );

        /*
         * The action is done: a refused reply or a failed delete of the
         * form must not read as a failed action, which invites a repeat.
         */
        await MicrosoftTeamsReplies.deleteBestEffort(
          turnContext,
          turnContext.activity.replyToId,
        );

        return;
      }
      await turnContext.sendActivity(
        "Unable to change incident state: missing state id.",
      );
      return;
    }

    if (actionType === MicrosoftTeamsIncidentActionType.SubmitNewIncident) {
      // Handle new incident submission
      const title: string = ((value["incidentTitle"] as string) || "").trim();
      const description: string = (
        (value["incidentDescription"] as string) || ""
      ).trim();
      const severityId: string = (value["incidentSeverity"] as string) || "";
      const monitorIds: string = (value["incidentMonitors"] as string) || "";
      const monitorStatusId: string = (value["monitorStatus"] as string) || "";
      const labelIds: string = (value["labels"] as string) || "";
      const onCallPolicyIds: string =
        (value["onCallDutyPolicies"] as string) || "";

      if (!title || !description || !severityId) {
        await turnContext.sendActivity(
          "Unable to create incident: missing required fields (title, description, or severity).",
        );
        return;
      }

      /*
       * Declared by the member who submits the card, as they would declare
       * it in OneUptime: someone who may not declare incidents is told so
       * (handleBotInvokeActivity answers the refusal) before anything is
       * read or created. The create below checks it again, with every
       * record the card names.
       */
      await WorkspaceActionAuthorization.assertCanCreate({
        props: databaseProps,
        modelType: Incident,
        action: "declare an incident",
      });

      let createdIncident: Incident;

      try {
        createdIncident = await this.createIncidentInProject({
          projectId,
          props: databaseProps,
          title,
          description,
          severityId,
          monitorIds,
          monitorStatusId,
          labelIds,
          onCallPolicyIds,
        });
      } catch (error) {
        MicrosoftTeamsReplies.logFailure(
          "Could not create an incident from Microsoft Teams",
          error,
          {
            projectId: projectId.toString(),
          },
        );
        await MicrosoftTeamsReplies.sendBestEffort(
          turnContext,
          await this.getIncidentCreateFailedMessage({
            error: error,
            projectId: projectId,
          }),
        );
        return;
      }

      /*
       * The incident exists from here on, so nothing below may report the
       * create as failed: a user told it failed submits again, which creates
       * a second incident and pages its on-call policies a second time. The
       * confirmation goes first; removing the submitted form is a courtesy.
       */
      await MicrosoftTeamsReplies.sendBestEffort(
        turnContext,
        await this.getIncidentCreatedMessage({
          projectId: projectId,
          incidentId: createdIncident.id || undefined,
        }),
      );
      await MicrosoftTeamsReplies.deleteBestEffort(
        turnContext,
        turnContext.activity.replyToId,
      );
      return;
    }

    /*
     * Default fallback for unimplemented actions
     * The action's name is placed as text: it comes from the card.
     */
    await turnContext.sendActivity(
      mdText`Sorry, but the action ${actionType} you requested is not implemented yet.`.toString(),
    );
  }

  /*
   * Why a submitted incident was not created, for the user: the reason when
   * OneUptime wrote one for them (a reference to another project's monitor,
   * say), otherwise a generic line; the details go to the log.
   */
  private static async getIncidentCreateFailedMessage(data: {
    error: unknown;
    projectId: ObjectID;
  }): Promise<string> {
    const reason: string | null =
      MicrosoftTeamsReplies.getUserFacingErrorMessage(data.error);

    // The reason can name a monitor, a label or a person: it is text.
    if (reason) {
      return mdText`❌ Could not create the incident: ${reason}`.toString();
    }

    const createInOneUptimeUrl: string | null =
      await MicrosoftTeamsReplies.getDashboardLink({
        projectId: data.projectId,
        route: "/incidents/create",
      });

    return mdText`❌ Could not create the incident because of an unexpected error. Please try again, or create it in OneUptime${
      createInOneUptimeUrl ? mdText`: ${createInOneUptimeUrl}` : "."
    }`.toString();
  }

  // The confirmation, with a link to the incident when one can be built.
  private static async getIncidentCreatedMessage(data: {
    projectId: ObjectID;
    incidentId?: ObjectID | undefined;
  }): Promise<string> {
    if (data.incidentId) {
      try {
        const incidentLink: URL =
          await IncidentService.getIncidentLinkInDashboard(
            data.projectId,
            data.incidentId,
          );

        return mdText`✅ Incident created successfully!\n\nView incident: ${incidentLink.toString()}`.toString();
      } catch (error) {
        logger.debug("Could not build the link to a new incident");
        logger.debug(error);
      }
    }

    return "✅ Incident created successfully!";
  }

  /*
   * Every id below comes from the submitted card, not from the form we sent.
   * The incident is declared by the member the Teams account is connected
   * to, with their own props, as they would declare it in OneUptime: they
   * must be allowed to declare incidents, and every record the card names -
   * the monitors, on-call policies, labels, severity and monitor status -
   * must be one they may name. IncidentService checks those on the create
   * itself, and a record they may not read is answered like one that is not
   * in the project (ProjectScopedReferenceException).
   */
  private static async createIncidentInProject(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    title: string;
    description: string;
    severityId: string;
    monitorIds: string;
    monitorStatusId: string;
    labelIds: string;
    onCallPolicyIds: string;
  }): Promise<Incident> {
    const { projectId } = data;

    const monitorIdArray: Array<ObjectID> =
      WorkspaceProjectReferenceValidator.parseCommaSeparatedIds(
        data.monitorIds,
      );
    const labelIdArray: Array<ObjectID> =
      WorkspaceProjectReferenceValidator.parseCommaSeparatedIds(data.labelIds);
    const policyIdArray: Array<ObjectID> =
      WorkspaceProjectReferenceValidator.parseCommaSeparatedIds(
        data.onCallPolicyIds,
      );
    const monitorStatusId: ObjectID | undefined =
      data.monitorStatusId && monitorIdArray.length > 0
        ? new ObjectID(data.monitorStatusId)
        : undefined;

    // Create the incident, credited to the member who declares it.
    const incident: Incident = new Incident();
    incident.title = data.title;
    incident.description = data.description;
    incident.projectId = projectId;
    incident.incidentSeverityId = new ObjectID(data.severityId);
    incident.rootCause = `Incident created via Microsoft Teams`;

    if (monitorIdArray.length > 0) {
      incident.monitors = monitorIdArray.map((id: ObjectID) => {
        const monitor: Monitor = new Monitor();
        monitor.id = id;
        return monitor;
      });
    }

    if (labelIdArray.length > 0) {
      incident.labels = labelIdArray.map((id: ObjectID) => {
        const label: Label = new Label();
        label.id = id;
        return label;
      });
    }

    if (policyIdArray.length > 0) {
      incident.onCallDutyPolicies = policyIdArray.map((id: ObjectID) => {
        const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
        policy.id = id;
        return policy;
      });
    }

    /*
     * IncidentService moves the incident's monitors to this status, as it does
     * for an incident declared in the dashboard or from Slack: with a status
     * timeline entry and owner notifications, and back again once the
     * incident is resolved. Teams used to write currentMonitorStatusId on the
     * monitors directly, which did none of that.
     */
    if (monitorStatusId) {
      incident.changeMonitorStatusToId = monitorStatusId;
    }

    // Save the incident
    const createdIncident: Incident = await IncidentService.create({
      data: incident,
      props: data.props,
    });

    logger.debug(
      "Incident created successfully: " + createdIncident.id?.toString(),
      {
        projectId: projectId.toString(),
        incidentId: createdIncident.id?.toString(),
      },
    );

    return createdIncident;
  }

  private static buildAddIncidentNoteCard(incidentId: string): JSONObject {
    return {
      type: "AdaptiveCard",
      $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
      version: "1.5",
      body: [
        {
          type: "TextBlock",
          text: "Add Incident Note",
          size: "Large",
          weight: "Bolder",
        },
        {
          type: "Input.ChoiceSet",
          id: "noteType",
          label: "Note Type",
          style: "compact",
          value: "public",
          choices: [
            {
              title: "Public Note (Will be posted on Status Page)",
              value: "public",
            },
            {
              title: "Private Note (Only visible to team members)",
              value: "private",
            },
          ],
        },
        {
          type: "Input.Text",
          id: "note",
          label: "Note",
          isMultiline: true,
          placeholder: "Please type in plain text or markdown.",
        },
      ],
      actions: [
        {
          type: "Action.Submit",
          title: "Submit",
          data: {
            action: MicrosoftTeamsIncidentActionType.SubmitIncidentNote,
            actionValue: incidentId,
          },
        },
      ],
    };
  }

  private static async buildExecuteOnCallPolicyCard(
    incidentId: string,
    projectId: ObjectID,
    props: DatabaseCommonInteractionProps,
  ): Promise<JSONObject | null> {
    // The policies the member may read, with their own permissions.
    const onCallPolicies: Array<OnCallDutyPolicy> =
      await WorkspaceActionAuthorization.findReadable({
        service: OnCallDutyPolicyService,
        props: props,
        query: {
          projectId: projectId,
          // Archived policies page no one, so they are not offered.
          isArchived: false,
        },
        select: {
          name: true,
          _id: true,
        },
        limit: 50,
      });

    const choices: Array<{ title: string; value: string }> = onCallPolicies
      .map((policy: OnCallDutyPolicy) => {
        return {
          title: policy.name || "",
          value: policy._id?.toString() || "",
        };
      })
      .filter((choice: { title: string; value: string }) => {
        return choice.title && choice.value;
      });

    if (choices.length === 0) {
      return null;
    }

    return {
      type: "AdaptiveCard",
      $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
      version: "1.5",
      body: [
        {
          type: "TextBlock",
          text: "Execute On-Call Policy",
          size: "Large",
          weight: "Bolder",
        },
        {
          type: "Input.ChoiceSet",
          id: "onCallPolicy",
          label: "On-Call Policy",
          style: "compact",
          choices: choices,
        },
      ],
      actions: [
        {
          type: "Action.Submit",
          title: "Execute",
          data: {
            action:
              MicrosoftTeamsIncidentActionType.SubmitExecuteIncidentOnCallPolicy,
            actionValue: incidentId,
          },
        },
      ],
    };
  }

  /*
   * The card offering the states the incident may move into next, as the
   * member may read them (WorkspaceMemberActions.findStateOptions), in the
   * project's order.
   */
  private static buildChangeIncidentStateCard(
    incidentId: string,
    incidentStates: Array<WorkspaceEventStateOption>,
  ): JSONObject {
    const choices: Array<{ title: string; value: string }> = incidentStates.map(
      (state: WorkspaceEventStateOption) => {
        return {
          title: state.name,
          value: state.id.toString(),
        };
      },
    );

    return {
      type: "AdaptiveCard",
      $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
      version: "1.5",
      body: [
        {
          type: "TextBlock",
          text: "Change Incident State",
          size: "Large",
          weight: "Bolder",
        },
        {
          type: "Input.ChoiceSet",
          id: "incidentState",
          label: "Incident State",
          style: "compact",
          choices: choices,
        },
      ],
      actions: [
        {
          type: "Action.Submit",
          title: "Change",
          data: {
            action: MicrosoftTeamsIncidentActionType.SubmitChangeIncidentState,
            actionValue: incidentId,
          },
        },
      ],
    };
  }

  /*
   * Every list the "Create New Incident" card offers, read in one project as
   * the member the card is for (`props`): only what they may read.
   */
  public static async getNewIncidentFormChoices(
    projectId: ObjectID,
    props: DatabaseCommonInteractionProps,
  ): Promise<MicrosoftTeamsNewIncidentFormChoices> {
    const [severities, monitors, monitorStatuses, labels, onCallDutyPolicies]: [
      MicrosoftTeamsCardChoiceList,
      MicrosoftTeamsCardChoiceList,
      MicrosoftTeamsCardChoiceList,
      MicrosoftTeamsCardChoiceList,
      MicrosoftTeamsCardChoiceList,
    ] = await Promise.all([
      MicrosoftTeamsCardChoices.getIncidentSeverityChoices(projectId, props),
      MicrosoftTeamsCardChoices.getMonitorChoices(projectId, props),
      MicrosoftTeamsCardChoices.getMonitorStatusChoices(projectId, props),
      MicrosoftTeamsCardChoices.getLabelChoices(projectId, props),
      MicrosoftTeamsCardChoices.getOnCallDutyPolicyChoices(projectId, props),
    ]);

    return {
      severities: severities,
      monitors: monitors,
      monitorStatuses: monitorStatuses,
      labels: labels,
      onCallDutyPolicies: onCallDutyPolicies,
    };
  }

  /*
   * The "Create New Incident" card with its monitor, label and on-call policy
   * lists shortened until it fits the budget (issue #4111: listing all of
   * them made Teams refuse the card). Severities are required, so they are
   * never shortened to fit (they are read up to 50).
   */
  public static buildNewIncidentCardForBudget(data: {
    choices: MicrosoftTeamsNewIncidentFormChoices;
    budgetInBytes: number;
    initialTitle?: string | undefined;
    createInOneUptimeUrl?: string | null | undefined;
  }): JSONObject {
    return MicrosoftTeamsCardChoices.fitCardToBudget<
      keyof MicrosoftTeamsNewIncidentFormChoices
    >({
      lists: data.choices,
      trimmableKeys: ["monitors", "labels", "onCallDutyPolicies"],
      budgetInBytes: data.budgetInBytes,
      buildCard: (
        shown: Record<
          keyof MicrosoftTeamsNewIncidentFormChoices,
          MicrosoftTeamsCardChoiceList
        >,
      ): JSONObject => {
        return this.buildNewIncidentCardBody({
          shown: shown,
          initialTitle: data.initialTitle,
          createInOneUptimeUrl: data.createInOneUptimeUrl,
        });
      },
    }).card;
  }

  private static buildNewIncidentCardBody(data: {
    shown: MicrosoftTeamsNewIncidentFormChoices;
    initialTitle?: string | undefined;
    createInOneUptimeUrl?: string | null | undefined;
  }): JSONObject {
    const { shown } = data;
    const initialTitle: string = (data.initialTitle || "").trim();
    let isAnythingLeftOff: boolean = false;

    const addLaterHint: string =
      "You can add them to the incident in OneUptime after it is created.";

    const bodyElements: Array<JSONObject> = [
      {
        type: "TextBlock",
        text: "Create New Incident",
        size: "Large",
        weight: "Bolder",
      },
      {
        type: "Input.Text",
        id: "incidentTitle",
        label: "Incident Title",
        placeholder: "Enter incident title",
        isRequired: true,
        maxLength: MICROSOFT_TEAMS_INCIDENT_TITLE_MAX_LENGTH,
        ...(initialTitle
          ? {
              value: truncateToLength(
                initialTitle,
                MICROSOFT_TEAMS_INCIDENT_TITLE_MAX_LENGTH,
              ),
            }
          : {}),
      },
      {
        type: "Input.Text",
        id: "incidentDescription",
        label: "Incident Description",
        placeholder: "Enter incident description",
        isMultiline: true,
        isRequired: true,
      },
    ];

    const addNotShownNote: (
      list: MicrosoftTeamsCardChoiceList,
      pluralNoun: string,
    ) => void = (
      list: MicrosoftTeamsCardChoiceList,
      pluralNoun: string,
    ): void => {
      const note: JSONObject | null =
        MicrosoftTeamsCardChoices.buildNotShownNoteElement({
          list: list,
          pluralNoun: pluralNoun,
          addLaterHint: addLaterHint,
        });

      if (note) {
        isAnythingLeftOff = true;
        bodyElements.push(note);
      }
    };

    // Add severity dropdown if we have severities
    if (shown.severities.choices.length > 0) {
      bodyElements.push({
        type: "Input.ChoiceSet",
        id: "incidentSeverity",
        label: "Incident Severity",
        style: "compact",
        isRequired: true,
        choices: shown.severities.choices,
      });
    }

    // Add monitor multi-select if we have monitors
    if (shown.monitors.choices.length > 0) {
      bodyElements.push({
        type: "Input.ChoiceSet",
        id: "incidentMonitors",
        label: "Affected Monitors (Optional)",
        style: "compact",
        isMultiSelect: true,
        choices: shown.monitors.choices,
      });
    }

    addNotShownNote(shown.monitors, "monitors");

    // Add monitor status dropdown if we have statuses and monitors
    if (
      shown.monitorStatuses.choices.length > 0 &&
      shown.monitors.choices.length > 0
    ) {
      bodyElements.push({
        type: "Input.ChoiceSet",
        id: "monitorStatus",
        label: "Change Monitor Status To (Optional)",
        style: "compact",
        choices: shown.monitorStatuses.choices,
      });
    }

    // Add on-call policy multi-select if we have policies
    if (shown.onCallDutyPolicies.choices.length > 0) {
      bodyElements.push({
        type: "Input.ChoiceSet",
        id: "onCallDutyPolicies",
        label: "Execute On-Call Policies (Optional)",
        style: "compact",
        isMultiSelect: true,
        choices: shown.onCallDutyPolicies.choices,
      });
    }

    addNotShownNote(shown.onCallDutyPolicies, "on-call policies");

    // Add labels multi-select if we have labels
    if (shown.labels.choices.length > 0) {
      bodyElements.push({
        type: "Input.ChoiceSet",
        id: "labels",
        label: "Labels (Optional)",
        style: "compact",
        isMultiSelect: true,
        choices: shown.labels.choices,
      });
    }

    addNotShownNote(shown.labels, "labels");

    const actions: Array<JSONObject> = [
      {
        type: "Action.Submit",
        title: "Create Incident",
        data: {
          action: MicrosoftTeamsIncidentActionType.SubmitNewIncident,
        },
      },
    ];

    if (isAnythingLeftOff && data.createInOneUptimeUrl) {
      actions.push(
        MicrosoftTeamsCardChoices.buildCreateInOneUptimeAction(
          data.createInOneUptimeUrl,
        ),
      );
    }

    return {
      type: "AdaptiveCard",
      $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
      version: "1.5",
      body: bodyElements,
      actions: actions,
    };
  }
}
