import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import Includes from "Common/Types/BaseDatabase/Includes";
import LessThanOrEqual from "Common/Types/BaseDatabase/LessThanOrEqual";
import Query from "Common/Types/BaseDatabase/Query";
import Search from "Common/Types/BaseDatabase/Search";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  OPENSTACK_IMAGE_STUCK_MINUTES,
  OPENSTACK_INSTANCE_STUCK_MINUTES,
  OPENSTACK_VOLUME_STUCK_MINUTES,
} from "Common/Types/OpenStack/OpenStackHealthRules";
import {
  OPENSTACK_IMAGE_TRANSITIONAL_STATUSES,
  OPENSTACK_INSTANCE_TRANSITIONAL_STATUSES,
  OPENSTACK_VOLUME_ERROR_STATUSES,
  OPENSTACK_VOLUME_TRANSITIONAL_STATUSES,
  OpenStackResourceKind,
} from "Common/Types/OpenStack/OpenStackResourceKind";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  OPENSTACK_INTERNAL_ZONE,
  getOpenStackFlavorId,
} from "../../Pages/OpenStack/Utils/OpenStackPartFacts";
import {
  FilterChipDropdownOption,
  FilterOperator,
} from "../ResourceOwners/FilterChipDropdownTypes";
import { ResourceFacet } from "../ResourceOwners/ResourceFacet";
import { OPENSTACK_STATUS_WORDS } from "./OpenStackStatus";

/*
 * The chips over an OpenStack list. Every one of them is a filter on the server, because
 * a cloud can hold hundreds of thousands of rows, and each reads its choices from a few
 * rows when it is opened: a project's or a hypervisor's chip asks the server as it is
 * typed in, rather than reading every project into the browser to search them.
 *
 * Only "is": which of the words an operator wants, in the fewest clicks.
 */

const IS_ONLY: Array<FilterOperator> = ["is"];

// How many a chip's list shows at a time. Typing asks the server for the rest.
const CHIP_OPTIONS_LIMIT: number = 50;

function toWordOptions(
  words: ReadonlyArray<string>,
): Array<FilterChipDropdownOption> {
  return words.map((word: string): FilterChipDropdownOption => {
    return { value: word, label: word };
  });
}

// A word OpenStack wrote: the status of a kind, from the same list its tones read.
export function getOpenStackStatusFacet(
  kind: OpenStackResourceKind,
): ResourceFacet {
  return {
    key: "status",
    label: "Status",
    icon: IconProp.Activity,
    isMultiSelect: true,
    supportedOperators: IS_ONLY,
    options: toWordOptions(OPENSTACK_STATUS_WORDS[kind] || []),
  };
}

async function listRows(data: {
  openStackCloudId: ObjectID;
  kind: OpenStackResourceKind;
  query?: Query<OpenStackResource> | undefined;
}): Promise<Array<OpenStackResource>> {
  const result: ListResult<OpenStackResource> =
    await ModelAPI.getList<OpenStackResource>({
      modelType: OpenStackResource,
      query: {
        openStackCloudId: data.openStackCloudId,
        kind: data.kind,
        ...(data.query || {}),
      },
      limit: CHIP_OPTIONS_LIMIT,
      skip: 0,
      select: {
        name: true,
        externalId: true,
        hypervisorName: true,
        regionName: true,
      },
      sort: { name: SortOrder.Ascending },
    });
  return result.data;
}

function searchByName(searchTerm: string): Query<OpenStackResource> {
  return searchTerm.trim() ? { name: new Search(searchTerm.trim()) } : {};
}

// A project's chip filters on its ID, which a rename never breaks.
export const OPENSTACK_PROJECT_FACET_KEY: string = "openStackProjectId";

