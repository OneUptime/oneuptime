import {
  CUSTOM_FIELD_TYPE_LABELS,
  IncidentCustomFieldSettingsCopy,
} from "../../../FeatureSet/Dashboard/src/Components/CustomFields/CustomFieldSettingsCopy";
import IncidentCustomField from "Common/Models/DatabaseModels/IncidentCustomField";
import ProjectCallSMSConfig from "Common/Models/DatabaseModels/ProjectCallSMSConfig";
import ProjectSmtpConfig from "Common/Models/DatabaseModels/ProjectSmtpConfig";
import StatusPageSubscriberNotificationTemplate from "Common/Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import StatusPageSubscriberNotificationTemplateStatusPage from "Common/Models/DatabaseModels/StatusPageSubscriberNotificationTemplateStatusPage";
import slugify from "Common/Server/Types/MarkdownSlugify";
import SubscriberTemplateIncidentRecordAccess from "Common/Server/Utils/StatusPage/SubscriberTemplateIncidentRecordAccess";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import { CustomFieldDefinition } from "Common/Types/CustomField/CustomFieldDefinition";
import { INCIDENT_CUSTOM_FIELD_TABLE_VIEW_IDS } from "Common/Types/CustomField/CustomFieldSavedViews";
import CustomFieldType from "Common/Types/CustomField/CustomFieldType";
import {
  CustomFieldValueValidationError,
  validateCustomFieldValues,
} from "Common/Types/CustomField/CustomFieldValueValidator";
import {
  CUSTOM_FIELD_TEMPLATE_VARIABLE_PREFIX,
  generateCustomFieldVariableKey,
  getCustomFieldVariableKeyBase,
} from "Common/Types/CustomField/CustomFieldVariableKey";
import { JSONObject } from "Common/Types/JSON";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import SubscriberNotificationTemplateVariables from "Common/Types/StatusPage/SubscriberNotificationTemplateVariables";
import {
  INCIDENT_NOTE_CUSTOM_FIELD_VARIABLE_PREFIX,
  INCIDENT_NOTE_TEMPLATE_VARIABLES,
  IncidentNoteTemplateVariableInfo,
} from "Common/Utils/Incident/IncidentNoteTemplateVariables";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The docs for incident custom fields, their values in subscriber messages
 * and note templates, against the feature they describe.
 *
 * Markdown is not compiled, so nothing else notices when the settings page
 * renames a setting or gains a field type, when the value check starts
 * refusing what the docs' own example sends, when a template variable or a
 * note placeholder is added or dropped, when a plan gate or the custom SMTP
 * and Twilio requirement of custom templates changes, when the Terraform
 * attribute names drift from the columns, when a link to another page's
 * section loses its heading, or when the Persian pages fall behind the
 * English ones. Each test reads the source of truth - the settings copy the
 * dashboard renders, the models, the validator, the key generator, the
 * template variable lists, the workers and the Terraform fixture - and checks
 * the shipped pages still tell the same story.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");
const APP_DIR: string = path.join(REPO_ROOT, "App/FeatureSet");
const COMMON_DIR: string = path.join(REPO_ROOT, "Common");
const TERRAFORM_FIXTURE_DIR: string = path.join(
  REPO_ROOT,
  "E2E/Terraform/e2e-tests/tests/52-custom-fields",
);

// `fa` is the only translated corpus; every other language falls back to English.
const LANGUAGES: ReadonlyArray<string> = ["en", "fa"];

const SETTINGS_PAGE: string = "incidents/settings";
const DECLARING_PAGE: string = "incidents/declaring-incidents";
const NOTES_PAGE: string = "incidents/notes-owners-and-feed";
const SUBSCRIBERS_PAGE: string = "status-pages/subscribers";
const GUIDE_PAGE: string = "status-pages/one-status-page-per-audience";
const INVENTORY_FIELDS_PAGE: string = "inventory/custom-fields";

// The pages this feature's docs live on or link between.
const PAGES: ReadonlyArray<string> = [
  SETTINGS_PAGE,
  DECLARING_PAGE,
  NOTES_PAGE,
  SUBSCRIBERS_PAGE,
  GUIDE_PAGE,
  INVENTORY_FIELDS_PAGE,
];

// The sections compared across languages, by their heading in each.
const CUSTOM_FIELDS_SECTION: Record<string, string> = {
  en: "Custom fields",
  fa: "فیلدهای سفارشی",
};
const TEMPLATES_SECTION: Record<string, string> = {
  en: "Customizing notification templates",
  fa: "سفارشی‌سازی قالب‌های اعلان",
};
const API_SUBSECTION: Record<string, string> = {
  en: "Custom field values through the API",
  fa: "مقادیر فیلدهای سفارشی از راه API",
};
const NOTE_TEMPLATES_SECTION: Record<string, string> = {
  en: "Note templates",
  fa: "قالب‌های یادداشت",
};
const INCIDENT_VARIABLES_SUBSECTION: Record<string, string> = {
  en: "Incident variables",
  fa: "متغیرهای حادثه",
};
const WHAT_A_TEMPLATE_NEEDS_SUBSECTION: Record<string, string> = {
  en: "What a custom template needs",
  fa: "قالب سفارشی به چه چیزی نیاز دارد",
};

