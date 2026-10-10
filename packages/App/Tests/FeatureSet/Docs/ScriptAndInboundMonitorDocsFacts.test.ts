import CriteriaFilterUtil from "../../../FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter";
import {
  MONITOR_TYPES_OFFERED_5_MINUTES_OR_LONGER,
  getMonitoringIntervalOptions,
} from "../../../FeatureSet/Dashboard/src/Utils/MonitorIntervalDropdownOptions";
import { readPage } from "./DocsContentSupport";
import CustomCodeMonitoringCriteria from "Common/Server/Utils/Monitor/Criteria/CustomCodeMonitorCriteria";
import CompareCriteria from "Common/Server/Utils/Monitor/Criteria/CompareCriteria";
import {
  MaxCapturedMetricAttributeKeyLength,
  MaxCapturedMetricAttributeValueLength,
  MaxCapturedMetricAttributes,
} from "Common/Server/Utils/Monitor/CapturedMetricAttributeUtil";
import IncomingRequestIncidentGrouping, {
  IncomingRequestGroupingItem,
} from "Common/Server/Utils/Monitor/IncomingRequestIncidentGrouping";
import { AllResourceIdentityLabelKeys } from "Common/Server/Utils/Monitor/SeriesResourceLabels";
import BrowserType from "Common/Types/BrowserType";
import { JSONObject } from "Common/Types/JSON";
import {
  CheckOn,
  CriteriaFilter,
  CriteriaFilterUtil as CommonCriteriaFilterUtil,
  FilterType,
} from "Common/Types/Monitor/CriteriaFilter";
import CustomCodeMonitorResponse, {
  CustomCodeMonitorResult,
} from "Common/Types/Monitor/CustomCodeMonitor/CustomCodeMonitorResponse";
import ExternalStatusPageProviderType from "Common/Types/Monitor/ExternalStatusPageProviderType";
import FilterCondition from "Common/Types/Filter/FilterCondition";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import { MonitorStepExternalStatusPageMonitorUtil } from "Common/Types/Monitor/MonitorStepExternalStatusPageMonitor";
import {
  DEFAULT_SQL_CONNECTION_TIMEOUT_IN_MS,
  DEFAULT_SQL_MAX_ROWS,
  DEFAULT_SQL_STATEMENT_TIMEOUT_IN_MS,
  MAX_SQL_CONNECTION_TIMEOUT_IN_MS,
  MAX_SQL_MAX_ROWS,
  MAX_SQL_STATEMENT_TIMEOUT_IN_MS,
  MonitorStepSqlMonitorUtil,
} from "Common/Types/Monitor/MonitorStepSqlMonitor";
import MonitorType, { MonitorTypeHelper } from "Common/Types/Monitor/MonitorType";
import SqlDatabaseType, {
  SqlDatabaseTypeUtil,
} from "Common/Types/Monitor/SqlDatabaseType";
import ObjectID from "Common/Types/ObjectID";
import ScreenSizeType from "Common/Types/ScreenSizeType";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import TemplateVariablesCatalog, {
  TemplateVariable,
  TemplateVariableGroup,
} from "Common/UI/Components/MonitorTemplateVariables/TemplateVariablesCatalog";
import {
  CUSTOM_LOCAL_PART_MAX_LENGTH,
  CUSTOM_LOCAL_PART_MIN_LENGTH,
  RESERVED_CUSTOM_LOCAL_PARTS,
} from "Common/Utils/Monitor/IncomingEmailMonitorAddress";
import { EVERY_THIRTY_SECONDS } from "Common/Utils/CronTime";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the English Custom Code, SQL Query, Synthetic, Incoming Request,
 * Incoming Email and External Status Page monitor pages say about the
 * product, held to the code that makes it true.
 *
 * Markdown is not compiled, so nothing else notices when the type picker
 * moves a type, a criteria filter or condition is added, a default criteria
 * changes, a sandbox, probe or ingest limit moves, or the text of a failure
 * a reader is told to look for changes. Each test reads the source of truth -
 * the dashboard's form helpers, the criteria types and evaluators, the
 * probe's own sources (read as text: the probe is its own package), the
 * nginx template - and checks the page still says what it does. Where the
 * product can run what the page shows (a Field Path, a grouping path), the
 * test runs it. ScriptAndInboundMonitorDocsTranslations holds the
 * translations to these English pages; IncomingEmailMonitorDocs holds the
 * Incoming Email page's address card, verification section and template
 * variables.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const REPO_DIR: string = path.resolve(PACKAGES_DIR, "..");

const PROBE_CONFIG_FILE: string = "Probe/Config.ts";
const PROBE_CUSTOM_CODE_FILE: string =
  "Probe/Utils/Monitors/MonitorTypes/CustomCodeMonitor.ts";
const PROBE_SYNTHETIC_FILE: string =
  "Probe/Utils/Monitors/MonitorTypes/SyntheticMonitor.ts";
const PROBE_SQL_FILE: string = "Probe/Utils/Monitors/MonitorTypes/SqlMonitor.ts";
const PROBE_STATUS_PAGE_FILE: string =
  "Probe/Utils/Monitors/MonitorTypes/ExternalStatusPageMonitor.ts";
const SYNTHETIC_BOOTSTRAP_FILE: string =
  "Probe/Utils/Monitors/SyntheticRuntime/WorkerBootstrap.ts";
const SYNTHETIC_BROKER_FILE: string =
  "Probe/Utils/Monitors/SyntheticRuntime/PlaywrightCapabilityBroker.ts";
const SYNTHETIC_RPC_FILE: string =
  "Probe/Utils/Monitors/SyntheticRuntime/RpcProtocol.ts";
const VM_RUNNER_FILE: string = "Common/Server/Utils/VM/VMRunner.ts";
const METRIC_UTIL_FILE: string = "Common/Server/Utils/Monitor/MonitorMetricUtil.ts";
const ATTRIBUTE_UTIL_FILE: string =
  "Common/Server/Utils/Monitor/CapturedMetricAttributeUtil.ts";
const MONITOR_STEP_FORM_FILE: string =
  "App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorStep.tsx";
const CRITERIA_FILTER_FORM_FILE: string =
  "App/FeatureSet/Dashboard/src/Components/Form/Monitor/CriteriaFilter.tsx";
const CRITERIA_INSTANCE_FORM_FILE: string =
  "App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorCriteriaInstance.tsx";
const SQL_FORM_FILE: string =
  "App/FeatureSet/Dashboard/src/Components/Form/Monitor/SqlMonitor/SqlMonitorStepForm.tsx";
const STATUS_PAGE_FORM_FILE: string =
  "App/FeatureSet/Dashboard/src/Components/Form/Monitor/ExternalStatusPageMonitor/ExternalStatusPageMonitorStepForm.tsx";
const SQL_SUMMARY_FILE: string =
  "App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/SqlMonitorView.tsx";
const CUSTOM_CODE_SUMMARY_FILE: string =
  "App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/CustomMonitorSummaryView.tsx";
const MONITOR_SETTINGS_FILE: string =
  "App/FeatureSet/Dashboard/src/Pages/Monitor/View/Settings.tsx";
const SETUP_CARD_FILE: string =
  "App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorSetupCard.tsx";
const CONNECTION_CARD_FILE: string =
  "App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorConnectionCard.tsx";
const INCOMING_REQUEST_API_FILE: string =
  "App/FeatureSet/Telemetry/API/IncomingRequestIngest/IncomingRequest.ts";
const HEARTBEAT_JOB_FILE: string =
  "App/FeatureSet/Workers/Jobs/IncomingRequestMonitor/CheckHeartbeat.ts";
const EMAIL_JOB_FILE: string =
  "App/FeatureSet/Workers/Jobs/IncomingEmailMonitor/CheckOnlineStatus.ts";
const SECRETS_FILE: string = "App/FeatureSet/Telemetry/Utils/Monitor.ts";
const NGINX_TEMPLATE_FILE: string = "Nginx/default.conf.template";
const HELM_VALUES_FILE: string = "HelmChart/Public/oneuptime/values.yaml";

const CUSTOM_CODE_PAGE: string = "monitor/custom-code-monitor";
const SQL_PAGE: string = "monitor/sql-monitor";
const SYNTHETIC_PAGE: string = "monitor/synthetic-monitor";
const INCOMING_REQUEST_PAGE: string = "monitor/incoming-request-monitor";
const INCOMING_EMAIL_PAGE: string = "monitor/incoming-email-monitor";
const STATUS_PAGE_PAGE: string = "monitor/external-status-page-monitor";

interface PickerPage {
  page: string;
  monitorType: MonitorType;
  // The word the page tells readers to type in the picker's search box.
  searchWord: string;
}

const PICKER_PAGES: ReadonlyArray<PickerPage> = [
  {
    page: CUSTOM_CODE_PAGE,
    monitorType: MonitorType.CustomJavaScriptCode,
    searchWord: "script",
  },
  { page: SQL_PAGE, monitorType: MonitorType.SQLQuery, searchWord: "query" },
  {
    page: SYNTHETIC_PAGE,
    monitorType: MonitorType.SyntheticMonitor,
    searchWord: "playwright",
  },
  {
    page: INCOMING_EMAIL_PAGE,
    monitorType: MonitorType.IncomingEmail,
    searchWord: "email",
  },
  {
    page: STATUS_PAGE_PAGE,
    monitorType: MonitorType.ExternalStatusPage,
    searchWord: "statuspage",
  },
];

