import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "Common/Models/DatabaseModels/Project";
import ObjectID from "Common/Types/ObjectID";
import ModelEventType from "Common/Types/Realtime/ModelEventType";
import Realtime from "Common/UI/Utils/Realtime";

/*
 * THE HEADER'S COUNTS HEAR EVERY PROJECT THEY COUNT (#6917).
 *
 * The bell's counts - active incidents, alerts and their episodes - are read
 * across every project the person belongs to (a multi-tenant request, which
 * the API answers with what each project lets them read). They are read
 * again when a record of their kind changes, and they used to hear only the
 * open project's changes: an alert raised in another project left the count
 * where it was until a reload, or until something changed in the open one.
 *
 * So the header listens in each of the person's projects - the list the
 * project picker draws, with the open project first - for each kind it
 * counts, each kind of change. Nothing new is asked of the server: each
 * project's rooms are joined as every page joins them, by that project's own
 * check (RealtimeJoinAccess), and an event reaches only someone who may read
 * its record (RealtimeAudience). A project the person may not read a kind of
 * record in is not joined for it, and its records are not in the count.
 *
 * The cost is bounded:
 *
 *   - however many projects and changes, each count is read again at most
 *     once every HEADER_COUNT_REFRESH_INTERVAL_IN_MS (one CoalescedRefresh
 *     per count, shared by every project's changes): a bulk action in any
 *     project is two reads, not one per record;
 *   - the rooms are joined once per connection, at most
 *     HEADER_COUNT_MAX_PROJECTS projects of them, and again only when the
 *     projects themselves change (a project created, an invitation
 *     accepted) - not when the list is read again with the same projects.
 */

// Every kind of change moves a count: a record created, its state changed, deleted.
export const HEADER_COUNT_EVENT_TYPES: ReadonlyArray<ModelEventType> = [
  ModelEventType.Create,
  ModelEventType.Update,
  ModelEventType.Delete,
];

/*
 * The most projects whose changes the header hears. The Dashboard lists a
 * person's first 50 projects (App.tsx, the project picker's list), so this
 * is every project it knows of; it keeps the rooms bounded however long
 * that list grows.
 */
export const HEADER_COUNT_MAX_PROJECTS: number = 50;

/*
 * The projects whose changes the header's counts hear: the open one first,
 * then each of the person's projects, each once, at most
 * HEADER_COUNT_MAX_PROJECTS. Ids are read in lower case, as the server
 * names its rooms.
 */
export const getHeaderCountProjectIds: (data: {
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
      projectIds.length >= HEADER_COUNT_MAX_PROJECTS
    ) {
      return;
    }

    projectIds.push(projectId);
  };

  add(data.currentProjectId);

  for (const project of data.projects) {
    add(project?._id || project?.id);
  }

  return projectIds;
};

/*
 * What the header's subscriptions are for, as one value: the same projects
 * are the same subscriptions, whatever order the list came back in, so a
 * list read again does not join every room again.
 */
export const getHeaderCountSubscriptionKey: (
  projectIds: ReadonlyArray<string>,
) => string = (projectIds: ReadonlyArray<string>): string => {
  return [...projectIds].sort().join(",");
};

/*
 * Hears every change of a kind of record in each of `projectIds`, and tells
 * `onChange` - which coalesces them (CoalescedRefresh). Returns the function
 * that stops hearing them all.
 */
export const listenToHeaderCountChanges: (data: {
  modelType: { new (): BaseModel };
  projectIds: ReadonlyArray<string>;
  onChange: () => void;
}) => () => void = (data: {
  modelType: { new (): BaseModel };
  projectIds: ReadonlyArray<string>;
  onChange: () => void;
}): (() => void) => {
  const stops: Array<() => void> = [];

  for (const projectId of data.projectIds) {
    for (const eventType of HEADER_COUNT_EVENT_TYPES) {
      stops.push(
        Realtime.listenToModelEvent<BaseModel>(
          {
            eventType: eventType,
            modelType: data.modelType,
            tenantId: new ObjectID(projectId),
          },
          (): void => {
            data.onChange();
          },
        ),
      );
    }
  }

  return (): void => {
    for (const stop of stops) {
      stop();
    }
  };
};
