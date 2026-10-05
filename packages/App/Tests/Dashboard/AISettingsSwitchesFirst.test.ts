import {
  AI_INSIGHTS_SWITCHES,
  AI_LANE_ADVANCED_CARDS,
  AI_LANE_ADVANCED_COLUMNS,
  AI_LANE_PAGE_COPY,
  AI_LANE_SWITCHES,
  AI_LANE_SWITCHES_TEST_ID,
  AI_LANE_ADVANCED_SECTION_TEST_ID,
  AI_INSIGHTS_SWITCHES_TEST_ID,
  AiInsightsSettingsCopy,
  AiLane,
  AiLaneAdvancedCard,
  AiLaneAdvancedState,
  EMPTY_AI_LANE_ADVANCED_STATE,
  ENABLE_AI_COLUMN,
  ENABLE_AI_NOTICE_SWITCH_TEST_ID,
  ENABLE_AI_SWITCH_TEST_ID,
  EnableAiCopy,
  getAiLaneAdvancedCardColumns,
  getAiLaneAdvancedSummary,
  getProjectAiNotices,
  getProjectAiProviderState,
  getProjectAiState,
  getProjectAiSwitchTestId,
  isAiLaneAdvancedConfigured,
  isAiLaneAdvancedValueSet,
  PROJECT_AI_NOTICE_CONTEXT_COPY,
  PROJECT_AI_OFF_NOTICE_TEST_ID,
  PROJECT_AI_OFF_SENTENCE_TEST_ID,
  PROJECT_AI_PROVIDER_NOTICE_TEST_ID,
  ProjectAiNoticeContext,
  ProjectAiNoticeCopy,
  ProjectAiNoticeKind,
  ProjectAiProviderState,
  ProjectAiState,
  ProjectAiSwitchDefinition,
  recordAiLaneAdvancedCard,
} from "../../FeatureSet/Dashboard/src/Components/AISettings/ProjectAiSettingsCopy";
import Project from "Common/Models/DatabaseModels/Project";
import { TableColumnMetadata } from "Common/Types/Database/TableColumn";
import TableColumnType from "Common/Types/Database/TableColumnType";
import Permission from "Common/Types/Permission";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * AI settings pages show each AI behaviour as a switch that saves.
 *
 * Incidents → Settings → AI and Alerts → Settings → AI each showed nine
 * read-only rows behind an Update button that opened a three-step wizard
 * (Investigation / Limits / Fix Tasks), every field with a paragraph of
 * help; the postmortem draft was one more switch behind one more dialog;
 * AI → Insights → Settings was three switches behind Update, under
 * "deterministic statistical sensors file quiet insights"; and Enable AI
 * itself sat behind "Edit AI Features". Both investigation cards said
 * "Requires an LLM provider to be configured in Project Settings > AI >
 * LLM Providers" to everyone - untrue on OneUptime Cloud, where the global
 * providers are used - and nothing said when Enable AI was off, so every
 * switch read on while nothing ran.
 *
 * Now each AI behaviour is a switch that saves the moment it is flipped,
 * named for what it does (Components/AISettings/ProjectAiSettingsCopy);
 * what narrows or caps the work is folded under Advanced, whose folded
 * line says what the defaults do; and the pages say two things only when
 * they are true: AI is off (with its switch), or there is no LLM provider
 * AI can use.
 *
 * App cannot render React, so this pins the React-free copy and decisions,
 * and the pages' wiring as source. The pages themselves are rendered in
 * Common/Tests/App/Dashboard (ProjectAiSettingsSwitchPages,
 * ProjectAISettingsPages, AIInvestigationSettingsLimits), the shared card
 * in Common/Tests/UI/Components/ModelSwitchesCard, and every card that is
 * only switches is held by Common/Tests/UI/Components/Forms/SwitchCardsGuard.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const COMMON_ROOT: string = path.join(__dirname, "..", "..", "..", "Common");

const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

const OTHER_LOCALES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

const INCIDENT_PAGE: string = "Pages/Incidents/Settings/IncidentAISettings.tsx";
const ALERT_PAGE: string = "Pages/Alerts/Settings/AlertAISettings.tsx";
const INSIGHTS_PAGE: string = "Pages/AIInsights/Settings.tsx";
const AI_FEATURES_PAGE: string = "Pages/Settings/AIFeatures.tsx";
const NOTICE: string = "Components/AISettings/ProjectAiNotice.tsx";
const SWITCHES_CARD: string = "Components/AISettings/ProjectAiSwitchesCard.tsx";
const CONFIRMATION: string = "Components/AISettings/EnableAiConfirmation.ts";
const READINESS: string = "Components/AISettings/useProjectAiReadiness.ts";

