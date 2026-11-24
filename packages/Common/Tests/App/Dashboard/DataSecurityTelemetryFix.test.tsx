import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import i18next from "i18next";
import type { Mock } from "jest-mock";
import { initReactI18next } from "react-i18next";
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import DataSecurityApi, {
  readTelemetryFixPlan,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/DataSecurityApi";
import IssueCodeFix from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/IssueCodeFix";
import {
  CALL_SITES_AND_REDACTION_SENTENCE,
  CALL_SITES_SENTENCE,
  ISSUE_CODE_FIX_TEST_ID,
  PULL_REQUEST_CLOSED,
  PULL_REQUEST_MERGED,
  PULL_REQUEST_OPEN,
  REDACTION_STEP_SENTENCE,
  REDACTION_WHY_MANY_PLACES,
  REDACTION_WHY_SCRUB_RULES,
  TELEMETRY_FIX_SERVER_SENTENCES,
  TELEMETRY_FIX_TEST_ID,
  TelemetryLeakPlaceKind,
  getIssueCodeFixWords,
  getTelemetryFixStrategyWords,
  getTelemetryLeakPlaceShown,
  getTelemetryLeakPlacesShown,
  isServiceTelemetryFix,
  isTelemetryFixOnItsWay,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/TelemetryFixCopy";
import TelemetryFixModal from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/TelemetryFixModal";
import { DECLARED_CODE_STATE_WORDS } from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/DeclaredCodeChangeWords";
import FixProductionCheck from "../../../Types/AI/FixProductionCheck";
import FixProductionStatus from "../../../Types/AI/FixProductionStatus";
import {
  DataSecurityFixResult,
  DataSecurityIssueCodeFixJSON,
  DataSecurityIssueCodeFixResult,
  DataSecurityTelemetryFixPlanJSON,
  DataSecurityTelemetryFixPlanResult,
  DataSecurityTelemetryFixRepositoryChoice,
} from "../../../Types/DataSecurity/DataSecurityApiTypes";
import {
  SECRETS_IN_TELEMETRY_CHECK_ID,
  SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
} from "../../../Types/DataSecurity/DataSecurityCheckCatalog";
import { DataStoreKind } from "../../../Types/DataSecurity/DataStoreKind";
import {
  TelemetryLeakFixLeak,
  TelemetryLeakFixStrategy,
  TelemetryLeakHandling,
  TelemetryLeakSignal,
} from "../../../Types/DataSecurity/TelemetryLeakFix";
import ObjectID from "../../../Types/ObjectID";
import { DeclaredCodeChangeState } from "../../../Utils/AiRemediation/DeclaredCodeChange";

/*
 * FIX WITH AI ON A SERVICE'S TELEMETRY ISSUE, AND THE ISSUE KEEPING ITS FIX
 * (#10367).
 *
 * Fix with AI on an issue in a service's telemetry shows the one pull
 * request first: how the code is changed - where the data is written, or
 * one redaction step and a test - where each leak is written as its records
 * say, the repository and why that one, and for a secret that it must be
 * rotated. Open Pull Request asks for exactly the plan shown; a plan that
 * changed comes back to show again. Then the issue says where its fix
 * stands: being written, open, merged with what production showed, or
 * closed - and, for a secret, where it was seen.
 */

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: {} } },
    interpolation: { escapeValue: false },
  });
});

configure({ asyncUtilTimeout: 15000 });

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

/*
 * What an element reads: a name or a figure is set apart from the words
 * around it with invisible direction marks - not part of what it says.
 */
function shown(element: HTMLElement): string {
  return (element.textContent || "")
    .replace(/[\u2066-\u2069\u200E\u200F]/g, "")
    .replace(/\u00A0/g, " ");
}

const ISSUE_ID: ObjectID = new ObjectID("10367000-0000-4000-8000-000000000001");
const SPAN_ISSUE_ID: string = "10367000-0000-4000-8000-000000000001";
const LOG_ISSUE_ID: string = "10367000-0000-4000-8000-000000000002";
const REPOSITORY_ID: string = "10367000-0000-4000-8000-0000000000c1";

function leakOf(
  data: Partial<TelemetryLeakFixLeak> &
    Pick<TelemetryLeakFixLeak, "issueId" | "signal" | "location" | "places">,
): TelemetryLeakFixLeak {
  return {
    dataStoreId: "10367000-0000-4000-8000-0000000000d1",
    checkId: SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
    dataTypeId: "email-address",
    dataTypeName: "Email Address",
    isSecret: false,
    isMaskedByScrubRule: false,
    handling: TelemetryLeakHandling.CallSite,
    ...data,
  };
}

