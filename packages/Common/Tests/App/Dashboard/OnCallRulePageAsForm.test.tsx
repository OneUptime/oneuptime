import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import React from "react";
import { initReactI18next } from "react-i18next";
import OneUptimeDate from "../../../Types/Date";
import OnCallPageAs from "../../../Types/OnCallDutyPolicy/OnCallPageAs";
import OnCallRuleWhenToPage from "../../../Types/OnCallDutyPolicy/OnCallRuleWhenToPage";
import WorkingHours from "../../../Types/OnCallDutyPolicy/WorkingHours";
import type Field from "../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import type FormValues from "../../../UI/Components/Forms/Types/FormValues";
import {
  PAGE_AS_DESCRIPTIONS,
  PAGE_AS_TITLE,
  PAGE_AS_TITLES,
  getOnCallRuleActionFields,
  getPageAsFoldedValue,
  isObserverRule,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/EventRuleForm";
import { OnCallRuleRecord } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallRule/WorkingHoursText";
import {
  OBSERVERS_ROW_SUMMARY,
  OBSERVERS_ROW_SUMMARY_TEST_ID,
  OnCallRuleNameCell,
  WORKING_HOURS_ROW_SUMMARY_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallRule/WorkingHoursSummary";
import {
  PAGE_AS_OBSERVERS_DESCRIPTION,
  PAGE_AS_OBSERVERS_TITLE,
  getPageAsObserversField,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ExecutePolicy/PageAsObserversField";

/*
 * WHAT AN ON-CALL RULE PAGES ITS POLICIES' PEOPLE AS, ON ITS FORM AND IN ITS
 * LIST (OnCallPageAs, OnCallObserverPage).
 *
 * "Sev 0-1: paged automatically, but they are only observers." Under More
 * fields, "Page the people of these policies as": Responders, as rules
 * always have, or Observers - kept informed while the people responding
 * stay on it. Each answer says what it means. Most rules page responders,
 * so the question waits folded, and only a rule that pages observers is
 * named on the folded line and, under its name, in the rules list.
 *
 * The feed's Execute On-Call Policy asks the same with one switch, off
 * until turned on, on every record's feed.
 */

type Values = Record<string, unknown>;

const ZONE: string = "Europe/London";

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src",
);

const ALL_RECORDS: Array<OnCallRuleRecord> = [
  OnCallRuleRecord.Incident,
  OnCallRuleRecord.Alert,
  OnCallRuleRecord.IncidentEpisode,
  OnCallRuleRecord.AlertEpisode,
];

function fields(
  record: OnCallRuleRecord = OnCallRuleRecord.Incident,
): Array<Field<Values>> {
  return getOnCallRuleActionFields<Values>(record);
}

function columnOf(item: Field<Values>): string {
  return Object.keys(item.field || {})[0] || "";
}

function field(
  column: string,
  from: Array<Field<Values>> = fields(),
): Field<Values> {
  const found: Field<Values> | undefined = from.find(
    (candidate: Field<Values>): boolean => {
      return columnOf(candidate) === column;
    },
  );

  expect(found).toBeDefined();
  return found!;
}

function asValues(values: Values): FormValues<Values> {
  return values as FormValues<Values>;
}

function readSource(relative: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, relative), "utf8");
}

const readLocale: (language: string) => Record<string, unknown> = (
  language: string,
): Record<string, unknown> => {
  return JSON.parse(
    fs.readFileSync(
      path.join(DASHBOARD_SRC, "Locales", `${language}.json`),
      "utf8",
    ),
  ) as Record<string, unknown>;
};

let clock: { mockRestore: () => void } | null = null;

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: readLocale("en") },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  clock = jest
    .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
    .mockReturnValue(false);
  await act(async () => {
    await i18next.changeLanguage("en");
  });
});

afterEach(() => {
  clock?.mockRestore();
  cleanup();
});