// The four workers that send an incident's subscriber messages.
const INCIDENT_WORKERS: ReadonlyArray<string> = [
  "Workers/Jobs/Incident/SendNotificationToSubscribers.ts",
  "Workers/Jobs/Incident/SendPostmortemNotificationToSubscribers.ts",
  "Workers/Jobs/IncidentStateTimeline/SendNotificationToSubscribers.ts",
  "Workers/Jobs/IncidentPublicNote/SendNotificationToSubscribers.ts",
];

const FENCE_LINE: RegExp = /^\s*```/;
const ANY_HEADING: RegExp = /^(#{1,6}) (.*)$/;
// Arabic-script letters, which every Persian word contains.
const PERSIAN_LETTER: RegExp = /[؀-ۿ]/;
// A worker looking up a status page's Webhook template.
const WEBHOOK_TEMPLATE_LOOKUP: RegExp =
  /getTemplateForStatusPage\([\s\S]{0,400}?notificationMethod:\s*StatusPageSubscriberNotificationMethod\.Webhook/;

type ReadPageFunction = (relative: string, language: string) => string;

const readPage: ReadPageFunction = (
  relative: string,
  language: string,
): string => {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, `${relative}.md`),
    "utf8",
  );
};

type PageExistsFunction = (relative: string, language: string) => boolean;

const pageExists: PageExistsFunction = (
  relative: string,
  language: string,
): boolean => {
  return fs.existsSync(path.join(CONTENT_DIR, language, `${relative}.md`));
};

type ReadSourceFunction = (absolutePath: string) => string;

const readSource: ReadSourceFunction = (absolutePath: string): string => {
  return fs.readFileSync(absolutePath, "utf8");
};

interface MarkdownParts {
  prose: Array<string>;
  codeBlocks: Array<string>;
}

type SplitMarkdownFunction = (markdown: string) => MarkdownParts;

// Prose lines and fenced code blocks, kept apart so nothing is read out of a fence.
const splitMarkdown: SplitMarkdownFunction = (
  markdown: string,
): MarkdownParts => {
  const prose: Array<string> = [];
  const codeBlocks: Array<string> = [];
  let current: Array<string> | null = null;

  for (const line of markdown.split("\n")) {
    if (FENCE_LINE.test(line)) {
      if (current) {
        codeBlocks.push(current.join("\n"));
        current = null;
      } else {
        current = [];
      }
      continue;
    }

    if (current) {
      current.push(line);
    } else {
      prose.push(line);
    }
  }

  return { prose: prose, codeBlocks: codeBlocks };
};

interface Heading {
  level: number;
  text: string;
  slug: string;
}

type HeadingsFunction = (markdown: string) => Array<Heading>;

// Every heading outside a fence: the docs renderer gives each one an id.
const headingsOf: HeadingsFunction = (markdown: string): Array<Heading> => {
  const headings: Array<Heading> = [];

  for (const line of splitMarkdown(markdown).prose) {
    const match: RegExpMatchArray | null = line.match(ANY_HEADING);

    if (match) {
      const text: string = (match[2] as string).trim();

      headings.push({
        level: (match[1] as string).length,
        text: text,
        slug: slugify(text),
      });
    }
  }

  return headings;
};

type SectionFunction = (markdown: string, headingText: string) => string;

/*
 * The heading with this text and everything under it, up to the next heading
 * of the same or a higher level. A leading right-to-left mark (which the
 * Persian pages put before a heading that starts with a Latin word) is
 * ignored when matching.
 */
const sectionOf: SectionFunction = (
  markdown: string,
  headingText: string,
): string => {
  const lines: Array<string> = markdown.split("\n");
  let start: number = -1;
  let level: number = 0;
  let inFence: boolean = false;

  for (let index: number = 0; index < lines.length; index++) {
    const line: string = lines[index] as string;

    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      continue;
    }

    if (inFence) {
      continue;
    }

    const match: RegExpMatchArray | null = line.match(ANY_HEADING);

    if (!match) {
      continue;
    }

    const lineLevel: number = (match[1] as string).length;
    const text: string = (match[2] as string).replace(/^‏/, "").trim();

    if (start === -1) {
      if (text === headingText) {
        start = index;
        level = lineLevel;
      }
      continue;
    }

    if (lineLevel <= level) {
      return lines.slice(start, index).join("\n");
    }
  }

  expect({ heading: headingText, found: start !== -1 }).toEqual({
    heading: headingText,
    found: true,
  });

  return lines.slice(start).join("\n");
};

type SetOfFunction = (markdown: string) => Set<string>;

// Every `inline code` span in the prose.
const inlineCode: SetOfFunction = (markdown: string): Set<string> => {
  const prose: string = splitMarkdown(markdown).prose.join("\n");

  return new Set<string>(
    Array.from(prose.matchAll(/`([^`\n]+)`/g)).map(
      (match: RegExpMatchArray): string => {
        return match[1] as string;
      },
    ),
  );
};

