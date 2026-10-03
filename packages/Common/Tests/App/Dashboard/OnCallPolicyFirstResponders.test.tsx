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
 * CREATE ON-CALL POLICY: A NEW POLICY PAGES SOMEONE FROM THE START - on the
 * real On-Call Policies page, with only the network stubbed.
 *
 * The form used to ask for a name, a description and labels, and the policy
 * it made paged nobody until its first escalation rule was added somewhere
 * else. Now:
 *
 *   - it asks Name and "Who gets paged first?" (the Notify picker of an
 *     escalation rule: on-call schedules, teams and people), optional, with
 *     the description and the labels folded under Advanced - three rows, no
 *     steps;
 *   - the picks go with the create request as misc data, under the keys a
 *     rule's own create takes, and the server makes them the first rule;
 *   - nobody picked sends nothing of the kind;
 *   - a user who may not add escalation rules is not asked;
 *   - the new policy opens on its Escalation Rules page.
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
const createOrUpdateMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * consts, so they are dereferenced at call time.
 */
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
      count: async (): Promise<number> => {
        return 0;
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
            return "0d000000-0000-4000-8000-000000000001";
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
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import Route from "../../../Types/API/Route";
import Includes from "../../../Types/BaseDatabase/Includes";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import Permission from "../../../Types/Permission";
import { FormType } from "../../../UI/Components/Forms/ModelForm";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import { getJestSpyOn } from "../../Spy";

jest.setTimeout(30000);

const PROJECT_ID: string = "0d000000-0000-4000-8000-000000000001";
const NEW_POLICY_ID: string = "0d000000-0000-4000-8000-000000000002";

const USER_ALEX: string = "0d000000-0000-4000-8000-0000000000c1";
const TEAM_PAYMENTS: string = "0d000000-0000-4000-8000-0000000000b1";
const SCHEDULE_PRIMARY: string = "0d000000-0000-4000-8000-0000000000a1";

const FIELD_TITLE: string = "Who gets paged first?";
const FIELD_DESCRIPTION: string =
  "Paged as soon as this policy is triggered. You can add more escalation levels later.";

const pageProps: PageComponentProps = {
  pageRoute: RouteMap[PageMap.ON_CALL_DUTY_POLICIES] as Route,
  hasPaymentMethod: true,
  currentProject: null,
} as unknown as PageComponentProps;

let navigateCalls: Array<string> = [];

function list(data: Array<unknown>): JSONObject {
  return { data, count: data.length, skip: 0, limit: 50 } as JSONObject;
}

// The ids an Includes query asks for, or every id when it asks for none.
function wanted(value: unknown, id: string): boolean {
  if (!(value instanceof Includes)) {
    return true;
  }

  return (value.values as Array<unknown>).some(
    (candidate: unknown): boolean => {
      return String(candidate) === id;
    },
  );
}

function alex(): TeamMember {
  const user: User = new User();
  user._id = USER_ALEX;
  user.name = new Name("Alex Chen");
  user.email = new Email("alex@example.com");

  const member: TeamMember = new TeamMember();
  member.user = user;
  return member;
}

function payments(): Team {
  const team: Team = new Team();
  team._id = TEAM_PAYMENTS;
  team.name = "Payments";
  return team;
}

function primary(): OnCallDutyPolicySchedule {
  const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
  schedule._id = SCHEDULE_PRIMARY;
  schedule.name = "Primary rotation";
  return schedule;
}

beforeEach(() => {
  permissionsForTest = [Permission.ProjectAdmin];
  navigateCalls = [];
  PermissionGate.clearPermissionPropsCache();
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();
  window.history.replaceState(
    window.history.state,
    "",
    `/dashboard/${PROJECT_ID}/on-call-duty/policies`,
  );

  getJestSpyOn(Navigation, "navigate").mockImplementation(
    (route: unknown): void => {
      navigateCalls.push(String(route));
    },
  );

  getListMock.mockImplementation(async (params: any): Promise<any> => {
    const query: Record<string, unknown> = params.query || {};

    // The Notify picker's search list, and its look-ups by id.
    if (params.modelType === TeamMember) {
      if (query["teamId"]) {
        return list([]);
      }

      return list(wanted(query["userId"], USER_ALEX) ? [alex()] : []);
    }

    if (params.modelType === Team) {
      return list(wanted(query["_id"], TEAM_PAYMENTS) ? [payments()] : []);
    }

    if (params.modelType === OnCallDutyPolicySchedule) {
      return list(wanted(query["_id"], SCHEDULE_PRIMARY) ? [primary()] : []);
    }

    // An empty project otherwise: no policies, no custom fields, no owners.
    return list([]);
  });

  // The server answers a create with the new policy.
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
  createOrUpdateMock.mockReset();
  jest.restoreAllMocks();
});

async function openCreateForm(): Promise<HTMLElement> {
  render(<OnCallDutyPoliciesPage {...pageProps} />);

  await screen.findByText("No on-call duty policies yet", {}, { timeout: 10000 });

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

  await within(modal).findByPlaceholderText("On-Call Duty Name");

  // BasicForm opens its first step in a mount effect.
  await act(async (): Promise<void> => {});

  return modal;
}

function typeName(modal: HTMLElement, name: string): void {
  fireEvent.change(within(modal).getByPlaceholderText("On-Call Duty Name"), {
    target: { value: name },
  });
}

async function pick(name: string): Promise<void> {
  const button: HTMLElement = await screen.findByRole("button", {
    name: "Add responder",
  });

  if (button.getAttribute("aria-expanded") !== "true") {
    fireEvent.click(button);
  }

  const popup: HTMLElement = await screen.findByRole("dialog", {
    name: "Add responder",
  });

  const option: HTMLElement = await waitFor((): HTMLElement => {
    const found: HTMLElement | undefined = within(popup)
      .getAllByRole("option")
      .find((candidate: HTMLElement): boolean => {
        return candidate.textContent?.includes(name) || false;
      });

    if (!found) {
      throw new Error(`No option ${name} yet`);
    }

    return found;
  });

  fireEvent.click(option);
}

async function submit(modal: HTMLElement): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(
      within(modal).getByRole("button", { name: "Create On-Call Policy" }),
    );
  });
}

