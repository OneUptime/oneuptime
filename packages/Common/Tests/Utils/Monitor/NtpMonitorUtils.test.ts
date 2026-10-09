import Hostname from "../../../Types/API/Hostname";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import IP from "../../../Types/IP/IP";
import { JSONObject } from "../../../Types/JSON";
import { CheckOn } from "../../../Types/Monitor/CriteriaFilter";
import MonitorMetricType from "../../../Types/Monitor/MonitorMetricType";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorTemplateSyncFieldUtil, {
  MonitorTemplateSyncField,
} from "../../../Types/Monitor/MonitorTemplateSyncField";
import MonitorType from "../../../Types/Monitor/MonitorType";
import Port from "../../../Types/Port";
import MonitorDestinationUtil, {
  ParsedMonitorDestination,
} from "../../../Utils/Monitor/MonitorDestinationUtil";
import MonitorMetricTypeUtil, {
  MonitorMetricCategory,
} from "../../../Utils/Monitor/MonitorMetricType";
import MonitorOverviewFamilyUtil, {
  MonitorOverviewFamily,
} from "../../../Utils/Monitor/MonitorOverviewFamily";
import MonitorOverviewTargetUtil from "../../../Utils/Monitor/MonitorOverviewTargetUtil";
import { describe, expect, test } from "@jest/globals";

/*
 * The places outside the probe that have to know about an NTP monitor: the
 * charts (which series it records and how a bucket of them reads), the
 * destination field, the one-line target under the monitor's name, and what
 * a template can keep out of sync.
 */

const NTP_SERIES: Array<MonitorMetricType> = [
  MonitorMetricType.NtpClockOffset,
  MonitorMetricType.NtpStratum,
  MonitorMetricType.NtpIsSynchronized,
  MonitorMetricType.NtpRootDispersion,
];

describe("NTP series", () => {
  test("an NTP monitor charts availability, response time and the four time series", () => {
    expect(
      MonitorMetricTypeUtil.getMonitorMetricTypesByMonitorType(MonitorType.NTP),
    ).toEqual([
      MonitorMetricType.IsOnline,
      MonitorMetricType.ResponseTime,
      ...NTP_SERIES,
    ]);
  });

  test("the charts group them as Availability and Time", () => {
    const categories: Array<MonitorMetricCategory> =
      MonitorMetricTypeUtil.getMonitorMetricCategoriesByMonitorType(
        MonitorType.NTP,
      );

    expect(
      categories.map((category: MonitorMetricCategory) => {
        return [category.title, category.metrics];
      }),
    ).toEqual([
      [
        "Availability",
        [MonitorMetricType.IsOnline, MonitorMetricType.ResponseTime],
      ],
      ["Time", NTP_SERIES],
    ]);
  });

  test("the series are stored under the oneuptime.monitor.ntp names", () => {
    expect(NTP_SERIES.map(String)).toEqual([
      "oneuptime.monitor.ntp.clock.offset",
      "oneuptime.monitor.ntp.stratum",
      "oneuptime.monitor.ntp.synchronized",
      "oneuptime.monitor.ntp.root.dispersion",
    ]);
  });

  test("a bucket reads its worst moment: the largest offset, stratum and dispersion", () => {
    for (const series of [
      MonitorMetricType.NtpClockOffset,
      MonitorMetricType.NtpStratum,
      MonitorMetricType.NtpRootDispersion,
    ]) {
      expect(
        MonitorMetricTypeUtil.getAggregationTypeByMonitorMetricType(series),
      ).toBe(AggregationType.Max);
    }
  });

  test("a bucket is synchronized only when every check in it was", () => {
    expect(
      MonitorMetricTypeUtil.getAggregationTypeByMonitorMetricType(
        MonitorMetricType.NtpIsSynchronized,
      ),
    ).toBe(AggregationType.Min);
  });

  test("titles and units", () => {
    expect(
      NTP_SERIES.map((series: MonitorMetricType) => {
        return [
          MonitorMetricTypeUtil.getTitleByMonitorMetricType(series),
          MonitorMetricTypeUtil.getLegendUnitByMonitorMetricType(series),
        ];
      }),
    ).toEqual([
      ["Clock Offset", "ms"],
      ["Stratum", ""],
      ["Is Synchronized", ""],
      ["Root Dispersion", "ms"],
    ]);
  });

  test("every series explains itself", () => {
    for (const series of NTP_SERIES) {
      expect(
        MonitorMetricTypeUtil.getDescriptionByMonitorMetricType(series).length,
      ).toBeGreaterThan(40);
    }
  });

  test("each CheckOn reads the series it is judged on over time", () => {
    expect(
      [
        CheckOn.NtpIsOnline,
        CheckOn.NtpResponseTime,
        CheckOn.NtpClockOffset,
        CheckOn.NtpStratum,
        CheckOn.NtpIsSynchronized,
        CheckOn.NtpRootDispersion,
      ].map((checkOn: CheckOn) => {
        return MonitorMetricTypeUtil.getMonitorMetricTypeByCheckOnOrNull(
          checkOn,
        );
      }),
    ).toEqual([
      MonitorMetricType.IsOnline,
      MonitorMetricType.ResponseTime,
      MonitorMetricType.NtpClockOffset,
      MonitorMetricType.NtpStratum,
      MonitorMetricType.NtpIsSynchronized,
      MonitorMetricType.NtpRootDispersion,
    ]);
  });
});

