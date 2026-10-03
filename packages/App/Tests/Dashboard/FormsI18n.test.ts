import FormsCopy, {
  FORM_QUESTION_TYPE_TEXT,
} from "../../FeatureSet/Dashboard/src/Components/FormBuilder/FormsCopy";
import Form from "Common/Models/DatabaseModels/Form";
import { FORM_SUBMITTER_FIELD_DEFINITIONS } from "Common/Types/Form/FormField";
import { validateFormIpAllowlist } from "Common/Types/Form/FormIpAllowlist";
import {
  FormTargetFieldDefinition,
  getFormTargetFields,
} from "Common/Types/Form/FormTargetCatalog";
import FormTargetType, {
  FORM_TARGET_TYPES,
  FORM_TARGET_TYPE_TEXT,
} from "Common/Types/Form/FormTargetType";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Forms product's dashboard pages - the product menu item, the list of
 * forms, the builder and its palette, the On Submit page, the Share page and
 * the submissions - reach the screen through components that look each
 * string up in the Dashboard locale files by its English text (SideMenuItem,
 * Breadcrumbs, Card and its buttons, Modal, FormField, TableHeader, Detail,
 * Dropdown) or through the pages' own lookups. A string with no entry
 * silently stays English, so this pins:
 *
 *   - the glossary's words the docs quote, and that the Form model's column
 *     titles, which the API reference and Terraform show, say the same;
 *   - en.json maps every string to itself, and all sixteen other locales
 *     carry a real, non-empty translation, sentences still sentences, in
 *     the same order as en.json;
 *   - the strings ModelTable, CardModelDetail and ModelDelete compose from
 *     the model's name ("Create Form") have entries too;
 *   - the source still renders every one of them, and nothing the Forms
 *     pages hand a translating prop is missing from en.json;
 *   - the words of the Incident Forms pages Forms replaced are gone from
 *     every locale, and the product menu's Forms item is in all of them.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const COMMON_UI: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "Common",
  "UI",
  "Components",
);

const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

const OTHER_LOCALES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

// A TypeScript source file.
const SOURCE_FILE: RegExp = /\.tsx?$/;

// Every file of the product: its pages and its components.
function listFeatureFiles(relativeDirectory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(
    path.join(DASHBOARD_SRC, relativeDirectory),
    {
      withFileTypes: true,
    },
  )) {
    const relativePath: string = `${relativeDirectory}/${entry.name}`;

    if (entry.isDirectory()) {
      files.push(...listFeatureFiles(relativePath));
    } else if (SOURCE_FILE.test(entry.name)) {
      files.push(relativePath);
    }
  }

  return files.sort();
}

const FEATURE_FILES: Array<string> = [
  ...listFeatureFiles("Components/FormBuilder"),
  ...listFeatureFiles("Pages/Forms"),
];

// The menus' items and the breadcrumbs' last words.
const NAVIGATION_STRINGS: Array<string> = [
  "Forms",
  "Form",
  "Build",
  "On Submit",
  "Share",
  "Submissions",
  "View Form",
  "Delete Form",
];

/*
 * Composed by the shared components from the model's singular name, so
 * they cannot be looked up unless they have entries of their own: the
 * create button and the create modal's submit button, the create modal's
 * title, the edit modals' title, and the delete card.
 */
const singularName: string = new Form().singularName || "";

const COMPOSED_STRINGS: Array<string> = [
  singularName,
  `Create ${singularName}`,
  `Create New ${singularName}`,
  `Edit ${singularName}`,
  `Delete ${singularName}`,
  `Are you sure you want to delete this ${singularName.toLowerCase()}?`,
];

const COPY_STRINGS: Array<string> = Object.values(FormsCopy);

// The question types the builder's palette offers.
const QUESTION_TYPE_STRINGS: Array<string> = Object.values(
  FORM_QUESTION_TYPE_TEXT,
).flatMap((text: { title: string; description: string }): Array<string> => {
  return [text.title, text.description];
});

// What each target is called, and what the picker says about it.
const TARGET_TYPE_STRINGS: Array<string> = FORM_TARGET_TYPES.flatMap(
  (targetType: FormTargetType): Array<string> => {
    return [
      FORM_TARGET_TYPE_TEXT[targetType].title,
      FORM_TARGET_TYPE_TEXT[targetType].description,
    ];
  },
);

