import DataMigrationBase from "./DataMigrationBase";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "Common/Server/Services/DatabaseService";
import MetricPipelineRuleService from "Common/Server/Services/MetricPipelineRuleService";
import logger from "Common/Server/Utils/Logger";
import LogScrubPatternType from "Common/Types/Log/LogScrubPatternType";
import MetricPipelineRuleFilterCondition, {
  MetricPipelineRuleFilterCheckOn,
  MetricPipelineRuleFilterConditionType,
} from "Common/Types/Metrics/MetricPipelineRuleFilterCondition";
import MetricPipelineRuleType from "Common/Types/Metrics/MetricPipelineRuleType";

/*
 * THE METRIC RULES SCRUB IT MADE FOR AN IP ADDRESS, AN EMAIL ADDRESS OR A
 * CARD NUMBER, MOVED TO THE PATTERN TYPE THAT HIDES WHAT DATA SECURITY
 * FINDS (#10934).
 *
 * Scrub It on a metric attribute made a Redact Attribute rule whose filter
 * was the data type's own pattern, frozen into the rule as a Matches Regex
 * filter on the attribute. For an IP address that pattern held IPv4 alone
 * (IPv6's detector did not fit beside it), and for all three it read a
 * value as written: so every IPv6 address stayed in the label, and an
 * address percent-encoded, an email address in another script, a card in
 * another script's digits or written in groups, while the finding said it
 * was hidden.
 *
 * Scrub It now gives such a rule a Matches Pattern Type filter
 * (TelemetryScrubCoverage.METRIC_PATTERN_TYPE_OF_DATA_TYPE), which reads
 * the type when a value is read rather than a pattern frozen when the rule
 * was made, so a rule follows the detectors as they change. Each rule made
 * before gets the same: its filter that is exactly the frozen pattern
 * Scrub It wrote for the type, on the attribute the rule redacts, becomes
 * that filter. A data migration, rather than reading the frozen pattern as
 * the type at ingest, so that what a rule's form shows is what ingest runs,
 * and no pattern is read as anything but itself. Coverage compares a rule's
 * filters with Scrub It's exactly, so each rule moved covers its findings
 * again.
 *
 * Only Scrub It's rules: a Redact Attribute rule, a filter on the very
 * attribute it redacts, holding one of these patterns word for word -
 * patterns no person writes. A filter a person wrote, another type's
 * pattern, a Drop rule (Drop This Metric keeps its pattern) and every other
 * filter of the rule are left as they are. A rule moved hides IPv6 and
 * encoded addresses from its next batch on, and stops redacting private,
 * loopback and link-local addresses - no one's personal data - as an IP
 * Address log or trace rule keeps them.
 *
 * Postgres only. Safe to run twice, and two at once: a moved filter is no
 * longer the frozen pattern, and a rule saved again since it was read is
 * not written over.
 */

// A frozen pattern Scrub It wrote into a metric rule, word for word, and the pattern type it stands for.
export interface FrozenScrubItPattern {
  dataTypeId: string;
  pattern: string;
  patternType: string;
}

// Each frozen pattern Scrub It wrote for the three types this migration moves.
export const FROZEN_SCRUB_IT_PATTERNS: ReadonlyArray<FrozenScrubItPattern> = [
  {
    dataTypeId: "ip-address",
    pattern:
      "(?<![0-9.])(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])(?:\\.(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])){3}(?![0-9]|\\.[0-9])",
    patternType: LogScrubPatternType.IPAddress,
  },
  {
    dataTypeId: "email-address",
    pattern:
      "(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\\.[A-Za-z]{2,24}(?![A-Za-z0-9-])",
    patternType: LogScrubPatternType.Email,
  },
  {
    dataTypeId: "credit-card-number",
    pattern: "(?<![0-9])[0-9]{12,19}(?![0-9])",
    patternType: LogScrubPatternType.CreditCard,
  },
];

// How many rules are read at a time.
export const PAGE_SIZE: number = 500;

interface RuleRow {
  _id: string;
  addAttributeKey: string | null;
  filters: unknown;
}

// The rows an `UPDATE ... RETURNING` touched, however the driver shapes them.
function countWrittenRows(result: unknown): number {
  if (!Array.isArray(result)) {
    return 0;
  }

  // pg returns [rows, rowCount] for UPDATE ... RETURNING through TypeORM.
  if (
    result.length === 2 &&
    Array.isArray(result[0]) &&
    typeof result[1] === "number"
  ) {
    return result[1];
  }

  return result.length;
}

export default class MetricScrubRulesMatchTheirPatternType extends DataMigrationBase {
  // The frozen patterns this migration moves, each to its pattern type.
  private readonly frozenPatterns: ReadonlyArray<FrozenScrubItPattern>;

  /*
   * Another migration moves other frozen patterns the same way, under its
   * own name (MetricScrubRulesOfPhoneAndSsnMatchTheirPatternType, #11112):
   * this one's name and patterns are the three types', as they always were.
   */
  public constructor(
    name: string = "MetricScrubRulesMatchTheirPatternType",
    frozenPatterns: ReadonlyArray<FrozenScrubItPattern> = FROZEN_SCRUB_IT_PATTERNS,
  ) {
    super(name);
    this.frozenPatterns = frozenPatterns;
  }

