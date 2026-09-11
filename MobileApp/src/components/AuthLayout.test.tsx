import React from "react";
import { Text } from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { render, screen } from "@testing-library/react-native";
import AuthLayout from "./AuthLayout";

test("keeps the final sign-in action above the home indicator on a small phone", async () => {
  await render(
    <SafeAreaInsetsContext.Provider
      value={{ top: 59, bottom: 34, left: 0, right: 0 }}
    >
      <AuthLayout title="Sign in">
        <Text>Final action</Text>
      </AuthLayout>
    </SafeAreaInsetsContext.Provider>,
  );
  const scroll: ReturnType<typeof screen.getByTestId> =
    screen.getByTestId("auth-scroll");
  expect(
    scroll.props.contentContainerStyle.paddingBottom,
  ).toBeGreaterThanOrEqual(34 + 40);
  expect(scroll.props.contentContainerStyle.paddingTop).toBeGreaterThanOrEqual(
    59,
  );
  expect(scroll.props.keyboardShouldPersistTaps).toBe("handled");
  expect(scroll.props.keyboardDismissMode).toBe("on-drag");
  expect(screen.getByText("Final action")).toBeTruthy();
});

test("makes the full form scrollable while the platform keyboard is open", async () => {
  await render(
    <AuthLayout title="Sign in" description="Continue to your team">
      <Text>Submit</Text>
    </AuthLayout>,
  );
  expect(screen.getByTestId("auth-keyboard")).toBeTruthy();
  expect(
    screen.getByTestId("auth-scroll").props.contentContainerStyle.flexGrow,
  ).toBe(1);
  expect(screen.getByRole("header", { name: "Sign in" })).toBeTruthy();
  expect(screen.getByText("Continue to your team")).toBeTruthy();
});

test("compact login branding avoids a repeated wordmark without reducing safe-area clearance", async () => {
  await render(
    <SafeAreaInsetsContext.Provider
      value={{ top: 59, bottom: 34, left: 0, right: 0 }}
    >
      <AuthLayout title="Welcome back" showBrand compact>
        <Text>Sign In</Text>
      </AuthLayout>
    </SafeAreaInsetsContext.Provider>,
  );
  expect(screen.queryByText("ONEUPTIME")).toBeNull();
  expect(screen.getByTestId("auth-brand").props.style.marginBottom).toBe(24);
  const scroll: ReturnType<typeof screen.getByTestId> =
    screen.getByTestId("auth-scroll");
  expect(scroll.props.contentContainerStyle.paddingTop).toBeGreaterThanOrEqual(
    59,
  );
  expect(
    scroll.props.contentContainerStyle.paddingBottom,
  ).toBeGreaterThanOrEqual(34 + 40);
});
