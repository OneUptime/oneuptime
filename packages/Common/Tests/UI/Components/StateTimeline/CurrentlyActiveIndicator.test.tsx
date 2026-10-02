import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React from "react";
import { I18nextProvider } from "react-i18next";
import CurrentlyActiveIndicator, {
  CURRENTLY_ACTIVE_TEXT,
} from "../../../../UI/Components/StateTimeline/CurrentlyActiveIndicator";
import { getPillColors } from "../../../../UI/Components/Pill/PillColors";
import { PillSize } from "../../../../UI/Components/Pill/Pill";
import { Indigo500 } from "../../../../Types/BrandColors";

/*
 * The marker on the timeline row that has not ended: a pill reading
 * "Currently Active" whose dot pulses - in the brand indigo, the product's
 * colour for "happening now" - unless the reader asked for reduced motion.
 */

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const LOCALES: Array<string> = [
  "en",
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

function readShippedTranslation(locale: string): string {
  const resource: Record<string, unknown> = JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;

  return resource[CURRENTLY_ACTIVE_TEXT] as string;
}

function getIndicator(): HTMLElement {
  return screen.getByTestId("currently-active-indicator");
}

function getPill(): HTMLElement {
  return within(getIndicator()).getByTestId("pill");
}

afterEach(() => {
  cleanup();
});

describe("CurrentlyActiveIndicator", () => {
  test('says "Currently Active"', () => {
    render(<CurrentlyActiveIndicator />);

    expect(getIndicator()).toHaveTextContent(/^Currently Active$/);
    expect(CURRENTLY_ACTIVE_TEXT).toBe("Currently Active");
  });

  test("is a pill whose dot pulses", () => {
    render(<CurrentlyActiveIndicator />);

    const dot: HTMLElement = within(getPill()).getByTestId("pill-dot");

    expect(dot).toHaveAttribute("data-pulsing", "true");
    expect(within(dot).getByTestId("pill-dot-pulse")).toBeInTheDocument();
  });

  test("pulses only while motion is welcome (prefers-reduced-motion)", () => {
    render(<CurrentlyActiveIndicator />);

    const pulse: HTMLElement = screen.getByTestId("pill-dot-pulse");

    expect(pulse).toHaveClass("motion-safe:animate-ping");
    // Nothing anywhere in it animates unconditionally.
    expect(getIndicator().innerHTML).not.toMatch(/(^|[\s"])animate-/);
  });

  test("is drawn in the brand indigo, not in the row's status colour", () => {
    render(<CurrentlyActiveIndicator />);

    const colors: ReturnType<typeof getPillColors> = getPillColors(Indigo500);

    expect(getPill()).toHaveStyle({
      backgroundColor: colors.light.backgroundColor,
      color: colors.light.textColor,
    });
    expect(screen.getByTestId("pill-dot-pulse")).toHaveStyle({
      backgroundColor: Indigo500.toString(),
    });
  });

  test("carries its dark-theme colours, which Theme.css swaps in", () => {
    render(<CurrentlyActiveIndicator />);

    const colors: ReturnType<typeof getPillColors> = getPillColors(Indigo500);

    expect(getPill()).toHaveAttribute("data-ou-pill");
    expect(getPill().style.getPropertyValue("--ou-pill-dark-text")).toBe(
      colors.dark.textColor,
    );
  });

  test("its moving part is hidden from assistive technology; the words are not", () => {
    render(<CurrentlyActiveIndicator />);

    expect(screen.getByTestId("pill-dot")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    // Not a live region: a table of timelines must not announce itself.
    expect(getIndicator()).not.toHaveAttribute("role");
    expect(getIndicator()).not.toHaveAttribute("aria-live");
    expect(screen.getByText("Currently Active")).toBeVisible();
  });

  test("is the status pills' normal size unless told otherwise", () => {
    render(<CurrentlyActiveIndicator />);

    expect(getPill()).toHaveStyle({ fontSize: PillSize.Normal });
  });

  test("takes a size, to match a smaller status pill beside it", () => {
    render(<CurrentlyActiveIndicator size={PillSize.Small} />);

    expect(getPill()).toHaveStyle({ fontSize: PillSize.Small });
  });

  test("never grows wider than the cell it is in", () => {
    render(<CurrentlyActiveIndicator />);

    expect(getIndicator()).toHaveClass("inline-flex", "max-w-full");
  });

  describe("in every Dashboard language", () => {
    test.each(LOCALES)(
      "%s: shows the translation shipped in its locale file",
      (locale: string) => {
        const translation: string = readShippedTranslation(locale);

        expect(typeof translation).toBe("string");
        expect(translation.trim().length).toBeGreaterThan(0);

        /*
         * Handed to the component through the provider only:
         * .use(initReactI18next) would make it the global instance and leak
         * this language into every other test in the worker.
         */
        const instance: i18n = createInstance();
        void instance.init({
          lng: locale,
          resources: {
            [locale]: {
              translation: { [CURRENTLY_ACTIVE_TEXT]: translation },
            },
          },
          initImmediate: false,
          interpolation: { escapeValue: false },
          keySeparator: false,
          nsSeparator: false,
        });

        render(
          <I18nextProvider i18n={instance}>
            <CurrentlyActiveIndicator />
          </I18nextProvider>,
        );

        expect(getIndicator()).toHaveTextContent(translation);
      },
    );

    test("every language but English says it in its own words", () => {
      for (const locale of LOCALES) {
        if (locale === "en") {
          expect(readShippedTranslation(locale)).toBe(CURRENTLY_ACTIVE_TEXT);
          continue;
        }

        expect(readShippedTranslation(locale)).not.toBe(CURRENTLY_ACTIVE_TEXT);
      }
    });

    test("falls back to English for a language that has no entry", () => {
      const instance: i18n = createInstance();
      void instance.init({
        lng: "xx",
        resources: { xx: { translation: {} } },
        initImmediate: false,
        keySeparator: false,
        nsSeparator: false,
      });

      render(
        <I18nextProvider i18n={instance}>
          <CurrentlyActiveIndicator />
        </I18nextProvider>,
      );

      expect(getIndicator()).toHaveTextContent(/^Currently Active$/);
    });
  });
});
