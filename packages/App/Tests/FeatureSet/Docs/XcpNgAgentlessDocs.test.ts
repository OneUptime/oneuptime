import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { XCP_NG_COLLECTION_OVERDUE_AFTER_IN_MS } from "../../../FeatureSet/Dashboard/src/Components/XcpNg/XcpNgConnectionView";
import XcpNgCollectionErrorCode, {
  XcpNgCollectionErrorUtil,
} from "Common/Types/XcpNg/XcpNgCollectionError";
import {
  XCP_NG_CONNECTION_TEST_PICKUP_TIMEOUT_IN_SECONDS,
  XCP_NG_CONNECTION_TEST_RUN_TIMEOUT_IN_SECONDS,
} from "Common/Types/XcpNg/XcpNgConnectionTestStatus";
import {
  XCP_NG_COLLECTION_MAX_PAYLOAD_BYTES,
  XCP_NG_MAX_MESSAGES_PER_COLLECTION,
  XCP_NG_PROBE_COLLECTION_CONCURRENCY,
} from "Common/Types/XcpNg/XcpNgProbeCollection";
import {
  DEFAULT_XCP_NG_COLLECTION_INTERVAL_IN_MINUTES,
  MAX_XCP_NG_COLLECTION_INTERVAL_IN_MINUTES,
  MIN_XCP_NG_COLLECTION_INTERVAL_IN_MINUTES,
  XCP_NG_API_TOKEN_WARNING_DAYS,
} from "Common/Utils/XcpNg/XcpNgCollectionSettings";
import {
  XCP_NG_BACKUP_FIRST_READ_LOOKBACK_MS,
  XCP_NG_BACKUP_PENDING_GIVE_UP_MS,
  XCP_NG_MAX_BACKUP_RUNS_PER_COLLECTION,
  XCP_NG_PATCH_CHECK_INTERVAL_MS,
} from "Common/Types/XcpNg/XcpNgPoolEvents";
import {
  XcpNgEventAlertTemplate,
  getAllXcpNgEventAlertTemplates,
} from "Common/Types/Monitor/XcpNgEventAlertTemplates";
import { getXcpNgAlertTemplateById } from "Common/Types/Monitor/XcpNgAlertTemplates";
import { XCP_NG_RECOMMENDATION_CATEGORIES } from "../../../FeatureSet/Dashboard/src/Components/Form/Monitor/AlertTemplatePicker/AlertTemplateCategories";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * telemetry/xcp-ng-agentless.md (#10996, #10999), in every docs language,
 * against the product.
 *
 * The page walks someone through connecting a Xen Orchestra, or a pool
 * without one, that one of their probes reads: the buttons, the fields and
 * the statuses, the failures each troubleshooting entry explains and the
 * limits the probe and the server keep to. Markdown is not compiled, so
 * these read the page, the Dashboard's source and the constants themselves:
 * a button renamed, a message reworded or a limit changed fails here
 * instead of leaving the page describing a product that is no longer there.
 * DocsTranslations holds every language's page to the English one's shape.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");
const DASHBOARD_SRC: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src",
);

const PAGE: string = "telemetry/xcp-ng-agentless";
const PAGE_URL: string = `/docs/${PAGE}`;
const AGENT_PAGE_URL: string = "/docs/telemetry/xcp-ng";

const LANGUAGES: Array<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];

function readPage(lang: string, page: string = PAGE): string {
  return fs.readFileSync(path.join(CONTENT_DIR, lang, `${page}.md`), "utf8");
}

function readSource(...segments: Array<string>): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, ...segments), "utf8");
}

