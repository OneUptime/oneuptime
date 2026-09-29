/*
 * The alerting module pulls the native isolated-vm addon through its
 * template renderer; stub it out before anything imports it.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import { describe, expect, test } from "@jest/globals";
import DetectionRulesGuide, {
  DETECTION_RULE_EXAMPLE_YAML,
  DETECTION_THRESHOLD_EXAMPLES,
  DetectionThresholdExample,
  SIGMA_COLUMN_DOCS,
  SIGMA_FIELD_ALIAS_DOCS,
  SIGMA_MODIFIER_DOCS,
  SIGMA_SELECTIONS_EXAMPLE_YAML,
  SigmaFieldDoc,
  SigmaModifierDoc,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/HowItWorks/DetectionRulesGuide";
import ThreatIntelGuide, {
  INDICATOR_TYPE_DOCS,
  SUPPORTED_COMBINED_PATTERN_EXAMPLES,
  THREAT_INTEL_SIGMA_EXAMPLE_YAML,
  THREAT_LEVEL_BANDS,
  ThreatLevelBand,
  UNSCORED_CONFIDENCE,
  UNSUPPORTED_PATTERN_EXAMPLES,
  formatBand,
  threatLevelForBand,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/HowItWorks/ThreatIntelGuide";
import {
  SecurityEventsGuide,
  SecurityEventsGuideLevel,
  SecurityEventsGuideSection,
  getGuideSection,
  guideToMarkdown,
  markdownTable,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/HowItWorks/SecurityEventsGuide";
import SigmaRuleParser from "../../../Utils/SecurityEvent/Sigma/SigmaRuleParser";
import SigmaClickhouseCompiler, {
  FIELD_ALIASES,
  buildSigmaDistinctCountExpression,
  buildSigmaFieldExpression,
  resolveSigmaField,
} from "../../../Server/Utils/SecurityEvent/Sigma/SigmaClickhouseCompiler";
import { pickSeverityByPrecedence } from "../../../Server/Utils/SecurityEvent/SecurityEventAlerting";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import StixPatternParser, {
  ParsedIndicatorValue,
} from "../../../Utils/SecurityEvent/ThreatIntel/StixPatternParser";
import SigmaRule, {
  SIGMA_DEFAULT_LEVEL,
  SIGMA_LEVEL_TO_OCSF_SEVERITY,
  SIGMA_SUPPORTED_MODIFIERS,
  SigmaFieldRequirement,
  SigmaLevel,
  isSevereSigmaLevel,
} from "../../../Types/SecurityEvent/SigmaRule";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import {
  DETECTION_DISTINCT_COUNT_ATTRIBUTE,
  DETECTION_EVALUATION_INTERVAL_MAX_IN_MINUTES,
  DETECTION_EVALUATION_INTERVAL_MIN_IN_MINUTES,
  DETECTION_FINDING_CLASS_NAME,
  DETECTION_FINDING_CLASS_UID,
  DETECTION_GROUP_VALUE_ATTRIBUTE,
  DETECTION_MATCH_COUNT_ATTRIBUTE,
  DETECTION_MATCH_COUNT_THRESHOLD_MAX,
  DETECTION_MATCH_COUNT_THRESHOLD_MIN,
  DETECTION_MAX_GROUPS_PER_EVALUATION,
  DETECTION_MAX_LOOKBACK_IN_MINUTES,
  DETECTION_RULE_ID_ATTRIBUTE,
  DETECTION_RULE_NAME_ATTRIBUTE,
  DETECTION_SIGMA_ID_ATTRIBUTE,
} from "../../../Types/SecurityEvent/DetectionFindingConstants";
import {
  ENRICHMENT_CONFIDENCE_ATTRIBUTE,
  ENRICHMENT_FEED_ATTRIBUTE,
  ENRICHMENT_FEED_ID_ATTRIBUTE,
  ENRICHMENT_INDICATOR_ID_ATTRIBUTE,
  ENRICHMENT_INDICATOR_TYPE_ATTRIBUTE,
  ENRICHMENT_INDICATOR_VALUE_ATTRIBUTE,
  ENRICHMENT_MATCHED_ATTRIBUTE,
  ENRICHMENT_MATCH_COUNT_ATTRIBUTE,
  THREAT_CONFIDENCE_ATTRIBUTE,
  THREAT_FEED_ID_ATTRIBUTE,
  THREAT_FEED_NAME_ATTRIBUTE,
  THREAT_INDICATOR_ID_ATTRIBUTE,
  THREAT_INDICATOR_TYPE_ATTRIBUTE,
  THREAT_INDICATOR_VALUE_ATTRIBUTE,
  THREAT_INTEL_DEFAULT_POLL_INTERVAL_IN_MINUTES,
  THREAT_INTEL_DEFAULT_VALID_DAYS,
  THREAT_INTEL_FIRST_MATCH_WINDOW_IN_MINUTES,
  THREAT_INTEL_MATCH_MAX_LOOKBACK_IN_MINUTES,
  THREAT_INTEL_MAX_INDICATORS_PER_EVALUATION,
  THREAT_INTEL_MINIMUM_CONFIDENCE_MAX,
  THREAT_INTEL_MINIMUM_CONFIDENCE_MIN,
  THREAT_INTEL_POLL_INTERVAL_MAX_IN_MINUTES,
  THREAT_INTEL_POLL_INTERVAL_MIN_IN_MINUTES,
  THREAT_INTEL_PRODUCT_NAME,
  THREAT_MATCH_COUNT_ATTRIBUTE,
  ThreatIntelIndicatorType,
  ocsfSeverityForConfidence,
} from "../../../Types/SecurityEvent/ThreatIntelConstants";
import ObjectID from "../../../Types/ObjectID";

/*
 * The Detection Rules and Threat Intel guides are what a customer reads to
 * decide whether to trust a detection — so a guide that is wrong is worse
 * than no guide. Nothing about a wrong sentence fails to render, so every
 * claim the guides make is pinned here against the code that actually
 * behaves that way: examples go through the real Sigma parser, compiler
 * and STIX pattern parser; tables are compared with the engine's own
 * mappings, in both directions where a table claims to be complete; and
 * every number is checked against the constant the engine runs on.
 */

