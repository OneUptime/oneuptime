import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import Service from "Common/Models/DatabaseModels/Service";
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
import { ScrubRuleAddressSignal } from "Common/Types/Telemetry/ScrubRuleAddresses";
import {
  checkScrubRuleKeys,
  MAX_SCRUB_RULE_KEY_LENGTH,
  MAX_SCRUB_RULE_KEYS,
  SCRUB_RULE_NAMED_KEYS_PATTERN_TYPE,
  ScrubRuleKeysProblem,
} from "Common/Types/Telemetry/ScrubRuleKeys";
import { TelemetryFieldSignal } from "Common/Types/Telemetry/TelemetryFieldReaders";
import TraceScrubField from "Common/Types/Trace/TraceScrubField";
import { isScrubRuleHidingAddresses } from "Common/Utils/SecurityEvent/ScrubbedAddress";
import { PatternProblemReason } from "Common/Utils/LinearRegExp/PatternProblem";
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
import type { RadioButton } from "Common/UI/Components/RadioButtons/GroupRadioButtons";
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
 *     scrub, the one service the rule is for (#10433) and Enabled, starting
 *     at the defaults the server stores when they are left out (redact,
 *     every field, every service, on). While they are left alone the
 *     folded header says what they do, so nobody has to open it to know;
 *     changed, it says "Configured".
 *   - Under the name, what reads the values the rule would hide - the
 *     monitors, dashboards, saved views, recording rules and SLOs, and
 *     Security Events - before the rule is saved (ScrubRuleReadersPreview,
 *     #10433). It never blocks the save.
 *   - Attributes to Hide, only for Named Attributes (#10366), right under
 *     the type, and required there: the attributes whose whole value the
 *     rule hides, whatever it holds - a person's name under customer_name,
 *     a password under db.password. One a line; a key names the
 *     attributes nested under it too.
 *
 * Three rows, the third only for a custom pattern or named attributes,
 * right under the choice it belongs to - so one page (LongFormStepsGuard:
 * LONG_FORMS_WITHOUT_STEPS).
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
  [LogScrubPatternType.NamedKeys]: translationKey("Scrub named attributes"),
};

/*
 * Named Attributes (#10366): what it hides, under its choice, and what
 * the field of its attributes says - or why the keys cannot be saved.
 */
export const SCRUB_RULE_NAMED_KEYS_HELP: string = translationKey(
  "Hides the whole value of the attributes you name, whatever it holds.",
);

export const SCRUB_RULE_ATTRIBUTE_KEYS_HELP: string = translationKey(
  "One attribute key a line, such as customer_name. A key hides the attributes nested under it too.",
);

export const SCRUB_RULE_ATTRIBUTE_KEYS_MISSING: string = translationKey(
  "Name at least one attribute. Without one, this rule would hide nothing.",
);

export const SCRUB_RULE_ATTRIBUTE_KEYS_TOO_MANY: string = translationKey(
  "A rule names at most {{count}} attributes.",
);

export const SCRUB_RULE_ATTRIBUTE_KEYS_TOO_LONG: string = translationKey(
  "An attribute key is at most {{length}} characters.",
);

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
 * A regular expression the server cannot run (Utils/LinearRegExp): scrub
 * patterns are run on every log and span, in time that may only grow in line
 * with the text they read.
 */
export const SCRUB_RULE_CUSTOM_REGEX_BACK_REFERENCE: string = translationKey(
  "This pattern refers back to what an earlier group matched, such as \\1. Patterns are run in time that grows only in line with the text they read, which a back-reference cannot do. Write the pattern without it.",
);

export const SCRUB_RULE_CUSTOM_REGEX_TOO_LARGE: string = translationKey(
  "This pattern is too large to run. Shorten it, or repeat its parts fewer times.",
);

/*
 * Scrub Action's three answers, each with the one line that says what it
 * leaves in the record. The field's description used to explain all three
 * at once ("Mask: partially hide (e.g. j***@***.com). Hash: replace with
 * deterministic hash. Redact: replace with [REDACTED].") above a dropdown
 * that hid them; Redact, what the server stores when none is picked,
 * comes first.
 */
export const SCRUB_ACTION_CHOICES: Array<RadioButton> = [
  {
    title: translationKey("Redact"),
    value: LogScrubAction.Redact,
    description: translationKey("Replaces each match with [REDACTED]."),
  },
  {
    title: translationKey("Mask"),
    value: LogScrubAction.Mask,
    description: translationKey(
      "Keeps a hint of it, such as j***@***.com or a card's last four digits.",
    ),
  },
  /*
   * A token keyed with the project's own key (Common/Server/Utils/Telemetry/
   * ScrubHashToken, #10394): it used to be a short unkeyed hash, which
   * anyone could work back to an IP address, an SSN or a phone number.
   */
  {
    title: translationKey("Hash"),
    value: LogScrubAction.Hash,
    description: translationKey(
      "Replaces it with a token unique to this project, so equal values still look alike and no one can work back to the value.",
    ),
  },
];

/*
 * What the IP Address pattern hides, under its choice: what Data Security
 * calls an IP address, and not the addresses of a project's own network
 * (Common/Utils/Telemetry/ScrubIpAddress, #10393).
 */
export const SCRUB_RULE_IP_ADDRESS_HELP: string = translationKey(
  "Public IPv4 and IPv6 addresses, not private, loopback or link-local ones.",
);

/*
 * What the folded Advanced section says while everything in it is left at
 * its default.
 */
export const LOG_SCRUB_RULE_DEFAULTS_SUMMARY: string = translationKey(
  "Matches are replaced with [REDACTED] in the log body and attributes.",
);

/*
 * All reaches every text a span stores: its name and status message, its
 * attributes, its events (their names and attributes) and its links'
 * attributes (#6513).
 */
export const TRACE_SCRUB_RULE_DEFAULTS_SUMMARY: string = translationKey(
  "Matches are replaced with [REDACTED] in span names, status messages, attributes, events and links.",
);

// A span's, its events' and its links' attributes.
export const SENSITIVE_KEYS_SCRUB_RULE_DEFAULTS_SUMMARY: string =
  translationKey(
    "The values of attributes whose key looks sensitive are replaced with [REDACTED].",
  );

/*
 * A log's attributes, and a body that is a map or a list: one sent so, or
 * written as JSON (#6513).
 */
export const LOG_SENSITIVE_KEYS_SCRUB_RULE_DEFAULTS_SUMMARY: string =
  translationKey(
    "The values of keys that look sensitive, in attributes and in a JSON log body, are replaced with [REDACTED].",
  );

// A Named Attributes rule's (#10366): the values of the attributes it names.
export const NAMED_KEYS_SCRUB_RULE_DEFAULTS_SUMMARY: string = translationKey(
  "The whole value of each attribute you name is replaced with [REDACTED].",
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
    case ScrubRuleCustomRegexProblem.CannotRun:
      return check.cannotRunReason === PatternProblemReason.TooLarge
        ? translateText(SCRUB_RULE_CUSTOM_REGEX_TOO_LARGE) ||
            SCRUB_RULE_CUSTOM_REGEX_TOO_LARGE
        : translateText(SCRUB_RULE_CUSTOM_REGEX_BACK_REFERENCE) ||
            SCRUB_RULE_CUSTOM_REGEX_BACK_REFERENCE;
    case ScrubRuleCustomRegexProblem.MatchesEmptyText:
    default:
      return (
        translateText(SCRUB_RULE_CUSTOM_REGEX_MATCHES_EMPTY_TEXT) ||
        SCRUB_RULE_CUSTOM_REGEX_MATCHES_EMPTY_TEXT
      );
  }
};

/**
 * The keys' problem in the reader's language, or null - for the form's
 * customValidation. The same check the server makes.
 */
export const getScrubRuleAttributeKeysError: (data: {
  patternType: unknown;
  attributeKeys: unknown;
}) => string | null = (data: {
  patternType: unknown;
  attributeKeys: unknown;
}): string | null => {
  const problem: ScrubRuleKeysProblem | null = checkScrubRuleKeys({
    patternType: normalizeFormValue(data.patternType),
    attributeKeys: data.attributeKeys,
  });

  switch (problem) {
    case ScrubRuleKeysProblem.Missing:
      return (
        translateText(SCRUB_RULE_ATTRIBUTE_KEYS_MISSING) ||
        SCRUB_RULE_ATTRIBUTE_KEYS_MISSING
      );
    case ScrubRuleKeysProblem.TooMany:
      return translateTemplate(SCRUB_RULE_ATTRIBUTE_KEYS_TOO_MANY, {
        count: String(MAX_SCRUB_RULE_KEYS),
      });
    case ScrubRuleKeysProblem.TooLong:
      return translateTemplate(SCRUB_RULE_ATTRIBUTE_KEYS_TOO_LONG, {
        length: String(MAX_SCRUB_RULE_KEY_LENGTH),
      });
    default:
      return null;
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
 * A sensitive-keys rule reads keys - attributes', and a JSON log body's -
 * so ingest runs it whatever its fields-to-scrub says: the form does not
 * ask.
 */
const isSensitiveKeysPattern: IsPatternTypeFunction = (
  values: FormValues<LogScrubRule>,
): boolean => {
  return (
    normalizeFormValue(values.patternType) ===
    SCRUB_RULE_SENSITIVE_KEYS_PATTERN_TYPE
  );
};

// A Named Attributes rule (#10366): it names the attributes it hides whole.
const isNamedKeysPattern: IsPatternTypeFunction = (
  values: FormValues<LogScrubRule>,
): boolean => {
  return (
    normalizeFormValue(values.patternType) ===
    SCRUB_RULE_NAMED_KEYS_PATTERN_TYPE
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
  // The records the rule scrubs: what reads them is asked about (#10433).
  signal: TelemetryFieldSignal;
  defaults: ScrubRuleDefaults;
  // What the one-service field says: the rule scrubs every service's records without one.
  serviceHelp: string;
  // The choices of Fields to Scrub, the default first.
  fieldsToScrubOptions: Array<DropdownOption>;
  fieldsToScrubHelp: string;
  // What the folded section says while its default scrub scope is kept.
  defaultsSummary: string;
  // What it says for a sensitive-keys rule, which has no scope to choose.
  sensitiveKeysSummary: string;
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
  const service: unknown = normalizeFormValue(formValues["service"]);

  const isAtDefaults: boolean =
    (typeof description !== "string" || description.trim().length === 0) &&
    // Every service, as a rule saved before a rule could name one (#10433).
    (service === undefined || service === null || service === "") &&
    isLeftAt(formValues["scrubAction"], options.defaults.scrubAction) &&
    // Not asked for a sensitive-keys rule, so not judged.
    (sensitiveKeys ||
      isLeftAt(formValues["fieldsToScrub"], options.defaults.fieldsToScrub)) &&
    isLeftAt(formValues["isEnabled"], options.defaults.isEnabled);

  if (!isAtDefaults) {
    return undefined;
  }

  if (isNamedKeysPattern(formValues as FormValues<LogScrubRule>)) {
    return [NAMED_KEYS_SCRUB_RULE_DEFAULTS_SUMMARY];
  }

  return [
    sensitiveKeys ? options.sensitiveKeysSummary : options.defaultsSummary,
  ];
};

// A rule names one service, or scrubs every service's records (#10433).
export const LOG_SCRUB_RULE_SERVICE_HELP: string = translationKey(
  "Leave empty to scrub the logs of every service.",
);
export const TRACE_SCRUB_RULE_SERVICE_HELP: string = translationKey(
  "Leave empty to scrub the spans of every service.",
);

export const LOG_SCRUB_RULE_FORM_OPTIONS: ScrubRuleFormOptions = {
  signal: "log",
  serviceHelp: LOG_SCRUB_RULE_SERVICE_HELP,
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
  sensitiveKeysSummary: LOG_SENSITIVE_KEYS_SCRUB_RULE_DEFAULTS_SUMMARY,
};

export const TRACE_SCRUB_RULE_FORM_OPTIONS: ScrubRuleFormOptions = {
  signal: "trace",
  serviceHelp: TRACE_SCRUB_RULE_SERVICE_HELP,
  defaults: TRACE_SCRUB_RULE_DEFAULTS,
  fieldsToScrubOptions: [
    { label: "All (Name, Attributes & Events)", value: TraceScrubField.All },
    { label: "Span Name Only", value: TraceScrubField.Name },
    { label: "Attributes Only", value: TraceScrubField.Attributes },
    { label: "Event Attributes Only", value: TraceScrubField.Events },
  ],
  /*
   * Attributes Only and All scrub a link's attributes with the span's own
   * (#6507), and All the status message and the events' names too (#6513).
   */
  fieldsToScrubHelp: translationKey(
    "Which parts of the span to scrub: span name, attribute and link attribute values, event attribute values, or all, status message and event names too.",
  ),
  defaultsSummary: TRACE_SCRUB_RULE_DEFAULTS_SUMMARY,
  sensitiveKeysSummary: SENSITIVE_KEYS_SCRUB_RULE_DEFAULTS_SUMMARY,
};

/*
 * What a page draws under the rule's name: what reads the values the rule
 * would hide (FieldReaders/ScrubRuleReadersPreview, #10433), from the
 * form's values as they are. The page hands it in, so this file - read by
 * the words and docs tests outside a browser - draws nothing that asks the
 * server. What it draws is named as the forms' own Field type names a
 * footer's: this file imports nothing of React, so the App's tests, which
 * type-check and run with no React installed, read it as the pages do.
 */
type ScrubRuleFooterElement = ReturnType<
  NonNullable<ModelField<LogScrubRule>["getFooterElement"]>
>;

export type ScrubRuleReadersFooter = (
  values: FormValues<LogScrubRule>,
) => ScrubRuleFooterElement;

/*
 * What a page draws under the rule's action choices: the notice an IP
 * Address rule that redacts or masks gets in a project where Security
 * Events reads that kind of record (#10396). The page knows which kinds it
 * reads, and hands the element in.
 */
export type ScrubRuleActionFooter = (
  values: FormValues<LogScrubRule>,
) => ReactElement | undefined;

/*
 * Whether the rule as the form holds it would keep Security Events from
 * naming the addresses it hides: an IP Address rule that redacts or masks
 * (left alone, it redacts) a part of the records Security Events reads
 * the address from (a log's body or attributes, a span's attributes), of a
 * kind of record Security Events reads (#10396). The same question the
 * notice on a saved rule asks (Utils/SecurityEvent/ScrubbedAddress).
 */
export function doesFormRuleHideAddresses(data: {
  options: ScrubRuleFormOptions;
  values: FormValues<LogScrubRule>;
  signalsRead: ReadonlyArray<ScrubRuleAddressSignal>;
}): boolean {
  const formValues: Record<string, unknown> = (data.values || {}) as Record<
    string,
    unknown
  >;
  const patternType: unknown = normalizeFormValue(formValues["patternType"]);
  const scrubAction: unknown = normalizeFormValue(formValues["scrubAction"]);
  const fieldsToScrub: unknown = normalizeFormValue(
    formValues["fieldsToScrub"],
  );

  if (
    patternType !== LogScrubPatternType.IPAddress ||
    !data.signalsRead.includes(data.options.signal)
  ) {
    return false;
  }

  return isScrubRuleHidingAddresses(
    {
      patternType: patternType,
      scrubAction:
        typeof scrubAction === "string" && scrubAction
          ? scrubAction
          : data.options.defaults.scrubAction,
      fieldsToScrub:
        typeof fieldsToScrub === "string" && fieldsToScrub
          ? fieldsToScrub
          : data.options.defaults.fieldsToScrub,
    },
    data.options.signal,
  );
}

/*
 * The fields of both pages' forms. Written once over LogScrubRule: a trace
 * scrub rule has the same columns (TraceScrubRule), so the trace page takes
 * the same list (getTraceScrubRuleFormFields).
 */
const getScrubRuleFormFields: (
  options: ScrubRuleFormOptions,
  readersFooter?: ScrubRuleReadersFooter,
  actionFooter?: ScrubRuleActionFooter,
) => Array<ModelField<LogScrubRule>> = (
  options: ScrubRuleFormOptions,
  readersFooter?: ScrubRuleReadersFooter,
  actionFooter?: ScrubRuleActionFooter,
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
        {
          label: "IP Address",
          value: LogScrubPatternType.IPAddress,
          description: SCRUB_RULE_IP_ADDRESS_HELP,
        },
        {
          label: "Sensitive Attribute Keys",
          value: LogScrubPatternType.SensitiveKeys,
        },
        {
          label: "Named Attributes",
          value: LogScrubPatternType.NamedKeys,
          description: SCRUB_RULE_NAMED_KEYS_HELP,
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
    /*
     * The attributes a Named Attributes rule hides whole (#10366): one a
     * line, saved as a list (the server reads either).
     */
    {
      field: {
        attributeKeys: true,
      },
      title: "Attributes to Hide",
      description: SCRUB_RULE_ATTRIBUTE_KEYS_HELP,
      fieldType: FormFieldSchemaType.LongText,
      required: true,
      placeholder: "e.g. customer_name",
      showIf: isNamedKeysPattern,
      customValidation: (values: FormValues<LogScrubRule>): string | null => {
        return getScrubRuleAttributeKeysError({
          patternType: values.patternType,
          attributeKeys: values.attributeKeys,
        });
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
      /*
       * What reads the values the rule would hide, before it is saved
       * (#10433): under the last field that is always shown, from the
       * form's values as they are now, the folded ones included.
       */
      ...(readersFooter
        ? {
            getFooterElement: (
              values: FormValues<LogScrubRule>,
            ): ScrubRuleFooterElement => {
              return readersFooter(values);
            },
          }
        : {}),
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
      fieldType: FormFieldSchemaType.RadioButton,
      required: true,
      // Each answer says what it does; the column's sentence would repeat it.
      hideColumnDescription: true,
      dataTestId: "scrub-rule-action",
      radioButtonOptions: SCRUB_ACTION_CHOICES,
      /*
       * What the server stores when it is left out, written on the field
       * so an Edit form compares with it too: ModelForm gives a field its
       * column default on Create only, and a folded section says
       * "Configured" for a value other than the field's default.
       */
      defaultValue: options.defaults.scrubAction,
      collapsibleSection: advanced,
      /*
       * Under the choices: an IP Address rule that redacts or masks, where
       * Security Events reads the addresses, says what that takes (#10396).
       */
      ...(actionFooter
        ? {
            getFooterElement: (
              values: FormValues<LogScrubRule>,
            ): ReactElement | undefined => {
              return actionFooter(values);
            },
          }
        : {}),
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
    /*
     * The one service the rule is for (#10433): its records alone are
     * scrubbed, and nothing that reads another service's is changed. Left
     * empty, every service's, as a rule saved before a rule could name one.
     */
    {
      field: {
        service: true,
      },
      title: "Only for one service",
      description: options.serviceHelp,
      fieldType: FormFieldSchemaType.Dropdown,
      required: false,
      dropdownModal: {
        type: Service,
        labelField: "name",
        valueField: "_id",
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

export const getLogScrubRuleFormFields: (
  readersFooter?: ScrubRuleReadersFooter,
  actionFooter?: ScrubRuleActionFooter,
) => Array<ModelField<LogScrubRule>> = (
  readersFooter?: ScrubRuleReadersFooter,
  actionFooter?: ScrubRuleActionFooter,
): Array<ModelField<LogScrubRule>> => {
  return getScrubRuleFormFields(
    LOG_SCRUB_RULE_FORM_OPTIONS,
    readersFooter,
    actionFooter,
  );
};

export const getTraceScrubRuleFormFields: (
  readersFooter?: ScrubRuleReadersFooter,
  actionFooter?: ScrubRuleActionFooter,
) => Array<ModelField<TraceScrubRule>> = (
  readersFooter?: ScrubRuleReadersFooter,
  actionFooter?: ScrubRuleActionFooter,
): Array<ModelField<TraceScrubRule>> => {
  return getScrubRuleFormFields(
    TRACE_SCRUB_RULE_FORM_OPTIONS,
    readersFooter,
    actionFooter,
  ) as unknown as Array<ModelField<TraceScrubRule>>;
};
