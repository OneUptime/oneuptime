import React from "react";
import { Text, processColor } from "react-native";
import { render, screen } from "@testing-library/react-native";
import { describe, expect, test } from "@jest/globals";
import GradientHeader from "./GradientHeader";
import { darkColors } from "../theme";

/*
 * The wash of light behind the top of every screen. It is absolutely
 * positioned and sits UNDER the content, so the two things that can go wrong
 * with it are silent: a gradient that covers the whole screen instead of its
 * header hides the page behind a veil, and one that renders at zero height
 * leaves the top of the app flat and unlike every other screen.
 */

type RenderedElement = ReturnType<typeof screen.getByText>;

/**
 * The layer expo-linear-gradient actually paints.
 *
 * It has to be searched for rather than taken from the root, because the two
 * platforms build a different tree for the same JSX: on iOS the native
 * gradient view IS the root and carries our style, while on Android the
 * component wraps itself in a plain View and paints into an absolutely
 * positioned child. Reaching for `screen.root` would therefore assert against
 * the wrapper on one platform and the gradient on the other. `colors` is the
 * prop only the painted layer has.
 */
function gradientLayer(): RenderedElement {
  const layers: RenderedElement[] = screen.container.queryAll(
    (node: RenderedElement): boolean => {
      return node.props.colors !== undefined;
    },
  );

  expect(layers).toHaveLength(1);

  return layers[0];
}

function frameStyle(): Record<string, unknown> {
  const root: RenderedElement = screen.root as RenderedElement;
  return root.props.style as Record<string, unknown>;
}

describe("Where the gradient sits", () => {
  test("pinned to the top of the screen and across its full width", async () => {
    await render(<GradientHeader />);

    expect(frameStyle().position).toBe("absolute");
    expect(frameStyle().top).toBe(0);
    expect(frameStyle().left).toBe(0);
    expect(frameStyle().right).toBe(0);
  });

  test("it stops after the header rather than washing over the page", async () => {
    /*
     * The default is a header's worth of screen, not the screen. Losing the
     * bound - a height of undefined, say - would let the gradient stretch over
     * the list below it.
     */
    await render(<GradientHeader />);

    expect(frameStyle().height).toBe(320);
  });

  test("a screen that wants a shorter wash asks for one", async () => {
    await render(<GradientHeader height={120} />);

    expect(frameStyle().height).toBe(120);
  });

  test("a height of zero is honoured rather than falling back to the default", async () => {
    /*
     * `height = 320` is a default parameter, so it only applies when the prop
     * is absent. A caller passing 0 deliberately - to turn the wash off on one
     * screen - must not be given a full-size header instead.
     */
    await render(<GradientHeader height={0} />);

    expect(frameStyle().height).toBe(0);
  });
});

describe("The colours it fades between", () => {
  test("it runs from the theme's gradient start to its end", async () => {
    /*
     * The native side takes processed colour integers rather than the CSS
     * strings the theme holds, so the expectation is put through the same
     * conversion React Native uses. Writing the integers out by hand would be
     * asserting against a number nobody could check.
     */
    await render(<GradientHeader />);

    expect(gradientLayer().props.colors).toEqual([
      processColor(darkColors.gradientStart),
      processColor(darkColors.gradientEnd),
    ]);
  });

  test("it fades downwards, not across", async () => {
    /*
     * A gradient running left to right would light one side of the header and
     * leave the other dark, which reads as a rendering fault rather than as a
     * design.
     */
    await render(<GradientHeader />);

    expect(gradientLayer().props.startPoint).toEqual([0.5, 0]);
    expect(gradientLayer().props.endPoint).toEqual([0.5, 1]);
  });
});

describe("What it holds", () => {
  test("children given to it are rendered inside it", async () => {
    await render(
      <GradientHeader>
        <Text>On call this week</Text>
      </GradientHeader>,
    );

    expect(screen.getByText("On call this week")).toBeTruthy();
  });

  test("it is happy being nothing but a backdrop", async () => {
    /*
     * Most screens use it purely as a background and put their content in a
     * sibling above it, so the childless case is the common one.
     */
    await render(<GradientHeader height={200} />);

    expect(frameStyle().height).toBe(200);
    expect(gradientLayer().props.colors).toHaveLength(2);
  });
});
