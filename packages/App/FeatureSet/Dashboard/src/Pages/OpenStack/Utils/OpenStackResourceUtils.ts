import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * What the OpenStack pages read. A cloud can hold hundreds of thousands of
 * OpenStackResource rows, so nothing here reads them all: the counts come from
 * the server in one round trip, and a filter's choices are read from the few rows
 * that name them.
 */

// POST /openstack-resource/inventory-summary/:cloudId.
export interface OpenStackInventorySummary {
  regionCount: number;
  availabilityZoneCount: number;
  hypervisorCount: number;
  instanceCount: number;
  activeInstanceCount: number;
  volumeCount: number;
  networkCount: number;
  routerCount: number;
  floatingIpCount: number;
  projectCount: number;
  serviceCount: number;
  downServiceCount: number;
  vcpuCapacity: number;
  vcpuAllocated: number;
  memoryCapacityBytes: number;
  memoryAllocatedBytes: number;
  storageCapacityBytes: number;
  storageUsedBytes: number;
}

export function toOpenStackInventorySummary(
  summary: JSONObject,
): OpenStackInventorySummary {
  const readNumber: (key: string) => number = (key: string): number => {
    const value: JSONValue = summary[key];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  };

  return {
    regionCount: readNumber("regionCount"),
    availabilityZoneCount: readNumber("availabilityZoneCount"),
    hypervisorCount: readNumber("hypervisorCount"),
    instanceCount: readNumber("instanceCount"),
    activeInstanceCount: readNumber("activeInstanceCount"),
    volumeCount: readNumber("volumeCount"),
    networkCount: readNumber("networkCount"),
    routerCount: readNumber("routerCount"),
    floatingIpCount: readNumber("floatingIpCount"),
    projectCount: readNumber("projectCount"),
    serviceCount: readNumber("serviceCount"),
    downServiceCount: readNumber("downServiceCount"),
    vcpuCapacity: readNumber("vcpuCapacity"),
    vcpuAllocated: readNumber("vcpuAllocated"),
    memoryCapacityBytes: readNumber("memoryCapacityBytes"),
    memoryAllocatedBytes: readNumber("memoryAllocatedBytes"),
    storageCapacityBytes: readNumber("storageCapacityBytes"),
    storageUsedBytes: readNumber("storageUsedBytes"),
  };
}

// Null when the server would not answer: the caller says so, or goes without.
export async function fetchOpenStackInventorySummary(
  openStackCloudId: ObjectID,
): Promise<OpenStackInventorySummary | null> {
  const summaryUrl: URL = URL.fromString(APP_API_URL.toString())
    .addRoute("/openstack-resource/inventory-summary/")
    .addRoute(openStackCloudId.toString());

  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
    {
      url: summaryUrl,
      data: {},
      headers: {
        ...ModelAPI.getCommonHeaders(),
      },
    },
  );

  if (response instanceof HTTPErrorResponse) {
    return null;
  }

  return toOpenStackInventorySummary(response.data);
}

/*
 * True while the cloud has reported nothing a person could read: no capacity and
 * no parts of any kind. Its page then shows the setup guide instead of a wall of
 * zeros, because no parts is what a cloud that has not connected yet looks like.
 */
export function isOpenStackInventoryEmpty(
  summary: OpenStackInventorySummary,
): boolean {
  return (
    summary.regionCount === 0 &&
    summary.hypervisorCount === 0 &&
    summary.instanceCount === 0 &&
    summary.volumeCount === 0 &&
    summary.networkCount === 0 &&
    summary.routerCount === 0 &&
    summary.floatingIpCount === 0 &&
    summary.projectCount === 0 &&
    summary.serviceCount === 0
  );
}

/*
 * How much of a capacity is taken, or null when there is no capacity to take it
 * from. A cloud whose credential cannot read Placement has no capacity, and "0%"
 * would read as a cloud with room to spare.
 */
export function getOpenStackPercent(
  taken: number | null | undefined,
  capacity: number | null | undefined,
): number | null {
  if (
    taken === null ||
    taken === undefined ||
    capacity === null ||
    capacity === undefined ||
    !Number.isFinite(taken) ||
    !Number.isFinite(capacity) ||
    capacity <= 0
  ) {
    return null;
  }
  return (taken / capacity) * 100;
}

// What else OpenStack says about a row, by kind: see OpenStackSnapshotScan.
export function getOpenStackFact(
  row: OpenStackResource,
  name: string,
): JSONValue | undefined {
  const facts: JSONObject | undefined = row.facts;
  return facts ? facts[name] : undefined;
}

export function getOpenStackFactText(
  row: OpenStackResource,
  name: string,
): string {
  const value: JSONValue | undefined = getOpenStackFact(row, name);
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}

