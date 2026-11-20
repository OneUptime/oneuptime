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
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE WEBSITE-DOWN SETUP, READ IN ANOTHER LANGUAGE (#7059, #7060): the
 * summary's "when it goes down" sentence names the incident's severity in
 * brackets after the reader's word for incident - a default severity is
 * called "Critical Incident", and is not translated - and the note that the
 * address is one of the reader's monitors already is in their language too.
 */

const api: Record<string, MockFunction> = {
  findOwnMonitor: getJestMockFunction(),
  createMonitor: getJestMockFunction(),
  loadMonitor: getJestMockFunction(),
  loadFirstCheck: getJestMockFunction(),
  loadWhoIsToldFacts: getJestMockFunction(),
  createPolicy: getJestMockFunction(),
  loadPolicy: getJestMockFunction(),
  loadIncidentSeverityName: getJestMockFunction(),
  isMonitorOwner: getJestMockFunction(),
  ensureMonitorOwner: getJestMockFunction(),
  needsPaymentMethod: getJestMockFunction(),
  findOtherMonitor: getJestMockFunction(),
  loadDefaultLocationCount: getJestMockFunction(),
  loadStatusPages: getJestMockFunction(),
  findStatusPageShowing: getJestMockFunction(),
  addToStatusPage: getJestMockFunction(),
};

/*
 * The server's guided setup runs (#7253), in memory: the store reads and
 * writes them as it would the server's (GuidedSetupRunServerMock).
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/GuidedSetupRunApi",
  () => {
    return (
      jest.requireActual("./GuidedSetupRunServerMock") as {
        guidedSetupRunApiModule: unknown;
      }
    ).guidedSetupRunApiModule;
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/WebsiteDown/WebsiteDownApi",
  () => {
    const calls: Record<string, (...args: Array<unknown>) => unknown> = {};

    for (const name of [
      "findOwnMonitor",
      "createMonitor",
      "loadMonitor",
      "loadFirstCheck",
      "loadWhoIsToldFacts",
      "createPolicy",
      "loadPolicy",
      "loadIncidentSeverityName",
      "isMonitorOwner",
      "ensureMonitorOwner",
      "needsPaymentMethod",
      "findOtherMonitor",
      "loadDefaultLocationCount",
      "loadStatusPages",
      "findStatusPageShowing",
      "addToStatusPage",
    ]) {
      calls[name] = (...args: Array<unknown>): unknown => {
        return api[name]!(...args);
      };
    }

    return {
      __esModule: true,
      default: calls,
      mayCreateMonitor: (): boolean => {
        return true;
      },
      mayAddPaymentMethod: (): boolean => {
        return true;
      },
      mayAddToStatusPage: (): boolean => {
        return true;
      },
      mayUseOnCallSetup: (): boolean => {
        return true;
      },
      isPaymentRequired: (): boolean => {
        return false;
      },
    };
  },
);

/*
 * Who the monitor tells, as the Who step's When this goes down reads it once
 * the project pages people (#7055): answered here, as
 * WebsiteDownGuidedSetup.test.tsx answers it, so no read leaves the test.
 */
const getWhoIsToldMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/WhoIsToldApi",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/WhoIsToldApi",
    ) as Record<string, unknown>;

    return {
      __esModule: true,
      ...actual,
      default: {
        getForMonitor: (...args: Array<unknown>) => {
          return getWhoIsToldMock(...args);
        },
        getForDraft: (...args: Array<unknown>) => {
          return getWhoIsToldMock(...args);
        },
      },
    };
  },
);

const getResultMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/OnCallTestPage/OnCallTestPageApi",
  () => {
    return {
      __esModule: true,
      default: {
        getResult: (...args: Array<unknown>) => {
          return getResultMock(...args);
        },
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/OnCallTestPage/SendTestPageButton",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <button type="button">Send me a test page</button>;
      },
    };
  },
);

