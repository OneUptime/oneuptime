import Button from "../../../UI/Components/Button/Button";
import BasicFormModal from "../../../UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import ConfirmModal from "../../../UI/Components/Modal/ConfirmModal";
import Modal from "../../../UI/Components/Modal/Modal";
import SideOver from "../../../UI/Components/SideOver/SideOver";
import { Translator } from "../../../UI/Utils/TranslateTemplate";
import useTranslator from "../../../UI/Utils/UseTranslator";
import { JSONObject } from "../../../Types/JSON";
import getJestMockFunction from "../../MockType";
import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React, { FunctionComponent, ReactElement } from "react";
import { I18nextProvider } from "react-i18next";

/*
 * A TITLE THE PAGE HAS WORDED IS DRAWN AS GIVEN (#8633).
 *
 * Modal, SideOver and Button looked up every title they were handed, with
 * no way to be told a title was in the reader's words already. About 150
 * dialogs hand Modal a sentence built around a value ("Delete {{name}}",
 * "Restore the backup of {{time}}"), the topology drawer hands SideOver a
 * resource's own name, and a "Show 20 more" is a count worded by the page.
 * Each went through a second lookup, and where the translation - or the
 * name - is itself an English key, the reader got another word: Spanish
 * says "Red" for "Network", and "Rojo" for "Red".
 *
 * They take isTitleTranslated now, as Page, Tab, the nav items and
 * AlertBanner do (SideOver isDescriptionTranslated too): the title is
 * drawn as given. Left out, a title is English and looked up once, as
 * before. Modal hands its footer buttons over worded, and the footer says
 * so to Button.
 */

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

// Spanish words "Network" Red, and "Red" (the colour) Rojo.
const spanish: i18n = createLanguage("es", {
  Network: "Red",
  Red: "Rojo",
  Save: "Guardar",
  Guardar: "Ahorrar",
  Cancel: "Cancelar",
  "Show {{count}} more": "Mostrar {{count}} más",
});

const german: i18n = createLanguage("de", {
  "Delete {{name}}": "{{name}} löschen",
  Logs: "Protokolle",
  "Show {{count}} more": "{{count}} weitere anzeigen",
});

const arabic: i18n = createLanguage("ar", {
  "Delete {{name}}": "حذف {{name}}",
  "Show {{count}} more": "عرض {{count}} إضافية",
});

const persian: i18n = createLanguage("fa", {
  "Delete {{name}}": "حذف {{name}}",
  "Show {{count}} more": "نمایش {{count}} مورد دیگر",
});

const english: i18n = createLanguage("en", {});

const noop: () => void = (): void => {};

const inLanguage: (language: i18n, element: ReactElement) => void = (
  language: i18n,
  element: ReactElement,
): void => {
  render(<I18nextProvider i18n={language}>{element}</I18nextProvider>);
};

const textOf: (testId: string) => string = (testId: string): string => {
  return screen.getByTestId(testId).textContent || "";
};

// Without the Unicode isolates a sentence read right to left sets a name in.
const withoutIsolates: (text: string) => string = (text: string): string => {
  return text.replace(/[⁦-⁩]/g, "");
};

// A page that words its dialog's title around a record's name.
const DeleteDialog: FunctionComponent<{ name: string }> = (props: {
  name: string;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <ConfirmModal
      title={translator.translateTemplate(
        "Delete {{name}}",
        { name: props.name },
        { setsValuesApart: true },
      )}
      isTitleTranslated={true}
      description="This cannot be undone."
      onSubmit={noop}
    />
  );
};

// A page that words a button's title around a count.
const ShowMoreButton: FunctionComponent<{ count: number }> = (props: {
  count: number;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <Button
      title={translator.translateTemplate("Show {{count}} more", {
        count: translator.formatNumber(props.count),
      })}
      isTitleTranslated={true}
      dataTestId="show-more"
      onClick={noop}
    />
  );
};

afterEach(() => {
  cleanup();
});

