import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import AppLink from "../../../Components/AppLink/AppLink";
import DeviceStatusUtil, {
  BOUND_MONITOR_PENDING_TOOLTIP,
  DEVICE_STATUS_SELECT,
  DeviceReachabilityResult,
  NEVER_POLLED_PENDING_TOOLTIP,
  NO_MONITOR_QUALIFIER,
  NO_PROBE_QUALIFIER,
  NO_SNMP_INTERFACES_LABEL,
  NetworkDeviceStatus,
  PROBE_POLLED_DOWN_TOOLTIP,
  PROBE_POLLED_UP_TOOLTIP,
  SNMP_FAILING_QUALIFIER,
  UNBOUND_MONITOR_BACKED_PENDING_TOOLTIP,
  getStaleTooltip,
  hasNoSnmpInventory,
  isSnmpFailing,
  isUnboundMonitorBackedDevice,
  isUnpolledProbeDevice,
} from "../../../Components/NetworkDevice/DeviceStatusUtil";
import Route from "Common/Types/API/Route";
import { Gray500, Green, Red500, Yellow500 } from "Common/Types/BrandColors";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import { NetworkDeviceMonitoringMethodUtil } from "Common/Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * Every device assigned to this site — same status language as the main
 * device list (Up / Down / Pending, decided by the outcome of the last
 * poll — ping or SNMP — rather than by how long ago it happened, or by
 * the bound Monitor for a device nothing polls), with the same qualifier
 * pills beside it.
 */
