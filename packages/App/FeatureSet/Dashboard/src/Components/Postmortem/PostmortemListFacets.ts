import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentPostmortemStatus from "Common/Models/DatabaseModels/IncidentPostmortemStatus";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import Search from "Common/Types/BaseDatabase/Search";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import buildAffectedResourcesFacet from "../AffectedResources/buildAffectedResourcesFacet";
import {
  ARCHIVED_FACET_SELECT,
  getArchivableValueFacetOptions,
} from "../ArchivableValue/ArchivedValueFacetOptions";
import { buildEntityFacetQuery } from "../ResourceOwners/FacetColumnQuery";
import {
  FilterChipDropdownOption,
  FilterOperator,
} from "../ResourceOwners/FilterChipDropdownTypes";
import { ResourceFacet } from "../ResourceOwners/ResourceFacet";
import {
  POSTMORTEM_STATUS_FACET_KEY,
  POSTMORTEM_STATUS_FACET_LABEL,
} from "./PostmortemListFacetKeys";

/*
 * The chips of the Postmortems list (Incidents > Postmortems), beside the
 * Owner and Labels chips every list of incidents has: the postmortem's
 * status, the incident's severity and state, and what it affects. "Which
 * postmortems does the database team still owe for critical incidents?" is
 * Owner, Severity and Postmortem Status together.
 *
 * Every chip offers archived values too - old incidents keep them - after
 * the live ones, under "Archived" (getArchivableValueFacetOptions).
 */

// A value model the chips read: a status, a severity or a state.
interface ColoredValue extends BaseModel {
  name?: string | undefined;
  color?: unknown;
}

const toColoredOption: (value: ColoredValue) => FilterChipDropdownOption = (
  value: ColoredValue,
): FilterChipDropdownOption => {
  return {
    value: value.id?.toString() || "",
    label: value.name?.toString() || "",
    color: value.color?.toString() || "#9ca3af",
  };
};

/*
 * A chip over a value model the project orders (statuses, severities,
 * states): searched on the server by name, the archived ones last.
 */
const buildValueFacet: <T extends ColoredValue>(data: {
  key: string;
  label: string;
  icon: IconProp;
  searchPlaceholder: string;
  modelType: { new (): T };
}) => ResourceFacet = <T extends ColoredValue>(data: {
  key: string;
  label: string;
  icon: IconProp;
  searchPlaceholder: string;
  modelType: { new (): T };
}): ResourceFacet => {
  return {
    key: data.key,
    label: data.label,
    icon: data.icon,
    isMultiSelect: true,
    searchPlaceholder: data.searchPlaceholder,
    loadOptions: async (
      projectId: ObjectID,
      searchTerm: string,
    ): Promise<Array<FilterChipDropdownOption>> => {
      const query: Record<string, unknown> = {
        projectId: projectId,
      };

      if (searchTerm.trim()) {
        query["name"] = new Search(searchTerm.trim());
      }

      const result: ListResult<T> = await ModelAPI.getList<T>({
        modelType: data.modelType,
        query: query as Query<T>,
        limit: 50,
        skip: 0,
        select: {
          _id: true,
          name: true,
          order: true,
          color: true,
          ...ARCHIVED_FACET_SELECT,
        } as Record<string, true>,
        sort: { order: SortOrder.Ascending } as Record<string, SortOrder>,
      });

      // Archived values too - old incidents have them - listed last.
      return getArchivableValueFacetOptions({
        values: result.data,
        toOption: toColoredOption,
      });
    },
    resolveOptions: async (
      projectId: ObjectID,
      values: Array<string>,
    ): Promise<Array<FilterChipDropdownOption>> => {
      if (values.length === 0) {
        return [];
      }

      const result: ListResult<T> = await ModelAPI.getList<T>({
        modelType: data.modelType,
        query: {
          projectId: projectId,
          _id: new Includes(values),
        } as unknown as Query<T>,
        limit: values.length,
        skip: 0,
        select: { _id: true, name: true, color: true } as Record<string, true>,
        sort: {},
      });

      return result.data.map(toColoredOption);
    },
    toQueryValue: (
      values: Array<string>,
      operator: FilterOperator,
    ): unknown => {
      return buildEntityFacetQuery(values, operator, true);
    },
  };
};

/*
 * A module-level constant on purpose: useResourceOwners derives its facet
 * lookups from this array, so a fresh array on every render would churn
 * them.
 */
export const POSTMORTEM_LIST_FACETS: Array<ResourceFacet> = [
  buildValueFacet<IncidentPostmortemStatus>({
    key: POSTMORTEM_STATUS_FACET_KEY,
    label: POSTMORTEM_STATUS_FACET_LABEL,
    icon: IconProp.ClipboardDocumentCheck,
    searchPlaceholder: translationKey("Search statuses..."),
    modelType: IncidentPostmortemStatus,
  }),
  buildValueFacet<IncidentSeverity>({
    key: "incidentSeverity",
    label: translationKey("Severity"),
    icon: IconProp.Fire,
    searchPlaceholder: translationKey("Search severities..."),
    modelType: IncidentSeverity,
  }),
  buildValueFacet<IncidentState>({
    key: "currentIncidentState",
    label: translationKey("Incident State"),
    icon: IconProp.Flag,
    searchPlaceholder: translationKey("Search states..."),
    modelType: IncidentState,
  }),
  buildAffectedResourcesFacet<Incident>({
    parentModelType: Incident,
    // Burn rate incidents are linked to the SLO that declared them.
    includeServiceLevelObjective: true,
    includeCloudResource: true,
  }),
];
