/**
 * @timezone UTC
 */
import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import React, { ReactElement } from "react";
import { initReactI18next } from "react-i18next";
import Host from "../../../Models/DatabaseModels/Host";
import {
  HostStatusCell,
  HostUsageCell,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Host/HostListCells";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

/*
 * The words the Hosts pages add - the Hosts list's Status, CPU, Memory and
 * Disk cells, the fleet's and a host's Needs attention rows (HostAttention,
 * HostHealth's reasons), the host's Overview and the (i) texts - in every
 * language the Dashboard speaks, and the cells drawn in German and Persian:
 * a mount, a size and a share set apart from a Persian sentence, and a
 * mount cut short at its own end.
 */

const PACKAGES: string = path.resolve(__dirname, "../../../..");
const DASHBOARD_SRC: string = path.join(
  PACKAGES,
  "App/FeatureSet/Dashboard/src",
);
const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");
const PROGRESS_DIR: string = path.resolve(DASHBOARD_SRC, "../i18n/Progress");

const LANGUAGES: Array<string> = [...DASHBOARD_LANGUAGES];

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function readLocale(locale: string): Record<string, string> {
  return readJson<Record<string, string>>(
    path.join(LOCALES_DIR, `${locale}.json`),
  );
}

// The locale's own list of English that reads the same in it.
function sameAsEnglish(locale: string): Set<string> {
  return new Set<string>(
    readJson<{ sameAsEnglish: Array<string> }>(
      path.join(PROGRESS_DIR, `${locale}.json`),
    ).sameAsEnglish,
  );
}

/*
 * The sentences the Hosts pages add or newly draw, by the file that writes
 * them (relative to packages/). A count-dependent sentence is listed by its
 * general form; its one form follows below.
 */
const PART_SENTENCES: Record<string, Array<string>> = {
  "App/FeatureSet/Dashboard/src/Components/Host/HostListCells.tsx": [
    "+{{count}} more",
    "Last reported {{time}}",
    "Not reported",
    "of {{total}}",
    "{{count}} cores",
  ],
  // The Activity cards every resource's Overview draws, a host's among them.
  "App/FeatureSet/Dashboard/src/Components/ResourceActivity/ResourceActivityCards.tsx":
    [
      "Current incidents, alerts, and scheduled maintenance impacting this resource. Click a card to see the full list.",
    ],
  "App/FeatureSet/Dashboard/src/Pages/Host/Utils/HostAttention.ts": [
    "Collector",
    "Filesystem",
    "Host",
    "Systemd unit",
    "This host",
    "What is broken or needs a look, the most urgent first. More hosts need attention than one read holds: these are the most urgent.",
  ],
  "App/FeatureSet/Dashboard/src/Pages/Host/View/Overview.tsx": [
    // The section headings' lines, English in most languages until its review.
    "Aggregated over the selected time range",
    "Booted",
    "Filesystem",
    /*
     * The one card of what the host reported (ResourceRecordDetailsCard,
     * #5307's follow-up): its Settings card's title, and no line under it.
     */
    "Host Details",
    "Host Health",
    "Host alerts",
    "Load avg (1m)",
    "Memory",
    "Processes",
    "The alerts OneUptime recommends for a host: which watch this one, and one step to turn on the rest.",
    "Up {{duration}}",
    "Whether metrics arrived from this host, over the selected time range",
    "across {{count}} cores",
    "of {{total}}",
    "running · {{total}} total",
    "{{percent}}% of {{count}} cores",
  ],
  "App/FeatureSet/Dashboard/src/Components/MetricDescriptions/HostMetricDescriptions.ts":
    [
      "Healthy, Degraded or Unhealthy, by the rules the host's Needs attention card and the Hosts list follow, from what it last reported. Health Unknown while it is not reporting: its last readings are no longer the truth.",
      "How full the host's fullest filesystem is, as df's Use% (space reserved for root not counted), from the host's last report, updated about once a minute; below, its mount point. Amber above 85%, red above 95%.",
      "How full the host's fullest filesystem is, as df's Use% (used space over used plus free, space reserved for root not counted), averaged over the whole selected range, not the last 5 minutes; below, its mount point. The Filesystems table lists every mount.",
      "How full the host's fullest filesystem is, the same mount as the Filesystem tile, in each interval of the selected range, as df's Use%: space reserved for root not counted.",
      "How full this mount is, as df's Use%: used space over used plus free, space reserved for root not counted, averaged over the selected range. The bar turns amber above 85% and red above 95%.",
      "Share of CPU time spent running programs and the operating system (user plus system time) across every core, from the host's last report, updated about once a minute; below, its logical cores. Amber above 90%.",
      "Share of physical memory (RAM) in use, not counting file cache the system can free, from the host's last report, updated about once a minute; below, its total RAM. Amber above 90%, red above 95%.",
      "The host's health by the rules its Needs attention card follows: Unhealthy when something is critical (a filesystem or memory past 95%), Degraded when something needs a look, Not reporting when nothing has arrived for 15 minutes. Below, the reason.",
      "When the host last started, from the uptime its collector reports (system.uptime). A reboot moves it.",
    ],
  "Common/Types/Host/HostHealth.ts": [
    "Collector config failed",
    "Collector error",
    "Config failed",
    "Degraded",
    "Failed",
    "Healthy",
    "15-minute load {{load}} on {{count}} cores",
    "Memory {{percent}} used",
    "No data yet",
    "Not reporting",
    "Reporting",
    "Starting",
    "Swap {{percent}} used",
    "Unhealthy",
    "{{count}} failed systemd units",
    "{{mount}} {{percent}} full",
    "{{mount}}: {{percent}} of inodes used",
    "{{percent}} full",
    "{{percent}} of inodes used",
  ],
};

// The one forms of the counts above, as their parts write them.
const ONE_FORMS: Record<string, string> = {
  "+{{count}} more": "+{{count}} more",
  "{{count}} cores": "{{count}} core",
  "across {{count}} cores": "across {{count}} core",
  "{{percent}}% of {{count}} cores": "{{percent}}% of {{count}} core",
  "15-minute load {{load}} on {{count}} cores":
    "15-minute load {{load}} on {{count}} core",
  "{{count}} failed systemd units": "{{count}} failed systemd unit",
};

// Languages without a "one" form never show a _one key.
const NO_ONE_FORM: Array<string> = ["ja", "ko", "zh-CN", "zh-TW"];

function everyKey(): Array<string> {
  const keys: Array<string> = [];

  for (const sentences of Object.values(PART_SENTENCES)) {
    for (const sentence of sentences) {
      if (!keys.includes(sentence)) {
        keys.push(sentence);
      }

      if (ONE_FORMS[sentence] && !keys.includes(`${sentence}_one`)) {
        keys.push(`${sentence}_one`);
      }
    }
  }

  return keys;
}

// A value set apart from a right-to-left sentence (FSI ... PDI).
function isolated(value: string): string {
  return `⁨${value}⁩`;
}

function fill(sentence: string, values: Record<string, string>): string {
  let filled: string = sentence;
  for (const name of Object.keys(values)) {
    filled = filled.split(`{{${name}}}`).join(values[name] as string);
  }
  return filled;
}

const NOW: Date = new Date();
const GIB: number = 1024 * 1024 * 1024;

// A reporting host whose /var is full and whose memory is short.
function busyHost(): Host {
  return Object.assign(new Host(), {
    _id: "10000000-0000-4000-8000-0000000000d1",
    name: "db-01",
    otelCollectorStatus: "connected",
    lastSeenAt: new Date(NOW.getTime() - 60_000),
    readingsUpdatedAt: new Date(NOW.getTime() - 60_000),
    cpuCores: 4,
    totalMemoryBytes: 8 * GIB,
    latestCpuPercent: 40,
    latestMemoryPercent: 92,
    latestDiskPercent: 97,
    latestDiskMountpoint: "/var/lib/postgresql",
  });
}

async function readIn(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

function draw(element: ReactElement): void {
  render(element);
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {
    en: { translation: readLocale("en") },
  };

  for (const language of LANGUAGES) {
    resources[language] = { translation: readLocale(language) };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
  });
});

