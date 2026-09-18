import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import Navigation from "Common/UI/Utils/Navigation";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * Deleting a site does not delete its children or devices — the server
 * re-parents the orphaned subtree (parentSiteId is SET NULL, then the
 * hierarchy self-heals), and devices simply lose their site assignment.
 */
const NetworkSiteDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ModelDelete
        modelType={NetworkSite}
        modelId={modelId}
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_SITES] as Route,
              { modelId },
            ),
          );
        }}
      />
    </Fragment>
  );
};

export default NetworkSiteDelete;
