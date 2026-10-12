/*
 * Why a capture that ran stopped capturing, as the probe reports it with
 * the file and the `endReason` column stores it. The dashboard turns it into
 * a sentence ("Stopped after 1 minute", "Stopped from the dashboard"), so a
 * person can tell a capture that ran its course from one that hit a limit.
 */
enum PacketCaptureEndReason {
  // The duration the capture was started with ran out.
  DurationReached = "DurationReached",
  // The capture reached its packet limit.
  PacketLimitReached = "PacketLimitReached",
  // The file reached its size limit; it was cut at the last whole packet.
  FileSizeLimitReached = "FileSizeLimitReached",
  // Someone pressed Stop in the dashboard.
  StoppedFromDashboard = "StoppedFromDashboard",
  /*
   * The capture tool stopped by itself before any limit - the interface went
   * away, say. What it captured until then is kept, and the probe's
   * statusMessage says what the tool reported.
   */
  CaptureToolStopped = "CaptureToolStopped",
}

export default PacketCaptureEndReason;

export class PacketCaptureEndReasonUtil {
  public static getAll(): Array<PacketCaptureEndReason> {
    return [
      PacketCaptureEndReason.DurationReached,
      PacketCaptureEndReason.PacketLimitReached,
      PacketCaptureEndReason.FileSizeLimitReached,
      PacketCaptureEndReason.StoppedFromDashboard,
      PacketCaptureEndReason.CaptureToolStopped,
    ];
  }

  public static parse(value: unknown): PacketCaptureEndReason | undefined {
    if (typeof value !== "string") {
      return undefined;
    }

    return PacketCaptureEndReasonUtil.getAll().find(
      (reason: PacketCaptureEndReason): boolean => {
        return reason === value;
      },
    );
  }
}
