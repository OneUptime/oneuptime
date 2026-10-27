import {
  WIDGET_CATALOG,
  WidgetCatalogCategory,
  WidgetCatalogItem,
  getFirstWidget,
  searchWidgetCatalog,
} from "../../../FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/WidgetCatalog";
import {
  aggregateValues,
  getMetricValueWidgetReduce,
} from "../../../FeatureSet/Dashboard/src/Components/Dashboard/Components/ValueWidgetData";
import {
  getValueWidgetTrend,
  ValueWidgetTrend,
  ValueWidgetTrendDirection,
} from "Common/Utils/Dashboard/ValueWidgetSeries";
import { resolveTraceAttributeFilters } from "../../../FeatureSet/Dashboard/src/Components/Dashboard/Components/TraceChartData";
import { getExactAttributeFilters } from "../../../FeatureSet/Dashboard/src/Components/Dashboard/Components/LogChartData";
import {
  DASHBOARD_PICKER_CATEGORIES,
  DashboardPickerTemplate,
  getDashboardPickerTemplates,
  getDashboardTemplateCategoryLabel,
} from "../../../FeatureSet/Dashboard/src/Utils/Dashboard/DashboardTemplatePickerUtil";
import {
  DEVELOPER_DOCS_PAGES,
  DEVELOPER_DOCS_SECTION_TITLE,
  DeveloperDocsPageDefinition,
} from "../../../FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsPages";
import {
  AUTHORING,
  CONFIGURATION,
  DASHBOARDS_INDEX,
  DATA_SOURCES,
  PLAYLISTS,
  SHARING,
  VARIABLES,
  WIDGETS,
} from "./DashboardsDocsPages";
import {
  PlaylistPlayerKeyAction,
  PlaylistPlayerShortcut,
  PlaylistPlayerShortcutGroup,
  getPlaylistPlayerKeyAction,
  getPlaylistPlayerShortcutGroups,
} from "../../../FeatureSet/Dashboard/src/Components/Dashboard/Playlist/PlaylistPlayerKeys";
import { readPage, scanMarkdown } from "./DocsContentSupport";
import { tables } from "./DocsPageShape";
import { boldSpans, escapeRegExp, inlineCode } from "./DocsTranslationChecks";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import DashboardDomain from "Common/Models/DatabaseModels/DashboardDomain";
import DashboardLabelRule from "Common/Models/DatabaseModels/DashboardLabelRule";
import DashboardOwnerRule from "Common/Models/DatabaseModels/DashboardOwnerRule";
import DashboardOwnerTeam from "Common/Models/DatabaseModels/DashboardOwnerTeam";
import DashboardOwnerUser from "Common/Models/DatabaseModels/DashboardOwnerUser";
import DashboardPlaylist from "Common/Models/DatabaseModels/DashboardPlaylist";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DataSource from "Common/Models/DatabaseModels/DataSource";
import PublicDashboardAccessPolicy, {
  PUBLIC_DASHBOARD_NOT_FOUND_MESSAGE,
  PublicDashboardAccess,
} from "Common/Server/Utils/Dashboard/PublicDashboardAccess";
import PublicDashboardViewConfig from "Common/Server/Utils/Dashboard/PublicDashboardViewConfig";
import {
  applyElasticsearchTimeMacros,
  buildElasticsearchSearchUrl,
  parseQueryDsl,
} from "Common/Server/Utils/DataSource/Connectors/ElasticsearchConnector";
import {
  RestApiRequestDescriptor,
  applyRestTimeMacros,
  parseRequestDescriptor,
} from "Common/Server/Utils/DataSource/Connectors/RestApiConnector";
import DataSourceEgressGuard from "Common/Server/Utils/DataSource/EgressGuard";
import SqlQueryGuard from "Common/Server/Utils/DataSource/SqlQueryGuard";
import SqlResultShaper from "Common/Server/Utils/DataSource/SqlResultShaper";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import Includes from "Common/Types/BaseDatabase/Includes";
import IncludesAnyOfGroups from "Common/Types/BaseDatabase/IncludesAnyOfGroups";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import DashboardBaseComponent from "Common/Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import { ComponentArgument } from "Common/Types/Dashboard/DashboardComponents/ComponentArgument";
import { DataSourceValueReduce } from "Common/Types/Dashboard/DashboardComponents/DashboardDataSourceValueComponent";
import { DashboardValueTrendDirection } from "Common/Types/Dashboard/DashboardComponents/DashboardValueComponent";
import DashboardComponentType from "Common/Types/Dashboard/DashboardComponentType";
import DefaultDashboardSize from "Common/Types/Dashboard/DashboardSize";
import {
  DashboardTemplate,
  DashboardTemplateCategory,
  DashboardTemplateType,
  DashboardTemplates,
  RECOMMENDED_DASHBOARD_TEMPLATE_TYPES,
  getDashboardTemplate,
  getTemplateConfig,
} from "Common/Types/Dashboard/DashboardTemplates";
import DashboardVariable, {
  DashboardVariableType,
} from "Common/Types/Dashboard/DashboardVariable";
import DashboardViewConfig, {
  AutoRefreshInterval,
  getAutoRefreshIntervalInMs,
} from "Common/Types/Dashboard/DashboardViewConfig";
import {
  DASHBOARD_TIME_RANGE_FALLBACK,
  DASHBOARD_TIME_RANGE_LINK_PARAMETER,
  DASHBOARD_TIME_RANGE_LINK_VALUES,
  getDashboardLinkTimeRangeFromSearch,
} from "Common/Types/Dashboard/DashboardTimeRange";
import {
  DASHBOARD_AUTO_REFRESH_FALLBACK,
  DASHBOARD_AUTO_REFRESH_INTERVALS,
  DASHBOARD_AUTO_REFRESH_LINK_PARAMETER,
  getDashboardLinkAutoRefreshIntervalFromSearch,
} from "Common/Types/Dashboard/DashboardAutoRefresh";
import { DASHBOARD_MASTER_PASSWORD_COOKIE_MAX_AGE_IN_DAYS } from "Common/Types/Dashboard/MasterPassword";
import {
  DASHBOARD_PLAYLIST_DEFAULT_INTERVAL_IN_SECONDS,
  DASHBOARD_PLAYLIST_INTERVAL_CHOICES_IN_SECONDS,
  DASHBOARD_PLAYLIST_MAX_DASHBOARDS,
  DASHBOARD_PLAYLIST_MAX_INTERVAL_IN_SECONDS,
  DASHBOARD_PLAYLIST_MIN_INTERVAL_IN_SECONDS,
  getDashboardPlaylistDashboardsProblem,
  getDashboardPlaylistIntervalProblem,
} from "Common/Types/Dashboard/DashboardPlaylist";
import {
  DATA_SOURCE_CONNECT_TIMEOUT_IN_MS,
  DATA_SOURCE_MAX_RESPONSE_SIZE_IN_BYTES,
  DATA_SOURCE_MAX_SERIES,
  DATA_SOURCE_MAX_STEP_IN_SECONDS,
  DATA_SOURCE_MAX_TABLE_ROWS,
  DATA_SOURCE_MAX_TIME_SERIES_ROWS,
  DATA_SOURCE_MIN_STEP_IN_SECONDS,
  DATA_SOURCE_QUERY_TIMEOUT_IN_MS,
  DATA_SOURCE_TARGET_BUCKETS,
  DataSourceLimitsUtil,
} from "Common/Types/DataSource/DataSourceLimits";
import DataSourceType, {
  DataSourceTypeCategories,
  DataSourceTypeProps,
  DataSourceTypeUtil,
} from "Common/Types/DataSource/DataSourceType";
import HashedString from "Common/Types/HashedString";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import TimeRange from "Common/Types/Time/TimeRange";
import { MORE_FIELDS_SECTION_TITLE } from "Common/UI/Components/FoldedSection/FoldedSectionTitles";
import { startsCollapsed } from "Common/UI/Components/SideMenu/SideMenuSectionState";
import DashboardComponentsUtil from "Common/Utils/Dashboard/Components/Index";
import DashboardChartComponentUtil from "Common/Utils/Dashboard/Components/DashboardChartComponent";
import DashboardGaugeComponentUtil from "Common/Utils/Dashboard/Components/DashboardGaugeComponent";
import DashboardHtmlComponentUtil from "Common/Utils/Dashboard/Components/DashboardHtmlComponent";
import DashboardValueComponentUtil from "Common/Utils/Dashboard/Components/DashboardValueComponent";
import DashboardViewConfigUtil from "Common/Utils/Dashboard/DashboardViewConfig";
import GridLayoutUtil from "Common/Utils/Dashboard/GridLayout";
import HtmlWidgetDocument from "Common/Utils/Dashboard/HtmlWidgetDocument";
import DashboardLabelVariable from "Common/Utils/Dashboard/LabelVariable";
import {
  SloWidgetSource,
  SloWidgetSourceState,
  resolveSloWidgetSource,
} from "Common/Utils/Dashboard/SloWidgetSource";
import DashboardVariableInterpolation from "Common/Utils/Dashboard/VariableInterpolation";
import DashboardVariableUrlState, {
  VariableUrlSnapshot,
} from "Common/Utils/Dashboard/VariableUrlState";
import DataSourceQueryText from "Common/Utils/DataSource/DataSourceQueryText";
import DataSourceValueReducer from "Common/Utils/DataSource/DataSourceValueReducer";
import MetricFormulaEvaluator from "Common/Utils/Metrics/MetricFormulaEvaluator";
import ModelImportExport from "Common/Utils/ModelImportExport";
import { SLO_METRIC_SLO_NAME_ATTRIBUTE } from "Common/Utils/Slo/SloMetricType";
import ValueFormatter from "Common/Utils/ValueFormatter";
import { afterEach, describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the English Dashboards pages say about the product, held to the code
 * that makes it true (docs overhaul task 26a).
 *
 * Markdown is not compiled, so nothing else notices when a side menu gains a
 * page, a template or a widget joins the catalog, a default moves, a limit
 * changes or the read-only SQL guard learns a new rule while the pages keep
 * the old words. Each test reads the source of truth - a model's access
 * control and plans, the widget catalog and each widget's settings, the
 * variable, data source and public dashboard utilities the product runs, or
 * a Dashboard page read as text (an App test must not render a React page) -
 * and checks the page still says what it does. Where the code is a pure
 * function, the test runs it on the page's own example: the SQL sample
 * passes the guard, the variable link parses to the variable it names, a
 * title with {{UNIT}} reads as the page says.
 *
 * DashboardsDocsTranslations holds the sixteen other languages to these
 * pages. The Sharing page's choices, plans, password and custom domains are
 * held by DashboardSharingDocs, DashboardCustomDomainsDocs and
 * CustomDomainPermissionsDocs; this suite adds what a visitor goes through.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");

const DASHBOARD_APP: string = "App/FeatureSet/Dashboard/src";
const DASHBOARDS_PAGES_DIR: string = `${DASHBOARD_APP}/Pages/Dashboards`;
const DASHBOARD_COMPONENTS_DIR: string = `${DASHBOARD_APP}/Components/Dashboard`;
const WIDGET_COMPONENTS_DIR: string = `${DASHBOARD_COMPONENTS_DIR}/Components`;

const DASHBOARDS_LIST: string = `${DASHBOARDS_PAGES_DIR}/Dashboards.tsx`;
const DASHBOARDS_LIST_MENU: string = `${DASHBOARDS_PAGES_DIR}/SideMenu.tsx`;
const DASHBOARD_MENU: string = `${DASHBOARDS_PAGES_DIR}/View/SideMenu.tsx`;
const DASHBOARD_SETTINGS: string = `${DASHBOARDS_PAGES_DIR}/View/Settings.tsx`;
const DASHBOARD_VIEW: string = `${DASHBOARD_COMPONENTS_DIR}/DashboardView.tsx`;
const TOOLBAR: string = `${DASHBOARD_COMPONENTS_DIR}/Toolbar/DashboardToolbar.tsx`;
const ADD_WIDGET_DIALOG: string = `${DASHBOARD_COMPONENTS_DIR}/Toolbar/AddWidgetModal.tsx`;
const VARIABLES_DIALOG: string = `${DASHBOARD_COMPONENTS_DIR}/Toolbar/DashboardVariablesModal.tsx`;
const SETTINGS_DIALOG: string = `${DASHBOARD_COMPONENTS_DIR}/Canvas/ComponentSettingsModal.tsx`;
const GAUGE_WIDGET: string = `${WIDGET_COMPONENTS_DIR}/DashboardGaugeComponent.tsx`;
const VALUE_VIEW: string = `${WIDGET_COMPONENTS_DIR}/ValueWidgetView.tsx`;
const DATA_SOURCE_PLACEHOLDER: string = `${WIDGET_COMPONENTS_DIR}/DataSourceWidgetPlaceholder.tsx`;
const RESOURCE_OWNERS: string = `${DASHBOARD_APP}/Components/ResourceOwners/useResourceOwners.tsx`;
const DASHBOARD_ROUTES: string = `${DASHBOARD_APP}/Utils/RouteMap.ts`;
const ENTERPRISE_ELIGIBILITY: string = `${DASHBOARD_APP}/Enterprise/EnterpriseEligibility.ts`;
const DATA_SOURCES_PAGE: string = `${DASHBOARDS_PAGES_DIR}/Settings/DataSources.tsx`;
const DATA_SOURCE_VIEW: string = `${DASHBOARDS_PAGES_DIR}/Settings/DataSourceView.tsx`;
const DATA_SOURCE_TYPE_PICKER: string = `${DASHBOARD_APP}/Components/DataSource/DataSourceTypeSelectModal.tsx`;
const DATA_SOURCE_QUERY_EDITOR: string = `${DASHBOARD_COMPONENTS_DIR}/Canvas/DataSourceQueryEditor.tsx`;
const PLAYLISTS_PAGES_DIR: string = `${DASHBOARDS_PAGES_DIR}/Playlists`;
const PLAYLISTS_LIST: string = `${PLAYLISTS_PAGES_DIR}/Playlists.tsx`;
const PLAYLIST_VIEW: string = `${PLAYLISTS_PAGES_DIR}/PlaylistView.tsx`;
const PLAYLIST_FORM_FIELDS: string = `${PLAYLISTS_PAGES_DIR}/PlaylistFormFields.tsx`;
const PLAYLIST_COMPONENTS_DIR: string = `${DASHBOARD_COMPONENTS_DIR}/Playlist`;
const PLAYLIST_PLAYER: string = `${PLAYLIST_COMPONENTS_DIR}/PlaylistPlayer.tsx`;
const PLAYLIST_PLAYER_BAR: string = `${PLAYLIST_COMPONENTS_DIR}/PlaylistPlayerBar.tsx`;
const PLAYLIST_DASHBOARDS_FIELD: string = `${PLAYLIST_COMPONENTS_DIR}/PlaylistDashboardsField.tsx`;
const USE_PLAYLIST_PLAYER: string = `${PLAYLIST_COMPONENTS_DIR}/UsePlaylistPlayer.ts`;
const ATTRIBUTE_SERVICE: string =
  "Common/Server/Services/TelemetryAttributeService.ts";
const ATTRIBUTE_LIMITS: string =
  "Common/Types/Telemetry/AttributeSuggestionLimits.ts";
const PUBLIC_RESOURCE_LISTS: string =
  "Common/Server/Utils/Dashboard/PublicDashboardResourceListPolicy.ts";
const DATA_SOURCE_CONNECTORS: string =
  "Common/Server/Utils/DataSource/Connectors";

/*
 * What a widget's "not available on public dashboards" note says in its
 * place: the components that write one, read as text.
 */
const NOT_ON_PUBLIC_DASHBOARDS: string = "not available on public dashboards";

// A widget's component file, named for its type: DashboardLogChartComponent.tsx.
const WIDGET_COMPONENT_FILE: RegExp = /^Dashboard(\w+)Component\.tsx$/;

const NUMBER_WORDS: ReadonlyArray<string> = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
];

// The project roles a permissions table names in words, by permission.
const ROLE_PERMISSIONS: ReadonlyArray<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.SettingsViewer,
];

const SETTINGS_ROLES: ReadonlyArray<Permission> = [
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.SettingsViewer,
];

interface MenuSection {
  title: string;
  items: Array<string>;
  collapsed: boolean;
}

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relativePath), "utf8");
}

function englishPage(page: string): string {
  return readPage("en", page);
}

