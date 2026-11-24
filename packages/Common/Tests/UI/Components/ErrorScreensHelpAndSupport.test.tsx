import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * THE ERROR SCREENS' SUPPORT ADDRESS (#10865).
 *
 * When a page breaks, the error screen offers a support bundle and says
 * where to send it; Page not found offers Contact Support. Both name
 * OneUptime Support by default, exactly as before. A server whose admins set
 * an address of their own (Admin Dashboard > Settings > Help and Support)
 * names theirs - and stops saying the bundle is for OneUptime Support - and
 * one whose admins hid it names nobody, while the bundle is still offered.
 *
 * The address is read from env.js, so the screen knows it however the page
 * broke - before any request, and on the sign-in pages too.
 */

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      navigate: jest.fn(),
    },
  };
});

import ErrorBoundary, {
  SUPPORT_BUNDLE_SENTENCE_FOR_OWN_TEAM,
  SUPPORT_EMAIL,
} from "../../../UI/Components/ErrorBoundary";
import NotFound from "../../../UI/Components/404";
import Route from "../../../Types/API/Route";
import Email from "../../../Types/Email";
import {
  HelpChoice,
  HelpItem,
  ONEUPTIME_SUPPORT_EMAIL,
} from "../../../Types/HelpAndSupport/HelpAndSupport";
import Navigation from "../../../UI/Utils/Navigation";
import {
  forgetHelpAndSupport,
  helpAndSupportWith,
  setHelpAndSupportEnvironment,
} from "../../Helpers/HelpAndSupportEnvironment";

const ONEUPTIME_SUPPORT_SENTENCE: string =
  "Download a local diagnostics file with the error stack, component stack, scrubbed page URL, browser details, and OneUptime build. It never reads cookies, saved browser data, or form contents. Review it before sharing it with OneUptime Support.";

const ThrowOnRender: FunctionComponent = (): ReactElement => {
  throw new Error("Render exploded");
};

const breakThePage: () => HTMLElement = (): HTMLElement => {
  render(
    <ErrorBoundary>
      <ThrowOnRender />
    </ErrorBoundary>,
  );

  return screen.getByTestId("error-boundary-fallback");
};

const consoleErrorSpy: jest.SpiedFunction<typeof console.error> = jest.spyOn(
  console,
  "error",
);

beforeAll(() => {
  consoleErrorSpy.mockImplementation(() => {});
});

beforeEach(() => {
  forgetHelpAndSupport();
});

afterEach(() => {
  forgetHelpAndSupport();
  jest.clearAllMocks();
});

afterAll(() => {
  consoleErrorSpy.mockRestore();
});

describe("the error screen", () => {
  test("by default, the bundle is for OneUptime Support, sent to support@oneuptime.com, as always", () => {
    const fallback: HTMLElement = breakThePage();

    expect(fallback).toHaveTextContent(ONEUPTIME_SUPPORT_SENTENCE);
    expect(screen.getByTestId("error-boundary-support-email")).toHaveAttribute(
      "href",
      "mailto:support@oneuptime.com",
    );
    expect(
      screen.getByTestId("error-boundary-support-email"),
    ).toHaveTextContent("support@oneuptime.com");
    expect(SUPPORT_EMAIL).toBe(ONEUPTIME_SUPPORT_EMAIL);
  });

  test("with the server's own address: names it, and no longer says OneUptime Support", () => {
    setHelpAndSupportEnvironment(
      helpAndSupportWith({
        [HelpItem.SupportEmail]: {
          choice: HelpChoice.Email,
          value: "it-help@example.com",
        },
      }),
    );

    const fallback: HTMLElement = breakThePage();

    expect(screen.getByTestId("error-boundary-support-email")).toHaveAttribute(
      "href",
      "mailto:it-help@example.com",
    );
    expect(
      screen.getByTestId("error-boundary-support-email"),
    ).toHaveTextContent("it-help@example.com");
    expect(fallback).toHaveTextContent(SUPPORT_BUNDLE_SENTENCE_FOR_OWN_TEAM);
    expect(fallback).not.toHaveTextContent("OneUptime Support");
    expect(fallback).not.toHaveTextContent("support@oneuptime.com");
  });

  test("with the address hidden: names nobody, while the bundle is still offered", () => {
    setHelpAndSupportEnvironment(
      helpAndSupportWith({
        [HelpItem.SupportEmail]: { choice: HelpChoice.Hidden, value: null },
      }),
    );

    const fallback: HTMLElement = breakThePage();

    expect(screen.queryByTestId("error-boundary-support-email")).toBeNull();
    expect(fallback).not.toHaveTextContent("Send it to");
    expect(fallback).not.toHaveTextContent("support@oneuptime.com");
    expect(fallback).not.toHaveTextContent("OneUptime Support");
    expect(fallback).toHaveTextContent(SUPPORT_BUNDLE_SENTENCE_FOR_OWN_TEAM);
    expect(
      screen.getByTestId("error-boundary-download-support-bundle"),
    ).toBeInTheDocument();
  });

  test("an env.js value that cannot be read leaves the screen as it always was", () => {
    setHelpAndSupportEnvironment("{broken");

    const fallback: HTMLElement = breakThePage();

    expect(fallback).toHaveTextContent(ONEUPTIME_SUPPORT_SENTENCE);
    expect(screen.getByTestId("error-boundary-support-email")).toHaveAttribute(
      "href",
      "mailto:support@oneuptime.com",
    );
  });

  test("an address with markup in it is never written into the page: the default is named instead", () => {
    setHelpAndSupportEnvironment(
      JSON.stringify({
        supportEmail: {
          choice: "email",
          value: '"><img src=x onerror=alert(1)>@example.com',
        },
      }),
    );

    breakThePage();

    expect(document.querySelector("img[src='x']")).toBeNull();
    expect(screen.getByTestId("error-boundary-support-email")).toHaveAttribute(
      "href",
      "mailto:support@oneuptime.com",
    );
  });

  test("the sentence for a server's own team says the same, without naming OneUptime Support", () => {
    expect(SUPPORT_BUNDLE_SENTENCE_FOR_OWN_TEAM).toBe(
      "Download a local diagnostics file with the error stack, component stack, scrubbed page URL, browser details, and OneUptime build. It never reads cookies, saved browser data, or form contents. Review it before you share it.",
    );
  });
});

describe("Page not found", () => {
  test("offers Contact Support where it is given an address, and writes to it", () => {
    render(
      <NotFound
        homeRoute={new Route("/")}
        supportEmail={new Email("it-help@example.com")}
      />,
    );

    fireEvent.click(screen.getByText("Contact Support"));

    expect(
      String(
        (Navigation.navigate as jest.Mock).mock.calls[0]![0] as unknown,
      ),
    ).toBe("mailto:it-help@example.com");
  });

  test("offers no Contact Support where the server's admins hid the address, and still offers Go Home", () => {
    render(<NotFound homeRoute={new Route("/")} supportEmail={null} />);

    expect(screen.queryByText("Contact Support")).toBeNull();
    expect(screen.getByText("Go Home")).toBeInTheDocument();
    expect(screen.getByText("Page not found")).toBeInTheDocument();
  });
});
