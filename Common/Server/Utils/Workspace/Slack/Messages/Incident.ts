import Incident from "../../../../../Models/DatabaseModels/Incident";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import {
  WorkspaceMessageBlock,
  WorkspaceMessagePayloadButton,
  WorkspacePayloadButtons,
  WorkspacePayloadDivider,
  WorkspacePayloadHeader,
  WorkspacePayloadMarkdown,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import IncidentService from "../../../../Services/IncidentService";
import MonitorService from "../../../../Services/MonitorService";
import SlackActionType from "../../../../Utils/Workspace/Slack/Actions/ActionTypes";

export default class SlackIncidentMessages {
  public static async getIncidentCreateMessageBlocks(data: {
    incident: Incident;
  }): Promise<Array<WorkspaceMessageBlock>> {
    const incident: Incident = data.incident;

    if (!incident) {
      throw new BadDataException("Incident not found");
    }

    // Slack.

    const blockSlack: Array<WorkspaceMessageBlock> = [];

    if (incident.incidentNumber) {
      const markdownBlock1: WorkspacePayloadHeader = {
        _type: "WorkspacePayloadHeader",
        text: `:rotating_light: Incident #${incident.incidentNumber}`,
      };
      blockSlack.push(markdownBlock1);
    }

    if (incident.title) {
      const markdownBlock2: WorkspacePayloadMarkdown = {
        _type: "WorkspacePayloadMarkdown",
        text: `**[${incident.title}](${(await IncidentService.getIncidentLinkInDashboard(incident.projectId!, incident.id!)).toString()})**`,
      };
      blockSlack.push(markdownBlock2);
    }

    if (incident.description) {
      const markdownBlock3: WorkspacePayloadMarkdown = {
        _type: "WorkspacePayloadMarkdown",
        text: `${incident.description}`,
      };
      blockSlack.push(markdownBlock3);
    }

    if (incident.currentIncidentState?.name) {
      const markdownBlock7: WorkspacePayloadMarkdown = {
        _type: "WorkspacePayloadMarkdown",
        text: `:arrow_right: **Incident State**: ${incident.currentIncidentState.name}`,
      };
      blockSlack.push(markdownBlock7);
    }

    if (incident.incidentSeverity?.name) {
      const markdownBlock4: WorkspacePayloadMarkdown = {
        _type: "WorkspacePayloadMarkdown",
        text: `:warning: **Severity**: ${incident.incidentSeverity.name}`,
      };
      blockSlack.push(markdownBlock4);
    }

    // check for monitors.
    if (incident.monitors && incident.monitors.length > 0) {
      let text: string = `:earth_americas: **Resources Affected**:\n`;

      for (const monitor of incident.monitors) {
        text += `- [${monitor.name}](${(await MonitorService.getMonitorLinkInDashboard(incident.projectId!, monitor.id!)).toString()})\n`;
      }

      // now add text to markdwon block.
      const markdownBlock5: WorkspacePayloadMarkdown = {
        _type: "WorkspacePayloadMarkdown",
        text: text,
      };

      blockSlack.push(markdownBlock5);
    }

    if (incident.rootCause) {
      const markdownBlock5: WorkspacePayloadMarkdown = {
        _type: "WorkspacePayloadMarkdown",
        text: `:page_facing_up: **Root Cause**:
        ${incident.rootCause}`,
      };
      blockSlack.push(markdownBlock5);
    }

    if (incident.remediationNotes) {
      const markdownBlock6: WorkspacePayloadMarkdown = {
        _type: "WorkspacePayloadMarkdown",
        text: `:dart: **Remediation Notes**:
        ${incident.remediationNotes}`,
      };
      blockSlack.push(markdownBlock6);
    }

    // add divider.

    const dividerBlock: WorkspacePayloadDivider = {
      _type: "WorkspacePayloadDivider",
    };

    blockSlack.push(dividerBlock);

    // now add buttons.
    // View Incident.
    // Execute On Call
    // Acknowledge incident
    // Resolve Incident.
    // Change Incident State.
    // Add Note.

    const buttons: Array<WorkspaceMessagePayloadButton> = [];

    // view incident.
    const viewIncidentButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: "View Incident",
      url: await IncidentService.getIncidentLinkInDashboard(
        incident.projectId!,
        incident.id!,
      ),
      value: "view_incident",
      actionId: SlackActionType.ViewIncident,
    };

    buttons.push(viewIncidentButton);

    // execute on call.
    const executeOnCallButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: ":telephone_receiver: Execute On Call",
      value: "execute_on_call",
      actionId: SlackActionType.ExecuteIncidentOnCallPolicy,
    };

    buttons.push(executeOnCallButton);

    // acknowledge incident.
    const acknowledgeIncidentButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: ":eyes: Acknowledge Incident",
      value: "acknowledge_incident",
      actionId: SlackActionType.AcknowledgeIncident,
    };

    buttons.push(acknowledgeIncidentButton);

    // resolve incident.
    const resolveIncidentButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: ":white_check_mark: Resolve Incident",
      value: "resolve_incident",
      actionId: SlackActionType.ResolveIncident,
    };

    buttons.push(resolveIncidentButton);

    // change incident state.
    const changeIncidentStateButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: ":arrow_right: Change Incident State",
      value: "change_incident_state",
      actionId: SlackActionType.ChangeIncidentState,
    };

    buttons.push(changeIncidentStateButton);

    // add note.
    const addNoteButton: WorkspaceMessagePayloadButton = {
      _type: "WorkspaceMessagePayloadButton",
      title: ":page_facing_up: Add Note",
      value: "add_note",
      actionId: SlackActionType.AddIncidentNote,
    };

    buttons.push(addNoteButton);

    const workspacePayloadButtons: WorkspacePayloadButtons = {
      buttons: buttons,
      _type: "WorkspacePayloadButtons",
    };

    blockSlack.push(workspacePayloadButtons);

    return blockSlack;
  }
}
