import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import ObjectID from "Common/Types/ObjectID";

/*
 * Which Cloud Resources belong to a cloud account: those of its cloud and
 * account id (CloudResource.cloudProvider and cloudAccountId), whether a
 * cloud connection listed them or their telemetry brought them in - the
 * same rule the server counts an account's resources by.
 *
 * The id is compared as the cloud writes it and in either case: an Azure
 * subscription id is lower case in one API's answer and upper case in
 * another's, and the server counts both as one account.
 */

export function getCloudAccountIdSpellings(accountId: string): Array<string> {
  const trimmed: string = accountId.trim();

  if (!trimmed) {
    return [];
  }

  return Array.from(
    new Set<string>([trimmed, trimmed.toLowerCase(), trimmed.toUpperCase()]),
  );
}

// The query for an account's live resources: archived ones are left out.
export function getCloudAccountResourcesQuery(data: {
  projectId: ObjectID;
  provider: string;
  accountId: string;
}): Query<CloudResource> {
  return {
    projectId: data.projectId,
    cloudProvider: data.provider,
    cloudAccountId: new Includes(getCloudAccountIdSpellings(data.accountId)),
    isArchived: false,
  } as Query<CloudResource>;
}
