import {
  GITHUB_NEW_ISSUE_MAX_URL_LENGTH,
  GITHUB_NEW_ISSUE_URL,
  getNewGitHubIssueUrl,
} from "../../../Types/ProductFeedback/NewGitHubIssue";
import { describe, expect, test } from "@jest/globals";

/*
 * The pre-filled GitHub issue a self-hosted server offers in place of
 * sending anything itself (#6822's docs, #6832's Give feedback): GitHub's
 * new-issue page with the title, words and labels filled in, which the
 * person reads before they send it.
 */

describe("a new GitHub issue, filled in", () => {
  test("the title, the body and the labels are in the address, encoded", () => {
    const url: URL = new URL(
      getNewGitHubIssueUrl({
        title: "Feedback: hard & slow",
        body: "Line one\nPage: /dashboard/:projectId/home",
        labels: ["feedback"],
      }),
    );

    expect(`${url.origin}${url.pathname}`).toBe(GITHUB_NEW_ISSUE_URL);
    expect(url.searchParams.get("title")).toBe("Feedback: hard & slow");
    expect(url.searchParams.get("body")).toBe(
      "Line one\nPage: /dashboard/:projectId/home",
    );
    expect(url.searchParams.get("labels")).toBe("feedback");
  });

  test("labels are left out when there are none", () => {
    expect(
      getNewGitHubIssueUrl({ title: "x", body: "y" }).includes("labels="),
    ).toBe(false);
  });

  test("the docs' issue keeps the address it had (#6822)", () => {
    expect(
      getNewGitHubIssueUrl({
        title: "Docs: Website Monitor",
        body: "Page: /docs/en/monitor/website-monitor\n\nWhat was missing, wrong or hard to follow?\n",
        labels: ["documentation"],
      }),
    ).toBe(
      `${GITHUB_NEW_ISSUE_URL}?labels=documentation&title=${encodeURIComponent("Docs: Website Monitor")}&body=${encodeURIComponent("Page: /docs/en/monitor/website-monitor\n\nWhat was missing, wrong or hard to follow?\n")}`,
    );
  });

  test("a body too long for GitHub is cut at a line, under the most GitHub reads", () => {
    const body: string = Array.from(
      { length: 400 },
      (_: unknown, index: number) => {
        return `Line ${index}: what got in the way of the setup.`;
      },
    ).join("\n");

    const url: string = getNewGitHubIssueUrl({
      title: "Feedback",
      body: body,
      labels: ["feedback"],
    });

    expect(url.length).toBeLessThanOrEqual(GITHUB_NEW_ISSUE_MAX_URL_LENGTH);

    const kept: string = new URL(url).searchParams.get("body") || "";

    expect(kept.length).toBeGreaterThan(0);
    expect(body.startsWith(kept)).toBe(true);
    expect(kept.endsWith("of the setup.")).toBe(true);
  });
});
