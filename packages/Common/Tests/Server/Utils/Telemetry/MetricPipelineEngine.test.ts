import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import MetricPipelineRule from "../../../../Models/DatabaseModels/MetricPipelineRule";
import logger from "../../../../Server/Utils/Logger";
import MetricPipelineEngine, {
  MutableMetricRow,
} from "../../../../Server/Utils/Telemetry/MetricPipelineEngine";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../../Types/JSON";
import MetricPipelineRuleFilterCondition, {
  MetricPipelineRuleFilterCheckOn,
  MetricPipelineRuleFilterConditionType,
} from "../../../../Types/Metrics/MetricPipelineRuleFilterCondition";
import MetricPipelineRuleType from "../../../../Types/Metrics/MetricPipelineRuleType";
import ObjectID from "../../../../Types/ObjectID";
import { clearLinearRegExpCache } from "../../../../Utils/LinearRegExp/PatternCache";

/*
 * THE ONE ENGINE FOR METRICS (#10753).
 *
 * Ingest (App's MetricPipelineRuleService, which loads and caches each
 * project's rules) and Data Security's proof of a metric attribute's rule
 * (DataSecurity/Telemetry/TelemetryScrubProof) both run a project's metric
 * pipeline rules here, so a rule proven on a finding's data points is the
 * rule ingest runs. App's MetricPipelineRegexCompile and
 * DataSecurityMetricScrubRuleIngest suites run it through ingest; this runs
 * it as the proof does - directly, with the rules handed in - and pins
 * what each rule type does, how filters combine, and the order rules run
 * in.
 */

function ruleOf(
  ruleType: MetricPipelineRuleType,
  more: Partial<MetricPipelineRule> = {},
): MetricPipelineRule {
  const rule: MetricPipelineRule = new MetricPipelineRule();

  rule.id = ObjectID.generate();
  rule.ruleType = ruleType;
  rule.filters = [];
  Object.assign(rule, more);

  return rule;
}

function attributeIs(
  attributeKey: string,
  conditionType: MetricPipelineRuleFilterConditionType,
  value?: string,
): MetricPipelineRuleFilterCondition {
  return {
    checkOn: MetricPipelineRuleFilterCheckOn.Attribute,
    attributeKey,
    conditionType,
    ...(value === undefined ? {} : { value }),
  };
}

function nameIs(
  conditionType: MetricPipelineRuleFilterConditionType,
  value: string,
): MetricPipelineRuleFilterCondition {
  return {
    checkOn: MetricPipelineRuleFilterCheckOn.MetricName,
    conditionType,
    value,
  };
}

function rowOf(
  attributes: JSONObject = { region: "eu", user: "jane.doe@acmecorp.io" },
  name: string = "http.server.requests",
): MutableMetricRow {
  return {
    name,
    attributes: { ...attributes },
    attributeKeys: Object.keys(attributes).sort(),
  };
}

function run(
  row: MutableMetricRow,
  serviceRules: Array<MetricPipelineRule>,
  projectRules: Array<MetricPipelineRule> = [],
): MutableMetricRow | null {
  return MetricPipelineEngine.applyRules(row, serviceRules, projectRules);
}

