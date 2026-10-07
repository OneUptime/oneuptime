import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import LogRecordingRuleDefinition, {
  LOG_RECORDING_RULE_AGGREGATION_TYPES,
  LOG_RECORDING_RULE_ATTRIBUTE_KEY_MAX_LENGTH,
  LOG_RECORDING_RULE_BODY_MAX_LENGTH,
  LOG_RECORDING_RULE_ID_ATTRIBUTE,
  LOG_RECORDING_RULE_MAX_ATTRIBUTE_FILTERS,
  LOG_RECORDING_RULE_MAX_GROUP_BY_ATTRIBUTES,
  LOG_RECORDING_RULE_MAX_TELEMETRY_SERVICES,
  LOG_RECORDING_RULE_RESERVED_ATTRIBUTE_PREFIX,
  LOG_RECORDING_RULE_UNIT_MAX_LENGTH,
  LogRecordingRuleAggregationOption,
  LogRecordingRuleDefinitionUtil,
} from "../../../Types/Log/LogRecordingRuleDefinition";
import LogSeverity from "../../../Types/Log/LogSeverity";
import { describe, expect, test } from "@jest/globals";

/*
 * A log recording rule's definition: which logs, what is computed from them
 * each minute, what it is split by and the output metric's unit. It arrives
 * as JSON - from the dashboard's editor, the API, MCP and Terraform - so the
 * util reads anything without throwing, says what is wrong in words the
 * editor shows, and normalizes what it accepts into what the worker runs.
 */

const SERVICE_A: string = "11111111-1111-4111-8111-111111111111";
const SERVICE_B: string = "22222222-2222-4222-8222-222222222222";

// The motivating rule: SD-WAN SLA latency per gateway and profile.
const sdwanLatency: () => LogRecordingRuleDefinition =
  (): LogRecordingRuleDefinition => {
    return {
      filter: {
        telemetryServiceIds: [SERVICE_A],
        severityTexts: [LogSeverity.Information],
        body: 'log_type="SD-WAN"',
        attributeFilters: [{ key: "log_component", value: "SLA" }],
      },
      aggregationType: AggregationType.Avg,
      valueAttribute: "latency",
      groupByAttributes: ["gw_name", "profile_name"],
      unit: "ms",
    };
  };

const errorOf: (definition: unknown) => string | null = (
  definition: unknown,
): string | null => {
  return LogRecordingRuleDefinitionUtil.getValidationError(definition);
};

describe("LogRecordingRuleDefinitionUtil.getEmptyDefinition", () => {
  test("counts every log, with no group by, and is valid as it stands", () => {
    const definition: LogRecordingRuleDefinition =
      LogRecordingRuleDefinitionUtil.getEmptyDefinition();

    expect(definition.aggregationType).toBe(AggregationType.Count);
    expect(definition.groupByAttributes).toEqual([]);
    expect(definition.filter).toEqual({
      telemetryServiceIds: [],
      severityTexts: [],
      body: "",
      attributeFilters: [],
    });
    expect(errorOf(definition)).toBeNull();
    expect(LogRecordingRuleDefinitionUtil.describe(definition)).toBe("count");
  });

  test("hands out a fresh object every time", () => {
    const first: LogRecordingRuleDefinition =
      LogRecordingRuleDefinitionUtil.getEmptyDefinition();
    first.groupByAttributes!.push("gw_name");

    expect(
      LogRecordingRuleDefinitionUtil.getEmptyDefinition().groupByAttributes,
    ).toEqual([]);
  });
});

