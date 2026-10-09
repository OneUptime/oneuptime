import {
  BYTES_IN_A_MEGABYTE,
  DEFAULT_PACKET_CAPTURE_LIMITS,
  HARD_MAX_PACKET_CAPTURE_LIMITS,
  PACKET_CAPTURE_DEFAULT_DURATION_IN_SECONDS,
  PACKET_CAPTURE_DEFAULT_FILE_SIZE_IN_MB,
  PACKET_CAPTURE_DEFAULT_MAX_PACKETS,
  PACKET_CAPTURE_DURATION_CHOICES_IN_SECONDS,
  PACKET_CAPTURE_HEARTBEAT_TIMEOUT_IN_MINUTES,
  PACKET_CAPTURE_MAX_ACTIVE_PER_PROBE,
  PACKET_CAPTURE_MAX_DURATION_IN_SECONDS,
  PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB,
  PACKET_CAPTURE_MAX_FILTER_LENGTH,
  PACKET_CAPTURE_MAX_PACKETS,
  PACKET_CAPTURE_MAX_UPLOAD_BASE64_LENGTH,
  PACKET_CAPTURE_MIN_DURATION_IN_SECONDS,
  PACKET_CAPTURE_MIN_FILE_SIZE_IN_MB,
  PACKET_CAPTURE_MIN_PACKETS,
  PACKET_CAPTURE_PICKUP_TIMEOUT_IN_MINUTES,
  PACKET_CAPTURE_RETENTION_IN_DAYS,
  PACKET_CAPTURE_UPLOAD_GRACE_IN_MINUTES,
  PacketCaptureLimitCheck,
  PacketCaptureLimits,
  PacketCaptureLimitsUtil,
} from "../../../Types/PacketCapture/PacketCaptureLimits";
import { describe, expect, test } from "@jest/globals";

/*
 * Every capture stops at the first of its duration, packet and size
 * limits. The server refuses a capture past the hard maximums - and past
 * the lower ones its probe reported - rather than quietly shortening it, and
 * the probe holds every capture to them again. These are the numbers the
 * docs, the dashboard and the probe all quote, so they are pinned here.
 */

function check(
  requested: Partial<Record<keyof PacketCaptureLimits, unknown>>,
  probeMaximums?: Partial<PacketCaptureLimits> | null,
): PacketCaptureLimitCheck {
  return PacketCaptureLimitsUtil.check({
    requested: requested,
    probeMaximums: probeMaximums,
  });
}

function errorOf(
  requested: Partial<Record<keyof PacketCaptureLimits, unknown>>,
  probeMaximums?: Partial<PacketCaptureLimits> | null,
): string | null {
  const result: PacketCaptureLimitCheck = check(requested, probeMaximums);

  if (result.error) {
    expect(result.limits).toBeNull();
  }

  return result.error;
}

