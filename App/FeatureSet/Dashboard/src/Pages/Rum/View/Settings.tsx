import PageComponentProps from "../../PageComponentProps";
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const RumApplicationSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <ArchiveResourceCard<RumApplication>
      modelType={RumApplication}
      modelId={modelId}
      singularName="application"
      listRoute={RouteUtil.populateRouteParams(
        RouteMap[PageMap.RUM_APPLICATIONS] as Route,
      )}
    />
  );
};

export default RumApplicationSettings;
