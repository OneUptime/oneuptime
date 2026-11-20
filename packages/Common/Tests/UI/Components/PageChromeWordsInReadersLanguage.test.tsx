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
import IconProp from "../../../Types/Icon/IconProp";
import { withNoBreakSpaces } from "../../../Types/NoBreakSpaces";
import Breadcrumbs from "../../../UI/Components/Breadcrumbs/Breadcrumbs";
import HiddenText from "../../../UI/Components/HiddenText/HiddenText";
import MasterPage from "../../../UI/Components/MasterPage/MasterPage";
import Navbar, {
  HOME_NAV_BAR_ITEM_ID,
} from "../../../UI/Components/Navbar/NavBar";
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
 * ID pill's "Click to copy" (ObjectIDView), the top bar's name, "Main
 * menu" (NavBar), the side menu's, "Pages in this section", and the
 * breadcrumbs', "Breadcrumb" - names a screen reader says aloud as it lists
 * the page's landmarks, three of them, told apart by name (#7963: the side
 * menu was "Main navigation" and the bar had none) - and the skip link's
 * "Skip to main content" (MasterPage). Drawn here from each app's own locale
 * files, as it ships them, in every language it offers: what is drawn is
 * the locale's word, and never the English. So are the words the reveal
 * button and the ID pill say once clicked: a revealed secret's "Copy" and
 * "Hide", and "Copied!" or "Copy failed" after a copy.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../..");

type Words = Record<string, unknown>;

type Part =
  | "Breadcrumb"
  | "Main menu"
  | "Pages in this section"
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
  "Main menu",
  "Pages in this section",
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

