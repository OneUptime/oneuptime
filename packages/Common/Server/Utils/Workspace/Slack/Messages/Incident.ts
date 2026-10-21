import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import {
  WorkspaceMessageBlock,
  WorkspacePayloadDivider,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import IncidentService from "../../../../Services/IncidentService";
import SlackActionType from "../../../../Utils/Workspace/Slack/Actions/ActionTypes";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import WorkspaceIncidentActions, {
  WorkspaceIncidentActionIds,
} from "../../WorkspaceIncidentActions";

/*
 * The action ids of an incident's buttons and menu: Slack's, which the
 * Microsoft Teams card drawn from the same blocks presses as well
 * (MicrosoftTeamsIncidentActionType holds the same ids).
 */
export const SLACK_INCIDENT_ACTION_IDS: WorkspaceIncidentActionIds = {
  acknowledge: SlackActionType.AcknowledgeIncident,
  resolve: SlackActionType.ResolveIncident,
  addNote: SlackActionType.ViewAddIncidentNote,
  view: SlackActionType.ViewIncident,
  changeSeverity: SlackActionType.ViewChangeIncidentSeverity,
  changeState: SlackActionType.ViewChangeIncidentState,
  assignRole: SlackActionType.ViewAssignIncidentRole,
  pageSomeone: SlackActionType.ViewPageAboutIncident,
  editCustomFields: SlackActionType.ViewEditIncidentCustomFields,
};

export default class SlackIncidentMessages {
  /*
   * What follows an incident's created message in a channel: a divider,
   * then what responders press most - Acknowledge, Resolve, Add Note, View
   * - and a menu (⋯) of the rest: Change Severity, Change Incident State,
   * Assign Role, Page Someone, Edit Custom Fields
   * (WorkspaceIncidentActions). Microsoft Teams draws its card from the same
   * blocks, with the menu as the card's overflow menu.
   */
  @CaptureSpan()
  public static async getIncidentCreateMessageBlocks(data: {
    incidentId: ObjectID;
    projectId: ObjectID;
  }): Promise<Array<WorkspaceMessageBlock>> {
    if (!data.incidentId) {
      throw new BadDataException("Incident ID is required");
    }

    const dividerBlock: WorkspacePayloadDivider = {
      _type: "WorkspacePayloadDivider",
    };

    return [
      dividerBlock,
      WorkspaceIncidentActions.getButtonsBlock({
        incidentId: data.incidentId,
        incidentLink: await IncidentService.getIncidentLinkInDashboard(
          data.projectId!,
          data.incidentId!,
        ),
        actions: SLACK_INCIDENT_ACTION_IDS,
      }),
    ];
  }
}
