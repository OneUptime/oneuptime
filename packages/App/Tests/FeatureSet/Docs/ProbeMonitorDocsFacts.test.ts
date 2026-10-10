import CriteriaFilterUtil from "../../../FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter";
import CriteriaNameUtil from "../../../FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaName";
import {
  MonitorDestinationFieldCopy,
  getMonitorDestinationFieldCopy,
} from "../../../FeatureSet/Dashboard/src/Utils/Form/Monitor/MonitorDestinationFieldCopy";
import { getMonitorStepMoreFieldsItems } from "../../../FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorMoreFields";
import { readPage } from "./DocsContentSupport";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import FilterCondition from "Common/Types/Filter/FilterCondition";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import IP from "Common/Types/IP/IP";
import {
  CheckOn,
  CriteriaFilterUtil as CommonCriteriaFilterUtil,
  EvaluateOverTimeMinutes,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "Common/Types/Monitor/CriteriaFilter";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorStep, {
  DEFAULT_MONITOR_REQUEST_TIMEOUT_IN_MS,
  MAX_MONITOR_REQUEST_TIMEOUT_IN_MS,
  MAX_MONITOR_RETRY_COUNT,
} from "Common/Types/Monitor/MonitorStep";
import MonitorType, {
  MonitorTypeCategory,
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import { PermissionHelper } from "Common/Types/Permission";
import Port from "Common/Types/Port";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { FoldedSectionItem } from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import { MORE_FIELDS_SECTION_TITLE } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import MonitorDestinationUtil, {
  ParsedMonitorDestination,
} from "Common/Utils/Monitor/MonitorDestinationUtil";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the English Website, API, Ping, IP and Port monitor pages say about
 * the product, held to the code that makes it true.
 *
 * Markdown is not compiled, so nothing else notices when a form field is
 * renamed or folded, a filter or a condition is added to the criteria form,
 * the probe's timeout, retry, redirect or size limits move, or the text of a
 * failure a reader is told to look for changes. Each test reads the source of
 * truth - the dashboard's form helpers, the criteria types, the probe's own
 * sources (read as text: the probe is its own package), the Monitor model -
 * and checks the page still says what it does. The translations are held to
 * these English pages by ProbeMonitorDocsTranslations; the default criteria
 * of the Website and API pages also by MonitorDefaultCriteriaDocs.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");

const PROBE_CONFIG_FILE: string = "Probe/Config.ts";
const PROBE_MONITOR_FILE: string = "Probe/Utils/Monitors/Monitor.ts";
const PROBE_RETRY_FILE: string = "Probe/Utils/Monitors/MonitorRetry.ts";
const PROBE_HTTP_REQUEST_FILE: string =
  "Probe/Utils/Monitors/HttpMonitorRequest.ts";
const PROBE_WEBSITE_FILE: string =
  "Probe/Utils/Monitors/MonitorTypes/WebsiteMonitor.ts";
const PROBE_API_FILE: string =
  "Probe/Utils/Monitors/MonitorTypes/ApiMonitor.ts";
const PROBE_PING_FILE: string =
  "Probe/Utils/Monitors/MonitorTypes/PingMonitor.ts";
const PROBE_PORT_FILE: string =
  "Probe/Utils/Monitors/MonitorTypes/PortMonitor.ts";
const BODY_READER_FILE: string = "Common/Utils/HTTPResponseBodyReader.ts";
const API_CRITERIA_FILE: string =
  "Common/Server/Utils/Monitor/Criteria/APIRequestCriteria.ts";
const MONITOR_STEP_FORM_FILE: string =
  "App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorStep.tsx";
const CRITERIA_FILTER_FORM_FILE: string =
  "App/FeatureSet/Dashboard/src/Components/Form/Monitor/CriteriaFilter.tsx";
const CRITERIA_INSTANCE_FORM_FILE: string =
  "App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorCriteriaInstance.tsx";
const DICTIONARY_FILE: string =
  "Common/UI/Components/Dictionary/Dictionary.tsx";
const NETWORK_PATH_VIEW_FILE: string =
  "App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/NetworkPathView.tsx";
const MONITOR_VIEW_MENU_FILE: string =
  "App/FeatureSet/Dashboard/src/Pages/Monitor/View/SideMenu.tsx";

interface ProbePage {
  page: string;
  monitorType: MonitorType;
}

const WEBSITE: ProbePage = {
  page: "monitor/website-monitor",
  monitorType: MonitorType.Website,
};
const API: ProbePage = {
  page: "monitor/api-monitor",
  monitorType: MonitorType.API,
};
const PING: ProbePage = {
  page: "monitor/ping-monitor",
  monitorType: MonitorType.Ping,
};
const IP_PAGE: ProbePage = {
  page: "monitor/ip-monitor",
  monitorType: MonitorType.IP,
};
const PORT: ProbePage = {
  page: "monitor/port-monitor",
  monitorType: MonitorType.Port,
};

const PROBE_PAGES: Array<ProbePage> = [WEBSITE, API, PING, IP_PAGE, PORT];
const HTTP_PAGES: Array<ProbePage> = [WEBSITE, API];
const ICMP_PAGES: Array<ProbePage> = [PING, IP_PAGE];

// Bold spans, and inline code spans, as a page writes them.
const BOLD_SPAN: RegExp = /\*\*([^*\n]+?)\*\*/g;
const CODE_SPAN: RegExp = /`([^`\n]+)`/g;
const HEADING_LINE: RegExp = /^(#{1,6})\s/;
const FENCE_LINE: RegExp = /^\s*```/;
const NUMBER_LITERAL: RegExp = /^(\d+)(?:\s*\*\s*(\d+))?$/;

