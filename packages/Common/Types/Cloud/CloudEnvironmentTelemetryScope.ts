import { buildCloudEnvironmentKey } from "./CloudPlatform";
import { isCloudResourceKindResource } from "./CloudResourceKind";

/*
 * WHICH APP PLATFORMS ENVIRONMENT A TELEMETRY FILTER READS.
 *
 * An environment is one row per cloud.platform + cloud.account.id +
 * cloud.region (CloudPlatform's environment key), and its telemetry is
 * whatever carries those resource attributes: its tabs, its apps' tabs and
 * every monitor built from them filter by them, under the `resource.`
 * prefix the stored telemetry carries them by (the Dashboard's
 * CloudResourceTelemetryScope and CloudApps build those filters). An app's
 * recommended monitors (CloudAppAlertTemplates) filter by its environment's
 * three and its own attributes.
 *
 * So a filter names an environment the way ingest keys one: the platform it
 * pins, and the account and Region it pins beside it, a part it leaves out
 * an empty segment. A filter that pins every part an environment has reads
 * nothing but that environment's telemetry - and a filter that pins less
 * reads more than one: a platform and a Region with no account reads every
 * account's apps there. Scheduled maintenance that holds an environment
 * silences the monitors whose every query reads only it
 * (MonitorMaintenanceSuppression).
 *
 * Pure and isomorphic: the server, the Dashboard and the tests read it.
 */

export const CLOUD_ENVIRONMENT_PLATFORM_ATTRIBUTE: string =
  "resource.cloud.platform";
export const CLOUD_ENVIRONMENT_ACCOUNT_ID_ATTRIBUTE: string =
  "resource.cloud.account.id";
export const CLOUD_ENVIRONMENT_REGION_ATTRIBUTE: string =
  "resource.cloud.region";

// A filter value as the filter pins it: text only, trimmed; anything else pins nothing.
function readPinnedText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/*
 * The environment key a telemetry filter reads ("aws_ecs|123456789012|us-east-1"),
 * or null when it pins no platform and so reads no one environment. The
 * filter is a stored attribute map as a monitor's step holds it: values that
 * are not text (a Search, a number, a list) pin nothing.
 */
export function getCloudEnvironmentKeyOfFilter(
  attributes: unknown,
): string | null {
  if (!attributes || typeof attributes !== "object") {
    return null;
  }

  if (Array.isArray(attributes)) {
    return null;
  }

  const record: Record<string, unknown> = attributes as Record<
    string,
    unknown
  >;

  const platform: string = readPinnedText(
    record[CLOUD_ENVIRONMENT_PLATFORM_ATTRIBUTE],
  );

  if (!platform) {
    return null;
  }

  return buildCloudEnvironmentKey({
    platform: platform,
    accountId: readPinnedText(record[CLOUD_ENVIRONMENT_ACCOUNT_ID_ATTRIBUTE]),
    region: readPinnedText(record[CLOUD_ENVIRONMENT_REGION_ATTRIBUTE]),
  });
}

// The columns of a CloudResource row an environment's key is read from.
export interface CloudEnvironmentScopeRow {
  cloudResourceKind?: string | null | undefined;
  cloudPlatform?: string | null | undefined;
  cloudAccountId?: string | null | undefined;
  cloudRegion?: string | null | undefined;
}

/*
 * The key of the telemetry an environment's row selects, built from the
 * same three columns its filters are built from - or null for a cloud
 * resource of a connected account (a virtual machine, a bucket), whose
 * metrics name no platform, and for an environment made by hand that no
 * telemetry has named a platform for yet.
 */
export function getCloudEnvironmentKeyOfRow(
  row: CloudEnvironmentScopeRow | null | undefined,
): string | null {
  if (!row || isCloudResourceKindResource(row.cloudResourceKind)) {
    return null;
  }

  const platform: string = readPinnedText(row.cloudPlatform);

  if (!platform) {
    return null;
  }

  return buildCloudEnvironmentKey({
    platform: platform,
    accountId: readPinnedText(row.cloudAccountId),
    region: readPinnedText(row.cloudRegion),
  });
}
