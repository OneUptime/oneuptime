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
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A case's Response Plan, drawn (#9557): what to do about the case now, in
 * the order a response goes - confirm it, contain it, fix what let it
 * happen, close it - each step's button pressing what OneUptime can do, a
 * step OneUptime cannot do said to be done outside it with its value one
 * click from the clipboard, and a tick that makes the step one of the
 * case's tasks, keyed by the step.
 */

const getListMock: MockFunction = getJestMockFunction();
const createMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();
const exceptionModalProps: Array<Record<string, unknown>> = [];

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
        i18n: { language: "en" },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      create: (...args: Array<unknown>) => {
        return createMock(...args);
      },
      updateById: (...args: Array<unknown>) => {
        return updateByIdMock(...args);
      },
    },
  };
});

// What the project's blocklist holds, for the case's values (#10346): nothing connected, unless a test says.
const readCaseBlocklistMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Blocklist/BlocklistApi",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Blocklist/BlocklistApi",
    ) as Record<string, unknown>;

    return {
      __esModule: true,
      ...actual,
      readCaseBlocklist: (...args: Array<unknown>) => {
        return readCaseBlocklistMock(...args);
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/RuleExceptions/AddRuleExceptionModal",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>): React.ReactElement => {
        exceptionModalProps.push(props);
        return React.createElement("div", { "data-testid": "exception-modal" });
      },
    };
  },
);