describe("LogRecordingRuleDefinitionUtil.getAggregationOptions", () => {
  test("offers exactly the supported aggregations, Count first, each described", () => {
    const options: Array<LogRecordingRuleAggregationOption> =
      LogRecordingRuleDefinitionUtil.getAggregationOptions();

    expect(
      options.map((option: LogRecordingRuleAggregationOption) => {
        return option.value;
      }),
    ).toEqual([...LOG_RECORDING_RULE_AGGREGATION_TYPES]);
    expect(options[0]!.value).toBe(AggregationType.Count);

    for (const option of options) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.description.length).toBeGreaterThan(0);
    }
  });

  test("covers count, sum, avg, min, max and the p50 / p95 / p99 percentiles", () => {
    for (const type of [
      AggregationType.Count,
      AggregationType.Sum,
      AggregationType.Avg,
      AggregationType.Min,
      AggregationType.Max,
      AggregationType.P50,
      AggregationType.P95,
      AggregationType.P99,
    ]) {
      expect(LogRecordingRuleDefinitionUtil.isSupportedAggregation(type)).toBe(
        true,
      );
    }

    expect(LogRecordingRuleDefinitionUtil.isSupportedAggregation("Rate")).toBe(
      false,
    );
    expect(LogRecordingRuleDefinitionUtil.isSupportedAggregation(42)).toBe(
      false,
    );
  });

  test("only Count does without a numeric attribute", () => {
    for (const type of LOG_RECORDING_RULE_AGGREGATION_TYPES) {
      expect(LogRecordingRuleDefinitionUtil.needsValueAttribute(type)).toBe(
        type !== AggregationType.Count,
      );
    }
  });

  test("knows each percentile's level and that the rest have none", () => {
    expect(
      LogRecordingRuleDefinitionUtil.getPercentileLevel(AggregationType.P50),
    ).toBe(0.5);
    expect(
      LogRecordingRuleDefinitionUtil.getPercentileLevel(AggregationType.P95),
    ).toBe(0.95);
    expect(
      LogRecordingRuleDefinitionUtil.getPercentileLevel(AggregationType.P99),
    ).toBe(0.99);
    expect(
      LogRecordingRuleDefinitionUtil.getPercentileLevel(AggregationType.Avg),
    ).toBeNull();
    expect(
      LogRecordingRuleDefinitionUtil.getPercentileLevel(AggregationType.Count),
    ).toBeNull();
  });
});

describe("LogRecordingRuleDefinitionUtil.fromJSON", () => {
  test("reads an object as it is", () => {
    expect(LogRecordingRuleDefinitionUtil.fromJSON(sdwanLatency())).toEqual(
      sdwanLatency(),
    );
  });

  test("reads the JSON string a JSON form field stores", () => {
    expect(
      LogRecordingRuleDefinitionUtil.fromJSON(JSON.stringify(sdwanLatency())),
    ).toEqual(sdwanLatency());
  });

  test.each([
    ["undefined", undefined],
    ["null", null],
    ["a number", 42],
    ["an array", [1, 2]],
    ["unparseable JSON", "{not json"],
    ["a JSON string that is not an object", '"text"'],
  ])("is null for %s", (_label: string, raw: unknown) => {
    expect(LogRecordingRuleDefinitionUtil.fromJSON(raw)).toBeNull();
  });

  test("drops fields of the wrong type and keeps incomplete rows for validation to name", () => {
    const parsed: LogRecordingRuleDefinition | null =
      LogRecordingRuleDefinitionUtil.fromJSON({
        filter: {
          telemetryServiceIds: [
            SERVICE_A,
            7,
            { _type: "ObjectID", value: SERVICE_B },
          ],
          severityTexts: ["Error", 3],
          body: 12,
          attributeFilters: [
            { key: "env" },
            "nope",
            { key: "code", value: 500 },
          ],
        },
        aggregationType: AggregationType.Sum,
        valueAttribute: ["bytes"],
        groupByAttributes: ["host", 9],
        unit: { text: "ms" },
      });

    expect(parsed).toEqual({
      filter: {
        telemetryServiceIds: [SERVICE_A, SERVICE_B],
        severityTexts: ["Error"],
        attributeFilters: [
          { key: "env", value: "" },
          { key: "code", value: "500" },
        ],
      },
      aggregationType: AggregationType.Sum,
      groupByAttributes: ["host", ""],
    });
  });

  test("a definition with no filter at all reads as an empty filter", () => {
    expect(
      LogRecordingRuleDefinitionUtil.fromJSON({
        aggregationType: AggregationType.Count,
      }),
    ).toEqual({ filter: {}, aggregationType: AggregationType.Count });
  });
});

