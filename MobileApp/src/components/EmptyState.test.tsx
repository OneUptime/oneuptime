import React from "react";
import { StyleSheet, type TextStyle, type ViewStyle } from "react-native";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { afterEach, describe, expect, test } from "@jest/globals";
import { Ionicons } from "@expo/vector-icons";
import EmptyState from "./EmptyState";
import { ThemeProvider, darkColors, lightColors } from "../theme";
import { withAlpha } from "../utils/color";

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

function noop(): void {
  return undefined;
}

function flatStyle(element: {
  props: { style?: unknown };
}): TextStyle & ViewStyle {
  return (StyleSheet.flatten(element.props.style as ViewStyle) ??
    {}) as TextStyle & ViewStyle;
}

/** The outermost view the empty state draws. */
function outerContainer(): { props: { style?: unknown } } {
  return screen.root as unknown as { props: { style?: unknown } };
}

/*
 * What a responder sees when a list has nothing in it - which, for an on-call
 * app, is the view it spends most of its life showing. "No incidents" is good
 * news, and the screen has to say so plainly enough that nobody mistakes a
 * quiet rota for a broken app.
 *
 * The parts worth pinning down are therefore the ones that carry that meaning:
 * the sentence, the picture beside it, and whether there is a way out.
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

describe("What the empty state says", () => {
  test("the title it was given", async () => {
    await render(<EmptyState title="No incidents" />);

    expect(screen.getByText("No incidents")).toBeTruthy();
  });

  test("the subtitle underneath, when there is one", async () => {
    await render(
      <EmptyState
        title="No incidents"
        subtitle="Incidents from your projects will appear here."
      />,
    );

    expect(
      screen.getByText("Incidents from your projects will appear here."),
    ).toBeTruthy();
  });

  test("nothing at all in place of an absent subtitle", async () => {
    /*
     * The subtitle is optional and the block is left out rather than rendered
     * empty, so the title stays vertically centred instead of sitting above a
     * gap the size of a missing sentence.
     */
    await render(<EmptyState title="No incidents" />);

    expect(screen.getByText("No incidents")).toBeTruthy();
    expect(
      screen.queryByText("Incidents from your projects will appear here."),
    ).toBeNull();
  });
});

describe("The picture beside the sentence", () => {
  test("the alerts empty state is drawn with the alert icon", async () => {
    await render(<EmptyState title="No alerts" icon="alerts" />);

    expect(screen.getByText(glyphFor("notifications-outline"))).toBeTruthy();
  });

  test("the monitors empty state is drawn with a different one", async () => {
    /*
     * Two empty states sharing a glyph is what a broken icon map looks like,
     * and nothing in the words on screen would give it away.
     */
    await render(<EmptyState title="No monitors" icon="monitors" />);

    expect(screen.getByText(glyphFor("pulse-outline"))).toBeTruthy();
    expect(screen.queryByText(glyphFor("notifications-outline"))).toBeNull();
  });

  test("each of the icons the app asks for maps to its own glyph", async () => {
    const expectations: Array<{
      icon: "incidents" | "episodes" | "notes";
      glyph: keyof typeof Ionicons.glyphMap;
    }> = [
      { icon: "incidents", glyph: "warning-outline" },
      { icon: "episodes", glyph: "layers-outline" },
      { icon: "notes", glyph: "document-text-outline" },
    ];

    for (const expectation of expectations) {
      const view: { unmount: () => Promise<void> } = await render(
        <EmptyState title="Nothing here" icon={expectation.icon} />,
      );

      expect(screen.getByText(glyphFor(expectation.glyph))).toBeTruthy();

      await view.unmount();
    }
  });

  test("a caller that names no icon gets the neutral one", async () => {
    await render(<EmptyState title="Nothing here" />);

    expect(screen.getByText(glyphFor("remove-circle-outline"))).toBeTruthy();
  });
});