const GUIDES: Array<SecurityEventsGuide> = [
  DetectionRulesGuide,
  ThreatIntelGuide,
];

const GUIDE_CASES: Array<[string, SecurityEventsGuide]> = GUIDES.map(
  (guide: SecurityEventsGuide): [string, SecurityEventsGuide] => {
    return [guide.id, guide];
  },
);

const MODIFIER_CASES: Array<[string, SigmaModifierDoc]> =
  SIGMA_MODIFIER_DOCS.map(
    (doc: SigmaModifierDoc): [string, SigmaModifierDoc] => {
      return [doc.modifier, doc];
    },
  );

const ALIAS_CASES: Array<[string, string]> = SIGMA_FIELD_ALIAS_DOCS.flatMap(
  (doc: SigmaFieldDoc): Array<[string, string]> => {
    return doc.aliases.map((alias: string): [string, string] => {
      return [alias, doc.column];
    });
  },
);

const THRESHOLD_CASES: Array<[string, DetectionThresholdExample]> =
  DETECTION_THRESHOLD_EXAMPLES.map(
    (
      example: DetectionThresholdExample,
    ): [string, DetectionThresholdExample] => {
      return [example.goal, example];
    },
  );

const BAND_CASES: Array<[string, ThreatLevelBand]> = THREAT_LEVEL_BANDS.map(
  (band: ThreatLevelBand): [string, ThreatLevelBand] => {
    return [formatBand(band), band];
  },
);

const SIGMA_LEVELS_IN_ORDER: Array<SigmaLevel> = [
  SigmaLevel.Informational,
  SigmaLevel.Low,
  SigmaLevel.Medium,
  SigmaLevel.High,
  SigmaLevel.Critical,
];

const YAML_BLOCK_PATTERN: RegExp = /```yaml\n([\s\S]*?)```/g;
const FENCE_PATTERN: RegExp = /```/g;

function sectionMarkdown(
  guide: SecurityEventsGuide,
  sectionId: string,
): string {
  const section: SecurityEventsGuideSection | undefined = getGuideSection(
    guide,
    sectionId,
  );

  expect(section).toBeDefined();

  return section!.markdown;
}

function allMarkdown(guide: SecurityEventsGuide): string {
  return guide.sections
    .map((section: SecurityEventsGuideSection): string => {
      return section.markdown;
    })
    .join("\n");
}

function ruleWithSelectionLine(line: string): string {
  return `title: Guide example
detection:
  selection:
    ${line}
  condition: selection
`;
}

function compileLine(line: string): Statement {
  return SigmaClickhouseCompiler.compileYaml(ruleWithSelectionLine(line));
}

function paramValues(statement: Statement): Array<unknown> {
  return Object.values(statement.query_params);
}

function yamlBlocks(markdown: string): Array<string> {
  return Array.from(markdown.matchAll(YAML_BLOCK_PATTERN)).map(
    (match: RegExpMatchArray): string => {
      return match[1] || "";
    },
  );
}

describe("Security Events guides: structure", () => {
  test.each(GUIDE_CASES)(
    "%s has a title, summary, four steps and a levels strip",
    (_id: string, guide: SecurityEventsGuide) => {
      expect(guide.title.trim()).not.toBe("");
      expect(guide.summary.trim()).not.toBe("");
      expect(guide.steps).toHaveLength(4);

      for (const step of guide.steps) {
        expect(step.title.trim()).not.toBe("");
        expect(step.description.trim()).not.toBe("");
        expect(step.icon).toBeDefined();
      }

      expect(guide.levels.items.length).toBeGreaterThan(0);
    },
  );

  test.each(GUIDE_CASES)(
    "%s has unique section ids and titles (the tabs are keyed by title)",
    (_id: string, guide: SecurityEventsGuide) => {
      const ids: Array<string> = guide.sections.map(
        (section: SecurityEventsGuideSection) => {
          return section.id;
        },
      );
      const titles: Array<string> = guide.sections.map(
        (section: SecurityEventsGuideSection) => {
          return section.title;
        },
      );

      expect(new Set(ids).size).toBe(ids.length);
      expect(new Set(titles).size).toBe(titles.length);
      expect(guide.sections[0]?.id).toBe("overview");
      expect(guide.sections[guide.sections.length - 1]?.id).toBe(
        "troubleshooting",
      );
    },
  );

  test.each(GUIDE_CASES)(
    "%s's levels strip links to a section that exists",
    (_id: string, guide: SecurityEventsGuide) => {
      expect(getGuideSection(guide, guide.levels.sectionId)).toBeDefined();
    },
  );

  test.each(GUIDE_CASES)(
    "%s's markdown carries no failed interpolation",
    (_id: string, guide: SecurityEventsGuide) => {
      const text: string = [
        guide.title,
        guide.summary,
        guide.guideTitle,
        guide.guideDescription,
        guide.levels.title,
        guide.levels.description,
        ...guide.steps.map((step: { description: string }) => {
          return step.description;
        }),
        allMarkdown(guide),
      ].join("\n");

      expect(text).not.toContain("undefined");
      expect(text).not.toContain("NaN");
      expect(text).not.toContain("[object Object]");
      expect(text).not.toContain("${");
    },
  );

  test.each(GUIDE_CASES)(
    "%s never leaves a code fence open (an open fence swallows the rest of the tab)",
    (_id: string, guide: SecurityEventsGuide) => {
      for (const section of guide.sections) {
        const fences: number = (section.markdown.match(FENCE_PATTERN) || [])
          .length;
        expect(fences % 2).toBe(0);
      }
    },
  );

  test.each(GUIDE_CASES)(
    "every YAML sample in %s is a Sigma rule the save-time validator accepts",
    (_id: string, guide: SecurityEventsGuide) => {
      const blocks: Array<string> = yamlBlocks(allMarkdown(guide));

      expect(blocks.length).toBeGreaterThan(0);

      for (const block of blocks) {
        expect(() => {
          SigmaClickhouseCompiler.compileYaml(block);
        }).not.toThrow();
      }
    },
  );

  test("the two guides use different ids, so their collapsed state is stored apart", () => {
    expect(DetectionRulesGuide.id).not.toBe(ThreatIntelGuide.id);
  });

  test("each guide points at a public documentation path", () => {
    expect(DetectionRulesGuide.documentationPath).toBe(
      "/telemetry/security-events",
    );
    expect(ThreatIntelGuide.documentationPath).toBe(
      "/telemetry/threat-intelligence",
    );
  });
});

describe("guideToMarkdown", () => {
  test("includes every section, headed by its title, in order", () => {
    const markdown: string = guideToMarkdown(DetectionRulesGuide);

    let lastIndex: number = -1;

    for (const section of DetectionRulesGuide.sections) {
      const headingIndex: number = markdown.indexOf(`### ${section.title}\n`);
      expect(headingIndex).toBeGreaterThan(lastIndex);
      expect(markdown).toContain(section.markdown.trim());
      lastIndex = headingIndex;
    }
  });

  test("separates sections with a rule", () => {
    const markdown: string = guideToMarkdown(ThreatIntelGuide);

    expect(markdown.split("\n\n---\n\n")).toHaveLength(
      ThreatIntelGuide.sections.length,
    );
  });
});