// Every **bold** span in the prose: how the docs name what is on screen.
const boldText: SetOfFunction = (markdown: string): Set<string> => {
  const prose: string = splitMarkdown(markdown).prose.join("\n");

  return new Set<string>(
    Array.from(prose.matchAll(/\*\*([^*\n]+)\*\*/g)).map(
      (match: RegExpMatchArray): string => {
        return match[1] as string;
      },
    ),
  );
};

type TableFirstColumnFunction = (markdown: string) => Array<string>;

// The first cell of every table row in the prose, header and divider excluded.
const tableFirstColumn: TableFirstColumnFunction = (
  markdown: string,
): Array<string> => {
  const rows: Array<string> = splitMarkdown(markdown).prose.filter(
    (line: string): boolean => {
      return line.trim().startsWith("|");
    },
  );

  return rows
    .slice(2)
    .map((line: string): string => {
      return (line.split("|")[1] || "").trim();
    })
    .filter((cell: string): boolean => {
      return cell.length > 0;
    });
};

type TerraformNameFunction = (column: string) => string;

// A column's Terraform attribute name, as Scripts/TerraformProvider spells it.
const terraformName: TerraformNameFunction = (column: string): string => {
  return column.replace(/([a-z\d])([A-Z])/g, "$1_$2").toLowerCase();
};

type DefinitionFunction = (
  name: string,
  customFieldType: CustomFieldType,
  dropdownOptions?: string,
) => CustomFieldDefinition;

const definition: DefinitionFunction = (
  name: string,
  customFieldType: CustomFieldType,
  dropdownOptions?: string,
): CustomFieldDefinition => {
  return {
    name: name,
    customFieldType: customFieldType,
    dropdownOptions: dropdownOptions,
  };
};