export function getOpenStackProjectFacet(
  openStackCloudId: ObjectID,
): ResourceFacet {
  const toOption: (row: OpenStackResource) => FilterChipDropdownOption = (
    row: OpenStackResource,
  ): FilterChipDropdownOption => {
    return {
      value: row.externalId || "",
      label: row.name || row.externalId || "",
    };
  };

  return {
    key: OPENSTACK_PROJECT_FACET_KEY,
    label: "Project",
    icon: IconProp.Folder,
    isMultiSelect: true,
    supportedOperators: IS_ONLY,
    loadOptions: async (
      _projectId: ObjectID,
      searchTerm: string,
    ): Promise<Array<FilterChipDropdownOption>> => {
      return (
        await listRows({
          openStackCloudId,
          kind: OpenStackResourceKind.Project,
          query: searchByName(searchTerm),
        })
      ).map(toOption);
    },
    resolveOptions: async (
      _projectId: ObjectID,
      values: Array<string>,
    ): Promise<Array<FilterChipDropdownOption>> => {
      return (
        await listRows({
          openStackCloudId,
          kind: OpenStackResourceKind.Project,
          query: { externalId: new Includes(values) },
        })
      ).map(toOption);
    },
  };
}

// By the hypervisor's full name, which is what an instance's own row holds.
export function getOpenStackHypervisorFacet(
  openStackCloudId: ObjectID,
): ResourceFacet {
  return {
    key: "hypervisorName",
    label: "Hypervisor",
    icon: IconProp.ServerStack,
    isMultiSelect: true,
    supportedOperators: IS_ONLY,
    loadOptions: async (
      _projectId: ObjectID,
      searchTerm: string,
    ): Promise<Array<FilterChipDropdownOption>> => {
      const seen: Set<string> = new Set<string>();
      const options: Array<FilterChipDropdownOption> = [];
      for (const row of await listRows({
        openStackCloudId,
        kind: OpenStackResourceKind.Hypervisor,
        query: searchByName(searchTerm),
      })) {
        const name: string = row.hypervisorName || row.name || "";
        if (name && !seen.has(name)) {
          seen.add(name);
          options.push({ value: name, label: name });
        }
      }
      return options;
    },
  };
}

/*
 * The zones hypervisors say they are in. Nova's "internal" is where its own control
 * services sit and no instance can go, so it is no zone to filter by.
 */
export function getOpenStackZoneFacet(
  openStackCloudId: ObjectID,
): ResourceFacet {
  return {
    key: "availabilityZone",
    label: "Availability Zone",
    icon: IconProp.MapPin,
    isMultiSelect: true,
    supportedOperators: IS_ONLY,
    fetchOptions: async (): Promise<Array<FilterChipDropdownOption>> => {
      const result: ListResult<OpenStackResource> =
        await ModelAPI.getList<OpenStackResource>({
          modelType: OpenStackResource,
          query: {
            openStackCloudId: openStackCloudId,
            kind: OpenStackResourceKind.Hypervisor,
          },
          limit: 500,
          skip: 0,
          select: { availabilityZone: true },
          sort: {},
        });
      const zones: Set<string> = new Set<string>();
      for (const row of result.data) {
        if (
          row.availabilityZone &&
          row.availabilityZone !== OPENSTACK_INTERNAL_ZONE
        ) {
          zones.add(row.availabilityZone);
        }
      }
      return toWordOptions(Array.from(zones).sort());
    },
  };
}

// Chips over keys of the facts column, which all write that one column and so add up.
function mergeFacts(existing: unknown, incoming: unknown): unknown {
  return { ...(existing as JSONObject), ...(incoming as JSONObject) };
}

function factsQuery(name: string, values: Array<string>): JSONObject {
  const facts: JSONObject = {};
  facts[name] =
    values.length === 1 ? values[0]! : (new Includes(values) as never);
  return facts;
}

/*
 * A chip on one of what OpenStack says of a kind and no other (a volume's type, an
 * image's visibility). A filter on a key of a JSON column, answered by the server.
 */
export function getOpenStackFactFacet(data: {
  key: string;
  label: string;
  factName: string;
  icon?: IconProp | undefined;
  options?: Array<FilterChipDropdownOption> | undefined;
  fetchOptions?: (() => Promise<Array<FilterChipDropdownOption>>) | undefined;
  loadOptions?:
    | ((searchTerm: string) => Promise<Array<FilterChipDropdownOption>>)
    | undefined;
}): ResourceFacet {
  return {
    key: data.key,
    label: data.label,
    icon: data.icon,
    isMultiSelect: true,
    supportedOperators: IS_ONLY,
    queryField: "facts",
    options: data.options,
    fetchOptions: data.fetchOptions,
    loadOptions: data.loadOptions
      ? (
          _projectId: ObjectID,
          searchTerm: string,
        ): Promise<Array<FilterChipDropdownOption>> => {
          return data.loadOptions!(searchTerm);
        }
      : undefined,
    handlesValuelessOperators: true,
    mergeQueryValue: mergeFacts,
    toQueryValue: (values: Array<string>): unknown => {
      return factsQuery(data.factName, values);
    },
  };
}