/*
 * Each target's fields as the palette and the On Submit page name them, and
 * the label and help text a new question for one starts with.
 */
const CATALOG_STRINGS: Array<string> = FORM_TARGET_TYPES.flatMap(
  (targetType: FormTargetType): Array<string> => {
    return getFormTargetFields(targetType).flatMap(
      (field: FormTargetFieldDefinition): Array<string> => {
        return [
          field.title,
          field.description,
          field.defaultLabel,
          ...(field.defaultHelpText ? [field.defaultHelpText] : []),
        ];
      },
    );
  },
);

const SUBMITTER_STRINGS: Array<string> = Object.values(
  FORM_SUBMITTER_FIELD_DEFINITIONS,
).flatMap(
  (definition: {
    title: string;
    description: string;
    defaultLabel: string;
  }): Array<string> => {
    return [definition.title, definition.description, definition.defaultLabel];
  },
);

function unique(values: Array<string>): Array<string> {
  return Array.from(new Set<string>(values));
}

// A question type the palette offers, to check the walker reads FormsCopy's records.
const QUESTION_TYPE_KEY: keyof typeof FORM_QUESTION_TYPE_TEXT = Object.keys(
  FORM_QUESTION_TYPE_TEXT,
)[0] as keyof typeof FORM_QUESTION_TYPE_TEXT;

// Every string of the product the dashboard looks up.
const ALL_STRINGS: Array<string> = unique([
  ...NAVIGATION_STRINGS,
  ...COMPOSED_STRINGS,
  ...COPY_STRINGS,
  ...QUESTION_TYPE_STRINGS,
  ...TARGET_TYPE_STRINGS,
  ...CATALOG_STRINGS,
  ...SUBMITTER_STRINGS,
]);

/*
 * The same in a language as in English, and rightly so: an example address,
 * and words the language shares with English.
 */
const SAME_EVERYWHERE: Array<string> = ["name@example.com"];

const SAME_AS_ENGLISH: Record<string, Array<string>> = {
  de: ["Name", "Status"],
  fr: ["Date", "Description", "Incident", "Options", "Question", "Questions"],
  es: ["No"],
  it: ["No"],
  pt: ["Status"],
  nl: ["Incident", "Labels", "Status"],
  da: ["Status"],
  no: ["Status"],
  sv: ["Incident", "Status"],
};

/*
 * The words of the Incident Forms pages (Incidents > Settings > Forms) that
 * Forms replaced, and of the IncidentForm model, which is gone.
 */
const RETIRED_STRINGS: Array<string> = [
  "Incident Forms",
  "Incident Form",
  "Create Incident Form",
  "Create New Incident Form",
  "Edit Incident Form",
  "Delete Incident Form",
  "Are you sure you want to delete this incident form?",
  "Incident Form ID",
  "Let Reporter Choose Severity",
  "Require Reporter Details",
  "Reporter Name",
  "Reporter Email",
  "Description Question",
  "Form Settings",
  "Edit Form Settings",
  "Edit Form Details",
  "Edit Incident Settings",
  "Edit Questions",
  "No reports have been submitted through this form yet.",
];

// What a sentence, a question and a lead-in may end with, per script.
const ENDINGS: Record<string, Array<string>> = {
  ".": [".", "。", "।"],
  "?": ["?", "？", "؟"],
  ":": [":", "："],
};

function endingOf(text: string): string | null {
  for (const [ending, variants] of Object.entries(ENDINGS)) {
    if (
      variants.some((variant: string): boolean => {
        return text.trim().endsWith(variant);
      })
    ) {
      return ending;
    }
  }

  return null;
}

const PLACEHOLDER: RegExp = /\{\{[^}]+\}\}/g;

function placeholders(text: string): Array<string> {
  return (text.match(PLACEHOLDER) || []).sort();
}

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
}

function readRaw(relativePath: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8");
}

// Comments removed (they may quote copy), whitespace squashed.
function readCode(relativePath: string): string {
  return readRaw(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|\s)\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
}

