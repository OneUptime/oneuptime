import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, test } from "@jest/globals";

import MonitorCriteriaInstanceElement from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorCriteriaInstance";
import MonitorCriteriaInstanceView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorSteps/MonitorCriteriaInstance";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../Types/JSON";
import { CheckOn, FilterType } from "../../../Types/Monitor/CriteriaFilter";
import { OPEN_FOR_EVERY_EMAIL_DOCS_PATH } from "../../../Types/Monitor/IncomingEmailMonitor/OpenForEveryEmail";
import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import { DOCS_URL } from "../../../UI/Config";

/*
 * The switch an Incoming Email monitor's criteria offers so that every email
 * that matches opens an incident (and alert) of its own, and what the
 * criteria's read-only view says of it.
 *
 * The customer this is for raises incidents by emailing the monitor's
 * address, and found that while one incident was open the next emails
 * opened nothing. The switch sits with the criteria's actions, under the
 * incident and alert it applies to, and only where it means something.
 */

const SEVERITY_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const ALERT_SEVERITY_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const SEVERITY_OPTIONS: Array<DropdownOption> = [
  { value: SEVERITY_ID.toString(), label: "Critical" },
];
const ALERT_SEVERITY_OPTIONS: Array<DropdownOption> = [
  { value: ALERT_SEVERITY_ID.toString(), label: "High" },
];

const INCIDENT_SWITCH: RegExp = /^When filters match, declare an incident/;
const ALERT_SWITCH: RegExp = /^When filters match, create an alert/;

const EVERY_EMAIL_INCIDENT: string = "Open a new incident for every email";
const EVERY_EMAIL_ALERT: string = "Open a new alert for every email";
const EVERY_EMAIL_BOTH: string =
  "Open a new incident and alert for every email";

function buildCriteria(
  options: {
    createIncidents?: boolean | undefined;
    createAlerts?: boolean | undefined;
    openForEveryEmail?: boolean | undefined;
  } = {},
): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: undefined,
    filterCondition: FilterCondition.All,
    filters: [
      {
        checkOn: CheckOn.EmailFrom,
        filterType: FilterType.EndsWith,
        value: "@acme.example",
      },
    ],
    incidents: options.createIncidents
      ? [
          {
            id: ObjectID.generate().toString(),
            title: "{{emailSubject}}",
            description: "{{emailBody}}",
            incidentSeverityId: SEVERITY_ID,
          },
        ]
      : [],
    alerts: options.createAlerts
      ? [
          {
            id: ObjectID.generate().toString(),
            title: "{{emailSubject}}",
            description: "{{emailBody}}",
            alertSeverityId: ALERT_SEVERITY_ID,
          },
        ]
      : [],
    changeMonitorStatus: false,
    createIncidents: options.createIncidents ?? false,
    createAlerts: options.createAlerts ?? false,
    isEnabled: true,
    name: "Reported by email",
    description: "",
    ...(options.openForEveryEmail ? { openForEveryEmail: true } : {}),
  };
  return instance;
}

interface Harness {
  // The criteria as the form last handed it up: what would be saved.
  latest: () => MonitorCriteriaInstance;
}

