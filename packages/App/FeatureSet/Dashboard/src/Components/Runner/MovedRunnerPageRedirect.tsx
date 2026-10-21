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
  // The Runbooks page that replaced the Settings page at this URL.
  pageMap: PageMap;
}

/*
 * The Runner pages lived under Project Settings (…/settings/runners) before
 * they moved into Runbooks. Bookmarks, wiki links and the messages an older
 * Runner binary prints still point at the old URLs, so each one forwards to
 * its new home instead of landing on a blank Settings page — keeping the
 * Runner id, the query string and the hash.
 */
const MovedRunnerPageRedirect: FunctionComponent<ComponentProps> = (
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

export default MovedRunnerPageRedirect;
