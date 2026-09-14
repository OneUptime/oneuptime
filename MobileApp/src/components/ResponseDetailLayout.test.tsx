import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { describe, expect, test, jest } from "@jest/globals";
import {
  ResponseActions,
  ResponseDetailHeader,
  ResponseInfoRow,
  ResponseSection,
  type ResponseAction,
} from "./ResponseDetailLayout";
import { lightColors } from "../theme";

describe("Editorial response details", () => {
  test("the problem is a readable heading with server-defined state and severity names", async () => {
    await render(
      <ResponseDetailHeader
        title="Checkout unavailable"
        kind="Incident"
        number="INC-42"
        state="Investigating"
        stateColor="#FACC15"
        severity="Urgent"
      />,
    );
    expect(
      screen.getByRole("header", { name: "Checkout unavailable" }),
    ).toHaveStyle({
      fontSize: 32,
      lineHeight: 39,
      color: lightColors.textPrimary,
    });
    expect(screen.getByText("INC-42")).toBeTruthy();
    expect(screen.getByText("Investigating")).toHaveStyle({
      color: lightColors.textPrimary,
    });
    expect(screen.getByText("Urgent")).toHaveStyle({
      color: lightColors.textSecondary,
    });
  });

  test("missing status metadata never invents a healthy state", async () => {
    await render(
      <ResponseDetailHeader
        title="New monitor"
        kind="API"
        stateColor="#FFFFFF"
      />,
    );
    expect(screen.queryByText(/healthy|operational|resolved/i)).toBeNull();
    expect(screen.getByRole("header", { name: "New monitor" })).toBeTruthy();
  });

  test("two large actions have explicit names and distinct primary emphasis", async () => {
    const acknowledge: jest.Mock<() => void> = jest.fn<() => void>();
    const resolve: jest.Mock<() => void> = jest.fn<() => void>();
    const actions: ResponseAction[] = [
      {
        label: "Acknowledge",
        accessibilityLabel: "Acknowledge incident",
        onPress: acknowledge,
        primary: true,
      },
      {
        label: "Resolve",
        accessibilityLabel: "Resolve incident",
        onPress: resolve,
      },
    ];
    await render(<ResponseActions actions={actions} busy={false} />);
    expect(
      screen.getByRole("button", { name: "Acknowledge incident" }),
    ).toHaveStyle({
      minHeight: 54,
      minWidth: 116,
      backgroundColor: lightColors.actionPrimary,
    });
    expect(screen.getByText("Acknowledge")).toHaveStyle({
      color: lightColors.textInverse,
    });
    expect(
      screen.getByRole("button", { name: "Resolve incident" }),
    ).toHaveStyle({
      minHeight: 54,
      backgroundColor: lightColors.backgroundElevated,
    });
    await fireEvent.press(
      screen.getByRole("button", { name: "Acknowledge incident" }),
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Resolve incident" }),
    );
    expect(acknowledge).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  test("busy actions cannot send duplicate mutations and announce their progress", async () => {
    const onPress: jest.Mock<() => void> = jest.fn<() => void>();
    await render(
      <ResponseActions
        actions={[
          {
            label: "Resolve",
            accessibilityLabel: "Resolve episode",
            busyAccessibilityLabel: "Resolve episode, state change in progress",
            onPress,
            primary: true,
          },
        ]}
        busy
      />,
    );
    const button: ReturnType<typeof screen.getByRole> = screen.getByRole(
      "button",
      { name: "Resolve episode, state change in progress" },
    );
    expect(button).toBeDisabled();
    expect(button.props.accessibilityState).toMatchObject({ busy: true });
    expect(screen.getByRole("button").props.accessibilityState.disabled).toBe(
      true,
    );
    expect(screen.getByRole("button").props.accessibilityState.busy).toBe(true);
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  test("context remains full width under a named section with no nested card", async () => {
    await render(
      <ResponseSection title="Details">
        <ResponseInfoRow
          label="Monitor"
          value="Checkout API — Europe production"
        />
      </ResponseSection>,
    );
    expect(screen.getByRole("header", { name: "Details" })).toBeTruthy();
    expect(screen.getByText("Monitor")).toHaveStyle({
      width: 82,
      flexShrink: 0,
    });
    expect(screen.getByText("Checkout API — Europe production")).toHaveStyle({
      flex: 1,
      lineHeight: 22,
    });
  });
});
