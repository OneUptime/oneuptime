import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import fs from "fs";
import path from "path";
import React from "react";
import GlobalProbeStatusElement, {
  GLOBAL_PROBE_REPORTING_MINUTES,
  GLOBAL_PROBE_STATUS_WORDS,
  GlobalProbeStatus,
  getGlobalProbeStatus,
} from "../../../../App/FeatureSet/AdminDashboard/src/Components/Probe/GlobalProbeStatus";
import Probe from "../../../Models/DatabaseModels/Probe";
import { BEHIND_AFTER_MS } from "../../../Types/Probe/ProbeBehind";
import { getTemplatePlaceholders } from "../../../Types/Translator";
import InstallationHealthUtil, {
  INSTALLATION_HEALTH_WORDS,
  InstallationHealthFindingId,
} from "../../../Types/InstallationHealth/InstallationHealth";
import { ADMIN_DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

/*
 * A GLOBAL PROBE THAT IS BEHIND, IN THE ADMIN DASHBOARD (OneUptime issue
 * #9488).
 *
 * OneUptime Health > Global Probes and Settings > Global Probes each worked
 * out Connected from the probe's last check-in on their own. They share
 * GlobalProbeStatus now, which also says Behind: the probe reports, but its
 * monitors are checked later than their interval (Types/Probe/ProbeBehind).
 * Overview's What needs attention says since when, and what to do, in every
 * language the Admin Dashboard speaks.
 */

const ADMIN: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/AdminDashboard/src",
);
const LOCALES_DIR: string = path.join(ADMIN, "Locales");

type Locale = Record<string, unknown>;

function readLocale(locale: string): Locale {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Locale;
}

const NOW: Date = new Date("2026-11-18T09:10:00.000Z");
const MINUTE: number = 60 * 1000;

function probe(data: {
  lastAliveMinutesAgo?: number | null;
  lateSince?: Date | null;
  lastLateAt?: Date | null;
}): Probe {
  const model: Probe = new Probe();

  if (data.lastAliveMinutesAgo !== null) {
    model.lastAlive = new Date(
      NOW.getTime() - (data.lastAliveMinutesAgo ?? 0) * MINUTE,
    );
  }

  model.checksLateSince = data.lateSince || undefined;
  model.checksLastLateAt = data.lastLateAt || undefined;

  return model;
}

// Late at readings a few minutes apart: behind.
const BEHIND: { lateSince: Date; lastLateAt: Date } = {
  lateSince: new Date(NOW.getTime() - 4 * MINUTE),
  lastLateAt: new Date(NOW.getTime() - MINUTE),
};

afterEach(() => {
  cleanup();
});

describe("a global probe's status", () => {
  test("is Connected while it reported in the last five minutes and keeps up", () => {
    expect(GLOBAL_PROBE_REPORTING_MINUTES).toBe(5);
    expect(getGlobalProbeStatus(probe({ lastAliveMinutesAgo: 0 }), NOW)).toBe(
      GlobalProbeStatus.Connected,
    );
    expect(getGlobalProbeStatus(probe({ lastAliveMinutesAgo: 4 }), NOW)).toBe(
      GlobalProbeStatus.Connected,
    );
  });

  test("is Behind while it reports but its monitors are checked late", () => {
    expect(
      getGlobalProbeStatus(probe({ lastAliveMinutesAgo: 0, ...BEHIND }), NOW),
    ).toBe(GlobalProbeStatus.Behind);
  });

  test("one late reading is not yet behind", () => {
    const once: Date = new Date(NOW.getTime() - MINUTE);

    expect(
      getGlobalProbeStatus(
        probe({ lastAliveMinutesAgo: 0, lateSince: once, lastLateAt: once }),
        NOW,
      ),
    ).toBe(GlobalProbeStatus.Connected);
    expect(BEHIND_AFTER_MS).toBeLessThan(
      BEHIND.lastLateAt.getTime() - BEHIND.lateSince.getTime(),
    );
  });

  test("is Disconnected when it has not reported for five minutes, behind or not", () => {
    expect(getGlobalProbeStatus(probe({ lastAliveMinutesAgo: 5 }), NOW)).toBe(
      GlobalProbeStatus.Disconnected,
    );
    expect(
      getGlobalProbeStatus(probe({ lastAliveMinutesAgo: 30, ...BEHIND }), NOW),
    ).toBe(GlobalProbeStatus.Disconnected);
    expect(
      getGlobalProbeStatus(probe({ lastAliveMinutesAgo: null }), NOW),
    ).toBe(GlobalProbeStatus.Disconnected);
  });

  test("Behind is drawn in amber, not the red of a probe that stopped", async () => {
    const instance: i18n = createInstance();
    await instance.init({
      lng: "en",
      resources: { en: { translation: readLocale("en") } },
      interpolation: { escapeValue: false },
    });

    const behind: Probe = probe({ lastAliveMinutesAgo: 0, ...BEHIND });
    behind.lastAlive = new Date();
    behind.checksLastLateAt = new Date();
    behind.checksLateSince = new Date(Date.now() - 3 * MINUTE);

    render(
      <I18nextProvider i18n={instance}>
        <GlobalProbeStatusElement probe={behind} />
      </I18nextProvider>,
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("Behind")).toBeInTheDocument();
    const dot: HTMLElement = screen.getAllByTestId("status-bubble-dot")[0]!;
    expect((dot.firstElementChild as HTMLElement).style.backgroundColor).toBe(
      "rgb(255, 191, 83)",
    );
  });
});

