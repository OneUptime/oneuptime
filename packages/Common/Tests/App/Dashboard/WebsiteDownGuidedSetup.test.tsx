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
  within,
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
  findOtherMonitor: getJestMockFunction(),
  loadDefaultLocationCount: getJestMockFunction(),
  loadStatusPages: getJestMockFunction(),
  findStatusPageShowing: getJestMockFunction(),
  addToStatusPage: getJestMockFunction(),
};
let mayCreateMonitor: boolean = true;
let mayAddPaymentMethod: boolean = true;
// Step 4 (#7053), the on-call setup (#7370) and the status page setup's link.
let mayAddToStatusPage: boolean = true;
let mayUseOnCallSetup: boolean = true;
let mayCreateStatusPage: boolean = true;

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
      mayAddToStatusPage: (): boolean => {
        return mayAddToStatusPage;
      },
      mayUseOnCallSetup: (): boolean => {
        return mayUseOnCallSetup;
      },
      isPaymentRequired: actual["isPaymentRequired"],
      // Step 4's picker searches the server, through ModelAPI (#10646).
      WEBSITE_DOWN_STATUS_PAGE_PICKER:
        actual["WEBSITE_DOWN_STATUS_PAGE_PICKER"],
    };
  },
);

// Whether the person may make a status page: the summary's offer of its setup.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/StatusPage/StatusPageSetupApi",
  () => {
    return {
      __esModule: true,
      default: {},
      mayCreateStatusPage: (): boolean => {
        return mayCreateStatusPage;
      },
    };
  },
);

/*
 * Who the monitor tells, as its overview's When this goes down reads it
 * (#7055): asked only for a project whose own policies and rules page.
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
  GUIDED_SETUP_ASIDE_TEST_ID,
  GUIDED_SETUP_GUIDE_LINK_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/GuidedSetupFrame";
import {
  WELCOME_STEP_MINUTES,
  WelcomeStep,
} from "../../../Types/WelcomeChecklist/WelcomeChecklist";
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
import {
  WhoIsToldOwnersSource,
  WhoIsToldResult,
} from "../../../Types/Monitor/WhoIsTold";
import { getLearnMoreUrl } from "../../../UI/Components/Link/LearnMoreLink";
import AlertOnCallRule from "../../../Models/DatabaseModels/AlertOnCallRule";
import IncidentOnCallRule from "../../../Models/DatabaseModels/IncidentOnCallRule";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import UserUtil from "../../../UI/Utils/User";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { STATUS_PAGE_URL } from "../../../UI/Config";
import Route from "../../../Types/API/Route";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import {
  guidedSetupRunServer,
  readKeptRunValues,
} from "./GuidedSetupRunServerMock";
import { GuidedSetupResourceStatus } from "../../../Types/GuidedSetup/GuidedSetupRun";

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

/*
 * What the monitor's When this goes down answers for a project that pages
 * already: an incident that emails the Project Owners and pages Grace Hopper
 * through the project's own policy.
 */
