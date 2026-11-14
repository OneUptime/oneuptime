import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import { Location } from "react-router-dom";
import Route from "../../../Types/API/Route";
import Breadcrumbs from "../../../UI/Components/Breadcrumbs/Breadcrumbs";
import HiddenText from "../../../UI/Components/HiddenText/HiddenText";
import MasterPage from "../../../UI/Components/MasterPage/MasterPage";
import ObjectIDView from "../../../UI/Components/ObjectID/ObjectIDView";
import SideMenu from "../../../UI/Components/SideMenu/SideMenu";
import SideMenuItem from "../../../UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "../../../UI/Components/SideMenu/SideMenuSection";
import Navigation from "../../../UI/Utils/Navigation";
import {
  ACCOUNTS_LANGUAGES,
  ADMIN_DASHBOARD_LANGUAGES,
  DASHBOARD_LANGUAGES,
  STATUS_PAGE_LANGUAGES,
} from "../../Helpers/TranslatedLanguages";

/*
 * THE PAGE'S OWN WORDS IN THE READER'S LANGUAGE (#7339).
 *
 * The words the shared page chrome draws were English on pages otherwise
 * in the reader's language: a secret's "Click to reveal" (HiddenText), the
 * ID pill's "Click to copy" (ObjectIDView), the side menu's name, "Main
 * navigation", and the breadcrumbs', "Breadcrumb" - names a screen reader
 * says aloud before anything else on the page - and the skip link's "Skip
 * to main content" (MasterPage). Drawn here from each app's own locale
 * files, as it ships them, in every language it offers: what is drawn is
 * the locale's word, and never the English. So are the words the reveal
 * button and the ID pill say once clicked: a revealed secret's "Copy" and
 * "Hide", and "Copied!" or "Copy failed" after a copy.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../..");

type Words = Record<string, unknown>;

type Part =
  | "Breadcrumb"
  | "Main navigation"
  | "Navigate to"
  | "Click to reveal"
  | "Click to copy"
  | "Skip to main content"
  | "Copy"
  | "Hide"
  | "Copied!"
  | "Copy failed";

// What the reveal button and the ID pill say once a person clicks them.
const AFTER_A_CLICK: ReadonlyArray<Part> = [
  "Copy",
  "Hide",
  "Copied!",
  "Copy failed",
];

const EVERY_PART: ReadonlyArray<Part> = [
  "Breadcrumb",
  "Main navigation",
  "Navigate to",
  "Click to reveal",
  "Click to copy",
  "Skip to main content",
  ...AFTER_A_CLICK,
];

/*
 * Every app's forms hold the reveal button and the ID pill (BasicForm >
 * FormSummary > Detail); the dashboards and the Status Page the rest too.
 */
const FORM_PARTS: ReadonlyArray<Part> = [
  "Click to reveal",
  "Click to copy",
  ...AFTER_A_CLICK,
];

interface App {
  name: string;
  folder: string;
  languages: ReadonlyArray<string>;
  parts: ReadonlyArray<Part>;
}

const localeLanguages: (folder: string) => ReadonlyArray<string> = (
  folder: string,
): ReadonlyArray<string> => {
  return fs
    .readdirSync(path.join(REPOSITORY_ROOT, folder))
    .filter((file: string): boolean => {
      return file.endsWith(".json") && file !== "en.json";
    })
    .map((file: string): string => {
      return file.replace(/\.json$/, "");
    })
    .sort();
};

const APPS: ReadonlyArray<App> = [
  {
    name: "Dashboard",
    folder: "packages/App/FeatureSet/Dashboard/src/Locales",
    languages: DASHBOARD_LANGUAGES,
    parts: EVERY_PART,
  },
  {
    name: "AdminDashboard",
    folder: "packages/App/FeatureSet/AdminDashboard/src/Locales",
    languages: ADMIN_DASHBOARD_LANGUAGES,
    parts: EVERY_PART,
  },
  {
    name: "StatusPage",
    folder: "packages/App/FeatureSet/StatusPage/src/Locales",
    languages: STATUS_PAGE_LANGUAGES,
    parts: EVERY_PART,
  },
  {
    name: "Accounts",
    folder: "packages/App/FeatureSet/Accounts/src/Locales",
    languages: ACCOUNTS_LANGUAGES,
    parts: FORM_PARTS,
  },
  {
    name: "PublicDashboard",
    folder: "packages/App/FeatureSet/PublicDashboard/src/Locales",
    languages: localeLanguages(
      "packages/App/FeatureSet/PublicDashboard/src/Locales",
    ),
    parts: FORM_PARTS,
  },
];

const readLocale: (folder: string, language: string) => Words = (
  folder: string,
  language: string,
): Words => {
  return JSON.parse(
    fs.readFileSync(
      path.join(REPOSITORY_ROOT, folder, `${language}.json`),
      "utf8",
    ),
  ) as Words;
};

