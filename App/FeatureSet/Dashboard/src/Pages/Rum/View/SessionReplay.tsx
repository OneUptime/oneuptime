import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Navigation from "Common/UI/Utils/Navigation";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import SessionReplayTable from "../../../Components/SessionReplay/SessionReplayTable";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";

const RumApplicationSessionReplay: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  /*
   * Route is ":id/session-replay", so the model id is one segment before the
   * end. Same as Pages/Rum/View/Clients.tsx.
   */
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <div className="mb-4 flex justify-end gap-2">
        {/*
         * The privacy controls live on a project-level settings page that is
         * not reachable from this application's side menu, so the list links
         * to it directly. Somebody looking at an empty session list is
         * almost always looking for the switch that turns recording on.
         */}
        <Button
          title="Session replay settings"
          icon={IconProp.Settings}
          buttonStyle={ButtonStyleType.OUTLINE}
          onClick={(): void => {
            Navigation.navigate(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.RUM_SETTINGS_SESSION_REPLAY] as Route,
              ),
            );
          }}
        />
        <Button
          title="Who watched"
          icon={IconProp.Eye}
          buttonStyle={ButtonStyleType.OUTLINE}
          onClick={(): void => {
            Navigation.navigate(
              RouteUtil.populateRouteParams(
                RouteMap[
                  PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_AUDIT
                ] as Route,
                { modelId: modelId },
              ),
            );
          }}
        />
      </div>

      <SessionReplayTable rumApplicationId={modelId} />
    </Fragment>
  );
};

export default RumApplicationSessionReplay;