// The issue's first scenario: a span's and a log line's user.email.
const SPAN_LEAK: TelemetryLeakFixLeak = leakOf({
  issueId: SPAN_ISSUE_ID,
  signal: TelemetryLeakSignal.Spans,
  location: "attributes.user.email",
  key: "user.email",
  places: [
    {
      filePath: "src/signup.js",
      lineNumber: 10,
      functionName: "signUp",
      spanName: "POST /signup",
      recordCount: 2,
    },
  ],
});
const LOG_LEAK: TelemetryLeakFixLeak = leakOf({
  issueId: LOG_ISSUE_ID,
  signal: TelemetryLeakSignal.Logs,
  location: "body",
  places: [
    {
      filePath: "src/signup.js",
      lineNumber: 12,
      functionName: "signUp",
      template: "User <email> signed up",
      recordCount: 2,
    },
  ],
});

function planOf(
  data: Partial<DataSecurityTelemetryFixPlanJSON> = {},
): DataSecurityTelemetryFixPlanJSON {
  return {
    serviceId: "10367000-0000-4000-8000-0000000000e1",
    serviceName: "checkout",
    strategy: TelemetryLeakFixStrategy.CallSites,
    placeCount: 2,
    leaks: [SPAN_LEAK, LOG_LEAK],
    issues: [
      {
        issueId: SPAN_ISSUE_ID,
        title: "Sensitive data in telemetry",
        checkId: SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
        signal: TelemetryLeakSignal.Spans,
      },
      {
        issueId: LOG_ISSUE_ID,
        title: "Sensitive data in telemetry",
        checkId: SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
        signal: TelemetryLeakSignal.Logs,
      },
    ],
    redactionKeys: [],
    redactionDataTypes: [],
    startFiles: ["src/signup.js"],
    hasSecrets: false,
    repository: {
      id: REPOSITORY_ID,
      name: "acme/checkout",
      choice: DataSecurityTelemetryFixRepositoryChoice.StackTrace,
    },
    fingerprint: "fingerprint-1",
    ...data,
  };
}

// The issue's second scenario: customer.email written in twenty places.
function twentyPlacesPlan(): DataSecurityTelemetryFixPlanJSON {
  const places: Array<TelemetryLeakFixLeak["places"][number]> = Array.from(
    { length: 10 },
    (_: unknown, index: number) => {
      return {
        filePath: `src/handlers/step${String(index + 1).padStart(2, "0")}.js`,
        lineNumber: 10,
        functionName: "run",
        recordCount: 1,
      };
    },
  );

  return planOf({
    serviceName: "orders",
    strategy: TelemetryLeakFixStrategy.RedactionStep,
    placeCount: 20,
    leaks: [
      leakOf({
        issueId: SPAN_ISSUE_ID,
        signal: TelemetryLeakSignal.Spans,
        location: "attributes.customer.email",
        key: "customer.email",
        handling: TelemetryLeakHandling.RedactionStep,
        places: places.slice(0, 5),
      }),
      leakOf({
        issueId: LOG_ISSUE_ID,
        signal: TelemetryLeakSignal.Logs,
        location: "attributes.customer.email",
        key: "customer.email",
        handling: TelemetryLeakHandling.RedactionStep,
        places: places.slice(5, 10),
      }),
    ],
    redactionKeys: ["customer.email"],
    redactionDataTypes: ["email-address"],
    startFiles: ["src/telemetry.js", "src/handlers/step01.js"],
  });
}

function mockPlan(
  result: DataSecurityTelemetryFixPlanResult,
): Mock<(issueId: ObjectID) => Promise<DataSecurityTelemetryFixPlanResult>> {
  return jest
    .spyOn(DataSecurityApi, "getIssueFixPlan")
    .mockResolvedValue(result) as unknown as Mock<
    (issueId: ObjectID) => Promise<DataSecurityTelemetryFixPlanResult>
  >;
}

function mockFix(
  result: DataSecurityFixResult,
): Mock<
  (
    issueId: ObjectID,
    codeRepositoryId?: ObjectID,
    expectedPlanFingerprint?: string,
  ) => Promise<DataSecurityFixResult>
> {
  return jest
    .spyOn(DataSecurityApi, "fixIssueWithAi")
    .mockResolvedValue(result) as unknown as Mock<
    (
      issueId: ObjectID,
      codeRepositoryId?: ObjectID,
      expectedPlanFingerprint?: string,
    ) => Promise<DataSecurityFixResult>
  >;
}

function renderModal(
  onStarted: (result: DataSecurityFixResult) => void = () => {},
): void {
  render(
    <MemoryRouter>
      <TelemetryFixModal
        issueId={ISSUE_ID}
        onClose={() => {}}
        onStarted={onStarted}
      />
    </MemoryRouter>,
  );
}

