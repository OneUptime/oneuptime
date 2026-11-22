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
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import CappedListServer, { namesSortingFirst } from "./CappedListServer";
import { CRITERIA_RECORD_NOT_FOUND_LABEL } from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/CriteriaRecordPicker";
import MonitorCriteriaAlertForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorCriteriaAlertForm";
import MonitorCriteriaIncidentForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorCriteriaIncidentForm";
import Label from "../../../Models/DatabaseModels/Label";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import Includes from "../../../Types/BaseDatabase/Includes";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import { CriteriaAlert } from "../../../Types/Monitor/CriteriaAlert";
import { CriteriaIncident } from "../../../Types/Monitor/CriteriaIncident";
import ObjectID from "../../../Types/ObjectID";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A MONITOR'S CRITERIA KEEP THE ON-CALL POLICIES AND LABELS THEY SET, HOWEVER
 * MANY THE PROJECT HAS (#10646).
 *
 * The criteria's incident and alert forms picked policies and labels from
 * the project's first 10,000 by name, and drew as picked only the saved ids
 * found in that list. A policy past them - "WB Payments Escalation" in a
 * project of 10,050 named before it - did not show, and the next change to
 * the field dropped it: the next incident the monitor opened paged nobody.
 *
 * The two pickers search the server now (CriteriaRecordPicker) and hold
 * every saved id; ModelAPI answers from a project faked whole
 * (CappedListServer). The list the monitor form read still names what it
 * can at once, as `knownOptions`.
 */

const LATE_POLICY_ID: string = "e0000000-0000-4000-8000-0000000000aa";
const OTHER_LATE_POLICY_ID: string = "e0000000-0000-4000-8000-0000000000ab";
const LATE_LABEL_ID: string = "c0000000-0000-4000-8000-0000000000aa";
const ARCHIVED_LABEL_ID: string = "c0000000-0000-4000-8000-0000000000ee";
const DELETED_LABEL_ID: string = "c0000000-0000-4000-8000-0000000000dd";

const BEFORE_WB: number = LIMIT_PER_PROJECT + 50;

let server: CappedListServer;
let onChange: MockFunction;
// What the monitor form read: the first 10,000 policies by name.
let firstPolicies: Array<DropdownOption>;

beforeEach(() => {
  server = new CappedListServer();

  const policies: Array<OnCallDutyPolicy> = server.add(
    OnCallDutyPolicy,
    namesSortingFirst(BEFORE_WB).map(
      (name: string): Record<string, unknown> => {
        return { _id: ObjectID.generate().toString(), name: name };
      },
    ),
  );
  server.add(OnCallDutyPolicy, [
    { _id: LATE_POLICY_ID, name: "WB Payments Escalation" },
    { _id: OTHER_LATE_POLICY_ID, name: "WB Search Escalation" },
  ]);
  server.add(Label, [
    { _id: LATE_LABEL_ID, name: "WB-kiosk", isArchived: false },
    { _id: ARCHIVED_LABEL_ID, name: "WB-retired", isArchived: true },
  ]);
  server.install();

  firstPolicies = policies
    .slice(0, LIMIT_PER_PROJECT)
    .map((policy: OnCallDutyPolicy): DropdownOption => {
      return { value: policy._id!.toString(), label: policy.name || "" };
    });

  onChange = getJestMockFunction();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderIncidentForm(
  value: Partial<CriteriaIncident>,
): Promise<void> {
  await act(async () => {
    render(
      <MonitorCriteriaIncidentForm
        initialValue={{
          id: "incident-1",
          title: "Kiosk offline",
          description: "",
          ...value,
        }}
        incidentSeverityDropdownOptions={[]}
        onCallPolicyDropdownOptions={firstPolicies}
        labelDropdownOptions={[]}
        userDropdownOptions={[]}
        onChange={(next: CriteriaIncident) => {
          onChange(next);
        }}
      />,
    );
  });
}

function chipsIn(testId: string): Array<string> {
  const field: HTMLElement = screen
    .getByTestId(testId)
    .closest("[data-testid='entity-dropdown-box']")!.parentElement!
    .parentElement!;

  return within(field)
    .queryAllByTestId("entity-dropdown-chip-label")
    .map((chip: HTMLElement): string => {
      return chip.textContent || "";
    });
}

function lastIncident(): CriteriaIncident {
  return onChange.mock.calls[
    onChange.mock.calls.length - 1
  ]![0] as CriteriaIncident;
}

function idsOf(ids: Array<ObjectID> | undefined): Array<string> {
  return (ids || []).map((id: ObjectID): string => {
    return id.toString();
  });
}

describe("the incident's on-call policies", () => {
  test("a saved policy past the 10,000th shows, read by its id", async () => {
    await renderIncidentForm({
      onCallPolicyIds: [new ObjectID(LATE_POLICY_ID)],
    });

    await waitFor(() => {
      expect(chipsIn("monitor-criteria-incident-onCallPolicyIds")).toEqual([
        "WB Payments Escalation",
      ]);
    });

    const reads: Array<Record<string, unknown>> = server
      .callsFor(OnCallDutyPolicy)
      .map((call: { query: Record<string, unknown> }) => {
        return call.query;
      });

    expect(reads).toHaveLength(1);
    expect(reads[0]!["_id"]).toBeInstanceOf(Includes);
  });

  test("another past the 10,000th is found by its name, and the saved one survives the pick", async () => {
    await renderIncidentForm({
      onCallPolicyIds: [new ObjectID(LATE_POLICY_ID)],
    });

    await waitFor(() => {
      expect(chipsIn("monitor-criteria-incident-onCallPolicyIds")).toHaveLength(
        1,
      );
    });

    const picker: HTMLElement = screen.getByTestId(
      "monitor-criteria-incident-onCallPolicyIds",
    );

    await act(async () => {
      fireEvent.focus(picker);
      fireEvent.change(picker, { target: { value: "Search Esc" } });
    });

    const option: HTMLElement = await screen.findByRole("option", {
      name: /WB Search Escalation/,
    });

    await act(async () => {
      fireEvent.click(option);
    });

    expect(idsOf(lastIncident().onCallPolicyIds)).toEqual([
      LATE_POLICY_ID,
      OTHER_LATE_POLICY_ID,
    ]);
  });

  test("one the form read already is named at once, without a read", async () => {
    await renderIncidentForm({
      onCallPolicyIds: [new ObjectID(String(firstPolicies[0]!.value))],
    });

    expect(chipsIn("monitor-criteria-incident-onCallPolicyIds")).toEqual([
      "AP000001",
    ]);
    expect(server.callsFor(OnCallDutyPolicy)).toHaveLength(0);
  });
});

describe("the incident's labels", () => {
  test("an archived label stays marked Archived; one deleted since reads No longer available until it is taken out", async () => {
    await renderIncidentForm({
      labelIds: [
        new ObjectID(ARCHIVED_LABEL_ID),
        new ObjectID(DELETED_LABEL_ID),
        new ObjectID(LATE_LABEL_ID),
      ],
    });

    await waitFor(() => {
      expect(chipsIn("monitor-criteria-incident-labelIds")).toEqual([
        "WB-retired",
        CRITERIA_RECORD_NOT_FOUND_LABEL,
        "WB-kiosk",
      ]);
    });
    expect(
      screen.getByTestId("entity-dropdown-archived-tag"),
    ).toBeInTheDocument();
    // Drawing them dropped nothing: whatever the form reported holds all three.
    for (const [incident] of onChange.mock.calls as Array<[CriteriaIncident]>) {
      expect(idsOf(incident.labelIds)).toEqual([
        ARCHIVED_LABEL_ID,
        DELETED_LABEL_ID,
        LATE_LABEL_ID,
      ]);
    }

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", {
          name: `Remove ${CRITERIA_RECORD_NOT_FOUND_LABEL}`,
        }),
      );
    });

    expect(idsOf(lastIncident().labelIds)).toEqual([
      ARCHIVED_LABEL_ID,
      LATE_LABEL_ID,
    ]);
  });

  test("an archived label is never offered for a new pick", async () => {
    await renderIncidentForm({});

    const picker: HTMLElement = screen.getByTestId(
      "monitor-criteria-incident-labelIds",
    );

    await act(async () => {
      fireEvent.focus(picker);
      fireEvent.change(picker, { target: { value: "WB-" } });
    });

    await screen.findByRole("option", { name: /WB-kiosk/ });

    expect(
      screen.queryByRole("option", { name: /WB-retired/ }),
    ).not.toBeInTheDocument();
  });
});

