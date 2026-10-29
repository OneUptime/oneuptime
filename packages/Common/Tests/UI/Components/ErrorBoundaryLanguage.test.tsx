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
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { FunctionComponent, ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import ErrorBoundary, {
  markChunkLoadErrorReload,
} from "../../../UI/Components/ErrorBoundary";
import NewVersion, {
  NewVersionAudience,
} from "../../../UI/Utils/NewVersion/NewVersion";

/*
 * The screen an error draws (ErrorBoundary's Fallback) says which language
 * its words are in and reads that way, as every other page card does
 * (PageScreenCard): a Persian card reads right to left even on a page drawn
 * left to right - a public dashboard is - and a card whose words are still
 * English never does. A part of it left in English inside a Persian card -
 * the support part, which is not translated yet - reads left to right, its
 * question mark and full stop where English puts them, not "?Still stuck".
 *
 * A public dashboard's visitor reads the whole card in their language: its
 * buttons were already theirs (the new-version screens' words), so its
 * title and message are too.
 */

const FEATURE_SETS: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet",
);

const readLocale: (
  frontend: string,
  language: string,
) => Record<string, string> = (
  frontend: string,
  language: string,
): Record<string, string> => {
  return JSON.parse(
    fs.readFileSync(
      path.join(FEATURE_SETS, frontend, "src", "Locales", `${language}.json`),
      "utf8",
    ),
  ) as Record<string, string>;
};

const instanceFor: (
  frontend: string,
  language: string,
) => Promise<i18n> = async (
  frontend: string,
  language: string,
): Promise<i18n> => {
  const instance: i18n = createInstance();

  await instance.init({
    lng: language,
    resources: {
      [language]: { translation: readLocale(frontend, language) },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });

  return instance;
};

const ThrowOnRender: FunctionComponent = (): ReactElement => {
  throw new Error("Render exploded");
};

const ThrowChunkError: FunctionComponent = (): ReactElement => {
  throw new Error("Loading chunk 9 failed.");
};

const consoleError: ReturnType<typeof jest.spyOn> = jest.spyOn(
  console,
  "error",
);
const consoleWarn: ReturnType<typeof jest.spyOn> = jest.spyOn(console, "warn");

beforeAll(() => {
  consoleError.mockImplementation(() => {});
  consoleWarn.mockImplementation(() => {});
});

afterAll(() => {
  consoleError.mockRestore();
  consoleWarn.mockRestore();
});

beforeEach(() => {
  window.sessionStorage.clear();
  NewVersion.reset();
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  NewVersion.reset();
});

const drawn: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId("error-boundary-fallback");
};

describe("a public dashboard visitor's error screen", () => {
  test.each<[string, string]>([
    ["de", "ltr"],
    ["fa", "rtl"],
    ["ja", "ltr"],
  ])(
    "reads whole in %s, and says so",
    async (language: string, direction: string) => {
      NewVersion.start({
        audience: NewVersionAudience.Visitors,
        firstCheckDelayInMs: 24 * 60 * 60 * 1000,
      });

      const locale: Record<string, string> = readLocale(
        "PublicDashboard",
        language,
      );

      render(
        <I18nextProvider i18n={await instanceFor("PublicDashboard", language)}>
          <ErrorBoundary>
            <ThrowOnRender />
          </ErrorBoundary>
        </I18nextProvider>,
      );

      const card: HTMLElement = drawn();

      expect(screen.getByTestId("error-boundary-title")).toHaveTextContent(
        locale["Something went wrong"]!,
      );
      expect(card).toHaveTextContent(
        locale[
          "An unexpected error has occurred. Please reload the page to continue"
        ]!,
      );
      expect(screen.getByTestId("error-boundary-reload")).toHaveTextContent(
        locale["Reload page"]!,
      );
      expect(screen.getByTestId("error-boundary-try-again")).toHaveTextContent(
        locale["Try again"]!,
      );
      expect(card).not.toHaveTextContent("Something went wrong");
      expect(card).toHaveAttribute("lang", language);
      expect(card).toHaveAttribute("dir", direction);

      /*
       * No support part: a visitor has nobody at OneUptime to send a
       * support bundle to, and their screen never names OneUptime.
       */
      expect(screen.queryByText("Still stuck?")).toBeNull();
      expect(
        screen.queryByTestId("error-boundary-download-support-bundle"),
      ).toBeNull();
      expect(card).not.toHaveTextContent("OneUptime");
    },
  );
});

