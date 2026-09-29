import React, { useEffect, useState } from "react";
import { StyleSheet, Switch, Text, type ViewStyle } from "react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { afterEach, describe, expect, test } from "@jest/globals";
import { Ionicons } from "@expo/vector-icons";
import { ListGroup, ListItem } from "./ListGroup";
import { ThemeProvider, darkColors, lightColors } from "../theme";
import { elevation, radius, touchTarget } from "../theme/tokens";
import { withAlpha } from "../utils/color";

/*
 * The settings-list pattern: a rounded group of rows separated by hairlines,
 * each row an icon, a title, optional detail and either a chevron or a control.
 * Most of what can go wrong is quiet - a separator above the first row, a
 * chevron beside a switch, a destructive row painted like any other - so the
 * tests below look at structure and colour rather than only at text.
 */

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

type RenderedElement = ReturnType<typeof screen.getByText>;

interface PressHandlers {
  onResponderGrant?: (event: unknown) => void;
}

function glyphFor(name: keyof typeof Ionicons.glyphMap): string {
  const glyph: string | number = Ionicons.glyphMap[name];
  return typeof glyph === "string" ? glyph : String.fromCodePoint(glyph);
}

function flat(element: RenderedElement): ViewStyle & { color?: string } {
  return (StyleSheet.flatten(element.props.style) ?? {}) as ViewStyle & {
    color?: string;
  };
}

/** See Card.test.tsx: fireEvent(el, "pressIn") never reaches Pressable. */
async function holdDown(element: RenderedElement): Promise<void> {
  await act(async (): Promise<void> => {
    (element.props as PressHandlers).onResponderGrant?.({
      nativeEvent: {
        touches: [{ pageX: 100, pageY: 200, identifier: 1 }],
        changedTouches: [],
      },
      currentTarget: 1,
      persist: (): void => {
        return undefined;
      },
    });
  });
}

function noop(): void {
  return undefined;
}

/**
 * The view wrapping one row inside the group - the one that carries the
 * separator. It is the row's direct parent in the host tree.
 */
function rowWrapper(testID: string): RenderedElement {
  return screen.getByTestId(testID).parent as RenderedElement;
}

