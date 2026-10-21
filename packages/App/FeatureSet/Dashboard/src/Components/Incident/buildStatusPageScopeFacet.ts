import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import Search from "Common/Types/BaseDatabase/Search";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { buildEntityFacetQuery } from "../ResourceOwners/FacetColumnQuery";
import {
  FilterChipDropdownOption,
  FilterOperator,
} from "../ResourceOwners/FilterChipDropdownTypes";
import { ResourceFacet } from "../ResourceOwners/ResourceFacet";
import IncidentStatusPageScopeCopy from "./IncidentStatusPageScopeCopy";

/*
 * The incidents table's "Status Page" chip: incidents limited to the picked
 * status pages (Incident.statusPages). "Is" finds incidents limited to any
 * of them, "is not" the rest, and "is empty" the incidents that are not
 * limited to any page - the ones every page that lists their monitors shows.
 *
 * It filters on the scope, not on where an incident shows: an unscoped
 * incident on a monitor a page lists is shown on that page but is not
 * "limited" to it. The id list becomes a join-table filter on the server
 * (QueryUtil), like the Labels chip.
 */

const OPTION_PAGE_SIZE: number = 50;

const toOption: (statusPage: StatusPage) => FilterChipDropdownOption = (
  statusPage: StatusPage,
): FilterChipDropdownOption => {
  return {
    value: statusPage._id?.toString() || statusPage.id?.toString() || "",
    label: statusPage.name?.toString() || "",
  };
};

const buildStatusPageScopeFacet: () => ResourceFacet = (): ResourceFacet => {
  return {
    key: "statusPages",
    label: IncidentStatusPageScopeCopy.tableFilterLabel,
    icon: IconProp.Globe,
    isMultiSelect: true,
    searchPlaceholder: IncidentStatusPageScopeCopy.tableFilterSearchPlaceholder,
    loadOptions: async (
      projectId: ObjectID,
      searchTerm: string,
    ): Promise<Array<FilterChipDropdownOption>> => {
      const query: Query<StatusPage> = {
        projectId: projectId,
      } as Query<StatusPage>;

      if (searchTerm.trim()) {
        (query as unknown as Record<string, unknown>)["name"] = new Search(
          searchTerm.trim(),
        );
      }

      const result: ListResult<StatusPage> = await ModelAPI.getList<StatusPage>(
        {
          modelType: StatusPage,
          query: query,
          limit: OPTION_PAGE_SIZE,
          skip: 0,
          select: { _id: true, name: true },
          sort: { name: SortOrder.Ascending },
        },
      );

      return result.data.map(toOption);
    },
    resolveOptions: async (
      projectId: ObjectID,
      values: Array<string>,
    ): Promise<Array<FilterChipDropdownOption>> => {
      if (values.length === 0) {
        return [];
      }

      const result: ListResult<StatusPage> = await ModelAPI.getList<StatusPage>(
        {
          modelType: StatusPage,
          query: {
            projectId: projectId,
            _id: new Includes(values),
          } as Query<StatusPage>,
          limit: values.length,
          skip: 0,
          select: { _id: true, name: true },
          sort: {},
        },
      );

      return result.data.map(toOption);
    },
    toQueryValue: (
      values: Array<string>,
      operator: FilterOperator,
    ): unknown => {
      return buildEntityFacetQuery(values, operator, true);
    },
  };
};

export default buildStatusPageScopeFacet;
