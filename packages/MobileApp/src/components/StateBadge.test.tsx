import React from "react";
import { StyleSheet } from "react-native";
import { render, screen } from "@testing-library/react-native";
import { beforeEach, describe, expect, test } from "@jest/globals";
import StateBadge, { type StateType } from "./StateBadge";
import { ThemeProvider, darkColors, lightColors } from "../theme";
import { radius } from "../theme/tokens";
import { withAlpha } from "../utils/color";

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

/** Styles may be arrays, so they are read flattened. */
function styleOf(element: RenderedElement): Record<string, unknown> {
  return (StyleSheet.flatten(element.props.style) ?? {}) as Record<
    string,
    unknown
  >;
}

let mockColorScheme: "light" | "dark" = "light";

/*
 * react-native exposes useColorScheme through a getter that cannot be spied
 * on, so the module behind it is replaced. Light unless a test says otherwise.
 */
jest.mock("react-native/Libraries/Utilities/useColorScheme", () => {
  return {
    __esModule: true,
    default: (): "light" | "dark" => {
      return mockColorScheme;
    },
  };
});

beforeEach(() => {
  mockColorScheme = "light";
});

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
    ).toBe(lightColors.stateCreated);
  });

  test("acknowledged is the acknowledged amber, not the created red", async () => {
    await render(<StateBadge state="acknowledged" />);

    const dot: RenderedElement = dotBeside(screen.getByText("Acknowledged"));
    expect(styleOf(dot).backgroundColor).toBe(lightColors.stateAcknowledged);
    expect(styleOf(dot).backgroundColor).not.toBe(lightColors.stateCreated);
  });

  test("resolved is the resolved green", async () => {
    await render(<StateBadge state="resolved" />);

    expect(
      styleOf(dotBeside(screen.getByText("Resolved"))).backgroundColor,
    ).toBe(lightColors.stateResolved);
  });

  test("investigating and muted have colours of their own too", async () => {
    const investigating: { unmount: () => Promise<void> } = await render(
      <StateBadge state="investigating" />,
    );
    expect(
      styleOf(dotBeside(screen.getByText("Investigating"))).backgroundColor,
    ).toBe(lightColors.stateInvestigating);
    await investigating.unmount();

    await render(<StateBadge state="muted" />);
    expect(styleOf(dotBeside(screen.getByText("Muted"))).backgroundColor).toBe(
      lightColors.stateMuted,
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
      lightColors.stateResolved,
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
     * The dot is drawn as a hollow neutral ring instead of a fill. Silently
     * reusing, say, the resolved green would tell the responder an unknown
     * state is finished with.
     */
    await render(<StateBadge state={unknownState} />);

    const dot: RenderedElement = dotBeside(screen.getByText("Escalated"));
    expect(styleOf(dot).backgroundColor).not.toBe(lightColors.stateResolved);
    expect(styleOf(dot).backgroundColor).not.toBe(lightColors.stateCreated);
  });

  test("its dot is a visible neutral ring rather than an invisible gap", async () => {
    await render(<StateBadge state={unknownState} />);

    const dot: RenderedElement = dotBeside(screen.getByText("Escalated"));
    expect(dot).toHaveStyle({
      backgroundColor: "transparent",
      borderWidth: 1.5,
      borderColor: lightColors.textTertiary,
    });
    expect(styleOf(dot.parent as RenderedElement).backgroundColor).toBe(
      lightColors.backgroundTertiary,
    );
  });
});

describe("The pill", () => {
  test("is a rounded pill tinted with its state's colour", async () => {
    await render(<StateBadge state="resolved" />);

    const pill: RenderedElement = screen.getByText("Resolved")
      .parent as RenderedElement;
    expect(pill).toHaveStyle({
      borderRadius: radius.pill,
      backgroundColor: withAlpha(lightColors.stateResolved, 0.1),
    });
  });

  test("keeps its label in high-contrast text whatever the state colour", async () => {
    await render(<StateBadge state="acknowledged" />);

    expect(screen.getByText("Acknowledged")).toHaveStyle({
      color: lightColors.textPrimary,
    });
  });

  test("in dark mode it reads the dark state colours and a stronger tint", async () => {
    mockColorScheme = "dark";

    await render(
      <ThemeProvider>
        <StateBadge state="created" />
      </ThemeProvider>,
    );

    const label: RenderedElement = screen.getByText("Created");
    expect(label).toHaveStyle({ color: darkColors.textPrimary });
    expect(dotBeside(label)).toHaveStyle({
      backgroundColor: darkColors.stateCreated,
    });
    expect(label.parent as RenderedElement).toHaveStyle({
      backgroundColor: withAlpha(darkColors.stateCreated, 0.18),
    });
  });
});
