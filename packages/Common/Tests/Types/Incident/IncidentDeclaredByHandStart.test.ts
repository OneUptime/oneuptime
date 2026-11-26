import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import Project from "../../../Models/DatabaseModels/Project";
import IncidentDeclaredByHandStart, {
  INCIDENT_DECLARED_BY_HAND_KEY,
  IncidentDeclaredByHand,
  START_INCIDENTS_DECLARED_BY_HAND_ACKNOWLEDGED_COLUMN,
} from "../../../Types/Incident/IncidentDeclaredByHandStart";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * The rule "Start incidents declared by hand acknowledged" (#11137) is
 * decided by: the server decides with it, the dashboard says before anyone
 * declares what it will decide. Pinned here as plain cases:
 *
 *   - only an explicit "on" turns it on: a project that could not be read,
 *     or never set it, pages as every project always did;
 *   - on, an incident declared by hand starts acknowledged only when nothing
 *     names its state and it pages no on-call policy;
 *   - the policies are counted once each, whatever shape they arrive in -
 *     the dashboard's ids, the chats' models, a template's stubs, an
 *     ObjectID or its JSON.
 */

const POLICY_A: string = "e0000000-0000-4000-8000-00000000000a";
const POLICY_B: string = "e0000000-0000-4000-8000-00000000000b";

describe("the switch", () => {
  test("is the Project column the settings page writes, and the misc key the forms send", () => {
    expect(START_INCIDENTS_DECLARED_BY_HAND_ACKNOWLEDGED_COLUMN).toBe(
      "startIncidentsDeclaredByHandAcknowledged",
    );
    expect(INCIDENT_DECLARED_BY_HAND_KEY).toBe("declaredByHand");
  });

  test("is on only when the project says so in so many words", () => {
    expect(
      IncidentDeclaredByHandStart.isOn({
        startIncidentsDeclaredByHandAcknowledged: true,
      }),
    ).toBe(true);
    expect(
      IncidentDeclaredByHandStart.isOn({
        startIncidentsDeclaredByHandAcknowledged: false,
      }),
    ).toBe(false);
    expect(
      IncidentDeclaredByHandStart.isOn({
        startIncidentsDeclaredByHandAcknowledged: null,
      }),
    ).toBe(false);
    expect(IncidentDeclaredByHandStart.isOn({})).toBe(false);
    expect(IncidentDeclaredByHandStart.isOn(null)).toBe(false);
    expect(IncidentDeclaredByHandStart.isOn(undefined)).toBe(false);
  });

  test("reads a Project model as it is read from the API", () => {
    const project: Project = new Project();

    expect(IncidentDeclaredByHandStart.isOn(project)).toBe(false);

    project.startIncidentsDeclaredByHandAcknowledged = true;

    expect(IncidentDeclaredByHandStart.isOn(project)).toBe(true);
  });

  test("is off by default on the model, and required, as every project starts", () => {
    const column: {
      defaultValue?: unknown;
      required?: boolean;
      isDefaultValueColumn?: boolean;
    } = new Project().getTableColumnMetadata(
      START_INCIDENTS_DECLARED_BY_HAND_ACKNOWLEDGED_COLUMN,
    ) as never;

    expect(column.defaultValue).toBe(false);
    expect(column.required).toBe(true);
    expect(column.isDefaultValueColumn).toBe(true);
  });
});

describe("where an incident declared by hand starts", () => {
  const cases: Array<[string, IncidentDeclaredByHand, boolean]> = [
    [
      "switch on, nothing names its state, it pages nobody",
      { isSwitchOn: true, hasStartingState: false, onCallPolicyCount: 0 },
      true,
    ],
    [
      "switch on, but it pages an on-call policy",
      { isSwitchOn: true, hasStartingState: false, onCallPolicyCount: 1 },
      false,
    ],
    [
      "switch on, but it pages several",
      { isSwitchOn: true, hasStartingState: false, onCallPolicyCount: 3 },
      false,
    ],
    [
      "switch on, but a state is picked",
      { isSwitchOn: true, hasStartingState: true, onCallPolicyCount: 0 },
      false,
    ],
    [
      "switch on, a state is picked and a policy pages",
      { isSwitchOn: true, hasStartingState: true, onCallPolicyCount: 2 },
      false,
    ],
    [
      "switch off",
      { isSwitchOn: false, hasStartingState: false, onCallPolicyCount: 0 },
      false,
    ],
    [
      "switch off, with a policy",
      { isSwitchOn: false, hasStartingState: false, onCallPolicyCount: 1 },
      false,
    ],
    [
      "switch off, with a state",
      { isSwitchOn: false, hasStartingState: true, onCallPolicyCount: 0 },
      false,
    ],
  ];

  test.each(cases)(
    "%s",
    (_name: string, declared: IncidentDeclaredByHand, expected: boolean) => {
      expect(IncidentDeclaredByHandStart.startsAcknowledged(declared)).toBe(
        expected,
      );
    },
  );
});

describe("counting the on-call policies a declaration pages", () => {
  test("nothing, or not a list, is none", () => {
    expect(IncidentDeclaredByHandStart.countOnCallPolicies(undefined)).toBe(0);
    expect(IncidentDeclaredByHandStart.countOnCallPolicies(null)).toBe(0);
    expect(IncidentDeclaredByHandStart.countOnCallPolicies([])).toBe(0);
    expect(IncidentDeclaredByHandStart.countOnCallPolicies("a policy")).toBe(0);
    expect(IncidentDeclaredByHandStart.countOnCallPolicies({})).toBe(0);
  });

  test("the dashboard's ids", () => {
    expect(
      IncidentDeclaredByHandStart.countOnCallPolicies([POLICY_A, POLICY_B]),
    ).toBe(2);
  });

  test("models, as the chats and a template's stubs hand them over", () => {
    const first: OnCallDutyPolicy = new OnCallDutyPolicy();
    first.id = new ObjectID(POLICY_A);
    const second: OnCallDutyPolicy = new OnCallDutyPolicy();
    second._id = POLICY_B;

    expect(
      IncidentDeclaredByHandStart.countOnCallPolicies([first, second]),
    ).toBe(2);
  });

  test("ObjectIDs, `{ _id }` objects and an ObjectID's JSON", () => {
    expect(
      IncidentDeclaredByHandStart.countOnCallPolicies([
        new ObjectID(POLICY_A),
        { _id: POLICY_B },
      ]),
    ).toBe(2);
    expect(
      IncidentDeclaredByHandStart.countOnCallPolicies([
        { _type: ObjectType.ObjectID, value: POLICY_A },
      ]),
    ).toBe(1);
    expect(
      IncidentDeclaredByHandStart.countOnCallPolicies([
        { _id: new ObjectID(POLICY_B) },
      ]),
    ).toBe(1);
  });

  test("each policy once, whatever its shape or letter case", () => {
    expect(
      IncidentDeclaredByHandStart.countOnCallPolicies([
        POLICY_A,
        POLICY_A.toUpperCase(),
        new ObjectID(POLICY_A),
        { _id: ` ${POLICY_A} ` },
      ]),
    ).toBe(1);
  });

  test("an entry with no id names nothing", () => {
    expect(
      IncidentDeclaredByHandStart.countOnCallPolicies([
        "",
        "   ",
        null,
        undefined,
        7,
        true,
        {},
        { _id: "" },
        { _id: null },
        new OnCallDutyPolicy(),
      ]),
    ).toBe(0);
  });
});
