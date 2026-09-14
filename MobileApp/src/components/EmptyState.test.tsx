import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { describe, expect, test } from "@jest/globals";
import { Ionicons } from "@expo/vector-icons";
import EmptyState from "./EmptyState";

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
    const titleStyle: Record<string, unknown> = title.props.style as Record<
      string,
      unknown
    >;
    const subtitleStyle: Record<string, unknown> = subtitle.props
      .style as Record<string, unknown>;

    expect(Number(titleStyle.fontSize)).toBeGreaterThan(
      Number(subtitleStyle.fontSize),
    );
  });
});