function submitButton(): HTMLElement {
  return screen.getByRole("button", { name: "Open Pull Request" });
}

describe("which issues Fix with AI plans one pull request for", () => {
  test("an issue in a service's logs, traces, exceptions, AI conversations or metrics", () => {
    for (const kind of [
      DataStoreKind.TelemetryLogs,
      DataStoreKind.TelemetryTraces,
      DataStoreKind.TelemetryExceptions,
      DataStoreKind.TelemetryAiConversations,
      DataStoreKind.TelemetryMetrics,
    ]) {
      expect(
        isServiceTelemetryFix({
          isTelemetryCheck: true,
          storeKind: kind,
          serviceId: "10367000-0000-4000-8000-0000000000e1",
        }),
      ).toBe(true);
    }
  });

  test("not a session replay's, a store with no service, or another check's issue", () => {
    expect(
      isServiceTelemetryFix({
        isTelemetryCheck: true,
        storeKind: DataStoreKind.TelemetrySessionReplays,
        serviceId: "10367000-0000-4000-8000-0000000000e1",
      }),
    ).toBe(false);
    expect(
      isServiceTelemetryFix({
        isTelemetryCheck: true,
        storeKind: DataStoreKind.TelemetryLogs,
        serviceId: undefined,
      }),
    ).toBe(false);
    expect(
      isServiceTelemetryFix({
        isTelemetryCheck: false,
        storeKind: DataStoreKind.TelemetryLogs,
        serviceId: "10367000-0000-4000-8000-0000000000e1",
      }),
    ).toBe(false);
    expect(
      isServiceTelemetryFix({
        isTelemetryCheck: true,
        storeKind: undefined,
        serviceId: "10367000-0000-4000-8000-0000000000e1",
      }),
    ).toBe(false);
  });
});

describe("how the plan says the code is changed", () => {
  test("where the data is written, in its few places", () => {
    expect(
      getTelemetryFixStrategyWords({
        strategy: TelemetryLeakFixStrategy.CallSites,
        placeCount: 2,
      }),
    ).toEqual({ sentence: CALL_SITES_SENTENCE, count: 2 });
  });

  test("one redaction step: because it is written in twenty places", () => {
    expect(
      getTelemetryFixStrategyWords({
        strategy: TelemetryLeakFixStrategy.RedactionStep,
        placeCount: 20,
      }),
    ).toEqual({
      sentence: REDACTION_STEP_SENTENCE,
      why: { sentence: REDACTION_WHY_MANY_PLACES, count: 20 },
    });
  });

  test("one redaction step: because the scrub rules hide it at ingest already", () => {
    expect(
      getTelemetryFixStrategyWords({
        strategy: TelemetryLeakFixStrategy.RedactionStep,
        placeCount: 2,
      }),
    ).toEqual({
      sentence: REDACTION_STEP_SENTENCE,
      why: { sentence: REDACTION_WHY_SCRUB_RULES },
    });
  });

  test("both", () => {
    expect(
      getTelemetryFixStrategyWords({
        strategy: TelemetryLeakFixStrategy.CallSitesAndRedactionStep,
        placeCount: 3,
      }),
    ).toEqual({ sentence: CALL_SITES_AND_REDACTION_SENTENCE });
  });
});

