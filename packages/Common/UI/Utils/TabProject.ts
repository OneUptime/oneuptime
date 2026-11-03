import { JSONValue } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import LocalStorage from "./LocalStorage";
import Navigation from "./Navigation";
import SessionStorage from "./SessionStorage";

/**
 * Session storage key that pins a browser tab to the project it is showing.
 * Session storage (and not local storage) so two tabs can show two different
 * projects at the same time.
 */
export const CURRENT_PROJECT_ID_STORAGE_KEY: string = "current_project_id";

/**
 * Local storage key that remembers the last project the user opened on this
 * browser. Unlike {@link CURRENT_PROJECT_ID_STORAGE_KEY} this survives closing
 * the tab, which is what makes the dashboard reopen on the project the user
 * left off on instead of always falling back to the first project.
 */
export const LAST_ACCESSED_PROJECT_ID_STORAGE_KEY: string =
  "last_accessed_project_id";

/*
 * THE PROJECT ONE DASHBOARD TAB SHOWS - the project every request of the tab
 * names in its tenantid header (ProjectUtil.getCurrentProjectId, which reads
 * it here), and the project whose permission snapshot the tab's buttons
 * follow (UI/Utils/Permission).
 *
 * Kept apart from ProjectUtil, which brings the Project model, the request
 * client and telemetry with it: the permission snapshot is read on the way
 * of every request, and the sign-in pages and status pages make requests
 * too, with none of those. It reads the address through Navigation, which
 * imports react-router-dom: not a module for code that must load without
 * React (App's tests install none).
 */
export default class TabProject {
  /**
   * The project this tab shows, resolved in priority order:
   *
   * 1. `/dashboard/:projectId/...` in the URL - the page the user actually
   *    opened, so a deep link always wins over anything we have cached.
   * 2. `current_project_id` in session storage - keeps this tab on the project
   *    it was already showing while the user moves around routes that do not
   *    carry a project id (e.g. `/dashboard`).
   * 3. `last_accessed_project_id` in local storage - the project this user last
   *    opened on this browser, so closing the tab and coming back to
   *    `/dashboard` reopens that project rather than the first one.
   */
  public static getProjectId(): ObjectID | null {
    return (
      this.getProjectIdFromUrl() ||
      this.getProjectIdInSession() ||
      this.getLastAccessedProjectId()
    );
  }

  /**
   * The project id in the current URL, if the user is on a project scoped route
   * like `/dashboard/:projectId/...`. Returns null on routes that carry no
   * project id (`/dashboard`, `/dashboard/welcome`, ...).
   */
  public static getProjectIdFromUrl(): ObjectID | null {
    if (Navigation.getFirstParam(1) !== "dashboard") {
      return null;
    }

    const projectId: string | undefined = Navigation.getFirstParam(2);

    if (!projectId || projectId.includes(":projectId")) {
      return null;
    }

    return this.toProjectId(projectId);
  }

  // The project this tab picked before, kept in its own session storage.
  public static getProjectIdInSession(): ObjectID | null {
    return this.toProjectId(
      SessionStorage.getItem(CURRENT_PROJECT_ID_STORAGE_KEY),
    );
  }

  /**
   * The last project this user opened on this browser. Persisted in local
   * storage so it outlives the tab. It is cleared on logout (which clears all
   * of local storage) and when the project is deleted.
   */
  public static getLastAccessedProjectId(): ObjectID | null {
    return this.toProjectId(
      LocalStorage.getItem(LAST_ACCESSED_PROJECT_ID_STORAGE_KEY),
    );
  }

  // A project id, or null for anything that is not a real one.
  public static toProjectId(
    value: JSONValue | ObjectID | string | null | undefined,
  ): ObjectID | null {
    const id: string | undefined = value?.toString();

    if (id && ObjectID.isValidUUID(id)) {
      return new ObjectID(id);
    }

    return null;
  }
}
