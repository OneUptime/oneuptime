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
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The setup checklist, rendered for real.
 *
 * The pure model has its own suite; everything here is a property that is
 * invisible to it, because it is about what reaches the DOM and what reaches
 * the network:
 *
 *   - the three step states have to LOOK different, not merely carry different
 *     enum members, because the entire promise of this page is that somebody
 *     can see what is left without reading every row;
 *   - a step nobody can act on must not be clickable, and an actionable one
 *     must go to the page that fixes it - a checklist whose links land on the
 *     wrong settings page is worse than no links;
 *   - a slow load keeps the card's shape, because a card that blanks reads as
 *     broken and this one waits on several requests;
 *   - a failed readiness read shows the server's own message and NO list. The
 *     all-clear is the one claim this page must never make on partial evidence,
 *     and a green "you are all set" drawn from a failed request is exactly that
 *     claim;
 *   - one refused probe must not take the page down with it;
 *   - and no raw email address or phone number ever reaches the DOM. The server
 *     masks; this asserts the browser layer never un-masks, so a change that
 *     starts rendering a raw field the API happens to include fails here even
 *     with the server-side masking tests green. The fixture plants the raw
 *     values next to the masked ones precisely so that assertion means
 *     something.
 */

/*
 * Mounting the real page costs real module work per test. The default 5s budget
 * is a machine-speed check, not an assertion about this code.
 */
jest.setTimeout(120000);

const apiGetMock: MockFunction = getJestMockFunction();
const getCommonHeadersMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();
const navigateMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the compiled
 * requires, so the consts above are still in their temporal dead zone when the
 * factory body runs. Dereferencing them lazily, at call time, is what works.
 */
jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: (...args: Array<any>) => {
        return apiGetMock(...args);
      },
      /*
       * Reads the error's own text, so an assertion about the message on screen
       * is an assertion that the SERVER's message was surfaced rather than a
       * generic one this test also wrote.
       */
      getFriendlyMessage: (error: unknown) => {
        return error instanceof Error
          ? error.message
          : "Could not load your setup";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (...args: Array<any>) => {
        return getCommonHeadersMock(...args);
      },
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
      count: (...args: Array<any>) => {
        return countMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      navigate: (...args: Array<any>) => {
        return navigateMock(...args);
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

/* Imports of the code under test come AFTER every jest.mock call. */
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../Types/ObjectID";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncomingCallPolicy from "../../../Models/DatabaseModels/IncomingCallPolicy";
import Project from "../../../Models/DatabaseModels/Project";
import ProjectUserProfile from "../../../Models/DatabaseModels/ProjectUserProfile";
import TeamMemberCustomField from "../../../Models/DatabaseModels/TeamMemberCustomField";
import UserCall from "../../../Models/DatabaseModels/UserCall";
import UserEmail from "../../../Models/DatabaseModels/UserEmail";
import UserIncomingCallNumber from "../../../Models/DatabaseModels/UserIncomingCallNumber";
import UserNotificationSetting from "../../../Models/DatabaseModels/UserNotificationSetting";
import UserSMS from "../../../Models/DatabaseModels/UserSMS";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import ProjectUtil from "../../../UI/Utils/Project";
import UserUtil from "../../../UI/Utils/User";
import SetupChecklist from "../../../../App/FeatureSet/Dashboard/src/Components/UserSettings/SetupChecklist/SetupChecklist";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const USER_ID: ObjectID = new ObjectID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");

const SEVERITY_ONE: string = "11111111-1111-4111-8111-111111111111";
const SEVERITY_TWO: string = "22222222-2222-4222-8222-222222222222";
const ALERT_SEVERITY: string = "33333333-3333-4333-8333-333333333333";

/*
 * The raw values that must never be rendered. They are planted INSIDE the
 * readiness payload next to their masked forms, which is the whole point: the
 * assertion "no email address appears in the DOM" only means something if an
 * email address was available to leak.
 */
const RAW_EMAIL: string = "ada.lovelace@analytical-engine.example.com";
const RAW_PHONE: string = "+441632960123";

const EMAIL_PATTERN: RegExp = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_PATTERN: RegExp = /\+?\d[\d\s().-]{6,}\d/;

type CoverageFunction = (params?: {
  incidentSev2HasRule?: boolean | undefined;
  includeAlerts?: boolean | undefined;
}) => JSONArray;

const coverageJson: CoverageFunction = (params?: {
  incidentSev2HasRule?: boolean | undefined;
  includeAlerts?: boolean | undefined;
}): JSONArray => {
  const cells: JSONArray = [
    {
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      severityId: SEVERITY_ONE,
      severityName: "Sev1",
      hasRule: true,
      isOptOut: false,
    },
    {
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      severityId: SEVERITY_TWO,
      severityName: "Sev2",
      hasRule: params?.incidentSev2HasRule ?? true,
      isOptOut: false,
    },
    {
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
      severityId: SEVERITY_ONE,
      severityName: "Sev1",
      hasRule: true,
      isOptOut: false,
    },
    {
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
      severityId: SEVERITY_TWO,
      severityName: "Sev2",
      hasRule: true,
      isOptOut: false,
    },
  ];

  if (params?.includeAlerts ?? true) {
    cells.push({
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
      severityId: ALERT_SEVERITY,
      severityName: "Warning",
      hasRule: true,
      isOptOut: false,
    });
    cells.push({
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
      severityId: ALERT_SEVERITY,
      severityName: "Warning",
      hasRule: true,
      isOptOut: false,
    });
  }

  return cells;
};

type ReadinessJsonFunction = (overrides?: JSONObject | undefined) => JSONObject;

const readinessJson: ReadinessJsonFunction = (
  overrides?: JSONObject | undefined,
): JSONObject => {
  return {
    userId: USER_ID.toString(),
    userName: "Ada Lovelace",
    /*
     * The login email is deliberately a REAL address here. The server sends it
     * unmasked (it is admin-readable everywhere a user is listed), so it is one
     * of the values this page has to decline to render.
     */
    userEmail: RAW_EMAIL,
    status: "Ready",
    methods: [
      {
        methodId: "method-email",
        methodType: "Email",
        maskedIdentifier: "a•••@•••.com",
        isVerified: true,
        // Not on the real wire; planted so the leak assertion has something to catch.
        email: RAW_EMAIL,
      },
      {
        methodId: "method-sms",
        methodType: "SMS",
        maskedIdentifier: "+44 ••• ••• 0123",
        isVerified: true,
        phone: RAW_PHONE,
      },
    ],
    coverage: coverageJson(),
    reasons: [],
    reachedVia: ["Team"],
    ...overrides,
  } as JSONObject;
};

type RespondWithFunction = (json: JSONObject) => void;

const respondWithReadiness: RespondWithFunction = (json: JSONObject): void => {
  apiGetMock.mockImplementation(((): Promise<HTTPResponse<JSONObject>> => {
    return Promise.resolve(new HTTPResponse<JSONObject>(200, json, {}));
  }) as never);
};

/*
 * The probe fixtures. Everything defaults to "nothing configured, nothing to
 * do" so that each test opts in to exactly the state it is about, and a probe
 * a test never mentions cannot quietly produce a row it did not expect.
 */
interface ProbeState {
  notificationSettings: Array<UserNotificationSetting>;
  customFields: Array<TeamMemberCustomField>;
  userProfiles: Array<ProjectUserProfile>;
  incomingCallPolicyCount: number;
  incomingCallNumberCount: number;
  slackProjectCount: number;
  slackUserCount: number;
  teamsProjectCount: number;
  teamsUserCount: number;
  failingListModels: Array<{ new (): BaseModel }>;
}

let probes: ProbeState;

interface SettingChannels {
  eventType: NotificationSettingEventType;
  alertByEmail?: boolean | undefined;
  alertBySMS?: boolean | undefined;
  alertByCall?: boolean | undefined;
  alertByPush?: boolean | undefined;
  alertByWhatsApp?: boolean | undefined;
  alertByTelegram?: boolean | undefined;
  alertByWebhook?: boolean | undefined;
}

type MakeSettingFunction = (params: SettingChannels) => UserNotificationSetting;

const makeSetting: MakeSettingFunction = (
  params: SettingChannels,
): UserNotificationSetting => {
  const setting: UserNotificationSetting = new UserNotificationSetting();
  setting.eventType = params.eventType;
  setting.alertByEmail = params.alertByEmail ?? false;
  setting.alertBySMS = params.alertBySMS ?? false;
  setting.alertByCall = params.alertByCall ?? false;
  setting.alertByPush = params.alertByPush ?? false;
  setting.alertByWhatsApp = params.alertByWhatsApp ?? false;
  setting.alertByTelegram = params.alertByTelegram ?? false;
  setting.alertByWebhook = params.alertByWebhook ?? false;

  return setting;
};

type WireProbesFunction = () => void;

const wireProbes: WireProbesFunction = (): void => {
  getListMock.mockImplementation((async (data: {
    modelType: { new (): BaseModel };
  }): Promise<unknown> => {
    if (
      probes.failingListModels.some((model: { new (): BaseModel }): boolean => {
        return model === data.modelType;
      })
    ) {
      /*
       * Thrown from inside the async body rather than returned as a
       * pre-built rejected promise: zone.js reports the latter as an
       * unhandled rejection in the microtask between construction and the
       * await that catches it, which fills a passing run with alarming
       * console noise.
       */
      throw new Error("Refused");
    }

    if (data.modelType === UserNotificationSetting) {
      return Promise.resolve({ data: probes.notificationSettings });
    }

    if (data.modelType === TeamMemberCustomField) {
      return Promise.resolve({ data: probes.customFields });
    }

    if (data.modelType === ProjectUserProfile) {
      return Promise.resolve({ data: probes.userProfiles });
    }

    return Promise.resolve({ data: [] });
  }) as never);

  countMock.mockImplementation(((data: {
    modelType: { new (): BaseModel };
    query: JSONObject;
  }): Promise<number> => {
    if (data.modelType === IncomingCallPolicy) {
      return Promise.resolve(probes.incomingCallPolicyCount);
    }

    if (data.modelType === UserIncomingCallNumber) {
      return Promise.resolve(probes.incomingCallNumberCount);
    }

    if (data.modelType === WorkspaceProjectAuthToken) {
      return Promise.resolve(
        data.query["workspaceType"] === WorkspaceType.Slack
          ? probes.slackProjectCount
          : probes.teamsProjectCount,
      );
    }

    if (data.modelType === WorkspaceUserAuthToken) {
      return Promise.resolve(
        data.query["workspaceType"] === WorkspaceType.Slack
          ? probes.slackUserCount
          : probes.teamsUserCount,
      );
    }

    return Promise.resolve(0);
  }) as never);
};

type RenderChecklistFunction = () => void;

const renderChecklist: RenderChecklistFunction = (): void => {
  render(<SetupChecklist userId={USER_ID} projectId={PROJECT_ID} />);
};

/*
 * Waits until the checklist has actually RENDERED, not merely until its
 * requests were made. Every negative assertion below has to run after this, or
 * it is an assertion about an empty page and would pass against a component
 * that renders nothing at all.
 */
/*
 * The project row, whose five switches decide both halves of the copy: the
 * fallback flag picks which consequence sentence is true, and the four channel
 * flags decide which of the reader's verified methods can carry anything. All
 * four channel flags default to FALSE on a real Project, which is why they are
 * spelled out per test rather than assumed.
 */
type RespondWithProjectFunction = (params: {
  disableFallback?: boolean | undefined;
  enableAllChannels?: boolean | undefined;
  enableSms?: boolean | undefined;
}) => void;

const respondWithProject: RespondWithProjectFunction = (params: {
  disableFallback?: boolean | undefined;
  enableAllChannels?: boolean | undefined;
  enableSms?: boolean | undefined;
}): void => {
  const project: Project = new Project();
  project.disableOnCallNotificationFallback = params.disableFallback ?? false;
  project.enableSmsNotifications =
    params.enableSms ?? params.enableAllChannels ?? false;
  project.enableCallNotifications = params.enableAllChannels ?? false;
  project.enableWhatsAppNotifications = params.enableAllChannels ?? false;
  project.enableTelegramNotifications = params.enableAllChannels ?? false;

  getItemMock.mockImplementation((async (): Promise<Project> => {
    return project;
  }) as never);
};

type SettleFunction = () => Promise<void>;

const settle: SettleFunction = async (): Promise<void> => {
  await waitFor((): void => {
    expect(screen.getByTestId("setup-checklist")).toBeInTheDocument();
  });

  await act(async (): Promise<void> => {
    await new Promise((resolve: (value: unknown) => void): void => {
      setTimeout(resolve, 50);
    });
  });
};

beforeEach((): void => {
  probes = {
    notificationSettings: [
      makeSetting({
        eventType:
          NotificationSettingEventType.SEND_WHEN_USER_IS_ON_CALL_ROSTER,
        alertByEmail: true,
      }),
    ],
    customFields: [],
    userProfiles: [],
    incomingCallPolicyCount: 0,
    incomingCallNumberCount: 0,
    slackProjectCount: 0,
    slackUserCount: 0,
    teamsProjectCount: 0,
    teamsUserCount: 0,
    failingListModels: [],
  };

  apiGetMock.mockReset();
  getCommonHeadersMock.mockReset();
  getListMock.mockReset();
  getItemMock.mockReset();
  countMock.mockReset();
  navigateMock.mockReset();

  getCommonHeadersMock.mockReturnValue({} as never);
  respondWithReadiness(readinessJson());

  respondWithProject({});

  wireProbes();

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(UserUtil, "getUserId").mockReturnValue(USER_ID);
});

afterEach((): void => {
  cleanup();
  jest.restoreAllMocks();
});

describe("setup checklist page - the happy render", () => {
  test("renders the checklist with its sections", async (): Promise<void> => {
    renderChecklist();
    await settle();

    expect(
      screen.getByTestId("setup-checklist-section-reachability"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("setup-checklist-section-paging"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("setup-checklist-section-awareness"),
    ).toBeInTheDocument();
  });

  test("asks the readiness endpoint for the signed-in user, with tenant headers", async (): Promise<void> => {
    renderChecklist();
    await settle();

    const url: string = String(
      (apiGetMock.mock.calls[0]![0] as { url: unknown }).url,
    );

    expect(url).toContain(`/on-call-readiness/user/${USER_ID.toString()}`);
    expect(getCommonHeadersMock).toHaveBeenCalled();
  });

  test("shows the green headline and no warning sentence when everything is done", async (): Promise<void> => {
    renderChecklist();
    await settle();

    expect(screen.getByTestId("setup-checklist-headline")).toHaveAttribute(
      "data-headline-status",
      "Ready",
    );
    expect(screen.getByText("You are all set")).toBeInTheDocument();
    expect(
      screen.queryByTestId("setup-checklist-consequence"),
    ).not.toBeInTheDocument();
  });

  /*
   * The states have to be distinguishable on screen. Asserting the attribute
   * rather than a class keeps the test about the SEMANTIC state while leaving
   * the styling free to change.
   */
  test("draws complete, outstanding and not-applicable steps as different states", async (): Promise<void> => {
    respondWithReadiness(
      readinessJson({
        status: "PartiallyReady",
        coverage: coverageJson({
          incidentSev2HasRule: false,
          includeAlerts: false,
        }),
      }),
    );

    renderChecklist();
    await settle();

    expect(
      screen.getByTestId("setup-checklist-step-add-method"),
    ).toHaveAttribute("data-status", "Complete");
    expect(
      screen.getByTestId("setup-checklist-step-incident-rules"),
    ).toHaveAttribute("data-status", "Incomplete");
    expect(
      screen.getByTestId("setup-checklist-step-alert-rules"),
    ).toHaveAttribute("data-status", "NotApplicable");
  });

  test("names the severity that has no rule", async (): Promise<void> => {
    respondWithReadiness(
      readinessJson({
        status: "PartiallyReady",
        coverage: coverageJson({ incidentSev2HasRule: false }),
      }),
    );

    renderChecklist();
    await settle();

    expect(
      screen.getByTestId("setup-checklist-detail-incident-rules"),
    ).toHaveTextContent("Sev2 has no rule.");
  });

  test("warns, in the second person, that gaps still reach you through the fallback", async (): Promise<void> => {
    respondWithReadiness(
      readinessJson({
        status: "PartiallyReady",
        coverage: coverageJson({ incidentSev2HasRule: false }),
      }),
    );

    renderChecklist();
    await settle();

    expect(screen.getByTestId("setup-checklist-consequence")).toHaveTextContent(
      "reach you through the fallback",
    );
  });

  test("says pages are dropped when the project has the fallback switched off", async (): Promise<void> => {
    respondWithProject({ disableFallback: true });

    respondWithReadiness(
      readinessJson({
        status: "PartiallyReady",
        coverage: coverageJson({ incidentSev2HasRule: false }),
      }),
    );

    renderChecklist();
    await settle();

    expect(screen.getByTestId("setup-checklist-consequence")).toHaveTextContent(
      "dropped",
    );
  });

  /*
   * The reassuring sentence and the alarming one are both plausible, and only
   * one is true. With the project read refused, the page says neither - but it
   * still names the gap.
   */
  test("says nothing about consequences when the project could not be read", async (): Promise<void> => {
    getItemMock.mockImplementation((async (): Promise<never> => {
      throw new Error("Refused");
    }) as never);

    respondWithReadiness(
      readinessJson({
        status: "PartiallyReady",
        coverage: coverageJson({ incidentSev2HasRule: false }),
      }),
    );

    renderChecklist();
    await settle();

    expect(
      screen.queryByTestId("setup-checklist-consequence"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("setup-checklist-detail-incident-rules"),
    ).toHaveTextContent("Sev2 has no rule.");
  });
});

describe("setup checklist page - acting on a step", () => {
  test("an outstanding step navigates to the page that fixes it", async (): Promise<void> => {
    respondWithReadiness(
      readinessJson({
        status: "PartiallyReady",
        coverage: coverageJson({ incidentSev2HasRule: false }),
      }),
    );

    renderChecklist();
    await settle();

    fireEvent.click(screen.getByTestId("setup-checklist-step-incident-rules"));

    const expected: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.USER_SETTINGS_INCIDENT_ON_CALL_RULES] as Route,
    );

    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(String(navigateMock.mock.calls[0]![0])).toBe(String(expected));
  });

  test("the alert rules step goes to the alert page, not the incident page", async (): Promise<void> => {
    const withUncoveredAlert: JSONArray = [
      ...coverageJson({ includeAlerts: false }),
      {
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
        severityId: ALERT_SEVERITY,
        severityName: "Warning",
        hasRule: false,
        isOptOut: false,
      },
    ];

    respondWithReadiness(
      readinessJson({
        status: "PartiallyReady",
        coverage: withUncoveredAlert,
      }),
    );

    renderChecklist();
    await settle();

    fireEvent.click(screen.getByTestId("setup-checklist-step-alert-rules"));

    const expected: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.USER_SETTINGS_ALERT_ON_CALL_RULES] as Route,
    );

    expect(String(navigateMock.mock.calls[0]![0])).toBe(String(expected));
  });

  test("a completed step is inert", async (): Promise<void> => {
    renderChecklist();
    await settle();

    const step: HTMLElement = screen.getByTestId(
      "setup-checklist-step-add-method",
    );

    expect(step).not.toHaveAttribute("role", "button");

    fireEvent.click(step);

    expect(navigateMock).not.toHaveBeenCalled();
  });

  /*
   * The blocked row's fix is on an admin screen this reader would be refused
   * from. A link that 403s is worse than a sentence naming who to ask.
   */
  test("a blocked step is not clickable and carries no link", async (): Promise<void> => {
    respondWithReadiness(
      readinessJson({
        status: "NotReachable",
        methods: [
          {
            methodId: "method-sms",
            methodType: "SMS",
            maskedIdentifier: "+44 ••• ••• 0123",
            isVerified: true,
          },
        ],
      }),
    );

    renderChecklist();
    await settle();

    const step: HTMLElement = screen.getByTestId(
      "setup-checklist-step-channels-enabled",
    );

    expect(step).toHaveAttribute("data-status", "Blocked");
    expect(step).not.toHaveAttribute("role", "button");

    fireEvent.click(step);

    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.getByText("Needs an admin")).toBeInTheDocument();
  });

  test("an outstanding step is reachable by keyboard", async (): Promise<void> => {
    respondWithReadiness(
      readinessJson({
        status: "PartiallyReady",
        coverage: coverageJson({ incidentSev2HasRule: false }),
      }),
    );

    renderChecklist();
    await settle();

    const step: HTMLElement = screen.getByTestId(
      "setup-checklist-step-incident-rules",
    );

    expect(step).toHaveAttribute("role", "button");
    expect(step).toHaveAttribute("tabindex", "0");

    fireEvent.keyDown(step, { key: "Enter" });

    expect(navigateMock).toHaveBeenCalledTimes(1);
  });
});

describe("setup checklist page - loading and failure", () => {
  test("keeps the card's shape while loading rather than blanking", async (): Promise<void> => {
    apiGetMock.mockImplementation(((): Promise<never> => {
      return new Promise((): void => {
        // never resolves: this test is about the state before the answer.
      });
    }) as never);

    renderChecklist();

    await waitFor((): void => {
      expect(screen.getByTestId("setup-checklist-loading")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("setup-checklist")).not.toBeInTheDocument();
  });

  test("surfaces the server's own message when readiness cannot be read", async (): Promise<void> => {
    apiGetMock.mockImplementation((async (): Promise<never> => {
      throw new Error("Readiness is having a bad day");
    }) as never);

    renderChecklist();

    await waitFor((): void => {
      expect(
        screen.getByText("Readiness is having a bad day"),
      ).toBeInTheDocument();
    });
  });

  /*
   * The claim this page must never make on partial evidence. A failed read has
   * to look like a failed read, not like a clean bill of health.
   */
  test("never renders an all-clear when readiness failed", async (): Promise<void> => {
    apiGetMock.mockImplementation((async (): Promise<never> => {
      throw new Error("Nope");
    }) as never);

    renderChecklist();

    await waitFor((): void => {
      expect(screen.getByText("Nope")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("setup-checklist")).not.toBeInTheDocument();
    expect(screen.queryByText("You are all set")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("setup-checklist-step-add-method"),
    ).not.toBeInTheDocument();
  });

  /*
   * Anchored on the error MESSAGE appearing, not on the checklist being absent.
   * The checklist is absent for the first few frames of every render, so a bare
   * absence assertion here passes while the card is still a skeleton and would
   * go on passing if the guard were deleted.
   */
  test("an HTTP error response is treated as a failure, not as an empty answer", async (): Promise<void> => {
    apiGetMock.mockImplementation((async (): Promise<HTTPErrorResponse> => {
      return new HTTPErrorResponse(500, {}, {});
    }) as never);

    renderChecklist();

    await waitFor((): void => {
      expect(screen.getByText("Could not load your setup")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("setup-checklist")).not.toBeInTheDocument();
    expect(screen.queryByText("You are all set")).not.toBeInTheDocument();
  });

  /*
   * A 200 whose body is not a readiness payload. Without the userId guard this
   * parses into an empty UserReadiness - no methods, no coverage - which the
   * model would render as a tidy list of green rows: the all-clear, drawn from
   * a response that said nothing at all.
   */
  test("treats a 200 that carries no readiness as a failure", async (): Promise<void> => {
    apiGetMock.mockImplementation((async (): Promise<
      HTTPResponse<JSONObject>
    > => {
      return new HTTPResponse<JSONObject>(200, {} as JSONObject, {});
    }) as never);

    renderChecklist();

    await waitFor((): void => {
      expect(
        screen.getByText("Could not read your notification setup."),
      ).toBeInTheDocument();
    });

    expect(screen.queryByTestId("setup-checklist")).not.toBeInTheDocument();
    expect(screen.queryByText("You are all set")).not.toBeInTheDocument();
  });

  /*
   * Readiness is cached server-side for 60 seconds. The whole reason somebody
   * presses Recheck is that they have just fixed something, so a Recheck that
   * re-reads a cache computed before the fix reports the stale answer and reads
   * as broken. The automatic load must NOT bypass the cache - there the cache is
   * doing its job.
   */
  test("Recheck bypasses the server cache, and the first load does not", async (): Promise<void> => {
    renderChecklist();
    await settle();

    const firstUrl: string = String(
      (apiGetMock.mock.calls[0]![0] as { url: unknown }).url,
    );

    expect(firstUrl).not.toContain("refresh");

    const callsBefore: number = apiGetMock.mock.calls.length;

    fireEvent.click(screen.getByTestId("setup-checklist-recheck"));

    await waitFor((): void => {
      expect(apiGetMock.mock.calls.length).toBeGreaterThan(callsBefore);
    });

    const recheckUrl: string = String(
      (
        apiGetMock.mock.calls[apiGetMock.mock.calls.length - 1]![0] as {
          url: unknown;
        }
      ).url,
    );

    expect(recheckUrl).toContain("refresh=true");
  });

  /*
   * A Recheck must not replace the list with grey blocks and take the button
   * that was just pressed off screen.
   */
  test("Recheck keeps the list on screen instead of collapsing to skeletons", async (): Promise<void> => {
    renderChecklist();
    await settle();

    fireEvent.click(screen.getByTestId("setup-checklist-recheck"));

    expect(screen.getByTestId("setup-checklist")).toBeInTheDocument();
    expect(
      screen.queryByTestId("setup-checklist-loading"),
    ).not.toBeInTheDocument();
  });
});

describe("setup checklist page - one probe failing", () => {
  /*
   * Each probe answers exactly one optional row. Losing the whole page over a
   * row the reader may not even need is a worse outcome than omitting it - and
   * omitting it is not the same as claiming they have not done it.
   */
  test("a refused notification-settings read drops its rows and keeps the page", async (): Promise<void> => {
    probes.failingListModels = [UserNotificationSetting];

    renderChecklist();
    await settle();

    expect(
      screen.getByTestId("setup-checklist-section-reachability"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("setup-checklist-step-on-call-shift-alerts"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("setup-checklist-step-deliverable-settings"),
    ).not.toBeInTheDocument();
  });

  test("a refused count drops only the row it answered", async (): Promise<void> => {
    countMock.mockImplementation((async (): Promise<number> => {
      throw new Error("Refused");
    }) as never);

    renderChecklist();
    await settle();

    expect(
      screen.getByTestId("setup-checklist-step-add-method"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("setup-checklist-step-slack"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("setup-checklist-step-incoming-call-number"),
    ).not.toBeInTheDocument();
  });
});

describe("setup checklist page - optional rows appear only when they apply", () => {
  test("shows Slack once the project has connected it", async (): Promise<void> => {
    probes.slackProjectCount = 1;
    probes.slackUserCount = 0;

    renderChecklist();
    await settle();

    const step: HTMLElement = screen.getByTestId("setup-checklist-step-slack");

    expect(step).toHaveAttribute("data-status", "Incomplete");

    fireEvent.click(step);

    const expected: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.USER_SETTINGS_SLACK_INTEGRATION] as Route,
    );

    expect(String(navigateMock.mock.calls[0]![0])).toBe(String(expected));
  });

  test("hides Slack when the project never connected it", async (): Promise<void> => {
    renderChecklist();
    await settle();

    expect(
      screen.queryByTestId("setup-checklist-step-slack"),
    ).not.toBeInTheDocument();
  });

  test("shows the incoming call row only where inbound calls are routed", async (): Promise<void> => {
    probes.incomingCallPolicyCount = 2;
    probes.incomingCallNumberCount = 0;

    renderChecklist();
    await settle();

    expect(
      screen.getByTestId("setup-checklist-step-incoming-call-number"),
    ).toHaveAttribute("data-status", "Incomplete");
  });

  test("counts custom fields by value, not by the profile row existing", async (): Promise<void> => {
    const field: TeamMemberCustomField = new TeamMemberCustomField();
    field.name = "Desk phone";

    const other: TeamMemberCustomField = new TeamMemberCustomField();
    other.name = "Timezone";

    const profile: ProjectUserProfile = new ProjectUserProfile();
    // an empty string is not an answer.
    profile.customFields = { "Desk phone": "  ", Timezone: "Europe/London" };

    probes.customFields = [field, other];
    probes.userProfiles = [profile];

    renderChecklist();
    await settle();

    expect(
      screen.getByTestId("setup-checklist-detail-custom-fields"),
    ).toHaveTextContent("1 field is still empty.");
  });
});

describe("setup checklist page - deliverable notification settings", () => {
  /*
   * The pairing between a Notification Settings column and the readiness method
   * type that makes it deliverable, driven end to end.
   *
   * Every channel is switched ON and only three have a verified method, so a
   * single mis-paired row shows up as the wrong name in the sentence. The model
   * suite cannot catch this: it is handed the finished list of channel names,
   * so the mapping itself is only exercised here. Webhook is deliberately among
   * the verified ones - if Telegram were paired to "Webhook" by mistake it would
   * silently become deliverable, and no fixture without a verified webhook would
   * notice.
   */
  test("names exactly the switched-on channels with no verified method behind them", async (): Promise<void> => {
    respondWithProject({ enableAllChannels: true });

    respondWithReadiness(
      readinessJson({
        methods: [
          {
            methodId: "m-email",
            methodType: "Email",
            maskedIdentifier: "a•••@•••.com",
            isVerified: true,
          },
          {
            methodId: "m-webhook",
            methodType: "Webhook",
            maskedIdentifier: "•••",
            isVerified: true,
          },
          {
            methodId: "m-whatsapp",
            methodType: "WhatsApp",
            maskedIdentifier: "+44 ••• ••• 0123",
            isVerified: true,
          },
        ],
      }),
    );

    probes.notificationSettings = [
      makeSetting({
        eventType:
          NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION,
        alertByEmail: true,
        alertBySMS: true,
        alertByCall: true,
        alertByPush: true,
        alertByWhatsApp: true,
        alertByTelegram: true,
        alertByWebhook: true,
      }),
    ];

    renderChecklist();
    await settle();

    expect(
      screen.getByTestId("setup-checklist-detail-deliverable-settings"),
    ).toHaveTextContent(
      "You switched on SMS, Call, Push and Telegram, but have no verified method there, so those updates are not sent.",
    );
  });

  /*
   * A verified method on a channel the PROJECT has switched off delivers
   * nothing. Readiness still reports it `isVerified: true` - the verification
   * really did happen - so scoring deliverability on verified alone would print
   * a clean bill of health to the one person whose SMS updates are going
   * nowhere.
   */
  test("does not count a verified method on a channel the project switched off", async (): Promise<void> => {
    respondWithProject({ enableAllChannels: false });

    respondWithReadiness(
      readinessJson({
        methods: [
          {
            methodId: "m-email",
            methodType: "Email",
            maskedIdentifier: "a•••@•••.com",
            isVerified: true,
          },
          {
            methodId: "m-sms",
            methodType: "SMS",
            maskedIdentifier: "+44 ••• ••• 0123",
            isVerified: true,
          },
        ],
      }),
    );

    probes.notificationSettings = [
      makeSetting({
        eventType:
          NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION,
        alertByEmail: true,
        alertBySMS: true,
      }),
    ];

    renderChecklist();
    await settle();

    expect(
      screen.getByTestId("setup-checklist-detail-deliverable-settings"),
    ).toHaveTextContent("You switched on SMS");
  });

  test("counts the same method once the project switches its channel on", async (): Promise<void> => {
    respondWithProject({ enableSms: true });

    respondWithReadiness(
      readinessJson({
        methods: [
          {
            methodId: "m-sms",
            methodType: "SMS",
            maskedIdentifier: "+44 ••• ••• 0123",
            isVerified: true,
          },
        ],
      }),
    );

    probes.notificationSettings = [
      makeSetting({
        eventType:
          NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION,
        alertBySMS: true,
      }),
    ];

    renderChecklist();
    await settle();

    expect(
      screen.getByTestId("setup-checklist-step-deliverable-settings"),
    ).toHaveAttribute("data-status", "Complete");
  });

  /*
   * An unverified address is the case this row exists for: the switch is green
   * and nothing arrives.
   */
  test("does not count an unverified method as deliverable", async (): Promise<void> => {
    respondWithProject({ enableAllChannels: true });

    respondWithReadiness(
      readinessJson({
        methods: [
          {
            methodId: "m-email",
            methodType: "Email",
            maskedIdentifier: "a•••@•••.com",
            isVerified: false,
          },
        ],
      }),
    );

    probes.notificationSettings = [
      makeSetting({
        eventType:
          NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION,
        alertByEmail: true,
      }),
    ];

    renderChecklist();
    await settle();

    expect(
      screen.getByTestId("setup-checklist-detail-deliverable-settings"),
    ).toHaveTextContent("You switched on Email");
  });
});

describe("setup checklist page - workspace rows", () => {
  /*
   * Slack and Microsoft Teams are two rows answered by the same two queries
   * discriminated only by workspaceType. Swapping that argument would light up
   * the wrong row, and only a fixture where the two ANSWERS differ can tell.
   */
  test("keeps Slack and Microsoft Teams apart", async (): Promise<void> => {
    probes.slackProjectCount = 1;
    probes.slackUserCount = 1;
    probes.teamsProjectCount = 1;
    probes.teamsUserCount = 0;

    renderChecklist();
    await settle();

    expect(screen.getByTestId("setup-checklist-step-slack")).toHaveAttribute(
      "data-status",
      "Complete",
    );
    expect(
      screen.getByTestId("setup-checklist-step-microsoft-teams"),
    ).toHaveAttribute("data-status", "Incomplete");
  });

  test("Microsoft Teams links to the Teams page, not the Slack one", async (): Promise<void> => {
    probes.teamsProjectCount = 1;
    probes.teamsUserCount = 0;

    renderChecklist();
    await settle();

    fireEvent.click(screen.getByTestId("setup-checklist-step-microsoft-teams"));

    const expected: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.USER_SETTINGS_MICROSOFT_TEAMS_INTEGRATION] as Route,
    );

    expect(String(navigateMock.mock.calls[0]![0])).toBe(String(expected));
  });
});

describe("setup checklist page - blocked steps are reconciled with the bar", () => {
  /*
   * Without this note somebody whose only verified method is on a switched-off
   * channel reads "N of N essential steps done" directly under "Nothing can
   * reach you yet", with nothing on screen explaining which to believe.
   */
  test("explains the steps the progress bar is not counting", async (): Promise<void> => {
    respondWithReadiness(
      readinessJson({
        status: "NotReachable",
        methods: [
          {
            methodId: "m-sms",
            methodType: "SMS",
            maskedIdentifier: "+44 ••• ••• 0123",
            isVerified: true,
          },
        ],
      }),
    );

    renderChecklist();
    await settle();

    expect(
      screen.getByTestId("setup-checklist-blocked-note"),
    ).toHaveTextContent("1 more step needs a project admin");
  });

  test("says nothing about blocked steps when there are none", async (): Promise<void> => {
    renderChecklist();
    await settle();

    expect(
      screen.queryByTestId("setup-checklist-blocked-note"),
    ).not.toBeInTheDocument();
  });
});

describe("setup checklist page - what it never does", () => {
  /*
   * The second barrier. The server masks; this asserts the browser never
   * un-masks, so a future change that starts rendering a raw field the API
   * happens to include fails here even with the server-side masking tests
   * green.
   */
  test("renders no raw email address and no raw phone number", async (): Promise<void> => {
    respondWithReadiness(
      readinessJson({
        status: "PartiallyReady",
        coverage: coverageJson({ incidentSev2HasRule: false }),
      }),
    );

    renderChecklist();
    await settle();

    const markup: string = document.body.innerHTML;

    expect(markup).not.toContain(RAW_EMAIL);
    expect(markup).not.toContain(RAW_PHONE);

    const text: string = document.body.textContent || "";

    expect(text).not.toMatch(EMAIL_PATTERN);
    expect(text).not.toMatch(PHONE_PATTERN);
  });

  /*
   * Asserted on the REQUEST rather than the response: the readiness payload is
   * the sanctioned masked source for method information, and a checklist that
   * started reading UserEmail or UserSMS rows to enrich a tile would be reading
   * raw identifiers it has no need for.
   */
  test("never asks for a notification-method model", async (): Promise<void> => {
    renderChecklist();
    await settle();

    const requestedModels: Array<unknown> = [
      ...getListMock.mock.calls,
      ...countMock.mock.calls,
    ].map((call: Array<unknown>): unknown => {
      return (call[0] as { modelType: unknown }).modelType;
    });

    expect(requestedModels).not.toContain(UserEmail);
    expect(requestedModels).not.toContain(UserSMS);
    expect(requestedModels).not.toContain(UserCall);
  });

  test("does not ask to verify methods when there are none to verify", async (): Promise<void> => {
    respondWithReadiness(
      readinessJson({
        status: "NotReachable",
        methods: [],
      }),
    );

    renderChecklist();
    await settle();

    expect(
      screen.getByTestId("setup-checklist-step-add-method"),
    ).toHaveAttribute("data-status", "Incomplete");
    expect(
      screen.queryByTestId("setup-checklist-step-verify-methods"),
    ).not.toBeInTheDocument();
  });

  test("tells somebody with nothing configured that nothing can reach them", async (): Promise<void> => {
    respondWithReadiness(
      readinessJson({
        status: "NotReachable",
        methods: [],
      }),
    );

    renderChecklist();
    await settle();

    expect(screen.getByTestId("setup-checklist-headline")).toHaveAttribute(
      "data-headline-status",
      "NotReachable",
    );
    expect(screen.getByText("Nothing can reach you yet")).toBeInTheDocument();
  });
});
