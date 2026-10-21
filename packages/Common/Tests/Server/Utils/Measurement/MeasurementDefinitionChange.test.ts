import MeasurementDefinitionChange, {
  MeasurementPickedStateColumns,
} from "../../../../Server/Utils/Measurement/MeasurementDefinitionChange";
import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * A measurement's history is worked out again for every incident when what
 * it measures changes. The dashboard's edit form sends every column on
 * every save, a rename included, so "the update names the column" cannot be
 * the test of a change - the value has to differ from the stored one.
 */

const STATE_ID: string = "33333333-3333-4333-8333-333333333333";
const OTHER_STATE_ID: string = "44444444-4444-4444-8444-444444444444";

const COLUMNS: Array<string> = [
  "startAnchorType",
  "endAnchorType",
  "startIncidentStateRole",
  "endIncidentStateRole",
  "startStateOccurrence",
  "endStateOccurrence",
  "isEnabled",
  "unit",
];

const PICKED_STATES: Array<MeasurementPickedStateColumns> = [
  { stateIdKey: "startIncidentStateId", stateKey: "startIncidentState" },
  { stateIdKey: "endIncidentStateId", stateKey: "endIncidentState" },
];

const STORED: Record<string, unknown> = {
  startAnchorType: "Declared At",
  endAnchorType: "State Entered",
  startIncidentStateRole: null,
  endIncidentStateRole: null,
  startIncidentStateId: undefined,
  endIncidentStateId: new ObjectID(STATE_ID),
  startStateOccurrence: "First",
  endStateOccurrence: "First",
  isEnabled: true,
  unit: "seconds",
};

function state(id: string): IncidentState {
  const incidentState: IncidentState = new IncidentState();
  incidentState._id = id;
  return incidentState;
}

function isChanged(update: Record<string, unknown>): boolean {
  return MeasurementDefinitionChange.isChanged({
    update,
    stored: STORED,
    columns: COLUMNS,
    pickedStates: PICKED_STATES,
  });
}

describe("MeasurementDefinitionChange.isChanged", () => {
  test("a rename is no change", () => {
    expect(isChanged({ name: "Time to identify" })).toBe(false);
  });

  test("a save that sends every column as it is stored is no change - the dashboard's edit form on a rename", () => {
    expect(
      isChanged({
        name: "Time to identify",
        description: "New words",
        startAnchorType: "Declared At",
        endAnchorType: "State Entered",
        startIncidentStateRole: null,
        endIncidentStateRole: null,
        // The picked state arrives as the relation.
        endIncidentState: state(STATE_ID),
        startStateOccurrence: "First",
        endStateOccurrence: "First",
        isEnabled: true,
        unit: "seconds",
      }),
    ).toBe(false);
  });

  test("empty, null and missing are the same: nothing set", () => {
    expect(
      isChanged({
        startIncidentStateRole: "",
        endIncidentStateRole: undefined,
        startIncidentStateId: null,
      }),
    ).toBe(false);
  });

  test.each([
    ["startAnchorType", "Impact Started At"],
    ["endAnchorType", "Postmortem Posted At"],
    ["startIncidentStateRole", "Acknowledged"],
    ["endIncidentStateRole", "Resolved"],
    ["startStateOccurrence", "Last"],
    ["endStateOccurrence", "Last"],
    ["isEnabled", false],
    ["unit", "minutes"],
  ])("a new %s is a change", (column: string, value: unknown) => {
    expect(isChanged({ [column]: value })).toBe(true);
  });

  test("picking another state is a change, whether by the relation or the id", () => {
    expect(isChanged({ endIncidentState: state(OTHER_STATE_ID) })).toBe(true);
    expect(
      isChanged({ endIncidentStateId: new ObjectID(OTHER_STATE_ID) }),
    ).toBe(true);
    expect(isChanged({ startIncidentState: state(STATE_ID) })).toBe(true);
  });

  test("clearing the picked state is a change", () => {
    expect(isChanged({ endIncidentState: null })).toBe(true);
  });

  test("a column that is not in the definition is never a change", () => {
    expect(
      isChanged({
        order: 4,
        aggregationType: "P90",
        showOnIncidentView: false,
      }),
    ).toBe(false);
  });
});
