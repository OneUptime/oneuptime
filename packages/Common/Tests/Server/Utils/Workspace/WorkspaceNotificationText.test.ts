import { describe, expect, test } from "@jest/globals";
import WorkspaceNotificationText from "../../../../Server/Utils/Workspace/WorkspaceNotificationText";
import WorkspaceMessageTime from "../../../../Server/Utils/Workspace/WorkspaceMessageTime";
import { mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";

/*
 * WHAT A PHONE SHOWS FOR A MESSAGE OneUptime POSTS (WorkspaceNotificationText).
 *
 * Slack's top-level `text` and the Teams card's `summary` are all a
 * notification shows. The record's own posts - created, state changed, a
 * note, an owner added - sent neither, so a new incident buzzed phones with
 * "This content can't be displayed" (Slack) or "sent a card" (Teams), and an
 * on-call page sent as a direct message buzzed with nothing to read at all.
 * These pin the line each post's notification says now: the start of what
 * it shows, as text.
 */

describe("the line a post's notification says", () => {
  test("an incident created: its heading, and the title it introduces", () => {
    const markdown: string = mdText`#### 🚨 Incident INC-8 Created:

**${"Checkout is down"}**:

${"No description provided."}

🔴 **Incident State**: Identified

⚠️ **Severity**: Major Incident
`.toString();

    expect(WorkspaceNotificationText.fromMarkdown(markdown)).toBe(
      "🚨 Incident INC-8 Created: Checkout is down",
    );
  });

  test("a note: who posted it, on what, and its first words", () => {
    expect(
      WorkspaceNotificationText.fromMarkdown(
        "@nitin 📄 posted **private note** for this [Incident INC-8](https://oneuptime.test/dashboard/p/incidents/1):\n\nRolled back the deploy.\n\nWatching the error rate.",
      ),
    ).toBe(
      "@nitin 📄 posted private note for this Incident INC-8: Rolled back the deploy.",
    );
  });

  test("a state change: one line, links by their words, no Markdown", () => {
    expect(
      WorkspaceNotificationText.fromMarkdown(
        "Simon Lee 🟢 Changed **[Incident INC-8](https://oneuptime.test/i/8) State** to **Resolved**",
      ),
    ).toBe("Simon Lee 🟢 Changed Incident INC-8 State to Resolved");
  });

  test("a heading that introduces nothing is said alone", () => {
    expect(WorkspaceNotificationText.fromMarkdown("#### Created:")).toBe(
      "Created",
    );
  });

  test("a first sentence that is whole is said alone", () => {
    expect(
      WorkspaceNotificationText.fromMarkdown(
        "Owners have changed.\n\nAna Ruiz was added.",
      ),
    ).toBe("Owners have changed.");
  });

  test("text OneUptime escaped reads as typed: brackets, parentheses, stars, ampersands", () => {
    const markdown: string = mdText`📄 ${"Site 03 - payments (EU) *urgent* [p1] & <b>"}`.toString();

    expect(WorkspaceNotificationText.fromMarkdown(markdown)).toBe(
      "📄 Site 03 - payments (EU) *urgent* [p1] & <b>",
    );
  });

  test("code reads as its text, and an image as its words", () => {
    expect(
      WorkspaceNotificationText.fromMarkdown(
        "Ran `kubectl rollout undo` ![a graph](https://x.test/p.png) now",
      ),
    ).toBe("Ran kubectl rollout undo a graph now");
  });

  test("a list: its first item, and the next when the first introduces it", () => {
    expect(
      WorkspaceNotificationText.fromMarkdown("- Checkout is down:\n- EU only"),
    ).toBe("Checkout is down: EU only");
  });

  test("a moment reads as its time in UTC, as a log does", () => {
    const at: Date = new Date("2026-10-08T17:28:00.000Z");

    expect(
      WorkspaceNotificationText.fromMarkdown(
        `Paging stops at ${WorkspaceMessageTime.time(at).toString()}`,
      ),
    ).toBe("Paging stops at 17:28 UTC");
  });

  test("a long line is cut at a word, with an ellipsis", () => {
    const text: string = WorkspaceNotificationText.fromMarkdown(
      `Checkout ${"is very slow ".repeat(40)}`,
    );

    expect(text.length).toBeLessThanOrEqual(
      WorkspaceNotificationText.MAX_LENGTH,
    );
    expect(text.endsWith("slow…") || text.endsWith("very…") || text.endsWith("is…")).toBe(
      true,
    );
  });

  test("a cut never splits an emoji", () => {
    const text: string = WorkspaceNotificationText.fromMarkdown(
      "🔥".repeat(300),
    );

    expect(text.length).toBeLessThanOrEqual(
      WorkspaceNotificationText.MAX_LENGTH,
    );
    // The last character before the ellipsis is a whole emoji.
    expect(text.substring(text.length - 3)).toBe("🔥…");
  });

  test.each([
    ["nothing", ""],
    ["only a rule", "---"],
    ["only code", "```\nconst x = 1;\n```"],
    ["only white space", "   \n\n  "],
  ])("%s says nothing", (_name: string, markdown: string) => {
    expect(WorkspaceNotificationText.fromMarkdown(markdown)).toBe("");
  });

  test("a headline for what follows: both, joined", () => {
    expect(
      WorkspaceNotificationText.fromMarkdown(
        "🚨 **New incident assigned to you**\n\n📋 **INC-8 — Checkout is down**\n\n👤 You're getting this because you're on call.",
        { isFirstParagraphAHeadline: true },
      ),
    ).toBe("🚨 New incident assigned to you: 📋 INC-8 — Checkout is down");
  });
});

describe("the line of a message's blocks", () => {
  test("the first Markdown block says it", () => {
    expect(
      WorkspaceNotificationText.fromBlocks([
        { _type: "WorkspacePayloadDivider" },
        { _type: "WorkspacePayloadMarkdown", text: "**Disk full** on web-1" } as never,
        { _type: "WorkspacePayloadMarkdown", text: "Second" } as never,
      ]),
    ).toBe("Disk full on web-1");
  });

  test("a header comes before the Markdown after it", () => {
    expect(
      WorkspaceNotificationText.fromBlocks([
        { _type: "WorkspacePayloadHeader", text: "Weekly summary" } as never,
        { _type: "WorkspacePayloadMarkdown", text: "12 incidents" } as never,
      ]),
    ).toBe("Weekly summary");
  });

  test("blocks with nothing to say: no line", () => {
    expect(
      WorkspaceNotificationText.fromBlocks([
        { _type: "WorkspacePayloadDivider" },
        { _type: "WorkspacePayloadButtons", buttons: [] } as never,
      ]),
    ).toBeUndefined();
    expect(WorkspaceNotificationText.fromBlocks(undefined)).toBeUndefined();
    expect(WorkspaceNotificationText.fromBlocks([])).toBeUndefined();
  });
});

describe("a long message costs no more than its start", () => {
  test.each([
    ["one paragraph of 400,000 characters", "word ".repeat(80000)],
    ["400,000 characters of stars", "*".repeat(400000)],
    ["400,000 characters of link openings", "[a](".repeat(100000)],
    ["400,000 characters of ampersands", "&".repeat(400000)],
  ])("%s", (_name: string, markdown: string) => {
    const read: FastestRun<string> = fastestRun({
      run: (): string => {
        return WorkspaceNotificationText.fromMarkdown(markdown);
      },
      limitInMs: 2000,
    });

    expect(read.inMs).toBeLessThan(2000);
    expect(read.result.length).toBeLessThanOrEqual(
      WorkspaceNotificationText.MAX_LENGTH,
    );
  });
});
