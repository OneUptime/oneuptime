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
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * The panel at the top of a channel's subscriber list while that channel is
 * off for the status page. It replaced a red "X subscribers are not enabled
 * for this status page. Please enable it in Subscriber Settings" banner,
 * which four of the five lists of every new status page opened with.
 *
 * It holds the channel's own switch: nothing is drawn while the channel is
 * on; while it is off, it says what that means and turns it on right here,
 * saving the same column the Channels card on Subscriber Settings does.
 */

const updateByIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
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
  globalThis as unknown as { __channelOffPanelConfig: MutableConfig }
).__channelOffPanelConfig = config;

jest.mock("../../../UI/Config", () => {
  const mocked: Record<string, unknown> = {
    ...(jest.requireActual("../../../UI/Config") as Record<string, unknown>),
  };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return Boolean(
        (
          globalThis as unknown as {
            __channelOffPanelConfig: MutableConfig | undefined;
          }
        ).__channelOffPanelConfig?.billingEnabled,
      );
    },
  });

  return mocked;
});

import SubscriberChannelOffPanel, {
  SUBSCRIBER_CHANNEL_OFF_PANEL_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/SubscriberChannelOffPanel";
import SubscriberChannelsCopy, {
  getSubscriberChannel,
  SUBSCRIBER_CHANNELS,
  SubscriberChannelDefinition,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/SubscriberChannelsCopy";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import ObjectID from "../../../Types/ObjectID";
import StatusPageSubscriberNotificationMethod from "../../../Types/StatusPage/StatusPageSubscriberNotificationMethod";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";

const STATUS_PAGE_ID: string = "6b6b6b6b-0000-4000-8000-0000000000bb";

let gate: PermissionGateResult = { isAllowed: true };

beforeEach(() => {
  gate = { isAllowed: true };
  config.billingEnabled = false;

  updateByIdMock.mockReset();
  updateByIdMock.mockResolvedValue({} as never);

  getJestSpyOn(PermissionGate, "check").mockImplementation(
    (): PermissionGateResult => {
      return gate;
    },
  );

  getJestSpyOn(ProjectUtil, "getCurrentPlan").mockImplementation(
    (): PlanType | null => {
      return null;
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderPanel(
  method: StatusPageSubscriberNotificationMethod,
  isEnabled: boolean,
): Promise<void> {
  await act(async (): Promise<void> => {
    render(
      <SubscriberChannelOffPanel
        statusPageId={new ObjectID(STATUS_PAGE_ID)}
        method={method}
        isEnabled={isEnabled}
      />,
    );
  });
}

function theSwitch(): HTMLElement {
  return screen.getByRole("switch");
}

const CHANNELS: Array<[string, SubscriberChannelDefinition]> =
  SUBSCRIBER_CHANNELS.map(
    (
      channel: SubscriberChannelDefinition,
    ): [string, SubscriberChannelDefinition] => {
      return [channel.method, channel];
    },
  );

describe("while the channel is on", () => {
  test.each(CHANNELS)(
    "%s: nothing is drawn - no panel, no switch, no banner",
    async (_method: string, channel: SubscriberChannelDefinition) => {
      await renderPanel(channel.method, true);

      expect(
        screen.queryByTestId(SUBSCRIBER_CHANNEL_OFF_PANEL_TEST_ID),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole("switch")).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    },
  );
});

describe("while the channel is off", () => {
  test.each(CHANNELS)(
    "%s: the channel's switch, off, saying what off means",
    async (_method: string, channel: SubscriberChannelDefinition) => {
      await renderPanel(channel.method, false);

      expect(
        screen.getByTestId(SUBSCRIBER_CHANNEL_OFF_PANEL_TEST_ID),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("switch", { name: channel.listSwitchTitle }),
      ).toHaveAttribute("aria-checked", "false");
      expect(
        screen.getByText(channel.listSwitchOffDescription),
      ).toBeInTheDocument();
    },
  );

  test.each(CHANNELS)(
    "%s: no red banner, and no pointer to another page",
    async (_method: string, channel: SubscriberChannelDefinition) => {
      await renderPanel(channel.method, false);

      const panel: HTMLElement = screen.getByTestId(
        SUBSCRIBER_CHANNEL_OFF_PANEL_TEST_ID,
      );

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(panel).not.toHaveTextContent("not enabled");
      expect(panel).not.toHaveTextContent("Subscriber Settings");
      expect(panel.className).not.toMatch(/\bbg-red-|\bborder-red-/);
      // A quiet panel: the grey of the page's other neutral surfaces.
      expect(panel.className).toContain("bg-gray-50");
      expect(panel.className).toContain("border-gray-200");
    },
  );

  test("says that subscribers the team adds still get updates", async () => {
    for (const channel of SUBSCRIBER_CHANNELS) {
      expect(channel.listSwitchOffDescription).toContain(
        "Subscribers your team adds here still get updates.",
      );
    }
  });
});

describe("turning it on from the list", () => {
  test.each(CHANNELS)(
    "%s: saves the channel's column of this page, then says it is on and stays",
    async (_method: string, channel: SubscriberChannelDefinition) => {
      await renderPanel(channel.method, false);

      await act(async () => {
        fireEvent.click(theSwitch());
      });

      await waitFor(() => {
        expect(theSwitch()).toHaveAttribute("aria-checked", "true");
      });

      expect(updateByIdMock).toHaveBeenCalledTimes(1);

      const request: Record<string, unknown> = updateByIdMock.mock
        .calls[0]![0] as Record<string, unknown>;

      expect(request["modelType"]).toBe(StatusPage);
      expect((request["id"] as ObjectID).toString()).toBe(STATUS_PAGE_ID);
      expect(request["data"]).toEqual({ [channel.column]: true });

      // Still there, saying what on means, so the press shows its result.
      expect(
        screen.getByTestId(SUBSCRIBER_CHANNEL_OFF_PANEL_TEST_ID),
      ).toBeInTheDocument();
      expect(
        screen.getByText(channel.listSwitchOnDescription),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(channel.listSwitchOffDescription),
      ).not.toBeInTheDocument();
    },
  );

  test("can be taken back at once", async () => {
    const sms: SubscriberChannelDefinition = getSubscriberChannel(
      StatusPageSubscriberNotificationMethod.SMS,
    );

    await renderPanel(StatusPageSubscriberNotificationMethod.SMS, false);

    await act(async () => {
      fireEvent.click(theSwitch());
    });
    await waitFor(() => {
      expect(theSwitch()).toHaveAttribute("aria-checked", "true");
    });

    await act(async () => {
      fireEvent.click(theSwitch());
    });
    await waitFor(() => {
      expect(theSwitch()).toHaveAttribute("aria-checked", "false");
    });

    expect(updateByIdMock).toHaveBeenCalledTimes(2);
    expect(
      (updateByIdMock.mock.calls[1]![0] as Record<string, unknown>)["data"],
    ).toEqual({ enableSmsSubscribers: false });
    expect(
      screen.getByTestId(SUBSCRIBER_CHANNEL_OFF_PANEL_TEST_ID),
    ).toBeInTheDocument();
    expect(screen.getByText(sms.listSwitchOffDescription)).toBeInTheDocument();
  });

  test("a refused save moves the switch back, says why, and keeps saying off", async () => {
    const slack: SubscriberChannelDefinition = getSubscriberChannel(
      StatusPageSubscriberNotificationMethod.Slack,
    );

    updateByIdMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error(
        "Please upgrade your plan to Scale to access this feature",
      );
    });

    await renderPanel(StatusPageSubscriberNotificationMethod.Slack, false);

    await act(async () => {
      fireEvent.click(theSwitch());
    });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Please upgrade your plan to Scale to access this feature",
      );
    });
    await waitFor(() => {
      expect(theSwitch()).toHaveAttribute("aria-checked", "false");
    });
    expect(
      screen.getByText(slack.listSwitchOffDescription),
    ).toBeInTheDocument();
  });
});

describe("who may turn it on", () => {
  test("the gate is asked about updating a status page", async () => {
    await renderPanel(StatusPageSubscriberNotificationMethod.Webhook, false);

    const [model, action] = (PermissionGate.check as unknown as MockFunction)
      .mock.calls[0] as [unknown, ModelAction];

    expect(model).toBeInstanceOf(StatusPage);
    expect(action).toBe(ModelAction.Update);
  });

  test("someone who may not edit the status page sees the switch locked, and pressing it does nothing", async () => {
    gate = {
      isAllowed: false,
      disabledReason: "You do not have permission to update this Status Page.",
    };

    await renderPanel(StatusPageSubscriberNotificationMethod.Email, false);

    expect(theSwitch()).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByText(
        "You do not have permission to update this Status Page.",
      ),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(theSwitch());
    });

    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(theSwitch()).toHaveAttribute("aria-checked", "false");
  });
});

