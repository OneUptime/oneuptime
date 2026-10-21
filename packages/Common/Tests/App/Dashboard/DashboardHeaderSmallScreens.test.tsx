import "@testing-library/jest-dom";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  LAPTOP_WIDTH_IN_PX,
  PHONE_WIDTH_IN_PX,
  TABLET_WIDTH_IN_PX,
  TAILWIND_BREAKPOINTS_IN_PX,
  VisibilityOptions,
  WIDE_DESKTOP_WIDTH_IN_PX,
  describeVisibility,
  isVisibleAtWidth,
  restorePreFixMarkup,
} from "../../ResponsiveVisibility";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";

/*
 * The dashboard header on a phone.
 *
 * Everything in the header's right rail — search, Ask AI, the bell, help and
 * the profile button — was wrapped in `hidden lg:flex`, so below 1024px the
 * header offered a logo, a project picker and a theme toggle and nothing else.
 * The profile button going missing was the real cost: its menu is the only
 * route to the profile page, admin settings, the theme switch and log out, so
 * on a phone there was no way to sign out of the dashboard.
 *
 * This file renders the actual header the dashboard mounts and asserts what a
 * phone user can reach. It also pins the other half of the decision — which
 * entries stay behind on a narrow screen — so "make it all visible again" does
 * not quietly become the fix and push the row off the side of the viewport.
 */

/*
 * esbuild inlines .svg imports as data URLs, and the header logo decodes its
 * import to recolour the mark for dark mode. Jest maps every .svg to one shared
 * mock, so this single factory covers the wordmark and the blank avatar both.
 */
const ASSET_DATA_URL: string = "data:image/svg+xml;base64,bG9nbw==";

jest.mock("../../../UI/Images/logos/OneUptimeSVG/3-transparent.svg", () => {
  return ASSET_DATA_URL;
});

type LocaleValue = string | { [key: string]: LocaleValue };

/*
 * Translate through the real en.json the dashboard ships rather than echoing
 * keys back. Assertions then read as the words on the button, and a renamed or
 * deleted key shows up here as a failure instead of passing silently.
 */
const lookUpTranslation: (key: string) => string | undefined = (
  key: string,
): string | undefined => {
  let node: LocaleValue | undefined = englishLocale as LocaleValue;

  for (const segment of key.split(".")) {
    if (typeof node !== "object" || node === null) {
      return undefined;
    }

    node = node[segment];
  }

  return typeof node === "string" ? node : undefined;
};

const translate: (
  key: string,
  options?: string | Record<string, unknown>,
) => string = (key: string, options?: string | Record<string, unknown>) => {
  const translation: string | undefined = lookUpTranslation(key);

  if (translation === undefined) {
    if (typeof options === "string") {
      return options;
    }

    if (options && typeof options["defaultValue"] === "string") {
      return options["defaultValue"];
    }

    return key;
  }

  if (!options || typeof options === "string") {
    return translation;
  }

  return Object.keys(options).reduce((text: string, name: string): string => {
    return text.split(`{{${name}}}`).join(String(options[name]));
  }, translation);
};

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (
          key: string,
          options?: string | Record<string, unknown>,
        ): string => {
          return translate(key, options);
        },
      };
    },
  };
});

const countMock: MockFunction = getJestMockFunction();
const isMasterAdminMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: (...args: Array<any>) => {
        return countMock(...args);
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

// No socket in a unit test; every subscription hands back a no-op unsubscribe.
jest.mock("../../../UI/Utils/Realtime", () => {
  return {
    __esModule: true,
    default: {
      listenToModelEvent: () => {
        return () => {
          // no-op unsubscribe
        };
      },
    },
  };
});

/*
 * No project selected, so the header skips the on-call lookup and the episode
 * counts entirely. What is left is exactly the part this file is about: the
 * buttons.
 */
jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return null;
      },
      getCurrentProject: () => {
        return null;
      },
      getProjectToSelectOnProjectsLoaded: () => {
        return null;
      },
    },
  };
});