const HEADING_LINE: RegExp = /^(#{1,6})\s/;
const FENCE_LINE: RegExp = /^\s*```/;
const BOLD_SPAN: RegExp = /\*\*([^*\n]+?)\*\*/g;
const CODE_SPAN: RegExp = /`([^`\n]+)`/g;
const DEFAULT_VALUE: RegExp = /defaultValue: ([\d *]+),/;
const NUMBER_PRODUCT: RegExp = /^(\d+)(?:\s*\*\s*(\d+))*$/;
// The keywords of the probe's first forbidden-construct regex: /\b(?:insert|update|...)\b/i.
const FIRST_KEYWORD_ALTERNATION: RegExp = /\/\\b\(\?:([a-z|]+)\)\\b\/i/;
// The end of an nginx location block, at its indentation.
const NGINX_BLOCK_END: string = "\n    }";

const SAMPLE_NAME: string = "Acme";

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relativePath), "utf8");
}

function englishPage(page: string): string {
  return readPage("en", page);
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

// The first cell of each row, without its bold or code markers.
function firstCells(rows: Array<Array<string>>): Array<string> {
  return rows.map((row: Array<string>): string => {
    return (row[0] || "").replace(/\*\*|`/g, "").trim();
  });
}

function sorted(values: Array<string>): Array<string> {
  return [...values].sort();
}

/*
 * The source between `start` and the first `end` after it - the body of a
 * declaration, from its name to the next one.
 */
function sourceBetween(source: string, start: string, end: string): string {
  const from: number = source.indexOf(start);

  expect({ start, found: from >= 0 }).toEqual({ start, found: true });

  const to: number = source.indexOf(end, from + start.length);

  return source.slice(from, to < 0 ? undefined : to);
}

// The default of a probe setting read with NumberUtil.parseNumberWithDefault.
function probeDefault(name: string): number {
  const declaration: string = sourceBetween(
    readRepoFile(PROBE_CONFIG_FILE),
    `export const ${name}`,
    "});",
  );
  const literal: string | undefined = declaration.match(DEFAULT_VALUE)?.[1];

  expect({ name, literal: Boolean(literal) }).toEqual({ name, literal: true });

  return evaluateProduct(literal as string);
}

// "1536 * 1024 * 1024" -> 1610612736.
function evaluateProduct(expression: string): number {
  const trimmed: string = expression.trim();

  expect({ expression: trimmed, product: NUMBER_PRODUCT.test(trimmed) }).toEqual(
    { expression: trimmed, product: true },
  );

  return trimmed
    .split("*")
    .map((factor: string): number => {
      return Number(factor.trim());
    })
    .reduce((product: number, factor: number): number => {
      return product * factor;
    }, 1);
}

// A `const NAME = <number>;` or `const NAME: number = <number>;` in a source.
function numberConstant(source: string, name: string): number {
  const match: RegExpMatchArray | null = source.match(
    new RegExp(`const ${name}(?:: number)? =\\s*([\\d_ *]+);`),
  );

  expect({ name, found: Boolean(match) }).toEqual({ name, found: true });

  return evaluateProduct((match![1] as string).replace(/_/g, ""));
}

// The criteria form's filters for a monitor type, by the label it draws.
function offeredFilters(monitorType: MonitorType): Array<string> {
  return CriteriaFilterUtil.getCheckOnOptionsByMonitorType(monitorType).map(
    (option: DropdownOption): string => {
      return option.label;
    },
  );
}

function conditionsOf(checkOn: CheckOn): Array<string> {
  return CriteriaFilterUtil.getFilterTypeOptionsByCheckOn(checkOn).map(
    (option: DropdownOption): string => {
      return option.value.toString();
    },
  );
}

function defaultCriteriaFor(
  monitorType: MonitorType,
): Array<MonitorCriteriaInstance> {
  return (
    MonitorCriteria.getDefaultMonitorCriteria({
      monitorType: monitorType,
      monitorName: SAMPLE_NAME,
      onlineMonitorStatusId: ObjectID.generate(),
      offlineMonitorStatusId: ObjectID.generate(),
      defaultIncidentSeverityId: ObjectID.generate(),
      defaultAlertSeverityId: ObjectID.generate(),
    }).data?.monitorCriteriaInstanceArray || []
  );
}

interface FilterShape {
  checkOn: CheckOn;
  filterType: FilterType | undefined;
  value: string | number | undefined;
}

function filtersOf(instance: MonitorCriteriaInstance): Array<FilterShape> {
  return (instance.data?.filters || []).map(
    (filter: CriteriaFilter): FilterShape => {
      return {
        checkOn: filter.checkOn,
        filterType: filter.filterType,
        value: filter.value as string | number | undefined,
      };
    },
  );
}

// The variables the template-variables picker offers a monitor type's own group.
function templateVariablesOf(
  monitorType: MonitorType,
  groupTitle: string,
): Array<string> {
  const group: TemplateVariableGroup | undefined =
    TemplateVariablesCatalog.getVariables({ monitorType: monitorType }).find(
      (candidate: TemplateVariableGroup): boolean => {
        return candidate.title === groupTitle;
      },
    );

  expect({ groupTitle, found: Boolean(group) }).toEqual({
    groupTitle,
    found: true,
  });

  return group!.variables.map((variable: TemplateVariable): string => {
    return variable.key;
  });
}

// Whether a Result Value filter with this path and condition matches a returned value.
async function resultValueMatches(data: {
  result: CustomCodeMonitorResult;
  path?: string | undefined;
  filterType: FilterType;
  value?: string | undefined;
}): Promise<boolean> {
  const response: CustomCodeMonitorResponse = {
    result: data.result,
    scriptError: undefined,
    logMessages: [],
    capturedMetrics: [],
    executionTimeInMS: 10,
  };
  const filter: CriteriaFilter = {
    checkOn: CheckOn.ResultValue,
    filterType: data.filterType,
    value: data.value,
    customCodeMonitorOptions: data.path
      ? { resultValuePath: data.path }
      : undefined,
  } as CriteriaFilter;

  const message: string | null =
    await CustomCodeMonitoringCriteria.isMonitorInstanceCriteriaFilterMet({
      monitorResponse: response,
      criteriaFilter: filter,
    });

  return message !== null;
}

function groupingKeys(
  requestBody: JSONObject,
  groupByJSONPath: string,
  resolved?: { path: string; value: string },
): Array<string> {
  return IncomingRequestIncidentGrouping.extractItems({
    requestBody: requestBody,
    grouping: {
      groupByJSONPath: groupByJSONPath,
      resolvedWhenJSONPath: resolved?.path,
      resolvedWhenValue: resolved?.value,
    },
  }).map((item: IncomingRequestGroupingItem): string => {
    return `${item.keyValue}${item.isResolved ? " (resolved)" : ""}`;
  });
}

describe("the type picker, on every page that names it", () => {
  it.each(PICKER_PAGES)(
    "$page names the type, its category and a word the search finds",
    (entry: PickerPage) => {
      const page: string = englishPage(entry.page);
      const title: string = MonitorTypeHelper.getTitle(entry.monitorType);
      const category: string | undefined =
        MonitorTypeHelper.getMonitorTypeCategories().find(
          (candidate: { label: string; monitorTypes: Array<MonitorType> }) => {
            return candidate.monitorTypes.includes(entry.monitorType);
          },
        )?.label;

      // Only the six common types are on screen before More monitor types.
      expect(MonitorTypeHelper.getCommonMonitorTypes()).not.toContain(
        entry.monitorType,
      );
      expect(page).toContain(
        `click **More monitor types** and pick **${title}** under **${category}**, or type \`${entry.searchWord}\` in the search box.`,
      );
      expect(
        MonitorTypeHelper.getKeywords(entry.monitorType).some(
          (keyword: string): boolean => {
            return keyword.includes(entry.searchWord);
          },
        ) || title.toLowerCase().includes(entry.searchWord),
      ).toBe(true);
    },
  );

  it("the Incoming Request page picks a type that is on screen at once", () => {
    expect(MonitorTypeHelper.getCommonMonitorTypes()).toContain(
      MonitorType.IncomingRequest,
    );
    expect(
      section(englishPage(INCOMING_REQUEST_PAGE), "### Choose Incoming Request"),
    ).toContain(
      `pick **${MonitorTypeHelper.getTitle(MonitorType.IncomingRequest)}** — it is one of the common types at the top.`,
    );
  });

  it("offers the script monitors every 5 minutes or longer, and the status page monitor from every minute", () => {
    for (const monitorType of [
      MonitorType.CustomJavaScriptCode,
      MonitorType.SyntheticMonitor,
    ]) {
      expect(MONITOR_TYPES_OFFERED_5_MINUTES_OR_LONGER).toContain(monitorType);
      expect(
        getMonitoringIntervalOptions({ monitorType: monitorType })[0]?.label,
      ).toBe("Every 5 Minutes");
    }

    expect(englishPage(CUSTOM_CODE_PAGE)).toContain(
      "custom code monitors are offered every 5 minutes or longer",
    );
    expect(englishPage(SYNTHETIC_PAGE)).toContain(
      "synthetic monitors are offered every 5 minutes or longer",
    );
    expect(MONITOR_TYPES_OFFERED_5_MINUTES_OR_LONGER).not.toContain(
      MonitorType.ExternalStatusPage,
    );
    expect(
      getMonitoringIntervalOptions({
        monitorType: MonitorType.ExternalStatusPage,
      }).map((option: DropdownOption): string => {
        return option.label;
      }),
    ).toContain("Every 5 Minutes");
    expect(englishPage(STATUS_PAGE_PAGE)).toContain(
      "a **Monitoring Interval** — it starts at **Every 5 Minutes**",
    );
  });
});

