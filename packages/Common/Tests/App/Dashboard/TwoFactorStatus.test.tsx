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
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import UserUtil from "../../../UI/Utils/User";

const userId: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

const userWithStatus: (enabled: boolean) => User = (enabled: boolean): User => {
  const user: User = new User();
  user.enableTwoFactorAuth = enabled;
  return user;
};

const actionForStatus: (isEnabled: boolean) => string = (
  isEnabled: boolean,
): string => {
  return isEnabled
    ? "Turn off two-factor authentication"
    : "Enable two-factor authentication";
};

const openConfirmation: (isEnabled?: boolean) => Promise<HTMLElement> = async (
  isEnabled: boolean = false,
): Promise<HTMLElement> => {
  const action: string = actionForStatus(isEnabled);
  fireEvent.click(
    await screen.findByRole("button", {
      name: action,
      exact: true,
    }),
  );
  return screen.getByRole("dialog", {
    name: `${action}?`,
  });
};

describe("two-factor authentication status", () => {
  let loadStatus: jest.SpyInstance;
  let updateStatus: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(UserUtil, "getUserId").mockReturnValue(userId);
    jest
      .spyOn(API, "getFriendlyMessage")
      .mockImplementation((error: unknown): string => {
        return (error as Error).message;
      });
    loadStatus = jest
      .spyOn(ModelAPI, "getItem")
      .mockResolvedValue(userWithStatus(false));
    updateStatus = jest
      .spyOn(ModelAPI, "updateById")
      .mockResolvedValue(new HTTPResponse<JSONObject>(200, {}, {}));
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("loads the current user's status before offering an action", async () => {
    let finish: ((user: User) => void) | undefined;
    loadStatus.mockReturnValue(
      new Promise<User>((resolve: (user: User) => void) => {
        finish = resolve;
      }),
    );
    render(<TwoFactorStatus />);

    expect(screen.queryByTestId("two-factor-status")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Enable|Turn off two-factor/ }),
    ).not.toBeInTheDocument();
    expect(loadStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        modelType: User,
        id: userId,
        select: { enableTwoFactorAuth: true },
      }),
    );

    await act(async () => {
      finish!(userWithStatus(false));
    });
    expect(screen.getByTestId("two-factor-status")).toHaveTextContent(
      "Not enabled",
    );
    expect(
      screen.getByRole("button", { name: "Enable two-factor authentication" }),
    ).toBeEnabled();
    expect(updateStatus).not.toHaveBeenCalled();
  });

  test("lets the current user turn off enabled two-factor authentication", async () => {
    loadStatus.mockResolvedValue(userWithStatus(true));
    render(<TwoFactorStatus />);

    expect(await screen.findByTestId("two-factor-status")).toHaveTextContent(
      "Enabled",
    );
    expect(
      screen.getByText(
        "Use an authenticator app or security key for your second step.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "Turn off two-factor authentication",
      }),
    ).toBeEnabled();
    expect(screen.queryByText(/administrator/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Enable two-factor authentication",
      }),
    ).not.toBeInTheDocument();
    expect(updateStatus).not.toHaveBeenCalled();
  });

  test.each(["missing user", "missing setting"])(
    "does not interpret missing status as disabled: %s",
    async (missing: string) => {
      loadStatus.mockResolvedValue(
        missing === "missing user" ? null : new User(),
      );
      render(<TwoFactorStatus />);

      expect(
        await screen.findByText(
          "Your two-factor authentication status could not be loaded.",
        ),
      ).toBeVisible();
      expect(screen.queryByTestId("two-factor-status")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /Enable|Turn off two-factor/ }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
    },
  );

  test.each([false, true])(
    "recovers from a failed status request without making an account change: enabled %s",
    async (isEnabled: boolean) => {
      loadStatus
        .mockRejectedValueOnce(new Error("Unable to load account security"))
        .mockResolvedValueOnce(userWithStatus(isEnabled));
      render(<TwoFactorStatus />);

      expect(
        await screen.findByText("Unable to load account security"),
      ).toBeVisible();
      expect(screen.queryByTestId("two-factor-status")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /Enable|Turn off two-factor/ }),
      ).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(await screen.findByTestId("two-factor-status")).toHaveTextContent(
        isEnabled ? "Enabled" : "Not enabled",
      );
      expect(
        screen.getByRole("button", { name: actionForStatus(isEnabled) }),
      ).toBeEnabled();
      expect(
        screen.queryByText("Unable to load account security"),
      ).not.toBeInTheDocument();
      expect(loadStatus).toHaveBeenCalledTimes(2);
      expect(updateStatus).not.toHaveBeenCalled();
    },
  );

  test("explains the next sign-in before enabling, and cancel leaves it unchanged", async () => {
    render(<TwoFactorStatus />);
    const dialog: HTMLElement = await openConfirmation();

    expect(dialog).toHaveTextContent("finish setup at your next sign-in");
    expect(dialog).not.toHaveTextContent(/administrator/i);
    expect(updateStatus).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("two-factor-status")).toHaveTextContent(
      "Not enabled",
    );
    expect(updateStatus).not.toHaveBeenCalled();
  });

  test.each(["Cancel", "Escape"])(
    "explains turning off two-factor authentication and preserves the account when dismissed with %s",
    async (dismissal: string) => {
      loadStatus.mockResolvedValue(userWithStatus(true));
      render(<TwoFactorStatus />);
      const dialog: HTMLElement = await openConfirmation(true);

      expect(dialog).toHaveTextContent(
        "You will no longer be asked for a second step when signing in with a password.",
      );
      expect(dialog).toHaveTextContent(
        "Your authenticator apps and security keys will stay saved so you can enable it again.",
      );
      expect(dialog).not.toHaveTextContent(/administrator/i);
      expect(updateStatus).not.toHaveBeenCalled();
      expect(screen.getByTestId("two-factor-status")).toHaveTextContent(
        "Enabled",
      );

      if (dismissal === "Cancel") {
        fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
      } else {
        fireEvent.keyDown(dialog, { key: "Escape" });
      }

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getByTestId("two-factor-status")).toHaveTextContent(
        "Enabled",
      );
      expect(
        screen.getByRole("button", {
          name: "Turn off two-factor authentication",
        }),
      ).toBeEnabled();
      expect(updateStatus).not.toHaveBeenCalled();
    },
  );

  test.each([false, true])(
    "sends one confirmed request and waits for the server before changing status: initially enabled %s",
    async (isEnabled: boolean) => {
      let finish: (() => void) | undefined;
      loadStatus.mockResolvedValue(userWithStatus(isEnabled));
      updateStatus.mockReturnValue(
        new Promise<void>((resolve: () => void) => {
          finish = resolve;
        }),
      );
      render(<TwoFactorStatus />);
      const dialog: HTMLElement = await openConfirmation(isEnabled);
      const submit: HTMLElement = within(dialog).getByRole("button", {
        name: actionForStatus(isEnabled),
      });
      expect(updateStatus).not.toHaveBeenCalled();

      act(() => {
        fireEvent.click(submit);
        fireEvent.click(submit);
      });
      expect(updateStatus).toHaveBeenCalledTimes(1);
      expect(updateStatus).toHaveBeenCalledWith({
        modelType: User,
        id: userId,
        data: { enableTwoFactorAuth: !isEnabled },
      });
      expect(submit).toBeDisabled();
      expect(screen.getByTestId("two-factor-status")).toHaveTextContent(
        isEnabled ? "Enabled" : "Not enabled",
      );
      expect(
        within(dialog).queryByRole("button", { name: "Cancel" }),
      ).not.toBeInTheDocument();
      expect(
        within(dialog).queryByRole("button", { name: "Close" }),
      ).not.toBeInTheDocument();
      fireEvent.keyDown(dialog, { key: "Escape" });
      expect(dialog).toBeInTheDocument();
      expect(updateStatus).toHaveBeenCalledTimes(1);

      await act(async () => {
        finish!();
      });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getByTestId("two-factor-status")).toHaveTextContent(
        isEnabled ? "Not enabled" : "Enabled",
      );
      expect(
        screen.getByRole("button", { name: actionForStatus(!isEnabled) }),
      ).toBeEnabled();
      expect(
        screen.queryByRole("button", { name: actionForStatus(isEnabled) }),
      ).not.toBeInTheDocument();
    },
  );

  test.each([false, true])(
    "keeps a failed update visible and retries the same requested status: initially enabled %s",
    async (isEnabled: boolean) => {
      loadStatus.mockResolvedValue(userWithStatus(isEnabled));
      updateStatus.mockRejectedValueOnce(
        new Error("Your account could not be updated"),
      );
      render(<TwoFactorStatus />);
      const dialog: HTMLElement = await openConfirmation(isEnabled);
      fireEvent.click(
        within(dialog).getByRole("button", {
          name: actionForStatus(isEnabled),
        }),
      );

      expect(
        await within(dialog).findByText("Your account could not be updated"),
      ).toBeVisible();
      expect(screen.getByTestId("two-factor-status")).toHaveTextContent(
        isEnabled ? "Enabled" : "Not enabled",
      );
      const retry: HTMLElement = within(dialog).getByRole("button", {
        name: actionForStatus(isEnabled),
      });
      expect(retry).toBeEnabled();
      expect(
        within(dialog).getByRole("button", { name: "Cancel" }),
      ).toBeEnabled();
      fireEvent.click(retry);
      await screen.findByText(isEnabled ? "Not enabled" : "Enabled", {
        exact: true,
      });
      expect(updateStatus).toHaveBeenCalledTimes(2);
      for (const call of [1, 2]) {
        expect(updateStatus).toHaveBeenNthCalledWith(call, {
          modelType: User,
          id: userId,
          data: { enableTwoFactorAuth: !isEnabled },
        });
      }
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: actionForStatus(!isEnabled) }),
      ).toBeEnabled();
    },
  );

  test.each([false, true])(
    "clears a failed update when its confirmation is closed and reopened: initially enabled %s",
    async (isEnabled: boolean) => {
      loadStatus.mockResolvedValue(userWithStatus(isEnabled));
      updateStatus.mockRejectedValueOnce(new Error("Please try again later"));
      render(<TwoFactorStatus />);
      const dialog: HTMLElement = await openConfirmation(isEnabled);
      fireEvent.click(
        within(dialog).getByRole("button", {
          name: actionForStatus(isEnabled),
        }),
      );
      expect(
        await within(dialog).findByText("Please try again later"),
      ).toBeVisible();

      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getByTestId("two-factor-status")).toHaveTextContent(
        isEnabled ? "Enabled" : "Not enabled",
      );

      const reopened: HTMLElement = await openConfirmation(isEnabled);
      expect(
        within(reopened).queryByText("Please try again later"),
      ).not.toBeInTheDocument();
      expect(
        within(reopened).getByRole("button", {
          name: actionForStatus(isEnabled),
        }),
      ).toBeEnabled();
      expect(updateStatus).toHaveBeenCalledTimes(1);
    },
  );

  test("can enable two-factor authentication again after turning it off", async () => {
    loadStatus.mockResolvedValue(userWithStatus(true));
    render(<TwoFactorStatus />);
    const turnOffDialog: HTMLElement = await openConfirmation(true);
    fireEvent.click(
      within(turnOffDialog).getByRole("button", {
        name: "Turn off two-factor authentication",
      }),
    );
    await screen.findByText("Not enabled", { exact: true });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const enableDialog: HTMLElement = await openConfirmation();
    expect(enableDialog).toHaveTextContent("finish setup at your next sign-in");
    expect(enableDialog).not.toHaveTextContent(/administrator/i);
    fireEvent.click(
      within(enableDialog).getByRole("button", {
        name: "Enable two-factor authentication",
      }),
    );
    await screen.findByText("Enabled", { exact: true });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(updateStatus).toHaveBeenCalledTimes(2);
    expect(updateStatus).toHaveBeenNthCalledWith(1, {
      modelType: User,
      id: userId,
      data: { enableTwoFactorAuth: false },
    });
    expect(updateStatus).toHaveBeenNthCalledWith(2, {
      modelType: User,
      id: userId,
      data: { enableTwoFactorAuth: true },
    });
    expect(
      screen.getByRole("button", {
        name: "Turn off two-factor authentication",
      }),
    ).toBeEnabled();
  });

  test("aborts a status request when the page unmounts", () => {
    loadStatus.mockReturnValue(new Promise<User>(() => {}));
    const { unmount } = render(<TwoFactorStatus />);
    const signal: AbortSignal =
      loadStatus.mock.calls[0][0].requestOptions.apiRequestOptions.signal;
    expect(signal.aborted).toBe(false);
    unmount();
    expect(signal.aborted).toBe(true);
  });
});
