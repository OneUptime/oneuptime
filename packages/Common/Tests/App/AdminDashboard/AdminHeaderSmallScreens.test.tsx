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
import englishLocale from "../../../../App/FeatureSet/AdminDashboard/src/Locales/en.json";

/*
 * The admin dashboard header shares Common's <Header>, so it inherited the same
 * `hidden lg:flex` right rail and lost the same things below 1024px: help, the
 * profile button, and — because the profile menu is where they live — log out,
 * the theme switch and the way back out of admin. An admin on a tablet was
 * stuck on the page they were on.
 */

const ASSET_DATA_URL: string = "data:image/svg+xml;base64,bG9nbw==";

jest.mock("../../../UI/Images/logos/OneUptimeSVG/3-transparent.svg", () => {
  return ASSET_DATA_URL;
});

/*
 * BILLING_ENABLED is read from the environment (UI/Config), and EditionLabel
 * returns an empty fragment when it is on — oneuptime.com bounds plans through
 * subscriptions and shows no edition pill at all. So the pill these tests are
 * about only exists on a self-hosted header, and without pinning the flag the
 * suite passes or fails depending on whether BILLING_ENABLED happened to be
 * exported into the jest process: green locally, red in CI, which is how it
 * reached master.
 *
 * Pinned false, which is the deployment whose layout is under test. Same
 * approach as EditionLabelLicenseStatus.test.tsx.
 */
jest.mock("../../../UI/Config", () => {
  const actualConfig: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  const mockedConfig: Record<string, unknown> = { ...actualConfig };

  Object.defineProperty(mockedConfig, "BILLING_ENABLED", {
    get: (): boolean => {
      return false;
    },
  });

  return mockedConfig;
});

type LocaleValue = string | { [key: string]: LocaleValue };

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

const translate: (key: string, fallback?: string) => string = (
  key: string,
  fallback?: string,
): string => {
  return lookUpTranslation(key) ?? fallback ?? key;
};

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, fallback?: string): string => {
          return translate(key, fallback);
        },
      };
    },
  };
});

const isMasterAdminMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: () => {
        return isMasterAdminMock();
      },
    },
  };
});

import AdminDashboardHeader from "../../../../App/FeatureSet/AdminDashboard/src/Components/Header/Header";

type RenderHeaderFunction = () => Promise<void>;

const renderHeader: RenderHeaderFunction = async (): Promise<void> => {
  await act(async () => {
    render(<AdminDashboardHeader />);
  });
};

type ResetHeaderStateFunction = () => void;

const resetHeaderState: ResetHeaderStateFunction = (): void => {
  cleanup();
  document.documentElement.className = "";
  window.localStorage.clear();
  isMasterAdminMock.mockReturnValue(true);
};

describe("admin dashboard header on small screens", () => {
  beforeEach(() => {
    resetHeaderState();
  });

  test("the profile button is on screen at every width, phone included", async () => {
    await renderHeader();

    const profileButton: HTMLElement = screen.getByRole("button", {
      name: /User Profile/,
    });

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

  test("help is on screen at phone width too", async () => {
    await renderHeader();

    expect(
      describeVisibility(
        screen.getByRole("button", { name: "Help" }),
        PHONE_WIDTH_IN_PX,
      ),
    ).toBe("visible at 375px");
  });

  test("log out and the theme switch are reachable from a phone", async () => {
    await renderHeader();

    expect(screen.queryAllByRole("button", { name: /theme/i })).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: /User Profile/ }));

    expect(
      describeVisibility(
        screen.getByRole("link", { name: "Log out" }),
        PHONE_WIDTH_IN_PX,
      ),
    ).toBe("visible at 375px");

    fireEvent.click(screen.getByRole("button", { name: "Dark theme" }));

    expect(document.documentElement).toHaveClass("dark");
  });

  test("the standalone Exit Admin button is wide-screen only, and the menu covers it", async () => {
    await renderHeader();

    const standaloneExit: HTMLElement = screen.getByRole("button", {
      name: "Exit Admin",
    });

    expect(isVisibleAtWidth(standaloneExit, PHONE_WIDTH_IN_PX)).toBe(false);
    expect(isVisibleAtWidth(standaloneExit, LAPTOP_WIDTH_IN_PX)).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /User Profile/ }));

    const exitEntries: Array<HTMLElement> = screen.getAllByRole("button", {
      name: "Exit Admin",
    });

    // The menu copy is the one a phone can actually reach.
    expect(
      exitEntries.filter((entry: HTMLElement) => {
        return isVisibleAtWidth(entry, PHONE_WIDTH_IN_PX);
      }),
    ).toHaveLength(1);
  });

  test("someone who is not a master admin still gets log out on a phone", async () => {
    isMasterAdminMock.mockReturnValue(false);

    await renderHeader();

    fireEvent.click(screen.getByRole("button", { name: /User Profile/ }));

    expect(
      describeVisibility(
        screen.getByRole("link", { name: "Log out" }),
        PHONE_WIDTH_IN_PX,
      ),
    ).toBe("visible at 375px");

    /*
     * The menu only offers Exit Admin to a master admin, so all that is left is
     * the standalone button — which a phone cannot see. That is the point: the
     * action nobody else is entitled to stays absent rather than half-present.
     */
    expect(
      screen
        .getAllByRole("button", { name: "Exit Admin" })
        .filter((entry: HTMLElement) => {
          return isVisibleAtWidth(entry, PHONE_WIDTH_IN_PX);
        }),
    ).toHaveLength(0);
  });
});

