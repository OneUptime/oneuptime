import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import React from "react";
import GroupingRuleSummary from "../../../../App/FeatureSet/Dashboard/src/Components/GroupingRule/GroupingRuleSummary";
import GroupingModeField from "../../../../App/FeatureSet/Dashboard/src/Components/GroupingRule/GroupingModeField";
import MinutesSettingField from "../../../../App/FeatureSet/Dashboard/src/Components/GroupingRule/MinutesSettingField";
import { translateGroupingRuleText } from "../../../../App/FeatureSet/Dashboard/src/Components/GroupingRule/GroupingRuleTranslate";
import {
  GROUPING_RULE_COPY,
  GroupingMode,
  GroupingRuleKind,
  getMinutesValidationError,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/GroupingRule/GroupingRuleSetup";

/*
 * The grouping rule pages in another language, from the shipped locale
 * files: sentences with a value in them are translated whole and the value
 * goes where each language puts it - in Japanese the minutes box sits in the
 * middle of its sentence, not after "Within".
 *
 * The Dashboard sets i18next up once, globally, with react-i18next; so does
 * this file. Each jest file has its own module registry, so it reaches no
 * other suite.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "de",
    fallbackLng: "de",
    resources: {
      de: { translation: readLocale("de") },
      ja: { translation: readLocale("ja") },
    },
    interpolation: { escapeValue: false },
  });
});

afterEach(async () => {
  cleanup();
  await act(async (): Promise<void> => {
    await i18next.changeLanguage("de");
  });
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

describe("the grouping rule pages in German", () => {
  test("the list says what a rule does in German, durations included", () => {
    render(
      <GroupingRuleSummary
        kind={GroupingRuleKind.Incident}
        rule={{
          groupByMonitor: true,
          enableTimeWindow: true,
          timeWindowMinutes: 30,
          onCallDutyPolicies: [{ _id: "a" }, { _id: "b" }],
        }}
      />,
    );

    expect(
      screen.getByTestId("grouping-rule-summary-grouping"),
    ).toHaveTextContent("Eine Episode pro Monitor");
    expect(
      screen.getByTestId("grouping-rule-summary-timing"),
    ).toHaveTextContent(
      "Neue Vorfälle kommen hinzu, solange sie innerhalb von 30 Minuten nach dem letzten eintreffen",
    );
    expect(
      screen.getByTestId("grouping-rule-summary-details"),
    ).toHaveTextContent("Führt 2 Bereitschaftsrichtlinien aus");
  });

  test("a custom mix lists the switches by their German names", () => {
    render(
      <GroupingRuleSummary
        kind={GroupingRuleKind.Alert}
        rule={{ groupBySeverity: true, groupByAlertLabels: true }}
      />,
    );

    expect(
      screen.getByTestId("grouping-rule-summary-grouping"),
    ).toHaveTextContent(
      "Eine Episode pro Kombination aus: Schweregrad, Warnungsbeschriftungen",
    );
    expect(
      screen.getByTestId("grouping-rule-summary-timing"),
    ).toHaveTextContent(
      "Neue Warnungen kommen hinzu, bis die Episode behoben ist",
    );
  });

  test("the Group-by cards are German", () => {
    render(
      <GroupingModeField
        kind={GroupingRuleKind.Incident}
        value={GroupingMode.Monitor}
        onChange={(): void => {}}
      />,
    );

    expect(
      screen.getByTestId("card-select-option-everything"),
    ).toHaveTextContent("Alles zusammen");
    expect(screen.getByTestId("card-select-option-monitor")).toHaveTextContent(
      "Eine Episode pro Monitor. Für die meisten Teams eine gute Standardwahl.",
    );
  });

  test("a minutes setting reads as one German sentence around its box", () => {
    render(
      <MinutesSettingField
        title={GROUPING_RULE_COPY.timeWindowTitle[GroupingRuleKind.Incident]}
        description={
          GROUPING_RULE_COPY.timeWindowDescription[GroupingRuleKind.Incident]
        }
        sentence={
          GROUPING_RULE_COPY.timeWindowSentence[GroupingRuleKind.Incident]
        }
        minutesLabel="Time Window"
        enabled={true}
        minutes={30}
        defaultMinutes={30}
        dataTestId="time-window-setting"
        onChange={(): void => {}}
      />,
    );

    expect(
      screen.getByRole("switch", {
        name: "Nur Vorfälle gruppieren, die kurz nacheinander eintreffen",
      }),
    ).toBeInTheDocument();

    const row: HTMLElement = screen.getByTestId(
      "time-window-setting-minutes-row",
    );

    expect(row.firstElementChild).toHaveTextContent(/^Innerhalb von$/);
    expect(row.lastElementChild).toHaveTextContent(
      /^Minuten nach dem vorherigen Vorfall$/,
    );
    expect(
      within(row).getByRole("spinbutton", { name: "Zeitfenster" }),
    ).toHaveValue(30);
  });

  test("the validation message is German, with its limit filled in", () => {
    expect(
      getMinutesValidationError({
        enabled: true,
        minutes: "",
        translate: translateGroupingRuleText,
      }),
    ).toBe("Geben Sie eine ganze Zahl an Minuten zwischen 1 und 525600 ein.");
  });
});

describe("the grouping rule pages in Japanese", () => {
  test("the minutes box sits where Japanese puts the number", async () => {
    await act(async (): Promise<void> => {
      await i18next.changeLanguage("ja");
    });

    render(
      <MinutesSettingField
        title={GROUPING_RULE_COPY.timeWindowTitle[GroupingRuleKind.Alert]}
        description={
          GROUPING_RULE_COPY.timeWindowDescription[GroupingRuleKind.Alert]
        }
        sentence={GROUPING_RULE_COPY.timeWindowSentence[GroupingRuleKind.Alert]}
        minutesLabel="Time Window"
        enabled={true}
        minutes={15}
        defaultMinutes={30}
        dataTestId="time-window-setting"
        onChange={(): void => {}}
      />,
    );

    const row: HTMLElement = screen.getByTestId(
      "time-window-setting-minutes-row",
    );

    expect(row.children).toHaveLength(3);
    expect(row.firstElementChild).toHaveTextContent(/^前のアラートから$/);
    expect(row.lastElementChild).toHaveTextContent(/^分以内$/);
    expect(within(row).getByRole("spinbutton")).toHaveValue(15);
  });

  test("the list's notes are Japanese", async () => {
    await act(async (): Promise<void> => {
      await i18next.changeLanguage("ja");
    });

    render(
      <GroupingRuleSummary
        kind={GroupingRuleKind.Incident}
        rule={{
          enableTimeWindow: false,
          enableInactivityTimeout: true,
          inactivityTimeoutMinutes: 120,
        }}
      />,
    );

    expect(
      screen.getByTestId("grouping-rule-summary-grouping"),
    ).toHaveTextContent(
      "一致するすべてのインシデントで 1 つのエピソードを共有",
    );
    expect(
      screen.getByTestId("grouping-rule-summary-details"),
    ).toHaveTextContent(
      "新しいインシデントがないまま 2 時間 経過すると解決します",
    );
  });
});