jest.mock("../../../UI/Components/PeoplePicker/LazyPeoplePicker", () => {
  return {
    __esModule: true,
    default: () => {
      return <div data-testid="guided-setup-people" />;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink",
  () => {
    return {
      __esModule: true,
      default: (props: {
        to: { toString: () => string };
        children: React.ReactNode;
        dataTestId?: string;
      }) => {
        return (
          <a href={props.to.toString()} data-testid={props.dataTestId}>
            {props.children}
          </a>
        );
      },
    };
  },
);

jest.mock("../../../UI/Utils/ServerSending", () => {
  return {
    __esModule: true,
    useServerCanSendEmail: () => {
      return true;
    },
  };
});

jest.mock("../../../UI/Utils/ProductEvents", () => {
  return {
    __esModule: true,
    default: {
      send: () => {
        // Not what this suite is about.
      },
    },
  };
});

import WebsiteDownGuidedSetup from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/WebsiteDown/WebsiteDownGuidedSetup";
import { getGuidedSetupRunKey } from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/GuidedSetupProgress";
import {
  CHECK_HELP_FROM_LOCATIONS,
  WEBSITE_DOWN_COPY,
  buildWebsiteMonitor,
} from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/WebsiteDown/WebsiteDownSetup";
import ObjectID from "../../../Types/ObjectID";
import {
  OnCallTestPageRecordKind,
  OnCallTestPageResult,
  OnCallTestPageStatus,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import { WhoIsToldResult } from "../../../Types/Monitor/WhoIsTold";
import ProjectUtil from "../../../UI/Utils/Project";
import UserUtil from "../../../UI/Utils/User";
import {
  DASHBOARD_LANGUAGES,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { guidedSetupRunServer } from "./GuidedSetupRunServerMock";

const PROJECT_ID: string = "65f00000-0000-4000-8000-000000007060";
const USER_ID: string = "40000000-0000-4000-8000-000000007060";
const MONITOR_ID: string = "50000000-0000-4000-8000-000000007060";
const POLICY_ID: string = "60000000-0000-4000-8000-000000007060";

const RUN_KEY: string = getGuidedSetupRunKey({
  setup: "website_down",
  projectId: PROJECT_ID,
  userId: USER_ID,
});

const SEVERITY_SENTENCE: string =
  "If it does not answer, or answers with an error, OneUptime opens an incident ({{severity}}).";

/*
 * A new project's default severity: OneUptime's name for it, read in the
 * reader's language by its list (Common/Utils/DefaultRecordNames, #7894).
 */
const SEVERITY_NAME: string = "Critical Incident";

// A severity the project named itself: drawn as written in every language.
const OWN_SEVERITY_NAME: string = "Sev 1 Outage";

const MONITOR: {
  id: string;
  name: string;
  monitorSteps: unknown;
  monitoringInterval: string;
} = {
  id: MONITOR_ID,
  name: "acme.example",
  monitorSteps: buildWebsiteMonitor({
    address: {
      url: "https://acme.example",
      host: "acme.example",
      monitorName: "acme.example",
    },
    isApi: false,
    seeds: {
      operationalStatusId: new ObjectID("00000000-0000-4000-8000-000000000001"),
      offlineStatusId: new ObjectID("00000000-0000-4000-8000-000000000002"),
      incidentSeverityId: new ObjectID("00000000-0000-4000-8000-000000000003"),
      alertSeverityId: new ObjectID("00000000-0000-4000-8000-000000000004"),
    },
  }).monitorSteps,
  monitoringInterval: "*/5 * * * *",
};

const LANGUAGES: Array<string> = ["de", "ar", "fa", "ja", "hi"];

const fill: (
  language: string,
  key: string,
  values: Record<string, string>,
) => string = (
  language: string,
  key: string,
  values: Record<string, string>,
): string => {
  let text: string = readDashboardLocale(language)[key]!;

  expect({ language, key, worded: Boolean(text) && text !== key }).toEqual({
    language,
    key,
    worded: true,
  });

  for (const name of Object.keys(values)) {
    text = text.split(`{{${name}}}`).join(values[name]!);
  }

  return text;
};

const inLanguage: (language: string) => Promise<void> = async (
  language: string,
): Promise<void> => {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage(language);
  });
};

const renderSetup: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    render(<WebsiteDownGuidedSetup firstCheckPollIntervalInMs={5} />);
  });

  await waitFor(() => {
    expect(screen.getByTestId("guided-setup")).toBeInTheDocument();
  });
};

