import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import fs from "fs";
import path from "path";
import React from "react";
import GlobalProbeStatusElement, {
  GLOBAL_PROBE_BEHIND_BY,
  GLOBAL_PROBE_REPORTING_MINUTES,
  GLOBAL_PROBE_STATUS_WORDS,
  GlobalProbeStatus,
  getGlobalProbeBehindBy,
  getGlobalProbeStatus,
} from "../../../../App/FeatureSet/AdminDashboard/src/Components/Probe/GlobalProbeStatus";
import Probe from "../../../Models/DatabaseModels/Probe";
import {
  BEHIND_AFTER_MS,
  ProbeBehindBy,
  ProbeBehindByUnit,
} from "../../../Types/Probe/ProbeBehind";
import { PluralTemplate } from "../../../UI/Utils/TranslateTemplate";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
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
 *
 * On 27 November 2026 both of OneUptime Cloud's global probes were handed
 * nothing to check for twelve hours, and Behind read the same as for a
 * probe a minute late. The status says how far behind now ("Behind by 11
 * hours"), in the Dashboard's words for it.
 */

const ADMIN: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/AdminDashboard/src",
);
const LOCALES_DIR: string = path.join(ADMIN, "Locales");
const DASHBOARD_LOCALES_DIR: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

type Locale = Record<string, unknown>;

function readLocale(locale: string): Locale {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Locale;
}

/*
 * The Dashboard's words for these keys in a language, read off its locale
 * file's lines: each file is megabytes, and parsing all eighteen took most
 * of a minute. A key's line is `  "key": "value",`; searched from the end,
 * where keys added lately are.
 */
function readDashboardWords(
  locale: string,
  keys: Array<string>,
): Record<string, string | undefined> {
  const text: string = fs.readFileSync(
    path.join(DASHBOARD_LOCALES_DIR, `${locale}.json`),
    "utf8",
  );
  const words: Record<string, string | undefined> = {};

  for (const key of keys) {
    const start: string = `\n  ${JSON.stringify(key)}: `;
    const at: number = text.lastIndexOf(start);

    if (at < 0) {
      words[key] = undefined;
      continue;
    }

    const end: number = text.indexOf("\n", at + start.length);
    const value: string = text
      .slice(at + start.length, end < 0 ? undefined : end)
      .replace(/,\s*$/, "");

    words[key] = JSON.parse(value) as string;
  }

  return words;
}

const NOW: Date = new Date("2026-11-18T09:10:00.000Z");
const MINUTE: number = 60 * 1000;

