import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import TraceScrubRule from "Common/Models/DatabaseModels/TraceScrubRule";
import LogScrubAction from "Common/Types/Log/LogScrubAction";
import LogScrubField from "Common/Types/Log/LogScrubField";
import LogScrubPatternType from "Common/Types/Log/LogScrubPatternType";
import {
  checkScrubRuleCustomRegex,
  LOG_SCRUB_RULE_DEFAULTS,
  SCRUB_RULE_CUSTOM_PATTERN_TYPE,
  SCRUB_RULE_SENSITIVE_KEYS_PATTERN_TYPE,
  ScrubRuleCustomRegexCheck,
  ScrubRuleCustomRegexProblem,
  ScrubRuleDefaults,
  TRACE_SCRUB_RULE_DEFAULTS,
} from "Common/Types/Telemetry/ScrubRule";
import TraceScrubField from "Common/Types/Trace/TraceScrubField";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import {
  getAdvancedFormSection,
  normalizeFormValue,
} from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { getNameAfterPick } from "Common/UI/Components/Forms/Utils/FollowPickName";
import {
  translateTemplate,
  translateText,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * CREATE A LOG OR TRACE SCRUB RULE: START FROM WHAT IT SCRUBS.
 *
 * Logs > Settings > Scrub Rules and Traces > Settings > Scrub Rules build
 * their create and edit form here, so the two ask the same questions in the
 * same words. The form used to open on a "Basic Info" step that asked for a
 * name before anyone had said what the rule was for, then walked Pattern
 * Configuration and Scrub Settings, where Scrub Action and Fields to Scrub
 * opened as empty required dropdowns although the server has a default for
 * both. It is one page now:
 *
 *   - Pattern Type: what the rule finds. The one real question.
 *   - Custom Regex Pattern, only for Custom Regex, right under the type, and
 *     required there: a custom rule saved without a pattern, or with one
 *     that does not compile, scrubbed nothing while it looked active, so the
 *     personal data it was made for was stored in the clear. The form checks
 *     the pattern the way ingest compiles it (Types/Telemetry/ScrubRule), and
 *     the server refuses it too (Server/Utils/ScrubRuleValidation).
 *   - Name, filled in from the pattern type - "Scrub email addresses" - and
 *     following it until somebody types a name of their own
 *     (Forms/Utils/FollowPickName, the rule every such name follows).
 *   - Advanced, folded: the description, the scrub action, the fields to
 *     scrub and Enabled, starting at the defaults the server stores when
 *     they are left out (redact, every field, on). While they are left
 *     alone the folded header says what they do, so nobody has to open it
 *     to know; changed, it says "Configured".
 *
 * Four rows, the fourth only for a custom pattern, right under the choice it
 * belongs to - so one page (LongFormStepsGuard: LONG_FORMS_WITHOUT_STEPS).
 */

/*
 * The names a rule starts with, after its pattern type: what it does, in the
 * reader's language, until its creator names it.
 */
export const SCRUB_RULE_DEFAULT_NAMES: Record<string, string> = {
  [LogScrubPatternType.Email]: translationKey("Scrub email addresses"),
  [LogScrubPatternType.CreditCard]: translationKey("Scrub credit card numbers"),
  [LogScrubPatternType.SSN]: translationKey("Scrub Social Security numbers"),
  [LogScrubPatternType.PhoneNumber]: translationKey("Scrub phone numbers"),
  [LogScrubPatternType.IPAddress]: translationKey("Scrub IP addresses"),
  [LogScrubPatternType.SensitiveKeys]: translationKey(
    "Scrub sensitive attributes",
  ),
  [LogScrubPatternType.Custom]: translationKey("Scrub custom pattern"),
};

export const SCRUB_RULE_NAME_HELP: string = translationKey(
  "Named after the pattern type until you type a name of your own.",
);

export const SCRUB_RULE_CUSTOM_REGEX_HELP: string = translationKey(
  "A regular expression for the text to scrub, without slashes or flags. Matching is case-sensitive.",
);

export const SCRUB_RULE_CUSTOM_REGEX_MISSING: string = translationKey(
  "Enter the regular expression to match. Without one, this rule would scrub nothing.",
);

export const SCRUB_RULE_CUSTOM_REGEX_INVALID: string = translationKey(
  "This is not a valid regular expression: {{reason}}",
);

export const SCRUB_RULE_CUSTOM_REGEX_MATCHES_EMPTY_TEXT: string =
  translationKey(
    "This pattern matches empty text, so it would put its replacement between every character. Make it match at least one character.",
  );

/*
 * What the folded Advanced section says while everything in it is left at
 * its default.
 */
export const LOG_SCRUB_RULE_DEFAULTS_SUMMARY: string = translationKey(
  "Matches are replaced with [REDACTED] in the log body and attributes.",
);

export const TRACE_SCRUB_RULE_DEFAULTS_SUMMARY: string = translationKey(
  "Matches are replaced with [REDACTED] in span names, attributes and event attributes.",
);

export const SENSITIVE_KEYS_SCRUB_RULE_DEFAULTS_SUMMARY: string =
  translationKey(
    "The values of attributes whose key looks sensitive are replaced with [REDACTED].",
  );

/**
 * The name a rule of this pattern type starts with, in the reader's
 * language; empty before a type is picked.
 */
export const getDefaultScrubRuleName: (patternType: unknown) => string = (
  patternType: unknown,
): string => {
  const type: unknown = normalizeFormValue(patternType);
  const name: string | undefined =
    typeof type === "string" ? SCRUB_RULE_DEFAULT_NAMES[type] : undefined;

  if (!name) {
    return "";
  }

  return translateText(name) || name;
};

/**
 * The name once another pattern type is picked: the new type's name, while
 * the name is still the form's own - empty, or the name of the type picked
 * before. Null when it stays as it is: somebody typed a name of their own,
 * or the type did not change.
 */
export const getScrubRuleNameAfterPatternChange: (data: {
  name: unknown;
  previousPatternType: unknown;
  patternType: unknown;
}) => string | null = (data: {
  name: unknown;
  previousPatternType: unknown;
  patternType: unknown;
}): string | null => {
  const previous: unknown = normalizeFormValue(data.previousPatternType);
  const next: unknown = normalizeFormValue(data.patternType);

  if (previous === next) {
    return null;
  }

  return getNameAfterPick({
    name: data.name,
    pickedName: getDefaultScrubRuleName(next),
    filledInNames: [getDefaultScrubRuleName(previous)],
  });
};

/**
 * The custom pattern's problem in the reader's language, or null - for the
 * form's customValidation. The same check the server makes.
 */
export const getScrubRuleCustomRegexError: (
  customRegex: unknown,
) => string | null = (customRegex: unknown): string | null => {
  const check: ScrubRuleCustomRegexCheck | null =
    checkScrubRuleCustomRegex(customRegex);

  if (!check) {
    return null;
  }

  switch (check.problem) {
    case ScrubRuleCustomRegexProblem.Missing:
      return (
        translateText(SCRUB_RULE_CUSTOM_REGEX_MISSING) ||
        SCRUB_RULE_CUSTOM_REGEX_MISSING
      );
    case ScrubRuleCustomRegexProblem.Invalid:
      return translateTemplate(SCRUB_RULE_CUSTOM_REGEX_INVALID, {
        reason: check.reason || "",
      });
    case ScrubRuleCustomRegexProblem.MatchesEmptyText:
    default:
      return (
        translateText(SCRUB_RULE_CUSTOM_REGEX_MATCHES_EMPTY_TEXT) ||
        SCRUB_RULE_CUSTOM_REGEX_MATCHES_EMPTY_TEXT
      );
  }
};

type IsPatternTypeFunction = (values: FormValues<LogScrubRule>) => boolean;

const isCustomPattern: IsPatternTypeFunction = (
  values: FormValues<LogScrubRule>,
): boolean => {
  return (
    normalizeFormValue(values.patternType) === SCRUB_RULE_CUSTOM_PATTERN_TYPE
  );
};

/*
 * A sensitive-keys rule reads attribute keys, so ingest scrubs attribute
 * values with it whatever its fields-to-scrub says: the form does not ask.
 */
const isSensitiveKeysPattern: IsPatternTypeFunction = (
  values: FormValues<LogScrubRule>,
): boolean => {
  return (
    normalizeFormValue(values.patternType) ===
    SCRUB_RULE_SENSITIVE_KEYS_PATTERN_TYPE
  );
};

type IsLeftAtFunction = (value: unknown, defaultValue: unknown) => boolean;

// Never touched, or still the value it starts with.
const isLeftAt: IsLeftAtFunction = (
  value: unknown,
  defaultValue: unknown,
): boolean => {
  const current: unknown = normalizeFormValue(value);

  return current === undefined || current === null || current === defaultValue;
};

export interface ScrubRuleFormOptions {
  defaults: ScrubRuleDefaults;
  // The choices of Fields to Scrub, the default first.
  fieldsToScrubOptions: Array<DropdownOption>;
  fieldsToScrubHelp: string;
  // What the folded section says while its default scrub scope is kept.
  defaultsSummary: string;
}

/**
 * What the folded Advanced section says while everything in it is left at
 * its default - nothing once something is changed, so the header says
 * "Configured" instead.
 */
export const getScrubRuleAdvancedSummary: (
  options: ScrubRuleFormOptions,
  values: FormValues<LogScrubRule>,
) => Array<string> | undefined = (
  options: ScrubRuleFormOptions,
  values: FormValues<LogScrubRule>,
): Array<string> | undefined => {
  const formValues: Record<string, unknown> = (values || {}) as Record<
    string,
    unknown
  >;
  const sensitiveKeys: boolean = isSensitiveKeysPattern(
    formValues as FormValues<LogScrubRule>,
  );
  const description: unknown = formValues["description"];

  const isAtDefaults: boolean =
    (typeof description !== "string" || description.trim().length === 0) &&
    isLeftAt(formValues["scrubAction"], options.defaults.scrubAction) &&
    // Not asked for a sensitive-keys rule, so not judged.
    (sensitiveKeys ||
      isLeftAt(formValues["fieldsToScrub"], options.defaults.fieldsToScrub)) &&
    isLeftAt(formValues["isEnabled"], options.defaults.isEnabled);

  if (!isAtDefaults) {
    return undefined;
  }

  return [
    sensitiveKeys
      ? SENSITIVE_KEYS_SCRUB_RULE_DEFAULTS_SUMMARY
      : options.defaultsSummary,
  ];
};

export const LOG_SCRUB_RULE_FORM_OPTIONS: ScrubRuleFormOptions = {
  defaults: LOG_SCRUB_RULE_DEFAULTS,
  fieldsToScrubOptions: [
    { label: "Both (Body & Attributes)", value: LogScrubField.Both },
    { label: "Body Only", value: LogScrubField.Body },
    { label: "Attributes Only", value: LogScrubField.Attributes },
  ],
  fieldsToScrubHelp: translationKey(
    "Which parts of the log to scrub: the log body (message), attribute values, or both.",
  ),
  defaultsSummary: LOG_SCRUB_RULE_DEFAULTS_SUMMARY,
};

export const TRACE_SCRUB_RULE_FORM_OPTIONS: ScrubRuleFormOptions = {
  defaults: TRACE_SCRUB_RULE_DEFAULTS,
  fieldsToScrubOptions: [
    { label: "All (Name, Attributes & Events)", value: TraceScrubField.All },
    { label: "Span Name Only", value: TraceScrubField.Name },
    { label: "Attributes Only", value: TraceScrubField.Attributes },
    { label: "Event Attributes Only", value: TraceScrubField.Events },
  ],
  fieldsToScrubHelp: translationKey(
    "Which parts of the span to scrub: span name, attribute values, event attribute values, or all.",
  ),
  defaultsSummary: TRACE_SCRUB_RULE_DEFAULTS_SUMMARY,
};

/*
 * The fields of both pages' forms. Written once over LogScrubRule: a trace
 * scrub rule has the same columns (TraceScrubRule), so the trace page takes
 * the same list (getTraceScrubRuleFormFields).
 */
const getScrubRuleFormFields: (
  options: ScrubRuleFormOptions,
) => Array<ModelField<LogScrubRule>> = (
  options: ScrubRuleFormOptions,
): Array<ModelField<LogScrubRule>> => {
  const advanced: FormFieldCollapsibleSection<LogScrubRule> =
    getAdvancedFormSection<LogScrubRule>({
      getSummary: (
        values: FormValues<LogScrubRule>,
      ): Array<string> | undefined => {
        return getScrubRuleAdvancedSummary(options, values);
      },
    });

  return [
    {
      field: {
        patternType: true,
      },
      title: "Pattern Type",
      description:
        "The type of sensitive data to detect. Select 'Custom' to provide your own regex pattern.",
      fieldType: FormFieldSchemaType.Dropdown,
      required: true,
      dropdownOptions: [
        { label: "Email Address", value: LogScrubPatternType.Email },
        { label: "Credit Card Number", value: LogScrubPatternType.CreditCard },
        {
          label: "SSN (Social Security Number)",
          value: LogScrubPatternType.SSN,
        },
        { label: "Phone Number", value: LogScrubPatternType.PhoneNumber },
        { label: "IP Address", value: LogScrubPatternType.IPAddress },
        {
          label: "Sensitive Attribute Keys",
          value: LogScrubPatternType.SensitiveKeys,
        },
        { label: "Custom Regex", value: LogScrubPatternType.Custom },
      ],
      /*
       * The name follows the pattern type until somebody types their own.
       * The values handed in are the form's before this pick, so their
       * patternType is the type picked before.
       */
      onChange: (
        value: unknown,
        currentValues: FormValues<LogScrubRule>,
        setNewFormValues: (values: FormValues<LogScrubRule>) => void,
      ): void => {
        const name: string | null = getScrubRuleNameAfterPatternChange({
          name: currentValues.name,
          previousPatternType: currentValues.patternType,
          patternType: value,
        });

        if (name === null) {
          return;
        }

        setNewFormValues({
          ...currentValues,
          name: name,
        });
      },
    },
    {
      field: {
        customRegex: true,
      },
      title: "Custom Regex Pattern",
      description: SCRUB_RULE_CUSTOM_REGEX_HELP,
      fieldType: FormFieldSchemaType.Text,
      /*
       * Required, but only while Custom Regex is picked: the form skips
       * hidden fields when it validates.
       */
      required: true,
      placeholder: "e.g. \\bSECRET-[A-Z0-9]+\\b",
      showIf: isCustomPattern,
      customValidation: (values: FormValues<LogScrubRule>): string | null => {
        return getScrubRuleCustomRegexError(values.customRegex);
      },
    },
    {
      field: {
        name: true,
      },
      title: "Name",
      description: SCRUB_RULE_NAME_HELP,
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "e.g. Scrub Email Addresses",
      validation: {
        minLength: 2,
      },
    },
    {
      field: {
        description: true,
      },
      title: "Description",
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      placeholder: "Describe what this scrub rule does.",
      collapsibleSection: advanced,
    },
    {
      field: {
        scrubAction: true,
      },
      title: "Scrub Action",
      description:
        "How to handle matched data. Mask: partially hide (e.g. j***@***.com). Hash: replace with deterministic hash. Redact: replace with [REDACTED].",
      fieldType: FormFieldSchemaType.Dropdown,
      required: true,
      dropdownOptions: [
        { label: "Redact", value: LogScrubAction.Redact },
        { label: "Mask", value: LogScrubAction.Mask },
        { label: "Hash", value: LogScrubAction.Hash },
      ],
      /*
       * What the server stores when it is left out, written on the field
       * so an Edit form compares with it too: ModelForm gives a field its
       * column default on Create only, and a folded section says
       * "Configured" for a value other than the field's default.
       */
      defaultValue: options.defaults.scrubAction,
      collapsibleSection: advanced,
    },
    {
      field: {
        fieldsToScrub: true,
      },
      title: "Fields to Scrub",
      description: options.fieldsToScrubHelp,
      fieldType: FormFieldSchemaType.Dropdown,
      required: true,
      dropdownOptions: options.fieldsToScrubOptions,
      defaultValue: options.defaults.fieldsToScrub,
      showIf: (values: FormValues<LogScrubRule>): boolean => {
        return !isSensitiveKeysPattern(values);
      },
      collapsibleSection: advanced,
    },
    {
      field: {
        isEnabled: true,
      },
      title: "Enabled",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      defaultValue: options.defaults.isEnabled,
      collapsibleSection: advanced,
    },
  ];
};

export const getLogScrubRuleFormFields: () => Array<
  ModelField<LogScrubRule>
> = (): Array<ModelField<LogScrubRule>> => {
  return getScrubRuleFormFields(LOG_SCRUB_RULE_FORM_OPTIONS);
};

export const getTraceScrubRuleFormFields: () => Array<
  ModelField<TraceScrubRule>
> = (): Array<ModelField<TraceScrubRule>> => {
  return getScrubRuleFormFields(
    TRACE_SCRUB_RULE_FORM_OPTIONS,
  ) as unknown as Array<ModelField<TraceScrubRule>>;
};
