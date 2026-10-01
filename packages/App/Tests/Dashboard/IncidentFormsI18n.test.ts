import IncidentFormCopy from "../../FeatureSet/Dashboard/src/Components/IncidentForm/IncidentFormCopy";
import IncidentForm from "Common/Models/DatabaseModels/IncidentForm";
import { validateIncidentFormIpAllowlist } from "Common/Types/Incident/IncidentFormIpAllowlist";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The dashboard's incident forms pages (issue #4114) - the Forms menu item
 * and breadcrumbs, the list of forms, a form's page and its Share Link card -
 * reach the screen through components that look each string up in the
 * Dashboard locale files by its English text (SideMenuItem, Breadcrumbs,
 * Card and its buttons, Modal, ConfirmModal, FormField, TableHeader, Detail,
 * the Alert banner, ErrorMessage) or through the pages' own lookups. A string
 * with no entry silently stays English, so this pins:
 *
 *   - the glossary's words, exactly - the docs quote them - and that the
 *     form's column titles, which the API reference shows, say the same;
 *   - en.json maps every string to itself, and all sixteen other locales
 *     carry a real, non-empty translation, sentences still sentences, each
 *     new key between the same neighbours as in en.json;
 *   - the strings ModelTable, CardModelDetail and ModelDelete compose from
 *     the model's name ("Create Incident Form") have entries too;
 *   - the source still renders every one of them, and nothing the new pages
 *     hand a translating prop is missing from en.json.
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

const SIDE_MENU: string = "Pages/Incidents/SideMenu.tsx";
const BREADCRUMBS: string = "Utils/Breadcrumbs/IncidentBreadcrumbs.ts";

// Every file the feature added to the dashboard.
const FEATURE_FILES: Array<string> = [
  "Pages/Incidents/Settings/IncidentForms.tsx",
  "Pages/Incidents/Settings/IncidentFormView.tsx",
  "Components/IncidentForm/IncidentFormFields.ts",
  "Components/IncidentForm/IncidentFormShareLinkCard.tsx",
];

// The menu item and the view page's last breadcrumb.
const NAVIGATION_STRINGS: Array<string> = ["Forms", "View Form"];

/*
 * Composed by the shared components from the model's singular name, so
 * they cannot be looked up unless they have entries of their own: the
 * create button and the create modal's submit button, the create modal's
 * title, the edit modals' title, and the delete card.
 */
const singularName: string = new IncidentForm().singularName || "";

const COMPOSED_STRINGS: Array<string> = [
  singularName,
  `Create ${singularName}`,
  `Create New ${singularName}`,
  `Edit ${singularName}`,
  `Delete ${singularName}`,
  `Are you sure you want to delete this ${singularName.toLowerCase()}?`,
];

const COPY_STRINGS: Array<string> = Object.values(IncidentFormCopy);

/*
 * The entries the Access card's help offers as examples - an IPv4 address,
 * an IPv6 address and an IPv4 range - and a pattern that finds each address
 * or range written in a sentence.
 */
const IP_ALLOWLIST_EXAMPLES: Array<string> = [
  "203.0.113.7",
  "2001:db8::1",
  "10.0.0.0/8",
];

