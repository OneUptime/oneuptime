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
import React, { ReactElement, useEffect } from "react";
import {
  Location,
  MemoryRouter,
  Outlet,
  Route as RouterRoute,
  Routes as RouterRoutes,
} from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE SECTION'S SHAPE.
 *
 * Users > View > Notification Rules was one route that rendered, in one scroll:
 * a readiness summary with four stat tiles and a prose consequence, a masked
 * list of the person's notification methods, a coverage grid, and four rule
 * types that each expand to one card per severity band. On a project with six
 * incident and six alert severities that is around fifty cards under a
 * diagnosis nobody could still see by the time they reached the controls.
 *
 * It was split into six pages, four of them one per kind of rule. Those four
 * are one On-Call Rules page now, with a tab per kind - the same page, drawn by
 * the same component, as the member's own User Settings. So the section is
 * three pages: Readiness, Notification Methods, On-Call Rules.
 *
 * The failures worth writing down are the ones that make the change silently
 * WORSE than what it replaced:
 *
 *   - A DEAD BOOKMARK. The old URLs - the combined one and the four per kind -
 *     are in tickets, chat scrollback and at least one runbook. They have to
 *     keep landing somewhere useful: the combined one on the overview, each
 *     per-kind one on its own tab (OnCallRulesRedirects.test.tsx follows those
 *     through the real routes).
 *
 *   - A PAGE THAT STILL RENDERS EVERYTHING. One page for four kinds is only
 *     better than four pages if it draws one kind at a time. The assertion
 *     counts the tables that are MOUNTED, tab by tab.
 *
 *   - THE WRONG SEVERITY AXIS ON ONE TAB. A rule is tied to its band by
 *     `incidentSeverityId` or `alertSeverityId`, and the severity MODEL does
 *     not follow from the rule type the way the names suggest: an alert episode
 *     is banded by AlertSeverity, an incident episode by IncidentSeverity.
 *     Nothing throws when a tab gets the other's props — the table just lists
 *     every severity's rules at once. The two severity models here return
 *     DISJOINT id sets, which is the only fixture shape in which that is
 *     visible.
 *
 *   - A SECTION THAT REFETCHES PER PAGE. The pages share one layout that loads
 *     the target user and their readiness once. If a page reached for its own
 *     copy, moving between them would issue a fresh pair of reads each time
 *     and — much worse — two pages could disagree about WHO they are editing,
 *     which is the failure this whole surface is written to avoid.
 *
 *   - AN UNREACHABLE PAGE. Three routes are worth nothing if the menu names
 *     two, so the side menu is asserted against the route table rather than
 *     against a list of strings copied out of the component.
 */

const PROJECT_ID_STRING: string = "10000000-0000-4000-8000-000000000001";
const SIGNED_IN_USER_ID_STRING: string = "20000000-0000-4000-8000-000000000002";
const TARGET_USER_ID_STRING: string = "30000000-0000-4000-8000-000000000003";

const INCIDENT_SEVERITY_ONE_ID: string = "41111111-1111-4111-8111-111111111111";
const INCIDENT_SEVERITY_TWO_ID: string = "42222222-2222-4222-8222-222222222222";
const ALERT_SEVERITY_ONE_ID: string = "51111111-1111-4111-8111-111111111111";
const ALERT_SEVERITY_TWO_ID: string = "52222222-2222-4222-8222-222222222222";

const TARGET_USER_NAME: string = "Jane Ops";
const TARGET_LOGIN_EMAIL: string = "jane.ops@example.com";

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const getCommonHeadersMock: MockFunction = getJestMockFunction();
const apiGetMock: MockFunction = getJestMockFunction();
const navigateMock: MockFunction = getJestMockFunction();

let pendingRequestCount: number = 0;

type TrackRequestFunction = (result: unknown) => unknown;

