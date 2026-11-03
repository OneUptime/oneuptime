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
  formatStepDuration,
  friendlyToolNames,
  getActionStepLink,
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
        screen.getByText(word(words, getKnownEvidenceTool(tool)!.description)),
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

/*
 * AN ACTION THAT RAN READS AS DONE, NOT AS A LINK.
 *
 * Once it said what it did ("Declared an incident") instead of the tool's
 * name, an executed action kept the look of a link - indigo, with an
 * external-link arrow - though it opened nothing. A line that carries an
 * address (an opened pull request) is still its link; any other is a step
 * that is done: a check, in the step's own colour.
 */
describe("an action that ran", () => {
  beforeAll(async () => {
    await inLanguage("de");
  });

  test("with no address, is a step that is done: a check beside it, no link and no link colour", () => {
    const { container } = render(
      <ChatActivityFeed
        events={events([
          {
            eventType: AIRunEventType.ActionExecuted,
            toolName: "create_incident",
          },
        ])}
        hideChrome={true}
      />,
    );

    const line: HTMLElement = screen.getByTestId("activity-step-action");
    expect(line).toHaveTextContent(
      word(DE, getKnownEvidenceTool("create_incident")!.description),
    );
    expect(container.querySelector("a")).toBeNull();
    expect(line.className).not.toContain("indigo");

    const mark: Element = container.querySelector(
      '[data-testid="activity-step-mark"]',
    )!;
    expect(mark.querySelector('[class*="text-emerald-500"]')).not.toBeNull();
    expect(mark.querySelector('[class*="text-indigo-500"]')).toBeNull();
  });

  test("with an address, is its link", () => {
    const { container } = render(
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

    const link: HTMLAnchorElement = container.querySelector("a")!;
    expect(link).not.toBeNull();
    expect(link.getAttribute("href")).toBe(
      "https://github.com/acme/shop/pull/7",
    );
    expect(screen.queryByTestId("activity-step-action")).toBeNull();
  });

  test("getActionStepLink finds the line's address, or none", () => {
    expect(
      getActionStepLink(
        "Opened pull request: Fix — https://github.com/acme/shop/pull/7",
      ),
    ).toBe("https://github.com/acme/shop/pull/7");
    expect(getActionStepLink("Declared an incident")).toBeNull();
  });
});

/*
 * A STEP'S DURATION, WRITTEN THE READER'S WAY.
 *
 * Its detail says how many rows it read and how long it took. The rows were
 * the reader's ("1.234 Zeilen") while the time stayed English ("0.6s"):
 * the two figures of one line were written two ways.
 */
describe("a step's duration", () => {
  test("is the English it always was in English", () => {
    expect(formatStepDuration(640, "en")).toBe("0.6s");
    expect(formatStepDuration(1500, "en-GB")).toBe("1.5s");
    expect(formatStepDuration(2000, undefined)).toBe("2.0s");
  });

  test("in German, with its decimal comma", () => {
    const said: string = formatStepDuration(640, "de");

    expect(said).toContain("0,6");
    expect(said).not.toContain("0.6");
  });

  test("in Persian, with Persian digits", () => {
    expect(formatStepDuration(640, "fa")).toContain("۰٫۶");
  });

  test("an engine that cannot write the unit falls back to the English", () => {
    const spy: jest.SpyInstance = jest
      .spyOn(Intl, "NumberFormat")
      .mockImplementation((): Intl.NumberFormat => {
        throw new RangeError("no unit style");
      });

    try {
      expect(formatStepDuration(640, "de")).toBe("0.6s");
    } finally {
      spy.mockRestore();
    }
  });

  test("the feed writes a step's rows and its time alike, in German", async () => {
    await inLanguage("de");
    const completed: AIRunEvent = new AIRunEvent(ObjectID.generate());
    completed.eventType = AIRunEventType.ToolCallCompleted;
    completed.toolName = "get_on_call_status";
    completed.resultSummary = { rowCount: 1234, durationInMs: 640 };

    const { container } = render(
      <ChatActivityFeed
        events={[
          ...events([
            {
              eventType: AIRunEventType.ToolCallStarted,
              toolName: "get_on_call_status",
            },
          ]),
          completed,
        ]}
        hideChrome={true}
      />,
    );

    const text: string = container.textContent || "";
    expect(text).toContain("1.234");
    expect(text).toContain(formatStepDuration(640, "de"));
    expect(text).not.toContain("0.6s");
  });
});
