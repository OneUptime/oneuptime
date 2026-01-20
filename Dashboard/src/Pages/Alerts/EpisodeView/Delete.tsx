import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import Navigation from "Common/UI/Utils/Navigation";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import React, { FunctionComponent, ReactElement } from "react";

const EpisodeDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <ModelDelete
      modelType={AlertEpisode}
      modelId={modelId}
      onDeleteSuccess={() => {
        Navigation.navigate(
          RouteUtil.populateRouteParams(
            RouteMap[PageMap.ALERT_EPISODES] as Route,
            {
              modelId,
            },
          ),
        );
      }}
    />
  );
};

export default EpisodeDelete;
