import { describe, expect, test } from "@jest/globals";
import OwnerNotificationFeedText, {
  OwnerNotificationRecordNoun,
} from "../../../../Server/Utils/Notification/OwnerNotificationFeedText";
import FeedMarkdown from "../../../../Utils/Markdown/FeedMarkdown";

/*
 * The feed entry that says a record's owners were told something: one
 * sentence about "this" record - the feed is the record's own - with who was
 * notified as a list behind the entry's details.
 */

const NOUNS: Array<OwnerNotificationRecordNoun> = [
  "incident",
  "alert",
  "incident episode",
  "alert episode",
  "scheduled maintenance event",
];

describe("what owners were told", () => {
  test.each(NOUNS)(
    "that this %s was created",
    (noun: OwnerNotificationRecordNoun) => {
      expect(OwnerNotificationFeedText.created(noun)).toBe(
        `Owners were notified that this ${noun} was created.`,
      );
    },
  );

  test.each(NOUNS)(
    "that this %s is now in a new state",
    (noun: OwnerNotificationRecordNoun) => {
      expect(
        OwnerNotificationFeedText.stateChanged({
          recordNoun: noun,
          stateName: "Acknowledged",
        }),
      ).toBe(`Owners were notified that this ${noun} is now **Acknowledged**.`);
    },
  );

  test("a state without a name still makes a sentence", () => {
    expect(
      OwnerNotificationFeedText.stateChanged({
        recordNoun: "incident",
        stateName: " ",
      }),
    ).toBe("Owners were notified that this incident changed state.");
  });

  test.each<[boolean, string]>([
    [true, "Owners were notified of the new private note."],
    [false, "Owners were notified of the new public note."],
  ])("a note (private: %p)", (isPrivateNote: boolean, expected: string) => {
    expect(OwnerNotificationFeedText.notePosted({ isPrivateNote })).toBe(
      expected,
    );
  });

  test("how long a record has been open", () => {
    expect(
      OwnerNotificationFeedText.reminder({
        recordNoun: "incident",
        stateName: "Investigating",
        openDuration: "2 hours",
      }),
    ).toBe(
      "Owners were reminded that this incident is still **Investigating**, open for **2 hours**.",
    );
    expect(
      OwnerNotificationFeedText.reminder({
        recordNoun: "alert",
        stateName: undefined,
        openDuration: undefined,
      }),
    ).toBe("Owners were reminded that this alert is still open.");
  });

  test.each<["incident" | "alert", number, string]>([
    ["incident", 1, "Owners were notified that 1 incident was added to this episode."],
    ["incident", 3, "Owners were notified that 3 incidents were added to this episode."],
    ["alert", 1, "Owners were notified that 1 alert was added to this episode."],
    ["alert", 12, "Owners were notified that 12 alerts were added to this episode."],
  ])(
    "members added to an episode: %s x%p",
    (memberNoun: "incident" | "alert", count: number, expected: string) => {
      expect(
        OwnerNotificationFeedText.membersAdded({ memberNoun, count }),
      ).toBe(expected);
    },
  );

  test("a state name is text, not Markdown", () => {
    const sentence: string = OwnerNotificationFeedText.stateChanged({
      recordNoun: "incident",
      stateName: "[Resolved](https://evil.example)",
    });

    expect(sentence).not.toContain("[Resolved](https://evil.example)");
    expect(sentence).toContain("\\[Resolved\\]");
  });
});

describe("who was notified", () => {
  test("is a list, one person per line - not lines run into one paragraph", () => {
    const details: string =
      OwnerNotificationFeedText.notifiedLine(
        OwnerNotificationFeedText.nameAndEmail({
          name: "Nitin Kumar",
          email: "nitin@example.com",
        }),
      ) +
      OwnerNotificationFeedText.notifiedLine(
        FeedMarkdown.link("Aidil Rahman", "https://oneuptime.com/u/a"),
      );

    expect(details).toBe(
      "- Nitin Kumar (nitin@example.com)\n- [Aidil Rahman](https://oneuptime.com/u/a)\n",
    );
  });

  test("a person without a name is their address, and without either 'Unknown user'", () => {
    expect(
      OwnerNotificationFeedText.nameAndEmail({
        name: undefined,
        email: "ops@example.com",
      }).toString(),
    ).toBe("ops@example.com");
    expect(
      OwnerNotificationFeedText.nameAndEmail({
        name: "",
        email: "",
      }).toString(),
    ).toBe("Unknown user");
  });

  test("a name cannot start a list or a heading of its own", () => {
    const line: string = OwnerNotificationFeedText.notifiedLine(
      OwnerNotificationFeedText.nameAndEmail({
        name: "# Heading\n- injected",
        email: "x@example.com",
      }),
    );

    expect(line.split("\n").filter(Boolean)).toHaveLength(1);
    expect(line.startsWith("- ")).toBe(true);
  });
});
