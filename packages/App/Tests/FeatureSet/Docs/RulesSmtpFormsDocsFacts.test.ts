import { readPage } from "./DocsContentSupport";
import { escapeRegExp } from "./DocsTranslationChecks";
import AlertOwnerRule from "Common/Models/DatabaseModels/AlertOwnerRule";
import DatabaseBaseModel, {
  DatabaseBaseModelType,
} from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { EmailServerType } from "Common/Models/DatabaseModels/GlobalConfig";
import IncidentLabelRule from "Common/Models/DatabaseModels/IncidentLabelRule";
import MonitorLabelRule from "Common/Models/DatabaseModels/MonitorLabelRule";
import MonitorOwnerRule from "Common/Models/DatabaseModels/MonitorOwnerRule";
import ProjectSmtpConfig from "Common/Models/DatabaseModels/ProjectSmtpConfig";
import VMwareVCenterLabelRule from "Common/Models/DatabaseModels/VMwareVCenterLabelRule";
import DataSourceEgressGuard, {
  ResolvedAddress,
} from "Common/Server/Utils/DataSource/EgressGuard";
import { getTableColumn } from "Common/Types/Database/TableColumn";
import MailTransportType from "Common/Types/Email/MailTransportType";
import SMTPAuthenticationType from "Common/Types/Email/SMTPAuthenticationType";
import { MORE_FIELDS_SECTION_TITLE } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import {
  createTranslator,
  toSentenceTerm,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import LabelRuleImportExport, {
  LABEL_RULE_EXPORT_FILE_TYPE,
  LABEL_RULE_EXPORT_SCHEMA_VERSION,
  LABEL_RULE_MODELS,
  ParsedLabelRuleImport,
} from "Common/Utils/LabelRuleImportExport";
import { afterEach, describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Docs overhaul task 14: what the Label and Owner Rules, Import and Export
 * Label Rules, Run Rules on Existing Resources, SMTP and Forms Overview pages
 * say, held to the code that does it. The translations are held to these
 * pages by RulesSmtpFormsDocsTranslations. What earlier suites hold stays
 * with them: the rule forms and their refusals (ResourceRuleFormsDocs), what
 * a run reaches and its bound (RunRulesNowDocsPage,
 * SubscriberAndRunScopeDocs), the SMTP form and its test's permission and
 * plan (SmtpConfigDocs, TestSendDocs), and the Forms product (FormsDocs,
 * FormBrandingDocs). This one holds the rest: where each screen is, what it
 * is called and where its buttons sit, what the import reads, and what the
 * mail server's test answers.
 *
 * Markdown is not compiled and App tests read no React module, so the
 * screens' words are read from their source files.
 */

const REPO_DIR: string = path.resolve(__dirname, "../../../../..");

const RULES: string = "configuration/label-and-owner-rules";
const IMPORT: string = "configuration/label-rule-import-export";
const RUN: string = "configuration/run-rules-now";
const SMTP: string = "emails/smtp";
const FORMS: string = "forms/index";

const DASHBOARD: string = "packages/App/FeatureSet/Dashboard/src";
const ADMIN_DASHBOARD: string = "packages/App/FeatureSet/AdminDashboard/src";
const COMMON_UI: string = "packages/Common/UI/Components";

const SOURCES: Record<string, string> = {
  monitorSideMenu: `${DASHBOARD}/Pages/Monitor/SideMenu.tsx`,
  incidentSideMenu: `${DASHBOARD}/Pages/Incidents/SideMenu.tsx`,
  incidentLabelRules: `${DASHBOARD}/Pages/Incidents/Settings/IncidentLabelRules.tsx`,
  alertLabelRules: `${DASHBOARD}/Pages/Alerts/Settings/AlertLabelRules.tsx`,
  monitorLabelRules: `${DASHBOARD}/Pages/Monitor/Settings/MonitorLabelRules.tsx`,
  vmwareLabelRules: `${DASHBOARD}/Pages/VMware/Settings/LabelRules.tsx`,
  resourceRuleForm: `${DASHBOARD}/Utils/Form/ResourceRuleForm.ts`,
  ruleCriteriaFields: `${COMMON_UI}/RuleCriteria/RuleCriteriaFields.ts`,
  ownersFormField: `${COMMON_UI}/PeoplePicker/OwnersFormField.ts`,
  baseModelTable: `${COMMON_UI}/ModelTable/BaseModelTable.tsx`,
  moreMenu: `${COMMON_UI}/MoreMenu/MoreMenu.tsx`,
  labelRuleTable: `${COMMON_UI}/LabelRule/LabelRuleTable.tsx`,
  importLabelRulesModal: `${COMMON_UI}/LabelRule/ImportLabelRulesModal.tsx`,
  labelRuleImportExport: "packages/Common/Utils/LabelRuleImportExport.ts",
  ruleTable: `${COMMON_UI}/RuleRun/RuleTable.tsx`,
  ruleView: `${COMMON_UI}/RuleRun/RuleView.tsx`,
  runRuleNowModal: `${COMMON_UI}/RuleRun/RunRuleNowModal.tsx`,
  runRulesBulkAction: `${COMMON_UI}/RuleRun/RunRulesBulkAction.ts`,
  splitActionButtons: `${COMMON_UI}/ActionButton/SplitActionButtons.ts`,
  settingsSideMenu: `${DASHBOARD}/Pages/Settings/SideMenu.tsx`,
  notificationSettingsPage: `${DASHBOARD}/Pages/Settings/NotificationSettings.tsx`,
  customSmtpTable: `${DASHBOARD}/Components/CustomSMTP/CustomSMTPTable.tsx`,
  notificationLogsTabs: `${DASHBOARD}/Components/NotificationLogs/NotificationLogsTabs.tsx`,
  emailLogsTable: `${DASHBOARD}/Components/NotificationLogs/EmailLogsTable.tsx`,
  statusPageSideMenu: `${DASHBOARD}/Pages/StatusPages/View/SideMenu.tsx`,
  subscriberSettings: `${DASHBOARD}/Pages/StatusPages/View/SubscriberSettings.tsx`,
  smtpFormFields: `${COMMON_UI}/SmtpConfig/SmtpConfigFormFields.ts`,
  adminNavBar: `${ADMIN_DASHBOARD}/Components/NavBar/NavBar.tsx`,
  adminSettingsSideMenu: `${ADMIN_DASHBOARD}/Pages/Settings/SideMenu.tsx`,
  adminEmailPage: `${ADMIN_DASHBOARD}/Pages/Settings/Email/Index.tsx`,
  adminLocale: `${ADMIN_DASHBOARD}/Locales/en.json`,
  smtpConfigApi: "packages/App/FeatureSet/Notification/API/SMTPConfig.ts",
  mailService: "packages/App/FeatureSet/Notification/Services/MailService.ts",
  graphMailProvider:
    "packages/App/FeatureSet/Notification/Services/MailProviders/MicrosoftGraphMailProvider.ts",
  formsSideMenu: `${DASHBOARD}/Pages/Forms/SideMenu.tsx`,
  formViewSideMenu: `${DASHBOARD}/Pages/Forms/View/SideMenu.tsx`,
  dashboardRouteMap: `${DASHBOARD}/Utils/RouteMap.ts`,
  accountsApp: "packages/App/FeatureSet/Accounts/src/App.tsx",
};

const DASHBOARD_PAGES_DIR: string = path.join(REPO_DIR, DASHBOARD, "Pages");

// A section of an object-literal side menu: its title, whether it says it starts folded, and its links.
interface MenuSection {
  title: string;
  defaultCollapsed: boolean | undefined;
  items: Array<string>;
}

// "{ title: "Settings", defaultCollapsed: true, items: [" - a menu written as data.
const OBJECT_MENU_SECTION: RegExp =
  /title: "([^"]+)",\s*(?:defaultCollapsed: (true|false),\s*)?items: \[/g;