const trackRequest: TrackRequestFunction = (result: unknown): unknown => {
  if (!(result instanceof Promise)) {
    return result;
  }

  pendingRequestCount++;

  return result.finally((): void => {
    pendingRequestCount--;
  });
};

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return trackRequest(getListMock(...args));
      },
      getItem: (...args: Array<any>) => {
        return trackRequest(getItemMock(...args));
      },
      getCommonHeaders: (...args: Array<any>) => {
        return getCommonHeadersMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: (...args: Array<any>) => {
        return trackRequest(apiGetMock(...args));
      },
      getFriendlyMessage: (error: unknown) => {
        return (
          ((error as { message?: unknown } | null)?.message as string) ||
          "Could not load"
        );
      },
      getFriendlyErrorMessage: (error: unknown) => {
        return (
          ((error as { message?: unknown } | null)?.message as string) ||
          "Could not load"
        );
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

/*
 * The rule tables are stubbed down to the two facts this file is about: which
 * rule type a table filters on, and which severity band it was mounted for.
 * Rendering the real ModelTable would drag in the pager and the facet bar, none
 * of which says anything about how the page draws its kinds.
 *
 * The stub keeps the tables that are MOUNTED right now, keyed by identity, and
 * forgets one when it unmounts - so "only the open tab is drawn" is asserted
 * against what is on screen, not against everything ever rendered.
 */
interface CapturedTableProps {
  query: Record<string, ObjectID | NotificationRuleType | undefined>;
  userPreferencesKey: string;
}

let mountedTables: Map<string, CapturedTableProps> = new Map();

type TableIdentityFunction = (props: CapturedTableProps) => string;

const tableIdentity: TableIdentityFunction = (
  props: CapturedTableProps,
): string => {
  const severityId: ObjectID | NotificationRuleType | undefined =
    props.query["incidentSeverityId"] ?? props.query["alertSeverityId"];

  return `${String(props.query["ruleType"])}::${
    severityId ? severityId.toString() : "no-severity"
  }`;
};

type GetMountedTablesFunction = () => Array<CapturedTableProps>;

/*
 * Through a stable function, because the map is REPLACED between tests and a
 * closure built in a loop below would otherwise read whichever one was bound
 * when the loop ran.
 */
const getMountedTables: GetMountedTablesFunction =
  (): Array<CapturedTableProps> => {
    return Array.from(mountedTables.values());
  };

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps) => {
      const identity: string = tableIdentity(props);

      mountedTables.set(identity, props);

      useEffect(() => {
        mountedTables.set(identity, props);

        return (): void => {
          mountedTables.delete(identity);
        };
      }, [identity]);

      return null;
    },
  };
});

import UserViewNotificationRulesRedirect from "../../../../App/FeatureSet/Dashboard/src/Pages/Users/View/NotificationRules";
import UserViewSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Users/View/SideMenu";
import UserViewOnCallLayout from "../../../../App/FeatureSet/Dashboard/src/Pages/Users/View/OnCall/Layout";
import UserViewNotificationMethods from "../../../../App/FeatureSet/Dashboard/src/Pages/Users/View/OnCall/NotificationMethods";
import UserViewOnCallReadiness from "../../../../App/FeatureSet/Dashboard/src/Pages/Users/View/OnCall/Readiness";
import UserViewOnCallRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Users/View/OnCall/Rules";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import { getUsersBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/UsersBreadcrumbs";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Project from "../../../Models/DatabaseModels/Project";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import Link from "../../../Types/Link";
import Name from "../../../Types/Name";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import OnCallRuleKind from "../../../Types/NotificationRule/OnCallRuleKind";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionUtil from "../../../UI/Utils/Permission";
import ProjectUtil from "../../../UI/Utils/Project";
import UserUtil from "../../../UI/Utils/User";
import { activeLinkTitles } from "./SideMenuHarness";

const PROJECT_ID: ObjectID = new ObjectID(PROJECT_ID_STRING);
const SIGNED_IN_USER_ID: ObjectID = new ObjectID(SIGNED_IN_USER_ID_STRING);
const TARGET_USER_ID: ObjectID = new ObjectID(TARGET_USER_ID_STRING);

const pageProps: PageComponentProps = {
  pageRoute: new Route("/users"),
  currentProject: null,
  hasPaymentMethod: false,
};

interface SeveritySpec {
  id: string;
  name: string;
}

const INCIDENT_SEVERITY_SPECS: Array<SeveritySpec> = [
  { id: INCIDENT_SEVERITY_ONE_ID, name: "Sev One" },
  { id: INCIDENT_SEVERITY_TWO_ID, name: "Sev Two" },
];

const ALERT_SEVERITY_SPECS: Array<SeveritySpec> = [
  { id: ALERT_SEVERITY_ONE_ID, name: "Alert One" },
  { id: ALERT_SEVERITY_TWO_ID, name: "Alert Two" },
];

type BuildSeverities = (
  modelType: { new (): IncidentSeverity | AlertSeverity },
  specs: Array<SeveritySpec>,
) => Array<IncidentSeverity | AlertSeverity>;

