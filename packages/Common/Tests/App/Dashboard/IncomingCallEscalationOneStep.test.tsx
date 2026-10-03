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
import { MemoryRouter } from "react-router-dom";
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
 * ADDING AN INCOMING CALL ESCALATION RULE IS ONE SHORT STEP - on the real
 * Escalation Rules page of an incoming call policy, with only the network
 * stubbed.
 *
 * The dialog used to be a three-step wizard: Overview (Rule Name,
 * Description), Notification (a "Notify" dropdown, then an On-Call Schedule
 * or a User dropdown) and Escalation ("Escalate After (Seconds)"). Now:
 *
 *   - it is one page: Who to call, then Ring for (in seconds), then a folded
 *     Advanced section with the name and the description;
 *   - Who to call is one picker of on-call schedules and people that takes
 *     one pick, and the rule is saved with that pick in its own column -
 *     onCallDutyPolicyScheduleId or userId - as before;
 *   - the phone rings for 30 seconds unless changed, within Twilio's 5 to
 *     600;
 *   - the edit dialog is the same page, opened on the rule as it is;
 *   - each rule in the list shows who it calls and for how long, and a rule
 *     nobody named is shown after its place in the list, "Level 2".
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
      getProfilePictureRoute: (): string => {
        return "/picture";
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
const getItemMock: MockFunction = getJestMockFunction();
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
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
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
            return "0e300000-0000-4000-8000-000000000001";
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

import IncomingCallPolicyEscalationPage from "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/IncomingCallPolicy/Escalation";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import IncomingCallPolicyEscalationRule from "../../../Models/DatabaseModels/IncomingCallPolicyEscalationRule";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import Includes from "../../../Types/BaseDatabase/Includes";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { FormType } from "../../../UI/Components/Forms/ModelForm";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";

jest.setTimeout(30000);

const PROJECT_ID: string = "0e300000-0000-4000-8000-000000000001";
const POLICY_ID: string = "0e300000-0000-4000-8000-000000000002";

const RULE_ONE: string = "0e300000-0000-4000-8000-0000000000a1";
const RULE_TWO: string = "0e300000-0000-4000-8000-0000000000a2";

const USER_ALEX: string = "0e300000-0000-4000-8000-0000000000c1";
const USER_SAM: string = "0e300000-0000-4000-8000-0000000000c2";
const SCHEDULE_PRIMARY: string = "0e300000-0000-4000-8000-0000000000d1";

const PEOPLE: Record<string, { name: string; email: string }> = {
  [USER_ALEX]: { name: "Alex Chen", email: "alex@example.com" },
  [USER_SAM]: { name: "Sam Rivera", email: "sam@example.com" },
};

const pageProps: PageComponentProps = {
  hasPaymentMethod: true,
  currentProject: null,
} as unknown as PageComponentProps;

interface RuleRow {
  id: string;
  order: number;
  name?: string | undefined;
  description?: string | undefined;
  escalateAfterSeconds: number;
  userId?: string | undefined;
  scheduleId?: string | undefined;
}

// The page's rules, as the server lists them: in order.
let rules: Array<RuleRow> = [];

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

function user(id: string): User {
  const person: User = new User();
  person._id = id;
  person.name = new Name(PEOPLE[id]!.name);
  person.email = new Email(PEOPLE[id]!.email);
  return person;
}

function primary(): OnCallDutyPolicySchedule {
  const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
  schedule._id = SCHEDULE_PRIMARY;
  schedule.name = "Primary rotation";
  schedule.projectId = new ObjectID(PROJECT_ID);
  return schedule;
}

function toRule(row: RuleRow): IncomingCallPolicyEscalationRule {
  const rule: IncomingCallPolicyEscalationRule =
    new IncomingCallPolicyEscalationRule();
  rule._id = row.id;
  rule.order = row.order;
  rule.escalateAfterSeconds = row.escalateAfterSeconds;

  if (row.name !== undefined) {
    rule.name = row.name;
  }

  if (row.description !== undefined) {
    rule.description = row.description;
  }

  if (row.userId) {
    rule.userId = new ObjectID(row.userId);
    rule.user = user(row.userId);
  }

  if (row.scheduleId) {
    rule.onCallDutyPolicyScheduleId = new ObjectID(row.scheduleId);
    rule.onCallDutyPolicySchedule = primary();
  }

  return rule;
}

beforeEach(() => {
  permissionsForTest = [Permission.ProjectAdmin];
  PermissionGate.clearPermissionPropsCache();
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();
  window.history.replaceState(
    window.history.state,
    "",
    `/dashboard/${PROJECT_ID}/on-call-duty/incoming-call-policies/${POLICY_ID}/escalation`,
  );

  /*
   * Two rules: an unnamed one calling the primary rotation, then Sam,
   * named. Their order numbers have a gap where a deleted rule was: a level
   * is a rule's place in the list, not its number.
   */
  rules = [
    {
      id: RULE_ONE,
      order: 1,
      escalateAfterSeconds: 30,
      scheduleId: SCHEDULE_PRIMARY,
    },
    {
      id: RULE_TWO,
      order: 3,
      name: "Backup engineer",
      description: "Weekday cover",
      escalateAfterSeconds: 1,
      userId: USER_SAM,
    },
  ];

  getListMock.mockImplementation(async (params: any): Promise<any> => {
    const query: Record<string, unknown> = params.query || {};

    if (params.modelType === IncomingCallPolicyEscalationRule) {
      return list(rules.map(toRule));
    }

    // The Who to call picker's search list, and its look-ups by id.
    if (params.modelType === TeamMember) {
      return list(
        [USER_ALEX, USER_SAM]
          .filter((id: string): boolean => {
            return wanted(query["userId"], id);
          })
          .map((id: string): TeamMember => {
            const member: TeamMember = new TeamMember();
            member.user = user(id);
            return member;
          }),
      );
    }

    if (params.modelType === OnCallDutyPolicySchedule) {
      return list(wanted(query["_id"], SCHEDULE_PRIMARY) ? [primary()] : []);
    }

    return list([]);
  });

  getItemMock.mockImplementation(async (params: any): Promise<any> => {
    const row: RuleRow | undefined = rules.find((candidate: RuleRow) => {
      return candidate.id === params.id.toString();
    });

    return row ? toRule(row) : null;
  });

  createOrUpdateMock.mockImplementation(async (data: any): Promise<any> => {
    return { data: data.model };
  });
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  getItemMock.mockReset();
  createOrUpdateMock.mockReset();
  jest.restoreAllMocks();
});

// The rule cards, in the order they are listed.
async function renderPage(): Promise<Array<HTMLElement>> {
  // The schedules in the list link to their pages.
  render(
    <MemoryRouter>
      <IncomingCallPolicyEscalationPage {...pageProps} />
    </MemoryRouter>,
  );

  await waitFor(
    () => {
      expect(screen.getAllByTestId("row-actions")).toHaveLength(rules.length);
    },
    { timeout: 10000 },
  );

  return cards();
}

function cards(): Array<HTMLElement> {
  return screen
    .getAllByTestId("row-actions")
    .map((actions: HTMLElement): HTMLElement => {
      return actions.parentElement!.parentElement!;
    });
}

// A card's field, by its label: the text drawn under it.
function cardField(card: HTMLElement, label: string): string {
  const labelElement: HTMLElement = within(card).getByText(label);
  const field: HTMLElement = labelElement.closest(".group") as HTMLElement;

  return (field.textContent || "").replace(label, "").trim();
}

async function openAddDialog(): Promise<HTMLElement> {
  const button: HTMLElement = await waitFor((): HTMLElement => {
    const found: HTMLElement | undefined = screen
      .getAllByTestId("card-button")
      .find((candidate: HTMLElement): boolean => {
        return (candidate.textContent || "").includes("Add Escalation Rule");
      });

    if (!found) {
      throw new Error("No Add Escalation Rule button yet");
    }

    return found;
  });

  fireEvent.click(button);

  const modal: HTMLElement = await screen.findByTestId("modal");

  await within(modal).findByRole("button", { name: "Choose who to call" });

  // BasicForm fills in the fields' defaults in an effect of its own.
  await waitFor(() => {
    expect(ringInput(modal).value).toBe("30");
  });

  return modal;
}

async function openEditDialog(card: HTMLElement): Promise<HTMLElement> {
  const editButton: HTMLElement | null = within(card).queryByRole("button", {
    name: "Edit",
  });

  if (editButton) {
    fireEvent.click(editButton);
  } else {
    fireEvent.click(within(card).getByTestId("row-actions-more-button"));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Edit/ }));
  }

  const modal: HTMLElement = await screen.findByTestId("modal");

  // The rule as it is: its target is shown once it has been looked up.
  await waitFor(() => {
    expect(within(modal).getAllByTestId("people-chip")).toHaveLength(1);
  });

  return modal;
}