describe("markdownTable", () => {
  test("renders a header, a separator and one line per row", () => {
    expect(
      markdownTable(
        ["A", "B"],
        [
          ["1", "2"],
          ["3", "4"],
        ],
      ),
    ).toBe("| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |");
  });

  test("escapes pipes so a Sigma field|modifier key cannot split its cell", () => {
    expect(markdownTable(["Key"], [["`CommandLine|contains`"]])).toBe(
      "| Key |\n| --- |\n| `CommandLine\\|contains` |",
    );
  });
});

describe("Detection Rules guide: the walkthrough rule", () => {
  test("parses and compiles, so the example would save", () => {
    expect(() => {
      SigmaClickhouseCompiler.compileYaml(DETECTION_RULE_EXAMPLE_YAML);
    }).not.toThrow();
  });

  test("is high level, as the overview says", () => {
    expect(SigmaRuleParser.parse(DETECTION_RULE_EXAMPLE_YAML).level).toBe(
      SigmaLevel.High,
    );
  });

  test("its ATT&CK id tags become the finding's technique and tactic, as the tags row says", () => {
    const rule: SigmaRule = SigmaRuleParser.parse(DETECTION_RULE_EXAMPLE_YAML);

    expect(rule.mitreTechniques).toEqual(["T1110"]);
    expect(rule.mitreTactics).toEqual(["TA0006"]);
  });

  test("named ATT&CK tags are not mapped, as the tags row warns", () => {
    const rule: SigmaRule = SigmaRuleParser.parse(`title: Named tags
tags:
  - attack.credential_access
detection:
  selection:
    className: Authentication
  condition: selection
`);

    expect(rule.mitreTactics).toEqual([]);
    expect(rule.mitreTechniques).toEqual([]);
  });

  test("excludes internal IPs the way the overview describes", () => {
    const statement: Statement = SigmaClickhouseCompiler.compileYaml(
      DETECTION_RULE_EXAMPLE_YAML,
    );

    expect(statement.query).toContain("NOT ");
    expect(statement.query).toContain("principalIp ILIKE");
    expect(paramValues(statement)).toContain("10.%");
  });

  test("the overview walks through it with a Group By Field and threshold the engine accepts", () => {
    const overview: string = sectionMarkdown(DetectionRulesGuide, "overview");

    expect(overview).toContain(DETECTION_RULE_EXAMPLE_YAML);
    expect(resolveSigmaField("principalIp").kind).toBe("textColumn");
  });
});