/*
 * The admin header under a foreign `.hidden { display: none !important }`
 * (Bootstrap 3, HTML5 Boilerplate, browser extensions, user stylesheets).
 *
 * Its two wide-screen-only entries — the edition pill and the standalone Exit
 * Admin button — used `hidden md:inline-flex` and `hidden lg:flex`. The rule
 * matches the bare class and beats the breakpoint utility, so an admin with
 * such a browser lost both on every screen, a wide desktop included. They now
 * use `max-md:hidden` / `max-lg:hidden`, which paint the same on a clean page
 * and never carry the class the rule targets.
 */
const WITH_FOREIGN_HIDDEN_RULE: VisibilityOptions = {
  withForeignHiddenRule: true,
};

const MD_WIDTH_IN_PX: number = TAILWIND_BREAKPOINTS_IN_PX["md"]!;
const LG_WIDTH_IN_PX: number = TAILWIND_BREAKPOINTS_IN_PX["lg"]!;

const EVERY_WIDTH_IN_PX: Array<number> = [
  PHONE_WIDTH_IN_PX,
  MD_WIDTH_IN_PX - 1,
  TABLET_WIDTH_IN_PX,
  LG_WIDTH_IN_PX - 1,
  LG_WIDTH_IN_PX,
  LAPTOP_WIDTH_IN_PX,
  WIDE_DESKTOP_WIDTH_IN_PX,
];

type WidthsFromFunction = (minimumWidthInPx: number) => Array<number>;

const widthsFrom: WidthsFromFunction = (
  minimumWidthInPx: number,
): Array<number> => {
  return EVERY_WIDTH_IN_PX.filter((width: number): boolean => {
    return width >= minimumWidthInPx;
  });
};

const widthsBelow: WidthsFromFunction = (
  minimumWidthInPx: number,
): Array<number> => {
  return EVERY_WIDTH_IN_PX.filter((width: number): boolean => {
    return width < minimumWidthInPx;
  });
};

type GetElementFunction = () => HTMLElement;

// The edition pill's accessible name leads with the edition it reports.
const getEditionPill: GetElementFunction = (): HTMLElement => {
  return screen.getByRole("button", { name: /Edition/ });
};

// Before the profile menu opens, the standalone button is the only one.
const getStandaloneExitAdmin: GetElementFunction = (): HTMLElement => {
  return screen.getByRole("button", { name: "Exit Admin" });
};

