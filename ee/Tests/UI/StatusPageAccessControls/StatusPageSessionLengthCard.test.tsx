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
import getJestMockFunction, { MockFunction } from "Common/Tests/MockType";
import { getJestSpyOn } from "Common/Tests/Spy";

/*
 * The Reader Sessions card on a status page's Security -> Access page: "Sign
 * readers out after", one pick that saves the moment it is made
 * (StatusPage.privateUserSessionLengthInHours, see
 * Common/Types/StatusPage/PrivateUserSessionLength).
 *
 * Only the network, the permission gate and the plan are stubbed; the card,
 * its dropdown (react-select) and its save-on-change hook are the real ones.
 */

const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
    },
  };
});

// A valid Enterprise license: nothing above the card, and it can be changed.
jest.mock(
  "../../../Dashboard/Identity/License/UseEnterpriseLicenseMode",
  () => {
    return {
      __esModule: true,
      default: (): string => {
        return "editable";
      },
    };
  },
);

import StatusPageSessionLengthCard from "../../../Dashboard/StatusPageAccessControls/StatusPageSessionLengthCard";
import StatusPageSessionLengthCopy, {
  getSessionLengthChoices,
  getSessionLengthDescription,
  STATUS_PAGE_SESSION_LENGTH_CARD_TEST_ID,
  STATUS_PAGE_SESSION_LENGTH_SETTING_TEST_ID,
} from "@oneuptime/dashboard/Components/StatusPage/StatusPageSessionLengthCopy";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import SubscriptionPlan, {
  PlanType,
} from "Common/Types/Billing/SubscriptionPlan";
import ObjectID from "Common/Types/ObjectID";
import { PRIVATE_USER_SESSION_LENGTH_CHOICES_IN_HOURS } from "Common/Types/StatusPage/PrivateUserSessionLength";
import PermissionGate, {
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";

const STATUS_PAGE_ID: string = "7c7c7c7c-0000-4000-8000-0000000000cc";

const PLAN_ORDER: Array<PlanType> = [
  PlanType.Free,
  PlanType.Growth,
  PlanType.Scale,
  PlanType.Enterprise,
];

// What the page holds: hours, null for no limit, or a failed read.
let stored: number | null | Error = null;
let isPageFound: boolean = true;
let gate: PermissionGateResult = { isAllowed: true };
let plan: PlanType | null = null;

beforeEach(() => {
  stored = null;
  isPageFound = true;
  gate = { isAllowed: true };
  plan = null;

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    if (stored instanceof Error) {
      throw stored;
    }

    if (!isPageFound) {
      return null;
    }

    const page: StatusPage = new StatusPage();
    page._id = STATUS_PAGE_ID;

    if (stored !== null) {
      page.privateUserSessionLengthInHours = stored;
    }

    return page;
  });

  updateByIdMock.mockReset();
  updateByIdMock.mockResolvedValue({} as never);

  getJestSpyOn(PermissionGate, "check").mockImplementation(
    (): PermissionGateResult => {
      return gate;
    },
  );

  getJestSpyOn(ProjectUtil, "getCurrentPlan").mockImplementation(
    (): PlanType | null => {
      return plan;
    },
  );

  getJestSpyOn(
    SubscriptionPlan,
    "isFeatureAccessibleOnCurrentPlan",
  ).mockImplementation((needed: unknown, current: unknown): boolean => {
    return (
      PLAN_ORDER.indexOf(current as PlanType) >=
      PLAN_ORDER.indexOf(needed as PlanType)
    );
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

async function renderCard(): Promise<void> {
  await act(async (): Promise<void> => {
    render(
      <StatusPageSessionLengthCard
        statusPageId={new ObjectID(STATUS_PAGE_ID)}
      />,
    );
  });
  await waitFor(() => {
    expect(getItemMock).toHaveBeenCalled();
  });
  await flush();
}

function row(): HTMLElement {
  return screen.getByTestId(
    `${STATUS_PAGE_SESSION_LENGTH_SETTING_TEST_ID}-row`,
  );
}

function box(): HTMLElement {
  return within(row()).getByRole("combobox", { hidden: true });
}

function shown(): string {
  return (
    row().querySelector(".ou-select__single-value")?.textContent ||
    row().querySelector(".ou-select__placeholder")?.textContent ||
    ""
  );
}

function description(): string {
  return (
    screen.getByTestId(
      `${STATUS_PAGE_SESSION_LENGTH_SETTING_TEST_ID}-description`,
    ).textContent || ""
  );
}

function offered(): Array<string> {
  fireEvent.keyDown(box(), { key: "ArrowDown", code: "ArrowDown" });

  const labels: Array<string> = screen
    .queryAllByRole("option")
    .map((option: HTMLElement): string => {
      return (option.textContent || "").trim();
    });

  fireEvent.keyDown(box(), { key: "Escape", code: "Escape" });

  return labels;
}

async function pick(label: string): Promise<void> {
  fireEvent.keyDown(box(), { key: "ArrowDown", code: "ArrowDown" });

  const option: HTMLElement = screen.getByRole("option", { name: label });

  fireEvent.mouseDown(option);
  fireEvent.click(option);
  await flush();
}

function writes(): Array<Record<string, unknown>> {
  return updateByIdMock.mock.calls.map(
    (call: Array<unknown>): Record<string, unknown> => {
      return (call[0] as { data: Record<string, unknown> }).data;
    },
  );
}

describe("the Reader Sessions card", () => {
  test("reads only its own column, of this status page", async () => {
    await renderCard();

    expect(getItemMock).toHaveBeenCalledTimes(1);

    const request: { id: ObjectID; select: Record<string, unknown> } =
      getItemMock.mock.calls[0]![0] as {
        id: ObjectID;
        select: Record<string, unknown>;
      };

    expect(request.id.toString()).toBe(STATUS_PAGE_ID);
    expect(request.select).toEqual({ privateUserSessionLengthInHours: true });
  });

  test("names itself and says what it is for", async () => {
    await renderCard();

    expect(
      screen.getByText(StatusPageSessionLengthCopy.cardTitle),
    ).toBeInTheDocument();
    expect(
      screen.getByText(StatusPageSessionLengthCopy.cardDescription),
    ).toBeInTheDocument();
    expect(
      within(row()).getByText(StatusPageSessionLengthCopy.label),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(STATUS_PAGE_SESSION_LENGTH_CARD_TEST_ID),
    ).toBeInTheDocument();
  });

  test("a page with no limit shows No limit, and that readers stay signed in while they come back", async () => {
    await renderCard();

    expect(shown()).toBe(StatusPageSessionLengthCopy.noLimit);
    expect(description()).toBe(StatusPageSessionLengthCopy.noLimitDescription);
  });

  test("a page with a limit shows it, and that readers sign in again", async () => {
    stored = 12;
    await renderCard();

    expect(shown()).toBe("12 hours");
    expect(description()).toBe(StatusPageSessionLengthCopy.limitDescription);
  });

  test("offers No limit first, then every length shortest first", async () => {
    await renderCard();

    expect(offered()).toEqual([
      "No limit",
      "1 hour",
      "4 hours",
      "8 hours",
      "12 hours",
      "1 day",
      "3 days",
      "7 days",
      "14 days",
      "30 days",
    ]);
    expect(offered()).toHaveLength(
      PRIVATE_USER_SESSION_LENGTH_CHOICES_IN_HOURS.length + 1,
    );
  });

  test("a length set through the API that the list does not offer is shown as it is stored", async () => {
    stored = 36;
    await renderCard();

    expect(shown()).toBe("36 hours");
    expect(offered()).toEqual([
      "No limit",
      "1 hour",
      "4 hours",
      "8 hours",
      "12 hours",
      "1 day",
      "36 hours",
      "3 days",
      "7 days",
      "14 days",
      "30 days",
    ]);
  });

  test("picking a length saves that column alone, at once, and says so", async () => {
    await renderCard();
    await pick("8 hours");

    expect(writes()).toEqual([{ privateUserSessionLengthInHours: 8 }]);
    expect(
      (updateByIdMock.mock.calls[0]![0] as { id: ObjectID }).id.toString(),
    ).toBe(STATUS_PAGE_ID);
    expect(shown()).toBe("8 hours");
    expect(description()).toBe(StatusPageSessionLengthCopy.limitDescription);

    await waitFor(() => {
      expect(
        screen.getByTestId(
          `${STATUS_PAGE_SESSION_LENGTH_SETTING_TEST_ID}-status`,
        ),
      ).toHaveTextContent("Saved");
    });
  });

  test("picking No limit saves nothing in the column, and the description follows", async () => {
    stored = 24;
    await renderCard();
    await pick("No limit");

    expect(writes()).toEqual([{ privateUserSessionLengthInHours: null }]);
    expect(description()).toBe(StatusPageSessionLengthCopy.noLimitDescription);
  });

  test("picking what the page already has sends nothing", async () => {
    stored = 12;
    await renderCard();
    await pick("12 hours");

    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("a pick the server refuses goes back to what the page has, with the reason", async () => {
    stored = 12;
    updateByIdMock.mockImplementation(async (): Promise<never> => {
      throw new Error(
        "Please upgrade your plan to Scale to access this feature",
      );
    });

    await renderCard();
    await pick("1 day");
    await flush();

    expect(shown()).toBe("12 hours");
    expect(
      screen.getByTestId(`${STATUS_PAGE_SESSION_LENGTH_SETTING_TEST_ID}-error`),
    ).toHaveTextContent("Please upgrade your plan to Scale");
    expect(description()).toBe(StatusPageSessionLengthCopy.limitDescription);
  });

  test("below the Scale plan, the plan it needs is named before anyone tries", async () => {
    plan = PlanType.Growth;
    await renderCard();

    expect(within(row()).getByText("Scale Plan")).toBeInTheDocument();
  });

  test("on Scale and above, no plan is named", async () => {
    for (const current of [PlanType.Scale, PlanType.Enterprise]) {
      plan = current;
      await renderCard();

      expect(within(row()).queryByText(/ Plan$/)).not.toBeInTheDocument();
      cleanup();
    }
  });

  test("someone who may not change the page sees it locked, and nothing is saved", async () => {
    gate = { isAllowed: false, disabledReason: "You need Edit Status Page." };
    await renderCard();

    const input: HTMLElement = box();
    expect(input).toBeDisabled();

    fireEvent.keyDown(input, { key: "ArrowDown", code: "ArrowDown" });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("a failed read says why and offers to try again", async () => {
    stored = new Error("Network is down");
    await renderCard();

    expect(screen.getByText("Network is down")).toBeInTheDocument();
    expect(
      screen.queryByTestId(`${STATUS_PAGE_SESSION_LENGTH_SETTING_TEST_ID}-row`),
    ).not.toBeInTheDocument();
  });

  test("a page that is not found says so", async () => {
    isPageFound = false;
    await renderCard();

    expect(screen.getByText("Status page not found.")).toBeInTheDocument();
  });
});

describe("the Reader Sessions card's copy", () => {
  test("every choice maps to the hours the column stores", () => {
    expect(
      getSessionLengthChoices(null).map((choice: { value: number }): number => {
        return choice.value;
      }),
    ).toEqual([0, ...PRIVATE_USER_SESSION_LENGTH_CHOICES_IN_HOURS]);
  });

  test("the description follows the setting", () => {
    expect(getSessionLengthDescription(null)).toBe(
      StatusPageSessionLengthCopy.noLimitDescription,
    );
    expect(getSessionLengthDescription(8)).toBe(
      StatusPageSessionLengthCopy.limitDescription,
    );
  });

  test("the no-limit sentence names the 30 days the server keeps a session for", () => {
    expect(StatusPageSessionLengthCopy.noLimitDescription).toContain("30 days");
  });
});
