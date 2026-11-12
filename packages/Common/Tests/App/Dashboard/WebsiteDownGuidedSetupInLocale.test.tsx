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
};

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
import ProjectUtil from "../../../UI/Utils/Project";
import UserUtil from "../../../UI/Utils/User";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

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

// A default severity's name: a project's severities keep the names they were given.
const SEVERITY_NAME: string = "Critical Incident";

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
  getResultMock.mockResolvedValue(acknowledged);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  for (const mock of Object.values(api)) {
    mock.mockReset();
  }
  getResultMock.mockReset();
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

    expect(row).toContain(
      fill(language, SEVERITY_SENTENCE, { severity: SEVERITY_NAME }),
    );
    // Neither the English sentence nor the name read as a kind of incident.
    expect(row).not.toContain("OneUptime opens an incident");
    expect(row).not.toContain(`${SEVERITY_NAME} incident`);
    expect(row.split(SEVERITY_NAME)).toHaveLength(2);
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
});
