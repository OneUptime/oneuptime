import ObjectID from "Common/Types/ObjectID";
import { ChangeEventAttribute } from "Common/Utils/Telemetry/ChangeEventFields";

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