describe("Detection Rules guide: selections and conditions", () => {
  test("the selections sample has the three shapes it describes", () => {
    const rule: SigmaRule = SigmaRuleParser.parse(
      SIGMA_SELECTIONS_EXAMPLE_YAML,
    );

    const byName: Map<string, SigmaRule["selections"][number]> = new Map(
      rule.selections.map((selection: SigmaRule["selections"][number]) => {
        return [selection.name, selection];
      }),
    );

    // Field map: one map whose statusName carries two OR-ed values.
    const logon: SigmaRule["selections"][number] | undefined =
      byName.get("selection_logon");
    expect(logon?.fieldMaps).toHaveLength(1);
    const statusName: SigmaFieldRequirement | undefined =
      logon?.fieldMaps[0]?.find((requirement: SigmaFieldRequirement) => {
        return requirement.field === "statusName";
      });
    expect(statusName?.values).toEqual(["Failure", "Blocked"]);

    // List of maps: two alternatives.
    expect(byName.get("selection_admin")?.fieldMaps).toHaveLength(2);

    // Keywords.
    expect(byName.get("keywords")?.keywords).toEqual([
      "password spray",
      "credential stuffing",
    ]);
  });

  test("keywords match anywhere in the message, ignoring case", () => {
    const statement: Statement = SigmaClickhouseCompiler.compileYaml(
      SIGMA_SELECTIONS_EXAMPLE_YAML,
    );

    expect(statement.query).toContain("message ILIKE");
    expect(paramValues(statement)).toContain("%password spray%");
  });

  test("the documented quantifiers are all accepted", () => {
    for (const condition of [
      "1 of selection_*",
      "all of selection_*",
      "any of them",
      "all of them",
      "selection_a and not (selection_b or selection_c)",
    ]) {
      expect(() => {
        SigmaClickhouseCompiler.compileYaml(`title: Quantifiers
detection:
  selection_a:
    className: Authentication
  selection_b:
    statusName: Failure
  selection_c:
    principalUser: root
  condition: ${condition}
`);
      }).not.toThrow();
    }
  });

  test("aggregations are rejected at save, as the guide says", () => {
    expect(() => {
      SigmaRuleParser.parse(`title: Aggregation
detection:
  selection:
    className: Authentication
  condition: selection | count() by principalIp > 5
`);
    }).toThrow(/aggregation/i);
  });

  test("a timeframe under detection is accepted and ignored", () => {
    const withTimeframe: Statement =
      SigmaClickhouseCompiler.compileYaml(`title: T
detection:
  selection:
    className: Authentication
  timeframe: 5m
  condition: selection
`);
    const without: Statement = SigmaClickhouseCompiler.compileYaml(
      ruleWithSelectionLine("className: Authentication"),
    );

    expect(withTimeframe.query).toBe(without.query);
    expect(withTimeframe.query_params).toEqual(without.query_params);
  });

  test("logsource does not narrow the search, as the structure table warns", () => {
    const withLogsource: Statement =
      SigmaClickhouseCompiler.compileYaml(`title: T
logsource:
  category: authentication
  product: okta
detection:
  selection:
    className: Authentication
  condition: selection
`);
    const without: Statement = SigmaClickhouseCompiler.compileYaml(
      ruleWithSelectionLine("className: Authentication"),
    );

    expect(withLogsource.query).toBe(without.query);
    expect(withLogsource.query_params).toEqual(without.query_params);
  });

  test("a missing or unknown level reads as the documented default", () => {
    expect(
      SigmaRuleParser.parse(ruleWithSelectionLine("className: X")).level,
    ).toBe(SIGMA_DEFAULT_LEVEL);
    expect(
      SigmaRuleParser.parse(
        `level: severe\n${ruleWithSelectionLine("className: X")}`,
      ).level,
    ).toBe(SIGMA_DEFAULT_LEVEL);
    expect(sectionMarkdown(DetectionRulesGuide, "writing-rules")).toContain(
      `read as \`${SIGMA_DEFAULT_LEVEL}\``,
    );
  });
});

describe("Detection Rules guide: matching semantics", () => {
  test("plain values ignore case", () => {
    const statement: Statement = compileLine("message: 'Mimikatz Ran'");

    expect(statement.query).toContain("lowerUTF8(message)");
    expect(paramValues(statement)).toEqual(["mimikatz ran"]);
  });

  test("|cased matches case-sensitively", () => {
    const statement: Statement = compileLine("message|cased: 'Mimikatz'");

    expect(statement.query).not.toContain("lowerUTF8");
    expect(paramValues(statement)).toEqual(["Mimikatz"]);
  });

  test("regular expressions are case-sensitive (no case folding is applied)", () => {
    const statement: Statement = compileLine("principalUser|re: '^Adm'");

    expect(statement.query).toContain("match(principalUser");
    expect(statement.query).not.toContain("lowerUTF8");
    expect(statement.query).not.toContain("ILIKE");
  });

  test("* and ? are wildcards", () => {
    const statement: Statement = compileLine("targetResource: '/tmp/*.sh'");

    expect(statement.query).toContain("targetResource ILIKE");
    expect(paramValues(statement)).toEqual(["/tmp/%.sh"]);
  });

  test("null matches an empty column or a missing attribute", () => {
    expect(compileLine("principalUser: null").query).toContain(
      "principalUser = ''",
    );
    expect(compileLine("threat.matched: null").query).toContain(
      "NOT mapContains(attributes",
    );
  });

  test("list columns: a plain value needs exact membership, |contains matches inside items ignoring case", () => {
    expect(compileLine("observables: 'Alice'").query).toContain(
      "has(observables",
    );

    const contains: Statement = compileLine("observables|contains: 'ali'");
    expect(contains.query).toContain("arrayExists(x -> x ILIKE");
  });

  test("any modifier outside the documented list is rejected at save", () => {
    expect(() => {
      SigmaRuleParser.parse(ruleWithSelectionLine("CommandLine|base64: 'x'"));
    }).toThrow(/unsupported field modifier/);
  });

  test("a nested map value is rejected at save, as troubleshooting says", () => {
    expect(() => {
      SigmaRuleParser.parse(`title: Nested
detection:
  selection:
    principal:
      user: root
  condition: selection
`);
    }).toThrow(/nested object/);
  });

  test("a condition naming a missing selection is rejected at save", () => {
    expect(() => {
      SigmaRuleParser.parse(`title: Missing
detection:
  selection:
    className: X
  condition: selection and filter
`);
    }).toThrow();

    expect(() => {
      SigmaRuleParser.parse(`title: No match
detection:
  selection:
    className: X
  condition: 1 of filter_*
`);
    }).toThrow(/matches no selection/);
  });
});

