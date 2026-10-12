import Probe, {
  ProbeConnectionStatus,
} from "Common/Models/DatabaseModels/Probe";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import {
  DEFAULT_IPFIX_COLLECTOR_PORT,
  DEFAULT_NETFLOW_COLLECTOR_PORT,
  DEFAULT_SFLOW_COLLECTOR_PORT,
} from "Common/Types/NetFlow/NetworkFlowCollectorPorts";
import {
  PACKET_CAPTURE_MAX_DURATION_IN_SECONDS,
  PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB,
  PACKET_CAPTURE_MIN_DURATION_IN_SECONDS,
  PACKET_CAPTURE_MIN_FILE_SIZE_IN_MB,
} from "Common/Types/PacketCapture/PacketCaptureLimits";
import Permission from "Common/Types/Permission";
import NumberUtil from "Common/Utils/Number";
import ProbeNetworkFailureUtil, {
  ProbeNetworkFailure,
  ProbeNetworkOperation,
} from "Common/Utils/ProbeNetworkFailureUtil";
import {
  DocsFence,
  DocsHeading,
  DocsLink,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import { tables } from "./DocsPageShape";
import { prose } from "./DocsTranslationChecks";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the English Custom Probes and Incoming Request Ingress pages say
 * about the product, held to the code that makes it true (docs task 18b).
 *
 * Markdown is not compiled, so nothing else notices when the probe reads a
 * new setting, a default or a range moves, a log line the pages quote is
 * reworded, the listener forwards somewhere else, or the dashboard renames a
 * field. Each test reads the source of truth - the probe's own sources (read
 * as text: the probe is its own package), the Probe model, the dashboard's
 * pages, the shared Common helpers - and checks the page still says what it
 * does. The translations are held to these English pages by
 * ProbeDocsTranslations.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");

const CUSTOM_PROBE: string = "probe/custom-probe";
const INGRESS: string = "probe/incoming-request-ingress";

const PROBE_CONFIG: string = "Probe/Config.ts";
const PROBE_INDEX: string = "Probe/Index.ts";
const PROBE_REGISTER: string = "Probe/Services/Register.ts";
const PROBE_ALIVE_JOB: string = "Probe/Jobs/Alive.ts";
const PROBE_DIAGNOSTICS: string = "Probe/Utils/ProbeApiDiagnostics.ts";
const PROBE_PROXY: string = "Probe/Utils/ProxyConfig.ts";
const PROBE_INGRESS: string = "Probe/API/IncomingRequestIngress.ts";
const PROBE_SYSLOG: string = "Probe/Services/SyslogReceiver.ts";
const PROBE_PACKET_CAPTURE: string =
  "Probe/Utils/PacketCapture/PacketCaptureSettings.ts";
const PROBE_PRIVATE_NETWORK: string =
  "Probe/Utils/PrivateNetworkMonitorPolicy.ts";
const PROBE_SYNTHETIC_LIMITS: string =
  "Probe/Utils/Monitors/SyntheticRuntime/Limits.ts";
const PROBE_REVERSE_DNS: string = "Probe/Utils/Discovery/ReverseDnsResolver.ts";
const PROBE_NETBIOS: string = "Probe/Utils/Discovery/NetbiosNameResolver.ts";
const PROBE_MONITOR_TYPES_DIR: string = "Probe/Utils/Monitors/MonitorTypes";
const PROBE_SSL_MONITOR: string = `${PROBE_MONITOR_TYPES_DIR}/SslMonitor.ts`;
const PROBE_SYNTHETIC_MONITOR: string = `${PROBE_MONITOR_TYPES_DIR}/SyntheticMonitor.ts`;
const PROBE_NETWORK_PATH_MONITOR: string = `${PROBE_MONITOR_TYPES_DIR}/NetworkPathMonitor.ts`;
const ENVIRONMENT_CONFIG: string = "Common/Server/EnvironmentConfig.ts";
const STATUS_API: string = "Common/Server/API/StatusAPI.ts";
const APP_BODY_PARSERS: string = "Common/Server/Utils/StartServer.ts";
const PROBE_SERVICE: string = "Common/Server/Services/ProbeService.ts";
const PROBE_AUTHORIZATION: string =
  "App/FeatureSet/Telemetry/Middleware/ProbeAuthorization.ts";
const CONNECTION_STATUS_JOB: string =
  "App/FeatureSet/Workers/Jobs/Probe/UpdateConnectionStatus.ts";
const INGRESS_NGINX: string = "Nginx/default.conf.template";
const PROBES_PAGE: string =
  "App/FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorProbes.tsx";
const PROBE_VIEW_PAGE: string =
  "App/FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorProbeView.tsx";
const PROBE_SETUP_CARD: string =
  "App/FeatureSet/Dashboard/src/Components/Probe/CustomProbeDocumentation.tsx";
const MONITORS_SIDE_MENU: string =
  "App/FeatureSet/Dashboard/src/Pages/Monitor/SideMenu.tsx";

// Where a constant a setting is bounded by may be declared.
const CONSTANT_SOURCES: Array<string> = [
  PROBE_CONFIG,
  PROBE_DIAGNOSTICS,
  PROBE_SYNTHETIC_LIMITS,
  PROBE_REVERSE_DNS,
  PROBE_NETBIOS,
  "Common/Types/NetFlow/NetworkFlowCollectorPorts.ts",
];

/*
 * Variables the probe reads that no page names, and why that is right.
 * Anything else the probe reads must be on the Custom Probes page, or on a
 * page its Environment variables section links to.
 */
const UNDOCUMENTED_VARIABLES: Record<string, string> = {
  HOSTNAME:
    "Docker and Kubernetes set it to the container's name; the probe only puts it in the report it sends when its own checks find it offline.",
};

// The environment-variable sections, each with one table of settings.
const SETTING_TABLES: Array<string> = [
  "### Checking monitors",
  "### Talking to OneUptime",
  "### Network discovery",
  "### Packet capture",
];