import SecurityCaseResponsePlanCard, {
  getBlockableValues,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Response/SecurityCaseResponsePlanCard";
import { readResponseBlocklist } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Blocklist/BlocklistApi";
import SecurityBlock from "../../../Models/DatabaseModels/SecurityBlock";
import {
  SecurityBlockAction,
  SecurityBlockIndicatorType,
  SecurityBlockReach,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import { SecurityBlockDestinationProvider } from "../../../Types/SecurityBlocklist/SecurityBlockEnforcement";
import { SecurityBlockHolder } from "../../../Types/SecurityBlocklist/SecurityBlockHolders";
import Toast from "../../../UI/Utils/Toast";
import {
  RESPONSE_STEP_CHECK_SELECT,
  RESPONSE_TASK_SELECT,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Response/SecurityCaseResponseData";
import { SECURITY_CASE_RESPONSE_TEST_IDS } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Response/SecurityCaseResponseCopy";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import SecurityCaseTask from "../../../Models/DatabaseModels/SecurityCaseTask";
import SecurityCaseStepCheck from "../../../Models/DatabaseModels/SecurityCaseStepCheck";
import { JSONObject } from "../../../Types/JSON";
import { SecurityCaseStepCheckSentence } from "../../../Types/SecurityCase/SecurityCaseStepCheckEvidence";
import SecurityCaseStepCheckState from "../../../Types/SecurityCase/SecurityCaseStepCheckState";
import {
  CHECK_BLOCK_NOT_PROOF,
  CHECK_BLOCK_QUIET_SINCE,
  CHECK_BLOCK_REGRESSED,
  CHECK_CANNOT_NO_TELEMETRY,
  CHECK_INCIDENT_NOT_NEEDED,
  CHECK_REQUESTS_ALL_TURNED_AWAY,
} from "../../../Utils/SecurityCase/ResponsePlan/StepCheckWords";
import SecurityPlaybook from "../../../Models/DatabaseModels/SecurityPlaybook";
import SecurityPlaybookRun from "../../../Models/DatabaseModels/SecurityPlaybookRun";
import User from "../../../Models/DatabaseModels/User";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import SecurityCaseAiVerdict from "../../../Types/SecurityCase/SecurityCaseAiVerdict";
import {
  SecurityCaseMatchBasis,
  SecurityCaseMatchesJson,
} from "../../../Types/SecurityCase/SecurityCaseMatches";
import SecurityCaseStage from "../../../Types/SecurityCase/SecurityCaseStage";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import { REFRESH_SIDEBAR_COUNT_EVENT } from "../../../UI/Components/SideMenu/CountModelSideMenuItem";
import GlobalEvents from "../../../UI/Utils/GlobalEvents";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import Realtime from "../../../UI/Utils/Realtime";
import UserUtil from "../../../UI/Utils/User";
import {
  buildDefaultTestPriorities,
  buildDefaultTestStatuses,
  testStatusId,
} from "../../Helpers/SecurityCaseValues";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const CASE_ID: string = "22222222-2222-4222-8222-222222222222";
const RULE_ID: string = "44444444-4444-4444-8444-444444444444";
const ME: string = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
// Where a step OneUptime cannot tell about sends the reader (StepCheck's STEP_CHECK_DOCS_PATH).
const STEP_CHECK_DOCS_PATH: string =
  "/telemetry/security-cases#how-oneuptime-checks-a-step";

let permissions: Array<Permission>;
let tasks: Array<SecurityCaseTask>;
let playbooks: Array<SecurityPlaybook>;
let runs: Array<SecurityPlaybookRun>;
let dispatched: Array<string>;
let colleagueChanges: Array<() => void>;

interface Handlers {
  onAssignToMe: MockFunction;
  onRunPlaybook: MockFunction;
  onDeclareIncident: MockFunction;
  onMarkContained: MockFunction;
  onCloseCase: MockFunction;
}

let handlers: Handlers;

function buildCase(fields: Partial<SecurityCase> = {}): SecurityCase {
  const securityCase: SecurityCase = new SecurityCase();
  securityCase._id = CASE_ID;
  securityCase.securityCaseStatusId = testStatusId(SecurityCaseStage.New);
  securityCase.entities = [
    { type: SecurityEntityType.IpAddress, value: "35.196.249.14" },
  ] as never;
  securityCase.mitreTactics = ["TA0001"];
  securityCase.mitreTechniques = ["T1190"];
  Object.assign(securityCase, fields);
  return securityCase;
}

const MATCHES: SecurityCaseMatchesJson = {
  detections: [
    {
      id: "66666666-6666-4666-8666-666666666666",
      source: "Detection Rule",
      title: "Path traversal attempts — 35.196.249.14",
      severity: "Medium",
      groupValue: "35.196.249.14",
      ruleName: "Path traversal attempts",
      eventCount: 12,
      fireCount: 1,
      firstSeenAt: "2026-11-17T19:28:00.000Z",
      lastSeenAt: "2026-11-17T19:28:00.000Z",
      sampleMessage: "",
      isOpening: true,
      rule: {
        id: RULE_ID,
        name: "Path traversal attempts",
        description: "",
        isEnabled: true,
        isRealTime: false,
        isCorrelation: false,
        threshold: 3,
        groupByField: "principalIp",
        distinctCountField: "",
        windowInMinutes: 5,
        sigmaRuleYaml: "",
        falsePositives: ["Vulnerability scanners your team runs"],
        references: [],
        lookFor: [],
        responseSteps: [],
      },
      threatIntelFeedId: "",
      securityEventConnectionId: "",
      basis: SecurityCaseMatchBasis.RuleCondition,
      windowStart: "2026-11-17T19:22:00.000Z",
      windowEnd: "2026-11-17T19:29:00.000Z",
      events: [],
      isKept: false,
      keptPastRetentionCount: 0,
      hiddenEventCount: 0,
      matchedEventCount: 12,
      outcomes: { Rejected: 12 },
    },
  ],
  detectionCount: 1,
  unreadableSources: [],
  failedSources: [],
};

function draw(securityCase: SecurityCase = buildCase()): void {
  render(
    <MemoryRouter>
      <SecurityCaseResponsePlanCard
        caseId={new ObjectID(CASE_ID)}
        securityCase={securityCase}
        values={{
          priorities: buildDefaultTestPriorities(),
          statuses: buildDefaultTestStatuses(),
        }}
        matches={MATCHES}
        refreshToggle="first"
        isWorking={false}
        onAssignToMe={handlers.onAssignToMe as unknown as () => void}
        onRunPlaybook={
          handlers.onRunPlaybook as unknown as (id: ObjectID) => void
        }
        onDeclareIncident={handlers.onDeclareIncident as unknown as () => void}
        onMarkContained={handlers.onMarkContained as unknown as () => void}
        onCloseCase={handlers.onCloseCase as unknown as () => void}
      />
    </MemoryRouter>,
  );
}

async function drawn(securityCase?: SecurityCase): Promise<void> {
  draw(securityCase);
  await screen.findAllByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.step);
}

function stepOf(key: string): HTMLElement {
  const step: HTMLElement | undefined = screen
    .queryAllByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.step)
    .find((candidate: HTMLElement): boolean => {
      return candidate.getAttribute("data-step-key") === key;
    });

  expect({ key, drawn: Boolean(step) }).toEqual({ key, drawn: true });

  return step!;
}

function actionOf(key: string): HTMLElement {
  return within(stepOf(key)).getByTestId(
    SECURITY_CASE_RESPONSE_TEST_IDS.action,
  );
}

beforeEach(() => {
  PermissionGate.clearPermissionPropsCache();
  permissions = [Permission.SecurityMember];
  tasks = [];
  playbooks = [];
  runs = [];
  dispatched = [];
  colleagueChanges = [];
  exceptionModalProps.length = 0;
  handlers = {
    onAssignToMe: getJestMockFunction(),
    onRunPlaybook: getJestMockFunction(),
    onDeclareIncident: getJestMockFunction(),
    onMarkContained: getJestMockFunction(),
    onCloseCase: getJestMockFunction(),
  };

  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest.spyOn(PermissionUtil, "getAllPermissions").mockImplementation(() => {
    return permissions;
  });
  jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(false);
  jest.spyOn(UserUtil, "getUserId").mockReturnValue(new ObjectID(ME));
  jest.spyOn(OneUptimeDate, "fromNow").mockReturnValue("5 minutes ago");
  jest.spyOn(Realtime, "listenToModelEvent").mockImplementation(((
    _event: unknown,
    onEvent: () => void,
  ) => {
    colleagueChanges.push(onEvent);
    return (): void => {};
  }) as never);
  jest.spyOn(GlobalEvents, "dispatchEvent").mockImplementation(((
    name: string,
  ): void => {
    dispatched.push(name);
  }) as never);

  getListMock.mockReset();
  getListMock.mockImplementation(async (args: unknown) => {
    const modelType: unknown = (args as { modelType: unknown }).modelType;
    const data: Array<unknown> =
      modelType === SecurityCaseTask
        ? tasks
        : modelType === SecurityPlaybook
          ? playbooks
          : modelType === SecurityPlaybookRun
            ? runs
            : [];

    return { data, count: data.length };
  });
  createMock.mockReset();
  createMock.mockResolvedValue({} as never);
  updateByIdMock.mockReset();
  updateByIdMock.mockResolvedValue({} as never);
  readCaseBlocklistMock.mockReset();
  readCaseBlocklistMock.mockResolvedValue({ holders: [], blocks: [] } as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the plan", () => {
  test("reads the case's tasks, the project's playbooks that are on and the case's runs", async () => {
    await drawn();

    expect(getListMock).toHaveBeenCalledWith(
      expect.objectContaining({
        modelType: SecurityCaseTask,
        query: { securityCaseId: new ObjectID(CASE_ID) },
        select: RESPONSE_TASK_SELECT,
      }),
    );
    expect(getListMock).toHaveBeenCalledWith(
      expect.objectContaining({
        modelType: SecurityPlaybook,
        query: { isEnabled: true },
      }),
    );
    expect(getListMock).toHaveBeenCalledWith(
      expect.objectContaining({
        modelType: SecurityPlaybookRun,
        query: { securityCaseId: new ObjectID(CASE_ID) },
      }),
    );
  });

  test("goes in the order a response goes, each section's steps under its heading, and counts what is done", async () => {
    await drawn();

    expect(
      screen
        .getAllByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.phase)
        .map((phase: HTMLElement): string => {
          return phase.getAttribute("data-phase") || "";
        }),
    ).toEqual(["Confirm", "Contain", "Fix", "Close"]);
    expect(screen.getByText("Confirm it is real")).toBeInTheDocument();
    expect(screen.getByText("Fix what let it happen")).toBeInTheDocument();
    expect(
      screen.getByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.progress),
    ).toHaveTextContent("0 of 8 done");
    expect(
      within(stepOf("contain:block-ip:35.196.249.14")).getByTestId(
        SECURITY_CASE_RESPONSE_TEST_IDS.stepText,
      ),
    ).toHaveTextContent(
      "Block 35.196.249.14 at your firewall, WAF or load balancer.",
    );
  });

  test("a step OneUptime cannot do says so, with its value one click from the clipboard", async () => {
    await drawn();

    const block: HTMLElement = stepOf("contain:block-ip:35.196.249.14");

    expect(
      within(block).getByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.byHand),
    ).toHaveTextContent("Outside OneUptime");
    expect(within(block).getByText("Copy")).toBeInTheDocument();
    expect(
      within(block).queryByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.action),
    ).toBeNull();
  });

  test("ruling out a false positive quotes what the rule says it also fires on", async () => {
    await drawn();

    const falsePositive: HTMLElement = stepOf(
      `confirm:false-positive:${RULE_ID}`,
    );

    expect(
      within(falsePositive).getByTestId(
        SECURITY_CASE_RESPONSE_TEST_IDS.falsePositives,
      ),
    ).toHaveTextContent("Vulnerability scanners your team runs");
  });
});

