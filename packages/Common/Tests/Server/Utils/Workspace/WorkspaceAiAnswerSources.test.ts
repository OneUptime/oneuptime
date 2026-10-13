import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import WorkspaceAiAnswerSources from "../../../../Server/Utils/Workspace/WorkspaceAiAnswerSources";
import SlackUtil from "../../../../Server/Utils/Workspace/Slack/Slack";
import { AIChatCitation } from "../../../../Types/AI/AIChatTypes";
import FeedMarkdown, {
  MarkdownText,
} from "../../../../Utils/Markdown/FeedMarkdown";

/*
 * THE SOURCES UNDER AN ANSWER FROM ONEUPTIME AI IN SLACK AND MICROSOFT TEAMS.
 *
 * An answer ends with what it was read from, one line a source, with how
 * many rows it gave. Both chats wrote "(1 rows)" for a source that gave
 * one. These hold the count to the language, the label to text, and both
 * chats to the one place that writes the lines.
 */

function citation(overrides: Partial<AIChatCitation>): AIChatCitation {
  return {
    id: "C1",
    toolName: "query_monitors",
    label: "Monitor statuses",
    queryArguments: {},
    rowCount: 2,
    ...overrides,
  };
}

function linesOf(citations: Array<AIChatCitation>): Array<string> {
  return WorkspaceAiAnswerSources.getLines(citations).map(
    (line: MarkdownText): string => {
      return line.toString();
    },
  );
}

describe("WorkspaceAiAnswerSources.getRowCountText", () => {
  test.each([
    [0, "0 rows"],
    [1, "1 row"],
    [2, "2 rows"],
    [11, "11 rows"],
    [21, "21 rows"],
    [1000, "1000 rows"],
  ])("%i is written %s", (rowCount: number, text: string) => {
    expect(WorkspaceAiAnswerSources.getRowCountText(rowCount)).toBe(text);
  });

  test("one row is never written as rows", () => {
    expect(WorkspaceAiAnswerSources.getRowCountText(1)).not.toContain("rows");
  });
});

describe("WorkspaceAiAnswerSources.getLines", () => {
  test("one line a source, in the order the answer cites them", () => {
    expect(
      linesOf([
        citation({ label: "Monitor statuses", rowCount: 2 }),
        citation({ id: "C2", label: "Deployments", rowCount: 1 }),
        citation({ id: "C3", label: "Open incidents", rowCount: 0 }),
      ]),
    ).toEqual([
      "• Monitor statuses (2 rows)",
      "• Deployments (1 row)",
      "• Open incidents (0 rows)",
    ]);
  });

  test("no sources, no lines", () => {
    expect(linesOf([])).toEqual([]);
  });

  test("a label is text, with its code kept as code: nothing in it acts on its own in a chat", () => {
    const lines: Array<string> = linesOf([
      citation({
        label:
          "<!here> [Logs](https://evil.example/logs) for `kubectl get pods`",
        rowCount: 1,
      }),
    ]);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("`kubectl get pods`");
    expect(lines[0]!.endsWith(" (1 row)")).toBe(true);
    // No link whose words hide where it goes, and no mention Slack notifies.
    expect(lines[0]).not.toContain("[Logs](https://evil.example/logs)");

    const inSlack: string = SlackUtil.convertMarkdownToSlackRichText(lines[0]!);

    expect(inSlack).not.toContain("<!here>");
    expect(inSlack).not.toContain("<https://evil.example/logs|Logs>");
  });

  test("the lines join into the footer both chats post", () => {
    expect(
      FeedMarkdown.join(
        WorkspaceAiAnswerSources.getLines([
          citation({ label: "Monitor statuses", rowCount: 2 }),
          citation({ id: "C2", label: "Deployments", rowCount: 1 }),
        ]),
        "\n",
      ).toString(),
    ).toBe("• Monitor statuses (2 rows)\n• Deployments (1 row)");
  });
});

describe("Slack and Microsoft Teams write an answer's sources in one place", () => {
  const COMMON_ROOT: string = path.resolve(__dirname, "../../../..");
  const CHATS: Array<string> = [
    "Server/API/SlackAPI.ts",
    "Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams.ts",
  ];

  test.each(CHATS)(
    "%s asks WorkspaceAiAnswerSources for them",
    (file: string) => {
      const source: string = fs.readFileSync(
        path.join(COMMON_ROOT, file),
        "utf8",
      );

      expect(source).toContain(
        "WorkspaceAiAnswerSources.getLines(result.citations)",
      );
      // Not counted there a second way, which is how "(1 rows)" was written.
      expect(source).not.toContain("citation.rowCount");
      expect(source.indexOf("} rows)")).toBe(-1);
    },
  );
});