describe("ListGroup", () => {
  test("renders a title as a header above the group", async () => {
    await render(
      <ListGroup title="Account">
        <ListItem title="Email" />
      </ListGroup>,
    );

    const header: RenderedElement = screen.getByRole("header", {
      name: "Account",
    });
    expect(header).toHaveStyle({
      color: lightColors.textSecondary,
      textTransform: "uppercase",
    });
  });

  test("renders a footer as muted help text below the group", async () => {
    await render(
      <ListGroup footer="Used for page escalations.">
        <ListItem title="Phone" />
      </ListGroup>,
    );

    expect(screen.getByText("Used for page escalations.")).toHaveStyle({
      color: lightColors.textSecondary,
    });
  });

  test("renders neither title nor footer when they are not given", async () => {
    await render(
      <ListGroup testID="group">
        <ListItem title="Phone" />
      </ListGroup>,
    );

    expect(screen.queryByRole("header")).toBeNull();
    /* The group holds only the rounded container. */
    expect(screen.getByTestId("group").children).toHaveLength(1);
  });

  test("the rows sit on one rounded, bordered card surface", async () => {
    await render(
      <ListGroup>
        <ListItem title="Email" testID="row-email" />
      </ListGroup>,
    );

    const surface: RenderedElement = rowWrapper("row-email")
      .parent as RenderedElement;
    expect(surface).toHaveStyle({
      borderRadius: radius.lg,
      backgroundColor: lightColors.backgroundElevated,
      borderWidth: 1,
      borderColor: lightColors.borderSubtle,
      overflow: "hidden",
      boxShadow: elevation("card", false).boxShadow,
    });
  });

  test("separates rows with a hairline between them, never above the first", async () => {
    await render(
      <ListGroup>
        <ListItem title="Email" testID="row-1" />
        <ListItem title="Phone" testID="row-2" />
        <ListItem title="Timezone" testID="row-3" />
      </ListGroup>,
    );

    expect(flat(rowWrapper("row-1")).borderTopWidth).toBeUndefined();
    for (const testID of ["row-2", "row-3"]) {
      expect(rowWrapper(testID)).toHaveStyle({
        borderTopWidth: 1,
        borderTopColor: lightColors.borderSubtle,
      });
    }
  });

  test("a single row has no separator at all", async () => {
    await render(
      <ListGroup>
        <ListItem title="Email" testID="only" />
      </ListGroup>,
    );

    expect(flat(rowWrapper("only")).borderTopWidth).toBeUndefined();
  });

  test("conditionally omitted rows do not leave a stray separator or gap", async () => {
    const showPhone: boolean = false;
    await render(
      <ListGroup>
        {showPhone ? <ListItem title="Phone" testID="phone" /> : null}
        {false}
        <ListItem title="Email" testID="email" />
        {undefined}
        <ListItem title="Timezone" testID="timezone" />
      </ListGroup>,
    );

    expect(screen.queryByTestId("phone")).toBeNull();
    expect(flat(rowWrapper("email")).borderTopWidth).toBeUndefined();
    expect(flat(rowWrapper("timezone")).borderTopWidth).toBe(1);
    expect(
      (rowWrapper("email").parent as RenderedElement).children,
    ).toHaveLength(2);
  });

  test("hiding a row does not remount the rows after it", async () => {
    /*
     * Rows used to be keyed by position, so when a conditional row above
     * disappeared every row below it was torn down and rebuilt - losing
     * whatever local state it held (an expanded section, a half-typed value,
     * a switch mid-animation).
     */
    const mounts: { count: number } = { count: 0 };

    function StatefulRow(): React.JSX.Element {
      const [taps, setTaps] = useState(0);
      useEffect(() => {
        mounts.count += 1;
      }, []);
      return (
        <ListItem
          title={`Tapped ${taps}`}
          onPress={() => {
            setTaps((value: number) => {
              return value + 1;
            });
          }}
        />
      );
    }

    function Group({ showBanner }: { showBanner: boolean }): React.JSX.Element {
      return (
        <ListGroup>
          {showBanner ? <ListItem title="Banner row" /> : null}
          <StatefulRow />
        </ListGroup>
      );
    }

    const view: Awaited<ReturnType<typeof render>> = await render(
      <Group showBanner />,
    );
    await fireEvent.press(screen.getByRole("button", { name: "Tapped 0" }));
    expect(screen.getByText("Tapped 1")).toBeTruthy();
    expect(mounts.count).toBe(1);

    await view.rerender(<Group showBanner={false} />);

    expect(screen.queryByText("Banner row")).toBeNull();
    expect(screen.getByText("Tapped 1")).toBeTruthy();
    expect(mounts.count).toBe(1);
  });

  test("accepts arbitrary children as rows", async () => {
    await render(
      <ListGroup>
        <Text testID="custom">Custom row</Text>
        <ListItem title="Email" testID="email" />
      </ListGroup>,
    );

    expect(screen.getByText("Custom row")).toBeTruthy();
    expect(flat(rowWrapper("email")).borderTopWidth).toBe(1);
  });

  test("a caller's style is applied to the outer group", async () => {
    await render(
      <ListGroup testID="group" style={{ marginTop: 24 }}>
        <ListItem title="Email" />
      </ListGroup>,
    );

    expect(screen.getByTestId("group")).toHaveStyle({ marginTop: 24 });
  });
});

