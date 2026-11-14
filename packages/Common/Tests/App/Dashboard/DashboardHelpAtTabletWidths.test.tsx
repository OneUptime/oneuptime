import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
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
import React from "react";
import { I18nextProvider, initReactI18next } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  TAILWIND_BREAKPOINTS_IN_PX,
  VisibilityOptions,
  describeVisibility,
  isVisibleAtWidth,
} from "../../ResponsiveVisibility";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import TopSection from "../../../UI/Components/TopSection/TopSection";
import { PHONE_MENU_BELOW_WIDTH_IN_PX } from "../../../UI/Components/Navbar/NavBar";
import GlobalEvents from "../../../UI/Utils/GlobalEvents";
import {
  GLOSSARY_INDEX_DOCS_PAGE,
  QUICKSTART_DOCS_PAGE,
  getDocsPageUrl,
} from "../../../UI/Utils/Glossary";
import Navigation from "../../../UI/Utils/Navigation";
import escapeRegExp from "../../../Utils/RegExpEscape";
import DashboardHeader, {
  FROM_LAPTOP_WIDTH_CLASS_NAME,
  FROM_TABLET_WIDTH_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Header/Header";
import {
  HELP_ASK_GROUP_TEST_ID,
  HELP_LEARN_GROUP_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Header/Help";
import DashboardNavbar from "../../../../App/FeatureSet/Dashboard/src/Components/NavBar/NavBar";
import {
  PHONE_MENU_HELP_TEST_ID,
  PHONE_MENU_SEARCH_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NavBar/PhoneMenuEntries";
import arabicLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/ar.json";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import EventName from "../../../../App/FeatureSet/Dashboard/src/Utils/EventName";
import { PROJECT_ID, goTo, setViewportWidth } from "./SideMenuHarness";

/*
 * Help, How OneUptime works and the Glossary at a tablet's width (#7037).
 *
 * The header drew Help (and Search) only from lg, 1024px, and the phone's
 * menu that carries them both (#6816, DashboardPhoneMenuSearchAndHelp) is
 * drawn only below md, 768px. From 768 to 1023px - a tablet held upright,
 * a laptop's window beside another - they were in neither, so Help, How
 * OneUptime works, the Glossary, the docs, support and Search could not be
 * reached with a tap or a click.
 *
 * The header now draws Search and Help from md, where the phone's menu
 * stops; Upgrade and Ask AI stay for lg (Ask AI is one of Search's actions).
 * This renders the top of a page as the Dashboard draws it - the header and
 * the nav bar in TopSection - at 900px, and holds every width from 320 to
 * 1920 to "in exactly one of the two".
 */

const translation: i18n = createInstance();
const ORIGINAL_WIDTH: number = window.innerWidth;

const TABLET_WIDTH_IN_PX: number = 900;
const MD_IN_PX: number = TAILWIND_BREAKPOINTS_IN_PX["md"]!;
const LG_IN_PX: number = TAILWIND_BREAKPOINTS_IN_PX["lg"]!;
const NARROWEST_IN_PX: number = 320;
const WIDEST_IN_PX: number = 1920;

const countMock: MockFunction = getJestMockFunction();
const getMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: (...args: Array<unknown>) => {
        return countMock(...args);
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

// The current on-call lookup: nobody is on call.
jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: (...args: Array<unknown>) => {
        return getMock(...args);
      },
    },
  };
});

// No socket in a unit test; every subscription hands back a no-op.
jest.mock("../../../UI/Utils/Realtime", () => {
  return {
    __esModule: true,
    default: {
      listenToModelEvent: () => {
        return () => {
          // Nothing to stop listening to.
        };
      },
    },
  };
});

