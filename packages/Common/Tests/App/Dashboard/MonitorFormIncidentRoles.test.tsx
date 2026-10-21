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
  configure,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A monitor's incident roles, walked through the monitor form the way it is
 * built - creating a monitor and editing one alike:
 *
 *   - the form (MonitorSteps) reads the project's incident roles once, with
 *     what the role picker shows of each (INCIDENT_ROLE_CHOICE_SELECT: the
 *     icon, and whether the role is primary, too), and hands them and the
 *     project's people down to every step's rules;
 *   - a rule's criteria card (MonitorCriteriaInstance) draws its incident
 *     with the role picker, and what a pick saves goes through the card's
 *     own clone-on-change (MonitorCriteriaInstance.clone) and the criteria
 *     list's rebuild (MonitorCriteria.fromJSON), as it does in the form -
 *     one { roleId, userId } row per person, read back as ObjectIDs;
 *   - a monitor read back from the API - its rows saved as
 *     { _type: "ObjectID", value } JSON - shows each person under their
 *     role.
 */

configure({ asyncUtilTimeout: 10000 });

const recordedSteps: Array<Record<string, unknown>> = [];

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorStep",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>): null => {
        recordedSteps.push(props);
        return null;
      },
    };
  },
);

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/Probe", () => {
  return {
    __esModule: true,
    default: {
      getAllProbes: () => {
        return Promise.resolve([]);
      },
    },
  };
});

const ALICE_ID: string = "33333333-3333-4333-8333-000000000001";
const BOB_ID: string = "33333333-3333-4333-8333-000000000002";

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/ProjectUser", () => {
  return {
    __esModule: true,
    default: {
      fetchProjectUsersAsDropdownOptions: () => {
        return Promise.resolve([
          { value: "33333333-3333-4333-8333-000000000001", label: "Alice" },
          { value: "33333333-3333-4333-8333-000000000002", label: "Bob" },
        ]);
      },
    },
  };
});

import MonitorStepsElement from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorSteps";
import MonitorCriteriaInstanceElement from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorCriteriaInstance";
import { IncidentRoleOption } from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorCriteriaIncidentForm";
import { INCIDENT_ROLE_CHOICE_SELECT } from "../../../../App/FeatureSet/Dashboard/src/Components/IncidentRole/IncidentRoleAssignments";
import IncidentRole from "../../../Models/DatabaseModels/IncidentRole";
import Color from "../../../Types/Color";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import { CheckOn, FilterType } from "../../../Types/Monitor/CriteriaFilter";
import { IncidentMemberRoleAssignment } from "../../../Types/Monitor/CriteriaIncident";
import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const COMMANDER_ID: string = "22222222-2222-4222-8222-000000000001";
const RESPONDER_ID: string = "22222222-2222-4222-8222-000000000002";
const OPERATIONAL_ID: string = "44444444-4444-4444-8444-000000000001";
const SEVERITY_ID: string = "55555555-5555-4555-8555-000000000001";

function listOf<T>(data: Array<T>): unknown {
  return { data: data, count: data.length, skip: 0, limit: 50 };
}

// The project's roles as the API lists them.
function rolesOnServer(): Array<IncidentRole> {
  const commander: IncidentRole = new IncidentRole();
  commander._id = COMMANDER_ID;
  commander.name = "Incident Commander";
  commander.color = new Color("#7c3aed");
  commander.roleIcon = IconProp.ShieldCheck;
  commander.isPrimaryRole = true;
  commander.canAssignMultipleUsers = false;

  const responder: IncidentRole = new IncidentRole();
  responder._id = RESPONDER_ID;
  responder.name = "Responder";
  responder.color = new Color("#0891b2");
  responder.isPrimaryRole = false;
  responder.canAssignMultipleUsers = true;

  return [commander, responder];
}

let roleRequests: Array<Record<string, unknown>> = [];

