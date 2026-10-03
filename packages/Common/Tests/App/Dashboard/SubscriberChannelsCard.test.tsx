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
 * The Channels card on a status page's Subscriber Settings: the one place
 * its Subscribe page and its five subscriber channels are switched. One row
 * per switch, saved the moment it is flipped, locked while it saves, moved
 * back with the reason when the server refuses, locked for someone who may
 * not edit the page, and labelled with the plan a project would need.
 *
 * Only the network, the permission gate, the plan and the billing flag are
 * stubbed; the card, its rows and the switches are the real ones.
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

interface MutableConfig {
  billingEnabled: boolean;
}

const config: MutableConfig = { billingEnabled: false };

(
  globalThis as unknown as { __subscriberChannelsConfig: MutableConfig }
).__subscriberChannelsConfig = config;

/*
 * BILLING_ENABLED is a module-scope const, so it is switched per test with
 * a getter. defineProperty rather than a getter in the object literal: a
 * literal getter is read once while the object is built.
 */
jest.mock("../../../UI/Config", () => {
  const mocked: Record<string, unknown> = {
    ...(jest.requireActual("../../../UI/Config") as Record<string, unknown>),
  };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return Boolean(
        (
          globalThis as unknown as {
            __subscriberChannelsConfig: MutableConfig | undefined;
          }
        ).__subscriberChannelsConfig?.billingEnabled,
      );
    },
  });

  return mocked;
});

