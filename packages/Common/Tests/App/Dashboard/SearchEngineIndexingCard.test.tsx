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
 * Search Engine Indexing, on a status page's Branding page: one switch that
 * saves the moment it is flipped. It used to be a card whose Edit dialog held
 * that one toggle. Off, the page stays reachable by link and is served with
 * noindex, nofollow.
 *
 * Only the network, the permission gate and the plan are stubbed; the card,
 * its row and the switch are the real ones.
 */

/*
 * A refused request is an async function that throws, not
 * mockRejectedValue: the card's imports load zone.js, whose patched Promise
 * reports a rejected one as unhandled although the card catches it.
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

import SearchEngineIndexingCard, {
  SEARCH_ENGINE_INDEXING_CARD_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/SearchEngineIndexingCard";
import StatusPageBrandingCopy, {
  SEARCH_ENGINE_INDEXING_SWITCH_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageBrandingCopy";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import ObjectID from "../../../Types/ObjectID";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";

const STATUS_PAGE_ID: string = "5a5a5a5a-0000-4000-8000-0000000000bb";

// What the status page holds: the column, nothing, or a failed read.
let stored: { enableSearchEngineIndexing?: boolean } | null | Error = null;
let gate: PermissionGateResult = { isAllowed: true };
let plan: PlanType | null = null;
let changes: Array<boolean> = [];

beforeEach(() => {
  stored = { enableSearchEngineIndexing: true };
  gate = { isAllowed: true };
  plan = null;
  changes = [];

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    if (stored instanceof Error) {
      throw stored;
    }

    if (!stored) {
      return null;
    }

    const page: StatusPage = new StatusPage();
    page._id = STATUS_PAGE_ID;

    if (stored.enableSearchEngineIndexing !== undefined) {
      page.enableSearchEngineIndexing = stored.enableSearchEngineIndexing;
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
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderCard(): Promise<void> {
  await act(async (): Promise<void> => {
    render(
      <SearchEngineIndexingCard
        statusPageId={new ObjectID(STATUS_PAGE_ID)}
        onChange={(isOn: boolean): void => {
          changes.push(isOn);
        }}
      />,
    );
  });

  await waitFor(() => {
    expect(getItemMock).toHaveBeenCalled();
  });
}

async function loaded(): Promise<void> {
  await waitFor(() => {
    expect(screen.getAllByRole("switch")).toHaveLength(1);
  });
}

function theSwitch(): HTMLElement {
  return screen.getByTestId(SEARCH_ENGINE_INDEXING_SWITCH_TEST_ID);
}

function theRow(): HTMLElement {
  return screen.getByTestId(`${SEARCH_ENGINE_INDEXING_SWITCH_TEST_ID}-row`);
}

describe("reading the status page", () => {
  test("asks for this page's search engine indexing column and nothing else", async () => {
    await renderCard();
    await loaded();

    expect(getItemMock).toHaveBeenCalledTimes(1);

    const request: Record<string, unknown> = getItemMock.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(request["modelType"]).toBe(StatusPage);
    expect((request["id"] as ObjectID).toString()).toBe(STATUS_PAGE_ID);
    expect(request["select"]).toEqual({ enableSearchEngineIndexing: true });
  });

  test("is the Search Engine Indexing card, saying what it is for", async () => {
    await renderCard();
    await loaded();

    const card: HTMLElement = screen.getByTestId(
      SEARCH_ENGINE_INDEXING_CARD_TEST_ID,
    );

    expect(card).toBeInTheDocument();
    expect(
      screen.getByText(StatusPageBrandingCopy.searchEngineIndexingTitle),
    ).toBeInTheDocument();
    expect(
      screen.getByText(StatusPageBrandingCopy.searchEngineIndexingDescription),
    ).toBeInTheDocument();
  });

  test("is one switch, named for what it allows, with what turning it off does under it", async () => {
    await renderCard();
    await loaded();

    expect(
      screen.getByRole("switch", {
        name: StatusPageBrandingCopy.searchEngineIndexingSwitchTitle,
      }),
    ).toBe(theSwitch());
    expect(
      within(theRow()).getByText(
        StatusPageBrandingCopy.searchEngineIndexingSwitchDescription,
      ),
    ).toBeInTheDocument();
    // No Edit button and no dialog: the switch is the control.
    expect(screen.queryByRole("button", { name: /edit/i })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("a page search engines may list shows the switch on, and says so", async () => {
    await renderCard();
    await loaded();

    expect(theSwitch()).toHaveAttribute("aria-checked", "true");
    expect(changes).toEqual([true]);
  });

  test("a page kept out of search results shows it off, and says so", async () => {
    stored = { enableSearchEngineIndexing: false };

    await renderCard();
    await loaded();

    expect(theSwitch()).toHaveAttribute("aria-checked", "false");
    expect(changes).toEqual([false]);
  });

  test("a page with no value shows it on, as the column defaults to", async () => {
    stored = {};

    await renderCard();
    await loaded();

    expect(theSwitch()).toHaveAttribute("aria-checked", "true");
    expect(changes).toEqual([true]);
  });

  test("a page that is not there says so, with no switch", async () => {
    stored = null;

    await renderCard();

    await waitFor(() => {
      expect(
        screen.getByText(StatusPageBrandingCopy.notFound),
      ).toBeInTheDocument();
    });
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(changes).toEqual([]);
  });

  test("a read that fails says why, with no switch, and can be tried again", async () => {
    stored = new Error("The server is down for maintenance.");

    await renderCard();

    await waitFor(() => {
      expect(
        screen.getByText("The server is down for maintenance."),
      ).toBeInTheDocument();
    });
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();

    stored = { enableSearchEngineIndexing: false };

    await act(async () => {
      fireEvent.click(
        within(
          screen.getByTestId(SEARCH_ENGINE_INDEXING_CARD_TEST_ID),
        ).getByTestId("refresh-button"),
      );
    });

    await loaded();
    expect(getItemMock).toHaveBeenCalledTimes(2);
    expect(theSwitch()).toHaveAttribute("aria-checked", "false");
  });
});

describe("flipping the switch", () => {
  test("off saves enableSearchEngineIndexing: false for this page, at once, and nothing else", async () => {
    await renderCard();
    await loaded();

    await act(async () => {
      fireEvent.click(theSwitch());
    });

    await waitFor(() => {
      expect(theSwitch()).toHaveAttribute("aria-checked", "false");
    });

    expect(updateByIdMock).toHaveBeenCalledTimes(1);

    const request: Record<string, unknown> = updateByIdMock.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(request["modelType"]).toBe(StatusPage);
    expect((request["id"] as ObjectID).toString()).toBe(STATUS_PAGE_ID);
    expect(request["data"]).toEqual({ enableSearchEngineIndexing: false });
    expect(changes).toEqual([true, false]);
  });

  test("back on saves enableSearchEngineIndexing: true", async () => {
    stored = { enableSearchEngineIndexing: false };

    await renderCard();
    await loaded();

    await act(async () => {
      fireEvent.click(theSwitch());
    });

    await waitFor(() => {
      expect(theSwitch()).toHaveAttribute("aria-checked", "true");
    });

    expect(
      (updateByIdMock.mock.calls[0]![0] as Record<string, unknown>)["data"],
    ).toEqual({ enableSearchEngineIndexing: true });
    expect(changes).toEqual([false, true]);
  });

  test("is locked while the change is saved, and a second press does nothing", async () => {
    let finish: () => void = (): void => {};

    updateByIdMock.mockImplementation((): Promise<unknown> => {
      return new Promise<unknown>((resolve: (value: unknown) => void) => {
        finish = (): void => {
          resolve({});
        };
      });
    });

    await renderCard();
    await loaded();

    await act(async () => {
      fireEvent.click(theSwitch());
    });

    expect(theSwitch()).toHaveAttribute("aria-checked", "false");
    expect(theSwitch()).toHaveAttribute("aria-disabled", "true");

    await act(async () => {
      fireEvent.click(theSwitch());
    });
    expect(updateByIdMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish();
    });

    await waitFor(() => {
      expect(theSwitch()).not.toHaveAttribute("aria-disabled", "true");
    });
    expect(theSwitch()).toHaveAttribute("aria-checked", "false");
  });

  test("a refused save moves the switch back, says why under it, and tells the page", async () => {
    updateByIdMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error("You do not have permission to edit this status page.");
    });

    await renderCard();
    await loaded();

    await act(async () => {
      fireEvent.click(theSwitch());
    });

    await waitFor(() => {
      expect(within(theRow()).getByRole("alert")).toHaveTextContent(
        "You do not have permission to edit this status page.",
      );
    });
    await waitFor(() => {
      expect(theSwitch()).toHaveAttribute("aria-checked", "true");
    });

    // The page heard it go off, then come back on.
    expect(changes).toEqual([true, false, true]);
  });
});

describe("who may flip it", () => {
  test("the gate is asked about updating a status page", async () => {
    await renderCard();
    await loaded();

    const calls: Array<Array<unknown>> = (
      PermissionGate.check as unknown as MockFunction
    ).mock.calls as Array<Array<unknown>>;

    expect(calls.length).toBeGreaterThan(0);

    for (const [model, action] of calls) {
      expect(model).toBeInstanceOf(StatusPage);
      expect(action).toBe(ModelAction.Update);
    }
  });

  test("someone who may not edit the page sees it locked, and pressing it saves nothing", async () => {
    gate = {
      isAllowed: false,
      disabledReason: "You do not have permission to update this Status Page.",
    };

    await renderCard();
    await loaded();

    expect(theSwitch()).toHaveAttribute("aria-disabled", "true");

    await act(async () => {
      fireEvent.click(theSwitch());
    });

    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(theSwitch()).toHaveAttribute("aria-checked", "true");
  });

  test("every plan may change it: no plan pill, whatever the project is on", async () => {
    for (const projectPlan of [
      PlanType.Free,
      PlanType.Growth,
      PlanType.Scale,
      null,
    ]) {
      plan = projectPlan;

      await renderCard();
      await loaded();

      expect(within(theRow()).queryByText(/ Plan$/)).toBeNull();

      cleanup();
    }
  });
});
