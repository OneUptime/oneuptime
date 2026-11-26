import TraceScrubRule from "Common/Models/DatabaseModels/TraceScrubRule";
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
import TraceScrubEngine, {
  ExceptionContent,
  TraceScrubOptions,
} from "Common/Server/Utils/Telemetry/ScrubEngine/TraceScrubEngine";

/*
 * A PROJECT'S TRACE SCRUB RULES, AS INGEST RUNS THEM.
 *
 * Loads each project's enabled rules in their order, compiles them once and
 * keeps them a minute, then hands each span - and each exception copied
 * from a span's exception event - to the one trace engine
 * (Common/Server/Utils/Telemetry/ScrubEngine/TraceScrubEngine), the code
 * Data Security's proof of a rule runs too (#10366). The engine holds what
 * a rule does, the same denylist as the log engine (written once in
 * Common, SCRUB_RULE_SENSITIVE_KEY_REGEX), and the count of the values
 * each rule changes.
 */

type CompiledRule = CompiledScrubRule<TraceScrubRule>;

export type { ExceptionContent };

const CACHE_TTL_MS: number = 60 * 1000; // 60 seconds
const MAX_CACHED_PROJECTS: number = 10_000;

const scrubRuleCache: InMemoryTTLCache<Array<CompiledRule>> =
  new InMemoryTTLCache<Array<CompiledRule>>(MAX_CACHED_PROJECTS);

export class TraceScrubRuleService {
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

    const service: DatabaseService<TraceScrubRule> =
      new DatabaseService<TraceScrubRule>(TraceScrubRule);

    const rules: Array<TraceScrubRule> = await service.findBy({
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
        // A rule for one service scrubs that service's spans only (#10433).
        serviceId: true,
        // The attributes a rule names (#10366).
        attributeKeys: true,
      },
      props: {
        isRoot: true,
      },
    });

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
   * Scrub exception content extracted from a span's exception event, as
   * the rules that scrub span events scrub the event it was copied from
   * (TraceScrubEngine.scrubExceptionContent). `primaryEntityId`: the
   * service of the span it was copied from (#10433).
   */
  public static scrubExceptionContent(
    content: ExceptionContent,
    projectRules: Array<CompiledRule>,
    primaryEntityId?: unknown,
  ): ExceptionContent {
    return TraceScrubEngine.scrubExceptionContent(
      content,
      projectRules,
      primaryEntityId,
    );
  }

  /*
   * A span row as the project's rules leave it, in place
   * (TraceScrubEngine). `recorder`: told each address an IP Address Hash
   * rule hides, for Security Events' address vault (#10395). Each value a
   * rule changes is counted, by rule, service and version (#10366).
   */
  public static scrubSpan(
    spanRow: JSONObject,
    projectRules: Array<CompiledRule>,
    recorder?: ScrubHashedAddressRecorder | null | undefined,
    options?: TraceScrubOptions | undefined,
  ): JSONObject {
    return TraceScrubEngine.scrubSpan(spanRow, projectRules, recorder, options);
  }
}

export default TraceScrubRuleService;
