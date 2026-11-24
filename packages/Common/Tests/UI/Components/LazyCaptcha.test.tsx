import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import React from "react";

/*
 * The captcha the sign-in and sign-up pages draw while their server asks
 * for one (CAPTCHA_ENABLED, off unless an operator turns it on) is a file of
 * its own, loaded when it is drawn (LazyCaptcha): hCaptcha's widget and its
 * loader were about 7 KiB gzipped of both pages' first load, on every
 * server, captcha or not (packages/Common/Scripts/first-load-budgets.js).
 *
 * Drawn, it is the captcha the pages drew before: the same widget, handed
 * what the page hands it, in the box it lays its widget out in - which is
 * all it draws until it arrives, as hCaptcha's widget draws nothing until
 * hCaptcha's own script does.
 */

jest.mock("@hcaptcha/react-hcaptcha", () => {
  const actualReact: typeof React = jest.requireActual("react") as typeof React;

  return {
    __esModule: true,
    default: actualReact.forwardRef(
      (
        props: { sitekey?: string; onVerify?: (token: string) => void },
        _ref: unknown,
      ) => {
        return actualReact.createElement(
          "button",
          {
            type: "button",
            "data-testid": "hcaptcha",
            "data-sitekey": props.sitekey,
            onClick: () => {
              props.onVerify?.("captcha-token");
            },
          },
          "I am not a robot",
        );
      },
    ),
  };
});

import LazyCaptcha from "../../../UI/Components/Captcha/LazyCaptcha";

const ACCOUNTS_PAGES: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Accounts",
  "src",
  "Pages",
);

afterEach(() => {
  cleanup();
});

describe("the captcha the sign-in pages load when they draw it", () => {
  test("draws its box until it arrives, then the widget, with the page's site key", async () => {
    const { container } = render(<LazyCaptcha siteKey="site-key" />);

    expect(screen.queryByTestId("hcaptcha")).not.toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass(
      "flex",
      "flex-col",
      "items-center",
    );
    expect(container.firstElementChild).toBeEmptyDOMElement();

    expect(await screen.findByTestId("hcaptcha")).toHaveAttribute(
      "data-sitekey",
      "site-key",
    );
  });

  test("hands the page the token the widget answers with", async () => {
    const tokens: Array<string> = [];

    render(
      <LazyCaptcha
        siteKey="site-key"
        onTokenChange={(token: string) => {
          tokens.push(token);
        }}
      />,
    );

    const widget: HTMLElement = await screen.findByTestId("hcaptcha");

    act(() => {
      widget.click();
    });

    expect(tokens[tokens.length - 1]).toBe("captcha-token");
  });

  test.each(["Login.tsx", "Register.tsx"])(
    "%s draws it through LazyCaptcha, never the captcha itself",
    (page: string) => {
      const source: string = fs.readFileSync(
        path.join(ACCOUNTS_PAGES, page),
        "utf8",
      );

      expect(source).toContain(
        'import Captcha from "Common/UI/Components/Captcha/LazyCaptcha";',
      );
      expect(source).not.toContain('"Common/UI/Components/Captcha/Captcha"');
    },
  );
});
