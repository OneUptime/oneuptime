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
import * as React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  getDefaultSessionReplayFrustrationSettings,
  SESSION_REPLAY_MAX_CUSTOM_SIGNALS,
  SessionReplayCustomSignal,
  SessionReplayFrustrationSettings,
} from "../../../Types/Rum/SessionReplayFrustrationSignals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Frustration Signals page (issue #6443), driven the way a person uses
 * it, against a fake ModelAPI: a new application reads as every default,
 * a switch saves the moment it is flipped and goes back when the save is
 * refused, a rule is checked before it is sent, and a signal of the
 * application's own is added, changed, switched off and deleted - each a
 * write of the whole settings to the one column.
 */

const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();
const isMasterAdminMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
      updateById: (...args: Array<unknown>) => {
        return updateByIdMock(...args);
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (error: unknown): string => {
        return error instanceof Error ? error.message : String(error);
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return isMasterAdminMock() as boolean;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return [];
      },
      getProjectPermissions: (): null => {
        return null;
      },
    },
  };
});

import FrustrationSignalsSettings from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/FrustrationSignals/FrustrationSignalsSettings";

const APP_ID: ObjectID = new ObjectID("0193c0de-1111-4aaa-8bbb-000000000001");

// Every selector reads, unless a test says otherwise.
type StoredValue = SessionReplayFrustrationSettings | JSONObject | null;

function applicationWith(value: StoredValue): JSONObject {
  return {
    _id: APP_ID.toString(),
    sessionReplayFrustrationSignals: value as JSONObject | null,
  };
}

function signal(
  overrides: Partial<SessionReplayCustomSignal>,
): SessionReplayCustomSignal {
  return {
    id: "signal-1",
    name: "Payment failed",
    trigger: "page",
    match: "/checkout/error",
    isFrustration: true,
    isEnabled: true,
    ...overrides,
  };
}

function settingsWith(
  customSignals: Array<SessionReplayCustomSignal>,
): SessionReplayFrustrationSettings {
  return { ...getDefaultSessionReplayFrustrationSettings(), customSignals };
}

// What the page sent on its nth write.
function savedSettings(call: number = 0): SessionReplayFrustrationSettings {
  const args: JSONObject = updateByIdMock.mock.calls[call]![0] as JSONObject;
  const data: JSONObject = args["data"] as JSONObject;

  return data[
    "sessionReplayFrustrationSignals"
  ] as unknown as SessionReplayFrustrationSettings;
}

async function renderPage(stored: StoredValue = null): Promise<void> {
  getItemMock.mockResolvedValue(applicationWith(stored));

  render(<FrustrationSignalsSettings rumApplicationId={APP_ID} />);

  await screen.findByTestId("frustration-signal-rageClick");
}

function switchOf(testId: string): HTMLElement {
  return within(screen.getByTestId(testId)).getByRole("switch");
}

beforeEach(() => {
  getItemMock.mockReset();
  updateByIdMock.mockReset();
  isMasterAdminMock.mockReset();
  isMasterAdminMock.mockReturnValue(true);
  updateByIdMock.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
});

