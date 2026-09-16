import {
  CheckOn,
  CriteriaFilter,
  CriteriaFilterUtil,
  EvaluateOverTimeType,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorMetricType from "../../../Types/Monitor/MonitorMetricType";
import MonitorMetricTypeUtil from "../../../Utils/Monitor/MonitorMetricType";

// The true/false checks that can be evaluated over time.
const BOOLEAN_SERIES_CHECK_ONS: Array<CheckOn> = [
  CheckOn.IsOnline,
  CheckOn.DnsIsOnline,
  CheckOn.SnmpIsOnline,
  CheckOn.ExternalStatusPageIsOnline,
  CheckOn.DatabaseIsOnline,
];

const AGGREGATE_TYPES: Array<EvaluateOverTimeType> = [
  EvaluateOverTimeType.Average,
  EvaluateOverTimeType.Sum,
  EvaluateOverTimeType.MaximumValue,
  EvaluateOverTimeType.MunimumValue,
];

describe("CriteriaFilterUtil", () => {
  describe("isAnomalyFilterType", () => {
    test.each([
      FilterType.AnomalouslyHigh,
      FilterType.AnomalouslyLow,
      FilterType.Anomalous,
    ])("returns true for %s", (filterType: FilterType) => {
      expect(CriteriaFilterUtil.isAnomalyFilterType(filterType)).toBe(true);
    });

    test.each([FilterType.EqualTo, FilterType.GreaterThan])(
      "returns false for %s",
      (filterType: FilterType) => {
        expect(CriteriaFilterUtil.isAnomalyFilterType(filterType)).toBe(false);
      },
    );

    test("returns false for undefined", () => {
      expect(CriteriaFilterUtil.isAnomalyFilterType(undefined)).toBe(false);
    });
  });

  describe("hasValueField", () => {
    test("returns true for a plain threshold filter", () => {
      expect(
        CriteriaFilterUtil.hasValueField({
          checkOn: CheckOn.ResponseTime,
          filterType: FilterType.GreaterThan,
        }),
      ).toBe(true);
    });

    test("returns false for anomaly filter types", () => {
      expect(
        CriteriaFilterUtil.hasValueField({
          checkOn: CheckOn.MetricValue,
          filterType: FilterType.AnomalouslyHigh,
        }),
      ).toBe(false);
    });

    test.each([
      CheckOn.IsOnline,
      CheckOn.SnmpIsOnline,
      CheckOn.DnsIsOnline,
      CheckOn.DomainIsExpired,
      CheckOn.IsRequestTimeout,
      CheckOn.SnmpOidExists,
      CheckOn.IsValidCertificate,
    ])("returns false for boolean-style checkOn %s", (checkOn: CheckOn) => {
      expect(
        CriteriaFilterUtil.hasValueField({
          checkOn,
          filterType: FilterType.True,
        }),
      ).toBe(false);
    });

    test.each([
      FilterType.IsEmpty,
      FilterType.IsNotEmpty,
      FilterType.True,
      FilterType.False,
    ])(
      "returns false for valueless filter type %s",
      (filterType: FilterType) => {
        expect(
          CriteriaFilterUtil.hasValueField({
            checkOn: CheckOn.ResponseBody,
            filterType,
          }),
        ).toBe(false);
      },
    );

    test.each([
      CheckOn.DnssecChainValid,
      CheckOn.DnssecDnskeyExists,
      CheckOn.DnssecDsExists,
      CheckOn.DnssecResolverConsensus,
      CheckOn.DnssecNameserverConsistent,
      CheckOn.ExternalStatusPageIsOnline,
    ])(
      "returns false for the rest of the boolean checkOn group %s",
      (checkOn: CheckOn) => {
        expect(
          CriteriaFilterUtil.hasValueField({
            checkOn,
            filterType: FilterType.GreaterThan,
          }),
        ).toBe(false);
      },
    );

    test.each([CheckOn.DnssecIsValid, CheckOn.DnsRecordExists])(
      "returns false for the existence-style checkOn %s",
      (checkOn: CheckOn) => {
        expect(
          CriteriaFilterUtil.hasValueField({
            checkOn,
            filterType: FilterType.GreaterThan,
          }),
        ).toBe(false);
      },
    );

    test.each([
      FilterType.AnomalouslyHigh,
      FilterType.AnomalouslyLow,
      FilterType.Anomalous,
    ])(
      "anomaly filter type %s short-circuits even for a normally-valued checkOn",
      (filterType: FilterType) => {
        expect(
          CriteriaFilterUtil.hasValueField({
            checkOn: CheckOn.ResponseTime,
            filterType,
          }),
        ).toBe(false);
      },
    );

    test("returns true for ResponseTime with GreaterThan", () => {
      expect(
        CriteriaFilterUtil.hasValueField({
          checkOn: CheckOn.ResponseTime,
          filterType: FilterType.GreaterThan,
        }),
      ).toBe(true);
    });

    test("returns true for ResponseStatusCode with EqualTo", () => {
      expect(
        CriteriaFilterUtil.hasValueField({
          checkOn: CheckOn.ResponseStatusCode,
          filterType: FilterType.EqualTo,
        }),
      ).toBe(true);
    });

    test("returns true for a string-comparison filter that falls through all guards", () => {
      expect(
        CriteriaFilterUtil.hasValueField({
          checkOn: CheckOn.ResponseBody,
          filterType: FilterType.Contains,
        }),
      ).toBe(true);
    });

    test("returns true when filterType is undefined and checkOn is not valueless", () => {
      expect(
        CriteriaFilterUtil.hasValueField({
          checkOn: CheckOn.ResponseTime,
          filterType: undefined,
        }),
      ).toBe(true);
    });

    test.each([
      CheckOn.IsExpiredCertificate,
      CheckOn.IsNotAValidCertificate,
      CheckOn.IsSelfSignedCertificate,
    ])(
      "returns false for the rest of the certificate checkOn group %s",
      (checkOn: CheckOn) => {
        expect(
          CriteriaFilterUtil.hasValueField({
            checkOn,
            filterType: FilterType.GreaterThan,
          }),
        ).toBe(false);
      },
    );
  });

  describe("getEvaluateOverTimeTypeByCriteriaFilter", () => {
    test("returns an empty list when no filter is provided", () => {
      expect(
        CriteriaFilterUtil.getEvaluateOverTimeTypeByCriteriaFilter(undefined),
      ).toEqual([]);
    });

    /*
     * DNS, SNMP and External Status Page used to be offered Average / Sum /
     * Maximum / Minimum as well. Averaging a true/false window gives a number
     * such as 0.6, which neither True nor False matches, so a filter
     * configured that way never fired.
     */
    test.each(BOOLEAN_SERIES_CHECK_ONS)(
      "returns only AllValues / AnyValue for %s",
      (checkOn: CheckOn) => {
        const result: Array<EvaluateOverTimeType> =
          CriteriaFilterUtil.getEvaluateOverTimeTypeByCriteriaFilter({
            checkOn: checkOn,
            filterType: FilterType.True,
            value: undefined,
          } as CriteriaFilter);

        expect(result).toEqual([
          EvaluateOverTimeType.AllValues,
          EvaluateOverTimeType.AnyValue,
        ]);
      },
    );

    test.each([
      CheckOn.ResponseTime,
      CheckOn.DnsResponseTime,
      CheckOn.SnmpResponseTime,
      CheckOn.ExternalStatusPageResponseTime,
      CheckOn.DatabaseMetric,
    ])(
      "returns the full set of aggregation types for the numeric filter %s",
      (checkOn: CheckOn) => {
        const result: Array<EvaluateOverTimeType> =
          CriteriaFilterUtil.getEvaluateOverTimeTypeByCriteriaFilter({
            checkOn: checkOn,
            filterType: FilterType.GreaterThan,
            value: 100,
          } as CriteriaFilter);

        expect(result).toEqual([
          EvaluateOverTimeType.Average,
          EvaluateOverTimeType.Sum,
          EvaluateOverTimeType.MaximumValue,
          EvaluateOverTimeType.MunimumValue,
          EvaluateOverTimeType.AllValues,
          EvaluateOverTimeType.AnyValue,
        ]);
      },
    );

    test("offers no aggregate on any over-time filter that reads the online series", () => {
      const overTimeOnlineCheckOns: Array<CheckOn> = Object.values(
        CheckOn,
      ).filter((checkOn: CheckOn) => {
        return (
          CriteriaFilterUtil.isEvaluateOverTimeFilter(checkOn) &&
          MonitorMetricTypeUtil.getMonitorMetricTypeByCriteriaFilterOrNull({
            checkOn: checkOn,
            filterType: FilterType.True,
            value: undefined,
          }) === MonitorMetricType.IsOnline
        );
      });

      // Guards the filter above against silently matching nothing.
      expect(overTimeOnlineCheckOns.length).toBeGreaterThanOrEqual(5);

      for (const checkOn of overTimeOnlineCheckOns) {
        expect(
          CriteriaFilterUtil.getEvaluateOverTimeTypeByCriteriaFilter({
            checkOn: checkOn,
            filterType: FilterType.True,
            value: undefined,
          }),
        ).toEqual([
          EvaluateOverTimeType.AllValues,
          EvaluateOverTimeType.AnyValue,
        ]);
      }
    });
  });

  describe("isBooleanSeries", () => {
    test.each(BOOLEAN_SERIES_CHECK_ONS)(
      "returns true for %s",
      (checkOn: CheckOn) => {
        expect(CriteriaFilterUtil.isBooleanSeries(checkOn)).toBe(true);
      },
    );

    test("returns true for Is Request Timeout", () => {
      expect(CriteriaFilterUtil.isBooleanSeries(CheckOn.IsRequestTimeout)).toBe(
        true,
      );
    });

    test.each([
      CheckOn.ResponseTime,
      CheckOn.ResponseStatusCode,
      CheckOn.CPUUsagePercent,
      CheckOn.DnsResponseTime,
      CheckOn.SnmpResponseTime,
      CheckOn.ExternalStatusPageResponseTime,
      CheckOn.DatabaseMetric,
      CheckOn.MetricValue,
    ])("returns false for the numeric series %s", (checkOn: CheckOn) => {
      expect(CriteriaFilterUtil.isBooleanSeries(checkOn)).toBe(false);
    });

    test("returns false for undefined", () => {
      expect(CriteriaFilterUtil.isBooleanSeries(undefined)).toBe(false);
    });
  });

  describe("getEffectiveEvaluateOverTimeType", () => {
    function overTimeFilter(input: {
      checkOn: CheckOn;
      evaluateOverTimeType: EvaluateOverTimeType | undefined;
    }): CriteriaFilter {
      return {
        checkOn: input.checkOn,
        filterType: FilterType.False,
        value: undefined,
        evaluateOverTime: true,
        evaluateOverTimeOptions: {
          timeValueInMinutes: 5,
          evaluateOverTimeType: input.evaluateOverTimeType,
        },
      };
    }

    test("returns undefined when no filter is provided", () => {
      expect(
        CriteriaFilterUtil.getEffectiveEvaluateOverTimeType(undefined),
      ).toBeUndefined();
    });

    test("returns undefined when the filter has no over-time options", () => {
      expect(
        CriteriaFilterUtil.getEffectiveEvaluateOverTimeType({
          checkOn: CheckOn.DnsIsOnline,
          filterType: FilterType.False,
          value: undefined,
        }),
      ).toBeUndefined();
    });

    describe.each(BOOLEAN_SERIES_CHECK_ONS)("on %s", (checkOn: CheckOn) => {
      /*
       * Filters saved before the dashboard stopped offering these, and ones
       * sent through the API or Terraform, still carry them.
       */
      test.each(AGGREGATE_TYPES)(
        "judges %s as All Values",
        (evaluateOverTimeType: EvaluateOverTimeType) => {
          expect(
            CriteriaFilterUtil.getEffectiveEvaluateOverTimeType(
              overTimeFilter({
                checkOn: checkOn,
                evaluateOverTimeType: evaluateOverTimeType,
              }),
            ),
          ).toBe(EvaluateOverTimeType.AllValues);
        },
      );

      test.each([
        EvaluateOverTimeType.AllValues,
        EvaluateOverTimeType.AnyValue,
      ])("keeps %s as saved", (evaluateOverTimeType: EvaluateOverTimeType) => {
        expect(
          CriteriaFilterUtil.getEffectiveEvaluateOverTimeType(
            overTimeFilter({
              checkOn: checkOn,
              evaluateOverTimeType: evaluateOverTimeType,
            }),
          ),
        ).toBe(evaluateOverTimeType);
      });

      test("leaves a missing type missing", () => {
        expect(
          CriteriaFilterUtil.getEffectiveEvaluateOverTimeType(
            overTimeFilter({
              checkOn: checkOn,
              evaluateOverTimeType: undefined,
            }),
          ),
        ).toBeUndefined();
      });
    });

    test.each(AGGREGATE_TYPES)(
      "keeps %s on a numeric series",
      (evaluateOverTimeType: EvaluateOverTimeType) => {
        expect(
          CriteriaFilterUtil.getEffectiveEvaluateOverTimeType(
            overTimeFilter({
              checkOn: CheckOn.DnsResponseTime,
              evaluateOverTimeType: evaluateOverTimeType,
            }),
          ),
        ).toBe(evaluateOverTimeType);
      },
    );
  });

  describe("getInverseFilterType", () => {
    test.each([
      [FilterType.GreaterThan, FilterType.LessThanOrEqualTo],
      [FilterType.LessThan, FilterType.GreaterThanOrEqualTo],
      [FilterType.GreaterThanOrEqualTo, FilterType.LessThan],
      [FilterType.LessThanOrEqualTo, FilterType.GreaterThan],
      [FilterType.EqualTo, FilterType.NotEqualTo],
      [FilterType.NotEqualTo, FilterType.EqualTo],
    ])("inverts %s to %s", (input: FilterType, expected: FilterType) => {
      expect(CriteriaFilterUtil.getInverseFilterType(input)).toBe(expected);
    });

    test("returns the same filter type when there is no inverse", () => {
      expect(CriteriaFilterUtil.getInverseFilterType(FilterType.Contains)).toBe(
        FilterType.Contains,
      );
    });

    test.each([
      FilterType.Contains,
      FilterType.NotContains,
      FilterType.StartsWith,
      FilterType.EndsWith,
      FilterType.IsEmpty,
      FilterType.True,
    ])(
      "returns %s itself for non-invertible filter types",
      (filterType: FilterType) => {
        expect(CriteriaFilterUtil.getInverseFilterType(filterType)).toBe(
          filterType,
        );
      },
    );

    test("inversion is reversible for comparison filters", () => {
      const inverse: FilterType = CriteriaFilterUtil.getInverseFilterType(
        FilterType.GreaterThan,
      );

      expect(CriteriaFilterUtil.getInverseFilterType(inverse)).toBe(
        FilterType.GreaterThan,
      );
    });
  });

  describe("isEvaluateOverTimeFilter", () => {
    test.each([
      CheckOn.ResponseStatusCode,
      CheckOn.ResponseTime,
      CheckOn.PortDnsLookupTime,
      CheckOn.PortTcpConnectTime,
      CheckOn.CPUUsagePercent,
      CheckOn.MemoryUsagePercent,
      CheckOn.IsOnline,
      CheckOn.DnsResponseTime,
    ])("returns true for %s", (checkOn: CheckOn) => {
      expect(CriteriaFilterUtil.isEvaluateOverTimeFilter(checkOn)).toBe(true);
    });

    test.each([CheckOn.ResponseBody, CheckOn.ResponseHeader, CheckOn.Error])(
      "returns false for %s",
      (checkOn: CheckOn) => {
        expect(CriteriaFilterUtil.isEvaluateOverTimeFilter(checkOn)).toBe(
          false,
        );
      },
    );

    test.each([
      CheckOn.ResponseStatusCode,
      CheckOn.ResponseTime,
      CheckOn.PortDnsLookupTime,
      CheckOn.PortTcpConnectTime,
      CheckOn.DiskUsagePercent,
      CheckOn.CPUUsagePercent,
      CheckOn.MemoryUsagePercent,
      CheckOn.LoadAverage1Min,
      CheckOn.LoadAverage5Min,
      CheckOn.LoadAverage15Min,
      CheckOn.SwapUsagePercent,
      CheckOn.CPUIoWaitPercent,
      CheckOn.IsOnline,
      CheckOn.SnmpResponseTime,
      CheckOn.SnmpIsOnline,
      CheckOn.DnsResponseTime,
      CheckOn.DnsIsOnline,
      CheckOn.ExternalStatusPageResponseTime,
      CheckOn.ExternalStatusPageIsOnline,
    ])(
      "returns true for every evaluate-over-time checkOn %s",
      (checkOn: CheckOn) => {
        expect(CriteriaFilterUtil.isEvaluateOverTimeFilter(checkOn)).toBe(true);
      },
    );

    test.each([
      CheckOn.ResponseBody,
      CheckOn.IncomingRequest,
      CheckOn.MetricValue,
    ])(
      "returns false for non-evaluate-over-time checkOn %s",
      (checkOn: CheckOn) => {
        expect(CriteriaFilterUtil.isEvaluateOverTimeFilter(checkOn)).toBe(
          false,
        );
      },
    );
  });

  describe("getEvaluateOverTimeTypeByCriteriaFilter (non-IsOnline)", () => {
    test("returns the full 6-element aggregation set in order for a non-IsOnline checkOn", () => {
      const result: Array<EvaluateOverTimeType> =
        CriteriaFilterUtil.getEvaluateOverTimeTypeByCriteriaFilter({
          checkOn: CheckOn.CPUUsagePercent,
          filterType: FilterType.GreaterThan,
          value: 90,
        } as CriteriaFilter);

      expect(result).toEqual([
        EvaluateOverTimeType.Average,
        EvaluateOverTimeType.Sum,
        EvaluateOverTimeType.MaximumValue,
        EvaluateOverTimeType.MunimumValue,
        EvaluateOverTimeType.AllValues,
        EvaluateOverTimeType.AnyValue,
      ]);
    });
  });
});
