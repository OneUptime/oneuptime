import {
  SyncResultSummary,
  buildSyncResultSummary,
} from "../../../FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorTemplateSyncResultUtil";
import { readPage } from "./DocsContentSupport";
import MonitorTemplate from "Common/Models/DatabaseModels/MonitorTemplate";
import MonitorTemplateSyncFieldUtil, {
  MonitorTemplateSyncField,
} from "Common/Types/Monitor/MonitorTemplateSyncField";
import MonitorType, {
  MonitorTypeCategory,
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import { PermissionHelper } from "Common/Types/Permission";
import { MORE_FIELDS_SECTION_TITLE } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the English Monitor Templates page says about the product, held to the
 * code that makes it true.
 *
 * Markdown is not compiled, so nothing else notices when a card or a button
 * of the template's page is renamed, a sync button starts or stops copying a
 * field, a monitor type gains or loses a field that can be kept out of a
 * sync, or the permission to create or change a template moves. Each test
 * reads the source of truth - the template list and page, the sync field
 * catalog, the sync service and its API, the MonitorTemplate model - and
 * checks the page still says what it does. The translations are held to this
 * English page by ProbeMonitorDocsTranslations.
 */

const PAGE: string = "monitor/monitor-templates";

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const SETTINGS_DIR: string = "App/FeatureSet/Dashboard/src/Pages/Monitor";

const SIDE_MENU_FILE: string = `${SETTINGS_DIR}/SideMenu.tsx`;
const LIST_FILE: string = `${SETTINGS_DIR}/Settings/MonitorTemplates.tsx`;
const VIEW_FILE: string = `${SETTINGS_DIR}/Settings/MonitorTemplatesView.tsx`;
const RESULT_FILE: string = `${SETTINGS_DIR}/Settings/MonitorTemplateSyncResultUtil.ts`;
const SYNC_FIELDS_FORM_FILE: string =
  "App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorTemplateSyncFields.tsx";
const SERVICE_FILE: string = "Common/Server/Services/MonitorTemplateService.ts";
const API_FILE: string = "Common/Server/API/MonitorTemplateAPI.ts";
const SYNC_UTIL_FILE: string =
  "Common/Utils/Monitor/MonitorTemplateSyncUtil.ts";
const MODEL_TABLE_FILE: string =
  "Common/UI/Components/ModelTable/BaseModelTable.tsx";

// The template page's cards, in the order the page shows them.
const CARD_TITLES: Array<string> = [
  "Template Info",
  "Monitor Defaults",
  "Monitoring Criteria",
  "Monitoring Interval",
  "Labels",
  "Custom Field Defaults",
  "Linked Monitors",
];

/*
 * The sync buttons, with the request handler each one's confirmation submits
 * and the words the page uses for every field a sync can copy.
 */
const SYNC_BUTTONS: Array<{ title: string; handler: string }> = [
  {
    title: "Sync Criteria to Linked Monitors",
    handler: "onSyncCriteriaSubmit",
  },
  {
    title: "Sync Interval to Linked Monitors",
    handler: "onSyncIntervalSubmit",
  },
  { title: "Sync Labels to Linked Monitors", handler: "onSyncLabelsSubmit" },
  {
    title: "Sync Custom Fields to Linked Monitors",
    handler: "onSyncCustomFieldsSubmit",
  },
];

const FIELD_WORDS: Record<string, string> = {
  monitorSteps: "criteria",
  monitoringInterval: "monitoring interval",
  minimumProbeAgreement: "minimum probe agreement",
  labels: "labels",
  customFields: "custom field",
};

const BOLD_SPAN: RegExp = /\*\*([^*\n]+?)\*\*/g;
const CODE_SPAN: RegExp = /`([^`\n]+)`/g;
const HEADING_LINE: RegExp = /^(#{1,6})\s/;
const FENCE_LINE: RegExp = /^\s*```/;
const QUOTED: RegExp = /"([^"]+)"/g;
const JSON_FENCE: RegExp = /```json[^\n]*\n([\s\S]*?)\n```/;
const TYPE_LIST_SEPARATOR: RegExp = /, | and /;
const ONLY_SUFFIX: RegExp = / only$/;
const INFRASTRUCTURE_LIST: RegExp = /^Infrastructure monitors \(([^)]+)\)/m;
const STEP_TITLES: RegExp = /title: "([^"]+)",\s*id: "([^"]+)"/g;

const page: string = readPage("en", PAGE);

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relativePath), "utf8");
}

