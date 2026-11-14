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
 * The on-call guided setup, step by step (issue #6805): from "how do you
 * reach me" to an acknowledged test page on one page. Each step saves real
 * records through the model API (mocked here at OnCallSetupApi): an owner
 * turns SMS and calls on in the step, anyone else is told who can, the
 * Cloud balance is said before any click, a self-hosted server without
 * Twilio says so, a new project gets one policy with its catch-all rules,
 * a project with policies starts from them, a second level or a repeat is
 * saved, the test page goes to the policy, coming back resumes with nothing
 * made twice, and the summary says only what the records say.
 */

const api: Record<string, MockFunction> = {};
const API_NAMES: Array<string> = [
  "loadMyReach",
  "loadProjectPhoneFacts",
  "turnOnPhoneChannels",
  "rechargeBalance",
  "addSmsNumber",
  "addCallNumber",
  "loadPolicyChoices",
  "createPolicy",
  "loadPolicy",
  "addToFirstLevel",
  "addEveryNewEventRules",
  "addSecondLevel",
  "setRepeat",
  "loadPolicyReadiness",
  "sendSetupReminders",
];

for (const name of API_NAMES) {
  api[name] = getJestMockFunction();
}

let maySecondLevel: boolean = true;

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/OnCall/OnCallSetupApi",
  () => {
    const calls: Record<string, (...args: Array<unknown>) => unknown> = {};

    for (const name of [
      "loadMyReach",
      "loadProjectPhoneFacts",
      "turnOnPhoneChannels",
      "rechargeBalance",
      "addSmsNumber",
      "addCallNumber",
      "loadPolicyChoices",
      "createPolicy",
      "loadPolicy",
      "addToFirstLevel",
      "addEveryNewEventRules",
      "addSecondLevel",
      "setRepeat",
      "loadPolicyReadiness",
      "sendSetupReminders",
    ]) {
      calls[name] = (...args: Array<unknown>): unknown => {
        return api[name]!(...args);
      };
    }

    return {
      __esModule: true,
      default: calls,
      maySecondEscalationLevel: (): boolean => {
        return maySecondLevel;
      },
    };
  },
);

let billingEnabled: boolean = true;

// A getter laid over the real module lets each test say (ActiveMonitorLimitNotice).
jest.mock("../../../UI/Config", () => {
  const mocked: Record<string, unknown> = {
    ...(jest.requireActual("../../../UI/Config") as Record<string, unknown>),
  };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return billingEnabled;
    },
  });

  return mocked;
});

let mayChangeChannels: boolean = true;
let mayAddBalance: boolean = true;
let marketplace: string | null = null;

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/ProjectNotificationChannels",
  () => {
    return {
      __esModule: true,
      canChangeProjectNotificationChannels: (): boolean => {
        return mayChangeChannels;
      },
      isKnownNotToChangeProjectNotificationChannels: (): boolean => {
        return !mayChangeChannels;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ProjectBalance/ProjectBalanceAccess",
  () => {
    return {
      __esModule: true,
      canAddProjectBalance: (): boolean => {
        return mayAddBalance;
      },
      getCurrentProjectBillingMarketplace: (): string | null => {
        return marketplace;
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
        target: { kind: string; policyId?: string };
        title?: string;
        onSent?: (id: string) => void;
      }) => {
        return (
          <button
            type="button"
            data-testid="send-test-page"
            data-target={props.target.kind}
            data-policy={props.target.policyId || ""}
            onClick={() => {
              props.onSent?.("log-1");
            }}
          >
            {props.title || "Test this policy"}
          </button>
        );
      },
    };
  },
);

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

// The code dialog: "type the code" is one press here.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/VerificationCodeModal",
  () => {
    return {
      __esModule: true,
      default: (props: {
        itemId: string;
        destination: string;
        onVerified: (result: Record<string, unknown>) => void;
        onClose: () => void;
      }) => {
        return (
          <div data-testid="verify-dialog" data-item={props.itemId}>
            <span>{props.destination}</span>
            <button
              type="button"
              data-testid="verify-code"
              onClick={() => {
                props.onVerified({ alsoVerifiedForCalls: 0 });
                props.onClose();
              }}
            >
              Verify
            </button>
          </div>
        );
      },
    };
  },
);

// The recharge dialog: its form is the real one's; here one press sends 20.
jest.mock("../../../UI/Components/FormModal/BasicFormModal", () => {
  return {
    __esModule: true,
    default: (props: {
      title: string;
      onSubmit: (item: Record<string, unknown>) => void;
      formProps: { error?: string };
    }) => {
      return (
        <div data-testid="recharge-dialog">
          <span>{props.title}</span>
          {props.formProps.error ? <p>{props.formProps.error}</p> : <></>}
          <button
            type="button"
            data-testid="recharge-submit"
            onClick={() => {
              props.onSubmit({ amount: 20 });
            }}
          >
            Recharge
          </button>
        </div>
      );
    },
  };
});

jest.mock("../../../UI/Components/PeoplePicker/LazyPeoplePicker", () => {
  return {
    __esModule: true,
    default: (props: {
      value: Record<string, Array<string>>;
      onChange: (value: Record<string, Array<string>>) => void;
      error?: string;
      dataTestId?: string;
    }) => {
      return (
        <div data-testid={props.dataTestId}>
          <span data-testid={`${props.dataTestId}-picked`}>
            {JSON.stringify(props.value)}
          </span>
          <button
            type="button"
            onClick={() => {
              props.onChange({
                user: [...(props.value["user"] || []), "user-ben"],
                team: ["team-platform"],
              });
            }}
          >
            {`Add Ben to ${props.dataTestId}`}
          </button>
          <button
            type="button"
            onClick={() => {
              props.onChange({});
            }}
          >
            {`Clear ${props.dataTestId}`}
          </button>
          {props.error ? <p>{props.error}</p> : <></>}
        </div>
      );
    },
  };
});

jest.mock("../../../UI/Components/Dropdown/Dropdown", () => {
  return {
    __esModule: true,
    default: (props: {
      options: Array<{ value: string; label: string }>;
      value?: { value: string };
      onChange: (value: string) => void;
      dataTestId?: string;
    }) => {
      return (
        <select
          data-testid={props.dataTestId}
          value={props.value?.value || ""}
          onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
            props.onChange(event.target.value);
          }}
        >
          {props.options.map((option: { value: string; label: string }) => {
            return (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            );
          })}
        </select>
      );
    },
  };
});

