import React from "react";
import { Text } from "react-native";
import { render, screen } from "@testing-library/react-native";
import { describe, expect, test } from "@jest/globals";
import GlassCard from "./GlassCard";
import { darkColors } from "../theme";

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

    expect(surfaceStyle().backgroundColor).toBe(darkColors.backgroundGlass);
  });

  test("an opaque surface when asked, so content cannot show through it", async () => {
    /*
     * The glass fill is barely-there white at 3%, which is fine over a page
     * background and useless over another card. `opaque` is what a caller
     * reaches for when the card is stacked on something.
     */
    await render(
      <GlassCard opaque>
        <Text>Root cause</Text>
      </GlassCard>,
    );

    expect(surfaceStyle().backgroundColor).toBe(darkColors.backgroundElevated);
    expect(surfaceStyle().backgroundColor).not.toBe(darkColors.backgroundGlass);
  });

  test("the shared border and radius, whichever surface it is", async () => {
    await render(
      <GlassCard opaque>
        <Text>Root cause</Text>
      </GlassCard>,
    );

    expect(surfaceStyle().borderColor).toBe(darkColors.borderGlass);
    expect(surfaceStyle().borderWidth).toBe(1);
    expect(surfaceStyle().borderRadius).toBe(16);
  });

  test("a card with nothing in it still draws its surface", async () => {
    /*
     * Callers render a card around a list that turns out to be empty often
     * enough that this must not collapse or throw.
     */
    await render(<GlassCard>{null}</GlassCard>);

    expect(surfaceStyle().backgroundColor).toBe(darkColors.backgroundGlass);
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
    expect(surfaceStyle().backgroundColor).toBe(darkColors.backgroundElevated);
  });
});
