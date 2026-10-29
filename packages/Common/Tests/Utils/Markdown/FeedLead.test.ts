import {
  getSentenceAfterName,
  leadWithAuthorMarkdown,
  opensWithFeedLeadVerb,
  readFeedLeadingEmoji,
} from "../../../Utils/Markdown/FeedLead";
import { getFeedEntryText } from "../../../UI/Components/Feed/FeedEntryText";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { describe, expect, test } from "@jest/globals";

/*
 * HOW A FEED ENTRY'S SENTENCE READS AFTER THE NAME OF WHOEVER DID IT, IN
 * THE DASHBOARD'S FEED AND IN SLACK AND MICROSOFT TEAMS (Utils/Markdown/
 * FeedLead).
 *
 * A channel read "Valeria Mustafaeva 👤 Added Deane Looi as Responder to
 * Incident INC-18." - the name, then the emoji, then a sentence with a
 * capital of its own: two fragments. It now reads "👤 Valeria Mustafaeva
 * added Deane Looi as Responder to Incident INC-18.", the sentence the
 * Dashboard's feed draws after the same name.
 */

const VALERIA: string = "[Valeria Mustafaeva](https://oneuptime.example/d/p/users/v) ";
const DEANE: string = "**[Deane Looi](https://oneuptime.example/d/p/users/d)**";
const INCIDENT: string = "[Incident INC-18](https://oneuptime.example/d/p/incidents/i)";

describe("a Slack or Teams message opened by whoever did what it says", () => {
  test("REGRESSION: the screenshot's line reads as one sentence - emoji, name, verb in lower case", () => {
    expect(
      leadWithAuthorMarkdown({
        authorMarkdown: VALERIA,
        markdown: `👤 Added ${DEANE} as **Responder** to ${INCIDENT}.`,
      }),
    ).toBe(`👤 ${VALERIA}added ${DEANE} as **Responder** to ${INCIDENT}.`);
  });

  test.each<[string, string, string]>([
    [
      "taken off a role",
      `👤 Removed ${DEANE} as **Responder** from ${INCIDENT}.`,
      `👤 ${VALERIA}removed ${DEANE} as **Responder** from ${INCIDENT}.`,
    ],
    [
      "took a role themselves",
      `👤 Took the **Responder** role on ${INCIDENT}.`,
      `👤 ${VALERIA}took the **Responder** role on ${INCIDENT}.`,
    ],
    [
      "left a role themselves",
      `👤 Left the **Responder** role on ${INCIDENT}.`,
      `👤 ${VALERIA}left the **Responder** role on ${INCIDENT}.`,
    ],
    [
      "a state change",
      `👀 Changed **${INCIDENT} State** to **Acknowledged**`,
      `👀 ${VALERIA}changed **${INCIDENT} State** to **Acknowledged**`,
    ],
    [
      "a note, written in lower case to follow a name",
      `📄 posted **private note** for this ${INCIDENT}:\n\nRolled back.`,
      `📄 ${VALERIA}posted **private note** for this ${INCIDENT}:\n\nRolled back.`,
    ],
    [
      "an owner, with an emoji of joined people and skin tones",
      `👨🏻‍💻 Added ${DEANE} to the ${INCIDENT} as the owner.`,
      `👨🏻‍💻 ${VALERIA}added ${DEANE} to the ${INCIDENT} as the owner.`,
    ],
    [
      "an emoji with a variation selector",
      "⚠️ Dismissed the **auto-remediation suggestion**, but **2 commands had ALREADY run.**",
      `⚠️ ${VALERIA}dismissed the **auto-remediation suggestion**, but **2 commands had ALREADY run.**`,
    ],
    [
      "an update by somebody",
      `✏️ Updated ${INCIDENT}.\n\n**Title**: \nCheckout is slow\n`,
      `✏️ ${VALERIA}updated ${INCIDENT}.\n\n**Title**: \nCheckout is slow\n`,
    ],
    [
      "a sentence with no emoji",
      `Unlinked **[Alert ALR-3](x)** from **${INCIDENT}**`,
      `${VALERIA}unlinked **[Alert ALR-3](x)** from **${INCIDENT}**`,
    ],
  ])("%s", (_label: string, markdown: string, reads: string) => {
    expect(
      leadWithAuthorMarkdown({ authorMarkdown: VALERIA, markdown: markdown }),
    ).toBe(reads);
  });

  test("every way a workspace names the author leads the same way", () => {
    for (const author of [
      "@valeria ",
      "@Valeria M. ",
      "Jira Automation (API key) ",
      VALERIA,
    ]) {
      expect(
        leadWithAuthorMarkdown({
          authorMarkdown: author,
          markdown: `👤 Added ${DEANE} as **Responder** to ${INCIDENT}.`,
        }),
      ).toBe(`👤 ${author}added ${DEANE} as **Responder** to ${INCIDENT}.`);
    }
  });

  test("an entry that is not a sentence written to follow a name keeps the name in front of it, as it is written", () => {
    for (const markdown of [
      `**${INCIDENT} was updated.**`,
      `**📘 Postmortem Note updated for ${INCIDENT}**\n\nThe pool was too small.`,
      "⚡ **AI command plan approved** — 3 command(s) are being executed.",
      "#### 🚨 Incident INC-18 Created:",
      "📞 A Zoom call was started for Incident INC-18.",
      "Setup is complete.",
      "- a list",
    ]) {
      expect(
        leadWithAuthorMarkdown({ authorMarkdown: VALERIA, markdown: markdown }),
      ).toBe(VALERIA + markdown);
    }
  });

  test("nobody to lead with: the message is posted as the entry reads", () => {
    for (const author of ["", " ", "\t"]) {
      expect(
        leadWithAuthorMarkdown({
          authorMarkdown: author,
          markdown: `👤 Added ${DEANE} as **Responder** to ${INCIDENT}.`,
        }),
      ).toBe(`👤 Added ${DEANE} as **Responder** to ${INCIDENT}.`);
    }
  });

  test("one space between the emoji, the name and the sentence, however the parts came", () => {
    expect(
      leadWithAuthorMarkdown({
        authorMarkdown: "@valeria",
        markdown: "  👤Added **Deane** as **Responder**.",
      }),
    ).toBe("👤 @valeria added **Deane** as **Responder**.");
  });

  test("only the start is read: a megabyte-long note keeps every character after its first word", () => {
    const tail: string = "x".repeat(1_000_000);
    const led: string = leadWithAuthorMarkdown({
      authorMarkdown: VALERIA,
      markdown: `📄 posted **private note**:\n\n${tail}`,
    });

    expect(led).toBe(`📄 ${VALERIA}posted **private note**:\n\n${tail}`);
  });

  test("its worst case takes time in line with the text: 400,000 emoji modifiers and joiners", () => {
    // The emoji pattern only ever sees the first 600 characters (FEED_LEAD_SCAN_LENGTH).
    const worst: string = "\u{1F3FB}‍".repeat(200_000) + "Added x";

    const led: FastestRun<string> = fastestRun({
      run: (): string => {
        return leadWithAuthorMarkdown({
          authorMarkdown: VALERIA,
          markdown: worst,
        });
      },
      limitInMs: 2000,
    });

    expect(led.inMs).toBeLessThan(2000);
    // Not a sentence within the part that is read: the name stays in front.
    expect(led.result.startsWith(VALERIA)).toBe(true);
  });
});

