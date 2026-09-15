import React from "react";
import { Alert, StyleSheet } from "react-native";
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react-native";
import { beforeEach, afterEach, describe, expect, test } from "@jest/globals";
import OnCallOverridesScreen from "./OnCallOverridesScreen";
import { lightColors } from "../theme/colors";
import { radius } from "../theme/tokens";
import type { OnCallOverrideItem } from "../api/types";
import type { UseOnCallOverridesResult } from "../hooks/useOnCallOverrides";

const mockNavigate: jest.Mock = jest.fn();
const mockCancel: jest.Mock = jest.fn();
const mockRefetch: jest.Mock = jest.fn();
const mockOverrides: { current: UseOnCallOverridesResult } = {
  current: {} as UseOnCallOverridesResult,
};
jest.mock("@react-navigation/native", () => {
  return {
    useNavigation: () => {
      return { navigate: mockNavigate };
    },
  };
});
jest.mock("../hooks/useOnCallOverrides", () => {
  return {
    useOnCallOverrides: () => {
      return mockOverrides.current;
    },
  };
});
jest.mock("../hooks/useCurrentUserId", () => {
  return {
    useCurrentUserId: () => {
      return "me";
    },
  };
});
jest.mock("../hooks/useNow", () => {
  return {
    useNow: () => {
      return new Date("2026-09-10T09:00:00Z").getTime();
    },
  };
});
jest.mock("../hooks/useHaptics", () => {
  return {
    useHaptics: () => {
      return {
        lightImpact: jest.fn(),
        successFeedback: jest.fn(),
        errorFeedback: jest.fn(),
      };
    },
  };
});

function override(id: string): OnCallOverrideItem {
  return {
    _id: id,
    projectId: "production",
    projectName: "Production",
    overrideUser: { _id: "me", name: "Sam" },
    routeAlertsToUser: { _id: "priya", name: "Priya" },
    onCallDutyPolicy: null,
    startsAt: "2026-09-10T08:00:00Z",
    endsAt: "2026-09-10T16:00:00Z",
    createdAt: "2026-09-10T07:00:00Z",
  };
}

