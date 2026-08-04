import MonitoringIntervalUtil, {
  AllMonitoringIntervalOptions,
  MINIMUM_MONITORING_INTERVAL_IN_SECONDS,
  MinuteAndAboveMonitoringIntervalOptions,
  MonitoringIntervalOption,
  SubMinuteMonitoringIntervalOptions,
} from "../../../Utils/Monitor/MonitoringIntervalUtil";
import CronTab from "../../../Utils/CronTab";
import { EVERY_FIVE_SECONDS } from "../../../Utils/CronTime";
import MonitorType from "../../../Types/Monitor/MonitorType";
import { describe, expect, test } from "@jest/globals";

/**
 * The gating matrix for sub-minute monitoring intervals.
 *
 * Three rules, all enforced here because the dashboard dropdown is not a
 * control - the API takes a raw cron string:
 *  1. Self-hosted only (billing disabled).
 *  2. An allow-list of 10s / 20s / 30s. Nothing faster, nothing uneven.
 *  3. Probe-monitored types only.
 *
 * The last block is the "we broke nothing" test: every interval OneUptime
 * offered before this feature existed must still validate for every monitor
 * type, under both billing states.
 */

const TELEMETRY_MONITOR_TYPES: Array<MonitorType> = [
  MonitorType.Logs,
  MonitorType.Metrics,
  MonitorType.Traces,
  MonitorType.Exceptions,
  MonitorType.Profiles,
  MonitorType.Kubernetes,
  MonitorType.Docker,
  MonitorType.Host,
  MonitorType.Podman,
  MonitorType.DockerSwarm,
  MonitorType.Proxmox,
  MonitorType.Ceph,
  MonitorType.IoTDevice,
];

const SUB_MINUTE_ELIGIBLE_MONITOR_TYPES: Array<MonitorType> = [
  MonitorType.API,
  MonitorType.Website,
  MonitorType.IP,
  MonitorType.Ping,
  MonitorType.Port,
  MonitorType.DNS,
  MonitorType.DNSSEC,
  MonitorType.Domain,
  MonitorType.SQLQuery,
  MonitorType.ExternalStatusPage,
];

const SLOW_MONITOR_TYPES: Array<MonitorType> = [
  MonitorType.SyntheticMonitor,
  MonitorType.CustomJavaScriptCode,
  MonitorType.SSLCertificate,
];

const LEGACY_INTERVAL_VALUES: Array<string> =
  MinuteAndAboveMonitoringIntervalOptions.map(
    (option: MonitoringIntervalOption) => {
      return option.value;
    },
  );