// An i18next instance set up as the apps set theirs up, English behind.
const instanceFor: (
  language: string,
  words: Words,
  english: Words,
) => Promise<i18n> = async (
  language: string,
  words: Words,
  english: Words,
): Promise<i18n> => {
  const instance: i18n = createInstance();

  await instance.init({
    lng: language,
    fallbackLng: "en",
    resources: {
      [language]: { translation: words },
      en: { translation: english },
    },
    interpolation: { escapeValue: false },
  });

  return instance;
};

const inLocale: (instance: i18n, element: ReactElement) => void = (
  instance: i18n,
  element: ReactElement,
): void => {
  render(<I18nextProvider i18n={instance}>{element}</I18nextProvider>);
};

function setViewportWidth(width: number): void {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

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

const menu: () => ReactElement = (): ReactElement => {
  return (
    <SideMenu>
      <SideMenuSection title="Basic">
        <SideMenuItem link={{ title: "Overview", to: new Route("/s/1") }} />
        <SideMenuItem
          link={{ title: "Subscribers", to: new Route("/s/1/subscribers") }}
        />
      </SideMenuSection>
    </SideMenu>
  );
};

const RECORD_ID: string = "6c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";

// A clipboard that takes the text, or one that refuses it.
const installClipboard: (accepts: boolean) => void = (
  accepts: boolean,
): void => {
  Object.defineProperty(navigator, "clipboard", {
    value: {
      writeText: async (): Promise<void> => {
        if (!accepts) {
          throw new DOMException("Clipboard denied", "NotAllowedError");
        }
      },
    },
    configurable: true,
  });
};

// A tooltip's words, read once the pointer has rested on its trigger.
const tooltipOver: (trigger: HTMLElement) => Promise<string> = async (
  trigger: HTMLElement,
): Promise<string> => {
  fireEvent.mouseEnter(trigger);
  await act(async () => {
    jest.advanceTimersByTime(250);
  });

  return (await screen.findByRole("tooltip")).textContent || "";
};

/*
 * What a part draws, read off the page: a landmark's name, a button's or a
 * link's words, a tooltip's text.
 */
const drawPart: (instance: i18n, part: Part) => Promise<string> = async (
  instance: i18n,
  part: Part,
): Promise<string> => {
  cleanup();

  switch (part) {
    case "Breadcrumb": {
      inLocale(
        instance,
        <Breadcrumbs
          links={[
            { title: "Home", to: new Route("/") },
            { title: "Settings", to: new Route("/settings") },
          ]}
        />,
      );

      return screen.getByRole("navigation").getAttribute("aria-label") || "";
    }
    case "Main navigation": {
      setViewportWidth(1280);
      goTo("/s/1");
      await act(async () => {
        inLocale(instance, menu());
      });

      const desktop: string =
        document.querySelector("aside")?.getAttribute("aria-label") || "";

      // On a phone, the menu's panel is named the same way.
      cleanup();
      setViewportWidth(375);
      await act(async () => {
        inLocale(instance, menu());
      });
      fireEvent.click(screen.getByTestId("mobile-sidemenu-toggle"));

      const phone: string =
        screen
          .getByRole("navigation", { name: desktop })
          .getAttribute("aria-label") || "";

      setViewportWidth(1280);

      return phone === desktop ? desktop : `${desktop} | ${phone}`;
    }
    case "Navigate to": {
      setViewportWidth(375);
      goTo("/s/1");
      await act(async () => {
        inLocale(instance, menu());
      });

      const toggle: HTMLElement = screen.getByTestId("mobile-sidemenu-toggle");

      setViewportWidth(1280);

      return toggle.querySelector("p")?.textContent || "";
    }
    case "Click to reveal": {
      inLocale(instance, <HiddenText text="s3cr3t-value" />);

      return screen.getByRole("hidden-text").textContent || "";
    }
    case "Click to copy": {
      inLocale(instance, <ObjectIDView objectId={RECORD_ID} />);

      // The pill around the ID is what the tooltip hangs on.
      return tooltipOver(screen.getByText(RECORD_ID).parentElement!);
    }
    case "Copy": {
      // A revealed secret's copy button, named for what it does.
      inLocale(instance, <HiddenText text="s3cr3t-value" isCopyable={true} />);
      fireEvent.click(screen.getByRole("hidden-text"));

      return (
        screen
          .getByTestId("copy-to-clipboard-icon")
          .getAttribute("aria-label") || ""
      );
    }
    case "Hide": {
      inLocale(instance, <HiddenText text="s3cr3t-value" isCopyable={true} />);
      fireEvent.click(screen.getByRole("hidden-text"));

      return tooltipOver(screen.getByTestId("hide-text-icon"));
    }
    case "Copied!":
    case "Copy failed": {
      // What the ID pill says to a screen reader once a copy is done.
      installClipboard(part === "Copied!");
      inLocale(instance, <ObjectIDView objectId={RECORD_ID} />);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: RECORD_ID }));
      });

      const said: string = screen.getByRole("status").textContent || "";

      window.getSelection()?.removeAllRanges();
      installClipboard(true);

      return said;
    }
    case "Skip to main content": {
      inLocale(
        instance,
        <MasterPage isLoading={false} error="">
          <div>Page</div>
        </MasterPage>,
      );

      return (
        document.querySelector('a[href="#main-content"]')?.textContent || ""
      );
    }
  }
};

