import ObjectID from "../../../../../Types/ObjectID";
import {
    WorkspaceMessageBlock,
    WorkspaceMessagePayloadButton,
    WorkspacePayloadButtons,
    WorkspacePayloadDivider,
    WorkspacePayloadMarkdown
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import MicrosoftTeamsActionType from "../Actions/ActionTypes"; 
// Assuming Navigator and ProjectUtil are available at these paths. 
// These might need adjustment based on actual project structure.
// import Navigator from '../../../../Utils/Navigation'; // If needed for fallback URL
// import ProjectUtil from '../../../../Utils/Project'; // If getOnCallDutyURL exists

// Placeholder for ProjectUtil if the actual one isn't available or path is different
const ProjectUtil = {
    getOnCallDutyURL: (projectId: ObjectID): URL => {
        // This is a placeholder implementation. Replace with actual utility.
        // For example, using a Navigator-like utility if available:
        // return Navigator.getBaseDashboardUrl(projectId).addPath('/on-call-schedules');
        return new URL(`https://dashboard.oneuptime.com/${projectId.toString()}/on-call-schedules`); // Pure placeholder
    }
};


export default class MicrosoftTeamsOnCallDutyPolicyMessages {
    public static async getOnCallDutyPolicyNotificationMessageBlocks(data: {
        projectId: ObjectID;
        onCallPolicyId?: ObjectID;
        onCallDutyExecutionLogId?: ObjectID;
        title: string;
        description: string;
    }): Promise<Array<WorkspaceMessageBlock>> {
        if (!data.projectId) {
            throw new Error("Project ID is required for On-Call Duty Policy notifications.");
        }
        if (!data.title) {
            throw new Error("Title is required for On-Call Duty Policy notifications.");
        }
        if (!data.description) {
            throw new Error("Description is required for On-Call Duty Policy notifications.");
        }

        const blocks: Array<WorkspaceMessageBlock> = [];

        // Add title as markdown (header)
        const titleBlock: WorkspacePayloadMarkdown = {
            _type: "WorkspacePayloadMarkdown",
            text: `## ${data.title}`, // Using Markdown H2 for title
        };
        blocks.push(titleBlock);

        // Add description as markdown
        const descriptionBlock: WorkspacePayloadMarkdown = {
            _type: "WorkspacePayloadMarkdown",
            text: data.description,
        };
        blocks.push(descriptionBlock);
        
        // Add a divider for visual separation before buttons
        const dividerBlock: WorkspacePayloadDivider = {
            _type: "WorkspacePayloadDivider",
        };
        blocks.push(dividerBlock);


        // Prepare button data
        const buttonDataValue: string = JSON.stringify({
            projectId: data.projectId.toString(),
            onCallPolicyId: data.onCallPolicyId?.toString(),
            onCallDutyExecutionLogId: data.onCallDutyExecutionLogId?.toString(),
        });

        const viewScheduleButton: WorkspaceMessagePayloadButton = {
            _type: "WorkspaceMessagePayloadButton",
            title: "View Schedule",
            // Assuming ProjectUtil.getOnCallDutyURL exists and works as intended.
            // If not, a fallback or more robust URL construction will be needed.
            url: ProjectUtil.getOnCallDutyURL(data.projectId), 
            value: buttonDataValue, // Value can hold context if needed, though URL is primary for OpenUrl
            actionId: MicrosoftTeamsActionType.ViewOnCallSchedule, // This needs to be defined in MicrosoftTeamsActionType
        };
        
        const buttonsBlock: WorkspacePayloadButtons = {
            _type: "WorkspacePayloadButtons",
            buttons: [viewScheduleButton],
        };
        blocks.push(buttonsBlock);

        // Comment regarding the action type
        // TODO: Ensure MicrosoftTeamsActionType.ViewOnCallSchedule is defined in 
        // Common/Server/Utils/Workspace/MicrosoftTeams/Actions/ActionTypes.ts
        // This action will likely be handled as an Action.OpenUrl by the Teams client
        // due to the presence of the 'url' field in the button definition.
        // The 'actionId' and 'value' might be used for tracking or if a different behavior
        // (like a custom invoke) is intended for this button in some scenarios.

        return blocks;
    }
}