function advancedHeader(modal: HTMLElement): HTMLElement {
  return within(modal).getByRole("button", { name: /^Advanced/ });
}

function chipIds(): Array<string | null> {
  return screen
    .queryAllByTestId("people-chip")
    .map((chip: HTMLElement): string | null => {
      return chip.getAttribute("data-id");
    });
}

function escalationRulesRoute(policyId: string): string {
  return (RouteMap[PageMap.ON_CALL_DUTY_POLICY_VIEW_ESCALATION] as Route)
    .toString()
    .replace(":projectId", PROJECT_ID)
    .replace(":id", policyId);
}

describe("the Create On-Call Policy form", () => {
  test("asks for a name and who gets paged first, in one step", async () => {
    const modal: HTMLElement = await openCreateForm();

    expect(within(modal).getByText("Name")).toBeInTheDocument();
    expect(within(modal).getByText(FIELD_TITLE)).toBeInTheDocument();
    expect(within(modal).getByText(FIELD_DESCRIPTION)).toBeInTheDocument();

    // Optional: the policy can still be made without anyone in it.
    expect(
      within(modal).getByText(FIELD_TITLE).closest("label")?.textContent,
    ).toContain("(Optional)");

    // One picker for schedules, teams and people.
    expect(
      within(modal).getByRole("button", { name: "Add responder" }),
    ).toBeInTheDocument();

    // No wizard.
    expect(
      within(modal).queryByRole("navigation", { name: "Progress" }),
    ).toBeNull();
    expect(within(modal).queryByRole("button", { name: "Next" })).toBeNull();
    expect(
      within(modal).getByRole("button", { name: "Create On-Call Policy" }),
    ).toBeEnabled();
  });

  test("folds the description and the labels under Advanced", async () => {
    const modal: HTMLElement = await openCreateForm();

    expect(advancedHeader(modal)).toHaveAttribute("aria-expanded", "false");
    expect(advancedHeader(modal)).not.toHaveTextContent("Configured");

    expect(within(modal).getByPlaceholderText("Description")).not.toBeVisible();
    expect(
      within(modal).getByText(
        "Team members with access to these labels will only be able to access this resource. This is optional and an advanced feature.",
      ),
    ).not.toBeVisible();

    fireEvent.click(advancedHeader(modal));

    expect(advancedHeader(modal)).toHaveAttribute("aria-expanded", "true");
    expect(within(modal).getByPlaceholderText("Description")).toBeVisible();
  });

  test("the picker offers on-call schedules, teams and people", async () => {
    await openCreateForm();

    await pick("Primary rotation");
    await pick("Payments");
    await pick("Alex Chen");

    await waitFor(() => {
      expect(chipIds()).toEqual([SCHEDULE_PRIMARY, TEAM_PAYMENTS, USER_ALEX]);
    });
  });
});