describe("the limits every capture is held to", () => {
  test("a capture runs from 5 seconds to 30 minutes, 1 minute by default", () => {
    expect(PACKET_CAPTURE_MIN_DURATION_IN_SECONDS).toBe(5);
    expect(PACKET_CAPTURE_DEFAULT_DURATION_IN_SECONDS).toBe(60);
    expect(PACKET_CAPTURE_MAX_DURATION_IN_SECONDS).toBe(1800);
  });

  test("a capture stops after 1 to 1,000,000 packets, 100,000 by default", () => {
    expect(PACKET_CAPTURE_MIN_PACKETS).toBe(1);
    expect(PACKET_CAPTURE_DEFAULT_MAX_PACKETS).toBe(100000);
    expect(PACKET_CAPTURE_MAX_PACKETS).toBe(1000000);
  });

  test("a capture file is 1 to 25 MB, 10 MB by default", () => {
    expect(PACKET_CAPTURE_MIN_FILE_SIZE_IN_MB).toBe(1);
    expect(PACKET_CAPTURE_DEFAULT_FILE_SIZE_IN_MB).toBe(10);
    expect(PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB).toBe(25);
    expect(BYTES_IN_A_MEGABYTE).toBe(1048576);
  });

  test("the defaults and the hard maximums are those numbers", () => {
    expect(DEFAULT_PACKET_CAPTURE_LIMITS).toEqual({
      maxDurationInSeconds: 60,
      maxPackets: 100000,
      maxFileSizeInMB: 10,
    });
    expect(HARD_MAX_PACKET_CAPTURE_LIMITS).toEqual({
      maxDurationInSeconds: 1800,
      maxPackets: 1000000,
      maxFileSizeInMB: 25,
    });
  });

  test("captures are kept 7 days, a probe runs 2 at once, and filters are at most 500 characters", () => {
    expect(PACKET_CAPTURE_RETENTION_IN_DAYS).toBe(7);
    expect(PACKET_CAPTURE_MAX_ACTIVE_PER_PROBE).toBe(2);
    expect(PACKET_CAPTURE_MAX_FILTER_LENGTH).toBe(500);
  });

  test("the clocks that fail a capture nobody will finish", () => {
    expect(PACKET_CAPTURE_PICKUP_TIMEOUT_IN_MINUTES).toBe(5);
    expect(PACKET_CAPTURE_HEARTBEAT_TIMEOUT_IN_MINUTES).toBe(2);
    expect(PACKET_CAPTURE_UPLOAD_GRACE_IN_MINUTES).toBe(10);

    /*
     * The probe names its running captures every ten seconds, so the
     * heartbeat window is many polls wide; the pickup window is wider.
     */
    expect(PACKET_CAPTURE_HEARTBEAT_TIMEOUT_IN_MINUTES * 60).toBeGreaterThan(
      6 * 10,
    );
    expect(PACKET_CAPTURE_PICKUP_TIMEOUT_IN_MINUTES).toBeGreaterThan(
      PACKET_CAPTURE_HEARTBEAT_TIMEOUT_IN_MINUTES,
    );
  });

  test("the durations the dashboard offers are in range, ascending, and include the default and the maximum", () => {
    const choices: Array<number> = [
      ...PACKET_CAPTURE_DURATION_CHOICES_IN_SECONDS,
    ];

    expect(choices).toEqual(
      [...choices].sort((a: number, b: number): number => {
        return a - b;
      }),
    );

    for (const choice of choices) {
      expect(Number.isInteger(choice)).toBe(true);
      expect(choice).toBeGreaterThanOrEqual(
        PACKET_CAPTURE_MIN_DURATION_IN_SECONDS,
      );
      expect(choice).toBeLessThanOrEqual(
        PACKET_CAPTURE_MAX_DURATION_IN_SECONDS,
      );
    }

    expect(choices).toContain(PACKET_CAPTURE_DEFAULT_DURATION_IN_SECONDS);
    expect(choices).toContain(PACKET_CAPTURE_MAX_DURATION_IN_SECONDS);
  });

  test("the largest upload is the largest file, as base64", () => {
    const largestFile: Buffer = Buffer.alloc(
      PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB * BYTES_IN_A_MEGABYTE,
    );

    expect(largestFile.toString("base64")).toHaveLength(
      PACKET_CAPTURE_MAX_UPLOAD_BASE64_LENGTH,
    );
    expect(PACKET_CAPTURE_MAX_UPLOAD_BASE64_LENGTH).toBe(34952536);
  });
});

