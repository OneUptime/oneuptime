import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import DashboardViewer from "../../../Components/Dashboard/DashboardView";

const DashboardView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  return (
    <Fragment>
      {/* Dashboard View  */}
      <DashboardViewer dashboardId={modelId} />
    </Fragment>
  );
};

export default DashboardView;
