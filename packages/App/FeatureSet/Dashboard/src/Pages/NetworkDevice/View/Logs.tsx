import PageComponentProps from "../../PageComponentProps";
import DashboardLogsViewer from "../../../Components/Logs/LogsViewer";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import Navigation from "Common/UI/Utils/Navigation";
import Query from "Common/Types/BaseDatabase/Query";
import Log from "Common/Models/AnalyticsModels/Log";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";

const NETWORK_DEVICE_ID_ATTR: string = "networkDevice.id";

// Label for the locked chip built from the pinned `networkDevice.id` attribute.
const LOG_ATTRIBUTE_DISPLAY_KEYS: Record<string, string> = {
  [NETWORK_DEVICE_ID_ATTR]: "Network Device",
};

/*
 * Logs page for one device: syslog messages and SNMP traps that the
 * probe forwarded into the telemetry Logs pipeline, scoped to this
 * device via the `networkDevice.id` log attribute.
 */
const NetworkDeviceLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [deviceName, setDeviceName] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);

  /*
   * The logs are scoped by the device's id, so without the name the locked
   * chip reads "networkDevice.id: 84858d6c-…". Fetch the name for the chip
   * only: a failed lookup must not hide the logs, so errors fall through to
   * rendering the viewer with the id as the chip value.
   */
  const fetchDeviceName: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const item: NetworkDevice | null = await ModelAPI.getItem({
        modelType: NetworkDevice,
        id: modelId,
        select: {
          name: true,
        },
      });

      setDeviceName(item?.name || "");
    } catch {
      setDeviceName("");
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchDeviceName().catch(() => {
      setIsLoading(false);
    });
  }, []);

  const logQuery: Query<Log> = useMemo(() => {
    /*
     * Using `any` to sidestep a TS2589 "excessively deep type instantiation"
     * error on the Query<Log> generic when inline attribute maps are used.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q: any = {
      attributes: {
        [NETWORK_DEVICE_ID_ATTR]: modelId.toString(),
      },
    };
    return q as Query<Log>;
  }, [modelId]);

  /*
   * Only override the chip value once the name is known — an empty override
   * would blank the chip instead of falling back to the id.
   */
  const attributeFilterDisplayValues: Record<string, string> | undefined =
    useMemo(() => {
      if (!deviceName) {
        return undefined;
      }

      return {
        [NETWORK_DEVICE_ID_ATTR]: deviceName,
      };
    }, [deviceName]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  return (
    <Fragment>
      <DashboardLogsViewer
        id={`network-device-logs-${modelId.toString()}`}
        logQuery={logQuery}
        attributeFilterDisplayKeys={LOG_ATTRIBUTE_DISPLAY_KEYS}
        attributeFilterDisplayValues={attributeFilterDisplayValues}
        showFilters={true}
        enableRealtime={true}
        noLogsMessage="No logs received from this device yet. Point the device's syslog and SNMP trap forwarding at the probe and messages will appear here."
      />
      <div className="mt-4">
        <Card
          title="Setting up device logging"
          description="How log data gets here, if this page is empty."
        >
          <div className="space-y-3 text-sm text-gray-600">
            <p>
              Device logs are collected by your <strong>probe</strong>. It
              listens for <strong>SNMP traps</strong> on UDP port 162 and for{" "}
              <strong>syslog</strong> messages on UDP port 5140 (syslog is off
              by default — enable it with{" "}
              <code>PROBE_SYSLOG_RECEIVER_ENABLED=true</code> on the probe).
              Point this device&apos;s syslog and trap destinations at the
              probe&apos;s IP address and messages will appear here within a few
              minutes.
            </p>
            <p className="text-gray-500">
              On most routers and switches this is two steps: add a remote
              syslog server pointing at the probe, then add the probe as an SNMP
              trap receiver. Messages are matched to this device by the sender
              IP address, which must equal this device&apos;s hostname/IP as
              registered here.
            </p>
          </div>
        </Card>
      </div>
    </Fragment>
  );
};

export default NetworkDeviceLogs;
