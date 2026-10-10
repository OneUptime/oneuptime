import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorTable",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

import LlmAlertsView from "../../../../App/FeatureSet/Dashboard/src/Components/LlmAlerts/LlmAlertsView";
import LlmSummaryTiles from "../../../../App/FeatureSet/Dashboard/src/Components/LlmConversations/LlmSummaryTiles";
import LlmIssueBadge from "../../../../App/FeatureSet/Dashboard/src/Components/LlmConversations/LlmIssueBadge";
import LlmReplayBar from "../../../../App/FeatureSet/Dashboard/src/Components/LlmConversations/LlmReplayBar";
import LlmConversationRow from "../../../../App/FeatureSet/Dashboard/src/Components/LlmConversations/LlmConversationRow";
import { LlmConversationReplayController } from "../../../../App/FeatureSet/Dashboard/src/Components/LlmConversations/useLlmConversationReplay";
import { LLM_MONITOR_TEMPLATE_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/LlmAlerts/LlmMonitorTemplateCopy";
import LlmConversationReplay from "../../../Utils/Telemetry/LlmConversationReplay";
import { LlmTranscriptStepType } from "../../../Utils/Telemetry/LlmConversationTranscript";
import { LlmAnswerIssue } from "../../../Types/Telemetry/LlmAnswerIssue";
import { emptyIssueCounts } from "../../../Types/Telemetry/LlmConversationApi";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  PROJECT_ID,
  T0,
  listItem,
  makeStep,
  summary,
} from "./LlmConversationFixtures";

