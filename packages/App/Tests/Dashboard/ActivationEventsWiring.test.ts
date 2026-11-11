import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodePath from "path";

/*
 * Where the Dashboard sends its behaviour events (issue #6830). Each is a
 * hand-written call in a page, and a call in the wrong place fails silently
 * - an event sent before the request it reports succeeded, an Ask AI
 * question sent with its words, the importer's "from" taken from a
 * different parameter. ProductEvents.send itself keeps only what the
 * catalog lists (Common's ProductEvents and EventPropertyNames suites); this
 * pins each call to its place and its properties, against the source text,
 * as the sibling Dashboard wiring suites do.
 */

const DASHBOARD_SRC: string = nodePath.join(
  __dirname,
  "../../FeatureSet/Dashboard/src",
);

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function read(relativePath: string): string {
  return stripComments(
    fs.readFileSync(nodePath.join(DASHBOARD_SRC, relativePath), "utf8"),
  );
}

describe("the Dashboard's behaviour events", () => {
  test('"How it works" opened: when the button opens the explanation, with the product', () => {
    const source: string = read(
      "Components/ProductOnboarding/ProductAboutButton.tsx",
    );

    expect(source).toMatch(
      /onClick=\{\(\) => \{\s*setIsOpen\(true\);\s*ProductEvents\.send\(ProductEventName\.HowItWorksOpened, \{\s*product: props\.product,\s*\}\);/,
    );
  });

  test("a search that found nothing: the palette's own report, with the words and their length", () => {
    const source: string = read(
      "Components/CommandPalette/DashboardCommandPalette.tsx",
    );

    expect(source).toContain(
      "onSearchFoundNothing={recordSearchFoundNothing}",
    );
    expect(source).toMatch(
      /ProductEvents\.send\(ProductEventName\.SearchFoundNothing, \{\s*source: "command_palette",\s*query_length: searchedQuery\.length,\s*query: searchedQuery,\s*\}\);/,
    );
  });

  test("Ask AI: a question once the server took it - never its words - and a rating once it was saved", () => {
    const source: string = read("Components/AIChat/useAiChat.ts");

    const sendMessageResponse: number = source.indexOf(
      '"/ai-chat/send-message"',
    );
    const questionAsked: number = source.indexOf(
      "ProductEventName.AskAiQuestionAsked",
    );
    const errorCheck: number = source.indexOf(
      "if (response instanceof HTTPErrorResponse) {",
      sendMessageResponse,
    );

    expect(sendMessageResponse).toBeGreaterThan(0);
    expect(questionAsked).toBeGreaterThan(errorCheck);

    const questionCall: string = source.slice(
      questionAsked,
      source.indexOf("});", questionAsked),
    );

    expect(questionCall).toContain("is_new_conversation:");
    expect(questionCall).toContain("permission_mode:");
    expect(questionCall).not.toMatch(/content|question:|text/);

    const feedbackRequest: number = source.indexOf(
      '"/ai-chat/message-feedback"',
    );
    const answerRated: number = source.indexOf(
      "ProductEventName.AskAiAnswerRated",
    );

    expect(answerRated).toBeGreaterThan(
      source.indexOf(
        "if (response instanceof HTTPErrorResponse) {",
        feedbackRequest,
      ),
    );
    expect(source).toMatch(
      /ProductEvents\.send\(ProductEventName\.AskAiAnswerRated, \{\s*rating: feedback \? String\(feedback\) : "cleared",\s*\}\);/,
    );
  });

  test("the importer opened: from ?from= on its address, else Project Settings", () => {
    const source: string = read("Pages/Settings/ImportFromTool.tsx");

    expect(source).toContain(
      'export const IMPORTER_OPENED_FROM_QUERY_PARAM: string = "from";',
    );
    expect(source).toContain(
      'export const IMPORTER_OPENED_FROM_SETTINGS: string = "settings";',
    );
    expect(source).toMatch(
      /ProductEvents\.send\(ProductEventName\.ImporterOpened, \{\s*from:\s*Navigation\.getQueryStringByName\(IMPORTER_OPENED_FROM_QUERY_PARAM\) \|\|\s*IMPORTER_OPENED_FROM_SETTINGS,\s*\}\);/,
    );
  });

  test("the Welcome checklist: its progress is noted once its steps were checked, with every step's key", () => {
    const source: string = read("Components/Home/GettingStarted.tsx");

    const noted: number = source.indexOf("ChecklistEvents.noteProgress({");
    const emptyReturn: number = source.indexOf(
      "if (Object.keys(completion).length === 0) {",
    );

    expect(noted).toBeGreaterThan(emptyReturn);
    expect(noted).toBeLessThan(source.indexOf("setTaskCompletion(completion);"));
    expect(source).toMatch(
      /ChecklistEvents\.noteProgress\(\{\s*projectId: props\.projectId\.toString\(\),\s*current: completion,\s*stepKeys: gettingStartedTasks\.map\(/,
    );
  });

  test("no page sends a catalog event any way but through ProductEvents.send", () => {
    for (const file of [
      "Components/ProductOnboarding/ProductAboutButton.tsx",
      "Components/CommandPalette/DashboardCommandPalette.tsx",
      "Components/AIChat/useAiChat.ts",
      "Pages/Settings/ImportFromTool.tsx",
    ]) {
      const source: string = read(file);

      expect(source).not.toMatch(/UiAnalytics\.capture\(\s*ProductEventName/);
      expect(source).not.toMatch(
        /UiAnalytics\.capture\(\s*"(search|ask_ai|importer|how_it_works)\//,
      );
    }
  });
});
