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
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import fs from "fs";
import path from "path";
import React, { ReactElement } from "react";
import {
  Location,
  MemoryRouter,
  Route as RouterRoute,
  Routes,
  useLocation,
} from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  CustomFieldProbe,
  DeliverableSettingsProbe,
  IncomingCallProbe,
  OnCallShiftAlertProbe,
  SetupChecklist,
  SetupChecklistInput,
  SetupHeadlineStatus,
  WorkspaceProbe,
  buildSetupChecklist,
  hasEssentialStepsLeft,
} from "../../../../App/FeatureSet/Dashboard/src/Components/UserSettings/SetupChecklist/ChecklistModel";
import {
  ReadinessCoverageCellWire,
  ReadinessMethodWire,
  ReadinessStatusValue,
  UserReadinessWire,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/Readiness/ReadinessTypes";
import {
  USER_SETTINGS_LANDING_KEY_PREFIX,
  USER_SETTINGS_LANDING_RECHECK_AFTER_IN_MS,
  getUserSettingsLandingPage,
  isLandingDueForRecheck,
  readRememberedLanding,
  rememberLanding,
} from "../../../../App/FeatureSet/Dashboard/src/Components/UserSettings/SetupChecklist/UserSettingsLanding";
import UserSettingsLanding, {
  LANDING_HAND_OVER_FRESH_FOR_IN_MS,
  readLandingHandOver,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/UserSettings/Landing";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import { getUserSettingsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/UserSettingsBreadcrumbs";
import Link from "../../../Types/Link";
import Navigation from "../../../UI/Utils/Navigation";
import { goTo } from "./SideMenuHarness";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import ObjectID from "../../../Types/ObjectID";
import Route from "../../../Types/API/Route";

/*
 * USER SETTINGS OPENS ON THE SETUP CHECKLIST WHILE IT HAS ESSENTIAL STEPS
 * LEFT (#7039), and where it always opened - Notification Methods - after.
 *
 *  - Which steps count: hasEssentialStepsLeft, read from the checklist the
 *    page draws (buildSetupChecklist).
 *  - The answer remembered per person and project, in this browser, so the
 *    nav bar's User Settings forwards at once.
 *  - User Settings' own address (Pages/UserSettings/Landing): forwards by
 *    what is remembered, or reads the checklist first and hands it to the
 *    checklist page; a read that fails opens Notification Methods.
 *  - Every page keeps its own address: a link to any of them opens it.
 */

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT_ID: string = "33333333-3333-4333-8333-333333333333";
const USER_ID: string = "22222222-2222-4222-8222-222222222222";

const loadSetupChecklistMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/UserSettings/SetupChecklist/useSetupChecklist",
  () => {
    return {
      __esModule: true,
      loadSetupChecklist: (...args: Array<unknown>) => {
        return loadSetupChecklistMock(...args);
      },
      default: () => {
        return null;
      },
    };
  },
);

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return new ObjectID("11111111-1111-4111-8111-111111111111");
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      getUserId: () => {
        return new ObjectID("22222222-2222-4222-8222-222222222222");
      },
      isMasterAdmin: () => {
        return false;
      },
    },
  };
});

// A checklist as the page draws it.

const cell: (
  ruleType: NotificationRuleType,
  hasRule: boolean,
) => ReadinessCoverageCellWire = (
  ruleType: NotificationRuleType,
  hasRule: boolean,
): ReadinessCoverageCellWire => {
  return {
    ruleType: ruleType,
    severityId: "44444444-4444-4444-8444-444444444444",
    severityName: "Sev1",
    hasRule: hasRule,
    isOptOut: false,
  };
};

const method: (
  methodType: string,
  isVerified: boolean,
) => ReadinessMethodWire = (
  methodType: string,
  isVerified: boolean,
): ReadinessMethodWire => {
  return {
    methodId: `method-${methodType}`,
    methodType: methodType,
    maskedIdentifier: "•••",
    isVerified: isVerified,
  };
};

const readiness: (params?: {
  status?: ReadinessStatusValue;
  methods?: Array<ReadinessMethodWire>;
  gap?: boolean;
  reachedVia?: Array<"Team" | "Schedule">;
}) => UserReadinessWire = (params?: {
  status?: ReadinessStatusValue;
  methods?: Array<ReadinessMethodWire>;
  gap?: boolean;
  reachedVia?: Array<"Team" | "Schedule">;
}): UserReadinessWire => {
  return {
    userId: USER_ID,
    userName: "Ana",
    userEmail: "ana@example.com",
    status: params?.status ?? "Ready",
    methods: params?.methods ?? [method("Email", true)],
    coverage: [
      cell(NotificationRuleType.ON_CALL_EXECUTED_INCIDENT, !params?.gap),
      cell(NotificationRuleType.ON_CALL_EXECUTED_ALERT, true),
    ],
    reasons: [],
    reachedVia: params?.reachedVia ?? ["Team"],
    teams: [],
  };
};

