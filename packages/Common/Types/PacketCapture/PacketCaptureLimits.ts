/*
 * How big and how long a packet capture may be, and how long it is kept.
 *
 * Every capture stops at the FIRST of three limits - its duration, its
 * packet count and its file size - so a busy link fills the file in seconds
 * and a quiet one runs the clock out. The server refuses a capture asked for
 * past the hard maximums below, and the probe holds every capture it is
 * handed to them again (and to the lower maximums its operator may set), so
 * neither side has to trust the other to have done it.
 *
 * The file is stored in OneUptime's database and handed to the browser in
 * one piece, which is what the size maximum is sized for: plenty for a
 * filtered capture of the problem at hand, which is what Wireshark is opened
 * on, and small enough that a busy probe cannot fill the database.
 */

export const PACKET_CAPTURE_MIN_DURATION_IN_SECONDS: number = 5;
export const PACKET_CAPTURE_DEFAULT_DURATION_IN_SECONDS: number = 60;
export const PACKET_CAPTURE_MAX_DURATION_IN_SECONDS: number = 30 * 60;

/*
 * The durations the dashboard offers, in seconds. Any whole number of
 * seconds between the minimum and the maximum is accepted from the API.
 */
export const PACKET_CAPTURE_DURATION_CHOICES_IN_SECONDS: ReadonlyArray<number> =
  [30, 60, 2 * 60, 5 * 60, 10 * 60, 15 * 60, 30 * 60];

export const PACKET_CAPTURE_MIN_PACKETS: number = 1;
export const PACKET_CAPTURE_DEFAULT_MAX_PACKETS: number = 100000;
export const PACKET_CAPTURE_MAX_PACKETS: number = 1000000;

export const PACKET_CAPTURE_MIN_FILE_SIZE_IN_MB: number = 1;
export const PACKET_CAPTURE_DEFAULT_FILE_SIZE_IN_MB: number = 10;
export const PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB: number = 25;

export const BYTES_IN_A_MEGABYTE: number = 1024 * 1024;

/*
 * Captures, with their files, are deleted this many days after they were
 * started - finished or not. A capture holds the traffic itself, so it is
 * kept for the investigation, not for ever.
 */
export const PACKET_CAPTURE_RETENTION_IN_DAYS: number = 7;

/*
 * A Pending capture its probe has not picked up within this many minutes is
 * failed with the reason: the probe polls every ten seconds, so one that has
 * not asked in five minutes is disconnected or has captures turned off.
 */
export const PACKET_CAPTURE_PICKUP_TIMEOUT_IN_MINUTES: number = 5;

/*
 * A Running capture is failed when its probe has not reported it this many
 * minutes after its duration ran out: time to stop the capture tool and
 * upload the file over a slow link, and no more.
 */
export const PACKET_CAPTURE_UPLOAD_GRACE_IN_MINUTES: number = 10;

/*
 * A probe names the captures it is running every ten seconds, until each one
 * is uploaded. A Running capture no probe has named for this many minutes
 * belonged to a probe that restarted or lost its connection, and is failed
 * rather than left Running until its deadline.
 */
export const PACKET_CAPTURE_HEARTBEAT_TIMEOUT_IN_MINUTES: number = 2;

/*
 * Captures one probe may have Pending or Running at once. Two people can
 * look at two problems from the same probe; a third waits, so a probe's
 * uplink and memory are never spent on a pile of captures.
 */
export const PACKET_CAPTURE_MAX_ACTIVE_PER_PROBE: number = 2;

// The longest BPF filter expression accepted.
export const PACKET_CAPTURE_MAX_FILTER_LENGTH: number = 500;

/*
 * The largest base64 text a probe may upload for one capture: the file at
 * the hard maximum, as base64. The probe cuts every file to the capture's
 * limit, so anything longer did not come from a probe holding to it.
 */
export const PACKET_CAPTURE_MAX_UPLOAD_BASE64_LENGTH: number =
  Math.ceil((PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB * BYTES_IN_A_MEGABYTE) / 3) * 4;

export interface PacketCaptureLimits {
  maxDurationInSeconds: number;
  maxPackets: number;
  maxFileSizeInMB: number;
}

