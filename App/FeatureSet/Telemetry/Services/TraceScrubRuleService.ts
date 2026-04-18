import TraceScrubRule from "Common/Models/DatabaseModels/TraceScrubRule";
import DatabaseService from "Common/Server/Services/DatabaseService";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import TraceScrubAction from "Common/Types/Trace/TraceScrubAction";
import TraceScrubPatternType from "Common/Types/Trace/TraceScrubPatternType";
import TraceScrubField from "Common/Types/Trace/TraceScrubField";
import crypto from "crypto";

interface CacheEntry {
  rules: Array<TraceScrubRule>;
  compiledPatterns: Array<CompiledRule>;
  loadedAt: number;
}

interface CompiledRule {
  rule: TraceScrubRule;
  regex: RegExp;
}

const CACHE_TTL_MS: number = 60 * 1000; // 60 seconds

const scrubRuleCache: Map<string, CacheEntry> = new Map();

// Built-in PII detection patterns — same set as logs.
const BUILT_IN_PATTERNS: Record<string, RegExp> = {
  [TraceScrubPatternType.Email]:
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  [TraceScrubPatternType.CreditCard]: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
  [TraceScrubPatternType.SSN]: /\b\d{3}-\d{2}-\d{4}\b/g,
  [TraceScrubPatternType.PhoneNumber]:
    /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  [TraceScrubPatternType.IPAddress]: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
};

export class TraceScrubRuleService {
  public static async loadScrubRules(
    projectId: ObjectID,
  ): Promise<Array<CompiledRule>> {
    const cacheKey: string = projectId.toString();
    const cached: CacheEntry | undefined = scrubRuleCache.get(cacheKey);

    if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
      return cached.compiledPatterns;
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
    if (patternType === TraceScrubPatternType.Custom) {
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
      case TraceScrubAction.Redact:
        return "[REDACTED]";

      case TraceScrubAction.Hash: {
        const hash: string = crypto
          .createHash("sha256")
          .update(match)
          .digest("hex")
          .substring(0, 8);
        return `[HASHED:${hash}]`;
      }

      case TraceScrubAction.Mask:
        return this.maskValue(match, patternType);

      default:
        return "[REDACTED]";
    }
  }

  private static maskValue(value: string, patternType: string): string {
    switch (patternType) {
      case TraceScrubPatternType.Email: {
        const atIndex: number = value.indexOf("@");
        if (atIndex > 0) {
          const dotIndex: number = value.lastIndexOf(".");
          if (dotIndex > atIndex) {
            return value[0] + "***@***" + value.substring(dotIndex);
          }
        }
        return "***@***.***";
      }

      case TraceScrubPatternType.CreditCard: {
        const digits: string = value.replace(/[-\s]/g, "");
        if (digits.length >= 4) {
          return "****-****-****-" + digits.substring(digits.length - 4);
        }
        return "****-****-****-****";
      }

      case TraceScrubPatternType.SSN:
        return "***-**-" + value.substring(value.length - 4);

      case TraceScrubPatternType.PhoneNumber: {
        const phoneDigits: string = value.replace(/[^0-9]/g, "");
        if (phoneDigits.length >= 4) {
          return "***-***-" + phoneDigits.substring(phoneDigits.length - 4);
        }
        return "***-***-****";
      }

      case TraceScrubPatternType.IPAddress:
        return "***.***.***.***";

      default: {
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
      regex.lastIndex = 0;

      const action: string =
        (rule.scrubAction as string) || TraceScrubAction.Redact;
      const patternType: string = (rule.patternType as string) || "";

      result = result.replace(regex, (match: string) => {
        return this.applyScrubAction(match, action, patternType);
      });
    }

    return result;
  }

  private static scrubAttributesInPlace(
    attributes: JSONObject,
    singleRule: Array<CompiledRule>,
  ): void {
    for (const key of Object.keys(attributes)) {
      const v: unknown = attributes[key];
      if (typeof v === "string") {
        attributes[key] = this.scrubString(v, singleRule);
      }
    }
  }

  public static scrubSpan(
    spanRow: JSONObject,
    compiledRules: Array<CompiledRule>,
  ): JSONObject {
    if (compiledRules.length === 0) {
      return spanRow;
    }

    for (const { rule } of compiledRules) {
      const fieldsToScrub: string =
        (rule.fieldsToScrub as string) || TraceScrubField.All;
      const scrubAll: boolean = fieldsToScrub === TraceScrubField.All;

      const singleRule: Array<CompiledRule> = compiledRules.filter(
        (cr: CompiledRule) => {
          return cr.rule === rule;
        },
      );

      // Span name.
      if (
        (scrubAll || fieldsToScrub === TraceScrubField.Name) &&
        typeof spanRow["name"] === "string"
      ) {
        spanRow["name"] = this.scrubString(spanRow["name"] as string, singleRule);
      }

      // Span attributes.
      if (
        (scrubAll || fieldsToScrub === TraceScrubField.Attributes) &&
        spanRow["attributes"] &&
        typeof spanRow["attributes"] === "object"
      ) {
        this.scrubAttributesInPlace(
          spanRow["attributes"] as JSONObject,
          singleRule,
        );
      }

      // Span event attributes — walk events[].attributes.
      if (
        (scrubAll || fieldsToScrub === TraceScrubField.Events) &&
        Array.isArray(spanRow["events"])
      ) {
        const events: Array<JSONObject> = spanRow["events"] as Array<JSONObject>;
        for (const event of events) {
          if (event && typeof event === "object" && event["attributes"]) {
            this.scrubAttributesInPlace(
              event["attributes"] as JSONObject,
              singleRule,
            );
          }
        }
      }
    }

    return spanRow;
  }
}

export default TraceScrubRuleService;
