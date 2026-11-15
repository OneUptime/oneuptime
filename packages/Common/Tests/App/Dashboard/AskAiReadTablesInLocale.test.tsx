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
import { act, cleanup, render, screen, within } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";
import WidgetRenderer from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/Widgets/WidgetRenderer";
import CitationChips from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/CitationChips";
import {
  getCitationLabelText,
  getCitationRowCountText,
  getDrawnCitationLabel,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/CitationWords";
import {
  getKnownTableWords,
  withMomentsWritten,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/TableWords";
import { GetOnCallStatusTool } from "../../../Server/Utils/AI/Toolbox/OnCallTools";
import { QueryTeamsTool } from "../../../Server/Utils/AI/Toolbox/TeamTools";
import { SearchLogsTool } from "../../../Server/Utils/AI/Toolbox/LogTools";
import {
  citationSentence,
  countFigure,
} from "../../../Server/Utils/AI/Toolbox/ReadTableWords";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../Server/Utils/AI/Toolbox/ToolTypes";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import TeamService from "../../../Server/Services/TeamService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import LogService from "../../../Server/Services/LogService";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import Log from "../../../Models/AnalyticsModels/Log";
import {
  AIActionSentence,
  AIActionTableWords,
  aiActionMoment,
  aiActionSentence,
  describeAIActionSentence,
  describeAIActionTableWords,
} from "../../../Types/AI/AIActionWords";
import {
  AI_READ_CITATIONS,
  AI_READ_WINDOW,
} from "../../../Types/AI/AIReadTableWords";
import { AIChatCitation, AIChatWidget } from "../../../Types/AI/AIChatTypes";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../Types/Date";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { Translator } from "../../../Types/Translator";
import { widgetToMarkdown } from "../../../UI/Utils/AIChatExport/ChatWidgetMarkdown";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * ASK AI'S TABLES AND SOURCES, IN THE READER'S LANGUAGE (issues #7977,
 * #7979, #7980).
 *
 * "Who is on call right now?" left a table titled "On-call now (2
 * schedules)", each row "Schedule 'Primary rotation'" or "No one is on
 * call", under column names in German; the logs table said "Logs (2)"
 * over a window of ISO instants; and each chip under Sources named what
 * was read in English, its count in Latin digits on a Persian page. The
 * tables and chips are built here by the real tools, from services a test
 * double answers, and drawn in German, Persian and Arabic: no English but
 * the project's own names, the counts the reader's way, a window in the
 * reader's time. A table and a chip saved before their words - or whose
 * words do not say what they store - read as stored, and the exports print
 * English.
 */

const LANGUAGES: Array<string> = ["de", "fa", "ar"];
const LOCALES: Record<string, Record<string, string>> = {};
for (const language of LANGUAGES) {
  LOCALES[language] = readDashboardLocale(language);
}

const LATIN_DIGIT: RegExp = /[0-9]/;
const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const TEAM_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const NOW: Date = new Date("2026-09-17T12:00:00.000Z");

const ctx: ToolContext = {
  projectId: PROJECT_ID,
  props: { isRoot: true },
};

// A member of the project who may read telemetry, as the log tools ask.
const memberCtx: ToolContext = {
  projectId: PROJECT_ID,
  props: {
    tenantId: PROJECT_ID,
    userId: ObjectID.generate(),
    userGlobalAccessPermission: {
      globalPermissions: [Permission.Public],
      projectIds: [PROJECT_ID],
      _type: "UserGlobalAccessPermission",
    },
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        projectId: PROJECT_ID,
        permissions: [
          {
            permission: Permission.ProjectMember,
            labelIds: [],
            isBlockPermission: false,
            _type: "UserPermission",
          },
        ],
        _type: "UserTenantAccessPermission",
      },
    },
  } as unknown as DatabaseCommonInteractionProps,
};

function buildUser(name: string): User {
  const user: User = new User();
  user._id = ObjectID.generate().toString();
  user.name = new Name(name);
  user.email = new Email(`${name.split(" ")[0]!.toLowerCase()}@acme.com`);
  return user;
}