describe("the rule's form asks what its policies' people are paged as", () => {
  test.each(ALL_RECORDS)(
    "%s rules: under More fields, right before when the rule pages, in the rule's step",
    (record: OnCallRuleRecord) => {
      const built: Array<Field<Values>> = fields(record);
      const columns: Array<string> = built.map(columnOf);
      const description: Field<Values> = field("description", built);
      const pageAs: Field<Values> = field("pageAs", built);

      expect(columns.indexOf("pageAs")).toBe(
        columns.indexOf("description") + 1,
      );
      expect(columns.indexOf("whenToPage")).toBe(columns.indexOf("pageAs") + 1);
      expect(pageAs.collapsibleSection).toBe(description.collapsibleSection);
      expect(pageAs.stepId).toBe("on-call");
    },
  );

  test("Responders first, as every rule paged before; Observers second - each saying what it means", () => {
    const pageAs: Field<Values> = field("pageAs");

    expect(pageAs.title).toBe("Page the people of these policies as");
    expect(PAGE_AS_TITLE).toBe(pageAs.title);
    expect(pageAs.fieldType).toBe(FormFieldSchemaType.RadioButton);
    expect(pageAs.radioButtonOptions).toEqual([
      {
        title: "Responders",
        description:
          "They take it on. Acknowledging the page acknowledges it and stops every other page about it.",
        value: OnCallPageAs.Responders,
      },
      {
        title: "Observers",
        description:
          "They're kept informed while the people responding stay on it. Acknowledging only says they've seen it: nothing else is acknowledged, nobody else's page stops, and they aren't added to its channel as responders.",
        value: OnCallPageAs.Observers,
      },
    ]);
    expect(PAGE_AS_TITLES[OnCallPageAs.Observers]).toBe("Observers");
    expect(PAGE_AS_DESCRIPTIONS[OnCallPageAs.Responders]).toContain(
      "They take it on.",
    );
  });

  test("there is always an answer - the column starts on Responders - and the answers speak for themselves", () => {
    const pageAs: Field<Values> = field("pageAs");

    expect(pageAs.required).toBe(true);
    expect(pageAs.hideColumnDescription).toBe(true);
    expect(pageAs.dataTestId).toBe("on-call-rule-page-as");
  });

  test.each([
    [{}, false],
    [{ pageAs: OnCallPageAs.Responders }, false],
    [{ pageAs: "something else" }, false],
    [{ pageAs: OnCallPageAs.Observers }, true],
  ])(
    "a rule with %p is named on the folded line: %p",
    (values: Values, isNamed: boolean) => {
      const pageAs: Field<Values> = field("pageAs");

      expect(isObserverRule(values)).toBe(isNamed);
      expect(pageAs.isListedWhileFolded!(asValues(values))).toBe(isNamed);
      expect(pageAs.getFoldedValue!(asValues(values))).toBe(
        isNamed ? "Observers" : null,
      );
      expect(getPageAsFoldedValue(values)).toBe(isNamed ? "Observers" : null);
    },
  );
});