describe("the NTP server field", () => {
  function parse(value: string): ParsedMonitorDestination {
    return MonitorDestinationUtil.parse({
      value: value,
      monitorType: MonitorType.NTP,
    });
  }

  test("a host name is a Hostname", () => {
    const parsed: ParsedMonitorDestination = parse("time.example.com");

    expect(parsed.error).toBeNull();
    expect(parsed.destination).toBeInstanceOf(Hostname);
    expect(parsed.destination!.toString()).toBe("time.example.com");
  });

  test("an IPv4 address is an IP", () => {
    const parsed: ParsedMonitorDestination = parse("192.168.1.10");

    expect(parsed.error).toBeNull();
    expect(parsed.destination).toBeInstanceOf(IP);
  });

  test("an IPv6 address is an IP, with or without brackets", () => {
    expect(parse("2001:db8::123").destination).toBeInstanceOf(IP);
    expect(parse("[2001:db8::123]").destination).toBeInstanceOf(IP);
  });

  test("a host with a port keeps the port apart from the name", () => {
    const parsed: ParsedMonitorDestination = parse("time.example.com:1123");

    expect(parsed.error).toBeNull();
    expect(parsed.destination).toBeInstanceOf(Hostname);
    expect((parsed.destination as Hostname).hostname).toBe("time.example.com");
    expect((parsed.destination as Hostname).port?.toNumber()).toBe(1123);
  });

  test("a trailing colon is an error, not a host named without it", () => {
    expect(parse("time.example.com:").error).toBe(
      "time.example.com: is not a valid hostname or IP address.",
    );
  });
});

describe("the NTP monitor's target line", () => {
  function stepsOf(data: JSONObject): MonitorSteps {
    return {
      data: { monitorStepsInstanceArray: [{ data: data }] },
    } as unknown as MonitorSteps;
  }

  function targetOf(data: JSONObject): string | undefined {
    return MonitorOverviewTargetUtil.getTarget({
      monitorType: MonitorType.NTP,
      monitorSteps: stepsOf(data),
    })?.value;
  }

  test("shows the server", () => {
    expect(
      targetOf({
        monitorDestination: Hostname.fromString(
          "time.example.com",
        ) as unknown as JSONObject,
      }),
    ).toBe("time.example.com");
  });

  test("leaves out the standard port", () => {
    expect(
      targetOf({
        monitorDestination: Hostname.fromString(
          "time.example.com",
        ) as unknown as JSONObject,
        monitorDestinationPort: new Port(123) as unknown as JSONObject,
      }),
    ).toBe("time.example.com");
  });

  test("shows any other port", () => {
    expect(
      targetOf({
        monitorDestination: Hostname.fromString(
          "time.example.com",
        ) as unknown as JSONObject,
        monitorDestinationPort: new Port(1123) as unknown as JSONObject,
      }),
    ).toBe("time.example.com:1123");
  });

  test("brackets an IPv6 server when it shows a port", () => {
    expect(
      targetOf({
        monitorDestination: new IP("2001:db8::123") as unknown as JSONObject,
        monitorDestinationPort: new Port(1123) as unknown as JSONObject,
      }),
    ).toBe("[2001:db8::123]:1123");
  });

  test("is in a fixed-width font", () => {
    expect(
      MonitorOverviewTargetUtil.getTarget({
        monitorType: MonitorType.NTP,
        monitorSteps: stepsOf({ monitorDestination: "192.0.2.10" }),
      })?.isMono,
    ).toBe(true);
  });

  test("a step with no server shows nothing", () => {
    expect(targetOf({})).toBeUndefined();
  });

  test("is a probe check on the overview", () => {
    expect(MonitorOverviewFamilyUtil.getFamily(MonitorType.NTP)).toBe(
      MonitorOverviewFamily.ProbeCheck,
    );
  });
});

describe("what an NTP monitor from a template can keep out of sync", () => {
  test("the server, its port, the timeout and the retries", () => {
    expect(
      MonitorTemplateSyncFieldUtil.getFields(MonitorType.NTP).map(
        (field: MonitorTemplateSyncField) => {
          return field.path;
        },
      ),
    ).toEqual([
      "monitorDestination",
      "requestTimeoutInMs",
      "retryCount",
      "monitorDestinationPort",
    ]);
  });

  test("the port can be kept out of sync on an NTP monitor", () => {
    expect(
      MonitorTemplateSyncFieldUtil.parse(
        ["monitorDestinationPort"],
        MonitorType.NTP,
      ),
    ).toEqual(["monitorDestinationPort"]);
  });
});
