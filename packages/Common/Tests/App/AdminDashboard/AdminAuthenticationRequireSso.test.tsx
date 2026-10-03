import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * Admin Dashboard > Settings > Authentication holds the instance-wide
 * "Require SSO for Login" switch (GlobalConfig.requireSsoForLogin). Single
 * sign-on, and requiring it, are part of every edition, so the switch is
 * offered - and can be flipped - on the Community Edition, the Enterprise
 * Edition and OneUptime Cloud alike, with the same sentence everywhere: what
 * the setting does, and nothing about an edition or a license.
 *
 * The switch saves the moment it is flipped and asks before it turns on
 * (AdminSettingsSwitches.test.tsx covers that); here it is the real switch
 * card, with the admin API, the page chrome and the side menu stubbed.
 *
 * Billing and the edition are pinned in every test: CI's config.env sets
 * BILLING_ENABLED=true.
 */

let billingEnabledForTest: boolean = false;
let enterpriseEditionForTest: boolean = false;

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return billingEnabledForTest;
    },
  });

  Object.defineProperty(mocked, "IS_ENTERPRISE_EDITION", {
    get: (): boolean => {
      return enterpriseEditionForTest;
    },
  });

  return mocked;
});

const mockGetItem: MockFunction = getJestMockFunction();

jest.mock("../../../../App/FeatureSet/AdminDashboard/src/Utils/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return mockGetItem(...args);
      },
      updateById: async (): Promise<unknown> => {
        return {};
      },
    },
  };
});

/*
 * A plain card is what replaced the toggle on the Community Edition before;
 * nothing on this page renders one now.
 */
jest.mock("../../../UI/Components/Card/Card", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Components/Card/Card",
  ) as Record<string, unknown>;

  const RealCard: (props: Record<string, unknown>) => ReactElement =
    actual["default"] as (props: Record<string, unknown>) => ReactElement;

  return {
    ...actual,
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      // The switch cards bring their switch; a card without one is a notice.
      if (!props["children"]) {
        return (
          <div data-testid="plain-card">
            {props["title"] as string}
            {props["description"] as string}
          </div>
        );
      }

      return <RealCard {...props} />;
    },
  };
});

