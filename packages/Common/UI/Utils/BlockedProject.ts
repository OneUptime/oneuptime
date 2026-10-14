import type Project from "../../Models/DatabaseModels/Project";

/*
 * A project a master admin blocked, as the Dashboard sees it. Every request
 * for it is refused with a 403 that says so (ProjectBlockedException); the
 * project list marks it (Project.isBlocked); and the Dashboard shows its
 * members why, in place of its pages, rather than the Forbidden page.
 *
 * A module of its own, with nothing but types imported: the API client
 * raises the event, and suites that replace ProjectUtil with a stand-in
 * still render the Dashboard.
 */
export default class BlockedProject {
  /**
   * Raised on the window when a request is refused because a master admin
   * blocked the project it was for, instead of the client sending the
   * person to the Forbidden page (API.handleError). The request was for the
   * current project (ProjectUtil.getCurrentProjectId).
   */
  public static readonly REFUSED_EVENT: string = "PROJECT_BLOCKED";

  /**
   * Whether the selected project is one a master admin blocked: as the
   * project list says, when it has the project - the copy of the project
   * kept in local storage may be from before a block or an unblock - or as
   * the stored copy says until the list loads; or because a request for it
   * this visit was refused as blocked (REFUSED_EVENT).
   */
  public static isSelectedProjectBlocked(data: {
    selectedProject: Project | null | undefined;
    projects: Array<Project>;
    blockedProjectIds: Array<string>;
  }): boolean {
    const selectedProjectId: string | undefined =
      data.selectedProject?._id?.toString();

    if (!selectedProjectId) {
      return false;
    }

    if (data.blockedProjectIds.includes(selectedProjectId)) {
      return true;
    }

    const listedProject: Project | undefined = data.projects.find(
      (project: Project): boolean => {
        return project?._id?.toString() === selectedProjectId;
      },
    );

    return (listedProject || data.selectedProject)?.isBlocked === true;
  }
}
