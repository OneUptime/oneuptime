import { describe, expect, test } from "@jest/globals";
import {
  buildMetricDropFilters,
  buildMetricScrubFilters,
  buildScrubPatternForDataType,
  canBeFoundByContext,
  CoveringScrubRule,
  doesScrubRuleCover,
  findCoveringScrubRule,
  getMetricDropUnavailableReason,
  getScrubPatternOfDataType,
  isFindingHiddenByTypePattern,
  isFindingScrubbed,
  isFoundByShapeAlone,
  MAX_SCRUB_PATTERN_LENGTH,
  METRIC_PATTERN_TYPE_OF_DATA_TYPE,
  readFoundByOf,
  ScrubCoverage,
  TelemetryFindingReference,
} from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubCoverage";
import { planScrubRuleCandidates } from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubPlanner";
import { DataSecurityDropMetricUnavailableReason } from "../../../../../Types/DataSecurity/DataSecurityApiTypes";
import {
  DATA_TYPE_CATALOG,
  DataTypeInfo,
} from "../../../../../Types/DataSecurity/DataTypeCatalog";
import { DataStoreKind } from "../../../../../Types/DataSecurity/DataStoreKind";
import { getScrubTarget } from "../../../../../Types/DataSecurity/TelemetryScrubTarget";
import LogScrubField from "../../../../../Types/Log/LogScrubField";
import LogScrubPatternType from "../../../../../Types/Log/LogScrubPatternType";
import MetricPipelineRuleFilterCondition, {
  MetricPipelineRuleFilterCheckOn,
  MetricPipelineRuleFilterConditionType,
} from "../../../../../Types/Metrics/MetricPipelineRuleFilterCondition";
import MetricPipelineRuleType from "../../../../../Types/Metrics/MetricPipelineRuleType";
import {
  checkScrubRuleCustomRegex,
  compileScrubRuleCustomRegex,
  DATA_TYPE_OF_SCRUB_PATTERN_TYPE,
  ScrubRegExp,
} from "../../../../../Types/Telemetry/ScrubRule";
import { SCRUB_RULE_NAMED_KEYS_PATTERN_TYPE } from "../../../../../Types/Telemetry/ScrubRuleKeys";
import { DataTypeDetector } from "../../../../../Utils/DataSecurity/Detector";
import { getBuiltInDetectorsOf } from "../../../../../Utils/DataSecurity/Detectors/Index";

/*
 * ---------------------------------------------------------------------------
 * A CUSTOM REGEX RULE OF A TYPE'S PATTERN COUNTS ONLY FOR WHAT ITS PATTERN
 * FINDS (#11502).
 *
 * The rule Scrub It makes for a type with no built-in pattern is made of
 * the type's detectors that need no context. Data Security also finds what
 * only the words around a value, or the key it is under, say: a US ZIP code
 * beside "zip", a lone coordinate under `location.lat`, nine digits beside
 * "ITIN", a "123" under `cvv` - and a street address the model read. A
 * finding now says how it was found, and the rule counts only for one its
 * pattern finds whole. The pattern itself holds every such detector of its
 * type: the Basic and Bearer Authorization headers' were too large to run
 * together, so Bearer tokens were left out of it.
 * ---------------------------------------------------------------------------
 */

const VALUE_TYPES: ReadonlyArray<DataTypeInfo> = DATA_TYPE_CATALOG.filter(
  (info: DataTypeInfo): boolean => {
    return info.foundBy === "value";
  },
);

// The types whose log and trace rules are built-in patterns, not Scrub It's Custom Regex.
const BUILT_IN_TYPES: ReadonlySet<string> = new Set<string>(
  Object.values(DATA_TYPE_OF_SCRUB_PATTERN_TYPE),
);

// The types a Custom Regex rule of Scrub It's is made for, that can be found by context.
const CONTEXT_PATTERN_TYPES: ReadonlyArray<string> = [
  "postal-address",
  "us-itin",
  "in-aadhaar",
  "card-verification-code",
  "card-expiration-date",
  "generic-secret",
  // Their rules are built-in now; the Custom Regex ones made before still exist.
  "postal-code",
  "geolocation",
];