describe("Detection Rules guide: the modifier table", () => {
  test("lists exactly the modifiers the parser accepts — no more, no fewer", () => {
    const documented: Array<string> = SIGMA_MODIFIER_DOCS.map(
      (doc: SigmaModifierDoc) => {
        return doc.modifier;
      },
    );

    expect([...documented].sort()).toEqual(
      [...SIGMA_SUPPORTED_MODIFIERS].sort(),
    );
    expect(new Set(documented).size).toBe(documented.length);
  });

  test.each(MODIFIER_CASES)(
    "the %s example parses, uses its modifier, and compiles",
    (_modifier: string, doc: SigmaModifierDoc) => {
      const rule: SigmaRule = SigmaRuleParser.parse(
        ruleWithSelectionLine(doc.example),
      );
      const requirement: SigmaFieldRequirement | undefined =
        rule.selections[0]?.fieldMaps[0]?.[0];

      expect(requirement?.modifiers).toContain(doc.modifier);
      expect(() => {
        SigmaClickhouseCompiler.compile(rule);
      }).not.toThrow();
    },
  );

  /*
   * Each description promises a behavior; the compiled SQL is where that
   * behavior lives.
   */
  const EXPECTED_SQL: Record<string, (statement: Statement) => void> = {
    contains: (statement: Statement) => {
      expect(statement.query).toContain("ILIKE");
      expect(paramValues(statement)).toEqual(["%-EncodedCommand%"]);
    },
    startswith: (statement: Statement) => {
      expect(paramValues(statement)).toEqual(["10.%"]);
    },
    endswith: (statement: Statement) => {
      expect(paramValues(statement)).toEqual(["%.ps1"]);
    },
    all: (statement: Statement) => {
      expect(statement.query).toContain(" AND ");
      expect(statement.query).not.toContain(" OR ");
    },
    re: (statement: Statement) => {
      expect(statement.query).toContain("match(");
    },
    cased: (statement: Statement) => {
      expect(statement.query).toContain(" LIKE ");
      expect(statement.query).not.toContain("ILIKE");
    },
    gt: (statement: Statement) => {
      expect(statement.query).toContain("severityId > ");
    },
    gte: (statement: Statement) => {
      expect(statement.query).toContain("toFloat64OrNull(attributes[");
      expect(statement.query).toContain(" >= ");
    },
    lt: (statement: Statement) => {
      expect(statement.query).toContain("targetPort < ");
    },
    lte: (statement: Statement) => {
      expect(statement.query).toContain("targetPort <= ");
    },
    cidr: (statement: Statement) => {
      expect(statement.query).toContain("isIPAddressInRange(principalIp");
    },
    exists: (statement: Statement) => {
      expect(statement.query).toContain("mapContains(attributes");
      expect(statement.query).not.toContain("NOT mapContains");
    },
    windash: (statement: Statement) => {
      expect(paramValues(statement)).toEqual(
        expect.arrayContaining(["% -exec %", "% /exec %"]),
      );
      expect(statement.query).toContain(" OR ");
    },
  };

  test("every modifier has a behavior check below", () => {
    expect(Object.keys(EXPECTED_SQL).sort()).toEqual(
      [...SIGMA_SUPPORTED_MODIFIERS].sort(),
    );
  });

  test.each(MODIFIER_CASES)(
    "the %s example compiles to what its description says",
    (modifier: string, doc: SigmaModifierDoc) => {
      EXPECTED_SQL[modifier]!(compileLine(doc.example));
    },
  );

  test("the table is rendered into the Writing Rules section", () => {
    const writing: string = sectionMarkdown(
      DetectionRulesGuide,
      "writing-rules",
    );

    for (const doc of SIGMA_MODIFIER_DOCS) {
      expect(writing).toContain(`\`${doc.modifier}\``);
      expect(writing).toContain(doc.example.replace(/\|/g, "\\|"));
    }
  });
});

describe("Detection Rules guide: field names", () => {
  test.each(ALIAS_CASES)(
    "%s resolves to %s",
    (alias: string, column: string) => {
      const resolved: ReturnType<typeof resolveSigmaField> =
        resolveSigmaField(alias);

      expect(resolved.kind).not.toBe("attribute");
      expect((resolved as { column: string }).column).toBe(column);
    },
  );

  test("every alias the compiler knows is documented", () => {
    const documented: Set<string> = new Set(
      SIGMA_FIELD_ALIAS_DOCS.flatMap((doc: SigmaFieldDoc) => {
        return doc.aliases.map((alias: string) => {
          return alias.toLowerCase();
        });
      }),
    );

    for (const alias of Object.keys(FIELD_ALIASES)) {
      expect(documented).toContain(alias);
    }

    expect(documented.size).toBe(Object.keys(FIELD_ALIASES).length);
  });

  test("every documented column is a typed column, reachable by its own name", () => {
    const columns: Array<string> = SIGMA_COLUMN_DOCS.flatMap(
      (entry: { columns: Array<string> }) => {
        return entry.columns;
      },
    );

    expect(new Set(columns).size).toBe(columns.length);

    for (const column of columns) {
      const resolved: ReturnType<typeof resolveSigmaField> =
        resolveSigmaField(column);
      expect(resolved.kind).not.toBe("attribute");
      expect((resolved as { column: string }).column).toBe(column);
      // "names are case-insensitive"
      expect(
        (resolveSigmaField(column.toUpperCase()) as { column: string }).column,
      ).toBe(column);
    }
  });

  test("the three columns the guide calls lists are list columns", () => {
    for (const column of ["observables", "mitreTactics", "mitreTechniques"]) {
      expect(resolveSigmaField(column).kind).toBe("arrayColumn");
    }
  });

  test("any other name is an attribute key, spelled exactly — an attributes. prefix is NOT stripped", () => {
    expect(resolveSigmaField("threat.matched")).toEqual({
      kind: "attribute",
      attributeKey: "threat.matched",
    });
    expect(resolveSigmaField("metadata.product.name")).toEqual({
      kind: "attribute",
      attributeKey: "metadata.product.name",
    });
    // The prefix would look up a key that does not exist.
    expect(resolveSigmaField("attributes.threat.matched")).toEqual({
      kind: "attribute",
      attributeKey: "attributes.threat.matched",
    });

    const writing: string = sectionMarkdown(
      DetectionRulesGuide,
      "writing-rules",
    );
    expect(writing).toContain("Do not add an `attributes.` prefix");
  });
});

