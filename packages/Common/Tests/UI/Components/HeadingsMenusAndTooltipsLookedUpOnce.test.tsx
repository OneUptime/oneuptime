import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import { Location } from "react-router-dom";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Route from "../../../Types/API/Route";
import Link from "../../../Types/Link";
import ObjectID from "../../../Types/ObjectID";
import Button from "../../../UI/Components/Button/Button";
import ModelPage from "../../../UI/Components/Page/ModelPage";
import Page, {
  PAGE_RECORD_TITLE_TEST_IDS,
} from "../../../UI/Components/Page/Page";
import { getCrumbTitleEnglish } from "../../../UI/Components/Page/RecordNameInTrail";
import SideMenu from "../../../UI/Components/SideMenu/SideMenu";
import { SIDE_MENU_ITEM_TITLE_TEST_ID } from "../../../UI/Components/SideMenu/SideMenuEntryState";
import SideMenuItem from "../../../UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "../../../UI/Components/SideMenu/SideMenuSection";
import Tooltip from "../../../UI/Components/Tooltip/Tooltip";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";

/*
 * A PAGE'S HEADING, A SIDE MENU'S TITLES AND A TOOLTIP'S TEXT ARE LOOKED UP
 * ONCE (#8224, #8225, #8226).
 *
 * Page looked its title up, so did SideMenuSection its title, SideMenuItem
 * its links' titles, the phone's menu summary the lit entry's, and Tooltip
 * its text - and none could be told the page had put them in the reader's
 * words already. A page that had (the Admin Dashboard's t("pages.…"), a
 * status page's t("incidents.title"), a sentence around a value, Button's
 * own looked-up tooltip) had them looked up twice: where a translation is
 * itself an English key, the reader saw the translation of the translation.
 *
 * Each now takes is<Prop>Translated (Page, ModelPage, PageRecordTitle and
 * SideMenuSection: isTitleTranslated; a side menu's Link: isTitleTranslated
 * and isRecordName; Tooltip: isTextTranslated) and draws a text it is told
 * is translated as given.
 *
 * These draw them in the Dashboard's own words, as it ships:
 *
 * - Spanish says "Red" for Network, and "Rojo" for "Red";
 * - Dutch says "Start" for Home, and "Starten" for "Start";
 * - Persian says "شبکه" for Network; no Persian word is a key of its own,
 *   so its case makes "شبکه" one, which reads "قرمز" (the colour red).
 */

interface Language {
  code: string;
  english: string;
  // The language's word for it: what the reader must see.
  word: string;
  // That word looked up again: what they must never see.
  twice: string;
  extra?: Record<string, string>;
}

const LANGUAGES: Array<Language> = [
  { code: "es", english: "Network", word: "Red", twice: "Rojo" },
  { code: "nl", english: "Home", word: "Start", twice: "Starten" },
  {
    code: "fa",
    english: "Network",
    word: "شبکه",
    twice: "قرمز",
    extra: { شبکه: "قرمز" },
  },
];

/*
 * A record whose heading, in each language, is itself a key: the heading
 * ModelPage worded, looked up again, would read the language's twice.
 */
const PROBE_RECORD: string = "probe-record";

const instances: Map<string, i18n> = new Map();

function dashboardIn(language: Language): i18n {
  const cached: i18n | undefined = instances.get(language.code);

  if (cached) {
    return cached;
  }

  const instance: i18n = createInstance();

  instance.init({
    lng: language.code,
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      [language.code]: {
        translation: {
          ...readDashboardLocale(language.code),
          ...(language.extra || {}),
          [`${language.word} - ${PROBE_RECORD}`]: language.twice,
        },
      },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
    initImmediate: false,
  });

  instances.set(language.code, instance);

  return instance;
}

function lookUp(language: Language, text: string): string {
  return dashboardIn(language).t(text, { defaultValue: text }) as string;
}

function renderIn(language: Language, element: ReactElement): void {
  render(
    <I18nextProvider i18n={dashboardIn(language)}>{element}</I18nextProvider>,
  );
}

