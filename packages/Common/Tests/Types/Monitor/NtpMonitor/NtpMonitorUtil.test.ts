import NtpLeapIndicator from "../../../../Types/Monitor/NtpMonitor/NtpLeapIndicator";
import NtpMonitorUtil, {
  DEFAULT_NTP_MAX_CLOCK_OFFSET_IN_MS,
  DEFAULT_NTP_PORT,
  DEFAULT_NTP_REQUEST_TIMEOUT_IN_MS,
  NTP_MAX_SYNCHRONIZED_STRATUM,
  NTP_MIN_SYNCHRONIZED_STRATUM,
  NTP_UNSYNCHRONIZED_STRATUM,
} from "../../../../Types/Monitor/NtpMonitor/NtpMonitorUtil";
import { describe, expect, test } from "@jest/globals";

/*
 * NtpMonitorUtil holds the rules every part of the NTP monitor shares: the
 * probe decides "synchronized" with isSynchronized, the criteria and the
 * charts read getEffectiveStratum and getAbsoluteClockOffsetInMs, and the
 * monitor page and the failure causes use the describe* sentences.
 */
describe("NtpMonitorUtil", () => {
  describe("defaults", () => {
    test("checks UDP port 123", () => {
      expect(DEFAULT_NTP_PORT).toBe(123);
    });

    test("waits 5 seconds for a reply, far less than the 60 of TCP and HTTP checks", () => {
      expect(DEFAULT_NTP_REQUEST_TIMEOUT_IN_MS).toBe(5000);
    });

    test("counts a clock within one second of the probe's as good", () => {
      expect(DEFAULT_NTP_MAX_CLOCK_OFFSET_IN_MS).toBe(1000);
    });

    test("synchronized strata run from 1 to 15, and 16 means unsynchronized", () => {
      expect(NTP_MIN_SYNCHRONIZED_STRATUM).toBe(1);
      expect(NTP_MAX_SYNCHRONIZED_STRATUM).toBe(15);
      expect(NTP_UNSYNCHRONIZED_STRATUM).toBe(16);
    });
  });

  describe("getEffectiveStratum", () => {
    test.each([1, 2, 3, 8, 15])("keeps stratum %i", (stratum: number) => {
      expect(NtpMonitorUtil.getEffectiveStratum(stratum)).toBe(stratum);
    });

    test("a kiss-o'-death's 0 counts as 16, so 'at most 2' does not hold for it", () => {
      expect(NtpMonitorUtil.getEffectiveStratum(0)).toBe(16);
    });

    test.each([16, 17, 255])("stratum %i counts as 16", (stratum: number) => {
      expect(NtpMonitorUtil.getEffectiveStratum(stratum)).toBe(16);
    });

    test("a negative stratum counts as 16", () => {
      expect(NtpMonitorUtil.getEffectiveStratum(-1)).toBe(16);
    });

    test("no stratum stays unknown", () => {
      expect(NtpMonitorUtil.getEffectiveStratum(undefined)).toBeUndefined();
      expect(NtpMonitorUtil.getEffectiveStratum(null)).toBeUndefined();
    });

    test("a stratum that is not a finite number stays unknown", () => {
      expect(NtpMonitorUtil.getEffectiveStratum(NaN)).toBeUndefined();
      expect(NtpMonitorUtil.getEffectiveStratum(Infinity)).toBeUndefined();
    });
  });

  describe("isSynchronized", () => {
    test("stratum 2, no leap warning and real time is synchronized", () => {
      expect(
        NtpMonitorUtil.isSynchronized({
          stratum: 2,
          leapIndicator: NtpLeapIndicator.NoWarning,
          hasUsableTime: true,
        }),
      ).toBe(true);
    });

    test("a pending leap second is still synchronized", () => {
      expect(
        NtpMonitorUtil.isSynchronized({
          stratum: 1,
          leapIndicator: NtpLeapIndicator.LastMinuteHas61Seconds,
          hasUsableTime: true,
        }),
      ).toBe(true);
      expect(
        NtpMonitorUtil.isSynchronized({
          stratum: 1,
          leapIndicator: NtpLeapIndicator.LastMinuteHas59Seconds,
          hasUsableTime: true,
        }),
      ).toBe(true);
    });

    test("the leap indicator alarm (3) is not synchronized at any stratum", () => {
      expect(
        NtpMonitorUtil.isSynchronized({
          stratum: 2,
          leapIndicator: NtpLeapIndicator.Unsynchronized,
          hasUsableTime: true,
        }),
      ).toBe(false);
    });

    test("stratum 15 is the last synchronized stratum", () => {
      expect(
        NtpMonitorUtil.isSynchronized({
          stratum: 15,
          leapIndicator: 0,
          hasUsableTime: true,
        }),
      ).toBe(true);
      expect(
        NtpMonitorUtil.isSynchronized({
          stratum: 16,
          leapIndicator: 0,
          hasUsableTime: true,
        }),
      ).toBe(false);
    });

    test("stratum 0 (a kiss-o'-death or an unspecified stratum) is not synchronized", () => {
      expect(
        NtpMonitorUtil.isSynchronized({
          stratum: 0,
          leapIndicator: 0,
          hasUsableTime: true,
        }),
      ).toBe(false);
    });

    test("a reply without usable timestamps is not synchronized", () => {
      expect(
        NtpMonitorUtil.isSynchronized({
          stratum: 2,
          leapIndicator: 0,
          hasUsableTime: false,
        }),
      ).toBe(false);
    });

    test("an unknown stratum is not synchronized", () => {
      expect(
        NtpMonitorUtil.isSynchronized({
          stratum: undefined,
          leapIndicator: 0,
          hasUsableTime: true,
        }),
      ).toBe(false);
    });

    test("an unknown leap indicator does not on its own make a server unsynchronized", () => {
      expect(
        NtpMonitorUtil.isSynchronized({
          stratum: 3,
          leapIndicator: undefined,
          hasUsableTime: true,
        }),
      ).toBe(true);
    });
  });

  describe("getAbsoluteClockOffsetInMs", () => {
    test("a server behind is as far off as one ahead", () => {
      expect(
        NtpMonitorUtil.getAbsoluteClockOffsetInMs({ clockOffsetInMs: -500 }),
      ).toBe(500);
      expect(
        NtpMonitorUtil.getAbsoluteClockOffsetInMs({ clockOffsetInMs: 500 }),
      ).toBe(500);
    });

    test("keeps fractions of a millisecond", () => {
      expect(
        NtpMonitorUtil.getAbsoluteClockOffsetInMs({ clockOffsetInMs: -0.25 }),
      ).toBe(0.25);
    });

    test("zero stays zero", () => {
      expect(
        NtpMonitorUtil.getAbsoluteClockOffsetInMs({ clockOffsetInMs: 0 }),
      ).toBe(0);
    });

    test("no offset, no response or a non-finite offset is unknown", () => {
      expect(
        NtpMonitorUtil.getAbsoluteClockOffsetInMs({
          clockOffsetInMs: undefined,
        }),
      ).toBeUndefined();
      expect(NtpMonitorUtil.getAbsoluteClockOffsetInMs(undefined)).toBe(
        undefined,
      );
      expect(
        NtpMonitorUtil.getAbsoluteClockOffsetInMs({ clockOffsetInMs: NaN }),
      ).toBeUndefined();
    });
  });

  describe("kiss codes", () => {
    test.each([
      "ACST",
      "AUTH",
      "AUTO",
      "BCST",
      "CRYP",
      "DENY",
      "DROP",
      "RSTR",
      "INIT",
      "MCST",
      "NKEY",
      "NTSN",
      "RATE",
      "RMOT",
      "STEP",
    ])("%s is a known kiss code with its own explanation", (code: string) => {
      expect(NtpMonitorUtil.isKnownKissCode(code)).toBe(true);
      expect(NtpMonitorUtil.describeKissCode(code)).not.toContain(code);
    });

    test("RATE asks the probe to poll less often", () => {
      expect(NtpMonitorUtil.describeKissCode("RATE")).toBe(
        "the server is rate-limiting this probe and asks it to poll less often",
      );
    });

    test("DENY and RSTR say the server refuses the probe", () => {
      expect(NtpMonitorUtil.describeKissCode("DENY")).toBe(
        "the server denies access to this probe",
      );
      expect(NtpMonitorUtil.describeKissCode("RSTR")).toBe(
        "the server's access rules refuse this probe",
      );
    });

    test("an unknown code is named, not hidden", () => {
      expect(NtpMonitorUtil.isKnownKissCode("ABCD")).toBe(false);
      expect(NtpMonitorUtil.describeKissCode("ABCD")).toBe(
        "the server answered with the kiss code ABCD instead of the time",
      );
    });

    test("codes are matched exactly, so a lower-case code is unknown", () => {
      expect(NtpMonitorUtil.isKnownKissCode("rate")).toBe(false);
    });

    test("no code at all", () => {
      expect(NtpMonitorUtil.isKnownKissCode(undefined)).toBe(false);
      expect(NtpMonitorUtil.isKnownKissCode("")).toBe(false);
      expect(NtpMonitorUtil.describeKissCode(undefined)).toBe(
        "the server answered without the time",
      );
    });

    test("an inherited property name is not a kiss code", () => {
      expect(NtpMonitorUtil.isKnownKissCode("constructor")).toBe(false);
    });
  });

  describe("describeLeapIndicator", () => {
    test("names all four values", () => {
      expect(NtpMonitorUtil.describeLeapIndicator(0)).toBe(
        "No leap second pending",
      );
      expect(NtpMonitorUtil.describeLeapIndicator(1)).toBe(
        "A leap second will be added at the end of the day",
      );
      expect(NtpMonitorUtil.describeLeapIndicator(2)).toBe(
        "A leap second will be removed at the end of the day",
      );
      expect(NtpMonitorUtil.describeLeapIndicator(3)).toBe(
        "Alarm: the server's clock is not synchronized",
      );
    });

    test("anything else is unknown", () => {
      expect(NtpMonitorUtil.describeLeapIndicator(undefined)).toBe("Unknown");
      expect(NtpMonitorUtil.describeLeapIndicator(4)).toBe("Unknown");
    });
  });

  describe("describeStratum", () => {
    test("1 is a primary server", () => {
      expect(NtpMonitorUtil.describeStratum(1)).toBe("1 (primary server)");
    });

    test("2 to 15 are secondary servers", () => {
      expect(NtpMonitorUtil.describeStratum(2)).toBe("2 (secondary server)");
      expect(NtpMonitorUtil.describeStratum(15)).toBe("15 (secondary server)");
    });

    test("16 and above are not synchronized", () => {
      expect(NtpMonitorUtil.describeStratum(16)).toBe("16 (not synchronized)");
      expect(NtpMonitorUtil.describeStratum(200)).toBe(
        "200 (not synchronized)",
      );
    });

    test("0 names the kiss code when there is one", () => {
      expect(NtpMonitorUtil.describeStratum(0, "RATE")).toBe(
        "0 (kiss-o'-death RATE)",
      );
      expect(NtpMonitorUtil.describeStratum(0)).toBe(
        "0 (unspecified, not synchronized)",
      );
    });

    test("no stratum is unknown", () => {
      expect(NtpMonitorUtil.describeStratum(undefined)).toBe("Unknown");
    });
  });

  describe("formatMilliseconds", () => {
    test("below 1 ms keeps up to three decimals", () => {
      expect(NtpMonitorUtil.formatMilliseconds(0.0421)).toBe("0.042 ms");
    });

    test("1 to 10 ms keeps two decimals", () => {
      expect(NtpMonitorUtil.formatMilliseconds(3.14159)).toBe("3.14 ms");
    });

    test("10 to 100 ms keeps one decimal", () => {
      expect(NtpMonitorUtil.formatMilliseconds(12.34)).toBe("12.3 ms");
    });

    test("100 ms and more are whole, with a thousands separator", () => {
      expect(NtpMonitorUtil.formatMilliseconds(1532.4)).toBe("1,532 ms");
    });

    test("drops trailing zeros", () => {
      expect(NtpMonitorUtil.formatMilliseconds(5)).toBe("5 ms");
      expect(NtpMonitorUtil.formatMilliseconds(0)).toBe("0 ms");
    });

    test("keeps the sign", () => {
      expect(NtpMonitorUtil.formatMilliseconds(-12.34)).toBe("-12.3 ms");
    });
  });

  describe("describeClockOffset", () => {
    test("a positive offset is ahead of the probe", () => {
      expect(NtpMonitorUtil.describeClockOffset(12.34)).toBe(
        "12.3 ms ahead of the probe",
      );
    });

    test("a negative offset is behind the probe, without a minus sign", () => {
      expect(NtpMonitorUtil.describeClockOffset(-1532)).toBe(
        "1,532 ms behind the probe",
      );
    });

    test("zero is in step", () => {
      expect(NtpMonitorUtil.describeClockOffset(0)).toBe(
        "in step with the probe",
      );
    });
  });

  describe("describeWhyNotSynchronized", () => {
    test("says nothing about a synchronized server", () => {
      expect(
        NtpMonitorUtil.describeWhyNotSynchronized(
          { isSynchronized: true, stratum: 2, leapIndicator: 0 },
          true,
        ),
      ).toBe("");
    });

    test("a kiss-o'-death names its code and what it means", () => {
      expect(
        NtpMonitorUtil.describeWhyNotSynchronized(
          {
            isSynchronized: false,
            stratum: 0,
            kissCode: "RATE",
            leapIndicator: 3,
          },
          false,
        ),
      ).toBe(
        "The server answered with a kiss-o'-death (RATE): the server is rate-limiting this probe and asks it to poll less often.",
      );
    });

    test("stratum 0 without a code is an unknown stratum", () => {
      expect(
        NtpMonitorUtil.describeWhyNotSynchronized(
          { isSynchronized: false, stratum: 0, leapIndicator: 0 },
          true,
        ),
      ).toBe(
        "The server answered with stratum 0: it does not know its stratum, so it is not synchronized.",
      );
    });

    test("a reply without usable time says so", () => {
      expect(
        NtpMonitorUtil.describeWhyNotSynchronized(
          { isSynchronized: false, stratum: 2, leapIndicator: 0 },
          false,
        ),
      ).toBe("The server answered, but its reply carried no usable time.");
    });

    test("the leap indicator alarm", () => {
      expect(
        NtpMonitorUtil.describeWhyNotSynchronized(
          { isSynchronized: false, stratum: 3, leapIndicator: 3 },
          true,
        ),
      ).toBe(
        "The server reports its clock as not synchronized (leap indicator 3, alarm).",
      );
    });

    test("stratum 16", () => {
      expect(
        NtpMonitorUtil.describeWhyNotSynchronized(
          { isSynchronized: false, stratum: 16, leapIndicator: 0 },
          true,
        ),
      ).toBe(
        "The server reports stratum 16: it is not synchronized to a time source.",
      );
    });

    test("falls back to a plain sentence", () => {
      expect(
        NtpMonitorUtil.describeWhyNotSynchronized(
          { isSynchronized: false, stratum: undefined, leapIndicator: 0 },
          true,
        ),
      ).toBe("The server is not synchronized.");
    });
  });
});