function readCommon(...relativePath: Array<string>): string {
  return fs
    .readFileSync(path.join(COMMON_UI, ...relativePath), "utf8")
    .replace(/\s+/g, " ");
}

/*
 * Literal values of the props the translating components look up - titles,
 * descriptions, placeholders, empty-table messages and button texts - in
 * both the `prop: "…"` and the JSX `prop="…"` spelling, the labels of a
 * record keyed by an enum (a dropdown's options, which the Dropdown looks
 * up), and the pages' own translateString("…") and tx("…") calls.
 */
function translatedLiterals(code: string): Array<string> {
  const literals: Array<string> = [];
  const patterns: Array<RegExp> = [
    /\b(?:title|description|placeholder|noItemsMessage|submitButtonText|editButtonText|singularName|pluralName|text)\s*[:=]\s*"((?:[^"\\]|\\.)*)"/g,
    /\]\s*:\s*"((?:[^"\\]|\\.)*)"/g,
    /\b(?:translateString|tx)\(\s*"((?:[^"\\]|\\.)*)"\s*\)/g,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null = pattern.exec(code);

    while (match !== null) {
      literals.push(JSON.parse(`"${match[1] as string}"`) as string);
      match = pattern.exec(code);
    }
  }

  // An empty string is never looked up: it is a state's starting value.
  return literals.filter((literal: string): boolean => {
    return literal.length > 0;
  });
}

const english: Record<string, unknown> = readLocale("en");
const englishKeys: Array<string> = Object.keys(english);