describe("Custom Code Monitor", () => {
  const page: string = englishPage(CUSTOM_CODE_PAGE);
  const vmRunner: string = readRepoFile(VM_RUNNER_FILE);

  it("lists the criteria filters the form offers a custom code monitor", () => {
    const criteria: string = section(page, "## Criteria");

    expect(sorted(firstCells(tableRows(criteria)))).toEqual(
      sorted(offeredFilters(MonitorType.CustomJavaScriptCode)),
    );
  });

  it("lists each filter's conditions", () => {
    const rows: Array<Array<string>> = tableRows(section(page, "## Criteria"));
    const errorConditions: Array<string> = conditionsOf(CheckOn.Error);

    expect(sorted(((rows[0] as Array<string>)[2] as string).split(", "))).toEqual(
      sorted(errorConditions),
    );

    // Result Value: the same, plus the number and boolean conditions.
    const extra: Array<string> = conditionsOf(CheckOn.ResultValue).filter(
      (condition: string): boolean => {
        return !errorConditions.includes(condition);
      },
    );

    expect(conditionsOf(CheckOn.ResultValue)).toEqual(
      expect.arrayContaining(errorConditions),
    );
    expect((rows[1] as Array<string>)[2]).toBe(
      `The same, plus ${extra.slice(0, -1).join(", ")} and ${extra[extra.length - 1]}`,
    );
    expect(extra).toEqual(
      expect.arrayContaining([FilterType.True, FilterType.False]),
    );

    // Execution Time: numbers only.
    expect(sorted(conditionsOf(CheckOn.ExecutionTime))).toEqual(
      sorted([
        FilterType.GreaterThan,
        FilterType.LessThan,
        FilterType.GreaterThanOrEqualTo,
        FilterType.LessThanOrEqualTo,
      ]),
    );
    expect((rows[2] as Array<string>)[2]).toBe("Numeric comparisons");
  });

  it("starts with the two criteria the page describes", () => {
    const [offline, online] = defaultCriteriaFor(
      MonitorType.CustomJavaScriptCode,
    ) as [MonitorCriteriaInstance, MonitorCriteriaInstance];

    expect(filtersOf(offline)).toEqual([
      { checkOn: CheckOn.Error, filterType: FilterType.IsNotEmpty, value: undefined },
    ]);
    expect(offline.data?.createIncidents).toBe(true);
    expect(offline.data?.incidents[0]?.autoResolveIncident).toBe(true);
    expect(filtersOf(online)).toEqual([
      { checkOn: CheckOn.Error, filterType: FilterType.IsEmpty, value: undefined },
    ]);
    expect(online.data?.createIncidents).toBe(false);

    expect(page).toContain(
      "The monitor starts with two criteria: it is offline, and declares an incident, when the script fails, and online when it does not.",
    );
    expect(page).toContain(
      "The defaults mark the monitor online when **Error** is empty, and offline — with an incident that resolves itself when the script succeeds again — when it is not.",
    );
  });

  it("names the editor, the summary and its details as the dashboard does", () => {
    const form: string = readRepoFile(MONITOR_STEP_FORM_FILE);
    const summary: string = readRepoFile(CUSTOM_CODE_SUMMARY_FILE);

    expect(form).toContain('? "JavaScript Code"');
    expect(page).toContain("Write your script in the **JavaScript Code** editor.");

    for (const title of ["Log Messages", "Result", "Script Error"]) {
      expect(summary).toContain(`title: "${title}"`);
    }

    for (const title of [
      "Probe",
      "Execution Time (in ms)",
      "Error",
      "Show More Details",
    ]) {
      expect(summary).toContain(`title="${title}"`);
    }

    expect(page).toContain(
      "**Show More Details** shows the result, the script error and the log messages.",
    );
  });

  it("keeps only the data of what the script returns", () => {
    expect(readRepoFile(PROBE_CUSTOM_CODE_FILE)).toContain(
      "scriptResult.result = result?.returnValue?.data;",
    );
    expect(page).toContain(
      "Only the `data` property is kept: `return 5` records no result.",
    );
  });

  it("quotes the sandbox's limits: time, memory, logs and HTTP sizes", () => {
    expect(probeDefault("PROBE_CUSTOM_CODE_MONITOR_SCRIPT_TIMEOUT_IN_MS")).toBe(
      60000,
    );
    expect(page).toContain(
      "A script that runs longer than 60 seconds is stopped and the check fails with \"Script execution timed out\".",
    );
    expect(vmRunner).toContain('reject(new Error("Script execution timed out"));');
    expect(page).toContain("`PROBE_CUSTOM_CODE_MONITOR_SCRIPT_TIMEOUT_IN_MS`");

    expect(vmRunner).toContain("new ivm.Isolate({ memoryLimit: 128 })");
    expect(page).toContain("a 128 MB memory limit");

    expect(numberConstant(vmRunner, "MAX_LOG_MESSAGES")).toBe(1000);
    expect(page).toContain("The **Log Messages**, up to 1,000 per run.");

    expect(numberConstant(vmRunner, "MAX_HTTP_RESPONSE_BYTES")).toBe(
      10 * 1024 * 1024,
    );
    expect(numberConstant(vmRunner, "MAX_HTTP_REQUEST_BYTES")).toBe(
      10 * 1024 * 1024,
    );
    expect(page).toContain("Request and response sizes are limited (10 MB each)");
  });

  it("says axios follows no redirect and uses no proxy, as the bridge forces", () => {
    expect(vmRunner).toContain('safeConfig["maxRedirects"] = 0;');
    expect(vmRunner).toContain('safeConfig["proxy"] = false;');
    expect(page).toContain(
      "`axios` in this sandbox does not follow redirects, and its requests do not go through a proxy configured on the probe.",
    );
  });

  it("lists the axios methods, crypto functions and timers the sandbox has", () => {
    for (const method of [
      "get",
      "post",
      "put",
      "patch",
      "delete",
      "head",
      "options",
      "request",
      "create",
    ]) {
      expect(vmRunner).toContain(`instance.${method} = `);
    }

    expect(page).toContain(
      "call `axios(...)`, or `axios.get`, `post`, `put`, `patch`, `delete`, `head`, `options`, `request` and `create`.",
    );

    for (const fn of [
      "createHash",
      "createHmac",
      "randomBytes",
      "randomUUID",
      "randomInt",
    ]) {
      expect(vmRunner).toContain(`          ${fn}: (`);
    }

    expect(page).toContain(
      "`createHash` and `createHmac` (call `update()` once, then `digest()`), `randomBytes`, `randomInt` and `randomUUID`.",
    );

    // update() keeps the last data it was given, so it is called once.
    expect(vmRunner).toContain("update(d) { this._data = d; return this; },");

    for (const timer of ["setTimeout", "clearTimeout", "sleep"]) {
      expect(vmRunner).toContain(`            ${timer}: {`);
    }

    // Only console.log, and http/https only as Agent classes.
    expect(vmRunner).toContain("const sandboxConsole = Object.freeze({\n            log:");
    expect(vmRunner).toContain("const https = {\n          Agent: class Agent {");
    expect(page).toContain("Only `console.log` exists;");
  });

  it("quotes the custom metric limits and the stored name", () => {
    const limits: Array<Array<string>> = tableRows(section(page, "### Limits"));
    const attributeUtil: string = readRepoFile(ATTRIBUTE_UTIL_FILE);

    expect(numberConstant(vmRunner, "MAX_METRICS")).toBe(100);
    expect(vmRunner).toContain("name: String(name).substring(0, 200),");
    expect(MaxCapturedMetricAttributes).toBe(50);
    expect(MaxCapturedMetricAttributeKeyLength).toBe(200);
    expect(MaxCapturedMetricAttributeValueLength).toBe(1000);
    expect(attributeUtil).toContain("MaxCapturedMetricAttributes: number = 50");

    expect(limits).toEqual([
      ["Metrics per script execution", "100", "Further calls are ignored."],
      ["Metric name length", "200 characters", "The name is cut."],
      ["Attributes per metric", "50", "Further attributes are dropped."],
      ["Attribute key length", "200 characters", "The key is cut."],
      ["Attribute value length", "1000 characters", "The value is cut."],
    ]);

    expect(readRepoFile(METRIC_UTIL_FILE)).toContain(
      "const prefixedName: string = `custom.monitor.${customMetric.name}`;",
    );
    expect(page).toContain("It is stored with a `custom.monitor.` prefix automatically.");
  });

  it("lists exactly the attribute names a script cannot write", () => {
    const reserved: string = section(page, "### Reserved attribute keys");
    const attributeUtil: string = readRepoFile(ATTRIBUTE_UTIL_FILE);
    const identity: Array<string> = codeItems(
      sourceBetween(
        attributeUtil,
        "const MonitorIdentityAttributeKeys",
        "];",
      ).replace(/"([^"]+)"/g, "`$1`"),
    );

    expect(identity).toEqual([
      "monitorId",
      "projectId",
      "monitorName",
      "probeName",
      "probeId",
      "isCustomMetric",
    ]);

    // The monitor's identity, and the namespaces.
    for (const key of identity) {
      expect(reserved).toContain(`\`${key}\``);
    }

    expect(reserved).toContain("Anything in the `oneuptime.` or `resource.` namespaces");

    // Every resource identity key outside those namespaces, and no other.
    const outsideNamespaces: Array<string> = AllResourceIdentityLabelKeys.filter(
      (key: string): boolean => {
        return !key.startsWith("oneuptime.") && !key.startsWith("resource.");
      },
    );
    const listed: Array<string> = codeItems(
      reserved
        .split("\n")
        .find((line: string): boolean => {
          return line.startsWith("- Resource identity attributes:");
        }) || "",
    );

    expect(sorted(listed)).toEqual(sorted(outsideNamespaces));
  });

  it("names the template variables the picker offers a custom code monitor", () => {
    const offered: Array<string> = templateVariablesOf(
      MonitorType.CustomJavaScriptCode,
      "Custom Code",
    );

    for (const variable of [
      "result",
      "scriptError",
      "logMessages",
      "executionTimeInMs",
    ]) {
      expect(offered).toContain(variable);
      expect(page).toContain(`\`{{${variable}}}\``);
    }
  });

  describe("Alerting on the returned data, run against the evaluator", () => {
    const returned: CustomCodeMonitorResult = {
      status: "UP",
      cpu_busy_percent: 42,
      healthy: true,
      checks: [{ name: "db", latency: 12 }],
    } as unknown as CustomCodeMonitorResult;
    const fieldPaths: Array<Array<string>> = tableRows(
      section(page, "### Alerting on the returned data"),
    );

    it("documents the four example paths", () => {
      expect(firstCells(fieldPaths)).toEqual([
        "status",
        "cpu_busy_percent",
        "healthy",
        "checks[0].latency",
      ]);
    });

    it("compares the value each path names", async () => {
      expect(
        await resultValueMatches({
          result: returned,
          path: "status",
          filterType: FilterType.EqualTo,
          value: "UP",
        }),
      ).toBe(true);
      expect(
        await resultValueMatches({
          result: returned,
          path: "cpu_busy_percent",
          filterType: FilterType.EqualTo,
          value: "42",
        }),
      ).toBe(true);
      expect(
        await resultValueMatches({
          result: returned,
          path: "healthy",
          filterType: FilterType.True,
        }),
      ).toBe(true);
      expect(
        await resultValueMatches({
          result: returned,
          path: "checks[0].latency",
          filterType: FilterType.EqualTo,
          value: "12",
        }),
      ).toBe(true);
    });

    it("fires each example condition when the field goes bad, and not before", async () => {
      // status Not Equal To UP; cpu_busy_percent Greater Than 90; healthy False; latency Greater Than 500.
      expect(
        await resultValueMatches({
          result: returned,
          path: "status",
          filterType: FilterType.NotEqualTo,
          value: "UP",
        }),
      ).toBe(false);
      expect(
        await resultValueMatches({
          result: { status: "DOWN" } as unknown as CustomCodeMonitorResult,
          path: "status",
          filterType: FilterType.NotEqualTo,
          value: "UP",
        }),
      ).toBe(true);
      expect(
        await resultValueMatches({
          result: { cpu_busy_percent: 95 } as unknown as CustomCodeMonitorResult,
          path: "cpu_busy_percent",
          filterType: FilterType.GreaterThan,
          value: "90",
        }),
      ).toBe(true);
      expect(
        await resultValueMatches({
          result: { healthy: false } as unknown as CustomCodeMonitorResult,
          path: "healthy",
          filterType: FilterType.False,
        }),
      ).toBe(true);
      expect(
        await resultValueMatches({
          result: {
            checks: [{ latency: 900 }],
          } as unknown as CustomCodeMonitorResult,
          path: "checks[0].latency",
          filterType: FilterType.GreaterThan,
          value: "500",
        }),
      ).toBe(true);
    });

    it("matches number conditions only on numbers, as the page warns", async () => {
      expect(page).toContain(
        "Greater Than, Less Than and the other number conditions only match a number, so return a field as `42`, not `\"42\"`.",
      );
      expect(
        await resultValueMatches({
          result: { cpu: "95" } as unknown as CustomCodeMonitorResult,
          path: "cpu",
          filterType: FilterType.GreaterThan,
          value: "90",
        }),
      ).toBe(false);
    });

    it("treats a missing field as empty, and nothing else", async () => {
      expect(page).toContain(
        "A field that is not in the returned data — a missing key, or an array index past the end — compares as empty: **Is Empty** matches it, and no other condition does.",
      );
      expect(
        await resultValueMatches({
          result: returned,
          path: "checks[5].latency",
          filterType: FilterType.IsEmpty,
        }),
      ).toBe(true);
      expect(
        await resultValueMatches({
          result: returned,
          path: "missing",
          filterType: FilterType.NotEqualTo,
          value: "UP",
        }),
      ).toBe(false);
    });

    it("compares the whole value when the path is empty", async () => {
      expect(
        await resultValueMatches({
          result: "UP" as unknown as CustomCodeMonitorResult,
          filterType: FilterType.EqualTo,
          value: "UP",
        }),
      ).toBe(true);
    });

    it("draws the field as the dashboard does, and points Terraform users to its attribute", () => {
      expect(readRepoFile(CRITERIA_FILTER_FORM_FILE)).toContain(
        'title="Field Path (Optional)"',
      );
      expect(page).toContain(
        "fill in **Field Path (Optional)** on the Result Value filter",
      );
      expect(page).toContain(
        "the filter's `custom_code_monitor_options` sets the field path: see [Monitor Steps](/docs/terraform/monitor-steps#comparing-one-field-of-a-scripts-result).",
      );
      expect(englishPage("terraform/monitor-steps")).toContain(
        "### Comparing one field of a script's result",
      );
    });
  });
});