// The project picker asks the server whether project creation is allowed.
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
        // Only ever stringified by the mocked API layer below.
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
        return isMasterAdminMock();
      },
    },
  };
});

import DashboardHeader from "../../../../App/FeatureSet/Dashboard/src/Components/Header/Header";

const INCIDENT_COUNT: number = 2;
const ALERT_COUNT: number = 3;

type RenderHeaderFunction = () => Promise<void>;

const renderHeader: RenderHeaderFunction = async (): Promise<void> => {
  await act(async () => {
    render(
      <DashboardHeader
        projects={[]}
        onProjectSelected={() => {}}
        showProjectModal={false}
        onProjectModalClose={() => {}}
        selectedProject={null}
      />,
    );
  });
};

type GetButtonFunction = (name: RegExp) => HTMLElement;

const getButton: GetButtonFunction = (name: RegExp): HTMLElement => {
  return screen.getByRole("button", { name });
};

type ResetHeaderStateFunction = () => void;

const resetHeaderState: ResetHeaderStateFunction = (): void => {
  cleanup();
  // The theme is applied to <html> and outlives a render.
  document.documentElement.className = "";
  window.localStorage.clear();
  isMasterAdminMock.mockReturnValue(false);
  countMock.mockImplementation(async (args: any) => {
    const modelName: string = args?.modelType?.name || "";

    if (modelName === "Incident") {
      return INCIDENT_COUNT;
    }

    if (modelName === "Alert") {
      return ALERT_COUNT;
    }

    return 0;
  });
};

describe("dashboard header on small screens", () => {
  beforeEach(() => {
    resetHeaderState();
  });

  test("the profile button is on screen at every width, phone included", async () => {
    await renderHeader();

    const profileButton: HTMLElement = getButton(/User Profile/);

    for (const width of [
      PHONE_WIDTH_IN_PX,
      TABLET_WIDTH_IN_PX,
      LAPTOP_WIDTH_IN_PX,
    ]) {
      expect(describeVisibility(profileButton, width)).toBe(
        `visible at ${width}px`,
      );
    }
  });

  test("its menu opens on a phone and carries profile, theme and log out", async () => {
    await renderHeader();

    fireEvent.click(getButton(/User Profile/));

    /*
     * Profile and the theme switch act on the spot, so they carry the button
     * role; log out is a real destination and keeps the link role.
     */
    const entries: Array<HTMLElement> = [
      screen.getByRole("button", { name: "Profile" }),
      screen.getByRole("button", { name: "Dark theme" }),
      screen.getByRole("link", { name: "Log out" }),
    ];

    for (const entry of entries) {
      expect(describeVisibility(entry, PHONE_WIDTH_IN_PX)).toBe(
        "visible at 375px",
      );
    }
  });

  test("log out on a phone points at the logout route", async () => {
    await renderHeader();

    fireEvent.click(getButton(/User Profile/));

    expect(screen.getByRole("link", { name: "Log out" })).toHaveAttribute(
      "href",
      "/dashboard/logout",
    );
  });

  test("a master admin also gets admin settings there", async () => {
    isMasterAdminMock.mockReturnValue(true);

    await renderHeader();

    fireEvent.click(getButton(/User Profile/));

    expect(
      screen.getByRole("button", { name: "Admin Settings" }),
    ).toBeInTheDocument();
  });

  test("the theme switch is reachable on a phone through that menu", async () => {
    /*
     * The header used to carry a standalone theme toggle for small screens —
     * a workaround for the profile menu being unreachable there. The menu is
     * reachable now, so the toggle went away; this is what replaced it.
     */
    await renderHeader();

    // Nothing in the closed header offers the theme any more.
    expect(screen.queryAllByRole("button", { name: /theme/i })).toHaveLength(0);

    fireEvent.click(getButton(/User Profile/));

    fireEvent.click(screen.getByRole("button", { name: "Dark theme" }));

    expect(document.documentElement).toHaveClass("dark");
  });

  test("the notification bell and its badge are on screen at phone width", async () => {
    await renderHeader();

    const bell: HTMLElement = getButton(/View notifications/);

    expect(describeVisibility(bell, PHONE_WIDTH_IN_PX)).toBe(
      "visible at 375px",
    );

    // Two of the alert categories have something in them: incidents and alerts.
    expect(await screen.findByText("2")).toBeInTheDocument();
  });

  test("the bell's panel opens on a phone and lists what is active", async () => {
    await renderHeader();

    fireEvent.click(getButton(/View notifications/));

    expect(
      await screen.findByText(`${INCIDENT_COUNT} Active Incidents`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`${ALERT_COUNT} Active Alerts`),
    ).toBeInTheDocument();
  });

  test("that panel is narrow enough to sit inside a phone screen", async () => {
    /*
     * The panel hangs off the bell, which is a couple of button widths in from
     * the right edge. At a fixed w-80 its left edge lands past the left edge of
     * a 375px viewport, so the fix that put the bell on phones has to bring the
     * panel with it.
     */
    await renderHeader();

    fireEvent.click(getButton(/View notifications/));

    const panel: HTMLElement = (
      await screen.findByText(`${INCIDENT_COUNT} Active Incidents`)
    ).closest("div.absolute") as HTMLElement;

    expect(panel).not.toBeNull();
    expect(panel.className).toContain("w-64");
    expect(panel.className).toContain("sm:w-80");
  });

  test("search, Ask AI and help stay behind on a narrow screen", async () => {
    await renderHeader();

    for (const name of [/Search/, /Ask AI/, /^Help$/]) {
      const button: HTMLElement = getButton(name);

      expect(isVisibleAtWidth(button, PHONE_WIDTH_IN_PX)).toBe(false);
      expect(isVisibleAtWidth(button, TABLET_WIDTH_IN_PX)).toBe(false);
      expect(describeVisibility(button, LAPTOP_WIDTH_IN_PX)).toBe(
        "visible at 1280px",
      );
    }
  });

  test("nothing in the header overflows a phone: the wordmark shrinks instead", async () => {
    await renderHeader();

    const logo: HTMLElement = screen.getByAltText("OneUptime");

    // 5:1 wordmark: h-8 is 160px, nearly half the width of a phone header.
    expect(logo.className).toContain("h-6");
    expect(logo.className).toContain("sm:h-8");
  });
});

