import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  APP_PLATFORMS_APPS_TABLE_ID,
  APP_PLATFORMS_ENVIRONMENTS_TABLE_ID,
  CLOUD_ACCOUNT_FACET_KEY,
} from "./AppPlatformsAccountFacet";
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
 * (AppPlatformsAccountFacet). No account, no chip: the whole list. Cloud's
 * All Resources is linked to the same way (CloudResourcesListRoute).
 *
 * Kept apart from AppPlatformsAccountFacet: the route map reads the app's
 * config, which reads `window` when it loads.
 */

export function getRouteWithCloudAccountChip(data: {
  route: Route;
  tableId: string;
  accountIds: ReadonlyArray<string>;
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

  if (accountIds.length === 0) {
    return data.route;
  }

  // The two fields the bar reads back; the rest takes its defaults.
  const facets: JSONObject = {
    facetSelections: {
      [CLOUD_ACCOUNT_FACET_KEY]: accountIds,
    } as unknown as JSONObject,
    facetOperators: {
      [CLOUD_ACCOUNT_FACET_KEY]: "is",
    } as unknown as JSONObject,
  };

  const params: Dictionary<string> = TableFilterUrlState.getLinkQueryParams(
    data.tableId,
    { facets },
  );

  return data.route.addQueryParams(params);
}

// App Platforms > All Environments, in these accounts.
export function getAppPlatformsEnvironmentsRoute(
  accountIds: ReadonlyArray<string> = [],
): Route {
  return getRouteWithCloudAccountChip({
    route: RouteUtil.populateRouteParams(
      RouteMap[PageMap.APP_PLATFORMS_ENVIRONMENTS] as Route,
    ),
    tableId: APP_PLATFORMS_ENVIRONMENTS_TABLE_ID,
    accountIds,
  });
}

// App Platforms > All Apps, of the environments in these accounts.
export function getAppPlatformsAppsRoute(
  accountIds: ReadonlyArray<string> = [],
): Route {
  return getRouteWithCloudAccountChip({
    route: RouteUtil.populateRouteParams(
      RouteMap[PageMap.APP_PLATFORMS_APPS] as Route,
    ),
    tableId: APP_PLATFORMS_APPS_TABLE_ID,
    accountIds,
  });
}
