import { MicrosoftTeamsIncidentActionType } from "./ActionTypes";
import MicrosoftTeamsIncidentMoreActions from "./IncidentMoreActions";
import logger from "../../../Logger";
import ObjectID from "../../../../../Types/ObjectID";
import IncidentService from "../../../../Services/IncidentService";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import { TurnContext } from "../Botbuilder";
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
  WorkspaceEventStanding,
  WorkspaceEventStateOption,
  WorkspaceEventStateOptions,
  WorkspaceEventType,
} from "../../WorkspaceMemberActions";
import OnCallPersonPageAnswer from "../../../OnCall/OnCallPersonPageAnswer";
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
import MicrosoftTeamsActionAnswer from "../MicrosoftTeamsActionAnswer";
import WorkspaceHeldPublicNote from "../../WorkspaceHeldPublicNote";
import {
  WorkspaceAnswer,
  WorkspaceLatePress,
} from "../../WorkspaceActionAnswers";
import WorkspaceNoteForm, {
  WORKSPACE_NOTE_FORM_TEXT,
  WorkspaceNoteFormType,
  WorkspaceSubmittedNote,
} from "../../WorkspaceNoteForm";
import { PrivateRecordKind } from "../../../../../Types/StatusPage/PrivateRecordPublicNotes";
import { WorkspaceNoteType } from "../../../../../Types/Workspace/WorkspaceNoteReaction";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../../../Utils/Markdown/FeedMarkdown";
import { LinkedAffectedResource } from "../../../AI/Toolbox/AffectedResourceLinks";
import WorkspaceAffectedResources, {
  WORKSPACE_AFFECTED_RESOURCES_FIELD,
  WORKSPACE_AFFECTED_RESOURCES_TEXT,
  WorkspaceAffectedResourcesToLink,
} from "../../WorkspaceAffectedResources";
import WorkspaceIncidentFromAlert, {
  WORKSPACE_DECLARED_FROM_FIELD,
  WorkspaceAlertNotLinked,
  WorkspaceAlertToLink,
  WorkspaceDeclaringAlert,
} from "../../WorkspaceIncidentFromAlert";
import MicrosoftTeamsAffectedResources from "../MicrosoftTeamsAffectedResources";
import NewIncidentSubscriberNotificationDefaultReader from "../../../StatusPage/NewIncidentSubscriberNotificationDefaultReader";

// Incident.title is a LongText column.
const MICROSOFT_TEAMS_INCIDENT_TITLE_MAX_LENGTH: number = ColumnLength.LongText;

/*
 * The "Create New Incident" card's Affected Resources input: the project it
 * searches, and whether that project's AI is on - its hint says what
 * OneUptime AI does with the picks.
 */