// Source with comments dropped and whitespace collapsed.
function readSource(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\{\s*\}/g, "{}")
    .replace(/\s+/g, " ");
}

function readDashboard(relative: string): string {
  return readSource(path.join(DASHBOARD_SRC, relative));
}

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
}

const SOURCE_FILE: RegExp = /\.tsx?$/;

function listSources(directory: string): Array<string> {
  const found: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== "Locales") {
        found.push(...listSources(full));
      }
    } else if (SOURCE_FILE.test(entry.name)) {
      found.push(full);
    }
  }

  return found;
}

// Words a switch that reads on = it happens never needs.
const ENABLE_OR_DISABLE: RegExp = /\b(enable|disable)/i;

const PULL_REQUEST: RegExp = /pull request/;

const CODE_FIXES_COLUMN: RegExp = /CodeFixes$/;

const ALL_SWITCHES: Array<ProjectAiSwitchDefinition<string>> = [
  ...AI_LANE_SWITCHES[AiLane.Incident],
  ...AI_LANE_SWITCHES[AiLane.Alert],
  ...AI_INSIGHTS_SWITCHES,
];

function columnsOf(
  switches: Array<ProjectAiSwitchDefinition<string>>,
): Array<string> {
  return switches.map(
    (definition: ProjectAiSwitchDefinition<string>): string => {
      return definition.column;
    },
  );
}

/*
 * The per-feature AI switches the server turns on for a new project
 * (ProjectService.NEW_PROJECT_AI_DEFAULT_COLUMNS), read from its source.
 */