afterEach(async () => {
  cleanup();
  await readIn("en");
});

describe("the Hosts pages in every language", () => {
  test("every listed sentence is still in the part that writes it", () => {
    const missing: Array<string> = [];

    for (const [part, sentences] of Object.entries(PART_SENTENCES)) {
      const code: string = fs.readFileSync(path.join(PACKAGES, part), "utf8");

      for (const sentence of sentences) {
        if (!code.includes(JSON.stringify(sentence))) {
          missing.push(`${part}: ${sentence}`);
        }

        const one: string | undefined = ONE_FORMS[sentence];

        if (one && !code.includes(JSON.stringify(one))) {
          missing.push(`${part}: ${one}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  test("en.json holds every sentence and its one form as the parts write them", () => {
    const english: Record<string, string> = readLocale("en");

    for (const key of everyKey()) {
      expect({ key, defined: english[key] !== undefined }).toEqual({
        key,
        defined: true,
      });
    }

    for (const [sentence, one] of Object.entries(ONE_FORMS)) {
      expect(english[`${sentence}_one`]).toBe(one);
    }
  });

  test.each(LANGUAGES)(
    "%s words every sentence of the pages",
    (language: string) => {
      const english: Record<string, string> = readLocale("en");
      const locale: Record<string, string> = readLocale(language);
      const excused: Set<string> = sameAsEnglish(language);
      const stillEnglish: Array<string> = everyKey().filter(
        (key: string): boolean => {
          if (key.endsWith("_one") && NO_ONE_FORM.includes(language)) {
            return false;
          }

          return (
            locale[key] === english[key] && !excused.has(english[key] || "")
          );
        },
      );

      expect(stillEnglish).toEqual([]);
    },
  );
});

describe("a host's cells in German and in Persian", () => {
  test("German: the health word, its reason and the RAM it is a share of", async () => {
    await readIn("de");
    const german: Record<string, string> = readLocale("de");

    draw(<HostStatusCell host={busyHost()} now={NOW} />);
    expect(screen.getByTestId("host-status")).toHaveTextContent(
      german["Unhealthy"] as string,
    );
    expect(screen.getByTestId("host-status-reason").textContent).toContain(
      fill(german["{{mount}} {{percent}} full"] as string, {
        mount: "/var/lib/postgresql",
        percent: "97\u00A0%",
      }),
    );
    cleanup();

    draw(<HostUsageCell host={busyHost()} kind="memory" now={NOW} />);
    expect(screen.getByTestId("host-usage-memory")).toHaveTextContent(
      fill(german["of {{total}}"] as string, { total: "8.0 GiB" }),
    );
  });

  test("Persian: a mount, a size and a share set apart from the sentence around them", async () => {
    await readIn("fa");
    const persian: Record<string, string> = readLocale("fa");

    draw(<HostStatusCell host={busyHost()} now={NOW} />);
    expect(screen.getByTestId("host-status-reason").textContent).toContain(
      fill(persian["{{mount}} {{percent}} full"] as string, {
        mount: isolated("/var/lib/postgresql"),
        percent: isolated("۹۷٪"),
      }),
    );
    cleanup();

    draw(<HostUsageCell host={busyHost()} kind="memory" now={NOW} />);
    expect(screen.getByTestId("host-usage-memory")).toHaveTextContent(
      fill(persian["of {{total}}"] as string, {
        total: isolated("8.0 GiB"),
      }),
    );
    cleanup();

    // The mount reads left to right, cut short at its own end.
    draw(<HostUsageCell host={busyHost()} kind="disk" now={NOW} />);
    const mount: HTMLElement = screen.getByTestId("host-usage-mount");
    expect(mount).toHaveAttribute("dir", "ltr");
    expect(mount.className).toContain("text-end");
    expect(mount).toHaveAttribute("title", "/var/lib/postgresql");
  });

  test("English: a mount on an English page needs no direction of its own", async () => {
    draw(<HostUsageCell host={busyHost()} kind="disk" now={NOW} />);
    const mount: HTMLElement = screen.getByTestId("host-usage-mount");
    expect(mount).not.toHaveAttribute("dir");
    expect(mount.className).not.toContain("text-end");
  });
});
