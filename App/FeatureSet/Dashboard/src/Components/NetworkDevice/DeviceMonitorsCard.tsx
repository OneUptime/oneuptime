import MonitorElement from "../Monitor/Monitor";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { Gray500 } from "Common/Types/BrandColors";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Pill from "Common/UI/Components/Pill/Pill";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  monitors: Array<Monitor>;
  isLoading: boolean;
  error: string;
}

/*
 * "Monitors watching this device" card for the device Overview. The monitor
 * list is resolved by DeviceMonitorLookupUtil (client-side filter over the
 * project's Network Device monitors) and passed in by the page so the Health
 * charts can share the same fetch.
 */
const DeviceMonitorsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  type GetCardContentFunction = () => ReactElement;

  const getCardContent: GetCardContentFunction = (): ReactElement => {
    if (props.isLoading) {
      return <ComponentLoader />;
    }

    if (props.error) {
      return <ErrorMessage message={props.error} />;
    }

    if (props.monitors.length === 0) {
      return (
        <div className="text-center py-10">
          <p className="text-sm text-gray-500">
            No monitors are watching this device yet. Create a Network Device
            monitor to poll it via SNMP, collect interface and health metrics,
            and alert on problems.
          </p>
          <div className="mt-4 flex justify-center">
            <Button
              title="Create Monitor"
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
          </div>
        </div>
      );
    }

    return (
      <div className="divide-y divide-gray-100">
        {props.monitors.map((monitor: Monitor): ReactElement => {
          return (
            <div
              key={monitor._id?.toString()}
              className="flex items-center justify-between py-3"
            >
              <div className="text-sm font-medium text-gray-900">
                <MonitorElement monitor={monitor} />
              </div>
              {monitor.currentMonitorStatus?.name && (
                <Pill
                  text={monitor.currentMonitorStatus.name}
                  color={monitor.currentMonitorStatus.color || Gray500}
                  isMinimal={true}
                />
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <Card
      title="Monitors watching this device"
      description="Network Device monitors that poll this device via SNMP."
    >
      {getCardContent()}
    </Card>
  );
};

export default DeviceMonitorsCard;
