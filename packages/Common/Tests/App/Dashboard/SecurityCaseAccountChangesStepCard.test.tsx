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
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE STEP'S READ-BACK LIST: "Undo what changed on the account" on a case's
 * Response Plan card (#10603, #10900, #10901). Each change OneUptime read
 * back is a line marked by what it says - undone, still there, a person's
 * to confirm - and the lines that say how to let OneUptime read the rest
 * (a Google Workspace scope, an AWS connection's Security case checks)
 * are marked as help, the scope written whole. The list is drawn at once
 * whenever there is something for the person to do: something still
 * there, or something to confirm; otherwise it waits under How We Know. A
 * check written before lines had marks keeps its bullets.
 */

const getListMock: MockFunction = getJestMockFunction();

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
      create: async (): Promise<unknown> => {
        return {};
      },
      updateById: async (): Promise<unknown> => {
        return {};
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/RuleExceptions/AddRuleExceptionModal",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return React.createElement("div");
      },
    };
  },
);

import SecurityCaseResponsePlanCard from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Response/SecurityCaseResponsePlanCard";
import { SECURITY_CASE_RESPONSE_TEST_IDS } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Response/SecurityCaseResponseCopy";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import SecurityCaseStepCheck from "../../../Models/DatabaseModels/SecurityCaseStepCheck";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  SecurityCaseStepCheckEvidence,
  StepCheckFactMark,
} from "../../../Types/SecurityCase/SecurityCaseStepCheckEvidence";
import SecurityCaseStage from "../../../Types/SecurityCase/SecurityCaseStage";
import SecurityCaseStepCheckState from "../../../Types/SecurityCase/SecurityCaseStepCheckState";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import Realtime from "../../../UI/Utils/Realtime";
import UserUtil from "../../../UI/Utils/User";
import GlobalEvents from "../../../UI/Utils/GlobalEvents";
import {
  CHECK_ACCOUNT_CHANGES_ALL_UNDONE,
  CHECK_ACCOUNT_CHANGES_BACK,
  CHECK_ACCOUNT_CHANGES_CONFIRM_REST,
  CHECK_ACCOUNT_CHANGES_FACT_AWS_NOT_GRANTED,
  CHECK_ACCOUNT_CHANGES_FACT_GOOGLE_GROUPS,
  CHECK_ACCOUNT_CHANGES_STILL_THERE,
  CHECK_ACCOUNT_CHANGE_GROUP_CONFIRM,
  CHECK_ACCOUNT_CHANGE_GROUP_UNDONE,
  CHECK_ACCOUNT_CHANGE_KEY_CONFIRM,
  CHECK_ACCOUNT_CHANGE_POLICY_STILL,
} from "../../../Utils/SecurityCase/ResponsePlan/StepCheckWords";
import {
  fixCaseMatches,
  fixStepCheckRow,
} from "../../Helpers/SecurityCaseFixStepChecks";
import {
  buildDefaultTestPriorities,
  buildDefaultTestStatuses,
  testStatusId,
} from "../../Helpers/SecurityCaseValues";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const CASE_ID: string = "22222222-2222-4222-8222-222222222222";
const STEP_KEY: string = "fix:account-changes";
const SCOPE: string =
  "https://www.googleapis.com/auth/admin.directory.group.member.readonly";

let stepChecks: Array<SecurityCaseStepCheck>;

// A case about an account an attack gave itself an admin's rights with (T1098).
function buildCase(): SecurityCase {
  const securityCase: SecurityCase = new SecurityCase();
  securityCase._id = CASE_ID;
  securityCase.securityCaseStatusId = testStatusId(SecurityCaseStage.New);
  securityCase.entities = [
    { type: SecurityEntityType.User, value: "alice@acme.com" },
  ] as never;
  securityCase.mitreTactics = ["TA0003"];
  securityCase.mitreTechniques = ["T1098"];
  return securityCase;
}

async function drawn(): Promise<HTMLElement> {
  render(
    <MemoryRouter>
      <SecurityCaseResponsePlanCard
        caseId={new ObjectID(CASE_ID)}
        securityCase={buildCase()}
        values={{
          priorities: buildDefaultTestPriorities(),
          statuses: buildDefaultTestStatuses(),
        }}
        matches={fixCaseMatches()}
        refreshToggle="first"
        isWorking={false}
        onAssignToMe={(): void => {}}
        onRunPlaybook={(): void => {}}
        onDeclareIncident={(): void => {}}
        onMarkContained={(): void => {}}
        onCloseCase={(): void => {}}
      />
    </MemoryRouter>,
  );
  await screen.findAllByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.step);

  const step: HTMLElement | undefined = screen
    .queryAllByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.step)
    .find((candidate: HTMLElement): boolean => {
      return candidate.getAttribute("data-step-key") === STEP_KEY;
    });

  expect({ drawn: Boolean(step) }).toEqual({ drawn: true });

  return step!;
}

function check(
  state: SecurityCaseStepCheckState,
  evidence: SecurityCaseStepCheckEvidence,
): SecurityCaseStepCheck {
  return fixStepCheckRow({ key: STEP_KEY, state, evidence });
}

