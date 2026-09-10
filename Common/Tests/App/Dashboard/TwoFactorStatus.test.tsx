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

const openConfirmation: () => Promise<HTMLElement> =
  async (): Promise<HTMLElement> => {
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Enable two-factor authentication",
        exact: true,
      }),
    );
    return screen.getByRole("dialog", {
      name: "Enable two-factor authentication?",
    });
  };

describe("two-factor authentication status", () => {
  let loadStatus: jest.SpyInstance;
  let enable: jest.SpyInstance;

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
    enable = jest
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
      new Promise<User>((resolve) => {
        finish = resolve;
      }),
    );
    render(<TwoFactorStatus />);

    expect(screen.queryByTestId("two-factor-status")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Enable two-factor/ }),
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
    expect(enable).not.toHaveBeenCalled();
  });

  test("shows enabled status without offering an unsupported self-service disable action", async () => {
    loadStatus.mockResolvedValue(userWithStatus(true));
    render(<TwoFactorStatus />);

    expect(await screen.findByTestId("two-factor-status")).toHaveTextContent(
      "Enabled",
    );
    expect(
      screen.getByText(/An administrator can turn this off/),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Enable|Disable|Turn off|Edit/i }),
    ).not.toBeInTheDocument();
    expect(enable).not.toHaveBeenCalled();
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
        screen.queryByRole("button", { name: /Enable two-factor/ }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
    },
  );

  test("recovers from a failed status request without making an account change", async () => {
    loadStatus.mockRejectedValueOnce(
      new Error("Unable to load account security"),
    );
    render(<TwoFactorStatus />);

    expect(
      await screen.findByText("Unable to load account security"),
    ).toBeVisible();
    expect(screen.queryByTestId("two-factor-status")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("two-factor-status")).toHaveTextContent(
      "Not enabled",
    );
    expect(
      screen.queryByText("Unable to load account security"),
    ).not.toBeInTheDocument();
    expect(loadStatus).toHaveBeenCalledTimes(2);
    expect(enable).not.toHaveBeenCalled();
  });

  test("explains the next sign-in and administrator requirement before enabling, and cancel leaves it unchanged", async () => {
    render(<TwoFactorStatus />);
    const dialog: HTMLElement = await openConfirmation();

    expect(dialog).toHaveTextContent("finish setup at your next sign-in");
    expect(dialog).toHaveTextContent("only an administrator can turn it off");
    expect(enable).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("two-factor-status")).toHaveTextContent(
      "Not enabled",
    );
    expect(enable).not.toHaveBeenCalled();
  });

  test("sends one enable request and waits for the server before changing status", async () => {
    let finish: (() => void) | undefined;
    enable.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    render(<TwoFactorStatus />);
    const dialog: HTMLElement = await openConfirmation();
    const submit: HTMLElement = within(dialog).getByRole("button", {
      name: "Enable two-factor authentication",
    });

    act(() => {
      fireEvent.click(submit);
      fireEvent.click(submit);
    });
    expect(enable).toHaveBeenCalledTimes(1);
    expect(enable).toHaveBeenCalledWith({
      modelType: User,
      id: userId,
      data: { enableTwoFactorAuth: true },
    });
    expect(submit).toBeDisabled();
    expect(screen.getByTestId("two-factor-status")).toHaveTextContent(
      "Not enabled",
    );
    expect(
      within(dialog).queryByRole("button", { name: "Cancel" }),
    ).not.toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(dialog).toBeInTheDocument();

    await act(async () => {
      finish!();
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("two-factor-status")).toHaveTextContent(
      "Enabled",
    );
    expect(
      screen.queryByRole("button", {
        name: "Enable two-factor authentication",
      }),
    ).not.toBeInTheDocument();
  });

  test("keeps a failed update visible and supports retrying in the same confirmation", async () => {
    enable.mockRejectedValueOnce(
      new Error("Your account could not be updated"),
    );
    render(<TwoFactorStatus />);
    const dialog: HTMLElement = await openConfirmation();
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "Enable two-factor authentication",
      }),
    );

    expect(
      await within(dialog).findByText("Your account could not be updated"),
    ).toBeVisible();
    expect(screen.getByTestId("two-factor-status")).toHaveTextContent(
      "Not enabled",
    );
    expect(
      within(dialog).getByRole("button", {
        name: "Enable two-factor authentication",
      }),
    ).toBeEnabled();
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "Enable two-factor authentication",
      }),
    );
    await screen.findByText("Enabled", { exact: true });
    expect(enable).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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
