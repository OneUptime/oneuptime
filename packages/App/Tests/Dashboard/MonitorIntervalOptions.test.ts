import { describe, expect, test } from "@jest/globals";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import MonitoringInterval, {
  getMonitoringIntervalLabel,
  getMonitoringIntervalOptions,
  getMonitoringIntervalValue,
  INTERVALS_SHORTER_THAN_5_MINUTES,
  MONITOR_TYPES_OFFERED_5_MINUTES_OR_LONGER,
} from "../../FeatureSet/Dashboard/src/Utils/MonitorIntervalDropdownOptions";
import { DEFAULT_MONITORING_INTERVAL } from "../../FeatureSet/Dashboard/src/Utils/Form/Monitor/MonitoringIntervalDefault";

/*
 * The intervals a monitor is offered, in one place.
 *
 * Create Monitor offered Synthetic, Custom Code and SSL monitors nothing
 * faster than every 5 minutes, while the monitor's own Interval page offered
 * every interval to every type, and the template forms each kept a copy of
 * the filter. Create, the template forms and the monitor's Probes & Interval
 * page now all ask getMonitoringIntervalOptions.
 *
 * The page also has to show what a monitor already has. The API takes any
 * interval of a minute or more for every type, and a dropdown whose value is
 * not among its options shows its placeholder - as if the monitor had no
 * interval at all - so the current interval always stays on the list.
 */

const ALL_VALUES: Array<string> = [
  "* * * * *",
  "*/2 * * * *",
  "*/5 * * * *",
  "*/10 * * * *",
  "*/15 * * * *",
  "*/30 * * * *",
  "0 * * * *",
  "0 0 * * *",
  "0 0 * * 0",
];

type ValuesOf = (data: {
  monitorType: MonitorType | null | undefined;
  currentInterval?: string | null | undefined;
}) => Array<string>;

const valuesOf: ValuesOf = (data: {
  monitorType: MonitorType | null | undefined;
  currentInterval?: string | null | undefined;
}): Array<string> => {
  return getMonitoringIntervalOptions(data).map(
    (option: { value: unknown }): string => {
      return option.value as string;
    },
  );
};

type LabelsOf = (data: {
  monitorType: MonitorType | null | undefined;
  currentInterval?: string | null | undefined;
}) => Array<string>;

const labelsOf: LabelsOf = (data: {
  monitorType: MonitorType | null | undefined;
  currentInterval?: string | null | undefined;
}): Array<string> => {
  return getMonitoringIntervalOptions(data).map(
    (option: { label: string }): string => {
      return option.label;
    },
  );
};

const PROBE_CHECKED_TYPES: Array<MonitorType> = Object.values(
  MonitorType,
).filter((type: MonitorType): boolean => {
  return MonitorTypeHelper.isProbableMonitor(type);
});

const SHORT_INTERVAL_TYPES: Array<MonitorType> = [
  MonitorType.SyntheticMonitor,
  MonitorType.CustomJavaScriptCode,
  MonitorType.SSLCertificate,
];

const EVERY_INTERVAL_TYPES: Array<MonitorType> = PROBE_CHECKED_TYPES.filter(
  (type: MonitorType): boolean => {
    return !SHORT_INTERVAL_TYPES.includes(type);
  },
);

describe("the list itself", () => {
  test("is nine intervals, shortest first, each a cron expression with a label", () => {
    expect(
      MonitoringInterval.map((option: { value: unknown }): unknown => {
        return option.value;
      }),
    ).toEqual(ALL_VALUES);
    expect(
      MonitoringInterval.map((option: { label: string }): string => {
        return option.label;
      }),
    ).toEqual([
      "Every Minute",
      "Every 2 Minutes",
      "Every 5 Minutes",
      "Every 10 Minutes",
      "Every 15 Minutes",
      "Every 30 Minutes",
      "Every Hour",
      "Every Day",
      "Every Week",
    ]);
  });

  test("names the three types that are offered 5 minutes or longer, and the two intervals they are not", () => {
    expect([...MONITOR_TYPES_OFFERED_5_MINUTES_OR_LONGER]).toEqual(
      SHORT_INTERVAL_TYPES,
    );
    expect([...INTERVALS_SHORTER_THAN_5_MINUTES]).toEqual([
      "* * * * *",
      "*/2 * * * *",
    ]);
  });
});