function customRegexRule(
  dataTypeId: string,
  data: Partial<CoveringScrubRule> = {},
): CoveringScrubRule {
  return {
    id: `custom-${dataTypeId}`,
    name: `Data Security: ${dataTypeId}`,
    signal: "log",
    patternType: LogScrubPatternType.Custom,
    customRegex: buildScrubPatternForDataType(dataTypeId)!,
    fieldsToScrub: LogScrubField.Both,
    ...data,
  };
}

function logFinding(
  dataTypeId: string,
  data: Partial<TelemetryFindingReference> = {},
): TelemetryFindingReference {
  return {
    kind: DataStoreKind.TelemetryLogs,
    dataTypeId,
    location: "body",
    ...data,
  };
}

function covers(
  rule: CoveringScrubRule,
  finding: TelemetryFindingReference,
): boolean {
  return isFindingScrubbed({ rules: [rule] }, finding);
}

describe("the pattern Scrub It makes for a type holds every one of its detectors that need no context (#11502)", () => {
  test("for every type a Custom Regex rule is made for", () => {
    const notWhole: Array<string> = [];

    for (const info of VALUE_TYPES) {
      const made: { pattern: string | null; isWhole: boolean } =
        getScrubPatternOfDataType(info.id);

      if (made.pattern !== null && !made.isWhole) {
        notWhole.push(info.id);
      }
    }

    // Only types whose log and trace rules are built-in patterns: their own pattern hides what these leave.
    expect(
      notWhole.filter((dataTypeId: string): boolean => {
        return !BUILT_IN_TYPES.has(dataTypeId);
      }),
    ).toEqual([]);
    expect(notWhole.sort()).toEqual([
      "credit-card-number",
      "email-address",
      "ip-address",
    ]);
  });

  test("an Authorization header's pattern holds Basic and Bearer both, and runs as a rule's", () => {
    const pattern: string = buildScrubPatternForDataType(
      "authorization-header",
    )!;
    const regex: ScrubRegExp = compileScrubRuleCustomRegex(pattern)!;

    expect(getScrubPatternOfDataType("authorization-header").isWhole).toBe(
      true,
    );
    expect(pattern.length).toBeLessThanOrEqual(MAX_SCRUB_PATTERN_LENGTH);
    expect(checkScrubRuleCustomRegex(pattern)).toBeNull();
    expect(regex).not.toBeNull();

    const basic: string = `Authorization: Basic ${"YWxhZGRpbjpvcGVuc2VzYW1l"}`;
    const bearer: string = `authorization: Bearer ${"eyJhbGciOiJIUzI1NiJ9".repeat(2)}`;
    const token: string = `"authorization": "token ${"x".repeat(12)}${"9".repeat(12)}"`;

    for (const text of [basic, bearer, token]) {
      expect([text, regex.matchRanges(text).length]).toEqual([text, 1]);
      expect(
        regex.replace(text, (): string => {
          return "[REDACTED]";
        }),
      ).toContain("[REDACTED]");
    }

    // Each detector's own value is hidden whole: the pattern's counts were made open, never narrower.
    const longBearer: string = `Authorization: Bearer ${"a".repeat(4000)}`;
    const [[start, end]] = regex.matchRanges(longBearer) as [[number, number]];

    expect([start, end]).toEqual([0, longBearer.length]);
  });

  test("a type whose pieces run together keeps the pattern it always had", () => {
    for (const dataTypeId of [
      "bitcoin-address",
      "postal-code",
      "iban",
      "github-token",
      "geolocation",
    ]) {
      const pieces: Array<string> = getBuiltInDetectorsOf(dataTypeId)
        .filter((detector: DataTypeDetector): boolean => {
          return !detector.requiresContext;
        })
        .map((detector: DataTypeDetector): string => {
          return detector.pattern.source;
        });
      const pattern: string = buildScrubPatternForDataType(dataTypeId)!;

      expect([
        dataTypeId,
        getScrubPatternOfDataType(dataTypeId).isWhole,
      ]).toEqual([dataTypeId, true]);

      // Every piece as it is written, none relaxed.
      for (const piece of pieces) {
        expect([dataTypeId, pattern.includes(piece)]).toEqual([
          dataTypeId,
          true,
        ]);
      }
    }
  });

  test("no type has a pattern and none whole, and every pattern still runs as a rule's", () => {
    for (const info of VALUE_TYPES) {
      const made: { pattern: string | null; isWhole: boolean } =
        getScrubPatternOfDataType(info.id);

      if (made.pattern === null) {
        expect([info.id, made.isWhole]).toEqual([info.id, false]);
        continue;
      }

      expect([info.id, checkScrubRuleCustomRegex(made.pattern)]).toEqual([
        info.id,
        null,
      ]);
      expect(made.pattern.length).toBeLessThanOrEqual(MAX_SCRUB_PATTERN_LENGTH);
    }
  });

  test("is made once a type", () => {
    expect(getScrubPatternOfDataType("postal-code")).toBe(
      getScrubPatternOfDataType("postal-code"),
    );
  });
});

