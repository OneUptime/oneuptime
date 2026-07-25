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
  /*
   * When provided, the empty-state "Create Monitor" button deep-links the
   * monitor create page with the type and device pre-selected.
   */
  networkDeviceId?: string | undefined;
}

/*
 * "Monitors alerting on this device" card for the device Overview. The
 * monitor list is resolved by DeviceMonitorLookupUtil (client-side filter
 * over the project's Network Device monitors) and passed in by the page so
 * the Health charts can share the same fetch.
 *
 * The device is polled by its assigned probe regardless of monitors —
 * monitors only decide what to alert on, which is what the empty-state copy
 * says.
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
            No monitors are alerting on this device yet. The device is still
            polled and inventoried by its assigned probe — create a Network
            Device monitor to get incidents and alerts for reachability,
            interface problems, health-OID thresholds, and traps.
          </p>
          <div className="mt-4 flex justify-center">
            <Button
              title="Create Monitor"
              icon={IconProp.Add}
              buttonStyle={ButtonStyleType.NORMAL}
              onClick={() => {
                const createRoute: Route = RouteUtil.populateRouteParams(
                  RouteMap[PageMap.MONITOR_CREATE] as Route,
                );

                Navigation.navigate(
                  props.networkDeviceId
                    ? Route.fromString(
                        `${createRoute.toString()}?networkDeviceId=${props.networkDeviceId}`,
                      )
                    : createRoute,
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
      title="Monitors alerting on this device"
      description="Network Device monitors that evaluate this device's polls and traps and open incidents or alerts."
    >
      {getCardContent()}
    </Card>
  );
};

export default DeviceMonitorsCard;