jest.mock("../../../UI/Components/Page/Page", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;

  return {
    __esModule: true,
    default: (props: { children?: React.ReactNode }) => {
      return react.createElement(
        "div",
        { "data-testid": "settings-page" },
        props.children,
      );
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/SideMenu",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

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

import AuthenticationSettings from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/Authentication/Index";
import {
  PROJECT_CREATION_SWITCH_TEST_ID,
  REQUIRE_SSO_COPY,
  REQUIRE_SSO_SWITCH_TEST_ID,
  SIGN_UP_SWITCH_TEST_ID,
} from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/Authentication/AuthenticationSwitchesCopy";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import ObjectID from "../../../Types/ObjectID";
import UserUtil from "../../../UI/Utils/User";

// What the switch says it does, in every edition (GlobalConfig's own column description).
const TOGGLE_DESCRIPTION: string =
  "When enabled, all users must sign in with SSO to access any project on this server. Master admins are exempt so they can always recover from a misconfigured SSO. A project's own SSO settings still apply on top of this.";

// Nothing about the setting depends on an edition or a license.
const EDITION_OR_LICENSE_WORDING: RegExp =
  /licen[cs]e|trial|grace|Enterprise|Community|not enforced|expired/i;

// The notice the Community Edition showed in place of the toggle, retired.
const RETIRED_COMMUNITY_NOTICE: string =
  "Requiring SSO for login is part of the OneUptime Enterprise Edition. This server runs the Community Edition, where users sign in with their email and password, so this setting is not enforced here. A value saved earlier is kept and is enforced again if this server runs the Enterprise Edition.";

const COMMUNITY_NOTICE: RegExp =
  /Requiring SSO for login is part of the OneUptime Enterprise Edition|A value saved earlier is kept/;

// The license-lapse sentence the toggle carried, retired.
const RETIRED_TOGGLE_LAPSE_DESCRIPTION: string = `${TOGGLE_DESCRIPTION} On a self-hosted server this is not enforced while the Enterprise license is missing or expired (after the 14-day trial, or 30 days after a license expires), because SSO sign-in stops then too: users sign in with their password until a license is activated.`;

interface EditionCase {
  name: string;
  enterprise: boolean;
  billing: boolean;
}

const EDITIONS: Array<EditionCase> = [
  { name: "the Community Edition", enterprise: false, billing: false },
  {
    name: "the Community Edition image with billing on",
    enterprise: false,
    billing: true,
  },
  { name: "the Enterprise Edition", enterprise: true, billing: false },
  {
    name: "OneUptime Cloud (Enterprise Edition, billing on)",
    enterprise: true,
    billing: true,
  },
];

async function renderPage(): Promise<void> {
  render(<AuthenticationSettings />);

  await act(async () => {
    for (let i: number = 0; i < 8; i++) {
      await Promise.resolve();
    }
  });
}

describe("Admin Dashboard authentication settings: Require SSO for Login", () => {
  beforeEach(() => {
    billingEnabledForTest = false;
    enterpriseEditionForTest = false;

    mockGetItem.mockReset();
    mockGetItem.mockImplementation(async (): Promise<GlobalConfig> => {
      const config: GlobalConfig = new GlobalConfig();
      config._id = ObjectID.getZeroObjectID().toString();
      return config;
    });

    getJestSpyOn(UserUtil, "isMasterAdmin").mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    billingEnabledForTest = false;
    enterpriseEditionForTest = false;
  });

  describe.each(EDITIONS)("$name", (edition: EditionCase) => {
    beforeEach(() => {
      enterpriseEditionForTest = edition.enterprise;
      billingEnabledForTest = edition.billing;
    });

    test("offers the switch, unlocked, on the instance-wide settings", async () => {
      await renderPage();

      const control: HTMLElement = screen.getByRole("switch", {
        name: REQUIRE_SSO_COPY.switchTitle,
      });

      expect(control).toBe(screen.getByTestId(REQUIRE_SSO_SWITCH_TEST_ID));
      expect(control).not.toHaveAttribute("aria-disabled");
      expect(screen.getByText(REQUIRE_SSO_COPY.cardTitle)).toBeInTheDocument();
      expect(
        screen.getByText(
          "Control whether users must sign in with SSO across this server.",
        ),
      ).toBeInTheDocument();

      // GlobalConfig is a single row with the zero id.
      const reads: Array<{ id: ObjectID; select: Record<string, unknown> }> =
        mockGetItem.mock.calls.map(
          (call: Array<unknown>): { id: ObjectID; select: Record<string, unknown> } => {
            return call[0] as { id: ObjectID; select: Record<string, unknown> };
          },
        );
      const ssoRead: { id: ObjectID; select: Record<string, unknown> } | undefined =
        reads.find(
          (read: { id: ObjectID; select: Record<string, unknown> }): boolean => {
            return Boolean(read.select["requireSsoForLogin"]);
          },
        );

      expect(ssoRead?.id.toString()).toBe(
        "00000000-0000-0000-0000-000000000000",
      );
    });

    test("describes what the setting does, and nothing about an edition or a license", async () => {
      await renderPage();

      const control: HTMLElement = screen.getByTestId(
        REQUIRE_SSO_SWITCH_TEST_ID,
      );
      const descriptionId: string =
        control.getAttribute("aria-describedby") || "";
      const description: string =
        document.getElementById(descriptionId)?.textContent || "";

      expect(description).toBe(TOGGLE_DESCRIPTION);
      expect(description).not.toMatch(EDITION_OR_LICENSE_WORDING);
    });

    test("shows no notice in place of the switch", async () => {
      await renderPage();

      expect(screen.queryByTestId("plain-card")).not.toBeInTheDocument();
      expect(screen.queryByText(COMMUNITY_NOTICE)).not.toBeInTheDocument();
      expect(screen.getByTestId("settings-page")).not.toHaveTextContent(
        /Enterprise Edition|Community Edition|Enterprise license/,
      );
    });

    test("keeps the three settings in their order", async () => {
      await renderPage();

      const switches: Array<string> = screen
        .getAllByRole("switch")
        .map((control: HTMLElement): string => {
          return control.getAttribute("data-testid") || "";
        });

      expect(switches).toEqual([
        SIGN_UP_SWITCH_TEST_ID,
        REQUIRE_SSO_SWITCH_TEST_ID,
        PROJECT_CREATION_SWITCH_TEST_ID,
      ]);
    });
  });

  test("the switch says what GlobalConfig documents for the column", () => {
    expect(
      new GlobalConfig().getTableColumnMetadata("requireSsoForLogin")
        .description,
    ).toBe(TOGGLE_DESCRIPTION);
    expect(REQUIRE_SSO_COPY.note).toBe(TOGGLE_DESCRIPTION);
  });

  // The checks above would catch the retired copy if it came back.
  test("the checks reject the retired Community notice and license-lapse sentence (negative control)", () => {
    expect(COMMUNITY_NOTICE.test(RETIRED_COMMUNITY_NOTICE)).toBe(true);
    expect(EDITION_OR_LICENSE_WORDING.test(RETIRED_COMMUNITY_NOTICE)).toBe(
      true,
    );
    expect(RETIRED_TOGGLE_LAPSE_DESCRIPTION).not.toBe(TOGGLE_DESCRIPTION);
    expect(
      EDITION_OR_LICENSE_WORDING.test(RETIRED_TOGGLE_LAPSE_DESCRIPTION),
    ).toBe(true);
    // ...while the current copy passes them.
    expect(COMMUNITY_NOTICE.test(TOGGLE_DESCRIPTION)).toBe(false);
    expect(EDITION_OR_LICENSE_WORDING.test(TOGGLE_DESCRIPTION)).toBe(false);

    for (const text of Object.values(REQUIRE_SSO_COPY)) {
      expect(EDITION_OR_LICENSE_WORDING.test(text)).toBe(false);
    }
  });
});