// The top bar as the Dashboard draws it: Home, and a product beside it.
const topBar: () => ReactElement = (): ReactElement => {
  return (
    <Navbar
      items={[
        {
          id: HOME_NAV_BAR_ITEM_ID,
          title: "Home",
          icon: IconProp.Home,
          route: new Route("/home"),
        },
        {
          id: "monitors",
          title: "Monitors",
          icon: IconProp.AltGlobe,
          route: new Route("/s/1"),
        },
      ]}
    />
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
    case "Main menu": {
      setViewportWidth(1280);
      goTo("/s/1");
      await act(async () => {
        inLocale(instance, topBar());
      });

      const desktop: string =
        document.querySelector("nav")?.getAttribute("aria-label") || "";

      // On a phone, the bar and the menu it opens are one landmark, named so.
      cleanup();
      setViewportWidth(375);
      await act(async () => {
        inLocale(instance, topBar());
      });
      fireEvent.click(screen.getByTestId("mobile-nav-toggle"));

      const phones: Array<string> = screen
        .getAllByRole("navigation")
        .map((landmark: HTMLElement): string => {
          return landmark.getAttribute("aria-label") || "";
        });

      setViewportWidth(1280);

      return phones.length === 1 && phones[0] === desktop
        ? desktop
        : `${desktop} | ${phones.join(" | ")}`;
    }
    case "Pages in this section": {
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

      // The button a keyboard reaches, named by the words it shows.
      return screen.getByTestId("hidden-text-reveal").textContent || "";
    }
    case "Click to copy": {
      inLocale(instance, <ObjectIDView objectId={RECORD_ID} />);

      // The pill around the ID is what the tooltip hangs on.
      return tooltipOver(screen.getByText(RECORD_ID).parentElement!);
    }
    case "Copy": {
      // A revealed secret's copy button, named for what it does.
      inLocale(instance, <HiddenText text="s3cr3t-value" isCopyable={true} />);
      fireEvent.click(screen.getByTestId("hidden-text-reveal"));

      return (
        screen
          .getByTestId("copy-to-clipboard-icon")
          .getAttribute("aria-label") || ""
      );
    }
    case "Hide": {
      inLocale(instance, <HiddenText text="s3cr3t-value" isCopyable={true} />);
      fireEvent.click(screen.getByTestId("hidden-text-reveal"));

      /*
       * What a screen reader says for the Hide button, and what its tooltip
       * shows: one word, both in the reader's language.
       */
      const hide: HTMLElement = screen.getByTestId("hide-text-icon");
      const spoken: string = hide.getAttribute("aria-label") || "";
      const shown: string = await tooltipOver(hide);

      return spoken === shown ? shown : `${spoken} | ${shown}`;
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
    const worded: unknown = words[part];

    drawn.push({
      part,
      drawn: await drawPart(instance, part),
      // As the page draws the locale's words: French's marks kept with them.
      locale:
        typeof worded === "string" && worded !== part
          ? withNoBreakSpaces(worded, part, language)
          : worded,
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
    ["de", "Navigationspfad", "Seiten in diesem Bereich"],
    ["fa", "مسیر صفحه", "صفحه‌های این بخش"],
    ["ar", "مسار التنقل", "الصفحات في هذا القسم"],
  ])(
    "the Dashboard in %s names its breadcrumbs %s and its side menu %s",
    async (language: string, breadcrumb: string, navigation: string) => {
      const app: App = APPS[0]!;
      const words: Words = readLocale(app.folder, language);

      expect(words["Breadcrumb"]).toBe(breadcrumb);
      expect(words["Pages in this section"]).toBe(navigation);

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

  /*
   * A page with all three - the top bar, the trail and a side menu - lists
   * three navigation landmarks, each with a name of its own, in every
   * language of every app that draws them (#7963). The side menu was
   * "Main navigation" and the bar had no name, so a person asking for the
   * main navigation landed in a project's Settings menu. And no name holds
   * the landmark's own word ("navigation", which a screen reader says
   * after it, WAI-ARIA's landmark naming).
   */
  const landmarksOfAPage: (instance: i18n) => Promise<Array<string>> = async (
    instance: i18n,
  ): Promise<Array<string>> => {
    cleanup();
    setViewportWidth(1280);
    goTo("/s/1");
    await act(async () => {
      inLocale(
        instance,
        <div>
          {topBar()}
          <Breadcrumbs
            links={[
              { title: "Home", to: new Route("/home") },
              { title: "Settings", to: new Route("/s/1") },
            ]}
          />
          {menu()}
        </div>,
      );
    });

    return screen
      .getAllByRole("navigation")
      .map((landmark: HTMLElement): string => {
        return landmark.getAttribute("aria-label") || "";
      });
  };

  test("an English page's three landmarks: Main menu, Breadcrumb and Pages in this section", async () => {
    const english: Words = readLocale(APPS[0]!.folder, "en");
    const instance: i18n = await instanceFor("en", english, english);

    expect(await landmarksOfAPage(instance)).toEqual([
      "Main menu",
      "Breadcrumb",
      "Pages in this section",
    ]);
  });

  for (const app of APPS.filter((one: App): boolean => {
    return one.parts.includes("Main menu");
  })) {
    test.each(["en", ...app.languages])(
      `${app.name} in %s names the top bar, the trail and the side menu apart`,
      async (language: string) => {
        const words: Words = readLocale(app.folder, language);
        const instance: i18n = await instanceFor(
          language,
          words,
          readLocale(app.folder, "en"),
        );
        const names: Array<string> = await landmarksOfAPage(instance);

        expect(names).toHaveLength(3);
        expect(new Set(names).size).toBe(3);

        for (const name of names) {
          expect(name.trim().length).toBeGreaterThan(0);
        }
      },
    );
  }

  test("two landmarks with one name, or one with none, are caught (negative control)", () => {
    const apart: (names: Array<string>) => boolean = (
      names: Array<string>,
    ): boolean => {
      return (
        new Set(names).size === names.length &&
        names.every((name: string): boolean => {
          return name.trim().length > 0;
        })
      );
    };

    expect(apart(["Main menu", "Breadcrumb", "Pages in this section"])).toBe(
      true,
    );
    expect(apart(["Main navigation", "Breadcrumb", "Main navigation"])).toBe(
      false,
    );
    expect(apart(["", "Breadcrumb", "Main navigation"])).toBe(false);
  });

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
