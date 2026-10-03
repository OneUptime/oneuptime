import MeasurementStateReference from "../../../../Server/Utils/Measurement/MeasurementStateReference";
import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * A measurement that starts or ends at "a state you pick" names the state
 * twice - the relation (startIncidentState) and its id column
 * (startIncidentStateId) - and a request may carry either. The dashboard's
 * state picker sends the relation; the services only read the id column,
 * so every such measurement set up in the dashboard was refused with "Pick
 * the state this measurement starts from". These pin reading the state
 * from whichever the request sent.
 */

const STATE_ID: string = "33333333-3333-4333-8333-333333333333";
const OTHER_STATE_ID: string = "44444444-4444-4444-8444-444444444444";

function state(id: string): IncidentState {
  const incidentState: IncidentState = new IncidentState();
  incidentState._id = id;
  return incidentState;
}

describe("MeasurementStateReference.getId", () => {
  test.each([
    ["an id", STATE_ID],
    ["an ObjectID", new ObjectID(STATE_ID)],
    ["a related row", state(STATE_ID)],
    ["a plain { _id }", { _id: STATE_ID }],
    ["a plain { id }", { id: STATE_ID }],
    ["an ObjectID inside a row", { id: new ObjectID(STATE_ID) }],
    ["an ObjectID as JSON", { _type: "ObjectID", value: STATE_ID }],
    ["an id with spaces around it", `  ${STATE_ID} `],
  ])("reads the id out of %s", (_label: string, value: unknown) => {
    expect(MeasurementStateReference.getId(value)).toBe(STATE_ID);
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["an empty id", ""],
    ["a row without an id", {}],
    ["a number", 7],
    ["true", true],
  ])("has no id for %s", (_label: string, value: unknown) => {
    expect(MeasurementStateReference.getId(value)).toBeUndefined();
  });
});

describe("MeasurementStateReference.getStateIdForCreate", () => {
  test("reads the id column, as an API client sends it", () => {
    expect(
      MeasurementStateReference.getStateIdForCreate({
        stateId: new ObjectID(STATE_ID),
        state: undefined,
      }),
    ).toBe(STATE_ID);
  });

  test("reads the relation, as the dashboard's state picker sends it", () => {
    expect(
      MeasurementStateReference.getStateIdForCreate({
        stateId: undefined,
        state: state(STATE_ID),
      }),
    ).toBe(STATE_ID);
  });

  test("has none when neither names a state", () => {
    expect(
      MeasurementStateReference.getStateIdForCreate({
        stateId: undefined,
        state: null,
      }),
    ).toBeUndefined();
  });
});

describe("MeasurementStateReference.getStateIdForUpdate", () => {
  const stored: ObjectID = new ObjectID(STATE_ID);

  test("keeps the stored state when the update does not name one", () => {
    expect(
      MeasurementStateReference.getStateIdForUpdate({
        update: { name: "Renamed" },
        stateIdKey: "startIncidentStateId",
        stateKey: "startIncidentState",
        storedStateId: stored,
      }),
    ).toBe(STATE_ID);
  });

  test("takes the state the update picks, from the relation", () => {
    expect(
      MeasurementStateReference.getStateIdForUpdate({
        update: { startIncidentState: state(OTHER_STATE_ID) },
        stateIdKey: "startIncidentStateId",
        stateKey: "startIncidentState",
        storedStateId: stored,
      }),
    ).toBe(OTHER_STATE_ID);
  });

  test("takes the state the update picks, from the id column, which wins over the relation", () => {
    expect(
      MeasurementStateReference.getStateIdForUpdate({
        update: {
          startIncidentStateId: new ObjectID(OTHER_STATE_ID),
          startIncidentState: state(STATE_ID),
        },
        stateIdKey: "startIncidentStateId",
        stateKey: "startIncidentState",
        storedStateId: stored,
      }),
    ).toBe(OTHER_STATE_ID);
  });

  test("an update that clears the state leaves none, rather than the stored one", () => {
    expect(
      MeasurementStateReference.getStateIdForUpdate({
        update: { startIncidentState: null },
        stateIdKey: "startIncidentStateId",
        stateKey: "startIncidentState",
        storedStateId: stored,
      }),
    ).toBeUndefined();
  });
});