function setViewportWidth(width: number): void {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

const DESKTOP_WIDTH: number = 1280;
const PHONE_WIDTH: number = 375;

function goTo(pathname: string): void {
  window.history.pushState({}, "", pathname);
  Navigation.setLocation({
    pathname,
    search: "",
    hash: "",
    state: null,
    key: "test",
  } as Location);
}

const HERE: string = "/dashboard/settings/here";
const ELSEWHERE: string = "/dashboard/settings/elsewhere";

function heading(): string {
  return (screen.getByRole("heading", { level: 1 }).textContent || "").trim();
}

// A side menu's entries, by their titles as drawn.
function menuTitles(): Array<string> {
  return screen
    .getAllByTestId(SIDE_MENU_ITEM_TITLE_TEST_ID)
    .map((title: HTMLElement): string => {
      return (title.textContent || "").trim();
    });
}

// The phone's summary of where the reader is.
function phoneSummary(): HTMLElement {
  return within(screen.getByTestId("mobile-sidemenu-toggle")).getByRole(
    "heading",
    { level: 3 },
  );
}

// A record a page is about, named like an English key: "Network".
function fakeModelAPI(name: string): typeof ModelAPI {
  return {
    getItem: async (): Promise<Monitor> => {
      const monitor: Monitor = new Monitor();

      monitor.name = name;

      return monitor;
    },
  } as unknown as typeof ModelAPI;
}

async function settle(): Promise<void> {
  for (let index: number = 0; index < 10; index++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeAll(() => {
  Element.prototype.scrollIntoView = (): void => {};
});

beforeEach(() => {
  window.localStorage.clear();
  setViewportWidth(DESKTOP_WIDTH);
  goTo(ELSEWHERE);
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  setViewportWidth(DESKTOP_WIDTH);
});

describe.each(LANGUAGES)("in $code", (language: Language) => {
  const { english, word, twice } = language;

  test(`the words these cases lean on: ${english} is ${word}, and ${word} looked up again is ${twice}`, () => {
    expect(lookUp(language, english)).toBe(word);
    expect(lookUp(language, word)).toBe(twice);
  });

  describe("a page's heading", () => {
    test("looks English up once", () => {
      renderIn(
        language,
        <Page title={english}>
          <div />
        </Page>,
      );

      expect(heading()).toBe(word);
    });

    test(`draws a title it is told is translated as given: ${word}, never ${twice}`, () => {
      renderIn(
        language,
        <Page title={word} isTitleTranslated={true}>
          <div />
        </Page>,
      );

      expect(heading()).toBe(word);
      expect(document.body).not.toHaveTextContent(twice);
    });

    test("names the browser tab once, when there is no trail to name it by", async () => {
      await act(async () => {
        renderIn(
          language,
          <Page title={word} isTitleTranslated={true}>
            <div />
          </Page>,
        );
      });

      expect(document.title.endsWith(`| ${word}`)).toBe(true);
      expect(document.title).not.toContain(twice);
    });

    test("draws a record's heading with a translated title as given, the name as typed", () => {
      renderIn(
        language,
        <Page
          title={`${word} - sw-core-01`}
          isTitleTranslated={true}
          recordTitle={{
            title: word,
            isTitleTranslated: true,
            name: "sw-core-01",
          }}
        >
          <div />
        </Page>,
      );

      const recordHeading: HTMLElement = screen.getByTestId(
        PAGE_RECORD_TITLE_TEST_IDS.heading,
      );

      expect(recordHeading).toHaveTextContent(`${word} - sw-core-01`);
      expect(recordHeading).not.toHaveTextContent(twice);
      expect(recordHeading.getAttribute("title")).toBe(`${word} - sw-core-01`);
      expect(
        screen.getByTestId(PAGE_RECORD_TITLE_TEST_IDS.name),
      ).toHaveTextContent("sw-core-01");
    });

    test("looks a record's English title up once", () => {
      renderIn(
        language,
        <Page
          title={english}
          recordTitle={{ title: english, name: "sw-core-01" }}
        >
          <div />
        </Page>,
      );

      expect(
        screen.getByTestId(PAGE_RECORD_TITLE_TEST_IDS.heading),
      ).toHaveTextContent(`${word} - sw-core-01`);
    });
  });

  describe("a record's page (ModelPage)", () => {
    test(`while it reads the record, and once it has: ${word}, never ${twice}`, async () => {
      renderIn(
        language,
        <ModelPage
          title={word}
          isTitleTranslated={true}
          modelType={Monitor}
          modelId={new ObjectID("5f8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d")}
          modelNameField="name"
          modelAPI={fakeModelAPI("api.acme.com")}
        >
          <div />
        </ModelPage>,
      );

      // Before the record is read: the title alone.
      expect(heading()).toBe(word);

      await settle();

      const recordHeading: HTMLElement = screen.getByTestId(
        PAGE_RECORD_TITLE_TEST_IDS.heading,
      );

      expect(recordHeading).toHaveTextContent(`${word} - api.acme.com`);
      expect(recordHeading.getAttribute("title")).toBe(
        `${word} - api.acme.com`,
      );
      expect(document.body).not.toHaveTextContent(twice);
    });

    test("looks an English title up once, in the record's heading", async () => {
      renderIn(
        language,
        <ModelPage
          title={english}
          modelType={Monitor}
          modelId={new ObjectID("5f8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d")}
          modelNameField="name"
          modelAPI={fakeModelAPI("api.acme.com")}
        >
          <div />
        </ModelPage>,
      );

      await settle();

      expect(
        screen.getByTestId(PAGE_RECORD_TITLE_TEST_IDS.heading),
      ).toHaveTextContent(`${word} - api.acme.com`);
      expect(document.body).not.toHaveTextContent(twice);
    });

    test("never looks the heading it worded up again, even where that sentence is a key", async () => {
      expect(lookUp(language, `${word} - ${PROBE_RECORD}`)).toBe(twice);

      await act(async () => {
        renderIn(
          language,
          <ModelPage
            title={english}
            modelType={Monitor}
            modelId={new ObjectID("5f8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d")}
            modelNameField="name"
            modelAPI={fakeModelAPI(PROBE_RECORD)}
          >
            <div />
          </ModelPage>,
        );
      });

      await settle();

      const recordHeading: HTMLElement = screen.getByTestId(
        PAGE_RECORD_TITLE_TEST_IDS.heading,
      );

      // On hover, and in the browser tab, as on the page.
      expect(recordHeading.getAttribute("title")).toBe(
        `${word} - ${PROBE_RECORD}`,
      );
      expect(document.title.endsWith(`| ${word} - ${PROBE_RECORD}`)).toBe(true);
    });

    test(`a record's name, alone in the heading, reads as typed: ${english}, never ${word}`, async () => {
      renderIn(
        language,
        <ModelPage
          modelType={Monitor}
          modelId={new ObjectID("5f8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d")}
          modelNameField="name"
          modelAPI={fakeModelAPI(english)}
        >
          <div />
        </ModelPage>,
      );

      await settle();

      expect(heading()).toBe(english);
    });
  });

  describe("a side menu", () => {
    test("looks a section's English title and an entry's English title up once", () => {
      renderIn(
        language,
        <SideMenu>
          <SideMenuSection title={english}>
            <SideMenuItem
              link={{ title: english, to: new Route(HERE) }}
              subItemLink={{ title: english, to: new Route(ELSEWHERE) }}
            />
          </SideMenuSection>
        </SideMenu>,
      );

      expect(menuTitles()).toEqual([word, word]);
      expect(
        screen.getByRole("heading", { level: 6 }).textContent?.trim(),
      ).toBe(word);
    });

    test(`draws titles it is told are translated as given: ${word}, never ${twice}`, () => {
      renderIn(
        language,
        <SideMenu>
          <SideMenuSection title={word} isTitleTranslated={true}>
            <SideMenuItem
              link={{
                title: word,
                isTitleTranslated: true,
                to: new Route(HERE),
              }}
              subItemLink={{
                title: word,
                isTitleTranslated: true,
                to: new Route(ELSEWHERE),
              }}
            />
          </SideMenuSection>
        </SideMenu>,
      );

      expect(menuTitles()).toEqual([word, word]);

      const sectionHeading: HTMLElement = screen.getByRole("heading", {
        level: 6,
      });

      expect(sectionHeading.textContent?.trim()).toBe(word);
      expect(document.body).not.toHaveTextContent(twice);
      // In the reader's language: it says so, for its line breaks.
      expect(sectionHeading.getAttribute("lang")).toBe(language.code);
      for (const title of screen.getAllByTestId(SIDE_MENU_ITEM_TITLE_TEST_ID)) {
        expect(title.getAttribute("lang")).toBe(language.code);
      }
    });

    test(`draws a menu written as sections once too: ${word}, never ${twice}`, () => {
      renderIn(
        language,
        <SideMenu
          sections={[
            {
              title: word,
              isTitleTranslated: true,
              items: [
                {
                  link: {
                    title: word,
                    isTitleTranslated: true,
                    to: new Route(HERE),
                  },
                },
                { link: { title: english, to: new Route(ELSEWHERE) } },
              ],
            },
          ]}
        />,
      );

      expect(menuTitles()).toEqual([word, word]);
      expect(
        screen.getByRole("heading", { level: 6 }).textContent?.trim(),
      ).toBe(word);
      expect(document.body).not.toHaveTextContent(twice);
    });

    test(`draws a record's name as typed: ${english}, never ${word}`, () => {
      renderIn(
        language,
        <SideMenu>
          <SideMenuSection title={english}>
            <SideMenuItem
              link={{ title: english, isRecordName: true, to: new Route(HERE) }}
            />
          </SideMenuSection>
        </SideMenu>,
      );

      expect(menuTitles()).toEqual([english]);
      expect(
        screen.getByTestId(SIDE_MENU_ITEM_TITLE_TEST_ID).hasAttribute("lang"),
      ).toBe(false);
    });

    test("names the page on the phone's summary once, by its section's words and its own, in the reader's language", async () => {
      setViewportWidth(PHONE_WIDTH);
      goTo(HERE);

      await act(async () => {
        renderIn(
          language,
          <SideMenu>
            <SideMenuSection title={word} isTitleTranslated={true}>
              <SideMenuItem
                link={{
                  title: word,
                  isTitleTranslated: true,
                  to: new Route(HERE),
                }}
              />
            </SideMenuSection>
          </SideMenu>,
        );
      });

      const summary: HTMLElement = phoneSummary();

      /*
       * The page is named like its section, so the summary names it alone:
       * looked up again, either would read another word, and both.
       */
      expect(summary.textContent?.trim()).toBe(word);
      expect(summary).not.toHaveTextContent(twice);

      for (const words of Array.from(summary.querySelectorAll("span[lang]"))) {
        expect(words.getAttribute("lang")).toBe(language.code);
      }
    });

    test("names the page on the phone's summary once, from a menu written as sections", async () => {
      setViewportWidth(PHONE_WIDTH);
      goTo(HERE);

      await act(async () => {
        renderIn(
          language,
          <SideMenu
            sections={[
              {
                title: word,
                isTitleTranslated: true,
                items: [
                  {
                    link: {
                      title: word,
                      isTitleTranslated: true,
                      to: new Route(HERE),
                    },
                  },
                ],
              },
            ]}
          />,
        );
      });

      expect(phoneSummary().textContent?.trim()).toBe(word);
      expect(phoneSummary()).not.toHaveTextContent(twice);
    });

    test("looks the phone's summary's English up once", async () => {
      setViewportWidth(PHONE_WIDTH);
      goTo(HERE);

      await act(async () => {
        renderIn(
          language,
          <SideMenu>
            <SideMenuSection title="Settings">
              <SideMenuItem link={{ title: english, to: new Route(HERE) }} />
            </SideMenuSection>
          </SideMenu>,
        );
      });

      expect(phoneSummary()).toHaveTextContent(
        `${lookUp(language, "Settings")} / ${word}`,
      );
    });
  });

  describe("a tooltip", () => {
    test("looks English up once", () => {
      renderIn(
        language,
        <Tooltip text={english}>
          <span data-testid="tip">a</span>
        </Tooltip>,
      );

      fireEvent.mouseEnter(screen.getByTestId("tip"));

      expect(screen.getByRole("tooltip").textContent?.trim()).toBe(word);
    });

    test(`draws words it is told are translated as given: ${word}, never ${twice}`, () => {
      renderIn(
        language,
        <Tooltip text={word} isTextTranslated={true}>
          <span data-testid="tip">a</span>
        </Tooltip>,
      );

      fireEvent.mouseEnter(screen.getByTestId("tip"));

      expect(screen.getByRole("tooltip").textContent?.trim()).toBe(word);
    });

    test(`a button's tooltip is looked up once, by the button: ${word}, never ${twice}`, () => {
      renderIn(
        language,
        <Button title="Copy" tooltip={english} dataTestId="copy" />,
      );

      fireEvent.mouseEnter(screen.getByTestId("copy"));

      expect(screen.getByRole("tooltip").textContent?.trim()).toBe(word);
    });
  });
});

describe("a link's English, for telling the language of its title", () => {
  const HOME: Route = new Route("/dashboard");

  test("is the title for English and for a record's name, and none for a title in the reader's words", () => {
    const links: Array<Link> = [
      { title: "Network", to: HOME },
      { title: "Red", isTitleTranslated: true, to: HOME },
      { title: "Red", isRecordName: true, to: HOME },
      { title: "Red", isRecordName: true, isTitleTranslated: true, to: HOME },
    ];

    expect(
      links.map((link: Link): string | undefined => {
        return getCrumbTitleEnglish(link);
      }),
    ).toEqual(["Network", undefined, "Red", "Red"]);
  });
});
