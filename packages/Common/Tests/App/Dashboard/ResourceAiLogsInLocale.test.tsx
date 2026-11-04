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
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import React from "react";
import { MemoryRouter, Route as PageRoute, Routes } from "react-router-dom";
import ResourceAiLogsPage from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiLogsPage";
import {
  RESOURCE_AI_LOGS_EMPTY_TITLE,
  RESOURCE_AI_LOGS_PAGE_TITLE,
  RESOURCE_COMMAND_JOB_ORIGIN_LABELS,
  getResourceCommandStatusLook,
  getResourceCommandStatusOptions,
  getResourceFixStatusLook,
  getResourceInvestigationStatusLook,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiLogs";
import {
  ResourceAiAgentDescriptor,
  getResourceAiAgentDescriptor,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentDescriptors";
import { APPROVED_BY_LABEL } from "../../../../App/FeatureSet/Dashboard/src/Components/Runbook/RunbookExecutionWaitCopy";
import {
  CLOUD_AI_CHANGE_APPLIED_AUTOMATICALLY,
  CLOUD_AI_CHANGE_APPROVED_BY,
  CLOUD_AI_CHANGE_BY,
  CLOUD_AI_CHANGE_LOGS,
  CLOUD_AI_CHANGE_SUBJECTS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudAiChangeWords";
import {
  GCP_HOST_DESCRIPTIONS,
  GCP_HOST_TITLES,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudAiAgentSetup";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import RunnerJob from "../../../Models/DatabaseModels/RunnerJob";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import {
  Gray500,
  Green500,
  Red500,
  Yellow500,
} from "../../../Types/BrandColors";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAccessStatus,
  ResourceAiRemediationMode,
} from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import RunnerJobOrigin from "../../../Types/Runbook/RunnerJobOrigin";
import RunnerJobStatus from "../../../Types/Runbook/RunnerJobStatus";
import { toSentenceTerm } from "../../../Types/Translator";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import User from "../../../UI/Utils/User";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * A RESOURCE'S AI LOGS PAGE IN EVERY LANGUAGE (#5367's follow-up).
 *
 * The page's older sentences - its subtitle, its empty state, what the
 * investigations, fixes and commands cards say, a subject with its number,
 * a fix's status, how a command ended - read English in most languages,
 * and every sentence a German or Persian reader saw named the account in
 * English too. Each is now the language's own.
 *
 * Read from the shipped locale files: every key the page shows, the words
 * a change OneUptime AI made carries on an account's Changes, and the
 * words Google Cloud's agent host is picked with, in all 16 languages - a
 * key that lost its translation, kept the English (where the language
 * does not keep that word as English writes it) or lost a placeholder is
 * caught. A key the page gains without being listed here is caught too,
 * so a new sentence cannot ship in English alone.
 *
 * Then the page itself, rendered for an AWS account in German and in
 * Persian: every heading, sentence, pill and link in the locale's words,
 * and a command that was never picked up said so, never as "TimedOut".
 */

const WAIT_TIMEOUT: number = 20000;

const LANGUAGES: Array<string> = [
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

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const COMPONENTS_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Components",
);

type Locale = Record<string, string>;

function readLocale(code: string): Locale {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
  ) as Locale;
}

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(COMPONENTS_DIR, relativePath), "utf8");
}

const ENGLISH: Locale = readLocale("en");

const AI_LOGS_FILES: Array<string> = [
  "ResourceAiAgent/ResourceAiLogs.ts",
  "ResourceAiAgent/ResourceAiLogsPage.tsx",
];

