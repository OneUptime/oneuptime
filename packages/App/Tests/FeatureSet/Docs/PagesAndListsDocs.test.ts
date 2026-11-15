import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "Common/Types/Docs/DocsLanguage";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ModelEventType from "Common/Types/Realtime/ModelEventType";
import { getRecordNumberColumns } from "Common/Utils/Project/RecordNumber";
import { getLiveRowEventTypes } from "Common/UI/Components/ModelTable/LiveRows";
import Project from "Common/Models/DatabaseModels/Project";
import Permission from "Common/Types/Permission";
import {
  TABLE_BODY_CELL_CLASS_NAME,
  TABLE_DENSITY_COMPACT_ROW_CLASS_NAME,
} from "Common/UI/Components/Table/TableLayout";
import {
  TableFitInput,
  TableFitStep,
  getLeastTableFitStep,
  getNextTableFitStep,
} from "Common/UI/Components/Table/TableFit";
import { drawnDashboardLabel } from "./DocsDashboardLabels";
import { readPage } from "./DocsContentSupport";

/*
 * Home Page & Shortcuts → Finding your way around → Pages and lists says
 * what every page and list does. Markdown is not compiled, so each thing is
 * read here against the code that makes it true:
 *
 *   - its trail example, *Project › Docker › Settings › Owner Rules*, is the
 *     trail Docker's Owner Rules page draws (every page has one:
 *     Common/Tests/App/Dashboard/EveryPageHasATrail);
 *   - the lists of incidents, alerts and episodes keep themselves current:
 *     each of the four kinds is announced as it is created and changed, the
 *     Dashboard listens once signed in, and a table listens unless it is
 *     told not to (UseLiveRows, LiveListsWiring);
 *   - on a phone the chips fold behind Filter, the set ones staying in sight
 *     with Clear all (FacetFilterBar);
 *   - a list's ⋯ has Columns, kept in this browser, which a Project Owner or
 *     Admin may show to everyone in the project (ColumnCustomizationModal,
 *     ProjectDefaultColumns), and Compact rows, for every list
 *     (TableDensity);
 *   - on a phone, or in a card too narrow for its rows, a list is cards, and
 *     the band over them says and changes the order (TableFit,
 *     TableCardsHeader).
 *
 * Every docs language writes the trail's steps and the labels it names as
 * its dashboard draws them.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const DASHBOARD_SRC: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src",
);

const HOME: string = "introduction/home";

function source(...parts: Array<string>): string {
  return fs.readFileSync(path.join(...parts), "utf8");
}

// All whitespace removed, for code Prettier may wrap either way.
function dense(text: string): string {
  return text.replace(/\s+/g, "");
}

// The text from a heading to the next heading of its level or above.
function sectionOf(markdown: string, heading: string): string {
  const start: number = markdown.indexOf(`\n${heading}\n`);
  expect({ heading, found: start > -1 }).toEqual({ heading, found: true });
  const level: string = heading.slice(0, heading.indexOf(" ") + 1);
  const rest: string = markdown.slice(start + heading.length + 2);
  const ends: Array<number> = ["\n## ", level === "### " ? "\n### " : "\n## "]
    .map((marker: string): number => {
      return rest.indexOf(marker);
    })
    .filter((index: number): boolean => {
      return index > -1;
    });

  return rest.slice(0, ends.length ? Math.min(...ends) : undefined);
}

const ENGLISH: string = readPage("en", HOME);
const SECTION: string = sectionOf(ENGLISH, "### Pages and lists");

const TRAIL: Array<string> = ["Project", "Docker", "Settings", "Owner Rules"];

describe("Pages and lists, in English", () => {
  it("sits under Finding your way around, after the bars at the top", () => {
    const finding: string = sectionOf(ENGLISH, "## Finding your way around");

    expect(finding.indexOf("### The bars at the top")).toBeGreaterThan(-1);
    expect(finding.indexOf("### Pages and lists")).toBeGreaterThan(
      finding.indexOf("### The bars at the top"),
    );
  });

  it("gives a trail Docker's Owner Rules page draws", () => {
    expect(SECTION).toContain(`*${TRAIL.join(" › ")}*`);

    const docker: string = source(
      DASHBOARD_SRC,
      "Utils/Breadcrumbs/DockerBreadcrumbs.ts",
    );

    expect(dense(docker)).toContain(
      dense(
        `BuildBreadcrumbLinksByTitles(PageMap.DOCKER_SETTINGS_OWNER_RULES, [${TRAIL.map(
          (step: string): string => {
            return `"${step}",`;
          },
        ).join("")}])`,
      ),
    );
  });

  it("says the lists of incidents, alerts and episodes keep themselves current, and wait while you work", () => {
    expect(SECTION).toContain("**Lists keep themselves current.**");
    expect(SECTION).toContain(
      "the lists of incidents, alerts and episodes show it within seconds, without a refresh",
    );
    expect(SECTION).toContain("such as rows ticked or a dialog open, it waits");

    // Each kind is announced as it is created and as it changes.
    for (const model of [
      new Incident(),
      new Alert(),
      new IncidentEpisode(),
      new AlertEpisode(),
    ] as Array<BaseModel>) {
      expect([model.tableName, getLiveRowEventTypes(model)]).toEqual([
        model.tableName,
        expect.arrayContaining([ModelEventType.Create, ModelEventType.Update]),
      ]);
    }

    // The Dashboard listens once signed in; a table listens unless told not to.
    const index: string = dense(source(DASHBOARD_SRC, "Index.tsx"));
    expect(index).toContain("if(UserUtil.isLoggedIn()){Realtime.init();}");

    const table: string = dense(
      source(REPO_ROOT, "Common/UI/Components/ModelTable/BaseModelTable.tsx"),
    );
    expect(table).toContain("isEnabled:props.isLive!==false");
  });

  it("says the chips fold behind Filter on a phone, the set ones in sight with Clear all", () => {
    expect(SECTION).toContain(
      "**On a phone, the filter chips fold away** behind **Filter**",
    );
    expect(SECTION).toContain(
      "The chips you set stay in sight, with **Clear all**",
    );

    const bar: string = source(
      DASHBOARD_SRC,
      "Components/ResourceOwners/FacetFilterBar.tsx",
    );
    expect(bar).toContain("useIsBelowWidth(PHONE_BELOW_WIDTH_IN_PX)");
    expect(bar).toContain('translator.translateText("Filter")');
    expect(bar).toContain('translator.translateText("Clear all")');

    const styles: string = source(
      DASHBOARD_SRC,
      "Components/ResourceOwners/FilterChipStyles.ts",
    );
    expect(styles).toContain("[&>*:has([data-filter-chip-set=false])]:hidden");
  });
});

/*
 * An incident's pages, and an alert's, a scheduled maintenance event's and
 * an episode's, lead with its number - "INC-42 Checkout is down" - in the
 * heading, the trail and the browser tab: each layout heads its pages with
 * a ModelPage of a model that numbers its records, and ModelPage reads the
 * number with the title (Utils/Project/RecordNumber).
 */
