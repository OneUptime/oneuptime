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
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * SECURITY EVENTS > PLAYBOOKS > AUTOMATIC RESPONSE (#10350), drawn: the
 * three ready policies, each with a clear on or off, its trial state and
 * summary, its guardrails in plain words and its time to block; what the
 * switch, Turn On and Turn On Without a Trial Run send; the notices for
 * nothing enforcing the blocklist and for the hour's blocks used up; a
 * reader who may not change policies; a project's own policy made and
 * deleted; and the words a policy's block puts on the Blocklist and on a
 * case's Response Plan.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

type CapturedForm = {
  title: string;
  submitButtonText?: string;
  error?: string;
  onSubmit: (values: Record<string, unknown>) => Promise<void> | void;
  formProps: {
    fields: Array<{
      field: Record<string, unknown>;
      title?: string;
      collapsibleSection?: unknown;
    }>;
  };
};

type CapturedConfirm = {
  title: string;
  description: React.ReactElement | string;
  submitButtonText?: string;
  onSubmit: () => Promise<void> | void;
};

type CapturedChart = {
  data: Array<{ seriesName: string; data: Array<{ x: Date; y: number }> }>;
};

let forms: Array<CapturedForm> = [];
let confirms: Array<CapturedConfirm> = [];
let charts: Array<CapturedChart> = [];

jest.mock("../../../UI/Components/FormModal/BasicFormModal", () => {
  return {
    __esModule: true,
    default: (props: CapturedForm) => {
      forms.push(props);
      return React.createElement(
        "div",
        { "data-testid": "form-modal" },
        React.createElement("h2", null, props.title),
        props.error
          ? React.createElement(
              "p",
              { "data-testid": "form-error" },
              props.error,
            )
          : null,
      );
    },
  };
});

jest.mock("../../../UI/Components/Modal/ConfirmModal", () => {
  return {
    __esModule: true,
    default: (props: CapturedConfirm) => {
      confirms.push(props);
      return React.createElement(
        "div",
        { "data-testid": "confirm-modal" },
        React.createElement("h2", null, props.title),
        props.description,
      );
    },
  };
});

jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    __esModule: true,
    default: (props: CapturedChart) => {
      charts.push(props);
      return React.createElement("div", { "data-testid": "line-chart" });
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/AutomaticResponse/AutomaticResponseApi",
  () => {
    return {
      __esModule: true,
      readAutomaticResponseOverview: jest.fn(),
      setAutomaticResponseMode: jest.fn(),
      createOwnPolicy: jest.fn(),
      updateOwnPolicy: jest.fn(),
      deleteOwnPolicy: jest.fn(),
      readDetectionRuleChoices: jest.fn(),
    };
  },
);

import SecurityAutomaticResponsePage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/AutomaticResponse";
import * as AutomaticResponseApi from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/AutomaticResponse/AutomaticResponseApi";
import { AUTOMATIC_RESPONSE_TEST_IDS } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/AutomaticResponse/AutomaticResponseCopy";
import { BLOCKLIST_TEST_IDS } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Blocklist/BlocklistCopy";
import { BlockAddedByCell } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Blocklist/BlocklistCells";
import { writeAddressBlockLine } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Response/SecurityCaseBlockStepModel";
import Project from "../../../Models/DatabaseModels/Project";
import SecurityAutomaticResponsePolicy from "../../../Models/DatabaseModels/SecurityAutomaticResponsePolicy";
import SecurityBlock from "../../../Models/DatabaseModels/SecurityBlock";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import {
  SecurityAutomaticResponseOverviewData,
  SecurityAutomaticResponseOverviewPolicy,
  SecurityAutomaticResponseRuleState,
} from "../../../Types/SecurityAutomaticResponse/SecurityAutomaticResponseOverview";
import {
  SECURITY_AUTOMATIC_RESPONSE_MESSAGES,
  SecurityAutomaticResponseMode,
  SecurityAutomaticResponsePolicyKind,
  SecurityAutomaticResponseTrialState,
} from "../../../Types/SecurityAutomaticResponse/SecurityAutomaticResponsePolicy";
import {
  SecurityBlockAction,
  SecurityBlockDuration,
  SecurityBlockSource,
  SecurityBlockState,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import Toast from "../../../UI/Utils/Toast";
import { getGlobalTranslator } from "../../../UI/Utils/TranslateTemplate";

type MockedFn = ReturnType<typeof jest.fn>;

const api: {
  readAutomaticResponseOverview: MockedFn;
  setAutomaticResponseMode: MockedFn;
  createOwnPolicy: MockedFn;
  updateOwnPolicy: MockedFn;
  deleteOwnPolicy: MockedFn;
  readDetectionRuleChoices: MockedFn;
} = AutomaticResponseApi as unknown as {
  readAutomaticResponseOverview: MockedFn;
  setAutomaticResponseMode: MockedFn;
  createOwnPolicy: MockedFn;
  updateOwnPolicy: MockedFn;
  deleteOwnPolicy: MockedFn;
  readDetectionRuleChoices: MockedFn;
};

const PROJECT_ID: ObjectID = new ObjectID(
  "71111111-1111-4111-8111-111111111111",
);
const SCANNERS_ID: string = "72222222-2222-4222-8222-222222222222";
const PASSWORDS_ID: string = "73333333-3333-4333-8333-333333333333";
const KNOWN_BAD_ID: string = "74444444-4444-4444-8444-444444444444";
const OWN_ID: string = "75555555-5555-4555-8555-555555555555";
const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

// Words as the reader reads them, with plain spaces.
function plain(text: string | null | undefined): string {
  return (text || "").replace(/\u00a0/g, " ");
}

function policy(
  values: Partial<SecurityAutomaticResponseOverviewPolicy>,
): SecurityAutomaticResponseOverviewPolicy {
  return {
    id: SCANNERS_ID,
    kind: SecurityAutomaticResponsePolicyKind.Scanners,
    name: "Scanners",
    description: "",
    mode: SecurityAutomaticResponseMode.Off,
    blockAction: SecurityBlockAction.Challenge,
    duration: SecurityBlockDuration.OneHour,
    match: {
      mitreTechniques: ["T1595", "T1190"],
      detectionRuleIds: [],
      requiresThreatIntel: false,
      requiresEveryRequestTurnedAway: true,
    },
    trialStartedAt: null,
    trialEndsAt: null,
    trialFinishedAt: null,
    trialSkippedAt: null,
    turnedOnAt: null,
    turnedOnBy: null,
    trialState: SecurityAutomaticResponseTrialState.NotStarted,
    trialDaysLeft: 0,
    trialSummary: null,
    timeToBlock: { count: 0, p50InSeconds: null, p95InSeconds: null, days: [] },
    lastWeek: { acted: 0, spared: 0 },
    rules: [],
    ...values,
  };
}

function readyPolicies(
  scanners: Partial<SecurityAutomaticResponseOverviewPolicy> = {},
): Array<SecurityAutomaticResponseOverviewPolicy> {
  return [
    policy({
      rules: [
        {
          libraryRuleId: "68d61e5d-79d2-4f41-8c1b-c017f6d0bd52",
          title: "Path traversal attempts",
          detectionRuleId: null,
          state: SecurityAutomaticResponseRuleState.Missing,
        },
      ],
      ...scanners,
    }),
    policy({
      id: PASSWORDS_ID,
      kind: SecurityAutomaticResponsePolicyKind.PasswordGuessing,
      name: "Password Guessing",
      blockAction: SecurityBlockAction.Block,
      match: {
        mitreTechniques: ["T1110"],
        detectionRuleIds: [],
        requiresThreatIntel: false,
        requiresEveryRequestTurnedAway: false,
      },
    }),
    policy({
      id: KNOWN_BAD_ID,
      kind: SecurityAutomaticResponsePolicyKind.KnownBadAddresses,
      name: "Known-Bad Addresses",
      blockAction: SecurityBlockAction.Block,
      duration: SecurityBlockDuration.OneDay,
      match: {
        mitreTechniques: [],
        detectionRuleIds: [],
        requiresThreatIntel: true,
        requiresEveryRequestTurnedAway: false,
      },
    }),
  ];
}

function overview(
  values: Partial<SecurityAutomaticResponseOverviewData> = {},
): SecurityAutomaticResponseOverviewData {
  return {
    policies: readyPolicies(),
    destinations: [
      { name: "Cloudflare", provider: "Cloudflare", canChallenge: true },
    ],
    destinationsCannotTell: false,
    blocksThisHour: 0,
    maxBlocksPerHour: 50,
    ...values,
  };
}

let mayChange: boolean;
let toastSuccess: MockedFn;
let toastError: MockedFn;

beforeEach(() => {
  forms = [];
  confirms = [];
  charts = [];
  mayChange = true;

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(PermissionGate, "check").mockImplementation(() => {
    return mayChange
      ? { isAllowed: true }
      : {
          isAllowed: false,
          disabledReason: "You do not have permission to edit policies.",
        };
  });
  toastSuccess = jest.spyOn(Toast, "success").mockImplementation(() => {
    return "";
  }) as unknown as MockedFn;
  toastError = jest.spyOn(Toast, "error").mockImplementation(() => {
    return "";
  }) as unknown as MockedFn;

  for (const mock of [
    api.readAutomaticResponseOverview,
    api.setAutomaticResponseMode,
    api.createOwnPolicy,
    api.updateOwnPolicy,
    api.deleteOwnPolicy,
    api.readDetectionRuleChoices,
  ]) {
    mock.mockReset();
  }

  api.readAutomaticResponseOverview.mockResolvedValue(overview() as never);
  api.setAutomaticResponseMode.mockResolvedValue(undefined as never);
  api.createOwnPolicy.mockResolvedValue(undefined as never);
  api.deleteOwnPolicy.mockResolvedValue(undefined as never);
  api.readDetectionRuleChoices.mockResolvedValue([] as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderPage(): Promise<void> {
  const project: Project = new Project();
  project.id = PROJECT_ID;

  await act(async () => {
    render(
      <MemoryRouter>
        <SecurityAutomaticResponsePage
          pageRoute={new Route("/dashboard/security-events/automatic-response")}
          currentProject={project}
          hasPaymentMethod={true}
        />
      </MemoryRouter>,
    );
  });
}

function cardOf(kind: SecurityAutomaticResponsePolicyKind): HTMLElement {
  const body: HTMLElement | undefined = screen
    .getAllByTestId(AUTOMATIC_RESPONSE_TEST_IDS.card)
    .find((element: HTMLElement): boolean => {
      return element.getAttribute("data-kind") === kind;
    });

  expect(body).toBeDefined();

  // The card around the body: its header holds the chip and the switch.
  const card: HTMLElement | null = body!.closest('[data-testid="card"]');
  expect(card).not.toBeNull();
  return card!;
}

function switchOf(kind: SecurityAutomaticResponsePolicyKind): HTMLElement {
  return within(cardOf(kind)).getByRole("switch");
}

describe("the three ready policies", () => {
  test("each is drawn Off, with its switch, what it acts on, its guardrails and no time to block yet", async () => {
    await renderPage();

    const cards: Array<HTMLElement> = screen.getAllByTestId(
      AUTOMATIC_RESPONSE_TEST_IDS.card,
    );

    expect(
      cards.map((card: HTMLElement): string | null => {
        return card.getAttribute("data-kind");
      }),
    ).toEqual([
      SecurityAutomaticResponsePolicyKind.Scanners,
      SecurityAutomaticResponsePolicyKind.PasswordGuessing,
      SecurityAutomaticResponsePolicyKind.KnownBadAddresses,
    ]);

    const scanners: HTMLElement = cardOf(
      SecurityAutomaticResponsePolicyKind.Scanners,
    );

    expect(scanners).toHaveTextContent("Scanners");
    expect(
      within(scanners).getByTestId(AUTOMATIC_RESPONSE_TEST_IDS.modeChip),
    ).toHaveTextContent("Off");
    expect(
      switchOf(SecurityAutomaticResponsePolicyKind.Scanners),
    ).toHaveAttribute("aria-checked", "false");
    expect(
      plain(
        within(scanners).getByTestId(AUTOMATIC_RESPONSE_TEST_IDS.stateLine)
          .textContent,
      ),
    ).toBe(
      "Turn it on to start a 7-day trial run. It records what it would have done, and touches no traffic.",
    );
    // Its rule, and that it is added as the policy is turned on.
    expect(
      within(scanners).getByTestId(AUTOMATIC_RESPONSE_TEST_IDS.rule),
    ).toHaveTextContent("Path traversal attempts");
    expect(
      within(scanners).getByTestId(AUTOMATIC_RESPONSE_TEST_IDS.rule),
    ).toHaveTextContent("Not added yet");
    expect(scanners).toHaveTextContent(
      "Only while every request from the address was turned away.",
    );
    // Its guardrails, in plain words.
    const guardrails: string = plain(
      within(scanners).getByTestId(AUTOMATIC_RESPONSE_TEST_IDS.guardrails)
        .textContent,
    );
    expect(guardrails).toContain(
      "Never touches your own or protected addresses.",
    );
    expect(guardrails).toContain(
      "Never touches an address a signed-in user used in the last 30 days.",
    );
    expect(guardrails).toContain(
      "Lasts 1 hour, then 24 hours and 7 days for an address that comes back within 30 days.",
    );
    expect(guardrails).toContain(
      "Stops after 50 automatic blocks an hour across your policies, and pages your security owners.",
    );
    expect(
      within(scanners).getByTestId(AUTOMATIC_RESPONSE_TEST_IDS.timeToBlock),
    ).toHaveTextContent("Shows here once the policy has blocked an address.");

    // Known-Bad Addresses acts on threat intel, and starts at 24 hours.
    const knownBad: HTMLElement = cardOf(
      SecurityAutomaticResponsePolicyKind.KnownBadAddresses,
    );
    expect(knownBad).toHaveTextContent(
      "Any detection about an address your threat intel lists.",
    );
    expect(plain(knownBad.textContent)).toContain(
      "Lasts 24 hours, then 7 days for an address that comes back within 30 days.",
    );
  });

  test("flipping an Off policy's switch starts its trial run, says so, and reads the page again", async () => {
    await renderPage();

    await act(async () => {
      fireEvent.click(switchOf(SecurityAutomaticResponsePolicyKind.Scanners));
    });

    expect(api.setAutomaticResponseMode).toHaveBeenCalledWith({
      policyId: SCANNERS_ID,
      mode: SecurityAutomaticResponseMode.TrialRun,
    });
    expect(plain(toastSuccess.mock.calls[0]?.[0] as string)).toBe(
      "Scanners started its 7-day trial run.",
    );
    expect(api.readAutomaticResponseOverview).toHaveBeenCalledTimes(2);
  });

  test("a policy in its trial run counts its days and what it would have done so far; its switch turns it off", async () => {
    api.readAutomaticResponseOverview.mockResolvedValue(
      overview({
        policies: readyPolicies({
          mode: SecurityAutomaticResponseMode.TrialRun,
          trialState: SecurityAutomaticResponseTrialState.Running,
          trialDaysLeft: 4,
          trialSummary: {
            wouldActOn: 12,
            wouldHaveLifted: 0,
            sparedSignedIn: 1,
            sparedProtected: 0,
            sparedCannotTell: 0,
            wouldHaveStopped: 0,
          },
        }),
      }) as never,
    );
    await renderPage();

    const scanners: HTMLElement = cardOf(
      SecurityAutomaticResponsePolicyKind.Scanners,
    );

    expect(
      within(scanners).getByTestId(AUTOMATIC_RESPONSE_TEST_IDS.modeChip),
    ).toHaveTextContent("Trial Run");
    expect(
      plain(
        within(scanners).getByTestId(AUTOMATIC_RESPONSE_TEST_IDS.stateLine)
          .textContent,
      ),
    ).toBe(
      "Trial run: 4 days left. It records what it would have done, and touches no traffic.",
    );
    expect(
      plain(
        within(scanners).getByTestId(AUTOMATIC_RESPONSE_TEST_IDS.summary)
          .textContent,
      ),
    ).toBe(
      "So far it would have challenged 12 addresses. It left 1 address alone because signed-in users had used it. None were yours.",
    );

    await act(async () => {
      fireEvent.click(switchOf(SecurityAutomaticResponsePolicyKind.Scanners));
    });

    expect(api.setAutomaticResponseMode).toHaveBeenCalledWith({
      policyId: SCANNERS_ID,
      mode: SecurityAutomaticResponseMode.Off,
    });
    expect(plain(toastSuccess.mock.calls[0]?.[0] as string)).toBe(
      "Scanners is off.",
    );
  });

  test("a finished trial says what it would have done and asks to be turned on; Turn On turns it on", async () => {
    api.readAutomaticResponseOverview.mockResolvedValue(
      overview({
        policies: readyPolicies({
          mode: SecurityAutomaticResponseMode.TrialRun,
          trialState: SecurityAutomaticResponseTrialState.Finished,
          trialStartedAt: new Date(Date.now() - 8 * DAY_IN_MS),
          trialEndsAt: new Date(Date.now() - DAY_IN_MS),
          trialSummary: {
            wouldActOn: 1283,
            wouldHaveLifted: 0,
            sparedSignedIn: 0,
            sparedProtected: 0,
            sparedCannotTell: 0,
            wouldHaveStopped: 0,
          },
        }),
      }) as never,
    );
    await renderPage();

    const scanners: HTMLElement = cardOf(
      SecurityAutomaticResponsePolicyKind.Scanners,
    );

    expect(
      within(scanners).getByTestId(AUTOMATIC_RESPONSE_TEST_IDS.modeChip),
    ).toHaveTextContent("Trial Finished");
    expect(
      plain(
        within(scanners).getByTestId(AUTOMATIC_RESPONSE_TEST_IDS.summary)
          .textContent,
      ),
    ).toBe(
      "In 7 days this would have challenged 1,283 addresses. None had signed-in users, and none were yours. Turn it on?",
    );
    // A finished trial needs no skipping.
    expect(
      within(scanners).queryByTestId(
        AUTOMATIC_RESPONSE_TEST_IDS.turnOnWithoutTrial,
      ),
    ).toBeNull();

    await act(async () => {
      fireEvent.click(
        within(scanners).getByTestId(AUTOMATIC_RESPONSE_TEST_IDS.turnOn),
      );
    });

    expect(api.setAutomaticResponseMode).toHaveBeenCalledWith({
      policyId: SCANNERS_ID,
      mode: SecurityAutomaticResponseMode.On,
    });
    expect(plain(toastSuccess.mock.calls[0]?.[0] as string)).toBe(
      "Scanners is on.",
    );
  });

  test("Turn On Without a Trial Run is folded under More settings, and asks first", async () => {
    await renderPage();

    const scanners: HTMLElement = cardOf(
      SecurityAutomaticResponsePolicyKind.Scanners,
    );

    const fold: HTMLElement = within(scanners).getByRole("button", {
      name: /More settings/,
    });

    // Folded until asked for.
    expect(fold).toHaveAttribute("aria-expanded", "false");

    await act(async () => {
      fireEvent.click(fold);
    });

    expect(fold).toHaveAttribute("aria-expanded", "true");
    await act(async () => {
      fireEvent.click(
        within(scanners).getByTestId(
          AUTOMATIC_RESPONSE_TEST_IDS.turnOnWithoutTrial,
        ),
      );
    });

    const confirm: CapturedConfirm = confirms[confirms.length - 1]!;
    expect(confirm.title).toBe("Turn On Without a Trial Run");
    expect(plain(confirm.description as string)).toBe(
      "Scanners starts acting now, without the week that shows what it would have done. Its guardrails still apply.",
    );
    expect(api.setAutomaticResponseMode).not.toHaveBeenCalled();

    await act(async () => {
      await confirm.onSubmit();
    });

    expect(api.setAutomaticResponseMode).toHaveBeenCalledWith({
      policyId: SCANNERS_ID,
      mode: SecurityAutomaticResponseMode.On,
    });
  });

  test("a policy that is on says since when, by whom and what it did, with its time to block", async () => {
    api.readAutomaticResponseOverview.mockResolvedValue(
      overview({
        policies: readyPolicies({
          mode: SecurityAutomaticResponseMode.On,
          trialState: SecurityAutomaticResponseTrialState.Finished,
          trialFinishedAt: new Date("2026-11-15T09:00:00.000Z"),
          turnedOnAt: new Date("2026-11-15T10:00:00.000Z"),
          turnedOnBy: "Jane Doe",
          lastWeek: { acted: 35, spared: 2 },
          timeToBlock: {
            count: 3,
            p50InSeconds: 41,
            p95InSeconds: 95,
            days: [
              {
                day: "2026-11-20",
                count: 0,
                p50InSeconds: null,
                p95InSeconds: null,
              },
              {
                day: "2026-11-21",
                count: 3,
                p50InSeconds: 41,
                p95InSeconds: 95,
              },
            ],
          },
        }),
      }) as never,
    );
    await renderPage();

    const scanners: HTMLElement = cardOf(
      SecurityAutomaticResponsePolicyKind.Scanners,
    );

    expect(
      within(scanners).getByTestId(AUTOMATIC_RESPONSE_TEST_IDS.modeChip),
    ).toHaveTextContent("On");
    expect(
      switchOf(SecurityAutomaticResponsePolicyKind.Scanners),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      plain(
        within(scanners).getByTestId(AUTOMATIC_RESPONSE_TEST_IDS.summary)
          .textContent,
      ),
    ).toBe(
      "In the last 7 days it challenged 35 addresses. Its guardrails left 2 addresses alone.",
    );
    expect(
      plain(
        within(scanners).getByTestId(AUTOMATIC_RESPONSE_TEST_IDS.timeToBlock)
          .textContent,
      ),
    ).toContain("P50 41s, P95 1m 35s, over 3 blocks.");

    // The chart: P50 and P95, a point on the day that had blocks only.
    const chart: CapturedChart = charts[charts.length - 1]!;
    expect(
      chart.data.map(
        (series: {
          seriesName: string;
          data: Array<unknown>;
        }): [string, number] => {
          return [series.seriesName, series.data.length];
        },
      ),
    ).toEqual([
      ["P50", 1],
      ["P95", 1],
    ]);
    expect(chart.data[1]!.data[0]!.y).toBe(95);
  });

  test("a challenge is held as a block where a destination cannot challenge, and the page says where", async () => {
    api.readAutomaticResponseOverview.mockResolvedValue(
      overview({
        destinations: [
          { name: "Cloudflare", provider: "Cloudflare", canChallenge: true },
          { name: "FortiGate feed", provider: "Feed", canChallenge: false },
        ],
      }) as never,
    );
    await renderPage();

    expect(
      within(cardOf(SecurityAutomaticResponsePolicyKind.Scanners)).getByTestId(
        AUTOMATIC_RESPONSE_TEST_IDS.heldAsBlock,
      ),
    ).toHaveTextContent(
      "FortiGate feed cannot challenge, so this policy blocks the address there for the same time.",
    );
    // A policy that blocks blocks everywhere: nothing to say.
    expect(
      within(
        cardOf(SecurityAutomaticResponsePolicyKind.PasswordGuessing),
      ).queryByTestId(AUTOMATIC_RESPONSE_TEST_IDS.heldAsBlock),
    ).toBeNull();
  });
});

describe("what the page says above the policies, only when it is so", () => {
  test("nothing above them while a destination enforces the blocklist and blocks are left this hour", async () => {
    await renderPage();

    expect(screen.queryByTestId(BLOCKLIST_TEST_IDS.notice)).toBeNull();
    expect(
      screen.queryByTestId(AUTOMATIC_RESPONSE_TEST_IDS.limitNotice),
    ).toBeNull();
  });

  test("nothing enforces the blocklist, and the hour's automatic blocks are used up", async () => {
    api.readAutomaticResponseOverview.mockResolvedValue(
      overview({ destinations: [], blocksThisHour: 50 }) as never,
    );
    await renderPage();

    expect(screen.getByTestId(BLOCKLIST_TEST_IDS.notice)).toHaveTextContent(
      "Nothing enforces these blocks yet.",
    );
    expect(
      plain(
        screen.getByTestId(AUTOMATIC_RESPONSE_TEST_IDS.limitNotice).textContent,
      ),
    ).toContain(
      "Your policies made 50 automatic blocks in the last hour, so they stopped and paged your security owners.",
    );
  });

  test("the read fails: the page says so", async () => {
    api.readAutomaticResponseOverview.mockRejectedValue(
      new Error("down") as never,
    );
    await renderPage();

    expect(
      screen.getByTestId(AUTOMATIC_RESPONSE_TEST_IDS.readFailed),
    ).toHaveTextContent(
      "OneUptime could not read your automatic response policies. Try again in a minute.",
    );
  });
});

describe("who may change them", () => {
  test("a reader who may not sees every policy, and why its switch is locked; nobody offers a policy of their own", async () => {
    mayChange = false;
    await renderPage();

    expect(
      screen.getAllByTestId(AUTOMATIC_RESPONSE_TEST_IDS.card),
    ).toHaveLength(3);
    expect(
      switchOf(SecurityAutomaticResponsePolicyKind.Scanners),
    ).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByText("Your Own Policy")).toBeNull();

    await act(async () => {
      fireEvent.click(switchOf(SecurityAutomaticResponsePolicyKind.Scanners));
    });
    expect(api.setAutomaticResponseMode).not.toHaveBeenCalled();
  });

  test("a switch the server refuses says why, and changes nothing", async () => {
    api.setAutomaticResponseMode.mockRejectedValue(
      new Error(SECURITY_AUTOMATIC_RESPONSE_MESSAGES.turnOnTakesAdmin) as never,
    );
    await renderPage();

    await act(async () => {
      fireEvent.click(switchOf(SecurityAutomaticResponsePolicyKind.Scanners));
    });

    expect(toastError).toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

describe("a project's own policy", () => {
  test("Create Policy refuses a policy that acts on nothing, and makes one that acts on a technique, Off", async () => {
    await renderPage();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Create Policy/ }));
    });

    const form: CapturedForm = forms[forms.length - 1]!;
    expect(form.title).toBe("Create Policy");
    // Two fields in sight, and the rest - the action too, Block unless chosen - folded under More fields.
    expect(
      form.formProps.fields
        .filter((field: { collapsibleSection?: unknown }): boolean => {
          return !field.collapsibleSection;
        })
        .map((field: { title?: string }): string | undefined => {
          return field.title;
        }),
    ).toEqual(["Name", "ATT&CK Techniques"]);

    await act(async () => {
      await form.onSubmit({
        name: "Bots",
        blockAction: SecurityBlockAction.Block,
      });
    });

    expect(api.createOwnPolicy).not.toHaveBeenCalled();
    expect(screen.getByTestId("form-error")).toHaveTextContent(
      SECURITY_AUTOMATIC_RESPONSE_MESSAGES.matchNamesNothing,
    );

    await act(async () => {
      await forms[forms.length - 1]!.onSubmit({
        name: " Bots ",
        mitreTechniques: "t1110, T1110.003",
        blockAction: SecurityBlockAction.Challenge,
        duration: SecurityBlockDuration.SevenDays,
      });
    });

    expect(api.createOwnPolicy).toHaveBeenCalledWith({
      name: "Bots",
      description: "",
      blockAction: SecurityBlockAction.Challenge,
      duration: SecurityBlockDuration.SevenDays,
      match: {
        mitreTechniques: ["T1110", "T1110.003"],
        detectionRuleIds: [],
        requiresThreatIntel: false,
        requiresEveryRequestTurnedAway: false,
      },
    });
    expect(plain(toastSuccess.mock.calls[0]?.[0] as string)).toBe(
      "Bots saved.",
    );
  });

  test("its card is edited and deleted from its header; Delete names it first", async () => {
    api.readAutomaticResponseOverview.mockResolvedValue(
      overview({
        policies: [
          ...readyPolicies(),
          policy({
            id: OWN_ID,
            kind: SecurityAutomaticResponsePolicyKind.Custom,
            name: "Bots",
            blockAction: SecurityBlockAction.Block,
            match: {
              mitreTechniques: ["T1110"],
              detectionRuleIds: [],
              requiresThreatIntel: true,
              requiresEveryRequestTurnedAway: false,
            },
          }),
        ],
      }) as never,
    );
    await renderPage();

    const own: HTMLElement = cardOf(SecurityAutomaticResponsePolicyKind.Custom);

    expect(own).toHaveTextContent("Bots");
    expect(own).toHaveTextContent("Detections with these ATT&CK techniques:");
    expect(own).toHaveTextContent("T1110");
    // A ready policy has neither.
    expect(
      within(cardOf(SecurityAutomaticResponsePolicyKind.Scanners)).queryByRole(
        "button",
        { name: /Delete Policy/ },
      ),
    ).toBeNull();

    await act(async () => {
      fireEvent.click(
        within(own).getByRole("button", { name: /Delete Policy/ }),
      );
    });

    const confirm: CapturedConfirm = confirms[confirms.length - 1]!;
    expect(screen.getByTestId("confirm-modal")).toHaveTextContent(
      "Are you sure you want to delete Bots?",
    );

    await act(async () => {
      await confirm.onSubmit();
    });

    expect(api.deleteOwnPolicy).toHaveBeenCalledWith(OWN_ID);
  });
});

describe("a policy's block, elsewhere", () => {
  test("the Blocklist says which policy made it", () => {
    const made: SecurityBlock = new SecurityBlock();
    made.value = "35.205.11.131";
    made.state = SecurityBlockState.Active;
    made.source = SecurityBlockSource.AutomaticResponse;
    const scanners: SecurityAutomaticResponsePolicy =
      new SecurityAutomaticResponsePolicy();
    scanners.name = "Scanners";
    scanners.kind = SecurityAutomaticResponsePolicyKind.Scanners;
    made.securityAutomaticResponsePolicy = scanners;

    const { container } = render(<BlockAddedByCell block={made} />);

    expect(container).toHaveTextContent("Scanners policy");
  });

  test("a case's Response Plan says the policy made it, and how long after the address's first request", () => {
    const line: string = writeAddressBlockLine({
      block: {
        id: "b1",
        value: "35.205.11.131",
        action: SecurityBlockAction.Challenge,
        createdAt: new Date("2026-11-22T10:42:00.000Z"),
        expiresAt: new Date("2026-11-22T11:42:00.000Z"),
        source: SecurityBlockSource.AutomaticResponse,
        policyName: "Scanners",
        policyKind: SecurityAutomaticResponsePolicyKind.Scanners,
        timeToBlockInSeconds: 41,
        enforcedAt: ["Cloudflare"],
        enforcedSince: new Date("2026-11-22T10:42:00.000Z"),
        pendingAt: [],
        notAppliedAt: [],
      },
      translator: getGlobalTranslator(),
      now: new Date("2026-11-22T10:43:00.000Z"),
    });

    expect(plain(line)).toMatch(
      /^Challenged at Cloudflare .+ by the Scanners policy, 41s after its first request, until .+\.$/,
    );
  });
});
