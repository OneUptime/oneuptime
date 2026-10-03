import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
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
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ADDING AN ESCALATION RULE IS ONE SHORT STEP - on the real escalation page,
 * with only the network stubbed.
 *
 * The dialog used to be a three-step wizard (a required name, three
 * dropdowns for who gets paged, an empty required wait). Now:
 *
 *   - it is one page: Notify, then Escalate after, then a folded Advanced
 *     section with the name and the description;
 *   - Notify is one picker of on-call schedules, teams and people, and the
 *     create request still carries the three lists the server turns into the
 *     rule's join rows;
 *   - the wait is 30 minutes unless changed;
 *   - the name is optional: left out, the server calls the rule "Level 3",
 *     which is what the name field's placeholder says;
 *   - the edit dialog is the same page, opened on the rule as it is, and
 *     saving it reconciles the join rows against the picker;
 *   - levels named after their place keep being so when levels move or one
 *     is deleted.
 */

const getMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const deleteItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();
const createMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the compiled
 * requires, so the consts above are still in their temporal dead zone when the
 * factory body runs. Dereferencing them lazily, at call time, is what works.
 */
jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: (...args: Array<any>) => {
        return getMock(...args);
      },
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: unknown) => {
        return error instanceof Error ? error.message : "Something went wrong";
      },
    },
  };
});

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
      deleteItem: (...args: Array<any>) => {
        return deleteItemMock(...args);
      },
      updateById: (...args: Array<any>) => {
        return updateByIdMock(...args);
      },
      create: (...args: Array<any>) => {
        return createMock(...args);
      },
      createOrUpdate: (...args: Array<any>) => {
        return createOrUpdateMock(...args);
      },
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

// A project owner, so the form shows every field it would in the product.
jest.mock("../../../UI/Utils/Permission", () => {
  const owner: () => Array<string> = (): Array<string> => {
    return ["ProjectOwner", "User", "Public"];
  };

  return {
    __esModule: true,
    default: {
      getAllPermissions: owner,
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<string> } => {
        return { globalPermissions: owner() };
      },
    },
  };
});

import EscalationRules from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/EscalationRule/EscalationRules";
import OnCallDutyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleSchedule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleTeam from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleUser from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Includes from "../../../Types/BaseDatabase/Includes";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import { FormType } from "../../../UI/Components/Forms/ModelForm";

jest.setTimeout(30000);

const PROJECT_ID: ObjectID = new ObjectID(
  "dddddddd-4444-4444-8444-444444444444",
);
const POLICY_ID: ObjectID = new ObjectID(
  "77777777-9999-4999-8999-999999999999",
);

const RULE_ONE_ID: string = "88888888-1010-4010-8010-101010101010";
const RULE_TWO_ID: string = "99999999-2020-4020-8020-202020202020";
const RULE_THREE_ID: string = "aaaaaaaa-3030-4030-8030-303030303030";

const USER_ALEX: string = "aaaaaaaa-1111-4111-8111-111111111111";
const USER_SAM: string = "bbbbbbbb-2222-4222-8222-222222222222";
const TEAM_PAYMENTS: string = "12121212-3030-4030-8030-303030303030";
const SCHEDULE_PRIMARY: string = "23232323-4040-4040-8040-404040404040";

const ALEX_JOIN_ID: string = "aaaaaaaa-0001-4001-8001-000000000001";
const SAM_JOIN_ID: string = "aaaaaaaa-0002-4002-8002-000000000002";
const PRIMARY_JOIN_ID: string = "aaaaaaaa-0003-4003-8003-000000000003";

interface RuleRow {
  id: string;
  name: string;
  escalateAfterInMinutes?: number | undefined;
  description?: string | undefined;
}

interface PageFixture {
  rules: Array<RuleRow>;
  // Who each rule notifies, by rule id.
  users?: Record<string, Array<{ joinId: string; userId: string }>>;
  schedules?: Record<string, Array<{ joinId: string; scheduleId: string }>>;
}

