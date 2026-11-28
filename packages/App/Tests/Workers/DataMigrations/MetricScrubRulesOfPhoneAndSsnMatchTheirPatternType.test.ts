import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import MetricPipelineRule from "Common/Models/DatabaseModels/MetricPipelineRule";
import DatabaseService from "Common/Server/Services/DatabaseService";
import MetricPipelineRuleService from "Common/Server/Services/MetricPipelineRuleService";
import {
  buildMetricScrubFilters,
  buildScrubPatternForDataType,
  CoveringScrubRule,
  findCoveringScrubRule,
  toCoveringMetricRule,
} from "Common/Server/Utils/DataSecurity/Telemetry/TelemetryScrubCoverage";
import logger from "Common/Server/Utils/Logger";
import MetricPipelineEngine, {
  MutableMetricRow,
} from "Common/Server/Utils/Telemetry/MetricPipelineEngine";
import { DataStoreKind } from "Common/Types/DataSecurity/DataStoreKind";
import FilterCondition from "Common/Types/Filter/FilterCondition";
import { JSONObject } from "Common/Types/JSON";
import MetricPipelineRuleFilterCondition, {
  MetricPipelineRuleFilterCheckOn,
  MetricPipelineRuleFilterConditionType,
} from "Common/Types/Metrics/MetricPipelineRuleFilterCondition";
import MetricPipelineRuleType from "Common/Types/Metrics/MetricPipelineRuleType";
import ObjectID from "Common/Types/ObjectID";
import MetricScrubRulesMatchTheirPatternType, {
  FROZEN_SCRUB_IT_PATTERNS,
  FrozenScrubItPattern,
  PAGE_SIZE,
} from "../../../FeatureSet/Workers/DataMigrations/MetricScrubRulesMatchTheirPatternType";
import MetricScrubRulesOfPhoneAndSsnMatchTheirPatternType, {
  FROZEN_PHONE_AND_SSN_SCRUB_IT_PATTERNS,
} from "../../../FeatureSet/Workers/DataMigrations/MetricScrubRulesOfPhoneAndSsnMatchTheirPatternType";
import fs from "fs";
import path from "path";

/*
 * MetricScrubRulesOfPhoneAndSsnMatchTheirPatternType (#11112): the metric
 * rules Scrub It made for a phone number or a US Social Security number
 * told the values they hide by the type's detectors' shapes, frozen into a
 * Matches Regex filter - which validated nothing and read no value encoded,
 * in another script's digits, typed in fullwidth or beside the word that
 * names it. The migration moves each such filter to the Matches Pattern
 * Type filter Scrub It makes now, and nothing else: pinned here are the two
 * spellings of the phone pattern and the SSN one, which filters move, that
 * a second run moves none, that a rule saved since it was read is left,
 * that one that cannot be written holds no other back, and that a moved
 * rule covers its finding again and hides what the frozen pattern left.
 */
jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