describe("ticking a step off", () => {
  test("makes it one of the case's tasks, done, keyed by the step, in the words it was read in", async () => {
    await drawn();

    await act(async () => {
      fireEvent.click(
        within(stepOf("contain:block-ip:35.196.249.14")).getByTestId(
          SECURITY_CASE_RESPONSE_TEST_IDS.checkbox,
        ),
      );
    });

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });

    const created: SecurityCaseTask = (
      createMock.mock.calls[0]![0] as { model: SecurityCaseTask }
    ).model;

    expect(created.securityCaseId?.toString()).toBe(CASE_ID);
    expect(created.projectId?.toString()).toBe(PROJECT_ID);
    expect(created.isDone).toBe(true);
    expect(created.responseStepKey).toBe("contain:block-ip:35.196.249.14");
    expect(created.title).toBe(
      "Block 35.196.249.14 at your firewall, WAF or load balancer.",
    );
    // The side menu counts open tasks again, and the plan reads its tasks again.
    expect(dispatched).toContain(REFRESH_SIDEBAR_COUNT_EVENT);
  });

  test("a step done by a task says who ticked it off, and unticking opens the same task again", async () => {
    const done: SecurityCaseTask = new SecurityCaseTask();
    done._id = "33333333-3333-4333-8333-000000000001";
    done.title = "Block 35.196.249.14 at your firewall, WAF or load balancer.";
    done.responseStepKey = "contain:block-ip:35.196.249.14";
    done.isDone = true;
    done.doneAt = new Date("2026-11-17T20:00:00.000Z");
    const kim: User = new User();
    kim.name = "Kim Morgan" as never;
    done.doneByUser = kim;
    tasks = [done];

    await drawn();

    const block: HTMLElement = stepOf("contain:block-ip:35.196.249.14");

    expect(block).toHaveAttribute("data-done", "true");
    expect(
      within(block).getByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.doneLine),
    ).toHaveTextContent("Done by Kim Morgan 5 minutes ago");
    expect(
      screen.getByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.progress),
    ).toHaveTextContent("1 of 8 done");

    await act(async () => {
      fireEvent.click(
        within(block).getByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.checkbox),
      );
    });

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledWith(
        expect.objectContaining({
          modelType: SecurityCaseTask,
          id: new ObjectID("33333333-3333-4333-8333-000000000001"),
          data: { isDone: false },
        }),
      );
    });
    expect(createMock).not.toHaveBeenCalled();
  });

  test("once every step that contains it is done, the plan offers to mark the case Contained", async () => {
    const done: SecurityCaseTask = new SecurityCaseTask();
    done._id = "33333333-3333-4333-8333-000000000001";
    done.responseStepKey = "contain:block-ip:35.196.249.14";
    done.isDone = true;
    tasks = [done];

    await drawn();

    const markContained: HTMLElement = stepOf("contain:mark-contained");

    expect(
      within(markContained).getByTestId(
        SECURITY_CASE_RESPONSE_TEST_IDS.readyToContain,
      ),
    ).toHaveTextContent("Every containment step is done.");

    await act(async () => {
      fireEvent.click(actionOf("contain:mark-contained"));
    });

    expect(handlers.onMarkContained).toHaveBeenCalledTimes(1);
  });

  test("a step only the case decides cannot be ticked", async () => {
    await drawn();

    expect(
      within(stepOf("confirm:take")).getByTestId(
        SECURITY_CASE_RESPONSE_TEST_IDS.checkbox,
      ),
    ).toBeDisabled();
    expect(
      within(stepOf("close")).getByTestId(
        SECURITY_CASE_RESPONSE_TEST_IDS.checkbox,
      ),
    ).toBeDisabled();
  });

  test("a change that fails says why, and the plan reads what is there now", async () => {
    createMock.mockRejectedValue(
      new Error(
        "This step of the response plan is a task on this case already.",
      ) as never,
    );

    await drawn();

    const readsBefore: number = getListMock.mock.calls.length;

    await act(async () => {
      fireEvent.click(
        within(stepOf("fix:public-app")).getByTestId(
          SECURITY_CASE_RESPONSE_TEST_IDS.checkbox,
        ),
      );
    });

    await waitFor(() => {
      expect(
        screen.getByText(
          "This step of the response plan is a task on this case already.",
        ),
      ).toBeInTheDocument();
    });
    expect(getListMock.mock.calls.length).toBeGreaterThan(readsBefore);
  });

  test("a colleague's change to a task reads the plan again", async () => {
    await drawn();

    const readsBefore: number = getListMock.mock.calls.length;

    await act(async () => {
      colleagueChanges[0]!();
    });

    await waitFor(() => {
      expect(getListMock.mock.calls.length).toBeGreaterThan(readsBefore);
    });
  });
});