beforeEach(() => {
  roleRequests = [];
  recordedSteps.length = 0;

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(
      (request: { modelType: unknown } & Record<string, unknown>): never => {
        if (request.modelType === IncidentRole) {
          roleRequests.push(request);
          return Promise.resolve(listOf(rolesOnServer())) as never;
        }

        return Promise.resolve(listOf([])) as never;
      },
    );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the monitor form reads the roles once, for every rule", () => {
  test("with what the role picker shows of each, and hands them and the people down", async () => {
    render(
      <MonitorStepsElement
        monitorType={MonitorType.Website}
        monitorName="Storefront"
        onChange={() => {}}
      />,
    );

    await waitFor(() => {
      const last: Record<string, unknown> | undefined =
        recordedSteps[recordedSteps.length - 1];

      expect(
        (last?.["incidentRoleOptions"] as Array<unknown> | undefined)?.length,
      ).toBe(2);
    });

    expect(roleRequests).toHaveLength(1);
    expect(roleRequests[0]!["select"]).toEqual(INCIDENT_ROLE_CHOICE_SELECT);

    const last: Record<string, unknown> =
      recordedSteps[recordedSteps.length - 1]!;

    expect(last["incidentRoleOptions"]).toEqual([
      {
        id: COMMANDER_ID,
        name: "Incident Commander",
        color: "#7c3aed",
        icon: IconProp.ShieldCheck,
        isPrimaryRole: true,
        canAssignMultipleUsers: false,
      },
      {
        id: RESPONDER_ID,
        name: "Responder",
        color: "#0891b2",
        isPrimaryRole: false,
        canAssignMultipleUsers: true,
      },
    ]);
    expect(last["userDropdownOptions"]).toEqual([
      { value: ALICE_ID, label: "Alice" },
      { value: BOB_ID, label: "Bob" },
    ]);
  });
});

