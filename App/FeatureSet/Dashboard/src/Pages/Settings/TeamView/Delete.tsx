import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import Navigation from "Common/UI/Utils/Navigation";
import Team from "Common/Models/DatabaseModels/Team";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const TeamViewDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <ModelDelete
        modelType={Team}
        modelId={Navigation.getLastParamAsObjectID(1)}
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_TEAMS] as Route,
            ),
          );
        }}
      />
    </Fragment>
  );
};

export default TeamViewDelete;
