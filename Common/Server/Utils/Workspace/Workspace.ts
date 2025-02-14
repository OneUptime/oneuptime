import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import WorkspaceBase from "./WorkspaceBase";
import SlackWorkspace from "./Slack/Slack";
import MicrosoftTeamsWorkspace from "./MicrosoftTeams/MicrosoftTeams";
import BadDataException from "../../../Types/Exception/BadDataException";

export default class Workspace { 
    public static getWorkspaceTypeUtil(workspaceType: WorkspaceType): typeof WorkspaceBase { 
        if(workspaceType === WorkspaceType.Slack){
            return SlackWorkspace; 
        }

        if(workspaceType === WorkspaceType.MicrosoftTeams){
            return MicrosoftTeamsWorkspace; 
        }

        throw new BadDataException(`Workspace type ${workspaceType} is not supported`);
    }   
}