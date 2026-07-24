import PageComponentProps from "../../PageComponentProps";
import DashboardLogsViewer from "../../../Components/Logs/LogsViewer";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import Navigation from "Common/UI/Utils/Navigation";
import Query from "Common/Types/BaseDatabase/Query";
import Log from "Common/Models/AnalyticsModels/Log";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useMemo,
} from "react";

/*
 * Logs page for one device: syslog messages and SNMP traps that the
 * probe forwarded into the telemetry Logs pipeline, scoped to this
 * device via the `networkDevice.id` log attribute.
 */
const NetworkDeviceLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const logQuery: Query<Log> = useMemo(() => {
    /*
     * Using `any` to sidestep a TS2589 "excessively deep type instantiation"
     * error on the Query<Log> generic when inline attribute maps are used.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q: any = {
      attributes: {
        "networkDevice.id": modelId.toString(),
      },
    };
    return q as Query<Log>;
  }, [modelId]);

  return (
    <Fragment>
      <Card
        title="Device Logs"
        description="Syslog messages and SNMP traps received from this device."
      >
        <DashboardLogsViewer
          id={`network-device-logs-${modelId.toString()}`}
          logQuery={logQuery}
          showFilters={true}
          enableRealtime={true}
          noLogsMessage="No logs received from this device yet. Point the device's syslog and SNMP trap forwarding at the probe and messages will appear here."
        />
      </Card>
      <Card
        title="Setting up device logging"
        description="How log data gets here, if this page is empty."
      >
        <div className="space-y-3 text-sm text-gray-600">
          <p>
            Device logs are collected by your <strong>probe</strong>. It listens
            for <strong>SNMP traps</strong> on UDP port 162 and for{" "}
            <strong>syslog</strong> messages on UDP port 5140 (syslog is off by
            default — enable it with{" "}
            <code>PROBE_SYSLOG_RECEIVER_ENABLED=true</code> on the probe). Point
            this device&apos;s syslog and trap destinations at the probe&apos;s
            IP address and messages will appear here within a few minutes.
          </p>
          <p className="text-gray-500">
            On most routers and switches this is two steps: add a remote syslog
            server pointing at the probe, then add the probe as an SNMP trap
            receiver. Messages are matched to this device by the sender IP
            address, which must equal this device&apos;s hostname/IP as
            registered here.
          </p>
        </div>
      </Card>
    </Fragment>
  );
};

export default NetworkDeviceLogs;
