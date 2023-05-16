import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import { DropdownOption } from "CommonUI/src/Components/Dropdown/Dropdown";
import ModelAPI, { ListResult } from "CommonUI/src/Utils/ModelAPI/ModelAPI";
import TeamMember from "Model/Models/TeamMember";

export default class ProjectUser {
    public static async fetchProjectUsersAsDropdownOptions(projectId: ObjectID): Promise<Array<DropdownOption>> {
        const teamMembers: ListResult<TeamMember> = await ModelAPI.getList(TeamMember, { projectId }, LIMIT_PER_PROJECT, 0, {
            _id: true
        }, {}, {
            user: {
                _id: true,
                name: true,
                email: true
            }
        });

        return teamMembers.data.map((teamMember: TeamMember) => {
            return {
                value: teamMember.user?._id!,
                label: teamMember.user?.name?.toString() || teamMember.user?.email?.toString() || ""
            }
        });
    } 
}