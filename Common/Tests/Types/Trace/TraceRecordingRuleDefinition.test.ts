import TraceAggregationType from "../../../Types/Trace/TraceAggregationType";
import TraceRecordingRuleDefinition, {
  TraceRecordingRuleDefinitionUtil,
  TraceRecordingRuleSource,
  TraceRecordingRuleAttributeFilter,
  TRACE_RECORDING_RULE_MAX_SOURCES,
  TRACE_RECORDING_RULE_MAX_EXPRESSION_LENGTH,
} from "../../../Types/Trace/TraceRecordingRuleDefinition";

describe("TraceRecordingRuleDefinitionUtil", () => {
  const makeSource: (
    overrides?: Partial<TraceRecordingRuleSource>,
  ) => TraceRecordingRuleSource = (
    overrides: Partial<TraceRecordingRuleSource> = {},
  ): TraceRecordingRuleSource => {
    return {
      alias: "A",
      aggregationType: TraceAggregationType.Count,
      ...overrides,
    };
  };

  describe("getAggregationOptions", () => {
    test("every option has a valid value, label and description", () => {
      const options: Array<{
        value: TraceAggregationType;
        label: string;
        description: string;
      }> = TraceRecordingRuleDefinitionUtil.getAggregationOptions();

      expect(options.length).toBeGreaterThan(0);
      for (const option of options) {
        expect(option.label.length).toBeGreaterThan(0);
        expect(option.description.length).toBeGreaterThan(0);
        expect(Object.values(TraceAggregationType)).toContain(option.value);
      }
    });
  });

  describe("getSpanKindOptions", () => {
    test("includes an 'Any' option with an empty value", () => {
      const options: Array<{ value: string; label: string }> =
        TraceRecordingRuleDefinitionUtil.getSpanKindOptions();

      expect(
        options.some((o: { value: string }): boolean => {
          return o.value === "";
        }),
      ).toBe(true);
      expect(
        options.some((o: { value: string }): boolean => {
          return o.value === "SPAN_KIND_SERVER";
        }),
      ).toBe(true);
    });
  });

  describe("getSourceAttributeFilters", () => {
    test("returns the multi-filter entries, trimmed", () => {
      const filters: Array<TraceRecordingRuleAttributeFilter> =
        TraceRecordingRuleDefinitionUtil.getSourceAttributeFilters(
          makeSource({
            filterAttributes: [{ key: " http.route ", value: " /api " }],
          }),
        );

      expect(filters).toEqual([{ key: "http.route", value: "/api" }]);
    });

    test("drops entries with a missing key or value, and deduplicates by key", () => {
      const filters: Array<TraceRecordingRuleAttributeFilter> =
        TraceRecordingRuleDefinitionUtil.getSourceAttributeFilters(
          makeSource({
            filterAttributes: [
              { key: "host", value: "a" },
              { key: "host", value: "b" }, // duplicate key — dropped
              { key: "empty", value: "" }, // no value — dropped
            ],
          }),
        );

      expect(filters).toEqual([{ key: "host", value: "a" }]);
    });

    test("merges the legacy single filter when its key is not already present", () => {
      const filters: Array<TraceRecordingRuleAttributeFilter> =
        TraceRecordingRuleDefinitionUtil.getSourceAttributeFilters(
          makeSource({
            filterAttributes: [{ key: "host", value: "a" }],
            filterAttributeKey: "env",
            filterAttributeValue: "prod",
          }),
        );

      expect(filters).toEqual([
        { key: "host", value: "a" },
        { key: "env", value: "prod" },
      ]);
    });

    test("array entry wins over the legacy filter for the same key", () => {
      const filters: Array<TraceRecordingRuleAttributeFilter> =
        TraceRecordingRuleDefinitionUtil.getSourceAttributeFilters(
          makeSource({
            filterAttributes: [{ key: "env", value: "staging" }],
            filterAttributeKey: "env",
            filterAttributeValue: "prod",
          }),
        );

      expect(filters).toEqual([{ key: "env", value: "staging" }]);
    });
  });

  describe("getNextAlias", () => {
    test("returns A when empty and the first free letter otherwise", () => {
      expect(TraceRecordingRuleDefinitionUtil.getNextAlias(undefined)).toBe(
        "A",
      );
      expect(
        TraceRecordingRuleDefinitionUtil.getNextAlias([
          makeSource({ alias: "A" }),
          makeSource({ alias: "C" }),
        ]),
      ).toBe("B");
    });
  });

  describe("getEmptyDefinition", () => {
    test("returns a single Count source aliased A that validates", () => {
      const def: TraceRecordingRuleDefinition =
        TraceRecordingRuleDefinitionUtil.getEmptyDefinition();

      expect(def.sources.length).toBe(1);
      expect(def.sources[0]!.alias).toBe("A");
      expect(def.sources[0]!.aggregationType).toBe(TraceAggregationType.Count);
      expect(def.expression).toBe("A");
      expect(
        TraceRecordingRuleDefinitionUtil.getValidationError(def),
      ).toBeNull();
    });
  });

  describe("getValidationError", () => {
    const validDefinition: () => TraceRecordingRuleDefinition =
      (): TraceRecordingRuleDefinition => {
        return {
          sources: [makeSource({ alias: "A" }), makeSource({ alias: "B" })],
          expression: "A / B * 100",
        };
      };

    test("accepts a valid definition", () => {
      expect(
        TraceRecordingRuleDefinitionUtil.getValidationError(validDefinition()),
      ).toBeNull();
    });

    test("requires a definition", () => {
      expect(
        TraceRecordingRuleDefinitionUtil.getValidationError(undefined),
      ).toBe("Definition is required.");
    });

    test("requires at least one source", () => {
      expect(
        TraceRecordingRuleDefinitionUtil.getValidationError({
          sources: [],
          expression: "A",
        }),
      ).toBe("Add at least one source.");
    });

    test("rejects more than the maximum number of sources", () => {
      const sources: Array<TraceRecordingRuleSource> = Array.from(
        { length: TRACE_RECORDING_RULE_MAX_SOURCES + 1 },
        (_unused: unknown, i: number) => {
          return makeSource({ alias: "ABCDE"[i] as string });
        },
      );

      expect(
        TraceRecordingRuleDefinitionUtil.getValidationError({
          sources,
          expression: "A",
        }),
      ).toContain(`at most ${TRACE_RECORDING_RULE_MAX_SOURCES}`);
    });

    test("rejects an invalid alias", () => {
      expect(
        TraceRecordingRuleDefinitionUtil.getValidationError({
          sources: [makeSource({ alias: "1" })],
          expression: "A",
        }),
      ).toContain("single uppercase letter");
    });

    test("rejects duplicate aliases", () => {
      expect(
        TraceRecordingRuleDefinitionUtil.getValidationError({
          sources: [makeSource({ alias: "A" }), makeSource({ alias: "A" })],
          expression: "A",
        }),
      ).toContain("Duplicate alias");
    });

    test("requires an aggregation type", () => {
      expect(
        TraceRecordingRuleDefinitionUtil.getValidationError({
          sources: [
            {
              alias: "A",
            } as unknown as TraceRecordingRuleSource,
          ],
          expression: "A",
        }),
      ).toContain("Aggregation type is required");
    });

    test("requires both a legacy filter key and value, or neither", () => {
      expect(
        TraceRecordingRuleDefinitionUtil.getValidationError({
          sources: [makeSource({ alias: "A", filterAttributeValue: "prod" })],
          expression: "A",
        }),
      ).toContain("needs both a key and a value");
    });

    test("rejects a non-array filterAttributes", () => {
      expect(
        TraceRecordingRuleDefinitionUtil.getValidationError({
          sources: [
            makeSource({
              alias: "A",
              filterAttributes:
                "nope" as unknown as Array<TraceRecordingRuleAttributeFilter>,
            }),
          ],
          expression: "A",
        }),
      ).toContain("Invalid attribute filters");
    });

    test("rejects a half-specified filter row", () => {
      expect(
        TraceRecordingRuleDefinitionUtil.getValidationError({
          sources: [
            makeSource({
              alias: "A",
              filterAttributes: [{ key: "host", value: "" }],
            }),
          ],
          expression: "A",
        }),
      ).toContain("remove the row");
    });

    test("requires an expression", () => {
      expect(
        TraceRecordingRuleDefinitionUtil.getValidationError({
          sources: [makeSource({ alias: "A" })],
          expression: "   ",
        }),
      ).toBe("Expression is required.");
    });

    test("rejects an over-length expression", () => {
      expect(
        TraceRecordingRuleDefinitionUtil.getValidationError({
          sources: [makeSource({ alias: "A" })],
          expression: "A".repeat(
            TRACE_RECORDING_RULE_MAX_EXPRESSION_LENGTH + 1,
          ),
        }),
      ).toContain(
        `${TRACE_RECORDING_RULE_MAX_EXPRESSION_LENGTH} characters or fewer`,
      );
    });

    test("rejects an expression referencing an undefined alias", () => {
      expect(
        TraceRecordingRuleDefinitionUtil.getValidationError({
          sources: [makeSource({ alias: "A" })],
          expression: "A + B",
        }),
      ).toContain("references alias 'B'");
    });

    test("rejects an expression that references no alias", () => {
      expect(
        TraceRecordingRuleDefinitionUtil.getValidationError({
          sources: [makeSource({ alias: "A" })],
          expression: "5 + 10",
        }),
      ).toContain("must reference at least one source alias");
    });

    test("rejects an expression with characters outside the DSL grammar", () => {
      expect(
        TraceRecordingRuleDefinitionUtil.getValidationError({
          sources: [makeSource({ alias: "A" }), makeSource({ alias: "B" })],
          expression: "A & B",
        }),
      ).toContain("may only contain");
    });
  });
});
