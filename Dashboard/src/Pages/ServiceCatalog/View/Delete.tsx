import PageMap from "../../../Utils/PageMap";
import RouteMap from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import ModelDelete from "Common/UI/src/Components/ModelDelete/ModelDelete";
import Navigation from "Common/UI/src/Utils/Navigation";
import ServiceCatalog from "Common/Models/DatabaseModels/ServiceCatalog";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const ServiceCatalogDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ModelDelete
        modelType={ServiceCatalog}
        modelId={modelId}
        onDeleteSuccess={() => {
          Navigation.navigate(RouteMap[PageMap.SERVICE_CATALOG] as Route);
        }}
      />
    </Fragment>
  );
};

export default ServiceCatalogDelete;
