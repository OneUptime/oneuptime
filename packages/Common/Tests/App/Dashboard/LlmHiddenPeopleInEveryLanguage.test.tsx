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
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * ---------------------------------------------------------------------------
 * "Hidden by a scrub rule", in every Dashboard language (#10631)
 * ---------------------------------------------------------------------------
 *
 * A call whose email and id a scrub rule both redacted names nobody anyone
 * can read, and Conversations and Calls used to draw what the rule left -
 * "[REDACTED]" - as if it were a person. They now say "Hidden by a scrub
 * rule", the Usage tab's words for its hidden row (#10435). A German,
 * Japanese or Arabic reader meets them in their own language: drawn in the
 * real components under each language's own i18next instance, built from
 * the locale files the Dashboard ships (TracesLanguageHarness), in the
 * Calls table's User and Team cells and their export, and in a
 * conversation's row.
 */

type CapturedColumn = {
  title: string;
  getElement?: ((item: Span) => React.ReactElement) | undefined;
  getExportValue?: ((item: Span) => string) | undefined;
};

type CapturedTableProps = {
  columns?: Array<CapturedColumn>;
};

let capturedTableProps: CapturedTableProps | null = null;

// The table's configuration is what is read; the real table would fetch on mount.
jest.mock("../../../UI/Components/ModelTable/AnalyticsModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps) => {
      capturedTableProps = props;
      return null;
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: () => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
      },
    },
  };
});

import LlmCallsTable from "../../../../App/FeatureSet/Dashboard/src/Components/AI/LlmCallsTable";
import LlmConversationRow from "../../../../App/FeatureSet/Dashboard/src/Components/LlmConversations/LlmConversationRow";
import {
  LLM_HIDDEN_BY_A_SCRUB_RULE,
  LLM_HIDDEN_BY_A_SCRUB_RULE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/LlmConversations/LlmHiddenByScrubRule";
import Span from "../../../Models/AnalyticsModels/Span";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import { LLM_USAGE_HIDDEN_GROUP_KEY } from "../../../Types/Telemetry/LlmUsageApi";
import ProjectUtil from "../../../UI/Utils/Project";
import { PROJECT_ID, listItem } from "./LlmConversationFixtures";
import {
  LANGUAGES,
  LOCALES,
  OTHER_LANGUAGES,
  createLanguageInstances,
  hasOwnWording,
  inLanguage,
  textOf,
} from "./TracesLanguageHarness";

const ROUTE: Route = new Route(
  `/dashboard/${PROJECT_ID}/llm/conversations/c%3Achat-1`,
);

// A call whose email and id a scrub rule redacted, and its team too.
function redactedCall(): Span {
  const span: Span = new Span();

  span.llmUserEmail = "[REDACTED]";
  span.llmUserId = "[REDACTED]";
  span.llmTeam = "[REDACTED]";

  return span;
}

// The words as the language's locale file has them.
function hiddenWords(language: string): string {
  return language === "en"
    ? LLM_HIDDEN_BY_A_SCRUB_RULE
    : ((LOCALES[language] as Record<string, unknown>)[
        LLM_HIDDEN_BY_A_SCRUB_RULE
      ] as string);
}

// The Calls table's column, as the table is drawn in the language.
async function callsColumn(
  language: string,
  title: string,
): Promise<CapturedColumn> {
  await act(async (): Promise<void> => {
    render(
      inLanguage(
        language,
        <MemoryRouter>
          <LlmCallsTable />
        </MemoryRouter>,
      ),
    );
  });

  const column: CapturedColumn | undefined = capturedTableProps?.columns?.find(
    (candidate: CapturedColumn): boolean => {
      return candidate.title === title;
    },
  );

  expect(column).toBeDefined();

  return column!;
}

beforeAll(async () => {
  await createLanguageInstances();
});

beforeEach(() => {
  capturedTableProps = null;
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the words", () => {
  test("are the Usage tab's, a key of the Dashboard's English", () => {
    expect(LLM_HIDDEN_BY_A_SCRUB_RULE).toBe("Hidden by a scrub rule");
    expect(
      (LOCALES["en"] as Record<string, unknown>)[LLM_HIDDEN_BY_A_SCRUB_RULE],
    ).toBe(LLM_HIDDEN_BY_A_SCRUB_RULE);
  });

  test.each(OTHER_LANGUAGES)(
    "%s words them its own way",
    (language: string) => {
      expect(hasOwnWording(language, LLM_HIDDEN_BY_A_SCRUB_RULE)).toBe(true);
      expect(hiddenWords(language)).not.toBe(LLM_HIDDEN_BY_A_SCRUB_RULE);
    },
  );
});

describe.each(LANGUAGES)("in %s", (language: string) => {
  test("a call whose email and id a rule redacted says so in its User cell, and its export", async () => {
    const column: CapturedColumn = await callsColumn(language, "User");
    const cell: React.ReactElement = column.getElement!(redactedCall());

    cleanup();
    render(inLanguage(language, cell));

    expect(textOf(screen.getByTestId(LLM_HIDDEN_BY_A_SCRUB_RULE_TEST_ID))).toBe(
      hiddenWords(language),
    );
    expect(document.body).not.toHaveTextContent("[REDACTED]");
    expect(column.getExportValue!(redactedCall())).toBe(hiddenWords(language));
  });

  test("a team a rule redacted says so in its Team cell, and its export", async () => {
    const column: CapturedColumn = await callsColumn(language, "Team");
    const cell: React.ReactElement = column.getElement!(redactedCall());

    cleanup();
    render(inLanguage(language, cell));

    expect(textOf(screen.getByTestId(LLM_HIDDEN_BY_A_SCRUB_RULE_TEST_ID))).toBe(
      hiddenWords(language),
    );
    expect(column.getExportValue!(redactedCall())).toBe(hiddenWords(language));
  });

  test("a conversation whose every person a rule hid says so in its row", () => {
    render(
      inLanguage(
        language,
        <MemoryRouter>
          <LlmConversationRow
            conversation={listItem({ people: [LLM_USAGE_HIDDEN_GROUP_KEY] })}
            route={ROUTE}
            serviceNames={new Map<string, string>()}
          />
        </MemoryRouter>,
      ),
    );

    const person: Element | null = screen
      .getByTestId("llm-conversation-row-facts")
      .querySelector('[data-fact="person"]');

    expect(textOf(person)).toBe(hiddenWords(language));
    expect(screen.getByTestId("llm-conversation-row")).not.toHaveTextContent(
      "[REDACTED]",
    );
  });
});
