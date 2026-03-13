import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import DatabaseService from "Common/Server/Services/DatabaseService";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import LogScrubAction from "Common/Types/Log/LogScrubAction";
import LogScrubPatternType from "Common/Types/Log/LogScrubPatternType";
import crypto from "crypto";

interface CacheEntry {
  rules: Array<LogScrubRule>;
  compiledPatterns: Array<CompiledRule>;
  loadedAt: number;
}

interface CompiledRule {
  rule: LogScrubRule;
  regex: RegExp;
}

const CACHE_TTL_MS: number = 60 * 1000; // 60 seconds

const scrubRuleCache: Map<string, CacheEntry> = new Map();

// Built-in PII detection patterns
const BUILT_IN_PATTERNS: Record<string, RegExp> = {
  [LogScrubPatternType.Email]:
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  [LogScrubPatternType.CreditCard]: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
  [LogScrubPatternType.SSN]: /\b\d{3}-\d{2}-\d{4}\b/g,
  [LogScrubPatternType.PhoneNumber]:
    /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  [LogScrubPatternType.IPAddress]: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
};

export class LogScrubRuleService {
  public static async loadScrubRules(
    projectId: ObjectID,
  ): Promise<Array<CompiledRule>> {
    const cacheKey: string = projectId.toString();
    const cached: CacheEntry | undefined = scrubRuleCache.get(cacheKey);

    if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
      return cached.compiledPatterns;
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
        name: true,
        patternType: true,
        customRegex: true,
        scrubAction: true,
        fieldsToScrub: true,
        sortOrder: true,
      },
      props: {
        isRoot: true,
      },
    });

    // Pre-compile regex patterns for performance
    const compiledPatterns: Array<CompiledRule> = [];

    for (const rule of rules) {
      const regex: RegExp | null = this.getRegexForPattern(
        rule.patternType as string,
        rule.customRegex as string | undefined,
      );

      if (regex) {
        compiledPatterns.push({ rule, regex });
      }
    }

    scrubRuleCache.set(cacheKey, {
      rules,
      compiledPatterns,
      loadedAt: Date.now(),
    });

    return compiledPatterns;
  }

  private static getRegexForPattern(
    patternType: string,
    customRegex?: string,
  ): RegExp | null {
    if (patternType === LogScrubPatternType.Custom) {
      if (!customRegex) {
        return null;
      }
      try {
        return new RegExp(customRegex, "g");
      } catch {
        return null;
      }
    }

    const builtIn: RegExp | undefined = BUILT_IN_PATTERNS[patternType];
    if (builtIn) {
      // Return a new instance so lastIndex is independent per use
      return new RegExp(builtIn.source, builtIn.flags);
    }

    return null;
  }

  private static applyScrubAction(
    match: string,
    action: string,
    patternType: string,
  ): string {
    switch (action) {
      case LogScrubAction.Redact:
        return "[REDACTED]";

      case LogScrubAction.Hash: {
        const hash: string = crypto
          .createHash("sha256")
          .update(match)
          .digest("hex")
          .substring(0, 8);
        return `[HASHED:${hash}]`;
      }

      case LogScrubAction.Mask:
        return this.maskValue(match, patternType);

      default:
        return "[REDACTED]";
    }
  }

  private static maskValue(value: string, patternType: string): string {
    switch (patternType) {
      case LogScrubPatternType.Email: {
        const atIndex: number = value.indexOf("@");
        if (atIndex > 0) {
          const dotIndex: number = value.lastIndexOf(".");
          if (dotIndex > atIndex) {
            return value[0] + "***@***" + value.substring(dotIndex);
          }
        }
        return "***@***.***";
      }

      case LogScrubPatternType.CreditCard: {
        // Show last 4 digits only
        const digits: string = value.replace(/[-\s]/g, "");
        if (digits.length >= 4) {
          return "****-****-****-" + digits.substring(digits.length - 4);
        }
        return "****-****-****-****";
      }

      case LogScrubPatternType.SSN:
        return "***-**-" + value.substring(value.length - 4);

      case LogScrubPatternType.PhoneNumber: {
        // Show last 4 digits only
        const phoneDigits: string = value.replace(/[^0-9]/g, "");
        if (phoneDigits.length >= 4) {
          return "***-***-" + phoneDigits.substring(phoneDigits.length - 4);
        }
        return "***-***-****";
      }

      case LogScrubPatternType.IPAddress:
        return "***.***.***.***";

      default: {
        // Generic masking: keep first and last char, mask middle
        if (value.length <= 2) {
          return "***";
        }
        return (
          value[0] +
          "*".repeat(Math.max(value.length - 2, 3)) +
          value[value.length - 1]!
        );
      }
    }
  }

  private static scrubString(
    value: string,
    compiledRules: Array<CompiledRule>,
  ): string {
    let result: string = value;

    for (const { rule, regex } of compiledRules) {
      // Reset lastIndex for global regex
      regex.lastIndex = 0;

      const action: string =
        (rule.scrubAction as string) || LogScrubAction.Redact;
      const patternType: string = (rule.patternType as string) || "";

      result = result.replace(regex, (match: string) => {
        return this.applyScrubAction(match, action, patternType);
      });
    }

    return result;
  }

  public static scrubLog(
    logRow: JSONObject,
    compiledRules: Array<CompiledRule>,
  ): JSONObject {
    if (compiledRules.length === 0) {
      return logRow;
    }

    for (const { rule } of compiledRules) {
      const fieldsToScrub: string = (rule.fieldsToScrub as string) || "both";

      // Filter compiled rules to just this one for per-rule scrubbing
      const singleRule: Array<CompiledRule> = compiledRules.filter(
        (cr: CompiledRule) => {
          return cr.rule === rule;
        },
      );

      // Scrub body
      if (
        (fieldsToScrub === "body" || fieldsToScrub === "both") &&
        typeof logRow["body"] === "string"
      ) {
        logRow["body"] = this.scrubString(logRow["body"] as string, singleRule);
      }

      // Scrub attributes
      if (
        (fieldsToScrub === "attributes" || fieldsToScrub === "both") &&
        logRow["attributes"] &&
        typeof logRow["attributes"] === "object"
      ) {
        const attributes: JSONObject = logRow["attributes"] as JSONObject;

        for (const key of Object.keys(attributes)) {
          if (typeof attributes[key] === "string") {
            attributes[key] = this.scrubString(
              attributes[key] as string,
              singleRule,
            );
          }
        }
      }
    }

    return logRow;
  }
}

export default LogScrubRuleService;
