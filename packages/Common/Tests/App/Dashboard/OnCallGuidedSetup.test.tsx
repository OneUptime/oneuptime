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
  within,
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
  "loadReachOrders",
  "getBrowserPushProblem",
  "registerThisBrowser",
  "mayInviteByEmail",
  "inviteByEmail",
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
      "loadReachOrders",
      "getBrowserPushProblem",
      "registerThisBrowser",
      "mayInviteByEmail",
      "inviteByEmail",
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
        onClose?: () => void;
      }) => {
        return (
          <>
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
            {/* The dialog closed, whatever became of the test. */}
            <button
              type="button"
              data-testid="close-test-page"
              onClick={() => {
                props.onClose?.();
              }}
            >
              Close the test dialog
            </button>
          </>
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
let projectCanSend: unknown = null;
let pushTurnedOff: boolean = false;

// Whether the server turned push off (GlobalConfig), as each test says.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/PushNotificationsTurnedOff",
  () => {
    return {
      __esModule: true,
      usePushNotificationsTurnedOff: (): boolean => {
        return pushTurnedOff;
      },
    };
  },
);

// The link a master admin hands over: it reads the invitation from the server.
jest.mock("../../../UI/Components/InvitationLink/InvitationLinkModal", () => {
  return {
    __esModule: true,
    // Its words (INVITATION_LINK_COPY) are the module's own.
    ...(jest.requireActual(
      "../../../UI/Components/InvitationLink/InvitationLinkModal",
    ) as Record<string, unknown>),
    default: (props: {
      teamMemberId: { toString: () => string };
      onClose: () => void;
    }) => {
      return (
        <div
          data-testid="invitation-link-dialog"
          data-team-member={props.teamMemberId.toString()}
        >
          <button
            type="button"
            data-testid="invitation-link-done"
            onClick={props.onClose}
          >
            Done
          </button>
        </div>
      );
    },
  };
});

// A code is drawn by a library loaded later: here, what it would encode.
jest.mock("../../../UI/Components/QR/QR", () => {
  return {
    __esModule: true,
    default: (props: { text: string }) => {
      return <span data-testid="qr-code" data-text={props.text} />;
    },
  };
});

jest.mock("../../../UI/Utils/ServerSending", () => {
  return {
    __esModule: true,
    useServerCanSendEmail: () => {
      return canSendEmail;
    },
    useServerSendingStatus: () => {
      return sendingStatus;
    },
    // What any member of the project reads (GET /project-can-send, #7151).
    useProjectCanSend: () => {
      return projectCanSend;
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
import {
  BrowserPushError,
  BrowserPushProblem,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/BrowserPushRegistration";
import {
  MOBILE_APP_ANDROID_URL,
  MOBILE_APP_IOS_URL,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/MobileAppStoreLinks";
import Toast from "../../../UI/Utils/Toast";
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
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import UserUtil from "../../../UI/Utils/User";
import {
  DASHBOARD_LANGUAGES,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
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
  projectCanSend = null;
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
  // Not read: the summary names how each person is reached.
  api["loadReachOrders"]!.mockResolvedValue(null);
  // A browser that can take push, registered at the first ask.
  api["getBrowserPushProblem"]!.mockReturnValue(null);
  api["registerThisBrowser"]!.mockResolvedValue({
    deviceId: "device-1",
    alreadyRegistered: false,
  });
  pushTurnedOff = false;
  // Someone who may invite to the members team, and an invitation that goes.
  api["mayInviteByEmail"]!.mockReturnValue(true);
  api["inviteByEmail"]!.mockResolvedValue({
    teamMemberId: "tm-cara",
    userId: "user-cara",
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

// What the setup sets up, beside the steps (#8897), in the order listed.
const outcomesBeside: () => Array<string> = (): Array<string> => {
  return Array.from(
    screen.getByTestId("guided-setup-aside").querySelectorAll("li"),
  ).map((item: HTMLLIElement): string => {
    return item.textContent || "";
  });
};

describe("a brand-new project", () => {
  test("beside the steps, what it sets up, the first one open, and about how long", async () => {
    await renderSetup();

    expect(outcomesBeside()).toEqual([
      "A page reaches you by every method you verified.",
      "An on-call policy pages the right people for every new incident and alert.",
      "If nobody answers in time, the page goes further.",
      "A test page proves that the policy reaches people.",
    ]);
    expect(
      screen.getByTestId("guided-setup-outcome-reach_you"),
    ).toHaveAttribute("data-state", "open");
    expect(screen.getByTestId("guided-setup-minutes")).toHaveTextContent(
      /^About 5\sminutes$/,
    );
  });

  test("opens on how you are reached, with the whole job in view, and makes nothing", async () => {
    await renderSetup();

    expect(stepState("reach_you")).toBe("open");
    expect(stepState("who_else")).toBe("upcoming");
    expect(stepState("no_answer")).toBe("upcoming");
    expect(stepState("test")).toBe("upcoming");
    expect(screen.getByText("Who is paged first?")).toBeInTheDocument();
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
  test("shows the verified email, and push not set up yet, set up right here", async () => {
    await renderSetup();

    expect(
      screen.getByTestId("on-call-setup-reach-email-value"),
    ).toHaveTextContent("Email · a***@acme.example");
    expect(
      screen.getByTestId("on-call-setup-reach-push-value"),
    ).toHaveTextContent("Not set up.");
    expect(screen.getByTestId("on-call-setup-push-options")).toHaveTextContent(
      "Get pages on your phone with the OneUptime On-Call app, or in this browser.",
    );
    expect(
      screen.getByTestId("on-call-setup-use-this-browser"),
    ).toHaveTextContent("Use this browser");
    expect(screen.getByTestId("on-call-setup-get-the-app")).toHaveTextContent(
      "Get the app",
    );
    // Not a trip to Notification Methods any more.
    expect(screen.queryByTestId("on-call-setup-push-link")).toBeNull();
  });

  /*
   * ISSUE #7149: push only linked to User Settings > Notification Methods.
   * This browser is registered in the step, from the click, the way
   * Notification Methods registers one; the app is a code to scan.
   */
  test("Use this browser registers it from the click, then reads again what reaches you (#7149)", async () => {
    await renderSetup();

    // Nothing is asked of the browser until the person clicks.
    expect(api["registerThisBrowser"]).not.toHaveBeenCalled();

    api["loadMyReach"]!.mockResolvedValue({
      isReachable: true,
      methods: [
        EMAIL,
        {
          methodType: "Push",
          maskedIdentifier: "Chrome on Windows",
          isVerified: true,
        },
      ],
    });
    await press("on-call-setup-use-this-browser");

    expect(api["registerThisBrowser"]).toHaveBeenCalledTimes(1);
    expect(api["loadMyReach"]).toHaveBeenLastCalledWith(true);
    await waitFor(() => {
      expect(
        screen.getByTestId("on-call-setup-reach-push-value"),
      ).toHaveTextContent("Chrome on Windows");
    });
    // Set up: nothing more to offer on the row.
    expect(screen.queryByTestId("on-call-setup-use-this-browser")).toBeNull();
    expect(
      Toast.getToasts().some((toast: { title: string }) => {
        return toast.title === "Browser Registered";
      }),
    ).toBe(true);
    Toast.dismissAll();
  });

  test("a browser that blocks push says what to do, plainly, and nothing is kept (#7149)", async () => {
    api["registerThisBrowser"]!.mockRejectedValue(
      new BrowserPushError(BrowserPushProblem.PermissionBlocked),
    );
    await renderSetup();
    await press("on-call-setup-use-this-browser");

    expect(
      screen.getByTestId("on-call-setup-browser-push-error"),
    ).toHaveTextContent(
      "Notifications are blocked for OneUptime in this browser. Click the icon at the left of the address bar, allow notifications for this site, and then register this browser again.",
    );
    expect(
      screen.getByTestId("on-call-setup-reach-push-value"),
    ).toHaveTextContent("Not set up.");
    // The person may try again.
    expect(
      screen.getByTestId("on-call-setup-use-this-browser"),
    ).toBeInTheDocument();
  });

  test("a server refusal is said in its words (#7149)", async () => {
    api["registerThisBrowser"]!.mockRejectedValue(
      new Error("Push notifications are turned off for this project."),
    );
    await renderSetup();
    await press("on-call-setup-use-this-browser");

    expect(
      screen.getByTestId("on-call-setup-browser-push-error"),
    ).toHaveTextContent("Push notifications are turned off for this project.");
  });

  test("a server with no push keys says so in place of Use this browser; the app is still offered (#7149)", async () => {
    api["getBrowserPushProblem"]!.mockReturnValue(
      BrowserPushProblem.NotConfigured,
    );
    await renderSetup();

    expect(screen.queryByTestId("on-call-setup-use-this-browser")).toBeNull();
    expect(
      screen.getByTestId("on-call-setup-browser-push-problem"),
    ).toHaveTextContent(
      "Push notifications are not set up on this OneUptime server. An administrator needs to set the VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY environment variables.",
    );
    expect(screen.getByTestId("on-call-setup-get-the-app")).toBeInTheDocument();
  });

  test("a server that turned push off says so, with neither button (#7149)", async () => {
    pushTurnedOff = true;
    await renderSetup();

    expect(
      screen.getByTestId("on-call-setup-push-turned-off"),
    ).toHaveTextContent("Push notifications are turned off on this server.");
    expect(screen.queryByTestId("on-call-setup-use-this-browser")).toBeNull();
    expect(screen.queryByTestId("on-call-setup-get-the-app")).toBeNull();
  });

  test("Get the app opens a code for each store and the address to sign in to, then Recheck (#7149)", async () => {
    await renderSetup();

    const button: HTMLElement = screen.getByTestId("on-call-setup-get-the-app");

    expect(button).toHaveAttribute("aria-expanded", "false");

    await press("on-call-setup-get-the-app");

    expect(button).toHaveAttribute("aria-expanded", "true");

    const codes: HTMLElement = screen.getByTestId("on-call-setup-app-codes");

    expect(
      within(codes)
        .getAllByTestId("qr-code")
        .map((code: HTMLElement): string | null => {
          return code.getAttribute("data-text");
        }),
    ).toEqual([MOBILE_APP_IOS_URL, MOBILE_APP_ANDROID_URL]);
    expect(
      within(codes).getByTestId("on-call-setup-app-server-url"),
    ).toHaveTextContent(/^https?:\/\//);
    expect(
      screen.getByText(
        "Once the app is signed in on your phone, click Recheck.",
      ),
    ).toBeInTheDocument();

    // Recheck reads what reaches the person again.
    api["loadMyReach"]!.mockClear();
    await press("on-call-setup-reach-recheck");

    expect(api["loadMyReach"]).toHaveBeenCalledWith(true);

    await press("on-call-setup-get-the-app");

    expect(screen.queryByTestId("on-call-setup-app-codes")).toBeNull();
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
      "A Project Owner, a Billing Admin or someone with Manage Billing can turn it on",
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
   * #7151: a member - not only a master admin - is told the server cannot
   * send SMS or make calls before typing a number, and who sets it up. The
   * number was refused only at Add, after an owner had turned SMS on.
   */
  test("self-hosted without Twilio: a member is told before typing a number, and offered no number box", async () => {
    billingEnabled = false;
    projectCanSend = { email: true, sms: false, call: false };
    await renderSetup();

    expect(screen.getByTestId("on-call-setup-no-twilio")).toHaveTextContent(
      "This server can't send SMS or make calls yet. Its admin sets up Twilio in the Admin Dashboard.",
    );
    // The server's admin is named, never a link a member could not open.
    expect(screen.queryByTestId("on-call-setup-set-up-twilio")).toBeNull();
    expect(screen.queryByTestId("on-call-setup-phone")).toBeNull();
  });

  test("a project with its own Twilio config sends SMS though the server cannot: the number box is offered", async () => {
    billingEnabled = false;
    // The server has no Twilio, as a master admin would read it ...
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
    // ... but this project's own config sends both.
    projectCanSend = { email: true, sms: true, call: true };
    await renderSetup();

    expect(screen.queryByTestId("on-call-setup-no-twilio")).toBeNull();
    expect(screen.getByTestId("on-call-setup-phone")).toBeInTheDocument();
  });

  test("email failing now, after it worked, says so on the email row too", async () => {
    canSendEmail = true;
    projectCanSend = { email: false, sms: true, call: true };
    await renderSetup();

    expect(screen.getByTestId("on-call-setup-no-email")).toBeInTheDocument();
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

  /*
   * ISSUE #7372: step 2 was "Who else is on call?", which read as the place
   * to add the teammate to page when nobody answers: a newcomer added them
   * here, and both were paged at the same moment. It asks who is paged
   * first, says everyone picked is paged at once, and sends whoever should
   * be paged only if nobody answers to the next step.
   */
  test("asks who is paged first, and sends someone to page if nobody answers to the next step (#7372)", async () => {
    await reachDone();

    const step: HTMLElement = screen.getByTestId("guided-setup-step-who_else");

    expect(step).toHaveTextContent("Who is paged first?");
    expect(step).not.toHaveTextContent("Who else is on call?");
    expect(screen.getByTestId("on-call-setup-who-next-hint")).toHaveTextContent(
      "Everyone here is paged at the same time. Someone to page only if nobody answers comes in the next step.",
    );
    // The next step is where someone is paged after a wait.
    expect(screen.getByText("What if nobody answers?")).toBeInTheDocument();
  });

  test("a project with policies says the same under the first escalation rule (#7372)", async () => {
    api["loadPolicyChoices"]!.mockResolvedValue({
      policies: [{ id: POLICY_ID, name: "Default on-call policy" }],
      mayCreatePolicy: true,
      mayAddRules: true,
      mayEditLevels: true,
    });
    await reachDone();

    expect(screen.getByTestId("on-call-setup-who-next-hint")).toHaveTextContent(
      "Everyone here is paged at the same time.",
    );
  });

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
      // The reader's translator: the policy and its rules are named in their language (#7995).
      translator: expect.anything(),
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
      "Ask a Project Owner or Project Admin",
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
      translator: expect.anything(),
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

/*
 * ARCHIVED POLICIES ARE NOT THE PROJECT'S POLICIES TO SET UP (#8234). An
 * archived policy pages no one, and the On-Call Policies list hides it; the
 * setup offered it, and a project whose only policy was archived never got
 * one that pages people. Here the project's policies are read by the real
 * OnCallSetupApi.loadPolicyChoices from a fake server that answers a list
 * as the real one does: only the records its query matches.
 */
/*
 * ISSUE #7150: someone not in the project yet had to be invited from Users
 * first, then picked. "Invite by email" invites them from the step - the
 * Users page's Invite User, through the server's own checks - and adds them
 * to who is paged first, saved with the rest.
 */
describe("invite by email (#7150)", () => {
  const CARA: {
    userId: string;
    name: string;
    isReachable: boolean;
    channels: Array<string>;
  } = {
    userId: "user-cara",
    name: "cara@acme.example",
    isReachable: false,
    channels: [],
  };

  const reachDone: () => Promise<void> = async (): Promise<void> => {
    keepRun({ reachConfirmed: true });
    await renderSetup();
  };

  const invite: (email: string) => Promise<void> = async (
    email: string,
  ): Promise<void> => {
    await press("on-call-setup-invite-open");
    fireEvent.change(screen.getByTestId("on-call-setup-invite-email"), {
      target: { value: email },
    });
    await press("on-call-setup-invite-send");
  };

  test("invites the address and adds them to who is paged first, saved with the rest", async () => {
    await reachDone();
    await invite("cara@acme.example");

    expect(api["inviteByEmail"]).toHaveBeenCalledWith("cara@acme.example");
    expect(screen.getByTestId("on-call-setup-people-picked")).toHaveTextContent(
      JSON.stringify({ user: [USER_ID, "user-cara"] }),
    );
    expect(screen.getByTestId("on-call-setup-invited")).toHaveTextContent(
      "cara@acme.example is invited and added here.",
    );
    // The form closes; another can be invited.
    expect(screen.queryByTestId("on-call-setup-invite")).toBeNull();
    expect(screen.getByTestId("on-call-setup-invite-open")).toBeInTheDocument();

    api["loadPolicyReadiness"]!.mockResolvedValue([ANA, CARA]);
    await press("on-call-setup-who-save");

    expect(api["createPolicy"]).toHaveBeenCalledWith(
      expect.objectContaining({ userIds: [USER_ID, "user-cara"] }),
    );
    // Not reachable until they accept and set up a way: a reminder for them.
    expect(stepState("who_else")).toBe("open");
    expect(
      screen.getByTestId("on-call-setup-responder-user-cara"),
    ).toHaveTextContent("cara@acme.example (not reachable yet)");
    expect(
      screen.getByTestId("on-call-setup-send-reminder-user-cara"),
    ).toBeInTheDocument();
  });

  test("a project with policies: the invitee joins its first escalation rule", async () => {
    api["loadPolicyChoices"]!.mockResolvedValue({
      policies: [{ id: POLICY_ID, name: "Default on-call policy" }],
      mayCreatePolicy: true,
      mayAddRules: true,
      mayEditLevels: true,
    });
    await reachDone();
    await invite("cara@acme.example");
    await press("on-call-setup-who-save");

    expect(api["addToFirstLevel"]).toHaveBeenCalledWith(
      expect.objectContaining({ userIds: ["user-cara"] }),
    );
  });

  test("an address that is not one is refused before anything is sent", async () => {
    await reachDone();
    await invite("cara at acme");

    expect(api["inviteByEmail"]).not.toHaveBeenCalled();
    expect(screen.getByTestId("on-call-setup-invite")).toHaveTextContent(
      "Enter an email address, such as ana@example.com.",
    );
  });

  test("the plan's seat limit refuses in the server's words, and nobody is added", async () => {
    api["inviteByEmail"]!.mockRejectedValue(
      new Error(
        "This project has used all 5 of its seats. Remove someone from the project, or ask a Project Owner to add seats.",
      ),
    );
    await reachDone();
    await invite("cara@acme.example");

    expect(screen.getByTestId("on-call-setup-invite-error")).toHaveTextContent(
      "This project has used all 5 of its seats.",
    );
    expect(screen.getByTestId("on-call-setup-people-picked")).toHaveTextContent(
      JSON.stringify({ user: [USER_ID] }),
    );
    expect(screen.queryByTestId("on-call-setup-invited")).toBeNull();
  });

  test("someone who may not invite is not offered it", async () => {
    api["mayInviteByEmail"]!.mockReturnValue(false);
    await reachDone();

    expect(screen.queryByTestId("on-call-setup-invite-open")).toBeNull();
  });

  test("never asks whether the address has an account: one field, the same words for any address", async () => {
    await reachDone();
    await press("on-call-setup-invite-open");

    const form: HTMLElement = screen.getByTestId("on-call-setup-invite");

    // The address alone: no name asked of a person without an account.
    expect(form.querySelectorAll("input")).toHaveLength(1);
    expect(
      screen.getByTestId("on-call-setup-invite-description"),
    ).toHaveTextContent(
      "We email them an invitation to this project and add them here.",
    );

    fireEvent.change(screen.getByTestId("on-call-setup-invite-email"), {
      target: { value: "cara@acme.example" },
    });
    await press("on-call-setup-invite-send");

    // One call, the address alone, whatever the server finds for it.
    expect(api["inviteByEmail"]).toHaveBeenCalledTimes(1);
    expect(api["inviteByEmail"]!.mock.calls[0]).toEqual(["cara@acme.example"]);
  });

  test("a server that cannot send email says so before anything is sent", async () => {
    canSendEmail = false;
    await reachDone();
    await press("on-call-setup-invite-open");

    expect(
      screen.getByTestId("on-call-setup-invite-description"),
    ).toHaveTextContent(
      "This server cannot send email yet, so they get no invitation email. The invitation is still created: ask your server's admin to set up email.",
    );

    fireEvent.change(screen.getByTestId("on-call-setup-invite-email"), {
      target: { value: "cara@acme.example" },
    });
    await press("on-call-setup-invite-send");

    // Anyone but a master admin gets no link to hand over.
    expect(screen.queryByTestId("invitation-link-dialog")).toBeNull();
    expect(screen.getByTestId("on-call-setup-invited")).toBeInTheDocument();
  });

  test("on a server that cannot send email, a master admin is handed the invitation's link", async () => {
    canSendEmail = false;
    jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(true);
    await reachDone();
    await press("on-call-setup-invite-open");

    expect(
      screen.getByTestId("on-call-setup-invite-description"),
    ).toHaveTextContent("you get a link to send them yourself");

    fireEvent.change(screen.getByTestId("on-call-setup-invite-email"), {
      target: { value: "cara@acme.example" },
    });
    await press("on-call-setup-invite-send");

    expect(screen.getByTestId("invitation-link-dialog")).toHaveAttribute(
      "data-team-member",
      "tm-cara",
    );

    await press("invitation-link-done");

    expect(screen.queryByTestId("invitation-link-dialog")).toBeNull();
  });

  test("Cancel closes the form and sends nothing", async () => {
    await reachDone();
    await press("on-call-setup-invite-open");
    fireEvent.change(screen.getByTestId("on-call-setup-invite-email"), {
      target: { value: "cara@acme.example" },
    });
    await press("on-call-setup-invite-cancel");

    expect(screen.queryByTestId("on-call-setup-invite")).toBeNull();
    expect(api["inviteByEmail"]).not.toHaveBeenCalled();
  });
});

describe("archived on-call policies (#8234)", () => {
  const LIVE_ID: string = "60000000-0000-4000-8000-000000000011";
  const ARCHIVED_ID: string = "60000000-0000-4000-8000-000000000012";

  const realApi: { loadPolicyChoices: () => Promise<unknown> } = (
    jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/OnCall/OnCallSetupApi",
    ) as { default: { loadPolicyChoices: () => Promise<unknown> } }
  ).default;

  // The project's policies, as its database holds them.
  const holds: (
    policies: Array<{ _id: string; name: string; isArchived: boolean }>,
  ) => void = (
    policies: Array<{ _id: string; name: string; isArchived: boolean }>,
  ): void => {
    jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
    jest.spyOn(ModelAPI, "getList").mockImplementation((async (args: {
      modelType: { new (): unknown };
      query: Record<string, unknown>;
    }) => {
      const matching: Array<OnCallDutyPolicy> =
        args.modelType === OnCallDutyPolicy
          ? policies
              .filter((policy: Record<string, unknown>): boolean => {
                return Object.entries(args.query).every(
                  ([column, value]: [string, unknown]): boolean => {
                    return policy[column] === value;
                  },
                );
              })
              .map((policy: Record<string, unknown>): OnCallDutyPolicy => {
                return Object.assign(new OnCallDutyPolicy(), policy);
              })
          : [];

      return {
        data: matching,
        count: matching.length,
        skip: 0,
        limit: matching.length,
      };
    }) as unknown as typeof ModelAPI.getList);
    api["loadPolicyChoices"]!.mockImplementation(() => {
      return realApi.loadPolicyChoices();
    });
  };

  const offeredIds: () => Array<string> = (): Array<string> => {
    return Array.from(
      screen
        .getByTestId("on-call-setup-policy-choice")
        .querySelectorAll("option"),
    ).map((option: HTMLOptionElement): string => {
      return option.value;
    });
  };

  test("a project whose only policy is archived: the setup makes one, paging who is picked", async () => {
    holds([{ _id: ARCHIVED_ID, name: "Old rota", isArchived: true }]);
    keepRun({ reachConfirmed: true });
    await renderSetup();

    expect(stepState("who_else")).toBe("open");
    // Making one, not "already has on-call policies".
    expect(screen.queryByTestId("on-call-setup-policy-choice")).toBeNull();
    expect(
      screen.getByText(
        'This makes the on-call policy "Default on-call policy". It pages these people first, for every new incident and alert in this project.',
      ),
    ).toBeInTheDocument();

    await press("on-call-setup-who-save");

    expect(api["createPolicy"]).toHaveBeenCalledTimes(1);
    expect(api["createPolicy"]).toHaveBeenCalledWith(
      expect.objectContaining({ userIds: [USER_ID], addRules: true }),
    );
    expect(api["addToFirstLevel"]).not.toHaveBeenCalled();
    expect(storedRun()["policyId"]).toBe(POLICY_ID);
    expect(storedRun()["policyIsExisting"]).toBeUndefined();
  });

  test("Save and continue's read just before making one leaves the archived policy out too, so one is made", async () => {
    holds([{ _id: ARCHIVED_ID, name: "Old rota", isArchived: true }]);
    keepRun({ reachConfirmed: true });
    await renderSetup();
    await press("on-call-setup-who-save");

    // Read as the page opened, and again just before the policy was made.
    expect(api["loadPolicyChoices"]).toHaveBeenCalledTimes(2);
    expect(api["createPolicy"]).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByTestId("on-call-setup-policy-made-elsewhere"),
    ).toBeNull();
  });

  test("an archived policy beside one in service: only the one in service is offered, and the people join it", async () => {
    holds([
      { _id: ARCHIVED_ID, name: "Old rota", isArchived: true },
      { _id: LIVE_ID, name: "Payments", isArchived: false },
    ]);
    keepRun({ reachConfirmed: true });
    api["loadPolicy"]!.mockResolvedValue(
      policyRecord({ id: LIVE_ID, name: "Payments" }),
    );
    await renderSetup();

    expect(offeredIds()).toEqual([LIVE_ID]);
    expect(screen.getByTestId("on-call-setup-policy-choice")).toHaveValue(
      LIVE_ID,
    );
    expect(
      screen.getByTestId("on-call-setup-policy-choice"),
    ).not.toHaveTextContent("Old rota");

    await pressText("Add Ben to on-call-setup-people");
    await press("on-call-setup-who-save");

    expect(api["createPolicy"]).not.toHaveBeenCalled();
    expect(api["addToFirstLevel"]).toHaveBeenCalledWith(
      expect.objectContaining({ policyId: LIVE_ID }),
    );
    expect(storedRun()["policyId"]).toBe(LIVE_ID);
    expect(storedRun()["policyIsExisting"]).toBe(true);
  });

  test("a project with policies in service only: every one is offered, as before", async () => {
    holds([
      { _id: LIVE_ID, name: "Payments", isArchived: false },
      { _id: POLICY_ID, name: "Default on-call policy", isArchived: false },
    ]);
    keepRun({ reachConfirmed: true });
    await renderSetup();

    expect(offeredIds().sort()).toEqual([LIVE_ID, POLICY_ID].sort());
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

  /*
   * ISSUE #7154: the summary named who is paged and by what, never in which
   * order. It says the order a page reaches each person - their own How to
   * Reach Me, as "Test this policy" previews it on the server.
   */
  test("says the order a page reaches each person, as the test page's preview reads it (#7154)", async () => {
    keepRun({
      reachConfirmed: true,
      policyId: POLICY_ID,
      noAnswerDone: true,
      testExecutionLogId: "log-1",
    });
    api["loadReachOrders"]!.mockResolvedValue({
      [USER_ID]: [
        { channel: OnCallPageChannel.SMS, notifyAfterMinutes: 0 },
        { channel: OnCallPageChannel.Call, notifyAfterMinutes: 5 },
      ],
    });
    await renderSetup();

    await waitFor(() => {
      expect(
        screen.getByTestId("on-call-setup-summary-first"),
      ).toHaveTextContent(
        'Any new incident or alert runs "Default on-call policy", which pages Ana Lopez (SMS at once, then phone call after 5 minutes).',
      );
    });
    // The policy's own preview: nothing is worked out a second time here.
    expect(api["loadReachOrders"]).toHaveBeenCalledWith(POLICY_ID);
  });

  test("an order that cannot be read leaves the summary naming how each person is reached (#7154)", async () => {
    keepRun({
      reachConfirmed: true,
      policyId: POLICY_ID,
      noAnswerDone: true,
      testExecutionLogId: "log-1",
    });
    api["loadReachOrders"]!.mockResolvedValue(null);
    await renderSetup();

    await waitFor(() => {
      expect(api["loadReachOrders"]).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId("on-call-setup-summary-first")).toHaveTextContent(
      "which pages Ana Lopez (Email, SMS).",
    );
  });

  test("the order is read only once the summary shows, never on the steps", async () => {
    keepRun({ reachConfirmed: true, policyId: POLICY_ID });
    await renderSetup();

    expect(stepState("no_answer")).toBe("open");
    expect(api["loadReachOrders"]).not.toHaveBeenCalled();
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
      "Ask a Project Owner or Project Admin",
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
      translator: expect.anything(),
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
 * THE RUN'S POLICY DELETED WHILE THE PAGE IS OPEN (#7516) - in another tab,
 * or by a teammate. Continue on "Who else is on call?" read the policy
 * again, found it gone, and opened "What if nobody answers?" anyway, whose
 * Save then did nothing at all: the person was stuck until they reloaded.
 * Every step that needs the policy reads it again just before it moves on;
 * gone, the run forgets it (as the page does when it opens on a policy
 * that is gone), the project's policies are read again, and step 2 opens
 * on making or picking one, saying why first, in its polite live region.
 */
describe("the run's policy deleted in another tab or by a teammate (#7516)", () => {
  const DELETED: string =
    "The on-call policy this setup was using was deleted, so pick or make one again.";
  const OTHER_POLICY_ID: string = "60000000-0000-4000-8000-000000000002";

  const NO_POLICY_LEFT: Record<string, unknown> = {
    policies: [],
    mayCreatePolicy: true,
    mayAddRules: true,
    mayEditLevels: true,
  };

  const ONLY_THE_RUNS_POLICY: Record<string, unknown> = {
    policies: [{ id: POLICY_ID, name: "Default on-call policy" }],
    mayCreatePolicy: true,
    mayAddRules: true,
    mayEditLevels: true,
  };

  // What the run keeps once it has forgotten its policy: who is reached.
  const FORGOTTEN: Record<string, unknown> = { reachConfirmed: true };

  // Step 2 open on the run's policy, as it is after Save and continue.
  const atWhoElse: (policy?: OnCallPolicyRecord) => Promise<void> = async (
    policy?: OnCallPolicyRecord,
  ): Promise<void> => {
    keepRun({
      reachConfirmed: true,
      policyId: POLICY_ID,
      policyIsExisting: true,
    });
    api["loadPolicyChoices"]!.mockResolvedValue(ONLY_THE_RUNS_POLICY);
    api["loadPolicy"]!.mockResolvedValue(policy || policyRecord());
    await renderSetup();
    await act(async () => {
      fireEvent.click(
        screen
          .getByTestId("guided-setup-step-who_else")
          .querySelector("button")!,
      );
    });
    expect(stepState("who_else")).toBe("open");
    expect(screen.getByTestId("on-call-setup-who-continue")).toBeVisible();
  };

  // Another tab, or a teammate, deletes the policy; nothing is left.
  const deleteThePolicy: (choicesAfter?: Record<string, unknown>) => void = (
    choicesAfter?: Record<string, unknown>,
  ): void => {
    api["loadPolicy"]!.mockResolvedValue(null);
    api["loadPolicyChoices"]!.mockResolvedValue(choicesAfter || NO_POLICY_LEFT);
  };

  // The run forgot its policy, and step 2 is open on making one, saying why.
  const expectStepTwoAgain: () => void = (): void => {
    expect(storedRun()).toEqual(FORGOTTEN);
    expect(stepState("reach_you")).toBe("done");
    expect(stepState("who_else")).toBe("open");
    expect(stepState("no_answer")).toBe("upcoming");
    expect(stepState("test")).toBe("upcoming");
    expect(
      screen.getByTestId("on-call-setup-policy-deleted"),
    ).toHaveTextContent(DELETED);
    expect(
      screen
        .getByTestId("on-call-setup-who-help")
        .contains(screen.getByTestId("on-call-setup-policy-deleted")),
    ).toBe(true);
    expect(screen.queryByRole("alert")).toBeNull();
  };

  test("Continue with rules to add: none is added, the run forgets the policy, and step 2 opens on making one, saying why", async () => {
    await atWhoElse(policyRecord({ alertRuleCount: 0 }));
    expect(screen.getByTestId("on-call-setup-who-continue")).toHaveTextContent(
      "Page this policy for every new incident and alert",
    );

    deleteThePolicy();
    await press("on-call-setup-who-continue");

    expect(api["addEveryNewEventRules"]).not.toHaveBeenCalled();
    expectStepTwoAgain();
    // The project's policies were read again: making one is offered.
    expect(api["loadPolicyChoices"]).toHaveBeenCalledTimes(2);
    expect(
      screen.getByText(
        'This makes the on-call policy "Default on-call policy". It pages these people first, for every new incident and alert in this project.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("on-call-setup-who-save")).toBeVisible();
    expect(screen.queryByTestId("on-call-setup-who-continue")).toBeNull();
    // Nothing of the policy is left on the page.
    expect(screen.queryByTestId("on-call-setup-policy")).toBeNull();
    expect(screen.queryByTestId("on-call-setup-readiness")).toBeNull();
  });

  test("Continue with no rule missing: the same, and step 3 never opens on a policy that is gone", async () => {
    await atWhoElse();
    expect(screen.getByTestId("on-call-setup-who-continue")).toHaveTextContent(
      "Continue",
    );

    deleteThePolicy();
    await press("on-call-setup-who-continue");

    expect(api["loadPolicy"]).toHaveBeenLastCalledWith(POLICY_ID);
    expectStepTwoAgain();
    expect(screen.queryByTestId("on-call-setup-no-answer-save")).toBeNull();
  });

  /*
   * Continue stays where Save and continue is, so nothing else tells a
   * screen reader why the step changed: the region it reads out is the one
   * that held the policy's line before, and now holds why and what to do.
   */
  test("the sentence is read out: the step's polite live region, there before Continue, says it", async () => {
    await atWhoElse();
    const region: HTMLElement = screen.getByTestId("on-call-setup-who-help");

    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveTextContent('"Default on-call policy" pages');
    expect(region).not.toHaveTextContent(DELETED);

    deleteThePolicy();
    await press("on-call-setup-who-continue");

    expect(screen.getByTestId("on-call-setup-who-help")).toBe(region);
    expect(region).toHaveTextContent(DELETED);
    expect(region).toHaveTextContent(
      'This makes the on-call policy "Default on-call policy".',
    );
    // Why first, then what to do.
    expect(region.firstElementChild).toBe(
      screen.getByTestId("on-call-setup-policy-deleted"),
    );
    // The picker and the button are not read out with it.
    expect(region.contains(screen.getByTestId("on-call-setup-who-save"))).toBe(
      false,
    );
  });

  test("deleted, while the project has other policies: step 2 turns to them, the deleted one not among them", async () => {
    await atWhoElse();
    deleteThePolicy({
      policies: [{ id: OTHER_POLICY_ID, name: "Ops" }],
      mayCreatePolicy: true,
      mayAddRules: true,
      mayEditLevels: true,
    });
    await press("on-call-setup-who-continue");

    expectStepTwoAgain();
    expect(
      Array.from(
        screen
          .getByTestId("on-call-setup-policy-choice")
          .querySelectorAll("option"),
      ).map((option: HTMLOptionElement): string => {
        return option.value;
      }),
    ).toEqual([OTHER_POLICY_ID]);
    expect(screen.getByTestId("on-call-setup-policy-choice")).toHaveValue(
      OTHER_POLICY_ID,
    );

    // Picking it sets the run up again, and the reason is said no more.
    api["loadPolicy"]!.mockResolvedValue(
      policyRecord({ id: OTHER_POLICY_ID, name: "Ops" }),
    );
    await press("on-call-setup-who-save");

    expect(storedRun()).toEqual({
      reachConfirmed: true,
      policyId: OTHER_POLICY_ID,
      policyIsExisting: true,
    });
    expect(screen.queryByTestId("on-call-setup-policy-deleted")).toBeNull();
    expect(stepState("no_answer")).toBe("open");
  });

  test("the project's policies that cannot be read again: the ones read before, without the deleted one", async () => {
    keepRun({
      reachConfirmed: true,
      policyId: POLICY_ID,
      policyIsExisting: true,
    });
    api["loadPolicyChoices"]!.mockResolvedValue({
      policies: [
        { id: POLICY_ID, name: "Default on-call policy" },
        { id: OTHER_POLICY_ID, name: "Ops" },
      ],
      mayCreatePolicy: true,
      mayAddRules: true,
      mayEditLevels: true,
    });
    await renderSetup();
    await act(async () => {
      fireEvent.click(
        screen
          .getByTestId("guided-setup-step-who_else")
          .querySelector("button")!,
      );
    });

    api["loadPolicy"]!.mockResolvedValue(null);
    api["loadPolicyChoices"]!.mockRejectedValue(new Error("offline"));
    await press("on-call-setup-who-continue");

    expectStepTwoAgain();
    expect(
      Array.from(
        screen
          .getByTestId("on-call-setup-policy-choice")
          .querySelectorAll("option"),
      ).map((option: HTMLOptionElement): string => {
        return option.value;
      }),
    ).toEqual([OTHER_POLICY_ID]);
  });

  test("a policy picked from the project's, deleted since they were read: nothing is added to it, and the step offers them as they are now", async () => {
    keepRun({ reachConfirmed: true });
    api["loadPolicyChoices"]!.mockResolvedValue({
      policies: [
        { id: POLICY_ID, name: "Default on-call policy" },
        { id: OTHER_POLICY_ID, name: "Ops" },
      ],
      mayCreatePolicy: true,
      mayAddRules: true,
      mayEditLevels: true,
    });
    await renderSetup();
    expect(screen.getByTestId("on-call-setup-policy-choice")).toHaveValue(
      POLICY_ID,
    );

    deleteThePolicy({
      policies: [{ id: OTHER_POLICY_ID, name: "Ops" }],
      mayCreatePolicy: true,
      mayAddRules: true,
      mayEditLevels: true,
    });
    await pressText("Add Ben to on-call-setup-people");
    await press("on-call-setup-who-save");

    expect(api["addToFirstLevel"]).not.toHaveBeenCalled();
    expectStepTwoAgain();
    expect(screen.getByTestId("on-call-setup-policy-choice")).toHaveValue(
      OTHER_POLICY_ID,
    );
  });

  test("a policy read that fails on Continue: nothing is forgotten, and the step says why and stays", async () => {
    await atWhoElse(policyRecord({ alertRuleCount: 0 }));

    api["loadPolicy"]!.mockRejectedValue(
      new Error("The server could not be reached."),
    );
    await press("on-call-setup-who-continue");

    expect(storedRun()).toEqual({
      reachConfirmed: true,
      policyId: POLICY_ID,
      policyIsExisting: true,
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The server could not be reached.",
    );
    expect(screen.queryByTestId("on-call-setup-policy-deleted")).toBeNull();
    expect(screen.getByTestId("on-call-setup-who-continue")).toBeVisible();
    expect(stepState("who_else")).toBe("open");
  });

  test("someone who may not make a policy, its only one deleted: told why, and who can", async () => {
    await atWhoElse();
    deleteThePolicy({
      policies: [],
      mayCreatePolicy: false,
      mayAddRules: false,
      mayEditLevels: false,
    });
    await press("on-call-setup-who-continue");

    expect(storedRun()).toEqual(FORGOTTEN);
    expect(stepState("who_else")).toBe("open");

    const cannot: HTMLElement = screen.getByTestId(
      "on-call-setup-cannot-create",
    );

    expect(cannot).toHaveTextContent(DELETED);
    expect(cannot).toHaveTextContent("Ask a Project Owner or Project Admin");
    expect(screen.getByTestId("on-call-setup-who-help")).toHaveAttribute(
      "aria-live",
      "polite",
    );
    expect(screen.queryByTestId("on-call-setup-who-save")).toBeNull();
  });

  test("made again, the reason is said no more; nor after Set up another policy", async () => {
    await atWhoElse();
    deleteThePolicy();
    await press("on-call-setup-who-continue");
    expect(screen.getByTestId("on-call-setup-policy-deleted")).toBeVisible();

    api["loadPolicy"]!.mockResolvedValue(policyRecord());
    await press("on-call-setup-who-save");

    expect(api["createPolicy"]).toHaveBeenCalledTimes(1);
    expect(storedRun()["policyId"]).toBe(POLICY_ID);
    expect(stepState("no_answer")).toBe("open");

    // Back to step 2, now done: its policy, and no reason.
    await act(async () => {
      fireEvent.click(
        screen
          .getByTestId("guided-setup-step-who_else")
          .querySelector("button")!,
      );
    });
    expect(screen.queryByTestId("on-call-setup-policy-deleted")).toBeNull();
  });

  describe("on step 3, what if nobody answers", () => {
    const atNoAnswer: () => Promise<void> = async (): Promise<void> => {
      keepRun({ reachConfirmed: true, policyId: POLICY_ID });
      await renderSetup();
      expect(stepState("no_answer")).toBe("open");
    };

    test("Save, to page someone else: nothing is written, the run forgets the policy, and step 2 opens with why", async () => {
      await atNoAnswer();
      await pressText("Add Ben to on-call-setup-next-people");

      deleteThePolicy();
      await press("on-call-setup-no-answer-save");

      expect(api["addSecondLevel"]).not.toHaveBeenCalled();
      expectStepTwoAgain();
    });

    test("Save, to page again: nothing is written to a policy that is gone", async () => {
      await atNoAnswer();
      await press("choice-repeat");

      deleteThePolicy();
      await press("on-call-setup-no-answer-save");

      expect(api["setRepeat"]).not.toHaveBeenCalled();
      expectStepTwoAgain();
    });

    test("Do nothing more: what if nobody answers is not saved as done, and step 2 opens with why", async () => {
      await atNoAnswer();
      await press("choice-nothing");

      deleteThePolicy();
      await press("on-call-setup-no-answer-save");

      expect(storedRun()["noAnswerDone"]).toBeUndefined();
      expectStepTwoAgain();
    });

    test("a policy that already escalates, deleted: Continue opens step 2 with why", async () => {
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
      expect(screen.getByTestId("on-call-setup-has-levels")).toBeVisible();

      deleteThePolicy();
      await press("on-call-setup-no-answer-save");

      expectStepTwoAgain();
    });

    test("deleted just after the second level was saved: forgotten, and the test step never opens", async () => {
      await atNoAnswer();
      await pressText("Add Ben to on-call-setup-next-people");

      // Read just before: there. Read again once saved: gone.
      api["loadPolicy"]!.mockResolvedValueOnce(policyRecord());
      api["loadPolicy"]!.mockResolvedValue(null);
      api["loadPolicyChoices"]!.mockResolvedValue(NO_POLICY_LEFT);
      await press("on-call-setup-no-answer-save");

      expect(api["addSecondLevel"]).toHaveBeenCalledTimes(1);
      expectStepTwoAgain();
    });

    test("a policy read that fails: nothing is written or forgotten, and the step says why", async () => {
      await atNoAnswer();
      await press("choice-repeat");

      api["loadPolicy"]!.mockRejectedValue(
        new Error("The server could not be reached."),
      );
      await press("on-call-setup-no-answer-save");

      expect(api["setRepeat"]).not.toHaveBeenCalled();
      expect(storedRun()).toEqual({
        reachConfirmed: true,
        policyId: POLICY_ID,
      });
      expect(screen.getByRole("alert")).toHaveTextContent(
        "The server could not be reached.",
      );
      expect(stepState("no_answer")).toBe("open");
    });

    test("saved, and the read after it fails: saved once, and the step moves on", async () => {
      await atNoAnswer();
      await press("choice-repeat");

      api["loadPolicy"]!.mockResolvedValueOnce(policyRecord());
      api["loadPolicy"]!.mockRejectedValue(new Error("offline"));
      await press("on-call-setup-no-answer-save");

      expect(api["setRepeat"]).toHaveBeenCalledTimes(1);
      expect(storedRun()["noAnswerDone"]).toBe(true);
      expect(stepState("test")).toBe("open");
    });
  });

  describe("on step 4, the test page", () => {
    const atTest: () => Promise<void> = async (): Promise<void> => {
      keepRun({
        reachConfirmed: true,
        policyId: POLICY_ID,
        noAnswerDone: true,
      });
      await renderSetup();
      expect(stepState("test")).toBe("open");
    };

    test("Skip: no summary of a policy that is gone; step 2 opens with why", async () => {
      await atTest();

      deleteThePolicy();
      await press("on-call-setup-skip-test");

      expect(storedRun()["testSkipped"]).toBeUndefined();
      expect(screen.queryByTestId("guided-setup-summary")).toBeNull();
      expectStepTwoAgain();
    });

    test("the test dialog closes on a policy deleted meanwhile: step 2 opens with why", async () => {
      await atTest();

      deleteThePolicy();
      await press("close-test-page");

      await waitFor(() => {
        expect(stepState("who_else")).toBe("open");
      });
      expectStepTwoAgain();
    });

    test("the test dialog closes on a policy still there: nothing changes", async () => {
      await atTest();
      await press("close-test-page");

      expect(stepState("test")).toBe("open");
      expect(storedRun()).toEqual({
        reachConfirmed: true,
        policyId: POLICY_ID,
        noAnswerDone: true,
      });
      expect(screen.queryByTestId("on-call-setup-policy-deleted")).toBeNull();
    });

    test("the test dialog closes and the read fails: nothing changes, and nothing is said", async () => {
      await atTest();
      api["loadPolicy"]!.mockRejectedValue(new Error("offline"));
      await press("close-test-page");

      expect(stepState("test")).toBe("open");
      expect(storedRun()["policyId"]).toBe(POLICY_ID);
      expect(screen.queryByRole("alert")).toBeNull();
    });

    test("Skip, with the policy still there: the summary, as before", async () => {
      await atTest();
      await press("on-call-setup-skip-test");

      expect(api["loadPolicy"]).toHaveBeenLastCalledWith(POLICY_ID);
      expect(storedRun()["testSkipped"]).toBe(true);
      expect(screen.getByTestId("guided-setup-summary")).toBeInTheDocument();
    });
  });

  describe("coming back", () => {
    test("to a run whose policy was deleted: step 2, saying why", async () => {
      keepRun({
        reachConfirmed: true,
        policyId: POLICY_ID,
        noAnswerDone: true,
        testExecutionLogId: "log-1",
        testSkipped: true,
      });
      api["loadPolicy"]!.mockResolvedValue(null);
      await renderSetup();

      expectStepTwoAgain();
      expect(getResultMock).not.toHaveBeenCalled();
    });

    test("a policy read that fails as the page opens: the page says so, and the run is kept", async () => {
      const run: Record<string, unknown> = {
        reachConfirmed: true,
        policyId: POLICY_ID,
        noAnswerDone: true,
      };
      keepRun(run);
      api["loadPolicy"]!.mockRejectedValue(
        new Error("The server could not be reached."),
      );

      await act(async () => {
        render(<OnCallGuidedSetup />);
      });

      await waitFor(() => {
        expect(
          screen.getByText("The server could not be reached."),
        ).toBeInTheDocument();
      });
      expect(storedRun()).toEqual(run);
      expect(screen.queryByTestId("on-call-setup-policy-deleted")).toBeNull();
    });

    test("a run whose policy is there says nothing of a deleted one", async () => {
      keepRun({ reachConfirmed: true, policyId: POLICY_ID });
      await renderSetup();

      expect(screen.queryByTestId("on-call-setup-policy-deleted")).toBeNull();
    });
  });
});

/*
 * THE RUN'S POLICY ARCHIVED - in another tab, or by a teammate - while the
 * page was open (#8432). An archived policy is still there, but pages no
 * one: incidents and alerts that use it skip it. The setup read it as
 * "still there" and went on adding levels to it, testing it, and summing it
 * up as paging people. Now it is forgotten as a deleted one is, and step 2
 * says, in a sentence of its own, that it was archived.
 */
describe("the run's policy archived in another tab or by a teammate (#8432)", () => {
  const ARCHIVED: string =
    "The on-call policy this setup was using was archived, so it pages no one. Pick or make one again.";
  const DELETED: string =
    "The on-call policy this setup was using was deleted, so pick or make one again.";
  const OTHER_POLICY_ID: string = "60000000-0000-4000-8000-000000000002";

  // The project's policies in service, as loadPolicyChoices reads them.
  const NO_POLICY_IN_SERVICE: Record<string, unknown> = {
    policies: [],
    mayCreatePolicy: true,
    mayAddRules: true,
    mayEditLevels: true,
  };

  const ONLY_THE_RUNS_POLICY: Record<string, unknown> = {
    policies: [{ id: POLICY_ID, name: "Default on-call policy" }],
    mayCreatePolicy: true,
    mayAddRules: true,
    mayEditLevels: true,
  };

  // What the run keeps once it has forgotten its policy: who is reached.
  const FORGOTTEN: Record<string, unknown> = { reachConfirmed: true };

  const archived: (
    overrides?: Partial<OnCallPolicyRecord>,
  ) => OnCallPolicyRecord = (
    overrides?: Partial<OnCallPolicyRecord>,
  ): OnCallPolicyRecord => {
    return policyRecord({ ...overrides, isArchived: true });
  };

  // Step 2 open on the run's policy, as it is after Save and continue.
  const atWhoElse: (policy?: OnCallPolicyRecord) => Promise<void> = async (
    policy?: OnCallPolicyRecord,
  ): Promise<void> => {
    keepRun({
      reachConfirmed: true,
      policyId: POLICY_ID,
      policyIsExisting: true,
    });
    api["loadPolicyChoices"]!.mockResolvedValue(ONLY_THE_RUNS_POLICY);
    api["loadPolicy"]!.mockResolvedValue(policy || policyRecord());
    await renderSetup();
    await act(async () => {
      fireEvent.click(
        screen
          .getByTestId("guided-setup-step-who_else")
          .querySelector("button")!,
      );
    });
    expect(stepState("who_else")).toBe("open");
    expect(screen.getByTestId("on-call-setup-who-continue")).toBeVisible();
  };

  /*
   * Another tab, or a teammate, archives the policy: it still reads, now
   * archived, and the project's policies in service no longer list it.
   */
  const archiveThePolicy: (choicesAfter?: Record<string, unknown>) => void = (
    choicesAfter?: Record<string, unknown>,
  ): void => {
    api["loadPolicy"]!.mockResolvedValue(archived());
    api["loadPolicyChoices"]!.mockResolvedValue(
      choicesAfter || NO_POLICY_IN_SERVICE,
    );
  };

  // The run forgot its policy, and step 2 is open on making one, saying it was archived.
  const expectStepTwoAgain: () => void = (): void => {
    expect(storedRun()).toEqual(FORGOTTEN);
    expect(stepState("reach_you")).toBe("done");
    expect(stepState("who_else")).toBe("open");
    expect(stepState("no_answer")).toBe("upcoming");
    expect(stepState("test")).toBe("upcoming");
    expect(
      screen.getByTestId("on-call-setup-policy-archived"),
    ).toHaveTextContent(ARCHIVED);
    // Its own sentence: never the deleted one's.
    expect(screen.queryByTestId("on-call-setup-policy-deleted")).toBeNull();
    expect(screen.queryByText(DELETED)).toBeNull();
    expect(
      screen
        .getByTestId("on-call-setup-who-help")
        .contains(screen.getByTestId("on-call-setup-policy-archived")),
    ).toBe(true);
    expect(screen.queryByRole("alert")).toBeNull();
    // Nothing of the archived policy is left on the page.
    expect(screen.queryByTestId("on-call-setup-policy")).toBeNull();
    expect(screen.queryByTestId("guided-setup-summary")).toBeNull();
  };

  describe("on step 2, who else is on call", () => {
    test("Continue with rules to add: none is added to the archived policy, the run forgets it, and step 2 opens on making one, saying why", async () => {
      await atWhoElse(policyRecord({ alertRuleCount: 0 }));
      expect(
        screen.getByTestId("on-call-setup-who-continue"),
      ).toHaveTextContent("Page this policy for every new incident and alert");

      archiveThePolicy();
      await press("on-call-setup-who-continue");

      expect(api["addEveryNewEventRules"]).not.toHaveBeenCalled();
      expectStepTwoAgain();
      // The project's policies were read again: making one is offered.
      expect(api["loadPolicyChoices"]).toHaveBeenCalledTimes(2);
      expect(
        screen.getByText(
          'This makes the on-call policy "Default on-call policy". It pages these people first, for every new incident and alert in this project.',
        ),
      ).toBeInTheDocument();
      expect(screen.getByTestId("on-call-setup-who-save")).toBeVisible();
      expect(screen.queryByTestId("on-call-setup-who-continue")).toBeNull();
      expect(screen.queryByTestId("on-call-setup-readiness")).toBeNull();
    });

    test("Continue with no rule missing: the same, and step 3 never opens on an archived policy", async () => {
      await atWhoElse();
      expect(
        screen.getByTestId("on-call-setup-who-continue"),
      ).toHaveTextContent("Continue");

      archiveThePolicy();
      await press("on-call-setup-who-continue");

      expect(api["loadPolicy"]).toHaveBeenLastCalledWith(POLICY_ID);
      expectStepTwoAgain();
      expect(screen.queryByTestId("on-call-setup-no-answer-save")).toBeNull();
    });

    // The same policy, in service: Continue moves on, as it always did.
    test("negative control: the policy read in service (isArchived false) moves on, and nothing is forgotten", async () => {
      await atWhoElse();
      api["loadPolicy"]!.mockResolvedValue(policyRecord({ isArchived: false }));
      await press("on-call-setup-who-continue");

      expect(storedRun()).toEqual({
        reachConfirmed: true,
        policyId: POLICY_ID,
        policyIsExisting: true,
      });
      expect(stepState("no_answer")).toBe("open");
      expect(screen.queryByTestId("on-call-setup-policy-archived")).toBeNull();
      expect(api["loadPolicyChoices"]).toHaveBeenCalledTimes(1);
    });

    test("the sentence is read out: the step's polite live region, there before Continue, says it first", async () => {
      await atWhoElse();
      const region: HTMLElement = screen.getByTestId("on-call-setup-who-help");

      expect(region).toHaveAttribute("aria-live", "polite");
      expect(region).not.toHaveTextContent(ARCHIVED);

      archiveThePolicy();
      await press("on-call-setup-who-continue");

      expect(screen.getByTestId("on-call-setup-who-help")).toBe(region);
      expect(region).toHaveTextContent(ARCHIVED);
      expect(region.firstElementChild).toBe(
        screen.getByTestId("on-call-setup-policy-archived"),
      );
      expect(
        region.contains(screen.getByTestId("on-call-setup-who-save")),
      ).toBe(false);
    });

    test("archived, while the project has other policies in service: step 2 turns to them, the archived one not among them", async () => {
      await atWhoElse();
      archiveThePolicy({
        policies: [{ id: OTHER_POLICY_ID, name: "Ops" }],
        mayCreatePolicy: true,
        mayAddRules: true,
        mayEditLevels: true,
      });
      await press("on-call-setup-who-continue");

      expectStepTwoAgain();
      expect(
        Array.from(
          screen
            .getByTestId("on-call-setup-policy-choice")
            .querySelectorAll("option"),
        ).map((option: HTMLOptionElement): string => {
          return option.value;
        }),
      ).toEqual([OTHER_POLICY_ID]);

      // Picking it sets the run up again, and the reason is said no more.
      api["loadPolicy"]!.mockResolvedValue(
        policyRecord({ id: OTHER_POLICY_ID, name: "Ops" }),
      );
      await press("on-call-setup-who-save");

      expect(storedRun()).toEqual({
        reachConfirmed: true,
        policyId: OTHER_POLICY_ID,
        policyIsExisting: true,
      });
      expect(screen.queryByTestId("on-call-setup-policy-archived")).toBeNull();
      expect(stepState("no_answer")).toBe("open");
    });

    test("the project's policies that cannot be read again: the ones read before, without the archived one", async () => {
      keepRun({
        reachConfirmed: true,
        policyId: POLICY_ID,
        policyIsExisting: true,
      });
      api["loadPolicyChoices"]!.mockResolvedValue({
        policies: [
          { id: POLICY_ID, name: "Default on-call policy" },
          { id: OTHER_POLICY_ID, name: "Ops" },
        ],
        mayCreatePolicy: true,
        mayAddRules: true,
        mayEditLevels: true,
      });
      await renderSetup();
      await act(async () => {
        fireEvent.click(
          screen
            .getByTestId("guided-setup-step-who_else")
            .querySelector("button")!,
        );
      });

      api["loadPolicy"]!.mockResolvedValue(archived());
      api["loadPolicyChoices"]!.mockRejectedValue(new Error("offline"));
      await press("on-call-setup-who-continue");

      expectStepTwoAgain();
      expect(
        Array.from(
          screen
            .getByTestId("on-call-setup-policy-choice")
            .querySelectorAll("option"),
        ).map((option: HTMLOptionElement): string => {
          return option.value;
        }),
      ).toEqual([OTHER_POLICY_ID]);
    });

    test("a policy picked from the project's, archived since they were read: nobody is added to it, and the step offers them as they are now", async () => {
      keepRun({ reachConfirmed: true });
      api["loadPolicyChoices"]!.mockResolvedValue({
        policies: [
          { id: POLICY_ID, name: "Default on-call policy" },
          { id: OTHER_POLICY_ID, name: "Ops" },
        ],
        mayCreatePolicy: true,
        mayAddRules: true,
        mayEditLevels: true,
      });
      await renderSetup();
      expect(screen.getByTestId("on-call-setup-policy-choice")).toHaveValue(
        POLICY_ID,
      );

      archiveThePolicy({
        policies: [{ id: OTHER_POLICY_ID, name: "Ops" }],
        mayCreatePolicy: true,
        mayAddRules: true,
        mayEditLevels: true,
      });
      await pressText("Add Ben to on-call-setup-people");
      await press("on-call-setup-who-save");

      expect(api["addToFirstLevel"]).not.toHaveBeenCalled();
      expect(api["createPolicy"]).not.toHaveBeenCalled();
      expectStepTwoAgain();
      expect(screen.getByTestId("on-call-setup-policy-choice")).toHaveValue(
        OTHER_POLICY_ID,
      );
    });

    test("someone who may not make a policy, its only one archived: told why, and who can", async () => {
      await atWhoElse();
      archiveThePolicy({
        policies: [],
        mayCreatePolicy: false,
        mayAddRules: false,
        mayEditLevels: false,
      });
      await press("on-call-setup-who-continue");

      expect(storedRun()).toEqual(FORGOTTEN);

      const cannot: HTMLElement = screen.getByTestId(
        "on-call-setup-cannot-create",
      );

      expect(cannot).toHaveTextContent(ARCHIVED);
      expect(cannot).not.toHaveTextContent(DELETED);
      expect(cannot).toHaveTextContent("Ask a Project Owner or Project Admin");
      expect(screen.getByTestId("on-call-setup-who-help")).toHaveAttribute(
        "aria-live",
        "polite",
      );
    });

    test("made again, the reason is said no more", async () => {
      await atWhoElse();
      archiveThePolicy();
      await press("on-call-setup-who-continue");
      expect(screen.getByTestId("on-call-setup-policy-archived")).toBeVisible();

      api["loadPolicy"]!.mockResolvedValue(policyRecord());
      await press("on-call-setup-who-save");

      expect(api["createPolicy"]).toHaveBeenCalledTimes(1);
      expect(storedRun()["policyId"]).toBe(POLICY_ID);
      expect(stepState("no_answer")).toBe("open");
      expect(screen.queryByTestId("on-call-setup-policy-archived")).toBeNull();
    });

    // The made policy read back archived: never taken for one in service.
    test("a policy just made that reads back archived is forgotten too, never moved on with", async () => {
      keepRun({ reachConfirmed: true });
      await renderSetup();
      api["loadPolicy"]!.mockResolvedValue(archived());
      await press("on-call-setup-who-save");

      expect(api["createPolicy"]).toHaveBeenCalledTimes(1);
      expect(stepState("no_answer")).toBe("upcoming");
      expect(screen.getByTestId("on-call-setup-policy-archived")).toBeVisible();
      expect(storedRun()).toEqual(FORGOTTEN);
    });

    test("deleted and archived each say their own sentence: deleted after archived says deleted", async () => {
      await atWhoElse();
      archiveThePolicy({
        policies: [{ id: OTHER_POLICY_ID, name: "Ops" }],
        mayCreatePolicy: true,
        mayAddRules: true,
        mayEditLevels: true,
      });
      await press("on-call-setup-who-continue");
      expect(screen.getByTestId("on-call-setup-policy-archived")).toBeVisible();

      // Ops is picked, and was deleted meanwhile: the newer reason is said.
      api["loadPolicy"]!.mockResolvedValue(null);
      api["loadPolicyChoices"]!.mockResolvedValue(NO_POLICY_IN_SERVICE);
      await press("on-call-setup-who-save");

      expect(
        screen.getByTestId("on-call-setup-policy-deleted"),
      ).toHaveTextContent(DELETED);
      expect(screen.queryByTestId("on-call-setup-policy-archived")).toBeNull();
      expect(screen.queryByText(ARCHIVED)).toBeNull();
    });
  });

  describe("on step 3, what if nobody answers", () => {
    const atNoAnswer: () => Promise<void> = async (): Promise<void> => {
      keepRun({ reachConfirmed: true, policyId: POLICY_ID });
      await renderSetup();
      expect(stepState("no_answer")).toBe("open");
    };

    test("Save, to page someone else: no level is added to the archived policy, and step 2 opens with why", async () => {
      await atNoAnswer();
      await pressText("Add Ben to on-call-setup-next-people");

      archiveThePolicy();
      await press("on-call-setup-no-answer-save");

      expect(api["addSecondLevel"]).not.toHaveBeenCalled();
      expectStepTwoAgain();
    });

    test("Save, to page again: no repeat is set on the archived policy", async () => {
      await atNoAnswer();
      await press("choice-repeat");

      archiveThePolicy();
      await press("on-call-setup-no-answer-save");

      expect(api["setRepeat"]).not.toHaveBeenCalled();
      expectStepTwoAgain();
    });

    test("Do nothing more: not saved as done, and step 2 opens with why", async () => {
      await atNoAnswer();
      await press("choice-nothing");

      archiveThePolicy();
      await press("on-call-setup-no-answer-save");

      expect(storedRun()["noAnswerDone"]).toBeUndefined();
      expectStepTwoAgain();
    });

    test("archived just after the second level was saved: forgotten, and the test step never opens", async () => {
      await atNoAnswer();
      await pressText("Add Ben to on-call-setup-next-people");

      // Read just before: in service. Read again once saved: archived.
      api["loadPolicy"]!.mockResolvedValueOnce(policyRecord());
      api["loadPolicy"]!.mockResolvedValue(archived());
      api["loadPolicyChoices"]!.mockResolvedValue(NO_POLICY_IN_SERVICE);
      await press("on-call-setup-no-answer-save");

      expect(api["addSecondLevel"]).toHaveBeenCalledTimes(1);
      expectStepTwoAgain();
    });
  });

  describe("on step 4, the test page", () => {
    const atTest: () => Promise<void> = async (): Promise<void> => {
      keepRun({
        reachConfirmed: true,
        policyId: POLICY_ID,
        noAnswerDone: true,
      });
      await renderSetup();
      expect(stepState("test")).toBe("open");
    };

    test("Skip: no summary saying an archived policy pages people; step 2 opens with why", async () => {
      await atTest();

      archiveThePolicy();
      await press("on-call-setup-skip-test");

      expect(storedRun()["testSkipped"]).toBeUndefined();
      expectStepTwoAgain();
    });

    test("Continue once acknowledged: the policy is read again first, and archived meanwhile, no summary; step 2 opens with why", async () => {
      await atTest();
      await press("send-test-page");
      await act(async () => {
        reportTestResult(result(OnCallTestPageStatus.Acknowledged));
      });
      expect(screen.getByTestId("on-call-setup-test-continue")).toBeVisible();

      archiveThePolicy();
      await press("on-call-setup-test-continue");

      expect(api["loadPolicy"]).toHaveBeenLastCalledWith(POLICY_ID);
      expectStepTwoAgain();
    });

    test("Continue once acknowledged, the policy in service: the summary, as before", async () => {
      await atTest();
      await press("send-test-page");
      await act(async () => {
        reportTestResult(result(OnCallTestPageStatus.Acknowledged));
      });
      await press("on-call-setup-test-continue");

      expect(api["loadPolicy"]).toHaveBeenLastCalledWith(POLICY_ID);
      expect(screen.getByTestId("guided-setup-summary")).toBeInTheDocument();
      expect(sent(ProductEventName.GuidedSetupFinished)).toHaveLength(1);
    });

    test("Continue once acknowledged, and the read fails: the step says why and stays", async () => {
      await atTest();
      await press("send-test-page");
      await act(async () => {
        reportTestResult(result(OnCallTestPageStatus.Acknowledged));
      });

      api["loadPolicy"]!.mockRejectedValue(
        new Error("The server could not be reached."),
      );
      await press("on-call-setup-test-continue");

      expect(screen.getByRole("alert")).toHaveTextContent(
        "The server could not be reached.",
      );
      expect(stepState("test")).toBe("open");
      expect(storedRun()["policyId"]).toBe(POLICY_ID);
      expect(screen.queryByTestId("guided-setup-summary")).toBeNull();
    });

    test("Skip, and the read fails: the step says why and stays, and the test is not saved as skipped", async () => {
      await atTest();
      api["loadPolicy"]!.mockRejectedValue(
        new Error("The server could not be reached."),
      );
      await press("on-call-setup-skip-test");

      expect(screen.getByRole("alert")).toHaveTextContent(
        "The server could not be reached.",
      );
      expect(stepState("test")).toBe("open");
      expect(storedRun()["testSkipped"]).toBeUndefined();
    });

    test("the test dialog closes on a policy archived meanwhile: step 2 opens with why", async () => {
      await atTest();

      archiveThePolicy();
      await press("close-test-page");

      await waitFor(() => {
        expect(stepState("who_else")).toBe("open");
      });
      expectStepTwoAgain();
    });
  });

  describe("coming back", () => {
    test("to a finished run whose policy was archived: step 2, saying why, and no summary", async () => {
      keepRun({
        reachConfirmed: true,
        policyId: POLICY_ID,
        noAnswerDone: true,
        testExecutionLogId: "log-1",
        testSkipped: true,
      });
      api["loadPolicy"]!.mockResolvedValue(archived());
      await renderSetup();

      expectStepTwoAgain();
      // Nothing of the archived policy is read on: not its readiness, nor its test.
      expect(getResultMock).not.toHaveBeenCalled();
      expect(api["loadPolicyReadiness"]).not.toHaveBeenCalled();
    });

    test("to a run whose policy is in service: nothing is said of an archived one", async () => {
      keepRun({ reachConfirmed: true, policyId: POLICY_ID });
      api["loadPolicy"]!.mockResolvedValue(policyRecord({ isArchived: false }));
      await renderSetup();

      expect(stepState("no_answer")).toBe("open");
      expect(screen.queryByTestId("on-call-setup-policy-archived")).toBeNull();
      expect(screen.queryByTestId("on-call-setup-policy-deleted")).toBeNull();
    });

    test("to a run whose policy was deleted: it still says deleted, never archived", async () => {
      keepRun({ reachConfirmed: true, policyId: POLICY_ID });
      api["loadPolicy"]!.mockResolvedValue(null);
      await renderSetup();

      expect(
        screen.getByTestId("on-call-setup-policy-deleted"),
      ).toHaveTextContent(DELETED);
      expect(screen.queryByTestId("on-call-setup-policy-archived")).toBeNull();
    });
  });
});

/*
 * THE SENTENCE FOR AN ARCHIVED POLICY IS WORDED IN EVERY DASHBOARD LANGUAGE
 * (#8432): a value of its own in each, its full stop kept - never the
 * English left as a placeholder, nor the deleted sentence's words.
 */
describe("the sentence for an archived policy, in every Dashboard language (#8432)", () => {
  const LANGUAGES: Array<string> = [...DASHBOARD_LANGUAGES];

  test("English has it, as itself, and it is not the deleted sentence", () => {
    expect(readDashboardLocale("en")[ON_CALL_SETUP_COPY.policyArchived]).toBe(
      ON_CALL_SETUP_COPY.policyArchived,
    );
    expect(ON_CALL_SETUP_COPY.policyArchived).not.toBe(
      ON_CALL_SETUP_COPY.policyDeleted,
    );
    // Why it matters is said: an archived policy pages no one.
    expect(ON_CALL_SETUP_COPY.policyArchived).toContain("pages no one");
  });

  test.each(LANGUAGES)(
    "%s words it, apart from its deleted sentence",
    (language: string) => {
      const locale: Record<string, string> = readDashboardLocale(language);
      const text: string | undefined =
        locale[ON_CALL_SETUP_COPY.policyArchived];

      expect({
        language,
        worded: Boolean(
          text && text.trim() && text !== ON_CALL_SETUP_COPY.policyArchived,
        ),
      }).toEqual({ language, worded: true });
      expect(text).not.toBe(locale[ON_CALL_SETUP_COPY.policyDeleted]);
      // Sentences, ended as the language ends one.
      expect(text).toMatch(/[.。।]$/u);
    },
  );
});
/*
 * THE SENTENCE FOR A DELETED POLICY IS WORDED IN EVERY DASHBOARD LANGUAGE
 * (#7516): a value of its own in each, its full stop kept - never the
 * English left as a placeholder.
 */
describe("the sentence for a deleted policy, in every Dashboard language (#7516)", () => {
  // Every language the Dashboard offers, English aside.
  const LANGUAGES: Array<string> = [...DASHBOARD_LANGUAGES];

  const isWorded: (text: string | undefined, english: string) => boolean = (
    text: string | undefined,
    english: string,
  ): boolean => {
    return Boolean(text && text.trim() && text !== english);
  };

  test("English has it, as itself", () => {
    expect(readDashboardLocale("en")[ON_CALL_SETUP_COPY.policyDeleted]).toBe(
      ON_CALL_SETUP_COPY.policyDeleted,
    );
  });

  test.each(LANGUAGES)("%s words it", (language: string) => {
    const text: string | undefined =
      readDashboardLocale(language)[ON_CALL_SETUP_COPY.policyDeleted];

    expect({
      language,
      worded: isWorded(text, ON_CALL_SETUP_COPY.policyDeleted),
    }).toEqual({ language, worded: true });
    // A sentence, ended as its language ends one.
    expect(text).toMatch(/[.。।]$/u);
  });

  test("the languages read are all seventeen, right-to-left ones among them", () => {
    expect(LANGUAGES).toHaveLength(17);
    expect(LANGUAGES).toEqual(expect.arrayContaining(["de", "ar", "fa"]));
    expect(LANGUAGES).not.toContain("en");
  });

  // The check itself tells an English placeholder, and a key left out, apart.
  test("negative control: the English as a placeholder, or no value, is not worded", () => {
    expect(
      isWorded(
        ON_CALL_SETUP_COPY.policyDeleted,
        ON_CALL_SETUP_COPY.policyDeleted,
      ),
    ).toBe(false);
    expect(isWorded(undefined, ON_CALL_SETUP_COPY.policyDeleted)).toBe(false);
    expect(isWorded("  ", ON_CALL_SETUP_COPY.policyDeleted)).toBe(false);
    expect(
      readDashboardLocale("de")[
        `${ON_CALL_SETUP_COPY.policyDeleted} (no such key)`
      ],
    ).toBeUndefined();
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

    // #7516: Continue that finds the run's policy deleted says so in their words.
    test("the run's policy deleted meanwhile: the step says why in their words", async () => {
      keepRun({
        reachConfirmed: true,
        policyId: POLICY_ID,
        policyIsExisting: true,
      });
      await renderSetup();
      await act(async () => {
        fireEvent.click(
          screen
            .getByTestId("guided-setup-step-who_else")
            .querySelector("button")!,
        );
      });
      api["loadPolicy"]!.mockResolvedValue(null);
      await press("on-call-setup-who-continue");

      const sentence: string = withoutIsolateMarks(
        screen.getByTestId("on-call-setup-policy-deleted").textContent || "",
      );

      expect(sentence).toBe(worded(language, ON_CALL_SETUP_COPY.policyDeleted));
      expect(sentence).not.toMatch(/deleted|pick or make/u);
      expect(screen.queryByTestId("on-call-setup-policy-archived")).toBeNull();
      // No English is left in the step's live region, but the policy's name.
      expect(
        withoutIsolateMarks(
          screen.getByTestId("on-call-setup-who-help").textContent || "",
        )
          .split("Default on-call policy")
          .join(""),
      ).not.toMatch(/\b(the|this|was|policy|setup)\b/iu);
      expect(storedRun()).toEqual({ reachConfirmed: true });
    });

    // #8432: Continue that finds the run's policy archived says so in their words.
    test("the run's policy archived meanwhile: the step says why in their words", async () => {
      keepRun({
        reachConfirmed: true,
        policyId: POLICY_ID,
        policyIsExisting: true,
      });
      await renderSetup();
      await act(async () => {
        fireEvent.click(
          screen
            .getByTestId("guided-setup-step-who_else")
            .querySelector("button")!,
        );
      });
      api["loadPolicy"]!.mockResolvedValue(policyRecord({ isArchived: true }));
      await press("on-call-setup-who-continue");

      const sentence: string = withoutIsolateMarks(
        screen.getByTestId("on-call-setup-policy-archived").textContent || "",
      );

      expect(sentence).toBe(
        worded(language, ON_CALL_SETUP_COPY.policyArchived),
      );
      expect(sentence).not.toBe(
        worded(language, ON_CALL_SETUP_COPY.policyDeleted),
      );
      expect(sentence).not.toMatch(/archived|pages no one|pick or make/iu);
      // No English is left in the step's live region, but the policy's name.
      expect(
        withoutIsolateMarks(
          screen.getByTestId("on-call-setup-who-help").textContent || "",
        )
          .split("Default on-call policy")
          .join(""),
      ).not.toMatch(/\b(the|this|was|policy|setup|archived)\b/iu);
      expect(storedRun()).toEqual({ reachConfirmed: true });
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
