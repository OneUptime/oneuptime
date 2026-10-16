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
import React, { FunctionComponent, ReactElement } from "react";
import MonitorCriteriaInstanceElement from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorCriteriaInstance";
import TraceRecordingRuleSourceEditor from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/RecordingRule/TraceRecordingRuleSourceEditor";
import { SUPPORTED_DASHBOARD_LANGUAGE_CODES } from "../../../Types/Dashboard/DashboardLanguage";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import TraceAggregationType from "../../../Types/Trace/TraceAggregationType";
import { TraceRecordingRuleSource } from "../../../Types/Trace/TraceRecordingRuleDefinition";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";

/*
 * A monitor criteria's Match Condition, and the incident switch next to it,
 * in each of the Dashboard's seventeen languages, from the shipped locale
 * files.
 *
 * - With two filters, the editor asks All or Any. Korean drew the two as
 *   전체 / 모두 - both "all" - French as Tous / Tout ("everything"), Dutch
 *   as Alle / Elke and Persian as همه / هر ("every"). Every language now
 *   draws two different words, and those four say "one or more" / "at
 *   least one".
 * - The incident switch's help read "When you delcare an incident". The
 *   component and every locale now share the corrected key, so the help is
 *   in the reader's language - a key the component and the locales did not
 *   share would show the English sentence instead.
 * - Traces' Span Kind filter drew its no-filter option with the same "Any"
 *   key, which would now read "one or more" in Korean. It says "All", in
 *   every language.
 *
 * The Dashboard sets i18next up once, globally, with react-i18next; so does
 * this file. Each jest file has its own module registry, so it reaches no
 * other suite.
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

// What the Dashboard draws for this English text in this language.
function drawn(code: string, english: string): string {
  const value: string | undefined = LOCALES[code]?.[english];

  return typeof value === "string" && value.trim() ? value : english;
}

const INCIDENT_SWITCH: string = "When filters match, declare an incident.";

const INCIDENT_SWITCH_HELP: string =
  "When you declare an incident, it is used to notify the team and is shown on the status page as well.";

// The four languages whose Any read as all, and what they say now.
const ANY_IN: Record<string, { all: string; any: string }> = {
  ko: { all: "전체", any: "하나 이상" },
  fr: { all: "Tous", any: "Au moins un" },
  nl: { all: "Alle", any: "Minstens één" },
  fa: { all: "همه", any: "دست‌کم یکی" },
};

const OPERATIONAL_STATUS_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const MONITOR_STATUS_OPTIONS: Array<DropdownOption> = [
  { value: OPERATIONAL_STATUS_ID.toString(), label: "Operational" },
];

const SLOW_RESPONSE: CriteriaFilter = {
  checkOn: CheckOn.ResponseTime,
  filterType: FilterType.GreaterThan,
  value: 3000,
};

const OFFLINE: CriteriaFilter = {
  checkOn: CheckOn.IsOnline,
  filterType: FilterType.False,
  value: undefined,
};

function twoFilterCriteria(
  filterCondition: FilterCondition,
): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  instance.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: undefined,
    filterCondition: filterCondition,
    filters: [{ ...SLOW_RESPONSE }, { ...OFFLINE }],
    incidents: [],
    alerts: [],
    changeMonitorStatus: false,
    createIncidents: false,
    createAlerts: false,
    isEnabled: true,
    name: "Slow or offline",
    description: "",
  };

  return instance;
}

function renderCriteriaEditor(filterCondition: FilterCondition): void {
  const Wrapper: FunctionComponent = (): ReactElement => {
    const [value, setValue] = React.useState<MonitorCriteriaInstance>(
      twoFilterCriteria(filterCondition),
    );

    return (
      <MonitorCriteriaInstanceElement
        monitorType={MonitorType.Website}
        monitorStep={new MonitorStep()}
        monitorStatusDropdownOptions={MONITOR_STATUS_OPTIONS}
        incidentSeverityDropdownOptions={[]}
        alertSeverityDropdownOptions={[]}
        onCallPolicyDropdownOptions={[]}
        labelDropdownOptions={[]}
        userDropdownOptions={[]}
        value={value}
        onChange={(changed: MonitorCriteriaInstance) => {
          setValue(changed);
        }}
      />
    );
  };

  render(<Wrapper />);
}

// The Match Condition's options, in the order drawn, and the one picked.
function matchConditionOptions(): { labels: Array<string>; picked: string } {
  const group: HTMLElement = within(
    screen.getByTestId("monitor-criteria-filter-condition"),
  ).getByRole("radiogroup");
  const radios: Array<HTMLElement> = within(group).getAllByRole("radio");

  const labelOf: (radio: HTMLElement) => string = (
    radio: HTMLElement,
  ): string => {
    return radio.parentElement?.textContent || "";
  };

  return {
    labels: radios.map(labelOf),
    picked: labelOf(
      radios.find((radio: HTMLElement): boolean => {
        return (radio as HTMLInputElement).checked;
      }) as HTMLElement,
    ),
  };
}

// Before anything is drawn: each test renders after switching.
async function inLanguage(code: string): Promise<void> {
  await i18next.changeLanguage(code);
  expect(i18next.language).toBe(code);
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> =
    {};

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

afterAll(async () => {
  await i18next.changeLanguage("en");
});

afterEach(() => {
  cleanup();
});

describe("a monitor criteria's Match Condition", () => {
  test("is asked in all seventeen languages", () => {
    expect(SUPPORTED_DASHBOARD_LANGUAGE_CODES).toHaveLength(17);
  });

  test.each(SUPPORTED_DASHBOARD_LANGUAGE_CODES)(
    "%s draws All, then Any, as two different words",
    async (code: string) => {
      await inLanguage(code);
      renderCriteriaEditor(FilterCondition.Any);

      const options: { labels: Array<string>; picked: string } =
        matchConditionOptions();

      expect(options.labels).toEqual([drawn(code, "All"), drawn(code, "Any")]);
      expect(new Set(options.labels).size).toBe(2);
      expect(options.picked).toBe(drawn(code, "Any"));
    },
  );

  test.each(Object.keys(ANY_IN))(
    "%s offers 'all' and 'one or more / at least one', no longer 'all' twice",
    async (code: string) => {
      await inLanguage(code);
      renderCriteriaEditor(FilterCondition.All);

      const options: { labels: Array<string>; picked: string } =
        matchConditionOptions();

      expect(options.labels).toEqual([ANY_IN[code]!.all, ANY_IN[code]!.any]);
      // A new criteria starts on All.
      expect(options.picked).toBe(ANY_IN[code]!.all);
    },
  );

  test("English offers All and Any", async () => {
    await inLanguage("en");
    renderCriteriaEditor(FilterCondition.All);

    expect(matchConditionOptions()).toEqual({
      labels: ["All", "Any"],
      picked: "All",
    });
  });
});

describe("the incident switch's help", () => {
  test("says 'declare' in English, and nowhere 'delcare'", async () => {
    await inLanguage("en");
    renderCriteriaEditor(FilterCondition.All);

    const incidentSwitch: HTMLElement = screen.getByRole("switch", {
      name: INCIDENT_SWITCH,
    });

    expect(incidentSwitch).toHaveAccessibleDescription(INCIDENT_SWITCH_HELP);
    expect(document.body.textContent).not.toContain("delcare");
    expect(document.body.textContent).toContain(INCIDENT_SWITCH_HELP);
  });

  test.each(
    SUPPORTED_DASHBOARD_LANGUAGE_CODES.filter((code: string): boolean => {
      return code !== "en";
    }),
  )("%s draws it in its own language", async (code: string) => {
    await inLanguage(code);
    renderCriteriaEditor(FilterCondition.All);

    const help: string = drawn(code, INCIDENT_SWITCH_HELP);

    // The locale translates the corrected sentence ...
    expect(help).not.toBe(INCIDENT_SWITCH_HELP);

    // ... and the switch shows that translation, not the English.
    const incidentSwitch: HTMLElement = screen.getByRole("switch", {
      name: drawn(code, INCIDENT_SWITCH),
    });

    expect(incidentSwitch).toHaveAccessibleDescription(help);
    expect(document.body.textContent).not.toContain(INCIDENT_SWITCH_HELP);
    expect(document.body.textContent).not.toContain("delcare");
  });
});

describe("Traces' Span Kind filter, left open", () => {
  const OPEN_SPAN_FILTER: TraceRecordingRuleSource = {
    alias: "A",
    aggregationType: TraceAggregationType.Count,
    // Opens the Span Filter section, with no kind picked.
    onlyErrors: true,
  };

  function spanKindField(): HTMLElement {
    const label: HTMLElement = screen.getByText(
      drawn(i18next.language, "Span Kind"),
    );

    return label.closest("div.grid > div") as HTMLElement;
  }

  test.each(SUPPORTED_DASHBOARD_LANGUAGE_CODES)(
    "%s says All, never the Match Condition's Any",
    async (code: string) => {
      await inLanguage(code);
      render(
        <TraceRecordingRuleSourceEditor
          source={OPEN_SPAN_FILTER}
          canDelete={false}
          onChange={() => {}}
          onDelete={() => {}}
        />,
      );

      const field: HTMLElement = spanKindField();

      expect(field).toBeTruthy();
      expect(within(field).getByText(drawn(code, "All"))).toBeInTheDocument();
      expect(within(field).queryByText(drawn(code, "Any"))).toBeNull();
    },
  );
});
