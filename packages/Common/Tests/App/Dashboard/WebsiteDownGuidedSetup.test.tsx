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
  ensureMonitorOwner: getJestMockFunction(),
  needsPaymentMethod: getJestMockFunction(),
};
let mayCreateMonitor: boolean = true;
let mayAddPaymentMethod: boolean = true;

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
      "ensureMonitorOwner",
      "needsPaymentMethod",
    ]) {
      calls[name] = (...args: Array<unknown>): unknown => {
        return api[name]!(...args);
      };
    }

    // What a refusal for want of a payment method is, as the page reads it.
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/WebsiteDown/WebsiteDownApi",
    ) as Record<string, unknown>;

    return {
      __esModule: true,
      default: calls,
      mayCreateMonitor: (): boolean => {
        return mayCreateMonitor;
      },
      mayAddPaymentMethod: (): boolean => {
        return mayAddPaymentMethod;
      },
      isPaymentRequired: actual["isPaymentRequired"],
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
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import ObjectID from "../../../Types/ObjectID";
import {
  OnCallTestPageRecordKind,
  OnCallTestPageResult,
  OnCallTestPageStatus,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import { getLearnMoreUrl } from "../../../UI/Components/Link/LearnMoreLink";
import AlertOnCallRule from "../../../Models/DatabaseModels/AlertOnCallRule";
import IncidentOnCallRule from "../../../Models/DatabaseModels/IncidentOnCallRule";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
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
  mayAddPaymentMethod = true;
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
  api["createPolicy"]!.mockResolvedValue(POLICY_ID);
  api["loadPolicy"]!.mockResolvedValue({
    id: POLICY_ID,
    name: "Default on-call policy",
    responders: ["Ada Lovelace"],
  });
  api["loadIncidentSeverityName"]!.mockResolvedValue("Critical");
  api["isMonitorOwner"]!.mockResolvedValue(true);
  api["ensureMonitorOwner"]!.mockResolvedValue(true);
  // Not Cloud's Free plan without a card, as most projects are not.
  api["needsPaymentMethod"]!.mockResolvedValue(false);
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
      activeLocationCount: 2,
      answers: [],
    }).mockResolvedValue({
      locationCount: 2,
      activeLocationCount: 2,
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
    // It stops asking once every location has answered.
    const asked: number = api["loadFirstCheck"]!.mock.calls.length;
    await act(async () => {
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 40);
      });
    });
    expect(api["loadFirstCheck"]!.mock.calls.length).toBe(asked);
  });

  test("while no probe has answered, says it is checking", async () => {
    api["loadFirstCheck"]!.mockResolvedValue({
      locationCount: 2,
      activeLocationCount: 2,
      answers: [],
    });

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
      // The reader's translator: the policy and its rules are named in their language (#7995).
      translator: expect.anything(),
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
      translator: expect.anything(),
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

/*
 * THE FIRST CHECK, AS THE SERVER JUDGES IT (#7410): nothing said about
 * locations before the first read returns, and "an incident opens" only
 * when the answers carry the monitor's probe agreement.
 */
describe("the first check, read as the server judges it (#7410)", () => {
  test("before the first read returns: checking, never no location", async () => {
    let answer: (state: unknown) => void = () => {};
    api["loadFirstCheck"]!.mockImplementation(() => {
      return new Promise((resolve: (state: unknown) => void) => {
        answer = resolve;
      });
    });

    await renderSetup();
    typeAddress("acme.example");
    await startChecking();

    expect(screen.getByTestId("guided-setup-first-check")).toHaveTextContent(
      "Checking acme.example...",
    );
    expect(
      screen.getByTestId("guided-setup-first-check").textContent,
    ).not.toContain("No location");
    expect(screen.queryByTestId("guided-setup-first-check-verdict")).toBeNull();

    await act(async () => {
      answer({ locationCount: 2, activeLocationCount: 2, answers: [] });
    });

    expect(screen.getByTestId("guided-setup-first-check")).toHaveTextContent(
      "Checking acme.example from 2 locations...",
    );
  });

  test("a monitor with no location, once read, says so", async () => {
    api["loadFirstCheck"]!.mockResolvedValue({
      locationCount: 0,
      activeLocationCount: 0,
      answers: [],
    });

    await renderSetup();
    typeAddress("acme.example");
    await startChecking();

    await waitFor(() => {
      expect(screen.getByTestId("guided-setup-first-check")).toHaveTextContent(
        "No location checks acme.example yet.",
      );
    });
  });

  test("one location of three fails, the others answer: says so, and that no incident opens", async () => {
    api["loadFirstCheck"]!.mockResolvedValue({
      locationCount: 3,
      activeLocationCount: 3,
      answers: [
        { isOnline: true, responseCode: 200, responseTimeInMs: 312 },
        { isOnline: true, responseCode: 503, responseTimeInMs: 40 },
        { isOnline: true, responseCode: 200, responseTimeInMs: 312 },
      ],
    });

    await renderSetup();
    typeAddress("acme.example");
    await startChecking();

    await waitFor(() => {
      expect(
        screen.getByTestId("guided-setup-first-check-verdict"),
      ).toHaveTextContent(
        "acme.example was up from 2 locations, so no incident opens.",
      );
    });
    expect(screen.getByTestId("guided-setup-first-check")).toHaveTextContent(
      "acme.example answered 503 from 1 location.",
    );
    expect(screen.getByTestId("guided-setup")).not.toHaveTextContent(
      "so an incident opens",
    );
  });

  test("every location fails: an incident opens, said on a line of its own", async () => {
    api["loadFirstCheck"]!.mockResolvedValue({
      locationCount: 2,
      activeLocationCount: 2,
      answers: [
        { isOnline: false, failureCause: "Connection refused" },
        { isOnline: false, failureCause: "Connection refused" },
      ],
    });

    await renderSetup();
    typeAddress("acme.example");
    await startChecking();

    await waitFor(() => {
      expect(
        screen.getByTestId("guided-setup-first-check-verdict"),
      ).toHaveTextContent("That counts as down, so an incident opens.");
    });
    expect(screen.getByTestId("guided-setup-first-check")).toHaveTextContent(
      "acme.example did not answer from 2 locations: Connection refused",
    );

    // The step's done line is what was found, the probe's reason last.
    await press("guided-setup-check-continue");
    expect(
      screen.getByTestId("guided-setup-step-check-done-line"),
    ).toHaveTextContent(
      "acme.example did not answer from 2 locations: Connection refused",
    );
  });

  test("a minimum the monitor sets is the one the words follow", async () => {
    api["loadMonitor"]!.mockResolvedValue({
      ...MONITOR,
      minimumProbeAgreement: 2,
    });
    api["loadFirstCheck"]!.mockResolvedValue({
      locationCount: 3,
      activeLocationCount: 3,
      answers: [
        { isOnline: false },
        { isOnline: false },
        { isOnline: true, responseCode: 200, responseTimeInMs: 30 },
      ],
    });

    await renderSetup();
    typeAddress("acme.example");
    await startChecking();

    await waitFor(() => {
      expect(
        screen.getByTestId("guided-setup-first-check-verdict"),
      ).toHaveTextContent("That counts as down, so an incident opens.");
    });
  });

  test("asks again until every location has answered, then stops", async () => {
    api["loadFirstCheck"]!.mockResolvedValueOnce({
      locationCount: 2,
      activeLocationCount: 2,
      answers: [{ isOnline: false, failureCause: "Connection refused" }],
    }).mockResolvedValue({
      locationCount: 2,
      activeLocationCount: 2,
      answers: [
        { isOnline: false, failureCause: "Connection refused" },
        { isOnline: true, responseCode: 200, responseTimeInMs: 30 },
      ],
    });

    await renderSetup();
    typeAddress("acme.example");
    await startChecking();

    // One answer in, one to come: nothing claimed yet.
    expect(
      screen.getByTestId("guided-setup-first-check-verdict"),
    ).toHaveTextContent("Waiting for 1 more location...");

    await waitFor(() => {
      expect(
        screen.getByTestId("guided-setup-first-check-verdict"),
      ).toHaveTextContent(
        "acme.example was up from 1 location, so no incident opens.",
      );
    });

    const asked: number = api["loadFirstCheck"]!.mock.calls.length;
    expect(asked).toBeGreaterThanOrEqual(2);
    await act(async () => {
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 40);
      });
    });
    expect(api["loadFirstCheck"]!.mock.calls.length).toBe(asked);
  });

  test("the summary says how many locations must agree", async () => {
    api["loadFirstCheck"]!.mockResolvedValue({
      locationCount: 3,
      activeLocationCount: 3,
      answers: [
        { isOnline: true, responseCode: 200, responseTimeInMs: 30 },
        { isOnline: true, responseCode: 200, responseTimeInMs: 30 },
        { isOnline: true, responseCode: 200, responseTimeInMs: 30 },
      ],
    });
    keepRun({
      monitorId: MONITOR_ID,
      policyId: POLICY_ID,
      testExecutionLogId: "log-1",
    });
    await renderSetup();

    await waitFor(() => {
      expect(
        screen.getByTestId("guided-setup-summary-when_down"),
      ).toHaveTextContent(
        "If it does not answer, or answers with an error, OneUptime opens an incident (Critical). A status change needs all 3 connected probes to agree.",
      );
    });
  });
});