// Each sentence the page writes out, exactly as it is written there.
const AI_LOGS_SENTENCES: Array<string> = [
  "Everything OneUptime AI did on this {{noun}}, newest first: every investigation, fix and command.",
  "When an incident or alert on this {{noun}} is investigated, the findings, proposed fixes and every command AI ran appear here.",
  "Every command OneUptime AI ran on this {{noun}} through the {{agent}} — while investigating (read-only), for fixes, and for connection tests — with its result.",
  "OneUptime AI has not run any commands on this {{noun}} yet.",
  "Investigation (read-only)",
  "Connection test (read-only)",
  "Dry run of a fix (read-only)",
  "Fix",
  "Command plan",
  "Runbook",
  "Incident #{{number}}: {{title}}",
  "Incident #{{number}}",
  "Incident: {{title}}",
  "Incident",
  "Alert: {{title}}",
  "Alert",
  "Investigation",
  "Still investigating.",
  "No summary was recorded.",
  "Open the AI agent page",
  "Open incident",
  "Open alert",
  "No reason was recorded.",
  "The server returned AI logs this page cannot read.",
  "Could not load AI logs.",
  "Investigations",
  "Incidents and alerts on this {{noun}} that OneUptime AI investigated, newest first.",
  "No investigations yet.",
  "Fixes",
  "Fixes OneUptime AI proposed or applied on this {{noun}}, newest first.",
  "No fixes yet.",
  "Command",
  "Commands",
  "Result",
  "Why",
  "When",
  "{{status}} (exit {{exitCode}})",
  "Seeing the commands needs permission to read Runner jobs (one of: {{permissions}}). Commands AI ran while investigating or fixing an incident or alert also appear on that incident or alert.",
];

// The page's words held in its module: titles, labels and every status.
const AI_LOGS_HELD_WORDS: Array<string> = [
  RESOURCE_AI_LOGS_PAGE_TITLE,
  RESOURCE_AI_LOGS_EMPTY_TITLE,
  APPROVED_BY_LABEL,
  ...Object.values(RESOURCE_COMMAND_JOB_ORIGIN_LABELS),
  ...Object.values(AIRunStatus).map((status: AIRunStatus): string => {
    return getResourceInvestigationStatusLook(status).label;
  }),
  ...Object.values(AutoRemediationSuggestionStatus).map(
    (status: AutoRemediationSuggestionStatus): string => {
      return getResourceFixStatusLook(status).label;
    },
  ),
  ...getResourceCommandStatusOptions().map(
    (option: { label: string }): string => {
      return option.label;
    },
  ),
];

interface WordGroup {
  name: string;
  words: Array<string>;
  // Where the words written out appear, as quoted literals.
  writtenIn: Array<string>;
  written: Array<string>;
}

const GROUPS: Array<WordGroup> = [
  {
    name: "a resource's AI Logs page",
    words: [...AI_LOGS_SENTENCES, ...AI_LOGS_HELD_WORDS],
    writtenIn: AI_LOGS_FILES,
    written: AI_LOGS_SENTENCES,
  },
  {
    // The AI pages name an incident or alert by its number the same way.
    name: "an alert by its number",
    words: ["Alert #{{number}}: {{title}}", "Alert #{{number}}"],
    writtenIn: ["AI/ActivityInsights/AiActivityInsightsData.ts"],
    written: ["Alert #{{number}}: {{title}}", "Alert #{{number}}"],
  },
  {
    name: "a change OneUptime AI made, on a cloud account's Changes",
    words: [
      CLOUD_AI_CHANGE_BY,
      CLOUD_AI_CHANGE_LOGS,
      CLOUD_AI_CHANGE_APPROVED_BY,
      CLOUD_AI_CHANGE_APPLIED_AUTOMATICALLY,
      ...Object.values(CLOUD_AI_CHANGE_SUBJECTS.fix),
      ...Object.values(CLOUD_AI_CHANGE_SUBJECTS.rollback),
    ],
    writtenIn: [],
    written: [],
  },
  {
    name: "where Google Cloud's agent runs, in its setup dialog",
    words: [
      ...Object.values(GCP_HOST_TITLES),
      ...Object.values(GCP_HOST_DESCRIPTIONS),
      "It runs on one small always-on VM in your project: about ${{usd}} a month at list prices, billed by your cloud. Google Cloud's free tier can cover it.",
      "Where the agent runs",
      "Runs on",
      "Log lines",
    ],
    writtenIn: ["Cloud/CloudAiAgentSetupModal.tsx"],
    written: [
      "It runs on one small always-on VM in your project: about ${{usd}} a month at list prices, billed by your cloud. Google Cloud's free tier can cover it.",
      "Where the agent runs",
      "Runs on",
      "Log lines",
    ],
  },
];

