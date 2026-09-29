import MetricPipelineRuleFilterCondition, {
  MetricPipelineRuleFilterCheckOn,
  MetricPipelineRuleFilterConditionType,
  MetricPipelineRuleFilterConditionUtil,
} from "../../../Types/Metrics/MetricPipelineRuleFilterCondition";

describe("MetricPipelineRuleFilterConditionUtil", () => {
  describe("getCheckOnOptions", () => {
    test("returns metric name and attribute", () => {
      expect(MetricPipelineRuleFilterConditionUtil.getCheckOnOptions()).toEqual(
        [
          MetricPipelineRuleFilterCheckOn.MetricName,
          MetricPipelineRuleFilterCheckOn.Attribute,
        ],
      );
    });
  });

  describe("getConditionTypesByCheckOn", () => {
    test("metric name omits the presence/empty conditions", () => {
      const types: Array<MetricPipelineRuleFilterConditionType> =
        MetricPipelineRuleFilterConditionUtil.getConditionTypesByCheckOn(
          MetricPipelineRuleFilterCheckOn.MetricName,
        );

      expect(types).toContain(MetricPipelineRuleFilterConditionType.EqualTo);
      expect(types).toContain(
        MetricPipelineRuleFilterConditionType.MatchesRegex,
      );
      expect(types).not.toContain(
        MetricPipelineRuleFilterConditionType.IsPresent,
      );
      expect(types).not.toContain(
        MetricPipelineRuleFilterConditionType.IsEmpty,
      );
    });

    test("attribute includes the presence/empty conditions", () => {
      const types: Array<MetricPipelineRuleFilterConditionType> =
        MetricPipelineRuleFilterConditionUtil.getConditionTypesByCheckOn(
          MetricPipelineRuleFilterCheckOn.Attribute,
        );

      expect(types).toContain(MetricPipelineRuleFilterConditionType.IsPresent);
      expect(types).toContain(
        MetricPipelineRuleFilterConditionType.IsNotPresent,
      );
      expect(types).toContain(MetricPipelineRuleFilterConditionType.IsEmpty);
      expect(types).toContain(MetricPipelineRuleFilterConditionType.IsNotEmpty);
      expect(types).toContain(MetricPipelineRuleFilterConditionType.EqualTo);
    });

    test("returns an empty list for an unknown checkOn", () => {
      expect(
        MetricPipelineRuleFilterConditionUtil.getConditionTypesByCheckOn(
          "Unknown" as MetricPipelineRuleFilterCheckOn,
        ),
      ).toEqual([]);
    });
  });

  describe("hasAttributeKeyField", () => {
    test("is true only for Attribute", () => {
      expect(
        MetricPipelineRuleFilterConditionUtil.hasAttributeKeyField(
          MetricPipelineRuleFilterCheckOn.Attribute,
        ),
      ).toBe(true);
      expect(
        MetricPipelineRuleFilterConditionUtil.hasAttributeKeyField(
          MetricPipelineRuleFilterCheckOn.MetricName,
        ),
      ).toBe(false);
    });
  });

  describe("hasValueField", () => {
    test("returns false for undefined", () => {
      expect(
        MetricPipelineRuleFilterConditionUtil.hasValueField(undefined),
      ).toBe(false);
    });

    test.each([
      MetricPipelineRuleFilterConditionType.IsPresent,
      MetricPipelineRuleFilterConditionType.IsNotPresent,
      MetricPipelineRuleFilterConditionType.IsEmpty,
      MetricPipelineRuleFilterConditionType.IsNotEmpty,
    ])(
      "returns false for presence/empty condition %s",
      (conditionType: MetricPipelineRuleFilterConditionType) => {
        expect(
          MetricPipelineRuleFilterConditionUtil.hasValueField(conditionType),
        ).toBe(false);
      },
    );

    test.each([
      MetricPipelineRuleFilterConditionType.EqualTo,
      MetricPipelineRuleFilterConditionType.Contains,
      MetricPipelineRuleFilterConditionType.MatchesRegex,
    ])(
      "returns true for value-based condition %s",
      (conditionType: MetricPipelineRuleFilterConditionType) => {
        expect(
          MetricPipelineRuleFilterConditionUtil.hasValueField(conditionType),
        ).toBe(true);
      },
    );
  });

  describe("getValidationError", () => {
    test("returns null when filters are undefined or empty", () => {
      expect(
        MetricPipelineRuleFilterConditionUtil.getValidationError(undefined),
      ).toBeNull();
      expect(
        MetricPipelineRuleFilterConditionUtil.getValidationError([]),
      ).toBeNull();
    });

    test("requires a checkOn", () => {
      const error: string | null =
        MetricPipelineRuleFilterConditionUtil.getValidationError([
          {
            checkOn: undefined,
            conditionType: MetricPipelineRuleFilterConditionType.EqualTo,
            value: "x",
          } as unknown as MetricPipelineRuleFilterCondition,
        ]);

      expect(error).toBe("Filter #1: Filter type is required.");
    });

    test("requires a condition type", () => {
      const error: string | null =
        MetricPipelineRuleFilterConditionUtil.getValidationError([
          {
            checkOn: MetricPipelineRuleFilterCheckOn.MetricName,
            conditionType: undefined,
          },
        ]);

      expect(error).toBe("Filter #1: Condition is required.");
    });

    test("requires an attribute key when checkOn is Attribute", () => {
      const error: string | null =
        MetricPipelineRuleFilterConditionUtil.getValidationError([
          {
            checkOn: MetricPipelineRuleFilterCheckOn.Attribute,
            conditionType: MetricPipelineRuleFilterConditionType.IsPresent,
            attributeKey: "   ",
          },
        ]);

      expect(error).toBe("Filter #1: Attribute key is required.");
    });

    test("requires a value for value-based conditions", () => {
      const error: string | null =
        MetricPipelineRuleFilterConditionUtil.getValidationError([
          {
            checkOn: MetricPipelineRuleFilterCheckOn.MetricName,
            conditionType: MetricPipelineRuleFilterConditionType.EqualTo,
            value: "  ",
          },
        ]);

      expect(error).toBe("Filter #1: Value is required.");
    });

    test("reports the index of the offending filter", () => {
      const error: string | null =
        MetricPipelineRuleFilterConditionUtil.getValidationError([
          {
            checkOn: MetricPipelineRuleFilterCheckOn.MetricName,
            conditionType: MetricPipelineRuleFilterConditionType.EqualTo,
            value: "ok",
          },
          {
            checkOn: MetricPipelineRuleFilterCheckOn.MetricName,
            conditionType: undefined,
          },
        ]);

      expect(error).toBe("Filter #2: Condition is required.");
    });

    test("returns null for valid filters", () => {
      const error: string | null =
        MetricPipelineRuleFilterConditionUtil.getValidationError([
          {
            checkOn: MetricPipelineRuleFilterCheckOn.MetricName,
            conditionType: MetricPipelineRuleFilterConditionType.EqualTo,
            value: "http_requests_total",
          },
          {
            checkOn: MetricPipelineRuleFilterCheckOn.Attribute,
            conditionType: MetricPipelineRuleFilterConditionType.IsPresent,
            attributeKey: "host",
          },
        ]);

      expect(error).toBeNull();
    });
  });
});
