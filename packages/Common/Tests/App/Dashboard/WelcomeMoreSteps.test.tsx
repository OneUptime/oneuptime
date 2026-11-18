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
import * as fs from "fs";
import { createInstance, i18n } from "i18next";
import * as path from "path";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * HOME'S WELCOME CARD, ONCE A STEP'S RECORD EXISTS AND ONCE THE STEPS ARE
 * DONE, with the real component and the server's answers stood in for:
 *
 *  - What else to set up (#7986): once the goals' steps are done, the card
 *    offers the core steps no goal brought - a status page, the team - each
 *    with its own button, until it works or the person hides the card.
 *  - The phone and the app (#9442): while only email pages the person, the
 *    ticked "Set up an on-call policy" keeps "Get paged by SMS or phone
 *    call", and so does what else to set up, opening the on-call guided
 *    setup from Home.
 *  - Why a step is not done although its record exists (#6938): one line
 *    under it, in Setup health's words, and the step opens the fix.
 */

const navigateMock: MockFunction = getJestMockFunction();
const captureMock: MockFunction = getJestMockFunction();
const sendMock: MockFunction = getJestMockFunction();
const fetchMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();
const legacyMock: MockFunction = getJestMockFunction();

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
      capture: (...args: Array<unknown>) => {
        return captureMock(...args);
      },
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
import {
  STEP_WORDS_BESIDE_CHEVRON_CLASS_NAME,
  STEP_WORDS_OVER_ACTION_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Home/WelcomeChecklist/WelcomePlanStep";
import {
  WELCOME_CHECKLIST_COPY,
  WELCOME_GAP_COPY,
  WELCOME_MORE_COPY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Home/WelcomeChecklist/WelcomeChecklistCatalog";
import {
  WELCOME_MORE_PHONE_KEY,
  WELCOME_MORE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Home/WelcomeChecklist/WelcomeMoreSteps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import { ProductEventName } from "../../../Types/Analytics/ProductEvent";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import ObjectID from "../../../Types/ObjectID";
import {
  SETUP_HEALTH_WORDS,
  SetupHealthCheck,
  SetupHealthFinding,
  SetupHealthFix,
  SetupHealthLevel,
  SetupHealthRecordKind,
  makeSetupHealthFinding,
} from "../../../Types/SetupHealth/SetupHealth";
import ProjectGoal from "../../../Types/WelcomeChecklist/ProjectGoal";
import {
  WELCOME_GAP_INVITATION_NOT_ACCEPTED,
  WelcomeAudience,
  WelcomeChecklistStepState,
  WelcomeStep,
} from "../../../Types/WelcomeChecklist/WelcomeChecklist";
import {
  WELCOME_CHECKLIST_HIDE_ROUTE,
  WelcomeChecklistAnswer,
  getEmptyWelcomeChecklistAnswer,
} from "../../../Types/WelcomeChecklist/WelcomeChecklistAnswer";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import PermissionGate, {
  PermissionCheckableModel,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import UserUtil from "../../../UI/Utils/User";
import Name from "../../../Types/Name";

const PROJECT_ID: string = "65f00000000000000000eeee";
const STATUS_PAGE_ID: string = "65f0000000000000000e0001";
const POLICY_ID: string = "65f0000000000000000e0002";

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src",
);

type Locale = Record<string, unknown>;

function readLocale(locale: string): Locale {
  return JSON.parse(
    fs.readFileSync(
      path.join(DASHBOARD_SRC, "Locales", `${locale}.json`),
      "utf8",
    ),
  ) as Locale;
}

async function instanceFor(locale: string): Promise<i18n> {
  const instance: i18n = createInstance();

  await instance.init({
    lng: locale,
    fallbackLng: "en",
    resources: {
      en: { translation: readLocale("en") },
      [locale]: { translation: readLocale(locale) },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });

  return instance;
}

function step(
  key: WelcomeStep,
  extra?: Partial<WelcomeChecklistStepState>,
): WelcomeChecklistStepState {
  return {
    step: key,
    isDone: false,
    needsPlan: null,
    isNext: false,
    gap: null,
    ...extra,
  };
}

function answer(
  extra?: Partial<WelcomeChecklistAnswer>,
): WelcomeChecklistAnswer {
  const steps: Array<WelcomeChecklistStepState> = extra?.steps || [
    step(WelcomeStep.Monitor, { isNext: true }),
    step(WelcomeStep.OnCall),
  ];

  return {
    ...getEmptyWelcomeChecklistAnswer(),
    audience: WelcomeAudience.SetUp,
    goals: [ProjectGoal.Uptime],
    canChooseGoals: true,
    steps: steps,
    doneCount: steps.filter((state: WelcomeChecklistStepState): boolean => {
      return state.isDone;
    }).length,
    totalCount: steps.length,
    ...extra,
  };
}

// A website project whose two steps are done: what else is left (#7986).
function finished(
  extra?: Partial<WelcomeChecklistAnswer>,
): WelcomeChecklistAnswer {
  return answer({
    isFinished: true,
    steps: [],
    doneCount: 0,
    totalCount: 0,
    moreSteps: [step(WelcomeStep.StatusPage), step(WelcomeStep.Team)],
    canBePagedByPhoneOrApp: true,
    ...extra,
  });
}

const emptyStatusPage: () => SetupHealthFinding = (): SetupHealthFinding => {
  return makeSetupHealthFinding({
    check: SetupHealthCheck.StatusPageShowsNoMonitor,
    level: SetupHealthLevel.WorthFixing,
    record: {
      kind: SetupHealthRecordKind.StatusPage,
      id: STATUS_PAGE_ID,
      name: "Acme status",
    },
    fix: SetupHealthFix.StatusPageResources,
    fixRecordId: STATUS_PAGE_ID,
    words: SETUP_HEALTH_WORDS.statusPageShowsNoMonitor,
    values: { statusPage: "Acme status" },
  });
};

const policyNotRun: () => SetupHealthFinding = (): SetupHealthFinding => {
  return makeSetupHealthFinding({
    check: SetupHealthCheck.PolicyNotRun,
    level: SetupHealthLevel.WorthFixing,
    record: {
      kind: SetupHealthRecordKind.OnCallDutyPolicy,
      id: POLICY_ID,
      name: "Primary",
    },
    fix: SetupHealthFix.IncidentOnCallRules,
    words: SETUP_HEALTH_WORDS.policyNotRun,
    values: { policy: "Primary" },
  });
};

// Whether this person may create an on-call policy, and so use its setup.
let mayCreatePolicy: boolean;

async function draw(locale?: string): Promise<void> {
  const card: React.ReactElement = (
    <MemoryRouter>
      <GettingStarted projectId={new ObjectID(PROJECT_ID)} />
    </MemoryRouter>
  );

  if (!locale) {
    await act(async () => {
      render(card);
    });
    return;
  }

  const instance: i18n = await instanceFor(locale);

  await act(async () => {
    render(<I18nextProvider i18n={instance}>{card}</I18nextProvider>);
  });
}

async function press(testId: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId(testId));
  });
}

function routeOf(pageMap: PageMap, modelId?: string): string {
  const route: string = RouteMap[pageMap]!.toString().replace(
    ":projectId",
    PROJECT_ID,
  );

  return modelId ? route.replace(":id", modelId) : route;
}

function navigatedTo(): string {
  expect(navigateMock).toHaveBeenCalledTimes(1);
  return String(navigateMock.mock.calls[0]![0]);
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  mayCreatePolicy = true;
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest.spyOn(UserUtil, "getName").mockReturnValue(new Name("Ada Lovelace"));
  legacyMock.mockResolvedValue(null);
  jest
    .spyOn(PermissionGate, "check")
    .mockImplementation(
      (model: PermissionCheckableModel): PermissionGateResult => {
        if (model instanceof OnCallDutyPolicy) {
          return { isAllowed: mayCreatePolicy };
        }

        return { isAllowed: true };
      },
    );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  navigateMock.mockReset();
  captureMock.mockReset();
  sendMock.mockReset();
  fetchMock.mockReset();
  postMock.mockReset();
  legacyMock.mockReset();
});

/*
 * Once the steps of the goals are done, the Welcome card no longer goes for
 * good (#7986): a project that came for its website is offered a status
 * page and its team on Home.
 */
describe("what else to set up, once the first steps are done", () => {
  test("offers the core steps left, each with its own button, as offers, not a path", async () => {
    fetchMock.mockResolvedValue(finished());
    await draw();

    const card: HTMLElement = screen.getByTestId(WELCOME_MORE_TEST_ID);

    expect(card).toHaveTextContent(WELCOME_MORE_COPY.title);
    expect(card).toHaveTextContent(WELCOME_MORE_COPY.description);
    expect(
      within(card)
        .getAllByTestId(/^getting-started-task-[a-z_]+$/)
        .map((row: HTMLElement): string => {
          return row.getAttribute("data-testid") || "";
        }),
    ).toEqual([
      "getting-started-task-status_page",
      "getting-started-task-team",
    ]);
    // Each is a button of its own.
    for (const row of within(card).getAllByTestId(
      /^getting-started-task-[a-z_]+$/,
    )) {
      expect(row.tagName).toBe("BUTTON");
    }
    // Offers, not a plan: nothing is next, and nothing joins them.
    expect(within(card).queryByTestId("getting-started-next")).toBeNull();
    expect(within(card).queryByTestId("getting-started-start")).toBeNull();
    expect(within(card).queryAllByTestId(/^getting-started-path-/)).toEqual([]);
    // Its words are the steps' own.
    expect(card).toHaveTextContent("Publish a status page");
    expect(card).toHaveTextContent("Invite your team");
    // Not the checklist, and not its question.
    expect(screen.queryByTestId("getting-started")).toBeNull();
    expect(screen.queryByTestId("welcome-question")).toBeNull();
  });

  test("Publish a status page opens its guided setup, and the click is recorded", async () => {
    fetchMock.mockResolvedValue(finished());
    await draw();

    await press("getting-started-task-status_page");

    expect(navigatedTo()).toBe(routeOf(PageMap.STATUS_PAGES_GUIDED_SETUP));
    expect(sendMock).toHaveBeenCalledWith(
      ProductEventName.ChecklistStepStarted,
      { step: WelcomeStep.StatusPage, goals: "uptime" },
    );
  });

  test("Invite your team opens Users, where Invite User is", async () => {
    fetchMock.mockResolvedValue(finished());
    await draw();

    await press("getting-started-task-team");

    expect(navigatedTo()).toBe(routeOf(PageMap.USERS));
  });

  test("on the Free plan, the team says which plan it needs, and opens Billing", async () => {
    fetchMock.mockResolvedValue(
      finished({
        moreSteps: [
          step(WelcomeStep.StatusPage),
          step(WelcomeStep.Team, { needsPlan: PlanType.Growth }),
        ],
      }),
    );
    await draw();

    expect(
      screen.getByTestId("getting-started-task-team-needs-plan"),
    ).toHaveTextContent("Needs the Growth plan");

    await press("getting-started-task-team");

    expect(navigatedTo()).toBe(routeOf(PageMap.SETTINGS_BILLING));
  });

  test("Hide takes it away for this person, with no line left behind", async () => {
    fetchMock.mockResolvedValue(finished());
    postMock.mockResolvedValue(finished({ isHiddenForMe: true }));
    await draw();

    await press("welcome-more-hide");

    expect(postMock).toHaveBeenCalledWith(WELCOME_CHECKLIST_HIDE_ROUTE, {});
    expect(screen.queryByTestId(WELCOME_MORE_TEST_ID)).toBeNull();
    expect(screen.queryByTestId("welcome-checklist-hidden")).toBeNull();
  });

  test("a hide that does not save says so, and keeps the card", async () => {
    fetchMock.mockResolvedValue(finished());
    postMock.mockResolvedValue(null);
    await draw();

    await press("welcome-more-hide");

    expect(screen.getByTestId(WELCOME_MORE_TEST_ID)).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      WELCOME_CHECKLIST_COPY.couldNotSave,
    );
  });

  test("nothing left, and a phone or the app pages them: no card", async () => {
    fetchMock.mockResolvedValue(finished({ moreSteps: [] }));
    await draw();

    expect(screen.queryByTestId(WELCOME_MORE_TEST_ID)).toBeNull();
  });
});

/*
 * While only email pages the person who set the project up, Home keeps a
 * way to the on-call guided setup (#9442).
 */
describe("the phone and the app, while only email pages them", () => {
  const ON_CALL_DONE: Array<WelcomeChecklistStepState> = [
    step(WelcomeStep.Monitor, { isNext: true }),
    step(WelcomeStep.OnCall, { isDone: true }),
  ];

  const phoneRoute: string = `${routeOf(PageMap.ON_CALL_DUTY_GUIDED_SETUP)}?from=home`;

  test("under the ticked Set up an on-call policy: Get paged by SMS or phone call, opening the setup from Home", async () => {
    fetchMock.mockResolvedValue(
      answer({ steps: ON_CALL_DONE, canBePagedByPhoneOrApp: false }),
    );
    await draw();

    const footer: HTMLElement = screen.getByTestId(
      "getting-started-task-on_call-footer",
    );
    const link: HTMLElement = within(footer).getByTestId(
      "welcome-paged-by-phone",
    );

    expect(link).toHaveTextContent(WELCOME_MORE_COPY.phoneTitle);
    expect(link.closest("a")).toHaveAttribute("href", phoneRoute);
    // On a done step, which is a record: never a control in a control.
    expect(screen.getByTestId("getting-started-task-on_call").tagName).toBe(
      "DIV",
    );
    expect(link.closest("button")).toBeNull();
  });

  test.each([
    ["a phone or the app pages them", true],
    ["it was not read", null],
  ])(
    "no way to it when %s",
    async (_name: string, canBePagedByPhoneOrApp: boolean | null) => {
      fetchMock.mockResolvedValue(
        answer({
          steps: ON_CALL_DONE,
          canBePagedByPhoneOrApp: canBePagedByPhoneOrApp,
        }),
      );
      await draw();

      expect(screen.queryByTestId("welcome-paged-by-phone")).toBeNull();
    },
  );

  test("someone who may not create an on-call policy is not offered it", async () => {
    mayCreatePolicy = false;
    fetchMock.mockResolvedValue(
      answer({ steps: ON_CALL_DONE, canBePagedByPhoneOrApp: false }),
    );
    await draw();

    expect(screen.queryByTestId("welcome-paged-by-phone")).toBeNull();
  });

  test("a step left to do opens the setup itself: nothing more under it", async () => {
    fetchMock.mockResolvedValue(
      answer({
        steps: [
          step(WelcomeStep.Monitor, { isDone: true }),
          step(WelcomeStep.OnCall, { isNext: true }),
        ],
        canBePagedByPhoneOrApp: false,
      }),
    );
    await draw();

    expect(screen.queryByTestId("welcome-paged-by-phone")).toBeNull();
    expect(
      screen.queryByTestId("getting-started-task-on_call-footer"),
    ).toBeNull();
  });

  test("once the steps are done, what else to set up offers it first, and opens the setup from Home", async () => {
    fetchMock.mockResolvedValue(finished({ canBePagedByPhoneOrApp: false }));
    await draw();

    const card: HTMLElement = screen.getByTestId(WELCOME_MORE_TEST_ID);

    expect(
      within(card)
        .getAllByTestId(/^getting-started-task-[a-z_]+$/)
        .map((row: HTMLElement): string => {
          return row.getAttribute("data-testid") || "";
        }),
    ).toEqual([
      `getting-started-task-${WELCOME_MORE_PHONE_KEY}`,
      "getting-started-task-status_page",
      "getting-started-task-team",
    ]);
    expect(
      screen.getByTestId(`getting-started-task-${WELCOME_MORE_PHONE_KEY}`),
    ).toHaveTextContent(WELCOME_MORE_COPY.phoneDescription);

    await press(`getting-started-task-${WELCOME_MORE_PHONE_KEY}`);

    expect(navigatedTo()).toBe(phoneRoute);
  });

  test("with nothing else left, the card still offers the phone alone", async () => {
    fetchMock.mockResolvedValue(
      finished({ moreSteps: [], canBePagedByPhoneOrApp: false }),
    );
    await draw();

    expect(
      within(screen.getByTestId(WELCOME_MORE_TEST_ID)).getAllByTestId(
        /^getting-started-task-[a-z_]+$/,
      ),
    ).toHaveLength(1);
  });
});

/*
 * A step whose record exists but does not work yet says why, and opens the
 * page that fixes it (#6938): it never looks like a step never started.
 */
describe("a step whose record exists but does not work yet", () => {
  test("a status page that shows no monitor says so under its step, its name in bold, where its time was", async () => {
    fetchMock.mockResolvedValue(
      answer({
        goals: [ProjectGoal.StatusPage],
        steps: [
          step(WelcomeStep.Monitor, { isDone: true }),
          step(WelcomeStep.StatusPage, {
            isNext: true,
            gap: {
              check: SetupHealthCheck.StatusPageShowsNoMonitor,
              finding: emptyStatusPage(),
            },
          }),
        ],
      }),
    );
    await draw();

    const gap: HTMLElement = screen.getByTestId(
      "getting-started-task-status_page-gap",
    );

    expect(gap).toHaveTextContent(
      "Status page Acme status shows no monitors yet.",
    );
    expect(within(gap).getByTestId("setup-health-name")).toHaveTextContent(
      "Acme status",
    );
    expect(
      screen.queryByTestId("getting-started-task-status_page-minutes"),
    ).toBeNull();
    expect(
      screen.getByTestId("getting-started-task-status_page"),
    ).toHaveAttribute("data-gap", "true");
  });

  test("its click opens where a monitor is added: the status page's Monitors", async () => {
    fetchMock.mockResolvedValue(
      answer({
        steps: [
          step(WelcomeStep.StatusPage, {
            isNext: true,
            gap: {
              check: SetupHealthCheck.StatusPageShowsNoMonitor,
              finding: emptyStatusPage(),
            },
          }),
        ],
      }),
    );
    await draw();

    await press("getting-started-task-status_page");

    expect(navigatedTo()).toBe(
      routeOf(PageMap.STATUS_PAGE_VIEW_RESOURCES, STATUS_PAGE_ID),
    );
    // Still a step started from Home, as analytics counts it.
    expect(sendMock).toHaveBeenCalledWith(
      ProductEventName.ChecklistStepStarted,
      expect.objectContaining({ step: WelcomeStep.StatusPage }),
    );
  });

  test("an on-call policy nothing runs says so, and opens the incident on-call rules", async () => {
    fetchMock.mockResolvedValue(
      answer({
        steps: [
          step(WelcomeStep.OnCall, {
            isNext: true,
            gap: {
              check: SetupHealthCheck.PolicyNotRun,
              finding: policyNotRun(),
            },
          }),
        ],
      }),
    );
    await draw();

    expect(
      screen.getByTestId("getting-started-task-on_call-gap"),
    ).toHaveTextContent(
      "On-call policy Primary pages nobody: no on-call rule and no monitor runs it.",
    );

    await press("getting-started-task-on_call");

    expect(navigatedTo()).toBe(
      routeOf(PageMap.INCIDENTS_SETTINGS_ON_CALL_RULES),
    );
  });

  test("an invitation nobody accepted says so, and the step opens Users", async () => {
    fetchMock.mockResolvedValue(
      answer({
        steps: [
          step(WelcomeStep.Team, {
            isNext: true,
            gap: { check: WELCOME_GAP_INVITATION_NOT_ACCEPTED, finding: null },
          }),
        ],
      }),
    );
    await draw();

    expect(
      screen.getByTestId("getting-started-task-team-gap"),
    ).toHaveTextContent(WELCOME_GAP_COPY.invitationNotAccepted);

    await press("getting-started-task-team");

    expect(navigatedTo()).toBe(routeOf(PageMap.USERS));
  });

  test("an offered step names its break too", async () => {
    fetchMock.mockResolvedValue(
      finished({
        moreSteps: [
          step(WelcomeStep.StatusPage, {
            gap: {
              check: SetupHealthCheck.StatusPageShowsNoMonitor,
              finding: emptyStatusPage(),
            },
          }),
        ],
      }),
    );
    await draw();

    expect(
      within(screen.getByTestId(WELCOME_MORE_TEST_ID)).getByTestId(
        "getting-started-task-status_page-gap",
      ),
    ).toHaveTextContent("Acme status");
  });

  test("the next step's own button says its fix, as Setup Health's does: Add Monitors", async () => {
    fetchMock.mockResolvedValue(
      answer({
        steps: [
          step(WelcomeStep.Monitor, { isDone: true }),
          step(WelcomeStep.StatusPage, {
            isNext: true,
            gap: {
              check: SetupHealthCheck.StatusPageShowsNoMonitor,
              finding: emptyStatusPage(),
            },
          }),
        ],
      }),
    );
    await draw();

    expect(screen.getByTestId("getting-started-start")).toHaveTextContent(
      "Add Monitors",
    );
    expect(screen.getByTestId("getting-started-start")).not.toHaveTextContent(
      WELCOME_CHECKLIST_COPY.startButton,
    );
  });

  test("a next step with nothing missing, or missing only an invitation, says Start", async () => {
    for (const gap of [
      null,
      { check: WELCOME_GAP_INVITATION_NOT_ACCEPTED, finding: null },
    ]) {
      fetchMock.mockResolvedValue(
        answer({ steps: [step(WelcomeStep.Team, { isNext: true, gap: gap })] }),
      );
      await draw();

      expect(screen.getByTestId("getting-started-start")).toHaveTextContent(
        WELCOME_CHECKLIST_COPY.startButton,
      );
      cleanup();
    }
  });

  test("a step that ends on a chevron keeps it beside its words at every width; Start goes under them on a phone", async () => {
    fetchMock.mockResolvedValue(
      answer({
        steps: [
          step(WelcomeStep.Monitor, { isNext: true }),
          step(WelcomeStep.OnCall),
        ],
      }),
    );
    await draw();

    const wordsOf: (key: string) => string = (key: string): string => {
      return (
        screen.getByTestId(`getting-started-task-${key}-description`)
          .parentElement?.parentElement?.className || ""
      );
    };

    expect(wordsOf("on_call")).toBe(STEP_WORDS_BESIDE_CHEVRON_CLASS_NAME);
    expect(wordsOf("monitor")).toBe(STEP_WORDS_OVER_ACTION_CLASS_NAME);
    expect(STEP_WORDS_BESIDE_CHEVRON_CLASS_NAME).not.toContain("flex-col");
    expect(STEP_WORDS_OVER_ACTION_CLASS_NAME).toContain("flex-col");
    expect(STEP_WORDS_OVER_ACTION_CLASS_NAME).toContain("sm:flex-row");
  });

  test("a step with nothing missing keeps its time and its own page", async () => {
    fetchMock.mockResolvedValue(
      answer({ steps: [step(WelcomeStep.StatusPage, { isNext: true })] }),
    );
    await draw();

    expect(
      screen.queryByTestId("getting-started-task-status_page-gap"),
    ).toBeNull();
    expect(
      screen.getByTestId("getting-started-task-status_page-minutes"),
    ).toBeVisible();

    await press("getting-started-task-status_page");

    expect(navigatedTo()).toBe(routeOf(PageMap.STATUS_PAGES_GUIDED_SETUP));
  });
});

describe("in the reader's language", () => {
  test("German: what else to set up, and a step's break in Setup health's German words", async () => {
    const de: Locale = readLocale("de");

    fetchMock.mockResolvedValue(
      finished({
        canBePagedByPhoneOrApp: false,
        moreSteps: [
          step(WelcomeStep.StatusPage, {
            gap: {
              check: SetupHealthCheck.StatusPageShowsNoMonitor,
              finding: emptyStatusPage(),
            },
          }),
        ],
      }),
    );
    await draw("de");

    const card: HTMLElement = screen.getByTestId(WELCOME_MORE_TEST_ID);

    expect(card).toHaveTextContent(de[WELCOME_MORE_COPY.title] as string);
    expect(card).toHaveTextContent(de[WELCOME_MORE_COPY.description] as string);
    expect(card).toHaveTextContent(de[WELCOME_MORE_COPY.phoneTitle] as string);
    expect(
      screen.getByTestId("getting-started-task-status_page-gap"),
    ).toHaveTextContent(
      (de[SETUP_HEALTH_WORDS.statusPageShowsNoMonitor] as string).replace(
        "{{statusPage}}",
        "Acme status",
      ),
    );
  });

  test("every new sentence is worded in every Dashboard language", () => {
    const keys: Array<string> = [
      WELCOME_MORE_COPY.title,
      WELCOME_MORE_COPY.description,
      WELCOME_MORE_COPY.phoneTitle,
      WELCOME_MORE_COPY.phoneDescription,
      WELCOME_GAP_COPY.invitationNotAccepted,
    ];

    for (const locale of [
      "de",
      "fr",
      "es",
      "it",
      "pt",
      "nl",
      "da",
      "no",
      "sv",
      "ru",
      "ja",
      "ko",
      "zh-CN",
      "zh-TW",
      "hi",
      "fa",
      "ar",
    ]) {
      const words: Locale = readLocale(locale);

      for (const key of keys) {
        expect({
          locale,
          key,
          worded: typeof words[key] === "string" && words[key] !== key,
        }).toEqual({
          locale,
          key,
          worded: true,
        });
      }
    }
  });
});
