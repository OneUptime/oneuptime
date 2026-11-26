import {
  DOCS_LANGUAGES,
  TRANSLATED_LANGUAGES,
  listPages,
  readPage,
} from "./DocsContentSupport";
import { dashboardTranslator } from "./DocsDashboardLabels";
import {
  MONITOR_NAME_PLACEHOLDER,
  defaultCriteriaNamesAsWritten,
  defaultTitlesAsQuoted,
  isQuotedIn,
  monitorNamePlaceholder,
  withMonitorNamePlaceholder,
} from "./DocsDefaultTitles";
import { strayMarkers } from "./DocsTranslationChecks";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorType from "Common/Types/Monitor/MonitorType";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A NEW MONITOR'S DEFAULT TITLES AND CRITERIA NAMES, QUOTED IN THE READER'S
 * WORDS (#8526).
 *
 * The Dashboard makes a new monitor's default criteria with the reader's
 * translator, so a German DNS monitor opens an incident titled "Acme ist
 * offline" from its criteria "Prüfen, ob Acme offline ist", and a Danish
 * Probe Status monitor one titled "Sonde afbrudt: EU Probe". The translated
 * monitor pages quoted them in English - „_monitor name_ is offline“,
 * Check if _monitor name_ is offline, `Probe disconnected:
 * {{disconnectedProbeNames}}` - in all 16 languages, on 20 pages.
 *
 * A page quotes them as DocsDefaultTitles says (and the docs guide,
 * Packages/App/FeatureSet/Docs/README.md, Translating): the Dashboard
 * locale's words, between the language's quotation marks, with the monitor's
 * name as an italic placeholder in the reader's words and a variable the
 * title keeps written as the Incident Title field shows it. This holds every
 * monitor page to it:
 *
 *   - each translation has every default title and criteria name its
 *     English page has, in its own words, and quoted where the English
 *     quotes it;
 *   - none still has one in English, or the English placeholder;
 *   - the Probe Status page, English included, quotes its title instead of
 *     showing it as code;
 *   - every page that quotes one is listed here.
 */

interface DefaultTitlesPage {
  page: string;
  monitorType: MonitorType;
}

const PAGES: ReadonlyArray<DefaultTitlesPage> = [
  { page: "monitor/website-monitor", monitorType: MonitorType.Website },
  { page: "monitor/api-monitor", monitorType: MonitorType.API },
  { page: "monitor/dns-monitor", monitorType: MonitorType.DNS },
  { page: "monitor/dnssec-monitor", monitorType: MonitorType.DNSSEC },
  {
    page: "monitor/ssl-certificate-monitor",
    monitorType: MonitorType.SSLCertificate,
  },
  { page: "monitor/domain-monitor", monitorType: MonitorType.Domain },
  { page: "monitor/port-monitor", monitorType: MonitorType.Port },
  { page: "monitor/ping-monitor", monitorType: MonitorType.Ping },
  { page: "monitor/ip-monitor", monitorType: MonitorType.IP },
  { page: "monitor/ntp-monitor", monitorType: MonitorType.NTP },
  { page: "monitor/ceph-monitor", monitorType: MonitorType.Ceph },
  { page: "monitor/docker-monitor", monitorType: MonitorType.Docker },
  {
    page: "monitor/docker-swarm-monitor",
    monitorType: MonitorType.DockerSwarm,
  },
  { page: "monitor/host-monitor", monitorType: MonitorType.Host },
  { page: "monitor/podman-monitor", monitorType: MonitorType.Podman },
  { page: "monitor/proxmox-monitor", monitorType: MonitorType.Proxmox },
  { page: "monitor/xcp-ng-monitor", monitorType: MonitorType.XcpNg },
  {
    page: "monitor/storage-array-monitor",
    monitorType: MonitorType.StorageArray,
  },
  { page: "monitor/iot-device-monitor", monitorType: MonitorType.IoTDevice },
  { page: "monitor/vmware-monitor", monitorType: MonitorType.VMware },
  { page: "monitor/openstack-monitor", monitorType: MonitorType.OpenStack },
];

const PROBE_STATUS_PAGE: string = "monitor/probe-status-monitor";

const DASHBOARD_LOCALES: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Dashboard/src/Locales",
);

// An English page quoting a default title, or naming a default criteria.
const QUOTES_A_DEFAULT_TITLE: RegExp =
  /"_monitor name_ |Check if _monitor name_ /;

// The English placeholders the translations wrote before #8526.
const ENGLISH_PLACEHOLDERS: RegExp = /_monitor name_|\(name\)/;

interface QuotedText {
  english: string;
  translated: string;
}

/*
 * The default titles and criteria names a page has, paired with this
 * language's: a new monitor's criteria are the same in every language, in
 * the same order, so the n-th title is the same title.
 */