const PEOPLE: Record<string, { name: string; email: string }> = {
  [USER_ALEX]: { name: "Alex Chen", email: "alex@example.com" },
  [USER_SAM]: { name: "Sam Doe", email: "sam@example.com" },
};

function teamMember(userId: string): TeamMember {
  const user: User = new User();
  user._id = userId;
  user.name = new Name(PEOPLE[userId]!.name);
  user.email = new Email(PEOPLE[userId]!.email);

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

function list(data: Array<unknown>): JSONObject {
  return { data, count: data.length, skip: 0, limit: 50 } as JSONObject;
}

// The ids an Includes query asks for, or every id when it asks for none.
function wanted(value: unknown, id: string): boolean {
  return !(value instanceof Includes) || value.values.includes(id);
}

function servePage(fixture: PageFixture): void {
  window.history.replaceState(
    {},
    "",
    `/dashboard/${PROJECT_ID.toString()}/on-call-duty/policies/${POLICY_ID.toString()}/escalation`,
  );

  getItemMock.mockResolvedValue({
    repeatPolicyIfNoOneAcknowledges: false,
    repeatPolicyIfNoOneAcknowledgesNoOfTimes: 0,
  } as never);

  getListMock.mockImplementation(async (params: any): Promise<any> => {
    const query: Record<string, unknown> = params.query || {};

    // The page's own reads: the levels and who each one notifies.
    if (params.modelType === OnCallDutyEscalationRule) {
      return list(
        fixture.rules.map((rule: RuleRow, index: number) => {
          return {
            id: new ObjectID(rule.id),
            name: rule.name,
            description: rule.description,
            escalateAfterInMinutes: rule.escalateAfterInMinutes ?? 5,
            order: index + 1,
          };
        }),
      );
    }

    if (params.modelType === OnCallDutyPolicyEscalationRuleUser) {
      return list(
        Object.entries(fixture.users || {}).flatMap(
          ([ruleId, joins]: [string, Array<{ joinId: string; userId: string }>]) => {
            return joins.map((join: { joinId: string; userId: string }) => {
              return {
                id: new ObjectID(join.joinId),
                onCallDutyPolicyEscalationRuleId: new ObjectID(ruleId),
                user: {
                  id: new ObjectID(join.userId),
                  name: PEOPLE[join.userId]!.name,
                },
              };
            });
          },
        ),
      );
    }

    if (params.modelType === OnCallDutyPolicyEscalationRuleSchedule) {
      return list(
        Object.entries(fixture.schedules || {}).flatMap(
          ([ruleId, joins]: [
            string,
            Array<{ joinId: string; scheduleId: string }>,
          ]) => {
            return joins.map((join: { joinId: string; scheduleId: string }) => {
              return {
                id: new ObjectID(join.joinId),
                onCallDutyPolicyEscalationRuleId: new ObjectID(ruleId),
                onCallDutyPolicySchedule: {
                  id: new ObjectID(join.scheduleId),
                  name: "Primary rotation",
                  currentUserIdOnRoster: new ObjectID(USER_SAM),
                },
              };
            });
          },
        ),
      );
    }

    if (params.modelType === OnCallDutyPolicyEscalationRuleTeam) {
      return list([]);
    }

    // The Notify picker's search list, and its look-ups by id.
    if (params.modelType === TeamMember) {
      if (query["teamId"]) {
        return list([]);
      }

      return list(
        [USER_ALEX, USER_SAM]
          .filter((id: string): boolean => {
            return wanted(query["userId"], id);
          })
          .map(teamMember),
      );
    }

    if (params.modelType === Team) {
      return list(wanted(query["_id"], TEAM_PAYMENTS) ? [payments()] : []);
    }

    if (params.modelType === OnCallDutyPolicySchedule) {
      return list(wanted(query["_id"], SCHEDULE_PRIMARY) ? [primary()] : []);
    }

    return list([]);
  });

  // The policy's readiness: everybody can be paged.
  getMock.mockResolvedValue(
    new HTTPResponse<JSONObject>(
      200,
      {
        projectId: PROJECT_ID.toString(),
        onCallDutyPolicyId: POLICY_ID.toString(),
        isFallbackEnabled: true,
        isTruncated: false,
        totalCount: 0,
        hasMore: false,
        users: [],
      },
      {},
    ) as never,
  );

  createOrUpdateMock.mockImplementation(async (data: any): Promise<any> => {
    return { data: data.model };
  });
  updateByIdMock.mockResolvedValue({} as never);
  createMock.mockResolvedValue({} as never);
  deleteItemMock.mockResolvedValue({} as never);
}

async function renderPage(fixture: PageFixture): Promise<Array<HTMLElement>> {
  servePage(fixture);

  render(
    <EscalationRules onCallDutyPolicyId={POLICY_ID} projectId={PROJECT_ID} />,
  );

  if (fixture.rules.length === 0) {
    await screen.findByText("No escalation rules yet");
    return [];
  }

  await waitFor(() => {
    expect(screen.getAllByTestId("escalation-rule-card")).toHaveLength(
      fixture.rules.length,
    );
  });

  return screen.getAllByTestId("escalation-rule-card");
}

async function openAddDialog(): Promise<void> {
  fireEvent.click(
    screen.getAllByRole("button", { name: "Add Escalation Rule" })[0]!,
  );

  await screen.findByRole("button", { name: "Add responder" });

  // BasicForm opens its first step in a mount effect.
  await act(async (): Promise<void> => {});
}

async function openEditDialog(card: HTMLElement): Promise<void> {
  fireEvent.click(within(card).getByRole("button", { name: "Edit rule" }));

  await screen.findByRole("button", { name: "Add responder" });

  await act(async (): Promise<void> => {});
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

async function submit(buttonText: string): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(screen.getByRole("button", { name: buttonText }));
  });
}