const NUMBERED_LAYOUTS: Array<{ layout: string; model: BaseModel }> = [
  { layout: "Pages/Incidents/View/Layout.tsx", model: new Incident() },
  { layout: "Pages/Alerts/View/Layout.tsx", model: new Alert() },
  {
    layout: "Pages/ScheduledMaintenanceEvents/View/Layout.tsx",
    model: new ScheduledMaintenance(),
  },
  {
    layout: "Pages/Incidents/EpisodeView/Layout.tsx",
    model: new IncidentEpisode(),
  },
  { layout: "Pages/Alerts/EpisodeView/Layout.tsx", model: new AlertEpisode() },
];

describe("Pages and lists says an event's pages lead with its number", () => {
  it("in English, with an example", () => {
    expect(SECTION).toContain("**An incident's pages lead with its number.**");
    expect(SECTION).toContain(
      "Its heading, its step in the trail and the browser tab read `INC-42 Checkout is down`",
    );
    expect(SECTION).toContain(
      "Alerts, maintenance events and episodes do the same.",
    );
  });

  it("each of the five layouts heads its pages with a numbered model's ModelPage", () => {
    for (const numbered of NUMBERED_LAYOUTS) {
      const layout: string = dense(source(DASHBOARD_SRC, numbered.layout));
      const modelName: string = numbered.model.constructor.name;

      expect({
        layout: numbered.layout,
        isModelPage: layout.includes("<ModelPage"),
      }).toEqual({
        layout: numbered.layout,
        isModelPage: true,
      });
      expect(layout).toContain(`modelType={${modelName}}`);
      expect(layout).toContain('modelNameField="title"');
      expect({
        model: numbered.model.tableName,
        numbered: Boolean(getRecordNumberColumns(numbered.model)),
      }).toEqual({ model: numbered.model.tableName, numbered: true });
    }
  });

  it("ModelPage reads the number with the title and heads the page by both", () => {
    const modelPage: string = dense(
      source(REPO_ROOT, "Common/UI/Components/Page/ModelPage.tsx"),
    );

    expect(modelPage).toContain("getRecordNumberColumns(modelInstance)");
    expect(modelPage).toContain(
      "select[numberColumns.numberWithPrefixColumn]=true;",
    );
    expect(modelPage).toContain("recordHeading={recordHeading}");
    expect(modelPage).toContain(
      "recordNumber:shownHeader?shownHeader.recordNumber:undefined",
    );
  });
});

