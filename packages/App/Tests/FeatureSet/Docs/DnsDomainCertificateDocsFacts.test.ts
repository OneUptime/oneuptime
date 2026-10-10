import CriteriaFilterUtil from "../../../FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter";
import {
  MonitorDestinationFieldCopy,
  getMonitorDestinationFieldCopy,
} from "../../../FeatureSet/Dashboard/src/Utils/Form/Monitor/MonitorDestinationFieldCopy";
import {
  DNSSEC_MONITOR_MORE_FIELDS,
  DNS_MONITOR_MORE_FIELDS,
  DOMAIN_MONITOR_MORE_FIELDS,
  MonitorOptionSpec,
  getMonitorStepMoreFieldsItems,
} from "../../../FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorMoreFields";
import { MONITOR_TYPES_OFFERED_5_MINUTES_OR_LONGER } from "../../../FeatureSet/Dashboard/src/Utils/MonitorIntervalDropdownOptions";
import { readPage } from "./DocsContentSupport";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import OneUptimeDate from "Common/Types/Date";
import FilterCondition from "Common/Types/Filter/FilterCondition";
import {
  CheckOn,
  CriteriaFilterUtil as CommonCriteriaFilterUtil,
  EvaluateOverTimeMinutes,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "Common/Types/Monitor/CriteriaFilter";
import DnsRecordType from "Common/Types/Monitor/DnsMonitor/DnsRecordType";
import DomainLookupMethod from "Common/Types/Monitor/DomainMonitor/DomainLookupMethod";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorStep, {
  DEFAULT_MONITOR_REQUEST_TIMEOUT_IN_MS,
  MAX_MONITOR_REQUEST_TIMEOUT_IN_MS,
  MAX_MONITOR_RETRY_COUNT,
} from "Common/Types/Monitor/MonitorStep";
import MonitorStepDnsMonitor, {
  MonitorStepDnsMonitorUtil,
} from "Common/Types/Monitor/MonitorStepDnsMonitor";
import MonitorStepDnssecMonitor, {
  MonitorStepDnssecMonitorUtil,
} from "Common/Types/Monitor/MonitorStepDnssecMonitor";
import MonitorStepDomainMonitor, {
  MonitorStepDomainMonitorUtil,
} from "Common/Types/Monitor/MonitorStepDomainMonitor";
import MonitorType, {
  MonitorTypeCategory,
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import { PermissionHelper } from "Common/Types/Permission";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { FoldedSectionItem } from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import { MORE_FIELDS_SECTION_TITLE } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import { domainToASCII } from "node:url";
import path from "path";

/*
 * What the English DNS, DNSSEC, SSL Certificate and Domain monitor pages say
 * about the product, held to the code that makes it true.
 *
 * Markdown is not compiled, so nothing else notices when a form field is
 * renamed or folded, a default moves, a filter or a condition is added to
 * the criteria form, or the probe changes how it asks a resolver, reads a
 * signature or looks up a registration. Each test reads the source of truth
 * - the monitor forms' option specs and step defaults, the criteria form,
 * the criteria types, the probe's own sources (read as text: the probe is
 * its own package), the Monitor model - and checks the page still says what
 * it does. The translations are held to these English pages by
 * MonitorChecksDocsTranslations; the SSL and Domain default criteria also
 * by MonitorDefaultCriteriaDocs.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");

const PROBE_DNS_FILE: string =
  "Probe/Utils/Monitors/MonitorTypes/DnsMonitor.ts";
const PROBE_DNSSEC_FILE: string =
  "Probe/Utils/Monitors/MonitorTypes/DnssecMonitor.ts";
const PROBE_SSL_FILE: string =
  "Probe/Utils/Monitors/MonitorTypes/SslMonitor.ts";
const PROBE_DOMAIN_FILE: string =
  "Probe/Utils/Monitors/MonitorTypes/DomainMonitor.ts";
const PROBE_MONITOR_FILE: string = "Probe/Utils/Monitors/Monitor.ts";
const PROBE_CONFIG_FILE: string = "Probe/Config.ts";
const RDAP_BOOTSTRAP_FILE: string = "Probe/Utils/Domain/RdapBootstrap.ts";
const RDAP_LOOKUP_FILE: string = "Probe/Utils/Domain/RdapLookup.ts";
const RDAP_HTTP_FILE: string = "Probe/Utils/Domain/RdapHttp.ts";
const WHOIS_LOOKUP_FILE: string = "Probe/Utils/Domain/WhoisLookup.ts";
const DOMAIN_NAME_FILE: string = "Probe/Utils/Domain/DomainName.ts";
const DOMAIN_RECORD_FILE: string = "Probe/Utils/Domain/DomainRecord.ts";
const DNS_CRITERIA_FILE: string =
  "Common/Server/Utils/Monitor/Criteria/DnsMonitorCriteria.ts";
const DNSSEC_CRITERIA_FILE: string =
  "Common/Server/Utils/Monitor/Criteria/DnssecMonitorCriteria.ts";
const DOMAIN_CRITERIA_FILE: string =
  "Common/Server/Utils/Monitor/Criteria/DomainMonitorCriteria.ts";
const SSL_CRITERIA_FILE: string =
  "Common/Server/Utils/Monitor/Criteria/SSLMonitorCriteria.ts";
const DASHBOARD_FORMS_DIR: string =
  "App/FeatureSet/Dashboard/src/Components/Form/Monitor";
const DNS_FORM_FILE: string = `${DASHBOARD_FORMS_DIR}/DnsMonitor/DnsMonitorStepForm.tsx`;
const DNSSEC_FORM_FILE: string = `${DASHBOARD_FORMS_DIR}/DnssecMonitor/DnssecMonitorStepForm.tsx`;
const DOMAIN_FORM_FILE: string = `${DASHBOARD_FORMS_DIR}/DomainMonitor/DomainMonitorStepForm.tsx`;
const DNSSEC_VIEW_FILE: string =
  "App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/DnssecMonitorView.tsx";

interface CheckPage {
  page: string;
  monitorType: MonitorType;
}

const DNS: CheckPage = {
  page: "monitor/dns-monitor",
  monitorType: MonitorType.DNS,
};
const DNSSEC: CheckPage = {
  page: "monitor/dnssec-monitor",
  monitorType: MonitorType.DNSSEC,
};
const SSL: CheckPage = {
  page: "monitor/ssl-certificate-monitor",
  monitorType: MonitorType.SSLCertificate,
};
const DOMAIN: CheckPage = {
  page: "monitor/domain-monitor",
  monitorType: MonitorType.Domain,
};

const CHECK_PAGES: Array<CheckPage> = [DNS, DNSSEC, SSL, DOMAIN];

// The pages whose default criteria are a bulleted Offline / Online pair.
const BULLETED_DEFAULTS: Array<CheckPage> = [DNS, DNSSEC];

// Bold spans, and inline code spans, as a page writes them.
const BOLD_SPAN: RegExp = /\*\*([^*\n]+?)\*\*/g;
const CODE_SPAN: RegExp = /`([^`\n]+)`/g;
const HEADING_LINE: RegExp = /^(#{1,6})\s/;
const FENCE_LINE: RegExp = /^\s*```/;
const NUMBER_LITERAL: RegExp = /^(\d+)(?:\s*\*\s*(\d+))*$/;
const MORE_FIELDS_NOTE: string = `(under **${MORE_FIELDS_SECTION_TITLE}**)`;

