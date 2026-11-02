import PermissionUtil from "../../UI/Utils/Permission";
import ObjectID from "../../Types/ObjectID";
import { UserTenantAccessPermission } from "../../Types/Permission";

/*
 * A Dashboard tab in a test, as far as permissions go.
 *
 * The browser keeps a permission snapshot for each project, and a tab reads
 * the one of the project it shows (Common/UI/Utils/Permission): the project
 * its address names, else the one it was showing, which ProjectUtil keeps
 * in the tab's session storage. A test that seeds a snapshot says which
 * project its tab shows, as a page opened at /dashboard/<id>/... does once
 * it has picked its project.
 */

/*
 * The session storage name ProjectUtil keeps a tab's project under
 * (CURRENT_PROJECT_ID_STORAGE_KEY), written out here so that a test which
 * mocks the Project module can still use this helper.
 * Tests/UI/Utils/PermissionPerProjectSnapshot holds the two names equal.
 */
export const TAB_PROJECT_STORAGE_KEY: string = "current_project_id";

// The tab shows `projectId`.
export function showProjectInTab(projectId: ObjectID | string): void {
  window.sessionStorage.setItem(TAB_PROJECT_STORAGE_KEY, projectId.toString());
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
