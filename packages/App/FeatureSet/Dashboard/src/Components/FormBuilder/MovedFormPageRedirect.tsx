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
  // The Forms page that replaced the incident forms page at this URL.
  pageMap: PageMap.FORMS | PageMap.FORM_VIEW;
}

/*
 * Incident forms lived under Incidents > Settings > Forms
 * (…/incidents/settings/forms and …/settings/forms/:id) before Forms became
 * a product of its own, and the migration that moved them kept every form's
 * id. Bookmarks and links to the old pages forward to the same form in
 * Forms instead of landing on a blank Incidents page - keeping the query
 * string and the hash.
 */
const MovedFormPageRedirect: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const params: Readonly<Params<string>> = useParams();
  const location: Location = useLocation();

  const modelId: string | undefined =
    params[RouteParams.ModelID.replace(":", "")];

  const destination: Route = RouteUtil.populateRouteParams(
    RouteMap[props.pageMap] as Route,
    props.pageMap === PageMap.FORM_VIEW && modelId ? { modelId } : undefined,
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

export default MovedFormPageRedirect;
