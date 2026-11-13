import { describe, expect, test } from "@jest/globals";
import {
  DrawnActionSentence,
  getToolActionDescription,
  getToolActionLeavesOutLists,
  getToolActionNamedArguments,
  getToolActionShownValues,
  getToolActionTitle,
  getToolActionTitleLabel,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ToolActionWords";
import {
  AI_ACTION_CODE_CHANGE_LINES,
  AI_ACTION_CODE_FILE,
  AI_ACTION_LINES,
  AI_ACTION_PLURAL_LINES,
  AI_ACTION_PLURAL_SENTENCES,
  AI_ACTION_TERMS,
  AI_ACTION_TITLES,
  AIActionSentence,
  AIActionWords,
  aiActionList,
  aiActionPluralSentence,
  aiActionResourceByName,
  aiActionSentence,
  aiActionTerm,
  describeAIActionWords,
} from "../../../Types/AI/AIActionWords";
import {
  AIChatToolAction,
  AIChatToolActionStatus,
} from "../../../Types/AI/AIChatTypes";
import {
  FIRST_STRONG_ISOLATE,
  POP_DIRECTIONAL_ISOLATE,
} from "../../../Types/ReadingDirection";
import { PluralTemplate, Translator } from "../../../Types/Translator";
import { dashboardTranslator } from "../../Helpers/DashboardLocales";

/*
 * HOW THE CARD READS AN ACTION'S WORDS (ToolActionWords).
 *
 * React-free rules the approval card and an incident's conversation share:
 * the action's sentences in the reader's language when they are the
 * module's, else the English it stores; which way each reads; what goes
 * between two sentences of a line; and which of the action's arguments
 * the title already shows.
 */

const WORDS: AIActionWords = {
  title: aiActionSentence(AI_ACTION_TITLES.createAlert, {
    title: "High memory usage on test01",
  }),
  description: [
    aiActionSentence(AI_ACTION_LINES.severity, { severity: "High" }),
    aiActionSentence(AI_ACTION_LINES.linkedTo, {
      resources: aiActionList([
        aiActionResourceByName({ noun: "host", name: "test01" }),
      ]),
    }),
  ],
};

function action(overrides: Partial<AIChatToolAction> = {}): AIChatToolAction {
  const english: { title: string; description?: string | undefined } =
    describeAIActionWords(WORDS);

  return {
    id: "call-alert",
    toolName: "create_alert",
    title: english.title,
    ...(english.description ? { description: english.description } : {}),
    words: WORDS,
    arguments: { title: "High memory usage on test01" },
    isMutation: true,
    requiresApproval: true,
    status: AIChatToolActionStatus.Pending,
    ...overrides,
  };
}

function legacy(): AIChatToolAction {
  const saved: AIChatToolAction = action();
  delete saved.words;
  return saved;
}

const german: Translator = dashboardTranslator("de");
const persian: Translator = dashboardTranslator("fa");
const japanese: Translator = dashboardTranslator("ja");

describe("the title", () => {
  test("is the reader's, read their way", () => {
    const title: DrawnActionSentence = getToolActionTitle(action(), german);

    expect(title.text).toBe(
      german.translateTemplate("Create alert: {{title}}", {
        title: "High memory usage on test01",
      }),
    );
    expect(title.text).not.toBe("Create alert: High memory usage on test01");
    expect(title.direction).toBe("ltr");
    expect(title.separatorBefore).toBe("");
    expect(getToolActionTitle(action(), persian).direction).toBe("rtl");
  });

  test("is the stored English, read the way its letters are, for an action saved before its words", () => {
    expect(getToolActionTitle(legacy(), german)).toEqual({
      text: "Create alert: High memory usage on test01",
      direction: null,
      separatorBefore: "",
    });
  });

  test("is the stored English for words that are not the module's", () => {
    const tampered: AIChatToolAction = action({
      words: {
        title: {
          template: "Drop the database {{name}}",
          values: { name: "x" },
        },
      } as unknown as AIActionWords,
    });

    expect(getToolActionTitle(tampered, german).text).toBe(
      "Create alert: High memory usage on test01",
    );
    expect(getToolActionDescription(tampered, german)).toEqual([
      {
        text: 'Severity: High. Linked to host "test01".',
        direction: null,
        separatorBefore: "",
      },
    ]);
    expect(getToolActionShownValues(tampered)).toEqual([]);
    expect(getToolActionNamedArguments(tampered)).toEqual([]);
  });

  test("as a name has no isolate marks: a screen reader hears its words", () => {
    const label: string = getToolActionTitleLabel(action(), persian);

    expect(label).not.toContain(FIRST_STRONG_ISOLATE);
    expect(label).not.toContain(POP_DIRECTIONAL_ISOLATE);
    expect(label).toContain("High memory usage on test01");
    // While the drawn title sets the English name apart.
    expect(getToolActionTitle(action(), persian).text).toContain(
      FIRST_STRONG_ISOLATE,
    );
    expect(getToolActionTitleLabel(legacy(), persian)).toBe(
      "Create alert: High memory usage on test01",
    );
  });
});

describe("the line under it", () => {
  test("is a sentence after a sentence, a space between them", () => {
    const line: Array<DrawnActionSentence> = getToolActionDescription(
      action(),
      german,
    );

    expect(line).toHaveLength(2);
    expect(line[0]!.separatorBefore).toBe("");
    expect(line[1]!.separatorBefore).toBe(" ");
    expect(line[0]!.direction).toBe("ltr");
  });

  test("needs no space after a Japanese full stop", () => {
    const line: Array<DrawnActionSentence> = getToolActionDescription(
      action(),
      japanese,
    );

    expect(line[0]!.text.endsWith("。")).toBe(true);
    expect(line[1]!.separatorBefore).toBe("");
  });

  test("is the stored English for an action saved before its words, and nothing for one with no line", () => {
    expect(getToolActionDescription(legacy(), german)).toEqual([
      {
        text: 'Severity: High. Linked to host "test01".',
        direction: null,
        separatorBefore: "",
      },
    ]);

    const noLine: AIChatToolAction = action({
      words: { title: WORDS.title },
    });
    delete noLine.description;
    expect(getToolActionDescription(noLine, german)).toEqual([]);

    const legacyNoLine: AIChatToolAction = legacy();
    delete legacyNoLine.description;
    expect(getToolActionDescription(legacyNoLine, german)).toEqual([]);
  });
});

describe("what the title shows of the arguments", () => {
  test("the data a title shows itself, never a term", () => {
    expect(getToolActionShownValues(action())).toEqual([
      "High memory usage on test01",
    ]);
    expect(
      getToolActionShownValues(
        action({
          words: {
            title: aiActionSentence(AI_ACTION_TITLES.createAlert, {
              title: aiActionTerm(AI_ACTION_TERMS.untitled),
            }),
          },
        }),
      ),
    ).toEqual([]);
    expect(getToolActionShownValues(legacy())).toEqual([]);
  });

  test("the arguments it names by name", () => {
    expect(getToolActionNamedArguments(action())).toEqual([]);
    expect(
      getToolActionNamedArguments(
        action({
          words: {
            title: aiActionSentence(AI_ACTION_TITLES.acknowledgeIncident, {
              incident: "INC-42",
            }),
            namedArguments: ["incidentId"],
          },
        }),
      ),
    ).toEqual(["incidentId"]);
    expect(getToolActionNamedArguments(legacy())).toEqual([]);
  });
});

describe("whether the line under the title names what the action's lists stand for (issue #6331)", () => {
  // A code change's line: which of its files it would write over unseen.
  const codeLine: (plural: PluralTemplate) => AIActionSentence = (
    plural: PluralTemplate,
  ): AIActionSentence => {
    return aiActionPluralSentence(plural, 1, {
      branch: "main",
      readBranch: "release",
      files: aiActionList([
        aiActionSentence(AI_ACTION_CODE_FILE, { file: "src/a.ts" }),
      ]),
    });
  };

  const pullRequest: (
    description: Array<AIActionSentence>,
  ) => AIChatToolAction = (
    description: Array<AIActionSentence>,
  ): AIChatToolAction => {
    return action({
      toolName: "open_code_pull_request",
      words: {
        title: aiActionSentence(AI_ACTION_TITLES.openPullRequest, {
          title: "Fix charge",
        }),
        description,
      },
    });
  };

  test("the resources a new alert links: its lists are left out, as they always were", () => {
    expect(getToolActionLeavesOutLists(action())).toBe(true);
  });

  /*
   * The plural lines that are a code change's cautions: moreFiles counts a
   * list and is none, and a setup plan's lines (#6829: how often a monitor
   * is checked, from how many locations) belong to other actions.
   */
  const codeChangePluralLines: Array<[string, PluralTemplate]> = Object.entries(
    AI_ACTION_PLURAL_LINES,
  ).filter(([, plural]: [string, PluralTemplate]): boolean => {
    return AI_ACTION_CODE_CHANGE_LINES.includes(plural.other);
  });

  test.each(codeChangePluralLines)(
    "a code change's line %s never stands for its files: Files: N stays",
    (_name: string, plural: PluralTemplate) => {
      expect(getToolActionLeavesOutLists(pullRequest([codeLine(plural)]))).toBe(
        false,
      );
    },
  );

  test("every code change caution is checked above, and a setup plan's line stands for what it says, as any other action's does", () => {
    expect(codeChangePluralLines).toHaveLength(
      AI_ACTION_CODE_CHANGE_LINES.length,
    );
    expect(
      getToolActionLeavesOutLists(
        action({
          toolName: "set_up_website_monitoring",
          words: {
            title: aiActionSentence(AI_ACTION_TITLES.setUpWebsiteMonitoring, {
              address: "example.com",
            }),
            description: [
              aiActionPluralSentence(
                AI_ACTION_PLURAL_LINES.checkedFromLocations,
                2,
              ),
            ],
          },
        }),
      ),
    ).toBe(true);
  });

  test("every code change line is one of them, and none of them is any other line", () => {
    expect(AI_ACTION_CODE_CHANGE_LINES).toHaveLength(9);
    for (const template of AI_ACTION_CODE_CHANGE_LINES) {
      expect(
        AI_ACTION_PLURAL_SENTENCES.some((plural: PluralTemplate): boolean => {
          return plural.other === template;
        }),
      ).toBe(true);
    }
    expect(AI_ACTION_CODE_CHANGE_LINES).not.toContain(
      AI_ACTION_PLURAL_LINES.moreFiles.other,
    );
    expect(AI_ACTION_CODE_CHANGE_LINES).not.toContain(AI_ACTION_LINES.linkedTo);
  });

  test("several code change lines together still say nothing of how many files: Files: N stays", () => {
    expect(
      getToolActionLeavesOutLists(
        pullRequest([
          codeLine(AI_ACTION_PLURAL_LINES.codeFilesChangedSinceRead),
          codeLine(AI_ACTION_PLURAL_LINES.codeFilesNotChecked),
        ]),
      ),
    ).toBe(false);
  });

  test("a line that names its lists beside a code change line: they are left out", () => {
    expect(
      getToolActionLeavesOutLists(
        pullRequest([
          codeLine(AI_ACTION_PLURAL_LINES.codeFilesNotRead),
          aiActionSentence(AI_ACTION_LINES.workflowSteps, {
            steps: aiActionList([]),
          }),
        ]),
      ),
    ).toBe(true);
  });

  test("no line: nothing to leave out for", () => {
    expect(getToolActionLeavesOutLists(pullRequest([]))).toBe(false);
    expect(
      getToolActionLeavesOutLists(action({ words: { title: WORDS.title } })),
    ).toBe(false);
  });

  test("an action saved before its words leaves its lists out whenever it has a line, as it always did", () => {
    expect(getToolActionLeavesOutLists(legacy())).toBe(true);

    const noLine: AIChatToolAction = legacy();
    delete noLine.description;

    expect(getToolActionLeavesOutLists(noLine)).toBe(false);
  });
});
