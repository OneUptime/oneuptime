import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  INGEST_BACKLOG_ALLOWANCE_MS,
  OPEN_GAP_MAX_TRUST_MS,
  RECEIVING_GAP_THRESHOLD_MS,
  RECEIVING_HEARTBEAT_INTERVAL_MS,
  RECONNECT_GRACE_MS,
} from "Common/Utils/Telemetry/ReceivingGaps";
import { TELEMETRY_EVALUATION_MAX_DEFERRAL_MS } from "Common/Server/Utils/Telemetry/ReceivingCoverage";
import { RECEIVING_PERIOD_RETENTION_IN_DAYS } from "Common/Server/Services/InstanceReceivingPeriodService";
import StartupGate from "Common/Server/Utils/StartupGate";
import { JSONObject } from "Common/Types/JSON";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { DOCS_DIR, DOCS_LANGUAGES, readPage } from "./DocsContentSupport";

/*
 * The page that explains issue #2825's rule - time OneUptime itself was not
 * receiving is never held against a resource - against the product it
 * describes.
 *
 * Every number the page quotes is a constant somewhere in the product (the
 * heartbeat interval, the gap threshold, the reconnect grace, the deferral
 * cap, the retention, Retry-After), and every language's page quotes the
 * same numbers. The labels it bolds are the ones the dashboard shows in that
 * language. The worker setting it tells operators about is the one the
 * product reads and the Helm chart sets. If any of those move, this fails
 * and says which.
 */

const PAGE: string = "monitor/when-oneuptime-is-not-receiving";
const PAGE_URL: string = `/docs/${PAGE}`;
const TITLE: string = "When OneUptime Is Not Receiving Data";

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const REPO_ROOT: string = path.resolve(PACKAGES_DIR, "..");

const DASHBOARD_LOCALES_DIR: string = path.join(
  PACKAGES_DIR,
  "App/FeatureSet/Dashboard/src/Locales",
);

const MINUTE_MS: number = 60_000;

const NUMBER_PATTERN: RegExp = /\d+/g;
const BOLD_PATTERN: RegExp = /\*\*([^*]+)\*\*/g;
const FENCE_PATTERN: RegExp = /^```[^\n]*\n[\s\S]*?^```$/gm;
const YAML_FENCE_PATTERN: RegExp = /^```yaml[^\n]*\n([\s\S]*?)^```$/m;
const HEADING_LEVEL_PATTERN: RegExp = /^#+/;
const HEADING_LINE_PATTERN: RegExp = /^(#{1,6})\s/;
const SERVER_ONLINE_DEFAULT_PATTERN: RegExp =
  /let offlineIfNotCheckedInMinutes: number = (\d+);/;
const STALE_CUTOFF_PATTERN: RegExp =
  /const STALE_CUTOFF_IN_MINUTES: number = (\d+);/;
const WORKER_ENV_PATTERN: RegExp =
  /- name: RECEIVES_INGRESS_TRAFFIC\s+value: "false"/;

/*
 * The dashboard labels the page bolds, in the order it bolds them. Each
 * language's page bolds each one as that language's dashboard shows it; the
 * criteria names have no translation, so they stay as the dashboard shows
 * them everywhere.
 */
const BOLDED_LABELS: Array<string> = [
  "Is Online",
  "Recieved In Minutes",
  "Not Recieved In Minutes",
  "Disconnected",
  "Disconnected",
  "Availability",
  "Not monitored",
];

// The inventory sweeps that turn a silent resource Disconnected after 15 minutes.
const FIFTEEN_MINUTE_SWEEPS: Array<string> = [
  "HostService.ts",
  "DockerHostService.ts",
  "PodmanHostService.ts",
  "KubernetesClusterService.ts",
];

// The monitor pages that say silence is counted in receiving time, and link here.
const LINKING_PAGES: Array<string> = [
  "monitor/server-monitor",
  "monitor/incoming-request-monitor",
  "monitor/incoming-email-monitor",
  "monitor/host-monitor",
];

const localeCache: Map<string, JSONObject> = new Map();

function dashboardLocale(lang: string): JSONObject {
  const cached: JSONObject | undefined = localeCache.get(lang);

  if (cached) {
    return cached;
  }

  const locale: JSONObject = JSON.parse(
    fs.readFileSync(path.join(DASHBOARD_LOCALES_DIR, `${lang}.json`), "utf8"),
  ) as JSONObject;

  localeCache.set(lang, locale);
  return locale;
}

// The label as the dashboard shows it in `lang`.
function uiLabel(lang: string, english: string): string {
  const value: unknown = dashboardLocale(lang)[english];

  return typeof value === "string" && value ? value : english;
}

function readSource(relativeToPackages: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relativeToPackages), "utf8");
}

