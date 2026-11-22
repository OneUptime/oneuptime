import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE MONITOR CRITERIA FORM AND ITS READ-ONLY VIEW, ON A SPANISH PAGE
 * (#7780, #7782).
 *
 * A monitor's criteria name records the project made: the labels an
 * incident or an alert gets, its severity, the status the monitor changes
 * to. The form's pickers are built from those records
 * (DropdownUtil.getDropdownOptionsFromEntityArray, as Form/Monitor/
 * MonitorSteps builds them), and the read-only view draws them as badges.
 * Both looked every name up, so on a Spanish page a label named "Network"
 * read "Red" in the labels picker and on the criteria's summary, and a
 * monitor status the project named "Open" read the verb "Abrir".
 *
 * Here are the real form and the real view, with the Dashboard's Spanish:
 * the project's names read as written, OneUptime's default names - an
 * incident's "Critical Incident", an alert's "High", a monitor's
 * "Operational" - in Spanish, and each severity by its own list (an
 * incident severity a project named "High" is its own, an alert's "High"
 * OneUptime's).
 */

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});

import MonitorCriteriaAlertForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorCriteriaAlertForm";
import MonitorCriteriaIncidentForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorCriteriaIncidentForm";
import MonitorCriteriaInstanceView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorSteps/MonitorCriteriaInstance";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../../Models/DatabaseModels/Label";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import Color from "../../../Types/Color";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { CriteriaAlert } from "../../../Types/Monitor/CriteriaAlert";
import { CriteriaIncident } from "../../../Types/Monitor/CriteriaIncident";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import ObjectID from "../../../Types/ObjectID";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import DropdownUtil from "../../../UI/Utils/Dropdown";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";

const SPANISH: Record<string, string> = readDashboardLocale("es");
const GREEN: Color = new Color("#10b981");

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";

// The project's records, each under an id of its own.
const ID: Record<string, string> = {
  criticalIncident: "00000001-0000-4000-8000-000000000001",
  incidentHigh: "00000001-0000-4000-8000-000000000002",
  alertHigh: "00000002-0000-4000-8000-000000000001",
  alertNetwork: "00000002-0000-4000-8000-000000000002",
  network: "00000003-0000-4000-8000-000000000001",
  checkout: "00000003-0000-4000-8000-000000000002",
  database: "00000003-0000-4000-8000-000000000003",
  operational: "00000004-0000-4000-8000-000000000001",
  open: "00000004-0000-4000-8000-000000000002",
};

let spanishInstance: i18n | null = null;

// The Dashboard's Spanish, English behind it, as it ships.
function spanishI18n(): i18n {
  if (spanishInstance) {
    return spanishInstance;
  }

  const instance: i18n = createInstance();

  instance.init({
    lng: "es",
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      es: { translation: SPANISH },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
    initImmediate: false,
  });

  spanishInstance = instance;

  return instance;
}

function renderInSpanish(element: ReactElement): void {
  render(<I18nextProvider i18n={spanishI18n()}>{element}</I18nextProvider>);
}

function named<T extends BaseModel>(
  modelType: { new (): T },
  id: string,
  name: string,
): T {
  const row: T = new modelType();
  row._id = id;
  row.setColumnValue("name", name);
  row.setColumnValue("color", GREEN);
  return row;
}

// The project's records, as Form/Monitor/MonitorSteps fetches them.
function incidentSeverities(): Array<IncidentSeverity> {
  return [
    named(IncidentSeverity, ID["criticalIncident"]!, "Critical Incident"),
    named(IncidentSeverity, ID["incidentHigh"]!, "High"),
  ];
}

function alertSeverities(): Array<AlertSeverity> {
  return [
    named(AlertSeverity, ID["alertHigh"]!, "High"),
    named(AlertSeverity, ID["alertNetwork"]!, "Network"),
  ];
}

function labels(): Array<Label> {
  return [
    named(Label, ID["network"]!, "Network"),
    named(Label, ID["checkout"]!, "Checkout"),
    named(Label, ID["database"]!, "Database"),
  ];
}

function monitorStatuses(): Array<MonitorStatus> {
  return [
    named(MonitorStatus, ID["operational"]!, "Operational"),
    named(MonitorStatus, ID["open"]!, "Open"),
  ];
}

// The options the form's pickers are given: as MonitorSteps builds them.
function optionsOf(rows: Array<BaseModel>): Array<DropdownOption> {
  return DropdownUtil.getDropdownOptionsFromEntityArray({
    array: rows,
    labelField: "name",
    valueField: "_id",
  });
}

/*
 * The words of each value a picker shows as picked, in the page's order:
 * a severity's picker (Dropdown), and the labels' (searched on the server,
 * #10646: an EntityDropdown's chips).
 */
