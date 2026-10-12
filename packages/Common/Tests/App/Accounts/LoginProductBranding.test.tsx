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
import { MemoryRouter } from "react-router-dom";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import API from "../../../UI/Utils/API/API";
import Navigation from "../../../UI/Utils/Navigation";
import "../../../../App/FeatureSet/Accounts/src/Utils/i18n";
import ForgotPasswordPage from "../../../../App/FeatureSet/Accounts/src/Pages/ForgotPassword";
import LoginPage from "../../../../App/FeatureSet/Accounts/src/Pages/Login";
import RegisterPage from "../../../../App/FeatureSet/Accounts/src/Pages/Register";

/*
 * The sign-in pages show the product: its logo at the top, and - on the
 * login page - which OneUptime edition this is and its license. On an
 * installation that goes by a name of its own (ProductBranding, carried by
 * env.js as PRODUCT_BRANDING), they show its logo, or its name when it has
 * no logo, and no OneUptime edition pill: the sign-in page is its own. Its
 * master admins still find the license in the Admin Dashboard header.
 */

jest.mock("../../../UI/Config", () => {
  return {
    ...(jest.requireActual(
      "../../../UI/Config",
    ) as typeof import("../../../UI/Config")),
    __esModule: true,
    BILLING_ENABLED: false,
    CAPTCHA_ENABLED: false,
  };
});

/*
 * The wordmark as esbuild hands it to the components: a data: URL.
 */
jest.mock("../../../UI/Images/logos/OneUptimeSVG/3-transparent.svg", () => {
  return "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjx0ZXh0IGZpbGw9IiMxMjEyMTIiPk9uZVVwdGltZTwvdGV4dD48L3N2Zz4=";
});

// The edition pill fetches the license on mount; here it only has to be seen.
jest.mock("../../../UI/Components/EditionLabel/EditionLabel", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return <span data-testid="edition-label" />;
    },
  };
});

const SVG_DATA_URL: RegExp = /^data:image\/svg\+xml;base64,/;

const setBranding: (value: string | null) => void = (
  value: string | null,
): void => {
  const browserWindow: { process?: { env?: Record<string, unknown> } } =
    window as unknown as { process?: { env?: Record<string, unknown> } };

  browserWindow.process = browserWindow.process || {};
  browserWindow.process.env = browserWindow.process.env || {};

  if (value === null) {
    delete browserWindow.process.env["PRODUCT_BRANDING"];
  } else {
    browserWindow.process.env["PRODUCT_BRANDING"] = value;
  }
};

const renderInRouter: (page: ReactElement) => Promise<void> = async (
  page: ReactElement,
): Promise<void> => {
  await act(async () => {
    render(<MemoryRouter>{page}</MemoryRouter>);
  });
};

const PAGES: Array<[string, () => ReactElement]> = [
  ["login", LoginPage],
  ["sign-up", RegisterPage],
  ["forgot password", ForgotPasswordPage],
] as Array<[string, () => ReactElement]>;

beforeEach(() => {
  window.localStorage.clear();

  jest.spyOn(Navigation, "navigate").mockImplementation(() => {
    // A page that would move on stays put here.
  });
  jest.spyOn(Navigation, "getQueryStringByName").mockReturnValue("");

  // Whatever a page lists on mount: nothing.
  jest.spyOn(API, "get").mockImplementation(async () => {
    return new HTTPResponse<JSONObject>(200, [] as unknown as JSONObject, {});
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  setBranding(null);
  window.localStorage.clear();
});

describe.each(PAGES)(
  "the %s page's logo",
  (_name: string, Page: () => ReactElement) => {
    test("is OneUptime's wordmark by default", async () => {
      await renderInRouter(<Page />);

      const logos: Array<HTMLElement> = screen.getAllByRole("img", {
        name: "OneUptime",
      });

      expect(logos.length).toBeGreaterThan(0);

      for (const logo of logos) {
        expect(logo.getAttribute("src")).toMatch(SVG_DATA_URL);
      }
    });

    test("is the installation's own logo, named after it", async () => {
      setBranding(
        JSON.stringify({
          productName: "Acme",
          logoUrl: "/api/branding/logo?v=1",
        }),
      );

      await renderInRouter(<Page />);

      expect(
        screen.queryByRole("img", { name: "OneUptime" }),
      ).not.toBeInTheDocument();

      for (const logo of screen.getAllByRole("img", { name: "Acme" })) {
        expect(logo).toHaveAttribute("src", "/api/branding/logo?v=1");
      }
    });

    test("is the installation's name when it has a name of its own and no logo", async () => {
      setBranding(JSON.stringify({ productName: "Acme" }));

      await renderInRouter(<Page />);

      expect(
        screen.queryByRole("img", { name: "OneUptime" }),
      ).not.toBeInTheDocument();
      expect(screen.getAllByText("Acme").length).toBeGreaterThan(0);
    });
  },
);

describe("the login page's edition pill", () => {
  test("shows which OneUptime edition this is, by default", async () => {
    await renderInRouter(<LoginPage />);

    expect(screen.getByTestId("edition-label")).toBeInTheDocument();
  });

  test("is left out on an installation with a name of its own", async () => {
    setBranding(JSON.stringify({ productName: "Acme" }));

    await renderInRouter(<LoginPage />);

    expect(screen.queryByTestId("edition-label")).not.toBeInTheDocument();
  });

  test("stays when only the logo differs: the product is still OneUptime", async () => {
    setBranding(JSON.stringify({ logoUrl: "/api/branding/logo?v=1" }));

    await renderInRouter(<LoginPage />);

    expect(screen.getByTestId("edition-label")).toBeInTheDocument();
  });
});
