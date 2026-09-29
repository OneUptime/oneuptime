import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
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
 * THE ESCALATION LEVEL'S ACTIONS: ONE BUTTON AND A ⋯ MENU.
 *
 * Every level card used to carry four bare icons - move up, move down, edit,
 * delete - side by side. It now carries "Edit rule" and a ⋯ menu holding the
 * rest, with Delete last and red. What is worth testing is what could quietly
 * go wrong in that move:
 *
 *   - the card really does show one button and the ⋯, and nothing else;
 *   - the menu is in a stable, learnable order, with the destructive action at
 *     the bottom behind a divider;
 *   - the arrows keep their old disabled states at the ends of the ladder, and
 *     a disabled arrow still does nothing when clicked;
 *   - picking a menu item acts on THE LEVEL WHOSE MENU IT IS - a menu portalled
 *     to the end of the document has no DOM relationship to its card left to
 *     get that right by accident;
 *   - the delete still goes through the counted confirmation, and a reorder
 *     still holds the card while it is in flight.
 */

const getMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const getCommonHeadersMock: MockFunction = getJestMockFunction();
const deleteItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

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
      getCommonHeaders: (...args: Array<any>) => {
        return getCommonHeadersMock(...args);
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

import EscalationRules from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/EscalationRule/EscalationRules";
import OnCallDutyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

jest.setTimeout(30000);

const PROJECT_ID: ObjectID = new ObjectID(
  "dddddddd-4444-4444-8444-444444444444",
);
const POLICY_ID: ObjectID = new ObjectID(
  "77777777-9999-4999-8999-999999999999",
);

const RULE_ONE_ID: ObjectID = new ObjectID(
  "88888888-1010-4010-8010-101010101010",
);
const RULE_TWO_ID: ObjectID = new ObjectID(
  "99999999-2020-4020-8020-202020202020",
);
const RULE_THREE_ID: ObjectID = new ObjectID(
  "aaaaaaaa-3030-4030-8030-303030303030",
);

const USER_ALEX: string = "aaaaaaaa-1111-4111-8111-111111111111";

interface RuleRow {
  id: ObjectID;
  name: string;
  escalateAfterInMinutes: number;
  order: number;
}

const FIRST_RESPONDERS: RuleRow = {
  id: RULE_ONE_ID,
  name: "First Responders",
  escalateAfterInMinutes: 5,
  order: 1,
};

const BACKUP: RuleRow = {
  id: RULE_TWO_ID,
  name: "Backup",
  escalateAfterInMinutes: 10,
  order: 2,
};

const MANAGERS: RuleRow = {
  id: RULE_THREE_ID,
  name: "Managers",
  escalateAfterInMinutes: 15,
  order: 3,
};

afterEach(() => {
  cleanup();
  getMock.mockReset();
  getListMock.mockReset();
  getItemMock.mockReset();
  getCommonHeadersMock.mockReset();
  deleteItemMock.mockReset();
  updateByIdMock.mockReset();
  localStorage.clear();
  sessionStorage.clear();
});

type MockPolicyFunction = (rules: Array<RuleRow>) => void;

/*
 * A policy with the given levels. Alex is on the first level only, which is
 * what lets the delete confirmation below tell one level's impact from
 * another's.
 */
const mockPolicy: MockPolicyFunction = (rules: Array<RuleRow>): void => {
  getCommonHeadersMock.mockReturnValue({});

  getItemMock.mockResolvedValue({
    repeatPolicyIfNoOneAcknowledges: false,
    repeatPolicyIfNoOneAcknowledgesNoOfTimes: 0,
  } as never);

  /*
   * Keyed on the SELECT rather than the model class, because the reads issue
   * the same query shape against the same policy and only their selects tell
   * them apart.
   */
  getListMock.mockImplementation((params: any): Promise<any> => {
    const select: Record<string, unknown> = params.select || {};

    if (select["escalateAfterInMinutes"]) {
      return Promise.resolve({
        data: rules.map((rule: RuleRow): RuleRow => {
          return { ...rule };
        }),
        count: rules.length,
        skip: 0,
        limit: 50,
      });
    }

    if (select["user"]) {
      return Promise.resolve({
        data: [
          {
            id: new ObjectID("aaaaaaaa-0001-4001-8001-000000000001"),
            onCallDutyPolicyEscalationRuleId: RULE_ONE_ID,
            user: { id: new ObjectID(USER_ALEX), name: "Alex Chen" },
          },
        ],
        count: 1,
        skip: 0,
        limit: 50,
      });
    }

    return Promise.resolve({ data: [], count: 0, skip: 0, limit: 50 });
  });

  // The policy readiness the page loads for its labels and chip dots.
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
};

type RenderPageFunction = (
  rules: Array<RuleRow>,
) => Promise<Array<HTMLElement>>;

// Renders the page and waits for one card per level.
const renderPage: RenderPageFunction = async (
  rules: Array<RuleRow>,
): Promise<Array<HTMLElement>> => {
  mockPolicy(rules);

  render(
    <EscalationRules onCallDutyPolicyId={POLICY_ID} projectId={PROJECT_ID} />,
  );

  await waitFor(() => {
    expect(screen.getAllByTestId("escalation-rule-card")).toHaveLength(
      rules.length,
    );
  });

  return screen.getAllByTestId("escalation-rule-card");
};

type OpenMenuFunction = (card: HTMLElement) => HTMLElement;

const openMenu: OpenMenuFunction = (card: HTMLElement): HTMLElement => {
  fireEvent.click(within(card).getByTestId("row-actions-more-button"));

  return screen.getByRole("menu");
};

type MenuItemFunction = (menu: HTMLElement, name: string) => HTMLElement;

const menuItem: MenuItemFunction = (
  menu: HTMLElement,
  name: string,
): HTMLElement => {
  return within(menu).getByRole("menuitem", { name: name });
};

const menuItemLabels: (menu: HTMLElement) => Array<string> = (
  menu: HTMLElement,
): Array<string> => {
  return within(menu)
    .getAllByRole("menuitem")
    .map((item: HTMLElement) => {
      return (item.textContent || "").trim();
    });
};

type ReloadCountFunction = () => number;

// How many times the page has read its levels.
const ruleReads: ReloadCountFunction = (): number => {
  return getListMock.mock.calls.filter((call: Array<any>) => {
    return Boolean(call[0]?.select?.["escalateAfterInMinutes"]);
  }).length;
};

describe("Escalation level actions: what the card shows", () => {
  test("each level shows Edit rule and a ⋯ trigger, and nothing else", async () => {
    const cards: Array<HTMLElement> = await renderPage([
      FIRST_RESPONDERS,
      BACKUP,
      MANAGERS,
    ]);

    for (const card of cards) {
      const actions: HTMLElement = within(card).getByTestId("row-actions");
      const buttons: Array<HTMLElement> =
        within(actions).getAllByRole("button");

      expect(buttons).toHaveLength(2);
      expect(
        within(actions).getByRole("button", { name: "Edit rule" }),
      ).toBeInTheDocument();
      expect(
        within(actions).getByTestId("row-actions-more-button"),
      ).toHaveAttribute("aria-label", "More actions");
    }

    // The three that moved into the menu are no longer anywhere on the page.
    for (const name of ["Move up", "Move down", "Delete rule"]) {
      expect(screen.queryByRole("button", { name: name })).toBeNull();
      expect(screen.queryByLabelText(name)).toBeNull();
    }

    // And the menu itself stays shut until somebody asks for it.
    expect(screen.queryByRole("menu")).toBeNull();
  });

  test("the actions sit at the right of the card header and do not shrink", async () => {
    const cards: Array<HTMLElement> = await renderPage([FIRST_RESPONDERS]);

    const actions: HTMLElement = within(cards[0]!).getByTestId("row-actions");

    expect(actions).toHaveClass("justify-end");
    expect(actions).toHaveClass("shrink-0");
  });
});

describe("Escalation level actions: the ⋯ menu", () => {
  test("lists Move up, Move down and then Delete rule, in that order", async () => {
    const cards: Array<HTMLElement> = await renderPage([
      FIRST_RESPONDERS,
      BACKUP,
      MANAGERS,
    ]);

    expect(menuItemLabels(openMenu(cards[1]!))).toEqual([
      "Move up",
      "Move down",
      "Delete rule",
    ]);
  });

  test("Delete rule is last, red, and set apart by a divider", async () => {
    const cards: Array<HTMLElement> = await renderPage([
      FIRST_RESPONDERS,
      BACKUP,
    ]);

    const menu: HTMLElement = openMenu(cards[0]!);
    const deleteItem: HTMLElement = menuItem(menu, "Delete rule");
    const children: Array<Element> = Array.from(menu.children);
    const deleteIndex: number = children.findIndex((child: Element) => {
      return child === deleteItem || child.contains(deleteItem);
    });

    expect(deleteIndex).toBe(children.length - 1);
    expect(children[deleteIndex - 1]).toHaveAttribute("role", "none");

    expect(deleteItem).toHaveClass("text-red-600");
    expect(menuItem(menu, "Move up")).not.toHaveClass("text-red-600");
    expect(menuItem(menu, "Move down")).not.toHaveClass("text-red-600");
  });

  test("the first level cannot move up, but can move down and be deleted", async () => {
    const cards: Array<HTMLElement> = await renderPage([
      FIRST_RESPONDERS,
      BACKUP,
      MANAGERS,
    ]);

    const menu: HTMLElement = openMenu(cards[0]!);

    expect(menuItem(menu, "Move up")).toBeDisabled();
    expect(menuItem(menu, "Move down")).toBeEnabled();
    expect(menuItem(menu, "Delete rule")).toBeEnabled();
  });

  test("a level in the middle can move either way", async () => {
    const cards: Array<HTMLElement> = await renderPage([
      FIRST_RESPONDERS,
      BACKUP,
      MANAGERS,
    ]);

    const menu: HTMLElement = openMenu(cards[1]!);

    expect(menuItem(menu, "Move up")).toBeEnabled();
    expect(menuItem(menu, "Move down")).toBeEnabled();
  });

  test("the last level cannot move down, but can move up", async () => {
    const cards: Array<HTMLElement> = await renderPage([
      FIRST_RESPONDERS,
      BACKUP,
      MANAGERS,
    ]);

    const menu: HTMLElement = openMenu(cards[2]!);

    expect(menuItem(menu, "Move up")).toBeEnabled();
    expect(menuItem(menu, "Move down")).toBeDisabled();
  });

  test("a lone level lists both arrows, disabled, rather than dropping them", async () => {
    const cards: Array<HTMLElement> = await renderPage([FIRST_RESPONDERS]);

    const menu: HTMLElement = openMenu(cards[0]!);

    expect(menuItemLabels(menu)).toEqual([
      "Move up",
      "Move down",
      "Delete rule",
    ]);
    expect(menuItem(menu, "Move up")).toBeDisabled();
    expect(menuItem(menu, "Move down")).toBeDisabled();
    expect(menuItem(menu, "Delete rule")).toBeEnabled();
  });

  test("a disabled arrow does nothing when clicked, and leaves the menu open", async () => {
    const cards: Array<HTMLElement> = await renderPage([
      FIRST_RESPONDERS,
      BACKUP,
    ]);

    const menu: HTMLElement = openMenu(cards[0]!);

    fireEvent.click(menuItem(menu, "Move up"));

    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });
});

describe("Escalation level actions: each acts on its own level", () => {
  test("Move down on the first level swaps it with the second", async () => {
    updateByIdMock.mockResolvedValue({} as never);

    const cards: Array<HTMLElement> = await renderPage([
      FIRST_RESPONDERS,
      BACKUP,
      MANAGERS,
    ]);
    const readsBefore: number = ruleReads();

    fireEvent.click(menuItem(openMenu(cards[0]!), "Move down"));

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    expect(updateByIdMock).toHaveBeenCalledWith({
      modelType: OnCallDutyEscalationRule,
      id: RULE_ONE_ID,
      data: { order: 2 },
    });

    // The menu closes behind the choice, and the ladder is read again.
    expect(screen.queryByRole("menu")).toBeNull();

    await waitFor(() => {
      expect(ruleReads()).toBeGreaterThan(readsBefore);
    });
  });

  test("Move up on the last level takes the order of the level above it", async () => {
    updateByIdMock.mockResolvedValue({} as never);

    const cards: Array<HTMLElement> = await renderPage([
      FIRST_RESPONDERS,
      BACKUP,
      MANAGERS,
    ]);

    fireEvent.click(menuItem(openMenu(cards[2]!), "Move up"));

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    expect(updateByIdMock).toHaveBeenCalledWith({
      modelType: OnCallDutyEscalationRule,
      id: RULE_THREE_ID,
      data: { order: 2 },
    });
  });

  test("a reorder holds its card - translucent and unclickable - until it lands", async () => {
    let finishUpdate: (value: unknown) => void = (): void => {};

    updateByIdMock.mockImplementation((): Promise<unknown> => {
      return new Promise((resolve: (value: unknown) => void) => {
        finishUpdate = resolve;
      });
    });

    const cards: Array<HTMLElement> = await renderPage([
      FIRST_RESPONDERS,
      BACKUP,
    ]);

    fireEvent.click(menuItem(openMenu(cards[1]!), "Move up"));

    await waitFor(() => {
      expect(cards[1]).toHaveClass("pointer-events-none");
    });

    expect(cards[1]).toHaveClass("opacity-60");
    // Only the level being moved is held; its neighbour stays usable.
    expect(cards[0]).not.toHaveClass("pointer-events-none");

    finishUpdate({});

    await waitFor(() => {
      expect(
        screen
          .getAllByTestId("escalation-rule-card")
          .every((card: HTMLElement) => {
            return !card.classList.contains("pointer-events-none");
          }),
      ).toBe(true);
    });
  });

  test("a failed reorder is reported rather than swallowed", async () => {
    updateByIdMock.mockRejectedValue(
      new Error("The order could not be saved.") as never,
    );

    const cards: Array<HTMLElement> = await renderPage([
      FIRST_RESPONDERS,
      BACKUP,
    ]);

    fireEvent.click(menuItem(openMenu(cards[0]!), "Move down"));

    await waitFor(() => {
      expect(
        screen.getByText("The order could not be saved."),
      ).toBeInTheDocument();
    });
  });

  test("Edit rule opens the edit modal for that level and no other", async () => {
    const cards: Array<HTMLElement> = await renderPage([
      FIRST_RESPONDERS,
      BACKUP,
    ]);

    fireEvent.click(
      within(cards[1]!).getByRole("button", { name: "Edit rule" }),
    );

    await waitFor(() => {
      expect(getItemMock).toHaveBeenCalledWith(
        expect.objectContaining({
          modelType: OnCallDutyEscalationRule,
          id: RULE_TWO_ID,
        }),
      );
    });

    expect(getItemMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        modelType: OnCallDutyEscalationRule,
        id: RULE_ONE_ID,
      }),
    );
    expect(screen.getAllByText("Edit Escalation Rule").length).toBeGreaterThan(
      0,
    );

    // The row button is not left spinning behind the modal it opened.
    expect(
      within(cards[1]!).getByRole("button", { name: "Edit rule" }),
    ).toBeEnabled();
  });

  test("Delete rule asks first, and names the level it came from", async () => {
    const cards: Array<HTMLElement> = await renderPage([
      FIRST_RESPONDERS,
      BACKUP,
    ]);

    fireEvent.click(menuItem(openMenu(cards[1]!), "Delete rule"));

    await waitFor(() => {
      expect(
        screen.getByTestId("confirm-modal-description"),
      ).toBeInTheDocument();
    });

    const description: string =
      screen.getByTestId("confirm-modal-description").textContent || "";

    expect(description).toContain('"Backup"');
    expect(description).not.toContain('"First Responders"');

    // Nothing is deleted on the menu click alone.
    expect(deleteItemMock).not.toHaveBeenCalled();
  });

  test("confirming the delete removes that level, and only that level", async () => {
    deleteItemMock.mockResolvedValue({} as never);

    const cards: Array<HTMLElement> = await renderPage([
      FIRST_RESPONDERS,
      BACKUP,
    ]);

    fireEvent.click(menuItem(openMenu(cards[1]!), "Delete rule"));

    await waitFor(() => {
      expect(
        screen.getByTestId("confirm-modal-description"),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete Rule" }));

    await waitFor(() => {
      expect(deleteItemMock).toHaveBeenCalledTimes(1);
    });

    expect(deleteItemMock).toHaveBeenCalledWith({
      modelType: OnCallDutyEscalationRule,
      id: RULE_TWO_ID,
    });
  });

  test("cancelling the delete leaves every level alone", async () => {
    const cards: Array<HTMLElement> = await renderPage([
      FIRST_RESPONDERS,
      BACKUP,
    ]);

    fireEvent.click(menuItem(openMenu(cards[0]!), "Delete rule"));

    await waitFor(() => {
      expect(
        screen.getByTestId("confirm-modal-description"),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(
        screen.queryByTestId("confirm-modal-description"),
      ).not.toBeInTheDocument();
    });

    expect(deleteItemMock).not.toHaveBeenCalled();
    expect(screen.getAllByTestId("escalation-rule-card")).toHaveLength(2);
  });
});
