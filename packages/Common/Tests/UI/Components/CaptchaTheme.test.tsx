import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import React from "react";

/*
 * The captcha on the sign-in and sign-up pages (and on a public form) in the
 * page's theme. hCaptcha draws its own box, light unless it is told
 * otherwise: on a sign-in page drawn dark - the person picked Dark, or their
 * device is set to dark - it was a white box on the dark card. The widget is
 * given the theme the page is drawn in, and redrawn when the page changes
 * theme.
 */

jest.mock("@hcaptcha/react-hcaptcha", () => {
  const actualReact: typeof React = jest.requireActual("react") as typeof React;

  return {
    __esModule: true,
    default: actualReact.forwardRef(
      (props: { theme?: string | undefined }, _ref: unknown) => {
        return actualReact.createElement("div", {
          "data-testid": "hcaptcha",
          "data-theme": props.theme,
        });
      },
    ),
  };
});

import Captcha from "../../../UI/Components/Captcha/Captcha";
import ThemeUtil, { Theme } from "../../../UI/Utils/Theme";

afterEach(() => {
  cleanup();
  ThemeUtil.applyTheme(Theme.Light, false);
});

describe("the captcha's theme", () => {
  test("is light on a light page", () => {
    ThemeUtil.applyTheme(Theme.Light, false);
    render(<Captcha siteKey="site-key" />);

    expect(screen.getByTestId("hcaptcha")).toHaveAttribute(
      "data-theme",
      "light",
    );
  });

  test("is dark on a dark page", () => {
    ThemeUtil.applyTheme(Theme.Dark, false);
    render(<Captcha siteKey="site-key" />);

    expect(screen.getByTestId("hcaptcha")).toHaveAttribute(
      "data-theme",
      "dark",
    );
  });

  test("follows the page when its theme changes while it is open", () => {
    ThemeUtil.applyTheme(Theme.Light, false);
    render(<Captcha siteKey="site-key" />);

    act(() => {
      ThemeUtil.applyTheme(Theme.Dark);
    });

    expect(screen.getByTestId("hcaptcha")).toHaveAttribute(
      "data-theme",
      "dark",
    );

    act(() => {
      ThemeUtil.applyTheme(Theme.Light);
    });

    expect(screen.getByTestId("hcaptcha")).toHaveAttribute(
      "data-theme",
      "light",
    );
  });

  test("a captcha without a site key still says so, in either theme", () => {
    ThemeUtil.applyTheme(Theme.Dark, false);
    render(<Captcha siteKey="" />);

    expect(screen.getByText("Captcha is not configured.")).toBeInTheDocument();
    expect(screen.queryByTestId("hcaptcha")).not.toBeInTheDocument();
  });
});
