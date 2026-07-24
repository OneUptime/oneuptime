import PageComponentProps from "../../PageComponentProps";
import DeviceHealthCharts from "../../../Components/NetworkDevice/DeviceHealthCharts";
import DeviceMonitorLookupUtil from "../../../Components/NetworkDevice/DeviceMonitorLookupUtil";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * Full-page health metrics for one device: interface utilization and
 * polled OID series (CPU / memory / temperature) charted per monitor,
 * with a time-range picker. Metrics exist only once a Network Device
 * monitor watches the device, so the empty state routes there.
 */
const NetworkDeviceMetrics: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [monitors, setMonitors] = useState<Array<Monitor>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    const fetchMonitors: PromiseVoidFunction = async (): Promise<void> => {
      try {
        setMonitors(
          await DeviceMonitorLookupUtil.getMonitorsWatchingDevice(modelId),
        );
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

  if (isLoading) {
    return <ComponentLoader />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (monitors.length === 0) {
    return (
      <Card
        title="Metrics"
        description="Interface utilization and device health metrics collected via SNMP."
      >
        <EmptyState
          id="network-device-metrics-empty-state"
          icon={IconProp.Graph}
          title="No metrics yet"
          description="Metrics are collected by Network Device monitors. Create one to poll this device via SNMP and chart interface utilization, CPU, memory, and any custom OIDs here."
          footer={
            <Button
              title="Create a Network Device Monitor"
              icon={IconProp.Add}
              buttonStyle={ButtonStyleType.NORMAL}
              onClick={() => {
                Navigation.navigate(
                  RouteUtil.populateRouteParams(
                    RouteMap[PageMap.MONITOR_CREATE] as Route,
                  ),
                );
              }}
            />
          }
        />
      </Card>
    );
  }

  return (
    <Fragment>
      <DeviceHealthCharts monitors={monitors} />
    </Fragment>
  );
};

export default NetworkDeviceMetrics;
