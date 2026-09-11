import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Route from "Common/Types/API/Route";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { Navigate } from "react-router-dom";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import SessionReplayTable from "../../../Components/SessionReplay/SessionReplayTable";
import RecordingHealthStrip from "../../../Components/SessionReplay/RecordingHealthStrip";
import {
  buildTimeRangeSearch,
  readTimeRangeFromSearch,
} from "../../../Components/SessionReplay/SessionReplayListFilters";

/*
 * The query key and value the list wrote while Users was a toggle on it.
 * Links minted then still resolve: they land on the Users page instead.
 */
export const LEGACY_USERS_VIEW_QUERY_KEY: string = "view";
export const LEGACY_USERS_VIEW_QUERY_VALUE: string = "users";

/* Recording health stays outside the table; setup lives on Documentation. */
const RumApplicationSessionReplay: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  /*
   * Route is ":id/session-replay", so the model id is one segment before the
   * end. Same as Pages/Rum/View/Clients.tsx.
   */
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  /*
   * ?view=users predates the Users page: the rollup was a toggle on this
   * list for a while, and links to it exist in tickets and bookmarks. A
   * replace, not a push, so Back does not bounce through the redirect; the
   * time range is carried so the link still opens the window it named.
   */
  if (
    Navigation.getQueryStringByName(LEGACY_USERS_VIEW_QUERY_KEY) ===
    LEGACY_USERS_VIEW_QUERY_VALUE
  ) {
    const usersRoute: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_USERS] as Route,
      { modelId: modelId },
    );

    return (
      <Navigate
        replace={true}
        to={`${usersRoute.toString()}${buildTimeRangeSearch(
          readTimeRangeFromSearch(window.location.search),
        )}`}
      />
    );
  }

  return (
    <Fragment>
      <RecordingHealthStrip rumApplicationId={modelId} />
      <SessionReplayTable rumApplicationId={modelId} />
    </Fragment>
  );
};

export default RumApplicationSessionReplay;