const buildSeverities: BuildSeverities = (
  modelType: { new (): IncidentSeverity | AlertSeverity },
  specs: Array<SeveritySpec>,
): Array<IncidentSeverity | AlertSeverity> => {
  return specs.map((spec: SeveritySpec) => {
    const severity: IncidentSeverity | AlertSeverity = new modelType();
    severity._id = spec.id;
    severity.name = spec.name;
    return severity;
  });
};

type BuildTeamMemberFunction = () => TeamMember;

const buildTeamMember: BuildTeamMemberFunction = (): TeamMember => {
  const user: User = new User();
  user._id = TARGET_USER_ID_STRING;
  user.name = new Name(TARGET_USER_NAME);
  user.email = new Email(TARGET_LOGIN_EMAIL);

  const member: TeamMember = new TeamMember();
  member.user = user;

  return member;
};

const READINESS_PAYLOAD: JSONObject = {
  userId: TARGET_USER_ID_STRING,
  userName: TARGET_USER_NAME,
  userEmail: TARGET_LOGIN_EMAIL,
  status: "PartiallyReady",
  methods: [],
  coverage: [],
  reasons: [],
  reachedVia: ["Team"],
};

/*
 * The three pages of the section, as the ROUTE TABLE spells them, paired with
 * the component each route mounts. Everything below reads this rather than a
 * hand-written list of paths, so a page whose route is renamed is a compile
 * error or a failing render rather than a test that quietly stops covering it.
 */
interface SectionPage {
  pageMapKey: PageMap;
  menuTitle: string;
  breadcrumbTitle: string;
  element: ReactElement;
}

const SECTION_PAGES: Array<SectionPage> = [
  {
    pageMapKey: PageMap.USER_VIEW_ON_CALL_READINESS,
    menuTitle: "Readiness",
    breadcrumbTitle: "On-Call Readiness",
    element: <UserViewOnCallReadiness {...pageProps} />,
  },
  {
    pageMapKey: PageMap.USER_VIEW_NOTIFICATION_METHODS,
    menuTitle: "Notification Methods",
    breadcrumbTitle: "Notification Methods",
    element: <UserViewNotificationMethods {...pageProps} />,
  },
  {
    pageMapKey: PageMap.USER_VIEW_ON_CALL_RULES,
    menuTitle: "On-Call Rules",
    breadcrumbTitle: "On-Call Rules",
    element: <UserViewOnCallRules {...pageProps} />,
  },
];

const RULES_PAGE: SectionPage = SECTION_PAGES[2]!;

/*
 * The four tabs of the On-Call Rules page: the kind in its address, the tab's
 * name, the rule type of its tables, and the severity band ids they must be
 * drawn for - with the OTHER model's ids, which must never appear on it.
 */
interface TabCase {
  kind: OnCallRuleKind;
  tabName: string;
  ruleType: NotificationRuleType;
  severityIds: Array<string>;
  foreignSeverityIds: Array<string>;
}

const INCIDENT_IDS: Array<string> = [
  INCIDENT_SEVERITY_ONE_ID,
  INCIDENT_SEVERITY_TWO_ID,
];
const ALERT_IDS: Array<string> = [ALERT_SEVERITY_ONE_ID, ALERT_SEVERITY_TWO_ID];

const TAB_CASES: Array<TabCase> = [
  {
    kind: OnCallRuleKind.Incidents,
    tabName: "Incidents",
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    severityIds: INCIDENT_IDS,
    foreignSeverityIds: ALERT_IDS,
  },
  /*
   * The crossed pair: an incident EPISODE is banded by IncidentSeverity while
   * an alert episode is banded by AlertSeverity. Deriving one axis from the
   * other — "is this an episode?" — gets exactly this row wrong.
   */
  {
    kind: OnCallRuleKind.IncidentEpisodes,
    tabName: "Incident Episodes",
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
    severityIds: INCIDENT_IDS,
    foreignSeverityIds: ALERT_IDS,
  },
  {
    kind: OnCallRuleKind.Alerts,
    tabName: "Alerts",
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
    severityIds: ALERT_IDS,
    foreignSeverityIds: INCIDENT_IDS,
  },
  {
    kind: OnCallRuleKind.AlertEpisodes,
    tabName: "Alert Episodes",
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
    severityIds: ALERT_IDS,
    foreignSeverityIds: INCIDENT_IDS,
  },
];

// The four pages the tabs replaced, as their URLs ended.
const RETIRED_RULE_PAGE_PATHS: Array<string> = [
  "incident-on-call-rules",
  "incident-episode-on-call-rules",
  "alert-on-call-rules",
  "alert-episode-on-call-rules",
];