describe("SMS costs money, so its switch says so", () => {
  test("where OneUptime bills for texts, both before and after it is turned on", async () => {
    config.billingEnabled = true;

    await renderPanel(StatusPageSubscriberNotificationMethod.SMS, false);

    const panel: HTMLElement = screen.getByTestId(
      SUBSCRIBER_CHANNEL_OFF_PANEL_TEST_ID,
    );

    expect(panel).toHaveTextContent(SubscriberChannelsCopy.smsBalanceSentence);

    await act(async () => {
      fireEvent.click(theSwitch());
    });
    await waitFor(() => {
      expect(theSwitch()).toHaveAttribute("aria-checked", "true");
    });

    expect(panel).toHaveTextContent(SubscriberChannelsCopy.smsBalanceSentence);
  });

  test("not on a self-hosted install, which bills nothing", async () => {
    config.billingEnabled = false;

    await renderPanel(StatusPageSubscriberNotificationMethod.SMS, false);

    expect(
      screen.getByTestId(SUBSCRIBER_CHANNEL_OFF_PANEL_TEST_ID),
    ).not.toHaveTextContent(SubscriberChannelsCopy.smsBalanceSentence);
  });

  test.each(
    CHANNELS.filter(([method]: [string, SubscriberChannelDefinition]) => {
      return method !== StatusPageSubscriberNotificationMethod.SMS;
    }),
  )(
    "%s says nothing about a balance, billing or not",
    async (_method: string, channel: SubscriberChannelDefinition) => {
      config.billingEnabled = true;

      await renderPanel(channel.method, false);

      expect(
        screen.getByTestId(SUBSCRIBER_CHANNEL_OFF_PANEL_TEST_ID),
      ).not.toHaveTextContent(SubscriberChannelsCopy.smsBalanceSentence);
    },
  );
});
