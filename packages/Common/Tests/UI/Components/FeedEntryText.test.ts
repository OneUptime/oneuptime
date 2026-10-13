import { describe, expect, test } from "@jest/globals";
import {
  FeedEntryLead,
  getFeedEntryLead,
  getFeedEntryText,
  hasFeedEntryDetails,
  leadStartsWithName,
  stripLeadingDecoration,
} from "../../../UI/Components/Feed/FeedEntryText";

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
  ])(
    "is taken off %s",
    (_label: string, stored: string, shown: string) => {
      expect(stripLeadingDecoration(stored)).toBe(shown);
    },
  );

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
    const started: number = Date.now();
    const result: string = stripLeadingDecoration(`📄 posted a log:\n\n${tail}`);

    expect(Date.now() - started).toBeLessThan(500);
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
    ["Started", "Started on-call policy **X**.", "started on-call policy **X**."],
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

  test.each<[string, string]>([
    [
      "a heading",
      "#### 🚨 Incident INC-8 Created:\n\n**Checkout down**",
    ],
    ["a list", "- one\n- two"],
    ["a quote", "> quoted"],
    ["a table", "| a | b |\n| - | - |"],
    ["a code fence", "```\ncode\n```"],
    [
      "a noun phrase",
      "**[Incident INC-8](x) was updated.**",
    ],
    ["a capitalised sentence that is not an action", "Episode severity changed to **SEV1**"],
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
    [
      "who was notified",
      "- [Nitin](x)\n- [Aidil](y)\n",
      true,
    ],
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