function renderForm(
  initial: MonitorCriteriaInstance,
  monitorType: MonitorType = MonitorType.IncomingEmail,
): Harness {
  let latest: MonitorCriteriaInstance = initial;

  const Wrapper: FunctionComponent = (): ReactElement => {
    const [value, setValue] = React.useState<MonitorCriteriaInstance>(initial);

    return (
      <MonitorCriteriaInstanceElement
        monitorType={monitorType}
        monitorStep={new MonitorStep()}
        monitorStatusDropdownOptions={[]}
        incidentSeverityDropdownOptions={SEVERITY_OPTIONS}
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

function everyEmailSwitch(name: string): HTMLElement {
  return screen.getByRole("switch", { name: name });
}

function savedValue(harness: Harness): JSONObject {
  return harness.latest().toJSON()["value"] as JSONObject;
}

afterEach(() => {
  cleanup();
});

describe("The criteria form's switch", () => {
  test("an Incoming Email criteria that declares an incident offers it, off", () => {
    renderForm(buildCriteria({ createIncidents: true }));

    const toggle: HTMLElement = everyEmailSwitch(EVERY_EMAIL_INCIDENT);

    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByTestId("monitor-criteria-open-for-every-email"),
    ).toBeInTheDocument();
  });

  test("names what the criteria opens: an incident, an alert, or both", () => {
    renderForm(buildCriteria({ createAlerts: true }));
    expect(everyEmailSwitch(EVERY_EMAIL_ALERT)).toBeInTheDocument();
    cleanup();

    renderForm(buildCriteria({ createIncidents: true, createAlerts: true }));
    expect(everyEmailSwitch(EVERY_EMAIL_BOTH)).toBeInTheDocument();
  });

  test("turned on, the criteria is saved with it; turned off, as if it never was", () => {
    const harness: Harness = renderForm(
      buildCriteria({ createIncidents: true }),
    );
    const before: JSONObject = savedValue(harness);

    fireEvent.click(everyEmailSwitch(EVERY_EMAIL_INCIDENT));

    expect(harness.latest().data?.openForEveryEmail).toBe(true);
    expect(savedValue(harness)["openForEveryEmail"]).toBe(true);
    expect(everyEmailSwitch(EVERY_EMAIL_INCIDENT)).toHaveAttribute(
      "aria-checked",
      "true",
    );

    fireEvent.click(everyEmailSwitch(EVERY_EMAIL_INCIDENT));

    expect(harness.latest().data?.openForEveryEmail).toBeUndefined();
    expect(Object.keys(savedValue(harness))).not.toContain("openForEveryEmail");
    expect(savedValue(harness)).toEqual({
      ...before,
      id: savedValue(harness)["id"],
    });
  });

  test("a criteria saved with it on opens with it on", () => {
    renderForm(
      buildCriteria({ createIncidents: true, openForEveryEmail: true }),
    );

    expect(everyEmailSwitch(EVERY_EMAIL_INCIDENT)).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("it changes nothing else the criteria holds", () => {
    const harness: Harness = renderForm(
      buildCriteria({ createIncidents: true }),
    );
    const before: MonitorCriteriaInstance = harness.latest();

    fireEvent.click(everyEmailSwitch(EVERY_EMAIL_INCIDENT));

    const after: MonitorCriteriaInstance = harness.latest();

    expect(after.data?.createIncidents).toBe(true);
    expect(after.data?.incidents).toEqual(before.data?.incidents);
    expect(after.data?.filters).toEqual(before.data?.filters);
    expect(after.data?.name).toBe(before.data?.name);
  });

  test("goes away while the criteria opens nothing, keeping its value, and comes back with it", () => {
    const harness: Harness = renderForm(
      buildCriteria({ createIncidents: true, openForEveryEmail: true }),
    );

    fireEvent.click(screen.getByRole("switch", { name: INCIDENT_SWITCH }));

    expect(
      screen.queryByTestId("monitor-criteria-open-for-every-email"),
    ).not.toBeInTheDocument();
    expect(harness.latest().data?.openForEveryEmail).toBe(true);

    fireEvent.click(screen.getByRole("switch", { name: ALERT_SWITCH }));

    expect(everyEmailSwitch(EVERY_EMAIL_ALERT)).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("a criteria that opens nothing does not offer it", () => {
    renderForm(buildCriteria());

    expect(
      screen.queryByTestId("monitor-criteria-open-for-every-email"),
    ).not.toBeInTheDocument();
  });

  test.each([
    MonitorType.IncomingRequest,
    MonitorType.Website,
    MonitorType.API,
    MonitorType.Logs,
    MonitorType.Ping,
  ])(
    "a %s monitor's criteria does not offer it",
    (monitorType: MonitorType) => {
      renderForm(
        buildCriteria({ createIncidents: true, createAlerts: true }),
        monitorType,
      );

      expect(
        screen.queryByTestId("monitor-criteria-open-for-every-email"),
      ).not.toBeInTheDocument();
    },
  );

  test("says what happens either way, and links to the docs section", () => {
    renderForm(buildCriteria({ createIncidents: true }));

    const description: HTMLElement = screen.getByText(
      /Each email that matches opens its own/,
    );

    expect(description.textContent).toContain(
      "replies are added to it as notes",
    );
    expect(description.textContent).toContain(
      "When off, later emails open nothing new while one is open.",
    );

    const link: HTMLElement = screen.getByRole("link", {
      name: "How it works",
    });

    expect(link).toHaveAttribute(
      "href",
      `${DOCS_URL.toString()}${OPEN_FOR_EVERY_EMAIL_DOCS_PATH}`,
    );
    expect(link).toHaveAttribute("target", "_blank");
  });

  test("describes the switch to a screen reader with that sentence", () => {
    renderForm(buildCriteria({ createIncidents: true }));

    const toggle: HTMLElement = everyEmailSwitch(EVERY_EMAIL_INCIDENT);
    const describedBy: string | null = toggle.getAttribute("aria-describedby");

    expect(describedBy).toBeTruthy();
    expect(
      document.getElementById(describedBy!.split(" ")[0]!)?.textContent,
    ).toContain("Each email that matches opens its own");
  });
});

describe("The criteria's read-only view", () => {
  function renderView(
    criteria: MonitorCriteriaInstance,
    monitorType: MonitorType = MonitorType.IncomingEmail,
  ): void {
    render(
      <MemoryRouter>
        <MonitorCriteriaInstanceView
          monitorType={monitorType}
          monitorStatusOptions={[]}
          incidentSeverityOptions={[]}
          alertSeverityOptions={[]}
          isLastCriteria={true}
          monitorCriteriaInstance={criteria}
          onCallPolicyOptions={[]}
          labelOptions={[]}
          teamOptions={[]}
          userOptions={[]}
          incidentRoleOptions={[]}
        />
      </MemoryRouter>,
    );
  }

  function sentences(): string {
    return document.body.textContent || "";
  }

  test("says the incident and alert are opened for every email", () => {
    renderView(
      buildCriteria({
        createIncidents: true,
        createAlerts: true,
        openForEveryEmail: true,
      }),
    );

    expect(sentences()).toContain(
      "Create incident for every email that meets this criteria. These are the incident details:",
    );
    expect(sentences()).toContain(
      "Create alert for every email that meets this criteria. These are the alert details:",
    );
    expect(sentences()).not.toContain("when this criteria is met");
  });

  test("with the switch off it reads as it always has", () => {
    renderView(buildCriteria({ createIncidents: true, createAlerts: true }));

    expect(sentences()).toContain(
      "Create incident when this criteria is met. These are the incident details:",
    );
    expect(sentences()).toContain(
      "Create alert when this criteria is met. These are the alert details:",
    );
    expect(sentences()).not.toContain("for every email");
  });

  test("on another monitor type the switch means nothing, and the view says so", () => {
    renderView(
      buildCriteria({ createIncidents: true, openForEveryEmail: true }),
      MonitorType.IncomingRequest,
    );

    expect(sentences()).toContain("Create incident when this criteria is met.");
    expect(sentences()).not.toContain("for every email");
  });
});
