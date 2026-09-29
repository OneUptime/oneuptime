import React from "react";
import { Text } from "react-native";
import { render, screen } from "@testing-library/react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { useScreenPadding } from "./useScreenPadding";
import { getScreenBottomPadding } from "../theme/layout";

function Content({ tabBar = true }: { tabBar?: boolean }): React.JSX.Element {
  const padding: number = useScreenPadding({ tabBar });
  return <Text testID="padding">{padding}</Text>;
}

test.each([0, 16, 24, 34, 48, 80])(
  "%dpt inset leaves the final item 40pt above navigation",
  (inset: number) => {
    expect(getScreenBottomPadding(inset)).toBe(72 + Math.max(inset, 12) + 40);
    expect(getScreenBottomPadding(inset, false)).toBe(inset + 40);
  },
);

test("padding updates when system safe area changes", async () => {
  const tree: (bottom: number) => React.JSX.Element = (bottom: number) => {
    return (
      <SafeAreaInsetsContext.Provider
        value={{ top: 0, left: 0, right: 0, bottom }}
      >
        <Content />
      </SafeAreaInsetsContext.Provider>
    );
  };
  const view: Awaited<ReturnType<typeof render>> = await render(tree(0));
  expect(screen.getByTestId("padding")).toHaveTextContent("124");
  await view.rerender(tree(34));
  expect(screen.getByTestId("padding")).toHaveTextContent("146");
});

test("standalone content uses conservative clearance without a provider", async () => {
  await render(<Content />);
  expect(screen.getByTestId("padding")).toHaveTextContent("124");
});

test("auth and modal content reserves safe area without a tab bar", async () => {
  await render(
    <SafeAreaInsetsContext.Provider
      value={{ top: 44, bottom: 34, left: 0, right: 0 }}
    >
      <Content tabBar={false} />
    </SafeAreaInsetsContext.Provider>,
  );
  expect(screen.getByTestId("padding")).toHaveTextContent("74");
});