describe("Detection Rules guide: evaluation", () => {
  test.each(THRESHOLD_CASES)(
    "worked example %s uses real columns and a legal threshold",
    (_goal: string, example: DetectionThresholdExample) => {
      for (const field of [example.groupByField, example.distinctCountField]) {
        if (field) {
          expect(resolveSigmaField(field).kind).not.toBe("attribute");
        }
      }

      expect(example.threshold).toBeGreaterThanOrEqual(
        DETECTION_MATCH_COUNT_THRESHOLD_MIN,
      );
      expect(example.threshold).toBeLessThanOrEqual(
        DETECTION_MATCH_COUNT_THRESHOLD_MAX,
      );
    },
  );

  test("distinct counting skips 0 in number columns, as the guide says of targetPort", () => {
    expect(buildSigmaDistinctCountExpression("targetPort").query).toContain(
      "nullIf(targetPort, 0)",
    );
  });

  test("Group By accepts the same names as the rule itself", () => {
    expect(buildSigmaFieldExpression("SourceIp").query).toBe("principalIp");
    expect(buildSigmaFieldExpression("threat.feed").query).toContain(
      "attributes[",
    );
  });

  test("states the interval bounds, the lookback cap, the group cap and the threshold range", () => {
    const evaluation: string = sectionMarkdown(
      DetectionRulesGuide,
      "evaluation",
    );

    expect(evaluation).toContain(
      `from ${DETECTION_EVALUATION_INTERVAL_MIN_IN_MINUTES} to ${DETECTION_EVALUATION_INTERVAL_MAX_IN_MINUTES}`,
    );
    expect(evaluation).toContain(
      `last ${DETECTION_MAX_LOOKBACK_IN_MINUTES / 60} hours`,
    );
    expect(evaluation).toContain(
      `At most ${DETECTION_MAX_GROUPS_PER_EVALUATION} groups`,
    );
    expect(evaluation).toContain(`\`${DETECTION_MATCH_COUNT_THRESHOLD_MIN}\``);
    expect(evaluation).toContain(
      DETECTION_MATCH_COUNT_THRESHOLD_MAX.toLocaleString("en-US"),
    );
  });

  test("the schedule step on the card states the interval bounds", () => {
    expect(DetectionRulesGuide.steps[1]?.description).toContain(
      `${DETECTION_EVALUATION_INTERVAL_MIN_IN_MINUTES}–${DETECTION_EVALUATION_INTERVAL_MAX_IN_MINUTES} minutes`,
    );
  });
});

describe("Detection Rules guide: severity levels", () => {
  test("the card lists every Sigma level, in order, with the severity findings get", () => {
    expect(
      DetectionRulesGuide.levels.items.map((item: SecurityEventsGuideLevel) => {
        return item.label;
      }),
    ).toEqual(SIGMA_LEVELS_IN_ORDER);

    for (const item of DetectionRulesGuide.levels.items) {
      expect(item.severity).toBe(
        SIGMA_LEVEL_TO_OCSF_SEVERITY[item.label as SigmaLevel],
      );
    }

    expect(Object.values(SigmaLevel).sort()).toEqual(
      [...SIGMA_LEVELS_IN_ORDER].sort(),
    );
  });

  test("the finding severity table matches the engine's mapping", () => {
    const levels: string = sectionMarkdown(
      DetectionRulesGuide,
      "severity-levels",
    );

    for (const level of SIGMA_LEVELS_IN_ORDER) {
      expect(levels).toContain(
        `| \`${level}\` | ${SIGMA_LEVEL_TO_OCSF_SEVERITY[level]} |`,
      );
    }
  });

  test("the rank fallback splits the levels exactly where the engine does", () => {
    const levels: string = sectionMarkdown(
      DetectionRulesGuide,
      "severity-levels",
    );

    expect(levels).toContain(
      "Otherwise `high` and `critical` rules use your **most severe** alert severity",
    );
    expect(levels).toContain(
      "`informational`, `low` and `medium` rules your **least severe**",
    );

    for (const level of SIGMA_LEVELS_IN_ORDER) {
      expect(isSevereSigmaLevel(level)).toBe(
        level === SigmaLevel.High || level === SigmaLevel.Critical,
      );
    }
  });

  test("the documented precedence is the one the alerting code applies", () => {
    type Severity = { id: ObjectID; name: string };

    const mostSevere: Severity = {
      id: new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
      name: "P1",
    };
    const named: Severity = {
      id: new ObjectID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
      name: "HIGH",
    };
    const leastSevere: Severity = {
      id: new ObjectID("cccccccc-cccc-4ccc-8ccc-cccccccccccc"),
      name: "P4",
    };
    const severities: Array<Severity> = [mostSevere, named, leastSevere];

    // 1. The rule's own severity wins over a name match.
    expect(
      pickSeverityByPrecedence({
        severities,
        explicitSeverityId: leastSevere.id,
        severityLabel: SigmaLevel.High,
        isSevere: true,
      })?.toString(),
    ).toBe(leastSevere.id.toString());

    // 2. A severity named after the level, ignoring case.
    expect(
      pickSeverityByPrecedence({
        severities,
        explicitSeverityId: undefined,
        severityLabel: SigmaLevel.High,
        isSevere: isSevereSigmaLevel(SigmaLevel.High),
      })?.toString(),
    ).toBe(named.id.toString());

    // 3. By rank.
    for (const level of SIGMA_LEVELS_IN_ORDER.filter(
      (candidate: SigmaLevel) => {
        return candidate !== SigmaLevel.High;
      },
    )) {
      const expected: Severity = isSevereSigmaLevel(level)
        ? mostSevere
        : leastSevere;

      expect(
        pickSeverityByPrecedence({
          severities,
          explicitSeverityId: undefined,
          severityLabel: level,
          isSevere: isSevereSigmaLevel(level),
        })?.toString(),
      ).toBe(expected.id.toString());
    }
  });
});

describe("Detection Rules guide: alerts and findings", () => {
  test("names every attribute a finding carries, and its class and product", () => {
    const findings: string = sectionMarkdown(
      DetectionRulesGuide,
      "alerts-and-findings",
    );

    for (const attribute of [
      DETECTION_RULE_ID_ATTRIBUTE,
      DETECTION_RULE_NAME_ATTRIBUTE,
      DETECTION_MATCH_COUNT_ATTRIBUTE,
      DETECTION_DISTINCT_COUNT_ATTRIBUTE,
      DETECTION_GROUP_VALUE_ATTRIBUTE,
      DETECTION_SIGMA_ID_ATTRIBUTE,
    ]) {
      expect(findings).toContain(`\`${attribute}\``);
    }

    expect(findings).toContain(`\`${DETECTION_FINDING_CLASS_NAME}\``);
    expect(findings).toContain(`OCSF ${DETECTION_FINDING_CLASS_UID}`);
    expect(findings).toContain("`OneUptime Detections`");
  });

  test("the alert title format matches the engine's", () => {
    const findings: string = sectionMarkdown(
      DetectionRulesGuide,
      "alerts-and-findings",
    );

    expect(findings).toContain("`[Detection] <rule name> — <group value>`");
    expect(findings).toContain("`[Detection] <rule name>`");
  });

  test("no longer tells anyone to prefix attribute keys with attributes.", () => {
    expect(guideToMarkdown(DetectionRulesGuide)).not.toContain(
      "`attributes.<key>`",
    );
  });
});

