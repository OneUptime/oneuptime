import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import RouteParams from "../../Utils/RouteParams";
import Route from "Common/Types/API/Route";
import Dictionary from "Common/Types/Dictionary";
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
  /*
   * Query parameters the new page needs to show what the old one did, such
   * as which tab: the old Alert On-Call Rules page forwards to On-Call Rules
   * with `type=alerts`. They are added to the old URL's own query string, and
   * win over a parameter of the same name in it, since the old page's address
   * is what said which tab it was.
   */
  searchParams?: Dictionary<string> | undefined;
}

/*
 * The query string to forward: the old URL's own, plus `searchParams`.
 * Returned with its leading "?", or "" when there is nothing to carry.
 */
export const getForwardedSearch: (data: {
  search: string;
  searchParams?: Dictionary<string> | undefined;
}) => string = (data: {
  search: string;
  searchParams?: Dictionary<string> | undefined;
}): string => {
  if (!data.searchParams || Object.keys(data.searchParams).length === 0) {
    return data.search;
  }

  const params: URLSearchParams = new URLSearchParams(data.search);

  for (const name of Object.keys(data.searchParams)) {
    params.set(name, data.searchParams[name] as string);
  }

  const query: string = params.toString();

  return query ? `?${query}` : "";
};

/*
 * Mounted at the URL of a page that no longer exists, in place of the page:
 * forwards to the page that took over its job, keeping the resource id (the
 * route's `:id`), the query string and the hash, so a bookmark or a link in
 * a wiki still arrives somewhere useful instead of on a blank page. The old
 * entry is replaced in the history, so Back does not bounce through it.
 *
 * A status page's Advanced Options page (…/status-pages/:id/advanced-options)
 * is one: no menu linked to it, and what it held lives on Embedded Status
 * and Advanced Settings now. So are the screens its Branding section used to
 * be split into (header-style, footer-style, overview-page-branding,
 * languages, and the empty navbar-style): they forward to the one Branding
 * page. And the four on-call rule pages (incident, incident episode, alert,
 * alert episode), in User Settings and under Users > (a member): they forward
 * to the one On-Call Rules page, on the tab they used to be.
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
        search: getForwardedSearch({
          search: location.search,
          searchParams: props.searchParams,
        }),
        hash: location.hash,
      }}
    />
  );
};

export default MovedPageRedirect;
