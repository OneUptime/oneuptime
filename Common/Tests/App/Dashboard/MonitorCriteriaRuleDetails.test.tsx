import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React, { ReactElement, useState } from "react";
import MonitorCriteriaInstanceElement from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorCriteriaInstance";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { CheckOn, FilterType } from "../../../Types/Monitor/CriteriaFilter";
import { CriteriaAlert } from "../../../Types/Monitor/CriteriaAlert";
import { CriteriaIncident } from "../../../Types/Monitor/CriteriaIncident";
import ObjectID from "../../../Types/ObjectID";
import IncidentGroupingConfig from "../../../Types/Monitor/IncomingMonitor/IncidentGroupingConfig";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";

const STATUS_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SEVERITY_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const TEAM_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const USER_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const USER_TWO_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const LABEL_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");
const POLICY_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const COMMANDER_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);
const RESPONDER_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);

type RuleData = NonNullable<MonitorCriteriaInstance["data"]>;

function buildRule(overrides: Partial<RuleData> = {}): MonitorCriteriaInstance {
  const rule: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  rule.data = {
    id: ObjectID.generate().toString(),
    name: "Website unavailable",
    description: "",
    filterCondition: FilterCondition.All,
    filters: [
      {
        checkOn: CheckOn.IsOnline,
        filterType: FilterType.False,
        value: undefined,
      },
    ],
    isEnabled: true,
    changeMonitorStatus: true,
    monitorStatusId: STATUS_ID,
    createIncidents: false,
    createAlerts: false,
    incidents: [],
    alerts: [],
    ...overrides,
  };
  return rule;
}

function savedAlert(): CriteriaAlert {
  return {
    id: ObjectID.generate().toString(),
    title: "{{monitorName}} is unavailable",
    description: "Saved **alert** context",
    alertSeverityId: SEVERITY_ID,
    ownerTeamIds: [TEAM_ID],
    ownerUserIds: [USER_ID],
    labelIds: [LABEL_ID],
    onCallPolicyIds: [POLICY_ID],
    autoResolveAlert: true,
    isPrivate: true,
    remediationNotes: "Restart only after investigation.",
  };
}

function savedIncident(): CriteriaIncident {
  return {
    id: ObjectID.generate().toString(),
    title: "{{monitorName}} is unavailable",
    ownerTeamIds: [TEAM_ID],
    ownerUserIds: [USER_ID],
    labelIds: [LABEL_ID],
    onCallPolicyIds: [POLICY_ID],
    isPrivate: true,
    remediationNotes: "Restart only after investigation.",
    incidentSeverityId: SEVERITY_ID,
    description: "Saved **incident** context",
    autoResolveIncident: true,
    showIncidentOnStatusPage: false,
    incidentMemberRoles: [
      { roleId: COMMANDER_ID, userId: USER_ID },
      { roleId: RESPONDER_ID, userId: USER_ID },
    ],
  };
}

interface Harness {
  latest: () => MonitorCriteriaInstance;
  onDelete: jest.Mock;
}

