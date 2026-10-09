import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import BadDataException from "../../Types/Exception/BadDataException";
import {
  checkScrubRuleCustomRegex,
  SCRUB_RULE_CUSTOM_PATTERN_TYPE,
  SCRUB_RULE_SENSITIVE_KEYS_PATTERN_TYPE,
  ScrubRuleCustomRegexCheck,
  ScrubRuleCustomRegexProblem,
} from "../../Types/Telemetry/ScrubRule";
import Select from "../Types/Database/Select";
import UpdateBy from "../Types/Database/UpdateBy";
import { isSqlExpressionValue } from "./DropFilterValidation";

/*
 * Save-time validation for log and trace scrub rules: a rule is refused
 * unless ingest can scrub with it.
 *
 * A scrub rule exists to keep personal data out of storage, and three ways of
 * saving one made it scrub nothing while it looked active in the rules table:
 *
 *   - a Custom Regex rule with an empty pattern, or one that does not
 *     compile: ingest skips it (LogScrubRuleService / TraceScrubRuleService
 *     getRegexForPattern returns null);
 *   - a pattern type ingest does not know ("Email" for "email"): skipped the
 *     same way;
 *   - a fields-to-scrub value ingest does not know: the rule matches, but
 *     scrubs none of the record's fields. (A sensitive-keys rule is the
 *     exception: ingest runs it on attributes whatever its fields say, so
 *     its fields are not judged.)
 *
 * The user believed the data was masked when it was not. The API boundary is
 * the only place a person is there to read why, so it is refused there, on
 * create and on an update that touches one of these columns (judged on the
 * merged row, as the drop filters' check is). A custom pattern that matches
 * empty text is refused too: a global replace would put the rule's
 * replacement between every character of every record.
 *
 * Rules saved before this check are left exactly as they are - they keep
 * scrubbing nothing until someone edits them, and the rules tables flag them
 * (Types/Telemetry/ScrubRule doesScrubRuleScrubNothing). An update that does
 * not touch these columns (a rename, switching the rule off, a drag to
 * another place in the list) is not held up by them. An unknown scrub action
 * is not refused: ingest redacts with it, which is safe.
 */

export interface ScrubRuleCandidate {
  patternType?: unknown;
  customRegex?: unknown;
  fieldsToScrub?: unknown;
}

export interface ScrubRuleValidationOptions {
  // "logs" or "spans", so the message reads like the page the user is on.
  recordNoun: string;
  // The pattern types ingest knows for these records.
  patternTypes: ReadonlyArray<string>;
  // The fields-to-scrub values ingest knows for these records.
  fieldsToScrub: ReadonlyArray<string>;
}

// The columns that decide whether a rule scrubs anything.
export const SCRUB_RULE_VALIDATED_COLUMNS: ReadonlyArray<
  keyof ScrubRuleCandidate
> = ["patternType", "customRegex", "fieldsToScrub"];

export function getScrubRuleCustomRegexRefusal(
  check: ScrubRuleCustomRegexCheck,
  options: ScrubRuleValidationOptions,
): string {
  switch (check.problem) {
    case ScrubRuleCustomRegexProblem.Missing:
      return "A Custom Regex rule needs a regular expression to match. Without one it scrubs nothing. Enter the pattern, or pick another pattern type.";
    case ScrubRuleCustomRegexProblem.Invalid:
      return `The custom pattern is not a valid regular expression (${check.reason || "it does not compile"}), so the rule would scrub nothing. Fix the pattern, or pick another pattern type.`;
    case ScrubRuleCustomRegexProblem.MatchesEmptyText:
    default:
      return `The custom pattern matches empty text, so it would put its replacement between every character of your ${options.recordNoun}. Make it match at least one character.`;
  }
}

export function validateScrubRulePatternType(
  patternType: unknown,
  options: ScrubRuleValidationOptions,
): void {
  if (typeof patternType !== "string" || patternType.trim().length === 0) {
    throw new BadDataException(
      `Pattern type is required: one of ${options.patternTypes.join(", ")}.`,
    );
  }

  if (!options.patternTypes.includes(patternType)) {
    throw new BadDataException(
      `Pattern type "${patternType}" is not one ingest can scrub with, so the rule would scrub nothing. Use one of ${options.patternTypes.join(", ")}.`,
    );
  }
}

export function validateScrubRuleFieldsToScrub(
  fieldsToScrub: unknown,
  options: ScrubRuleValidationOptions,
): void {
  // Left out of a create, the column's default applies: every field.
  if (fieldsToScrub === undefined || fieldsToScrub === null) {
    return;
  }

  if (
    typeof fieldsToScrub !== "string" ||
    !options.fieldsToScrub.includes(fieldsToScrub)
  ) {
    throw new BadDataException(
      `Fields to scrub "${String(fieldsToScrub)}" is not one ingest knows, so the rule would scrub none of your ${options.recordNoun}' fields. Use one of ${options.fieldsToScrub.join(", ")}.`,
    );
  }
}

