import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import { NetworkTrafficUsageKind } from "../../../Types/NetFlow/NetworkTrafficUsage";
import ObjectID from "../../../Types/ObjectID";
import { NetworkControllerDeviceMatches } from "./NetworkControllerDeviceMatcher";
import {
  NetworkTrafficUsageRecord,
  NetworkTrafficUsageWindowKey,
} from "./NetworkControllerTypes";

/*
 * A read's records as the NetworkTrafficUsage rows ClickHouse stores, each
 * given the device its traffic belongs to: an uplink its appliance's
 * device, a network's applications and clients its first matched
 * appliance's - or the project's ID, the project's bucket.
 *
 * Rows are grouped by the window they total, and a batch never splits a
 * group: an uplink window, or a network's window of applications AND
 * clients (read together, under one cursor). An insert that fails part way
 * leaves whole groups stored or not, in the order they were read, and the
 * next read stores exactly the ones that are not
 * (NetworkControllerReadRunner).
 */

// Rows one insert carries at most (a window is never split across two).
export const MAX_ROWS_PER_INSERT: number = 5000;

// What identifies a stored window: kind, network ('' for uplinks) and start.
export function getWindowKey(window: NetworkTrafficUsageWindowKey): string {
  return [
    window.kind,
    window.kind === NetworkTrafficUsageKind.Uplink
      ? ""
      : window.controllerNetworkId,
    String(window.windowStartAt.getTime()),
  ].join("|");
}

export function getRecordWindowKey(record: NetworkTrafficUsageRecord): string {
  return getWindowKey({
    kind: record.kind,
    controllerNetworkId: record.controllerNetworkId,
    windowStartAt: record.windowStartAt,
  });
}

/*
 * What one insert keeps whole: an uplink window, or a network's window of
 * applications and clients - both kinds of it stored, or neither, so the
 * network's stored end is its cursor.
 */
export function getRecordBatchGroupKey(
  record: NetworkTrafficUsageRecord,
): string {
  if (record.kind === NetworkTrafficUsageKind.Uplink) {
    return getRecordWindowKey(record);
  }

  return [
    "analytics",
    record.controllerNetworkId,
    String(record.windowStartAt.getTime()),
  ].join("|");
}

export function toUsageRow(data: {
  record: NetworkTrafficUsageRecord;
  projectId: ObjectID;
  connectionId: ObjectID;
  matches: NetworkControllerDeviceMatches;
  ingestedAt: Date;
}): JSONObject {
  const record: NetworkTrafficUsageRecord = data.record;
  const deviceId: ObjectID | undefined =
    record.kind === NetworkTrafficUsageKind.Uplink
      ? data.matches.bySerial.get(record.deviceSerial)
      : data.matches.byNetwork.get(record.controllerNetworkId);

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(data.ingestedAt),
    projectId: data.projectId.toString(),
    networkDeviceId: (deviceId || data.projectId).toString(),
    connectionId: data.connectionId.toString(),
    kind: record.kind,
    controllerNetworkId: record.controllerNetworkId,
    controllerNetworkName: record.controllerNetworkName,
    deviceSerial: record.deviceSerial,
    deviceName: record.deviceName,
    interfaceName: record.interfaceName,
    application: record.application,
    destination: record.destination,
    protocol: record.protocol,
    port: record.port,
    clientKey: record.clientKey,
    clientName: record.clientName,
    clientIp: record.clientIp,
    clientMac: record.clientMac,
    clientManufacturer: record.clientManufacturer,
    sentOctets: record.sentOctets,
    receivedOctets: record.receivedOctets,
    flows: record.flows,
    clients: record.clients,
    windowStartAt: OneUptimeDate.toClickhouseDateTime64(record.windowStartAt),
    windowEndAt: OneUptimeDate.toClickhouseDateTime64(record.windowEndAt),
    ingestedAt: OneUptimeDate.toClickhouseDateTime64(data.ingestedAt),
  };
}

/*
 * The records of windows not stored yet, as rows, in batches that each
 * hold whole windows.
 */
export function toUsageRowBatches(data: {
  records: Array<NetworkTrafficUsageRecord>;
  storedWindowKeys: Set<string>;
  projectId: ObjectID;
  connectionId: ObjectID;
  matches: NetworkControllerDeviceMatches;
  ingestedAt: Date;
}): { batches: Array<Array<JSONObject>>; skippedRecords: number } {
  const byGroup: Map<string, Array<NetworkTrafficUsageRecord>> = new Map();
  let skippedRecords: number = 0;

  for (const record of data.records) {
    if (data.storedWindowKeys.has(getRecordWindowKey(record))) {
      skippedRecords++;
      continue;
    }

    const key: string = getRecordBatchGroupKey(record);
    const group: Array<NetworkTrafficUsageRecord> = byGroup.get(key) || [];
    group.push(record);
    byGroup.set(key, group);
  }

  const batches: Array<Array<JSONObject>> = [];
  let current: Array<JSONObject> = [];

  for (const group of byGroup.values()) {
    if (
      current.length > 0 &&
      current.length + group.length > MAX_ROWS_PER_INSERT
    ) {
      batches.push(current);
      current = [];
    }

    for (const record of group) {
      current.push(
        toUsageRow({
          record,
          projectId: data.projectId,
          connectionId: data.connectionId,
          matches: data.matches,
          ingestedAt: data.ingestedAt,
        }),
      );
    }
  }

  if (current.length > 0) {
    batches.push(current);
  }

  return { batches, skippedRecords };
}
