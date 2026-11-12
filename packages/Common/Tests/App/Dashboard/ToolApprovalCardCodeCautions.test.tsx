import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";
import ToolApprovalCard from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ToolApprovalCard";
import {
  DrawnActionSentence,
  getToolActionDescription,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ToolActionWords";
import {
  AI_ACTION_CODE_CHANGE_LINES,
  AI_ACTION_CODE_FILE,
  AI_ACTION_LINES,
  AI_ACTION_PLURAL_LINES,
  AI_ACTION_PLURAL_TITLES,
  AI_ACTION_TITLES,
  AIActionList,
  AIActionSentence,
  AIActionWords,
  aiActionList,
  aiActionPluralSentence,
  aiActionResourceByName,
  aiActionSentence,
  describeAIActionSentence,
  describeAIActionWords,
} from "../../../Types/AI/AIActionWords";
import {
  AIChatToolAction,
  AIChatToolActionStatus,
} from "../../../Types/AI/AIChatTypes";
import { PluralTemplate, createTranslator } from "../../../Types/Translator";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * A CODE CHANGE'S CAUTIONS, A LINE EACH (issue #6570's UI review).
 *
 * Ask AI writes each file of a commit or a pull request whole, so before
 * anyone approves one its card says which files it would write over unseen:
 * changed on the branch since Ask AI read them, read in an earlier answer,
 * read earlier in this answer and left out of the conversation since
 * (#6570), read in part, and the rest (AI_ACTION_CODE_CHANGE_LINES). The
 * card ran them together as one paragraph, so "read in an earlier answer"
 * and "read earlier in this answer" - two sentences that begin alike - read
 * as one, and the files at their ends were lost in the middle of a block of
 * text. Each is now a caution of its own: a line of its own in a list,
 * marked as a caution, in the order the card weighs them, in every language.
 * Every other action's line - an alert's severity and what it links - still
 * runs as one paragraph, and so does the English of an action saved before
 * its words.
 */

const DE: Record<string, string> = readDashboardLocale("de");
const AR: Record<string, string> = readDashboardLocale("ar");
const JA: Record<string, string> = readDashboardLocale("ja");

const BRANCH: string = "fix/login";

// A list of files, as a code change's line names them.
function filesOf(paths: Array<string>): AIActionList {
  return aiActionList(
    paths.map((file: string): AIActionSentence => {
      return aiActionSentence(AI_ACTION_CODE_FILE, { file });
    }),
  );
}

// A code change's line for `paths`, as the server stores it.
function codeLine(
  plural: PluralTemplate,
  paths: Array<string>,
): AIActionSentence {
  return aiActionPluralSentence(plural, paths.length, {
    branch: BRANCH,
    readBranch: "main",
    files: filesOf(paths),
  });
}

// The three cautions of the issue's case, in the order the card weighs them.
const CAUTIONS: Array<AIActionSentence> = [
  codeLine(AI_ACTION_PLURAL_LINES.codeFilesChangedSinceRead, [
    "src/billing/refund.ts",
  ]),
  codeLine(AI_ACTION_PLURAL_LINES.codeFilesReadInEarlierAnswer, ["README.md"]),
  codeLine(AI_ACTION_PLURAL_LINES.codeFilesReadEarlierInThisAnswer, [
    "src/billing/charge.ts",
  ]),
];

const COMMIT_WORDS: AIActionWords = {
  title: aiActionPluralSentence(AI_ACTION_PLURAL_TITLES.commitFiles, 3, {
    branch: BRANCH,
  }),
  description: CAUTIONS,
};

const ENGLISH_CAUTIONS: Array<string> = [
  "This file changed on fix/login after Ask AI read it, and Ask AI's version undoes that change: src/billing/refund.ts.",
  "Ask AI read this file in an earlier answer and no longer has its text, and its version replaces all of it: README.md.",
  "Ask AI read this file earlier in this answer and no longer has its text, and its version replaces all of it: src/billing/charge.ts.",
];

const ALERT_WORDS: AIActionWords = {
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

// The action as the chat runner stores it: its sentences and their English.
function stored(
  words: AIActionWords,
  overrides: Partial<AIChatToolAction> = {},
): AIChatToolAction {
  const english: { title: string; description?: string | undefined } =
    describeAIActionWords(words);

  return {
    id: "call-commit",
    toolName: "commit_code_to_branch",
    title: english.title,
    ...(english.description ? { description: english.description } : {}),
    words,
    arguments: {
      branchName: BRANCH,
      commitMessage: "fix: charge rounds to the cent",
      changes: [
        { filePath: "src/billing/refund.ts", content: "a" },
        { filePath: "README.md", content: "b" },
        { filePath: "src/billing/charge.ts", content: "c" },
      ],
    },
    isMutation: true,
    requiresApproval: true,
    status: AIChatToolActionStatus.Pending,
    ...overrides,
  };
}

function renderCard(toolActions: Array<AIChatToolAction>): void {
  render(
    <ToolApprovalCard
      toolActions={toolActions}
      interactive={true}
      isSubmitting={false}
      onRespond={() => {}}
    />,
  );
}

// What each caution says, as a reader reads it.
function cautionTexts(): Array<string> {
  return screen
    .getAllByTestId("tool-approval-caution")
    .map((caution: HTMLElement): string => {
      return withoutIsolateMarks(caution.textContent || "").trim();
    });
}

// A template of a locale filled with values, as the card fills it.
function fill(
  words: Record<string, string>,
  key: string,
  values: Record<string, string>,
): string {
  let text: string | undefined = words[key];

  expect({ key, worded: Boolean(text) }).toEqual({ key, worded: true });

  for (const name of Object.keys(values)) {
    text = text!.split(`{{${name}}}`).join(values[name]!);
  }

  return text!;
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      de: { translation: DE },
      ar: { translation: AR },
      ja: { translation: JA },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage("en");
  });
});