// The text of a "## " or "### " section, up to the next heading of its level or above.
function sectionOf(markdown: string, heading: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.indexOf(heading);

  expect({ heading: heading, found: start >= 0 }).toEqual({
    heading: heading,
    found: true,
  });

  const level: number = heading.indexOf(" ");
  const body: Array<string> = [];

  for (const line of lines.slice(start + 1)) {
    const match: RegExpMatchArray | null = line.match(/^(#+) /);

    if (match && (match[1] as string).length <= level) {
      break;
    }

    body.push(line);
  }

  return body.join("\n");
}

// "a, b and c" (or "a, b or c"): a list as the pages write one.
function listOf(items: ReadonlyArray<string>, conjunction: string): string {
  if (items.length <= 1) {
    return items.join("");
  }

  return `${items.slice(0, -1).join(", ")} ${conjunction} ${
    items[items.length - 1]
  }`;
}

function bold(name: string): string {
  return `**${name}**`;
}

// A table's rows, without its header row.
function rowsOf(table: Array<Array<string>> | undefined): Array<Array<string>> {
  return (table || []).slice(1);
}

function column(
  table: Array<Array<string>> | undefined,
  index: number,
): Array<string> {
  return rowsOf(table).map((row: Array<string>): string => {
    return row[index] || "";
  });
}

function isCollapsed(title: string, explicit: string | undefined): boolean {
  return startsCollapsed({
    title: title,
    defaultCollapsed: explicit === undefined ? undefined : explicit === "true",
  });
}

/*
 * The Dashboards list's side menu: a `sections` array, each section's title
 * indented less than its links' titles. The Developer section the menu adds
 * (addDeveloperSideMenuSection) is not in the array.
 */
function dashboardsListMenu(): Array<MenuSection> {
  const source: string = readSource(DASHBOARDS_LIST_MENU);
  const lines: Array<RegExpMatchArray> = source
    .split("\n")
    .map((line: string): RegExpMatchArray | null => {
      return line.match(/^(\s*)title: "([^"]+)",$/);
    })
    .filter((match: RegExpMatchArray | null): match is RegExpMatchArray => {
      return match !== null;
    });
  const sectionIndent: number = Math.min(
    ...lines.map((match: RegExpMatchArray): number => {
      return (match[1] as string).length;
    }),
  );
  const sections: Array<MenuSection> = [];

  for (const match of lines) {
    const title: string = match[2] as string;

    if ((match[1] as string).length === sectionIndent) {
      const block: string = source.slice(source.indexOf(`title: "${title}",`));
      const explicit: RegExpMatchArray | null = block
        .slice(0, block.indexOf("items:"))
        .match(/defaultCollapsed: (true|false)/);

      sections.push({
        title: title,
        items: [],
        collapsed: isCollapsed(title, explicit ? explicit[1] : undefined),
      });
      continue;
    }

    sections[sections.length - 1]?.items.push(title);
  }

  return sections;
}

/*
 * A dashboard's own side menu, read from source: each <SideMenuSection>
 * with the titles of its links, and the Developer section the menu adds
 * where it calls getDeveloperSideMenuSection.
 */
function dashboardMenu(): Array<MenuSection> {
  const source: string = readSource(DASHBOARD_MENU);
  const marks: Array<{ at: number; section?: MenuSection; item?: string }> = [];

  for (const match of source.matchAll(
    /<SideMenuSection\s+title="([^"]+)"([^>]*)>/g,
  )) {
    const title: string = match[1] as string;
    const explicit: RegExpMatchArray | null = (match[2] as string).match(
      /defaultCollapsed=\{(true|false)\}/,
    );

    marks.push({
      at: match.index as number,
      section: {
        title: title,
        items: [],
        collapsed: isCollapsed(title, explicit ? explicit[1] : undefined),
      },
    });
  }

  for (const match of source.matchAll(/getDeveloperSideMenuSection\(/g)) {
    marks.push({
      at: match.index as number,
      section: {
        title: DEVELOPER_DOCS_SECTION_TITLE,
        items: DEVELOPER_DOCS_PAGES.map(
          (page: DeveloperDocsPageDefinition): string => {
            return page.title;
          },
        ),
        collapsed: isCollapsed(DEVELOPER_DOCS_SECTION_TITLE, undefined),
      },
    });
  }

  for (const match of source.matchAll(/title: "([^"]+)",/g)) {
    marks.push({ at: match.index as number, item: match[1] as string });
  }

  const sections: Array<MenuSection> = [];

  for (const mark of marks.sort(
    (
      a: { at: number; section?: MenuSection; item?: string },
      b: { at: number; section?: MenuSection; item?: string },
    ): number => {
      return a.at - b.at;
    },
  )) {
    if (mark.section) {
      sections.push(mark.section);
    } else if (mark.item) {
      sections[sections.length - 1]?.items.push(mark.item);
    }
  }

  return sections;
}

function argumentNames(type: DashboardComponentType): Array<string> {
  return DashboardComponentsUtil.getComponentSettingsArguments(type).map(
    (argument: ComponentArgument<DashboardBaseComponent>): string => {
      return argument.name;
    },
  );
}

function argumentOptionLabels(
  type: DashboardComponentType,
  name: string,
): Array<string> {
  const argument: ComponentArgument<DashboardBaseComponent> | undefined =
    DashboardComponentsUtil.getComponentSettingsArguments(type).find(
      (item: ComponentArgument<DashboardBaseComponent>): boolean => {
        return item.name === name;
      },
    );

  expect({ type: type, setting: name, found: Boolean(argument) }).toEqual({
    type: type,
    setting: name,
    found: true,
  });

  return (argument?.dropdownOptions || []).map(
    (option: { label: string }): string => {
      return option.label;
    },
  );
}

function catalogCategory(name: string): WidgetCatalogCategory {
  const category: WidgetCatalogCategory | undefined = WIDGET_CATALOG.find(
    (item: WidgetCatalogCategory): boolean => {
      return item.name === name;
    },
  );

  expect({ category: name, found: Boolean(category) }).toEqual({
    category: name,
    found: true,
  });

  return category as WidgetCatalogCategory;
}

function labelsOf(category: WidgetCatalogCategory): Array<string> {
  return category.items.map((item: WidgetCatalogItem): string => {
    return item.label;
  });
}

function catalogLabel(type: DashboardComponentType): string {
  for (const category of WIDGET_CATALOG) {
    for (const item of category.items) {
      if (item.type === type) {
        return item.label;
      }
    }
  }

  throw new Error(`No catalog widget draws ${type}`);
}