describe("PacketCaptureLimitsUtil.check", () => {
  test("nothing asked for is the defaults", () => {
    expect(check({})).toEqual({
      limits: DEFAULT_PACKET_CAPTURE_LIMITS,
      error: null,
    });
    expect(
      check({
        maxDurationInSeconds: null,
        maxPackets: "",
        maxFileSizeInMB: undefined,
      }),
    ).toEqual({ limits: DEFAULT_PACKET_CAPTURE_LIMITS, error: null });
  });

  test("whole numbers in range are taken as asked, from numbers or text", () => {
    expect(
      check({ maxDurationInSeconds: 300, maxPackets: 500, maxFileSizeInMB: 5 }),
    ).toEqual({
      limits: {
        maxDurationInSeconds: 300,
        maxPackets: 500,
        maxFileSizeInMB: 5,
      },
      error: null,
    });
    expect(
      check({
        maxDurationInSeconds: " 120 ",
        maxPackets: "1000",
        maxFileSizeInMB: "25",
      }).limits,
    ).toEqual({
      maxDurationInSeconds: 120,
      maxPackets: 1000,
      maxFileSizeInMB: 25,
    });
  });

  test("the minimums and the maximums themselves are accepted", () => {
    expect(
      check({ maxDurationInSeconds: 5, maxPackets: 1, maxFileSizeInMB: 1 })
        .limits,
    ).toEqual({ maxDurationInSeconds: 5, maxPackets: 1, maxFileSizeInMB: 1 });
    expect(
      check({
        maxDurationInSeconds: 1800,
        maxPackets: 1000000,
        maxFileSizeInMB: 25,
      }).limits,
    ).toEqual(HARD_MAX_PACKET_CAPTURE_LIMITS);
  });

  test("a value that is not a whole number is refused, by what it is", () => {
    expect(errorOf({ maxDurationInSeconds: 1.5 })).toBe(
      "The duration must be a whole number of seconds.",
    );
    expect(errorOf({ maxDurationInSeconds: "a minute" })).toBe(
      "The duration must be a whole number of seconds.",
    );
    expect(errorOf({ maxDurationInSeconds: Number.NaN })).toBe(
      "The duration must be a whole number of seconds.",
    );
    expect(errorOf({ maxDurationInSeconds: Infinity })).toBe(
      "The duration must be a whole number of seconds.",
    );
    expect(errorOf({ maxDurationInSeconds: true })).toBe(
      "The duration must be a whole number of seconds.",
    );
    expect(errorOf({ maxPackets: "many" })).toBe(
      "The packet limit must be a whole number.",
    );
    expect(errorOf({ maxFileSizeInMB: 2.5 })).toBe(
      "The file size limit must be a whole number of megabytes.",
    );
    expect(errorOf({ maxFileSizeInMB: "   " })).toBe(
      "The file size limit must be a whole number of megabytes.",
    );
  });

  test("a value below its minimum is refused", () => {
    expect(errorOf({ maxDurationInSeconds: 4 })).toBe(
      "A capture runs for at least 5 seconds.",
    );
    expect(errorOf({ maxPackets: 0 })).toBe(
      "A capture stops after at least 1 packet.",
    );
    expect(errorOf({ maxFileSizeInMB: 0 })).toBe(
      "A capture file is at least 1 MB.",
    );
    expect(errorOf({ maxFileSizeInMB: -5 })).toBe(
      "A capture file is at least 1 MB.",
    );
  });

  test("a value past a hard maximum is refused, never lowered", () => {
    expect(errorOf({ maxDurationInSeconds: 1801 })).toBe(
      "A capture runs for at most 30 minutes.",
    );
    expect(errorOf({ maxPackets: 1000001 })).toBe(
      "A capture stops after at most 1,000,000 packets.",
    );
    expect(errorOf({ maxFileSizeInMB: 26 })).toBe(
      "A capture file is at most 25 MB.",
    );
  });

  test("the first limit that is wrong is the one named", () => {
    expect(
      errorOf({ maxDurationInSeconds: 1, maxPackets: 0, maxFileSizeInMB: 99 }),
    ).toBe("A capture runs for at least 5 seconds.");
    expect(errorOf({ maxPackets: 0, maxFileSizeInMB: 99 })).toBe(
      "A capture stops after at least 1 packet.",
    );
  });

  test("a probe's lower maximums are held to, and named as the probe's", () => {
    const probeMaximums: Partial<PacketCaptureLimits> = {
      maxDurationInSeconds: 600,
      maxFileSizeInMB: 5,
    };

    expect(
      check({ maxDurationInSeconds: 600 }, probeMaximums).limits,
    ).toMatchObject({ maxDurationInSeconds: 600 });
    expect(errorOf({ maxDurationInSeconds: 601 }, probeMaximums)).toBe(
      "This probe allows captures of at most 10 minutes.",
    );
    expect(errorOf({ maxFileSizeInMB: 6 }, probeMaximums)).toBe(
      "This probe allows capture files of at most 5 MB.",
    );
    expect(
      errorOf({ maxDurationInSeconds: 90 }, { maxDurationInSeconds: 75 }),
    ).toBe("This probe allows captures of at most 1 minute 15 seconds.");
  });

  test("a default above a probe's maximum is lowered to it", () => {
    expect(
      check(
        {},
        { maxDurationInSeconds: 30, maxFileSizeInMB: 2, maxPackets: 50 },
      ).limits,
    ).toEqual({ maxDurationInSeconds: 30, maxPackets: 50, maxFileSizeInMB: 2 });
  });

  test("a probe can never raise a maximum, and a broken report changes nothing", () => {
    expect(
      errorOf({ maxDurationInSeconds: 1801 }, { maxDurationInSeconds: 99999 }),
    ).toBe("A capture runs for at most 30 minutes.");
    expect(errorOf({ maxFileSizeInMB: 26 }, { maxFileSizeInMB: 1000 })).toBe(
      "A capture file is at most 25 MB.",
    );

    for (const broken of [
      { maxDurationInSeconds: 2 },
      { maxDurationInSeconds: 1.5 },
      { maxDurationInSeconds: "600" as unknown as number },
      { maxDurationInSeconds: Number.NaN },
      { maxDurationInSeconds: -60 },
    ]) {
      expect(
        check({ maxDurationInSeconds: 1800 }, broken).limits,
      ).toMatchObject({ maxDurationInSeconds: 1800 });
    }
  });
});

