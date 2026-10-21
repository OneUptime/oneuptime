import { MicrosoftTeamsOnCallDutyActionType } from "./ActionTypes";
import logger from "../../../Logger";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import { TurnContext } from "botbuilder";
import { JSONObject, JSONValue } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import OnCallDutyPolicyService from "../../../../Services/OnCallDutyPolicyService";
import OnCallDutyPolicy from "../../../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyExecutionLog from "../../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import WorkspaceMemberActions, {
  WorkspaceEvent,
  WorkspaceEventRecord,
  WorkspaceEventType,
} from "../../WorkspaceMemberActions";
import MicrosoftTeamsReplies from "../MicrosoftTeamsReplies";
import FeedMarkdown, {
  mdText,
} from "../../../../../Utils/Markdown/FeedMarkdown";

// The payload key an Escalate card names its record under, and its kind.
const ESCALATION_RECORD_KEYS: ReadonlyArray<[string, WorkspaceEventType]> = [
  ["incidentId", WorkspaceEventType.Incident],
  ["alertId", WorkspaceEventType.Alert],
  ["incidentEpisodeId", WorkspaceEventType.IncidentEpisode],
  ["alertEpisodeId", WorkspaceEventType.AlertEpisode],
];

export default class MicrosoftTeamsOnCallDutyActions {
  @CaptureSpan()
  public static isOnCallDutyAction(data: { actionType: string }): boolean {
    return (
      data.actionType === MicrosoftTeamsOnCallDutyActionType.ViewOnCallDuty ||
      data.actionType === MicrosoftTeamsOnCallDutyActionType.EscalateOnCall
    );
  }

  /*
   * Escalating needs the record the page is for: an execution of a policy
   * is always triggered by an incident, an alert or an episode, as one run
   * from the record's own Execute On-Call Policy is. A card with none is
   * answered with this, and nothing is paged.
   */
  public static readonly ESCALATE_NEEDS_RECORD_MESSAGE: string =
    "This on-call policy can only be executed for an incident, an alert or an episode. Open the record you are paging about and use Execute On-Call Policy there.";

  /*
   * The record a card's Escalate is for, from its payload: `incidentId`,
   * `alertId`, `incidentEpisodeId` or `alertEpisodeId`. Null for a card
   * that names none - or more than one, which is no card OneUptime sends.
   */
  public static getEscalationRecord(
    actionPayload: JSONObject,
  ): WorkspaceEvent | null {
    const records: Array<WorkspaceEvent> = [];

    for (const [key, type] of ESCALATION_RECORD_KEYS) {
      const value: JSONValue | undefined = actionPayload[key];

      if (value) {
        records.push({
          type: type,
          id: new ObjectID(value.toString()),
        });
      }
    }

    return records.length === 1 ? records[0]! : null;
  }

  /*
   * A card's on-call policy actions, run as the member who pressed the button
   * (`databaseProps`, a current member of `projectId`, as
   * handleBotInvokeActivity builds them): the policy is read in their project
   * with their own permissions - one of another project, or outside their
   * read, is answered like one that does not exist. Escalating executes it
   * for the card's incident, alert or episode as the member, as that
   * record's Execute On-Call Policy does (WorkspaceMemberActions): it needs
   * their permission to execute an on-call policy and their read of the
   * record and the policy.
   */
  @CaptureSpan()
  public static async handleBotOnCallDutyAction(data: {
    actionType: MicrosoftTeamsOnCallDutyActionType;
    turnContext: TurnContext;
    actionPayload: JSONObject;
    projectId: ObjectID;
    databaseProps: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const { actionType, turnContext, actionPayload, projectId, databaseProps } =
      data;

    try {
      const policyIdValue: JSONValue = actionPayload["onCallDutyPolicyId"];

      if (!policyIdValue) {
        logger.error("OnCallDutyPolicy ID is required", {
          actionType: actionType,
        });
        await turnContext.sendActivity("OnCallDutyPolicy ID is required");
        return;
      }

      const onCallDutyPolicyId: ObjectID = new ObjectID(
        policyIdValue.toString(),
      );

      // The card's record, as the check below read it for the member.
      let escalationRecord: WorkspaceEventRecord | null = null;

      if (actionType === MicrosoftTeamsOnCallDutyActionType.EscalateOnCall) {
        const cardRecord: WorkspaceEvent | null =
          this.getEscalationRecord(actionPayload);

        if (!cardRecord) {
          await turnContext.sendActivity(
            MicrosoftTeamsOnCallDutyActions.ESCALATE_NEEDS_RECORD_MESSAGE,
          );
          return;
        }

        escalationRecord = await WorkspaceMemberActions.authorize({
          props: databaseProps,
          modelType: OnCallDutyPolicyExecutionLog,
          action: `execute this on-call policy for this ${WorkspaceMemberActions.getNoun(cardRecord.type)}`,
          event: cardRecord,
          resources: [
            { service: OnCallDutyPolicyService, id: onCallDutyPolicyId },
          ],
        });
      }

      const onCallDutyPolicy: OnCallDutyPolicy | null =
        await OnCallDutyPolicyService.findOneBy({
          query: {
            _id: onCallDutyPolicyId.toString(),
            projectId: projectId,
          },
          select: {
            _id: true,
            name: true,
            description: true,
          },
          props: databaseProps,
        });

      if (!onCallDutyPolicy) {
        logger.error("OnCallDutyPolicy not found", {
          onCallDutyPolicyId: onCallDutyPolicyId.toString(),
        });
        await turnContext.sendActivity("OnCallDutyPolicy not found");
        return;
      }

      switch (actionType) {
        case MicrosoftTeamsOnCallDutyActionType.ViewOnCallDuty:
          await turnContext.sendActivity(
            mdText`**${onCallDutyPolicy.name}**\n\n${FeedMarkdown.asChatMarkdown(onCallDutyPolicy.description || "No description")}`.toString(),
          );
          break;

        case MicrosoftTeamsOnCallDutyActionType.EscalateOnCall:
          /*
           * Executed by the member for the card's record, as the record's
           * own Execute On-Call Policy executes it for them.
           */
          await WorkspaceMemberActions.executeOnCallPolicy({
            event: escalationRecord!,
            onCallDutyPolicyId: onCallDutyPolicyId,
            props: databaseProps,
          });
          await turnContext.sendActivity(
            "On-call policy escalated successfully",
          );
          break;

        default:
          logger.error(`Unknown action type: ${actionType}`, {
            onCallDutyPolicyId: onCallDutyPolicyId.toString(),
            actionType: actionType,
          });
          await turnContext.sendActivity("Unknown action type");
          break;
      }
    } catch (error) {
      /*
       * A refusal is written for the member - their permissions, the plan, a
       * record that is not theirs to page for: handleBotInvokeActivity tells
       * them.
       */
      if (
        error instanceof NotAuthorizedException ||
        MicrosoftTeamsReplies.getUserFacingErrorMessage(error)
      ) {
        throw error;
      }

      logger.error(`Error handling on-call duty action: ${error}`, {
        actionType: actionType,
      });
      await turnContext.sendActivity(
        "An error occurred while processing the action",
      );
    }
  }
}