describe("how a place reads", () => {
  test("a file and line, with its function, when the records name them", () => {
    expect(getTelemetryLeakPlaceShown(SPAN_LEAK.places[0]!)).toEqual({
      kind: TelemetryLeakPlaceKind.File,
      name: "src/signup.js:10",
      functionName: "signUp",
      recordCount: 2,
    });
  });

  test("an exception's own top frame, when it has no file of its own", () => {
    expect(
      getTelemetryLeakPlaceShown({
        frames: [
          {
            filePath: "src/payments.js",
            lineNumber: 7,
            functionName: "charge",
          },
          { filePath: "src/index.js", lineNumber: 3 },
        ],
        exceptionType: "PaymentError",
        recordCount: 4,
      }),
    ).toEqual({
      kind: TelemetryLeakPlaceKind.File,
      name: "src/payments.js:7",
      functionName: "charge",
      recordCount: 4,
    });
  });

  test("the log line's template, the span, the metric, the exception or the logger, in that order", () => {
    expect(
      getTelemetryLeakPlaceShown({
        template: "User <email> signed up",
        spanName: "POST /signup",
        scopeName: "accounts",
        recordCount: 1,
      }),
    ).toEqual({
      kind: TelemetryLeakPlaceKind.LogLine,
      name: "User <email> signed up",
      recordCount: 1,
    });
    expect(
      getTelemetryLeakPlaceShown({ spanName: "POST /signup", recordCount: 1 })
        .kind,
    ).toBe(TelemetryLeakPlaceKind.Span);
    expect(
      getTelemetryLeakPlaceShown({
        metricName: "orders.placed",
        recordCount: 1,
      }).kind,
    ).toBe(TelemetryLeakPlaceKind.Metric);
    expect(
      getTelemetryLeakPlaceShown({ exceptionType: "Error", recordCount: 1 })
        .kind,
    ).toBe(TelemetryLeakPlaceKind.Exception);
    expect(
      getTelemetryLeakPlaceShown({ scopeName: "accounts", recordCount: 1 })
        .kind,
    ).toBe(TelemetryLeakPlaceKind.Logger);
  });

  test("a leak lists its first three places and counts the rest; one with none, its key", () => {
    const many: { shown: Array<unknown>; more: number } =
      getTelemetryLeakPlacesShown(twentyPlacesPlan().leaks[0]!);

    expect(many.shown).toHaveLength(3);
    expect(many.more).toBe(2);

    expect(
      getTelemetryLeakPlacesShown({
        places: [{ recordCount: 3 }],
        key: "user.email",
        location: "attributes.user.email",
      }),
    ).toEqual({
      shown: [
        {
          kind: TelemetryLeakPlaceKind.Key,
          name: "user.email",
          recordCount: 3,
        },
      ],
      more: 0,
    });
  });
});

