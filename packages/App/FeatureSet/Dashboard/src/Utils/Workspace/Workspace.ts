import WorkspaceProjectAuthToken from "Common/Models/DatabaseModels/WorkspaceProjectAuthToken";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";

export default class WorkspaceUtil {
  public static async isWorkspaceConnected(
    workspaceType: WorkspaceType,
  ): Promise<boolean> {
    // check if the project is already connected with slack.
    const projectAuth: ListResult<WorkspaceProjectAuthToken> =
      await ModelAPI.getList<WorkspaceProjectAuthToken>({
        modelType: WorkspaceProjectAuthToken,
        query: {
          projectId: ProjectUtil.getCurrentProjectId()!,
          workspaceType: workspaceType,
        },
        select: {
          _id: true,
          miscData: true,
        },
        limit: 1,
        skip: 0,
        sort: {
          createdAt: SortOrder.Descending,
        },
      });

    if (projectAuth.data.length > 0) {
      return true;
    }

    return false;
  }
}
