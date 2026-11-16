import {
  NETWORK_DEVICE_POLL_DETAIL_COLUMNS,
  NetworkDevicePollDetails,
  NetworkDevicePollVerdict,
} from "../../../Server/Services/NetworkDeviceService";
import ObjectID from "../../../Types/ObjectID";

// What NetworkDeviceService.writePollVerdict is called with.
export interface PollVerdictWrite {
  projectId: ObjectID;
  deviceId: ObjectID;
  receivedAt: Date;
  processedAt: Date;
  // Null for a monitor-backed device: only its details are written.
  verdict: NetworkDevicePollVerdict | null;
  details?: NetworkDevicePollDetails | undefined;
}

/*
 * The columns writePollVerdict's statement sets on a device that holds no
 * newer verdict, worked out from the arguments it was called with. This is
 * for suites that mock the statement and read the device row back. The
 * statement itself is pinned in NetworkDevicePollVerdict.test.ts, and run
 * against a real Postgres in NetworkDevicePollOrderPostgres.test.ts.
 *
 * lastSeenAt and lastSnmpSeenAt are the later of the stored time and the
 * receipt time. A row read back from nothing has no stored time, so here
 * they are the receipt time.
 *
 * The poll's details - its rate baseline and its SNMP table and transceiver
 * snapshots - ride in the same statement (issue #7393), each when the poll
 * has one.
 */
export function pollVerdictColumns(
  write: PollVerdictWrite,
): Record<string, unknown> {
  const columns: Record<string, unknown> = {
    lastPollReceivedAt: write.receivedAt,
  };

  if (write.verdict) {
    columns["lastPolledAt"] = write.processedAt;
    columns["isReachable"] = write.verdict.isReachable;
    columns["isSnmpReachable"] = write.verdict.isSnmpReachable;

    if (write.verdict.isReachable) {
      columns["lastSeenAt"] = write.receivedAt;
    }

    if (write.verdict.isSnmpReachable === true) {
      columns["lastSnmpSeenAt"] = write.receivedAt;
    }

    if (write.verdict.interfaceCounts !== undefined) {
      columns["interfacesTotal"] = write.verdict.interfaceCounts?.total ?? null;
      columns["interfacesUp"] = write.verdict.interfaceCounts?.up ?? null;
      columns["interfacesDown"] = write.verdict.interfaceCounts?.down ?? null;
    }
  }

  for (const column of NETWORK_DEVICE_POLL_DETAIL_COLUMNS) {
    if (write.details?.[column] !== undefined) {
      columns[column] = write.details[column];
    }
  }

  return columns;
}
