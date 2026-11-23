import { describe, expect, test } from "@jest/globals";
import LogDropFilter from "../../../Models/DatabaseModels/LogDropFilter";
import LogScrubRule from "../../../Models/DatabaseModels/LogScrubRule";
import Service from "../../../Models/DatabaseModels/Service";
import TraceScrubRule from "../../../Models/DatabaseModels/TraceScrubRule";
import LogDropFilterAction from "../../../Types/Log/LogDropFilterAction";
import LogScrubPatternType from "../../../Types/Log/LogScrubPatternType";
import {
  LOG_SCRUB_FIELDS,
  LOG_SCRUB_PATTERN_TYPES,
  LOG_SCRUB_RULE_DEFAULTS,
  ScrubRuleCustomRegexProblem,
  ScrubRuleDefaults,
  TRACE_SCRUB_FIELDS,
  TRACE_SCRUB_PATTERN_TYPES,
  TRACE_SCRUB_RULE_DEFAULTS,
} from "../../../Types/Telemetry/ScrubRule";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import { ModelField } from "../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import { TelemetryFieldSignal } from "../../../Types/Telemetry/TelemetryFieldReaders";
import ObjectID from "../../../Types/ObjectID";
import { ReactElement } from "react";
import { FormStep } from "../../../UI/Components/Forms/Types/FormStep";
import {
  getScrubRuleCustomRegexRefusal,
  ScrubRuleValidationOptions,
  validateScrubRule,
} from "../../../Server/Utils/ScrubRuleValidation";
import {
  getDropFilterAdvancedSummary,
  getDropFilterFormSteps,
  getLogDropFilterFormFields,
  getTraceDropFilterFormFields,
  LOG_DROP_FILTER_DEFAULTS_SUMMARY,
  LOG_DROP_FILTER_FORM_OPTIONS,
  TRACE_DROP_FILTER_DEFAULTS_SUMMARY,
  TRACE_DROP_FILTER_FORM_OPTIONS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/DropFilterForm";
import {
  getDefaultScrubRuleName,
  getLogScrubRuleFormFields,
  getScrubRuleAdvancedSummary,
  getScrubRuleCustomRegexError,
  getScrubRuleNameAfterPatternChange,
  getTraceScrubRuleFormFields,
  LOG_SCRUB_RULE_DEFAULTS_SUMMARY,
  LOG_SCRUB_RULE_FORM_OPTIONS,
  LOG_SCRUB_RULE_SERVICE_HELP,
  LOG_SENSITIVE_KEYS_SCRUB_RULE_DEFAULTS_SUMMARY,
  SCRUB_RULE_CUSTOM_REGEX_MATCHES_EMPTY_TEXT,
  SCRUB_RULE_CUSTOM_REGEX_MISSING,
  SCRUB_RULE_DEFAULT_NAMES,
  ScrubRuleReadersFooter,
  SENSITIVE_KEYS_SCRUB_RULE_DEFAULTS_SUMMARY,
  TRACE_SCRUB_RULE_DEFAULTS_SUMMARY,
  TRACE_SCRUB_RULE_FORM_OPTIONS,
  TRACE_SCRUB_RULE_SERVICE_HELP,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/ScrubRuleForm";

/*
 * The log and trace data rule forms, field by field: what each asks, in
 * which order and on which step, what it starts with, and the rules behind
 * the name a scrub rule is given and the custom pattern it is refused.
 *
 * "Log and trace drop filters, scrub rules and pipelines start from what the
 * rule does, with server defaults shown and no empty custom regex."
 */

type AnyField = ModelField<LogScrubRule>;

interface WritesAColumn {
  field?: Record<string, unknown> | undefined;
}

function keyOf(field: WritesAColumn): string {
  return Object.keys(field.field || {})[0] as string;
}

function fieldNamed<T extends WritesAColumn>(fields: Array<T>, key: string): T {
  const field: T | undefined = fields.find((candidate: T): boolean => {
    return keyOf(candidate) === key;
  });

  if (!field) {
    throw new Error(`No field writes ${key}.`);
  }

  return field;
}

// The values a field offers: a dropdown's options, or a choice's answers.
function optionValues(field: AnyField): Array<unknown> {
  const options: Array<{ value: unknown }> =
    (field.dropdownOptions as Array<DropdownOption> | undefined) ||
    field.radioButtonOptions ||
    [];

  return options.map((option: { value: unknown }): unknown => {
    return option.value;
  });
}

interface ScrubRuleFormCase {
  name: string;
  signal: TelemetryFieldSignal;
  serviceHelp: string;
  fields: Array<AnyField>;
  defaults: ScrubRuleDefaults;
  patternTypes: ReadonlyArray<string>;
  scrubFields: ReadonlyArray<string>;
}

interface DropFilterFormCase {
  name: string;
  fields: Array<ModelField<LogDropFilter>>;
}

describe("the scrub rule form", () => {
  const forms: Array<ScrubRuleFormCase> = [
    {
      name: "Logs",
      signal: "log",
      serviceHelp: LOG_SCRUB_RULE_SERVICE_HELP,
      fields: getLogScrubRuleFormFields(),
      defaults: LOG_SCRUB_RULE_DEFAULTS,
      patternTypes: LOG_SCRUB_PATTERN_TYPES,
      scrubFields: LOG_SCRUB_FIELDS,
    },
    {
      name: "Traces",
      signal: "trace",
      serviceHelp: TRACE_SCRUB_RULE_SERVICE_HELP,
      fields: getTraceScrubRuleFormFields() as unknown as Array<AnyField>,
      defaults: TRACE_SCRUB_RULE_DEFAULTS,
      patternTypes: TRACE_SCRUB_PATTERN_TYPES,
      scrubFields: TRACE_SCRUB_FIELDS,
    },
  ];

  describe.each(forms)(
    "on $name",
    ({
      signal,
      serviceHelp,
      fields,
      defaults,
      patternTypes,
      scrubFields,
    }: ScrubRuleFormCase) => {
      test("starts from what the rule scrubs: the pattern type, its regex or its attributes, then the name", () => {
        expect(fields.map(keyOf)).toEqual([
          "patternType",
          "customRegex",
          // A Named Attributes rule's attributes to hide (#10366).
          "attributeKeys",
          "name",
          "description",
          "scrubAction",
          "fieldsToScrub",
          "service",
          "isEnabled",
        ]);
      });

      /*
       * A rule scrubs one service's records, or every service's (#10433):
       * picked from the project's services, folded, left empty by default -
       * every service, as a rule saved before a rule could name one.
       */
      test("asks, folded, for the one service it is for - empty for every service", () => {
        const service: AnyField = fieldNamed(fields, "service");

        expect(service.title).toBe("Only for one service");
        expect(service.fieldType).toBe(FormFieldSchemaType.Dropdown);
        expect(service.required).toBe(false);
        expect(service.defaultValue).toBeUndefined();
        expect(service.dropdownModal).toEqual({
          type: Service,
          labelField: "name",
          valueField: "_id",
        });
        expect(service.description).toBe(serviceHelp);
        expect(serviceHelp).toBe(
          `Leave empty to scrub the ${signal === "log" ? "logs" : "spans"} of every service.`,
        );
        // One short sentence under the field (Docs/ux/README.md#help-text).
        expect(serviceHelp.length).toBeLessThanOrEqual(150);
      });

      /*
       * What reads the values the rule would hide is said under the name,
       * the last field always shown, from the form's values as they are -
       * before the rule is saved (#10433). The page hands in what draws it
       * (ScrubRuleReadersPreview), so the form asks nothing of the server.
       */
      test("draws under the name what the page hands it, from the form as it is", () => {
        const values: FormValues<LogScrubRule> = {
          patternType: "email",
          scrubAction: "redact",
          fieldsToScrub: "attributes",
          service: new ObjectID("6b6b6b6b-0000-4000-8000-0000000000b2"),
        } as unknown as FormValues<LogScrubRule>;
        const drawn: ReactElement = { type: "p" } as unknown as ReactElement;
        const asked: Array<FormValues<LogScrubRule>> = [];
        const footer: ScrubRuleReadersFooter = (
          formValues: FormValues<LogScrubRule>,
        ): ReactElement => {
          asked.push(formValues);
          return drawn;
        };
        const withFooter: Array<AnyField> = (signal === "log"
          ? getLogScrubRuleFormFields(footer)
          : getTraceScrubRuleFormFields(footer)) as unknown as Array<AnyField>;

        expect(fieldNamed(withFooter, "name").getFooterElement!(values)).toBe(
          drawn,
        );
        expect(asked).toEqual([values]);
        // Nothing else draws it: one place says it.
        expect(
          withFooter.filter((field: AnyField): boolean => {
            return Boolean(field.getFooterElement);
          }),
        ).toHaveLength(1);
        // Handed nothing, the form draws nothing there.
        expect(fieldNamed(fields, "name").getFooterElement).toBeUndefined();
      });

      test("walks no steps", () => {
        for (const field of fields) {
          expect(field.stepId).toBeUndefined();
        }
      });

      test("folds the description, the action, the fields, the service and Enabled under one Advanced", () => {
        const folded: Array<AnyField> = fields.filter((field: AnyField) => {
          return Boolean(field.collapsibleSection);
        });

        expect(folded.map(keyOf)).toEqual([
          "description",
          "scrubAction",
          "fieldsToScrub",
          "service",
          "isEnabled",
        ]);

        const sections: Set<unknown> = new Set(
          folded.map((field: AnyField): unknown => {
            return field.collapsibleSection;
          }),
        );
        expect(sections.size).toBe(1);
        expect(folded[0]!.collapsibleSection!.title).toBe("More fields");
        expect(folded[0]!.collapsibleSection!.openWhenConfigured).toBe(false);
      });

      test("leaves the pattern type, its regex and the name open", () => {
        for (const key of ["patternType", "customRegex", "name"]) {
          expect(fieldNamed(fields, key).collapsibleSection).toBeUndefined();
        }
      });

      test("starts the folded columns at what the server stores when they are left out", () => {
        expect(fieldNamed(fields, "scrubAction").defaultValue).toBe(
          defaults.scrubAction,
        );
        expect(fieldNamed(fields, "fieldsToScrub").defaultValue).toBe(
          defaults.fieldsToScrub,
        );
        expect(fieldNamed(fields, "isEnabled").defaultValue).toBe(
          defaults.isEnabled,
        );
        expect(fieldNamed(fields, "isEnabled").fieldType).toBe(
          FormFieldSchemaType.Toggle,
        );
      });

      test("offers exactly the pattern types and fields the server accepts", () => {
        expect(optionValues(fieldNamed(fields, "patternType")).sort()).toEqual(
          [...patternTypes].sort(),
        );
        expect(
          optionValues(fieldNamed(fields, "fieldsToScrub")).sort(),
        ).toEqual([...scrubFields].sort());
        // The scrub action is three plain choices, each with its line.
        expect(fieldNamed(fields, "scrubAction").fieldType).toBe(
          FormFieldSchemaType.RadioButton,
        );
        expect(optionValues(fieldNamed(fields, "scrubAction"))).toEqual([
          "redact",
          "mask",
          "hash",
        ]);
        // The default is the first choice.
        expect(optionValues(fieldNamed(fields, "fieldsToScrub"))[0]).toBe(
          defaults.fieldsToScrub,
        );
      });

      test("asks for the regex only for Custom Regex, required there and checked", () => {
        const customRegex: AnyField = fieldNamed(fields, "customRegex");

        expect(customRegex.required).toBe(true);
        expect(customRegex.fieldType).toBe(FormFieldSchemaType.Text);
        expect(customRegex.showIf!({ patternType: "custom" })).toBe(true);
        expect(customRegex.showIf!({ patternType: "email" })).toBe(false);
        expect(customRegex.showIf!({})).toBe(false);
        expect(
          customRegex.customValidation!({
            patternType: "custom",
            customRegex: "(",
          }),
        ).toMatch(/^This is not a valid regular expression: /);
        expect(
          customRegex.customValidation!({
            patternType: "custom",
            customRegex: "SECRET-[0-9]+",
          }),
        ).toBeNull();
      });

      test("does not ask a sensitive-keys rule which fields to scrub", () => {
        const fieldsToScrub: AnyField = fieldNamed(fields, "fieldsToScrub");

        expect(fieldsToScrub.showIf!({ patternType: "sensitiveKeys" })).toBe(
          false,
        );
        expect(fieldsToScrub.showIf!({ patternType: "email" })).toBe(true);
        expect(fieldsToScrub.showIf!({})).toBe(true);
      });

      test("the pattern type's pick names the rule until somebody names it", () => {
        const patternType: AnyField = fieldNamed(fields, "patternType");
        const set: Array<FormValues<LogScrubRule>> = [];
        const setNewFormValues: (values: FormValues<LogScrubRule>) => void = (
          values: FormValues<LogScrubRule>,
        ): void => {
          set.push(values);
        };

        patternType.onChange!("email", {}, setNewFormValues);
        expect(set.pop()).toEqual({ name: "Scrub email addresses" });

        patternType.onChange!(
          "phoneNumber",
          { name: "Scrub email addresses", patternType: "email" },
          setNewFormValues,
        );
        expect(set.pop()).toEqual({
          name: "Scrub phone numbers",
          patternType: "email",
        });

        // A name of one's own stays.
        patternType.onChange!(
          "ipAddress",
          { name: "Customer PII", patternType: "phoneNumber" },
          setNewFormValues,
        );
        expect(set).toEqual([]);
      });
    },
  );

  test("the trace form takes the trace scopes, the log form the log scopes", () => {
    expect(TRACE_SCRUB_RULE_FORM_OPTIONS.signal).toBe("trace");
    expect(LOG_SCRUB_RULE_FORM_OPTIONS.signal).toBe("log");
    expect(TRACE_SCRUB_RULE_FORM_OPTIONS.serviceHelp).toBe(
      TRACE_SCRUB_RULE_SERVICE_HELP,
    );
    expect(LOG_SCRUB_RULE_FORM_OPTIONS.serviceHelp).toBe(
      LOG_SCRUB_RULE_SERVICE_HELP,
    );
    expect(TRACE_SCRUB_RULE_FORM_OPTIONS.defaults).toBe(
      TRACE_SCRUB_RULE_DEFAULTS,
    );
    expect(LOG_SCRUB_RULE_FORM_OPTIONS.defaults).toBe(LOG_SCRUB_RULE_DEFAULTS);
    expect(TRACE_SCRUB_RULE_FORM_OPTIONS.defaultsSummary).toBe(
      TRACE_SCRUB_RULE_DEFAULTS_SUMMARY,
    );
    expect(LOG_SCRUB_RULE_FORM_OPTIONS.defaultsSummary).toBe(
      LOG_SCRUB_RULE_DEFAULTS_SUMMARY,
    );
    expect(TRACE_SCRUB_RULE_FORM_OPTIONS.sensitiveKeysSummary).toBe(
      SENSITIVE_KEYS_SCRUB_RULE_DEFAULTS_SUMMARY,
    );
    expect(LOG_SCRUB_RULE_FORM_OPTIONS.sensitiveKeysSummary).toBe(
      LOG_SENSITIVE_KEYS_SCRUB_RULE_DEFAULTS_SUMMARY,
    );
  });

  /*
   * What a trace rule's Fields to Scrub reaches (#6513): Attributes Only
   * and All scrub a link's attributes with the span's own since #6507, and
   * All the span's status message and its events' names too - so the help
   * under the field, and the folded section's line while it is left at
   * All, name them.
   */
  test("the trace form names the link attributes, the status message and the event names it scrubs", () => {
    expect(TRACE_SCRUB_RULE_FORM_OPTIONS.fieldsToScrubHelp).toBe(
      "Which parts of the span to scrub: span name, attribute and link attribute values, event attribute values, or all, status message and event names too.",
    );
    expect(TRACE_SCRUB_RULE_DEFAULTS_SUMMARY).toBe(
      "Matches are replaced with [REDACTED] in span names, status messages, attributes, events and links.",
    );
    // One short sentence under the field (Docs/ux/README.md#help-text).
    expect(
      TRACE_SCRUB_RULE_FORM_OPTIONS.fieldsToScrubHelp.length,
    ).toBeLessThanOrEqual(150);
  });

  /*
   * A log's Sensitive Attribute Keys rule reads the keys of a JSON body
   * too (#6513); a span's reads the attributes of the span, its events and
   * its links. Each form says what its own rule hides.
   */
  test("a sensitive-keys rule's line names what it hides on each signal", () => {
    expect(LOG_SENSITIVE_KEYS_SCRUB_RULE_DEFAULTS_SUMMARY).toBe(
      "The values of keys that look sensitive, in attributes and in a JSON log body, are replaced with [REDACTED].",
    );
    expect(SENSITIVE_KEYS_SCRUB_RULE_DEFAULTS_SUMMARY).toBe(
      "The values of attributes whose key looks sensitive are replaced with [REDACTED].",
    );
  });

  test("both pages build their form from the same fields", () => {
    expect(getTraceScrubRuleFormFields().map(keyOf)).toEqual(
      getLogScrubRuleFormFields().map(keyOf),
    );
    // Over a model with the same columns.
    for (const key of getLogScrubRuleFormFields().map(keyOf)) {
      expect(new TraceScrubRule().getTableColumnMetadata(key)).toBeDefined();
    }
  });
});

describe("the name a scrub rule starts with", () => {
  test("says what each pattern type scrubs", () => {
    expect(getDefaultScrubRuleName(LogScrubPatternType.Email)).toBe(
      "Scrub email addresses",
    );
    expect(getDefaultScrubRuleName(LogScrubPatternType.CreditCard)).toBe(
      "Scrub credit card numbers",
    );
    expect(getDefaultScrubRuleName(LogScrubPatternType.SSN)).toBe(
      "Scrub Social Security numbers",
    );
    expect(getDefaultScrubRuleName(LogScrubPatternType.PhoneNumber)).toBe(
      "Scrub phone numbers",
    );
    expect(getDefaultScrubRuleName(LogScrubPatternType.IPAddress)).toBe(
      "Scrub IP addresses",
    );
    expect(getDefaultScrubRuleName(LogScrubPatternType.SensitiveKeys)).toBe(
      "Scrub sensitive attributes",
    );
    expect(getDefaultScrubRuleName(LogScrubPatternType.Custom)).toBe(
      "Scrub custom pattern",
    );
  });

  test("has one for every pattern type, and each fits the name column", () => {
    expect(Object.keys(SCRUB_RULE_DEFAULT_NAMES).sort()).toEqual(
      [...LOG_SCRUB_PATTERN_TYPES].sort(),
    );

    for (const name of Object.values(SCRUB_RULE_DEFAULT_NAMES)) {
      // The Name column holds 50 characters.
      expect(name.length).toBeLessThanOrEqual(50);
    }
  });

  test("is empty before a type is picked, or for one it does not know", () => {
    expect(getDefaultScrubRuleName(undefined)).toBe("");
    expect(getDefaultScrubRuleName("Email")).toBe("");
  });

  test("reads a dropdown option the way the form may hold it", () => {
    expect(
      getDefaultScrubRuleName({ label: "IP Address", value: "ipAddress" }),
    ).toBe("Scrub IP addresses");
  });

  test("follows the type while the name is the form's own", () => {
    expect(
      getScrubRuleNameAfterPatternChange({
        name: "",
        previousPatternType: undefined,
        patternType: "email",
      }),
    ).toBe("Scrub email addresses");

    expect(
      getScrubRuleNameAfterPatternChange({
        name: "Scrub email addresses",
        previousPatternType: "email",
        patternType: "custom",
      }),
    ).toBe("Scrub custom pattern");

    expect(
      getScrubRuleNameAfterPatternChange({
        name: "   ",
        previousPatternType: "email",
        patternType: "ssn",
      }),
    ).toBe("Scrub Social Security numbers");
  });

  test("keeps a name somebody typed", () => {
    expect(
      getScrubRuleNameAfterPatternChange({
        name: "Card numbers in checkout logs",
        previousPatternType: "email",
        patternType: "creditCard",
      }),
    ).toBeNull();

    // The name another type would start with is not this type's own: it stays.
    expect(
      getScrubRuleNameAfterPatternChange({
        name: "Scrub email addresses",
        previousPatternType: "phoneNumber",
        patternType: "ipAddress",
      }),
    ).toBeNull();
  });

  test("changes nothing when the type does not change", () => {
    expect(
      getScrubRuleNameAfterPatternChange({
        name: "",
        previousPatternType: "email",
        patternType: "email",
      }),
    ).toBeNull();
  });

  test("leaves the name alone when the pick is cleared", () => {
    expect(
      getScrubRuleNameAfterPatternChange({
        name: "Scrub email addresses",
        previousPatternType: "email",
        patternType: null,
      }),
    ).toBeNull();
  });
});

describe("the custom pattern's message in the form", () => {
  test("asks for a pattern when there is none", () => {
    for (const missing of ["", "   ", undefined]) {
      expect(getScrubRuleCustomRegexError(missing)).toBe(
        SCRUB_RULE_CUSTOM_REGEX_MISSING,
      );
    }
  });

  test("names what is wrong with a pattern that does not compile", () => {
    const message: string | null = getScrubRuleCustomRegexError("(");

    expect(message).toMatch(/^This is not a valid regular expression: .+/);
    expect(message).not.toContain("/(/");
  });

  test("refuses a pattern that matches empty text", () => {
    expect(getScrubRuleCustomRegexError("\\d*")).toBe(
      SCRUB_RULE_CUSTOM_REGEX_MATCHES_EMPTY_TEXT,
    );
  });

  test("says nothing about a pattern ingest can use", () => {
    expect(getScrubRuleCustomRegexError("\\bSECRET-[A-Z0-9]+\\b")).toBeNull();
  });

  /*
   * The form and the server refuse the same patterns; they word it for
   * their reader (a field's error, an API caller).
   */
  test("refuses exactly what the server refuses", () => {
    const options: ScrubRuleValidationOptions = {
      recordNoun: "logs",
      patternTypes: LOG_SCRUB_PATTERN_TYPES,
      fieldsToScrub: LOG_SCRUB_FIELDS,
    };

    for (const pattern of ["", " ", "(", "[a-", "\\d*", "x", "a+b", ".+"]) {
      const formSays: string | null = getScrubRuleCustomRegexError(pattern);
      let serverSays: string | null = null;

      try {
        validateScrubRule(
          { patternType: "custom", customRegex: pattern },
          options,
        );
      } catch (error: unknown) {
        serverSays = (error as Error).message;
      }

      expect(formSays === null).toBe(serverSays === null);
    }

    expect(
      getScrubRuleCustomRegexRefusal(
        { problem: ScrubRuleCustomRegexProblem.Missing },
        options,
      ),
    ).toContain("scrubs nothing");
  });
});

describe("what the scrub rule's folded Advanced says", () => {
  test("what the defaults do, while nothing in it is changed", () => {
    expect(
      getScrubRuleAdvancedSummary(LOG_SCRUB_RULE_FORM_OPTIONS, {}),
    ).toEqual([LOG_SCRUB_RULE_DEFAULTS_SUMMARY]);
    expect(
      getScrubRuleAdvancedSummary(TRACE_SCRUB_RULE_FORM_OPTIONS, {
        patternType: "email",
        scrubAction: "redact",
        fieldsToScrub: "all",
        isEnabled: true,
        description: "",
      }),
    ).toEqual([TRACE_SCRUB_RULE_DEFAULTS_SUMMARY]);
  });

  test("what a sensitive-keys rule does, whatever its fields say", () => {
    expect(
      getScrubRuleAdvancedSummary(LOG_SCRUB_RULE_FORM_OPTIONS, {
        patternType: "sensitiveKeys",
        fieldsToScrub: "body",
      }),
    ).toEqual([LOG_SENSITIVE_KEYS_SCRUB_RULE_DEFAULTS_SUMMARY]);
    expect(
      getScrubRuleAdvancedSummary(TRACE_SCRUB_RULE_FORM_OPTIONS, {
        patternType: "sensitiveKeys",
        fieldsToScrub: "name",
      }),
    ).toEqual([SENSITIVE_KEYS_SCRUB_RULE_DEFAULTS_SUMMARY]);
  });

  test("nothing once something in it is changed, so the header says Configured", () => {
    for (const changed of [
      { scrubAction: "mask" },
      { scrubAction: { label: "Hash", value: "hash" } },
      { fieldsToScrub: "body" },
      { isEnabled: false },
      { description: "Card numbers from checkout" },
      // One service's records, not every service's (#10433).
      { service: "6b6b6b6b-0000-4000-8000-0000000000b2" },
      {
        service: {
          label: "checkout",
          value: "6b6b6b6b-0000-4000-8000-0000000000b2",
        },
      },
    ] as Array<FormValues<LogScrubRule>>) {
      expect(
        getScrubRuleAdvancedSummary(LOG_SCRUB_RULE_FORM_OPTIONS, {
          patternType: "email",
          ...changed,
        }),
      ).toBeUndefined();
    }
  });

  test("no service, however the form holds it, is every service: the default", () => {
    for (const service of [undefined, null, ""]) {
      expect(
        getScrubRuleAdvancedSummary(LOG_SCRUB_RULE_FORM_OPTIONS, {
          service,
        } as unknown as FormValues<LogScrubRule>),
      ).toEqual([LOG_SCRUB_RULE_DEFAULTS_SUMMARY]);
    }
  });

  test("reads a default held as a dropdown option", () => {
    expect(
      getScrubRuleAdvancedSummary(LOG_SCRUB_RULE_FORM_OPTIONS, {
        scrubAction: { label: "Redact", value: "redact" },
        fieldsToScrub: { label: "Both (Body & Attributes)", value: "both" },
      } as unknown as FormValues<LogScrubRule>),
    ).toEqual([LOG_SCRUB_RULE_DEFAULTS_SUMMARY]);
  });
});

describe("the drop filter form", () => {
  const forms: Array<DropFilterFormCase> = [
    { name: "Logs", fields: getLogDropFilterFormFields() },
    {
      name: "Traces",
      fields: getTraceDropFilterFormFields() as unknown as Array<
        ModelField<LogDropFilter>
      >,
    },
  ];

  test("walks Match, then Action", () => {
    const steps: Array<FormStep<LogDropFilter>> =
      getDropFilterFormSteps<LogDropFilter>();

    expect(
      steps.map((step: FormStep<LogDropFilter>) => {
        return [step.id, step.title];
      }),
    ).toEqual([
      ["match", "Match"],
      ["action", "Action"],
    ]);
  });

  describe.each(forms)("on $name", ({ fields }: DropFilterFormCase) => {
    test("asks for the name and the filter query on Match, and nothing else", () => {
      expect(
        fields
          .filter((field: ModelField<LogDropFilter>): boolean => {
            return field.stepId === "match";
          })
          .map(keyOf),
      ).toEqual(["name", "filterQuery"]);
    });

    test("asks what happens on Action, with the description and Enabled folded", () => {
      const onAction: Array<ModelField<LogDropFilter>> = fields.filter(
        (field: ModelField<LogDropFilter>): boolean => {
          return field.stepId === "action";
        },
      );

      expect(onAction.map(keyOf)).toEqual([
        "action",
        "samplePercentage",
        "description",
        "isEnabled",
      ]);
      expect(
        onAction
          .filter((field: ModelField<LogDropFilter>): boolean => {
            return Boolean(field.collapsibleSection);
          })
          .map(keyOf),
      ).toEqual(["description", "isEnabled"]);
      expect(fieldNamed(onAction, "description").collapsibleSection).toBe(
        fieldNamed(onAction, "isEnabled").collapsibleSection,
      );
    });

    test("puts every field on one of the two steps", () => {
      for (const field of fields) {
        expect(["match", "action"]).toContain(field.stepId);
      }
    });

    test("asks for the percentage only for Sample, and requires it there", () => {
      const samplePercentage: ModelField<LogDropFilter> = fieldNamed(
        fields,
        "samplePercentage",
      );

      expect(samplePercentage.required).toBe(true);
      expect(
        samplePercentage.showIf!({ action: LogDropFilterAction.Sample }),
      ).toBe(true);
      expect(
        samplePercentage.showIf!({ action: LogDropFilterAction.Drop }),
      ).toBe(false);
      expect(
        samplePercentage.showIf!({
          action: { label: "Sample", value: "sample" },
        } as unknown as FormValues<LogDropFilter>),
      ).toBe(true);
    });

    test("leaves Enabled to start from its column default, on", () => {
      const isEnabled: ModelField<LogDropFilter> = fieldNamed(
        fields,
        "isEnabled",
      );

      expect(isEnabled.fieldType).toBe(FormFieldSchemaType.Toggle);
      // ModelForm hands a Create form's field its column's default.
      expect(isEnabled.defaultValue).toBeUndefined();
      expect(
        new LogDropFilter().getTableColumnMetadata("isEnabled").defaultValue,
      ).toBe(true);
    });
  });

  test("says when the filter starts working while Enabled is on and nothing is typed", () => {
    expect(
      getDropFilterAdvancedSummary(LOG_DROP_FILTER_FORM_OPTIONS, {}),
    ).toEqual([LOG_DROP_FILTER_DEFAULTS_SUMMARY]);
    expect(
      getDropFilterAdvancedSummary(TRACE_DROP_FILTER_FORM_OPTIONS, {
        isEnabled: true,
        description: " ",
      }),
    ).toEqual([TRACE_DROP_FILTER_DEFAULTS_SUMMARY]);
  });

  test("says nothing once Enabled is off or a description is typed", () => {
    expect(
      getDropFilterAdvancedSummary(LOG_DROP_FILTER_FORM_OPTIONS, {
        isEnabled: false,
      }),
    ).toBeUndefined();
    expect(
      getDropFilterAdvancedSummary(LOG_DROP_FILTER_FORM_OPTIONS, {
        description: "Health checks",
      }),
    ).toBeUndefined();
  });

  test("names the records of its own page", () => {
    expect(LOG_DROP_FILTER_DEFAULTS_SUMMARY).toContain("new logs");
    expect(TRACE_DROP_FILTER_DEFAULTS_SUMMARY).toContain("new spans");
    expect(LOG_DROP_FILTER_FORM_OPTIONS.filterQueryHelp).toContain("logs");
    expect(TRACE_DROP_FILTER_FORM_OPTIONS.filterQueryHelp).toContain("spans");
  });
});