const NetworkSiteDevices: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ModelTable<NetworkDevice>
        modelType={NetworkDevice}
        id="network-site-devices-table"
        userPreferencesKey="network-site-devices-table"
        query={{ siteId: modelId, isArchived: false }}
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={true}
        showRefreshButton={true}
        name="Devices in this Site"
        cardProps={{
          title: "Devices in this Site",
          description:
            "Network devices assigned to this site, directly or by an assignment rule.",
        }}
        noItemsMessage="No devices are assigned to this site yet. Assign them from the device's Overview page, or set up assignment rules to do it automatically by subnet or hostname."
        filters={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              vendor: true,
            },
            title: "Vendor",
            type: FieldType.Text,
          },
        ]}
        selectMoreFields={{
          ...DEVICE_STATUS_SELECT,
          interfacesDown: true,
          // For the "No monitor" qualifier beside a monitor-backed Pending.
          monitorId: true,
        }}
        columns={[
          {
            field: {
              _id: true,
            },
            title: "Status",
            type: FieldType.Element,
            getElement: (item: NetworkDevice): ReactElement => {
              const reachability: DeviceReachabilityResult =
                DeviceStatusUtil.getReachability(item);

              /*
               * Same verdict either way, but never the same sentence: a
               * device nothing polls has no "last poll" to talk about, and
               * telling its operator to go and check a probe it does not
               * have is how a real ping outage gets missed.
               */
              const isMonitorBacked: boolean = reachability.isMonitorBacked;

              let verdictPill: ReactElement;

              if (reachability.status === NetworkDeviceStatus.Up) {
                verdictPill = (
                  <Pill
                    text="Up"
                    color={Green}
                    size={PillSize.Small}
                    tooltip={
                      isMonitorBacked
                        ? "The monitor bound to this device reports it healthy."
                        : PROBE_POLLED_UP_TOOLTIP
                    }
                  />
                );
              } else if (reachability.status === NetworkDeviceStatus.Down) {
                verdictPill = (
                  <Pill
                    text="Down"
                    color={Red500}
                    size={PillSize.Small}
                    tooltip={
                      isMonitorBacked
                        ? "The monitor bound to this device reports it offline."
                        : PROBE_POLLED_DOWN_TOOLTIP
                    }
                  />
                );
              } else {
                verdictPill = (
                  <Pill
                    text="Pending"
                    color={Gray500}
                    size={PillSize.Small}
                    tooltip={
                      isMonitorBacked && isUnboundMonitorBackedDevice(item)
                        ? UNBOUND_MONITOR_BACKED_PENDING_TOOLTIP
                        : isMonitorBacked
                          ? BOUND_MONITOR_PENDING_TOOLTIP
                          : NEVER_POLLED_PENDING_TOOLTIP
                    }
                  />
                );
              }

              /*
               * The qualifiers: second pills beside the verdict, never a
               * fourth verdict — see the qualifier notes in
               * DeviceStatusUtil. "No monitor" and "No probe" are the two
               * Pendings that never resolve on their own; "SNMP failing"
               * qualifies an Up whose walk is not keeping up; "Stale" says
               * nothing has polled the device lately.
               */
              const qualifierPills: Array<ReactElement> = [];

              if (isMonitorBacked && isUnboundMonitorBackedDevice(item)) {
                qualifierPills.push(
                  <Pill
                    key="no-monitor"
                    text={NO_MONITOR_QUALIFIER.text}
                    color={Gray500}
                    size={PillSize.Small}
                    tooltip={NO_MONITOR_QUALIFIER.tooltip}
                  />,
                );
              }

              if (!isMonitorBacked && isUnpolledProbeDevice(item)) {
                qualifierPills.push(
                  <Pill
                    key="no-probe"
                    text={NO_PROBE_QUALIFIER.text}
                    color={Gray500}
                    size={PillSize.Small}
                    tooltip={NO_PROBE_QUALIFIER.tooltip}
                  />,
                );
              }

              if (!isMonitorBacked && isSnmpFailing(item)) {
                qualifierPills.push(
                  <Pill
                    key="snmp-failing"
                    text={SNMP_FAILING_QUALIFIER.text}
                    color={Yellow500}
                    size={PillSize.Small}
                    tooltip={SNMP_FAILING_QUALIFIER.tooltip}
                  />,
                );
              }

              if (reachability.isStale) {
                qualifierPills.push(
                  <Pill
                    key="stale"
                    text="Stale"
                    color={Yellow500}
                    size={PillSize.Small}
                    tooltip={getStaleTooltip(reachability.staleWindowInMinutes)}
                  />,
                );
              }

              if (qualifierPills.length === 0) {
                return verdictPill;
              }

              return (
                <div className="flex flex-wrap items-center gap-1.5">
                  {verdictPill}
                  {qualifierPills}
                </div>
              );
            },
          },
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Element,
            getElement: (item: NetworkDevice): ReactElement => {
              const route: Route = RouteUtil.populateRouteParams(
                RouteMap[PageMap.NETWORK_DEVICE_VIEW] as Route,
                {
                  modelId: new ObjectID(item._id as string),
                },
              );
              return (
                <AppLink
                  to={route}
                  className="text-sm font-medium text-gray-900 hover:underline"
                >
                  {(item.name as string) || "—"}
                </AppLink>
              );
            },
          },
          {
            field: {
              hostname: true,
            },
            title: "Hostname",
            type: FieldType.Text,
            hideOnMobile: true,
          },
          {
            field: {
              vendor: true,
            },
            title: "Vendor",
            type: FieldType.Text,
            hideOnMobile: true,
          },
          {
            field: {
              interfacesUp: true,
            },
            title: "Interfaces (Up / Down)",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: NetworkDevice): ReactElement => {
              /*
               * Interface counts are written by a successful SNMP walk and
               * by nothing else. On a monitor-backed device, or on one that
               * is pinged and never walked, "0 / 0" is not zero interfaces —
               * it is never collected, which is a different claim (#3447).
               */
              if (
                NetworkDeviceMonitoringMethodUtil.isMonitorBacked(
                  item.monitoringMethod,
                )
              ) {
                return (
                  <span
                    className="text-sm text-gray-400"
                    title="Interface inventory comes from an SNMP walk, which does not run on a monitor-backed device."
                  >
                    —
                  </span>
                );
              }

              if (hasNoSnmpInventory(item)) {
                return (
                  <span
                    className="text-sm text-gray-400"
                    title={NO_SNMP_INTERFACES_LABEL.tooltip}
                  >
                    {NO_SNMP_INTERFACES_LABEL.text}
                  </span>
                );
              }

              if (!item.lastPolledAt) {
                return (
                  <span
                    className="text-sm text-gray-400"
                    title="Interfaces are collected by the first successful SNMP walk. This device has not been polled yet."
                  >
                    —
                  </span>
                );
              }

              const up: number = (item.interfacesUp as number) || 0;
              const down: number = (item.interfacesDown as number) || 0;
              return (
                <span className="text-sm font-medium">
                  <span className="text-emerald-700">{up}</span>
                  <span className="text-gray-400"> / </span>
                  <span className={down > 0 ? "text-red-700" : "text-gray-500"}>
                    {down}
                  </span>
                </span>
              );
            },
          },
          {
            field: {
              lastSeenAt: true,
            },
            title: "Last Seen",
            type: FieldType.Element,
            getElement: (item: NetworkDevice): ReactElement => {
              if (!item.lastSeenAt) {
                return <span className="text-sm text-gray-400">Never</span>;
              }

              const lastSeen: Date = OneUptimeDate.fromString(item.lastSeenAt);

              return (
                <span
                  className="text-sm text-gray-600"
                  title={OneUptimeDate.getDateAsLocalFormattedString(lastSeen)}
                >
                  {OneUptimeDate.fromNow(lastSeen)}
                </span>
              );
            },
          },
        ]}
        onViewPage={(item: NetworkDevice): Promise<Route> => {
          return Promise.resolve(
            new Route(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.NETWORK_DEVICE_VIEW] as Route,
                {
                  modelId: item._id,
                },
              ).toString(),
            ),
          );
        }}
      />
    </Fragment>
  );
};

export default NetworkSiteDevices;