type LastPathForFunction = (pageMapKey: PageMap) => string;

/*
 * The last URL segment of a page, taken from the app's own route table exactly
 * the way UsersRoutes.tsx takes it. A test that hard-coded "on-call-readiness"
 * would keep passing after somebody renamed the route and broke every link to
 * it.
 */
const lastPathFor: LastPathForFunction = (pageMapKey: PageMap): string => {
  return RouteUtil.getLastPathForKey(pageMapKey);
};

type RenderPageFunction = (page: SectionPage, search?: string) => HTMLElement;

/*
 * The real nesting: the `:id` parent, the pathless section layout, then the
 * page. The layout reads the target user from `useParams`, so this is also what
 * pins "the section knows whose configuration it is showing" to the URL rather
 * than to a stub.
 */
const renderPage: RenderPageFunction = (
  page: SectionPage,
  search: string = "",
): HTMLElement => {
  const path: string = lastPathFor(page.pageMapKey);

  const address: string = `/dashboard/${PROJECT_ID_STRING}/users/${TARGET_USER_ID_STRING}/${path}${search}`;

  // The rules page reads its open tab from the browser's address.
  window.history.replaceState({}, "", address);

  const { container } = render(
    <MemoryRouter initialEntries={[address]}>
      <RouterRoutes>
        <RouterRoute
          path="/dashboard/:projectId/users/:id"
          element={<Outlet />}
        >
          <RouterRoute element={<UserViewOnCallLayout />}>
            <RouterRoute path={path} element={page.element} />
          </RouterRoute>
        </RouterRoute>
      </RouterRoutes>
    </MemoryRouter>,
  );

  return container;
};

type SettleFunction = () => Promise<void>;

/*
 * The two places that read the router's location without being inside one.
 *
 * SideMenu asks Navigation.isOnThisPage to decide which entry is active, and
 * the breadcrumb builder splits the current pathname to work out the levels
 * above. In the app the router pushes that location into Navigation on every
 * navigation; nothing does so in a test, and the getters throw on undefined
 * rather than returning a default — deliberately, since a menu that silently
 * decided nothing was active would be a much quieter bug.
 */
type GoToFunction = (path: string) => void;

const goTo: GoToFunction = (path: string): void => {
  window.history.pushState({}, "", path);
  Navigation.setLocation({
    pathname: path,
    search: "",
    hash: "",
    state: null,
    key: "test",
  } as Location);
};

const settle: SettleFunction = async (): Promise<void> => {
  await waitFor(
    (): void => {
      expect(pendingRequestCount).toBe(0);
    },
    { timeout: 4000 },
  );
};

type WaitForTablesOfFunction = (tabCase: TabCase) => Promise<void>;

// Until the open tab's tables, and only they, are on screen.
const waitForTablesOf: WaitForTablesOfFunction = async (
  tabCase: TabCase,
): Promise<void> => {
  await waitFor(
    (): void => {
      expect(pendingRequestCount).toBe(0);
      expect(getMountedTables()).toHaveLength(tabCase.severityIds.length);

      for (const table of getMountedTables()) {
        expect(table.query["ruleType"]).toBe(tabCase.ruleType);
      }
    },
    { timeout: 4000 },
  );
};

type BandedIdsFunction = () => Array<string>;

const bandedIds: BandedIdsFunction = (): Array<string> => {
  return getMountedTables().map((table: CapturedTableProps): string => {
    const severityId: ObjectID | NotificationRuleType | undefined =
      table.query["incidentSeverityId"] ?? table.query["alertSeverityId"];

    return severityId ? severityId.toString() : "";
  });
};

