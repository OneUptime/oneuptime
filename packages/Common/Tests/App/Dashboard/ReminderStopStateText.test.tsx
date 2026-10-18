import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import React from "react";
import ReminderStopState from "../../../Types/Reminder/ReminderStopState";
import ReminderStopStateText from "../../../../App/FeatureSet/Dashboard/src/Components/Reminders/ReminderStopStateText";

/*
 * Incidents > Rules > Reminder Rules and Alerts > Rules > Reminder Rules
 * list each rule's "Stop Reminders When". The list printed the stored value
 * as it is - "Resolved", "Acknowledged" - in English in every language,
 * beside a form that offers the same two answers in the reader's language.
 * It now shows the answer as the form words it, read from the real German
 * locale file, and a stored value it cannot read as Resolved, as the
 * reminder workers do.
 */

const GERMAN: Record<string, string> = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../../App/FeatureSet/Dashboard/src/Locales/de.json",
    ),
    "utf8",
  ),
) as Record<string, string>;

const german: i18n = createInstance();

beforeAll(async () => {
  await german.init({
    lng: "de",
    resources: { de: { translation: GERMAN } },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(() => {
  cleanup();
});

function renderValue(value: unknown, inGerman: boolean): void {
  const element: React.ReactElement = <ReminderStopStateText value={value} />;

  render(
    inGerman ? (
      <I18nextProvider i18n={german}>{element}</I18nextProvider>
    ) : (
      element
    ),
  );
}

describe("a reminder rule's Stop Reminders When in the rules list", () => {
  test.each([
    [ReminderStopState.Resolved, "Resolved"],
    [ReminderStopState.Acknowledged, "Acknowledged"],
  ])("%s reads %s in English", (value: string, text: string) => {
    renderValue(value, false);

    expect(screen.getByText(text)).toBeInTheDocument();
  });

  test.each([
    [ReminderStopState.Resolved, "Behoben"],
    [ReminderStopState.Acknowledged, "Bestätigt"],
  ])(
    "%s reads %s in German, as the form's answer does",
    (value: string, text: string) => {
      // The words the form's answers use (EventRuleForm).
      expect(GERMAN[value]).toBe(text);

      renderValue(value, true);

      expect(screen.getByText(text)).toBeInTheDocument();
      expect(screen.queryByText(value)).toBeNull();
    },
  );

  test.each([[null], [undefined], [""], ["Ongoing"]])(
    "a stored %p reads Resolved, as the reminder workers read it",
    (value: unknown) => {
      renderValue(value, true);

      expect(screen.getByText("Behoben")).toBeInTheDocument();
    },
  );
});