describe("Threat Intel guide: threat levels", () => {
  test("the confidence bands tile 1–100 with no gap or overlap", () => {
    const covered: Array<number> = [];

    for (const band of THREAT_LEVEL_BANDS) {
      expect(band.minimumConfidence).toBeLessThanOrEqual(
        band.maximumConfidence,
      );

      for (
        let confidence: number = band.minimumConfidence;
        confidence <= band.maximumConfidence;
        confidence++
      ) {
        covered.push(confidence);
      }
    }

    covered.sort((a: number, b: number) => {
      return a - b;
    });

    const expected: Array<number> = [];
    for (let confidence: number = 1; confidence <= 100; confidence++) {
      expected.push(confidence);
    }

    expect(covered).toEqual(expected);
  });

  test.each(BAND_CASES)(
    "every confidence in %s maps to the band's threat level",
    (_label: string, band: ThreatLevelBand) => {
      const level: OcsfSeverity = threatLevelForBand(band);

      for (
        let confidence: number = band.minimumConfidence;
        confidence <= band.maximumConfidence;
        confidence++
      ) {
        expect(ocsfSeverityForConfidence(confidence)).toBe(level);
      }
    },
  );

  test("adjacent bands are different levels, so no band could be merged away", () => {
    for (let index: number = 1; index < THREAT_LEVEL_BANDS.length; index++) {
      expect(threatLevelForBand(THREAT_LEVEL_BANDS[index]!)).not.toBe(
        threatLevelForBand(THREAT_LEVEL_BANDS[index - 1]!),
      );
    }
  });

  test("the bands read Critical, High, Medium, Low from the top", () => {
    expect(THREAT_LEVEL_BANDS.map(threatLevelForBand)).toEqual([
      OcsfSeverity.Critical,
      OcsfSeverity.High,
      OcsfSeverity.Medium,
      OcsfSeverity.Low,
    ]);
  });

  test("unscored — 0 or missing — reads as the level the card shows", () => {
    const unscored: SecurityEventsGuideLevel | undefined =
      ThreatIntelGuide.levels.items[ThreatIntelGuide.levels.items.length - 1];

    expect(unscored?.label).toBe("Not scored");
    expect(ocsfSeverityForConfidence(UNSCORED_CONFIDENCE)).toBe(
      unscored?.severity,
    );
    expect(ocsfSeverityForConfidence(Number.NaN)).toBe(unscored?.severity);
    expect(unscored?.severity).toBe(OcsfSeverity.Medium);
  });

  test("the card lists one chip per band plus unscored", () => {
    expect(ThreatIntelGuide.levels.items).toHaveLength(
      THREAT_LEVEL_BANDS.length + 1,
    );

    THREAT_LEVEL_BANDS.forEach((band: ThreatLevelBand, index: number) => {
      expect(ThreatIntelGuide.levels.items[index]).toEqual({
        label: `Confidence ${formatBand(band)}`,
        severity: threatLevelForBand(band),
      });
    });
  });

  test("the Threat Levels tab tabulates every band", () => {
    const levels: string = sectionMarkdown(ThreatIntelGuide, "threat-levels");

    for (const band of THREAT_LEVEL_BANDS) {
      expect(levels).toContain(
        `| ${formatBand(band)} | ${threatLevelForBand(band)} |`,
      );
    }

    expect(levels).toContain(
      `| Not scored (${UNSCORED_CONFIDENCE} or missing) | ${OcsfSeverity.Medium} |`,
    );
  });

  test("a Minimum Confidence of 70 keeps only High and Critical, as the example says", () => {
    for (let confidence: number = 1; confidence <= 100; confidence++) {
      const level: OcsfSeverity = ocsfSeverityForConfidence(confidence);
      const isHighOrCritical: boolean =
        level === OcsfSeverity.High || level === OcsfSeverity.Critical;

      expect(isHighOrCritical).toBe(confidence >= 70);
    }

    expect(sectionMarkdown(ThreatIntelGuide, "threat-levels")).toContain(
      "a minimum of 70 keeps only High and Critical",
    );
  });
});

describe("Threat Intel guide: indicators", () => {
  test("documents every indicator type the parser can produce", () => {
    expect(Object.keys(INDICATOR_TYPE_DOCS).sort()).toEqual(
      Object.values(ThreatIntelIndicatorType).sort(),
    );
  });

  test.each(Object.values(ThreatIntelIndicatorType))(
    "the %s example pattern parses to exactly that type",
    (type: ThreatIntelIndicatorType) => {
      const parsed: Array<ParsedIndicatorValue> | null =
        StixPatternParser.parse(INDICATOR_TYPE_DOCS[type].examplePattern);

      expect(parsed).not.toBeNull();
      expect(parsed).toHaveLength(1);
      expect(parsed![0]!.type).toBe(type);
      // "Values are stored in lowercase"
      expect(parsed![0]!.value).toBe(parsed![0]!.value.toLowerCase());
    },
  );

  test.each(SUPPORTED_COMBINED_PATTERN_EXAMPLES)(
    "the OR example %s is supported and yields both values",
    (pattern: string) => {
      expect(StixPatternParser.parse(pattern)).toHaveLength(2);
    },
  );

  test.each(UNSUPPORTED_PATTERN_EXAMPLES)(
    "the unsupported example %s is skipped whole",
    (pattern: string) => {
      expect(StixPatternParser.parse(pattern)).toBeNull();
    },
  );

  test("the Indicators tab shows every example and the default validity", () => {
    const indicators: string = sectionMarkdown(ThreatIntelGuide, "indicators");

    for (const type of Object.values(ThreatIntelIndicatorType)) {
      expect(indicators).toContain(INDICATOR_TYPE_DOCS[type].examplePattern);
      expect(indicators).toContain(`\`${type}\``);
    }

    for (const pattern of SUPPORTED_COMBINED_PATTERN_EXAMPLES) {
      expect(indicators).toContain(pattern);
    }

    expect(indicators).toContain(`${THREAT_INTEL_DEFAULT_VALID_DAYS} days`);
    expect(indicators).toContain(`\`${THREAT_INTEL_MINIMUM_CONFIDENCE_MIN}\``);
  });
});

