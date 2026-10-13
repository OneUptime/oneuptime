import { afterEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): React.ReactElement => {
      return React.createElement(
        "div",
        { "data-testid": "markdown" },
        props.text,
      );
    },
  };
});

import FeedItem, { FeedItemProps } from "../../../UI/Components/Feed/FeedItem";
import { Blue500, Red500 } from "../../../Types/BrandColors";
import IconProp from "../../../Types/Icon/IconProp";
import User from "../../../Models/DatabaseModels/User";
import Name from "../../../Types/Name";
import Email from "../../../Types/Email";
import ObjectID from "../../../Types/ObjectID";
import {
  FeedTimelineEntry,
  FeedTimelineTime,
} from "../../../UI/Components/Feed/FeedTimeline";
import { FeedBurstKind } from "../../../UI/Components/Feed/FeedEntryKind";

/*
 * One entry of a feed: its time, its kind's icon, the person who did it
 * leading the sentence, the body, details that unfold in place, and - on a
 * burst's first entry - the toggle that unfolds the rest. Real stored texts
 * are used, old and new, so how they read is what is tested.
 */

const LINK: string = "https://oneuptime.com/dashboard/p/incidents/i";

const NITIN_ID: ObjectID = ObjectID.generate();

const nitin: () => User = (): User => {
  const user: User = new User();
  user.id = NITIN_ID;
  user.name = new Name("Nitin Kumar");
  user.email = new Email("nitin@example.com");
  return user;
};

const TIME: FeedTimelineTime = {
  label: "3:25 PM",
  isShown: true,
  relativeHint: "12 min. ago",
  fullLabel: "Tuesday, October 13, 2026 at 3:25:00 PM GMT+08",
  isoString: "2026-10-13T07:25:00.000Z",
};

const item: (extra?: Partial<FeedItemProps>) => FeedItemProps = (
  extra?: Partial<FeedItemProps>,
): FeedItemProps => {
  return {
    key: "entry",
    textInMarkdown: "Something happened.",
    itemDateTime: new Date(TIME.isoString),
    icon: IconProp.Lock,
    color: Blue500,
    ...extra,
  };
};

const renderEntry: (data: {
  item: FeedItemProps;
  time?: Partial<FeedTimelineTime> | undefined;
  entry?: Partial<FeedTimelineEntry<FeedItemProps>> | undefined;
  isLastInDay?: boolean | undefined;
  onToggleBurst?: ((key: string) => void) | undefined;
}) => void = (data: {
  item: FeedItemProps;
  time?: Partial<FeedTimelineTime> | undefined;
  entry?: Partial<FeedTimelineEntry<FeedItemProps>> | undefined;
  isLastInDay?: boolean | undefined;
  onToggleBurst?: ((key: string) => void) | undefined;
}): void => {
  render(
    <ol>
      <FeedItem
        entry={{
          item: data.item,
          time: { ...TIME, ...(data.time || {}) },
          isInBurst: false,
          ...(data.entry || {}),
        }}
        isLastInDay={data.isLastInDay === true}
        onToggleBurst={data.onToggleBurst}
      />
    </ol>,
  );
};

afterEach(() => {
  cleanup();
});

