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
  normalizeScrubRuleKeys,
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
  LOG_SCRUB_RULE_ONLY_IN_ATTRIBUTES_HELP,
  LOG_SCRUB_RULE_SERVICE_HELP,
  LOG_SENSITIVE_KEYS_SCRUB_RULE_DEFAULTS_SUMMARY,
  NAMED_KEYS_SCRUB_RULE_DEFAULTS_SUMMARY,
  SCRUB_RULE_CUSTOM_REGEX_MATCHES_EMPTY_TEXT,
  SCRUB_RULE_CUSTOM_REGEX_MISSING,
  SCRUB_RULE_DEFAULT_NAMES,
  ScrubRuleReadersFooter,
  SENSITIVE_KEYS_SCRUB_RULE_DEFAULTS_SUMMARY,
  TRACE_SCRUB_RULE_DEFAULTS_SUMMARY,
  TRACE_SCRUB_RULE_FORM_OPTIONS,
  TRACE_SCRUB_RULE_ONLY_IN_ATTRIBUTES_HELP,
  TRACE_SCRUB_RULE_SERVICE_HELP,
  withAttributeKeysOneALine,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/ScrubRuleForm";
import { getScrubRuleFingerprint } from "../../../Types/Telemetry/ScrubRuleProof";

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
          // The only attributes a pattern rule reads (#10751), folded.
          "attributeKeys",
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

      test("folds the description, the action, the fields, the attributes it reads, the service and Enabled under one Advanced", () => {
        const folded: Array<AnyField> = fields.filter((field: AnyField) => {
          return Boolean(field.collapsibleSection);
        });

        expect(folded.map(keyOf)).toEqual([
          "description",
          "scrubAction",
          "fieldsToScrub",
          "attributeKeys",
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

      /*
       * #10751: a pattern rule names the attributes it reads in the column
       * a Named Attributes rule names the attributes it hides in - two
       * fields, one shown at a time.
       */
      test("asks a pattern rule which attributes it reads, and never with Attributes to Hide", () => {
        const [toHide, onlyIn] = fields.filter((field: AnyField): boolean => {
          return keyOf(field) === "attributeKeys";
        }) as [AnyField, AnyField];

        expect(toHide.title).toBe("Attributes to Hide");
        expect(onlyIn.title).toBe("Only in These Attributes");

        for (const patternType of patternTypes) {
          const values: FormValues<LogScrubRule> = {
            patternType,
          } as FormValues<LogScrubRule>;
          const shown: Array<string> = [toHide, onlyIn]
            .filter((field: AnyField): boolean => {
              return field.showIf!(values);
            })
            .map((field: AnyField): string => {
              return field.title as string;
            });

          if (patternType === "namedKeys") {
            expect([patternType, shown]).toEqual([
              patternType,
              ["Attributes to Hide"],
            ]);
          } else if (patternType === "sensitiveKeys") {
            // It reads every key; naming some would change nothing.
            expect([patternType, shown]).toEqual([patternType, []]);
          } else {
            expect([patternType, shown]).toEqual([
              patternType,
              ["Only in These Attributes"],
            ]);
          }
        }

        // Before a type is picked, neither.
        expect(toHide.showIf!({})).toBe(false);
        expect(onlyIn.showIf!({})).toBe(false);
        // A pick as the dropdown holds it.
        expect(
          onlyIn.showIf!({
            patternType: { label: "Email Address", value: "email" },
          } as unknown as FormValues<LogScrubRule>),
        ).toBe(true);
      });

      test("says what a narrowed rule still reads, optional, folded, one key a line", () => {
        const onlyIn: AnyField = fields.filter((field: AnyField): boolean => {
          return keyOf(field) === "attributeKeys";
        })[1]!;

        expect(onlyIn.required).toBe(false);
        expect(onlyIn.fieldType).toBe(FormFieldSchemaType.LongText);
        expect(onlyIn.collapsibleSection!.title).toBe("More fields");
        expect(onlyIn.placeholder).toBe("e.g. db.password");
        expect(onlyIn.description).toBe(
          signal === "log"
            ? "Reads only these attributes, one key a line, or every attribute when empty. The log body is read as Fields to Scrub says."
            : "Reads only these attributes, one key a line, or every attribute when empty. The span name and status message are read as Fields to Scrub says.",
        );
        // One short sentence under the field (Docs/ux/README.md#help-text).
        expect((onlyIn.description as string).length).toBeLessThanOrEqual(150);
      });

      test("checks the attributes a pattern rule reads as the server does, and asks for none", () => {
        const onlyIn: AnyField = fields.filter((field: AnyField): boolean => {
          return keyOf(field) === "attributeKeys";
        })[1]!;
        const tooMany: string = Array.from(
          { length: 51 },
          (_value: unknown, index: number): string => {
            return `attribute_${index}`;
          },
        ).join("\n");

        for (const attributeKeys of [
          undefined,
          "",
          "db.password",
          tooMany.split("\n").slice(0, 50).join("\n"),
        ]) {
          expect(
            onlyIn.customValidation!({
              patternType: "email",
              attributeKeys,
            } as unknown as FormValues<LogScrubRule>),
          ).toBeNull();
        }

        expect(
          onlyIn.customValidation!({
            patternType: "email",
            attributeKeys: tooMany,
          } as unknown as FormValues<LogScrubRule>),
        ).toBe("A rule names at most 50 attributes.");
        expect(
          onlyIn.customValidation!({
            patternType: "custom",
            attributeKeys: "k".repeat(257),
          } as unknown as FormValues<LogScrubRule>),
        ).toBe("An attribute key is at most 256 characters.");
      });

      test("names the attributes it reads on the folded line, as code", () => {
        const onlyIn: AnyField = fields.filter((field: AnyField): boolean => {
          return keyOf(field) === "attributeKeys";
        })[1]!;

        expect(
          onlyIn.getFoldedValue!({
            attributeKeys: "db.password\n db.password_old \n\ndb.password",
          } as unknown as FormValues<LogScrubRule>),
        ).toBe("db.password, db.password_old");
        expect(
          onlyIn.getFoldedValue!({
            attributeKeys: ["client.address"],
          } as unknown as FormValues<LogScrubRule>),
        ).toBe("client.address");
        expect(
          onlyIn.getFoldedValue!({
            attributeKeys: "  ",
          } as unknown as FormValues<LogScrubRule>),
        ).toBeNull();
        expect(onlyIn.getFoldedValue!({})).toBeNull();
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

  test("each form says what its narrowed rule still reads", () => {
    expect(LOG_SCRUB_RULE_FORM_OPTIONS.onlyInAttributesHelp).toBe(
      LOG_SCRUB_RULE_ONLY_IN_ATTRIBUTES_HELP,
    );
    expect(TRACE_SCRUB_RULE_FORM_OPTIONS.onlyInAttributesHelp).toBe(
      TRACE_SCRUB_RULE_ONLY_IN_ATTRIBUTES_HELP,
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

  /*
   * #10751: a pattern rule that reads only some attributes reads less than
   * the defaults' line says, so the line gives way to Configured and the
   * chip naming them. A Named Attributes rule's attributes are its rule,
   * not a folded setting.
   */
  test("nothing for a pattern rule that reads only some attributes", () => {
    for (const attributeKeys of [
      "db.password",
      ["db.password"],
      "db.password\ndb.password_old",
    ]) {
      expect(
        getScrubRuleAdvancedSummary(LOG_SCRUB_RULE_FORM_OPTIONS, {
          patternType: "email",
          attributeKeys,
        } as unknown as FormValues<LogScrubRule>),
      ).toBeUndefined();
    }

    // None named, however the form holds none: every attribute, the default.
    for (const attributeKeys of [undefined, null, "", "  \n ", []]) {
      expect(
        getScrubRuleAdvancedSummary(TRACE_SCRUB_RULE_FORM_OPTIONS, {
          patternType: "ipAddress",
          attributeKeys,
        } as unknown as FormValues<LogScrubRule>),
      ).toEqual([TRACE_SCRUB_RULE_DEFAULTS_SUMMARY]);
    }

    expect(
      getScrubRuleAdvancedSummary(LOG_SCRUB_RULE_FORM_OPTIONS, {
        patternType: "namedKeys",
        attributeKeys: "customer_name",
      } as unknown as FormValues<LogScrubRule>),
    ).toEqual([NAMED_KEYS_SCRUB_RULE_DEFAULTS_SUMMARY]);
    expect(
      getScrubRuleAdvancedSummary(LOG_SCRUB_RULE_FORM_OPTIONS, {
        patternType: "sensitiveKeys",
        attributeKeys: "password",
      } as unknown as FormValues<LogScrubRule>),
    ).toEqual([LOG_SENSITIVE_KEYS_SCRUB_RULE_DEFAULTS_SUMMARY]);
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

/*
 * #10751: a saved rule's attributes open one a line in its Edit form, and
 * what the form sends the server keeps as the list it reads: the same list
 * keeps the rule's proof, another loses it.
 */
describe("the attributes a saved rule names, in its Edit form", () => {
  test("open one a line, each once, as the fields say to write them", () => {
    const rule: LogScrubRule = new LogScrubRule();

    rule.attributeKeys = ["db.password", " db.password_old ", "DB.PASSWORD"];

    expect(withAttributeKeysOneALine(rule)).toBe(rule);
    expect(rule.attributeKeys as unknown).toBe("db.password\ndb.password_old");
  });

  test("a rule that names none, or holds them as text already, is left as it is", () => {
    for (const attributeKeys of [undefined, null, "db.password"]) {
      const rule: TraceScrubRule = Object.assign(new TraceScrubRule(), {
        attributeKeys,
      });

      withAttributeKeysOneALine(rule);

      expect(rule.attributeKeys as unknown).toBe(attributeKeys);
    }

    const empty: LogScrubRule = Object.assign(new LogScrubRule(), {
      attributeKeys: [],
    });

    withAttributeKeysOneALine(empty);

    expect(empty.attributeKeys as unknown).toBe("");
  });

  test("the server keeps what the form sends as the list ingest reads, and an emptied field as none", () => {
    const typed: { attributeKeys?: unknown } = {
      attributeKeys: "db.password\n DB.password \ndb.password_old\n",
    };

    normalizeScrubRuleKeys(typed);

    expect(typed.attributeKeys).toEqual(["db.password", "db.password_old"]);

    const emptied: { attributeKeys?: unknown } = { attributeKeys: "" };

    normalizeScrubRuleKeys(emptied);

    expect(emptied.attributeKeys).toEqual([]);

    // A pattern rule may name its attributes; the server's own check agrees.
    expect(() => {
      validateScrubRule(
        {
          patternType: "email",
          attributeKeys: ["db.password", "db.password_old"],
          fieldsToScrub: "attributes",
        },
        {
          recordNoun: "logs",
          patternTypes: LOG_SCRUB_PATTERN_TYPES,
          fieldsToScrub: LOG_SCRUB_FIELDS,
        } as ScrubRuleValidationOptions,
      );
    }).not.toThrow();
  });

  test("an edit of the attributes a rule reads loses its proof; the same attributes, written otherwise, keep it", () => {
    const rule: {
      signal: "log";
      patternType: string;
      customRegex: string;
      scrubAction: string;
      fieldsToScrub: string;
      serviceId: string;
    } = {
      signal: "log",
      patternType: "custom",
      customRegex: "pw=[^&]+",
      scrubAction: "redact",
      fieldsToScrub: "attributes",
      serviceId: "6b6b6b6b-0000-4000-8000-0000000000b2",
    };
    const proven: string = getScrubRuleFingerprint({
      ...rule,
      attributeKeys: ["db.password"],
    });

    // Saved again as the form sent it, one a line, in another case or order.
    expect(
      getScrubRuleFingerprint({ ...rule, attributeKeys: "db.password" }),
    ).toBe(proven);
    expect(
      getScrubRuleFingerprint({ ...rule, attributeKeys: "DB.Password\n" }),
    ).toBe(proven);

    // Widened, emptied or changed: another rule, no longer the one proven.
    for (const attributeKeys of [
      "db.password\ndb.password_old",
      "",
      ["db.password_old"],
    ]) {
      expect([
        attributeKeys,
        getScrubRuleFingerprint({ ...rule, attributeKeys }) === proven,
      ]).toEqual([attributeKeys, false]);
    }

    const both: string = getScrubRuleFingerprint({
      ...rule,
      attributeKeys: ["db.password", "db.password_old"],
    });

    expect(
      getScrubRuleFingerprint({
        ...rule,
        attributeKeys: "db.password_old\ndb.password",
      }),
    ).toBe(both);
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