/*
 * The body of one heading's section, up to the next heading of the same or
 * a higher level. A `#` line inside a code block is not a heading.
 */
function section(markdown: string, heading: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.findIndex((line: string): boolean => {
    return line.trim() === heading;
  });

  expect({ heading, found: start >= 0 }).toEqual({ heading, found: true });

  const level: number = heading.indexOf(" ");
  const body: Array<string> = [];
  let inFence: boolean = false;

  for (const line of lines.slice(start + 1)) {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
    }

    const match: RegExpMatchArray | null = inFence
      ? null
      : line.match(HEADING_LINE);

    if (match && (match[1] as string).length <= level) {
      break;
    }

    body.push(line);
  }

  return body.join("\n");
}

// The body rows of the first table in a text, as arrays of trimmed cells.
function tableRows(text: string): Array<Array<string>> {
  const lines: Array<string> = text.split("\n");
  const start: number = lines.findIndex((line: string): boolean => {
    return line.trim().startsWith("|");
  });

  expect(start).toBeGreaterThanOrEqual(0);

  const rows: Array<Array<string>> = [];

  for (const line of lines.slice(start + 2)) {
    if (!line.trim().startsWith("|")) {
      break;
    }

    rows.push(
      line
        .trim()
        .slice(1, -1)
        .split("|")
        .map((cell: string): string => {
          return cell.trim();
        }),
    );
  }

  return rows;
}

