import PageMap from "../../../../Utils/PageMap";
import RouteMap from "../../../../Utils/RouteMap";
import PageComponentProps from "../../../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import ModelDelete from "CommonUI/src/Components/ModelDelete/ModelDelete";
import Navigation from "CommonUI/src/Utils/Navigation";
import TelemetryService from "Model/Models/TelemetryService";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const ServiceDelete: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ModelDelete
        modelType={TelemetryService}
        modelId={modelId}
        onDeleteSuccess={() => {
          Navigation.navigate(RouteMap[PageMap.TELEMETRY_SERVICES] as Route);
        }}
      />
    </Fragment>
  );
};

export default ServiceDelete;