beforeEach((): void => {
  mountedTables = new Map();
  pendingRequestCount = 0;

  getListMock.mockReset();
  getItemMock.mockReset();
  getCommonHeadersMock.mockReset();
  apiGetMock.mockReset();
  navigateMock.mockReset();

  getListMock.mockImplementation((data: any) => {
    if (data.modelType === IncidentSeverity) {
      return Promise.resolve({
        data: buildSeverities(IncidentSeverity, INCIDENT_SEVERITY_SPECS),
        count: INCIDENT_SEVERITY_SPECS.length,
        skip: 0,
        limit: INCIDENT_SEVERITY_SPECS.length,
      });
    }

    if (data.modelType === AlertSeverity) {
      return Promise.resolve({
        data: buildSeverities(AlertSeverity, ALERT_SEVERITY_SPECS),
        count: ALERT_SEVERITY_SPECS.length,
        skip: 0,
        limit: ALERT_SEVERITY_SPECS.length,
      });
    }

    if (data.modelType === TeamMember) {
      const member: TeamMember = buildTeamMember();
      return Promise.resolve({ data: [member], count: 1, skip: 0, limit: 1 });
    }

    return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
  });

  const project: Project = new Project();
  project.disableOnCallNotificationFallback = false;
  getItemMock.mockResolvedValue(project as never);

  getCommonHeadersMock.mockReturnValue({} as never);
  apiGetMock.mockResolvedValue(
    new HTTPResponse<JSONObject>(200, READINESS_PAYLOAD, {}) as never,
  );

  goTo(
    `/dashboard/${PROJECT_ID_STRING}/users/${TARGET_USER_ID_STRING}/on-call-readiness`,
  );

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(UserUtil, "getUserId").mockReturnValue(SIGNED_IN_USER_ID);
  jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(false);
  jest
    .spyOn(PermissionUtil, "getAllPermissions")
    .mockReturnValue([Permission.ProjectAdmin]);
  jest.spyOn(Navigation, "navigate").mockImplementation(((
    ...args: Array<unknown>
  ): void => {
    navigateMock(...args);
  }) as never);
});

afterEach(async (): Promise<void> => {
  cleanup();

  for (
    let attempt: number = 0;
    pendingRequestCount > 0 && attempt < 100;
    attempt++
  ) {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
  }

  jest.restoreAllMocks();
});

describe("the old combined route", () => {
  test("still resolves, and lands on the readiness overview", async () => {
    window.history.pushState(
      {},
      "",
      `/dashboard/${PROJECT_ID_STRING}/users/${TARGET_USER_ID_STRING}/notification-rules`,
    );

    render(<UserViewNotificationRulesRedirect {...pageProps} />);

    await waitFor((): void => {
      expect(navigateMock).toHaveBeenCalled();
    });

    const destination: Route = navigateMock.mock.calls[0]![0] as Route;

    /*
     * Asserted against the route table rather than against a literal, and with
     * the TARGET user's id in it: the id is the second-to-last segment of the
     * old URL, and reading the wrong offset produces a redirect to a page about
     * the literal string "notification-rules".
     */
    expect(destination.toString()).toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.USER_VIEW_ON_CALL_READINESS] as Route,
        { modelId: TARGET_USER_ID },
      ).toString(),
    );

    expect(destination.toString()).toContain(TARGET_USER_ID_STRING);
  });

  test("reads nothing about the user on its way past", async () => {
    window.history.pushState(
      {},
      "",
      `/dashboard/${PROJECT_ID_STRING}/users/${TARGET_USER_ID_STRING}/notification-rules`,
    );

    render(<UserViewNotificationRulesRedirect {...pageProps} />);

    await waitFor((): void => {
      expect(navigateMock).toHaveBeenCalled();
    });

    /*
     * A redirect that also fetches is a redirect that has already paid for the
     * page it is not going to draw — and on this surface the thing being
     * fetched is somebody else's paging configuration.
     */
    expect(apiGetMock).not.toHaveBeenCalled();
    expect(getListMock).not.toHaveBeenCalled();
  });
});

