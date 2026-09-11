import PageComponentProps from "../../PageComponentProps";
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import ObjectID from "Common/Types/ObjectID";
import { useParams } from "react-router-dom";
import React, { FunctionComponent, ReactElement } from "react";

const CloudResourceSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");

  return (
    <ArchiveResourceCard<CloudResource>
      modelType={CloudResource}
      modelId={modelId}
      singularName="cloud environment"
      listRoute={RouteUtil.populateRouteParams(
        RouteMap[PageMap.CLOUD_RESOURCES] as Route,
      )}
    />
  );
};

export default CloudResourceSettings;