/*
 * A list's ⋯: Columns, which a Project Owner or Admin may show to everyone
 * in the project, and Compact rows; and the band over a list drawn as
 * cards. What each is called, as the code draws it, and what the page says
 * it does.
 */
const TABLE_DIR: string = path.join(REPO_ROOT, "Common/UI/Components/Table");
const MODEL_TABLE_DIR: string = path.join(
  REPO_ROOT,
  "Common/UI/Components/ModelTable",
);

/*
 * The English a source file keeps under a name: a translationKey(...) or a
 * string constant, however Prettier wraps it.
 */
function stringNamed(code: string, name: string): string {
  const match: RegExpMatchArray | null = code.match(
    new RegExp(
      `\\b${name}(?:\\s*:\\s*string)?\\s*[:=]\\s*(?:translationKey\\(\\s*)?"([^"]*)"`,
    ),
  );
  expect({ name, found: Boolean(match) }).toEqual({ name, found: true });
  return (match as RegExpMatchArray)[1] as string;
}

// Tailwind's spacing scale: a step is 4px.
function spacingInPx(className: string, utility: string): number {
  const match: RegExpMatchArray | null = className.match(
    new RegExp(`(?:^|\\s|:)${utility}-(\\d+(?:\\.\\d+)?)(?:\\s|$)`),
  );
  expect({ className, utility, found: Boolean(match) }).toEqual({
    className,
    utility,
    found: true,
  });
  return Number((match as RegExpMatchArray)[1]) * 4;
}

const CARDS_HEADER: string = source(TABLE_DIR, "TableCardsHeader.tsx");
const SORTED_BY: string = stringNamed(CARDS_HEADER, "sortedBy");
const ASCENDING: string = stringNamed(CARDS_HEADER, "ascending");
const DESCENDING: string = stringNamed(CARDS_HEADER, "descending");
const COMPACT_ROWS: string = stringNamed(
  source(TABLE_DIR, "TableDensity.ts"),
  "TABLE_DENSITY_MENU_TEXT",
);
const PROJECT_DEFAULT_COLUMNS_COLUMN: string = stringNamed(
  source(MODEL_TABLE_DIR, "ProjectDefaultColumns.ts"),
  "PROJECT_DEFAULT_COLUMNS_COLUMN",
);

// The labels the section names, in English, as the Dashboard draws them.
const LIST_LABELS: Array<string> = [
  "Columns",
  "Show these columns to everyone in this project",
  "Reset to project default",
  COMPACT_ROWS,
  ASCENDING,
  DESCENDING,
];

// The band's order, for a list sorted by its Name column.
function sortedByName(language: string): string {
  return drawnDashboardLabel(language, SORTED_BY).replace(
    "{{column}}",
    drawnDashboardLabel(language, "Name"),
  );
}

