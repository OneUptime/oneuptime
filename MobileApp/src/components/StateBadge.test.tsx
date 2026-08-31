import React from "react";
import { render, screen } from "@testing-library/react-native";
import { describe, expect, test } from "@jest/globals";
import StateBadge, { type StateType } from "./StateBadge";
import { darkColors } from "../theme";

/*
 * The badge is the app's shorthand for "where has this got to", and the colour
 * of its dot is doing as much work as the word beside it: red for created,
 * amber for acknowledged, green for resolved is the vocabulary a responder
 * learns in the first minute and then reads without looking.
 *
 * So the tests below pin the pairing of word and colour rather than either
 * alone. A badge that says Resolved in the created red is worse than one that
 * says nothing at all.
 */

type RenderedElement = ReturnType<typeof screen.getByText>;

function styleOf(element: RenderedElement): Record<string, unknown> {
  return element.props.style as Record<string, unknown>;
}

/**
 * The coloured dot, which is the sibling drawn before the label inside the
 * pill.
 */
function dotBeside(label: RenderedElement): RenderedElement {
  const pill: RenderedElement = label.parent as RenderedElement;
  return pill.children[0] as RenderedElement;
}

describe("Each state is drawn in its own colour", () => {
  test("created is the created red", async () => {
    await render(<StateBadge state="created" />);

    expect(
      styleOf(dotBeside(screen.getByText("Created"))).backgroundColor,
    ).toBe(darkColors.stateCreated);
  });

  test("acknowledged is the acknowledged amber, not the created red", async () => {
    await render(<StateBadge state="acknowledged" />);

    const dot: RenderedElement = dotBeside(screen.getByText("Acknowledged"));
    expect(styleOf(dot).backgroundColor).toBe(darkColors.stateAcknowledged);
    expect(styleOf(dot).backgroundColor).not.toBe(darkColors.stateCreated);
  });

  test("resolved is the resolved green", async () => {
    await render(<StateBadge state="resolved" />);

    expect(
      styleOf(dotBeside(screen.getByText("Resolved"))).backgroundColor,
    ).toBe(darkColors.stateResolved);
  });

  test("investigating and muted have colours of their own too", async () => {
    const investigating: { unmount: () => Promise<void> } = await render(
      <StateBadge state="investigating" />,
    );
    expect(
      styleOf(dotBeside(screen.getByText("Investigating"))).backgroundColor,
    ).toBe(darkColors.stateInvestigating);
    await investigating.unmount();

    await render(<StateBadge state="muted" />);
    expect(styleOf(dotBeside(screen.getByText("Muted"))).backgroundColor).toBe(
      darkColors.stateMuted,
    );
  });
});

describe("What the badge says", () => {
  test("the state's own name is the label, capitalised for a sentence", async () => {
    /*
     * The prop is lower-case because it is an identifier; the badge sits in
     * running text next to a title, where a lower-case word reads as a typo.
     */
    await render(<StateBadge state="created" />);

    expect(screen.getByText("Created")).toBeTruthy();
    expect(screen.queryByText("created")).toBeNull();
  });

  test("an explicit label replaces the state name, capitalised the same way", async () => {
    await render(<StateBadge state="muted" label="snoozed for an hour" />);

    expect(screen.getByText("Snoozed for an hour")).toBeTruthy();
    expect(screen.queryByText("Muted")).toBeNull();
  });

  test("an explicit label does not change the colour the state is drawn in", async () => {
    /*
     * The label is free text from the caller; the colour is the state. A
     * caller renaming the badge must not be able to change what it means.
     */
    await render(<StateBadge state="resolved" label="Closed" />);

    expect(styleOf(dotBeside(screen.getByText("Closed"))).backgroundColor).toBe(
      darkColors.stateResolved,
    );
  });

  test("an empty label falls back to the state rather than rendering blank", async () => {
    /*
     * An empty string is what a caller passing a name straight off an API
     * response supplies when the field is present but unset, and a badge
     * showing a dot and no word is unreadable.
     */
    await render(<StateBadge state="acknowledged" label="" />);

    expect(screen.getByText("Acknowledged")).toBeTruthy();
  });

  test("a label that is already capitalised is left alone", async () => {
    await render(<StateBadge state="created" label="P1 escalation" />);

    expect(screen.getByText("P1 escalation")).toBeTruthy();
  });
});

describe("A state the badge has no colour for", () => {
  /*
   * The cast is the point: the union says this cannot happen, and it will the
   * first time a caller feeds this a state name straight off the API, where a
   * project can define states of its own. The word must still reach the
   * screen - the badge sits inside detail screens, and a throw out of render
   * takes the whole screen with it, not just the badge.
   */
  const unknownState: StateType = "escalated" as StateType;

  test("it renders the word instead of throwing out of render", async () => {
    await render(<StateBadge state={unknownState} />);

    expect(screen.getByText("Escalated")).toBeTruthy();
  });

  test("its dot borrows no other state's colour", async () => {
    /*
     * There is no fallback colour today, so the dot comes out unpainted. That
     * is not ideal, but it is honest: silently reusing, say, the resolved
     * green would tell the responder an unknown state is finished with.
     */
    await render(<StateBadge state={unknownState} />);

    const dot: RenderedElement = dotBeside(screen.getByText("Escalated"));
    expect(styleOf(dot).backgroundColor).not.toBe(darkColors.stateResolved);
    expect(styleOf(dot).backgroundColor).not.toBe(darkColors.stateCreated);
  });
});