const ALL_WORDS: Array<string> = Array.from(
  new Set(
    GROUPS.flatMap((group: WordGroup): Array<string> => {
      return group.words;
    }),
  ),
);

/*
 * A word a language keeps as English writes it: a product's name, and the
 * words a language spells the same ("Incident" in French, Dutch and
 * Swedish, "Runbook" where it is the product's term).
 */
const KEPT_AS_ENGLISH: Readonly<Record<string, ReadonlyArray<string>>> = {
  "*": [CLOUD_AI_CHANGE_BY, GCP_HOST_TITLES["cloud-run"]],
  de: ["Runbook"],
  fr: ["Runbook", "Incident", "Investigation", "Investigations"],
  es: ["Runbook"],
  it: ["Runbook"],
  pt: ["Runbook"],
  nl: [
    "Runbook",
    "Incident",
    "Incident #{{number}}",
    "Incident #{{number}}: {{title}}",
    "Incident: {{title}}",
  ],
  da: ["Runbook"],
  no: ["Runbook"],
  sv: [
    "Runbook",
    "Incident",
    "Incident #{{number}}",
    "Incident #{{number}}: {{title}}",
    "Incident: {{title}}",
  ],
  ja: ["Runbook"],
};

const PLACEHOLDER: RegExp = /\{\{[a-zA-Z]+\}\}/g;

function placeholders(text: string): Array<string> {
  return Array.from(new Set(text.match(PLACEHOLDER) || [])).sort();
}

/*
 * The literal strings a source file hands to the translator or to a
 * component that translates it (a title, a label, a fallback message).
 * Each pattern is one quoted literal after a fixed prefix: linear.
 */
const TRANSLATED_LITERALS: Array<RegExp> = [
  /(?:translateTemplate|translationKey|translateText)\(\s*"((?:[^"\\\n]|\\.)*)"/g,
  /\b(?:title|label|singularName|pluralName)(?:=|:\s*)"((?:[^"\\\n]|\\.)*)"/g,
  /\|\|\s*"((?:[^"\\\n]|\\.)*)"/g,
];

// A literal with a letter in it: never a fallback such as "" or "…".
const HAS_A_LETTER: RegExp = /\p{L}/u;

function translatedLiteralsIn(source: string): Array<string> {
  const found: Set<string> = new Set();

  for (const pattern of TRANSLATED_LITERALS) {
    for (const match of source.matchAll(pattern)) {
      const literal: string = JSON.parse(`"${match[1]!}"`) as string;

      if (HAS_A_LETTER.test(literal)) {
        found.add(literal);
      }
    }
  }

  return Array.from(found);
}

describe("the words the AI Logs page and its neighbours show", () => {
  test("there is something to check", () => {
    expect(ALL_WORDS.length).toBeGreaterThan(70);
  });

  test.each(ALL_WORDS)("English holds %s under its own key", (key: string) => {
    expect(ENGLISH[key]).toBe(key);
  });

  test.each(
    GROUPS.filter((group: WordGroup): boolean => {
      return group.written.length > 0;
    }),
  )(
    "$name: each sentence listed is the one its page writes",
    (group: WordGroup) => {
      const source: string = group.writtenIn.map(readSource).join("\n");

      for (const sentence of group.written) {
        expect({
          sentence,
          written: source.includes(JSON.stringify(sentence)),
        }).toEqual({ sentence, written: true });
      }
    },
  );

  test("every word the AI Logs page hands the translator is checked here: a new one cannot ship in English alone", () => {
    const listed: Set<string> = new Set(ALL_WORDS);
    const unlisted: Array<string> = AI_LOGS_FILES.flatMap(
      (file: string): Array<string> => {
        return translatedLiteralsIn(readSource(file)).filter(
          (literal: string): boolean => {
            return !listed.has(literal);
          },
        );
      },
    );

    expect(unlisted).toEqual([]);
  });

  test("the scan finds what the page writes, so an empty list above means something", () => {
    const found: Array<string> = AI_LOGS_FILES.flatMap(
      (file: string): Array<string> => {
        return translatedLiteralsIn(readSource(file));
      },
    );

    expect(found).toEqual(
      expect.arrayContaining([
        "Could not load AI logs.",
        "Investigations",
        "Command plan",
        "{{status}} (exit {{exitCode}})",
        "Not picked up in time",
      ]),
    );
  });
});