describe("Coverage management", () => {
  let alertSpy: jest.SpyInstance;
  beforeEach(() => {
    mockNavigate.mockReset();
    mockCancel.mockReset();
    mockRefetch.mockReset();
    mockOverrides.current = {
      active: [],
      upcoming: [],
      past: [],
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
      cancelOverride: mockCancel,
      isCancelling: false,
      createOverride: jest.fn(),
      isCreating: false,
    };
    alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {
      return undefined;
    });
  });
  afterEach(() => {
    alertSpy.mockRestore();
  });

  test("makes arranging cover available when no overrides exist", async (): Promise<void> => {
    await render(<OnCallOverridesScreen />);
    expect(screen.getByText(/No overrides yet/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId("new-override"));
    expect(mockNavigate).toHaveBeenCalledWith("CreateOnCallOverride");
    expect(
      screen.getByTestId("overrides-scroll").props.contentContainerStyle
        .paddingBottom,
    ).toBeGreaterThanOrEqual(124);
  });

  test("separates active, upcoming and ended cover and only allows cancelling live arrangements", async (): Promise<void> => {
    mockOverrides.current.active = [override("active")];
    mockOverrides.current.upcoming = [override("upcoming")];
    mockOverrides.current.past = [override("past")];
    await render(<OnCallOverridesScreen />);
    expect(screen.getByTestId("coverage-counts")).toBeTruthy();
    expect(screen.getByTestId("override-cancel-active")).toBeTruthy();
    expect(screen.getByTestId("override-cancel-upcoming")).toBeTruthy();
    expect(screen.queryByTestId("override-cancel-past")).toBeNull();
    expect(screen.getAllByText("Your pages go to Priya")).toHaveLength(3);
  });

  test("requires explicit destructive confirmation before cancelling the exact arrangement", async (): Promise<void> => {
    const active: OnCallOverrideItem = override("active");
    mockOverrides.current.active = [active];
    await render(<OnCallOverridesScreen />);
    await fireEvent.press(screen.getByTestId("override-cancel-active"));
    expect(mockCancel).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(
      "Cancel this override?",
      "Pages will go back to whoever the schedule says is on call.",
      expect.any(Array),
    );
    const buttons: Array<{
      text: string;
      style?: string;
      onPress?: () => void;
    }> = alertSpy.mock.calls[0]![2];
    expect(
      buttons.find(
        (button: { text: string; style?: string; onPress?: () => void }) => {
          return button.text === "Keep it";
        },
      )?.style,
    ).toBe("cancel");
    const confirm:
      | { text: string; style?: string; onPress?: () => void }
      | undefined = buttons.find(
      (button: { text: string; style?: string; onPress?: () => void }) => {
        return button.style === "destructive";
      },
    );
    confirm?.onPress?.();
    await waitFor(() => {
      expect(mockCancel).toHaveBeenCalledWith(active);
    });
  });

  test("shows a cancellation refusal and keeps the coverage visible", async (): Promise<void> => {
    mockOverrides.current.active = [override("active")];
    mockCancel.mockImplementation(async () => {
      throw new Error("Coverage cannot be changed");
    });
    await render(<OnCallOverridesScreen />);
    await fireEvent.press(screen.getByTestId("override-cancel-active"));
    const buttons: Array<{ style?: string; onPress?: () => void }> =
      alertSpy.mock.calls[0]![2];
    buttons
      .find((button: { style?: string; onPress?: () => void }) => {
        return button.style === "destructive";
      })
      ?.onPress?.();
    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        "Could not cancel override",
        "Coverage cannot be changed",
      );
    });
    expect(screen.getByTestId("override-card-active")).toBeTruthy();
  });

  test("offers retry when coverage cannot be loaded", async (): Promise<void> => {
    mockOverrides.current.isError = true;
    await render(<OnCallOverridesScreen />);
    expect(screen.queryByText(/No overrides yet/)).toBeNull();
    await fireEvent.press(screen.getByText("Retry"));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  test("does not show an empty coverage claim during loading", async (): Promise<void> => {
    mockOverrides.current.isLoading = true;
    await render(<OnCallOverridesScreen />);
    expect(screen.queryByText(/No overrides yet/)).toBeNull();
    expect(screen.queryByTestId("coverage-counts")).toBeNull();
  });
});

describe("Refresh recovery", () => {
  test.each([false, true])(
    "keeps refresh available and visible while pending (error: %s)",
    async (isError: boolean) => {
      let finish: () => void = (): void => {};
      const refresh: jest.Mock = jest.fn(() => {
        return new Promise<void>((resolve: () => void) => {
          finish = resolve;
        });
      });
      mockOverrides.current = {
        active: [],
        upcoming: [],
        past: [],
        isLoading: false,
        isError,
        refetch: refresh,
        cancelOverride: jest.fn(),
        isCancelling: false,
        createOverride: jest.fn(),
        isCreating: false,
      };
      await render(<OnCallOverridesScreen />);
      expect(screen.getByText("Coverage")).toBeTruthy();
      let request: Promise<void>;
      await act(() => {
        request = screen
          .getByTestId("overrides-scroll")
          .props.refreshControl.props.onRefresh();
      });
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(
        screen.getByTestId("overrides-scroll").props.refreshControl.props
          .refreshing,
      ).toBe(true);
      await act(async () => {
        finish();
        await request;
      });
      expect(
        screen.getByTestId("overrides-scroll").props.refreshControl.props
          .refreshing,
      ).toBe(false);
    },
  );
});

