/** @timezone UTC */
import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

const getItemMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();

jest.mock("react-router-dom", () => {
  return {
    ...(jest.requireActual("react-router-dom") as Record<string, unknown>),
    __esModule: true,
    useParams: () => {
      return { id: "11111111-1111-4111-8111-111111111111" };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
      // The server's own words, as the real API reads them off a refusal.
      getFriendlyMessage: (error: unknown) => {
        return (error as { message?: string }).message || "Request failed";
      },
    },
  };
});

// The card's Remediation step reads on its own (its own suites).
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStep",
  () => {
    return jest.requireActual("./RemediationStepStub");
  },
);

import AIInsightViewPage from "../../../../App/FeatureSet/Dashboard/src/Pages/AIInsights/View/Index";
import InvestigationPanel from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationPanel";
import {
  friendlyToolNames,
  LINKED_RESOURCE_KIND_NOUNS,
  REFUSED_TOOL_CALL_DETAILS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ChatActivityFeed";
import { resetRemediationStepStub } from "./RemediationStepStub";
import AIInsight from "../../../Models/DatabaseModels/AIInsight";
import AIInsightSeverity from "../../../Types/AI/AIInsightSeverity";
import AIInsightStatus from "../../../Types/AI/AIInsightStatus";
import AIInsightType from "../../../Types/AI/AIInsightType";
import {
  AIRunAttemptOutcome,
  AIRunFailureKind,
} from "../../../Types/AI/AIRunAttempt";
import AIRunEventType from "../../../Types/AI/AIRunEventType";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import {
  AI_RUN_REFUSALS,
  AiRunRefusalCode,
} from "../../../Types/AI/AiRunRefusal";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { Translator } from "../../../Types/Translator";
import { followLanguageForDates } from "../../../UI/Utils/DateDisplayLanguage";
import { followLanguageForPage } from "../../../UI/Utils/PageLanguage";
import {
  dashboardTranslator,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * THE AI TRIAGE, THE AI INVESTIGATION CARD AND THEIR STEPS, IN ARABIC
 * (issue #6492).
 *
 * An Arabic reader whose insight's triage did not finish read "AI Triage",
 * "Triage did not finish" and "Show 7 earlier steps", and the steps
 * "Searching code", "Reading a code file" and "Thinking · failed" between
 * Arabic lines. Every word of the two cards and of their steps is Arabic
 * now: Triage is الفرز in the glossary (Locales/ARABIC.md), as Investigation
 * is التحقيق. These suites draw the real insight page and the real card in
 * Arabic, on a page that reads right to left, and find no English on them
 * but what Arabic keeps as written: the product's name, OneUptime AI, and
 * LLM - and the AI provider's own error, under Details.
 */

const INSIGHT_ID: string = "11111111-1111-4111-8111-111111111111";
const RUN_ID: string = "22222222-2222-4222-8222-222222222222";
const INCIDENT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const INSIGHT_TITLE: string = "Worker job count increased";
const EVIDENCE: string = "The worker queue grew to 13,191,243 jobs.";
const PROVIDER_ERROR: string =
  "OpenAICompatible API request failed: The LLM provider did not respond within 120 seconds.";
/*
 * The server's refusals of Try again that the Dashboard does not word (a
 * newer server's, with no code it knows): English. Every refusal with a
 * code reads in Arabic (#7359).
 */
const TRIAGE_REFUSAL: string =
  "The triage could not start: the moon is full tonight.";
const INVESTIGATION_REFUSAL: string =
  "The investigation could not start: the moon is full tonight.";

const AR: Record<string, string> = readDashboardLocale("ar");
const EN: Record<string, string> = readDashboardLocale("en");
const arabic: Translator = dashboardTranslator("ar");

// The Latin words an Arabic sentence keeps as written.
const LATIN_WORDS_KEPT: ReadonlyArray<string> = ["OneUptime", "AI", "LLM"];
const LATIN_WORD: RegExp = /[A-Za-z][A-Za-z'’]*/g;

// A locale's sentence with its {{placeholders}} filled.
function fill(template: string, values: Record<string, string>): string {
  return template.replace(
    /\{\{\s*([\w.]+)\s*\}\}/g,
    (whole: string, name: string): string => {
      return values[name] ?? whole;
    },
  );
}

// Arabic's wording of a key, which must be its own.
function word(key: string): string {
  expect({ key, worded: isWordedInDashboardLocale(key, "ar") }).toEqual({
    key,
    worded: true,
  });

  return AR[key]!;
}

/*
 * Try again refused: by the server, with its refusal's code - in Arabic -
 * or in words the Dashboard does not word - English, whatever the
 * reader's language - or by a request that got no answer, in the button's
 * own words, Arabic. Arabic words read as the page does (no dir of their
 * own); English ones read from the left (dir="ltr").
 */
type TryAgainRefusal = [
  string,
  () => Promise<unknown>,
  () => string, // what the card says, read in the test
  string | null, // the line's own dir
];

function tryAgainRefusals(
  serverWords: string,
  refusalCode: AiRunRefusalCode,
): Array<TryAgainRefusal> {
  return [
    [
      "the server's refusal with its code, in Arabic",
      (): Promise<unknown> => {
        return Promise.resolve(
          new HTTPErrorResponse(
            400,
            { message: AI_RUN_REFUSALS[refusalCode], refusalCode },
            {},
          ),
        );
      },
      (): string => {
        return word(AI_RUN_REFUSALS[refusalCode]);
      },
      null,
    ],
    [
      "the server's refusal, in its own English words",
      (): Promise<unknown> => {
        return Promise.resolve(
          new HTTPErrorResponse(400, { message: serverWords }, {}),
        );
      },
      (): string => {
        return serverWords;
      },
      "ltr",
    ],
    [
      "a request that got no answer, in the button's own Arabic words",
      (): Promise<unknown> => {
        return Promise.reject(undefined);
      },
      (): string => {
        return word("The run could not start again. Try again in a moment.");
      },
      null,
    ],
  ];
}

/*
 * What a reader sees or hears on an element, piece by piece: each text, and
 * each label a screen reader says - hidden ones too, as a fold opens to
 * show them - but for what `leaveOut` holds.
 */
function piecesOf(
  root: HTMLElement,
  leaveOut: ReadonlyArray<Element>,
): Array<string> {
  const isLeftOut: (node: Node) => boolean = (node: Node): boolean => {
    return leaveOut.some((element: Element): boolean => {
      return element.contains(node);
    });
  };
  const pieces: Array<string> = [];
  const walker: TreeWalker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
  );

  for (let node: Node | null = walker.nextNode(); node; ) {
    const text: string = (node.textContent || "").trim();

    if (text && !isLeftOut(node)) {
      pieces.push(text);
    }

    node = walker.nextNode();
  }

  for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
    if (isLeftOut(element)) {
      continue;
    }

    for (const attribute of ["aria-label", "title", "alt", "placeholder"]) {
      const value: string = (element.getAttribute(attribute) || "").trim();

      if (value) {
        pieces.push(value);
      }
    }
  }

  return pieces;
}

// The pieces of an element with a Latin word Arabic does not keep.
function englishOn(
  root: HTMLElement,
  leaveOut: ReadonlyArray<Element> = [],
): Array<string> {
  return piecesOf(root, leaveOut).filter((piece: string): boolean => {
    return (piece.match(LATIN_WORD) || []).some((latin: string): boolean => {
      return !LATIN_WORDS_KEPT.includes(latin);
    });
  });
}

interface Step {
  eventType: AIRunEventType;
  toolName?: string | undefined;
  resultSummary?: JSONObject | undefined;
}

function thinking(): Array<Step> {
  return [
    { eventType: AIRunEventType.LlmCallStarted },
    { eventType: AIRunEventType.LlmCallCompleted },
  ];
}

function tool(toolName: string, rowCount: number): Array<Step> {
  return [
    { eventType: AIRunEventType.ToolCallStarted, toolName },
    {
      eventType: AIRunEventType.ToolCallCompleted,
      toolName,
      resultSummary: { rowCount, durationInMs: 600 },
    },
  ];
}

// A read that failed: the model tries another way.
function failedRead(toolName: string): Array<Step> {
  return [
    { eventType: AIRunEventType.ToolCallStarted, toolName },
    {
      eventType: AIRunEventType.ToolCallFailed,
      toolName,
      resultSummary: {
        errorMessage: "The query timed out after 30 seconds.",
        durationInMs: 30000,
      },
    },
  ];
}

// The model's call the provider never answered.
function failedThinking(): Array<Step> {
  return [
    { eventType: AIRunEventType.LlmCallStarted },
    {
      eventType: AIRunEventType.LlmCallFailed,
      resultSummary: { errorMessage: PROVIDER_ERROR },
    },
  ];
}

// One attempt's work, as a triage of a slow checkout does it.
function attempt(): Array<Step> {
  return [
    { eventType: AIRunEventType.RunStarted },
    ...thinking(),
    ...tool("search_code", 2),
    ...tool("read_code_file", 113),
    ...failedRead("query_traces"),
    ...thinking(),
    ...tool("search_logs", 7),
    ...tool("query_metrics", 3),
    ...tool("get_trace", 20),
    ...tool("lookup_context", 2),
    ...thinking(),
    ...tool("search_code", 40),
    ...tool("read_code_file", 229),
    ...failedThinking(),
  ];
}

function attemptEnd(
  eventType: AIRunEventType,
  outcome: AIRunAttemptOutcome,
  attemptNumber: number,
): Step {
  return {
    eventType,
    resultSummary: {
      attemptEnd: {
        outcome,
        failureKind: AIRunFailureKind.ProviderTimeout,
        attempt: attemptNumber,
        maxAttempts: 2,
        timeoutInSeconds: 120,
        ...(outcome === AIRunAttemptOutcome.WillRetry
          ? { nextAttemptAt: "2026-11-09T14:10:00.000Z" }
          : {}),
      },
    } as JSONObject,
  };
}

// Two attempts, the provider timing out at the end of each.
function failedRun(): Array<Step> {
  return [
    ...attempt(),
    attemptEnd(AIRunEventType.AttemptEnded, AIRunAttemptOutcome.WillRetry, 1),
    ...attempt(),
    attemptEnd(AIRunEventType.RunFailed, AIRunAttemptOutcome.GaveUp, 2),
  ];
}

// The events as the API sends them: a clock that moves on with each one.
function eventsJson(steps: Array<Step>): Array<JSONObject> {
  return steps.map((step: Step, index: number): JSONObject => {
    return {
      _id: ObjectID.generate().toString(),
      sequence: index + 1,
      eventType: step.eventType,
      ...(step.toolName ? { toolName: step.toolName } : {}),
      ...(step.resultSummary ? { resultSummary: step.resultSummary } : {}),
      createdAt: {
        _type: "DateTime",
        value: new Date(Date.UTC(2026, 10, 9, 14, 0, index * 5)).toISOString(),
      },
    };
  });
}

interface FakeServer {
  triage: JSONObject;
  investigation: JSONObject;
  // How the server answers Try again, for a triage or an investigation.
  tryAgain: () => Promise<unknown>;
}

let server: FakeServer;

function buildInsight(): AIInsight {
  const insight: AIInsight = new AIInsight();
  insight.id = new ObjectID(INSIGHT_ID);
  insight.title = INSIGHT_TITLE;
  insight.insightType = AIInsightType.MetricDrift;
  insight.severity = AIInsightSeverity.Medium;
  insight.status = AIInsightStatus.ActionRequired;
  insight.detailMarkdown = EVIDENCE;
  insight.occurrenceCount = 4;
  return insight;
}

function failedTriage(): JSONObject {
  return {
    run: {
      _id: RUN_ID,
      status: AIRunStatus.Error,
      errorMessage: PROVIDER_ERROR,
      startedAt: { _type: "DateTime", value: "2026-11-09T14:00:00.000Z" },
      completedAt: { _type: "DateTime", value: "2026-11-09T14:06:20.000Z" },
    },
    events: eventsJson(failedRun()),
    mayTryAgain: true,
  };
}

function failedInvestigation(): JSONObject {
  return {
    run: {
      _id: RUN_ID,
      status: AIRunStatus.Error,
      errorMessage: PROVIDER_ERROR,
      toolCallCount: 14,
      totalTokens: 52000,
    },
    events: eventsJson(failedRun()),
    analysisMarkdown: null,
    analysisTldr: null,
    isAnalysisPending: false,
    mayTryAgain: true,
  };
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "ar",
    fallbackLng: "en",
    resources: { ar: { translation: AR } },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
  /*
   * The dates and <html lang dir> follow the language, as the Dashboard's
   * i18n has them (Utils/i18n).
   */
  followLanguageForDates(i18next);
  followLanguageForPage(i18next);
});

beforeEach(() => {
  server = {
    triage: failedTriage(),
    investigation: failedInvestigation(),
    tryAgain: (): Promise<unknown> => {
      throw new Error("Try again was not pressed");
    },
  };
  getItemMock.mockReset();
  getItemMock.mockImplementation(() => {
    return Promise.resolve(buildInsight());
  });
  postMock.mockReset();
  postMock.mockImplementation(
    (request: { url: { toString: () => string } }) => {
      const url: string = request.url.toString();

      if (url.endsWith("/ai-insight/triage-run")) {
        return Promise.resolve(
          new HTTPResponse<JSONObject>(200, server.triage, {}),
        );
      }

      if (url.endsWith("/ai-investigation/incident")) {
        return Promise.resolve(
          new HTTPResponse<JSONObject>(200, server.investigation, {}),
        );
      }

      if (
        url.endsWith("/ai-insight/triage-try-again") ||
        url.endsWith("/ai-investigation/try-again")
      ) {
        return server.tryAgain();
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  );
  jest
    .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
    .mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  resetRemediationStepStub();
});

afterAll(async () => {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage("en");
  });
});

async function renderInsightPage(): Promise<HTMLElement> {
  render(<AIInsightViewPage {...({} as any)} />);
  await screen.findByText(INSIGHT_TITLE);
  await screen.findByText(EVIDENCE);

  const heading: HTMLElement = await screen.findByRole("heading", {
    name: word("AI Triage"),
  });

  return heading.closest("section") as HTMLElement;
}

async function renderInvestigationCard(): Promise<HTMLElement> {
  const { container } = render(
    <InvestigationPanel subjectType="incident" subjectId={INCIDENT_ID} />,
  );

  // Until the card has read its investigation, it says it is checking.
  await waitFor(() => {
    expect(
      screen.getByRole("region", { name: AR["OneUptime AI"] as string }),
    ).toHaveAttribute("aria-busy", "false");
  });

  return container as HTMLElement;
}

describe("the words of the two cards and their steps, in Arabic", () => {
  // The words the issue found English on an Arabic page, and their kin.
  const CARD_WORDS: ReadonlyArray<string> = [
    "AI Investigation",
    "AI Triage",
    "Triage did not finish",
    "Triage complete",
    "Triaging…",
    "Queued — waiting for a worker…",
    "OneUptime AI is investigating",
    "OneUptime AI is checking again",
    "OneUptime AI will try again",
    "What the investigation got through",
    "OneUptime AI looked into this without changing anything: the likely cause, what it affects and what to do first, with the evidence for each.",
    "The investigation stopped before it could report.",
    "The steps this run completed before it stopped.",
    "Investigation activity",
    "Live investigation",
    "Activity",
    "Show {{count}} earlier steps",
    "Show {{count}} earlier steps_one",
    "failed",
    "not done",
    "Running {{tool}}",
    "Executed {{tool}}",
    "Running query",
    "Thinking",
    "Starting investigation",
    "did not succeed — retrying differently",
    "no result came back — it may have run",
    "did not run on the cluster",
    "did not run on the infrastructure",
    "Checking again: alert {{alert}} opened on this incident's infrastructure after the first analysis",
    "Checking again: an alert opened on this incident's infrastructure after the first analysis",
    "Checking again: alert {{alert}} opened on {{resource}} after the first analysis",
    "Checking again: an alert opened on {{resource}} after the first analysis",
  ];

  test("Triage is الفرز, as the glossary has it, and Investigation التحقيق", () => {
    expect(word("AI Triage")).toBe("الفرز بالذكاء الاصطناعي");
    expect(word("Triage did not finish")).toBe("لم يكتمل الفرز");
    expect(word("Triaging…")).toBe("جارٍ الفرز…");
    expect(word("Triage complete")).toBe("اكتمل الفرز");
    expect(word("Investigation")).toBe("التحقيق");
    expect(word("AI Investigation")).toBe("تحقيق الذكاء الاصطناعي");
  });

  test("every word of the cards is Arabic, and keeps its placeholders", () => {
    for (const key of CARD_WORDS) {
      expect({ key, worded: isWordedInDashboardLocale(key, "ar") }).toEqual({
        key,
        worded: true,
      });
      expect({ key, placeholders: placeholdersOf(AR[key] || "") }).toEqual({
        key,
        placeholders: placeholdersOf(EN[key]!),
      });
    }
  });

  test("every step a tool can draw is named in Arabic", () => {
    const names: Array<string> = Array.from(
      new Set<string>(Object.values(friendlyToolNames)),
    );

    // Every toolbox tool has a name (ActivityStepLabelsGuard).
    expect(names.length).toBeGreaterThan(80);

    for (const key of [
      ...names,
      ...Object.values(REFUSED_TOOL_CALL_DETAILS),
      ...Object.values(LINKED_RESOURCE_KIND_NOUNS),
    ]) {
      expect({ key, worded: isWordedInDashboardLocale(key, "ar") }).toEqual({
        key,
        worded: true,
      });
    }

    expect(word(friendlyToolNames["search_code"]!)).toBe(
      "جارٍ البحث في التعليمات البرمجية",
    );
    expect(word(friendlyToolNames["read_code_file"]!)).toBe(
      "جارٍ قراءة ملف تعليمات برمجية",
    );
  });

  test("a tool with no name of its own is run in an Arabic sentence, its name as written", () => {
    expect(
      arabic.translateTemplate("Running {{tool}}", { tool: "custom_probe" }),
    ).toBe(fill(word("Running {{tool}}"), { tool: "custom_probe" }));
    expect(
      arabic.translateTemplate("Running {{tool}}", { tool: "custom_probe" }),
    ).toMatch(/^[^A-Za-z]+custom_probe$/);
  });

  /*
   * i18next reads a count's general form for 0, 2, 3-10, 11-99 and 100+ in
   * Arabic (Locales/ARABIC.md): a label and its count, never a noun that
   * agrees with one count only.
   */
  test.each([2, 5, 11, 100])(
    "%i earlier steps: the general form, in Latin digits",
    (count: number) => {
      expect(
        arabic.translatePlural(
          {
            one: "Show {{count}} earlier steps",
            other: "Show {{count}} earlier steps",
          },
          count,
        ),
      ).toBe(`عرض ${count} من الخطوات السابقة`);
    },
  );
});

describe("the insight's AI Triage, in Arabic, right to left", () => {
  test("the page reads right to left in Arabic", async () => {
    await renderInsightPage();

    expect(document.documentElement).toHaveAttribute("lang", "ar");
    expect(document.documentElement).toHaveAttribute("dir", "rtl");
  });

  test("a triage that did not finish says so in Arabic: its heading, why, the tries, what to do and Try again", async () => {
    const panel: HTMLElement = await renderInsightPage();

    expect(within(panel).getByText(word("AI Triage"))).toBeVisible();
    expect(
      within(panel).getByText(
        word(
          "OneUptime AI looked into this without changing anything: the likely cause, what it affects and what to do first, with the evidence for each.",
        ),
      ),
    ).toBeVisible();

    const failure: HTMLElement = within(panel).getByTestId("ai-triage-failure");
    expect(failure).toHaveTextContent(word("Triage did not finish"));
    expect(
      within(panel).getByTestId("ai-triage-failure-cause"),
    ).toHaveTextContent(
      fill(word("The LLM provider did not answer within {{count}} seconds."), {
        count: "120",
      }),
    );
    expect(
      within(panel).getByTestId("ai-triage-failure-tries"),
    ).toHaveTextContent(
      fill(word("OneUptime tried {{count}} times."), { count: "2" }),
    );
    expect(
      within(panel).getByTestId("ai-triage-failure-fix"),
    ).toHaveTextContent(
      word(
        "If it is a slow or self-hosted model, give it more time: raise the provider's Response Timeout in Project Settings > AI > LLM Providers. Then try again.",
      ),
    );
    expect(
      within(panel).getByTestId("ai-triage-failure-try-again"),
    ).toHaveTextContent(word("Try again"));
    expect(
      within(panel).getByTestId("ai-triage-failure-details-toggle"),
    ).toHaveTextContent(word("Details"));
  });

  test("its steps are Arabic: the heading, the tools, a failed read, a model call that failed and the earlier ones folded", async () => {
    const panel: HTMLElement = await renderInsightPage();
    const activity: HTMLElement =
      within(panel).getByTestId("ai-triage-activity");

    expect(
      within(activity).getByRole("heading", { name: word("Activity") }),
    ).toBeVisible();

    const steps: Array<string> = within(activity)
      .getAllByTestId("activity-step-text")
      .map((step: HTMLElement): string => {
        return step.textContent || "";
      });

    expect(steps).toEqual(
      expect.arrayContaining([
        expect.stringContaining(word("Searching code")),
        expect.stringContaining(word("Reading a code file")),
        expect.stringContaining(word("Thinking")),
      ]),
    );
    // The model's last call: "Thinking · failed" in English.
    expect(activity).toHaveTextContent(word("failed"));

    // Eight steps show; the rest of the attempt folds under one button.
    const showEarlier: HTMLElement = within(activity).getByTestId(
      "activity-show-earlier",
    );
    const hidden: string = (showEarlier.textContent || "").replace(/\D/g, "");

    expect(Number(hidden)).toBeGreaterThan(1);
    expect(showEarlier).toHaveTextContent(
      fill(word("Show {{count}} earlier steps"), { count: hidden }),
    );

    // Opened, the folded steps are Arabic too: the read that failed says the model tries another way.
    fireEvent.click(showEarlier);
    expect(activity).toHaveTextContent(
      word("did not succeed — retrying differently"),
    );

    // The first attempt, folded: its number, how it ended and its steps.
    expect(
      within(activity).getByTestId("activity-attempt-toggle"),
    ).toHaveTextContent(
      fill(word("Attempt {{number}} of {{count}}"), {
        number: "1",
        count: "2",
      }),
    );
    expect(
      within(activity).getByTestId("activity-attempt-toggle"),
    ).toHaveTextContent(word("did not finish"));
  });

  /*
   * A step says its time of day, and its date and time on hover; the run
   * says when it started. Each names the month in Arabic, in Latin digits
   * (Locales/ARABIC.md): the hover read "Nov 9, 14:00:05" among the Arabic
   * steps on a page whose dates did not follow its language.
   */
  test("each step says when it happened in Arabic, and the run when it started", async () => {
    const panel: HTMLElement = await renderInsightPage();
    const november: string = new Intl.DateTimeFormat("ar", {
      month: "short",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(2026, 10, 9)));

    expect(november).not.toMatch(/[A-Za-z]/);

    const times: Array<HTMLElement> =
      within(panel).getAllByTestId("activity-step-time");

    expect(times.length).toBeGreaterThan(0);

    for (const time of times) {
      expect(time.textContent).toMatch(/^14:0\d:\d\d$/);
      expect(time.getAttribute("title")).toContain(november);
      expect(time.getAttribute("title")).toMatch(/14:0\d:\d\d/);
      // Arabic-Indic digits, which OneUptime's Arabic does not write.
      expect(time.getAttribute("title")).not.toMatch(/[A-Za-z٠-٩]/);
    }

    const summary: HTMLElement = within(panel).getByTestId(
      "activity-run-summary",
    );

    expect(summary.textContent).toMatch(
      new RegExp(`^${fill(word("Started {{time}}"), { time: "" }).trim()} `),
    );
    expect(summary).toHaveTextContent(november);
    expect(summary.textContent).not.toMatch(/[A-Za-z]/);
  });

  test("no English on it but the product's name, LLM and the provider's own error under Details", async () => {
    const panel: HTMLElement = await renderInsightPage();
    const details: HTMLElement = within(panel).getByTestId(
      "ai-triage-failure-details",
    );

    // Every fold open: the earlier steps, the first attempt and its steps.
    fireEvent.click(within(panel).getByTestId("activity-show-earlier"));
    fireEvent.click(within(panel).getByTestId("activity-attempt-toggle"));
    fireEvent.click(
      within(panel).getByTestId("ai-triage-failure-details-toggle"),
    );

    expect(details).toBeVisible();
    expect(details).toHaveTextContent(PROVIDER_ERROR);
    expect(englishOn(panel, [details])).toEqual([]);
    // The check reads the panel: Arabic, and the steps of both attempts.
    expect(piecesOf(panel, [details]).join(" ")).toContain(
      word("Reading a code file"),
    );
    expect(
      within(panel).getAllByTestId("activity-step-text").length,
    ).toBeGreaterThan(16);
  });

  /*
   * The provider's error, and a refusal of Try again the Dashboard does
   * not word, are English whatever the reader's language: laid out right
   * to left, as the page is, an English line has its full stop at its
   * start. The provider's error is laid out by its own first letter
   * (dir="auto"), an English refusal from the left (dir="ltr"), and a
   * refusal in Arabic - the code's words, or the button's own - reads
   * right to left, as the page does, whatever its first letter.
   */
  test("the provider's error under Details is laid out by its own first letter", async () => {
    const panel: HTMLElement = await renderInsightPage();

    expect(
      within(panel).getByTestId("ai-triage-failure-details"),
    ).toHaveAttribute("dir", "auto");
  });

  test.each(tryAgainRefusals(TRIAGE_REFUSAL, AiRunRefusalCode.TriageFinished))(
    "Try again refused - %s - reads in its own words' direction",
    async (
      _refusal: string,
      answer: () => Promise<unknown>,
      said: () => string,
      dir: string | null,
    ) => {
      server.tryAgain = answer;
      const panel: HTMLElement = await renderInsightPage();

      await act(async () => {
        fireEvent.click(
          within(panel).getByTestId("ai-triage-failure-try-again"),
        );
      });

      const refusal: HTMLElement = within(panel).getByTestId(
        "ai-triage-failure-try-again-error",
      );
      expect(refusal).toHaveAttribute("role", "alert");
      expect(refusal).toHaveTextContent(said());
      expect(refusal.getAttribute("dir")).toBe(dir);
      // Around it, the card is still Arabic.
      expect(
        englishOn(panel, [
          within(panel).getByTestId("ai-triage-failure-details"),
          refusal,
        ]),
      ).toEqual([]);
    },
  );

  test.each([
    [AIRunStatus.Running, "Triaging…"],
    [AIRunStatus.Queued, "Queued — waiting for a worker…"],
    [AIRunStatus.Completed, "Triage complete"],
  ])(
    "a %s triage says where it stands in Arabic, and no English",
    async (status: AIRunStatus, words: string) => {
      server.triage = {
        run: { _id: RUN_ID, status },
        events: eventsJson([
          { eventType: AIRunEventType.RunStarted },
          ...thinking(),
          ...tool("search_logs", 7),
          ...(status === AIRunStatus.Running
            ? [{ eventType: AIRunEventType.LlmCallStarted }]
            : []),
        ]),
        mayTryAgain: false,
      };

      const panel: HTMLElement = await renderInsightPage();

      expect(within(panel).getByTestId("ai-triage-status")).toHaveTextContent(
        word(words),
      );
      expect(englishOn(panel)).toEqual([]);
    },
  );

  test("a triage waiting to try again by itself says when in Arabic", async () => {
    const retryAt: Date = new Date(Date.now() + 10 * 60 * 1000);
    server.triage = {
      run: {
        _id: RUN_ID,
        status: AIRunStatus.Queued,
        retryAt: retryAt.toISOString(),
      },
      events: eventsJson([
        ...attempt(),
        attemptEnd(
          AIRunEventType.AttemptEnded,
          AIRunAttemptOutcome.WillRetry,
          1,
        ),
      ]),
      mayTryAgain: false,
    };

    const panel: HTMLElement = await renderInsightPage();

    expect(within(panel).getByTestId("ai-triage-status")).toHaveTextContent(
      fill(word("Trying again at {{time}}"), {
        time: OneUptimeDate.getLocalTimeString(retryAt, {
          use12HourFormat: false,
        }),
      }),
    );
    expect(englishOn(panel)).toEqual([]);
  });
});

describe("the AI investigation card, in Arabic", () => {
  test("an investigation that did not finish: its pill, why, what it got through and its steps in Arabic", async () => {
    const card: HTMLElement = await renderInvestigationCard();
    const step: HTMLElement = screen.getByTestId("ai-card-step-investigation");

    expect(step).toHaveTextContent(word("Investigation"));
    expect(step).toHaveTextContent(word("Did not finish"));
    expect(screen.getByTestId("investigation-error")).toHaveTextContent(
      word("The investigation stopped before it could report."),
    );
    expect(screen.getByTestId("investigation-error-cause")).toHaveTextContent(
      fill(word("The LLM provider did not answer within {{count}} seconds."), {
        count: "120",
      }),
    );
    expect(
      screen.getByTestId("investigation-error-try-again"),
    ).toHaveTextContent(word("Try again"));
    expect(
      screen.getByRole("heading", {
        name: word("What the investigation got through"),
      }),
    ).toBeVisible();
    expect(
      screen.getByText(word("The steps this run completed before it stopped.")),
    ).toBeVisible();
    expect(
      screen.getByRole("region", { name: word("Investigation activity") }),
    ).toBeVisible();
    expect(card).toHaveTextContent(word("Searching code"));
    expect(card).toHaveTextContent(word("Reading a code file"));
  });

  test("no English on it but the product's name, LLM and the provider's own error under Details", async () => {
    const card: HTMLElement = await renderInvestigationCard();
    const details: HTMLElement = screen.getByTestId(
      "investigation-error-details",
    );

    for (const fold of [
      "activity-show-earlier",
      "activity-attempt-toggle",
      "investigation-error-details-toggle",
    ]) {
      fireEvent.click(screen.getByTestId(fold));
    }

    expect(details).toBeVisible();
    expect(details).toHaveTextContent(PROVIDER_ERROR);
    expect(englishOn(card, [details])).toEqual([]);
    expect(piecesOf(card, [details]).join(" ")).toContain(
      word("What OneUptime AI found, and what it is doing about it."),
    );
  });

  /*
   * The provider's error, and a refusal of Try again the Dashboard does
   * not word, are English whatever the reader's language: laid out right
   * to left, as the page is, an English line has its full stop at its
   * start. The provider's error is laid out by its own first letter
   * (dir="auto"), an English refusal from the left (dir="ltr"), and a
   * refusal in Arabic - the code's words, or the button's own - reads
   * right to left, as the page does, whatever its first letter.
   */
  test("the provider's error under Details is laid out by its own first letter", async () => {
    await renderInvestigationCard();

    expect(screen.getByTestId("investigation-error-details")).toHaveAttribute(
      "dir",
      "auto",
    );
  });

  test.each(
    tryAgainRefusals(
      INVESTIGATION_REFUSAL,
      AiRunRefusalCode.IncidentInvestigationRunning,
    ),
  )(
    "Try again refused - %s - reads in its own words' direction",
    async (
      _refusal: string,
      answer: () => Promise<unknown>,
      said: () => string,
      dir: string | null,
    ) => {
      server.tryAgain = answer;
      const card: HTMLElement = await renderInvestigationCard();

      await act(async () => {
        fireEvent.click(screen.getByTestId("investigation-error-try-again"));
      });

      const refusal: HTMLElement = screen.getByTestId(
        "investigation-error-try-again-error",
      );
      expect(refusal).toHaveAttribute("role", "alert");
      expect(refusal).toHaveTextContent(said());
      expect(refusal.getAttribute("dir")).toBe(dir);
      // Around it, the card is still Arabic.
      expect(
        englishOn(card, [
          screen.getByTestId("investigation-error-details"),
          refusal,
        ]),
      ).toEqual([]);
    },
  );

  test.each([
    ["running", "OneUptime AI is investigating"],
    ["checking again", "OneUptime AI is checking again"],
  ])(
    "a %s investigation is headed in Arabic, its live steps too",
    async (state: string, heading: string) => {
      server.investigation = {
        run: { _id: RUN_ID, status: AIRunStatus.Running },
        events: eventsJson([
          { eventType: AIRunEventType.RunStarted },
          ...(state === "checking again"
            ? [
                {
                  eventType: AIRunEventType.ProgressLog,
                  resultSummary: {
                    followUpCheck: {
                      alertNumber: 12,
                      resourceKind: "",
                      resourceName: "",
                      minutesAfterIncident: 4,
                    },
                  },
                },
              ]
            : []),
          ...thinking(),
          {
            eventType: AIRunEventType.ToolCallStarted,
            toolName: "search_logs",
          },
        ]),
        analysisMarkdown: null,
        isAnalysisPending: false,
      };

      const card: HTMLElement = await renderInvestigationCard();

      expect(
        screen.getByRole("heading", { name: word(heading) }),
      ).toBeVisible();
      expect(
        screen.getByRole("region", { name: word("Live investigation") }),
      ).toBeVisible();
      expect(card).toHaveTextContent(word("Searching logs"));

      if (state === "checking again") {
        expect(card).toHaveTextContent(
          fill(
            word(
              "Checking again: alert {{alert}} opened on this incident's infrastructure after the first analysis",
            ),
            { alert: "#12" },
          ),
        );
      }

      expect(englishOn(card)).toEqual([]);
    },
  );

  test("a queued investigation waits for a worker in Arabic", async () => {
    server.investigation = {
      run: { _id: RUN_ID, status: AIRunStatus.Queued },
      events: [],
      analysisMarkdown: null,
      isAnalysisPending: false,
    };

    const card: HTMLElement = await renderInvestigationCard();

    expect(card).toHaveTextContent(
      word(
        "Waiting for a worker to pick this up. Steps appear here the moment it starts.",
      ),
    );
    expect(englishOn(card)).toEqual([]);
  });
});