// Each line of the list as it is drawn: its mark, and its words.
function lines(step: HTMLElement): Array<[string, string]> {
  return within(step)
    .getAllByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.checkFact)
    .map((line: HTMLElement): [string, string] => {
      return [
        line.getAttribute("data-fact-mark") || "",
        (line.textContent || "").trim(),
      ];
    });
}

const LOOKS_DONE_TO_CONFIRM: SecurityCaseStepCheckEvidence = {
  sentence: {
    template: CHECK_ACCOUNT_CHANGES_CONFIRM_REST,
    values: {},
    count: 2,
  },
  facts: [
    {
      template: CHECK_ACCOUNT_CHANGE_GROUP_CONFIRM,
      values: {
        account: "alice@acme.com",
        object: "finance@acme.com",
        provider: "Google Workspace",
      },
      mark: StepCheckFactMark.Confirm,
    },
    {
      template: CHECK_ACCOUNT_CHANGE_KEY_CONFIRM,
      values: {
        account: "deploy-bot",
        object: "AKIAEXAMPLE",
        provider: "AWS",
      },
      mark: StepCheckFactMark.Confirm,
    },
    {
      template: CHECK_ACCOUNT_CHANGES_FACT_GOOGLE_GROUPS,
      values: { scope: SCOPE },
      mark: StepCheckFactMark.HowToCheck,
    },
    {
      template: CHECK_ACCOUNT_CHANGES_FACT_AWS_NOT_GRANTED,
      values: { cloudAccount: "123456789012" },
      mark: StepCheckFactMark.HowToCheck,
    },
    {
      template: CHECK_ACCOUNT_CHANGE_GROUP_UNDONE,
      values: {
        account: "alice@acme.com",
        object: "Admins",
        provider: "Okta",
      },
      mark: StepCheckFactMark.Done,
    },
  ],
  links: [],
  docsPath: "/telemetry/security-cases#how-oneuptime-checks-a-step",
  data: { changes: 3, stillThere: 0, undone: 1, toConfirm: 2 },
};

const NOT_DONE: SecurityCaseStepCheckEvidence = {
  sentence: {
    template: CHECK_ACCOUNT_CHANGES_STILL_THERE,
    values: {},
    count: 1,
  },
  facts: [
    {
      template: CHECK_ACCOUNT_CHANGE_POLICY_STILL,
      values: {
        account: "deploy-bot",
        object: "AdministratorAccess",
        provider: "AWS",
      },
      mark: StepCheckFactMark.NotDone,
    },
    {
      template: CHECK_ACCOUNT_CHANGE_GROUP_UNDONE,
      values: {
        account: "alice@acme.com",
        object: "Admins",
        provider: "Okta",
      },
      mark: StepCheckFactMark.Done,
    },
  ],
  links: [],
  data: { changes: 2, stillThere: 1, undone: 1, toConfirm: 0 },
};