function boldItems(text: string): Array<string> {
  return Array.from(text.matchAll(BOLD_SPAN)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

function codeItems(text: string): Array<string> {
  return Array.from(text.matchAll(CODE_SPAN)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

// The paragraph of the page that starts with these words.
function paragraphStarting(markdown: string, start: string): string {
  const paragraph: string | undefined = markdown
    .split("\n")
    .find((line: string): boolean => {
      return line.startsWith(start);
    });

  expect({ start, found: Boolean(paragraph) }).toEqual({ start, found: true });

  return paragraph as string;
}

/*
 * The source between `start` and the first `end` after it - the body of a
 * function, from its name to the next declaration.
 */
function sourceBetween(source: string, start: string, end: string): string {
  const from: number = source.indexOf(start);

  expect({ start, found: from >= 0 }).toEqual({ start, found: true });

  const to: number = source.indexOf(end, from + start.length);

  return source.slice(from, to < 0 ? undefined : to);
}

// The strings of an array literal: `fields: ["a", "b"]` -> ["a", "b"].
function quotedStrings(text: string): Array<string> {
  return Array.from(text.matchAll(QUOTED)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

// The fields a constant of the sync service lists.
function serviceFieldList(name: string): Array<string> {
  return quotedStrings(
    sourceBetween(
      readRepoFile(SERVICE_FILE),
      `const ${name}: ReadonlyArray<SyncableTemplateField> = [`,
      "];",
    ).replace(`const ${name}`, ""),
  );
}

// Positions of `needles` in `haystack`, each after the one before it.
function inOrder(haystack: string, needles: Array<string>): boolean {
  let from: number = 0;

  for (const needle of needles) {
    const at: number = haystack.indexOf(needle, from);

    if (at < 0) {
      return false;
    }

    from = at + needle.length;
  }

  return true;
}

// Every monitor type the type picker offers, from its categories.
const OFFERED_TYPES: Array<MonitorType> =
  MonitorTypeHelper.getMonitorTypeCategories().flatMap(
    (category: MonitorTypeCategory): Array<MonitorType> => {
      return category.monitorTypes;
    },
  );

// The monitor type a page calls by this name, as the picker titles it.
function typeTitled(title: string): MonitorType | undefined {
  return OFFERED_TYPES.find((type: MonitorType): boolean => {
    return MonitorTypeHelper.getTitle(type) === title;
  });
}

function fieldPaths(type: MonitorType): Array<string> {
  return MonitorTemplateSyncFieldUtil.getFields(type).map(
    (field: MonitorTemplateSyncField): string => {
      return field.path;
    },
  );
}

describe("where the Monitor Templates page sends the reader", () => {
  it("goes to Templates under the Monitors menu's Settings", () => {
    const menu: string = readRepoFile(SIDE_MENU_FILE);

    expect(
      inOrder(menu, [
        'title: "Settings"',
        'title: "Templates"',
        "PageMap.MONITORS_SETTINGS_TEMPLATES",
      ]),
    ).toBe(true);
    expect(section(page, "### Open Templates")).toContain(
      "Go to **Monitors → Settings → Templates** and click **Create Monitor Template**.",
    );
  });

  it("names the list's create button as the table builds it from the model", () => {
    const list: string = readRepoFile(LIST_FILE);

    expect(new MonitorTemplate().singularName).toBe("Monitor Template");
    expect(readRepoFile(MODEL_TABLE_FILE)).toContain(
      'Create: translationKey("Create {{itemName}}")',
    );
    // Nothing on the list renames it.
    expect(list).not.toContain("singularName=");
    expect(list).not.toContain("createVerb=");
    expect(page).toContain("**Create Monitor Template**");
  });
});

describe("the Create Monitor Template form", () => {
  const list: string = readRepoFile(LIST_FILE);

  it("walks the form's steps, in its order", () => {
    const steps: Array<string> = Array.from(
      sourceBetween(list, "formSteps={[", "]}").matchAll(STEP_TITLES),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });
    const create: string = section(page, "## Create a template");

    expect(steps).toEqual([
      "Template Info",
      "Monitor Defaults",
      "Criteria",
      "Interval",
    ]);
    expect(
      inOrder(
        create,
        steps
          .map((title: string): string => {
            return `On **${title}**`;
          })
          .slice(0, 3),
      ),
    ).toBe(true);
    expect(create).toContain(
      "the last step, **Interval**, asks for the **Monitoring Interval**",
    );
  });

  it("asks for the interval only for a type that probes check", () => {
    const interval: string = sourceBetween(list, 'title: "Interval",', "},");

    expect(interval).toContain(
      "MonitorTypeHelper.doesMonitorTypeHaveInterval(",
    );

    for (const type of Object.values(MonitorType)) {
      expect({
        type,
        interval: MonitorTypeHelper.doesMonitorTypeHaveInterval(type),
      }).toEqual({ type, interval: MonitorTypeHelper.isProbableMonitor(type) });
    }

    expect(section(page, "## Create a template")).toContain(
      "For a monitor type that probes check, the last step, **Interval**",
    );
  });

  it("asks for each field on the step the page names", () => {
    const placements: Array<[string, string]> = [
      ['title: "Template Name"', 'stepId: "template-info"'],
      ['title: "Template Description"', 'stepId: "template-info"'],
      ['title: "Default Monitor Name"', 'stepId: "monitor-defaults"'],
      ['title: "Default Monitor Description"', 'stepId: "monitor-defaults"'],
      ['stepId: "monitoring-interval"', 'title: "Monitoring Interval"'],
    ];

    for (const [first, second] of placements) {
      expect({
        first,
        second,
        together: inOrder(list, [first, second]),
      }).toEqual({ first, second, together: true });
    }

    expect(list).toContain(
      'getMonitorTypeFormField<MonitorTemplate>({\n            stepId: "monitor-defaults",',
    );
    expect(list).toContain(
      'getLabelsFormField<MonitorTemplate>({\n            stepId: "monitor-defaults",',
    );

    const create: string = section(page, "## Create a template");

    expect(create).toContain(
      "On **Template Info**, enter a **Template Name**, such as `Production API Health`, and a **Template Description**",
    );
    expect(create).toContain(
      "On **Monitor Defaults**, pick the **Monitor Type**",
    );
  });

  it("folds the default description and the labels under More fields", () => {
    const description: string = sourceBetween(
      list,
      'title: "Default Monitor Description"',
      "},",
    );
    const labels: string = sourceBetween(
      list,
      "getLabelsFormField<MonitorTemplate>({",
      "}),",
    );

    expect(list).toContain(
      "const MONITOR_DEFAULTS_MORE_FIELDS: FormFieldCollapsibleSection<MonitorTemplate> =\n  getAdvancedFormSection<MonitorTemplate>();",
    );
    expect(description).toContain(
      "collapsibleSection: MONITOR_DEFAULTS_MORE_FIELDS",
    );
    expect(labels).toContain(
      "collapsibleSection: MONITOR_DEFAULTS_MORE_FIELDS",
    );
    expect(section(page, "## Create a template")).toContain(
      `**Default Monitor Description** and **Labels** wait under **${MORE_FIELDS_SECTION_TITLE}**.`,
    );
  });

  it("names a monitor after what it watches while the default name is blank", () => {
    const name: string = sourceBetween(
      list,
      'title: "Default Monitor Name"',
      "},",
    );

    expect(name).toContain("required: false");
    expect(name).toContain(
      "Leave it blank to name each monitor after the resource it watches.",
    );
    expect(section(page, "## Create a template")).toContain(
      "left blank, each monitor is named after the resource it watches",
    );
  });

  it("gives the template name the form's own example", () => {
    expect(list).toContain('placeholder: "Production API Health"');
    expect(codeItems(page)).toContain("Production API Health");
  });

  it("puts Template sync settings, and Do not sync this field, on the Criteria step", () => {
    const form: string = readRepoFile(SYNC_FIELDS_FORM_FILE);

    expect(form).toContain('<Card title="Template sync settings">');
    expect(form).toContain(
      'translator.translateText("Do not sync this field")',
    );
    expect(section(page, "## Create a template")).toContain(
      "The **Template sync settings** card at the top lets you protect fields from syncs",
    );
    expect(section(page, "## Keep values specific to each monitor")).toContain(
      "In **Template sync settings**, check **Do not sync this field**",
    );
  });
});

describe("the template's page", () => {
  const view: string = readRepoFile(VIEW_FILE);

  it("shows the cards the page lists, in its order", () => {
    const sources: Array<string> = [
      'name="Template Info"',
      'name="Monitor Defaults"',
      'name="Monitoring Criteria"',
      'name="Monitoring Interval"',
      'name="Labels"',
      'title="Custom Field Defaults"',
      "title={linkedMonitorsTitle}",
    ];
    const sentence: string = paragraphStarting(
      page,
      "The template is added to the list.",
    );

    expect(inOrder(view, sources)).toBe(true);
    expect(view).toContain('? "Linked Monitors"');
    expect(
      boldItems(sentence).filter((label: string): boolean => {
        return CARD_TITLES.includes(label);
      }),
    ).toEqual(CARD_TITLES);
  });

  it("shows Minimum Probe Agreement on the interval card", () => {
    const intervalCard: string = sourceBetween(
      view,
      'name="Monitoring Interval"',
      'name="Labels"',
    );

    expect(intervalCard).toContain('title: "Minimum Probe Agreement"');
    expect(page).toContain(
      "**Monitoring Interval** (with **Minimum Probe Agreement**)",
    );
  });

  it("hides Custom Field Defaults in a project without monitor custom fields", () => {
    expect(
      sourceBetween(view, 'title="Custom Field Defaults"', "/>"),
    ).toContain("hideIfEmpty={true}");
    expect(page).toContain(
      "**Custom Field Defaults** (when the project has monitor custom fields)",
    );
  });

  it("edits each part on its own card, with the buttons the page names", () => {
    const edits: Array<[string, string, string]> = [
      [
        'name="Monitor Defaults"',
        'name="Monitoring Criteria"',
        "Edit Monitor Defaults",
      ],
      [
        'name="Monitoring Criteria"',
        'name="Monitoring Interval"',
        "Edit Criteria",
      ],
      ['name="Monitoring Interval"', 'name="Labels"', "Edit Interval"],
    ];

    for (const [card, next, button] of edits) {
      expect({
        button,
        onCard: sourceBetween(view, card, next).includes(
          `editButtonText="${button}"`,
        ),
      }).toEqual({ button, onCard: true });
      expect(page).toContain(`**${button}**`);
    }
  });

  it("creates a monitor from the list's row and from the template's page", () => {
    const list: string = readRepoFile(LIST_FILE);
    const fromPage: string = sourceBetween(
      view,
      'title: "Create Monitor from Template"',
      "},\n          },",
    );

    expect(sourceBetween(list, "actionButtons={[", "]}")).toContain(
      'title: "Create Monitor"',
    );
    expect(list).toContain("monitorTemplateId: item._id?.toString()");
    expect(fromPage).toContain("RouteMap[PageMap.MONITOR_CREATE]");
    expect(fromPage).toContain("monitorTemplateId: modelId.toString()");
    expect(section(page, "## Create monitors from a template")).toContain(
      "Click **Create Monitor** on the template's row in the list, or **Create Monitor from Template** on its page.",
    );
  });

  it("links, syncs and unlinks monitors from the Linked Monitors table", () => {
    for (const title of [
      "Link Existing Monitors",
      "Sync from Template",
      "Unlink from Template",
    ]) {
      expect({ title, inView: view.includes(`title: "${title}"`) }).toEqual({
        title,
        inView: true,
      });
      expect(page).toContain(`**${title}**`);
    }

    // Unlinking leaves the monitor's settings as they are.
    expect(view).toContain(
      "The monitor keeps its current criteria, interval, and other settings",
    );
    expect(page).toContain(
      "**Unlink from Template** disconnects a monitor; it keeps its settings.",
    );
  });
});

describe("what each sync copies", () => {
  const view: string = readRepoFile(VIEW_FILE);
  const syncable: Array<string> = serviceFieldList("SYNCABLE_FIELDS");
  const rows: Array<Array<string>> = tableRows(
    section(page, "## Sync changes to linked monitors"),
  );

  it("the service can copy exactly the fields the page talks about", () => {
    expect([...syncable].sort()).toEqual(Object.keys(FIELD_WORDS).sort());

    // Never a monitor's own name, description or type.
    for (const own of ["name", "description", "monitorType"]) {
      expect(syncable).not.toContain(own);
    }
  });

  it("documents every sync button of the template's page, once", () => {
    expect(
      rows.map((row: Array<string>): string => {
        return boldItems(row[0]!)[0]!;
      }),
    ).toEqual(
      SYNC_BUTTONS.map((button: { title: string }): string => {
        return button.title;
      }),
    );
  });

  it.each(SYNC_BUTTONS)(
    "$title copies what the page says, and leaves the rest alone",
    ({ title, handler }: { title: string; handler: string }) => {
      const sent: Array<string> = quotedStrings(
        sourceBetween(
          sourceBetween(view, `const ${handler}`, "if (response.isFailure())"),
          "fields: [",
          "]",
        ),
      );
      const row: Array<string> = rows.find((candidate: Array<string>) => {
        return boldItems(candidate[0]!)[0] === title;
      })!;
      const copies: string = row[1]!.toLowerCase();
      const leaves: string = row[2]!.toLowerCase();

      // The confirmation this button opens submits this handler.
      expect(sourceBetween(view, `title="${title}"`, "onClose=")).toContain(
        `onSubmit={${handler}}`,
      );
      expect(sent.length).toBeGreaterThan(0);

      for (const field of Object.keys(FIELD_WORDS)) {
        const words: string = FIELD_WORDS[field]!;

        if (sent.includes(field)) {
          expect({ title, field, copied: copies.includes(words) }).toEqual({
            title,
            field,
            copied: true,
          });
          continue;
        }

        expect({ title, field, copied: copies.includes(words) }).toEqual({
          title,
          field,
          copied: false,
        });
        expect({
          title,
          field,
          leftAlone:
            leaves.includes(words) || leaves.includes("everything else"),
        }).toEqual({ title, field, leftAlone: true });
      }
    },
  );

  it("names how many monitors a button reaches as the button does", () => {
    const count: number = 3;

    expect(view).toContain(
      '`Sync Criteria to ${linkedMonitorCount} Linked Monitor${linkedMonitorCount === 1 ? "" : "s"}`',
    );
    expect(page).toContain(
      `**Sync Criteria to ${count} Linked Monitor${count === 1 ? "" : "s"}**`,
    );
  });

  it("greys every sync button out while nothing is linked", () => {
    for (const button of [
      "syncCriteriaButtonTitle",
      "syncIntervalButtonTitle",
      "syncLabelsButtonTitle",
      "syncCustomFieldsButtonTitle",
    ]) {
      expect({
        button,
        disabledWhenUnlinked: sourceBetween(
          view,
          `title: ${button},`,
          "onClick",
        ).includes("disabled: linkedMonitorCount === 0"),
      }).toEqual({ button, disabledWhenUnlinked: true });
    }

    expect(page).toContain("and is greyed out while nothing is linked");
  });

  it("says a sync cannot be undone, as every confirmation does", () => {
    for (const button of SYNC_BUTTONS) {
      expect({
        button: button.title,
        warns: sourceBetween(
          view,
          `title="${button.title}"`,
          "submitButtonText",
        ).includes("This cannot be undone."),
      }).toEqual({ button: button.title, warns: true });
    }

    expect(page).toContain("A sync cannot be undone.");
  });

  it("Sync from Template sends no fields, so the service copies its default set", () => {
    const single: string = sourceBetween(
      view,
      "const onSingleSyncSubmit",
      "useEffect(",
    );
    const defaults: Array<string> = serviceFieldList("DEFAULT_SYNCABLE_FIELDS");
    const sentence: string = paragraphStarting(page, "To sync one monitor,");

    expect(single).toContain("/sync-to-monitor/");
    expect(single).not.toContain("fields:");
    expect(readRepoFile(SERVICE_FILE)).toContain(
      "if (!fields || fields.length === 0) {\n      return [...DEFAULT_SYNCABLE_FIELDS];",
    );
    expect(readRepoFile(API_FILE)).toContain(
      "...(fields !== undefined ? { fields } : {}),",
    );

    const copied: string = sentence.slice(
      sentence.indexOf("That copies"),
      sentence.indexOf("and leaves"),
    );

    for (const field of Object.keys(FIELD_WORDS)) {
      expect({
        field,
        copied: copied.toLowerCase().includes(FIELD_WORDS[field]!),
      }).toEqual({ field, copied: defaults.includes(field) });
    }

    expect(sentence).toContain(
      "leaves the monitor's name, description and custom field values alone",
    );
  });

  it("calls a sync that missed monitors Partially synced, and says why", () => {
    const partial: SyncResultSummary = buildSyncResultSummary({
      subject: "criteria",
      syncedMonitors: 2,
      totalLinkedMonitors: 3,
    });
    const whole: SyncResultSummary = buildSyncResultSummary({
      subject: "criteria",
      syncedMonitors: 3,
      totalLinkedMonitors: 3,
    });

    expect(partial.title).toBe("Partially synced");
    expect(partial.isIncomplete).toBe(true);
    expect(whole.isIncomplete).toBe(false);
    expect(readRepoFile(RESULT_FILE)).toContain(
      "still use the previous configuration — usually because your permissions do not cover them.",
    );
    expect(page).toContain(
      "**Partially synced** means some linked monitors still have the previous configuration, usually because your permissions do not cover them.",
    );
  });

  it("lists the protected fields on the criteria card and in the two syncs that copy steps", () => {
    const criteriaCard: string = sourceBetween(
      view,
      'name="Monitoring Criteria"',
      'name="Monitoring Interval"',
    );

    expect(criteriaCard).toContain("<MonitorTemplateSyncFieldsSummary");

    // Only the syncs that copy step settings name the protected fields.
    for (const button of SYNC_BUTTONS) {
      const confirmation: string = sourceBetween(
        view,
        `title="${button.title}"`,
        "onClose=",
      );

      expect({
        button: button.title,
        lists: confirmation.includes("protectedFields"),
      }).toEqual({
        button: button.title,
        lists: button.handler === "onSyncCriteriaSubmit",
      });
    }

    expect(
      sourceBetween(view, 'title="Sync Monitor from Template"', "onClose="),
    ).toContain("protectedFields");
    expect(section(page, "### Save")).toContain(
      "The **Monitoring Criteria** card, and the confirmation of both syncs below, list the protected fields.",
    );
    expect(section(page, "### Sync")).toContain(
      "Use **Sync Criteria to Linked Monitors**, or **Sync from Template** on an individual linked monitor.",
    );
  });
});

describe("the fields a template can keep out of a sync", () => {
  const details: string = page.slice(
    page.indexOf(":::details Field names for doNotSyncFields"),
  );
  const rows: Array<Array<string>> = tableRows(details);

  // Each documented type, with the field names the table gives it.
  function documentedTypes(): Map<MonitorType, Array<string>> {
    const documented: Map<MonitorType, Array<string>> = new Map();

    for (const row of rows) {
      const names: Array<string> = row[0]!
        .replace(ONLY_SUFFIX, "")
        .split(TYPE_LIST_SEPARATOR);
      const fields: Array<string> = codeItems(row[1]!);
      /*
       * "Logs, Security Events, ..." beside "`logMonitor`, ..." pairs each
       * type with one field, respectively; any other row gives every type
       * all of its fields.
       */
      const respectively: boolean =
        names.length > 1 && names.length === fields.length;

      names.forEach((name: string, index: number) => {
        const type: MonitorType | undefined = typeTitled(name.trim());

        expect({ name, offered: Boolean(type) }).toEqual({
          name,
          offered: true,
        });

        documented.set(type!, [
          ...(documented.get(type!) || []),
          ...(respectively ? [fields[index]!] : fields),
        ]);
      });
    }

    return documented;
  }

  // The infrastructure types the sentence under the table names.
  function infrastructureTypes(): Array<MonitorType> {
    const listed: RegExpMatchArray | null = details.match(INFRASTRUCTURE_LIST);

    expect(listed).not.toBeNull();

    return (listed![1] as string).split(", ").map((name: string) => {
      const type: MonitorType | undefined = typeTitled(name.trim());

      expect({ name, offered: Boolean(type) }).toEqual({
        name,
        offered: true,
      });

      return type!;
    });
  }

  it("names every type as the type picker titles it", () => {
    expect(documentedTypes().size).toBeGreaterThan(0);
    expect(infrastructureTypes().length).toBeGreaterThan(0);
  });

  it("gives every type in the table exactly the fields it can keep", () => {
    const documented: Map<MonitorType, Array<string>> = documentedTypes();

    for (const [type, paths] of documented) {
      expect({ type, paths: [...paths].sort() }).toEqual({
        type,
        paths: fieldPaths(type).sort(),
      });
    }
  });

  it("covers every type the picker offers that has a field to keep", () => {
    const documented: Map<MonitorType, Array<string>> = documentedTypes();
    const infrastructure: Array<MonitorType> = infrastructureTypes();
    const withFields: Array<MonitorType> = OFFERED_TYPES.filter(
      (type: MonitorType): boolean => {
        return fieldPaths(type).length > 0;
      },
    );

    expect([...documented.keys(), ...infrastructure].sort()).toEqual(
      [...withFields].sort(),
    );

    // Profiles has fields, but the picker does not offer the type.
    expect(fieldPaths(MonitorType.Profiles).length).toBeGreaterThan(0);
    expect(OFFERED_TYPES).not.toContain(MonitorType.Profiles);
  });

  it("says what an infrastructure type can keep: every type its selector, queries and window, all but Host its filters", () => {
    const sentence: string = paragraphStarting(
      details,
      "Infrastructure monitors (",
    );
    const infrastructure: Array<MonitorType> = infrastructureTypes();

    for (const type of infrastructure) {
      const paths: Array<string> = fieldPaths(type);
      const filters: Array<string> = paths.filter((fieldPath: string) => {
        return (
          fieldPath.endsWith(".resources") ||
          fieldPath.endsWith(".resourceFilters") ||
          fieldPath.endsWith(".containerFilters")
        );
      });

      expect({ type, selectorQueriesWindow: paths.length }).toEqual({
        type,
        selectorQueriesWindow: 3 + filters.length,
      });
      expect(
        paths.some((fieldPath: string) => {
          return fieldPath.endsWith(".metricViewConfig");
        }),
      ).toBe(true);
      expect(
        paths.some((fieldPath: string) => {
          return fieldPath.endsWith(".rollingTime");
        }),
      ).toBe(true);
      expect({ type, filters: filters.length }).toEqual({
        type,
        filters: type === MonitorType.Host ? 0 : 1,
      });
    }

    expect(infrastructure).toContain(MonitorType.Host);
    expect(sentence).toContain(
      "offer their resource selector, filters (every type but Host), metric queries and query time window.",
    );
    expect(sentence).toContain(
      "Their names are listed in **Template sync settings**",
    );
  });

  it("keeps credentials and a resolver's server and port together, as the catalog does", () => {
    const tls: MonitorTemplateSyncField | undefined =
      MonitorTemplateSyncFieldUtil.getFields(MonitorType.Website).find(
        (field: MonitorTemplateSyncField): boolean => {
          return field.path === "tlsClientAuthentication";
        },
      );
    const resolver: MonitorTemplateSyncField | undefined =
      MonitorTemplateSyncFieldUtil.getFields(MonitorType.DNS).find(
        (field: MonitorTemplateSyncField): boolean => {
          return field.path === "dnsMonitor.resolver";
        },
      );

    expect(tls?.description).toBe(
      "Keep the certificate, private key, and key passphrase together.",
    );
    expect(resolver?.description).toBe(
      "Keep the DNS server and port together.",
    );
    expect(details).toContain(
      "`tlsClientAuthentication` (the client certificate, key and passphrase together)",
    );
    expect(details).toContain(
      "`dnsMonitor.resolver` (the DNS server and port together)",
    );
    expect(page).toContain(
      "Related credentials, such as a client certificate and its private key, are kept together.",
    );
  });

  it("names the API example's fields as the editor labels them", () => {
    const labels: Map<string, string> = new Map(
      MonitorTemplateSyncFieldUtil.getFields(MonitorType.API).map(
        (field: MonitorTemplateSyncField): [string, string] => {
          return [field.path, field.label];
        },
      ),
    );

    expect(labels.get("monitorDestination")).toBe("Monitor destination");
    expect(labels.get("requestHeaders")).toBe("Request headers");
    expect(page).toContain(
      "protect **Monitor destination** and **Request headers** on an API template",
    );
  });

  it("gives an API example the service accepts for an API template", () => {
    const json: RegExpMatchArray | null = page.match(JSON_FENCE);

    expect(json).not.toBeNull();

    const steps: {
      value: {
        monitorStepsInstanceArray: Array<{
          value: { doNotSyncFields: Array<string> };
        }>;
      };
    } = JSON.parse(json![1] as string);
    const fields: Array<string> =
      steps.value.monitorStepsInstanceArray[0]!.value.doNotSyncFields;

    expect(fields).toEqual(["monitorDestination", "requestHeaders"]);
    expect(MonitorTemplateSyncFieldUtil.parse(fields, MonitorType.API)).toEqual(
      fields,
    );
  });

  it("says what an empty or missing list syncs, and what is refused", () => {
    expect(MonitorTemplateSyncFieldUtil.parse(undefined, MonitorType.API)).toBe(
      undefined,
    );
    expect(MonitorTemplateSyncFieldUtil.parse([], MonitorType.API)).toEqual([]);
    expect(page).toContain(
      "Omit the array or set it to `[]` to sync every supported step setting.",
    );

    // A field of another type is refused, by the name the page quotes.
    expect(() => {
      MonitorTemplateSyncFieldUtil.parse(["requestHeaders"], MonitorType.Ping);
    }).toThrow("Unsupported do not sync field: requestHeaders.");
    expect(() => {
      MonitorTemplateSyncFieldUtil.parse(["noSuchField"], MonitorType.API);
    }).toThrow("Unsupported do not sync field");
    expect(page).toContain(
      ':::details Saving fails with "Unsupported do not sync field"',
    );
  });

  it("quotes the refusal when a protected step cannot be matched", () => {
    expect(readRepoFile(SYNC_UTIL_FILE)).toContain(
      "a template step cannot be matched to an existing monitor step",
    );
    expect(page).toContain(
      ':::details A sync fails with "a template step cannot be matched to an existing monitor step"',
    );
  });
});

describe("who can create and change a template", () => {
  const sentence: string = paragraphStarting(
    page,
    "- **A role that can create templates**:",
  );

  it("names the roles and the permission the model's create list holds", () => {
    const titles: Array<string> = PermissionHelper.getPermissionTitles(
      new MonitorTemplate().getCreatePermissions(),
    );

    expect(titles).toContain("Create Monitor Template");

    for (const title of titles) {
      expect({ title, named: sentence.includes(title) }).toEqual({
        title,
        named: true,
      });
    }

    expect(sentence).toContain(
      "or a custom role with the Create Monitor Template permission.",
    );
  });

  it("says changing one takes the same roles, or the edit permission", () => {
    const create: Array<string> = PermissionHelper.getPermissionTitles(
      new MonitorTemplate().getCreatePermissions(),
    );
    const update: Array<string> = PermissionHelper.getPermissionTitles(
      new MonitorTemplate().getUpdatePermissions(),
    );

    expect(
      create.filter((title: string): boolean => {
        return title !== "Create Monitor Template";
      }),
    ).toEqual(
      update.filter((title: string): boolean => {
        return title !== "Edit Monitor Template";
      }),
    );
    expect(update).toContain("Edit Monitor Template");
    expect(sentence).toContain(
      "Changing a template takes the same roles, or the Edit Monitor Template permission.",
    );
  });
});