/*
 * The same header on a desktop whose browser carries a foreign
 * `.hidden { display: none !important }` — Bootstrap 3 and HTML5 Boilerplate
 * ship exactly that rule, and extensions and user stylesheets inject it.
 *
 * Search, Ask AI and help were wrapped in `hidden lg:flex`. The foreign rule
 * matches the bare class and outranks `lg:flex`, so on that customer's 1917px
 * screen the rail lost all three: the width that is meant to show everything
 * showed the least. `max-lg:hidden lg:flex` paints identically on a clean page
 * and never carries the class the rule targets, which is what these pin.
 */
const WITH_FOREIGN_HIDDEN_RULE: VisibilityOptions = {
  withForeignHiddenRule: true,
};

// Where the wide-screen entries are meant to appear.
const LG_WIDTH_IN_PX: number = TAILWIND_BREAKPOINTS_IN_PX["lg"]!;

const WIDE_SCREEN_WIDTHS_IN_PX: Array<number> = [
  LG_WIDTH_IN_PX,
  LAPTOP_WIDTH_IN_PX,
  WIDE_DESKTOP_WIDTH_IN_PX,
];

const NARROW_SCREEN_WIDTHS_IN_PX: Array<number> = [
  PHONE_WIDTH_IN_PX,
  TABLET_WIDTH_IN_PX,
  LG_WIDTH_IN_PX - 1,
];

const WIDE_SCREEN_ONLY_ENTRIES: Array<RegExp> = [/Search/, /Ask AI/, /^Help$/];

const ALWAYS_ON_SCREEN_ENTRIES: Array<RegExp> = [
  /View notifications/,
  /User Profile/,
];

