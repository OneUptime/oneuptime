import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import DatabaseService from "Common/Server/Services/DatabaseService";
import LogScrubRuleService from "Common/Server/Services/LogScrubRuleService";
import MetricPipelineRuleService from "Common/Server/Services/MetricPipelineRuleService";
import TraceScrubRuleService from "Common/Server/Services/TraceScrubRuleService";
import {
  buildMetricScrubFilters,
  buildScrubPatternForDataType,
  CoveringScrubRule,
  findCoveringScrubRule,
} from "Common/Server/Utils/DataSecurity/Telemetry/TelemetryScrubCoverage";
import logger from "Common/Server/Utils/Logger";
import { compileScrubRule } from "Common/Server/Utils/Telemetry/ScrubEngine/CompiledScrubRule";
import LogScrubEngine from "Common/Server/Utils/Telemetry/ScrubEngine/LogScrubEngine";
import { DataStoreKind } from "Common/Types/DataSecurity/DataStoreKind";
import { JSONObject } from "Common/Types/JSON";
import LogScrubAction from "Common/Types/Log/LogScrubAction";
import LogScrubField from "Common/Types/Log/LogScrubField";
import LogScrubPatternType from "Common/Types/Log/LogScrubPatternType";
import MetricPipelineRuleFilterCondition, {
  MetricPipelineRuleFilterCheckOn,
  MetricPipelineRuleFilterConditionType,
} from "Common/Types/Metrics/MetricPipelineRuleFilterCondition";
import MetricPipelineRuleType from "Common/Types/Metrics/MetricPipelineRuleType";
import ObjectID from "Common/Types/ObjectID";
import { DATA_TYPE_OF_SCRUB_PATTERN_TYPE } from "Common/Types/Telemetry/ScrubRule";
import TraceScrubPatternType from "Common/Types/Trace/TraceScrubPatternType";
import MetricScrubRulesMatchTheirPatternType, {
  FrozenScrubItPattern,
} from "../../../FeatureSet/Workers/DataMigrations/MetricScrubRulesMatchTheirPatternType";
import ScrubRulesOfPostalCodesAndCoordinatesUseTheirPatternType, {
  FROZEN_POSTAL_CODE_AND_COORDINATE_SCRUB_IT_PATTERNS,
} from "../../../FeatureSet/Workers/DataMigrations/ScrubRulesOfPostalCodesAndCoordinatesUseTheirPatternType";
import fs from "fs";
import path from "path";

/*
 * ScrubRulesOfPostalCodesAndCoordinatesUseTheirPatternType (#11502): the
 * rules Scrub It made for a postal code or a precise location were a Custom
 * Regex of the type's detectors that need no word - a UK and a Canadian
 * postcode, a coordinate pair - which kept a US ZIP code beside "zip" and
 * a lone coordinate under `location.lat` while coverage counted them. Scrub
 * It now makes Postal Code and Coordinates rules, and the migration moves
 * each rule it made before to them: a log or trace rule whose pattern is
 * exactly the frozen one becomes a rule of its pattern type, every other
 * column as it was, and a metric rule's filter of it a Matches Pattern
 * Type filter. Pinned here: the frozen patterns are the very ones Scrub It
 * wrote, which rules move and which are left, that a second run moves
 * none, and that a rule moved covers its finding and hides what the
 * frozen pattern kept. Postgres is a stub that answers the migration's
 * statements as Postgres would.
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

const PROJECT_ID: string = "0193b0a1-0000-7000-8000-000000011502";
const SERVICE_ID: string = "0193b0a1-0000-7000-8000-000000011503";

const mockedLogger: { error: jest.Mock; info: jest.Mock } =
  logger as unknown as { error: jest.Mock; info: jest.Mock };

const [POSTAL_CODE, COORDINATES] =
  FROZEN_POSTAL_CODE_AND_COORDINATE_SCRUB_IT_PATTERNS.map(
    (entry: FrozenScrubItPattern): string => {
      return entry.pattern;
    },
  ) as [string, string];

// A log or trace scrub rule's row, as the table keeps it.
interface StoredScrubRule {
  _id: string;
  patternType: string;
  customRegex: string | null;
  scrubAction: string;
  fieldsToScrub: string;
  serviceId: string | null;
  attributeKeys: Array<string> | null;
}

// A metric rule's row, as the earlier migration reads it.
interface StoredMetricRule {
  _id: string;
  ruleType: string;
  addAttributeKey: string | null;
  filters: unknown;
}

interface Statement {
  table: string;
  sql: string;
  parameters: Array<unknown>;
}

interface StubbedTables {
  logRules: Array<StoredScrubRule>;
  traceRules: Array<StoredScrubRule>;
  metricRules: Array<StoredMetricRule>;
  statements: Array<Statement>;
}

/*
 * Answers an `UPDATE "<table>" SET "patternType" = $1, "customRegex" = NULL
 * WHERE "patternType" = $2 AND "customRegex" = $3 RETURNING "_id"` over
 * `rows` as Postgres would: [rows, rowCount].
 */