function pickedValues(): Array<string> {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      '[data-testid="dropdown-value-label"], [data-testid="entity-dropdown-chip-label"]',
    ),
  ).map((value: HTMLElement): string => {
    return (value.textContent || "").trim();
  });
}

/*
 * Opens a picker that searches the server - the labels' - and reads what
 * it lists: the project's labels, as the search answers them, but the ones
 * picked already.
 */
async function listingOfSearchedPicker(testId: string): Promise<Array<string>> {
  getListMock.mockImplementation(async (): Promise<any> => {
    return { data: labels(), count: 3, skip: 0, limit: 50 };
  });

  await act(async (): Promise<void> => {
    fireEvent.focus(screen.getByTestId(testId));
  });

  const menu: HTMLElement = await screen.findByTestId("entity-dropdown-menu");

  await within(menu).findAllByRole("option");

  return within(menu)
    .getAllByRole("option")
    .map((option: HTMLElement): string => {
      return (option.textContent || "").trim();
    });
}

// Opens the picker that shows `picked` as picked, and reads what it lists.
async function listingOfPickerShowing(picked: string): Promise<Array<string>> {
  const value: HTMLElement | undefined = screen
    .getAllByTestId("dropdown-value-label")
    .find((element: HTMLElement): boolean => {
      return (element.textContent || "").trim() === picked;
    });

  expect(value).toBeDefined();

  const input: HTMLInputElement | null =
    value!
      .closest<HTMLElement>(".ou-select__control")
      ?.querySelector("input") || null;

  expect(input).not.toBeNull();

  await act(async (): Promise<void> => {
    fireEvent.keyDown(input!, { key: "ArrowDown", code: "ArrowDown" });
  });

  const menu: HTMLElement = screen.getByRole("listbox");

  return within(menu)
    .getAllByRole("option")
    .map((option: HTMLElement): string => {
      return (option.textContent || "").trim();
    });
}

// The words of every pill on the page, in order.
function pillTexts(): Array<string> {
  return screen
    .queryAllByTestId("pill-text")
    .map((pill: HTMLElement): string => {
      return pill.textContent || "";
    });
}

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState({}, "", `/dashboard/${PROJECT_ID}/monitors`);
  getListMock.mockImplementation(async (): Promise<any> => {
    return { data: [], count: 0, skip: 0, limit: 0 };
  });
});

afterEach(() => {
  cleanup();
});

describe("the words the cases below lean on", () => {
  test("Spanish has words of its own for each name drawn here", () => {
    expect({
      Network: SPANISH["Network"],
      Open: SPANISH["Open"],
      Database: SPANISH["Database"],
      High: SPANISH["High"],
      Operational: SPANISH["Operational"],
      "Critical Incident": SPANISH["Critical Incident"],
    }).toEqual({
      Network: "Red",
      Open: "Abrir",
      Database: "Base de datos",
      High: "Alta",
      Operational: "Operativo",
      "Critical Incident": "Incidente crítico",
    });
  });
});

describe("the form, a rule's incident", () => {
  function renderIncidentForm(): void {
    renderInSpanish(
      <MonitorCriteriaIncidentForm
        initialValue={{
          id: "incident-1",
          title: "Storefront is offline",
          description: "",
          incidentSeverityId: new ObjectID(ID["criticalIncident"]!),
          labelIds: [new ObjectID(ID["database"]!)],
        }}
        incidentSeverityDropdownOptions={optionsOf(incidentSeverities())}
        onCallPolicyDropdownOptions={[]}
        labelDropdownOptions={optionsOf(labels())}
        userDropdownOptions={[]}
        onChange={(_value: CriteriaIncident) => {}}
      />,
    );
  }

  test("shows its picked severity, OneUptime's Critical Incident, in Spanish, and its picked label Database as written", () => {
    renderIncidentForm();

    expect(pickedValues()).toEqual(["Incidente crítico", "Database"]);
    expect(screen.queryByText("Base de datos")).not.toBeInTheDocument();
  });

  test("offers the severities by their own list: Critical Incident in Spanish, a severity the project named High as written", async () => {
    renderIncidentForm();

    expect(await listingOfPickerShowing("Incidente crítico")).toEqual([
      "Incidente crítico",
      "High",
    ]);
  });

  test("offers the labels as their project named them: Network, never Red", async () => {
    renderIncidentForm();

    expect(
      await listingOfSearchedPicker("monitor-criteria-incident-labelIds"),
    ).toEqual(["Network", "Checkout"]);
    expect(screen.queryByText("Red")).not.toBeInTheDocument();
  });
});