describe("Coverage layout", () => {
  let alertSpy: jest.SpyInstance;
  beforeEach(() => {
    mockNavigate.mockReset();
    mockCancel.mockReset();
    mockRefetch.mockReset();
    mockOverrides.current = {
      active: [],
      upcoming: [],
      past: [],
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
      cancelOverride: mockCancel,
      isCancelling: false,
      createOverride: jest.fn(),
      isCreating: false,
    };
    alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {
      return undefined;
    });
  });
  afterEach(() => {
    alertSpy.mockRestore();
  });

  test("stat tiles count what is live and what is scheduled, on card surfaces", async (): Promise<void> => {
    mockOverrides.current.active = [override("a1"), override("a2")];
    mockOverrides.current.upcoming = [override("u1")];
    mockOverrides.current.past = [override("p1")];

    await render(<OnCallOverridesScreen />);

    const active: HostElement = screen.getByTestId("coverage-count-active");
    expect(within(active).getByText("2")).toBeTruthy();
    expect(within(active).getByText("Active now")).toBeTruthy();
    expect(active.props.accessibilityLabel).toBe("2 active now");
    const upcoming: HostElement = screen.getByTestId("coverage-count-upcoming");
    expect(within(upcoming).getByText("1")).toBeTruthy();
    expect(upcoming.props.accessibilityLabel).toBe("1 scheduled");

    for (const testID of ["coverage-count-active", "coverage-count-upcoming"]) {
      const style: Record<string, unknown> = flatStyle(testID);
      expect(style.backgroundColor).toBe(lightColors.backgroundElevated);
      expect(style.borderRadius).toBe(radius.lg);
    }
  });

  test("the primary action stays the one filled button", async (): Promise<void> => {
    await render(<OnCallOverridesScreen />);

    expect(flatStyle("new-override").backgroundColor).toBe(
      lightColors.actionPrimary,
    );
    expect(
      screen.getByRole("button", { name: "Arrange coverage" }),
    ).toBeTruthy();
  });

  test("with nothing arranged, an outlined card explains overrides", async (): Promise<void> => {
    await render(<OnCallOverridesScreen />);

    const empty: HostElement = screen.getByTestId("overrides-empty");
    expect(within(empty).getByText("No overrides yet")).toBeTruthy();
    expect(flatStyle("overrides-empty").borderRadius).toBe(radius.lg);
    expect(screen.queryByTestId("coverage-counts")).toBeNull();
  });

  test("sections run live, scheduled, ended and each shows its count", async (): Promise<void> => {
    mockOverrides.current.active = [override("a1")];
    mockOverrides.current.upcoming = [override("u1"), override("u2")];
    mockOverrides.current.past = [override("p1")];

    await render(<OnCallOverridesScreen />);

    expect(
      screen.getAllByTestId(/^overrides-section-/).map((node: HostElement) => {
        return node.props.testID;
      }),
    ).toEqual([
      "overrides-section-active",
      "overrides-section-upcoming",
      "overrides-section-past",
    ]);
    expect(
      within(screen.getByTestId("overrides-section-upcoming")).getByText("2"),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId("overrides-section-past")).queryByText(
        "Cancel override",
      ),
    ).toBeNull();
  });

  test("keeping the override does nothing; confirming shows progress on that card only", async (): Promise<void> => {
    let finishCancel: () => void = (): void => {};
    mockCancel.mockImplementation(() => {
      return new Promise<void>((resolve: () => void) => {
        finishCancel = resolve;
      });
    });
    mockOverrides.current.active = [override("active")];
    mockOverrides.current.upcoming = [override("upcoming")];

    await render(<OnCallOverridesScreen />);

    await fireEvent.press(screen.getByTestId("override-cancel-active"));
    const buttons: Array<{
      text: string;
      style?: string;
      onPress?: () => void;
    }> = alertSpy.mock.calls[0]![2];
    buttons
      .find((button: { text: string }) => {
        return button.text === "Keep it";
      })
      ?.onPress?.();
    expect(mockCancel).not.toHaveBeenCalled();

    await act(async () => {
      buttons
        .find((button: { style?: string }) => {
          return button.style === "destructive";
        })
        ?.onPress?.();
    });

    expect(
      screen.getByTestId("override-cancel-active").props.accessibilityState,
    ).toEqual({ disabled: true, busy: true });
    expect(
      screen.getByTestId("override-cancel-upcoming").props.accessibilityState,
    ).toEqual({ disabled: false, busy: false });

    await act(async () => {
      finishCancel();
    });

    await waitFor(() => {
      expect(
        screen.getByTestId("override-cancel-active").props.accessibilityState,
      ).toEqual({ disabled: false, busy: false });
    });
  });
});

type HostElement = ReturnType<typeof screen.getByTestId>;

function flatStyle(testID: string): Record<string, unknown> {
  return (StyleSheet.flatten(screen.getByTestId(testID).props.style) ??
    {}) as Record<string, unknown>;
}
