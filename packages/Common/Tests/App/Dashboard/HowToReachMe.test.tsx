import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { SpyInstance } from "jest-mock";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * HOW TO REACH ME (#6820, drawn as steps in #8139): the page opens on one
 * ladder - numbered steps, each a time and the ways to reach the person
 * that go out together then - for rules that differ too, naming every
 * difference under the steps (#8890), opens on the grid for a link to one
 * kind, and saves a ladder in one request, for yourself or for a member
 * with their masked methods. A step's
 * time is changed on its heading and moves the whole step; Add puts a way
 * into a step, Add Step starts one after the last; Save Changes shows once
 * there is something to save, and leaving before then asks first. The reads
 * and the save are stood in for; the ladder's reading and planning are the
 * real Common functions, and the menus are the real MoreMenu.
 */

const loadDataMock: MockFunction = getJestMockFunction();
const loadMethodsMock: MockFunction = getJestMockFunction();
const saveMock: MockFunction = getJestMockFunction();
const sendEventMock: MockFunction = getJestMockFunction();
let queryType: string | null = null;
let setQueryStringSpy: SpyInstance<
  (
    ...args: Parameters<typeof Navigation.setQueryString>
  ) => ReturnType<typeof Navigation.setQueryString>
>;
let navigateSpy: SpyInstance<
  (
    ...args: Parameters<typeof Navigation.navigate>
  ) => ReturnType<typeof Navigation.navigate>
>;

const PAGE_PATH: string =
  "/dashboard/8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b/user-settings/on-call-rules";

interface RecordedTabsProps {
  userId?: unknown;
  differingCellKeys?: ReadonlySet<string>;
  onRulesChanged?: () => void;
  isEditable?: boolean;
}

let tabsProps: RecordedTabsProps | null = null;

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NotificationRule/PagingLadder/PagingLadderApi",
  () => {
    return {
      __esModule: true,
      loadPagingLadderData: (...args: Array<unknown>) => {
        return loadDataMock(...args);
      },
      loadOwnPagingMethods: (...args: Array<unknown>) => {
        return loadMethodsMock(...args);
      },
      savePagingLadder: (...args: Array<unknown>) => {
        return saveMock(...args);
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NotificationRule/OnCallRulesTabs",
  () => {
    return {
      __esModule: true,
      default: (props: RecordedTabsProps): ReactElement => {
        tabsProps = props;
        return <div data-testid="on-call-rules-tabs-stub" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/OnCallTestPage/TestPageCard",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return <div data-testid="test-page-card-stub" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/VerificationCodeModal",
  () => {
    return {
      __esModule: true,
      default: (props: {
        itemId: string;
        destination: string;
        onVerified: (result: unknown) => void;
      }): ReactElement => {
        return (
          <div data-testid="verify-modal-stub">
            <span>{`Verify ${props.destination}`}</span>
            <button
              type="button"
              onClick={() => {
                props.onVerified({});
              }}
            >
              Enter the right code
            </button>
          </div>
        );
      },
    };
  },
);

let isPushTurnedOff: boolean = false;

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/PushNotificationsTurnedOff",
  () => {
    return {
      __esModule: true,
      usePushNotificationsTurnedOff: () => {
        return isPushTurnedOff;
      },
    };
  },
);

/*
 * Whether this server can send email, SMS and calls right now (#9446, GET
 * /project-can-send): not known - the answer still on its way - unless a
 * test says.
 */
let projectCanSend: ProjectCanSendAnswer | null = null;

jest.mock("../../../UI/Utils/ServerSending", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Utils/ServerSending",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    useProjectCanSend: () => {
      return projectCanSend;
    },
  };
});

/*
 * Adding a way to reach you from the ladder (#7451): the on-call guided
 * setup's own phone and push steps, and this browser's registration.
 */
const addSmsMock: MockFunction = getJestMockFunction();
const addCallMock: MockFunction = getJestMockFunction();
const phoneFactsMock: MockFunction = getJestMockFunction();
const registerBrowserMock: MockFunction = getJestMockFunction();
const browserProblemMock: MockFunction = getJestMockFunction();
const toastSuccessMock: MockFunction = getJestMockFunction();
let thisBrowserDeviceId: string | null = null;

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/OnCall/OnCallSetupApi",
  () => {
    return {
      __esModule: true,
      default: {
        addSmsNumber: (...args: Array<unknown>) => {
          return addSmsMock(...args);
        },
        addCallNumber: (...args: Array<unknown>) => {
          return addCallMock(...args);
        },
        loadProjectPhoneFacts: (...args: Array<unknown>) => {
          return phoneFactsMock(...args);
        },
        registerThisBrowser: (...args: Array<unknown>) => {
          return registerBrowserMock(...args);
        },
        getBrowserPushProblem: (...args: Array<unknown>) => {
          return browserProblemMock(...args);
        },
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/BrowserPushRegistration",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/BrowserPushRegistration",
    ) as Record<string, unknown>;

    return {
      ...actual,
      __esModule: true,
      getThisBrowserDeviceId: () => {
        return thisBrowserDeviceId;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/MobileAppCodes",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return <div data-testid="app-codes-stub" />;
      },
    };
  },
);

jest.mock("../../../UI/Utils/Toast", () => {
  return {
    __esModule: true,
    default: {
      success: (...args: Array<unknown>) => {
        return toastSuccessMock(...args);
      },
      error: () => {
        // A failure is drawn on the page.
      },
    },
  };
});

jest.mock("../../../UI/Utils/ProductEvents", () => {
  return {
    __esModule: true,
    default: {
      send: (...args: Array<unknown>) => {
        return sendEventMock(...args);
      },
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

import HowToReachMe from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationRule/HowToReachMe";
import { PagingMethodChoice } from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationRule/PagingLadder/PagingLadderMethods";
import { ProductEventName } from "../../../Types/Analytics/ProductEvent";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import {
  PagingLadderCell,
  PagingLadderRule,
  PagingLadderStep,
  getPagingLadderCellKey,
  getPagingLadderCells,
} from "../../../Types/NotificationRule/PagingLadder";
import ObjectID from "../../../Types/ObjectID";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import LeaveGuard from "../../../UI/Utils/LeaveGuard";
import Navigation from "../../../UI/Utils/Navigation";
import UserUtil from "../../../UI/Utils/User";
import {
  ADD_WAYS_COPY,
  PHONE_CODE_NOT_SENT_COPY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationRule/PagingLadder/AddWaysToReach";
import { ON_CALL_SETUP_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/OnCall/OnCallSetup";
import {
  BROWSER_PUSH_PROBLEM_MESSAGES,
  BrowserPushError,
  BrowserPushProblem,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/BrowserPushRegistration";
import {
  ChannelGatedMethodList,
  getChannelGatedMethodList,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/ProjectNotificationChannelsCopy";
import {
  SERVER_CANNOT_SEND_COPY,
  SERVER_CANNOT_SEND_FIX_WORDS,
  ServerCannotSendChannel,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/ServerCannotSendPanel";
import { PAGING_LADDER_DEFAULT_START_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationRule/PagingLadder/PagingLadderWords";
import {
  NOT_SENT_RIGHT_NOW,
  SMS_AND_CALLS_NOT_SENT_COPY,
  STEPS_NOT_SENT_NOW_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationRule/PagingLadder/StepsNotSentNow";
import { PagingLadderDefaultStep } from "../../../Types/NotificationRule/PagingLadderDefault";
import PushNotificationLevel from "../../../Types/NotificationRule/PushNotificationLevel";
import {
  PROJECT_CAN_SEND_EVERYTHING,
  ProjectCanSendAnswer,
} from "../../../Types/ServerSending/ProjectCanSend";

const ME: string = "a0000000-0000-4000-8000-000000000001";
const ANA: string = "a0000000-0000-4000-8000-0000000000a1";

const CRITICAL: string = "b0000000-0000-4000-8000-000000000001";
const MINOR: string = "b0000000-0000-4000-8000-000000000002";
const HIGH: string = "b0000000-0000-4000-8000-000000000003";

const EMAIL: string = "c0000000-0000-4000-8000-000000000001";
const SMS: string = "c0000000-0000-4000-8000-000000000002";
const CALL: string = "c0000000-0000-4000-8000-000000000003";
const PUSH: string = "c0000000-0000-4000-8000-000000000004";
const UNVERIFIED_SMS: string = "c0000000-0000-4000-8000-000000000005";
// A phone added from the ladder (#7451): its SMS and its call.
const NEW_SMS: string = "c0000000-0000-4000-8000-000000000012";
const NEW_CALL: string = "c0000000-0000-4000-8000-000000000013";
const BROWSER_PUSH: string = "c0000000-0000-4000-8000-000000000014";

const CELLS: Array<PagingLadderCell> = getPagingLadderCells({
  incidentSeverities: [
    { id: CRITICAL, name: "Critical Incident" },
    { id: MINOR, name: "Minor Incident" },
  ],
  alertSeverities: [{ id: HIGH, name: "High" }],
});

const choice: (
  methodColumn: PagingMethodChoice["methodColumn"],
  methodId: string,
  title: string,
  identifier: string,
  isVerified?: boolean,
) => PagingMethodChoice = (
  methodColumn: PagingMethodChoice["methodColumn"],
  methodId: string,
  title: string,
  identifier: string,
  isVerified: boolean = true,
): PagingMethodChoice => {
  return {
    methodColumn: methodColumn,
    methodId: methodId,
    channel: title as OnCallPageChannel,
    title: title,
    identifier: identifier,
    isVerified: isVerified,
    hasPushLevel: methodColumn === "userPushId",
  };
};

const MY_METHODS: Array<PagingMethodChoice> = [
  choice("userPushId", PUSH, "Push", "Pixel 8"),
  choice("userEmailId", EMAIL, "Email", "me@example.com"),
  choice("userSmsId", SMS, "SMS", "+15550100"),
  choice("userCallId", CALL, "Call", "+15550100"),
  choice("userSmsId", UNVERIFIED_SMS, "SMS", "+447700900123", false),
];

let ruleCounter: number = 0;

// The rows of `steps` in every card, as a person editing the grid by hand would have.
const rulesFor: (
  cells: ReadonlyArray<PagingLadderCell>,
  steps: ReadonlyArray<PagingLadderStep>,
) => Array<PagingLadderRule> = (
  cells: ReadonlyArray<PagingLadderCell>,
  steps: ReadonlyArray<PagingLadderStep>,
): Array<PagingLadderRule> => {
  const rows: Array<PagingLadderRule> = [];

  for (const cell of cells) {
    for (const step of steps) {
      ruleCounter++;
      rows.push({
        _id: `d0000000-0000-4000-8000-${String(ruleCounter).padStart(12, "0")}`,
        ruleType: cell.ruleType,
        [cell.severityColumn]: cell.severityId,
        [step.methodColumn]: step.methodId,
        notifyAfterMinutes: step.notifyAfterMinutes,
        isOptOut: false,
        pushNotificationLevel: "Critical",
        repeatEveryMinutes: 0,
      } as PagingLadderRule);
    }
  }

  return rows;
};

const step: (
  methodColumn: PagingLadderStep["methodColumn"],
  methodId: string,
  notifyAfterMinutes: number,
) => PagingLadderStep = (
  methodColumn: PagingLadderStep["methodColumn"],
  methodId: string,
  notifyAfterMinutes: number,
): PagingLadderStep => {
  return {
    methodColumn: methodColumn,
    methodId: methodId,
    notifyAfterMinutes: notifyAfterMinutes,
  };
};

// SMS at once, then a call after five minutes.
const ONE_LADDER: Array<PagingLadderRule> = rulesFor(CELLS, [
  step("userSmsId", SMS, 0),
  step("userCallId", CALL, 5),
]);

// The same, but Critical incidents also call at once.
const DIFFERING: Array<PagingLadderRule> = [
  ...ONE_LADDER,
  ...rulesFor([CELLS[0]!], [step("userCallId", CALL, 0)]),
];

const renderPage: (props?: Record<string, unknown>) => void = (
  props?: Record<string, unknown>,
): void => {
  // The page reads its tab, and the project, from the address.
  window.history.replaceState(
    {},
    "",
    queryType ? `${PAGE_PATH}?type=${queryType}` : PAGE_PATH,
  );

  render(
    <MemoryRouter>
      <HowToReachMe userPreferencesKeyPrefix="test" {...(props || {})} />
    </MemoryRouter>,
  );
};

// The person's rules, and the project's default ladder (#9445): none unless given.
const givenRules: (
  rules: Array<PagingLadderRule>,
  defaultSteps?: Array<PagingLadderDefaultStep>,
) => void = (
  rules: Array<PagingLadderRule>,
  defaultSteps: Array<PagingLadderDefaultStep> = [],
): void => {
  loadDataMock.mockResolvedValue({
    cells: CELLS,
    rules: rules,
    severityColors: { [CRITICAL]: "#ef4444" },
    defaultSteps: defaultSteps,
  });
};

const pageView: () => string | null = (): string | null => {
  return screen.getByTestId("how-to-reach-me").getAttribute("data-view");
};

// The ladder's steps, in order: each step's time and the ways it reaches the person.
const drawnSteps: () => Array<{
  wait: string;
  methods: Array<string>;
}> = (): Array<{ wait: string; methods: Array<string> }> => {
  return screen
    .getAllByTestId("paging-ladder-wait-group")
    .map((group: HTMLElement) => {
      return {
        wait:
          within(group).getByTestId("paging-ladder-step-wait").textContent ||
          "",
        methods: within(group)
          .getAllByTestId("paging-ladder-method")
          .map((method: HTMLElement): string => {
            return method.textContent || "";
          }),
      };
    });
};

// Lets a read or a save still in flight finish, inside act().
const settle: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  });
};

const stepGroup: (index: number) => HTMLElement = (
  index: number,
): HTMLElement => {
  return screen.getAllByTestId("paging-ladder-wait-group")[index]!;
};

// Opens a step's time and picks another.
const changeStepWait: (index: number, minutes: number) => void = (
  index: number,
  minutes: number,
): void => {
  fireEvent.click(
    within(stepGroup(index)).getByTestId("paging-ladder-step-wait"),
  );
  fireEvent.click(screen.getByTestId(`paging-ladder-wait-option-${minutes}`));
};

// The labels an open Add menu offers, in order.
const offeredMethods: () => Array<string> = (): Array<string> => {
  return screen
    .queryAllByTestId(/^paging-ladder-add-option-/)
    .map((option: HTMLElement): string => {
      return option.textContent || "";
    });
};

beforeEach(() => {
  ruleCounter = 0;
  queryType = null;
  tabsProps = null;
  LeaveGuard.reset();
  loadDataMock.mockReset();
  loadMethodsMock.mockReset();
  saveMock.mockReset();
  sendEventMock.mockReset();
  setQueryStringSpy = jest.spyOn(Navigation, "setQueryString");
  navigateSpy = jest.spyOn(Navigation, "navigate").mockImplementation(() => {
    // Where it goes is what is checked.
  });
  loadMethodsMock.mockResolvedValue(MY_METHODS);
  saveMock.mockResolvedValue({
    createdCount: 0,
    updatedCount: 0,
    deletedCount: 0,
    unchangedCount: 0,
  });
  jest.spyOn(UserUtil, "getUserId").mockReturnValue(new ObjectID(ME));

  isPushTurnedOff = false;
  projectCanSend = null;
  thisBrowserDeviceId = null;
  addSmsMock.mockReset();
  addCallMock.mockReset();
  phoneFactsMock.mockReset();
  registerBrowserMock.mockReset();
  browserProblemMock.mockReset();
  toastSuccessMock.mockReset();
  // This browser could register; SMS and calls are on.
  browserProblemMock.mockReturnValue(null as never);
  phoneFactsMock.mockResolvedValue({
    isSmsOn: true,
    isCallOn: true,
    balanceInUSDCents: null,
  } as never);
  addCallMock.mockResolvedValue({ id: NEW_CALL, isVerified: true } as never);
});

afterEach(() => {
  cleanup();
  LeaveGuard.reset();
  jest.restoreAllMocks();
});

describe("which view it opens on", () => {
  test("one ladder for everything opens on the ladder, as numbered steps in paging order", async () => {
    givenRules(ONE_LADDER);
    renderPage();

    await screen.findByTestId("paging-ladder");
    expect(pageView()).toBe("ladder");
    expect(
      screen.getByText("How to reach me when I am on call"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "When you are paged, OneUptime tries each step in turn until somebody acknowledges.",
      ),
    ).toBeInTheDocument();

    expect(drawnSteps()).toEqual([
      { wait: "At once", methods: ["SMS: +15550100"] },
      // The method's name as the cards below name it: "Phone call", never the shared "Call" (#7178).
      { wait: "After 5\u00A0minutes", methods: ["Phone call: +15550100"] },
    ]);

    // Numbered down the line.
    expect(
      screen
        .getAllByTestId("paging-ladder-step-number")
        .map((number: HTMLElement): string => {
          return number.textContent || "";
        }),
    ).toEqual(["1", "2"]);

    // A later step is skipped once somebody acknowledges, and says so; the first is not.
    expect(
      within(stepGroup(0)).queryByTestId("paging-ladder-if-not-acknowledged"),
    ).not.toBeInTheDocument();
    expect(
      within(stepGroup(1)).getByTestId("paging-ladder-if-not-acknowledged"),
    ).toHaveTextContent("If nobody has acknowledged yet");

    // Each way to reach the person has its kind's icon.
    expect(screen.getAllByTestId("paging-ladder-method-icon")).toHaveLength(2);

    /*
     * Left out on a phone, drawn from sm up - and never by the bare
     * `hidden` class, which a foreign `.hidden{display:none !important}`
     * (Bootstrap 3, HTML5 Boilerplate, browser extensions) would keep
     * hidden at every width (ForeignHiddenRuleGuard).
     */
    for (const icon of screen.getAllByTestId("paging-ladder-method-icon")) {
      expect(icon.classList.contains("max-sm:hidden")).toBe(true);
      expect(icon.classList.contains("sm:flex")).toBe(true);
      expect(icon.classList.contains("hidden")).toBe(false);
    }

    // What it is for; nothing differs, so no list of what does.
    expect(screen.getByTestId("paging-ladder-scope")).toHaveTextContent(
      "Used for every incident, alert and episode, of every severity.",
    );
    expect(
      screen.queryByTestId("paging-ladder-differences-section"),
    ).not.toBeInTheDocument();

    // Nothing changed: nothing to save, and no button for it.
    expect(
      screen.queryByTestId("paging-ladder-save-bar"),
    ).not.toBeInTheDocument();

    // Your own page: the test page at its foot.
    expect(screen.getByTestId("test-page-card-stub")).toBeInTheDocument();
    expect(tabsProps).toBeNull();
    expect(loadDataMock).toHaveBeenCalledWith(new ObjectID(ME));
  });

  test("rules that differ still open on the steps, naming each card that differs under them (#8890)", async () => {
    givenRules(DIFFERING);
    renderPage();

    await screen.findByTestId("paging-ladder");
    expect(pageView()).toBe("ladder");

    // The steps stay reachable and editable: the ladder most cards page.
    expect(drawnSteps()).toEqual([
      { wait: "At once", methods: ["SMS: +15550100"] },
      { wait: "After 5\u00A0minutes", methods: ["Phone call: +15550100"] },
    ]);
    expect(screen.getByTestId("paging-ladder-add-step")).toBeInTheDocument();

    // Not "every severity": the cards that differ are listed instead.
    expect(screen.queryByTestId("paging-ladder-scope")).not.toBeInTheDocument();
    const section: HTMLElement = screen.getByTestId(
      "paging-ladder-differences-section",
    );
    expect(
      within(section).getByText("Different from the ladder"),
    ).toBeInTheDocument();
    expect(
      within(section).getByText(
        "These keep their own rules when you save changes to the steps.",
      ),
    ).toBeInTheDocument();

    const difference: HTMLElement = within(section).getByTestId(
      "paging-ladder-difference",
    );
    expect(within(difference).getByText("Incidents")).toBeInTheDocument();
    expect(
      within(difference).getByText("Critical Incident"),
    ).toBeInTheDocument();
    expect(within(difference).getByText("Also")).toBeInTheDocument();
    expect(within(difference).getByText("Phone call")).toBeInTheDocument();
    expect(within(difference).getByText("At once")).toBeInTheDocument();

    // Giving them the ladder too is a button of its own, and nothing to save until then.
    expect(
      within(section).getByTestId("paging-ladder-use-for-every-severity"),
    ).toHaveTextContent("Use This Ladder for Every Severity");
    expect(
      screen.queryByTestId("paging-ladder-save-bar"),
    ).not.toBeInTheDocument();
    expect(tabsProps).toBeNull();
  });

  test("the grid marks each card that differs, and its button goes back to the steps", async () => {
    givenRules(DIFFERING);
    renderPage();

    fireEvent.click(await screen.findByTestId("paging-ladder-open-grid"));

    await screen.findByTestId("paging-ladder-summary");
    expect(pageView()).toBe("grid");
    expect(
      screen.getByText("1 card is different from the ladder."),
    ).toBeInTheDocument();
    expect(tabsProps).not.toBeNull();
    expect([...(tabsProps!.differingCellKeys || [])]).toEqual([
      getPagingLadderCellKey({
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        severityId: CRITICAL,
      }),
    ]);

    // It only goes back: never words that read as a reset.
    expect(
      screen.queryByText("Use One Ladder for Everything"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Back to One Ladder"));
    expect(pageView()).toBe("ladder");
    expect(saveMock).not.toHaveBeenCalled();
  });

  test("a link to one kind's tab opens the grid, even on one ladder", async () => {
    queryType = "alerts";
    givenRules(ONE_LADDER);
    renderPage();

    // The grid is drawn at once; the ladder above it follows the read.
    await screen.findByTestId("on-call-rules-tabs-stub");
    expect(pageView()).toBe("grid");
    expect(
      await screen.findByText(
        "Every card below uses your ladder. Change a card to make it different.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Back to One Ladder")).toBeInTheDocument();
  });

  test("a person with no rules yet opens on an empty ladder that says so, with one button to start it", async () => {
    givenRules([]);
    renderPage();

    await screen.findByTestId("paging-ladder-empty");
    expect(pageView()).toBe("ladder");
    expect(
      screen.getByText(
        "Nothing reaches you when you are paged yet. Add a way to reach you.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("paging-ladder-add-first")).toHaveTextContent(
      "Add a way to reach you",
    );
    expect(screen.queryByTestId("paging-ladder-save")).not.toBeInTheDocument();
  });

  test("a failed read says so, and reading again shows the ladder", async () => {
    givenRules(ONE_LADDER);
    loadDataMock.mockRejectedValueOnce(
      new Error("Your rules were not read. Try again."),
    );
    renderPage();

    expect(
      await screen.findByText("Your rules were not read. Try again."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("how-to-reach-me")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("refresh-button"));

    await screen.findByTestId("paging-ladder");
    expect(loadDataMock).toHaveBeenCalledTimes(2);
  });
});

describe("moving between the ladder and the grid", () => {
  test("Different for Some Severities, a button beside the ladder's title, opens the grid and says so in an event (#8890)", async () => {
    givenRules(ONE_LADDER);
    renderPage();

    const openGrid: HTMLElement = await screen.findByTestId(
      "paging-ladder-open-grid",
    );
    expect(openGrid).toHaveTextContent("Different for Some Severities");
    // A button in the card's header, where its actions are - not a link at its foot.
    expect(openGrid.tagName).toBe("BUTTON");
    expect(
      openGrid.closest("[data-testid='card-header-actions']"),
    ).not.toBeNull();
    expect(
      within(screen.getByTestId("paging-ladder-scope")).queryByTestId(
        "paging-ladder-open-grid",
      ),
    ).toBeNull();

    fireEvent.click(openGrid);

    expect(pageView()).toBe("grid");
    expect(sendEventMock).toHaveBeenCalledWith(
      ProductEventName.PagingLadderGridOpened,
      { is_own: true, differing_card_count: 0 },
    );
  });

  test("over changes not saved yet, it asks first: Keep Editing stays, Discard Changes opens the grid", async () => {
    givenRules(ONE_LADDER);
    renderPage();
    await screen.findByTestId("paging-ladder");

    changeStepWait(1, 10);
    fireEvent.click(screen.getByTestId("paging-ladder-open-grid"));

    expect(screen.getByText("Leave without saving?")).toBeInTheDocument();
    expect(
      screen.getByText(
        "You have unsaved changes to these steps. If you leave now, they will be lost.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("modal-footer-close-button"));

    expect(pageView()).toBe("ladder");
    expect(drawnSteps()[1]!.wait).toBe("After 10\u00A0minutes");
    expect(screen.queryByText("Leave without saving?")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("paging-ladder-open-grid"));
    // Discard Changes, at the question's start: Save Changes is its primary (#7402).
    fireEvent.click(screen.getByTestId("leave-question-discard"));

    expect(pageView()).toBe("grid");
    expect(saveMock).not.toHaveBeenCalled();
  });

  test("over changes not saved yet, Save Changes saves the ladder as its own Save Changes does, then opens the grid (#7402)", async () => {
    givenRules(ONE_LADDER);
    renderPage();
    await screen.findByTestId("paging-ladder");

    changeStepWait(1, 10);
    fireEvent.click(screen.getByTestId("paging-ladder-open-grid"));

    expect(screen.getByTestId("modal-footer-submit-button")).toHaveTextContent(
      "Save Changes",
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });

    await waitFor(() => {
      expect(pageView()).toBe("grid");
    });
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(
      (saveMock.mock.calls[0]![0] as { steps: Array<PagingLadderStep> }).steps,
    ).toHaveLength(2);
    expect(screen.queryByText("Leave without saving?")).not.toBeInTheDocument();
  });

  test("a refused save keeps the ladder and its question, and says why (#7402)", async () => {
    givenRules(ONE_LADDER);
    saveMock.mockRejectedValue(
      new Error("Your notification rules were not saved. Try again."),
    );
    renderPage();
    await screen.findByTestId("paging-ladder");

    changeStepWait(1, 10);
    fireEvent.click(screen.getByTestId("paging-ladder-open-grid"));

    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });

    const question: HTMLElement = await screen.findByRole("dialog", {
      name: "Leave without saving?",
    });

    await waitFor(() => {
      expect(within(question).getByTestId("modal-error")).toHaveTextContent(
        "Your notification rules were not saved. Try again.",
      );
    });
    expect(pageView()).toBe("ladder");
    expect(drawnSteps()[1]!.wait).toBe("After 10\u00A0minutes");
    expect(LeaveGuard.isHeld()).toBe(true);
    await settle();
  });

  test("leaving the page with changes not saved yet, Save Changes saves the ladder, then goes on (#7402)", async () => {
    givenRules(ONE_LADDER);
    renderPage();
    await screen.findByTestId("paging-ladder");

    changeStepWait(1, 10);

    const leave: MockFunction = getJestMockFunction();

    await act(async () => {
      LeaveGuard.whenLeaving("/dashboard/elsewhere", leave as () => void);
    });

    const question: HTMLElement = screen.getByRole("dialog", {
      name: "Leave without saving?",
    });

    expect(
      within(question).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent("Save Changes");

    await act(async () => {
      fireEvent.click(
        within(question).getByTestId("modal-footer-submit-button"),
      );
    });

    await waitFor(() => {
      expect(leave).toHaveBeenCalledTimes(1);
    });
    expect(saveMock).toHaveBeenCalledTimes(1);
    await settle();
  });

  test("Back to One Ladder leaves the grid's tab out of the address", async () => {
    queryType = "alerts";
    givenRules(ONE_LADDER);
    renderPage();

    fireEvent.click(await screen.findByText("Back to One Ladder"));

    expect(pageView()).toBe("ladder");
    expect(setQueryStringSpy).toHaveBeenCalledWith({ type: null });
  });

  test("a change on the grid reads the rules again", async () => {
    givenRules(DIFFERING);
    renderPage();
    fireEvent.click(await screen.findByTestId("paging-ladder-open-grid"));
    await screen.findByTestId("on-call-rules-tabs-stub");

    givenRules(ONE_LADDER);

    await act(async () => {
      tabsProps!.onRulesChanged!();
    });

    await waitFor(() => {
      expect(
        screen.queryByTestId("paging-ladder-difference"),
      ).not.toBeInTheDocument();
    });
    expect(loadDataMock).toHaveBeenCalledTimes(2);
  });
});

describe("changing the steps", () => {
  test("a step's new time is saved for every severity in one request", async () => {
    givenRules(ONE_LADDER);
    renderPage();
    await screen.findByTestId("paging-ladder");

    // The call: after 5 minutes, to after 10.
    fireEvent.click(
      within(stepGroup(1)).getByTestId("paging-ladder-step-wait"),
    );

    // The times a step can have, the one in use ticked.
    expect(screen.getByTestId("paging-ladder-wait-option-5")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(
      [0, 5, 10, 15, 30, 60].map((minutes: number): string => {
        return (
          screen.getByTestId(`paging-ladder-wait-option-${minutes}`)
            .textContent || ""
        );
      }),
    ).toEqual([
      "At once",
      "After 5\u00A0minutes",
      "After 10\u00A0minutes",
      "After 15\u00A0minutes",
      "After 30\u00A0minutes",
      "After 60\u00A0minutes",
    ]);

    fireEvent.click(screen.getByTestId("paging-ladder-wait-option-10"));

    expect(drawnSteps()[1]!.wait).toBe("After 10\u00A0minutes");
    expect(screen.getByTestId("paging-ladder-unsaved")).toHaveTextContent(
      "You have unsaved changes",
    );

    // What the server holds once it has saved, as the page reads it back.
    givenRules(
      rulesFor(CELLS, [
        step("userSmsId", SMS, 0),
        step("userCallId", CALL, 10),
      ]),
    );
    fireEvent.click(screen.getByTestId("paging-ladder-save"));

    await waitFor(() => {
      expect(saveMock).toHaveBeenCalledTimes(1);
    });
    expect(saveMock).toHaveBeenCalledWith({
      userId: undefined,
      steps: [step("userSmsId", SMS, 0), step("userCallId", CALL, 10)],
    });
    expect(sendEventMock).toHaveBeenCalledWith(
      ProductEventName.PagingLadderSaved,
      { is_own: true, step_count: 2, replaced_card_count: 0 },
    );
    expect(await screen.findByTestId("paging-ladder-saved")).toHaveTextContent(
      "Saved. Every severity now uses this ladder.",
    );
    // Saved: nothing is left to save.
    expect(screen.queryByTestId("paging-ladder-save")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("paging-ladder-unsaved"),
    ).not.toBeInTheDocument();
  });

  test("a step moved to another step's time goes out with it", async () => {
    givenRules(ONE_LADDER);
    renderPage();
    await screen.findByTestId("paging-ladder");

    changeStepWait(1, 0);

    expect(drawnSteps()).toEqual([
      {
        wait: "At once",
        methods: ["SMS: +15550100", "Phone call: +15550100"],
      },
    ]);
  });

  test("a step's Add offers the ways not in it yet, and adds one at that step's time", async () => {
    givenRules(ONE_LADDER);
    renderPage();
    await screen.findByTestId("paging-ladder");

    fireEvent.click(
      within(stepGroup(0)).getByTestId("paging-ladder-add-to-step"),
    );

    // SMS is in the step already, and a number waiting for its code is no step yet.
    expect(offeredMethods()).toEqual([
      "Push notification: Pixel 8",
      "Email: me@example.com",
      "Phone call: +15550100",
    ]);
    // Your own page: setting up another way to be reached is the menu's last item.
    expect(screen.getByTestId("paging-ladder-set-up-more")).toHaveTextContent(
      "Set up more ways to be reached",
    );

    fireEvent.click(
      screen.getByTestId(`paging-ladder-add-option-userPushId:${PUSH}`),
    );

    // Push, then SMS: steps with the same time are listed gentlest first.
    expect(drawnSteps()[0]).toEqual({
      wait: "At once",
      methods: ["Push notification: Pixel 8", "SMS: +15550100"],
    });

    givenRules(
      rulesFor(CELLS, [
        step("userPushId", PUSH, 0),
        step("userSmsId", SMS, 0),
        step("userCallId", CALL, 5),
      ]),
    );
    fireEvent.click(screen.getByTestId("paging-ladder-save"));

    await waitFor(() => {
      expect(saveMock).toHaveBeenCalledTimes(1);
    });
    expect(
      (saveMock.mock.calls[0]![0] as { steps: Array<PagingLadderStep> }).steps,
    ).toEqual([
      {
        methodColumn: "userPushId",
        methodId: PUSH,
        notifyAfterMinutes: 0,
        pushNotificationLevel: "Critical",
        repeatEveryMinutes: 0,
      },
      step("userSmsId", SMS, 0),
      step("userCallId", CALL, 5),
    ]);
    await screen.findByTestId("paging-ladder-saved");
  });

  test("Add Step starts a step after the last one, at the next time", async () => {
    givenRules(ONE_LADDER);
    renderPage();
    await screen.findByTestId("paging-ladder");

    fireEvent.click(screen.getByTestId("paging-ladder-add-step-button"));

    // Every verified way can be a step of its own, a call again included.
    expect(offeredMethods()).toEqual([
      "Push notification: Pixel 8",
      "Email: me@example.com",
      "SMS: +15550100",
      "Phone call: +15550100",
    ]);

    fireEvent.click(
      screen.getByTestId(`paging-ladder-add-option-userEmailId:${EMAIL}`),
    );

    expect(drawnSteps()).toEqual([
      { wait: "At once", methods: ["SMS: +15550100"] },
      { wait: "After 5\u00A0minutes", methods: ["Phone call: +15550100"] },
      { wait: "After 10\u00A0minutes", methods: ["Email: me@example.com"] },
    ]);

    givenRules(
      rulesFor(CELLS, [
        step("userSmsId", SMS, 0),
        step("userCallId", CALL, 5),
        step("userEmailId", EMAIL, 10),
      ]),
    );
    fireEvent.click(screen.getByTestId("paging-ladder-save"));

    await waitFor(() => {
      expect(saveMock).toHaveBeenCalledTimes(1);
    });
    expect(
      (saveMock.mock.calls[0]![0] as { steps: Array<PagingLadderStep> }).steps,
    ).toEqual([
      step("userSmsId", SMS, 0),
      step("userCallId", CALL, 5),
      step("userEmailId", EMAIL, 10),
    ]);
    await screen.findByTestId("paging-ladder-saved");
  });

  test("no Add Step after a step an hour in, the longest time a step can have", async () => {
    givenRules(
      rulesFor(CELLS, [
        step("userSmsId", SMS, 0),
        step("userCallId", CALL, 60),
      ]),
    );
    renderPage();
    await screen.findByTestId("paging-ladder");

    expect(drawnSteps()[1]!.wait).toBe("After 60\u00A0minutes");
    expect(
      screen.queryByTestId("paging-ladder-add-step"),
    ).not.toBeInTheDocument();
  });

  test("an empty ladder's button adds a way to reach you at once", async () => {
    givenRules([]);
    renderPage();

    fireEvent.click(await screen.findByTestId("paging-ladder-add-first"));
    fireEvent.click(
      screen.getByTestId(`paging-ladder-add-option-userSmsId:${SMS}`),
    );

    expect(drawnSteps()).toEqual([
      { wait: "At once", methods: ["SMS: +15550100"] },
    ]);

    givenRules(rulesFor(CELLS, [step("userSmsId", SMS, 0)]));
    fireEvent.click(screen.getByTestId("paging-ladder-save"));

    await waitFor(() => {
      expect(saveMock).toHaveBeenCalledWith({
        userId: undefined,
        steps: [step("userSmsId", SMS, 0)],
      });
    });
    await screen.findByTestId("paging-ladder-saved");
  });

  test("Set up more ways to be reached opens Notification Methods", async () => {
    givenRules(ONE_LADDER);
    renderPage();
    await screen.findByTestId("paging-ladder");

    fireEvent.click(screen.getByTestId("paging-ladder-add-step-button"));
    fireEvent.click(screen.getByTestId("paging-ladder-set-up-more"));

    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(navigateSpy.mock.calls[0]![0].toString()).toContain(
      "/user-settings/notification-methods",
    );
  });

  test("a removed step is not saved; Discard Changes puts it back", async () => {
    givenRules(ONE_LADDER);
    renderPage();
    await screen.findByTestId("paging-ladder");

    fireEvent.click(screen.getAllByTestId("paging-ladder-step-remove")[0]!);
    expect(screen.getAllByTestId("paging-ladder-step")).toHaveLength(1);

    fireEvent.click(screen.getByTestId("paging-ladder-discard"));
    expect(screen.getAllByTestId("paging-ladder-step")).toHaveLength(2);
    expect(
      screen.queryByTestId("paging-ladder-save-bar"),
    ).not.toBeInTheDocument();
  });

  test("each way's × names what it removes", async () => {
    givenRules(ONE_LADDER);
    renderPage();
    await screen.findByTestId("paging-ladder");

    expect(
      screen
        .getAllByTestId("paging-ladder-step-remove")
        .map((button: HTMLElement): string | null => {
          return button.getAttribute("aria-label");
        }),
    ).toEqual(["Remove SMS: +15550100", "Remove Phone call: +15550100"]);
  });

  test("removing every step leaves nothing to save: an empty ladder pages nobody", async () => {
    givenRules(ONE_LADDER);
    renderPage();
    await screen.findByTestId("paging-ladder");

    while (screen.queryAllByTestId("paging-ladder-step-remove").length > 0) {
      fireEvent.click(screen.getAllByTestId("paging-ladder-step-remove")[0]!);
    }

    expect(screen.getByTestId("paging-ladder-empty")).toBeInTheDocument();
    expect(screen.getByTestId("paging-ladder-save")).toBeDisabled();
    expect(screen.getByTestId("paging-ladder-discard")).toBeInTheDocument();
  });

  test("changes not saved yet hold the leave guard, until they are saved or discarded", async () => {
    givenRules(ONE_LADDER);
    renderPage();
    await screen.findByTestId("paging-ladder");

    expect(LeaveGuard.isHeld()).toBe(false);

    changeStepWait(1, 15);
    expect(LeaveGuard.isHeld()).toBe(true);

    fireEvent.click(screen.getByTestId("paging-ladder-discard"));
    expect(LeaveGuard.isHeld()).toBe(false);

    changeStepWait(1, 15);
    expect(LeaveGuard.isHeld()).toBe(true);

    givenRules(
      rulesFor(CELLS, [
        step("userSmsId", SMS, 0),
        step("userCallId", CALL, 15),
      ]),
    );
    fireEvent.click(screen.getByTestId("paging-ladder-save"));

    await screen.findByTestId("paging-ladder-saved");
    expect(LeaveGuard.isHeld()).toBe(false);
  });

  test("a changed step over rules that differ saves without asking, and the cards that differ keep their own rules (#8890)", async () => {
    givenRules(DIFFERING);
    renderPage();
    await screen.findByTestId("paging-ladder");

    changeStepWait(1, 15);
    // What the server writes: the new ladder, and Critical incidents still calling at once.
    givenRules([
      ...rulesFor(CELLS, [
        step("userSmsId", SMS, 0),
        step("userCallId", CALL, 15),
      ]),
      ...rulesFor([CELLS[0]!], [step("userCallId", CALL, 0)]),
    ]);
    fireEvent.click(screen.getByTestId("paging-ladder-save"));

    // Nothing is lost, so nothing to confirm.
    expect(
      screen.queryByTestId("paging-ladder-confirm-cards"),
    ).not.toBeInTheDocument();

    await waitFor(() => {
      expect(saveMock).toHaveBeenCalledTimes(1);
    });
    expect(saveMock).toHaveBeenCalledWith({
      userId: undefined,
      steps: [step("userSmsId", SMS, 0), step("userCallId", CALL, 15)],
      keepCards: [CELLS[0]],
    });
    expect(sendEventMock).toHaveBeenCalledWith(
      ProductEventName.PagingLadderSaved,
      { is_own: true, step_count: 2, replaced_card_count: 0 },
    );
    expect(await screen.findByTestId("paging-ladder-saved")).toHaveTextContent(
      "Saved. The severities that differ keep their own rules.",
    );
  });

  test("Use This Ladder for Every Severity names the cards that change, before anything is saved", async () => {
    givenRules(DIFFERING);
    renderPage();

    fireEvent.click(
      await screen.findByTestId("paging-ladder-use-for-every-severity"),
    );

    const confirmCards: HTMLElement = await screen.findByTestId(
      "paging-ladder-confirm-cards",
    );
    expect(
      screen.getByText("Use This Ladder for Every Severity?"),
    ).toBeInTheDocument();
    expect(within(confirmCards).getByText("Incidents")).toBeInTheDocument();
    expect(
      within(confirmCards).getByText("Critical Incident"),
    ).toBeInTheDocument();
    expect(saveMock).not.toHaveBeenCalled();

    givenRules(ONE_LADDER);
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(saveMock).toHaveBeenCalledTimes(1);
    });
    expect(saveMock).toHaveBeenCalledWith({
      userId: undefined,
      steps: [step("userSmsId", SMS, 0), step("userCallId", CALL, 5)],
      keepCards: undefined,
    });
    expect(
      (saveMock.mock.calls[0]![0] as { keepCards?: unknown }).keepCards,
    ).toBeUndefined();
    expect(sendEventMock).toHaveBeenCalledWith(
      ProductEventName.PagingLadderSaved,
      { is_own: true, step_count: 2, replaced_card_count: 1 },
    );
    expect(await screen.findByTestId("paging-ladder-saved")).toHaveTextContent(
      "Saved. Every severity now uses this ladder.",
    );
    // Read again: nothing differs any more.
    await waitFor(() => {
      expect(
        screen.queryByTestId("paging-ladder-differences-section"),
      ).not.toBeInTheDocument();
    });
  });

  test("a save the server refuses says why, and keeps the ladder as it was typed", async () => {
    givenRules(ONE_LADDER);
    saveMock.mockRejectedValue(
      new Error(
        "A step names a notification method that is not verified, or is not theirs in this project. Verify it in Notification Methods, or choose another method, then save.",
      ),
    );
    renderPage();
    await screen.findByTestId("paging-ladder");

    fireEvent.click(screen.getAllByTestId("paging-ladder-step-remove")[1]!);
    fireEvent.click(screen.getByTestId("paging-ladder-save"));

    expect(
      await screen.findByText(
        /is not verified, or is not theirs in this project/,
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("paging-ladder-step")).toHaveLength(1);
    expect(screen.queryByTestId("paging-ladder-saved")).not.toBeInTheDocument();
    // Still unsaved, and still asked about before leaving.
    expect(screen.getByTestId("paging-ladder-unsaved")).toBeInTheDocument();
    expect(LeaveGuard.isHeld()).toBe(true);
    await settle();
  });
});

describe("what is not verified yet", () => {
  test("a number waiting for its code is offered with Verify, and verifying reads the rules again", async () => {
    givenRules(ONE_LADDER);
    renderPage();
    await screen.findByTestId("paging-ladder");

    const notVerified: HTMLElement = screen.getByTestId(
      "paging-ladder-not-verified",
    );
    expect(within(notVerified).getByText("SMS")).toBeInTheDocument();

    // It is not offered as a step until it is verified.
    fireEvent.click(screen.getByTestId("paging-ladder-add-step-button"));
    expect(
      screen.queryByTestId(
        `paging-ladder-add-option-userSmsId:${UNVERIFIED_SMS}`,
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId(`paging-ladder-add-option-userCallId:${CALL}`),
    ).toBeInTheDocument();

    fireEvent.click(within(notVerified).getByTestId("paging-ladder-verify"));
    expect(await screen.findByText("Verify +447700900123")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Enter the right code"));

    await waitFor(() => {
      expect(loadDataMock).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByTestId("verify-modal-stub")).not.toBeInTheDocument();
    await settle();
  });

  test("somebody with no verified method is told where to add one", async () => {
    givenRules([]);
    loadMethodsMock.mockResolvedValue([
      choice("userSmsId", UNVERIFIED_SMS, "SMS", "+447700900123", false),
    ]);
    renderPage();

    expect(
      await screen.findByTestId("paging-ladder-no-methods"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("paging-ladder-add-first"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Set up more ways to be reached"),
    ).toBeInTheDocument();
  });
});

describe("a member's page", () => {
  const MEMBER_METHODS: Array<{
    methodType: string;
    methodId: string;
    maskedIdentifier: string;
    isVerified: boolean;
  }> = [
    {
      methodType: "SMS",
      methodId: SMS,
      maskedIdentifier: "+1 ••• ••• 0100",
      isVerified: true,
    },
    {
      methodType: "Call",
      methodId: CALL,
      maskedIdentifier: "+1 ••• ••• 0100",
      isVerified: true,
    },
  ];

  test("names the member, uses their masked methods, and saves their ladder with their id", async () => {
    givenRules(ONE_LADDER);
    renderPage({
      userId: new ObjectID(ANA),
      person: { displayName: "Ana Lopez", firstName: "Ana" },
      notificationMethods: MEMBER_METHODS,
      isEditable: true,
    });

    await screen.findByTestId("paging-ladder");
    expect(
      screen.getByText("How to reach Ana when they are on call"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "When Ana is paged, OneUptime tries each step in turn until somebody acknowledges.",
      ),
    ).toBeInTheDocument();
    expect(loadMethodsMock).not.toHaveBeenCalled();
    expect(loadDataMock).toHaveBeenCalledWith(new ObjectID(ANA));
    expect(screen.getAllByTestId("paging-ladder-method")[0]!).toHaveTextContent(
      "SMS: +1 ••• ••• 0100",
    );

    // No test page to yourself, and no Notification Methods of yours to send them to.
    expect(screen.queryByTestId("test-page-card-stub")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Set up more ways to be reached"),
    ).not.toBeInTheDocument();

    // A step's Add names the member, and sets up nothing of yours.
    const add: HTMLElement = within(stepGroup(0)).getByTestId(
      "paging-ladder-add-to-step",
    );
    expect(add).toHaveAttribute("aria-label", "Add a way to reach Ana");
    fireEvent.click(add);
    expect(offeredMethods()).toEqual(["Phone call: +1 ••• ••• 0100"]);
    expect(
      screen.queryByTestId("paging-ladder-set-up-more"),
    ).not.toBeInTheDocument();
    fireEvent.click(add);

    changeStepWait(1, 15);
    givenRules(
      rulesFor(CELLS, [
        step("userSmsId", SMS, 0),
        step("userCallId", CALL, 15),
      ]),
    );
    fireEvent.click(screen.getByTestId("paging-ladder-save"));

    await waitFor(() => {
      expect(saveMock).toHaveBeenCalledTimes(1);
    });
    expect(saveMock).toHaveBeenCalledWith({
      userId: new ObjectID(ANA),
      steps: [step("userSmsId", SMS, 0), step("userCallId", CALL, 15)],
    });
    expect(sendEventMock).toHaveBeenCalledWith(
      ProductEventName.PagingLadderSaved,
      { is_own: false, step_count: 2, replaced_card_count: 0 },
    );
    await screen.findByTestId("paging-ladder-saved");
  });

  test("somebody who may not change it reads it, with nothing to press but the grid", async () => {
    givenRules(ONE_LADDER);
    renderPage({
      userId: new ObjectID(ANA),
      person: { displayName: "Ana Lopez", firstName: "Ana" },
      notificationMethods: MEMBER_METHODS,
      isEditable: false,
    });

    await screen.findByTestId("paging-ladder");
    expect(screen.getAllByTestId("paging-ladder-step")).toHaveLength(2);
    // A step's time is read, not pressed.
    expect(
      within(stepGroup(1)).getByTestId("paging-ladder-step-wait").tagName,
    ).toBe("SPAN");
    expect(screen.queryByTestId("paging-ladder-save")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("paging-ladder-add-to-step"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("paging-ladder-add-step"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("paging-ladder-step-remove"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("paging-ladder-read-only")).toBeInTheDocument();
    expect(screen.getByTestId("paging-ladder-open-grid")).toBeInTheDocument();
  });

  test("a rule whose method readiness cannot name says so, never a blank", async () => {
    givenRules(ONE_LADDER);
    renderPage({
      userId: new ObjectID(ANA),
      person: { displayName: "Ana Lopez", firstName: "Ana" },
      notificationMethods: [],
      isEditable: true,
    });

    await screen.findByTestId("paging-ladder");
    expect(
      screen.getAllByText("A notification method this page cannot name"),
    ).toHaveLength(2);
    // Its × still names what it removes.
    expect(
      screen.getAllByTestId("paging-ladder-step-remove")[0],
    ).toHaveAttribute(
      "aria-label",
      "Remove A notification method this page cannot name",
    );
  });
});

/*
 * ADDING A WAY TO REACH YOU WITHOUT LEAVING THE PAGE (#7451): your phone,
 * with one number and one code for SMS and calls - the on-call guided
 * setup's own step - this browser, or the app; each offered only while it
 * would add something, and the ladder read again after each. And the
 * project's ask for a phone method (#7449).
 */
describe("adding a way to reach you from the ladder", () => {
  const ONLY_EMAIL: Array<PagingMethodChoice> = [
    choice("userEmailId", EMAIL, "Email", "me@example.com"),
  ];

  const givenOnlyEmail: () => void = (): void => {
    loadMethodsMock.mockResolvedValue(ONLY_EMAIL);
    givenRules(rulesFor(CELLS, [step("userEmailId", EMAIL, 0)]));
  };

  const addWays: () => Promise<HTMLElement> =
    async (): Promise<HTMLElement> => {
      return await screen.findByTestId("paging-ladder-add-ways");
    };

  const typeNumberAndSend: (value: string) => Promise<void> = async (
    value: string,
  ): Promise<void> => {
    const form: HTMLElement = await screen.findByTestId(
      "paging-ladder-phone-form",
    );
    fireEvent.change(within(form).getByTestId("paging-ladder-phone"), {
      target: { value: value },
    });
    fireEvent.click(within(form).getByTestId("paging-ladder-send-code"));
  };

  test("somebody with only their email is offered their phone, this browser and the app", async () => {
    givenOnlyEmail();
    renderPage();

    const ways: HTMLElement = await addWays();

    expect(
      within(ways).getByTestId("paging-ladder-add-phone"),
    ).toHaveTextContent(ADD_WAYS_COPY.addYourPhoneTitle);
    expect(
      within(ways).getByTestId("paging-ladder-use-this-browser"),
    ).toHaveTextContent(ON_CALL_SETUP_COPY.useThisBrowser);
    expect(
      within(ways).getByTestId("paging-ladder-get-the-app"),
    ).toHaveTextContent(ON_CALL_SETUP_COPY.getTheApp);
    // The project does not ask for a phone: nothing says it does.
    expect(within(ways).queryByTestId("paging-ladder-phone-asked")).toBeNull();
  });

  test("adds their phone with one number and one code, for SMS and calls, then puts SMS at once and a call after 5 minutes in their ladder", async () => {
    givenOnlyEmail();
    renderPage();

    fireEvent.click(
      within(await addWays()).getByTestId("paging-ladder-add-phone"),
    );

    // A number that is not one is said in place, and nothing is sent.
    await typeNumberAndSend("call me");
    expect(
      await screen.findByText(ON_CALL_SETUP_COPY.phoneError),
    ).toBeInTheDocument();
    expect(addSmsMock).not.toHaveBeenCalled();
    expect(phoneFactsMock).toHaveBeenCalledTimes(1);

    addSmsMock.mockResolvedValue({ id: NEW_SMS, isVerified: false } as never);

    await typeNumberAndSend("+1 (555) 123-4567");

    // One number, one code: the text's code, in the verify dialog.
    expect(await screen.findByText("Verify +15551234567")).toBeInTheDocument();
    expect(addSmsMock).toHaveBeenCalledWith("+15551234567");
    expect(addCallMock).not.toHaveBeenCalled();

    // Verified: the server gives each new method its rules in every card.
    loadMethodsMock.mockResolvedValue([
      ...ONLY_EMAIL,
      choice("userSmsId", NEW_SMS, "SMS", "+15551234567"),
      choice("userCallId", NEW_CALL, "Call", "+15551234567"),
    ]);
    givenRules(
      rulesFor(CELLS, [
        step("userEmailId", EMAIL, 0),
        step("userSmsId", NEW_SMS, 0),
        step("userCallId", NEW_CALL, 0),
      ]),
    );

    fireEvent.click(screen.getByText("Enter the right code"));

    // The same number for calls, with no second code.
    await waitFor(() => {
      expect(addCallMock).toHaveBeenCalledWith("+15551234567");
    });
    await waitFor(() => {
      expect(drawnSteps()).toEqual([
        {
          wait: "At once",
          methods: [
            "Email: me@example.com",
            "SMS: +15551234567",
            "Phone call: +15551234567",
          ],
        },
      ]);
    });
    expect(toastSuccessMock).toHaveBeenCalledWith(ADD_WAYS_COPY.phoneAdded);
    expect(screen.queryByTestId("verify-modal-stub")).toBeNull();
    // Their phone is here now: it is not offered again.
    expect(screen.queryByTestId("paging-ladder-add-phone")).toBeNull();

    // SMS at once, a call after 5 minutes: never leaving the page.
    const removeOf: (label: string) => HTMLElement = (
      label: string,
    ): HTMLElement => {
      return screen.getByRole("button", { name: `Remove ${label}` });
    };

    fireEvent.click(removeOf("Email: me@example.com"));
    fireEvent.click(removeOf("Phone call: +15551234567"));
    fireEvent.click(screen.getByTestId("paging-ladder-add-step-button"));
    fireEvent.click(
      screen.getByTestId(`paging-ladder-add-option-userCallId:${NEW_CALL}`),
    );

    expect(drawnSteps()).toEqual([
      { wait: "At once", methods: ["SMS: +15551234567"] },
      {
        wait: "After 5 minutes",
        methods: ["Phone call: +15551234567"],
      },
    ]);

    fireEvent.click(screen.getByTestId("paging-ladder-save"));

    await waitFor(() => {
      expect(saveMock).toHaveBeenCalledWith({
        userId: undefined,
        steps: [step("userSmsId", NEW_SMS, 0), step("userCallId", NEW_CALL, 5)],
      });
    });
    expect(navigateSpy).not.toHaveBeenCalled();
    await settle();
  });

  test("a number verified at once needs no code", async () => {
    givenOnlyEmail();
    addSmsMock.mockResolvedValue({ id: NEW_SMS, isVerified: true } as never);
    renderPage();

    fireEvent.click(
      within(await addWays()).getByTestId("paging-ladder-add-phone"),
    );
    await typeNumberAndSend("+15551234567");

    await waitFor(() => {
      expect(addCallMock).toHaveBeenCalledWith("+15551234567");
    });
    expect(screen.queryByTestId("verify-modal-stub")).toBeNull();
    await waitFor(() => {
      expect(loadDataMock).toHaveBeenCalledTimes(2);
    });
  });

  test("with calls off in the project, only SMS is added", async () => {
    givenOnlyEmail();
    phoneFactsMock.mockResolvedValue({
      isSmsOn: true,
      isCallOn: false,
      balanceInUSDCents: null,
    } as never);
    addSmsMock.mockResolvedValue({ id: NEW_SMS, isVerified: true } as never);
    renderPage();

    fireEvent.click(
      within(await addWays()).getByTestId("paging-ladder-add-phone"),
    );
    await waitFor(() => {
      expect(phoneFactsMock).toHaveBeenCalled();
    });
    await settle();
    await typeNumberAndSend("+15551234567");

    await waitFor(() => {
      expect(loadDataMock).toHaveBeenCalledTimes(2);
    });
    expect(addCallMock).not.toHaveBeenCalled();
  });

  test("with SMS off in the project, no number is asked for, and it says who can turn it on", async () => {
    givenOnlyEmail();
    phoneFactsMock.mockResolvedValue({
      isSmsOn: false,
      isCallOn: true,
      balanceInUSDCents: null,
    } as never);
    renderPage();

    fireEvent.click(
      within(await addWays()).getByTestId("paging-ladder-add-phone"),
    );

    expect(
      await screen.findByTestId("paging-ladder-sms-off"),
    ).toHaveTextContent(
      getChannelGatedMethodList(ChannelGatedMethodList.SMS).offSentence,
    );
    expect(screen.queryByTestId("paging-ladder-phone-form")).toBeNull();
  });

  test("a number the server refuses is said in its words, and the ladder stays", async () => {
    givenOnlyEmail();
    addSmsMock.mockRejectedValue(
      new Error("This number is already added. Verify it, or add another."),
    );
    renderPage();

    fireEvent.click(
      within(await addWays()).getByTestId("paging-ladder-add-phone"),
    );
    await typeNumberAndSend("+15551234567");

    expect(
      await screen.findByTestId("paging-ladder-phone-error"),
    ).toHaveTextContent("This number is already added");
    expect(loadDataMock).toHaveBeenCalledTimes(1);
  });

  test("Use this browser registers it from the click, and reads the ladder again", async () => {
    givenOnlyEmail();
    registerBrowserMock.mockResolvedValue({
      deviceId: BROWSER_PUSH,
      alreadyRegistered: false,
    } as never);
    renderPage();

    fireEvent.click(
      within(await addWays()).getByTestId("paging-ladder-use-this-browser"),
    );

    await waitFor(() => {
      expect(registerBrowserMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(loadDataMock).toHaveBeenCalledTimes(2);
    });
    expect(toastSuccessMock).toHaveBeenCalledWith(
      ON_CALL_SETUP_COPY.browserRegistered,
    );
  });

  test("a browser that blocks notifications is said in its own words", async () => {
    givenOnlyEmail();
    registerBrowserMock.mockRejectedValue(
      new BrowserPushError(BrowserPushProblem.PermissionBlocked),
    );
    renderPage();

    fireEvent.click(
      within(await addWays()).getByTestId("paging-ladder-use-this-browser"),
    );

    expect(
      await screen.findByTestId("paging-ladder-browser-error"),
    ).toHaveTextContent(
      BROWSER_PUSH_PROBLEM_MESSAGES[BrowserPushProblem.PermissionBlocked],
    );
    expect(loadDataMock).toHaveBeenCalledTimes(1);
  });

  test("Get the app shows its codes, and Recheck reads the ladder again", async () => {
    givenOnlyEmail();
    renderPage();

    const getTheApp: HTMLElement = within(await addWays()).getByTestId(
      "paging-ladder-get-the-app",
    );
    expect(getTheApp).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(getTheApp);

    expect(screen.getByTestId("app-codes-stub")).toBeInTheDocument();
    expect(getTheApp).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(screen.getByTestId("paging-ladder-app-recheck"));

    await waitFor(() => {
      expect(loadDataMock).toHaveBeenCalledTimes(2);
    });
  });

  test("only what would add something is offered", async () => {
    // A number, the app on a phone, and this browser, all there already.
    loadMethodsMock.mockResolvedValue([
      ...ONLY_EMAIL,
      choice("userSmsId", SMS, "SMS", "+15550100"),
      choice("userPushId", PUSH, "Push", "Pixel 8"),
      {
        ...choice("userPushId", BROWSER_PUSH, "Push", "Chrome on macOS"),
        hasPushLevel: false,
      },
    ]);
    thisBrowserDeviceId = BROWSER_PUSH;
    givenRules(ONE_LADDER);
    renderPage();

    await screen.findByTestId("paging-ladder");
    await settle();

    expect(screen.queryByTestId("paging-ladder-add-ways")).toBeNull();
  });

  test("this browser is not offered where it cannot be registered, nor push at all while the server has it off", async () => {
    givenOnlyEmail();
    browserProblemMock.mockReturnValue(
      BrowserPushProblem.InsecureConnection as never,
    );
    renderPage();

    const ways: HTMLElement = await addWays();

    expect(
      within(ways).queryByTestId("paging-ladder-use-this-browser"),
    ).toBeNull();
    expect(
      within(ways).getByTestId("paging-ladder-get-the-app"),
    ).toBeInTheDocument();

    cleanup();
    isPushTurnedOff = true;
    browserProblemMock.mockReturnValue(null as never);
    renderPage();

    const withoutPush: HTMLElement = await addWays();

    expect(
      within(withoutPush).queryByTestId("paging-ladder-use-this-browser"),
    ).toBeNull();
    expect(
      within(withoutPush).queryByTestId("paging-ladder-get-the-app"),
    ).toBeNull();
    expect(
      within(withoutPush).getByTestId("paging-ladder-add-phone"),
    ).toBeInTheDocument();
  });

  test("a project that asks everyone on call for a phone says so, until there is one", async () => {
    givenOnlyEmail();
    loadDataMock.mockResolvedValue({
      cells: CELLS,
      rules: rulesFor(CELLS, [step("userEmailId", EMAIL, 0)]),
      severityColors: {},
      isPhoneMethodRequired: true,
    });
    renderPage();

    expect(
      within(await addWays()).getByTestId("paging-ladder-phone-asked"),
    ).toHaveTextContent(ADD_WAYS_COPY.phoneAsked);

    cleanup();
    loadMethodsMock.mockResolvedValue(MY_METHODS);
    loadDataMock.mockResolvedValue({
      cells: CELLS,
      rules: ONE_LADDER,
      severityColors: {},
      isPhoneMethodRequired: true,
    });
    renderPage();

    await screen.findByTestId("paging-ladder");
    await settle();
    expect(screen.queryByTestId("paging-ladder-phone-asked")).toBeNull();
  });

  test("a member's page offers nothing to add: their methods are their own", async () => {
    givenRules(ONE_LADDER);
    renderPage({
      userId: new ObjectID(ANA),
      person: { displayName: "Ana Lopez", firstName: "Ana" },
      notificationMethods: [],
      isEditable: true,
    });

    await screen.findByTestId("paging-ladder");
    await settle();

    expect(screen.queryByTestId("paging-ladder-add-ways")).toBeNull();
    expect(addSmsMock).not.toHaveBeenCalled();
  });
});

/*
 * START FROM THE PROJECT'S DEFAULT (#9445): somebody who joined before the
 * project had a default ladder can put it into their own steps - mapped to
 * their verified methods as Readiness's Apply Default Ladder maps it - and
 * see what it leaves out. Nothing is saved until Save Changes, which saves
 * it as their own change through the ladder's own save.
 */
describe("starting from the project's default ladder (#9445)", () => {
  // Push and email at once, then SMS after 5 minutes.
  const DEFAULT_LADDER: Array<PagingLadderDefaultStep> = [
    {
      channel: OnCallPageChannel.Push,
      notifyAfterMinutes: 0,
      pushNotificationLevel: PushNotificationLevel.Critical,
    },
    { channel: OnCallPageChannel.Email, notifyAfterMinutes: 0 },
    { channel: OnCallPageChannel.SMS, notifyAfterMinutes: 5 },
  ];

  // What that default is for this person: their own push, email and verified SMS.
  const MY_DEFAULT_STEPS: Array<PagingLadderStep> = [
    {
      ...step("userPushId", PUSH, 0),
      pushNotificationLevel: PushNotificationLevel.Critical,
      repeatEveryMinutes: 0,
    },
    step("userEmailId", EMAIL, 0),
    step("userSmsId", SMS, 5),
  ];

  const startButton: () => HTMLElement | null = (): HTMLElement | null => {
    return screen.queryByTestId("paging-ladder-start-from-default");
  };

  test("a project with a default offers Start From the Project's Default beside the title", async () => {
    givenRules(ONE_LADDER, DEFAULT_LADDER);
    renderPage();

    await screen.findByTestId("paging-ladder");

    const button: HTMLElement = startButton()!;
    expect(button).toHaveTextContent(PAGING_LADDER_DEFAULT_START_COPY.start);
    // Beside the ladder's other action, Different for Some Severities, first.
    const header: HTMLElement = button.parentElement!.parentElement!;
    expect(
      within(header)
        .getAllByRole("button")
        .map((element: HTMLElement): string | null => {
          return element.getAttribute("data-testid");
        }),
    ).toEqual(["paging-ladder-start-from-default", "paging-ladder-open-grid"]);
  });

  test("pressing it fills the steps with the default as their own methods, and saves nothing", async () => {
    givenRules(ONE_LADDER, DEFAULT_LADDER);
    renderPage();

    await screen.findByTestId("paging-ladder");
    fireEvent.click(startButton()!);

    expect(drawnSteps()).toEqual([
      {
        wait: "At once",
        methods: ["Push notification: Pixel 8", "Email: me@example.com"],
      },
      { wait: "After 5 minutes", methods: ["SMS: +15550100"] },
    ]);
    expect(saveMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("paging-ladder-unsaved")).toBeInTheDocument();
    expect(
      screen.getByTestId("paging-ladder-started-from-default"),
    ).toHaveTextContent(PAGING_LADDER_DEFAULT_START_COPY.started);
    // Nothing of the default is left out, so nothing says it is.
    expect(
      screen.queryByTestId("paging-ladder-default-left-out"),
    ).not.toBeInTheDocument();
    // The steps are the default's now: nothing more to start from.
    expect(startButton()).not.toBeInTheDocument();

    expect(sendEventMock).toHaveBeenCalledWith(
      ProductEventName.PagingLadderStartedFromDefault,
      { is_own: true, step_count: 3, left_out_count: 0 },
    );
    expect(LeaveGuard.isHeld()).toBe(true);
  });

  test("Save Changes saves it as their own ladder, in one request, as any change is saved", async () => {
    givenRules(ONE_LADDER, DEFAULT_LADDER);
    renderPage();

    await screen.findByTestId("paging-ladder");
    fireEvent.click(startButton()!);

    // What the rules read once it is saved: the default, on every card.
    givenRules(rulesFor(CELLS, MY_DEFAULT_STEPS), DEFAULT_LADDER);
    fireEvent.click(screen.getByTestId("paging-ladder-save"));

    await waitFor(() => {
      expect(saveMock).toHaveBeenCalledTimes(1);
    });
    expect(saveMock).toHaveBeenCalledWith({
      userId: undefined,
      steps: MY_DEFAULT_STEPS,
      keepCards: undefined,
    });
    expect(sendEventMock).toHaveBeenCalledWith(
      ProductEventName.PagingLadderSaved,
      { is_own: true, step_count: 3, replaced_card_count: 0 },
    );

    await screen.findByTestId("paging-ladder-saved");
    // Their ladder is the default now: it is not offered again.
    expect(startButton()).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("paging-ladder-started-from-default"),
    ).not.toBeInTheDocument();
  });

  test("Discard Changes puts their own ladder back, and offers the default again", async () => {
    givenRules(ONE_LADDER, DEFAULT_LADDER);
    renderPage();

    await screen.findByTestId("paging-ladder");
    fireEvent.click(startButton()!);
    fireEvent.click(screen.getByTestId("paging-ladder-discard"));

    expect(drawnSteps()).toEqual([
      { wait: "At once", methods: ["SMS: +15550100"] },
      { wait: "After 5 minutes", methods: ["Phone call: +15550100"] },
    ]);
    expect(startButton()).toBeInTheDocument();
    expect(
      screen.queryByTestId("paging-ladder-started-from-default"),
    ).not.toBeInTheDocument();
    expect(saveMock).not.toHaveBeenCalled();
  });

  test("a step changed after starting from it is their own draft again: the note goes, and the button is back", async () => {
    givenRules(ONE_LADDER, DEFAULT_LADDER);
    renderPage();

    await screen.findByTestId("paging-ladder");
    fireEvent.click(startButton()!);
    fireEvent.click(screen.getAllByTestId("paging-ladder-step-remove")[0]!);

    expect(
      screen.queryByTestId("paging-ladder-started-from-default"),
    ).not.toBeInTheDocument();
    expect(startButton()).toBeInTheDocument();
  });

  test("a channel they have not verified is left out and named, and their own steps of what the default does not use stay meanwhile", async () => {
    // Push at once, then Telegram, which this person has not linked.
    const withTelegram: Array<PagingLadderDefaultStep> = [
      { channel: OnCallPageChannel.Push, notifyAfterMinutes: 0 },
      { channel: OnCallPageChannel.Telegram, notifyAfterMinutes: 5 },
    ];

    givenRules(ONE_LADDER, withTelegram);
    renderPage();

    await screen.findByTestId("paging-ladder");
    fireEvent.click(startButton()!);

    // Their SMS and call stay beside the default's push.
    expect(drawnSteps()).toEqual([
      {
        wait: "At once",
        methods: ["Push notification: Pixel 8", "SMS: +15550100"],
      },
      { wait: "After 5 minutes", methods: ["Phone call: +15550100"] },
    ]);
    expect(
      screen.getByTestId("paging-ladder-default-left-out"),
    ).toHaveTextContent(
      "You have not verified Telegram yet, so those steps are left out, and your own SMS, phone call steps stay meanwhile.",
    );
    expect(sendEventMock).toHaveBeenCalledWith(
      ProductEventName.PagingLadderStartedFromDefault,
      { is_own: true, step_count: 3, left_out_count: 1 },
    );
  });

  test("a channel left out with nothing of theirs to keep is named alone", async () => {
    // Their email after 5 minutes: every step they have is of the default's channels.
    givenRules(rulesFor(CELLS, [step("userEmailId", EMAIL, 5)]), [
      { channel: OnCallPageChannel.Email, notifyAfterMinutes: 0 },
      { channel: OnCallPageChannel.WhatsApp, notifyAfterMinutes: 10 },
    ]);
    renderPage();

    await screen.findByTestId("paging-ladder");
    fireEvent.click(startButton()!);

    expect(
      screen.getByTestId("paging-ladder-default-left-out"),
    ).toHaveTextContent(
      "You have not verified WhatsApp yet, so those steps are left out.",
    );
  });

  test("not offered when their ladder already is the default, nor without one", async () => {
    givenRules(rulesFor(CELLS, MY_DEFAULT_STEPS), DEFAULT_LADDER);
    renderPage();

    await screen.findByTestId("paging-ladder");
    expect(startButton()).not.toBeInTheDocument();

    cleanup();
    givenRules(ONE_LADDER, []);
    renderPage();

    await screen.findByTestId("paging-ladder");
    expect(startButton()).not.toBeInTheDocument();
  });

  test("not offered when they have verified none of the default's channels: it would leave them nothing", async () => {
    givenRules(ONE_LADDER, [
      { channel: OnCallPageChannel.Telegram, notifyAfterMinutes: 0 },
      { channel: OnCallPageChannel.WhatsApp, notifyAfterMinutes: 5 },
    ]);
    renderPage();

    await screen.findByTestId("paging-ladder");
    expect(startButton()).not.toBeInTheDocument();
  });

  test("an empty ladder can start from it too", async () => {
    givenRules([], DEFAULT_LADDER);
    renderPage();

    await screen.findByTestId("paging-ladder-empty");
    fireEvent.click(startButton()!);

    expect(drawnSteps()).toHaveLength(2);
    expect(screen.getByTestId("paging-ladder-save")).not.toBeDisabled();
  });

  describe("on a member's page", () => {
    // Ana has verified email and a phone call, and no SMS.
    const ANA_METHODS: Array<{
      methodType: string;
      methodId: string;
      maskedIdentifier: string;
      isVerified: boolean;
    }> = [
      {
        methodType: "Email",
        methodId: EMAIL,
        maskedIdentifier: "a•••@example.com",
        isVerified: true,
      },
      {
        methodType: "Call",
        methodId: CALL,
        maskedIdentifier: "+1 ••• ••• 0100",
        isVerified: true,
      },
    ];

    const renderAna: (isEditable: boolean) => void = (
      isEditable: boolean,
    ): void => {
      renderPage({
        userId: new ObjectID(ANA),
        person: { displayName: "Ana Lopez", firstName: "Ana" },
        notificationMethods: ANA_METHODS,
        isEditable: isEditable,
      });
    };

    test("an admin who may change Ana's ladder starts it from the default, named in her words, and saves it for her", async () => {
      // Ana calls herself at once; the default emails, then texts.
      givenRules(rulesFor(CELLS, [step("userCallId", CALL, 0)]), [
        { channel: OnCallPageChannel.Email, notifyAfterMinutes: 0 },
        { channel: OnCallPageChannel.SMS, notifyAfterMinutes: 5 },
      ]);
      renderAna(true);

      await screen.findByTestId("paging-ladder");
      fireEvent.click(startButton()!);

      expect(drawnSteps()).toEqual([
        {
          wait: "At once",
          methods: ["Email: a•••@example.com", "Phone call: +1 ••• ••• 0100"],
        },
      ]);
      expect(
        screen.getByTestId("paging-ladder-default-left-out"),
      ).toHaveTextContent(
        "Ana has not verified SMS yet, so those steps are left out, and their own phone call steps stay meanwhile.",
      );

      fireEvent.click(screen.getByTestId("paging-ladder-save"));

      await waitFor(() => {
        expect(saveMock).toHaveBeenCalledTimes(1);
      });
      expect(saveMock).toHaveBeenCalledWith({
        userId: new ObjectID(ANA),
        steps: [step("userEmailId", EMAIL, 0), step("userCallId", CALL, 0)],
        keepCards: undefined,
      });
      expect(sendEventMock).toHaveBeenCalledWith(
        ProductEventName.PagingLadderStartedFromDefault,
        { is_own: false, step_count: 2, left_out_count: 1 },
      );
    });

    test("somebody who may only read Ana's ladder is offered nothing", async () => {
      givenRules(rulesFor(CELLS, [step("userCallId", CALL, 0)]), [
        { channel: OnCallPageChannel.Email, notifyAfterMinutes: 0 },
      ]);
      renderAna(false);

      await screen.findByTestId("paging-ladder");
      expect(startButton()).not.toBeInTheDocument();
    });
  });
});

/*
 * STEPS THIS SERVER CAN'T SEND RIGHT NOW (#9446): a step of email, SMS or a
 * call that GET /project-can-send says no to is marked, and the page says
 * once why and who can fix it, in Notification Methods' words. Never while
 * the answer is not known, or is yes.
 */
describe("steps this server can't send right now (#9446)", () => {
  // Email at once, SMS after 5 minutes, a call after 10.
  const THREE_CHANNELS: Array<PagingLadderRule> = rulesFor(CELLS, [
    step("userEmailId", EMAIL, 0),
    step("userSmsId", SMS, 5),
    step("userCallId", CALL, 10),
  ]);

  // Which steps are marked, by their method's label.
  const markedSteps: () => Array<string> = (): Array<string> => {
    return screen
      .getAllByTestId("paging-ladder-step")
      .filter((row: HTMLElement): boolean => {
        return (
          within(row).queryByTestId("paging-ladder-not-sent-now-mark") !== null
        );
      })
      .map((row: HTMLElement): string => {
        return (
          within(row).getByTestId("paging-ladder-method").textContent || ""
        );
      });
  };

  const notices: () => Array<HTMLElement> = (): Array<HTMLElement> => {
    return screen.queryAllByTestId(STEPS_NOT_SENT_NOW_TEST_ID);
  };

  test.each([
    [
      "email",
      { email: false, sms: true, call: true },
      ["Email: me@example.com"],
      SERVER_CANNOT_SEND_COPY[ServerCannotSendChannel.Email].member,
    ],
    [
      "SMS",
      { email: true, sms: false, call: true },
      ["SMS: +15550100"],
      SERVER_CANNOT_SEND_COPY[ServerCannotSendChannel.SMS].member,
    ],
    [
      "calls",
      { email: true, sms: true, call: false },
      ["Phone call: +15550100"],
      SERVER_CANNOT_SEND_COPY[ServerCannotSendChannel.Call].member,
    ],
  ])(
    "a server that can't send %s marks those steps, and says once why and who to ask",
    async (
      _channel: string,
      answer: ProjectCanSendAnswer,
      expectedMarked: Array<string>,
      sentence: string,
    ) => {
      projectCanSend = answer;
      givenRules(THREE_CHANNELS);
      renderPage();

      await screen.findByTestId("paging-ladder");

      expect(markedSteps()).toEqual(expectedMarked);
      for (const mark of screen.getAllByTestId(
        "paging-ladder-not-sent-now-mark",
      )) {
        expect(mark).toHaveTextContent(NOT_SENT_RIGHT_NOW);
      }

      // Said once for the page, not on every step.
      expect(notices()).toHaveLength(1);
      expect(notices()[0]!).toHaveTextContent(sentence);
      // Who to ask, never where to set it up: that is the server admin's.
      expect(
        within(notices()[0]!).queryByTestId(
          `${STEPS_NOT_SENT_NOW_TEST_ID}-fix`,
        ),
      ).toBeNull();
    },
  );

  test("SMS and calls stopped together are said in one sentence, and both steps are marked", async () => {
    projectCanSend = { email: true, sms: false, call: false };
    givenRules(THREE_CHANNELS);
    renderPage();

    await screen.findByTestId("paging-ladder");

    expect(markedSteps()).toEqual(["SMS: +15550100", "Phone call: +15550100"]);
    expect(notices()).toHaveLength(1);
    expect(notices()[0]!).toHaveTextContent(SMS_AND_CALLS_NOT_SENT_COPY.member);
    expect(notices()[0]!.querySelectorAll("p")).toHaveLength(1);
  });

  test("a fresh server that can send nothing: email in one sentence, SMS and calls in another", async () => {
    projectCanSend = { email: false, sms: false, call: false };
    givenRules(THREE_CHANNELS);
    renderPage();

    await screen.findByTestId("paging-ladder");

    expect(markedSteps()).toEqual([
      "Email: me@example.com",
      "SMS: +15550100",
      "Phone call: +15550100",
    ]);
    expect(
      Array.from(notices()[0]!.querySelectorAll("p")).map(
        (line: Element): string => {
          return line.textContent || "";
        },
      ),
    ).toEqual([
      SERVER_CANNOT_SEND_COPY[ServerCannotSendChannel.Email].member,
      SMS_AND_CALLS_NOT_SENT_COPY.member,
    ]);
  });

  test.each([
    ["the answer is not known yet", null],
    [
      "the server can send everything, as OneUptime Cloud always answers",
      PROJECT_CAN_SEND_EVERYTHING,
    ],
  ])(
    "nothing is marked or said while %s",
    async (_when: string, answer: ProjectCanSendAnswer | null) => {
      projectCanSend = answer ? { ...answer } : null;
      givenRules(THREE_CHANNELS);
      renderPage();

      await screen.findByTestId("paging-ladder");

      expect(markedSteps()).toEqual([]);
      expect(notices()).toEqual([]);
    },
  );

  /*
   * A project with its own Twilio config sends its SMS and calls through it
   * on a server that has none: the server answers yes for both (Project
   * CanSendReader), so only what the server itself can't send is marked.
   */
  test("a project with its own Twilio config: its SMS and call steps still go out, and only email is marked", async () => {
    projectCanSend = { email: false, sms: true, call: true };
    givenRules(THREE_CHANNELS);
    renderPage();

    await screen.findByTestId("paging-ladder");

    expect(markedSteps()).toEqual(["Email: me@example.com"]);
    expect(notices()[0]!).not.toHaveTextContent("SMS");
  });

  test("a ladder with no step of a stopped channel says nothing about it", async () => {
    projectCanSend = { email: false, sms: true, call: true };
    givenRules(ONE_LADDER);
    renderPage();

    await screen.findByTestId("paging-ladder");

    expect(markedSteps()).toEqual([]);
    expect(notices()).toEqual([]);
  });

  test("a step added to the ladder is marked at once, and the page says why", async () => {
    projectCanSend = { email: false, sms: true, call: true };
    givenRules(ONE_LADDER);
    renderPage();

    await screen.findByTestId("paging-ladder");
    expect(notices()).toEqual([]);

    fireEvent.click(
      within(stepGroup(0)).getByTestId("paging-ladder-add-to-step"),
    );
    fireEvent.click(
      screen.getByTestId(`paging-ladder-add-option-userEmailId:${EMAIL}`),
    );

    expect(markedSteps()).toEqual(["Email: me@example.com"]);
    expect(notices()).toHaveLength(1);
  });

  test("a master admin is sent to the Admin Dashboard to set it up", async () => {
    jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(true);
    projectCanSend = { email: true, sms: false, call: true };
    givenRules(THREE_CHANNELS);
    renderPage();

    await screen.findByTestId("paging-ladder");

    expect(notices()[0]!).toHaveTextContent(
      SERVER_CANNOT_SEND_COPY[ServerCannotSendChannel.SMS].admin,
    );

    const fix: HTMLElement = within(notices()[0]!).getByTestId(
      `${STEPS_NOT_SENT_NOW_TEST_ID}-fix`,
    );
    expect(fix).toHaveTextContent(
      SERVER_CANNOT_SEND_FIX_WORDS[ServerCannotSendChannel.SMS],
    );
    expect(fix.getAttribute("href")).toContain("/settings/call-and-sms");
  });

  test("a card that differs and calls besides the steps is marked, and named in the same notice", async () => {
    projectCanSend = { email: true, sms: true, call: false };
    // SMS at once everywhere; Critical incidents also call at once.
    givenRules([
      ...rulesFor(CELLS, [step("userSmsId", SMS, 0)]),
      ...rulesFor([CELLS[0]!], [step("userCallId", CALL, 0)]),
    ]);
    renderPage();

    await screen.findByTestId("paging-ladder-differences");

    expect(markedSteps()).toEqual([]);
    expect(
      within(screen.getByTestId("paging-ladder-differences")).getAllByTestId(
        "paging-ladder-step-chip-not-sent-now",
      ),
    ).toHaveLength(1);
    expect(notices()).toHaveLength(1);
    expect(notices()[0]!).toHaveTextContent(
      SERVER_CANNOT_SEND_COPY[ServerCannotSendChannel.Call].member,
    );
  });

  test("the grid's ladder says it once too, and marks the step's chip", async () => {
    projectCanSend = { email: true, sms: false, call: true };
    givenRules(ONE_LADDER);
    renderPage();

    await screen.findByTestId("paging-ladder");
    fireEvent.click(screen.getByTestId("paging-ladder-open-grid"));

    const summary: HTMLElement = await screen.findByTestId(
      "paging-ladder-summary",
    );

    expect(
      within(summary).getAllByTestId(STEPS_NOT_SENT_NOW_TEST_ID),
    ).toHaveLength(1);
    const chips: Array<HTMLElement> = within(summary).getAllByTestId(
      "paging-ladder-step-chip",
    );
    expect(
      chips.map((chip: HTMLElement): boolean => {
        return (
          within(chip).queryByTestId("paging-ladder-step-chip-not-sent-now") !==
          null
        );
      }),
    ).toEqual([true, false]);
    // A screen reader hears why the icon is there.
    expect(chips[0]!).toHaveTextContent(NOT_SENT_RIGHT_NOW);
  });

  test("Add your phone, while this server can't send SMS, says why instead of asking for a number its code could not reach", async () => {
    projectCanSend = { email: true, sms: false, call: false };
    loadMethodsMock.mockResolvedValue([
      choice("userEmailId", EMAIL, "Email", "me@example.com"),
    ]);
    givenRules(rulesFor(CELLS, [step("userEmailId", EMAIL, 0)]));
    renderPage();

    fireEvent.click(await screen.findByTestId("paging-ladder-add-phone"));

    expect(
      await screen.findByTestId("paging-ladder-sms-not-sent"),
    ).toHaveTextContent(PHONE_CODE_NOT_SENT_COPY.member);
    expect(
      screen.queryByTestId("paging-ladder-phone-form"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("paging-ladder-set-up-sms")).toBeNull();
    expect(addSmsMock).not.toHaveBeenCalled();
  });

  test("on a server that sends nothing, it never says email still reaches you, as the ladder above says it does not", async () => {
    projectCanSend = { email: false, sms: false, call: false };
    loadMethodsMock.mockResolvedValue([
      choice("userEmailId", EMAIL, "Email", "me@example.com"),
    ]);
    givenRules(rulesFor(CELLS, [step("userEmailId", EMAIL, 0)]));
    renderPage();

    fireEvent.click(await screen.findByTestId("paging-ladder-add-phone"));

    const words: HTMLElement = await screen.findByTestId(
      "paging-ladder-sms-not-sent",
    );
    expect(words).toHaveTextContent(PHONE_CODE_NOT_SENT_COPY.member);
    expect(words.textContent).not.toMatch(/email|the app/i);
    expect(notices()[0]!).toHaveTextContent(
      SERVER_CANNOT_SEND_COPY[ServerCannotSendChannel.Email].member,
    );
  });

  test("a master admin adding their phone there is sent where the ladder's notice sends them", async () => {
    jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(true);
    projectCanSend = { email: true, sms: false, call: true };
    loadMethodsMock.mockResolvedValue([
      choice("userEmailId", EMAIL, "Email", "me@example.com"),
    ]);
    givenRules(rulesFor(CELLS, [step("userEmailId", EMAIL, 0)]));
    renderPage();

    fireEvent.click(await screen.findByTestId("paging-ladder-add-phone"));

    expect(
      await screen.findByTestId("paging-ladder-sms-not-sent"),
    ).toHaveTextContent(PHONE_CODE_NOT_SENT_COPY.admin);

    const fix: HTMLElement = screen.getByTestId("paging-ladder-set-up-sms");
    expect(fix).toHaveTextContent(
      SERVER_CANNOT_SEND_FIX_WORDS[ServerCannotSendChannel.SMS],
    );
    expect(fix.getAttribute("href")).toContain("/settings/call-and-sms");
  });

  test("Add your phone asks for the number as before while SMS can go out", async () => {
    projectCanSend = { ...PROJECT_CAN_SEND_EVERYTHING };
    loadMethodsMock.mockResolvedValue([
      choice("userEmailId", EMAIL, "Email", "me@example.com"),
    ]);
    givenRules(rulesFor(CELLS, [step("userEmailId", EMAIL, 0)]));
    renderPage();

    fireEvent.click(await screen.findByTestId("paging-ladder-add-phone"));

    expect(
      await screen.findByTestId("paging-ladder-phone-form"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("paging-ladder-sms-not-sent")).toBeNull();
  });
});
