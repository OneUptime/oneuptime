import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";

/*
 * Admin Dashboard > Settings > Authentication holds the instance-wide
 * "Require SSO for Login" toggle (GlobalConfig.requireSsoForLogin). Single
 * sign-on, and requiring it, are part of every edition, so the toggle is
 * offered - and editable - on the Community Edition, the Enterprise Edition
 * and OneUptime Cloud alike, with the same description everywhere: what the
 * setting does, and nothing about an edition or a license.
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

interface CardModelDetailField {
  field: Record<string, boolean>;
  description?: string | undefined;
}

interface CardModelDetailProps {
  name: string;
  cardProps: { title: string; description?: string | undefined };
  isEditable?: boolean | undefined;
  formFields: Array<CardModelDetailField>;
  modelDetailProps: {
    id: string;
    modelId: { toString: () => string };
    fields: Array<CardModelDetailField>;
  };
}

/*
 * Each settings card, reduced to its name, whether it can be edited, the
 * columns its form edits (with their descriptions) and the descriptions of
 * the read-only details it shows.
 */
jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: CardModelDetailProps): ReactElement => {
      return (
        <section
          data-testid={`card-${props.name}`}
          data-editable={String(props.isEditable)}
          data-detail-id={props.modelDetailProps.id}
          data-model-id={props.modelDetailProps.modelId.toString()}
        >
          <h2>{props.cardProps.title}</h2>
          <p data-testid={`card-description-${props.name}`}>
            {props.cardProps.description || ""}
          </p>
          {props.formFields.map((formField: CardModelDetailField) => {
            const column: string = Object.keys(formField.field)[0] || "";
            return (
              <span key={column} data-testid={`edits-${column}`}>
                {column}
                <span data-testid={`describes-${column}`}>
                  {formField.description || ""}
                </span>
              </span>
            );
          })}
          {props.modelDetailProps.fields.map(
            (detailField: CardModelDetailField) => {
              const column: string = Object.keys(detailField.field)[0] || "";
              return (
                <span key={column} data-testid={`shows-${column}`}>
                  {detailField.description || ""}
                </span>
              );
            },
          )}
        </section>
      );
    },
  };
});

/*
 * A plain card is what replaced the toggle on the Community Edition before;
 * nothing on this page renders one now.
 */