function chipIds(): Array<string | null> {
  return screen
    .getAllByTestId("people-chip")
    .map((chip: HTMLElement): string | null => {
      return chip.getAttribute("data-id");
    });
}

function advancedHeader(): HTMLElement {
  return screen.getByRole("button", { name: /^Advanced/ });
}

function idOf(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

afterEach(() => {
  cleanup();
  for (const mock of [
    getMock,
    postMock,
    getListMock,
    getItemMock,
    deleteItemMock,
    updateByIdMock,
    createMock,
    createOrUpdateMock,
  ]) {
    mock.mockReset();
  }
  localStorage.clear();
  sessionStorage.clear();
});

const TWO_LEVELS: PageFixture = {
  rules: [
    { id: RULE_ONE_ID, name: "First Responders", escalateAfterInMinutes: 5 },
    { id: RULE_TWO_ID, name: "Backup", escalateAfterInMinutes: 10 },
  ],
  users: {
    [RULE_ONE_ID]: [{ joinId: ALEX_JOIN_ID, userId: USER_ALEX }],
    [RULE_TWO_ID]: [{ joinId: SAM_JOIN_ID, userId: USER_SAM }],
  },
  schedules: {
    [RULE_ONE_ID]: [{ joinId: PRIMARY_JOIN_ID, scheduleId: SCHEDULE_PRIMARY }],
  },
};

describe("adding an escalation rule", () => {
  test("is one step: no step list, no Next", async () => {
    await renderPage(TWO_LEVELS);
    await openAddDialog();

    expect(screen.queryByRole("navigation", { name: "Progress" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    expect(screen.getByRole("button", { name: "Create Rule" })).toBeEnabled();
  });

  test("asks who to notify and how long to wait, with 30 minutes filled in", async () => {
    await renderPage(TWO_LEVELS);
    await openAddDialog();

    expect(screen.getByText("Notify")).toBeInTheDocument();
    expect(screen.getByText("Escalate after (in minutes)")).toBeInTheDocument();

    const wait: HTMLInputElement = screen.getByPlaceholderText(
      "30",
    ) as HTMLInputElement;

    expect(wait.value).toBe("30");
  });

  test("folds the name and the description under Advanced, the name showing the level it will be", async () => {
    await renderPage(TWO_LEVELS);
    await openAddDialog();

    expect(advancedHeader()).toHaveAttribute("aria-expanded", "false");
    // A new rule has nothing of its own under Advanced yet.
    expect(advancedHeader()).not.toHaveTextContent("Configured");

    // Two rules exist, so this one will be the third level.
    const name: HTMLElement = screen.getByPlaceholderText("Level 3");

    expect(name).not.toBeVisible();
    expect(
      screen.getByPlaceholderText("Describe who this level notifies and why."),
    ).not.toBeVisible();

    fireEvent.click(advancedHeader());

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Level 3")).toBeVisible();
    });
  });

  test("the picker offers on-call schedules, teams and people in one list", async () => {
    await renderPage(TWO_LEVELS);
    await openAddDialog();

    fireEvent.click(screen.getByRole("button", { name: "Add responder" }));

    const popup: HTMLElement = await screen.findByRole("dialog", {
      name: "Add responder",
    });

    await waitFor(() => {
      expect(within(popup).getAllByRole("option").length).toBe(4);
    });

    const groups: Array<string> = within(popup)
      .getAllByRole("group")
      .map((group: HTMLElement): string => {
        return group.getAttribute("aria-labelledby")
          ? document.getElementById(group.getAttribute("aria-labelledby")!)
              ?.textContent || ""
          : "";
      });

    expect(groups).toEqual(["On-call schedules", "Teams", "People"]);
    expect(
      within(popup)
        .getAllByRole("option")
        .map((option: HTMLElement): string | null => {
          return option.getAttribute("data-kind");
        }),
    ).toEqual(["onCallSchedule", "team", "user", "user"]);
  });

  test("the picker writes all three responder types into the create request", async () => {
    await renderPage(TWO_LEVELS);
    await openAddDialog();

    await pick("Primary rotation");
    await pick("Payments");
    await pick("Alex Chen");

    await waitFor(() => {
      expect(chipIds()).toEqual([SCHEDULE_PRIMARY, TEAM_PAYMENTS, USER_ALEX]);
    });

    await submit("Create Rule");

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const request: any = createOrUpdateMock.mock.calls[0]![0];

    expect(request.formType).toBe(FormType.Create);
    expect(request.modelType).toBe(OnCallDutyEscalationRule);
    expect(request.miscDataProps).toEqual({
      onCallSchedules: [SCHEDULE_PRIMARY],
      teams: [TEAM_PAYMENTS],
      users: [USER_ALEX],
    });

    const model: OnCallDutyEscalationRule = request.model;

    expect(model.escalateAfterInMinutes).toBe(30);
    expect(idOf(model.onCallDutyPolicyId)).toBe(POLICY_ID.toString());
    expect(idOf(model.projectId)).toBe(PROJECT_ID.toString());
    // Left out, so the server names it after its level.
    expect(model.name).toBeUndefined();
    // The picker's own key is never sent.
    expect((model as any).notify).toBeUndefined();
    expect(request.miscDataProps).not.toHaveProperty("notify");
  });

  test("closes and reads the ladder again once the rule is created", async () => {
    await renderPage(TWO_LEVELS);
    await openAddDialog();
    await pick("Alex Chen");

    const ruleReads: () => number = (): number => {
      return getListMock.mock.calls.filter((call: Array<any>) => {
        return call[0]?.modelType === OnCallDutyEscalationRule;
      }).length;
    };
    const readsBefore: number = ruleReads();

    await submit("Create Rule");

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Create Rule" }),
      ).not.toBeInTheDocument();
    });

    await waitFor(() => {
      expect(ruleReads()).toBeGreaterThan(readsBefore);
    });
  });

  test("with nobody to notify, says what to do and sends nothing", async () => {
    await renderPage(TWO_LEVELS);
    await openAddDialog();

    await submit("Create Rule");

    expect(
      await screen.findByText(
        "Add at least one on-call schedule, team or person to notify.",
      ),
    ).toBeInTheDocument();
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });

  test("a name typed under Advanced is the name it is created with", async () => {
    await renderPage(TWO_LEVELS);
    await openAddDialog();

    fireEvent.click(advancedHeader());
    fireEvent.change(screen.getByPlaceholderText("Level 3"), {
      target: { value: "Night shift" },
    });
    fireEvent.change(
      screen.getByPlaceholderText("Describe who this level notifies and why."),
      { target: { value: "Paged after hours." } },
    );
    await pick("Sam Doe");

    await submit("Create Rule");

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const model: OnCallDutyEscalationRule =
      createOrUpdateMock.mock.calls[0]![0].model;

    expect(model.name).toBe("Night shift");
    expect(model.description).toBe("Paged after hours.");
  });

  test("a wait typed in is the wait it is created with", async () => {
    await renderPage(TWO_LEVELS);
    await openAddDialog();

    fireEvent.change(screen.getByPlaceholderText("30"), {
      target: { value: "5" },
    });
    await pick("Alex Chen");

    await submit("Create Rule");

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    expect(
      Number(createOrUpdateMock.mock.calls[0]![0].model.escalateAfterInMinutes),
    ).toBe(5);
  });

  test("the first rule of a policy is Level 1", async () => {
    await renderPage({ rules: [] });
    await openAddDialog();

    expect(screen.getByPlaceholderText("Level 1")).toBeInTheDocument();
  });
});