jest.mock("../../../UI/Components/RadioButtons/GroupRadioButtons", () => {
  return {
    __esModule: true,
    default: (props: {
      options: Array<{ value: string; title: string }>;
      initialValue?: string;
      onChange: (value: string) => void;
      dataTestId?: string;
    }) => {
      return (
        <div data-testid={props.dataTestId} data-value={props.initialValue}>
          {props.options.map((option: { value: string; title: string }) => {
            return (
              <button
                key={option.value}
                type="button"
                data-testid={`choice-${option.value}`}
                onClick={() => {
                  props.onChange(option.value);
                }}
              >
                {option.title}
              </button>
            );
          })}
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
let sendingStatus: unknown = null;

jest.mock("../../../UI/Utils/ServerSending", () => {
  return {
    __esModule: true,
    useServerCanSendEmail: () => {
      return canSendEmail;
    },
    useServerSendingStatus: () => {
      return sendingStatus;
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

import OnCallGuidedSetup from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/OnCall/OnCallGuidedSetup";
import { getGuidedSetupRunKey } from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/GuidedSetupProgress";
import {
  ON_CALL_SETUP_COPY,
  OnCallPolicyRecord,
} from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/OnCall/OnCallSetup";
import { ProductEventName } from "../../../Types/Analytics/ProductEvent";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import ObjectID from "../../../Types/ObjectID";
import {
  OnCallTestPageRecordKind,
  OnCallTestPageResult,
  OnCallTestPageStatus,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  ServerSendingChannel,
  ServerSendingState,
} from "../../../Types/ServerSending/ServerSendingStatus";
import ProjectUtil from "../../../UI/Utils/Project";
import UserUtil from "../../../UI/Utils/User";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

const PROJECT_ID: string = "65f00000-0000-4000-8000-000000006805";
const USER_ID: string = "40000000-0000-4000-8000-000000000001";
const POLICY_ID: string = "60000000-0000-4000-8000-000000000001";

const RUN_KEY: string = getGuidedSetupRunKey({
  setup: "on_call",
  projectId: PROJECT_ID,
  userId: USER_ID,
});

const EMAIL: {
  methodType: string;
  maskedIdentifier: string;
  isVerified: boolean;
} = {
  methodType: "Email",
  maskedIdentifier: "a***@acme.example",
  isVerified: true,
};

const policyRecord: (
  overrides?: Partial<OnCallPolicyRecord>,
) => OnCallPolicyRecord = (
  overrides?: Partial<OnCallPolicyRecord>,
): OnCallPolicyRecord => {
  return {
    id: POLICY_ID,
    name: "Default on-call policy",
    levels: [
      {
        id: "level-1",
        order: 1,
        escalateAfterInMinutes: 30,
        userIds: [USER_ID],
        names: ["Ana Lopez"],
        responderCount: 1,
      },
    ],
    repeatTimes: 0,
    incidentRuleCount: 1,
    alertRuleCount: 1,
    ...overrides,
  };
};

const ANA: {
  userId: string;
  name: string;
  isReachable: boolean;
  channels: Array<string>;
} = {
  userId: USER_ID,
  name: "Ana Lopez",
  isReachable: true,
  channels: ["Email", "SMS"],
};

const BEN: {
  userId: string;
  name: string;
  isReachable: boolean;
  channels: Array<string>;
} = {
  userId: "user-ben",
  name: "Ben Ito",
  isReachable: false,
  channels: [],
};

const result: (status: OnCallTestPageStatus) => OnCallTestPageResult = (
  status: OnCallTestPageStatus,
): OnCallTestPageResult => {
  return {
    executionLogId: "log-1",
    kind: "Policy",
    recordKind: OnCallTestPageRecordKind.Incident,
    severityName: "Critical",
    walksEscalation: false,
    status: status,
    statusMessage: "",
    startedAt: "2026-11-12T10:00:00.000Z",
    endsAt: "2099-11-12T10:15:00.000Z",
    acknowledgedByName:
      status === OnCallTestPageStatus.Acknowledged ? "Ana Lopez" : undefined,
    acknowledgedChannel:
      status === OnCallTestPageStatus.Acknowledged
        ? OnCallPageChannel.SMS
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

const renderSetup: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    render(<OnCallGuidedSetup />);
  });

  await waitFor(() => {
    expect(screen.getByTestId("guided-setup")).toBeInTheDocument();
  });
};

const stepState: (key: string) => string | null = (
  key: string,
): string | null => {
  return screen
    .getByTestId(`guided-setup-step-${key}`)
    .getAttribute("data-state");
};

const press: (testId: string) => Promise<void> = async (
  testId: string,
): Promise<void> => {
  await act(async () => {
    fireEvent.click(screen.getByTestId(testId));
  });
};

const pressText: (text: string) => Promise<void> = async (
  text: string,
): Promise<void> => {
  await act(async () => {
    fireEvent.click(screen.getByText(text));
  });
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

beforeEach(() => {
  window.localStorage.clear();
  billingEnabled = true;
  maySecondLevel = true;
  mayChangeChannels = true;
  mayAddBalance = true;
  marketplace = null;
  canSendEmail = true;
  sendingStatus = null;
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest.spyOn(ProjectUtil, "getCurrentPlan").mockReturnValue(PlanType.Growth);
  jest.spyOn(UserUtil, "getUserId").mockReturnValue(new ObjectID(USER_ID));
  jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(false);

  api["loadMyReach"]!.mockResolvedValue({
    isReachable: true,
    methods: [EMAIL],
  });
  api["loadProjectPhoneFacts"]!.mockResolvedValue({
    isSmsOn: true,
    isCallOn: true,
    balanceInUSDCents: 2000,
  });
  api["turnOnPhoneChannels"]!.mockResolvedValue(undefined);
  api["rechargeBalance"]!.mockResolvedValue(undefined);
  api["addSmsNumber"]!.mockResolvedValue({ id: "sms-1", isVerified: false });
  api["addCallNumber"]!.mockResolvedValue({ id: "call-1", isVerified: true });
  api["loadPolicyChoices"]!.mockResolvedValue({
    policies: [],
    mayCreatePolicy: true,
    mayAddRules: true,
    mayEditLevels: true,
  });
  api["createPolicy"]!.mockResolvedValue(POLICY_ID);
  api["loadPolicy"]!.mockResolvedValue(policyRecord());
  api["addToFirstLevel"]!.mockResolvedValue(undefined);
  api["addEveryNewEventRules"]!.mockResolvedValue(undefined);
  api["addSecondLevel"]!.mockResolvedValue(undefined);
  api["setRepeat"]!.mockResolvedValue(undefined);
  api["loadPolicyReadiness"]!.mockResolvedValue([ANA]);
  api["sendSetupReminders"]!.mockResolvedValue({
    "user-ben": { state: "sent", message: "" },
  });
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
  test("opens on how you are reached, with the whole job in view, and makes nothing", async () => {
    await renderSetup();

    expect(stepState("reach_you")).toBe("open");
    expect(stepState("who_else")).toBe("upcoming");
    expect(stepState("no_answer")).toBe("upcoming");
    expect(stepState("test")).toBe("upcoming");
    expect(screen.getByText("Who else is on call?")).toBeInTheDocument();
    expect(screen.getByText("What if nobody answers?")).toBeInTheDocument();
    expect(screen.getByText("Send a test page")).toBeInTheDocument();
    expect(api["createPolicy"]).not.toHaveBeenCalled();
    expect(api["turnOnPhoneChannels"]).not.toHaveBeenCalled();
  });

  test("sends started and the first step reached, as on_call", async () => {
    await renderSetup();

    expect(sent(ProductEventName.GuidedSetupStarted)).toEqual([
      { setup: "on_call" },
    ]);
    expect(sent(ProductEventName.GuidedSetupStepReached)).toEqual([
      { setup: "on_call", step: "reach_you", step_number: 1 },
    ]);
  });
});

describe("how should we reach you", () => {
  test("shows the verified email, and push not set up yet with where to set it up", async () => {
    await renderSetup();

    expect(
      screen.getByTestId("on-call-setup-reach-email-value"),
    ).toHaveTextContent("Email · a***@acme.example");
    expect(
      screen.getByTestId("on-call-setup-reach-push-value"),
    ).toHaveTextContent("Not set up.");
    expect(screen.getByTestId("on-call-setup-push-link")).toHaveAttribute(
      "href",
      expect.stringContaining("notification-methods"),
    );
  });

  test("Cloud, channels off: an owner turns SMS and calls on there, after reading the balance", async () => {
    api["loadProjectPhoneFacts"]!.mockResolvedValue({
      isSmsOn: false,
      isCallOn: false,
      balanceInUSDCents: 500,
    });
    await renderSetup();

    expect(screen.getByTestId("on-call-setup-balance")).toHaveTextContent(
      "which is 5.00 USD",
    );
    expect(
      screen.getByTestId("on-call-setup-break-ChannelOff-SMS"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("on-call-setup-break-ChannelOff-Call"),
    ).toBeInTheDocument();
    // No number before SMS is on.
    expect(screen.queryByTestId("on-call-setup-phone")).toBeNull();

    await press("on-call-setup-turn-on-phone");

    expect(api["turnOnPhoneChannels"]).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByTestId("on-call-setup-break-ChannelOff-SMS"),
    ).toBeNull();
    expect(screen.queryByTestId("on-call-setup-turn-on-phone")).toBeNull();
    expect(screen.getByTestId("on-call-setup-phone")).toBeInTheDocument();
  });

  test("a member who may not turn them on is told who can, with no switch", async () => {
    mayChangeChannels = false;
    api["loadProjectPhoneFacts"]!.mockResolvedValue({
      isSmsOn: false,
      isCallOn: false,
      balanceInUSDCents: 500,
    });
    await renderSetup();

    expect(screen.queryByTestId("on-call-setup-turn-on-phone")).toBeNull();
    expect(
      screen.getByTestId("on-call-setup-who-can-turn-on"),
    ).toHaveTextContent(
      "A project owner, a Billing Admin or someone with Manage Billing can turn it on",
    );
  });

  test("Cloud, no balance: said before any click, with Add balance for who may add it", async () => {
    api["loadProjectPhoneFacts"]!.mockResolvedValue({
      isSmsOn: true,
      isCallOn: true,
      balanceInUSDCents: 0,
    });
    await renderSetup();

    expect(screen.getByTestId("on-call-setup-balance")).toHaveTextContent(
      "which is 0.00 USD",
    );
    expect(screen.getByTestId("on-call-setup-balance")).toHaveTextContent(
      "more than 1.00 USD",
    );
    expect(screen.queryByTestId("on-call-setup-phone")).toBeNull();

    // The owner adds balance in the step, and the number field appears.
    api["loadProjectPhoneFacts"]!.mockResolvedValue({
      isSmsOn: true,
      isCallOn: true,
      balanceInUSDCents: 2000,
    });
    await press("on-call-setup-add-balance");
    await press("recharge-submit");

    expect(api["rechargeBalance"]).toHaveBeenCalledWith(20);
    expect(screen.queryByTestId("recharge-dialog")).toBeNull();
    expect(screen.getByTestId("on-call-setup-balance")).toHaveTextContent(
      "which is 20.00 USD",
    );
    expect(screen.getByTestId("on-call-setup-phone")).toBeInTheDocument();
  });

  test("a recharge the server refuses keeps the dialog open with its reason", async () => {
    api["loadProjectPhoneFacts"]!.mockResolvedValue({
      isSmsOn: true,
      isCallOn: true,
      balanceInUSDCents: 0,
    });
    api["rechargeBalance"]!.mockRejectedValue(
      new Error("No payment method on file."),
    );
    await renderSetup();
    await press("on-call-setup-add-balance");
    await press("recharge-submit");

    expect(screen.getByTestId("recharge-dialog")).toHaveTextContent(
      "No payment method on file.",
    );
    expect(screen.queryByTestId("on-call-setup-phone")).toBeNull();
  });

  test("a project a cloud marketplace bills is sent to Notification Settings to add balance", async () => {
    marketplace = "aws";
    api["loadProjectPhoneFacts"]!.mockResolvedValue({
      isSmsOn: true,
      isCallOn: true,
      balanceInUSDCents: 0,
    });
    await renderSetup();

    expect(screen.queryByTestId("on-call-setup-add-balance")).toBeNull();
    expect(
      screen.getByTestId("on-call-setup-add-balance-link"),
    ).toHaveAttribute("href", expect.stringContaining("notification-settings"));
  });

  test("no balance, for someone who may not add it: who can, and no button", async () => {
    mayAddBalance = false;
    api["loadProjectPhoneFacts"]!.mockResolvedValue({
      isSmsOn: true,
      isCallOn: true,
      balanceInUSDCents: 0,
    });
    await renderSetup();

    expect(screen.queryByTestId("on-call-setup-add-balance")).toBeNull();
    expect(
      screen.getByTestId("on-call-setup-who-can-add-balance"),
    ).toHaveTextContent("Manage Billing");
  });

  test("self-hosted pays nothing: no balance line", async () => {
    billingEnabled = false;
    api["loadProjectPhoneFacts"]!.mockResolvedValue({
      isSmsOn: true,
      isCallOn: true,
      balanceInUSDCents: 0,
    });
    await renderSetup();

    expect(screen.queryByTestId("on-call-setup-balance")).toBeNull();
    expect(screen.getByTestId("on-call-setup-phone")).toBeInTheDocument();
  });

  test("self-hosted without Twilio: a master admin is sent to the server's setup", async () => {
    billingEnabled = false;
    jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(true);
    sendingStatus = {
      channels: [
        {
          channel: ServerSendingChannel.SMS,
          state: ServerSendingState.NotSetUp,
        },
        {
          channel: ServerSendingChannel.Call,
          state: ServerSendingState.NotSetUp,
        },
      ],
      globalProbes: null,
    };
    await renderSetup();

    expect(screen.getByTestId("on-call-setup-no-twilio")).toHaveTextContent(
      "Set up Twilio for the server",
    );
    expect(screen.getByTestId("on-call-setup-set-up-twilio")).toHaveAttribute(
      "href",
      expect.stringContaining("/admin/setup"),
    );
    // Email and the app still reach them; no number can be added.
    expect(screen.queryByTestId("on-call-setup-phone")).toBeNull();
  });

  test("a server that can't send email says so on the email row", async () => {
    canSendEmail = false;
    await renderSetup();

    expect(screen.getByTestId("on-call-setup-no-email")).toHaveTextContent(
      "This server can't send email yet",
    );
  });

  /*
   * ISSUE #7180: the number is typed in a box that reads left to right on
   * every page, its example "+15551234567" with it - on a Persian or Arabic
   * page its "+" went after its digits - and a phone offers its dial pad.
   */
  test("the number's box reads left to right, its example with it, on a phone's dial pad", async () => {
    await renderSetup();

    const box: HTMLElement = screen.getByTestId("on-call-setup-phone");

    expect(box.tagName).toBe("INPUT");
    expect(box).toHaveAttribute("inputmode", "tel");
    expect(box).toHaveAttribute("dir", "ltr");
    expect(box.parentElement).toHaveAttribute("dir", "ltr");
    expect(box).toHaveAttribute("placeholder", "+15551234567");
    // Its label is a sentence of the page, with no direction of its own.
    expect(
      document
        .querySelector('label[for="on-call-setup-phone"]')!
        .closest("[dir]"),
    ).toBeNull();
  });

  test("one number, one code: verified by text, then added for calls with no second code", async () => {
    await renderSetup();

    fireEvent.change(screen.getByTestId("on-call-setup-phone"), {
      target: { value: "555-CALL" },
    });
    await press("on-call-setup-send-code");

    expect(screen.getByText(/country code/)).toBeInTheDocument();
    expect(api["addSmsNumber"]).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId("on-call-setup-phone"), {
      target: { value: "+1 (555) 123-4567" },
    });
    api["loadMyReach"]!.mockResolvedValue({
      isReachable: true,
      methods: [
        EMAIL,
        { methodType: "SMS", maskedIdentifier: "•••4567", isVerified: true },
        { methodType: "Call", maskedIdentifier: "•••4567", isVerified: true },
      ],
    });
    await press("on-call-setup-send-code");

    expect(api["addSmsNumber"]).toHaveBeenCalledWith("+15551234567");
    expect(screen.getByTestId("verify-dialog")).toHaveAttribute(
      "data-item",
      "sms-1",
    );

    await press("verify-code");

    await waitFor(() => {
      expect(api["addCallNumber"]).toHaveBeenCalledWith("+15551234567");
    });
    expect(api["loadMyReach"]).toHaveBeenLastCalledWith(true);
    await waitFor(() => {
      expect(
        screen.getByTestId("on-call-setup-reach-phone-value"),
      ).toHaveTextContent("SMS · •••4567, Phone call · •••4567");
    });
  });

  test("calls switched off: the number is kept for SMS and not added for calls", async () => {
    api["loadProjectPhoneFacts"]!.mockResolvedValue({
      isSmsOn: true,
      isCallOn: false,
      balanceInUSDCents: 2000,
    });
    await renderSetup();

    fireEvent.change(screen.getByTestId("on-call-setup-phone"), {
      target: { value: "+15551234567" },
    });
    await press("on-call-setup-send-code");
    await press("verify-code");

    expect(api["addCallNumber"]).not.toHaveBeenCalled();
  });

  test("a refused number shows the server's reason", async () => {
    api["addSmsNumber"]!.mockRejectedValue(
      new Error("SMS notifications are disabled for this project."),
    );
    await renderSetup();

    fireEvent.change(screen.getByTestId("on-call-setup-phone"), {
      target: { value: "+15551234567" },
    });
    await press("on-call-setup-send-code");

    expect(
      screen.getByText("SMS notifications are disabled for this project."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("verify-dialog")).toBeNull();
  });

  test("nothing reaches you: the step does not move on, and says why", async () => {
    api["loadMyReach"]!.mockResolvedValue({ isReachable: false, methods: [] });
    await renderSetup();

    await press("on-call-setup-reach-continue");

    expect(
      screen.getByTestId("on-call-setup-not-reachable"),
    ).toBeInTheDocument();
    expect(stepState("reach_you")).toBe("open");
    expect(storedRun()["reachConfirmed"]).toBeUndefined();
  });

  test("confirmed, it is kept and the next step opens", async () => {
    await renderSetup();
    await press("on-call-setup-reach-continue");

    expect(storedRun()["reachConfirmed"]).toBe(true);
    expect(stepState("reach_you")).toBe("done");
    expect(stepState("who_else")).toBe("open");
  });
});

describe("who else is on call", () => {
  const reachDone: () => Promise<void> = async (): Promise<void> => {
    keepRun({ reachConfirmed: true });
    await renderSetup();
  };

  test("a new project: one policy, you first, with its catch-all rules", async () => {
    await reachDone();

    expect(screen.getByTestId("on-call-setup-people-picked")).toHaveTextContent(
      JSON.stringify({ user: [USER_ID] }),
    );

    api["loadPolicyReadiness"]!.mockResolvedValue([ANA, BEN]);
    await pressText("Add Ben to on-call-setup-people");
    await press("on-call-setup-who-save");

    expect(api["createPolicy"]).toHaveBeenCalledWith({
      userIds: [USER_ID, "user-ben"],
      teamIds: ["team-platform"],
      addRules: true,
    });
    expect(storedRun()["policyId"]).toBe(POLICY_ID);
    expect(storedRun()["policyIsExisting"]).toBeUndefined();
    // The step stays open: whether a page reaches each person is said now.
    expect(stepState("who_else")).toBe("open");
    expect(
      screen.getByTestId(`on-call-setup-responder-${USER_ID}`),
    ).toHaveTextContent("Ana Lopez (Email, SMS)");
    expect(
      screen.getByTestId("on-call-setup-responder-user-ben"),
    ).toHaveTextContent("Ben Ito (not reachable yet)");
  });

  test("everyone reached and the policy runs: it moves straight on", async () => {
    await reachDone();
    await press("on-call-setup-who-save");

    expect(api["createPolicy"]).toHaveBeenCalledTimes(1);
    expect(stepState("who_else")).toBe("done");
    expect(stepState("no_answer")).toBe("open");
    expect(
      screen.getByTestId("guided-setup-step-who_else-done-line"),
    ).toHaveTextContent(
      '"Default on-call policy" pages Ana Lopez (Email, SMS).',
    );
  });

  test("someone a page can't reach gets a setup reminder; you never do", async () => {
    keepRun({ reachConfirmed: true, policyId: POLICY_ID });
    api["loadPolicyReadiness"]!.mockResolvedValue([
      { ...ANA, isReachable: false, channels: [] },
      BEN,
    ]);
    await renderSetup();
    await act(async () => {
      fireEvent.click(
        screen
          .getByTestId("guided-setup-step-who_else")
          .querySelector("button")!,
      );
    });

    expect(
      screen.queryByTestId(`on-call-setup-send-reminder-${USER_ID}`),
    ).toBeNull();

    await press("on-call-setup-send-reminder-user-ben");

    expect(api["sendSetupReminders"]).toHaveBeenCalledWith(["user-ben"]);
    await waitFor(() => {
      expect(
        screen.getByTestId("on-call-setup-reminder-user-ben"),
      ).toHaveTextContent("Reminder sent");
    });
  });

  test("nobody picked is refused before anything is saved", async () => {
    await reachDone();

    await pressText("Clear on-call-setup-people");
    await press("on-call-setup-who-save");

    expect(
      screen.getByText("Pick at least one person or team."),
    ).toBeInTheDocument();
    expect(api["createPolicy"]).not.toHaveBeenCalled();
  });

  test("someone who may not add on-call rules gets the policy without them", async () => {
    api["loadPolicyChoices"]!.mockResolvedValue({
      policies: [],
      mayCreatePolicy: true,
      mayAddRules: false,
      mayEditLevels: true,
    });
    await reachDone();
    await press("on-call-setup-who-save");

    expect(api["createPolicy"]).toHaveBeenCalledWith(
      expect.objectContaining({ addRules: false }),
    );
  });

  test("someone who may not make a policy, in a project with none, is told who can", async () => {
    api["loadPolicyChoices"]!.mockResolvedValue({
      policies: [],
      mayCreatePolicy: false,
      mayAddRules: false,
      mayEditLevels: false,
    });
    await reachDone();

    expect(screen.getByTestId("on-call-setup-cannot-create")).toHaveTextContent(
      "Ask a project owner or admin",
    );
    expect(screen.queryByTestId("on-call-setup-who-save")).toBeNull();
  });

  test("a project with policies starts from one: picks join its first level, nobody twice", async () => {
    api["loadPolicyChoices"]!.mockResolvedValue({
      policies: [
        { id: "policy-ops", name: "Ops" },
        { id: POLICY_ID, name: "Default on-call policy" },
      ],
      mayCreatePolicy: true,
      mayAddRules: true,
      mayEditLevels: true,
    });
    await reachDone();

    expect(screen.getByTestId("on-call-setup-policy-choice")).toHaveValue(
      "policy-ops",
    );

    fireEvent.change(screen.getByTestId("on-call-setup-policy-choice"), {
      target: { value: POLICY_ID },
    });
    await pressText("Add Ben to on-call-setup-people");
    await press("on-call-setup-who-save");

    expect(api["createPolicy"]).not.toHaveBeenCalled();
    // You are on its first level already: only Ben and the team are added.
    expect(api["addToFirstLevel"]).toHaveBeenCalledWith({
      policyId: POLICY_ID,
      firstLevelId: "level-1",
      userIds: ["user-ben"],
      teamIds: ["team-platform"],
    });
    expect(storedRun()["policyId"]).toBe(POLICY_ID);
    expect(storedRun()["policyIsExisting"]).toBe(true);
  });

  test("an existing policy nothing runs: Continue adds the missing rule, then moves on", async () => {
    keepRun({
      reachConfirmed: true,
      policyId: POLICY_ID,
      policyIsExisting: true,
    });
    api["loadPolicy"]!.mockResolvedValue(policyRecord({ alertRuleCount: 0 }));
    await renderSetup();

    expect(stepState("who_else")).toBe("done");
    // Resumed past it; open it again to see the break.
    await act(async () => {
      fireEvent.click(
        screen
          .getByTestId("guided-setup-step-who_else")
          .querySelector("button")!,
      );
    });

    expect(
      screen.getByTestId("on-call-setup-policy-break-OnlyIncidentsHaveRules"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("on-call-setup-who-continue")).toHaveTextContent(
      "Page this policy for every new incident and alert",
    );

    // Read again just before (still missing), then once the rule is added.
    api["loadPolicy"]!.mockResolvedValueOnce(
      policyRecord({ alertRuleCount: 0 }),
    );
    api["loadPolicy"]!.mockResolvedValue(policyRecord());
    await press("on-call-setup-who-continue");

    expect(api["addEveryNewEventRules"]).toHaveBeenCalledWith({
      policyId: POLICY_ID,
      policyName: "Default on-call policy",
      incident: false,
      alert: true,
    });
    expect(stepState("no_answer")).toBe("open");
  });

  test("someone who may not add rules is shown the break and may go on", async () => {
    keepRun({
      reachConfirmed: true,
      policyId: POLICY_ID,
      policyIsExisting: true,
    });
    api["loadPolicyChoices"]!.mockResolvedValue({
      policies: [{ id: POLICY_ID, name: "Default on-call policy" }],
      mayCreatePolicy: false,
      mayAddRules: false,
      mayEditLevels: false,
    });
    api["loadPolicy"]!.mockResolvedValue(
      policyRecord({ incidentRuleCount: 0, alertRuleCount: 0 }),
    );
    await renderSetup();
    await act(async () => {
      fireEvent.click(
        screen
          .getByTestId("guided-setup-step-who_else")
          .querySelector("button")!,
      );
    });

    expect(
      screen.getByTestId("on-call-setup-policy-break-NobodyPaged"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("on-call-setup-who-continue")).toHaveTextContent(
      "Continue",
    );

    await press("on-call-setup-who-continue");

    expect(api["addEveryNewEventRules"]).not.toHaveBeenCalled();
    expect(stepState("no_answer")).toBe("open");
  });
});

describe("what if nobody answers", () => {
  const atNoAnswer: () => Promise<void> = async (): Promise<void> => {
    keepRun({ reachConfirmed: true, policyId: POLICY_ID });
    await renderSetup();
    expect(stepState("no_answer")).toBe("open");
  };

  test("someone else after the wait: a second level, with the wait checked first", async () => {
    await atNoAnswer();

    expect(
      screen.getByTestId("on-call-setup-no-answer-choice"),
    ).toHaveAttribute("data-value", "escalate");
    expect(screen.getByTestId("on-call-setup-wait")).toHaveValue(30);

    fireEvent.change(screen.getByTestId("on-call-setup-wait"), {
      target: { value: "0" },
    });
    await press("on-call-setup-no-answer-save");
    expect(
      screen.getByTestId("on-call-setup-no-answer-error"),
    ).toHaveTextContent("from 1 to 1440");

    fireEvent.change(screen.getByTestId("on-call-setup-wait"), {
      target: { value: "15" },
    });
    await press("on-call-setup-no-answer-save");
    expect(
      screen.getByTestId("on-call-setup-no-answer-error"),
    ).toHaveTextContent("Pick at least one person or team.");
    expect(api["addSecondLevel"]).not.toHaveBeenCalled();

    await pressText("Add Ben to on-call-setup-next-people");
    await press("on-call-setup-no-answer-save");

    expect(api["addSecondLevel"]).toHaveBeenCalledWith({
      policyId: POLICY_ID,
      firstLevel: policyRecord().levels[0],
      waitMinutes: 15,
      userIds: ["user-ben"],
      teamIds: ["team-platform"],
    });
    expect(storedRun()["noAnswerDone"]).toBe(true);
    expect(stepState("test")).toBe("open");
  });

  test("the Free plan offers paging again instead, and says why", async () => {
    maySecondLevel = false;
    await atNoAnswer();

    expect(screen.getByTestId("on-call-setup-free-plan")).toHaveTextContent(
      "needs a paid plan",
    );
    expect(screen.queryByTestId("choice-escalate")).toBeNull();
    expect(
      screen.getByTestId("on-call-setup-no-answer-choice"),
    ).toHaveAttribute("data-value", "repeat");
    expect(screen.getByTestId("on-call-setup-repeat")).toHaveValue(2);

    await press("on-call-setup-no-answer-save");

    expect(api["setRepeat"]).toHaveBeenCalledWith({
      policyId: POLICY_ID,
      firstLevel: policyRecord().levels[0],
      waitMinutes: 30,
      times: 2,
    });
    expect(api["addSecondLevel"]).not.toHaveBeenCalled();
  });

  test("a repeat count out of range is refused", async () => {
    await atNoAnswer();
    await press("choice-repeat");

    fireEvent.change(screen.getByTestId("on-call-setup-repeat"), {
      target: { value: "50" },
    });
    await press("on-call-setup-no-answer-save");

    expect(
      screen.getByTestId("on-call-setup-no-answer-error"),
    ).toHaveTextContent("from 1 to 10");
    expect(api["setRepeat"]).not.toHaveBeenCalled();
  });

  test("do nothing more saves nothing, and moves on", async () => {
    await atNoAnswer();
    await press("choice-nothing");
    await press("on-call-setup-no-answer-save");

    expect(api["addSecondLevel"]).not.toHaveBeenCalled();
    expect(api["setRepeat"]).not.toHaveBeenCalled();
    expect(storedRun()["noAnswerDone"]).toBe(true);
    expect(stepState("test")).toBe("open");
  });

  test("a policy that already escalates says so, and adds nothing", async () => {
    const policy: OnCallPolicyRecord = policyRecord();
    policy.levels.push({
      id: "level-2",
      order: 2,
      escalateAfterInMinutes: 30,
      userIds: ["user-ben"],
      names: ["Ben Ito"],
      responderCount: 1,
    });
    api["loadPolicy"]!.mockResolvedValue(policy);
    await atNoAnswer();

    expect(screen.getByTestId("on-call-setup-has-levels")).toBeInTheDocument();
    await press("on-call-setup-no-answer-save");

    expect(api["addSecondLevel"]).not.toHaveBeenCalled();
    expect(stepState("test")).toBe("open");
  });
});

describe("the test page", () => {
  const atTest: () => Promise<void> = async (): Promise<void> => {
    keepRun({ reachConfirmed: true, policyId: POLICY_ID, noAnswerDone: true });
    await renderSetup();
    expect(stepState("test")).toBe("open");
  };

  test("goes to the policy, and finishes once acknowledged", async () => {
    await atTest();

    expect(screen.getByTestId("send-test-page")).toHaveAttribute(
      "data-target",
      "policy",
    );
    expect(screen.getByTestId("send-test-page")).toHaveAttribute(
      "data-policy",
      POLICY_ID,
    );

    await press("send-test-page");
    expect(storedRun()["testExecutionLogId"]).toBe("log-1");
    expect(sent(ProductEventName.GuidedSetupFinished)).toEqual([]);

    await act(async () => {
      reportTestResult(result(OnCallTestPageStatus.Acknowledged));
    });
    await press("on-call-setup-test-continue");

    expect(screen.getByTestId("guided-setup-summary")).toBeInTheDocument();
    expect(sent(ProductEventName.GuidedSetupFinished)).toHaveLength(1);
    expect(sent(ProductEventName.GuidedSetupFinished)[0]!["setup"]).toBe(
      "on_call",
    );
  });

  test("not acknowledged yet: 'I did not get it' says what to check", async () => {
    await atTest();
    await press("send-test-page");
    await act(async () => {
      reportTestResult(result(OnCallTestPageStatus.Paging));
    });
    await press("on-call-setup-did-not-get-it");

    expect(
      screen.getByTestId("on-call-setup-not-received"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("on-call-setup-test-continue")).toBeNull();
  });

  test("skipping reaches the summary, but never counts as finished", async () => {
    await atTest();
    await press("on-call-setup-skip-test");

    expect(storedRun()["testSkipped"]).toBe(true);
    expect(screen.getByTestId("guided-setup-summary")).toBeInTheDocument();
    expect(sent(ProductEventName.GuidedSetupFinished)).toEqual([]);
    expect(
      screen.getByTestId("on-call-setup-summary-tested"),
    ).toHaveTextContent("Not tested yet");
  });
});

describe("coming back", () => {
  test("opens the first step not done, from the records, with nothing made twice", async () => {
    keepRun({
      reachConfirmed: true,
      policyId: POLICY_ID,
      noAnswerDone: true,
      testExecutionLogId: "log-1",
    });
    getResultMock.mockResolvedValue(result(OnCallTestPageStatus.Paging));
    await renderSetup();

    expect(stepState("reach_you")).toBe("done");
    expect(stepState("who_else")).toBe("done");
    expect(stepState("no_answer")).toBe("done");
    expect(stepState("test")).toBe("open");
    expect(api["createPolicy"]).not.toHaveBeenCalled();
  });

  test("a policy deleted since starts again from who else is on call", async () => {
    keepRun({
      reachConfirmed: true,
      policyId: POLICY_ID,
      noAnswerDone: true,
      testExecutionLogId: "log-1",
    });
    api["loadPolicy"]!.mockResolvedValue(null);
    await renderSetup();

    expect(stepState("reach_you")).toBe("done");
    expect(stepState("who_else")).toBe("open");
    expect(storedRun()).toEqual({ reachConfirmed: true });
    expect(getResultMock).not.toHaveBeenCalled();
  });

  test("a finished run shows its summary, read from the records", async () => {
    keepRun({
      reachConfirmed: true,
      policyId: POLICY_ID,
      noAnswerDone: true,
      testExecutionLogId: "log-1",
    });
    const policy: OnCallPolicyRecord = policyRecord();
    policy.levels.push({
      id: "level-2",
      order: 2,
      escalateAfterInMinutes: 30,
      userIds: ["user-ben"],
      names: ["Ben Ito"],
      responderCount: 1,
    });
    api["loadPolicy"]!.mockResolvedValue(policy);
    api["loadPolicyReadiness"]!.mockResolvedValue([ANA]);
    await renderSetup();

    expect(screen.getByTestId("guided-setup-summary")).toBeInTheDocument();
    expect(screen.getByTestId("on-call-setup-summary-first")).toHaveTextContent(
      'Any new incident or alert runs "Default on-call policy", which pages Ana Lopez (Email, SMS).',
    );
    expect(
      screen.getByTestId("on-call-setup-summary-no_answer"),
    ).toHaveTextContent(
      "If nobody acknowledges within 30 minutes, Ben Ito is paged.",
    );
    expect(
      screen.getByTestId("on-call-setup-summary-tested"),
    ).toHaveTextContent("Ana Lopez");
    expect(screen.queryByTestId("on-call-setup-summary-breaks")).toBeNull();
    expect(screen.getByTestId("on-call-setup-open-policy")).toHaveAttribute(
      "href",
      expect.stringContaining(`/on-call-duty/policies/${POLICY_ID}/escalation`),
    );
  });

  test("a policy the project had: its own rules decide, never 'any new incident'", async () => {
    keepRun({
      reachConfirmed: true,
      policyId: POLICY_ID,
      policyIsExisting: true,
      noAnswerDone: true,
      testSkipped: true,
    });
    await renderSetup();

    expect(screen.getByTestId("on-call-setup-summary-first")).toHaveTextContent(
      'Its on-call rules decide which incidents and alerts run "Default on-call policy"',
    );
  });

  test("the summary names what still needs attention", async () => {
    keepRun({
      reachConfirmed: true,
      policyId: POLICY_ID,
      noAnswerDone: true,
      testSkipped: true,
    });
    api["loadPolicyReadiness"]!.mockResolvedValue([ANA, BEN]);
    await renderSetup();

    expect(
      screen.getByTestId("on-call-setup-summary-break-PersonUnreachable"),
    ).toHaveTextContent("Ben Ito has no verified notification method.");
  });

  test("Cloud's Free plan: the schedule next step says the plan it needs", async () => {
    jest.spyOn(ProjectUtil, "getCurrentPlan").mockReturnValue(PlanType.Free);
    keepRun({
      reachConfirmed: true,
      policyId: POLICY_ID,
      noAnswerDone: true,
      testSkipped: true,
    });
    await renderSetup();

    expect(screen.getByTestId("on-call-setup-next-schedule")).toHaveTextContent(
      "needs the Growth plan",
    );
  });

  test("set up another policy keeps who is reached and starts at who else", async () => {
    keepRun({
      reachConfirmed: true,
      policyId: POLICY_ID,
      noAnswerDone: true,
      testSkipped: true,
    });
    await renderSetup();
    await press("on-call-setup-start-over");

    expect(storedRun()).toEqual({ reachConfirmed: true });
    expect(stepState("who_else")).toBe("open");
    expect(api["loadPolicyChoices"]).toHaveBeenCalledTimes(2);
  });
});

/*
 * A POLICY MADE MEANWHILE, IN ANOTHER TAB OR ON ANOTHER DEVICE (#7252):
 * the step decides between making the project's first policy and adding
 * to one from what it read when the page opened. Save and continue reads
 * the project's policies again just before it makes one, so a policy made
 * elsewhere meanwhile - the website-down setup's step 2 in another tab, for
 * one - is never made twice, nor its pair of on-call rules that page it for
 * every new incident and alert.
 */
describe("a policy made meanwhile, in another tab or on another device (#7252)", () => {
  const MADE_ELSEWHERE: string =
    "An on-call policy was added to this project while this page was open, so no new policy was made.";

  const NO_POLICY_YET: Record<string, unknown> = {
    policies: [],
    mayCreatePolicy: true,
    mayAddRules: true,
    mayEditLevels: true,
  };

  const ONE_POLICY_NOW: Record<string, unknown> = {
    policies: [{ id: POLICY_ID, name: "Default on-call policy" }],
    mayCreatePolicy: true,
    mayAddRules: true,
    mayEditLevels: true,
  };

  const reachDone: () => Promise<void> = async (): Promise<void> => {
    keepRun({ reachConfirmed: true });
    await renderSetup();
    expect(stepState("who_else")).toBe("open");
  };

  test("the project's policies are asked again just before the policy is made", async () => {
    await reachDone();
    await press("on-call-setup-who-save");

    expect(api["loadPolicyChoices"]).toHaveBeenCalledTimes(2);
    expect(api["createPolicy"]).toHaveBeenCalledTimes(1);
    expect(api["loadPolicyChoices"]!.mock.invocationCallOrder[1]!).toBeLessThan(
      api["createPolicy"]!.mock.invocationCallOrder[0]!,
    );
    expect(
      screen.queryByTestId("on-call-setup-policy-made-elsewhere"),
    ).toBeNull();
  });

  test("a policy made since the page opened: none is made, the step turns to the project's policies and says why first", async () => {
    await reachDone();
    await pressText("Add Ben to on-call-setup-people");

    // Another tab of this person made the project's first policy meanwhile.
    api["loadPolicyChoices"]!.mockResolvedValue(ONE_POLICY_NOW);
    await press("on-call-setup-who-save");

    expect(api["createPolicy"]).not.toHaveBeenCalled();
    expect(api["addToFirstLevel"]).not.toHaveBeenCalled();
    expect(storedRun()).toEqual({ reachConfirmed: true });
    expect(stepState("who_else")).toBe("open");
    expect(screen.queryByRole("alert")).toBeNull();

    // Why the step changed, said first; then the project's policy to pick.
    const note: HTMLElement = screen.getByTestId(
      "on-call-setup-policy-made-elsewhere",
    );
    expect(note).toHaveTextContent(MADE_ELSEWHERE);
    const help: HTMLElement = screen.getByText(
      "This project already has on-call policies. Pick the one to set up: the people you add join its first escalation rule.",
    );
    expect(
      note.compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByTestId("on-call-setup-policy-choice")).toHaveValue(
      POLICY_ID,
    );
    // The people picked are kept, to join its first escalation rule.
    expect(screen.getByText("Add to the first escalation rule")).toBeVisible();
    expect(screen.getByTestId("on-call-setup-people-picked")).toHaveTextContent(
      JSON.stringify({ user: [USER_ID, "user-ben"], team: ["team-platform"] }),
    );

    // Save and continue now joins them to that policy, and makes nothing.
    await press("on-call-setup-who-save");

    expect(api["createPolicy"]).not.toHaveBeenCalled();
    expect(api["addToFirstLevel"]).toHaveBeenCalledWith({
      policyId: POLICY_ID,
      firstLevelId: "level-1",
      userIds: ["user-ben"],
      teamIds: ["team-platform"],
    });
    expect(storedRun()).toEqual({
      reachConfirmed: true,
      policyId: POLICY_ID,
      policyIsExisting: true,
    });
    // Its on-call rules page it already: no second pair is added.
    expect(api["addEveryNewEventRules"]).not.toHaveBeenCalled();
    expect(stepState("who_else")).toBe("done");
    expect(stepState("no_answer")).toBe("open");
  });

  /*
   * Save and continue stays where it was when the step turns, so nothing
   * else tells a screen reader why: the help is a polite live region that
   * was on the page before the turn (a region added with its words is not
   * read out), and the sentence and the new help are said in it.
   */
  test("the sentence is read out: it is said in the step's help, a polite live region that was there before the step turned", async () => {
    await reachDone();
    const region: HTMLElement = screen.getByTestId("on-call-setup-who-help");

    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveTextContent(
      'This makes the on-call policy "Default on-call policy".',
    );
    expect(region).not.toHaveTextContent(MADE_ELSEWHERE);

    api["loadPolicyChoices"]!.mockResolvedValue(ONE_POLICY_NOW);
    await press("on-call-setup-who-save");

    // The same element, now holding why and what to do.
    expect(screen.getByTestId("on-call-setup-who-help")).toBe(region);
    expect(region).toHaveTextContent(MADE_ELSEWHERE);
    expect(region).toHaveTextContent(
      "This project already has on-call policies. Pick the one to set up",
    );
    expect(
      region.contains(
        screen.getByTestId("on-call-setup-policy-made-elsewhere"),
      ),
    ).toBe(true);
    // The picker and the button are not read out with it.
    expect(region.contains(screen.getByTestId("on-call-setup-who-save"))).toBe(
      false,
    );
  });

  test("choices that cannot be read just before: nothing is made, the step says to try again, and trying again makes one", async () => {
    await reachDone();
    api["loadPolicyChoices"]!.mockRejectedValueOnce(
      new Error("The server could not be reached."),
    );
    await press("on-call-setup-who-save");

    expect(api["createPolicy"]).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "That did not save. Check your connection and try again.",
    );
    expect(stepState("who_else")).toBe("open");
    // The people picked stay; nothing claims a policy appeared.
    expect(screen.getByTestId("on-call-setup-people")).toBeInTheDocument();
    expect(
      screen.queryByTestId("on-call-setup-policy-made-elsewhere"),
    ).toBeNull();
    expect(storedRun()).toEqual({ reachConfirmed: true });

    await press("on-call-setup-who-save");

    expect(api["createPolicy"]).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(storedRun()).toEqual({ reachConfirmed: true, policyId: POLICY_ID });
    expect(stepState("who_else")).toBe("done");
  });

  test("permission to make a policy taken away meanwhile: nothing is made, and the step says who can", async () => {
    await reachDone();
    api["loadPolicyChoices"]!.mockResolvedValue({
      policies: [],
      mayCreatePolicy: false,
      mayAddRules: false,
      mayEditLevels: false,
    });
    await press("on-call-setup-who-save");

    expect(api["createPolicy"]).not.toHaveBeenCalled();
    expect(screen.getByTestId("on-call-setup-cannot-create")).toHaveTextContent(
      "Ask a project owner or admin",
    );
    // No policy appeared, so none is said to have.
    expect(
      screen.queryByTestId("on-call-setup-policy-made-elsewhere"),
    ).toBeNull();
    expect(storedRun()).toEqual({ reachConfirmed: true });
  });

  test("the rules are added as they are read just before: whoever may add them now decides", async () => {
    await reachDone();
    api["loadPolicyChoices"]!.mockResolvedValue({
      ...NO_POLICY_YET,
      mayAddRules: false,
    });
    await press("on-call-setup-who-save");

    expect(api["createPolicy"]).toHaveBeenCalledWith(
      expect.objectContaining({ addRules: false }),
    );
  });

  test("a project that had policies when the page opened says nothing of a policy made meanwhile, and reads nothing again", async () => {
    api["loadPolicyChoices"]!.mockResolvedValue(ONE_POLICY_NOW);
    await reachDone();

    expect(
      screen.queryByTestId("on-call-setup-policy-made-elsewhere"),
    ).toBeNull();

    await press("on-call-setup-who-save");

    expect(api["loadPolicyChoices"]).toHaveBeenCalledTimes(1);
    expect(api["createPolicy"]).not.toHaveBeenCalled();
    expect(stepState("no_answer")).toBe("open");
  });

  test("Set up another policy before the project's policies are read again makes no second policy", async () => {
    keepRun({
      reachConfirmed: true,
      policyId: POLICY_ID,
      noAnswerDone: true,
      testSkipped: true,
    });
    await renderSetup();
    expect(screen.getByTestId("guided-setup-summary")).toBeInTheDocument();

    // The read Set up another policy starts fails: the old choices (none) stay.
    api["loadPolicyChoices"]!.mockRejectedValueOnce(new Error("offline"));
    await press("on-call-setup-start-over");
    expect(stepState("who_else")).toBe("open");
    expect(screen.queryByTestId("on-call-setup-policy-choice")).toBeNull();

    // The project has the policy this page made: the save finds it.
    api["loadPolicyChoices"]!.mockResolvedValue(ONE_POLICY_NOW);
    await press("on-call-setup-who-save");

    expect(api["createPolicy"]).not.toHaveBeenCalled();
    expect(screen.getByTestId("on-call-setup-policy-choice")).toHaveValue(
      POLICY_ID,
    );
    expect(
      screen.getByTestId("on-call-setup-policy-made-elsewhere"),
    ).toHaveTextContent(MADE_ELSEWHERE);
  });

  test("Set up another policy starts without the sentence", async () => {
    await reachDone();
    api["loadPolicyChoices"]!.mockResolvedValue(ONE_POLICY_NOW);
    await press("on-call-setup-who-save");
    expect(
      screen.getByTestId("on-call-setup-policy-made-elsewhere"),
    ).toBeInTheDocument();

    // Into that policy, past the rest, to the summary and a new run.
    await press("on-call-setup-who-save");
    await press("choice-nothing");
    await press("on-call-setup-no-answer-save");
    await press("on-call-setup-skip-test");
    expect(screen.getByTestId("guided-setup-summary")).toBeInTheDocument();
    await press("on-call-setup-start-over");

    expect(stepState("who_else")).toBe("open");
    expect(
      screen.queryByTestId("on-call-setup-policy-made-elsewhere"),
    ).toBeNull();
  });

  test("on-call rules another tab added meanwhile are not added twice", async () => {
    keepRun({
      reachConfirmed: true,
      policyId: POLICY_ID,
      policyIsExisting: true,
    });
    api["loadPolicy"]!.mockResolvedValue(policyRecord({ alertRuleCount: 0 }));
    await renderSetup();
    await act(async () => {
      fireEvent.click(
        screen
          .getByTestId("guided-setup-step-who_else")
          .querySelector("button")!,
      );
    });
    expect(screen.getByTestId("on-call-setup-who-continue")).toHaveTextContent(
      "Page this policy for every new incident and alert",
    );

    // Another tab pressed the same button meanwhile.
    api["loadPolicy"]!.mockResolvedValue(policyRecord());
    await press("on-call-setup-who-continue");

    expect(api["addEveryNewEventRules"]).not.toHaveBeenCalled();
    expect(stepState("no_answer")).toBe("open");
  });

  test("only the kinds of on-call rule still missing are added", async () => {
    keepRun({
      reachConfirmed: true,
      policyId: POLICY_ID,
      policyIsExisting: true,
    });
    api["loadPolicy"]!.mockResolvedValue(
      policyRecord({ incidentRuleCount: 0, alertRuleCount: 0 }),
    );
    await renderSetup();
    await act(async () => {
      fireEvent.click(
        screen
          .getByTestId("guided-setup-step-who_else")
          .querySelector("button")!,
      );
    });

    // Another tab added the incident rule meanwhile; the alert rule is missing.
    api["loadPolicy"]!.mockResolvedValueOnce(
      policyRecord({ incidentRuleCount: 1, alertRuleCount: 0 }),
    );
    api["loadPolicy"]!.mockResolvedValue(policyRecord());
    await press("on-call-setup-who-continue");

    expect(api["addEveryNewEventRules"]).toHaveBeenCalledTimes(1);
    expect(api["addEveryNewEventRules"]).toHaveBeenCalledWith({
      policyId: POLICY_ID,
      policyName: "Default on-call policy",
      incident: false,
      alert: true,
    });
    expect(stepState("no_answer")).toBe("open");
  });

  test("the policy's rules that cannot be read just before: nothing is added, and the step says why", async () => {
    keepRun({
      reachConfirmed: true,
      policyId: POLICY_ID,
      policyIsExisting: true,
    });
    api["loadPolicy"]!.mockResolvedValue(policyRecord({ alertRuleCount: 0 }));
    await renderSetup();
    await act(async () => {
      fireEvent.click(
        screen
          .getByTestId("guided-setup-step-who_else")
          .querySelector("button")!,
      );
    });

    api["loadPolicy"]!.mockRejectedValueOnce(
      new Error("The server could not be reached."),
    );
    await press("on-call-setup-who-continue");

    expect(api["addEveryNewEventRules"]).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The server could not be reached.",
    );
    expect(stepState("who_else")).toBe("open");
  });
});

/*
 * READ IN ANOTHER LANGUAGE (#7252): the sentence that a policy appeared
 * while the page was open, and the one asking to try again when the
 * project's policies could not be read, are in the reader's words - in
 * German, and on the right-to-left pages, Arabic and Persian.
 */
describe("read in another language (#7252)", () => {
  const LANGUAGES: Array<string> = ["de", "ar", "fa"];

  const worded: (language: string, key: string) => string = (
    language: string,
    key: string,
  ): string => {
    const text: string = readDashboardLocale(language)[key] || "";

    expect({ language, key, worded: Boolean(text) && text !== key }).toEqual({
      language,
      key,
      worded: true,
    });

    return text;
  };

  beforeAll(async () => {
    const resources: Record<string, { translation: Record<string, string> }> =
      {};

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

  afterAll(async () => {
    await act(async (): Promise<void> => {
      await i18next.changeLanguage("en");
    });
  });

  describe.each(LANGUAGES)("in %s", (language: string) => {
    beforeEach(async () => {
      await act(async (): Promise<void> => {
        await i18next.changeLanguage(language);
      });
    });

    test("a policy made meanwhile: the step says so in their words", async () => {
      keepRun({ reachConfirmed: true });
      await renderSetup();
      api["loadPolicyChoices"]!.mockResolvedValue({
        policies: [{ id: POLICY_ID, name: "Default on-call policy" }],
        mayCreatePolicy: true,
        mayAddRules: true,
        mayEditLevels: true,
      });
      await press("on-call-setup-who-save");

      const sentence: string = withoutIsolateMarks(
        screen.getByTestId("on-call-setup-policy-made-elsewhere").textContent ||
          "",
      );

      expect(sentence).toBe(
        worded(language, ON_CALL_SETUP_COPY.policyMadeElsewhere),
      );
      expect(sentence).not.toContain("while this page was open");
      expect(api["createPolicy"]).not.toHaveBeenCalled();
    });

    test("policies that cannot be read: try again, in their words", async () => {
      keepRun({ reachConfirmed: true });
      await renderSetup();
      api["loadPolicyChoices"]!.mockRejectedValueOnce(new Error("offline"));
      await press("on-call-setup-who-save");

      const alert: string = withoutIsolateMarks(
        screen.getByRole("alert").textContent || "",
      );

      expect(alert).toBe(worded(language, ON_CALL_SETUP_COPY.couldNotSave));
      expect(alert).not.toContain("Check your connection");
      expect(api["createPolicy"]).not.toHaveBeenCalled();
    });
  });
});
