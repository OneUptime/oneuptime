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
  /*
   * Whether this device's health comes from a bound Monitor rather than from
   * an SNMP walk. It changes what an empty list MEANS, so the copy has to
   * branch on it — see the note below.
   */
  isMonitorBacked?: boolean | undefined;
}

/*
 * "Monitors alerting on this device" card for the device Overview. The
 * monitor list is resolved by DeviceMonitorLookupUtil (the monitor bound to
 * the device, plus a client-side filter over the project's Network Device
 * monitors) and passed in by the page so the Health charts can share the
 * same fetch.
 *
 * An empty list means two opposite things depending on the device:
 *
 *   SNMP device        - the probe polls and inventories it regardless;
 *                        monitors only decide what to ALERT on. Nothing is
 *                        wrong, and the copy says so.
 *   Monitor-backed dev - nothing polls it at all. Without a bound monitor it
 *                        has no health source whatsoever and sits on
 *                        "Pending" forever, which is OneUptime/oneuptime#3447.
 *                        Telling that operator the device "is still polled by
 *                        its assigned probe" is false and sends them looking
 *                        for a probe it is designed never to have.
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
            {props.isMonitorBacked
              ? `This device has no monitor bound to it, so nothing is reporting its health — it is not polled over SNMP, and its status stays "Pending" until a monitor is bound. Create a Ping or IP monitor for its address, then bind it under Settings → Device Details → Monitor.`
              : `No monitors are alerting on this device yet. The device is still polled and inventoried by its assigned probe — create a Network Device monitor to get incidents and alerts for reachability, interface problems, health-OID thresholds, and traps.`}
          </p>
          <div className="mt-4 flex justify-center">
            <Button
              title={
                props.isMonitorBacked ? "Create Ping Monitor" : "Create Monitor"
              }
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
      title={
        props.isMonitorBacked
          ? "Monitors reporting on this device"
          : "Monitors alerting on this device"
      }
      description={
        props.isMonitorBacked
          ? "The monitor bound to this device decides its status, plus any Network Device monitors that reference it."
          : "Network Device monitors that evaluate this device's polls and traps and open incidents or alerts."
      }
    >
      {getCardContent()}
    </Card>
  );
};

export default DeviceMonitorsCard;
