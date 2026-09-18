import React from "react";
import { StyleSheet, type TextStyle, type ViewStyle } from "react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { afterEach, describe, expect, test } from "@jest/globals";
import { Ionicons } from "@expo/vector-icons";
import SectionHeader from "./SectionHeader";
import { ThemeProvider, darkColors, lightColors } from "../theme";
import { radius, typography } from "../theme/tokens";

let mockSystemScheme: "light" | "dark" | null = "light";

/*
 * react-native exposes useColorScheme through a getter, which cannot be spied
 * on, so the module behind it is replaced instead.
 */
jest.mock("react-native/Libraries/Utilities/useColorScheme", () => {
  return {
    __esModule: true,
    default: (): "light" | "dark" | null => {
      return mockSystemScheme;
    },
  };
});

afterEach(() => {
  mockSystemScheme = "light";
});

function flat(element: { props: { style?: unknown } }): ViewStyle & TextStyle {
  return (StyleSheet.flatten(element.props.style as ViewStyle) ??
    {}) as ViewStyle & TextStyle;
}

function noop(): void {
  return undefined;
}

/*
 * The little icon-and-caption line that divides a detail screen into
 * Description, Details, Status History and so on. It is pure decoration until
 * you stop looking at the screen: then it is the only thing telling a
 * screen-reader user which part of a long scrolling page they have reached.
 */

type RenderedElement = ReturnType<typeof screen.getByText>;

/**
 * The character the icon font actually draws for an icon name.
 *
 * Taken from the font's own map rather than written out as a literal, because
 * the literal would be an unreadable private-use codepoint that nobody could
 * check, and one that moves whenever the icon set is upgraded.
 */
function glyphFor(name: keyof typeof Ionicons.glyphMap): string {
  const glyph: string | number = Ionicons.glyphMap[name];

  /*
   * The map is typed as holding either a codepoint or the character itself,
   * and the icon component renders whichever it finds. Ionicons ships
   * codepoints, but converting only when there is one to convert keeps this
   * helper true for any set the app is later pointed at.
   */
  if (typeof glyph === "string") {
    return glyph;
  }

  return String.fromCodePoint(glyph);
}

function styleOf(element: RenderedElement): Record<string, unknown> {
  return element.props.style as Record<string, unknown>;
}

describe("What the header shows", () => {
  test("the title it was given", async () => {
    await render(
      <SectionHeader title="Status History" iconName="time-outline" />,
    );

    expect(screen.getByText("Status History")).toBeTruthy();
  });

  test("section headings keep readable sentence case and heading semantics", async () => {
    /*
     * This matters for more than tidiness. textTransform is a display
     * instruction, so the text a screen reader announces is still "Status
     * History" - upper-casing the string itself would have VoiceOver spell it
     * out letter by letter, or read it in the flat shout it reserves for
     * acronyms.
     */
    await render(
      <SectionHeader title="Status History" iconName="time-outline" />,
    );

    const title: RenderedElement = screen.getByText("Status History");
    expect(styleOf(title).textTransform).toBeUndefined();
    expect(screen.getByRole("header", { name: "Status History" })).toBeTruthy();
    expect(screen.queryByText("STATUS HISTORY")).toBeNull();
  });

  test("the icon it was asked for, and not some default", async () => {
    await render(
      <SectionHeader title="Status History" iconName="time-outline" />,
    );

    expect(screen.getByText(glyphFor("time-outline"))).toBeTruthy();
  });

  test("a different section gets a different icon", async () => {
    /*
     * Two headers drawing the same glyph would be the failure mode of a header
     * that quietly ignored its prop, and nothing about the rendered caption
     * would give it away.
     */
    await render(
      <SectionHeader title="Activity Feed" iconName="list-outline" />,
    );

    expect(screen.getByText(glyphFor("list-outline"))).toBeTruthy();
    expect(screen.queryByText(glyphFor("time-outline"))).toBeNull();
  });

  test("decorative heading icons stay neutral so blue identifies actions", async () => {
    await render(<SectionHeader title="Details" iconName="time-outline" />);

    const icon: RenderedElement = screen.getByText(glyphFor("time-outline"));
    const iconStyles: Array<Record<string, unknown>> = icon.props
      .style as Array<Record<string, unknown>>;

    expect(iconStyles[0].color).toBe(lightColors.textTertiary);
  });

  test("a title of one word, or of many, is rendered whole", async () => {
    await render(
      <SectionHeader
        title="Everything else worth knowing"
        iconName="information-circle-outline"
      />,
    );

    expect(screen.getByText("Everything else worth knowing")).toBeTruthy();
  });
});