describe.each(LANGUAGES)("the %s locale", (language: string) => {
  const words: Locale = readLocale(language);
  const kept: ReadonlyArray<string> = [
    ...(KEPT_AS_ENGLISH["*"] || []),
    ...(KEPT_AS_ENGLISH[language] || []),
  ];

  test.each(ALL_WORDS)(
    "words %s its own way, with the same placeholders",
    (key: string) => {
      const translated: string | undefined = words[key];

      expect(translated).toBeDefined();
      expect(translated!.trim().length).toBeGreaterThan(0);
      expect({
        key,
        translated: translated !== key || kept.includes(key),
      }).toEqual({ key, translated: true });
      expect(placeholders(translated!)).toEqual(placeholders(key));
    },
  );
});

describe("a command's result, in words", () => {
  test("every status a command ends in has words of its own and its colour", () => {
    expect(
      Object.values(RunnerJobStatus).map((status: RunnerJobStatus) => {
        return [status, getResourceCommandStatusLook(status)];
      }),
    ).toEqual([
      [RunnerJobStatus.Pending, { label: "Waiting to run", color: Yellow500 }],
      [RunnerJobStatus.Claimed, { label: "Starting", color: Yellow500 }],
      [RunnerJobStatus.Running, { label: "Running", color: Yellow500 }],
      [RunnerJobStatus.Succeeded, { label: "Succeeded", color: Green500 }],
      [RunnerJobStatus.Failed, { label: "Failed", color: Red500 }],
      [
        RunnerJobStatus.TimedOut,
        { label: "Not picked up in time", color: Red500 },
      ],
      [RunnerJobStatus.Cancelled, { label: "Cancelled", color: Gray500 }],
    ]);
  });

  test("the Result filter offers every status in the same words, by its value", () => {
    expect(getResourceCommandStatusOptions()).toEqual(
      Object.values(RunnerJobStatus).map((status: RunnerJobStatus) => {
        return {
          value: status,
          label: getResourceCommandStatusLook(status).label,
        };
      }),
    );
  });

  test("a status a newer server added shows as it is, in a neutral pill", () => {
    expect(getResourceCommandStatusLook("Paused")).toEqual({
      label: "Paused",
      color: Gray500,
    });
  });
});

/*
 * The page itself, rendered for an AWS account: what a German and a
 * Persian reader see.
 */

const RENDERED_LANGUAGES: Array<string> = ["de", "fa"];

const LOCALES: Record<string, Locale> = {
  de: readLocale("de"),
  fa: readLocale("fa"),
};

const AWS: ResourceAiAgentDescriptor = getResourceAiAgentDescriptor(
  AiResourceType.AwsAccount,
);

const RESOURCE_ID: string = "44444444-0000-4000-8000-000000000004";
const INCIDENT_ID: string = "aaaaaaaa-0000-4000-8000-000000000001";
const ALERT_ID: string = "bbbbbbbb-0000-4000-8000-000000000002";
const RUN_ID: string = "66666666-0000-4000-8000-000000000006";
const SECOND_RUN_ID: string = "66666666-0000-4000-8000-000000000007";
const FIX_ID: string = "77777777-0000-4000-8000-000000000001";
const SECOND_FIX_ID: string = "77777777-0000-4000-8000-000000000002";

const LOGS_ROUTE: string = "/resource-ai-access/logs";
const STATUS_ROUTE: string = "/resource-ai-access/status";

// The locale's wording of `key`, failing when it has none of its own.
function wordingIn(code: string, key: string): string {
  const value: string | undefined = LOCALES[code]![key];

  if (!value || value === key) {
    throw new Error(`${code}.json has no wording of its own for "${key}".`);
  }

  return value;
}

// The locale's sentence for `template`, its {{placeholders}} filled.
function filledIn(
  code: string,
  template: string,
  values: Record<string, string>,
): string {
  let sentence: string = wordingIn(code, template);

  for (const name of Object.keys(values)) {
    sentence = sentence.split(`{{${name}}}`).join(values[name]!);
  }

  return sentence;
}