function renderRule(
  initial: MonitorCriteriaInstance = buildRule(),
  monitorType: MonitorType = MonitorType.Ping,
  monitorStep: MonitorStep = new MonitorStep(),
): Harness {
  let latest: MonitorCriteriaInstance = initial;
  const onDelete: jest.Mock = jest.fn();
  function Wrapper(): ReactElement {
    const [value, setValue] = useState<MonitorCriteriaInstance>(initial);
    return (
      <MonitorCriteriaInstanceElement
        value={value}
        monitorStep={monitorStep}
        monitorType={monitorType}
        monitorStatusDropdownOptions={[
          { label: "Offline", value: STATUS_ID.toString() },
        ]}
        incidentSeverityDropdownOptions={[
          { label: "Critical", value: SEVERITY_ID.toString() },
        ]}
        alertSeverityDropdownOptions={[
          { label: "Critical", value: SEVERITY_ID.toString() },
        ]}
        onCallPolicyDropdownOptions={[
          { label: "Primary on-call", value: POLICY_ID.toString() },
        ]}
        labelDropdownOptions={[
          { label: "Production", value: LABEL_ID.toString() },
        ]}
        teamDropdownOptions={[{ label: "Platform", value: TEAM_ID.toString() }]}
        userDropdownOptions={[
          { label: "Alex", value: USER_ID.toString() },
          { label: "Sam", value: USER_TWO_ID.toString() },
        ]}
        incidentRoleOptions={[
          {
            id: COMMANDER_ID.toString(),
            name: "Commander",
            canAssignMultipleUsers: false,
          },
          {
            id: RESPONDER_ID.toString(),
            name: "Responders",
            canAssignMultipleUsers: true,
          },
        ]}
        onChange={(changed: MonitorCriteriaInstance) => {
          latest = MonitorCriteriaInstance.clone(changed);
          setValue(latest);
        }}
        onDelete={onDelete}
      />
    );
  }
  render(<Wrapper />);
  return {
    latest: () => {
      return latest;
    },
    onDelete,
  };
}

function pick(name: string, option: string): void {
  fireEvent.keyDown(screen.getByRole("combobox", { name }), {
    key: "ArrowDown",
    code: "ArrowDown",
  });
  const optionElement: HTMLElement | undefined = screen
    .getAllByText(option)
    .find((element: HTMLElement) => {
      return Boolean(element.closest(".ou-select__option"));
    });
  if (!optionElement) {
    throw new Error(`Option ${option} was not found in ${name}`);
  }
  fireEvent.click(optionElement);
}

function open(name: string): void {
  fireEvent.click(screen.getByRole("button", { name }));
}

afterEach(cleanup);

