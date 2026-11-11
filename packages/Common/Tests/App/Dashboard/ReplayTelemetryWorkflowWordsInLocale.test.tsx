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