async function inLanguage(language: string): Promise<void> {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage(language);
  });
}

describe("which sentences are cautions", () => {
  test("every line a code change's card can carry is a caution", () => {
    const pluralLines: Array<PluralTemplate> = Object.values(
      AI_ACTION_PLURAL_LINES,
    ).filter((plural: PluralTemplate): boolean => {
      return AI_ACTION_CODE_CHANGE_LINES.includes(plural.other);
    });

    // All eight kinds, the new one (#6570) among them.
    expect(pluralLines).toHaveLength(AI_ACTION_CODE_CHANGE_LINES.length);
    expect(pluralLines).toContain(
      AI_ACTION_PLURAL_LINES.codeFilesReadEarlierInThisAnswer,
    );

    for (const plural of pluralLines) {
      for (const paths of [["src/a.ts"], ["src/a.ts", "src/b.ts"]]) {
        const drawn: Array<DrawnActionSentence> = getToolActionDescription(
          stored({
            title: COMMIT_WORDS.title,
            description: [codeLine(plural, paths)],
          }),
          createTranslator(undefined),
        );

        expect({ line: plural.other, isCaution: drawn[0]!.isCaution }).toEqual({
          line: plural.other,
          isCaution: true,
        });
      }
    }
  });

  test("an alert's severity and what it links are not: its line is drawn as it always was", () => {
    const drawn: Array<DrawnActionSentence> = getToolActionDescription(
      stored(ALERT_WORDS, { toolName: "create_alert" }),
      createTranslator(undefined),
    );

    expect(drawn).toEqual([
      {
        text: "Severity: High.",
        direction: "ltr",
        separatorBefore: "",
      },
      {
        text: 'Linked to host "test01".',
        direction: "ltr",
        separatorBefore: " ",
      },
    ]);
  });

  test("an action saved before its words is its English, one paragraph, never a caution", () => {
    const legacy: AIChatToolAction = stored(COMMIT_WORDS);
    delete legacy.words;

    expect(
      getToolActionDescription(legacy, createTranslator(undefined)),
    ).toEqual([
      {
        text: ENGLISH_CAUTIONS.join(" "),
        direction: null,
        separatorBefore: "",
      },
    ]);
  });
});

