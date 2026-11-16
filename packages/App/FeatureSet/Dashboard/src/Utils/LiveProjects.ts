import Project from "Common/Models/DatabaseModels/Project";
import ObjectID from "Common/Types/ObjectID";
import ProjectUtil from "Common/UI/Utils/Project";

/*
 * THE PROJECTS WHOSE LIVE CHANGES A CROSS-PROJECT VIEW HEARS.
 *
 * The bell's counts and the cross-project inboxes (Active Incidents, Active
 * Alerts and their episodes) read every project the person belongs to at
 * once (a multi-tenant request, which the API answers with what each project
 * lets them read). Their live updates have to come from those projects too:
 * a change is announced in its own project's rooms, and a view that listened
 * only to the open project missed the alert raised in another (#6917).
 *
 * So they listen in each of the person's projects - the list the project
 * picker draws, which the Dashboard reads once it starts (App.tsx) - with
 * the open project first. Each project's rooms are joined as every page
 * joins them, by that project's own check, and an event reaches only someone
 * who may read its record: nothing is heard that the count or the list could
 * not show.
 */

/*
 * The most projects a view hears. The Dashboard lists a person's first 50
 * projects (App.tsx, the project picker's list), so this is every project it
 * knows of; it keeps the rooms a view joins bounded however long that list
 * grows.
 */
export const MAX_LIVE_PROJECTS: number = 50;

/*
 * The projects a cross-project view hears: the open one first, then each of
 * the person's projects, each once, at most MAX_LIVE_PROJECTS. Ids are read
 * in lower case, as the server names its rooms.
 */
export const getLiveProjectIds: (data: {
  projects: ReadonlyArray<Project>;
  currentProjectId: ObjectID | null | undefined;
}) => Array<string> = (data: {
  projects: ReadonlyArray<Project>;
  currentProjectId: ObjectID | null | undefined;
}): Array<string> => {
  const projectIds: Array<string> = [];

  const add: (id: ObjectID | string | null | undefined) => void = (
    id: ObjectID | string | null | undefined,
  ): void => {
    const projectId: string = id?.toString().toLowerCase() || "";

    if (
      !projectId ||
      !ObjectID.isValidUUID(projectId) ||
      projectIds.includes(projectId) ||
      projectIds.length >= MAX_LIVE_PROJECTS
    ) {
      return;
    }

    projectIds.push(projectId);
  };

  add(data.currentProjectId);

  // Read defensively: the list is the Dashboard's, loaded after it starts.
  for (const project of data.projects || []) {
    add(project?._id || project?.id);
  }

  return projectIds;
};

/*
 * The projects a cross-project list hears, for its table
 * (BaseModelTable's liveProjectIds): the person's projects, with the one
 * open now first.
 */
export const getLiveProjectObjectIds: (
  projects: ReadonlyArray<Project>,
) => Array<ObjectID> = (projects: ReadonlyArray<Project>): Array<ObjectID> => {
  return getLiveProjectIds({
    projects: projects,
    currentProjectId: ProjectUtil.getCurrentProjectId(),
  }).map((projectId: string): ObjectID => {
    return new ObjectID(projectId);
  });
};

/*
 * What a view's subscriptions are for, as one value: the same projects are
 * the same subscriptions, whatever order the list came back in, so a list
 * read again does not join every room again.
 */
export const getLiveProjectsKey: (
  projectIds: ReadonlyArray<string>,
) => string = (projectIds: ReadonlyArray<string>): string => {
  return [...projectIds].sort().join(",");
};