const SAMPLE_NAME: string = "Acme";

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relativePath), "utf8");
}

function englishPage(checkPage: CheckPage): string {
  return readPage("en", checkPage.page);
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

// The value of a numeric constant in a source file: "3" or "24 * 60 * 1000".
function numericConstant(source: string, name: string): number {
  const match: RegExpMatchArray | null = source.match(
    new RegExp(`${name}: number =\\s*([^;]+);`),
  );

  expect({ name, found: Boolean(match) }).toEqual({ name, found: true });

  const literal: string = (match![1] as string).trim();

  expect({ name, literal: NUMBER_LITERAL.test(literal) }).toEqual({
    name,
    literal: true,
  });

  return literal
    .split("*")
    .map((factor: string): number => {
      return Number(factor.trim());
    })
    .reduce((product: number, factor: number): number => {
      return product * factor;
    }, 1);
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
      warningAlertSeverityId: ObjectID.generate(),
    }).data?.monitorCriteriaInstanceArray || []
  );
}

// An incident or alert title as the pages write it: "_monitor name_ ...".
function asDocumented(title: string): string {
  return title.replace(SAMPLE_NAME, "_monitor name_");
}

/*
 * The rows of a page's Configuration options table: the field's title, the
 * default as written, and whether it is folded under More fields.
 */
interface ConfigRow {
  title: string;
  defaultValue: string;
  folded: boolean;
}

function configRows(markdown: string): Array<ConfigRow> {
  return tableRows(section(markdown, "## Configuration options")).map(
    (row: Array<string>): ConfigRow => {
      return {
        title: boldItems(row[0] as string)[0] as string,
        defaultValue: row[1] as string,
        folded: (row[0] as string).includes(MORE_FIELDS_NOTE),
      };
    },
  );
}

// The folded fields a monitor form's own More fields section holds, in order.
function foldedTitles(specs: Array<MonitorOptionSpec>): Array<string> {
  return specs.map((spec: MonitorOptionSpec): string => {
    return spec.title;
  });
}

// A number default as the table writes it: "`53`".
function asCode(value: number | string): string {
  return `\`${value}\``;
}

