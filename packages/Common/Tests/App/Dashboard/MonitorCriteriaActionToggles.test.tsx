import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

import MonitorCriteriaInstanceElement from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorCriteriaInstance";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { CheckOn, FilterType } from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";

/*
 * Issues #3410 and #3413, driven through the real criteria form.
 *
 * The unit suite (Common/Tests/Types/Monitor/MonitorCriteriaActionValidation)
 * pins what getValidationError does with a given criteria. This file pins the
 * half that produced the bug reports: what the form actually puts INTO the
 * criteria as the user clicks. Both defects lived in that gap —
 *
 *   - flipping a switch on seeds a blank incident / alert row, and flipping it
 *     back off used to leave that row behind while hiding the fields to fix it;
 *   - the same seeding block ran on the way OFF too, so switching off an action
 *     that had no rows yet *added* one;
 *   - Toggle called its consumer's onChange twice per click, so the seeding
 *     ran twice.
 *
 * None of that is reachable from a type test, so it is driven here through the
 * component the user clicks, with the parent's clone-on-change behaviour
 * reproduced by the harness (MonitorCriteria.tsx rebuilds the array through
 * MonitorCriteria.fromJSON on every change, which is what makes the child's
 * props a fresh object on every keystroke).
 */

const MONITOR_STATUS_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OFFLINE_STATUS_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const INCIDENT_SEVERITY_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const ALERT_SEVERITY_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const CRITERIA_NAME: string = "Check if AWS Status Page is operational";

const MONITOR_STATUS_OPTIONS: Array<DropdownOption> = [
  { value: MONITOR_STATUS_ID.toString(), label: "Operational" },
  { value: OFFLINE_STATUS_ID.toString(), label: "Offline" },
];

const INCIDENT_SEVERITY_OPTIONS: Array<DropdownOption> = [
  { value: INCIDENT_SEVERITY_ID.toString(), label: "Critical" },
];

const ALERT_SEVERITY_OPTIONS: Array<DropdownOption> = [
  { value: ALERT_SEVERITY_ID.toString(), label: "Warning" },
];

// The shape the ExternalStatusPage online criteria ships with.
function buildCriteria(
  overrides?: Partial<NonNullable<MonitorCriteriaInstance["data"]>>,
): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: MONITOR_STATUS_ID,
    filterCondition: FilterCondition.All,
    filters: [
      {
        checkOn: CheckOn.IsOnline,
        filterType: FilterType.True,
        value: undefined,
      },
    ],
    incidents: [],
    alerts: [],
    changeMonitorStatus: true,
    createIncidents: false,
    createAlerts: false,
    isEnabled: true,
    name: CRITERIA_NAME,
    description: "Checks whether the external status page is healthy",
    ...(overrides || {}),
  };
  return instance;
}

interface Harness {
  // The criteria as the form last handed it up, i.e. what would be submitted.
  latest: () => MonitorCriteriaInstance;
  // The error the create form's customValidation would surface right now.
  error: () => string | null;
}

function renderCriteria(initial: MonitorCriteriaInstance): Harness {
  let latest: MonitorCriteriaInstance = initial;

  const Wrapper: FunctionComponent = (): ReactElement => {
    const [value, setValue] = React.useState<MonitorCriteriaInstance>(initial);

    return (
      <MonitorCriteriaInstanceElement
        monitorType={MonitorType.Ping}
        monitorStep={new MonitorStep()}
        monitorStatusDropdownOptions={MONITOR_STATUS_OPTIONS}
        incidentSeverityDropdownOptions={INCIDENT_SEVERITY_OPTIONS}
        alertSeverityDropdownOptions={ALERT_SEVERITY_OPTIONS}
        onCallPolicyDropdownOptions={[]}
        labelDropdownOptions={[]}
        teamDropdownOptions={[]}
        userDropdownOptions={[]}
        value={value}
        onChange={(changed: MonitorCriteriaInstance) => {
          /*
           * MonitorCriteria.tsx does exactly this on every change: it rebuilds
           * the criteria array through MonitorCriteria.fromJSON. Passing live
           * instances makes that hop a pass-through (fromJSON returns its
           * argument unchanged when it is already an instance), but keeping it
           * means this harness is the real parent's code path rather than a
           * simplified stand-in for it.
           */
          const rebuilt: MonitorCriteria = MonitorCriteria.fromJSON({
            _type: "MonitorCriteria",
            value: {
              monitorCriteriaInstanceArray: [changed],
            },
          } as never);

          latest = rebuilt.data!.monitorCriteriaInstanceArray[0]!;
          setValue(latest);
        }}
      />
    );
  };

  render(<Wrapper />);

  return {
    latest: (): MonitorCriteriaInstance => {
      return latest;
    },
    error: (): string | null => {
      return MonitorCriteriaInstance.getValidationError(
        latest,
        MonitorType.Ping,
      );
    },
  };
}

function switchFor(name: RegExp): HTMLElement {
  return screen.getByRole("switch", { name: name });
}