describe("the support part", () => {
  test("is there for the people who use OneUptime", () => {
    NewVersion.start({
      audience: NewVersionAudience.Members,
      firstCheckDelayInMs: 24 * 60 * 60 * 1000,
    });

    render(
      <ErrorBoundary>
        <ThrowOnRender />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Still stuck?")).toBeVisible();
    expect(
      screen.getByTestId("error-boundary-download-support-bundle"),
    ).toBeVisible();
  });

  test("is never there for a status page's or a public dashboard's visitors", () => {
    NewVersion.start({
      audience: NewVersionAudience.Visitors,
      firstCheckDelayInMs: 24 * 60 * 60 * 1000,
    });

    render(
      <ErrorBoundary>
        <ThrowOnRender />
      </ErrorBoundary>,
    );

    expect(drawn()).toBeVisible();
    expect(screen.queryByText("Still stuck?")).toBeNull();
    expect(screen.queryByTestId("error-boundary-support-email")).toBeNull();
    expect(drawn()).not.toHaveTextContent("OneUptime");
    // Reload page and Try again stay.
    expect(screen.getByTestId("error-boundary-reload")).toBeVisible();
    expect(screen.getByTestId("error-boundary-try-again")).toBeVisible();
  });
});

describe("a card whose words are still English", () => {
  test("says English and reads left to right, on a Persian page too", async () => {
    // The Dashboard has no Persian words for the generic screen yet.
    expect(readLocale("Dashboard", "fa")["Something went wrong"]).toBe(
      "Something went wrong",
    );

    render(
      <I18nextProvider i18n={await instanceFor("Dashboard", "fa")}>
        <ErrorBoundary>
          <ThrowOnRender />
        </ErrorBoundary>
      </I18nextProvider>,
    );

    expect(screen.getByTestId("error-boundary-title")).toHaveTextContent(
      "Something went wrong",
    );
    expect(drawn()).toHaveAttribute("lang", "en");
    expect(drawn()).toHaveAttribute("dir", "ltr");
  });

  test("with no translation set up at all, says English", () => {
    render(
      <ErrorBoundary>
        <ThrowOnRender />
      </ErrorBoundary>,
    );

    expect(drawn()).toHaveAttribute("lang", "en");
    expect(drawn()).toHaveAttribute("dir", "ltr");
  });
});

describe("a page that could not be loaded, for the people who use OneUptime, in Persian", () => {
  const drawFailed: () => Promise<void> = async (): Promise<void> => {
    markChunkLoadErrorReload(Date.now());

    render(
      <I18nextProvider i18n={await instanceFor("Dashboard", "fa")}>
        <ErrorBoundary>
          <ThrowChunkError />
        </ErrorBoundary>
      </I18nextProvider>,
    );

    await waitFor(() => {
      expect(screen.queryByTestId("error-boundary-fallback")).not.toBeNull();
    });
  };

  test("the card is Persian and reads right to left", async () => {
    await drawFailed();

    const locale: Record<string, string> = readLocale("Dashboard", "fa");

    expect(screen.getByTestId("error-boundary-title")).toHaveTextContent(
      locale["This page couldn't be loaded"]!,
    );
    expect(drawn()).toHaveAttribute("lang", "fa");
    expect(drawn()).toHaveAttribute("dir", "rtl");
  });

  test("its support part, still English, reads left to right inside it", async () => {
    await drawFailed();

    const supportTitle: HTMLElement = screen.getByText("Still stuck?");
    const support: HTMLElement = supportTitle.closest(
      ".oueb-support",
    ) as HTMLElement;

    expect(support).not.toBeNull();
    expect(support).toHaveAttribute("lang", "en");
    expect(support).toHaveAttribute("dir", "ltr");

    const details: HTMLElement = screen
      .getByText("Error details")
      .closest("details") as HTMLElement;

    expect(details).toHaveAttribute("lang", "en");
    expect(details).toHaveAttribute("dir", "ltr");
    // The error's own words read the way they are written.
    expect(screen.getByTestId("error-boundary-error-message")).toHaveAttribute(
      "dir",
      "auto",
    );
  });

  test("in German, where the support part is partly translated, it follows its own title", async () => {
    markChunkLoadErrorReload(Date.now());

    render(
      <I18nextProvider i18n={await instanceFor("Dashboard", "de")}>
        <ErrorBoundary>
          <ThrowChunkError />
        </ErrorBoundary>
      </I18nextProvider>,
    );

    await waitFor(() => {
      expect(screen.queryByTestId("error-boundary-fallback")).not.toBeNull();
    });

    const locale: Record<string, string> = readLocale("Dashboard", "de");
    const support: HTMLElement = screen
      .getByText(locale["Still stuck?"]!)
      .closest(".oueb-support") as HTMLElement;

    expect(drawn()).toHaveAttribute("lang", "de");
    expect(support).toHaveAttribute("lang", "de");
    expect(support).toHaveAttribute("dir", "ltr");
  });
});