describe("dashboard header with a foreign .hidden rule on the page", () => {
  beforeEach(() => {
    resetHeaderState();
  });

  test("search, Ask AI and help are on screen from lg up: 1024, 1280 and 1917", async () => {
    await renderHeader();

    for (const name of WIDE_SCREEN_ONLY_ENTRIES) {
      const button: HTMLElement = getButton(name);

      for (const width of WIDE_SCREEN_WIDTHS_IN_PX) {
        expect(
          describeVisibility(button, width, WITH_FOREIGN_HIDDEN_RULE),
        ).toBe(`visible at ${width}px with a foreign .hidden rule on the page`);
      }
    }
  });

  test("they still stay behind below lg, so the fix did not just unhide them", async () => {
    await renderHeader();

    for (const name of WIDE_SCREEN_ONLY_ENTRIES) {
      const button: HTMLElement = getButton(name);

      for (const width of NARROW_SCREEN_WIDTHS_IN_PX) {
        expect(isVisibleAtWidth(button, width, WITH_FOREIGN_HIDDEN_RULE)).toBe(
          false,
        );
        // And on a clean page: the rule must not be what hides them here.
        expect(isVisibleAtWidth(button, width)).toBe(false);
      }
    }
  });

  test("the bell and the profile button are on screen at every width, rule or no rule", async () => {
    await renderHeader();

    for (const name of ALWAYS_ON_SCREEN_ENTRIES) {
      const button: HTMLElement = getButton(name);

      for (const width of [
        ...NARROW_SCREEN_WIDTHS_IN_PX,
        ...WIDE_SCREEN_WIDTHS_IN_PX,
      ]) {
        expect(
          describeVisibility(button, width, WITH_FOREIGN_HIDDEN_RULE),
        ).toBe(`visible at ${width}px with a foreign .hidden rule on the page`);
      }
    }
  });

  test("the customer's screen: at 1917px with the rule, the whole rail is there", async () => {
    await renderHeader();

    const entries: Array<RegExp> = [
      ...WIDE_SCREEN_ONLY_ENTRIES,
      ...ALWAYS_ON_SCREEN_ENTRIES,
    ];

    // One line per entry, so a failure names the entry and what hid it.
    expect(
      entries.map((name: RegExp): string => {
        return `${name.source}: ${describeVisibility(
          getButton(name),
          WIDE_DESKTOP_WIDTH_IN_PX,
          WITH_FOREIGN_HIDDEN_RULE,
        )}`;
      }),
    ).toEqual(
      entries.map((name: RegExp): string => {
        return `${name.source}: visible at 1917px with a foreign .hidden rule on the page`;
      }),
    );
  });

  test("control: with the pre-fix `hidden lg:flex` put back, the same check fails at 1917px", async () => {
    /*
     * Proof that the tests above can fail. The rendered markup is rewritten to
     * the class strings the header shipped before the fix, and the very same
     * assertion now reports each wide-screen entry hidden by its old wrapper.
     */
    await renderHeader();

    restorePreFixMarkup();

    expect(
      describeVisibility(
        getButton(/Search/),
        WIDE_DESKTOP_WIDTH_IN_PX,
        WITH_FOREIGN_HIDDEN_RULE,
      ),
    ).toBe(
      'hidden at 1917px with a foreign .hidden rule on the page by <div class="hidden items-center gap-2 lg:flex">',
    );

    expect(
      describeVisibility(
        getButton(/^Help$/),
        WIDE_DESKTOP_WIDTH_IN_PX,
        WITH_FOREIGN_HIDDEN_RULE,
      ),
    ).toBe(
      'hidden at 1917px with a foreign .hidden rule on the page by <div class="hidden items-center lg:flex">',
    );

    // On a clean page the old markup was fine, which is why nobody saw it.
    expect(
      isVisibleAtWidth(getButton(/Search/), WIDE_DESKTOP_WIDTH_IN_PX),
    ).toBe(true);
  });
});
