import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import DataSecurityIssueStatus from "Common/Types/DataSecurity/DataSecurityIssueStatus";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import TableFilterUrlState from "Common/UI/Utils/TableFilterUrlState";

/*
 * Links into Data Security > Issues, already narrowed: the issues behind a
 * failing compliance requirement (its checks), or one store's. The filter
 * travels in the list's own URL namespace - the parameter its Filters
 * dialog writes - so the list arrives with the filter visibly set,
 * editable and clearable.
 */

// The Issues list's table, and the namespace of its URL state.
export const DATA_SECURITY_ISSUES_TABLE_ID: string = "data-security-issues";

export interface IssueListFilter {
  checkIds?: Array<string> | undefined;
  dataStoreId?: ObjectID | undefined;
  // Open issues when left out, as the list opens.
  statuses?: Array<DataSecurityIssueStatus> | undefined;
}

export function getIssueListRoute(filter: IssueListFilter = {}): Route {
  const route: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.DATA_SECURITY_ISSUES] as Route,
  );

  const filterData: JSONObject = {
    status: filter.statuses || [DataSecurityIssueStatus.Open],
  };

  if (filter.checkIds && filter.checkIds.length > 0) {
    filterData["checkId"] = filter.checkIds;
  }

  // The store filter picks one store: "is" that store.
  if (filter.dataStoreId) {
    filterData["dataStoreId"] = filter.dataStoreId.toString();
  }

  const params: Dictionary<string> = TableFilterUrlState.getLinkQueryParams(
    DATA_SECURITY_ISSUES_TABLE_ID,
    { filter: filterData },
  );

  return route.addQueryParams(params);
}

// One issue's page.
export function getIssueViewRoute(issueId: ObjectID | string): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.DATA_SECURITY_ISSUE_VIEW] as Route,
    { modelId: new ObjectID(issueId.toString()) },
  );
}

// One store's page.
export function getStoreViewRoute(dataStoreId: ObjectID | string): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.DATA_SECURITY_STORE_VIEW] as Route,
    { modelId: new ObjectID(dataStoreId.toString()) },
  );
}