describe("Modal", () => {
  test("draws a worded title as given: the Spanish Red stays Red", () => {
    inLanguage(
      spanish,
      <Modal title="Red" isTitleTranslated={true} onSubmit={noop}>
        <p>Body</p>
      </Modal>,
    );

    expect(textOf("modal-title")).toBe("Red");
  });

  test("still looks an English title up, once: Network reads Red, never Rojo", () => {
    inLanguage(
      spanish,
      <Modal title="Network" onSubmit={noop}>
        <p>Body</p>
      </Modal>,
    );

    expect(textOf("modal-title")).toBe("Red");
  });

  test("without the flag, a worded title is looked up again: the bug the flag is for (control)", () => {
    inLanguage(
      spanish,
      <Modal title="Red" onSubmit={noop}>
        <p>Body</p>
      </Modal>,
    );

    expect(textOf("modal-title")).toBe("Rojo");
  });

  test("names the dialog by the title as given, for a screen reader", () => {
    inLanguage(
      spanish,
      <Modal title="Red" isTitleTranslated={true} onSubmit={noop}>
        <p>Body</p>
      </Modal>,
    );

    expect(screen.getByRole("dialog", { name: "Red" })).toBeInTheDocument();
  });

  test("words its footer buttons once: Save reads Guardar, never Ahorrar", () => {
    inLanguage(
      spanish,
      <Modal title="Network" onSubmit={noop} onClose={noop}>
        <p>Body</p>
      </Modal>,
    );

    expect(textOf("modal-footer-submit-button")).toBe("Guardar");
    expect(textOf("modal-footer-close-button")).toBe("Cancelar");
  });
});

describe("ConfirmModal and BasicFormModal hand the flag on", () => {
  test.each([
    ["en", english, "Delete Okta"],
    ["de", german, "Okta löschen"],
    ["ar", arabic, "حذف Okta"],
    ["fa", persian, "حذف Okta"],
  ])(
    "%s: a title worded around a name reads as worded",
    (_language: string, language: i18n, expected: string) => {
      inLanguage(language, <DeleteDialog name="Okta" />);

      expect(withoutIsolates(textOf("modal-title"))).toBe(expected);
    },
  );

  test("German: a name that is itself an English key keeps its spelling", () => {
    inLanguage(german, <DeleteDialog name="Logs" />);

    expect(textOf("modal-title")).toBe("Logs löschen");
  });

  test("BasicFormModal draws a worded title as given", async () => {
    inLanguage(
      spanish,
      <BasicFormModal<JSONObject>
        title="Red"
        isTitleTranslated={true}
        onClose={getJestMockFunction()}
        onSubmit={getJestMockFunction()}
        formProps={{
          disableAutofocus: true,
          fields: [
            {
              field: { name: true },
              title: "Name",
              fieldType: FormFieldSchemaType.Text,
            },
          ],
        }}
      />,
    );

    await screen.findByRole("textbox");

    expect(textOf("modal-title")).toBe("Red");
  });
});

describe("SideOver", () => {
  test("draws a record's own name as written, even when it is an English key", () => {
    inLanguage(
      german,
      <SideOver
        title="Logs"
        isTitleTranslated={true}
        description="Protokolle"
        isDescriptionTranslated={true}
        onClose={noop}
      >
        <p>Body</p>
      </SideOver>,
    );

    expect(textOf("side-over-title")).toBe("Logs");
    expect(textOf("side-over-description")).toBe("Protokolle");
  });

  test("looks an English title and description up, once, when not told otherwise", () => {
    inLanguage(
      spanish,
      <SideOver title="Network" description="Network" onClose={noop}>
        <p>Body</p>
      </SideOver>,
    );

    expect(textOf("side-over-title")).toBe("Red");
    expect(textOf("side-over-description")).toBe("Red");
  });

  test("a worded description is drawn as given: Red stays Red", () => {
    inLanguage(
      spanish,
      <SideOver
        title="Network"
        description="Red"
        isDescriptionTranslated={true}
        onClose={noop}
      >
        <p>Body</p>
      </SideOver>,
    );

    expect(textOf("side-over-description")).toBe("Red");
  });
});

describe("Button", () => {
  test.each([
    ["en", english, "Show 20 more"],
    ["es", spanish, "Mostrar 20 más"],
    ["de", german, "20 weitere anzeigen"],
    // Arabic writes its counts in the Western digits, as the Dashboard does.
    ["ar", arabic, "عرض 20 إضافية"],
    ["fa", persian, "نمایش ۲۰ مورد دیگر"],
  ])(
    "%s: a title worded around a count reads as worded",
    (_language: string, language: i18n, expected: string) => {
      inLanguage(language, <ShowMoreButton count={20} />);

      expect(withoutIsolates(textOf("show-more"))).toBe(expected);
    },
  );

  test("draws a worded title as given, and looks an English one up once", () => {
    inLanguage(
      spanish,
      <>
        <Button title="Red" isTitleTranslated={true} dataTestId="worded" />
        <Button title="Network" dataTestId="english" />
      </>,
    );

    expect(textOf("worded")).toBe("Red");
    expect(textOf("english")).toBe("Red");
  });
});