describe("which types can be found by what is around a value (#11502)", () => {
  test("a type with a detector that needs words, or a whole value's shape under its key", () => {
    for (const info of VALUE_TYPES) {
      const expected: boolean = getBuiltInDetectorsOf(info.id).some(
        (detector: DataTypeDetector): boolean => {
          return (
            Boolean(detector.requiresContext) ||
            detector.fieldValuePattern !== undefined
          );
        },
      );

      expect([info.id, canBeFoundByContext(info.id)]).toEqual([
        info.id,
        expected,
      ]);
    }
  });

  test("of the types Scrub It makes a Custom Regex rule for, exactly these", () => {
    const found: Array<string> = VALUE_TYPES.filter(
      (info: DataTypeInfo): boolean => {
        return (
          !BUILT_IN_TYPES.has(info.id) &&
          buildScrubPatternForDataType(info.id) !== null &&
          canBeFoundByContext(info.id)
        );
      },
    )
      .map((info: DataTypeInfo): string => {
        return info.id;
      })
      .sort();

    expect(found).toEqual(
      CONTEXT_PATTERN_TYPES.filter((dataTypeId: string): boolean => {
        return !BUILT_IN_TYPES.has(dataTypeId);
      }).sort(),
    );
  });

  test("a type with neither is never found so", () => {
    for (const dataTypeId of [
      "iban",
      "github-token",
      "mac-address",
      "br-cpf",
      "aws-access-key-id",
    ]) {
      expect([dataTypeId, canBeFoundByContext(dataTypeId)]).toEqual([
        dataTypeId,
        false,
      ]);
    }
  });
});