describe("a step's button", () => {
  test("presses what the case's header presses: Assign to Me, Declare Incident, Close Case", async () => {
    await drawn();

    await act(async () => {
      fireEvent.click(actionOf("confirm:take"));
    });
    expect(handlers.onAssignToMe).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(actionOf("contain:incident"));
    });
    expect(handlers.onDeclareIncident).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(actionOf("close"));
    });
    expect(handlers.onCloseCase).toHaveBeenCalledTimes(1);
  });

  test("Add Exception opens the exception form on the rule and the address", async () => {
    await drawn();

    await act(async () => {
      fireEvent.click(actionOf(`confirm:false-positive:${RULE_ID}`));
    });

    expect(screen.getByTestId("exception-modal")).toBeInTheDocument();
    expect(exceptionModalProps[exceptionModalProps.length - 1]).toMatchObject({
      detectionRuleId: RULE_ID,
      entity: { type: SecurityEntityType.IpAddress, value: "35.196.249.14" },
    });
  });

  test("Run Playbook runs the playbook that contains the account", async () => {
    const okta: SecurityPlaybook = new SecurityPlaybook();
    okta._id = "77777777-7777-4777-8777-777777777777";
    okta.name = "Suspend in Okta";
    okta.steps = [{ action: "Suspend Okta User" }] as never;
    playbooks = [okta];

    await drawn(
      buildCase({
        entities: [
          { type: SecurityEntityType.User, value: "k.morgan@acme.example" },
        ] as never,
      }),
    );

    await act(async () => {
      fireEvent.click(actionOf("contain:user:k.morgan@acme.example"));
    });

    expect(handlers.onRunPlaybook).toHaveBeenCalledTimes(1);
    expect(
      (handlers.onRunPlaybook.mock.calls[0]![0] as ObjectID).toString(),
    ).toBe("77777777-7777-4777-8777-777777777777");
  });

  // Regression: a run held for an approval ticked the account off as suspended.
  test("a run of the playbook held for an approval is not done: the step says so, with no second Run Playbook", async () => {
    const okta: SecurityPlaybook = new SecurityPlaybook();
    okta._id = "77777777-7777-4777-8777-777777777777";
    okta.name = "Suspend in Okta";
    okta.steps = [{ action: "Suspend Okta User" }] as never;
    playbooks = [okta];

    const held: SecurityPlaybookRun = new SecurityPlaybookRun();
    held._id = "12121212-1212-4121-8121-121212121212";
    held.securityPlaybookId = new ObjectID(okta._id);
    held.status = "Waiting for Approval" as never;
    runs = [held];

    await drawn(
      buildCase({
        entities: [
          { type: SecurityEntityType.User, value: "k.morgan@acme.example" },
        ] as never,
      }),
    );

    const step: HTMLElement = stepOf("contain:user:k.morgan@acme.example");

    expect(step).toHaveTextContent(
      "Its run is waiting for approval on the case's Playbooks page.",
    );
    expect(
      within(step).queryByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.action),
    ).not.toBeInTheDocument();
    expect(
      within(step).getByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.checkbox),
    ).not.toBeChecked();
    expect(getListMock).toHaveBeenCalledWith(
      expect.objectContaining({
        modelType: SecurityPlaybookRun,
        select: { _id: true, securityPlaybookId: true, status: true },
      }),
    );
  });
});

describe("who may do what", () => {
  test("a Security Viewer reads the plan, every tick and change locked; what only opens a page stays open", async () => {
    permissions = [Permission.SecurityViewer];

    await drawn();

    for (const checkbox of screen.getAllByTestId(
      SECURITY_CASE_RESPONSE_TEST_IDS.checkbox,
    )) {
      expect(checkbox).toBeDisabled();
    }

    for (const key of [
      "confirm:take",
      `confirm:false-positive:${RULE_ID}`,
      "contain:incident",
      "contain:mark-contained",
      "close",
    ]) {
      expect([key, (actionOf(key) as HTMLButtonElement).disabled]).toEqual([
        key,
        true,
      ]);
    }

    // Open Events changes nothing: a viewer may follow it.
    expect(actionOf("confirm:requests")).not.toBeDisabled();
  });
});

describe("OneUptime AI", () => {
  test("its read of the case leads the plan, and its suggested steps fold under the plan's own", async () => {
    await drawn(
      buildCase({
        aiVerdict: SecurityCaseAiVerdict.LikelyMalicious,
        aiTriageReport:
          "**Summary** - A scanner.\n\n**Suggested next steps**\n- Block the address at the WAF [C1].\n- Check the app cannot read /proc [C2].",
      }),
    );

    expect(
      screen.getByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.aiVerdict),
    ).toHaveTextContent("OneUptime AI reads this case as Likely Malicious.");

    const toggle: HTMLElement = screen.getByTestId(
      SECURITY_CASE_RESPONSE_TEST_IDS.aiToggle,
    );

    expect(toggle).toHaveTextContent("Show the 2 steps OneUptime AI suggests");
    expect(screen.queryByText("Block the address at the WAF.")).toBeNull();

    await act(async () => {
      fireEvent.click(toggle);
    });

    expect(
      screen.getByText("Block the address at the WAF."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Check the app cannot read /proc."),
    ).toBeInTheDocument();
  });
});