const KNOWN_FINE: {
  onCallShiftAlerts: OnCallShiftAlertProbe;
  deliverableSettings: DeliverableSettingsProbe;
  incomingCall: IncomingCallProbe;
  workspace: WorkspaceProbe;
  customFields: CustomFieldProbe;
} = {
  onCallShiftAlerts: { isKnown: true, hasAnyChannelEnabled: true },
  deliverableSettings: { isKnown: true, undeliverableChannels: [] },
  incomingCall: {
    isKnown: true,
    hasPolicyInProject: false,
    hasVerifiedNumber: false,
  },
  workspace: {
    isKnown: true,
    isConnectedForProject: false,
    isConnectedForUser: false,
  },
  customFields: { isKnown: true, fieldCount: 0, filledFieldCount: 0 },
};

const checklistOf: (
  overrides?: Partial<SetupChecklistInput>,
) => SetupChecklist = (
  overrides?: Partial<SetupChecklistInput>,
): SetupChecklist => {
  return buildSetupChecklist({
    readiness: readiness(),
    isFallbackEnabled: true,
    isFallbackKnown: true,
    onCallShiftAlerts: KNOWN_FINE.onCallShiftAlerts,
    deliverableSettings: KNOWN_FINE.deliverableSettings,
    incomingCall: KNOWN_FINE.incomingCall,
    slack: KNOWN_FINE.workspace,
    microsoftTeams: KNOWN_FINE.workspace,
    customFields: KNOWN_FINE.customFields,
    ...overrides,
  });
};

const ALL_SET: SetupChecklist = checklistOf();
const STEPS_LEFT: SetupChecklist = checklistOf({
  readiness: readiness({ status: "PartiallyReady", gap: true }),
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
});

describe("whether the checklist has essential steps left", () => {
  test("all set: no", () => {
    expect(ALL_SET.headlineStatus).toBe(SetupHeadlineStatus.Ready);
    expect(hasEssentialStepsLeft(ALL_SET)).toBe(false);
  });

  test("all set, and on no on-call policy: no", () => {
    const notOnCall: SetupChecklist = checklistOf({
      readiness: readiness({ reachedVia: [] }),
    });

    expect(notOnCall.headlineStatus).toBe(SetupHeadlineStatus.NotOnCall);
    expect(hasEssentialStepsLeft(notOnCall)).toBe(false);
  });

  test("a severity with no rule: yes", () => {
    expect(hasEssentialStepsLeft(STEPS_LEFT)).toBe(true);
  });

  test("no way to reach them, or one not verified: yes", () => {
    expect(
      hasEssentialStepsLeft(
        checklistOf({
          readiness: readiness({ status: "NotReachable", methods: [] }),
        }),
      ),
    ).toBe(true);
    expect(
      hasEssentialStepsLeft(
        checklistOf({
          readiness: readiness({
            methods: [method("Email", true), method("SMS", false)],
          }),
        }),
      ),
    ).toBe(true);
  });

  test("a recommended step only - a switch with nothing behind it: yes", () => {
    expect(
      hasEssentialStepsLeft(
        checklistOf({
          deliverableSettings: {
            isKnown: true,
            undeliverableChannels: ["SMS"],
          },
        }),
      ),
    ).toBe(true);
  });

  test("a step only somebody else can do, which leaves nothing reaching them: yes", () => {
    const blocked: SetupChecklist = checklistOf({
      readiness: readiness({
        status: "NotReachable",
        methods: [method("SMS", true)],
      }),
      canTurnOnProjectChannels: false,
    });

    // Not in the bar: the bar alone would say done.
    expect(blocked.blockedCount).toBe(1);
    expect(blocked.headlineStatus).toBe(SetupHeadlineStatus.NotReachable);
    expect(hasEssentialStepsLeft(blocked)).toBe(true);
  });

  test("only a nice-to-have left - Slack not linked: no", () => {
    const slackLeft: SetupChecklist = checklistOf({
      slack: {
        isKnown: true,
        isConnectedForProject: true,
        isConnectedForUser: false,
      },
    });

    expect(slackLeft.completedCount).toBe(slackLeft.totalCount);
    expect(hasEssentialStepsLeft(slackLeft)).toBe(false);
  });
});

