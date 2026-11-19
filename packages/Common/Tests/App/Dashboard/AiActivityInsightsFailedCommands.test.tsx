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
import fs from "fs";
import i18next from "i18next";
import path from "path";
import * as React from "react";
import { initReactI18next } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import AiActivityInsightsView, {
  getSubjectRoute,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/ActivityInsights/AiActivityInsightsView";
import {
  AI_INSIGHTS_COMMAND_NOT_SHOWN,
  AI_INSIGHTS_FAILED_COMMANDS_DESCRIPTION,
  AI_INSIGHTS_FAILED_COMMANDS_HINT,
  getFailedCommandItem,
  getFailedCommands,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/ActivityInsights/AiActivityFailedCommands";
import { parseAiActivityInsights } from "../../../../App/FeatureSet/Dashboard/src/Components/AI/ActivityInsights/AiActivityInsightsData";
import { ResourceAttentionItem } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttention";
import {
  AiActivityFailedCommand,
  AiActivityInsights,
} from "../../../Types/AI/AiActivityInsights";
import Route from "../../../Types/API/Route";
import { createTranslator, Translator } from "../../../Types/Translator";
import { followLanguageForDates } from "../../../UI/Utils/DateDisplayLanguage";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import {
  DISK_SUBJECT,
  FAILED_COMMAND,
  FAILED_COMMAND_ERROR,
  FAILED_COMMAND_ID,
  RECURRING_SUBJECT,
  SECOND_FAILED_COMMAND,
  SECOND_FAILED_COMMAND_ERROR,
  SECOND_FAILED_COMMAND_ID,
  makeFailedCommands,
  makeInsights,
  makeTotals,
} from "./AiActivityInsightsFixtures";

/*
 * AI INSIGHTS' "COMMANDS: N FAILED" OPENS WHICH COMMANDS FAILED, AND WHY
 * (#9749).
 *
 * The footnote of every AI Insights page said "Commands 37 · 2 failed, 1
 * never ran", and nothing opened. "2 failed" is now the product's pill
 * (ResourceAttentionPill): pressed, it lists the failed commands the
 * reader may read, the newest first - each as AI sent it, how it ended
 * (its exit code, the agent's own words), why AI ran it, the incident or
 * alert it was for, when it failed, and View to that incident or alert
 * (or to AI Logs). The count is the server's count of those same
 * commands, so it says how many open.
 *
 * Rendered for real (AiActivityInsightsView) through the i18next the
 * Dashboard sets up, in the fixture the AI Insights suites share.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: Array<string> = ["en", "de", "fa", "ru"];

const LOGS_ROUTE: Route = new Route("/dashboard/cluster/ai/logs");

function readLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

async function inLanguage(language: string): Promise<void> {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage(language);
  });
}

function renderView(insights: AiActivityInsights): void {
  render(
    <MemoryRouter>
      <AiActivityInsightsView
        insights={insights}
        noun="cluster"
        logsRoute={LOGS_ROUTE}
        agentRoute={new Route("/dashboard/cluster/ai/agent")}
      />
    </MemoryRouter>,
  );
}

function textOf(element: HTMLElement): string {
  return withoutIsolateMarks(element.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
}

// Press the pill; the dialog it opens.
function openFailedCommands(): HTMLElement {
  fireEvent.click(screen.getByTestId("ai-insights-failed-commands"));

  return screen.getByTestId("ai-insights-failed-commands-dialog");
}

function rowsOf(dialog: HTMLElement): Array<HTMLElement> {
  return within(dialog).getAllByTestId(
    "ai-insights-failed-commands-dialog-item",
  );
}

const ENGLISH: Translator = createTranslator(undefined, "en");

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: Object.fromEntries(
      LANGUAGES.map((language: string) => {
        return [language, { translation: readLocale(language) }];
      }),
    ),
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
  followLanguageForDates(i18next);
});

afterEach(async () => {
  cleanup();
  await inLanguage("en");
});

afterAll(async () => {
  await inLanguage("en");
});

describe("the failed count opens which commands failed, and why", () => {
  test("is a button that says what a press shows", () => {
    renderView(makeInsights());

    const pill: HTMLElement = screen.getByTestId("ai-insights-failed-commands");

    expect(pill.tagName).toBe("BUTTON");
    expect(textOf(pill)).toBe("2 failed");
    expect(pill).toHaveAttribute("aria-haspopup", "dialog");
    expect(pill).toHaveAttribute("title", AI_INSIGHTS_FAILED_COMMANDS_HINT);
    expect(pill).toHaveAttribute("data-tone", "danger");
    // Beside it, what no agent picked up in time.
    expect(textOf(screen.getByTestId("ai-insights-commands-never-ran"))).toBe(
      "1 never ran",
    );
  });

  test("lists every one the count counts, the newest first", () => {
    renderView(makeInsights());

    const dialog: HTMLElement = openFailedCommands();

    expect(screen.getByText("2 commands failed")).toBeInTheDocument();
    expect(
      screen.getByText(AI_INSIGHTS_FAILED_COMMANDS_DESCRIPTION),
    ).toBeInTheDocument();
    expect(
      rowsOf(dialog).map((row: HTMLElement): string | null => {
        return row.getAttribute("data-key");
      }),
    ).toEqual([
      `command-${FAILED_COMMAND_ID}`,
      `command-${SECOND_FAILED_COMMAND_ID}`,
    ]);
    // All of them: nothing says there are more.
    expect(
      within(dialog).queryByTestId(
        "ai-insights-failed-commands-dialog-truncated",
      ),
    ).not.toBeInTheDocument();
  });

  test("each says what it ran, how it ended, why, what for and when", () => {
    renderView(makeInsights());

    const [first, second] = rowsOf(openFailedCommands()) as [
      HTMLElement,
      HTMLElement,
    ];
    const part: (row: HTMLElement, name: string) => string = (
      row: HTMLElement,
      name: string,
    ): string => {
      return textOf(
        within(row).getByTestId(`ai-insights-failed-commands-dialog-${name}`),
      );
    };

    expect(part(first, "name")).toBe(FAILED_COMMAND);
    expect(part(first, "reason")).toBe("Exit code 1");
    expect(part(first, "message")).toBe(FAILED_COMMAND_ERROR);
    expect(
      within(first)
        .getAllByTestId("ai-insights-failed-commands-dialog-fact")
        .map(textOf),
    ).toEqual([
      "Why:While investigating (read-only)",
      `Incident:#42 ${RECURRING_SUBJECT.title}`,
    ]);
    expect(part(first, "since")).toMatch(/^Failed /);

    // A fix the agent failed without an exit code: that it failed.
    expect(part(second, "name")).toBe(SECOND_FAILED_COMMAND);
    expect(part(second, "reason")).toBe("Failed");
    expect(part(second, "message")).toBe(SECOND_FAILED_COMMAND_ERROR);
    expect(
      within(second)
        .getAllByTestId("ai-insights-failed-commands-dialog-fact")
        .map(textOf),
    ).toEqual(["Why:To fix it", `Alert:#812 ${DISK_SUBJECT.title}`]);
  });

  test("View opens the incident or alert whose investigation or fix ran it", () => {
    renderView(makeInsights());

    const views: Array<HTMLElement> = within(
      openFailedCommands(),
    ).getAllByTestId("ai-insights-failed-commands-dialog-view");

    expect(
      views.map((view: HTMLElement): string | null => {
        return view.getAttribute("href");
      }),
    ).toEqual([
      getSubjectRoute(RECURRING_SUBJECT).toString(),
      getSubjectRoute(DISK_SUBJECT).toString(),
    ]);
  });

  test("one about an incident the reader may not read opens AI Logs, and names none", () => {
    const failedCommands: Array<AiActivityFailedCommand> = makeFailedCommands();
    delete failedCommands[0]!.subject;

    renderView(makeInsights({ failedCommandList: failedCommands }));

    const [first] = rowsOf(openFailedCommands()) as [HTMLElement];

    expect(
      within(first).getByTestId("ai-insights-failed-commands-dialog-view"),
    ).toHaveAttribute("href", LOGS_ROUTE.toString());
    expect(
      within(first)
        .getAllByTestId("ai-insights-failed-commands-dialog-fact")
        .map(textOf),
    ).toEqual(["Why:While investigating (read-only)"]);
  });

  test("a Viewer reads that a command failed and why, never what it ran", () => {
    const failedCommands: Array<AiActivityFailedCommand> = makeFailedCommands();
    delete failedCommands[0]!.command;

    renderView(makeInsights({ failedCommandList: failedCommands }));

    const [first] = rowsOf(openFailedCommands()) as [HTMLElement];

    expect(
      textOf(
        within(first).getByTestId("ai-insights-failed-commands-dialog-name"),
      ),
    ).toBe(AI_INSIGHTS_COMMAND_NOT_SHOWN);
    expect(textOf(first)).toContain(FAILED_COMMAND_ERROR);
    expect(textOf(first)).not.toContain(FAILED_COMMAND);
  });

  test("more failed than the page holds: the list says it shows the newest of them, as it is ordered", () => {
    renderView(makeInsights({ totals: makeTotals({ failedCommands: 74 }) }));

    expect(textOf(screen.getByTestId("ai-insights-failed-commands"))).toBe(
      "74 failed",
    );

    const dialog: HTMLElement = openFailedCommands();

    expect(screen.getByText("74 commands failed")).toBeInTheDocument();
    expect(rowsOf(dialog)).toHaveLength(2);

    const truncated: HTMLElement = within(dialog).getByTestId(
      "ai-insights-failed-commands-dialog-truncated",
    );

    expect(textOf(truncated)).toBe("Showing the newest 2.");
    // Not the resource lists' order: these are the newest, not the most urgent.
    expect(textOf(truncated)).not.toContain("most urgent");
  });

  test("Close closes it, and the page is as it was", () => {
    renderView(makeInsights());

    openFailedCommands();
    fireEvent.click(screen.getByText("Close"));

    expect(
      screen.queryByTestId("ai-insights-failed-commands-dialog"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("ai-insights-failed-commands")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});

describe("what the commands detail says when there is nothing to open", () => {
  test("a server that did not list them: the count, as text, opening nothing", () => {
    renderView(makeInsights({ failedCommandList: undefined }));

    expect(
      screen.queryByTestId("ai-insights-failed-commands"),
    ).not.toBeInTheDocument();
    expect(
      textOf(screen.getByTestId("ai-insights-failed-commands-count")),
    ).toBe("2 failed");
  });

  test("none failed: only what never ran", () => {
    renderView(
      makeInsights({
        totals: makeTotals({ failedCommands: 0 }),
        failedCommandList: undefined,
      }),
    );

    expect(
      screen.queryByTestId("ai-insights-failed-commands"),
    ).not.toBeInTheDocument();
    expect(textOf(screen.getByTestId("ai-insights-command-outcomes"))).toBe(
      "1 never ran",
    );
  });

  test("every command ran: nothing under the count", () => {
    renderView(
      makeInsights({
        totals: makeTotals({ failedCommands: 0, timedOutCommands: 0 }),
        failedCommandList: undefined,
      }),
    );

    expect(
      screen.queryByTestId("ai-insights-command-outcomes"),
    ).not.toBeInTheDocument();
    expect(textOf(screen.getByTestId("ai-insights-stat-commands"))).toBe(
      "Commands37",
    );
  });
});

describe("in the reader's language", () => {
  test("German: the pill, the dialog and every row", async () => {
    await inLanguage("de");
    renderView(makeInsights());

    expect(textOf(screen.getByTestId("ai-insights-failed-commands"))).toBe(
      "2 fehlgeschlagen",
    );
    expect(textOf(screen.getByTestId("ai-insights-commands-never-ran"))).toBe(
      "1 nie ausgeführt",
    );

    const dialog: HTMLElement = openFailedCommands();

    expect(screen.getByText("2 Befehle fehlgeschlagen")).toBeInTheDocument();
    const [first] = rowsOf(dialog) as [HTMLElement];

    expect(
      textOf(
        within(first).getByTestId("ai-insights-failed-commands-dialog-reason"),
      ),
    ).toBe("Exit-Code 1");
    // What AI ran and what the agent said are as written.
    expect(textOf(first)).toContain(FAILED_COMMAND);
    expect(textOf(first)).toContain(FAILED_COMMAND_ERROR);
  });

  test("Persian: counts in Persian digits", async () => {
    await inLanguage("fa");
    renderView(makeInsights());

    const pill: string = textOf(
      screen.getByTestId("ai-insights-failed-commands"),
    );

    expect(pill).toContain("۲");
    expect(pill).not.toMatch(/[0-9]/);
    expect(
      textOf(screen.getByTestId("ai-insights-commands-never-ran")),
    ).toContain("۱");
  });

  test("Russian: a count its plural forms word for any number", async () => {
    await inLanguage("ru");
    renderView(makeInsights({ totals: makeTotals({ failedCommands: 5 }) }));

    openFailedCommands();

    expect(screen.getByText("Команд с ошибкой: 5")).toBeInTheDocument();
  });
});

describe("the rows, read from the server's list", () => {
  test("newest first, whatever order they came in, and whether there are more", () => {
    const [newer, older] = makeFailedCommands() as [
      AiActivityFailedCommand,
      AiActivityFailedCommand,
    ];

    expect(
      getFailedCommands(
        makeInsights({ failedCommandList: [older, newer] }),
      ).commands.map((command: AiActivityFailedCommand): string => {
        return command.id;
      }),
    ).toEqual([newer.id, older.id]);
    expect(getFailedCommands(makeInsights()).isTruncated).toBe(false);
    expect(
      getFailedCommands(
        makeInsights({ totals: makeTotals({ failedCommands: 3 }) }),
      ).isTruncated,
    ).toBe(true);
    expect(
      getFailedCommands(makeInsights({ failedCommandList: undefined })),
    ).toEqual({ commands: [], isTruncated: true });
  });

  test("an item is critical, keyed by its command, and links where it should", () => {
    const item: ResourceAttentionItem = getFailedCommandItem({
      command: makeFailedCommands()[0]!,
      translator: ENGLISH,
      routes: { getSubjectRoute, logsRoute: LOGS_ROUTE },
    });

    expect(item).toMatchObject({
      key: `command-${FAILED_COMMAND_ID}`,
      severity: "critical",
      name: FAILED_COMMAND,
      message: FAILED_COMMAND_ERROR,
      reasons: [{ text: "Exit code {{exitCode}}", values: { exitCode: "1" } }],
    });
    expect(item.since?.at.toISOString()).toBe("2026-09-30T02:08:00.000Z");
    expect(item.route?.toString()).toBe(
      getSubjectRoute(RECURRING_SUBJECT).toString(),
    );
  });

  test("the page reads the list only beside a count, and drops what it cannot word", () => {
    const body: Record<string, unknown> = JSON.parse(
      JSON.stringify(makeInsights()),
    ) as Record<string, unknown>;

    body["failedCommandList"] = [
      ...(body["failedCommandList"] as Array<unknown>),
      { id: "no-time" },
      { at: "2026-09-30T00:00:00.000Z" },
      { id: "bad-time", at: "yesterday" },
      "not a command",
      { id: "x", at: "2026-09-30T00:00:00.000Z", exitCode: 1.5 },
    ];

    const parsed: AiActivityInsights = parseAiActivityInsights(body)!;

    expect(
      parsed.failedCommandList!.map((command: AiActivityFailedCommand) => {
        return command.id;
      }),
    ).toEqual([FAILED_COMMAND_ID, SECOND_FAILED_COMMAND_ID, "x"]);
    // A code that is not a whole number is no exit code.
    expect(parsed.failedCommandList![2]!.exitCode).toBeUndefined();
    expect(parsed.failedCommandList![0]).toEqual(makeFailedCommands()[0]);

    // No count, nothing to open.
    (body["totals"] as Record<string, unknown>)["failedCommands"] = 0;
    expect(parseAiActivityInsights(body)!.failedCommandList).toBeUndefined();
  });
});
