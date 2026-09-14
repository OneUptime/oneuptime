import React from "react";
import { Text } from "react-native";
import { render, screen } from "@testing-library/react-native";
import { afterEach, describe, expect, test } from "@jest/globals";
import GlassCard from "./GlassCard";
import { ThemeProvider, darkColors, lightColors } from "../theme";

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

/*
 * The surface almost everything in the app sits on. It has two jobs: to carry
 * the same border and radius everywhere so the screens look like one app, and
 * to let a caller adjust the parts it does not own - spacing, mostly - without
 * having to rebuild the surface itself.
 *
 * The interesting behaviour is the second one, because the caller's style is
 * spread AFTER the defaults. That ordering is what lets a caller override a
 * default, and it is also what would let a careless caller flatten the card
 * entirely, so it is worth stating out loud rather than leaving to be
 * rediscovered.
 */

type RenderedElement = ReturnType<typeof screen.getByText>;

function surface(): RenderedElement {
  return screen.root as RenderedElement;
}

function surfaceStyle(): Record<string, unknown> {
  return surface().props.style as Record<string, unknown>;
}

describe("What the card draws", () => {
  test("its children, untouched", async () => {
    await render(
      <GlassCard>
        <Text>Root cause</Text>
      </GlassCard>,
    );

    expect(screen.getByText("Root cause")).toBeTruthy();
  });

  test("the glass surface by default", async () => {
    await render(
      <GlassCard>
        <Text>Root cause</Text>
      </GlassCard>,
    );

    expect(surfaceStyle().backgroundColor).toBe(lightColors.backgroundGlass);
  });

  test("an opaque surface when asked, so content cannot show through it", async () => {
    /*
     * `opaque` is what a caller reaches for when the card is stacked on
     * something, and it must always resolve to the solid card token. The
     * redesign retired the translucent glass fill - `backgroundGlass` is now
     * the same solid colour as `backgroundElevated` in both palettes - so the
     * two surfaces happen to match today. What is pinned is the token opaque
     * asks for, not a difference between them.
     */
    await render(
      <GlassCard opaque>
        <Text>Root cause</Text>
      </GlassCard>,
    );

    expect(surfaceStyle().backgroundColor).toBe(lightColors.backgroundElevated);
  });

  test("the glass fill is solid in both palettes, so text on it stays readable", async () => {
    /*
     * The old fill was white at 3%, which left body text sitting on whatever
     * happened to be behind the card. A translucent value creeping back into
     * the token would silently undo that on every screen at once.
     */
    for (const colors of [lightColors, darkColors]) {
      expect(colors.backgroundGlass).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  test("the shared border and radius, whichever surface it is", async () => {
    await render(
      <GlassCard opaque>
        <Text>Root cause</Text>
      </GlassCard>,
    );

    expect(surfaceStyle().borderColor).toBe(lightColors.borderGlass);
    expect(surfaceStyle().borderWidth).toBe(1);
    expect(surfaceStyle().borderRadius).toBe(16);
  });

  test("a card with nothing in it still draws its surface", async () => {
    /*
     * Callers render a card around a list that turns out to be empty often
     * enough that this must not collapse or throw.
     */
    await render(<GlassCard>{null}</GlassCard>);

    expect(surfaceStyle().backgroundColor).toBe(lightColors.backgroundGlass);
  });
});

describe("A caller adjusting the card", () => {
  test("styles it did not set are added to the defaults", async () => {
    await render(
      <GlassCard style={{ marginTop: 20, padding: 16 }}>
        <Text>Root cause</Text>
      </GlassCard>,
    );

    expect(surfaceStyle().marginTop).toBe(20);
    expect(surfaceStyle().padding).toBe(16);
    expect(surfaceStyle().borderRadius).toBe(16);
  });

  test("a style it did set wins over the default", async () => {
    /*
     * Deliberate: the detail screens square off the top corners of a card that
     * butts against a header. If the defaults won instead, the only way to get
     * that would be to stop using the shared card.
     */
    await render(
      <GlassCard style={{ borderRadius: 0 }}>
        <Text>Root cause</Text>
      </GlassCard>,
    );

    expect(surfaceStyle().borderRadius).toBe(0);
  });

  test("the caller's own style does not disturb the surface it did not name", async () => {
    await render(
      <GlassCard opaque style={{ marginBottom: 12 }}>
        <Text>Root cause</Text>
      </GlassCard>,
    );

    expect(surfaceStyle().marginBottom).toBe(12);
    expect(surfaceStyle().backgroundColor).toBe(lightColors.backgroundElevated);
  });
});

describe("In dark mode", () => {
  afterEach(() => {
    mockSystemScheme = "light";
  });

  test("the surface and border come from the dark palette", async () => {
    mockSystemScheme = "dark";
    await render(
      <ThemeProvider>
        <GlassCard>
          <Text>Root cause</Text>
        </GlassCard>
      </ThemeProvider>,
    );

    const card: RenderedElement = screen.getByText("Root cause")
      .parent as RenderedElement;
    expect(card).toHaveStyle({
      backgroundColor: darkColors.backgroundGlass,
      borderColor: darkColors.borderGlass,
      borderRadius: 16,
    });
  });
});