describe("the alert's", () => {
  test("on-call policy past the 10,000th shows, and survives a change to its labels", async () => {
    const alertChanges: MockFunction = getJestMockFunction();

    await act(async () => {
      render(
        <MonitorCriteriaAlertForm
          initialValue={{
            id: "alert-1",
            title: "Kiosk offline",
            description: "",
            onCallPolicyIds: [new ObjectID(LATE_POLICY_ID)],
          }}
          alertSeverityDropdownOptions={[]}
          onCallPolicyDropdownOptions={firstPolicies}
          labelDropdownOptions={[]}
          onChange={(next: CriteriaAlert) => {
            alertChanges(next);
          }}
        />,
      );
    });

    await waitFor(() => {
      expect(chipsIn("monitor-criteria-alert-onCallPolicyIds")).toEqual([
        "WB Payments Escalation",
      ]);
    });

    const labels: HTMLElement = screen.getByTestId(
      "monitor-criteria-alert-labelIds",
    );

    await act(async () => {
      fireEvent.focus(labels);
      fireEvent.change(labels, { target: { value: "kiosk" } });
    });

    const option: HTMLElement = await screen.findByRole("option", {
      name: /WB-kiosk/,
    });

    await act(async () => {
      fireEvent.click(option);
    });

    const last: CriteriaAlert = alertChanges.mock.calls[
      alertChanges.mock.calls.length - 1
    ]![0] as CriteriaAlert;

    expect(idsOf(last.labelIds)).toEqual([LATE_LABEL_ID]);
    expect(idsOf(last.onCallPolicyIds)).toEqual([LATE_POLICY_ID]);
  });
});
