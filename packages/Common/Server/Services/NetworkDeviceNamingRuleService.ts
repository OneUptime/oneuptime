import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/NetworkDeviceNamingRule";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONArray } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import { NamingLookupEntry } from "../../Types/NetworkDevice/DeviceNaming";
import RuleCriteria, {
  RuleCriteriaFilter,
  RuleCriteriaOperator,
} from "../../Types/Rules/RuleCriteria";
import {
  getRuleCriteriaValidationError,
  isValidRuleCriteria,
} from "../../Utils/Rules/RuleCriteriaMatcher";
import RulePatternMatchUtil from "../../Utils/Rules/RulePatternMatchUtil";
import {
  NamePatternProblem,
  NamePlaceholder,
  ParsedNamePattern,
  formatNamePatternProblem,
  parseNamePattern,
} from "../../Utils/NetworkDevice/Naming/NamePattern";
import {
  NAMING_LOOKUP_PROBLEMS,
  NamingLookupProblem,
  formatNamingLookupProblem,
  validateNamingLookupEntries,
} from "../../Utils/NetworkDevice/Naming/NamingLookup";
import { isValidNamingAddressRange } from "../../Utils/NetworkDevice/Naming/NamingRuleMatcher";

/*
 * Write-time checks for naming rules (OneUptime issue #6619), in the
 * contract of the other network rules' services: a rule that could never
 * name a device - a pattern with a typo, a lookup table nothing reads, a
 * condition that cannot run - is refused where the person can see it, not
 * found out from devices imported under their discovered names.
 */

const TEXT_FIELDS: ReadonlyArray<string> = [
  "discoveredNamePattern",
  "macAddressPattern",
  "vendorPattern",
];

const TEXT_FIELD_TITLES: Readonly<Record<string, string>> = {
  discoveredNamePattern: "Discovered Name",
  macAddressPattern: "MAC Address",
  vendorPattern: "Vendor",
};

const TEXT_OPERATORS: ReadonlySet<RuleCriteriaOperator> = new Set([
  RuleCriteriaOperator.Equals,
  RuleCriteriaOperator.NotEquals,
  RuleCriteriaOperator.Contains,
  RuleCriteriaOperator.DoesNotContain,
  RuleCriteriaOperator.StartsWith,
  RuleCriteriaOperator.EndsWith,
  RuleCriteriaOperator.MatchesPattern,
  RuleCriteriaOperator.DoesNotMatchPattern,
]);

const PATTERN_OPERATORS: ReadonlySet<RuleCriteriaOperator> = new Set([
  RuleCriteriaOperator.MatchesPattern,
  RuleCriteriaOperator.DoesNotMatchPattern,
]);

const LIST_OPERATORS: ReadonlySet<RuleCriteriaOperator> = new Set([
  RuleCriteriaOperator.HasAnyOf,
  RuleCriteriaOperator.HasAllOf,
  RuleCriteriaOperator.HasNoneOf,
]);

// The words of a refused IP condition, once.
export function getNamingAddressRangeRefusal(value: string): string {
  return `"${value}" is not an IP address range a naming rule can match. Use a CIDR such as 10.48.145.0/24, or octet ranges such as 10.0-255.0-255.150-159, where * is any number (10.*.*.51).`;
}

// What a rule's columns say about naming, for the checks below.
interface NamingRuleState {
  criteria?: unknown;
  ipMatchTarget?: string | null | undefined;
  discoveredNamePattern?: string | null | undefined;
  macAddressPattern?: string | null | undefined;
  vendorPattern?: string | null | undefined;
  namePattern?: string | null | undefined;
  lookupKey?: string | null | undefined;
  lookupEntries?: unknown;
}