jest.mock("../../../UI/Components/Card/Card", () => {
  return {
    __esModule: true,
    default: (props: { title?: string; description?: string }) => {
      return (
        <div data-testid="plain-card">
          {props.title}
          {props.description}
        </div>
      );
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
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";

// What the toggle says it does, in every edition (GlobalConfig's own column description).
const TOGGLE_DESCRIPTION: string =
  "When enabled, all users must sign in with SSO to access any project on this server. Master admins are exempt so they can always recover from a misconfigured SSO. A project's own SSO settings still apply on top of this.";

// What the saved value's read-only view says.
const DETAIL_DESCRIPTION: string =
  "When enabled, all users must sign in with SSO to access any project on this server. Master admins are exempt.";

// Nothing about the setting depends on an edition or a license.
const EDITION_OR_LICENSE_WORDING: RegExp =
  /licen[cs]e|trial|grace|Enterprise|Community|not enforced|expired/i;

// The notice the Community Edition showed in place of the toggle, retired.
const RETIRED_COMMUNITY_NOTICE: string =
  "Requiring SSO for login is part of the OneUptime Enterprise Edition. This server runs the Community Edition, where users sign in with their email and password, so this setting is not enforced here. A value saved earlier is kept and is enforced again if this server runs the Enterprise Edition.";

const COMMUNITY_NOTICE: RegExp =
  /Requiring SSO for login is part of the OneUptime Enterprise Edition|A value saved earlier is kept/;

// The license-lapse sentences the toggle and its detail carried, retired.
const RETIRED_TOGGLE_LAPSE_DESCRIPTION: string = `${TOGGLE_DESCRIPTION} On a self-hosted server this is not enforced while the Enterprise license is missing or expired (after the 14-day trial, or 30 days after a license expires), because SSO sign-in stops then too: users sign in with their password until a license is activated.`;

const RETIRED_DETAIL_LAPSE_DESCRIPTION: string = `${DETAIL_DESCRIPTION} Not enforced while the Enterprise license is missing or expired.`;

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

describe("Admin Dashboard authentication settings: Require SSO for Login", () => {
  beforeEach(() => {
    billingEnabledForTest = false;
    enterpriseEditionForTest = false;
  });

  afterEach(() => {
    cleanup();
    billingEnabledForTest = false;
    enterpriseEditionForTest = false;
  });

  describe.each(EDITIONS)("$name", (edition: EditionCase) => {
    beforeEach(() => {
      enterpriseEditionForTest = edition.enterprise;
      billingEnabledForTest = edition.billing;
    });

    test("offers the toggle, editable, on the instance-wide settings", () => {
      render(<AuthenticationSettings />);

      const card: HTMLElement = screen.getByTestId("card-SSO Settings");

      expect(card).toHaveAttribute("data-editable", "true");
      expect(card).toHaveAttribute(
        "data-detail-id",
        "model-detail-sso-settings",
      );
      // GlobalConfig is a single row with the zero id.
      expect(card).toHaveAttribute(
        "data-model-id",
        "00000000-0000-0000-0000-000000000000",
      );
      expect(card).toHaveTextContent("Single Sign-On (SSO)");
      expect(
        screen.getByTestId("card-description-SSO Settings"),
      ).toHaveTextContent(
        "Control whether users must sign in with SSO across this server.",
      );
      expect(
        screen.getByTestId("edits-requireSsoForLogin"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("shows-requireSsoForLogin"),
      ).toBeInTheDocument();
    });

    test("describes what the setting does, and nothing about an edition or a license", () => {
      render(<AuthenticationSettings />);

      const toggle: HTMLElement = screen.getByTestId(
        "describes-requireSsoForLogin",
      );
      const detail: HTMLElement = screen.getByTestId(
        "shows-requireSsoForLogin",
      );

      expect(toggle.textContent).toBe(TOGGLE_DESCRIPTION);
      expect(detail.textContent).toBe(DETAIL_DESCRIPTION);
      expect(toggle.textContent).not.toMatch(EDITION_OR_LICENSE_WORDING);
      expect(detail.textContent).not.toMatch(EDITION_OR_LICENSE_WORDING);
    });

    test("shows no notice in place of the toggle", () => {
      render(<AuthenticationSettings />);

      expect(screen.queryByTestId("plain-card")).not.toBeInTheDocument();
      expect(screen.queryByText(COMMUNITY_NOTICE)).not.toBeInTheDocument();
      expect(screen.getByTestId("settings-page")).not.toHaveTextContent(
        /Enterprise Edition|Community Edition|Enterprise license/,
      );
    });

    test("keeps the three settings cards in their order", () => {
      render(<AuthenticationSettings />);

      const cards: Array<string> = screen
        .getAllByTestId(/^card-(?!description-)/)
        .map((card: HTMLElement) => {
          return card.getAttribute("data-testid") || "";
        });

      expect(cards).toEqual([
        "card-Authentication Settings",
        "card-SSO Settings",
        "card-Project Creation Settings",
      ]);
      expect(screen.getByTestId("edits-disableSignup")).toBeInTheDocument();
      expect(
        screen.getByTestId("edits-disableUserProjectCreation"),
      ).toBeInTheDocument();
    });
  });

  test("the toggle says what GlobalConfig documents for the column", () => {
    expect(
      new GlobalConfig().getTableColumnMetadata("requireSsoForLogin")
        .description,
    ).toBe(TOGGLE_DESCRIPTION);
  });

  // The checks above would catch the retired copy if it came back.
  test("the checks reject the retired Community notice and license-lapse sentences (negative control)", () => {
    expect(COMMUNITY_NOTICE.test(RETIRED_COMMUNITY_NOTICE)).toBe(true);
    expect(EDITION_OR_LICENSE_WORDING.test(RETIRED_COMMUNITY_NOTICE)).toBe(
      true,
    );
    expect(RETIRED_TOGGLE_LAPSE_DESCRIPTION).not.toBe(TOGGLE_DESCRIPTION);
    expect(
      EDITION_OR_LICENSE_WORDING.test(RETIRED_TOGGLE_LAPSE_DESCRIPTION),
    ).toBe(true);
    expect(
      EDITION_OR_LICENSE_WORDING.test(RETIRED_DETAIL_LAPSE_DESCRIPTION),
    ).toBe(true);
    // ...while the current copy passes them.
    expect(COMMUNITY_NOTICE.test(TOGGLE_DESCRIPTION)).toBe(false);
    expect(EDITION_OR_LICENSE_WORDING.test(TOGGLE_DESCRIPTION)).toBe(false);
    expect(EDITION_OR_LICENSE_WORDING.test(DETAIL_DESCRIPTION)).toBe(false);
  });
});
