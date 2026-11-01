import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import TranslatedSentence from "../../../UI/Components/TranslatedSentence/TranslatedSentence";
import {
  FIRST_STRONG_ISOLATE,
  POP_DIRECTIONAL_ISOLATE,
} from "../../../Types/ReadingDirection";

/*
 * TranslatedSentence draws its sentence on the page and nothing else, so it
 * sets apart each value that could move the words around it: in a Persian
 * sentence a connection's name in Latin letters, the time after it, and the
 * element drawn in a slot. A sentence whose pieces renderText draws as boxes
 * of their own keeps its slots as they are, and a sentence read left to
 * right is drawn exactly as before.
 */

const READ_FROM: string = "Read from the Meraki dashboard ({{name}}), {{time}}.";
const RUNNER: string = "Runner {{runner}} is not online.";

const PERSIAN: Record<string, string> = {
  [READ_FROM]: "خوانده‌شده از داشبورد Meraki ({{name}})، {{time}}.",
  [RUNNER]: "رانر {{runner}} آنلاین نیست.",
};

const GERMAN: Record<string, string> = {
  [READ_FROM]: "Aus dem Meraki-Dashboard ({{name}}) gelesen, {{time}}.",
  [RUNNER]: "Runner {{runner}} ist nicht online.",
};

const isolated: (value: string) => string = (value: string): string => {
  return `${FIRST_STRONG_ISOLATE}${value}${POP_DIRECTIONAL_ISOLATE}`;
};

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const language of ["en", "de", "fa"]) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: {} },
        de: { translation: GERMAN },
        fa: { translation: PERSIAN },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    instances[language] = instance;
  }
});

afterEach(() => {
  cleanup();
});

const draw: (language: string, sentence: ReactElement) => HTMLElement = (
  language: string,
  sentence: ReactElement,
): HTMLElement => {
  render(
    <I18nextProvider i18n={instances[language]!}>
      <p data-testid="sentence">{sentence}</p>
    </I18nextProvider>,
  );

  return screen.getByTestId("sentence");
};

describe("a sentence drawn in Persian", () => {
  test("sets apart the name in its slot and the time after it", () => {
    const sentence: HTMLElement = draw(
      "fa",
      <TranslatedSentence
        template={READ_FROM}
        slots={{ name: <strong data-testid="name">Acme Retail</strong> }}
        values={{ time: "۴ دقیقه پیش" }}
      />,
    );

    expect(sentence.textContent).toBe(
      `خوانده‌شده از داشبورد Meraki (${isolated("Acme Retail")})، ${isolated(
        "۴ دقیقه پیش",
      )}.`,
    );
    // The slot's element is drawn as given, between its isolate's marks.
    expect(screen.getByTestId("name")).toHaveTextContent(/^Acme Retail$/);
    expect(
      screen.getByTestId("name").previousSibling?.textContent?.endsWith(
        FIRST_STRONG_ISOLATE,
      ),
    ).toBe(true);
    expect(
      screen.getByTestId("name").nextSibling?.textContent?.startsWith(
        POP_DIRECTIONAL_ISOLATE,
      ),
    ).toBe(true);
  });

  test("keeps its slots as they are when renderText draws its pieces as boxes", () => {
    const sentence: HTMLElement = draw(
      "fa",
      <TranslatedSentence
        template={RUNNER}
        slots={{ runner: <span data-testid="runner">build-runner-01</span> }}
        renderText={(text: string): ReactElement => {
          return <span data-testid="piece">{text}</span>;
        }}
      />,
    );

    expect(sentence.textContent).toBe("رانر build-runner-01 آنلاین نیست.");
    expect(
      screen.getAllByTestId("piece").map((piece: HTMLElement): string => {
        return piece.textContent || "";
      }),
    ).toEqual(["رانر ", " آنلاین نیست."]);
  });
});

describe("a sentence drawn left to right", () => {
  test("in German, nothing is set apart", () => {
    const sentence: HTMLElement = draw(
      "de",
      <TranslatedSentence
        template={READ_FROM}
        slots={{ name: <strong>Acme Retail</strong> }}
        values={{ time: "vor 4 Minuten" }}
      />,
    );

    expect(sentence.textContent).toBe(
      "Aus dem Meraki-Dashboard (Acme Retail) gelesen, vor 4 Minuten.",
    );
  });

  test("in English, only a Persian value is set apart", () => {
    const sentence: HTMLElement = draw(
      "en",
      <TranslatedSentence
        template={READ_FROM}
        slots={{ name: <strong>Acme Retail</strong> }}
        values={{ time: "4 minutes ago" }}
      />,
    );

    expect(sentence.textContent).toBe(
      "Read from the Meraki dashboard (Acme Retail), 4 minutes ago.",
    );

    cleanup();

    const persianName: HTMLElement = draw(
      "en",
      <TranslatedSentence
        template={RUNNER}
        slots={{}}
        values={{ runner: "رانر تهران" }}
      />,
    );

    expect(persianName.textContent).toBe(
      `Runner ${isolated("رانر تهران")} is not online.`,
    );
  });
});