function buildSchedule(
  name: string,
  onCall?: string,
): OnCallDutyPolicySchedule {
  const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
  schedule._id = ObjectID.generate().toString();
  schedule.name = name;
  if (onCall) {
    schedule.currentUserOnRoster = buildUser(onCall);
    schedule.rosterStartAt = new Date("2026-09-14T09:00:00Z");
    schedule.rosterHandoffAt = new Date("2026-09-21T09:00:00Z");
  }
  return schedule;
}

function buildMember(name: string, hasAccepted: boolean): TeamMember {
  const member: TeamMember = new TeamMember();
  member._id = ObjectID.generate().toString();
  member.teamId = TEAM_ID;
  member.hasAcceptedInvitation = hasAccepted;
  member.user = buildUser(name);
  return member;
}

// Who is on call now, over every schedule: one covered, one not.
async function onCallNow(): Promise<ToolExecutionResult> {
  jest
    .spyOn(OnCallDutyPolicyScheduleService, "findBy")
    .mockResolvedValue([
      buildSchedule("Primary rotation", "Alice Smith"),
      buildSchedule("Weekend rotation"),
    ] as never);

  return GetOnCallStatusTool.execute({}, ctx);
}

// One team, a member and one invited still.
async function teamPlatform(): Promise<ToolExecutionResult> {
  const team: Team = new Team();
  team._id = TEAM_ID.toString();
  team.name = "Platform";
  team.description = "Owns shared infrastructure.";

  jest.spyOn(TeamService, "findOneById").mockResolvedValue(team as never);
  jest
    .spyOn(TeamMemberService, "findBy")
    .mockResolvedValue([
      buildMember("Sam Iyer", true),
      buildMember("Riya Patel", false),
    ] as never);

  return QueryTeamsTool.execute({ teamId: TEAM_ID.toString() }, ctx);
}

// The last hour's logs: two lines.
async function lastHourOfLogs(): Promise<ToolExecutionResult> {
  jest.spyOn(LogService, "findBy").mockResolvedValue([
    {
      time: new Date("2026-09-17T11:59:00.000Z"),
      severityText: "Error",
      body: "payment failed",
    } as unknown as Log,
    {
      time: new Date("2026-09-17T11:58:00.000Z"),
      severityText: "Info",
      body: "healthy",
    } as unknown as Log,
  ]);

  return SearchLogsTool.execute({}, memberCtx);
}

function widgetOf(result: ToolExecutionResult, id: string): AIChatWidget {
  expect(result.widget).toBeDefined();
  return { ...result.widget!, id };
}

function citationOf(
  result: ToolExecutionResult,
  id: string,
  toolName: string,
): AIChatCitation {
  return {
    id,
    toolName,
    label: result.citationLabel,
    ...(result.citationWords ? { words: result.citationWords } : {}),
    queryArguments: {},
    rowCount: result.rowCount,
  };
}

// Persian digits as Latin ones, to read a time whatever digits it is in.
function withLatinDigits(text: string): string {
  return text.replace(/[۰-۹]/g, (digit: string): string => {
    return String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit));
  });
}

function textOf(element: Element): string {
  return withoutIsolateMarks(element.textContent || "");
}

function onlyWidget(): HTMLElement {
  return screen.getByTestId("ai-chat-widget");
}

function titleText(): string {
  return textOf(within(onlyWidget()).getByTestId("ai-chat-widget-title"));
}

function descriptionText(): string {
  return textOf(within(onlyWidget()).getByTestId("ai-chat-widget-description"));
}

function cells(): Array<string> {
  return screen.getAllByTestId("ai-chat-table-cell").map(textOf);
}

async function inLanguage(language: string): Promise<void> {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage(language);
  });
}

