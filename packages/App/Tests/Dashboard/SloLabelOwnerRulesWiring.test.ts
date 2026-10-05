import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Source wiring of the SLO Label Rules and Owner Rules pages. App has no
 * renderer, so the pages are read as text and only their invariants are
 * pinned - what would silently break the product if it drifted:
 *
 *   - each page is the rule table over its own model, with the three legacy
 *     match fields on the "match-criteria" step (that is what makes ModelForm
 *     swap in the condition builder), and its steps and action fields taken
 *     from the shared label and owner rule form (Utils/Form/ResourceRuleForm);
 *   - the pages are reachable: the SLO list's side menu links them, the routes
 *     sit in the list layout where `settings` can never be read as an SLO id,
 *     and every page has breadcrumbs;
 *   - the API is mounted, and every string the pages show is translated.
 *
 * RuleViewPagesWiring.test.ts pins the Run Now view routing of every runnable
 * rule, these two included.
 */

const APP_ROOT: string = path.join(__dirname, "../..");
const DASHBOARD_SRC: string = path.join(APP_ROOT, "FeatureSet/Dashboard/src");
const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

const LABEL_RULES_PAGE: string = "Pages/Slo/Settings/LabelRules.tsx";
const OWNER_RULES_PAGE: string = "Pages/Slo/Settings/OwnerRules.tsx";

const LEGACY_MATCH_FIELDS: Array<string> = [
  "serviceLevelObjectiveLabels",
  "serviceLevelObjectiveNamePattern",
  "serviceLevelObjectiveDescriptionPattern",
];

const LOCALES: Array<string> = [
  "en",
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

function readRaw(relativePath: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8");
}

// Comments removed (they may legitimately mention anything), whitespace squashed.
function readCode(relativePath: string): string {
  return readRaw(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|\s)\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
}

// All whitespace removed, so Prettier can reflow without breaking assertions.
function dense(relativePath: string): string {
  return readRaw(relativePath).replace(/\s+/g, "");
}

function listTsxFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...listTsxFiles(fullPath));
    } else if (entry.name.endsWith(".tsx")) {
      files.push(fullPath);
    }
  }

  return files;
}