// The account and its agent, as the locale's sentences name them.
function namesIn(code: string): Record<string, string> {
  return {
    noun: toSentenceTerm(wordingIn(code, AWS.noun), code),
    agent: wordingIn(code, AWS.agentName),
  };
}

function makeStatus(): ResourceAiAccessStatus {
  return {
    resourceType: AiResourceType.AwsAccount,
    resourceId: RESOURCE_ID,
    resourceName: "123456789012",
    isAiInvestigationEnabled: true,
    aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
    aiCommandAllowlist: [],
    agent: null,
    gaps: [],
    isInvestigationReady: true,
    isRemediationReady: true,
  };
}

function fullLogs(): JSONObject {
  return {
    resourceType: AiResourceType.AwsAccount,
    resourceId: RESOURCE_ID,
    investigations: [
      {
        aiRunId: RUN_ID,
        status: AIRunStatus.Completed,
        createdAt: "2026-11-03T09:00:00.000Z",
        completedAt: "2026-11-03T09:04:00.000Z",
        incident: { id: INCIDENT_ID, title: "checkout-api 5xx", number: 42 },
      },
      {
        aiRunId: SECOND_RUN_ID,
        status: AIRunStatus.Running,
        createdAt: "2026-11-03T09:30:00.000Z",
        alert: { id: ALERT_ID, title: "Queue depth" },
      },
    ],
    fixes: [
      {
        id: FIX_ID,
        status: AutoRemediationSuggestionStatus.AutoExecuted,
        suggestionType: AutoRemediationSuggestionType.CommandPlan,
        createdAt: "2026-11-03T09:05:00.000Z",
        incidentId: INCIDENT_ID,
      },
      {
        id: SECOND_FIX_ID,
        status: AutoRemediationSuggestionStatus.Approved,
        suggestionType: AutoRemediationSuggestionType.CommandPlan,
        rationale: "Scale checkout-api out to 4 tasks.",
        createdAt: "2026-11-03T09:35:00.000Z",
        alertId: ALERT_ID,
        approvedByName: "Maya Chen",
        approvedAt: "2026-11-03T09:36:00.000Z",
      },
    ],
    commandCounts: { investigation: 1, remediation: 2 },
  };
}

function makeJob(
  id: string,
  overrides: Partial<Record<keyof RunnerJob, unknown>> = {},
): RunnerJob {
  return Object.assign(
    new RunnerJob(),
    {
      _id: id,
      createdAt: new Date("2026-11-03T09:59:00Z"),
      origin: RunnerJobOrigin.AiRemediation,
      stepType: RunbookStepType.ResourceCommand,
      status: RunnerJobStatus.Succeeded,
      payload: { displayCommand: `cloud describe ${id}` },
      exitCode: 0,
    },
    overrides,
  );
}

let jobs: Array<RunnerJob> = [];

function grant(permissions: Array<Permission>): void {
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
  jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue(permissions);
  jest.spyOn(PermissionUtil, "getGlobalPermissions").mockReturnValue(null);
  jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue({
    projectId: new ObjectID(PROJECT_ID),
    userId: ObjectID.generate(),
    permissions: permissions.map((permission: Permission) => {
      return {
        permission: permission,
        labelIds: [],
        _type: "UserPermission",
      };
    }),
    _type: "UserTenantAccessPermission",
  } as unknown as ReturnType<typeof PermissionUtil.getProjectPermissions>);
}

async function setLanguage(code: string): Promise<void> {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage(code);
  });
}