const IP_ALLOWLIST_EXAMPLE_PATTERN: RegExp =
  /(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?|[0-9a-f]+(?::[0-9a-f]*)+/gi;

// Every key this feature added to the locale files.
const NEW_KEYS: Array<string> = [
  ...NAVIGATION_STRINGS,
  ...COMPOSED_STRINGS,
  ...COPY_STRINGS,
];

/*
 * Strings the pages render that other pages had first. Pinned so a clean-up
 * of "unused" keys cannot take one away from these pages.
 */
const REUSED_KEYS: Array<string> = [
  "Name",
  "Description",
  "Enabled",
  "Severity",
  "Incident Template",
  "Incident Settings",
  "Access",
  "Questions",
  "Incident",
  "View Incident",
  "Required",
  "Optional",
  "Hidden",
  "Select Severity",
  "Select Incident Template",
  "No severity",
  "No description set.",
  "Not set",
  "None",
  "Delete",
  "Copied!",
  "View Documentation",
];

// What a sentence may end with, per script.
const SENTENCE_ENDINGS: Array<string> = [".", "。", "।"];

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

// The keys on either side of `key` in a locale file, in file order.
function neighboursOf(
  keys: Array<string>,
  key: string,
): { before: string | undefined; after: string | undefined } {
  const index: number = keys.indexOf(key);

  return {
    before: index > 0 ? keys[index - 1] : undefined,
    after: index >= 0 ? keys[index + 1] : undefined,
  };
}

/*
 * Literal values of the props the translating components look up - titles,
 * descriptions, placeholders, empty-table messages and button texts - in
 * both the `prop: "…"` and the JSX `prop="…"` spelling, the labels of a
 * record keyed by an enum (a dropdown's options, which the Dropdown looks
 * up), and the pages' own translateString("…") calls.
 */
function translatedLiterals(code: string): Array<string> {
  const literals: Array<string> = [];
  const patterns: Array<RegExp> = [
    /\b(?:title|description|placeholder|noItemsMessage|submitButtonText|editButtonText|singularName|pluralName|text)\s*[:=]\s*"((?:[^"\\]|\\.)*)"/g,
    /\]\s*:\s*"((?:[^"\\]|\\.)*)"/g,
    /translateString\(\s*"((?:[^"\\]|\\.)*)"\s*\)/g,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null = pattern.exec(code);

    while (match !== null) {
      literals.push(JSON.parse(`"${match[1] as string}"`) as string);
      match = pattern.exec(code);
    }
  }

  return literals;
}

const english: Record<string, unknown> = readLocale("en");
const englishKeys: Array<string> = Object.keys(english);

describe("the glossary's words", () => {
  test("the menu, the list and the cards", () => {
    expect(NAVIGATION_STRINGS).toEqual(["Forms", "View Form"]);
    expect(IncidentFormCopy.listTitle).toBe("Incident Forms");
    expect(singularName).toBe("Incident Form");
    expect([
      IncidentFormCopy.formDetailsTitle,
      IncidentFormCopy.shareLinkTitle,
      IncidentFormCopy.formSettingsTitle,
      IncidentFormCopy.submissionsTitle,
    ]).toEqual(["Form Details", "Share Link", "Form Settings", "Submissions"]);
  });

  test("the Share Link card", () => {
    expect([
      IncidentFormCopy.copyLink,
      IncidentFormCopy.openForm,
      IncidentFormCopy.resetLink,
    ]).toEqual(["Copy Link", "Open Form", "Reset Link"]);
    expect(IncidentFormCopy.formTurnedOff).toBe(
      "This form is turned off, so its link shows a 'not available' message.",
    );
  });

  test("the settings", () => {
    expect([
      IncidentFormCopy.letReporterChooseSeverityTitle,
      IncidentFormCopy.descriptionQuestionTitle,
      IncidentFormCopy.requireReporterDetailsTitle,
      IncidentFormCopy.successMessageTitle,
      IncidentFormCopy.ipAllowlistTitle,
    ]).toEqual([
      "Let Reporter Choose Severity",
      "Description Question",
      "Require Reporter Details",
      "Success Message",
      "IP Allowlist",
    ]);
  });

  /*
   * A form's incident template fills in what the form and the reporter
   * leave: the form's severity (or the reporter's choice) and the
   * reporter's title, description and answers come first, as the server
   * applies them. The two places that say so must say it the same way.
   */
  test("what an incident template does to a form's incidents", () => {
    for (const text of [
      IncidentFormCopy.incidentSettingsDescription,
      IncidentFormCopy.templateDescription,
    ]) {
      expect(text).toContain(
        "form's severity (or the one the reporter chooses) and the reporter's title, description and answers come first, and the template fills in everything else, including its monitors, on-call policies and a monitor status change.",
      );
      expect(text).not.toContain("everything the template sets applies");
    }
  });

  /*
   * The Access card offers only entries the save-time check accepts, and
   * says IPv6 ranges are refused for as long as that check refuses them
   * (validateIncidentFormIpAllowlist). The examples alone would not pin it:
   * the old wording's examples pass the check too.
   */
  test("the IP allowlist's help says ranges must be IPv4, as the save-time check does", () => {
    const text: string = IncidentFormCopy.ipAllowlistDescription;

    expect(text).toBe(
      "One IP address or IPv4 CIDR range per line, such as 203.0.113.7, 2001:db8::1 or 10.0.0.0/8. IPv6 ranges are not supported. Leave it empty to allow every network.",
    );
    expect(text).not.toContain("One IP address or CIDR range per line");
    expect(text.match(IP_ALLOWLIST_EXAMPLE_PATTERN)).toEqual(
      IP_ALLOWLIST_EXAMPLES,
    );
    expect(
      validateIncidentFormIpAllowlist(IP_ALLOWLIST_EXAMPLES.join("\n")),
    ).toBeNull();
    expect(validateIncidentFormIpAllowlist("2001:db8::/32")).toContain(
      "only IPv4 ranges are supported",
    );

    // The column's description, which the API reference shows, says it too.
    expect(
      new IncidentForm().getTableColumnMetadata("ipWhitelist")?.description,
    ).toContain("IPv6 ranges are not supported.");
  });

  test("the Submissions table", () => {
    expect([
      IncidentFormCopy.submittedAt,
      IncidentFormCopy.reporterName,
      IncidentFormCopy.reporterEmail,
    ]).toEqual(["Submitted At", "Reporter Name", "Reporter Email"]);
  });

  // The API reference and Terraform show the column titles.
  test("the form's columns are titled with the same words", () => {
    const form: IncidentForm = new IncidentForm();

    const titleOf: (column: string) => string | undefined = (
      column: string,
    ): string | undefined => {
      return form.getTableColumnMetadata(column)?.title;
    };

    expect(titleOf("isEnabled")).toBe("Enabled");
    expect(titleOf("allowReporterToChooseSeverity")).toBe(
      IncidentFormCopy.letReporterChooseSeverityTitle,
    );
    expect(titleOf("descriptionSetting")).toBe(
      IncidentFormCopy.descriptionQuestionTitle,
    );
    expect(titleOf("isReporterDetailsRequired")).toBe(
      IncidentFormCopy.requireReporterDetailsTitle,
    );
    expect(titleOf("successMessage")).toBe(
      IncidentFormCopy.successMessageTitle,
    );
    expect(titleOf("ipWhitelist")).toBe(IncidentFormCopy.ipAllowlistTitle);
    expect(new IncidentForm().pluralName).toBe(IncidentFormCopy.listTitle);
  });
});