function scrubRuleTable(
  tableName: string,
  rows: () => Array<StoredScrubRule>,
  statements: Array<Statement>,
): { metadata: { tableName: string }; manager: { query: jest.Mock } } {
  return {
    metadata: { tableName },
    manager: {
      query: jest.fn(
        async (sql: unknown, parameters: unknown): Promise<unknown> => {
          const statement: Statement = {
            table: tableName,
            sql: String(sql),
            parameters: (parameters as Array<unknown>) || [],
          };
          statements.push(statement);

          const [patternType, wasType, wasRegex] = statement.parameters as [
            string,
            string,
            string,
          ];
          const written: Array<{ _id: string }> = [];

          for (const row of rows()) {
            if (row.patternType === wasType && row.customRegex === wasRegex) {
              row.patternType = patternType;
              row.customRegex = null;
              written.push({ _id: row._id });
            }
          }

          return [written, written.length];
        },
      ) as unknown as jest.Mock,
    },
  };
}

function stubTables(): StubbedTables {
  const tables: StubbedTables = {
    logRules: [],
    traceRules: [],
    metricRules: [],
    statements: [],
  };

  jest
    .spyOn(
      LogScrubRuleService as unknown as DatabaseService<BaseModel>,
      "getRepository",
    )
    .mockReturnValue(
      scrubRuleTable(
        "LogScrubRule",
        (): Array<StoredScrubRule> => {
          return tables.logRules;
        },
        tables.statements,
      ) as never,
    );
  jest
    .spyOn(
      TraceScrubRuleService as unknown as DatabaseService<BaseModel>,
      "getRepository",
    )
    .mockReturnValue(
      scrubRuleTable(
        "TraceScrubRule",
        (): Array<StoredScrubRule> => {
          return tables.traceRules;
        },
        tables.statements,
      ) as never,
    );

  // The metric rules, paged by id, as MetricScrubRulesMatchTheirPatternType reads and writes them.
  const metricQuery: jest.Mock = jest.fn(
    async (sql: unknown, parameters: unknown): Promise<unknown> => {
      const statement: Statement = {
        table: "MetricPipelineRule",
        sql: String(sql),
        parameters: (parameters as Array<unknown>) || [],
      };
      tables.statements.push(statement);

      if (statement.sql.startsWith("SELECT")) {
        const limit: number = statement.parameters[0] as number;
        const ruleType: string = statement.parameters[1] as string;
        const contains: string = (statement.parameters[2] as string).slice(
          1,
          -1,
        );
        const after: string | undefined = statement.parameters[3] as
          | string
          | undefined;

        return tables.metricRules
          .filter((row: StoredMetricRule): boolean => {
            return (
              row.ruleType === ruleType &&
              JSON.stringify(row.filters).includes(contains) &&
              (!after || row._id > after)
            );
          })
          .sort((a: StoredMetricRule, b: StoredMetricRule) => {
            return a._id < b._id ? -1 : 1;
          })
          .slice(0, limit)
          .map((row: StoredMetricRule) => {
            return {
              _id: row._id,
              addAttributeKey: row.addAttributeKey,
              filters: row.filters,
            };
          });
      }

      const id: string = statement.parameters[1] as string;
      const row: StoredMetricRule | undefined = tables.metricRules.find(
        (candidate: StoredMetricRule): boolean => {
          return candidate._id === id;
        },
      );

      if (
        row &&
        JSON.stringify(row.filters) ===
          JSON.stringify(JSON.parse(String(statement.parameters[2])))
      ) {
        row.filters = JSON.parse(statement.parameters[0] as string);
        return [[{ _id: id }], 1];
      }

      return [[], 0];
    },
  ) as unknown as jest.Mock;

  jest
    .spyOn(
      MetricPipelineRuleService as unknown as DatabaseService<BaseModel>,
      "getRepository",
    )
    .mockReturnValue({
      metadata: { tableName: "MetricPipelineRule" },
      manager: { query: metricQuery },
    } as never);

  return tables;
}

