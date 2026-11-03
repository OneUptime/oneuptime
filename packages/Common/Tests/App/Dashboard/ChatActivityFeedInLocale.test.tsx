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
  describeLiveActivity,
  friendlyToolNames,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ChatActivityFeed";
import { getKnownEvidenceTool } from "../../../../App/FeatureSet/Dashboard/src/Utils/InvestigationEvidenceFormat";
import AIRunEvent from "../../../Models/DatabaseModels/AIRunEvent";
import AIRunEventType from "../../../Types/AI/AIRunEventType";
import ObjectID from "../../../Types/ObjectID";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * ASK AI'S STEPS IN THE READER'S LANGUAGE.
 *
 * While OneUptime AI answers, its steps say what it is doing ("Checking
 * SLOs"), and once an action the person allowed has run, what it did
 * ("Declared an incident") - in the words an investigation's Evidence
 * checked uses for the same tool. A step used to read as the tool's own
 * name ("Executed create_incident", "Running query_slos") in English on a
 * German or Persian page. These render the feed from the shipped locale
 * files: every step is the reader's, and never a tool's name.
 */

const DE: Record<string, string> = readDashboardLocale("de");
const FA: Record<string, string> = readDashboardLocale("fa");

interface StepEvent {
  eventType: AIRunEventType;
  toolName?: string | undefined;
  message?: string | undefined;
}

function events(steps: Array<StepEvent>): Array<AIRunEvent> {
  return steps.map((step: StepEvent): AIRunEvent => {
    const event: AIRunEvent = new AIRunEvent(ObjectID.generate());
    event.eventType = step.eventType;

    if (step.toolName) {
      event.toolName = step.toolName;
    }

    if (step.message) {
      event.resultSummary = { message: step.message };
    }

    return event;
  });
}

// Ask AI checks the SLOs, then declares the incident the person allowed.
const DECLARE_RUN: Array<AIRunEvent> = events([
  { eventType: AIRunEventType.RunStarted },
  { eventType: AIRunEventType.ToolCallStarted, toolName: "query_slos" },
  { eventType: AIRunEventType.ToolCallCompleted, toolName: "query_slos" },
  { eventType: AIRunEventType.ApprovalRequested },
  { eventType: AIRunEventType.ActionExecuted, toolName: "create_incident" },
  { eventType: AIRunEventType.ActionExecuted, toolName: "create_alert" },
  {
    eventType: AIRunEventType.ActionExecuted,
    toolName: "add_incident_affected_resources",
  },
]);

function word(words: Record<string, string>, key: string): string {
  const value: string | undefined = words[key];

  expect({ key, worded: Boolean(value) && value !== key }).toEqual({
    key,
    worded: true,
  });

  return value!;
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "de",
    fallbackLng: "en",
    resources: { de: { translation: DE }, fa: { translation: FA } },
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

describe.each<[string, Record<string, string>]>([
  ["de", DE],
  ["fa", FA],
])("in %s", (language: string, words: Record<string, string>) => {
  beforeAll(async () => {
    await inLanguage(language);
  });

  test("every step of a run that declared an incident is the reader's, and never a tool's name", () => {
    const { container } = render(
      <ChatActivityFeed
        events={DECLARE_RUN}
        hideChrome={true}
        maxVisibleSteps={20}
      />,
    );

    expect(
      screen.getByText(word(words, "Starting investigation")),
    ).toBeInTheDocument();
    expect(
      screen.getByText(word(words, friendlyToolNames["query_slos"]!)),
    ).toBeInTheDocument();

    for (const tool of [
      "create_incident",
      "create_alert",
      "add_incident_affected_resources",
    ]) {
      expect(
        screen.getByText(
          word(words, getKnownEvidenceTool(tool)!.description),
        ),
      ).toBeInTheDocument();
    }

    const text: string = container.textContent || "";
    expect(text).not.toContain("query_slos");
    expect(text).not.toContain("create_incident");
    expect(text).not.toContain("create_alert");
    expect(text).not.toContain("Executed");
    expect(text).not.toContain("Running");
  });

  test("the live line names the step running now in the reader's words", () => {
    const running: Array<AIRunEvent> = events([
      { eventType: AIRunEventType.RunStarted },
      {
        eventType: AIRunEventType.ToolCallStarted,
        toolName: "get_on_call_status",
      },
    ]);

    expect(
      describeLiveActivity(running, dashboardTranslator(language)).text,
    ).toBe(word(words, friendlyToolNames["get_on_call_status"]!));
  });

  test("an executed action the lists do not know reads as the reader's sentence, the tool named inside it", () => {
    render(
      <ChatActivityFeed
        events={events([
          {
            eventType: AIRunEventType.ActionExecuted,
            toolName: "some_new_tool",
          },
        ])}
        hideChrome={true}
      />,
    );

    expect(
      screen.getByText(
        word(words, "Executed {{tool}}").replace("{{tool}}", "some_new_tool"),
      ),
    ).toBeInTheDocument();
  });

  test("an executed action that brought its own line keeps it as written", () => {
    render(
      <ChatActivityFeed
        events={events([
          {
            eventType: AIRunEventType.ActionExecuted,
            toolName: "open_pull_request",
            message:
              "Opened pull request: Fix checkout — https://github.com/acme/shop/pull/7",
          },
        ])}
        hideChrome={true}
      />,
    );

    expect(
      screen.getByText(
        "Opened pull request: Fix checkout — https://github.com/acme/shop/pull/7",
      ),
    ).toBeInTheDocument();
  });
});
