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
  describeVisibility,
  isVisibleAtWidth,
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

describe("admin dashboard header on small screens", () => {
  beforeEach(() => {
    cleanup();
    document.documentElement.className = "";
    window.localStorage.clear();
    isMasterAdminMock.mockReturnValue(true);
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