describe("on the card, in English", () => {
  test("each caution is a line of its own, in the order the card weighs them", () => {
    renderCard([stored(COMMIT_WORDS)]);

    const list: HTMLElement = screen.getByTestId("tool-approval-cautions");

    expect(list.tagName).toBe("UL");
    // A styled list keeps its list role for a screen reader.
    expect(list).toHaveAttribute("role", "list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(cautionTexts()).toEqual(ENGLISH_CAUTIONS);
  });

  test("read in an earlier answer and read earlier in this answer are two cautions, never one paragraph", () => {
    renderCard([
      stored({
        title: COMMIT_WORDS.title,
        description: [CAUTIONS[1]!, CAUTIONS[2]!],
      }),
    ]);

    const [earlierAnswer, thisAnswer] = screen.getAllByTestId(
      "tool-approval-caution",
    );

    expect(earlierAnswer).toHaveTextContent(ENGLISH_CAUTIONS[1]!);
    expect(earlierAnswer).not.toHaveTextContent("src/billing/charge.ts");
    expect(thisAnswer).toHaveTextContent(ENGLISH_CAUTIONS[2]!);
    expect(thisAnswer).not.toHaveTextContent("README.md");
  });

  test("each is marked as a caution, the mark first, so it stands at the line's start in either direction", () => {
    renderCard([stored(COMMIT_WORDS)]);

    for (const caution of screen.getAllByTestId("tool-approval-caution")) {
      const mark: SVGElement | null = caution.querySelector("svg");

      expect(mark).not.toBeNull();
      // A mark, not words: a screen reader reads the sentence alone.
      expect(mark).toHaveAttribute("aria-hidden", "true");
      expect(mark!.getAttribute("class")).toContain("text-amber-600");
      // Never squeezed by a long sentence beside it.
      expect(mark!.getAttribute("class")).toContain("flex-shrink-0");
      // Before the sentence in the line, so a flex row puts it at the start.
      expect(caution.firstElementChild).toBe(mark!.parentElement);
      expect(caution.className).toContain("flex");
    }
  });

  test("the card's text still reads as sentences: one space between two cautions", () => {
    renderCard([stored(COMMIT_WORDS)]);

    expect(
      withoutIsolateMarks(
        screen.getByTestId("tool-approval-description").textContent || "",
      ),
    ).toBe(ENGLISH_CAUTIONS.join(" "));
  });

  test("a long path wraps inside its caution, never cut", () => {
    const longPath: string =
      "packages/App/FeatureSet/Dashboard/src/Components/Billing/InvoiceSettlementReconciliation.tsx";

    renderCard([
      stored({
        title: COMMIT_WORDS.title,
        description: [
          codeLine(AI_ACTION_PLURAL_LINES.codeFilesReadEarlierInThisAnswer, [
            longPath,
          ]),
        ],
      }),
    ]);

    const description: HTMLElement = screen.getByTestId(
      "tool-approval-description",
    );
    const caution: HTMLElement = screen.getByTestId("tool-approval-caution");

    expect(description.className).toContain("break-words");
    expect(caution.className).not.toContain("truncate");
    expect(caution.className).not.toContain("line-clamp");
    // The sentence beside the mark may shrink below its longest word.
    expect(caution.lastElementChild!.className).toContain("min-w-0");
    expect(caution).toHaveTextContent("InvoiceSettlementReconciliation.tsx.");
  });

  test("the commit's other arguments stay under its cautions: its message and Files: 3", () => {
    renderCard([stored(COMMIT_WORDS)]);

    const argumentsLine: HTMLElement = screen.getByTestId(
      "tool-approval-arguments",
    );

    expect(argumentsLine).toHaveTextContent("fix: charge rounds to the cent");
    expect(argumentsLine).toHaveTextContent("Files: 3");
    // After the cautions, as the card reads.
    expect(
      screen
        .getByTestId("tool-approval-description")
        .compareDocumentPosition(argumentsLine) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("an alert's line runs as one paragraph, with no caution and no mark", () => {
    renderCard([stored(ALERT_WORDS, { toolName: "create_alert" })]);

    const description: HTMLElement = screen.getByTestId(
      "tool-approval-description",
    );

    expect(screen.queryByTestId("tool-approval-cautions")).toBeNull();
    expect(description.querySelector("svg")).toBeNull();
    expect(withoutIsolateMarks(description.textContent || "")).toBe(
      'Severity: High. Linked to host "test01".',
    );
  });

  test("an action saved before its words reads its English as one paragraph, as it always did", () => {
    const legacy: AIChatToolAction = stored(COMMIT_WORDS);
    delete legacy.words;

    renderCard([legacy]);

    expect(screen.queryByTestId("tool-approval-cautions")).toBeNull();
    expect(
      withoutIsolateMarks(
        screen.getByTestId("tool-approval-description").textContent || "",
      ),
    ).toBe(ENGLISH_CAUTIONS.join(" "));
  });

  test("once decided, the action is its one-line row: no cautions", () => {
    renderCard([
      stored(COMMIT_WORDS, {
        status: AIChatToolActionStatus.Skipped,
        requiresApproval: false,
      }),
    ]);

    expect(screen.getByTestId("tool-approval-history")).toHaveTextContent(
      "Commit 3 files to fix/login",
    );
    expect(screen.queryByTestId("tool-approval-cautions")).toBeNull();
  });
});

describe("in German", () => {
  beforeAll(async () => {
    await inLanguage("de");
  });

  afterAll(async () => {
    await inLanguage("en");
  });

  test("each caution is German, a line of its own, its file as written", () => {
    renderCard([stored(COMMIT_WORDS)]);

    expect(cautionTexts()).toEqual([
      fill(
        DE,
        `${AI_ACTION_PLURAL_LINES.codeFilesChangedSinceRead.other}_one`,
        { branch: BRANCH, files: "src/billing/refund.ts" },
      ),
      fill(
        DE,
        `${AI_ACTION_PLURAL_LINES.codeFilesReadInEarlierAnswer.other}_one`,
        { files: "README.md" },
      ),
      fill(
        DE,
        `${AI_ACTION_PLURAL_LINES.codeFilesReadEarlierInThisAnswer.other}_one`,
        { files: "src/billing/charge.ts" },
      ),
    ]);

    for (const english of ENGLISH_CAUTIONS) {
      expect(screen.queryByText(english)).not.toBeInTheDocument();
    }

    expect(screen.getAllByTestId("tool-approval-caution")[2]).toHaveTextContent(
      "zuvor in dieser Antwort gelesen",
    );
  });
});

describe("in Arabic", () => {
  beforeAll(async () => {
    await inLanguage("ar");
  });

  afterAll(async () => {
    await inLanguage("en");
  });

  test("each caution is Arabic, read right to left, a line of its own, its file as written", () => {
    renderCard([stored(COMMIT_WORDS)]);

    const cautions: Array<HTMLElement> = screen.getAllByTestId(
      "tool-approval-caution",
    );

    expect(cautionTexts()).toEqual([
      fill(
        AR,
        `${AI_ACTION_PLURAL_LINES.codeFilesChangedSinceRead.other}_one`,
        { branch: BRANCH, files: "src/billing/refund.ts" },
      ),
      fill(
        AR,
        `${AI_ACTION_PLURAL_LINES.codeFilesReadInEarlierAnswer.other}_one`,
        { files: "README.md" },
      ),
      fill(
        AR,
        `${AI_ACTION_PLURAL_LINES.codeFilesReadEarlierInThisAnswer.other}_one`,
        { files: "src/billing/charge.ts" },
      ),
    ]);

    for (const caution of cautions) {
      const sentence: HTMLElement | null = caution.querySelector("bdi");

      expect(sentence).not.toBeNull();
      expect(sentence).toHaveAttribute("dir", "rtl");
      // The mark still comes first: in a right-to-left row, at the right.
      expect(caution.firstElementChild!.querySelector("svg")).not.toBeNull();
    }

    for (const english of ENGLISH_CAUTIONS) {
      expect(screen.queryByText(english)).not.toBeInTheDocument();
    }
  });
});

describe("in Japanese", () => {
  beforeAll(async () => {
    await inLanguage("ja");
  });

  afterAll(async () => {
    await inLanguage("en");
  });

  test("each caution is Japanese, a line of its own; after a Japanese full stop no space goes between them", () => {
    renderCard([
      stored({
        title: COMMIT_WORDS.title,
        description: [CAUTIONS[1]!, CAUTIONS[2]!],
      }),
    ]);

    const texts: Array<string> = cautionTexts();

    expect(texts).toHaveLength(2);
    expect(texts[1]).toContain("この回答の中で先に読みました");
    expect(
      withoutIsolateMarks(
        screen.getByTestId("tool-approval-description").textContent || "",
      ),
    ).toBe(texts.join(""));
  });
});

describe("the English the drawn sentences come from", () => {
  test("each caution says what describeAIActionSentence says of its line", () => {
    expect(
      CAUTIONS.map((sentence: AIActionSentence): string => {
        return describeAIActionSentence(sentence);
      }),
    ).toEqual(ENGLISH_CAUTIONS);
  });
});