// By the flavor's own id, which an instance holds, with its name to read.
export function getOpenStackFlavorFacet(
  openStackCloudId: ObjectID,
): ResourceFacet {
  return getOpenStackFactFacet({
    key: "flavor",
    label: "Flavor",
    factName: "flavorId",
    icon: IconProp.SquareStack,
    loadOptions: async (
      searchTerm: string,
    ): Promise<Array<FilterChipDropdownOption>> => {
      const seen: Set<string> = new Set<string>();
      const options: Array<FilterChipDropdownOption> = [];
      for (const row of await listRows({
        openStackCloudId,
        kind: OpenStackResourceKind.Flavor,
        query: searchByName(searchTerm),
      })) {
        const id: string = getOpenStackFlavorId(row);
        if (id && !seen.has(id)) {
          seen.add(id);
          options.push({ value: id, label: row.name || id });
        }
      }
      return options;
    },
  });
}

/*
 * A state a list is asked for by name, which takes more than one column to say: stuck is
 * a word on the way to something else and how long it has been there. The lines are the
 * rules' own, so the chip finds exactly the rows the health rules call stuck.
 */
export interface OpenStackStatePreset {
  value: string;
  label: string;
  getQuery: (now: Date) => Query<OpenStackResource>;
}

export const OPENSTACK_STATE_FACET_KEY: string = "state";

export function getOpenStackStateFacet(
  presets: Array<OpenStackStatePreset>,
): ResourceFacet {
  return {
    key: OPENSTACK_STATE_FACET_KEY,
    label: "State",
    icon: IconProp.Alert,
    supportedOperators: IS_ONLY,
    options: presets.map(
      (preset: OpenStackStatePreset): FilterChipDropdownOption => {
        return { value: preset.value, label: preset.label };
      },
    ),
    // The list writes the preset's own query: this chip says which one.
    toQueryValue: (): unknown => {
      return undefined;
    },
  };
}

const LABEL_STUCK: string = translationKey("Stuck");
const LABEL_IN_ERROR: string = translationKey("In error");

function stuckPreset(data: {
  statuses: ReadonlySet<string>;
  minutes: number;
}): OpenStackStatePreset {
  return {
    value: "stuck",
    label: LABEL_STUCK,
    getQuery: (now: Date): Query<OpenStackResource> => {
      return {
        status: new Includes(Array.from(data.statuses)),
        stateChangedAt: new LessThanOrEqual<Date>(
          new Date(now.getTime() - data.minutes * 60 * 1000),
        ),
      };
    },
  };
}

export const OPENSTACK_INSTANCE_STATE_PRESETS: Array<OpenStackStatePreset> = [
  stuckPreset({
    statuses: OPENSTACK_INSTANCE_TRANSITIONAL_STATUSES,
    minutes: OPENSTACK_INSTANCE_STUCK_MINUTES,
  }),
  {
    value: "error",
    label: LABEL_IN_ERROR,
    getQuery: (): Query<OpenStackResource> => {
      return { status: "ERROR" };
    },
  },
];

export const OPENSTACK_VOLUME_STATE_PRESETS: Array<OpenStackStatePreset> = [
  stuckPreset({
    statuses: OPENSTACK_VOLUME_TRANSITIONAL_STATUSES,
    minutes: OPENSTACK_VOLUME_STUCK_MINUTES,
  }),
  {
    value: "error",
    label: LABEL_IN_ERROR,
    getQuery: (): Query<OpenStackResource> => {
      return {
        status: new Includes(Array.from(OPENSTACK_VOLUME_ERROR_STATUSES)),
      };
    },
  },
];

export const OPENSTACK_IMAGE_STATE_PRESETS: Array<OpenStackStatePreset> = [
  stuckPreset({
    statuses: OPENSTACK_IMAGE_TRANSITIONAL_STATUSES,
    minutes: OPENSTACK_IMAGE_STUCK_MINUTES,
  }),
];
