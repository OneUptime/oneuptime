import PageComponentProps from "../../PageComponentProps";
import DeviceMonitorLookupUtil, {
  DeviceMonitorContext,
  NO_UNTIED_MONITORS,
  UntiedMonitorsListing,
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
 * Device monitor watching it, the Ping, IP, Port, NTP, Website, API and SSL
 * Certificate monitors a discovery import made for it (OneUptime issues
 * #5145, #9546), and the monitors a person tied to it (#9545), with current
 * status, a create path, and a way to add a monitor made earlier. Monitors
 * are how a device gets metrics, alerting, and incident automation - and for
 * a monitor-backed device, its status at all.
 */
const NetworkDeviceMonitors: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [monitors, setMonitors] = useState<Array<Monitor>>([]);
  const [isMonitorBacked, setIsMonitorBacked] = useState<boolean>(false);
  // The monitors only a person's tie lists here (issue #9676).
  const [removableMonitorIds, setRemovableMonitorIds] = useState<Set<string>>(
    new Set<string>(),
  );
  // The monitors on its address tied to no device (issue #9903).
  const [untiedMonitors, setUntiedMonitors] =
    useState<UntiedMonitorsListing>(NO_UNTIED_MONITORS);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  /*
   * Bumped when a monitor is added to the device or taken off it, to read
   * its monitors again.
   */
  const [readCount, setReadCount] = useState<number>(0);

  const readMonitorsAgain: () => void = (): void => {
    setReadCount((count: number): number => {
      return count + 1;
    });
  };

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
        setRemovableMonitorIds(context.removableMonitorIds);
        setUntiedMonitors(context.untiedMonitors);
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      }

      setIsLoading(false);
    };

    fetchMonitors().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
      setIsLoading(false);
    });
  }, [readCount]);

  return (
    <Fragment>
      <DeviceMonitorsCard
        monitors={monitors}
        isLoading={isLoading}
        error={error}
        networkDeviceId={modelId.toString()}
        isMonitorBacked={isMonitorBacked}
        canCreateMonitor={canCreateMonitor}
        onMonitorAdded={readMonitorsAgain}
        removableMonitorIds={removableMonitorIds}
        onMonitorRemoved={readMonitorsAgain}
        untiedMonitors={untiedMonitors}
      />
    </Fragment>
  );
};

export default NetworkDeviceMonitors;
