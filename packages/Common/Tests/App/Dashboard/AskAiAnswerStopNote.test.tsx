import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import SafeChatMarkdown from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/SafeChatMarkdown";
import { AIChatCitation } from "../../../Types/AI/AIChatTypes";
import AIAgentRunLimitsHelper, {
  AIAgentRunLimits,
  AIRunStopReason,
  AIRunTimeLimitSource,
  PROJECT_AI_RUN_LIMITS_LOCATION,
} from "../../../Types/AI/AIAgentRunLimits";

/*
 * ASK AI'S ANSWER, WHEN A LIMIT STOPPED IT (issue #6440).
 *
 * The chat agent ends a stopped answer with OneUptime's line saying so:
 * "_This run stopped at this project's limit of 40 model calls per run.
 * Change it in [Project Settings → AI → ... → Limits per run](...)._". The
 * answer is drawn in safe mode, where that link was dotted text that went
 * nowhere, in italics, as the answer's last paragraph. Ask AI now draws it
 * as the AI card does: a line of its own under the answer, with an amber
 * mark, the setting a link the Dashboard builds - never the note's own
 * address, since a line that reads like the server's may be the model's.
 *
 * react-markdown is mocked in Common jest: the viewer stand-in below shows
 * the text it is handed and asks for a chip for each "[C#]".
 */

const markdownViewerMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: {
      text: string;
      safeMode?: boolean;
      inlineReferences?: {
        renderCitation?: (id: string) => React.ReactElement | null;
      };
    }): React.ReactElement => {
      markdownViewerMock(props);
      const chips: Array<React.ReactElement | null> = Array.from(
        props.text.matchAll(/\[(C\d+)\]/g),
      ).map((match: RegExpMatchArray, index: number) => {
        const chip: React.ReactElement | null =
          props.inlineReferences?.renderCitation?.(match[1]!) ?? null;
        return chip
          ? React.createElement(React.Fragment, { key: index }, chip)
          : null;
      });

      return React.createElement(
        "div",
        {
          "data-testid": "answer-markdown",
          "data-safe-mode": String(props.safeMode === true),
        },
        props.text,
        ...chips,
      );
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/CitationTargetNav",
  () => {
    return {
      __esModule: true,
      navigateToCitationTarget: (): void => {
        // Not part of these tests.
      },
    };
  },
);

const SETTINGS_URL: string =
  "https://oneuptime.example.com/dashboard/5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e/settings/ai-features#LimitsPerRun";

const ANSWER: string =
  "checkout-api's pool sat at its ceiling of 5 from 14:02 [C1].\n\n- Roll back the 14:00 deploy.";

const CITATIONS: Array<AIChatCitation> = [
  {
    id: "C1",
    toolName: "query_metrics",
    label: "Pool connections of checkout-api",
    queryArguments: {},
    rowCount: 120,
  } as unknown as AIChatCitation,
];

function limits(overrides: Partial<AIAgentRunLimits>): AIAgentRunLimits {
  return { ...AIAgentRunLimitsHelper.getDefault(), ...overrides };
}

const MODEL_CALLS: AIAgentRunLimits = limits({ maxLlmCalls: 40 });

function note(
  reason: AIRunStopReason = AIRunStopReason.ModelCalls,
  runLimits: AIAgentRunLimits = MODEL_CALLS,
  settingsUrl: string | null = SETTINGS_URL,
): string {
  return AIAgentRunLimitsHelper.getStopNote({
    reason,
    limits: runLimits,
    settingsUrl,
  });
}

function words(
  reason: AIRunStopReason = AIRunStopReason.ModelCalls,
  runLimits: AIAgentRunLimits = MODEL_CALLS,
): string {
  return AIAgentRunLimitsHelper.getStopNoteText({ reason, limits: runLimits });
}

afterEach(() => {
  cleanup();
  markdownViewerMock.mockReset();
});

