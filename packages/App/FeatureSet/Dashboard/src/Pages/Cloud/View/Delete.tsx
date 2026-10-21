import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import Navigation from "Common/UI/Utils/Navigation";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { useCloudResourceViewContext } from "./CloudResourceViewContext";
import { isCloudResourceKindResource } from "Common/Types/Cloud/CloudResourceKind";

const CloudResourceDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const { cloudResourceKind } = useCloudResourceViewContext();

  return (
    <Fragment>
      <ModelDelete
        modelType={CloudResource}
        modelId={modelId}
        onDeleteSuccess={() => {
          // Back to the list the row was on.
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[
                isCloudResourceKindResource(cloudResourceKind)
                  ? PageMap.CLOUD_MONITORED_RESOURCES
                  : PageMap.CLOUD_RESOURCES
              ] as Route,
              {
                modelId,
              },
            ),
          );
        }}
      />
    </Fragment>
  );
};

export default CloudResourceDelete;