describe("Synthetic Monitor", () => {
  const page: string = englishPage(SYNTHETIC_PAGE);
  const probe: string = readRepoFile(PROBE_SYNTHETIC_FILE);
  const bootstrap: string = readRepoFile(SYNTHETIC_BOOTSTRAP_FILE);
  const broker: string = readRepoFile(SYNTHETIC_BROKER_FILE);
  const rpc: string = readRepoFile(SYNTHETIC_RPC_FILE);

  it("lists the browsers and the screen sizes, with their viewports", () => {
    expect(Object.values(BrowserType)).toEqual(["Chromium", "Firefox"]);
    expect(page).toContain("The browsers are Chromium and Firefox.");

    const viewports: Array<Array<string>> = tableRows(
      section(page, "## How it works"),
    );

    expect(firstCells(viewports)).toEqual(Object.values(ScreenSizeType));

    for (const [screen, viewport] of viewports as Array<[string, string]>) {
      const [width, height] = viewport.split(" × ");

      expect(
        sourceBetween(probe, `case ScreenSizeType.${screen}:`, "break;"),
      ).toContain(`viewPortHeight = ${height};\n        viewPortWidth = ${width};`);
    }
  });

  it("names the form's fields and the retry cap as the dashboard does", () => {
    const form: string = readRepoFile(MONITOR_STEP_FORM_FILE);

    for (const title of [
      '"Playwright Code"',
      'title={"Browser Type"}',
      'title={"Screen Type"}',
      'title={"Retry Count on Error"}',
    ]) {
      expect(form).toContain(title);
    }

    expect(form).toContain(
      ": retryCountOnError > 5\n                      ? 5",
    );
    expect(page).toContain(
      "Under **More fields**, **Retry Count on Error** retries a failed run up to 5 times.",
    );
  });

  it("lists the criteria filters the form offers a synthetic monitor", () => {
    expect(sorted(firstCells(tableRows(section(page, "## Criteria"))))).toEqual(
      sorted(offeredFilters(MonitorType.SyntheticMonitor)),
    );
    expect(conditionsOf(CheckOn.BrowserType)).toEqual([
      FilterType.EqualTo,
      FilterType.NotEqualTo,
    ]);
    expect(conditionsOf(CheckOn.ScreenSizeType)).toEqual([
      FilterType.EqualTo,
      FilterType.NotEqualTo,
    ]);
  });

  it("starts with the same two criteria as a custom code monitor", () => {
    const synthetic: Array<Array<FilterShape>> = defaultCriteriaFor(
      MonitorType.SyntheticMonitor,
    ).map(filtersOf);

    expect(synthetic).toEqual(
      defaultCriteriaFor(MonitorType.CustomJavaScriptCode).map(filtersOf),
    );
    expect(page).toContain(
      "The monitor starts with two criteria: it is offline, and declares an incident, when a run fails, and online when none does.",
    );
  });

  it("quotes the probe's limits and the settings that change them", () => {
    const limits: Array<Array<string>> = tableRows(section(page, "## Limits"));

    expect(probeDefault("PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS")).toBe(
      60000,
    );
    expect(probeDefault("PROBE_SYNTHETIC_MONITOR_MAX_PROCESS_TREE_RSS_BYTES")).toBe(
      1.5 * 1024 * 1024 * 1024,
    );
    expect(probeDefault("PROBE_SYNTHETIC_MONITOR_MAX_DISK_BYTES")).toBe(
      256 * 1024 * 1024,
    );
    expect(probeDefault("PROBE_SYNTHETIC_MONITOR_MAX_CONCURRENCY")).toBe(4);
    expect(numberConstant(bootstrap, "MAX_CONTEXT_PAGES")).toBe(8);

    expect(
      limits.map((row: Array<string>): string => {
        return `${row[0]} | ${(row[1] || "").split(".")[0]} | ${row[2]}`;
      }),
    ).toEqual([
      "Script timeout | 60 seconds | `PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS`",
      "Memory for a run's whole process tree | 1 | `PROBE_SYNTHETIC_MONITOR_MAX_PROCESS_TREE_RSS_BYTES`",
      "Writable browser storage | 256 MiB | `PROBE_SYNTHETIC_MONITOR_MAX_DISK_BYTES`",
      "Runs at the same time on one probe | 4 | `PROBE_SYNTHETIC_MONITOR_MAX_CONCURRENCY`",
      "Pages per execution | 8 | —",
    ]);
    expect((limits[1] as Array<string>)[1]).toBe("1.5 GiB");
    expect(page).toContain("Each execution can use up to eight pages.");

    // The Helm chart's probe setting of the same name.
    expect(fs.readFileSync(path.join(REPO_DIR, HELM_VALUES_FILE), "utf8")).toContain(
      "syntheticMonitorScriptTimeoutInMs: 60000",
    );
    expect(page).toContain("(for example `syntheticMonitorScriptTimeoutInMs`)");
  });

  it("quotes the screenshot and result limits", () => {
    expect(numberConstant(rpc, "MAX_SCREENSHOTS")).toBe(20);
    expect(numberConstant(rpc, "MAX_SCREENSHOT_BYTES")).toBe(10_000_000);
    expect(numberConstant(rpc, "MAX_TOTAL_SCREENSHOT_BYTES")).toBe(50_000_000);
    expect(page).toContain("A run keeps up to 20 screenshots, each up to 10 MB and 50 MB in all.");

    expect(numberConstant(bootstrap, "MAX_RESULT_BYTES")).toBe(5_000_000);
    expect(numberConstant(bootstrap, "MAX_SERIALIZATION_DEPTH")).toBe(30);
    expect(page).toContain(
      "A result that is circular, nested more than 30 levels deep, or larger than 5 MB fails the run instead.",
    );
  });

  it("quotes the axios limits the broker enforces", () => {
    const axiosConfig: string = sourceBetween(
      broker,
      "const config: AxiosRequestConfig = {",
      "};",
    );

    expect(axiosConfig).toContain("maxBodyLength: 1_000_000,");
    expect(axiosConfig).toContain("maxContentLength: MAX_RPC_RESULT_BYTES,");
    expect(numberConstant(rpc, "MAX_RPC_RESULT_BYTES")).toBe(5_000_000);
    expect(axiosConfig).toContain("        5,\n      ),");
    expect(axiosConfig).toContain("        30_000,\n      ),");
    expect(page).toContain(
      "A request body can be up to 1 MB and a response up to 5 MB; it follows up to 5 redirects and times out after at most 30 seconds.",
    );
  });

  it("lists the events page.waitForEvent waits for, and the permissions a script can grant", () => {
    for (const event of [
      "dialog",
      "domcontentloaded",
      "load",
      "popup",
      "request",
      "requestfailed",
      "requestfinished",
      "response",
    ]) {
      expect(broker).toContain(`"${event}"`);
    }

    expect(page).toContain(
      "`page.waitForEvent(...)` waits for `dialog`, `domcontentloaded`, `load`, `popup`, `request`, `requestfailed`, `requestfinished` and `response`.",
    );
    expect(broker).toContain(
      'return permission === "geolocation" || permission === "notifications";',
    );
    expect(page).toContain(
      "Browser permissions are limited to geolocation and notifications.",
    );
  });

  it("blocks the script's own network connections, as the page says", () => {
    for (const blocked of ['"fetch"', '"XMLHttpRequest"', '"WebSocket"']) {
      expect(bootstrap).toContain(blocked);
    }

    expect(page).toContain(
      "`fetch`, `XMLHttpRequest` and `WebSocket` are blocked.",
    );
    expect(bootstrap).toContain(
      "log: (...args) => captureLog(args), info: (...args) => captureLog(args),",
    );
    expect(bootstrap).toContain(
      "warn: (...args) => captureLog(args), error: (...args) => captureLog(args),",
    );
  });

  it("keeps at most 100 custom metrics per check, across every run", () => {
    expect(numberConstant(bootstrap, "MAX_METRICS")).toBe(100);
    expect(readRepoFile(METRIC_UTIL_FILE)).toContain(
      "...syntheticCustomMetrics,\n    ].slice(0, 100);",
    );
    expect(page).toContain(
      "A run can capture at most 100 metrics, with numeric values only, and OneUptime keeps at most 100 per check across all of its runs.",
    );
  });

  it("names the one template variable that holds every run", () => {
    expect(
      templateVariablesOf(MonitorType.SyntheticMonitor, "Synthetic Monitor"),
    ).toContain("syntheticResponses");
    expect(page).toContain("every run is in `{{syntheticResponses}}`");
  });
});