function probe(data: {
  lastAliveMinutesAgo?: number | null;
  lateSince?: Date | null;
  lastLateAt?: Date | null;
  // When the longest-waiting check was due, at the latest late reading.
  lastLateDueAt?: Date | null;
}): Probe {
  const model: Probe = new Probe();

  if (data.lastAliveMinutesAgo !== null) {
    model.lastAlive = new Date(
      NOW.getTime() - (data.lastAliveMinutesAgo ?? 0) * MINUTE,
    );
  }

  if (data.lateSince) {
    model.checksLateSince = data.lateSince;
  }

  if (data.lastLateAt) {
    model.checksLastLateAt = data.lastLateAt;
  }

  if (data.lastLateDueAt) {
    model.checksLastLateDueAt = data.lastLateDueAt;
  }

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

/*
 * #9499: a global probe whose network devices wait past their poll time
 * is Behind too, and OneUptime Health says so in a finding of its own.
 */
describe("a global probe behind on its network devices", () => {
  test("is Behind, as one behind on its monitors is", () => {
    const behind: Probe = probe({ lastAliveMinutesAgo: 1 });
    behind.devicePollsLateSince = new Date(NOW.getTime() - 3 * MINUTE);
    behind.devicePollsLastLateAt = new Date(NOW.getTime() - 30 * 1000);

    expect(getGlobalProbeStatus(behind, NOW)).toBe(GlobalProbeStatus.Behind);
  });

  test("one late reading of its devices is not yet behind", () => {
    const once: Probe = probe({ lastAliveMinutesAgo: 1 });
    once.devicePollsLateSince = new Date(NOW.getTime() - 30 * 1000);
    once.devicePollsLastLateAt = new Date(NOW.getTime() - 30 * 1000);

    expect(getGlobalProbeStatus(once, NOW)).toBe(GlobalProbeStatus.Connected);
  });

  test.each(["Pages/Health/Probes.tsx", "Pages/Settings/Probes/Index.tsx"])(
    "%s reads what says it is behind on its devices",
    (page: string) => {
      const source: string = fs.readFileSync(path.join(ADMIN, page), "utf8");

      expect(source).toMatch(
        /selectMoreFields=\{\{[^}]*devicePollsLateSince: true/,
      );
      expect(source).toMatch(
        /selectMoreFields=\{\{[^}]*devicePollsLastLateAt: true/,
      );
    },
  );

  test.each(["Pages/Health/Probes.tsx", "Pages/Settings/Probes/Index.tsx"])(
    "%s reads when the longest-waiting check and device poll were due: how far behind",
    (page: string) => {
      const source: string = fs.readFileSync(path.join(ADMIN, page), "utf8");

      expect(source).toMatch(
        /selectMoreFields=\{\{[^}]*checksLastLateAt: true,\s*checksLastLateDueAt: true,/,
      );
      expect(source).toMatch(
        /selectMoreFields=\{\{[^}]*devicePollsLastLateAt: true,\s*devicePollsLastLateDueAt: true,/,
      );
    },
  );
});

/*
 * HOW FAR BEHIND, AS THE STATUS SAYS IT: how long the probe's
 * longest-waiting monitor check, or network device poll, whichever is
 * further behind, had waited past its time at the latest reading.
 */
describe("how far behind a global probe is, in its status", () => {
  const SECOND: number = 1000;
  const HOUR: number = 60 * MINUTE;

  // Behind, connected now, its latest late reading a moment ago.
  function behindNow(data: {
    behindBy?: number | null;
    devicesBehindBy?: number | null;
  }): Probe {
    const model: Probe = new Probe();
    model.lastAlive = new Date();
    model.checksLastLateAt = new Date();
    model.checksLateSince = new Date(Date.now() - 20 * MINUTE);

    if (data.behindBy !== undefined && data.behindBy !== null) {
      model.checksLastLateDueAt = new Date(
        model.checksLastLateAt.getTime() - data.behindBy,
      );
    }

    if (data.devicesBehindBy !== undefined && data.devicesBehindBy !== null) {
      model.devicePollsLastLateAt = new Date();
      model.devicePollsLateSince = new Date(Date.now() - 4 * HOUR);
      model.devicePollsLastLateDueAt = new Date(
        model.devicePollsLastLateAt.getTime() - data.devicesBehindBy,
      );
    }

    return model;
  }

  async function draw(model: Probe, language: string = "en"): Promise<string> {
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

    render(
      <I18nextProvider i18n={instance}>
        <GlobalProbeStatusElement probe={model} />
      </I18nextProvider>,
    );

    await act(async () => {
      await Promise.resolve();
    });

    return withoutIsolateMarks(screen.getByRole("status").textContent || "");
  }

  test("a probe whose longest-waiting check had waited 15 minutes is Behind by 15 minutes, in amber", async () => {
    // The figure is held to its word by a no-break space.
    expect(await draw(behindNow({ behindBy: 15 * MINUTE }))).toMatch(
      /^Behind by 15\sminutes$/,
    );

    const dot: HTMLElement = screen.getAllByTestId("status-bubble-dot")[0]!;
    expect((dot.firstElementChild as HTMLElement).style.backgroundColor).toBe(
      "rgb(255, 191, 83)",
    );
  });

  const AMOUNTS: Array<[number, ProbeBehindBy]> = [
    [61 * SECOND, { unit: "minute", count: 1 }],
    [59 * MINUTE, { unit: "minute", count: 59 }],
    [HOUR, { unit: "hour", count: 1 }],
    // 2026-11-27: handed nothing from 04:09:46, read at 16:00.
    [11 * HOUR + 50 * MINUTE, { unit: "hour", count: 11 }],
    [3 * 24 * HOUR, { unit: "day", count: 3 }],
  ];

  test.each(AMOUNTS)(
    "late by %d ms, it is behind by %j",
    (behindBy: number, amount: ProbeBehindBy) => {
      expect(getGlobalProbeBehindBy(behindNow({ behindBy }))).toEqual(amount);
    },
  );

  test("in the largest whole unit, as the Dashboard says it", async () => {
    expect(
      await draw(behindNow({ behindBy: 11 * HOUR + 50 * MINUTE })),
    ).toMatch(/^Behind by 11\shours$/);
  });

  test("behind on both, it is as far behind as the further of the two", async () => {
    expect(
      await draw(
        behindNow({ behindBy: 15 * MINUTE, devicesBehindBy: 3 * HOUR }),
      ),
    ).toMatch(/^Behind by 3\shours$/);
  });

  test("plain Behind while no due time is kept yet - the probe's first reading after an upgrade", async () => {
    expect(getGlobalProbeBehindBy(behindNow({}))).toBeNull();
    expect(await draw(behindNow({}))).toBe("Behind");
  });

  test("a probe that keeps up, or stopped reporting, says nothing of how far behind", async () => {
    const once: Date = new Date();
    const keepsUp: Probe = probe({
      lastAliveMinutesAgo: 0,
      lateSince: once,
      lastLateAt: once,
      lastLateDueAt: new Date(once.getTime() - 15 * MINUTE),
    });
    keepsUp.lastAlive = new Date();

    expect(await draw(keepsUp)).toBe("Connected");
    cleanup();

    const stopped: Probe = behindNow({ behindBy: 15 * MINUTE });
    stopped.lastAlive = new Date(Date.now() - 30 * MINUTE);

    expect(await draw(stopped)).toBe("Disconnected");
  });

  test.each(["de", "fa", "ja"])(
    "how far behind reads in %s",
    async (language: string) => {
      const text: string = await draw(
        behindNow({ behindBy: 3 * HOUR }),
        language,
      );
      const words: string = String(
        readLocale(language)[GLOBAL_PROBE_BEHIND_BY.hour.other],
      );

      for (const part of words.split("{{count}}")) {
        expect(text).toContain(part.trim());
      }
      // The count in the language's own digits ("۳" in Persian).
      expect(text).toContain(new Intl.NumberFormat(language).format(3));
      expect(text).not.toContain("Behind by");
    },
  );

  test("a master admin reads the words a customer reads of the same probe", () => {
    const units: Array<ProbeBehindByUnit> = ["minute", "hour", "day"];

    const keys: Array<string> = units.flatMap(
      (unit: ProbeBehindByUnit): Array<string> => {
        const template: PluralTemplate = GLOBAL_PROBE_BEHIND_BY[unit];

        return [template.other, `${template.other}_one`];
      },
    );

    for (const language of ["en", ...ADMIN_DASHBOARD_LANGUAGES]) {
      const admin: Locale = readLocale(language);
      const dashboard: Record<string, string | undefined> = readDashboardWords(
        language,
        keys,
      );

      for (const key of keys) {
        expect(typeof dashboard[key]).toBe("string");
        expect({ language, key, admin: admin[key] }).toEqual({
          language,
          key,
          admin: dashboard[key],
        });
      }
    }
  });
});

describe("in every language the Admin Dashboard speaks", () => {
  const behindWords: { title: string; words: string; fix: string } =
    INSTALLATION_HEALTH_WORDS[InstallationHealthFindingId.GlobalProbeBehind];
  const devicesBehindWords: { title: string; words: string; fix: string } =
    INSTALLATION_HEALTH_WORDS[
      InstallationHealthFindingId.GlobalProbeDevicesBehind
    ];

  const WORDS: Array<string> = [
    ...Object.values(GLOBAL_PROBE_STATUS_WORDS),
    behindWords.title,
    behindWords.words,
    behindWords.fix,
    devicesBehindWords.title,
    devicesBehindWords.words,
    devicesBehindWords.fix,
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

      // How far behind: each unit's sentence for many, and for one.
      for (const template of Object.values(GLOBAL_PROBE_BEHIND_BY)) {
        expect(english[template.other]).toBe(template.other);
        expect(english[`${template.other}_one`]).toBe(template.one);

        for (const key of [template.other, `${template.other}_one`]) {
          const words: unknown = locale[key];

          expect({ language, key, has: typeof words }).toEqual({
            language,
            key,
            has: "string",
          });
          expect(getTemplatePlaceholders(String(words))).toEqual(["count"]);
          expect({ language, key, same: words === english[key] }).toEqual({
            language,
            key,
            same: false,
          });
        }
      }

      // The settings are named as they are written, in every language.
      const fix: string = String(locale[behindWords.fix]);
      expect(fix).toContain("GLOBAL_PROBE_1_MONITORING_WORKERS");
      expect(fix).toContain("config.env");
      expect(fix).toContain("monitoringWorkers");

      const devicesFix: string = String(locale[devicesBehindWords.fix]);
      expect(devicesFix).toContain(
        "GLOBAL_PROBE_1_NETWORK_DEVICE_POLL_CONCURRENCY",
      );
      expect(devicesFix).toContain("config.env");
      expect(devicesFix).toContain("networkDevicePollConcurrency");
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
