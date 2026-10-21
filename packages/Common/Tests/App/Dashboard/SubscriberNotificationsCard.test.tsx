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
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * The Notifications card on a status page's Subscriber Settings: Send
 * Notifications to Subscribers, the one switch for everything the page
 * tells its subscribers (StatusPage.sendSubscriberNotifications, see
 * Common/Types/StatusPage/SubscriberNotificationsSwitch). It saves the
 * moment it is flipped, and says what each way means.
 *
 * Only the network and the permission gate are stubbed; the card, its row
 * and the switch are the real ones.
 */

const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
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

import SubscriberNotificationsCard from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/SubscriberNotificationsCard";
import SubscriberNotificationsCopy, {
  SUBSCRIBER_NOTIFICATIONS_CARD_TEST_ID,
  SUBSCRIBER_NOTIFICATIONS_SWITCH_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/SubscriberNotificationsCopy";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import ObjectID from "../../../Types/ObjectID";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";

const STATUS_PAGE_ID: string = "6b6b6b6b-0000-4000-8000-0000000000bb";

// What the page holds: true, false, not read (undefined), or a failed read.
let stored: boolean | undefined | Error = true;
let isPageFound: boolean = true;
let gate: PermissionGateResult = { isAllowed: true };
let onSaved: MockFunction;

beforeEach(() => {
  stored = true;
  isPageFound = true;
  gate = { isAllowed: true };
  onSaved = getJestMockFunction();

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

    if (stored !== undefined) {
      page.sendSubscriberNotifications = stored;
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
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderCard(): Promise<void> {
  await act(async (): Promise<void> => {
    render(
      <SubscriberNotificationsCard
        statusPageId={new ObjectID(STATUS_PAGE_ID)}
        onSaved={(isOn: boolean) => {
          onSaved(isOn);
        }}
      />,
    );
  });

  await waitFor(() => {
    expect(getItemMock).toHaveBeenCalled();
  });
}

async function theSwitch(): Promise<HTMLElement> {
  return await screen.findByTestId(SUBSCRIBER_NOTIFICATIONS_SWITCH_TEST_ID);
}

function row(): HTMLElement {
  return screen.getByTestId(`${SUBSCRIBER_NOTIFICATIONS_SWITCH_TEST_ID}-row`);
}

describe("reading the status page", () => {
  test("asks for the one column and nothing else", async () => {
    await renderCard();
    await theSwitch();

    const request: Record<string, unknown> = getItemMock.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(request["modelType"]).toBe(StatusPage);
    expect((request["id"] as ObjectID).toString()).toBe(STATUS_PAGE_ID);
    expect(request["select"]).toEqual({ sendSubscriberNotifications: true });
  });

  test("is the Notifications card, saying what it is for", async () => {
    await renderCard();
    await theSwitch();

    const card: HTMLElement = screen.getByTestId(
      SUBSCRIBER_NOTIFICATIONS_CARD_TEST_ID,
    );
    expect(card).toBeInTheDocument();
    expect(
      screen.getByText(SubscriberNotificationsCopy.cardTitle),
    ).toBeInTheDocument();
    expect(
      screen.getByText(SubscriberNotificationsCopy.cardDescription),
    ).toBeInTheDocument();
  });

  test("the switch is named for what it does", async () => {
    await renderCard();

    expect(
      screen.getByRole("switch", {
        name: SubscriberNotificationsCopy.switchTitle,
      }),
    ).toBe(await theSwitch());
  });

  test("on: says subscribers are told, each on their channel", async () => {
    await renderCard();

    expect(await theSwitch()).toHaveAttribute("aria-checked", "true");
    expect(
      within(row()).getByText(SubscriberNotificationsCopy.switchOnDescription),
    ).toBeInTheDocument();
  });

  test("off: says the page sends its subscribers nothing, and keeps them", async () => {
    stored = false;
    await renderCard();

    expect(await theSwitch()).toHaveAttribute("aria-checked", "false");
    expect(
      within(row()).getByText(SubscriberNotificationsCopy.switchOffDescription),
    ).toBeInTheDocument();
  });

  test("a page that has never had the switch reads as on", async () => {
    stored = undefined;
    await renderCard();

    expect(await theSwitch()).toHaveAttribute("aria-checked", "true");
  });

  test("a read that fails says why, and can be tried again", async () => {
    stored = new Error("Network down");
    await renderCard();

    expect(await screen.findByText("Network down")).toBeInTheDocument();
    expect(
      screen.queryByTestId(SUBSCRIBER_NOTIFICATIONS_SWITCH_TEST_ID),
    ).not.toBeInTheDocument();

    stored = true;
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));

    expect(await theSwitch()).toHaveAttribute("aria-checked", "true");
  });

  test("a page that is not there says so", async () => {
    isPageFound = false;
    await renderCard();

    expect(
      await screen.findByText("Status page not found."),
    ).toBeInTheDocument();
  });
});

describe("flipping the switch", () => {
  test("off saves at once, says what off means and tells the page", async () => {
    await renderCard();
    fireEvent.click(await theSwitch());

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    const request: Record<string, unknown> = updateByIdMock.mock
      .calls[0]![0] as Record<string, unknown>;
    expect(request["modelType"]).toBe(StatusPage);
    expect((request["id"] as ObjectID).toString()).toBe(STATUS_PAGE_ID);
    expect(request["data"]).toEqual({ sendSubscriberNotifications: false });

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith(false);
    });
    expect(await theSwitch()).toHaveAttribute("aria-checked", "false");
    expect(
      within(row()).getByText(SubscriberNotificationsCopy.switchOffDescription),
    ).toBeInTheDocument();
  });

  test("back on saves true", async () => {
    stored = false;
    await renderCard();
    fireEvent.click(await theSwitch());

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith(true);
    });
    expect(
      (updateByIdMock.mock.calls[0]![0] as Record<string, unknown>)["data"],
    ).toEqual({ sendSubscriberNotifications: true });
  });

  test("a change the server refuses moves it back, with the reason", async () => {
    updateByIdMock.mockImplementation(async (): Promise<never> => {
      throw new Error("You may not change this status page.");
    });

    await renderCard();
    fireEvent.click(await theSwitch());

    expect(
      await screen.findByText("You may not change this status page."),
    ).toBeInTheDocument();
    // The reason and the switch moving back can land on separate renders.
    await waitFor(async () => {
      expect(await theSwitch()).toHaveAttribute("aria-checked", "true");
    });
    expect(onSaved).not.toHaveBeenCalled();
  });

  test("someone who may not edit the page sees it locked", async () => {
    gate = {
      isAllowed: false,
      disabledReason: "You need the Edit Status Page permission.",
    };
    await renderCard();

    const element: HTMLElement = await theSwitch();
    expect(element).toHaveAttribute("aria-disabled", "true");

    await act(async () => {
      fireEvent.click(element);
    });
    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(element).toHaveAttribute("aria-checked", "true");
  });
});