// The words the page names on the Dashboard, and the source that draws each.
const LABELS: Array<[string, Array<string>]> = [
  ["Connections", ["Pages", "XcpNg", "SideMenu.tsx"]],
  ["What to Read", ["Components", "XcpNg", "XcpNgConnectionFormFields.tsx"]],
  [
    "Xen Orchestra Address",
    ["Components", "XcpNg", "XcpNgConnectionFormFields.tsx"],
  ],
  [
    "Pool Master Address",
    ["Components", "XcpNg", "XcpNgConnectionFormFields.tsx"],
  ],
  [
    "OpenMetrics Secret",
    ["Components", "XcpNg", "XcpNgConnectionFormFields.tsx"],
  ],
  ["API Token", ["Components", "XcpNg", "XcpNgConnectionFormFields.tsx"]],
  ["User Name", ["Components", "XcpNg", "XcpNgConnectionFormFields.tsx"]],
  [
    "A pool without Xen Orchestra",
    ["Components", "XcpNg", "XcpNgConnectionView.ts"],
  ],
  ["Test connection", ["Components", "XcpNg", "XcpNgConnectionTestPanel.tsx"]],
  ["Pools It Reads", ["Pages", "XcpNg", "ConnectionView.tsx"]],
  ["Edit Connection", ["Components", "XcpNg", "XcpNgConnectionStatusCard.tsx"]],
  [
    "Remove the API token",
    ["Components", "XcpNg", "XcpNgConnectionStatusCard.tsx"],
  ],
  [
    "Use the XCP-ng Agent",
    ["Components", "XcpNg", "XcpNgPoolDataCollectionCard.tsx"],
  ],
  [
    "Collect With a Probe",
    ["Components", "XcpNg", "XcpNgPoolDataCollectionCard.tsx"],
  ],
  [
    "Data Collection",
    ["Components", "XcpNg", "XcpNgPoolDataCollectionCard.tsx"],
  ],
  ["Checking", ["Components", "XcpNg", "XcpNgConnectionView.ts"]],
  ["Collecting", ["Components", "XcpNg", "XcpNgConnectionView.ts"]],
  ["Not collecting", ["Components", "XcpNg", "XcpNgConnectionView.ts"]],
];

// The failures the troubleshooting section explains, each under its own title.
const TROUBLESHOOTING: Array<XcpNgCollectionErrorCode> = [
  XcpNgCollectionErrorCode.UntrustedCertificate,
  XcpNgCollectionErrorCode.CertificateChanged,
  XcpNgCollectionErrorCode.WrongSecret,
  XcpNgCollectionErrorCode.PluginNotLoaded,
  XcpNgCollectionErrorCode.PluginUnavailable,
  XcpNgCollectionErrorCode.NoPools,
  XcpNgCollectionErrorCode.TokenNotReadOnly,
  XcpNgCollectionErrorCode.TokenCannotReadAlarms,
  XcpNgCollectionErrorCode.TokenExpired,
  XcpNgCollectionErrorCode.InvalidLogin,
  XcpNgCollectionErrorCode.NotPoolMaster,
  XcpNgCollectionErrorCode.NoPermission,
  XcpNgCollectionErrorCode.ConnectionTimedOut,
  XcpNgCollectionErrorCode.ProbeNotAvailable,
  XcpNgCollectionErrorCode.PayloadTooLarge,
];

const DETAILS_LINE: RegExp = /^:::details (.+)$/gm;