describe("Ask AI: an answer a limit stopped", () => {
  test("the answer is drawn as it was written, and the note as a line of its own under it", () => {
    render(
      <SafeChatMarkdown
        text={`${ANSWER}\n\n${note()}`}
        citations={CITATIONS}
      />,
    );

    const answer: HTMLElement = screen.getByTestId("answer-markdown");
    const line: HTMLElement = screen.getByTestId(
      "investigation-report-stop-note",
    );

    // The viewer gets the answer alone, in safe mode, chips and all.
    expect(answer.textContent).toContain(ANSWER);
    expect(answer).not.toHaveTextContent("stopped");
    expect(answer).toHaveAttribute("data-safe-mode", "true");
    expect(markdownViewerMock).toHaveBeenCalledTimes(1);
    expect(
      (markdownViewerMock.mock.calls[0]![0] as { text: string }).text,
    ).toBe(ANSWER);

    // The note, in words, after the answer.
    expect(line).toHaveTextContent(words());
    expect(
      answer.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(line.querySelector("svg")).not.toBeNull();
    expect(line.textContent).not.toMatch(/^_|_$|\]\(/);
  });

  test("the setting it names is a link the Dashboard builds, never the note's own address", () => {
    const hostile: string = note().replace(
      SETTINGS_URL,
      "https://attacker.example/steal",
    );

    render(<SafeChatMarkdown text={`${ANSWER}\n\n${hostile}`} />);

    const link: HTMLElement = within(
      screen.getByTestId("investigation-report-stop-note"),
    ).getByRole("link", { name: PROJECT_AI_RUN_LIMITS_LOCATION });

    expect(link.getAttribute("href")).toMatch(
      /\/settings\/ai-features#LimitsPerRun$/,
    );
    expect(document.body.innerHTML).not.toContain("attacker.example");
    // Not the dotted text that went nowhere.
    expect(document.querySelector(".decoration-dotted")).toBeNull();
  });

  test("a run that wrote nothing shows the note alone, with no empty answer above it", () => {
    render(<SafeChatMarkdown text={note(AIRunStopReason.Loop)} />);

    expect(screen.queryByTestId("answer-markdown")).toBeNull();
    expect(markdownViewerMock).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("investigation-report-stop-note"),
    ).toHaveTextContent(
      "This run stopped early: it kept repeating calls that showed it nothing new.",
    );
    expect(screen.queryByRole("link")).toBeNull();
  });

  test("a chat app's note, or one with no settings address, is drawn the same way", () => {
    const chatApp: AIAgentRunLimits = limits({
      maxWallClockMs: 25 * 60 * 1000,
      timeLimitSource: AIRunTimeLimitSource.ChatApp,
    });

    render(
      <SafeChatMarkdown
        text={`${ANSWER}\n\n${note(AIRunStopReason.TimeLimit, chatApp, null)}`}
      />,
    );

    expect(
      screen.getByTestId("investigation-report-stop-note"),
    ).toHaveTextContent(words(AIRunStopReason.TimeLimit, chatApp));
  });

  test("an answer no limit stopped is drawn exactly as before: one viewer, no line", () => {
    const { container } = render(
      <SafeChatMarkdown text={ANSWER} citations={CITATIONS} />,
    );

    expect(screen.queryByTestId("investigation-report-stop-note")).toBeNull();
    expect(markdownViewerMock).toHaveBeenCalledTimes(1);
    expect(
      (markdownViewerMock.mock.calls[0]![0] as { text: string }).text,
    ).toBe(ANSWER);
    // The viewer is the whole of it: no wrapper around a lone answer.
    expect(container.firstElementChild).toBe(
      screen.getByTestId("answer-markdown"),
    );
  });

  test("a look-alike the model ended its own paragraph with stays part of the answer", () => {
    const answer: string = `${ANSWER}\n${note()}`;

    render(<SafeChatMarkdown text={answer} />);

    expect(screen.queryByTestId("investigation-report-stop-note")).toBeNull();
    expect(
      (markdownViewerMock.mock.calls[0]![0] as { text: string }).text,
    ).toBe(answer);
  });
});