const SAMPLE_NAME: string = "Acme";

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relativePath), "utf8");
}

function englishPage(probePage: ProbePage): string {
  return readPage("en", probePage.page);
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

// The row of a table whose first cell leads with this bold label.
function rowFor(
  rows: Array<Array<string>>,
  label: string,
): Array<string> | undefined {
  return rows.find((row: Array<string>): boolean => {
    return boldItems(row[0] || "")[0] === label;
  });
}

function sorted(values: Array<string>): Array<string> {
  return [...values].sort();
}

// The value of a numeric constant in a source file: "10" or "512 * 1024".
function numericConstant(source: string, name: string): number {
  const match: RegExpMatchArray | null = source.match(
    new RegExp(`${name}: number =\\s*([^;]+);`),
  );

  expect({ name, found: Boolean(match) }).toEqual({ name, found: true });

  const literal: RegExpMatchArray | null = (match![1] as string)
    .trim()
    .match(NUMBER_LITERAL);

  expect({ name, literal: Boolean(literal) }).toEqual({ name, literal: true });

  return (
    Number(literal![1]) * (literal![2] !== undefined ? Number(literal![2]) : 1)
  );
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

// The criteria form's filters for a monitor type, by the label it draws.
function offeredFilters(monitorType: MonitorType): Array<DropdownOption> {
  return CriteriaFilterUtil.getCheckOnOptionsByMonitorType(monitorType);
}

function offeredFilter(
  monitorType: MonitorType,
  label: string,
): DropdownOption | undefined {
  return offeredFilters(monitorType).find((option: DropdownOption): boolean => {
    return option.label === label;
  });
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

// The probe's retry default when PROBE_MONITOR_RETRY_LIMIT is not set.
function probeRetryDefault(): number {
  const config: string = readRepoFile(PROBE_CONFIG_FILE);
  const declaration: string = sourceBetween(
    config,
    "export const PROBE_MONITOR_RETRY_LIMIT",
    "});",
  );
  const match: RegExpMatchArray | null = declaration.match(
    new RegExp("defaultValue: (\\d+)"),
  );

  expect(match).not.toBeNull();

  return Number(match![1]);
}

describe.each(PROBE_PAGES)("$page", (probePage: ProbePage) => {
  const page: string = englishPage(probePage);
  const title: string = MonitorTypeHelper.getTitle(probePage.monitorType);

  it("starts the monitor where the type picker offers the type", () => {
    const start: string = section(page, "### Start a new monitor");

    expect(start).toContain("Go to **Monitors** and click **Create Monitor**.");

    if (
      MonitorTypeHelper.getCommonMonitorTypes().includes(probePage.monitorType)
    ) {
      expect(start).toContain(`Under **Monitor Type**, pick **${title}**.`);
      return;
    }

    // Not among the six common types: behind More monitor types.
    const category: MonitorTypeCategory | undefined =
      MonitorTypeHelper.getMonitorTypeCategories().find(
        (candidate: MonitorTypeCategory): boolean => {
          return candidate.monitorTypes.includes(probePage.monitorType);
        },
      );

    expect(category).toBeDefined();
    expect(start).toContain(
      `click **More monitor types** and pick **${title}** under **${category!.label}**.`,
    );
  });

  it("names the address field, and gives its example, as the form does", () => {
    const copy: MonitorDestinationFieldCopy | null =
      getMonitorDestinationFieldCopy(probePage.monitorType);

    expect(copy).not.toBeNull();
    expect(page).toContain(`In **${copy!.title}**, enter`);
    expect(codeItems(page)).toContain(copy!.placeholder);
  });

  it("folds exactly the fields the form folds under More fields, in its order", () => {
    const folded: Array<string> = getMonitorStepMoreFieldsItems({
      monitorType: probePage.monitorType,
      monitorStep: new MonitorStep(),
      usesClientCertificate: false,
    }).map((item: FoldedSectionItem): string => {
      return item.title;
    });

    expect(folded.length).toBeGreaterThan(0);
    expect(MORE_FIELDS_SECTION_TITLE).toBe("More fields");

    const documented: Array<string> = HTTP_PAGES.includes(probePage)
      ? tableRows(section(page, "### More fields")).map(
          (row: Array<string>): string => {
            return boldItems(row[0]!)[0]!;
          },
        )
      : tableRows(section(page, "## Configuration options"))
          .filter((row: Array<string>): boolean => {
            return row[0]!.includes(`(under **${MORE_FIELDS_SECTION_TITLE}**)`);
          })
          .map((row: Array<string>): string => {
            return boldItems(row[0]!)[0]!;
          });

    expect(documented).toEqual(folded);
  });

  it("quotes the request timeout's default and maximum", () => {
    const rows: Array<Array<string>> = tableRows(
      section(
        page,
        HTTP_PAGES.includes(probePage)
          ? "### More fields"
          : "## Configuration options",
      ),
    );
    const timeout: Array<string> | undefined = rowFor(
      rows,
      "Request Timeout (seconds)",
    );

    expect(timeout).toBeDefined();
    expect(timeout![1]).toBe(
      `\`${DEFAULT_MONITOR_REQUEST_TIMEOUT_IN_MS / 1000}\``,
    );
    expect(timeout![2]).toContain(
      `The maximum is ${MAX_MONITOR_REQUEST_TIMEOUT_IN_MS / 1000} seconds.`,
    );
  });

  it("quotes the retries: the probe's default, the maximum, and what they count", () => {
    const rows: Array<Array<string>> = tableRows(
      section(
        page,
        HTTP_PAGES.includes(probePage)
          ? "### More fields"
          : "## Configuration options",
      ),
    );
    const retries: Array<string> | undefined = rowFor(
      rows,
      "Retries on Failure",
    );
    const fallback: number = probeRetryDefault();

    expect(retries).toBeDefined();
    expect(retries![1]).toBe(`Probe default, usually \`${fallback}\``);
    expect(retries![2]).toContain(`The maximum is ${MAX_MONITOR_RETRY_COUNT}.`);
    expect(page).toContain(
      "counts retries _after_ the first attempt, so `0` runs the check once and `2` runs it up to three times.",
    );
    expect(page).toContain(
      `Left blank, it uses the probe's default: ${fallback}, unless the probe's \`PROBE_MONITOR_RETRY_LIMIT\` says otherwise.`,
    );
  });

  it("lists exactly the filters the criteria form offers", () => {
    const documented: Array<string> = tableRows(
      section(page, "## Monitoring Criteria"),
    ).map((row: Array<string>): string => {
      return boldItems(row[0]!)[0]!;
    });

    expect(sorted(documented)).toEqual(
      sorted(
        offeredFilters(probePage.monitorType).map(
          (option: DropdownOption): string => {
            return option.label;
          },
        ),
      ),
    );
  });

  it("lists, for every filter, exactly the conditions the form offers", () => {
    for (const row of tableRows(section(page, "## Monitoring Criteria"))) {
      const label: string = boldItems(row[0]!)[0]!;
      const filter: DropdownOption | undefined = offeredFilter(
        probePage.monitorType,
        label,
      );

      expect({ label, offered: Boolean(filter) }).toEqual({
        label,
        offered: true,
      });
      expect({ label, conditions: sorted(boldItems(row[1]!)) }).toEqual({
        label,
        conditions: sorted(conditionsOf(filter!.value as CheckOn)),
      });
    }
  });

  it("offers Evaluate this criteria over a period of time for exactly the filters the form does", () => {
    const evaluating: string = section(
      page,
      "### Evaluating over a period of time",
    );
    const sentence: string = evaluating.slice(
      evaluating.indexOf("offered for "),
      evaluating.indexOf(". Turn it on"),
    );

    expect(evaluating).toContain(
      "**Evaluate this criteria over a period of time** is a checkbox under a filter",
    );
    expect(sorted(boldItems(sentence))).toEqual(
      sorted(
        offeredFilters(probePage.monitorType)
          .filter((option: DropdownOption): boolean => {
            return CommonCriteriaFilterUtil.isEvaluateOverTimeFilter(
              option.value as CheckOn,
            );
          })
          .map((option: DropdownOption): string => {
            return option.label;
          }),
      ),
    );
  });

  it("lists the aggregates, and says the numeric ones are for numeric filters only", () => {
    const rows: Array<Array<string>> = tableRows(
      section(page, "### Evaluating over a period of time"),
    );
    const documented: Array<string> = rows.flatMap(
      (row: Array<string>): Array<string> => {
        return boldItems(row[0]!);
      },
    );

    expect(sorted(documented)).toEqual(
      sorted(Object.values(EvaluateOverTimeType)),
    );

    // What a yes/no filter is offered, and what only a number is.
    const yesNo: Array<EvaluateOverTimeType> =
      CommonCriteriaFilterUtil.getEvaluateOverTimeTypeByCriteriaFilter({
        checkOn: CheckOn.IsOnline,
        filterType: FilterType.False,
        value: undefined,
      });
    const numericOnly: Array<string> = Object.values(
      EvaluateOverTimeType,
    ).filter((type: EvaluateOverTimeType): boolean => {
      return !yesNo.includes(type);
    });

    expect(sorted(boldItems(rows[0]![0]!))).toEqual(sorted(numericOnly));
    expect(rows[0]![1]).toContain("Numeric filters only.");
  });

  it("gives the window the form offers, from its shortest to its longest", () => {
    const minutes: Array<number> = Object.values(EvaluateOverTimeMinutes).map(
      (value: string): number => {
        return Number(value);
      },
    );

    expect(section(page, "### Evaluating over a period of time")).toContain(
      `from ${Math.min(...minutes)} to ${Math.max(...minutes)} minutes, under **For the last (in minutes)**`,
    );
  });

  it("lists the If No Data options, with the form's default", () => {
    const evaluating: string = section(
      page,
      "### Evaluating over a period of time",
    );
    const noData: string = evaluating.slice(
      evaluating.indexOf("**If No Data**"),
    );
    const rows: Array<Array<string>> = tableRows(noData);
    const form: string = readRepoFile(CRITERIA_FILTER_FORM_FILE);

    expect(
      sorted(
        rows.map((row: Array<string>): string => {
          return boldItems(row[0]!)[0]!;
        }),
      ),
    ).toEqual(sorted(Object.values(NoDataPolicy)));

    // The form falls back to Ignore, and the page marks it the default.
    expect(form).toMatch(
      new RegExp(
        "evaluateOverTimeOptions\\?\\.onNoDataPolicy \\|\\|\\s+NoDataPolicy\\.Ignore",
      ),
    );
    expect(rowFor(rows, NoDataPolicy.Ignore)![0]).toBe(
      `**${NoDataPolicy.Ignore}** (default)`,
    );
  });

  it("names the Match Condition's choices as the filter conditions are named", () => {
    expect(page).toContain(
      `**Match Condition** decides whether **${FilterCondition.All}** of them or **${FilterCondition.Any}** one must match.`,
    );
  });

  it("builds every example criteria from a filter and a condition the form offers", () => {
    for (const row of tableRows(section(page, "### Example criteria"))) {
      const label: string = boldItems(row[1]!)[0]!;
      const condition: string = boldItems(row[2]!)[0]!;
      const filter: DropdownOption | undefined = offeredFilter(
        probePage.monitorType,
        label,
      );

      expect({ label, offered: Boolean(filter) }).toEqual({
        label,
        offered: true,
      });
      expect({ label, condition, offered: true }).toEqual({
        label,
        condition,
        offered: conditionsOf(filter!.value as CheckOn).includes(condition),
      });
    }
  });

  it("names as many default criteria as a new monitor gets", () => {
    const items: Array<string> = Array.from(
      section(page, "### Default Criteria").matchAll(
        new RegExp("^- \\*\\*([^*]+)\\*\\* —", "gm"),
      ),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(items).toEqual(["Offline", "Online"]);
    expect(defaultCriteriaFor(probePage.monitorType)).toHaveLength(
      items.length,
    );
  });

  it("says who can create the monitor, as the Monitor model allows", () => {
    const sentence: string = page.split("\n").find((line: string): boolean => {
      return line.startsWith("- **A role that can create monitors**:");
    })!;
    const titles: Array<string> = PermissionHelper.getPermissionTitles(
      new Monitor().getCreatePermissions(),
    );

    expect(sentence).toBeDefined();

    for (const permissionTitle of titles) {
      expect({
        permissionTitle,
        named: sentence.includes(permissionTitle),
      }).toEqual({ permissionTitle, named: true });
    }

    expect(sentence).toContain(
      "a custom role with the Create Monitor permission",
    );
    expect(titles).toContain("Create Monitor");
  });

  it("starts the interval where the form does", () => {
    expect(section(page, "### Pick probes and create")).toContain(
      "**Monitoring Interval** (it starts at **Every 5 Minutes**)",
    );
  });
});

describe("the probe's retry rules, as every probe check page quotes them", () => {
  const PROBE_FILES: Array<[ProbePage, string]> = [
    [WEBSITE, PROBE_WEBSITE_FILE],
    [API, PROBE_API_FILE],
    [PING, PROBE_PING_FILE],
    [IP_PAGE, PROBE_PING_FILE],
    [PORT, PROBE_PORT_FILE],
  ];

  it("a retry value counts retries after the first attempt", () => {
    expect(readRepoFile(PROBE_RETRY_FILE)).toContain(
      "return attemptNumber <= MonitorRetry.resolveRetries(data);",
    );
  });

  it("a step left blank takes the probe's PROBE_MONITOR_RETRY_LIMIT", () => {
    const resolve: string = sourceBetween(
      readRepoFile(PROBE_MONITOR_FILE),
      "public static resolveRetryCount(",
      "public static resolveTimeoutInMs(",
    );

    expect(resolve).toContain(
      "return clampMonitorRetryCount(data.stepRetryCount);",
    );
    expect(resolve).toContain("return PROBE_MONITOR_RETRY_LIMIT;");
  });

  it.each(PROBE_FILES)(
    "%s: the probe pauses a second between attempts and rechecks answers slower than ten seconds",
    (probePage: ProbePage, file: string) => {
      const source: string = readRepoFile(file);
      const page: string = englishPage(probePage);

      expect(source).toContain("await Sleep.sleep(1000);");
      expect(source).toContain("> 10000");

      expect(
        page.includes("waits one second between attempts") ||
          page.includes("with a one-second pause between attempts"),
      ).toBe(true);
      expect(page).toContain("10 seconds");
    },
  );
});

describe("website and API checks", () => {
  const httpRequest: string = readRepoFile(PROBE_HTTP_REQUEST_FILE);

  it.each(HTTP_PAGES)(
    "$page lists the redirect codes the probe follows, and how many",
    (probePage: ProbePage) => {
      const redirects: string = section(
        englishPage(probePage),
        "#### Do Not Follow Redirects",
      );
      const followed: RegExpMatchArray | null = httpRequest.match(
        new RegExp("!\\[([\\d, ]+)\\]\\.includes\\(data\\.statusCode\\)"),
      );

      expect(followed).not.toBeNull();

      const codes: Array<string> = (followed![1] as string)
        .split(",")
        .map((code: string): string => {
          return code.trim();
        });

      const listed: RegExpMatchArray | null = redirects.match(
        new RegExp("the probe follows redirects \\(([^)]*)\\)"),
      );

      expect(listed).not.toBeNull();
      expect(codeItems(listed![1] as string)).toEqual(codes);
      expect(redirects).toContain(
        `up to ${numericConstant(httpRequest, "HTTP_MONITOR_MAX_REDIRECTS")} of them`,
      );
    },
  );

  it.each(HTTP_PAGES)(
    "$page quotes the redirect and size failures as the probe words them",
    (probePage: ProbePage) => {
      const page: string = englishPage(probePage);
      const maxBytes: number = numericConstant(
        httpRequest,
        "HTTP_MONITOR_MAX_RESPONSE_BYTES",
      );

      expect(page).toContain(`${maxBytes / 1024} KiB`);
      expect(readRepoFile(BODY_READER_FILE)).toContain(
        '"Remote response exceeded the allowed size."',
      );
      expect(page).toContain('"Remote response exceeded the allowed size."');
    },
  );

  it("the website page quotes the redirect limit failure", () => {
    const limit: number = numericConstant(
      httpRequest,
      "HTTP_MONITOR_MAX_REDIRECTS",
    );

    expect(httpRequest).toMatch(
      new RegExp(
        "`Monitor target exceeded \\$\\{HTTP_MONITOR_MAX_REDIRECTS\\} redirects\\.`",
      ),
    );
    expect(englishPage(WEBSITE)).toContain(
      `"Monitor target exceeded ${limit} redirects."`,
    );
  });

  it("the API page quotes the unsafe redirect failure, and the rules behind it", () => {
    const page: string = englishPage(API);
    const redirects: string = section(page, "#### Do Not Follow Redirects");

    expect(httpRequest).toContain("unsafe cross-origin redirect");
    expect(page).toContain('"unsafe cross-origin redirect"');

    // A 303, or a 301/302 answering a POST, becomes a bodyless GET.
    expect(httpRequest).toContain("data.statusCode === 303 &&");
    expect(httpRequest).toContain(
      "(data.statusCode === 301 || data.statusCode === 302) &&\n        data.currentMethod === HTTPMethod.POST",
    );
    expect(redirects).toContain(
      "A `303`, or a `301` or `302` answering a `POST`, turns the request into a `GET` without a body",
    );

    // Headers stay on the origin; a body or another method cannot leave it.
    expect(httpRequest).toContain(
      "const headers: Headers = crossesOrigin\n      ? {}",
    );
    expect(httpRequest).toContain(
      "![HTTPMethod.GET, HTTPMethod.HEAD].includes(method)",
    );
    expect(redirects).toContain(
      "A redirect to another origin is sent without them.",
    );
    expect(redirects).toContain(
      "A redirect to another origin fails the check if the request still has a body, or a method other than `GET` or `HEAD`.",
    );
  });

  it.each(HTTP_PAGES)(
    "$page: self-signed certificates stay on the host, client certificates on the origin",
    (probePage: ProbePage) => {
      const page: string = englishPage(probePage);

      expect(httpRequest).toContain(
        "this.hasSameHostname(data.monitorUrl, data.hopUrl)",
      );
      expect(httpRequest).toContain("if (data.includeClientIdentity) {");
      expect(page).toContain(
        "**Allow self-signed certificates** follows redirects that stay on the monitor's own host name. A redirect to another host name is verified as usual.",
      );
      expect(page).toContain(
        "After a redirect to another origin, the probe continues without it.",
      );
    },
  );

  it("the website page says when the probe sends HEAD, by the filters that read the body", () => {
    const isHeadRequest: string = sourceBetween(
      readRepoFile(PROBE_MONITOR_FILE),
      "public static isHeadRequest(",
      "public static async probeMonitorStep(",
    );
    const bodyFilters: Array<string> = Array.from(
      isHeadRequest.matchAll(new RegExp("CheckOn\\.(\\w+)", "g")),
    ).map((match: RegExpMatchArray): string => {
      return CheckOn[match[1] as keyof typeof CheckOn];
    });
    const page: string = englishPage(WEBSITE);
    const sentence: string = page.slice(
      page.indexOf(
        "When none of the monitor's criteria reads the response body",
      ),
      page.indexOf("Your server's access logs"),
    );

    expect(bodyFilters.length).toBeGreaterThan(0);
    // Named as the website's criteria form names them.
    expect(sorted(boldItems(sentence))).toEqual(
      sorted(
        bodyFilters.map((checkOn: string): string => {
          return offeredFilter(MonitorType.Website, checkOn)!.label;
        }),
      ),
    );
    expect(sentence).toContain(
      "the probe sends a `HEAD` request instead of a `GET`, and repeats it as a `GET` if the server rejects `HEAD`",
    );
    expect(readRepoFile(PROBE_WEBSITE_FILE)).toContain(
      "if (currentMethod === HTTPMethod.HEAD) {\n              currentMethod = HTTPMethod.GET;",
    );
  });

  it("the API page says a HEAD answered with an error is repeated as a GET", () => {
    const api: string = readRepoFile(PROBE_API_FILE);

    expect(api).toContain(
      "result.statusCode >= 400 &&\n        result.statusCode < 600 &&\n        requestType === HTTPMethod.HEAD",
    );
    expect(api).toContain("HTTPMethod.GET,");
    expect(englishPage(API)).toContain(
      "If a **HEAD** request is answered with a `4xx` or `5xx` status, the probe repeats it as a `GET`.",
    );
  });

  it("the API page offers exactly the request methods the form does, GET first", () => {
    const form: string = readRepoFile(MONITOR_STEP_FORM_FILE);
    const methods: string = section(englishPage(API), "### API Request Type");

    expect(form).toContain(
      "DropdownUtil.getDropdownOptionsFromEnum(HTTPMethod)",
    );
    expect(form).toContain(
      "(monitorStep?.data?.requestType || HTTPMethod.GET)",
    );
    const offered: string = methods.slice(
      methods.indexOf("**GET** is the default"),
      methods.indexOf(". If a **HEAD** request"),
    );

    expect(offered).toContain("**GET** is the default; the others are ");
    expect(sorted(boldItems(offered))).toEqual(
      sorted(Object.values(HTTPMethod)),
    );
  });

  it("the API page names the headers' Add button as the form builds it", () => {
    const form: string = readRepoFile(MONITOR_STEP_FORM_FILE);

    expect(form).toContain('addButtonSuffix="Request Header"');
    expect(readRepoFile(DICTIONARY_FILE)).toContain(
      'template: "Add {{itemName}}"',
    );
    expect(englishPage(API)).toContain("**Add Request Header**");
  });

  it("both pages name the client certificate fields as the form does", () => {
    const form: string = readRepoFile(MONITOR_STEP_FORM_FILE);

    for (const field of [
      "Client Certificate (PEM)",
      "Client Private Key (PEM)",
      "Client Private Key Passphrase",
    ]) {
      expect({ field, inForm: form.includes(`"${field}"`) }).toEqual({
        field,
        inForm: true,
      });

      for (const probePage of HTTP_PAGES) {
        expect(
          rowFor(
            tableRows(
              section(englishPage(probePage), "#### Client certificate (mTLS)"),
            ),
            field,
          ),
        ).toBeDefined();
      }
    }
  });

  it.each(HTTP_PAGES)(
    "$page names the URL placeholders the probe fills in",
    (probePage: ProbePage) => {
      const monitor: string = readRepoFile(PROBE_MONITOR_FILE);
      const rows: Array<Array<string>> = tableRows(
        section(englishPage(probePage), "### Dynamic URL placeholders"),
      );

      expect(monitor).toContain(
        "const timestamp: string = Math.floor(Date.now() / 1000).toString();",
      );
      expect(monitor).toContain(
        'const random: string = ObjectID.generate().toString().replace(/-/g, "");',
      );
      expect(monitor).toContain(
        "urlString.replace(/\\{\\{timestamp\\}\\}/g, timestamp)",
      );
      expect(monitor).toContain(
        "urlString.replace(/\\{\\{random\\}\\}/g, random)",
      );

      expect(
        rows.map((row: Array<string>): string => {
          return row[0]!;
        }),
      ).toEqual(["`{{timestamp}}`", "`{{random}}`"]);
      expect(rows[0]![1]).toBe("The current Unix time, in seconds");

      // What {{random}} becomes: an ObjectID without its dashes.
      const sample: string = ObjectID.generate().toString().replace(/-/g, "");

      expect(sample).toHaveLength(32);
      expect(rows[1]![1]).toBe(
        `A random, unique string of ${sample.length} hexadecimal characters`,
      );
      expect(codeItems(rows[1]![2]!)[0]).toHaveLength(sample.length);
    },
  );

  it.each(HTTP_PAGES)(
    "$page compares header names and values in lowercase, as the criteria do",
    (probePage: ProbePage) => {
      const criteria: string = readRepoFile(API_CRITERIA_FILE);
      const rows: Array<Array<string>> = tableRows(
        section(englishPage(probePage), "## Monitoring Criteria"),
      );

      expect(criteria).toContain("return key.toLowerCase();");
      expect(rowFor(rows, CheckOn.ResponseHeader)![2]).toContain(
        "Enter the name in lowercase",
      );
      expect(rowFor(rows, CheckOn.ResponseHeaderValue)![2]).toContain(
        "compared in lowercase",
      );
    },
  );

  it("the API page says a JSON body is matched in its compact form", () => {
    expect(readRepoFile(PROBE_API_FILE)).toContain(
      "responseBody: JSON.stringify(result.data || {}),",
    );
    expect(JSON.stringify({ status: "ok" })).toBe('{"status":"ok"}');
    expect(englishPage(API)).toContain(
      'To find `"status": "ok"` with **Response Body**, enter `"status":"ok"`.',
    );
  });

  it.each(HTTP_PAGES)(
    "$page names the default criteria as a new monitor names them",
    (probePage: ProbePage) => {
      const names: Array<string> = defaultCriteriaFor(
        probePage.monitorType,
      ).map((criteria: MonitorCriteriaInstance): string => {
        return (criteria.data?.name || "").replace(SAMPLE_NAME, "(name)");
      });

      expect(names).toEqual([
        "Check if (name) is offline",
        "Check if (name) is online",
      ]);
      expect(englishPage(probePage)).toContain(
        `_${names[0]}_ and _${names[1]}_`,
      );
    },
  );

  it.each(HTTP_PAGES)(
    "$page gives the name Add Criteria makes, and where the description lives",
    (probePage: ProbePage) => {
      const name: string = CriteriaNameUtil.getNameFromFilters({
        filters: [
          {
            checkOn: CheckOn.ResponseTime,
            filterType: FilterType.GreaterThan,
            value: 3000,
          },
        ],
      });

      expect(englishPage(probePage)).toContain(
        `**Add Criteria** adds a criteria that is already named after its filter, for example _${name}_.`,
      );
      expect(readRepoFile(CRITERIA_INSTANCE_FORM_FILE)).toContain(
        'title="Settings"',
      );
      expect(englishPage(probePage)).toContain(
        "to add one, open the criteria's **Settings**",
      );
    },
  );

  it.each(HTTP_PAGES)(
    "$page points a private site at the probe's private network switch",
    (probePage: ProbePage) => {
      expect(readRepoFile(PROBE_CONFIG_FILE)).toContain(
        'process.env["PROBE_ALLOW_PRIVATE_NETWORK_MONITORS"]',
      );
      expect(englishPage(probePage)).toContain(
        "[Private Network Access](/docs/self-hosted/private-network-access)",
      );
    },
  );

  it("the website page points at Monitoring Logs, a page of every monitor", () => {
    expect(readRepoFile(MONITOR_VIEW_MENU_FILE)).toContain(
      'title: "Monitoring Logs"',
    );
    expect(englishPage(WEBSITE)).toContain(
      "**Monitoring Logs** on the monitor",
    );
  });
});

describe("ping and IP checks", () => {
  const ping: string = readRepoFile(PROBE_PING_FILE);

  it.each(ICMP_PAGES)(
    "$page sends as many echo requests as the probe does",
    (probePage: ProbePage) => {
      const count: number = numericConstant(ping, "PING_PACKET_COUNT");
      const page: string = englishPage(probePage);

      expect(count).toBe(5);
      expect(page).toContain("sends five echo requests");
      expect(page).toContain(`send["Send ${count} echo requests"]`);
      expect(page).toContain(
        "The share of the five echo requests that got no reply.",
      );
    },
  );

  it.each(ICMP_PAGES)(
    "$page says a probe that cannot ping checks TCP port 80 instead",
    (probePage: ProbePage) => {
      const fallback: string = sourceBetween(
        readRepoFile(PROBE_MONITOR_FILE),
        'if (LocalCache.getString("PROBE", "PING_MONITORING") === "PORT") {',
        "} else {",
      );

      expect(fallback).toContain("new Port(80)");
      expect(englishPage(probePage)).toContain("checks TCP port `80` on the");
    },
  );

  it("the Ping page quotes the probe's failure when a name does not resolve", () => {
    expect(ping).toMatch(
      new RegExp("This probe could not resolve \\$\\{hostAddress\\}"),
    );
    expect(englishPage(PING)).toContain('"This probe could not resolve"');
  });

  it("the IP page: brackets are dropped and a host name is refused", () => {
    const bracketed: ParsedMonitorDestination = MonitorDestinationUtil.parse({
      value: "[2001:db8::1]",
      monitorType: MonitorType.IP,
    });
    const name: ParsedMonitorDestination = MonitorDestinationUtil.parse({
      value: "example.com",
      monitorType: MonitorType.IP,
    });
    const page: string = englishPage(IP_PAGE);

    expect(bracketed.error).toBeNull();
    expect((bracketed.destination as IP).toString()).toBe("2001:db8::1");
    expect(page).toContain("Brackets around an IPv6 address are removed.");

    expect(name.error).not.toBeNull();
    expect(page).toContain(
      "A host name is not accepted: the field shows an error.",
    );
  });

  it("the Ping page: a host name, an IPv4 and an IPv6 address are all taken", () => {
    for (const value of ["example.com", "192.168.1.1", "2001:db8::1"]) {
      expect({
        value,
        error: MonitorDestinationUtil.parse({
          value: value,
          monitorType: MonitorType.Ping,
        }).error,
      }).toEqual({ value, error: null });
      expect(codeItems(englishPage(PING))).toContain(value);
    }
  });

  it.each([PING, IP_PAGE, PORT])(
    "$page names the incident a new monitor opens when it goes offline",
    (probePage: ProbePage) => {
      const [offline] = defaultCriteriaFor(probePage.monitorType);
      const incidentTitle: string = offline!.data!.incidents[0]!.title.replace(
        SAMPLE_NAME,
        "_monitor name_",
      );

      expect(offline!.data!.incidents[0]!.autoResolveIncident).toBe(true);
      expect(section(englishPage(probePage), "### Default Criteria")).toContain(
        `an incident called "${incidentTitle}" is created. The incident resolves itself`,
      );
    },
  );

  it.each([PING, IP_PAGE, PORT])(
    "$page names the network path a failed check carries, as the dashboard does",
    (probePage: ProbePage) => {
      expect(readRepoFile(NETWORK_PATH_VIEW_FILE)).toContain(
        '"Network Path at Time of Failure"',
      );
      expect(englishPage(probePage)).toContain(
        "**Network Path at Time of Failure**",
      );
    },
  );
});

describe("port checks", () => {
  const port: string = readRepoFile(PROBE_PORT_FILE);
  const page: string = englishPage(PORT);

  it("names the port field as the form does, and its upper bound", () => {
    const form: string = readRepoFile(MONITOR_STEP_FORM_FILE);
    const portField: string = sourceBetween(
      form,
      "props.monitorType === MonitorType.Port && (",
      "/>",
    );

    expect(portField).toContain('title={"Port"}');
    expect(page).toContain("In **Port**, enter the port number");
    expect(Port.isValid(65535)).toBe(true);
    expect(Port.isValid(65536)).toBe(false);
    expect(page).toContain("from `1` to `65535`");
  });

  it("says the probe opens TCP connections only", () => {
    expect(port).toContain('import net from "net";');
    expect(port).not.toContain("dgram");
    expect(page).toContain("The probe opens TCP connections only");
  });

  it("names the total connection time as the criteria form draws it", () => {
    const total: DropdownOption | undefined = offeredFilters(
      MonitorType.Port,
    ).find((option: DropdownOption): boolean => {
      return option.value === CheckOn.ResponseTime;
    });

    expect(total!.label).toBe("Total Connection Time (DNS + TCP) (in ms)");
    expect(page).toContain(`**${total!.label}**`);
    expect(page).toContain(
      "**Total Connection Time (DNS + TCP)** runs from the start",
    );
  });

  it("names the DNS and TCP phase filters as the criteria form does", () => {
    for (const checkOn of [
      CheckOn.PortDnsLookupTime,
      CheckOn.PortTcpConnectTime,
    ]) {
      expect(offeredFilter(MonitorType.Port, checkOn)).toBeDefined();
      expect(page).toContain(`**${checkOn}**`);
    }
  });

  it("says a port 25 check that times out counts as online on a probe that cannot ping", () => {
    expect(port).toContain(
      "portNumber === 25 && !(await Register.isPingMonitoringEnabled());",
    );
    expect(page).toContain(
      "On a probe that cannot send pings, which is how a probe notices it runs on such a provider, a check of port `25` that times out counts as online.",
    );
  });
});

describe("the labels the probe check pages name exist where the pages say", () => {
  it("the criteria form's checkbox, window, no-data and match labels", () => {
    const filterForm: string = readRepoFile(CRITERIA_FILTER_FORM_FILE);
    const instanceForm: string = readRepoFile(CRITERIA_INSTANCE_FORM_FILE);

    for (const label of [
      "Evaluate this criteria over a period of time",
      "For the last (in minutes)",
      "If No Data",
    ]) {
      expect({ label, inForm: filterForm.includes(`"${label}"`) }).toEqual({
        label,
        inForm: true,
      });
    }

    expect(instanceForm).toContain('"Match Condition"');
  });

  it("every label a probe check page bolds from the step form is one the form draws", () => {
    const sources: string = [
      readRepoFile(MONITOR_STEP_FORM_FILE),
      readRepoFile(
        "App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorMoreFields.ts",
      ),
    ].join("\n");

    for (const label of [
      "API Request Type",
      "Request Headers",
      "Request Body (in JSON)",
      "Do not follow redirects",
      "Allow self-signed certificates",
      "Use client certificate (mTLS)",
      "Request Timeout (seconds)",
      "Retries on Failure",
    ]) {
      expect({ label, drawn: sources.includes(`"${label}"`) }).toEqual({
        label,
        drawn: true,
      });
    }
  });
});
