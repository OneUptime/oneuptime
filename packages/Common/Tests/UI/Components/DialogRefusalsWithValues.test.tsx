import ConfirmModal from "../../../UI/Components/Modal/ConfirmModal";
import ModalBody from "../../../UI/Components/Modal/ModalBody";
import {
  getFieldNotSyncableRefusal,
  getMonitorTypeMismatchRefusal,
  FIELD_NOT_SYNCABLE_REFUSAL,
  MONITOR_TYPE_MISMATCH_REFUSAL,
  TEMPLATE_NOT_FOUND_REFUSAL,
  TEMPLATE_WITHOUT_TYPE_REFUSAL,
} from "../../../Utils/Monitor/MonitorTemplateLinkRefusal";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import "@testing-library/jest-dom";
import { act, cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import React from "react";
import { initReactI18next } from "react-i18next";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * A DIALOG SAYS A REFUSAL WITH VALUES IN THE READER'S LANGUAGE (#7711).
 *
 * Only the sentences that write an error into their own words
 * (getErrorInSentenceText) read a refusal's values back out of the
 * server's English. A dialog's error banner (ModalBody, under every Modal,
 * ConfirmModal and BasicFormModal) and an Error dialog's description
 * (ConfirmModal) looked the message up whole, and a refusal with values in
 * it is no key once they are in: "This monitor's type is Ping, and this
 * template's type is API." read English on a German page. Both read it as
 * the cards do now (sayRefusalWithValues), with the values in place, and
 * look every other text up as before.
 *
 * The template's own refusals (#7711) are said in German there too: one a
 * fixed sentence, one with the setting it names.
 */

const LOCALES: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const wordsOf: (language: string) => Record<string, unknown> = (
  language: string,
): Record<string, unknown> => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
};

const GERMAN: Record<string, unknown> = wordsOf("de");

const germanOf: (key: string) => string = (key: string): string => {
  return GERMAN[key] as string;
};

const textOf: (element: HTMLElement) => string = (
  element: HTMLElement,
): string => {
  return withoutIsolateMarks(element.textContent || "");
};

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "de",
    fallbackLng: "en",
    resources: {
      de: { translation: GERMAN },
      en: { translation: wordsOf("en") },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });

  await act(async () => {
    await i18next.changeLanguage("de");
  });
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

const MISMATCH: string = getMonitorTypeMismatchRefusal({
  monitorType: "Ping",
  templateType: "API",
});

const NOT_SYNCABLE: string = getFieldNotSyncableRefusal("monitorName");

describe("an Error dialog's description", () => {
  test("says a refusal with values in German, with its values in place", () => {
    render(
      <ConfirmModal
        title="Couldn't link the monitor"
        description={MISMATCH}
        submitButtonText="Close"
        onSubmit={() => {}}
      />,
    );

    const dialog: HTMLElement = screen.getByRole("dialog");
    const text: string = textOf(dialog);

    expect(germanOf(MONITOR_TYPE_MISMATCH_REFUSAL.template)).not.toBe(
      MONITOR_TYPE_MISMATCH_REFUSAL.template,
    );
    expect(text).not.toContain("This monitor's type is");
    expect(text).toContain("Ping");
    expect(text).toContain("API");
  });

  test("says the template's setting refusal in German, with the setting it names", () => {
    render(
      <ConfirmModal
        title="Couldn't sync"
        description={NOT_SYNCABLE}
        submitButtonText="Close"
        onSubmit={() => {}}
      />,
    );

    const text: string = textOf(screen.getByRole("dialog"));

    expect(text).toContain(
      germanOf(FIELD_NOT_SYNCABLE_REFUSAL.template).replace(
        "{{field}}",
        "monitorName",
      ),
    );
    expect(text).not.toContain("A monitor template cannot sync");
  });

  test("says a fixed refusal of the template in German, looked up as before", () => {
    render(
      <ConfirmModal
        title="Couldn't sync"
        description={TEMPLATE_NOT_FOUND_REFUSAL}
        submitButtonText="Close"
        onSubmit={() => {}}
      />,
    );

    expect(textOf(screen.getByRole("dialog"))).toContain(
      germanOf(TEMPLATE_NOT_FOUND_REFUSAL),
    );
  });

  test("looks any other description up as before", () => {
    render(
      <ConfirmModal
        title="Delete"
        description="Are you sure you want to delete this item?"
        submitButtonText="Delete"
        onSubmit={() => {}}
      />,
    );

    const german: unknown =
      GERMAN["Are you sure you want to delete this item?"];

    expect(textOf(screen.getByRole("dialog"))).toContain(
      typeof german === "string"
        ? german
        : "Are you sure you want to delete this item?",
    );
  });
});

describe("a dialog's error banner", () => {
  test("says a refusal with values in German, with its values in place", () => {
    render(
      <ModalBody error={MISMATCH}>
        <div />
      </ModalBody>,
    );

    const banner: string = textOf(screen.getByTestId("modal-error"));

    expect(banner).not.toContain("This monitor's type is");
    expect(banner).toContain("Ping");
    expect(banner).toContain("API");
  });

  test("says the template's refusals in German", () => {
    render(
      <ModalBody error={TEMPLATE_WITHOUT_TYPE_REFUSAL}>
        <div />
      </ModalBody>,
    );

    expect(textOf(screen.getByTestId("modal-error"))).toContain(
      germanOf(TEMPLATE_WITHOUT_TYPE_REFUSAL),
    );

    cleanup();

    render(
      <ModalBody error={NOT_SYNCABLE}>
        <div />
      </ModalBody>,
    );

    const banner: string = textOf(screen.getByTestId("modal-error"));

    expect(banner).toContain("monitorName");
    expect(banner).not.toContain("A monitor template cannot sync");
  });
});
