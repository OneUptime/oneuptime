import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import RouteParams from "../../Utils/RouteParams";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import {
  Location,
  Navigate,
  Params,
  useLocation,
  useParams,
} from "react-router-dom";

export interface ComponentProps {
  // The page that replaced the one that used to be at this URL.
  pageMap: PageMap;
}

/*
 * Mounted at the URL of a page that no longer exists, in place of the page:
 * forwards to the page that took over its job, keeping the resource id (the
 * route's `:id`), the query string and the hash, so a bookmark or a link in
 * a wiki still arrives somewhere useful instead of on a blank page. The old
 * entry is replaced in the history, so Back does not bounce through it.
 *
 * A status page's Advanced Options page (…/status-pages/:id/advanced-options)
 * is one: no menu linked to it, and what it held lives on Embedded Status
 * and Advanced Settings now.
 */
const MovedPageRedirect: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const params: Readonly<Params<string>> = useParams();
  const location: Location = useLocation();

  const modelId: string | undefined =
    params[RouteParams.ModelID.replace(":", "")];

  const destination: Route = RouteUtil.populateRouteParams(
    RouteMap[props.pageMap] as Route,
    modelId ? { modelId } : undefined,
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

export default MovedPageRedirect;