// "link: { title: "Label Rules"," - one of a section's links.
const OBJECT_MENU_ITEM: RegExp = /link: \{\s*title: "([^"]+)"/g;

// "<SideMenuSection title=... defaultCollapsed=...>" - a menu written as JSX.
const JSX_MENU_SECTION: RegExp = /<SideMenuSection\b([^>]*)>/g;

// A JSX menu's titles: a string, or a key of the app's own locale.
const JSX_TITLE: RegExp = /title=(?:"([^"]+)"|\{t\("([^"]+)"\)\})/;

const JSX_ITEM: RegExp = /title: (?:"([^"]+)"|t\("([^"]+)"\))/g;

// A JSX section's own fold: defaultCollapsed, or defaultCollapsed={false}.
const JSX_FOLD: RegExp = /defaultCollapsed(?:=\{(true|false)\})?/;

// The titles that start folded, as SideMenuSectionState lists them.
const COLLAPSED_TITLES_LIST: RegExp =
  /SECTION_TITLES_COLLAPSED_BY_DEFAULT: ReadonlyArray<string> = \[([\s\S]*?)\];/;

// A table cell that is one bold span.
const BOLD_CELL: RegExp = /^\*\*([^*]+)\*\*$/;

// The owners picker's button, as OwnersFormField names it.
const OWNERS_ADD_BUTTON: RegExp = /OWNERS_ADD_BUTTON_TEXT: string = "([^"]+)"/;

// The sentence an owner rule is named with, after its picks.
const OWNER_RULE_NAME: RegExp =
  /OWNER_RULE_NAME_WORDING: RuleNameWording = \{\s*picksSlot: "owners",\s*allPicks: translationKey\("([^"]+)"\)/;

// The sentence a label rule that only inherits is named with.
const LABEL_RULE_INHERIT_NAME: RegExp =
  /LABEL_RULE_INHERIT_NAME_WORDING: RuleNameWording = \{\s*picksSlot: "sources",\s*allPicks: translationKey\("([^"]+)"\)/;

// A table's card title.
const CARD_TITLE: RegExp = /cardProps=\{\{\s*title: "([^"]+)"/;

function readSource(key: string): string {
  return fs.readFileSync(path.join(REPO_DIR, SOURCES[key]!), "utf8");
}

function english(page: string): string {
  return readPage("en", page);
}

function adminLocale(): Record<string, unknown> {
  return JSON.parse(readSource("adminLocale")) as Record<string, unknown>;
}

// A dotted key of a nested locale, as the Admin Dashboard's t() reads it.
function adminText(key: string): string {
  let node: unknown = adminLocale();

  for (const part of key.split(".")) {
    node = (node as Record<string, unknown>)[part];
  }

  expect({ key, found: typeof node === "string" }).toEqual({
    key,
    found: true,
  });

  return node as string;
}

// The sections of a side menu written as an array of objects.
function objectMenuSections(source: string): Array<MenuSection> {
  const heads: Array<RegExpExecArray> = [
    ...source.matchAll(OBJECT_MENU_SECTION),
  ];

  return heads.map((head: RegExpExecArray, index: number): MenuSection => {
    const end: number =
      index + 1 < heads.length ? heads[index + 1]!.index : source.length;
    const body: string = source.slice(head.index, end);

    return {
      title: head[1] as string,
      defaultCollapsed: head[2] === undefined ? undefined : head[2] === "true",
      items: [...body.matchAll(OBJECT_MENU_ITEM)].map(
        (item: RegExpExecArray): string => {
          return item[1] as string;
        },
      ),
    };
  });
}

/*
 * The sections of a side menu written as JSX, with the Admin Dashboard's
 * locale keys read as the words they draw.
 */
function jsxMenuSections(
  source: string,
  words: (key: string) => string = (key: string): string => {
    return key;
  },
): Array<MenuSection> {
  const heads: Array<RegExpExecArray> = [...source.matchAll(JSX_MENU_SECTION)];

  return heads.map((head: RegExpExecArray): MenuSection => {
    const attributes: string = head[1] as string;
    const close: number = source.indexOf("</SideMenuSection>", head.index);
    const body: string = source.slice(
      head.index + head[0].length,
      close === -1 ? source.length : close,
    );
    const title: RegExpExecArray | null = JSX_TITLE.exec(attributes);
    const folded: RegExpExecArray | null = JSX_FOLD.exec(attributes);

    return {
      title: title ? title[1] ?? words(title[2] as string) : "",
      defaultCollapsed: folded ? folded[1] !== "false" : undefined,
      items: [...body.matchAll(JSX_ITEM)].map(
        (item: RegExpExecArray): string => {
          return item[1] ?? words(item[2] as string);
        },
      ),
    };
  });
}

