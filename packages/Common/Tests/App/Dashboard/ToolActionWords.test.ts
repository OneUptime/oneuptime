import { describe, expect, test } from "@jest/globals";
import {
  DrawnActionSentence,
  getToolActionDescription,
  getToolActionNamedArguments,
  getToolActionShownValues,
  getToolActionTitle,
  getToolActionTitleLabel,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ToolActionWords";
import {
  AI_ACTION_LINES,
  AI_ACTION_TERMS,
  AI_ACTION_TITLES,
  AIActionWords,
  aiActionList,
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
import { Translator } from "../../../Types/Translator";
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
