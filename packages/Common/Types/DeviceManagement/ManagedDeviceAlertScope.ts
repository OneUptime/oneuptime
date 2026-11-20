import Includes from "../BaseDatabase/Includes";
import { JSONObject } from "../JSON";
import MetricQueryConfigData from "../Metrics/MetricQueryConfigData";
import MetricsViewConfig from "../Metrics/MetricsViewConfig";
import MonitorStep from "../Monitor/MonitorStep";
import MonitorSteps from "../Monitor/MonitorSteps";
import { MANAGED_DEVICE_CONNECTION_METRIC_NAMES } from "./DeviceManagementConnectionReading";
import {
  MANAGED_DEVICE_READING_METRIC_NAMES,
  ManagedDeviceCheckInAttribute,
} from "./ManagedDeviceCheckIn";
import {
  ManagedDeviceNaming,
  getManagedDeviceFallbackHostName,
  getManagedDeviceHostName,
} from "./ManagedDeviceIdentity";

/*
 * WHICH ALERTS ARE ABOUT ONE MANAGED DEVICE (#10007).
 *
 * A device manager's alerts about a device - it stopped checking in, its
 * battery is low, its storage nearly full, its patch out of date - are its
 * connection's monitors', one alert per device: each alert's series names
 * the device by the name its readings carry (oneuptime.managed_device.name).
 * A device the Android agent does not report has no Host row (the import
 * never makes one), so nothing links such an alert to the device's
 * Inventory item, and the item's Alerts page and its device manager's card
 * said nothing of it.
 *
 * So the device's page finds them by what they already say: the alerts
 * whose series names one of the names the device's readings carry, raised
 * by a monitor that reads the device's own connection - or no connection in
 * particular, as a monitor someone wrote of every device does. A monitor of
 * another connection is never this device's, though one of its devices may
 * share the name.
 */

/*
 * The names a device's readings carry it by (getManagedDeviceUniqueName):
 * its own, and its own told apart - "iPhone (F2LXK1ABCD)" - which it goes
 * by while another device of its connection shares its name. Pure.
 */
export function getManagedDeviceSeriesNames(
  device: ManagedDeviceNaming,
): Array<string> {
  const name: string = getManagedDeviceHostName(device);

  if (!name) {
    return [];
  }

  const fallback: string = getManagedDeviceFallbackHostName(device);

  return fallback && fallback !== name
    ? [name, `${name} (${fallback})`]
    : [name];
}

// The connection ids one metric query filters on: none, one, or a list.
function readConnectionIds(query: MetricQueryConfigData): Array<string> {
  const attributes: unknown = query?.metricQueryData?.filterData?.attributes;

  if (!attributes || typeof attributes !== "object") {
    return [];
  }

  const value: unknown = (attributes as Record<string, unknown>)[
    ManagedDeviceCheckInAttribute.ConnectionId
  ];

  if (typeof value === "string") {
    return value ? [value] : [];
  }

  if (value instanceof Includes) {
    return value.values.map((id: unknown): string => {
      return String(id);
    });
  }

  // As a JSON column hands it back: {"_type": "Includes", "value": [...]}.
  const json: JSONObject | null =
    value && typeof value === "object" ? (value as JSONObject) : null;

  if (json && Array.isArray(json["value"])) {
    return (json["value"] as Array<unknown>).map((id: unknown): string => {
      return String(id);
    });
  }

  return [];
}

/*
 * The connections a monitor's steps read devices of: every connection id
 * one of their metric queries filters on, once each. Pure.
 */
export function getMonitorManagedDeviceConnectionIds(
  monitorSteps: MonitorSteps | undefined | null,
): Array<string> {
  const ids: Set<string> = new Set<string>();

  for (const step of monitorSteps?.data?.monitorStepsInstanceArray || []) {
    const view: MetricsViewConfig | undefined =
      MonitorStep.getMetricsViewConfig(step as MonitorStep);

    for (const query of view?.queryConfigs || []) {
      for (const id of readConnectionIds(query)) {
        ids.add(id);
      }
    }
  }

  return Array.from(ids);
}

/*
 * What a monitor's steps read of one device management connection
 * (#10286): whether they read that connection alone - every metric query
 * of every step reads one of the readings a connection writes, its own or
 * its devices', and names this connection and no other - and which of the
 * two they read.
 */
export interface MonitorConnectionReads {
  readsThisConnectionAlone: boolean;
  // The connection's own reading (Connection Stopped Reading's).
  readsConnectionReading: boolean;
  // Its devices' readings: check-ins, batteries, storage, security patches.
  readsDeviceReadings: boolean;
}

/*
 * What a monitor's steps read of a connection. A step with no metric
 * query (an HTTP monitor's, say) is no step of the connection's, so a
 * monitor with one reads more than the connection. Pure.
 */
export function getMonitorConnectionReads(data: {
  monitorSteps: MonitorSteps | undefined | null;
  connectionId: string;
}): MonitorConnectionReads {
  const reads: MonitorConnectionReads = {
    readsThisConnectionAlone: false,
    readsConnectionReading: false,
    readsDeviceReadings: false,
  };
  const steps: Array<MonitorStep> =
    data.monitorSteps?.data?.monitorStepsInstanceArray || [];
  let isAlone: boolean = steps.length > 0;

  for (const step of steps) {
    const queries: Array<MetricQueryConfigData> =
      MonitorStep.getMetricsViewConfig(step as MonitorStep)?.queryConfigs || [];

    if (queries.length === 0) {
      isAlone = false;
    }

    for (const query of queries) {
      const metricName: unknown =
        query?.metricQueryData?.filterData?.metricName;
      const connectionIds: Array<string> = readConnectionIds(query);
      const namesThisConnection: boolean = connectionIds.includes(
        data.connectionId,
      );
      const isConnectionReading: boolean =
        typeof metricName === "string" &&
        MANAGED_DEVICE_CONNECTION_METRIC_NAMES.includes(metricName);
      const isDeviceReading: boolean =
        typeof metricName === "string" &&
        MANAGED_DEVICE_READING_METRIC_NAMES.includes(metricName);

      if (namesThisConnection && isConnectionReading) {
        reads.readsConnectionReading = true;
      }

      if (namesThisConnection && isDeviceReading) {
        reads.readsDeviceReadings = true;
      }

      if (
        !(isConnectionReading || isDeviceReading) ||
        connectionIds.length !== 1 ||
        !namesThisConnection
      ) {
        isAlone = false;
      }
    }
  }

  reads.readsThisConnectionAlone = isAlone;

  return reads;
}

/*
 * Whether a monitor's alert that names a device by its name may be about
 * this device of this connection: its steps read this connection, or no
 * connection in particular. One that reads only other connections is never
 * this device's. Pure.
 */
export function mayMonitorAlertOnManagedDevice(data: {
  monitorSteps: MonitorSteps | undefined | null;
  connectionId: string;
}): boolean {
  const ids: Array<string> = getMonitorManagedDeviceConnectionIds(
    data.monitorSteps,
  );

  return ids.length === 0 || ids.includes(data.connectionId);
}

// The query fragment of the alerts and incidents whose series names the device.
export function getManagedDeviceSeriesQuery(
  seriesNames: ReadonlyArray<string>,
): JSONObject {
  return {
    [ManagedDeviceCheckInAttribute.DeviceName]: new Includes([...seriesNames]),
  } as unknown as JSONObject;
}