describe("LogRecordingRuleDefinitionUtil.getValidationError", () => {
  test("accepts the SD-WAN latency rule, as an object or as a JSON string", () => {
    expect(errorOf(sdwanLatency())).toBeNull();
    expect(errorOf(JSON.stringify(sdwanLatency()))).toBeNull();
  });

  test("accepts a count with no filter and no group by", () => {
    expect(
      errorOf({ filter: {}, aggregationType: AggregationType.Count }),
    ).toBeNull();
    expect(errorOf({ aggregationType: AggregationType.Count })).toBeNull();
  });

  test.each([
    ["undefined", undefined],
    ["null", null],
    ["an empty string", ""],
  ])("requires a definition (%s)", (_label: string, raw: unknown) => {
    expect(errorOf(raw)).toBe("Definition is required.");
  });

  test("says when the definition is not JSON at all", () => {
    expect(errorOf("{oops")).toBe("Definition is not valid JSON.");
    expect(errorOf(17)).toBe("Definition is not valid JSON.");
  });

  describe("the aggregation", () => {
    test("is required", () => {
      expect(errorOf({ filter: {} })).toBe("Choose an aggregation.");
    });

    test("must be one the worker can compute", () => {
      expect(errorOf({ aggregationType: "Rate" })).toMatch(
        /^Unknown aggregation "Rate"\. Choose one of: Count, Avg, Sum/,
      );
      expect(errorOf({ aggregationType: 3 })).toMatch(
        /^Unknown aggregation "3"/,
      );
    });

    test.each(
      LOG_RECORDING_RULE_AGGREGATION_TYPES.filter((type: AggregationType) => {
        return type !== AggregationType.Count;
      }),
    )("%s needs its numeric attribute", (type: AggregationType) => {
      expect(errorOf({ aggregationType: type })).toBe(
        "Choose the numeric attribute to aggregate (e.g. latency).",
      );
      expect(errorOf({ aggregationType: type, valueAttribute: "   " })).toBe(
        "Choose the numeric attribute to aggregate (e.g. latency).",
      );
      expect(
        errorOf({ aggregationType: type, valueAttribute: "latency" }),
      ).toBeNull();
    });

    test("Count ignores a numeric attribute it does not need", () => {
      expect(
        errorOf({
          aggregationType: AggregationType.Count,
          valueAttribute: "latency",
        }),
      ).toBeNull();
    });

    test("the numeric attribute must be an attribute key", () => {
      expect(
        errorOf({ aggregationType: AggregationType.Avg, valueAttribute: 5 }),
      ).toBe("The numeric attribute must be an attribute key.");
      expect(
        errorOf({
          aggregationType: AggregationType.Avg,
          valueAttribute: "latency'); DROP TABLE x; --",
        }),
      ).toBe(
        "The numeric attribute may only contain letters, digits and . _ : / - characters.",
      );
      expect(
        errorOf({
          aggregationType: AggregationType.Avg,
          valueAttribute: "a".repeat(
            LOG_RECORDING_RULE_ATTRIBUTE_KEY_MAX_LENGTH + 1,
          ),
        }),
      ).toBe(
        `The numeric attribute must be ${LOG_RECORDING_RULE_ATTRIBUTE_KEY_MAX_LENGTH} characters or fewer.`,
      );
    });

    test("keys with the characters the log explorer accepts are fine", () => {
      for (const key of [
        "latency",
        "sophos.latency",
        "kv_latency",
        "http.response.time_ms",
        "k8s:pod/name-1",
      ]) {
        expect(
          errorOf({
            aggregationType: AggregationType.P95,
            valueAttribute: key,
          }),
        ).toBeNull();
      }
    });
  });

  describe("group by", () => {
    test(`takes up to ${LOG_RECORDING_RULE_MAX_GROUP_BY_ATTRIBUTES} attribute keys`, () => {
      const keys: Array<string> = Array.from(
        { length: LOG_RECORDING_RULE_MAX_GROUP_BY_ATTRIBUTES },
        (_value: unknown, index: number): string => {
          return `key_${index}`;
        },
      );

      expect(
        errorOf({
          aggregationType: AggregationType.Count,
          groupByAttributes: keys,
        }),
      ).toBeNull();
      expect(
        errorOf({
          aggregationType: AggregationType.Count,
          groupByAttributes: [...keys, "one_more"],
        }),
      ).toBe(
        `A rule can group by at most ${LOG_RECORDING_RULE_MAX_GROUP_BY_ATTRIBUTES} attributes.`,
      );
    });

    test("must be a list of keys", () => {
      expect(
        errorOf({
          aggregationType: AggregationType.Count,
          groupByAttributes: "gw_name",
        }),
      ).toBe("Group by must be a list of attribute keys.");
      expect(
        errorOf({
          aggregationType: AggregationType.Count,
          groupByAttributes: ["gw_name", 4],
        }),
      ).toBe("Group by attribute #2 must be an attribute key.");
    });

    test("ignores a row left blank, which saving drops", () => {
      expect(
        errorOf({
          aggregationType: AggregationType.Count,
          groupByAttributes: ["gw_name", "  ", ""],
        }),
      ).toBeNull();

      // Blank rows do not count toward the cap either.
      expect(
        errorOf({
          aggregationType: AggregationType.Count,
          groupByAttributes: ["a", "b", "", "c", "d", "e"],
        }),
      ).toBeNull();
    });

    test("refuses an invalid key, a repeated key and the reserved namespace", () => {
      expect(
        errorOf({
          aggregationType: AggregationType.Count,
          groupByAttributes: ["gw name"],
        }),
      ).toBe(
        'Group by attribute "gw name" may only contain letters, digits and . _ : / - characters.',
      );
      expect(
        errorOf({
          aggregationType: AggregationType.Count,
          groupByAttributes: ["gw_name", " gw_name "],
        }),
      ).toBe('Group by attribute "gw_name" is listed twice.');
      expect(
        errorOf({
          aggregationType: AggregationType.Count,
          groupByAttributes: [LOG_RECORDING_RULE_ID_ATTRIBUTE],
        }),
      ).toBe(
        `Group by attribute "${LOG_RECORDING_RULE_ID_ATTRIBUTE}" is in the reserved ${LOG_RECORDING_RULE_RESERVED_ATTRIBUTE_PREFIX} namespace, which OneUptime writes on derived metrics.`,
      );
      expect(
        errorOf({
          aggregationType: AggregationType.Count,
          groupByAttributes: ["OneUptime.Derived.anything"],
        }),
      ).toMatch(/reserved oneuptime\.derived\. namespace/);
    });

    test("keys differing only in case are two group-by keys", () => {
      expect(
        errorOf({
          aggregationType: AggregationType.Count,
          groupByAttributes: ["gw_name", "GW_NAME"],
        }),
      ).toBeNull();
    });
  });

  describe("the log filter", () => {
    const withFilter: (filter: unknown) => unknown = (
      filter: unknown,
    ): unknown => {
      return { aggregationType: AggregationType.Count, filter };
    };

    test("must be an object when given", () => {
      expect(errorOf(withFilter("everything"))).toBe(
        "The log filter is not valid.",
      );
      expect(errorOf(withFilter([]))).toBe("The log filter is not valid.");
      expect(errorOf(withFilter(null))).toBeNull();
    });

    test("telemetry services are service ids", () => {
      expect(
        errorOf(withFilter({ telemetryServiceIds: [SERVICE_A, SERVICE_B] })),
      ).toBeNull();
      expect(
        errorOf(
          withFilter({
            telemetryServiceIds: [{ _type: "ObjectID", value: SERVICE_A }],
          }),
        ),
      ).toBeNull();
      expect(errorOf(withFilter({ telemetryServiceIds: SERVICE_A }))).toBe(
        "Telemetry services must be a list of service ids.",
      );
      expect(errorOf(withFilter({ telemetryServiceIds: ["checkout"] }))).toBe(
        '"checkout" is not a telemetry service id.',
      );
      expect(errorOf(withFilter({ telemetryServiceIds: [12] }))).toBe(
        '"12" is not a telemetry service id.',
      );
      expect(
        errorOf(
          withFilter({
            telemetryServiceIds: Array.from(
              { length: LOG_RECORDING_RULE_MAX_TELEMETRY_SERVICES + 1 },
              (): string => {
                return SERVICE_A;
              },
            ),
          }),
        ),
      ).toBe(
        `A rule can be limited to at most ${LOG_RECORDING_RULE_MAX_TELEMETRY_SERVICES} telemetry services.`,
      );
    });

    test("severities are the ones log rows store", () => {
      expect(
        errorOf(
          withFilter({
            severityTexts: [LogSeverity.Error, LogSeverity.Fatal],
          }),
        ),
      ).toBeNull();
      expect(errorOf(withFilter({ severityTexts: "Error" }))).toBe(
        "Severities must be a list.",
      );
      expect(errorOf(withFilter({ severityTexts: ["ERROR"] }))).toMatch(
        /^"ERROR" is not a log severity\. Use one of: Unspecified, Information/,
      );
    });

    test("the body filter is text of bounded length", () => {
      expect(errorOf(withFilter({ body: 'log_type="SD-WAN"' }))).toBeNull();
      expect(errorOf(withFilter({ body: 5 }))).toBe(
        "The body filter must be text.",
      );
      expect(
        errorOf(
          withFilter({
            body: "x".repeat(LOG_RECORDING_RULE_BODY_MAX_LENGTH + 1),
          }),
        ),
      ).toBe(
        `The body filter must be ${LOG_RECORDING_RULE_BODY_MAX_LENGTH} characters or fewer.`,
      );
    });

    test("attribute filters need a key and a value each", () => {
      expect(
        errorOf(
          withFilter({
            attributeFilters: [
              { key: "log_component", value: "SLA" },
              { key: "status_code", value: 503 },
            ],
          }),
        ),
      ).toBeNull();
      expect(errorOf(withFilter({ attributeFilters: { key: "a" } }))).toBe(
        "Attribute filters must be a list.",
      );
      expect(errorOf(withFilter({ attributeFilters: ["a=b"] }))).toBe(
        "Attribute filter #1 is not valid.",
      );
      expect(
        errorOf(withFilter({ attributeFilters: [{ key: "a", value: true }] })),
      ).toBe("Attribute filter #1 needs a key and a value.");
      expect(
        errorOf(withFilter({ attributeFilters: [{ key: "env", value: " " }] })),
      ).toBe(
        "Each attribute filter needs both a key and a value (or remove the row).",
      );
      expect(
        errorOf(withFilter({ attributeFilters: [{ key: "", value: "prod" }] })),
      ).toBe(
        "Each attribute filter needs both a key and a value (or remove the row).",
      );
    });

    test("a row left blank filters nothing and is no error", () => {
      expect(
        errorOf(
          withFilter({
            attributeFilters: [
              { key: "log_component", value: "SLA" },
              { key: " ", value: "" },
            ],
          }),
        ),
      ).toBeNull();
    });

    test("attribute filter keys are checked like every other key, and named once", () => {
      expect(
        errorOf(
          withFilter({ attributeFilters: [{ key: "bad key", value: "x" }] }),
        ),
      ).toBe(
        'Attribute filter "bad key" may only contain letters, digits and . _ : / - characters.',
      );
      expect(
        errorOf(
          withFilter({
            attributeFilters: [
              { key: "env", value: "prod" },
              { key: "ENV", value: "staging" },
            ],
          }),
        ),
      ).toBe(
        'Attribute filter "ENV" is listed twice. A log carries one value per attribute.',
      );
      expect(
        errorOf(
          withFilter({
            attributeFilters: Array.from(
              { length: LOG_RECORDING_RULE_MAX_ATTRIBUTE_FILTERS + 1 },
              (_value: unknown, index: number) => {
                return { key: `k${index}`, value: "v" };
              },
            ),
          }),
        ),
      ).toBe(
        `A rule can have at most ${LOG_RECORDING_RULE_MAX_ATTRIBUTE_FILTERS} attribute filters.`,
      );
    });

    test("attribute filter values may hold anything a log value can, quotes included", () => {
      expect(
        errorOf(
          withFilter({
            attributeFilters: [{ key: "msg", value: 'it\'s "quoted" \\ %_' }],
          }),
        ),
      ).toBeNull();
    });
  });

  describe("the unit", () => {
    test("is optional text of bounded length", () => {
      expect(
        errorOf({ aggregationType: AggregationType.Count, unit: "ms" }),
      ).toBeNull();
      expect(errorOf({ aggregationType: AggregationType.Count, unit: 5 })).toBe(
        "The unit must be text (e.g. ms).",
      );
      expect(
        errorOf({
          aggregationType: AggregationType.Count,
          unit: "u".repeat(LOG_RECORDING_RULE_UNIT_MAX_LENGTH + 1),
        }),
      ).toBe(
        `The unit must be ${LOG_RECORDING_RULE_UNIT_MAX_LENGTH} characters or fewer.`,
      );
    });
  });
});

