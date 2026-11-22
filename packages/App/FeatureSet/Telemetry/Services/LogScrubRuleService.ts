import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import DatabaseService from "Common/Server/Services/DatabaseService";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import InMemoryTTLCache from "Common/Server/Infrastructure/InMemoryTTLCache";
import { ScrubHashedAddressRecorder } from "Common/Server/Utils/Telemetry/ScrubAction";
import {
  compileScrubRule,
  CompiledScrubRule,
  getScrubRuleRegex,
} from "Common/Server/Utils/Telemetry/ScrubEngine/CompiledScrubRule";
import { ScrubRegExp } from "Common/Types/Telemetry/ScrubRule";
import LogScrubEngine, {
  LogScrubOptions,
} from "Common/Server/Utils/Telemetry/ScrubEngine/LogScrubEngine";

/*
 * A PROJECT'S LOG SCRUB RULES, AS INGEST RUNS THEM.
 *
 * Loads each project's enabled rules in their order, compiles them once and
 * keeps them a minute, then hands each log row to the one log engine
 * (Common/Server/Utils/Telemetry/ScrubEngine/LogScrubEngine) - the code
 * Data Security's proof of a rule runs too (#10366), so a rule proven on a
 * finding's records is the rule ingest runs. The engine holds what a rule
 * does: built-in and custom patterns, the IP Address pattern (#10393),
 * Sensitive Attribute Keys - whose denylist is written once, in Common
 * (SCRUB_RULE_SENSITIVE_KEY_REGEX) - Named Attributes and the attributes a
 * pattern reads (#10366), and the count of the values each rule changes.
 */

type CompiledRule = CompiledScrubRule<LogScrubRule>;

const CACHE_TTL_MS: number = 60 * 1000; // 60 seconds
const MAX_CACHED_PROJECTS: number = 10_000;

const scrubRuleCache: InMemoryTTLCache<Array<CompiledRule>> =
  new InMemoryTTLCache<Array<CompiledRule>>(MAX_CACHED_PROJECTS);

export class LogScrubRuleService {
  public static async loadScrubRules(
    projectId: ObjectID,
  ): Promise<Array<CompiledRule>> {
    const cacheKey: string = projectId.toString();
    const cached: Array<CompiledRule> | undefined =
      scrubRuleCache.get(cacheKey);

    // Empty arrays are truthy — zero-rule projects stay negatively cached.
    if (cached) {
      return cached;
    }

    const service: DatabaseService<LogScrubRule> =
      new DatabaseService<LogScrubRule>(LogScrubRule);

    const rules: Array<LogScrubRule> = await service.findBy({
      query: {
        projectId: projectId,
        isEnabled: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      sort: {
        sortOrder: SortOrder.Ascending,
      },
      select: {
        _id: true,
        // A Hash rule hashes with its project's own key (ScrubHashToken).
        projectId: true,
        name: true,
        patternType: true,
        customRegex: true,
        scrubAction: true,
        fieldsToScrub: true,
        sortOrder: true,
        // A rule for one service scrubs that service's logs only (#10433).
        serviceId: true,
        // The attributes a rule names (#10366).
        attributeKeys: true,
      },
      props: {
        isRoot: true,
      },
    });

    // Pre-compile regex patterns for performance
    const compiledPatterns: Array<CompiledRule> = [];

    for (const rule of rules) {
      const compiled: CompiledRule | null = compileScrubRule(rule);

      if (compiled) {
        compiledPatterns.push(compiled);
      }
    }

    scrubRuleCache.set(cacheKey, compiledPatterns, CACHE_TTL_MS);

    return compiledPatterns;
  }

  /*
   * What a rule of this pattern type finds in a value, as ingest compiles
   * it (ScrubEngine/CompiledScrubRule.getScrubRuleRegex) - for a caller
   * that compiles one rule by its pattern alone. A rule is loaded and
   * compiled whole by loadScrubRules, its keys with it.
   */
  public static getRegexForPattern(
    patternType: string,
    customRegex?: string,
  ): ScrubRegExp | null {
    return getScrubRuleRegex({ patternType, customRegex });
  }

  /*
   * A log row as the project's rules leave it, in place (LogScrubEngine).
   * `recorder`: told each address an IP Address Hash rule hides, for
   * Security Events' address vault (#10395). Each value a rule changes is
   * counted, by rule, service and version (#10366).
   */
  public static scrubLog(
    logRow: JSONObject,
    projectRules: Array<CompiledRule>,
    recorder?: ScrubHashedAddressRecorder | null | undefined,
    options?: LogScrubOptions | undefined,
  ): JSONObject {
    return LogScrubEngine.scrubLog(logRow, projectRules, recorder, options);
  }
}

export default LogScrubRuleService;
