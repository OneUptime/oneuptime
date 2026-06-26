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
  });
});