export function getOpenStackFactNumber(
  row: OpenStackResource,
  name: string,
): number | null {
  const value: JSONValue | undefined = getOpenStackFact(row, name);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/*
 * How far a filter's choices read. Each is a query on a few rows of the cloud, on
 * opening the filter; a cloud with more projects or hypervisors than this finds
 * the rest with the list's search, which the server answers.
 */
const FILTER_OPTIONS_LIMIT: number = 500;

function toOptions(values: Array<string | undefined>): Array<DropdownOption> {
  const seen: Set<string> = new Set<string>();
  const options: Array<DropdownOption> = [];

  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    // A name someone gave it: drawn as written in every language.
    options.push({ value: value, label: value, isUserContent: true });
  }

  return options.sort((a: DropdownOption, b: DropdownOption): number => {
    return a.label.localeCompare(b.label);
  });
}

/*
 * The regions, from the one row each service's API has in each: a handful of rows
 * however large the cloud is.
 */
export async function fetchOpenStackRegionOptions(
  openStackCloudId: ObjectID,
): Promise<Array<DropdownOption>> {
  const result: ListResult<OpenStackResource> =
    await ModelAPI.getList<OpenStackResource>({
      modelType: OpenStackResource,
      query: {
        openStackCloudId: openStackCloudId,
        kind: OpenStackResourceKind.Api,
      },
      limit: FILTER_OPTIONS_LIMIT,
      skip: 0,
      select: { regionName: true },
      sort: {},
    });

  return toOptions(
    result.data.map((row: OpenStackResource): string | undefined => {
      return row.regionName;
    }),
  );
}

export async function fetchOpenStackHypervisorOptions(
  openStackCloudId: ObjectID,
): Promise<Array<DropdownOption>> {
  const result: ListResult<OpenStackResource> =
    await ModelAPI.getList<OpenStackResource>({
      modelType: OpenStackResource,
      query: {
        openStackCloudId: openStackCloudId,
        kind: OpenStackResourceKind.Hypervisor,
      },
      limit: FILTER_OPTIONS_LIMIT,
      skip: 0,
      select: { name: true },
      sort: { name: SortOrder.Ascending },
    });

  return toOptions(
    result.data.map((row: OpenStackResource): string | undefined => {
      return row.name;
    }),
  );
}

// A project's choice filters on its ID, which a rename never breaks.
export async function fetchOpenStackProjectOptions(
  openStackCloudId: ObjectID,
): Promise<Array<DropdownOption>> {
  const result: ListResult<OpenStackResource> =
    await ModelAPI.getList<OpenStackResource>({
      modelType: OpenStackResource,
      query: {
        openStackCloudId: openStackCloudId,
        kind: OpenStackResourceKind.Project,
      },
      limit: FILTER_OPTIONS_LIMIT,
      skip: 0,
      select: { name: true, externalId: true },
      sort: { name: SortOrder.Ascending },
    });

  const options: Array<DropdownOption> = [];

  for (const row of result.data) {
    if (row.externalId) {
      options.push({
        value: row.externalId,
        label: row.name || row.externalId,
        isUserContent: true,
      });
    }
  }

  return options;
}

/*
 * The names of the projects a page of a list shows, by their IDs. Rows hold the
 * project's ID because Nova, Cinder and Neutron report only that; the name comes
 * from Keystone's own rows.
 */
export async function fetchOpenStackProjectNames(data: {
  openStackCloudId: ObjectID;
  projectIds: Array<string>;
}): Promise<Record<string, string>> {
  if (data.projectIds.length === 0) {
    return {};
  }

  const result: ListResult<OpenStackResource> =
    await ModelAPI.getList<OpenStackResource>({
      modelType: OpenStackResource,
      query: {
        openStackCloudId: data.openStackCloudId,
        kind: OpenStackResourceKind.Project,
        externalId: new Includes(data.projectIds),
      },
      limit: data.projectIds.length,
      skip: 0,
      select: { name: true, externalId: true },
      sort: {},
    });

  const names: Record<string, string> = {};

  for (const row of result.data) {
    if (row.externalId && row.name) {
      names[row.externalId] = row.name;
    }
  }

  return names;
}

/*
 * The rows of nova-compute on the hypervisors a page of the list shows. Keyed by
 * region and host, because a host's name can repeat between regions.
 */
export function getOpenStackHostKey(
  regionName: string | null | undefined,
  host: string | null | undefined,
): string {
  return `${regionName || ""}/${host || ""}`;
}

export async function fetchOpenStackComputeServices(data: {
  openStackCloudId: ObjectID;
  hypervisorNames: Array<string>;
}): Promise<Record<string, OpenStackResource>> {
  if (data.hypervisorNames.length === 0) {
    return {};
  }

  const result: ListResult<OpenStackResource> =
    await ModelAPI.getList<OpenStackResource>({
      modelType: OpenStackResource,
      query: {
        openStackCloudId: data.openStackCloudId,
        kind: OpenStackResourceKind.Service,
        name: "nova-compute",
        hypervisorName: new Includes(data.hypervisorNames),
      },
      // One per host per region, and the names on a page rarely repeat.
      limit: data.hypervisorNames.length * 4,
      skip: 0,
      select: {
        kind: true,
        regionName: true,
        hypervisorName: true,
        status: true,
        adminState: true,
        disabledReason: true,
      },
      sort: {},
    });

  const services: Record<string, OpenStackResource> = {};

  for (const row of result.data) {
    services[getOpenStackHostKey(row.regionName, row.hypervisorName)] = row;
  }

  return services;
}