function newProjectAiDefaultColumns(): Array<string> {
  const source: string = fs.readFileSync(
    path.join(COMMON_ROOT, "Server", "Services", "ProjectService.ts"),
    "utf8",
  );
  const start: number = source.indexOf(
    "export const NEW_PROJECT_AI_DEFAULT_COLUMNS",
  );
  const list: string = source.slice(start, source.indexOf("];", start));

  return Array.from(list.matchAll(/"([A-Za-z]+)"/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

describe("every AI behaviour is a switch", () => {
  test("each per-feature AI switch a new project starts with has exactly one switch on a page", () => {
    const fromServer: Array<string> = newProjectAiDefaultColumns();
    const onPages: Array<string> = Array.from(new Set(columnsOf(ALL_SWITCHES)));

    // A walk that found nothing would pass vacuously.
    expect(fromServer.length).toBeGreaterThanOrEqual(10);
    expect([...onPages].sort()).toEqual([...fromServer].sort());
  });

  test("Enable AI is no per-feature switch: it is the project's only master switch, on its own page", () => {
    expect(ENABLE_AI_COLUMN).toBe("enableAi");
    expect(columnsOf(ALL_SWITCHES)).not.toContain(ENABLE_AI_COLUMN);
    expect(newProjectAiDefaultColumns()).not.toContain(ENABLE_AI_COLUMN);
  });

  test("every switch saves a boolean Project column whose default stays off", () => {
    const project: Project = new Project();

    for (const column of columnsOf(ALL_SWITCHES)) {
      const metadata: TableColumnMetadata =
        project.getTableColumnMetadata(column);

      expect([column, metadata.type, metadata.defaultValue]).toEqual([
        column,
        TableColumnType.Boolean,
        false,
      ]);
    }

    // The master switch defaults on.
    expect(project.getTableColumnMetadata(ENABLE_AI_COLUMN).defaultValue).toBe(
      true,
    );
  });

  /*
   * The behaviours take Project Owner or Project Admin; Enable AI takes
   * Project Owner or Manage Billing. Both are narrower than the Project
   * table's update list, which is why each switch locks on its own column.
   */
  test("who may change them is the columns' own update list", () => {
    const project: Project = new Project();

    for (const column of columnsOf(ALL_SWITCHES)) {
      expect([
        column,
        project.getColumnAccessControlFor(column)?.update,
      ]).toEqual([column, [Permission.ProjectOwner, Permission.ProjectAdmin]]);
    }

    expect(project.getColumnAccessControlFor(ENABLE_AI_COLUMN)?.update).toEqual(
      [Permission.ProjectOwner, Permission.ManageProjectBilling],
    );
    expect(project.getUpdatePermissions()).toEqual(
      expect.arrayContaining([
        Permission.ProjectAdmin,
        Permission.EditProject,
        Permission.ManageProjectBilling,
      ]),
    );
  });

  test("the switches read on = it happens, in plain words", () => {
    for (const definition of ALL_SWITCHES) {
      expect([
        definition.title,
        ENABLE_OR_DISABLE.test(definition.title),
      ]).toEqual([definition.title, false]);
    }

    expect(
      AI_LANE_SWITCHES[AiLane.Incident].map(
        (definition: ProjectAiSwitchDefinition<string>): string => {
          return definition.title;
        },
      ),
    ).toEqual([
      "Investigate new incidents",
      "Draft a postmortem when an incident resolves",
      "Open a fix pull request when an investigation finds a code change",
      "Open a pull request that adds missing telemetry",
    ]);
    expect(
      AI_LANE_SWITCHES[AiLane.Alert].map(
        (definition: ProjectAiSwitchDefinition<string>): string => {
          return definition.title;
        },
      ),
    ).toEqual([
      "Investigate new alerts",
      "Open a fix pull request when an investigation finds a code change",
      "Open a pull request that adds missing telemetry",
    ]);
    expect(
      AI_INSIGHTS_SWITCHES.map(
        (definition: ProjectAiSwitchDefinition<string>): string => {
          return definition.title;
        },
      ),
    ).toEqual([
      "Watch telemetry for problems",
      "Open a fix pull request when an insight points at your code",
      "Archive exceptions that are expected",
    ]);
  });

  test("no switch speaks in jargon, or says it is required to configure anything", () => {
    const sentences: Array<string> = [
      ...ALL_SWITCHES.flatMap(
        (definition: ProjectAiSwitchDefinition<string>): Array<string> => {
          return [
            definition.title,
            definition.description,
            definition.note || "",
          ];
        },
      ),
      AiInsightsSettingsCopy.cardDescription,
      AI_LANE_PAGE_COPY[AiLane.Incident].switchesCardDescription,
      AI_LANE_PAGE_COPY[AiLane.Alert].switchesCardDescription,
    ];

    for (const sentence of sentences) {
      for (const jargon of [
        /deterministic/i,
        /statistical sensors/i,
        /quiet insights/i,
        /proactive telemetry watch/i,
        /fix recipes/i,
        /Requires an LLM provider/i,
      ]) {
        expect([sentence, jargon.test(sentence)]).toEqual([sentence, false]);
      }
    }
  });

  test("the fix pull request switches say what they need, and that nothing merges by itself", () => {
    for (const definition of ALL_SWITCHES) {
      if (PULL_REQUEST.test(definition.title)) {
        expect([definition.title, definition.note]).toEqual([
          definition.title,
          expect.stringContaining("GitHub App"),
        ]);
      }
    }

    for (const lane of [AiLane.Incident, AiLane.Alert]) {
      const codeFix: ProjectAiSwitchDefinition<string> | undefined =
        AI_LANE_SWITCHES[lane].find(
          (definition: ProjectAiSwitchDefinition<string>): boolean => {
            return CODE_FIXES_COLUMN.test(definition.column);
          },
        );

      expect(codeFix?.description).toContain(
        "Nothing is merged automatically.",
      );
      expect(codeFix?.note).toContain("a Runner that can fix code");
    }
  });

  test("each switch has its own test id, from its column", () => {
    const ids: Array<string> = columnsOf(ALL_SWITCHES).map(
      getProjectAiSwitchTestId,
    );

    expect(ids[0]).toBe("ai-switch-enableAutomaticIncidentInvestigation");
    // The two lanes' PR switches share titles, never ids.
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("the pages draw switches first, and fold the limits", () => {
  test("Incidents → Settings → AI: notice, switches, then the limits under Advanced", () => {
    const page: string = readDashboard(INCIDENT_PAGE);

    expect(page).toContain(
      "<ProjectAiNotice context={ProjectAiNoticeContext.Incidents} />",
    );
    expect(page).toContain("switches={AI_LANE_SWITCHES[AiLane.Incident]}");
    expect(page).toContain(
      "dataTestId={AI_LANE_SWITCHES_TEST_ID[AiLane.Incident]}",
    );
    expect(page).toContain("<AdvancedPageSection");
    expect(page).toContain("summary={advanced.summary}");
    // Its cards, by name, the ones holding a limit as chips.
    expect(page).toContain("items={advanced.items}");
    expect(page.indexOf("<ProjectAiNotice")).toBeLessThan(
      page.indexOf("<ProjectAiSwitchesCard"),
    );
    expect(page.indexOf("<ProjectAiSwitchesCard")).toBeLessThan(
      page.indexOf("<AdvancedPageSection"),
    );
  });

  test("Alerts → Settings → AI is the same, for alerts", () => {
    const page: string = readDashboard(ALERT_PAGE);

    expect(page).toContain(
      "<ProjectAiNotice context={ProjectAiNoticeContext.Alerts} />",
    );
    expect(page).toContain("switches={AI_LANE_SWITCHES[AiLane.Alert]}");
    expect(page).toContain("<AdvancedPageSection");
    expect(page).toContain("summary={advanced.summary}");
  });

  test.each([[INCIDENT_PAGE], [ALERT_PAGE]])(
    "%s has no wizard, no Update button, and three one-page cards under Advanced, each with its own Edit",
    (file: string) => {
      const page: string = readDashboard(file);

      expect(page).not.toContain("formSteps");
      expect(page).not.toContain("stepId");
      expect(page).not.toContain('editButtonText={"Update"}');
      expect(page).not.toContain("FormFieldSchemaType.Toggle");
      expect(page.split("<CardModelDetail<Project>").length - 1).toBe(
        AI_LANE_ADVANCED_CARDS.length,
      );
      expect(page.split('editButtonText="Edit"').length - 1).toBe(3);
      // Every card names its dialog for what it edits, not "Edit Project".
      expect(page.split("editModalTitle=").length - 1).toBe(3);
      // Each card's Edit is gated on its own two columns.
      expect(page).toContain(
        "getProjectColumnsEditGate({ fields: getAiLaneAdvancedCardColumns(",
      );
    },
  );

  test("AI → Insights → Settings is the notice and its three switches", () => {
    const page: string = readDashboard(INSIGHTS_PAGE);

    expect(page).toContain(
      "<ProjectAiNotice context={ProjectAiNoticeContext.Insights} />",
    );
    expect(page).toContain("switches={AI_INSIGHTS_SWITCHES}");
    expect(page).not.toContain("CardModelDetail");
  });

  test("Project Settings → AI Features is Enable AI's switch, asking before it turns AI off", () => {
    const page: string = readDashboard(AI_FEATURES_PAGE);
    const confirmation: string = readDashboard(CONFIRMATION);

    expect(page).toContain("<ModelSwitchCard<Project>");
    expect(page).toContain("column={ENABLE_AI_COLUMN}");
    expect(page).toContain("getConfirmation={getEnableAiConfirmation}");
    expect(page).toContain("dataTestId={ENABLE_AI_SWITCH_TEST_ID}");
    // The provider notice sits under the switch, so it never moves it.
    expect(page.indexOf("<ModelSwitchCard")).toBeLessThan(
      page.indexOf(
        "<ProjectAiNotice context={ProjectAiNoticeContext.AiFeatures} />",
      ),
    );
    /*
     * Switch first: the only card on the page - the project's Daily limits -
     * is folded under More settings, after the switch and its notice.
     */
    expect(page.indexOf("<AdvancedPageSection")).toBeGreaterThan(
      page.indexOf(
        "<ProjectAiNotice context={ProjectAiNoticeContext.AiFeatures} />",
      ),
    );
    expect(page.indexOf("<CardModelDetail")).toBeGreaterThan(
      page.indexOf("<AdvancedPageSection"),
    );
    expect(page.split("<CardModelDetail").length - 1).toBe(1);

    expect(confirmation).toContain("if (isTurningOn) { return undefined; }");
    expect(confirmation).toContain("submitButtonType: ButtonStyleType.DANGER");
  });

  test("the notice holds Enable AI's own switch, with the same confirmation, for those who may change it", () => {
    const notice: string = readDashboard(NOTICE);

    expect(notice).toContain("<ModelSwitchRow<Project>");
    expect(notice).toContain("column={ENABLE_AI_COLUMN}");
    expect(notice).toContain("getConfirmation={getEnableAiConfirmation}");
    expect(notice).toContain(
      "PermissionGate.checkColumnUpdate( new Project(), ENABLE_AI_COLUMN, ).isAllowed",
    );
    expect(notice).toContain("EnableAiCopy.whoCanTurnOn");
    expect(notice).toContain("RouteMap[PageMap.SETTINGS_AI_LLM_PROVIDERS]");
  });

  test("the switches card saves each Project column on its own", () => {
    const card: string = readDashboard(SWITCHES_CARD);

    expect(card).toContain("<ModelSwitchesCard<Project>");
    expect(card).toContain("modelType={Project}");
    expect(card).toContain(
      "dataTestId: getProjectAiSwitchTestId(definition.column)",
    );
  });

  test("readiness asks the project and the providers the chat uses, and hears Enable AI saved anywhere", () => {
    const readiness: string = readDashboard(READINESS);

    expect(readiness).toContain(
      'PROJECT_AI_PROVIDERS_PATH: string = "/ai-chat/providers"',
    );
    expect(readiness).toContain("select: { enableAi: true, }");
    expect(readiness).toContain("subscribeToModelSwitchSaved({");
    expect(readiness).toContain("column: ENABLE_AI_COLUMN");
  });
});

describe("what the notices say, and when", () => {
  const contexts: Array<ProjectAiNoticeContext> = [
    ProjectAiNoticeContext.Incidents,
    ProjectAiNoticeContext.Alerts,
    ProjectAiNoticeContext.Insights,
  ];

  test("nothing while all is well, or while nothing is known", () => {
    for (const context of [...contexts, ProjectAiNoticeContext.AiFeatures]) {
      for (const aiState of [ProjectAiState.On, ProjectAiState.Unknown]) {
        for (const providerState of [
          ProjectAiProviderState.Usable,
          ProjectAiProviderState.Unknown,
        ]) {
          expect(
            getProjectAiNotices({
              context,
              aiState,
              providerState,
              isChangedHere: false,
            }),
          ).toEqual([]);
        }
      }
    }
  });

  test("AI off: only that, whatever the provider - it is the one thing to fix first", () => {
    for (const context of contexts) {
      for (const providerState of [
        ProjectAiProviderState.Usable,
        ProjectAiProviderState.Missing,
        ProjectAiProviderState.NoDefault,
        ProjectAiProviderState.Unknown,
      ]) {
        expect(
          getProjectAiNotices({
            context,
            aiState: ProjectAiState.Off,
            providerState,
            isChangedHere: false,
          }),
        ).toEqual([ProjectAiNoticeKind.AiOff]);
      }
    }
  });

  test("AI Features never says AI is off: its switch is the page", () => {
    expect(
      getProjectAiNotices({
        context: ProjectAiNoticeContext.AiFeatures,
        aiState: ProjectAiState.Off,
        providerState: ProjectAiProviderState.Missing,
        isChangedHere: false,
      }),
    ).toEqual([]);
    expect(
      getProjectAiNotices({
        context: ProjectAiNoticeContext.AiFeatures,
        aiState: ProjectAiState.On,
        providerState: ProjectAiProviderState.Missing,
        isChangedHere: false,
      }),
    ).toEqual([ProjectAiNoticeKind.ProviderMissing]);
  });

  test("AI on with no provider to use: which of the two it is", () => {
    for (const context of contexts) {
      expect(
        getProjectAiNotices({
          context,
          aiState: ProjectAiState.On,
          providerState: ProjectAiProviderState.Missing,
          isChangedHere: false,
        }),
      ).toEqual([ProjectAiNoticeKind.ProviderMissing]);
      expect(
        getProjectAiNotices({
          context,
          aiState: ProjectAiState.On,
          providerState: ProjectAiProviderState.NoDefault,
          isChangedHere: false,
        }),
      ).toEqual([ProjectAiNoticeKind.ProviderNoDefault]);
    }
  });

  test("turned on from the notice, it stays, with the provider's notice under it when one is missing", () => {
    expect(
      getProjectAiNotices({
        context: ProjectAiNoticeContext.Incidents,
        aiState: ProjectAiState.On,
        providerState: ProjectAiProviderState.Missing,
        isChangedHere: true,
      }),
    ).toEqual([ProjectAiNoticeKind.AiOff, ProjectAiNoticeKind.ProviderMissing]);
    expect(
      getProjectAiNotices({
        context: ProjectAiNoticeContext.Incidents,
        aiState: ProjectAiState.On,
        providerState: ProjectAiProviderState.Usable,
        isChangedHere: true,
      }),
    ).toEqual([ProjectAiNoticeKind.AiOff]);
  });

  test("the provider is read from what the chat's providers endpoint answers", () => {
    expect(
      getProjectAiProviderState({
        defaultProviderId: "9d9d9d9d-0000-4000-8000-000000000001",
        providers: [],
      }),
    ).toBe(ProjectAiProviderState.Usable);
    expect(
      getProjectAiProviderState({ defaultProviderId: null, providers: [] }),
    ).toBe(ProjectAiProviderState.Missing);
    expect(
      getProjectAiProviderState({
        defaultProviderId: null,
        providers: [{ id: "a" }],
      }),
    ).toBe(ProjectAiProviderState.NoDefault);
    // Anything it cannot read says nothing.
    for (const answer of [
      null,
      undefined,
      "error",
      [],
      {},
      { defaultProviderId: "" },
      { providers: "many" },
    ]) {
      expect(getProjectAiProviderState(answer)).toBe(
        ProjectAiProviderState.Unknown,
      );
    }
  });

  test("Enable AI is off only when it says false: the column is NOT NULL DEFAULT true", () => {
    expect(getProjectAiState({ enableAi: false })).toBe(ProjectAiState.Off);
    expect(getProjectAiState({ enableAi: true })).toBe(ProjectAiState.On);
    expect(getProjectAiState({})).toBe(ProjectAiState.On);
    expect(getProjectAiState(null)).toBe(ProjectAiState.Unknown);
  });

  test("each page says what AI being off, or a missing provider, stops there", () => {
    for (const context of [...contexts, ProjectAiNoticeContext.AiFeatures]) {
      const copy: { aiOffDescription: string; providerConsequence: string } =
        PROJECT_AI_NOTICE_CONTEXT_COPY[context];

      expect([context, copy.aiOffDescription]).toEqual([
        context,
        expect.stringMatching(/^OneUptime AI is off for this project/),
      ]);
      expect([context, copy.providerConsequence]).toEqual([
        context,
        expect.stringMatching(/^Until it has one, /),
      ]);
    }

    // Insights are still found with AI off: the detectors use no AI.
    expect(
      PROJECT_AI_NOTICE_CONTEXT_COPY[ProjectAiNoticeContext.Insights]
        .aiOffDescription,
    ).toContain("Insights are still found");
  });

  test("the notices have test ids of their own", () => {
    expect(
      new Set([
        PROJECT_AI_OFF_NOTICE_TEST_ID,
        PROJECT_AI_OFF_SENTENCE_TEST_ID,
        PROJECT_AI_PROVIDER_NOTICE_TEST_ID,
        ENABLE_AI_NOTICE_SWITCH_TEST_ID,
        ENABLE_AI_SWITCH_TEST_ID,
        AI_LANE_SWITCHES_TEST_ID[AiLane.Incident],
        AI_LANE_SWITCHES_TEST_ID[AiLane.Alert],
        AI_LANE_ADVANCED_SECTION_TEST_ID[AiLane.Incident],
        AI_LANE_ADVANCED_SECTION_TEST_ID[AiLane.Alert],
        AI_INSIGHTS_SWITCHES_TEST_ID,
      ]).size,
    ).toBe(10);
  });
});

describe("what folded Advanced says", () => {
  function read(
    lane: AiLane,
    values: Record<string, unknown>,
    cards: Array<AiLaneAdvancedCard> = AI_LANE_ADVANCED_CARDS,
  ): AiLaneAdvancedState {
    let state: AiLaneAdvancedState = EMPTY_AI_LANE_ADVANCED_STATE;

    for (const card of cards) {
      state = recordAiLaneAdvancedCard({ state, lane, card, item: values });
    }

    return state;
  }

  test("the three cards hold the lane's six limits, two each, once", () => {
    for (const lane of [AiLane.Incident, AiLane.Alert]) {
      const columns: Array<string> = AI_LANE_ADVANCED_CARDS.flatMap(
        (card: AiLaneAdvancedCard): Array<string> => {
          return getAiLaneAdvancedCardColumns(lane, card);
        },
      );

      expect(columns).toHaveLength(6);
      expect([...columns].sort()).toEqual(
        Object.values(AI_LANE_ADVANCED_COLUMNS[lane]).sort(),
      );
    }
  });

  test("once every card has read and nothing is set, it says what the defaults do", () => {
    expect(
      getAiLaneAdvancedSummary(AiLane.Incident, read(AiLane.Incident, {})),
    ).toBe(
      "Every incident is investigated, whatever its severity, and nothing limits how much OneUptime AI does.",
    );
    expect(getAiLaneAdvancedSummary(AiLane.Alert, read(AiLane.Alert, {}))).toBe(
      "Every alert is investigated, whatever its severity, and nothing limits how much OneUptime AI does.",
    );
  });

  test("before every card has read, it claims nothing", () => {
    expect(
      getAiLaneAdvancedSummary(
        AiLane.Incident,
        read(AiLane.Incident, {}, [AiLaneAdvancedCard.WhichAreInvestigated]),
      ),
    ).toBeUndefined();
  });

  test("any limit set - 0 included, which pauses - makes it Configured, with no defaults claim", () => {
    for (const lane of [AiLane.Incident, AiLane.Alert]) {
      for (const column of Object.values(AI_LANE_ADVANCED_COLUMNS[lane])) {
        const state: AiLaneAdvancedState = read(lane, { [column]: 0 });

        expect([column, isAiLaneAdvancedConfigured(lane, state)]).toEqual([
          column,
          true,
        ]);
        expect([column, getAiLaneAdvancedSummary(lane, state)]).toEqual([
          column,
          undefined,
        ]);
      }
    }
  });

  test("the other lane's limits are not this lane's", () => {
    expect(
      isAiLaneAdvancedConfigured(
        AiLane.Incident,
        read(AiLane.Incident, { alertAiDailyFixTaskLimit: 0 }),
      ),
    ).toBe(false);
  });

  test("what counts as set", () => {
    expect(isAiLaneAdvancedValueSet(null)).toBe(false);
    expect(isAiLaneAdvancedValueSet(undefined)).toBe(false);
    expect(isAiLaneAdvancedValueSet("")).toBe(false);
    expect(isAiLaneAdvancedValueSet(Number.NaN)).toBe(false);
    expect(isAiLaneAdvancedValueSet(0)).toBe(true);
    expect(isAiLaneAdvancedValueSet(30)).toBe(true);
    // A picked severity, as the card reads it.
    expect(isAiLaneAdvancedValueSet({ name: "Critical" })).toBe(true);
  });

  test("a card reading again replaces what it read before", () => {
    let state: AiLaneAdvancedState = read(AiLane.Incident, {
      incidentAiDailyFixTaskLimit: 5,
    });

    expect(isAiLaneAdvancedConfigured(AiLane.Incident, state)).toBe(true);

    state = recordAiLaneAdvancedCard({
      state,
      lane: AiLane.Incident,
      card: AiLaneAdvancedCard.DailyLimits,
      item: {},
    });

    expect(isAiLaneAdvancedConfigured(AiLane.Incident, state)).toBe(false);
    expect(state.loadedCards).toHaveLength(3);
  });
});

describe("the old pages' wording is gone from the dashboard", () => {
  const sources: Array<string> = listSources(DASHBOARD_SRC);

  test.each([
    "Automatic Incident Investigation",
    "Automatic Alert Investigation",
    "Automatically Investigate Incidents",
    "Automatically Investigate Alerts",
    "Instrumentation PRs From Inconclusive Investigations",
    "Enable Automatic Incident Code Fixes",
    "Enable Automatic Alert Code Fixes",
    "Automatic Postmortem Draft",
    "Draft a postmortem automatically when an incident resolves",
    "Enable AI Insights (proactive telemetry watch)",
    "Automatically open fix PRs from insights",
    "Auto-archive expected-denial exceptions",
    "Edit AI Features",
    "Requires an LLM provider to be configured in Project Settings > AI > LLM Providers.",
    "deterministic statistical sensors file quiet insights",
  ])("%s", (text: string) => {
    // In code: the comments that say what was replaced may name it.
    const using: Array<string> = sources
      .filter((file: string): boolean => {
        return readSource(file).includes(text);
      })
      .map((file: string): string => {
        return path.relative(DASHBOARD_SRC, file);
      });

    expect(using).toEqual([]);
  });
});

describe("translations", () => {
  // New with this change: every locale has its own words for them.
  const strings: Array<string> = Array.from(
    new Set([
      ...ALL_SWITCHES.flatMap(
        (definition: ProjectAiSwitchDefinition<string>): Array<string> => {
          return [
            definition.title,
            definition.description,
            ...(definition.note ? [definition.note] : []),
          ];
        },
      ),
      ...[AiLane.Incident, AiLane.Alert].flatMap(
        (lane: AiLane): Array<string> => {
          return [
            AI_LANE_PAGE_COPY[lane].switchesCardTitle,
            AI_LANE_PAGE_COPY[lane].switchesCardDescription,
            AI_LANE_PAGE_COPY[lane].advancedDescription,
            AI_LANE_PAGE_COPY[lane].advancedDefaultsSummary,
          ];
        },
      ),
      AiInsightsSettingsCopy.cardDescription,
      EnableAiCopy.turnOffConfirmTitle,
      EnableAiCopy.turnOffConfirmDescription,
      EnableAiCopy.turnOffConfirmButton,
      ...Object.values(PROJECT_AI_NOTICE_CONTEXT_COPY).flatMap(
        (copy: {
          aiOffDescription: string;
          providerConsequence: string;
        }): Array<string> => {
          return [copy.aiOffDescription, copy.providerConsequence];
        },
      ),
      ProjectAiNoticeCopy.aiOnDescription,
      ProjectAiNoticeCopy.providerMissing,
      ProjectAiNoticeCopy.providerNoDefault,
      ProjectAiNoticeCopy.addProviderLink,
      ProjectAiNoticeCopy.chooseDefaultProviderLink,
      // The Advanced cards, written on the pages themselves.
      "Which incidents are investigated",
      "Which alerts are investigated",
      "Every new incident is investigated unless you narrow it down here.",
      "Every new alert is investigated unless you narrow it down here.",
      "Investigation limits",
      "Investigations start right away and run until they are done unless you set a limit here.",
      "Daily limits",
      "How much incident AI work may run each day (UTC). Ask AI is never limited.",
      "How much alert AI work may run each day (UTC). Ask AI is never limited.",
      "The most tokens incident AI work may use each day: investigations, remediation and fix tasks. Leave empty for no limit, or set 0 to pause it.",
      "The most tokens alert AI work may use each day: investigations, remediation and fix tasks. Leave empty for no limit, or set 0 to pause it.",
      "How many fix pull requests OneUptime AI may start on for incidents each day, whether someone asked for one or not. Leave empty for no limit, or set 0 to pause them.",
      "How many fix pull requests OneUptime AI may start on for alerts each day, whether someone asked for one or not. Leave empty for no limit, or set 0 to pause them.",
    ]),
  );

  // Names and sentences every locale already had, kept as they were.
  const existing: Array<string> = [
    EnableAiCopy.cardTitle,
    EnableAiCopy.cardDescription,
    EnableAiCopy.switchTitle,
    EnableAiCopy.switchDescription,
    EnableAiCopy.whoCanTurnOn,
    AiInsightsSettingsCopy.cardTitle,
    "Minimum Severity To Investigate",
    "Re-investigation Cooldown (Minutes)",
    "Max Concurrent Incident Investigations",
    "Max Concurrent Alert Investigations",
    "Incident Investigation Time Limit (Minutes)",
    "Alert Investigation Time Limit (Minutes)",
    "Daily Incident AI Token Limit",
    "Daily Alert AI Token Limit",
    "Daily Incident AI Fix Task Limit",
    "Daily Alert AI Fix Task Limit",
    "Every severity",
    "No cooldown",
    "No limit",
    "No time limit",
    "Configured",
    "Advanced",
  ];

  test("en.json maps every string to itself", () => {
    const english: Record<string, unknown> = readLocale("en");

    // A list that found nothing would pass vacuously.
    expect(strings.length).toBeGreaterThan(40);

    for (const text of [...strings, ...existing]) {
      expect([text, english[text]]).toEqual([text, text]);
    }
  });

  test.each(OTHER_LOCALES)(
    "%s has its own words for every new string",
    (locale: string) => {
      const translations: Record<string, unknown> = readLocale(locale);

      for (const text of strings) {
        expect([text, typeof translations[text]]).toEqual([text, "string"]);
        expect([text, translations[text]]).not.toEqual([text, text]);
      }

      for (const text of existing) {
        expect([text, typeof translations[text]]).toEqual([text, "string"]);
      }
    },
  );
});
