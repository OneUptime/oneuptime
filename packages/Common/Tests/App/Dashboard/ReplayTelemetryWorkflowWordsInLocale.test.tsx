/**
 * @timezone UTC
 */
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
import { cleanup, render } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import OneUptimeDate from "../../../Types/Date";
import {
  inEnglishDates,
  withDateDisplayLanguage,
} from "../../../Types/DateLanguage";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { createTranslator, Translator } from "../../../Types/Translator";
import {
  TraceHealthHint,
  TraceHealthReport,
} from "../../../Types/Telemetry/TraceHealth";
import TracePipelineProcessorType from "../../../Types/Trace/TracePipelineProcessorType";
import {
  OAuth2GrantType,
  WorkflowVariableType,
} from "../../../Types/Workflow/WorkflowVariableOAuth";
import { UserFlowJourney } from "../../../Utils/Rum/UserFlow";
import TracePipelineProcessor from "../../../Models/DatabaseModels/TracePipelineProcessor";
import WorkflowVariable from "../../../Models/DatabaseModels/WorkflowVariable";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { getTranslatedLineDirection } from "../../../UI/Utils/LineDirection";

/*
 * SESSION REPLAY, USER FLOWS, TRACES, TRACE PIPELINES, TEAMS AND WORKFLOW
 * VARIABLES IN THE READER'S LANGUAGE - drawn from the Dashboard's shipped
 * locale files (#6752).
 *
 * An Italian, Korean, Hindi or Persian reader met these screens in English:
 * a trace pipeline's processor form ("Status Remapper Configuration", "How
 * it works", "first match wins"), a service's Trace health card and what its
 * numbers were measured on, a person's journeys ("Landing page", "Visit 2 to
 * this page", "2 returns to an earlier page"), a user with no teams, and a
 * workflow variable's Update Content and Update Credentials dialogs. Each is
 * drawn here in those languages, and none of the English is left on screen.
 */

// What the dialogs wrote: opening one writes nothing.
const mockUpdates: Array<JSONObject> = [];

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      updateById: (request: { data: JSONObject }): Promise<unknown> => {
        mockUpdates.push(request.data);
        return Promise.resolve(new HTTPResponse<JSONObject>(200, {}, {}));
      },
      create: (): Promise<unknown> => {
        return Promise.resolve(new HTTPResponse<JSONObject>(200, {}, {}));
      },
      getList: (): Promise<unknown> => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 10 });
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (): Promise<unknown> => {
        return Promise.resolve(new HTTPResponse<JSONObject>(200, {}, {}));
      },
      get: (): Promise<unknown> => {
        return Promise.resolve(new HTTPResponse<JSONObject>(200, {}, {}));
      },
      getFriendlyMessage: (error: unknown): string => {
        return error instanceof Error ? error.message : "Request failed.";
      },
    },
  };
});

import TraceProcessorForm from "../../../../App/FeatureSet/Dashboard/src/Components/TracePipeline/TraceProcessorForm";
import TraceHealthCard from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TraceHealthCard";
import { describeTraceHealthSample } from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TraceHealthPresentation";
import UserFlowJourneys from "../../../../App/FeatureSet/Dashboard/src/Components/UserFlow/UserFlowJourneys";
import TeamsElement from "../../../../App/FeatureSet/Dashboard/src/Components/Team/TeamsElement";
import UpdateWorkflowVariableContentModal from "../../../../App/FeatureSet/Dashboard/src/Components/Workflow/UpdateWorkflowVariableContentModal";
import UpdateWorkflowVariableCredentialsModal from "../../../../App/FeatureSet/Dashboard/src/Components/Workflow/UpdateWorkflowVariableCredentialsModal";
import WorkflowVariableTokenStatus from "../../../../App/FeatureSet/Dashboard/src/Components/Workflow/WorkflowVariableTokenStatus";
import WorkflowVariableTokenRefreshModal from "../../../../App/FeatureSet/Dashboard/src/Components/Workflow/WorkflowVariableTokenRefreshModal";
import {
  TokenRefreshOutcome,
  getTokenRefreshDescription,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Workflow/WorkflowVariableUtil";
import UserFlowScopeBanner from "../../../../App/FeatureSet/Dashboard/src/Components/UserFlow/UserFlowScopeBanner";

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

/*
 * Four of the twelve languages these keys were missing from: two scripts
 * written from the left, one with its own digits and full stop, and one read
 * from the right.
 */
const LANGUAGES: Array<string> = ["it", "ko", "hi", "fa"];

const EN: Record<string, string> = readLocale("en");
const LOCALES: Record<string, Record<string, string>> = {};

for (const language of LANGUAGES) {
  LOCALES[language] = readLocale(language);
}

// A {{placeholder}}.
const PLACEHOLDER: RegExp = /\{\{[^}]+\}\}/;