describe("Pages and lists names a list's columns, its rows' height and the cards' order", () => {
  it("says Columns, in a list's ⋯, picks its columns and keeps them in this browser", () => {
    expect(SECTION).toContain(
      "- **Columns**, in a list's **⋯** menu, picks the columns the list shows and their order, and keeps them for you in this browser.",
    );

    // An icon-only button of the header, which the ⋯ holds by this name.
    expect(dense(source(TABLE_DIR, "TableHeaderControls.tsx"))).toContain(
      '[IconProp.TableCells]:translationKey("Columns"),',
    );
    expect(dense(source(MODEL_TABLE_DIR, "BaseModelTable.tsx"))).toContain(
      "icon:IconProp.TableCells,",
    );

    // The person's own columns are a preference, and preferences are kept in the browser.
    expect(dense(source(MODEL_TABLE_DIR, "BaseModelTable.tsx"))).toContain(
      "userPreferenceType:UserPreferenceType.BaseModelTableColumns,",
    );
    expect(source(REPO_ROOT, "Common/Utils/UserPreferences.ts")).toContain(
      'import LocalStorage from "../UI/Utils/LocalStorage";',
    );
  });

  it("says a Project Owner or a Project Admin shows the columns to everyone, and Reset takes yours back to them", () => {
    expect(SECTION).toContain(
      "A Project Owner or a Project Admin can tick **Show these columns to everyone in this project** there too: anyone who hasn't picked their own columns for that list sees them, and **Reset to project default** takes your own back to them.",
    );

    const picker: string = source(
      MODEL_TABLE_DIR,
      "ColumnCustomizationModal.tsx",
    );
    expect(picker).toContain(
      'title="Show these columns to everyone in this project"',
    );
    expect(picker).toContain(
      '"Anyone who hasn\'t picked their own columns for this list sees these."',
    );
    expect(dense(picker)).toContain(
      'props.projectDefault?.hasDefault?"Resettoprojectdefault":"Resettodefault"',
    );

    // Who may tick it: whoever may change the project's column of defaults.
    expect(
      dense(source(MODEL_TABLE_DIR, "ProjectDefaultColumns.ts")),
    ).toContain(
      "PermissionGate.checkColumnUpdate(newProject(),PROJECT_DEFAULT_COLUMNS_COLUMN,).isAllowed",
    );
    expect(
      new Project().getColumnAccessControlFor(PROJECT_DEFAULT_COLUMNS_COLUMN)
        ?.update,
    ).toEqual([Permission.ProjectOwner, Permission.ProjectAdmin]);
  });

  it("says Compact rows draws every list's rows shorter, a fifth more of them in a long list, kept in this browser", () => {
    expect(COMPACT_ROWS).toBe("Compact rows");
    expect(SECTION).toContain(
      "- **Compact rows**, in the same menu, draws every list's rows shorter, so a long list shows about a fifth more of them. It is kept in this browser.",
    );

    // A row is its 24px line and the room above and below it: 48px, or 40px compact.
    const line: number = spacingInPx(TABLE_BODY_CELL_CLASS_NAME, "leading");
    const comfortable: number =
      line + 2 * spacingInPx(TABLE_BODY_CELL_CLASS_NAME, "py");
    const compact: number =
      line + 2 * spacingInPx(TABLE_DENSITY_COMPACT_ROW_CLASS_NAME, "py");

    expect([line, comfortable, compact]).toEqual([24, 48, 40]);
    expect(comfortable / compact).toBe(1.2);

    // One choice for every table: kept for the person, not for a table.
    const density: string = dense(source(TABLE_DIR, "TableDensity.ts"));
    expect(density).toContain(
      "UserPreferences.saveUserPreferenceByTypeAsJSON({key:getPreferenceKey(),userPreferenceType:UserPreferenceType.TableDensity,",
    );
    expect(density).toContain('returnpersonId||"everyone";');
  });

  it("says a list is cards on a phone and in a card too narrow for its rows", () => {
    expect(SECTION).toContain(
      "- **On a phone, or in a card too narrow for its rows, a list is drawn as cards, one per row.**",
    );

    const phone: TableFitInput = {
      isPhone: true,
      boxWidth: 358,
      windowWidth: 390,
      hasFoldableColumns: true,
    };
    // A card of 500px beside a side menu, whose rows do not fit even folded.
    const narrowCard: TableFitInput = {
      isPhone: false,
      boxWidth: 500,
      windowWidth: 900,
      hasFoldableColumns: true,
    };

    expect(getLeastTableFitStep(phone)).toBe(TableFitStep.Cards);
    expect(getNextTableFitStep(TableFitStep.Folded, narrowCard)).toBe(
      TableFitStep.Cards,
    );
    expect(dense(source(TABLE_DIR, "Table.tsx"))).toContain(
      "constisMobile:boolean=fit.step===TableFitStep.Cards;",
    );
  });

  it("says the band over the cards gives their order, and changes it", () => {
    expect([SORTED_BY, ASCENDING, DESCENDING]).toEqual([
      "Sorted by {{column}}",
      "Ascending",
      "Descending",
    ]);
    expect(SECTION).toContain(
      `The band over them says the order they are in, such as **${sortedByName("en")}**: press it to pick the column to sort by, and **${ASCENDING}** or **${DESCENDING}**.`,
    );
    expect(sortedByName("en")).toBe("Sorted by Name");

    // The band's menu: the columns the list sorts by, then the two orders.
    const band: string = dense(CARDS_HEADER);
    expect(band).toContain(
      "title={TABLE_CARDS_HEADER_TEXT.sortBy}>{sortable.map(",
    );
    expect(band).toContain("text={TABLE_CARDS_HEADER_TEXT.ascending}");
    expect(band).toContain("text={TABLE_CARDS_HEADER_TEXT.descending}");
  });
});

