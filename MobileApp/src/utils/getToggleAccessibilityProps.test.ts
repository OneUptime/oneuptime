import { describe, expect, test } from "@jest/globals";
import { Platform } from "react-native";
import getToggleAccessibilityProps from "./getToggleAccessibilityProps";

describe("Toggle button accessibility across renderers", () => {
  test.each([true, false])(
    "web exposes pressed=%s without using invalid button selection semantics",
    (selected: boolean) => {
      expect(getToggleAccessibilityProps(selected, "web")).toEqual({
        accessibilityState: { selected },
        "aria-pressed": selected,
      });
    },
  );

  test.each(["ios", "android"] as const)(
    "%s keeps native selection and receives no unsupported aria-pressed prop",
    (platform: "ios" | "android") => {
      expect(getToggleAccessibilityProps(true, platform)).toEqual({
        accessibilityState: { selected: true },
      });
      expect(getToggleAccessibilityProps(false, platform)).toEqual({
        accessibilityState: { selected: false },
      });
    },
  );

  test("the default renderer matches the running app platform", () => {
    expect(getToggleAccessibilityProps(true)).toEqual(
      getToggleAccessibilityProps(true, Platform.OS),
    );
  });
});
