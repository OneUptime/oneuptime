import {
  CheckOn,
  CriteriaFilter,
  CriteriaFilterUtil,
  EvaluateOverTimeType,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";

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

    test("returns AllValues / AnyValue for IsOnline", () => {
      const result: Array<EvaluateOverTimeType> =
        CriteriaFilterUtil.getEvaluateOverTimeTypeByCriteriaFilter({
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.True,
          value: undefined,
        } as CriteriaFilter);

      expect(result).toEqual([
        EvaluateOverTimeType.AllValues,
        EvaluateOverTimeType.AnyValue,
      ]);
    });

    test("returns the full set of aggregation types for a numeric filter", () => {
      const result: Array<EvaluateOverTimeType> =
        CriteriaFilterUtil.getEvaluateOverTimeTypeByCriteriaFilter({
          checkOn: CheckOn.ResponseTime,
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
    });
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
