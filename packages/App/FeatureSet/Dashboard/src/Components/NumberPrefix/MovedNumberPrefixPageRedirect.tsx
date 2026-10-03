import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Location, Navigate, useLocation } from "react-router-dom";

export interface ComponentProps {
  // The Number Prefix page that replaced More Settings at this URL.
  pageMap: PageMap;
}

/*
 * Number prefixes lived on a page called More Settings
 * (…/incidents/settings/more, and the same under alerts and scheduled
 * maintenance) until they got a Number Prefix page of their own. Bookmarks
 * and older docs still point at the old address, so it forwards to the new
 * page - in the same project, keeping the query string and the hash, and
 * replacing the history entry so Back does not bounce through it.
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