/*
 * Validate a fully resolved rule. Callers building this from an update must
 * merge the incoming partial over the stored row first, so a request that
 * switches a rule to Custom Regex without sending a pattern is still caught
 * (validateScrubRuleUpdate does).
 */
export function validateScrubRule(
  candidate: ScrubRuleCandidate,
  options: ScrubRuleValidationOptions,
): void {
  validateScrubRulePatternType(candidate.patternType, options);

  /*
   * A sensitive-keys rule reads attribute keys, so ingest runs it on
   * attributes whatever its fields say - and the form does not ask for them.
   */
  if (candidate.patternType !== SCRUB_RULE_SENSITIVE_KEYS_PATTERN_TYPE) {
    validateScrubRuleFieldsToScrub(candidate.fieldsToScrub, options);
  }

  if (candidate.patternType !== SCRUB_RULE_CUSTOM_PATTERN_TYPE) {
    return;
  }

  const check: ScrubRuleCustomRegexCheck | null = checkScrubRuleCustomRegex(
    candidate.customRegex,
  );

  if (check) {
    throw new BadDataException(getScrubRuleCustomRegexRefusal(check, options));
  }
}

// A rule as a create hands it to the service's onBeforeCreate.
export function validateScrubRuleCreate(
  data: ScrubRuleCandidate,
  options: ScrubRuleValidationOptions,
): void {
  validateScrubRule(
    {
      patternType: data.patternType,
      customRegex: data.customRegex,
      fieldsToScrub: data.fieldsToScrub,
    },
    options,
  );
}

/*
 * An update: every row it matches, with the incoming values laid over what
 * is stored.
 *
 * The services call this from onBeforeUpdateUniqueCheck, which runs once the
 * caller has passed the permission checks: the rows read here, as root, are
 * the ones the update writes - those the caller may write - and the update is
 * held to them, so they are never another project's, a refusal never tells a
 * caller about a rule they may not see, and no rule is written unchecked. The rows are read only when the update touches a column that decides
 * whether the rule scrubs anything, so renaming a rule, switching it off or
 * dragging it to another place in the list costs no read - and is never held
 * up by a rule that was saved broken before this check existed.
 */
export async function validateScrubRuleUpdate<
  TModel extends BaseModel & ScrubRuleCandidate,
>(data: {
  updateBy: UpdateBy<TModel>;
  /*
   * The service's own findRowsAndHoldUpdateToThem for this update: the rows
   * it writes, with the update held to them.
   */
  findRowsAndHoldUpdateToThem: (
    select: Select<TModel>,
  ) => Promise<Array<TModel>>;
  options: ScrubRuleValidationOptions;
}): Promise<void> {
  const incoming: ScrubRuleCandidate = {
    patternType: (data.updateBy.data as ScrubRuleCandidate).patternType,
    customRegex: (data.updateBy.data as ScrubRuleCandidate).customRegex,
    fieldsToScrub: (data.updateBy.data as ScrubRuleCandidate).fieldsToScrub,
  };

  const touchesValidatedColumns: boolean = SCRUB_RULE_VALIDATED_COLUMNS.some(
    (column: keyof ScrubRuleCandidate): boolean => {
      return incoming[column] !== undefined;
    },
  );

  if (!touchesValidatedColumns) {
    return;
  }

  // A raw SQL expression cannot be judged here. See isSqlExpressionValue.
  if (
    SCRUB_RULE_VALIDATED_COLUMNS.some(
      (column: keyof ScrubRuleCandidate): boolean => {
        return isSqlExpressionValue(incoming[column]);
      },
    )
  ) {
    return;
  }

  const storedRows: Array<TModel> = await data.findRowsAndHoldUpdateToThem({
    _id: true,
    patternType: true,
    customRegex: true,
    fieldsToScrub: true,
  } as Select<TModel>);

  for (const stored of storedRows) {
    const merged: ScrubRuleCandidate = {
      patternType:
        incoming.patternType !== undefined
          ? incoming.patternType
          : stored.patternType,
      customRegex:
        incoming.customRegex !== undefined
          ? incoming.customRegex
          : stored.customRegex,
      fieldsToScrub:
        incoming.fieldsToScrub !== undefined
          ? incoming.fieldsToScrub
          : stored.fieldsToScrub,
    };

    validateScrubRule(merged, data.options);
  }
}