function sectionOf(sections: Array<MenuSection>, title: string): MenuSection {
  const section: MenuSection | undefined = sections.find(
    (candidate: MenuSection): boolean => {
      return candidate.title === title;
    },
  );

  expect({ title, found: Boolean(section) }).toEqual({ title, found: true });

  return section as MenuSection;
}

/*
 * Whether a section starts folded: its own defaultCollapsed, or else its
 * title (SideMenuSectionState's SECTION_TITLES_COLLAPSED_BY_DEFAULT).
 */
function startsFolded(section: MenuSection): boolean {
  if (section.defaultCollapsed !== undefined) {
    return section.defaultCollapsed;
  }

  const state: string = fs.readFileSync(
    path.join(REPO_DIR, COMMON_UI, "SideMenu/SideMenuSectionState.ts"),
    "utf8",
  );
  const list: string = COLLAPSED_TITLES_LIST.exec(state)?.[1] || "";

  return list.includes(`"${section.title}"`);
}

// The value a "key: "value"," line of a source file holds.
function quotedValue(source: string, key: string): string {
  const match: RegExpExecArray | null = new RegExp(
    `${escapeRegExp(key)}: "([^"]+)"`,
  ).exec(source);

  expect({ key, found: Boolean(match) }).toEqual({ key, found: true });

  return (match as RegExpExecArray)[1] as string;
}

// The text a "name: translationKey("...")" entry of a source file holds.
function translationKeyOf(source: string, name: string): string {
  const match: RegExpExecArray | null = new RegExp(
    `${escapeRegExp(name)}: translationKey\\("([^"]+)"\\)`,
  ).exec(source);

  expect({ name, found: Boolean(match) }).toEqual({ name, found: true });

  return (match as RegExpExecArray)[1] as string;
}

// A block of a source file: from a marker to the next occurrence of an end marker.
function blockFrom(source: string, marker: string, end: string): string {
  const start: number = source.indexOf(marker);

  expect({ marker, found: start >= 0 }).toEqual({ marker, found: true });

  const stop: number = source.indexOf(end, start + marker.length);

  return source.slice(start, stop === -1 ? undefined : stop);
}

// The first fenced block of a page with this info string.
function fencedBlock(markdown: string, info: string): string {
  const match: RegExpExecArray | null = new RegExp(
    "```" + escapeRegExp(info) + "\\n([\\s\\S]*?)\\n```",
  ).exec(markdown);

  expect({ info, found: Boolean(match) }).toEqual({ info, found: true });

  return (match as RegExpExecArray)[1] as string;
}

// A table row's cells, trimmed of the padding the formatter lines them up with.
function cellsOf(line: string): Array<string> {
  return line
    .split("|")
    .slice(1, -1)
    .map((cell: string): string => {
      return cell.trim();
    });
}

// The cells of every table row of a page whose first cell is this text.
function tableRows(markdown: string, firstCell: string): Array<Array<string>> {
  return markdown
    .split("\n")
    .filter((line: string): boolean => {
      return line.startsWith("|");
    })
    .map(cellsOf)
    .filter((cells: Array<string>): boolean => {
      return cells[0] === firstCell;
    });
}

// The second cell of the one row a table has for this first cell.
function rowText(markdown: string, firstCell: string): string {
  const rows: Array<Array<string>> = tableRows(markdown, firstCell);

  expect({ firstCell, rows: rows.length }).toEqual({ firstCell, rows: 1 });

  return (rows[0] as Array<string>)[1] || "";
}

// The bold first cells of a page's table rows, in order, from a heading to the next one.
function tableFirstCells(markdown: string, heading: string): Array<string> {
  const section: string = blockFrom(markdown, heading, "\n## ");

  return section
    .split("\n")
    .filter((line: string): boolean => {
      return line.startsWith("|");
    })
    .map((line: string): string | null => {
      const cell: RegExpExecArray | null = BOLD_CELL.exec(
        cellsOf(line)[0] || "",
      );
      return cell ? (cell[1] as string) : null;
    })
    .filter((cell: string | null): cell is string => {
      return cell !== null;
    });
}

function englishTranslator(): Translator {
  return createTranslator((): string | undefined => {
    return undefined;
  }, "en");
}

// A table of label rules a Dashboard page draws: the component, and the rule model it lists.
interface LabelRuleTableUse {
  file: string;
  component: string;
  model: string;
}

// "<LabelRuleTable<MonitorLabelRule>" - any table of any label rule model.
const LABEL_RULE_TABLE: RegExp = /<(\w*Table)<(\w+LabelRule)>/g;

// Every table of label rules the Dashboard's pages draw.
function labelRuleTables(): Array<LabelRuleTableUse> {
  const uses: Array<LabelRuleTableUse> = [];
  const walk: (dir: string) => void = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full: string = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(full);
        continue;
      }

      if (!entry.name.endsWith(".tsx")) {
        continue;
      }

      for (const match of fs
        .readFileSync(full, "utf8")
        .matchAll(LABEL_RULE_TABLE)) {
        uses.push({
          file: path.relative(REPO_DIR, full),
          component: match[1] as string,
          model: match[2] as string,
        });
      }
    }
  };

  walk(DASHBOARD_PAGES_DIR);

  return uses;
}

