import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageMap from "../../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import Dictionary from "Common/Types/Dictionary";
import TableFilterUrlState from "Common/UI/Utils/TableFilterUrlState";

/*
 * Where Security Events > Rule Exceptions lives, and how a rule's View
 * Exceptions lands on it already filtered to that rule: through the table's
 * own Rule filter in the address (TableFilterUrlState), so the filter shows
 * as applied, Back returns to it, and clearing it shows every exception.
 */

// The list's table: its test id, its preferences and the key of its state in the address.
export const RULE_EXCEPTIONS_TABLE_ID: string = "rule-exceptions-table";

// The filter key the list's Rule filter reads: the exception's rule id.
export const RULE_EXCEPTIONS_RULE_FILTER_KEY: string = "detectionRuleId";

export function getRuleExceptionsFilterParams(
  detectionRuleId: string,
): Dictionary<string> {
  return TableFilterUrlState.getLinkQueryParams(RULE_EXCEPTIONS_TABLE_ID, {
    filter: { [RULE_EXCEPTIONS_RULE_FILTER_KEY]: detectionRuleId },
  });
}

// The list, or with a rule's id, the list of that rule's exceptions.
export function getRuleExceptionsRoute(detectionRuleId?: string): Route {
  const route: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.SECURITY_EVENTS_RULE_EXCEPTIONS] as Route,
  ) as Route;

  if (!detectionRuleId) {
    return route;
  }

  return route.addQueryParams(getRuleExceptionsFilterParams(detectionRuleId));
}