describe("The way out of an empty screen", () => {
  test("an action button appears when there is both a label and something to do", async () => {
    await render(
      <EmptyState
        title="Could not load incidents"
        actionLabel="Try again"
        onAction={(): void => {
          return undefined;
        }}
      />,
    );

    expect(screen.getByText("Try again")).toBeTruthy();
  });

  test("pressing it runs the action", async () => {
    const onAction: jest.Mock = jest.fn();

    await render(
      <EmptyState
        title="Could not load incidents"
        actionLabel="Try again"
        onAction={onAction}
      />,
    );

    await fireEvent.press(screen.getByText("Try again"));

    expect(onAction).toHaveBeenCalledTimes(1);
  });

  test("pressing it twice retries twice", async () => {
    /*
     * This button is usually a retry, and a responder who gets no visible
     * answer will press it again. Both presses have to reach the caller: this
     * component holds no in-flight state of its own with which to swallow one.
     */
    const onAction: jest.Mock = jest.fn();

    await render(
      <EmptyState
        title="Could not load incidents"
        actionLabel="Try again"
        onAction={onAction}
      />,
    );

    await fireEvent.press(screen.getByText("Try again"));
    await fireEvent.press(screen.getByText("Try again"));

    expect(onAction).toHaveBeenCalledTimes(2);
  });

  test("no button when there is nothing for it to do", async () => {
    /*
     * A label with no handler would otherwise render a button that looks live
     * and answers nothing, which reads as the app having frozen.
     */
    await render(
      <EmptyState title="Could not load incidents" actionLabel="Try again" />,
    );

    expect(screen.queryByText("Try again")).toBeNull();
  });

  test("no button when there is a handler but nothing to call it", async () => {
    const onAction: jest.Mock = jest.fn();

    await render(
      <EmptyState title="Could not load incidents" onAction={onAction} />,
    );

    expect(screen.queryByRole("button")).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });

  test("an ordinary empty list offers no button at all", async () => {
    await render(
      <EmptyState
        title="No incidents"
        subtitle="Incidents from your projects will appear here."
        icon="incidents"
      />,
    );

    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("An icon the map has never heard of", () => {
  /*
   * The cast is the point: the union says this cannot happen, and it will the
   * first time a caller passes a name through from somewhere less typed. The
   * empty state is the whole screen at that moment, so a throw out of render
   * leaves the responder looking at nothing while wondering whether the rota
   * is quiet or the app is broken.
   */
  test("the sentence still gets on screen", async () => {
    await render(
      <EmptyState
        title="No incidents"
        subtitle="Incidents from your projects will appear here."
        icon={"tumbleweed" as "default"}
      />,
    );

    expect(screen.getByText("No incidents")).toBeTruthy();
    expect(
      screen.getByText("Incidents from your projects will appear here."),
    ).toBeTruthy();
  });
});

describe("How the empty state is put together", () => {
  test("the title is the largest thing on it", async () => {
    /*
     * The empty state is read at arm's length, half asleep. The title carries
     * the message and the subtitle only qualifies it, so the two must not be
     * allowed to drift to the same weight.
     */
    await render(
      <EmptyState title="No incidents" subtitle="Nothing is on fire." />,
    );

    const title: RenderedElement = screen.getByText("No incidents");
    const subtitle: RenderedElement = screen.getByText("Nothing is on fire.");

    /*
     * AppText composes its style as an array (type scale, tone, then the
     * caller's overrides), so the effective size is only visible flattened.
     */
    expect(Number(flatStyle(title).fontSize)).toBeGreaterThan(
      Number(flatStyle(subtitle).fontSize),
    );
  });

  test("the title is a heading and the subtitle is muted", async () => {
    await render(
      <EmptyState title="No incidents" subtitle="Nothing is on fire." />,
    );

    expect(screen.getByRole("header", { name: "No incidents" })).toBeTruthy();
    expect(screen.getByText("No incidents")).toHaveStyle({
      color: lightColors.textPrimary,
      textAlign: "center",
    });
    expect(screen.getByText("Nothing is on fire.")).toHaveStyle({
      color: lightColors.textSecondary,
      textAlign: "center",
    });
  });

  test("every line of text sets a line height at least as tall as its size", async () => {
    /*
     * The title overrides the scale's size; an override that forgot the line
     * height would clip descenders on Android at larger text sizes.
     */
    await render(
      <EmptyState title="No incidents" subtitle="Nothing is on fire." />,
    );

    for (const text of ["No incidents", "Nothing is on fire."]) {
      const style: TextStyle = flatStyle(screen.getByText(text));
      expect(style.lineHeight).toBeGreaterThanOrEqual(Number(style.fontSize));
    }
  });
});

describe("What each kind of empty state means", () => {
  test("a success state is drawn in the success colour with a check", async () => {
    await render(<EmptyState title="All clear" icon="success" />);

    const glyph: RenderedElement = screen.getByText(
      glyphFor("checkmark-circle-outline"),
    );
    expect(flatStyle(glyph).color).toBe(lightColors.statusSuccess);
  });

  test("an error state is drawn in the error colour with a cloud", async () => {
    await render(<EmptyState title="Could not load" icon="error" />);

    const glyph: RenderedElement = screen.getByText(
      glyphFor("cloud-offline-outline"),
    );
    expect(flatStyle(glyph).color).toBe(lightColors.statusError);
  });

  test("every other state uses the accent colour", async () => {
    await render(<EmptyState title="No incidents" icon="incidents" />);

    const glyph: RenderedElement = screen.getByText(
      glyphFor("warning-outline"),
    );
    expect(flatStyle(glyph).color).toBe(lightColors.actionPrimary);
  });

  test("the icon sits on a circular tile tinted with its own colour", async () => {
    await render(<EmptyState title="All clear" icon="success" />);

    const tile: RenderedElement = screen.getByText(
      glyphFor("checkmark-circle-outline"),
    ).parent as RenderedElement;
    const style: ViewStyle = flatStyle(tile);

    expect(style.width).toBe(52);
    expect(style.borderRadius).toBe(26);
    expect(style.backgroundColor).toBe(
      withAlpha(lightColors.statusSuccess, 0.12),
    );
  });

  test("the action is a tonal button, so it never competes with a screen's primary action", async () => {
    await render(
      <EmptyState title="Could not load" actionLabel="Retry" onAction={noop} />,
    );

    expect(screen.getByRole("button", { name: "Retry" })).toHaveStyle({
      backgroundColor: lightColors.cardAccent,
    });
    expect(screen.getByText("Retry")).toHaveStyle({
      color: lightColors.actionPrimary,
    });
  });
});

describe("How much room the empty state takes", () => {
  test("by default it fills the space it is given", async () => {
    await render(<EmptyState title="No incidents" />);

    const style: ViewStyle = flatStyle(outerContainer());
    expect(style.flex).toBe(1);
    expect(style.paddingVertical).toBe(48);
  });

  test("compact keeps it tight inside a card or a short section", async () => {
    await render(<EmptyState title="No incidents" compact />);

    const style: ViewStyle = flatStyle(outerContainer());
    expect(style.flex).toBeUndefined();
    expect(style.paddingVertical).toBe(24);
  });
});

describe("In dark mode", () => {
  afterEach(() => {
    mockSystemScheme = "light";
  });

  test("the text and icon follow the dark palette", async () => {
    mockSystemScheme = "dark";
    await render(
      <ThemeProvider>
        <EmptyState title="All clear" subtitle="Nothing to do" icon="success" />
      </ThemeProvider>,
    );

    expect(screen.getByText("All clear")).toHaveStyle({
      color: darkColors.textPrimary,
    });
    expect(screen.getByText("Nothing to do")).toHaveStyle({
      color: darkColors.textSecondary,
    });
    const glyph: RenderedElement = screen.getByText(
      glyphFor("checkmark-circle-outline"),
    );
    expect(flatStyle(glyph).color).toBe(darkColors.statusSuccess);
    expect(flatStyle(glyph.parent as RenderedElement).backgroundColor).toBe(
      withAlpha(darkColors.statusSuccess, 0.2),
    );
  });
});