describe("the docs page on XCP-ng without an agent", () => {
  it("is in all seventeen docs languages", () => {
    expect(LANGUAGES).toHaveLength(17);

    for (const lang of LANGUAGES) {
      expect({
        lang,
        exists: fs.existsSync(path.join(CONTENT_DIR, lang, `${PAGE}.md`)),
      }).toEqual({ lang, exists: true });
    }
  });

  it("is listed right after the XCP-ng Agent's install guide", () => {
    const group: NavGroup | undefined = DocsNav.find(
      (candidate: NavGroup): boolean => {
        return candidate.links.some((link: NavLink): boolean => {
          return link.url === PAGE_URL;
        });
      },
    );

    expect(group).toBeDefined();

    const urls: Array<string> = group!.links.map((link: NavLink): string => {
      return link.url;
    });
    expect(urls.indexOf(PAGE_URL)).toBe(urls.indexOf(AGENT_PAGE_URL) + 1);
    expect(
      group!.links.find((link: NavLink): boolean => {
        return link.url === PAGE_URL;
      })?.title,
    ).toBe("XCP-ng Without an Agent");
  });

  it("is linked from the agent's page, in every language", () => {
    for (const lang of LANGUAGES) {
      expect({
        lang,
        linked: readPage(lang, "telemetry/xcp-ng").includes(`(${PAGE_URL})`),
      }).toEqual({ lang, linked: true });
    }
  });

  it("links back to the agent, the monitor and the plugin's setup, in every language", () => {
    for (const lang of LANGUAGES) {
      const page: string = readPage(lang);

      for (const link of [
        `(${AGENT_PAGE_URL})`,
        "(/docs/monitor/xcp-ng-monitor)",
        "(/docs/probe/custom-probe)",
        /*
         * The plugin's setup, at the heading of the agent's page in this
         * language: a translation links to its own heading's anchor.
         */
        lang === "en"
          ? `(${AGENT_PAGE_URL}#turn-on-the-openmetrics-plugin)`
          : `(${AGENT_PAGE_URL}#`,
      ]) {
        expect({ lang, link, present: page.includes(link) }).toEqual({
          lang,
          link,
          present: true,
        });
      }
    }
  });

  it("names the Dashboard's words as the Dashboard draws them", () => {
    const english: string = readPage("en");
    // What the page sets in bold: a label, or a menu path ending in one.
    const bold: Array<string> = Array.from(
      english.matchAll(/\*\*([^*]+)\*\*/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    for (const [label, source] of LABELS) {
      const onPage: boolean = bold.some((text: string): boolean => {
        return text === label || text.endsWith(`→ ${label}`);
      });

      expect({ label, onPage: onPage }).toEqual({
        label,
        onPage: true,
      });
      expect({
        label,
        drawn: readSource(...source).includes(`"${label}"`),
      }).toEqual({ label, drawn: true });
    }

    // The table's create button: "Connect" and the table's own noun.
    expect(english).toContain("**Connect XCP-ng**");
    expect(readSource("Pages", "XcpNg", "Connections.tsx")).toContain(
      'createVerb="Connect"',
    );
    expect(readSource("Pages", "XcpNg", "Connections.tsx")).toContain(
      'singularName="XCP-ng"',
    );
  });

  it("explains each failure under the title the product shows for it", () => {
    const titles: Array<string> = Array.from(
      readPage("en").matchAll(DETAILS_LINE),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(titles).toEqual(
      TROUBLESHOOTING.map((code: XcpNgCollectionErrorCode): string => {
        return XcpNgCollectionErrorUtil.getAdvice(code).title;
      }),
    );
  });

  it("states the limits the probe and the server keep to", () => {
    const english: string = readPage("en");

    expect(DEFAULT_XCP_NG_COLLECTION_INTERVAL_IN_MINUTES).toBe(1);
    expect(english).toContain(
      `| Read every | ${DEFAULT_XCP_NG_COLLECTION_INTERVAL_IN_MINUTES} minute | From ${MIN_XCP_NG_COLLECTION_INTERVAL_IN_MINUTES} to ${MAX_XCP_NG_COLLECTION_INTERVAL_IN_MINUTES} minutes.`,
    );
    expect(english).toContain(
      `| Reads at once | ${XCP_NG_PROBE_COLLECTION_CONCURRENCY} per probe |`,
    );
    expect(english).toContain(
      `| Largest read | About ${XCP_NG_COLLECTION_MAX_PAYLOAD_BYTES / 1048576} MiB |`,
    );
    expect(english).toContain(
      `| XAPI messages | ${XCP_NG_MAX_MESSAGES_PER_COLLECTION} per read |`,
    );
    expect(english).toContain(
      `| Connection test | ${XCP_NG_CONNECTION_TEST_PICKUP_TIMEOUT_IN_SECONDS} seconds to start | A test no probe picks up in time, or that runs longer than ${XCP_NG_CONNECTION_TEST_RUN_TIMEOUT_IN_SECONDS} seconds,`,
    );
    expect(english).toContain(
      `If no probe comes for the connection for ${
        XCP_NG_COLLECTION_OVERDUE_AFTER_IN_MS / 60000
      } minutes`,
    );
    expect(XCP_NG_API_TOKEN_WARNING_DAYS).toBe(14);
    expect(english).toContain("Two weeks before");
  });

  it("says what a probe reads beyond the metrics, and names every template that alerts on it (#10997)", () => {
    const english: string = readPage("en");
    const start: number = english.indexOf("\n## Alarms, HA and backups\n");
    const end: number = english.indexOf("\n## ", start + 1);
    expect(start).toBeGreaterThan(0);
    const section: string = english.slice(start, end);

    // Every event template, by the name the Recommendations show.
    for (const template of getAllXcpNgEventAlertTemplates()) {
      expect({
        template: template.id,
        named: section.includes(template.name),
      }).toEqual({ template: template.id, named: true });
    }
    // The two metric templates that read what the probe adds.
    for (const id of [
      "xcp-ng-ha-cannot-tolerate-host-failure",
      "xcp-ng-vm-not-backed-up",
    ]) {
      const template: { name: string } | undefined =
        getXcpNgAlertTemplateById(id);
      expect(template).toBeDefined();
      expect(section).toContain(template!.name);
    }
    // The headings they are listed under, as the picker draws them.
    const headings: Map<string, string> = new Map(
      XCP_NG_RECOMMENDATION_CATEGORIES.map(
        (category: { category: string; label: string }): [string, string] => {
          return [category.category, category.label];
        },
      ),
    );
    const listedUnder: Set<string> = new Set(
      getAllXcpNgEventAlertTemplates().map(
        (template: XcpNgEventAlertTemplate): string => {
          return template.category;
        },
      ),
    );
    for (const category of listedUnder) {
      expect(headings.has(category)).toBe(true);
      expect(section).toContain(`**${headings.get(category)}**`);
    }
    // A pool's XAPI has no backups and no missing patches to read.
    expect(section).toContain(
      "| Backup jobs and their runs | Read | Not read:",
    );
    expect(section).toContain("| Missing patches | Read every six hours,");
    expect(XCP_NG_PATCH_CHECK_INTERVAL_MS).toBe(6 * 60 * 60 * 1000);
  });

  it("states how far back and how much of the backup logs and patches a read takes", () => {
    const english: string = readPage("en");
    const reader: string = fs.readFileSync(
      path.join(REPO_ROOT, "Probe/Utils/XcpNg/XenOrchestraEventsReader.ts"),
      "utf8",
    );
    const hostsPerCheck: string | undefined = reader.match(
      /XO_MAX_HOSTS_PER_PATCH_CHECK: number = (\d+);/,
    )?.[1];

    expect(XCP_NG_BACKUP_FIRST_READ_LOOKBACK_MS).toBe(8 * 24 * 60 * 60 * 1000);
    expect(XCP_NG_BACKUP_PENDING_GIVE_UP_MS).toBe(3 * 24 * 60 * 60 * 1000);
    expect(english).toContain(
      `| Backup runs | ${XCP_NG_MAX_BACKUP_RUNS_PER_COLLECTION} per read | The first read looks back a week and a day. A run Xen Orchestra still calls pending after three days is no longer waited for. |`,
    );
    expect(english).toContain(
      "The first read of the backup logs looks back a week and a day",
    );
    expect(hostsPerCheck).toBeDefined();
    expect(english).toContain(
      `| Missing patches | Every ${XCP_NG_PATCH_CHECK_INTERVAL_MS / 3600000} hours | Through Xen Orchestra, for up to ${hostsPerCheck} hosts a check. |`,
    );
  });

  it("never tells anyone to turn certificate checks off", () => {
    for (const lang of LANGUAGES) {
      const page: string = readPage(lang).toLowerCase();

      expect(page).not.toContain("insecure_skip_verify");
      expect(page).not.toContain("rejectunauthorized");
      expect(page).not.toContain("--insecure");
    }
  });
});