describe("ListItem content", () => {
  test("shows title, subtitle and value, each in its own style", async () => {
    await render(
      <ListItem
        title="Server"
        subtitle="Where this app signs in"
        value="https://oneuptime.com"
      />,
    );

    expect(screen.getByText("Server")).toHaveStyle({
      color: lightColors.textPrimary,
      fontWeight: "600",
    });
    expect(screen.getByText("Where this app signs in")).toHaveStyle({
      color: lightColors.textSecondary,
    });
    expect(screen.getByText("https://oneuptime.com")).toHaveStyle({
      color: lightColors.textSecondary,
    });
  });

  test("the value can be made selectable, e.g. for a server address", async () => {
    await render(
      <ListItem title="Server" value="https://oneuptime.com" selectableValue />,
    );

    expect(screen.getByText("https://oneuptime.com")).toHaveProp(
      "selectable",
      true,
    );
  });

  test("an icon sits on a small tile tinted with the accent by default", async () => {
    await render(<ListItem title="Notifications" icon="notifications" />);

    const glyph: RenderedElement = screen.getByText(glyphFor("notifications"));
    expect(flat(glyph).color).toBe(lightColors.actionPrimary);
    expect(glyph.parent as RenderedElement).toHaveStyle({
      width: 30,
      height: 30,
      backgroundColor: withAlpha(lightColors.actionPrimary, 0.12),
    });
  });

  test("iconColor tints the icon and its tile", async () => {
    await render(
      <ListItem
        title="On call"
        icon="call"
        iconColor={lightColors.statusSuccess}
      />,
    );

    const glyph: RenderedElement = screen.getByText(glyphFor("call"));
    expect(flat(glyph).color).toBe(lightColors.statusSuccess);
    expect(glyph.parent as RenderedElement).toHaveStyle({
      backgroundColor: withAlpha(lightColors.statusSuccess, 0.12),
    });
  });

  test("no icon tile without an icon: the text column leads the row", async () => {
    await render(<ListItem title="Version" value="13.0.4" testID="row" />);

    const content: RenderedElement = screen.getByTestId("row")
      .children[0] as RenderedElement;
    const leading: RenderedElement = content.children[0] as RenderedElement;
    expect(flat(leading).flex).toBe(1);
    expect(screen.getByText("Version").parent).toBe(leading);
  });

  test("rows keep a comfortable touch height", async () => {
    await render(<ListItem title="Version" testID="row" />);

    const content: RenderedElement = screen.getByTestId("row")
      .children[0] as RenderedElement;
    expect(Number(flat(content).minHeight)).toBeGreaterThanOrEqual(touchTarget);
  });
});

describe("ListItem chevron", () => {
  test("shown for a pressable row with no trailing control", async () => {
    await render(<ListItem title="Projects" onPress={noop} />);

    const chevron: RenderedElement = screen.getByText(
      glyphFor("chevron-forward"),
    );
    expect(flat(chevron).color).toBe(lightColors.textTertiary);
  });

  test("hidden for a row that cannot be pressed", async () => {
    await render(<ListItem title="Version" value="13.0.4" />);

    expect(screen.queryByText(glyphFor("chevron-forward"))).toBeNull();
  });

  test("hidden when a trailing control is present, so a switch is not mistaken for a link", async () => {
    await render(
      <ListItem
        title="Biometric lock"
        onPress={noop}
        trailing={<Switch value={false} testID="switch" />}
      />,
    );

    expect(screen.getByTestId("switch")).toBeTruthy();
    expect(screen.queryByText(glyphFor("chevron-forward"))).toBeNull();
  });

  test("showChevron={false} hides it even for a pressable row", async () => {
    await render(
      <ListItem title="Sign out" onPress={noop} showChevron={false} />,
    );

    expect(screen.queryByText(glyphFor("chevron-forward"))).toBeNull();
  });

  test("showChevron forces it on a static row", async () => {
    await render(<ListItem title="Help" showChevron />);

    expect(screen.getByText(glyphFor("chevron-forward"))).toBeTruthy();
  });
});

describe("ListItem trailing content", () => {
  test("renders whatever is passed after the text", async () => {
    await render(
      <ListItem title="Status" trailing={<Text>Online</Text>} testID="row" />,
    );

    expect(screen.getByText("Online")).toBeTruthy();
  });
});

