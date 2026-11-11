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
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * AN INVITED MEMBER'S FIRST STEPS ON HOME (issue #6807), drawn by the real
 * Welcome card (GettingStarted) with the server's answers, the personal
 * checklist and the shifts stood in for:
 *
 *  - who sees which card: a project's owner and admin the owner's
 *    checklist; a member and a viewer their own first steps, never
 *    "Create your first monitor";
 *  - "can OneUptime reach me": the checklist's headline and open steps,
 *    one click to it; only email while on call, one click to fix it;
 *  - "when am I on call": now, next, or nothing claimed when unread;
 *  - the mobile app's codes and the server's address;
 *  - a test page to myself, ticked when acknowledged;
 *  - Hide and Show, kept for this person on the server;
 *  - gone once reached and a test page has reached them;
 *  - the events: home/member_step_started, home/member_steps_dismissed.
 */

const navigateMock: MockFunction = getJestMockFunction();
const sendMock: MockFunction = getJestMockFunction();
const fetchMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();
const legacyMock: MockFunction = getJestMockFunction();
const shiftsMock: MockFunction = getJestMockFunction();
const checklistMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Home/WelcomeChecklist/WelcomeChecklistApi",
  () => {
    return {
      __esModule: true,
      fetchWelcomeChecklist: (...args: Array<unknown>) => {
        return fetchMock(...args);
      },
      postWelcomeChecklist: (...args: Array<unknown>) => {
        return postMock(...args);
      },
      sendLegacyBrowserState: (...args: Array<unknown>) => {
        return legacyMock(...args);
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/UserSettings/SetupChecklist/useSetupChecklist",
  () => {
    return {
      __esModule: true,
      default: (...args: Array<unknown>) => {
        return checklistMock(...args);
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/CalendarFeedAPI",
  () => {
    return {
      __esModule: true,
      default: {
        getMyShifts: (...args: Array<unknown>) => {
          return shiftsMock(...args);
        },
      },
    };
  },
);

// The test dialog: one button acknowledges, one closes.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/OnCallTestPage/SendTestPageModal",
  () => {
    return {
      __esModule: true,
      default: (props: {
        target: { kind: string };
        onClose: () => void;
        onResult?: (result: { status: string }) => void;
      }) => {
        return (
          <div data-testid="test-page-dialog" data-target={props.target.kind}>
            <button
              type="button"
              data-testid="test-page-acknowledged"
              onClick={() => {
                props.onResult?.({ status: "Acknowledged" });
              }}
            >
              acknowledge
            </button>
            <button
              type="button"
              data-testid="test-page-close"
              onClick={props.onClose}
            >
              close
            </button>
          </div>
        );
      },
    };
  },
);

jest.mock("../../../UI/Components/QR/QR", () => {
  return {
    __esModule: true,
    default: (props: { text: string }) => {
      return <span data-testid="qr-code" data-text={props.text} />;
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      isOnThisPage: () => {
        return false;
      },
      isStartWith: () => {
        return false;
      },
      navigate: (...args: Array<unknown>) => {
        return navigateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Analytics", () => {
  return {
    __esModule: true,
    default: {
      capture: () => {},
    },
  };
});

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

import GettingStarted from "../../../../App/FeatureSet/Dashboard/src/Components/Home/GettingStarted";
import { MEMBER_FIRST_STEPS_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/Home/MemberFirstSteps/MemberFirstStepsModel";
import {
  SetupChecklist,
  buildSetupChecklist,
} from "../../../../App/FeatureSet/Dashboard/src/Components/UserSettings/SetupChecklist/ChecklistModel";
import { SetupChecklistState } from "../../../../App/FeatureSet/Dashboard/src/Components/UserSettings/SetupChecklist/useSetupChecklist";
import {
  ReadinessMethodWire,
  ResponderSourceValue,
  UserReadinessWire,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/Readiness/ReadinessTypes";
import { MyShiftsResponse } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/CalendarFeedTypes";
import {
  MOBILE_APP_ANDROID_URL,
  MOBILE_APP_IOS_URL,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/MobileAppStoreLinks";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import { ProductEventName } from "../../../Types/Analytics/ProductEvent";
import Route from "../../../Types/API/Route";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import ObjectID from "../../../Types/ObjectID";
import { MaterializedShiftJson } from "../../../Types/OnCallDutyPolicy/MaterializedShift";
import {
  WelcomeAudience,
  WelcomeChecklistStepState,
  WelcomeStep,
} from "../../../Types/WelcomeChecklist/WelcomeChecklist";
import {
  WELCOME_CHECKLIST_HIDE_ROUTE,
  WELCOME_CHECKLIST_SHOW_ROUTE,
  WelcomeChecklistAnswer,
  getEmptyWelcomeChecklistAnswer,
} from "../../../Types/WelcomeChecklist/WelcomeChecklistAnswer";
import ProjectUtil from "../../../UI/Utils/Project";
import UserUtil from "../../../UI/Utils/User";

const PROJECT_ID: string = "65f00000000000000000dddd";
const USER_ID: string = "65f00000000000000000eeee";
const HOUR: number = 60 * 60 * 1000;
const DAY: number = 24 * HOUR;

function method(methodType: string, isVerified: boolean): ReadinessMethodWire {
  return {
    methodId: `method-${methodType}`,
    methodType: methodType,
    maskedIdentifier: "•••",
    isVerified: isVerified,
  };
}

function checklistFor(data?: {
  methods?: Array<ReadinessMethodWire> | undefined;
  reachedVia?: Array<ResponderSourceValue> | undefined;
}): SetupChecklist {
  const readiness: UserReadinessWire = {
    userId: USER_ID,
    userName: "Grace Hopper",
    userEmail: "grace@example.com",
    status: "Ready",
    methods: data?.methods ?? [method("Email", true)],
    coverage: [
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
      NotificationRuleType.ON_CALL_EXECUTED_ALERT,
      NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
    ].map((ruleType: NotificationRuleType) => {
      return {
        ruleType: ruleType,
        severityId: "11111111-1111-4111-8111-111111111111",
        severityName: "Sev1",
        hasRule: true,
        isOptOut: false,
      };
    }),
    reasons: [],
    reachedVia: data?.reachedVia ?? [],
    teams: [],
  };

  return buildSetupChecklist({
    readiness: readiness,
    isFallbackEnabled: true,
    isFallbackKnown: true,
    onCallShiftAlerts: { isKnown: true, hasAnyChannelEnabled: true },
    deliverableSettings: { isKnown: true, undeliverableChannels: [] },
    incomingCall: {
      isKnown: true,
      hasPolicyInProject: false,
      hasVerifiedNumber: false,
    },
    slack: {
      isKnown: true,
      isConnectedForProject: false,
      isConnectedForUser: false,
    },
    microsoftTeams: {
      isKnown: true,
      isConnectedForProject: false,
      isConnectedForUser: false,
    },
    customFields: { isKnown: true, fieldCount: 0, filledFieldCount: 0 },
  });
}

function checklistState(
  checklist: SetupChecklist | null,
  extra?: Partial<SetupChecklistState>,
): SetupChecklistState {
  return {
    isLoading: false,
    error: "",
    checklist: checklist,
    reload: async () => {},
    ...extra,
  };
}

function shift(start: number, end: number): MaterializedShiftJson {
  return {
    shiftKey: `shift-${start}`,
    contentHash: "hash",
    projectId: PROJECT_ID,
    scheduleId: "0d600000-0000-4000-8000-000000000011",
    scheduleName: "Primary on-call",
    scheduleTimezone: "UTC",
    userId: USER_ID,
    userName: "Grace Hopper",
    start: new Date(Date.now() + start).toISOString(),
    end: new Date(Date.now() + end).toISOString(),
    coverageSeconds: Math.round((end - start) / 1000),
    layerId: "layer-1",
    layerName: "Layer 1",
    policies: [],
    isPast: false,
    lastModifiedAt: "2026-10-01T00:00:00.000Z",
    shiftConfigVersion: 1,
  };
}

function shifts(list: Array<MaterializedShiftJson>): MyShiftsResponse {
  return { shifts: list, truncated: false, generatedAt: null };
}

function memberAnswer(
  extra?: Partial<WelcomeChecklistAnswer>,
): WelcomeChecklistAnswer {
  return {
    ...getEmptyWelcomeChecklistAnswer(),
    audience: WelcomeAudience.InvitedMember,
    ...extra,
  };
}

function ownerAnswer(): WelcomeChecklistAnswer {
  const steps: Array<WelcomeChecklistStepState> = [
    { step: WelcomeStep.Monitor, isDone: false, needsPlan: null, isNext: true },
    { step: WelcomeStep.OnCall, isDone: false, needsPlan: null, isNext: false },
  ];

  return {
    ...getEmptyWelcomeChecklistAnswer(),
    audience: WelcomeAudience.SetUp,
    goals: [],
    canChooseGoals: true,
    steps: steps,
    totalCount: steps.length,
  };
}

async function renderHome(): Promise<void> {
  await act(async () => {
    render(<GettingStarted projectId={new ObjectID(PROJECT_ID)} />);
  });
}

async function press(testId: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId(testId));
  });
}

function routeOf(pageMap: PageMap): string {
  return (RouteMap[pageMap] as Route)
    .toString()
    .replace(":projectId", PROJECT_ID);
}

function navigatedTo(): Array<string> {
  return navigateMock.mock.calls.map((call: Array<unknown>): string => {
    return String(call[0]);
  });
}

beforeEach(() => {
  window.localStorage.clear();
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest.spyOn(UserUtil, "getUserId").mockReturnValue(new ObjectID(USER_ID));
  legacyMock.mockResolvedValue(null);
  fetchMock.mockResolvedValue(memberAnswer());
  checklistMock.mockReturnValue(checklistState(checklistFor()));
  shiftsMock.mockResolvedValue(shifts([]));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  navigateMock.mockReset();
  sendMock.mockReset();
  fetchMock.mockReset();
  postMock.mockReset();
  legacyMock.mockReset();
  shiftsMock.mockReset();
  checklistMock.mockReset();
});

describe("who sees which card", () => {
  test("a project's owner or admin sees the owner's checklist, not the member's steps", async () => {
    fetchMock.mockResolvedValue(ownerAnswer());
    await renderHome();

    expect(screen.getByTestId("getting-started")).toBeInTheDocument();
    expect(screen.getByTestId("getting-started-task-monitor")).toBeVisible();
    expect(screen.queryByTestId("member-first-steps")).toBeNull();
    expect(checklistMock).not.toHaveBeenCalled();
    expect(shiftsMock).not.toHaveBeenCalled();
  });

  test("a member or viewer sees their own first steps, never Create your first monitor", async () => {
    await renderHome();

    const card: HTMLElement = screen.getByTestId("member-first-steps");

    expect(screen.getByText("Your first steps here")).toBeVisible();
    expect(card).not.toHaveTextContent("Create your first monitor");
    expect(screen.queryByTestId("getting-started")).toBeNull();
    expect(screen.queryByTestId("welcome-question")).toBeNull();
    // The person's own checklist, for this project.
    expect(checklistMock).toHaveBeenCalledWith({
      userId: new ObjectID(USER_ID),
      projectId: new ObjectID(PROJECT_ID),
    });
    expect(shiftsMock).toHaveBeenCalledTimes(1);
  });

  test("a member whose card is hidden gets a line to show it, and nothing is read", async () => {
    fetchMock.mockResolvedValue(memberAnswer({ isHiddenForMe: true }));
    await renderHome();

    expect(screen.getByTestId("member-first-steps-hidden")).toHaveTextContent(
      "You hid your first steps.",
    );
    expect(screen.queryByTestId("member-first-steps")).toBeNull();
    expect(checklistMock).not.toHaveBeenCalled();
    expect(shiftsMock).not.toHaveBeenCalled();
  });
});

describe("can OneUptime reach me", () => {
  test("open steps: the checklist's headline and how many are left, one click to it", async () => {
    checklistMock.mockReturnValue(
      checklistState(checklistFor({ methods: [method("SMS", false)] })),
    );
    await renderHome();

    const reach: HTMLElement = screen.getByTestId("member-first-steps-reach");

    expect(reach).toHaveTextContent("Make sure OneUptime can reach you");
    expect(reach).toHaveTextContent("A few things still need setting up");
    expect(screen.getByTestId("member-first-steps-reach-count")).toHaveTextContent(
      /^1 step left in your setup checklist$/,
    );
    expect(reach).toHaveAttribute("data-next", "true");

    await press("member-first-steps-reach");

    expect(navigatedTo()).toEqual([routeOf(PageMap.USER_SETTINGS_SETUP)]);
    expect(sendMock).toHaveBeenCalledWith(ProductEventName.MemberStepStarted, {
      step: "reach",
    });
  });

  test("only email while on a policy: said on Home, one click to Notification Methods", async () => {
    checklistMock.mockReturnValue(
      checklistState(checklistFor({ reachedVia: ["Team"] })),
    );
    await renderHome();

    const reach: HTMLElement = screen.getByTestId("member-first-steps-reach");

    expect(reach).toHaveTextContent("Add a faster way to reach you");
    expect(reach).toHaveTextContent("only email can reach you");

    await press("member-first-steps-reach");

    expect(navigatedTo()).toEqual([
      routeOf(PageMap.USER_SETTINGS_NOTIFICATION_METHODS),
    ]);
  });

  test("a server that cannot send email says email will not reach them", async () => {
    fetchMock.mockResolvedValue(memberAnswer({ canSendEmail: false }));
    await renderHome();

    expect(screen.getByTestId("member-first-steps-reach")).toHaveTextContent(
      "Email cannot reach you here",
    );
  });

  test("reached: a record, and the test page is next", async () => {
    await renderHome();

    const reach: HTMLElement = screen.getByTestId("member-first-steps-reach");

    expect(reach.tagName).toBe("DIV");
    expect(reach).toHaveAttribute("data-done", "true");
    expect(reach).toHaveTextContent("OneUptime can reach you");
    expect(screen.getByTestId("member-first-steps-test_page")).toHaveAttribute(
      "data-next",
      "true",
    );
  });

  test("a checklist that could not be read claims nothing", async () => {
    checklistMock.mockReturnValue(
      checklistState(null, { error: "Could not read your notification setup." }),
    );
    await renderHome();

    expect(screen.getByTestId("member-first-steps-reach")).toHaveTextContent(
      "Open your setup checklist to see what is left.",
    );
    expect(screen.queryByTestId("member-first-steps-on_call")).toBeNull();
  });
});

describe("when am I on call", () => {
  test("on call now: until when, on which schedule, one click to the shifts", async () => {
    shiftsMock.mockResolvedValue(shifts([shift(-HOUR, 2 * HOUR)]));
    await renderHome();

    const onCall: HTMLElement = screen.getByTestId("member-first-steps-on_call");

    expect(onCall).toHaveTextContent("You are on call now");
    expect(onCall).toHaveTextContent("Primary on-call, until");

    await press("member-first-steps-on_call");

    expect(navigatedTo()).toEqual([
      routeOf(PageMap.USER_SETTINGS_ON_CALL_CALENDAR_FEED),
    ]);
    expect(sendMock).toHaveBeenCalledWith(ProductEventName.MemberStepStarted, {
      step: "on_call",
    });
  });

  test("the next shift", async () => {
    shiftsMock.mockResolvedValue(shifts([shift(2 * DAY, 2 * DAY + 8 * HOUR)]));
    await renderHome();

    expect(screen.getByTestId("member-first-steps-on_call")).toHaveTextContent(
      /^Your next shift: /,
    );
  });

  test("no shift and no policy: not on call, and nowhere to go", async () => {
    await renderHome();

    const onCall: HTMLElement = screen.getByTestId("member-first-steps-on_call");

    expect(onCall).toHaveTextContent("You are not on call");
    expect(onCall.tagName).toBe("DIV");
  });

  test("shifts that could not be read draw no on-call tile", async () => {
    shiftsMock.mockRejectedValue(new Error("503"));
    await renderHome();

    expect(screen.queryByTestId("member-first-steps-on_call")).toBeNull();
    expect(screen.getByTestId("member-first-steps-reach")).toBeVisible();
  });
});

describe("the mobile app and the test page", () => {
  test("Get the mobile app opens its codes and this server's address", async () => {
    await renderHome();

    const tile: HTMLElement = screen.getByTestId("member-first-steps-mobile_app");

    expect(tile).toHaveAttribute("aria-expanded", "false");

    await press("member-first-steps-mobile_app");

    const panel: HTMLElement = screen.getByTestId(
      "member-first-steps-mobile-app-panel",
    );

    expect(tile).toHaveAttribute("aria-expanded", "true");
    expect(
      within(panel)
        .getAllByTestId("qr-code")
        .map((code: HTMLElement): string | null => {
          return code.getAttribute("data-text");
        }),
    ).toEqual([MOBILE_APP_IOS_URL, MOBILE_APP_ANDROID_URL]);
    expect(
      within(panel).getByTestId("member-first-steps-server-url"),
    ).toHaveTextContent(/^https?:\/\//);
    expect(sendMock).toHaveBeenCalledWith(ProductEventName.MemberStepStarted, {
      step: "mobile_app",
    });

    await press("member-first-steps-mobile_app");

    expect(
      screen.queryByTestId("member-first-steps-mobile-app-panel"),
    ).toBeNull();
  });

  test("a push device ticks the mobile app", async () => {
    checklistMock.mockReturnValue(
      checklistState(
        checklistFor({ methods: [method("Email", true), method("Push", true)] }),
      ),
    );
    await renderHome();

    expect(screen.getByTestId("member-first-steps-mobile_app")).toHaveAttribute(
      "data-done",
      "true",
    );
  });

  test("Send yourself a test page tests the person, and ticks once acknowledged", async () => {
    await renderHome();

    await press("member-first-steps-test_page");

    expect(screen.getByTestId("test-page-dialog")).toHaveAttribute(
      "data-target",
      "self",
    );
    expect(sendMock).toHaveBeenCalledWith(ProductEventName.MemberStepStarted, {
      step: "test_page",
    });

    await press("test-page-acknowledged");

    // The dialog stays up for its result; the tile is ticked behind it.
    expect(screen.getByTestId("test-page-dialog")).toBeVisible();
    expect(screen.getByTestId("member-first-steps-test_page")).toHaveAttribute(
      "data-done",
      "true",
    );

    await press("test-page-close");

    expect(screen.queryByTestId("test-page-dialog")).toBeNull();
    expect(screen.getByTestId("member-first-steps")).toBeVisible();
  });
});

describe("Hide, Show and done", () => {
  test("Hide keeps it hidden for this person, and says how many were left", async () => {
    postMock.mockResolvedValue(memberAnswer({ isHiddenForMe: true }));
    await renderHome();

    await press("member-first-steps-hide");

    expect(postMock).toHaveBeenCalledWith(WELCOME_CHECKLIST_HIDE_ROUTE, {});
    expect(sendMock).toHaveBeenCalledWith(
      ProductEventName.MemberStepsDismissed,
      { open_count: 1 },
    );
    expect(screen.getByTestId("member-first-steps-hidden")).toBeVisible();

    postMock.mockResolvedValue(memberAnswer());
    await press("member-first-steps-show");

    expect(postMock).toHaveBeenLastCalledWith(WELCOME_CHECKLIST_SHOW_ROUTE, {});
    expect(screen.getByTestId("member-first-steps")).toBeVisible();
  });

  test("a Hide that could not be saved says so on the card", async () => {
    postMock.mockResolvedValue(null);
    await renderHome();

    await press("member-first-steps-hide");

    expect(screen.getByTestId("member-first-steps")).toBeVisible();
    expect(screen.getByRole("alert")).toBeVisible();
  });

  test("reached, and a test page has reached them: nothing left, nothing drawn", async () => {
    fetchMock.mockResolvedValue(memberAnswer({ hasAcknowledgedTestPage: true }));
    await renderHome();

    expect(screen.queryByTestId("member-first-steps")).toBeNull();
    expect(screen.queryByTestId("member-first-steps-hidden")).toBeNull();
  });

  test("a test page acknowledged, the checklist still loading: nothing drawn for a moment", async () => {
    fetchMock.mockResolvedValue(memberAnswer({ hasAcknowledgedTestPage: true }));
    checklistMock.mockReturnValue(checklistState(null, { isLoading: true }));
    await renderHome();

    expect(screen.queryByTestId("member-first-steps")).toBeNull();
  });

  test("a test page acknowledged, but only email while on call: the card stays", async () => {
    fetchMock.mockResolvedValue(memberAnswer({ hasAcknowledgedTestPage: true }));
    checklistMock.mockReturnValue(
      checklistState(checklistFor({ reachedVia: ["Team"] })),
    );
    await renderHome();

    expect(screen.getByTestId("member-first-steps")).toBeVisible();
    expect(screen.getByTestId("member-first-steps-test_page")).toHaveAttribute(
      "data-done",
      "true",
    );
  });

  test("the card's words are the catalog's", () => {
    expect(MEMBER_FIRST_STEPS_COPY.title).toBe("Your first steps here");
  });
});
