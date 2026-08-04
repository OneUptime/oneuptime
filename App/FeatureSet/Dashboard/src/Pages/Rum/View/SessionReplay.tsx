import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Navigation from "Common/UI/Utils/Navigation";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import SessionReplayTable from "../../../Components/SessionReplay/SessionReplayTable";
import SessionReplaySetupGuide from "../../../Components/SessionReplay/SessionReplaySetupGuide";
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
        <Button
          title="Session replay settings"
          icon={IconProp.Settings}
          buttonStyle={ButtonStyleType.OUTLINE}
          onClick={(): void => {
            Navigation.navigate(
              RouteUtil.populateRouteParams(
                RouteMap[
                  PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_SETTINGS
                ] as Route,
                { modelId: modelId },
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

      {/*
       * The setup guide is rendered by the table, not beside it: only the
       * table knows whether the empty list is "never set up" or "your
       * filters matched nothing", and showing installation steps to
       * somebody who simply over-filtered would be noise.
       */}
      <SessionReplayTable
        rumApplicationId={modelId}
        renderWhenEmpty={<SessionReplaySetupGuide rumApplicationId={modelId} />}
      />
    </Fragment>
  );
};

export default RumApplicationSessionReplay;