function withoutFences(markdown: string): string {
  return markdown.replace(FENCE_PATTERN, "");
}

function numbersIn(markdown: string): Set<number> {
  return new Set(
    Array.from(markdown.matchAll(NUMBER_PATTERN)).map(
      (match: RegExpMatchArray): number => {
        return Number(match[0]);
      },
    ),
  );
}

function boldItems(markdown: string): Array<string> {
  return Array.from(markdown.matchAll(BOLD_PATTERN)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

// The body of one heading's section, up to the next heading of the same or a higher level.
function section(markdown: string, heading: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.findIndex((line: string): boolean => {
    return line.trim() === heading;
  });

  expect(start).toBeGreaterThanOrEqual(0);

  const level: number = (
    heading.match(HEADING_LEVEL_PATTERN) as RegExpMatchArray
  )[0].length;
  const body: Array<string> = [];

  for (const line of lines.slice(start + 1)) {
    const match: RegExpMatchArray | null = line.match(HEADING_LINE_PATTERN);

    if (match && (match[1] as string).length <= level) {
      break;
    }

    body.push(line);
  }

  return body.join("\n");
}

function firstMatch(source: string, pattern: RegExp): number {
  const match: RegExpMatchArray | null = source.match(pattern);

  expect(match).not.toBeNull();
  return Number(match![1]);
}

describe("the page is reachable", () => {
  test("the nav lists it in the Monitor group, right after Monitor Secrets", () => {
    const group: NavGroup | undefined = DocsNav.find((candidate: NavGroup) => {
      return candidate.links.some((link: NavLink) => {
        return link.url === PAGE_URL;
      });
    });

    expect(group?.title).toBe("Monitor");

    const index: number = group!.links.findIndex((link: NavLink) => {
      return link.url === PAGE_URL;
    });

    expect(group!.links[index]!.title).toBe(TITLE);
    expect(group!.links[index - 1]!.url).toBe("/docs/monitor/monitor-secrets");
    expect(readPage("en", PAGE).split("\n")[0]).toBe(`# ${TITLE}`);
  });

  test.each(DOCS_LANGUAGES)("the %s docs name the nav link", (lang: string) => {
    const locale: JSONObject = JSON.parse(
      fs.readFileSync(path.join(DOCS_DIR, "Locales", `${lang}.json`), "utf8"),
    ) as JSONObject;
    const title: unknown = (locale["navLinks"] as JSONObject)[TITLE];

    expect(typeof title).toBe("string");
    expect(title as string).toContain("OneUptime");
  });

  test.each(LINKING_PAGES)(
    "the English %s page links here where it explains silence",
    (page: string) => {
      expect(readPage("en", page)).toContain(`](${PAGE_URL})`);
    },
  );
});

describe("the English page quotes the product's numbers", () => {
  const page: string = readPage("en", PAGE);

  test("how often a process records, and when a missing record is a gap", () => {
    expect(page).toContain(
      `records every ${RECEIVING_HEARTBEAT_INTERVAL_MS / 1000} seconds that it is receiving`,
    );
    expect(page).toContain(
      `no process recorded for more than ${RECEIVING_GAP_THRESHOLD_MS / 1000} seconds`,
    );
    expect(page).toContain(
      `A restart that takes less than ${RECEIVING_GAP_THRESHOLD_MS / 1000} seconds is not a gap`,
    );
  });

  test("the reconnect grace and the backlog allowance", () => {
    expect(page).toContain(
      `the first ${RECONNECT_GRACE_MS / MINUTE_MS} minutes after OneUptime receives again`,
    );
    expect(INGEST_BACKLOG_ALLOWANCE_MS).toBe(MINUTE_MS);
    expect(page).toContain("is more than a minute behind");
  });

  test("how long a telemetry check waits at most", () => {
    expect(page).toContain(
      `never longer than ${TELEMETRY_EVALUATION_MAX_DEFERRAL_MS / MINUTE_MS} minutes after it ended`,
    );
  });

  test("the Server / VM monitor's default silence, and the probes' and AI agents'", () => {
    const serverDefault: number = firstMatch(
      readSource(
        "Common/Server/Utils/Monitor/Criteria/ServerMonitorCriteria.ts",
      ),
      SERVER_ONLINE_DEFAULT_PATTERN,
    );

    expect(page).toContain(
      `a server is offline after ${serverDefault} minutes of silence that OneUptime could have heard`,
    );

    const probeCutoff: number = firstMatch(
      readSource("App/FeatureSet/Workers/Jobs/Probe/UpdateConnectionStatus.ts"),
      STALE_CUTOFF_PATTERN,
    );
    const aiAgentCutoff: number = firstMatch(
      readSource(
        "App/FeatureSet/Workers/Jobs/AIAgent/UpdateConnectionStatus.ts",
      ),
      STALE_CUTOFF_PATTERN,
    );

    expect(aiAgentCutoff).toBe(probeCutoff);
    expect(page).toContain(
      `| Probes and AI agents | Turn **Disconnected** after ${probeCutoff} minutes of silence while OneUptime was receiving. |`,
    );
  });

  test.each(FIFTEEN_MINUTE_SWEEPS)(
    "the inventory's usual threshold is the one %s sweeps with",
    (file: string) => {
      expect(readSource(`Common/Server/Services/${file}`)).toContain(
        "silenceInMinutes: 15,",
      );
      expect(page).toContain("its silence threshold, 15 minutes for most,");
    },
  );

  test("how long an open gap is believed, and how long the record is kept", () => {
    expect(OPEN_GAP_MAX_TRUST_MS).toBe(60 * MINUTE_MS);
    expect(page).toContain("treated as a gap for at most an hour");
    expect(page).toContain(
      `Records are kept for ${RECEIVING_PERIOD_RETENTION_IN_DAYS} days`,
    );
  });

  test("what a starting process answers, and which check fails until it is ready", () => {
    expect(page).toContain(
      `\`503 Service Unavailable\` and \`Retry-After: ${StartupGate.RETRY_AFTER_SECONDS}\``,
    );
    expect(page).toContain("`/status/ready` fails until the process is ready");
    expect(readSource("Common/Server/API/StatusAPI.ts")).toContain(
      '"/status/ready"',
    );
    expect(readSource("App/Index.ts")).toContain("StartupGate.assertOpen();");
  });
});

describe("the worker setting the page tells operators about", () => {
  const page: string = readPage("en", PAGE);

  test("is the variable the product reads, true unless set to false", () => {
    expect(readSource("Common/Server/EnvironmentConfig.ts")).toContain(
      'process.env["RECEIVES_INGRESS_TRAFFIC"] !== "false"',
    );
    expect(page).toContain("a single OneUptime container needs nothing");
  });

  test("is what the Helm chart sets on its worker pods, and only there", () => {
    const helmTemplates: string = path.join(
      REPO_ROOT,
      "HelmChart/Public/oneuptime/templates",
    );

    expect(
      fs.readFileSync(path.join(helmTemplates, "worker.yaml"), "utf8"),
    ).toMatch(WORKER_ENV_PATTERN);
    expect(
      fs.readFileSync(path.join(helmTemplates, "app.yaml"), "utf8"),
    ).not.toContain("RECEIVES_INGRESS_TRAFFIC");
    expect(page).toContain("The Helm chart already sets it on its worker pods");
  });

  test.each(DOCS_LANGUAGES)(
    "the %s page's example sets exactly what the chart sets",
    (lang: string) => {
      const match: RegExpMatchArray | null = readPage(lang, PAGE).match(
        YAML_FENCE_PATTERN,
      );

      expect(match).not.toBeNull();
      expect(match![1]).toBe(
        'env:\n  - name: RECEIVES_INGRESS_TRAFFIC\n    value: "false"\n',
      );
      expect(match![1]).toMatch(WORKER_ENV_PATTERN);
    },
  );
});

describe("every language says the same thing", () => {
  const englishNumbers: Set<number> = numbersIn(
    withoutFences(readPage("en", PAGE)),
  );

  test.each(DOCS_LANGUAGES)(
    "the %s page bolds the dashboard's own labels, in that language",
    (lang: string) => {
      expect(boldItems(readPage(lang, PAGE))).toEqual(
        BOLDED_LABELS.map((label: string): string => {
          return uiLabel(lang, label);
        }),
      );
    },
  );

  test.each(DOCS_LANGUAGES)(
    "the %s page quotes the English page's numbers, and no others",
    (lang: string) => {
      const numbers: Set<number> = numbersIn(
        withoutFences(readPage(lang, PAGE)),
      );

      for (const value of englishNumbers) {
        expect({ lang, value, quoted: numbers.has(value) }).toEqual({
          lang,
          value,
          quoted: true,
        });
      }

      // "a minute" and "an hour" may be written with a digit.
      for (const value of numbers) {
        expect({
          lang,
          value,
          known: englishNumbers.has(value) || value === 1,
        }).toEqual({ lang, value, known: true });
      }
    },
  );

  test.each(DOCS_LANGUAGES)(
    "the %s page names the setting, the status check and the answer while starting",
    (lang: string) => {
      const page: string = readPage(lang, PAGE);

      expect(page).toContain("`RECEIVES_INGRESS_TRAFFIC`");
      expect(page).toContain("`/status/ready`");
      expect(page).toContain("`503 Service Unavailable`");
      expect(page).toContain(
        `\`Retry-After: ${StartupGate.RETRY_AFTER_SECONDS}\``,
      );
    },
  );

  test("the English numbers are the ones the product uses", () => {
    expect(
      [...englishNumbers].sort((a: number, b: number) => {
        return a - b;
      }),
    ).toEqual(
      [
        RECONNECT_GRACE_MS / MINUTE_MS,
        3,
        StartupGate.RETRY_AFTER_SECONDS,
        TELEMETRY_EVALUATION_MAX_DEFERRAL_MS / MINUTE_MS,
        RECEIVING_HEARTBEAT_INTERVAL_MS / 1000,
        RECEIVING_GAP_THRESHOLD_MS / 1000,
        RECEIVING_PERIOD_RETENTION_IN_DAYS,
        503,
      ].sort((a: number, b: number) => {
        return a - b;
      }),
    );
  });
});

describe("the availability charts the page describes", () => {
  const page: string = readPage("en", PAGE);

  test("shade the time with the dashboard's own Not monitored label", () => {
    expect(dashboardLocale("en")["Not monitored"]).toBe("Not monitored");
    expect(
      readSource("App/FeatureSet/Dashboard/src/Utils/ReceivingGaps.ts"),
    ).toContain('translationKey("Not monitored")');
    expect(section(page, "## What changes during that time")).toContain(
      "The time is shaded **Not monitored**",
    );
  });

  test.each([
    "Host/View/Overview.tsx",
    "Docker/View/Overview.tsx",
    "Podman/View/Overview.tsx",
    "Kubernetes/View/Index.tsx",
  ])("are the ones %s draws", (file: string) => {
    expect(readSource(`App/FeatureSet/Dashboard/src/Pages/${file}`)).toContain(
      "getNotMonitoredRegions(",
    );
  });
});
