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
import {
  TELEMETRY_FIX_SERVER_SENTENCES,
  TELEMETRY_FIX_STARTED_APPLICATION,
  TELEMETRY_FIX_TEST_ID,
  TELEMETRY_LEAK_SIGNAL_LABELS,
  TelemetryLeakPlaceKind,
  getRepositoryChoiceWords,
  getTelemetryFixStrategyWords,
  getTelemetryLeakPlaceShown,
  isApplicationTelemetryFix,
  isServiceTelemetryFix,
  isTelemetryCodeFix,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/TelemetryFixCopy";
import TelemetryFixModal from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/TelemetryFixModal";
import { DATA_SECURITY_APPLICATION_FIX_STARTED_MESSAGE } from "../../../Server/Utils/AI/DataSecurity/DataSecurityCodeTask";
import {
  TELEMETRY_FIX_NOTHING_TO_FIX_IN_APPLICATION_MESSAGE,
  TELEMETRY_FIX_NOT_A_SERVICE_MESSAGE,
} from "../../../Server/Utils/DataSecurity/TelemetryLeakFix";
import {
  DataSecurityFixResult,
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
  TelemetryLeakFixOwnerKind,
  TelemetryLeakFixStrategy,
  TelemetryLeakHandling,
  TelemetryLeakSignal,
} from "../../../Types/DataSecurity/TelemetryLeakFix";
import ObjectID from "../../../Types/ObjectID";

/*
 * FIX WITH AI ON A RUM APPLICATION'S ISSUE: ONE PULL REQUEST FOR ITS
 * FRONT-END CODE (#10933).
 *
 * A session replay issue's Fix with AI shows the plan first, as a
 * service's does, in the application's words: the pull request stops it
 * sending sensitive data from the browser; each leak is in browser logs,
 * browser spans or sessions, at the original file its source maps name,
 * on the page it was written on, or at the session recorder call that
 * gave a session its user; the repository is the one its source maps'
 * files are in. What the server says back reads in every language.
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

// What an element reads, without the invisible marks a name is set apart with.
function shown(element: HTMLElement): string {
  return (element.textContent || "")
    .replace(/[\u2066-\u2069\u200E\u200F]/g, "")
    .replace(/\u00A0/g, " ");
}

const ISSUE_ID: ObjectID = new ObjectID("10933000-0000-4000-8000-000000000001");
const SENSITIVE_ISSUE_ID: string = "10933000-0000-4000-8000-000000000001";
const SECRET_ISSUE_ID: string = "10933000-0000-4000-8000-000000000002";
const REPOSITORY_ID: string = "10933000-0000-4000-8000-0000000000c1";

function leakOf(
  data: Partial<TelemetryLeakFixLeak> &
    Pick<TelemetryLeakFixLeak, "issueId" | "signal" | "location" | "places">,
): TelemetryLeakFixLeak {
  return {
    dataStoreId: "10933000-0000-4000-8000-0000000000b1",
    checkId: SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
    dataTypeId: "email-address",
    dataTypeName: "Email Address",
    isSecret: false,
    isMaskedByScrubRule: false,
    handling: TelemetryLeakHandling.CallSite,
    ...data,
  };
}

// A browser log's user.email, found through the application's source maps, on its page.
const LOG_LEAK: TelemetryLeakFixLeak = leakOf({
  issueId: SENSITIVE_ISSUE_ID,
  signal: TelemetryLeakSignal.RumLogs,
  location: "logs.attributes.user.email",
  key: "user.email",
  places: [
    {
      filePath: "src/checkout/payment.js",
      lineNumber: 8,
      functionName: "pay",
      page: "/checkout/<value>/pay",
      recordCount: 3,
    },
  ],
});
// A session identified by an email: the session recorder call that gave it.
const SESSION_LEAK: TelemetryLeakFixLeak = leakOf({
  issueId: SENSITIVE_ISSUE_ID,
  signal: TelemetryLeakSignal.RumSessions,
  location: "sessions.identifiedUserLabel",
  places: [{ recorderCall: "identify", page: "/account", recordCount: 2 }],
});
// A token in a browser span's header attribute: the secrets issue.
const SPAN_LEAK: TelemetryLeakFixLeak = leakOf({
  issueId: SECRET_ISSUE_ID,
  checkId: SECRETS_IN_TELEMETRY_CHECK_ID,
  signal: TelemetryLeakSignal.RumSpans,
  dataTypeId: "json-web-token",
  dataTypeName: "JSON Web Token",
  isSecret: true,
  location: "spans.attributes.http.request.header.authorization",
  key: "http.request.header.authorization",
  places: [{ spanName: "GET /api/orders", page: "/orders", recordCount: 4 }],
});

function planOf(
  data: Partial<DataSecurityTelemetryFixPlanJSON> = {},
): DataSecurityTelemetryFixPlanJSON {
  return {
    ownerKind: TelemetryLeakFixOwnerKind.RumApplication,
    serviceId: "10933000-0000-4000-8000-0000000000e1",
    serviceName: "Storefront",
    strategy: TelemetryLeakFixStrategy.CallSites,
    placeCount: 3,
    leaks: [LOG_LEAK, SESSION_LEAK, SPAN_LEAK],
    issues: [
      {
        issueId: SECRET_ISSUE_ID,
        title: "Secrets in telemetry",
        checkId: SECRETS_IN_TELEMETRY_CHECK_ID,
        signal: TelemetryLeakSignal.RumSpans,
      },
      {
        issueId: SENSITIVE_ISSUE_ID,
        title: "Sensitive data in telemetry",
        checkId: SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
        signal: TelemetryLeakSignal.RumLogs,
      },
    ],
    redactionKeys: [],
    redactionDataTypes: [],
    startFiles: ["src/checkout/payment.js"],
    hasSecrets: true,
    repository: {
      id: REPOSITORY_ID,
      name: "acme/web",
      choice: DataSecurityTelemetryFixRepositoryChoice.SourceMaps,
    },
    folder: "apps/web",
    fingerprint: "fingerprint-rum",
    ...data,
  };
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

async function openedPlan(): Promise<string> {
  const dialog: HTMLElement = await screen.findByTestId(TELEMETRY_FIX_TEST_ID);

  await waitFor(() => {
    expect(
      screen.getByTestId(`${TELEMETRY_FIX_TEST_ID}-strategy`),
    ).toBeInTheDocument();
  });

  return shown(dialog);
}

describe("which issues Fix with AI plans a front-end fix for", () => {
  test("a session replay issue of a telemetry check: the application's, not a service's", () => {
    const issue: {
      isTelemetryCheck: boolean;
      storeKind: DataStoreKind;
      serviceId: undefined;
    } = {
      isTelemetryCheck: true,
      storeKind: DataStoreKind.TelemetrySessionReplays,
      serviceId: undefined,
    };

    expect(isTelemetryCodeFix(issue)).toBe(true);
    expect(isServiceTelemetryFix(issue)).toBe(false);
  });

  test("a service's telemetry issue still is one; another check's, or a bucket's, is not", () => {
    expect(
      isTelemetryCodeFix({
        isTelemetryCheck: true,
        storeKind: DataStoreKind.TelemetryLogs,
        serviceId: "10933000-0000-4000-8000-0000000000e9",
      }),
    ).toBe(true);
    expect(
      isTelemetryCodeFix({
        isTelemetryCheck: false,
        storeKind: DataStoreKind.TelemetrySessionReplays,
      }),
    ).toBe(false);
    expect(
      isTelemetryCodeFix({
        isTelemetryCheck: true,
        storeKind: DataStoreKind.AwsS3Bucket,
      }),
    ).toBe(false);
  });

  test("a plan is the application's only when it says so", () => {
    expect(isApplicationTelemetryFix(planOf())).toBe(true);
    expect(isApplicationTelemetryFix({ ownerKind: undefined })).toBe(false);
    expect(
      isApplicationTelemetryFix({
        ownerKind: TelemetryLeakFixOwnerKind.Service,
      }),
    ).toBe(false);
    expect(isApplicationTelemetryFix(null)).toBe(false);
  });
});

describe("how an application's place reads", () => {
  test("its original file and line, with the page it was written on", () => {
    expect(getTelemetryLeakPlaceShown(LOG_LEAK.places[0]!)).toEqual({
      kind: TelemetryLeakPlaceKind.File,
      name: "src/checkout/payment.js:8",
      functionName: "pay",
      page: "/checkout/<value>/pay",
      recordCount: 3,
    });
  });

  test("a session's user details: the session recorder call, on its page", () => {
    expect(getTelemetryLeakPlaceShown(SESSION_LEAK.places[0]!)).toEqual({
      kind: TelemetryLeakPlaceKind.RecorderCall,
      name: "identify()",
      page: "/account",
      recordCount: 2,
    });
  });

  test("a page alone names a place nothing else does", () => {
    expect(
      getTelemetryLeakPlaceShown({ page: "/pricing", recordCount: 1 }),
    ).toEqual({
      kind: TelemetryLeakPlaceKind.Page,
      name: "/pricing",
      recordCount: 1,
    });
  });

  test("its signals read as the browser's and its sessions'", () => {
    expect(TELEMETRY_LEAK_SIGNAL_LABELS[TelemetryLeakSignal.RumLogs]).toBe(
      "Browser Logs",
    );
    expect(TELEMETRY_LEAK_SIGNAL_LABELS[TelemetryLeakSignal.RumSpans]).toBe(
      "Browser Spans",
    );
    expect(TELEMETRY_LEAK_SIGNAL_LABELS[TelemetryLeakSignal.RumSessions]).toBe(
      "Sessions",
    );
  });

  test("why its repository: its source maps, its name or its other leaks - said of the application", () => {
    expect(
      getRepositoryChoiceWords(
        planOf(),
        DataSecurityTelemetryFixRepositoryChoice.SourceMaps,
      ),
    ).toBe("The files its source maps name are there.");
    expect(
      getRepositoryChoiceWords(
        planOf(),
        DataSecurityTelemetryFixRepositoryChoice.NameMatch,
      ),
    ).toBe("Its name matches the application's.");
    expect(
      getRepositoryChoiceWords(
        planOf(),
        DataSecurityTelemetryFixRepositoryChoice.ServiceLeaks,
      ),
    ).toBe("The application's other leaks are written there.");
    // A service's plan keeps the service's words.
    expect(
      getRepositoryChoiceWords(
        { ownerKind: undefined },
        DataSecurityTelemetryFixRepositoryChoice.NameMatch,
      ),
    ).toBe("Its name matches the service's.");
  });

  test("a redaction step removes the data before the browser sends it", () => {
    expect(
      getTelemetryFixStrategyWords(
        planOf({
          strategy: TelemetryLeakFixStrategy.RedactionStep,
          placeCount: 9,
        }),
      ).sentence,
    ).toBe(
      "OneUptime AI adds one redaction step, with a test, that removes the data before the browser sends it.",
    );
  });
});

describe("Fix with AI's plan for a RUM application's leaks", () => {
  test("one pull request for its front-end code: each leak where the browser writes it, its page, and the recorder call", async () => {
    mockPlan({ plan: planOf() });
    renderModal();

    const text: string = await openedPlan();

    expect(shown(screen.getByTestId("modal-description"))).toBe(
      "One pull request stops Storefront sending sensitive data from the browser.",
    );
    expect(text).toContain(
      "It fixes 2 issues of this application, this one among them.",
    );
    expect(text).toContain("Email Address in user.email");
    expect(text).toContain("Browser Logs");
    expect(text).toContain("src/checkout/payment.js:8");
    expect(text).toContain("On /checkout/<value>/pay");
    expect(text).toContain("Email Address in sessions.identifiedUserLabel");
    expect(text).toContain("Sessions");
    expect(text).toContain("Session recorder call identify()");
    expect(text).toContain("On /account");
    expect(text).toContain("Browser Spans");
    expect(text).toContain("Span GET /api/orders");
    expect(text).toContain(
      "OneUptime AI opens it in acme/web, in the application's folder apps/web.",
    );
    expect(text).toContain("The files its source maps name are there.");
    expect(text).toContain("OneUptime AI starts from src/checkout/payment.js.");
    expect(
      screen.getByTestId(`${TELEMETRY_FIX_TEST_ID}-rotate`),
    ).toBeInTheDocument();
    // None of a service's words.
    expect(text).not.toContain("this service");
    expect(text).not.toContain("service's folder");
    expect(text).not.toContain("writing sensitive data to its telemetry");
  });

  test("Open Pull Request asks for exactly the plan shown, and says the application's pull request is on its way", async () => {
    mockPlan({ plan: planOf() });
    const fix: ReturnType<typeof mockFix> = mockFix({
      message: TELEMETRY_FIX_STARTED_APPLICATION,
      aiRunId: "10933000-0000-4000-8000-0000000000f1",
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
    expect(fix.mock.calls[0]![1]).toBeUndefined();
    expect(fix.mock.calls[0]![2]).toBe("fingerprint-rum");
    expect(started[0]!.message).toBe(
      "OneUptime AI is working on one pull request for the application's leaks. It will appear under Code, and on each issue it fixes.",
    );
  });

  test("nothing decides the repository: the reader picks the one with its front-end code", async () => {
    mockPlan({
      plan: planOf({
        repository: undefined,
        folder: undefined,
        repositories: [
          { id: REPOSITORY_ID, name: "acme/web" },
          { id: "10933000-0000-4000-8000-0000000000c2", name: "acme/api" },
        ],
      }),
    });
    const fix: ReturnType<typeof mockFix> = mockFix({
      message: TELEMETRY_FIX_STARTED_APPLICATION,
      aiRunId: "10933000-0000-4000-8000-0000000000f1",
    });

    renderModal();

    const repository: HTMLElement = await screen.findByTestId(
      `${TELEMETRY_FIX_TEST_ID}-repository`,
    );

    expect(shown(repository)).toContain(
      "Pick the repository that holds this application's front-end code. OneUptime AI opens a pull request there.",
    );
    expect(submitButton()).toBeDisabled();

    const combobox: HTMLElement = screen.getByRole("combobox");

    await act(async () => {
      fireEvent.focus(combobox);
      fireEvent.keyDown(combobox, { key: "ArrowDown", keyCode: 40 });
    });

    const web: HTMLElement = await screen.findByRole("option", {
      name: "acme/web",
    });

    await act(async () => {
      fireEvent.click(web);
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
    expect(fix.mock.calls[0]![1]!.toString()).toBe(REPOSITORY_ID);
  });

  test("no repository the reader may ask in: how to connect the one with its front-end code", async () => {
    mockPlan({
      plan: planOf({
        repository: undefined,
        folder: undefined,
        repositories: [],
      }),
    });
    renderModal();

    const repository: HTMLElement = await screen.findByTestId(
      `${TELEMETRY_FIX_TEST_ID}-repository`,
    );

    expect(shown(repository)).toContain(
      "Connect the repository that holds this application's front-end code under Code, then ask again.",
    );
    expect(submitButton()).toBeDisabled();
  });

  test("the plan as the server sends it keeps its owner, and each place's page and recorder call", () => {
    const read: DataSecurityTelemetryFixPlanJSON | null = readTelemetryFixPlan(
      JSON.parse(JSON.stringify(planOf())),
    );

    expect(read?.ownerKind).toBe(TelemetryLeakFixOwnerKind.RumApplication);
    expect(read?.leaks[1]!.places[0]).toEqual({
      recorderCall: "identify",
      page: "/account",
      recordCount: 2,
    });
  });
});

describe("what the server says of an application's fix", () => {
  test("each of its sentences is one the Dashboard translates", () => {
    for (const sentence of [
      DATA_SECURITY_APPLICATION_FIX_STARTED_MESSAGE,
      TELEMETRY_FIX_NOTHING_TO_FIX_IN_APPLICATION_MESSAGE,
      TELEMETRY_FIX_NOT_A_SERVICE_MESSAGE,
      "Choose the repository that holds this application's front-end code.",
      "Connect the repository that holds this application's front-end code under Code, then ask again. If it is connected already, asking OneUptime AI to change it takes permission to edit it in Code - ask a Project Admin for it.",
    ]) {
      expect({
        sentence,
        known: TELEMETRY_FIX_SERVER_SENTENCES.includes(sentence),
      }).toEqual({ sentence, known: true });
    }
  });

  test("nothing left to fix: the dialog says so, and asks for nothing", async () => {
    mockPlan({
      plan: null,
      message: TELEMETRY_FIX_NOTHING_TO_FIX_IN_APPLICATION_MESSAGE,
    });
    renderModal();

    await waitFor(() => {
      expect(shown(screen.getByTestId(TELEMETRY_FIX_TEST_ID))).toContain(
        "This application sends no sensitive data from the browser that OneUptime still sees, so there is nothing to fix in its code.",
      );
    });
  });
});
