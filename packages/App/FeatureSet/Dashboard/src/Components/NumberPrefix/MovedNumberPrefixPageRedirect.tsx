import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Location, Navigate, useLocation } from "react-router-dom";

export interface ComponentProps {
  // The Numbering page that replaced the page at this URL.
  pageMap: PageMap;
}

/*
 * Number prefixes lived on a page called More Settings
 * (…/incidents/settings/more, and the same under alerts and scheduled
 * maintenance), then on a Number Prefix page of their own
 * (…/settings/number-prefix), which became Numbering once it held the next
 * numbers too. Bookmarks and older docs still point at the old addresses,
 * so each forwards to Numbering - in the same project, keeping the query
 * string and the hash, and replacing the history entry so Back does not
 * bounce through it.
 */
const MovedNumberPrefixPageRedirect: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const location: Location = useLocation();

  const destination: Route = RouteUtil.populateRouteParams(
    RouteMap[props.pageMap] as Route,
  );

  return (
    <Navigate
      replace={true}
      to={{
        pathname: destination.toString(),
        search: location.search,
        hash: location.hash,
      }}
    />
  );
};

export default MovedNumberPrefixPageRedirect;