// A letter of any script.
const LETTER: RegExp = /\p{L}/u;

/*
 * The pieces of a sentence a reader sees whatever is filled in: the words
 * between its {{placeholders}}. A value may be written the reader's way (a
 * Persian digit, a localized date), so the pieces are checked, not the
 * filled-in whole.
 */
function piecesOf(sentence: string): Array<string> {
  return sentence
    .split(PLACEHOLDER)
    .map((piece: string): string => {
      return piece.trim();
    })
    .filter((piece: string): boolean => {
      return piece.length > 1 && LETTER.test(piece);
    });
}

function shownOnPage(): string {
  return withoutIsolateMarks(document.body.textContent || "");
}

interface Gaps {
  language: string;
  // Keys whose words in `language` are not on screen.
  missing: Array<string>;
  // Keys whose English is on screen.
  english: Array<string>;
}

/*
 * Which of `keys` the text does not show in `language`, and which it shows in
 * English. A key must be worded in the language (not its English).
 */
function gapsIn(
  language: string,
  text: string,
  keys: Array<string>,
  locale: Record<string, string> = LOCALES[language] as Record<string, string>,
): Gaps {
  const gaps: Gaps = { language, missing: [], english: [] };

  for (const key of keys) {
    const words: string | undefined = locale[key];
    const english: string = EN[key] as string;

    if (!words || words === english) {
      gaps.english.push(key);
      continue;
    }

    const shown: boolean = piecesOf(words).every((piece: string): boolean => {
      return text.includes(piece);
    });

    if (!shown) {
      gaps.missing.push(key);
    }

    const englishPieces: Array<string> = piecesOf(english).filter(
      (piece: string): boolean => {
        // A piece of one word ("Visit") could be anyone's; a phrase is ours.
        return piece.includes(" ") && !words.includes(piece);
      },
    );

    if (
      englishPieces.length > 0 &&
      englishPieces.every((piece: string): boolean => {
        return text.includes(piece);
      })
    ) {
      gaps.english.push(key);
    }
  }

  return gaps;
}

function expectDrawnIn(language: string, keys: Array<string>): void {
  expect(gapsIn(language, shownOnPage(), keys)).toEqual({
    language,
    missing: [],
    english: [],
  });
}

// The plural form `language` picks for `count`: "_one", or the general key.
function pluralKey(language: string, key: string, count: number): string {
  return new Intl.PluralRules(language).select(count) === "one" &&
    EN[`${key}_one`] !== undefined
    ? `${key}_one`
    : key;
}