describe("the glossary's words", () => {
  test("the product, the menus and the pages", () => {
    expect(FormsCopy.productTitle).toBe("Forms");
    expect(singularName).toBe("Form");
    expect(new Form().pluralName).toBe(FormsCopy.productTitle);
    expect([
      FormsCopy.builderTitle,
      FormsCopy.shareLinkTitle,
      FormsCopy.afterSubmittingTitle,
      FormsCopy.submissionsTitle,
    ]).toEqual(["Questions", "Share Link", "After Submitting", "Submissions"]);
  });

  test("what each target is called", () => {
    expect(FORM_TARGET_TYPE_TEXT[FormTargetType.Incident].title).toBe(
      "Incident",
    );
    expect(
      FORM_TARGET_TYPE_TEXT[FormTargetType.ScheduledMaintenance].title,
    ).toBe("Scheduled Maintenance");
  });

  test("the Share Link card", () => {
    expect([
      FormsCopy.copyLink,
      FormsCopy.openForm,
      FormsCopy.resetLink,
    ]).toEqual(["Copy Link", "Open Form", "Reset Link"]);
    expect(FormsCopy.formTurnedOff).toBe(
      "This form is turned off, so its link shows a 'not available' message.",
    );
  });

  /*
   * The Access card offers only entries the save-time check accepts, and
   * says IPv6 ranges are refused for as long as that check refuses them.
   */
  test("the IP allowlist's help says ranges must be IPv4, as the save-time check does", () => {
    const text: string = FormsCopy.ipAllowlistDescription;
    const examples: Array<string> = [
      "203.0.113.7",
      "2001:db8::1",
      "10.0.0.0/8",
    ];

    expect(text).toBe(
      "One IP address or IPv4 CIDR range per line, such as 203.0.113.7, 2001:db8::1 or 10.0.0.0/8. IPv6 ranges are not supported. Leave it empty to allow every network.",
    );
    expect(
      text.match(
        /(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?|[0-9a-f]+(?::[0-9a-f]*)+/gi,
      ),
    ).toEqual(examples);
    expect(validateFormIpAllowlist(examples.join("\n"))).toBeNull();
    expect(validateFormIpAllowlist("2001:db8::/32")).toContain(
      "only IPv4 ranges are supported",
    );

    // The column's description, which the API reference shows, says it too.
    expect(
      new Form().getTableColumnMetadata("ipWhitelist")?.description,
    ).toContain("IPv6 ranges are not supported.");
  });

  test("the submissions", () => {
    expect([
      FormsCopy.submittedAt,
      FormsCopy.submitterName,
      FormsCopy.submitterEmail,
    ]).toEqual(["Submitted At", "Submitter Name", "Submitter Email"]);
  });

  // The API reference and Terraform show the column titles.
  test("the form's columns are titled with the dashboard's words", () => {
    const form: Form = new Form();

    const titleOf: (column: string) => string | undefined = (
      column: string,
    ): string | undefined => {
      return form.getTableColumnMetadata(column)?.title;
    };

    expect(titleOf("isEnabled")).toBe(FormsCopy.acceptingSubmissions);
    expect(titleOf("fields")).toBe(FormsCopy.builderTitle);
    expect(titleOf("successMessage")).toBe(FormsCopy.successMessageTitle);
    expect(titleOf("ipWhitelist")).toBe(FormsCopy.ipAllowlistTitle);
  });
});

describe("the composed strings", () => {
  /*
   * The shared components build these from the model's name with a template
   * ("Create {{itemName}}"), and look the whole English phrase up first
   * ("Create Form"), so the phrases the Forms locales word themselves win.
   */
  test("are what the shared components build from the model's name", () => {
    // The whole phrase first, then the template with the name translated.
    expect(readCommon("..", "Utils", "TranslateTemplate.ts")).toContain(
      "if (translator.hasTranslation(phrase)) { return translator.translateText(phrase) || phrase; }",
    );

    // The create button, and the create dialog's submit button.
    const baseModelTable: string = readCommon(
      "ModelTable",
      "BaseModelTable.tsx",
    );

    expect(baseModelTable).toContain(
      'Create: translationKey("Create {{itemName}}"),',
    );
    expect(baseModelTable).toContain(
      'return translateCreateAction(translator, { verb: props.createVerb, itemName: props.singularName || model.singularName || "", });',
    );

    // The create dialog's title and its submit button.
    const modelTable: string = readCommon("ModelTable", "ModelTable.tsx");

    expect(modelTable).toContain(
      'Create: translationKey("Create New {{itemName}}"),',
    );
    expect(modelTable).toContain(
      'itemName: props.singularName || model.singularName || "", values: { action: translatableTerm(props.createVerb || "") },',
    );
    expect(modelTable).toContain(
      '? translateCreateAction(translator, { verb: props.createVerb, itemName: props.singularName || model.singularName || "", })',
    );

    /*
     * Each card's edit modal: "Edit <model>", unless the card names its
     * dialog itself. The Forms cards do not.
     */
    const cardModelDetail: string = readCommon(
      "ModelDetail",
      "CardModelDetail.tsx",
    );

    expect(cardModelDetail).toContain(
      'const editTitle: string = translateNamedAction(translator, { template: "Edit {{itemName}}", itemName: model.singularName || "", });',
    );
    expect(cardModelDetail).toContain(
      "title={props.editModalTitle || editTitle}",
    );

    // The delete card, its button and its confirmation.
    const modelDelete: string = readCommon("ModelDelete", "ModelDelete.tsx");

    expect(modelDelete).toContain(
      'title={translateNamedAction(translator, { template: "Delete {{itemName}}", itemName: model.singularName || "", })}',
    );
    expect(modelDelete).toContain(
      'const typeLabel: string = model.singularName || "item";',
    );

    const deleteMessage: string = readCommon(
      "DeleteConfirmation",
      "DeleteConfirmationMessage.tsx",
    );

    expect(deleteMessage).toContain(
      'const typeLabel: string = data.typeLabel.trim().toLowerCase() || "item";',
    );
    expect(deleteMessage).toContain(
      "return `Are you sure you want to delete this ${typeLabel}?`;",
    );
    // That sentence is looked up whole before the template is used.
    expect(deleteMessage).toContain(
      "if (translator.hasTranslation(sentence)) { return translator.translateText(sentence) || sentence; }",
    );
  });
});

describe("Forms strings in every Dashboard locale", () => {
  test("the lists are well formed, and really read", () => {
    // The walk reaches every page and component of the product.
    expect(FEATURE_FILES).toEqual(
      expect.arrayContaining([
        "Components/FormBuilder/Builder/FormBuilder.tsx",
        "Components/FormBuilder/OnSubmit/FormMappingCard.tsx",
        "Components/FormBuilder/Submissions/FormSubmissionsTable.tsx",
        "Pages/Forms/Forms.tsx",
        "Pages/Forms/View/Share.tsx",
      ]),
    );
    expect(COPY_STRINGS.length).toBeGreaterThan(150);
    expect(QUESTION_TYPE_STRINGS.length).toBeGreaterThanOrEqual(16);
    expect(CATALOG_STRINGS.length).toBeGreaterThan(40);
    expect(ALL_STRINGS.length).toBeGreaterThan(200);
  });

  test.each(ALL_STRINGS)("%j holds no placeholder braces", (text: string) => {
    expect(text).not.toContain("{{");
  });

  test("en.json maps every string to itself", () => {
    const missing: Array<string> = ALL_STRINGS.filter(
      (key: string): boolean => {
        return english[key] !== key;
      },
    );

    expect(missing).toEqual([]);
  });

  test("the words of the Incident Forms pages are gone from every locale", () => {
    for (const locale of ["en", ...OTHER_LOCALES]) {
      const keys: Array<string> = Object.keys(readLocale(locale));

      expect([
        locale,
        RETIRED_STRINGS.filter((key: string): boolean => {
          return keys.includes(key);
        }),
      ]).toEqual([locale, []]);
    }
  });

  describe.each(OTHER_LOCALES)("%s", (locale: string) => {
    const translations: Record<string, unknown> = readLocale(locale);
    const keys: Array<string> = Object.keys(translations);

    test("translates every string", () => {
      const problems: Array<string> = [];
      const sameAsEnglish: Array<string> = [
        ...SAME_EVERYWHERE,
        ...(SAME_AS_ENGLISH[locale] || []),
      ];

      for (const key of ALL_STRINGS) {
        const value: unknown = translations[key];

        if (typeof value !== "string" || value.trim().length === 0) {
          problems.push(`missing: ${key}`);
          continue;
        }

        if (value.includes("{{") || value.includes("}}")) {
          problems.push(`stray placeholder: ${key}`);
        }

        if (
          JSON.stringify(placeholders(value)) !==
          JSON.stringify(placeholders(key))
        ) {
          problems.push(`placeholders differ: ${key}`);
        }

        if (value === key && !sameAsEnglish.includes(key)) {
          problems.push(`left in English: ${key}`);
        }
      }

      expect(problems).toEqual([]);
    });

    test("leaves in English only the words it shares with English", () => {
      for (const key of SAME_AS_ENGLISH[locale] || []) {
        expect(ALL_STRINGS).toContain(key);
        expect(translations[key]).toBe(key);
      }
    });

    // Whatever the words, the Access card's help keeps what it tells an admin.
    test("says IP allowlist ranges must be IPv4, with the same examples", () => {
      const value: string = String(
        translations[FormsCopy.ipAllowlistDescription] || "",
      );

      for (const kept of [
        "IPv4",
        "IPv6",
        "203.0.113.7",
        "2001:db8::1",
        "10.0.0.0/8",
      ]) {
        expect([kept, value.includes(kept)]).toEqual([kept, true]);
      }
    });

    test("keeps sentences as sentences, questions as questions and labels as labels", () => {
      const problems: Array<string> = ALL_STRINGS.filter(
        (text: string): boolean => {
          return endingOf(text) !== endingOf(String(translations[text] || ""));
        },
      );

      expect(problems).toEqual([]);
    });

    test("keeps the strings in en.json's order", () => {
      const inEnglishOrder: Array<string> = englishKeys.filter(
        (key: string): boolean => {
          return ALL_STRINGS.includes(key);
        },
      );
      const inThisOrder: Array<string> = keys.filter((key: string): boolean => {
        return ALL_STRINGS.includes(key);
      });

      expect(inThisOrder).toEqual(inEnglishOrder);
    });

    test("names the product in the product menu, after Runbooks", () => {
      const items: Record<string, unknown> = (
        translations["navbar"] as Record<string, Record<string, unknown>>
      )["items"] as Record<string, unknown>;
      const itemKeys: Array<string> = Object.keys(items);

      expect(
        itemKeys.slice(itemKeys.indexOf("runbooksDescription") + 1),
      ).toEqual(expect.arrayContaining(["formsTitle", "formsDescription"]));
      expect(itemKeys[itemKeys.indexOf("runbooksDescription") + 1]).toBe(
        "formsTitle",
      );
      expect(itemKeys[itemKeys.indexOf("runbooksDescription") + 2]).toBe(
        "formsDescription",
      );

      for (const key of ["formsTitle", "formsDescription"]) {
        const value: unknown = items[key];
        const englishValue: unknown = (
          (english["navbar"] as Record<string, Record<string, unknown>>)[
            "items"
          ] as Record<string, unknown>
        )[key];

        expect(typeof value).toBe("string");
        expect((value as string).trim().length).toBeGreaterThan(0);
        expect(value).not.toBe(englishValue);
      }
    });
  });
});

describe("the dashboard renders the strings", () => {
  test("the product menu's Forms item says what en.json says", () => {
    const items: Record<string, unknown> = (
      english["navbar"] as Record<string, Record<string, unknown>>
    )["items"] as Record<string, unknown>;
    const navigation: string = readCode("Utils/NavigationItems.tsx");

    expect(items["formsTitle"]).toBe("Forms");
    expect(navigation).toContain(
      `t("navbar.items.formsTitle", ${JSON.stringify(items["formsTitle"])})`,
    );
    expect(navigation).toContain(
      `t( "navbar.items.formsDescription", ${JSON.stringify(items["formsDescription"])}, )`,
    );
  });

  test("the menus and the breadcrumbs", () => {
    const menus: string = [
      readCode("Pages/Forms/SideMenu.tsx"),
      readCode("Pages/Forms/View/SideMenu.tsx"),
    ].join(" ");
    const breadcrumbs: string = readCode(
      "Utils/Breadcrumbs/FormsBreadcrumbs.ts",
    );

    for (const title of ["Forms", "Submissions"]) {
      expect(menus).toContain(`title: "${title}"`);
    }

    for (const title of ["Build", "On Submit", "Share", "Delete Form"]) {
      expect(menus).toContain(`title: "${title}"`);
      expect(breadcrumbs).toContain(
        `"${title === "Build" ? "View Form" : title}"`,
      );
    }

    expect(menus).toContain('title="Form"');
  });

  test("every string in the copy module is used by a page or a component", () => {
    const code: string = FEATURE_FILES.filter((file: string): boolean => {
      return !file.endsWith("/FormsCopy.ts");
    })
      .map((file: string): string => {
        return readCode(file);
      })
      .join(" ");

    const unused: Array<string> = Object.keys(FormsCopy).filter(
      (key: string): boolean => {
        return !code.includes(`FormsCopy.${key}`);
      },
    );

    expect(unused).toEqual([]);
  });

  /*
   * The guard against a new string skipping translation: every literal the
   * product's files hand to a translating prop, or look up themselves, must
   * be a key in en.json.
   */
  test("every literal the pages hand to a translating prop is in en.json", () => {
    const walked: Array<string> = Array.from(
      new Set<string>(
        FEATURE_FILES.flatMap((file: string): Array<string> => {
          return translatedLiterals(readCode(file));
        }),
      ),
    ).sort();

    // Sanity: the walker really reaches the files.
    expect(walked).toEqual(
      expect.arrayContaining([
        "Name",
        "Description",
        "Forms",
        "Build",
        "On Submit",
        "Delete",
        // The question types' names and what the palette says about them.
        FORM_QUESTION_TYPE_TEXT[QUESTION_TYPE_KEY]!.title,
      ]),
    );

    const untranslated: Array<string> = walked.filter(
      (text: string): boolean => {
        return english[text] !== text;
      },
    );

    expect(untranslated).toEqual([]);
  });

  /*
   * These draw text the shared components do not translate for them, so
   * they look it up themselves.
   */
  test("the pages and components look up what the shared components do not", () => {
    const card: string = readCode(
      "Components/FormBuilder/FormShareLinkCard.tsx",
    );

    // CopyTextButton looks its label and title up itself.
    expect(card).toContain("label={FormsCopy.copyLink}");
    expect(card).toContain("title={FormsCopy.copyLink}");
    expect(card).not.toContain("translateString(FormsCopy.copyLink)");
    expect(card).toContain("translateString(FormsCopy.openForm)");

    expect(readCode("Pages/Forms/View/Delete.tsx")).toContain(
      "translateString(FormsCopy.deleteFormNote)",
    );
  });
});
