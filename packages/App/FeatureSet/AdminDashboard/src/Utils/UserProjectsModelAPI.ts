import Dictionary from "Common/Types/Dictionary";
import UserProjectsModelAPI from "Common/UI/Utils/ModelAPI/UserProjectsModelAPI";

/*
 * The projects-of-a-user API, called the way the Admin Dashboard calls
 * everything: with no `tenantid` header.
 *
 * The base class picks the header up from the current project, and the Admin
 * Dashboard has none - a master admin is not working inside a project. Same
 * reason AdminModelAPI exists; this is that override applied to the API that
 * backs the User > Projects table.
 */
export default class AdminUserProjectsModelAPI extends UserProjectsModelAPI {
  public static override getCommonHeaders(): Dictionary<string> {
    return {};
  }
}
