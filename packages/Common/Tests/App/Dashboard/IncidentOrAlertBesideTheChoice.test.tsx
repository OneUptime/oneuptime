import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import React from "react";
import IncidentOrAlertNote, {
  INCIDENT_OR_ALERT_NOTE,
  INCIDENT_OR_ALERT_NOTE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/IncidentOrAlertNote";
import MonitorCriteriaInstanceElement from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorCriteriaInstance";
import OnCallRulesTabs, {
  ON_CALL_RULES_INTRO,
  ON_CALL_RULES_INTRO_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationRule/OnCallRulesTabs";
import { SUPPORTED_DASHBOARD_LANGUAGE_CODES } from "../../../Types/Dashboard/DashboardLanguage";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { CheckOn, FilterType } from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { DEFINED_TERM_TEST_ID } from "../../../UI/Components/Glossary/DefinedTerm";
import { LEARN_MORE_LINK_TEST_ID } from "../../../UI/Components/Link/LearnMoreLink";
import { DOCS_URL } from "../../../UI/Config";

/*
 * Where someone chooses between an incident and an alert, the difference is
 * said beside the choice (#6819): incidents are for problems customers feel
 * and can show on a status page; alerts are for your team and never do. The
 * two words are defined terms on the first criteria only - a page marks a
 * word once. And the personal on-call rules say what they are, with the
 * word defined and a way to the docs.
 *
 * i18next runs for real, on the Dashboard's own locale files.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LOCALES: Record<string, Record<string, string>> = {};

for (const code of SUPPORTED_DASHBOARD_LANGUAGE_CODES) {
  LOCALES[code] = JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
  ) as Record<string, string>;
}

const criteria: () => MonitorCriteriaInstance = (): MonitorCriteriaInstance => {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  instance.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: undefined,
    filterCondition: FilterCondition.All,
    filters: [
      {
        checkOn: CheckOn.IsOnline,
        filterType: FilterType.False,
        value: undefined,
      },
    ],
    incidents: [],
    alerts: [],
    changeMonitorStatus: false,
    createIncidents: false,
    createAlerts: false,
    isEnabled: true,
    name: "Offline",
    description: "",
  };

  return instance;
};

const renderCriteria: (isFirstCriteria: boolean) => void = (
  isFirstCriteria: boolean,
): void => {
  render(
    <MonitorCriteriaInstanceElement
      monitorType={MonitorType.Website}
      monitorStep={new MonitorStep()}
      monitorStatusDropdownOptions={[]}
      incidentSeverityDropdownOptions={[]}
      alertSeverityDropdownOptions={[]}
      onCallPolicyDropdownOptions={[]}
      labelDropdownOptions={[]}
      userDropdownOptions={[]}
      value={criteria()}
      isFirstCriteria={isFirstCriteria}
    />,
  );
};

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const code of SUPPORTED_DASHBOARD_LANGUAGE_CODES) {
    resources[code] = { translation: LOCALES[code]! };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(async () => {
  cleanup();
  await i18next.changeLanguage("en");
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

describe("the note", () => {
  test("says the difference in one line, with both words defined", () => {
    render(<IncidentOrAlertNote marksTerms={true} />);

    const note: HTMLElement = screen.getByTestId(
      INCIDENT_OR_ALERT_NOTE_TEST_ID,
    );

    expect(note).toHaveTextContent(
      "Incidents are for problems your customers feel, and can show on a status page. Alerts are for your team, and never do.",
    );
    expect(
      within(note)
        .getAllByTestId(DEFINED_TERM_TEST_ID)
        .map((word: HTMLElement): string | null => {
          return word.getAttribute("data-glossary-term");
        }),
    ).toEqual(["incident", "alert"]);
  });

  test("says the same without marking the words, where a page already has", () => {
    render(<IncidentOrAlertNote marksTerms={false} />);

    const note: HTMLElement = screen.getByTestId(
      INCIDENT_OR_ALERT_NOTE_TEST_ID,
    );

    expect(note).toHaveTextContent("Alerts are for your team, and never do.");
    expect(within(note).queryByTestId(DEFINED_TERM_TEST_ID)).toBeNull();
  });

  test.each(
    SUPPORTED_DASHBOARD_LANGUAGE_CODES.filter((code: string): boolean => {
      return code !== "en";
    }),
  )(
    "%s says it in its own words, the two words its Dashboard's",
    async (code: string) => {
      await i18next.changeLanguage(code);
      render(<IncidentOrAlertNote marksTerms={true} />);

      const translated: string | undefined =
        LOCALES[code]![INCIDENT_OR_ALERT_NOTE];

      expect(translated).toBeTruthy();
      expect(translated).not.toBe(INCIDENT_OR_ALERT_NOTE);
      expect(translated).toContain("{{incidents}}");
      expect(translated).toContain("{{alerts}}");

      const words: Array<HTMLElement> =
        screen.getAllByTestId(DEFINED_TERM_TEST_ID);

      expect(words[0]).toHaveTextContent(LOCALES[code]!["Incidents"]!);
      expect(words[1]).toHaveTextContent(LOCALES[code]!["Alerts"]!);
    },
  );
});

describe("a monitor's criteria", () => {
  test("say the difference before the two switches, and the first criteria defines the words", () => {
    renderCriteria(true);

    const note: HTMLElement = screen.getByTestId(
      INCIDENT_OR_ALERT_NOTE_TEST_ID,
    );
    const alertSwitch: HTMLElement = screen.getByRole("switch", {
      name: "When filters match, create an alert.",
    });

    expect(
      note.compareDocumentPosition(alertSwitch) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(note).getAllByTestId(DEFINED_TERM_TEST_ID)).toHaveLength(2);
  });

  test("every later criteria says it too, without marking the words again", () => {
    renderCriteria(false);

    const note: HTMLElement = screen.getByTestId(
      INCIDENT_OR_ALERT_NOTE_TEST_ID,
    );

    expect(note).toHaveTextContent(
      "Incidents are for problems your customers feel",
    );
    expect(within(note).queryByTestId(DEFINED_TERM_TEST_ID)).toBeNull();
  });
});

/*
 * A person's own rules, the grid behind How to Reach Me. They were "on-call
 * rules", the name the project's rules under Incidents and Alerts keep
 * (#6817): the line defines the word they turn on, the notification method,
 * and never marks them with the project's term.
 */
describe("the rules behind How to Reach Me", () => {
  test("say what they are, with the word they turn on defined, and link their docs page", () => {
    render(
      <OnCallRulesTabs userPreferencesKeyPrefix="glossary-on-call-rules" />,
    );

    const intro: HTMLElement = screen.getByTestId(ON_CALL_RULES_INTRO_TEST_ID);

    expect(intro).toHaveTextContent(
      "These rules decide which notification method a page tries, and after how long, for each severity.",
    );
    expect(within(intro).getByTestId(DEFINED_TERM_TEST_ID)).toHaveAttribute(
      "data-glossary-term",
      "notification-method",
    );
    expect(intro.textContent?.toLowerCase()).not.toContain("on-call rules");
    expect(
      within(intro).getByTestId("on-call-rules-learn-more"),
    ).toHaveAttribute(
      "href",
      `${DOCS_URL.toString()}/en/notifications/on-call-rules`,
    );
    expect(within(intro).queryByTestId(LEARN_MORE_LINK_TEST_ID)).toBeNull();
  });

  test("say it in German", async () => {
    await i18next.changeLanguage("de");
    render(
      <OnCallRulesTabs userPreferencesKeyPrefix="glossary-on-call-rules" />,
    );

    const intro: HTMLElement = screen.getByTestId(ON_CALL_RULES_INTRO_TEST_ID);
    const german: string = LOCALES["de"]![ON_CALL_RULES_INTRO]!;

    expect(german).not.toBe(ON_CALL_RULES_INTRO);
    expect(intro).toHaveTextContent(
      german.replace(
        "{{notificationMethod}}",
        LOCALES["de"]!["notification method"]!,
      ),
    );
    expect(
      within(intro).getByTestId("on-call-rules-learn-more"),
    ).toHaveAttribute(
      "href",
      `${DOCS_URL.toString()}/de/notifications/on-call-rules`,
    );
  });
});