describe("a rule names who takes each role, through its criteria card", () => {
  const ROLES: Array<IncidentRoleOption> = [
    {
      id: COMMANDER_ID,
      name: "Incident Commander",
      isPrimaryRole: true,
      canAssignMultipleUsers: false,
    },
    {
      id: RESPONDER_ID,
      name: "Responder",
      isPrimaryRole: false,
      canAssignMultipleUsers: true,
    },
  ];

  const USERS: Array<DropdownOption> = [
    { value: ALICE_ID, label: "Alice" },
    { value: BOB_ID, label: "Bob" },
  ];

  // A rule that declares one incident, as the API sends it.
  function ruleJson(
    rows?: Array<{ roleId: string; userId: string }>,
  ): JSONObject {
    return {
      _type: ObjectType.MonitorCriteriaInstance,
      value: ruleValue(rows),
    } as unknown as JSONObject;
  }

  function ruleValue(
    rows?: Array<{ roleId: string; userId: string }>,
  ): JSONObject {
    return {
      id: "rule-1",
      name: "Storefront is offline",
      description: "",
      monitorStatusId: { _type: "ObjectID", value: OPERATIONAL_ID },
      filterCondition: FilterCondition.All,
      filters: [
        {
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.False,
        },
      ],
      changeMonitorStatus: true,
      createIncidents: true,
      createAlerts: false,
      isEnabled: true,
      alerts: [],
      incidents: [
        {
          id: "rule-1-incident",
          title: "Storefront is offline",
          description: "",
          incidentSeverityId: { _type: "ObjectID", value: SEVERITY_ID },
          ...(rows
            ? {
                incidentMemberRoles: rows.map(
                  (row: { roleId: string; userId: string }): JSONObject => {
                    return {
                      roleId: { _type: "ObjectID", value: row.roleId },
                      userId: { _type: "ObjectID", value: row.userId },
                    };
                  },
                ),
              }
            : {}),
        },
      ],
    } as unknown as JSONObject;
  }

  interface Harness {
    latest: () => MonitorCriteriaInstance;
  }

  async function renderRule(
    initial: MonitorCriteriaInstance,
  ): Promise<Harness> {
    let latest: MonitorCriteriaInstance = initial;

    const Wrapper: FunctionComponent = (): ReactElement => {
      const [value, setValue] =
        React.useState<MonitorCriteriaInstance>(initial);

      return (
        <MonitorCriteriaInstanceElement
          monitorType={MonitorType.Website}
          monitorStep={new MonitorStep()}
          monitorStatusDropdownOptions={[
            { value: OPERATIONAL_ID, label: "Offline" },
          ]}
          incidentSeverityDropdownOptions={[
            { value: SEVERITY_ID, label: "Critical" },
          ]}
          alertSeverityDropdownOptions={[]}
          onCallPolicyDropdownOptions={[]}
          labelDropdownOptions={[]}
          userDropdownOptions={USERS}
          incidentRoleOptions={ROLES}
          value={value}
          onChange={(changed: MonitorCriteriaInstance) => {
            // As MonitorCriteria.tsx rebuilds its list on every change.
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

    await act(async (): Promise<void> => {
      render(<Wrapper />);
    });

    return {
      latest: (): MonitorCriteriaInstance => {
        return latest;
      },
    };
  }

  function rolesSection(): HTMLElement {
    return screen.getByTestId("criteria-incident-roles");
  }

  function cardOf(roleName: string): HTMLElement {
    const card: HTMLElement | undefined = within(rolesSection())
      .getAllByTestId("incident-role-card")
      .find((candidate: HTMLElement): boolean => {
        return within(candidate).queryByText(roleName) !== null;
      });

    expect(card).toBeDefined();

    return card!;
  }

  async function pick(
    user: UserEvent,
    roleName: string,
    personName: string,
  ): Promise<void> {
    await user.click(
      within(cardOf(roleName)).getByRole("combobox", { name: roleName }),
    );
    const options: Array<HTMLElement> = await screen.findAllByText(personName, {
      exact: true,
    });
    await user.click(options[options.length - 1]!);
  }

  // The rows the rule would save, as plain strings, checking they are ObjectIDs.
  function savedRows(
    rule: MonitorCriteriaInstance,
  ): Array<{ roleId: string; userId: string }> {
    const rows: Array<IncidentMemberRoleAssignment> =
      rule.data?.incidents?.[0]?.incidentMemberRoles || [];

    return rows.map(
      (
        row: IncidentMemberRoleAssignment,
      ): { roleId: string; userId: string } => {
        expect(row.roleId).toBeInstanceOf(ObjectID);
        expect(row.userId).toBeInstanceOf(ObjectID);

        return { roleId: row.roleId.toString(), userId: row.userId.toString() };
      },
    );
  }

  test("creating: picking people saves one row per person into the rule's incident", async () => {
    const harness: Harness = await renderRule(
      MonitorCriteriaInstance.fromJSON(ruleJson()),
    );
    const user: UserEvent = userEvent.setup({ delay: null });

    // Folded while nobody is named: open it, as a person would.
    await user.click(
      within(rolesSection()).getByTestId("folded-section-header"),
    );

    await pick(user, "Incident Commander", "Alice");
    await pick(user, "Responder", "Bob");

    // Handed up through the incident, incidents and criteria effects.
    await waitFor(() => {
      expect(savedRows(harness.latest())).toEqual([
        { roleId: COMMANDER_ID, userId: ALICE_ID },
        { roleId: RESPONDER_ID, userId: BOB_ID },
      ]);
    });

    // The rest of the rule is untouched.
    expect(harness.latest().data?.incidents?.[0]?.title).toBe(
      "Storefront is offline",
    );
    expect(harness.latest().data?.createIncidents).toBe(true);

    // And it survives the JSON the monitor is saved as.
    const saved: MonitorCriteriaInstance = MonitorCriteriaInstance.fromJSON(
      JSON.parse(JSON.stringify(harness.latest().toJSON())),
    );

    expect(savedRows(saved)).toEqual(savedRows(harness.latest()));
  });

  test("editing: a monitor read back from the API shows each person under their role, and a removal saves", async () => {
    const harness: Harness = await renderRule(
      MonitorCriteriaInstance.fromJSON(
        ruleJson([
          { roleId: RESPONDER_ID, userId: ALICE_ID },
          { roleId: COMMANDER_ID, userId: BOB_ID },
          { roleId: RESPONDER_ID, userId: BOB_ID },
        ]),
      ),
    );

    expect(
      within(rolesSection()).getByTestId("folded-section-header"),
    ).toHaveAttribute("aria-expanded", "true");
    expect(within(cardOf("Incident Commander")).getByText("Bob")).toBeTruthy();
    expect(within(cardOf("Responder")).getByText("Alice")).toBeTruthy();
    expect(within(cardOf("Responder")).getByText("Bob")).toBeTruthy();
    expect(screen.queryByText(/Multiple/)).toBeNull();

    const user: UserEvent = userEvent.setup({ delay: null });

    await user.click(
      within(cardOf("Responder")).getByRole("button", {
        name: "Remove Alice from Responder",
      }),
    );

    await waitFor(() => {
      expect(savedRows(harness.latest())).toEqual([
        { roleId: RESPONDER_ID, userId: BOB_ID },
        { roleId: COMMANDER_ID, userId: BOB_ID },
      ]);
    });
  });
});
