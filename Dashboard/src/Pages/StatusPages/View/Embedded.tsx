import PageMap from "../../../Utils/PageMap";
import RouteMap from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import ModelDelete from "CommonUI/src/Components/ModelDelete/ModelDelete";
import Navigation from "CommonUI/src/Utils/Navigation";
import StatusPage from "Model/Models/StatusPage";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const StatusPageDelete: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ModelDelete
        modelType={StatusPage}
        modelId={modelId}
        onDeleteSuccess={() => {
          Navigation.navigate(RouteMap[PageMap.STATUS_PAGES] as Route);
        }}
      />
    </Fragment>
  );
};

export default StatusPageDelete;
