import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import RecordingRuleDefinition, {
  RecordingRuleDefinitionUtil,
  RecordingRuleSource,
  RECORDING_RULE_MAX_SOURCES,
  RECORDING_RULE_MAX_EXPRESSION_LENGTH,
} from "../../../Types/Metrics/RecordingRuleDefinition";

describe("RecordingRuleDefinitionUtil", () => {
  const makeSource: (
    overrides?: Partial<RecordingRuleSource>,
  ) => RecordingRuleSource = (
    overrides: Partial<RecordingRuleSource> = {},
  ): RecordingRuleSource => {
    return {
      alias: "A",
      metricName: "http.requests",
      aggregationType: AggregationType.Sum,
      ...overrides,
    };
  };

  describe("getAggregationOptions", () => {
    test("returns a value/label option for each supported aggregation", () => {
      const options: Array<{ value: AggregationType; label: string }> =
        RecordingRuleDefinitionUtil.getAggregationOptions();

      expect(options.length).toBeGreaterThan(0);
      for (const option of options) {
        expect(typeof option.label).toBe("string");
        expect(option.label.length).toBeGreaterThan(0);
        expect(Object.values(AggregationType)).toContain(option.value);
      }
    });
  });

  describe("getNextAlias", () => {
    test("returns A when there are no sources", () => {
      expect(RecordingRuleDefinitionUtil.getNextAlias(undefined)).toBe("A");
      expect(RecordingRuleDefinitionUtil.getNextAlias([])).toBe("A");
    });

    test("returns the first unused letter", () => {
      expect(
        RecordingRuleDefinitionUtil.getNextAlias([makeSource({ alias: "A" })]),
      ).toBe("B");
      expect(
        RecordingRuleDefinitionUtil.getNextAlias([
          makeSource({ alias: "A" }),
          makeSource({ alias: "B" }),
        ]),
      ).toBe("C");
    });

    test("skips gaps and returns the lowest free letter", () => {
      expect(
        RecordingRuleDefinitionUtil.getNextAlias([
          makeSource({ alias: "A" }),
          makeSource({ alias: "C" }),
        ]),
      ).toBe("B");
    });
  });

  describe("getEmptyDefinition", () => {
    test("returns a single source aliased A with expression A", () => {
      const def: RecordingRuleDefinition =
        RecordingRuleDefinitionUtil.getEmptyDefinition();

      expect(def.sources.length).toBe(1);
      expect(def.sources[0]!.alias).toBe("A");
      expect(def.expression).toBe("A");
    });

    test("is itself a valid definition once a metric name is provided", () => {
      const def: RecordingRuleDefinition =
        RecordingRuleDefinitionUtil.getEmptyDefinition();
      def.sources[0]!.metricName = "http.requests";

      expect(RecordingRuleDefinitionUtil.getValidationError(def)).toBeNull();
    });
  });

  describe("getValidationError", () => {
    const validDefinition: () => RecordingRuleDefinition =
      (): RecordingRuleDefinition => {
        return {
          sources: [makeSource({ alias: "A" }), makeSource({ alias: "B" })],
          expression: "A / B * 100",
        };
      };

    test("accepts a valid definition", () => {
      expect(
        RecordingRuleDefinitionUtil.getValidationError(validDefinition()),
      ).toBeNull();
    });

    test("requires a definition", () => {
      expect(RecordingRuleDefinitionUtil.getValidationError(undefined)).toBe(
        "Definition is required.",
      );
    });

    test("requires at least one source", () => {
      expect(
        RecordingRuleDefinitionUtil.getValidationError({
          sources: [],
          expression: "A",
        }),
      ).toBe("Add at least one source metric.");
    });

    test("rejects more than the maximum number of sources", () => {
      const sources: Array<RecordingRuleSource> = Array.from(
        { length: RECORDING_RULE_MAX_SOURCES + 1 },
        (_unused: unknown, i: number) => {
          return makeSource({ alias: "ABCDE"[i] as string });
        },
      );

      expect(
        RecordingRuleDefinitionUtil.getValidationError({
          sources,
          expression: "A",
        }),
      ).toContain(`at most ${RECORDING_RULE_MAX_SOURCES}`);
    });

    test("rejects an invalid alias", () => {
      expect(
        RecordingRuleDefinitionUtil.getValidationError({
          sources: [makeSource({ alias: "a" })],
          expression: "A",
        }),
      ).toContain("single uppercase letter");
    });

    test("rejects duplicate aliases", () => {
      expect(
        RecordingRuleDefinitionUtil.getValidationError({
          sources: [makeSource({ alias: "A" }), makeSource({ alias: "A" })],
          expression: "A",
        }),
      ).toContain("Duplicate alias");
    });

    test("requires a metric name", () => {
      expect(
        RecordingRuleDefinitionUtil.getValidationError({
          sources: [makeSource({ alias: "A", metricName: "  " })],
          expression: "A",
        }),
      ).toContain("Metric name is required");
    });

    test("requires both a filter key and value, or neither", () => {
      expect(
        RecordingRuleDefinitionUtil.getValidationError({
          sources: [makeSource({ alias: "A", filterAttributeKey: "env" })],
          expression: "A",
        }),
      ).toContain("needs both a key and a value");
    });

    test("requires an expression", () => {
      expect(
        RecordingRuleDefinitionUtil.getValidationError({
          sources: [makeSource({ alias: "A" })],
          expression: "   ",
        }),
      ).toBe("Expression is required.");
    });

    test("rejects an over-length expression", () => {
      expect(
        RecordingRuleDefinitionUtil.getValidationError({
          sources: [makeSource({ alias: "A" })],
          expression: "A".repeat(RECORDING_RULE_MAX_EXPRESSION_LENGTH + 1),
        }),
      ).toContain(
        `${RECORDING_RULE_MAX_EXPRESSION_LENGTH} characters or fewer`,
      );
    });

    test("rejects an expression referencing an undefined alias", () => {
      expect(
        RecordingRuleDefinitionUtil.getValidationError({
          sources: [makeSource({ alias: "A" })],
          expression: "A + B",
        }),
      ).toContain("references alias 'B'");
    });

    test("rejects an expression that references no alias", () => {
      expect(
        RecordingRuleDefinitionUtil.getValidationError({
          sources: [makeSource({ alias: "A" })],
          expression: "5 + 10",
        }),
      ).toContain("must reference at least one source alias");
    });

    test("rejects an expression with characters outside the DSL grammar", () => {
      expect(
        RecordingRuleDefinitionUtil.getValidationError({
          sources: [makeSource({ alias: "A" }), makeSource({ alias: "B" })],
          expression: "A & B",
        }),
      ).toContain("may only contain");
    });
  });
});
