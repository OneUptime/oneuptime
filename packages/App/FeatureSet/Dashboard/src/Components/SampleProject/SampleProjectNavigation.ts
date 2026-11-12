import PageMap from "../../Utils/PageMap";
import RouteMap from "../../Utils/RouteMap";
import RouteParams from "../../Utils/RouteParams";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Project from "Common/Models/DatabaseModels/Project";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";

/*
 * Moving between a sample project (issue #6808) and the person's own.
 *
 * A real page load, never a client-side route change, as accepting an
 * invitation does (Pages/Onboarding/Welcome): the Dashboard read the
 * person's projects when it started, and a sample just made - or one just
 * deleted - is not in that list. Loading the app again puts the right
 * projects in front of them.
 */

// The project to go back to from a sample: the person's first real one.
export const getProjectToGoBackTo: (
  projects: ReadonlyArray<Project>,
) => Project | null = (projects: ReadonlyArray<Project>): Project | null => {
  return (
    projects.find((project: Project): boolean => {
      return !project.isSampleProject && Boolean(project.id);
    }) || null
  );
};

// The Home page of a project.
export const getProjectHomeRoute: (projectId: ObjectID) => Route = (
  projectId: ObjectID,
): Route => {
  return new Route((RouteMap[PageMap.HOME] as Route).toString()).addRouteParam(
    RouteParams.ProjectID,
    projectId.toString(),
  );
};

// Opens a project's Home, loading the app again.
export const openProjectHome: (projectId: ObjectID) => void = (
  projectId: ObjectID,
): void => {
  ProjectUtil.setLastAccessedProjectId(projectId);

  Navigation.navigate(getProjectHomeRoute(projectId), {
    forceNavigate: true,
  });
};

/*
 * Where a person goes once their sample is deleted: their own project's
 * Home, or the page that welcomes someone with no project.
 */
export const leaveDeletedSample: (goBackTo: Project | null) => void = (
  goBackTo: Project | null,
): void => {
  if (goBackTo?.id) {
    openProjectHome(goBackTo.id);
    return;
  }

  ProjectUtil.clearLastAccessedProjectId();
  ProjectUtil.clearCurrentProject();

  Navigation.navigate(RouteMap[PageMap.WELCOME] as Route, {
    forceNavigate: true,
  });
};
