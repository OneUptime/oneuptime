/** @timezone UTC */

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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { SpyInstance } from "jest-mock";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import SetupHealthApi, {
  getSetupHealthSummaryUrl,
  getSetupHealthUrl,
  isSetupHealthAnswer,
  isSetupHealthSummary,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupHealth/SetupHealthApi";
import SetupHealthView from "../../../../App/FeatureSet/Dashboard/src/Components/SetupHealth/SetupHealthView";
import {
  FINDINGS_SHOWN_PER_CHECK,
  LEVEL_WORDS,
  SETUP_HEALTH_WORDS_PAGE,
  getSetupHealthFixLink,
  getSetupHealthSentence,
  groupSetupHealthFindings,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupHealth/SetupHealthWords";
import { SETUP_HEALTH_HOME_WORDS } from "../../../../App/FeatureSet/Dashboard/src/Components/SetupHealth/SetupHealthHomeWords";
import { getHomeBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/HomeBreadcrumbs";
import { getPageSearchAreas } from "../../../../App/FeatureSet/Dashboard/src/Components/CommandPalette/PageSearchIndex";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  HomeRoutePath,
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import { ProductEventName } from "../../../Types/Analytics/ProductEvent";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import RecommendationType from "../../../Types/Recommendation/RecommendationType";
import {
  SETUP_HEALTH_WORDS,
  SetupHealthAnswer,
  SetupHealthCheck,
  SetupHealthEventKind,
  SetupHealthFinding,
  SetupHealthFix,
  SetupHealthLevel,
  SetupHealthRecordKind,
  SetupHealthResponderReason,
  SetupHealthScheduleReason,
  getSetupHealthCounts,
  makeSetupHealthFinding,
} from "../../../Types/SetupHealth/SetupHealth";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { WhoIsToldServerChannel } from "../../../Types/Monitor/WhoIsTold";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProductEvents from "../../../UI/Utils/ProductEvents";
import {
  getGlobalTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import User from "../../../UI/Utils/User";
import RecommendationDismissalUtil from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/RecommendationDismissalUtil";
import { dashboardTranslator } from "../../Helpers/DashboardLocales";
import { toHeadline } from "../../../UI/Components/Table/EmptyTableMessage";
import { goTo, PROJECT_ID as SIDE_MENU_PROJECT_ID } from "./SideMenuHarness";

/*
 * SETUP HEALTH ON THE DASHBOARD (#6812): the page lists the findings by
 * level, worst first, each in the reader's words with the button that
 * opens its fix; a check broken for many records is folded past a few; a
 * finding is dismissed with a reason, for everyone, and restored from
 * Dismissed; and a project with nothing wrong says so plainly.
 */

const PROJECT: string = "68125555-0000-4000-8000-000000000001";
const CHECKOUT: string = "68125555-0000-4000-8000-0000000000a1";
const PRIMARY: string = "68125555-0000-4000-8000-0000000000b1";
const ANA: string = "68125555-0000-4000-8000-0000000000c1";
const SCHEDULE: string = "68125555-0000-4000-8000-0000000000d1";
const STATUS_PAGE: string = "68125555-0000-4000-8000-0000000000e1";
const DISMISSAL: string = "68125555-0000-4000-8000-0000000000f1";

const translator: Translator = getGlobalTranslator();

function monitorFinding(index: number): SetupHealthFinding {
  return makeSetupHealthFinding({
    check: SetupHealthCheck.MonitorPagesNobody,
    level: SetupHealthLevel.WorthFixing,
    subject: SetupHealthEventKind.Incident,
    record: {
      kind: SetupHealthRecordKind.Monitor,
      id: `68125555-1111-4000-8000-${index.toString().padStart(12, "0")}`,
      name: `Monitor ${index}`,
    },
    fix: SetupHealthFix.IncidentOnCallRules,
    words: SETUP_HEALTH_WORDS.monitorPagesNobody.incident,
    values: { monitor: `Monitor ${index}` },
  });
}

const POLICY_FINDING: SetupHealthFinding = makeSetupHealthFinding({
  check: SetupHealthCheck.PolicyHasNoEscalationRules,
  level: SetupHealthLevel.PagesWillNotArrive,
  record: {
    kind: SetupHealthRecordKind.OnCallDutyPolicy,
    id: PRIMARY,
    name: "Primary",
  },
  fix: SetupHealthFix.OnCallPolicy,
  fixRecordId: PRIMARY,
  words: SETUP_HEALTH_WORDS.policyHasNoEscalationRules,
  values: { policy: "Primary" },
});

const SERVER_FINDING: SetupHealthFinding = makeSetupHealthFinding({
  check: SetupHealthCheck.ServerCannotSend,
  level: SetupHealthLevel.PagesWillNotArrive,
  subject: WhoIsToldServerChannel.Email,
  record: { kind: SetupHealthRecordKind.Project, id: PROJECT, name: "" },
  fix: SetupHealthFix.ServerSettings,
  words: SETUP_HEALTH_WORDS.serverCannotSend.Email,
});

const OWNER_FINDING: SetupHealthFinding = makeSetupHealthFinding({
  check: SetupHealthCheck.OneOwner,
  level: SetupHealthLevel.Suggestion,
  record: { kind: SetupHealthRecordKind.Project, id: PROJECT, name: "" },
  fix: SetupHealthFix.ProjectOwners,
  words: SETUP_HEALTH_WORDS.oneOwner,
});

function answer(
  findings: Array<SetupHealthFinding>,
  overrides: Partial<SetupHealthAnswer> = {},
): SetupHealthAnswer {
  return {
    findings: findings,
    dismissed: [],
    counts: getSetupHealthCounts(findings),
    monitorCount: 12,
    checkedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("a finding, in the reader's words, with where to fix it", () => {
  test("the server's template, with the names as written", () => {
    expect(getSetupHealthSentence(POLICY_FINDING, translator)).toBe(
      "On-call policy Primary has no escalation rules, so it pages nobody.",
    );
  });

  test("in German and in Arabic, the names set in as written", () => {
    expect(
      getSetupHealthSentence(POLICY_FINDING, dashboardTranslator("de")),
    ).toContain("Primary");
    expect(
      getSetupHealthSentence(POLICY_FINDING, dashboardTranslator("de")),
    ).not.toBe(POLICY_FINDING.sentence);
    expect(
      getSetupHealthSentence(monitorFinding(1), dashboardTranslator("ar")),
    ).toContain("Monitor 1");
    expect(
      getSetupHealthSentence(monitorFinding(1), dashboardTranslator("ar")),
    ).not.toBe(monitorFinding(1).sentence);
  });

  test("a switched-off channel by its name in the reader's words", () => {
    const off: SetupHealthFinding = makeSetupHealthFinding({
      check: SetupHealthCheck.ChannelOff,
      level: SetupHealthLevel.PagesWillNotArrive,
      subject: OnCallPageChannel.Call,
      record: { kind: SetupHealthRecordKind.Project, id: PROJECT, name: "" },
      fix: SetupHealthFix.ProjectNotificationSettings,
      words: SETUP_HEALTH_WORDS.channelOff,
      values: { channel: "Phone call" },
    });

    expect(getSetupHealthSentence(off, translator)).toBe(
      "Phone call is off in this project, so pages that use it are not sent.",
    );
    expect(
      getSetupHealthSentence(off, dashboardTranslator("de")),
    ).not.toContain("Phone call");
  });

  test("a gap's start, and a balance, written the reader's way", () => {
    const gap: SetupHealthFinding = makeSetupHealthFinding({
      check: SetupHealthCheck.ScheduleHasNobodyOnCall,
      level: SetupHealthLevel.WorthFixing,
      reason: SetupHealthScheduleReason.GapAhead,
      record: {
        kind: SetupHealthRecordKind.OnCallDutyPolicySchedule,
        id: SCHEDULE,
        name: "Primary rota",
      },
      fix: SetupHealthFix.OnCallSchedule,
      fixRecordId: SCHEDULE,
      words: SETUP_HEALTH_WORDS.scheduleHasNobodyOnCall.gap_ahead,
      values: { schedule: "Primary rota", time: "2026-11-14 03:00 UTC" },
      startsAt: "2026-11-14T03:00:00.000Z",
    });

    const english: string = getSetupHealthSentence(gap, translator);

    expect(english).toContain("Primary rota");
    expect(english).toContain("2026");
    expect(english).not.toContain("UTC");

    const low: SetupHealthFinding = makeSetupHealthFinding({
      check: SetupHealthCheck.LowBalance,
      level: SetupHealthLevel.WorthFixing,
      record: { kind: SetupHealthRecordKind.Project, id: PROJECT, name: "" },
      fix: SetupHealthFix.ProjectBilling,
      words: SETUP_HEALTH_WORDS.lowBalance,
      values: { balance: "$4.20" },
      balanceInUSDCents: 420,
    });

    expect(getSetupHealthSentence(low, translator)).toContain("$4.20");
    expect(getSetupHealthSentence(low, dashboardTranslator("de"))).toContain(
      "4,20",
    );
  });

  test("a person with no name is someone, in the reader's words", () => {
    const nameless: SetupHealthFinding = makeSetupHealthFinding({
      check: SetupHealthCheck.ResponderCannotBePaged,
      level: SetupHealthLevel.PagesWillNotArrive,
      reason: SetupHealthResponderReason.NoVerifiedMethod,
      record: { kind: SetupHealthRecordKind.User, id: ANA, name: "" },
      fix: SetupHealthFix.OnCallReadiness,
      words: SETUP_HEALTH_WORDS.responderCannotBePaged.no_verified_method,
      values: { name: "Someone" },
    });

    expect(getSetupHealthSentence(nameless, translator)).toBe(
      "Someone has no verified notification method, so pages don't reach them.",
    );
  });

  test.each([
    [SetupHealthFix.MonitorCriteria, PageMap.MONITOR_VIEW_CRITERIA, CHECKOUT],
    [SetupHealthFix.MonitorProbes, PageMap.MONITOR_VIEW_PROBES, CHECKOUT],
    [SetupHealthFix.MonitorOverview, PageMap.MONITOR_VIEW, CHECKOUT],
    [SetupHealthFix.CreateMonitor, PageMap.MONITOR_CREATE, ""],
    [
      SetupHealthFix.IncidentOnCallRules,
      PageMap.INCIDENTS_SETTINGS_ON_CALL_RULES,
      "",
    ],
    [
      SetupHealthFix.AlertOnCallRules,
      PageMap.ALERTS_SETTINGS_ON_CALL_RULES,
      "",
    ],
    [
      SetupHealthFix.OnCallPolicy,
      PageMap.ON_CALL_DUTY_POLICY_VIEW_ESCALATION,
      PRIMARY,
    ],
    [
      SetupHealthFix.OnCallSchedule,
      PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_LAYERS,
      SCHEDULE,
    ],
    [SetupHealthFix.OnCallReadiness, PageMap.ON_CALL_DUTY_READINESS, ""],
    [
      SetupHealthFix.ProjectNotificationSettings,
      PageMap.SETTINGS_NOTIFICATION_SETTINGS,
      "",
    ],
    [SetupHealthFix.ProjectBilling, PageMap.SETTINGS_BILLING, ""],
    [
      SetupHealthFix.StatusPageResources,
      PageMap.STATUS_PAGE_VIEW_RESOURCES,
      STATUS_PAGE,
    ],
    [
      SetupHealthFix.StatusPageDomains,
      PageMap.STATUS_PAGE_VIEW_DOMAINS,
      STATUS_PAGE,
    ],
    [SetupHealthFix.ProjectOwners, PageMap.TEAMS, ""],
  ])(
    "%s opens %s",
    (fix: SetupHealthFix, pageMap: PageMap, recordId: string) => {
      const finding: SetupHealthFinding = {
        ...POLICY_FINDING,
        fix: fix,
        fixRecordId: recordId,
      };
      const link: ReturnType<typeof getSetupHealthFixLink> =
        getSetupHealthFixLink({ finding: finding, translator: translator });

      expect(link).not.toBeNull();
      expect(link!.route.toString()).toBe(
        (recordId
          ? RouteUtil.populateRouteParams(RouteMap[pageMap] as Route, {
              modelId: new ObjectID(recordId),
            })
          : RouteUtil.populateRouteParams(RouteMap[pageMap] as Route)
        ).toString(),
      );
      expect(link!.text.length).toBeGreaterThan(3);
    },
  );

  test.each([
    [WorkspaceType.Slack, PageMap.INCIDENTS_WORKSPACE_CONNECTION_SLACK],
    [
      WorkspaceType.MicrosoftTeams,
      PageMap.INCIDENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS,
    ],
    [
      WorkspaceType.Mattermost,
      PageMap.INCIDENTS_WORKSPACE_CONNECTION_MATTERMOST,
    ],
  ])(
    "a chat workspace's rules are its own page: %s",
    (workspace: WorkspaceType, pageMap: PageMap) => {
      const link: ReturnType<typeof getSetupHealthFixLink> =
        getSetupHealthFixLink({
          finding: {
            ...OWNER_FINDING,
            check: SetupHealthCheck.WorkspaceNotUsed,
            subject: workspace,
            fix: SetupHealthFix.WorkspaceNotificationRules,
          },
          translator: translator,
        });

      expect(link!.route.toString()).toBe(
        RouteUtil.populateRouteParams(RouteMap[pageMap] as Route).toString(),
      );
      expect(link!.text).toBe("Add Notification Rule");
    },
  );

  test("the server's fix is its admin's, not a page of the Dashboard", () => {
    expect(
      getSetupHealthFixLink({
        finding: SERVER_FINDING,
        translator: translator,
      }),
    ).toBeNull();
  });

  test("a check broken for many records is one group, in the server's order", () => {
    const groups: ReturnType<typeof groupSetupHealthFindings> =
      groupSetupHealthFindings([
        monitorFinding(1),
        monitorFinding(2),
        POLICY_FINDING,
        monitorFinding(3),
      ]);

    expect(
      groups.map((group: { findings: Array<unknown> }) => {
        return group.findings.length;
      }),
    ).toEqual([3, 1]);
  });
});

describe("the page's requests", () => {
  test("one GET for the findings, with refresh only when asked; one for Home's counts", () => {
    expect(getSetupHealthUrl().toString()).toMatch(/\/setup-health$/);
    expect(getSetupHealthUrl({ refresh: true }).toString()).toMatch(
      /\/setup-health\?refresh=true$/,
    );
    expect(getSetupHealthSummaryUrl().toString()).toMatch(
      /\/setup-health\/summary$/,
    );
  });

  test("only an answer with findings, dismissed ones, counts and a time is drawn", () => {
    expect(isSetupHealthAnswer(answer([]))).toBe(true);
    expect(isSetupHealthAnswer({ findings: [] })).toBe(false);
    expect(isSetupHealthAnswer(null)).toBe(false);
    expect(isSetupHealthAnswer([])).toBe(false);
    expect(
      isSetupHealthSummary({
        counts: getSetupHealthCounts([]),
        checkedAt: "x",
      }),
    ).toBe(true);
    expect(isSetupHealthSummary({ counts: {} })).toBe(false);
    expect(isSetupHealthSummary("<html>")).toBe(false);
  });

  test("a dismissal is the project's RecommendationDismissal of the finding's check and record", async () => {
    const dismiss: SpyInstance<typeof RecommendationDismissalUtil.dismiss> =
      jest
        .spyOn(RecommendationDismissalUtil, "dismiss")
        .mockResolvedValue(undefined as never);
    const restore: SpyInstance<typeof RecommendationDismissalUtil.restore> =
      jest
        .spyOn(RecommendationDismissalUtil, "restore")
        .mockResolvedValue(undefined as never);

    await SetupHealthApi.dismiss({
      finding: monitorFinding(7),
      reason: "Staging",
    });

    expect(dismiss).toHaveBeenCalledWith({
      recommendationId: "monitor_pages_nobody:incident",
      recommendationType: RecommendationType.SetupHealth,
      resourceType: SetupHealthRecordKind.Monitor,
      resourceId: new ObjectID(monitorFinding(7).record.id),
      dismissalReason: "Staging",
    });

    await SetupHealthApi.restore(DISMISSAL);

    expect(restore).toHaveBeenCalledWith(new ObjectID(DISMISSAL));

    jest.restoreAllMocks();
  });
});

describe("the page lives under Home, and Search finds it", () => {
  test("at …/home/setup-health, with a trail of Project, Home and Setup Health", () => {
    expect(HomeRoutePath[PageMap.HOME_SETUP_HEALTH]).toBe("setup-health");
    expect(RouteMap[PageMap.HOME_SETUP_HEALTH]!.toString()).toBe(
      "/dashboard/:projectId/home/setup-health",
    );

    goTo(`/dashboard/${SIDE_MENU_PROJECT_ID}/home/setup-health`);

    const trail: ReturnType<typeof getHomeBreadcrumbs> = getHomeBreadcrumbs(
      RouteMap[PageMap.HOME_SETUP_HEALTH]!.toString(),
    );

    expect(
      trail!.map((link: { title: string }) => {
        return link.title;
      }),
    ).toEqual(["Project", "Home", "Setup Health"]);
  });

  test("Search offers it under Home, by name and by what people ask", () => {
    const home: ReturnType<typeof getPageSearchAreas>[number] | undefined =
      getPageSearchAreas().find((area: { id: string }): boolean => {
        return area.id === "home";
      });

    expect(home).toBeDefined();
    expect(home!.productPage).toBe(PageMap.HOME);

    const page: {
      page: string;
      title: string;
      keywords?: Array<string> | undefined;
    } = home!.sections[0]!.pages[0]!;

    expect(page.page).toBe(PageMap.HOME_SETUP_HEALTH);
    expect(page.title).toBe("Setup Health");
    expect(page.keywords).toEqual(
      expect.arrayContaining(["misconfigured", "is my setup ok"]),
    );
  });
});

describe("SetupHealthView", () => {
  let getAnswer: SpyInstance<typeof SetupHealthApi.getAnswer>;
  let send: SpyInstance<typeof ProductEvents.send>;

  function renderView(): void {
    render(
      <MemoryRouter>
        <SetupHealthView />
      </MemoryRouter>,
    );
  }

  beforeEach(() => {
    getAnswer = jest.spyOn(SetupHealthApi, "getAnswer");
    send = jest.spyOn(ProductEvents, "send").mockImplementation(() => {
      return undefined;
    });
    jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
    jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("lists the findings by level, worst first, each with its sentence and its fix", async () => {
    getAnswer.mockResolvedValue(
      answer([POLICY_FINDING, monitorFinding(1), OWNER_FINDING]),
    );
    renderView();

    expect(screen.getByTestId("setup-health-loading")).toBeInTheDocument();

    const pages: HTMLElement = await screen.findByTestId(
      `setup-health-level-${SetupHealthLevel.PagesWillNotArrive}`,
    );
    const worth: HTMLElement = screen.getByTestId(
      `setup-health-level-${SetupHealthLevel.WorthFixing}`,
    );
    const suggestions: HTMLElement = screen.getByTestId(
      `setup-health-level-${SetupHealthLevel.Suggestion}`,
    );

    // Worst first.
    expect(
      pages.compareDocumentPosition(worth) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      worth.compareDocumentPosition(suggestions) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    expect(pages).toHaveTextContent(
      LEVEL_WORDS[SetupHealthLevel.PagesWillNotArrive].title,
    );
    expect(pages).toHaveTextContent(
      "On-call policy Primary has no escalation rules, so it pages nobody.",
    );

    const fix: HTMLElement = within(pages).getByTestId("setup-health-fix");

    expect(fix).toHaveTextContent("Open On-Call Policy");
    expect(fix.getAttribute("href")).toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.ON_CALL_DUTY_POLICY_VIEW_ESCALATION] as Route,
        { modelId: new ObjectID(PRIMARY) },
      ).toString(),
    );
    expect(
      within(worth).getByTestId("setup-health-fix").getAttribute("href"),
    ).toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.INCIDENTS_SETTINGS_ON_CALL_RULES] as Route,
      ).toString(),
    );
    expect(
      screen.getByTestId(
        `setup-health-level-${SetupHealthLevel.WorthFixing}-count`,
      ),
    ).toHaveTextContent("1");
    expect(screen.queryByTestId("setup-health-nothing-to-fix")).toBeNull();
    expect(getAnswer).toHaveBeenCalledWith({ refresh: false });
  });

  test("says when it was opened, from where, and how many findings of each level", async () => {
    getAnswer.mockResolvedValue(
      answer([POLICY_FINDING, monitorFinding(1), OWNER_FINDING]),
    );
    renderView();

    await screen.findByTestId(
      `setup-health-level-${SetupHealthLevel.PagesWillNotArrive}`,
    );

    expect(send).toHaveBeenCalledWith(ProductEventName.SetupHealthOpened, {
      source: "direct",
      pages_will_not_arrive_count: 1,
      worth_fixing_count: 1,
      suggestion_count: 1,
      dismissed_count: 0,
    });

    fireEvent.click(
      within(
        screen.getByTestId(
          `setup-health-level-${SetupHealthLevel.PagesWillNotArrive}`,
        ),
      ).getByTestId("setup-health-fix"),
    );

    expect(send).toHaveBeenCalledWith(ProductEventName.SetupHealthFixOpened, {
      check: SetupHealthCheck.PolicyHasNoEscalationRules,
      level: SetupHealthLevel.PagesWillNotArrive,
    });
  });

  test("a project with nothing wrong says so plainly", async () => {
    getAnswer.mockResolvedValue(answer([]));
    renderView();

    const empty: HTMLElement = await screen.findByTestId(
      "setup-health-nothing-to-fix",
    );

    // The product's all-clear state, its title a heading without the stop.
    expect(empty).toHaveTextContent(
      toHeadline(SETUP_HEALTH_WORDS_PAGE.nothingToFix),
    );
    expect(empty).toHaveTextContent(
      SETUP_HEALTH_WORDS_PAGE.nothingToFixDescription,
    );
    expect(within(empty).getByTestId("table-empty-state")).toHaveAttribute(
      "data-empty-state-kind",
      "all-clear",
    );
    expect(screen.queryByTestId("setup-health-finding")).toBeNull();
  });

  test("a check broken for many monitors shows a few, and the rest a click away, saying which way it is", async () => {
    const many: Array<SetupHealthFinding> = [1, 2, 3, 4, 5].map(monitorFinding);
    getAnswer.mockResolvedValue(answer(many));
    renderView();

    const toggle: HTMLElement = await screen.findByTestId(
      "setup-health-group-toggle",
    );

    expect(screen.getAllByTestId("setup-health-finding")).toHaveLength(
      FINDINGS_SHOWN_PER_CHECK,
    );
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent("Show 2 more");

    fireEvent.click(toggle);

    expect(screen.getAllByTestId("setup-health-finding")).toHaveLength(5);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveTextContent(SETUP_HEALTH_WORDS_PAGE.showFewer);
  });

  test("the server's findings ask its admin, and open the Admin Dashboard for one", async () => {
    getAnswer.mockResolvedValue(answer([SERVER_FINDING]));
    renderView();

    expect(
      await screen.findByTestId("setup-health-ask-admin"),
    ).toHaveTextContent(SETUP_HEALTH_WORDS_PAGE.askServerAdmin);
    expect(screen.queryByTestId("setup-health-fix")).toBeNull();

    cleanup();
    jest.spyOn(User, "isMasterAdmin").mockReturnValue(true);
    renderView();

    const fix: HTMLElement = await screen.findByTestId("setup-health-fix");

    expect(fix).toHaveTextContent("Open Server Setup");
    expect(fix.getAttribute("href")).toMatch(/\/setup$/);
    expect(fix).toHaveAttribute("target", "_blank");
  });

  test("dismissing asks why, hides the finding for everyone, and reads the list again", async () => {
    getAnswer.mockResolvedValue(answer([monitorFinding(1), OWNER_FINDING]));
    const dismiss: SpyInstance<typeof SetupHealthApi.dismiss> = jest
      .spyOn(SetupHealthApi, "dismiss")
      .mockResolvedValue(undefined as never);
    renderView();

    const rows: Array<HTMLElement> = await screen.findAllByTestId(
      "setup-health-finding",
    );

    fireEvent.click(within(rows[0]!).getByTestId("setup-health-dismiss"));

    expect(
      screen.getByText(SETUP_HEALTH_WORDS_PAGE.dismissTitle),
    ).toBeInTheDocument();

    const reason: HTMLElement = screen.getByTestId(
      "setup-health-dismiss-reason",
    );

    expect(reason).toHaveAttribute(
      "placeholder",
      SETUP_HEALTH_WORDS_PAGE.dismissPlaceholder,
    );

    fireEvent.change(reason, { target: { value: "Staging, on purpose" } });
    getAnswer.mockResolvedValue(answer([OWNER_FINDING]));
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(dismiss).toHaveBeenCalledWith({
        finding: monitorFinding(1),
        reason: "Staging, on purpose",
      });
    });

    await waitFor(() => {
      expect(screen.getAllByTestId("setup-health-finding")).toHaveLength(1);
    });
    expect(getAnswer).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith(
      ProductEventName.SetupHealthFindingDismissed,
      { check: SetupHealthCheck.MonitorPagesNobody, has_reason: true },
    );
  });

  test("somebody who may not dismiss is not offered Dismiss", async () => {
    jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: false });
    getAnswer.mockResolvedValue(answer([monitorFinding(1)]));
    renderView();

    await screen.findByTestId("setup-health-finding");

    expect(screen.queryByTestId("setup-health-dismiss")).toBeNull();
  });

  test("Dismissed is folded, says who hid each and why, and Restore brings one back", async () => {
    const restore: SpyInstance<typeof SetupHealthApi.restore> = jest
      .spyOn(SetupHealthApi, "restore")
      .mockResolvedValue(undefined as never);

    getAnswer.mockResolvedValue(
      answer([OWNER_FINDING], {
        dismissed: [
          {
            finding: monitorFinding(1),
            dismissal: {
              id: DISMISSAL,
              recommendationId: "monitor_pages_nobody:incident",
              resourceType: SetupHealthRecordKind.Monitor,
              resourceId: monitorFinding(1).record.id,
              reason: "Staging",
              dismissedByName: "Ana Lopez",
              dismissedAt: null,
            },
          },
        ],
      }),
    );
    renderView();

    const toggle: HTMLElement = await screen.findByTestId(
      "setup-health-dismissed-toggle",
    );

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("setup-health-dismissed-finding")).toBeNull();

    fireEvent.click(toggle);

    const row: HTMLElement = screen.getByTestId(
      "setup-health-dismissed-finding",
    );

    expect(row).toHaveTextContent(
      "Nobody is paged when Monitor 1 goes down: no on-call rule matches its incidents.",
    );
    expect(
      within(row).getByTestId("setup-health-dismissed-by"),
    ).toHaveTextContent("Dismissed by Ana Lopez: Staging");

    getAnswer.mockResolvedValue(answer([OWNER_FINDING, monitorFinding(1)]));
    fireEvent.click(within(row).getByTestId("setup-health-restore"));

    await waitFor(() => {
      expect(restore).toHaveBeenCalledWith(DISMISSAL);
    });
    await waitFor(() => {
      expect(screen.getAllByTestId("setup-health-finding")).toHaveLength(2);
    });
    expect(send).toHaveBeenCalledWith(
      ProductEventName.SetupHealthFindingRestored,
      { check: SetupHealthCheck.MonitorPagesNobody },
    );
  });

  test("Recheck asks the server to work it out again", async () => {
    getAnswer.mockResolvedValue(answer([OWNER_FINDING]));
    renderView();

    await screen.findByTestId("setup-health-finding");
    fireEvent.click(screen.getByTestId("setup-health-recheck"));

    await waitFor(() => {
      expect(getAnswer).toHaveBeenLastCalledWith({ refresh: true });
    });
    // Opened once, however many times it is read again.
    expect(
      send.mock.calls.filter((call: Array<unknown>) => {
        return call[0] === ProductEventName.SetupHealthOpened;
      }),
    ).toHaveLength(1);
  });

  test("a failed read says so, in words", async () => {
    getAnswer.mockRejectedValue(new Error("Server is down."));
    renderView();

    expect(await screen.findByTestId("setup-health-error")).toHaveTextContent(
      "Couldn't check the setup. Server is down.",
    );
  });
});

describe("Home's words for it", () => {
  test("how many things need a look, in the reader's plural", () => {
    expect(translator.translatePlural(SETUP_HEALTH_HOME_WORDS.line, 1)).toBe(
      "1 thing in your setup needs a look.",
    );
    expect(translator.translatePlural(SETUP_HEALTH_HOME_WORDS.line, 3)).toBe(
      "3 things in your setup need a look.",
    );
    expect(
      dashboardTranslator("de").translatePlural(
        SETUP_HEALTH_HOME_WORDS.line,
        3,
      ),
    ).not.toBe("3 things in your setup need a look.");
  });
});
