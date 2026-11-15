import {
  actionItemAddedMarkdown,
  actionItemCodeTaskMarkdown,
  actionItemDeletedMarkdown,
  actionItemDoneByPullRequestMarkdown,
  actionItemDoneMarkdown,
  actionItemMonitorMarkdown,
  actionItemOwnerMarkdown,
  actionItemReopenedMarkdown,
  actionItemsTrackedMarkdown,
  actionItemWontDoMarkdown,
  MAX_TITLES_IN_TRACKED_LINE,
} from "../../../Utils/Incident/PostmortemActionItemMarkdown";
import { ActionItemCodeTaskKind } from "../../../Utils/Incident/PostmortemActionItemCodeTask";
import { describe, expect, test } from "@jest/globals";

/*
 * What an incident's feed says about its postmortem's action items (#6801).
 * Each sentence follows the name of whoever made the change, and every title
 * and name in it is text: an action item called "[click](https://evil)"
 * never becomes a link in the feed, in Slack or in Teams.
 */

describe("each change, in a sentence", () => {
  test("an item added, with its owner when it has one", () => {
    expect(
      actionItemAddedMarkdown({ title: "Alert on pool usage" }).toString(),
    ).toBe("📝 Added the action item **Alert on pool usage**.");
    expect(
      actionItemAddedMarkdown({
        title: "Alert on pool usage",
        ownerName: "Ana Silva",
      }).toString(),
    ).toBe(
      "📝 Added the action item **Alert on pool usage**, owned by **Ana Silva**.",
    );
  });

  test("done, won't do, reopened, deleted", () => {
    expect(actionItemDoneMarkdown({ title: "A" }).toString()).toBe(
      "✅ Marked the action item **A** done.",
    );
    expect(actionItemWontDoMarkdown({ title: "A" }).toString()).toBe(
      "🚫 Decided not to do the action item **A**.",
    );
    expect(actionItemReopenedMarkdown({ title: "A" }).toString()).toBe(
      "↩️ Reopened the action item **A**.",
    );
    expect(actionItemDeletedMarkdown({ title: "A" }).toString()).toBe(
      "🗑️ Deleted the action item **A**.",
    );
  });

  test("given to someone, or nobody", () => {
    expect(
      actionItemOwnerMarkdown({ title: "A", ownerName: "Kim" }).toString(),
    ).toBe("👤 Gave the action item **A** to **Kim**.");
    expect(actionItemOwnerMarkdown({ title: "A" }).toString()).toBe(
      "👤 Took the owner off the action item **A**.",
    );
  });

  test("a monitor made for it", () => {
    expect(
      actionItemMonitorMarkdown({
        title: "Alert on pool usage",
        monitorName: "Pool usage",
      }).toString(),
    ).toBe(
      "📈 Created the monitor **Pool usage** for the action item **Alert on pool usage**.",
    );
  });

  test("OneUptime AI asked for a pull request, or a test", () => {
    expect(
      actionItemCodeTaskMarkdown({
        title: "A",
        kind: ActionItemCodeTaskKind.PullRequest,
        repositoryName: "web",
      }).toString(),
    ).toBe(
      "🤖 Asked OneUptime AI to open a pull request for the action item **A**, in **web**.",
    );
    expect(
      actionItemCodeTaskMarkdown({
        title: "A",
        kind: ActionItemCodeTaskKind.Test,
        repositoryName: "web",
      }).toString(),
    ).toBe(
      "🧪 Asked OneUptime AI to write a test for the action item **A**, in **web**.",
    );
  });

  test("done because its pull request merged, with its number when known", () => {
    expect(
      actionItemDoneByPullRequestMarkdown({
        title: "A",
        pullRequestNumber: 12,
      }).toString(),
    ).toBe("✅ The action item **A** is done: its pull request #12 merged.");
    expect(actionItemDoneByPullRequestMarkdown({ title: "A" }).toString()).toBe(
      "✅ The action item **A** is done: its pull request merged.",
    );
  });
});

describe("tracking the note's items", () => {
  test("one item is named", () => {
    expect(actionItemsTrackedMarkdown({ titles: ["A"] }).toString()).toBe(
      "📝 Tracked the action item **A** from the postmortem.",
    );
  });

  test("a few are named, counted", () => {
    expect(
      actionItemsTrackedMarkdown({ titles: ["A", "B", "C"] }).toString(),
    ).toBe(
      "📝 Tracked 3 action items from the postmortem: **A**; **B**; **C**.",
    );
  });

  test("past a few, the rest are counted", () => {
    const titles: Array<string> = ["A", "B", "C", "D", "E"];

    expect(MAX_TITLES_IN_TRACKED_LINE).toBe(3);
    expect(actionItemsTrackedMarkdown({ titles }).toString()).toBe(
      "📝 Tracked 5 action items from the postmortem: **A**; **B**; **C** and 2 more.",
    );
  });
});

describe("what people typed stays text", () => {
  test("a title that looks like a link, an image or HTML is not one", () => {
    const markdown: string = actionItemAddedMarkdown({
      title:
        "[click](https://evil.example) ![x](https://evil.example/x.png) <b>bold</b>",
      ownerName: "@channel",
    }).toString();

    // The brackets that would open a link or an image, and the tag, are escaped.
    expect(markdown).toContain("\\[click\\](https://evil.example)");
    expect(markdown).toContain("!\\[x\\](https://evil.example/x.png)");
    expect(markdown).toContain("\\<b>bold\\</b>");
    expect(markdown).not.toMatch(/(^|[^\\])\[click\]\(/);
  });

  test("a title with emphasis marks cannot close the bold around it", () => {
    const markdown: string = actionItemDoneMarkdown({
      title: "**not bold** end",
    }).toString();

    expect(markdown).not.toContain("****");
    expect(markdown.startsWith("✅ Marked the action item **")).toBe(true);
  });
});