const HEADING_LINE: RegExp = /^(#{1,6})\s/;
const FENCE_LINE: RegExp = /^\s*```/;
const CODE_SPAN: RegExp = /`([^`\n]+)`/g;
const ENV_READ: RegExp = /process\.env\[\s*"([A-Za-z0-9_]+)"\s*\]/g;
const ENV_VAR_CONSTANT: RegExp = /_ENV_VAR: string =\s*"([A-Z0-9_]+)"/g;
// A name a page could mean as one of the probe's variables.
const VARIABLE_NAME: RegExp =
  /\b(PROBE_[A-Z0-9_]+|ONEUPTIME_URL|REGISTER_PROBE_KEY|PORT|HTTPS?_PROXY(?:_URL)?|NO_PROXY|https?_proxy|no_proxy)\b/g;
// A number as the probe writes one: "45000", "2_147_483_647" or "1.25".
const NUMBER_LITERAL: RegExp = /^\d[\d_]*(?:\.\d+)?$/;
const IDENTIFIER: RegExp = /^[A-Z][A-Z0-9_]*$/;

function readSource(relativePath: string): string {
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

function codeSpans(text: string): Array<string> {
  return Array.from(prose(text).matchAll(CODE_SPAN)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

// The body rows of the first table in a text, as trimmed cells.
function tableRows(text: string): Array<Array<string>> {
  const found: Array<Array<Array<string>>> = tables(text);

  expect(found.length).toBeGreaterThan(0);

  return (found[0] as Array<Array<string>>).slice(1);
}

// The row of a table whose first cell is this code span.
function rowFor(rows: Array<Array<string>>, firstCell: string): Array<string> {
  const row: Array<string> | undefined = rows.find(
    (candidate: Array<string>): boolean => {
      return candidate[0] === firstCell;
    },
  );

  expect({ row: firstCell, found: Boolean(row) }).toEqual({
    row: firstCell,
    found: true,
  });

  return row as Array<string>;
}

// The value of a numeric constant: "10", "1.25" or "10 * 60 * 1000".
function numericConstant(name: string): number {
  for (const file of CONSTANT_SOURCES) {
    const match: RegExpMatchArray | null = readSource(file).match(
      new RegExp(`(?:^|\\n)(?:export )?const ${name}: number =\\s*([^;]+);`),
    );

    if (match) {
      return evaluate(match[1] as string);
    }
  }

  throw new Error(`${name} is not a numeric constant of the probe`);
}

/*
 * A sum or difference of products of number literals and constants, as the
 * probe writes its limits: "10 * 60 * 1000", "A - B".
 */
function evaluate(expression: string): number {
  const terms: Array<string> = expression.split(/([+-])/);
  let total: number = product(terms[0] as string);

  for (let index: number = 1; index < terms.length; index += 2) {
    const value: number = product(terms[index + 1] as string);

    total = terms[index] === "+" ? total + value : total - value;
  }

  return total;
}

function product(term: string): number {
  return term
    .split("*")
    .map((factor: string): string => {
      return factor.trim();
    })
    .reduce((result: number, factor: string): number => {
      if (NUMBER_LITERAL.test(factor)) {
        return result * Number(factor.replace(/_/g, ""));
      }

      if (IDENTIFIER.test(factor)) {
        return result * numericConstant(factor);
      }

      throw new Error(`Cannot read "${factor}" as a number`);
    }, 1);
}

interface NumberSetting {
  // Null when the default is computed from other settings.
  defaultValue: number | null;
  min: number | undefined;
  max: number | undefined;
}

/*
 * A numeric setting as Probe/Config.ts reads it: the
 * NumberUtil.parseNumberWithDefault call whose value is this variable.
 */
function numberSetting(name: string): NumberSetting {
  const config: string = readSource(PROBE_CONFIG);
  const read: number = config.indexOf(`value: process.env["${name}"]`);

  expect({ name, read: read >= 0 }).toEqual({ name, read: true });

  const start: number = config.lastIndexOf("parseNumberWithDefault({", read);
  const end: number = config.indexOf("})", read);
  const call: string = config.slice(start, end);

  const field: (key: string) => string | undefined = (
    key: string,
  ): string | undefined => {
    const match: RegExpMatchArray | null = call.match(
      new RegExp(`\\n\\s*${key}: ([^\\n]+),\\n`),
    );

    return match ? (match[1] as string).trim() : undefined;
  };

  const defaultExpression: string | undefined = field("defaultValue");
  const min: string | undefined = field("min");
  const max: string | undefined = field("max");

  return {
    defaultValue:
      defaultExpression === undefined || defaultExpression.startsWith("Math.")
        ? null
        : evaluate(defaultExpression),
    min: min === undefined ? undefined : evaluate(min),
    max: max === undefined ? undefined : evaluate(max),
  };
}

function numberDefault(name: string): number {
  const value: number | null = numberSetting(name).defaultValue;

  expect({ name, value }).not.toEqual({ name, value: null });

  return value as number;
}

/*
 * How the probe reads an on/off setting: "true" only turns on one that is
 * off unless set, and "false" only turns off one that is on unless set.
 */
function switchDefault(name: string): "off" | "on" {
  const config: string = readSource(PROBE_CONFIG);
  const offUnlessTrue: boolean = config.includes(
    `process.env["${name}"] === "true"`,
  );
  const onUnlessFalse: boolean = config.includes(
    `process.env["${name}"] !== "false"`,
  );

  expect({ name, read: offUnlessTrue !== onUnlessFalse }).toEqual({
    name,
    read: true,
  });

  return offUnlessTrue ? "off" : "on";
}

function sorted(values: Iterable<string>): Array<string> {
  return Array.from(new Set(values)).sort();
}

// Every variable the probe reads, by name.
function variablesTheProbeReads(): Array<string> {
  const names: Array<string> = [];

  for (const match of Array.from(readSource(PROBE_CONFIG).matchAll(ENV_READ))) {
    names.push(match[1] as string);
  }

  for (const match of Array.from(
    readSource(PROBE_PACKET_CAPTURE).matchAll(ENV_VAR_CONSTANT),
  )) {
    names.push(match[1] as string);
  }

  // Read for the probe by Common (HasRegisterProbeKey).
  if (
    readSource(ENVIRONMENT_CONFIG).includes('process.env["REGISTER_PROBE_KEY"]')
  ) {
    names.push("REGISTER_PROBE_KEY");
  }

  return sorted(names);
}

// The variables a text names: in code spans and in its code blocks.
function variablesNamedIn(markdown: string): Array<string> {
  return sorted(
    Array.from(markdown.matchAll(VARIABLE_NAME)).map(
      (match: RegExpMatchArray): string => {
        return match[1] as string;
      },
    ),
  );
}

// The docs pages a text links to, as "category/page".
function linkedPages(markdown: string): Array<string> {
  return sorted(
    scanMarkdown(markdown)
      .links.map((link: DocsLink): string => {
        return link.target;
      })
      .filter((target: string): boolean => {
        return target.startsWith("/docs/");
      })
      .map((target: string): string => {
        return target.replace(/^\/docs\//, "").split("#")[0] as string;
      }),
  );
}

describe("the Custom Probes page: every setting the probe reads", () => {
  const page: string = englishPage(CUSTOM_PROBE);
  const settings: string = section(page, "## Environment variables");

  it("names every variable the probe reads, here or on a page its settings link to", () => {
    const named: Set<string> = new Set(variablesNamedIn(page));

    for (const linked of linkedPages(settings)) {
      for (const name of variablesNamedIn(englishPage(linked))) {
        named.add(name);
      }
    }

    const missing: Array<string> = variablesTheProbeReads().filter(
      (name: string): boolean => {
        return !named.has(name) && !(name in UNDOCUMENTED_VARIABLES);
      },
    );

    expect(missing).toEqual([]);
  });

  it("leaves a variable unnamed only while the probe still reads it", () => {
    const read: Array<string> = variablesTheProbeReads();

    for (const name of Object.keys(UNDOCUMENTED_VARIABLES)) {
      expect({ name, read: read.includes(name) }).toEqual({
        name,
        read: true,
      });
    }
  });

  it("names no variable the probe does not read", () => {
    const read: Array<string> = variablesTheProbeReads();
    const invented: Array<string> = [
      ...variablesNamedIn(page),
      ...variablesNamedIn(englishPage(INGRESS)),
    ].filter((name: string): boolean => {
      return !read.includes(name);
    });

    expect(sorted(invented)).toEqual([]);
  });

  it.each(SETTING_TABLES)(
    "gives each default under %s as the probe's own",
    (heading: string) => {
      for (const row of tableRows(section(page, heading))) {
        const names: Array<string> = codeSpans(row[0] as string);
        const defaultCell: string = row[1] as string;

        if (names.length !== 1) {
          // The proxy row: three variables with no default between them.
          expect(defaultCell).toBe("none");
          continue;
        }

        const name: string = names[0] as string;

        if (name === "PROBE_ALLOW_PRIVATE_NETWORK_MONITORS") {
          // Resolved by its own policy: unset, empty or "false" is refused.
          expect(defaultCell).toBe("`false`");
          expect(readSource(PROBE_PRIVATE_NETWORK)).toMatch(
            /configuredValue === "false"\s*\)\s*\{\s*return \{\s*\.\.\.base,\s*allowed: false,/,
          );
          continue;
        }

        if (name === "PROBE_PACKET_CAPTURE_ENABLED") {
          // Read in PacketCaptureSettings: on only when it says exactly "true".
          expect(defaultCell).toBe("off");
          expect(readSource(PROBE_PACKET_CAPTURE)).toContain(`=== "true"`);
          continue;
        }

        if (name === "PROBE_PACKET_CAPTURE_MAX_DURATION_IN_SECONDS") {
          expect(defaultCell).toBe(
            `\`${PACKET_CAPTURE_MAX_DURATION_IN_SECONDS}\``,
          );
          continue;
        }

        if (name === "PROBE_PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB") {
          expect(defaultCell).toBe(`\`${PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB}\``);
          continue;
        }

        if (
          readSource(PROBE_CONFIG).includes(`process.env["${name}"] === "true"`)
        ) {
          expect({ name, defaultCell }).toEqual({
            name,
            defaultCell: "`false`",
          });
          continue;
        }

        if (name === "PROBE_MONITOR_CHECK_TIMEOUT_IN_MS") {
          // Computed: tested with the synthetic script timeout below.
          continue;
        }

        expect({ name, defaultCell: codeSpans(defaultCell)[0] }).toEqual({
          name,
          defaultCell: String(numberDefault(name)),
        });
      }
    },
  );

  it("says the check deadline is 15 minutes, and grows with the synthetic script timeout", () => {
    const config: string = readSource(PROBE_CONFIG);
    const baseline: number = evaluate(
      (config.match(
        /const MONITOR_CHECK_TIMEOUT_BASELINE_IN_MS: number = ([^;]+);/,
      )?.[1] as string) || "0",
    );
    const scriptTimeout: number = numberDefault(
      "PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS",
    );
    const apiTimeout: number = numberDefault("PROBE_API_REQUEST_TIMEOUT_IN_MS");
    const startup: number = numericConstant(
      "SYNTHETIC_MONITOR_WORKER_STARTUP_ALLOWANCE_IN_MS",
    );
    const row: Array<string> = rowFor(
      tableRows(section(page, "### Checking monitors")),
      "`PROBE_MONITOR_CHECK_TIMEOUT_IN_MS`",
    );

    // The default is the larger of the baseline and what a script needs.
    expect(config).toMatch(
      /Math\.max\(\s*MONITOR_CHECK_TIMEOUT_BASELINE_IN_MS,\s*PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS \+\s*SYNTHETIC_MONITOR_WORKER_STARTUP_ALLOWANCE_IN_MS \+\s*PROBE_API_REQUEST_TIMEOUT_IN_MS,?\s*\)/,
    );
    expect(Math.max(baseline, scriptTimeout + startup + apiTimeout)).toBe(
      baseline,
    );
    expect(row[1]).toBe(`\`${baseline}\``);
    expect(row[2]).toContain(
      "The default grows when the synthetic script timeout is raised",
    );
  });

  it("gives the ranges the probe holds its settings to", () => {
    const progress: NumberSetting = numberSetting(
      "PROBE_DISCOVERY_PROGRESS_INTERVAL_IN_MS",
    );
    const scans: NumberSetting = numberSetting(
      "PROBE_DISCOVERY_MAX_CONCURRENT_SCANS",
    );
    const reverseDns: NumberSetting = numberSetting(
      "PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS",
    );
    const netbios: NumberSetting = numberSetting(
      "PROBE_DISCOVERY_NETBIOS_MAX_HOSTS",
    );
    const discovery: string = section(page, "### Network discovery");

    expect(discovery).toContain(`Minimum \`${progress.min}\`.`);
    expect(discovery).toContain(`from ${scans.min} to ${scans.max}.`);
    expect(discovery).toContain(
      `You can set it from ${reverseDns.min} to ${reverseDns.max}.`,
    );
    expect(discovery).toContain(
      `you can set it from ${netbios.min} to ${netbios.max}.`,
    );

    // 0, below each minimum, falls back to the automatic default.
    expect(reverseDns.defaultValue).toBe(0);
    expect(netbios.defaultValue).toBe(0);
    expect(discovery).toContain(
      "`PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS`: leave it unset (or `0`)",
    );
    expect(discovery).toContain(
      "Leave it unset (or `0`) to keep the built-in cap",
    );
  });

  it("gives the packet capture limits' ranges", () => {
    const capture: string = section(page, "### Packet capture");

    expect(capture).toContain(
      `The longest packet capture this probe runs, from ${PACKET_CAPTURE_MIN_DURATION_IN_SECONDS} to ${PACKET_CAPTURE_MAX_DURATION_IN_SECONDS}.`,
    );
    expect(capture).toContain(
      `The largest packet capture file this probe makes, from ${PACKET_CAPTURE_MIN_FILE_SIZE_IN_MB} to ${PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB}.`,
    );
  });

  it("says an unreadable or out-of-range number falls back to the default, and the capture limits are clamped", () => {
    const read: (value: string) => number = (value: string): number => {
      return NumberUtil.parseNumberWithDefault({
        value: value,
        defaultValue: 4,
        min: 1,
        max: 16,
      });
    };
    const capture: string = readSource(PROBE_PACKET_CAPTURE);

    expect(settings).toContain(
      "A number the probe cannot read, or one outside the range a variable allows, is ignored and the default is used; the packet capture limits are kept within their range instead.",
    );
    expect(read("not-a-number")).toBe(4);
    expect(read("0")).toBe(4);
    expect(read("17")).toBe(4);
    expect(read("9")).toBe(9);
    expect(capture).toContain("is below the minimum, so ${data.min} is used.");
    expect(capture).toContain(
      "is above the maximum every probe holds to, so ${data.max} is used.",
    );
  });

  it("says the probe reads its settings when it starts", () => {
    expect(settings).toContain(
      "The probe reads its settings from its environment when it starts: change one, then restart the probe.",
    );
    // Module-level constants: read once, when the process loads them.
    expect(readSource(PROBE_CONFIG)).toMatch(
      /export const PROBE_MONITORING_WORKERS: number =\s*NumberUtil\.parseNumberWithDefault\(/,
    );
  });

  it("says the Chromium sandbox is off unless asked for, with a warning at startup", () => {
    const row: Array<string> = rowFor(
      tableRows(section(page, "### Checking monitors")),
      "`PROBE_SYNTHETIC_MONITOR_CHROMIUM_SANDBOX_ENABLED`",
    );

    expect(
      switchDefault("PROBE_SYNTHETIC_MONITOR_CHROMIUM_SANDBOX_ENABLED"),
    ).toBe("off");
    expect(row[2]).toContain(
      "While it is off, the probe logs a warning at startup.",
    );
    expect(readSource(PROBE_INDEX)).toMatch(
      /if \(!PROBE_SYNTHETIC_MONITOR_CHROMIUM_SANDBOX_ENABLED\) \{\s*logger\.warn\(/,
    );
  });

  it("says what the syslog receiver forwards a minute, and that it logs what it drops", () => {
    const listeners: string = section(page, "### What the probe listens on");

    expect(listeners).toContain(
      `The syslog receiver forwards at most \`PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE\` messages a minute, \`${numberDefault("PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE")}\` by default, drops the rest, and logs how many it dropped.`,
    );
    expect(readSource(PROBE_SYSLOG)).toContain(
      "Syslog receiver dropped ${SyslogReceiver.droppedThisMinute} messages in the last minute",
    );
  });

  it("lists what the probe listens on, with each listener's default", () => {
    const rows: Array<Array<string>> = tableRows(
      section(page, "### What the probe listens on"),
    );
    const settingOf: (row: Array<string>) => string = (
      row: Array<string>,
    ): string => {
      return codeSpans(row[1] as string)[0] as string;
    };
    const byVariable: Record<string, Array<string>> = {};

    for (const row of rows) {
      byVariable[settingOf(row)] = row;
    }

    expect(Object.keys(byVariable).sort()).toEqual(
      [
        "PORT",
        "PROBE_INGRESS_PORT",
        "PROBE_NETFLOW_RECEIVER_ENABLED",
        "PROBE_SNMP_TRAP_RECEIVER_ENABLED",
        "PROBE_SYSLOG_RECEIVER_ENABLED",
      ].sort(),
    );

    // Off unless a port is set.
    expect(readSource(PROBE_CONFIG)).toContain(
      'export const PROBE_INGRESS_PORT: Port | null = process.env["PROBE_INGRESS_PORT"]',
    );
    expect(byVariable["PROBE_INGRESS_PORT"]?.[2]).toBe("Off");

    expect(switchDefault("PROBE_SNMP_TRAP_RECEIVER_ENABLED")).toBe("on");
    expect(byVariable["PROBE_SNMP_TRAP_RECEIVER_ENABLED"]?.[2]).toBe(
      `On, UDP ${numberDefault("PROBE_SNMP_TRAP_RECEIVER_PORT")}`,
    );

    expect(switchDefault("PROBE_SYSLOG_RECEIVER_ENABLED")).toBe("off");
    expect(byVariable["PROBE_SYSLOG_RECEIVER_ENABLED"]?.[2]).toBe(
      `Off, UDP ${numberDefault("PROBE_SYSLOG_RECEIVER_PORT")}`,
    );

    expect(switchDefault("PROBE_NETFLOW_RECEIVER_ENABLED")).toBe("on");
    expect(numberDefault("PROBE_NETFLOW_RECEIVER_PORT")).toBe(
      DEFAULT_NETFLOW_COLLECTOR_PORT,
    );
    expect(numberDefault("PROBE_IPFIX_RECEIVER_PORT")).toBe(
      DEFAULT_IPFIX_COLLECTOR_PORT,
    );
    expect(numberDefault("PROBE_SFLOW_RECEIVER_PORT")).toBe(
      DEFAULT_SFLOW_COLLECTOR_PORT,
    );
    expect(byVariable["PROBE_NETFLOW_RECEIVER_ENABLED"]?.[2]).toBe(
      `On, UDP ${DEFAULT_NETFLOW_COLLECTOR_PORT}, ${DEFAULT_IPFIX_COLLECTOR_PORT} and ${DEFAULT_SFLOW_COLLECTOR_PORT}`,
    );

    expect(byVariable["PORT"]?.[2]).toBe(`On, TCP ${numberDefault("PORT")}`);
    expect(byVariable["PORT"]?.[3]).toBe("`/status/live` and `/status/ready`");
    expect(readSource(STATUS_API)).toContain('router.get("/status/live"');
    expect(readSource(STATUS_API)).toContain('router.get("/status/ready"');
  });

  it("names the variables only a self-registering probe reads", () => {
    const listeners: string = section(page, "### What the probe listens on");
    const register: string = readSource(PROBE_REGISTER);

    expect(listeners).toContain(
      "`PROBE_NAME` and `PROBE_DESCRIPTION` are read only by probes that register themselves with `REGISTER_PROBE_KEY`",
    );
    expect(register).toMatch(/if \(HasRegisterProbeKey\) \{/);
    expect(register).toContain("probeName: PROBE_NAME");
    expect(register).toContain("probeDescription: PROBE_DESCRIPTION");
  });
});

describe("the Custom Probes page: how OneUptime knows a probe is running", () => {
  const page: string = englishPage(CUSTOM_PROBE);
  const howItWorks: string = section(page, "## How it works");

  it("says the probe sends a sign of life every minute, and any request counts", () => {
    expect(howItWorks).toContain(
      "Every request from the probe counts as a sign of life, and the probe sends one at least every minute.",
    );
    expect(readSource(PROBE_ALIVE_JOB)).toMatch(/schedule: EVERY_MINUTE/);
    // Every authenticated probe request stamps lastAlive.
    expect(readSource(PROBE_AUTHORIZATION)).toContain(
      "ProbeService.updateLastAlive(probeId)",
    );
  });

  it("says a probe is Disconnected after about three minutes, and who is told", () => {
    const job: string = readSource(CONNECTION_STATUS_JOB);
    const service: string = readSource(PROBE_SERVICE);
    const minutes: number = Number(
      job.match(/const STALE_CUTOFF_IN_MINUTES: number = (\d+);/)?.[1],
    );

    expect(minutes).toBe(3);
    expect(howItWorks).toContain(
      "After about three minutes without one, the probe shows **Disconnected**, and its owners are told. A probe with no owners tells the project's owners.",
    );
    expect(service).toMatch(
      /let owners: Array<User> = await this\.getOwners\(probe\.id!\);[\s\S]{0,200}if \(owners\.length === 0\) \{[\s\S]{0,200}owners = await ProjectService\.getOwners\(probe\.projectId!\);/,
    );
  });

  it("names the two statuses a probe has", () => {
    const statuses: Array<string> = Object.values(ProbeConnectionStatus).map(
      (status: string): string => {
        return status.charAt(0).toUpperCase() + status.slice(1);
      },
    );

    expect(statuses.sort()).toEqual(["Connected", "Disconnected"]);

    for (const status of statuses) {
      expect(page).toContain(`**${status}**`);
    }
  });
});

describe("the Custom Probes page: creating and installing a probe", () => {
  const page: string = englishPage(CUSTOM_PROBE);
  const install: string = section(page, "## Install a probe");
  const probe: Probe = new Probe();

  it("says creating a probe takes the Growth plan, and who may", () => {
    expect(probe.createBillingPlan).toBe(PlanType.Growth);
    expect(page).toContain("- **The Growth plan, on OneUptime Cloud.**");

    for (const permission of [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectProbe,
    ]) {
      expect(probe.createRecordPermissions).toContain(permission);
    }

    expect(page).toContain(
      "Project owners, admins and members have it, and so does anyone whose role lets them create probes.",
    );
  });

  it("finds the probes where the Monitors menu has them", () => {
    const menu: string = readSource(MONITORS_SIDE_MENU);
    const settings: number = menu.indexOf('title: "Settings"');
    const probes: number = menu.indexOf(
      "RouteMap[PageMap.MONITORS_SETTINGS_PROBES]",
    );
    const nextSection: number = menu.indexOf("\n    {\n      title:", settings);

    expect(settings).toBeGreaterThan(-1);
    expect(probes).toBeGreaterThan(settings);
    expect(nextSection === -1 || probes < nextSection).toBe(true);
    expect(menu.slice(settings, probes)).toMatch(
      /title: "Probes",\s*to: RouteUtil\.populateRouteParams\(\s*$/,
    );
    expect(install).toContain(
      "Open **Monitors → Settings → Probes** and click **Create Probe**.",
    );
  });

  it("names the create form's fields as the form does, the required ones and the folded ones", () => {
    const source: string = readSource(PROBES_PAGE);
    const card: number = source.indexOf('title: "Custom Probes",');
    // The custom probes table's create form: from its card to its buttons.
    const form: string = source.slice(
      card,
      source.indexOf("actionButtons={[", card),
    );
    const field: (title: string) => string = (title: string): string => {
      const at: number = form.indexOf(`title: "${title}",`);

      expect({ title, found: at >= 0 }).toEqual({ title, found: true });

      return form.slice(at, form.indexOf("},", at));
    };

    expect(field("Name")).toContain("required: true");
    expect(field("Description")).toContain("required: true");
    expect(field("Probe Logo")).toContain(
      "collapsibleSection: advancedSection",
    );
    expect(field("Enable monitoring automatically on new monitors")).toContain(
      "collapsibleSection: advancedSection",
    );
    expect(form).toMatch(
      /getLabelsFormField<Probe>\(\{\s*collapsibleSection: advancedSection,\s*\}\)/,
    );
    expect(form).toContain('title: "Custom Probes",');
    expect(install).toContain(
      "Give it a **Name** and a **Description**: both are required. **More fields** holds the **Probe Logo**, **Enable monitoring automatically on new monitors**, which picks this probe for every new monitor you create, and **Labels**.",
    );
  });

  it("says who sees a probe's key, and where it is copied from", () => {
    const form: string = readSource(PROBES_PAGE);

    expect(probe.getColumnAccessControlFor("key")?.read).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
    ]);
    expect(form).toContain(
      'PermissionGate.canReadColumn(\n    new Probe(),\n    "key",\n  )',
    );
    expect(form).toContain(
      'title: canReadProbeKey ? "Show ID and Key" : "Show ID",',
    );
    expect(install).toContain(
      "its key is shown only to project owners and admins, who see **Show ID and Key** where the others see **Show ID**.",
    );
  });

  it("says the probe's page shows the setup card only to who may read the key", () => {
    const view: string = readSource(PROBE_VIEW_PAGE);
    const card: string = readSource(PROBE_SETUP_CARD);

    expect(view).toMatch(
      /\{probeKey && \(\s*<CustomProbeDocumentation probeKey=\{probeKey\} probeId=\{modelId\} \/>/,
    );
    expect(card).toContain("title={`Set up your Custom Probe`}");
    expect(view).toContain('title={"Reset Probe Key"}');
    expect(install).toContain(
      "Project owners and admins can also click the probe: the **Set up your Custom Probe** card on its page shows the Docker command with its ID and key already filled in.",
    );
    expect(page).toContain("**Reset Probe Key**, on the probe's page");
  });

  it("runs the probe with the command the setup card gives", () => {
    const card: string = readSource(PROBE_SETUP_CARD);
    const cardCommand: string = (
      card.match(/\n(docker run --name oneuptime-probe [^\n]+)\n/)?.[1] || ""
    )
      .replace("${props.probeKey.toString()}", "<probe-key>")
      .replace("${props.probeId.toString()}", "<probe-id>")
      .replace("${host.toString()}", "https://oneuptime.com");
    const docker: string =
      scanMarkdown(install).fences.find((fence: DocsFence): boolean => {
        return fence.lang === "bash";
      })?.code || "";
    const pageCommand: string = docker
      .split("\n")
      .map((line: string): string => {
        return line.replace(/\\$/, "").trim();
      })
      .join(" ")
      .trim();

    expect(cardCommand).not.toBe("");
    expect(pageCommand).toBe(cardCommand);
  });

  it("links to the IPv6 heading the setup card links to", () => {
    const card: string = readSource(PROBE_SETUP_CARD);
    const anchor: string =
      card.match(/\/probe\/custom-probe#([a-z0-9-]+)/)?.[1] || "";

    expect(anchor).not.toBe("");
    expect(
      scanMarkdown(page).headings.map((heading: DocsHeading): string => {
        return heading.slug;
      }),
    ).toContain(anchor);
  });
});

describe("the Custom Probes page: proxies", () => {
  const page: string = englishPage(CUSTOM_PROBE);
  const proxy: string = section(page, "## Connecting through a proxy");

  it("reads the lowercase names and the plain ones, behind the _URL ones", () => {
    const config: string = readSource(PROBE_CONFIG);

    expect(config).toMatch(
      /HTTP_PROXY_URL: string \| null =\s*process\.env\["HTTP_PROXY_URL"\] \|\|\s*process\.env\["http_proxy"\] \|\|\s*process\.env\["HTTP_PROXY"\]/,
    );
    expect(config).toMatch(
      /HTTPS_PROXY_URL: string \| null =\s*process\.env\["HTTPS_PROXY_URL"\] \|\|\s*process\.env\["https_proxy"\] \|\|\s*process\.env\["HTTPS_PROXY"\]/,
    );
    expect(config).toMatch(
      /process\.env\["NO_PROXY"\] \|\| process\.env\["no_proxy"\]/,
    );
    expect(proxy).toContain(
      "The lowercase names `http_proxy`, `https_proxy` and `no_proxy`, and `HTTP_PROXY` and `HTTPS_PROXY`, work too.",
    );
  });

  it("says SSL Certificate and Synthetic monitors prefer the HTTPS proxy", () => {
    for (const file of [PROBE_SSL_MONITOR, PROBE_SYNTHETIC_MONITOR]) {
      expect(readSource(file)).toContain(
        "const proxyUrl: string | null = httpsProxyUrl || httpProxyUrl;",
      );
    }

    expect(proxy).toContain(
      "SSL Certificate and Synthetic monitors use `HTTPS_PROXY_URL`, or `HTTP_PROXY_URL` when only that one is set.",
    );
  });

  /*
   * Which monitor types reach the proxy settings through their own imports.
   * OnlineCheck (the probe asking whether it is online at all after a
   * failure), Register and the probe's requests to OneUptime are left out:
   * they are not the monitor's check.
   */
  it("lists exactly the monitor types whose checks go through the proxy", () => {
    const notTheCheck: Array<string> = [
      "Probe/Utils/OnlineCheck.ts",
      "Probe/Services/Register.ts",
      "Probe/Utils/ProbeAPIRequest.ts",
      "Probe/Utils/ProbeApiDiagnostics.ts",
    ];
    const titles: Record<string, string> = {
      "WebsiteMonitor.ts": "Website",
      "ApiMonitor.ts": "API",
      "ExternalStatusPageMonitor.ts": "External Status Page",
      "CustomCodeMonitor.ts": "Custom Code",
      "SslMonitor.ts": "SSL Certificate",
      "SyntheticMonitor.ts": "Synthetic",
      "DomainMonitor.ts": "Domain",
    };
    const importsOf: (file: string) => Array<string> = (
      file: string,
    ): Array<string> => {
      const source: string = readSource(file);

      return Array.from(source.matchAll(/from\s+"(\.{1,2}\/[^"]+)"/g))
        .map((match: RegExpMatchArray): string => {
          const resolved: string = path.posix.normalize(
            path.posix.join(path.posix.dirname(file), match[1] as string),
          );

          return `${resolved}.ts`;
        })
        .filter((candidate: string): boolean => {
          return fs.existsSync(path.join(PACKAGES_DIR, candidate));
        });
    };
    const reachesProxy: (file: string) => boolean = (file: string): boolean => {
      const seen: Set<string> = new Set();
      const queue: Array<string> = [file];

      while (queue.length > 0) {
        const current: string = queue.shift() as string;

        if (seen.has(current) || notTheCheck.includes(current)) {
          continue;
        }

        seen.add(current);

        if (current === PROBE_PROXY) {
          return true;
        }

        queue.push(...importsOf(current));
      }

      return false;
    };

    const proxied: Array<string> = fs
      .readdirSync(path.join(PACKAGES_DIR, PROBE_MONITOR_TYPES_DIR))
      .filter((name: string): boolean => {
        return name.endsWith(".ts");
      })
      .filter((name: string): boolean => {
        return reachesProxy(`${PROBE_MONITOR_TYPES_DIR}/${name}`);
      });

    expect(proxied.sort()).toEqual(Object.keys(titles).sort());
    expect(proxy).toContain(
      "- **The HTTP checks of monitors**: Website, API, External Status Page, Custom Code, SSL Certificate, Synthetic and Domain monitors.",
    );
  });

  it("describes NO_PROXY entries as the probe matches them", () => {
    const matcher: string = readSource(PROBE_PROXY);

    expect(matcher).toContain('if (trimmedPattern === "*") {');
    expect(matcher).toContain('if (pattern.startsWith("*.")) {');
    expect(matcher).toContain('} else if (pattern.startsWith(".")) {');
    expect(matcher).toContain('normalizedPatternPort !== (port ?? "")');
    // Names, never ranges: a host matches by name or by suffix only.
    expect(matcher).toContain("return hostname === normalizedPatternHost;");
    expect(matcher).not.toContain("CidrMatch");
    expect(proxy).toContain(
      "A `NO_PROXY` entry is a host name (`api.internal`), a domain with a leading dot or `*.` for every name under it (`.internal.example.com`), either of them with a `:port`, or `*` for everything. IP ranges are not read: list each address.",
    );
  });
});

describe("the Custom Probes page: IPv6", () => {
  const page: string = englishPage(CUSTOM_PROBE);
  const ipv6: string = section(page, "## Monitoring IPv6 destinations");

  it.each([
    "Network is unreachable",
    "Cannot assign requested address",
    "Address family not supported by protocol",
  ])(
    "reads %s as the probe's own failure, with nothing sent",
    (error: string) => {
      const failure: ProbeNetworkFailure | null =
        ProbeNetworkFailureUtil.classifyOutput({
          output: `ping6: connect: ${error}`,
          operation: ProbeNetworkOperation.PingOrTraceroute,
        });

      expect(failure?.isCertain).toBe(true);
      expect(ipv6).toContain(`| \`${error}\` |`);
    },
  );

  it("quotes the failure reason a Ping monitor gives", () => {
    const reason: string | null = ProbeNetworkFailureUtil.describeOutput({
      host: "2001:db8::1",
      output: "ping6: connect: Cannot assign requested address",
      operation: ProbeNetworkOperation.PingOrTraceroute,
    });
    const quoted: string =
      scanMarkdown(ipv6).fences.find((fence: DocsFence): boolean => {
        return fence.lang === "text";
      })?.code || "";

    expect(reason).not.toBeNull();
    expect(quoted.trim()).toBe(reason);
  });

  it("quotes the network path's line", () => {
    const clause: string = ProbeNetworkFailureUtil.describeClause({
      host: "2001:db8::1",
      failure: ProbeNetworkFailureUtil.classifyOutput({
        output: "traceroute6: connect: Cannot assign requested address",
        operation: ProbeNetworkOperation.PingOrTraceroute,
      }) as ProbeNetworkFailure,
    });

    expect(clause.startsWith("this probe cannot send IPv6 traffic (")).toBe(
      true,
    );
    expect(readSource(PROBE_NETWORK_PATH_MONITOR)).toContain(
      "return `Traceroute could not run: ${ProbeNetworkFailureUtil.describeClause(",
    );
    expect(ipv6).toContain(
      "`Traceroute could not run: this probe cannot send IPv6 traffic (...)`",
    );
  });
});

describe("the Custom Probes page: NetBIOS and reverse DNS in discovery scans", () => {
  const page: string = englishPage(CUSTOM_PROBE);
  const netbios: string = section(
    page,
    "## NetBIOS name lookups in discovery scans",
  );
  const discovery: string = section(page, "### Network discovery");

  // getNetbiosTotalBudgetInMs, from the resolver's own constants.
  const netbiosBudgetInSeconds: (hosts: number) => number = (
    hosts: number,
  ): number => {
    const source: string = readSource(PROBE_NETBIOS);
    const headroom: number = Number(
      source.match(/const NETBIOS_BUDGET_HEADROOM: number = ([\d.]+);/)?.[1],
    );
    const passes: number = 1 + numericConstant("DEFAULT_NETBIOS_RETRY_PASSES");
    const onePass: number =
      (hosts - 1) * numericConstant("DEFAULT_NETBIOS_SEND_INTERVAL_IN_MS") +
      numericConstant("DEFAULT_NETBIOS_PER_HOST_TIMEOUT_IN_MS");
    const budget: number = Math.min(
      Math.max(
        Math.ceil(passes * onePass * headroom),
        numericConstant("DEFAULT_NETBIOS_TOTAL_BUDGET_IN_MS"),
      ),
      numericConstant("MAX_AUTOMATIC_NETBIOS_TOTAL_BUDGET_IN_MS"),
    );

    return Math.round(budget / 1000);
  };

  it("gives the lookup's caps, pace and time limits", () => {
    const cap: number = numericConstant("DEFAULT_NETBIOS_MAX_HOSTS");
    const maxCap: number = numericConstant("MAX_NETBIOS_MAX_HOSTS_OVERRIDE");
    const perSecond: number =
      1000 / numericConstant("DEFAULT_NETBIOS_SEND_INTERVAL_IN_MS");
    const ceilingInMinutes: number =
      numericConstant("MAX_AUTOMATIC_NETBIOS_TOTAL_BUDGET_IN_MS") / 60000;

    expect(numericConstant("DEFAULT_NETBIOS_RETRY_PASSES")).toBe(1);
    expect(ceilingInMinutes).toBe(2);
    expect(netbios).toContain(
      `It queries at most ${cap.toLocaleString("en-US")} hosts per scan (\`PROBE_DISCOVERY_NETBIOS_MAX_HOSTS\` raises that to ${maxCap.toLocaleString("en-US")}), sends each unanswered host one more query, paces queries at about ${perSecond} per second, and stops at a time limit sized to that work - about ${netbiosBudgetInSeconds(cap)} seconds for a full ${cap.toLocaleString("en-US")}-host lookup, and never more than two minutes.`,
    );
    expect(discovery).toContain(
      `about ${netbiosBudgetInSeconds(maxCap)} seconds at ${maxCap.toLocaleString("en-US")} hosts`,
    );
    expect(discovery).toContain(
      `Leave it unset (or \`0\`) to keep the built-in cap of ${cap.toLocaleString("en-US")}; you can set it from 1 to ${maxCap}.`,
    );
  });

  it("lists the address ranges it queries, and the port", () => {
    const source: string = readSource(PROBE_NETBIOS);
    const ranges: Array<string> = Array.from(
      (
        source.match(
          /NETBIOS_QUERY_ALLOWED_RANGES: ReadonlyArray<string> = \[([^\]]+)\]/,
        )?.[1] || ""
      ).matchAll(/"([^"]+)"/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(ranges.length).toBe(4);

    for (const range of ranges) {
      expect(netbios).toContain(`\`${range}\``);
    }

    expect(numericConstant("NETBIOS_NAME_SERVICE_PORT")).toBe(137);
    expect(netbios).toContain("to UDP port 137 on those hosts");
  });

  it("sizes the reverse DNS time limit as the resolver does", () => {
    const concurrency: number = numericConstant(
      "DEFAULT_REVERSE_DNS_CONCURRENCY",
    );
    const timeout: number = numericConstant(
      "DEFAULT_REVERSE_DNS_TIMEOUT_IN_MS",
    );
    const headroom: number = Number(
      readSource(PROBE_REVERSE_DNS).match(
        /const REVERSE_DNS_BUDGET_HEADROOM: number = ([\d.]+);/,
      )?.[1],
    );
    const floor: number = numericConstant(
      "DEFAULT_REVERSE_DNS_TOTAL_BUDGET_IN_MS",
    );
    const ceiling: number = numericConstant(
      "MAX_AUTOMATIC_REVERSE_DNS_TOTAL_BUDGET_IN_MS",
    );
    // The most hosts the floor covers: waves of `concurrency` lookups.
    const wavesInFloor: number = Math.floor(floor / (timeout * headroom));
    const hostsInFloor: number = wavesInFloor * concurrency;

    expect(Math.abs(hostsInFloor - 860)).toBeLessThan(10);
    expect(floor / 1000).toBe(60);
    expect(ceiling / 60000).toBe(10);
    expect(discovery).toContain(
      "60 seconds for up to about 860 hosts, growing to at most 10 minutes",
    );
  });
});

describe("the Custom Probes page: troubleshooting", () => {
  const page: string = englishPage(CUSTOM_PROBE);
  const troubleshooting: string = section(page, "## Troubleshooting");

  it("quotes the lines the probe logs when it cannot start", () => {
    const config: string = readSource(PROBE_CONFIG);
    const register: string = readSource(PROBE_REGISTER);

    expect(config).toContain('logger.error("PROBE_KEY is not set");');
    expect(config).toContain(
      'logger.error("PROBE_INGEST_URL or ONEUPTIME_URL is not set");',
    );
    expect(register).toContain(
      'logger.error("PROBE_ID or REGISTER_PROBE_KEY should be set");',
    );
    expect(troubleshooting).toContain(
      "Its log names what is missing: `PROBE_KEY is not set`, `PROBE_INGEST_URL or ONEUPTIME_URL is not set`, or `PROBE_ID or REGISTER_PROBE_KEY should be set`.",
    );
  });

  it("says how many times, how far apart, the probe tries to connect before it stops", () => {
    const register: string = readSource(PROBE_REGISTER);
    const attempts: number = Number(
      register.match(/const maxRetry: number = (\d+);/)?.[1],
    );
    const seconds: number = Number(
      register.match(/const retryIntervalInSeconds: number = (\d+);/)?.[1],
    );

    expect(register).toContain(
      "`Unable to register probe after ${maxRetry} attempts.",
    );
    expect(troubleshooting).toContain(
      `the probe tries ${attempts} times, ${seconds} seconds apart, then stops with \`Unable to register probe after ${attempts} attempts\`.`,
    );
  });

  it("lists every phase a stalled request can be reported at, in order", () => {
    const diagnostics: string = readSource(PROBE_DIAGNOSTICS);
    const phases: Array<string> = Array.from(
      (
        diagnostics.match(
          /export enum ProbeRequestStallPhase \{([\s\S]*?)\}/,
        )?.[1] || ""
      ).matchAll(/(\w+) = "\w+"/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });
    const rows: Array<string> = tableRows(
      section(page, "#### Find the failure report"),
    ).map((row: Array<string>): string => {
      return codeSpans(row[0] as string)[0] as string;
    });

    expect(phases).toContain("Unknown");
    expect(rows).toEqual(phases);
  });

  it("names the report's fields as the probe writes them", () => {
    const diagnostics: string = readSource(PROBE_DIAGNOSTICS);

    for (const field of [
      "stalledAt",
      "whatThisMeans",
      "deadlineOverrunInMs",
      "probeProcess",
      "eventLoopMaxDriftInMs",
    ]) {
      expect(diagnostics).toContain(`${field}:`);
      expect(troubleshooting).toContain(field);
    }

    expect(troubleshooting).toContain(
      `If a ${numberDefault("PROBE_API_REQUEST_TIMEOUT_IN_MS")}ms deadline took much longer than ${numberDefault("PROBE_API_REQUEST_TIMEOUT_IN_MS")}ms of wall clock`,
    );
    expect(troubleshooting).toContain(
      `on its way to crossing the ${numberDefault("PROBE_API_REQUEST_TIMEOUT_IN_MS") / 1000}-second deadline`,
    );
  });

  it("says when the connectivity self-test runs", () => {
    const failures: number = numericConstant("SELF_TEST_FAILURE_THRESHOLD");
    const intervalInMinutes: number =
      numericConstant("SELF_TEST_MIN_INTERVAL_IN_MS") / 60000;

    expect(failures).toBe(3);
    expect(intervalInMinutes).toBe(5);
    expect(troubleshooting).toContain(
      "After three consecutive failures the probe tests the same server one layer at a time",
    );
    expect(troubleshooting).toContain(
      "The test runs at most once every five minutes.",
    );
  });
});

describe("the Incoming Request Ingress page", () => {
  const page: string = englishPage(INGRESS);
  const ingress: string = readSource(PROBE_INGRESS);
  const forwarding: Array<Array<string>> = tableRows(
    section(page, "## How requests are forwarded"),
  );
  const forwardingRow: (what: string) => string = (what: string): string => {
    return rowFor(forwarding, what)[1] as string;
  };

  it("serves the two paths, over GET and POST, and nothing else", () => {
    const routes: Array<string> = Array.from(
      ingress.matchAll(
        /router\.(get|post|put|patch|delete|all|use)\("([^"]+)"/g,
      ),
    ).map((match: RegExpMatchArray): string => {
      return `${match[1]} ${match[2]}`;
    });

    expect(routes.sort()).toEqual(
      [
        "get /heartbeat/:secretkey",
        "get /incoming-request/:secretkey",
        "post /heartbeat/:secretkey",
        "post /incoming-request/:secretkey",
      ].sort(),
    );
    expect(page).toContain(
      "http://<probe-host>:<PROBE_INGRESS_PORT>/heartbeat/<secret-key>",
    );
    expect(page).toContain(
      "The probe also takes `/incoming-request/<secret-key>`, which works the same way.",
    );
    expect(ingress).toContain(
      'req.method === "POST" ? HTTPMethod.POST : HTTPMethod.GET',
    );
    expect(forwardingRow("Methods")).toBe(
      "`POST` is forwarded as `POST`. `GET`, and `HEAD`, are forwarded as `GET`. Other methods get a `404` from the probe.",
    );
  });

  it("answers before it forwards", () => {
    const handler: string = ingress.slice(
      ingress.indexOf("const forwardToOneUptime"),
    );

    expect(
      handler.indexOf("Response.sendEmptySuccessResponse(req, res);"),
    ).toBeGreaterThan(-1);
    expect(
      handler.indexOf("Response.sendEmptySuccessResponse(req, res);"),
    ).toBeLessThan(handler.indexOf("forwardWithRetry(forwardUrl"));
    expect(forwardingRow("The answer")).toContain(
      "`200` with an empty JSON object (`{}`), sent before the request is forwarded.",
    );
  });

  it("lists the headers it leaves out, and the one it adds", () => {
    const listed: (name: string) => Array<string> = (
      name: string,
    ): Array<string> => {
      return Array.from(
        (
          ingress.match(
            new RegExp(`${name}: Set<string> = new Set\\(\\[([^\\]]+)\\]\\)`),
          )?.[1] || ""
        ).matchAll(/"([^"]+)"/g),
      ).map((match: RegExpMatchArray): string => {
        return match[1] as string;
      });
    };
    const headers: string = forwardingRow("Headers");
    const named: Array<string> = codeSpans(headers);
    const hopByHop: Array<string> = listed("HOP_BY_HOP_HEADERS");
    const encoding: Array<string> = listed("BODY_ENCODING_HEADERS");

    expect(hopByHop.length).toBe(10);
    expect(encoding).toEqual(["content-encoding"]);
    expect(
      named
        .filter((name: string): boolean => {
          return name !== "OneUptime-Probe-Id";
        })
        .map((name: string): string => {
          return name.toLowerCase();
        }),
    ).toEqual([...hopByHop, ...encoding]);
    expect(ingress).toContain(
      'headers["OneUptime-Probe-Id"] = probeIdHeaderValue;',
    );
    expect(headers).toContain("The probe adds `OneUptime-Probe-Id`.");
  });

  it("reads the bodies OneUptime reads, up to the same limit", () => {
    const appParsers: string = readSource(APP_BODY_PARSERS);

    expect(ingress).toContain(
      'export const INGRESS_BODY_LIMIT: string = "50mb";',
    );
    expect(ingress).toMatch(
      /app\.use\(ExpressJson\(\{ limit: INGRESS_BODY_LIMIT \}\)\);\s*app\.use\(ExpressUrlEncoded\(\{ extended: true, limit: INGRESS_BODY_LIMIT \}\)\);\s*app\.use\(router\);/,
    );
    expect(appParsers).toMatch(
      /export const jsonBodyParserOptions: BodyParserOptions = \{\s*limit: "50mb",/,
    );
    expect(appParsers).toMatch(
      /export const urlEncodedBodyParserOptions: BodyParserOptions = \{\s*limit: "50mb",/,
    );
    expect(readSource(PROBE_INDEX)).toContain(
      "const ingressApp: ExpressApplication = createIngressApp();",
    );
    expect(forwardingRow("The body")).toBe(
      "JSON and form bodies of up to 50 MB, as when you send to OneUptime directly. As there, any other body reaches the monitor empty.",
    );
  });

  it("retries as the probe does: doubling from 2 seconds, never more than 15", () => {
    const backoff: RegExpMatchArray | null = ingress.match(
      /Math\.min\((\d+) \* 2 \*\* \(attempt - 1\), (\d+)\)/,
    );
    const first: number = Number(backoff?.[1]);
    const cap: number = Number(backoff?.[2]);
    const retries: number = numberDefault("PROBE_INGRESS_FORWARD_RETRY_LIMIT");
    const waits: Array<string> = [];

    for (let attempt: number = 1; attempt <= retries; attempt++) {
      waits.push(`${Math.min(first * 2 ** (attempt - 1), cap) / 1000} s`);
    }

    expect(waits).toEqual(["2 s", "4 s", "8 s"]);
    expect(forwardingRow("Retries")).toBe(
      `When a forward fails, the probe tries again up to \`PROBE_INGRESS_FORWARD_RETRY_LIMIT\` times, waiting ${waits[0]}, then ${waits[1]}, then ${waits[2]}, and never more than ${cap / 1000} s. Then it logs the failure and drops the request.`,
    );
  });

  it("forwards where every installation routes it", () => {
    const nginx: string = readSource(INGRESS_NGINX);

    expect(ingress).toMatch(
      /\.addRoute\("\/incoming-request-ingest"\)\s*\.addRoute\("\/incoming-request"\)\s*\.addRoute\(`\/\$\{secretKey\}`\)/,
    );
    expect(nginx).toContain("location /incoming-request-ingest");
    expect(forwardingRow("Where it goes")).toBe(
      "`ONEUPTIME_URL` followed by `/incoming-request-ingest/incoming-request/<secret-key>`.",
    );
  });

  it("gives the listener's settings with the probe's defaults", () => {
    const rows: Array<Array<string>> = tableRows(
      section(page, "## Environment variables"),
    );
    const timeout: NumberSetting = numberSetting(
      "PROBE_INGRESS_FORWARD_TIMEOUT_MS",
    );
    const retries: NumberSetting = numberSetting(
      "PROBE_INGRESS_FORWARD_RETRY_LIMIT",
    );

    expect(rowFor(rows, "`PROBE_INGRESS_PORT`")[1]).toBe("unset (off)");
    expect(rowFor(rows, "`PROBE_INGRESS_FORWARD_TIMEOUT_MS`")[1]).toBe(
      `\`${timeout.defaultValue}\``,
    );
    expect(rowFor(rows, "`PROBE_INGRESS_FORWARD_TIMEOUT_MS`")[2]).toContain(
      `A value below \`${timeout.min}\` falls back to the default.`,
    );
    expect(rowFor(rows, "`PROBE_INGRESS_FORWARD_RETRY_LIMIT`")[1]).toBe(
      `\`${retries.defaultValue}\``,
    );
    expect(retries.min).toBe(0);
    expect(rowFor(rows, "`PROBE_INGRESS_FORWARD_RETRY_LIMIT`")[2]).toContain(
      "`0` turns retries off.",
    );
    expect(readSource(PROBE_INDEX)).toContain(
      "if (PROBE_INGRESS_PORT !== null && PROBE_INGRESS_PORT.toNumber() > 0) {",
    );
    expect(page).toContain(
      "Any value greater than `0` turns it on; unset, or `0`, leaves it off.",
    );
  });

  it("quotes the lines the probe logs", () => {
    const index: string = readSource(PROBE_INDEX);

    expect(index).toContain(
      "`Probe ingress listener started on port ${ingressPortNumber} (heartbeat / incoming-request endpoints)`",
    );
    expect(page).toContain(
      "`Probe ingress listener started on port 3875 (heartbeat / incoming-request endpoints)`",
    );
    expect(ingress).toContain(
      "`Probe ingress: failed to forward to ${forwardUrl.toString()} after ${attempt} attempts`",
    );
    expect(page).toContain(
      "`Probe ingress: failed to forward to <url> after N attempts`",
    );
    expect(ingress).toContain(
      '"Probe ingress: probe ID not available, forwarding without it"',
    );
    expect(page).toContain(
      "`Probe ingress: probe ID not available, forwarding without it`",
    );
  });
});
