import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import ProjectUtil from "Common/UI/Utils/Project";

export default class DahboardUserUtil {
  public static getUserLinkInDashboard(userId: ObjectID): Route {
    const projectId: ObjectID = ProjectUtil.getCurrentProjectId() as ObjectID;

    return new Route(
      `/dashboard/${projectId.toString()}/settings/users/${userId.toString()}`,
    );
  }
}
