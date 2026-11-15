import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE MONITOR'S BANNER WHILE MONITORING IS OFF, IN EVERY LANGUAGE (#7950).
 *
 * A monitor held by a manually declared incident explains why it is not
 * checked, and what to do: "We are not monitoring this monitor since it is
 * disabled because of an active incident. To enable active monitoring,
 * please resolve the incident." Only Arabic, Persian and Japanese worded
 * it: a German reader read it in English, under a German title, while the
 * same banner for a maintenance event (#7930) read in German. Every reason
 * the banner gives is worded in every language now.
 */

const getItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
    },
  };
});

import DisabledWarning, {
  getMonitoringOffNotice,
  MonitoringOffNotice,
  MonitoringOffReason,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/DisabledWarning";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import {
  DASHBOARD_LANGUAGES,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

const monitorWith: (data: Partial<Monitor>) => Monitor = (
  data: Partial<Monitor>,
): Monitor => {
  const monitor: Monitor = new Monitor();
  monitor.monitorType = MonitorType.API;
  Object.assign(monitor, data);
  return monitor;
};

// A monitor for each reason the banner gives.
const MONITOR_FOR_REASON: Record<MonitoringOffReason, Monitor> = {
  [MonitoringOffReason.TurnedOff]: monitorWith({
    disableActiveMonitoring: true,
  }),
  [MonitoringOffReason.ManualIncident]: monitorWith({
    disableActiveMonitoringBecauseOfManualIncident: true,
  }),
  [MonitoringOffReason.ScheduledMaintenance]: monitorWith({
    disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true,
  }),
};

const noticeFor: (reason: MonitoringOffReason) => MonitoringOffNotice = (
  reason: MonitoringOffReason,
): MonitoringOffNotice => {
  return getMonitoringOffNotice(MONITOR_FOR_REASON[reason])!;
};

const REASONS: ReadonlyArray<MonitoringOffReason> =
  Object.values(MonitoringOffReason);

/*
 * The languages whose words leave `key` in English: missing, empty or the
 * English itself. A banner's sentence is OneUptime's own, never a name a
 * language keeps.
 */
const languagesLeavingInEnglish: (
  key: string,
  localeOf: (language: string) => Record<string, string>,
) => Array<string> = (
  key: string,
  localeOf: (language: string) => Record<string, string>,
): Array<string> => {
  return DASHBOARD_LANGUAGES.filter((language: string): boolean => {
    const value: string | undefined = localeOf(language)[key];

    return value === undefined || !value.trim() || value === key;
  });
};

describe("every reason the banner gives, in every language", () => {
  test("each reason has its own notice, its words keys of the Dashboard", () => {
    expect(REASONS).toHaveLength(3);

    for (const reason of REASONS) {
      const notice: MonitoringOffNotice = noticeFor(reason);

      expect(notice.reason).toBe(reason);

      for (const key of [notice.title, notice.message]) {
        expect({ reason, key, isKey: readDashboardLocale("en")[key] }).toEqual({
          reason,
          key,
          isKey: key,
        });
      }
    }
  });

  test.each(REASONS)(
    "%s: its title and its message are worded in all 17 translations",
    (reason: MonitoringOffReason) => {
      const notice: MonitoringOffNotice = noticeFor(reason);

      expect(DASHBOARD_LANGUAGES).toHaveLength(17);
      expect(
        languagesLeavingInEnglish(notice.title, readDashboardLocale),
      ).toEqual([]);
      expect(
        languagesLeavingInEnglish(notice.message, readDashboardLocale),
      ).toEqual([]);
    },
  );

  // The incident's sentence, in the shape of the maintenance one beside it.
  test.each([
    [
      "de",
      "wegen eines aktiven Vorfalls deaktiviert",
      "beheben Sie bitte den Vorfall",
    ],
    ["fr", "en raison d'un incident actif", "veuillez résoudre l'incident"],
    ["es", "por un incidente activo", "resuelve el incidente"],
    ["ko", "활성 인시던트 때문에", "인시던트를 해결하세요"],
    ["zh-CN", "由于存在活动事件", "请解决该事件"],
    ["ru", "из-за активного инцидента", "устраните инцидент"],
  ])(
    "%s says why, and what to do, in its own words",
    (language: string, why: string, whatToDo: string) => {
      const message: string =
        readDashboardLocale(language)[
          noticeFor(MonitoringOffReason.ManualIncident).message
        ]!;

      expect(message).toContain(why);
      expect(message).toContain(whatToDo);
    },
  );

  test("negative control: the English put back in de.json is caught, and names de", () => {
    const key: string = noticeFor(MonitoringOffReason.ManualIncident).message;

    expect(
      languagesLeavingInEnglish(key, (language: string) => {
        const words: Record<string, string> = readDashboardLocale(language);

        return language === "de" ? { ...words, [key]: key } : words;
      }),
    ).toEqual(["de"]);
  });
});

/*
 * The banner on the page, through the Dashboard's i18next: a monitor held
 * by an incident, in German, Arabic and Persian.
 */
const PAGE_LANGUAGES: ReadonlyArray<string> = ["de", "ar", "fa"];

async function inLanguage(language: string): Promise<void> {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage(language);
  });
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: Object.fromEntries(
      PAGE_LANGUAGES.map((language: string) => {
        return [language, { translation: readDashboardLocale(language) }];
      }),
    ),
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(() => {
  cleanup();
  getItemMock.mockReset();
});

afterAll(async () => {
  await inLanguage("en");
});

describe("the banner of a monitor held by an incident", () => {
  const ENGLISH_MESSAGE: string = noticeFor(
    MonitoringOffReason.ManualIncident,
  ).message;

  test("in English, it reads as it always has (the control)", async () => {
    await inLanguage("en");
    getItemMock.mockResolvedValue(
      MONITOR_FOR_REASON[MonitoringOffReason.ManualIncident] as never,
    );

    render(
      <DisabledWarning
        monitorId={new ObjectID("11111111-1111-4111-8111-111111111111")}
      />,
    );
    await flush();

    expect(screen.getByText(ENGLISH_MESSAGE)).toBeInTheDocument();
  });

  test.each(PAGE_LANGUAGES)(
    "%s: its title and its reason in the reader's language, no English left",
    async (language: string) => {
      await inLanguage(language);
      getItemMock.mockResolvedValue(
        MONITOR_FOR_REASON[MonitoringOffReason.ManualIncident] as never,
      );

      const words: Record<string, string> = readDashboardLocale(language);
      const notice: MonitoringOffNotice = noticeFor(
        MonitoringOffReason.ManualIncident,
      );

      render(
        <DisabledWarning
          monitorId={new ObjectID("11111111-1111-4111-8111-111111111111")}
        />,
      );
      await flush();

      expect(screen.getByText(words[notice.message]!)).toBeInTheDocument();
      expect(screen.getByText(words[notice.title]!)).toBeInTheDocument();
      expect(document.body.textContent || "").not.toContain(
        "We are not monitoring",
      );
      expect(document.body.textContent || "").not.toContain(
        "resolve the incident",
      );
    },
  );
});