describe("Fix with AI's plan for a service's telemetry leaks", () => {
  test("one pull request for the span's and the log line's user.email, each where it is written", async () => {
    mockPlan({ plan: planOf() });
    renderModal();

    const dialog: HTMLElement = await screen.findByTestId(
      TELEMETRY_FIX_TEST_ID,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId(`${TELEMETRY_FIX_TEST_ID}-strategy`),
      ).toBeInTheDocument();
    });

    const text: string = shown(dialog);

    expect(shown(screen.getByTestId("modal-description"))).toBe(
      "One pull request stops checkout writing sensitive data to its telemetry.",
    );
    expect(text).toContain(
      "It fixes 2 issues of this service, this one among them.",
    );
    expect(text).toContain(
      "OneUptime AI changes the code where the data is written, in 2 places.",
    );
    expect(text).toContain("Email Address in user.email");
    expect(text).toContain("Email Address in body");
    expect(text).toContain("src/signup.js:10");
    expect(text).toContain("src/signup.js:12");
    expect(text).toContain("Traces");
    expect(text).toContain("Logs");
    expect(text).toContain("OneUptime AI opens it in acme/checkout.");
    expect(text).toContain("Found from the files the leaks' records name.");
    expect(text).toContain("OneUptime AI starts from src/signup.js.");
    // Neither a redaction step nor a secret here.
    expect(text).not.toContain("What the redaction step removes");
    expect(
      screen.queryByTestId(`${TELEMETRY_FIX_TEST_ID}-rotate`),
    ).not.toBeInTheDocument();
  });

  test("Open Pull Request asks for exactly the plan shown, in its repository", async () => {
    mockPlan({ plan: planOf() });
    const fix: ReturnType<typeof mockFix> = mockFix({
      message: TELEMETRY_FIX_SERVER_SENTENCES[6]!,
      aiRunId: "10367000-0000-4000-8000-0000000000f1",
    });
    const started: Array<DataSecurityFixResult> = [];

    renderModal((result: DataSecurityFixResult) => {
      started.push(result);
    });

    await waitFor(() => {
      expect(submitButton()).not.toBeDisabled();
    });

    await act(async () => {
      fireEvent.click(submitButton());
    });

    await waitFor(() => {
      expect(started).toHaveLength(1);
    });

    expect(fix).toHaveBeenCalledTimes(1);
    expect(fix.mock.calls[0]![0]!.toString()).toBe(ISSUE_ID.toString());
    // The repository the plan found is the server's to use: none is sent.
    expect(fix.mock.calls[0]![1]).toBeUndefined();
    expect(fix.mock.calls[0]![2]).toBe("fingerprint-1");
    expect(started[0]!.aiRunId).toBe("10367000-0000-4000-8000-0000000000f1");
  });

  test("twenty places: one redaction step and a test, the key it removes, and how many places", async () => {
    mockPlan({ plan: twentyPlacesPlan() });
    renderModal();

    const strategy: HTMLElement = await screen.findByTestId(
      `${TELEMETRY_FIX_TEST_ID}-strategy`,
    );

    expect(strategy).toHaveAttribute(
      "data-strategy",
      TelemetryLeakFixStrategy.RedactionStep,
    );
    expect(shown(strategy)).toContain(
      "OneUptime AI adds one redaction step, with a test, that removes the data before the service sends it. It is written in 20 places, so one step fixes it everywhere.",
    );
    expect(shown(strategy)).toContain("What the redaction step removes");
    expect(shown(strategy)).toContain("customer.email");

    const leaks: string = shown(
      screen.getByTestId(`${TELEMETRY_FIX_TEST_ID}-leaks`),
    );

    expect(leaks).toContain("src/handlers/step01.js:10");
    expect(leaks).toContain("And 2 more places");
    expect(leaks).not.toContain("src/handlers/step04.js:10");
  });

  test("the scrub rules' keys: one redaction step that does what ingest does", async () => {
    mockPlan({
      plan: planOf({
        strategy: TelemetryLeakFixStrategy.RedactionStep,
        placeCount: 1,
        leaks: [
          {
            ...SPAN_LEAK,
            isMaskedByScrubRule: true,
            handling: TelemetryLeakHandling.RedactionStep,
          },
        ],
        redactionKeys: ["user.email"],
      }),
    });
    renderModal();

    const strategy: HTMLElement = await screen.findByTestId(
      `${TELEMETRY_FIX_TEST_ID}-strategy`,
    );

    expect(shown(strategy)).toContain(
      "Your scrub rules hide this data at ingest already: the step makes the code do the same.",
    );
  });

  test("both: each leak says how it is fixed", async () => {
    mockPlan({
      plan: planOf({
        strategy: TelemetryLeakFixStrategy.CallSitesAndRedactionStep,
        leaks: [
          SPAN_LEAK,
          {
            ...LOG_LEAK,
            isMaskedByScrubRule: true,
            handling: TelemetryLeakHandling.RedactionStep,
          },
        ],
        redactionKeys: ["body"],
      }),
    });
    renderModal();

    const leaks: HTMLElement = await screen.findByTestId(
      `${TELEMETRY_FIX_TEST_ID}-leaks`,
    );

    expect(shown(leaks)).toContain("Changed where it is written");
    expect(shown(leaks)).toContain("Removed by the redaction step");
  });

  test("a place with no file reads as its log line's template", async () => {
    mockPlan({
      plan: planOf({
        leaks: [
          {
            ...LOG_LEAK,
            places: [
              {
                template: "Password reset sent to <email>",
                scopeName: "accounts",
                recordCount: 3,
              },
            ],
          },
        ],
        placeCount: 1,
      }),
    });
    renderModal();

    const leaks: HTMLElement = await screen.findByTestId(
      `${TELEMETRY_FIX_TEST_ID}-leaks`,
    );

    expect(shown(leaks)).toContain("Log line Password reset sent to <email>");
    expect(shown(leaks)).toContain("Seen in 3 records");
  });

  test("nothing decides the repository: the reader picks one, and that one is asked in", async () => {
    mockPlan({
      plan: planOf({
        repository: undefined,
        repositories: [
          { id: REPOSITORY_ID, name: "acme/checkout" },
          { id: "10367000-0000-4000-8000-0000000000c2", name: "acme/platform" },
        ],
      }),
    });
    const fix: ReturnType<typeof mockFix> = mockFix({
      message: TELEMETRY_FIX_SERVER_SENTENCES[6]!,
      aiRunId: "10367000-0000-4000-8000-0000000000f1",
    });

    renderModal();

    await screen.findByTestId(`${TELEMETRY_FIX_TEST_ID}-repository`);
    expect(
      shown(screen.getByTestId(`${TELEMETRY_FIX_TEST_ID}-repository`)),
    ).toContain(
      "Pick the repository that holds this service's code. OneUptime AI opens a pull request there.",
    );
    expect(submitButton()).toBeDisabled();

    const combobox: HTMLElement = screen.getByRole("combobox");

    await act(async () => {
      fireEvent.focus(combobox);
      fireEvent.keyDown(combobox, { key: "ArrowDown", keyCode: 40 });
    });

    const platform: HTMLElement = await screen.findByRole("option", {
      name: "acme/platform",
    });

    await act(async () => {
      fireEvent.click(platform);
    });

    await waitFor(() => {
      expect(submitButton()).not.toBeDisabled();
    });

    await act(async () => {
      fireEvent.click(submitButton());
    });

    await waitFor(() => {
      expect(fix).toHaveBeenCalledTimes(1);
    });
    expect(fix.mock.calls[0]![1]!.toString()).toBe(
      "10367000-0000-4000-8000-0000000000c2",
    );
  });

  test("no repository the reader may ask in: it says how to get one, and asks for nothing", async () => {
    mockPlan({ plan: planOf({ repository: undefined, repositories: [] }) });
    renderModal();

    const repository: HTMLElement = await screen.findByTestId(
      `${TELEMETRY_FIX_TEST_ID}-repository`,
    );

    expect(shown(repository)).toContain(
      "Connect the repository that holds this service's code under Code, then ask again.",
    );
    expect(submitButton()).toBeDisabled();
  });

  test("a secret: rotate it too, a code fix stops new copies only", async () => {
    mockPlan({
      plan: planOf({
        hasSecrets: true,
        leaks: [
          leakOf({
            issueId: SPAN_ISSUE_ID,
            checkId: SECRETS_IN_TELEMETRY_CHECK_ID,
            signal: TelemetryLeakSignal.Exceptions,
            dataTypeId: "stripe-live-key",
            dataTypeName: "Stripe Live Key",
            isSecret: true,
            location: "exception.message",
            places: [
              {
                frames: [{ filePath: "src/payments.js", lineNumber: 9 }],
                exceptionType: "PaymentError",
                recordCount: 1,
              },
            ],
          }),
        ],
        placeCount: 1,
      }),
    });
    renderModal();

    const rotate: HTMLElement = await screen.findByTestId(
      `${TELEMETRY_FIX_TEST_ID}-rotate`,
    );

    expect(shown(rotate)).toBe(
      "Rotate the secret too: a code fix stops new copies only.",
    );
  });

  test("a fix already on its way: no second one is asked for, and its task is one click away", async () => {
    mockPlan({
      plan: planOf({
        existing: {
          taskId: "10367000-0000-4000-8000-0000000000f1",
          recipe: "FixSensitiveDataInTelemetry",
          state: DeclaredCodeChangeState.Writing,
          issueCount: 2,
        },
      }),
    });
    renderModal();

    const onItsWay: HTMLElement = await screen.findByTestId(
      `${TELEMETRY_FIX_TEST_ID}-on-its-way`,
    );

    expect(shown(onItsWay)).toContain(
      "Its pull request is on its way, so no second one is opened.",
    );
    expect(shown(onItsWay)).toContain("View task");
    expect(submitButton()).toBeDisabled();
  });

  test("a plan that changed since it was shown starts nothing, and is shown again", async () => {
    mockPlan({ plan: planOf() });
    const changed: DataSecurityTelemetryFixPlanJSON = planOf({
      leaks: [SPAN_LEAK],
      placeCount: 1,
      fingerprint: "fingerprint-2",
    });
    const fix: ReturnType<typeof mockFix> = mockFix({
      message: TELEMETRY_FIX_SERVER_SENTENCES[2]!,
      plan: changed,
    });
    const started: Array<DataSecurityFixResult> = [];

    renderModal((result: DataSecurityFixResult) => {
      started.push(result);
    });

    await waitFor(() => {
      expect(submitButton()).not.toBeDisabled();
    });

    await act(async () => {
      fireEvent.click(submitButton());
    });

    await screen.findByText(
      "What this fix would change has changed since it was shown to you, so nothing was started. Look at it again before you ask.",
    );
    expect(started).toHaveLength(0);
    expect(
      shown(screen.getByTestId(`${TELEMETRY_FIX_TEST_ID}-strategy`)),
    ).toContain("in 1 place.");

    // Asked again, it names the plan now shown.
    await act(async () => {
      fireEvent.click(submitButton());
    });

    await waitFor(() => {
      expect(fix).toHaveBeenCalledTimes(2);
    });
    expect(fix.mock.calls[1]![2]).toBe("fingerprint-2");
  });

  test("nothing left to fix: it says so, and asks for nothing", async () => {
    mockPlan({ plan: null, message: TELEMETRY_FIX_SERVER_SENTENCES[0]! });
    renderModal();

    const nothing: HTMLElement = await screen.findByTestId(
      `${TELEMETRY_FIX_TEST_ID}-nothing`,
    );

    expect(shown(nothing)).toBe(
      "This service writes no sensitive data to its telemetry that OneUptime still sees, so there is nothing to fix in its code.",
    );
    expect(submitButton()).toBeDisabled();
  });

  test("a plan that could not be loaded says so", async () => {
    jest
      .spyOn(DataSecurityApi, "getIssueFixPlan")
      .mockRejectedValue(new Error("The server is down."));
    renderModal();

    await screen.findByText(/What this fix would change could not be loaded\./);
    expect(submitButton()).toBeDisabled();
  });
});