// "5 seconds", "1 minute": an interval as the pages say it.
function spokenDuration(milliseconds: number): string {
  if (milliseconds % 60000 === 0) {
    const minutes: number = milliseconds / 60000;

    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }

  const seconds: number = milliseconds / 1000;

  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

const TIME_RANGE_UNITS: Readonly<Record<string, string>> = {
  Mins: "minutes",
  Hour: "hour",
  Hours: "hours",
  Day: "day",
  Days: "days",
  Week: "week",
  Weeks: "weeks",
  Month: "month",
  Months: "months",
};

// "Past 5 Mins" -> "the past 5 minutes", "Past 1 Hour" -> "the past hour".
function spokenTimeRange(range: string): string {
  const match: RegExpMatchArray | null = range.match(/^Past (\d+) (\w+)$/);

  expect({ range: range, readable: Boolean(match) }).toEqual({
    range: range,
    readable: true,
  });

  const count: number = Number(match?.[1]);
  const unit: string = TIME_RANGE_UNITS[match?.[2] as string] as string;

  return count === 1 ? `the past ${unit}` : `the past ${count} ${unit}`;
}

function presetTimeRanges(): Array<string> {
  return Object.values(TimeRange).filter((range: string): boolean => {
    return range !== TimeRange.CUSTOM;
  });
}

function refreshIntervals(): Array<number> {
  return Object.values(AutoRefreshInterval)
    .map((interval: AutoRefreshInterval): number | null => {
      return getAutoRefreshIntervalInMs(interval);
    })
    .filter((milliseconds: number | null): milliseconds is number => {
      return milliseconds !== null;
    });
}

// The titles of the roles in a permission list, and its other permissions.
function rolesAndGrants(permissions: ReadonlyArray<Permission>): {
  roles: Array<string>;
  grants: Array<string>;
} {
  return {
    roles: permissions
      .filter((permission: Permission): boolean => {
        return ROLE_PERMISSIONS.includes(permission);
      })
      .map((permission: Permission): string => {
        return PermissionHelper.getTitle(permission);
      })
      .sort(),
    grants: permissions
      .filter((permission: Permission): boolean => {
        return !ROLE_PERMISSIONS.includes(permission);
      })
      .map((permission: Permission): string => {
        return permission.toString();
      })
      .sort(),
  };
}

/*
 * The roles a permissions table cell names: each role's title, and "a
 * Settings role" for all three Settings roles.
 */
function rolesNamedIn(cell: string): Array<string> {
  const named: Array<string> = [];

  for (const permission of ROLE_PERMISSIONS) {
    const title: string = PermissionHelper.getTitle(permission);

    if (
      new RegExp(`(^|[^\\w])${escapeRegExp(title)}([^\\w]|$)`).test(cell) ||
      (SETTINGS_ROLES.includes(permission) && cell.includes("a Settings role"))
    ) {
      named.push(title);
    }
  }

  return named.sort();
}

function codeSpansIn(text: string): Array<string> {
  return inlineCode(text);
}

function telemetryVariable(data: {
  name: string;
  attributeKey: string;
  selectedValue?: string | undefined;
  selectedValues?: Array<string> | undefined;
  defaultValue?: string | undefined;
  isMultiSelect?: boolean | undefined;
}): DashboardVariable {
  return {
    id: `${data.name}-id`,
    name: data.name,
    type: DashboardVariableType.TelemetryAttribute,
    attributeKey: data.attributeKey,
    selectedValue: data.selectedValue,
    selectedValues: data.selectedValues,
    defaultValue: data.defaultValue,
    isMultiSelect: data.isMultiSelect,
  };
}

// The UNIT variable of the variables page: two project labels to pick from.
const UNIT_0660: string = ObjectID.generate().toString();
const UNIT_0661: string = ObjectID.generate().toString();
const NETWORK_LABEL: string = ObjectID.generate().toString();

function unitVariable(data: {
  selectedValue?: string | undefined;
  selectedValues?: Array<string> | undefined;
  isMultiSelect?: boolean | undefined;
}): DashboardVariable {
  return {
    id: "unit-id",
    name: "UNIT",
    type: DashboardVariableType.ProjectLabel,
    labelOptions: [
      { label: "0660", value: UNIT_0660 },
      { label: "0661", value: UNIT_0661 },
    ],
    selectedValue: data.selectedValue,
    selectedValues: data.selectedValues,
    isMultiSelect: data.isMultiSelect,
  };
}

function fenceCode(page: string, title: string): string {
  const fence: { info: string; code: string } | undefined = scanMarkdown(
    englishPage(page),
  ).fences.find((item: { info: string }): boolean => {
    return item.info.includes(`title="${title}"`);
  });

  expect({ page: page, sample: title, found: Boolean(fence) }).toEqual({
    page: page,
    sample: title,
    found: true,
  });

  return (fence?.code || "").trim();
}

function guardRefusal(sql: string): string | null {
  try {
    SqlQueryGuard.assertReadOnlyQuery(sql);
    return null;
  } catch (error: unknown) {
    return (error as Error).message;
  }
}

// A source file's text from one marker up to the next occurrence of another.
function sliceOf(source: string, from: string, to: string): string {
  const start: number = source.indexOf(from);

  expect({ marker: from, found: start >= 0 }).toEqual({
    marker: from,
    found: true,
  });

  const end: number = source.indexOf(to, start + from.length);

  return source.slice(start, end < 0 ? undefined : end);
}

function modelPermissions(
  model: BaseModel,
  action: "create" | "read" | "update" | "delete",
): Array<Permission> {
  switch (action) {
    case "create":
      return model.createRecordPermissions;
    case "read":
      return model.readRecordPermissions;
    case "update":
      return model.updateRecordPermissions;
    case "delete":
      return model.deleteRecordPermissions;
  }
}

describe("Dashboards Overview, against the product", () => {
  const page: string = englishPage(DASHBOARDS_INDEX);
  const findSection: string = sectionOf(page, "## Find your dashboards");

  it("describes the Dashboards list: its columns, its search, its two filters and what selecting does", () => {
    const list: string = readSource(DASHBOARDS_LIST);

    expect(list).toContain('searchableFields={["name", "description"]}');
    expect(findSection).toContain("Search by name or description");

    for (const title of ["Name", "Description", "Labels", "Owners"]) {
      expect(list).toContain(`title: "${title}",`);
    }
    expect(findSection).toContain(
      "shows the project's dashboards with their descriptions, labels and owners",
    );

    expect(list).toContain("showLabelsFacet: true");
    expect(readSource(RESOURCE_OWNERS)).toContain('label="Owner"');
    expect(readSource(RESOURCE_OWNERS)).toContain('label="Labels"');
    expect(findSection).toContain(
      `narrow the list with the ${bold("Owner")} and ${bold("Labels")} filters`,
    );

    for (const bulk of [
      "...labelBulkActions",
      "...ownerBulkActions",
      "...archiveBulkActions",
    ]) {
      expect(list).toContain(bulk);
    }
    expect(list).toContain("enableJsonImportExport={true}");
    expect(findSection).toContain(
      "select several dashboards to change their labels or owners, archive them or export them as JSON",
    );
    expect(findSection).toContain(bold("Import JSON"));
  });

  it("lists the list's side menu pages, section by section, in the menu's order", () => {
    const expected: Array<string> = dashboardsListMenu().flatMap(
      (section: MenuSection): Array<string> => {
        return section.items.map((item: string): string => {
          return section.title === item
            ? bold(item)
            : bold(`${section.title} → ${item}`);
        });
      },
    );

    expect(expected.length).toBeGreaterThanOrEqual(5);
    expect(column(tables(findSection)[0], 0)).toEqual(expected);
  });

  it("lists a dashboard's own side menu pages in the menu's order, the Developer pages aside", () => {
    const menu: Array<MenuSection> = dashboardMenu();
    const titles: Array<string> = menu.map((section: MenuSection): string => {
      return section.title;
    });

    // The Developer section (Terraform, API, AI assistants) is every model's, not the dashboard's.
    expect(titles).toContain(DEVELOPER_DOCS_SECTION_TITLE);

    const expected: Array<string> = menu
      .filter((section: MenuSection): boolean => {
        return section.title !== DEVELOPER_DOCS_SECTION_TITLE;
      })
      .flatMap((section: MenuSection): Array<string> => {
        return section.items.map(bold);
      });

    expect(expected.length).toBeGreaterThanOrEqual(9);
    expect(column(tables(findSection)[1], 0)).toEqual(expected);
  });

  it("says every section of a dashboard's side menu but Basic starts folded", () => {
    const folded: Array<{ title: string; collapsed: boolean }> =
      dashboardMenu().map(
        (section: MenuSection): { title: string; collapsed: boolean } => {
          return { title: section.title, collapsed: section.collapsed };
        },
      );

    expect(folded).toEqual(
      folded.map(
        (section: {
          title: string;
          collapsed: boolean;
        }): { title: string; collapsed: boolean } => {
          return { title: section.title, collapsed: section.title !== "Basic" };
        },
      ),
    );
    expect(findSection).toContain(
      `Every section but ${bold("Basic")} starts folded`,
    );
  });

  it("states the time range every visit starts at, and the auto-refresh intervals' span, as the dashboard has them", () => {
    const terms: Array<Array<string>> = rowsOf(tables(page)[0]);
    const meaning: (term: string) => string = (term: string): string => {
      return (
        terms.find((row: Array<string>): boolean => {
          return row[0] === term;
        })?.[1] || ""
      );
    };
    const intervals: Array<number> = refreshIntervals();

    // A dashboard opens on its own default, else the past hour (issue #5080).
    expect(DASHBOARD_TIME_RANGE_FALLBACK).toBe(TimeRange.PAST_ONE_HOUR);
    expect(meaning("Time range")).toContain(
      `A dashboard opens on its default, ${spokenTimeRange(
        DASHBOARD_TIME_RANGE_FALLBACK,
      )} unless an editor sets another, and each viewer can pick their own.`,
    );
    expect(meaning("Auto-refresh")).toContain(
      `off, or every ${spokenDuration(
        Math.min(...intervals),
      )} to ${spokenDuration(Math.max(...intervals))}`,
    );
  });

  it("walks an on-call example whose variable reaches the chart, the value and the log stream, and not the incident list", () => {
    const example: string = sectionOf(
      page,
      "## An example: an on-call dashboard",
    );
    const service: DashboardVariable = telemetryVariable({
      name: "service",
      attributeKey: "service.name",
      defaultValue: "checkout",
      selectedValue: "payments",
    });

    expect(example).toContain(
      `the source ${DashboardVariableType.TelemetryAttribute} and the attribute key \`service.name\``,
    );
    expect(example).toContain(
      "the chart, the value and the log stream switch to the payments service, and the incident list keeps showing every unresolved incident",
    );

    // The chart and the value narrow their metric query by the attribute.
    for (const widget of [
      "DashboardChartComponent.tsx",
      "DashboardValueComponent.tsx",
    ]) {
      expect(readSource(`${WIDGET_COMPONENTS_DIR}/${widget}`)).toContain(
        "DashboardVariableInterpolation.applyToQueryConfig",
      );
    }

    // The log stream's filter takes the picked service.
    expect(
      DashboardVariableInterpolation.applyToAttributes({}, [service]),
    ).toEqual({ "service.name": "payments" });
    expect(
      readSource(`${WIDGET_COMPONENTS_DIR}/DashboardLogStreamComponent.tsx`),
    ).toContain("DashboardVariableInterpolation.applyToAttributes");

    // The incident list reads no variable, in the app or on a public dashboard.
    expect(
      readSource(`${WIDGET_COMPONENTS_DIR}/DashboardIncidentListComponent.tsx`),
    ).not.toContain("Interpolation");
    expect(
      sliceOf(
        readSource(PUBLIC_RESOURCE_LISTS),
        "private static buildIncidentPolicy(",
        "private static build",
      ),
    ).not.toContain("attributeToColumn");
  });
});

describe("Authoring a Dashboard, against the product", () => {
  const page: string = englishPage(AUTHORING);

  it("lists every template under the picker's category, in the picker's order", () => {
    const expected: Array<Array<string>> = DASHBOARD_PICKER_CATEGORIES.map(
      (category: DashboardTemplateCategory): Array<string> => {
        return [
          getDashboardTemplateCategoryLabel(category),
          getDashboardPickerTemplates()
            .filter((template: DashboardPickerTemplate): boolean => {
              return template.category === category;
            })
            .map((template: DashboardPickerTemplate): string => {
              return template.name;
            })
            .join(", "),
        ];
      },
    );

    expect(rowsOf(tables(page)[0])).toEqual(expected);
    // Every template the picker lists, each once: Blank is Start from scratch.
    expect(
      rowsOf(tables(page)[0]).flatMap((row: Array<string>): Array<string> => {
        return (row[1] as string).split(", ");
      }),
    ).toHaveLength(
      DashboardTemplates.filter((template: DashboardTemplate): boolean => {
        return template.type !== DashboardTemplateType.Blank;
      }).length,
    );
  });

  it("says the dialog opens on Start from scratch and the recommended templates, and names them in the picker's order", () => {
    const create: string = sectionOf(page, "## Create a dashboard");
    const recommended: Array<string> = RECOMMENDED_DASHBOARD_TEMPLATE_TYPES.map(
      (type: DashboardTemplateType): string => {
        return getDashboardTemplate(type)!.name;
      },
    );

    expect(create).toContain(
      `The ${bold("Create a dashboard")} dialog opens on ${bold(
        "Start from scratch",
      )}`,
    );
    expect(create).toContain(
      `${bold("Or start from a template")} lists ${
        NUMBER_WORDS[recommended.length]
      } ${bold("Recommended")} templates`,
    );
    expect(page).toContain(
      `${bold("Recommended")} holds ${listOf(recommended, "and")}.`,
    );
    expect(page).not.toContain("Blank Dashboard");
    expect(page).not.toContain("Create from Template");
  });

  it("names the dialog's words as the dialog draws them", () => {
    const wizard: string = readSource(
      `${DASHBOARD_COMPONENTS_DIR}/CreateDashboardModal.tsx`,
    );
    const step: string = readSource(
      `${DASHBOARD_APP}/Components/TemplatePicker/TemplatePicker.tsx`,
    );
    const rules: string = readSource(
      `${DASHBOARD_APP}/Utils/TemplatePicker/TemplatePickerUtil.ts`,
    );
    const details: string = readSource(
      `${DASHBOARD_COMPONENTS_DIR}/DashboardTemplatePicker.tsx`,
    );

    expect(wizard).toContain('title="Create a dashboard"');
    expect(wizard).toContain('submitButtonText="Create Dashboard"');
    expect(wizard).toContain('nextButtonText: "Use this template"');
    // Every form's More fields, by its shared title.
    expect(wizard).toContain("title={MORE_FIELDS_SECTION_TITLE}");
    expect(MORE_FIELDS_SECTION_TITLE).toBe("More fields");
    expect(wizard).toContain('title="Back"');
    expect(step).toContain('tx("Start from scratch")');
    expect(step).toContain('tx("Or start from a template")');
    expect(step).toContain('tx("Search templates…")');
    expect(rules).toContain('label: "Recommended"');
    expect(rules).toContain('label: "All templates"');
    expect(details).toContain('tx("Widgets")');
    expect(details).toContain('tx("Variables")');

    for (const words of [
      bold("Use this template"),
      bold("Search templates…"),
      bold("All templates"),
      bold("More fields"),
      bold("Back"),
    ]) {
      expect(sectionOf(page, "## Create a dashboard")).toContain(words);
    }
  });

  it("names the permissions to create and to edit, and says members and viewers read without them", () => {
    const dashboard: Dashboard = new Dashboard();
    const before: string = sectionOf(page, "## Before you begin");

    expect(dashboard.createRecordPermissions).toEqual(
      expect.arrayContaining([
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.CreateDashboard,
      ]),
    );
    expect(dashboard.updateRecordPermissions).toEqual(
      expect.arrayContaining([
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.EditDashboard,
      ]),
    );
    expect(dashboard.readRecordPermissions).toEqual(
      expect.arrayContaining([Permission.ProjectMember, Permission.Viewer]),
    );

    for (const reader of [Permission.ProjectMember, Permission.Viewer]) {
      expect(dashboard.createRecordPermissions).not.toContain(reader);
      expect(dashboard.updateRecordPermissions).not.toContain(reader);
    }

    expect(before).toContain(
      "Project owners and admins can create and edit every dashboard.",
    );
    expect(before).toContain(
      `\`${Permission.CreateDashboard}\` to create dashboards, and \`${Permission.EditDashboard}\` to change them`,
    );
    expect(before).toContain(
      "Project members and viewers can read dashboards without either.",
    );
  });

  it("says Edit Dashboard stays in the ⋯ menu, locked, for someone who may not edit", () => {
    const toolbar: string = readSource(TOOLBAR);
    const editItem: string = sliceOf(
      toolbar,
      'text={"Edit Dashboard"}',
      "onClick",
    );

    expect(editItem).toContain("isDisabled={!props.canEditDashboard}");
    expect(editItem).toContain("props.editDashboardDisabledReason");
    expect(sectionOf(page, "## Before you begin")).toContain(
      `opens its ${bold("⋯")} menu, where ${bold(
        "Edit Dashboard",
      )} is locked and says which permission it needs`,
    );
  });

  it("names the ⋯ menu's items and the edit mode's controls as the toolbar draws them", () => {
    const toolbar: string = readSource(TOOLBAR);
    const editAndSave: string = sectionOf(page, "## Edit and save");

    for (const item of ["Edit Dashboard", "Full Screen", "Share"]) {
      expect(toolbar).toContain(`text={"${item}"}`);
    }
    expect(page).toContain(`${bold("⋯ → Full Screen")}`);

    for (const control of [
      "Editing",
      "Add Widget",
      "Variables",
      "Cancel",
      "Save Changes",
    ]) {
      expect(toolbar).toContain(`translator.translateText("${control}")`);
      expect(editAndSave).toContain(bold(control));
    }

    expect(toolbar).toContain('submitButtonText={"Discard Changes"}');
    expect(toolbar).toContain('closeButtonText={"Keep Editing"}');
    expect(editAndSave).toContain(
      `${bold("Discard Changes")} goes back to the dashboard as it was saved, and ${bold(
        "Keep Editing",
      )} returns to your work`,
    );
  });

  it("says saving stores the defaults set while editing, and editing pauses auto-refresh and drops a zoom", () => {
    const view: string = readSource(DASHBOARD_VIEW);
    const editAndSave: string = sectionOf(page, "## Edit and save");

    /*
     * The board as edited, its defaults included - and no longer the
     * auto-refresh the editor last picked while viewing (issue #5080).
     */
    expect(view).toContain(
      "const configToSave: DashboardViewConfig = dashboardViewConfig;",
    );
    expect(view).not.toContain("refreshInterval: autoRefreshInterval");
    expect(editAndSave).toContain(
      `${bold(
        "Save Changes",
      )} saves the widgets, their places and sizes, the variables, and the default time range and auto-refresh, all at once`,
    );
    expect(editAndSave).toContain(
      `with a row below them for the dashboard's ${bold(
        "Default time range",
      )} and ${bold("Default auto-refresh")}.`,
    );

    expect(view).toContain(
      "// Don't auto-refresh in edit mode\n    if (dashboardMode === DashboardMode.Edit) {\n      return;\n    }",
    );
    expect(
      sliceOf(view, "timeRangeZoom.resetZoom();", "};").includes(
        "setDashboardMode(DashboardMode.Edit);",
      ),
    ).toBe(true);
    expect(editAndSave).toContain(
      "While you edit, auto-refresh pauses, and a zoomed time range goes back to the range you picked.",
    );
  });

  it("finds the widgets the page's search words find, and adds the first match on Enter", () => {
    expect(page).toContain('("error budget", "pods")');

    expect(getFirstWidget(searchWidgetCatalog("error budget"))?.type).toBe(
      DashboardComponentType.Slo,
    );
    expect(getFirstWidget(searchWidgetCatalog("pods"))?.type).toBe(
      DashboardComponentType.KubernetesPodList,
    );

    const dialog: string = readSource(ADD_WIDGET_DIALOG);

    expect(dialog).toContain('event.key !== "Enter"');
    expect(dialog).toContain("getFirstWidget(visibleCategories)");
    expect(page).toContain("press Enter to add the first match");
  });

  it("places a picked widget at the first free spot that fits it, with its settings open", () => {
    const empty: DashboardViewConfig =
      DashboardViewConfigUtil.createDefaultDashboardViewConfig();
    const one: DashboardViewConfig =
      DashboardViewConfigUtil.addComponentToDashboard({
        component: DashboardChartComponentUtil.getDefaultComponent(),
        dashboardViewConfig: empty,
      });
    const two: DashboardViewConfig =
      DashboardViewConfigUtil.addComponentToDashboard({
        component: DashboardChartComponentUtil.getDefaultComponent(),
        dashboardViewConfig: one,
      });
    const three: DashboardViewConfig =
      DashboardViewConfigUtil.addComponentToDashboard({
        component: DashboardChartComponentUtil.getDefaultComponent(),
        dashboardViewConfig: two,
      });
    const places: Array<Array<number>> = three.components.map(
      (component: DashboardBaseComponent): Array<number> => {
        return [component.topInDashboardUnits, component.leftInDashboardUnits];
      },
    );

    // Two six-column charts side by side, the third under them.
    expect(places).toEqual([
      [0, 0],
      [0, 6],
      [3, 0],
    ]);
    expect(
      sliceOf(
        readSource(DASHBOARD_VIEW),
        "DashboardViewConfigUtil.addComponentToDashboard({",
        "}}",
      ),
    ).toContain("setSelectedComponentId(newComponent.componentId);");
    expect(sectionOf(page, "## Add a widget")).toContain(
      "The widget lands at the first free spot on the grid that fits it, and its settings open.",
    );
  });

  it("names the settings dialog's preview and buttons as it draws them", () => {
    const dialog: string = readSource(SETTINGS_DIALOG);

    expect(dialog).toContain('translator.translateText("Live Preview")');
    expect(dialog).toContain('closeButtonText="Done"');
    expect(dialog).toContain("title={`Duplicate Widget`}");
    expect(dialog).toContain("title={`Delete Widget`}");

    for (const name of [
      "Live Preview",
      "Done",
      "Duplicate Widget",
      "Delete Widget",
    ]) {
      expect(page).toContain(bold(name));
    }
  });

  it("gives the grid's width and the smallest chart and number as the widgets have them", () => {
    const chart: DashboardBaseComponent =
      DashboardChartComponentUtil.getDefaultComponent();
    const value: DashboardBaseComponent =
      DashboardValueComponentUtil.getDefaultComponent();
    const grid: string = sectionOf(page, "## Widgets on the grid");

    // The canvas and the layout that places widgets agree on the width.
    expect(GridLayoutUtil.DefaultColumns).toBe(
      DefaultDashboardSize.widthInDashboardUnits,
    );
    expect(grid).toContain(
      `a grid ${
        NUMBER_WORDS[DefaultDashboardSize.widthInDashboardUnits]
      } columns wide`,
    );
    expect(grid).toContain(
      `a chart is at least ${
        NUMBER_WORDS[chart.minWidthInDashboardUnits]
      } columns wide and ${
        NUMBER_WORDS[chart.minHeightInDashboardUnits]
      } rows high`,
    );
    expect({
      width: value.minWidthInDashboardUnits,
      height: value.minHeightInDashboardUnits,
    }).toEqual({ width: 1, height: 1 });
    expect(grid).toContain("a single number fits in one cell");
  });

  it("spans the time range presets and starts every visit where the dashboard does", () => {
    const presets: Array<string> = presetTimeRanges();
    const timeRange: string = sectionOf(page, "## Time range and auto-refresh");

    expect(timeRange).toContain(
      `Pick a preset from ${spokenTimeRange(
        presets[0] as string,
      )} to ${spokenTimeRange(presets[presets.length - 1] as string)}`,
    );
    expect(timeRange).toContain(
      `The dashboard opens on its default time range: ${spokenTimeRange(
        DASHBOARD_TIME_RANGE_FALLBACK,
      )}, unless an editor sets another.`,
    );
    expect(DASHBOARD_AUTO_REFRESH_FALLBACK).toBe(AutoRefreshInterval.OFF);
    expect(timeRange).toContain(
      "The dashboard opens with its default auto-refresh: off, unless an editor sets another.",
    );
  });

  it("lists every auto-refresh interval the menu offers", () => {
    const spoken: Array<string> = refreshIntervals().map(spokenDuration);

    expect(spoken.length).toBeGreaterThanOrEqual(6);
    expect(sectionOf(page, "## Time range and auto-refresh")).toContain(
      `reads every widget again every ${listOf(spoken, "or")}`,
    );
  });
});

describe("Dashboard Widgets, against the widget catalog and the widgets' settings", () => {
  const page: string = englishPage(WIDGETS);
  const pageBold: Array<string> = boldSpans(page);

  it("names every widget of the catalog in bold, the External Data Sources group as its own section", () => {
    const missing: Array<string> = WIDGET_CATALOG.filter(
      (category: WidgetCatalogCategory): boolean => {
        return category.name !== "External Data Sources";
      },
    )
      .flatMap(labelsOf)
      .filter((label: string): boolean => {
        return !pageBold.includes(label);
      });

    expect(missing).toEqual([]);
    expect(page).toContain("## External data sources");
    expect(sectionOf(page, "## External data sources")).toContain(
      `The External Data Sources group draws ${listOf(
        labelsOf(catalogCategory("External Data Sources")).map(
          (label: string): string => {
            return `a ${bold(label)}`;
          },
        ),
        "or",
      )} from a system that OneUptime does not own`,
    );
  });

  it("answers each question of the chooser with widgets the catalog has", () => {
    const catalogLabels: Array<string> = WIDGET_CATALOG.flatMap(labelsOf);
    const answers: Array<string> = boldSpans(
      column(tables(page)[0], 1).join("\n"),
    );

    expect(answers.length).toBeGreaterThanOrEqual(15);
    expect(
      answers.filter((label: string): boolean => {
        return !catalogLabels.includes(label);
      }),
    ).toEqual([]);
  });

  it("describes the Metrics group's four widgets under Charts and numbers, and the Essentials under Text, clock and HTML", () => {
    const metrics: Array<string> = labelsOf(catalogCategory("Metrics"));
    const essentials: WidgetCatalogCategory = catalogCategory("Essentials");

    expect(metrics).toEqual(["Chart", "Value", "Gauge", "Table"]);
    for (const label of metrics) {
      expect(sectionOf(page, "## Charts and numbers")).toContain(
        `### ${label}`,
      );
    }
    expect(sectionOf(page, "## Charts and numbers")).toContain(
      `These ${NUMBER_WORDS[metrics.length]} widgets read a metric query`,
    );

    for (const label of labelsOf(essentials)) {
      expect(sectionOf(page, "## Text, clock and HTML")).toContain(
        `### ${label}`,
      );
    }
    expect(essentials.description).toContain("do not need a data source");
    expect(sectionOf(page, "## Text, clock and HTML")).toContain(
      "These widgets need no data source.",
    );
  });

  it("names the settings each widget's section calls in bold, as that widget's settings", () => {
    const settingsBySection: Array<{
      heading: string;
      type: DashboardComponentType;
      settings: Array<string>;
    }> = [
      {
        heading: "### Chart",
        type: DashboardComponentType.Chart,
        settings: ["Chart Type", "Additional Queries", "Formulas"],
      },
      {
        heading: "### Value",
        type: DashboardComponentType.Value,
        settings: [
          "Trend Direction",
          "Warning Threshold",
          "Critical Threshold",
        ],
      },
      {
        heading: "### Gauge",
        type: DashboardComponentType.Gauge,
        settings: ["Warning Threshold", "Critical Threshold"],
      },
      {
        heading: "### Table",
        type: DashboardComponentType.Table,
        settings: [
          "Group By Attributes",
          "Metrics & Columns",
          "Reduce across time",
        ],
      },
      {
        heading: "### Text",
        type: DashboardComponentType.Text,
        settings: ["Markdown"],
      },
      {
        heading: "#### Permissions",
        type: DashboardComponentType.Html,
        settings: [
          "Run JavaScript",
          "Open links in a new tab",
          "Allow forms to submit",
        ],
      },
    ];

    for (const entry of settingsBySection) {
      const section: string = sectionOf(page, entry.heading);

      for (const setting of entry.settings) {
        expect({
          widget: entry.type,
          inSection: section.includes(bold(setting)),
        }).toEqual({
          widget: entry.type,
          inSection: true,
        });
        expect(argumentNames(entry.type)).toContain(setting);
      }
    }

    for (const type of [
      DashboardComponentType.MonitorList,
      DashboardComponentType.SloList,
    ]) {
      expect(argumentNames(type)).toContain("Label Variable");
    }
    expect(page).toContain(
      `or a ${bold("Label Variable")} that viewers pick in the toolbar`,
    );
  });

  it("names the chart types the Chart Type setting offers", () => {
    const kinds: Array<string> = argumentOptionLabels(
      DashboardComponentType.Chart,
      "Chart Type",
    ).map((label: string): string => {
      return label.replace(/ Chart$/, "").toLowerCase();
    });

    expect(kinds).toEqual(["line", "bar", "area", "stacked area", "pie"]);
    expect(sectionOf(page, "### Chart")).toContain(
      `draws it as a ${listOf(kinds, "or")} chart`,
    );
  });

  it("combines queries with the operators the formula evaluator knows, as in the page's example", () => {
    const chart: string = sectionOf(page, "### Chart");
    const operators: Array<string> = ["+", "-", "*", "/", "%", "^"];

    expect(chart).toContain(
      `combine them with ${operators
        .map((operator: string): string => {
          return `\`${operator}\``;
        })
        .join(", ")} and parentheses, as in \`(1 - a) * 100\``,
    );

    for (const operator of operators) {
      expect(
        MetricFormulaEvaluator.validateFormula({
          formula: `(a ${operator} b) * 2`,
          availableVariables: ["a", "b"],
        }),
      ).toBeNull();
    }
    expect(
      MetricFormulaEvaluator.validateFormula({
        formula: "(1 - a) * 100",
        availableVariables: ["a"],
      }),
    ).toBeNull();
  });

  it("reduces a Value as the page says: summed for a sum or a count, the highest, the lowest, else the mean", () => {
    const values: Array<number> = [1, 2, 6];

    expect(aggregateValues(values, AggregationType.Sum)).toBe(9);
    expect(aggregateValues(values, AggregationType.Count)).toBe(9);
    expect(aggregateValues(values, AggregationType.Max)).toBe(6);
    expect(aggregateValues(values, AggregationType.Min)).toBe(1);
    expect(aggregateValues(values, AggregationType.Avg)).toBe(3);
    expect(aggregateValues(values, AggregationType.P95)).toBe(3);

    expect(sectionOf(page, "### Value")).toContain(
      "summed for a sum or a count, the highest for a max, the lowest for a min, and the mean otherwise",
    );
  });

  it("compares the halves of the range as the page says: each worked out like the value, both named on the arrow", () => {
    const values: Array<number> = [1, 2, 6];

    // Each half is reduced with the widget's own reduction.
    for (const type of Object.values(AggregationType)) {
      expect(getMetricValueWidgetReduce(type)(values)).toBe(
        aggregateValues(values, type),
      );
    }

    // The two halves are of the time range, oldest first whatever the API's order.
    const trend: ValueWidgetTrend | null = getValueWidgetTrend({
      points: [
        { timestamp: new Date("2026-10-15T12:00:00.000Z"), value: 30 },
        { timestamp: new Date("2026-10-15T10:00:00.000Z"), value: 10 },
      ],
      reduce: getMetricValueWidgetReduce(AggregationType.Sum),
      isAdditive: true,
      windowStart: new Date("2026-10-15T10:00:00.000Z"),
      windowEnd: new Date("2026-10-15T14:00:00.000Z"),
      bucketWidthMs: 60 * 60 * 1000,
    });
    expect([trend?.direction, trend?.percent]).toEqual([
      ValueWidgetTrendDirection.Up,
      200,
    ]);

    /*
     * The arrow's tooltip names both halves; the sparkline's hover reads a
     * point's time, named as precisely as its bucket.
     */
    const view: string = readSource(VALUE_VIEW);
    expect(view).toContain('translator.translateTemplate("First half")');
    expect(view).toContain('translator.translateTemplate("Second half")');
    expect(view).toContain(
      "getDashboardBucketLabel(hoveredPoint.timestamp, bucketWidthMs)",
    );

    const value: string = sectionOf(page, "### Value");
    expect(value).toContain(
      "An arrow compares the second half of the range with the first, each half worked out the same way",
    );
    expect(value).toContain(
      "Point at the arrow to see both halves' values, and at the sparkline to read any point's value and time.",
    );
  });

  it("gives Trend Direction's three choices", () => {
    expect(Object.values(DashboardValueTrendDirection)).toEqual([
      DashboardValueTrendDirection.Auto,
      DashboardValueTrendDirection.HigherIsBetter,
      DashboardValueTrendDirection.HigherIsWorse,
    ]);
    expect(sectionOf(page, "### Value")).toContain(
      "whether a higher value is better or worse, or read from the metric's name",
    );
  });

  it("gives the Gauge's range when none is set", () => {
    const gauge: { arguments: JSONObject } =
      DashboardGaugeComponentUtil.getDefaultComponent() as unknown as {
        arguments: JSONObject;
      };
    const view: string = readSource(GAUGE_WIDGET);

    expect([gauge.arguments["minValue"], gauge.arguments["maxValue"]]).toEqual([
      0, 100,
    ]);
    expect(view).toContain(
      "minValue={props.component.arguments.minValue ?? 0}",
    );
    expect(view).toContain(
      "maxValue={props.component.arguments.maxValue ?? 100}",
    );
    expect(sectionOf(page, "### Gauge")).toContain(
      "0 and 100 unless you set them",
    );
  });

  it("lists what Reduce across time turns a table row into", () => {
    const reductions: Array<string> = argumentOptionLabels(
      DashboardComponentType.Table,
      "Reduce across time",
    );

    expect(reductions).toEqual(["Last value", "Average", "Sum", "Min", "Max"]);
    expect(sectionOf(page, "### Table")).toContain(
      "turns each row's series into one value: the last value, the average, the sum, the minimum or the maximum",
    );
  });

  it("describes the Clock's faces, its label's example and the viewer's own time zone", () => {
    const clock: string = sectionOf(page, "### Clock");
    const label: ComponentArgument<DashboardBaseComponent> | undefined =
      DashboardComponentsUtil.getComponentSettingsArguments(
        DashboardComponentType.Clock,
      ).find((argument: ComponentArgument<DashboardBaseComponent>): boolean => {
        return argument.name === "Label";
      });

    expect(
      argumentOptionLabels(DashboardComponentType.Clock, "Clock Face"),
    ).toEqual(["Digital", "Analog"]);
    expect(clock).toContain("as digits or an analog dial");
    expect(clock).toContain(`with a label such as "${label?.placeholder}"`);
    expect(
      readSource(
        "Common/Utils/Dashboard/Components/DashboardClockComponent.ts",
      ),
    ).toContain("Leave empty to use the timezone of whoever is viewing");
    expect(clock).toContain(
      "Left without a time zone, it shows each viewer's own.",
    );
  });

  it("gives the HTML widget's three switches and their defaults", () => {
    const html: { arguments: JSONObject } =
      DashboardHtmlComponentUtil.getDefaultComponent() as unknown as {
        arguments: JSONObject;
      };
    const permissions: string = sectionOf(page, "#### Permissions");

    expect(sectionOf(page, "### HTML")).toContain(
      `an optional script and ${
        NUMBER_WORDS[argumentNames(DashboardComponentType.Html).length - 3]
      } permission switches`,
    );
    expect(permissions).toContain(
      `${bold("Run JavaScript")} (${html.arguments["allowScripts"] ? "on" : "off"} by default)`,
    );
    expect(permissions).toContain(
      `${bold("Open links in a new tab")} (${html.arguments["allowPopups"] ? "on" : "off"} by default)`,
    );
    expect(permissions).toContain(
      `${bold("Allow forms to submit")} (${html.arguments["allowForms"] ? "on" : "off"} by default)`,
    );
  });

  it("keeps the HTML widget in a sandbox with no way to the page, as the page promises", () => {
    for (const allowScripts of [true, false]) {
      for (const allowForms of [true, false]) {
        for (const allowPopups of [true, false]) {
          const sandbox: string = HtmlWidgetDocument.getSandboxAttribute({
            allowScripts,
            allowForms,
            allowPopups,
          });

          expect(sandbox).not.toContain("allow-same-origin");
          expect(sandbox).not.toContain("allow-top-navigation");
        }
      }
    }

    const scriptless: string = HtmlWidgetDocument.build({
      html: "<p>hi</p>",
      javascript: "document.title = 'x';",
      allowScripts: false,
    });

    expect(scriptless).not.toContain("<script");
    expect(sectionOf(page, "#### Permissions")).toContain(
      "the script is then left out of the widget entirely rather than merely blocked",
    );

    expect(scriptless).toContain('<base target="_blank" />');
    expect(sectionOf(page, "#### Permissions")).toContain(
      "Links always open in a new tab",
    );

    expect(scriptless).toContain("background: transparent;");
    expect(page).toContain("The widget starts transparent.");
  });

  it("fills {{name}} with a variable's value, leaves an unknown one as it is, and hands scripts window.ONEUPTIME", () => {
    const environment: DashboardVariable = telemetryVariable({
      name: "environment",
      attributeKey: "deployment.environment",
      selectedValue: "prod",
    });
    const unset: DashboardVariable = telemetryVariable({
      name: "region",
      attributeKey: "cloud.region",
    });
    const start: Date = new Date(Date.UTC(2026, 9, 13, 9, 0, 0));
    const end: Date = new Date(Date.UTC(2026, 9, 13, 10, 0, 0));

    expect(
      HtmlWidgetDocument.interpolate(
        "{{environment}} {{missing}}",
        HtmlWidgetDocument.resolveVariables([environment]),
      ),
    ).toBe("prod {{missing}}");
    expect(page).toContain(
      "A placeholder naming a variable that does not exist is left as-is.",
    );

    const context: JSONObject = HtmlWidgetDocument.getContext({
      variables: [environment, unset],
      startDate: start,
      endDate: end,
    }) as unknown as JSONObject;

    expect(context).toEqual({
      variables: { environment: "prod", region: "" },
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    });

    // The page's code sample reads only what the context holds.
    const sample: string = fenceCode(WIDGETS, "window.ONEUPTIME");
    const keys: Array<string> = Array.from(
      sample.matchAll(/window\.ONEUPTIME\.(\w+)/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(keys.length).toBeGreaterThanOrEqual(3);
    expect(
      keys.filter((key: string): boolean => {
        return !Object.keys(context).includes(key);
      }),
    ).toEqual([]);
    expect(sample).toContain('// current value, or "" if unset');
    expect(sample).toContain("// ISO 8601 string");
  });

  it("lists the Logs, Traces and Security groups' widgets in its table, and what they count", () => {
    const expected: Array<string> = ["Logs", "Traces", "Security"]
      .flatMap((name: string): Array<string> => {
        return labelsOf(catalogCategory(name));
      })
      .map(bold)
      .sort();

    expect(
      [
        ...column(
          tables(sectionOf(page, "## Logs, traces and security"))[0],
          0,
        ),
      ].sort(),
    ).toEqual(expected);

    for (const data of ["TraceChartData.ts", "TraceTableData.ts"]) {
      expect(readSource(`${WIDGET_COMPONENTS_DIR}/${data}`)).toContain(
        "rootOnly: !args.includeChildSpans,",
      );
    }
    expect(sectionOf(page, "## Logs, traces and security")).toContain(
      "The trace widgets count root spans only, as the traces explorer does, unless you include child spans in their settings.",
    );
  });

  it("gives the Log Chart's and the Trace Chart's choices as their settings offer them", () => {
    const table: Array<Array<string>> = rowsOf(
      tables(sectionOf(page, "## Logs, traces and security"))[0],
    );
    const rowOf: (widget: string) => string = (widget: string): string => {
      return (
        table.find((row: Array<string>): boolean => {
          return row[0] === bold(widget);
        })?.[1] || ""
      );
    };

    expect(
      argumentOptionLabels(DashboardComponentType.LogChart, "Chart Type"),
    ).toEqual(["Bar Chart", "Line Chart", "Area Chart"]);
    expect(rowOf("Log Chart")).toContain("as bars, lines or areas");

    expect(
      argumentOptionLabels(DashboardComponentType.TraceChart, "Metric"),
    ).toEqual([
      "Request Count",
      "Error Count",
      "Avg Response Time",
      "Median Response Time (P50)",
      "P90 Response Time",
      "P95 Response Time",
      "P99 Response Time",
      "Min Response Time",
      "Max Response Time",
    ]);
    expect(rowOf("Trace Chart")).toContain(
      "Request count, error count or response time (average, minimum, maximum, P50 to P99)",
    );
  });

  it("lists the incident, alert and monitor widgets, their lifecycle filter and the honeycomb under View Mode", () => {
    const section: string = sectionOf(
      page,
      "## Incidents, alerts and monitors",
    );
    const expected: Array<string> = ["Incidents", "Alerts", "Monitors"]
      .flatMap((name: string): Array<string> => {
        return labelsOf(catalogCategory(name));
      })
      .map(bold);

    expect(column(tables(section)[0], 0)).toEqual(expected);

    for (const type of [
      DashboardComponentType.IncidentList,
      DashboardComponentType.AlertList,
    ]) {
      expect(argumentOptionLabels(type, "Lifecycle State")).toEqual([
        "All",
        "Unresolved (open)",
        "Acknowledged",
        "Resolved",
      ]);
    }
    expect(section).toContain("Unresolved, acknowledged or resolved");

    for (const type of [
      DashboardComponentType.IncidentList,
      DashboardComponentType.AlertList,
      DashboardComponentType.MonitorList,
    ]) {
      expect(argumentOptionLabels(type, "View Mode")).toContain("Honeycomb");
    }
    expect(section).toContain(
      `draw a honeycomb of cells colored by status instead of a table: pick it under ${bold(
        "View Mode",
      )}`,
    );
  });

  it("gives the SLO widget's three numbers and two displays", () => {
    const slo: string = sectionOf(page, "### SLO");
    const metrics: Array<string> = argumentOptionLabels(
      DashboardComponentType.Slo,
      "Metric",
    ).map((label: string): string => {
      // "SLI (Service Level Indicator)": the page names it by its short name.
      return label.split(" (")[0] as string;
    });
    const displays: Array<string> = argumentOptionLabels(
      DashboardComponentType.Slo,
      "Display As",
    );

    expect(metrics).toEqual(["SLI", "Error Budget Remaining", "Burn Rate"]);
    expect(slo).toContain(
      `which of its ${NUMBER_WORDS[metrics.length]} numbers (${metrics
        .slice(0, -1)
        .join(", ")}, or ${metrics[metrics.length - 1]})`,
    );
    expect(displays).toEqual(["Tile", "Chart"]);
    expect(slo).toContain(`${listOf(displays, "or")} display`);
  });

  it("lists every Infrastructure group's widgets, in the catalog's order", () => {
    const section: string = sectionOf(page, "## Infrastructure");
    const expected: Array<Array<string>> = WIDGET_CATALOG.filter(
      (category: WidgetCatalogCategory): boolean => {
        return (
          category.group === "Infrastructure" && category.name !== "Network"
        );
      },
    ).map((category: WidgetCatalogCategory): Array<string> => {
      return [bold(category.name), ...labelsOf(category).map(bold)];
    });
    const written: Array<Array<string>> = rowsOf(tables(section)[0]).map(
      (row: Array<string>): Array<string> => {
        return [
          row[0] as string,
          ...Array.from((row[1] as string).matchAll(/\*\*([^*]+)\*\*/g)).map(
            (match: RegExpMatchArray): string => {
              return bold(match[1] as string);
            },
          ),
        ];
      },
    );

    expect(written).toEqual(expected);
    expect(labelsOf(catalogCategory("Network"))).toEqual(["Network Map"]);
    expect(section).toContain("### Network Map");
  });

  it("lists the Network Map's settings as the widget has them", () => {
    expect(argumentNames(DashboardComponentType.NetworkMap)).toEqual([
      "Title",
      "View Mode",
      "Max Sites",
      "Show Site Names",
      "Site Types",
      "Status",
    ]);
    expect(sectionOf(page, "### Network Map")).toContain(
      `${bold(
        "Settings",
      )}: title, map or list view, maximum sites drawn, whether to print site names, and filters by site type and by status`,
    );
  });

  it("names the widgets a public dashboard cannot show, and drops the External Data Sources ones", () => {
    const refusing: Array<string> = fs
      .readdirSync(path.join(PACKAGES_DIR, WIDGET_COMPONENTS_DIR))
      .filter((file: string): boolean => {
        return (
          WIDGET_COMPONENT_FILE.test(file) &&
          readSource(`${WIDGET_COMPONENTS_DIR}/${file}`).includes(
            NOT_ON_PUBLIC_DASHBOARDS,
          )
        );
      })
      .map((file: string): string => {
        return catalogLabel(
          file.match(WIDGET_COMPONENT_FILE)?.[1] as DashboardComponentType,
        );
      });
    const publicSection: string = sectionOf(page, "## On a public dashboard");
    const refusingLine: string =
      publicSection.split("\n").find((line: string): boolean => {
        return line.endsWith(
          "say in their place that they are not available on public dashboards.",
        );
      }) || "";

    expect(refusing.length).toBeGreaterThanOrEqual(5);
    expect(boldSpans(refusingLine).sort()).toEqual([...refusing].sort());

    // The data source widgets never reach the visitor: the config drops them.
    const config: DashboardViewConfig = {
      _type: "DashboardViewConfig",
      heightInDashboardUnits: 10,
      components: [
        { componentType: DashboardComponentType.DataSourceChart },
        { componentType: DashboardComponentType.DataSourceTable },
        { componentType: DashboardComponentType.Chart },
      ],
    } as unknown as DashboardViewConfig;
    const served: Array<string> = (
      PublicDashboardViewConfig.sanitize(config)?.components || []
    ).map((component: DashboardBaseComponent): string => {
      return component.componentType;
    });

    expect(served).toEqual([DashboardComponentType.Chart]);
    expect(readSource(DATA_SOURCE_PLACEHOLDER)).toContain(
      `External data sources are ${NOT_ON_PUBLIC_DASHBOARDS}`,
    );
    expect(publicSection).toContain(
      "The External Data Sources widgets are left out of a public dashboard altogether, because their settings are the query itself.",
    );
  });
});

