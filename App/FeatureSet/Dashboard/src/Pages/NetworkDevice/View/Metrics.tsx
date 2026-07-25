import PageComponentProps from "../../PageComponentProps";
import DeviceHealthCharts from "../../../Components/NetworkDevice/DeviceHealthCharts";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * Full-page health metrics for one device: interface utilization and
 * polled OID series (CPU / memory / temperature) with a time-range
 * picker. Metrics are device-scoped, written by the device's own polling
 * pipeline — no monitor required.
 */
const NetworkDeviceMetrics: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <DeviceHealthCharts networkDeviceId={modelId} />
    </Fragment>
  );
};

export default NetworkDeviceMetrics;