describe("A pressable ListItem", () => {
  test("is a button named by its title, with its subtitle as the hint", async () => {
    await render(
      <ListItem
        title="Appearance"
        subtitle="Light, dark or system"
        onPress={noop}
      />,
    );

    expect(screen.getByRole("button", { name: "Appearance" })).toHaveProp(
      "accessibilityHint",
      "Light, dark or system",
    );
  });

  test("announces its value alongside the title, without renaming the button", async () => {
    /*
     * A row such as "Appearance - System" is only useful if the current
     * setting is read out. The name stays the title so the row can still be
     * found by it; the value travels as the accessibility value, which both
     * VoiceOver and TalkBack read after the name.
     */
    await render(<ListItem title="Appearance" value="System" onPress={noop} />);

    expect(
      screen.getByRole("button", { name: "Appearance" }),
    ).toHaveAccessibilityValue({ text: "System" });
  });

  test("a pressable row without a value carries no accessibility value text", async () => {
    await render(<ListItem title="Projects" onPress={noop} />);

    expect(
      screen.getByRole("button", { name: "Projects" }).props.accessibilityValue
        ?.text,
    ).toBeUndefined();
  });

  test("explicit accessibility label and hint win", async () => {
    await render(
      <ListItem
        title="Appearance"
        subtitle="Light, dark or system"
        onPress={noop}
        accessibilityLabel="Change appearance"
        accessibilityHint="Opens appearance options"
      />,
    );

    expect(
      screen.getByRole("button", { name: "Change appearance" }),
    ).toHaveProp("accessibilityHint", "Opens appearance options");
  });

  test("pressing runs onPress", async () => {
    const onPress: jest.Mock = jest.fn();
    await render(<ListItem title="Projects" onPress={onPress} />);

    await fireEvent.press(screen.getByRole("button", { name: "Projects" }));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test("is transparent at rest and fills with the muted surface while held", async () => {
    await render(<ListItem title="Projects" onPress={noop} testID="row" />);
    const row: RenderedElement = screen.getByTestId("row");

    expect(row).toHaveStyle({ backgroundColor: "transparent" });

    await holdDown(row);

    expect(row).toHaveStyle({
      backgroundColor: lightColors.backgroundTertiary,
    });
  });

  test("a static row is not a button and is not an accessibility element on its own", async () => {
    await render(<ListItem title="Version" value="13.0.4" testID="row" />);

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByTestId("row")).toHaveProp("accessible", false);
  });
});

describe("A destructive ListItem", () => {
  test("paints the title and icon in the destructive colour", async () => {
    await render(
      <ListItem
        title="Sign out"
        icon="log-out-outline"
        destructive
        onPress={noop}
      />,
    );

    expect(screen.getByText("Sign out")).toHaveStyle({
      color: lightColors.actionDestructive,
    });
    const glyph: RenderedElement = screen.getByText(
      glyphFor("log-out-outline"),
    );
    expect(flat(glyph).color).toBe(lightColors.actionDestructive);
    expect(glyph.parent as RenderedElement).toHaveStyle({
      backgroundColor: withAlpha(lightColors.actionDestructive, 0.12),
    });
  });

  test("destructive wins over a caller's iconColor", async () => {
    await render(
      <ListItem
        title="Delete"
        icon="trash"
        iconColor={lightColors.statusSuccess}
        destructive
      />,
    );

    expect(flat(screen.getByText(glyphFor("trash"))).color).toBe(
      lightColors.actionDestructive,
    );
  });

  test("a non-destructive title stays the primary text colour", async () => {
    await render(<ListItem title="Projects" icon="folder" />);

    expect(screen.getByText("Projects")).toHaveStyle({
      color: lightColors.textPrimary,
    });
  });
});

describe("In dark mode", () => {
  test("the group surface, separators and text use the dark palette", async () => {
    mockSystemScheme = "dark";
    await render(
      <ThemeProvider>
        <ListGroup title="Account" footer="Help">
          <ListItem title="Email" testID="row-1" />
          <ListItem title="Phone" subtitle="Mobile" testID="row-2" />
        </ListGroup>
      </ThemeProvider>,
    );

    expect(rowWrapper("row-2")).toHaveStyle({
      borderTopColor: darkColors.borderSubtle,
    });
    expect(rowWrapper("row-1").parent as RenderedElement).toHaveStyle({
      backgroundColor: darkColors.backgroundElevated,
      boxShadow: elevation("card", true).boxShadow,
    });
    expect(screen.getByText("Email")).toHaveStyle({
      color: darkColors.textPrimary,
    });
    expect(screen.getByText("Mobile")).toHaveStyle({
      color: darkColors.textSecondary,
    });
    expect(screen.getByRole("header", { name: "Account" })).toHaveStyle({
      color: darkColors.textSecondary,
    });
  });

  test("a destructive row uses the dark destructive colour and a stronger tint", async () => {
    mockSystemScheme = "dark";
    await render(
      <ThemeProvider>
        <ListItem title="Sign out" icon="log-out-outline" destructive />
      </ThemeProvider>,
    );

    expect(screen.getByText("Sign out")).toHaveStyle({
      color: darkColors.actionDestructive,
    });
    const glyph: RenderedElement = screen.getByText(
      glyphFor("log-out-outline"),
    );
    expect(glyph.parent as RenderedElement).toHaveStyle({
      backgroundColor: withAlpha(darkColors.actionDestructive, 0.2),
    });
  });
});