describe("the Dashboard's feed and the channel read the same sentence", () => {
  /*
   * The feed draws the author's name with their avatar and drops the emoji
   * (FeedEntryText); the channel keeps the emoji in front of the name. The
   * words after the name are the same, by the same rules.
   */
  test.each<[string, string]>([
    ["a role given", `👤 Added ${DEANE} as **Responder** to ${INCIDENT}.`],
    ["a role taken off", `👤 Removed ${DEANE} as **Responder** from ${INCIDENT}.`],
    ["a role taken", `👤 Took the **Responder** role on ${INCIDENT}.`],
    ["a role left", `👤 Left the **Responder** role on ${INCIDENT}.`],
    ["a state change", `✅ Changed **${INCIDENT} State** to **Resolved**`],
    ["a note", `📄 posted **private note** for this ${INCIDENT}:`],
    ["an update", `✏️ Updated ${INCIDENT}.`],
    [
      "an AI fix approved",
      "⚡ Approved the **AI command plan**: 3 commands are being run.",
    ],
    [
      "an AI fix dismissed",
      "⚡ Dismissed the **auto-remediation suggestion**: the AI-composed command plan will not be run.",
    ],
    ["a link", `🔗 Linked **[Alert ALR-3](x)** to **${INCIDENT}**: Slow`],
  ])("%s", (_label: string, markdown: string) => {
    const feed: string | undefined = getFeedEntryText({
      markdown: markdown,
      actorName: "Valeria Mustafaeva",
    }).lead;
    const emoji: string = readFeedLeadingEmoji(markdown).trimEnd();

    expect(feed).toBeDefined();
    expect(
      leadWithAuthorMarkdown({ authorMarkdown: VALERIA, markdown: markdown }),
    ).toBe(`${emoji} ${VALERIA}${feed}`);
  });
});

describe("which sentences follow a name, and how", () => {
  test("one in lower case already does, as written", () => {
    expect(getSentenceAfterName("posted **private note**")).toBe(
      "posted **private note**",
    );
  });

  test("one that opens with an action's verb reads with it in lower case", () => {
    expect(getSentenceAfterName("Added **Deane**")).toBe("added **Deane**");
    expect(getSentenceAfterName("Took the role")).toBe("took the role");
    expect(getSentenceAfterName("Left the role")).toBe("left the role");
    expect(getSentenceAfterName("Dismissed the fix")).toBe("dismissed the fix");
    expect(getSentenceAfterName("Approved the plan")).toBe("approved the plan");
    expect(getSentenceAfterName("Updated Incident INC-18.")).toBe(
      "updated Incident INC-18.",
    );
  });

  test("anything else does not: a noun phrase, a heading, a word that only starts like a verb", () => {
    for (const sentence of [
      "",
      "Incident INC-18 was updated.",
      "**Incident INC-18** added to episode",
      "Setup is complete.",
      "Added-on value",
      "#### Created",
      "AI command plan approved",
    ]) {
      expect(getSentenceAfterName(sentence)).toBeNull();
    }
  });

  test("whether a sentence opens with an action's verb, as a word of its own", () => {
    expect(opensWithFeedLeadVerb("posted a note")).toBe(true);
    expect(opensWithFeedLeadVerb("Posted a note")).toBe(true);
    expect(opensWithFeedLeadVerb("created-item")).toBe(false);
    expect(opensWithFeedLeadVerb("iOS builds failed")).toBe(false);
  });

  test("the emoji an entry opens with, with its space, or none", () => {
    expect(readFeedLeadingEmoji("👤 Added")).toBe("👤 ");
    expect(readFeedLeadingEmoji("👨🏻‍👩🏻‍👦🏻 Added team")).toBe("👨🏻‍👩🏻‍👦🏻 ");
    expect(readFeedLeadingEmoji("⚠️ Dismissed")).toBe("⚠️ ");
    expect(readFeedLeadingEmoji("Added")).toBe("");
  });
});
