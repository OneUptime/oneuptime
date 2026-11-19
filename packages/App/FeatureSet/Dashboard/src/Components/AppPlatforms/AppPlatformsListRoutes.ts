import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  APP_PLATFORMS_APPS_TABLE_ID,
  APP_PLATFORMS_ENVIRONMENTS_TABLE_ID,
  CLOUD_ACCOUNT_FACET_KEY,
} from "./AppPlatformsAccountFacet";
import {
  CloudEnvironmentStatus,
  ENVIRONMENT_STATUS_FACET_KEY,
} from "./AppPlatformsEnvironmentStatus";
import Route from "Common/Types/API/Route";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import TableFilterUrlState from "Common/UI/Utils/TableFilterUrlState";

/*
 * Links into App Platforms' lists, already narrowed to some cloud accounts:
 * what a count elsewhere - Cloud's Overview - counted, so the list it opens
 * holds exactly that. The chip travels in the list's own URL namespace, the
 * parameter its facet bar writes when someone sets it by hand, so the list
 * arrives with it visibly set, editable and clearable
 * (AppPlatformsAccountFacet). No account, no chip: the whole list.
 *
 * Kept apart from AppPlatformsAccountFacet: the route map reads the app's
 * config, which reads `window` when it loads.
 */

function withAccounts(data: {
  route: Route;
  tableId: string;
  accountIds: ReadonlyArray<string>;
  // All Environments' Status chip, set to these (#9751).
  statuses?: ReadonlyArray<CloudEnvironmentStatus> | undefined;
}): Route {
  const accountIds: Array<string> = Array.from(
    new Set(
      data.accountIds
        .map((accountId: string): string => {
          return accountId.trim();
        })
        .filter((accountId: string): boolean => {
          return accountId.length > 0;
        }),
    ),
  );
  const statuses: Array<CloudEnvironmentStatus> = Array.from(
    new Set(data.statuses || []),
  );

  if (accountIds.length === 0 && statuses.length === 0) {
    return data.route;
  }

  const selections: JSONObject = {};
  const operators: JSONObject = {};

  if (accountIds.length > 0) {
    selections[CLOUD_ACCOUNT_FACET_KEY] = accountIds;
    operators[CLOUD_ACCOUNT_FACET_KEY] = "is";
  }

  if (statuses.length > 0) {
    selections[ENVIRONMENT_STATUS_FACET_KEY] = statuses;
    operators[ENVIRONMENT_STATUS_FACET_KEY] = "is";
  }

  // The two fields the bar reads back; the rest takes its defaults.
  const facets: JSONObject = {
    facetSelections: selections,
    facetOperators: operators,
  };

  const params: Dictionary<string> = TableFilterUrlState.getLinkQueryParams(
    data.tableId,
    { facets },
  );

  return data.route.addQueryParams(params);
}

/*
 * App Platforms > All Environments, in these accounts - and, with
 * statuses, only the environments of those (the Overview's "2 environments
 * disconnected", #9751).
 */
export function getAppPlatformsEnvironmentsRoute(
  accountIds: ReadonlyArray<string> = [],
  options?: { statuses?: ReadonlyArray<CloudEnvironmentStatus> | undefined },
): Route {
  return withAccounts({
    route: RouteUtil.populateRouteParams(
      RouteMap[PageMap.APP_PLATFORMS_ENVIRONMENTS] as Route,
    ),
    tableId: APP_PLATFORMS_ENVIRONMENTS_TABLE_ID,
    accountIds,
    statuses: options?.statuses,
  });
}

// App Platforms > All Apps, of the environments in these accounts.
export function getAppPlatformsAppsRoute(
  accountIds: ReadonlyArray<string> = [],
): Route {
  return withAccounts({
    route: RouteUtil.populateRouteParams(
      RouteMap[PageMap.APP_PLATFORMS_APPS] as Route,
    ),
    tableId: APP_PLATFORMS_APPS_TABLE_ID,
    accountIds,
  });
}
