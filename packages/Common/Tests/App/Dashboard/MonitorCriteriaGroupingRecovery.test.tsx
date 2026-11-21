import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { FunctionComponent, ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";

import MonitorCriteriaInstanceElement from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorCriteriaInstance";
import {
  getGroupingRecovery,
  GroupingRecovery,
  GroupingRecoveryCriteria,
  withAlertsResolvingOnTheirOwn,
  withIncidentsResolvingOnTheirOwn,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/GroupingRecovery";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { CriteriaAlert } from "../../../Types/Monitor/CriteriaAlert";
import { CheckOn, FilterType } from "../../../Types/Monitor/CriteriaFilter";
import { CriteriaIncident } from "../../../Types/Monitor/CriteriaIncident";
import IncidentGroupingConfig from "../../../Types/Monitor/IncomingMonitor/IncidentGroupingConfig";
import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

/*
 * What a grouped Incoming Request criteria's form says a recovery resolves
 * (issue #10550).
 *
 * A customer grouped a monitor's alerts by SolarWinds Orion's AlertActiveID
 * and named the field and value Orion's reset carries. The grouping settings
 * said "Resolves an incident when requestBody.status equals resolved". But
 * the criteria raised alerts, and the alert the Dashboard adds to a criteria
 * starts with Auto Resolve Alert off, folded under More fields - and a
 * recovery resolves only an incident or alert set to resolve on its own. So
 * every reset left its alert open, and nothing on the page said why.
 *
 * Now the grouping settings say what a recovery resolves - an incident, an
 * alert or both - only of what does resolve, and name what it leaves open,
 * with a button that turns the switch on (GroupingRecovery).
 */

const INCIDENT_SEVERITY_ID: ObjectID = new ObjectID(
  "10550000-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const ALERT_SEVERITY_ID: ObjectID = new ObjectID(
  "10550000-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);

const INCIDENT_SEVERITY_OPTIONS: Array<DropdownOption> = [
  { value: INCIDENT_SEVERITY_ID.toString(), label: "Critical" },
];
const ALERT_SEVERITY_OPTIONS: Array<DropdownOption> = [
  { value: ALERT_SEVERITY_ID.toString(), label: "High" },
];

// The customer's grouping, from the issue's first screenshot.
const ORION_GROUPING: IncidentGroupingConfig = {
  groupByJSONPath: "requestBody.alertActiveID",
  resolvedWhenJSONPath: "requestBody.status",
  resolvedWhenValue: "resolved",
};

const RESOLVES_INCIDENT: string =
  "Resolves an incident when requestBody.status equals resolved.";
const RESOLVES_ALERT: string =
  "Resolves an alert when requestBody.status equals resolved.";
const RESOLVES_BOTH: string =
  "Resolves an incident and an alert when requestBody.status equals resolved.";

const INCIDENTS_LEFT_OPEN: string =
  "A recovery leaves this criteria's incidents open until Auto Resolve Incident is on.";
const ALERTS_LEFT_OPEN: string =
  "A recovery leaves this criteria's alerts open until Auto Resolve Alert is on.";

const TURN_ON_INCIDENT: string = "Turn On Auto Resolve Incident";
const TURN_ON_ALERT: string = "Turn On Auto Resolve Alert";

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

/*
 * An alert row as the Dashboard adds it - Create an alert seeds it without
 * Auto Resolve Alert - with its title and severity filled in.
 */
function addedAlert(autoResolveAlert?: boolean | undefined): CriteriaAlert {
  return {
    id: ObjectID.generate().toString(),
    title: "{{requestBody.AlertName}}",
    description: "{{requestBody.Message}}",
    alertSeverityId: ALERT_SEVERITY_ID,
    ...(autoResolveAlert !== undefined ? { autoResolveAlert } : {}),
  };
}

function addedIncident(
  autoResolveIncident?: boolean | undefined,
): CriteriaIncident {
  return {
    id: ObjectID.generate().toString(),
    title: "{{requestBody.AlertName}}",
    description: "{{requestBody.Message}}",
    incidentSeverityId: INCIDENT_SEVERITY_ID,
    ...(autoResolveIncident !== undefined ? { autoResolveIncident } : {}),
  };
}

function buildCriteria(
  options: {
    grouping?: IncidentGroupingConfig | undefined;
    incidents?: Array<CriteriaIncident> | undefined;
    alerts?: Array<CriteriaAlert> | undefined;
    createIncidents?: boolean | undefined;
    createAlerts?: boolean | undefined;
  } = {},
): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  instance.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: undefined,
    filterCondition: FilterCondition.All,
    filters: [
      {
        checkOn: CheckOn.RequestBody,
        filterType: FilterType.Contains,
        value: "AlertName",
      },
    ],
    incidents: options.incidents || [],
    alerts: options.alerts || [],
    changeMonitorStatus: false,
    createIncidents:
      options.createIncidents ?? Boolean(options.incidents?.length),
    createAlerts: options.createAlerts ?? Boolean(options.alerts?.length),
    isEnabled: true,
    name: "SolarWinds Orion alert",
    description: "",
    incidentGrouping: options.grouping || ORION_GROUPING,
  };

  return instance;
}

interface Harness {
  // The criteria as the form last handed it up: what would be saved.
  latest: () => MonitorCriteriaInstance;
}

function renderForm(
  initial: MonitorCriteriaInstance,
  monitorType: MonitorType = MonitorType.IncomingRequest,
): Harness {
  let latest: MonitorCriteriaInstance = initial;

  const Wrapper: FunctionComponent = (): ReactElement => {
    const [value, setValue] = React.useState<MonitorCriteriaInstance>(initial);

    return (
      <MonitorCriteriaInstanceElement
        monitorType={monitorType}
        monitorStep={new MonitorStep()}
        monitorStatusDropdownOptions={[]}
        incidentSeverityDropdownOptions={INCIDENT_SEVERITY_OPTIONS}
        alertSeverityDropdownOptions={ALERT_SEVERITY_OPTIONS}
        onCallPolicyDropdownOptions={[]}
        labelDropdownOptions={[]}
        userDropdownOptions={[]}
        value={value}
        onChange={(changed: MonitorCriteriaInstance) => {
          // What MonitorCriteria.tsx does with every change.
          const rebuilt: MonitorCriteria = MonitorCriteria.fromJSON({
            _type: "MonitorCriteria",
            value: { monitorCriteriaInstanceArray: [changed] },
          } as never);

          latest = rebuilt.data!.monitorCriteriaInstanceArray[0]!;
          setValue(latest);
        }}
      />
    );
  };

  render(
    <MemoryRouter>
      <Wrapper />
    </MemoryRouter>,
  );

  return {
    latest: (): MonitorCriteriaInstance => {
      return latest;
    },
  };
}

function recoveryText(): string {
  return (
    screen.queryByTestId("monitor-criteria-grouping-recovery")?.textContent ||
    ""
  );
}

afterEach(() => {
  cleanup();
});

describe("getGroupingRecovery", () => {
  function recovery(criteria: GroupingRecoveryCriteria): GroupingRecovery {
    return getGroupingRecovery(criteria);
  }

  const NOTHING: GroupingRecovery = {
    isNamed: false,
    resolvesIncidents: false,
    resolvesAlerts: false,
    leavesIncidentsOpen: false,
    leavesAlertsOpen: false,
  };

  test("the customer's criteria: its alert, added without Auto Resolve Alert, is left open", () => {
    expect(
      recovery({
        incidentGrouping: ORION_GROUPING,
        createAlerts: true,
        alerts: [addedAlert()],
        incidents: [],
      }),
    ).toEqual({ ...NOTHING, isNamed: true, leavesAlertsOpen: true });
  });

  test("with Auto Resolve Alert on, its alert resolves", () => {
    expect(
      recovery({
        incidentGrouping: ORION_GROUPING,
        createAlerts: true,
        alerts: [addedAlert(true)],
        incidents: [],
      }),
    ).toEqual({ ...NOTHING, isNamed: true, resolvesAlerts: true });
  });

  test("an alert turned off by hand is left open as one never turned on", () => {
    expect(
      recovery({
        incidentGrouping: ORION_GROUPING,
        createAlerts: true,
        alerts: [addedAlert(false)],
        incidents: [],
      }).leavesAlertsOpen,
    ).toBe(true);
  });

  test("each kind is read on its own: an incident that resolves beside an alert that does not", () => {
    expect(
      recovery({
        incidentGrouping: ORION_GROUPING,
        createIncidents: true,
        incidents: [addedIncident(true)],
        createAlerts: true,
        alerts: [addedAlert()],
      }),
    ).toEqual({
      ...NOTHING,
      isNamed: true,
      resolvesIncidents: true,
      leavesAlertsOpen: true,
    });
  });

  test("one template of a kind that does not resolve leaves that kind open", () => {
    expect(
      recovery({
        incidentGrouping: ORION_GROUPING,
        createIncidents: true,
        incidents: [addedIncident(true), addedIncident()],
        alerts: [],
      }),
    ).toEqual({ ...NOTHING, isNamed: true, leavesIncidentsOpen: true });
  });

  test("what the criteria does not open is neither resolved nor left open", () => {
    expect(
      recovery({
        incidentGrouping: ORION_GROUPING,
        // Rows kept while the switch is off: nothing opens from them.
        createIncidents: false,
        incidents: [addedIncident()],
        createAlerts: false,
        alerts: [addedAlert()],
      }),
    ).toEqual({ ...NOTHING, isNamed: true });
  });

  test.each([
    ["no grouping", undefined],
    [
      "no recovery field",
      { groupByJSONPath: "requestBody.alertActiveID", resolvedWhenValue: "x" },
    ],
    [
      "no recovery value",
      {
        groupByJSONPath: "requestBody.alertActiveID",
        resolvedWhenJSONPath: "requestBody.status",
      },
    ],
    [
      "a blank recovery field",
      {
        groupByJSONPath: "requestBody.alertActiveID",
        resolvedWhenJSONPath: "   ",
        resolvedWhenValue: "resolved",
      },
    ],
    [
      "no field to group by",
      {
        groupByJSONPath: "",
        resolvedWhenJSONPath: "requestBody.status",
        resolvedWhenValue: "resolved",
      },
    ],
  ])(
    "with %s, nothing can report recovered",
    (_name: string, grouping: unknown) => {
      expect(
        recovery({
          incidentGrouping: grouping as IncidentGroupingConfig | undefined,
          createAlerts: true,
          alerts: [addedAlert()],
          createIncidents: true,
          incidents: [addedIncident()],
        }),
      ).toEqual(NOTHING);
    },
  );

  test("a criteria with nothing at all says nothing", () => {
    expect(getGroupingRecovery(undefined)).toEqual(NOTHING);
  });

  test("turning a kind's switch on sets every row of it, and leaves the rows given as they were", () => {
    const alerts: Array<CriteriaAlert> = [addedAlert(), addedAlert(false)];
    const incidents: Array<CriteriaIncident> = [addedIncident()];

    const alertsOn: Array<CriteriaAlert> =
      withAlertsResolvingOnTheirOwn(alerts);
    const incidentsOn: Array<CriteriaIncident> =
      withIncidentsResolvingOnTheirOwn(incidents);

    expect(
      alertsOn.map((alert: CriteriaAlert) => {
        return alert.autoResolveAlert;
      }),
    ).toEqual([true, true]);
    expect(incidentsOn[0]!.autoResolveIncident).toBe(true);
    // Everything else about each row is as it was.
    expect({ ...alertsOn[0], autoResolveAlert: undefined }).toEqual({
      ...alerts[0],
      autoResolveAlert: undefined,
    });
    expect(alerts[0]!.autoResolveAlert).toBeUndefined();
    expect(alerts[1]!.autoResolveAlert).toBe(false);
    expect(incidents[0]!.autoResolveIncident).toBeUndefined();
  });
});

describe("The grouping settings of an Incoming Request criteria", () => {
  test("the customer's criteria: it names the alerts a recovery leaves open, and promises nothing", () => {
    renderForm(buildCriteria({ alerts: [addedAlert()] }));

    expect(screen.getByText(ALERTS_LEFT_OPEN)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: TURN_ON_ALERT }),
    ).toBeInTheDocument();

    // What it used to say, of an incident the criteria never opens.
    expect(recoveryText()).not.toContain("Resolves an");
    expect(
      screen.queryByTestId("monitor-criteria-grouping-incidents-left-open"),
    ).not.toBeInTheDocument();
  });

  test("Turn On Auto Resolve Alert turns the alert's switch on, and the settings then say the alert resolves", () => {
    const harness: Harness = renderForm(
      buildCriteria({ alerts: [addedAlert()] }),
    );

    fireEvent.click(screen.getByRole("button", { name: TURN_ON_ALERT }));

    expect(harness.latest().data!.alerts[0]!.autoResolveAlert).toBe(true);
    expect(recoveryText()).toBe(RESOLVES_ALERT);
    expect(screen.queryByText(ALERTS_LEFT_OPEN)).not.toBeInTheDocument();

    // The alert's own form shows it on, under its More fields.
    expect(
      screen.getByRole("checkbox", { name: "Auto Resolve Alert" }),
    ).toBeChecked();
  });

  test("it changes nothing else the alert or the criteria holds", () => {
    const alert: CriteriaAlert = addedAlert();
    const harness: Harness = renderForm(buildCriteria({ alerts: [alert] }));

    fireEvent.click(screen.getByRole("button", { name: TURN_ON_ALERT }));

    const saved: MonitorCriteriaInstance = harness.latest();

    expect(saved.data!.alerts).toHaveLength(1);
    expect(saved.data!.alerts[0]!.id).toBe(alert.id);
    expect(saved.data!.alerts[0]!.title).toBe(alert.title);
    expect(saved.data!.alerts[0]!.description).toBe(alert.description);
    expect(saved.data!.alerts[0]!.alertSeverityId?.toString()).toBe(
      ALERT_SEVERITY_ID.toString(),
    );
    expect(saved.data!.incidentGrouping).toEqual(ORION_GROUPING);
    expect(saved.data!.createAlerts).toBe(true);
    expect(saved.data!.incidents).toEqual([]);
  });

  test("turning the switch on in the alert's own form says the same", () => {
    renderForm(buildCriteria({ alerts: [addedAlert()] }));

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Auto Resolve Alert" }),
    );

    expect(recoveryText()).toBe(RESOLVES_ALERT);
    expect(
      screen.queryByRole("button", { name: TURN_ON_ALERT }),
    ).not.toBeInTheDocument();
  });

  test("and turning it off there names the break again", () => {
    renderForm(buildCriteria({ alerts: [addedAlert(true)] }));

    expect(recoveryText()).toBe(RESOLVES_ALERT);

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Auto Resolve Alert" }),
    );

    expect(screen.getByText(ALERTS_LEFT_OPEN)).toBeInTheDocument();
  });

  test("an incident left open is named, and Turn On Auto Resolve Incident turns it on", () => {
    const harness: Harness = renderForm(
      buildCriteria({ incidents: [addedIncident()] }),
    );

    expect(screen.getByText(INCIDENTS_LEFT_OPEN)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: TURN_ON_INCIDENT }));

    expect(harness.latest().data!.incidents[0]!.autoResolveIncident).toBe(true);
    expect(recoveryText()).toBe(RESOLVES_INCIDENT);
    expect(
      screen.getByRole("checkbox", { name: "Auto Resolve Incident" }),
    ).toBeChecked();
  });

  test("an incident that resolves reads as it always has", () => {
    renderForm(buildCriteria({ incidents: [addedIncident(true)] }));

    expect(recoveryText()).toBe(RESOLVES_INCIDENT);
  });

  test("an incident and an alert that both resolve are both named", () => {
    renderForm(
      buildCriteria({
        incidents: [addedIncident(true)],
        alerts: [addedAlert(true)],
      }),
    );

    expect(recoveryText()).toBe(RESOLVES_BOTH);
  });

  test("an incident that resolves beside an alert that does not: one line for each", () => {
    renderForm(
      buildCriteria({
        incidents: [addedIncident(true)],
        alerts: [addedAlert()],
      }),
    );

    // The line is drawn around its values as code: read it whole.
    expect(recoveryText()).toBe(
      `${RESOLVES_INCIDENT}${ALERTS_LEFT_OPEN}${TURN_ON_ALERT}`,
    );
    expect(screen.queryByText(INCIDENTS_LEFT_OPEN)).not.toBeInTheDocument();
  });

  test("both left open: each named, each with its own button", () => {
    renderForm(
      buildCriteria({
        incidents: [addedIncident()],
        alerts: [addedAlert()],
      }),
    );

    expect(screen.getByText(INCIDENTS_LEFT_OPEN)).toBeInTheDocument();
    expect(screen.getByText(ALERTS_LEFT_OPEN)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: TURN_ON_INCIDENT }));

    // The other one is still named.
    expect(screen.getByText(ALERTS_LEFT_OPEN)).toBeInTheDocument();
    expect(recoveryText()).toContain(RESOLVES_INCIDENT);

    fireEvent.click(screen.getByRole("button", { name: TURN_ON_ALERT }));

    expect(recoveryText()).toBe(RESOLVES_BOTH);
  });

  test("Create an alert, turned on after the recovery is named, seeds the alert the settings then name", () => {
    renderForm(buildCriteria());

    expect(recoveryText()).toBe("");

    fireEvent.click(
      screen.getByRole("switch", {
        name: /^When filters match, create an alert/,
      }),
    );

    expect(screen.getByText(ALERTS_LEFT_OPEN)).toBeInTheDocument();
  });

  test("with no recovery field and value, it says nothing of a recovery", () => {
    renderForm(
      buildCriteria({
        grouping: { groupByJSONPath: "requestBody.alertActiveID" },
        alerts: [addedAlert()],
      }),
    );

    expect(
      screen.queryByTestId("monitor-criteria-grouping-recovery"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(ALERTS_LEFT_OPEN)).not.toBeInTheDocument();
  });

  test("a criteria that opens nothing promises nothing", () => {
    renderForm(buildCriteria());

    expect(recoveryText()).toBe("");
    expect(screen.queryByText(/^Resolves an/)).not.toBeInTheDocument();
  });

  test("on another monitor type there are no grouping settings to say it in", () => {
    renderForm(buildCriteria({ alerts: [addedAlert()] }), MonitorType.API);

    expect(
      screen.queryByTestId("monitor-criteria-grouping-recovery"),
    ).not.toBeInTheDocument();
  });
});

