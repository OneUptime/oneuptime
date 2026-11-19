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

import SecurityCaseResponsePlanCard from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Response/SecurityCaseResponsePlanCard";
import { RESPONSE_TASK_SELECT } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Response/SecurityCaseResponseData";
import { SECURITY_CASE_RESPONSE_TEST_IDS } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Response/SecurityCaseResponseCopy";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import SecurityCaseTask from "../../../Models/DatabaseModels/SecurityCaseTask";
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
