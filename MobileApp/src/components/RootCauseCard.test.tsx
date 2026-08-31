import React from "react";
import { render, screen } from "@testing-library/react-native";
import { describe, expect, test } from "@jest/globals";
import RootCauseCard from "./RootCauseCard";
import { darkColors } from "../theme";

/*
 * The root cause is the one part of an incident written by a person, and it
 * arrives late: the card is on the detail screen from the first render, long
 * before anybody has typed anything into it. So the card spends most of its
 * life empty, and the question worth asking of it is whether an empty one
 * still says something - a card that rendered blank would look like a
 * half-loaded screen rather than an unanswered question.
 */

type RenderedElement = ReturnType<typeof screen.getByText>;

const PLACEHOLDER: string = "No root cause documented yet.";

function surfaceStyle(): Record<string, unknown> {
  const root: RenderedElement = screen.root as RenderedElement;
  return root.props.style as Record<string, unknown>;
}

describe("A root cause that has been written", () => {
  test("it is shown instead of the placeholder", async () => {
    await render(
      <RootCauseCard rootCauseText="The primary volume filled with debug logs." />,
    );

    expect(
      screen.getByText("The primary volume filled with debug logs."),
    ).toBeTruthy();
    expect(screen.queryByText(PLACEHOLDER)).toBeNull();
  });

  test("it is rendered as markdown, not printed with its syntax showing", async () => {
    /*
     * Root causes are written in the web app's markdown editor, so they arrive
     * full of asterisks and backticks. Printing them raw would put "**disk**"
     * in front of the responder, which is both ugly and, in a post-mortem
     * someone will paste elsewhere, wrong.
     */
    await render(<RootCauseCard rootCauseText="The **disk** filled up." />);

    expect(screen.getByText("disk")).toBeTruthy();
    expect(screen.queryByText(/\*\*/)).toBeNull();
  });

  test("a multi-line root cause keeps all of its lines", async () => {
    await render(
      <RootCauseCard
        rootCauseText={"First the disk filled.\n\nThen the pod was evicted."}
      />,
    );

    expect(screen.getByText("First the disk filled.")).toBeTruthy();
    expect(screen.getByText("Then the pod was evicted.")).toBeTruthy();
  });
});

describe("A root cause nobody has written yet", () => {
  test("an absent root cause says so in words", async () => {
    await render(<RootCauseCard />);

    expect(screen.getByText(PLACEHOLDER)).toBeTruthy();
  });

  test("an empty string is treated as nothing written, not as an empty answer", async () => {
    /*
     * The field comes back as "" from an incident whose root cause box was
     * opened and left blank, which means the same thing to a responder as the
     * field never having existed.
     */
    await render(<RootCauseCard rootCauseText="" />);

    expect(screen.getByText(PLACEHOLDER)).toBeTruthy();
  });

  test("the placeholder is drawn in the muted text colour, so it does not read as content", async () => {
    await render(<RootCauseCard />);

    const placeholder: RenderedElement = screen.getByText(PLACEHOLDER);
    const style: Record<string, unknown> = placeholder.props.style as Record<
      string,
      unknown
    >;

    expect(style.color).toBe(darkColors.textTertiary);
  });

  test("the card is still drawn around it, so the section does not collapse", async () => {
    /*
     * The section header above this card says "Root Cause". A card that
     * vanished when empty would leave that heading hanging over the next
     * section's content.
     */
    await render(<RootCauseCard />);

    expect(surfaceStyle().borderColor).toBe(darkColors.borderGlass);
    expect(surfaceStyle().backgroundColor).toBe(darkColors.backgroundElevated);
  });
});