describe("the On-Call Rules page draws one kind at a time", () => {
  for (const tabCase of TAB_CASES) {
    test(`?type=${tabCase.kind} opens the ${tabCase.tabName} tab, and only its tables are drawn`, async () => {
      renderPage(RULES_PAGE, `?type=${tabCase.kind}`);

      await waitForTablesOf(tabCase);

      expect(screen.getByTestId(`tab-${tabCase.tabName}`)).toHaveAttribute(
        "aria-selected",
        "true",
      );

      /*
       * The point of the tabs, counted. The single page the section started
       * as mounted eight tables here - four rule types times two severity
       * bands - and every one of them was on screen at once.
       */
      expect(getMountedTables()).toHaveLength(tabCase.severityIds.length);
    });

    test(`the ${tabCase.tabName} tab bands its tables by the right severity model`, async () => {
      renderPage(RULES_PAGE, `?type=${tabCase.kind}`);

      await waitForTablesOf(tabCase);

      expect(bandedIds().sort()).toEqual([...tabCase.severityIds].sort());

      /*
       * The disjoint fixture doing its job: a tab handed the other model's
       * props would list these ids instead, and nothing else in the render
       * would look wrong.
       */
      for (const foreignId of tabCase.foreignSeverityIds) {
        expect(bandedIds()).not.toContain(foreignId);
      }
    });
  }

  test("a bare address opens Incidents", async () => {
    renderPage(RULES_PAGE);

    await waitForTablesOf(TAB_CASES[0]!);

    expect(screen.getByTestId("tab-Incidents")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("an address naming no tab we have opens Incidents rather than nothing", async () => {
    renderPage(RULES_PAGE, "?type=everything");

    await waitForTablesOf(TAB_CASES[0]!);
  });

  test("opening another tab draws its kind and drops the one before", async () => {
    renderPage(RULES_PAGE);

    await waitForTablesOf(TAB_CASES[0]!);

    for (const tabCase of TAB_CASES.slice(1)) {
      fireEvent.click(screen.getByTestId(`tab-${tabCase.tabName}`));

      await waitForTablesOf(tabCase);

      expect(bandedIds().sort()).toEqual([...tabCase.severityIds].sort());
    }
  });

  test("the address follows the open tab, and the first tab is the bare address", async () => {
    renderPage(RULES_PAGE);

    await waitForTablesOf(TAB_CASES[0]!);

    fireEvent.click(screen.getByTestId("tab-Alert Episodes"));

    await waitForTablesOf(TAB_CASES[3]!);

    /*
     * In place, with no history entry: a reload or a copied link opens the
     * same tab, and Back still leaves the page rather than walking its tabs.
     */
    expect(new URLSearchParams(window.location.search).get("type")).toBe(
      "alert-episodes",
    );

    fireEvent.click(screen.getByTestId("tab-Incidents"));

    await waitForTablesOf(TAB_CASES[0]!);

    expect(new URLSearchParams(window.location.search).get("type")).toBeNull();
  });

  test("the four tabs are the four kinds, in order", async () => {
    renderPage(RULES_PAGE);

    await waitForTablesOf(TAB_CASES[0]!);

    expect(
      screen.getAllByRole("tab").map((tab: HTMLElement): string => {
        return tab.textContent?.trim() || "";
      }),
    ).toEqual(
      TAB_CASES.map((tabCase: TabCase): string => {
        return tabCase.tabName;
      }),
    );
  });

  test("the readiness page mounts no rule table at all", async () => {
    renderPage(SECTION_PAGES[0]!);

    await settle();

    /*
     * The overview diagnoses and does not repair. A readiness page that also
     * drew the rule tables would be the page this section was split to break
     * up, wearing a new name.
     */
    expect(getMountedTables()).toHaveLength(0);
  });
});

describe("the section shares one load of the person it is about", () => {
  test("the rules page reads identity and readiness exactly once, however many tabs are opened", async () => {
    renderPage(RULES_PAGE);

    await waitForTablesOf(TAB_CASES[0]!);

    for (const tabCase of TAB_CASES.slice(1)) {
      fireEvent.click(screen.getByTestId(`tab-${tabCase.tabName}`));

      await waitForTablesOf(tabCase);
    }

    const teamMemberReads: number = getListMock.mock.calls.filter(
      (call: Array<any>): boolean => {
        return call[0].modelType === TeamMember;
      },
    ).length;

    expect(teamMemberReads).toBe(1);
    expect(apiGetMock).toHaveBeenCalledTimes(1);
  });

  test("every page asks about the user in the URL, never the signed-in admin", async () => {
    for (const page of SECTION_PAGES) {
      mountedTables = new Map();
      getListMock.mockClear();
      apiGetMock.mockClear();

      renderPage(page);

      await settle();

      const memberRead: any = getListMock.mock.calls.find(
        (call: Array<any>): boolean => {
          return call[0].modelType === TeamMember;
        },
      );

      expect(memberRead[0].query.userId.toString()).toBe(TARGET_USER_ID_STRING);
      expect(memberRead[0].query.userId.toString()).not.toBe(
        SIGNED_IN_USER_ID_STRING,
      );

      /*
       * And the readiness read too. The two travelling together is what stops
       * one page in the section naming one person while another names somebody
       * else — the state this surface must never be in.
       */
      const readinessUrl: string = String(apiGetMock.mock.calls[0]![0].url);

      expect(readinessUrl).toContain(TARGET_USER_ID_STRING);

      cleanup();
    }
  });

  test("the rule tables are about the user in the URL, on every tab", async () => {
    renderPage(RULES_PAGE);

    await waitForTablesOf(TAB_CASES[0]!);

    for (const tabCase of TAB_CASES) {
      if (tabCase !== TAB_CASES[0]) {
        fireEvent.click(screen.getByTestId(`tab-${tabCase.tabName}`));

        await waitForTablesOf(tabCase);
      }

      for (const table of getMountedTables()) {
        expect(table.query["userId"]?.toString()).toBe(TARGET_USER_ID_STRING);
      }
    }
  });

  test("the on-behalf-of banner is on every page in the section", async () => {
    for (const page of SECTION_PAGES) {
      const container: HTMLElement = renderPage(page);

      await settle();

      /*
       * Rendered by the LAYOUT, so it cannot be forgotten on a page added
       * later. The whole risk of this section is somebody rewriting the wrong
       * person's paging while believing it is their own, and a page reached
       * directly by URL is exactly the one that would arrive without context.
       */
      expect(container.textContent).toContain(
        `You are editing on behalf of ${TARGET_USER_NAME}`,
      );

      cleanup();
    }
  });

  test("a reader with no permission is refused on every page, and nothing is fetched", async () => {
    jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue([]);

    for (const page of SECTION_PAGES) {
      getListMock.mockClear();
      apiGetMock.mockClear();

      renderPage(page);

      expect(
        await screen.findByText(/do not have permission to view this user/),
      ).toBeInTheDocument();

      /*
       * Not merely "nothing drawn": nothing requested either. A refused page
       * that still fetches a colleague's readiness has already disclosed the
       * thing it declined to render — and because the refusal lives in the
       * LAYOUT, one check covers all three rather than two plus whichever one
       * somebody forgets.
       */
      expect(apiGetMock).not.toHaveBeenCalled();
      expect(getListMock).not.toHaveBeenCalled();

      cleanup();
    }
  });
});

describe("every page is reachable", () => {
  type MenuLinkFunction = () => Array<{ title: string; href: string }>;

  const renderMenu: MenuLinkFunction = (): Array<{
    title: string;
    href: string;
  }> => {
    render(
      <MemoryRouter>
        <UserViewSideMenu modelId={TARGET_USER_ID} hasCustomFields={false} />
      </MemoryRouter>,
    );

    return Array.from(document.querySelectorAll("a")).map(
      (anchor: HTMLAnchorElement): { title: string; href: string } => {
        return {
          title: anchor.textContent?.trim() || "",
          href: anchor.getAttribute("href") || "",
        };
      },
    );
  };

  test("the side menu names all three pages, pointing at the route table's own paths", () => {
    const links: Array<{ title: string; href: string }> = renderMenu();

    for (const page of SECTION_PAGES) {
      const expectedHref: string = RouteUtil.populateRouteParams(
        RouteMap[page.pageMapKey] as Route,
        { modelId: TARGET_USER_ID },
      ).toString();

      const link: { title: string; href: string } | undefined = links.find(
        (candidate: { title: string; href: string }): boolean => {
          return candidate.title === page.menuTitle;
        },
      );

      expect(link).toBeDefined();
      expect(link!.href).toBe(expectedHref);
    }
  });

  test("the On-Call section is those three entries, in order, and no rule page of its own per kind", () => {
    render(
      <MemoryRouter>
        <UserViewSideMenu modelId={TARGET_USER_ID} hasCustomFields={false} />
      </MemoryRouter>,
    );

    const onCallHeading: HTMLElement | undefined = Array.from(
      document.querySelectorAll("h6"),
    ).find((heading: HTMLElement): boolean => {
      return heading.textContent?.trim() === "On-Call";
    });

    expect(onCallHeading).toBeDefined();

    const allTitles: Array<string> = Array.from(
      document.querySelectorAll("a"),
    ).map((anchor: HTMLAnchorElement): string => {
      return anchor.textContent?.trim() || "";
    });

    const readinessIndex: number = allTitles.indexOf("Readiness");

    expect(allTitles.slice(readinessIndex, readinessIndex + 3)).toEqual([
      "Readiness",
      "Notification Methods",
      "On-Call Rules",
    ]);

    for (const retiredTitle of [
      "Incident On-Call Rules",
      "Incident Episode On-Call Rules",
      "Alert On-Call Rules",
      "Alert Episode On-Call Rules",
    ]) {
      expect(allTitles).not.toContain(retiredTitle);
    }

    for (const href of Array.from(document.querySelectorAll("a")).map(
      (anchor: HTMLAnchorElement): string => {
        return anchor.getAttribute("href") || "";
      },
    )) {
      for (const retiredPath of RETIRED_RULE_PAGE_PATHS) {
        expect(href.endsWith(`/${retiredPath}`)).toBe(false);
      }
    }
  });

  test("the menu hides the section from somebody who may not read it", () => {
    jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue([]);

    const links: Array<{ title: string; href: string }> = renderMenu();

    for (const page of SECTION_PAGES) {
      expect(
        links.some((candidate: { title: string; href: string }): boolean => {
          return candidate.title === page.menuTitle;
        }),
      ).toBe(false);
    }

    /*
     * Hiding is a convenience and never the boundary — the pages repeat the
     * check and the API refuses the reads — but a menu full of entries that all
     * refuse is its own kind of broken.
     */
    expect(
      links.some((candidate: { title: string; href: string }): boolean => {
        return candidate.title === "Profile";
      }),
    ).toBe(true);
  });

  test("a member walking into their own row keeps the section", () => {
    jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue([]);
    jest.spyOn(UserUtil, "getUserId").mockReturnValue(TARGET_USER_ID);

    const links: Array<{ title: string; href: string }> = renderMenu();

    /*
     * Your own configuration needs no grant at all — Permission.CurrentUser
     * already carries it — so an ordinary member reaching their own row sees
     * the same three pages.
     */
    for (const page of SECTION_PAGES) {
      expect(
        links.some((candidate: { title: string; href: string }): boolean => {
          return candidate.title === page.menuTitle;
        }),
      ).toBe(true);
    }
  });

  test("the On-Call Rules entry stays marked whichever tab is open", async () => {
    const rulesHref: string = RouteUtil.populateRouteParams(
      RouteMap[PageMap.USER_VIEW_ON_CALL_RULES] as Route,
      { modelId: TARGET_USER_ID },
    ).toString();

    for (const search of ["", "?type=alerts", "?type=incident-episodes"]) {
      window.history.pushState({}, "", `${rulesHref}${search}`);
      Navigation.setLocation({
        pathname: rulesHref,
        search: search,
        hash: "",
        state: null,
        key: "test",
      } as Location);

      await act(async (): Promise<void> => {
        render(
          <MemoryRouter>
            <UserViewSideMenu
              modelId={TARGET_USER_ID}
              hasCustomFields={false}
            />
          </MemoryRouter>,
        );
      });

      expect(activeLinkTitles()).toEqual(["On-Call Rules"]);

      const rulesLink: HTMLElement | null = screen
        .getByText("On-Call Rules")
        .closest("a");

      // The bare address: a menu link never pins a tab.
      expect(rulesLink!.getAttribute("href")).toBe(rulesHref);

      cleanup();
    }
  });

  test("every page has a breadcrumb of its own", () => {
    for (const page of SECTION_PAGES) {
      const route: Route = RouteMap[page.pageMapKey] as Route;

      const breadcrumbs: Array<Link> | undefined = getUsersBreadcrumbs(
        route.toString(),
      );

      expect(breadcrumbs).toBeDefined();

      const titles: Array<string> = breadcrumbs!.map((link: Link): string => {
        return link.title;
      });

      /*
       * A page with no breadcrumb entry renders a bare title and no way back up
       * — survivable on one route, worse once a single page became a section
       * somebody navigates around inside.
       */
      expect(titles).toContain(page.breadcrumbTitle);
      expect(titles[0]).toBe("Project");
    }
  });

  test("the three routes are distinct URLs", () => {
    const paths: Array<string> = SECTION_PAGES.map(
      (page: SectionPage): string => {
        return (RouteMap[page.pageMapKey] as Route).toString();
      },
    );

    /*
     * Two PageMap keys pointing at one path is a copy-paste that produces a
     * menu entry which silently opens somebody else's page.
     */
    expect(new Set(paths).size).toBe(SECTION_PAGES.length);

    // And none of them collides with the legacy route that now redirects.
    expect(paths).not.toContain(
      (RouteMap[PageMap.USER_VIEW_NOTIFICATION_RULES] as Route).toString(),
    );
  });

  test("the route table no longer has a page per kind of rule", () => {
    const routes: Array<string> = Object.values(RouteMap).map(
      (route: Route): string => {
        return route.toString();
      },
    );

    for (const retiredPath of RETIRED_RULE_PAGE_PATHS) {
      expect(
        routes.filter((route: string): boolean => {
          return route.endsWith(`/${retiredPath}`);
        }),
      ).toEqual([]);
    }

    expect(
      Object.keys(PageMap).filter((key: string): boolean => {
        return (
          key.startsWith("USER_VIEW_") &&
          key.endsWith("_ON_CALL_RULES") &&
          key !== "USER_VIEW_ON_CALL_RULES"
        );
      }),
    ).toEqual([]);
  });
});