/*
 * WHO OWNS THE MONITOR (#7409): a self-hosted master admin is never made
 * the owner of what they create, and was told "You own this monitor, so you
 * are emailed when it goes down". The setup makes the person setting it up
 * the owner, and the step says so only when the records say they are.
 */
describe("the person setting it up owns the monitor (#7409)", () => {
  test("a new monitor: its owner is made sure of before the next step opens", async () => {
    jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(true);
    api["loadWhoIsToldFacts"]!.mockResolvedValue(PROJECT_PAGES_PEOPLE);

    await renderSetup();
    typeAddress("acme.example");
    await startChecking();

    expect(api["ensureMonitorOwner"]).toHaveBeenCalledTimes(1);
    expect(api["ensureMonitorOwner"]).toHaveBeenCalledWith({
      monitorId: MONITOR_ID,
      userId: USER_ID,
    });
    expect(api["createMonitor"]!.mock.invocationCallOrder[0]!).toBeLessThan(
      api["ensureMonitorOwner"]!.mock.invocationCallOrder[0]!,
    );

    await press("guided-setup-check-continue");

    expect(screen.getByTestId("guided-setup-who-help")).toHaveTextContent(
      WEBSITE_DOWN_COPY.whoExistingHelp,
    );
  });

  test("a monitor this person had already: made theirs too", async () => {
    api["findOwnMonitor"]!.mockResolvedValue(MONITOR);

    await renderSetup();
    typeAddress("acme.example");
    await startChecking();

    expect(api["createMonitor"]).not.toHaveBeenCalled();
    expect(api["ensureMonitorOwner"]).toHaveBeenCalledWith({
      monitorId: MONITOR_ID,
      userId: USER_ID,
    });
  });

  test("not made the owner: the step promises no email, and says how to get one", async () => {
    api["ensureMonitorOwner"]!.mockResolvedValue(false);
    api["loadWhoIsToldFacts"]!.mockResolvedValue({
      policyCount: 0,
      incidentRuleCount: 0,
      alertRuleCount: 0,
      mayCreatePolicy: false,
      mayAddEscalationRules: false,
      mayAddRules: false,
    });

    await renderSetup();
    typeAddress("acme.example");
    await startChecking();
    await press("guided-setup-check-continue");

    const help: HTMLElement = screen.getByTestId("guided-setup-who-help");

    expect(help).toHaveTextContent(WEBSITE_DOWN_COPY.whoOwnerOnlyHelpNotOwner);
    expect(help).not.toHaveTextContent("You own this monitor");

    await press("guided-setup-who-continue");

    expect(
      screen.getByTestId("guided-setup-step-who_is_told-done-line"),
    ).toHaveTextContent(
      "The project's owners are emailed about incidents nobody owns.",
    );
  });

  test("a project whose policies decide, someone not made the owner: no email promised", async () => {
    api["ensureMonitorOwner"]!.mockResolvedValue(false);
    api["loadWhoIsToldFacts"]!.mockResolvedValue(PROJECT_PAGES_PEOPLE);

    await renderSetup();
    typeAddress("acme.example");
    await startChecking();
    await press("guided-setup-check-continue");

    const help: HTMLElement = screen.getByTestId("guided-setup-who-help");

    expect(help.textContent).toBe(WEBSITE_DOWN_COPY.whoExistingHelpNotOwner);
    expect(help).not.toHaveTextContent("emailed");
  });

  test("coming back to a run: ownership is read from the records, nothing is written", async () => {
    api["isMonitorOwner"]!.mockResolvedValue(false);
    api["loadWhoIsToldFacts"]!.mockResolvedValue(PROJECT_PAGES_PEOPLE);
    keepRun({ monitorId: MONITOR_ID });

    await renderSetup();

    expect(api["isMonitorOwner"]).toHaveBeenCalledWith({
      monitorId: MONITOR_ID,
      userId: USER_ID,
    });
    expect(api["ensureMonitorOwner"]).not.toHaveBeenCalled();
    expect(stepState("who_is_told")).toBe("open");
    expect(screen.getByTestId("guided-setup-who-help").textContent).toBe(
      WEBSITE_DOWN_COPY.whoExistingHelpNotOwner,
    );
  });

  test("the summary leaves the owner's email out for someone who does not own it", async () => {
    api["isMonitorOwner"]!.mockResolvedValue(false);
    keepRun({
      monitorId: MONITOR_ID,
      policyId: POLICY_ID,
      testExecutionLogId: "log-1",
    });

    await renderSetup();

    await waitFor(() => {
      expect(
        screen.getByTestId("guided-setup-summary-who_is_told"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("guided-setup-summary-who_is_told"),
    ).not.toHaveTextContent("You own this monitor");
  });
});

/*
 * A PAYMENT METHOD, BEFORE START CHECKING (#7367): on Cloud's Free plan a
 * project with no card on file may not make a monitor that runs checks. The
 * step said nothing until Start checking was refused, in red, with no link.
 */
describe("a payment method first, on Cloud's Free plan (#7367)", () => {
  const paymentRequired: () => HTTPErrorResponse = (): HTTPErrorResponse => {
    return new HTTPErrorResponse(
      402,
      {
        message:
          "Add a payment method in Project Settings > Billing and Invoices > Billing before using paid monitoring or telemetry. These features have usage charges even on the Free plan. Manual monitors remain free.",
      },
      {},
    );
  };

  test("says so before Start checking, with the price and the billing page", async () => {
    api["needsPaymentMethod"]!.mockResolvedValue(true);

    await renderSetup();

    const notice: HTMLElement = screen.getByTestId(
      "guided-setup-payment-needed",
    );

    expect(notice).toHaveTextContent(
      "This project is on the Free plan, where a monitor that checks your site is billed as you use it, at $1 per monitor per month. Add a payment method before you start checking.",
    );
    // Before the button it is about.
    expect(
      notice.compareDocumentPosition(
        screen.getByTestId("guided-setup-start-checking"),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const link: HTMLElement = screen.getByTestId(
      "guided-setup-add-payment-method",
    );

    expect(link).toHaveTextContent("Add Payment Method");
    expect(link).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/settings/billing`,
    );
    // In a new tab: the address typed here stays.
    expect(link).toHaveAttribute("target", "_blank");
    expect(api["createMonitor"]).not.toHaveBeenCalled();
  });

  test("someone who may not add one is told who can, with no link", async () => {
    api["needsPaymentMethod"]!.mockResolvedValue(true);
    mayAddPaymentMethod = false;

    await renderSetup();

    expect(screen.getByTestId("guided-setup-payment-needed")).toHaveTextContent(
      "Ask a project owner to add a payment method before you start checking.",
    );
    expect(screen.queryByTestId("guided-setup-add-payment-method")).toBeNull();
  });

  test("a project that has one, or no plan to pay for: nothing is said", async () => {
    await renderSetup();

    expect(api["needsPaymentMethod"]).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("guided-setup-payment-needed")).toBeNull();
  });

  test("a run already past the first step does not ask", async () => {
    keepRun({ monitorId: MONITOR_ID });

    await renderSetup();

    expect(api["needsPaymentMethod"]).not.toHaveBeenCalled();
  });

  test("Start checking refused for want of one: the notice, not the server's line in red", async () => {
    api["createMonitor"]!.mockRejectedValue(paymentRequired());

    await renderSetup();
    typeAddress("acme.example");
    await startChecking();

    expect(screen.getByTestId("guided-setup-payment-needed")).toHaveTextContent(
      "Add a payment method before you start checking.",
    );
    expect(
      screen.getByTestId("guided-setup-add-payment-method"),
    ).toBeInTheDocument();
    // The one alert is the notice: no red line beside it.
    const notice: HTMLElement = screen.getByTestId(
      "guided-setup-payment-needed",
    );
    for (const alert of screen.queryAllByRole("alert")) {
      expect(notice.contains(alert)).toBe(true);
    }
    expect(screen.getByTestId("guided-setup")).not.toHaveTextContent(
      "Project Settings > Billing and Invoices > Billing",
    );
    expect(stepState("check")).toBe("open");
    expect(storedRun()).toEqual({});
    // What was typed stays, to try again.
    expect(screen.getByTestId("guided-setup-address")).toHaveValue(
      "acme.example",
    );
  });

  test("Check again: once the project has one, the notice goes, and Start checking works", async () => {
    api["needsPaymentMethod"]!.mockResolvedValue(true);

    await renderSetup();
    expect(
      screen.getByTestId("guided-setup-payment-needed"),
    ).toBeInTheDocument();

    api["needsPaymentMethod"]!.mockResolvedValue(false);
    await press("guided-setup-check-payment-again");

    expect(screen.queryByTestId("guided-setup-payment-needed")).toBeNull();

    typeAddress("acme.example");
    await startChecking();

    expect(api["createMonitor"]).toHaveBeenCalledTimes(1);
  });

  test("back from the billing page in another tab: asked again, and the notice goes", async () => {
    api["needsPaymentMethod"]!.mockResolvedValue(true);

    await renderSetup();
    expect(api["needsPaymentMethod"]).toHaveBeenCalledTimes(1);

    api["needsPaymentMethod"]!.mockResolvedValue(false);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(api["needsPaymentMethod"]).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("guided-setup-payment-needed")).toBeNull();
  });

  test("any other refusal still says why, in red", async () => {
    api["createMonitor"]!.mockRejectedValue(
      new HTTPErrorResponse(
        400,
        { message: "You have reached the active monitor limit of your plan." },
        {},
      ),
    );

    await renderSetup();
    typeAddress("acme.example");
    await startChecking();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "You have reached the active monitor limit of your plan.",
    );
    expect(screen.queryByTestId("guided-setup-payment-needed")).toBeNull();
  });
});

/*
 * THE RUN'S POLICY DELETED WHILE THE PAGE IS OPEN (#8235) - in another tab,
 * or by a teammate. The step's done line and the summary went on saying
 * '"Default on-call policy" pages Ada Lovelace.' of a policy that pages
 * nobody, so a person finished believing they would be paged; the test goes
 * to the person themselves, so it never noticed. Each step that says the
 * policy pages people reads it again just before it moves on: here the fake
 * server's records change between the page opening and the click.
 */
describe("the run's policy deleted in another tab or by a teammate (#8235)", () => {
  const DELETED: string =
    "The on-call policy this setup made was deleted, so choose who is told again.";

  const NO_POLICY: Record<string, unknown> = {
    policyCount: 0,
    incidentRuleCount: 0,
    alertRuleCount: 0,
    mayCreatePolicy: true,
    mayAddEscalationRules: true,
    mayAddRules: true,
  };

  const ANOTHER_POLICY: Record<string, unknown> = {
    policyCount: 1,
    incidentRuleCount: 1,
    alertRuleCount: 1,
    mayCreatePolicy: true,
    mayAddEscalationRules: true,
    mayAddRules: true,
  };

  const UNCOUNTED: Record<string, unknown> = {
    policyCount: null,
    incidentRuleCount: null,
    alertRuleCount: null,
    mayCreatePolicy: true,
    mayAddEscalationRules: true,
    mayAddRules: true,
  };

  // Step 2 open again on the run's policy, as a done step opens to look at.
  const atWhoIsToldWithPolicy: () => Promise<void> =
    async (): Promise<void> => {
      keepRun({ monitorId: MONITOR_ID, policyId: POLICY_ID });
      await renderSetup();
      expect(stepState("test")).toBe("open");
      await act(async () => {
        fireEvent.click(
          screen
            .getByTestId("guided-setup-step-who_is_told")
            .querySelector("button")!,
        );
      });
      expect(stepState("who_is_told")).toBe("open");
      expect(
        screen.getByTestId("guided-setup-who-done-line"),
      ).toHaveTextContent('"Default on-call policy" pages Ada Lovelace.');
    };

  // The test step, its test acknowledged: Continue opens the summary.
  const atAcknowledgedTest: () => Promise<void> = async (): Promise<void> => {
    keepRun({ monitorId: MONITOR_ID, policyId: POLICY_ID });
    await renderSetup();
    expect(stepState("test")).toBe("open");
    await press("send-test-page");
    await act(async () => {
      reportTestResult(result(OnCallTestPageStatus.Acknowledged));
    });
    expect(screen.getByTestId("guided-setup-test-continue")).toBeVisible();
  };

  // Another tab, or a teammate, deletes the policy.
  const deleteThePolicy: (factsAfter?: Record<string, unknown>) => void = (
    factsAfter?: Record<string, unknown>,
  ): void => {
    api["loadPolicy"]!.mockResolvedValue(null);
    api["loadWhoIsToldFacts"]!.mockResolvedValue(factsAfter || NO_POLICY);
  };

  // The run forgot its policy, and step 2 is open, saying why first.
  const expectStepTwoAgain: () => void = (): void => {
    expect(storedRun()["policyId"]).toBeUndefined();
    expect(storedRun()["monitorId"]).toBe(MONITOR_ID);
    expect(stepState("check")).toBe("done");
    expect(stepState("who_is_told")).toBe("open");
    expect(screen.queryByTestId("guided-setup-summary")).toBeNull();
    expect(screen.getByTestId("guided-setup-policy-deleted")).toHaveTextContent(
      DELETED,
    );
    expect(
      screen
        .getByTestId("guided-setup-who-region")
        .contains(screen.getByTestId("guided-setup-policy-deleted")),
    ).toBe(true);
    // Nothing of the policy is left on the page.
    expect(screen.queryByTestId("guided-setup-who-done-line")).toBeNull();
    expect(document.body.textContent).not.toContain(
      '"Default on-call policy" pages Ada Lovelace.',
    );
    expect(screen.queryByRole("alert")).toBeNull();
  };

  test("the sentence is the website-down setup's own, a translation key", () => {
    expect(WEBSITE_DOWN_COPY.policyDeleted).toBe(DELETED);
  });

  describe("Continue on who should be told", () => {
    test("reads the policy again, and goes on while it is there", async () => {
      await atWhoIsToldWithPolicy();
      api["loadPolicy"]!.mockClear();

      await press("guided-setup-who-continue");

      expect(api["loadPolicy"]).toHaveBeenCalledTimes(1);
      expect(api["loadPolicy"]).toHaveBeenCalledWith(POLICY_ID);
      expect(stepState("who_is_told")).toBe("done");
      expect(stepState("test")).toBe("open");
      expect(storedRun()["policyId"]).toBe(POLICY_ID);
      expect(screen.queryByTestId("guided-setup-policy-deleted")).toBeNull();
    });

    test("deleted: the run forgets it, makes nothing, and step 2 opens on making one, saying why", async () => {
      await atWhoIsToldWithPolicy();
      deleteThePolicy();

      await press("guided-setup-who-continue");

      expectStepTwoAgain();
      expect(api["createPolicy"]).not.toHaveBeenCalled();
      // The project's policies were counted again: making one is offered.
      expect(api["loadWhoIsToldFacts"]).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId("guided-setup-people")).toBeInTheDocument();
      expect(
        screen.getByText(
          'This makes the on-call policy "Default on-call policy", which pages them for every new incident and alert in this project.',
        ),
      ).toBeInTheDocument();
      expect(screen.getByTestId("guided-setup-who-continue")).toHaveTextContent(
        WEBSITE_DOWN_COPY.whoSave,
      );
    });

    /*
     * Continue stays where Save and continue is, so nothing else tells a
     * screen reader why the step changed: the region it reads out is the
     * one that held the policy's line before, and now holds why and what
     * to do.
     */
    test("the sentence is read out: the step's polite live region, there before Continue, says it", async () => {
      await atWhoIsToldWithPolicy();
      const region: HTMLElement = screen.getByTestId("guided-setup-who-region");

      expect(region).toHaveAttribute("aria-live", "polite");
      expect(region).toHaveTextContent(
        '"Default on-call policy" pages Ada Lovelace.',
      );
      expect(region).not.toHaveTextContent(DELETED);

      deleteThePolicy();
      await press("guided-setup-who-continue");

      expect(screen.getByTestId("guided-setup-who-region")).toBe(region);
      expect(region).toHaveTextContent(DELETED);
      expect(region).toHaveTextContent(WEBSITE_DOWN_COPY.whoCreateHelp);
      // Why first, then what to do.
      expect(region.firstElementChild).toBe(
        screen.getByTestId("guided-setup-policy-deleted"),
      );
      // The picker and the button are not read out with it.
      expect(region.contains(screen.getByTestId("guided-setup-people"))).toBe(
        false,
      );
      expect(
        region.contains(screen.getByTestId("guided-setup-who-continue")),
      ).toBe(false);
    });

    test("made again: the new policy is the run's, and the sentence is said no more", async () => {
      await atWhoIsToldWithPolicy();
      deleteThePolicy();
      await press("guided-setup-who-continue");

      const NEW_POLICY_ID: string = "60000000-0000-4000-8000-000000000099";
      api["createPolicy"]!.mockResolvedValue(NEW_POLICY_ID);
      api["loadPolicy"]!.mockResolvedValue({
        id: NEW_POLICY_ID,
        name: "Default on-call policy",
        responders: ["Grace Hopper"],
      });
      await press("guided-setup-who-continue");

      expect(api["createPolicy"]).toHaveBeenCalledTimes(1);
      expect(storedRun()["policyId"]).toBe(NEW_POLICY_ID);
      expect(screen.queryByTestId("guided-setup-policy-deleted")).toBeNull();
      expect(stepState("who_is_told")).toBe("done");
      expect(
        screen.getByTestId("guided-setup-step-who_is_told-done-line"),
      ).toHaveTextContent('"Default on-call policy" pages Grace Hopper.');
    });

    test("deleted, while the project pages people through other policies: they decide, and Continue goes on", async () => {
      await atWhoIsToldWithPolicy();
      deleteThePolicy(ANOTHER_POLICY);

      await press("guided-setup-who-continue");

      expectStepTwoAgain();
      expect(screen.queryByTestId("guided-setup-people")).toBeNull();
      expect(screen.getByTestId("guided-setup-who-help")).toHaveTextContent(
        WEBSITE_DOWN_COPY.whoExistingHelp,
      );
      expect(
        screen
          .getByTestId("guided-setup-who-region")
          .contains(screen.getByTestId("guided-setup-who-help")),
      ).toBe(true);

      await press("guided-setup-who-continue");

      expect(api["createPolicy"]).not.toHaveBeenCalled();
      expect(storedRun()).toMatchObject({ whoIsToldConfirmed: true });
      expect(stepState("who_is_told")).toBe("done");
    });

    test("the project's policies that cannot be counted again: the counts read before stand, and making one is offered", async () => {
      await atWhoIsToldWithPolicy();
      deleteThePolicy(UNCOUNTED);

      await press("guided-setup-who-continue");

      expectStepTwoAgain();
      expect(screen.getByTestId("guided-setup-people")).toBeInTheDocument();
    });

    test("a policy read that fails: nothing is forgotten, and the step says why and stays", async () => {
      await atWhoIsToldWithPolicy();
      api["loadPolicy"]!.mockRejectedValue(
        new Error("The server could not be reached."),
      );

      await press("guided-setup-who-continue");

      expect(storedRun()["policyId"]).toBe(POLICY_ID);
      expect(stepState("who_is_told")).toBe("open");
      expect(screen.getByRole("alert")).toHaveTextContent(
        "The server could not be reached.",
      );
      expect(screen.queryByTestId("guided-setup-policy-deleted")).toBeNull();
      expect(
        screen.getByTestId("guided-setup-who-done-line"),
      ).toHaveTextContent('"Default on-call policy" pages Ada Lovelace.');
    });

    test("who the policy pages is read again too: changed meanwhile, the line says who it pages now", async () => {
      await atWhoIsToldWithPolicy();
      api["loadPolicy"]!.mockResolvedValue({
        id: POLICY_ID,
        name: "Default on-call policy",
        responders: ["Ada Lovelace", "Grace Hopper"],
      });

      await press("guided-setup-who-continue");

      expect(
        screen.getByTestId("guided-setup-step-who_is_told-done-line"),
      ).toHaveTextContent(
        '"Default on-call policy" pages Ada Lovelace, Grace Hopper.',
      );
    });
  });

  describe("on the test step, before the summary", () => {
    test("Continue reads the policy again, and opens the summary while it is there", async () => {
      await atAcknowledgedTest();
      api["loadPolicy"]!.mockClear();

      await press("guided-setup-test-continue");

      expect(api["loadPolicy"]).toHaveBeenCalledWith(POLICY_ID);
      expect(screen.getByTestId("guided-setup-summary")).toBeInTheDocument();
    });

    test("Continue, the policy deleted: no summary of a policy that pages nobody; step 2 opens, saying why", async () => {
      await atAcknowledgedTest();
      deleteThePolicy();

      await press("guided-setup-test-continue");

      expectStepTwoAgain();
      expect(
        screen.queryByTestId("guided-setup-summary-who_is_told"),
      ).toBeNull();
      // Who is told is not done any more, nor what comes after it.
      expect(screen.getByTestId("guided-setup-progress")).toHaveTextContent(
        "1 of 3 steps done",
      );
      expect(stepState("test")).toBe("upcoming");
      // The test went to the person, not the policy: it is kept.
      expect(storedRun()["testExecutionLogId"]).toBe("log-1");
    });

    test("Skip, the policy deleted: not saved as skipped, and step 2 opens, saying why", async () => {
      keepRun({ monitorId: MONITOR_ID, policyId: POLICY_ID });
      await renderSetup();
      deleteThePolicy();

      await press("guided-setup-skip-test");

      expectStepTwoAgain();
      expect(storedRun()["testSkipped"]).toBeUndefined();
    });

    test("Skip, the policy there: saved as skipped, and the summary names it", async () => {
      keepRun({ monitorId: MONITOR_ID, policyId: POLICY_ID });
      await renderSetup();

      await press("guided-setup-skip-test");

      expect(storedRun()).toMatchObject({
        policyId: POLICY_ID,
        testSkipped: true,
      });
      await waitFor(() => {
        expect(
          screen.getByTestId("guided-setup-summary-who_is_told"),
        ).toHaveTextContent('"Default on-call policy" pages Ada Lovelace');
      });
    });

    test("a policy read that fails: nothing is forgotten or skipped, and the step says why and stays", async () => {
      await atAcknowledgedTest();
      api["loadPolicy"]!.mockRejectedValue(
        new Error("The server could not be reached."),
      );

      await press("guided-setup-test-continue");

      expect(storedRun()["policyId"]).toBe(POLICY_ID);
      expect(stepState("test")).toBe("open");
      expect(screen.queryByTestId("guided-setup-summary")).toBeNull();
      expect(screen.getByRole("alert")).toHaveTextContent(
        "The server could not be reached.",
      );
      expect(screen.queryByTestId("guided-setup-policy-deleted")).toBeNull();
    });

    test("deleted, then made again: Continue finds the test acknowledged, and the summary names the new policy", async () => {
      await atAcknowledgedTest();
      deleteThePolicy();
      await press("guided-setup-test-continue");

      const NEW_POLICY_ID: string = "60000000-0000-4000-8000-000000000099";
      api["createPolicy"]!.mockResolvedValue(NEW_POLICY_ID);
      api["loadPolicy"]!.mockResolvedValue({
        id: NEW_POLICY_ID,
        name: "Default on-call policy",
        responders: ["Grace Hopper"],
      });
      await press("guided-setup-who-continue");

      // Back on the test, whose answer is kept: Continue reads the new policy.
      expect(stepState("test")).toBe("open");
      await press("guided-setup-test-continue");

      expect(api["loadPolicy"]).toHaveBeenLastCalledWith(NEW_POLICY_ID);
      await waitFor(() => {
        expect(
          screen.getByTestId("guided-setup-summary-who_is_told"),
        ).toHaveTextContent('"Default on-call policy" pages Grace Hopper');
      });
      expect(document.body.textContent).not.toContain(
        '"Default on-call policy" pages Ada Lovelace',
      );
    });
  });

  describe("opening the page", () => {
    test("on a run whose policy is gone: step 2, saying why", async () => {
      api["loadPolicy"]!.mockResolvedValue(null);
      keepRun({ monitorId: MONITOR_ID, policyId: POLICY_ID });
      await renderSetup();

      expectStepTwoAgain();
    });

    test("a policy read that fails is the page's error: the run is kept, and its policy is not said to be deleted", async () => {
      api["loadPolicy"]!.mockRejectedValue(
        new Error("The server could not be reached."),
      );
      keepRun({ monitorId: MONITOR_ID, policyId: POLICY_ID });

      await act(async () => {
        render(<WebsiteDownGuidedSetup firstCheckPollIntervalInMs={5} />);
      });

      await waitFor(() => {
        expect(
          screen.getByText("The server could not be reached."),
        ).toBeInTheDocument();
      });
      expect(storedRun()).toEqual({
        monitorId: MONITOR_ID,
        policyId: POLICY_ID,
      });
      expect(screen.queryByTestId("guided-setup-policy-deleted")).toBeNull();
    });

    test("a monitor read that fails is the page's error too: the run is never started again on it", async () => {
      api["loadMonitor"]!.mockRejectedValue(
        new Error("The server could not be reached."),
      );
      keepRun({ monitorId: MONITOR_ID, policyId: POLICY_ID });

      await act(async () => {
        render(<WebsiteDownGuidedSetup firstCheckPollIntervalInMs={5} />);
      });

      await waitFor(() => {
        expect(
          screen.getByText("The server could not be reached."),
        ).toBeInTheDocument();
      });
      expect(storedRun()).toEqual({
        monitorId: MONITOR_ID,
        policyId: POLICY_ID,
      });
      expect(api["createMonitor"]).not.toHaveBeenCalled();
    });

    test("on a run whose policy is there: nothing is said of a deletion", async () => {
      keepRun({ monitorId: MONITOR_ID, policyId: POLICY_ID });
      await renderSetup();

      expect(screen.queryByTestId("guided-setup-policy-deleted")).toBeNull();
      expect(stepState("test")).toBe("open");
    });
  });

  test("Check another address starts without the sentence", async () => {
    await atAcknowledgedTest();
    deleteThePolicy();
    await press("guided-setup-test-continue");
    expect(screen.getByTestId("guided-setup-policy-deleted")).toBeVisible();

    // Made again, the summary is reached, and a new run starts.
    api["loadPolicy"]!.mockResolvedValue({
      id: POLICY_ID,
      name: "Default on-call policy",
      responders: ["Ada Lovelace"],
    });
    await press("guided-setup-who-continue");
    await press("guided-setup-test-continue");
    await waitFor(() => {
      expect(screen.getByTestId("guided-setup-start-over")).toBeVisible();
    });
    await press("guided-setup-start-over");

    // The next run's step 2 is its own: nothing of the last one is said.
    typeAddress("acme.example");
    await startChecking();
    await press("guided-setup-check-continue");

    expect(stepState("who_is_told")).toBe("open");
    expect(screen.queryByTestId("guided-setup-policy-deleted")).toBeNull();
  });
});

/*
 * THE RUN'S POLICY ARCHIVED - in another tab, or by a teammate - while the
 * page was open (#8432). An archived policy is still there, but pages no
 * one: the setup read it as there, and its done line and the summary said
 * '"Default on-call policy" pages Ada Lovelace.' of a policy that pages
 * nobody. Now it is forgotten as a deleted one is, and step 2 says, in a
 * sentence of its own, that it was archived.
 */
describe("the run's policy archived in another tab or by a teammate (#8432)", () => {
  const ARCHIVED: string =
    "The on-call policy this setup made was archived, so it pages no one. Choose who is told again.";
  const DELETED: string =
    "The on-call policy this setup made was deleted, so choose who is told again.";

  const NO_POLICY_IN_SERVICE: Record<string, unknown> = {
    policyCount: 0,
    incidentRuleCount: 0,
    alertRuleCount: 0,
    mayCreatePolicy: true,
    mayAddEscalationRules: true,
    mayAddRules: true,
  };

  const ANOTHER_POLICY: Record<string, unknown> = {
    policyCount: 1,
    incidentRuleCount: 1,
    alertRuleCount: 1,
    mayCreatePolicy: true,
    mayAddEscalationRules: true,
    mayAddRules: true,
  };

  const ARCHIVED_POLICY: Record<string, unknown> = {
    id: POLICY_ID,
    name: "Default on-call policy",
    responders: ["Ada Lovelace"],
    isArchived: true,
  };

  // Step 2 open again on the run's policy, as a done step opens to look at.
  const atWhoIsToldWithPolicy: () => Promise<void> =
    async (): Promise<void> => {
      keepRun({ monitorId: MONITOR_ID, policyId: POLICY_ID });
      await renderSetup();
      expect(stepState("test")).toBe("open");
      await act(async () => {
        fireEvent.click(
          screen
            .getByTestId("guided-setup-step-who_is_told")
            .querySelector("button")!,
        );
      });
      expect(stepState("who_is_told")).toBe("open");
    };

  // The test step, its test acknowledged: Continue opens the summary.
  const atAcknowledgedTest: () => Promise<void> = async (): Promise<void> => {
    keepRun({ monitorId: MONITOR_ID, policyId: POLICY_ID });
    await renderSetup();
    expect(stepState("test")).toBe("open");
    await press("send-test-page");
    await act(async () => {
      reportTestResult(result(OnCallTestPageStatus.Acknowledged));
    });
    expect(screen.getByTestId("guided-setup-test-continue")).toBeVisible();
  };

  // Another tab, or a teammate, archives the policy: it reads, archived.
  const archiveThePolicy: (factsAfter?: Record<string, unknown>) => void = (
    factsAfter?: Record<string, unknown>,
  ): void => {
    api["loadPolicy"]!.mockResolvedValue(ARCHIVED_POLICY);
    api["loadWhoIsToldFacts"]!.mockResolvedValue(
      factsAfter || NO_POLICY_IN_SERVICE,
    );
  };

  // The run forgot its policy, and step 2 is open, saying it was archived.
  const expectStepTwoAgain: () => void = (): void => {
    expect(storedRun()["policyId"]).toBeUndefined();
    expect(storedRun()["monitorId"]).toBe(MONITOR_ID);
    expect(stepState("check")).toBe("done");
    expect(stepState("who_is_told")).toBe("open");
    expect(screen.queryByTestId("guided-setup-summary")).toBeNull();
    expect(
      screen.getByTestId("guided-setup-policy-archived"),
    ).toHaveTextContent(ARCHIVED);
    // Its own sentence: never the deleted one's.
    expect(screen.queryByTestId("guided-setup-policy-deleted")).toBeNull();
    expect(screen.queryByText(DELETED)).toBeNull();
    expect(
      screen
        .getByTestId("guided-setup-who-region")
        .contains(screen.getByTestId("guided-setup-policy-archived")),
    ).toBe(true);
    // Nothing says the archived policy pages anyone.
    expect(screen.queryByTestId("guided-setup-who-done-line")).toBeNull();
    expect(document.body.textContent).not.toContain(
      '"Default on-call policy" pages Ada Lovelace.',
    );
    expect(screen.queryByRole("alert")).toBeNull();
  };

  test("the sentence is the website-down setup's own, a translation key, apart from the deleted one", () => {
    expect(WEBSITE_DOWN_COPY.policyArchived).toBe(ARCHIVED);
    expect(WEBSITE_DOWN_COPY.policyArchived).not.toBe(
      WEBSITE_DOWN_COPY.policyDeleted,
    );
  });

  describe("Continue on who should be told", () => {
    test("archived: the run forgets it, makes nothing, and step 2 opens on making one, saying why", async () => {
      await atWhoIsToldWithPolicy();
      archiveThePolicy();

      await press("guided-setup-who-continue");

      expectStepTwoAgain();
      expect(api["createPolicy"]).not.toHaveBeenCalled();
      // The project's policies were counted again: making one is offered.
      expect(api["loadWhoIsToldFacts"]).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId("guided-setup-people")).toBeInTheDocument();
      expect(screen.getByTestId("guided-setup-who-continue")).toHaveTextContent(
        WEBSITE_DOWN_COPY.whoSave,
      );
    });

    test("negative control: the policy read in service (isArchived false) goes on, as before", async () => {
      await atWhoIsToldWithPolicy();
      api["loadPolicy"]!.mockResolvedValue({
        ...ARCHIVED_POLICY,
        isArchived: false,
      });

      await press("guided-setup-who-continue");

      expect(stepState("who_is_told")).toBe("done");
      expect(stepState("test")).toBe("open");
      expect(storedRun()["policyId"]).toBe(POLICY_ID);
      expect(screen.queryByTestId("guided-setup-policy-archived")).toBeNull();
      expect(api["loadWhoIsToldFacts"]).toHaveBeenCalledTimes(1);
    });

    test("the sentence is read out first, in the step's polite live region", async () => {
      await atWhoIsToldWithPolicy();
      const region: HTMLElement = screen.getByTestId("guided-setup-who-region");

      expect(region).toHaveAttribute("aria-live", "polite");
      expect(region).not.toHaveTextContent(ARCHIVED);

      archiveThePolicy();
      await press("guided-setup-who-continue");

      expect(screen.getByTestId("guided-setup-who-region")).toBe(region);
      expect(region).toHaveTextContent(ARCHIVED);
      expect(region.firstElementChild).toBe(
        screen.getByTestId("guided-setup-policy-archived"),
      );
      expect(
        region.contains(screen.getByTestId("guided-setup-who-continue")),
      ).toBe(false);
    });

    test("made again: the new policy is the run's, and the sentence is said no more", async () => {
      await atWhoIsToldWithPolicy();
      archiveThePolicy();
      await press("guided-setup-who-continue");

      const NEW_POLICY_ID: string = "60000000-0000-4000-8000-000000000099";
      api["createPolicy"]!.mockResolvedValue(NEW_POLICY_ID);
      api["loadPolicy"]!.mockResolvedValue({
        id: NEW_POLICY_ID,
        name: "Default on-call policy",
        responders: ["Grace Hopper"],
        isArchived: false,
      });
      await press("guided-setup-who-continue");

      expect(api["createPolicy"]).toHaveBeenCalledTimes(1);
      expect(storedRun()["policyId"]).toBe(NEW_POLICY_ID);
      expect(screen.queryByTestId("guided-setup-policy-archived")).toBeNull();
      expect(stepState("who_is_told")).toBe("done");
      expect(
        screen.getByTestId("guided-setup-step-who_is_told-done-line"),
      ).toHaveTextContent('"Default on-call policy" pages Grace Hopper.');
    });

    test("archived, while the project pages people through other policies: they decide", async () => {
      await atWhoIsToldWithPolicy();
      archiveThePolicy(ANOTHER_POLICY);

      await press("guided-setup-who-continue");

      expectStepTwoAgain();
      expect(screen.queryByTestId("guided-setup-people")).toBeNull();
      expect(screen.getByTestId("guided-setup-who-help")).toHaveTextContent(
        WEBSITE_DOWN_COPY.whoExistingHelp,
      );
    });
  });

  describe("on the test step, before the summary", () => {
    test("Continue, the policy archived: no summary saying it pages people; step 2 opens, saying why", async () => {
      await atAcknowledgedTest();
      archiveThePolicy();

      await press("guided-setup-test-continue");

      expectStepTwoAgain();
      expect(
        screen.queryByTestId("guided-setup-summary-who_is_told"),
      ).toBeNull();
      expect(stepState("test")).toBe("upcoming");
      // The test went to the person, not the policy: it is kept.
      expect(storedRun()["testExecutionLogId"]).toBe("log-1");
    });

    test("Skip, the policy archived: not saved as skipped, and step 2 opens, saying why", async () => {
      keepRun({ monitorId: MONITOR_ID, policyId: POLICY_ID });
      await renderSetup();
      archiveThePolicy();

      await press("guided-setup-skip-test");

      expectStepTwoAgain();
      expect(storedRun()["testSkipped"]).toBeUndefined();
    });
  });

  describe("opening the page", () => {
    test("on a finished run whose policy was archived: step 2, saying why, and no summary", async () => {
      api["loadPolicy"]!.mockResolvedValue(ARCHIVED_POLICY);
      keepRun({
        monitorId: MONITOR_ID,
        policyId: POLICY_ID,
        testExecutionLogId: "log-1",
      });
      await renderSetup();

      expectStepTwoAgain();
    });

    test("on a run whose policy was deleted: it still says deleted, never archived", async () => {
      api["loadPolicy"]!.mockResolvedValue(null);
      keepRun({ monitorId: MONITOR_ID, policyId: POLICY_ID });
      await renderSetup();

      expect(
        screen.getByTestId("guided-setup-policy-deleted"),
      ).toHaveTextContent(DELETED);
      expect(screen.queryByTestId("guided-setup-policy-archived")).toBeNull();
    });

    test("on a run whose policy is in service: nothing is said of either", async () => {
      api["loadPolicy"]!.mockResolvedValue({
        ...ARCHIVED_POLICY,
        isArchived: false,
      });
      keepRun({ monitorId: MONITOR_ID, policyId: POLICY_ID });
      await renderSetup();

      expect(stepState("test")).toBe("open");
      expect(screen.queryByTestId("guided-setup-policy-archived")).toBeNull();
      expect(screen.queryByTestId("guided-setup-policy-deleted")).toBeNull();
    });
  });

  test("Check another address starts without the sentence", async () => {
    await atAcknowledgedTest();
    archiveThePolicy();
    await press("guided-setup-test-continue");
    expect(screen.getByTestId("guided-setup-policy-archived")).toBeVisible();

    api["loadPolicy"]!.mockResolvedValue({
      ...ARCHIVED_POLICY,
      isArchived: false,
    });
    await press("guided-setup-who-continue");
    await press("guided-setup-test-continue");
    await waitFor(() => {
      expect(screen.getByTestId("guided-setup-start-over")).toBeVisible();
    });
    await press("guided-setup-start-over");

    typeAddress("acme.example");
    await startChecking();
    await press("guided-setup-check-continue");

    expect(stepState("who_is_told")).toBe("open");
    expect(screen.queryByTestId("guided-setup-policy-archived")).toBeNull();
  });
});
/*
 * ARCHIVED POLICIES ARE NOT THE PROJECT'S POLICIES (#8234). A project
 * whose only on-call policy was archived was told its policies decide who
 * is paged - an archived policy pages no one - so the setup made none.
 * Here the project is counted by the real WebsiteDownApi.loadWhoIsToldFacts
 * from a fake server that counts as the real one does: only the records its
 * query matches. Its on-call rules are read with the policies they run, as
 * the real list answers them, each policy archived or not (#8433).
 */
describe("archived on-call policies (#8234)", () => {
  const realApi: { loadWhoIsToldFacts: () => Promise<unknown> } = (
    jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/WebsiteDown/WebsiteDownApi",
    ) as { default: { loadWhoIsToldFacts: () => Promise<unknown> } }
  ).default;

  // An on-call rule, as the list reads it: the policies it runs, archived or not.
  const ruleRunning: <T extends IncidentOnCallRule | AlertOnCallRule>(
    type: { new (): T },
    policiesArchived: Array<boolean>,
  ) => T = <T extends IncidentOnCallRule | AlertOnCallRule>(
    type: { new (): T },
    policiesArchived: Array<boolean>,
  ): T => {
    return Object.assign(new type(), {
      _id: ObjectID.generate().toString(),
      onCallDutyPolicies: policiesArchived.map(
        (isArchived: boolean): OnCallDutyPolicy => {
          return Object.assign(new OnCallDutyPolicy(), {
            _id: ObjectID.generate().toString(),
            isArchived: isArchived,
          });
        },
      ),
    });
  };

  const holds: (
    policies: Array<{ isArchived: boolean }>,
    rules?: { incident?: Array<Array<boolean>>; alert?: Array<Array<boolean>> },
  ) => void = (
    policies: Array<{ isArchived: boolean }>,
    rules?: { incident?: Array<Array<boolean>>; alert?: Array<Array<boolean>> },
  ): void => {
    jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
    jest.spyOn(ModelAPI, "getList").mockImplementation((async (args: {
      modelType: { new (): unknown };
    }) => {
      const data: Array<unknown> =
        args.modelType === IncidentOnCallRule
          ? (rules?.incident || []).map((archived: Array<boolean>) => {
              return ruleRunning(IncidentOnCallRule, archived);
            })
          : args.modelType === AlertOnCallRule
            ? (rules?.alert || []).map((archived: Array<boolean>) => {
                return ruleRunning(AlertOnCallRule, archived);
              })
            : [];

      return { data: data, count: data.length, skip: 0, limit: data.length };
    }) as unknown as typeof ModelAPI.getList);
    jest.spyOn(ModelAPI, "count").mockImplementation((async (args: {
      modelType: { new (): unknown };
      query: Record<string, unknown>;
    }) => {
      if (args.modelType !== OnCallDutyPolicy) {
        return 0;
      }

      return policies.filter((policy: Record<string, unknown>): boolean => {
        return Object.entries(args.query).every(
          ([column, value]: [string, unknown]): boolean => {
            return policy[column] === value;
          },
        );
      }).length;
    }) as unknown as typeof ModelAPI.count);
    api["loadWhoIsToldFacts"]!.mockImplementation(() => {
      return realApi.loadWhoIsToldFacts();
    });
  };

  test("a project whose only policy is archived: the setup makes one, paging who is picked", async () => {
    holds([{ isArchived: true }]);
    await toWhoIsTold();

    expect(screen.getByTestId("guided-setup-people")).toBeInTheDocument();
    expect(screen.queryByTestId("guided-setup-who-help")).toBeNull();

    await press("guided-setup-who-continue");

    expect(api["createPolicy"]).toHaveBeenCalledTimes(1);
    expect(storedRun()).toEqual({ monitorId: MONITOR_ID, policyId: POLICY_ID });
  });

  test("an archived policy beside one in service: the project's policies decide, and none is made", async () => {
    holds([{ isArchived: true }, { isArchived: false }]);
    await toWhoIsTold();

    expect(screen.queryByTestId("guided-setup-people")).toBeNull();
    expect(screen.getByTestId("guided-setup-who-help")).toHaveTextContent(
      WEBSITE_DOWN_COPY.whoExistingHelp,
    );

    await press("guided-setup-who-continue");

    expect(api["createPolicy"]).not.toHaveBeenCalled();
    expect(storedRun()).toMatchObject({ whoIsToldConfirmed: true });
  });

  /*
   * #8433: the issue's project - its one policy archived, and the two
   * rules that run it. Counted, the rules told the setup the project pages
   * people already, and it made nothing: nobody was paged when the monitor
   * opened an incident.
   */
  test("its only policy archived, with the rules that run it: the setup still makes one (#8433)", async () => {
    holds([{ isArchived: true }], { incident: [[true]], alert: [[true]] });
    await toWhoIsTold();

    expect(screen.getByTestId("guided-setup-people")).toBeInTheDocument();
    expect(screen.queryByTestId("guided-setup-who-help")).toBeNull();
    expect(screen.queryByText(WEBSITE_DOWN_COPY.whoExistingHelp)).toBeNull();

    await press("guided-setup-who-continue");

    expect(api["createPolicy"]).toHaveBeenCalledTimes(1);
    expect(storedRun()).toEqual({ monitorId: MONITOR_ID, policyId: POLICY_ID });
  });

  test("a rule that runs a policy in service beside an archived one: the project's policies and rules decide (#8433)", async () => {
    holds([{ isArchived: true }, { isArchived: false }], {
      incident: [[true, false]],
    });
    await toWhoIsTold();

    expect(screen.queryByTestId("guided-setup-people")).toBeNull();
    expect(screen.getByTestId("guided-setup-who-help")).toHaveTextContent(
      WEBSITE_DOWN_COPY.whoExistingHelp,
    );
  });

  /*
   * #8432 and #8433 together, as the issue's steps reproduce them: the run
   * made its policy and the two rules that run it; another tab archives
   * the policy; Continue reads it again, forgets it, and counts the
   * project again - its rules run only the archived policy, so making one
   * is offered, not "the project's policies and rules decide".
   */
  test("the run's policy archived in another tab: Continue offers to make one again, its rules not counted (#8432, #8433)", async () => {
    holds([{ isArchived: false }], { incident: [[false]], alert: [[false]] });
    keepRun({ monitorId: MONITOR_ID, policyId: POLICY_ID });
    await renderSetup();
    await act(async () => {
      fireEvent.click(
        screen
          .getByTestId("guided-setup-step-who_is_told")
          .querySelector("button")!,
      );
    });
    expect(screen.getByTestId("guided-setup-who-done-line")).toHaveTextContent(
      '"Default on-call policy" pages Ada Lovelace.',
    );

    // Another tab archives it: its rules now run only an archived policy.
    holds([{ isArchived: true }], { incident: [[true]], alert: [[true]] });
    api["loadPolicy"]!.mockResolvedValue({
      id: POLICY_ID,
      name: "Default on-call policy",
      responders: ["Ada Lovelace"],
      isArchived: true,
    });
    await press("guided-setup-who-continue");

    expect(storedRun()["policyId"]).toBeUndefined();
    expect(screen.getByTestId("guided-setup-policy-archived")).toBeVisible();
    expect(screen.getByTestId("guided-setup-people")).toBeInTheDocument();
    expect(screen.queryByTestId("guided-setup-who-help")).toBeNull();
    expect(screen.getByTestId("guided-setup-who-continue")).toHaveTextContent(
      WEBSITE_DOWN_COPY.whoSave,
    );
  });
});
