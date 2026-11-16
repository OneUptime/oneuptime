import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
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
 * So the header listens in each of the person's projects (Utils/LiveProjects:
 * the project picker's list, the open project first) for each kind it
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
 *   - the rooms are joined once per connection, at most MAX_LIVE_PROJECTS
 *     projects of them, and again only when the projects themselves change
 *     (a project created, an invitation accepted) - not when the list is
 *     read again with the same projects.
 */

// Every kind of change moves a count: a record created, its state changed, deleted.
export const HEADER_COUNT_EVENT_TYPES: ReadonlyArray<ModelEventType> = [
  ModelEventType.Create,
  ModelEventType.Update,
  ModelEventType.Delete,
];

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