describe("Label and Owner Rules, against the Dashboard", () => {
  const page: string = english(RULES);

  it("finds a product's rules under its Settings, and an incident's under Rules, both folded at first", () => {
    const monitors: MenuSection = sectionOf(
      objectMenuSections(readSource("monitorSideMenu")),
      "Settings",
    );
    const incidents: MenuSection = sectionOf(
      objectMenuSections(readSource("incidentSideMenu")),
      "Rules",
    );

    expect(monitors.items).toEqual(
      expect.arrayContaining(["Label Rules", "Owner Rules"]),
    );
    expect(incidents.items).toEqual(
      expect.arrayContaining(["Label Rules", "Owner Rules"]),
    );
    expect(startsFolded(monitors)).toBe(true);
    expect(startsFolded(incidents)).toBe(true);

    expect(page).toContain("**Monitors → Settings → Label Rules**");
    expect(page).toContain("**Incidents → Rules → Label Rules**");
    expect(page).toContain(
      "**Settings** and **Rules** start folded in the side menu",
    );
  });

  it("names the incident and alert rule pages' tabs as they draw them", () => {
    expect(readSource("incidentLabelRules")).toMatch(
      /name: "Incident Rules",[\s\S]*name: "Episode Rules",/,
    );
    expect(readSource("alertLabelRules")).toMatch(
      /name: "Alert Rules",[\s\S]*name: "Episode Rules",/,
    );
    expect(page).toContain(
      "an **Incident Rules** (or **Alert Rules**) tab and an **Episode Rules** tab",
    );
  });

  it("names the create button, and the dialog's last button, after the rule", () => {
    const table: string = readSource("baseModelTable");
    const button: string = englishTranslator().translateTemplate(
      translationKeyOf(table, "Create"),
      { itemName: new MonitorLabelRule().singularName || "" },
    );

    expect(button).toBe("Create Monitor Label Rule");
    // The same phrase is the table's button and its create dialog's submit button.
    expect(table).toContain(
      "the table header's, and the create\n * dialog's submit button",
    );
    expect(page).toContain(`for example **${button}**`);
    expect(page).toContain(
      `click the button named after the rule again, such as **${button}**`,
    );
  });

  it("walks the two steps, and the condition builder's words, as the form draws them", () => {
    const form: string = readSource("resourceRuleForm");
    const criteria: string = readSource("ruleCriteriaFields");

    expect(form).toContain('{ title: "Match", id: "match-criteria" },');
    expect(form).toContain('{ title: "Labels", id: "labels" },');
    expect(form).toContain('{ title: "Owners", id: "owners" },');
    expect(form).toContain('title: "Labels to Add",');

    const addCondition: string = quotedValue(criteria, "addCondition");
    const matchAll: string = quotedValue(criteria, "matchAll");
    const matchAny: string = quotedValue(criteria, "matchAny");
    const addOwner: RegExpExecArray | null = OWNERS_ADD_BUTTON.exec(
      readSource("ownersFormField"),
    );

    expect(addOwner).not.toBeNull();
    expect(page).toContain(
      `On the **Match** step, click **${addCondition}** for each condition`,
    );
    expect(page).toContain(`choose **${matchAll}** or **${matchAny}**`);
    expect(page).toContain(
      "On the **Labels** step, pick the **Labels to Add**",
    );
    expect(page).toContain(
      `the step is **Owners**: **${(addOwner as RegExpExecArray)[1]}** opens one list`,
    );
  });

  it("names a rule the way the form fills its name in", () => {
    const form: string = readSource("resourceRuleForm");
    const translator: Translator = englishTranslator();
    const labels: string = translationKeyOf(form, "allPicks");
    const owners: RegExpExecArray | null = OWNER_RULE_NAME.exec(form);
    const inherits: RegExpExecArray | null = LABEL_RULE_INHERIT_NAME.exec(form);

    expect(owners).not.toBeNull();
    expect(inherits).not.toBeNull();

    const inheritingName: (terms: Array<string>) => string = (
      terms: Array<string>,
    ): string => {
      return translator.translateTemplate(
        (inherits as RegExpExecArray)[1] as string,
        {
          sources: terms
            .map((term: string): string => {
              return toSentenceTerm(term, "en");
            })
            .join(", "),
        },
      );
    };

    const names: Array<string> = [
      translator.translateTemplate(labels, { labels: "Production" }),
      translator.translateTemplate((owners as RegExpExecArray)[1] as string, {
        owners: "Platform",
      }),
      inheritingName(["Monitors"]),
      inheritingName(["Monitors", "Hosts"]),
      inheritingName(["Monitor"]),
    ];

    expect(names).toEqual([
      "Add Production",
      "Add Platform as owners",
      "Inherit labels from monitors",
      "Inherit labels from monitors, hosts",
      "Inherit labels from monitor",
    ]);

    for (const name of names) {
      expect({ name, italic: page.includes(`_${name}_`) }).toEqual({
        name,
        italic: true,
      });
    }
  });

  it("says what the folded fields hold, and how a new rule starts", () => {
    const form: string = readSource("resourceRuleForm");
    const ownerStep: string = blockFrom(
      form,
      "const getOwnerRuleNameAndMoreFields",
      "\n};",
    );

    // Notify Owners and Description fold under More fields; Enabled waits for the edit form.
    expect(ownerStep).toMatch(
      /title: "Notify Owners",[\s\S]*?collapsibleSection: moreFields,/,
    );
    expect(ownerStep).toMatch(
      /title: "Description",[\s\S]*?collapsibleSection: moreFields,/,
    );
    expect(ownerStep).toMatch(
      /title: "Enabled",[\s\S]*?doNotShowWhenCreating: true,/,
    );

    for (const ruleType of [MonitorOwnerRule, AlertOwnerRule]) {
      expect(getTableColumn(new ruleType(), "notifyOwners")?.defaultValue).toBe(
        true,
      );
    }

    for (const ruleType of [
      ...LABEL_RULE_MODELS,
      MonitorOwnerRule,
      AlertOwnerRule,
    ]) {
      expect({
        rule: new ruleType().tableName,
        isEnabled: getTableColumn(new ruleType(), "isEnabled")?.defaultValue,
      }).toEqual({ rule: new ruleType().tableName, isEnabled: true });
    }

    const list: string = readSource("monitorLabelRules");

    expect(list).toContain('<Pill color={Green} text="Enabled" />');
    expect(list).toContain('<Pill color={Red} text="Disabled" />');

    expect(page).toContain(
      `**${MORE_FIELDS_SECTION_TITLE}** holds the optional **Description** and, on an owner rule, **Notify Owners**, which is on by default`,
    );
    expect(page).toContain(
      "The rule starts enabled, and the list shows it with a green **Enabled** pill.",
    );
    expect(page).toContain("the list then shows a red **Disabled** pill");
  });

  it("names the inherit switches as the form draws them, an alert's one monitor singular", () => {
    const form: string = readSource("resourceRuleForm");
    const wording: (block: string, record: string) => string = (
      block: string,
      record: string,
    ): string => {
      const section: string = blockFrom(form, block, "\n};");
      const recordBlock: string = blockFrom(section, `${record}: {`, "},");

      return quotedValue(
        recordBlock.replace(/translationKey\(("[^"]+")\)/g, "$1"),
        "monitorsTitle",
      );
    };

    expect(wording("LABEL_INHERITANCE_WORDING", "incident")).toBe(
      "Inherit Labels From Monitors",
    );
    expect(wording("LABEL_INHERITANCE_WORDING", "alert")).toBe(
      "Inherit Labels From Monitor",
    );
    expect(wording("OWNER_INHERITANCE_WORDING", "alert")).toBe(
      "Inherit Owners From Monitor",
    );

    // The other five switches, as the models title them.
    for (const column of [
      "inheritLabelsFromHosts",
      "inheritLabelsFromKubernetesClusters",
      "inheritLabelsFromDockerHosts",
      "inheritLabelsFromPodmanHosts",
      "inheritLabelsFromServices",
    ]) {
      const title: string | undefined = getTableColumn(
        new IncidentLabelRule(),
        column,
      )?.title;

      expect({ column, title: Boolean(title) }).toEqual({
        column,
        title: true,
      });
    }

    expect(
      getTableColumn(new IncidentLabelRule(), "inheritLabelsFromHosts")?.title,
    ).toBe("Inherit Labels From Hosts");
    expect(page).toContain(
      "on an alert rule the switch is **Inherit Labels From Monitor** (and on an alert owner rule, **Inherit Owners From Monitor**)",
    );
    expect(page).toContain(
      "**Inherit Labels From Hosts**, **… From Kubernetes Clusters**, **… From Docker Hosts**, **… From Podman Hosts** and **… From Services**",
    );
  });
});

describe("Import and Export Label Rules, against the import", () => {
  const page: string = english(IMPORT);

  it("finds both actions in the More options menu of every label rule page but VMware's", () => {
    const table: string = readSource("labelRuleTable");

    // Outlined buttons never take the header's button: they go in its ⋯ menu.
    expect(table).toMatch(
      /title: "Export JSON",\s*icon: IconProp\.Download,\s*buttonStyle: ButtonStyleType\.OUTLINE,/,
    );
    expect(table).toMatch(
      /title: "Import JSON",\s*icon: IconProp\.Upload,\s*buttonStyle: ButtonStyleType\.OUTLINE,/,
    );
    expect(readSource("baseModelTable")).toContain(
      "c.buttonStyle === ButtonStyleType.NORMAL && c.icon === IconProp.Add",
    );
    expect(readSource("baseModelTable")).not.toMatch(
      /style === ButtonStyleType\.OUTLINE \|\|/,
    );
    expect(readSource("moreMenu")).toContain(
      'translateString("More options") || "More options"',
    );

    /*
     * Every table of label rules on a Dashboard page: a LabelRuleTable of a
     * rule the import knows, but for VMware's vCenter rules - a plain
     * RuleTable, of a rule the import does not know.
     */
    const known: Array<string> = LABEL_RULE_MODELS.map(
      (model: DatabaseBaseModelType): string => {
        return new model().tableName || "";
      },
    );
    const vmware: string = new VMwareVCenterLabelRule().tableName || "";
    const uses: Array<LabelRuleTableUse> = labelRuleTables();

    expect(uses.length).toBeGreaterThan(known.length);

    for (const use of uses) {
      expect(use).toEqual({
        file: use.file,
        component: use.model === vmware ? "RuleTable" : "LabelRuleTable",
        model: use.model,
      });
      expect({ model: use.model, known: known.includes(use.model) }).toEqual({
        model: use.model,
        known: use.model !== vmware,
      });
    }

    // ...and every rule the import knows has its page.
    expect(
      known.filter((name: string): boolean => {
        return !uses.some((use: LabelRuleTableUse): boolean => {
          return use.model === name;
        });
      }),
    ).toEqual([]);

    expect(
      uses.some((use: LabelRuleTableUse): boolean => {
        return use.model === vmware;
      }),
    ).toBe(true);
    expect(LabelRuleImportExport.isLabelRuleModel(VMwareVCenterLabelRule)).toBe(
      false,
    );
    expect(readSource("vmwareLabelRules")).not.toContain("LabelRuleTable");

    expect(page).toContain(
      "**Export JSON** and **Import JSON** actions in its **More options** (**⋯**) menu",
    );
    expect(page).toContain(
      "The one exception is VMware: its vCenter label rules have neither.",
    );
    expect(page).toContain("select **More options → Import JSON**");
  });

  it("describes the file the way the import reads it, and its example imports", () => {
    const example: string = fencedBlock(
      page,
      'json title="monitor-label-rules.json"',
    );
    const parsed: ParsedLabelRuleImport = LabelRuleImportExport.parse({
      modelType: MonitorLabelRule,
      fileText: example,
    });

    expect(parsed.sourceResourceType).toBe("MonitorLabelRule");
    expect(parsed.items).toHaveLength(2);
    expect(parsed.mappings).toEqual([]);

    expect(page).toContain(
      `| \`fileType\` | Always \`${LABEL_RULE_EXPORT_FILE_TYPE}\`. |`,
    );
    expect(page).toContain(
      `| \`schemaVersion\` | Always \`${LABEL_RULE_EXPORT_SCHEMA_VERSION}\`. |`,
    );

    // A file needs at least one rule.
    expect(() => {
      LabelRuleImportExport.parse({
        modelType: MonitorLabelRule,
        fileText: JSON.stringify(
          LabelRuleImportExport.envelope({
            resourceType: "MonitorLabelRule",
            items: [],
          }),
        ),
      });
    }).toThrow("at least one label rule");
    expect(page).toContain("A file needs at least one.");

    // 10 MB, in the import and in the dialog that reads the file.
    expect(readSource("labelRuleImportExport")).toContain(
      "new TextEncoder().encode(data.fileText).length > 10 * 1024 * 1024",
    );
    expect(readSource("importLabelRulesModal")).toContain(
      "Choose a JSON file smaller than 10 MB.",
    );
    expect(page).toContain("Files and pasted JSON are limited to 10 MB.");

    // The export reads every rule of the project, whatever the table shows.
    expect(readSource("labelRuleTable")).toContain(
      "Export all label rules in this project, including rules on other pages.",
    );
    expect(page).toContain(
      "The export includes rules on other table pages and ignores table filters.",
    );
  });

  it("names the dialog's buttons as it draws them", () => {
    const modal: string = readSource("importLabelRulesModal");

    expect(modal).toContain('nextButtonText: "Validate and preview"');
    expect(modal).toContain('title="Edit JSON"');
    expect(modal).toContain('title="Download failed rules"');
    expect(modal).toContain(
      '{ one: "Import {{count}} rule", other: "Import {{count}} rules" }',
    );
    expect(
      englishTranslator().translatePlural(
        { one: "Import {{count}} rule", other: "Import {{count}} rules" },
        2,
      ),
    ).toBe("Import 2 rules");

    expect(page).toContain("Select **Validate and preview**.");
    expect(page).toContain("select **Edit JSON** and validate again");
    expect(page).toContain("(for example **Import 2 rules**)");
    expect(page).toContain("select **Download failed rules**");
  });

  it("says which rules also match wildcards, as the import checks them", () => {
    const wildcard: string = blockFrom(
      readSource("labelRuleImportExport"),
      "const WILDCARD_PATTERN_RULE_TYPES",
      "]);",
    );

    expect(wildcard).toContain('"NetworkDeviceLabelRule"');
    expect(wildcard).toContain('"ServiceLevelObjectiveLabelRule"');
    expect(wildcard.match(/"[A-Za-z]+LabelRule"/g)).toHaveLength(2);
    expect(page).toContain(
      "Network Device and SLO label rules support wildcard matching as well as regular expressions.",
    );
  });
});

describe("Run Rules on Existing Resources, against the rule tables", () => {
  const page: string = english(RUN);

  it("finds Run Now in a row's ⋯ menu beside View, and on the rule's own page", () => {
    const ruleTable: string = readSource("ruleTable");
    const runNow: string = blockFrom(ruleTable, 'title: "Run Now",', "onClick");

    // Run Now is a row action that does not ask for the row's button...
    expect(runNow).not.toContain("placement");
    // ...which View takes on every table whose rules have a page of their own.
    expect(readSource("baseModelTable")).toMatch(
      /template: "View \{\{itemName\}\}"[\s\S]{0,900}?placement: ActionButtonPlacement\.Primary,/,
    );
    expect(readSource("splitActionButtons")).toContain(
      "The first visible action marked ActionButtonPlacement.Primary.",
    );
    expect(ruleTable).toContain(
      "Boolean(ruleType && (getRuleViewRoute || props.viewPageRoute))",
    );
    expect(readSource("monitorLabelRules")).toContain("getRuleViewRoute={");

    // The rule's own page has its own Run Now.
    expect(readSource("ruleView")).toMatch(
      /<Card\s+title="Run Now"[\s\S]{0,300}?title: "Run Now",/,
    );

    expect(page).toContain(
      "Open the **⋯** menu at the end of the rule's row and select **Run Now**, or select **View** and then **Run Now** on the rule's own page.",
    );
  });

  it("asks about new owners as the dialog does, off by default, and never on a bulk run", () => {
    const modal: string = readSource("runRuleNowModal");
    const bulk: string = readSource("runRulesBulkAction");

    expect(modal).toContain(
      "const [notifyOwners, setNotifyOwners] = useState<boolean>(false);",
    );
    expect(modal).toContain('title="Notify the owners this run adds"');
    expect(modal).toContain('submitButtonText="Run Rule"');
    expect(bulk).toContain('title: "Run Now",');
    expect(bulk).toContain("notifyOwners: false,");

    expect(page).toContain(
      "choose whether to **Notify the owners this run adds**. It is off by default",
    );
    expect(page).toContain("Select **Run Rule** and keep the dialog open.");
    expect(page).toContain("Owners added by a bulk run are never notified.");
  });
});

describe("SMTP, against the settings, the Admin Dashboard and the mail service", () => {
  const page: string = english(SMTP);

  afterEach(() => {
    delete process.env["BILLING_ENABLED"];
    delete process.env["DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES"];
  });

  it("adds a project's server where Project Settings keeps it", () => {
    const notifications: MenuSection = sectionOf(
      objectMenuSections(readSource("settingsSideMenu")),
      "Notifications",
    );
    const cardTitle: RegExpExecArray | null = CARD_TITLE.exec(
      readSource("customSmtpTable"),
    );

    expect(cardTitle).not.toBeNull();

    const card: string = (cardTitle as RegExpExecArray)[1] as string;
    const button: string = englishTranslator().translateTemplate(
      translationKeyOf(readSource("baseModelTable"), "Create"),
      { itemName: new ProjectSmtpConfig().singularName || "" },
    );

    expect(notifications.items).toEqual(
      expect.arrayContaining(["Notification Settings", "Notification Logs"]),
    );
    expect(readSource("notificationSettingsPage")).toContain(
      "<CustomSMTPTable",
    );
    expect(card).toBe("Custom SMTP Configs");
    expect(button).toBe("Create SMTP Config");

    expect(page).toContain(
      `Add a project's mail server on **Project Settings > Notifications > Notification Settings**, in the **${card}** card.`,
    );
    expect(page).toContain(
      `On **Project Settings > Notifications > Notification Settings**, click **${button}** in the **${card}** card.`,
    );
  });

  it("walks a self-hosted admin to the instance's server as the Admin Dashboard draws it", () => {
    const sections: Array<MenuSection> = jsxMenuSections(
      readSource("adminSettingsSideMenu"),
      adminText,
    );
    const notifications: MenuSection = sectionOf(
      sections,
      adminText("sideMenu.settingsNotifications"),
    );
    const emailPage: string = readSource("adminEmailPage");
    const serverCard: number = emailPage.indexOf(
      't("pages.settings.email.serverCardTitle")',
    );
    const smtpCard: number = emailPage.indexOf(
      't("pages.settings.email.smtpCardTitle")',
    );

    expect(adminText("navbar.settings")).toBe("Settings");
    expect(readSource("adminNavBar")).toMatch(
      /title: "Settings",[\s\S]{0,200}?new Route\("\/admin\/settings"\)/,
    );
    expect(notifications.title).toBe("Notifications");
    expect(notifications.defaultCollapsed).toBe(true);
    expect(notifications.items).toContain(adminText("sideMenu.settingsEmails"));

    // The server card first, its Email Server Type, then the SMTP card it opens.
    expect(serverCard).toBeGreaterThan(-1);
    expect(smtpCard).toBeGreaterThan(serverCard);
    expect(emailPage).toContain(
      'editButtonText={t("pages.settings.email.serverEditButton")}',
    );
    expect(emailPage).toContain('title: "Email Server Type",');
    expect(emailPage).toContain(
      "{emailServerType === EmailServerType.CustomSMTP ? (",
    );
    expect(emailPage).toContain(
      'editButtonText={t("pages.settings.email.smtpEditButton")}',
    );
    expect(EmailServerType.CustomSMTP).toBe("Custom SMTP");

    const path: string = [
      "Admin Dashboard",
      adminText("navbar.settings"),
      adminText("sideMenu.settingsNotifications"),
      adminText("sideMenu.settingsEmails"),
    ].join(" > ");

    expect(page).toContain(`**${path}**`);
    expect(page).toContain(
      `In the Admin Dashboard, open **${adminText("navbar.settings")}**, then **${adminText("sideMenu.settingsNotifications")} > ${adminText("sideMenu.settingsEmails")}** in the side menu (**${adminText("sideMenu.settingsNotifications")}** starts folded).`,
    );
    expect(page).toContain(
      `In the **${adminText("pages.settings.email.serverCardTitle")}** card, click **${adminText("pages.settings.email.serverEditButton")}** and set **Email Server Type** to \`${EmailServerType.CustomSMTP}\`.`,
    );
    expect(page).toContain(
      `Then click **${adminText("pages.settings.email.smtpEditButton")}** in the **${adminText("pages.settings.email.smtpCardTitle")}** card, which appears below it.`,
    );
  });

  it("says what a new project config starts with, as the model and the form start it", () => {
    const config: ProjectSmtpConfig = new ProjectSmtpConfig();

    expect(getTableColumn(config, "secure")?.defaultValue).toBe(true);
    expect(getTableColumn(config, "transportType")?.defaultValue).toBe(
      MailTransportType.SMTP,
    );
    expect(getTableColumn(config, "authType")?.defaultValue).toBe(
      SMTPAuthenticationType.UsernamePassword,
    );
    expect(readSource("smtpFormFields")).toContain(
      "export const DEFAULT_SMTP_PORT: number = 587;",
    );

    // The More fields table of the section that adds a server.
    const adding: string = blockFrom(page, "## Adding an SMTP Server", "\n## ");

    expect(adding).toContain("**Port** (a new project config starts on `587`)");
    expect(rowText(adding, "**Require TLS**")).toMatch(
      /^On for a new project config\. /,
    );
    expect(rowText(adding, "**Transport**")).toMatch(
      new RegExp(
        `^${escapeRegExp(
          `\`${MailTransportType.SMTP}\` (the default), or \`${MailTransportType.MicrosoftGraph}\``,
        )}`,
      ),
    );
    expect(rowText(adding, "**Authentication Type**")).toMatch(
      new RegExp(
        `^${escapeRegExp(
          `\`${SMTPAuthenticationType.UsernamePassword}\` (the default), \`${SMTPAuthenticationType.OAuth}\`, or \`${SMTPAuthenticationType.None}\``,
        )}`,
      ),
    );
  });

  it("quotes the test's refusals as the server words them, and says which carry the reason", () => {
    const api: string = readSource("smtpConfigApi");
    const mail: string = readSource("mailService");

    // A Graph or an OAuth config's refusal ends with the error itself; any other's does not.
    expect(api).toMatch(
      /"Microsoft Graph send failed: " \+\s*\(err instanceof Error/,
    );
    expect(api).toMatch(
      /"Cannot send email with OAuth authentication\.[^"]*Error: " \+\s*\(err instanceof Error/,
    );
    expect(api).toMatch(
      /throw new BadDataException\(\s*"Cannot send email\. Please check your SMTP config\.[^"]*",\s*\);/,
    );
    expect(mail).toContain('targetLabel: "SMTP server",');

    for (const message of [
      "Cannot send email. Please check your SMTP config.",
      "Cannot send email with OAuth authentication",
      "Microsoft Graph send failed",
      "SMTP server host … could not be reached",
    ]) {
      expect({
        message,
        quoted: page.includes(`:::details "${message}"`),
      }).toEqual({ message, quoted: true });
    }

    expect(page).toContain(
      "**Send Test Email** shows it only for an OAuth config; for the others, find it under **View Status Message** on the **Email** tab of the notification logs.",
    );
  });

  it("refuses an unreachable host on Cloud in one sentence, and says why on a self-hosted install", async () => {
    const resolvesTo: (
      address: string,
    ) => () => Promise<Array<ResolvedAddress>> = (
      address: string,
    ): (() => Promise<Array<ResolvedAddress>>) => {
      return async (): Promise<Array<ResolvedAddress>> => {
        return [{ address, family: 4 }];
      };
    };
    const fails: () => Promise<Array<ResolvedAddress>> = async (): Promise<
      Array<ResolvedAddress>
    > => {
      throw new Error("getaddrinfo ENOTFOUND");
    };
    const check: (
      resolveFunction: () => Promise<Array<ResolvedAddress>>,
    ) => Promise<string> = async (
      resolveFunction: () => Promise<Array<ResolvedAddress>>,
    ): Promise<string> => {
      try {
        await DataSourceEgressGuard.assertHostnameAllowed("mail.example.com", {
          targetLabel: "SMTP server",
          resolveFunction,
        });
        return "allowed";
      } catch (err) {
        return (err as Error).message;
      }
    };
    const unreachable: string =
      "SMTP server host mail.example.com could not be reached.";

    // OneUptime Cloud: one sentence for a name that does not resolve, or resolves privately.
    process.env["BILLING_ENABLED"] = "true";

    expect(await check(fails)).toBe(unreachable);
    expect(await check(resolvesTo("10.0.0.5"))).toBe(unreachable);
    expect(await check(resolvesTo("127.0.0.1"))).toBe(unreachable);
    expect(await check(resolvesTo("169.254.169.254"))).toBe(unreachable);
    expect(await check(resolvesTo("93.184.215.14"))).toBe("allowed");

    // A server given as an IP address is told why, on Cloud too.
    await expect(
      DataSourceEgressGuard.assertHostnameAllowed("10.0.0.5", {
        targetLabel: "SMTP server",
      }),
    ).rejects.toThrow("SMTP server host 10.0.0.5 is not allowed");

    // Self-hosted: private addresses pass, loopback and link-local never, and the message says why.
    delete process.env["BILLING_ENABLED"];

    expect(await check(resolvesTo("10.0.0.5"))).toBe("allowed");
    expect(await check(resolvesTo("127.0.0.1"))).toContain(
      "resolves to 127.0.0.1, which is not allowed",
    );
    expect(await check(resolvesTo("169.254.169.254"))).toContain(
      "resolves to 169.254.169.254, which is not allowed",
    );

    process.env["DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES"] = "true";

    expect(await check(resolvesTo("10.0.0.5"))).not.toBe("allowed");

    expect(page).toContain(
      "On a self-hosted installation, private addresses are allowed unless `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES` is `true`; loopback and link-local addresses are always refused.",
    );
    expect(page).toContain(
      "On a self-hosted installation, and for a mail server given as an IP address, the message says why instead.",
    );
  });

  it("leaves the instance's own server unchecked, as the mail service does", () => {
    expect(readSource("mailService")).toMatch(
      /assertMailServerHostIsAllowed\([\s\S]{0,200}?if \(!emailServer\.id\) \{\s*return null;/,
    );
    expect(page).toContain(
      "The instance's own mail server is not checked this way.",
    );
  });

  it("finds the server's own answer where the logs keep it", () => {
    const tabs: string = readSource("notificationLogsTabs");

    expect(tabs).toMatch(/name: "Email",\s*children: <EmailLogsTable/);
    expect(readSource("emailLogsTable")).toContain(
      'title: "View Status Message",',
    );
    expect(page).toContain(
      "open the **Email** tab of **Project Settings > Notifications > Notification Logs** and select **View Status Message** on its row",
    );
  });

  it("sends through Microsoft Graph as the provider does", () => {
    const provider: string = readSource("graphMailProvider");

    expect(provider).toContain("Mail.Send (Application) permission");
    expect(provider).toContain(
      "POST /users/{fromEmail}/sendMail and the address must be a licensed",
    );
    expect(provider).toContain(
      "Typical scope: https://graph.microsoft.com/.default",
    );
    expect(readSource("smtpFormFields")).toContain(
      "For Microsoft Graph: https://graph.microsoft.com/.default. For Microsoft 365 SMTP+OAuth: https://outlook.office365.com/.default. For Google: https://mail.google.com/",
    );

    expect(page).toContain("**Mail.Send** application permission");
    expect(page).toContain(
      "Mail is sent from the **From Email** mailbox, which must be a licensed mailbox in your tenant.",
    );
    // The Microsoft 365 and Google Workspace settings, in that order.
    expect(
      tableRows(page, "OAuth Scope").map((cells: Array<string>): string => {
        return cells[1] || "";
      }),
    ).toEqual([
      "`https://outlook.office365.com/.default`",
      "`https://mail.google.com/`",
    ]);
  });

  it("lets a status page pick a config where its settings are", () => {
    expect(readSource("statusPageSideMenu")).toContain(
      'title: "Subscriber Settings",',
    );
    expect(readSource("subscriberSettings")).toContain('title: "Custom SMTP",');
    expect(page).toContain(
      "A status page picks its SMTP config on its **Subscriber Settings** page, in the **Custom SMTP** card.",
    );
  });
});

