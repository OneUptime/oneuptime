import "@testing-library/jest-dom";
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
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A NEW PROJECT'S FIRST ON-CALL POLICY PAGES FOR EVERY INCIDENT AND ALERT -
 * on the real On-Call Policies page, with only the network stubbed.
 *
 * A policy pages nobody until an on-call rule or a monitor names it, and a
 * new project has neither: the first policy someone made from the Home
 * checklist paged nobody. So, while the project has no on-call policy and
 * no on-call rule yet, Create On-Call Policy also asks "Page it for every
 * new incident and alert", on to start with, and sends the answer as misc
 * data the server turns into the two rules (EveryNewEventRules):
 *
 *   - offered only for the project's first policy, to someone who may add
 *     on-call rules, and only once the counts say so;
 *   - on, it asks for the rules; off, or not offered, nothing is sent - not
 *     even the switch's own "on" while it is hidden;
 *   - the project's counts are read only when the list comes back empty.
 */

let permissionsForTest: Array<string> = [];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<string> } => {
        return { globalPermissions: [...permissionsForTest] };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

const getListMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return {};
      },
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getItem: async (): Promise<null> => {
        return null;
      },
      count: (...args: Array<any>) => {
        return countMock(...args);
      },
      deleteItem: async (): Promise<void> => {
        return undefined;
      },
      updateById: async (): Promise<void> => {
        return undefined;
      },
      createOrUpdate: (...args: Array<any>) => {
        return createOrUpdateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): { toString: () => string } => {
        return {
          toString: (): string => {
            return "0e000000-0000-4000-8000-000000000001";
          },
        };
      },
      getCurrentProject: (): null => {
        return null;
      },
      getCurrentPlan: (): null => {
        return null;
      },
    },
  };
});

import OnCallDutyPoliciesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/OnCallDutyPolicies";
import {
  PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_DESCRIPTION,
  PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_TITLE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallPolicyCreateForm";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import AlertOnCallRule from "../../../Models/DatabaseModels/AlertOnCallRule";
import IncidentOnCallRule from "../../../Models/DatabaseModels/IncidentOnCallRule";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import { PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_KEY } from "../../../Types/OnCallDutyPolicy/EveryNewEventRules";
import Permission from "../../../Types/Permission";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import { getJestSpyOn } from "../../Spy";

jest.setTimeout(30000);

const PROJECT_ID: string = "0e000000-0000-4000-8000-000000000001";
const NEW_POLICY_ID: string = "0e000000-0000-4000-8000-000000000002";
const LISTED_POLICY_ID: string = "0e000000-0000-4000-8000-000000000003";

const pageProps: PageComponentProps = {
  pageRoute: RouteMap[PageMap.ON_CALL_DUTY_POLICIES] as Route,
  hasPaymentMethod: true,
  currentProject: null,
} as unknown as PageComponentProps;

function list(data: Array<unknown>): JSONObject {
  return { data, count: data.length, skip: 0, limit: 50 } as JSONObject;
}

interface ProjectState {
  // The policies the list shows (not archived).
  listedPolicies: number;
  // What ModelAPI.count answers, per model.
  policyCount: number;
  incidentRuleCount: number;
  alertRuleCount: number;
  failCounts: boolean;
}

let project: ProjectState;

function countedModels(): Array<string> {
  return countMock.mock.calls.map((call: Array<any>): string => {
    return (call[0] as { modelType: { name: string } }).modelType.name;
  });
}

beforeEach(() => {
  permissionsForTest = [Permission.ProjectAdmin];
  project = {
    listedPolicies: 0,
    policyCount: 0,
    incidentRuleCount: 0,
    alertRuleCount: 0,
    failCounts: false,
  };
  PermissionGate.clearPermissionPropsCache();
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();
  window.history.replaceState(
    window.history.state,
    "",
    `/dashboard/${PROJECT_ID}/on-call-duty/policies`,
  );

  getJestSpyOn(Navigation, "navigate").mockImplementation((): void => {
    return undefined;
  });

  getListMock.mockImplementation(async (params: any): Promise<any> => {
    if (params.modelType === OnCallDutyPolicy) {
      const policies: Array<OnCallDutyPolicy> = [];

      for (let index: number = 0; index < project.listedPolicies; index++) {
        const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
        policy._id = LISTED_POLICY_ID;
        policy.name = "Payments on-call";
        policies.push(policy);
      }

      return list(policies);
    }

    return list([]);
  });

  countMock.mockImplementation(async (params: any): Promise<number> => {
    if (project.failCounts) {
      throw new Error("The count could not be read.");
    }

    if (params.modelType === OnCallDutyPolicy) {
      return project.policyCount;
    }

    if (params.modelType === IncidentOnCallRule) {
      return project.incidentRuleCount;
    }

    if (params.modelType === AlertOnCallRule) {
      return project.alertRuleCount;
    }

    return 0;
  });

  createOrUpdateMock.mockImplementation(async (data: any): Promise<any> => {
    return {
      data: {
        _id: NEW_POLICY_ID,
        name: data.model.name,
      },
    };
  });
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  countMock.mockReset();
  createOrUpdateMock.mockReset();
  jest.restoreAllMocks();
});

async function openCreateForm(): Promise<HTMLElement> {
  render(<OnCallDutyPoliciesPage {...pageProps} />);

  // The list has come back, and with it, when empty, the project's counts.
  await waitFor(() => {
    expect(getListMock).toHaveBeenCalled();
  });
  await act(async (): Promise<void> => {
    await new Promise((resolve: (value: unknown) => void): void => {
      setTimeout(resolve, 20);
    });
  });

  const createButton: HTMLElement = await waitFor((): HTMLElement => {
    const button: HTMLElement | undefined = screen
      .getAllByTestId("card-button")
      .find((candidate: HTMLElement): boolean => {
        return (candidate.textContent || "").includes("Create On-Call Policy");
      });

    if (!button) {
      throw new Error("No Create On-Call Policy button yet");
    }

    return button;
  });

  fireEvent.click(createButton);

  const modal: HTMLElement = await screen.findByTestId("modal");

  await within(modal).findByPlaceholderText("e.g., Platform on-call");

  // BasicForm opens its first step in a mount effect.
  await act(async (): Promise<void> => {});

  return modal;
}

function switchIn(modal: HTMLElement): HTMLElement | null {
  return within(modal).queryByRole("switch", {
    name: PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_TITLE,
  });
}

async function createNamed(
  modal: HTMLElement,
  name: string,
): Promise<JSONObject> {
  fireEvent.change(
    within(modal).getByPlaceholderText("e.g., Platform on-call"),
    {
      target: { value: name },
    },
  );

  await act(async (): Promise<void> => {
    fireEvent.click(
      within(modal).getByRole("button", { name: "Create On-Call Policy" }),
    );
  });

  await waitFor(() => {
    expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
  });

  return createOrUpdateMock.mock.calls[0]![0].miscDataProps as JSONObject;
}

describe("a new project's first on-call policy", () => {
  test("is offered to be paged for every new incident and alert, on to start with", async () => {
    const modal: HTMLElement = await openCreateForm();

    const toggle: HTMLElement | null = switchIn(modal);

    expect(toggle).not.toBeNull();
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(
      within(modal).getByText(
        PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_DESCRIPTION,
      ),
    ).toBeInTheDocument();

    // Still one page: a step for one switch would be the longer way.
    expect(
      within(modal).queryByRole("navigation", { name: "Progress" }),
    ).toBeNull();
    expect(within(modal).queryByRole("button", { name: "Next" })).toBeNull();
  });

  test("sends the ask for the two rules with the create", async () => {
    const modal: HTMLElement = await openCreateForm();

    const miscDataProps: JSONObject = await createNamed(
      modal,
      "Payments on-call",
    );

    expect(miscDataProps).toEqual({
      [PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_KEY]: true,
    });

    // The switch is not a column of the policy.
    expect(
      (createOrUpdateMock.mock.calls[0]![0].model as unknown as JSONObject)[
        PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_KEY
      ],
    ).toBeUndefined();
  });

  test("switched off, asks for nothing", async () => {
    const modal: HTMLElement = await openCreateForm();

    fireEvent.click(switchIn(modal)!);

    await waitFor(() => {
      expect(switchIn(modal)).toHaveAttribute("aria-checked", "false");
    });

    expect(await createNamed(modal, "Payments on-call")).toEqual({});
  });

  test("the project is counted once its empty list is back: its policies, archived ones too, and both kinds of rules", async () => {
    await openCreateForm();

    expect(countedModels().sort()).toEqual(
      ["AlertOnCallRule", "IncidentOnCallRule", "OnCallDutyPolicy"].sort(),
    );

    for (const call of countMock.mock.calls) {
      const query: JSONObject = (call[0] as { query: JSONObject }).query;

      // The whole project: no isArchived filter, so an archived policy counts.
      expect(Object.keys(query)).toEqual(["projectId"]);
      expect(String(query["projectId"])).toBe(PROJECT_ID);
    }
  });
});

describe("a project that is not new", () => {
  test("with a policy in the list: nothing is counted, nothing offered, nothing sent", async () => {
    project.listedPolicies = 1;
    project.policyCount = 1;

    const modal: HTMLElement = await openCreateForm();

    expect(countMock).not.toHaveBeenCalled();
    expect(switchIn(modal)).toBeNull();

    /*
     * The hidden switch still holds its "on": the page drops it from the
     * request (UseEveryNewEventRulesOffer.prepareCreate).
     */
    expect(await createNamed(modal, "Search on-call")).toEqual({});
  });

  test("with only an archived policy", async () => {
    project.policyCount = 1;

    const modal: HTMLElement = await openCreateForm();

    expect(switchIn(modal)).toBeNull();
    expect(await createNamed(modal, "Search on-call")).toEqual({});
  });

  test("with an incident on-call rule", async () => {
    project.incidentRuleCount = 1;

    const modal: HTMLElement = await openCreateForm();

    expect(switchIn(modal)).toBeNull();
    expect(await createNamed(modal, "Search on-call")).toEqual({});
  });

  test("with an alert on-call rule", async () => {
    project.alertRuleCount = 2;

    const modal: HTMLElement = await openCreateForm();

    expect(switchIn(modal)).toBeNull();
    expect(await createNamed(modal, "Search on-call")).toEqual({});
  });
});

describe("when the answer is not known, or not theirs to give", () => {
  test("a count that fails offers nothing", async () => {
    project.failCounts = true;

    const modal: HTMLElement = await openCreateForm();

    expect(switchIn(modal)).toBeNull();
    expect(await createNamed(modal, "Payments on-call")).toEqual({});
  });

  test("someone who may create policies but not on-call rules is not asked", async () => {
    permissionsForTest = [
      Permission.CreateProjectOnCallDutyPolicy,
      Permission.ReadProjectOnCallDutyPolicy,
    ];

    const modal: HTMLElement = await openCreateForm();

    expect(switchIn(modal)).toBeNull();
    expect(await createNamed(modal, "Payments on-call")).toEqual({});
  });

  test("someone who may add incident rules but not alert rules is not asked either", async () => {
    permissionsForTest = [
      Permission.CreateProjectOnCallDutyPolicy,
      Permission.ReadProjectOnCallDutyPolicy,
      Permission.CreateIncidentOnCallRule,
    ];

    const modal: HTMLElement = await openCreateForm();

    expect(switchIn(modal)).toBeNull();
  });
});