export const DEFAULT_PACKET_CAPTURE_LIMITS: PacketCaptureLimits = {
  maxDurationInSeconds: PACKET_CAPTURE_DEFAULT_DURATION_IN_SECONDS,
  maxPackets: PACKET_CAPTURE_DEFAULT_MAX_PACKETS,
  maxFileSizeInMB: PACKET_CAPTURE_DEFAULT_FILE_SIZE_IN_MB,
};

// The most any capture may ask for, whatever the probe allows.
export const HARD_MAX_PACKET_CAPTURE_LIMITS: PacketCaptureLimits = {
  maxDurationInSeconds: PACKET_CAPTURE_MAX_DURATION_IN_SECONDS,
  maxPackets: PACKET_CAPTURE_MAX_PACKETS,
  maxFileSizeInMB: PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB,
};

export interface PacketCaptureLimitCheck {
  limits: PacketCaptureLimits | null;
  // The first limit that is not acceptable, in words; null when all are.
  error: string | null;
}

export class PacketCaptureLimitsUtil {
  /*
   * The limits a capture is started with: each one asked for, or its
   * default when it is left out, held to the hard maximums and to the lower
   * ones the probe reported (`probeMaximums`). A value past a maximum is
   * refused rather than lowered, so nobody gets a shorter capture than they
   * asked for without being told.
   */
  public static check(data: {
    requested: Partial<Record<keyof PacketCaptureLimits, unknown>>;
    probeMaximums?: Partial<PacketCaptureLimits> | null | undefined;
  }): PacketCaptureLimitCheck {
    const maximums: PacketCaptureLimits = PacketCaptureLimitsUtil.getMaximums(
      data.probeMaximums,
    );

    const duration: number | string = PacketCaptureLimitsUtil.readWholeNumber({
      value: data.requested.maxDurationInSeconds,
      defaultValue: Math.min(
        PACKET_CAPTURE_DEFAULT_DURATION_IN_SECONDS,
        maximums.maxDurationInSeconds,
      ),
      min: PACKET_CAPTURE_MIN_DURATION_IN_SECONDS,
      max: maximums.maxDurationInSeconds,
      tooLow: `A capture runs for at least ${PACKET_CAPTURE_MIN_DURATION_IN_SECONDS} seconds.`,
      tooHigh: PacketCaptureLimitsUtil.isLoweredByProbe(
        maximums.maxDurationInSeconds,
        PACKET_CAPTURE_MAX_DURATION_IN_SECONDS,
      )
        ? `This probe allows captures of at most ${PacketCaptureLimitsUtil.describeDuration(maximums.maxDurationInSeconds)}.`
        : `A capture runs for at most ${PacketCaptureLimitsUtil.describeDuration(PACKET_CAPTURE_MAX_DURATION_IN_SECONDS)}.`,
      notANumber: "The duration must be a whole number of seconds.",
    });

    if (typeof duration === "string") {
      return { limits: null, error: duration };
    }

    const packets: number | string = PacketCaptureLimitsUtil.readWholeNumber({
      value: data.requested.maxPackets,
      defaultValue: Math.min(
        PACKET_CAPTURE_DEFAULT_MAX_PACKETS,
        maximums.maxPackets,
      ),
      min: PACKET_CAPTURE_MIN_PACKETS,
      max: maximums.maxPackets,
      tooLow: `A capture stops after at least ${PACKET_CAPTURE_MIN_PACKETS} packet.`,
      tooHigh: `A capture stops after at most ${maximums.maxPackets.toLocaleString("en-US")} packets.`,
      notANumber: "The packet limit must be a whole number.",
    });

    if (typeof packets === "string") {
      return { limits: null, error: packets };
    }

    const fileSize: number | string = PacketCaptureLimitsUtil.readWholeNumber({
      value: data.requested.maxFileSizeInMB,
      defaultValue: Math.min(
        PACKET_CAPTURE_DEFAULT_FILE_SIZE_IN_MB,
        maximums.maxFileSizeInMB,
      ),
      min: PACKET_CAPTURE_MIN_FILE_SIZE_IN_MB,
      max: maximums.maxFileSizeInMB,
      tooLow: `A capture file is at least ${PACKET_CAPTURE_MIN_FILE_SIZE_IN_MB} MB.`,
      tooHigh: PacketCaptureLimitsUtil.isLoweredByProbe(
        maximums.maxFileSizeInMB,
        PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB,
      )
        ? `This probe allows capture files of at most ${maximums.maxFileSizeInMB} MB.`
        : `A capture file is at most ${PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB} MB.`,
      notANumber: "The file size limit must be a whole number of megabytes.",
    });

    if (typeof fileSize === "string") {
      return { limits: null, error: fileSize };
    }

    return {
      limits: {
        maxDurationInSeconds: duration,
        maxPackets: packets,
        maxFileSizeInMB: fileSize,
      },
      error: null,
    };
  }

