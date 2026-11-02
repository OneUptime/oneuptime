import PageComponentProps from "../../PageComponentProps";
import DeviceMonitorLookupUtil, {
  DeviceMonitorContext,
} from "../../../Components/NetworkDevice/DeviceMonitorLookupUtil";
import DeviceMonitorsCard from "../../../Components/NetworkDevice/DeviceMonitorsCard";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * Monitors page for one device: the monitor bound to it, every Network
 * Device monitor watching it, and the Ping, IP, Port and NTP monitors a
 * discovery import made for it (OneUptime issue #5145), with current status
 * and a create path when none exist. Monitors are how a device gets metrics,
 * alerting, and incident automation - and for a monitor-backed device, its
 * status at all.
 */
const NetworkDeviceMonitors: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [monitors, setMonitors] = useState<Array<Monitor>>([]);
  const [isMonitorBacked, setIsMonitorBacked] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  /*
   * "Monitor web UI" is for a reader who may create monitors - hidden, not
   * locked, as on the device's Overview.
   */
  const canCreateMonitor: boolean = PermissionGate.check(
    new Monitor(),
    ModelAction.Create,
  ).isAllowed;

  useEffect(() => {
    const fetchMonitors: PromiseVoidFunction = async (): Promise<void> => {
      try {
        const context: DeviceMonitorContext =
          await DeviceMonitorLookupUtil.getDeviceMonitorContext(modelId);
        setMonitors(context.monitors);
        setIsMonitorBacked(context.isMonitorBacked);
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      }

      setIsLoading(false);
    };

    fetchMonitors().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
      setIsLoading(false);
    });
  }, []);

  return (
    <Fragment>
      <DeviceMonitorsCard
        monitors={monitors}
        isLoading={isLoading}
        error={error}
        networkDeviceId={modelId.toString()}
        isMonitorBacked={isMonitorBacked}
        canCreateMonitor={canCreateMonitor}
      />
    </Fragment>
  );
};

export default NetworkDeviceMonitors;