describe("SQL Query Monitor", () => {
  const page: string = englishPage(SQL_PAGE);
  const probe: string = readRepoFile(PROBE_SQL_FILE);

  it("lists the supported databases and the port each starts with", () => {
    const rows: Array<Array<string>> = tableRows(
      section(page, "## Supported databases"),
    );

    expect(firstCells(rows)).toEqual(
      SqlDatabaseTypeUtil.getSupportedDatabaseTypes().map(
        (type: SqlDatabaseType): string => {
          return type;
        },
      ),
    );

    for (const [database, port] of rows as Array<[string, string]>) {
      expect(port).toBe(
        `\`${SqlDatabaseTypeUtil.getDefaultPort(database.replace(/\*\*/g, "") as SqlDatabaseType)}\``,
      );
    }
  });

  it("quotes each limit's default and maximum", () => {
    const defaults: ReturnType<typeof MonitorStepSqlMonitorUtil.getDefault> =
      MonitorStepSqlMonitorUtil.getDefault();

    expect(defaults.connectionTimeoutInMs).toBe(DEFAULT_SQL_CONNECTION_TIMEOUT_IN_MS);
    expect(tableRows(section(page, "### More fields"))).toEqual([
      [
        "**Connection Timeout (ms)**",
        `\`${DEFAULT_SQL_CONNECTION_TIMEOUT_IN_MS}\``,
        `\`${MAX_SQL_CONNECTION_TIMEOUT_IN_MS}\``,
        "How long to wait to establish a connection.",
      ],
      [
        "**Statement Timeout (ms)**",
        `\`${DEFAULT_SQL_STATEMENT_TIMEOUT_IN_MS}\``,
        `\`${MAX_SQL_STATEMENT_TIMEOUT_IN_MS}\``,
        "The hard cap on how long the query may run.",
      ],
      [
        "**Max Rows**",
        `\`${DEFAULT_SQL_MAX_ROWS}\``,
        `\`${MAX_SQL_MAX_ROWS}\``,
        "The upper bound on rows read back from the database.",
      ],
    ]);

    // A value above the maximum is lowered to it.
    expect(
      MonitorStepSqlMonitorUtil.fromJSON({ maxRows: MAX_SQL_MAX_ROWS * 5 }).maxRows,
    ).toBe(MAX_SQL_MAX_ROWS);
    expect(page).toContain("A value above the maximum is lowered to the maximum.");
  });

  it("names every field as the form draws it", () => {
    const form: string = readRepoFile(SQL_FORM_FILE);
    const fields: Array<string> = firstCells(
      tableRows(section(page, "## Configuration")),
    );

    for (const field of fields) {
      expect({ field, drawn: form.includes(`title="${field}"`) }).toEqual({
        field,
        drawn: true,
      });
    }

    expect(form).toContain('title="Verify server certificate"');
    expect(page).toContain("**Verify server certificate**");
  });

  it("quotes the read-only rules and the messages the probe fails a check with", () => {
    expect(probe).toContain(
      'return "Only read-only queries are allowed (must start with SELECT, WITH, VALUES, or TABLE).";',
    );
    expect(page).toContain(
      'each check fails with "Only read-only queries are allowed (must start with SELECT, WITH, VALUES, or TABLE)."',
    );
    expect(probe).toContain(
      'const ALLOWED_FIRST_TOKENS: Array<string> = [\n  "select",\n  "with",\n  "values",\n  "table",\n];',
    );
    expect(probe).toContain("return `Disallowed SQL keyword ");
    expect(page).toContain(':::details A check fails with "Disallowed SQL keyword"');

    const forbidden: Array<string> = (
      sourceBetween(probe, "const FORBIDDEN_CONSTRUCTS", "];").match(
        FIRST_KEYWORD_ALTERNATION,
      )?.[1] || ""
    ).split("|");

    for (const keyword of ["insert", "update", "delete", "drop", "exec", "into"]) {
      expect({ keyword, refused: forbidden.includes(keyword) }).toEqual({
        keyword,
        refused: true,
      });
    }

    // Comments and quoted text are stripped before the checks.
    expect(probe).toContain(
      "let normalized: string = this.stripComments(query).trim();",
    );
    expect(probe).toContain(
      "const withoutStrings: string = this.stripStringLiterals(normalized);",
    );
  });

  it("runs the query read-only on every engine", () => {
    expect(probe).toContain('await client.query("START TRANSACTION READ ONLY");');
    expect(page).toContain(
      "On PostgreSQL and MySQL the probe opens a `READ ONLY` transaction",
    );
  });

  it("names the driver the probe image ships and the setting that pins another", () => {
    expect(probe).toContain(
      'export const SQL_SERVER_ODBC_DRIVER: string = "ODBC Driver 18 for SQL Server";',
    );
    expect(probe).toContain('process.env["SQL_SERVER_ODBC_DRIVER"]');
    expect(page).toContain("The official probe image bundles **ODBC Driver 18**.");
    expect(page).toContain("set the `SQL_SERVER_ODBC_DRIVER` environment variable");
  });

  it("redacts what the page says it redacts", () => {
    expect(probe).toContain(
      "const sanitized: string = SqlMonitor.sanitizeError(err, config.password, [\n        config.host,\n        config.username,\n        config.databaseName,\n      ]);",
    );
    expect(probe).toContain('"[redacted-dsn]"');
    expect(page).toContain(
      "the password, the host, username and database name, and any connection string are redacted",
    );
  });

  it("retries a failed query as the page says", () => {
    const execute: string = sourceBetween(
      probe,
      "MonitorRetry.canRetry({\n          attemptNumber: options.currentRetryCount,\n          retries: options.retry,",
      "return await SqlMonitor.execute(config, options);",
    );

    expect(execute).toContain("await Sleep.sleep(1000);");
    // No Retries field on the SQL form, so the probe's own setting decides.
    expect(readRepoFile(SQL_FORM_FILE)).not.toContain("Retries");
    expect(probeDefault("PROBE_MONITOR_RETRY_LIMIT")).toBe(3);
    expect(page).toContain(
      "A check whose query fails is tried again a second later, up to three more times, before it reports the error",
    );
    expect(page).toContain("`PROBE_MONITOR_RETRY_LIMIT` sets how many times.");
  });

  it("lists the criteria filters the form offers, none over a period of time", () => {
    const filters: Array<string> = firstCells(
      tableRows(section(page, "## Setting up criteria")),
    );
    const offered: Array<string> = offeredFilters(MonitorType.SQLQuery);

    expect(sorted(filters)).toEqual(sorted(offered));

    for (const checkOn of [
      CheckOn.SqlIsOnline,
      CheckOn.SqlQueryRowCount,
      CheckOn.SqlQueryScalarValue,
      CheckOn.SqlQueryExecutionTime,
      CheckOn.SqlQueryError,
    ]) {
      expect(CommonCriteriaFilterUtil.isEvaluateOverTimeFilter(checkOn)).toBe(
        false,
      );
    }

    expect(page).toContain(
      "SQL Query filters cannot be evaluated over a period of time; each check stands on its own.",
    );
  });

  it("reads a number threshold as a whole number", () => {
    expect(CompareCriteria.convertToNumber("10.5")).toBe(10);
    expect(page).toContain("Numeric thresholds are whole numbers: write `10`, not `10.5`.");
  });

  it("starts with the two criteria the page describes", () => {
    const [offline, online] = defaultCriteriaFor(MonitorType.SQLQuery) as [
      MonitorCriteriaInstance,
      MonitorCriteriaInstance,
    ];

    expect(filtersOf(offline)).toEqual([
      { checkOn: CheckOn.SqlIsOnline, filterType: FilterType.False, value: undefined },
    ]);
    expect(offline.data?.createIncidents).toBe(true);
    expect(offline.data?.incidents[0]?.autoResolveIncident).toBe(true);
    expect(filtersOf(online)).toEqual([
      { checkOn: CheckOn.SqlIsOnline, filterType: FilterType.True, value: undefined },
    ]);
  });

  it("has no template variables of its own, as the page says", () => {
    const titles: Array<string> = TemplateVariablesCatalog.getVariables({
      monitorType: MonitorType.SQLQuery,
    }).map((group: TemplateVariableGroup): string => {
      return group.title;
    });

    expect(titles).toContain("Monitor");
    expect(titles).not.toContain("SQL Query");
    expect(page).toContain(
      "A SQL Query monitor has no template variables of its own",
    );
  });

  it("fills secrets into the fields the page names, and not the port", () => {
    const secrets: string = sourceBetween(
      readRepoFile(SECRETS_FILE),
      "if (monitorType === MonitorType.SQLQuery) {",
      "if (monitorType === MonitorType.Database) {",
    );

    expect(secrets).toContain(
      '> = ["password", "username", "host", "databaseName", "query"];',
    );
    expect(page).toContain(
      "The **Username**, **Host**, **Database Name** and **SQL Query** fields accept secret references too; **Port** does not.",
    );
  });

  it("names the summary's truncation row as the dashboard draws it", () => {
    const summary: string = readRepoFile(SQL_SUMMARY_FILE);

    expect(summary).toContain('title="Rows Truncated"');
    expect(summary).toContain('"Yes (result capped)"');
    expect(page).toContain(
      'the check summary shows **Rows Truncated**: "Yes (result capped)"',
    );
  });
});