/*
 * Picks an option out of the shared Dropdown, which wraps react-select: find
 * the control by its placeholder, open the menu off its hidden text input, and
 * click the option (react-select portals the menu, so screen. rather than
 * within()).
 */
function pickFromDropdown(placeholder: string, optionLabel: string): void {
  const control: HTMLElement | null = screen
    .getByText(placeholder)
    .closest("div[class]");

  if (!control) {
    throw new Error(`No dropdown control found for placeholder ${placeholder}`);
  }

  const input: HTMLInputElement | null = control
    .closest("div")
    ?.parentElement?.querySelector("input") as HTMLInputElement | null;

  if (!input) {
    throw new Error(`No dropdown input found for placeholder ${placeholder}`);
  }

  fireEvent.keyDown(input, { key: "ArrowDown", code: "ArrowDown" });
  fireEvent.click(screen.getByText(optionLabel));
}

const ALERT_SWITCH: RegExp = /When filters match, create an alert/;
const INCIDENT_SWITCH: RegExp = /When filters match, declare an incident/;
const STATUS_SWITCH: RegExp = /When filters match, change monitor status/;

describe("Monitor criteria action switches", () => {
  afterEach(() => {
    cleanup();
  });

  describe("issue #3413 - an action that is switched off must not block Next", () => {
    test("declare an incident: on, then off, leaves the criteria valid", () => {
      const harness: Harness = renderCriteria(buildCriteria());
      expect(harness.error()).toBeNull();

      fireEvent.click(switchFor(INCIDENT_SWITCH));
      // Switching on seeds a blank row, which is what Next should block on.
      expect(harness.latest().data?.createIncidents).toBe(true);
      expect(harness.error()).toBe(
        `Incident title is required for criteria "${CRITERIA_NAME}"`,
      );

      fireEvent.click(switchFor(INCIDENT_SWITCH));
      expect(harness.latest().data?.createIncidents).toBe(false);
      expect(harness.error()).toBeNull();
    });

    test("create an alert: on, then off, leaves the criteria valid", () => {
      const harness: Harness = renderCriteria(buildCriteria());

      fireEvent.click(switchFor(ALERT_SWITCH));
      expect(harness.latest().data?.createAlerts).toBe(true);
      expect(harness.error()).toBe(
        `Alert title is required for criteria "${CRITERIA_NAME}"`,
      );

      fireEvent.click(switchFor(ALERT_SWITCH));
      expect(harness.latest().data?.createAlerts).toBe(false);
      expect(harness.error()).toBeNull();
    });

    test("the row the user typed survives switching off and back on", () => {
      /*
       * The rows are deliberately retained rather than cleared, so that a
       * mis-click does not throw away what was typed. That retention is the
       * reason the validator has to be gated instead.
       */
      const harness: Harness = renderCriteria(buildCriteria());

      fireEvent.click(switchFor(ALERT_SWITCH));
      fireEvent.change(screen.getByPlaceholderText(/is degraded/), {
        target: { value: "UND66DWANRTR01 is offline" },
      });

      fireEvent.click(switchFor(ALERT_SWITCH));
      expect(harness.error()).toBeNull();
      expect(harness.latest().data?.alerts[0]?.title).toBe(
        "UND66DWANRTR01 is offline",
      );

      fireEvent.click(switchFor(ALERT_SWITCH));
      expect(harness.latest().data?.alerts[0]?.title).toBe(
        "UND66DWANRTR01 is offline",
      );
    });

    test("both actions off with rows retained is valid", () => {
      const harness: Harness = renderCriteria(buildCriteria());

      fireEvent.click(switchFor(ALERT_SWITCH));
      fireEvent.click(switchFor(INCIDENT_SWITCH));
      fireEvent.click(switchFor(ALERT_SWITCH));
      fireEvent.click(switchFor(INCIDENT_SWITCH));

      expect(harness.latest().data?.createAlerts).toBe(false);
      expect(harness.latest().data?.createIncidents).toBe(false);
      expect(harness.latest().data?.alerts).toHaveLength(1);
      expect(harness.latest().data?.incidents).toHaveLength(1);
      expect(harness.error()).toBeNull();
    });
  });

  describe("issue #3410 - filling the fields must clear the error", () => {
    test("title plus severity is enough; the description stays optional", () => {
      /*
       * The reporter filled the Alert Title and the form stayed blocked,
       * because validation moved on to the description — a field that lives
       * inside a section the form itself labels "Optional alert description"
       * and renders collapsed. Title and Severity are the two the form marks
       * required, and they are now the two it checks.
       */
      const harness: Harness = renderCriteria(buildCriteria());

      fireEvent.click(switchFor(ALERT_SWITCH));
      expect(harness.error()).toContain("Alert title is required");

      fireEvent.change(screen.getByPlaceholderText(/is degraded/), {
        target: { value: "UND66DWANRTR01 is offline" },
      });
      expect(harness.error()).toBe(
        `Alert severity is required for criteria "${CRITERIA_NAME}"`,
      );

      pickFromDropdown("Select Severity", "Warning");

      expect(
        harness.latest().data?.alerts[0]?.alertSeverityId?.toString(),
      ).toBe(ALERT_SEVERITY_ID.toString());
      // Never touched, still empty, and no longer an obstacle.
      expect(harness.latest().data?.alerts[0]?.description).toBe("");
      expect(harness.error()).toBeNull();
    });

    test("the same for an incident", () => {
      const harness: Harness = renderCriteria(buildCriteria());

      fireEvent.click(switchFor(INCIDENT_SWITCH));
      fireEvent.change(screen.getByPlaceholderText(/is down/), {
        target: { value: "AWS Status Page has an active incident" },
      });
      expect(harness.error()).toBe(
        `Incident severity is required for criteria "${CRITERIA_NAME}"`,
      );

      pickFromDropdown("Select Severity", "Critical");

      expect(
        harness.latest().data?.incidents[0]?.incidentSeverityId?.toString(),
      ).toBe(INCIDENT_SEVERITY_ID.toString());
      expect(harness.latest().data?.incidents[0]?.description).toBe("");
      expect(harness.error()).toBeNull();
    });
  });

  describe("the switch seeds a row on the way on only", () => {
    test("switching an action off does not create a row it never had", () => {
      /*
       * NetworkDeviceAlertPackUtil ships criteria with the create flag on and
       * an empty array, and MonitorCriteriaIncidentsForm renders that as zero
       * rows rather than seeding one. Switching the action off used to run the
       * seeding block anyway and add a blank row on the way OUT — invisible,
       * because the sub-form is rendered only while the switch is on.
       */
      const harness: Harness = renderCriteria(
        buildCriteria({ createIncidents: true, incidents: [] }),
      );

      fireEvent.click(switchFor(INCIDENT_SWITCH));

      expect(harness.latest().data?.createIncidents).toBe(false);
      expect(harness.latest().data?.incidents).toHaveLength(0);
      expect(harness.error()).toBeNull();
    });

    test("switching an action on seeds exactly one row, not two", () => {
      /*
       * Toggle used to call onChange twice per click. The second pass found a
       * non-empty array and skipped, so this held by luck; it is pinned here
       * because the seeding block is what would break if that changed.
       * Toggle's own call count is pinned in Common/Tests/UI/Components/Toggle.
       */
      const harness: Harness = renderCriteria(buildCriteria());

      fireEvent.click(switchFor(INCIDENT_SWITCH));

      expect(harness.latest().data?.incidents).toHaveLength(1);
    });

    test("an alert sub-form opened on an empty array seeds one row, and it is inert once switched off", () => {
      /*
       * MonitorCriteriaAlertsForm - unlike the incident one - seeds a row on
       * mount when the array is empty, so the user has something to fill in.
       * That row is retained when the switch goes off, which is exactly the
       * state #3413 reported; it must not block.
       */
      const harness: Harness = renderCriteria(
        buildCriteria({ createAlerts: true, alerts: [] }),
      );

      expect(harness.latest().data?.alerts).toHaveLength(1);
      expect(harness.error()).toContain("Alert title is required");

      fireEvent.click(switchFor(ALERT_SWITCH));

      expect(harness.latest().data?.createAlerts).toBe(false);
      expect(harness.latest().data?.alerts).toHaveLength(1);
      expect(harness.error()).toBeNull();
    });
  });

  describe("the change-monitor-status switch reflects its own flag", () => {
    test("shows on for a criteria whose flag is on but whose status was never picked", () => {
      /*
       * Read from monitorStatusId alone, this switch showed OFF for a criteria
       * that does change the monitor status — the same "the form says this
       * action is off" confusion the two issues are about.
       */
      renderCriteria(
        buildCriteria({
          changeMonitorStatus: true,
          monitorStatusId: undefined,
        }),
      );

      expect(switchFor(STATUS_SWITCH)).toHaveAttribute("aria-checked", "true");
    });

    test("still shows on for a criteria saved before the flag existed", () => {
      renderCriteria(
        buildCriteria({
          changeMonitorStatus: false,
          monitorStatusId: MONITOR_STATUS_ID,
        }),
      );

      expect(switchFor(STATUS_SWITCH)).toHaveAttribute("aria-checked", "true");
    });

    test("shows off for a criteria that does not change status at all", () => {
      renderCriteria(
        buildCriteria({
          changeMonitorStatus: false,
          monitorStatusId: undefined,
        }),
      );

      expect(switchFor(STATUS_SWITCH)).toHaveAttribute("aria-checked", "false");
    });

    test("switching it off clears the status id and the flag together", () => {
      const harness: Harness = renderCriteria(buildCriteria());

      fireEvent.click(switchFor(STATUS_SWITCH));

      expect(harness.latest().data?.changeMonitorStatus).toBe(false);
      expect(harness.latest().data?.monitorStatusId).toBeUndefined();
    });
  });
});
