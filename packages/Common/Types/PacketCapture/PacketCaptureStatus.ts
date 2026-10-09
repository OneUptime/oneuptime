/*
 * Where one packet capture is in its life, as the strings its `status`
 * column holds. The same four words are read by the probe's claim query, the
 * probe's report, the stale-capture sweep and the dashboard, so they live in
 * one place.
 *
 *   Pending ── the probe claims it ──> Running ── the probe uploads ──> Completed
 *      │                                  │
 *      └── nobody picks it up ──> Failed <┴── the probe reports a failure,
 *                                             or stops reporting
 */
enum PacketCaptureStatus {
  // Started from the dashboard, waiting for its probe to pick it up.
  Pending = "Pending",
  // The probe is capturing right now.
  Running = "Running",
  /*
   * The probe finished and uploaded what it captured. A capture that matched
   * no packets is Completed too, with a packet count of 0 and no file.
   */
  Completed = "Completed",
  // The capture could not run or did not finish: `statusMessage` says why.
  Failed = "Failed",
}

export default PacketCaptureStatus;

// Nothing more is written to a capture in one of these.
export const SETTLED_PACKET_CAPTURE_STATUSES: ReadonlyArray<PacketCaptureStatus> =
  [PacketCaptureStatus.Completed, PacketCaptureStatus.Failed];

// A capture in one of these still takes one of its probe's capture slots.
export const ACTIVE_PACKET_CAPTURE_STATUSES: ReadonlyArray<PacketCaptureStatus> =
  [PacketCaptureStatus.Pending, PacketCaptureStatus.Running];

export class PacketCaptureStatusUtil {
  public static getAll(): Array<PacketCaptureStatus> {
    return [
      PacketCaptureStatus.Pending,
      PacketCaptureStatus.Running,
      PacketCaptureStatus.Completed,
      PacketCaptureStatus.Failed,
    ];
  }

  /*
   * The status a stored or posted string names, or undefined. Case-sensitive:
   * the column holds the value exactly and every reader compares it so.
   */
  public static parse(value: unknown): PacketCaptureStatus | undefined {
    if (typeof value !== "string") {
      return undefined;
    }

    return PacketCaptureStatusUtil.getAll().find(
      (status: PacketCaptureStatus): boolean => {
        return status === value;
      },
    );
  }

  public static isSettled(value: unknown): boolean {
    const status: PacketCaptureStatus | undefined =
      PacketCaptureStatusUtil.parse(value);

    return Boolean(status && SETTLED_PACKET_CAPTURE_STATUSES.includes(status));
  }

  public static isActive(value: unknown): boolean {
    const status: PacketCaptureStatus | undefined =
      PacketCaptureStatusUtil.parse(value);

    return Boolean(status && ACTIVE_PACKET_CAPTURE_STATUSES.includes(status));
  }
}
