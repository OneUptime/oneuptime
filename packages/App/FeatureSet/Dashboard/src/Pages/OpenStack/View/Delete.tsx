import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import Navigation from "Common/UI/Utils/Navigation";
import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const OpenStackCloudDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ModelDelete
        modelType={OpenStackCloud}
        modelId={modelId}
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.OPENSTACK_CLOUDS] as Route,
              { modelId },
            ),
          );
        }}
      />
    </Fragment>
  );
};

export default OpenStackCloudDelete;
