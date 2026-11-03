import PermissionUtil from "../../UI/Utils/Permission";
import { CURRENT_PROJECT_ID_STORAGE_KEY } from "../../UI/Utils/TabProject";
import ObjectID from "../../Types/ObjectID";
import { UserTenantAccessPermission } from "../../Types/Permission";

/*
 * A Dashboard tab in a test, as far as permissions go.
 *
 * The browser keeps a permission snapshot for each project, and a tab reads
 * the one of the project it shows (Common/UI/Utils/Permission): the project
 * its address names, else the one it was showing, kept in the tab's session
 * storage (Common/UI/Utils/TabProject). A test that seeds a snapshot says
 * which project its tab shows, as a page opened at /dashboard/<id>/... does
 * once it has picked its project. A test that mocks ProjectUtil still says
 * it here: the permission snapshot is read through TabProject.
 */

// The tab shows `projectId`.
export function showProjectInTab(projectId: ObjectID | string): void {
  window.sessionStorage.setItem(
    CURRENT_PROJECT_ID_STORAGE_KEY,
    projectId.toString(),
  );
}

/*
 * What the API's permission headers leave for a project, read in a tab that
 * shows that project.
 */
export function keepProjectPermissionsInTab(
  permissions: UserTenantAccessPermission,
): void {
  showProjectInTab(permissions.projectId);
  PermissionUtil.setProjectPermissions(permissions);
}