describe("editing an escalation rule", () => {
  test("is the same one step, opened on the rule as it is", async () => {
    const cards: Array<HTMLElement> = await renderPage(TWO_LEVELS);
    await openEditDialog(cards[0]!);

    expect(screen.queryByRole("navigation", { name: "Progress" })).toBeNull();

    // Its responders, schedules first: the order its card lists them in.
    await waitFor(() => {
      expect(chipIds()).toEqual([SCHEDULE_PRIMARY, USER_ALEX]);
    });

    expect((screen.getByPlaceholderText("30") as HTMLInputElement).value).toBe(
      "5",
    );
    expect(
      (screen.getByPlaceholderText("Level 1") as HTMLInputElement).value,
    ).toBe("First Responders");
    // A name somebody chose is something of theirs under Advanced.
    expect(advancedHeader()).toHaveTextContent("Configured");
    expect(advancedHeader()).toHaveAttribute("aria-expanded", "false");

    // Opened from what the page holds: the rule is not read again.
    expect(getItemMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ modelType: OnCallDutyEscalationRule }),
    );
  });

  test("a level named after its place has nothing of its own under Advanced", async () => {
    const cards: Array<HTMLElement> = await renderPage({
      rules: [{ id: RULE_ONE_ID, name: "Level 1" }],
      users: { [RULE_ONE_ID]: [{ joinId: ALEX_JOIN_ID, userId: USER_ALEX }] },
    });
    await openEditDialog(cards[0]!);

    expect(advancedHeader()).not.toHaveTextContent("Configured");
  });

  test("saving reconciles the rule's join rows with the picker", async () => {
    const cards: Array<HTMLElement> = await renderPage(TWO_LEVELS);
    await openEditDialog(cards[0]!);

    await waitFor(() => {
      expect(chipIds()).toEqual([SCHEDULE_PRIMARY, USER_ALEX]);
    });

    fireEvent.click(
      await screen.findByRole("button", { name: "Remove Alex Chen" }),
    );
    await pick("Payments");

    await waitFor(() => {
      expect(chipIds()).toEqual([SCHEDULE_PRIMARY, TEAM_PAYMENTS]);
    });

    await submit("Save Changes");

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
      expect(deleteItemMock).toHaveBeenCalledTimes(1);
    });

    // The rule's own columns, as an update of that rule.
    const update: any = createOrUpdateMock.mock.calls[0]![0];

    expect(update.formType).toBe(FormType.Update);
    expect(idOf(update.model._id)).toBe(RULE_ONE_ID);
    expect(update.model.name).toBe("First Responders");
    expect(Number(update.model.escalateAfterInMinutes)).toBe(5);
    // The picker's lists are reconciled below, not sent with the update.
    expect(update.miscDataProps).toEqual({});

    // The team that was added...
    const created: any = createMock.mock.calls[0]![0];

    expect(created.modelType).toBe(OnCallDutyPolicyEscalationRuleTeam);
    expect(idOf(created.model.teamId)).toBe(TEAM_PAYMENTS);
    expect(idOf(created.model.onCallDutyPolicyEscalationRuleId)).toBe(
      RULE_ONE_ID,
    );
    expect(idOf(created.model.onCallDutyPolicyId)).toBe(POLICY_ID.toString());

    // ...and the person who was taken away; the schedule stays.
    expect(deleteItemMock).toHaveBeenCalledWith({
      modelType: OnCallDutyPolicyEscalationRuleUser,
      id: new ObjectID(ALEX_JOIN_ID),
    });
  });

  test("an untouched save changes no join rows", async () => {
    const cards: Array<HTMLElement> = await renderPage(TWO_LEVELS);
    await openEditDialog(cards[1]!);

    await waitFor(() => {
      expect(chipIds()).toEqual([USER_SAM]);
    });

    await submit("Save Changes");

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    // The ladder is read again once the save has landed.
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Save Changes" }),
      ).not.toBeInTheDocument();
    });

    expect(createMock).not.toHaveBeenCalled();
    expect(deleteItemMock).not.toHaveBeenCalled();
    expect(createOrUpdateMock.mock.calls[0]![0].model.name).toBe("Backup");
  });

  test("a cleared name is saved as the level's name, as its placeholder said", async () => {
    const cards: Array<HTMLElement> = await renderPage(TWO_LEVELS);
    await openEditDialog(cards[1]!);

    fireEvent.click(advancedHeader());

    const name: HTMLInputElement = screen.getByPlaceholderText(
      "Level 2",
    ) as HTMLInputElement;

    expect(name.value).toBe("Backup");

    fireEvent.change(name, { target: { value: "" } });

    await submit("Save Changes");

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    expect(createOrUpdateMock.mock.calls[0]![0].model.name).toBe("Level 2");
  });

  test("removing every responder is refused: a level must page somebody", async () => {
    const cards: Array<HTMLElement> = await renderPage(TWO_LEVELS);
    await openEditDialog(cards[1]!);

    fireEvent.click(await screen.findByRole("button", { name: "Remove Sam Doe" }));

    await submit("Save Changes");

    expect(
      await screen.findByText(
        "Add at least one on-call schedule, team or person to notify.",
      ),
    ).toBeInTheDocument();
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });
});

