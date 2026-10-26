import ChangeEvent from "Common/Models/AnalyticsModels/ChangeEvent";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Query from "Common/Types/BaseDatabase/Query";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  ChangeEventAttribute,
  ChangeEventSource,
  ChangeEventType,
} from "Common/Utils/Telemetry/ChangeEventFields";

/*
 * Which change events a cloud page lists: the ones a cloud connection tied
 * to the row (CloudChangeRecorder) -
 *
 *   - a resource's by `oneuptime.resource.id`, the Cloud Resource's row id;
 *   - an account's by `oneuptime.cloud_account.id`, the Cloud Account's.
 *
 * Kept apart from the table that draws them (CloudChangesTable) so App's
 * tests can read it without React.
 */

export type CloudChangesScope =
  | { cloudResourceId: ObjectID }
  | { cloudAccountId: ObjectID };

// The attribute a scope reads its changes by, and its value.
export function getCloudChangesAttributeFilter(
  scope: CloudChangesScope,
): Record<string, string> {
  if ("cloudResourceId" in scope) {
    return {
      [ChangeEventAttribute.ResourceId]: scope.cloudResourceId.toString(),
    };
  }

  return {
    [ChangeEventAttribute.CloudAccountRecordId]:
      scope.cloudAccountId.toString(),
  };
}

/*
 * Whether a change's own description is worth a line under its title. A
 * health event's is the provider's own account of it ("We are
 * investigating increased error rates..."); an operation's only says again
 * who ran what where - the By and Region columns, and the title - so the
 * list leaves it out.
 */
export function isCloudHealthChange(change: {
  eventType?: string | undefined;
  attributes?: JSONObject | undefined;
}): boolean {
  if (change.eventType === ChangeEventType.ProviderEvent) {
    return true;
  }

  const source: unknown = change.attributes
    ? change.attributes[ChangeEventAttribute.Source]
    : undefined;

  return source === ChangeEventSource.CloudHealth;
}

// How far back an account's Overview counts its changes: the last day.
export const RECENT_CLOUD_CHANGES_HOURS: number = 24;

/*
 * The changes a scope recorded in the last RECENT_CLOUD_CHANGES_HOURS, up
 * to `now`: what an account's Overview counts on its Changes tile, read by
 * the same attribute its Changes list reads them by.
 */
export function getRecentCloudChangesQuery(data: {
  projectId: ObjectID;
  scope: CloudChangesScope;
  now: Date;
}): Query<ChangeEvent> {
  const since: Date = new Date(
    data.now.getTime() - RECENT_CLOUD_CHANGES_HOURS * 60 * 60 * 1000,
  );

  return {
    projectId: data.projectId,
    time: new InBetween<Date>(since, data.now),
    attributes: getCloudChangesAttributeFilter(data.scope),
  } as Query<ChangeEvent>;
}