export interface MicrosoftTeamsNewIncidentAffectedResources {
  projectId: ObjectID;
  isAiEnabled: boolean;
}

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
      data.actionType === MicrosoftTeamsIncidentActionType.SubmitNewIncident ||
      // The incident card's menu (…): Change Severity, Assign Role, ...
      MicrosoftTeamsIncidentMoreActions.isAction(data.actionType)
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

    if (MicrosoftTeamsIncidentMoreActions.isAction(actionType)) {
      return await MicrosoftTeamsIncidentMoreActions.handle({
        actionType: actionType,
        actionValue: actionValue,
        value: value,
        projectId: projectId,
        databaseProps: databaseProps,
        turnContext: turnContext,
      });
    }

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
       * Somebody got there first: who and when, to whoever pressed. Paged
       * into it by a person's page, the presser answered that page by
       * pressing (OnCallPersonPageAnswer): it stops, and is said first.
       */
      const standing: WorkspaceEventStanding =
        await WorkspaceMemberActions.getStanding(incident);

      if (standing.isAcknowledged) {
        await MicrosoftTeamsActionAnswer.replyAlready({
          turnContext: turnContext,
          event: incident,
          press: WorkspaceLatePress.Acknowledge,
          answeredPageCount: await OnCallPersonPageAnswer.onAcknowledgePressed({
            kind: "incident",
            recordId: incident.id,
            projectId: incident.projectId,
            pressedByUserId: databaseProps.userId,
            isResolved: standing.isResolved,
          }),
        });
        return;
      }

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

      // Resolved already: who and when, to whoever pressed.
      if ((await WorkspaceMemberActions.getStanding(incident)).isResolved) {
        await MicrosoftTeamsActionAnswer.replyAlready({
          turnContext: turnContext,
          event: incident,
          press: WorkspaceLatePress.Resolve,
        });
        return;
      }

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

      // Not readable to them: why (answered by handleBotInvokeActivity).
      if (!incident) {
        throw await WorkspaceActionAuthorization.getUnreadableRefusal({
          action: "see this incident",
          service: IncidentService,
          id: new ObjectID(actionValue),
          props: databaseProps,
        });
      }

      const declaredAt: Date | undefined =
        incident.declaredAt || incident.createdAt || undefined;
      // The title and the state and severity names are plain text, escaped as MarkdownEscape says a title must be.
      const message: string =
        mdText`**Incident Details**\n\n**Title:** ${incident.title}\n**Description:** ${FeedMarkdown.asChatMarkdown(incident.description || "No description")}\n**State:** ${incident.currentIncidentState?.name || "Unknown"}\n**Severity:** ${incident.incidentSeverity?.name || "Unknown"}\n**Declared At:** ${declaredAt ? new Date(declaredAt).toLocaleString("en-US") : "Unknown"}`.toString();

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

      /*
       * A private incident takes no public notes, so its card asks for no
       * kind and says why (WorkspaceNoteForm).
       */
      const card: JSONObject = this.buildAddIncidentNoteCard({
        incidentId: actionValue,
        isPrivateRecord: ObjectID.isValidUUID(actionValue)
          ? await WorkspaceNoteForm.isPrivateRecord({
              kind: PrivateRecordKind.Incident,
              recordId: new ObjectID(actionValue),
              projectId: projectId,
            })
          : false,
        isPublicNoteApprovalRequired:
          await WorkspaceHeldPublicNote.isApprovalRequired({
            type: WorkspaceEventType.Incident,
            projectId: projectId,
          }),
      });
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

        if (
          noteType !== WorkspaceNoteFormType.Public &&
          noteType !== WorkspaceNoteFormType.Private
        ) {
          await turnContext.sendActivity(
            "Unable to add note: invalid note type.",
          );
          return;
        }

        /*
         * What it writes: a private incident takes no public notes, so a
         * public one asked for on an incident made private since the card
         * was sent is written as a private note - and the answer says so.
         */
        const submitted: WorkspaceSubmittedNote | null =
          await WorkspaceNoteForm.getSubmittedNote({
            submittedNoteType: noteType,
            kind: PrivateRecordKind.Incident,
            recordId: incidentId,
            projectId: projectId,
          });

        if (!submitted) {
          await turnContext.sendActivity(
            "Unable to add note: invalid note type.",
          );
          return;
        }

        const isPublic: boolean =
          submitted.noteType === WorkspaceNoteType.Public;

        await WorkspaceActionAuthorization.assertCanCreate({
          props: databaseProps,
          modelType: isPublic ? IncidentPublicNote : IncidentInternalNote,
          action: isPublic
            ? "add a public note to this incident"
            : "add a private note to this incident",
          resources: [{ service: IncidentService, id: incidentId }],
        });

        // Posted by the member, as the dashboard posts it for them.
        let publicNote: IncidentPublicNote | null = null;

        if (isPublic) {
          publicNote = await IncidentPublicNoteService.addNote({
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

        /*
         * Held for approval: posted to no channel until it is approved, so
         * its answer says it waits, and for whom (WorkspaceHeldPublicNote),
         * rather than that it was added.
         */
        const heldAnswer: WorkspaceAnswer | null =
          await WorkspaceHeldPublicNote.getAnswerForAddedNote({
            event: { type: WorkspaceEventType.Incident, id: incidentId },
            note: publicNote,
            props: databaseProps,
          });

        if (submitted.isPublicAskedOnPrivateRecord) {
          // Not the note they chose: what it became, and why.
          await MicrosoftTeamsActionAnswer.reply({
            turnContext: turnContext,
            answer: await WorkspaceNoteForm.getSavedPrivatelyAnswer({
              kind: PrivateRecordKind.Incident,
              recordId: incidentId,
              props: databaseProps,
            }),
          });
        } else if (heldAnswer) {
          await MicrosoftTeamsActionAnswer.reply({
            turnContext: turnContext,
            answer: heldAnswer,
          });
        } else {
          await MicrosoftTeamsReplies.sendBestEffort(
            turnContext,
            "✅ Note added successfully.",
          );
        }

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
          "No on-call policies are available to you in this project yet. Add one in the OneUptime Dashboard under On-Call > On-Call Policies, or ask a project admin for access to one.",
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

      /*
       * The affected resources picked, read again as the member who submits
       * the card - only what they may view now, of this project, and not
       * archived (WorkspaceAffectedResources) - and, for a card declared in
       * an alert's own channel, that alert, when they may link it
       * (WorkspaceIncidentFromAlert).
       */
      const toLink: WorkspaceAffectedResourcesToLink =
        await WorkspaceAffectedResources.readPicked({
          projectId: projectId,
          props: databaseProps,
          picks: WorkspaceAffectedResources.readPicks(
            value[WORKSPACE_AFFECTED_RESOURCES_FIELD],
          ),
        });

      const fromAlertId: ObjectID | null = WorkspaceIncidentFromAlert.readValue(
        value[WORKSPACE_DECLARED_FROM_FIELD],
      );

      const alertLink: WorkspaceAlertToLink | WorkspaceAlertNotLinked | null =
        fromAlertId
          ? await WorkspaceIncidentFromAlert.checkLink({
              projectId: projectId,
              alertId: fromAlertId,
              props: databaseProps,
            })
          : null;

      const linkedAlert: WorkspaceAlertToLink | null =
        alertLink && WorkspaceIncidentFromAlert.isLinked(alertLink)
          ? alertLink
          : null;

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
          affectedResources: toLink.linked,
          alert: linkedAlert,
          // Private like its alert, linked or not (WorkspaceIncidentFromAlert).
          isPrivate: alertLink?.isPrivate === true,
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
          incidentNumber: this.getIncidentNumberText(createdIncident),
          linkedLine: WorkspaceAffectedResources.getLinkedLine({
            linked: toLink.linked,
            alert: linkedAlert?.name,
          }),
        }),
      );
      await MicrosoftTeamsReplies.deleteBestEffort(
        turnContext,
        turnContext.activity.replyToId,
      );

      // What was picked and not linked: a reply to whoever submitted it.
      await this.answerNotLinked({
        turnContext: turnContext,
        projectId: projectId,
        incident: createdIncident,
        notLinkedCount: toLink.notLinkedCount,
        alertNotLinked:
          alertLink && !WorkspaceIncidentFromAlert.isLinked(alertLink)
            ? alertLink
            : null,
      });
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

  /*
   * The confirmation: the incident by its number, as Slack's names it -
   * "✅ Incident INC-43 created successfully. View incident" - with a link
   * to it when one can be built, and what it is linked to
   * (WorkspaceAffectedResources.getLinkedLine). The link is words, not the
   * address itself, which ran past a phone's screen.
   */
  public static async getIncidentCreatedMessage(data: {
    projectId: ObjectID;
    incidentId?: ObjectID | undefined;
    // "INC-43", or "#43" in a project without a prefix; null for none.
    incidentNumber?: string | null | undefined;
    linkedLine?: MarkdownText | null | undefined;
  }): Promise<string> {
    const linked: MarkdownText = data.linkedLine
      ? mdText`\n\n${data.linkedLine}`
      : FeedMarkdown.empty();

    const created: MarkdownText = data.incidentNumber
      ? mdText`✅ **Incident ${data.incidentNumber}** created successfully.`
      : mdText`✅ Incident created successfully.`;

    if (data.incidentId) {
      try {
        const incidentLink: URL =
          await IncidentService.getIncidentLinkInDashboard(
            data.projectId,
            data.incidentId,
          );

        return mdText`${created} [View incident](${incidentLink.toString()})${linked}`.toString();
      } catch (error) {
        logger.debug("Could not build the link to a new incident");
        logger.debug(error);
      }
    }

    return mdText`${created}${linked}`.toString();
  }

  // An incident's number as people read it: "INC-43", or "#43"; null for none.
  private static getIncidentNumberText(incident: Incident): string | null {
    if (incident.incidentNumberWithPrefix) {
      return incident.incidentNumberWithPrefix;
    }

    return incident.incidentNumber !== undefined &&
      incident.incidentNumber !== null
      ? `#${incident.incidentNumber}`
      : null;
  }

  /*
   * Tells whoever submitted the card what they picked and is not linked - a
   * resource deleted or archived since they picked it, or no longer one
   * they may view, and the alert of the channel when they may not link it -
   * in a reply that mentions them (Microsoft Teams has no message only one
   * person sees; WorkspaceIncidentFromAlert.getNotLinkedAnswer). The
   * incident is declared all the same. Nothing when everything was linked.
   */
  private static async answerNotLinked(data: {
    turnContext: TurnContext;
    projectId: ObjectID;
    incident: Incident;
    notLinkedCount: number;
    alertNotLinked: WorkspaceAlertNotLinked | null;
  }): Promise<void> {
    const answer: WorkspaceAnswer | null =
      await WorkspaceIncidentFromAlert.readNotLinkedAnswer({
        projectId: data.projectId,
        incident: data.incident,
        notLinkedCount: data.notLinkedCount,
        alertNotLinked: data.alertNotLinked,
      });

    if (!answer) {
      return;
    }

    await MicrosoftTeamsActionAnswer.reply({
      turnContext: data.turnContext,
      answer: answer,
    });
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
    // The affected resources, as the member read them (readPicked).
    affectedResources?: Array<LinkedAffectedResource> | undefined;
    // The alert it is declared from, when the member may link it.
    alert?: WorkspaceAlertToLink | null | undefined;
    // Declared from a private alert, linked or not.
    isPrivate?: boolean | undefined;
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
    /*
     * No root cause until somebody knows one: the incident names the member
     * who declared it already (WhoOpenedItRootCause).
     */

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

    // What OneUptime AI investigates and fixes.
    WorkspaceAffectedResources.setOnIncident(
      incident,
      data.affectedResources || [],
    );

    // A private alert's incident is private, as the Dashboard declares it.
    if (data.alert?.isPrivate || data.isPrivate) {
      incident.isPrivate = true;
    }

    /*
     * The card asks nothing about status page subscribers, so they are told
     * as the project starts "Notify Status Page Subscribers" on Declare New
     * Incident (Incidents > Settings > Subscriber Notifications): unticked
     * there, declared here without notifying.
     */
    await NewIncidentSubscriberNotificationDefaultReader.applyToIncidentDeclaredWithoutBox(
      {
        incident: incident,
        projectId: projectId,
      },
    );

    // Save the incident - linked to its alert, as one declared from it.
    const createdIncident: Incident = await IncidentService.create({
      data: incident,
      props: data.props,
      ...(data.alert ? { miscDataProps: data.alert.miscDataProps } : {}),
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

  /*
   * The Add Note card: the note's kind and the note. A private incident
   * takes no public notes (WorkspaceNoteForm): its card is "Add Private
   * Note", says why in one line, asks for no kind, and sends a private note.
   */
  public static buildAddIncidentNoteCard(data: {
    incidentId: string;
    isPrivateRecord: boolean;
    // The project asks for public notes to be approved (WorkspaceNoteForm.getPublicOption).
    isPublicNoteApprovalRequired?: boolean | undefined;
  }): JSONObject {
    const noteInput: JSONObject = {
      type: "Input.Text",
      id: "note",
      label: WORKSPACE_NOTE_FORM_TEXT.noteLabel,
      isMultiline: true,
      placeholder: WORKSPACE_NOTE_FORM_TEXT.noteDescription,
    };

    if (data.isPrivateRecord) {
      return {
        type: "AdaptiveCard",
        $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
        version: "1.5",
        body: [
          {
            type: "TextBlock",
            text: WORKSPACE_NOTE_FORM_TEXT.privateTitle,
            size: "Large",
            weight: "Bolder",
          },
          {
            type: "TextBlock",
            text: WorkspaceNoteForm.getPrivateRecordLine(
              PrivateRecordKind.Incident,
            ),
            wrap: true,
          },
          noteInput,
        ],
        actions: [
          {
            type: "Action.Submit",
            title: WORKSPACE_NOTE_FORM_TEXT.submit,
            data: {
              action: MicrosoftTeamsIncidentActionType.SubmitIncidentNote,
              actionValue: data.incidentId,
              noteType: WorkspaceNoteFormType.Private,
            },
          },
        ],
      };
    }

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
          label: WORKSPACE_NOTE_FORM_TEXT.noteTypeLabel,
          style: "compact",
          value: WorkspaceNoteFormType.Public,
          choices: [
            {
              title: WorkspaceNoteForm.getPublicOption(
                Boolean(data.isPublicNoteApprovalRequired),
              ),
              value: WorkspaceNoteFormType.Public,
            },
            {
              title: WorkspaceNoteForm.getRecordPrivateOption(
                PrivateRecordKind.Incident,
              ),
              value: WorkspaceNoteFormType.Private,
            },
          ],
        },
        noteInput,
      ],
      actions: [
        {
          type: "Action.Submit",
          title: WORKSPACE_NOTE_FORM_TEXT.submit,
          data: {
            action: MicrosoftTeamsIncidentActionType.SubmitIncidentNote,
            actionValue: data.incidentId,
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
    /*
     * The Affected Resources input, searched in this project as the person
     * types; left out when not given (MicrosoftTeamsAffectedResources).
     */
    affectedResources?: MicrosoftTeamsNewIncidentAffectedResources | undefined;
    // The open alert of the channel the card is declared in.
    declaringAlert?: WorkspaceDeclaringAlert | null | undefined;
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
          affectedResources: data.affectedResources,
          declaringAlert: data.declaringAlert,
        });
      },
    }).card;
  }

  private static buildNewIncidentCardBody(data: {
    shown: MicrosoftTeamsNewIncidentFormChoices;
    initialTitle?: string | undefined;
    createInOneUptimeUrl?: string | null | undefined;
    affectedResources?: MicrosoftTeamsNewIncidentAffectedResources | undefined;
    declaringAlert?: WorkspaceDeclaringAlert | null | undefined;
  }): JSONObject {
    const { shown } = data;
    const initialTitle: string = (
      data.initialTitle ||
      data.declaringAlert?.title ||
      ""
    ).trim();
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
    ];

    // The alert it is declared from, said first.
    if (data.declaringAlert) {
      bodyElements.push({
        type: "TextBlock",
        text: WorkspaceIncidentFromAlert.getFormLine(
          data.declaringAlert,
        ).toString(),
        wrap: true,
      });
    }

    bodyElements.push(
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
    );

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

    /*
     * What the incident is about - its hosts, clusters, databases, cloud
     * resources and services - which OneUptime AI investigates and fixes:
     * the first of the optional inputs, as it pauses nothing. Searched as
     * the person types, as the member (MicrosoftTeamsAffectedResources).
     */
    if (data.affectedResources) {
      bodyElements.push(
        ...MicrosoftTeamsAffectedResources.getInputElements({
          projectId: data.affectedResources.projectId,
          initial: data.declaringAlert?.resources || [],
          isAiEnabled: data.affectedResources.isAiEnabled,
        }),
      );
    }

    /*
     * Picked on purpose only, never filled in: a monitor linked to an
     * incident a person declares pauses its checks until the incident is
     * resolved, which the line under it says.
     */
    if (shown.monitors.choices.length > 0) {
      bodyElements.push(
        {
          type: "Input.ChoiceSet",
          id: "incidentMonitors",
          label: "Affected Monitors (Optional)",
          style: "compact",
          isMultiSelect: true,
          choices: shown.monitors.choices,
        },
        // What a pick here does, right under the list.
        MicrosoftTeamsCardChoices.buildNoteElement(
          WORKSPACE_AFFECTED_RESOURCES_TEXT.monitorsHint,
        ),
      );
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

    /*
     * The button carries the alert the card is declared from, for its
     * submission to read again as whoever submits it.
     */
    const actions: Array<JSONObject> = [
      {
        type: "Action.Submit",
        title: "Create Incident",
        data: {
          action: MicrosoftTeamsIncidentActionType.SubmitNewIncident,
          ...(data.declaringAlert
            ? {
                [WORKSPACE_DECLARED_FROM_FIELD]:
                  WorkspaceIncidentFromAlert.toValue(
                    data.declaringAlert.alertId,
                  ),
              }
            : {}),
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