describe("a Custom Regex rule of a type's pattern covers only a finding its shapes found whole (#11502)", () => {
  test.each(
    CONTEXT_PATTERN_TYPES.map((dataTypeId: string): [string] => {
      return [dataTypeId];
    }),
  )(
    "%s: by its shapes alone, covered; by its words or key, the model, or not known, not",
    (dataTypeId: string) => {
      const rule: CoveringScrubRule = customRegexRule(dataTypeId);

      expect(
        covers(rule, logFinding(dataTypeId, { isFoundByContext: false })),
      ).toBe(true);
      expect(
        covers(rule, logFinding(dataTypeId, { isFoundByContext: true })),
      ).toBe(false);
      // A finding written before it was kept: not known.
      expect(
        covers(rule, logFinding(dataTypeId, { isFoundByContext: null })),
      ).toBe(false);
      expect(covers(rule, logFinding(dataTypeId))).toBe(false);
      expect(
        covers(
          rule,
          logFinding(dataTypeId, {
            isFoundByContext: false,
            isFoundByModel: true,
          }),
        ),
      ).toBe(false);
    },
  );

  test("a type never found by context: covered whatever the finding says of it, but not by the model", () => {
    for (const dataTypeId of ["iban", "github-token", "authorization-header"]) {
      const rule: CoveringScrubRule = customRegexRule(dataTypeId);

      for (const isFoundByContext of [true, false, null, undefined]) {
        expect([
          dataTypeId,
          isFoundByContext,
          covers(rule, logFinding(dataTypeId, { isFoundByContext })),
        ]).toEqual([dataTypeId, isFoundByContext, true]);
      }

      expect(
        covers(rule, logFinding(dataTypeId, { isFoundByModel: true })),
      ).toBe(false);
    }
  });

  test("a street address the model read is never covered by the street's pattern", () => {
    const rule: CoveringScrubRule = customRegexRule("postal-address");

    expect(
      covers(
        rule,
        logFinding("postal-address", {
          isFoundByContext: false,
          isFoundByModel: true,
        }),
      ),
    ).toBe(false);
    expect(
      covers(
        rule,
        logFinding("postal-address", {
          isFoundByContext: false,
          isFoundByModel: false,
        }),
      ),
    ).toBe(true);
  });

  test("another pattern, or the pattern of another type, never covers", () => {
    expect(
      covers(
        customRegexRule("us-itin", {
          customRegex: buildScrubPatternForDataType("iban")!,
        }),
        logFinding("us-itin", { isFoundByContext: false }),
      ),
    ).toBe(false);
    expect(
      covers(
        customRegexRule("us-itin", { customRegex: "[0-9]{9}" }),
        logFinding("us-itin", { isFoundByContext: false }),
      ),
    ).toBe(false);
  });

  test("the built-in Postal Code and Coordinates rules cover every finding of their types, however it was found", () => {
    for (const [patternType, dataTypeId] of [
      [LogScrubPatternType.PostalCode, "postal-code"],
      [LogScrubPatternType.Coordinates, "geolocation"],
    ] as Array<[string, string]>) {
      const rule: CoveringScrubRule = {
        id: patternType,
        name: patternType,
        signal: "log",
        patternType,
        fieldsToScrub: LogScrubField.Both,
      };

      for (const isFoundByContext of [true, false, null, undefined]) {
        expect([
          patternType,
          isFoundByContext,
          covers(rule, logFinding(dataTypeId, { isFoundByContext })),
          covers(
            rule,
            logFinding(dataTypeId, {
              isFoundByContext,
              location: "attributes.address.zip",
            }),
          ),
        ]).toEqual([patternType, isFoundByContext, true, true]);
      }

      // Its own type alone.
      expect(
        covers(rule, logFinding("iban", { isFoundByContext: false })),
      ).toBe(false);
    }
  });

  test("a rule proven on the finding's place, and a Named Attributes rule, cover whatever the finding says", () => {
    const proven: CoveringScrubRule = customRegexRule("us-itin", {
      provenPlaces: [
        {
          kind: DataStoreKind.TelemetryLogs,
          dataTypeId: "us-itin",
          location: "body",
        },
      ] as never,
    });
    const named: CoveringScrubRule = {
      id: "named",
      name: "named",
      signal: "log",
      patternType: SCRUB_RULE_NAMED_KEYS_PATTERN_TYPE,
      fieldsToScrub: LogScrubField.Attributes,
      attributeKeys: ["taxpayer.itin"],
    };

    expect(
      covers(proven, logFinding("us-itin", { isFoundByContext: true })),
    ).toBe(true);
    expect(
      covers(
        named,
        logFinding("us-itin", {
          isFoundByContext: true,
          location: "attributes.taxpayer.itin",
        }),
      ),
    ).toBe(true);
  });

  test("a trace rule reads the same", () => {
    const rule: CoveringScrubRule = customRegexRule("us-itin", {
      signal: "trace",
      fieldsToScrub: "all",
    });
    const span: TelemetryFindingReference = {
      kind: DataStoreKind.TelemetryTraces,
      dataTypeId: "us-itin",
      location: "attributes.taxpayer.note",
    };

    expect(covers(rule, { ...span, isFoundByContext: false })).toBe(true);
    expect(covers(rule, { ...span, isFoundByContext: true })).toBe(false);
  });
});