describe("getMonitoringIntervalOptions: what a type is offered", () => {
  test.each(EVERY_INTERVAL_TYPES)(
    "%s monitors are offered every interval",
    (type: MonitorType) => {
      expect(valuesOf({ monitorType: type })).toEqual(ALL_VALUES);
    },
  );

  test.each(SHORT_INTERVAL_TYPES)(
    "%s monitors are offered nothing faster than every 5 minutes",
    (type: MonitorType) => {
      expect(valuesOf({ monitorType: type })).toEqual(ALL_VALUES.slice(2));
    },
  );

  test("with no type yet (the create form before one is picked) every interval is offered", () => {
    expect(valuesOf({ monitorType: undefined })).toEqual(ALL_VALUES);
    expect(valuesOf({ monitorType: null })).toEqual(ALL_VALUES);
  });

  test.each(PROBE_CHECKED_TYPES)(
    "the create form's default of every 5 minutes is offered to %s monitors",
    (type: MonitorType) => {
      expect(valuesOf({ monitorType: type })).toContain(
        DEFAULT_MONITORING_INTERVAL,
      );
    },
  );

  test("hands out copies, so a caller changing an option cannot change the list", () => {
    const options: Array<{ value: unknown; label: string }> =
      getMonitoringIntervalOptions({ monitorType: MonitorType.API }) as Array<{
        value: unknown;
        label: string;
      }>;

    options[0]!.label = "Changed";
    options.pop();

    expect(MonitoringInterval[0]!.label).toBe("Every Minute");
    expect(MonitoringInterval).toHaveLength(9);
  });
});

describe("getMonitoringIntervalOptions: the interval a monitor has stays on the list", () => {
  test("a Synthetic monitor already checked every minute keeps that option, and no other short one", () => {
    expect(
      valuesOf({
        monitorType: MonitorType.SyntheticMonitor,
        currentInterval: "* * * * *",
      }),
    ).toEqual(["* * * * *", ...ALL_VALUES.slice(2)]);
  });

  test.each(SHORT_INTERVAL_TYPES)(
    "%s monitors already on every 2 minutes keep that option in its place",
    (type: MonitorType) => {
      expect(
        valuesOf({ monitorType: type, currentInterval: "*/2 * * * *" }),
      ).toEqual(["*/2 * * * *", ...ALL_VALUES.slice(2)]);
      expect(
        labelsOf({ monitorType: type, currentInterval: "*/2 * * * *" })[0],
      ).toBe("Every 2 Minutes");
    },
  );

  test("an interval the type is offered anyway changes nothing", () => {
    expect(
      valuesOf({
        monitorType: MonitorType.SyntheticMonitor,
        currentInterval: "*/15 * * * *",
      }),
    ).toEqual(ALL_VALUES.slice(2));
    expect(
      valuesOf({
        monitorType: MonitorType.API,
        currentInterval: "* * * * *",
      }),
    ).toEqual(ALL_VALUES);
  });

  test("a cron the list does not have is added in words, where its spacing puts it", () => {
    const options: Array<{ value: unknown; label: string }> =
      getMonitoringIntervalOptions({
        monitorType: MonitorType.API,
        currentInterval: "*/3 * * * *",
      }) as Array<{ value: unknown; label: string }>;

    expect(
      options.map((option: { value: unknown }): unknown => {
        return option.value;
      }),
    ).toEqual([
      "* * * * *",
      "*/2 * * * *",
      "*/3 * * * *",
      ...ALL_VALUES.slice(2),
    ]);
    expect(options[2]!.label).toBe("Every 3 minutes");
  });

  test("an hourly cron the list does not have goes between every hour and every day", () => {
    expect(
      valuesOf({
        monitorType: MonitorType.Website,
        currentInterval: "0 */6 * * *",
      }),
    ).toEqual([
      ...ALL_VALUES.slice(0, 7),
      "0 */6 * * *",
      ...ALL_VALUES.slice(7),
    ]);
    expect(
      labelsOf({
        monitorType: MonitorType.Website,
        currentInterval: "0 */6 * * *",
      })[7],
    ).toBe("Every 6 hours");
  });

  test("a cron longer than every week goes last", () => {
    const values: Array<string> = valuesOf({
      monitorType: MonitorType.API,
      currentInterval: "0 0 1 * *",
    });

    expect(values).toEqual([...ALL_VALUES, "0 0 1 * *"]);
  });

  test("a Synthetic monitor on a 3-minute cron keeps it, and is still not offered 1 or 2 minutes", () => {
    expect(
      valuesOf({
        monitorType: MonitorType.SyntheticMonitor,
        currentInterval: "*/3 * * * *",
      }),
    ).toEqual(["*/3 * * * *", ...ALL_VALUES.slice(2)]);
  });

  test('a row still spelled the old way ("5m") selects the option it means instead of adding one', () => {
    expect(
      valuesOf({ monitorType: MonitorType.API, currentInterval: "5m" }),
    ).toEqual(ALL_VALUES);
    expect(getMonitoringIntervalValue("5m")).toBe("*/5 * * * *");
  });

  test("no interval at all adds nothing", () => {
    for (const current of [undefined, null, "", "   "]) {
      expect(
        valuesOf({ monitorType: MonitorType.API, currentInterval: current }),
      ).toEqual(ALL_VALUES);
    }
  });

  test("a value nobody can read is still shown, as the schedule the probes actually keep", () => {
    const options: Array<{ value: unknown; label: string }> =
      getMonitoringIntervalOptions({
        monitorType: MonitorType.API,
        currentInterval: "not a schedule",
      }) as Array<{ value: unknown; label: string }>;

    const added: { value: unknown; label: string } | undefined = options.find(
      (option: { value: unknown }): boolean => {
        return option.value === "not a schedule";
      },
    );

    // The probes fall back to every minute for an interval they cannot read.
    expect(added?.label).toBe("Every minute");
    expect(options).toHaveLength(10);
  });
});