  /*
   * The maximums a capture on a probe is held to: the hard ones, lowered by
   * whatever the probe reported. A reported value that is not a whole number
   * in range is ignored, so a broken report can never raise a maximum.
   */
  public static getMaximums(
    probeMaximums?: Partial<PacketCaptureLimits> | null | undefined,
  ): PacketCaptureLimits {
    return {
      maxDurationInSeconds: PacketCaptureLimitsUtil.lowerTo({
        hardMaximum: PACKET_CAPTURE_MAX_DURATION_IN_SECONDS,
        minimum: PACKET_CAPTURE_MIN_DURATION_IN_SECONDS,
        reported: probeMaximums?.maxDurationInSeconds,
      }),
      maxPackets: PacketCaptureLimitsUtil.lowerTo({
        hardMaximum: PACKET_CAPTURE_MAX_PACKETS,
        minimum: PACKET_CAPTURE_MIN_PACKETS,
        reported: probeMaximums?.maxPackets,
      }),
      maxFileSizeInMB: PacketCaptureLimitsUtil.lowerTo({
        hardMaximum: PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB,
        minimum: PACKET_CAPTURE_MIN_FILE_SIZE_IN_MB,
        reported: probeMaximums?.maxFileSizeInMB,
      }),
    };
  }

  /*
   * A duration in words, the way limits and errors say it: "30 seconds",
   * "1 minute", "1 minute 30 seconds", "30 minutes".
   */
  public static describeDuration(seconds: number): string {
    const wholeSeconds: number = Math.max(0, Math.round(seconds));
    const minutes: number = Math.floor(wholeSeconds / 60);
    const remainder: number = wholeSeconds % 60;

    const minuteText: string =
      minutes === 1 ? "1 minute" : `${minutes} minutes`;
    const secondText: string =
      remainder === 1 ? "1 second" : `${remainder} seconds`;

    if (minutes === 0) {
      return secondText;
    }

    if (remainder === 0) {
      return minuteText;
    }

    return `${minuteText} ${secondText}`;
  }

  public static toBytes(megabytes: number): number {
    return Math.round(megabytes * BYTES_IN_A_MEGABYTE);
  }

  private static isLoweredByProbe(
    maximum: number,
    hardMaximum: number,
  ): boolean {
    return maximum < hardMaximum;
  }

  private static lowerTo(data: {
    hardMaximum: number;
    minimum: number;
    reported: unknown;
  }): number {
    const reported: unknown = data.reported;

    if (
      typeof reported !== "number" ||
      !Number.isInteger(reported) ||
      reported < data.minimum
    ) {
      return data.hardMaximum;
    }

    return Math.min(reported, data.hardMaximum);
  }

  // The number, its default when left out, or the refusal in words.
  private static readWholeNumber(data: {
    value: unknown;
    defaultValue: number;
    min: number;
    max: number;
    tooLow: string;
    tooHigh: string;
    notANumber: string;
  }): number | string {
    if (data.value === undefined || data.value === null || data.value === "") {
      return data.defaultValue;
    }

    const value: number =
      typeof data.value === "number"
        ? data.value
        : typeof data.value === "string" && data.value.trim()
          ? Number(data.value.trim())
          : Number.NaN;

    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      return data.notANumber;
    }

    if (value < data.min) {
      return data.tooLow;
    }

    if (value > data.max) {
      return data.tooHigh;
    }

    return value;
  }
}