describe("isFindingHiddenByTypePattern and isFoundByShapeAlone (#11502)", () => {
  test("hidden only where the pattern is whole and the finding's shapes found it all", () => {
    expect(
      isFindingHiddenByTypePattern({
        dataTypeId: "us-itin",
        isFoundByContext: false,
      }),
    ).toBe(true);
    expect(
      isFindingHiddenByTypePattern({
        dataTypeId: "us-itin",
        isFoundByContext: true,
      }),
    ).toBe(false);
    // A card's pattern leaves out its grouped detectors: never whole.
    expect(
      isFindingHiddenByTypePattern({
        dataTypeId: "credit-card-number",
        isFoundByContext: false,
      }),
    ).toBe(false);
    // But a card found by its shapes alone is so, for a metric's name.
    expect(
      isFoundByShapeAlone({
        dataTypeId: "credit-card-number",
        isFoundByContext: false,
      }),
    ).toBe(true);
    // A type with no pattern at all.
    expect(
      isFindingHiddenByTypePattern({
        dataTypeId: "date-of-birth",
        isFoundByContext: false,
      }),
    ).toBe(false);
  });
});

describe("a metric rule Scrub It makes, and what counts for it (#11502)", () => {
  test("Postal Code and Coordinates findings get their pattern types, as phone numbers do", () => {
    expect(METRIC_PATTERN_TYPE_OF_DATA_TYPE.get("postal-code")).toBe(
      LogScrubPatternType.PostalCode,
    );
    expect(METRIC_PATTERN_TYPE_OF_DATA_TYPE.get("geolocation")).toBe(
      LogScrubPatternType.Coordinates,
    );

    for (const [dataTypeId, patternType] of [
      ["postal-code", LogScrubPatternType.PostalCode],
      ["geolocation", LogScrubPatternType.Coordinates],
    ]) {
      for (const isFoundByContext of [true, false, null, undefined]) {
        expect(
          buildMetricScrubFilters(dataTypeId!, "address.zip", {
            isFoundByContext,
          }),
        ).toEqual([
          {
            checkOn: MetricPipelineRuleFilterCheckOn.Attribute,
            attributeKey: "address.zip",
            conditionType:
              MetricPipelineRuleFilterConditionType.MatchesPatternType,
            value: patternType,
          },
        ]);
      }
    }
  });

  test("a type found by its words or key gets every value under the key redacted, its pattern only when its shapes found it all", () => {
    const regex: Array<MetricPipelineRuleFilterCondition> = [
      {
        checkOn: MetricPipelineRuleFilterCheckOn.Attribute,
        attributeKey: "taxpayer.itin",
        conditionType: MetricPipelineRuleFilterConditionType.MatchesRegex,
        value: buildScrubPatternForDataType("us-itin")!,
      },
    ];

    expect(
      buildMetricScrubFilters("us-itin", "taxpayer.itin", {
        isFoundByContext: false,
      }),
    ).toEqual(regex);

    for (const foundBy of [
      { isFoundByContext: true },
      { isFoundByContext: null },
      {},
      { isFoundByContext: false, isFoundByModel: true },
    ]) {
      expect(
        buildMetricScrubFilters("us-itin", "taxpayer.itin", foundBy),
      ).toEqual([]);
    }

    // A type no context finds keeps its pattern, whatever is said.
    expect(buildMetricScrubFilters("iban", "payout.iban")).toEqual([
      {
        checkOn: MetricPipelineRuleFilterCheckOn.Attribute,
        attributeKey: "payout.iban",
        conditionType: MetricPipelineRuleFilterConditionType.MatchesRegex,
        value: buildScrubPatternForDataType("iban"),
      },
    ]);
  });

  test("a rule of the type's pattern covers a finding of its shapes, and a rule of no filter every one", () => {
    const finding: (
      isFoundByContext: boolean | null | undefined,
    ) => TelemetryFindingReference = (
      isFoundByContext: boolean | null | undefined,
    ): TelemetryFindingReference => {
      return {
        kind: DataStoreKind.TelemetryMetrics,
        dataTypeId: "us-itin",
        location: "attributes.taxpayer.itin",
        serviceId: "0192f1a0-0000-7000-8000-0000000d5401",
        isFoundByContext,
      };
    };
    const withPattern: CoveringScrubRule = {
      id: "metric",
      name: "metric",
      signal: "metric",
      patternType: MetricPipelineRuleType.RedactAttribute,
      fieldsToScrub: "attributes",
      attributeKey: "taxpayer.itin",
      filters: buildMetricScrubFilters("us-itin", "taxpayer.itin", {
        isFoundByContext: false,
      }),
    };
    const everyValue: CoveringScrubRule = { ...withPattern, filters: [] };

    expect(covers(withPattern, finding(false))).toBe(true);
    expect(covers(withPattern, finding(true))).toBe(false);
    expect(covers(withPattern, finding(null))).toBe(false);

    for (const isFoundByContext of [true, false, null]) {
      expect(covers(everyValue, finding(isFoundByContext))).toBe(true);
    }
  });

  test("a metric rule of the frozen postal-code pattern no longer counts: Scrub It's filter is the pattern type", () => {
    const frozen: CoveringScrubRule = {
      id: "frozen",
      name: "frozen",
      signal: "metric",
      patternType: MetricPipelineRuleType.RedactAttribute,
      fieldsToScrub: "attributes",
      attributeKey: "address.zip",
      filters: [
        {
          checkOn: MetricPipelineRuleFilterCheckOn.Attribute,
          attributeKey: "address.zip",
          conditionType: MetricPipelineRuleFilterConditionType.MatchesRegex,
          value: buildScrubPatternForDataType("postal-code")!,
        },
      ],
    };
    const moved: CoveringScrubRule = {
      ...frozen,
      filters: buildMetricScrubFilters("postal-code", "address.zip"),
    };
    const finding: TelemetryFindingReference = {
      kind: DataStoreKind.TelemetryMetrics,
      dataTypeId: "postal-code",
      location: "attributes.address.zip",
      isFoundByContext: false,
    };

    expect(covers(frozen, finding)).toBe(false);
    expect(covers(moved, finding)).toBe(true);
    expect(covers(moved, { ...finding, isFoundByContext: true })).toBe(true);
  });
});