import SubscriberChannelsCard, {
  SUBSCRIBER_CHANNELS_CARD_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/SubscriberChannelsCard";
import SubscriberChannelsCopy, {
  SUBSCRIBER_CHANNELS,
  SubscriberChannelDefinition,
  SUBSCRIPTION_SWITCH_COLUMNS,
  SubscriptionSwitchColumn,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/SubscriberChannelsCopy";
import { getSubscriptionSwitchTestId } from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageSwitchRow";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import SubscriptionPlan, {
  PlanType,
} from "../../../Types/Billing/SubscriptionPlan";
import ObjectID from "../../../Types/ObjectID";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";

const STATUS_PAGE_ID: string = "5a5a5a5a-0000-4000-8000-0000000000aa";

type StoredColumns = Partial<Record<SubscriptionSwitchColumn, boolean>>;

// A new status page, as the columns' defaults leave it.
const NEW_PAGE: StoredColumns = {
  showSubscriberPageOnStatusPage: true,
  enableEmailSubscribers: true,
  enableSmsSubscribers: false,
  enableSlackSubscribers: false,
  enableMicrosoftTeamsSubscribers: false,
  enableWebhookSubscribers: false,
};

let stored: StoredColumns | null | Error = null;
let gate: PermissionGateResult = { isAllowed: true };
let plan: PlanType | null = null;

beforeEach(() => {
  stored = { ...NEW_PAGE };
  gate = { isAllowed: true };
  plan = null;
  config.billingEnabled = false;

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

    for (const [column, value] of Object.entries(stored)) {
      (page as unknown as Record<string, unknown>)[column] = value;
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
    render(<SubscriberChannelsCard statusPageId={new ObjectID(STATUS_PAGE_ID)} />);
  });

  await waitFor(() => {
    expect(getItemMock).toHaveBeenCalled();
  });
}

async function loaded(): Promise<void> {
  await waitFor(() => {
    expect(screen.getAllByRole("switch")).toHaveLength(6);
  });
}

function switchFor(column: SubscriptionSwitchColumn): HTMLElement {
  return screen.getByTestId(getSubscriptionSwitchTestId(column));
}

function rowFor(column: SubscriptionSwitchColumn): HTMLElement {
  return screen.getByTestId(`${getSubscriptionSwitchTestId(column)}-row`);
}

function channel(column: SubscriptionSwitchColumn): SubscriberChannelDefinition {
  return SUBSCRIBER_CHANNELS.find(
    (candidate: SubscriberChannelDefinition): boolean => {
      return candidate.column === column;
    },
  )!;
}

describe("reading the status page", () => {
  test("asks for this page's six subscription columns and nothing else", async () => {
    await renderCard();
    await loaded();

    expect(getItemMock).toHaveBeenCalledTimes(1);

    const request: Record<string, unknown> = getItemMock.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(request["modelType"]).toBe(StatusPage);
    expect((request["id"] as ObjectID).toString()).toBe(STATUS_PAGE_ID);
    expect(request["select"]).toEqual({
      showSubscriberPageOnStatusPage: true,
      enableEmailSubscribers: true,
      enableSmsSubscribers: true,
      enableSlackSubscribers: true,
      enableMicrosoftTeamsSubscribers: true,
      enableWebhookSubscribers: true,
    });
  });

  test("is the Channels card, saying what it is for", async () => {
    await renderCard();
    await loaded();

    expect(
      screen.getByText(SubscriberChannelsCopy.cardTitle),
    ).toBeInTheDocument();
    expect(
      screen.getByText(SubscriberChannelsCopy.cardDescription),
    ).toBeInTheDocument();
  });

  test("lists the Subscribe page, then the channels in the side menu's order", async () => {
    await renderCard();
    await loaded();

    const names: Array<string | null> = screen
      .getAllByRole("switch")
      .map((element: HTMLElement): string | null => {
        return element.getAttribute("data-testid");
      });

    expect(names).toEqual(
      SUBSCRIPTION_SWITCH_COLUMNS.map(
        (column: SubscriptionSwitchColumn): string => {
          return getSubscriptionSwitchTestId(column);
        },
      ),
    );
    expect(SUBSCRIPTION_SWITCH_COLUMNS).toEqual([
      "showSubscriberPageOnStatusPage",
      "enableEmailSubscribers",
      "enableSmsSubscribers",
      "enableSlackSubscribers",
      "enableMicrosoftTeamsSubscribers",
      "enableWebhookSubscribers",
    ]);
  });

  test("names each switch for what it turns on, with one line on what that means", async () => {
    await renderCard();
    await loaded();

    expect(
      screen.getByRole("switch", {
        name: SubscriberChannelsCopy.subscribePageTitle,
      }),
    ).toBe(switchFor("showSubscriberPageOnStatusPage"));
    expect(
      within(rowFor("showSubscriberPageOnStatusPage")).getByText(
        SubscriberChannelsCopy.subscribePageDescription,
      ),
    ).toBeInTheDocument();

    for (const definition of SUBSCRIBER_CHANNELS) {
      expect(screen.getByRole("switch", { name: definition.title })).toBe(
        switchFor(definition.column),
      );
      expect(
        within(rowFor(definition.column)).getByText(definition.description),
      ).toBeInTheDocument();
    }
  });

  test("a new page shows the Subscribe page and email on, everything else off", async () => {
    await renderCard();
    await loaded();

    expect(switchFor("showSubscriberPageOnStatusPage")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(switchFor("enableEmailSubscribers")).toHaveAttribute(
      "aria-checked",
      "true",
    );

    for (const column of [
      "enableSmsSubscribers",
      "enableSlackSubscribers",
      "enableMicrosoftTeamsSubscribers",
      "enableWebhookSubscribers",
    ] as Array<SubscriptionSwitchColumn>) {
      expect(switchFor(column)).toHaveAttribute("aria-checked", "false");
    }
  });

  test("shows each switch as the page has it", async () => {
    stored = {
      showSubscriberPageOnStatusPage: false,
      enableEmailSubscribers: false,
      enableSmsSubscribers: true,
      enableSlackSubscribers: true,
      enableMicrosoftTeamsSubscribers: false,
      enableWebhookSubscribers: true,
    };

    await renderCard();
    await loaded();

    for (const [column, value] of Object.entries(stored)) {
      expect(switchFor(column as SubscriptionSwitchColumn)).toHaveAttribute(
        "aria-checked",
        value ? "true" : "false",
      );
    }
  });

  test("a page that has no value for Show Subscriber Page shows it on, as the column defaults to", async () => {
    stored = { enableEmailSubscribers: true };

    await renderCard();
    await loaded();

    expect(switchFor("showSubscriberPageOnStatusPage")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(switchFor("enableSmsSubscribers")).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  test("a page that is not there says so, with no switches", async () => {
    stored = null;

    await renderCard();

    await waitFor(() => {
      expect(screen.getByText("Status page not found.")).toBeInTheDocument();
    });
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  test("a read that fails says why, with no switches, and can be tried again", async () => {
    stored = new Error("The server is down for maintenance.");

    await renderCard();

    await waitFor(() => {
      expect(
        screen.getByText("The server is down for maintenance."),
      ).toBeInTheDocument();
    });
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();

    stored = { ...NEW_PAGE };

    await act(async () => {
      fireEvent.click(
        within(screen.getByTestId(SUBSCRIBER_CHANNELS_CARD_TEST_ID)).getByTestId(
          "refresh-button",
        ),
      );
    });

    await loaded();
    expect(getItemMock).toHaveBeenCalledTimes(2);
  });
});

describe("flipping a switch", () => {
  test.each(SUBSCRIPTION_SWITCH_COLUMNS.map((column: string) => [column]))(
    "%s saves that column of this page, at once, and nothing else",
    async (column: string) => {
      await renderCard();
      await loaded();

      const before: string | null = switchFor(
        column as SubscriptionSwitchColumn,
      ).getAttribute("aria-checked");
      const next: boolean = before !== "true";

      await act(async () => {
        fireEvent.click(switchFor(column as SubscriptionSwitchColumn));
      });

      await waitFor(() => {
        expect(switchFor(column as SubscriptionSwitchColumn)).toHaveAttribute(
          "aria-checked",
          next ? "true" : "false",
        );
      });

      expect(updateByIdMock).toHaveBeenCalledTimes(1);

      const request: Record<string, unknown> = updateByIdMock.mock
        .calls[0]![0] as Record<string, unknown>;

      expect(request["modelType"]).toBe(StatusPage);
      expect((request["id"] as ObjectID).toString()).toBe(STATUS_PAGE_ID);
      expect(request["data"]).toEqual({ [column]: next });
    },
  );

  test("turning SMS on leaves every other switch where it was", async () => {
    await renderCard();
    await loaded();

    await act(async () => {
      fireEvent.click(switchFor("enableSmsSubscribers"));
    });

    await waitFor(() => {
      expect(switchFor("enableSmsSubscribers")).toHaveAttribute(
        "aria-checked",
        "true",
      );
    });

    expect(switchFor("showSubscriberPageOnStatusPage")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(switchFor("enableEmailSubscribers")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(switchFor("enableSlackSubscribers")).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  test("is locked while the change is saved", async () => {
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
      fireEvent.click(switchFor("enableSlackSubscribers"));
    });

    expect(switchFor("enableSlackSubscribers")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(switchFor("enableSlackSubscribers")).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    // A second press while it saves does nothing.
    await act(async () => {
      fireEvent.click(switchFor("enableSlackSubscribers"));
    });
    expect(updateByIdMock).toHaveBeenCalledTimes(1);

    // The other rows are not held up by it.
    expect(switchFor("enableWebhookSubscribers")).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );

    await act(async () => {
      finish();
    });

    await waitFor(() => {
      expect(switchFor("enableSlackSubscribers")).not.toHaveAttribute(
        "aria-disabled",
        "true",
      );
    });
    expect(switchFor("enableSlackSubscribers")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("a refused save moves the switch back, and says why under it", async () => {
    updateByIdMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error("Please upgrade your plan to Scale to access this feature");
    });

    await renderCard();
    await loaded();

    await act(async () => {
      fireEvent.click(switchFor("enableWebhookSubscribers"));
    });

    await waitFor(() => {
      expect(
        within(rowFor("enableWebhookSubscribers")).getByRole("alert"),
      ).toHaveTextContent(
        "Please upgrade your plan to Scale to access this feature",
      );
    });
    await waitFor(() => {
      expect(switchFor("enableWebhookSubscribers")).toHaveAttribute(
        "aria-checked",
        "false",
      );
    });

    // Only that row says so.
    expect(
      within(rowFor("enableSlackSubscribers")).queryByRole("alert"),
    ).not.toBeInTheDocument();

    // The next try clears it.
    updateByIdMock.mockResolvedValue({} as never);

    await act(async () => {
      fireEvent.click(switchFor("enableWebhookSubscribers"));
    });

    await waitFor(() => {
      expect(
        within(rowFor("enableWebhookSubscribers")).queryByRole("alert"),
      ).not.toBeInTheDocument();
    });
    expect(switchFor("enableWebhookSubscribers")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("a project without SMS turned on hears it from the server, under the SMS row", async () => {
    updateByIdMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error(
        "SMS notifications are not enabled for this project. Please enable SMS notifications in the Project Settings > Notifications Settings.",
      );
    });

    await renderCard();
    await loaded();

    await act(async () => {
      fireEvent.click(switchFor("enableSmsSubscribers"));
    });

    await waitFor(() => {
      expect(
        within(rowFor("enableSmsSubscribers")).getByRole("alert"),
      ).toHaveTextContent("SMS notifications are not enabled for this project.");
    });
    expect(switchFor("enableSmsSubscribers")).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });
});

describe("who may flip them", () => {
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

  test("someone who may not edit the page sees every switch locked, with the reason, and saving does nothing", async () => {
    gate = {
      isAllowed: false,
      disabledReason: "You do not have permission to update this Status Page.",
    };

    await renderCard();
    await loaded();

    for (const column of SUBSCRIPTION_SWITCH_COLUMNS) {
      expect(switchFor(column)).toHaveAttribute("aria-disabled", "true");
    }

    expect(
      screen.getAllByText(
        "You do not have permission to update this Status Page.",
      ).length,
    ).toBeGreaterThan(0);

    await act(async () => {
      fireEvent.click(switchFor("enableSmsSubscribers"));
    });

    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(switchFor("enableSmsSubscribers")).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });
});

describe("what SMS costs", () => {
  test("where OneUptime bills for texts, the SMS row says they come out of the project's balance", async () => {
    config.billingEnabled = true;

    await renderCard();
    await loaded();

    expect(within(rowFor("enableSmsSubscribers")).getByText(
      (content: string): boolean => {
        return content.includes(SubscriberChannelsCopy.smsBalanceSentence);
      },
    )).toBeInTheDocument();

    // Only the SMS row.
    for (const column of SUBSCRIPTION_SWITCH_COLUMNS) {
      if (column === "enableSmsSubscribers") {
        continue;
      }

      expect(rowFor(column)).not.toHaveTextContent(
        SubscriberChannelsCopy.smsBalanceSentence,
      );
    }
  });

  test("a self-hosted install, which bills nothing, says nothing about a balance", async () => {
    config.billingEnabled = false;

    await renderCard();
    await loaded();

    expect(rowFor("enableSmsSubscribers")).toHaveTextContent(
      channel("enableSmsSubscribers").description,
    );
    expect(rowFor("enableSmsSubscribers")).not.toHaveTextContent(
      SubscriberChannelsCopy.smsBalanceSentence,
    );
  });
});

describe("plans", () => {
  test("with no plan to go by (billing off, or not loaded), no row names a plan", async () => {
    plan = null;
    const accessible: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      SubscriptionPlan,
      "isFeatureAccessibleOnCurrentPlan",
    );

    await renderCard();
    await loaded();

    expect(screen.queryByTestId("pill")).not.toBeInTheDocument();
    expect(accessible).not.toHaveBeenCalled();
  });

  test("each row asks about the plan its own column needs to be changed, and names the ones this project lacks", async () => {
    plan = PlanType.Free;

    const asked: Array<PlanType> = [];

    getJestSpyOn(
      SubscriptionPlan,
      "isFeatureAccessibleOnCurrentPlan",
    ).mockImplementation((needed: unknown, current: unknown): boolean => {
      expect(current).toBe(PlanType.Free);
      asked.push(needed as PlanType);
      // Only what the Free plan includes.
      return needed === PlanType.Free;
    });

    await renderCard();
    await loaded();

    const statusPage: StatusPage = new StatusPage();

    for (const column of SUBSCRIPTION_SWITCH_COLUMNS) {
      const billing: { update?: PlanType } | undefined =
        statusPage.getColumnBillingAccessControl(column);

      // A column with no billing rule (email) needs no plan at all.
      if (!billing || !billing.update) {
        expect(
          within(rowFor(column)).queryByTestId("pill"),
        ).not.toBeInTheDocument();
        continue;
      }

      const needed: PlanType = billing.update;

      expect(asked).toContain(needed);

      if (needed === PlanType.Free) {
        expect(
          within(rowFor(column)).queryByTestId("pill"),
        ).not.toBeInTheDocument();
      } else {
        expect(within(rowFor(column)).getByTestId("pill")).toHaveTextContent(
          `${needed} Plan`,
        );
      }
    }

    /*
     * As the model has it today: email on every plan, SMS and the
     * Subscribe page from Growth, chat and webhooks from Scale.
     */
    expect(
      within(rowFor("enableEmailSubscribers")).queryByTestId("pill"),
    ).not.toBeInTheDocument();
    expect(
      within(rowFor("enableSmsSubscribers")).getByTestId("pill"),
    ).toHaveTextContent("Growth Plan");
    expect(
      within(rowFor("showSubscriberPageOnStatusPage")).getByTestId("pill"),
    ).toHaveTextContent("Growth Plan");

    for (const column of [
      "enableSlackSubscribers",
      "enableMicrosoftTeamsSubscribers",
      "enableWebhookSubscribers",
    ] as Array<SubscriptionSwitchColumn>) {
      expect(within(rowFor(column)).getByTestId("pill")).toHaveTextContent(
        "Scale Plan",
      );
    }
  });

  test("the plan's name is beside the switch, not part of its name", async () => {
    plan = PlanType.Free;
    getJestSpyOn(
      SubscriptionPlan,
      "isFeatureAccessibleOnCurrentPlan",
    ).mockImplementation((): boolean => {
      return false;
    });

    await renderCard();
    await loaded();

    expect(
      screen.getByRole("switch", { name: channel("enableSlackSubscribers").title }),
    ).toBe(switchFor("enableSlackSubscribers"));
  });

  test("a plan the environment does not describe says nothing either way", async () => {
    plan = PlanType.Growth;
    getJestSpyOn(
      SubscriptionPlan,
      "isFeatureAccessibleOnCurrentPlan",
    ).mockImplementation((): boolean => {
      throw new Error("Invalid Plan");
    });

    await renderCard();
    await loaded();

    expect(screen.queryByTestId("pill")).not.toBeInTheDocument();
  });

  test("a switch whose plan is missing can still be pressed: the server has the last word", async () => {
    plan = PlanType.Free;
    getJestSpyOn(
      SubscriptionPlan,
      "isFeatureAccessibleOnCurrentPlan",
    ).mockImplementation((): boolean => {
      return false;
    });

    await renderCard();
    await loaded();

    expect(switchFor("enableSlackSubscribers")).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );

    await act(async () => {
      fireEvent.click(switchFor("enableSlackSubscribers"));
    });

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
  });
});
