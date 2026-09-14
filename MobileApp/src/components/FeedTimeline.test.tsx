import React from "react";
import { render, screen } from "@testing-library/react-native";
import { describe, expect, test } from "@jest/globals";
import FeedTimeline from "./FeedTimeline";
import { makeColor, makeFeedItem } from "../__tests__/testSupport";
import { darkColors } from "../theme";
import type { ColorField, FeedItem } from "../api/types";

/*
 * The activity feed on every detail screen: who acknowledged what, when the
 * state changed, which automation fired. During an incident it is the record a
 * responder joining halfway through reads to find out what has already been
 * tried, so an entry that fails to render is a step somebody repeats.
 *
 * The parts worth pinning down are the ones driven by data the server does not
 * always send: the colour of the dot, the second block of detail, and the
 * timestamp - which is posted-at when there is one and created-at when there
 * is not.
 */

type Rendered = ReturnType<typeof screen.getByText>;
type Style = Record<string, unknown>;

const NO_TIMESTAMP: string = "—";

/**
 * The coloured dots down the left-hand rail, one per entry.
 *
 * They carry neither text nor label, so the only handle on them is the shape
 * the component gives them; the fully-round border radius is what separates
 * them from every other small box on the card.
 */
function dotColors(): string[] {
  return screen.container
    .queryAll((node: Rendered) => {
      const style: Style | undefined = node.props.style as Style | undefined;

      if (!style) {
        return false;
      }

      return style.width === 10 && style.borderRadius === 9999;
    })
    .map((node: Rendered) => {
      return (node.props.style as { backgroundColor: string }).backgroundColor;
    });
}

/**
 * The hairlines joining one dot to the next. There should be one fewer of
 * these than there are entries: a rail that carries on past the last entry
 * reads as a feed that has more to show.
 */
function connectorCount(): number {
  return screen.container.queryAll((node: Rendered) => {
    const style: Style | undefined = node.props.style as Style | undefined;

    if (!style) {
      return false;
    }

    return style.width === 1 && style.flex === 1;
  }).length;
}

describe("A feed with entries in it", () => {
  test("each entry's text is rendered", async () => {
    const feed: FeedItem[] = [
      makeFeedItem({ _id: "feed-1", feedInfoInMarkdown: "Incident created" }),
      makeFeedItem({
        _id: "feed-2",
        feedInfoInMarkdown: "Acknowledged by Ada Lovelace",
      }),
    ];

    await render(<FeedTimeline feed={feed} />);

    expect(screen.getByText("Incident created")).toBeTruthy();
    expect(screen.getByText("Acknowledged by Ada Lovelace")).toBeTruthy();
  });

  test("markdown in an entry is rendered as markdown", async () => {
    await render(
      <FeedTimeline
        feed={[makeFeedItem({ feedInfoInMarkdown: "**Acknowledged** by Ada" })]}
      />,
    );

    expect(screen.getByText("Acknowledged")).toBeTruthy();
  });

  test("the extra detail is shown when the entry carries some", async () => {
    await render(
      <FeedTimeline
        feed={[
          makeFeedItem({
            feedInfoInMarkdown: "Escalation policy ran",
            moreInformationInMarkdown: "Paged the database on-call rotation.",
          }),
        ]}
      />,
    );

    expect(
      screen.getByText("Paged the database on-call rotation."),
    ).toBeTruthy();
  });

  test("and nothing stands in for it when the entry carries none", async () => {
    /*
     * An empty second block would put a gap under every ordinary entry in the
     * feed, which on a phone is most of a screen over a long incident.
     */
    await render(
      <FeedTimeline
        feed={[makeFeedItem({ feedInfoInMarkdown: "Incident created" })]}
      />,
    );

    expect(screen.getByText("Incident created")).toBeTruthy();
    expect(
      screen.queryByText("Paged the database on-call rotation."),
    ).toBeNull();
  });

  test("the rail stops at the last entry", async () => {
    const feed: FeedItem[] = [
      makeFeedItem({ _id: "feed-1" }),
      makeFeedItem({ _id: "feed-2" }),
      makeFeedItem({ _id: "feed-3" }),
    ];

    await render(<FeedTimeline feed={feed} />);

    expect(dotColors()).toHaveLength(3);
    expect(connectorCount()).toBe(2);
  });

  test("a single entry gets a dot and no rail at all", async () => {
    await render(<FeedTimeline feed={[makeFeedItem()]} />);

    expect(dotColors()).toHaveLength(1);
    expect(connectorCount()).toBe(0);
  });
});