describe("LogRecordingRuleDefinitionUtil.normalize", () => {
  test("trims text, lower-cases service ids and drops empty and repeated entries", () => {
    const normalized: LogRecordingRuleDefinition =
      LogRecordingRuleDefinitionUtil.normalize({
        filter: {
          telemetryServiceIds: [
            ` ${SERVICE_A.toUpperCase()} `,
            SERVICE_A,
            "",
            SERVICE_B,
          ],
          severityTexts: [
            LogSeverity.Error,
            LogSeverity.Error,
            "nonsense" as LogSeverity,
          ],
          body: "  timeout  ",
          attributeFilters: [
            { key: " env ", value: " prod " },
            { key: "ENV", value: "staging" },
            { key: "", value: "orphan" },
            { key: "region", value: "" },
          ],
        },
        aggregationType: AggregationType.Avg,
        valueAttribute: " latency ",
        groupByAttributes: [" gw_name ", "gw_name", "", "profile_name"],
        unit: "  ms ",
      });

    expect(normalized).toEqual({
      filter: {
        telemetryServiceIds: [SERVICE_A, SERVICE_B],
        severityTexts: [LogSeverity.Error],
        body: "timeout",
        attributeFilters: [{ key: "env", value: "prod" }],
      },
      aggregationType: AggregationType.Avg,
      valueAttribute: "latency",
      groupByAttributes: ["gw_name", "profile_name"],
      unit: "ms",
    });
  });

  test("leaves the numeric attribute out of a Count", () => {
    const normalized: LogRecordingRuleDefinition =
      LogRecordingRuleDefinitionUtil.normalize({
        filter: {},
        aggregationType: AggregationType.Count,
        valueAttribute: "latency",
      });

    expect(normalized.valueAttribute).toBeUndefined();
    expect(normalized).toEqual({
      filter: {
        telemetryServiceIds: [],
        severityTexts: [],
        body: "",
        attributeFilters: [],
      },
      aggregationType: AggregationType.Count,
      groupByAttributes: [],
      unit: "",
    });
  });

  test("a normalized definition is still valid and normalizes to itself", () => {
    const once: LogRecordingRuleDefinition =
      LogRecordingRuleDefinitionUtil.normalize(sdwanLatency());

    expect(errorOf(once)).toBeNull();
    expect(LogRecordingRuleDefinitionUtil.normalize(once)).toEqual(once);
    expect(once).toEqual(sdwanLatency());
  });
});

describe("LogRecordingRuleDefinitionUtil.describe", () => {
  test.each([
    [{ aggregationType: AggregationType.Count }, "count"],
    [
      {
        aggregationType: AggregationType.Count,
        groupByAttributes: ["gw_name"],
      },
      "count by gw_name",
    ],
    [
      { aggregationType: AggregationType.Avg, valueAttribute: "latency" },
      "avg(latency)",
    ],
    [
      {
        aggregationType: AggregationType.P95,
        valueAttribute: "latency",
        groupByAttributes: ["gw_name", " ", "profile_name"],
      },
      "p95(latency) by gw_name, profile_name",
    ],
    [{ aggregationType: AggregationType.Max }, "max(?)"],
  ])(
    "%j reads %p",
    (partial: Partial<LogRecordingRuleDefinition>, text: string) => {
      expect(
        LogRecordingRuleDefinitionUtil.describe({
          filter: {},
          ...partial,
        } as LogRecordingRuleDefinition),
      ).toBe(text);
    },
  );
});
