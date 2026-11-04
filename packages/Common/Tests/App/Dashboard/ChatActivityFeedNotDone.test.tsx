import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";
import ChatActivityFeed, {
  describeFailedToolCall,
  friendlyToolNames,
  REFUSED_TOOL_CALL_DETAILS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ChatActivityFeed";
import AIRunEvent from "../../../Models/DatabaseModels/AIRunEvent";
import {
  AIRunEventResultSummary,
  AIToolRefusal,
  AI_TOOL_REFUSALS,
} from "../../../Types/AI/AIChatTypes";
import AIRunEventType from "../../../Types/AI/AIRunEventType";
import ObjectID from "../../../Types/ObjectID";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * A REFUSED OR FAILED ACTION READS AS NOT DONE (#5315's follow-up).
 *
 * The step of a call that failed said "did not succeed - retrying
 * differently". A refused call is never tried again - the toolbox tells
 * the model so - and a failed action (a tool that changes the project) may
 * well not be: the step promised a retry the run never made. Now:
 *
 *   - a refused call says it was not done, and why, from the kind the
 *     server recorded: the person's role, a team's block, the project's
 *     plan, or a change that is not theirs to make;
 *   - a failed action says it was not done - the answer says why;
 *   - a failed read, which the model may try another way, reads as before,
 *     and a kubectl call says whether it ran, as before;
 *   - in every Dashboard language.
 */

const DE: Record<string, string> = readDashboardLocale("de");

// Every refusal's words start the same way: it was not done.
const NOT_DONE_PREFIX: RegExp = /^not done — /;

function failedCall(data: {
  toolName: string;
  resultSummary?: AIRunEventResultSummary | undefined;
}): Array<AIRunEvent> {
  const started: AIRunEvent = new AIRunEvent(ObjectID.generate());
  started.eventType = AIRunEventType.ToolCallStarted;
  started.toolName = data.toolName;

  const failed: AIRunEvent = new AIRunEvent(ObjectID.generate());
  failed.eventType = AIRunEventType.ToolCallFailed;
  failed.toolName = data.toolName;

  if (data.resultSummary) {
    failed.resultSummary = data.resultSummary;
  }

  return [started, failed];
}

function failedEvent(resultSummary?: AIRunEventResultSummary): AIRunEvent {
  return failedCall({
    toolName: "create_incident",
    ...(resultSummary ? { resultSummary } : {}),
  })[1]!;
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: { de: { translation: DE } },
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

describe("what a failed step says, in English", () => {
  test.each([
    [AIToolRefusal.Permission, "not done — your role does not allow it"],
    [AIToolRefusal.TeamBlock, "not done — a team you belong to blocks it"],
    [AIToolRefusal.Plan, "not done — the project's plan does not include it"],
    [AIToolRefusal.NotAllowed, "not done — you are not allowed to do this"],
  ])(
    "refused for %s: not done, and why",
    (refusal: AIToolRefusal, said: string) => {
      expect(
        describeFailedToolCall(
          failedEvent({ refusal, isAction: true }),
          dashboardTranslator("en"),
        ),
      ).toBe(said);

      // A refused read is not done either: it is never tried again.
      expect(
        describeFailedToolCall(
          failedCall({
            toolName: "query_slos",
            resultSummary: { refusal },
          })[1]!,
          dashboardTranslator("en"),
        ),
      ).toBe(said);
    },
  );

  test("an action that failed for another reason: not done - the answer says why", () => {
    expect(
      describeFailedToolCall(
        failedEvent({ isAction: true, errorMessage: "could not save" }),
        dashboardTranslator("en"),
      ),
    ).toBe("not done");
  });

  test("a read that failed reads as before: the model may try it another way", () => {
    expect(
      describeFailedToolCall(
        failedCall({
          toolName: "query_traces",
          resultSummary: { errorMessage: "bad window" },
        })[1]!,
        dashboardTranslator("en"),
      ),
    ).toBe("did not succeed — retrying differently");
  });

  test("a refusal the server never sent - an unknown kind - is not trusted: read as any other failure", () => {
    expect(
      describeFailedToolCall(
        failedEvent({
          refusal: "Whatever" as unknown as AIToolRefusal,
          isAction: true,
        }),
        dashboardTranslator("en"),
      ),
    ).toBe("not done");
  });

  test("the feed draws the step, its mark, and never 'retrying' for an action", () => {
    const { container } = render(
      <ChatActivityFeed
        events={failedCall({
          toolName: "create_alert",
          resultSummary: { refusal: AIToolRefusal.Permission, isAction: true },
        })}
        hideChrome={true}
      />,
    );

    expect(screen.getByText("Creating alert")).toBeInTheDocument();
    expect(
      screen.getByText("· not done — your role does not allow it"),
    ).toBeInTheDocument();
    expect(container.textContent).not.toContain("retrying");
  });
});

describe("in German", () => {
  beforeAll(async () => {
    await act(async (): Promise<void> => {
      await i18next.changeLanguage("de");
    });
  });

  afterAll(async () => {
    await act(async (): Promise<void> => {
      await i18next.changeLanguage("en");
    });
  });

  test("a refused action's step is German, the reason with it", () => {
    render(
      <ChatActivityFeed
        events={failedCall({
          toolName: "create_incident",
          resultSummary: { refusal: AIToolRefusal.TeamBlock, isAction: true },
        })}
        hideChrome={true}
      />,
    );

    expect(
      screen.getByText(DE[friendlyToolNames["create_incident"]!]!),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`· ${DE["not done — a team you belong to blocks it"]!}`),
    ).toBeInTheDocument();
  });

  test("a failed action's step is German", () => {
    render(
      <ChatActivityFeed
        events={failedCall({
          toolName: "create_incident",
          resultSummary: { isAction: true },
        })}
        hideChrome={true}
      />,
    );

    expect(screen.getByText(`· ${DE["not done"]!}`)).toBeInTheDocument();
  });
});

describe("worded in every Dashboard language", () => {
  const keys: Array<string> = [
    "not done",
    ...AI_TOOL_REFUSALS.map((refusal: string): string => {
      return REFUSED_TOOL_CALL_DETAILS[refusal as AIToolRefusal];
    }),
  ];

  test("every kind of refusal has its words", () => {
    for (const refusal of AI_TOOL_REFUSALS) {
      expect(REFUSED_TOOL_CALL_DETAILS[refusal as AIToolRefusal]).toMatch(
        NOT_DONE_PREFIX,
      );
    }
  });

  test.each(
    DASHBOARD_LANGUAGES.map((language: string): [string] => {
      return [language];
    }),
  )("%s words each of them", (language: string) => {
    for (const key of keys) {
      expect({ key, worded: isWordedInDashboardLocale(key, language) }).toEqual(
        { key, worded: true },
      );

      // The step says it in that language: never the English.
      expect(
        describeFailedToolCall(
          failedEvent(
            key === "not done"
              ? { isAction: true }
              : {
                  refusal: AI_TOOL_REFUSALS.find((refusal: string): boolean => {
                    return (
                      REFUSED_TOOL_CALL_DETAILS[refusal as AIToolRefusal] ===
                      key
                    );
                  }) as AIToolRefusal,
                  isAction: true,
                },
          ),
          dashboardTranslator(language),
        ),
      ).toBe(readDashboardLocale(language)[key]);
    }
  });
});