function ringInput(modal: HTMLElement): HTMLInputElement {
  return within(modal).getByPlaceholderText("30") as HTMLInputElement;
}

async function pick(modal: HTMLElement, name: string): Promise<void> {
  fireEvent.click(within(modal).getByTestId("people-picker-add-button"));

  const popup: HTMLElement = await screen.findByRole("dialog", {
    name: "Choose who to call",
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

  await waitFor(() => {
    expect(
      screen.queryByRole("dialog", { name: "Choose who to call" }),
    ).not.toBeInTheDocument();
  });
}

async function submit(modal: HTMLElement, buttonText: string): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(
      within(modal).getByRole("button", { name: buttonText, exact: true }),
    );
  });
}

function sentRequest(): any {
  return createOrUpdateMock.mock.calls[0]![0];
}

function idOf(value: unknown): string | null {
  return value === undefined || value === null ? null : String(value);
}

function chipIds(modal: HTMLElement): Array<string | null> {
  return within(modal)
    .queryAllByTestId("people-chip")
    .map((chip: HTMLElement): string | null => {
      return chip.getAttribute("data-id");
    });
}

function advancedHeader(modal: HTMLElement): HTMLElement {
  return within(modal).getByRole("button", { name: /^Advanced/ });
}

describe("the escalation rules list", () => {
  test("shows who each rule calls first, then how long it rings", async () => {
    const [first, second] = (await renderPage()) as [HTMLElement, HTMLElement];

    expect(cardField(first, "Who to call")).toContain("Primary rotation");
    expect(cardField(first, "Ring for")).toBe("30 seconds");

    expect(cardField(second, "Who to call")).toContain("Sam Rivera");
    expect(cardField(second, "Ring for")).toBe("1 second");
  });

  test("names a rule nobody named after its place in the list", async () => {
    const [first, second] = (await renderPage()) as [HTMLElement, HTMLElement];

    expect(cardField(first, "Name")).toBe("Level 1");
    // Its own name, and its description under it.
    expect(cardField(second, "Name")).toBe("Backup engineerWeekday cover");
  });

  test("counts levels by place, not by the order numbers' gaps", async () => {
    rules = [
      { ...rules[1]!, name: undefined, description: undefined, order: 7 },
      { ...rules[0]!, id: RULE_ONE, order: 9 },
    ];

    const [first, second] = (await renderPage()) as [HTMLElement, HTMLElement];

    expect(cardField(first, "Name")).toBe("Level 1");
    expect(cardField(second, "Name")).toBe("Level 2");
  });

  test("has no filter to set and no dropdown columns of its own", async () => {
    await renderPage();

    expect(screen.queryByText("On-Call Schedule")).not.toBeInTheDocument();
    expect(screen.queryByText("User")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Escalate After (seconds)"),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Filter/ })).toBeNull();
  });
});

describe("adding a rule", () => {
  test("is one step: no step list, no Next", async () => {
    await renderPage();
    const modal: HTMLElement = await openAddDialog();

    expect(
      within(modal).queryByRole("navigation", { name: "Progress" }),
    ).toBeNull();
    expect(within(modal).queryByRole("button", { name: "Next" })).toBeNull();
    expect(
      within(modal).getByRole("button", {
        name: "Add Escalation Rule",
        exact: true,
      }),
    ).toBeEnabled();
  });

  test("asks who to call and how long to ring, with 30 seconds filled in", async () => {
    await renderPage();
    const modal: HTMLElement = await openAddDialog();

    expect(within(modal).getByText("Who to call")).toBeInTheDocument();
    expect(
      within(modal).getByText("Ring for (in seconds)"),
    ).toBeInTheDocument();
    expect(ringInput(modal).value).toBe("30");

    // None of the old wizard's questions.
    for (const old of [
      "Rule Name",
      "Notify",
      "On-Call Schedule",
      "User",
      "Escalate After (Seconds)",
    ]) {
      expect(within(modal).queryByText(old)).toBeNull();
    }
  });

  test("folds the name and the description under Advanced, the name showing the level it will be", async () => {
    await renderPage();
    const modal: HTMLElement = await openAddDialog();

    expect(advancedHeader(modal)).toHaveAttribute("aria-expanded", "false");
    expect(advancedHeader(modal)).not.toHaveTextContent("Configured");

    // Two rules exist, so this one will be the third level.
    expect(within(modal).getByPlaceholderText("Level 3")).not.toBeVisible();
    expect(
      within(modal).getByPlaceholderText(
        "Describe who this rule calls and why.",
      ),
    ).not.toBeVisible();
  });

  test("saves the picked schedule in the rule's own column, ringing for 30 seconds", async () => {
    await renderPage();
    const modal: HTMLElement = await openAddDialog();

    await pick(modal, "Primary rotation");
    expect(chipIds(modal)).toEqual([SCHEDULE_PRIMARY]);

    await submit(modal, "Add Escalation Rule");

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const request: any = sentRequest();

    expect(request.formType).toBe(FormType.Create);
    expect(request.model).toBeInstanceOf(IncomingCallPolicyEscalationRule);
    expect(idOf(request.model.onCallDutyPolicyScheduleId)).toBe(
      SCHEDULE_PRIMARY,
    );
    expect(request.model.onCallDutyPolicyScheduleId).toBeInstanceOf(ObjectID);
    expect(request.model.userId).toBeUndefined();
    expect(Number(request.model.escalateAfterSeconds)).toBe(30);
    expect(idOf(request.model.incomingCallPolicyId)).toBe(POLICY_ID);
    expect(idOf(request.model.projectId)).toBe(PROJECT_ID);
    // Left unnamed, it is listed as its level; nothing is sent as a name.
    expect(request.model.name).toBeUndefined();
    expect(request.model.whoToCall).toBeUndefined();
    expect(request.miscDataProps).toEqual({});
  });

  test("a person picked after a schedule replaces it", async () => {
    await renderPage();
    const modal: HTMLElement = await openAddDialog();

    await pick(modal, "Primary rotation");
    await pick(modal, "Alex Chen");

    expect(chipIds(modal)).toEqual([USER_ALEX]);

    fireEvent.change(ringInput(modal), { target: { value: "20" } });

    await submit(modal, "Add Escalation Rule");

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const request: any = sentRequest();

    expect(idOf(request.model.userId)).toBe(USER_ALEX);
    expect(request.model.onCallDutyPolicyScheduleId).toBeUndefined();
    expect(Number(request.model.escalateAfterSeconds)).toBe(20);
  });

  test("lists the project's people to call, not only whoever is adding the rule", async () => {
    await renderPage();
    const modal: HTMLElement = await openAddDialog();

    fireEvent.click(within(modal).getByTestId("people-picker-add-button"));

    const popup: HTMLElement = await screen.findByRole("dialog", {
      name: "Choose who to call",
    });

    await waitFor(() => {
      expect(
        within(popup)
          .getAllByRole("option")
          .map((option: HTMLElement): string => {
            return option.getAttribute("data-id") || "";
          }),
      ).toEqual([SCHEDULE_PRIMARY, USER_ALEX, USER_SAM]);
    });

    // People come from the project's members, never the User list.
    const asked: Array<unknown> = getListMock.mock.calls.map(
      (call: Array<any>): unknown => {
        return call[0].modelType;
      },
    );

    expect(asked).toContain(TeamMember);
    expect(asked).not.toContain(User);
  });

  test("asks for whom to call before it saves", async () => {
    await renderPage();
    const modal: HTMLElement = await openAddDialog();

    await submit(modal, "Add Escalation Rule");

    expect(
      await within(modal).findByText(
        "Choose an on-call schedule or a person to call.",
      ),
    ).toBeInTheDocument();
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });

  test("keeps the ring time inside what Twilio takes", async () => {
    await renderPage();
    const modal: HTMLElement = await openAddDialog();

    await pick(modal, "Alex Chen");
    fireEvent.change(ringInput(modal), { target: { value: "601" } });

    await submit(modal, "Add Escalation Rule");

    expect(
      await within(modal).findByText(/should not be more than 600/),
    ).toBeInTheDocument();
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });

  test("keeps a name typed under Advanced", async () => {
    await renderPage();
    const modal: HTMLElement = await openAddDialog();

    await pick(modal, "Alex Chen");

    fireEvent.click(advancedHeader(modal));
    fireEvent.change(within(modal).getByPlaceholderText("Level 3"), {
      target: { value: "Support lead" },
    });

    await submit(modal, "Add Escalation Rule");

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    expect(sentRequest().model.name).toBe("Support lead");
  });
});

describe("editing a rule", () => {
  test("opens the same one step on the rule as it is", async () => {
    const [, second] = (await renderPage()) as [HTMLElement, HTMLElement];
    const modal: HTMLElement = await openEditDialog(second);

    expect(chipIds(modal)).toEqual([USER_SAM]);
    expect(
      within(modal).getByTestId("people-picker-add-button"),
    ).toHaveTextContent("Change");
    expect(ringInput(modal).value).toBe("1");
    expect(within(modal).queryByRole("button", { name: "Next" })).toBeNull();

    // Its own name is something of the user's, folded away.
    expect(advancedHeader(modal)).toHaveTextContent("Configured");
    // The second rule: unnamed, it would be listed as Level 2.
    expect(within(modal).getByPlaceholderText("Level 2")).toHaveValue(
      "Backup engineer",
    );

    // The rule's target columns are read, to show who it calls.
    const select: JSONObject = getItemMock.mock.calls[0]![0].select;

    expect(select["userId"]).toBe(true);
    expect(select["onCallDutyPolicyScheduleId"]).toBe(true);
  });

  test("a new pick of the other kind is saved, and the old one cleared", async () => {
    const [, second] = (await renderPage()) as [HTMLElement, HTMLElement];
    const modal: HTMLElement = await openEditDialog(second);

    await pick(modal, "Primary rotation");

    expect(chipIds(modal)).toEqual([SCHEDULE_PRIMARY]);

    fireEvent.change(ringInput(modal), { target: { value: "25" } });

    await submit(modal, "Save Changes");

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const request: any = sentRequest();

    expect(request.formType).toBe(FormType.Update);
    expect(idOf(request.model._id)).toBe(RULE_TWO);
    expect(idOf(request.model.onCallDutyPolicyScheduleId)).toBe(
      SCHEDULE_PRIMARY,
    );
    expect(idOf(request.model.userId)).toBeNull();
    expect(Number(request.model.escalateAfterSeconds)).toBe(25);
  });

  test("an edit of the ring time alone keeps whom the rule calls", async () => {
    const [first] = (await renderPage()) as [HTMLElement];
    const modal: HTMLElement = await openEditDialog(first);

    expect(chipIds(modal)).toEqual([SCHEDULE_PRIMARY]);
    // Unnamed, the first rule is Level 1, and nothing under Advanced is set.
    expect(within(modal).getByPlaceholderText("Level 1")).toHaveValue("");
    expect(advancedHeader(modal)).not.toHaveTextContent("Configured");

    fireEvent.change(ringInput(modal), { target: { value: "15" } });

    await submit(modal, "Save Changes");

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const request: any = sentRequest();

    expect(idOf(request.model.onCallDutyPolicyScheduleId)).toBe(
      SCHEDULE_PRIMARY,
    );
    expect(Array.isArray(request.model.onCallDutyPolicyScheduleId)).toBe(false);
    expect(idOf(request.model.userId)).toBeNull();
    expect(Number(request.model.escalateAfterSeconds)).toBe(15);
  });

  test("after an edit, adding a rule names it after the end of the list again", async () => {
    const [, second] = (await renderPage()) as [HTMLElement, HTMLElement];
    const editModal: HTMLElement = await openEditDialog(second);

    fireEvent.click(within(editModal).getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    });

    const modal: HTMLElement = await openAddDialog();

    expect(within(modal).getByPlaceholderText("Level 3")).toHaveValue("");
    expect(within(modal).queryAllByTestId("people-chip")).toEqual([]);
  });
});