describe("Forms Overview, against the form's menus and routes", () => {
  const page: string = english(FORMS);

  it("lists a form's pages in the order its menu shows them, Duplicate and Delete under Advanced", () => {
    const sections: Array<MenuSection> = jsxMenuSections(
      readSource("formViewSideMenu"),
    );
    const form: MenuSection = sectionOf(sections, "Form");
    const advanced: MenuSection = sectionOf(sections, "Advanced");

    expect(tableFirstCells(page, "## A form's pages")).toEqual([
      ...form.items,
      ...advanced.items,
    ]);
    expect(advanced.items).toEqual(["Duplicate Form", "Delete Form"]);
    expect(page).toContain("| **Duplicate Form** | Under **Advanced**:");
    expect(page).toContain(
      "| **Delete Form** | Deleting the form, under **Advanced**.",
    );

    // The Developer section sits between the two, as on every resource.
    expect(readSource("formViewSideMenu")).toMatch(
      /<\/SideMenuSection>\s*\{getDeveloperSideMenuSection\(\{[\s\S]*?\}\)\}\s*<SideMenuSection title="Advanced">/,
    );
    expect(page).toContain(
      "The **Developer** section of the form's menu holds its Terraform, API and AI assistant pages",
    );
  });

  it("finds every form's submissions in the Forms menu", () => {
    const forms: MenuSection = sectionOf(
      objectMenuSections(readSource("formsSideMenu")),
      "Forms",
    );

    expect(forms.items).toEqual(["Forms", "Submissions"]);
    expect(page).toContain(
      "**Forms → Submissions** lists the submissions of every form in the project.",
    );
  });

  it("gives the product's address and a form's link as the routes spell them", () => {
    const accounts: string = readSource("accountsApp");

    expect(readSource("dashboardRouteMap")).toContain(
      "[PageMap.FORMS]: new Route(`/dashboard/${RouteParams.ProjectID}/forms`),",
    );
    expect(accounts).toContain('path="/accounts/form/:shareKey"');
    expect(accounts).toContain('path="/accounts/incident-form/:shareKey"');
    expect(accounts).toContain(
      "to={`/accounts/form/${encodeURIComponent(shareKey)}`}",
    );

    expect(page).toContain("at `/dashboard/{projectId}/forms`");
    expect(page).toContain(
      "`https://oneuptime.com/accounts/form/<share-key>` on OneUptime Cloud",
    );
    expect(page).toContain(
      "old `/accounts/incident-form/<share-key>` links open the form at its new address",
    );
  });
});

// Keeps the model import honest: every rule model the suite reads is a database model.
describe("the models this suite reads", () => {
  it("are the database models the pages name", () => {
    for (const model of [
      MonitorLabelRule,
      MonitorOwnerRule,
      AlertOwnerRule,
      IncidentLabelRule,
      ProjectSmtpConfig,
      VMwareVCenterLabelRule,
    ]) {
      expect(new model()).toBeInstanceOf(DatabaseBaseModel);
    }
  });
});