function openLogsPage(): void {
  const pagePath: string = RouteMap[AWS.logsPage]!.toString()
    .replace(":projectId", PROJECT_ID)
    .replace(":id", RESOURCE_ID);
  goTo(pagePath);

  render(
    <MemoryRouter initialEntries={[pagePath]}>
      <Routes>
        <PageRoute
          path={String(RouteMap[AWS.logsPage])}
          element={
            <ResourceAiLogsPage
              descriptor={AWS}
              pageRoute={RouteMap[AWS.logsPage] as Route}
              currentProject={null}
              hasPaymentMethod={true}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

async function findTestId(testId: string): Promise<HTMLElement> {
  return await screen.findByTestId(testId, {}, { timeout: WAIT_TIMEOUT });
}

describe("an AWS account's AI Logs page in the reader's language", () => {
  beforeAll(async () => {
    await i18next.use(initReactI18next).init({
      lng: "de",
      fallbackLng: "en",
      resources: {
        de: { translation: LOCALES["de"]! },
        fa: { translation: LOCALES["fa"]! },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
  });

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    grant([
      Permission.Public,
      Permission.User,
      Permission.CurrentUser,
      Permission.ProjectMember,
    ]);

    jest
      .spyOn(API, "post")
      .mockImplementation(
        async (request: unknown): Promise<HTTPResponse<JSONObject>> => {
          const url: string = String((request as JSONObject)["url"]);
          if (url.endsWith(LOGS_ROUTE)) {
            return new HTTPResponse<JSONObject>(200, fullLogs(), {});
          }
          if (url.endsWith(STATUS_ROUTE)) {
            return new HTTPResponse<JSONObject>(
              200,
              makeStatus() as unknown as JSONObject,
              {},
            );
          }
          throw new Error(`Unexpected request to ${url}`);
        },
      );

    jobs = [
      makeJob("timed-out", {
        status: RunnerJobStatus.TimedOut,
        exitCode: undefined,
        payload: { displayCommand: "cloud scale-out checkout-api --count 4" },
      }),
      makeJob("failed", {
        status: RunnerJobStatus.Failed,
        exitCode: 1,
        payload: { displayCommand: "cloud restart checkout-api" },
      }),
    ];
    jest
      .spyOn(ModelAPI, "getList")
      .mockImplementation(
        async (args: unknown): Promise<ListResult<RunnerJob>> => {
          const request: { modelType?: unknown } = args as {
            modelType?: unknown;
          };
          if (request.modelType === RunnerJob) {
            return { data: jobs, count: jobs.length, skip: 0, limit: 10 };
          }
          return { data: [], count: 0, skip: 0, limit: 10 };
        },
      );
    jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await setLanguage("en");
  });

  test.each(RENDERED_LANGUAGES)(
    "%s: the heading, the subtitle and both cards name the account in the reader's words",
    async (code: string) => {
      await setLanguage(code);
      openLogsPage();

      const heading: HTMLElement = await findTestId("ai-logs-page-heading");
      expect(heading).toHaveTextContent(wordingIn(code, "AI Logs"));
      expect(heading).toHaveTextContent(
        filledIn(
          code,
          "Everything OneUptime AI did on this {{noun}}, newest first: every investigation, fix and command.",
          namesIn(code),
        ),
      );

      await waitFor(
        () => {
          expect(screen.getAllByTestId("ai-logs-fix")).toHaveLength(2);
        },
        { timeout: WAIT_TIMEOUT },
      );

      const page: string = document.body.textContent || "";
      for (const sentence of [
        filledIn(
          code,
          "Incidents and alerts on this {{noun}} that OneUptime AI investigated, newest first.",
          namesIn(code),
        ),
        filledIn(
          code,
          "Fixes OneUptime AI proposed or applied on this {{noun}}, newest first.",
          namesIn(code),
        ),
        wordingIn(code, "Investigations"),
        wordingIn(code, "Fixes"),
      ]) {
        expect({ sentence, shown: page.includes(sentence) }).toEqual({
          sentence,
          shown: true,
        });
      }
    },
  );

  test.each(RENDERED_LANGUAGES)(
    "%s: each investigation by its subject, its status and what it found",
    async (code: string) => {
      await setLanguage(code);
      openLogsPage();

      await waitFor(
        () => {
          expect(screen.getAllByTestId("ai-logs-investigation")).toHaveLength(
            2,
          );
        },
        { timeout: WAIT_TIMEOUT },
      );
      const [incident, alert] = screen.getAllByTestId(
        "ai-logs-investigation",
      ) as [HTMLElement, HTMLElement];

      expect(incident).toHaveTextContent(
        filledIn(code, "Incident #{{number}}: {{title}}", {
          number: "42",
          title: "checkout-api 5xx",
        }),
      );
      expect(incident).toHaveTextContent(wordingIn(code, "Completed"));
      expect(incident).toHaveTextContent(
        wordingIn(code, "No summary was recorded."),
      );

      expect(alert).toHaveTextContent(
        filledIn(code, "Alert: {{title}}", { title: "Queue depth" }),
      );
      expect(alert).toHaveTextContent(wordingIn(code, "Investigating"));
      expect(alert).toHaveTextContent(wordingIn(code, "Still investigating."));
    },
  );

  test.each(RENDERED_LANGUAGES)(
    "%s: each fix by its status, its kind, its record's link and its approver",
    async (code: string) => {
      await setLanguage(code);
      openLogsPage();

      await waitFor(
        () => {
          expect(screen.getAllByTestId("ai-logs-fix")).toHaveLength(2);
        },
        { timeout: WAIT_TIMEOUT },
      );
      const [automatic, approved] = screen.getAllByTestId("ai-logs-fix") as [
        HTMLElement,
        HTMLElement,
      ];

      expect(automatic).toHaveTextContent(
        wordingIn(code, "Applied automatically"),
      );
      expect(automatic).toHaveTextContent(wordingIn(code, "Command plan"));
      expect(automatic).toHaveTextContent(
        wordingIn(code, "No reason was recorded."),
      );
      expect(
        within(automatic).getByRole("link", {
          name: wordingIn(code, "Open incident"),
        }),
      ).toBeInTheDocument();

      expect(approved).toHaveTextContent(
        wordingIn(code, "Applied after approval"),
      );
      expect(
        within(approved).getByRole("link", {
          name: wordingIn(code, "Open alert"),
        }),
      ).toBeInTheDocument();
      expect(
        within(approved).getByTestId("ai-logs-fix-approved-by"),
      ).toHaveTextContent(`${wordingIn(code, "Approved by")} Maya Chen`);
    },
  );

  test.each(RENDERED_LANGUAGES)(
    "%s: how each command ended, in words: never TimedOut, and an exit code in the reader's sentence",
    async (code: string) => {
      await setLanguage(code);
      openLogsPage();

      const timedOut: HTMLElement = (
        await screen.findByText(
          "cloud scale-out checkout-api --count 4",
          {},
          { timeout: WAIT_TIMEOUT },
        )
      ).closest("tr")!;
      expect(timedOut).toHaveTextContent(
        wordingIn(code, "Not picked up in time"),
      );
      expect(timedOut).not.toHaveTextContent("TimedOut");

      const failed: HTMLElement = screen
        .getByText("cloud restart checkout-api")
        .closest("tr")!;
      expect(failed).toHaveTextContent(
        filledIn(code, "{{status}} (exit {{exitCode}})", {
          status: wordingIn(code, "Failed"),
          exitCode: "1",
        }),
      );
      expect(failed).not.toHaveTextContent("(exit 1)");
      // Why it ran: a fix, in the reader's word.
      expect(failed).toHaveTextContent(wordingIn(code, "Fix"));

      const page: string = document.body.textContent || "";
      expect(page).toContain(
        filledIn(
          code,
          "Every command OneUptime AI ran on this {{noun}} through the {{agent}} — while investigating (read-only), for fixes, and for connection tests — with its result.",
          namesIn(code),
        ),
      );
    },
  );

  test.each(RENDERED_LANGUAGES)(
    "%s: no English sentence of the page is left",
    async (code: string) => {
      await setLanguage(code);
      openLogsPage();

      await waitFor(
        () => {
          expect(screen.getAllByTestId("ai-logs-fix")).toHaveLength(2);
          expect(
            screen.getByText("cloud restart checkout-api"),
          ).toBeInTheDocument();
        },
        { timeout: WAIT_TIMEOUT },
      );

      const page: string = document.body.textContent || "";
      for (const english of [
        "newest first",
        "Everything OneUptime AI did",
        "Applied automatically",
        "Applied after approval",
        "Open incident",
        "Open alert",
        "Command plan",
        "Still investigating",
        "No summary was recorded",
        "No reason was recorded",
        "Not picked up in time",
        "through the",
      ]) {
        expect({ english, left: page.includes(english) }).toEqual({
          english,
          left: false,
        });
      }
    },
  );
});
