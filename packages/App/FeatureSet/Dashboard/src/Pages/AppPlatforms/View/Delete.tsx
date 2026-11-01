import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import Navigation from "Common/UI/Utils/Navigation";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const AppPlatformEnvironmentDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ModelDelete
        modelType={CloudResource}
        modelId={modelId}
        onDeleteSuccess={() => {
          // Back to the list the environment was on.
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.APP_PLATFORMS_ENVIRONMENTS] as Route,
            ),
          );
        }}
      />
    </Fragment>
  );
};

export default AppPlatformEnvironmentDelete;
