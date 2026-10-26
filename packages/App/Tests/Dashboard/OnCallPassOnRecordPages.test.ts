import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * "ESCALATE" ON EVERY RECORD AN ON-CALL POLICY PAGES ABOUT.
 *
 * An on-call policy pages people about four kinds of record: incidents,
 * alerts, incident episodes and alert episodes. The person being paged can
 * escalate the page from the record's own page: usePassOnPage (the hook
 * keeps the action's first name, "pass on") gives the header an "Escalate"
 * button (for them only) and the dialog it opens - "Escalate Incident?".
 * This holds the wiring on each of the four pages:
 *
 *   - the hook is asked about the page's own kind of record;
 *   - its button is the first of the header's other actions, right after
 *     the state buttons (Acknowledge, Resolve) it is the alternative to;
 *   - its dialog is drawn;
 *   - a state change from the header reads the page again, since
 *     acknowledging the record ends the reader's page;
 *   - and no other page draws it: nothing else is paged about.
 *
 * How the button and the dialog behave is in Common's
 * Tests/App/Dashboard/OnCallPassOnPage.test.tsx. Source is read as text:
 * App's tests never import a React module.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const RECORD_PAGES: Array<{ file: string; recordType: string }> = [
  { file: "Pages/Incidents/View/Index.tsx", recordType: "Incident" },
  { file: "Pages/Alerts/View/Index.tsx", recordType: "Alert" },
  {
    file: "Pages/Incidents/EpisodeView/Index.tsx",
    recordType: "IncidentEpisode",
  },
  { file: "Pages/Alerts/EpisodeView/Index.tsx", recordType: "AlertEpisode" },
];

const HOOK_FILE: string = "Components/OnCallPolicy/PassOn/usePassOnPage.tsx";

function read(file: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, file), "utf8");
}

// Every .ts/.tsx file under the Dashboard's src, relative to it.
function sourceFiles(directory: string = DASHBOARD_SRC): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...sourceFiles(full));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(path.relative(DASHBOARD_SRC, full).split(path.sep).join("/"));
    }
  }

  return files;
}

// The text from `start` up to the first `end` after it.
function between(source: string, start: string, end: string): string {
  const from: number = source.indexOf(start);

  expect(from).toBeGreaterThanOrEqual(0);

  const to: number = source.indexOf(end, from + start.length);

  expect(to).toBeGreaterThan(from);

  return source.slice(from, to);
}

describe.each(RECORD_PAGES)(
  "$file",
  (page: { file: string; recordType: string }) => {
    const source: string = read(page.file);

    test("asks whether the reader is paged about this kind of record", () => {
      const call: string = between(source, "usePassOnPage({", "});");

      expect(call).toContain(
        `recordType: OnCallPageRecordType.${page.recordType},`,
      );
      expect(call).toContain("recordId: modelId,");
      // A page escalated is news on the record's feed.
      expect(call).toContain("onPassedOn:");
    });

    test("puts Escalate first among the header's other actions", () => {
      const actions: string = between(source, "secondaryActions={[", "]}");
      const first: string = actions
        .slice("secondaryActions={[".length)
        .trim()
        .split("\n")[0]!
        .trim();

      expect(first).toBe("...passOn.actions,");
    });

    test("draws the dialog", () => {
      expect(source).toContain("{passOn.dialog}");
    });

    test("reads the page again after a state change from the header", () => {
      const onActionComplete: string = between(
        source,
        "onActionComplete={",
        "}}",
      );

      expect(onActionComplete).toContain("passOn.refresh();");
    });

    /*
     * Somebody acknowledged the record while the reader's dialog asked
     * ("Already acknowledged"): the header still offered Acknowledge for it
     * (#4914). The page bumps the header's refreshToken, so it reads the
     * record's state again.
     */
    test("reads the header again when somebody took the record while the dialog asked", () => {
      const call: string = between(source, "usePassOnPage({", "\n  });");
      const onRecordChanged: string = between(
        call,
        "onRecordChanged: () => {",
        "\n    },",
      );

      expect(onRecordChanged).toContain("setHeaderRefreshToken(");
      expect(source).toContain("refreshToken={headerRefreshToken}");
    });
  },
);

describe("nowhere else", () => {
  test("only the four record pages draw Escalate", () => {
    const users: Array<string> = sourceFiles()
      .filter((file: string): boolean => {
        return file !== HOOK_FILE && read(file).includes("usePassOnPage");
      })
      .sort();

    expect(users).toEqual(
      RECORD_PAGES.map((page: { file: string }): string => {
        return page.file;
      }).sort(),
    );
  });
});

describe("the button and the dialog are worded in one place", () => {
  const hook: string = read(HOOK_FILE);
  const words: string = read("Components/OnCallPolicy/PassOn/PassOnPage.ts");

  test("the hook draws the button and the question from the record's own words", () => {
    expect(hook).toContain("label: PASS_ON_PAGE_TEXT.button,");
    expect(hook).toContain("title={getPassOnQuestionTitle(data.recordType)}");
    expect(hook).toContain("submitButtonText={PASS_ON_PAGE_TEXT.button}");
    expect(hook).toContain(
      "getPassOnQuestionLines(pages, translator, data.recordType)",
    );
    expect(hook).toContain(
      "getPassOnAnswerLines(answers, translator, data.recordType)",
    );
    expect(hook).toContain("getPassOnAnswerTitle(answers, data.recordType)");
  });

  test("the words are the maintainer's: Escalate, and the question by the record's kind", () => {
    for (const word of [
      'button: translationKey("Escalate"),',
      'question: translationKey("Escalate Incident?"),',
      'question: translationKey("Escalate Alert?"),',
      'question: translationKey("Escalate Episode?"),',
      '"You will not be paged again for this incident.",',
      '"This will immediately page {{level}}, without waiting.",',
    ]) {
      expect({ word, found: words.includes(word) }).toEqual({
        word,
        found: true,
      });
    }
  });

  test("nothing a reader sees says the old Pass it on", () => {
    for (const source of [hook, words]) {
      expect(source).not.toContain('translationKey("Pass it on")');
      expect(source).not.toContain('"Pass it on?"');
      expect(source).not.toContain('"You passed it on"');
    }
  });
});