describe("Incoming Request Monitor", () => {
  const page: string = englishPage(INCOMING_REQUEST_PAGE);

  it("accepts GET and POST at the URL the page gives, and answers before it checks anything", () => {
    const api: string = readRepoFile(INCOMING_REQUEST_API_FILE);
    const nginx: string = readRepoFile(NGINX_TEMPLATE_FILE);
    const heartbeat: string = sourceBetween(
      nginx,
      "location /heartbeat {",
      NGINX_BLOCK_END,
    );

    expect(api).toContain('router.post(\n  "/incoming-request/:secretkey",');
    expect(api).toContain('router.get(\n  "/incoming-request/:secretkey",');
    expect(api).not.toContain("router.put(");
    expect(heartbeat).toContain("rewrite ^/heartbeat(.*)$ /incoming-request$1 break;");
    expect(heartbeat).toContain("client_max_body_size 50M;");
    expect(page).toContain("Bodies up to 50 MB are accepted; a larger one is refused with a `413`.");

    // The reply is sent first; the request is queued afterwards.
    const reply: number = api.indexOf("Response.sendEmptySuccessResponse(req, res);");
    const queued: number = api.indexOf(
      "await TelemetryQueueService.addIncomingRequestIngestJob({",
    );

    expect(reply).toBeGreaterThan(0);
    expect(queued).toBeGreaterThan(reply);
    expect(page).toContain(
      "OneUptime replies `200` with an empty JSON object (`{}`) immediately and processes the request on a queue.",
    );
  });

  it("re-checks for silence every 30 seconds", () => {
    expect(EVERY_THIRTY_SECONDS).toBe("*/30 * * * * *");
    expect(readRepoFile(HEARTBEAT_JOB_FILE)).toContain(
      "{ schedule: EVERY_THIRTY_SECONDS, runOnStartup: false },",
    );
    expect(page).toContain("re-checked in the background, every 30 seconds");
  });

  it("lists the filter types and conditions the form offers", () => {
    const types: Array<string> = firstCells(
      tableRows(section(page, "### Available Filter Types")),
    );

    expect(sorted(types)).toEqual(sorted(offeredFilters(MonitorType.IncomingRequest)));
    expect(conditionsOf(CheckOn.IncomingRequest)).toEqual([
      FilterType.NotRecievedInMinutes,
      FilterType.RecievedInMinutes,
    ]);

    for (const checkOn of [
      CheckOn.RequestBody,
      CheckOn.RequestHeader,
      CheckOn.RequestHeaderValue,
    ]) {
      expect(conditionsOf(checkOn)).toEqual([
        FilterType.Contains,
        FilterType.NotContains,
      ]);
    }

    expect(conditionsOf(CheckOn.JavaScriptExpression)).toEqual([
      FilterType.EvaluatesToTrue,
    ]);
  });

  it("starts with the two body criteria the page tabulates", () => {
    const [offline, online] = defaultCriteriaFor(MonitorType.IncomingRequest) as [
      MonitorCriteriaInstance,
      MonitorCriteriaInstance,
    ];
    const keyword: string = MonitorCriteriaInstance.DEFAULT_INCOMING_BODY_ERROR_KEYWORD;

    expect(filtersOf(offline)).toEqual([
      { checkOn: CheckOn.RequestBody, filterType: FilterType.Contains, value: keyword },
    ]);
    expect(offline.data?.createIncidents).toBe(true);
    expect(offline.data?.incidents[0]?.autoResolveIncident).toBe(true);
    expect(filtersOf(online)).toEqual([
      { checkOn: CheckOn.RequestBody, filterType: FilterType.NotContains, value: keyword },
    ]);
    expect(
      tableRows(section(page, "### What you get out of the box")).map(
        (row: Array<string>): string => {
          return row.slice(0, 4).join(" | ");
        },
      ),
    ).toEqual([
      `Offline | Request Body | Contains | \`${keyword}\``,
      `Online | Request Body | Not Contains | \`${keyword}\``,
    ]);
  });

  it("names the setup card, the secret key reset and the grouping fields as the dashboard does", () => {
    expect(readRepoFile(SETUP_CARD_FILE)).toContain('title="Send the first heartbeat"');
    expect(readRepoFile(CONNECTION_CARD_FILE)).toContain(
      '[MonitorOverviewSetupKind.HeartbeatUrl]: translationKey("Heartbeat URL"),',
    );
    expect(readRepoFile(MONITOR_SETTINGS_FILE)).toContain(
      'title={"Reset Incoming Request Secret Key"}',
    );
    expect(page).toContain("click **Reset Incoming Request Secret Key**");

    const criteriaForm: string = readRepoFile(CRITERIA_INSTANCE_FORM_FILE);

    for (const label of [
      "Group incidents and alerts by a payload field",
      "Open a separate incident for each…",
      "Auto-resolve each incident when…",
      "Field that signals recovery",
      "Value that means recovered",
      "Max incidents per request",
    ]) {
      expect({ label, drawn: criteriaForm.includes(label) }).toEqual({
        label,
        drawn: true,
      });
      expect({ label, documented: page.includes(label) }).toEqual({
        label,
        documented: true,
      });
    }

    expect(criteriaForm).toContain(
      '"Safety cap so a high-cardinality field cannot open unbounded incidents. Defaults to 100."',
    );
    expect(page).toContain("| `100` (default)");
  });

  describe("the path syntax, run against the grouping the server does", () => {
    const payload: JSONObject = {
      status: "firing",
      commonLabels: { severity: "critical" },
      alerts: [
        { status: "firing", labels: { alertname: "HighCPU" }, fingerprint: "a1" },
        { status: "resolved", labels: { alertname: "HighRAM" }, fingerprint: "b2" },
        { status: "firing", labels: { alertname: "HighCPU" }, fingerprint: "c3" },
        { status: "firing", labels: { alertname: "" } },
        { status: "firing", labels: { alertname: { nested: true } } },
      ],
    } as unknown as JSONObject;

    it("opens one key per distinct value, the first element deciding its state", () => {
      expect(
        groupingKeys(payload, "requestBody.alerts[*].labels.alertname", {
          path: "requestBody.alerts[*].status",
          value: "resolved",
        }),
      ).toEqual(["HighCPU", "HighRAM (resolved)"]);
      expect(page).toContain(
        "Two elements yielding the same value collapse into one incident, and that incident's firing/resolved state is taken from the **first** matching element.",
      );
    });

    it("matches nothing without the requestBody. prefix, with or without the braces", () => {
      expect(groupingKeys(payload, "alerts[*].labels.alertname")).toEqual([]);
      expect(groupingKeys(payload, "{{requestBody.alerts[*].fingerprint}}")).toEqual(
        groupingKeys(payload, "requestBody.alerts[*].fingerprint"),
      );
      expect(page).toContain(
        "A path without it — `alerts[*].labels.alertname` — matches nothing, silently.",
      );
    });

    it("treats only the first [*] as a wildcard", () => {
      expect(
        groupingKeys(
          { groups: [{ alerts: [{ name: "x" }] }] } as unknown as JSONObject,
          "requestBody.groups[*].alerts[*].name",
        ),
      ).toEqual([]);
      expect(page).toContain(
        "`requestBody.groups[*].alerts[*].name` matches nothing.",
      );
    });

    it("selects one element with [0] and [last]", () => {
      expect(groupingKeys(payload, "requestBody.alerts[0].fingerprint")).toEqual(["a1"]);
      expect(groupingKeys(payload, "requestBody.alerts[last].status")).toEqual([
        "firing",
      ]);
    });

    it("skips objects, empty strings and nulls, and keeps 0 and false", () => {
      expect(
        groupingKeys(
          { items: [{ id: 0 }, { id: false }, { id: null }, { id: "" }, { id: [] }] } as unknown as JSONObject,
          "requestBody.items[*].id",
        ),
      ).toEqual(["0", "false"]);
      expect(page).toContain(
        "Object and array values, empty strings, and nulls are skipped. `0` and `false` are valid keys.",
      );
    });

    it("names the variable after the last segment of the path", () => {
      const variables: Array<Array<string>> = tableRows(
        section(page, "### Naming the incidents"),
      );

      for (const [pathCell, variableCell] of variables as Array<[string, string]>) {
        const item: IncomingRequestGroupingItem | undefined =
          IncomingRequestIncidentGrouping.extractItems({
            requestBody: {
              alerts: [{ labels: { alertname: "x" }, fingerprint: "f" }],
              commonLabels: { severity: "s" },
            } as unknown as JSONObject,
            grouping: { groupByJSONPath: pathCell.replace(/`/g, "") },
          })[0];

        expect(item).toBeDefined();
        expect(`\`{{${Object.keys(item!.labels)[0]}}}\``).toBe(variableCell);
      }
    });

    it("caps the keys of one payload at Max incidents per request", () => {
      const many: JSONObject = {
        alerts: Array.from({ length: 150 }, (_value: unknown, index: number) => {
          return { name: `alert-${index}` };
        }),
      } as unknown as JSONObject;

      expect(groupingKeys(many, "requestBody.alerts[*].name")).toHaveLength(100);
    });

    it("compares the recovery value exactly", () => {
      expect(
        groupingKeys(payload, "requestBody.alerts[*].labels.alertname", {
          path: "requestBody.alerts[*].status",
          value: "Resolved",
        }),
      ).toEqual(["HighCPU", "HighRAM"]);
      expect(page).toContain(
        "The comparison is exact and case-sensitive — `Resolved` does not match `resolved`.",
      );
    });

    it("does not group a payload whose top level is an array", () => {
      expect(
        IncomingRequestIncidentGrouping.getRequestBodyObject({
          requestBody: [{ name: "x" }],
        } as unknown as Parameters<
          typeof IncomingRequestIncidentGrouping.getRequestBodyObject
        >[0]),
      ).toBeNull();
      expect(page).toContain(
        "The body must be a JSON object; a payload whose top level is an array is not grouped.",
      );
    });
  });

  it("names the switch that evaluates every request on its own", () => {
    expect(
      fs.existsSync(path.join(PACKAGES_DIR, "App/FeatureSet/Telemetry/Config.ts")) &&
        readRepoFile("App/FeatureSet/Telemetry/Config.ts").includes(
          "INCOMING_REQUEST_INGEST_COALESCE_ENABLED",
        ),
    ).toBe(true);
    expect(page).toContain("`INCOMING_REQUEST_INGEST_COALESCE_ENABLED=false`");
  });
});

describe("Incoming Email Monitor", () => {
  const page: string = englishPage(INCOMING_EMAIL_PAGE);

  it("lists the filter types and the conditions the form offers", () => {
    const types: Array<string> = firstCells(
      tableRows(section(page, "## Available Filter Types")),
    );

    expect(sorted(types)).toEqual(sorted(offeredFilters(MonitorType.IncomingEmail)));

    const stringConditions: Array<string> = firstCells(
      tableRows(section(page, "### String Filters (Subject, From, Body, To)")),
    );

    for (const checkOn of [
      CheckOn.EmailSubject,
      CheckOn.EmailFrom,
      CheckOn.EmailBody,
      CheckOn.EmailTo,
    ]) {
      expect(sorted(conditionsOf(checkOn))).toEqual(sorted(stringConditions));
    }

    expect(
      sorted(
        firstCells(tableRows(section(page, "### Time-Based Filters (Email Received)"))),
      ),
    ).toEqual(sorted(conditionsOf(CheckOn.EmailReceivedAt)));
  });

  it("starts with the two body criteria the page tabulates", () => {
    const [offline, online] = defaultCriteriaFor(MonitorType.IncomingEmail) as [
      MonitorCriteriaInstance,
      MonitorCriteriaInstance,
    ];
    const keyword: string = MonitorCriteriaInstance.DEFAULT_INCOMING_BODY_ERROR_KEYWORD;

    expect(filtersOf(offline)).toEqual([
      { checkOn: CheckOn.EmailBody, filterType: FilterType.Contains, value: keyword },
    ]);
    expect(offline.data?.incidents[0]?.autoResolveIncident).toBe(true);
    expect(filtersOf(online)).toEqual([
      { checkOn: CheckOn.EmailBody, filterType: FilterType.NotContains, value: keyword },
    ]);
  });

  it("checks for missing email every 30 seconds", () => {
    expect(readRepoFile(EMAIL_JOB_FILE)).toContain(
      "{ schedule: EVERY_THIRTY_SECONDS, runOnStartup: false },",
    );
    expect(page).toContain("are also checked on a schedule, every 30 seconds");
  });

  it("quotes the custom address rules", () => {
    expect(CUSTOM_LOCAL_PART_MIN_LENGTH).toBe(3);
    expect(CUSTOM_LOCAL_PART_MAX_LENGTH).toBe(64);
    expect(page).toContain("- 3 to 64 characters:");

    const listed: Array<string> = codeItems(
      page.split("\n").find((line: string): boolean => {
        return line.includes("Mailbox names that belong to the domain itself");
      }) || "",
    ).filter((name: string): boolean => {
      return !name.includes("{");
    });

    expect(sorted(listed)).toEqual(sorted([...RESERVED_CUSTOM_LOCAL_PARTS]));
  });

  it("accepts an email of up to 50 MB", () => {
    const nginx: string = readRepoFile(NGINX_TEMPLATE_FILE);

    expect(
      sourceBetween(nginx, "location /incoming-email {", NGINX_BLOCK_END),
    ).toContain(
      "client_max_body_size 50M;",
    );
    expect(page).toContain("OneUptime accepts an inbound email of up to 50 MB");
  });

  it("names both auto-resolve switches by their labels", () => {
    expect(page).toContain(
      "An incident with **Auto Resolve Incident** on, or an alert with **Auto Resolve Alert** on, is resolved when a different criteria matches later",
    );
  });
});

describe("External Status Page Monitor", () => {
  const page: string = englishPage(STATUS_PAGE_PAGE);
  const probe: string = readRepoFile(PROBE_STATUS_PAGE_FILE);

  it("lists the providers the dropdown offers, Auto first as the default", () => {
    const providers: Array<string> = firstCells(
      tableRows(section(page, "## Supported Providers")),
    );

    expect(providers[0]).toBe("Auto (default)");
    expect(sorted(providers.slice(1))).toEqual(
      sorted(
        Object.values(ExternalStatusPageProviderType).filter(
          (provider: string): boolean => {
            return provider !== ExternalStatusPageProviderType.Auto;
          },
        ),
      ),
    );
    expect(MonitorStepExternalStatusPageMonitorUtil.getDefault().provider).toBe(
      ExternalStatusPageProviderType.Auto,
    );
  });

  it("detects the format in the order the page gives", () => {
    const auto: string = sourceBetween(
      probe,
      "if (provider === ExternalStatusPageProviderType.Auto) {",
      "} else if (",
    );
    const incidentIo: number = auto.indexOf("tryIncidentIo(");
    const atlassian: number = auto.indexOf("tryAtlassianStatuspage(");
    const feed: number = auto.indexOf("tryRssAtomFeed(");

    expect(incidentIo).toBeGreaterThan(0);
    expect(atlassian).toBeGreaterThan(incidentIo);
    expect(feed).toBeGreaterThan(atlassian);
    expect(probe).toContain(
      "// If all methods fail, just check if the URL is reachable\n        response = await ExternalStatusPageMonitorUtil.tryBasicHttpCheck(",
    );

    for (const endpoint of [
      "/api/v2/status.json",
      "/api/v2/components.json",
      "/api/v2/incidents/unresolved.json",
    ]) {
      expect(probe).toContain(endpoint);
      expect(page).toContain(`\`${endpoint}\``);
    }

    expect(probe).toContain("const apiUrl: string = `${origin}/proxy/${host}`;");
  });

  it("reports what the reachability check reports", () => {
    expect(probe).toContain(
      "const isOnline: boolean = response.status >= 200 && response.status < 400;",
    );
    expect(probe).toContain('overallStatus: isOnline ? "reachable" : "unreachable",');
    expect(page).toContain("online on a `2xx` or `3xx` response");
    expect(page).toContain("the reachability check reports `reachable` or `unreachable`");
  });

  it("counts a feed's items of the last 24 hours as active incidents", () => {
    expect(probe).toContain("const pubDate: string = (item[\"pubDate\"] as string) || \"\";");
    expect(probe).toContain(
      '(entry["updated"] as string) || (entry["published"] as string) || "";',
    );
    expect(probe.split("if (hoursDiff <= 24) {").length - 1).toBe(2);
    expect(page).toContain(
      "On an RSS or Atom feed, the items of the last 24 hours count as active incidents: an RSS item by its publication date, an Atom entry by its update date.",
    );
  });

  it("quotes the timeout and retries defaults and names the fields as the form does", () => {
    const defaults: ReturnType<
      typeof MonitorStepExternalStatusPageMonitorUtil.getDefault
    > = MonitorStepExternalStatusPageMonitorUtil.getDefault();
    const rows: Array<Array<string>> = tableRows(
      section(page, "## Configuration Options"),
    );
    const form: string = readRepoFile(STATUS_PAGE_FORM_FILE);

    expect(defaults.timeout).toBe(10000);
    expect(defaults.retries).toBe(3);

    for (const row of rows) {
      const field: string = (row[0] as string).replace(/\*\*/g, "");

      expect({ field, drawn: form.includes(`title="${field}"`) }).toEqual({
        field,
        drawn: true,
      });
    }

    expect(rows.map((row: Array<string>): string => {
      return row[2] as string;
    })).toEqual([
      "—",
      "**Auto**",
      "All groups",
      "All components in scope",
      "`10000` (10 seconds)",
      "`3` (up to 4 attempts)",
    ]);
  });

  it("lists the criteria filters and conditions the form offers", () => {
    const rows: Array<Array<string>> = tableRows(section(page, "## Monitoring Criteria"));

    expect(sorted(firstCells(rows))).toEqual(
      sorted(offeredFilters(MonitorType.ExternalStatusPage)),
    );
    expect(conditionsOf(CheckOn.ExternalStatusPageIsOnline)).toEqual([
      FilterType.True,
      FilterType.False,
    ]);
    expect((rows[0] as Array<string>)[2]).toBe("True or False");

    const textConditions: string = conditionsOf(
      CheckOn.ExternalStatusPageOverallStatus,
    ).join(", ");

    expect((rows[1] as Array<string>)[2]).toBe(textConditions);
    expect((rows[2] as Array<string>)[2]).toBe(textConditions);

    // The Component Status dropdown's values, in order.
    const statuses: Array<string> = CriteriaFilterUtil.getDropdownOptionsByCheckOn({
      checkOn: CheckOn.ExternalStatusPageComponentStatus,
    }).map((option: DropdownOption): string => {
      return option.label;
    });

    expect((rows[2] as Array<string>)[1]).toContain(
      `${statuses.slice(0, -1).join(", ")} or ${statuses[statuses.length - 1]}`,
    );
  });

  it("starts with the two criteria the page tabulates", () => {
    const [offline, online] = defaultCriteriaFor(MonitorType.ExternalStatusPage) as [
      MonitorCriteriaInstance,
      MonitorCriteriaInstance,
    ];

    expect(offline.data?.filterCondition).toBe(FilterCondition.Any);
    expect(filtersOf(offline)).toEqual([
      {
        checkOn: CheckOn.ExternalStatusPageIsOnline,
        filterType: FilterType.False,
        value: undefined,
      },
      {
        checkOn: CheckOn.ExternalStatusPageActiveIncidents,
        filterType: FilterType.GreaterThan,
        value: 0,
      },
      ...["degraded_performance", "partial_outage", "major_outage", "full_outage"].map(
        (status: string): FilterShape => {
          return {
            checkOn: CheckOn.ExternalStatusPageComponentStatus,
            filterType: FilterType.EqualTo,
            value: status,
          };
        },
      ),
    ]);
    expect(offline.data?.incidents[0]?.autoResolveIncident).toBe(true);
    expect(online.data?.filterCondition).toBe(FilterCondition.All);
    expect(filtersOf(online)).toEqual([
      {
        checkOn: CheckOn.ExternalStatusPageIsOnline,
        filterType: FilterType.True,
        value: undefined,
      },
      {
        checkOn: CheckOn.ExternalStatusPageActiveIncidents,
        filterType: FilterType.EqualTo,
        value: 0,
      },
    ]);

    const rows: Array<Array<string>> = tableRows(section(page, "### Default Criteria"));

    expect((rows[0] as Array<string>)[1]).toBe(
      "**Any** of: the page is not online; there is at least one active incident in scope; a component in scope reports Degraded Performance, Partial Outage, Major Outage or Full Outage",
    );
    expect((rows[1] as Array<string>)[1]).toBe(
      "**All** of: the page is online; there are no active incidents in scope",
    );
  });

  it("lists exactly the template variables the picker offers", () => {
    const documented: Array<string> = Array.from(
      section(page, "## Template variables").matchAll(/^\| `\{\{(\w+)\}\}` /gm),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(sorted(documented)).toEqual(
      sorted(
        templateVariablesOf(MonitorType.ExternalStatusPage, "External Status Page"),
      ),
    );
    expect(boldItems(page)).toContain("External Status Page Active Incidents");
  });
});
