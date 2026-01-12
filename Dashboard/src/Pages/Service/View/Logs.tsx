import DashboardLogsViewer from "../../../Components/Logs/LogsViewer";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const ServiceLogs: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <DashboardLogsViewer
        id="service-logs"
        serviceIds={[modelId]}
        showFilters={true}
        enableRealtime={true}
        limit={100}
        noLogsMessage="No logs found for this service."
      />
    </Fragment>
  );
};

export default ServiceLogs;