describe("who did it", () => {
  test("their name leads the sentence an old note entry was written as", () => {
    renderEntry({
      item: item({
        user: nitin(),
        textInMarkdown: `📄 posted **private note** for this [Incident INC-8](${LINK}):\n\nIs this the cache?`,
      }),
    });

    const lead: HTMLElement = screen.getByTestId("feed-entry-lead");

    expect(lead).toHaveTextContent(
      `Nitin Kumar posted **private note** for this [Incident INC-8](${LINK}):`,
    );
    expect(lead).not.toHaveTextContent("📄");
    expect(screen.getByTestId("feed-entry-body")).toHaveTextContent(
      "Is this the cache?",
    );
    expect(within(lead).getByTestId("feed-entry-avatar")).toBeInTheDocument();
  });

  test("a sentence that opened with a capital verb reads in lower case after the name", () => {
    renderEntry({
      item: item({
        user: nitin(),
        textInMarkdown: `🔴 Changed **[Incident INC-8](${LINK}) State** to **Identified**`,
      }),
    });

    expect(screen.getByTestId("feed-entry-lead")).toHaveTextContent(
      `Nitin Kumar changed **[Incident INC-8](${LINK}) State** to **Identified**`,
    );
    expect(screen.queryByTestId("feed-entry-body")).not.toBeInTheDocument();
  });

  test("a sentence that already names them does not get the name twice", () => {
    renderEntry({
      item: item({
        user: nitin(),
        textInMarkdown: `🚫 **[Nitin Kumar](${LINK})** is no longer on call.`,
      }),
    });

    const lead: HTMLElement = screen.getByTestId("feed-entry-lead");

    expect(lead.textContent).toBe(
      `**[Nitin Kumar](${LINK})** is no longer on call.`,
    );
    expect(within(lead).getByTestId("feed-entry-avatar")).toBeInTheDocument();
  });

  test("an entry that opens with a heading keeps the name on its own line above it", () => {
    renderEntry({
      item: item({
        user: nitin(),
        textInMarkdown:
          "#### 🚨 Incident INC-8 Created:\n\n**Checkout down**:\n\nDetails.",
      }),
    });

    expect(screen.getByTestId("feed-entry-author")).toHaveTextContent(
      "Nitin Kumar",
    );
    expect(screen.queryByTestId("feed-entry-lead")).not.toBeInTheDocument();
    expect(screen.getByTestId("feed-entry-body")).toHaveTextContent(
      "#### Incident INC-8 Created:",
    );
    expect(screen.getByTestId("feed-entry-body")).not.toHaveTextContent("🚨");
  });

  test("a person without a name is shown by their email", () => {
    const user: User = nitin();
    delete (user as unknown as { name?: Name }).name;

    renderEntry({
      item: item({ user, textInMarkdown: "posted a note." }),
    });

    expect(screen.getByTestId("feed-entry-lead")).toHaveTextContent(
      "nitin@example.com posted a note.",
    );
  });

  test("an entry nobody in particular did has no name and no avatar", () => {
    renderEntry({
      item: item({
        textInMarkdown: "🔔 Owners were notified of the new note.",
      }),
    });

    expect(screen.queryByTestId("feed-entry-avatar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("feed-entry-lead")).not.toBeInTheDocument();
    expect(screen.getByTestId("feed-entry-body").textContent).toBe(
      "Owners were notified of the new note.",
    );
  });

  test("an author who is not a OneUptime user is named, with a blank avatar", () => {
    renderEntry({
      item: item({
        authorName: "Aidil (Slack)",
        textInMarkdown: "posted a note:\n\nSeen in the logs.",
      }),
    });

    expect(screen.getByTestId("feed-entry-lead")).toHaveTextContent(
      "Aidil (Slack) posted a note:",
    );
    expect(screen.getByTestId("feed-entry-avatar")).toBeInTheDocument();
  });

  test("an entry written on someone's behalf says so on an author line of its own", () => {
    renderEntry({
      item: item({
        authorName: "Aidil Rahman",
        authorDetail: "via Slack (note added by Nitin Kumar)",
        textInMarkdown: "Seen this before - it is the cache.",
      }),
    });

    const author: HTMLElement = screen.getByTestId("feed-entry-author");

    expect(author).toHaveTextContent(
      "Aidil Rahman via Slack (note added by Nitin Kumar)",
    );
    expect(screen.queryByTestId("feed-entry-lead")).not.toBeInTheDocument();
    expect(screen.getByTestId("feed-entry-body").textContent).toBe(
      "Seen this before - it is the cache.",
    );
  });

  test("a note saved by a user for someone else names who wrote it, with a blank avatar, not the user's", () => {
    const savedBy: User = new User();
    savedBy.id = new ObjectID("5b5b5b5b-5b5b-4b5b-8b5b-5b5b5b5b5b5b");
    savedBy.name = new Name("Nitin Kumar");

    renderEntry({
      item: item({
        user: savedBy,
        authorName: "Aidil Rahman",
        authorDetail: "via Slack (note added by Nitin Kumar)",
        textInMarkdown: "Seen this before - it is the cache.",
      }),
    });

    const author: HTMLElement = screen.getByTestId("feed-entry-author");

    expect(author).toHaveTextContent(
      "Aidil Rahman via Slack (note added by Nitin Kumar)",
    );
    expect(author.querySelector("strong")).toHaveTextContent("Aidil Rahman");
    // Not Nitin's picture: the blank one.
    expect(
      screen.getByTestId("feed-entry-avatar").getAttribute("src") || "",
    ).not.toContain(savedBy.id!.toString());
  });
});

describe("the time", () => {
  test("shows the time and the hint, with the full time as its tooltip", () => {
    renderEntry({ item: item() });

    const time: HTMLElement = screen.getByTestId("feed-entry-time");

    expect(time).toHaveTextContent("3:25 PM");
    expect(screen.getByTestId("feed-entry-relative-time")).toHaveTextContent(
      "12 min. ago",
    );
    expect(time.querySelector("time")).toHaveAttribute(
      "dateTime",
      "2026-10-13T07:25:00.000Z",
    );
  });

  test("names the zone when it is not the day heading's", () => {
    renderEntry({ item: item(), time: { label: "1:30 AM", zoneName: "EDT" } });

    expect(screen.getByTestId("feed-entry-time")).toHaveTextContent(
      "1:30 AMEDT",
    );
  });

  test("an entry of the same minute as the one before shows no time at all", () => {
    renderEntry({ item: item(), time: { isShown: false } });

    expect(screen.getByTestId("feed-entry-time")).toBeEmptyDOMElement();
  });
});

describe("the details", () => {
  test("unfold in place under the entry, and fold back", () => {
    renderEntry({
      item: item({
        moreTextInMarkdown: "**Cause:**\nThe pool was set to 5.",
      }),
    });

    const toggle: HTMLElement = screen.getByTestId("feed-entry-details-toggle");

    expect(toggle).toHaveTextContent("Show details");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("feed-entry-details")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(toggle);

    const details: HTMLElement = screen.getByTestId("feed-entry-details");

    expect(details).toHaveTextContent("The pool was set to 5.");
    expect(toggle).toHaveTextContent("Hide details");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle.getAttribute("aria-controls")).toBe(details.id);

    fireEvent.click(toggle);

    expect(screen.queryByTestId("feed-entry-details")).not.toBeInTheDocument();
  });

  test("the toggle can say what the details are", () => {
    renderEntry({
      item: item({
        moreTextInMarkdown: "- Nitin Kumar\n- Aidil Rahman",
        detailsLabel: "Show who was notified",
      }),
    });

    expect(
      screen.getByRole("button", { name: "Show who was notified" }),
    ).toBeVisible();
  });

  test.each<[string, string | undefined]>([
    ["none at all", undefined],
    ["an empty string", ""],
    ["a cause nobody gave", "**Cause:**\n"],
  ])(
    "there is no toggle for %s",
    (_label: string, more: string | undefined) => {
      renderEntry({
        item: item(more === undefined ? {} : { moreTextInMarkdown: more }),
      });

      expect(
        screen.queryByTestId("feed-entry-details-toggle"),
      ).not.toBeInTheDocument();
    },
  );
});

describe("the kind", () => {
  test("its icon sits in the rail, tinted with its colour", () => {
    renderEntry({ item: item({ color: Red500, icon: IconProp.Flag }) });

    expect(screen.getByTestId("feed-entry-icon")).toHaveStyle({
      backgroundColor: "#ef44441f",
    });
  });

  test("the entry says which event type it is", () => {
    renderEntry({ item: item({ eventType: "PrivateNote" }) });

    expect(screen.getByTestId("feed-entry")).toHaveAttribute(
      "data-event-type",
      "PrivateNote",
    );
  });

  test("the line runs on to the next entry, except after the day's last", () => {
    renderEntry({ item: item(), isLastInDay: false });
    expect(screen.getByTestId("feed-entry-line")).toBeInTheDocument();

    cleanup();

    renderEntry({ item: item(), isLastInDay: true });
    expect(screen.queryByTestId("feed-entry-line")).not.toBeInTheDocument();
  });
});

describe("a burst's toggle", () => {
  test("counts what is folded, in the singular and the plural", () => {
    renderEntry({
      item: item(),
      entry: {
        burstToggle: {
          burstKey: "entry",
          burstKind: FeedBurstKind.OwnerNotification,
          foldedCount: 1,
          isExpanded: false,
        },
      },
    });

    expect(screen.getByTestId("feed-burst-toggle")).toHaveTextContent(
      "Show 1 more owner notification",
    );

    cleanup();

    renderEntry({
      item: item(),
      entry: {
        burstToggle: {
          burstKey: "entry",
          burstKind: FeedBurstKind.SubscriberNotification,
          foldedCount: 4,
          isExpanded: false,
        },
      },
    });

    expect(screen.getByTestId("feed-burst-toggle")).toHaveTextContent(
      "Show 4 more subscriber notifications",
    );
  });

  test("hands its burst's key to the feed when pressed", () => {
    const onToggleBurst: ReturnType<typeof jest.fn<(key: string) => void>> =
      jest.fn<(key: string) => void>();

    renderEntry({
      item: item(),
      entry: {
        burstToggle: {
          burstKey: "burst-1",
          burstKind: FeedBurstKind.Rule,
          foldedCount: 2,
          isExpanded: false,
        },
      },
      onToggleBurst,
    });

    fireEvent.click(screen.getByTestId("feed-burst-toggle"));

    expect(onToggleBurst).toHaveBeenCalledWith("burst-1");
  });

  test("an entry that unfolded out of a burst is marked as in it", () => {
    renderEntry({ item: item(), entry: { isInBurst: true } });

    expect(screen.getByTestId("feed-entry")).toHaveAttribute(
      "data-in-burst",
      "true",
    );
  });
});
