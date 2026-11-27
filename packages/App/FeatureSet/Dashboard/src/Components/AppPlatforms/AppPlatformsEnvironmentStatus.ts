import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import FilterGroups, {
  FilterGroup,
  FilterGroupsMatch,
} from "Common/Types/BaseDatabase/FilterGroups";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import NotEqualOrNull from "Common/Types/BaseDatabase/NotEqualOrNull";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import Query from "Common/Types/BaseDatabase/Query";
import IconProp from "Common/Types/Icon/IconProp";
import { translationKey } from "Common/Types/Translator";
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
 * column: each status is a group of conditions on both, and the statuses
 * picked are one FilterGroups the server answers in the list's own query
 * (#11211). The chip read each status's environments' ids first - the
 * first 10,000 - and filtered the list by them, so a status with more
 * environments than that listed and counted only some of them. A row that
 * has never reported stores no status (NULL), so "not connected" is
 * anything but "connected", none included (NotEqualOrNull): the three
 * split every environment between them, as the Status column does. The
 * tile counts the waiting ones by the same query, and links to the list
 * with the chip set to Disconnected while any are (AppPlatformsListRoutes).
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
        otelCollectorStatus: new NotEqualOrNull("connected"),
        lastSeenAt: new NotNull(),
      } as Query<CloudResource>;
    default:
      return {
        otelCollectorStatus: new NotEqualOrNull("connected"),
        lastSeenAt: new IsNull(),
      } as Query<CloudResource>;
  }
}

/*
 * The Status chip's filter: the environments whose status is one of
 * `values` ("is") or none of them ("is not"), as one FilterGroups for the
 * list's own query (CloudEnvironmentStatus values; any other is left out).
 * Null when no status is picked, and the chip filters nothing.
 */
export function buildCloudEnvironmentStatusFilter(
  values: Array<string>,
  operator: FilterOperator,
): FilterGroups | null {
  const statuses: Array<CloudEnvironmentStatus> = Array.from(
    new Set(values.filter(isCloudEnvironmentStatus)),
  );

  if (statuses.length === 0) {
    return null;
  }

  return new FilterGroups({
    match:
      operator === "is_not"
        ? FilterGroupsMatch.NoneOf
        : FilterGroupsMatch.AnyOf,
    groups: statuses.map((status: CloudEnvironmentStatus): FilterGroup => {
      return buildCloudEnvironmentStatusQuery(status) as unknown as FilterGroup;
    }),
  });
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
export function getEnvironmentStatusFacet(): ResourceFacet {
  return {
    key: ENVIRONMENT_STATUS_FACET_KEY,
    label: ENVIRONMENT_STATUS_FACET_LABEL,
    icon: IconProp.Wifi,
    isMultiSelect: true,
    options: STATUS_OPTIONS,
    supportedOperators: ENVIRONMENT_STATUS_FACET_OPERATORS,
    toFilterGroups: buildCloudEnvironmentStatusFilter,
  };
}