describe("PacketCaptureLimitsUtil.getMaximums", () => {
  test("no report is the hard maximums", () => {
    expect(PacketCaptureLimitsUtil.getMaximums(null)).toEqual(
      HARD_MAX_PACKET_CAPTURE_LIMITS,
    );
    expect(PacketCaptureLimitsUtil.getMaximums(undefined)).toEqual(
      HARD_MAX_PACKET_CAPTURE_LIMITS,
    );
    expect(PacketCaptureLimitsUtil.getMaximums({})).toEqual(
      HARD_MAX_PACKET_CAPTURE_LIMITS,
    );
  });

  test("each reported maximum lowers its own limit only", () => {
    expect(PacketCaptureLimitsUtil.getMaximums({ maxPackets: 1000 })).toEqual({
      maxDurationInSeconds: 1800,
      maxPackets: 1000,
      maxFileSizeInMB: 25,
    });
  });

  test("a reported maximum below its minimum is ignored", () => {
    expect(
      PacketCaptureLimitsUtil.getMaximums({
        maxDurationInSeconds: 4,
        maxPackets: 0,
        maxFileSizeInMB: 0,
      }),
    ).toEqual(HARD_MAX_PACKET_CAPTURE_LIMITS);
  });
});

describe("PacketCaptureLimitsUtil.describeDuration", () => {
  test("says a duration the way people do", () => {
    expect(PacketCaptureLimitsUtil.describeDuration(0)).toBe("0 seconds");
    expect(PacketCaptureLimitsUtil.describeDuration(1)).toBe("1 second");
    expect(PacketCaptureLimitsUtil.describeDuration(30)).toBe("30 seconds");
    expect(PacketCaptureLimitsUtil.describeDuration(60)).toBe("1 minute");
    expect(PacketCaptureLimitsUtil.describeDuration(61)).toBe(
      "1 minute 1 second",
    );
    expect(PacketCaptureLimitsUtil.describeDuration(90)).toBe(
      "1 minute 30 seconds",
    );
    expect(PacketCaptureLimitsUtil.describeDuration(120)).toBe("2 minutes");
    expect(PacketCaptureLimitsUtil.describeDuration(1800)).toBe("30 minutes");
  });

  test("rounds to whole seconds and never goes below zero", () => {
    expect(PacketCaptureLimitsUtil.describeDuration(59.6)).toBe("1 minute");
    expect(PacketCaptureLimitsUtil.describeDuration(-5)).toBe("0 seconds");
  });
});

describe("PacketCaptureLimitsUtil.toBytes", () => {
  test("megabytes are mebibytes", () => {
    expect(PacketCaptureLimitsUtil.toBytes(1)).toBe(1048576);
    expect(PacketCaptureLimitsUtil.toBytes(25)).toBe(26214400);
    expect(PacketCaptureLimitsUtil.toBytes(0.5)).toBe(524288);
  });
});