describe("a closed case", () => {
  test("shows what was done, with nothing more to press", async () => {
    await drawn(
      buildCase({
        securityCaseStatusId: testStatusId(SecurityCaseStage.Closed),
      }),
    );

    expect(
      screen.queryAllByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.action),
    ).toEqual([]);
    expect(stepOf("close")).toHaveAttribute("data-done", "true");
  });
});

describe("a plan that cannot be read", () => {
  test("says why, with a way to read it again", async () => {
    getListMock.mockRejectedValue(new Error("The server is down.") as never);

    draw();

    await waitFor(() => {
      expect(
        screen.getByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.error),
      ).toBeInTheDocument();
    });
  });
});

/*
 * WHAT ONEUPTIME FOUND WHEN IT CHECKED A STEP ITSELF (#10340), drawn beside
 * the step and apart from a person's tick: a chip that says what it found,
 * the line of its evidence and, under How We Know, the rest and when it
 * checked. A step that looks done offers Confirm; one it cannot tell about
 * says why at once, with the docs; one that stopped holding is said at the
 * top of the card. Checks that cannot be read leave the plan as it was.
 */
describe("what OneUptime found when it checked a step", () => {
  const BLOCK_KEY: string = "contain:block-ip:35.196.249.14";
  let stepChecks: Array<SecurityCaseStepCheck>;
  let isChecksFailing: boolean;

  function stepCheck(data: {
    key: string;
    state: SecurityCaseStepCheckState;
    sentence: SecurityCaseStepCheckSentence;
    facts?: Array<SecurityCaseStepCheckSentence>;
    docsPath?: string;
  }): SecurityCaseStepCheck {
    const check: SecurityCaseStepCheck = new SecurityCaseStepCheck();
    check._id = ObjectID.generate().toString();
    check.stepKey = data.key;
    check.state = data.state;
    check.evidence = {
      sentence: data.sentence,
      facts: data.facts || [],
      links: [],
      ...(data.docsPath ? { docsPath: data.docsPath } : {}),
      data: {},
    } as unknown as JSONObject;
    check.checkedAt = new Date("2026-11-17T20:00:00.000Z");
    check.stateSince = new Date("2026-11-17T20:00:00.000Z");
    return check;
  }

  beforeEach(() => {
    stepChecks = [];
    isChecksFailing = false;

    const listTheRest: (args: unknown) => Promise<unknown> =
      getListMock.getMockImplementation() as (
        args: unknown,
      ) => Promise<unknown>;

    getListMock.mockImplementation(async (args: unknown) => {
      if (
        (args as { modelType: unknown }).modelType === SecurityCaseStepCheck
      ) {
        if (isChecksFailing) {
          throw new Error("You do not have permission to read this.");
        }

        return { data: stepChecks, count: stepChecks.length };
      }

      return await listTheRest(args);
    });
  });

  test("reads the case's checks with the plan", async () => {
    await drawn();

    expect(getListMock).toHaveBeenCalledWith(
      expect.objectContaining({
        modelType: SecurityCaseStepCheck,
        query: { securityCaseId: new ObjectID(CASE_ID) },
        select: RESPONSE_STEP_CHECK_SELECT,
      }),
    );
  });

  test("a step OneUptime verified is done by its check, said apart from a person's tick, with nothing to tick", async () => {
    stepChecks = [
      stepCheck({
        key: "confirm:requests",
        state: SecurityCaseStepCheckState.Verified,
        sentence: {
          template: CHECK_REQUESTS_ALL_TURNED_AWAY,
          values: { address: "35.196.249.14" },
          count: 12,
        },
      }),
    ];

    await drawn();

    const requests: HTMLElement = stepOf("confirm:requests");

    expect(requests).toHaveAttribute("data-done", "true");
    expect(
      within(requests).getByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.checkChip),
    ).toHaveTextContent("Checked by OneUptime");
    expect(
      within(requests).getByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.checkLine),
    ).toHaveAttribute("data-check-state", SecurityCaseStepCheckState.Verified);
    expect(
      within(requests).getByText(
        "All 12 requests from 35.196.249.14 were turned away by your app.",
      ),
    ).toBeInTheDocument();
    expect(
      within(requests).getByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.checkbox),
    ).toBeDisabled();
    expect(
      within(requests).getByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.checkbox),
    ).toHaveAttribute(
      "title",
      "OneUptime checked this step itself, so it is not ticked by hand.",
    );
    // Verified, its button has nothing left to do.
    expect(
      within(requests).queryByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.action),
    ).toBeNull();
    expect(
      screen.getByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.progress),
    ).toHaveTextContent("1 of 8 done, 1 checked by OneUptime");
  });

  test("How We Know opens what else it saw, and when it checked", async () => {
    stepChecks = [
      stepCheck({
        key: "confirm:requests",
        state: SecurityCaseStepCheckState.Verified,
        sentence: {
          template: CHECK_REQUESTS_ALL_TURNED_AWAY,
          values: { address: "35.196.249.14" },
          count: 12,
        },
        facts: [{ template: CHECK_BLOCK_NOT_PROOF, values: {} }],
      }),
    ];

    await drawn();

    const toggle: HTMLElement = within(stepOf("confirm:requests")).getByTestId(
      SECURITY_CASE_RESPONSE_TEST_IDS.howWeKnow,
    );

    expect(toggle).toHaveTextContent("How We Know");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.howWeKnowPanel),
    ).toBeNull();

    await act(async () => {
      fireEvent.click(toggle);
    });

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveTextContent("Hide How We Know");

    const panel: HTMLElement = screen.getByTestId(
      SECURITY_CASE_RESPONSE_TEST_IDS.howWeKnowPanel,
    );

    expect(panel).toHaveTextContent(
      "An address that goes quiet may have been blocked, or may simply have stopped: OneUptime cannot tell which.",
    );
    expect(panel).toHaveTextContent("OneUptime checked this 5 minutes ago.");
  });

  test("a step that looks done offers Confirm, which ticks it off as the person's", async () => {
    stepChecks = [
      stepCheck({
        key: BLOCK_KEY,
        state: SecurityCaseStepCheckState.LooksDone,
        sentence: {
          template: CHECK_BLOCK_QUIET_SINCE,
          values: { address: "35.196.249.14" },
          times: { since: "2026-11-17T19:20:00.000Z" },
        },
      }),
    ];

    await drawn();

    const block: HTMLElement = stepOf(BLOCK_KEY);
    const confirm: HTMLElement = within(block).getByTestId(
      SECURITY_CASE_RESPONSE_TEST_IDS.confirm,
    );

    expect(
      within(block).getByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.checkChip),
    ).toHaveTextContent("Looks Done");
    expect(confirm).toHaveTextContent("Confirm");
    expect(confirm).toHaveAttribute(
      "aria-label",
      "Confirm Block 35.196.249.14 at your firewall, WAF or load balancer. is done: it is kept on the case's tasks as yours.",
    );
    expect(block).toHaveAttribute("data-done", "false");

    await act(async () => {
      fireEvent.click(confirm);
    });

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });

    const created: SecurityCaseTask = (
      createMock.mock.calls[0]![0] as { model: SecurityCaseTask }
    ).model;

    expect(created.responseStepKey).toBe(BLOCK_KEY);
    expect(created.isDone).toBe(true);
  });

  test("a step OneUptime cannot tell about says why at once, with the docs that say how to let it check", async () => {
    stepChecks = [
      stepCheck({
        key: BLOCK_KEY,
        state: SecurityCaseStepCheckState.CannotTell,
        sentence: {
          template: CHECK_CANNOT_NO_TELEMETRY,
          values: { address: "35.196.249.14" },
        },
        docsPath: STEP_CHECK_DOCS_PATH,
      }),
    ];

    await drawn();

    const block: HTMLElement = stepOf(BLOCK_KEY);

    expect(
      within(block).getByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.checkChip),
    ).toHaveTextContent("OneUptime Cannot Tell");
    expect(
      within(block).getByText(
        "OneUptime receives no traces or logs from your app, so it cannot see the requests from 35.196.249.14.",
      ),
    ).toBeInTheDocument();

    const docs: HTMLElement = within(block).getByTestId(
      SECURITY_CASE_RESPONSE_TEST_IDS.docsLink,
    );

    expect(docs).toHaveTextContent("How to let OneUptime check this");
    expect(docs.getAttribute("href") || "").toContain(
      "/docs/telemetry/security-cases#how-oneuptime-checks-a-step",
    );
    // Said at once: nothing folded under How We Know.
    expect(
      within(block).queryByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.howWeKnow),
    ).toBeNull();
    // Ticking it is the person's call: done anyway.
    expect(
      within(block).getByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.checkbox),
    ).toHaveAttribute(
      "title",
      "Mark Block 35.196.249.14 at your firewall, WAF or load balancer. done anyway",
    );
  });

  test("a step that stopped holding is said at the top of the card, and beside the step", async () => {
    stepChecks = [
      stepCheck({
        key: BLOCK_KEY,
        state: SecurityCaseStepCheckState.Regressed,
        sentence: {
          template: CHECK_BLOCK_REGRESSED,
          values: { address: "35.196.249.14" },
          times: { time: "2026-11-17T20:10:00.000Z" },
        },
      }),
    ];

    await drawn();

    expect(
      screen.getByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.regressed),
    ).toHaveTextContent(
      /35\.196\.249\.14 got through again at .+: the block is not holding\./,
    );
    expect(
      within(stepOf(BLOCK_KEY)).getByTestId(
        SECURITY_CASE_RESPONSE_TEST_IDS.checkChip,
      ),
    ).toHaveTextContent("Stopped Holding");
  });

  test("Declare Incident, not needed so far, still has its button: anyone can still declare one", async () => {
    stepChecks = [
      stepCheck({
        key: "contain:incident",
        state: SecurityCaseStepCheckState.NotNeeded,
        sentence: { template: CHECK_INCIDENT_NOT_NEEDED, values: {} },
      }),
    ];

    await drawn();

    const incident: HTMLElement = stepOf("contain:incident");

    expect(incident).toHaveAttribute("data-done", "true");
    expect(
      within(incident).getByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.checkChip),
    ).toHaveTextContent("Not Needed So Far");
    expect(actionOf("contain:incident")).toHaveTextContent("Declare Incident");
  });

  test("checks that cannot be read leave the plan as it was, and say so", async () => {
    isChecksFailing = true;

    await drawn();

    expect(
      screen.getByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.checksNotRead),
    ).toHaveTextContent(
      "OneUptime's checks of these steps could not be read. The plan is shown without them.",
    );
    expect(
      screen.getByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.progress),
    ).toHaveTextContent("0 of 8 done");
  });

  test("a Security Viewer reads what OneUptime found, but cannot Confirm it", async () => {
    permissions = [Permission.SecurityViewer];
    stepChecks = [
      stepCheck({
        key: BLOCK_KEY,
        state: SecurityCaseStepCheckState.LooksDone,
        sentence: {
          template: CHECK_BLOCK_QUIET_SINCE,
          values: { address: "35.196.249.14" },
          times: { since: "2026-11-17T19:20:00.000Z" },
        },
      }),
    ];

    await drawn();

    const block: HTMLElement = stepOf(BLOCK_KEY);

    expect(
      within(block).getByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.checkChip),
    ).toHaveTextContent("Looks Done");
    expect(
      within(block).queryByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.confirm),
    ).toBeNull();
  });

  test("OneUptime checking a step again reads the plan again", async () => {
    await drawn();

    const readsBefore: number = getListMock.mock.calls.length;

    await act(async () => {
      for (const change of colleagueChanges) {
        change();
      }
    });

    await waitFor(() => {
      expect(getListMock.mock.calls.length).toBeGreaterThan(readsBefore);
    });
    expect(Realtime.listenToModelEvent).toHaveBeenCalledWith(
      expect.objectContaining({ modelType: SecurityCaseStepCheck }),
      expect.any(Function),
    );
  });
});