describe("the form, a rule's alert", () => {
  function renderAlertForm(): void {
    renderInSpanish(
      <MonitorCriteriaAlertForm
        initialValue={{
          id: "alert-1",
          title: "Storefront is offline",
          description: "",
          alertSeverityId: new ObjectID(ID["alertHigh"]!),
          labelIds: [new ObjectID(ID["database"]!)],
        }}
        alertSeverityDropdownOptions={optionsOf(alertSeverities())}
        onCallPolicyDropdownOptions={[]}
        labelDropdownOptions={optionsOf(labels())}
        onChange={(_value: CriteriaAlert) => {}}
      />,
    );
  }

  test("shows its picked severity, OneUptime's High, in Spanish", () => {
    renderAlertForm();

    expect(pickedValues()).toEqual(["Alta", "Database"]);
  });

  test("offers High in Spanish and a severity the project named Network as written", async () => {
    renderAlertForm();

    expect(await listingOfPickerShowing("Alta")).toEqual(["Alta", "Network"]);
  });

  test("offers the labels as their project named them", async () => {
    renderAlertForm();

    expect(
      await listingOfSearchedPicker("monitor-criteria-alert-labelIds"),
    ).toEqual(["Network", "Checkout"]);
  });
});

describe("the criteria's read-only view", () => {
  function criteria(data: {
    monitorStatusId: string;
    incident?: Partial<CriteriaIncident> | undefined;
    alert?: Partial<CriteriaAlert> | undefined;
  }): MonitorCriteriaInstance {
    const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();

    instance.data = {
      id: "criteria-1",
      monitorStatusId: new ObjectID(data.monitorStatusId),
      filterCondition: FilterCondition.All,
      filters: [],
      incidents: data.incident
        ? [
            {
              id: "incident-1",
              title: "Storefront is offline",
              description: "",
              incidentSeverityId: undefined,
              ...data.incident,
            },
          ]
        : [],
      alerts: data.alert
        ? [
            {
              id: "alert-1",
              title: "Storefront is offline",
              description: "",
              alertSeverityId: undefined,
              ...data.alert,
            },
          ]
        : [],
      changeMonitorStatus: true,
      createIncidents: Boolean(data.incident),
      createAlerts: Boolean(data.alert),
      isEnabled: true,
      name: "Offline",
      description: "",
    };

    return instance;
  }

  function renderView(instance: MonitorCriteriaInstance): void {
    renderInSpanish(
      <MonitorCriteriaInstanceView
        monitorStatusOptions={monitorStatuses()}
        incidentSeverityOptions={incidentSeverities()}
        alertSeverityOptions={alertSeverities()}
        isLastCriteria={true}
        monitorCriteriaInstance={instance}
        onCallPolicyOptions={[]}
        labelOptions={labels()}
        teamOptions={[]}
        userOptions={[]}
        incidentRoleOptions={[]}
      />,
    );
  }

  function statusBubble(): string {
    return (screen.getByRole("status").textContent || "").trim();
  }

  test("names the default status Operational in Spanish", () => {
    renderView(criteria({ monitorStatusId: ID["operational"]! }));

    expect(statusBubble()).toBe("Operativo");
  });

  test("names a status the project named Open as written, never Abrir", () => {
    renderView(criteria({ monitorStatusId: ID["open"]! }));

    expect(statusBubble()).toBe("Open");
    expect(screen.queryByText("Abrir")).not.toBeInTheDocument();
  });

  test("an incident's default severity reads in Spanish, its label as written", () => {
    renderView(
      criteria({
        monitorStatusId: ID["operational"]!,
        incident: {
          incidentSeverityId: new ObjectID(ID["criticalIncident"]!),
          labelIds: [new ObjectID(ID["network"]!)],
        },
      }),
    );

    expect(pillTexts()).toEqual(["Incidente crítico", "Network"]);
  });

  test("an incident's severity the project named High is its own: High, never Alta", () => {
    renderView(
      criteria({
        monitorStatusId: ID["operational"]!,
        incident: { incidentSeverityId: new ObjectID(ID["incidentHigh"]!) },
      }),
    );

    expect(pillTexts()).toEqual(["High"]);
  });

  test("an alert's default severity High reads Alta, its label as written", () => {
    renderView(
      criteria({
        monitorStatusId: ID["operational"]!,
        alert: {
          alertSeverityId: new ObjectID(ID["alertHigh"]!),
          labelIds: [new ObjectID(ID["database"]!)],
        },
      }),
    );

    expect(pillTexts()).toEqual(["Alta", "Database"]);
  });

  test("an alert's severity the project named Network reads Network, never Red", () => {
    renderView(
      criteria({
        monitorStatusId: ID["operational"]!,
        alert: { alertSeverityId: new ObjectID(ID["alertNetwork"]!) },
      }),
    );

    expect(pillTexts()).toEqual(["Network"]);
  });
});