describe("The timestamp on an entry", () => {
  test("posted-at is what is shown when the server sent one", async () => {
    /*
     * The two differ whenever an entry was recorded after the fact - a
     * backfilled state change, an automation that reported late - and
     * posted-at is the moment the responder cares about.
     */
    await render(
      <FeedTimeline
        feed={[
          makeFeedItem({
            postedAt: "2026-08-30T10:06:00.000Z",
            createdAt: "2019-01-02T03:04:00.000Z",
          }),
        ]}
      />,
    );

    expect(screen.getByText(/2026/)).toBeTruthy();
    expect(screen.queryByText(/2019/)).toBeNull();
  });

  test("created-at stands in when it did not", async () => {
    await render(
      <FeedTimeline
        feed={[
          makeFeedItem({
            postedAt: undefined,
            createdAt: "2019-01-02T03:04:00.000Z",
          }),
        ]}
      />,
    );

    expect(screen.getByText(/2019/)).toBeTruthy();
  });

  test("an entry with no usable time says so rather than inventing one", async () => {
    /*
     * new Date(undefined) is not a date and new Date(null) is 1970; either one
     * printed beside a feed entry is a claim about when something happened
     * that the server never made.
     */
    await render(
      <FeedTimeline
        feed={[
          makeFeedItem({
            postedAt: undefined,
            createdAt: undefined as unknown as string,
          }),
        ]}
      />,
    );

    expect(screen.getByText(NO_TIMESTAMP)).toBeTruthy();
  });
});

describe("The colour of an entry's dot", () => {
  test("the colour the server sent is the colour on screen", async () => {
    await render(
      <FeedTimeline
        feed={[
          makeFeedItem({ displayColor: makeColor({ r: 34, g: 197, b: 94 }) }),
        ]}
      />,
    );

    expect(dotColors()).toEqual(["#22c55e"]);
  });

  test("an entry with no colour falls back to the app's accent", async () => {
    /*
     * displayColor is optional on the API and absent on plenty of feed rows.
     * The fallback has to be a visible colour: a dot painted with undefined is
     * an invisible dot, and the rail beside it then looks broken.
     */
    await render(
      <FeedTimeline feed={[makeFeedItem({ displayColor: undefined })]} />,
    );

    expect(dotColors()).toEqual([darkColors.actionPrimary]);
  });

  test("a colour object with no channels in it falls back to neutral grey", async () => {
    /*
     * Not to black. rgbToHex treats an object that names no channel as
     * unreadable rather than as rgb(0,0,0), because a black dot on this
     * near-black background cannot be seen at all.
     */
    await render(
      <FeedTimeline
        feed={[makeFeedItem({ displayColor: {} as unknown as ColorField })]}
      />,
    );

    expect(dotColors()).toEqual(["#9ca3af"]);
  });

  test("entries keep their own colours rather than sharing one", async () => {
    await render(
      <FeedTimeline
        feed={[
          makeFeedItem({
            _id: "feed-1",
            displayColor: makeColor({ r: 220, g: 38, b: 38 }),
          }),
          makeFeedItem({ _id: "feed-2", displayColor: undefined }),
        ]}
      />,
    );

    expect(dotColors()).toEqual(["#dc2626", darkColors.actionPrimary]);
  });
});

describe("A feed with nothing in it", () => {
  test("renders no entries", async () => {
    await render(<FeedTimeline feed={[]} />);

    expect(dotColors()).toHaveLength(0);
    expect(connectorCount()).toBe(0);
  });

  test("and does not throw out of render", async () => {
    /*
     * An empty feed is the ordinary state of a brand-new incident, which is
     * exactly when a responder opens the screen.
     */
    const view: { unmount: () => Promise<void> } = await render(
      <FeedTimeline feed={[]} />,
    );

    expect(screen.container).toBeTruthy();
    await view.unmount();
  });

  test("says nothing on its own behalf, because the screen says it", async () => {
    /*
     * The detail screens own the "no activity yet" copy; a second empty-state
     * message here would print underneath theirs.
     */
    await render(<FeedTimeline feed={[]} />);

    expect(screen.queryByText(NO_TIMESTAMP)).toBeNull();
  });
});