describe("a new application", () => {
  test("reads the one column of the application it is given", async () => {
    await renderPage(null);

    expect(getItemMock).toHaveBeenCalledTimes(1);

    const args: JSONObject = getItemMock.mock.calls[0]![0] as JSONObject;

    expect((args["id"] as ObjectID).toString()).toBe(APP_ID.toString());
    expect(args["select"]).toEqual({
      _id: true,
      sessionReplayFrustrationSignals: true,
    });
  });

  test("shows the four built-in signals switched on, defined by today's numbers", async () => {
    await renderPage(null);

    for (const key of ["rageClick", "deadClick", "errorClick", "refreshRage"]) {
      expect(switchOf(`frustration-signal-${key}`)).toHaveAttribute(
        "aria-checked",
        "true",
      );
    }

    expect(
      screen.getByTestId("frustration-signal-rageClick-definition"),
    ).toHaveTextContent(
      "3 or more clicks within 30 px of each other, each within 1 second of the one before.",
    );
    expect(
      screen.getByTestId("frustration-signal-deadClick-definition"),
    ).toHaveTextContent(
      "A click on something that looks clickable, after which nothing on the page changes for 3 seconds.",
    );
    expect(
      screen.getByTestId("frustration-signal-errorClick-definition"),
    ).toHaveTextContent("An error within 1 second of a click.");
    expect(
      screen.getByTestId("frustration-signal-refreshRage-definition"),
    ).toHaveTextContent("The same page loaded 3 times within 60 seconds.");
  });

  test("names each switch by its signal, and says changes apply from now on", async () => {
    await renderPage(null);

    expect(
      screen.getByRole("switch", { name: "Rage clicks" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: "Refresh rage" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("frustration-signals-applies")).toHaveTextContent(
      "Changes apply to sessions recorded from now on. Sessions already recorded keep the signals they were recorded with.",
    );
  });

  test("has no signals of its own yet, and offers to add one", async () => {
    await renderPage(null);

    expect(
      screen.getByTestId("frustration-signals-custom-empty"),
    ).toHaveTextContent("No signals of your own yet.");
    expect(
      screen.getByRole("button", { name: "Add signal" }),
    ).not.toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByTestId("frustration-signals-mobile-note"),
    ).toHaveTextContent("The React Native recorder detects your page");
  });

  test("keeps every rule folded away under Change the rule", async () => {
    await renderPage(null);

    const fold: HTMLElement = screen.getByTestId(
      "frustration-signal-rageClick-rule",
    );

    expect(
      within(fold).getByRole("button", { name: "Change the rule" }),
    ).toHaveAttribute("aria-expanded", "false");
  });
});

describe("a failed read", () => {
  test("says the settings could not be loaded and reads again on Refresh", async () => {
    getItemMock.mockRejectedValueOnce(new Error("Network error"));
    getItemMock.mockResolvedValueOnce(applicationWith(null));

    render(<FrustrationSignalsSettings rumApplicationId={APP_ID} />);

    const failure: HTMLElement = await screen.findByTestId(
      "frustration-signals-load-error",
    );

    expect(failure).toHaveTextContent(
      "The frustration settings could not be loaded. Network error",
    );
    expect(screen.queryByTestId("frustration-signal-rageClick")).toBeNull();

    fireEvent.click(within(failure).getByTestId("refresh-button"));

    await screen.findByTestId("frustration-signal-rageClick");
    expect(getItemMock).toHaveBeenCalledTimes(2);
  });

  test("an application that is gone says so", async () => {
    getItemMock.mockResolvedValue(null);

    render(<FrustrationSignalsSettings rumApplicationId={APP_ID} />);

    expect(
      await screen.findByTestId("frustration-signals-load-error"),
    ).toHaveTextContent("This RUM application was not found.");
  });
});

describe("a built-in signal's switch", () => {
  test("saves the whole settings with that signal off, the moment it is flipped", async () => {
    await renderPage(null);

    fireEvent.click(switchOf("frustration-signal-deadClick"));

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    const expected: SessionReplayFrustrationSettings =
      getDefaultSessionReplayFrustrationSettings();
    expected.deadClick.isEnabled = false;

    expect(savedSettings()).toEqual(expected);
    await waitFor(() => {
      expect(
        screen.getByTestId("frustration-signal-deadClick-status"),
      ).toHaveTextContent("Saved");
    });
    expect(switchOf("frustration-signal-deadClick")).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  test("goes back and says why when the save is refused", async () => {
    updateByIdMock.mockRejectedValueOnce(
      new Error("You do not have permission to edit this application."),
    );

    await renderPage(null);

    fireEvent.click(switchOf("frustration-signal-rageClick"));

    expect(
      await screen.findByTestId("frustration-signal-rageClick-error"),
    ).toHaveTextContent("You do not have permission to edit this application.");
    // The switch draws its value from an effect: wait for it to run.
    await waitFor(() => {
      expect(switchOf("frustration-signal-rageClick")).toHaveAttribute(
        "aria-checked",
        "true",
      );
    });
    expect(
      screen.getByTestId("frustration-signal-rageClick-status"),
    ).toHaveTextContent("");
  });

  test("a switched-off signal reads as off, and switching it on saves it on", async () => {
    const stored: SessionReplayFrustrationSettings =
      getDefaultSessionReplayFrustrationSettings();
    stored.refreshRage.isEnabled = false;

    await renderPage(stored);

    expect(switchOf("frustration-signal-refreshRage")).toHaveAttribute(
      "aria-checked",
      "false",
    );

    fireEvent.click(switchOf("frustration-signal-refreshRage"));

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });
    expect(savedSettings().refreshRage.isEnabled).toBe(true);
  });
});

describe("changing a rule", () => {
  function openRule(key: string): HTMLElement {
    const fold: HTMLElement = screen.getByTestId(
      `frustration-signal-${key}-rule`,
    );

    fireEvent.click(
      within(fold).getByRole("button", { name: "Change the rule" }),
    );

    return fold;
  }

  test("saves the numbers typed, seconds as milliseconds, and the sentence follows them", async () => {
    await renderPage(null);
    openRule("rageClick");

    fireEvent.change(
      screen.getByTestId("frustration-signal-rageClick-clickCount"),
      {
        target: { value: "5" },
      },
    );
    fireEvent.change(
      screen.getByTestId("frustration-signal-rageClick-windowMs"),
      {
        target: { value: "1.5" },
      },
    );
    fireEvent.change(
      screen.getByTestId("frustration-signal-rageClick-radiusPx"),
      {
        target: { value: "40" },
      },
    );
    fireEvent.click(
      screen.getByTestId("frustration-signal-rageClick-save-rule"),
    );

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    expect(savedSettings().rageClick).toEqual({
      isEnabled: true,
      clickCount: 5,
      windowMs: 1500,
      radiusPx: 40,
      ignoreSelectors: [],
    });
    await waitFor(() => {
      expect(
        screen.getByTestId("frustration-signal-rageClick-rule-status"),
      ).toHaveTextContent("Saved");
    });
    expect(
      screen.getByTestId("frustration-signal-rageClick-definition"),
    ).toHaveTextContent(
      "5 or more clicks within 40 px of each other, each within 1.5 seconds of the one before.",
    );
  });

  test("a number outside the rule's range is refused here, with the range", async () => {
    await renderPage(null);
    openRule("rageClick");

    fireEvent.change(
      screen.getByTestId("frustration-signal-rageClick-clickCount"),
      {
        target: { value: "2" },
      },
    );
    fireEvent.click(
      screen.getByTestId("frustration-signal-rageClick-save-rule"),
    );

    expect(
      await screen.findByText("Enter a whole number from 3 to 10."),
    ).toBeInTheDocument();
    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("seconds outside the range are refused in seconds", async () => {
    await renderPage(null);
    openRule("deadClick");

    fireEvent.change(
      screen.getByTestId("frustration-signal-deadClick-timeoutMs"),
      {
        target: { value: "20" },
      },
    );
    fireEvent.click(
      screen.getByTestId("frustration-signal-deadClick-save-rule"),
    );

    expect(
      await screen.findByText("Enter a number from 0.5 to 10."),
    ).toBeInTheDocument();
    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("ignored elements are saved one a line, and listed under the rule", async () => {
    await renderPage(null);
    openRule("deadClick");

    fireEvent.change(
      screen.getByTestId("frustration-signal-deadClick-ignore"),
      {
        target: {
          value: ".quantity-stepper\n\n  #promo-banner  \n.quantity-stepper",
        },
      },
    );
    fireEvent.click(
      screen.getByTestId("frustration-signal-deadClick-save-rule"),
    );

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    expect(savedSettings().deadClick.ignoreSelectors).toEqual([
      ".quantity-stepper",
      "#promo-banner",
    ]);
    expect(
      await screen.findByTestId("frustration-signal-deadClick-ignored"),
    ).toHaveTextContent("Clicks on 2 elements you listed never count.");
  });

  test("a selector the browser cannot read is refused before it is sent", async () => {
    await renderPage(null);
    openRule("rageClick");

    fireEvent.change(
      screen.getByTestId("frustration-signal-rageClick-ignore"),
      {
        target: { value: "div[" },
      },
    );
    fireEvent.click(
      screen.getByTestId("frustration-signal-rageClick-save-rule"),
    );

    expect(
      await screen.findByText(
        "Your browser cannot read div[ as a CSS selector.",
      ),
    ).toBeInTheDocument();
    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("Use the defaults puts today's numbers back without saving them", async () => {
    const stored: SessionReplayFrustrationSettings =
      getDefaultSessionReplayFrustrationSettings();
    stored.refreshRage.reloadCount = 6;
    stored.refreshRage.windowSeconds = 120;

    await renderPage(stored);
    openRule("refreshRage");

    expect(
      screen.getByTestId("frustration-signal-refreshRage-reloadCount"),
    ).toHaveValue(6);

    fireEvent.click(
      screen.getByTestId("frustration-signal-refreshRage-use-defaults"),
    );

    expect(
      screen.getByTestId("frustration-signal-refreshRage-reloadCount"),
    ).toHaveValue(3);
    expect(
      screen.getByTestId("frustration-signal-refreshRage-windowSeconds"),
    ).toHaveValue(60);
    expect(updateByIdMock).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByTestId("frustration-signal-refreshRage-save-rule"),
    );

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });
    expect(savedSettings().refreshRage).toEqual({
      isEnabled: true,
      reloadCount: 3,
      windowSeconds: 60,
    });
  });

  test("a refused rule keeps what was typed and says why", async () => {
    updateByIdMock.mockRejectedValueOnce(new Error("Server said no."));

    await renderPage(null);
    openRule("errorClick");

    fireEvent.change(
      screen.getByTestId("frustration-signal-errorClick-windowMs"),
      {
        target: { value: "2" },
      },
    );
    fireEvent.click(
      screen.getByTestId("frustration-signal-errorClick-save-rule"),
    );

    expect(
      await screen.findByTestId("frustration-signal-errorClick-rule-error"),
    ).toHaveTextContent("Server said no.");
    expect(
      screen.getByTestId("frustration-signal-errorClick-windowMs"),
    ).toHaveValue(2);
    expect(
      screen.getByTestId("frustration-signal-errorClick-definition"),
    ).toHaveTextContent("An error within 1 second of a click.");
  });
});

describe("signals of the application's own", () => {
  function dialog(): HTMLElement {
    return screen.getByTestId("modal");
  }

  async function openAdd(): Promise<HTMLElement> {
    fireEvent.click(screen.getByRole("button", { name: "Add signal" }));

    return await screen.findByTestId("custom-signal-form");
  }

  function pressSave(): void {
    fireEvent.click(within(dialog()).getByTestId("modal-footer-submit-button"));
  }

  test("adds a page signal that only marks the moment", async () => {
    await renderPage(null);
    await openAdd();

    fireEvent.change(screen.getByTestId("custom-signal-name"), {
      target: { value: "  Plan cancelled " },
    });
    fireEvent.click(screen.getByTestId("card-select-option-page"));

    expect(within(dialog()).getByLabelText("Page path")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("custom-signal-match"), {
      target: { value: "/account/cancelled" },
    });
    fireEvent.click(screen.getByTestId("custom-signal-frustration"));
    pressSave();

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    const saved: Array<SessionReplayCustomSignal> =
      savedSettings().customSignals;

    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      name: "Plan cancelled",
      trigger: "page",
      match: "/account/cancelled",
      isFrustration: false,
      isEnabled: true,
    });
    expect(saved[0]!.id.length).toBeGreaterThan(0);

    await waitFor(() => {
      expect(screen.queryByTestId("custom-signal-form")).toBeNull();
    });

    const row: HTMLElement = screen.getByTestId(
      `custom-signal-${saved[0]!.id}`,
    );

    expect(row).toHaveTextContent("Plan cancelled");
    expect(row).toHaveTextContent("Marker");
    expect(
      within(row).getByTestId(`custom-signal-${saved[0]!.id}-trigger`),
    ).toHaveTextContent("The page /account/cancelled");
  });

  test("a new signal counts as frustration until it is told otherwise", async () => {
    await renderPage(null);
    await openAdd();

    expect(screen.getByTestId("custom-signal-frustration")).toHaveAttribute(
      "role",
      "switch",
    );
    expect(screen.getByTestId("custom-signal-frustration")).toHaveAttribute(
      "aria-checked",
      "true",
    );

    fireEvent.change(screen.getByTestId("custom-signal-name"), {
      target: { value: "Support chat opened" },
    });
    fireEvent.change(screen.getByTestId("custom-signal-match"), {
      target: { value: "#open-chat" },
    });
    pressSave();

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });
    expect(savedSettings().customSignals[0]).toMatchObject({
      name: "Support chat opened",
      trigger: "click",
      match: "#open-chat",
      isFrustration: true,
    });
  });

  test("says what is missing, field by field, and sends nothing", async () => {
    await renderPage(null);
    await openAdd();

    pressSave();

    expect(
      await within(dialog()).findByText("Give the signal a name."),
    ).toBeInTheDocument();
    expect(
      within(dialog()).getByText(
        "Enter the CSS selector of the element, such as #pay-button.",
      ),
    ).toBeInTheDocument();
    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("refuses a built-in name, a name already taken and a path without its slash", async () => {
    await renderPage(settingsWith([signal({})]));
    await openAdd();

    fireEvent.change(screen.getByTestId("custom-signal-name"), {
      target: { value: "Rage clicks" },
    });
    fireEvent.click(screen.getByTestId("card-select-option-page"));
    fireEvent.change(screen.getByTestId("custom-signal-match"), {
      target: { value: "checkout/error" },
    });
    pressSave();

    expect(
      await within(dialog()).findByText(
        "Rage clicks is a built-in signal. Give yours its own name.",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog()).getByText(
        "A page path starts with / (or with * to match the end of any path), such as /checkout/error.",
      ),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("custom-signal-name"), {
      target: { value: "payment FAILED" },
    });

    expect(
      within(dialog()).getByText(
        "Another signal is already called payment FAILED.",
      ),
    ).toBeInTheDocument();
    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("keeps what was typed for each kind while another is looked at", async () => {
    await renderPage(null);
    await openAdd();

    fireEvent.change(screen.getByTestId("custom-signal-match"), {
      target: { value: "#pay-button" },
    });
    fireEvent.click(screen.getByTestId("card-select-option-error"));

    expect(screen.getByTestId("custom-signal-match")).toHaveValue("");
    expect(
      within(dialog()).getByLabelText("Text the error contains"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("card-select-option-click"));

    expect(screen.getByTestId("custom-signal-match")).toHaveValue(
      "#pay-button",
    );
  });

  test("a refused save keeps the dialog open with the server's reason", async () => {
    updateByIdMock.mockRejectedValueOnce(
      new Error("Signal names must be unique."),
    );

    await renderPage(null);
    await openAdd();

    fireEvent.change(screen.getByTestId("custom-signal-name"), {
      target: { value: "Card declined" },
    });
    fireEvent.click(screen.getByTestId("card-select-option-error"));
    fireEvent.change(screen.getByTestId("custom-signal-match"), {
      target: { value: "card declined" },
    });
    pressSave();

    expect(
      await within(dialog()).findByText("Signal names must be unique."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("custom-signal-form")).toBeInTheDocument();
  });

  test("lists each signal with its kind and what sets it off", async () => {
    await renderPage(
      settingsWith([
        signal({}),
        signal({
          id: "signal-2",
          name: "Support chat opened",
          trigger: "click",
          match: "#open-chat",
          isFrustration: false,
        }),
        signal({
          id: "signal-3",
          name: "Checkout failed",
          trigger: "event",
          match: "checkout_failed",
        }),
        signal({
          id: "signal-4",
          name: "Card declined",
          trigger: "error",
          match: "card declined",
          isEnabled: false,
        }),
      ]),
    );

    expect(screen.getByTestId("custom-signal-signal-1")).toHaveTextContent(
      "Payment failedFrustrationThe page /checkout/error",
    );
    expect(screen.getByTestId("custom-signal-signal-2")).toHaveTextContent(
      "Support chat openedMarkerA click on #open-chat",
    );
    expect(screen.getByTestId("custom-signal-signal-3")).toHaveTextContent(
      "The event checkout_failed",
    );
    expect(screen.getByTestId("custom-signal-signal-4")).toHaveTextContent(
      "An error containing card declined",
    );
    expect(
      screen.getByRole("switch", { name: "Card declined" }),
    ).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByRole("switch", { name: "Payment failed" }),
    ).toHaveAttribute("aria-checked", "true");
  });

  test("switching a signal off saves it off and keeps it listed", async () => {
    await renderPage(settingsWith([signal({})]));

    fireEvent.click(screen.getByRole("switch", { name: "Payment failed" }));

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });
    expect(savedSettings().customSignals).toEqual([
      signal({ isEnabled: false }),
    ]);
    await waitFor(() => {
      expect(
        screen.getByTestId("custom-signal-signal-1-status"),
      ).toHaveTextContent("Saved");
    });
    expect(
      screen.getByRole("switch", { name: "Payment failed" }),
    ).toHaveAttribute("aria-checked", "false");
  });

  test("Edit changes the signal in place, keeping its id and its switch", async () => {
    await renderPage(
      settingsWith([
        signal({ isEnabled: false }),
        signal({ id: "signal-2", name: "Other", match: "/other" }),
      ]),
    );

    const row: HTMLElement = screen.getByTestId("custom-signal-signal-1");

    fireEvent.click(within(row).getByTestId("row-actions-more-button"));
    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("menuitem", { name: "Edit" }),
    );

    await screen.findByTestId("custom-signal-form");

    expect(screen.getByTestId("custom-signal-name")).toHaveValue(
      "Payment failed",
    );
    expect(screen.getByTestId("custom-signal-match")).toHaveValue(
      "/checkout/error",
    );

    fireEvent.change(screen.getByTestId("custom-signal-name"), {
      target: { value: "Payment error page" },
    });
    pressSave();

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });
    expect(savedSettings().customSignals).toEqual([
      signal({ name: "Payment error page", isEnabled: false }),
      signal({ id: "signal-2", name: "Other", match: "/other" }),
    ]);
  });

  test("Edit lets a signal keep its own name", async () => {
    await renderPage(settingsWith([signal({})]));

    fireEvent.click(
      within(screen.getByTestId("custom-signal-signal-1")).getByTestId(
        "row-actions-more-button",
      ),
    );
    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("menuitem", { name: "Edit" }),
    );

    await screen.findByTestId("custom-signal-form");
    fireEvent.change(screen.getByTestId("custom-signal-match"), {
      target: { value: "/checkout/failed" },
    });
    pressSave();

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });
    expect(savedSettings().customSignals).toEqual([
      signal({ match: "/checkout/failed" }),
    ]);
  });

  test("Delete asks first, then saves the settings without it", async () => {
    await renderPage(
      settingsWith([signal({}), signal({ id: "signal-2", name: "Other" })]),
    );

    fireEvent.click(
      within(screen.getByTestId("custom-signal-signal-1")).getByTestId(
        "row-actions-more-button",
      ),
    );
    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("menuitem", {
        name: "Delete",
      }),
    );

    const confirm: HTMLElement = await screen.findByTestId("modal");

    expect(confirm).toHaveTextContent(
      "Payment failed stops being detected in sessions recorded from now on. Sessions already recorded keep its markers and badges.",
    );
    expect(updateByIdMock).not.toHaveBeenCalled();

    fireEvent.click(within(confirm).getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });
    expect(savedSettings().customSignals).toEqual([
      signal({ id: "signal-2", name: "Other" }),
    ]);

    await waitFor(() => {
      expect(screen.queryByTestId("custom-signal-signal-1")).toBeNull();
    });
  });

  test("at twenty signals, Add signal is locked and says why", async () => {
    const many: Array<SessionReplayCustomSignal> = [];

    for (
      let index: number = 0;
      index < SESSION_REPLAY_MAX_CUSTOM_SIGNALS;
      index++
    ) {
      many.push(
        signal({
          id: `signal-${index}`,
          name: `Signal ${index}`,
          match: `/p${index}`,
        }),
      );
    }

    await renderPage(settingsWith(many));

    const add: HTMLElement = screen.getByRole("button", { name: "Add signal" });

    expect(add).toBeDisabled();

    await act(async () => {
      fireEvent.click(add);
    });

    expect(screen.queryByTestId("custom-signal-form")).toBeNull();
  });
});

describe("a reader who may not edit the application", () => {
  test("sees every setting, every control locked, and why", async () => {
    isMasterAdminMock.mockReturnValue(false);

    await renderPage(settingsWith([signal({})]));

    expect(
      screen.getByTestId("frustration-signals-read-only"),
    ).toHaveTextContent(
      "You can see these settings, but changing them needs permission to edit this RUM application.",
    );
    expect(switchOf("frustration-signal-rageClick")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(
      screen.getByRole("switch", { name: "Payment failed" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByText("Change the rule")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add signal" })).toBeNull();
    expect(screen.queryByTestId("row-actions-more-button")).toBeNull();

    fireEvent.click(switchOf("frustration-signal-rageClick"));
    expect(updateByIdMock).not.toHaveBeenCalled();
  });
});
