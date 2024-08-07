import DashboardLogsViewer from "../../../../../Components/Logs/LogsViewer";
import PageComponentProps from "../../../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/src/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const ServiceDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <DashboardLogsViewer
        showFilters={true}
        telemetryServiceIds={[modelId]}
        enableRealtime={true}
        id="logs"
      />
    </Fragment>
  );
};

export default ServiceDelete;