describe("Dashboard Variables & Filters, against the variable code", () => {
  const page: string = englishPage(VARIABLES);
  const dialog: string = readSource(VARIABLES_DIALOG);

  it("lists the four sources in the Source picker's order, and which allow multi-select", () => {
    const picker: string = sliceOf(dialog, 'ariaLabel="Variable source"', "]");
    const offered: Array<string> = Array.from(
      picker.matchAll(/DashboardVariableType\.(\w+),/g),
    ).map((match: RegExpMatchArray): string => {
      return DashboardVariableType[
        match[1] as keyof typeof DashboardVariableType
      ];
    });
    const table: Array<Array<string>> | undefined = tables(
      sectionOf(page, "## Variable sources"),
    )[0];

    expect(offered).toEqual([
      DashboardVariableType.TelemetryAttribute,
      DashboardVariableType.ProjectLabel,
      DashboardVariableType.CustomList,
      DashboardVariableType.TextInput,
    ]);
    expect(column(table, 0)).toEqual(offered);

    // Multi-select is off, and locked, for a text box.
    expect(dialog).toContain(
      "variable.type === DashboardVariableType.TextInput ||\n                variable.type === DashboardVariableType.Query",
    );
    expect(column(table, 2)).toEqual(
      offered.map((source: string): string => {
        return source === DashboardVariableType.TextInput ? "No" : "Yes";
      }),
    );
  });

  it("starts a new variable on Telemetry Attribute, and keeps an old Query variable only where it is one", () => {
    expect(sliceOf(dialog, "const addVariable", "};")).toContain(
      "type: DashboardVariableType.TelemetryAttribute,",
    );
    expect(page).toContain(
      `Click ${bold("Add Variable")}. A new variable reads a telemetry attribute`,
    );
    expect(dialog).toContain(
      "...(variable.type === DashboardVariableType.Query\n                ? [DashboardVariableType.Query]",
    );
    expect(page).toContain(
      "A Query variable from an older dashboard is kept, and shows a text box in the toolbar",
    );
  });

  it("names the dialog, its buttons and its fields as the dialog draws them", () => {
    expect(dialog).toContain('title="Dashboard Variables"');
    expect(dialog).toContain('title="Add Variable"');
    expect(dialog).toContain('submitButtonText="Save Variables"');

    for (const field of [
      "Name",
      "Label",
      "Default",
      "Allow multi-select",
      "Source",
      "Attribute Key",
    ]) {
      expect(dialog).toContain(`translator.translateText("${field}")`);
      expect(page).toContain(bold(field));
    }

    for (const name of [
      "Dashboard Variables",
      "Add Variable",
      "Save Variables",
    ]) {
      expect(page).toContain(bold(name));
    }
  });

  it("accepts the names the page describes, and refuses the others, ignoring case for duplicates", () => {
    /*
     * The dialog's own pattern, word for word: the names below are checked
     * against what the dialog runs.
     */
    const pattern: RegExp = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

    expect(dialog).toContain(
      `const RESERVED_NAME_PATTERN: RegExp = ${pattern.toString()};`,
    );

    for (const name of ["service", "_internal", "k8s_namespace", "UNIT"]) {
      expect({ name: name, accepted: pattern.test(name) }).toEqual({
        name: name,
        accepted: true,
      });
    }
    for (const name of [
      "1service",
      "service-name",
      "service name",
      "sérvice",
    ]) {
      expect({ name: name, accepted: pattern.test(name) }).toEqual({
        name: name,
        accepted: false,
      });
    }

    expect(dialog).toContain("const lower: string = trimmed.toLowerCase();");
    expect(page).toContain(
      "letters, digits and underscores, starting with a letter or an underscore, and different from the dashboard's other names",
    );
  });

  it("offers up to 100 telemetry attribute values from the past day", () => {
    const limits: string = readSource(ATTRIBUTE_LIMITS);
    const service: string = readSource(ATTRIBUTE_SERVICE);
    const limit: RegExpMatchArray | null = limits.match(
      /ATTRIBUTE_VALUES_LIMIT: number = (\d+);/,
    );
    /*
     * A dashboard variable sends no time range, so its lookup reads the
     * value lookups' default window: the last day (issue #4708).
     */
    const hours: RegExpMatchArray | null = service.match(
      /VALUE_LOOKUP_DEFAULT_WINDOW_IN_MS: number = (\d+) \* 60 \* 60 \* 1000;/,
    );

    expect([limit?.[1], hours?.[1]]).toEqual(["100", "24"]);
    expect(sectionOf(page, "### Telemetry Attribute")).toContain(
      `The picker offers up to ${limit?.[1]} values of that key, read from your metrics of the past day`,
    );
  });

  it("offers between 1 and 1,000 project labels", () => {
    const options: (count: number) => DashboardVariable = (
      count: number,
    ): DashboardVariable => {
      return {
        id: "labels",
        name: "labels",
        type: DashboardVariableType.ProjectLabel,
        labelOptions: Array.from(
          { length: count },
          (): {
            label: string;
            value: string;
          } => {
            const id: string = ObjectID.generate().toString();

            return { label: id, value: id };
          },
        ),
      };
    };

    expect(DashboardLabelVariable.getOptions(options(1))).toHaveLength(1);
    expect(DashboardLabelVariable.getOptions(options(1000))).toHaveLength(1000);
    expect(() => {
      return DashboardLabelVariable.getOptions(options(0));
    }).toThrow();
    expect(() => {
      return DashboardLabelVariable.getOptions(options(1001));
    }).toThrow();

    expect(rowsOf(tables(page)[0])[1]?.[1]).toContain("from 1 to 1,000");
    expect(dialog).toContain("Choose between 1 and 1,000 allowed labels.");
  });

  it("starts a multi-select on All whatever its default, and a single-select on its default unless All is picked", () => {
    expect(
      DashboardVariableInterpolation.resolveValue(
        telemetryVariable({
          name: "namespace",
          attributeKey: "k8s.namespace.name",
          isMultiSelect: true,
          defaultValue: "prod",
        }),
      ),
    ).toBeUndefined();
    expect(
      DashboardVariableInterpolation.resolveValue(
        telemetryVariable({
          name: "service",
          attributeKey: "service.name",
          defaultValue: "checkout",
        }),
      ),
    ).toEqual({ scalar: "checkout" });
    expect(
      DashboardVariableInterpolation.resolveValue(
        telemetryVariable({
          name: "service",
          attributeKey: "service.name",
          defaultValue: "checkout",
          selectedValue: "",
        }),
      ),
    ).toBeUndefined();

    // And the dialog greys the Default out for a multi-select.
    expect(dialog).toContain("disabled={Boolean(variable.isMultiSelect)}");

    const multi: string = sectionOf(page, "## Multi-select and defaults");

    expect(multi).toContain(
      `An empty selection means ${bold("All")}, and a multi-select variable always starts on ${bold(
        "All",
      )}, so its ${bold("Default")} is greyed out.`,
    );
    expect(multi).toContain(
      `A single-select variable starts on its ${bold("Default")}, or on ${bold(
        "All",
      )} when it has none. ${bold(
        "All",
      )} removes the variable's filter, so the widgets show everything.`,
    );
  });

  it("filters metric, log and trace widgets by a Telemetry Attribute variable, and All removes the filter", () => {
    const picked: DashboardVariable = telemetryVariable({
      name: "service",
      attributeKey: "service.name",
      selectedValue: "payments",
    });
    const several: DashboardVariable = telemetryVariable({
      name: "service",
      attributeKey: "service.name",
      isMultiSelect: true,
      selectedValues: ["payments", "search"],
    });
    const all: DashboardVariable = telemetryVariable({
      name: "service",
      attributeKey: "service.name",
      selectedValue: "",
    });

    expect(
      DashboardVariableInterpolation.applyToAttributes({}, [picked]),
    ).toEqual({ "service.name": "payments" });

    const includes: unknown = DashboardVariableInterpolation.applyToAttributes(
      {},
      [several],
    )["service.name"];

    expect(includes).toBeInstanceOf(Includes);
    expect((includes as Includes).values).toEqual(["payments", "search"]);
    expect(
      DashboardVariableInterpolation.applyToAttributes(
        { "service.name": "checkout" },
        [all],
      ),
    ).toEqual({});

    expect(
      resolveTraceAttributeFilters({
        attributeFilters: undefined,
        variables: [picked],
      }),
    ).toEqual({ "service.name": "payments" });
    expect(
      getExactAttributeFilters({ attributeFilters: {}, variables: [picked] }),
    ).toEqual({ "service.name": "payments" });

    expect(sectionOf(page, "## How widgets use a variable")).toContain(
      `the ${bold("Log Chart")}, the ${bold("Log Stream")}, the ${bold(
        "Trace Chart",
      )} and the ${bold("Trace Table")}`,
    );
    expect(sectionOf(page, "## How widgets use a variable")).toContain(
      `pick ${bold("All")} to see it again`,
    );
  });

  it("says the Trace List and the incident and alert lists do not follow a Telemetry Attribute variable", () => {
    const policies: string = readSource(PUBLIC_RESOURCE_LISTS);

    for (const widget of [
      "DashboardTraceListComponent.tsx",
      "DashboardIncidentListComponent.tsx",
      "DashboardAlertListComponent.tsx",
    ]) {
      expect(readSource(`${WIDGET_COMPONENTS_DIR}/${widget}`)).not.toContain(
        "Interpolation",
      );
    }
    for (const policy of [
      "private static buildIncidentPolicy(",
      "private static buildAlertPolicy(",
      "private static buildTracePolicy(",
    ]) {
      expect(sliceOf(policies, policy, "private static build")).not.toContain(
        "attributeToColumn",
      );
    }

    expect(sectionOf(page, "## How widgets use a variable")).toContain(
      `The ${bold("Trace List")} and the incident and alert lists do not follow them.`,
    );
  });

  it("filters a monitor list by its Label Variable on top of its fixed labels, as the page's UNIT example says", () => {
    const fixedAndOne: unknown = DashboardLabelVariable.getFilter({
      labelIds: [NETWORK_LABEL],
      labelVariableId: "unit-id",
      variables: [unitVariable({ selectedValue: UNIT_0660 })],
    });

    // Both: the fixed label AND the picked unit.
    expect(fixedAndOne).toBeInstanceOf(IncludesAnyOfGroups);
    expect((fixedAndOne as IncludesAnyOfGroups).groups).toEqual([
      [NETWORK_LABEL],
      [UNIT_0660],
    ]);

    // Several units: any of them.
    const anyUnit: unknown = DashboardLabelVariable.getFilter({
      labelVariableId: "unit-id",
      variables: [
        unitVariable({
          isMultiSelect: true,
          selectedValues: [UNIT_0660, UNIT_0661],
        }),
      ],
    });

    expect(anyUnit).toBeInstanceOf(Includes);
    expect((anyUnit as Includes).values).toEqual([UNIT_0660, UNIT_0661]);

    // All: only the fixed label is left.
    const fixedOnly: unknown = DashboardLabelVariable.getFilter({
      labelIds: [NETWORK_LABEL],
      labelVariableId: "unit-id",
      variables: [unitVariable({ selectedValue: "" })],
    });

    expect(fixedOnly).toBeInstanceOf(Includes);
    expect((fixedOnly as Includes).values).toEqual([NETWORK_LABEL]);

    // A missing variable, or a pick outside its choices, is an error.
    expect(() => {
      return DashboardLabelVariable.getFilter({
        labelVariableId: "unit-id",
        variables: [],
      });
    }).toThrow();
    expect(() => {
      return DashboardLabelVariable.getFilter({
        labelVariableId: "unit-id",
        variables: [
          unitVariable({ selectedValue: ObjectID.generate().toString() }),
        ],
      });
    }).toThrow();

    const labels: string = sectionOf(page, "### Project Labels");

    expect(labels).toContain(
      "with a fixed `network` label and `UNIT` set to `0660`, a monitor must carry both labels",
    );
    expect(labels).toContain(
      "Multiple selected units match any selected unit.",
    );
    expect(labels).toContain(
      `Choosing ${bold("All")} removes only the variable condition`,
    );
    expect(labels).toContain(
      "A missing variable or a selection outside its configured choices shows an error.",
    );
  });

  it("reads a monitor list title with {{UNIT}} as the page's example says", () => {
    const title: string = "{{UNIT}} NETWORK";
    const read: (variable: DashboardVariable) => string | undefined = (
      variable: DashboardVariable,
    ): string | undefined => {
      return DashboardLabelVariable.interpolateTitle(title, [variable]);
    };

    expect([
      read(unitVariable({ selectedValue: UNIT_0660 })),
      read(
        unitVariable({
          isMultiSelect: true,
          selectedValues: [UNIT_0660, UNIT_0661],
        }),
      ),
      read(unitVariable({})),
    ]).toEqual(["0660 NETWORK", "0660, 0661 NETWORK", "All NETWORK"]);
    expect(page).toContain(
      "A title such as `{{UNIT}} NETWORK` shows `0660 NETWORK`, `0660, 0661 NETWORK`, or `All NETWORK`.",
    );
  });

  it("lets the SLO widget follow a Telemetry Attribute variable on the sloName key, as the SLO template binds it", () => {
    const slo: DashboardVariable = telemetryVariable({
      name: "slo",
      attributeKey: SLO_METRIC_SLO_NAME_ATTRIBUTE,
      selectedValue: "Checkout availability",
    });
    const followed: SloWidgetSource = resolveSloWidgetSource({
      serviceLevelObjectiveVariableId: slo.id,
      variables: [slo],
    });

    expect(SLO_METRIC_SLO_NAME_ATTRIBUTE).toBe("sloName");
    expect(followed).toEqual({
      state: SloWidgetSourceState.FollowsSelection,
      sloName: "Checkout availability",
    });
    expect(
      resolveSloWidgetSource({
        serviceLevelObjectiveVariableId: "custom",
        variables: [
          {
            id: "custom",
            name: "custom",
            type: DashboardVariableType.CustomList,
            customListValues: "a, b",
            selectedValue: "a",
          },
        ],
      }).state,
    ).toBe(SloWidgetSourceState.VariableMissing);

    const template: Array<DashboardVariable> =
      getTemplateConfig(DashboardTemplateType.Slo)?.variables || [];

    expect(
      template.some((variable: DashboardVariable): boolean => {
        return (
          variable.type === DashboardVariableType.TelemetryAttribute &&
          variable.attributeKey === SLO_METRIC_SLO_NAME_ATTRIBUTE
        );
      }),
    ).toBe(true);
    expect(page).toContain(
      `can follow a Telemetry Attribute variable on the \`${SLO_METRIC_SLO_NAME_ATTRIBUTE}\` key`,
    );
  });

  it("carries each pick in the link as ?var-<name>=<value>, commas for several and an explicit All", () => {
    const links: string = sectionOf(page, "## Links that keep the selection");
    const sample: string = fenceCode(
      VARIABLES,
      "A dashboard link with a variable",
    );
    const snapshot: Record<string, VariableUrlSnapshot> =
      DashboardVariableUrlState.parseFromSearch(
        new URL(sample.replace(/[<>]/g, "")).search,
      );

    expect(snapshot).toEqual({ service: { selectedValue: "payments" } });
    expect(links).toContain(
      "A link like this one opens on the payments service:",
    );
    expect(
      DashboardVariableUrlState.parseFromSearch("?var-service=a,b"),
    ).toEqual({ service: { selectedValues: ["a", "b"] } });
    expect(links).toContain(
      "`?var-<name>=<value>`, several values separated by commas",
    );

    // The sample's path is the dashboard's own route: the project, then the dashboard.
    const routes: string = readSource(DASHBOARD_ROUTES);

    expect(routes).toMatch(
      /\[PageMap\.DASHBOARD_VIEW\]: new Route\(\s*`\/dashboard\/\$\{RouteParams\.ProjectID\}\/dashboards\/\$\{\s*DashboardsRoutePath\[PageMap\.DASHBOARD_VIEW\]\s*\}`/,
    );
    expect(routes).toContain(
      "[PageMap.DASHBOARD_VIEW]: `${RouteParams.ModelID}`,",
    );
    expect(new URL(sample.replace(/[<>]/g, "")).pathname).toBe(
      "/dashboard/project-id/dashboards/dashboard-id",
    );
  });

  describe("writing the link", () => {
    const realWindow: unknown = (globalThis as { window?: unknown }).window;

    afterEach(() => {
      (globalThis as { window?: unknown }).window = realWindow;
    });

    it("writes only the variables, and keeps an explicit All as an empty value", () => {
      let written: string = "";

      (globalThis as { window?: unknown }).window = {
        location: {
          href: "https://oneuptime.com/dashboard/p/dashboards/d?var-old=1",
        },
        history: {
          state: null,
          replaceState: (
            _state: unknown,
            _title: string,
            url: string,
          ): void => {
            written = url;
          },
        },
      };

      DashboardVariableUrlState.writeToBrowserUrl([
        telemetryVariable({
          name: "service",
          attributeKey: "service.name",
          selectedValue: "",
        }),
        telemetryVariable({
          name: "namespace",
          attributeKey: "k8s.namespace.name",
          isMultiSelect: true,
          selectedValues: ["prod", "staging"],
        }),
      ]);

      expect(written).toBe(
        "/dashboard/p/dashboards/d?var-service=&var-namespace=prod%2Cstaging",
      );
      expect(sectionOf(page, "## Links that keep the selection")).toContain(
        `and an explicit ${bold("All")} too`,
      );
      // The time range and auto-refresh ride along (issue #5080).
      expect(DASHBOARD_TIME_RANGE_LINK_PARAMETER).toBe("range");
      expect(DASHBOARD_AUTO_REFRESH_LINK_PARAMETER).toBe("refresh");
      expect(sectionOf(page, "## Links that keep the selection")).toContain(
        "The link carries the time range and auto-refresh you picked as well, as `range` and `refresh`, so the people you send it to see what you see.",
      );
    });
  });
});

describe("External Data Sources, against the connectors and their limits", () => {
  const page: string = englishPage(DATA_SOURCES);

  it("lists every type with its query language and the systems it works with", () => {
    const rows: Array<Array<string>> = rowsOf(
      tables(sectionOf(page, "## Supported systems"))[0],
    );

    expect(
      rows.map((row: Array<string>): Array<string> => {
        return [row[0] as string, row[1] as string];
      }),
    ).toEqual(
      DataSourceTypeUtil.getAllDataSourceTypes().map(
        (type: DataSourceType): Array<string> => {
          const props: DataSourceTypeProps = DataSourceTypeUtil.getProps(type);

          return [props.title, props.queryLanguageTitle];
        },
      ),
    );

    // The systems a type works with are the ones its picker card names.
    DataSourceTypeUtil.getAllDataSourceTypes().forEach(
      (type: DataSourceType, index: number): void => {
        const description: string =
          DataSourceTypeUtil.getProps(type).description;
        const named: RegExpMatchArray | null = description.match(/\(([^)]+)\)/);

        if (named && (named[1] as string).includes(", ")) {
          for (const system of (named[1] as string).split(", ")) {
            expect({
              type: type,
              system: system,
              listed: rows[index]?.[2]?.includes(system),
            }).toEqual({
              type: type,
              system: system,
              listed: true,
            });
          }
        }
      },
    );
  });

  it("walks the create form's steps, its folded fields and the data source's own buttons as they are drawn", () => {
    const list: string = readSource(DATA_SOURCES_PAGE);
    const view: string = readSource(DATA_SOURCE_VIEW);
    const steps: Array<string> = Array.from(
      sliceOf(list, "formSteps={[", "]}").matchAll(/title: "([^"]+)",/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });
    const connect: string = sectionOf(page, "## Connect a data source");

    expect(steps).toEqual(["Basic Info", "Connection", "Authentication"]);
    for (const step of steps) {
      expect(connect).toContain(`Under ${bold(step)}`);
    }

    // Custom headers and the options fold under More fields, on Authentication.
    for (const folded of ["Custom HTTP Headers", "Additional Options"]) {
      expect(sliceOf(list, `title: "${folded}",`, "fieldType:")).toContain(
        'stepId: "auth",\n              collapsibleSection: advancedSection,',
      );
    }
    expect(list).toContain(
      "const advancedSection: FormFieldCollapsibleSection<DataSource> =\n  getAdvancedFormSection<DataSource>();",
    );
    expect(sliceOf(list, 'title: "Additional Options",', "},")).toContain(
      "Recognized keys: sslEnabled (boolean), sslRejectUnauthorized (boolean), elasticsearchIndex (string).",
    );
    expect(connect).toContain(
      `${bold("More fields")} holds ${bold(
        "Custom HTTP Headers",
      )}, such as \`{ "X-Scope-OrgID": "tenant-1" }\`, and ${bold(
        "Additional Options",
      )}`,
    );

    expect(readSource(DATA_SOURCE_TYPE_PICKER)).toContain(
      'title="Choose a Data Source Type"',
    );
    expect(sliceOf(list, "actionButtons={[", "]}")).toContain('title: "Test",');
    expect(connect).toContain(`then ${bold("Test")} on its row`);

    expect(view).toContain('title: "Data Source Details",');
    for (const button of ["Update Credentials", "Test"]) {
      expect(sliceOf(view, "buttons: [", "],")).toContain(
        `title: "${button}",`,
      );
    }
    expect(page).toContain(
      `${bold("Edit")} on ${bold(
        "Data Source Details",
      )} changes everything but its secrets; ${bold(
        "Update Credentials",
      )} replaces the password, the token or the headers`,
    );
  });

  it("names the query editor's fields, and says it names the language and shows an example", () => {
    const editor: string = readSource(DATA_SOURCE_QUERY_EDITOR);
    const widget: string = sectionOf(page, "## Use it in a widget");

    expect(editor).toContain('translator.translateText("Data Source")');
    expect(editor).toContain("language: typeProps.queryLanguageTitle,");
    expect(editor).toContain("placeholder={typeProps?.queryPlaceholder");
    expect(widget).toContain(
      `Pick the ${bold("Data Source")} and write the ${bold(
        "Query",
      )}. The editor names the query language and shows an example for the type.`,
    );

    // Add Query on a chart only: the other widgets read one query.
    expect(editor).toContain(
      '(isChart || queryConfigs.length === 0) && (\n            <Button\n              title="Add Query"',
    );
    expect(editor).toContain('translator.translateText("Legend (optional)")');
    expect(widget).toContain(
      `On a chart, ${bold("Add Query")} overlays more queries on the same axes`,
    );
  });

  it("groups the type picker as the page says", () => {
    expect(
      DataSourceTypeCategories.map((category: string): string => {
        return category.toLowerCase();
      }),
    ).toEqual(["metrics", "logs", "databases", "search", "apis"]);
    expect(page).toContain(
      "groups the types by what they hold: metrics, logs, databases, search and APIs",
    );
  });

  it("names the ports an empty Database Port stands for", () => {
    const ports: Array<string> = DataSourceTypeUtil.getAllDataSourceTypes()
      .filter((type: DataSourceType): boolean => {
        return DataSourceTypeUtil.isDatabaseType(type);
      })
      .map((type: DataSourceType): string => {
        return String(DataSourceTypeUtil.getDefaultPort(type));
      });

    expect(ports).toEqual(["5432", "3306", "1433", "8123"]);
    expect(page).toContain(`(leave it empty for ${listOf(ports, "or")})`);
  });

  it("needs Growth to create and change a data source, and no plan to delete one", () => {
    const dataSource: DataSource = new DataSource();

    expect({
      create: dataSource.createBillingPlan,
      update: dataSource.updateBillingPlan,
      delete: dataSource.deleteBillingPlan,
    }).toEqual({
      create: PlanType.Growth,
      update: PlanType.Growth,
      delete: PlanType.Free,
    });
    expect(page).toContain(
      `creating and changing data sources needs the ${bold(
        "Growth",
      )} plan. Deleting one works on every plan.`,
    );
  });

  it("names the permissions to add, change and remove data sources, and who reads them", () => {
    const dataSource: DataSource = new DataSource();
    const before: string = sectionOf(page, "## Before you begin");

    expect(rolesAndGrants(dataSource.createRecordPermissions)).toEqual({
      roles: ["Project Admin", "Project Owner"],
      grants: [Permission.CreateDataSource],
    });
    expect(rolesAndGrants(dataSource.updateRecordPermissions).grants).toEqual([
      Permission.EditDataSource,
    ]);
    expect(rolesAndGrants(dataSource.deleteRecordPermissions).grants).toEqual([
      Permission.DeleteDataSource,
    ]);
    expect(dataSource.readRecordPermissions).toEqual(
      expect.arrayContaining([Permission.ProjectMember, Permission.Viewer]),
    );

    expect(before).toContain(
      `Project owners and admins can add data sources; anyone else needs \`${Permission.CreateDataSource}\`, with \`${Permission.EditDataSource}\` and \`${Permission.DeleteDataSource}\` to change and remove them.`,
    );
    expect(before).toContain("members and viewers included");
  });

  it("keeps the credentials encrypted and never returns them", () => {
    const dataSource: DataSource = new DataSource();
    const fields: Record<string, string> = {
      password: "Password",
      apiToken: "API Token",
      customHeaders: "Custom HTTP Headers",
    };

    for (const columnName of Object.keys(fields)) {
      expect({
        column: columnName,
        encrypted: dataSource.getTableColumnMetadata(columnName).encrypted,
        readable: dataSource.getColumnAccessControlFor(columnName)?.read,
      }).toEqual({ column: columnName, encrypted: true, readable: [] });
    }

    expect(page).toContain(
      `${listOf(
        Object.values(fields).map(bold),
        "and",
      )} are encrypted at rest, and the API never returns them, not even to you.`,
    );
  });

  it("states every limit as the constants set it", () => {
    const limits: Array<Array<string>> = rowsOf(
      tables(sectionOf(page, "## Limits"))[0],
    );

    expect(limits).toEqual([
      ["Connecting", `${DATA_SOURCE_CONNECT_TIMEOUT_IN_MS / 1000} seconds`],
      ["Running a query", `${DATA_SOURCE_QUERY_TIMEOUT_IN_MS / 1000} seconds`],
      [
        "Points in a time series answer",
        DATA_SOURCE_MAX_TIME_SERIES_ROWS.toLocaleString("en-US"),
      ],
      ["Rows in a table", DATA_SOURCE_MAX_TABLE_ROWS.toLocaleString("en-US")],
      ["Series in one answer", String(DATA_SOURCE_MAX_SERIES)],
      [
        "Answer from an HTTP source",
        `${DATA_SOURCE_MAX_RESPONSE_SIZE_IN_BYTES / (1024 * 1024)} MB`,
      ],
    ]);
  });

  it("asks Prometheus and Loki for about 250 points, between 10 seconds and a day apart", () => {
    const start: Date = new Date(Date.UTC(2026, 9, 13, 0, 0, 0));
    const after: (seconds: number) => Date = (seconds: number): Date => {
      return new Date(start.getTime() + seconds * 1000);
    };

    expect([
      DATA_SOURCE_TARGET_BUCKETS,
      DATA_SOURCE_MIN_STEP_IN_SECONDS,
      DATA_SOURCE_MAX_STEP_IN_SECONDS,
    ]).toEqual([250, 10, 24 * 60 * 60]);
    expect(DataSourceLimitsUtil.getStepInSeconds(start, after(3600))).toBe(15);
    expect(DataSourceLimitsUtil.getStepInSeconds(start, after(300))).toBe(10);
    expect(
      DataSourceLimitsUtil.getStepInSeconds(start, after(365 * 24 * 3600)),
    ).toBe(24 * 60 * 60);

    for (const connector of ["PrometheusConnector.ts", "LokiConnector.ts"]) {
      expect(readSource(`${DATA_SOURCE_CONNECTORS}/${connector}`)).toContain(
        "getStepInSeconds",
      );
    }
    expect(page).toContain(
      `Prometheus and Loki range queries ask for about ${DATA_SOURCE_TARGET_BUCKETS} points across the time range, no closer than ${DATA_SOURCE_MIN_STEP_IN_SECONDS} seconds and no further apart than a day.`,
    );
  });

  it("refuses SQL the way the page says, in the words the page quotes", () => {
    const heads: string | null = guardRefusal("UPDATE orders SET paid = 1");

    expect(heads).toBe(
      "Only read-only queries are allowed (must start with SELECT, WITH, SHOW, EXPLAIN, DESCRIBE, DESC).",
    );
    expect(page).toContain(
      "A query must be one statement that starts with `SELECT`, `WITH`, `SHOW`, `EXPLAIN`, `DESCRIBE` or `DESC`.",
    );
    expect(page).toContain(':::details "Only read-only queries are allowed"');

    expect(guardRefusal("SELECT 1; SELECT 2")).toBe(
      "Only a single SQL statement is allowed per query.",
    );
    expect(page).toContain(
      'as "Only a single SQL statement is allowed per query."',
    );

    for (const word of ["INSERT", "UPDATE", "DELETE", "DROP", "INTO", "SET"]) {
      expect(guardRefusal(`SELECT a FROM t WHERE ${word} = 1`)).toContain(
        `Query contains a keyword that is not allowed in read-only data source queries: ${word}.`,
      );
    }
    expect(page).toContain(
      "such as `INSERT`, `UPDATE`, `DELETE`, `DROP`, `INTO` or `SET`, are refused anywhere outside strings and quoted names",
    );
    expect(page).toContain(
      ':::details "Query contains a keyword that is not allowed"',
    );

    // Quoted as each database quotes it, a column named after one is fine.
    expect(guardRefusal("SELECT delete FROM t")).not.toBeNull();
    for (const quoted of ['"delete"', "[delete]", "`delete`"]) {
      expect(guardRefusal(`SELECT ${quoted} FROM t`)).toBeNull();
    }
    expect(page).toContain(
      'Quote it as the database does: `"delete"` in PostgreSQL, `[delete]` in SQL Server, and in backticks in MySQL and ClickHouse.',
    );

    // A quote inside a string is two quotes; a backslash before one is refused.
    expect(guardRefusal("SELECT 'it''s'")).toBeNull();
    expect(guardRefusal("SELECT 'it\\'s'")).toContain(
      "Backslash-escaped quotes are not allowed",
    );
    expect(page).toContain(
      "Write a quote inside a string as two quotes (`''`): a backslash before a quote is refused.",
    );
  });

  it("runs the page's SQL sample through the macros and the guard", () => {
    const start: Date = new Date(Date.UTC(2026, 9, 13, 9, 0, 0));
    const end: Date = new Date(Date.UTC(2026, 9, 13, 10, 0, 0));
    const sql: string = SqlQueryGuard.applyTimeMacros(
      fenceCode(DATA_SOURCES, "SQL"),
      start,
      end,
    );

    expect(sql).toContain(
      "BETWEEN '2026-10-13 09:00:00' AND '2026-10-13 10:00:00'",
    );
    expect(guardRefusal(sql)).toBeNull();
  });

  it("expands every time macro as the macros table says", () => {
    const start: Date = new Date(Date.UTC(2026, 9, 13, 9, 0, 0));
    const end: Date = new Date(Date.UTC(2026, 9, 13, 10, 0, 0));
    const macros: Array<Array<string>> = rowsOf(
      tables(sectionOf(page, "### Time macros"))[0],
    );
    const text: string =
      "$__startTime $__endTime $__startTimeMs $__endTimeMs $__rangeSeconds";

    expect(SqlQueryGuard.applyTimeMacros(text, start, end)).toBe(
      `'2026-10-13 09:00:00' '2026-10-13 10:00:00' ${start.getTime()} ${end.getTime()} 3600`,
    );
    expect(macros[0]?.[1]).toBe(
      "The range's start and end, in UTC: `'2026-10-13 09:00:00'` in SQL, ISO 8601 elsewhere",
    );
    expect(macros[1]?.[1]).toBe("The same, as milliseconds since 1970");
    expect(macros[2]).toEqual([
      "`$__rangeSeconds`",
      "The range's length, in seconds",
      "SQL",
    ]);

    // Elasticsearch and REST API read the same macros as ISO 8601 and milliseconds.
    for (const apply of [applyElasticsearchTimeMacros, applyRestTimeMacros]) {
      expect(apply("$__startTime $__endTimeMs", start, end)).toBe(
        `${start.toISOString()} ${end.getTime()}`,
      );
    }
    expect(macros[0]?.[2]).toBe("SQL, Elasticsearch, REST API");
    expect(macros[1]?.[2]).toBe("SQL, Elasticsearch, REST API");

    // Prometheus and Loki get the range with the request instead.
    expect(page).toContain(
      "Prometheus and Loki receive the dashboard's time range with every request, so their queries need nothing more.",
    );
  });

  it("parses the page's Elasticsearch and REST API samples as their connectors do", () => {
    const start: Date = new Date(Date.UTC(2026, 9, 13, 9, 0, 0));
    const end: Date = new Date(Date.UTC(2026, 9, 13, 10, 0, 0));
    const dsl: JSONObject = parseQueryDsl(
      fenceCode(DATA_SOURCES, "Query DSL"),
      start,
      end,
    ) as JSONObject;

    expect(JSON.stringify(dsl)).toContain(
      `"gte":"${start.toISOString()}","lte":"${end.toISOString()}"`,
    );
    expect(JSON.stringify(dsl)).toContain('"date_histogram"');

    const request: RestApiRequestDescriptor = parseRequestDescriptor(
      applyRestTimeMacros(fenceCode(DATA_SOURCES, "Request"), start, end),
    );

    expect(request).toEqual(
      expect.objectContaining({
        path: `/api/stats?from=${start.getTime()}&to=${end.getTime()}`,
        method: "GET",
        rowsPath: "data.items",
        timestampField: "time",
        valueField: "count",
        seriesField: "service",
      }),
    );
  });

  it("reads every index without elasticsearchIndex, and passes the SSL options to every database", () => {
    expect(
      buildElasticsearchSearchUrl({
        url: "https://search.example.com",
      } as unknown as Parameters<typeof buildElasticsearchSearchUrl>[0]),
    ).toBe("https://search.example.com/*/_search");
    expect(page).toContain(
      "`elasticsearchIndex` for Elasticsearch, which reads every index (`*`) without it",
    );

    for (const connector of [
      "PostgresConnector.ts",
      "MySqlConnector.ts",
      "SqlServerConnector.ts",
      "ClickHouseConnector.ts",
    ]) {
      const source: string = readSource(
        `${DATA_SOURCE_CONNECTORS}/${connector}`,
      );

      expect({
        connector: connector,
        ssl: source.includes('"sslEnabled"'),
        verify: source.includes('"sslRejectUnauthorized"'),
      }).toEqual({
        connector: connector,
        ssl: true,
        verify: true,
      });
    }
    expect(page).toContain(
      "`sslEnabled` and `sslRejectUnauthorized` for databases",
    );
  });

  it("shapes SQL rows into time series by the time and value columns the page names", () => {
    const at: string = "2026-10-13T09:00:00Z";

    for (const timeColumn of ["time", "timestamp", "date", "ts"]) {
      const shaped: AggregatedResult = SqlResultShaper.rowsToTimeSeries(
        [{ [timeColumn]: at, value: 3, region: "eu" }],
        { maxRows: 10 },
      );

      expect(shaped.data).toHaveLength(1);
      expect(
        (shaped.data[0] as unknown as { attributes: Record<string, string> })
          .attributes,
      ).toEqual({ region: "eu" });
    }

    // No value column: the first numeric one.
    expect(
      SqlResultShaper.rowsToTimeSeries([{ time: at, count: 5 }], {
        maxRows: 10,
      }).data[0]?.value,
    ).toBe(5);
    expect(() => {
      return SqlResultShaper.rowsToTimeSeries([{ minute: at, value: 1 }], {
        maxRows: 10,
      });
    }).toThrow("time, timestamp, date, ts");

    expect(page).toContain(
      "A SQL query returns a time column named `time`, `timestamp`, `date` or `ts`, and a numeric `value` column (or its first numeric column); every other column becomes a series label.",
    );
  });

  it("puts a variable into a query, several values joined with |, and leaves an unpicked one as written", () => {
    const job: DashboardVariable = {
      id: "job",
      name: "job",
      type: DashboardVariableType.CustomList,
      customListValues: "api, web",
      isMultiSelect: true,
      selectedValues: ["api", "web"],
    };
    const nothing: DashboardVariable = { ...job, selectedValues: [] };
    const promql: string = fenceCode(DATA_SOURCES, "PromQL");

    expect(promql).toContain('job=~"{{job}}"');
    expect(DataSourceQueryText.applyVariables(promql, [job])).toContain(
      'job=~"api|web"',
    );
    expect(DataSourceQueryText.applyVariables(promql, [nothing])).toContain(
      'job=~"{{job}}"',
    );
    expect(page).toContain(
      'Several values of a multi-select variable are joined with `|`, which is what a PromQL or LogQL regular expression matcher needs: `job=~"{{job}}"`. A variable with nothing picked leaves the placeholder as written',
    );
  });

  it("names a series from its labels with Legend (optional)", () => {
    expect(
      DataSourceQueryText.applyLegendTemplate("{{instance}} — errors", {
        instance: "api-1:9090",
      }),
    ).toBe("api-1:9090 — errors");
    expect(page).toContain(
      `${bold(
        "Legend (optional)",
      )} names each series from its labels: \`{{instance}} — errors\` writes the series' \`instance\` label in front.`,
    );
  });

  it("reduces a value or a gauge in the six ways the page lists, the last value by default", () => {
    const values: Array<number> = [4, 1, 7];

    expect(Object.values(DataSourceValueReduce)).toEqual([
      DataSourceValueReduce.Last,
      DataSourceValueReduce.First,
      DataSourceValueReduce.Avg,
      DataSourceValueReduce.Sum,
      DataSourceValueReduce.Min,
      DataSourceValueReduce.Max,
    ]);
    expect(DataSourceValueReducer.reduce(values, undefined)).toBe(7);
    expect(
      DataSourceValueReducer.reduce(values, DataSourceValueReduce.First),
    ).toBe(4);
    expect(
      DataSourceValueReducer.reduce(values, DataSourceValueReduce.Avg),
    ).toBe(4);
    expect(
      DataSourceValueReducer.reduce(values, DataSourceValueReduce.Sum),
    ).toBe(12);
    expect(
      DataSourceValueReducer.reduce(values, DataSourceValueReduce.Min),
    ).toBe(1);
    expect(
      DataSourceValueReducer.reduce(values, DataSourceValueReduce.Max),
    ).toBe(7);

    for (const type of [
      DashboardComponentType.DataSourceValue,
      DashboardComponentType.DataSourceGauge,
    ]) {
      expect(argumentNames(type)).toEqual(
        expect.arrayContaining(["Reduce", "Unit"]),
      );
    }
    expect(page).toContain(
      `${bold(
        "Reduce",
      )} turns the points into one number: the last value (the default), the first, the average, the sum, the minimum or the maximum.`,
    );
  });

  it("shows a value's unit as the widget formats it", () => {
    const bytes: string = ValueFormatter.formatValueCompact(1500000, "Bytes", {
      metricName: "",
    }).formatted;
    const milliseconds: string = ValueFormatter.formatValueCompact(2400, "ms", {
      metricName: "",
    }).formatted;

    expect(page).toContain(
      `\`Bytes\` reads as ${bytes}, \`ms\` as ${milliseconds}.`,
    );
  });

  describe("the addresses a data source may reach", () => {
    const realBlock: string | undefined =
      process.env["DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES"];
    const realBilling: string | undefined = process.env["BILLING_ENABLED"];

    afterEach(() => {
      for (const [name, value] of [
        ["DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES", realBlock],
        ["BILLING_ENABLED", realBilling],
      ] as Array<[string, string | undefined]>) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
    });

    it("refuses loopback and link-local everywhere, and private addresses on Cloud or when the variable says so", () => {
      for (const blockPrivateAddresses of [true, false]) {
        for (const address of ["127.0.0.1", "169.254.169.254"]) {
          expect(
            DataSourceEgressGuard.checkAddress(address, {
              blockPrivateAddresses,
            }).blocked,
          ).toBe(true);
        }
      }

      expect(
        DataSourceEgressGuard.checkAddress("10.1.2.3", {
          blockPrivateAddresses: true,
        }).blocked,
      ).toBe(true);
      expect(
        DataSourceEgressGuard.checkAddress("10.1.2.3", {
          blockPrivateAddresses: false,
        }).blocked,
      ).toBe(false);

      delete process.env["DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES"];
      process.env["BILLING_ENABLED"] = "true";
      expect(DataSourceEgressGuard.shouldBlockPrivateAddresses()).toBe(true);

      process.env["BILLING_ENABLED"] = "false";
      expect(DataSourceEgressGuard.shouldBlockPrivateAddresses()).toBe(false);

      process.env["DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES"] = "true";
      expect(DataSourceEgressGuard.shouldBlockPrivateAddresses()).toBe(true);

      expect(page).toContain(
        "Loopback, link-local (where cloud metadata lives) and other reserved addresses are refused everywhere. Private addresses are refused on OneUptime Cloud, and allowed on a self-hosted installation unless `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES` is `true`",
      );
    });
  });
});