describe("the answer remembered in this browser", () => {
  test("is kept per person and project, and read back as it was kept", () => {
    expect(
      readRememberedLanding({ userId: USER_ID, projectId: PROJECT_ID }),
    ).toBeNull();

    rememberLanding({
      userId: USER_ID,
      projectId: PROJECT_ID,
      hasEssentialStepsLeft: true,
      now: 1000,
    });

    expect(
      readRememberedLanding({
        userId: USER_ID.toUpperCase(),
        projectId: PROJECT_ID,
      }),
    ).toEqual({ hasEssentialStepsLeft: true, checkedAt: 1000 });
    expect(
      readRememberedLanding({ userId: USER_ID, projectId: OTHER_PROJECT_ID }),
    ).toBeNull();
  });

  test("anything else stored there reads as nothing remembered", () => {
    const key: string = `${USER_SETTINGS_LANDING_KEY_PREFIX}${USER_ID}:${PROJECT_ID}`;

    for (const stored of [
      "not json",
      "null",
      "42",
      JSON.stringify({ hasEssentialStepsLeft: "yes", checkedAt: 1 }),
      JSON.stringify({ hasEssentialStepsLeft: true }),
      JSON.stringify({ hasEssentialStepsLeft: true, checkedAt: "1" }),
    ]) {
      window.localStorage.setItem(key, stored);
      expect(
        readRememberedLanding({ userId: USER_ID, projectId: PROJECT_ID }),
      ).toBeNull();
    }
  });

  test("a browser that keeps nothing remembers nothing, and never fails", () => {
    jest
      .spyOn(Object.getPrototypeOf(window.localStorage), "getItem")
      .mockImplementation(() => {
        throw new Error("SecurityError");
      });
    jest
      .spyOn(Object.getPrototypeOf(window.localStorage), "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });

    expect(() => {
      rememberLanding({
        userId: USER_ID,
        projectId: PROJECT_ID,
        hasEssentialStepsLeft: false,
        now: 1,
      });
    }).not.toThrow();
    expect(
      readRememberedLanding({ userId: USER_ID, projectId: PROJECT_ID }),
    ).toBeNull();
  });

  test("opens the checklist while steps are left, Notification Methods after", () => {
    expect(getUserSettingsLandingPage(true)).toBe(PageMap.USER_SETTINGS_SETUP);
    expect(getUserSettingsLandingPage(false)).toBe(
      PageMap.USER_SETTINGS_NOTIFICATION_METHODS,
    );
  });

  test("is read again behind the forward once it is ten minutes old", () => {
    const remembered: { hasEssentialStepsLeft: boolean; checkedAt: number } = {
      hasEssentialStepsLeft: false,
      checkedAt: 1000,
    };

    expect(USER_SETTINGS_LANDING_RECHECK_AFTER_IN_MS).toBe(10 * 60 * 1000);
    expect(
      isLandingDueForRecheck(
        remembered,
        1000 + USER_SETTINGS_LANDING_RECHECK_AFTER_IN_MS - 1,
      ),
    ).toBe(false);
    expect(
      isLandingDueForRecheck(
        remembered,
        1000 + USER_SETTINGS_LANDING_RECHECK_AFTER_IN_MS,
      ),
    ).toBe(true);
  });
});

describe("the checklist handed to the checklist page", () => {
  const handOver: (
    extra?: Record<string, unknown>,
  ) => Record<string, unknown> = (
    extra?: Record<string, unknown>,
  ): Record<string, unknown> => {
    return {
      userSettingsLanding: {
        setupChecklist: STEPS_LEFT,
        userId: USER_ID,
        projectId: PROJECT_ID,
        readAt: 5000,
        ...extra,
      },
    };
  };

  test("is drawn while it is fresh, for this person and project", () => {
    expect(
      readLandingHandOver({
        state: handOver(),
        userId: USER_ID,
        projectId: PROJECT_ID,
        now: 5000 + LANDING_HAND_OVER_FRESH_FOR_IN_MS,
      }),
    ).toBe(STEPS_LEFT);
  });

  test("is read afresh when it is old - the page opened again with Back - or another's, or not there", () => {
    expect(
      readLandingHandOver({
        state: handOver(),
        userId: USER_ID,
        projectId: PROJECT_ID,
        now: 5000 + LANDING_HAND_OVER_FRESH_FOR_IN_MS + 1,
      }),
    ).toBeNull();
    expect(
      readLandingHandOver({
        state: handOver({ projectId: OTHER_PROJECT_ID }),
        userId: USER_ID,
        projectId: PROJECT_ID,
        now: 5000,
      }),
    ).toBeNull();
    expect(
      readLandingHandOver({
        state: handOver({ userId: OTHER_PROJECT_ID }),
        userId: USER_ID,
        projectId: PROJECT_ID,
        now: 5000,
      }),
    ).toBeNull();
    for (const state of [
      undefined,
      null,
      "x",
      {},
      { userSettingsLanding: {} },
    ]) {
      expect(
        readLandingHandOver({
          state: state,
          userId: USER_ID,
          projectId: PROJECT_ID,
          now: 5000,
        }),
      ).toBeNull();
    }
  });
});

/*
 * User Settings' own address, in a router: where it forwards, and what it
 * hands over.
 */
describe("User Settings' own address", () => {
  const LANDING_PATH: string = `/dashboard/${PROJECT_ID}/user-settings/`;

  const Opened: (props: { name: string }) => ReactElement = (props: {
    name: string;
  }): ReactElement => {
    const location: Location = useLocation();
    const state: { userSettingsLanding?: { readAt?: number } } | null =
      location.state as { userSettingsLanding?: { readAt?: number } } | null;

    return (
      <div data-testid="opened" data-path={location.pathname}>
        {props.name}
        {state?.userSettingsLanding ? " with the checklist handed over" : ""}
      </div>
    );
  };

  const renderLanding: () => void = (): void => {
    render(
      <MemoryRouter initialEntries={[LANDING_PATH]}>
        <Routes>
          <RouterRoute
            path="/dashboard/:projectId/user-settings"
            element={
              <UserSettingsLanding
                pageRoute={RouteMap[PageMap.USER_SETTINGS] as Route}
                currentProject={null}
                hasPaymentMethod={false}
              />
            }
          />
          <RouterRoute
            path="/dashboard/:projectId/user-settings/setup"
            element={<Opened name="Setup Checklist" />}
          />
          <RouterRoute
            path="/dashboard/:projectId/user-settings/notification-methods"
            element={<Opened name="Notification Methods" />}
          />
        </Routes>
      </MemoryRouter>,
    );
  };

  test("is User Settings' page: what the nav bar, Search and the crumb open", () => {
    expect((RouteMap[PageMap.USER_SETTINGS] as Route).toString()).toBe(
      "/dashboard/:projectId/user-settings/",
    );
    // Notification Methods keeps its own address.
    expect(
      (
        RouteMap[PageMap.USER_SETTINGS_NOTIFICATION_METHODS] as Route
      ).toString(),
    ).toBe("/dashboard/:projectId/user-settings/notification-methods");
  });

  test("a new member, nothing remembered: it reads the checklist, then opens it with what it read", async () => {
    let finish: (checklist: SetupChecklist) => void = () => {};

    loadSetupChecklistMock.mockReturnValue(
      new Promise<SetupChecklist>(
        (resolve: (checklist: SetupChecklist) => void) => {
          finish = resolve;
        },
      ),
    );

    renderLanding();

    // The page's skeleton while it reads, never an empty page.
    expect(screen.getByTestId("page-skeleton")).toBeInTheDocument();
    expect(loadSetupChecklistMock).toHaveBeenCalledWith({
      userId: USER_ID,
      projectId: PROJECT_ID,
    });

    await act(async () => {
      finish(STEPS_LEFT);
    });

    expect(screen.getByTestId("opened")).toHaveTextContent(
      "Setup Checklist with the checklist handed over",
    );
    expect(screen.getByTestId("opened")).toHaveAttribute(
      "data-path",
      `/dashboard/${PROJECT_ID}/user-settings/setup`,
    );
  });

  test("somebody who finished it, nothing remembered: it reads the checklist, then opens Notification Methods as always", async () => {
    loadSetupChecklistMock.mockResolvedValue(ALL_SET);

    renderLanding();

    await waitFor(() => {
      expect(screen.getByTestId("opened")).toHaveTextContent(
        "Notification Methods",
      );
    });
    expect(screen.getByTestId("opened")).not.toHaveTextContent("handed over");
  });

  test("steps left, remembered: it opens the checklist at once, which reads it as it draws", () => {
    rememberLanding({
      userId: USER_ID,
      projectId: PROJECT_ID,
      hasEssentialStepsLeft: true,
      now: Date.now(),
    });

    renderLanding();

    expect(screen.getByTestId("opened")).toHaveTextContent("Setup Checklist");
    expect(loadSetupChecklistMock).not.toHaveBeenCalled();
  });

  test("finished, remembered a moment ago: Notification Methods at once, and nothing read", () => {
    rememberLanding({
      userId: USER_ID,
      projectId: PROJECT_ID,
      hasEssentialStepsLeft: false,
      now: Date.now(),
    });

    renderLanding();

    expect(screen.getByTestId("opened")).toHaveTextContent(
      "Notification Methods",
    );
    expect(loadSetupChecklistMock).not.toHaveBeenCalled();
  });

  test("finished, remembered long ago: Notification Methods at once, and the checklist read again behind, for next time", async () => {
    rememberLanding({
      userId: USER_ID,
      projectId: PROJECT_ID,
      hasEssentialStepsLeft: false,
      now: Date.now() - USER_SETTINGS_LANDING_RECHECK_AFTER_IN_MS,
    });
    loadSetupChecklistMock.mockResolvedValue(STEPS_LEFT);

    renderLanding();

    expect(screen.getByTestId("opened")).toHaveTextContent(
      "Notification Methods",
    );
    await act(async () => {});
    expect(loadSetupChecklistMock).toHaveBeenCalledTimes(1);
    // Never moved after it opened.
    expect(screen.getByTestId("opened")).toHaveTextContent(
      "Notification Methods",
    );
  });

  test("a read that fails opens Notification Methods, where User Settings always opened", async () => {
    loadSetupChecklistMock.mockRejectedValue(new Error("Request failed"));

    renderLanding();

    await waitFor(() => {
      expect(screen.getByTestId("opened")).toHaveTextContent(
        "Notification Methods",
      );
    });
  });
});

describe("the routes", () => {
  const read: (file: string) => string = (file: string): string => {
    return fs.readFileSync(
      path.join(__dirname, "../../../../App/FeatureSet/Dashboard/src", file),
      "utf8",
    );
  };

  test("User Settings' own address is the index of its routes; every page keeps its own", () => {
    const routes: string = read("Routes/UserSettingsRoutes.tsx");

    expect(routes).toMatch(
      /<PageRoute\s+index\s+element=\{\s*<UserSettingsLanding/,
    );

    for (const page of [
      "USER_SETTINGS_SETUP",
      "USER_SETTINGS_NOTIFICATION_METHODS",
      "USER_SETTINGS_ON_CALL_RULES",
      "USER_SETTINGS_NOTIFICATION_SETTINGS",
    ]) {
      expect(routes).toMatch(
        new RegExp(`UserSettingsRoutePath\\[\\s*PageMap\\.${page}\\s*\\]`),
      );
    }
  });

  test("the checklist page draws a checklist handed to it", () => {
    const setup: string = read("Pages/UserSettings/Setup.tsx");

    expect(setup).toContain("readLandingHandOver(");
    expect(setup).toContain("initialChecklist={handedOver}");
  });

  test("its page is drawn under the trail Project > User Settings while it picks", () => {
    goTo(`/dashboard/${PROJECT_ID}/user-settings/`);

    const links: Array<Link> | undefined = getUserSettingsBreadcrumbs(
      Navigation.getRoutePath(RouteUtil.getRoutes()),
    );

    expect(
      links?.map((link: Link): string => {
        return link.title;
      }),
    ).toEqual(["Project", "User Settings"]);
  });

  test("every page's User Settings crumb opens User Settings' own address", () => {
    goTo(`/dashboard/${PROJECT_ID}/user-settings/notification-settings`);

    const links: Array<Link> | undefined = getUserSettingsBreadcrumbs(
      Navigation.getRoutePath(RouteUtil.getRoutes()),
    );

    expect(links?.[1]?.title).toBe("User Settings");
    expect(links?.[1]?.to.toString()).toBe(
      `/dashboard/${PROJECT_ID}/user-settings`,
    );
  });
});

/*
 * A checklist handed over is drawn as it is, with no second read, until
 * Recheck - which reads it afresh, past the server's cache.
 */
describe("the checklist, handed over", () => {
  test("is shown at once, and only Recheck reads it again", async () => {
    const actual: typeof import("../../../../App/FeatureSet/Dashboard/src/Components/UserSettings/SetupChecklist/useSetupChecklist") =
      jest.requireActual(
        "../../../../App/FeatureSet/Dashboard/src/Components/UserSettings/SetupChecklist/useSetupChecklist",
      ) as never;

    const API: { default: { get: (...args: Array<unknown>) => unknown } } =
      jest.requireActual("../../../UI/Utils/API/API") as never;
    const getSpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(API.default, "get")
      .mockRejectedValue(new Error("Recheck read it") as never);

    const { result } = renderHook(() => {
      return actual.default({
        userId: new ObjectID(USER_ID),
        projectId: new ObjectID(PROJECT_ID),
        initialChecklist: STEPS_LEFT,
      });
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.checklist).toBe(STEPS_LEFT);
    await act(async () => {});
    expect(getSpy).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.reload();
    });

    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(
      (
        getSpy.mock.calls[0]![0] as { url: { toString: () => string } }
      ).url.toString(),
    ).toContain("refresh=true");
  });
});

/*
 * Every read of the checklist - the checklist page, Home's card for an
 * invited member, User Settings' own address - remembers what it said, and
 * hands the person's readiness to the bell (#7040).
 */
describe("every read of the checklist", () => {
  const stubReads: (answer: UserReadinessWire) => void = (
    answer: UserReadinessWire,
  ): void => {
    const API: { default: { get: (...args: Array<unknown>) => unknown } } =
      jest.requireActual("../../../UI/Utils/API/API") as never;
    const ModelAPI: {
      default: {
        getCommonHeaders: () => unknown;
        getItem: () => unknown;
        getList: () => unknown;
        count: () => unknown;
      };
    } = jest.requireActual("../../../UI/Utils/ModelAPI/ModelAPI") as never;

    jest.spyOn(API.default, "get").mockImplementation((async (data: {
      url: { toString(): string };
    }) => {
      if (data.url.toString().includes("/on-call-readiness/user/")) {
        return { data: answer };
      }

      // The calendar link: an API without it.
      return { data: {}, statusCode: 404 };
    }) as never);
    jest.spyOn(ModelAPI.default, "getCommonHeaders").mockReturnValue({});
    jest.spyOn(ModelAPI.default, "getItem").mockResolvedValue(null as never);
    jest
      .spyOn(ModelAPI.default, "getList")
      .mockResolvedValue({ data: [], count: 0 } as never);
    jest.spyOn(ModelAPI.default, "count").mockResolvedValue(0 as never);
  };

  const loadForReal: () => Promise<SetupChecklist> =
    async (): Promise<SetupChecklist> => {
      const actual: typeof import("../../../../App/FeatureSet/Dashboard/src/Components/UserSettings/SetupChecklist/useSetupChecklist") =
        jest.requireActual(
          "../../../../App/FeatureSet/Dashboard/src/Components/UserSettings/SetupChecklist/useSetupChecklist",
        ) as never;

      return await actual.loadSetupChecklist({
        userId: USER_ID,
        projectId: PROJECT_ID,
      });
    };

  test("with a step left, remembers so, and the bell hears the readiness it read", async () => {
    const MyReadiness: {
      default: {
        clear: () => void;
        get: (data: {
          projectId: string;
          userId: string;
        }) => { readiness: UserReadinessWire } | null;
      };
    } = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/Readiness/MyReadiness",
    ) as never;

    MyReadiness.default.clear();
    stubReads(readiness({ status: "PartiallyReady", gap: true }));

    const checklist: SetupChecklist = await loadForReal();

    expect(hasEssentialStepsLeft(checklist)).toBe(true);
    expect(
      readRememberedLanding({ userId: USER_ID, projectId: PROJECT_ID }),
    ).toMatchObject({ hasEssentialStepsLeft: true });
    expect(
      MyReadiness.default.get({ projectId: PROJECT_ID, userId: USER_ID })
        ?.readiness.status,
    ).toBe("PartiallyReady");
  });

  test("with nothing left, remembers that User Settings opens where it always did", async () => {
    stubReads(readiness());

    await loadForReal();

    expect(
      readRememberedLanding({ userId: USER_ID, projectId: PROJECT_ID }),
    ).toMatchObject({ hasEssentialStepsLeft: false });
  });

  test("a readiness read that fails remembers nothing", async () => {
    const API: { default: { get: (...args: Array<unknown>) => unknown } } =
      jest.requireActual("../../../UI/Utils/API/API") as never;

    jest
      .spyOn(API.default, "get")
      .mockRejectedValue(new Error("Request failed") as never);

    await expect(loadForReal()).rejects.toThrow("Request failed");
    expect(
      readRememberedLanding({ userId: USER_ID, projectId: PROJECT_ID }),
    ).toBeNull();
  });
});