const acknowledged: OnCallTestPageResult = {
  executionLogId: "log-1",
  kind: "Self",
  recordKind: OnCallTestPageRecordKind.Incident,
  severityName: SEVERITY_NAME,
  walksEscalation: false,
  status: OnCallTestPageStatus.Acknowledged,
  statusMessage: "",
  startedAt: "2026-11-11T10:00:00.000Z",
  endsAt: "2099-11-11T10:30:00.000Z",
  acknowledgedByName: "Ada Lovelace",
  acknowledgedChannel: OnCallPageChannel.Email,
  acknowledgedAfterSeconds: 14,
  steps: [],
} as OnCallTestPageResult;

// The monitor's When this goes down: what it says is not what this suite reads.
const WHO_IS_TOLD: WhoIsToldResult = {
  monitorId: MONITOR_ID,
  monitorName: "acme.example",
  checkedAt: "2026-11-11T10:00:00.000Z",
  criteria: [],
  channels: {
    isBillingEnabled: false,
    isSmsOn: true,
    isCallOn: true,
    isWhatsAppOn: true,
    isTelegramOn: true,
    hasOwnTwilioForSms: false,
    hasOwnTwilioForCalls: false,
    serverCanSendEmail: true,
    serverCanSendSms: true,
    serverCanCall: true,
  },
  breaks: [],
};

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const language of LANGUAGES) {
    resources[language] = { translation: readDashboardLocale(language) };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(() => {
  guidedSetupRunServer.reset();
  window.localStorage.clear();
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest.spyOn(UserUtil, "getUserId").mockReturnValue(new ObjectID(USER_ID));
  jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(false);

  api["findOwnMonitor"]!.mockResolvedValue(null);
  api["createMonitor"]!.mockResolvedValue(MONITOR_ID);
  api["loadMonitor"]!.mockResolvedValue(MONITOR);
  api["loadFirstCheck"]!.mockResolvedValue({
    locationCount: 2,
    activeLocationCount: 2,
    answers: [
      { isOnline: true, responseCode: 200, responseTimeInMs: 312 },
      { isOnline: true, responseCode: 200, responseTimeInMs: 312 },
    ],
  });
  api["loadWhoIsToldFacts"]!.mockResolvedValue({
    policyCount: 0,
    incidentRuleCount: 0,
    alertRuleCount: 0,
    mayCreatePolicy: true,
    mayAddEscalationRules: true,
    mayAddRules: true,
  });
  api["loadPolicy"]!.mockResolvedValue({
    id: POLICY_ID,
    name: "Default on-call policy",
    responders: ["Ada Lovelace"],
  });
  api["loadIncidentSeverityName"]!.mockResolvedValue(SEVERITY_NAME);
  api["isMonitorOwner"]!.mockResolvedValue(true);
  api["ensureMonitorOwner"]!.mockResolvedValue(true);
  api["needsPaymentMethod"]!.mockResolvedValue(false);
  api["findOtherMonitor"]!.mockResolvedValue(null);
  api["loadDefaultLocationCount"]!.mockResolvedValue(2);
  api["loadStatusPages"]!.mockResolvedValue([]);
  api["findStatusPageShowing"]!.mockResolvedValue(null);
  api["addToStatusPage"]!.mockResolvedValue(undefined);
  getResultMock.mockResolvedValue(acknowledged);
  getWhoIsToldMock.mockResolvedValue(WHO_IS_TOLD);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  for (const mock of Object.values(api)) {
    mock.mockReset();
  }
  getResultMock.mockReset();
  getWhoIsToldMock.mockReset();
  window.localStorage.clear();
});

afterAll(async () => {
  await inLanguage("en");
});

describe.each(LANGUAGES)("read in %s", (language: string) => {
  beforeAll(async () => {
    await inLanguage(language);
  });

  test("the summary names the severity in brackets after the word for incident, in the reader's words (#7060)", async () => {
    window.localStorage.setItem(
      RUN_KEY,
      JSON.stringify({
        monitorId: MONITOR_ID,
        policyId: POLICY_ID,
        testExecutionLogId: "log-1",
      }),
    );
    await renderSetup();

    await waitFor(() => {
      expect(
        screen.getByTestId("guided-setup-summary-when_down"),
      ).toBeInTheDocument();
    });

    const row: string = withoutIsolateMarks(
      screen.getByTestId("guided-setup-summary-when_down").textContent || "",
    );

    const severity: string = readDashboardLocale(language)[SEVERITY_NAME]!;

    expect(severity).not.toBe(SEVERITY_NAME);
    expect(row).toContain(fill(language, SEVERITY_SENTENCE, { severity }));
    // Neither the English sentence nor the name read as a kind of incident.
    expect(row).not.toContain("OneUptime opens an incident");
    expect(row).not.toContain(SEVERITY_NAME);
    expect(row.split(severity)).toHaveLength(2);
  });

  test("a severity the project named itself is named as written, in brackets (#7894)", async () => {
    api["loadIncidentSeverityName"]!.mockResolvedValue(OWN_SEVERITY_NAME);
    window.localStorage.setItem(
      RUN_KEY,
      JSON.stringify({
        monitorId: MONITOR_ID,
        policyId: POLICY_ID,
        testExecutionLogId: "log-1",
      }),
    );
    await renderSetup();

    await waitFor(() => {
      expect(
        screen.getByTestId("guided-setup-summary-when_down"),
      ).toBeInTheDocument();
    });

    const row: string = withoutIsolateMarks(
      screen.getByTestId("guided-setup-summary-when_down").textContent || "",
    );

    expect(row).toContain(
      fill(language, SEVERITY_SENTENCE, { severity: OWN_SEVERITY_NAME }),
    );
    expect(row.split(OWN_SEVERITY_NAME)).toHaveLength(2);
  });

  test("an address the reader's monitor already checks: the note is in their words (#7059)", async () => {
    api["findOwnMonitor"]!.mockResolvedValue(MONITOR);
    await renderSetup();

    fireEvent.change(screen.getByTestId("guided-setup-address"), {
      target: { value: "acme.example" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("guided-setup-start-checking"));
    });

    await waitFor(() => {
      expect(
        screen.getByTestId("guided-setup-existing-monitor"),
      ).toBeInTheDocument();
    });

    const note: string = withoutIsolateMarks(
      screen.getByTestId("guided-setup-existing-monitor").textContent || "",
    );

    expect(note).toBe(
      fill(language, WEBSITE_DOWN_COPY.existingMonitor, {
        name: "acme.example",
      }),
    );
    expect(note).not.toContain("already checks this address");
    expect(api["createMonitor"]).not.toHaveBeenCalled();
  });

  /*
   * A teammate's monitor for the address (#7254): the sentence in the
   * reader's words, the monitor's name and the person kept as written and
   * set apart, so a right-to-left sentence keeps them in order.
   */
  test("a monitor a teammate made for the address: said in their words, before anything is made (#7254)", async () => {
    api["findOtherMonitor"]!.mockResolvedValue({
      id: "50000000-0000-4000-8000-000000000099",
      name: "Acme storefront",
      creatorName: "Grace Hopper",
      isOwn: false,
      record: { ...MONITOR, id: "50000000-0000-4000-8000-000000000099" },
    });
    await renderSetup();

    fireEvent.change(screen.getByTestId("guided-setup-address"), {
      target: { value: "acme.example" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("guided-setup-start-checking"));
    });

    await waitFor(() => {
      expect(
        screen.getByTestId("guided-setup-other-monitor-sentence"),
      ).toBeInTheDocument();
    });

    const drawn: string =
      screen.getByTestId("guided-setup-other-monitor-sentence").textContent ||
      "";

    expect(withoutIsolateMarks(drawn)).toBe(
      fill(language, WEBSITE_DOWN_COPY.otherMonitorMadeBy, {
        name: "Acme storefront",
        person: "Grace Hopper",
      }),
    );
    /*
     * In a sentence read right to left, the name and the person in Latin
     * letters are set apart from the words around them.
     */
    if (language === "ar" || language === "fa") {
      expect(drawn).not.toBe(withoutIsolateMarks(drawn));
    }
    expect(screen.getByTestId("guided-setup-other-monitor")).toHaveTextContent(
      fill(language, WEBSITE_DOWN_COPY.otherMonitorChoice, {}),
    );
    expect(
      screen.getByTestId("guided-setup-create-own-monitor"),
    ).toHaveTextContent(fill(language, WEBSITE_DOWN_COPY.createOwnMonitor, {}));
    expect(api["createMonitor"]).not.toHaveBeenCalled();
  });

  /*
   * Step 1's help with its number (#7461), and its Glossary words (#7057),
   * in the reader's language: the number in their digits.
   */
  test("step 1 says from how many locations in their words, the Glossary's words in them (#7461, #7057)", async () => {
    api["loadDefaultLocationCount"]!.mockResolvedValue(3);
    await renderSetup();

    const help: string = withoutIsolateMarks(
      screen.getByTestId("guided-setup-check-help").textContent || "",
    ).replace(/[\u00A0\u202F]/g, " ");
    const table: Record<string, string> = readDashboardLocale(language);
    const worded: string = table[CHECK_HELP_FROM_LOCATIONS.other]!;

    expect(help).toBe(
      worded
        .replace("{{monitor}}", table["monitor"]!)
        .replace("{{incident}}", table["incident"]!)
        .replace(
          "{{count}}",
          new Intl.NumberFormat(language === "fa" ? "fa" : "en").format(3),
        )
        .replace(/[\u00A0\u202F]/g, " "),
    );
    expect(help).not.toContain("OneUptime makes a");
  });

  test("step 2's How to Reach Me link reads as their page is named (#7757)", async () => {
    window.localStorage.setItem(
      RUN_KEY,
      JSON.stringify({ monitorId: MONITOR_ID }),
    );
    await renderSetup();

    await waitFor(() => {
      expect(
        screen.getByTestId("guided-setup-how-to-reach-me"),
      ).toBeInTheDocument();
    });

    const name: string = readDashboardLocale(language)["How to Reach Me"]!;

    expect(name).not.toBe("How to Reach Me");
    expect(
      screen.getByTestId("guided-setup-how-to-reach-me"),
    ).toHaveTextContent(name);
    expect(
      withoutIsolateMarks(
        screen.getByTestId("guided-setup-who-create-help").textContent || "",
      ),
    ).toBe(
      fill(language, WEBSITE_DOWN_COPY.whoCreateHelp, { howToReachMe: name }),
    );
  });

  test("a policy added while the page was open: the step says so in their words (#7059)", async () => {
    window.localStorage.setItem(
      RUN_KEY,
      JSON.stringify({ monitorId: MONITOR_ID }),
    );
    await renderSetup();

    await waitFor(() => {
      expect(
        screen.getByTestId("guided-setup-who-continue"),
      ).toBeInTheDocument();
    });

    // Another tab made the project's first policy since the step opened.
    api["loadWhoIsToldFacts"]!.mockResolvedValue({
      policyCount: 1,
      incidentRuleCount: 1,
      alertRuleCount: 1,
      mayCreatePolicy: true,
      mayAddEscalationRules: true,
      mayAddRules: true,
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("guided-setup-who-continue"));
    });

    await waitFor(() => {
      expect(
        screen.getByTestId("guided-setup-policy-made-elsewhere"),
      ).toBeInTheDocument();
    });

    const note: string = withoutIsolateMarks(
      screen.getByTestId("guided-setup-policy-made-elsewhere").textContent ||
        "",
    );

    expect(note).toBe(
      fill(language, WEBSITE_DOWN_COPY.policyMadeElsewhere, {}),
    );
    expect(note).not.toContain("while this page was open");
    expect(api["createPolicy"]).not.toHaveBeenCalled();
  });

  /*
   * #7995: the policy the step makes is the project's first, and its name
   * is a record the project's people then see and edit: it is named in the
   * reader's language, and the step says that name before it is made.
   */
  test("the policy the step makes is named in their words, as the step says before it is made (#7995)", async () => {
    window.localStorage.setItem(
      RUN_KEY,
      JSON.stringify({ monitorId: MONITOR_ID }),
    );
    api["createPolicy"]!.mockResolvedValue(POLICY_ID);
    await renderSetup();

    await waitFor(() => {
      expect(
        screen.getByTestId("guided-setup-who-continue"),
      ).toBeInTheDocument();
    });

    const name: string =
      readDashboardLocale(language)["Default on-call policy"]!;

    expect(name).toBeTruthy();
    expect(name).not.toBe("Default on-call policy");
    /*
     * The Glossary's word for an on-call policy, marked in the sentence
     * (#7057), is the reader's too.
     */
    expect(withoutIsolateMarks(document.body.textContent || "")).toContain(
      fill(language, WEBSITE_DOWN_COPY.whoCreatePolicyNote, {
        policy: name,
        onCallPolicy: readDashboardLocale(language)["on-call policy"]!,
      }),
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("guided-setup-who-continue"));
    });

    await waitFor(() => {
      expect(api["createPolicy"]).toHaveBeenCalled();
    });

    const call: { translator: { language: string } } = api["createPolicy"]!.mock
      .calls[0]![0] as { translator: { language: string } };

    // The reader's translator: the policy and its rules are worded in their language.
    expect(call.translator.language).toBe(language);
  });

  /*
   * #8235: the policy the run made was deleted in another tab; the test
   * step's Continue reads it again, and step 2 says why in their words,
   * first in its polite live region.
   */
  test("the run's policy deleted meanwhile: step 2 says why in their words (#8235)", async () => {
    window.localStorage.setItem(
      RUN_KEY,
      JSON.stringify({
        monitorId: MONITOR_ID,
        policyId: POLICY_ID,
        testExecutionLogId: "log-1",
      }),
    );
    await renderSetup();

    // The summary is shown; reopening the test step, its Continue reads again.
    await waitFor(() => {
      expect(screen.getByTestId("guided-setup-summary")).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(
        screen.getByTestId("guided-setup-step-test").querySelector("button")!,
      );
    });
    api["loadPolicy"]!.mockResolvedValue(null);
    await act(async () => {
      fireEvent.click(screen.getByTestId("guided-setup-test-continue"));
    });

    await waitFor(() => {
      expect(
        screen.getByTestId("guided-setup-policy-deleted"),
      ).toBeInTheDocument();
    });

    const sentence: string = withoutIsolateMarks(
      screen.getByTestId("guided-setup-policy-deleted").textContent || "",
    );

    expect(sentence).toBe(fill(language, WEBSITE_DOWN_COPY.policyDeleted, {}));
    expect(sentence).not.toContain("was deleted");
    expect(
      screen
        .getByTestId("guided-setup-who-region")
        .firstElementChild?.getAttribute("data-testid"),
    ).toBe("guided-setup-policy-deleted");
    expect(screen.queryByTestId("guided-setup-summary")).toBeNull();
  });

  /*
   * #8432: the policy the run made was archived in another tab; the test
   * step's Continue reads it again, and step 2 says so in their words - its
   * own sentence, not the deleted one's - first in its polite live region.
   */
  test("the run's policy archived meanwhile: step 2 says why in their words (#8432)", async () => {
    window.localStorage.setItem(
      RUN_KEY,
      JSON.stringify({
        monitorId: MONITOR_ID,
        policyId: POLICY_ID,
        testExecutionLogId: "log-1",
      }),
    );
    await renderSetup();

    await waitFor(() => {
      expect(screen.getByTestId("guided-setup-summary")).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(
        screen.getByTestId("guided-setup-step-test").querySelector("button")!,
      );
    });
    api["loadPolicy"]!.mockResolvedValue({
      id: POLICY_ID,
      name: "Default on-call policy",
      responders: ["Ada Lovelace"],
      isArchived: true,
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("guided-setup-test-continue"));
    });

    await waitFor(() => {
      expect(
        screen.getByTestId("guided-setup-policy-archived"),
      ).toBeInTheDocument();
    });

    const sentence: string = withoutIsolateMarks(
      screen.getByTestId("guided-setup-policy-archived").textContent || "",
    );

    expect(sentence).toBe(fill(language, WEBSITE_DOWN_COPY.policyArchived, {}));
    expect(sentence).not.toBe(
      fill(language, WEBSITE_DOWN_COPY.policyDeleted, {}),
    );
    expect(sentence).not.toMatch(/archived|pages no one|told again/iu);
    expect(screen.queryByTestId("guided-setup-policy-deleted")).toBeNull();
    expect(
      screen
        .getByTestId("guided-setup-who-region")
        .firstElementChild?.getAttribute("data-testid"),
    ).toBe("guided-setup-policy-archived");
    expect(screen.queryByTestId("guided-setup-summary")).toBeNull();
  });
});