const WHO_IS_TOLD: WhoIsToldResult = {
  monitorId: MONITOR_ID,
  monitorName: "acme.example",
  checkedAt: "2026-11-11T10:00:00.000Z",
  criteria: [
    {
      id: "offline",
      name: "Offline",
      statusName: "Offline",
      events: [
        {
          kind: OnCallTestPageRecordKind.Incident,
          title: "acme.example is offline",
          severityName: "Critical",
          owners: {
            source: WhoIsToldOwnersSource.ProjectOwners,
            userNames: ["Ada Lovelace"],
            teamNames: [],
          },
          ownerRules: [],
          rules: [{ id: "r1", name: "Every incident" }],
          policies: [
            {
              id: "70000000-0000-4000-8000-000000000001",
              name: "Platform on-call",
              isHidden: false,
              isNamedByCriteria: false,
              ruleIds: ["r1"],
              levelCount: 1,
              people: [
                {
                  userId: "40000000-0000-4000-8000-000000000009",
                  name: "Grace Hopper",
                  channels: [OnCallPageChannel.SMS],
                  isFallback: false,
                  isReachable: true,
                },
              ],
              notPaged: [],
            },
          ],
          statusPages: [],
        },
      ],
    },
  ],
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

const storedRun: () => Record<string, unknown> = (): Record<
  string,
  unknown
> => {
  return readKeptRunValues(window.localStorage.getItem(RUN_KEY)) as Record<
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

/*
 * Step 2's note on the policy it makes, as drawn: the Glossary's word for an
 * on-call policy is a defined term inside it (#7057).
 */
const POLICY_NOTE: string =
  'This makes the on-call policy "Default on-call policy", which pages them for every new incident and alert in this project.';

const policyNote: () => string = (): string => {
  return withoutIsolateMarks(
    screen.getByTestId("guided-setup-who-policy-note").textContent || "",
  );
};

// Step 2's help, its How to Reach Me a link (#7757).
const WHO_CREATE_HELP: string =
  "When it goes down, OneUptime opens an incident and pages these people, each the way their How to Reach Me says. It starts with you, by email.";

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
  guidedSetupRunServer.reset();
  window.localStorage.clear();
  mayCreateMonitor = true;
  mayAddPaymentMethod = true;
  mayAddToStatusPage = true;
  mayUseOnCallSetup = true;
  mayCreateStatusPage = true;
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
  // Nobody else's monitor checks the address (#7254).
  api["findOtherMonitor"]!.mockResolvedValue(null);
  // A new monitor starts with two probes (#7461).
  api["loadDefaultLocationCount"]!.mockResolvedValue(2);
  // A new project: no status page yet, so no step 4 (#7053).
  api["loadStatusPages"]!.mockResolvedValue([]);
  api["findStatusPageShowing"]!.mockResolvedValue(null);
  api["addToStatusPage"]!.mockResolvedValue(undefined);
  getResultMock.mockResolvedValue(result(OnCallTestPageStatus.Acknowledged));
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

/*
 * OPENED FROM AN ASK AI PLAN (#7245): its card's Open in guided setup
 * opens this setup with the address the plan checks (?address=), and an API
 * ticked as one (?api=true), for someone who wants to see each step.
 */
describe("1. Opened from an Ask AI setup plan (#7245)", () => {
  const openedFor: (search: string) => void = (search: string): void => {
    window.history.replaceState(
      {},
      "",
      `/dashboard/${PROJECT_ID}/monitors/setup${search}`,
    );
  };

  afterEach(() => {
    openedFor("");
  });

  test("the plan's address is filled in, an API is ticked as one, and nothing is checked yet", async () => {
    openedFor(
      `?from=ask_ai&address=${encodeURIComponent("https://api.example.com/health")}&api=true`,
    );
    await renderSetup();

    expect(screen.getByTestId("guided-setup-address")).toHaveValue(
      "https://api.example.com/health",
    );
    expect(screen.getByTestId("guided-setup-is-api")).toBeChecked();
    expect(api["createMonitor"]).not.toHaveBeenCalled();
    expect(stepState("check")).toBe("open");
  });

  test("a website's address leaves the API box as it is, and Start checking checks it", async () => {
    openedFor("?from=ask_ai&address=example.com");
    await renderSetup();

    expect(screen.getByTestId("guided-setup-address")).toHaveValue(
      "example.com",
    );
    expect(screen.getByTestId("guided-setup-is-api")).not.toBeChecked();
  });

  test("opened any other way, the address starts empty", async () => {
    openedFor("?from=empty_list");
    await renderSetup();

    expect(screen.getByTestId("guided-setup-address")).toHaveValue("");
    expect(screen.getByTestId("guided-setup-is-api")).not.toBeChecked();
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
    // What was asked is kept too: another device asks it again (#7253).
    expect(storedRun()).toEqual({
      address: "acme.example",
      monitorId: MONITOR_ID,
    });
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
    // Only what was asked, to ask again: no monitor (#7253).
    expect(storedRun()).toEqual({ address: "acme.example" });
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
    expect(policyNote()).toBe(POLICY_NOTE);

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

    /*
     * Who its rules page for this monitor, not "its rules decide" and a
     * link (#7055): the monitor's own When this goes down.
     */
    expect(await screen.findByTestId("who-is-told-summary")).toHaveTextContent(
      "OneUptime marks it Offline and opens an incident (Critical). It emails the Project Owners (Ada Lovelace). It pages Grace Hopper through Platform on-call.",
    );
    expect(getWhoIsToldMock.mock.calls[0]![0]).toMatchObject({
      refresh: false,
    });
    expect(
      String(
        (getWhoIsToldMock.mock.calls[0]![0] as { monitorId: ObjectID })
          .monitorId,
      ),
    ).toBe(MONITOR_ID);
    // In the step: no Checked line, and its fixes open in a new tab.
    expect(screen.queryByTestId("who-is-told-recheck")).toBeNull();

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
      "You own this monitor, so you are emailed when it goes down. Paging a team needs an on-call policy: ask a Project Owner or Project Admin to set one up.",
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

  test("Check another address starts a new run, the last one's records kept", async () => {
    keepRun({
      monitorId: MONITOR_ID,
      policyId: POLICY_ID,
      testExecutionLogId: "log-1",
    });
    await renderSetup();
    await press("guided-setup-start-over");

    expect(stepState("check")).toBe("open");
    await waitFor(() => {
      expect(window.localStorage.getItem(RUN_KEY)).toBeNull();
    });
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
    await waitFor(() => {
      expect(window.localStorage.getItem(RUN_KEY)).toBeNull();
    });
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
    expect(storedRun()).toEqual({
      address: "ACME.example/",
      monitorId: theirs.id,
      monitorIsExisting: true,
    });
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

  test("storage cleared, then the page opened again: the server's run opens it at the step it was on (#7253)", async () => {
    const first: { unmount: () => void } = await renderSetup();
    await checkAddress("acme.example");
    await press("guided-setup-check-continue");

    expect(api["createMonitor"]).toHaveBeenCalledTimes(1);
    const made: string = serverMonitors[0]!.id;

    await waitFor(() => {
      expect(guidedSetupRunServer.valuesOf("website_down")).toEqual({
        address: "acme.example",
        monitorId: made,
      });
    });

    // The browser forgets the run - a private window, another device.
    window.localStorage.clear();
    act(() => {
      first.unmount();
    });
    await renderSetup();

    expect(stepState("check")).toBe("done");
    expect(stepState("who_is_told")).toBe("open");
    expect(api["createMonitor"]).toHaveBeenCalledTimes(1);
    expect(storedRun()).toEqual({ address: "acme.example", monitorId: made });
  });

  test("a run neither the browser nor the server kept: the same address makes no second monitor (#7059)", async () => {
    const first: { unmount: () => void } = await renderSetup();
    await checkAddress("acme.example");

    expect(api["createMonitor"]).toHaveBeenCalledTimes(1);
    const made: string = serverMonitors[0]!.id;

    // Gone from both: the monitor stays, but nothing says it is this run's.
    window.localStorage.clear();
    guidedSetupRunServer.reset();
    act(() => {
      first.unmount();
    });
    await renderSetup();

    expect(stepState("check")).toBe("open");

    await checkAddress("https://acme.example");

    expect(api["createMonitor"]).toHaveBeenCalledTimes(1);
    expect(serverMonitors).toHaveLength(1);
    expect(storedRun()).toEqual({
      address: "https://acme.example",
      monitorId: made,
      monitorIsExisting: true,
    });
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

      /*
       * The page opened again: this browser kept nothing of the run, but
       * the server did (#7253) - the summary again, and nothing made.
       */
      const second: { unmount: () => void } = await (async (): Promise<{
        unmount: () => void;
      }> => {
        act(() => {
          first.unmount();
        });
        return await renderSetup();
      })();

      expect(screen.getByTestId("guided-setup-summary")).toBeInTheDocument();
      expect(api["createMonitor"]).toHaveBeenCalledTimes(1);

      // Then a run the server lost too: still no second monitor (#7059).
      guidedSetupRunServer.reset();
      act(() => {
        second.unmount();
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
    expect(storedRun()).toEqual({ address: "acme.example" });
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
    expect(storedRun()).toEqual({
      address: "acme.example",
      monitorId: serverMonitors[1]!.id,
    });
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
    expect(storedRun()).toEqual({
      address: "acme.example",
      monitorId: serverMonitors[0]!.id,
      monitorIsExisting: true,
    });
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
      "Project Owners are emailed about incidents nobody owns.",
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
/*
 * Beside the steps (#8897): what the setup sets up, ticked as it goes, and
 * about how long it takes - the same minutes Home's quickstart says beside
 * "Create your first monitor".
 */
describe("what it sets up, beside the steps", () => {
  test("a check around the clock, who is told and a test, the first one open, and about how long", async () => {
    await renderSetup();

    const aside: HTMLElement = screen.getByTestId(GUIDED_SETUP_ASIDE_TEST_ID);

    expect(
      Array.from(
        aside.querySelectorAll('[data-testid^="guided-setup-outcome-"]'),
      )
        .filter((item: Element): boolean => {
          return item.tagName === "LI";
        })
        .map((item: Element): string => {
          return (
            item.querySelector('[data-testid$="-text"]')?.textContent || ""
          );
        }),
    ).toEqual([
      "OneUptime checks your website or API around the clock.",
      "The right people are told when it goes down.",
      "A test page proves that a page reaches them.",
    ]);
    expect(screen.getByTestId("guided-setup-outcome-check")).toHaveAttribute(
      "data-state",
      "open",
    );
    expect(screen.getByTestId("guided-setup-outcome-test")).toHaveAttribute(
      "data-state",
      "upcoming",
    );
    expect(screen.getByTestId("guided-setup-minutes")).toHaveTextContent(
      new RegExp(
        `^About ${WELCOME_STEP_MINUTES[WelcomeStep.Monitor]}\\sminutes$`,
      ),
    );
  });

  test("the check ticks off once the monitor is made", async () => {
    keepRun({ monitorId: MONITOR_ID });

    await renderSetup();

    expect(screen.getByTestId("guided-setup-outcome-check")).toHaveAttribute(
      "data-state",
      "done",
    );
    expect(
      screen.getByTestId("guided-setup-outcome-who_is_told"),
    ).toHaveAttribute("data-state", "open");
  });
});

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
      "Ask a Project Owner to add a payment method before you start checking.",
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
    expect(storedRun()).toEqual({ address: "acme.example" });
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

  /*
   * "Keep the Free-plan billing truth, but make it calm and not the first
   * thing that blocks the first action" (#8897): it was a yellow warning
   * over the address field, the first thing on the page.
   */
  test("is said calmly, after the address it would check and right above Start checking", async () => {
    api["needsPaymentMethod"]!.mockResolvedValue(true);

    await renderSetup();

    const notice: HTMLElement = screen.getByTestId(
      "guided-setup-payment-needed",
    );
    const address: HTMLElement = screen.getByTestId("guided-setup-address");

    // The address comes first: the notice no longer stands over it.
    expect(
      address.compareDocumentPosition(notice) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen
        .getByTestId("guided-setup-is-api")
        .compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Right above the button it is about: nothing else in between.
    expect(notice.nextElementSibling).toContainElement(
      screen.getByTestId("guided-setup-start-checking"),
    );
    // Calm: a note, not a warning or an alert.
    expect(notice).toHaveAttribute("data-refused", "false");
    expect(notice).not.toHaveAttribute("role");
    expect(notice.className).toContain("bg-gray-50");
    expect(notice.className).not.toContain("amber");
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    // The field is still the one the cursor is in.
    expect(address).toHaveFocus();
  });

  test("a press refused for want of one says it louder, as the alert it now is", async () => {
    api["needsPaymentMethod"]!.mockResolvedValue(true);
    api["createMonitor"]!.mockRejectedValue(paymentRequired());

    await renderSetup();
    typeAddress("acme.example");
    await startChecking();

    const notice: HTMLElement = screen.getByTestId(
      "guided-setup-payment-needed",
    );

    expect(notice).toHaveAttribute("data-refused", "true");
    expect(notice).toHaveAttribute("role", "alert");
    expect(notice.className).toContain("bg-amber-50");
    expect(screen.getAllByRole("alert")).toEqual([notice]);
  });

  test("Check again after a refusal speaks calmly again while one is still needed", async () => {
    api["needsPaymentMethod"]!.mockResolvedValue(true);
    api["createMonitor"]!.mockRejectedValue(paymentRequired());

    await renderSetup();
    typeAddress("acme.example");
    await startChecking();

    expect(screen.getByTestId("guided-setup-payment-needed")).toHaveAttribute(
      "data-refused",
      "true",
    );

    await press("guided-setup-check-payment-again");

    expect(screen.getByTestId("guided-setup-payment-needed")).toHaveAttribute(
      "data-refused",
      "false",
    );
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
      expect(policyNote()).toBe(POLICY_NOTE);
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
      expect(region).toHaveTextContent(WHO_CREATE_HELP);
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

/*
 * A PROJECT THAT PAGES PEOPLE ALREADY (#7055): its rules decide who is
 * paged, and the summary says who they page for this monitor - When this
 * goes down's own words, from the resolver the monitor's overview reads -
 * rather than only that the project's rules decide.
 */
describe("a project that pages people already: the summary names who is told", () => {
  const finishedRun: () => void = (): void => {
    api["loadWhoIsToldFacts"]!.mockResolvedValue({
      policyCount: 1,
      incidentRuleCount: 1,
      alertRuleCount: 1,
      mayCreatePolicy: true,
      mayAddEscalationRules: true,
      mayAddRules: true,
    });
    keepRun({
      monitorId: MONITOR_ID,
      whoIsToldConfirmed: true,
      testExecutionLogId: "log-1",
    });
  };

  test("who its rules page, after what opens: the owners emailed and the people paged", async () => {
    finishedRun();
    await renderSetup();

    await waitFor(() => {
      expect(
        screen.getByTestId("guided-setup-summary-who_is_told"),
      ).toHaveTextContent(
        "It emails the Project Owners (Ada Lovelace). It pages Grace Hopper through Platform on-call.",
      );
    });
    // What opens is the row above's, not said twice.
    expect(
      screen.getByTestId("guided-setup-summary-who_is_told"),
    ).not.toHaveTextContent("opens an incident");
    expect(
      screen.getByTestId("guided-setup-summary-who_is_told"),
    ).not.toHaveTextContent(
      "This project's on-call policies and rules decide who is paged.",
    );
    const asked: { monitorId: ObjectID } = getWhoIsToldMock.mock
      .calls[0]![0] as { monitorId: ObjectID };

    expect(asked.monitorId.toString()).toBe(MONITOR_ID);
  });

  test("a read that fails says what it always said: the project's rules decide", async () => {
    getWhoIsToldMock.mockRejectedValue(new Error("Gateway Timeout"));
    finishedRun();
    await renderSetup();

    await waitFor(() => {
      expect(
        screen.getByTestId("guided-setup-summary-who_is_told"),
      ).toHaveTextContent(
        "This project's on-call policies and rules decide who is paged.",
      );
    });
  });

  test("a run whose own policy pages is not asked: the policy it made says who", async () => {
    keepRun({
      monitorId: MONITOR_ID,
      policyId: POLICY_ID,
      testExecutionLogId: "log-1",
    });
    await renderSetup();

    await waitFor(() => {
      expect(
        screen.getByTestId("guided-setup-summary-who_is_told"),
      ).toHaveTextContent('"Default on-call policy" pages Ada Lovelace');
    });
    expect(getWhoIsToldMock).not.toHaveBeenCalled();
  });
});

// A Dashboard page's address in this project, as the page builds it.
const routeTo: (page: PageMap, modelId?: string) => string = (
  page: PageMap,
  modelId?: string,
): string => {
  return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
    modelId: modelId,
  }).toString();
};

// The defined terms a part of the page marks, by their Glossary anchor.
const markedTerms: (element: HTMLElement) => Array<string> = (
  element: HTMLElement,
): Array<string> => {
  return Array.from(
    element.querySelectorAll('[data-testid="defined-term"]'),
  ).map((term: Element): string => {
    return term.getAttribute("data-glossary-term") || "";
  });
};

/*
 * A part's words as drawn, isolate marks out and the no-break space that
 * holds a number to its unit ("5 minutes") read as a space.
 */
const textOf: (testId: string) => string = (testId: string): string => {
  return withoutIsolateMarks(
    screen.getByTestId(testId).textContent || "",
  ).replace(/[\u00A0\u202F]/g, " ");
};

/*
 * STEP 1 SAYS FROM HOW MANY LOCATIONS (#7461): it promised "several
 * locations" on a server with one probe. The number is the probes a new
 * monitor starts with, read before anything is made.
 */
describe("1. From how many locations it is checked (#7461)", () => {
  test("a server with one probe: from 1 location, never several", async () => {
    api["loadDefaultLocationCount"]!.mockResolvedValue(1);
    await renderSetup();

    // The regression (#7461): what the open step says, whatever draws it.
    expect(textOf("guided-setup-step-check-content")).toContain(
      "from 1 location.",
    );
    expect(textOf("guided-setup-step-check-content")).not.toMatch(/several/i);
    expect(textOf("guided-setup-check-help")).toBe(
      "OneUptime makes a monitor that checks it every 5 minutes from 1 location. An incident opens when that location finds it down: no answer, or an answer with an error.",
    );
    expect(textOf("guided-setup-check-help")).not.toMatch(/several/i);
  });

  test("three probes: from 3 locations, and all of them must find it down", async () => {
    api["loadDefaultLocationCount"]!.mockResolvedValue(3);
    await renderSetup();

    expect(textOf("guided-setup-check-help")).toBe(
      "OneUptime makes a monitor that checks it every 5 minutes from 3 locations. An incident opens when all of them find it down: no answer, or an answer with an error.",
    );
  });

  test("a number that could not be read: none is said, and nothing is guessed", async () => {
    api["loadDefaultLocationCount"]!.mockResolvedValue(null);
    await renderSetup();

    expect(textOf("guided-setup-check-help")).toBe(
      "OneUptime makes a monitor that checks it every 5 minutes. An incident opens when every location that checks it finds it down: no answer, or an answer with an error.",
    );
  });

  test("the number and the first check agree", async () => {
    await renderSetup();

    expect(textOf("guided-setup-check-help")).toContain("from 2 locations");

    typeAddress("acme.example");
    await startChecking();

    await waitFor(() => {
      expect(screen.getByTestId("guided-setup-first-check")).toHaveTextContent(
        "from 2 locations",
      );
    });
  });

  test("read only while step 1 is the one to do", async () => {
    keepRun({ monitorId: MONITOR_ID });
    await renderSetup();

    expect(api["loadDefaultLocationCount"]).not.toHaveBeenCalled();
  });

  test("Check another address reads it again", async () => {
    keepRun({
      monitorId: MONITOR_ID,
      policyId: POLICY_ID,
      testExecutionLogId: "log-1",
    });
    await renderSetup();
    api["loadDefaultLocationCount"]!.mockResolvedValue(1);
    await press("guided-setup-start-over");

    await waitFor(() => {
      expect(textOf("guided-setup-check-help")).toContain("from 1 location.");
    });
  });
});

/*
 * THE GLOSSARY'S WORDS (#7057): monitor and incident where step 1 first
 * says them, on-call policy where step 2 makes one - three on the page,
 * each once. The step-by-step guide beside the progress line is the
 * setup's Learn more.
 */
describe("the Glossary's words, marked where the setup first uses them (#7057)", () => {
  test("monitor and incident in step 1's help", async () => {
    await renderSetup();

    expect(markedTerms(screen.getByTestId("guided-setup-check-help"))).toEqual([
      "monitor",
      "incident",
    ]);
  });

  test("on-call policy where step 2 says it makes one", async () => {
    await toWhoIsTold();

    expect(
      markedTerms(screen.getByTestId("guided-setup-who-policy-note")),
    ).toEqual(["on-call-policy"]);
    // Each word once: step 1 is folded to its line now.
    expect(markedTerms(screen.getByTestId("guided-setup"))).toEqual([
      "on-call-policy",
    ]);
  });

  test("the marked words read as the sentence: one word each, nothing added", async () => {
    await renderSetup();

    const words: Array<string> = Array.from(
      screen
        .getByTestId("guided-setup-check-help")
        .querySelectorAll('[data-testid="defined-term"]'),
    ).map((term: Element): string => {
      return term.textContent || "";
    });

    expect(words).toEqual(["monitor", "incident"]);
  });
});

/*
 * HOW TO REACH ME, ONE CLICK AWAY (#7757): step 2 named it as a place
 * nobody could find. It links the person's own, in a new tab, so the
 * setup keeps its place and the people picked.
 */
describe("2. How to Reach Me, one click away (#7757)", () => {
  test("links the person's own How to Reach Me, in a new tab", async () => {
    await toWhoIsTold();

    // The regression (#7757): the words were there, as plain text.
    const link: HTMLElement = within(
      screen.getByTestId("guided-setup-step-who_is_told-content"),
    ).getByRole("link", { name: "How to Reach Me" });

    expect(link).toBe(screen.getByTestId("guided-setup-how-to-reach-me"));

    expect(link.tagName).toBe("A");
    expect(link).toHaveTextContent("How to Reach Me");
    expect(link).toHaveAttribute(
      "href",
      routeTo(PageMap.USER_SETTINGS_ON_CALL_RULES),
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(textOf("guided-setup-who-create-help")).toBe(WHO_CREATE_HELP);
  });

  test("opening it leaves the step as it was: nothing saved, the people kept", async () => {
    await toWhoIsTold();
    await act(async () => {
      fireEvent.click(screen.getByText("Add Grace and Platform"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("guided-setup-how-to-reach-me"));
    });

    expect(stepState("who_is_told")).toBe("open");
    expect(api["createPolicy"]).not.toHaveBeenCalled();
    expect(screen.getByTestId("picked")).toHaveTextContent("user-grace");
  });
});

/*
 * A MONITOR SOMEONE ELSE MADE ALREADY CHECKS THE ADDRESS (#7254): a
 * teammate's, or one the API, Terraform or an import made. Said before
 * anything is made, never taken over, and never one the person may not
 * read.
 */
describe("1. A monitor someone else made already checks the address (#7254)", () => {
  const GRACES_MONITOR_ID: string = "50000000-0000-4000-8000-000000000099";

  const gracesMonitor: (creatorName?: string) => {
    id: string;
    name: string;
    creatorName: string;
    isOwn: boolean;
    record: WebsiteDownMonitorRecord;
  } = (
    creatorName: string = "Grace Hopper",
  ): {
    id: string;
    name: string;
    creatorName: string;
    isOwn: boolean;
    record: WebsiteDownMonitorRecord;
  } => {
    return {
      id: GRACES_MONITOR_ID,
      name: "Acme storefront",
      creatorName: creatorName,
      isOwn: false,
      record: { ...MONITOR, id: GRACES_MONITOR_ID, name: "Acme storefront" },
    };
  };

  const checkTeammatesAddress: () => Promise<void> =
    async (): Promise<void> => {
      api["findOtherMonitor"]!.mockResolvedValue(gracesMonitor());
      await renderSetup();
      typeAddress("acme.example");
      await startChecking();
    };

  test("said before anything is made: its name, who made it, and the two ways on", async () => {
    await checkTeammatesAddress();

    expect(api["createMonitor"]).not.toHaveBeenCalled();
    expect(storedRun()).toEqual({ address: "acme.example" });
    expect(stepState("check")).toBe("open");
    expect(textOf("guided-setup-other-monitor-sentence")).toBe(
      'The monitor "Acme storefront" already checks this address. Grace Hopper made it.',
    );
    expect(screen.getByTestId("guided-setup-other-monitor")).toHaveTextContent(
      WEBSITE_DOWN_COPY.otherMonitorChoice,
    );
    expect(screen.getByTestId("guided-setup-other-monitor")).toHaveAttribute(
      "aria-live",
      "polite",
    );

    const open: HTMLElement = screen.getByTestId(
      "guided-setup-open-other-monitor",
    );

    expect(open).toHaveTextContent(WEBSITE_DOWN_COPY.nextMonitor);
    expect(open).toHaveAttribute(
      "href",
      routeTo(PageMap.MONITOR_VIEW, GRACES_MONITOR_ID),
    );
    expect(open).toHaveAttribute("target", "_blank");
    expect(
      screen.getByTestId("guided-setup-create-own-monitor"),
    ).toHaveTextContent(WEBSITE_DOWN_COPY.createOwnMonitor);
    // Start checking would only say it again.
    expect(screen.queryByTestId("guided-setup-start-checking")).toBeNull();
  });

  test("looked for only after this person's own, with the address typed and who they are", async () => {
    await checkTeammatesAddress();

    expect(api["findOtherMonitor"]).toHaveBeenCalledWith({
      address: {
        url: "https://acme.example",
        host: "acme.example",
        monitorName: "acme.example",
      },
      userId: USER_ID,
    });
    expect(api["findOwnMonitor"]!.mock.invocationCallOrder[0]!).toBeLessThan(
      api["findOtherMonitor"]!.mock.invocationCallOrder[0]!,
    );
  });

  test("one the API, Terraform or an import made: its name, and nobody named", async () => {
    api["findOtherMonitor"]!.mockResolvedValue(gracesMonitor(""));
    await renderSetup();
    typeAddress("acme.example");
    await startChecking();

    expect(textOf("guided-setup-other-monitor-sentence")).toBe(
      'The monitor "Acme storefront" already checks this address.',
    );
  });

  test("Create my own monitor makes one beside it, once, and the setup goes on with it", async () => {
    await checkTeammatesAddress();
    await press("guided-setup-create-own-monitor");

    expect(api["createMonitor"]).toHaveBeenCalledTimes(1);
    // The teammate's is not asked about again: the person chose.
    expect(api["findOtherMonitor"]).toHaveBeenCalledTimes(1);
    expect(storedRun()).toEqual({
      address: "acme.example",
      monitorId: MONITOR_ID,
    });
    expect(screen.queryByTestId("guided-setup-other-monitor")).toBeNull();
    expect(screen.queryByTestId("guided-setup-existing-monitor")).toBeNull();
    await waitFor(() => {
      expect(screen.getByTestId("guided-setup-first-check")).toHaveTextContent(
        "acme.example answered 200",
      );
    });
  });

  test("Open the monitor makes nothing: the teammate's monitor is never this run's", async () => {
    await checkTeammatesAddress();
    await act(async () => {
      fireEvent.click(screen.getByTestId("guided-setup-open-other-monitor"));
    });

    expect(api["createMonitor"]).not.toHaveBeenCalled();
    expect(api["ensureMonitorOwner"]).not.toHaveBeenCalled();
    expect(storedRun()).toEqual({ address: "acme.example" });
  });

  test("this person's own wins: theirs is used, and the project's are not asked", async () => {
    api["findOwnMonitor"]!.mockResolvedValue(MONITOR);
    await renderSetup();
    typeAddress("acme.example");
    await startChecking();

    expect(api["findOtherMonitor"]).not.toHaveBeenCalled();
    expect(api["createMonitor"]).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("guided-setup-existing-monitor"),
    ).toBeInTheDocument();
  });

  test("one of theirs the project's read found is theirs: the setup goes on with it", async () => {
    api["findOtherMonitor"]!.mockResolvedValue({
      ...gracesMonitor("Ada Lovelace"),
      isOwn: true,
      record: MONITOR,
    });
    await renderSetup();
    typeAddress("acme.example");
    await startChecking();

    expect(api["createMonitor"]).not.toHaveBeenCalled();
    expect(storedRun()).toEqual({
      address: "acme.example",
      monitorId: MONITOR_ID,
      monitorIsExisting: true,
    });
    expect(
      screen.getByTestId("guided-setup-existing-monitor"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("guided-setup-other-monitor")).toBeNull();
  });

  /*
   * A monitor the person may not read is never handed to the page: the
   * server leaves it out of the list (WebsiteDownApi.findOtherMonitor), so
   * the look-up finds none and nothing says one exists.
   */
  test("a monitor this person may not read is never mentioned, not even that one exists", async () => {
    api["findOtherMonitor"]!.mockResolvedValue(null);
    await renderSetup();
    typeAddress("acme.example");
    await startChecking();

    expect(screen.queryByTestId("guided-setup-other-monitor")).toBeNull();
    expect(document.body.textContent).not.toContain("already checks");
    expect(api["createMonitor"]).toHaveBeenCalledTimes(1);
  });

  test("another address forgets it: Start checking comes back", async () => {
    await checkTeammatesAddress();
    typeAddress("status.acme.example");

    expect(screen.queryByTestId("guided-setup-other-monitor")).toBeNull();
    expect(
      screen.getByTestId("guided-setup-start-checking"),
    ).toBeInTheDocument();
  });

  test("a look-up that fails makes nothing on a guess, says why, and the step stays open", async () => {
    api["findOtherMonitor"]!.mockRejectedValue(new Error("offline"));
    await renderSetup();
    typeAddress("acme.example");
    await startChecking();

    expect(api["createMonitor"]).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(stepState("check")).toBe("open");
  });
});

/*
 * WHAT NEXT, EACH FOR WHOEVER MAY DO IT: paging by SMS or phone opens the
 * on-call guided setup (#7370), and a project with no status page is
 * offered the status page setup with this monitor ticked (#7053).
 */
describe("the summary's what next, each for whoever may do it (#7370, #7053)", () => {
  const toSummary: () => Promise<void> = async (): Promise<void> => {
    keepRun({
      monitorId: MONITOR_ID,
      policyId: POLICY_ID,
      testExecutionLogId: "log-1",
    });
    await renderSetup();
    expect(screen.getByTestId("guided-setup-summary")).toBeInTheDocument();
  };

  test("Get paged by SMS or phone call opens the on-call guided setup, saying where from", async () => {
    await toSummary();

    // The regression (#7370): the same words opened Notification Methods.
    const link: HTMLElement = screen
      .getByText(WEBSITE_DOWN_COPY.nextPhone)
      .closest("a")!;

    expect(link).toHaveAttribute(
      "href",
      `${routeTo(PageMap.ON_CALL_DUTY_GUIDED_SETUP)}?from=website_down_summary`,
    );
    expect(link).toBe(screen.getByTestId("guided-setup-next-phone"));
    expect(link).toHaveTextContent(WEBSITE_DOWN_COPY.nextPhone);
  });

  test("someone who may not create an on-call policy adds a number to their notification methods", async () => {
    mayUseOnCallSetup = false;
    await toSummary();

    expect(screen.getByTestId("guided-setup-next-phone")).toHaveAttribute(
      "href",
      routeTo(PageMap.USER_SETTINGS_NOTIFICATION_METHODS),
    );
  });

  test("no status page yet: the status page setup, with this monitor ticked", async () => {
    await toSummary();

    const link: HTMLElement = screen.getByTestId(
      "guided-setup-next-status-page",
    );

    expect(link).toHaveTextContent(WEBSITE_DOWN_COPY.nextStatusPage);
    expect(link).toHaveAttribute(
      "href",
      `${routeTo(PageMap.STATUS_PAGES_GUIDED_SETUP)}?monitorId=${MONITOR_ID}&from=website_down_summary`,
    );
    expect(
      screen.queryByTestId("guided-setup-next-open-status-page"),
    ).toBeNull();
  });

  test("someone who may not make a status page is not offered its setup", async () => {
    mayCreateStatusPage = false;
    await toSummary();

    expect(screen.queryByTestId("guided-setup-next-status-page")).toBeNull();
    expect(screen.getByTestId("guided-setup-next-phone")).toBeInTheDocument();
  });

  test("the monitor's own page, as before", async () => {
    await toSummary();

    expect(
      screen.getByText(WEBSITE_DOWN_COPY.nextMonitor).closest("a"),
    ).toHaveAttribute("href", routeTo(PageMap.MONITOR_VIEW, MONITOR_ID));
  });
});

/*
 * STEP 4, SHOW IT TO CUSTOMERS? (#7053): optional, and only where it can
 * be done - someone who may put a monitor on a status page, in a project
 * with one. A project with none keeps three steps, so a newcomer's job is
 * no longer.
 */
describe("4. Show it to customers? (#7053)", () => {
  const PAGES: Array<{ id: string; name: string }> = [
    { id: "70000000-0000-4000-8000-000000000001", name: "Acme Status" },
    { id: "70000000-0000-4000-8000-000000000002", name: "Internal Status" },
  ];

  const tested: Record<string, unknown> = {
    monitorId: MONITOR_ID,
    policyId: POLICY_ID,
    testExecutionLogId: "log-1",
  };

  const toStatusPageStep: () => Promise<void> = async (): Promise<void> => {
    api["loadStatusPages"]!.mockResolvedValue(PAGES);
    keepRun(tested);
    await renderSetup();
    expect(stepState("status_page")).toBe("open");
  };

  test("a project with a status page: a fourth step after the test, and the summary waits for it", async () => {
    await toStatusPageStep();

    expect(screen.getByTestId("guided-setup-progress")).toHaveTextContent(
      "3 of 4 steps done",
    );
    expect(
      screen.getByText(WEBSITE_DOWN_COPY.statusPageTitle),
    ).toBeInTheDocument();
    expect(textOf("guided-setup-step-status_page-content")).toContain(
      'Add "acme.example" to a status page, so your customers see when it is down.',
    );
    expect(
      screen.getByTestId("guided-setup-outcome-status_page"),
    ).toHaveTextContent(WEBSITE_DOWN_COPY.statusPageOutcome);
    expect(screen.queryByTestId("guided-setup-summary")).toBeNull();
    expect(api["loadStatusPages"]).toHaveBeenCalledTimes(1);
  });

  test("optional: the setup was finished at the acknowledged test", async () => {
    await toStatusPageStep();

    expect(sent(ProductEventName.GuidedSetupFinished)).toHaveLength(1);
  });

  test("Add to status page puts it on the page picked, and the summary says so, with its link", async () => {
    await toStatusPageStep();
    await press("guided-setup-status-page-add");

    expect(api["addToStatusPage"]).toHaveBeenCalledWith({
      statusPageId: PAGES[0]!.id,
      monitorId: MONITOR_ID,
      monitorName: "acme.example",
    });
    expect(storedRun()).toEqual({ ...tested, statusPageId: PAGES[0]!.id });
    expect(stepState("status_page")).toBe("done");
    expect(textOf("guided-setup-step-status_page-done-line")).toBe(
      '"Acme Status" shows it to your customers.',
    );
    expect(textOf("guided-setup-summary-status_page")).toContain(
      '"Acme Status" shows it to your customers.',
    );

    const open: HTMLElement = screen.getByTestId(
      "guided-setup-next-open-status-page",
    );

    expect(open).toHaveTextContent(WEBSITE_DOWN_COPY.nextOpenStatusPage);
    expect(open).toHaveAttribute(
      "href",
      `${STATUS_PAGE_URL.toString()}/${PAGES[0]!.id}`,
    );
    expect(open).toHaveAttribute("target", "_blank");
    // On a page already: its setup is not offered.
    expect(screen.queryByTestId("guided-setup-next-status-page")).toBeNull();
  });

  /*
   * #10646: the picker offered the first 100 pages read by name, archived
   * ones among them, so a page past them could not be picked. It searches
   * the project's live pages on the server as it is typed in.
   */
  test("another page picked, found by the picker's search past the first pages read: the monitor goes on that one", async () => {
    const LATE_PAGE: { id: string; name: string } = {
      id: "70000000-0000-4000-8000-000000000099",
      name: "Zulu Status",
    };
    const searches: Array<{ query: Record<string, unknown> }> = [];

    jest.spyOn(ModelAPI, "getList").mockImplementation((async (args: {
      modelType: unknown;
      query: Record<string, unknown>;
    }) => {
      searches.push({ query: args.query });

      const data: Array<StatusPage> =
        args.modelType === StatusPage
          ? [...PAGES, LATE_PAGE].map(
              (page: { id: string; name: string }): StatusPage => {
                return Object.assign(new StatusPage(), {
                  _id: page.id,
                  name: page.name,
                });
              },
            )
          : [];

      return { data: data, count: data.length, skip: 0, limit: 50 };
    }) as unknown as typeof ModelAPI.getList);

    await toStatusPageStep();

    // The picker starts on the first page by name, as it always has.
    const value: HTMLElement = within(
      screen.getByTestId("guided-setup-step-status_page-content"),
    ).getByTestId("entity-dropdown-value");

    expect(value).toHaveTextContent("Acme Status");

    await act(async () => {
      fireEvent.click(within(value).getAllByRole("button")[0]!);
    });

    const option: HTMLElement = await screen.findByRole("option", {
      name: /Zulu Status/,
    });

    // Live pages only: an archived page is offline.
    expect(searches[searches.length - 1]!.query["isArchived"]).toBe(false);

    await act(async () => {
      fireEvent.click(option);
    });
    await press("guided-setup-status-page-add");

    expect(api["addToStatusPage"]).toHaveBeenCalledWith({
      statusPageId: LATE_PAGE.id,
      monitorId: MONITOR_ID,
      monitorName: "acme.example",
    });
    expect(textOf("guided-setup-step-status_page-done-line")).toBe(
      '"Zulu Status" shows it to your customers.',
    );
  });

  test("Not now: nothing is added, the summary opens, and it stays so on return", async () => {
    await toStatusPageStep();
    await press("guided-setup-status-page-not-now");

    expect(api["addToStatusPage"]).not.toHaveBeenCalled();
    expect(storedRun()).toEqual({ ...tested, statusPageSkipped: true });
    expect(stepState("status_page")).toBe("done");
    expect(textOf("guided-setup-step-status_page-done-line")).toBe("Not now");
    expect(screen.getByTestId("guided-setup-summary")).toBeInTheDocument();
    expect(screen.queryByTestId("guided-setup-summary-status_page")).toBeNull();

    cleanup();
    await renderSetup();

    expect(stepState("status_page")).toBe("done");
    expect(screen.getByTestId("guided-setup-summary")).toBeInTheDocument();
  });

  test("a monitor a page shows already: the step is done, and nothing is added twice", async () => {
    api["loadStatusPages"]!.mockResolvedValue(PAGES);
    api["findStatusPageShowing"]!.mockResolvedValue(PAGES[1]);
    keepRun(tested);
    await renderSetup();

    expect(stepState("status_page")).toBe("done");
    expect(textOf("guided-setup-step-status_page-done-line")).toBe(
      '"Internal Status" shows it to your customers.',
    );
    expect(api["addToStatusPage"]).not.toHaveBeenCalled();
    expect(api["findStatusPageShowing"]).toHaveBeenCalledWith({
      monitorId: MONITOR_ID,
      statusPages: PAGES,
      preferredStatusPageId: undefined,
    });
  });

  test("on return, the run's page is read first; one that no longer shows it opens the step again", async () => {
    api["loadStatusPages"]!.mockResolvedValue(PAGES);
    keepRun({ ...tested, statusPageId: PAGES[1]!.id });
    await renderSetup();

    expect(api["findStatusPageShowing"]).toHaveBeenCalledWith({
      monitorId: MONITOR_ID,
      statusPages: PAGES,
      preferredStatusPageId: PAGES[1]!.id,
    });
    expect(stepState("status_page")).toBe("open");
  });

  test("a page it could not be added to: says why, and the step stays open", async () => {
    api["addToStatusPage"]!.mockRejectedValue(
      new Error("Status page not found."),
    );
    await toStatusPageStep();
    await press("guided-setup-status-page-add");

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Status page not found.",
    );
    expect(stepState("status_page")).toBe("open");
    expect(storedRun()).toEqual(tested);
  });

  test("skipping the test leads to it too", async () => {
    api["loadStatusPages"]!.mockResolvedValue(PAGES);
    await toTest();
    await press("guided-setup-skip-test");

    expect(stepState("status_page")).toBe("open");
  });

  test("a monitor of theirs found at step 1 that a page shows: step 4 done before it is reached", async () => {
    api["loadStatusPages"]!.mockResolvedValue(PAGES);
    api["findOwnMonitor"]!.mockResolvedValue(MONITOR);
    api["findStatusPageShowing"]!.mockResolvedValue(PAGES[0]);
    await renderSetup();
    typeAddress("acme.example");
    await startChecking();

    expect(api["findStatusPageShowing"]).toHaveBeenCalledWith({
      monitorId: MONITOR_ID,
      statusPages: PAGES,
    });
  });

  test("someone who may not put a monitor on a status page: three steps, and no page is read", async () => {
    mayAddToStatusPage = false;
    api["loadStatusPages"]!.mockResolvedValue(PAGES);
    keepRun(tested);
    await renderSetup();

    expect(api["loadStatusPages"]).not.toHaveBeenCalled();
    expect(screen.queryByTestId("guided-setup-step-status_page")).toBeNull();
    expect(screen.getByTestId("guided-setup-progress")).toHaveTextContent(
      "3 of 3 steps done",
    );
    expect(screen.getByTestId("guided-setup-summary")).toBeInTheDocument();
  });

  test("a project with no status page: three steps, so the job is no longer", async () => {
    keepRun(tested);
    await renderSetup();

    expect(screen.queryByTestId("guided-setup-step-status_page")).toBeNull();
    expect(screen.getByTestId("guided-setup-summary")).toBeInTheDocument();
  });

  test("status pages that cannot be read: no fourth step, as no page would", async () => {
    api["loadStatusPages"]!.mockRejectedValue(new Error("offline"));
    keepRun(tested);
    await renderSetup();

    expect(screen.queryByTestId("guided-setup-step-status_page")).toBeNull();
    expect(screen.getByTestId("guided-setup-summary")).toBeInTheDocument();
  });
});

/*
 * WHAT THE SETUP MAKES, AS IT MAKES IT (#10276): "when a monitor is created,
 * I should see the resource being created ... the same with the on-call
 * policy". The panel beside the steps lists each record under the step that
 * makes it, with how it is getting on, and the run keeps it on the server
 * (#7253), so another device draws the same panel.
 */
describe("the records it makes, beside the steps (#10276)", () => {
  const resourceStatus: (key: string) => string | null = (
    key: string,
  ): string | null => {
    return screen
      .getByTestId(`guided-setup-resource-${key}`)
      .getAttribute("data-status");
  };

  test("before anything is made: the monitor, the policy with its rule and rules, and the test page, each waiting", async () => {
    await renderSetup();

    for (const key of [
      "monitor",
      "on_call_policy",
      "escalation_rule",
      "on_call_rules",
      "test_page",
    ]) {
      expect(resourceStatus(key)).toBe("waiting");
    }

    // The monitor is named as it will be while the address is typed.
    typeAddress("https://acme.example/status");

    expect(
      screen.getByTestId("guided-setup-resource-monitor-name"),
    ).toHaveTextContent("acme.example");
  });

  test("the monitor is made: Created, with how often it is checked and Open in a new tab", async () => {
    await renderSetup();
    typeAddress("acme.example");
    await startChecking();

    expect(resourceStatus("monitor")).toBe("created");
    expect(
      screen.getByTestId("guided-setup-resource-monitor-detail"),
    ).toHaveTextContent("Every 5 minutes");
    expect(
      screen.getByTestId("guided-setup-resource-monitor-open"),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/monitors/${MONITOR_ID}`,
    );
    expect(
      screen.getByTestId("guided-setup-resource-monitor-open"),
    ).toHaveAttribute("target", "_blank");

    // Kept on the server, with what it made and how (#7253).
    await waitFor(() => {
      expect(guidedSetupRunServer.valuesOf("website_down")).toEqual({
        address: "acme.example",
        monitorId: MONITOR_ID,
      });
    });
    expect(guidedSetupRunServer.resourcesOf("website_down")).toMatchObject({
      monitor: {
        status: "created",
        recordId: MONITOR_ID,
        name: "acme.example",
      },
    });
  });

  test("a monitor found rather than made is In use, never Created", async () => {
    api["findOwnMonitor"]!.mockResolvedValue({
      ...MONITOR,
      id: MONITOR_ID,
    });
    await renderSetup();
    typeAddress("acme.example");
    await startChecking();

    expect(resourceStatus("monitor")).toBe("existing");
    expect(api["createMonitor"]).not.toHaveBeenCalled();
  });

  test("a monitor that could not be made: the panel says why, and Try again makes it - once", async () => {
    api["createMonitor"]!.mockRejectedValueOnce(
      new Error("OneUptime is busy and could not save this."),
    );
    await renderSetup();
    typeAddress("acme.example");
    await startChecking();

    expect(resourceStatus("monitor")).toBe("failed");
    expect(
      screen.getByTestId("guided-setup-resource-monitor-error"),
    ).toHaveTextContent("OneUptime is busy and could not save this.");
    await waitFor(() => {
      expect(guidedSetupRunServer.resourcesOf("website_down")).toMatchObject({
        monitor: {
          status: "failed",
          error: "OneUptime is busy and could not save this.",
        },
      });
    });

    await press("guided-setup-resource-monitor-retry");

    expect(api["createMonitor"]).toHaveBeenCalledTimes(2);
    expect(resourceStatus("monitor")).toBe("created");
    expect(
      screen.queryByTestId("guided-setup-resource-monitor-error"),
    ).toBeNull();
  });

  test("Try again after a create that worked but answered too late: the monitor made then is found, not made twice", async () => {
    // The server made it; the answer never arrived.
    api["createMonitor"]!.mockRejectedValueOnce(
      new Error("OneUptime could not be reached."),
    );
    await renderSetup();
    typeAddress("acme.example");
    await startChecking();

    expect(resourceStatus("monitor")).toBe("failed");

    // Tried again, the person's own monitor for the address is found.
    api["findOwnMonitor"]!.mockResolvedValue({ ...MONITOR, id: MONITOR_ID });
    await press("guided-setup-resource-monitor-retry");

    expect(api["createMonitor"]).toHaveBeenCalledTimes(1);
    // The setup goes on with it: its first check, and the panel's In use.
    expect(screen.getByTestId("guided-setup-first-check")).toBeInTheDocument();
    expect(resourceStatus("monitor")).toBe("existing");
    expect(storedRun()).toMatchObject({ monitorId: MONITOR_ID });
  });

  test("the policy, its first escalation rule and the rules that run it are made together, with a link to each", async () => {
    keepRun({ monitorId: MONITOR_ID });
    await renderSetup();
    await press("guided-setup-who-continue");

    expect(api["createPolicy"]).toHaveBeenCalledTimes(1);

    for (const key of ["on_call_policy", "escalation_rule", "on_call_rules"]) {
      expect(resourceStatus(key)).toBe("created");
    }

    expect(
      screen.getByTestId("guided-setup-resource-on_call_policy-name"),
    ).toHaveTextContent("Default on-call policy");
    expect(
      screen.getByTestId("guided-setup-resource-escalation_rule-detail"),
    ).toHaveTextContent("Pages Ada Lovelace first.");
    expect(
      screen.getByTestId("guided-setup-resource-on_call_policy-open"),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/on-call-duty/policies/${POLICY_ID}`,
    );
    expect(
      screen.getByTestId("guided-setup-resource-escalation_rule-open"),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/on-call-duty/policies/${POLICY_ID}/escalation`,
    );
  });

  test("a policy that could not be made: it says why, the two after it wait, and Try again makes one policy", async () => {
    keepRun({ monitorId: MONITOR_ID });
    api["createPolicy"]!.mockRejectedValueOnce(
      new Error("OneUptime is busy and could not save this."),
    );
    await renderSetup();
    await press("guided-setup-who-continue");

    expect(resourceStatus("on_call_policy")).toBe("failed");
    expect(resourceStatus("escalation_rule")).toBe("waiting");
    expect(resourceStatus("on_call_rules")).toBe("waiting");
    expect(stepState("who_is_told")).toBe("open");

    await press("guided-setup-resource-on_call_policy-retry");

    expect(api["createPolicy"]).toHaveBeenCalledTimes(2);
    expect(resourceStatus("on_call_policy")).toBe("created");
    expect(stepState("test")).toBe("open");
  });

  test("a project that pages people already: its own policies, In use, and nothing made", async () => {
    keepRun({ monitorId: MONITOR_ID });
    api["loadWhoIsToldFacts"]!.mockResolvedValue({
      policyCount: 1,
      incidentRuleCount: 1,
      alertRuleCount: 1,
      mayCreatePolicy: true,
      mayAddEscalationRules: true,
      mayAddRules: true,
    });
    await renderSetup();

    expect(resourceStatus("existing_policies")).toBe("existing");
    expect(
      screen.queryByTestId("guided-setup-resource-on_call_policy"),
    ).toBeNull();
  });

  test("the test page: Sent, then Acknowledged; skipped, Skipped", async () => {
    getResultMock.mockResolvedValue(result(OnCallTestPageStatus.Paging));
    keepRun({
      monitorId: MONITOR_ID,
      whoIsToldConfirmed: true,
      testExecutionLogId: "log-1",
    });
    await renderSetup();

    expect(resourceStatus("test_page")).toBe("creating");
    expect(
      screen.getByTestId("guided-setup-resource-test_page-status"),
    ).toHaveTextContent("Sent");

    await press("guided-setup-skip-test");

    expect(resourceStatus("test_page")).toBe("skipped");
  });

  test("a run only the server kept - another device's - opens at the step it was on, the panel with it (#7253)", async () => {
    guidedSetupRunServer.seed(
      "website_down",
      { address: "acme.example", monitorId: MONITOR_ID },
      {
        monitor: {
          status: GuidedSetupResourceStatus.Created,
          recordId: MONITOR_ID,
          name: "acme.example",
          at: "2026-11-20T10:00:00.000Z",
        },
      },
    );
    await renderSetup();

    expect(stepState("check")).toBe("done");
    expect(stepState("who_is_told")).toBe("open");
    expect(resourceStatus("monitor")).toBe("created");
    expect(api["createMonitor"]).not.toHaveBeenCalled();
  });

  test("a step that failed on another device opens on its address, with why and Try again (#7253)", async () => {
    guidedSetupRunServer.seed(
      "website_down",
      { address: "https://acme.example", isApi: true },
      {
        monitor: {
          status: GuidedSetupResourceStatus.Failed,
          name: "acme.example",
          error: "OneUptime is busy and could not save this.",
          at: "2026-11-20T10:00:00.000Z",
        },
      },
    );
    await renderSetup();

    expect(stepState("check")).toBe("open");
    expect(screen.getByTestId("guided-setup-address")).toHaveValue(
      "https://acme.example",
    );
    expect(resourceStatus("monitor")).toBe("failed");

    await press("guided-setup-resource-monitor-retry");

    expect(api["createMonitor"]).toHaveBeenCalledTimes(1);
    expect(api["createMonitor"]!.mock.calls[0]![0]).toMatchObject({
      isApi: true,
    });
    expect(resourceStatus("monitor")).toBe("created");
  });

  test("a monitor being made when its page closed, long ago: stopped, and Try again finds or makes it once", async () => {
    guidedSetupRunServer.seed(
      "website_down",
      { address: "acme.example" },
      {
        monitor: {
          status: GuidedSetupResourceStatus.Creating,
          name: "acme.example",
          at: "2020-01-01T00:00:00.000Z",
        },
      },
    );
    await renderSetup();

    expect(resourceStatus("monitor")).toBe("failed");
    expect(
      screen.getByTestId("guided-setup-resource-monitor-error"),
    ).toHaveTextContent(
      "This was being made when its page closed. Try again: nothing is made twice.",
    );
  });

  test("an address given by Ask AI wins over the one the run kept", async () => {
    guidedSetupRunServer.seed("website_down", {
      address: "https://older.example",
    });
    window.history.replaceState(
      {},
      "",
      `/dashboard/${PROJECT_ID}/monitors/setup?from=ask_ai&address=${encodeURIComponent("https://acme.example")}`,
    );

    try {
      await renderSetup();

      expect(screen.getByTestId("guided-setup-address")).toHaveValue(
        "https://acme.example",
      );
    } finally {
      window.history.replaceState(
        {},
        "",
        `/dashboard/${PROJECT_ID}/monitors/setup`,
      );
    }
  });

  test("Check another address starts afresh on the server too: another device opens step 1", async () => {
    keepRun({
      monitorId: MONITOR_ID,
      policyId: POLICY_ID,
      testExecutionLogId: "log-1",
    });
    await renderSetup();
    await press("guided-setup-start-over");

    await waitFor(() => {
      expect(guidedSetupRunServer.valuesOf("website_down")).toBeUndefined();
    });
    expect(resourceStatus("monitor")).toBe("waiting");
  });

  test("the panel says the run is saved to the person's account, and says so when it is not", async () => {
    await renderSetup();
    typeAddress("acme.example");
    await startChecking();

    await waitFor(() => {
      expect(screen.getByTestId("guided-setup-sync")).toHaveAttribute(
        "data-sync",
        "saved",
      );
    });

    guidedSetupRunServer.isDown = true;
    await press("guided-setup-check-continue");
    await press("guided-setup-who-continue");

    await waitFor(() => {
      expect(screen.getByTestId("guided-setup-sync")).toHaveAttribute(
        "data-sync",
        "not_saved",
      );
    });

    guidedSetupRunServer.isDown = false;
    await press("guided-setup-sync-retry");

    await waitFor(() => {
      expect(screen.getByTestId("guided-setup-sync")).toHaveAttribute(
        "data-sync",
        "saved",
      );
    });
    expect(guidedSetupRunServer.valuesOf("website_down")).toMatchObject({
      monitorId: MONITOR_ID,
      policyId: POLICY_ID,
    });
  });
});