describe("In every language the Dashboard ships", () => {
  const SENTENCES: Array<string> = [
    "Resolves an incident when {{field}} equals {{value}}.",
    "Resolves an alert when {{field}} equals {{value}}.",
    "Resolves an incident and an alert when {{field}} equals {{value}}.",
    INCIDENTS_LEFT_OPEN,
    ALERTS_LEFT_OPEN,
    TURN_ON_INCIDENT,
    TURN_ON_ALERT,
  ];

  function readLocale(code: string): Record<string, string> {
    return JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
    ) as Record<string, string>;
  }

  test.each(SENTENCES)("%s is in en.json", (english: string) => {
    expect(readLocale("en")[english]).toBe(english);
  });

  test.each(
    DASHBOARD_LANGUAGES.flatMap((code: string) => {
      return SENTENCES.map((english: string): [string, string] => {
        return [code, english];
      });
    }),
  )("%s words %s", (code: string, english: string) => {
    const worded: string | undefined = readLocale(code)[english];

    expect(worded).toBeTruthy();
    expect(worded).not.toBe(english);

    // Every value the sentence carries is kept.
    for (const placeholder of english.match(/{{[a-z]+}}/g) || []) {
      expect(worded).toContain(placeholder);
    }
  });

  describe("drawn in German", () => {
    const german: i18n = createInstance();

    beforeAll(async () => {
      await german.init({
        lng: "de",
        fallbackLng: "de",
        resources: {
          de: { translation: readLocale("de") },
        },
        interpolation: { escapeValue: false },
      });
    });

    test("the left-open line and its button read in German", () => {
      render(
        <I18nextProvider i18n={german}>
          <MemoryRouter>
            <MonitorCriteriaInstanceElement
              monitorType={MonitorType.IncomingRequest}
              monitorStep={new MonitorStep()}
              monitorStatusDropdownOptions={[]}
              incidentSeverityDropdownOptions={INCIDENT_SEVERITY_OPTIONS}
              alertSeverityDropdownOptions={ALERT_SEVERITY_OPTIONS}
              onCallPolicyDropdownOptions={[]}
              labelDropdownOptions={[]}
              userDropdownOptions={[]}
              value={buildCriteria({ alerts: [addedAlert()] })}
            />
          </MemoryRouter>
        </I18nextProvider>,
      );

      expect(screen.getByText(german.t(ALERTS_LEFT_OPEN))).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: german.t(TURN_ON_ALERT) }),
      ).toBeInTheDocument();
    });
  });
});
