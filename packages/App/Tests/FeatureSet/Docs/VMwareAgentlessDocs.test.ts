import DocsNav, {
  LocalizedNavGroup,
  LocalizedNavLink,
  NavGroup,
  NavLink,
} from "../../../FeatureSet/Docs/Utils/Nav";
import {
  SUPPORTED_DOCS_LANGUAGE_CODES,
  getLocalizedNav,
} from "../../../FeatureSet/Docs/Utils/I18n";
import { drawnDashboardLabel } from "./DocsDashboardLabels";
import VMwareCollectionErrorCode, {
  VMwareCollectionErrorUtil,
} from "Common/Types/VMware/VMwareCollectionError";
import {
  VMWARE_CONNECTION_TEST_PICKUP_TIMEOUT_IN_SECONDS,
  VMWARE_CONNECTION_TEST_RUN_TIMEOUT_IN_SECONDS,
} from "Common/Types/VMware/VMwareConnectionTestStatus";
import {
  VMWARE_COLLECTION_MAX_PAYLOAD_BYTES,
  VMWARE_PROBE_COLLECTION_CONCURRENCY,
} from "Common/Types/VMware/VMwareProbeCollection";
import {
  DEFAULT_VMWARE_COLLECTION_INTERVAL_IN_MINUTES,
  MAX_VMWARE_COLLECTION_INTERVAL_IN_MINUTES,
  MIN_VMWARE_COLLECTION_INTERVAL_IN_MINUTES,
} from "Common/Utils/VMware/VMwareCollectionSettings";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * telemetry/vmware-agentless.md, in every docs language, against the product.
 *
 * The page walks someone through connecting a vCenter that one of their
 * probes collects: the buttons to click, the card and the statuses that
 * follow, the messages a failure shows and the limits the probe keeps to.
 * Markdown is not compiled, so these read the pages, the Dashboard's source
 * and locale files and the constants the probe and the server use: a button
 * renamed, a message reworded or a limit changed fails here instead of
 * leaving the page describing a product that is no longer there.
 *
 * Every language names the Dashboard as its own Dashboard draws it - Persian
 * included (drawnDashboardLabel), as on the newer pages.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");

const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");

const DASHBOARD_SRC: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src",
);

const PAGE: string = "telemetry/vmware-agentless";
const AGENT_PAGE_URL: string = "/docs/telemetry/vmware";
const PAGE_URL: string = `/docs/${PAGE}`;

const LANGUAGES: Array<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];

// What the page names on the Dashboard, in its English words.
const LABELS: Array<string> = [
  "Settings",
  "Overview",
  "Data Collection",
  "Checking",
  "Collecting",
  "Test connection",
  "Trust this certificate",
  "Collect With a Probe",
  "Use the VMware Agent",
  "Edit Connection",
  "Custom Probes",
];

// The failures the troubleshooting section explains, in its order.
const TROUBLESHOOTING: Array<VMwareCollectionErrorCode> = [
  VMwareCollectionErrorCode.UntrustedCertificate,
  VMwareCollectionErrorCode.InvalidLogin,
  VMwareCollectionErrorCode.NoPermission,
  VMwareCollectionErrorCode.ConnectionTimedOut,
  VMwareCollectionErrorCode.ProbeNotAvailable,
  VMwareCollectionErrorCode.PayloadTooLarge,
];

const DETAILS_LINE: RegExp = /^:::details (.+)$/;
const TABLE_LINE: RegExp = /^\|/;
const TABLE_SEPARATOR: RegExp = /^\|(\s*-+\s*\|)+$/;
const PERSIAN_DIGIT: RegExp = /[۰-۹]/g;
const NUMBER: RegExp = /\d+/g;

function readPage(lang: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, lang, `${PAGE}.md`), "utf8");
}

function readSource(relative: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, relative), "utf8");
}

// A label as this language's Dashboard draws it.
function drawn(lang: string, english: string): string {
  return drawnDashboardLabel(lang, english);
}

