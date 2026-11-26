import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import Navigation from "Common/UI/Utils/Navigation";
import XcpNgPool from "Common/Models/DatabaseModels/XcpNgPool";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const XcpNgPoolDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ModelDelete
        modelType={XcpNgPool}
        modelId={modelId}
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.XCP_NG_POOLS] as Route,
              { modelId },
            ),
          );
        }}
      />
    </Fragment>
  );
};

export default XcpNgPoolDelete;