function textsOf(
  entry: DefaultTitlesPage,
  language: string,
): Array<QuotedText> {
  const english: string = readPage("en", entry.page);
  const pairs: Array<QuotedText> = [];

  const translatedNames: Array<string> = defaultCriteriaNamesAsWritten(
    entry.monitorType,
    language,
  );
  const translatedTitles: Array<string> = defaultTitlesAsQuoted(
    entry.monitorType,
    language,
  );

  // A criteria name stands in a table cell or between quotation marks.
  defaultCriteriaNamesAsWritten(entry.monitorType, "en").forEach(
    (name: string, index: number): void => {
      if (english.includes(name)) {
        pairs.push({ english: name, translated: translatedNames[index]! });
      }
    },
  );

  /*
   * A title is always quoted: "_monitor name_ is offline" inside the name
   * "Check if _monitor name_ is offline" is not the title.
   */
  defaultTitlesAsQuoted(entry.monitorType, "en").forEach(
    (title: string, index: number): void => {
      if (isQuotedIn(english, title)) {
        pairs.push({ english: title, translated: translatedTitles[index]! });
      }
    },
  );

  return pairs;
}

function probeTitle(language: string): string {
  return dashboardTranslator(language).translateTemplate(
    MonitorCriteriaInstance.PROBE_DISCONNECTED_TITLE,
  );
}

describe("the helpers", () => {
  it("write the monitor's name as the italic placeholder in the reader's words", () => {
    expect(withMonitorNamePlaceholder("Acme ist offline", "de")).toBe(
      "_Monitorname_ ist offline",
    );
    expect(withMonitorNamePlaceholder("Acme is offline", "en")).toBe(
      "_monitor name_ is offline",
    );
    // An underscore before a letter would not close the italics.
    expect(
      withMonitorNamePlaceholder("Acme의 시간이 정확하지 않음", "ko"),
    ).toBe("*모니터 이름*의 시간이 정확하지 않음");
  });

  it("find a text between any language's quotation marks, and only there", () => {
    expect(
      isQuotedIn("ein Vorfall namens „_X_ ist offline“", "_X_ ist offline"),
    ).toBe(true);
    expect(
      isQuotedIn("un incident « _X_ est hors ligne »", "_X_ est hors ligne"),
    ).toBe(true);
    expect(isQuotedIn("un incidente «_X_ è offline»", "_X_ è offline")).toBe(
      true,
    );
    expect(
      isQuotedIn(
        "インシデント「_X_ がオフラインです」",
        "_X_ がオフラインです",
      ),
    ).toBe(true);
    expect(isQuotedIn("名为“_X_ 已离线”的事件", "_X_ 已离线")).toBe(true);
    expect(
      isQuotedIn('an incident called "_X_ is offline"', "_X_ is offline"),
    ).toBe(true);
    // As code, bold or bare it is not quoted.
    expect(isQuotedIn("titled `_X_ is offline`", "_X_ is offline")).toBe(false);
    expect(isQuotedIn("titled **_X_ is offline**", "_X_ is offline")).toBe(
      false,
    );
    expect(
      isQuotedIn("| Check if _X_ is offline |", "Check if _X_ is offline"),
    ).toBe(false);
  });

  it("give a new monitor's titles and criteria names in the reader's words", () => {
    expect(defaultTitlesAsQuoted(MonitorType.DNS, "en")).toEqual([
      "_monitor name_ is offline",
    ]);
    expect(defaultTitlesAsQuoted(MonitorType.DNS, "de")).toEqual([
      "_Monitorname_ ist offline",
    ]);
    expect(defaultCriteriaNamesAsWritten(MonitorType.Host, "fr")).toEqual([
      "Vérifier si _nom du moniteur_ est hors ligne",
      "Vérifier si _nom du moniteur_ est en ligne",
    ]);
    expect(defaultTitlesAsQuoted(MonitorType.SSLCertificate, "ja")).toEqual([
      expect.stringContaining("_モニター名_"),
      expect.stringContaining("_モニター名_"),
    ]);
    expect(probeTitle("da")).toBe("Sonde afbrudt: {{disconnectedProbeNames}}");
  });

  it("name the monitor in every docs language's own words", () => {
    expect(Object.keys(MONITOR_NAME_PLACEHOLDER).sort()).toEqual(
      [...DOCS_LANGUAGES].sort(),
    );

    for (const language of TRANSLATED_LANGUAGES) {
      expect({
        language,
        placeholder: monitorNamePlaceholder(language),
      }).not.toEqual({
        language,
        placeholder: MONITOR_NAME_PLACEHOLDER["en"],
      });
    }

    expect(() => {
      return monitorNamePlaceholder("xx");
    }).toThrow();
  });

  it("read the titles from every Dashboard locale the docs are written in", () => {
    for (const language of TRANSLATED_LANGUAGES) {
      expect(
        fs.existsSync(path.join(DASHBOARD_LOCALES, `${language}.json`)),
      ).toBe(true);
    }
  });
});