describe("getMonitoringIntervalValue", () => {
  test("is the cron the options spell, for every option", () => {
    for (const value of ALL_VALUES) {
      expect(getMonitoringIntervalValue(value)).toBe(value);
    }
  });

  test("trims, and reads nothing as no interval", () => {
    expect(getMonitoringIntervalValue("  */5 * * * *  ")).toBe("*/5 * * * *");
    expect(getMonitoringIntervalValue(undefined)).toBeUndefined();
    expect(getMonitoringIntervalValue(null)).toBeUndefined();
    expect(getMonitoringIntervalValue("")).toBeUndefined();
  });

  test("keeps a value it cannot read as it is", () => {
    expect(getMonitoringIntervalValue("not a schedule")).toBe("not a schedule");
  });
});

describe("getMonitoringIntervalLabel", () => {
  test("is the option's own label for an interval on the list", () => {
    expect(getMonitoringIntervalLabel("*/5 * * * *")).toBe("Every 5 Minutes");
    expect(getMonitoringIntervalLabel("0 * * * *")).toBe("Every Hour");
    expect(getMonitoringIntervalLabel("0 0 * * 0")).toBe("Every Week");
  });

  test("puts an interval the list does not have in words, instead of nothing", () => {
    expect(getMonitoringIntervalLabel("*/3 * * * *")).toBe("Every 3 minutes");
    expect(getMonitoringIntervalLabel("0 */6 * * *")).toBe("Every 6 hours");
  });

  test("reads an old spelling as the option it means", () => {
    expect(getMonitoringIntervalLabel("5m")).toBe("Every 5 Minutes");
  });

  test("is undefined for no interval", () => {
    expect(getMonitoringIntervalLabel(undefined)).toBeUndefined();
    expect(getMonitoringIntervalLabel(null)).toBeUndefined();
    expect(getMonitoringIntervalLabel("")).toBeUndefined();
  });
});