describe("a plan as the server sent it", () => {
  test("is read whole, its leaks and issues each read, or left out", () => {
    const plan: DataSecurityTelemetryFixPlanJSON | null = readTelemetryFixPlan(
      JSON.parse(JSON.stringify(planOf())),
    );

    expect(plan?.leaks).toHaveLength(2);
    expect(plan?.issues).toHaveLength(2);
    expect(plan?.fingerprint).toBe("fingerprint-1");
    expect(readTelemetryFixPlan({ ...planOf(), leaks: [] })).toBeNull();
    expect(readTelemetryFixPlan({ ...planOf(), fingerprint: 3 })).toBeNull();
    expect(readTelemetryFixPlan("plan")).toBeNull();
    expect(readTelemetryFixPlan(null)).toBeNull();
  });
});

describe("where the issue's fix in code stands", () => {
  const FIX: DataSecurityIssueCodeFixJSON = {
    taskId: "10367000-0000-4000-8000-0000000000f1",
    recipe: "FixSensitiveDataInTelemetry",
    state: DeclaredCodeChangeState.Writing,
    issueCount: 3,
    repositoryName: "acme/checkout",
    serviceName: "checkout",
  };

  function mockCodeFix(result: DataSecurityIssueCodeFixResult): void {
    jest.spyOn(DataSecurityApi, "getIssueCodeFix").mockResolvedValue(result);
  }

  function renderCodeFix(): void {
    render(
      <MemoryRouter>
        <IssueCodeFix issueId={ISSUE_ID} />
      </MemoryRouter>,
    );
  }

  test("each state in its words: written, open, merged, closed", () => {
    expect(
      getIssueCodeFixWords({ state: DeclaredCodeChangeState.Writing }),
    ).toEqual({
      sentence: DECLARED_CODE_STATE_WORDS[DeclaredCodeChangeState.Writing],
      tone: "live",
    });
    expect(
      getIssueCodeFixWords({
        state: DeclaredCodeChangeState.Opened,
        pullRequest: { state: "open" },
      }).sentence,
    ).toBe(PULL_REQUEST_OPEN);
    expect(
      getIssueCodeFixWords({
        state: DeclaredCodeChangeState.Opened,
        pullRequest: { state: "merged" },
      }),
    ).toEqual({ sentence: PULL_REQUEST_MERGED, tone: "done" });
    expect(
      getIssueCodeFixWords({
        state: DeclaredCodeChangeState.Opened,
        pullRequest: { state: "closed" },
      }),
    ).toEqual({ sentence: PULL_REQUEST_CLOSED, tone: "idle" });
    // A state this build does not know reads as ended, never as fixed.
    expect(getIssueCodeFixWords({ state: "unknown" }).sentence).toBe(
      DECLARED_CODE_STATE_WORDS[DeclaredCodeChangeState.Ended],
    );
  });

  test("a fix on its way is one no second fix is asked for", () => {
    expect(isTelemetryFixOnItsWay(undefined)).toBe(false);
    expect(isTelemetryFixOnItsWay(FIX)).toBe(true);
    expect(
      isTelemetryFixOnItsWay({
        ...FIX,
        state: DeclaredCodeChangeState.WaitingForYou,
      }),
    ).toBe(true);
    expect(
      isTelemetryFixOnItsWay({
        ...FIX,
        state: DeclaredCodeChangeState.Opened,
        pullRequest: { state: "open" },
      }),
    ).toBe(true);
    expect(
      isTelemetryFixOnItsWay({
        ...FIX,
        state: DeclaredCodeChangeState.Opened,
        pullRequest: { state: "merged" },
      }),
    ).toBe(false);
    expect(
      isTelemetryFixOnItsWay({ ...FIX, state: DeclaredCodeChangeState.Failed }),
    ).toBe(false);
  });

  test("no fix and no secret: nothing is drawn", async () => {
    const read: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataSecurityApi, "getIssueCodeFix")
      .mockResolvedValue({ fix: null, secretSightings: [] });

    renderCodeFix();

    await waitFor(() => {
      expect(read).toHaveBeenCalled();
    });
    expect(
      screen.queryByTestId(ISSUE_CODE_FIX_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("being written: in its repository, for the service's issues, with View progress", async () => {
    mockCodeFix({ fix: FIX });
    renderCodeFix();

    const section: HTMLElement = await screen.findByTestId(
      ISSUE_CODE_FIX_TEST_ID,
    );

    expect(shown(section)).toContain(
      "A pull request to the code is being written in acme/checkout.",
    );
    expect(shown(section)).toContain(
      "One pull request for 3 issues of checkout, this one among them.",
    );
    expect(
      screen.getByTestId(`${ISSUE_CODE_FIX_TEST_ID}-task`),
    ).toHaveTextContent("View progress");
  });

  test("open: its pull request, by number, opens where it lives", async () => {
    mockCodeFix({
      fix: {
        ...FIX,
        state: DeclaredCodeChangeState.Opened,
        pullRequest: {
          state: "open",
          number: 42,
          url: "https://github.com/acme/checkout/pull/42",
        },
      },
    });
    renderCodeFix();

    const section: HTMLElement = await screen.findByTestId(
      ISSUE_CODE_FIX_TEST_ID,
    );

    expect(shown(section)).toContain(
      "Its pull request is open in acme/checkout: merging it fixes this issue.",
    );

    const link: HTMLElement = screen.getByTestId(
      `${ISSUE_CODE_FIX_TEST_ID}-pull-request`,
    );

    expect(link).toHaveAttribute(
      "href",
      "https://github.com/acme/checkout/pull/42",
    );
    expect(shown(link)).toBe("View pull request #42");
    expect(
      screen.getByTestId(`${ISSUE_CODE_FIX_TEST_ID}-task`),
    ).toHaveTextContent("View task");
  });

  test("merged: what production showed once it shipped", async () => {
    mockCodeFix({
      fix: {
        ...FIX,
        state: DeclaredCodeChangeState.Opened,
        pullRequest: {
          state: "merged",
          number: 42,
          production: {
            status: FixProductionStatus.Verified,
            check: FixProductionCheck.TelemetryLeak,
            summary: "The service's new version no longer writes user.email.",
          },
        },
      },
    });
    renderCodeFix();

    const section: HTMLElement = await screen.findByTestId(
      ISSUE_CODE_FIX_TEST_ID,
    );

    expect(shown(section)).toContain(
      "Its pull request was merged in acme/checkout.",
    );
    expect(
      shown(screen.getByTestId(`${ISSUE_CODE_FIX_TEST_ID}-production`)),
    ).toContain("The service's new version no longer writes user.email.");
  });

  test("closed without being merged: Fix with AI asks for another", async () => {
    mockCodeFix({
      fix: {
        ...FIX,
        state: DeclaredCodeChangeState.Opened,
        pullRequest: { state: "closed", number: 42 },
      },
    });
    renderCodeFix();

    const section: HTMLElement = await screen.findByTestId(
      ISSUE_CODE_FIX_TEST_ID,
    );

    expect(shown(section)).toContain(
      "Its pull request was closed without being merged, in acme/checkout. Fix with AI asks for another.",
    );
  });

  test("a task the reader may not open: it is there, and nothing more", async () => {
    mockCodeFix({
      fix: {
        taskId: "",
        recipe: "FixSensitiveDataInTelemetry",
        state: DeclaredCodeChangeState.Hidden,
        issueCount: 3,
      },
    });
    renderCodeFix();

    const section: HTMLElement = await screen.findByTestId(
      ISSUE_CODE_FIX_TEST_ID,
    );

    expect(shown(section)).toContain(
      DECLARED_CODE_STATE_WORDS[DeclaredCodeChangeState.Hidden],
    );
    expect(
      screen.queryByTestId(`${ISSUE_CODE_FIX_TEST_ID}-task`),
    ).not.toBeInTheDocument();
    expect(shown(section)).not.toContain("issues of");
  });

  test("a repository the reader may not read is still a repository", async () => {
    mockCodeFix({ fix: { ...FIX, repositoryName: undefined } });
    renderCodeFix();

    const section: HTMLElement = await screen.findByTestId(
      ISSUE_CODE_FIX_TEST_ID,
    );

    expect(shown(section)).toContain(
      "A pull request to the code is being written in a repository.",
    );
  });

  test("a secret's issue lists where it was seen, to rotate it", async () => {
    mockCodeFix({
      fix: null,
      secretSightings: [
        {
          dataTypeName: "Stripe Live Key",
          location: "exception.message",
          storeName: "payments exceptions",
          signal: TelemetryLeakSignal.Exceptions,
          lastSeenAt: "2026-11-20T10:00:00.000Z",
        },
        {
          dataTypeName: "Stripe Live Key",
          location: "attributes.http.request.header.authorization",
          storeName: "payments traces",
        },
      ],
    });
    renderCodeFix();

    const rotate: HTMLElement = await screen.findByTestId(
      `${ISSUE_CODE_FIX_TEST_ID}-rotate`,
    );

    expect(shown(rotate)).toContain("Rotate the Secret");
    expect(shown(rotate)).toContain(
      "A code fix stops new copies only. Rotate the secret, then check where it was seen:",
    );
    expect(shown(rotate)).toContain("Stripe Live Key in exception.message");
    expect(shown(rotate)).toContain("payments exceptions");
    expect(shown(rotate)).toContain("Last seen");
    expect(shown(rotate)).toContain(
      "Stripe Live Key in attributes.http.request.header.authorization",
    );
  });
});