interface Drawn {
  part: Part;
  drawn: string;
  locale: unknown;
}

// Each part as the app draws it in `language`, beside its locale's word.
const drawEveryPart: (
  app: App,
  language: string,
  words: Words,
) => Promise<Array<Drawn>> = async (
  app: App,
  language: string,
  words: Words,
): Promise<Array<Drawn>> => {
  const instance: i18n = await instanceFor(
    language,
    words,
    readLocale(app.folder, "en"),
  );
  const drawn: Array<Drawn> = [];

  for (const part of app.parts) {
    drawn.push({
      part,
      drawn: await drawPart(instance, part),
      locale: words[part],
    });
  }

  return drawn;
};

// The parts drawn in English, or not as the locale words them.
const notInTheReadersWords: (drawn: ReadonlyArray<Drawn>) => Array<string> = (
  drawn: ReadonlyArray<Drawn>,
): Array<string> => {
  return drawn
    .filter((one: Drawn): boolean => {
      return one.drawn === one.part || one.drawn !== one.locale;
    })
    .map((one: Drawn): string => {
      return `${one.part}: ${one.drawn}`;
    });
};

const originalExecCommand: PropertyDescriptor | undefined =
  Object.getOwnPropertyDescriptor(document, "execCommand");

beforeEach(() => {
  jest.useFakeTimers();
  installClipboard(true);
  Object.defineProperty(document, "execCommand", {
    value: undefined,
    configurable: true,
    writable: true,
  });
  setViewportWidth(1280);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  if (originalExecCommand) {
    Object.defineProperty(document, "execCommand", originalExecCommand);
  }
});

describe("the page's own words in the reader's language", () => {
  test("every app offers its languages, and has a locale file for each", () => {
    for (const app of APPS) {
      expect({ app: app.name, count: app.languages.length }).toEqual({
        app: app.name,
        count: expect.any(Number),
      });
      expect(app.languages.length).toBeGreaterThanOrEqual(17);

      for (const language of app.languages) {
        expect(
          fs.existsSync(
            path.join(REPOSITORY_ROOT, app.folder, `${language}.json`),
          ),
        ).toBe(true);
      }
    }
  });

  test("English draws each part's English word (the check reads what is drawn)", async () => {
    const english: Words = readLocale(APPS[0]!.folder, "en");
    const drawn: Array<Drawn> = await drawEveryPart(APPS[0]!, "en", english);

    expect(
      drawn.map((one: Drawn): string => {
        return one.drawn;
      }),
    ).toEqual([...EVERY_PART]);
  });

  for (const app of APPS) {
    test.each([...app.languages])(
      `${app.name} in %s draws ${app.parts.length} parts in the locale's words`,
      async (language: string) => {
        const drawn: Array<Drawn> = await drawEveryPart(
          app,
          language,
          readLocale(app.folder, language),
        );

        expect(drawn).toHaveLength(app.parts.length);
        expect({ language, left: notInTheReadersWords(drawn) }).toEqual({
          language,
          left: [],
        });
      },
    );
  }

  test.each([
    ["de", "Navigationspfad", "Hauptnavigation"],
    ["fa", "مسیر صفحه", "ناوبری اصلی"],
    ["ar", "مسار التنقل", "التنقل الرئيسي"],
  ])(
    "the Dashboard in %s names its breadcrumbs %s and its side menu %s",
    async (language: string, breadcrumb: string, navigation: string) => {
      const app: App = APPS[0]!;
      const words: Words = readLocale(app.folder, language);

      expect(words["Breadcrumb"]).toBe(breadcrumb);
      expect(words["Main navigation"]).toBe(navigation);

      const instance: i18n = await instanceFor(
        language,
        words,
        readLocale(app.folder, "en"),
      );

      inLocale(
        instance,
        <Breadcrumbs links={[{ title: "Home", to: new Route("/") }]} />,
      );
      expect(
        screen.getByRole("navigation", { name: breadcrumb }),
      ).toBeInTheDocument();

      cleanup();
      goTo("/s/1");
      await act(async () => {
        inLocale(instance, menu());
      });
      expect(
        screen.getByRole("navigation", { name: navigation }),
      ).toBeInTheDocument();
    },
  );

  test("a locale without the words draws them in English, and the check sees each (negative control)", async () => {
    const app: App = APPS[2]!;
    const german: Words = { ...readLocale(app.folder, "de") };

    for (const part of EVERY_PART) {
      delete german[part];
    }

    const drawn: Array<Drawn> = await drawEveryPart(app, "de", german);

    expect(notInTheReadersWords(drawn)).toEqual(
      EVERY_PART.map((part: Part): string => {
        return `${part}: ${part}`;
      }),
    );
  });
});