describe("Threat Intel guide: enrichment and matching", () => {
  test("the detection rule sample compiles and reads threat.* as attributes", () => {
    const rule: SigmaRule = SigmaRuleParser.parse(
      THREAT_INTEL_SIGMA_EXAMPLE_YAML,
    );

    expect(rule.level).toBe(SigmaLevel.Critical);
    expect(resolveSigmaField(ENRICHMENT_MATCHED_ATTRIBUTE).kind).toBe(
      "attribute",
    );
    expect(resolveSigmaField(ENRICHMENT_CONFIDENCE_ATTRIBUTE).kind).toBe(
      "attribute",
    );

    const statement: Statement = SigmaClickhouseCompiler.compile(rule);

    expect(statement.query).toContain("toFloat64OrNull(attributes[");
    expect(paramValues(statement)).toEqual(
      expect.arrayContaining([
        ENRICHMENT_MATCHED_ATTRIBUTE,
        ENRICHMENT_CONFIDENCE_ATTRIBUTE,
      ]),
    );
  });

  test("names every attribute stamped at ingest", () => {
    const enrichment: string = sectionMarkdown(
      ThreatIntelGuide,
      "enrichment-and-matching",
    );

    for (const attribute of [
      ENRICHMENT_MATCHED_ATTRIBUTE,
      ENRICHMENT_INDICATOR_ID_ATTRIBUTE,
      ENRICHMENT_INDICATOR_TYPE_ATTRIBUTE,
      ENRICHMENT_INDICATOR_VALUE_ATTRIBUTE,
      ENRICHMENT_FEED_ATTRIBUTE,
      ENRICHMENT_FEED_ID_ATTRIBUTE,
      ENRICHMENT_CONFIDENCE_ATTRIBUTE,
      ENRICHMENT_MATCH_COUNT_ATTRIBUTE,
    ]) {
      expect(enrichment).toContain(`\`${attribute}\``);
    }
  });

  test("names every attribute a Threat Intel finding carries, and its class and product", () => {
    const enrichment: string = sectionMarkdown(
      ThreatIntelGuide,
      "enrichment-and-matching",
    );

    for (const attribute of [
      THREAT_FEED_ID_ATTRIBUTE,
      THREAT_FEED_NAME_ATTRIBUTE,
      THREAT_INDICATOR_ID_ATTRIBUTE,
      THREAT_INDICATOR_TYPE_ATTRIBUTE,
      THREAT_INDICATOR_VALUE_ATTRIBUTE,
      THREAT_CONFIDENCE_ATTRIBUTE,
      THREAT_MATCH_COUNT_ATTRIBUTE,
    ]) {
      expect(enrichment).toContain(`\`${attribute}\``);
    }

    expect(enrichment).toContain(`\`${DETECTION_FINDING_CLASS_NAME}\``);
    expect(enrichment).toContain(`OCSF ${DETECTION_FINDING_CLASS_UID}`);
    expect(enrichment).toContain(`\`${THREAT_INTEL_PRODUCT_NAME}\``);
    expect(enrichment).toContain(
      "`[Threat Intel] <feed name> — <indicator value>`",
    );
  });

  test("states the matcher's first window, lookback cap and per-check cap", () => {
    const enrichment: string = sectionMarkdown(
      ThreatIntelGuide,
      "enrichment-and-matching",
    );

    expect(enrichment).toContain(
      `last ${THREAT_INTEL_FIRST_MATCH_WINDOW_IN_MINUTES} minutes`,
    );
    expect(enrichment).toContain(
      `last ${THREAT_INTEL_MATCH_MAX_LOOKBACK_IN_MINUTES / 60} hours`,
    );
    expect(enrichment).toContain(
      `at most ${THREAT_INTEL_MAX_INDICATORS_PER_EVALUATION} indicator values`,
    );
  });
});

describe("Threat Intel guide: feeds and polling", () => {
  test("states the poll interval bounds and default", () => {
    const feeds: string = sectionMarkdown(
      ThreatIntelGuide,
      "feeds-and-polling",
    );

    expect(feeds).toContain(
      `${THREAT_INTEL_POLL_INTERVAL_MIN_IN_MINUTES}–${THREAT_INTEL_POLL_INTERVAL_MAX_IN_MINUTES}, default ${THREAT_INTEL_DEFAULT_POLL_INTERVAL_IN_MINUTES}`,
    );
    expect(feeds).toContain(
      `${THREAT_INTEL_MINIMUM_CONFIDENCE_MIN}–${THREAT_INTEL_MINIMUM_CONFIDENCE_MAX}`,
    );
  });

  test("the polling step on the card states the same bounds and default", () => {
    expect(ThreatIntelGuide.steps[0]?.description).toContain(
      `${THREAT_INTEL_POLL_INTERVAL_MIN_IN_MINUTES}–${THREAT_INTEL_POLL_INTERVAL_MAX_IN_MINUTES} minutes (default ${THREAT_INTEL_DEFAULT_POLL_INTERVAL_IN_MINUTES})`,
    );
  });
});