describe("the rules list says which rules page observers", () => {
  test("under the name of a rule that pages observers: it pages as observers, and nothing is acknowledged", () => {
    render(
      <OnCallRuleNameCell
        name="Sev 1 incidents: Oversight"
        rule={{
          whenToPage: OnCallRuleWhenToPage.RightAway,
          pageAs: OnCallPageAs.Observers,
        }}
      />,
    );

    expect(screen.getByText("Sev 1 incidents: Oversight")).toBeVisible();
    expect(screen.getByTestId(OBSERVERS_ROW_SUMMARY_TEST_ID)).toHaveTextContent(
      OBSERVERS_ROW_SUMMARY,
    );
    expect(OBSERVERS_ROW_SUMMARY).toBe(
      "Pages as observers: kept informed, nothing is acknowledged",
    );
    expect(screen.queryByTestId(WORKING_HOURS_ROW_SUMMARY_TEST_ID)).toBeNull();
  });

  test("a rule that pages observers during working hours says both: what it pages as, then when", () => {
    const view: ReturnType<typeof render> = render(
      <OnCallRuleNameCell
        name="Sev 2 incidents: Oversight"
        rule={{
          whenToPage: OnCallRuleWhenToPage.WorkingHours,
          workingHours: WorkingHours.getDefaultHours({ timezone: ZONE }),
          workingHoursTimezone: ZONE,
          pageAs: OnCallPageAs.Observers,
        }}
      />,
    );

    const observers: HTMLElement = screen.getByTestId(
      OBSERVERS_ROW_SUMMARY_TEST_ID,
    );
    const hours: HTMLElement = screen.getByTestId(
      WORKING_HOURS_ROW_SUMMARY_TEST_ID,
    );

    expect(
      observers.compareDocumentPosition(hours) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(view.container).toHaveTextContent("Sev 2 incidents: Oversight");
  });

  test.each([undefined, null, OnCallPageAs.Responders])(
    "a rule that pages responders (%p) is its name, as it always was",
    (pageAs: OnCallPageAs | null | undefined) => {
      const view: ReturnType<typeof render> = render(
        <OnCallRuleNameCell
          name="Sev 1 incidents: Platform on-call"
          rule={{ whenToPage: OnCallRuleWhenToPage.RightAway, pageAs: pageAs }}
        />,
      );

      expect(view.container).toHaveTextContent(
        /^Sev 1 incidents: Platform on-call$/,
      );
      expect(screen.queryByTestId(OBSERVERS_ROW_SUMMARY_TEST_ID)).toBeNull();
    },
  );

  test("each of the four rules tables reads what its rules page as", () => {
    for (const page of [
      "Pages/Alerts/Settings/AlertOnCallRules.tsx",
      "Pages/Incidents/Settings/IncidentOnCallRules.tsx",
    ]) {
      // The rule table and the episode table.
      expect(readSource(page).match(/pageAs: true/g) || []).toHaveLength(2);
    }
  });
});

describe("Execute On-Call Policy, on a record's feed", () => {
  test("one switch, off until turned on: Page them as observers, saying what that means", () => {
    const switchField: ReturnType<typeof getPageAsObserversField> =
      getPageAsObserversField();

    expect(switchField.field).toEqual({ isObserverPage: true });
    expect(switchField.fieldType).toBe(FormFieldSchemaType.Toggle);
    expect(switchField.required).toBe(false);
    expect(switchField.defaultValue).toBe(false);
    expect(switchField.title).toBe(PAGE_AS_OBSERVERS_TITLE);
    expect(PAGE_AS_OBSERVERS_TITLE).toBe("Page them as observers");
    expect(switchField.description).toBe(PAGE_AS_OBSERVERS_DESCRIPTION);
    expect(PAGE_AS_OBSERVERS_DESCRIPTION).toBe(
      "Kept informed while others respond: their answer only says they've seen it, and nothing is acknowledged.",
    );
  });

  test.each([
    "Components/Incident/IncidentFeed.tsx",
    "Components/Alert/AlertFeed.tsx",
    "Components/IncidentEpisode/IncidentEpisodeFeed.tsx",
    "Components/AlertEpisode/AlertEpisodeFeed.tsx",
  ])("%s's Execute On-Call Policy form has the switch", (feed: string) => {
    expect(readSource(feed)).toContain("getPageAsObserversField()");
  });
});

describe("the words, in the Dashboard's locale", () => {
  test("every new label is a key of the English locale, to be translated", () => {
    const english: Record<string, unknown> = readLocale("en");

    for (const key of [
      PAGE_AS_TITLE,
      PAGE_AS_TITLES[OnCallPageAs.Responders],
      PAGE_AS_TITLES[OnCallPageAs.Observers],
      PAGE_AS_DESCRIPTIONS[OnCallPageAs.Responders],
      PAGE_AS_DESCRIPTIONS[OnCallPageAs.Observers],
      OBSERVERS_ROW_SUMMARY,
      PAGE_AS_OBSERVERS_TITLE,
      PAGE_AS_OBSERVERS_DESCRIPTION,
    ]) {
      expect({ key, inLocale: english[key] }).toEqual({ key, inLocale: key });
    }
  });
});