describe.each(
  SUPPORTED_DOCS_LANGUAGE_CODES.filter((language: string): boolean => {
    return language !== "en";
  }).map((language: string): [string] => {
    return [language];
  }),
)("Pages and lists, in %s", (language: string) => {
  const page: string = readPage(language, HOME);

  it("writes the trail's steps as its dashboard draws them", () => {
    const trail: string = TRAIL.map((step: string): string => {
      return drawnDashboardLabel(language, step);
    }).join(" › ");

    expect(page).toContain(`*${trail}*`);
  });

  it("gives the numbered heading's example as it is drawn", () => {
    expect(page).toContain("`INC-42 Checkout is down`");
  });

  it("names Filter and Clear all as its dashboard draws them", () => {
    for (const label of ["Filter", "Clear all"]) {
      expect(page).toContain(`**${drawnDashboardLabel(language, label)}**`);
    }
  });

  it("names Columns, the project's default, Compact rows and the two orders as its dashboard draws them", () => {
    for (const label of LIST_LABELS) {
      expect({
        label,
        named: page.includes(`**${drawnDashboardLabel(language, label)}**`),
      }).toEqual({ label, named: true });
    }
  });

  it("gives the cards' order as its dashboard draws it, for a list sorted by Name", () => {
    expect(page).toContain(`**${sortedByName(language)}**`);
  });

  it("says, with the English page, where Columns and Compact rows are and that a list can be cards", () => {
    const trail: string = `*${TRAIL.map((step: string): string => {
      return drawnDashboardLabel(language, step);
    }).join(" › ")}*`;
    const rest: string = page.slice(page.indexOf(trail));
    const section: string = rest.slice(0, rest.indexOf("\n## "));

    // The three bullets sit with the others, before the numbered pages'.
    expect(
      section.indexOf(`**${drawnDashboardLabel(language, "Clear all")}**`),
    ).toBeLessThan(
      section.indexOf(`**${drawnDashboardLabel(language, "Columns")}**`),
    );
    expect(
      section.indexOf(`**${drawnDashboardLabel(language, COMPACT_ROWS)}**`),
    ).toBeLessThan(section.indexOf(`**${sortedByName(language)}**`));
    expect(section.indexOf(`**${sortedByName(language)}**`)).toBeLessThan(
      section.indexOf("`INC-42 Checkout is down`"),
    );
    expect(section).toContain("**⋯**");
  });
});
