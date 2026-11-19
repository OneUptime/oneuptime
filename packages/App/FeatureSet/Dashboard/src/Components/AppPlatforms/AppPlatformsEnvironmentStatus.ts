import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import EqualToOrNull from "Common/Types/BaseDatabase/EqualToOrNull";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import Query from "Common/Types/BaseDatabase/Query";
import { CloudResourceKind } from "Common/Types/Cloud/CloudResourceKind";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { translationKey } from "Common/Types/Translator";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import {
  FilterChipDropdownOption,
  FilterOperator,
} from "../ResourceOwners/FilterChipDropdownTypes";
import { ResourceFacet } from "../ResourceOwners/ResourceFacet";

/*
 * WHETHER AN APP PLATFORMS ENVIRONMENT REPORTS, ONE RULE FOR THE LIST AND
 * THE OVERVIEW (#9751).
 *
 * All Environments' Status column, and the Overview's Environments tile
 * ("2 environments disconnected"), each read an environment the same way:
 *
 *   - Connected: its collector reports (otelCollectorStatus "connected");
 *   - Disconnected: it reported once and stopped - not connected, and last
 *     seen;
 *   - Waiting: never heard from - not connected, and never seen (just
 *     added, waiting for its first data). Grey, not red: nothing broke yet.
 *
 * The status is two columns, so the list's Status chip cannot write one
 * column: it resolves the statuses picked to environments by id
 * (ResourceFacet's computeMatchingResourceIds), with these rules as
 * queries. A row that has never reported stores no status (NULL), so "not
 * connected" is "disconnected" or nothing (EqualToOrNull). The tile counts
 * the waiting ones by the same query, and links to the list with the chip
 * set to Disconnected while any are (AppPlatformsListRoutes).
 *
 * React-free, and free of the route map, so App's tests can read it.
 */

export enum CloudEnvironmentStatus {
  Connected = "connected",
  Disconnected = "disconnected",
  Waiting = "waiting",
}

// All Environments' Status chip: its key in the list's facet state.
export const ENVIRONMENT_STATUS_FACET_KEY: string = "environmentStatus";

export const ENVIRONMENT_STATUS_FACET_LABEL: string = translationKey("Status");

// What each status is called, as the Status column words it.
export const CLOUD_ENVIRONMENT_STATUS_LABELS: Record<
  CloudEnvironmentStatus,
  string
> = {
  [CloudEnvironmentStatus.Connected]: translationKey("Connected"),
  [CloudEnvironmentStatus.Disconnected]: translationKey("Disconnected"),
  [CloudEnvironmentStatus.Waiting]: translationKey("Waiting"),
};

// What an environment's status is read from.
export interface CloudEnvironmentReporting {
  otelCollectorStatus?: string | null | undefined;
  lastSeenAt?: Date | string | null | undefined;
}

// An environment's status, as the Status column says it.
export function getCloudEnvironmentStatus(
  environment: CloudEnvironmentReporting,
): CloudEnvironmentStatus {
  if (environment.otelCollectorStatus === "connected") {
    return CloudEnvironmentStatus.Connected;
  }

  return environment.lastSeenAt
    ? CloudEnvironmentStatus.Disconnected
    : CloudEnvironmentStatus.Waiting;
}

export function isCloudEnvironmentStatus(
  value: unknown,
): value is CloudEnvironmentStatus {
  return (
    typeof value === "string" &&
    (Object.values(CloudEnvironmentStatus) as Array<string>).includes(value)
  );
}

// The environments of one status, as a query (getCloudEnvironmentStatus's rule).
export function buildCloudEnvironmentStatusQuery(
  status: CloudEnvironmentStatus,
): Query<CloudResource> {
  switch (status) {
    case CloudEnvironmentStatus.Connected:
      return { otelCollectorStatus: "connected" } as Query<CloudResource>;
    case CloudEnvironmentStatus.Disconnected:
      return {
        otelCollectorStatus: new EqualToOrNull("disconnected"),
        lastSeenAt: new NotNull(),
      } as Query<CloudResource>;
    default:
      return {
        otelCollectorStatus: new EqualToOrNull("disconnected"),
        lastSeenAt: new IsNull(),
      } as Query<CloudResource>;
  }
}

/*
 * The ids of the project's listed environments whose status is one of
 * `values` (CloudEnvironmentStatus values; any other is ignored), the
 * statuses unioned. [] when none matches.
 */
export async function computeCloudEnvironmentIdsForStatuses(
  projectId: ObjectID,
  values: Array<string>,
): Promise<Array<string>> {
  const statuses: Array<CloudEnvironmentStatus> = Array.from(
    new Set(values.filter(isCloudEnvironmentStatus)),
  );

  const results: Array<ListResult<CloudResource>> = await Promise.all(
    statuses.map(
      (status: CloudEnvironmentStatus): Promise<ListResult<CloudResource>> => {
        return ModelAPI.getList<CloudResource>({
          modelType: CloudResource,
          query: {
            projectId: projectId,
            isArchived: false,
            cloudResourceKind: CloudResourceKind.Environment,
            ...buildCloudEnvironmentStatusQuery(status),
          } as Query<CloudResource>,
          select: { _id: true },
          sort: {},
          skip: 0,
          limit: LIMIT_PER_PROJECT,
        });
      },
    ),
  );

  const ids: Set<string> = new Set<string>();

  for (const result of results) {
    for (const row of result.data || []) {
      const id: string = row._id ? row._id.toString() : "";

      if (id) {
        ids.add(id);
      }
    }
  }

  return Array.from(ids);
}

const STATUS_OPTIONS: Array<FilterChipDropdownOption> = [
  {
    value: CloudEnvironmentStatus.Connected,
    label: CLOUD_ENVIRONMENT_STATUS_LABELS[CloudEnvironmentStatus.Connected],
    icon: IconProp.Wifi,
  },
  {
    value: CloudEnvironmentStatus.Disconnected,
    label: CLOUD_ENVIRONMENT_STATUS_LABELS[CloudEnvironmentStatus.Disconnected],
    icon: IconProp.Wifi,
  },
  {
    value: CloudEnvironmentStatus.Waiting,
    label: CLOUD_ENVIRONMENT_STATUS_LABELS[CloudEnvironmentStatus.Waiting],
    icon: IconProp.Clock,
  },
];

// One status, or every one but those picked.
export const ENVIRONMENT_STATUS_FACET_OPERATORS: Array<FilterOperator> = [
  "is",
  "is_not",
];

// All Environments' Status chip.
export function getEnvironmentStatusFacet(
  resolve: (
    projectId: ObjectID,
    values: Array<string>,
  ) => Promise<Array<string>> = computeCloudEnvironmentIdsForStatuses,
): ResourceFacet {
  return {
    key: ENVIRONMENT_STATUS_FACET_KEY,
    label: ENVIRONMENT_STATUS_FACET_LABEL,
    icon: IconProp.Wifi,
    isMultiSelect: true,
    options: STATUS_OPTIONS,
    supportedOperators: ENVIRONMENT_STATUS_FACET_OPERATORS,
    computeMatchingResourceIds: (
      projectId: ObjectID,
      values: Array<string>,
    ): Promise<Array<string>> => {
      return resolve(projectId, values);
    },
  };
}
