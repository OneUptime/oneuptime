import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import TwoFactorStatus from "../../../../App/FeatureSet/Dashboard/src/Components/TwoFactorAuth/TwoFactorStatus";
import User from "../../../Models/DatabaseModels/User";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { TwoFactorAuthSetup } from "../../../Types/TwoFactorAuthSetup";
import TwoFactorAuthStatus from "../../../Types/TwoFactorAuthStatus";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import UserUtil from "../../../UI/Utils/User";

/*
 * THE TWO-FACTOR AUTHENTICATION CARD (issue #9666).
 *
 * It switched the setting on whatever stood behind it: with no authenticator
 * app, security key or passkey, Enable turned it on, and the card said
 * "Enabled" in green over "No security keys added yet". It reads where the
 * person stands now (GET /user/two-factor-auth-status) and offers only what
 * the server allows:
 *
 *   - off with nothing set up: Enable starts setting up a second step (the
 *     page's guided setup), and turns nothing on itself;
 *   - off with a second step ready: Enable asks, then turns it on;
 *   - on: Turn off asks, then turns it off;
 *   - on with nothing set up: "Setup needed", never "Enabled", with why,
 *     Finish setup and Turn off.
 */

const userId: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

const answer: (status: TwoFactorAuthStatus, count: number) => JSONObject = (
  status: TwoFactorAuthStatus,
  count: number,
): JSONObject => {
  return { status: status, verifiedMethodCount: count };
};

const OFF_WITH_NOTHING: JSONObject = answer(TwoFactorAuthStatus.NotEnabled, 0);
const OFF_WITH_AN_APP: JSONObject = answer(TwoFactorAuthStatus.NotEnabled, 1);
const ON: JSONObject = answer(TwoFactorAuthStatus.EnabledConfigured, 1);
const ON_WITH_NOTHING: JSONObject = answer(
  TwoFactorAuthStatus.EnabledPendingSetup,
  0,
);

const ENABLE: string = "Enable two-factor authentication";
const TURN_OFF: string = "Turn off two-factor authentication";