/*
 * The sentence for an archived policy is worded in every Dashboard
 * language (#8432): a value of its own in each, apart from the deleted
 * sentence, ended as its language ends a sentence.
 */
describe("the website-down sentence for an archived policy, in every Dashboard language (#8432)", () => {
  test("English has it, as itself", () => {
    expect(readDashboardLocale("en")[WEBSITE_DOWN_COPY.policyArchived]).toBe(
      WEBSITE_DOWN_COPY.policyArchived,
    );
  });

  test.each([...DASHBOARD_LANGUAGES])(
    "%s words it, apart from its deleted sentence",
    (code: string) => {
      const locale: Record<string, string> = readDashboardLocale(code);
      const text: string | undefined = locale[WEBSITE_DOWN_COPY.policyArchived];

      expect({
        code,
        worded: Boolean(
          text && text.trim() && text !== WEBSITE_DOWN_COPY.policyArchived,
        ),
      }).toEqual({ code, worded: true });
      expect(text).not.toBe(locale[WEBSITE_DOWN_COPY.policyDeleted]);
      expect(text).toMatch(/[.。।]$/u);
    },
  );
});

/*
 * The sentence for a deleted policy is worded in every Dashboard language
 * (#8235): a value of its own in each, ended as its language ends a
 * sentence - never the English left as a placeholder.
 */
describe("the website-down sentence for a deleted policy, in every Dashboard language (#8235)", () => {
  test("English has it, as itself", () => {
    expect(readDashboardLocale("en")[WEBSITE_DOWN_COPY.policyDeleted]).toBe(
      WEBSITE_DOWN_COPY.policyDeleted,
    );
  });

  test.each([...DASHBOARD_LANGUAGES])("%s words it", (code: string) => {
    const text: string | undefined =
      readDashboardLocale(code)[WEBSITE_DOWN_COPY.policyDeleted];

    expect({
      code,
      worded: Boolean(
        text && text.trim() && text !== WEBSITE_DOWN_COPY.policyDeleted,
      ),
    }).toEqual({ code, worded: true });
    expect(text).toMatch(/[.。।]$/u);
  });

  test("the languages read are all seventeen, Arabic and Persian among them", () => {
    expect(DASHBOARD_LANGUAGES).toHaveLength(17);
    expect(DASHBOARD_LANGUAGES).toEqual(
      expect.arrayContaining(["de", "ar", "fa"]),
    );
  });
});
