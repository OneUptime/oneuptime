import { describe, expect, test } from "@jest/globals";
import {
  MERGED_PAGE_TEXT,
  type MergedPageCover,
  getMergedPageLine,
  isMergedPage,
  readMergedPageCover,
} from "./mergedPage";

/*
 * A PAGE MERGED INTO ANOTHER PAGE OF YOURS (#8858): read from the server's
 * own line, and said as which page to answer. Common's
 * OnCallPageMergeMobileParity holds these readings to the server's builder,
 * line for line; these say what My Pages makes of them.
 */

describe("what a merged page's line names", () => {
  test.each<[string, MergedPageCover]>([
    [
      "Already paged about this by Payments, so not paged again.",
      { kind: "policy", name: "Payments" },
    ],
    [
      "Already paged about this by another on-call policy, so not paged again.",
      { kind: "policy", name: null },
    ],
    [
      "Already paged directly about this by Jane Doe, so not paged again.",
      { kind: "person", name: "Jane Doe" },
    ],
    [
      "Already paged about this through the workflow Nightly Checks, so not paged again.",
      { kind: "workflow", name: "Nightly Checks" },
    ],
    [
      "Already paged about this by Payments, EU. Tier 1, so not paged again.",
      { kind: "policy", name: "Payments, EU. Tier 1" },
    ],
  ])("%s", (line: string, cover: MergedPageCover) => {
    expect(readMergedPageCover(line)).toEqual(cover);
  });

  test.each([
    "",
    "Their page from Payments is over, so this policy pages them now.",
    "Their page from Payments is over, so they are paged directly now.",
    "Already paged about this by , so not paged again.",
    "Notification sent.",
  ])("any other line is no merged page's: %j", (line: string) => {
    expect(readMergedPageCover(line)).toBeNull();
  });

  test("nothing to read is nothing", () => {
    expect(readMergedPageCover(undefined)).toBeNull();
    expect(readMergedPageCover(null)).toBeNull();
  });
});

describe("what My Pages says under a merged page", () => {
  test("which page of theirs to answer, naming the policy, the person or the workflow", () => {
    expect(
      getMergedPageLine(
        "Already paged about this by Payments, so not paged again.",
      ),
    ).toBe("Answering your page from Payments answers this one too.");
    expect(
      getMergedPageLine(
        "Already paged directly about this by Jane Doe, so not paged again.",
      ),
    ).toBe("Answering your page from Jane Doe answers this one too.");
    expect(
      getMergedPageLine(
        "Already paged about this through the workflow Nightly Checks, so not paged again.",
      ),
    ).toBe(
      "Answering your page from the workflow Nightly Checks answers this one too.",
    );
  });

  test("a policy the line names none of: their other page", () => {
    expect(
      getMergedPageLine(
        "Already paged about this by another on-call policy, so not paged again.",
      ),
    ).toBe("Answering your other page about this answers this one too.");
  });

  test("a line the app cannot read is shown as the server wrote it, and none is nothing", () => {
    expect(getMergedPageLine("Paged through a new kind of page.")).toBe(
      "Paged through a new kind of page.",
    );
    expect(getMergedPageLine(undefined)).toBeNull();
    expect(getMergedPageLine("  ")).toBeNull();
  });
});

describe("which pages are merged ones", () => {
  test("Already Paged, as the server stores it, and not answered yet", () => {
    expect(MERGED_PAGE_TEXT.status).toBe("Already Paged");
    expect(
      isMergedPage({ status: "Already Paged", acknowledgedAt: null }),
    ).toBe(true);
  });

  test("answered with the page it stood on, it is an answered page", () => {
    expect(
      isMergedPage({
        status: "Already Paged",
        acknowledgedAt: "2026-11-16T03:04:00.000Z",
      }),
    ).toBe(false);
  });

  test.each(["Executing", "Completed", "Passed On", "Error", undefined])(
    "a page that is %s is not one: it took the page over, or never was",
    (status: string | undefined) => {
      expect(isMergedPage({ status: status, acknowledgedAt: null })).toBe(
        false,
      );
    },
  );
});
