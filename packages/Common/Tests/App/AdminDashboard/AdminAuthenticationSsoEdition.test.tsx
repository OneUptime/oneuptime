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
 * Admin Dashboard > Settings > Authentication has the instance-wide "Require
 * SSO for Login" toggle. SSO login is part of the Enterprise Edition, which
 * the cloud (billing on) also runs, so the toggle is offered there. On the
 * Community Edition the server does not enforce the setting (design v2
 * section 0), so the page does not offer it as if it did something: it says
 * the setting is an Enterprise Edition feature, that it is not enforced here,
 * and that a saved value is kept.
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

interface CardModelDetailFormField {
  field: Record<string, boolean>;
  description?: string | undefined;
}

interface CardModelDetailProps {
  name: string;
  cardProps: { title: string };
  formFields: Array<CardModelDetailFormField>;
}

// Each settings card, reduced to its name, the columns its form edits and their descriptions.
jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: CardModelDetailProps): ReactElement => {
      return (
        <section data-testid={`card-${props.name}`}>
          <h2>{props.cardProps.title}</h2>
          {props.formFields.map((formField: CardModelDetailFormField) => {
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
        </section>
      );
    },
  };
});

jest.mock("../../../UI/Components/Page/Page", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;

  return {
    __esModule: true,
    default: (props: { children?: React.ReactNode }) => {
      return react.createElement("div", null, props.children);
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

const CE_NOTICE: RegExp =
  /Requiring SSO for login is part of the OneUptime Enterprise Edition\. This server runs the Community Edition/;

/*
 * On a self-hosted Enterprise Edition whose license lapsed (after the trial or
 * the grace period) SSO sign-in stops, so "Require SSO" is not enforced
 * either - an admin turning it on must not believe it holds regardless.
 */
const LAPSE_NOTE: RegExp =
  /not enforced while the Enterprise license is missing or expired \(after the 14-day trial or grace period\), because SSO sign-in stops then too: users sign in with their password until a license is activated/;

// The toggle's description before the license could switch SSO off.
const RETIRED_TOGGLE_DESCRIPTION: string =
  "When enabled, all users must sign in with SSO to access any project on this server. Master admins are exempt so they can always recover from a misconfigured SSO. A project's own SSO settings still apply on top of this.";

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

  test("the Community Edition shows why the setting is not available instead of the toggle", () => {
    render(<AuthenticationSettings />);

    expect(screen.queryByTestId("card-SSO Settings")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("edits-requireSsoForLogin"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Single Sign-On (SSO)")).toBeInTheDocument();
    expect(screen.getByText(CE_NOTICE)).toBeInTheDocument();
    expect(
      screen.getByText(/A value saved earlier is kept/),
    ).toBeInTheDocument();
  });

  test.each([
    ["the Enterprise Edition", true, false],
    ["the cloud (billing on)", false, true],
    ["the cloud on the Enterprise image", true, true],
  ])(
    "%s offers the toggle",
    (_label: string, enterprise: boolean, billing: boolean) => {
      enterpriseEditionForTest = enterprise;
      billingEnabledForTest = billing;

      render(<AuthenticationSettings />);

      expect(screen.getByTestId("card-SSO Settings")).toBeInTheDocument();
      expect(
        screen.getByTestId("edits-requireSsoForLogin"),
      ).toBeInTheDocument();
      expect(screen.queryByText(CE_NOTICE)).not.toBeInTheDocument();
    },
  );

  test("the toggle says it is not enforced once the Enterprise license lapses", () => {
    enterpriseEditionForTest = true;

    render(<AuthenticationSettings />);

    expect(
      screen.getByTestId("describes-requireSsoForLogin"),
    ).toHaveTextContent(LAPSE_NOTE);
  });

  test("the lapse check rejects the description the toggle had before (negative control)", () => {
    expect(LAPSE_NOTE.test(RETIRED_TOGGLE_DESCRIPTION)).toBe(false);
  });

  test.each([
    [false, false],
    [true, false],
    [false, true],
  ])(
    "the other authentication settings stay on every edition (IS_ENTERPRISE_EDITION=%p, billing=%p)",
    (enterprise: boolean, billing: boolean) => {
      enterpriseEditionForTest = enterprise;
      billingEnabledForTest = billing;

      render(<AuthenticationSettings />);

      expect(screen.getByTestId("edits-disableSignup")).toBeInTheDocument();
      expect(
        screen.getByTestId("edits-disableUserProjectCreation"),
      ).toBeInTheDocument();
    },
  );
});
