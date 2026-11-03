import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";
import ToolApprovalCard from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ToolApprovalCard";
import {
  AI_ACTION_LINES,
  AI_ACTION_PLURAL_TITLES,
  AI_ACTION_TERMS,
  AI_ACTION_TITLES,
  AIActionWords,
  aiActionList,
  aiActionPluralSentence,
  aiActionResourceByName,
  aiActionSentence,
  aiActionTerm,
  describeAIActionWords,
} from "../../../Types/AI/AIActionWords";
import {
  AIChatToolAction,
  AIChatToolActionStatus,
} from "../../../Types/AI/AIChatTypes";
import { JSONObject } from "../../../Types/JSON";
import {
  FIRST_STRONG_ISOLATE,
  POP_DIRECTIONAL_ISOLATE,
} from "../../../Types/ReadingDirection";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { isolated, withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * THE APPROVAL CARD IN THE READER'S LANGUAGE.
 *
 * Before OneUptime AI changes anything, Ask AI and an incident's or
 * alert's conversation show the action for the person to allow or skip.
 * Its title and the line under it were the server's English, in the
 * middle of a German or Persian page. The server now stores them as
 * sentences (Types/AI/AIActionWords) beside the English, and the card
 * says each in the reader's language, from the shipped locale files: the
 * title, the line, the card's own words, and the rows of what was decided
 * - with the incident's number, the host's name and the title the model
 * wrote as data inside them, never translated. An action saved before
 * the sentences, or words that are not the module's, read the stored
 * English as they always did.
 */

const DE: Record<string, string> = readDashboardLocale("de");
const FA: Record<string, string> = readDashboardLocale("fa");
const JA: Record<string, string> = readDashboardLocale("ja");

const INCIDENT_ID: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const HOST_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

// A template of the locale filled with values, as the card fills it.
function fill(
  words: Record<string, string>,
  key: string,
  values: Record<string, string | number>,
): string {
  let text: string | undefined = words[key];

  expect({ key, worded: Boolean(text) }).toEqual({ key, worded: true });

  for (const name of Object.keys(values)) {
    text = text!.split(`{{${name}}}`).join(String(values[name]));
  }

  return text!;
}

// The action as the server stores it: its sentences and their English.
function stored(
  words: AIActionWords,
  overrides: Partial<AIChatToolAction> = {},
): AIChatToolAction {
  const english: { title: string; description?: string | undefined } =
    describeAIActionWords(words);

  return {
    id: "call-declare",
    toolName: "create_incident",
    title: english.title,
    ...(english.description ? { description: english.description } : {}),
    words,
    arguments: {
      title: "Checkout down",
      severityName: "SEV2",
      affectedResources: [{ resourceType: "Host", resourceId: HOST_ID }],
    },
    isMutation: true,
    requiresApproval: true,
    status: AIChatToolActionStatus.Pending,
    ...overrides,
  };
}

const DECLARE_WORDS: AIActionWords = {
  title: aiActionSentence(AI_ACTION_TITLES.createIncident, {
    title: "Checkout down",
  }),
  description: [
    aiActionSentence(AI_ACTION_LINES.linkedTo, {
      resources: aiActionList([
        aiActionResourceByName({ noun: "host", name: "test01" }),
      ]),
    }),
  ],
};

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

// An acknowledge whose prepare read the incident's number.
const ACKNOWLEDGE_WORDS: AIActionWords = {
  title: aiActionSentence(AI_ACTION_TITLES.acknowledgeIncident, {
    incident: "INC-42",
  }),
  namedArguments: ["incidentId"],
};

function acknowledge(
  overrides: Partial<AIChatToolAction> = {},
): AIChatToolAction {
  return stored(ACKNOWLEDGE_WORDS, {
    id: "call-acknowledge",
    toolName: "acknowledge_incident",
    arguments: { incidentId: INCIDENT_ID, note: "Looking into it" },
    ...overrides,
  });
}

function renderCard(
  toolActions: Array<AIChatToolAction>,
  interactive: boolean = true,
): void {
  render(
    <ToolApprovalCard
      toolActions={toolActions}
      interactive={interactive}
      isSubmitting={false}
      onRespond={() => {}}
    />,
  );
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "de",
    fallbackLng: "en",
    resources: {
      de: { translation: DE },
      fa: { translation: FA },
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

describe("in German", () => {
  beforeAll(async () => {
    await inLanguage("de");
  });

  test("the title and its line are German, the title the model wrote and the host's name as written", () => {
    renderCard([stored(DECLARE_WORDS)]);

    expect(screen.getByTestId("tool-approval-title")).toHaveTextContent(
      fill(DE, "Create incident: {{title}}", { title: "Checkout down" }),
    );
    expect(screen.getByTestId("tool-approval-title")).toHaveTextContent(
      "Vorfall erstellen: Checkout down",
    );
    expect(screen.getByTestId("tool-approval-description")).toHaveTextContent(
      fill(DE, "Linked to {{resources}}.", {
        resources: `${DE["host"]} "test01"`,
      }),
    );
    // Never the server's English.
    expect(screen.queryByText(/Create incident/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Linked to/)).not.toBeInTheDocument();
  });

  test("each sentence is read as German left to right", () => {
    renderCard([stored(DECLARE_WORDS)]);

    const title: HTMLElement = within(
      screen.getByTestId("tool-approval-title"),
    ).getByText(/Vorfall erstellen/);
    expect(title.tagName).toBe("BDI");
    expect(title).toHaveAttribute("dir", "ltr");
  });

  test("the card's own words are German, one action and several", () => {
    renderCard([stored(DECLARE_WORDS)]);

    expect(
      screen.getByText(
        fill(DE, "The AI wants to perform {{count}} actions_one", {
          count: 1,
        }),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: DE["Allow"]! }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: DE["Skip"]! }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: fill(DE, "Run {{count}} actions_one", { count: 1 }),
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: DE["Deny all"]! }),
    ).toBeInTheDocument();

    cleanup();
    renderCard([stored(DECLARE_WORDS), acknowledge()]);

    expect(
      screen.getByText(
        fill(DE, "The AI wants to perform {{count}} actions", { count: 2 }),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: fill(DE, "Run {{count}} actions", { count: 2 }),
      }),
    ).toBeInTheDocument();

    // Skipping both turns the run into Skip all.
    for (const skip of screen.getAllByRole("button", { name: DE["Skip"]! })) {
      fireEvent.click(skip);
    }
    expect(
      screen.getByRole("button", { name: DE["Skip all"]! }),
    ).toBeInTheDocument();
  });

  test("each Allow and Skip pair is named after its action, in German", () => {
    renderCard([stored(DECLARE_WORDS), acknowledge()]);

    expect(
      screen.getByRole("group", { name: "Vorfall erstellen: Checkout down" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("group", {
        name: fill(DE, "Acknowledge incident {{incident}}", {
          incident: "INC-42",
        }),
      }),
    ).toBeInTheDocument();
  });

  test("an incident named by its number: the title says it, and its ID is left out of the arguments", () => {
    renderCard([acknowledge()]);

    expect(screen.getByTestId("tool-approval-title")).toHaveTextContent(
      "Vorfall INC-42 bestätigen",
    );

    const argumentsLine: HTMLElement = screen.getByTestId(
      "tool-approval-arguments",
    );
    expect(argumentsLine).not.toHaveTextContent(INCIDENT_ID);
    expect(argumentsLine).not.toHaveTextContent("incidentId");
    expect(argumentsLine).toHaveTextContent("note: Looking into it");
  });

  test("an incident the prepare could not read is named by its ID in the title, not again in the arguments", () => {
    renderCard([
      acknowledge({
        words: {
          title: aiActionSentence(AI_ACTION_TITLES.acknowledgeIncident, {
            incident: INCIDENT_ID,
          }),
        },
      }),
    ]);

    // Named by its ID only: the title shows it, so the line need not.
    expect(screen.getByTestId("tool-approval-title")).toHaveTextContent(
      fill(DE, "Acknowledge incident {{incident}}", { incident: INCIDENT_ID }),
    );
    const argumentsLine: HTMLElement = screen.getByTestId(
      "tool-approval-arguments",
    );
    expect(argumentsLine).not.toHaveTextContent("incidentId");
    expect(argumentsLine).toHaveTextContent("note: Looking into it");
  });

  test("the argument line leaves out the title the incident takes, and the lists the line names", () => {
    renderCard([stored(DECLARE_WORDS)]);

    const argumentsLine: HTMLElement = screen.getByTestId(
      "tool-approval-arguments",
    );
    expect(argumentsLine).toHaveTextContent("severityName: SEV2");
    expect(argumentsLine).not.toHaveTextContent("title: Checkout down");
    expect(argumentsLine).not.toHaveTextContent(HOST_ID);
  });

  test("a commit counts its files the German way, onto a branch or 'a branch'", () => {
    renderCard([
      stored(
        {
          title: aiActionPluralSentence(
            AI_ACTION_PLURAL_TITLES.commitFiles,
            1,
            {
              branch: "fix/checkout",
            },
          ),
        },
        { id: "call-commit-1", toolName: "commit_code_to_branch" },
      ),
      stored(
        {
          title: aiActionPluralSentence(
            AI_ACTION_PLURAL_TITLES.commitFiles,
            3,
            {
              branch: aiActionTerm(AI_ACTION_TERMS.aBranch),
            },
          ),
        },
        { id: "call-commit-3", toolName: "commit_code_to_branch" },
      ),
    ]);

    const titles: Array<HTMLElement> = screen.getAllByTestId(
      "tool-approval-title",
    );
    expect(titles[0]).toHaveTextContent(
      fill(DE, "Commit {{count}} files to {{branch}}_one", {
        count: 1,
        branch: "fix/checkout",
      }),
    );
    expect(titles[1]).toHaveTextContent(
      fill(DE, "Commit {{count}} files to {{branch}}", {
        count: 3,
        branch: DE["a branch"]!,
      }),
    );
  });

  test("a call that gave no title is called Untitled, in German", () => {
    renderCard([
      stored({
        title: aiActionSentence(AI_ACTION_TITLES.createIncident, {
          title: aiActionTerm(AI_ACTION_TERMS.untitled),
        }),
      }),
    ]);

    expect(screen.getByTestId("tool-approval-title")).toHaveTextContent(
      fill(DE, "Create incident: {{title}}", { title: DE["Untitled"]! }),
    );
  });

  test("a decided action's row says its status and its title in German", () => {
    renderCard(
      [
        stored(DECLARE_WORDS, { status: AIChatToolActionStatus.Executed }),
        acknowledge({ status: AIChatToolActionStatus.Denied }),
      ],
      false,
    );

    const rows: Array<HTMLElement> = screen.getAllByTestId(
      "tool-approval-history-title",
    );
    expect(rows[0]).toHaveTextContent("Vorfall erstellen: Checkout down");
    expect(rows[1]).toHaveTextContent("Vorfall INC-42 bestätigen");
    expect(screen.getByText(DE["Executed"]!)).toBeInTheDocument();
    expect(screen.getByText(DE["Denied"]!)).toBeInTheDocument();
  });

  /*
   * A row is the only record of what ran: cut at one line, a phone lost
   * what it changed ("Schweregrad von Vorfall INC-42 auf C..."). It wraps
   * as the card's titles do, its chip held at its width beside the first
   * line.
   */
  test("a decided action's row is never cut to one line: it wraps, its chip beside its first line", () => {
    renderCard(
      [
        stored(
          {
            title: aiActionSentence(AI_ACTION_TITLES.changeIncidentSeverity, {
              incident: "INC-42",
              severity: "Critical",
            }),
            namedArguments: ["incidentId"],
          },
          {
            id: "call-severity",
            toolName: "change_incident_severity",
            arguments: { incidentId: INCIDENT_ID, severityName: "Critical" },
            status: AIChatToolActionStatus.Executed,
          },
        ),
      ],
      false,
    );

    const title: HTMLElement = screen.getByTestId(
      "tool-approval-history-title",
    );
    expect(title).toHaveTextContent(
      fill(DE, "Change incident {{incident}} severity to {{severity}}", {
        incident: "INC-42",
        severity: "Critical",
      }),
    );
    expect(title.className).not.toContain("truncate");
    expect(title.className).toContain("line-clamp-3");
    expect(title.className).toContain("break-words");

    const row: HTMLElement = screen.getByTestId("tool-approval-history");
    expect(row.className).toContain("items-start");
    // The chip keeps its width however long the row's words are.
    expect(row.firstElementChild!.className).toContain("flex-shrink-0");
  });

  test("a page says its policy in quotes and its incident by number: neither ID reaches the arguments", () => {
    const POLICY_ID: string = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

    renderCard([
      stored(
        {
          // As the server's prepare names them (RecordNamesForPerson).
          title: aiActionSentence(
            AI_ACTION_TITLES.pageOnCallPolicyForIncident,
            { policy: '"Checkout on-call"', incident: "INC-42" },
          ),
          namedArguments: ["onCallDutyPolicyId", "incidentId"],
        },
        {
          id: "call-page",
          toolName: "page_on_call_policy",
          arguments: { onCallDutyPolicyId: POLICY_ID, incidentId: INCIDENT_ID },
        },
      ),
    ]);

    expect(screen.getByTestId("tool-approval-title")).toHaveTextContent(
      'Bereitschaftsrichtlinie "Checkout on-call" zu Vorfall INC-42 alarmieren',
    );
    // Both are in the title: the card has no line of IDs.
    expect(
      screen.queryByTestId("tool-approval-arguments"),
    ).not.toBeInTheDocument();
  });

  test("an action saved before its words reads the English it stores, as it always did", () => {
    const saved: AIChatToolAction = stored(DECLARE_WORDS);
    delete saved.words;

    renderCard([saved]);

    expect(screen.getByTestId("tool-approval-title")).toHaveTextContent(
      "Create incident: Checkout down",
    );
    expect(screen.getByTestId("tool-approval-description")).toHaveTextContent(
      'Linked to host "test01".',
    );
    // The legacy rule still leaves out the title the incident takes.
    expect(screen.getByTestId("tool-approval-arguments")).not.toHaveTextContent(
      "title: Checkout down",
    );
  });

  test("words that are not the module's sentences read the English the action stores", () => {
    renderCard([
      stored(DECLARE_WORDS, {
        words: {
          title: { template: "Delete everything" },
        } as unknown as AIActionWords,
      }),
    ]);

    expect(screen.getByTestId("tool-approval-title")).toHaveTextContent(
      "Create incident: Checkout down",
    );
    expect(screen.queryByText(/Delete everything/)).not.toBeInTheDocument();
  });

  test("a sentence with a German value keeps it whole: a name is never looked up", () => {
    renderCard([
      stored({
        title: aiActionSentence(AI_ACTION_TITLES.createIncident, {
          // A title that is itself a key of the locale stays as written.
          title: "Allow",
        }),
      }),
    ]);

    expect(screen.getByTestId("tool-approval-title")).toHaveTextContent(
      "Vorfall erstellen: Allow",
    );
  });
});

describe("in Persian, right to left", () => {
  beforeAll(async () => {
    await inLanguage("fa");
  });

  test("the title is Persian, read right to left, with the model's English title set apart", () => {
    renderCard([stored(DECLARE_WORDS)]);

    const title: HTMLElement = screen.getByTestId("tool-approval-title");
    const sentence: HTMLElement = title.querySelector("bdi") as HTMLElement;

    expect(sentence).toHaveAttribute("dir", "rtl");
    expect(sentence.textContent).toBe(
      fill(FA, "Create incident: {{title}}", {
        title: isolated("Checkout down"),
      }),
    );
  });

  test("each sentence of the line is its own right-to-left isolate, every name in its quotes set apart", () => {
    renderCard([
      stored(ALERT_WORDS, {
        id: "call-alert",
        toolName: "create_alert",
        arguments: {
          title: "High memory usage on test01",
          description: "Memory has been above 92% for 20 minutes.",
        },
      }),
    ]);

    const line: HTMLElement = screen.getByTestId("tool-approval-description");
    const sentences: Array<HTMLElement> = Array.from(
      line.querySelectorAll("bdi"),
    );

    expect(sentences).toHaveLength(2);
    for (const sentence of sentences) {
      expect(sentence).toHaveAttribute("dir", "rtl");
    }
    expect(sentences[0]!.textContent).toBe(
      fill(FA, "Severity: {{severity}}.", { severity: isolated("High") }),
    );
    expect(sentences[1]!.textContent).toContain(isolated('"test01"'));
    expect(withoutIsolateMarks(line.textContent || "")).toBe(
      `${fill(FA, "Severity: {{severity}}.", { severity: "High" })} ${fill(
        FA,
        "Linked to {{resources}}.",
        { resources: `${FA["host"]} "test01"` },
      )}`,
    );
  });

  test("the card's own words are Persian", () => {
    renderCard([stored(DECLARE_WORDS)]);

    expect(
      screen.getByText(
        fill(FA, "The AI wants to perform {{count}} actions_one", {
          count: "۱",
        }),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: FA["Allow"]! }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: FA["Deny all"]! }),
    ).toBeInTheDocument();
  });

  test("a pair's name is the Persian title with no isolate marks: a screen reader hears words", () => {
    renderCard([stored(DECLARE_WORDS)]);

    const group: HTMLElement = screen.getByTestId("tool-approval-choice");
    const name: string = group.getAttribute("aria-label") || "";

    expect(name).toBe(
      fill(FA, "Create incident: {{title}}", { title: "Checkout down" }),
    );
    expect(name).not.toContain(FIRST_STRONG_ISOLATE);
    expect(name).not.toContain(POP_DIRECTIONAL_ISOLATE);
  });

  test("an English action saved before its words is read left to right, its full stop at its end", () => {
    const saved: AIChatToolAction = stored(ALERT_WORDS);
    delete saved.words;

    renderCard([saved]);

    const line: HTMLElement = screen.getByTestId("tool-approval-description");
    const isolate: HTMLElement = line.querySelector("bdi") as HTMLElement;

    expect(isolate).toHaveAttribute("dir", "ltr");
    expect(isolate.textContent).toBe(
      'Severity: High. Linked to host "test01".',
    );
  });
});

describe("in Japanese", () => {
  beforeAll(async () => {
    await inLanguage("ja");
  });

  test("the line's sentences follow each other with no space after a Japanese full stop", () => {
    renderCard([stored(ALERT_WORDS, { toolName: "create_alert" })]);

    const line: HTMLElement = screen.getByTestId("tool-approval-description");
    const first: string = fill(JA, "Severity: {{severity}}.", {
      severity: "High",
    });

    expect(first.endsWith("。")).toBe(true);
    expect(line.textContent).toBe(
      `${first}${fill(JA, "Linked to {{resources}}.", {
        resources: `${JA["host"]} "test01"`,
      })}`,
    );
  });
});

describe("the arguments a card is given", () => {
  test("are the action's own: the card never changes what is sent", () => {
    const action: AIChatToolAction = stored(DECLARE_WORDS);
    const before: JSONObject = JSON.parse(
      JSON.stringify(action.arguments),
    ) as JSONObject;

    renderCard([action]);

    expect(action.arguments).toEqual(before);
  });
});