// ---------- Blocking on every machine, one click (#10346) ----------

describe("a domain, a file and a command-and-control address, blocked on every machine", () => {
  const DOMAIN: string = "evil.example";
  const SHA256: string =
    "275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f";

  const DEFENDER: SecurityBlockHolder = {
    name: "Microsoft Defender",
    provider: SecurityBlockDestinationProvider.MicrosoftDefender,
    enforcesOnEveryMachine: true,
    blocks: [
      SecurityBlockIndicatorType.IpAddress,
      SecurityBlockIndicatorType.Domain,
      SecurityBlockIndicatorType.Url,
      SecurityBlockIndicatorType.FileSha256,
      SecurityBlockIndicatorType.FileSha1,
      SecurityBlockIndicatorType.FileMd5,
    ],
    quarantinesFiles: true,
  };

  function caseAbout(): SecurityCase {
    return buildCase({
      entities: [
        { type: SecurityEntityType.IpAddress, value: "35.196.249.14" },
        { type: SecurityEntityType.Domain, value: DOMAIN },
        { type: SecurityEntityType.FileHash, value: SHA256 },
        { type: SecurityEntityType.User, value: "k.morgan@acme.example" },
      ] as never,
      mitreTactics: ["TA0011"],
    });
  }

  test("asks the blocklist about the case's addresses, domains and files, each once", () => {
    expect(
      getBlockableValues([
        { type: SecurityEntityType.IpAddress, value: " 35.196.249.14 " },
        { type: SecurityEntityType.Domain, value: DOMAIN },
        { type: SecurityEntityType.Domain, value: DOMAIN },
        { type: SecurityEntityType.FileHash, value: SHA256 },
        { type: SecurityEntityType.User, value: "k.morgan@acme.example" },
        { type: SecurityEntityType.Domain, value: "  " },
      ]),
    ).toEqual(["35.196.249.14", DOMAIN, SHA256]);
  });

  test("with Microsoft Defender connected, each is one click, named for the product", async () => {
    readCaseBlocklistMock.mockResolvedValue({
      holders: [DEFENDER],
      blocks: [],
    } as never);

    await drawn(caseAbout());

    expect(readCaseBlocklistMock).toHaveBeenCalledWith([
      "35.196.249.14",
      DOMAIN,
      SHA256,
    ]);
    expect(stepOf(`contain:block-domain:${DOMAIN}`)).toHaveTextContent(
      `Block ${DOMAIN} on every machine with Microsoft Defender.`,
    );
    expect(actionOf(`contain:block-domain:${DOMAIN}`)).toHaveTextContent(
      "Block for 7 Days",
    );
    expect(stepOf(`contain:quarantine-file:${SHA256}`)).toHaveTextContent(
      `Block and quarantine the file ${SHA256} with Microsoft Defender.`,
    );
    expect(actionOf(`contain:quarantine-file:${SHA256}`)).toHaveTextContent(
      "Block File",
    );
    expect(
      stepOf("contain:block-ip-everywhere:35.196.249.14"),
    ).toHaveTextContent(
      "Block 35.196.249.14 on every machine with Microsoft Defender.",
    );
  });

  test("a click blocks the domain for 7 days, for the case, on every machine, and says so", async () => {
    readCaseBlocklistMock.mockResolvedValue({
      holders: [DEFENDER],
      blocks: [],
    } as never);
    const toast: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Toast, "success")
      .mockImplementation(() => {
        return "";
      });
    const before: number = Date.now();

    await drawn(caseAbout());

    const readsBefore: number = readCaseBlocklistMock.mock.calls.length;

    await act(async () => {
      fireEvent.click(actionOf(`contain:block-domain:${DOMAIN}`));
    });

    expect(createMock).toHaveBeenCalledTimes(1);

    const made: SecurityBlock = (
      createMock.mock.calls[0]![0] as { model: SecurityBlock }
    ).model;

    expect(made.value).toBe(DOMAIN);
    expect(made.action).toBe(SecurityBlockAction.Block);
    expect(made.reach).toBe(SecurityBlockReach.Everywhere);
    expect(made.securityCaseId?.toString()).toBe(CASE_ID);

    const end: number = new Date(made.expiresAt as Date).getTime();
    expect(end).toBeGreaterThanOrEqual(before + 7 * 24 * 60 * 60 * 1000);
    expect(end).toBeLessThanOrEqual(Date.now() + 7 * 24 * 60 * 60 * 1000);

    expect(toast).toHaveBeenCalledWith(
      `${DOMAIN} is on the blocklist. The step is done once it is blocked on every machine.`,
    );
    // The plan reads the blocklist again: the step waits for Defender to hold it.
    await waitFor(() => {
      expect(readCaseBlocklistMock.mock.calls.length).toBeGreaterThan(
        readsBefore,
      );
    });
  });

  test("a file is blocked and quarantined, for 30 days", async () => {
    readCaseBlocklistMock.mockResolvedValue({
      holders: [DEFENDER],
      blocks: [],
    } as never);
    jest.spyOn(Toast, "success").mockImplementation(() => {
      return "";
    });
    const before: number = Date.now();

    await drawn(caseAbout());

    await act(async () => {
      fireEvent.click(actionOf(`contain:quarantine-file:${SHA256}`));
    });

    const made: SecurityBlock = (
      createMock.mock.calls[0]![0] as { model: SecurityBlock }
    ).model;

    expect(made.action).toBe(SecurityBlockAction.BlockAndQuarantine);
    expect(new Date(made.expiresAt as Date).getTime()).toBeGreaterThanOrEqual(
      before + 30 * 24 * 60 * 60 * 1000,
    );
  });

  test("a block the server refuses says why, and the step stays to do", async () => {
    readCaseBlocklistMock.mockResolvedValue({
      holders: [DEFENDER],
      blocks: [],
    } as never);
    createMock.mockRejectedValue(
      new Error(
        "Blocking acme.com would also block status.acme.com. status.acme.com is the domain of your status page Acme Status.",
      ) as never,
    );

    await drawn(caseAbout());

    await act(async () => {
      fireEvent.click(actionOf(`contain:block-domain:${DOMAIN}`));
    });

    expect(
      await screen.findByText(
        "Blocking acme.com would also block status.acme.com. status.acme.com is the domain of your status page Acme Status.",
        { exact: false },
      ),
    ).toBeInTheDocument();
  });

  test("on the blocklist and held by nothing yet, the step waits; held, it is done", async () => {
    readCaseBlocklistMock.mockResolvedValue({
      holders: [DEFENDER],
      blocks: [
        {
          value: DOMAIN,
          reach: SecurityBlockReach.Everywhere,
          action: SecurityBlockAction.Block,
          enforcedAt: [],
        },
        {
          value: SHA256,
          reach: SecurityBlockReach.Everywhere,
          action: SecurityBlockAction.BlockAndQuarantine,
          enforcedAt: ["Microsoft Defender"],
        },
      ],
    } as never);

    await drawn(caseAbout());

    expect(stepOf(`contain:block-domain:${DOMAIN}`)).toHaveTextContent(
      "On the blocklist, waiting for Microsoft Defender to hold it.",
    );
    expect(
      within(stepOf(`contain:block-domain:${DOMAIN}`)).queryByTestId(
        SECURITY_CASE_RESPONSE_TEST_IDS.action,
      ),
    ).toBeNull();
    expect(
      within(stepOf(`contain:quarantine-file:${SHA256}`)).queryByTestId(
        SECURITY_CASE_RESPONSE_TEST_IDS.action,
      ),
    ).toBeNull();
  });

  test("a blocklist that cannot be read leaves them to be done by hand", async () => {
    readCaseBlocklistMock.mockRejectedValue(new Error("down") as never);

    await drawn(caseAbout());

    expect(stepOf(`contain:block-domain:${DOMAIN}`)).toHaveTextContent(
      `Block ${DOMAIN} at your DNS filter or web proxy.`,
    );
    expect(
      stepOf("contain:block-ip-everywhere:35.196.249.14"),
    ).toHaveTextContent(
      "Block 35.196.249.14 on every machine too, at your EDR or egress firewall, so none of them can reach it.",
    );
  });

  test("a case with nothing to block never asks the blocklist", async () => {
    await drawn(
      buildCase({
        entities: [
          { type: SecurityEntityType.User, value: "k.morgan@acme.example" },
        ] as never,
      }),
    );

    expect(readCaseBlocklistMock).not.toHaveBeenCalled();
  });

  test("whoever may not block sees the button locked, saying why", async () => {
    permissions = [Permission.SecurityViewer];
    readCaseBlocklistMock.mockResolvedValue({
      holders: [DEFENDER],
      blocks: [],
    } as never);

    await drawn(caseAbout());

    expect(actionOf(`contain:block-domain:${DOMAIN}`)).toBeDisabled();
  });
});

