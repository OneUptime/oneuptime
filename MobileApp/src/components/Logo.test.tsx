import React from "react";
import { StyleSheet } from "react-native";
import { render, screen } from "@testing-library/react-native";
import { describe, expect, test } from "@jest/globals";
import Logo from "./Logo";

/*
 * The mark on the sign-in, server-URL, two-factor and biometric-lock screens -
 * every screen shown to someone who is not yet logged in, and the lock screen
 * shown to someone being woken up.
 *
 * It is drawn from an SVG string held in the component rather than fetched or
 * loaded from an asset, and that is the property worth guarding: those screens
 * are the ones most likely to be reached on a bad network, on a handset that
 * has just come back from being offline. A logo that needed the network would
 * be missing at exactly the wrong moment.
 */

type RenderedElement = ReturnType<typeof screen.getByText>;

function svg(): RenderedElement {
  return screen.root as RenderedElement;
}

describe("How large the logo is drawn", () => {
  test("a size given by the caller is used for both dimensions", async () => {
    /*
     * Square by construction: the mark is drawn on a square viewBox, so a
     * width applied without the matching height would letterbox it.
     */
    await render(<Logo size={90} />);

    expect(svg().props.width).toBe(90);
    expect(svg().props.height).toBe(90);
  });

  test("a caller that does not care gets the default size", async () => {
    await render(<Logo />);

    expect(svg().props.width).toBe(32);
    expect(svg().props.height).toBe(32);
  });

  test("different callers get different sizes from the same component", async () => {
    const small: { unmount: () => Promise<void> } = await render(
      <Logo size={40} />,
    );
    expect(svg().props.width).toBe(40);
    await small.unmount();

    await render(<Logo size={76} />);
    expect(svg().props.width).toBe(76);
  });
});

describe("What the logo is made of", () => {
  test("the artwork travels with the app rather than being fetched", async () => {
    /*
     * The assertion is on the markup being present and complete, because that
     * is what makes the mark render on a handset with no connection. If this
     * ever became a URL or an asset require, this is the test that should have
     * to be rewritten deliberately.
     */
    await render(<Logo />);

    const xml: string = svg().props.xml as string;

    expect(typeof xml).toBe("string");
    expect(xml).toContain("<svg");
    expect(xml.trimEnd().endsWith("</svg>")).toBe(true);
  });

  test("a style from the caller reaches the rendered mark", async () => {
    /*
     * The auth screens position the logo themselves - centred, with a margin
     * under it - so a style that stopped being forwarded would pile the logo
     * on top of the title.
     *
     * Flattened first because react-native-svg layers three styles onto the
     * view it renders: its own defaults, the caller's, and the width and
     * height it derives from `size`. Reading the array's second entry would be
     * asserting the order that library happens to compose them in.
     */
    await render(<Logo size={72} style={{ marginBottom: 24 }} />);

    const style: Record<string, unknown> = StyleSheet.flatten(
      svg().props.style,
    ) as Record<string, unknown>;

    expect(style.marginBottom).toBe(24);
  });

  test("the caller's style does not cost the logo its size", async () => {
    await render(<Logo size={72} style={{ marginBottom: 24 }} />);

    const style: Record<string, unknown> = StyleSheet.flatten(
      svg().props.style,
    ) as Record<string, unknown>;

    expect(style.width).toBe(72);
    expect(style.height).toBe(72);
  });
});