describe("incident custom fields docs", () => {
  describe("the settings", () => {
    const SETTING_NAMES: ReadonlyArray<string> = [
      IncidentCustomFieldSettingsCopy.sortOrderTitle,
      IncidentCustomFieldSettingsCopy.showOnCreateTitle,
      IncidentCustomFieldSettingsCopy.isRequiredOnCreateTitle,
      IncidentCustomFieldSettingsCopy.includeInSubscriberNotificationsTitle,
      IncidentCustomFieldSettingsCopy.variableKeyColumnTitle,
    ];

    test.each(LANGUAGES)(
      "%s: names every setting as the settings page does",
      (language: string) => {
        const names: Set<string> = boldText(
          sectionOf(
            readPage(SETTINGS_PAGE, language),
            CUSTOM_FIELDS_SECTION[language] as string,
          ),
        );

        for (const name of SETTING_NAMES) {
          expect({ language: language, name: name, quoted: true }).toEqual({
            language: language,
            name: name,
            quoted: names.has(name),
          });
        }
      },
    );

    test("the settings page shows the columns' own titles", () => {
      const model: IncidentCustomField = new IncidentCustomField();

      expect(model.getTableColumnMetadata("sortOrder").title).toBe(
        IncidentCustomFieldSettingsCopy.sortOrderTitle,
      );
      expect(model.getTableColumnMetadata("showOnCreate").title).toBe(
        IncidentCustomFieldSettingsCopy.showOnCreateTitle,
      );
      expect(model.getTableColumnMetadata("isRequiredOnCreate").title).toBe(
        IncidentCustomFieldSettingsCopy.isRequiredOnCreateTitle,
      );
      expect(
        model.getTableColumnMetadata("includeInSubscriberNotifications").title,
      ).toBe(
        IncidentCustomFieldSettingsCopy.includeInSubscriberNotificationsTitle,
      );
    });

    test.each(LANGUAGES)(
      "%s: lists every field type by its picker label on the incident settings page",
      (language: string) => {
        const incidentTypes: Array<string> = tableFirstColumn(
          sectionOf(
            readPage(SETTINGS_PAGE, language),
            language === "en" ? "Field types" : "نوع‌های فیلد",
          ),
        );

        expect(incidentTypes).toEqual(
          Object.values(CUSTOM_FIELD_TYPE_LABELS).map(
            (label: string): string => {
              return `**${label}**`;
            },
          ),
        );
      },
    );

    test("the inventory page lists every field type too", () => {
      const labels: Array<string> = Object.values(CUSTOM_FIELD_TYPE_LABELS);
      const english: Array<string> = tableFirstColumn(
        sectionOf(readPage(INVENTORY_FIELDS_PAGE, "en"), "Defining Fields"),
      );

      expect(english).toEqual(
        labels.map((label: string): string => {
          return `**${label}**`;
        }),
      );

      /*
       * The Persian inventory page names the types in Persian, as the
       * Persian dashboard's picker does; the new types by the picker's own
       * words.
       */
      const persianLabels: Record<string, string> = JSON.parse(
        readSource(path.join(APP_DIR, "Dashboard/src/Locales/fa.json")),
      ) as Record<string, string>;
      const persian: Array<string> = tableFirstColumn(
        sectionOf(readPage(INVENTORY_FIELDS_PAGE, "fa"), "تعریف فیلدها"),
      );

      expect(persian).toHaveLength(labels.length);

      for (const type of [CustomFieldType.LongText, CustomFieldType.Markdown]) {
        expect(persian).toContain(
          `**${persianLabels[CUSTOM_FIELD_TYPE_LABELS[type]]}**`,
        );
      }
    });

    test("makes the Template Variable the way the docs say", () => {
      expect(getCustomFieldVariableKeyBase("Expected Resolution")).toBe(
        "expected_resolution",
      );
      expect(
        generateCustomFieldVariableKey({
          name: "Expected Resolution",
          existingKeys: ["expected_resolution"],
        }),
      ).toBe("expected_resolution_2");
      expect(
        generateCustomFieldVariableKey({
          name: "Expected Resolution",
          existingKeys: ["expected_resolution", "expected_resolution_2"],
        }),
      ).toBe("expected_resolution_3");

      for (const language of LANGUAGES) {
        const code: Set<string> = inlineCode(readPage(SETTINGS_PAGE, language));

        expect(code.has("Expected Resolution")).toBe(true);
        expect(code.has("expected_resolution")).toBe(true);
        expect(code.has("_2")).toBe(true);
        expect(code.has("{{customFields.<key>}}")).toBe(true);
      }

      expect(CUSTOM_FIELD_TEMPLATE_VARIABLE_PREFIX).toBe("customFields.");
    });

    test("says Required on Create is the dashboard's: the server's value check never asks for a value", () => {
      const required: CustomFieldDefinition = definition(
        "Acknowledgement",
        CustomFieldType.Boolean,
      );

      expect(
        validateCustomFieldValues({
          definitions: [required],
          customFields: {},
        }),
      ).toEqual([]);
      expect(
        validateCustomFieldValues({
          definitions: [required],
          customFields: { Acknowledgement: null },
        }),
      ).toEqual([]);

      const headings: Array<string> = headingsOf(
        readPage(SETTINGS_PAGE, "en"),
      ).map((heading: Heading): string => {
        return heading.slug;
      });

      expect(headings).toContain(
        "required-on-create-is-checked-by-the-dashboard-only",
      );
      expect(
        new IncidentCustomField().getTableColumnMetadata("isRequiredOnCreate")
          .description,
      ).toContain("can leave it empty");
    });
  });

  describe("custom field values through the API", () => {
    const DEFINITIONS: Array<CustomFieldDefinition> = [
      definition("Impact", CustomFieldType.Dropdown, "Minor\nMajor"),
      definition("Estimated Duration", CustomFieldType.Number),
      definition("Acknowledgement", CustomFieldType.Boolean),
      definition("Expected Resolution", CustomFieldType.DateTime),
      definition(
        "Affected Systems",
        CustomFieldType.MultiSelectDropdown,
        "Network\nPower",
      ),
      definition("Additional Information", CustomFieldType.LongText),
    ];

    test.each(LANGUAGES)(
      "%s: the example body passes the value check",
      (language: string) => {
        const section: string = sectionOf(
          readPage(SETTINGS_PAGE, language),
          API_SUBSECTION[language] as string,
        );
        const blocks: Array<string> = splitMarkdown(section).codeBlocks;

        expect(blocks).toHaveLength(1);

        const body: JSONObject = JSON.parse(blocks[0] as string) as JSONObject;

        expect(
          validateCustomFieldValues({
            definitions: DEFINITIONS,
            customFields: body["customFields"],
          }),
        ).toEqual([]);
      },
    );

    test("the English and Persian examples are the same request", () => {
      expect(
        splitMarkdown(
          sectionOf(
            readPage(SETTINGS_PAGE, "fa"),
            API_SUBSECTION["fa"] as string,
          ),
        ).codeBlocks,
      ).toEqual(
        splitMarkdown(
          sectionOf(
            readPage(SETTINGS_PAGE, "en"),
            API_SUBSECTION["en"] as string,
          ),
        ).codeBlocks,
      );
    });

    test("accepts what the table says each type accepts", () => {
      expect(
        validateCustomFieldValues({
          definitions: DEFINITIONS,
          customFields: {
            "Estimated Duration": "42",
            Acknowledgement: "true",
            "Affected Systems": "Network",
            "Additional Information": 7,
          },
        }),
      ).toEqual([]);
    });

    test("refuses a value that does not fit, naming the field and the value", () => {
      const errors: Array<CustomFieldValueValidationError> =
        validateCustomFieldValues({
          definitions: DEFINITIONS,
          customFields: {
            Impact: "Catastrophic",
            "Estimated Duration": "ninety",
          },
        });

      expect(
        errors.map((error: CustomFieldValueValidationError): string => {
          return error.fieldName;
        }),
      ).toEqual(["Impact", "Estimated Duration"]);
      expect(errors[0]?.message).toContain('"Catastrophic"');
      expect(errors[1]?.message).toContain('"ninety"');
    });

    test("does not check what the docs say it leaves alone", () => {
      // A value the request leaves as it was: an option since removed.
      expect(
        validateCustomFieldValues({
          definitions: DEFINITIONS,
          customFields: { Impact: "Severe" },
          storedCustomFields: { Impact: "Severe" },
        }),
      ).toEqual([]);
      // A key that is no field's name, such as the Jira integration's.
      expect(
        validateCustomFieldValues({
          definitions: DEFINITIONS,
          customFields: { jiraIssueKey: { any: "shape" } },
        }),
      ).toEqual([]);
      // Empty values clear a field.
      expect(
        validateCustomFieldValues({
          definitions: DEFINITIONS,
          customFields: { Impact: null, "Estimated Duration": "" },
        }),
      ).toEqual([]);
      // A multi-select keeps the entries it already had.
      expect(
        validateCustomFieldValues({
          definitions: DEFINITIONS,
          customFields: { "Affected Systems": ["Cooling", "Power"] },
          storedCustomFields: { "Affected Systems": ["Cooling"] },
        }),
      ).toEqual([]);
    });

    test.each(LANGUAGES)(
      "%s: the declare page points API users at the value check",
      (language: string) => {
        const declaring: string = readPage(DECLARING_PAGE, language);
        const anchor: string = slugify(API_SUBSECTION[language] as string);

        expect(declaring).toContain(`](/docs/${SETTINGS_PAGE}#${anchor})`);
        expect(inlineCode(declaring).has("customFields")).toBe(true);
      },
    );
  });

  describe("renaming a field", () => {
    test("the service moves values in incidents and incident templates, and refuses the renames the docs say it does", () => {
      const service: string = readSource(
        path.join(COMMON_DIR, "Server/Services/IncidentCustomFieldService.ts"),
      );

      expect(service).toMatch(
        /valueServices:\s*\[IncidentService,\s*IncidentTemplateService\]/,
      );
      expect(service).toContain("can only be renamed one at a time");
      expect(service).toContain(
        "Another incident custom field already has this name",
      );
      // The incidents list is the table whose saved views a rename rewrites.
      expect(INCIDENT_CUSTOM_FIELD_TABLE_VIEW_IDS).toEqual([
        "all-incidents-table",
      ]);
    });

    test.each(LANGUAGES)(
      "%s: the inventory page sends readers to the incident exception",
      (language: string) => {
        const settingsHeadings: Array<string> = headingsOf(
          readPage(SETTINGS_PAGE, language),
        ).map((heading: Heading): string => {
          return heading.slug;
        });
        const link: RegExpMatchArray | null = readPage(
          INVENTORY_FIELDS_PAGE,
          language,
        ).match(/\]\(\/docs\/incidents\/settings#([^)\s]+)\)/);

        expect(link).not.toBeNull();
        expect(settingsHeadings).toContain((link as RegExpMatchArray)[1]);
      },
    );
  });

  describe("Terraform", () => {
    const COLUMNS: ReadonlyArray<string> = [
      "sortOrder",
      "showOnCreate",
      "isRequiredOnCreate",
      "includeInSubscriberNotifications",
      "variableKey",
    ];

    test.each(LANGUAGES)(
      "%s: names each attribute as the provider spells the column",
      (language: string) => {
        const code: Set<string> = inlineCode(readPage(SETTINGS_PAGE, language));
        const columns: Array<string> =
          new IncidentCustomField().getTableColumns().columns;

        expect(code.has("oneuptime_incident_custom_field")).toBe(true);

        for (const column of COLUMNS) {
          expect(columns).toContain(column);
          expect({ column: column, documented: true }).toEqual({
            column: column,
            documented: code.has(terraformName(column)),
          });
        }
      },
    );

    test("the provider end-to-end fixture sets the settings and reads the key the generator makes", () => {
      const main: string = readSource(
        path.join(TERRAFORM_FIXTURE_DIR, "main.tf"),
      );
      const update: string = readSource(
        path.join(TERRAFORM_FIXTURE_DIR, "update.tf"),
      );
      const verify: string = readSource(
        path.join(TERRAFORM_FIXTURE_DIR, "verify.sh"),
      );
      const verifyUpdate: string = readSource(
        path.join(TERRAFORM_FIXTURE_DIR, "verify-update.sh"),
      );

      for (const column of COLUMNS.filter((column: string): boolean => {
        return column !== "variableKey";
      })) {
        expect(main).toMatch(
          new RegExp(`\\n\\s*${terraformName(column)}\\s*=`),
        );
        expect(update).toMatch(
          new RegExp(`\\n\\s*${terraformName(column)}\\s*=`),
        );
      }

      expect(main).toContain(
        "oneuptime_incident_custom_field.incident_field.variable_key",
      );

      const expectedKey: string = getCustomFieldVariableKeyBase(
        "terraform-e2e-incident-field",
      );

      expect(verify).toContain(`"variableKey" "${expectedKey}"`);
      // The key survives the rename in update.tf.
      expect(update).toContain(
        'name              = "terraform-e2e-incident-field-renamed"',
      );
      expect(verifyUpdate).toContain(`"variableKey" "${expectedKey}"`);
    });
  });

  describe("note template placeholders", () => {
    test.each(LANGUAGES)(
      "%s: lists exactly the placeholders a note template is filled with",
      (language: string) => {
        const listed: Array<string> = tableFirstColumn(
          sectionOf(
            readPage(SETTINGS_PAGE, language),
            NOTE_TEMPLATES_SECTION[language] as string,
          ),
        );

        expect(listed).toEqual(
          INCIDENT_NOTE_TEMPLATE_VARIABLES.map(
            (variable: IncidentNoteTemplateVariableInfo): string => {
              return `\`{{${variable.name}}}\``;
            },
          ),
        );
        // The custom fields are there, by their prefix.
        expect(listed).toContain(
          `\`{{${INCIDENT_NOTE_CUSTOM_FIELD_VARIABLE_PREFIX}<key>}}\``,
        );
      },
    );

    test.each(LANGUAGES)(
      "%s: the notes page and the guide warn that the affected status pages reach every audience",
      (language: string) => {
        for (const page of [NOTES_PAGE, GUIDE_PAGE]) {
          expect(
            inlineCode(readPage(page, language)).has(
              "{{incident.affectedStatusPages}}",
            ),
          ).toBe(true);
        }
      },
    );
  });

  describe("subscriber notification templates", () => {
    const INCIDENT_EVENT_TYPES: Array<StatusPageSubscriberNotificationEventType> =
      Object.values(StatusPageSubscriberNotificationEventType).filter(
        (eventType: StatusPageSubscriberNotificationEventType): boolean => {
          return (
            SubscriberNotificationTemplateVariables.getDynamicVariablesForEventType(
              eventType,
            ).length > 0
          );
        },
      );

    test("there are incident event types to document", () => {
      expect(INCIDENT_EVENT_TYPES).toHaveLength(5);
    });

    test.each(LANGUAGES)(
      "%s: names exactly the event types that offer the incident variables",
      (language: string) => {
        const section: string = sectionOf(
          readPage(SUBSCRIBERS_PAGE, language),
          INCIDENT_VARIABLES_SUBSECTION[language] as string,
        );
        const named: Array<string> = Array.from(boldText(section)).filter(
          (name: string): boolean => {
            return name.startsWith("Subscriber ");
          },
        );

        expect(named.sort()).toEqual([...INCIDENT_EVENT_TYPES].sort());
      },
    );

    test.each(LANGUAGES)(
      "%s: lists the variables those event types offer on top of the others",
      (language: string) => {
        const listed: Array<string> = tableFirstColumn(
          sectionOf(
            readPage(SUBSCRIBERS_PAGE, language),
            INCIDENT_VARIABLES_SUBSECTION[language] as string,
          ),
        );

        expect(listed).toEqual([
          "`{{incidentLabels}}`",
          "`{{affectedStatusPages}}`",
          `\`{{${CUSTOM_FIELD_TEMPLATE_VARIABLE_PREFIX}<key>}}\``,
        ]);

        for (const eventType of INCIDENT_EVENT_TYPES) {
          expect(
            SubscriberNotificationTemplateVariables.isVariableOffered(
              eventType,
              "incidentLabels",
            ),
          ).toBe(true);
          expect(
            SubscriberNotificationTemplateVariables.isVariableOffered(
              eventType,
              "affectedStatusPages",
            ),
          ).toBe(true);
          expect(
            SubscriberNotificationTemplateVariables.isVariableOffered(
              eventType,
              `${CUSTOM_FIELD_TEMPLATE_VARIABLE_PREFIX}expected_resolution`,
            ),
          ).toBe(true);
        }

        // Not offered outside the incident events.
        expect(
          SubscriberNotificationTemplateVariables.isVariableOffered(
            StatusPageSubscriberNotificationEventType.SubscriberAnnouncementCreated,
            "affectedStatusPages",
          ),
        ).toBe(false);
      },
    );

    /*
     * The roles the docs name as able to place labels and custom fields are
     * exactly the ones the save check lets through, read from the models;
     * the status page roles it names are ones it refuses.
     */
    test.each(LANGUAGES)(
      "%s: names who may place labels and custom fields, as the save check reads the models",
      (language: string) => {
        const named: Set<string> = boldText(
          sectionOf(
            readPage(SUBSCRIBERS_PAGE, language),
            INCIDENT_VARIABLES_SUBSECTION[language] as string,
          ),
        );
        const requirements: Array<Array<Permission>> =
          SubscriberTemplateIncidentRecordAccess.getRequirements([
            `${CUSTOM_FIELD_TEMPLATE_VARIABLE_PREFIX}root_cause`,
            "incidentLabels",
          ]).map((requirement: { permissions: Array<Permission> }) => {
            return requirement.permissions;
          });
        const allowedRoles: Array<Permission> = [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.Viewer,
          Permission.IncidentAdmin,
          Permission.IncidentMember,
          Permission.IncidentViewer,
        ];

        for (const role of allowedRoles) {
          expect(named.has(PermissionHelper.getTitle(role))).toBe(true);

          for (const permissions of requirements) {
            expect(permissions).toContain(role);
          }
        }

        for (const role of [
          Permission.StatusPageAdmin,
          Permission.StatusPageMember,
        ]) {
          expect(named.has(PermissionHelper.getTitle(role))).toBe(true);
          expect(
            requirements.every((permissions: Array<Permission>) => {
              return permissions.includes(role);
            }),
          ).toBe(false);
        }
      },
    );

    test("the template service runs the save check on create and update", () => {
      const service: string = readSource(
        path.join(
          COMMON_DIR,
          "Server/Services/StatusPageSubscriberNotificationTemplateService.ts",
        ),
      );

      expect(
        service.match(
          /SubscriberTemplateIncidentRecordAccess\.assertCanPlace/g,
        ),
      ).toHaveLength(2);
    });

    test.each(LANGUAGES)(
      "%s: states the plan each piece needs, as the models gate it",
      (language: string) => {
        const needs: Set<string> = boldText(
          sectionOf(
            readPage(SUBSCRIBERS_PAGE, language),
            WHAT_A_TEMPLATE_NEEDS_SUBSECTION[language] as string,
          ),
        );

        expect(needs.has(PlanType.Scale)).toBe(true);
        expect(needs.has(PlanType.Growth)).toBe(true);
        expect(
          boldText(readPage(DECLARING_PAGE, language)).has(PlanType.Growth),
        ).toBe(true);
      },
    );

    test("the models gate templates on Scale, and custom SMTP, Twilio and custom fields on Growth", () => {
      expect(
        new StatusPageSubscriberNotificationTemplate().getCreateBillingPlan(),
      ).toBe(PlanType.Scale);
      expect(
        new StatusPageSubscriberNotificationTemplateStatusPage().getCreateBillingPlan(),
      ).toBe(PlanType.Scale);
      expect(new ProjectSmtpConfig().getCreateBillingPlan()).toBe(
        PlanType.Growth,
      );
      expect(new ProjectCallSMSConfig().getCreateBillingPlan()).toBe(
        PlanType.Growth,
      );
      expect(new IncidentCustomField().getReadBillingPlan()).toBe(
        PlanType.Growth,
      );
    });

    test.each(INCIDENT_WORKERS)(
      "%s uses a custom email template only with custom SMTP, SMS only with Twilio, Slack and Teams always",
      (worker: string) => {
        const source: string = readSource(path.join(APP_DIR, worker));

        expect(source).toMatch(
          /emailTemplate\?\.templateBody && statuspage\.smtpConfig/,
        );
        expect(source).toMatch(
          /smsTemplate\?\.templateBody && statuspage\.callSmsConfig/,
        );
        expect(source).toMatch(/if \(slackTemplate\?\.templateBody\)/);
        expect(source).toMatch(/if \(teamsTemplate\?\.templateBody\)/);
        // Webhooks carry the included fields under data.customFields.
        expect(source).toMatch(
          /customFields:\s*incidentTemplateVariables\.getWebhookCustomFields\(\)/,
        );
      },
    );

    test("no worker reads a webhook template, so the docs say webhooks get the standard payload", () => {
      const jobsDir: string = path.join(APP_DIR, "Workers/Jobs");
      const offenders: Array<string> = [];

      for (const directory of fs.readdirSync(jobsDir)) {
        const full: string = path.join(jobsDir, directory);

        if (!fs.statSync(full).isDirectory()) {
          continue;
        }

        for (const file of fs.readdirSync(full)) {
          const source: string = readSource(path.join(full, file));

          if (WEBHOOK_TEMPLATE_LOOKUP.test(source)) {
            offenders.push(`${directory}/${file}`);
          }
        }
      }

      expect(offenders).toEqual([]);

      for (const language of LANGUAGES) {
        expect(
          sectionOf(
            readPage(SUBSCRIBERS_PAGE, language),
            WHAT_A_TEMPLATE_NEEDS_SUBSECTION[language] as string,
          ),
        ).toContain("JSON");
      }
    });

    test.each(LANGUAGES)(
      "%s: quotes the dashboard's warning for a page without custom SMTP or Twilio",
      (language: string) => {
        const source: string = readSource(
          path.join(
            APP_DIR,
            "Dashboard/src/Pages/StatusPages/View/SubscriberSettings.tsx",
          ),
        );

        expect(source).toContain(
          'strongTitle="Custom Templates Require Configuration"',
        );
        expect(
          boldText(readPage(SUBSCRIBERS_PAGE, language)).has(
            "Custom Templates Require Configuration",
          ),
        ).toBe(true);
      },
    );

    test("the Persian section keeps the English one's code and structure", () => {
      const english: string = sectionOf(
        readPage(SUBSCRIBERS_PAGE, "en"),
        TEMPLATES_SECTION["en"] as string,
      );
      const persian: string = sectionOf(
        readPage(SUBSCRIBERS_PAGE, "fa"),
        TEMPLATES_SECTION["fa"] as string,
      );

      expect(Array.from(inlineCode(persian)).sort()).toEqual(
        Array.from(inlineCode(english)).sort(),
      );
      expect(
        headingsOf(persian).map((heading: Heading): number => {
          return heading.level;
        }),
      ).toEqual(
        headingsOf(english).map((heading: Heading): number => {
          return heading.level;
        }),
      );
    });
  });

  describe("the incident feed", () => {
    test("names the feed's custom field list as the send writes it, on every page that mentions it", () => {
      const builder: string = readSource(
        path.join(
          COMMON_DIR,
          "Server/Utils/StatusPage/IncidentTemplateVariableBuilder.ts",
        ),
      );

      expect(builder).toContain('"**Custom fields sent:**"');

      for (const language of LANGUAGES) {
        for (const page of [SUBSCRIBERS_PAGE, GUIDE_PAGE, NOTES_PAGE]) {
          expect({
            language: language,
            page: page,
            quoted: boldText(readPage(page, language)).has(
              "Custom fields sent",
            ),
          }).toEqual({ language: language, page: page, quoted: true });
        }
      }
    });
  });

  describe("the Persian custom fields section", () => {
    test("keeps the English one's code, code blocks and structure", () => {
      const english: string = sectionOf(
        readPage(SETTINGS_PAGE, "en"),
        CUSTOM_FIELDS_SECTION["en"] as string,
      );
      const persian: string = sectionOf(
        readPage(SETTINGS_PAGE, "fa"),
        CUSTOM_FIELDS_SECTION["fa"] as string,
      );

      expect(Array.from(inlineCode(persian)).sort()).toEqual(
        Array.from(inlineCode(english)).sort(),
      );
      expect(splitMarkdown(persian).codeBlocks).toEqual(
        splitMarkdown(english).codeBlocks,
      );
      expect(
        headingsOf(persian).map((heading: Heading): number => {
          return heading.level;
        }),
      ).toEqual(
        headingsOf(english).map((heading: Heading): number => {
          return heading.level;
        }),
      );
    });

    test("quotes only on-screen names the English section quotes too", () => {
      const english: Set<string> = boldText(
        sectionOf(
          readPage(SETTINGS_PAGE, "en"),
          CUSTOM_FIELDS_SECTION["en"] as string,
        ),
      );
      const untranslated: Array<string> = Array.from(
        boldText(
          sectionOf(
            readPage(SETTINGS_PAGE, "fa"),
            CUSTOM_FIELDS_SECTION["fa"] as string,
          ),
        ),
      ).filter((name: string): boolean => {
        return !PERSIAN_LETTER.test(name);
      });

      expect(untranslated.length).toBeGreaterThan(10);

      for (const name of untranslated) {
        expect({ name: name, inEnglish: true }).toEqual({
          name: name,
          inEnglish: english.has(name),
        });
      }
    });
  });

  describe("links", () => {
    test.each(LANGUAGES)(
      "%s: every link to a section of another docs page points at a heading it has",
      (language: string) => {
        for (const page of PAGES) {
          const markdown: string = readPage(page, language);

          for (const match of markdown.matchAll(
            /\]\(\/docs\/([^)#\s]+)#([^)\s]+)\)/g,
          )) {
            const target: string = match[1] as string;
            const anchor: string = match[2] as string;
            // A page that is not translated is served in English.
            const targetLanguage: string = pageExists(target, language)
              ? language
              : "en";
            const slugs: Array<string> = headingsOf(
              readPage(target, targetLanguage),
            ).map((heading: Heading): string => {
              return heading.slug;
            });

            expect({
              language: language,
              page: page,
              link: `${target}#${anchor}`,
              found: true,
            }).toEqual({
              language: language,
              page: page,
              link: `${target}#${anchor}`,
              found: slugs.includes(anchor),
            });
          }
        }
      },
    );
  });
});