const CHECKED_KEYS: ReadonlyArray<keyof NamingRuleState> = [
  "criteria",
  "ipMatchTarget",
  "discoveredNamePattern",
  "macAddressPattern",
  "vendorPattern",
  "namePattern",
  "lookupKey",
  "lookupEntries",
];

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    // The project's own records only (the sites), before anything here reads one.
    await super.onBeforeCreate(createBy);

    const entries: Array<NamingLookupEntry> = Service.validateRule(
      createBy.data as unknown as NamingRuleState,
    );

    if (createBy.data.lookupEntries !== undefined) {
      createBy.data.lookupEntries = entries as unknown as JSONArray;
    }

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    // The project's own records only, before anything here reads one.
    await super.onBeforeUpdate(updateBy);

    const data: Record<string, unknown> = updateBy.data as unknown as Record<
      string,
      unknown
    >;
    const dataKeys: Array<string> = Object.keys(data || {});

    if (
      !CHECKED_KEYS.some((key: keyof NamingRuleState): boolean => {
        return dataKeys.includes(key);
      })
    ) {
      return { updateBy, carryForward: null };
    }

    /*
     * A save may change the pattern and leave the table, or the other way
     * round: each matched rule is checked as it will be after the save.
     */
    const existingRules: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        criteria: true,
        ipMatchTarget: true,
        discoveredNamePattern: true,
        macAddressPattern: true,
        vendorPattern: true,
        namePattern: true,
        lookupKey: true,
        lookupEntries: true,
      },
    );

    let entries: Array<NamingLookupEntry> | null = null;

    for (const existingRule of existingRules) {
      const state: NamingRuleState = {};

      for (const key of CHECKED_KEYS) {
        (state as Record<string, unknown>)[key] = dataKeys.includes(key)
          ? data[key]
          : (existingRule as unknown as Record<string, unknown>)[key];
      }

      entries = Service.validateRule(state);
    }

    if (dataKeys.includes("lookupEntries") && entries) {
      data["lookupEntries"] = entries;
    }

    return { updateBy, carryForward: null };
  }

  /**
   * Everything a rule must be to name devices, checked; the lookup table's
   * rows, trimmed, to store. Public and static so the API's preview of a
   * rule being typed checks it the same way.
   */
  public static validateRule(state: NamingRuleState): Array<NamingLookupEntry> {
    Service.validateConditions(state);

    const read: { pattern: ParsedNamePattern } | { problem: NamePatternProblem } =
      parseNamePattern(state.namePattern);

    if ("problem" in read) {
      throw new BadDataException(formatNamePatternProblem(read.problem));
    }

    const validated:
      | { entries: Array<NamingLookupEntry> }
      | { problem: NamingLookupProblem } = validateNamingLookupEntries({
      kind: state.lookupKey,
      entries: state.lookupEntries,
    });

    if ("problem" in validated) {
      throw new BadDataException(formatNamingLookupProblem(validated.problem));
    }

    const usesLookup: boolean = read.pattern.placeholders.includes(
      NamePlaceholder.Lookup,
    );

    if (usesLookup && validated.entries.length === 0) {
      throw new BadDataException(
        formatNamingLookupProblem({
          template: NAMING_LOOKUP_PROBLEMS.emptyTable,
          values: {},
        }),
      );
    }

    if (!usesLookup && validated.entries.length > 0) {
      throw new BadDataException(
        formatNamingLookupProblem({
          template: NAMING_LOOKUP_PROBLEMS.unusedTable,
          values: {},
        }),
      );
    }

    return validated.entries;
  }

  private static validateConditions(state: NamingRuleState): void {
    if (state.criteria !== undefined && state.criteria !== null) {
      const validationError: string | null = getRuleCriteriaValidationError(
        state.criteria,
      );

      if (validationError) {
        throw new BadDataException(validationError);
      }

      if (!isValidRuleCriteria(state.criteria)) {
        throw new BadDataException("The rule's conditions are not valid.");
      }

      for (const filter of (state.criteria as RuleCriteria).filters) {
        Service.validateFilter(filter);
      }
    }

    /*
     * The columns too: an API client may write them, and a rule saved from
     * the form carries the never-matching pattern an older server reads
     * (RuleCriteriaModelForm), which is a pattern that runs.
     */
    const ipMatchTarget: string = (state.ipMatchTarget || "").trim();

    if (ipMatchTarget && !isValidNamingAddressRange(ipMatchTarget)) {
      throw new BadDataException(getNamingAddressRangeRefusal(ipMatchTarget));
    }

    for (const field of TEXT_FIELDS) {
      Service.validatePattern(
        TEXT_FIELD_TITLES[field] || field,
        String((state as Record<string, unknown>)[field] || "").trim(),
      );
    }
  }

  private static validateFilter(filter: RuleCriteriaFilter): void {
    if (filter.field === "ipMatchTarget") {
      if (!PATTERN_OPERATORS.has(filter.operator)) {
        throw new BadDataException(
          'An IP Address condition is "is in" or "is not in" a range.',
        );
      }

      const value: string = Array.isArray(filter.value)
        ? ""
        : String(filter.value).trim();

      if (!isValidNamingAddressRange(value)) {
        throw new BadDataException(getNamingAddressRangeRefusal(value));
      }

      return;
    }

    if (filter.field === "sites") {
      if (!LIST_OPERATORS.has(filter.operator) || !Array.isArray(filter.value)) {
        throw new BadDataException(
          "A Site condition picks sites from the list: has any of, has all of or has none of.",
        );
      }

      for (const siteId of filter.value) {
        if (!ObjectID.isValidUUID(String(siteId))) {
          throw new BadDataException("Pick each site from the list.");
        }
      }

      return;
    }

    if (!TEXT_FIELDS.includes(filter.field)) {
      throw new BadDataException(
        `${filter.field} is not a condition a naming rule can have.`,
      );
    }

    const title: string = TEXT_FIELD_TITLES[filter.field] || filter.field;

    if (!TEXT_OPERATORS.has(filter.operator) || Array.isArray(filter.value)) {
      throw new BadDataException(
        `${filter.operator} is not a comparison ${title} can use.`,
      );
    }

    if (PATTERN_OPERATORS.has(filter.operator)) {
      Service.validatePattern(title, String(filter.value).trim());
    }
  }

  private static validatePattern(title: string, pattern: string): void {
    if (!pattern || RulePatternMatchUtil.isSupportedPattern(pattern)) {
      return;
    }

    const cannotRun: string | null = RulePatternMatchUtil.getCannotRunMessage(
      title,
      pattern,
    );

    if (cannotRun) {
      throw new BadDataException(cannotRun);
    }

    throw new BadDataException(
      `${title} is neither a valid regular expression nor a '*' wildcard pattern, so it would never match: ${pattern}`,
    );
  }
}

export default new Service();
