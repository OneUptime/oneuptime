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
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE CASE'S ONE AI CARD, drawn: every stage a case's triage can be in, the
 * one action each offers, and nothing at all with the project's AI off.
 * The server's answers are the shapes POST /security-case/:caseId/ai-triage
 * sends (SecurityCaseTriageStatus); the case is the page's own row with its
 * ai* columns.
 */

configure({ asyncUtilTimeout: 10000 });
jest.setTimeout(60000);

const getAiTriageMock: MockFunction = getJestMockFunction();
const startAiTriageMock: MockFunction = getJestMockFunction();
const loadRowsMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();

let permissionsForTest: Array<string> = ["ProjectOwner"];

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

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: [...permissionsForTest] };
      },
    },
  };
});

/*
 * The report's Markdown, drawn as its words with a citation chip for every
 * [C#] the card can resolve: the real viewer loads lazily and parses with
 * react-markdown, which the tests stub.
 */
jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  type Renderers = {
    renderCitation?: (citationId: string) => React.ReactElement | null;
  };

  return {
    __esModule: true,
    default: (props: {
      text: string;
      inlineReferences?: Renderers | undefined;
    }): React.ReactElement => {
      const parts: Array<React.ReactNode> = [];
      let rest: string = props.text;
      let key: number = 0;

      for (;;) {
        const open: number = rest.indexOf("[C");
        const close: number = open === -1 ? -1 : rest.indexOf("]", open);

        if (open === -1 || close === -1) {
          parts.push(rest);
          break;
        }

        parts.push(rest.slice(0, open));

        const citationId: string = rest.slice(open + 1, close);
        const chip: React.ReactElement | null | undefined =
          props.inlineReferences?.renderCitation?.(citationId);

        parts.push(
          chip
            ? React.cloneElement(chip, { key: `chip-${key++}` })
            : rest.slice(open, close + 1),
        );
        rest = rest.slice(close + 1);
      }

      return React.createElement(
        "div",
        { "data-testid": "report-markdown" },
        ...parts,
      );
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseApi",
  () => {
    return {
      __esModule: true,
      default: {
        getAiTriage: (...args: Array<unknown>) => {
          return getAiTriageMock(...args);
        },
        startAiTriage: (...args: Array<unknown>) => {
          return startAiTriageMock(...args);
        },
        loadAiTriageEvidenceRows: (...args: Array<unknown>) => {
          return loadRowsMock(...args);
        },
      },
    };
  },
);

import SecurityCaseAiCard, {
  ComponentProps as CardProps,
  SECURITY_CASE_AI_POLL_INTERVAL_MS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseAiCard";
import {
  SecurityCaseAiCopy,
  SecurityCaseTriageStatusView,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseAiTriage";
import EventName from "../../../../App/FeatureSet/Dashboard/src/Utils/EventName";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import SecurityPlaybook from "../../../Models/DatabaseModels/SecurityPlaybook";
import SecurityPlaybookRun from "../../../Models/DatabaseModels/SecurityPlaybookRun";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import SecurityPlaybookRunStatus from "../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import ObjectID from "../../../Types/ObjectID";
import SecurityCaseAiVerdict from "../../../Types/SecurityCase/SecurityCaseAiVerdict";
import SecurityCasePriority from "../../../Models/DatabaseModels/SecurityCasePriority";
import SecurityCasePriorityLevel from "../../../Types/SecurityCase/SecurityCasePriorityLevel";
import {
  buildDefaultTestPriorities,
  testPriorityId,
} from "../../Helpers/SecurityCaseValues";
import GlobalEvents from "../../../UI/Utils/GlobalEvents";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import { SECURITY_CASE_TRIAGE_INJECTION_LEAD_PREFIX } from "../../../Utils/AI/InvestigationReport";

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const CASE_ID: string = "20000000-0000-4000-8000-000000000042";
const RUN_ID: string = "30000000-0000-4000-8000-000000000001";
const PLAYBOOK_ID: string = "40000000-0000-4000-8000-000000000001";

// The project's priorities: a new project's, the critical one renamed.
const PRIORITIES: Array<SecurityCasePriority> = buildDefaultTestPriorities();
PRIORITIES[0]!.name = "Sev 1";

const REPORT: string = [
  "## 🧠 AI — Security Case Triage",
  "",
  "**Summary**",
  "A brute force against web-1 that ended in a success [C1].",
  "",
  "**Assessment**",
  "Likely malicious: the address is known-bad [C1].",
  "",
  "**Evidence checked**",
  "- **[C1]** Threat intel lookup of 1 value: 1 known-bad — 1 row(s)",
].join("\n");

// The runner's own heads-up on a steered case (getPromptInjectionReportLead).
const RUNNER_HEADS_UP: string = [
  SECURITY_CASE_TRIAGE_INJECTION_LEAD_PREFIX,
  " - a sign of an attempt to steer the triage. OneUptime AI treated it as data and leaves the call to a person.",
].join("");

function status(
  overrides: Partial<SecurityCaseTriageStatusView> = {},
): SecurityCaseTriageStatusView {
  return {
    run: null,
    steps: [],
    isReportPending: false,
    finishedWithoutReport: false,
    evidence: [],
    notStartedCode: null,
    isAutomaticTriageOn: true,
    ...overrides,
  };
}

function run(value: AIRunStatus): SecurityCaseTriageStatusView["run"] {
  return { id: RUN_ID, status: value, toolCallCount: 3, totalTokens: 900 };
}

function securityCase(overrides: Partial<SecurityCase> = {}): SecurityCase {
  const row: SecurityCase = new SecurityCase();
  row._id = CASE_ID;
  row.securityCasePriorityId = testPriorityId(SecurityCasePriorityLevel.Medium);
  Object.assign(row, overrides);
  return row;
}

function triagedCase(overrides: Partial<SecurityCase> = {}): SecurityCase {
  return securityCase({
    aiVerdict: SecurityCaseAiVerdict.LikelyMalicious,
    aiSuggestedSecurityCasePriorityId: testPriorityId(
      SecurityCasePriorityLevel.Critical,
    ),
    aiSuggestedPlaybookId: new ObjectID(PLAYBOOK_ID),
    aiTriageReport: REPORT,
    aiTriagedAt: new Date(Date.now() - 5 * 60 * 1000),
    aiTriagePromptInjectionSuspected: false,
    ...overrides,
  } as Partial<SecurityCase>);
}

// The answer to the card's read of the suggested playbook's latest run here.
function runsOnCase(statuses: Array<SecurityPlaybookRunStatus>): {
  data: Array<SecurityPlaybookRun>;
  count: number;
  skip: number;
  limit: number;
} {
  return {
    data: statuses.map((value: SecurityPlaybookRunStatus) => {
      const row: SecurityPlaybookRun = new SecurityPlaybookRun();
      row._id = RUN_ID;
      row.status = value;
      return row;
    }),
    count: statuses.length,
    skip: 0,
    limit: 1,
  };
}

// A triaged case whose suggested playbook the reader may read.
function withPlaybookNamed(name: string): void {
  getItemMock.mockImplementation(async () => {
    const model: SecurityPlaybook = new SecurityPlaybook();
    model.name = name;
    model.isEnabled = true;
    return model;
  });
}

interface Handlers {
  onTriaged: ReturnType<typeof jest.fn>;
  onSetPriority: ReturnType<typeof jest.fn>;
  onRunPlaybook: ReturnType<typeof jest.fn>;
}

function draw(
  row: SecurityCase,
  overrides: Partial<CardProps> = {},
): Handlers & {
  container: HTMLElement;
  // Draws the card again with these props over the first ones.
  redraw: (next: Partial<CardProps>) => void;
} {
  const handlers: Handlers = {
    onTriaged: jest.fn(),
    onSetPriority: jest.fn(),
    onRunPlaybook: jest.fn(),
  };

  const card: (props: Partial<CardProps>) => React.ReactElement = (
    props: Partial<CardProps>,
  ): React.ReactElement => {
    return (
      <MemoryRouter>
        <SecurityCaseAiCard
          securityCase={row}
          priorities={PRIORITIES}
          onTriaged={handlers.onTriaged as unknown as () => void}
          onSetPriority={
            handlers.onSetPriority as unknown as (
              priority: SecurityCasePriority,
            ) => void
          }
          onRunPlaybook={
            handlers.onRunPlaybook as unknown as (id: ObjectID) => void
          }
          {...props}
        />
      </MemoryRouter>
    );
  };

  const { container, rerender } = render(card(overrides));

  return {
    ...handlers,
    container,
    redraw: (next: Partial<CardProps>): void => {
      rerender(card({ ...overrides, ...next }));
    },
  };
}

// A click, and whatever answer it waits on, inside one act.
async function clickAndSettle(element: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  });
}

beforeEach(() => {
  permissionsForTest = ["ProjectOwner"];
  getAiTriageMock.mockReset();
  startAiTriageMock.mockReset();
  loadRowsMock.mockReset();
  getItemMock.mockReset();

  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest
    .spyOn(ProjectUtil, "getCurrentProject")
    .mockReturnValue({ enableAi: true } as never);
  jest.spyOn(ModelAPI, "getItem").mockImplementation(((
    ...args: Array<unknown>
  ) => {
    return getItemMock(...args);
  }) as never);
  getItemMock.mockResolvedValue(null);
  // The suggested playbook's runs on the case: none, unless a test says so.
  getListMock.mockReset();
  jest.spyOn(ModelAPI, "getList").mockImplementation(((
    ...args: Array<unknown>
  ) => {
    return getListMock(...args);
  }) as never);
  getListMock.mockResolvedValue(runsOnCase([]));
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("with the project's AI off", () => {
  test("the card is not drawn, and nothing is asked", async () => {
    jest
      .spyOn(ProjectUtil, "getCurrentProject")
      .mockReturnValue({ enableAi: false } as never);

    const { container } = draw(triagedCase());

    await act(async () => {
      await Promise.resolve();
    });

    expect(container).toBeEmptyDOMElement();
    expect(getAiTriageMock).not.toHaveBeenCalled();
  });
});

describe("not triaged yet", () => {
  test("says what a triage does, and offers Triage with AI", async () => {
    getAiTriageMock.mockResolvedValue(status());

    draw(securityCase());

    expect(
      await screen.findByTestId("security-case-ai-triage-button"),
    ).toBeEnabled();
    expect(
      screen.getByText(SecurityCaseAiCopy.notTriagedTitle),
    ).toBeInTheDocument();
    expect(
      screen.getByText(SecurityCaseAiCopy.notTriagedDescription),
    ).toBeInTheDocument();
    expect(getAiTriageMock).toHaveBeenCalledWith(new ObjectID(CASE_ID));
    // New cases are triaged on their own: no word about the switch.
    expect(
      screen.queryByTestId("security-case-ai-automatic-off"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Not triaged")).toBeInTheDocument();
  });

  test("with new cases not triaged on their own, a quiet link says where to turn it on", async () => {
    getAiTriageMock.mockResolvedValue(
      status({
        isAutomaticTriageOn: false,
        notStartedCode: "automatic_triage_disabled",
      }),
    );

    draw(securityCase());

    const note: HTMLElement = await screen.findByTestId(
      "security-case-ai-automatic-off",
    );

    expect(note).toHaveTextContent(SecurityCaseAiCopy.automaticOffNote);
    expect(within(note).getByRole("link")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/security-events/ai/settings`,
    );
    // A person's request ignores the switch.
    expect(screen.getByTestId("security-case-ai-triage-button")).toBeEnabled();
  });

  test("what stops a triage is said, with where to fix it, and no button", async () => {
    getAiTriageMock.mockResolvedValue(
      status({ notStartedCode: "provider_missing" }),
    );

    draw(securityCase());

    const reason: HTMLElement = await screen.findByTestId(
      "security-case-ai-reason",
    );

    expect(reason).toHaveTextContent(
      SecurityCaseAiCopy.reasons.provider_missing,
    );
    expect(within(reason).getByRole("link")).toHaveTextContent(
      "Set up an LLM provider",
    );
    expect(
      screen.queryByTestId("security-case-ai-triage-button"),
    ).not.toBeInTheDocument();
  });

  test("where to fix it goes only to who may; everyone else is told who can", async () => {
    permissionsForTest = ["SecurityMember"];
    getAiTriageMock.mockResolvedValue(
      status({ notStartedCode: "provider_missing" }),
    );

    draw(securityCase());

    const reason: HTMLElement = await screen.findByTestId(
      "security-case-ai-reason",
    );

    expect(within(reason).queryByRole("link")).not.toBeInTheDocument();
    expect(
      within(reason).getByTestId("security-case-ai-reason-who-can"),
    ).toHaveTextContent("A project administrator can review these settings.");
  });

  test("the daily limit's fix goes to who may change the limits", async () => {
    getAiTriageMock.mockResolvedValue(
      status({ notStartedCode: "project_daily_limit_reached" }),
    );

    draw(securityCase());

    const reason: HTMLElement = await screen.findByTestId(
      "security-case-ai-reason",
    );

    expect(within(reason).getByRole("link")).toHaveTextContent(
      "Go to Project Settings → AI → AI Features",
    );
  });

  test("a role that cannot work cases sees the button greyed, and who can beside it", async () => {
    permissionsForTest = ["SecurityViewer"];
    getAiTriageMock.mockResolvedValue(
      status({
        isAutomaticTriageOn: false,
        notStartedCode: "automatic_triage_disabled",
      }),
    );

    draw(securityCase());

    expect(
      await screen.findByTestId("security-case-ai-triage-button"),
    ).toBeDisabled();
    // Said on the card, not only on hover.
    expect(
      screen.getByTestId("security-case-ai-who-can-triage"),
    ).toHaveTextContent(SecurityCaseAiCopy.whoCanTriage);
    // Where the switch is is for who may triage.
    expect(
      screen.queryByTestId("security-case-ai-automatic-off"),
    ).not.toBeInTheDocument();
  });

  test("who may triage is not told who can", async () => {
    getAiTriageMock.mockResolvedValue(status());

    draw(securityCase());

    expect(
      await screen.findByTestId("security-case-ai-triage-button"),
    ).toBeEnabled();
    expect(
      screen.queryByTestId("security-case-ai-who-can-triage"),
    ).not.toBeInTheDocument();
  });

  test("before the reader's permissions arrive, no button and no one is told they cannot", async () => {
    // An empty snapshot: the permissions have not landed yet.
    permissionsForTest = [];
    getAiTriageMock.mockResolvedValue(status());

    draw(securityCase());

    expect(
      await screen.findByText(SecurityCaseAiCopy.notTriagedTitle),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(getAiTriageMock).toHaveBeenCalled();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(
      screen.queryByTestId("security-case-ai-triage-button"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("security-case-ai-who-can-triage"),
    ).not.toBeInTheDocument();
  });

  test("a status that cannot be read says so", async () => {
    getAiTriageMock.mockRejectedValue(new Error("Network down"));

    draw(securityCase());

    expect(
      await screen.findByTestId("security-case-ai-load-error"),
    ).toBeInTheDocument();
  });
});

describe("Triage with AI", () => {
  test("starts a triage, shows each check as it runs, and reads the case again when it settles", async () => {
    getAiTriageMock.mockResolvedValueOnce(status()).mockResolvedValueOnce(
      status({
        run: run(AIRunStatus.Running),
        steps: [
          { toolName: "query_security_cases", failed: false, rowCount: 2 },
          { toolName: "lookup_threat_intel", failed: true },
        ],
      }),
    );
    startAiTriageMock.mockResolvedValue(RUN_ID);

    const handlers: Handlers = draw(securityCase());

    fireEvent.click(
      await screen.findByTestId("security-case-ai-triage-button"),
    );

    expect(
      await screen.findByTestId("security-case-ai-triaging"),
    ).toBeVisible();
    expect(startAiTriageMock).toHaveBeenCalledWith(new ObjectID(CASE_ID));
    expect(screen.getByText(SecurityCaseAiCopy.triagingTitle)).toBeVisible();

    const steps: HTMLElement = screen.getByTestId("security-case-ai-steps");

    expect(within(steps).getByText("Read security cases")).toBeVisible();
    expect(within(steps).getByText("Checked threat intel")).toBeVisible();
    expect(screen.getByText("Triaging")).toBeInTheDocument();

    // The run settles: the card asks again and the page reads the case.
    getAiTriageMock.mockResolvedValue(
      status({ run: run(AIRunStatus.Completed) }),
    );

    await waitFor(
      () => {
        expect(handlers.onTriaged).toHaveBeenCalled();
      },
      { timeout: SECURITY_CASE_AI_POLL_INTERVAL_MS * 3 },
    );
  });

  test("keeps saying Triaging while the finished run's report is still being written", async () => {
    getAiTriageMock.mockResolvedValue(
      status({ run: run(AIRunStatus.Completed), isReportPending: true }),
    );

    draw(securityCase());

    expect(
      await screen.findByTestId("security-case-ai-triaging"),
    ).toBeVisible();
    expect(
      screen.queryByTestId("security-case-ai-not-triaged"),
    ).not.toBeInTheDocument();
  });

  test("a start the server refuses is said, and can be put away", async () => {
    getAiTriageMock.mockResolvedValue(status());
    startAiTriageMock.mockRejectedValue(
      new Error("The project is out of AI credits."),
    );

    draw(securityCase());

    fireEvent.click(
      await screen.findByTestId("security-case-ai-triage-button"),
    );

    expect(
      await screen.findByTestId("security-case-ai-start-error"),
    ).toBeInTheDocument();
  });
});

describe("triaged", () => {
  test("the read, what it suggests, the cited report and the time", async () => {
    getAiTriageMock.mockResolvedValue(
      status({ run: run(AIRunStatus.Completed) }),
    );
    getItemMock.mockImplementation(async (options: unknown) => {
      const model: SecurityPlaybook = new SecurityPlaybook();
      model.name = "Contain Host";
      model.isEnabled = true;
      expect((options as { id: ObjectID }).id.toString()).toBe(PLAYBOOK_ID);
      return model;
    });

    const handlers: Handlers = draw(triagedCase());

    expect(await screen.findByTestId("security-case-ai-triaged")).toBeVisible();
    expect(screen.getByText("Likely Malicious")).toBeVisible();
    expect(
      screen.getByText(
        "The evidence points at malicious or unauthorized activity.",
      ),
    ).toBeVisible();
    expect(screen.getByText("Triaged")).toBeInTheDocument();

    // Priority: the project's, as it names it, one click away.
    expect(
      screen.getByTestId("security-case-ai-suggested-priority"),
    ).toHaveTextContent("Sev 1");
    fireEvent.click(screen.getByTestId("security-case-ai-set-priority"));
    expect(handlers.onSetPriority).toHaveBeenCalledTimes(1);
    expect(
      (
        handlers.onSetPriority.mock.calls[0]![0] as SecurityCasePriority
      ).id?.toString(),
    ).toBe(testPriorityId(SecurityCasePriorityLevel.Critical).toString());

    // Playbook: one click opens Run Playbook with it picked.
    const playbookRow: HTMLElement = await screen.findByTestId(
      "security-case-ai-suggested-playbook",
    );
    expect(playbookRow).toHaveTextContent("Contain Host");
    fireEvent.click(screen.getByTestId("security-case-ai-run-playbook"));
    expect(handlers.onRunPlaybook).toHaveBeenCalledTimes(1);
    expect(
      (handlers.onRunPlaybook.mock.calls[0]![0] as ObjectID).toString(),
    ).toBe(PLAYBOOK_ID);

    // The report, section by section.
    expect(await screen.findByText("Assessment")).toBeVisible();
    expect(
      screen.getByTestId("security-case-ai-triaged-when"),
    ).toHaveTextContent(/^Triaged /);
  });

  test("a Security Viewer reads the read, with no Triage again or Set priority to press", async () => {
    permissionsForTest = ["SecurityViewer"];
    getAiTriageMock.mockResolvedValue(
      status({ run: run(AIRunStatus.Completed) }),
    );

    draw(triagedCase());

    expect(await screen.findByTestId("security-case-ai-triaged")).toBeVisible();
    expect(
      await screen.findByTestId("security-case-ai-suggested-priority"),
    ).toBeVisible();
    expect(screen.getByTestId("security-case-ai-ask")).toBeEnabled();
    expect(
      screen.queryByTestId("security-case-ai-triage-button"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("security-case-ai-set-priority"),
    ).not.toBeInTheDocument();
    // Nothing to explain where nothing is offered.
    expect(
      screen.queryByTestId("security-case-ai-who-can-triage"),
    ).not.toBeInTheDocument();
  });

  test("no Set priority when the case is already at the suggested one", async () => {
    getAiTriageMock.mockResolvedValue(
      status({ run: run(AIRunStatus.Completed) }),
    );

    draw(
      triagedCase({
        securityCasePriorityId: testPriorityId(
          SecurityCasePriorityLevel.Critical,
        ),
      }),
    );

    expect(
      await screen.findByTestId("security-case-ai-suggested-priority"),
    ).toBeVisible();
    expect(
      screen.queryByTestId("security-case-ai-set-priority"),
    ).not.toBeInTheDocument();
  });

  test("a suggested priority the project has since deleted is not offered", async () => {
    getAiTriageMock.mockResolvedValue(
      status({ run: run(AIRunStatus.Completed) }),
    );

    draw(
      triagedCase({
        aiSuggestedSecurityCasePriorityId: new ObjectID(
          "c1000000-0000-4000-8000-0000000000ff",
        ),
      } as Partial<SecurityCase>),
    );

    expect(await screen.findByTestId("security-case-ai-triaged")).toBeVisible();
    expect(
      screen.queryByTestId("security-case-ai-suggested-priority"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("security-case-ai-set-priority"),
    ).not.toBeInTheDocument();
  });

  test("a suggested playbook that is off, or not the reader's to read, is not offered", async () => {
    getAiTriageMock.mockResolvedValue(
      status({ run: run(AIRunStatus.Completed) }),
    );
    getItemMock.mockImplementation(async () => {
      const model: SecurityPlaybook = new SecurityPlaybook();
      model.name = "Old Playbook";
      model.isEnabled = false;
      return model;
    });

    draw(triagedCase());

    expect(await screen.findByTestId("security-case-ai-triaged")).toBeVisible();
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      screen.queryByTestId("security-case-ai-suggested-playbook"),
    ).not.toBeInTheDocument();
  });

  test("a suggested playbook already running on the case shows its run, not a second Run playbook", async () => {
    getAiTriageMock.mockResolvedValue(
      status({ run: run(AIRunStatus.Completed) }),
    );
    withPlaybookNamed("Contain Host");
    getListMock.mockResolvedValue(
      runsOnCase([SecurityPlaybookRunStatus.WaitingForApproval]),
    );

    draw(triagedCase());

    const running: HTMLElement = await screen.findByTestId(
      "security-case-ai-suggested-playbook-run",
    );

    expect(running).toHaveTextContent("Waiting for Approval");
    expect(
      screen.getByTestId("security-case-ai-suggested-playbook"),
    ).toHaveTextContent("Contain Host");
    expect(
      screen.queryByTestId("security-case-ai-run-playbook"),
    ).not.toBeInTheDocument();

    // The case's own runs of that playbook, the latest only.
    const options: {
      query: Record<string, unknown>;
      sort: Record<string, unknown>;
      limit: number;
    } = getListMock.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      sort: Record<string, unknown>;
      limit: number;
    };

    expect(String(options.query["securityCaseId"])).toBe(CASE_ID);
    expect(String(options.query["securityPlaybookId"])).toBe(PLAYBOOK_ID);
    expect(options.sort).toEqual({ createdAt: SortOrder.Descending });
    expect(options.limit).toBe(1);
  });

  test("a finished run leaves Run playbook, and the page's refresh reads the run again", async () => {
    getAiTriageMock.mockResolvedValue(
      status({ run: run(AIRunStatus.Completed) }),
    );
    withPlaybookNamed("Contain Host");
    getListMock.mockResolvedValue(
      runsOnCase([SecurityPlaybookRunStatus.Failed]),
    );

    const { redraw } = draw(triagedCase(), { refreshToggle: "first" });

    expect(
      await screen.findByTestId("security-case-ai-run-playbook"),
    ).toBeEnabled();
    expect(
      screen.queryByTestId("security-case-ai-suggested-playbook-run"),
    ).not.toBeInTheDocument();

    // Someone ran it: the page says runs moved on, and the card reads again.
    getListMock.mockResolvedValue(
      runsOnCase([SecurityPlaybookRunStatus.Running]),
    );
    redraw({ refreshToggle: "second" });

    expect(
      await screen.findByTestId("security-case-ai-suggested-playbook-run"),
    ).toHaveTextContent("Running");
    expect(
      screen.queryByTestId("security-case-ai-run-playbook"),
    ).not.toBeInTheDocument();
  });

  test("a run that cannot be read leaves Run playbook, as before it was read", async () => {
    getAiTriageMock.mockResolvedValue(
      status({ run: run(AIRunStatus.Completed) }),
    );
    withPlaybookNamed("Contain Host");
    getListMock.mockRejectedValue(new Error("Network down"));

    draw(triagedCase());

    expect(
      await screen.findByTestId("security-case-ai-run-playbook"),
    ).toBeEnabled();
  });

  test("no suggested playbook, no read of its runs", async () => {
    getAiTriageMock.mockResolvedValue(
      status({ run: run(AIRunStatus.Completed) }),
    );

    // A read that suggests a priority and no playbook.
    draw(
      securityCase({
        aiVerdict: SecurityCaseAiVerdict.LikelyMalicious,
        aiSuggestedSecurityCasePriorityId: testPriorityId(
          SecurityCasePriorityLevel.Critical,
        ),
        aiTriageReport: REPORT,
        aiTriagedAt: new Date(Date.now() - 5 * 60 * 1000),
      } as Partial<SecurityCase>),
    );

    expect(await screen.findByTestId("security-case-ai-triaged")).toBeVisible();
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      screen.queryByTestId("security-case-ai-suggested-playbook"),
    ).not.toBeInTheDocument();
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("text written to steer an AI is said first", async () => {
    getAiTriageMock.mockResolvedValue(
      status({ run: run(AIRunStatus.Completed) }),
    );

    draw(
      triagedCase({
        aiVerdict: SecurityCaseAiVerdict.Inconclusive,
        aiTriagePromptInjectionSuspected: true,
      } as Partial<SecurityCase>),
    );

    const notice: HTMLElement = await screen.findByTestId(
      "security-case-ai-prompt-injection",
    );

    // A short title, and what OneUptime AI did about it under it.
    expect(
      within(notice).getByText(SecurityCaseAiCopy.promptInjectionTitle),
    ).toBeVisible();
    expect(
      within(notice).getByText(SecurityCaseAiCopy.promptInjectionDescription),
    ).toBeVisible();
    expect(screen.getByText("Inconclusive")).toBeVisible();
  });

  test("the report drawn leaves out the runner's own heads-up, which the notice says first", async () => {
    getAiTriageMock.mockResolvedValue(
      status({ run: run(AIRunStatus.Completed) }),
    );

    const lines: Array<string> = REPORT.split("\n");
    // As the runner posts it: the heads-up right under the heading.
    lines.splice(1, 0, "", RUNNER_HEADS_UP);

    draw(
      triagedCase({
        aiVerdict: SecurityCaseAiVerdict.Inconclusive,
        aiTriagePromptInjectionSuspected: true,
        aiTriageReport: lines.join("\n"),
      } as Partial<SecurityCase>),
    );

    await screen.findByTestId("security-case-ai-prompt-injection");

    const drawn: string = screen
      .getAllByTestId("report-markdown")
      .map((element: HTMLElement): string => {
        return element.textContent || "";
      })
      .join("\n");

    expect(drawn).toContain("A brute force against web-1");
    expect(drawn).not.toContain("Heads up:");
    // Said once, by the card, in the reader's language.
    expect(
      screen.getAllByText(/reads like instructions to an AI/i),
    ).toHaveLength(1);
  });

  test("a heads-up the model wrote further down stays in the report", async () => {
    getAiTriageMock.mockResolvedValue(
      status({ run: run(AIRunStatus.Completed) }),
    );

    const body: string = REPORT.split("\n**Evidence checked**")[0] || "";

    draw(
      triagedCase({
        aiTriageReport: [body, "", RUNNER_HEADS_UP].join("\n"),
        aiTriagePromptInjectionSuspected: true,
      } as Partial<SecurityCase>),
    );

    await screen.findByTestId("security-case-ai-prompt-injection");

    expect(
      screen
        .getAllByTestId("report-markdown")
        .some((element: HTMLElement): boolean => {
          return (element.textContent || "").includes("Heads up:");
        }),
    ).toBe(true);
  });

  test("a later triage that did not finish is said under the read it left", async () => {
    getAiTriageMock.mockResolvedValue(status({ run: run(AIRunStatus.Error) }));

    draw(triagedCase());

    const notice: HTMLElement = await screen.findByTestId(
      "security-case-ai-last-run-failed",
    );

    expect(notice).toHaveTextContent(SecurityCaseAiCopy.lastRunFailed);
    // A run that recorded no reason: the sentence alone, no empty line.
    expect(
      screen.queryByTestId("security-case-ai-last-run-failed-why"),
    ).not.toBeInTheDocument();
    expect(notice.querySelectorAll("p")).toHaveLength(1);
  });

  test("a later triage that stopped says why, as a failed one does", async () => {
    getAiTriageMock.mockResolvedValue(
      status({
        run: {
          ...run(AIRunStatus.Error)!,
          errorMessage: "The LLM provider did not answer in time.",
        },
      }),
    );

    draw(triagedCase());

    const notice: HTMLElement = await screen.findByTestId(
      "security-case-ai-last-run-failed",
    );

    expect(notice).toHaveTextContent(SecurityCaseAiCopy.lastRunFailed);
    expect(
      within(notice).getByTestId("security-case-ai-last-run-failed-why"),
    ).toHaveTextContent("The LLM provider did not answer in time.");
    // The read it left stays, and Triage again is one click.
    expect(screen.getByTestId("security-case-ai-triaged")).toBeVisible();
    expect(screen.getByTestId("security-case-ai-triage-button")).toBeEnabled();
  });

  test("Ask about this case opens Ask AI with a question ready", async () => {
    getAiTriageMock.mockResolvedValue(
      status({ run: run(AIRunStatus.Completed) }),
    );
    const dispatch: ReturnType<typeof jest.spyOn> = jest.spyOn(
      GlobalEvents,
      "dispatchEvent",
    );

    draw(triagedCase());

    fireEvent.click(await screen.findByTestId("security-case-ai-ask"));

    expect(dispatch).toHaveBeenCalledWith(EventName.AI_CHAT_TOGGLE, {
      prompt: SecurityCaseAiCopy.askPrompt,
    });
  });

  test("Triage again starts a new triage", async () => {
    getAiTriageMock.mockResolvedValue(
      status({ run: run(AIRunStatus.Completed) }),
    );
    startAiTriageMock.mockResolvedValue(RUN_ID);

    draw(triagedCase());

    const again: HTMLElement = await screen.findByTestId(
      "security-case-ai-triage-button",
    );
    expect(again).toHaveTextContent(SecurityCaseAiCopy.triageAgainButton);

    // Offered once the card knows nothing stops a triage.
    await waitFor(() => {
      expect(again).toBeEnabled();
    });

    fireEvent.click(again);

    await waitFor(() => {
      expect(startAiTriageMock).toHaveBeenCalledWith(new ObjectID(CASE_ID));
    });
  });

  /*
   * The project cannot triage now (here: its daily AI limit): the read stays,
   * and where Triage again would sit - a button that could not start - the
   * card says what stops it and where to fix it.
   */
  test("what stops another triage is said under the read, in place of Triage again", async () => {
    getAiTriageMock.mockResolvedValue(
      status({
        run: run(AIRunStatus.Completed),
        notStartedCode: "project_daily_limit_reached",
      }),
    );

    draw(triagedCase());

    const reason: HTMLElement = await screen.findByTestId(
      "security-case-ai-reason",
    );

    expect(screen.getByTestId("security-case-ai-triaged")).toContainElement(
      reason,
    );
    expect(reason).toHaveTextContent(
      SecurityCaseAiCopy.reasons.project_daily_limit_reached,
    );
    expect(within(reason).getByRole("link")).toBeVisible();
    expect(
      screen.queryByTestId("security-case-ai-triage-button"),
    ).not.toBeInTheDocument();
    // Asking about the read still works.
    expect(screen.getByTestId("security-case-ai-ask")).toBeEnabled();
    expect(
      screen.getByTestId("security-case-ai-triaged-when"),
    ).toBeInTheDocument();
  });

  test("the automatic switch being off stops nobody's Triage again", async () => {
    getAiTriageMock.mockResolvedValue(
      status({
        run: run(AIRunStatus.Completed),
        notStartedCode: "automatic_triage_disabled",
        isAutomaticTriageOn: false,
      }),
    );

    draw(triagedCase());

    const again: HTMLElement = await screen.findByTestId(
      "security-case-ai-triage-button",
    );

    await waitFor(() => {
      expect(again).toBeEnabled();
    });
    expect(
      screen.queryByTestId("security-case-ai-reason"),
    ).not.toBeInTheDocument();
  });

  test("a citation opens the check behind it, and its rows are re-run on the case's own route", async () => {
    getAiTriageMock.mockResolvedValue(
      status({
        run: run(AIRunStatus.Completed),
        evidence: [
          {
            citationId: "C1",
            toolName: "lookup_threat_intel",
            label: "Threat intel lookup of 1 value: 1 known-bad",
            rowCount: 1,
            queryArguments: { values: ["203.0.113.9"] },
            canLoadRows: true,
          },
        ],
      }),
    );
    loadRowsMock.mockResolvedValue({
      data: {
        citationId: "C1",
        toolName: "lookup_threat_intel",
        label: "Threat intel lookup",
        rowCount: 1,
        isTruncated: false,
        executedAt: new Date().toISOString(),
        isPinnedToInvestigationTime: false,
        text: "value: 203.0.113.9, match: known-bad",
      },
    });

    draw(triagedCase());

    const details: HTMLElement = await screen.findByTestId(
      "investigation-details",
    );
    expect(within(details).getByText("Evidence checked")).toBeInTheDocument();

    /*
     * Until the run's status arrives the card can only show the report's own
     * Evidence checked lines; once it has, C1 is a query that expands (still
     * inside the collapsed section, so hidden from the reader).
     */
    const query: HTMLElement = await within(details).findByRole("button", {
      name: /Threat intel lookup of 1 value/,
      hidden: true,
    });
    expect(query).toHaveAttribute("aria-expanded", "false");
    expect(query).not.toBeVisible();

    // [C1] is cited twice: in the summary and in the assessment.
    const chips: Array<HTMLElement> = screen.getAllByRole("button", {
      name: /Citation C1/,
    });
    expect(chips).toHaveLength(2);
    await clickAndSettle(chips[0]!);

    expect(loadRowsMock).toHaveBeenCalledWith({
      caseId: new ObjectID(CASE_ID),
      runId: RUN_ID,
      citationId: "C1",
    });
    expect(loadRowsMock).toHaveBeenCalledTimes(1);

    // The section opened on the query, and its re-run rows are shown.
    expect(query).toBeVisible();
    expect(query).toHaveAttribute("aria-expanded", "true");
    expect(
      within(details).getByText(/203\.0\.113\.9, match: known-bad/),
    ).toBeVisible();

    // The second chip lands on the same query without re-running it.
    await clickAndSettle(chips[1]!);
    expect(query).toHaveAttribute("aria-expanded", "true");
    expect(loadRowsMock).toHaveBeenCalledTimes(1);
  });
});

describe("failed", () => {
  test("says the triage did not finish, and offers Try again", async () => {
    getAiTriageMock.mockResolvedValue(
      status({ run: { ...run(AIRunStatus.Error)!, errorMessage: "Boom" } }),
    );

    draw(securityCase());

    expect(await screen.findByTestId("security-case-ai-failed")).toBeVisible();
    expect(
      screen.getByText(SecurityCaseAiCopy.failedTitle),
    ).toBeInTheDocument();
    // Why it stopped, as the server recorded it - as the incident card says it.
    expect(
      screen.getByTestId("security-case-ai-failed-notice"),
    ).toHaveTextContent("Boom");
    expect(
      screen.queryByText(SecurityCaseAiCopy.failedDescription),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("security-case-ai-triage-button"),
    ).toHaveTextContent(SecurityCaseAiCopy.tryAgainButton);
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  test("a run that settled without a report has failed too", async () => {
    getAiTriageMock.mockResolvedValue(
      status({
        run: run(AIRunStatus.Completed),
        finishedWithoutReport: true,
      }),
    );

    draw(securityCase());

    expect(await screen.findByTestId("security-case-ai-failed")).toBeVisible();
    // No reason recorded: the card's own sentence.
    expect(
      screen.getByTestId("security-case-ai-failed-notice"),
    ).toHaveTextContent(SecurityCaseAiCopy.failedDescription);
  });

  test("a Security Viewer sees Try again greyed, and who can beside it", async () => {
    permissionsForTest = ["SecurityViewer"];
    getAiTriageMock.mockResolvedValue(
      status({ run: { ...run(AIRunStatus.Error)!, errorMessage: "Boom" } }),
    );

    draw(securityCase());

    const tryAgain: HTMLElement = await screen.findByTestId(
      "security-case-ai-triage-button",
    );

    expect(tryAgain).toHaveTextContent(SecurityCaseAiCopy.tryAgainButton);
    expect(tryAgain).toBeDisabled();
    expect(
      screen.getByTestId("security-case-ai-who-can-triage"),
    ).toHaveTextContent(SecurityCaseAiCopy.whoCanTriage);
  });
});
