import { describe, expect, test } from "@jest/globals";
import LogDropFilter from "../../../Models/DatabaseModels/LogDropFilter";
import LogScrubRule from "../../../Models/DatabaseModels/LogScrubRule";
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
  SCRUB_RULE_CUSTOM_REGEX_MATCHES_EMPTY_TEXT,
  SCRUB_RULE_CUSTOM_REGEX_MISSING,
  SCRUB_RULE_DEFAULT_NAMES,
  SENSITIVE_KEYS_SCRUB_RULE_DEFAULTS_SUMMARY,
  TRACE_SCRUB_RULE_DEFAULTS_SUMMARY,
  TRACE_SCRUB_RULE_FORM_OPTIONS,
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

function optionValues(field: AnyField): Array<unknown> {
  return (field.dropdownOptions as Array<DropdownOption>).map(
    (option: DropdownOption): unknown => {
      return option.value;
    },
  );
}

interface ScrubRuleFormCase {
  name: string;
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
      fields: getLogScrubRuleFormFields(),
      defaults: LOG_SCRUB_RULE_DEFAULTS,
      patternTypes: LOG_SCRUB_PATTERN_TYPES,
      scrubFields: LOG_SCRUB_FIELDS,
    },
    {
      name: "Traces",
      fields: getTraceScrubRuleFormFields() as unknown as Array<AnyField>,
      defaults: TRACE_SCRUB_RULE_DEFAULTS,
      patternTypes: TRACE_SCRUB_PATTERN_TYPES,
      scrubFields: TRACE_SCRUB_FIELDS,
    },
  ];

  describe.each(forms)(
    "on $name",
    ({ fields, defaults, patternTypes, scrubFields }: ScrubRuleFormCase) => {
      test("starts from what the rule scrubs: the pattern type, its regex, then the name", () => {
        expect(fields.map(keyOf)).toEqual([
          "patternType",
          "customRegex",
          "name",
          "description",
          "scrubAction",
          "fieldsToScrub",
          "isEnabled",
        ]);
      });

      test("walks no steps", () => {
        for (const field of fields) {
          expect(field.stepId).toBeUndefined();
        }
      });

      test("folds the description, the action, the fields and Enabled under one Advanced", () => {
        const folded: Array<AnyField> = fields.filter((field: AnyField) => {
          return Boolean(field.collapsibleSection);
        });

        expect(folded.map(keyOf)).toEqual([
          "description",
          "scrubAction",
          "fieldsToScrub",
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
    ).toEqual([SENSITIVE_KEYS_SCRUB_RULE_DEFAULTS_SUMMARY]);
  });

  test("nothing once something in it is changed, so the header says Configured", () => {
    for (const changed of [
      { scrubAction: "mask" },
      { scrubAction: { label: "Hash", value: "hash" } },
      { fieldsToScrub: "body" },
      { isEnabled: false },
      { description: "Card numbers from checkout" },
    ] as Array<FormValues<LogScrubRule>>) {
      expect(
        getScrubRuleAdvancedSummary(LOG_SCRUB_RULE_FORM_OPTIONS, {
          patternType: "email",
          ...changed,
        }),
      ).toBeUndefined();
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
