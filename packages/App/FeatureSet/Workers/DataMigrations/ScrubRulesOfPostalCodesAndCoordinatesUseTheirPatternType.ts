import MetricScrubRulesMatchTheirPatternType, {
  FrozenScrubItPattern,
} from "./MetricScrubRulesMatchTheirPatternType";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "Common/Server/Services/DatabaseService";
import LogScrubRuleService from "Common/Server/Services/LogScrubRuleService";
import TraceScrubRuleService from "Common/Server/Services/TraceScrubRuleService";
import logger from "Common/Server/Utils/Logger";
import LogScrubPatternType from "Common/Types/Log/LogScrubPatternType";

/*
 * THE RULES SCRUB IT MADE FOR A POSTAL CODE OR A PRECISE LOCATION, MOVED TO
 * THE PATTERN TYPES THAT HIDE WHAT DATA SECURITY FINDS (#11502).
 *
 * Scrub It made a Custom Regex rule for a postal code, and for a precise
 * location, of the type's detectors that need no word beside a value: a UK
 * and a Canadian postcode, a latitude and longitude pair. Data Security
 * also finds a US ZIP code beside "zip" or alone under `address.zip`, and a
 * lone coordinate beside "lat" or under `location.lat`, which that pattern
 * kept while coverage counted the rule as hiding them. On a metric
 * attribute it wrote the same pattern into a Redact Attribute rule's
 * Matches Regex filter.
 *
 * Scrub It now makes Postal Code and Coordinates rules, built-in pattern
 * types that hide what the detectors find, the key and the words around a
 * value read as Data Security reads them, and gives a metric rule a Matches
 * Pattern Type filter of them (TelemetryScrubCoverage). Each rule made
 * before gets the same:
 *
 *  - a log or trace scrub rule whose Custom Regex is exactly the pattern
 *    Scrub It wrote for the type becomes a rule of its pattern type, every
 *    other column - its action, its fields, its service, the attributes it
 *    reads - as it was;
 *  - a metric rule's filter of that pattern, on the attribute it redacts,
 *    becomes a Matches Pattern Type filter of it
 *    (MetricScrubRulesMatchTheirPatternType, whose code this runs).
 *
 * Each pattern word for word: one a person wrote is left as it is. The
 * detectors of these types are as they were when Scrub It first made such
 * a rule, so it wrote each pattern one way. A rule moved hides, from its
 * next batch on, the ZIP codes and lone coordinates beside their words or
 * under their keys too; it hides the same UK and Canadian postcodes and
 * coordinate pairs it did.
 *
 * Postgres only. Safe to run twice, and two at once: a moved rule no longer
 * holds a frozen pattern.
 */
export const FROZEN_POSTAL_CODE_AND_COORDINATE_SCRUB_IT_PATTERNS: ReadonlyArray<FrozenScrubItPattern> =
  [
    {
      dataTypeId: "postal-code",
      pattern:
        "(?:(?<![A-Za-z0-9])[A-Z]{1,2}[0-9][A-Z0-9]?[ ][0-9][A-BD-HJLNP-UW-Z]{2}(?![A-Za-z0-9]))|(?:(?<![A-Za-z0-9])[ABCEGHJ-NPRSTVXY][0-9][ABCEGHJ-NPRSTV-Z][ ]?[0-9][ABCEGHJ-NPRSTV-Z][0-9](?![A-Za-z0-9]))",
      patternType: LogScrubPatternType.PostalCode,
    },
    {
      dataTypeId: "geolocation",
      pattern:
        "(?<![0-9.-])-?[0-9]{1,2}\\.[0-9]{4,10}[ ]?,[ ]?-?[0-9]{1,3}\\.[0-9]{4,10}(?![0-9])",
      patternType: LogScrubPatternType.Coordinates,
    },
  ];

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

interface RawRepository {
  metadata: { tableName: string };
  manager: {
    query: (sql: string, parameters: Array<unknown>) => Promise<unknown>;
  };
}

export default class ScrubRulesOfPostalCodesAndCoordinatesUseTheirPatternType extends MetricScrubRulesMatchTheirPatternType {
  public constructor() {
    super(
      "ScrubRulesOfPostalCodesAndCoordinatesUseTheirPatternType",
      FROZEN_POSTAL_CODE_AND_COORDINATE_SCRUB_IT_PATTERNS,
    );
  }

  /*
   * The log and trace scrub rules whose Custom Regex is a frozen pattern,
   * each moved to the pattern type it stands for: how many were moved.
   */
  public static async moveLogAndTraceRules(
    repositories: ReadonlyArray<RawRepository>,
  ): Promise<number> {
    let moved: number = 0;

    for (const repository of repositories) {
      const tableName: string = repository.metadata.tableName;

      for (const frozen of FROZEN_POSTAL_CODE_AND_COORDINATE_SCRUB_IT_PATTERNS) {
        moved += countWrittenRows(
          await repository.manager.query(
            `UPDATE "${tableName}" SET "patternType" = $1, "customRegex" = NULL WHERE "patternType" = $2 AND "customRegex" = $3 RETURNING "_id"`,
            [frozen.patternType, LogScrubPatternType.Custom, frozen.pattern],
          ),
        );
      }
    }

    return moved;
  }

  public override async migrate(): Promise<void> {
    // The metric rules first, as MetricScrubRulesMatchTheirPatternType moves them.
    await super.migrate();

    const moved: number =
      await ScrubRulesOfPostalCodesAndCoordinatesUseTheirPatternType.moveLogAndTraceRules(
        [LogScrubRuleService, TraceScrubRuleService].map(
          (service: unknown): RawRepository => {
            return (
              service as DatabaseService<BaseModel>
            ).getRepository() as unknown as RawRepository;
          },
        ),
      );

    logger.info(
      `${this.name}: ${moved} log or trace scrub rule(s) Scrub It made for a postal code or a precise location now use its pattern type.`,
    );
  }

  public override async rollback(): Promise<void> {
    /*
     * Nothing to undo: moved back, a rule would again keep a ZIP code
     * beside "zip" and a lone coordinate under its key.
     */
    return;
  }
}