describe("creating the policy", () => {
  test("sends the picks as misc data, under the keys a rule's create takes", async () => {
    const modal: HTMLElement = await openCreateForm();

    typeName(modal, "Payments on-call");
    await pick("Primary rotation");
    await pick("Payments");
    await pick("Alex Chen");

    await submit(modal);

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const request: any = createOrUpdateMock.mock.calls[0]![0];

    expect(request.formType).toBe(FormType.Create);
    expect(request.modelType).toBe(OnCallDutyPolicy);
    expect(request.miscDataProps).toEqual({
      onCallSchedules: [SCHEDULE_PRIMARY],
      teams: [TEAM_PAYMENTS],
      users: [USER_ALEX],
    });

    const model: OnCallDutyPolicy = request.model;

    expect(model.name).toBe("Payments on-call");
    // The picker's own key, and its lists, are not columns of the policy.
    for (const key of ["notify", "onCallSchedules", "teams", "users"]) {
      expect((model as unknown as Record<string, unknown>)[key]).toBeUndefined();
    }
    expect(request.miscDataProps).not.toHaveProperty("notify");
  });

  test("with nobody picked, sends no responders and creates the policy as before", async () => {
    const modal: HTMLElement = await openCreateForm();

    typeName(modal, "Payments on-call");

    await submit(modal);

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const request: any = createOrUpdateMock.mock.calls[0]![0];

    expect(request.miscDataProps).toEqual({});
    expect(request.model.name).toBe("Payments on-call");
  });

  test("a pick taken back is sent as nobody", async () => {
    const modal: HTMLElement = await openCreateForm();

    typeName(modal, "Payments on-call");
    await pick("Payments");

    await waitFor(() => {
      expect(chipIds()).toEqual([TEAM_PAYMENTS]);
    });

    fireEvent.click(
      within(screen.getAllByTestId("people-chip")[0]!).getByRole("button"),
    );

    await waitFor(() => {
      expect(chipIds()).toEqual([]);
    });

    await submit(modal);

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const miscDataProps: JSONObject =
      createOrUpdateMock.mock.calls[0]![0].miscDataProps;

    for (const key of ["onCallSchedules", "teams", "users"]) {
      expect(
        (miscDataProps[key] as Array<string> | undefined) || [],
      ).toEqual([]);
    }
  });

  test("the description and labels typed under Advanced are saved with the policy", async () => {
    const modal: HTMLElement = await openCreateForm();

    typeName(modal, "Payments on-call");
    fireEvent.click(advancedHeader(modal));
    fireEvent.change(within(modal).getByPlaceholderText("Description"), {
      target: { value: "Pages the payments team." },
    });

    await submit(modal);

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    expect(createOrUpdateMock.mock.calls[0]![0].model.description).toBe(
      "Pages the payments team.",
    );
  });

  test("opens the new policy on its Escalation Rules page", async () => {
    const modal: HTMLElement = await openCreateForm();

    typeName(modal, "Payments on-call");
    await pick("Payments");

    await submit(modal);

    await waitFor(() => {
      expect(navigateCalls).toEqual([escalationRulesRoute(NEW_POLICY_ID)]);
    });

    expect(navigateCalls[0]).toBe(
      `/dashboard/${PROJECT_ID}/on-call-duty/policies/${NEW_POLICY_ID}/escalation`,
    );
  });

  test("opens it there with nobody picked too: adding the first rule is the next step", async () => {
    const modal: HTMLElement = await openCreateForm();

    typeName(modal, "Payments on-call");

    await submit(modal);

    await waitFor(() => {
      expect(navigateCalls).toEqual([escalationRulesRoute(NEW_POLICY_ID)]);
    });
  });

  test("a create that fails stays on the form and goes nowhere", async () => {
    createOrUpdateMock.mockImplementation(async (): Promise<never> => {
      throw new Error(
        "Some of the people picked to be paged first are not members of this project.",
      );
    });

    const modal: HTMLElement = await openCreateForm();

    typeName(modal, "Payments on-call");
    await pick("Alex Chen");

    await submit(modal);

    expect(
      await within(modal).findByText(
        "Some of the people picked to be paged first are not members of this project.",
      ),
    ).toBeInTheDocument();
    expect(navigateCalls).toEqual([]);
  });
});

describe("a user who may create policies but not escalation rules", () => {
  test("is not asked who gets paged first", async () => {
    permissionsForTest = [
      Permission.CreateProjectOnCallDutyPolicy,
      Permission.ReadProjectOnCallDutyPolicy,
    ];

    const modal: HTMLElement = await openCreateForm();

    expect(within(modal).queryByText(FIELD_TITLE)).toBeNull();
    expect(
      within(modal).queryByRole("button", { name: "Add responder" }),
    ).toBeNull();

    // The rest of the form is as for everyone.
    expect(within(modal).getByText("Name")).toBeInTheDocument();
    expect(advancedHeader(modal)).toBeInTheDocument();

    typeName(modal, "Payments on-call");
    await submit(modal);

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    expect(createOrUpdateMock.mock.calls[0]![0].miscDataProps).toEqual({});
  });
});
