import { afterEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import fs from "fs";
import path from "path";
import * as React from "react";

/*
 * The reader's language for the feed: English unless a test says another,
 * from the Dashboard's own locale files - English's too, so the dialog's
 * words are the ones a reader sees. useTranslateValue is what useTranslator
 * and the dialog read the words through.
 */
const mockReadLocale: (language: string) => Record<string, string> = (
  language: string,
): Record<string, string> => {
  const nodeFs: typeof fs = jest.requireActual("fs") as typeof fs;
  const nodePath: typeof path = jest.requireActual("path") as typeof path;

  return JSON.parse(
    nodeFs.readFileSync(
      nodePath.resolve(
        __dirname,
        "../../../../App/FeatureSet/Dashboard/src/Locales",
        `${language}.json`,
      ),
      "utf8",
    ),
  ) as Record<string, string>;
};

let mockLocale: Record<string, string> = mockReadLocale("en");
let mockLanguage: string = "en";

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        language: mockLanguage,
        translateString: (text: string): string | undefined => {
          return mockLocale[text];
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

// The notes as text: what the dialog hands the viewer is what is under test.
jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): React.ReactElement => {
      return React.createElement(
        "div",
        { "data-testid": "markdown" },
        props.text,
      );
    },
  };
});

import ChatActivityFeed, {
  countActivitySteps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ChatActivityFeed";
import { AI_CONTEXT_TEST_IDS } from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/AiContextCopy";
import AIRunEvent from "../../../Models/DatabaseModels/AIRunEvent";
import AIRunEventType from "../../../Types/AI/AIRunEventType";
import {
  AI_RULE_AI_CONTEXT_MAX_CHARACTERS,
  AiContextActivity,
  PROJECT_AI_CONTEXT_MAX_CHARACTERS,
  composeAiContext,
  describeAiContextActivityInEnglish,
} from "../../../Types/AI/AiContext";
import ObjectID from "../../../Types/ObjectID";

/*
 * A RUN SAYS WHAT IT READ OF THE AI CONTEXT (issue #5198) - in its
 * activity, as one line: the project's notes, the AI rules' too, about how
 * many tokens they came to, and a View that opens them word for word, in
 * the order the run read them. A rule's notes left out for the run's limit
 * are a warning of their own. The feed draws the line from the data
 * (resultSummary.aiContext), in the reader's language - not the English
 * sentence the server stored beside it.
 */

function useLanguage(language: string): void {
  mockLanguage = language;
  mockLocale = mockReadLocale(language);
}

/*
 * The event a run records for what it read, as the server builds it
 * (AiContextPrompt.getAiContextEventSummary, pinned in its own tests).
 */
function aiContextEvent(activity: AiContextActivity): AIRunEvent {
  const event: AIRunEvent = new AIRunEvent(ObjectID.generate());
  event.eventType = AIRunEventType.ProgressLog;
  event.resultSummary = {
    message: describeAiContextActivityInEnglish(activity),
    severity:
      activity.leftOutRuleNames && activity.leftOutRuleNames.length > 0
        ? "Warning"
        : "Info",
    aiContext: activity,
  };
  return event;
}

const PROJECT_NOTES: string =
  "## How our systems fit together\n\n- checkout-api depends on payments-db.";

const PROJECT_ONLY: AiContextActivity = composeAiContext({
  projectContext: PROJECT_NOTES,
})!;

const WITH_RULES: AiContextActivity = composeAiContext({
  projectContext: PROJECT_NOTES,
  rules: [
    {
      id: "b",
      name: "Payments",
      aiContext: "payments-db fails over to its replica in us-east-2.",
    },
    {
      id: "a",
      name: "Checkout",
      aiContext: "Checkout's logs are in Loki under app=checkout.",
    },
  ],
})!;

const LEFT_OUT: AiContextActivity = composeAiContext({
  projectContext: "p".repeat(PROJECT_AI_CONTEXT_MAX_CHARACTERS),
  rules: ["A", "B", "C"].map((name: string) => {
    return {
      id: name,
      name,
      aiContext: name.repeat(AI_RULE_AI_CONTEXT_MAX_CHARACTERS),
    };
  }),
})!;

// Each part's heading in the open dialog, in the order the run read them.
function partHeadings(): Array<HTMLElement> {
  return within(screen.getByRole("dialog"))
    .getAllByTestId(AI_CONTEXT_TEST_IDS.activityModalPart)
    .map((part: HTMLElement): HTMLElement => {
      return part.querySelector("h3") as HTMLElement;
    });
}

// A plain log line of a run, as the engine records its steps.
function progressEvent(message: string): AIRunEvent {
  const event: AIRunEvent = new AIRunEvent(ObjectID.generate());
  event.eventType = AIRunEventType.ProgressLog;
  event.resultSummary = { message, severity: "Info" };
  return event;
}

// The words and the colour class of each step the feed drew.
function drawnSteps(container: HTMLElement): Array<[string, string]> {
  return Array.from(container.querySelectorAll("span.break-words")).map(
    (element: Element): [string, string] => {
      return [element.textContent || "", element.className];
    },
  );
}

afterEach(() => {
  cleanup();
  useLanguage("en");
});

describe("a run's line about the AI context it read", () => {
  test("the project's notes: one plain line, about how many tokens, and View", () => {
    const { container } = render(
      <ChatActivityFeed
        events={[aiContextEvent(PROJECT_ONLY)]}
        hideChrome={true}
      />,
    );

    expect(drawnSteps(container)).toEqual([
      ["Read the project's AI context", "break-words text-gray-500"],
    ]);

    const line: HTMLElement = container.querySelector(
      '[data-ai-context="true"]',
    ) as HTMLElement;
    expect(line).toHaveTextContent(
      `Read the project's AI context · about ${PROJECT_ONLY.estimatedTokenCount} tokens · View`,
    );
    expect(
      within(line).getByTestId(AI_CONTEXT_TEST_IDS.activityViewButton),
    ).toHaveAttribute("aria-haspopup", "dialog");
  });

  test("the project's and its rules': counted", () => {
    const { container } = render(
      <ChatActivityFeed
        events={[aiContextEvent(WITH_RULES)]}
        hideChrome={true}
      />,
    );

    expect(drawnSteps(container)).toEqual([
      [
        "Read the AI context of the project and 2 AI rules",
        "break-words text-gray-500",
      ],
    ]);
  });

  test("View opens the notes word for word, the project's first, then each rule's by name", () => {
    render(
      <ChatActivityFeed
        events={[aiContextEvent(WITH_RULES)]}
        hideChrome={true}
      />,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByTestId(AI_CONTEXT_TEST_IDS.activityViewButton));

    const dialog: HTMLElement = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("AI context this run read");
    expect(dialog).toHaveTextContent(
      "OneUptime AI read this first, before anything else in the run.",
    );

    const parts: Array<HTMLElement> = within(dialog).getAllByTestId(
      AI_CONTEXT_TEST_IDS.activityModalPart,
    );
    expect(
      parts.map((part: HTMLElement): [string, string] => {
        return [
          within(part).getByRole("heading").textContent || "",
          within(part).getByTestId("markdown").textContent || "",
        ];
      }),
    ).toEqual([
      ["Project", PROJECT_NOTES],
      ["AI rule Checkout", "Checkout's logs are in Loki under app=checkout."],
      [
        "AI rule Payments",
        "payments-db fails over to its replica in us-east-2.",
      ],
    ]);
    expect(parts[0]).toHaveTextContent(
      `${PROJECT_NOTES.length} characters · about ${Math.ceil(PROJECT_NOTES.length / 4)} tokens`,
    );
    // The notes are laid out by their own first letter, not the reader's language.
    for (const part of parts) {
      expect(
        within(part).getByTestId("markdown").parentElement,
      ).toHaveAttribute("dir", "auto");
    }

    // Its one button closes it: there is nothing to save.
    const close: HTMLElement = within(dialog).getByTestId(
      "modal-footer-close-button",
    );
    expect(close).toHaveTextContent("Close");
    expect(
      within(dialog).queryByTestId("modal-footer-submit-button"),
    ).toBeNull();
    fireEvent.click(close);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("a rule's notes left out for the run's limit: a warning of its own, said in the dialog too", () => {
    const { container } = render(
      <ChatActivityFeed
        events={[aiContextEvent(LEFT_OUT)]}
        hideChrome={true}
      />,
    );

    expect(drawnSteps(container)).toEqual([
      [
        "Read the AI context of the project and 2 AI rules",
        "break-words text-gray-500",
      ],
      [
        "Left out the AI context of 1 AI rule: a run reads at most 30,000 characters of AI context",
        "break-words text-amber-600",
      ],
    ]);

    fireEvent.click(screen.getByTestId(AI_CONTEXT_TEST_IDS.activityViewButton));
    const dialog: HTMLElement = screen.getByRole("dialog");
    expect(
      within(dialog).getAllByTestId(AI_CONTEXT_TEST_IDS.activityModalPart),
    ).toHaveLength(3);

    // Last, after the notes it did read: which rule's it left out, by name.
    const leftOut: HTMLElement = within(dialog).getByTestId(
      AI_CONTEXT_TEST_IDS.activityModalLeftOut,
    );
    expect(leftOut).toHaveTextContent(
      "Left out the AI context of 1 AI rule: a run reads at most 30,000 characters of AI context",
    );
    expect(
      within(leftOut)
        .getAllByRole("listitem")
        .map((item: HTMLElement): string => {
          return item.textContent || "";
        }),
    ).toEqual(LEFT_OUT.leftOutRuleNames);
    expect(LEFT_OUT.leftOutRuleNames).toEqual(["C"]);
  });

  test("several rules left out are each named; a rule saved without a name is not an empty bullet", () => {
    const activity: AiContextActivity = {
      ...PROJECT_ONLY,
      leftOutRuleNames: ["Database incidents", "", "Search incidents"],
    };

    render(
      <ChatActivityFeed
        events={[aiContextEvent(activity)]}
        hideChrome={true}
      />,
    );
    fireEvent.click(screen.getByTestId(AI_CONTEXT_TEST_IDS.activityViewButton));

    const leftOut: HTMLElement = within(screen.getByRole("dialog")).getByTestId(
      AI_CONTEXT_TEST_IDS.activityModalLeftOut,
    );
    expect(leftOut).toHaveTextContent(
      "Left out the AI context of 3 AI rules: a run reads at most 30,000 characters of AI context",
    );
    expect(
      within(leftOut)
        .getAllByRole("listitem")
        .map((item: HTMLElement): string => {
          return item.textContent || "";
        }),
    ).toEqual(["Database incidents", "Search incidents"]);
  });

  test("a run that left nothing out says nothing about it", () => {
    render(
      <ChatActivityFeed
        events={[aiContextEvent(WITH_RULES)]}
        hideChrome={true}
      />,
    );
    fireEvent.click(screen.getByTestId(AI_CONTEXT_TEST_IDS.activityViewButton));

    expect(
      within(screen.getByRole("dialog")).queryByTestId(
        AI_CONTEXT_TEST_IDS.activityModalLeftOut,
      ),
    ).toBeNull();
  });

  /*
   * A rule's heading is a kind and a name: "AI rule" quieter, the rule's
   * name in full weight and isolated, in the order the reader's language
   * puts them. The project's is one word, in full weight.
   */
  test("a rule's heading names the rule in full weight, the words around it quieter", () => {
    render(
      <ChatActivityFeed
        events={[aiContextEvent(WITH_RULES)]}
        hideChrome={true}
      />,
    );
    fireEvent.click(screen.getByTestId(AI_CONTEXT_TEST_IDS.activityViewButton));

    const headings: Array<HTMLElement> = partHeadings();

    expect(headings[0]).toHaveTextContent("Project");
    expect(headings[0]).toHaveClass("font-semibold", "text-gray-900");
    expect(headings[0]!.querySelector("bdi")).toBeNull();

    const name: HTMLElement = headings[1]!.querySelector("bdi") as HTMLElement;
    expect(headings[1]).toHaveTextContent("AI rule Checkout");
    expect(headings[1]).toHaveClass("text-gray-500");
    expect(headings[1]).not.toHaveClass("font-semibold");
    expect(name).toHaveTextContent("Checkout");
    expect(name).toHaveClass("font-semibold", "text-gray-900");
  });

  test("in German, the rule's heading keeps the language's own order around the name", () => {
    useLanguage("de");

    render(
      <ChatActivityFeed
        events={[aiContextEvent(WITH_RULES)]}
        hideChrome={true}
      />,
    );
    fireEvent.click(screen.getByTestId(AI_CONTEXT_TEST_IDS.activityViewButton));

    const heading: HTMLElement = partHeadings()[1]!;
    expect(heading).toHaveTextContent("KI-Regel Checkout");
    expect(heading.querySelector("bdi")).toHaveTextContent("Checkout");
  });

  /*
   * A live run shows only its latest steps: its line about the AI context
   * leaves the feed as steps come in. The notes someone opened stay open -
   * the feed holds them, not the line's button.
   */
  test("the notes opened from a live run stay open while new steps push its line out of sight", () => {
    const steps: Array<AIRunEvent> = [aiContextEvent(PROJECT_ONLY)];
    const { rerender, container } = render(
      <ChatActivityFeed events={steps} hideChrome={true} maxVisibleSteps={2} />,
    );

    fireEvent.click(screen.getByTestId(AI_CONTEXT_TEST_IDS.activityViewButton));
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "AI context this run read",
    );

    for (let index: number = 0; index < 4; index++) {
      steps.push(progressEvent(`Checked the database, step ${index + 1}`));
    }
    rerender(
      <ChatActivityFeed
        events={[...steps]}
        hideChrome={true}
        maxVisibleSteps={2}
      />,
    );

    // The line is gone from the feed; the notes are still open.
    expect(container.querySelector('[data-ai-context="true"]')).toBeNull();
    expect(container).toHaveTextContent("+ 3 earlier steps");
    const dialog: HTMLElement = screen.getByRole("dialog");
    expect(
      within(dialog).getByTestId(AI_CONTEXT_TEST_IDS.activityModalPart),
    ).toHaveTextContent(PROJECT_NOTES.split("\n")[0]!);

    fireEvent.click(within(dialog).getByTestId("modal-footer-close-button"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("View is read with its line: what the run read", () => {
    render(
      <ChatActivityFeed
        events={[aiContextEvent(PROJECT_ONLY)]}
        hideChrome={true}
      />,
    );

    const view: HTMLElement = screen.getByTestId(
      AI_CONTEXT_TEST_IDS.activityViewButton,
    );
    const describedBy: string = view.getAttribute("aria-describedby") || "";

    expect(describedBy).not.toBe("");
    expect(document.getElementById(describedBy)).toHaveTextContent(
      "Read the project's AI context",
    );
    expect(view).toHaveAccessibleDescription("Read the project's AI context");
  });

  test("is drawn from the data, in the reader's language, not from the English the server stored", () => {
    useLanguage("de");

    const event: AIRunEvent = aiContextEvent(WITH_RULES);
    const { container } = render(
      <ChatActivityFeed events={[event]} hideChrome={true} />,
    );

    const [[text]] = drawnSteps(container) as [[string, string]];

    expect(text).not.toBe(event.resultSummary?.message);
    expect(text).toBe("KI-Kontext des Projekts und von 2 KI-Regeln gelesen");

    fireEvent.click(screen.getByTestId(AI_CONTEXT_TEST_IDS.activityViewButton));
    const dialog: HTMLElement = screen.getByRole("dialog");
    // The notes stay as the team wrote them: only the dialog's words are translated.
    expect(dialog).toHaveTextContent(PROJECT_NOTES.split("\n")[0]!);
    expect(dialog).not.toHaveTextContent("AI context this run read");
  });

  test("counts as one step, and a rule left out as another", () => {
    expect(countActivitySteps([aiContextEvent(PROJECT_ONLY)])).toBe(1);
    expect(countActivitySteps([aiContextEvent(LEFT_OUT)])).toBe(2);
  });

  test("a ProgressLog that carries no AI context is drawn as it was", () => {
    const event: AIRunEvent = new AIRunEvent(ObjectID.generate());
    event.eventType = AIRunEventType.ProgressLog;
    event.resultSummary = {
      message: "Read the project's AI context",
      severity: "Info",
      aiContext: { parts: "not a list" } as unknown as AiContextActivity,
    };

    const { container } = render(
      <ChatActivityFeed events={[event]} hideChrome={true} />,
    );

    expect(container.querySelector('[data-ai-context="true"]')).toBeNull();
    expect(
      screen.queryByTestId(AI_CONTEXT_TEST_IDS.activityViewButton),
    ).toBeNull();
  });
});
