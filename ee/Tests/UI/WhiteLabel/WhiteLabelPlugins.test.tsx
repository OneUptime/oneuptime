import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

/*
 * Settings > White Label in the Admin Dashboard, as the Enterprise image
 * builds it: "@oneuptime/ee-admin-dashboard" is the REAL ee/AdminDashboard
 * here, so core's Settings side menu reads the real plugin.
 *
 * What these pin:
 *   - the plugin adds one settings page, at /admin/settings/white-label, lazy,
 *     and one side-menu entry;
 *   - core's Settings side menu shows "White Label" only while env.js says
 *     the installation may white-label itself (PRODUCT_BRANDING), and
 *     otherwise nothing at all - not hidden, not disabled: absent;
 *   - every other Settings entry is there either way.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string): string => {
          return key;
        },
      };
    },
  };
});

import Navigation from "Common/UI/Utils/Navigation";
import EnterprisePlugins from "../../../AdminDashboard/Index";
import WhiteLabelPlugins from "../../../AdminDashboard/WhiteLabel/Plugins";
import WhiteLabelSideMenuItem from "../../../AdminDashboard/WhiteLabel/WhiteLabelSideMenuItem";
import {
  isWhiteLabelAvailable,
  WHITE_LABEL_IMAGE_RULES,
  WHITE_LABEL_SETTINGS_PAGE_PATH,
  WhiteLabelImageSlot,
} from "../../../AdminDashboard/WhiteLabel/WhiteLabelSettingsAPI";
import {
  EnterpriseSettingsPage,
  getEnterpriseSettingsPageRoute,
} from "@oneuptime/admin-dashboard/Enterprise/EnterprisePlugins";
import SettingsSideMenu from "@oneuptime/admin-dashboard/Pages/Settings/SideMenu";

const WHITE_LABEL_WORDS: RegExp = /white.?label/i;

const setBrandingEnvironment: (value: string | null) => void = (
  value: string | null,
): void => {
  const windowWithProcess: { process?: { env?: Record<string, unknown> } } =
    window as unknown as { process?: { env?: Record<string, unknown> } };

  windowWithProcess.process = windowWithProcess.process || {};
  windowWithProcess.process.env = windowWithProcess.process.env || {};

  if (value === null) {
    delete windowWithProcess.process.env["PRODUCT_BRANDING"];
  } else {
    windowWithProcess.process.env["PRODUCT_BRANDING"] = value;
  }
};

afterEach(() => {
  cleanup();
  setBrandingEnvironment(null);
  jest.restoreAllMocks();
});

describe("the White Label plugin", () => {
  test("adds one settings page at /admin/settings/white-label, downloaded only when opened", () => {
    const pages: ReadonlyArray<EnterpriseSettingsPage> =
      WhiteLabelPlugins.SettingsPages || [];

    expect(pages).toHaveLength(1);
    expect(pages[0]!.path).toBe(WHITE_LABEL_SETTINGS_PAGE_PATH);
    expect(getEnterpriseSettingsPageRoute(pages[0]!.path).toString()).toBe(
      "/admin/settings/white-label",
    );
    // React.lazy: an exotic component with a $$typeof, not a plain function.
    expect(typeof pages[0]!.component).toBe("object");
  });

  test("adds the side menu entry", () => {
    expect(WhiteLabelPlugins.SettingsSideMenuItems).toBe(
      WhiteLabelSideMenuItem,
    );
  });

  test("is part of the Enterprise Admin Dashboard plugin", () => {
    expect(EnterprisePlugins.SettingsPages).toBe(
      WhiteLabelPlugins.SettingsPages,
    );
    expect(EnterprisePlugins.SettingsSideMenuItems).toBe(
      WhiteLabelSideMenuItem,
    );
  });
});

describe("isWhiteLabelAvailable", () => {
  test.each([
    ["no PRODUCT_BRANDING", null, false],
    ["an empty PRODUCT_BRANDING", "", false],
    ["a PRODUCT_BRANDING that is not JSON", "{", false],
    ["a PRODUCT_BRANDING that is a list", "[]", false],
    ["PRODUCT_BRANDING {} (allowed, nothing set)", "{}", true],
    ["a PRODUCT_BRANDING with a name", '{"productName":"Acme"}', true],
  ])("%s: %s", (_label: string, value: string | null, isAvailable: boolean) => {
    setBrandingEnvironment(value);

    expect(isWhiteLabelAvailable()).toBe(isAvailable);
  });
});

describe("WhiteLabelSideMenuItem", () => {
  test("draws nothing at all while white-labelling is not allowed", () => {
    const { container } = render(<WhiteLabelSideMenuItem />);

    expect(container).toBeEmptyDOMElement();
  });

  test("links to the White Label page when it is allowed", () => {
    setBrandingEnvironment("{}");
    jest.spyOn(Navigation, "isOnThisPage").mockReturnValue(false);

    render(<WhiteLabelSideMenuItem />);

    expect(screen.getByText("White Label").closest("a")).toHaveAttribute(
      "href",
      "/admin/settings/white-label",
    );
  });
});

describe("core's Settings side menu with the Enterprise plugin", () => {
  const renderMenu: () => void = (): void => {
    jest.spyOn(Navigation, "isOnThisPage").mockReturnValue(false);
    render(<SettingsSideMenu />);
  };

  test("shows no White Label entry while white-labelling is not allowed", () => {
    renderMenu();

    expect(screen.queryByText("White Label")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(WHITE_LABEL_WORDS);
    expect(
      screen.getAllByText("sideMenu.settingsAuthentication").length,
    ).toBeGreaterThan(0);
    expect(document.querySelector('a[href*="white-label"]')).toBeNull();
  });

  test("shows it in Basic, right after Authentication, when allowed", () => {
    setBrandingEnvironment('{"productName":"Acme"}');
    renderMenu();

    const entry: HTMLElement = screen.getByText("White Label");
    const authentication: HTMLElement = screen.getAllByText(
      "sideMenu.settingsAuthentication",
    )[0] as HTMLElement;

    expect(entry.closest("a")).toHaveAttribute(
      "href",
      "/admin/settings/white-label",
    );
    expect(
      authentication.compareDocumentPosition(entry) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("the upload rules the page checks before sending", () => {
  test("match the server's: 512 KB logos, a 128 KB tab icon, ICO only for the icon", () => {
    expect(WHITE_LABEL_IMAGE_RULES[WhiteLabelImageSlot.Logo].maxBytes).toBe(
      512 * 1024,
    );
    expect(
      WHITE_LABEL_IMAGE_RULES[WhiteLabelImageSlot.DarkLogo].maxBytes,
    ).toBe(512 * 1024);
    expect(
      WHITE_LABEL_IMAGE_RULES[WhiteLabelImageSlot.Favicon].maxBytes,
    ).toBe(128 * 1024);
    expect(WHITE_LABEL_IMAGE_RULES[WhiteLabelImageSlot.Logo].accept).not.toContain(
      "ico",
    );
    expect(
      WHITE_LABEL_IMAGE_RULES[WhiteLabelImageSlot.Favicon].accept,
    ).toContain(".ico");
  });
});