describe("levels named after their place", () => {
  const DEFAULT_NAMED: PageFixture = {
    rules: [
      { id: RULE_ONE_ID, name: "Level 1" },
      { id: RULE_TWO_ID, name: "Level 2" },
      { id: RULE_THREE_ID, name: "Level 3" },
    ],
  };

  const openMenu: (card: HTMLElement) => HTMLElement = (
    card: HTMLElement,
  ): HTMLElement => {
    fireEvent.click(within(card).getByTestId("row-actions-more-button"));

    return screen.getByRole("menu");
  };

  type UpdateCall = { id: string; data: JSONObject };

  const updates: () => Array<UpdateCall> = (): Array<UpdateCall> => {
    return updateByIdMock.mock.calls.map((call: Array<any>): UpdateCall => {
      return { id: idOf(call[0].id), data: call[0].data };
    });
  };

  test("swap names when one moves up past the other", async () => {
    const cards: Array<HTMLElement> = await renderPage(DEFAULT_NAMED);

    fireEvent.click(
      within(openMenu(cards[2]!)).getByRole("menuitem", { name: "Move up" }),
    );

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(3);
    });

    expect(updates()).toEqual([
      { id: RULE_THREE_ID, data: { order: 2 } },
      { id: RULE_TWO_ID, data: { name: "Level 3" } },
      { id: RULE_THREE_ID, data: { name: "Level 2" } },
    ]);
  });

  test("swap names when one moves down", async () => {
    const cards: Array<HTMLElement> = await renderPage(DEFAULT_NAMED);

    fireEvent.click(
      within(openMenu(cards[0]!)).getByRole("menuitem", { name: "Move down" }),
    );

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(3);
    });

    expect(updates()).toEqual([
      { id: RULE_ONE_ID, data: { order: 2 } },
      { id: RULE_ONE_ID, data: { name: "Level 2" } },
      { id: RULE_TWO_ID, data: { name: "Level 1" } },
    ]);
  });

  test("a chosen name stays where it goes; only the level's names move", async () => {
    const cards: Array<HTMLElement> = await renderPage({
      rules: [
        { id: RULE_ONE_ID, name: "Level 1" },
        { id: RULE_TWO_ID, name: "Managers" },
      ],
    });

    fireEvent.click(
      within(openMenu(cards[1]!)).getByRole("menuitem", { name: "Move up" }),
    );

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(2);
    });

    expect(updates()).toEqual([
      { id: RULE_TWO_ID, data: { order: 1 } },
      { id: RULE_ONE_ID, data: { name: "Level 2" } },
    ]);
  });

  test("move up a place when the first level is deleted", async () => {
    const cards: Array<HTMLElement> = await renderPage(DEFAULT_NAMED);

    fireEvent.click(
      within(openMenu(cards[0]!)).getByRole("menuitem", {
        name: "Delete rule",
      }),
    );

    await screen.findByTestId("confirm-modal-description");

    fireEvent.click(screen.getByRole("button", { name: "Delete Rule" }));

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(2);
    });

    expect(deleteItemMock).toHaveBeenCalledWith({
      modelType: OnCallDutyEscalationRule,
      id: new ObjectID(RULE_ONE_ID),
    });
    expect(updates()).toEqual([
      { id: RULE_TWO_ID, data: { name: "Level 1" } },
      { id: RULE_THREE_ID, data: { name: "Level 2" } },
    ]);
  });

  test("deleting the last level renames nobody", async () => {
    const cards: Array<HTMLElement> = await renderPage(DEFAULT_NAMED);

    fireEvent.click(
      within(openMenu(cards[2]!)).getByRole("menuitem", {
        name: "Delete rule",
      }),
    );

    await screen.findByTestId("confirm-modal-description");

    fireEvent.click(screen.getByRole("button", { name: "Delete Rule" }));

    await waitFor(() => {
      expect(deleteItemMock).toHaveBeenCalledTimes(1);
    });

    await act(async (): Promise<void> => {});

    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("a level with no name at all is shown with its level's name", async () => {
    const cards: Array<HTMLElement> = await renderPage({
      rules: [
        { id: RULE_ONE_ID, name: "Primary" },
        { id: RULE_TWO_ID, name: "" },
      ],
    });

    expect(within(cards[1]!).getByRole("heading")).toHaveTextContent(
      "Level 2",
    );
    expect(within(cards[0]!).getByRole("heading")).toHaveTextContent(
      "Primary",
    );
  });
});