describe("the blocklist as the plan reads it", () => {
  test("keeps what it can read, and reads the rest as nothing", () => {
    expect(
      readResponseBlocklist({
        holders: [
          {
            name: "Microsoft Defender",
            provider: "MicrosoftDefender",
            enforcesOnEveryMachine: true,
            blocks: ["Domain", "NotAKind"],
            quarantinesFiles: true,
          },
          { provider: "NoName" },
          "not an object",
        ],
        blocks: [
          {
            value: "evil.example",
            reach: "Everywhere",
            action: "Block",
            enforcedAt: ["Microsoft Defender", 7],
          },
          { value: "198.51.100.7", reach: "Somewhere", action: "Smite" },
          { reach: "Edge" },
        ],
      } as unknown as JSONObject),
    ).toEqual({
      holders: [
        {
          name: "Microsoft Defender",
          provider: "MicrosoftDefender",
          enforcesOnEveryMachine: true,
          blocks: [SecurityBlockIndicatorType.Domain],
          quarantinesFiles: true,
        },
      ],
      blocks: [
        {
          value: "evil.example",
          reach: SecurityBlockReach.Everywhere,
          action: SecurityBlockAction.Block,
          enforcedAt: ["Microsoft Defender"],
        },
        {
          value: "198.51.100.7",
          reach: SecurityBlockReach.Edge,
          action: SecurityBlockAction.Block,
          enforcedAt: [],
        },
      ],
    });
  });
});