// The form fields a page declares for one step, in declaration order.
function fieldsOnStep(code: string, stepId: string): Array<string> {
  const fields: Array<string> = [];
  const fieldPattern: RegExp =
    /field: \{ ([A-Za-z]+): true \},(?:(?!field: \{)[\s\S])*?stepId: "([a-z-]+)"/g;

  for (const match of code.matchAll(fieldPattern)) {
    if (match[2] === stepId) {
      fields.push(match[1]!);
    }
  }

  // The owners people picker: one field for people and teams.
  for (const match of code.matchAll(
    /getOwnersFormField\(\{ stepId: "([a-z-]+)"/g,
  )) {
    if (match[1] === stepId) {
      fields.push("owners");
    }
  }

  return fields;
}

// Every double-quoted English UI string a page hands to the table or form.
function uiStrings(code: string): Array<string> {
  const keys: Array<string> = [
    "title",
    "description",
    "placeholder",
    "sectionTitle",
  ];
  const strings: Set<string> = new Set<string>();

  for (const key of keys) {
    for (const match of code.matchAll(
      new RegExp(`\\b${key}: "([^"]+)"`, "g"),
    )) {
      strings.add(match[1]!);
    }
  }

  return [...strings];
}

interface PageCase {
  name: string;
  page: string;
  table: "LabelRuleTable" | "RuleTable";
  model: string;
  listKey: string;
  viewKey: string;
  tableId: string;
  actionStep: string;
  // The shared form's steps and action fields the page takes.
  stepsHelper: string;
  actionFieldsHelper: string;
}

const PAGES: Array<PageCase> = [
  {
    name: "SLO Label Rules",
    page: LABEL_RULES_PAGE,
    // The label-rule table adds import and export on top of Run Now.
    table: "LabelRuleTable",
    model: "ServiceLevelObjectiveLabelRule",
    listKey: "SLOS_SETTINGS_LABEL_RULES",
    viewKey: "SLOS_SETTINGS_LABEL_RULE_VIEW",
    tableId: "slo-label-rules-table",
    actionStep: "labels",
    stepsHelper: "getLabelRuleFormSteps",
    actionFieldsHelper: "getLabelRuleActionFields",
  },
  {
    name: "SLO Owner Rules",
    page: OWNER_RULES_PAGE,
    table: "RuleTable",
    model: "ServiceLevelObjectiveOwnerRule",
    listKey: "SLOS_SETTINGS_OWNER_RULES",
    viewKey: "SLOS_SETTINGS_OWNER_RULE_VIEW",
    tableId: "slo-owner-rules-table",
    actionStep: "owners",
    stepsHelper: "getOwnerRuleFormSteps",
    actionFieldsHelper: "getOwnerRuleActionFields",
  },
];

describe.each(PAGES)("$name page", (c: PageCase) => {
  const code: string = readCode(c.page);

  test("is the rule table over its own model, typed and bound in the same opening tag", () => {
    expect(dense(c.page)).toContain(
      `<${c.table}<${c.model}>modelType={${c.model}}viewRuleId={RuleViewPageUtil.getViewRuleId(props,${c.model}`,
    );
    expect(code).not.toContain("<ModelTable");
  });

  test("lists at, and views rules at, the SLO settings routes", () => {
    const denseCode: string = dense(c.page);

    // Trailing commas come and go with Prettier's line breaks.
    expect(denseCode.replace(/,\)/g, ")")).toContain(
      `listRoute={RuleViewPageUtil.getListRoute(PageMap.${c.listKey})}`,
    );
    expect(denseCode.replace(/,\)/g, ")")).toContain(
      `returnRuleViewPageUtil.getRuleViewRoute(PageMap.${c.viewKey},rule);`,
    );
  });

  test("offers exactly the three SLO match fields as match criteria", () => {
    expect(fieldsOnStep(code, "match-criteria")).toEqual(LEGACY_MATCH_FIELDS);
  });

  test("takes its steps and what the rule adds from the shared form", () => {
    expect(dense(c.page)).toContain(
      `formSteps={${c.stepsHelper}<${c.model}>()}`,
    );
    expect(dense(c.page)).toContain(
      `...${c.actionFieldsHelper}<${c.model}>(),]}`,
    );
    // Nothing of its own besides the criteria: no Basic Info, no action step.
    expect(fieldsOnStep(code, c.actionStep)).toEqual([]);
    expect(fieldsOnStep(code, "basic-info")).toEqual([]);
    expect(code).not.toContain("formSteps={[");
  });

  test("keeps its table state to itself", () => {
    const matches: number = listTsxFiles(path.join(DASHBOARD_SRC, "Pages"))
      .map((file: string): string => {
        return fs.readFileSync(file, "utf8");
      })
      .filter((source: string): boolean => {
        return source.includes(`"${c.tableId}"`);
      }).length;

    expect(matches).toBe(1);
    expect(code).toContain(`id="${c.tableId}"`);
    expect(code).toContain(`userPreferencesKey="${c.tableId}"`);
    expect(code).toContain(`tableId: "${c.tableId}"`);
  });

  test("shows no string that is missing from any locale", () => {
    const strings: Array<string> = uiStrings(code);

    expect(strings.length).toBeGreaterThan(5);

    for (const locale of LOCALES) {
      const catalog: Record<string, unknown> = JSON.parse(
        fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
      );

      for (const text of strings) {
        // Only the strings this feature introduced carry "SLO".
        if (!text.includes("SLO")) {
          continue;
        }

        expect({ locale, text, translated: typeof catalog[text] }).toEqual({
          locale,
          text,
          translated: "string",
        });
        expect((catalog[text] as string).length).toBeGreaterThan(0);
      }
    }
  });
});

/*
 * What the rule adds is asked by the shared form both pages take
 * (Utils/Form/ResourceRuleForm), so it is read there.
 */
const RESOURCE_RULE_FORM: string = "Utils/Form/ResourceRuleForm.ts";

describe("SLO Owner Rules page form", () => {
  const code: string = readCode(OWNER_RULES_PAGE);
  const shared: string = readCode(RESOURCE_RULE_FORM);

  test("lets the rule turn owner notifications off, on the Owners step", () => {
    expect(shared).toMatch(
      /field: \{ notifyOwners: true \} as unknown as SelectFormFields<TEntity>, title: "Notify Owners", description: OWNER_RULE_NOTIFY_OWNERS_DESCRIPTION, stepId: "owners", fieldType: FormFieldSchemaType\.Toggle,/,
    );
  });

  test("picks people and teams in one owners picker, saying what a match does", () => {
    expect(shared).toContain(
      'getOwnersFormField<TEntity>({ stepId: "owners", required: true, description: OWNER_RULE_OWNERS_DESCRIPTION,',
    );
    // No dropdown per kind any more.
    expect(code).not.toContain("ownerTeams");
    expect(code).not.toContain("ownerUsers");
  });
});

describe("SLO Label Rules page form", () => {
  test("picks labels from the project's labels, for matching and for adding", () => {
    const code: string = readCode(LABEL_RULES_PAGE);
    const shared: string = readCode(RESOURCE_RULE_FORM);

    for (const [source, field] of [
      [code, "serviceLevelObjectiveLabels"],
      [shared, "labelsToAdd"],
    ] as Array<[string, string]>) {
      expect(source).toMatch(
        new RegExp(
          `field: \\{ ${field}: true \\}[^,]*,[\\s\\S]*?dropdownModal: \\{ type: Label, labelField: "name", valueField: "_id", \\}`,
        ),
      );
    }
  });
});

describe("SLO settings navigation", () => {
  test("the SLO list's side menu links both pages under Settings", () => {
    const code: string = readCode("Pages/Slo/SideMenu.tsx");
    // The Settings entry of the menu's `sections`, up to the end of its items.
    const start: number = code.indexOf('{ title: "Settings",');
    const end: number = code.indexOf("], }", start);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const settings: string = code.slice(start, end);

    expect(settings).toMatch(
      /link: \{ title: "Owner Rules", to: RouteUtil\.populateRouteParams\( RouteMap\[PageMap\.SLOS_SETTINGS_OWNER_RULES\] as Route, \), \}, icon: IconProp\.User, \}/,
    );
    expect(settings).toMatch(
      /link: \{ title: "Label Rules", to: RouteUtil\.populateRouteParams\( RouteMap\[PageMap\.SLOS_SETTINGS_LABEL_RULES\] as Route, \), \}, icon: IconProp\.Tag, \}/,
    );
  });

  test("declares the four pages in PageMap", () => {
    const code: string = readCode("Utils/PageMap.ts");

    for (const key of [
      "SLOS_SETTINGS_OWNER_RULES",
      "SLOS_SETTINGS_OWNER_RULE_VIEW",
      "SLOS_SETTINGS_LABEL_RULES",
      "SLOS_SETTINGS_LABEL_RULE_VIEW",
    ]) {
      expect(code).toContain(`${key} = "${key}",`);
    }
  });

  test.each([
    ["SLOS_SETTINGS_OWNER_RULES", '"settings/owner-rules"'],
    [
      "SLOS_SETTINGS_OWNER_RULE_VIEW",
      "`settings/owner-rules/${RouteParams.ModelID}`",
    ],
    ["SLOS_SETTINGS_LABEL_RULES", '"settings/label-rules"'],
    [
      "SLOS_SETTINGS_LABEL_RULE_VIEW",
      "`settings/label-rules/${RouteParams.ModelID}`",
    ],
  ])("routes %s under /slos/%s", (key: string, relativePath: string) => {
    const code: string = dense("Utils/RouteMap.ts");
    const sloRoutePath: string = code.slice(
      code.indexOf("exportconstSloRoutePath"),
    );

    expect(sloRoutePath.slice(0, sloRoutePath.indexOf("};"))).toContain(
      `[PageMap.${key}]:${relativePath},`,
    );
    expect(code).toContain(
      `[PageMap.${key}]:newRoute(\`/dashboard/\${RouteParams.ProjectID}/slos/\${SloRoutePath[PageMap.${key}]}\`,),`,
    );
  });

  /*
   * In the list layout, like Archived: there the static `settings` segment is
   * never taken for an SLO id by the view layout's `:id` route.
   */
  test("mounts all four routes in the SLO list layout, before the SLO view", () => {
    const code: string = dense("Routes/SloRoutes.tsx");
    const listLayout: number = code.indexOf(
      '<PageRoutepath="/"element={<SloLayout{...props}/>}>',
    );
    const viewLayout: number = code.indexOf(
      "<PageRoutepath={SloRoutePath[PageMap.SLO_VIEW]||" + '""}',
    );

    expect(listLayout).toBeGreaterThan(-1);
    expect(viewLayout).toBeGreaterThan(listLayout);

    for (const [key, page, viewModel] of [
      ["SLOS_SETTINGS_OWNER_RULES", "SloSettingsOwnerRules", null],
      [
        "SLOS_SETTINGS_OWNER_RULE_VIEW",
        "SloSettingsOwnerRules",
        "ServiceLevelObjectiveOwnerRule",
      ],
      ["SLOS_SETTINGS_LABEL_RULES", "SloSettingsLabelRules", null],
      [
        "SLOS_SETTINGS_LABEL_RULE_VIEW",
        "SloSettingsLabelRules",
        "ServiceLevelObjectiveLabelRule",
      ],
    ] as Array<[string, string, string | null]>) {
      const route: string = `<PageRoutepath={SloRoutePath[PageMap.${key}]||""}element={<${page}{...props}pageRoute={RouteMap[PageMap.${key}]asRoute}${viewModel ? `ruleViewModelType={${viewModel}}` : ""}/>}/>`;
      const at: number = code.indexOf(route);

      expect({ key, mounted: at > listLayout && at < viewLayout }).toEqual({
        key,
        mounted: true,
      });
    }

    expect(code).toContain(
      'importSloSettingsOwnerRulesfrom"../Pages/Slo/Settings/OwnerRules";',
    );
    expect(code).toContain(
      'importSloSettingsLabelRulesfrom"../Pages/Slo/Settings/LabelRules";',
    );
  });

  test.each([
    ["SLOS_SETTINGS_OWNER_RULES", ["Owner Rules"]],
    ["SLOS_SETTINGS_OWNER_RULE_VIEW", ["Owner Rules", "View Owner Rule"]],
    ["SLOS_SETTINGS_LABEL_RULES", ["Label Rules"]],
    ["SLOS_SETTINGS_LABEL_RULE_VIEW", ["Label Rules", "View Label Rule"]],
  ])("gives %s breadcrumbs", (key: string, trail: Array<string>) => {
    const code: string = dense("Pages/Slo/Utils/Breadcrumbs.ts");
    const titles: string = ["Project", "SLOs", "Settings", ...trail]
      .map((title: string): string => {
        return `"${title.replace(/\s+/g, "")}"`;
      })
      .join(",");

    expect(code).toContain(
      `...BuildBreadcrumbLinksByTitles(PageMap.${key},[${titles},]),`,
    );
  });
});

describe("SLO label and owner rule API", () => {
  test.each([
    ["ServiceLevelObjectiveLabelRule", "ServiceLevelObjectiveLabelRuleService"],
    ["ServiceLevelObjectiveOwnerRule", "ServiceLevelObjectiveOwnerRuleService"],
  ])("mounts the CRUD API for %s", (model: string, service: string) => {
    const code: string = fs
      .readFileSync(path.join(APP_ROOT, "FeatureSet/BaseAPI/Index.ts"), "utf8")
      .replace(/\s+/g, "");

    expect(code).toContain(
      `import${model}from"Common/Models/DatabaseModels/${model}";`,
    );
    expect(code).toContain(
      `newBaseAPI<${model},${service}Type>(${model},${service},).getRouter()`,
    );
  });
});