/*
 * The vCenters table's create button: "Connect" and the model's singular
 * name, drawn like translateCreateAction does - the whole phrase when the
 * locale has it, else the verb's template with the locale's name in it.
 */
function connectButton(lang: string): string {
  if (lang === "en") {
    return "Connect vCenter";
  }

  const phrase: string = drawn(lang, "Connect vCenter");

  if (phrase !== "Connect vCenter") {
    return phrase;
  }

  return drawn(lang, "Connect {{itemName}}").replace(
    "{{itemName}}",
    drawn(lang, "vCenter"),
  );
}

// Persian pages write numbers in Persian digits; compare them as numbers.
function westernDigits(text: string): string {
  return text.replace(PERSIAN_DIGIT, (digit: string): string => {
    return String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit));
  });
}

// The page's tables, each as its rows of cells, header and separator left out.
function tables(page: string): Array<Array<Array<string>>> {
  const found: Array<Array<Array<string>>> = [];
  let current: Array<string> | null = null;

  for (const line of page.split("\n")) {
    if (TABLE_LINE.test(line)) {
      current = current || [];
      current.push(line.trim());
      continue;
    }

    if (current) {
      found.push(
        current
          .filter((row: string, index: number): boolean => {
            return index > 0 && !TABLE_SEPARATOR.test(row);
          })
          .map((row: string): Array<string> => {
            return row
              .slice(1, -1)
              .split("|")
              .map((cell: string): string => {
                return cell.trim();
              });
          }),
      );
      current = null;
    }
  }

  return found;
}

// The numbers a table cell states, as numbers.
function numbersIn(cell: string): Array<number> {
  return (westernDigits(cell).match(NUMBER) || []).map(
    (value: string): number => {
      return Number(value);
    },
  );
}

const MAX_PAYLOAD_IN_MIB: number =
  VMWARE_COLLECTION_MAX_PAYLOAD_BYTES / 1048576;

