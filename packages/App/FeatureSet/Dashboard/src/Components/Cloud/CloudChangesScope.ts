import ChangeEvent from "Common/Models/AnalyticsModels/ChangeEvent";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Query from "Common/Types/BaseDatabase/Query";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  ChangeEventAttribute,
  ChangeEventSource,
  ChangeEventType,
  CloudAiChangeStep,
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

/*
 * A change OneUptime AI made in a cloud account, through the account's
 * Cloud AI agent, as its change event says (CloudChangeRecorder, from
 * CloudAiChangeAttribution on the server): the cloud recorded it under the
 * agent's role, and the event names the fix it belongs to - its fix (an
 * auto-remediation suggestion), the incident or alert it fixed, and
 * whether it made the fix or rolled it back. Any of them may be missing:
 * a change of the agent's that no job explained names none.
 */
export interface CloudAiChange {
  runnerJobId: string | null;
  suggestionId: string | null;
  incidentId: string | null;
  alertId: string | null;
  isRollback: boolean;
  // The Cloud Account it was made in: where its AI Logs are.
  cloudAccountId: string | null;
}

function readId(attributes: JSONObject, key: string): string | null {
  const value: unknown = attributes[key];

  return typeof value === "string" && ObjectID.isValidUUID(value.trim())
    ? value.trim().toLowerCase()
    : null;
}

/*
 * The change's AI side when OneUptime AI made it, else null: a person's
 * change, a health event, or anything a pipeline posted (which can never
 * carry a oneuptime.* key).
 */
export function readCloudAiChange(change: {
  attributes?: JSONObject | undefined;
}): CloudAiChange | null {
  const attributes: JSONObject = change.attributes || {};

  if (
    attributes[ChangeEventAttribute.MadeBy] !== ChangeEventSource.OneUptimeAi
  ) {
    return null;
  }

  return {
    runnerJobId: readId(attributes, ChangeEventAttribute.RunnerJobId),
    suggestionId: readId(
      attributes,
      ChangeEventAttribute.AutoRemediationSuggestionId,
    ),
    incidentId: readId(attributes, ChangeEventAttribute.IncidentId),
    alertId: readId(attributes, ChangeEventAttribute.AlertId),
    isRollback:
      attributes[ChangeEventAttribute.AiStep] === CloudAiChangeStep.Rollback,
    cloudAccountId: readId(attributes, ChangeEventAttribute.CloudAccountRecordId),
  };
}

/*
 * The fixes a page of changes names, each once: what the list reads, as
 * the reader, to say who approved each one and which record it fixed.
 */
export function getCloudAiChangeSuggestionIds(
  changes: Array<{ attributes?: JSONObject | undefined }>,
): Array<string> {
  const ids: Array<string> = [];

  for (const change of changes) {
    const id: string | null = readCloudAiChange(change)?.suggestionId || null;

    if (id && !ids.includes(id)) {
      ids.push(id);
    }
  }

  return ids;
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