describe("the composed strings", () => {
  test("are what the shared components build from the model's name", () => {
    // The create button: the whole phrase is looked up first.
    expect(readCommon("ModelTable", "BaseModelTable.tsx")).toContain(
      "const phrase: string = `${verb} ${noun}`;",
    );
    // The create modal's title, and its submit button.
    const modelTable: string = readCommon("ModelTable", "ModelTable.tsx");

    expect(modelTable).toContain(
      '`${props.createVerb || "Create"} New ${ props.singularName || model.singularName }`',
    );
    expect(modelTable).toContain(
      '`${props.createVerb || "Create"} ${ props.singularName || model.singularName }`',
    );
    // Each card's edit modal.
    expect(readCommon("ModelDetail", "CardModelDetail.tsx")).toContain(
      "title={`Edit ${model.singularName}`}",
    );
    // The delete card, its button and its confirmation.
    const modelDelete: string = readCommon("ModelDelete", "ModelDelete.tsx");

    expect(modelDelete).toContain("title={`Delete ${model.singularName}`}");
    expect(modelDelete).toContain(
      "description={`Are you sure you want to delete this ${model.singularName?.toLowerCase()}?`}",
    );
  });
});

describe("incident forms strings in every Dashboard locale", () => {
  test("the lists are well formed", () => {
    expect(new Set<string>(NEW_KEYS).size).toBe(NEW_KEYS.length);
    expect(NEW_KEYS.length).toBe(60);

    for (const key of REUSED_KEYS) {
      expect(NEW_KEYS).not.toContain(key);
    }
  });

  test.each(NEW_KEYS)("%j holds no placeholder braces", (text: string) => {
    expect(text).not.toContain("{{");
  });

  test("en.json maps every new and reused string to itself", () => {
    const missing: Array<string> = [...NEW_KEYS, ...REUSED_KEYS].filter(
      (key: string): boolean => {
        return english[key] !== key;
      },
    );

    expect(missing).toEqual([]);
  });

  test("the new keys sit together, in one block", () => {
    const positions: Array<number> = NEW_KEYS.map((key: string): number => {
      return englishKeys.indexOf(key);
    });
    const first: number = Math.min(...positions);

    expect(first).toBeGreaterThan(-1);
    expect(
      [...englishKeys.slice(first, first + NEW_KEYS.length)].sort(),
    ).toEqual([...NEW_KEYS].sort());
  });

  describe.each(OTHER_LOCALES)("%s", (locale: string) => {
    const translations: Record<string, unknown> = readLocale(locale);
    const keys: Array<string> = Object.keys(translations);

    test("translates every new string", () => {
      const problems: Array<string> = [];

      for (const key of NEW_KEYS) {
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

        /*
         * None of the new strings is a brand or a loanword, so a value
         * identical to English is a copy somebody forgot to translate.
         */
        if (value === key) {
          problems.push(`left in English: ${key}`);
        }
      }

      expect(problems).toEqual([]);
    });

    // Whatever the words, the Access card's help keeps what it tells an admin.
    test("says IP allowlist ranges must be IPv4, with the same examples", () => {
      const value: string = String(
        translations[IncidentFormCopy.ipAllowlistDescription] || "",
      );

      for (const kept of ["IPv4", "IPv6", ...IP_ALLOWLIST_EXAMPLES]) {
        expect([kept, value.includes(kept)]).toEqual([kept, true]);
      }
    });

    test("keeps every reused string", () => {
      const missing: Array<string> = REUSED_KEYS.filter(
        (key: string): boolean => {
          const value: unknown = translations[key];
          return typeof value !== "string" || value.trim().length === 0;
        },
      );

      expect(missing).toEqual([]);
    });

    test("keeps sentences as sentences and labels as labels", () => {
      const problems: Array<string> = NEW_KEYS.filter(
        (text: string): boolean => {
          const value: string = String(translations[text] || "").trim();
          const isSentence: boolean = text.endsWith(".");
          const endsLikeSentence: boolean = SENTENCE_ENDINGS.some(
            (ending: string): boolean => {
              return value.endsWith(ending);
            },
          );

          return isSentence !== endsLikeSentence;
        },
      );

      expect(problems).toEqual([]);
    });

    test("places every new key between the same neighbours as en.json", () => {
      const misplaced: Array<string> = NEW_KEYS.filter(
        (text: string): boolean => {
          return (
            JSON.stringify(neighboursOf(keys, text)) !==
            JSON.stringify(neighboursOf(englishKeys, text))
          );
        },
      );

      expect(misplaced).toEqual([]);
    });
  });
});