beforeEach(() => {
  PermissionGate.clearPermissionPropsCache();
  stepChecks = [];

  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest.spyOn(PermissionUtil, "getAllPermissions").mockImplementation(() => {
    return [Permission.SecurityMember];
  });
  jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(false);
  jest
    .spyOn(UserUtil, "getUserId")
    .mockReturnValue(new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-000000000001"));
  jest.spyOn(OneUptimeDate, "fromNow").mockReturnValue("5 minutes ago");
  jest
    .spyOn(Realtime, "listenToModelEvent")
    .mockImplementation(((): (() => void) => {
      return (): void => {};
    }) as never);
  jest
    .spyOn(GlobalEvents, "dispatchEvent")
    .mockImplementation((() => {}) as never);

  getListMock.mockReset();
  getListMock.mockImplementation(async (args: unknown) => {
    const data: Array<unknown> =
      (args as { modelType: unknown }).modelType === SecurityCaseStepCheck
        ? stepChecks
        : [];

    return { data, count: data.length };
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("what OneUptime read back, and what is left to a person", () => {
  test("drawn at once, each line marked: to confirm, how to let OneUptime read it - the scope whole - and undone", async () => {
    stepChecks = [
      check(SecurityCaseStepCheckState.LooksDone, LOOKS_DONE_TO_CONFIRM),
    ];

    const step: HTMLElement = await drawn();

    // At once: nothing to open.
    expect(
      within(step).queryByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.howWeKnow),
    ).toBeNull();
    expect(lines(step)).toEqual([
      [
        StepCheckFactMark.Confirm,
        "Confirm alice@acme.com is no longer in the group finance@acme.com in Google Workspace.",
      ],
      [
        StepCheckFactMark.Confirm,
        "Confirm the key AKIAEXAMPLE the attack made for deploy-bot no longer works in AWS.",
      ],
      [
        StepCheckFactMark.HowToCheck,
        `To read Google Workspace groups back, add the scope ${SCOPE} to the connection's domain-wide delegation, for an administrator who may read groups.`,
      ],
      [
        StepCheckFactMark.HowToCheck,
        "To read IAM back in the account 123456789012, edit its AWS connection under Cloud → Connect, turn on Security case checks, and run the command it shows.",
      ],
      [
        StepCheckFactMark.Done,
        "alice@acme.com is no longer in the group Admins in Okta.",
      ],
    ]);
    // Each mark an icon of its own; the list has no bullets of its own.
    for (const line of within(step).getAllByTestId(
      SECURITY_CASE_RESPONSE_TEST_IDS.checkFact,
    )) {
      expect(line.querySelector("svg")).not.toBeNull();
    }
    expect(
      within(step).getByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.checkFacts)
        .className,
    ).not.toContain("list-disc");
    // How to let OneUptime check it, and the person's Confirm.
    expect(
      within(step).getByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.docsLink),
    ).toHaveTextContent("How to let OneUptime check this");
    expect(
      within(step).getByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.confirm),
    ).toBeInTheDocument();
  });

  test("each mark has its own icon and colour, never two alike", async () => {
    stepChecks = [
      check(SecurityCaseStepCheckState.LooksDone, LOOKS_DONE_TO_CONFIRM),
    ];

    const step: HTMLElement = await drawn();
    const byMark: Map<string, string> = new Map();

    for (const line of within(step).getAllByTestId(
      SECURITY_CASE_RESPONSE_TEST_IDS.checkFact,
    )) {
      byMark.set(
        line.getAttribute("data-fact-mark") || "",
        line.querySelector("svg")?.getAttribute("class") || "",
      );
    }

    expect(new Set(byMark.values()).size).toBe(byMark.size);
    expect(byMark.get(StepCheckFactMark.Done)).toContain("text-emerald-600");
    expect(byMark.get(StepCheckFactMark.Confirm)).toContain("text-amber-600");
    expect(byMark.get(StepCheckFactMark.HowToCheck)).toContain(
      "text-indigo-600",
    );
  });

  test("a change still there is drawn at once, first, for the person to undo", async () => {
    stepChecks = [check(SecurityCaseStepCheckState.NotDone, NOT_DONE)];

    const step: HTMLElement = await drawn();

    expect(
      within(step).getByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.checkChip),
    ).toHaveTextContent("Not Done Yet");
    expect(
      within(step).queryByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.howWeKnow),
    ).toBeNull();
    expect(lines(step)).toEqual([
      [
        StepCheckFactMark.NotDone,
        "deploy-bot still has the policy AdministratorAccess in AWS.",
      ],
      [
        StepCheckFactMark.Done,
        "alice@acme.com is no longer in the group Admins in Okta.",
      ],
    ]);
    expect(
      within(step)
        .getAllByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.checkFact)[0]!
        .querySelector("svg")
        ?.getAttribute("class"),
    ).toContain("text-red-600");
  });

  test("one that came back is drawn at once too", async () => {
    stepChecks = [
      check(SecurityCaseStepCheckState.Regressed, {
        ...NOT_DONE,
        sentence: {
          template: CHECK_ACCOUNT_CHANGES_BACK,
          values: {},
          count: 1,
        },
      }),
    ];

    const step: HTMLElement = await drawn();

    expect(
      within(step).queryByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.howWeKnow),
    ).toBeNull();
    expect(lines(step)[0]![0]).toBe(StepCheckFactMark.NotDone);
  });

  test("everything undone waits under How We Know, still marked", async () => {
    stepChecks = [
      check(SecurityCaseStepCheckState.LooksDone, {
        sentence: {
          template: CHECK_ACCOUNT_CHANGES_ALL_UNDONE,
          values: {},
          count: 1,
        },
        facts: [NOT_DONE.facts[1]!],
        links: [],
        data: { changes: 1, stillThere: 0, undone: 1, toConfirm: 0 },
      }),
    ];

    const step: HTMLElement = await drawn();

    expect(
      within(step).queryByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.checkFacts),
    ).toBeNull();

    await act(async () => {
      fireEvent.click(
        within(step).getByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.howWeKnow),
      );
    });

    expect(lines(step)).toEqual([
      [
        StepCheckFactMark.Done,
        "alice@acme.com is no longer in the group Admins in Okta.",
      ],
    ]);
  });
});

describe("a check written before its lines had marks", () => {
  test("keeps its bullets, each line as it was", async () => {
    stepChecks = [
      check(SecurityCaseStepCheckState.LooksDone, {
        ...LOOKS_DONE_TO_CONFIRM,
        facts: LOOKS_DONE_TO_CONFIRM.facts.map(
          (
            fact: SecurityCaseStepCheckEvidence["facts"][number],
          ): SecurityCaseStepCheckEvidence["facts"][number] => {
            return { template: fact.template, values: fact.values };
          },
        ),
      }),
    ];

    const step: HTMLElement = await drawn();
    const list: HTMLElement = within(step).getByTestId(
      SECURITY_CASE_RESPONSE_TEST_IDS.checkFacts,
    );

    expect(list.className).toContain("list-disc");
    expect(
      within(step).queryAllByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.checkFact),
    ).toHaveLength(0);
    expect(list.querySelectorAll("li")).toHaveLength(5);
    expect(list.querySelector("svg")).toBeNull();
  });
});