  /*
   * A rule's filters with each frozen pattern Scrub It wrote on the
   * attribute it redacts as the pattern type it stands for, or null when
   * none is.
   */
  public static moveFilters(
    filters: unknown,
    attributeKey: string | null | undefined,
    frozenPatterns: ReadonlyArray<FrozenScrubItPattern> = FROZEN_SCRUB_IT_PATTERNS,
  ): Array<MetricPipelineRuleFilterCondition> | null {
    const key: string = (attributeKey || "").trim();

    if (!Array.isArray(filters) || !key) {
      return null;
    }

    let moved: boolean = false;
    const next: Array<MetricPipelineRuleFilterCondition> = filters.map(
      (filter: unknown): MetricPipelineRuleFilterCondition => {
        const condition: MetricPipelineRuleFilterCondition =
          filter as MetricPipelineRuleFilterCondition;
        const frozen: { patternType: string } | undefined =
          condition &&
          typeof condition === "object" &&
          condition.checkOn === MetricPipelineRuleFilterCheckOn.Attribute &&
          (condition.attributeKey || "").trim() === key &&
          condition.conditionType ===
            MetricPipelineRuleFilterConditionType.MatchesRegex
            ? frozenPatterns.find((entry: { pattern: string }): boolean => {
                return entry.pattern === condition.value;
              })
            : undefined;

        if (!frozen) {
          return condition;
        }

        moved = true;

        return {
          checkOn: MetricPipelineRuleFilterCheckOn.Attribute,
          attributeKey: condition.attributeKey,
          conditionType:
            MetricPipelineRuleFilterConditionType.MatchesPatternType,
          value: frozen.patternType,
        };
      },
    );

    return moved ? next : null;
  }

  // A stored filters column, read: JSON as Postgres hands it back, or its text.
  private static readFilters(value: unknown): unknown {
    if (typeof value !== "string") {
      return value;
    }

    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  public override async migrate(): Promise<void> {
    const repository: {
      metadata: { tableName: string };
      manager: {
        query: (sql: string, parameters: Array<unknown>) => Promise<unknown>;
      };
    } = (
      MetricPipelineRuleService as unknown as DatabaseService<BaseModel>
    ).getRepository() as never;
    const tableName: string = repository.metadata.tableName;
    let lastId: string | null = null;
    let moved: number = 0;
    let failed: number = 0;

    while (true) {
      const rows: Array<RuleRow> = (await repository.manager.query(
        `SELECT "_id", "addAttributeKey", "filters" FROM "${tableName}" WHERE "ruleType" = $2 AND "filters" IS NOT NULL AND "filters"::text LIKE $3${
          lastId ? ` AND "_id" > $4` : ""
        } ORDER BY "_id" ASC LIMIT $1`,
        lastId
          ? [
              PAGE_SIZE,
              MetricPipelineRuleType.RedactAttribute,
              `%${MetricPipelineRuleFilterConditionType.MatchesRegex}%`,
              lastId,
            ]
          : [
              PAGE_SIZE,
              MetricPipelineRuleType.RedactAttribute,
              `%${MetricPipelineRuleFilterConditionType.MatchesRegex}%`,
            ],
      )) as Array<RuleRow>;

      for (const row of rows) {
        try {
          const stored: unknown =
            MetricScrubRulesMatchTheirPatternType.readFilters(row.filters);
          const filters: Array<MetricPipelineRuleFilterCondition> | null =
            MetricScrubRulesMatchTheirPatternType.moveFilters(
              stored,
              row.addAttributeKey,
              this.frozenPatterns,
            );

          if (!filters) {
            continue;
          }

          const written: unknown = await repository.manager.query(
            `UPDATE "${tableName}" SET "filters" = $1::jsonb WHERE "_id" = $2 AND "filters" = $3::jsonb RETURNING "_id"`,
            [JSON.stringify(filters), row._id, JSON.stringify(stored)],
          );

          // Saved again since it was read: its next save is its own.
          if (countWrittenRows(written) > 0) {
            moved++;
          }
        } catch (err) {
          /*
           * One rule that cannot be moved must not hold the others back: it
           * keeps hiding what it did, and Scrub It can be pressed again.
           */
          failed++;
          logger.error(`${this.name}: could not move rule ${row._id}:`);
          logger.error(err);
        }
      }

      if (rows.length < PAGE_SIZE) {
        break;
      }

      lastId = rows[rows.length - 1]!._id;
    }

    logger.info(
      `${this.name}: ${moved} metric rule(s) Scrub It made now match their data type's pattern type${
        failed ? `; ${failed} could not be written` : ""
      }.`,
    );
  }

  public override async rollback(): Promise<void> {
    /*
     * Nothing to undo: moved back, a rule for an IP address would leave
     * every IPv6 address again, and the others what they read encoded or in
     * another script.
     */
    return;
  }
}
