import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement, useEffect } from "react";

/*
 * Users > View > Notification Rules — now a redirect, and nothing else.
 *
 * This route used to render the whole of an administrator's view of somebody
 * else's on-call configuration on one page: a readiness summary with four stat
 * tiles, the notification methods list, the coverage grid, and four rule types
 * that each expand to one card per severity band. On a project with six
 * incident and six alert severities that was around fifty cards under a
 * diagnosis nobody could still see, and the diagnosis was the part that
 * mattered.
 *
 * It is six pages now, under Users > View > On-Call, and this one sends its
 * visitors to the overview. The route is kept rather than deleted because it is
 * the URL people bookmarked, pasted into tickets and linked from chat, and a
 * 404 for those readers would be a worse outcome than an extra hop.
 *
 * The redirect runs from an effect rather than during render because
 * Navigation.navigate reaches for the router's navigate hook, and calling that
 * while a component is rendering is a React state update during render. A
 * loader is returned in the meantime: this component is on screen for one
 * frame, and an empty fragment for that frame reads as a broken page.
 */
const UserViewNotificationRules: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  /*
   * Offset 1, not 0. The last segment of the URL is "notification-rules" and
   * the model id is the one before it.
   */
  const userId: ObjectID = Navigation.getLastParamAsObjectID(1);

  useEffect(() => {
    Navigation.navigate(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.USER_VIEW_ON_CALL_READINESS] as Route,
        { modelId: userId },
      ),
    );
  }, []);

  return <PageLoader isVisible={true} />;
};

export default UserViewNotificationRules;
