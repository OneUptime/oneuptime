import PageComponentProps from "../../PageComponentProps";
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ServerlessFunction from "Common/Models/DatabaseModels/ServerlessFunction";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const ServerlessFunctionSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <ArchiveResourceCard<ServerlessFunction>
      modelType={ServerlessFunction}
      modelId={modelId}
      singularName="function"
      listRoute={RouteUtil.populateRouteParams(
        RouteMap[PageMap.SERVERLESS_FUNCTIONS] as Route,
      )}
    />
  );
};

export default ServerlessFunctionSettings;