describe("two-factor authentication status", () => {
  let readStatus: jest.SpyInstance;
  let updateStatus: jest.SpyInstance;
  // What the server says, read after read: the last one repeats.
  let answers: Array<JSONObject | Error>;

  const respond: () => Promise<HTTPResponse<JSONObject>> = async (): Promise<
    HTTPResponse<JSONObject>
  > => {
    const next: JSONObject | Error | undefined =
      answers.length > 1 ? answers.shift() : answers[0];

    if (next instanceof Error) {
      throw next;
    }

    return new HTTPResponse<JSONObject>(200, next || {}, {});
  };

  beforeEach(() => {
    answers = [OFF_WITH_NOTHING];
    jest.spyOn(UserUtil, "getUserId").mockReturnValue(userId);
    jest
      .spyOn(API, "getFriendlyMessage")
      .mockImplementation((error: unknown): string => {
        return (error as Error).message;
      });
    readStatus = jest.spyOn(API, "get").mockImplementation(respond);
    updateStatus = jest
      .spyOn(ModelAPI, "updateById")
      .mockResolvedValue(new HTTPResponse<JSONObject>(200, {}, {}));
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  const badge: () => Promise<HTMLElement> = async (): Promise<HTMLElement> => {
    return await screen.findByTestId("two-factor-status");
  };

  test("reads where the person stands before offering anything", async () => {
    let finish: ((response: HTTPResponse<JSONObject>) => void) | undefined;
    readStatus.mockReturnValue(
      new Promise<HTTPResponse<JSONObject>>(
        (resolve: (response: HTTPResponse<JSONObject>) => void) => {
          finish = resolve;
        },
      ),
    );
    render(<TwoFactorStatus />);

    expect(screen.queryByTestId("two-factor-status")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Enable|Turn off|Finish setup/ }),
    ).not.toBeInTheDocument();
    expect(String(readStatus.mock.calls[0]![0].url)).toMatch(
      /\/user\/two-factor-auth-status$/,
    );

    await act(async () => {
      finish!(new HTTPResponse<JSONObject>(200, OFF_WITH_NOTHING, {}));
    });

    expect(screen.getByTestId("two-factor-status")).toHaveTextContent(
      "Not enabled",
    );
    expect(screen.getByRole("button", { name: ENABLE })).toBeEnabled();
  });

  describe("off, with nothing set up", () => {
    test("Enable starts setting up a second step, and turns nothing on itself", async () => {
      const onStartSetup: jest.Mock = jest.fn();
      render(<TwoFactorStatus onStartSetup={onStartSetup} />);

      expect(await badge()).toHaveTextContent("Not enabled");
      expect(
        screen.getByText(
          "Turn it on to set up an authenticator app or a security key as the second step of your sign-in.",
        ),
      ).toBeVisible();

      fireEvent.click(screen.getByRole("button", { name: ENABLE }));

      expect(onStartSetup).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(updateStatus).not.toHaveBeenCalled();
    });

    test("is never said to be enabled", async () => {
      render(<TwoFactorStatus />);

      expect(await badge()).not.toHaveTextContent(/^Enabled$/);
      expect(
        screen.queryByRole("button", { name: TURN_OFF }),
      ).not.toBeInTheDocument();
    });
  });

  describe("off, with a second step ready", () => {
    beforeEach(() => {
      answers = [OFF_WITH_AN_APP, ON];
    });

    test("Enable says what changes, and Cancel changes nothing", async () => {
      render(<TwoFactorStatus />);
      expect(await badge()).toHaveTextContent("Not enabled");
      expect(
        screen.getByText(
          "Your second step is ready. Turn on two-factor authentication to ask for it each time you sign in with a password.",
        ),
      ).toBeVisible();

      fireEvent.click(screen.getByRole("button", { name: ENABLE }));
      const dialog: HTMLElement = screen.getByRole("dialog", {
        name: `${ENABLE}?`,
      });

      expect(dialog).toHaveTextContent(
        "Signing in with a password or an emailed link will then ask for your second step: an authenticator app, a security key or a passkey.",
      );
      // The old promise that setup happens at the next sign-in is gone.
      expect(dialog).not.toHaveTextContent(/next sign-in/);

      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(updateStatus).not.toHaveBeenCalled();
    });

    test("turns it on once confirmed, with one request, and reads again", async () => {
      render(<TwoFactorStatus />);
      await badge();

      fireEvent.click(screen.getByRole("button", { name: ENABLE }));
      const dialog: HTMLElement = screen.getByRole("dialog", {
        name: `${ENABLE}?`,
      });
      const submit: HTMLElement = within(dialog).getByRole("button", {
        name: ENABLE,
      });

      await act(async () => {
        fireEvent.click(submit);
        fireEvent.click(submit);
      });

      expect(updateStatus).toHaveBeenCalledTimes(1);
      expect(updateStatus).toHaveBeenCalledWith({
        modelType: User,
        id: userId,
        data: { enableTwoFactorAuth: true },
      });
      expect(await screen.findByText("Enabled", { exact: true })).toBeVisible();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(readStatus).toHaveBeenCalledTimes(2);
      expect(screen.getByRole("button", { name: TURN_OFF })).toBeEnabled();
    });

    test("keeps a refusal in the dialog, says it, and retries the same change", async () => {
      updateStatus.mockRejectedValueOnce(
        new Error(
          "Set up an authenticator app, a security key or a passkey first, then turn on two factor authentication.",
        ),
      );
      render(<TwoFactorStatus />);
      await badge();

      fireEvent.click(screen.getByRole("button", { name: ENABLE }));
      const dialog: HTMLElement = screen.getByRole("dialog", {
        name: `${ENABLE}?`,
      });
      fireEvent.click(within(dialog).getByRole("button", { name: ENABLE }));

      expect(
        await within(dialog).findByText(
          "Set up an authenticator app, a security key or a passkey first, then turn on two factor authentication.",
        ),
      ).toBeVisible();
      expect(screen.getByTestId("two-factor-status")).toHaveTextContent(
        "Not enabled",
      );

      fireEvent.click(within(dialog).getByRole("button", { name: ENABLE }));
      expect(await screen.findByText("Enabled", { exact: true })).toBeVisible();
      expect(updateStatus).toHaveBeenCalledTimes(2);
    });
  });

  describe("on", () => {
    beforeEach(() => {
      answers = [ON, OFF_WITH_AN_APP];
    });

    test("says Enabled and what it asks for, and offers Turn off only", async () => {
      render(<TwoFactorStatus />);

      expect(await badge()).toHaveTextContent("Enabled");
      expect(
        screen.getByText(
          "Use an authenticator app or security key for your second step.",
        ),
      ).toBeVisible();
      expect(screen.getByRole("button", { name: TURN_OFF })).toBeEnabled();
      expect(
        screen.queryByRole("button", { name: ENABLE }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(/administrator/i)).not.toBeInTheDocument();
    });

    test.each(["Cancel", "Escape"])(
      "Turn off explains itself, and %s keeps it on",
      async (dismissal: string) => {
        render(<TwoFactorStatus />);
        await badge();

        fireEvent.click(screen.getByRole("button", { name: TURN_OFF }));
        const dialog: HTMLElement = screen.getByRole("dialog", {
          name: `${TURN_OFF}?`,
        });

        expect(dialog).toHaveTextContent(
          "You will no longer be asked for a second step when signing in with a password.",
        );
        expect(dialog).toHaveTextContent(
          "Your authenticator apps and security keys stay saved.",
        );

        if (dismissal === "Cancel") {
          fireEvent.click(
            within(dialog).getByRole("button", { name: "Cancel" }),
          );
        } else {
          fireEvent.keyDown(dialog, { key: "Escape" });
        }

        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(screen.getByTestId("two-factor-status")).toHaveTextContent(
          "Enabled",
        );
        expect(updateStatus).not.toHaveBeenCalled();
      },
    );

    test("turns it off once confirmed, and then offers to turn it back on", async () => {
      render(<TwoFactorStatus />);
      await badge();

      fireEvent.click(screen.getByRole("button", { name: TURN_OFF }));
      const dialog: HTMLElement = screen.getByRole("dialog", {
        name: `${TURN_OFF}?`,
      });
      await act(async () => {
        fireEvent.click(within(dialog).getByRole("button", { name: TURN_OFF }));
      });

      expect(updateStatus).toHaveBeenCalledWith({
        modelType: User,
        id: userId,
        data: { enableTwoFactorAuth: false },
      });
      expect(
        await screen.findByText("Not enabled", { exact: true }),
      ).toBeVisible();
      expect(screen.getByRole("button", { name: ENABLE })).toBeEnabled();
    });
  });

  describe("on, with nothing set up (#9666)", () => {
    beforeEach(() => {
      answers = [ON_WITH_NOTHING];
    });

    test("says Setup needed, never Enabled, and why it does not protect the account", async () => {
      render(<TwoFactorStatus />);

      expect(await badge()).toHaveTextContent("Setup needed");
      expect(screen.getByTestId("two-factor-status")).not.toHaveTextContent(
        /^Enabled$/,
      );
      expect(
        screen.getByText(
          "Two-factor authentication is on, but no second step is set up yet, so it does not protect your account. Set one up now, or you will be asked to at your next sign-in.",
        ),
      ).toBeVisible();
    });

    test("Finish setup starts setting up a second step", async () => {
      const onStartSetup: jest.Mock = jest.fn();
      render(<TwoFactorStatus onStartSetup={onStartSetup} />);
      await badge();

      fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));

      expect(onStartSetup).toHaveBeenCalledTimes(1);
      expect(updateStatus).not.toHaveBeenCalled();
    });

    test("Turn off is there too, for somebody who would rather not", async () => {
      answers = [ON_WITH_NOTHING, OFF_WITH_NOTHING];
      render(<TwoFactorStatus />);
      await badge();

      fireEvent.click(screen.getByRole("button", { name: TURN_OFF }));
      const dialog: HTMLElement = screen.getByRole("dialog", {
        name: `${TURN_OFF}?`,
      });
      await act(async () => {
        fireEvent.click(within(dialog).getByRole("button", { name: TURN_OFF }));
      });

      expect(updateStatus).toHaveBeenCalledWith({
        modelType: User,
        id: userId,
        data: { enableTwoFactorAuth: false },
      });
      expect(
        await screen.findByText("Not enabled", { exact: true }),
      ).toBeVisible();
    });
  });

  describe("when where the person stands cannot be read", () => {
    test.each([
      ["an empty answer", {}],
      ["an unknown status", { status: "Enabled", verifiedMethodCount: 1 }],
      [
        "configured over nothing",
        { status: "EnabledConfigured", verifiedMethodCount: 0 },
      ],
    ])(
      "%s is not taken for off: it says so, and offers nothing but Try again",
      async (_label: string, value: JSONObject) => {
        answers = [value];
        render(<TwoFactorStatus />);

        expect(
          await screen.findByText(
            "Your two-factor authentication status could not be loaded.",
          ),
        ).toBeVisible();
        expect(
          screen.queryByTestId("two-factor-status"),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByRole("button", {
            name: /Enable|Turn off|Finish setup/,
          }),
        ).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
      },
    );

    test("a failed read recovers with Try again, changing nothing", async () => {
      answers = [new Error("Unable to load account security"), ON];
      render(<TwoFactorStatus />);

      expect(
        await screen.findByText("Unable to load account security"),
      ).toBeVisible();

      fireEvent.click(screen.getByRole("button", { name: "Try again" }));

      expect(await badge()).toHaveTextContent("Enabled");
      expect(
        screen.queryByText("Unable to load account security"),
      ).not.toBeInTheDocument();
      expect(readStatus).toHaveBeenCalledTimes(2);
      expect(updateStatus).not.toHaveBeenCalled();
    });
  });

  describe("for the page", () => {
    test("tells it what was read", async () => {
      const onSetupLoaded: jest.Mock = jest.fn();
      answers = [ON];
      render(<TwoFactorStatus onSetupLoaded={onSetupLoaded} />);
      await badge();

      expect(onSetupLoaded).toHaveBeenLastCalledWith({
        status: TwoFactorAuthStatus.EnabledConfigured,
        verifiedMethodCount: 1,
      } as TwoFactorAuthSetup);
    });

    test("reads again when the page says a second step changed", async () => {
      answers = [OFF_WITH_NOTHING, OFF_WITH_AN_APP];
      const { rerender } = render(<TwoFactorStatus refreshToggle={0} />);
      expect(
        await screen.findByText(
          "Turn it on to set up an authenticator app or a security key as the second step of your sign-in.",
        ),
      ).toBeVisible();

      rerender(<TwoFactorStatus refreshToggle={1} />);

      expect(
        await screen.findByText(
          "Your second step is ready. Turn on two-factor authentication to ask for it each time you sign in with a password.",
        ),
      ).toBeVisible();
      expect(readStatus).toHaveBeenCalledTimes(2);
    });

    test("stops reading when the page goes", () => {
      readStatus.mockReturnValue(
        new Promise<HTTPResponse<JSONObject>>(() => {}),
      );
      const { unmount } = render(<TwoFactorStatus />);
      const signal: AbortSignal = readStatus.mock.calls[0]![0].options.signal;

      expect(signal.aborted).toBe(false);
      unmount();
      expect(signal.aborted).toBe(true);
    });
  });
});