describe("the dashboard renders the strings", () => {
  test("the menu item and the breadcrumbs", () => {
    expect(readRaw(SIDE_MENU)).toContain('title: "Forms"');
    expect(readRaw(BREADCRUMBS)).toContain('"Forms",');
    expect(readRaw(BREADCRUMBS)).toContain('"View Form",');
  });

  test("every string in the copy module is used by a page or the card", () => {
    const code: string = FEATURE_FILES.map((file: string): string => {
      return readCode(file);
    }).join(" ");

    const unused: Array<string> = Object.keys(IncidentFormCopy).filter(
      (key: string): boolean => {
        return !code.includes(`IncidentFormCopy.${key}`);
      },
    );

    expect(unused).toEqual([]);
  });

  /*
   * The guard against a new string skipping translation: every literal the
   * feature's files hand to a translating prop, or look up themselves, must
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

    // Sanity: the walker really reaches every file.
    expect(walked).toEqual(
      expect.arrayContaining([
        "Name",
        "Severity",
        "Incident Template",
        "Incident Settings",
        "Access",
        "View Incident",
        "Enabled",
        "Select Severity",
        "No severity",
        "None",
        "Copied!",
        // The description question's options.
        "Required",
        "Optional",
        "Hidden",
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
   * These draw text the shared components do not translate for them, so they
   * look it up themselves.
   */
  test("the Share Link card translates its own buttons, and the page its own words", () => {
    const card: string = readCode(
      "Components/IncidentForm/IncidentFormShareLinkCard.tsx",
    );

    expect(card).toContain("translateString(IncidentFormCopy.copyLink)");
    expect(card).toContain("translateString(IncidentFormCopy.openForm)");
    expect(card).toContain('translateString("Copied!")');

    const view: string = readCode(
      "Pages/Incidents/Settings/IncidentFormView.tsx",
    );

    expect(view).toContain("translateString(IncidentFormCopy.accessPlanNote)");
    expect(view).toContain("translateString(IncidentFormCopy.deleteFormNote)");
    expect(view).toContain("translateString(label)");
  });
});