describe("the docs page on VMware without an agent", () => {
  it("is checked in all seventeen docs languages", () => {
    expect(LANGUAGES).toHaveLength(17);
    expect(LANGUAGES).toContain("en");
    expect(LANGUAGES).toContain("fa");
  });

  it("is listed right after the VMware Agent's install guide", () => {
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
  });

  it.each(LANGUAGES)(
    "%s: is translated, and titled as its nav link is",
    (lang: string) => {
      const navTitle: string | undefined = getLocalizedNav(lang)
        .flatMap((group: LocalizedNavGroup): Array<LocalizedNavLink> => {
          return group.links;
        })
        .find((link: LocalizedNavLink): boolean => {
          return link.url.endsWith(`/${PAGE}`);
        })?.title;

      expect(navTitle).toBeDefined();
      expect(readPage(lang).split("\n")[0]).toBe(`# ${navTitle}`);

      // A translation, not the English page copied.
      if (lang !== "en") {
        expect(navTitle).not.toBe("VMware Without an Agent");
      }
    },
  );

  it("quotes the Dashboard's own words", () => {
    const panel: string = readSource(
      "Components/VMware/VMwareConnectionTestPanel.tsx",
    );
    const statusCard: string = readSource(
      "Components/VMware/VMwareCollectionStatusCard.tsx",
    );
    const settingsCard: string = readSource(
      "Components/VMware/VMwareDataCollectionCard.tsx",
    );
    const view: string = readSource(
      "Components/VMware/VMwareProbeCollectionView.ts",
    );

    expect(panel).toContain('"Test connection"');
    expect(panel).toContain('title="Trust this certificate"');
    expect(statusCard).toContain('title="Data Collection"');
    expect(settingsCard).toContain('title="Data Collection"');
    expect(settingsCard).toContain('title: "Collect With a Probe"');
    expect(settingsCard).toContain('title: "Use the VMware Agent"');
    expect(settingsCard).toContain('title: "Edit Connection"');
    expect(view).toContain('translateText("Checking")');
    expect(view).toContain('translateText("Collecting")');
    expect(readSource("Pages/VMware/SideMenu.tsx")).toContain(
      'title: "All vCenters"',
    );
    expect(readSource("Pages/VMware/VCenters.tsx")).toContain(
      'createVerb="Connect"',
    );
    expect(readSource("Pages/Monitor/Settings/MonitorProbes.tsx")).toContain(
      'title: "Custom Probes"',
    );
  });

  it.each(LANGUAGES)(
    "%s: names the buttons, the card and its statuses as the Dashboard draws them",
    (lang: string) => {
      const page: string = readPage(lang);

      for (const label of LABELS) {
        expect({
          label,
          named: page.includes(`**${drawn(lang, label)}**`),
        }).toEqual({ label, named: true });
      }

      // Where to start, and the button that both opens and saves the form.
      expect(page).toContain(`**VMware → ${drawn(lang, "All vCenters")}**`);
      expect(page.split(`**${connectButton(lang)}**`).length - 1).toBe(2);

      // The message collection stops with when vCenter's certificate changes.
      expect(page).toContain(
        `**${drawn(
          lang,
          VMwareCollectionErrorUtil.getAdvice(
            VMwareCollectionErrorCode.CertificateChanged,
          ).title,
        )}**`,
      );
    },
  );

  it.each(LANGUAGES)(
    "%s: titles each troubleshooting entry with the message the Dashboard shows for it",
    (lang: string) => {
      const titles: Array<string> = readPage(lang)
        .split("\n")
        .map((line: string): string | null => {
          const match: RegExpExecArray | null = DETAILS_LINE.exec(line);
          return match ? match[1]!.trim() : null;
        })
        .filter((title: string | null): title is string => {
          return title !== null;
        });

      expect(titles).toEqual(
        TROUBLESHOOTING.map((code: VMwareCollectionErrorCode): string => {
          return drawn(lang, VMwareCollectionErrorUtil.getAdvice(code).title);
        }),
      );
    },
  );

  it.each(LANGUAGES)(
    "%s: states the limits the probe and the server keep to",
    (lang: string) => {
      const [comparison, reference] = tables(readPage(lang)) as [
        Array<Array<string>>,
        Array<Array<string>>,
      ];

      // Probe or agent: the largest vCenter a probe collects.
      expect(comparison).toHaveLength(5);
      expect(numbersIn(comparison[3]![1]!)).toEqual([MAX_PAYLOAD_IN_MIB]);

      expect(reference).toHaveLength(4);

      // Collect every: the default, then the range a person may pick from.
      expect(numbersIn(reference[0]![1]!)).toEqual([
        DEFAULT_VMWARE_COLLECTION_INTERVAL_IN_MINUTES,
      ]);
      expect(numbersIn(reference[0]![2]!).slice(0, 2)).toEqual([
        MIN_VMWARE_COLLECTION_INTERVAL_IN_MINUTES,
        MAX_VMWARE_COLLECTION_INTERVAL_IN_MINUTES,
      ]);

      // Collections at once, per probe.
      expect(numbersIn(reference[1]![1]!)).toEqual([
        VMWARE_PROBE_COLLECTION_CONCURRENCY,
      ]);

      // The largest collection.
      expect(numbersIn(reference[2]![1]!)).toEqual([MAX_PAYLOAD_IN_MIB]);

      // A connection test: how long it may wait, then how long it may run.
      expect(numbersIn(reference[3]![1]!)).toEqual([
        VMWARE_CONNECTION_TEST_PICKUP_TIMEOUT_IN_SECONDS,
      ]);
      expect(numbersIn(reference[3]![2]!)).toEqual([
        VMWARE_CONNECTION_TEST_RUN_TIMEOUT_IN_SECONDS / 60,
      ]);
    },
  );

  it("is linked from the agent's install guide and the monitor page, in English and Persian", () => {
    for (const lang of ["en", "fa"]) {
      for (const page of ["telemetry/vmware", "monitor/vmware-monitor"]) {
        expect({
          lang,
          page,
          links: fs
            .readFileSync(path.join(CONTENT_DIR, lang, `${page}.md`), "utf8")
            .includes(`](${PAGE_URL})`),
        }).toEqual({ lang, page, links: true });
      }
    }
  });
});
