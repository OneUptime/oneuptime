import ObjectID from "../../Types/ObjectID";
import MonitorNotCheckedReason from "../../Types/Monitor/MonitorNotCheckedReason";
import { NetworkDeviceMonitoringMethodUtil } from "../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import MonitoringOff, { MonitoredFlags } from "../Monitor/MonitoringOff";

/*
 * A MONITOR-BACKED DEVICE WHOSE BOUND MONITOR NOTHING CHECKS.
 *
 * A monitor-backed device takes its status from the monitor bound to it, and
 * only while that monitor is checked (NetworkDeviceService
 * .refreshStampedMonitorStatus, issue #6965): turned off or archived, the
 * monitor gives no verdict, so the device has none either. Every surface
 * that shows such a device says why, in the same words - the device list, a
 * site's Devices tab and the device's Overview hero ("Pending", with a gray
 * "Monitoring off" or "Monitor archived" beside it), and the Network Map's
 * drawer and node tooltip (issue #7346). This is the one rule they all read:
 * the Dashboard's qualifier (DeviceStatusUtil
 * .getBoundMonitorNotCheckedQualifier) and the topology API, which puts the
 * answer on each device node (NetworkTopologyNode.monitorNotChecked).
 *
 * The reason is the bound monitor's own: MonitoringOff.getNotCheckedReason,
 * archived winning over turned off. A probe-polled device has no bound
 * monitor to speak of - its stamp, when one is set, is informational - and a
 * monitor-backed one with nothing bound is the "No monitor" case, so both
 * have no reason here.
 */

// The columns the rule is decided from, as a device row is read.
export interface BoundMonitorDeviceRow {
  monitoringMethod?: string | null | undefined;
  monitorId?: ObjectID | string | null | undefined;
  // Read with MONITORED_SELECT; read without it, the monitor counts as checked.
  monitor?: MonitoredFlags | null | undefined;
}

export function getBoundMonitorNotCheckedReason(
  device: BoundMonitorDeviceRow,
): MonitorNotCheckedReason | null {
  if (
    !NetworkDeviceMonitoringMethodUtil.isMonitorBacked(
      device.monitoringMethod,
    ) ||
    !device.monitorId
  ) {
    return null;
  }

  return MonitoringOff.getNotCheckedReason(device.monitor);
}
