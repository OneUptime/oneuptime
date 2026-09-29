import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import React from "react";
import KeyboardShortcut from "../../../UI/Components/KeyboardShortcut/KeyboardShortcut";
import KeyboardKey, {
  KeyboardKeyUtil,
} from "../../../UI/Components/KeyboardShortcut/KeyboardKey";

type SetPlatformFunction = (platform: string, touchPoints?: number) => void;

const setPlatform: SetPlatformFunction = (
  platform: string,
  touchPoints: number = 0,
): void => {
  Object.defineProperty(window.navigator, "platform", {
    value: platform,
    configurable: true,
  });
  Object.defineProperty(window.navigator, "userAgent", {
    value: "",
    configurable: true,
  });
  Object.defineProperty(window.navigator, "maxTouchPoints", {
    value: touchPoints,
    configurable: true,
  });
  Object.defineProperty(window.navigator, "userAgentData", {
    value: undefined,
    configurable: true,
  });
};

describe("KeyboardShortcut", () => {
  it("renders the Apple modifier glyph on a Mac", () => {
    setPlatform("MacIntel");

    render(<KeyboardShortcut keys={[KeyboardKey.Mod, "i"]} />);

    expect(screen.getByText("⌘")).toBeInTheDocument();
    // Single characters are capitalised on the keycap.
    expect(screen.getByText("I")).toBeInTheDocument();
    expect(screen.queryByText("Ctrl")).not.toBeInTheDocument();
  });

  it("renders Ctrl on Windows", () => {
    setPlatform("Win32");

    render(<KeyboardShortcut keys={[KeyboardKey.Mod, "i"]} />);

    expect(screen.getByText("Ctrl")).toBeInTheDocument();
    expect(screen.queryByText("⌘")).not.toBeInTheDocument();
  });

  it("spells the shortcut out for screen readers instead of using glyphs", () => {
    setPlatform("MacIntel");

    const { container } = render(
      <KeyboardShortcut keys={[KeyboardKey.Mod, KeyboardKey.Shift, "k"]} />,
    );

    expect(screen.getByText("Command + Shift + K")).toBeInTheDocument();

    // The glyph keycaps themselves are hidden from assistive tech.
    const keycaps: NodeListOf<Element> = container.querySelectorAll("kbd");
    expect(keycaps).toHaveLength(3);
    keycaps.forEach((keycap: Element) => {
      expect(keycap).toHaveAttribute("aria-hidden", "true");
    });
  });
});

describe("KeyboardKeyUtil", () => {
  it("writes plain-text labels in the platform's notation", () => {
    expect(KeyboardKeyUtil.getDisplayLabel([KeyboardKey.Mod, "b"], true)).toBe(
      "⌘B",
    );
    expect(KeyboardKeyUtil.getDisplayLabel([KeyboardKey.Mod, "b"], false)).toBe(
      "Ctrl+B",
    );
  });

  it("maps Alt to Option only on Apple platforms", () => {
    expect(KeyboardKeyUtil.getSpokenKey(KeyboardKey.Alt, true)).toBe("Option");
    expect(KeyboardKeyUtil.getSpokenKey(KeyboardKey.Alt, false)).toBe("Alt");
  });

  it("emits aria-keyshortcuts tokens the platform actually listens for", () => {
    expect(
      KeyboardKeyUtil.getAriaKeyShortcuts([KeyboardKey.Mod, "i"], true),
    ).toBe("Meta+I");
    expect(
      KeyboardKeyUtil.getAriaKeyShortcuts([KeyboardKey.Mod, "i"], false),
    ).toBe("Control+I");
  });
});