describe("Monitor rule details", () => {
  test("shows When and Then immediately with optional detail controls hidden", () => {
    renderRule();
    expect(screen.getByRole("region", { name: "When" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Then" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Rule name" })).toBeVisible();
    expect(
      screen.queryByRole("textbox", { name: /Description/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("switch", { name: "Enable this rule" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: "Create an alert" }),
    ).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByRole("switch", { name: "Declare an incident" }),
    ).toHaveAttribute("aria-checked", "false");
  });

  test("an optional empty description remains valid after a save roundtrip", () => {
    const harness: Harness = renderRule();
    fireEvent.change(screen.getByRole("textbox", { name: "Rule name" }), {
      target: { value: "Checkout failure" },
    });
    const restored: MonitorCriteriaInstance = MonitorCriteriaInstance.fromJSON(
      harness.latest().toJSON(),
    );
    expect(restored.data?.description).toBe("");
    expect(restored.data?.name).toBe("Checkout failure");
    expect(
      MonitorCriteriaInstance.getValidationError(restored, MonitorType.Ping),
    ).toBeNull();
  });

  test("the optional description can be added, hidden, reopened and cleared", () => {
    const harness: Harness = renderRule();
    open("Rule description");
    const description: HTMLElement = screen.getByRole("textbox", {
      name: /Description/,
    });
    fireEvent.change(description, {
      target: { value: "Check the checkout service first." },
    });
    open("Rule description");
    expect(description).not.toBeVisible();
    open("Rule description");
    expect(description).toHaveValue("Check the checkout service first.");
    fireEvent.change(description, { target: { value: "" } });
    fireEvent.blur(description);
    expect(harness.latest().data?.description).toBe("");
    expect(
      MonitorCriteriaInstance.getValidationError(
        harness.latest(),
        MonitorType.Ping,
      ),
    ).toBeNull();
  });

  test("renaming preserves a saved description without opening it", () => {
    const harness: Harness = renderRule(
      buildRule({ description: "Original explanation" }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Rule name" }), {
      target: { value: "New name" },
    });
    expect(harness.latest().data?.description).toBe("Original explanation");
    expect(
      screen.getByRole("button", { name: "Rule description" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  test("empty names show a recoverable field error after blur", () => {
    renderRule();
    const name: HTMLElement = screen.getByRole("textbox", {
      name: "Rule name",
    });
    fireEvent.change(name, { target: { value: "" } });
    fireEvent.blur(name);
    expect(screen.getByText("Rule name is required")).toBeVisible();
    fireEvent.change(name, { target: { value: "Recovered name" } });
    expect(screen.queryByText("Rule name is required")).not.toBeInTheDocument();
  });

  test("a single condition omits the unnecessary all/any selector", () => {
    renderRule();
    expect(
      screen.queryByRole("radiogroup", { name: "Match conditions" }),
    ).not.toBeInTheDocument();
  });

  test("multiple conditions offer all/any without replacing the filters", () => {
    const initial: MonitorCriteriaInstance = buildRule();
    initial.data!.filters.push({
      checkOn: CheckOn.ResponseTime,
      filterType: FilterType.GreaterThan,
      value: 1000,
    });
    const harness: Harness = renderRule(initial);
    const filters: RuleData["filters"] = [...harness.latest().data!.filters];
    fireEvent.click(
      screen.getByRole("radio", { name: "Any condition matches" }),
    );
    expect(harness.latest().data?.filterCondition).toBe(FilterCondition.Any);
    expect(harness.latest().data?.filters).toEqual(filters);
    fireEvent.click(
      screen.getByRole("radio", { name: "All conditions match" }),
    );
    expect(harness.latest().data?.filterCondition).toBe(FilterCondition.All);
  });

  test("disabling a rule retains its conditions and action configuration", () => {
    const alert: CriteriaAlert = savedAlert();
    const harness: Harness = renderRule(
      buildRule({ alerts: [alert], createAlerts: true }),
    );
    open("Advanced rule settings");
    fireEvent.click(screen.getByRole("switch", { name: "Enable this rule" }));
    expect(harness.latest().data?.isEnabled).toBe(false);
    expect(harness.latest().data?.createAlerts).toBe(true);
    expect(harness.latest().data?.alerts[0]).toEqual(alert);
    expect(harness.latest().data?.filters).toHaveLength(1);
  });

  test("the delete button dispatches exactly once", () => {
    const harness: Harness = renderRule();
    open("Delete rule");
    expect(harness.onDelete).toHaveBeenCalledTimes(1);
  });

  test("an actionless rule makes the next choice explicit", () => {
    renderRule(
      buildRule({ monitorStatusId: undefined, changeMonitorStatus: false }),
    );
    expect(
      screen.getByText("Turn on an action to use this rule."),
    ).toBeVisible();
    expect(
      screen.queryByRole("combobox", { name: "Change monitor status to" }),
    ).not.toBeInTheDocument();
  });

  test.each([false, undefined])(
    "a retained status id does not enable a status action with flag %s",
    (flag: boolean | undefined) => {
      renderRule(
        buildRule({ changeMonitorStatus: flag, monitorStatusId: STATUS_ID }),
      );
      expect(
        screen.getByRole("switch", { name: "Change monitor status" }),
      ).toHaveAttribute("aria-checked", "false");
      expect(
        screen.queryByRole("combobox", { name: "Change monitor status to" }),
      ).not.toBeInTheDocument();
    },
  );

  test("an enabled empty incident action can be configured explicitly", () => {
    const harness: Harness = renderRule(
      buildRule({ createIncidents: true, incidents: [] }),
    );
    expect(harness.latest().data?.incidents).toHaveLength(0);
    open("Configure incident");
    expect(harness.latest().data?.incidents).toHaveLength(1);
    expect(
      screen.getByRole("textbox", { name: "Incident title" }),
    ).toBeVisible();
  });
});

describe.each(["Alert", "Incident"] as const)(
  "%s action editor",
  (kind: "Alert" | "Incident") => {
    function setup(): Harness {
      return renderRule(
        buildRule(
          kind === "Alert"
            ? { createAlerts: true, alerts: [savedAlert()] }
            : { createIncidents: true, incidents: [savedIncident()] },
        ),
      );
    }
    function action(
      harness: Harness,
    ): CriteriaAlert | CriteriaIncident | undefined {
      return kind === "Alert"
        ? harness.latest().data?.alerts[0]
        : harness.latest().data?.incidents[0];
    }

    test("keeps the essentials visible and saved advanced controls hidden", () => {
      setup();
      expect(
        screen.getByRole("textbox", { name: `${kind} title` }),
      ).toBeVisible();
      expect(
        screen.getByRole("combobox", { name: `${kind} severity` }),
      ).toBeVisible();
      expect(
        screen.getByRole("combobox", { name: `${kind} on-call policies` }),
      ).toBeVisible();
      expect(
        screen.getByRole("checkbox", {
          name: `Auto-resolve ${kind.toLowerCase()}`,
        }),
      ).toBeChecked();
      expect(
        screen.queryByRole("checkbox", { name: `Private ${kind}` }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: `${kind} details` }),
      ).toHaveAttribute("aria-expanded", "false");
      expect(screen.getByText(/2 owners.*Private/)).toBeVisible();
    });

    test("renaming does not discard hidden descriptions, ownership, labels or privacy", () => {
      const harness: Harness = setup();
      const original: CriteriaAlert | CriteriaIncident | undefined =
        action(harness);
      fireEvent.change(screen.getByRole("textbox", { name: `${kind} title` }), {
        target: { value: "Updated title" },
      });
      expect(action(harness)).toEqual({ ...original, title: "Updated title" });
      const restored: MonitorCriteriaInstance =
        MonitorCriteriaInstance.fromJSON(harness.latest().toJSON());
      expect(
        kind === "Alert"
          ? restored.data?.alerts[0]
          : restored.data?.incidents[0],
      ).toEqual(action(harness));
    });

    test("switching off and on restores every configured value", () => {
      const harness: Harness = setup();
      const original: CriteriaAlert | CriteriaIncident | undefined =
        action(harness);
      const toggle: HTMLElement = screen.getByRole("switch", {
        name: kind === "Alert" ? "Create an alert" : "Declare an incident",
      });
      fireEvent.click(toggle);
      expect(
        screen.queryByRole("textbox", { name: `${kind} title` }),
      ).not.toBeInTheDocument();
      fireEvent.click(toggle);
      expect(action(harness)).toEqual(original);
    });

    test("advanced values remain editable after opening the single details disclosure", () => {
      const harness: Harness = setup();
      open(`${kind} details`);
      fireEvent.click(
        screen.getByRole("checkbox", { name: `Private ${kind}` }),
      );
      pick(`${kind} owner users`, "Sam");
      expect(action(harness)?.isPrivate).toBe(false);
      expect(
        action(harness)?.ownerUserIds?.map((id: ObjectID) => {
          return id.toString();
        }),
      ).toEqual([USER_ID.toString(), USER_TWO_ID.toString()]);
      expect(action(harness)?.remediationNotes).toBe(
        "Restart only after investigation.",
      );
      open(`${kind} details`);
      expect(
        screen.queryByRole("combobox", { name: `${kind} owner users` }),
      ).not.toBeInTheDocument();
    });

    test("auto-resolve is independent of private and ownership configuration", () => {
      const harness: Harness = setup();
      fireEvent.click(
        screen.getByRole("checkbox", {
          name: `Auto-resolve ${kind.toLowerCase()}`,
        }),
      );
      expect(
        kind === "Alert"
          ? (action(harness) as CriteriaAlert).autoResolveAlert
          : (action(harness) as CriteriaIncident).autoResolveIncident,
      ).toBe(false);
      expect(action(harness)?.isPrivate).toBe(true);
      expect(action(harness)?.ownerTeamIds).toEqual([TEAM_ID]);
    });

    test("clearing a title exposes the validation error without requiring optional fields", () => {
      const harness: Harness = setup();
      const title: HTMLElement = screen.getByRole("textbox", {
        name: `${kind} title`,
      });
      fireEvent.change(title, { target: { value: "" } });
      fireEvent.blur(title);
      expect(screen.getByText(`${kind} title is required`)).toBeVisible();
      expect(
        MonitorCriteriaInstance.getValidationError(
          harness.latest(),
          MonitorType.Ping,
        ),
      ).toContain(`${kind} title is required`);
      fireEvent.change(title, { target: { value: "Recovered title" } });
      expect(
        MonitorCriteriaInstance.getValidationError(
          harness.latest(),
          MonitorType.Ping,
        ),
      ).toBeNull();
    });
  },
);

describe("Specialized rule settings", () => {
  test("single and multi-user incident role edits preserve unrelated assignments", () => {
    const harness: Harness = renderRule(
      buildRule({ createIncidents: true, incidents: [savedIncident()] }),
    );
    open("Incident details");
    pick("Commander", "Sam");
    expect(harness.latest().data?.incidents[0]?.incidentMemberRoles).toEqual([
      { roleId: RESPONDER_ID, userId: USER_ID },
      { roleId: COMMANDER_ID, userId: USER_TWO_ID },
    ]);
    pick("Responders", "Sam");
    expect(harness.latest().data?.incidents[0]?.incidentMemberRoles).toEqual([
      { roleId: COMMANDER_ID, userId: USER_TWO_ID },
      { roleId: RESPONDER_ID, userId: USER_ID },
      { roleId: RESPONDER_ID, userId: USER_TWO_ID },
    ]);
  });

  test.each(["Alert", "Incident"] as const)(
    "a legacy %s row without an id stays editable",
    (kind: "Alert" | "Incident") => {
      const legacy: CriteriaAlert | CriteriaIncident =
        kind === "Alert" ? savedAlert() : savedIncident();
      delete (legacy as Partial<CriteriaAlert>).id;
      const harness: Harness = renderRule(
        buildRule(
          kind === "Alert"
            ? { createAlerts: true, alerts: [legacy as CriteriaAlert] }
            : {
                createIncidents: true,
                incidents: [legacy as CriteriaIncident],
              },
        ),
      );
      fireEvent.change(screen.getByRole("textbox", { name: `${kind} title` }), {
        target: { value: "Legacy row edited" },
      });
      const latest: CriteriaAlert | CriteriaIncident | undefined =
        kind === "Alert"
          ? harness.latest().data?.alerts[0]
          : harness.latest().data?.incidents[0];
      expect(latest?.title).toBe("Legacy row edited");
      expect(latest?.remediationNotes).toBe(legacy.remediationNotes);
    },
  );

  test.each(["Alert", "Incident"] as const)(
    "a legacy null %s row does not crash the editor",
    (kind: "Alert" | "Incident") => {
      const rule: MonitorCriteriaInstance = buildRule(
        kind === "Alert"
          ? { createAlerts: true, alerts: [null as unknown as CriteriaAlert] }
          : {
              createIncidents: true,
              incidents: [null as unknown as CriteriaIncident],
            },
      );
      expect(() => {
        renderRule(rule);
      }).not.toThrow();
      expect(
        screen.getByRole("textbox", { name: `${kind} title` }),
      ).toBeVisible();
    },
  );

  test("multiple saved incidents keep independent editors and stable identities", () => {
    const first: CriteriaIncident = savedIncident();
    const second: CriteriaIncident = {
      ...savedIncident(),
      title: "Second incident",
    };
    const harness: Harness = renderRule(
      buildRule({ createIncidents: true, incidents: [first, second] }),
    );
    const titles: Array<HTMLElement> = screen.getAllByRole("textbox", {
      name: "Incident title",
    });
    fireEvent.change(titles[1]!, { target: { value: "Second edited" } });
    expect(harness.latest().data?.incidents[0]).toEqual(first);
    expect(harness.latest().data?.incidents[1]).toEqual({
      ...second,
      title: "Second edited",
    });
  });

  test("incoming grouping edits merge instead of dropping saved recovery paths", () => {
    const grouping: IncidentGroupingConfig = {
      groupByJSONPath: "requestBody.alerts[*].name",
      resolvedWhenJSONPath: "requestBody.alerts[*].status",
      resolvedWhenValue: "resolved",
      maxKeysPerPayload: 20,
    };
    const harness: Harness = renderRule(
      buildRule({ incidentGrouping: grouping }),
      MonitorType.IncomingRequest,
    );
    expect(
      screen.getByRole("button", { name: "Advanced rule settings" }),
    ).toHaveAttribute("aria-expanded", "true");
    fireEvent.change(
      screen.getByRole("textbox", {
        name: "Open a separate incident for each…",
      }),
      { target: { value: "requestBody.alerts[*].fingerprint" } },
    );
    expect(harness.latest().data?.incidentGrouping).toEqual({
      ...grouping,
      groupByJSONPath: "requestBody.alerts[*].fingerprint",
    });
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Max incidents per request" }),
      { target: { value: "35" } },
    );
    expect(harness.latest().data?.incidentGrouping?.maxKeysPerPayload).toBe(35);
    expect(harness.latest().data?.incidentGrouping?.resolvedWhenValue).toBe(
      "resolved",
    );
  });

  test("incoming grouping can be cleared, and re-enabling starts with a blank path", () => {
    const harness: Harness = renderRule(
      buildRule({ incidentGrouping: { groupByJSONPath: "requestBody.name" } }),
      MonitorType.IncomingRequest,
    );
    const toggle: HTMLElement = screen.getByRole("switch", {
      name: /Group incidents and alerts by a payload field/,
    });
    fireEvent.click(toggle);
    expect(harness.latest().data?.incidentGrouping).toBeUndefined();
    expect(
      screen.queryByRole("textbox", {
        name: "Open a separate incident for each…",
      }),
    ).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(harness.latest().data?.incidentGrouping).toEqual({
      groupByJSONPath: "",
    });
  });

  test("non-webhook monitors do not show incoming grouping controls", () => {
    renderRule();
    open("Advanced rule settings");
    expect(
      screen.queryByRole("switch", { name: /Group incidents/ }),
    ).not.toBeInTheDocument();
  });

  test("optional recovery fields and the incident cap can be cleared independently", () => {
    const harness: Harness = renderRule(
      buildRule({
        incidentGrouping: {
          groupByJSONPath: "requestBody.name",
          resolvedWhenJSONPath: "requestBody.status",
          resolvedWhenValue: "resolved",
          maxKeysPerPayload: 20,
        },
      }),
      MonitorType.IncomingRequest,
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Field that signals recovery" }),
      { target: { value: "" } },
    );
    expect(
      harness.latest().data?.incidentGrouping?.resolvedWhenJSONPath,
    ).toBeUndefined();
    expect(harness.latest().data?.incidentGrouping?.resolvedWhenValue).toBe(
      "resolved",
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Value that means recovered" }),
      { target: { value: "" } },
    );
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Max incidents per request" }),
      { target: { value: "" } },
    );
    expect(harness.latest().data?.incidentGrouping).toEqual({
      groupByJSONPath: "requestBody.name",
      resolvedWhenJSONPath: undefined,
      resolvedWhenValue: undefined,
      maxKeysPerPayload: undefined,
    });
  });

  test("metric series variables still reach the dynamic value picker", () => {
    const step: MonitorStep = new MonitorStep();
    step.data!.metricMonitor = {
      rollingTime: RollingTime.Past1Minute,
      metricViewConfig: {
        queryConfigs: [
          {
            metricAliasData: { metricVariable: "cpu" },
            metricQueryData: {
              groupByAttributeKeys: [
                "host.name",
                "resource.k8s.container.name",
              ],
            },
          } as MetricQueryConfigData,
        ],
        formulaConfigs: [],
      },
    };
    renderRule(
      buildRule({ createAlerts: true, alerts: [savedAlert()] }),
      MonitorType.Metrics,
      step,
    );
    open("View dynamic values");
    expect(screen.getByText("{{host.name}}")).toBeVisible();
    expect(screen.getByText("{{resource.k8s.container.name}}")).toBeVisible();
  });
});