beforeEach(() => {
  MetricPipelineEngine.clearWarnedPatterns();
  clearLinearRegExpCache();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what each rule type does to a row it matches", () => {
  test("no rules: the row as it came, the very object", () => {
    const row: MutableMetricRow = rowOf();

    expect(run(row, [], [])).toBe(row);
    expect(row).toEqual(rowOf());
  });

  test("Redact Attribute: the attribute's value replaced - by [REDACTED] unless the rule says otherwise - its key and the others kept", () => {
    expect(
      run(rowOf(), [
        ruleOf(MetricPipelineRuleType.RedactAttribute, {
          addAttributeKey: "user",
        }),
      ]),
    ).toEqual({
      name: "http.server.requests",
      attributes: { region: "eu", user: "[REDACTED]" },
      attributeKeys: ["region", "user"],
    });
    expect(
      run(rowOf(), [
        ruleOf(MetricPipelineRuleType.RedactAttribute, {
          addAttributeKey: "user",
          redactReplacement: "<hidden>",
        }),
      ])!.attributes,
    ).toEqual({ region: "eu", user: "<hidden>" });
  });

  test("Redact Attribute leaves a row without the attribute as it was: nothing is added", () => {
    expect(
      run(rowOf({ region: "eu" }), [
        ruleOf(MetricPipelineRuleType.RedactAttribute, {
          addAttributeKey: "user",
        }),
      ]),
    ).toEqual(rowOf({ region: "eu" }));
  });

  test("Remove, Add and Rename Attribute change the keys, and the key list is rebuilt once, sorted", () => {
    expect(
      run(rowOf({ zone: "a", user: "jane", region: "eu" }), [
        ruleOf(MetricPipelineRuleType.RemoveAttribute, {
          addAttributeKey: "user",
        }),
        ruleOf(MetricPipelineRuleType.AddAttribute, {
          addAttributeKey: "build",
          addAttributeValue: "1.2.3",
        }),
        ruleOf(MetricPipelineRuleType.RenameAttribute, {
          renameFromKey: "zone",
          renameToKey: "availability_zone",
        }),
      ]),
    ).toEqual({
      name: "http.server.requests",
      attributes: { region: "eu", build: "1.2.3", availability_zone: "a" },
      attributeKeys: ["availability_zone", "build", "region"],
    });
  });

  test("a rule missing what it needs - no key, no new name - changes nothing", () => {
    for (const rule of [
      ruleOf(MetricPipelineRuleType.RedactAttribute),
      ruleOf(MetricPipelineRuleType.RemoveAttribute),
      ruleOf(MetricPipelineRuleType.AddAttribute),
      ruleOf(MetricPipelineRuleType.RenameAttribute, { renameFromKey: "user" }),
      ruleOf(MetricPipelineRuleType.RenameMetric),
    ]) {
      expect(run(rowOf(), [rule])).toEqual(rowOf());
    }
  });

  test("Rename Metric renames the metric", () => {
    expect(
      run(rowOf(), [
        ruleOf(MetricPipelineRuleType.RenameMetric, {
          renameToKey: "requests",
        }),
      ])!.name,
    ).toBe("requests");
  });

  test("Drop drops a row it matches; Filter keeps only the rows it matches", () => {
    const fromEu: Array<MetricPipelineRuleFilterCondition> = [
      attributeIs(
        "region",
        MetricPipelineRuleFilterConditionType.EqualTo,
        "eu",
      ),
    ];

    expect(
      run(rowOf(), [ruleOf(MetricPipelineRuleType.Drop, { filters: fromEu })]),
    ).toBeNull();
    expect(
      run(rowOf({ region: "us" }), [
        ruleOf(MetricPipelineRuleType.Drop, { filters: fromEu }),
      ]),
    ).toEqual(rowOf({ region: "us" }));
    expect(
      run(rowOf(), [
        ruleOf(MetricPipelineRuleType.Filter, { filters: fromEu }),
      ]),
    ).toEqual(rowOf());
    expect(
      run(rowOf({ region: "us" }), [
        ruleOf(MetricPipelineRuleType.Filter, { filters: fromEu }),
      ]),
    ).toBeNull();
  });

  test("Sample keeps a row when the draw is under its percentage", () => {
    jest.spyOn(Math, "random").mockReturnValue(0.42);

    expect(
      run(rowOf(), [
        ruleOf(MetricPipelineRuleType.Sample, { samplePercentage: 50 }),
      ]),
    ).not.toBeNull();
    expect(
      run(rowOf(), [
        ruleOf(MetricPipelineRuleType.Sample, { samplePercentage: 42 }),
      ]),
    ).toBeNull();
    expect(
      run(rowOf(), [
        ruleOf(MetricPipelineRuleType.Sample, { samplePercentage: 0 }),
      ]),
    ).toBeNull();
  });

  test("an attribute named __proto__ is the row's own key, renamed or added", () => {
    const row: MutableMetricRow | null = run(rowOf({ region: "eu" }), [
      ruleOf(MetricPipelineRuleType.AddAttribute, {
        addAttributeKey: "__proto__",
        addAttributeValue: "x",
      }),
    ]);
    const attributes: JSONObject = MetricPipelineEngine.getAttributes(row!);

    expect(Object.prototype.hasOwnProperty.call(attributes, "__proto__")).toBe(
      true,
    );
    expect(Object.getPrototypeOf(attributes)).toBe(Object.prototype);
  });

  test("a row whose attributes are not an object is read as having none", () => {
    const row: MutableMetricRow = {
      name: "up",
      attributes: "region=eu",
    };

    expect(
      run(row, [
        ruleOf(MetricPipelineRuleType.AddAttribute, {
          addAttributeKey: "region",
          addAttributeValue: "eu",
        }),
      ]),
    ).toEqual({
      name: "up",
      attributes: { region: "eu" },
      attributeKeys: ["region"],
    });
  });

  test("an unknown rule type is warned about and changes nothing", () => {
    const warn: ReturnType<typeof jest.spyOn> = jest
      .spyOn(logger, "warn")
      .mockImplementation((): void => {});

    expect(
      run(rowOf(), [ruleOf("Teleport" as MetricPipelineRuleType)]),
    ).toEqual(rowOf());
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("which rows a rule's filters match", () => {
  test("no filters match every row", () => {
    expect(
      run(rowOf(), [
        ruleOf(MetricPipelineRuleType.RedactAttribute, {
          addAttributeKey: "user",
        }),
      ])!.attributes,
    ).toMatchObject({ user: "[REDACTED]" });
  });

  test("All needs every filter to match; Any needs one", () => {
    const filters: Array<MetricPipelineRuleFilterCondition> = [
      attributeIs(
        "region",
        MetricPipelineRuleFilterConditionType.EqualTo,
        "eu",
      ),
      nameIs(MetricPipelineRuleFilterConditionType.StartsWith, "db."),
    ];

    expect(
      run(rowOf(), [
        ruleOf(MetricPipelineRuleType.Drop, {
          filters,
          filterCondition: FilterCondition.All,
        }),
      ]),
    ).not.toBeNull();
    expect(
      run(rowOf(), [
        ruleOf(MetricPipelineRuleType.Drop, {
          filters,
          filterCondition: FilterCondition.Any,
        }),
      ]),
    ).toBeNull();
    // No condition is All.
    expect(
      run(rowOf(), [ruleOf(MetricPipelineRuleType.Drop, { filters })]),
    ).not.toBeNull();
  });

  test.each(
    (
      [
        [MetricPipelineRuleFilterConditionType.IsPresent, undefined, true],
        [MetricPipelineRuleFilterConditionType.IsNotPresent, undefined, false],
        [MetricPipelineRuleFilterConditionType.IsEmpty, undefined, false],
        [MetricPipelineRuleFilterConditionType.IsNotEmpty, undefined, true],
        [
          MetricPipelineRuleFilterConditionType.EqualTo,
          "jane.doe@acmecorp.io",
          true,
        ],
        [
          MetricPipelineRuleFilterConditionType.NotEqualTo,
          "jane.doe@acmecorp.io",
          false,
        ],
        [MetricPipelineRuleFilterConditionType.Contains, "@acmecorp", true],
        [MetricPipelineRuleFilterConditionType.NotContains, "@acmecorp", false],
        [MetricPipelineRuleFilterConditionType.StartsWith, "jane", true],
        [MetricPipelineRuleFilterConditionType.EndsWith, ".io", true],
        [
          MetricPipelineRuleFilterConditionType.MatchesRegex,
          "^[^@]+@[^@]+\\.io$",
          true,
        ],
        [
          MetricPipelineRuleFilterConditionType.DoesNotMatchRegex,
          "^[^@]+@[^@]+\\.io$",
          false,
        ],
      ] as Array<
        [MetricPipelineRuleFilterConditionType, string | undefined, boolean]
      >
    ).map(
      ([conditionType, value, matches]: [
        MetricPipelineRuleFilterConditionType,
        string | undefined,
        boolean,
      ]): [
        string,
        boolean,
        MetricPipelineRuleFilterConditionType,
        string | undefined,
      ] => {
        return [
          `${conditionType}${value === undefined ? "" : ` "${value}"`}`,
          matches,
          conditionType,
          value,
        ];
      },
    ),
  )(
    "an attribute's filter %s, on jane.doe@acmecorp.io: matches %s",
    (
      _title: string,
      matches: boolean,
      conditionType: MetricPipelineRuleFilterConditionType,
      value: string | undefined,
    ) => {
      const left: MutableMetricRow | null = run(rowOf(), [
        ruleOf(MetricPipelineRuleType.Drop, {
          filters: [attributeIs("user", conditionType, value)],
        }),
      ]);

      expect(left === null).toBe(matches);
    },
  );

  test("a value comparison on an attribute the row does not have never matches - negated or not", () => {
    for (const conditionType of [
      MetricPipelineRuleFilterConditionType.EqualTo,
      MetricPipelineRuleFilterConditionType.NotEqualTo,
      MetricPipelineRuleFilterConditionType.NotContains,
      MetricPipelineRuleFilterConditionType.DoesNotMatchRegex,
    ]) {
      expect(
        run(rowOf({ region: "eu" }), [
          ruleOf(MetricPipelineRuleType.Drop, {
            filters: [attributeIs("user", conditionType, "x")],
          }),
        ]),
      ).not.toBeNull();
    }

    // A missing attribute is empty.
    expect(
      run(rowOf({ region: "eu" }), [
        ruleOf(MetricPipelineRuleType.Drop, {
          filters: [
            attributeIs("user", MetricPipelineRuleFilterConditionType.IsEmpty),
          ],
        }),
      ]),
    ).toBeNull();
  });

  test("a value that is not text is compared as its text", () => {
    expect(
      run(rowOf({ status: 503 }), [
        ruleOf(MetricPipelineRuleType.Drop, {
          filters: [
            attributeIs(
              "status",
              MetricPipelineRuleFilterConditionType.StartsWith,
              "5",
            ),
          ],
        }),
      ]),
    ).toBeNull();
  });

  test("an invalid pattern matches nothing - negated or not - and is warned about once, until the warnings are forgotten", () => {
    const warn: ReturnType<typeof jest.spyOn> = jest
      .spyOn(logger, "warn")
      .mockImplementation((): void => {});

    for (const conditionType of [
      MetricPipelineRuleFilterConditionType.MatchesRegex,
      MetricPipelineRuleFilterConditionType.DoesNotMatchRegex,
    ]) {
      for (let i: number = 0; i < 3; i++) {
        expect(
          run(rowOf(), [
            ruleOf(MetricPipelineRuleType.Drop, {
              filters: [attributeIs("user", conditionType, "(unclosed")],
            }),
          ]),
        ).not.toBeNull();
      }
    }

    expect(warn).toHaveBeenCalledTimes(1);

    MetricPipelineEngine.clearWarnedPatterns();
    clearLinearRegExpCache();
    run(rowOf(), [
      ruleOf(MetricPipelineRuleType.Drop, {
        filters: [
          attributeIs(
            "user",
            MetricPipelineRuleFilterConditionType.MatchesRegex,
            "(unclosed",
          ),
        ],
      }),
    ]);

    expect(warn).toHaveBeenCalledTimes(2);
  });

  test("a filter missing what it checks, or naming no attribute, matches nothing", () => {
    for (const filter of [
      {
        checkOn: MetricPipelineRuleFilterCheckOn.Attribute,
      } as MetricPipelineRuleFilterCondition,
      attributeIs(" ", MetricPipelineRuleFilterConditionType.IsPresent),
      {
        conditionType: MetricPipelineRuleFilterConditionType.IsPresent,
      } as MetricPipelineRuleFilterCondition,
    ]) {
      expect(
        run(rowOf(), [
          ruleOf(MetricPipelineRuleType.Drop, { filters: [filter] }),
        ]),
      ).not.toBeNull();
    }
  });
});

describe("the order rules run in", () => {
  test("the service's rules first, then the project's, each on what the last left", () => {
    // The service renames the attribute; the project's rule redacts it by its new name.
    expect(
      run(
        rowOf(),
        [
          ruleOf(MetricPipelineRuleType.RenameAttribute, {
            renameFromKey: "user",
            renameToKey: "enduser.id",
          }),
        ],
        [
          ruleOf(MetricPipelineRuleType.RedactAttribute, {
            addAttributeKey: "enduser.id",
          }),
        ],
      )!.attributes,
    ).toEqual({ region: "eu", "enduser.id": "[REDACTED]" });
  });

  test("a row a service's rule drops reaches no project rule", () => {
    const project: MetricPipelineRule = ruleOf(
      MetricPipelineRuleType.AddAttribute,
      { addAttributeKey: "seen", addAttributeValue: "yes" },
    );
    const matches: ReturnType<typeof jest.spyOn> = jest.spyOn(
      MetricPipelineEngine,
      "applyOne",
    );

    expect(
      run(rowOf(), [ruleOf(MetricPipelineRuleType.Drop)], [project]),
    ).toBeNull();
    expect(matches).toHaveBeenCalledTimes(1);
  });

  test("the project's rules alone, for a row of no service's rules", () => {
    expect(
      run(
        rowOf(),
        [],
        [
          ruleOf(MetricPipelineRuleType.RedactAttribute, {
            addAttributeKey: "user",
          }),
        ],
      )!.attributes,
    ).toEqual({ region: "eu", user: "[REDACTED]" });
  });
});

/*
 * #10934: a filter can match a built-in Pattern Type - the very pattern a
 * log or trace scrub rule of that type runs - which is what Scrub It's
 * metric rule for an IP address, an email address or a card number
 * matches. It hides what Data Security's detectors find in every reading:
 * an IPv6 address as well as an IPv4 one, right after a key's colon
 * (#10936), in a percent-encoded URL (#10467, #10935), an email address in
 * any script and a card in any script's digits (#10960) - and keeps what
 * is no one's data.
 */
describe("a Matches Pattern Type filter", () => {
  function redactWhere(key: string, patternType: string): MetricPipelineRule {
    return ruleOf(MetricPipelineRuleType.RedactAttribute, {
      addAttributeKey: key,
      filterCondition: FilterCondition.All,
      filters: [
        attributeIs(
          key,
          MetricPipelineRuleFilterConditionType.MatchesPatternType,
          patternType,
        ),
      ],
    });
  }

  function leftOf(
    rule: MetricPipelineRule,
    key: string,
    value: string,
  ): unknown {
    const left: MutableMetricRow | null = run(
      rowOf({ [key]: value, region: "eu" }),
      [rule],
    );

    return (left!.attributes as JSONObject)[key];
  }

  test.each([
    ["an IPv4 address", "81.2.69.160"],
    ["an IPv6 address", "2a00:1450:4001:82a::200e"],
    ["one group each side of ::", "2001::1"],
    ["an IPv4 address written as IPv6", "::ffff:81.2.69.142"],
    ["an address right after a key's colon", "peer ip:2a00:1450::1"],
    ["an address in an encoded URL", "/geo?client=2606%3A4700%3A%3A1111"],
    ["a documentation address", "2001:db8::7"],
  ])("ipAddress redacts %s: %s", (_label: string, value: string) => {
    expect(leftOf(redactWhere("peer", "ipAddress"), "peer", value)).toBe(
      "[REDACTED]",
    );
  });

  test.each([
    ["a private address", "10.0.0.12"],
    ["a link-local one", "fe80::1"],
    ["loopback", "127.0.0.1"],
    ["a clock", "12:30:45"],
    ["a scope of hex letters", "Abc::Def"],
    ["a MAC address", "00:1a:2b:3c:4d:5e"],
    ["no address", "unknown"],
  ])("ipAddress keeps %s: %s", (_label: string, value: string) => {
    expect(leftOf(redactWhere("peer", "ipAddress"), "peer", value)).toBe(value);
  });

  test.each([
    ["an address", "jane.doe@acmecorp.io"],
    ["an address in an encoded URL", "/signup?email=jane.doe%40acmecorp.io"],
    ["a name in Han letters", "张伟@acmecorp.io"],
    ["a name and domain in Cyrillic", "почта@пример.рф"],
  ])("email redacts %s: %s", (_label: string, value: string) => {
    expect(leftOf(redactWhere("user", "email"), "user", value)).toBe(
      "[REDACTED]",
    );
  });

  test.each([
    ["an ASCII card in groups", "4532 0151 1283 0366"],
    ["a card in fullwidth digits", "４５３２ ０１５１ １２８３ ０３６６"],
    ["a card in Arabic-Indic digits", "٤٥٣٢٠١٥١١٢٨٣٠٣٦٦"],
    ["an American Express card", "3782 822463 10005"],
  ])("creditCard redacts %s: %s", (_label: string, value: string) => {
    expect(leftOf(redactWhere("card", "creditCard"), "card", value)).toBe(
      "[REDACTED]",
    );
  });

  test("ssn and phoneNumber match what an SSN or Phone Number rule finds", () => {
    expect(leftOf(redactWhere("ssn", "ssn"), "ssn", "123-45-6789")).toBe(
      "[REDACTED]",
    );
    expect(
      leftOf(redactWhere("caller", "phoneNumber"), "caller", "415-555-2671"),
    ).toBe("[REDACTED]");
    expect(leftOf(redactWhere("ssn", "ssn"), "ssn", "none")).toBe("none");
  });

  // #11025, #11030: what Data Security finds, as a log or trace rule hides it.
  test.each([
    ["an international number", "+44 20 8123 4567"],
    ["one in its calling code's parentheses", "(+44) 20 8123 4567"],
    ["one in an encoded URL", "/callback?phone=%2B49%2030%2081234567"],
    ["one in Arabic-Indic digits", "+٤٩ ٣٠ ٨١٢٣٤٥٦٧"],
    ["a North American one in fullwidth digits", "(４１５) ３２１-８７３１"],
  ])("phoneNumber redacts %s: %s", (_label: string, value: string) => {
    expect(leftOf(redactWhere("caller", "phoneNumber"), "caller", value)).toBe(
      "[REDACTED]",
    );
  });

  test.each([
    ["a decimal", "+51.507217"],
    ["a time zone beside a date", "UTC +1 2026-11-24"],
    ["a version", "v1.2.3+build.5"],
  ])("phoneNumber keeps %s: %s", (_label: string, value: string) => {
    expect(leftOf(redactWhere("caller", "phoneNumber"), "caller", value)).toBe(
      value,
    );
  });

  test.each([
    ["one set apart by dots", "536.22.8731"],
    ["one set apart by spaces", "536 22 8731"],
    ["one in Arabic-Indic digits", "٥٣٦-٢٢-٨٧٣١"],
  ])("ssn redacts %s: %s", (_label: string, value: string) => {
    expect(leftOf(redactWhere("ssn", "ssn"), "ssn", value)).toBe("[REDACTED]");
  });

  test("ssn keeps an area no one is issued, and a longer chain of groups", () => {
    for (const value of ["666.22.8731", "536.22.8731.01"]) {
      expect(leftOf(redactWhere("ssn", "ssn"), "ssn", value)).toBe(value);
    }
  });

  test("a value that names no pattern type matches nothing", () => {
    for (const patternType of ["", "custom", "sensitiveKeys", "constructor"]) {
      expect(
        leftOf(redactWhere("peer", patternType), "peer", "81.2.69.160"),
      ).toBe("81.2.69.160");
    }
  });

  test("reads a metric's name too, and combines with other filters", () => {
    const drop: MetricPipelineRule = ruleOf(MetricPipelineRuleType.Drop, {
      filterCondition: FilterCondition.All,
      filters: [
        nameIs(
          MetricPipelineRuleFilterConditionType.MatchesPatternType,
          "ipAddress",
        ),
        attributeIs(
          "region",
          MetricPipelineRuleFilterConditionType.EqualTo,
          "eu",
        ),
      ],
    });

    expect(
      run(rowOf({ region: "eu" }, "ping_81.2.69.160_rtt"), [drop]),
    ).toBeNull();
    expect(
      run(rowOf({ region: "us" }, "ping_81.2.69.160_rtt"), [drop]),
    ).not.toBeNull();
    expect(run(rowOf({ region: "eu" }, "ping.rtt"), [drop])).not.toBeNull();
    // Glued after a dot it reads as a version's parts, as the scan reads it.
    expect(
      run(rowOf({ region: "eu" }, "ping.81.2.69.160.rtt"), [drop]),
    ).not.toBeNull();
  });

  test("a row without the attribute never matches", () => {
    expect(
      run(rowOf({ region: "eu" }), [redactWhere("peer", "ipAddress")])!
        .attributes,
    ).toEqual({ region: "eu" });
  });
});