describe("OneUptime Health > Global Probes and Settings > Global Probes", () => {
  const pages: Array<string> = [
    "Pages/Health/Probes.tsx",
    "Pages/Settings/Probes/Index.tsx",
  ];

  test.each(pages)(
    "%s draws the shared status and reads what it needs to say Behind",
    (page: string) => {
      const source: string = fs.readFileSync(path.join(ADMIN, page), "utf8");

      expect(source).toContain("<GlobalProbeStatusElement probe={item} />");
      expect(source).toMatch(/selectMoreFields=\{\{[^}]*checksLateSince: true/);
      expect(source).toMatch(
        /selectMoreFields=\{\{[^}]*checksLastLateAt: true/,
      );
      // Connected is no longer worked out on the page itself.
      expect(source).not.toContain("getNumberOfMinutesBetweenDates");
    },
  );
});

describe("in every language the Admin Dashboard speaks", () => {
  const behindWords: { title: string; words: string; fix: string } =
    INSTALLATION_HEALTH_WORDS[InstallationHealthFindingId.GlobalProbeBehind];

  const WORDS: Array<string> = [
    ...Object.values(GLOBAL_PROBE_STATUS_WORDS),
    behindWords.title,
    behindWords.words,
    behindWords.fix,
  ];

  test.each([...ADMIN_DASHBOARD_LANGUAGES])(
    "%s has the status and the finding in its own words",
    (language: string) => {
      const locale: Locale = readLocale(language);
      const english: Locale = readLocale("en");

      for (const words of WORDS) {
        expect({ words, english: english[words] }).toEqual({
          words,
          english: words,
        });
        expect({ language, words, has: typeof locale[words] }).toEqual({
          language,
          words,
          has: "string",
        });
        expect(getTemplatePlaceholders(String(locale[words])).sort()).toEqual(
          getTemplatePlaceholders(words).sort(),
        );
        expect({ language, words, same: locale[words] === words }).toEqual({
          language,
          words,
          same: false,
        });
      }

      // The settings are named as they are written, in every language.
      const fix: string = String(locale[behindWords.fix]);
      expect(fix).toContain("GLOBAL_PROBE_1_MONITORING_WORKERS");
      expect(fix).toContain("config.env");
      expect(fix).toContain("monitoringWorkers");
    },
  );

  test.each(["de", "fa", "ja"])(
    "Behind reads in %s",
    async (language: string) => {
      const instance: i18n = createInstance();
      await instance.init({
        lng: language,
        fallbackLng: "en",
        resources: {
          en: { translation: readLocale("en") },
          [language]: { translation: readLocale(language) },
        },
        interpolation: { escapeValue: false },
      });

      const behind: Probe = new Probe();
      behind.lastAlive = new Date();
      behind.checksLastLateAt = new Date();
      behind.checksLateSince = new Date(Date.now() - 3 * MINUTE);

      render(
        <I18nextProvider i18n={instance}>
          <GlobalProbeStatusElement probe={behind} />
        </I18nextProvider>,
      );

      await act(async () => {
        await Promise.resolve();
      });

      expect(
        screen.getByText(String(readLocale(language)["Behind"])),
      ).toBeInTheDocument();
    },
  );

  test("the finding is filled with the probe's name and when it fell behind", () => {
    const [finding] = InstallationHealthUtil.probeFindings({
      isPostgresConnected: true,
      isClickhouseConnected: true,
      isValkeyConnected: true,
      migrations: null,
      clickhouseDisks: [],
      queues: [],
      version: {
        current: "16.0.0",
        latest: null,
        isUpdateAvailable: false,
        isUpdateCheckDisabled: false,
      },
      serverSetup: null,
      globalProbesBehind: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          name: "Probe-1",
          since: "2026-11-18T09:06:00.000Z",
        },
      ],
    });

    expect(finding!.values).toEqual({
      probe: "Probe-1",
      time: "2026-11-18 09:06 UTC",
    });
  });
});
