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
  PAGE_SIZE,
} from "../../../FeatureSet/Workers/DataMigrations/MetricScrubRulesMatchTheirPatternType";
import fs from "fs";
import path from "path";

/*
 * MetricScrubRulesMatchTheirPatternType (#10934): the metric rules Scrub It
 * made for an IP address, an email address or a card number told the
 * values they hide by the type's pattern, frozen into a Matches Regex
 * filter - IPv4 alone for an IP address, and the value as written for all
 * three. The migration moves each such filter to the Matches Pattern Type
 * filter Scrub It makes now, and nothing else: pinned here are which
 * filters move, that a second run moves none, that a rule saved since it
 * was read is left, that one that cannot be written holds no other back,
 * and that a moved rule covers its finding and hides an IPv6 address.
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

const SERVICE_ID: string = "0193b0a1-0000-7000-8000-000000a10934";

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

function frozenOf(dataTypeId: string): string {
  return FROZEN_SCRUB_IT_PATTERNS.find((entry: { dataTypeId: string }) => {
    return entry.dataTypeId === dataTypeId;
  })!.pattern;
}

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
  dataTypeId: string,
): MetricPipelineRuleFilterCondition {
  return attributeFilter(
    attributeKey,
    MetricPipelineRuleFilterConditionType.MatchesRegex,
    frozenOf(dataTypeId),
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

describe("MetricScrubRulesMatchTheirPatternType", () => {
  const migration: MetricScrubRulesMatchTheirPatternType =
    new MetricScrubRulesMatchTheirPatternType();
  let table: StubbedTable;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    table = stubTable();
  });

  test("its frozen patterns are the very ones Scrub It wrote, and it moves each to the filter Scrub It makes now", () => {
    for (const entry of FROZEN_SCRUB_IT_PATTERNS) {
      expect([
        entry.dataTypeId,
        buildScrubPatternForDataType(entry.dataTypeId),
      ]).toEqual([entry.dataTypeId, entry.pattern]);
      expect(
        MetricScrubRulesMatchTheirPatternType.moveFilters(
          [frozenFilter("peer", entry.dataTypeId)],
          "peer",
        ),
      ).toEqual(buildMetricScrubFilters(entry.dataTypeId, "peer"));
    }
  });

  test("moves the rules Scrub It made for an IP address, an email address and a card", async () => {
    table.rows.push(
      redactRule("a1", "peer", [frozenFilter("peer", "ip-address")]),
      redactRule("a2", "user.email", [
        frozenFilter("user.email", "email-address"),
      ]),
      redactRule("a3", "payment.card", [
        frozenFilter("payment.card", "credit-card-number"),
      ]),
    );

    await migration.migrate();

    expect(rowOf(table, "a1").filters).toEqual([
      attributeFilter(
        "peer",
        MetricPipelineRuleFilterConditionType.MatchesPatternType,
        "ipAddress",
      ),
    ]);
    expect(rowOf(table, "a2").filters).toEqual([
      attributeFilter(
        "user.email",
        MetricPipelineRuleFilterConditionType.MatchesPatternType,
        "email",
      ),
    ]);
    expect(rowOf(table, "a3").filters).toEqual([
      attributeFilter(
        "payment.card",
        MetricPipelineRuleFilterConditionType.MatchesPatternType,
        "creditCard",
      ),
    ]);
    expect(updatesOf(table)).toHaveLength(3);
    expect(mockedLogger.info).toHaveBeenCalledWith(
      expect.stringContaining("3 metric rule(s)"),
    );
  });

  test("leaves every filter that is not Scrub It's frozen pattern of one of the three, and every other rule", async () => {
    const kept: Array<StoredRule> = [
      // Another type's frozen pattern: its pattern type finds less.
      redactRule("b1", "caller", [
        attributeFilter(
          "caller",
          MetricPipelineRuleFilterConditionType.MatchesRegex,
          buildScrubPatternForDataType("phone-number")!,
        ),
      ]),
      // A pattern a person wrote.
      redactRule("b2", "user.email", [
        attributeFilter(
          "user.email",
          MetricPipelineRuleFilterConditionType.MatchesRegex,
          "@acmecorp\\.io$",
        ),
      ]),
      // The frozen pattern on another attribute than the one redacted.
      redactRule("b3", "peer", [frozenFilter("region", "ip-address")]),
      // A Drop rule (Drop This Metric keeps its pattern), and a Remove rule.
      redactRule(
        "b4",
        "peer",
        [frozenFilter("peer", "ip-address")],
        MetricPipelineRuleType.Drop,
      ),
      redactRule(
        "b5",
        "peer",
        [frozenFilter("peer", "ip-address")],
        MetricPipelineRuleType.RemoveAttribute,
      ),
      // The frozen pattern under another condition, or on the metric's name.
      redactRule("b6", "peer", [
        attributeFilter(
          "peer",
          MetricPipelineRuleFilterConditionType.DoesNotMatchRegex,
          frozenOf("ip-address"),
        ),
      ]),
      redactRule("b7", "peer", [
        {
          checkOn: MetricPipelineRuleFilterCheckOn.MetricName,
          conditionType: MetricPipelineRuleFilterConditionType.MatchesRegex,
          value: frozenOf("ip-address"),
        },
      ]),
      // A rule with no attribute, and no filter at all.
      redactRule("b8", "", [frozenFilter("", "ip-address")]),
      redactRule("b9", "peer", []),
      // The pattern a character off.
      redactRule("b10", "peer", [
        attributeFilter(
          "peer",
          MetricPipelineRuleFilterConditionType.MatchesRegex,
          frozenOf("ip-address") + " ",
        ),
      ]),
    ];
    const before: string = JSON.stringify(kept);

    table.rows.push(...(JSON.parse(before) as Array<StoredRule>));

    await migration.migrate();

    expect(JSON.stringify(table.rows)).toBe(before);
    expect(updatesOf(table)).toEqual([]);
  });

  test("moves the frozen filter of a rule that holds others, and leaves the others as they are", async () => {
    const region: MetricPipelineRuleFilterCondition = attributeFilter(
      "region",
      MetricPipelineRuleFilterConditionType.EqualTo,
      "eu",
    );

    table.rows.push(
      redactRule("c1", "peer", [region, frozenFilter("peer", "ip-address")]),
    );

    await migration.migrate();

    expect(rowOf(table, "c1").filters).toEqual([
      region,
      attributeFilter(
        "peer",
        MetricPipelineRuleFilterConditionType.MatchesPatternType,
        "ipAddress",
      ),
    ]);
  });

  test("reads filters stored as JSON text too, and a key written with spaces around it", async () => {
    table.rows.push(
      redactRule(
        "d1",
        " peer ",
        JSON.stringify([frozenFilter("peer", "ip-address")]),
      ),
    );

    await migration.migrate();

    expect(rowOf(table, "d1").filters).toEqual([
      attributeFilter(
        "peer",
        MetricPipelineRuleFilterConditionType.MatchesPatternType,
        "ipAddress",
      ),
    ]);
  });

  test("a second run moves nothing", async () => {
    table.rows.push(
      redactRule("e1", "peer", [frozenFilter("peer", "ip-address")]),
    );

    await migration.migrate();
    const writes: number = updatesOf(table).length;

    await migration.migrate();

    expect(writes).toBe(1);
    expect(updatesOf(table)).toHaveLength(1);
  });

  test("leaves a rule saved again since it was read", async () => {
    table.rows.push(
      redactRule("f1", "peer", [frozenFilter("peer", "ip-address")]),
    );
    table.changeBeforeUpdate.add("f1");

    await migration.migrate();

    expect(rowOf(table, "f1").filters).toEqual([]);
    expect(mockedLogger.info).toHaveBeenCalledWith(
      expect.stringContaining("0 metric rule(s)"),
    );
  });

  test("one rule that cannot be written holds no other back", async () => {
    table.rows.push(
      redactRule("g1", "peer", [frozenFilter("peer", "ip-address")]),
      redactRule("g2", "user.email", [
        frozenFilter("user.email", "email-address"),
      ]),
    );
    table.failUpdatesFor.add("g1");

    await migration.migrate();

    expect(rowOf(table, "g2").filters).toEqual([
      attributeFilter(
        "user.email",
        MetricPipelineRuleFilterConditionType.MatchesPatternType,
        "email",
      ),
    ]);
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("could not move rule g1"),
    );
    expect(mockedLogger.info).toHaveBeenCalledWith(
      expect.stringContaining("1 could not be written"),
    );
  });

  test("reads every page of rules", async () => {
    for (let index: number = 0; index <= PAGE_SIZE; index++) {
      table.rows.push(
        redactRule(`h${String(index).padStart(4, "0")}`, "peer", [
          frozenFilter("peer", "ip-address"),
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

  test("a rule moved covers its finding again, and hides an IPv6 address the frozen pattern left", async () => {
    table.rows.push(
      redactRule("i1", "peer", [frozenFilter("peer", "ip-address")]),
    );

    const rule: (filters: unknown) => MetricPipelineRule = (
      filters: unknown,
    ): MetricPipelineRule => {
      const made: MetricPipelineRule = new MetricPipelineRule();

      made._id = "0193b0a1-0000-7000-8000-0000000000i1";
      made.serviceId = new ObjectID(SERVICE_ID);
      made.ruleType = MetricPipelineRuleType.RedactAttribute;
      made.addAttributeKey = "peer";
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
      dataTypeId: "ip-address",
      location: "attributes.peer",
      serviceId: SERVICE_ID,
    };
    const leftOf: (made: MetricPipelineRule, value: string) => unknown = (
      made: MetricPipelineRule,
      value: string,
    ): unknown => {
      const row: MutableMetricRow | null = MetricPipelineEngine.applyRules(
        { name: "http.server.duration", attributes: { peer: value } },
        [made],
        [],
      );

      return (row!.attributes as JSONObject)["peer"];
    };

    const frozen: MetricPipelineRule = rule(rowOf(table, "i1").filters);
    const coveringBefore: CoveringScrubRule | null = findCoveringScrubRule(
      { rules: [toCoveringMetricRule(frozen)!] },
      finding,
    );

    expect(coveringBefore).toBeNull();
    expect(leftOf(frozen, "2a00:1450:4001:82a::200e")).toBe(
      "2a00:1450:4001:82a::200e",
    );

    await migration.migrate();

    const moved: MetricPipelineRule = rule(rowOf(table, "i1").filters);

    expect(
      findCoveringScrubRule({ rules: [toCoveringMetricRule(moved)!] }, finding),
    ).not.toBeNull();
    expect(leftOf(moved, "2a00:1450:4001:82a::200e")).toBe("[REDACTED]");
    expect(leftOf(moved, "81.2.69.160")).toBe("[REDACTED]");
    // No one's address: kept, as an IP Address log or trace rule keeps it.
    expect(leftOf(moved, "10.0.0.12")).toBe("10.0.0.12");
  });

  test("is imported and instantiated in DataMigrations/Index.ts once, before the two slots kept last", () => {
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
      'import MetricScrubRulesMatchTheirPatternType from "./MetricScrubRulesMatchTheirPatternType";',
    );
    expect(
      instantiations.filter((name: string): boolean => {
        return name === "MetricScrubRulesMatchTheirPatternType";
      }),
    ).toHaveLength(1);
    expect(
      instantiations.indexOf("MetricScrubRulesMatchTheirPatternType"),
    ).toBeLessThan(instantiations.length - 2);
  });

  test("rollback changes nothing", async () => {
    await migration.rollback();

    expect(table.statements).toEqual([]);
  });
});
