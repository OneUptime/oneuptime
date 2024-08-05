import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import ModelDelete from "CommonUI/src/Components/ModelDelete/ModelDelete";
import Navigation from "CommonUI/src/Utils/Navigation";
import Incident from "Common/AppModels/Models/Incident";
import React, { FunctionComponent, ReactElement } from "react";

const IncidentDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <ModelDelete
      modelType={Incident}
      modelId={modelId}
      onDeleteSuccess={() => {
        Navigation.navigate(
          RouteUtil.populateRouteParams(RouteMap[PageMap.INCIDENTS] as Route, {
            modelId,
          }),
        );
      }}
    />
  );
};

export default IncidentDelete;
