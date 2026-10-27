import { describe, expect, test } from "@jest/globals";
import {
  FeedEntryLead,
  getFeedEntryLead,
  getFeedEntryText,
  getFeedNoteParts,
  hasFeedEntryDetails,
  leadStartsWithName,
  stripLeadingDecoration,
  tidyFeedEntryDetails,
} from "../../../UI/Components/Feed/FeedEntryText";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * How a feed entry's stored Markdown is read as a sentence - for the rows
 * written years ago as much as for new ones: the leading emoji goes (the
 * entry's icon already says what kind it is), and an entry somebody's action
 * wrote reads after their name ("Nitin posted a private note").
 *
 * The samples are the texts the services write (and wrote), so a rewrite of
 * one of them that stops reading well here shows up in this suite.
 */

const LINK: string = "https://oneuptime.com/dashboard/p/incidents/i";

describe("the decoration an entry opens with", () => {
  test.each<[string, string, string]>([
    [
      "a note",
      `📄 posted **private note** for this [Incident INC-8](${LINK}):\n\nIs this the cache?`,
      `posted **private note** for this [Incident INC-8](${LINK}):\n\nIs this the cache?`,
    ],
    [
      "a heading",
      "#### 🚨 Incident INC-8 Created:\n\n**Checkout down**",
      "#### Incident INC-8 Created:\n\n**Checkout down**",
    ],
    [
      "inside the opening bold",
      "**📞 On Call Policy Started Executing:** On Call Policy **X** started.",
      "**On Call Policy Started Executing:** On Call Policy **X** started.",
    ],
    [
      "a person with a skin tone and a joiner",
      "👨🏻‍💻 Added **Nitin** to the incident as the owner.",
      "Added **Nitin** to the incident as the owner.",
    ],
    [
      "a team of joined people",
      "👨🏻‍👩🏻‍👦🏻 Added team **Payments** to the incident.",
      "Added team **Payments** to the incident.",
    ],
    [
      "an emoji with a variation selector",
      "🏷️ Incident Label Rule **EU** ran.",
      "Incident Label Rule **EU** ran.",
    ],
    [
      "a state change",
      "🔴 Changed **Incident INC-8 State** to **Identified**",
      "Changed **Incident INC-8 State** to **Identified**",
    ],
    [
      "a status emoji inside bold",
      `**🚫 [Incident INC-8](${LINK}) On-Call Alert Skipped — nobody was notified**`,
      `**[Incident INC-8](${LINK}) On-Call Alert Skipped — nobody was notified**`,
    ],
  ])("is taken off %s", (_label: string, stored: string, shown: string) => {
    expect(stripLeadingDecoration(stored)).toBe(shown);
  });

  test("leading spaces are kept where they were", () => {
    expect(stripLeadingDecoration("  🔔 Owners were notified.")).toBe(
      "  Owners were notified.",
    );
  });

  test.each<[string, string]>([
    ["text without an emoji", "Owners were notified of the new private note."],
    ["an emoji in the middle", "The deploy went out 🚀 and broke checkout."],
    ["a number first", "3 incidents were added to this episode."],
    ["a hash list item", "- 🔥 first item"],
    ["an empty entry", ""],
  ])("%s is left as written", (_label: string, stored: string) => {
    expect(stripLeadingDecoration(stored)).toBe(stored);
  });

  test("an entry that is nothing but an emoji keeps it: it is the whole message", () => {
    expect(stripLeadingDecoration("👍")).toBe("👍");
    expect(stripLeadingDecoration("🎉 ")).toBe("🎉 ");
  });

  test("only the start is read: a megabyte-long entry is handled in time and keeps its tail", () => {
    const tail: string = "x".repeat(4 * 1024 * 1024);
    const timed: FastestRun<string> = fastestRun({
      run: (): string => {
        return stripLeadingDecoration(`📄 posted a log:\n\n${tail}`);
      },
      limitInMs: 500,
    });
    const result: string = timed.result;

    expect(timed.inMs).toBeLessThan(500);
    expect(result.startsWith("posted a log:")).toBe(true);
    expect(result.length).toBe(`posted a log:\n\n${tail}`.length);
  });
});

describe("the sentence that follows the person's name", () => {
  const lead: (markdown: string, actorName?: string) => FeedEntryLead = (
    markdown: string,
    actorName?: string,
  ): FeedEntryLead => {
    return getFeedEntryText({ markdown, actorName });
  };

  test("a note: the first line follows the name, the note stays below it", () => {
    const text: FeedEntryLead = lead(
      `📄 posted **private note** for this [Incident INC-8](${LINK}):\n\nNot sure what is happening here.`,
      "Nitin Kumar",
    );

    expect(text.lead).toBe(
      `posted **private note** for this [Incident INC-8](${LINK}):`,
    );
    expect(text.body).toBe("Not sure what is happening here.");
    expect(text.leadNamesActor).toBe(false);
  });

  test.each<[string, string, string]>([
    [
      "Changed",
      "🔴 Changed **[Incident INC-8](x) State** to **Identified**",
      "changed **[Incident INC-8](x) State** to **Identified**",
    ],
    [
      "Added",
      "👨🏻‍💻 Added **[Aidil](x)** (aidil@example.com) to the [Incident INC-8](x) as the owner.",
      "added **[Aidil](x)** (aidil@example.com) to the [Incident INC-8](x) as the owner.",
    ],
    [
      "Removed",
      "👨🏻‍👩🏻‍👦🏻 Removed team **Payments** from the [Incident INC-8](x) as the owner.",
      "removed team **Payments** from the [Incident INC-8](x) as the owner.",
    ],
    [
      "Started",
      "Started on-call policy **X**.",
      "started on-call policy **X**.",
    ],
  ])(
    "a sentence that opens with '%s' reads in lower case after the name",
    (_verb: string, stored: string, expected: string) => {
      expect(lead(stored, "Nitin Kumar").lead).toBe(expected);
    },
  );

  test("a sentence that already starts with the person's name does not get it twice", () => {
    const text: FeedEntryLead = lead(
      `🚫 **[Nitin Kumar](${LINK})** is no longer on call for [On-Call Policy X](${LINK}).`,
      "Nitin Kumar",
    );

    expect(text.leadNamesActor).toBe(true);
    expect(text.lead).toBe(
      `**[Nitin Kumar](${LINK})** is no longer on call for [On-Call Policy X](${LINK}).`,
    );
  });

  test.each<[string, string, string, string]>([
    [
      "an incident",
      "#### 🚨 Incident INC-8 Created:\n        \n**Checkout down**:\n\nDetails.",
      "created Incident INC-8",
      "**Checkout down**:\n\nDetails.",
    ],
    [
      "an alert, numbered without a prefix",
      "#### 🚨 Alert #311 Created:\n\n**Webhook 5xx**:",
      "created Alert #311",
      "**Webhook 5xx**:",
    ],
    [
      "a scheduled maintenance event",
      "#### 🕒 Scheduled Maintenance SM-58 Created:\n\n**Failover drill**",
      "created Scheduled Maintenance SM-58",
      "**Failover drill**",
    ],
    ["only the heading", "### Episode #12 Created", "created Episode #12", ""],
    [
      "a monitor, whose heading names its kind alone",
      "#### 🌎 Monitor Created: \n          \n**Checkout API**:\n\nThe checkout endpoint.",
      "created this monitor",
      "**Checkout API**:\n\nThe checkout endpoint.",
    ],
    [
      "an on-call policy",
      "#### 📞 On Call Policy Created: \n\n**Payments primary**:",
      "created this on-call policy",
      "**Payments primary**:",
    ],
  ])(
    "a record's created entry reads as its creator's sentence: %s",
    (_label: string, stored: string, expectedLead: string, body: string) => {
      const text: FeedEntryLead = lead(stored, "Nitin Kumar");

      expect(text.lead).toBe(expectedLead);
      expect(text.body).toBe(body);
      expect(text.leadNamesActor).toBe(false);
    },
  );

  test("a created heading without anybody who created it stays a heading", () => {
    const stored: string =
      "#### 🚨 Incident INC-8 Created:\n\n**Checkout down**";
    const text: FeedEntryLead = lead(stored);

    expect(text.lead).toBeUndefined();
    expect(text.body).toBe("#### Incident INC-8 Created:\n\n**Checkout down**");
  });

  test.each<[string, string]>([
    ["a heading", "#### Root cause\n\nThe pool was set to 5."],
    ["a heading that only ends in the word", "#### Recreated\n\nText"],
    [
      "a created heading too long to be a record's name",
      `#### ${"x".repeat(220)} Created:\n\nText`,
    ],
    ["a list", "- one\n- two"],
    ["a quote", "> quoted"],
    ["a table", "| a | b |\n| - | - |"],
    ["a code fence", "```\ncode\n```"],
    ["a noun phrase", "**[Incident INC-8](x) was updated.**"],
    [
      "a capitalised sentence that is not an action",
      "Episode severity changed to **SEV1**",
    ],
  ])(
    "an entry that opens with %s keeps the name on a line of its own",
    (_label: string, stored: string) => {
      const text: FeedEntryLead = lead(stored, "Nitin Kumar");

      expect(text.lead).toBeUndefined();
      expect(text.body).toBe(stripLeadingDecoration(stored));
    },
  );

  test("'Set' is a verb, 'Setup' is not", () => {
    expect(lead("Set the owner to **Nitin**.", "Aidil").lead).toBe(
      "set the owner to **Nitin**.",
    );
    expect(lead("Setup finished for **X**.", "Aidil").lead).toBeUndefined();
  });

  test("without a person, the entry is shown as written, whole", () => {
    const text: FeedEntryLead = lead(
      "Owners were notified of the new private note.",
    );

    expect(text.lead).toBeUndefined();
    expect(text.body).toBe("Owners were notified of the new private note.");
  });

  test("without a person, a sentence written to follow a name starts with a capital", () => {
    // A note an API key or a workflow posted: nobody to lead the sentence.
    expect(
      lead(
        `📄 posted **private note** for this [Incident INC-8](${LINK}):\n\nRolled back.`,
      ).body,
    ).toBe(
      `Posted **private note** for this [Incident INC-8](${LINK}):\n\nRolled back.`,
    );
    expect(lead("  started on-call policy **X**.").body).toBe(
      "  Started on-call policy **X**.",
    );
  });

  test.each<[string, string]>([
    ["a word that is not an action's verb", "iOS builds failed on the runner."],
    ["bold first", "**posted** by the API"],
    ["already a capital", "Posted by the API."],
    ["a verb that runs on into another word", "created-item was archived."],
  ])(
    "without a person, %s is left as written",
    (_label: string, stored: string) => {
      expect(lead(stored).body).toBe(stored);
    },
  );

  test("a first paragraph longer than a sentence stays where it is", () => {
    const long: string = `posted ${"a very long note ".repeat(60)}`;

    expect(lead(long, "Nitin").lead).toBeUndefined();
  });

  test("a paragraph with soft line breaks is still one lead", () => {
    const text: FeedEntryLead = lead(
      "posted **public note**\non the status page:\n\nWe are on it.",
      "Nitin",
    );

    expect(text.lead).toBe("posted **public note**\non the status page:");
    expect(text.body).toBe("We are on it.");
  });

  test("a blank line made of spaces still ends the first paragraph", () => {
    const text: FeedEntryLead = getFeedEntryLead({
      markdown: "posted a note:\n   \nHello",
      actorName: "Nitin",
    });

    expect(text.lead).toBe("posted a note:");
    expect(text.body).toBe("Hello");
  });

  test("an empty entry has nothing to lead with", () => {
    const text: FeedEntryLead = lead("", "Nitin");

    expect(text.lead).toBeUndefined();
    expect(text.body).toBe("");
  });
});

describe("whether an entry starts with a person's name", () => {
  test.each<[string, string, boolean]>([
    ["Nitin Kumar is on call", "Nitin Kumar", true],
    ["**Nitin Kumar** is on call", "Nitin Kumar", true],
    [`**[Nitin Kumar](${LINK})** is on call`, "Nitin Kumar", true],
    ["@nitin kumar acknowledged", "Nitin Kumar", true],
    ["nitin kumar is on call", "Nitin Kumar", true],
    ["Nitinder is on call", "Nitin", false],
    ["Aidil is on call", "Nitin", false],
    ["Nitin", "", false],
  ])("%p for %p: %p", (lead: string, name: string, expected: boolean) => {
    expect(leadStartsWithName(lead, name)).toBe(expected);
  });
});

describe("whether an entry has details to show", () => {
  test.each<[string, string | undefined, boolean]>([
    ["nothing", undefined, false],
    ["blank", "  \n ", false],
    ["a cause no one gave", "**Cause:**\n", false],
    ["a cause no one gave, with a space", "**Cause:** \n", false],
    ["a lone label", "Message:", false],
    ["a cause", "**Cause:**\nThe pool was set to 5.", true],
    ["who was notified", "- [Nitin](x)\n- [Aidil](y)\n", true],
    [
      "the old notified lines",
      "**Notified:** Nitin (nitin@example.com)\n",
      true,
    ],
    ["a sentence", "The run ended because the incident was resolved.", true],
  ])("%s: %p", (_label: string, details: string | undefined, has: boolean) => {
    expect(hasFeedEntryDetails(details)).toBe(has);
  });

  test("long details are details, whatever they end with", () => {
    expect(hasFeedEntryDetails(`${"x".repeat(100)}:`)).toBe(true);
  });
});

describe("a note's card", () => {
  test("the paragraph that introduces a note stays out of its card", () => {
    expect(
      getFeedNoteParts(
        "**OneUptime AI posted a root cause analysis**\n\nThe pool was cut to 10.\n\n**Most likely root cause:** a release.",
      ),
    ).toEqual({
      intro: "**OneUptime AI posted a root cause analysis**",
      note: "The pool was cut to 10.\n\n**Most likely root cause:** a release.",
    });
  });

  test.each<[string, string]>([
    ["a single paragraph", "Rolling checkout-api back to 2026.09.14-1."],
    ["nothing after the first paragraph", "Rolled back.\n\n   "],
  ])("%s is all note", (_label: string, body: string) => {
    expect(getFeedNoteParts(body)).toEqual({ note: body.trim() });
  });

  test("a first paragraph longer than a sentence is the note itself", () => {
    const long: string = `${"We looked at the pool. ".repeat(40)}\n\nThen more.`;

    expect(getFeedNoteParts(long)).toEqual({ note: long.trim() });
  });

  test("nothing is no note", () => {
    expect(getFeedNoteParts("")).toEqual({ note: "" });
  });
});

describe("details as the feed unfolds them", () => {
  test.each<[string, string | undefined, string]>([
    [
      "who an older owner notification reached, one line each",
      "**Notified:** Nitin Kumar (nitin@example.com)\n**Notified:** Aidil Rahman (aidil@example.com)\n",
      "- Nitin Kumar (nitin@example.com)\n- Aidil Rahman (aidil@example.com)\n",
    ],
    [
      "the created notifications' spelling, colon outside the bold",
      "**Notified**: Nitin Kumar (nitin@example.com)\n",
      "- Nitin Kumar (nitin@example.com)\n",
    ],
    [
      "a reminder's people, as profile links, with blank lines and CRLF",
      "**Notified:** [Nitin](https://oneuptime.com/u/1)\r\n\r\n**Notified:** [Aidil](https://oneuptime.com/u/2)\r\n",
      "- [Nitin](https://oneuptime.com/u/1)\n- [Aidil](https://oneuptime.com/u/2)\n",
    ],
    [
      "a line naming nobody is left out",
      "**Notified:** Nitin\n**Notified:** \n",
      "- Nitin\n",
    ],
  ])("%s", (_label: string, details: string | undefined, tidied: string) => {
    expect(tidyFeedEntryDetails(details)).toBe(tidied);
  });

  test.each<[string, string | undefined]>([
    ["nothing", undefined],
    ["blank", ""],
    ["the list newer entries write", "- Nitin Kumar\n- Aidil Rahman\n"],
    ["a cause", "**Cause:**\nThe pool was set to 5."],
    [
      "a Notified line among other details",
      "**Notified:** Nitin\n\n**Status:** Sent",
    ],
    ["only labels, naming nobody", "**Notified:**\n**Notified:** \n"],
    [
      "a note that only mentions the word",
      "Notified the vendor. **Notified:** Nitin",
    ],
  ])(
    "%s is shown as it was written",
    (_label: string, details: string | undefined) => {
      expect(tidyFeedEntryDetails(details)).toBe(details || "");
    },
  );

  test("a long list of the old lines stays a list, quickly", () => {
    const lines: string =
      "**Notified:** Someone (someone@example.com)\n".repeat(5000);
    const timed: FastestRun<string> = fastestRun({
      run: (): string => {
        return tidyFeedEntryDetails(lines);
      },
      limitInMs: 500,
    });
    const tidied: string = timed.result;

    expect(timed.inMs).toBeLessThan(500);
    expect(tidied.split("\n").filter(Boolean)).toHaveLength(5000);
    expect(tidied.startsWith("- Someone (someone@example.com)\n")).toBe(true);
  });
});