// The project picker asks the server whether projects may be created.
jest.mock("../../../UI/Utils/GlobalConfig", () => {
  return {
    __esModule: true,
    default: {
      fetchVars: async () => {
        return { disableUserProjectCreation: false };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      getUserId: () => {
        return {
          toString: () => {
            return "user-1";
          },
        };
      },
      getProfilePicId: () => {
        return null;
      },
      getProfilePictureRoute: () => {
        return {
          toString: () => {
            return "/api/user/profile-picture/user-1";
          },
        };
      },
      isMasterAdmin: () => {
        return false;
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/IncidentState",
  () => {
    return {
      __esModule: true,
      default: {
        getUnresolvedIncidentStates: async () => {
          return [];
        },
      },
    };
  },
);

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/AlertState", () => {
  return {
    __esModule: true,
    default: {
      getUnresolvedAlertStates: async () => {
        return [];
      },
    },
  };
});

type LocaleTree = { [key: string]: string | LocaleTree };

function localeText(locale: unknown, key: string): string {
  let node: string | LocaleTree = locale as LocaleTree;

  for (const segment of key.split(".")) {
    node = (node as LocaleTree)[segment] as string | LocaleTree;
  }

  return node as string;
}

// The top of every page, as the Dashboard's MasterPage stacks it.
async function renderTopOfPage(): Promise<void> {
  await act(async () => {
    render(
      <I18nextProvider i18n={translation}>
        <TopSection
          header={
            <DashboardHeader
              projects={[]}
              onProjectSelected={() => {}}
              showProjectModal={false}
              onProjectModalClose={() => {}}
              selectedProject={null}
            />
          }
          navbar={<DashboardNavbar show={true} />}
        />
      </I18nextProvider>,
    );
  });
}

function headerHelp(name: string = "Help"): HTMLElement {
  return screen.getByRole("button", { name: name });
}

// Search's name, then its keycaps (Ctrl K, or ⌘ K on a Mac).
function headerSearch(name: string = "Search"): HTMLElement {
  return screen.getByRole("button", {
    name: new RegExp(`^${escapeRegExp(name)}\\b`),
  });
}

function headerAskAi(): HTMLElement {
  return screen.getByRole("button", { name: /^Ask AI\b/ });
}

// Each row's title, without the keycap drawn beside Keyboard shortcuts.
function rowTitles(container: HTMLElement): Array<string> {
  return Array.from(container.querySelectorAll("a, button")).map(
    (row: Element): string => {
      return row.querySelector("span.flex-1")?.textContent?.trim() || "";
    },
  );
}

function listenTo(eventName: string): {
  calls: MockFunction;
  stop: () => void;
} {
  const calls: MockFunction = getJestMockFunction();
  const listener: (event: CustomEvent) => void = (event: CustomEvent): void => {
    calls(event.detail);
  };
  GlobalEvents.addEventListener(eventName, listener);
  return {
    calls,
    stop: (): void => {
      GlobalEvents.removeEventListener(eventName, listener);
    },
  };
}

// Every width from the narrowest phone to a wide desktop, one pixel apart.
function everyWidth(): Array<number> {
  const widths: Array<number> = [];

  for (let width: number = NARROWEST_IN_PX; width <= WIDEST_IN_PX; width++) {
    widths.push(width);
  }

  return widths;
}

beforeAll(async () => {
  Element.prototype.scrollIntoView = (): void => {};
  await translation.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: englishLocale },
      de: { translation: germanLocale },
      ar: { translation: arabicLocale },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  window.localStorage.clear();
  setViewportWidth(TABLET_WIDTH_IN_PX);
  goTo(`/dashboard/${PROJECT_ID}/home`);
  await translation.changeLanguage("en");
  countMock.mockImplementation(async () => {
    return 0;
  });
  getMock.mockImplementation(async () => {
    const empty: JSONObject = {
      escalationRulesByUser: [],
      escalationRulesByTeam: [],
      escalationRulesBySchedule: [],
    };

    return new HTTPResponse<JSONObject>(200, empty, {});
  });
  jest.spyOn(Navigation, "navigate").mockImplementation((): void => {});
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  countMock.mockReset();
  getMock.mockReset();
  window.localStorage.clear();
  setViewportWidth(ORIGINAL_WIDTH);
});

describe("the top of a page at a tablet's width (900px)", () => {
  test("the header draws Help and Search; Upgrade and Ask AI wait for lg", async () => {
    await renderTopOfPage();

    expect(describeVisibility(headerHelp(), TABLET_WIDTH_IN_PX)).toBe(
      "visible at 900px",
    );
    expect(describeVisibility(headerSearch(), TABLET_WIDTH_IN_PX)).toBe(
      "visible at 900px",
    );
    expect(isVisibleAtWidth(headerAskAi(), TABLET_WIDTH_IN_PX)).toBe(false);
    expect(describeVisibility(headerAskAi(), LG_IN_PX)).toBe(
      "visible at 1024px",
    );
    // The bell and the picture, at every width as before.
    expect(
      describeVisibility(
        screen.getByRole("button", { name: /View notifications/ }),
        TABLET_WIDTH_IN_PX,
      ),
    ).toBe("visible at 900px");
  });

  test("the nav bar is the desktop one there: no phone menu, so the header is where Help is", async () => {
    await renderTopOfPage();

    expect(screen.queryByTestId("mobile-nav-toggle")).toBeNull();
    expect(screen.queryByTestId(PHONE_MENU_HELP_TEST_ID)).toBeNull();
    expect(screen.queryByTestId(PHONE_MENU_SEARCH_TEST_ID)).toBeNull();
    // One Help on the page: the header's.
    expect(screen.getAllByRole("button", { name: "Help" })).toHaveLength(1);
  });

  test("Help opens to the ways to learn - How OneUptime works and the Glossary among them - then the ways to ask", async () => {
    await renderTopOfPage();

    fireEvent.click(headerHelp());

    const learn: HTMLElement = screen.getByTestId(HELP_LEARN_GROUP_TEST_ID);
    const ask: HTMLElement = screen.getByTestId(HELP_ASK_GROUP_TEST_ID);

    expect(rowTitles(learn)).toEqual([
      "Quickstart",
      "How OneUptime works",
      "Glossary",
      "Documentation",
    ]);
    /*
     * A tablet with a keyboard, or a laptop's narrow window, has keys: the
     * keyboard shortcuts stay (the phone's menu leaves them out).
     */
    expect(rowTitles(ask)).toEqual([
      "Keyboard shortcuts",
      "Support Email",
      "Chat on Slack",
      "Request Demo",
    ]);
    for (const row of [learn, ask]) {
      expect(isVisibleAtWidth(row, TABLET_WIDTH_IN_PX)).toBe(true);
    }
  });

  test("Help's menu and the profile menu beside it are each named by their own button, and Escape puts Help away", async () => {
    await renderTopOfPage();

    const help: HTMLElement = headerHelp();
    const profile: HTMLElement = screen.getByRole("button", {
      name: /User Profile/,
    });

    /*
     * Both used to carry the id "user-menu-button", and both menus were
     * labelled by it: a screen reader read the profile menu as Help's.
     */
    expect(help.id).not.toBe(profile.id);
    expect(document.getElementById("user-menu-button")).toBeNull();

    fireEvent.click(profile);
    expect(screen.getByRole("menu")).toHaveAttribute(
      "aria-labelledby",
      profile.id,
    );
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(help);
    expect(screen.getByRole("menu", { name: "Help" })).toBe(
      screen.getByTestId(HELP_LEARN_GROUP_TEST_ID).closest('[role="menu"]'),
    );
    help.focus();
    fireEvent.keyDown(help, { key: "Escape" });
    expect(screen.queryByTestId(HELP_LEARN_GROUP_TEST_ID)).toBeNull();
    expect(document.activeElement).toBe(help);
  });

  test("the Glossary and the Quickstart open on this instance's docs, in a new tab", async () => {
    await renderTopOfPage();

    fireEvent.click(headerHelp());

    const glossary: HTMLElement = within(
      screen.getByTestId(HELP_LEARN_GROUP_TEST_ID),
    ).getByRole("link", { name: "Glossary" });
    const quickstart: HTMLElement = within(
      screen.getByTestId(HELP_LEARN_GROUP_TEST_ID),
    ).getByRole("link", { name: "Quickstart" });

    expect(glossary).toHaveAttribute(
      "href",
      getDocsPageUrl(GLOSSARY_INDEX_DOCS_PAGE, "en"),
    );
    expect(glossary.getAttribute("href")).toMatch(
      /\/docs\/en\/introduction\/glossary$/,
    );
    expect(glossary).toHaveAttribute("target", "_blank");
    expect(quickstart).toHaveAttribute(
      "href",
      getDocsPageUrl(QUICKSTART_DOCS_PAGE, "en"),
    );
  });

  test("How OneUptime works opens over the page, as opened from Help, and the menu closes", async () => {
    const opened: { calls: MockFunction; stop: () => void } = listenTo(
      EventName.HOW_ONEUPTIME_WORKS_OPEN,
    );

    try {
      await renderTopOfPage();
      fireEvent.click(headerHelp());
      fireEvent.click(
        within(screen.getByTestId(HELP_LEARN_GROUP_TEST_ID)).getByText(
          "How OneUptime works",
        ),
      );

      expect(opened.calls).toHaveBeenCalledTimes(1);
      expect(opened.calls).toHaveBeenCalledWith({ from: "help" });
      expect(screen.queryByTestId(HELP_LEARN_GROUP_TEST_ID)).toBeNull();
    } finally {
      opened.stop();
    }
  });

  test("Search opens Search over the page - and Ask AI, left out here, is one of its actions", async () => {
    const toggled: { calls: MockFunction; stop: () => void } = listenTo(
      EventName.COMMAND_PALETTE_TOGGLE,
    );

    try {
      await renderTopOfPage();
      fireEvent.click(headerSearch());

      expect(toggled.calls).toHaveBeenCalledTimes(1);
    } finally {
      toggled.stop();
    }
  });

  test("in German, Help and Search say so in German, and the Glossary opens in German", async () => {
    await translation.changeLanguage("de");
    await renderTopOfPage();

    const help: string = localeText(germanLocale, "help.label");
    const search: string = localeText(germanLocale, "header.search");

    expect(help).toBe("Hilfe");
    expect(search).toBe("Suchen");
    expect(describeVisibility(headerSearch(search), TABLET_WIDTH_IN_PX)).toBe(
      "visible at 900px",
    );

    fireEvent.click(headerHelp(help));

    const learn: HTMLElement = screen.getByTestId(HELP_LEARN_GROUP_TEST_ID);
    expect(rowTitles(learn)).toEqual([
      localeText(germanLocale, "help.quickstart"),
      localeText(germanLocale, "help.howOneUptimeWorks"),
      localeText(germanLocale, "help.glossary"),
      localeText(germanLocale, "help.documentation"),
    ]);
    expect(
      within(learn).getByRole("link", {
        name: localeText(germanLocale, "help.glossary"),
      }),
    ).toHaveAttribute("href", getDocsPageUrl(GLOSSARY_INDEX_DOCS_PAGE, "de"));
    expect(getDocsPageUrl(GLOSSARY_INDEX_DOCS_PAGE, "de")).toMatch(
      /\/docs\/de\/introduction\/glossary$/,
    );
  });

  test("in Arabic, Help is named in Arabic and its Glossary opens in the docs' language for Arabic", async () => {
    await translation.changeLanguage("ar");
    await renderTopOfPage();

    const help: string = localeText(arabicLocale, "help.label");
    expect(help).not.toBe("Help");
    expect(describeVisibility(headerHelp(help), TABLET_WIDTH_IN_PX)).toBe(
      "visible at 900px",
    );

    fireEvent.click(headerHelp(help));

    expect(
      within(screen.getByTestId(HELP_LEARN_GROUP_TEST_ID)).getByRole("link", {
        name: localeText(arabicLocale, "help.glossary"),
      }),
    ).toHaveAttribute("href", getDocsPageUrl(GLOSSARY_INDEX_DOCS_PAGE, "ar"));
  });
});

describe("Search and Help, at every width from 320 to 1920", () => {
  test("the header draws them from the very width the phone's menu stops at", () => {
    expect(PHONE_MENU_BELOW_WIDTH_IN_PX).toBe(MD_IN_PX);
    expect(FROM_TABLET_WIDTH_CLASS_NAME.split(" ")).toEqual([
      "max-md:hidden",
      "items-center",
      "md:flex",
    ]);
    expect(FROM_LAPTOP_WIDTH_CLASS_NAME.split(" ")).toEqual([
      "max-lg:hidden",
      "items-center",
      "lg:flex",
    ]);
  });

  test("each is in exactly one place at every width: the phone's menu below 768, the header from 768", async () => {
    await renderTopOfPage();

    const entries: Array<[string, HTMLElement]> = [
      ["Help", headerHelp()],
      ["Search", headerSearch()],
    ];
    const misplaced: Array<string> = [];

    for (const [name, button] of entries) {
      for (const width of everyWidth()) {
        const inHeader: boolean = isVisibleAtWidth(button, width);
        const inPhoneMenu: boolean = width < PHONE_MENU_BELOW_WIDTH_IN_PX;

        if (inHeader === inPhoneMenu) {
          misplaced.push(
            `${name} at ${width}px: ${inHeader ? "in both" : "in neither"}`,
          );
        }
      }
    }

    expect(misplaced).toEqual([]);
  });

  test("Ask AI is in the header from 1024, and in Search - drawn at every width - below it", async () => {
    await renderTopOfPage();

    const askAi: HTMLElement = headerAskAi();
    const search: HTMLElement = headerSearch();
    const unreachable: Array<number> = everyWidth().filter(
      (width: number): boolean => {
        const searchDrawn: boolean =
          isVisibleAtWidth(search, width) ||
          width < PHONE_MENU_BELOW_WIDTH_IN_PX;

        return !isVisibleAtWidth(askAi, width) && !searchDrawn;
      },
    );

    expect(unreachable).toEqual([]);
    expect(isVisibleAtWidth(askAi, LG_IN_PX - 1)).toBe(false);
    expect(isVisibleAtWidth(askAi, LG_IN_PX)).toBe(true);
  });

  for (const width of [NARROWEST_IN_PX, 375, MD_IN_PX - 1]) {
    test(`at ${width}px the phone's menu carries Help and Search, and the header leaves them out`, async () => {
      setViewportWidth(width);
      await renderTopOfPage();

      expect(isVisibleAtWidth(headerHelp(), width)).toBe(false);
      expect(isVisibleAtWidth(headerSearch(), width)).toBe(false);

      fireEvent.click(screen.getByTestId("mobile-nav-toggle"));

      expect(screen.getByTestId(PHONE_MENU_SEARCH_TEST_ID)).toBeVisible();
      fireEvent.click(
        within(screen.getByTestId(PHONE_MENU_HELP_TEST_ID)).getByRole(
          "button",
          { name: "Help" },
        ),
      );
      expect(screen.getByText("Glossary").closest("a")).toHaveAttribute(
        "href",
        getDocsPageUrl(GLOSSARY_INDEX_DOCS_PAGE, "en"),
      );
    });
  }

  for (const width of [
    MD_IN_PX,
    TABLET_WIDTH_IN_PX,
    LG_IN_PX - 1,
    LG_IN_PX,
    1280,
    WIDEST_IN_PX,
  ]) {
    test(`at ${width}px there is no phone menu, and the header's Help opens its menu`, async () => {
      setViewportWidth(width);
      await renderTopOfPage();

      expect(screen.queryByTestId("mobile-nav-toggle")).toBeNull();
      expect(describeVisibility(headerHelp(), width)).toBe(
        `visible at ${width}px`,
      );
      expect(describeVisibility(headerSearch(), width)).toBe(
        `visible at ${width}px`,
      );

      fireEvent.click(headerHelp());

      expect(
        within(screen.getByTestId(HELP_LEARN_GROUP_TEST_ID)).getByRole("link", {
          name: "Glossary",
        }),
      ).toBeInTheDocument();
    });
  }
});

/*
 * A foreign `.hidden { display: none !important }` (Bootstrap 3, HTML5
 * Boilerplate, browser extensions) beats `md:flex` on an element that
 * carries the bare `hidden` class: the max-md form never does.
 */
describe("with a foreign .hidden rule on the page", () => {
  const WITH_FOREIGN_HIDDEN_RULE: VisibilityOptions = {
    withForeignHiddenRule: true,
  };

  test("Search and Help are still on screen at 768, 900 and 1023", async () => {
    await renderTopOfPage();

    for (const button of [headerHelp(), headerSearch()]) {
      for (const width of [MD_IN_PX, TABLET_WIDTH_IN_PX, LG_IN_PX - 1]) {
        expect(
          describeVisibility(button, width, WITH_FOREIGN_HIDDEN_RULE),
        ).toBe(`visible at ${width}px with a foreign .hidden rule on the page`);
      }
    }
  });
});