describe("MonitoringIntervalUtil", () => {
  describe("the option lists themselves", () => {
    test("sub-minute options are exactly 10s, 20s and 30s", () => {
      expect(
        SubMinuteMonitoringIntervalOptions.map(
          (option: MonitoringIntervalOption) => {
            return option.value;
          },
        ),
      ).toEqual(["*/10 * * * * *", "*/20 * * * * *", "*/30 * * * * *"]);
    });

    test("one second and five seconds are never offered", () => {
      const values: Array<string> = AllMonitoringIntervalOptions.map(
        (option: MonitoringIntervalOption) => {
          return option.value;
        },
      );

      expect(values).not.toContain(EVERY_FIVE_SECONDS);
      expect(values).not.toContain("* * * * * *");
    });

    test("the minute-and-above list is unchanged from before sub-minute existed", () => {
      expect(LEGACY_INTERVAL_VALUES).toEqual([
        "* * * * *",
        "*/2 * * * *",
        "*/5 * * * *",
        "*/10 * * * *",
        "*/15 * * * *",
        "*/30 * * * *",
        "0 * * * *",
        "0 0 * * *",
        "0 0 * * 0",
      ]);
    });

    test("sub-minute options sort ahead of the minute-and-above options", () => {
      expect(AllMonitoringIntervalOptions.slice(0, 3)).toEqual(
        SubMinuteMonitoringIntervalOptions,
      );
      expect(AllMonitoringIntervalOptions.slice(3)).toEqual(
        MinuteAndAboveMonitoringIntervalOptions,
      );
    });

    test.each(
      AllMonitoringIntervalOptions.map((option: MonitoringIntervalOption) => {
        return option.value;
      }),
    )("every offered value is a parseable cron: %s", (value: string) => {
      expect(CronTab.isValid(value)).toBe(true);
    });

    test.each(
      AllMonitoringIntervalOptions.map((option: MonitoringIntervalOption) => {
        return option;
      }),
    )(
      "every offered option has a label: $value",
      (option: MonitoringIntervalOption) => {
        expect(option.label.length).toBeGreaterThan(0);
      },
    );

    test("the floor is ten seconds", () => {
      expect(MINIMUM_MONITORING_INTERVAL_IN_SECONDS).toBe(10);
    });
  });

  describe("getSmallestGapInSeconds", () => {
    const cases: Array<[string, number]> = [
      ["*/10 * * * * *", 10],
      ["*/20 * * * * *", 20],
      ["*/30 * * * * *", 30],
      ["* * * * * *", 1],
      [EVERY_FIVE_SECONDS, 5],
      // Uneven: fires at :00 and :45, so the shortest gap is 15s, not 45s.
      ["*/45 * * * * *", 15],
      ["* * * * *", 60],
      ["0 * * * * *", 60],
      ["*/5 * * * *", 300],
      ["0 * * * *", 3600],
      ["0 0 * * *", 86400],
    ];

    test.each(cases)(
      "%s has a smallest gap of %s seconds",
      (expression: string, expected: number) => {
        expect(MonitoringIntervalUtil.getSmallestGapInSeconds(expression)).toBe(
          expected,
        );
      },
    );

    test("returns null for an unparseable expression", () => {
      expect(
        MonitoringIntervalUtil.getSmallestGapInSeconds("not a cron"),
      ).toBeNull();
      expect(MonitoringIntervalUtil.getSmallestGapInSeconds("")).toBeNull();
    });
  });

  describe("isSubMinuteInterval", () => {
    test.each([
      "*/10 * * * * *",
      "*/20 * * * * *",
      "*/30 * * * * *",
      "* * * * * *",
      EVERY_FIVE_SECONDS,
      "*/45 * * * * *",
    ])("%s is sub-minute", (expression: string) => {
      expect(MonitoringIntervalUtil.isSubMinuteInterval(expression)).toBe(true);
    });

    test.each(LEGACY_INTERVAL_VALUES)(
      "%s is not sub-minute",
      (expression: string) => {
        expect(MonitoringIntervalUtil.isSubMinuteInterval(expression)).toBe(
          false,
        );
      },
    );

    test("an unparseable expression is not treated as sub-minute", () => {
      expect(MonitoringIntervalUtil.isSubMinuteInterval("garbage")).toBe(false);
    });

    /*
     * The answer comes from the field count for five-field expressions, so a
     * cron that is syntactically valid but never fires (there is no 30th of
     * February) is settled without walking fire times looking for one.
     * Without the short-circuit this walks to the search cap - on every
     * monitor write, from an unauthenticated-by-content API payload.
     */
    test("a five-field expression that never fires is settled without a search", () => {
      const startedAt: number = Date.now();

      expect(MonitoringIntervalUtil.isSubMinuteInterval("0 0 30 2 *")).toBe(
        false,
      );

      expect(Date.now() - startedAt).toBeLessThan(100);
    });

    test("the same expression is accepted by the validator, exactly as before", () => {
      const startedAt: number = Date.now();

      expect(
        MonitoringIntervalUtil.getValidationError({
          monitoringInterval: "0 0 30 2 *",
          monitorType: MonitorType.Website,
          isBillingEnabled: false,
        }),
      ).toBeNull();

      expect(Date.now() - startedAt).toBeLessThan(100);
    });
  });

  describe("isSupportedSubMinuteInterval", () => {
    test.each(["*/10 * * * * *", "*/20 * * * * *", "*/30 * * * * *"])(
      "%s is supported",
      (expression: string) => {
        expect(
          MonitoringIntervalUtil.isSupportedSubMinuteInterval(expression),
        ).toBe(true);
      },
    );

    test.each([
      "* * * * * *",
      EVERY_FIVE_SECONDS,
      "*/45 * * * * *",
      "0-59/10 * * * * *",
    ])("%s is not supported", (expression: string) => {
      expect(
        MonitoringIntervalUtil.isSupportedSubMinuteInterval(expression),
      ).toBe(false);
    });
  });

  describe("isMonitorTypeEligibleForSubMinuteInterval", () => {
    test.each(SUB_MINUTE_ELIGIBLE_MONITOR_TYPES)(
      "%s is eligible",
      (monitorType: MonitorType) => {
        expect(
          MonitoringIntervalUtil.isMonitorTypeEligibleForSubMinuteInterval(
            monitorType,
          ),
        ).toBe(true);
      },
    );

    test.each(SLOW_MONITOR_TYPES)(
      "%s is too slow to be eligible",
      (monitorType: MonitorType) => {
        expect(
          MonitoringIntervalUtil.isMonitorTypeEligibleForSubMinuteInterval(
            monitorType,
          ),
        ).toBe(false);
      },
    );

    test.each(TELEMETRY_MONITOR_TYPES)(
      "%s is scheduled by a once-a-minute worker and is not eligible",
      (monitorType: MonitorType) => {
        expect(
          MonitoringIntervalUtil.isMonitorTypeEligibleForSubMinuteInterval(
            monitorType,
          ),
        ).toBe(false);
      },
    );

    test.each([
      MonitorType.Manual,
      MonitorType.IncomingRequest,
      MonitorType.IncomingEmail,
      MonitorType.Server,
      MonitorType.NetworkDevice,
    ])(
      "%s is not probe-polled and is not eligible",
      (monitorType: MonitorType) => {
        expect(
          MonitoringIntervalUtil.isMonitorTypeEligibleForSubMinuteInterval(
            monitorType,
          ),
        ).toBe(false);
      },
    );
  });

  describe("getLabel", () => {
    test.each(
      AllMonitoringIntervalOptions.map((option: MonitoringIntervalOption) => {
        return [option.value, option.label] as [string, string];
      }),
    )("labels %s as %s", (value: string, label: string) => {
      expect(MonitoringIntervalUtil.getLabel(value)).toBe(label);
    });

    test("returns null for a value we never offered", () => {
      expect(MonitoringIntervalUtil.getLabel("*/7 * * * *")).toBeNull();
    });
  });

  describe("getOptions", () => {
    test("a billing-enabled instance never sees sub-minute options", () => {
      const options: Array<MonitoringIntervalOption> =
        MonitoringIntervalUtil.getOptions({
          monitorType: MonitorType.Website,
          isSubMinuteAllowed: false,
        });

      expect(
        options.map((option: MonitoringIntervalOption) => {
          return option.value;
        }),
      ).toEqual(LEGACY_INTERVAL_VALUES);
    });

    test("a self-hosted instance sees sub-minute options first", () => {
      const options: Array<MonitoringIntervalOption> =
        MonitoringIntervalUtil.getOptions({
          monitorType: MonitorType.Website,
          isSubMinuteAllowed: true,
        });

      expect(options.length).toBe(12);
      expect(
        options.slice(0, 3).map((option: MonitoringIntervalOption) => {
          return option.value;
        }),
      ).toEqual(["*/10 * * * * *", "*/20 * * * * *", "*/30 * * * * *"]);
    });

    test("an unknown monitor type conservatively hides sub-minute options", () => {
      const options: Array<MonitoringIntervalOption> =
        MonitoringIntervalUtil.getOptions({
          isSubMinuteAllowed: true,
        });

      expect(
        options.map((option: MonitoringIntervalOption) => {
          return option.value;
        }),
      ).toEqual(LEGACY_INTERVAL_VALUES);
    });

    test.each(SLOW_MONITOR_TYPES)(
      "%s gets neither sub-minute options nor the 1 and 2 minute options",
      (monitorType: MonitorType) => {
        const values: Array<string> = MonitoringIntervalUtil.getOptions({
          monitorType: monitorType,
          isSubMinuteAllowed: true,
        }).map((option: MonitoringIntervalOption) => {
          return option.value;
        });

        expect(values).not.toContain("*/10 * * * * *");
        expect(values).not.toContain("*/20 * * * * *");
        expect(values).not.toContain("*/30 * * * * *");
        expect(values).not.toContain("* * * * *");
        expect(values).not.toContain("*/2 * * * *");
        expect(values).toContain("*/5 * * * *");
      },
    );

    test.each(TELEMETRY_MONITOR_TYPES)(
      "%s gets no sub-minute options even on self-hosted",
      (monitorType: MonitorType) => {
        const values: Array<string> = MonitoringIntervalUtil.getOptions({
          monitorType: monitorType,
          isSubMinuteAllowed: true,
        }).map((option: MonitoringIntervalOption) => {
          return option.value;
        });

        expect(values).toEqual(LEGACY_INTERVAL_VALUES);
      },
    );

    /*
     * The contract that keeps the dashboard and the API in step: anything the
     * picker offers must survive the write-time validator that runs on the
     * very same input.
     */
    test.each([true, false])(
      "every offered option validates (isSubMinuteAllowed=%s)",
      (isSubMinuteAllowed: boolean) => {
        for (const monitorType of Object.values(MonitorType)) {
          const options: Array<MonitoringIntervalOption> =
            MonitoringIntervalUtil.getOptions({
              monitorType: monitorType,
              isSubMinuteAllowed: isSubMinuteAllowed,
            });

          for (const option of options) {
            expect(
              MonitoringIntervalUtil.getValidationError({
                monitoringInterval: option.value,
                monitorType: monitorType,
                isBillingEnabled: !isSubMinuteAllowed,
              }),
            ).toBeNull();
          }
        }
      },
    );
  });

  describe("getValidationError", () => {
    test("an absent interval is allowed - the column is nullable", () => {
      expect(
        MonitoringIntervalUtil.getValidationError({
          monitoringInterval: undefined,
          monitorType: MonitorType.Website,
          isBillingEnabled: false,
        }),
      ).toBeNull();

      expect(
        MonitoringIntervalUtil.getValidationError({
          monitoringInterval: null,
          monitorType: MonitorType.Website,
          isBillingEnabled: false,
        }),
      ).toBeNull();
    });

    test.each(["not a cron", "* * * *", "* * * * * * *", "60 * * * *"])(
      "rejects the unparseable expression %s regardless of billing",
      (expression: string) => {
        for (const isBillingEnabled of [true, false]) {
          expect(
            MonitoringIntervalUtil.getValidationError({
              monitoringInterval: expression,
              monitorType: MonitorType.Website,
              isBillingEnabled: isBillingEnabled,
            }),
          ).toContain("Invalid monitoring interval");
        }
      },
    );

    test.each(["*/10 * * * * *", "*/20 * * * * *", "*/30 * * * * *"])(
      "%s is allowed on a self-hosted instance for a probe-polled monitor",
      (expression: string) => {
        expect(
          MonitoringIntervalUtil.getValidationError({
            monitoringInterval: expression,
            monitorType: MonitorType.Website,
            isBillingEnabled: false,
          }),
        ).toBeNull();
      },
    );

    test.each(["*/10 * * * * *", "*/20 * * * * *", "*/30 * * * * *"])(
      "%s is refused on a billing-enabled instance",
      (expression: string) => {
        expect(
          MonitoringIntervalUtil.getValidationError({
            monitoringInterval: expression,
            monitorType: MonitorType.Website,
            isBillingEnabled: true,
          }),
        ).toContain("self-hosted");
      },
    );

    /*
     * The floor. One second and five seconds are refused even on self-hosted,
     * per the explicit scope of this feature: ten seconds and up.
     */
    test.each([
      "* * * * * *",
      EVERY_FIVE_SECONDS,
      "*/2 * * * * *",
      "*/3 * * * * *",
    ])(
      "%s is faster than the floor and is refused even on self-hosted",
      (expression: string) => {
        expect(
          MonitoringIntervalUtil.getValidationError({
            monitoringInterval: expression,
            monitorType: MonitorType.Website,
            isBillingEnabled: false,
          }),
        ).toContain("must be one of");
      },
    );

    test.each(["*/45 * * * * *", "0-59/10 * * * * *", "0,15,30,45 * * * * *"])(
      "%s is sub-minute but not an offered value, so it is refused: %s",
      (expression: string) => {
        expect(
          MonitoringIntervalUtil.getValidationError({
            monitoringInterval: expression,
            monitorType: MonitorType.Website,
            isBillingEnabled: false,
          }),
        ).toContain("must be one of");
      },
    );

    test.each(SLOW_MONITOR_TYPES)(
      "sub-minute is refused for %s even on self-hosted",
      (monitorType: MonitorType) => {
        expect(
          MonitoringIntervalUtil.getValidationError({
            monitoringInterval: "*/10 * * * * *",
            monitorType: monitorType,
            isBillingEnabled: false,
          }),
        ).toContain("do not support sub-minute");
      },
    );

    test.each(TELEMETRY_MONITOR_TYPES)(
      "sub-minute is refused for %s - its scheduler only ticks once a minute",
      (monitorType: MonitorType) => {
        expect(
          MonitoringIntervalUtil.getValidationError({
            monitoringInterval: "*/10 * * * * *",
            monitorType: monitorType,
            isBillingEnabled: false,
          }),
        ).toContain("do not support sub-minute");
      },
    );

    test.each(SUB_MINUTE_ELIGIBLE_MONITOR_TYPES)(
      "sub-minute is allowed for %s on self-hosted",
      (monitorType: MonitorType) => {
        expect(
          MonitoringIntervalUtil.getValidationError({
            monitoringInterval: "*/20 * * * * *",
            monitorType: monitorType,
            isBillingEnabled: false,
          }),
        ).toBeNull();
      },
    );

    test("a sub-minute value with no monitor type passes the type check", () => {
      /*
       * Update payloads often carry only the interval. The caller re-runs the
       * check per matched row once it knows the types.
       */
      expect(
        MonitoringIntervalUtil.getValidationError({
          monitoringInterval: "*/10 * * * * *",
          isBillingEnabled: false,
        }),
      ).toBeNull();
    });

    /*
     * Nothing about existing monitors changes. Every interval OneUptime
     * offered before this feature must validate for every monitor type, under
     * both billing states.
     */
    test.each(LEGACY_INTERVAL_VALUES)(
      "%s stays valid for every monitor type under both billing states",
      (expression: string) => {
        for (const monitorType of Object.values(MonitorType)) {
          for (const isBillingEnabled of [true, false]) {
            expect(
              MonitoringIntervalUtil.getValidationError({
                monitoringInterval: expression,
                monitorType: monitorType,
                isBillingEnabled: isBillingEnabled,
              }),
            ).toBeNull();
          }
        }
      },
    );
  });
});
