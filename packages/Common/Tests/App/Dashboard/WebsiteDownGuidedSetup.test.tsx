import {
  afterEach,
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
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The website-down guided setup, step by step (issue #6804): from an
 * address to a tested notification on one page. Each step saves real
 * records through the model API (mocked here at WebsiteDownApi), leaving
 * and coming back resumes at the first step not done with nothing made
 * twice, a member who may not set paging up still finishes - told as the
 * monitor's owner, and told so - and the summary says only what the
 * records say. The setup's events are the ones #6830 documents.
 */

const api: Record<string, MockFunction> = {
  loadMonitorSeeds: getJestMockFunction(),
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
let mayCreateMonitor: boolean = true;

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/WebsiteDown/WebsiteDownApi",
  () => {
    const calls: Record<string, (...args: Array<unknown>) => unknown> = {};

    for (const name of [
      "loadMonitorSeeds",
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
        return mayCreateMonitor;
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

// The button opens the real dialog; here it sends at once.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/OnCallTestPage/SendTestPageButton",
  () => {
    return {
      __esModule: true,
      default: (props: {
        target: { kind: string };
        title?: string;
        onSent?: (id: string) => void;
      }) => {
        return (
          <button
            type="button"
            data-testid="send-test-page"
            data-target={props.target.kind}
            onClick={() => {
              props.onSent?.("log-1");
            }}
          >
            {props.title || "Send me a test page"}
          </button>
        );
      },
    };
  },
);

// What the test page's result tells the setup, as each read would.
let reportTestResult: (result: unknown) => void = () => {};

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/OnCallTestPage/TestPageResult",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/OnCallTestPage/TestPageResult",
    ) as Record<string, unknown>;

    return {
      __esModule: true,
      ...actual,
      default: (props: {
        executionLogId: string;
        onResult?: (result: unknown) => void;
      }) => {
        reportTestResult = (result: unknown): void => {
          props.onResult?.(result);
        };
        return <div data-testid="test-page-result">{props.executionLogId}</div>;
      },
    };
  },
);

jest.mock("../../../UI/Components/PeoplePicker/LazyPeoplePicker", () => {
  return {
    __esModule: true,
    default: (props: {
      value: Record<string, Array<string>>;
      onChange: (value: Record<string, Array<string>>) => void;
      error?: string;
    }) => {
      return (
        <div data-testid="guided-setup-people">
          <span data-testid="picked">{JSON.stringify(props.value)}</span>
          <button
            type="button"
            onClick={() => {
              props.onChange({
                user: [...(props.value["user"] || []), "user-grace"],
                team: ["team-platform"],
              });
            }}
          >
            Add Grace and Platform
          </button>
          <button
            type="button"
            onClick={() => {
              props.onChange({});
            }}
          >
            Remove everyone
          </button>
          {props.error ? <p>{props.error}</p> : <></>}
        </div>
      );
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

let canSendEmail: boolean | null = true;

jest.mock("../../../UI/Utils/ServerSending", () => {
  return {
    __esModule: true,
    useServerCanSendEmail: () => {
      return canSendEmail;
    },
  };
});

const sendMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ProductEvents", () => {
  return {
    __esModule: true,
    default: {
      send: (...args: Array<unknown>) => {
        return sendMock(...args);
      },
    },
  };
});

import WebsiteDownGuidedSetup from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/WebsiteDown/WebsiteDownGuidedSetup";
import { getGuidedSetupRunKey } from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/GuidedSetupProgress";
import { GUIDED_SETUP_GUIDE_LINK_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/GuidedSetupFrame";
import {
  WEBSITE_DOWN_COPY,
  WEBSITE_DOWN_SETUP_GUIDE_DOCS_PATH,
  buildWebsiteMonitor,
  isMonitorCheckingAddress,
  WebsiteAddress,
  WebsiteMonitorSeeds,
} from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/WebsiteDown/WebsiteDownSetup";
import { WebsiteDownMonitorRecord } from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/WebsiteDown/WebsiteDownApi";
import { ProductEventName } from "../../../Types/Analytics/ProductEvent";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import ObjectID from "../../../Types/ObjectID";
import {
  OnCallTestPageRecordKind,
  OnCallTestPageResult,
  OnCallTestPageStatus,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import { getLearnMoreUrl } from "../../../UI/Components/Link/LearnMoreLink";
import ProjectUtil from "../../../UI/Utils/Project";
import UserUtil from "../../../UI/Utils/User";

const PROJECT_ID: string = "65f00000-0000-4000-8000-000000006804";
const USER_ID: string = "40000000-0000-4000-8000-000000000001";
const MONITOR_ID: string = "50000000-0000-4000-8000-000000000001";
const POLICY_ID: string = "60000000-0000-4000-8000-000000000001";

const RUN_KEY: string = getGuidedSetupRunKey({
  setup: "website_down",
  projectId: PROJECT_ID,
  userId: USER_ID,
});

const SEEDS: WebsiteMonitorSeeds = {
  operationalStatusId: new ObjectID("00000000-0000-4000-8000-000000000001"),
  offlineStatusId: new ObjectID("00000000-0000-4000-8000-000000000002"),
  incidentSeverityId: new ObjectID("00000000-0000-4000-8000-000000000003"),
  alertSeverityId: new ObjectID("00000000-0000-4000-8000-000000000004"),
};

const monitorSteps: MonitorSteps = buildWebsiteMonitor({
  address: {
    url: "https://acme.example",
    host: "acme.example",
    monitorName: "acme.example",
  },
  isApi: false,
  seeds: SEEDS,
}).monitorSteps!;

const MONITOR: {
  id: string;
  name: string;
  monitorSteps: MonitorSteps;
  monitoringInterval: string;
} = {
  id: MONITOR_ID,
  name: "acme.example",
  monitorSteps: monitorSteps,
  monitoringInterval: "*/5 * * * *",
};

const result: (status: OnCallTestPageStatus) => OnCallTestPageResult = (
  status: OnCallTestPageStatus,
): OnCallTestPageResult => {
  return {
    executionLogId: "log-1",
    kind: "Self",
    recordKind: OnCallTestPageRecordKind.Incident,
    severityName: "Critical",
    walksEscalation: false,
    status: status,
    statusMessage: "",
    startedAt: "2026-11-11T10:00:00.000Z",
    endsAt: "2099-11-11T10:30:00.000Z",
    acknowledgedByName:
      status === OnCallTestPageStatus.Acknowledged ? "Ada Lovelace" : undefined,
    acknowledgedChannel:
      status === OnCallTestPageStatus.Acknowledged
        ? OnCallPageChannel.Email
        : undefined,
    acknowledgedAfterSeconds:
      status === OnCallTestPageStatus.Acknowledged ? 14 : undefined,
    steps: [],
  } as OnCallTestPageResult;
};

const storedRun: () => Record<string, unknown> = (): Record<
  string,
  unknown
> => {
  return JSON.parse(window.localStorage.getItem(RUN_KEY) || "{}") as Record<
    string,
    unknown
  >;
};

const keepRun: (run: Record<string, unknown>) => void = (
  run: Record<string, unknown>,
): void => {
  window.localStorage.setItem(RUN_KEY, JSON.stringify(run));
};

const renderSetup: () => Promise<{ unmount: () => void }> = async (): Promise<{
  unmount: () => void;
}> => {
  let unmount: () => void = () => {};

  await act(async () => {
    unmount = render(
      <WebsiteDownGuidedSetup firstCheckPollIntervalInMs={5} />,
    ).unmount;
  });

  await waitFor(() => {
    expect(screen.getByTestId("guided-setup")).toBeInTheDocument();
  });

  return { unmount };
};

const stepState: (key: string) => string | null = (
  key: string,
): string | null => {
  return screen
    .getByTestId(`guided-setup-step-${key}`)
    .getAttribute("data-state");
};

const sent: (name: ProductEventName) => Array<Record<string, unknown>> = (
  name: ProductEventName,
): Array<Record<string, unknown>> => {
  return sendMock.mock.calls
    .filter((call: Array<unknown>): boolean => {
      return call[0] === name;
    })
    .map((call: Array<unknown>): Record<string, unknown> => {
      return call[1] as Record<string, unknown>;
    });
};

const typeAddress: (text: string) => void = (text: string): void => {
  fireEvent.change(screen.getByTestId("guided-setup-address"), {
    target: { value: text },
  });
};

const startChecking: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    fireEvent.click(screen.getByTestId("guided-setup-start-checking"));
  });
};

const press: (testId: string) => Promise<void> = async (
  testId: string,
): Promise<void> => {
  await act(async () => {
    fireEvent.click(screen.getByTestId(testId));
  });
};

beforeEach(() => {
  window.localStorage.clear();
  mayCreateMonitor = true;
  canSendEmail = true;
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest.spyOn(UserUtil, "getUserId").mockReturnValue(new ObjectID(USER_ID));
  jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(false);

  // This person has no monitor for the address yet.
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
  api["createPolicy"]!.mockResolvedValue(POLICY_ID);
  api["loadPolicy"]!.mockResolvedValue({
    id: POLICY_ID,
    name: "Default on-call policy",
    responders: ["Ada Lovelace"],
  });
  api["loadIncidentSeverityName"]!.mockResolvedValue("Critical");
  api["isMonitorOwner"]!.mockResolvedValue(true);
  getResultMock.mockResolvedValue(result(OnCallTestPageStatus.Acknowledged));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  for (const mock of Object.values(api)) {
    mock.mockReset();
  }
  getResultMock.mockReset();
  sendMock.mockReset();
  window.localStorage.clear();
});

describe("a brand-new project", () => {
  test("opens on the first step, with the whole job in view", async () => {
    await renderSetup();

    expect(stepState("check")).toBe("open");
    expect(stepState("who_is_told")).toBe("upcoming");
    expect(stepState("test")).toBe("upcoming");
    expect(screen.getByTestId("guided-setup-progress")).toHaveTextContent(
      "0 of 3 steps done",
    );
    expect(screen.getByText("What should we check?")).toBeInTheDocument();
    expect(screen.getByText("Who should be told?")).toBeInTheDocument();
    expect(screen.getByText("Send a test")).toBeInTheDocument();
    // Nothing is made just by opening it.
    expect(api["createMonitor"]).not.toHaveBeenCalled();
    expect(api["createPolicy"]).not.toHaveBeenCalled();
  });

  // The docs walk the same job end to end (#6821), linked beside the progress.
  test("links the docs' step-by-step guide to the same job", async () => {
    await renderSetup();

    expect(WEBSITE_DOWN_SETUP_GUIDE_DOCS_PATH).toBe(
      "/docs/guides/website-down",
    );
    expect(screen.getByTestId(GUIDED_SETUP_GUIDE_LINK_TEST_ID)).toHaveAttribute(
      "href",
      getLearnMoreUrl(WEBSITE_DOWN_SETUP_GUIDE_DOCS_PATH, "en"),
    );
  });

  test("a later step cannot be opened before the ones it builds on", async () => {
    await renderSetup();

    expect(
      screen
        .getByTestId("guided-setup-step-who_is_told")
        .querySelector("button"),
    ).toBeNull();
  });

  test("sends started, and the first step reached", async () => {
    await renderSetup();

    expect(sent(ProductEventName.GuidedSetupStarted)).toEqual([
      { setup: "website_down" },
    ]);
    expect(sent(ProductEventName.GuidedSetupStepReached)).toEqual([
      { setup: "website_down", step: "check", step_number: 1 },
    ]);
  });
});

describe("1. What should we check?", () => {
  test("every other kind of monitor is one link away, on Create Monitor", async () => {
    await renderSetup();

    expect(screen.getByTestId("guided-setup-other-types")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/monitors/create`,
    );
    expect(screen.getByTestId("guided-setup-other-types")).toHaveTextContent(
      "More monitor types",
    );
  });

  test("an address that is not one is said so, and makes nothing", async () => {
    await renderSetup();
    typeAddress("not an address");
    await startChecking();

    expect(
      screen.getByText(WEBSITE_DOWN_COPY.addressError),
    ).toBeInTheDocument();
    expect(api["createMonitor"]).not.toHaveBeenCalled();
    expect(stepState("check")).toBe("open");
  });

  test("makes a Website monitor named after the host, and keeps it in the run", async () => {
    await renderSetup();
    typeAddress("acme.example");
    await startChecking();

    expect(api["createMonitor"]).toHaveBeenCalledTimes(1);
    const call: { address: WebsiteAddress; isApi: boolean } = api[
      "createMonitor"
    ]!.mock.calls[0]![0] as { address: WebsiteAddress; isApi: boolean };
    expect(call.address).toEqual({
      url: "https://acme.example",
      host: "acme.example",
      monitorName: "acme.example",
    });
    expect(call.isApi).toBe(false);
    expect(storedRun()).toEqual({ monitorId: MONITOR_ID });
    // Only after looking for this person's own monitor for the address.
    expect(api["findOwnMonitor"]).toHaveBeenCalledTimes(1);
    expect(api["findOwnMonitor"]).toHaveBeenCalledWith({
      address: call.address,
      userId: USER_ID,
    });
    expect(api["findOwnMonitor"]!.mock.invocationCallOrder[0]!).toBeLessThan(
      api["createMonitor"]!.mock.invocationCallOrder[0]!,
    );
    expect(
      screen.queryByTestId("guided-setup-existing-monitor"),
    ).not.toBeInTheDocument();
  });

  test("an API monitor when the box is ticked", async () => {
    await renderSetup();
    typeAddress("https://api.acme.example/health");
    await act(async () => {
      fireEvent.click(screen.getByText(WEBSITE_DOWN_COPY.isApiLabel));
    });
    await startChecking();

    expect(
      (api["createMonitor"]!.mock.calls[0]![0] as { isApi: boolean }).isApi,
    ).toBe(true);
  });

  test("says what the first check found, in a sentence, once a probe answers", async () => {
    api["loadFirstCheck"]!.mockResolvedValueOnce({
      locationCount: 2,
      answers: [],
    }).mockResolvedValue({
      locationCount: 2,
      answers: [
        { isOnline: true, responseCode: 200, responseTimeInMs: 312 },
        { isOnline: true, responseCode: 200, responseTimeInMs: 312 },
      ],
    });

    await renderSetup();
    typeAddress("acme.example");
    await startChecking();

    await waitFor(() => {
      expect(screen.getByTestId("guided-setup-first-check")).toHaveTextContent(
        "acme.example answered 200 in 312 ms from 2 locations.",
      );
    });
    expect(api["loadFirstCheck"]).toHaveBeenCalledWith(MONITOR_ID);
    // It stops asking once a probe has answered.
    const asked: number = api["loadFirstCheck"]!.mock.calls.length;
    await act(async () => {
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 40);
      });
    });
    expect(api["loadFirstCheck"]!.mock.calls.length).toBe(asked);
  });

  test("while no probe has answered, says it is checking", async () => {
    api["loadFirstCheck"]!.mockResolvedValue({ locationCount: 2, answers: [] });

    await renderSetup();
    typeAddress("acme.example");
    await startChecking();

    await waitFor(() => {
      expect(screen.getByTestId("guided-setup-first-check")).toHaveTextContent(
        "Checking acme.example from 2 locations...",
      );
    });
  });

  test("a monitor that could not be made says why, and the step stays open", async () => {
    api["createMonitor"]!.mockRejectedValue(
      new Error("You have reached the active monitor limit of your plan."),
    );

    await renderSetup();
    typeAddress("acme.example");
    await startChecking();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "You have reached the active monitor limit of your plan.",
    );
    expect(stepState("check")).toBe("open");
    expect(storedRun()).toEqual({});
  });

  test("Continue opens who is told, and the first step folds to what it found", async () => {
    await renderSetup();
    typeAddress("acme.example");
    await startChecking();
    await press("guided-setup-check-continue");

    expect(stepState("check")).toBe("done");
    expect(stepState("who_is_told")).toBe("open");
    expect(
      screen.getByTestId("guided-setup-step-check-done-line"),
    ).toHaveTextContent(
      "acme.example answered 200 in 312 ms from 2 locations.",
    );
    expect(sent(ProductEventName.GuidedSetupStepReached).pop()).toEqual({
      setup: "website_down",
      step: "who_is_told",
      step_number: 2,
    });
  });
});

const toWhoIsTold: () => Promise<void> = async (): Promise<void> => {
  keepRun({ monitorId: MONITOR_ID });
  await renderSetup();
  expect(stepState("who_is_told")).toBe("open");
};

describe("2. Who should be told?", () => {
  test("a project with no policy: it starts on you, and makes a policy paging who is picked", async () => {
    await toWhoIsTold();

    expect(screen.getByTestId("picked")).toHaveTextContent(
      JSON.stringify({ user: [USER_ID] }),
    );
    expect(
      screen.getByText(
        'This makes the on-call policy "Default on-call policy", which pages them for every new incident and alert in this project.',
      ),
    ).toBeInTheDocument();

    await press("guided-setup-who-continue");

    expect(api["createPolicy"]).toHaveBeenCalledWith({
      userIds: [USER_ID],
      teamIds: [],
    });
    expect(storedRun()).toEqual({ monitorId: MONITOR_ID, policyId: POLICY_ID });
    expect(stepState("who_is_told")).toBe("done");
    expect(stepState("test")).toBe("open");
    expect(
      screen.getByTestId("guided-setup-step-who_is_told-done-line"),
    ).toHaveTextContent('"Default on-call policy" pages Ada Lovelace.');
  });

  test("teammates and teams picked are paged too", async () => {
    await toWhoIsTold();
    await act(async () => {
      fireEvent.click(screen.getByText("Add Grace and Platform"));
    });
    await press("guided-setup-who-continue");

    expect(api["createPolicy"]).toHaveBeenCalledWith({
      userIds: [USER_ID, "user-grace"],
      teamIds: ["team-platform"],
    });
  });

  test("nobody picked is said so, and makes nothing", async () => {
    await toWhoIsTold();
    await act(async () => {
      fireEvent.click(screen.getByText("Remove everyone"));
    });
    await press("guided-setup-who-continue");

    expect(
      screen.getByText(WEBSITE_DOWN_COPY.whoNobodyPicked),
    ).toBeInTheDocument();
    expect(api["createPolicy"]).not.toHaveBeenCalled();
    expect(stepState("who_is_told")).toBe("open");
  });

  test("a project that pages people already: nothing is made, and it says who decides", async () => {
    api["loadWhoIsToldFacts"]!.mockResolvedValue({
      policyCount: 1,
      incidentRuleCount: 1,
      alertRuleCount: 1,
      mayCreatePolicy: true,
      mayAddEscalationRules: true,
      mayAddRules: true,
    });
    await toWhoIsTold();

    expect(screen.getByTestId("guided-setup-who-help")).toHaveTextContent(
      WEBSITE_DOWN_COPY.whoExistingHelp,
    );
    expect(screen.queryByTestId("guided-setup-people")).toBeNull();
    expect(
      screen.getByText(WEBSITE_DOWN_COPY.whoOnCallRulesLink).closest("a"),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/incidents/settings/on-call-rules`,
    );

    await press("guided-setup-who-continue");

    expect(api["createPolicy"]).not.toHaveBeenCalled();
    expect(storedRun()).toEqual({
      monitorId: MONITOR_ID,
      whoIsToldConfirmed: true,
    });
    expect(stepState("test")).toBe("open");
  });

  test("someone who may not create a policy finishes all the same, emailed as the monitor's owner, and is told so", async () => {
    api["loadWhoIsToldFacts"]!.mockResolvedValue({
      policyCount: 0,
      incidentRuleCount: 0,
      alertRuleCount: 0,
      mayCreatePolicy: false,
      mayAddEscalationRules: false,
      mayAddRules: false,
    });
    await toWhoIsTold();

    expect(screen.getByTestId("guided-setup-who-help")).toHaveTextContent(
      "You own this monitor, so you are emailed when it goes down. Paging a team needs an on-call policy: ask a project owner or admin to set one up.",
    );
    expect(screen.queryByTestId("guided-setup-people")).toBeNull();

    await press("guided-setup-who-continue");

    expect(api["createPolicy"]).not.toHaveBeenCalled();
    expect(stepState("test")).toBe("open");
    expect(
      screen.getByTestId("guided-setup-step-who_is_told-done-line"),
    ).toHaveTextContent("You are emailed as the monitor's owner.");
  });

  test("a policy that could not be made says why, and the step stays open", async () => {
    api["createPolicy"]!.mockRejectedValue(new Error("Permission denied."));
    await toWhoIsTold();
    await press("guided-setup-who-continue");

    expect(screen.getByRole("alert")).toHaveTextContent("Permission denied.");
    expect(stepState("who_is_told")).toBe("open");
    expect(storedRun()).toEqual({ monitorId: MONITOR_ID });
  });

  test("a server that cannot send email says so, with what works instead", async () => {
    canSendEmail = false;
    await toWhoIsTold();

    expect(screen.getByTestId("guided-setup-no-email")).toHaveTextContent(
      WEBSITE_DOWN_COPY.noEmail,
    );
    expect(screen.queryByTestId("guided-setup-set-up-email")).toBeNull();
    expect(
      screen.getByText(WEBSITE_DOWN_COPY.testMethodsLink).closest("a"),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/user-settings/notification-methods`,
    );
  });

  test("a master admin is offered the server's email setup", async () => {
    canSendEmail = false;
    jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(true);
    await toWhoIsTold();

    expect(screen.getByTestId("guided-setup-no-email")).toHaveTextContent(
      WEBSITE_DOWN_COPY.noEmailForAdmin,
    );
    expect(screen.getByTestId("guided-setup-set-up-email")).toHaveAttribute(
      "href",
      expect.stringMatching(/\/admin\/setup$/) as unknown as string,
    );
  });

  test("a server that can send email says nothing about it", async () => {
    await toWhoIsTold();

    expect(screen.queryByTestId("guided-setup-no-email")).toBeNull();
  });
});

const toTest: () => Promise<void> = async (): Promise<void> => {
  keepRun({ monitorId: MONITOR_ID, policyId: POLICY_ID });
  await renderSetup();
  expect(stepState("test")).toBe("open");
};

describe("3. Send a test", () => {
  test("sends a test page to the person, and keeps it in the run", async () => {
    await toTest();

    expect(screen.getByTestId("send-test-page")).toHaveAttribute(
      "data-target",
      "self",
    );

    await press("send-test-page");

    expect(storedRun()).toEqual({
      monitorId: MONITOR_ID,
      policyId: POLICY_ID,
      testExecutionLogId: "log-1",
    });
    expect(screen.getByTestId("test-page-result")).toHaveTextContent("log-1");
  });

  test("acknowledged: the step is done, and Continue opens the summary", async () => {
    await toTest();
    await press("send-test-page");
    await act(async () => {
      reportTestResult(result(OnCallTestPageStatus.Acknowledged));
    });

    // Done, and still open until Continue: the person reads the result first.
    expect(screen.getByTestId("guided-setup-progress")).toHaveTextContent(
      "3 of 3 steps done",
    );
    expect(screen.queryByTestId("guided-setup-skip-test")).toBeNull();

    await press("guided-setup-test-continue");

    expect(stepState("test")).toBe("done");

    expect(screen.getByTestId("guided-setup-summary")).toBeInTheDocument();
    expect(sent(ProductEventName.GuidedSetupFinished)).toHaveLength(1);
    expect(sent(ProductEventName.GuidedSetupFinished)[0]).toMatchObject({
      setup: "website_down",
    });
  });

  test("not yet acknowledged: another test, and what to check when it did not arrive", async () => {
    await toTest();
    await press("send-test-page");
    await act(async () => {
      reportTestResult(result(OnCallTestPageStatus.Paging));
    });

    expect(stepState("test")).toBe("open");
    expect(screen.getByTestId("send-test-page")).toHaveTextContent(
      WEBSITE_DOWN_COPY.testSendAnother,
    );
    expect(screen.queryByTestId("guided-setup-not-received")).toBeNull();

    await press("guided-setup-did-not-get-it");

    expect(screen.getByTestId("guided-setup-not-received")).toHaveTextContent(
      WEBSITE_DOWN_COPY.testDidNotGetItHelp,
    );
    expect(sent(ProductEventName.GuidedSetupFinished)).toEqual([]);
  });

  test("skipping it shows the summary, says it is not tested, and is not a finish", async () => {
    await toTest();
    await press("guided-setup-skip-test");

    expect(storedRun()).toMatchObject({ testSkipped: true });
    await waitFor(() => {
      expect(
        screen.getByTestId("guided-setup-summary-tested"),
      ).toHaveTextContent(WEBSITE_DOWN_COPY.summaryNotTested);
    });
    expect(sent(ProductEventName.GuidedSetupFinished)).toEqual([]);
    expect(sent(ProductEventName.GuidedSetupStepReached).pop()).toMatchObject({
      step: "summary",
    });
  });
});

describe("the summary", () => {
  test("every claim is read from the records", async () => {
    keepRun({
      monitorId: MONITOR_ID,
      policyId: POLICY_ID,
      testExecutionLogId: "log-1",
    });
    await renderSetup();

    await waitFor(() => {
      expect(
        screen.getByTestId("guided-setup-summary-checked"),
      ).toHaveTextContent("Every 5 minutes, from 2 locations.");
    });
    expect(screen.getByTestId("guided-setup-summary")).toHaveTextContent(
      "acme.example is set up",
    );
    expect(
      screen.getByTestId("guided-setup-summary-when_down"),
    ).toHaveTextContent(
      "If it does not answer, or answers with an error, OneUptime opens an incident (Critical).",
    );
    expect(
      screen.getByTestId("guided-setup-summary-who_is_told"),
    ).toHaveTextContent(
      'The on-call policy "Default on-call policy" pages Ada Lovelace for every new incident and alert. You own this monitor, so you are emailed when its status changes.',
    );
    expect(screen.getByTestId("guided-setup-summary-tested")).toHaveTextContent(
      "Ada Lovelace",
    );
    // Read, not written by hand: the severity of the monitor's own criteria.
    expect(api["loadIncidentSeverityName"]).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000003",
    );
    expect(api["isMonitorOwner"]).toHaveBeenCalledWith({
      monitorId: MONITOR_ID,
      userId: USER_ID,
    });
  });

  test("offers what to do next", async () => {
    keepRun({
      monitorId: MONITOR_ID,
      policyId: POLICY_ID,
      testExecutionLogId: "log-1",
    });
    await renderSetup();

    expect(
      screen.getByText(WEBSITE_DOWN_COPY.nextStatusPage).closest("a"),
    ).toHaveAttribute("href", `/dashboard/${PROJECT_ID}/status-pages/setup`);
    expect(
      screen.getByText(WEBSITE_DOWN_COPY.nextMonitor).closest("a"),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/monitors/${MONITOR_ID}`,
    );
  });

  test("Check another address starts a new run, the last one's records kept", async () => {
    keepRun({
      monitorId: MONITOR_ID,
      policyId: POLICY_ID,
      testExecutionLogId: "log-1",
    });
    await renderSetup();
    await press("guided-setup-start-over");

    expect(stepState("check")).toBe("open");
    expect(window.localStorage.getItem(RUN_KEY)).toBeNull();
    expect(screen.getByTestId("guided-setup-address")).toHaveValue("");
    // Who is told is asked afresh: the project has a policy now.
    expect(api["loadWhoIsToldFacts"]).toHaveBeenCalledTimes(2);
  });
});

describe("leaving and coming back", () => {
  test("after the first step: resumes at who is told, without a second monitor", async () => {
    await toWhoIsTold();

    expect(api["loadMonitor"]).toHaveBeenCalledWith(MONITOR_ID);
    expect(api["createMonitor"]).not.toHaveBeenCalled();
    expect(stepState("check")).toBe("done");
  });

  test("after who is told: resumes at the test, without a second policy", async () => {
    await toTest();

    expect(api["loadPolicy"]).toHaveBeenCalledWith(POLICY_ID);
    expect(api["createPolicy"]).not.toHaveBeenCalled();
    expect(screen.getByTestId("guided-setup-progress")).toHaveTextContent(
      "2 of 3 steps done",
    );
  });

  test("after a confirmed step with no policy of its own: resumes at the test", async () => {
    api["loadWhoIsToldFacts"]!.mockResolvedValue({
      policyCount: 1,
      incidentRuleCount: 1,
      alertRuleCount: 1,
      mayCreatePolicy: true,
      mayAddEscalationRules: true,
      mayAddRules: true,
    });
    keepRun({ monitorId: MONITOR_ID, whoIsToldConfirmed: true });
    await renderSetup();

    expect(stepState("test")).toBe("open");
  });

  test("with a test page sent but not acknowledged: back on the test, its result read again", async () => {
    getResultMock.mockResolvedValue(result(OnCallTestPageStatus.Paging));
    keepRun({
      monitorId: MONITOR_ID,
      policyId: POLICY_ID,
      testExecutionLogId: "log-1",
    });
    await renderSetup();

    expect(getResultMock).toHaveBeenCalledWith("log-1");
    expect(stepState("test")).toBe("open");
    expect(screen.getByTestId("test-page-result")).toBeInTheDocument();
  });

  test("after it was acknowledged: the summary", async () => {
    keepRun({
      monitorId: MONITOR_ID,
      policyId: POLICY_ID,
      testExecutionLogId: "log-1",
    });
    await renderSetup();

    expect(screen.getByTestId("guided-setup-summary")).toBeInTheDocument();
    expect(screen.getByTestId("guided-setup-progress")).toHaveTextContent(
      "3 of 3 steps done",
    );
  });

  test("a monitor deleted since: the run starts again", async () => {
    api["loadMonitor"]!.mockResolvedValue(null);
    keepRun({ monitorId: MONITOR_ID, policyId: POLICY_ID });
    await renderSetup();

    expect(stepState("check")).toBe("open");
    expect(window.localStorage.getItem(RUN_KEY)).toBeNull();
    expect(api["loadPolicy"]).not.toHaveBeenCalled();
  });

  test("a policy deleted since: back on who is told", async () => {
    api["loadPolicy"]!.mockResolvedValue(null);
    keepRun({ monitorId: MONITOR_ID, policyId: POLICY_ID });
    await renderSetup();

    expect(stepState("who_is_told")).toBe("open");
    expect(storedRun()).toEqual({ monitorId: MONITOR_ID });
  });

  test("a policy made but not kept in this browser is not made twice", async () => {
    // The policy exists; the browser lost the run's note of it.
    api["loadWhoIsToldFacts"]!.mockResolvedValue({
      policyCount: 1,
      incidentRuleCount: 1,
      alertRuleCount: 1,
      mayCreatePolicy: true,
      mayAddEscalationRules: true,
      mayAddRules: true,
    });
    await toWhoIsTold();
    await press("guided-setup-who-continue");

    expect(api["createPolicy"]).not.toHaveBeenCalled();
  });

  test("a done step opens again to look at it, without making anything", async () => {
    await toTest();
    await act(async () => {
      fireEvent.click(
        screen
          .getByTestId("guided-setup-step-check")
          .querySelector("button") as HTMLButtonElement,
      );
    });

    expect(stepState("check")).toBe("open");
    expect(screen.queryByTestId("guided-setup-address")).toBeNull();

    await press("guided-setup-check-continue");

    expect(stepState("test")).toBe("open");
    expect(api["createMonitor"]).not.toHaveBeenCalled();
  });

  test("leaving before the end sends left, at the step it was on", async () => {
    const { unmount } = await (async (): Promise<{ unmount: () => void }> => {
      keepRun({ monitorId: MONITOR_ID });
      return renderSetup();
    })();

    act(() => {
      unmount();
    });

    expect(sent(ProductEventName.GuidedSetupLeft)).toEqual([
      { setup: "website_down", step: "who_is_told", step_number: 1 },
    ]);
  });
});

describe("permissions", () => {
  test("someone who may not create a monitor is told so, and sent to Monitors", async () => {
    mayCreateMonitor = false;
    await act(async () => {
      render(<WebsiteDownGuidedSetup />);
    });

    await waitFor(() => {
      expect(screen.getByTestId("guided-setup-not-allowed")).toHaveTextContent(
        WEBSITE_DOWN_COPY.cannotCreateMonitor,
      );
    });
    expect(screen.getByText("Go to Monitors").closest("a")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/monitors`,
    );
    expect(api["createMonitor"]).not.toHaveBeenCalled();
  });

  test("but finishes a run already started, whose monitor exists", async () => {
    mayCreateMonitor = false;
    await toWhoIsTold();

    expect(screen.queryByTestId("guided-setup-not-allowed")).toBeNull();
  });
});

/*
 * A RUN THE BROWSER LOST (#7059): a private window that keeps nothing,
 * another device, storage cleared. What exists on the server decides: a fake
 * server here keeps the monitors this person made, read through the same
 * rule the real look-up uses, and the setup looks there before it makes one.
 */
const PROJECT_PAGES_PEOPLE: Record<string, unknown> = {
  policyCount: 1,
  incidentRuleCount: 1,
  alertRuleCount: 1,
  mayCreatePolicy: true,
  mayAddEscalationRules: true,
  mayAddRules: true,
};

const EXISTING_NOTE: string =
  'Your monitor "acme.example" already checks this address, so no new monitor was made.';

interface StorageReplacements {
  browser: string;
  getItem: () => string | null;
  setItem: () => void;
  removeItem: () => void;
}

/*
 * Storage's prototype seen without its string index signature, which makes
 * @jest/globals type spyOn(Storage.prototype, ...) as never.
 */
const storagePrototype: Pick<Storage, "getItem" | "setItem" | "removeItem"> =
  Storage.prototype;

const storageOff: () => never = (): never => {
  throw new Error("storage is off");
};

describe("a run the browser lost (#7059)", () => {
  // This person's monitors as the server keeps them, the oldest first.
  let serverMonitors: Array<WebsiteDownMonitorRecord> = [];

  const madeOnServer: (address: WebsiteAddress) => WebsiteDownMonitorRecord = (
    address: WebsiteAddress,
  ): WebsiteDownMonitorRecord => {
    const record: WebsiteDownMonitorRecord = {
      id: `50000000-0000-4000-8000-${String(serverMonitors.length + 1).padStart(12, "0")}`,
      name: address.monitorName,
      monitorSteps: buildWebsiteMonitor({
        address: address,
        isApi: false,
        seeds: SEEDS,
      }).monitorSteps,
      monitoringInterval: "*/5 * * * *",
    };
    serverMonitors.push(record);
    return record;
  };

  beforeEach(() => {
    serverMonitors = [];

    api["createMonitor"]!.mockImplementation(
      async (data: { address: WebsiteAddress }): Promise<string> => {
        return madeOnServer(data.address).id;
      },
    );
    api["loadMonitor"]!.mockImplementation(
      async (id: string): Promise<WebsiteDownMonitorRecord | null> => {
        return (
          serverMonitors.find((record: WebsiteDownMonitorRecord): boolean => {
            return record.id === id;
          }) || null
        );
      },
    );
    api["findOwnMonitor"]!.mockImplementation(
      async (data: {
        address: WebsiteAddress;
        userId: string;
      }): Promise<WebsiteDownMonitorRecord | null> => {
        if (data.userId !== USER_ID) {
          return null;
        }

        return (
          [...serverMonitors]
            .reverse()
            .find((record: WebsiteDownMonitorRecord): boolean => {
              return isMonitorCheckingAddress({
                monitor: record,
                address: data.address,
              });
            }) || null
        );
      },
    );
  });

  const checkAddress: (text: string) => Promise<void> = async (
    text: string,
  ): Promise<void> => {
    typeAddress(text);
    await startChecking();
    await waitFor(() => {
      expect(screen.getByTestId("guided-setup-first-check")).toHaveTextContent(
        "acme.example answered 200 in 312 ms from 2 locations.",
      );
    });
  };

  test("an address this person's monitor already checks: the setup goes on with it, says so, and makes none", async () => {
    // Made from Create Monitor, or by a run this browser lost.
    const theirs: WebsiteDownMonitorRecord = madeOnServer({
      url: "https://acme.example",
      host: "acme.example",
      monitorName: "acme.example",
    });

    await renderSetup();
    // Typed another way, the same address.
    await checkAddress("ACME.example/");

    expect(api["createMonitor"]).not.toHaveBeenCalled();
    expect(serverMonitors).toHaveLength(1);
    expect(
      screen.getByTestId("guided-setup-existing-monitor"),
    ).toHaveTextContent(EXISTING_NOTE);
    expect(storedRun()).toEqual({ monitorId: theirs.id });
    expect(api["loadFirstCheck"]).toHaveBeenCalledWith(theirs.id);

    await press("guided-setup-check-continue");

    expect(stepState("check")).toBe("done");
    expect(stepState("who_is_told")).toBe("open");
  });

  test("the note comes first, then what the check found, and both wrap a long name inside the step", async () => {
    // One long word, as a monitor named after a long path is.
    const longAddress: WebsiteAddress = {
      url: "https://acme.example/api/v1/health/checks/storefront-checkout-and-payments-readiness-probe",
      host: "acme.example",
      monitorName:
        "acme.example/api/v1/health/checks/storefront-checkout-and-payments-readiness-probe",
    };
    madeOnServer(longAddress);

    await renderSetup();
    await checkAddress(`${longAddress.url}/`);

    const note: HTMLElement = screen.getByTestId(
      "guided-setup-existing-monitor",
    );
    const check: HTMLElement = screen.getByTestId("guided-setup-first-check");

    expect(note).toHaveTextContent(
      `Your monitor "${longAddress.monitorName}" already checks this address, so no new monitor was made.`,
    );
    // Why nothing new appeared, then what the monitor found.
    expect(
      note.compareDocumentPosition(check) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(note.parentElement).toBe(check.parentElement);
    // A word longer than the step is broken, not drawn past its edge.
    expect(note).toHaveClass("break-words");
    expect(check).toHaveClass("break-words");
    expect(api["createMonitor"]).not.toHaveBeenCalled();
  });

  test("storage cleared, then the page opened again: the same address makes no second monitor", async () => {
    const first: { unmount: () => void } = await renderSetup();
    await checkAddress("acme.example");

    expect(api["createMonitor"]).toHaveBeenCalledTimes(1);
    const made: string = serverMonitors[0]!.id;
    expect(storedRun()).toEqual({ monitorId: made });

    // The browser forgets the run; the monitor stays on the server.
    window.localStorage.clear();
    act(() => {
      first.unmount();
    });
    await renderSetup();

    expect(stepState("check")).toBe("open");

    await checkAddress("https://acme.example");

    expect(api["createMonitor"]).toHaveBeenCalledTimes(1);
    expect(serverMonitors).toHaveLength(1);
    expect(storedRun()).toEqual({ monitorId: made });
    expect(
      screen.getByTestId("guided-setup-existing-monitor"),
    ).toHaveTextContent(EXISTING_NOTE);
  });

  /*
   * Storage switched off throws on every call; a browser that takes a value
   * and reads nothing back answers null. Either way the page keeps the run:
   * before, sending the test page dropped the who-is-told step's
   * confirmation, so that step was drawn not done again and the setup never
   * finished.
   */
  const browsers: Array<StorageReplacements> = [
    {
      browser: "storage switched off",
      getItem: storageOff,
      setItem: storageOff,
      removeItem: storageOff,
    },
    {
      browser: "a browser that reads nothing back",
      getItem: (): null => {
        return null;
      },
      setItem: (): void => {
        // Accepted, and gone.
      },
      removeItem: (): void => {
        // Nothing to remove.
      },
    },
  ];

  test.each(browsers)(
    "$browser: every step is walked to the finish, and a reload there makes no second monitor",
    async (browser: StorageReplacements) => {
      api["loadWhoIsToldFacts"]!.mockResolvedValue(PROJECT_PAGES_PEOPLE);
      jest
        .spyOn(storagePrototype, "getItem")
        .mockImplementation(browser.getItem);
      jest
        .spyOn(storagePrototype, "setItem")
        .mockImplementation(browser.setItem);
      jest
        .spyOn(storagePrototype, "removeItem")
        .mockImplementation(browser.removeItem);

      const first: { unmount: () => void } = await renderSetup();
      await checkAddress("acme.example");
      await press("guided-setup-check-continue");
      await press("guided-setup-who-continue");

      expect(stepState("test")).toBe("open");

      await press("send-test-page");

      // Every step's save is kept, the ones before included.
      expect(stepState("check")).toBe("done");
      expect(stepState("who_is_told")).toBe("done");
      expect(screen.getByTestId("guided-setup-progress")).toHaveTextContent(
        "2 of 3 steps done",
      );

      await act(async () => {
        reportTestResult(result(OnCallTestPageStatus.Acknowledged));
      });
      await press("guided-setup-test-continue");

      expect(screen.getByTestId("guided-setup-summary")).toBeInTheDocument();
      expect(sent(ProductEventName.GuidedSetupFinished)).toHaveLength(1);

      // The page opened again: this browser kept nothing of the run.
      act(() => {
        first.unmount();
      });
      await renderSetup();

      expect(stepState("check")).toBe("open");

      await checkAddress("acme.example");

      expect(api["createMonitor"]).toHaveBeenCalledTimes(1);
      expect(serverMonitors).toHaveLength(1);
      expect(
        screen.getByTestId("guided-setup-existing-monitor"),
      ).toHaveTextContent(EXISTING_NOTE);
    },
  );

  test("the look-up fails: nothing is made on a guess, it says why, and the step stays open", async () => {
    api["findOwnMonitor"]!.mockRejectedValue(
      new Error("The server could not be reached."),
    );

    await renderSetup();
    typeAddress("acme.example");
    await startChecking();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The server could not be reached.",
    );
    expect(api["createMonitor"]).not.toHaveBeenCalled();
    expect(stepState("check")).toBe("open");
    expect(storedRun()).toEqual({});
    expect(screen.queryByTestId("guided-setup-existing-monitor")).toBeNull();
  });

  test("an address none of this person's monitors checks makes a new one, and says nothing of one", async () => {
    madeOnServer({
      url: "https://status.acme.example",
      host: "status.acme.example",
      monitorName: "status.acme.example",
    });

    await renderSetup();
    await checkAddress("acme.example");

    expect(api["createMonitor"]).toHaveBeenCalledTimes(1);
    expect(serverMonitors).toHaveLength(2);
    expect(storedRun()).toEqual({ monitorId: serverMonitors[1]!.id });
    expect(screen.queryByTestId("guided-setup-existing-monitor")).toBeNull();
  });

  test("Check another address with the same address goes on with the monitor already made", async () => {
    api["loadWhoIsToldFacts"]!.mockResolvedValue(PROJECT_PAGES_PEOPLE);

    await renderSetup();
    await checkAddress("acme.example");
    expect(screen.queryByTestId("guided-setup-existing-monitor")).toBeNull();
    await press("guided-setup-check-continue");
    await press("guided-setup-who-continue");
    await press("guided-setup-skip-test");
    await press("guided-setup-start-over");

    expect(stepState("check")).toBe("open");

    await checkAddress("acme.example");

    expect(api["createMonitor"]).toHaveBeenCalledTimes(1);
    expect(storedRun()).toEqual({ monitorId: serverMonitors[0]!.id });
    expect(
      screen.getByTestId("guided-setup-existing-monitor"),
    ).toHaveTextContent(EXISTING_NOTE);
  });

  test("the note belongs to that address: after starting over, a new address's monitor says nothing of it", async () => {
    api["loadWhoIsToldFacts"]!.mockResolvedValue(PROJECT_PAGES_PEOPLE);
    madeOnServer({
      url: "https://acme.example",
      host: "acme.example",
      monitorName: "acme.example",
    });

    await renderSetup();
    await checkAddress("acme.example");
    expect(
      screen.getByTestId("guided-setup-existing-monitor"),
    ).toBeInTheDocument();
    await press("guided-setup-check-continue");
    await press("guided-setup-who-continue");
    await press("guided-setup-skip-test");
    await press("guided-setup-start-over");

    typeAddress("status.acme.example");
    await startChecking();

    expect(api["createMonitor"]).toHaveBeenCalledTimes(1);
    expect(serverMonitors).toHaveLength(2);
    expect(screen.queryByTestId("guided-setup-existing-monitor")).toBeNull();
  });
});

describe("a policy made meanwhile, in another tab or on another device (#7059)", () => {
  test("the project's facts are asked again just before the policy is made", async () => {
    await toWhoIsTold();
    await press("guided-setup-who-continue");

    expect(api["loadWhoIsToldFacts"]).toHaveBeenCalledTimes(2);
    expect(api["createPolicy"]).toHaveBeenCalledTimes(1);
    expect(
      api["loadWhoIsToldFacts"]!.mock.invocationCallOrder[1]!,
    ).toBeLessThan(api["createPolicy"]!.mock.invocationCallOrder[0]!);
  });

  test("a policy made since the page opened: none is made, the project's policies decide, and Continue goes on", async () => {
    await toWhoIsTold();
    expect(screen.getByTestId("guided-setup-people")).toBeInTheDocument();

    // Another tab of this person finished the step meanwhile.
    api["loadWhoIsToldFacts"]!.mockResolvedValue(PROJECT_PAGES_PEOPLE);
    await press("guided-setup-who-continue");

    expect(api["createPolicy"]).not.toHaveBeenCalled();
    expect(stepState("who_is_told")).toBe("open");
    expect(screen.queryByTestId("guided-setup-people")).toBeNull();
    expect(screen.getByTestId("guided-setup-who-help")).toHaveTextContent(
      WEBSITE_DOWN_COPY.whoExistingHelp,
    );
    // Why the people picked are gone, said first.
    const note: HTMLElement = screen.getByTestId(
      "guided-setup-policy-made-elsewhere",
    );
    expect(note).toHaveTextContent(
      "An on-call policy was added to this project while this page was open, so no new policy was made.",
    );
    expect(
      note.compareDocumentPosition(
        screen.getByTestId("guided-setup-who-help"),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(storedRun()).toEqual({ monitorId: MONITOR_ID });

    await press("guided-setup-who-continue");

    expect(api["createPolicy"]).not.toHaveBeenCalled();
    expect(storedRun()).toEqual({
      monitorId: MONITOR_ID,
      whoIsToldConfirmed: true,
    });
    expect(stepState("who_is_told")).toBe("done");
    expect(stepState("test")).toBe("open");
    expect(
      screen.getByTestId("guided-setup-step-who_is_told-done-line"),
    ).toHaveTextContent(
      "This project's on-call policies and rules decide who is paged.",
    );
  });

  test("facts that cannot be read just before: nothing is made, it says why, and the step stays open", async () => {
    await toWhoIsTold();
    api["loadWhoIsToldFacts"]!.mockRejectedValueOnce(
      new Error("The server could not be reached."),
    );
    await press("guided-setup-who-continue");

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The server could not be reached.",
    );
    expect(api["createPolicy"]).not.toHaveBeenCalled();
    expect(stepState("who_is_told")).toBe("open");
    expect(storedRun()).toEqual({ monitorId: MONITOR_ID });
  });

  /*
   * What WebsiteDownApi.loadWhoIsToldFacts answers when a count fails: it
   * never throws, it gives counts it could not read as null.
   */
  const COUNTS_NOT_READ: Record<string, unknown> = {
    policyCount: null,
    incidentRuleCount: null,
    alertRuleCount: null,
    mayCreatePolicy: true,
    mayAddEscalationRules: true,
    mayAddRules: true,
  };

  test("counts the server could not give just before: no policy is made on a guess, the step says to try again, and trying again makes one", async () => {
    await toWhoIsTold();
    api["loadWhoIsToldFacts"]!.mockResolvedValueOnce(COUNTS_NOT_READ);
    await press("guided-setup-who-continue");

    expect(api["createPolicy"]).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "That did not save. Check your connection and try again.",
    );
    expect(stepState("who_is_told")).toBe("open");
    // The people picked stay, to save again; nothing claims a policy appeared.
    expect(screen.getByTestId("guided-setup-people")).toBeInTheDocument();
    expect(
      screen.queryByTestId("guided-setup-policy-made-elsewhere"),
    ).toBeNull();
    expect(screen.getByTestId("guided-setup-who-continue")).toHaveTextContent(
      WEBSITE_DOWN_COPY.whoSave,
    );
    expect(storedRun()).toEqual({ monitorId: MONITOR_ID });

    // The counts read again: the policy is made, once.
    await press("guided-setup-who-continue");

    expect(api["createPolicy"]).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(storedRun()).toEqual({ monitorId: MONITOR_ID, policyId: POLICY_ID });
    expect(stepState("who_is_told")).toBe("done");
  });

  test("permission to page taken away meanwhile: nothing is made, and the step says the person is emailed as the owner", async () => {
    await toWhoIsTold();
    api["loadWhoIsToldFacts"]!.mockResolvedValue({
      policyCount: 0,
      incidentRuleCount: 0,
      alertRuleCount: 0,
      mayCreatePolicy: false,
      mayAddEscalationRules: false,
      mayAddRules: false,
    });
    await press("guided-setup-who-continue");

    expect(api["createPolicy"]).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId("guided-setup-who-help")).toHaveTextContent(
      WEBSITE_DOWN_COPY.whoOwnerOnlyHelp,
    );
    // No policy appeared, so none is said to have.
    expect(
      screen.queryByTestId("guided-setup-policy-made-elsewhere"),
    ).toBeNull();
    expect(stepState("who_is_told")).toBe("open");
  });

  test("a project that paged people when the page opened says nothing of a policy made meanwhile", async () => {
    api["loadWhoIsToldFacts"]!.mockResolvedValue(PROJECT_PAGES_PEOPLE);
    await toWhoIsTold();

    expect(screen.getByTestId("guided-setup-who-help")).toHaveTextContent(
      WEBSITE_DOWN_COPY.whoExistingHelp,
    );
    expect(
      screen.queryByTestId("guided-setup-policy-made-elsewhere"),
    ).toBeNull();

    await press("guided-setup-who-continue");

    expect(stepState("test")).toBe("open");
    expect(
      screen.queryByTestId("guided-setup-policy-made-elsewhere"),
    ).toBeNull();
  });

  test("the note stays with the step for this page, and Check another address starts without it", async () => {
    await toWhoIsTold();
    api["loadWhoIsToldFacts"]!.mockResolvedValue(PROJECT_PAGES_PEOPLE);
    await press("guided-setup-who-continue");
    expect(
      screen.getByTestId("guided-setup-policy-made-elsewhere"),
    ).toBeInTheDocument();

    // Done, then opened again to look: still why nothing was made.
    await press("guided-setup-who-continue");
    expect(stepState("who_is_told")).toBe("done");
    await act(async () => {
      fireEvent.click(screen.getByText(WEBSITE_DOWN_COPY.whoTitle));
    });
    expect(stepState("who_is_told")).toBe("open");
    expect(
      screen.getByTestId("guided-setup-policy-made-elsewhere"),
    ).toBeInTheDocument();

    // To the summary, then a new run for another address.
    await press("guided-setup-who-continue");
    await press("guided-setup-skip-test");
    await press("guided-setup-start-over");

    typeAddress("status.acme.example");
    await startChecking();
    await waitFor(() => {
      expect(stepState("check")).toBe("open");
      expect(
        screen.getByTestId("guided-setup-first-check"),
      ).toBeInTheDocument();
    });
    await press("guided-setup-check-continue");

    expect(stepState("who_is_told")).toBe("open");
    expect(screen.getByTestId("guided-setup-who-help")).toHaveTextContent(
      WEBSITE_DOWN_COPY.whoExistingHelp,
    );
    expect(
      screen.queryByTestId("guided-setup-policy-made-elsewhere"),
    ).toBeNull();
  });
});