describe("Drop This Metric on a name found beside its words (#11502)", () => {
  const nameFinding: (
    dataTypeId: string,
    isFoundByContext: boolean | null | undefined,
  ) => TelemetryFindingReference & { serviceId: string } = (
    dataTypeId: string,
    isFoundByContext: boolean | null | undefined,
  ): TelemetryFindingReference & { serviceId: string } => {
    return {
      kind: DataStoreKind.TelemetryMetrics,
      dataTypeId,
      location: "name",
      serviceId: "0192f1a0-0000-7000-8000-0000000d5401",
      isFoundByContext,
    };
  };

  test("is no rule's when no pattern finds what the finding found", () => {
    expect(
      getMetricDropUnavailableReason(nameFinding("postal-code", true)),
    ).toBe(DataSecurityDropMetricUnavailableReason.NoPattern);
    expect(
      getMetricDropUnavailableReason(nameFinding("postal-code", null)),
    ).toBe(DataSecurityDropMetricUnavailableReason.NoPattern);
    expect(
      getMetricDropUnavailableReason(nameFinding("postal-code", false)),
    ).toBeNull();
    // A card, an email, an IP address found by their shapes: dropped as ever.
    for (const dataTypeId of [
      "credit-card-number",
      "email-address",
      "ip-address",
      "iban",
    ]) {
      expect([
        dataTypeId,
        getMetricDropUnavailableReason(nameFinding(dataTypeId, false)),
      ]).toEqual([dataTypeId, null]);
    }
  });

  test("a Drop rule of the name's pattern covers a finding its shapes found, and one of no filter every finding", () => {
    const dropOfPattern: CoveringScrubRule = {
      id: "drop",
      name: "drop",
      signal: "metric",
      patternType: MetricPipelineRuleType.Drop,
      fieldsToScrub: "name",
      filters: buildMetricDropFilters("postal-code")!,
    };
    const dropAll: CoveringScrubRule = { ...dropOfPattern, filters: [] };
    const coverage: ScrubCoverage = { rules: [dropOfPattern] };

    expect(
      findCoveringScrubRule(coverage, nameFinding("postal-code", false)),
    ).toBe(dropOfPattern);
    expect(
      findCoveringScrubRule(coverage, nameFinding("postal-code", true)),
    ).toBeNull();
    expect(
      findCoveringScrubRule(coverage, nameFinding("postal-code", null)),
    ).toBeNull();

    for (const isFoundByContext of [true, false, null]) {
      expect(
        covers(dropAll, nameFinding("postal-code", isFoundByContext)),
      ).toBe(true);
    }
  });
});