// The locale's own words for a sentence, its values as the test fills them.
function worded(language: string, sentence: AIActionSentence): string {
  return withoutIsolateMarks(
    describeAIActionSentence(
      withMomentsWritten(sentence, dashboardTranslator(language), {
        use12HourFormat: false,
      }),
      dashboardTranslator(language),
    ),
  );
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      de: { translation: LOCALES["de"]! },
      fa: { translation: LOCALES["fa"]! },
      ar: { translation: LOCALES["ar"]! },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(() => {
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  jest
    .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
    .mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

afterAll(async () => {
  await inLanguage("en");
});

describe("who is on call now, in the reader's language (#7977)", () => {
  test("the tool's table carries words the Dashboard trusts, and stores their English", async () => {
    const widget: AIChatWidget = widgetOf(await onCallNow(), "W1");
    const words: AIActionTableWords | null = getKnownTableWords(widget);

    expect(words).not.toBeNull();
    expect(widget.title).toBe("On-call now (2 schedules)");
    expect(describeAIActionTableWords(words!).title).toBe(widget.title);
    expect(
      widget.data.rows!.map((row: JSONObject) => {
        return row["source"];
      }),
    ).toEqual(["Schedule 'Primary rotation'", "Schedule 'Weekend rotation'"]);
    expect(
      widget.data.rows!.map((row: JSONObject) => {
        return row["onCallNow"];
      }),
    ).toEqual(["Alice Smith", "No one is on call"]);
  });

  test.each(LANGUAGES)(
    "%s: its title, each schedule's row and nobody on call are the language's; names as named",
    async (language: string) => {
      const words: Record<string, string> = LOCALES[language]!;
      const widget: AIChatWidget = widgetOf(await onCallNow(), "W1");

      await inLanguage(language);
      render(<WidgetRenderer widgets={[widget]} />);

      expect(titleText()).toBe(
        describeAIActionTableWords(
          getKnownTableWords(widget)!,
          dashboardTranslator(language),
        ).title,
      );
      expect(titleText()).not.toContain("On-call now");
      expect(titleText()).not.toContain("schedules");

      const drawn: Array<string> = cells();
      expect(drawn).toContain(
        words["Schedule '{{name}}'"]!.replace("{{name}}", "Primary rotation"),
      );
      expect(drawn).toContain(words["No one is on call"]);
      expect(drawn).toContain("Alice Smith");

      const page: string = textOf(onlyWidget());
      for (const english of ["Schedule '", "No one is on call", "On-call"]) {
        expect({ language, english, onPage: page.includes(english) }).toEqual({
          language,
          english,
          onPage: false,
        });
      }
    },
  );

  test("Persian: the count in Persian digits, the title read right to left", async () => {
    const widget: AIChatWidget = widgetOf(await onCallNow(), "W1");

    await inLanguage("fa");
    render(<WidgetRenderer widgets={[widget]} />);

    expect(titleText()).toContain("۲");
    expect(titleText()).not.toMatch(LATIN_DIGIT);
    expect(
      within(onlyWidget())
        .getByTestId("ai-chat-widget-title")
        .querySelector("bdi"),
    ).toHaveAttribute("dir", "rtl");
  });

  test("German: Jetzt in Bereitschaft (2 Pläne)", async () => {
    await inLanguage("de");
    render(<WidgetRenderer widgets={[widgetOf(await onCallNow(), "W1")]} />);

    expect(titleText()).toBe("Jetzt in Bereitschaft (2 Pläne)");
    expect(cells()).toContain("Plan „Weekend rotation“");
    expect(cells()).toContain("Niemand ist in Bereitschaft");
  });
});

describe("a team, in the reader's language (#7977)", () => {
  test.each(LANGUAGES)(
    "%s: its title and each member's standing are the language's; the team's description as written",
    async (language: string) => {
      const words: Record<string, string> = LOCALES[language]!;
      const widget: AIChatWidget = widgetOf(await teamPlatform(), "W1");

      expect(widget.title).toBe("Team: Platform");
      expect(widget.description).toBe("Owns shared infrastructure.");

      await inLanguage(language);
      render(<WidgetRenderer widgets={[widget]} />);

      expect(titleText()).toBe(
        words["Team: {{name}}"]!.replace("{{name}}", "Platform"),
      );
      // The team's own description is data, drawn as written.
      expect(descriptionText()).toBe("Owns shared infrastructure.");
      expect(cells()).toContain(words["Member"]);
      expect(cells()).toContain(words["Invited (not yet accepted)"]);
      expect(textOf(onlyWidget())).not.toContain("invited (not yet accepted)");
    },
  );
});

describe("the logs table's window, in the reader's language and time (#7979)", () => {
  test("the tool stores the window as the ISO text it always wrote", async () => {
    const widget: AIChatWidget = widgetOf(await lastHourOfLogs(), "W1");

    expect(widget.title).toBe("Logs (2)");
    expect(widget.description).toBe(
      "2026-09-17T11:00:00.000Z – 2026-09-17T12:00:00.000Z",
    );
    expect(getKnownTableWords(widget)?.description?.template).toBe(
      AI_READ_WINDOW,
    );
  });

  test.each(LANGUAGES)(
    "%s: the title is the language's and the window is the reader's time, never ISO",
    async (language: string) => {
      const widget: AIChatWidget = widgetOf(await lastHourOfLogs(), "W1");
      const words: AIActionTableWords = getKnownTableWords(widget)!;

      await inLanguage(language);
      render(<WidgetRenderer widgets={[widget]} />);

      expect(titleText()).toBe(worded(language, words.title));
      expect(titleText()).not.toContain("Logs");
      expect(descriptionText()).toBe(worded(language, words.description!));
      expect(descriptionText()).not.toContain("2026-09-17T");
      expect(descriptionText()).not.toContain(".000Z");
      /*
       * A window within one day says its end by the time alone: the day
       * once, then 11:00 – 12:00 (in Persian digits on a Persian page).
       */
      const window: string = withLatinDigits(descriptionText());
      expect(window).toContain("11:00");
      expect(window).toContain("12:00");
      expect(window.match(/17/g)).toHaveLength(1);
    },
  );

  test("a window over two days says both dates", () => {
    const sentence: AIActionSentence = aiActionSentence(AI_READ_WINDOW, {
      start: aiActionMoment(new Date("2026-09-16T23:00:00.000Z")),
      end: aiActionMoment(new Date("2026-09-17T01:00:00.000Z")),
    });
    const drawn: string = worded("de", sentence);

    expect(drawn).toContain("16");
    expect(drawn).toContain("17");
    expect(drawn).toContain("23:00");
    expect(drawn).toContain("01:00");
  });
});

describe("the chips under Sources, in the reader's language (#7980)", () => {
  async function chips(): Promise<Array<AIChatCitation>> {
    return [
      citationOf(await onCallNow(), "C1", "get_on_call_status"),
      citationOf(await teamPlatform(), "C2", "query_teams"),
      citationOf(await lastHourOfLogs(), "C3", "search_logs"),
      {
        id: "C4",
        toolName: "query_monitors",
        ...(() => {
          const citation: {
            citationLabel: string;
            citationWords: AIActionSentence;
          } = citationSentence(AI_READ_CITATIONS.monitors, {
            count: countFigure(4),
          });
          return {
            label: citation.citationLabel,
            words: citation.citationWords,
          };
        })(),
        queryArguments: {},
        rowCount: 4,
      },
    ];
  }

  function chipLabels(): Array<string> {
    return screen.getAllByTestId("ai-chat-citation-label").map(textOf);
  }

  test("each tool's citation carries words whose English is its label", async () => {
    const citations: Array<AIChatCitation> = await chips();

    expect(
      citations.map((citation: AIChatCitation) => {
        return citation.label;
      }),
    ).toEqual([
      "On-call now (1 responder)",
      'Team "Platform" (2 members)',
      "Logs 2026-09-17T11:00:00.000Z – 2026-09-17T12:00:00.000Z (2 shown)",
      "Monitors (4 found)",
    ]);
    for (const citation of citations) {
      expect(describeAIActionSentence(citation.words!)).toBe(citation.label);
      expect(
        getDrawnCitationLabel(citation, dashboardTranslator("de")),
      ).not.toBeNull();
    }
  });

  test.each(LANGUAGES)(
    "%s: every chip says what was read in the language; names as named",
    async (language: string) => {
      const citations: Array<AIChatCitation> = await chips();

      await inLanguage(language);
      render(<CitationChips citations={citations} />);

      const labels: Array<string> = chipLabels();

      expect(labels).toEqual(
        citations.map((citation: AIChatCitation): string => {
          return worded(language, citation.words!);
        }),
      );
      expect(labels[1]).toContain("Platform");
      for (const english of [
        "On-call now",
        "members",
        "shown",
        "found",
        "Logs",
      ]) {
        expect({
          language,
          english,
          onPage: labels.join(" | ").includes(english),
        }).toEqual({ language, english, onPage: false });
      }
      expect(labels.join(" ")).not.toContain("2026-09-17T");
    },
  );

  test("Persian: each count badge in Persian digits", async () => {
    const citations: Array<AIChatCitation> = await chips();

    await inLanguage("fa");
    render(<CitationChips citations={citations} />);

    const badges: Array<string> = screen
      .getAllByRole("button")
      .map((button: HTMLElement): string => {
        const spans: NodeListOf<HTMLSpanElement> =
          button.querySelectorAll(":scope > span");
        return textOf(spans[spans.length - 1]!);
      });

    expect(badges).toEqual(["۲", "۳", "۲", "۴"]);
    expect(
      getCitationRowCountText(citations[3]!, dashboardTranslator("fa")),
    ).toBe("۴");
    // Arabic writes Latin digits (Locales/ARABIC.md).
    expect(
      getCitationRowCountText(citations[3]!, dashboardTranslator("ar")),
    ).toBe("4");
  });

  test("German: the monitors chip reads Monitore (4 gefunden)", async () => {
    const citations: Array<AIChatCitation> = await chips();

    await inLanguage("de");
    render(<CitationChips citations={[citations[3]!]} />);

    expect(chipLabels()).toEqual(["Monitore (4 gefunden)"]);
  });

  test("a citation saved before it had words reads as stored, its count the reader's way", async () => {
    const saved: AIChatCitation = {
      id: "C1",
      toolName: "query_monitors",
      label: "Monitors (4 found)",
      queryArguments: {},
      rowCount: 4,
    };

    await inLanguage("fa");
    render(<CitationChips citations={[saved]} />);

    expect(chipLabels()).toEqual(["Monitors (4 found)"]);
    expect(screen.getByRole("button")).toHaveTextContent("۴");
  });

  test.each([
    [
      "words whose English is not the label",
      {
        words: aiActionSentence(AI_READ_CITATIONS.monitors, {
          count: countFigure(5),
        }),
      },
    ],
    ["words that are no sentence of the module", { words: { template: "Hi" } }],
    ["words in plain text", { words: "Monitors (4 found)" }],
  ])("%s: the label as stored", async (_name: string, extra: JSONObject) => {
    const citation: AIChatCitation = {
      id: "C1",
      toolName: "query_monitors",
      label: "Monitors (4 found)",
      queryArguments: {},
      rowCount: 4,
      ...(extra as unknown as Partial<AIChatCitation>),
    };
    const translator: Translator = dashboardTranslator("de");

    expect(getDrawnCitationLabel(citation, translator)).toBeNull();
    expect(getCitationLabelText(citation, translator)).toBe(
      "Monitors (4 found)",
    );

    await inLanguage("de");
    render(<CitationChips citations={[citation]} />);

    expect(chipLabels()).toEqual(["Monitors (4 found)"]);
  });

  test("an empty chip's tooltip names what was read in the language", async () => {
    const citation: AIChatCitation = {
      id: "C1",
      toolName: "query_monitors",
      ...(() => {
        const built: {
          citationLabel: string;
          citationWords: AIActionSentence;
        } = citationSentence(AI_READ_CITATIONS.monitors, {
          count: countFigure(0),
        });
        return { label: built.citationLabel, words: built.citationWords };
      })(),
      queryArguments: {},
      rowCount: 0,
    };

    await inLanguage("de");
    render(<CitationChips citations={[citation]} />);

    expect(
      withoutIsolateMarks(
        screen.getByRole("button").getAttribute("title") || "",
      ),
    ).toBe("Monitore (0 gefunden) — geprüft, nichts gefunden");
  });
});

describe("the exports print the English the tables and chips store", () => {
  test("a table's Markdown is English, whatever the reader's language", async () => {
    const widget: AIChatWidget = widgetOf(await onCallNow(), "W1");

    await inLanguage("de");
    const markdown: string = widgetToMarkdown(widget);

    expect(markdown).toContain("On-call now (2 schedules)");
    expect(markdown).toContain("Schedule 'Primary rotation'");
    expect(markdown).toContain("No one is on call");
    expect(markdown).not.toContain("Bereitschaft");
  });
});

describe("a table saved before it had words reads as stored", () => {
  test("its title and its window, as the tool wrote them then", async () => {
    const widget: AIChatWidget = widgetOf(await lastHourOfLogs(), "W1");
    delete widget.data.tableWords;

    await inLanguage("de");
    render(<WidgetRenderer widgets={[widget]} />);

    expect(titleText()).toBe("Logs (2)");
    // The window still in the reader's time, as it was drawn then.
    expect(descriptionText()).not.toContain(".000Z");
  });
});
