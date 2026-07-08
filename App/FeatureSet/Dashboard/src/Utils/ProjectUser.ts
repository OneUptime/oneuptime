import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";

export default class ProjectUser {
  public static async fetchProjectUsersAsDropdownOptions(
    projectId: ObjectID,
  ): Promise<Array<DropdownOption>> {
    const teamMembers: ListResult<TeamMember> = await ModelAPI.getList({
      modelType: TeamMember,
      query: { projectId },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: {
        _id: true,
        user: {
          _id: true,
          name: true,
          email: true,
        },
      },
      sort: {},
      requestOptions: {},
    });

    /*
     * A user can belong to more than one team in the same project, which
     * returns one TeamMember row per membership. Dedupe by user id so each
     * user appears exactly once in the dropdown.
     */
    const seenUserIds: Set<string> = new Set<string>();
    const options: Array<DropdownOption> = [];

    for (const teamMember of teamMembers.data) {
      const userId: string | undefined = teamMember.user?._id?.toString();

      if (!userId || seenUserIds.has(userId)) {
        continue;
      }

      seenUserIds.add(userId);

      options.push({
        value: userId,
        label:
          teamMember.user?.name?.toString() ||
          teamMember.user?.email?.toString() ||
          "",
      });
    }

    // Alphabetical order so the searchable dropdown is easy to scan.
    options.sort((a: DropdownOption, b: DropdownOption) => {
      return a.label.localeCompare(b.label);
    });

    return options;
  }
}
