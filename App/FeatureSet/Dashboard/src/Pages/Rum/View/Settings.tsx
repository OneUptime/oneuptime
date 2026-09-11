import PageComponentProps from "../../PageComponentProps";
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import ObjectID from "Common/Types/ObjectID";
import { useParams } from "react-router-dom";
import React, { FunctionComponent, ReactElement } from "react";

const RumApplicationSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");

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