const DATA_MIGRATIONS_DIR: string = path.join(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

const SERVICE_ID: string = "0193b0a1-0000-7000-8000-000000011112";

const mockedLogger: { error: jest.Mock; info: jest.Mock } =
  logger as unknown as { error: jest.Mock; info: jest.Mock };

interface StoredRule {
  _id: string;
  ruleType: string;
  addAttributeKey: string | null;
  filters: unknown;
}

interface Statement {
  sql: string;
  parameters: Array<unknown>;
}

interface StubbedTable {
  rows: Array<StoredRule>;
  statements: Array<Statement>;
  failUpdatesFor: Set<string>;
  // Saved by someone else between the migration's read and its write.
  changeBeforeUpdate: Set<string>;
}

function sameJSON(a: unknown, b: unknown): boolean {
  const parsed: (value: unknown) => unknown = (value: unknown): unknown => {
    return typeof value === "string" ? JSON.parse(value) : value;
  };

  return JSON.stringify(parsed(a)) === JSON.stringify(parsed(b));
}

/*
 * Answers the migration's SELECT from `rows` as Postgres would - the rule
 * type it asks for, filters whose text matches its LIKE, paged by id - and
 * its UPDATE only while the row holds what the statement read.
 */
function stubTable(): StubbedTable {
  const table: StubbedTable = {
    rows: [],
    statements: [],
    failUpdatesFor: new Set<string>(),
    changeBeforeUpdate: new Set<string>(),
  };

  const query: jest.Mock = jest.fn(
    async (sql: unknown, parameters: unknown): Promise<unknown> => {
      const statement: Statement = {
        sql: String(sql),
        parameters: (parameters as Array<unknown>) || [],
      };
      table.statements.push(statement);

      if (statement.sql.startsWith("SELECT")) {
        const limit: number = statement.parameters[0] as number;
        const ruleType: string = statement.parameters[1] as string;
        const like: string = statement.parameters[2] as string;
        const after: string | undefined = statement.parameters[3] as
          | string
          | undefined;
        const contains: string = like.slice(1, -1);

        return table.rows
          .filter((row: StoredRule) => {
            const text: string =
              typeof row.filters === "string"
                ? row.filters
                : JSON.stringify(row.filters);

            return (
              row.filters !== null &&
              row.ruleType === ruleType &&
              text.includes(contains) &&
              (!after || row._id > after)
            );
          })
          .sort((a: StoredRule, b: StoredRule) => {
            return a._id < b._id ? -1 : 1;
          })
          .slice(0, limit)
          .map((row: StoredRule) => {
            return {
              _id: row._id,
              addAttributeKey: row.addAttributeKey,
              filters: row.filters,
            };
          });
      }

      const id: string = statement.parameters[1] as string;

      if (table.failUpdatesFor.has(id)) {
        throw new Error("could not write");
      }

      const row: StoredRule | undefined = table.rows.find(
        (candidate: StoredRule) => {
          return candidate._id === id;
        },
      );

      if (row && table.changeBeforeUpdate.has(id)) {
        row.filters = [];
      }

      const holdsWhatWasRead: boolean =
        Boolean(row) && sameJSON(row!.filters, statement.parameters[2]);

      if (holdsWhatWasRead) {
        row!.filters = JSON.parse(statement.parameters[0] as string);
      }

      const written: Array<{ _id: string }> = holdsWhatWasRead
        ? [{ _id: id }]
        : [];

      return [written, written.length];
    },
  ) as unknown as jest.Mock;

  jest
    .spyOn(
      MetricPipelineRuleService as unknown as DatabaseService<BaseModel>,
      "getRepository",
    )
    .mockReturnValue({
      metadata: { tableName: "MetricPipelineRule" },
      manager: { query },
    } as never);

  return table;
}

function updatesOf(table: StubbedTable): Array<Statement> {
  return table.statements.filter((statement: Statement) => {
    return statement.sql.startsWith("UPDATE");
  });
}

// The phone pattern Scrub It wrote until #11030, the one it wrote since, and the SSN one.
const [OLD_PHONE, PHONE, SSN] = FROZEN_PHONE_AND_SSN_SCRUB_IT_PATTERNS.map(
  (entry: FrozenScrubItPattern): string => {
    return entry.pattern;
  },
) as [string, string, string];

// A filter on an attribute's value, as Scrub It and the migration write them.
function attributeFilter(
  attributeKey: string,
  conditionType: MetricPipelineRuleFilterConditionType,
  value: string,
): MetricPipelineRuleFilterCondition {
  return {
    checkOn: MetricPipelineRuleFilterCheckOn.Attribute,
    attributeKey,
    conditionType,
    value,
  };
}

function frozenFilter(
  attributeKey: string,
  pattern: string,
): MetricPipelineRuleFilterCondition {
  return attributeFilter(
    attributeKey,
    MetricPipelineRuleFilterConditionType.MatchesRegex,
    pattern,
  );
}

function patternTypeFilter(
  attributeKey: string,
  patternType: string,
): MetricPipelineRuleFilterCondition {
  return attributeFilter(
    attributeKey,
    MetricPipelineRuleFilterConditionType.MatchesPatternType,
    patternType,
  );
}

function redactRule(
  id: string,
  attributeKey: string,
  filters: unknown,
  ruleType: string = MetricPipelineRuleType.RedactAttribute,
): StoredRule {
  return { _id: id, ruleType, addAttributeKey: attributeKey, filters };
}

function rowOf(table: StubbedTable, id: string): StoredRule {
  return table.rows.find((row: StoredRule) => {
    return row._id === id;
  })!;
}

describe("MetricScrubRulesOfPhoneAndSsnMatchTheirPatternType", () => {
  const migration: MetricScrubRulesOfPhoneAndSsnMatchTheirPatternType =
    new MetricScrubRulesOfPhoneAndSsnMatchTheirPatternType();
  let table: StubbedTable;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    table = stubTable();
  });

  test("is a migration of its own, by its own name", () => {
    expect(migration.name).toBe(
      "MetricScrubRulesOfPhoneAndSsnMatchTheirPatternType",
    );
    expect(new MetricScrubRulesMatchTheirPatternType().name).toBe(
      "MetricScrubRulesMatchTheirPatternType",
    );
  });

  test("its frozen patterns are the very ones Scrub It wrote: today's, and the phone one before #11030 added the no-break space", () => {
    // The phone and SSN patterns the types' detectors that need no word make today.
    expect(PHONE).toBe(buildScrubPatternForDataType("phone-number"));
    expect(SSN).toBe(buildScrubPatternForDataType("us-ssn"));
    // Until #11030 an international number's groups were set apart without one.
    expect(PHONE).toContain("[0-9 \\u00A0().-]");
    expect(OLD_PHONE).toBe(PHONE.replace("[0-9 \\u00A0().-]", "[0-9 ().-]"));
    expect(
      FROZEN_PHONE_AND_SSN_SCRUB_IT_PATTERNS.map(
        (entry: FrozenScrubItPattern): [string, string] => {
          return [entry.dataTypeId, entry.patternType];
        },
      ),
    ).toEqual([
      ["phone-number", "phoneNumber"],
      ["phone-number", "phoneNumber"],
      ["us-ssn", "ssn"],
    ]);
  });

  test("moves each frozen pattern to the filter Scrub It makes now", () => {
    for (const entry of FROZEN_PHONE_AND_SSN_SCRUB_IT_PATTERNS) {
      expect(
        MetricScrubRulesMatchTheirPatternType.moveFilters(
          [frozenFilter("caller", entry.pattern)],
          "caller",
          FROZEN_PHONE_AND_SSN_SCRUB_IT_PATTERNS,
        ),
      ).toEqual(buildMetricScrubFilters(entry.dataTypeId, "caller"));
    }
  });

  test("moves the rules Scrub It made for a phone number, before and since #11030, and for a Social Security number", async () => {
    table.rows.push(
      redactRule("a1", "caller", [frozenFilter("caller", OLD_PHONE)]),
      redactRule("a2", "sms.to", [frozenFilter("sms.to", PHONE)]),
      redactRule("a3", "customer.ssn", [frozenFilter("customer.ssn", SSN)]),
    );

    await migration.migrate();

    expect(rowOf(table, "a1").filters).toEqual([
      patternTypeFilter("caller", "phoneNumber"),
    ]);
    expect(rowOf(table, "a2").filters).toEqual([
      patternTypeFilter("sms.to", "phoneNumber"),
    ]);
    expect(rowOf(table, "a3").filters).toEqual([
      patternTypeFilter("customer.ssn", "ssn"),
    ]);
    expect(updatesOf(table)).toHaveLength(3);
    expect(mockedLogger.info).toHaveBeenCalledWith(
      expect.stringContaining(
        "MetricScrubRulesOfPhoneAndSsnMatchTheirPatternType: 3 metric rule(s)",
      ),
    );
  });

  test("leaves every filter that is not Scrub It's frozen phone or SSN pattern, and every other rule", async () => {
    const kept: Array<StoredRule> = [
      // The three types the earlier migration moved: theirs to move, and moved already.
      redactRule("b1", "peer", [
        frozenFilter(
          "peer",
          FROZEN_SCRUB_IT_PATTERNS.find(
            (entry: FrozenScrubItPattern): boolean => {
              return entry.dataTypeId === "ip-address";
            },
          )!.pattern,
        ),
      ]),
      // A pattern a person wrote.
      redactRule("b2", "caller", [frozenFilter("caller", "^\\+44")]),
      // The frozen pattern on another attribute than the one redacted.
      redactRule("b3", "caller", [frozenFilter("region", PHONE)]),
      // A Drop rule (Drop This Metric keeps its pattern), and a Remove rule.
      redactRule(
        "b4",
        "caller",
        [frozenFilter("caller", PHONE)],
        MetricPipelineRuleType.Drop,
      ),
      redactRule(
        "b5",
        "caller",
        [frozenFilter("caller", SSN)],
        MetricPipelineRuleType.RemoveAttribute,
      ),
      // The frozen pattern under another condition, or on the metric's name.
      redactRule("b6", "caller", [
        attributeFilter(
          "caller",
          MetricPipelineRuleFilterConditionType.DoesNotMatchRegex,
          PHONE,
        ),
      ]),
      redactRule("b7", "caller", [
        {
          checkOn: MetricPipelineRuleFilterCheckOn.MetricName,
          conditionType: MetricPipelineRuleFilterConditionType.MatchesRegex,
          value: OLD_PHONE,
        },
      ]),
      // A rule with no attribute, and no filter at all.
      redactRule("b8", "", [frozenFilter("", PHONE)]),
      redactRule("b9", "caller", []),
      // A pattern a character off, and one that moved already.
      redactRule("b10", "caller", [frozenFilter("caller", `${SSN} `)]),
      redactRule("b11", "caller", [patternTypeFilter("caller", "phoneNumber")]),
    ];
    const before: string = JSON.stringify(kept);

    table.rows.push(...(JSON.parse(before) as Array<StoredRule>));

    await migration.migrate();

    expect(JSON.stringify(table.rows)).toBe(before);
    expect(updatesOf(table)).toEqual([]);
  });

  test("the earlier migration leaves the phone and SSN patterns, and this one the three types'", async () => {
    table.rows.push(
      redactRule("c1", "caller", [frozenFilter("caller", PHONE)]),
      redactRule("c2", "customer.ssn", [frozenFilter("customer.ssn", SSN)]),
    );

    await new MetricScrubRulesMatchTheirPatternType().migrate();

    expect(updatesOf(table)).toEqual([]);

    for (const entry of FROZEN_SCRUB_IT_PATTERNS) {
      expect(
        MetricScrubRulesMatchTheirPatternType.moveFilters(
          [frozenFilter("x", entry.pattern)],
          "x",
          FROZEN_PHONE_AND_SSN_SCRUB_IT_PATTERNS,
        ),
      ).toBeNull();
    }
  });

  test("moves the frozen filter of a rule that holds others, and leaves the others as they are", async () => {
    const region: MetricPipelineRuleFilterCondition = attributeFilter(
      "region",
      MetricPipelineRuleFilterConditionType.EqualTo,
      "eu",
    );

    table.rows.push(
      redactRule("d1", "caller", [region, frozenFilter("caller", PHONE)]),
    );

    await migration.migrate();

    expect(rowOf(table, "d1").filters).toEqual([
      region,
      patternTypeFilter("caller", "phoneNumber"),
    ]);
  });

  test("reads filters stored as JSON text too, and a key written with spaces around it", async () => {
    table.rows.push(
      redactRule(
        "e1",
        " customer.ssn ",
        JSON.stringify([frozenFilter("customer.ssn", SSN)]),
      ),
    );

    await migration.migrate();

    expect(rowOf(table, "e1").filters).toEqual([
      patternTypeFilter("customer.ssn", "ssn"),
    ]);
  });

  test("a second run moves nothing", async () => {
    table.rows.push(
      redactRule("f1", "caller", [frozenFilter("caller", OLD_PHONE)]),
    );

    await migration.migrate();
    const writes: number = updatesOf(table).length;

    await migration.migrate();

    expect(writes).toBe(1);
    expect(updatesOf(table)).toHaveLength(1);
  });

  test("leaves a rule saved again since it was read", async () => {
    table.rows.push(
      redactRule("g1", "caller", [frozenFilter("caller", PHONE)]),
    );
    table.changeBeforeUpdate.add("g1");

    await migration.migrate();

    expect(rowOf(table, "g1").filters).toEqual([]);
    expect(mockedLogger.info).toHaveBeenCalledWith(
      expect.stringContaining("0 metric rule(s)"),
    );
  });

  test("one rule that cannot be written holds no other back", async () => {
    table.rows.push(
      redactRule("h1", "caller", [frozenFilter("caller", PHONE)]),
      redactRule("h2", "customer.ssn", [frozenFilter("customer.ssn", SSN)]),
    );
    table.failUpdatesFor.add("h1");

    await migration.migrate();

    expect(rowOf(table, "h2").filters).toEqual([
      patternTypeFilter("customer.ssn", "ssn"),
    ]);
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("could not move rule h1"),
    );
    expect(mockedLogger.info).toHaveBeenCalledWith(
      expect.stringContaining("1 could not be written"),
    );
  });

  test("reads every page of rules", async () => {
    for (let index: number = 0; index <= PAGE_SIZE; index++) {
      table.rows.push(
        redactRule(`i${String(index).padStart(4, "0")}`, "caller", [
          frozenFilter("caller", index % 2 === 0 ? PHONE : OLD_PHONE),
        ]),
      );
    }

    await migration.migrate();

    expect(updatesOf(table)).toHaveLength(PAGE_SIZE + 1);
    expect(
      table.rows.every((row: StoredRule): boolean => {
        return (
          (row.filters as Array<MetricPipelineRuleFilterCondition>)[0]!
            .conditionType ===
          MetricPipelineRuleFilterConditionType.MatchesPatternType
        );
      }),
    ).toBe(true);
  });

  /*
   * A rule moved covers its finding again - coverage compares its filters
   * with Scrub It's exactly - and hides, from its next batch, what the
   * frozen pattern left: a number typed in fullwidth, beside its word, and
   * keeps what it took for one: a decimal, an area no one is issued.
   */
  test.each([
    [
      "phone-number",
      "caller",
      PHONE,
      ["＋８１ ３－１２３４－５６７８", "tel 02012345678", "+44 20 7946 0958"],
      ["+51.507217", "UTC +1 2026-11-24"],
    ],
    [
      "phone-number",
      "caller",
      OLD_PHONE,
      ["+33 6 12 34 56 78", "+٤٤ ٢٠ ٧٩٤٦ ٠٩٥٨"],
      ["+51.507217"],
    ],
    [
      "us-ssn",
      "customer.ssn",
      SSN,
      ["５３６－２２－８７３１", "SSN 536221234", "536.22.8731"],
      ["666.22.8731", "ref 536221234"],
    ],
  ] as Array<[string, string, string, Array<string>, Array<string>]>)(
    "a %s rule on %s moved covers its finding again, and hides what Data Security finds",
    async (
      dataTypeId: string,
      key: string,
      pattern: string,
      hidden: Array<string>,
      kept: Array<string>,
    ) => {
      table.rows.push(redactRule("j1", key, [frozenFilter(key, pattern)]));

      const rule: (filters: unknown) => MetricPipelineRule = (
        filters: unknown,
      ): MetricPipelineRule => {
        const made: MetricPipelineRule = new MetricPipelineRule();

        made._id = "0193b0a1-0000-7000-8000-0000000000j1";
        made.serviceId = new ObjectID(SERVICE_ID);
        made.ruleType = MetricPipelineRuleType.RedactAttribute;
        made.addAttributeKey = key;
        made.redactReplacement = "[REDACTED]";
        made.filterCondition = FilterCondition.All;
        made.filters = filters as Array<MetricPipelineRuleFilterCondition>;

        return made;
      };
      const finding: {
        kind: DataStoreKind;
        dataTypeId: string;
        location: string;
        serviceId: string;
      } = {
        kind: DataStoreKind.TelemetryMetrics,
        dataTypeId,
        location: `attributes.${key}`,
        serviceId: SERVICE_ID,
      };
      const leftOf: (made: MetricPipelineRule, value: string) => unknown = (
        made: MetricPipelineRule,
        value: string,
      ): unknown => {
        const row: MutableMetricRow | null = MetricPipelineEngine.applyRules(
          { name: "sms.sent", attributes: { [key]: value } },
          [made],
          [],
        );

        return (row!.attributes as JSONObject)[key];
      };

      const frozen: MetricPipelineRule = rule(rowOf(table, "j1").filters);
      const coveringBefore: CoveringScrubRule | null = findCoveringScrubRule(
        { rules: [toCoveringMetricRule(frozen)!] },
        finding,
      );

      // Since Scrub It makes the pattern type's filter, the frozen one no longer covers.
      expect(coveringBefore).toBeNull();

      await migration.migrate();

      const moved: MetricPipelineRule = rule(rowOf(table, "j1").filters);

      expect(
        findCoveringScrubRule(
          { rules: [toCoveringMetricRule(moved)!] },
          finding,
        ),
      ).not.toBeNull();

      for (const value of hidden) {
        expect([value, leftOf(moved, value)]).toEqual([value, "[REDACTED]"]);
      }

      for (const value of kept) {
        expect([value, leftOf(moved, value)]).toEqual([value, value]);
      }
    },
  );

  test("is imported and instantiated in DataMigrations/Index.ts once, after the earlier one and before the two slots kept last", () => {
    const indexSource: string = fs.readFileSync(
      path.join(DATA_MIGRATIONS_DIR, "Index.ts"),
      "utf8",
    );
    const instantiations: Array<string> = Array.from(
      indexSource.matchAll(/new\s+(\w+)\(\)/g),
    ).map((match: RegExpMatchArray) => {
      return match[1]!;
    });

    expect(indexSource).toContain(
      'import MetricScrubRulesOfPhoneAndSsnMatchTheirPatternType from "./MetricScrubRulesOfPhoneAndSsnMatchTheirPatternType";',
    );
    expect(
      instantiations.filter((name: string): boolean => {
        return name === "MetricScrubRulesOfPhoneAndSsnMatchTheirPatternType";
      }),
    ).toHaveLength(1);
    expect(
      instantiations.indexOf(
        "MetricScrubRulesOfPhoneAndSsnMatchTheirPatternType",
      ),
    ).toBeGreaterThan(
      instantiations.indexOf("MetricScrubRulesMatchTheirPatternType"),
    );
    expect(
      instantiations.indexOf(
        "MetricScrubRulesOfPhoneAndSsnMatchTheirPatternType",
      ),
    ).toBeLessThan(instantiations.length - 2);
  });

  test("rollback changes nothing", async () => {
    await migration.rollback();

    expect(table.statements).toEqual([]);
  });
});