describe("Sharing & Public Dashboards, against the public link's checks", () => {
  const page: string = englishPage(SHARING);

  function publicDashboard(data: {
    isPublicDashboard?: boolean;
    ipWhitelist?: string;
    password?: boolean;
    isArchived?: boolean;
  }): Dashboard {
    const dashboard: Dashboard = new Dashboard();

    dashboard.isPublicDashboard = data.isPublicDashboard ?? true;
    dashboard.isArchived = data.isArchived ?? false;

    if (data.ipWhitelist) {
      dashboard.ipWhitelist = data.ipWhitelist;
    }

    if (data.password) {
      dashboard.enableMasterPassword = true;
      dashboard.masterPassword = new HashedString("a-hash", true);
    }

    return dashboard;
  }

  function accessFor(
    dashboard: Dashboard,
    clientIp: string,
    hasUnlockCookie: boolean = false,
  ): PublicDashboardAccess {
    return PublicDashboardAccessPolicy.decide({
      dashboard: dashboard,
      visitor: { clientIp: clientIp, hasUnlockCookie: hasUnlockCookie },
    }).access;
  }

  it("runs the visitor's checks in the diagram's order: shared, then the IP allowlist, then the password", () => {
    const office: string = "203.0.113.7";
    const elsewhere: string = "198.51.100.20";
    const diagram: string = fenceCode(
      SHARING,
      "What a visitor sees when they open the public link",
    );

    // Not shared publicly: the not-found page, whatever else is set.
    expect(
      accessFor(
        publicDashboard({
          isPublicDashboard: false,
          ipWhitelist: office,
          password: true,
        }),
        elsewhere,
      ),
    ).toBe(PublicDashboardAccess.NotFound);

    // An address off the list is refused before any password is asked for.
    expect(
      accessFor(
        publicDashboard({ ipWhitelist: office, password: true }),
        elsewhere,
      ),
    ).toBe(PublicDashboardAccess.Forbidden);

    // On the list, or no list: the password prompt, then the dashboard.
    expect(
      accessFor(
        publicDashboard({ ipWhitelist: office, password: true }),
        office,
      ),
    ).toBe(PublicDashboardAccess.PasswordRequired);
    expect(accessFor(publicDashboard({ password: true }), elsewhere)).toBe(
      PublicDashboardAccess.PasswordRequired,
    );
    expect(
      accessFor(publicDashboard({ password: true }), elsewhere, true),
    ).toBe(PublicDashboardAccess.Granted);
    expect(accessFor(publicDashboard({}), elsewhere)).toBe(
      PublicDashboardAccess.Granted,
    );

    expect(diagram).toContain('shared -->|"No"| missing["A not-found page"]');
    expect(diagram).toContain(
      'shared -->|"Yes"| allowed("Is their address on<br/>the IP allowlist?")',
    );
    expect(diagram).toContain(
      'allowed -->|"Yes, or<br/>no list"| locked("Is a password<br/>required?")',
    );
    expect(diagram).toContain(
      'allowed -->|"No"| denied["An Access<br/>Denied page"]',
    );
  });

  it("lets people who entered a password keep viewing for as long as the unlock lasts", () => {
    expect(sectionOf(page, "## Sharing with a password")).toContain(
      `can keep viewing the dashboard for up to ${DASHBOARD_MASTER_PASSWORD_COOKIE_MAX_AGE_IN_DAYS} days`,
    );
  });

  it("sends a link with the variables, and the time range and auto-refresh it opens on", () => {
    const link: string = sectionOf(page, "## Sending a link");

    expect(link).toContain("add the variable to it as `?var-<name>=<value>`");

    // The example opens where the page says it does.
    expect(getDashboardLinkTimeRangeFromSearch("?range=1d&refresh=1m")).toBe(
      TimeRange.PAST_ONE_DAY,
    );
    expect(
      getDashboardLinkAutoRefreshIntervalFromSearch("?range=1d&refresh=1m"),
    ).toBe(AutoRefreshInterval.ONE_MINUTE);
    expect(link).toContain(
      "add `range` and `refresh` the same way: `?range=1d&refresh=1m` opens on the past day, refreshing every minute",
    );

    // Every value each parameter takes, in the order the pickers offer them.
    expect(link).toContain(
      `\`range\` takes ${listOf(
        DASHBOARD_TIME_RANGE_LINK_VALUES.map((value: string): string => {
          return `\`${value}\``;
        }),
        "or",
      )}, and \`refresh\` takes ${listOf(
        DASHBOARD_AUTO_REFRESH_INTERVALS.map((value: string): string => {
          return `\`${value}\``;
        }),
        "or",
      )}.`,
    );
    expect(link).toContain(
      "They win over the dashboard's defaults and the visitor's own picks, and visitors can still change them.",
    );
  });
});

describe("Dashboard Configuration & Permissions, against the models", () => {
  const page: string = englishPage(CONFIGURATION);
  const whoMay: Array<Array<string>> = rowsOf(
    tables(sectionOf(page, "## Who may do what"))[0],
  );

  function rowFor(action: string): string {
    const row: Array<string> | undefined = whoMay.find(
      (item: Array<string>): boolean => {
        return item[0] === action;
      },
    );

    expect({ action: action, found: Boolean(row) }).toEqual({
      action: action,
      found: true,
    });

    return row?.[1] || "";
  }

  it("lists who may read, create, change and delete a dashboard as the Dashboard model grants it", () => {
    const dashboard: Dashboard = new Dashboard();
    const rows: Array<{
      action: string;
      model: "create" | "read" | "update" | "delete";
    }> = [
      { action: "Read dashboards", model: "read" },
      { action: "Create dashboards", model: "create" },
      {
        action:
          "Change a dashboard: its widgets, variables, sharing, branding, and archiving it",
        model: "update",
      },
      { action: "Delete a dashboard", model: "delete" },
    ];

    for (const row of rows) {
      const cell: string = rowFor(row.action);
      const granted: { roles: Array<string>; grants: Array<string> } =
        rolesAndGrants(modelPermissions(dashboard, row.model));

      expect({
        action: row.action,
        roles: rolesNamedIn(cell),
        grants: codeSpansIn(cell),
      }).toEqual({
        action: row.action,
        roles: granted.roles,
        grants: granted.grants,
      });
    }
  });

  it("lists who may add owners, custom domains and rules as their models grant it", () => {
    const rows: Array<{
      action: string;
      models: Array<BaseModel>;
      actions: Array<"create" | "read" | "update" | "delete">;
      grantsContain: string;
    }> = [
      {
        action: "Add and remove owners",
        models: [new DashboardOwnerUser(), new DashboardOwnerTeam()],
        actions: ["create", "delete"],
        grantsContain: "DashboardOwner",
      },
      {
        action: "Add and change custom domains",
        models: [new DashboardDomain()],
        actions: ["create", "update"],
        grantsContain: "DashboardDomain",
      },
      {
        action: "Create owner rules and label rules",
        models: [new DashboardOwnerRule(), new DashboardLabelRule()],
        actions: ["create"],
        grantsContain: "Dashboard",
      },
    ];

    for (const row of rows) {
      const cell: string = rowFor(row.action);

      for (const model of row.models) {
        for (const action of row.actions) {
          const granted: { roles: Array<string>; grants: Array<string> } =
            rolesAndGrants(modelPermissions(model, action));

          expect({
            action: row.action,
            model: model.tableName,
            roles: rolesNamedIn(cell),
          }).toEqual({
            action: row.action,
            model: model.tableName,
            roles: granted.roles,
          });
          expect(
            granted.grants.every((grant: string): boolean => {
              return grant.includes(row.grantsContain);
            }),
          ).toBe(true);
        }
      }
    }
  });

  it("says read, edit and delete can be scoped by owner or label, and create cannot", () => {
    for (const permission of [
      Permission.ReadDashboard,
      Permission.EditDashboard,
      Permission.DeleteDashboard,
    ]) {
      expect(PermissionHelper.isAccessControlPermission(permission)).toBe(true);
    }
    expect(
      PermissionHelper.isAccessControlPermission(Permission.CreateDashboard),
    ).toBe(false);

    const model: string = readSource(
      "Common/Models/DatabaseModels/Dashboard.ts",
    );

    expect(model).toContain("@OperationalResource()");
    expect(model).toContain('@AccessControlColumn("labels")');
    expect(sectionOf(page, "## Who may do what")).toContain(
      "Read, edit and delete can each be limited to the dashboards a team owns, or to dashboards carrying some labels",
    );
  });

  it("copies the widgets, variables, description and labels, and leaves branding, domains and sharing behind", () => {
    const duplicate: string = sliceOf(
      readSource(DASHBOARD_SETTINGS),
      "fieldsToDuplicate={{",
      "}}",
    );
    const copied: Array<string> = Array.from(
      duplicate.matchAll(/(\w+): true,/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(copied.sort()).toEqual(
      ["dashboardViewConfig", "description", "labels"].sort(),
    );
    expect(sectionOf(page, "## Duplicating a dashboard")).toContain(
      "It has the dashboard's widgets, variables, description and labels. Branding and custom domains stay with the original, and public sharing always starts off",
    );
  });

  it("exports the dashboard's own settings, its widgets and variables among them, and leaves its owners and labels out", () => {
    const exported: Array<string> =
      ModelImportExport.getImportExportableColumnNames(Dashboard);

    expect(exported).toEqual(
      expect.arrayContaining(["name", "description", "dashboardViewConfig"]),
    );
    expect(exported).not.toContain("labels");
    expect(sectionOf(page, "## Exporting and importing")).toContain(
      "An export holds the dashboard's own settings, its widgets and variables among them. Its owners and labels are left out",
    );
  });

  it("answers an archived dashboard's link with the not-found message, its settings kept", () => {
    const archived: Dashboard = new Dashboard();

    archived.isPublicDashboard = true;
    archived.isArchived = true;

    expect(
      PublicDashboardAccessPolicy.decide({
        dashboard: archived,
        visitor: { clientIp: undefined, hasUnlockCookie: false },
      }).access,
    ).toBe(PublicDashboardAccess.NotFound);
    // The setting stays as it was, for unarchiving to put back.
    expect(archived.isPublicDashboard).toBe(true);
    expect(sectionOf(page, "## Archiving a dashboard")).toContain(
      `its URL and custom domains answer "${PUBLIC_DASHBOARD_NOT_FOUND_MESSAGE}"`,
    );
  });

  it("deletes a dashboard's custom domains with it, and keeps a domain to one dashboard", () => {
    const domain: string = readSource(
      "Common/Models/DatabaseModels/DashboardDomain.ts",
    );

    expect(
      sliceOf(
        domain,
        'manyToOneRelationColumn: "dashboardId"',
        "public dashboard",
      ),
    ).toContain('onDelete: "CASCADE"');
    expect(sectionOf(page, "## Deleting a dashboard")).toContain(
      "the dashboard, its widgets and variables, and any custom domains attached to it are removed",
    );

    expect(
      sliceOf(domain, '@UniqueColumnBy("projectId")', "public fullDomain"),
    ).toContain('title: "Full Domain"');
    expect(sectionOf(page, "## Deleting a dashboard")).toContain(
      "a domain belongs to one dashboard at a time",
    );
  });

  it("says audit logs come with the Enterprise plan", () => {
    expect(readSource(ENTERPRISE_ELIGIBILITY)).toMatch(
      /AUDIT_LOGS_REQUIRED_PLAN: EnterpriseRequiredPlan =\s*PlanType\.Enterprise;/,
    );
    expect(sectionOf(page, "## Audit logs")).toContain(
      "Audit logs are part of the Enterprise plan",
    );
  });
});

describe("Dashboard Playlists, against the playlist model and the player", () => {
  const page: string = englishPage(PLAYLISTS);
  const howSection: string = sectionOf(page, "## How a playlist plays");
  const createSection: string = sectionOf(page, "## Create a playlist");
  const playSection: string = sectionOf(page, "## Play it on a screen");
  const whoSection: string = sectionOf(page, "## Who sees what");

  it("opens Playlists from the Dashboards side menu, right under the Dashboards list", () => {
    const dashboards: MenuSection | undefined = dashboardsListMenu().find(
      (section: MenuSection): boolean => {
        return section.title === "Dashboards";
      },
    );

    expect(dashboards?.items).toEqual(["Dashboards", "Playlists"]);
    expect(createSection).toContain(
      `Open ${bold("Products → Dashboards")}, then ${bold(
        "Playlists",
      )} in the side menu.`,
    );
  });

  it("describes the list's columns, its Play button and its create button as the list draws them", () => {
    const list: string = readSource(PLAYLISTS_LIST);

    expect(list).toContain('singularName="Playlist"');
    expect(list).toContain("isCreateable={true}");

    for (const title of ["Name", "Dashboards", "Show each dashboard for"]) {
      expect(list).toContain(`title: "${title}",`);
    }

    expect(list).toContain('title: "Play",');
    expect(createSection).toContain(
      `how many dashboards each playlist has and how long each is shown, with ${bold(
        "Play",
      )} on every row`,
    );
    expect(createSection).toContain(`Click ${bold("Create Playlist")}`);
  });

  it("names the form's three fields as the form titles them, and says archived dashboards are not offered", () => {
    const form: string = readSource(PLAYLIST_FORM_FIELDS);

    for (const title of ["Name", "Dashboards", "Show each dashboard for"]) {
      expect(form).toContain(`title: "${title}",`);
      expect(createSection).toContain(bold(title));
    }

    const field: string = readSource(PLAYLIST_DASHBOARDS_FIELD);

    expect(field).toContain(
      'ariaLabel={translator.translateText("Add a dashboard")}',
    );
    expect(createSection).toContain(
      `pick each one from ${bold("Add a dashboard")}`,
    );
    // The picker's options: not archived, and not in the list yet.
    expect(field).toContain("!dashboard.isArchived &&");
    expect(createSection).toContain("Archived dashboards are not offered.");
  });

  it("gives the time each dashboard is shown as the form offers it: a minute, from 15 seconds to an hour", () => {
    const choices: ReadonlyArray<number> =
      DASHBOARD_PLAYLIST_INTERVAL_CHOICES_IN_SECONDS;

    expect(DASHBOARD_PLAYLIST_DEFAULT_INTERVAL_IN_SECONDS).toBe(60);
    expect(choices).toContain(DASHBOARD_PLAYLIST_DEFAULT_INTERVAL_IN_SECONDS);
    expect(choices[0]).toBe(15);
    expect(choices[choices.length - 1]).toBe(60 * 60);
    expect(createSection).toContain(
      `${bold(
        "Show each dashboard for",
      )} starts at a minute; pick a time from 15 seconds to an hour.`,
    );
  });

  it("names the playlist page's Player link, Edit Playlist and Delete Dashboard Playlist as the page draws them", () => {
    const view: string = readSource(PLAYLIST_VIEW);

    expect(view).toContain('title: "Player link",');
    expect(view).toContain('editButtonText="Edit Playlist"');
    // ModelDelete's card and button: "Delete" and the model's singular name.
    expect(view).toContain("<ModelDelete");
    expect(new DashboardPlaylist().singularName).toBe("Dashboard Playlist");

    for (const label of [
      "Player link",
      "Edit Playlist",
      "Delete Dashboard Playlist",
    ]) {
      expect(createSection).toContain(bold(label));
    }
  });

  it("gives the API's shape and limits as the playlist service checks them", () => {
    const playlist: DashboardPlaylist = new DashboardPlaylist();

    for (const column of ["name", "dashboards", "intervalInSeconds"]) {
      expect(playlist.getTableColumnMetadata(column)).toBeTruthy();
      expect(inlineCode(createSection)).toContain(column);
    }

    // The page's example, with a dashboard's id in it, is a list the API takes.
    const example: string = '[{"dashboardId": "<id>"}]';

    expect(inlineCode(createSection)).toContain(example);
    expect(
      getDashboardPlaylistDashboardsProblem(
        example.replace("<id>", ObjectID.generate().toString()),
      ),
    ).toBeNull();

    expect(DASHBOARD_PLAYLIST_MAX_DASHBOARDS).toBe(100);
    expect(
      getDashboardPlaylistDashboardsProblem(
        Array.from(
          { length: DASHBOARD_PLAYLIST_MAX_DASHBOARDS + 1 },
          (): { dashboardId: string } => {
            return { dashboardId: ObjectID.generate().toString() };
          },
        ),
      ),
    ).not.toBeNull();
    expect(createSection).toContain("in the order they are shown, at most 100");

    expect(DASHBOARD_PLAYLIST_MIN_INTERVAL_IN_SECONDS).toBe(10);
    expect(DASHBOARD_PLAYLIST_MAX_INTERVAL_IN_SECONDS).toBe(86400);

    for (const value of [10, 86400]) {
      expect(getDashboardPlaylistIntervalProblem(value)).toBeNull();
    }

    for (const value of [9, 86401, 60.5]) {
      expect(getDashboardPlaylistIntervalProblem(value)).not.toBeNull();
    }

    expect(createSection).toContain(
      "any whole number of seconds from 10 to 86400 (a day)",
    );
  });

  it("lists the player's keys as its shortcut sheet does, key for key, and swaps the arrows right to left", () => {
    // How the page writes each key the sheet names.
    const keyNames: Record<string, string> = {
      Space: "Space",
      ArrowRight: "Right Arrow",
      ArrowLeft: "Left Arrow",
      F: "F",
      Escape: "Esc",
      "?": "?",
    };
    const sheet: Array<PlaylistPlayerShortcut> =
      getPlaylistPlayerShortcutGroups({
        isRightToLeft: false,
      }).flatMap(
        (group: PlaylistPlayerShortcutGroup): Array<PlaylistPlayerShortcut> => {
          return group.shortcuts;
        },
      );
    const rows: Array<Array<string>> = rowsOf(tables(playSection)[0]);

    // Each row: the key in code, then what it does, as the sheet words it, first.
    expect(rows.length).toBe(sheet.length);

    sheet.forEach((shortcut: PlaylistPlayerShortcut, index: number): void => {
      const row: Array<string> = rows[index] || [];

      expect({
        key: row[0],
        startsWithSheetWords: (row[1] || "").startsWith(
          bold(shortcut.description),
        ),
      }).toEqual({
        key: `\`${keyNames[shortcut.keys[0] as string]}\``,
        startsWithSheetWords: true,
      });
    });

    // Right to left, the left arrow goes on.
    expect(
      getPlaylistPlayerKeyAction({
        event: { key: "ArrowLeft" },
        isRightToLeft: true,
        isDialogOpen: false,
      }),
    ).toBe(PlaylistPlayerKeyAction.Next);
    expect(playSection).toContain(
      "the arrows swap: `Left Arrow` goes to the next dashboard",
    );

    // Paused, the bar says so.
    expect(readSource(PLAYLIST_PLAYER_BAR)).toContain(
      'translator.translateText("Paused")',
    );
    expect(playSection).toContain(`the bar says ${bold("Paused")}`);
  });

  it("says the player keeps the screen awake, and draws the next dashboard ahead", () => {
    const player: string = readSource(PLAYLIST_PLAYER);

    expect(player).toContain("useScreenWakeLock(true);");
    expect(playSection).toContain(
      "the player keeps the screen from going to sleep, where the browser allows it",
    );
    expect(player).toContain('"playlist-player-up-next-board"');
    expect(howSection).toContain(
      "the player draws the next one out of sight, so the screen never goes blank",
    );
  });

  it("lists who may see, play, create, change and delete a playlist as the playlist model grants it", () => {
    const playlist: DashboardPlaylist = new DashboardPlaylist();
    const whoMay: Array<Array<string>> = rowsOf(tables(whoSection)[0]);
    const rows: Array<{
      action: string;
      model: "create" | "read" | "update" | "delete";
    }> = [
      { action: "See and play playlists", model: "read" },
      { action: "Create playlists", model: "create" },
      {
        action: "Change a playlist: its name, dashboards and time",
        model: "update",
      },
      { action: "Delete a playlist", model: "delete" },
    ];

    expect(
      whoMay.map((row: Array<string>): string => {
        return row[0] || "";
      }),
    ).toEqual(
      rows.map((row: { action: string }): string => {
        return row.action;
      }),
    );

    for (const row of rows) {
      const cell: string =
        whoMay.find((item: Array<string>): boolean => {
          return item[0] === row.action;
        })?.[1] || "";
      const granted: { roles: Array<string>; grants: Array<string> } =
        rolesAndGrants(modelPermissions(playlist, row.model));

      expect({
        action: row.action,
        roles: rolesNamedIn(cell),
        grants: codeSpansIn(cell),
      }).toEqual({
        action: row.action,
        roles: granted.roles,
        grants: granted.grants,
      });
    }
  });

  it("quotes what the player says with nothing to play, and how often it looks again", () => {
    const player: string = readSource(PLAYLIST_PLAYER);
    const states: Array<Array<string>> = rowsOf(tables(whoSection)[1]);

    for (const quote of [
      "Nothing to show yet",
      "Playlist not found",
      "Could not load this playlist",
      "Try again",
    ]) {
      expect(player).toContain(`"${quote}"`);
      expect(
        states.some((row: Array<string>): boolean => {
          return (row[1] || "").includes(bold(quote));
        }),
      ).toBe(true);
    }

    expect(readSource(USE_PLAYLIST_PLAYER)).toContain(
      "export const PLAYLIST_PLAYER_READ_AGAIN_IN_MS: number = 60 * 1000;",
    );
    expect(
      states.filter((row: Array<string>): boolean => {
        return (row[1] || "").includes("every minute");
      }).length,
    ).toBe(2);
  });
});
