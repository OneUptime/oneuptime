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
   * its probe's own poll. It changes what an empty list MEANS, so the copy
   * has to branch on it — see the note below.
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
 *   Probe-polled dev   - the probe pings it on its schedule (and walks it
 *                        over SNMP once it has credentials) regardless;
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
              ? `This device has no monitor bound to it, so nothing is reporting its health — it is not polled by a probe at all, and its status stays "Pending" until a monitor is bound. The button below creates a Ping monitor on this device's address and binds it to the device for you. To use a monitor that already exists instead, bind it under Settings → Monitor. To have a probe ping it directly instead, switch it to probe polling under Settings.`
              : `No monitors are alerting on this device yet. Its probe already pings it on schedule, so it has a status either way — a monitor is what turns a failure into an incident. Create one here, or cover this device and others like it at once with an alert policy under Network settings.`}
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
                {/*
                 * A policy-owned monitor is created and removed by the alert
                 * policy engine. Saying so here is what stops an operator
                 * editing its criteria, or deleting it, and being quietly
                 * overruled on the next reconcile — the one thing about this
                 * monitor they cannot discover from the monitor page itself.
                 */}
                {monitor.networkAlertPolicyId && (
                  <div className="mt-0.5 text-xs font-normal text-gray-500">
                    Managed by an alert policy. Edit the policy rather than this
                    monitor.
                  </div>
                )}
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