describe("How the title is set", () => {
  test("in the title3 step of the type scale and the primary text colour", async () => {
    await render(<SectionHeader title="Details" />);

    expect(screen.getByText("Details")).toHaveStyle({
      fontSize: typography.title3.fontSize,
      lineHeight: typography.title3.lineHeight,
      color: lightColors.textPrimary,
    });
  });

  test("no icon is drawn when none is asked for", async () => {
    await render(<SectionHeader title="Details" />);

    expect(screen.queryByText(glyphFor("time-outline"))).toBeNull();
    expect(screen.getByRole("header", { name: "Details" })).toBeTruthy();
  });
});

describe("The count beside the title", () => {
  test("shows the number on a muted pill", async () => {
    await render(<SectionHeader title="Active incidents" count={3} />);

    const count: RenderedElement = screen.getByText("3");
    expect(count).toHaveStyle({
      color: lightColors.textSecondary,
      fontWeight: "700",
      fontVariant: ["tabular-nums"],
    });
    expect(count.parent as RenderedElement).toHaveStyle({
      borderRadius: radius.pill,
      backgroundColor: lightColors.backgroundTertiary,
    });
  });

  test("a count of zero is still shown, because none is an answer", async () => {
    await render(<SectionHeader title="Active incidents" count={0} />);

    expect(screen.getByText("0")).toBeTruthy();
  });

  test("no pill when there is no count", async () => {
    await render(<SectionHeader title="Active incidents" />);

    expect(screen.queryByText(/^\d+$/)).toBeNull();
  });

  test("the count is not part of the heading's name", async () => {
    await render(<SectionHeader title="Active incidents" count={3} />);

    expect(
      screen.getByRole("header", { name: "Active incidents" }),
    ).toBeTruthy();
  });
});

describe("The action link", () => {
  test("is a named button in the accent colour that runs onAction", async () => {
    const onAction: jest.Mock = jest.fn();
    await render(
      <SectionHeader
        title="On call"
        actionLabel="See all"
        onAction={onAction}
      />,
    );

    const action: RenderedElement = screen.getByRole("button", {
      name: "See all",
    });
    expect(screen.getByText("See all")).toHaveStyle({
      color: lightColors.actionPrimary,
      fontWeight: "600",
      fontSize: typography.subhead.fontSize,
    });
    await fireEvent.press(action);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  test("keeps a usable hit area", async () => {
    await render(
      <SectionHeader title="On call" actionLabel="See all" onAction={noop} />,
    );

    const action: RenderedElement = screen.getByRole("button", {
      name: "See all",
    });
    expect(action.props.hitSlop).toBe(10);
    expect(Number(flat(action).minHeight) + 20).toBeGreaterThanOrEqual(44);
  });

  test("dims while held", async () => {
    await render(
      <SectionHeader title="On call" actionLabel="See all" onAction={noop} />,
    );
    const action: RenderedElement = screen.getByRole("button", {
      name: "See all",
    });
    expect(action).toHaveStyle({ opacity: 1 });

    /*
     * fireEvent(el, "pressIn") never reaches Pressable's own press state, so
     * the responder handler the touch system calls is used instead.
     */
    await act(async (): Promise<void> => {
      (
        action.props as { onResponderGrant: (event: unknown) => void }
      ).onResponderGrant({
        nativeEvent: {
          touches: [{ pageX: 1, pageY: 1, identifier: 1 }],
          changedTouches: [],
        },
        currentTarget: 1,
        persist: noop,
      });
    });

    expect(action).toHaveStyle({ opacity: 0.6 });
  });

  test.each([
    ["a label with no handler", { actionLabel: "See all" }],
    ["a handler with no label", { onAction: noop }],
  ] as Array<[string, { actionLabel?: string; onAction?: () => void }]>)(
    "is left out for %s",
    async (
      _label: string,
      props: { actionLabel?: string; onAction?: () => void },
    ) => {
      await render(<SectionHeader title="On call" {...props} />);

      expect(screen.queryByRole("button")).toBeNull();
    },
  );
});

describe("In dark mode", () => {
  test("title, icon, count and action follow the dark palette", async () => {
    mockSystemScheme = "dark";
    await render(
      <ThemeProvider>
        <SectionHeader
          title="Details"
          iconName="time-outline"
          count={2}
          actionLabel="Edit"
          onAction={noop}
        />
      </ThemeProvider>,
    );

    expect(screen.getByText("Details")).toHaveStyle({
      color: darkColors.textPrimary,
    });
    expect(flat(screen.getByText(glyphFor("time-outline"))).color).toBe(
      darkColors.textTertiary,
    );
    expect(screen.getByText("2").parent as RenderedElement).toHaveStyle({
      backgroundColor: darkColors.backgroundTertiary,
    });
    expect(screen.getByText("Edit")).toHaveStyle({
      color: darkColors.actionPrimary,
    });
  });
});