function scrubRule(
  id: string,
  patternType: string,
  customRegex: string | null,
  more: Partial<StoredScrubRule> = {},
): StoredScrubRule {
  return {
    _id: id,
    patternType,
    customRegex,
    scrubAction: LogScrubAction.Mask,
    fieldsToScrub: LogScrubField.Attributes,
    serviceId: SERVICE_ID,
    attributeKeys: null,
    ...more,
  };
}

function frozenMetricFilter(
  attributeKey: string,
  pattern: string,
): MetricPipelineRuleFilterCondition {
  return {
    checkOn: MetricPipelineRuleFilterCheckOn.Attribute,
    attributeKey,
    conditionType: MetricPipelineRuleFilterConditionType.MatchesRegex,
    value: pattern,
  };
}

function updatesOf(tables: StubbedTables, table: string): Array<Statement> {
  return tables.statements.filter((statement: Statement): boolean => {
    return statement.table === table && statement.sql.startsWith("UPDATE");
  });
}

describe("ScrubRulesOfPostalCodesAndCoordinatesUseTheirPatternType", () => {
  const migration: ScrubRulesOfPostalCodesAndCoordinatesUseTheirPatternType =
    new ScrubRulesOfPostalCodesAndCoordinatesUseTheirPatternType();
  let tables: StubbedTables;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    tables = stubTables();
  });

  test("is a migration of its own, by its own name", () => {
    expect(migration.name).toBe(
      "ScrubRulesOfPostalCodesAndCoordinatesUseTheirPatternType",
    );
  });

  test("its frozen patterns are the very ones Scrub It wrote, and each stands for its type's pattern type", () => {
    // The types' detectors that need no word, as Scrub It joined them.
    expect(POSTAL_CODE).toBe(buildScrubPatternForDataType("postal-code"));
    expect(COORDINATES).toBe(buildScrubPatternForDataType("geolocation"));
    expect(
      FROZEN_POSTAL_CODE_AND_COORDINATE_SCRUB_IT_PATTERNS.map(
        (entry: FrozenScrubItPattern): [string, string] => {
          return [entry.dataTypeId, entry.patternType];
        },
      ),
    ).toEqual([
      ["postal-code", "postalCode"],
      ["geolocation", "coordinates"],
    ]);

    for (const entry of FROZEN_POSTAL_CODE_AND_COORDINATE_SCRUB_IT_PATTERNS) {
      expect(DATA_TYPE_OF_SCRUB_PATTERN_TYPE[entry.patternType]).toBe(
        entry.dataTypeId,
      );
      // A trace rule takes the same pattern type.
      expect(Object.values(TraceScrubPatternType)).toContain(entry.patternType);
    }
  });

  test("moves each log and trace rule Scrub It made to its pattern type, every other column as it was", async () => {
    tables.logRules.push(
      scrubRule("l1", LogScrubPatternType.Custom, POSTAL_CODE, {
        attributeKeys: ["shipping.zip"],
      }),
      scrubRule("l2", LogScrubPatternType.Custom, COORDINATES, {
        scrubAction: LogScrubAction.Redact,
        fieldsToScrub: LogScrubField.Both,
        serviceId: null,
      }),
    );
    tables.traceRules.push(
      scrubRule("t1", LogScrubPatternType.Custom, COORDINATES),
    );

    await migration.migrate();

    expect(tables.logRules).toEqual([
      scrubRule("l1", LogScrubPatternType.PostalCode, null, {
        attributeKeys: ["shipping.zip"],
      }),
      scrubRule("l2", LogScrubPatternType.Coordinates, null, {
        scrubAction: LogScrubAction.Redact,
        fieldsToScrub: LogScrubField.Both,
        serviceId: null,
      }),
    ]);
    expect(tables.traceRules).toEqual([
      scrubRule("t1", TraceScrubPatternType.Coordinates, null),
    ]);
    expect(mockedLogger.info).toHaveBeenCalledWith(
      expect.stringContaining(
        "ScrubRulesOfPostalCodesAndCoordinatesUseTheirPatternType: 3 log or trace scrub rule(s)",
      ),
    );
  });

  test("asks Postgres for exactly that: the frozen pattern of a Custom Regex rule, by its parameters", async () => {
    await migration.migrate();

    const statements: Array<Statement> = [
      ...updatesOf(tables, "LogScrubRule"),
      ...updatesOf(tables, "TraceScrubRule"),
    ];

    expect(
      statements.map((statement: Statement): [string, Array<unknown>] => {
        return [statement.sql, statement.parameters];
      }),
    ).toEqual(
      ["LogScrubRule", "TraceScrubRule"].flatMap(
        (table: string): Array<[string, Array<unknown>]> => {
          return FROZEN_POSTAL_CODE_AND_COORDINATE_SCRUB_IT_PATTERNS.map(
            (entry: FrozenScrubItPattern): [string, Array<unknown>] => {
              return [
                `UPDATE "${table}" SET "patternType" = $1, "customRegex" = NULL WHERE "patternType" = $2 AND "customRegex" = $3 RETURNING "_id"`,
                [entry.patternType, LogScrubPatternType.Custom, entry.pattern],
              ];
            },
          );
        },
      ),
    );
  });

  test("leaves every rule that is not one Scrub It made of a frozen pattern", async () => {
    const kept: Array<StoredScrubRule> = [
      // A pattern a person wrote, and the frozen one a character off.
      scrubRule("k1", LogScrubPatternType.Custom, "[0-9]{5}"),
      scrubRule("k2", LogScrubPatternType.Custom, `${POSTAL_CODE} `),
      scrubRule("k3", LogScrubPatternType.Custom, COORDINATES.slice(1)),
      // The frozen pattern on a rule of another pattern type, which reads none.
      scrubRule("k4", LogScrubPatternType.Email, POSTAL_CODE),
      // Moved already, and the other built-in types.
      scrubRule("k5", LogScrubPatternType.PostalCode, null),
      scrubRule("k6", LogScrubPatternType.PhoneNumber, null),
      scrubRule("k7", LogScrubPatternType.SensitiveKeys, null),
      // Another type's frozen Scrub It pattern: an earlier migration's, or none's.
      scrubRule(
        "k8",
        LogScrubPatternType.Custom,
        buildScrubPatternForDataType("us-itin"),
      ),
    ];
    const before: string = JSON.stringify(kept);

    tables.logRules.push(...(JSON.parse(before) as Array<StoredScrubRule>));
    tables.traceRules.push(...(JSON.parse(before) as Array<StoredScrubRule>));

    await migration.migrate();

    expect(JSON.stringify(tables.logRules)).toBe(before);
    expect(JSON.stringify(tables.traceRules)).toBe(before);
    expect(mockedLogger.info).toHaveBeenCalledWith(
      expect.stringContaining(": 0 log or trace scrub rule(s)"),
    );
  });

  test("moves a metric rule's filter of a frozen pattern to the Matches Pattern Type filter Scrub It makes now", async () => {
    tables.metricRules.push(
      {
        _id: "m1",
        ruleType: MetricPipelineRuleType.RedactAttribute,
        addAttributeKey: "shipping.zip",
        filters: [frozenMetricFilter("shipping.zip", POSTAL_CODE)],
      },
      {
        _id: "m2",
        ruleType: MetricPipelineRuleType.RedactAttribute,
        addAttributeKey: "device.lat",
        filters: [frozenMetricFilter("device.lat", COORDINATES)],
      },
      // A Drop rule keeps its pattern, as Drop This Metric makes it.
      {
        _id: "m3",
        ruleType: MetricPipelineRuleType.Drop,
        addAttributeKey: "shipping.zip",
        filters: [frozenMetricFilter("shipping.zip", POSTAL_CODE)],
      },
    );

    await migration.migrate();

    expect(tables.metricRules[0]!.filters).toEqual(
      buildMetricScrubFilters("postal-code", "shipping.zip"),
    );
    expect(tables.metricRules[1]!.filters).toEqual(
      buildMetricScrubFilters("geolocation", "device.lat"),
    );
    expect(tables.metricRules[0]!.filters).toEqual([
      {
        checkOn: MetricPipelineRuleFilterCheckOn.Attribute,
        attributeKey: "shipping.zip",
        conditionType: MetricPipelineRuleFilterConditionType.MatchesPatternType,
        value: "postalCode",
      },
    ]);
    expect(tables.metricRules[2]!.filters).toEqual([
      frozenMetricFilter("shipping.zip", POSTAL_CODE),
    ]);
    // Moved by the code of the migration it extends, word for word.
    expect(
      MetricScrubRulesMatchTheirPatternType.moveFilters(
        [frozenMetricFilter("x", COORDINATES)],
        "x",
        FROZEN_POSTAL_CODE_AND_COORDINATE_SCRUB_IT_PATTERNS,
      ),
    ).toEqual(buildMetricScrubFilters("geolocation", "x"));
  });

  test("a second run moves nothing", async () => {
    tables.logRules.push(
      scrubRule("s1", LogScrubPatternType.Custom, POSTAL_CODE),
    );

    await migration.migrate();

    expect(tables.logRules[0]!.patternType).toBe(
      LogScrubPatternType.PostalCode,
    );

    jest.clearAllMocks();
    await migration.migrate();

    expect(tables.logRules[0]!.patternType).toBe(
      LogScrubPatternType.PostalCode,
    );
    expect(mockedLogger.info).toHaveBeenCalledWith(
      expect.stringContaining(": 0 log or trace scrub rule(s)"),
    );
  });

  test("counts what a driver answers either way: rows and their count, or the rows alone", async () => {
    const answers: Array<unknown> = [
      [[{ _id: "a" }, { _id: "b" }], 2],
      [{ _id: "c" }],
      [],
      "not rows",
    ];
    let next: number = 0;

    expect(
      await ScrubRulesOfPostalCodesAndCoordinatesUseTheirPatternType.moveLogAndTraceRules(
        [
          {
            metadata: { tableName: "LogScrubRule" },
            manager: {
              query: async (): Promise<unknown> => {
                return answers[next++];
              },
            },
          },
          {
            metadata: { tableName: "TraceScrubRule" },
            manager: {
              query: async (): Promise<unknown> => {
                return answers[next++];
              },
            },
          },
        ],
      ),
    ).toBe(3);
  });

  /*
   * A rule moved covers its finding again - one found beside its word or
   * under its key, which the frozen pattern's rule no longer covers - and
   * hides, from its next batch, what the frozen pattern kept: a ZIP code
   * beside "zip" or under `shipping.zip`, a lone coordinate under
   * `device.lat`. It hides the postcodes and pairs it did.
   */
  test.each([
    [
      "postal-code",
      POSTAL_CODE,
      // What the frozen pattern kept, and the moved rule hides.
      {
        "shipping.zip": ["94107", "[REDACTED]"],
        note: ["ship to zip 94107", "ship to zip [REDACTED]"],
      },
      // What both hide.
      { uk: ["SW1A 2AA", "[REDACTED]"] },
      // What both keep.
      { order: "94107", note2: "order 94107" },
    ],
    [
      "geolocation",
      COORDINATES,
      {
        "device.lat": ["37.77493", "[REDACTED]"],
        note: ["lat 37.77493", "lat [REDACTED]"],
      },
      { pair: ["51.50722, -0.12750", "[REDACTED]"] },
      { price: "37.77493", note2: "total 37.77493" },
    ],
  ] as Array<
    [
      string,
      string,
      Record<string, [string, string]>,
      Record<string, [string, string]>,
      JSONObject,
    ]
  >)(
    "a %s rule moved covers its finding found by context, and hides what Data Security finds",
    async (
      dataTypeId: string,
      pattern: string,
      newlyHidden: Record<string, [string, string]>,
      bothHide: Record<string, [string, string]>,
      kept: JSONObject,
    ) => {
      const hidden: JSONObject = {};

      for (const [key, [value]] of Object.entries({
        ...newlyHidden,
        ...bothHide,
      })) {
        hidden[key] = value;
      }

      tables.logRules.push(
        scrubRule("c1", LogScrubPatternType.Custom, pattern, {
          scrubAction: LogScrubAction.Redact,
          fieldsToScrub: LogScrubField.Both,
        }),
      );

      const covering: (row: StoredScrubRule) => CoveringScrubRule = (
        row: StoredScrubRule,
      ): CoveringScrubRule => {
        return {
          id: row._id,
          name: "Data Security rule",
          signal: "log",
          patternType: row.patternType,
          customRegex: row.customRegex || undefined,
          fieldsToScrub: row.fieldsToScrub,
          serviceId: row.serviceId || undefined,
        } as CoveringScrubRule;
      };
      const finding: {
        kind: DataStoreKind;
        dataTypeId: string;
        location: string;
        serviceId: string;
        isFoundByContext: boolean;
        isFoundByModel: boolean;
      } = {
        kind: DataStoreKind.TelemetryLogs,
        dataTypeId,
        location: "body",
        serviceId: SERVICE_ID,
        isFoundByContext: true,
        isFoundByModel: false,
      };
      const leftOf: (row: StoredScrubRule) => JSONObject = (
        row: StoredScrubRule,
      ): JSONObject => {
        const rule: LogScrubRule = new LogScrubRule(
          new ObjectID("0193b0a1-0000-7000-8000-0000000000c1"),
        );

        rule.projectId = new ObjectID(PROJECT_ID);
        rule.patternType = row.patternType;
        rule.scrubAction = row.scrubAction;
        rule.fieldsToScrub = row.fieldsToScrub;

        if (row.customRegex) {
          rule.customRegex = row.customRegex;
        }

        return LogScrubEngine.scrubLog(
          { body: "", attributes: { ...hidden, ...kept } },
          [compileScrubRule(rule)!],
          null,
          { countValues: false },
        )["attributes"] as JSONObject;
      };

      const before: StoredScrubRule = { ...tables.logRules[0]! };

      // Scrub It's frozen pattern keeps what was found beside its word: no longer counted.
      expect(
        findCoveringScrubRule({ rules: [covering(before)] }, finding),
      ).toBeNull();

      const leftBefore: JSONObject = leftOf(before);

      await migration.migrate();

      const moved: StoredScrubRule = tables.logRules[0]!;

      expect(
        findCoveringScrubRule({ rules: [covering(moved)] }, finding),
      ).not.toBeNull();

      const leftAfter: JSONObject = leftOf(moved);

      for (const [key, [value, left]] of Object.entries(newlyHidden)) {
        expect([key, leftAfter[key]]).toEqual([key, left]);
        // The gap: the frozen pattern kept it.
        expect([key, leftBefore[key]]).toEqual([key, value]);
      }

      for (const [key, [, left]] of Object.entries(bothHide)) {
        expect([key, leftAfter[key]]).toEqual([key, left]);
        expect([key, leftBefore[key]]).toEqual([key, left]);
      }

      for (const [key, value] of Object.entries(kept)) {
        expect([key, leftAfter[key]]).toEqual([key, value]);
        // As the frozen pattern did.
        expect([key, leftBefore[key]]).toEqual([key, value]);
      }
    },
  );

  test("is imported and instantiated in DataMigrations/Index.ts once, after the metric migrations it extends and before the two slots kept last", () => {
    const indexSource: string = fs.readFileSync(
      path.join(DATA_MIGRATIONS_DIR, "Index.ts"),
      "utf8",
    );
    const instantiations: Array<string> = Array.from(
      indexSource.matchAll(/new\s+(\w+)\(\)/g),
    ).map((match: RegExpMatchArray) => {
      return match[1]!;
    });
    const at: number = instantiations.indexOf(
      "ScrubRulesOfPostalCodesAndCoordinatesUseTheirPatternType",
    );

    expect(indexSource).toContain(
      'import ScrubRulesOfPostalCodesAndCoordinatesUseTheirPatternType from "./ScrubRulesOfPostalCodesAndCoordinatesUseTheirPatternType";',
    );
    expect(
      instantiations.filter((name: string): boolean => {
        return (
          name === "ScrubRulesOfPostalCodesAndCoordinatesUseTheirPatternType"
        );
      }),
    ).toHaveLength(1);
    expect(at).toBeGreaterThan(
      instantiations.indexOf("MetricScrubRulesMatchTheirPatternType"),
    );
    expect(at).toBeGreaterThan(
      instantiations.indexOf(
        "MetricScrubRulesOfPhoneAndSsnMatchTheirPatternType",
      ),
    );
    expect(at).toBeLessThan(instantiations.length - 2);
  });

  test("rollback changes nothing", async () => {
    await migration.rollback();

    expect(tables.statements).toEqual([]);
  });
});