describe.each(CHECK_PAGES)("$page", (checkPage: CheckPage) => {
  const page: string = englishPage(checkPage);
  const title: string = MonitorTypeHelper.getTitle(checkPage.monitorType);

  it("starts the monitor where the type picker offers the type", () => {
    const start: string = section(page, "### Start a new monitor");

    expect(start).toContain("Go to **Monitors** and click **Create Monitor**.");

    if (
      MonitorTypeHelper.getCommonMonitorTypes().includes(checkPage.monitorType)
    ) {
      expect(start).toContain(`Under **Monitor Type**, pick **${title}**.`);
      return;
    }

    // Not among the six common types: behind More monitor types.
    const category: MonitorTypeCategory | undefined =
      MonitorTypeHelper.getMonitorTypeCategories().find(
        (candidate: MonitorTypeCategory): boolean => {
          return candidate.monitorTypes.includes(checkPage.monitorType);
        },
      );

    expect(category).toBeDefined();
    expect(start).toContain(
      `click **More monitor types** and pick **${title}** under **${category!.label}**.`,
    );
  });

  it("says who can create the monitor, as the Monitor model allows", () => {
    const sentence: string | undefined = page
      .split("\n")
      .find((line: string): boolean => {
        return line.startsWith("- **A role that can create monitors**:");
      });
    const titles: Array<string> = PermissionHelper.getPermissionTitles(
      new Monitor().getCreatePermissions(),
    );

    expect(sentence).toBeDefined();

    for (const permissionTitle of titles) {
      expect({
        permissionTitle,
        named: sentence!.includes(permissionTitle),
      }).toEqual({ permissionTitle, named: true });
    }

    expect(sentence).toContain(
      "a custom role with the Create Monitor permission",
    );
  });

  it("starts the interval where the form does, and names the types held to five minutes", () => {
    const pick: string = section(page, "### Pick probes and create");

    expect(pick).toContain(
      "**Monitoring Interval** (it starts at **Every 5 Minutes**",
    );
    expect(pick.includes("are offered 5 minutes or longer")).toBe(
      MONITOR_TYPES_OFFERED_5_MINUTES_OR_LONGER.includes(checkPage.monitorType),
    );
  });

  it("lists exactly the filters the criteria form offers", () => {
    const documented: Array<string> = tableRows(
      section(page, "## Monitoring Criteria"),
    ).map((row: Array<string>): string => {
      return boldItems(row[0] as string)[0] as string;
    });

    expect(sorted(documented)).toEqual(
      sorted(
        offeredFilters(checkPage.monitorType).map(
          (option: DropdownOption): string => {
            return option.label;
          },
        ),
      ),
    );
  });

  it("lists, for every filter, exactly the conditions the form offers", () => {
    for (const row of tableRows(section(page, "## Monitoring Criteria"))) {
      const label: string = boldItems(row[0] as string)[0] as string;
      const filter: DropdownOption | undefined = offeredFilter(
        checkPage.monitorType,
        label,
      );

      expect({ label, offered: Boolean(filter) }).toEqual({
        label,
        offered: true,
      });
      expect({
        label,
        conditions: sorted(boldItems(row[1] as string)),
      }).toEqual({
        label,
        conditions: sorted(conditionsOf(filter!.value as CheckOn)),
      });
    }
  });

  it("builds every example criteria from a filter and a condition the form offers", () => {
    for (const row of tableRows(section(page, "### Example criteria"))) {
      const label: string = boldItems(row[1] as string)[0] as string;
      const condition: string = boldItems(row[2] as string)[0] as string;
      const filter: DropdownOption | undefined = offeredFilter(
        checkPage.monitorType,
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

  it("names every condition it bolds as the criteria form's dropdown draws it", () => {
    const conditionNames: Array<string> = Object.values(
      FilterType,
    ) as Array<string>;
    // A condition written in another case is not on the screen.
    const miscased: Array<string> = boldItems(page).filter(
      (span: string): boolean => {
        return (
          !conditionNames.includes(span) &&
          conditionNames.some((name: string): boolean => {
            return name.toLowerCase() === span.toLowerCase();
          })
        );
      },
    );

    expect(miscased).toEqual([]);
  });

  it("names the Match Condition's choices as the filter conditions are named", () => {
    expect(page).toContain(
      `**Match Condition** decides whether **${FilterCondition.All}** of them or **${FilterCondition.Any}** one must match.`,
    );
  });

  it("says the first criteria that matches decides", () => {
    expect(section(page, "### Default Criteria")).toContain(
      "the first one that matches decides what happens",
    );
  });

  it("offers Evaluate this criteria over a period of time where the form does", () => {
    const overTime: Array<string> = offeredFilters(checkPage.monitorType)
      .filter((option: DropdownOption): boolean => {
        return CommonCriteriaFilterUtil.isEvaluateOverTimeFilter(
          option.value as CheckOn,
        );
      })
      .map((option: DropdownOption): string => {
        return option.label;
      });

    // A page that names the checkbox has a filter that offers it.
    expect(
      page.includes("**Evaluate this criteria over a period of time**"),
    ).toBe(overTime.length > 0);
  });
});

describe.each(BULLETED_DEFAULTS)(
  "$page's default criteria",
  (checkPage: CheckPage) => {
    const defaults: string = section(
      englishPage(checkPage),
      "### Default Criteria",
    );

    it("names as many default criteria as a new monitor gets", () => {
      const items: Array<string> = Array.from(
        defaults.matchAll(new RegExp("^- \\*\\*([^*]+)\\*\\* —", "gm")),
      ).map((match: RegExpMatchArray): string => {
        return match[1] as string;
      });

      expect(items).toHaveLength(
        defaultCriteriaFor(checkPage.monitorType).length,
      );
    });

    it("names the incident the offline criteria declares, exactly as it is created", () => {
      const offline: MonitorCriteriaInstance = defaultCriteriaFor(
        checkPage.monitorType,
      )[0]!;

      expect(offline.data!.createIncidents).toBe(true);
      expect(offline.data!.changeMonitorStatus).toBe(true);
      expect(defaults).toContain(
        `"${asDocumented(offline.data!.incidents[0]!.title)}"`,
      );
      expect(offline.data!.incidents[0]!.autoResolveIncident).toBe(true);
      expect(defaults).toContain("resolves itself");
    });

    it("names the filter each default criteria checks", () => {
      const [offline, online] = defaultCriteriaFor(checkPage.monitorType);
      const offlineFilter: CheckOn = offline!.data!.filters[0]!.checkOn;
      const onlineFilter: CheckOn = online!.data!.filters[0]!.checkOn;

      // One filter each: True for online, False for offline.
      expect(offline!.data!.filters).toHaveLength(1);
      expect(online!.data!.filters).toHaveLength(1);
      expect(offline!.data!.filters[0]!.filterType).toBe(FilterType.False);
      expect(online!.data!.filters[0]!.filterType).toBe(FilterType.True);
      expect(offlineFilter).toBe(onlineFilter);

      // The page names that filter as False in the offline criteria.
      const examples: Array<Array<string>> = tableRows(
        section(englishPage(checkPage), "### Example criteria"),
      );

      expect(
        examples.some((row: Array<string>): boolean => {
          return (
            boldItems(row[1] as string)[0] === offlineFilter &&
            boldItems(row[2] as string)[0] === FilterType.False
          );
        }),
      ).toBe(true);
    });
  },
);

describe("DNS monitor", () => {
  const page: string = englishPage(DNS);
  const defaults: MonitorStepDnsMonitor =
    MonitorStepDnsMonitorUtil.getDefault();
  const probe: string = readRepoFile(PROBE_DNS_FILE);

  it("names the form's fields as it draws them, and folds the same ones", () => {
    const form: string = readRepoFile(DNS_FORM_FILE);
    const rows: Array<ConfigRow> = configRows(page);

    for (const row of rows) {
      expect({ title: row.title, drawn: true }).toEqual({
        title: row.title,
        drawn: form.includes(`title="${row.title}"`),
      });
    }

    expect(
      rows
        .filter((row: ConfigRow): boolean => {
          return row.folded;
        })
        .map((row: ConfigRow): string => {
          return row.title;
        }),
    ).toEqual(foldedTitles(DNS_MONITOR_MORE_FIELDS));
    expect(form).toContain("DNS_MONITOR_MORE_FIELDS");
  });

  it("quotes every default the form starts with", () => {
    const rows: Array<ConfigRow> = configRows(page);
    const byTitle: (title: string) => ConfigRow = (
      title: string,
    ): ConfigRow => {
      return rows.find((row: ConfigRow): boolean => {
        return row.title === title;
      }) as ConfigRow;
    };

    expect(defaults.queryName).toBe("");
    expect(byTitle("Domain Name").defaultValue).toBe("None");
    expect(byTitle("Record Type").defaultValue).toBe(
      asCode(defaults.recordType),
    );
    expect(defaults.hostname).toBe("");
    expect(byTitle("DNS Server (Optional)").defaultValue).toBe(
      "The probe's resolver",
    );

    for (const spec of DNS_MONITOR_MORE_FIELDS) {
      expect({
        title: spec.title,
        defaultValue: byTitle(spec.title).defaultValue,
      }).toEqual({
        title: spec.title,
        defaultValue: asCode(spec.defaultValue as number),
      });
    }

    expect(defaults.port).toBe(53);
    expect(defaults.timeout).toBe(5000);
    expect(defaults.retries).toBe(3);
  });

  it("lists exactly the record types the form offers", () => {
    const documented: Array<string> = tableRows(
      section(page, "### Record types"),
    ).map((row: Array<string>): string => {
      return codeItems(row[0] as string)[0] as string;
    });

    expect(documented).toEqual(Object.values(DnsRecordType));
  });

  it("writes each record's value in the format the probe writes it", () => {
    const rows: Array<Array<string>> = tableRows(
      section(page, "### Record types"),
    );
    const format: (recordType: DnsRecordType) => string = (
      recordType: DnsRecordType,
    ): string => {
      return (
        rows.find((row: Array<string>): boolean => {
          return codeItems(row[0] as string)[0] === recordType;
        })?.[2] || ""
      );
    };

    // The template literals the probe builds each value with.
    expect(probe).toContain("value: `${result.priority} ${result.exchange}`");
    expect(format(DnsRecordType.MX)).toContain("(priority, then the server)");
    expect(probe).toContain(
      "value: `${result.priority} ${result.weight} ${result.port} ${result.name}`",
    );
    expect(format(DnsRecordType.SRV)).toContain(
      "(priority, weight, port, target)",
    );
    expect(probe).toContain(
      "value: `${result.nsname} ${result.hostmaster} ${result.serial} ${result.refresh} ${result.retry} ${result.expire} ${result.minttl}`",
    );
    expect(format(DnsRecordType.SOA)).toContain(
      "(server, contact, serial, refresh, retry, expire, minimum TTL)",
    );
    expect(probe).toContain(
      '`${result.critical} ${result.issue || result.issuewild || result.iodef || ""}`.trim()',
    );
    expect(format(DnsRecordType.CAA)).toContain("(flag, then the authority)");

    // A TXT record split into strings is one value.
    expect(probe).toContain('value: result.join(""),');
    expect(page).toContain(
      "A `TXT` record split into several strings is joined into one value.",
    );
  });

  it("asks every record type, CAA included, of the chosen server and port", () => {
    const records: string = sourceBetween(
      probe,
      "private static async resolveRecords(",
      "private static isValidHostnameOrIP(",
    );

    expect(records).toContain("await resolver.resolveCaa(queryName)");
    expect(records).not.toContain("await dns.promises.resolveCaa(");
    // The resolver those queries go through asks the server, on its port.
    expect(probe).toContain("? `${config.hostname}:${config.port}`");
    expect(probe).toContain("resolver.setServers([server]);");
    expect(page).toContain(
      "Every record type, `CAA` included, is asked of it.",
    );
  });

  it("checks DNSSEC with the chosen server on its port, or with Google Public DNS", () => {
    const check: string = sourceBetween(
      probe,
      "private static async checkDnssec(",
      "\n  }\n}",
    );

    expect(check).toContain('args.push(`@${dnsServer || "8.8.8.8"}`);');
    expect(check).toContain('args.push("-p", String(dnsServerPort));');
    expect(check).toContain("dnsServerPort !== 53");
    expect(page).toContain(
      "**DNSSEC Is Valid** asks the server in **DNS Server (Optional)**, on its **Port**, or Google Public DNS (`8.8.8.8`) when that is empty",
    );
    expect(page).toContain("The DNSSEC check asks the same port.");
  });

  it("says DNSSEC Is Valid matches neither way when the probe cannot check", () => {
    const criteria: string = readRepoFile(DNS_CRITERIA_FILE);

    expect(criteria).toContain(
      "if (dnsResponse?.isDnssecValid === undefined) {\n        return null;",
    );
    expect(page).toContain(
      "The filter has no value, and matches neither way, when the probe cannot run that check.",
    );
  });

  it("says a record value filter matches when any one record does", () => {
    const criteria: string = sourceBetween(
      readRepoFile(DNS_CRITERIA_FILE),
      "if (input.criteriaFilter.checkOn === CheckOn.DnsRecordValue) {",
      "return null;\n  }\n}",
    );

    expect(criteria).toContain("for (const record of dnsResponse.records) {");
    expect(page).toContain(
      "**DNS Record Value** matches when _any_ of the records matches.",
    );
  });

  it("retries a failed query a second later, after the first attempt", () => {
    expect(probe).toContain("await Sleep.sleep(1000);");
    expect(page).toContain(
      "is tried again a second later, up to the number of retries you set",
    );
    expect(page).toContain(
      "Retries after the first attempt fails. `0` means a single attempt.",
    );
  });

  it("evaluates over time exactly the filters the form offers it for", () => {
    const evaluating: string = section(
      page,
      "### Evaluating over a period of time",
    );
    const sentence: string = evaluating.slice(
      evaluating.indexOf("offered for "),
      evaluating.indexOf(". Turn it on"),
    );

    expect(sorted(boldItems(sentence))).toEqual(
      sorted(
        offeredFilters(MonitorType.DNS)
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

  it("lists the aggregates, and says which are for the response time only", () => {
    const rows: Array<Array<string>> = tableRows(
      section(page, "### Evaluating over a period of time"),
    );
    const documented: Array<string> = rows.flatMap(
      (row: Array<string>): Array<string> => {
        return boldItems(row[0] as string);
      },
    );

    expect(sorted(documented)).toEqual(
      sorted(Object.values(EvaluateOverTimeType)),
    );

    // DNS Is Online is a true/false series: only All Values and Any Value.
    const onlineAggregates: Array<EvaluateOverTimeType> =
      CommonCriteriaFilterUtil.getEvaluateOverTimeTypeByCriteriaFilter({
        checkOn: CheckOn.DnsIsOnline,
        filterType: FilterType.False,
        value: undefined,
      });
    const numericOnly: Array<string> = Object.values(
      EvaluateOverTimeType,
    ).filter((type: EvaluateOverTimeType): boolean => {
      return !onlineAggregates.includes(type);
    });

    expect(sorted(boldItems(rows[0]![0] as string))).toEqual(
      sorted(numericOnly),
    );
    expect(rows[0]![1]).toContain(`**${CheckOn.DnsResponseTime}** only.`);
  });

  it("gives the window and the If No Data options the form offers", () => {
    const evaluating: string = section(
      page,
      "### Evaluating over a period of time",
    );
    const minutes: Array<number> = Object.values(EvaluateOverTimeMinutes).map(
      (value: string): number => {
        return Number(value);
      },
    );

    expect(evaluating).toContain(
      `from ${Math.min(...minutes)} to ${Math.max(...minutes)} minutes, under **For the last (in minutes)**`,
    );

    const noData: Array<Array<string>> = tableRows(
      evaluating.slice(evaluating.indexOf("**If No Data**")),
    );

    expect(
      sorted(
        noData.map((row: Array<string>): string => {
          return boldItems(row[0] as string)[0] as string;
        }),
      ),
    ).toEqual(sorted(Object.values(NoDataPolicy)));
    expect(rowFor(noData, NoDataPolicy.Ignore)![0]).toBe(
      `**${NoDataPolicy.Ignore}** (default)`,
    );
  });
});

describe("DNSSEC monitor", () => {
  const page: string = englishPage(DNSSEC);
  const defaults: MonitorStepDnssecMonitor =
    MonitorStepDnssecMonitorUtil.getDefault();
  const probe: string = readRepoFile(PROBE_DNSSEC_FILE);

  it("names the form's fields as it draws them, and folds the same ones", () => {
    const form: string = readRepoFile(DNSSEC_FORM_FILE);
    const rows: Array<ConfigRow> = configRows(page);

    for (const row of rows) {
      expect({ title: row.title, drawn: true }).toEqual({
        title: row.title,
        drawn: form.includes(`title="${row.title}"`),
      });
    }

    expect(
      rows
        .filter((row: ConfigRow): boolean => {
          return row.folded;
        })
        .map((row: ConfigRow): string => {
          return row.title;
        }),
    ).toEqual(foldedTitles(DNSSEC_MONITOR_MORE_FIELDS));
  });

  it("quotes every default the form starts with", () => {
    const rows: Array<ConfigRow> = configRows(page);
    const byTitle: (title: string) => ConfigRow = (
      title: string,
    ): ConfigRow => {
      return rows.find((row: ConfigRow): boolean => {
        return row.title === title;
      }) as ConfigRow;
    };

    expect(defaults.domainName).toBe("");
    expect(byTitle("Zone (Domain Name)").defaultValue).toBe("None");
    expect(byTitle("Resolvers").defaultValue).toBe(
      asCode(defaults.resolvers.join(", ")),
    );
    expect(defaults.checkNameserverConsistency).toBe(true);
    expect(byTitle("Check Nameserver Consistency").defaultValue).toBe("On");

    for (const spec of DNSSEC_MONITOR_MORE_FIELDS) {
      expect({
        title: spec.title,
        defaultValue: byTitle(spec.title).defaultValue,
      }).toEqual({
        title: spec.title,
        defaultValue: asCode(spec.defaultValue as number),
      });
    }

    expect(defaults.signatureExpiryWarningDays).toBe(7);
    expect(defaults.timeout).toBe(10000);
    expect(defaults.retries).toBe(3);
  });

  it("names the queries the probe runs, and whom it asks", () => {
    const rows: Array<Array<string>> = tableRows(
      section(page, "## How it works"),
    );
    const queries: Array<Array<string>> = rows.map(
      (row: Array<string>): Array<string> => {
        return codeItems(row[0] as string);
      },
    );

    expect(queries).toEqual([
      ["DNSKEY"],
      ["DS"],
      ["SOA"],
      ["A"],
      ["NS", "SOA"],
    ]);

    // The keys, the DS and the signed SOA are asked of the first resolver.
    expect(probe).toContain(
      'const defaultResolver: string = config.resolvers[0] || "1.1.1.1";',
    );
    expect(
      sourceBetween(
        probe,
        "private static async fetchDnskeys(",
        "private static async fetchParentDs(",
      ),
    ).toContain('"DNSKEY",');
    expect(
      sourceBetween(
        probe,
        "private static async fetchParentDs(",
        "private static async fetchRrsigs(",
      ),
    ).toContain('await DnssecMonitorUtil.dig(domainName, "DS", {');

    // Signatures come with the SOA answer, read for their RRSIG lines.
    const rrsigs: string = sourceBetween(
      probe,
      "private static async fetchRrsigs(",
      "private static parseDigTimestamp(",
    );

    expect(rrsigs).toContain(
      'await DnssecMonitorUtil.dig(domainName, "SOA", {',
    );
    expect(rrsigs).toContain('digFlags: ["+dnssec"],');
    expect(rrsigs).toContain('if (recordType !== "RRSIG") {');
    expect(rows[2]![2]).toContain("the `RRSIG` that signs its `SOA` record");

    // Every resolver is asked for the zone's A record, validating.
    const resolvers: string = sourceBetween(
      probe,
      "private static async checkResolvers(",
      "private static async checkNameserverConsistency(",
    );

    expect(resolvers).toContain("for (const resolver of resolvers) {");
    expect(resolvers).toContain('"A",');
    expect(resolvers).toContain('digFlags: ["+dnssec", "+nocdflag"],');
    expect(rows[3]![1]).toBe("Every resolver in **Resolvers**");

    // The nameservers come from an NS query, then each is asked for its SOA.
    const nameservers: string = sourceBetween(
      probe,
      "private static async checkNameserverConsistency(",
      "private static areNameserversConsistent(",
    );

    expect(nameservers).toContain('"NS",');
    expect(nameservers).toContain('digFlags: ["+dnssec", "+norecurse"],');
    expect(probe).toContain("if (config.checkNameserverConsistency) {");
    expect(rows[4]![2]).toContain(
      "Only when **Check Nameserver Consistency** is on.",
    );
  });

  it("counts the chain valid only with a day or more left on the signatures", () => {
    const verdict: string = sourceBetween(
      probe,
      "const isChainValid: boolean =",
      ";",
    );

    expect(verdict).toContain("isZoneSigned &&");
    expect(verdict).toContain("isParentDsPresent &&");
    expect(verdict).toContain("rrsigs.length > 0 &&");
    expect(verdict).toContain("resolverConsensusAd &&");
    expect(verdict).toContain("daysUntilSignatureExpiry > 0");
    // Whole days: less than a day left is 0.
    expect(probe).toContain(
      "? Math.floor(\n            (earliestExpiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24),",
    );
    expect(page).toContain(
      'rrsig["Signatures present,<br/>a day or more left"]',
    );
    expect(page).toContain(
      "signatures present with a day or more left, and the AD flag from every resolver",
    );
    expect(page).toContain(
      "A signature with less than a day left already counts as broken",
    );
  });

  it("gives one attempt three times the timeout, and retries a broken verdict a second later", () => {
    expect(numericConstant(probe, "DNSSEC_TOTAL_TIMEOUT_MULTIPLIER")).toBe(3);
    expect(page).toContain(
      "All the queries of one attempt share a deadline of three times the **Timeout (ms)**",
    );
    expect(probe).toContain("failureCause &&\n        MonitorRetry.canRetry({");
    expect(probe).toContain("await Sleep.sleep(1000);");
    expect(page).toContain("is run again a second later");
  });

  it("says the signature expiry warning field does not drive the filter", () => {
    expect(readRepoFile(DNSSEC_CRITERIA_FILE)).not.toContain(
      "signatureExpiryWarningDays",
    );
    expect(
      rowFor(
        tableRows(section(page, "## Configuration options")),
        "Signature Expiry Warning (days)",
      )![2],
    ).toContain(
      "The **DNSSEC Signature Expires In Days** filter uses the value you give it in the criteria",
    );
  });

  it("counts nameservers consistent while the check is off", () => {
    const consistent: string = sourceBetween(
      probe,
      "private static areNameserversConsistent(",
      "return serials.size <= 1;",
    );

    expect(consistent).toContain(
      "if (checks.length === 0) {\n      return true;",
    );
    expect(
      rowFor(
        tableRows(section(page, "## Monitoring Criteria")),
        CheckOn.DnssecNameserverConsistent,
      )![2],
    ).toContain(
      "Always **True** while **Check Nameserver Consistency** is off.",
    );
  });

  it("names the summary's tables as the monitor's page draws them", () => {
    const view: string = readRepoFile(DNSSEC_VIEW_FILE);

    for (const table of ["Resolver Checks", "Nameserver Consistency"]) {
      expect({
        table,
        drawn: view.includes(`translateText("${table}")`),
      }).toEqual({
        table,
        drawn: true,
      });
      expect(page).toContain(`The **${table}** table`);
    }
  });
});

describe("SSL Certificate monitor", () => {
  const page: string = englishPage(SSL);
  const probe: string = readRepoFile(PROBE_SSL_FILE);

  it("names the address field, and gives its example, as the form does", () => {
    const copy: MonitorDestinationFieldCopy | null =
      getMonitorDestinationFieldCopy(MonitorType.SSLCertificate);

    expect(copy).not.toBeNull();
    expect(page).toContain(`In **${copy!.title}**, enter`);
    expect(codeItems(page)).toContain(copy!.placeholder);
  });

  it("folds exactly the fields the form folds under More fields, in its order", () => {
    const folded: Array<string> = getMonitorStepMoreFieldsItems({
      monitorType: MonitorType.SSLCertificate,
      monitorStep: new MonitorStep(),
      usesClientCertificate: false,
    }).map((item: FoldedSectionItem): string => {
      return item.title;
    });

    expect(
      configRows(page)
        .filter((row: ConfigRow): boolean => {
          return row.folded;
        })
        .map((row: ConfigRow): string => {
          return row.title;
        }),
    ).toEqual(folded);
  });

  it("quotes the request timeout's default and maximum, and the retries'", () => {
    const rows: Array<Array<string>> = tableRows(
      section(page, "## Configuration options"),
    );
    const timeout: Array<string> | undefined = rowFor(
      rows,
      "Request Timeout (seconds)",
    );
    const retries: Array<string> | undefined = rowFor(
      rows,
      "Retries on Failure",
    );
    const probeDefault: RegExpMatchArray | null = sourceBetween(
      readRepoFile(PROBE_CONFIG_FILE),
      "export const PROBE_MONITOR_RETRY_LIMIT",
      "});",
    ).match(new RegExp("defaultValue: (\\d+)"));

    expect(timeout![1]).toBe(
      asCode(DEFAULT_MONITOR_REQUEST_TIMEOUT_IN_MS / 1000),
    );
    expect(timeout![2]).toContain(
      `The maximum is ${MAX_MONITOR_REQUEST_TIMEOUT_IN_MS / 1000} seconds.`,
    );
    expect(retries![1]).toBe(`Probe default, usually \`${probeDefault![1]}\``);
    expect(retries![2]).toContain(`The maximum is ${MAX_MONITOR_RETRY_COUNT}.`);
  });

  it("checks port 443 unless the URL names another, and pauses a second between attempts", () => {
    expect(probe).toContain(
      "const port: number = target.port?.toNumber() || 443;",
    );
    expect(page).toContain("port `443` unless the URL names another");
    expect(probe).toContain("await Sleep.sleep(1000);");
    expect(page).toContain("with a one-second pause between attempts");
  });

  it("reads the certificate even when it fails verification", () => {
    expect(probe).toContain("rejectUnauthorized: true,");
    expect(probe).toContain("rejectUnauthorized: false,");
    expect(page).toContain(
      "If the certificate fails verification, the probe still reads it",
    );
  });

  it("counts whole days and whole hours to expiry", () => {
    const now: Date = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
    const expiresAt: Date = new Date(
      now.getTime() + (14 * 24 + 20) * 60 * 60 * 1000,
    );

    // "a certificate that expires in 14 days and 20 hours has 14 days left"
    expect(OneUptimeDate.getDaysBetweenTwoDates(now, expiresAt)).toBe(14);
    expect(OneUptimeDate.getHoursBetweenTwoDates(now, expiresAt)).toBe(356);
    expect(readRepoFile(SSL_CRITERIA_FILE)).toContain(
      "OneUptimeDate.getDaysBetweenTwoDates(",
    );
    expect(page).toContain(
      "a certificate that expires in 14 days and 20 hours has 14 days left",
    );
  });

  it("quotes the root cause of a certificate that could not be checked", () => {
    const reason: string =
      "SSL certificate could not be checked because the endpoint is not reachable.";

    expect(readRepoFile(SSL_CRITERIA_FILE)).toContain(`"${reason}"`);
    expect(page).toContain(
      ':::details The monitor is offline with "could not be checked because the endpoint is not reachable"',
    );
  });

  it("counts a certificate the probe could not reach as not valid", () => {
    const valid: string = sourceBetween(
      readRepoFile(SSL_CRITERIA_FILE),
      "private static isValidCertificate(",
      "private static invalidCertificateReason(",
    );

    expect(valid).toContain("if (!sslResponse || !dataToProcess.isOnline) {");
    expect(
      rowFor(
        tableRows(section(page, "## Monitoring Criteria")),
        CheckOn.IsValidCertificate,
      )![2],
    ).toContain("**False** when the endpoint did not answer.");
  });
});

describe("Domain monitor", () => {
  const page: string = englishPage(DOMAIN);
  const defaults: MonitorStepDomainMonitor =
    MonitorStepDomainMonitorUtil.getDefault();
  const probe: string = readRepoFile(PROBE_DOMAIN_FILE);

  it("names the form's fields as it draws them, and folds the same ones", () => {
    const form: string = readRepoFile(DOMAIN_FORM_FILE);
    const rows: Array<ConfigRow> = configRows(page);

    for (const row of rows) {
      expect({ title: row.title, drawn: true }).toEqual({
        title: row.title,
        drawn: form.includes(`title="${row.title}"`),
      });
    }

    expect(
      rows
        .filter((row: ConfigRow): boolean => {
          return row.folded;
        })
        .map((row: ConfigRow): string => {
          return row.title;
        }),
    ).toEqual(foldedTitles(DOMAIN_MONITOR_MORE_FIELDS));
  });

  it("quotes every default the form starts with", () => {
    const rows: Array<ConfigRow> = configRows(page);
    const byTitle: (title: string) => ConfigRow = (
      title: string,
    ): ConfigRow => {
      return rows.find((row: ConfigRow): boolean => {
        return row.title === title;
      }) as ConfigRow;
    };

    expect(defaults.domainName).toBe("");
    expect(byTitle("Domain Name").defaultValue).toBe("None");
    expect(byTitle("Lookup Method").defaultValue).toBe(
      `**${defaults.lookupMethod}**`,
    );

    for (const spec of DOMAIN_MONITOR_MORE_FIELDS) {
      expect({
        title: spec.title,
        defaultValue: byTitle(spec.title).defaultValue,
      }).toEqual({
        title: spec.title,
        defaultValue: asCode(spec.defaultValue as number),
      });
    }

    expect(defaults.timeout).toBe(10000);
    expect(defaults.retries).toBe(3);
  });

  it("lists exactly the lookup methods the form offers, Auto as the default", () => {
    const methods: Array<string> = tableRows(
      section(page, "### Lookup methods"),
    ).map((row: Array<string>): string => {
      return boldItems(row[0] as string)[0] as string;
    });

    expect(methods).toEqual(Object.values(DomainLookupMethod));
    expect(defaults.lookupMethod).toBe(DomainLookupMethod.Auto);
    expect(
      rowFor(
        tableRows(section(page, "### Lookup methods")),
        DomainLookupMethod.Auto,
      )![1],
    ).toContain("Default.");
  });

  it("names IANA's bootstrap registry, and how long a probe keeps it", () => {
    const bootstrap: string = readRepoFile(RDAP_BOOTSTRAP_FILE);

    expect(bootstrap).toContain(
      'export const IANA_RDAP_BOOTSTRAP_URL: string =\n  "https://data.iana.org/rdap/dns.json";',
    );
    expect(codeItems(page)).toContain("https://data.iana.org/rdap/dns.json");
    expect(numericConstant(bootstrap, "BOOTSTRAP_CACHE_TTL_IN_MS")).toBe(
      24 * 60 * 60 * 1000,
    );
    expect(page).toContain("Fetched once and cached for 24 hours.");
    expect(
      numericConstant(bootstrap, "BOOTSTRAP_FAILURE_CACHE_TTL_IN_MS"),
    ).toBe(5 * 60 * 1000);
    expect(page).toContain(
      "**Auto** falls back to WHOIS and tries IANA again after five minutes",
    );
  });

  it("sends RDAP through the probe's proxy, and WHOIS around it", () => {
    const config: string = readRepoFile(PROBE_CONFIG_FILE);

    expect(readRepoFile(RDAP_HTTP_FILE)).toContain(
      "ProxyConfig.getRequestProxyAgents(url)",
    );
    expect(readRepoFile(WHOIS_LOOKUP_FILE)).not.toContain("ProxyConfig");

    for (const variable of ["HTTP_PROXY_URL", "HTTPS_PROXY_URL", "NO_PROXY"]) {
      expect({
        variable,
        read: config.includes(`process.env["${variable}"]`),
      }).toEqual({
        variable,
        read: true,
      });
      expect(page).toContain(`\`${variable}\``);
    }
  });

  it("quotes the failures a reader is told to look for", () => {
    expect(readRepoFile(RDAP_LOOKUP_FILE)).toContain(
      "`No RDAP service is published for .",
    );
    expect(page).toContain(
      ':::details The check fails with "No RDAP service is published"',
    );

    expect(readRepoFile(WHOIS_LOOKUP_FILE)).toContain(
      "answered without any registration data.",
    );
    expect(page).toContain(
      ':::details The WHOIS server "answered without any registration data"',
    );

    // The retired host's answer, and DENIC's "free".
    expect(readRepoFile(WHOIS_LOOKUP_FILE)).toContain(
      'answers "TLD is not supported."',
    );
    expect(page).toContain("`TLD is not supported.`");
    expect(readRepoFile(DOMAIN_RECORD_FILE)).toContain('  "free",');
    expect(page).toContain("DENIC's `Status: free`");
  });

  it("asks WHOIS only when RDAP has no answer, never when it says not registered", () => {
    const auto: string = sourceBetween(
      probe,
      "private static async lookupAuto(",
      "private static combineAutoFailures(",
    );

    expect(auto).toContain(
      "if (err instanceof DomainNotFoundError) {\n        throw err;",
    );
    expect(auto).toContain("await WhoisLookup.lookup(domainName, {");
    expect(page).toContain(
      "When the TLD's RDAP server says the domain is not registered, **Auto** takes that as the answer and does not ask WHOIS.",
    );
  });

  it("reports a malformed name at once, and retries every other failure a second later", () => {
    expect(probe).toContain("if (!DomainNameUtil.isValid(domainName)) {");
    expect(page).toContain(
      "Only a malformed domain name is reported at once, without a lookup.",
    );
    expect(probe).toContain("await Sleep.sleep(1000);");
    expect(page).toContain(
      "Every failed lookup is retried, with a one-second pause between attempts.",
    );
  });

  it("reads internationalized names and pasted addresses as the registry needs them", () => {
    const domainName: string = readRepoFile(DOMAIN_NAME_FILE);

    expect(domainToASCII("münchen.de")).toBe("xn--mnchen-3ya.de");
    expect(domainName).toContain(
      "return domainToASCII(normalized) || normalized;",
    );
    expect(page).toContain(
      "`münchen.de` is converted to its A-label (`xn--mnchen-3ya.de`)",
    );

    // A scheme, then a path, are taken off what was pasted.
    expect(domainName).toContain(
      'normalized = normalized.replace(/^[a-z][a-z0-9+.-]*:\\/\\//, "");',
    );
    expect(domainName).toContain(
      'normalized = normalized.split("/")[0] || "";',
    );
    expect(page).toContain(
      "A pasted address works too: `https://example.com/pricing` is read as `example.com`.",
    );
  });

  it("rounds the days to expiry up, and leaves the expiry filters undecided without a date", () => {
    const criteria: string = readRepoFile(DOMAIN_CRITERIA_FILE);

    expect(criteria).toContain(
      "const diffDays: number = Math.ceil(diffMs / (1000 * 60 * 60 * 24));",
    );
    expect(
      rowFor(
        tableRows(section(page, "## Monitoring Criteria")),
        CheckOn.DomainExpiresDaysIn,
      )![2],
    ).toContain("rounded up to a whole day");
    expect(criteria).toContain(
      "if (!domainResponse?.expiresDate) {\n        return null;",
    );
    expect(page).toContain(
      "Expiry criteria cannot decide without a date, so they stay quiet.",
    );
  });

  it("matches a name server or a status code when any one of them matches", () => {
    const criteria: string = readRepoFile(DOMAIN_CRITERIA_FILE);

    expect(criteria).toContain(
      "for (const nameServer of domainResponse.nameServers) {",
    );
    expect(criteria).toContain(
      "for (const status of domainResponse.domainStatus) {",
    );
    expect(page).toContain(
      "**Domain Name Server** and **Domain Status Code** match when _any_ one value matches",
    );
  });

  it("rides out a rate-limited WHOIS server only on the filter the form offers it for", () => {
    const overTime: Array<string> = offeredFilters(MonitorType.Domain)
      .filter((option: DropdownOption): boolean => {
        return CommonCriteriaFilterUtil.isEvaluateOverTimeFilter(
          option.value as CheckOn,
        );
      })
      .map((option: DropdownOption): string => {
        return option.label;
      });
    const bestPractices: string = section(page, "## Best Practices");

    expect(overTime).toEqual([CheckOn.IsOnline]);
    expect(bestPractices).toContain(
      `Include an **${CheckOn.IsOnline}** / **${FilterType.False}** filter in your offline criteria`,
    );
    expect(
      CommonCriteriaFilterUtil.getEvaluateOverTimeTypeByCriteriaFilter({
        checkOn: CheckOn.IsOnline,
        filterType: FilterType.False,
        value: undefined,
      }),
    ).toContain(EvaluateOverTimeType.AllValues);
    expect(bestPractices).toContain(
      `tick **Evaluate this criteria over a period of time** under that filter and pick **${EvaluateOverTimeType.AllValues}**`,
    );
  });

  it("puts Is Online in the offline criteria a new monitor gets", () => {
    const offline: MonitorCriteriaInstance = defaultCriteriaFor(
      MonitorType.Domain,
    )[0]!;

    expect(
      offline.data!.filters.some(
        (filter: {
          checkOn: CheckOn;
          filterType?: FilterType | undefined;
        }): boolean => {
          return (
            filter.checkOn === CheckOn.IsOnline &&
            filter.filterType === FilterType.False
          );
        },
      ),
    ).toBe(true);
    expect(section(page, "## Best Practices")).toContain(
      "New monitors have it in their default criteria",
    );
  });
});

describe("the labels the pages name exist where the pages say", () => {
  it("the probe reads the custom server's port and timeout from the step", () => {
    const monitor: string = readRepoFile(PROBE_MONITOR_FILE);

    expect(monitor).toContain("monitorConfigTimeoutInMs: dnsConfig.timeout,");
    expect(monitor).toContain(
      "monitorConfigTimeoutInMs: dnssecConfig.timeout,",
    );
    expect(monitor).toContain(
      "monitorConfigTimeoutInMs: domainConfig.timeout,",
    );
  });

  it("the folded sections are the forms' More fields", () => {
    expect(MORE_FIELDS_SECTION_TITLE).toBe("More fields");

    for (const file of [DNS_FORM_FILE, DNSSEC_FORM_FILE, DOMAIN_FORM_FILE]) {
      expect({
        file,
        folds: readRepoFile(file).includes("title={MORE_FIELDS_SECTION_TITLE}"),
      }).toEqual({
        file,
        folds: true,
      });
    }
  });
});
