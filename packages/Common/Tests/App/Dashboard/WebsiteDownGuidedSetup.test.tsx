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
import {
  WEBSITE_DOWN_COPY,
  buildWebsiteMonitor,
  WebsiteAddress,
} from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/WebsiteDown/WebsiteDownSetup";
import { ProductEventName } from "../../../Types/Analytics/ProductEvent";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import ObjectID from "../../../Types/ObjectID";
import {
  OnCallTestPageRecordKind,
  OnCallTestPageResult,
  OnCallTestPageStatus,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
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

const monitorSteps: MonitorSteps = buildWebsiteMonitor({
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
      "You own this monitor, so you are emailed when it goes down. Paging a team needs a project admin: ask one to set up an on-call policy.",
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