function translatorFor(language: string): Translator {
  const locale: Record<string, string> = LOCALES[language] as Record<
    string,
    string
  >;

  return createTranslator((key: string): string | undefined => {
    return locale[key];
  }, language);
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {
    en: { translation: EN },
  };

  for (const language of LANGUAGES) {
    // A copy: a test that rewords a sentence must not reword the file read.
    resources[language] = {
      translation: { ...(LOCALES[language] as Record<string, string>) },
    };
  }

  await i18next.use(initReactI18next).init({
    lng: "it",
    fallbackLng: "en",
    resources,
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  mockUpdates.length = 0;
});

afterEach(async () => {
  cleanup();
  await i18next.changeLanguage("it");
});

// A trace pipeline processor of `type`, open for editing.
function renderProcessor(
  type: TracePipelineProcessorType,
  configuration: JSONObject,
): void {
  const processor: TracePipelineProcessor = new TracePipelineProcessor();

  processor.name = "Map";
  processor.processorType = type;
  processor.configuration = configuration;

  render(
    <TraceProcessorForm
      pipelineId={new ObjectID("5f8b7c1e2d3a4b5c6d7e8f90")}
      existingProcessor={processor}
      onProcessorSaved={(): void => {
        return;
      }}
      onCancel={(): void => {
        return;
      }}
    />,
  );
}

// The dialog's own words, whatever the processor does.
const PROCESSOR_DIALOG_KEYS: Array<string> = [
  "Edit Processor",
  "Save Processor",
];

const PROCESSORS: Array<{
  type: TracePipelineProcessorType;
  configuration: JSONObject;
  keys: Array<string>;
}> = [
  {
    type: TracePipelineProcessorType.AttributeRemapper,
    configuration: {
      sourceKey: "src_ip",
      targetKey: "source_ip",
      preserveSource: false,
      overrideOnConflict: true,
    },
    keys: [
      "Attribute Remapper Configuration",
      "1. Reads the value from {{key}}.",
      "2. Writes that value to {{key}}.",
      "3. Optionally removes the original source key (if Preserve Source is off).",
    ],
  },
  {
    type: TracePipelineProcessorType.SpanNameRemapper,
    configuration: {
      sourceKey: "http.route",
      mappings: [{ matchValue: "/ship", newName: "Ship" }],
    },
    keys: [
      "Span Name Remapper Configuration",
      "2. Looks up the value in your mappings below.",
    ],
  },
  {
    type: TracePipelineProcessorType.StatusRemapper,
    configuration: {
      sourceKey: "http.response.status_code",
      mappings: [{ matchValue: "200", statusCode: 1 }],
    },
    keys: [
      "Status Remapper Configuration",
      "Overrides the span's status code and (optionally) status message based on an attribute value.",
      "2. Looks up the value in your mappings below.",
    ],
  },
  {
    type: TracePipelineProcessorType.SpanKindRemapper,
    configuration: {
      sourceKey: "rpc.system",
      mappings: [{ matchValue: "grpc", kind: "server" }],
    },
    keys: [
      "Span Kind Remapper Configuration",
      "Overrides the span kind (Server / Client / Producer / Consumer / Internal) based on an attribute value.",
      "2. Looks up the value in your mappings below.",
    ],
  },
  {
    type: TracePipelineProcessorType.CategoryProcessor,
    configuration: {
      targetKey: "category",
      categories: [{ name: "Slow", filterQuery: "" }],
    },
    keys: [
      "Category Processor Configuration",
      "first match wins",
      "1. Each category rule has a filter condition (e.g. {{example}}).",
      "2. Rules are evaluated top to bottom. The first rule that matches the span is applied.",
      "Category name",
      "When spans match",
    ],
  },
];

describe("a trace pipeline's processor form in Italian, Korean, Hindi and Persian", () => {
  for (const language of LANGUAGES) {
    for (const processor of PROCESSORS) {
      test(`${language}: the ${processor.type} form says what it does in the reader's words`, async () => {
        await i18next.changeLanguage(language);
        renderProcessor(processor.type, processor.configuration);

        expectDrawnIn(language, [...PROCESSOR_DIALOG_KEYS, ...processor.keys]);
      });
    }
  }
});

// A service whose traces lose spans, are often one span, and whose logs link to none.
const POOR_TRACES: TraceHealthReport = {
  startTime: "2026-10-27T10:00:00.000Z",
  endTime: "2026-10-27T11:00:00.000Z",
  samplePercent: 4,
  spanCount: 21034,
  traceCount: 8120,
  orphanSpanShare: 0.26,
  singleSpanTraceShare: 0.35,
  logCount: 900,
  logsLinkedShare: 0,
  hints: [
    TraceHealthHint.MissingParentSpans,
    TraceHealthHint.OneSpanTraces,
    TraceHealthHint.UnlinkedLogs,
  ],
};

const TRACE_HEALTH_KEYS: Array<string> = [
  "Trace health",
  "Whether this service's traces arrive whole, and whether its logs link to them.",
  "Traces with every span",
  "One-span traces",
  "Logs linked to a trace",
  "Some spans arrive without the span they belong to: usually a sender dropping spans under load, or a database proxy the Kubernetes agent does not recognise (add it to ebpf.databaseProxyNames).",
  "How the agent links spans",
  "Many traces are a single span: usually background work that no request started, or calls the agent could not link to the request they belong to.",
  "Why some traces are one span",
  "Most logs carry no trace id. Turn on log correlation in the agent, or send logs through your OpenTelemetry SDK.",
  "Link logs to traces",
];

// What the numbers were measured on, one sentence for each case.
const SAMPLE_SENTENCES: Array<{
  report: TraceHealthReport;
  key: string;
}> = [
  {
    report: POOR_TRACES,
    key: "Measured from {{start}} to {{end}} on a {{percent}}% sample of the traces this service has spans in, {{spans}} in {{traces}}, and on all of its logs: {{logs}}.",
  },
  {
    report: { ...POOR_TRACES, logCount: 0 },
    key: "Measured from {{start}} to {{end}} on a {{percent}}% sample of the traces this service has spans in: {{spans}} in {{traces}}.",
  },
  {
    report: { ...POOR_TRACES, samplePercent: 100 },
    key: "Measured from {{start}} to {{end}} on every trace this service has spans in, {{spans}} in {{traces}}, and on all of its logs: {{logs}}.",
  },
  {
    report: { ...POOR_TRACES, samplePercent: 100, logCount: 0 },
    key: "Measured from {{start}} to {{end}} on every trace this service has spans in: {{spans}} in {{traces}}.",
  },
];

describe("a service's Trace health card in Italian, Korean, Hindi and Persian", () => {
  for (const language of LANGUAGES) {
    test(`${language}: the title, the three numbers and what to do about each are the reader's`, async () => {
      await i18next.changeLanguage(language);
      render(
        <TraceHealthCard
          serviceId={new ObjectID("60000000-0000-4000-8000-000000000002")}
          report={POOR_TRACES}
        />,
      );

      expectDrawnIn(language, TRACE_HEALTH_KEYS);
    });

    test(`${language}: what the numbers were measured on is one sentence of the reader's for each case`, () => {
      for (const sample of SAMPLE_SENTENCES) {
        const sentence: string = withoutIsolateMarks(
          describeTraceHealthSample(sample.report, translatorFor(language)),
        );

        expect(gapsIn(language, sentence, [sample.key])).toEqual({
          language,
          missing: [],
          english: [],
        });
      }
    });
  }
});

// A visitor who landed, went to the cart, came back home and checked out.
const JOURNEY: UserFlowJourney = {
  sessionId: "session-1",
  startUnixMs: Date.parse("2026-10-27T10:00:00.000Z"),
  durationMs: 95000,
  deviceType: "desktop",
  browserName: "Firefox",
  countryCode: "IT",
  pages: ["/home", "/cart", "/home", "/checkout"],
  errorPages: new Set<string>(["/cart"]),
  frustrationPages: new Set<string>(["/checkout"]),
  hadErrors: true,
  hadFrustration: true,
  errorCount: 1,
  frustrationCount: 1,
  isTruncated: false,
  hasRecording: false,
};

// A visitor who opened one page and the session carried on past the read.
const CUT_SHORT: UserFlowJourney = {
  ...JOURNEY,
  sessionId: "session-2",
  pages: ["/pricing"],
  errorPages: new Set<string>(),
  frustrationPages: new Set<string>(),
  hadErrors: false,
  hadFrustration: false,
  errorCount: 0,
  frustrationCount: 0,
  isTruncated: true,
};

function stepTitles(): string {
  return Array.from(document.querySelectorAll("[title]"))
    .map((element: Element): string => {
      return withoutIsolateMarks(element.getAttribute("title") || "");
    })
    .join("\n");
}

describe("a person's journeys in Italian, Korean, Hindi and Persian", () => {
  for (const language of LANGUAGES) {
    test(`${language}: the list, its markers and each step's notes are the reader's`, async () => {
      await i18next.changeLanguage(language);
      render(
        <UserFlowJourneys
          journeys={[JOURNEY, CUT_SHORT]}
          rumApplicationId={
            new ObjectID("0193c0de-1111-4aaa-8bbb-000000000001")
          }
        />,
      );

      expectDrawnIn(language, [
        "Journeys",
        "Landing page",
        "Exit page",
        pluralKey(language, "{{count}} returns to an earlier page", 1),
        "the session went on past these pages",
      ]);

      expect(gapsIn(language, stepTitles(), ["Landed here"])).toEqual({
        language,
        missing: [],
        english: [],
      });
      expect(
        gapsIn(language, stepTitles(), [
          "Visit {{visit}} to this page",
          "Hit an error on this page",
          "Frustration signal on this page",
        ]),
      ).toEqual({ language, missing: [], english: [] });

      const steps: Element = document.querySelector(
        "[data-testid='user-flow-journey'] ol",
      ) as Element;

      expect(steps.getAttribute("aria-label")).toBe(
        LOCALES[language]!["Pages visited, in order"],
      );
    });

    test(`${language}: no journey to show says so in the reader's words`, async () => {
      await i18next.changeLanguage(language);
      render(
        <UserFlowJourneys
          journeys={[]}
          rumApplicationId={
            new ObjectID("0193c0de-1111-4aaa-8bbb-000000000001")
          }
        />,
      );

      expectDrawnIn(language, [
        "No session matches the filters above. Show all sessions or all devices to see the rest.",
      ]);
    });
  }
});

describe("a user with no teams in Italian, Korean, Hindi and Persian", () => {
  for (const language of LANGUAGES) {
    test(`${language}: says so in the reader's words`, async () => {
      await i18next.changeLanguage(language);
      render(<TeamsElement teams={[]} />);

      expectDrawnIn(language, ["No teams."]);
    });
  }
});

function staticVariable(): WorkflowVariable {
  const variable: WorkflowVariable = new WorkflowVariable();

  variable._id = "33333333-3333-4333-8333-333333333333";
  variable.name = "AirflowToken";
  variable.variableType = WorkflowVariableType.Static;

  return variable;
}

function refreshTokenVariable(): WorkflowVariable {
  const variable: WorkflowVariable = new WorkflowVariable();

  variable._id = "33333333-3333-4333-8333-333333333333";
  variable.name = "API_TOKEN";
  variable.variableType = WorkflowVariableType.OAuth2;
  variable.oauthGrantType = OAuth2GrantType.RefreshToken;

  return variable;
}

function placeholders(): Array<string> {
  return Array.from(document.querySelectorAll("[placeholder]")).map(
    (element: Element): string => {
      return element.getAttribute("placeholder") || "";
    },
  );
}

describe("a workflow variable's write-only dialogs in Italian, Korean, Hindi and Persian", () => {
  for (const language of LANGUAGES) {
    test(`${language}: Update Content names the content and why it is not shown`, async () => {
      await i18next.changeLanguage(language);
      render(
        <UpdateWorkflowVariableContentModal
          variable={staticVariable()}
          onClose={(): void => {
            return;
          }}
          onSuccess={(): void => {
            return;
          }}
        />,
      );

      expectDrawnIn(language, [
        "Update Content",
        "The new content of this variable. The stored content cannot be retrieved, so it is not shown here — what you type replaces it outright.",
      ]);
    });

    test(`${language}: Update Credentials names each field, what an empty one keeps and the save button`, async () => {
      await i18next.changeLanguage(language);
      render(
        <UpdateWorkflowVariableCredentialsModal
          variable={refreshTokenVariable()}
          onClose={(): void => {
            return;
          }}
          onSaved={(): void => {
            return;
          }}
        />,
      );

      expectDrawnIn(language, [
        "New Client Secret",
        "Leave empty to keep the saved client secret.",
        "New Refresh Token",
        "Leave empty to keep the saved refresh token. Paste a new one if your provider revoked the old one or it expired.",
        "Save and Refresh Token",
      ]);

      const locale: Record<string, string> = LOCALES[language] as Record<
        string,
        string
      >;

      expect(placeholders()).toEqual(
        expect.arrayContaining([
          locale["New client secret"],
          locale["New refresh token"],
        ]),
      );
      expect(placeholders()).not.toContain("New client secret");
      expect(mockUpdates).toEqual([]);
    });
  }
});

/*
 * THE UI REVIEW. What these screens still drew in English, or drew wrongly,
 * once their keys were worded.
 */

const TOKEN_NOW: Date = new Date("2026-09-22T12:00:00.000Z");

function oauthVariable(values: Record<string, unknown>): WorkflowVariable {
  const variable: WorkflowVariable = new WorkflowVariable();

  variable._id = "33333333-3333-4333-8333-333333333333";
  variable.name = "API_TOKEN";
  variable.variableType = WorkflowVariableType.OAuth2;
  variable.oauthGrantType = OAuth2GrantType.ClientCredentials;

  for (const [key, value] of Object.entries(values)) {
    (variable as unknown as Record<string, unknown>)[key] = value;
  }

  return variable;
}

// Each state of the Access Token card: its pill, the line under it, its date.
const TOKEN_STATES: Array<{
  name: string;
  values: Record<string, unknown>;
  keys: Array<string>;
  date?: Date | undefined;
}> = [
  {
    name: "not fetched yet",
    values: {},
    keys: ["Not fetched yet", "Fetched the first time a workflow uses it"],
  },
  {
    name: "valid",
    values: {
      oauthLastRefreshedAt: new Date("2026-09-22T11:30:00.000Z"),
      oauthAccessTokenExpiresAt: new Date("2026-09-22T12:30:00.000Z"),
    },
    keys: ["Valid", "Valid until {{date}}"],
    date: new Date("2026-09-22T12:30:00.000Z"),
  },
  {
    name: "expired",
    values: {
      oauthLastRefreshedAt: new Date("2026-09-22T10:00:00.000Z"),
      oauthAccessTokenExpiresAt: new Date("2026-09-22T11:00:00.000Z"),
    },
    keys: [
      "Expired",
      "Refreshes automatically the next time a workflow uses it",
    ],
  },
  {
    name: "no expiry reported",
    values: { oauthLastRefreshedAt: new Date("2026-09-22T11:59:00.000Z") },
    keys: [
      "No expiry reported",
      "Fetched {{date}}. The provider did not say when it expires, so every run fetches a new one",
    ],
    date: new Date("2026-09-22T11:59:00.000Z"),
  },
  {
    name: "refresh failed",
    values: {
      oauthLastRefreshError:
        "invalid_grant - Token has been expired or revoked.",
      oauthLastRefreshErrorAt: new Date("2026-09-22T11:55:00.000Z"),
      oauthLastRefreshedAt: new Date("2026-09-22T11:30:00.000Z"),
    },
    keys: ["Refresh failed"],
    date: new Date("2026-09-22T11:55:00.000Z"),
  },
];

// A date as `language` writes it, and as English does.
function datesOf(
  language: string,
  date: Date,
): { reader: string; english: string } {
  return {
    reader: withDateDisplayLanguage(language, (): string => {
      return OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(date);
    }),
    english: inEnglishDates((): string => {
      return OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(date);
    }),
  };
}

describe("a workflow variable's Access Token card in Italian, Korean, Hindi and Persian", () => {
  for (const language of LANGUAGES) {
    for (const state of TOKEN_STATES) {
      test(`${language}: a token ${state.name} is named and explained in the reader's words and dates`, async () => {
        await i18next.changeLanguage(language);
        withDateDisplayLanguage(language, (): void => {
          render(
            <WorkflowVariableTokenStatus
              variable={oauthVariable(state.values)}
              now={TOKEN_NOW}
            />,
          );
        });

        expectDrawnIn(language, state.keys);

        if (state.date) {
          const dates: { reader: string; english: string } = datesOf(
            language,
            state.date,
          );

          expect(dates.reader).not.toBe(dates.english);
          expect(shownOnPage()).toContain(dates.reader);
          expect(shownOnPage()).not.toContain(dates.english);
        }
      });
    }
  }
});

const SAVED_AND_FETCHED: TokenRefreshOutcome = {
  variableName: "API_TOKEN",
  savedWhat: "Client secret",
  expiresAt: new Date("2026-09-22T12:30:00.000Z"),
};

const SAVED_AND_REFUSED: TokenRefreshOutcome = {
  variableName: "API_TOKEN",
  savedWhat: "Client secret and refresh token",
  // The token endpoint's own answer, as OneUptime passes it on.
  error:
    "The token endpoint refused the request (HTTP 400): invalid_grant - Token has been expired or revoked.",
};

const FETCHED_WITHOUT_EXPIRY: TokenRefreshOutcome = {
  variableName: "API_TOKEN",
  savedWhat: "Refresh token",
  expiresAt: null,
};

const TOKEN_REFRESH_RESULTS: Array<{
  name: string;
  outcome: TokenRefreshOutcome;
  keys: Array<string>;
}> = [
  {
    name: "a token fetched after a save",
    outcome: SAVED_AND_FETCHED,
    keys: [
      "Access Token Fetched",
      "Client secret saved.",
      'OneUptime fetched a new access token for "{{name}}" from your identity provider. It is valid until {{date}}, and a new one is fetched automatically whenever a workflow is about to use it after that.',
    ],
  },
  {
    name: "a fetch refused after a save",
    outcome: SAVED_AND_REFUSED,
    keys: [
      "Could Not Fetch an Access Token",
      "Client secret and refresh token saved.",
      'OneUptime could not fetch an access token for "{{name}}": {{error}}',
    ],
  },
  {
    name: "a token with no expiry",
    outcome: FETCHED_WITHOUT_EXPIRY,
    keys: [
      "Access Token Fetched",
      "Refresh token saved.",
      'OneUptime fetched a new access token for "{{name}}" from your identity provider. The provider did not say when it expires, so every workflow run fetches a new one.',
    ],
  },
];

describe("what Refresh now, or saving new credentials, says in Italian, Korean, Hindi and Persian", () => {
  for (const language of LANGUAGES) {
    for (const result of TOKEN_REFRESH_RESULTS) {
      test(`${language}: ${result.name} is told in the reader's words, naming the variable and the provider's reason as they are`, async () => {
        await i18next.changeLanguage(language);
        withDateDisplayLanguage(language, (): void => {
          render(
            <WorkflowVariableTokenRefreshModal
              variableName="API_TOKEN"
              outcome={result.outcome}
              onClose={(): void => {
                return;
              }}
            />,
          );
        });

        expectDrawnIn(language, result.keys);
        expect(shownOnPage()).toContain("API_TOKEN");
        expect(shownOnPage()).not.toContain("OneUptime fetched");
        expect(shownOnPage()).not.toContain("saved.");

        if (result.outcome.error) {
          expect(shownOnPage()).toContain(result.outcome.error);
        }

        if (result.outcome.expiresAt) {
          const dates: { reader: string; english: string } = datesOf(
            language,
            result.outcome.expiresAt,
          );

          expect(shownOnPage()).toContain(dates.reader);
          expect(shownOnPage()).not.toContain(dates.english);
        }
      });
    }
  }

  /*
   * The provider's reason is English. Filled in as it was, it made a Persian
   * line read as English, so the line was laid out from the left and its
   * Persian words came out in the wrong order.
   */
  test("fa: the provider's English reason is set apart, so the line is still laid out as Persian", () => {
    const description: string = getTokenRefreshDescription(
      SAVED_AND_REFUSED,
      translatorFor("fa"),
    );

    expect(description).toContain(
      `\u2068${SAVED_AND_REFUSED.error as string}\u2069`,
    );
    expect(description).toContain("\u2068API_TOKEN\u2069");
    expect(getTranslatedLineDirection(description, "fa")).toBeUndefined();
    expect(
      getTranslatedLineDirection(withoutIsolateMarks(description), "fa"),
    ).toBe("ltr");
  });

  test("fa: a failed refresh's reason is drawn apart from the date before it, keeping its full stop at its end", async () => {
    await i18next.changeLanguage("fa");
    render(
      <WorkflowVariableTokenStatus
        variable={oauthVariable(
          TOKEN_STATES.find((state: (typeof TOKEN_STATES)[number]) => {
            return state.name === "refresh failed";
          })!.values,
        )}
        now={TOKEN_NOW}
      />,
    );

    const reason: Element | null = document.querySelector(
      "[data-testid='workflow-variable-token-status-detail'] bdi",
    );

    expect(reason?.textContent).toBe(
      "invalid_grant - Token has been expired or revoked.",
    );
    expect(reason?.getAttribute("dir")).toBe("ltr");
  });

  test("it: a failed refresh's reason on a page read from the left is plain text", async () => {
    await i18next.changeLanguage("it");
    render(
      <WorkflowVariableTokenStatus
        variable={oauthVariable(
          TOKEN_STATES.find((state: (typeof TOKEN_STATES)[number]) => {
            return state.name === "refresh failed";
          })!.values,
        )}
        now={TOKEN_NOW}
      />,
    );

    expect(
      document.querySelector(
        "[data-testid='workflow-variable-token-status-detail'] bdi",
      ),
    ).toBeNull();
    expect(
      document.querySelector(
        "[data-testid='workflow-variable-token-status-detail']",
      )?.textContent,
    ).toMatch(/: invalid_grant - Token has been expired or revoked\.$/);
  });

  test("without a translator the result is the English it always was", () => {
    expect(getTokenRefreshDescription(FETCHED_WITHOUT_EXPIRY)).toBe(
      'Refresh token saved. OneUptime fetched a new access token for "API_TOKEN" from your identity provider. The provider did not say when it expires, so every workflow run fetches a new one.',
    );
  });

  test("a sentence ending in a full-width stop runs on without a space, one ending in a full stop takes one", () => {
    const japanese: Record<string, string> = readLocale("ja");
    const description: string = getTokenRefreshDescription(
      FETCHED_WITHOUT_EXPIRY,
      createTranslator((key: string): string | undefined => {
        return japanese[key];
      }, "ja"),
    );

    expect(description.startsWith(japanese["Refresh token saved."]!)).toBe(
      true,
    );
    expect(description).not.toContain("\u3002 ");
    expect(
      getTokenRefreshDescription(FETCHED_WITHOUT_EXPIRY, translatorFor("it")),
    ).toContain(`${LOCALES["it"]!["Refresh token saved."]} OneUptime`);
  });
});

/*
 * Persian writes its zero as a dot. Beside a Persian count, the middle dot
 * between two facts read as one: "۷ صفحه · ۱ بازگشت" said ten returns, and
 * "کاربر شناسایی‌شده · ۳ نشست" thirty sessions.
 */
describe("facts on one line, set apart as the reader's language does", () => {
  const MIDDLE_DOT: string = "\u00b7";
  const BULLET: string = "\u2022";

  function summary(): string {
    return withoutIsolateMarks(
      document.querySelector("[data-testid='user-flow-journey-summary']")
        ?.textContent || "",
    );
  }

  function scopeDetail(): string {
    return withoutIsolateMarks(
      document.querySelector("[data-testid='user-flow-scope-detail']")
        ?.textContent || "",
    );
  }

  function renderScope(): void {
    render(
      <UserFlowScopeBanner
        scope={{
          kind: "user",
          identifiedUserKey: "a".repeat(64),
          identifiedUserRef: "",
        }}
        applied={null}
        sessionsInWindow={3}
        onChange={(): void => {
          return;
        }}
      />,
    );
  }

  test("fa: a journey's pages and returns are set apart by a bullet, which no Persian digit looks like", async () => {
    await i18next.changeLanguage("fa");
    render(
      <UserFlowJourneys
        journeys={[JOURNEY]}
        rumApplicationId={new ObjectID("0193c0de-1111-4aaa-8bbb-000000000001")}
      />,
    );

    expect(summary()).toContain(`\u06f4 `);
    expect(summary()).toContain(` ${BULLET} `);
    expect(summary()).not.toContain(MIDDLE_DOT);
    expect(
      withoutIsolateMarks(
        document.querySelector("[data-testid='user-flow-journey-facts']")
          ?.textContent || "",
      ),
    ).not.toContain(MIDDLE_DOT);
  });

  test("fa: who the page is narrowed to and how many sessions are set apart by a bullet", async () => {
    await i18next.changeLanguage("fa");
    renderScope();

    expect(scopeDetail()).toContain(` ${BULLET} `);
    expect(scopeDetail()).toContain("\u06f3");
    expect(scopeDetail()).not.toContain(MIDDLE_DOT);
  });

  test("it: a language whose zero is round keeps the middle dot", async () => {
    await i18next.changeLanguage("it");
    render(
      <UserFlowJourneys
        journeys={[JOURNEY]}
        rumApplicationId={new ObjectID("0193c0de-1111-4aaa-8bbb-000000000001")}
      />,
    );

    expect(summary()).toContain(` ${MIDDLE_DOT} `);
    expect(summary()).not.toContain(BULLET);

    cleanup();
    renderScope();

    expect(scopeDetail()).toContain(` ${MIDDLE_DOT} `);
  });
});

describe("the check itself", () => {
  test("every key the screens above draw is worded in every language checked, keeping its placeholders", () => {
    const keys: Array<string> = [
      ...PROCESSOR_DIALOG_KEYS,
      ...PROCESSORS.flatMap((processor: (typeof PROCESSORS)[number]) => {
        return processor.keys;
      }),
      ...TRACE_HEALTH_KEYS,
      ...SAMPLE_SENTENCES.map((sample: (typeof SAMPLE_SENTENCES)[number]) => {
        return sample.key;
      }),
      "Journeys",
      "Landing page",
      "Exit page",
      "{{count}} returns to an earlier page",
      "the session went on past these pages",
      "Landed here",
      "Visit {{visit}} to this page",
      "No teams.",
      "Update Content",
      "New Client Secret",
      "New refresh token",
      ...TOKEN_STATES.flatMap((state: (typeof TOKEN_STATES)[number]) => {
        return state.keys;
      }),
      ...TOKEN_REFRESH_RESULTS.flatMap(
        (result: (typeof TOKEN_REFRESH_RESULTS)[number]) => {
          return result.keys;
        },
      ),
    ];

    for (const language of LANGUAGES) {
      const locale: Record<string, string> = LOCALES[language] as Record<
        string,
        string
      >;
      const wrong: Array<string> = keys.filter((key: string): boolean => {
        const words: string | undefined = locale[key];
        const tokens: (text: string) => string = (text: string): string => {
          return (text.match(/\{\{[^}]+\}\}/g) || []).sort().join(" ");
        };

        return (
          !words ||
          words === EN[key] ||
          tokens(words) !== tokens(EN[key] as string)
        );
      });

      expect({ language, wrong }).toEqual({ language, wrong: [] });
    }
  });

  test("a sentence set back to English is caught on screen", async () => {
    const italian: Record<string, string> = LOCALES["it"] as Record<
      string,
      string
    >;
    const noTeams: string = italian["No teams."] as string;

    expect(noTeams).not.toBe("No teams.");

    i18next.addResourceBundle(
      "it",
      "translation",
      { "No teams.": "No teams." },
      true,
      true,
    );

    try {
      await i18next.changeLanguage("it");
      render(<TeamsElement teams={[]} />);

      expect(
        gapsIn("it", shownOnPage(), ["No teams."], {
          ...italian,
          "No teams.": "No teams.",
        }),
      ).toEqual({ language: "it", missing: [], english: ["No teams."] });
      expect(gapsIn("it", shownOnPage(), ["No teams."])).toEqual({
        language: "it",
        missing: ["No teams."],
        english: ["No teams."],
      });
    } finally {
      i18next.addResourceBundle(
        "it",
        "translation",
        { "No teams.": noTeams },
        true,
        true,
      );
    }
  });

  test("an English sentence left on screen beside the reader's words is caught", () => {
    const korean: string = LOCALES["ko"]!["Category Processor Configuration"]!;

    expect(
      gapsIn("ko", `${korean} Category Processor Configuration`, [
        "Category Processor Configuration",
      ]),
    ).toEqual({
      language: "ko",
      missing: [],
      english: ["Category Processor Configuration"],
    });
    expect(
      gapsIn("ko", "", ["Category Processor Configuration"]).missing,
    ).toEqual(["Category Processor Configuration"]);
  });

  test("a sentence's pieces are its words between placeholders", () => {
    expect(piecesOf("Visit {{visit}} to this page")).toEqual([
      "Visit",
      "to this page",
    ]);
    expect(piecesOf("{{count}} — {{left}}")).toEqual([]);
    expect(pluralKey("it", "{{count}} returns to an earlier page", 1)).toBe(
      "{{count}} returns to an earlier page_one",
    );
    expect(pluralKey("ko", "{{count}} returns to an earlier page", 1)).toBe(
      "{{count}} returns to an earlier page",
    );
  });
});