describe("a candidate's coverage, and how a finding's row is read (#11502)", () => {
  test("doesScrubRuleCover: the type's pattern for a finding of its shapes, the attribute's rule for any", () => {
    const target: ReturnType<typeof getScrubTarget> = getScrubTarget(
      DataStoreKind.TelemetryLogs,
      "attributes.taxpayer.itin",
    );
    const candidates: ReturnType<typeof planScrubRuleCandidates> =
      planScrubRuleCandidates({
        finding: {
          dataTypeId: "us-itin",
          location: "attributes.taxpayer.itin",
          target: target as never,
        },
      });
    const [typePattern, namedKeys] = candidates;
    const byShape: TelemetryFindingReference = {
      kind: DataStoreKind.TelemetryLogs,
      dataTypeId: "us-itin",
      location: "attributes.taxpayer.itin",
      isFoundByContext: false,
    };
    const byWords: TelemetryFindingReference = {
      ...byShape,
      isFoundByContext: true,
    };

    expect(typePattern!.patternType).toBe(LogScrubPatternType.Custom);
    expect(namedKeys!.patternType).toBe(SCRUB_RULE_NAMED_KEYS_PATTERN_TYPE);
    expect(doesScrubRuleCover(typePattern!, byShape)).toBe(true);
    expect(doesScrubRuleCover(typePattern!, byWords)).toBe(false);
    expect(doesScrubRuleCover(namedKeys!, byWords)).toBe(true);
    // The first candidate that covers a finding by its words is the attribute's rule.
    expect(
      candidates.find((candidate: (typeof candidates)[number]): boolean => {
        return doesScrubRuleCover(candidate, byWords);
      }),
    ).toBe(namedKeys);
  });

  test("Scrub It's first candidate for a postal code or a coordinate is its built-in pattern type", () => {
    for (const [dataTypeId, patternType] of [
      ["postal-code", LogScrubPatternType.PostalCode],
      ["geolocation", LogScrubPatternType.Coordinates],
    ] as Array<[string, string]>) {
      const target: ReturnType<typeof getScrubTarget> = getScrubTarget(
        DataStoreKind.TelemetryLogs,
        "body",
      );
      const [first] = planScrubRuleCandidates({
        finding: { dataTypeId, location: "body", target: target as never },
      });

      expect([dataTypeId, first!.patternType, first!.customRegex]).toEqual([
        dataTypeId,
        patternType,
        undefined,
      ]);
      // Personal data: masked, as its samples are.
      expect(first!.scrubAction).toBe("mask");
      expect(
        doesScrubRuleCover(first!, {
          kind: DataStoreKind.TelemetryLogs,
          dataTypeId,
          location: "body",
          isFoundByContext: true,
        }),
      ).toBe(true);
    }
  });

  test("readFoundByOf reads a row's booleans, and anything else as not known", () => {
    expect(
      readFoundByOf({ isFoundByContext: true, isFoundByModel: true }),
    ).toEqual({ isFoundByContext: true, isFoundByModel: true });
    expect(
      readFoundByOf({ isFoundByContext: false, isFoundByModel: false }),
    ).toEqual({ isFoundByContext: false, isFoundByModel: false });
    expect(readFoundByOf({ isFoundByContext: null })).toEqual({
      isFoundByContext: null,
      isFoundByModel: false,
    });
    expect(readFoundByOf({})).toEqual({
      isFoundByContext: null,
      isFoundByModel: false,
    });
    expect(
      readFoundByOf({
        isFoundByContext: "true" as never,
        isFoundByModel: 1 as never,
      }),
    ).toEqual({ isFoundByContext: null, isFoundByModel: false });
  });
});
