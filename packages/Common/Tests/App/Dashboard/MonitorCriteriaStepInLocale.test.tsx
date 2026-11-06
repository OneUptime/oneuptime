import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import React, { FunctionComponent, ReactElement } from "react";
import MonitorCriteriaElement from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorCriteria";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { CheckOn, FilterType } from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import TinyFormDocumentation from "../../../UI/Components/TinyFormDocumentation/TinyFormDocumentation";
import {
  DASHBOARD_LANGUAGES,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * CREATE MONITOR'S CRITERIA STEP, IN THE READER'S LANGUAGE.
 *
 * Two lines of the step read English on every page. A criteria box's place
 * in the order said "1 of 2" in every language - its sentence was never
 * worded - and on a Persian page, laid out right to left, it read "of 2 1".
 * And the Website and API monitors' "URL placeholder help" was drawn as it
 * was given: TinyFormDocumentation never looked its title up, so its
 * translation in every locale went unused.
 *
 * The position is worded in each language as "{{position}} of {{count}}"
 * already is, its numbers in the reader's digits, in the grey of the
 * summary beside the criteria's name; the fold's title is looked up by the
 * fold itself, as the other shared components look up theirs.
 */

const POSITION_KEY: string = "{{position}} of {{total}}";

function buildCriteria(name: string): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: undefined,
    filterCondition: FilterCondition.All,
    filters: [
      {
        checkOn: CheckOn.ResponseTime,
        filterType: FilterType.GreaterThan,
        value: 3000,
      },
    ],
    incidents: [],
    alerts: [],
    changeMonitorStatus: false,
    createIncidents: false,
    createAlerts: false,
    isEnabled: true,
    name: name,
    description: "",
  };
  return instance;
}

const CriteriaEditor: FunctionComponent = (): ReactElement => {
  const [value, setValue] = React.useState<MonitorCriteria>(
    (): MonitorCriteria => {
      const criteria: MonitorCriteria = new MonitorCriteria();
      criteria.data = {
        monitorCriteriaInstanceArray: [
          buildCriteria("Check if Storefront is offline"),
          buildCriteria("Check if Storefront is online"),
        ],
      };
      return criteria;
    },
  );

  return (
    <MonitorCriteriaElement
      monitorType={MonitorType.Website}
      monitorStep={new MonitorStep()}
      monitorStatusDropdownOptions={[]}
      incidentSeverityDropdownOptions={[]}
      alertSeverityDropdownOptions={[]}
      onCallPolicyDropdownOptions={[]}
      labelDropdownOptions={[]}
      userDropdownOptions={[]}
      value={value}
      onChange={(changed: MonitorCriteria) => {
        setValue(changed);
      }}
    />
  );
};

function positions(): Array<string> {
  return screen
    .getAllByTestId("monitor-criteria-position")
    .map((element: HTMLElement): string => {
      return withoutIsolateMarks(element.textContent || "");
    });
}

async function inLanguage(language: string): Promise<void> {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage(language);
  });
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      de: { translation: readDashboardLocale("de") },
      fa: { translation: readDashboardLocale("fa") },
      ja: { translation: readDashboardLocale("ja") },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await inLanguage("en");
});

describe("a criteria box's place in the order", () => {
  test("reads as it always did in English", async () => {
    await inLanguage("en");
    render(<CriteriaEditor />);

    expect(positions()).toEqual(["1 of 2", "2 of 2"]);
  });

  test("is in the grey of the summary beside the name, not a lighter one", async () => {
    await inLanguage("en");
    render(<CriteriaEditor />);

    for (const element of screen.getAllByTestId("monitor-criteria-position")) {
      // gray-400 was 2.4:1 on the header's gray-50 ground; gray-500 is 4.6:1.
      expect(element).toHaveClass("text-xs", "text-gray-500");
      expect(element).not.toHaveClass("text-gray-400");
    }
  });

  test("reads in German", async () => {
    await inLanguage("de");
    render(<CriteriaEditor />);

    expect(positions()).toEqual(["1 von 2", "2 von 2"]);
  });

  test("reads in Persian, in Persian digits, never 'of 2 1'", async () => {
    await inLanguage("fa");
    render(<CriteriaEditor />);

    expect(positions()).toEqual(["۱ از ۲", "۲ از ۲"]);

    for (const position of positions()) {
      expect(position).not.toContain("of");
    }
  });

  test("reads in Japanese as it already did", async () => {
    await inLanguage("ja");
    render(<CriteriaEditor />);

    expect(positions()).toEqual(["1 / 2", "2 / 2"]);
  });

  test.each(DASHBOARD_LANGUAGES as Array<string>)(
    "is worded in %s, the place and the count each said once",
    (language: string) => {
      const worded: string | undefined =
        readDashboardLocale(language)[POSITION_KEY];

      expect(worded).toBeDefined();
      expect([language, worded]).not.toEqual([language, POSITION_KEY]);
      expect(worded!.split("{{position}}")).toHaveLength(2);
      expect(worded!.split("{{total}}")).toHaveLength(2);
    },
  );
});

describe("a small help fold's title", () => {
  test("is looked up in the reader's language", async () => {
    await inLanguage("de");
    render(
      <TinyFormDocumentation title="URL placeholder help">
        <div>{"{{timestamp}}"}</div>
      </TinyFormDocumentation>,
    );

    expect(screen.getByText("URL-Platzhalter-Hilfe")).toBeInTheDocument();
    expect(screen.queryByText("URL placeholder help")).toBeNull();
  });

  test("on a Persian page too", async () => {
    await inLanguage("fa");
    render(
      <TinyFormDocumentation title="URL placeholder help">
        <div>{"{{timestamp}}"}</div>
      </TinyFormDocumentation>,
    );

    expect(
      screen.getByText(readDashboardLocale("fa")["URL placeholder help"]!),
    ).toBeInTheDocument();
  });

  test("a title already in the reader's words is drawn as it is given", async () => {
    await inLanguage("de");
    render(
      <TinyFormDocumentation title="Formatierungshilfe">
        <div>help</div>
      </TinyFormDocumentation>,
    );

    expect(screen.getByText("Formatierungshilfe")).toBeInTheDocument();
  });

  test("an English page reads the title as written", async () => {
    await inLanguage("en");
    render(
      <TinyFormDocumentation title="URL placeholder help">
        <div>help</div>
      </TinyFormDocumentation>,
    );

    expect(screen.getByText("URL placeholder help")).toBeInTheDocument();
  });
});