describe("the pages this test keeps", () => {
  it("are every English monitor page that quotes a default title or names a default criteria", () => {
    const quoting: Array<string> = listPages("en").filter(
      (page: string): boolean => {
        return (
          page !== PROBE_STATUS_PAGE &&
          QUOTES_A_DEFAULT_TITLE.test(readPage("en", page))
        );
      },
    );

    expect(quoting.sort()).toEqual(
      PAGES.map((entry: DefaultTitlesPage): string => {
        return entry.page;
      }).sort(),
    );
  });

  it.each(PAGES)(
    "$page has a default title or criteria name of its monitor type",
    (entry: DefaultTitlesPage) => {
      expect(textsOf(entry, "de").length).toBeGreaterThan(0);
    },
  );

  it("quote the English titles between quotation marks", () => {
    const unquoted: Array<string> = [];

    for (const entry of PAGES) {
      const english: string = readPage("en", entry.page);
      // The criteria names hold the offline title: "Check if _monitor name_ is offline".
      const withoutNames: string = defaultCriteriaNamesAsWritten(
        entry.monitorType,
        "en",
      ).reduce((text: string, name: string): string => {
        return text.split(name).join(" ");
      }, english);

      for (const title of defaultTitlesAsQuoted(entry.monitorType, "en")) {
        if (withoutNames.includes(title) && !isQuotedIn(english, title)) {
          unquoted.push(`${entry.page}: ${title}`);
        }
      }
    }

    expect(unquoted).toEqual([]);
  });
});

describe.each(TRANSLATED_LANGUAGES)("%s", (language: string) => {
  it.each(PAGES)(
    "$page quotes each default title and criteria name in this language's words",
    (entry: DefaultTitlesPage) => {
      const english: string = readPage("en", entry.page);
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = textsOf(entry, language)
        .filter((text: QuotedText): boolean => {
          return isQuotedIn(english, text.english)
            ? !isQuotedIn(translated, text.translated)
            : !translated.includes(text.translated);
        })
        .map((text: QuotedText): string => {
          return `${text.english} -> ${text.translated}`;
        });

      expect(missing).toEqual([]);
    },
  );

  it.each(PAGES)(
    "$page keeps no default title or criteria name in English",
    (entry: DefaultTitlesPage) => {
      const translated: string = readPage(language, entry.page);

      expect(
        textsOf(entry, language)
          .filter((text: QuotedText): boolean => {
            // Dutch "is offline" is Dutch too.
            return (
              text.english !== text.translated &&
              translated.includes(text.english)
            );
          })
          .map((text: QuotedText): string => {
            return text.english;
          }),
      ).toEqual([]);
      expect(translated).not.toMatch(ENGLISH_PLACEHOLDERS);
    },
  );

  it("quotes the Probe Status monitor's incident title in this language's words, not as code", () => {
    const translated: string = readPage(language, PROBE_STATUS_PAGE);

    expect(isQuotedIn(translated, probeTitle(language))).toBe(true);
    expect(translated).not.toContain("Probe disconnected:");
    expect(translated).not.toContain(`\`${probeTitle(language)}\``);
  });

  it("draws every quoted title's italics, with no marker left", async () => {
    const titles: Array<string> = PAGES.flatMap(
      (entry: DefaultTitlesPage): Array<string> => {
        return textsOf(entry, language).map((text: QuotedText): string => {
          return text.translated;
        });
      },
    );

    expect(titles.length).toBeGreaterThan(20);
    expect(
      await strayMarkers(
        `# Title\n\n${Array.from(new Set(titles))
          .map((title: string): string => {
            return `- „${title}“, ${title}`;
          })
          .join("\n")}`,
        language,
      ),
    ).toEqual([]);
  });
});

describe("the English Probe Status page", () => {
  it("quotes the incident title as the DNS pages quote theirs, not as code", () => {
    const english: string = readPage("en", PROBE_STATUS_PAGE);

    expect(isQuotedIn(english, probeTitle("en"))).toBe(true);
    expect(english).not.toContain("`Probe disconnected:");
  });
});

/*
 * What the pages said before #8526, which these checks turn away.
 */
describe("the old pages", () => {
  it("fail: the English title, in any quotation marks", () => {
    const old: string =
      "Der Monitor wird als **Offline** markiert und ein Vorfall namens „_monitor name_ is offline“ wird erstellt.";

    expect(
      isQuotedIn(old, defaultTitlesAsQuoted(MonitorType.DNS, "de")[0]!),
    ).toBe(false);
    expect(old).toMatch(ENGLISH_PLACEHOLDERS);
  });

  it("fail: the Probe Status title as code", () => {
    const old: string =
      "| Prüfen, ob eine Sonde getrennt ist | **Getrennte Sonden** größer als `0` | meldet einen Vorfall mit dem Titel `Probe disconnected: {{disconnectedProbeNames}}`. |";

    expect(isQuotedIn(old, probeTitle("de"))).toBe(false);
    expect(old).toContain("Probe disconnected:");
  });

  it("fail: a criteria name in italics with (name) for the monitor", () => {
    const old: string =
      "In der Liste der Kriterien sind sie nach dem Monitor benannt: _Check if (name) is offline_ und _Check if (name) is online_.";

    expect(
      isQuotedIn(
        old,
        defaultCriteriaNamesAsWritten(MonitorType.Website, "de")[0]!,
      ),
    ).toBe(false);
    expect(old).toMatch(ENGLISH_PLACEHOLDERS);
  });
});
