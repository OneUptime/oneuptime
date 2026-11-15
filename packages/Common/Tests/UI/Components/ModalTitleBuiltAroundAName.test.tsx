import ConfirmModal from "../../../UI/Components/Modal/ConfirmModal";
import { Translator } from "../../../UI/Utils/TranslateTemplate";
import useTranslator from "../../../UI/Utils/UseTranslator";
import "@testing-library/jest-dom";
import { beforeAll, describe, expect, test } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React, { FunctionComponent, ReactElement } from "react";
import { I18nextProvider } from "react-i18next";

/*
 * A DIALOG'S TITLE BUILT AROUND A NAME (#8461).
 *
 * The status page's SCIM dialog was titled `SCIM URLs - ${name}`: a string
 * built in English, which no locale could word, so every reader got it in
 * English. It is the sentence "SCIM URLs - {{name}}" now, worded with the
 * connection's name as a value, the way the Dashboard's other dialogs
 * build a title around a value.
 *
 * The dialog says the title is in the reader's words already
 * (isTitleTranslated, #8633), so Modal draws it as given and never looks
 * it up again. The name is the record's own, and a name that is itself an
 * English key keeps its spelling.
 */

const NAME_THAT_IS_A_KEY: string = "Window not measured";

const createLanguage: (
  language: string,
  translation: Record<string, string>,
) => i18n = (language: string, translation: Record<string, string>): i18n => {
  const instance: i18n = createInstance();

  void instance.init({
    lng: language,
    fallbackLng: "en",
    resources: { [language]: { translation } },
    interpolation: { escapeValue: false },
    initImmediate: false,
  });

  return instance;
};

let german: i18n;
let arabic: i18n;
let english: i18n;

beforeAll(() => {
  german = createLanguage("de", {
    [NAME_THAT_IS_A_KEY]: "Fenster nicht gemessen",
    "SCIM URLs - {{name}}": "SCIM-URLs - {{name}}",
  });
  arabic = createLanguage("ar", {
    "SCIM URLs - {{name}}": "عناوين URL الخاصة بـ SCIM - {{name}}",
  });
  english = createLanguage("en", {});
});

const noop: () => void = (): void => {};

// The status page's SCIM dialog: its title built around the connection's name.
const ScimUrlsDialog: FunctionComponent<{ name: string }> = (props: {
  name: string;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <ConfirmModal
      title={translator.translateTemplate(
        "SCIM URLs - {{name}}",
        { name: props.name },
        { setsValuesApart: true },
      )}
      isTitleTranslated={true}
      description="Configure your identity provider with these SCIM endpoint URLs:"
      onSubmit={noop}
    />
  );
};

const titleIn: (language: i18n, name: string) => string = (
  language: i18n,
  name: string,
): string => {
  render(
    <I18nextProvider i18n={language}>
      <ScimUrlsDialog name={name} />
    </I18nextProvider>,
  );

  return screen.getByTestId("modal-title").textContent || "";
};

// Without the Unicode isolates a sentence read right to left sets a name in.
const withoutIsolates: (text: string) => string = (text: string): string => {
  return text.replace(/[⁦-⁩]/g, "");
};

describe("a dialog's title built around a name", () => {
  test("English reads as before, word for word", () => {
    expect(titleIn(english, "Okta SCIM for Status Page")).toBe(
      "SCIM URLs - Okta SCIM for Status Page",
    );
  });

  test("German words the sentence, and keeps the name as written", () => {
    expect(titleIn(german, "Okta SCIM")).toBe("SCIM-URLs - Okta SCIM");
  });

  test("a name that is itself an English key keeps its spelling", () => {
    expect(titleIn(german, NAME_THAT_IS_A_KEY)).toBe(
      `SCIM-URLs - ${NAME_THAT_IS_A_KEY}`,
    );
  });

  test("Arabic words the sentence, and the name in Latin letters is set apart from it", () => {
    const title: string = titleIn(arabic, "Okta SCIM");

    expect(withoutIsolates(title)).toBe(
      "عناوين URL الخاصة بـ SCIM - Okta SCIM",
    );
    expect(title).toMatch(/⁨Okta SCIM⁩/);
  });
});