/*
 * The AI / LLM pages in the reader's language, from the locale files the
 * Dashboard ships: German, Russian (whose plurals have more than two forms)
 * and Japanese (whose have one). Each expectation is read from the locale
 * file itself, so these hold the pages to the translations - every string
 * routed through the translator, every plural through its forms - rather
 * than to a copy of them.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const LOCALES: Record<string, Record<string, string>> = {
  de: readLocale("de"),
  ru: readLocale("ru"),
  ja: readLocale("ja"),
};

function word(
  locale: string,
  key: string,
  values: Record<string, string> = {},
): string {
  let value: string = LOCALES[locale]![key] || key;

  for (const [name, replacement] of Object.entries(values)) {
    value = value.split(`{{${name}}}`).join(replacement);
  }

  return value;
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "de",
    fallbackLng: "de",
    resources: {
      de: { translation: LOCALES["de"]! },
      ru: { translation: LOCALES["ru"]! },
      ja: { translation: LOCALES["ja"]! },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(() => {
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest
    .spyOn(PermissionGate, "gateCardButton")
    .mockImplementation((button: unknown): never => {
      return button as never;
    });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe.each(["de", "ru", "ja"])("in %s", (locale: string) => {
  beforeEach(async () => {
    await i18next.changeLanguage(locale);
  });

  test("the Alerts tab: the heading, every card and its link", () => {
    render(
      <MemoryRouter>
        <LlmAlertsView />
      </MemoryRouter>,
    );

    const page: HTMLElement = screen.getByTestId("llm-alerts-view");

    expect(page).toHaveTextContent(
      word(locale, "Get told when your AI answers badly"),
    );

    for (const copy of Object.values(LLM_MONITOR_TEMPLATE_COPY)) {
      expect(page).toHaveTextContent(word(locale, copy.title));
      expect(page).toHaveTextContent(word(locale, copy.description));
      expect(page).not.toHaveTextContent(copy.description);
    }

    expect(page).toHaveTextContent(word(locale, "Create alert"));
    expect(page).toHaveTextContent(word(locale, "Spend goes over budget"));
    expect(page).not.toHaveTextContent("Get told when your AI answers badly");
  });

  test("the five numbers above the list", () => {
    render(<LlmSummaryTiles summary={summary()} isLoading={false} />);

    const tiles: HTMLElement = screen.getByTestId("llm-summary-tiles");

    for (const label of [
      "Conversations",
      "AI answers",
      "Need attention",
      "Cost",
      "Typical answer time",
    ]) {
      expect(tiles).toHaveTextContent(word(locale, label));
    }

    expect(tiles).toHaveTextContent(
      word(locale, "Slowest 5%: {{duration}}", { duration: "9.1 s" }),
    );
    expect(tiles).not.toHaveTextContent("Typical answer time");
  });

  test("a count in the plural the language uses", () => {
    render(<LlmIssueBadge issue={LlmAnswerIssue.Refused} count={3} />);

    // Three: the general form in every one of these languages.
    expect(screen.getByTestId("llm-issue-badge-refused")).toHaveTextContent(
      word(locale, "{{count}} refusals", { count: "3" }),
    );

    cleanup();

    render(<LlmIssueBadge issue={LlmAnswerIssue.Refused} count={1} />);

    // One: the "one" form where the language has one; Japanese has none.
    expect(screen.getByTestId("llm-issue-badge-refused")).toHaveTextContent(
      word(
        locale,
        locale === "ja" ? "{{count}} refusals" : "{{count}} refusals_one",
        {
          count: "1",
        },
      ),
    );
  });

  test("Russian's one form also covers 21", () => {
    render(<LlmIssueBadge issue={LlmAnswerIssue.Refused} count={21} />);

    expect(screen.getByTestId("llm-issue-badge-refused")).toHaveTextContent(
      word(
        locale,
        locale === "ru" ? "{{count}} refusals_one" : "{{count}} refusals",
        {
          count: "21",
        },
      ),
    );
  });

  test("a conversation row", () => {
    render(
      <MemoryRouter>
        <LlmConversationRow
          conversation={listItem({
            answerCount: 5,
            issueCounts: { ...emptyIssueCounts(), [LlmAnswerIssue.Failed]: 2 },
          })}
          route={
            new Route(`/dashboard/${PROJECT_ID}/llm/conversations/c%3Achat-1`)
          }
          serviceNames={new Map<string, string>()}
        />
      </MemoryRouter>,
    );

    const row: HTMLElement = screen.getByTestId("llm-conversation-row");

    expect(row).toHaveTextContent(
      word(locale, "{{count}} answers", { count: "5" }),
    );
    expect(row).toHaveTextContent(
      word(locale, "{{count}} failed calls", { count: "2" }),
    );
  });

  test("the replay's transport", () => {
    const steps: ReturnType<typeof makeStep>[] = [
      makeStep(LlmTranscriptStepType.UserMessage, { atMs: T0, text: "Hi" }),
      makeStep(LlmTranscriptStepType.AssistantMessage, {
        atMs: T0 + 2000,
        text: "Hello",
      }),
    ];
    const timeline: LlmConversationReplayController["timeline"] =
      LlmConversationReplay.buildTimeline(steps, { skipWaiting: true });
    const noop: () => void = (): void => {};

    render(
      <LlmReplayBar
        steps={steps}
        controller={{
          timeline: timeline,
          clockMs: timeline.durationMs,
          isPlaying: false,
          speed: 1,
          skipWaiting: true,
          visibleCount: 2,
          currentIndex: 1,
          isAtEnd: true,
          realTimeMs: T0,
          play: noop,
          pause: noop,
          togglePlay: noop,
          next: noop,
          previous: noop,
          restart: noop,
          goToEnd: noop,
          goToStep: noop,
          seekToProgress: noop,
          cycleSpeed: noop,
          setSkipWaiting: noop,
        }}
      />,
    );

    expect(screen.getByTestId("llm-replay-play")).toHaveTextContent(
      word(locale, "Replay"),
    );
    expect(screen.getByTestId("llm-replay-position")).toHaveTextContent(
      word(locale, "Message {{position}} of {{total}}", {
        position: "2",
        total: "2",
      }),
    );
    expect(screen.getByTestId("llm-replay-skip-waiting")).toHaveTextContent(
      word(locale, "Skip waiting"),
    );
    expect(screen.getByTestId("llm-replay-scrubber")).toHaveAttribute(
      "aria-label",
      word(locale, "Replay position"),
    );
  });
});
