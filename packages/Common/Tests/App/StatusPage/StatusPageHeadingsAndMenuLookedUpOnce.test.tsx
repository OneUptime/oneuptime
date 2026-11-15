import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement } from "react";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { Location } from "react-router-dom";
import StatusPagePage from "../../../../App/FeatureSet/StatusPage/src/Components/Page/Page";
import MonitorOverview from "../../../../App/FeatureSet/StatusPage/src/Components/Monitor/MonitorOverview";
import SubscribeSideMenu from "../../../../App/FeatureSet/StatusPage/src/Pages/Subscribe/SideMenu";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import Color from "../../../Types/Color";
import { SIDE_MENU_ITEM_TITLE_TEST_ID } from "../../../UI/Components/SideMenu/SideMenuEntryState";
import Navigation from "../../../UI/Utils/Navigation";

/*
 * A STATUS PAGE'S HEADINGS, ITS SUBSCRIBE MENU AND A RESOURCE'S TOOLTIP,
 * EACH READ ONCE (#8224, #8225, #8226).
 *
 * A status page words its headings (t("incidents.title")) and its Subscribe
 * menu (t("subscribe.menu.email")) itself, and Page and SideMenuItem looked
 * them up again; a resource's tooltip, which the status page's owner
 * writes, was looked up at all. No status page language shows a wrong word
 * with today's files; here each of those words is made a key that reads
 * "Looked up twice", and each place must read the page's word. These draw
 * them with the status page's own Spanish, Dutch and Persian.
 */

const TWICE: string = "Looked up twice";

type Locale = Record<string, unknown>;

function readStatusPageLocale(language: string): Locale {
  return JSON.parse(
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "App",
        "FeatureSet",
        "StatusPage",
        "src",
        "Locales",
        `${language}.json`,
      ),
      "utf8",
    ),
  ) as Locale;
}

const MENU_KEYS: Array<string> = [
  "email",
  "sms",
  "slack",
  "microsoftTeams",
  "webhooks",
];

// What a status page's owner wrote for a resource's tooltip: an English key.
const OWNER_TOOLTIP: string = "Payments API";

async function inLanguage(language: string, locale: Locale): Promise<i18n> {
  const translation: i18n = createInstance();

  await translation.use(initReactI18next).init({
    lng: language,
    fallbackLng: language,
    resources: { [language]: { translation: locale } },
    interpolation: { escapeValue: false },
  });

  return translation;
}

async function renderIn(
  translation: i18n,
  element: ReactElement,
): Promise<void> {
  await act(async () => {
    render(<I18nextProvider i18n={translation}>{element}</I18nextProvider>);
  });
}

beforeAll(() => {
  Element.prototype.scrollIntoView = (): void => {};
  Navigation.setLocation({
    pathname: "/subscribe/email",
    search: "",
    hash: "",
    state: null,
    key: "test",
  } as Location);
});

afterEach(() => {
  cleanup();
});

describe.each(["es", "nl", "fa"])("a status page in %s", (language: string) => {
  const LOCALE: Locale = readStatusPageLocale(language);
  const MENU: Record<string, string> = (LOCALE["subscribe"] as Locale)[
    "menu"
  ] as Record<string, string>;
  const INCIDENTS: string = (LOCALE["incidents"] as Record<string, string>)[
    "title"
  ]!;

  // The status page's words, each also a key that reads TWICE.
  const PROBED: Locale = {
    ...LOCALE,
    [INCIDENTS]: TWICE,
    [OWNER_TOOLTIP]: TWICE,
    ...Object.fromEntries(
      Object.values(MENU).map((word: string): [string, string] => {
        return [word, TWICE];
      }),
    ),
  };

  test("its heading, through the status page's Page, reads the page's word once", async () => {
    const translation: i18n = await inLanguage(language, PROBED);

    await renderIn(
      translation,
      <StatusPagePage
        title={translation.t("incidents.title") as string}
        isTitleTranslated={true}
      >
        <div />
      </StatusPagePage>,
    );

    expect(
      (screen.getByRole("heading", { level: 1 }).textContent || "").trim(),
    ).toBe(INCIDENTS);
    expect(screen.queryByText(TWICE)).toBeNull();
  });

  test("its Subscribe menu names each way to subscribe once", async () => {
    await renderIn(
      await inLanguage(language, PROBED),
      <SubscribeSideMenu
        isPreviewStatusPage={false}
        enableEmailSubscribers={true}
        enableSMSSubscribers={true}
        enableSlackSubscribers={true}
        enableMicrosoftTeamsSubscribers={true}
        enableWebhookSubscribers={true}
      />,
    );

    expect(
      screen
        .getAllByTestId(SIDE_MENU_ITEM_TITLE_TEST_ID)
        .map((title: HTMLElement): string => {
          return (title.textContent || "").trim();
        }),
    ).toEqual(
      MENU_KEYS.map((key: string): string => {
        return MENU[key]!;
      }),
    );
    expect(screen.queryByText(TWICE)).toBeNull();
  });

  test("a resource's tooltip reads as its owner wrote it, never looked up", async () => {
    const status: MonitorStatus = new MonitorStatus();

    status.name = "Operational";
    status.color = new Color("#10b981");

    await renderIn(
      await inLanguage(language, PROBED),
      <MonitorOverview
        monitorName="Payments"
        tooltip={OWNER_TOOLTIP}
        currentStatus={status}
        monitorStatusTimeline={[]}
        startDate={new Date("2026-11-01T00:00:00.000Z")}
        endDate={new Date("2026-11-15T00:00:00.000Z")}
        showHistoryChart={false}
        showCurrentStatus={false}
        showUptimePercent={false}
        statusPageHistoryChartBarColorRules={[]}
        downtimeMonitorStatuses={[]}
        defaultBarColor={new Color("#10b981")}
      />,
    );

    const trigger: Element | null =
      document.body.querySelector("div.ml-1") || null;

    expect(trigger).not.toBeNull();

    fireEvent.mouseEnter(trigger!);

    expect((screen.getByRole("tooltip").textContent || "").trim()).toBe(
      OWNER_TOOLTIP,
    );
  });
});