describe("admin dashboard header with a foreign .hidden rule on the page", () => {
  beforeEach(() => {
    resetHeaderState();
  });

  test("the edition pill is on screen from md up with the rule, and stays behind below md", async () => {
    await renderHeader();

    const pill: HTMLElement = getEditionPill();

    for (const width of widthsFrom(MD_WIDTH_IN_PX)) {
      expect(describeVisibility(pill, width, WITH_FOREIGN_HIDDEN_RULE)).toBe(
        `visible at ${width}px with a foreign .hidden rule on the page`,
      );
    }

    for (const width of widthsBelow(MD_WIDTH_IN_PX)) {
      expect(isVisibleAtWidth(pill, width, WITH_FOREIGN_HIDDEN_RULE)).toBe(
        false,
      );
      expect(isVisibleAtWidth(pill, width)).toBe(false);
    }
  });

  test("the standalone Exit Admin is on screen from lg up with the rule, and stays behind below lg", async () => {
    await renderHeader();

    const exitAdmin: HTMLElement = getStandaloneExitAdmin();

    for (const width of widthsFrom(LG_WIDTH_IN_PX)) {
      expect(
        describeVisibility(exitAdmin, width, WITH_FOREIGN_HIDDEN_RULE),
      ).toBe(`visible at ${width}px with a foreign .hidden rule on the page`);
    }

    for (const width of widthsBelow(LG_WIDTH_IN_PX)) {
      expect(isVisibleAtWidth(exitAdmin, width, WITH_FOREIGN_HIDDEN_RULE)).toBe(
        false,
      );
      expect(isVisibleAtWidth(exitAdmin, width)).toBe(false);
    }
  });

  test("help and the profile button are on screen at every width with the rule", async () => {
    await renderHeader();

    for (const button of [
      screen.getByRole("button", { name: "Help" }),
      screen.getByRole("button", { name: /User Profile/ }),
    ]) {
      for (const width of EVERY_WIDTH_IN_PX) {
        expect(
          describeVisibility(button, width, WITH_FOREIGN_HIDDEN_RULE),
        ).toBe(`visible at ${width}px with a foreign .hidden rule on the page`);
      }
    }
  });

  test("at the customer's 1917px with the rule, the edition pill, Exit Admin, help and profile are all there", async () => {
    await renderHeader();

    const entries: Array<[string, HTMLElement]> = [
      ["edition pill", getEditionPill()],
      ["Exit Admin", getStandaloneExitAdmin()],
      ["Help", screen.getByRole("button", { name: "Help" })],
      ["User Profile", screen.getByRole("button", { name: /User Profile/ })],
    ];

    expect(
      entries.map(([label, element]: [string, HTMLElement]): string => {
        return `${label}: ${describeVisibility(
          element,
          WIDE_DESKTOP_WIDTH_IN_PX,
          WITH_FOREIGN_HIDDEN_RULE,
        )}`;
      }),
    ).toEqual(
      entries.map(([label]: [string, HTMLElement]): string => {
        return `${label}: visible at 1917px with a foreign .hidden rule on the page`;
      }),
    );
  });

  test("control: with the pre-fix classes put back, the same check fails at 1917px", async () => {
    /*
     * Proof that the tests above can fail: rewrite the rendered markup to what
     * the header shipped before the fix and ask the very same question.
     */
    await renderHeader();

    restorePreFixMarkup();

    const exitAdmin: HTMLElement = getStandaloneExitAdmin();

    expect(
      describeVisibility(
        exitAdmin,
        WIDE_DESKTOP_WIDTH_IN_PX,
        WITH_FOREIGN_HIDDEN_RULE,
      ),
    ).toBe(
      'hidden at 1917px with a foreign .hidden rule on the page by <div class="hidden items-center lg:flex">',
    );

    const pill: HTMLElement = getEditionPill();

    expect(pill.getAttribute("class")).toContain("mr-3 hidden md:inline-flex");
    expect(
      isVisibleAtWidth(
        pill,
        WIDE_DESKTOP_WIDTH_IN_PX,
        WITH_FOREIGN_HIDDEN_RULE,
      ),
    ).toBe(false);

    // On a clean page the old markup was fine, which is why nobody saw it.
    expect(isVisibleAtWidth(exitAdmin, WIDE_DESKTOP_WIDTH_IN_PX)).toBe(true);
    expect(isVisibleAtWidth(pill, WIDE_DESKTOP_WIDTH_IN_PX)).toBe(true);
  });
});
