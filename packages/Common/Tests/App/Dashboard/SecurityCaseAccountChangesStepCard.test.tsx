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
import { ResponseLinkKind } from "../../../Types/SecurityCase/SecurityCaseResponseLink";
import {
  CHECK_ACCOUNT_CHANGES_ALL_UNDONE,
  CHECK_ACCOUNT_CHANGES_BACK,
  CHECK_ACCOUNT_CHANGES_CANNOT_READ,
  CHECK_ACCOUNT_CHANGES_CONFIRM_REST,
  CHECK_ACCOUNT_CHANGES_FACT_AWS_NOT_GRANTED,
  CHECK_ACCOUNT_CHANGES_FACT_AWS_NO_CONNECTION,
  CHECK_ACCOUNT_CHANGES_FACT_AWS_RUN_AGAIN,
  CHECK_ACCOUNT_CHANGES_FACT_GOOGLE_GROUPS,
  CHECK_ACCOUNT_CHANGES_FACT_GOOGLE_GROUPS_SCOPE,
  CHECK_ACCOUNT_CHANGES_FACT_NO_CONNECTION,
  CHECK_ACCOUNT_CHANGES_STILL_THERE,
  CHECK_ACCOUNT_CHANGE_GROUP_CONFIRM,
  CHECK_ACCOUNT_CHANGE_GROUP_UNDONE,
  CHECK_ACCOUNT_CHANGE_KEY_CONFIRM,
  CHECK_ACCOUNT_CHANGE_POLICY_STILL,
  CHECK_ACCOUNT_CHANGE_PROVIDER_ANY_ORGANIZATION,
  CHECK_ACCOUNT_CHANGE_PROVIDER_HELD,
  CHECK_ACCOUNT_CHANGE_PROVIDER_SAML,
  CHECK_ACCOUNT_CHANGE_ROLE_MADE_STILL,
  CHECK_ACCOUNT_CHANGE_ROLE_POLICY_UNDONE,
  CHECK_ACCOUNT_CHANGE_TRUSTS_ACCOUNT,
  CHECK_ACCOUNT_CHANGE_TRUSTS_ACCOUNTS,
  CHECK_ACCOUNT_CHANGE_TRUSTS_EVERY_ACCOUNT,
  CHECK_ACCOUNT_CHANGE_TRUST_CONFIRM,
  CHECK_ACCOUNT_CHANGE_TRUST_STILL,
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

/*
 * THE LINES THAT SAY WHAT TO GRANT LINK TO WHERE IT IS GRANTED (#11039):
 * "edit its AWS connection ... turn on Security case checks" opens that
 * connection's form on Cloud > Connect, and "No AWS connection reads the
 * account" opens Cloud > Connect - routed through the Dashboard's own
 * routes, and drawn only for a reader who may see the page: one who may
 * change connections is taken to the form, one who may only see them to
 * the page, and one who may not see Cloud > Connect gets the words alone,
 * which name the menu path for someone who may.
 */
const CONNECTION_ID: string = "5d0c2a7e-0000-4000-8000-00000000c0de";
const CONNECT_PAGE: string = `/dashboard/${PROJECT_ID}/cloud/connect`;

const LOOKS_DONE_WITH_LINKS: SecurityCaseStepCheckEvidence = {
  sentence: {
    template: CHECK_ACCOUNT_CHANGES_CONFIRM_REST,
    values: {},
    count: 2,
  },
  facts: [
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
      template: CHECK_ACCOUNT_CHANGE_KEY_CONFIRM,
      values: {
        account: "ci-bot",
        object: "AKIAOTHER",
        provider: "AWS",
      },
      mark: StepCheckFactMark.Confirm,
    },
    {
      template: CHECK_ACCOUNT_CHANGES_FACT_AWS_NOT_GRANTED,
      values: { cloudAccount: "123456789012" },
      mark: StepCheckFactMark.HowToCheck,
      link: {
        kind: ResponseLinkKind.OpenCloudConnection,
        connectionId: CONNECTION_ID,
      },
    },
    {
      template: CHECK_ACCOUNT_CHANGES_FACT_AWS_NO_CONNECTION,
      values: { cloudAccount: "210987654321" },
      mark: StepCheckFactMark.HowToCheck,
      link: { kind: ResponseLinkKind.OpenCloudConnection },
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

function readAs(permissions: Array<Permission>): void {
  jest.spyOn(PermissionUtil, "getAllPermissions").mockImplementation(() => {
    return [Permission.SecurityMember, ...permissions];
  });
  PermissionGate.clearPermissionPropsCache();
}

// Each line's own link, as drawn: its words and where it goes.
function factLinks(step: HTMLElement): Array<[string, string]> {
  return within(step)
    .queryAllByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.checkFactLink)
    .map((link: HTMLElement): [string, string] => {
      return [(link.textContent || "").trim(), link.getAttribute("href") || ""];
    });
}

describe("the lines that say what to grant link to where it is granted (#11039)", () => {
  test("a reader who may change connections: the connection's form, and Cloud > Connect to connect one", async () => {
    readAs([Permission.ProjectAdmin]);
    stepChecks = [
      check(SecurityCaseStepCheckState.LooksDone, LOOKS_DONE_WITH_LINKS),
    ];

    const step: HTMLElement = await drawn();

    expect(factLinks(step)).toEqual([
      ["Edit Connection", `${CONNECT_PAGE}?connection=${CONNECTION_ID}`],
      ["Open Cloud Connections", CONNECT_PAGE],
    ]);
    // Each after the words of its own line, which still read whole.
    expect(lines(step)[2]).toEqual([
      StepCheckFactMark.HowToCheck,
      "To read IAM back in the account 123456789012, edit its AWS connection under Cloud → Connect, turn on Security case checks, and run the command it shows. Edit Connection",
    ]);
    expect(lines(step)[3]).toEqual([
      StepCheckFactMark.HowToCheck,
      "No AWS connection reads the account 210987654321, so OneUptime cannot read its IAM back. Connect it under Cloud → Connect, with Security case checks on. Open Cloud Connections",
    ]);
    // The other lines link nowhere; the step's own links are where they were.
    expect(
      within(step).queryAllByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.checkLink),
    ).toHaveLength(0);
  });

  test("a reader who may see connections but not change them: Cloud > Connect, where Edit says what it takes", async () => {
    readAs([Permission.ProjectMember]);
    stepChecks = [
      check(SecurityCaseStepCheckState.LooksDone, LOOKS_DONE_WITH_LINKS),
    ];

    const step: HTMLElement = await drawn();

    expect(factLinks(step)).toEqual([
      ["Open Cloud Connections", CONNECT_PAGE],
      ["Open Cloud Connections", CONNECT_PAGE],
    ]);
  });

  test("a reader who may not see Cloud > Connect gets no link: the words name the menu path, for someone who may", async () => {
    stepChecks = [
      check(SecurityCaseStepCheckState.LooksDone, LOOKS_DONE_WITH_LINKS),
    ];

    const step: HTMLElement = await drawn();

    expect(factLinks(step)).toEqual([]);
    expect(lines(step)[2]).toEqual([
      StepCheckFactMark.HowToCheck,
      "To read IAM back in the account 123456789012, edit its AWS connection under Cloud → Connect, turn on Security case checks, and run the command it shows.",
    ]);
  });

  test("checks on and refused all the same: run its command again, on the connection's form", async () => {
    readAs([Permission.ProjectOwner]);
    stepChecks = [
      check(SecurityCaseStepCheckState.CannotTell, {
        sentence: {
          template: CHECK_ACCOUNT_CHANGES_CANNOT_READ,
          values: {},
          count: 1,
        },
        facts: [
          {
            template: CHECK_ACCOUNT_CHANGE_TRUST_CONFIRM,
            values: { account: "Deploy", object: "", provider: "AWS" },
            mark: StepCheckFactMark.Confirm,
          },
          {
            template: CHECK_ACCOUNT_CHANGES_FACT_AWS_RUN_AGAIN,
            values: { cloudAccount: "123456789012" },
            mark: StepCheckFactMark.HowToCheck,
            link: {
              kind: ResponseLinkKind.OpenCloudConnection,
              connectionId: CONNECTION_ID,
            },
          },
        ],
        links: [],
        docsPath: "/telemetry/security-cases#how-oneuptime-checks-a-step",
        data: { changes: 1, stillThere: 0, undone: 0, toConfirm: 1 },
      }),
    ];

    const step: HTMLElement = await drawn();

    expect(lines(step)).toEqual([
      [
        StepCheckFactMark.Confirm,
        "Confirm the role Deploy in AWS trusts only whom you expect: the attack changed its trust policy.",
      ],
      [
        StepCheckFactMark.HowToCheck,
        "AWS refused OneUptime's read of IAM in the account 123456789012, though its AWS connection has Security case checks on. Edit the connection under Cloud → Connect and run the command it shows again. Edit Connection",
      ],
    ]);
    expect(factLinks(step)).toEqual([
      ["Edit Connection", `${CONNECT_PAGE}?connection=${CONNECTION_ID}`],
    ]);
  });
});

describe("an IAM role's changes (#11038)", () => {
  test("a role still there, then whom it trusts outside its account on a line of its own under it, unmarked", async () => {
    stepChecks = [
      check(SecurityCaseStepCheckState.NotDone, {
        sentence: {
          template: CHECK_ACCOUNT_CHANGES_STILL_THERE,
          values: {},
          count: 2,
        },
        facts: [
          {
            template: CHECK_ACCOUNT_CHANGE_ROLE_MADE_STILL,
            values: { account: "backdoor", object: "", provider: "AWS" },
            mark: StepCheckFactMark.NotDone,
          },
          {
            template: CHECK_ACCOUNT_CHANGE_TRUSTS_ACCOUNT,
            values: {
              account: "backdoor",
              cloudAccount: "123456789012",
              trusted: "444455556666",
            },
          },
          {
            template: CHECK_ACCOUNT_CHANGE_TRUST_STILL,
            values: { account: "Deploy", object: "", provider: "AWS" },
            mark: StepCheckFactMark.NotDone,
          },
          {
            template: CHECK_ACCOUNT_CHANGE_TRUSTS_ACCOUNTS,
            values: {
              account: "Deploy",
              cloudAccount: "123456789012",
              trusted: "444455556666",
            },
            count: 3,
          },
          {
            template: CHECK_ACCOUNT_CHANGE_ROLE_POLICY_UNDONE,
            values: {
              account: "Deploy",
              object: "AdministratorAccess",
              provider: "AWS",
            },
            mark: StepCheckFactMark.Done,
          },
        ],
        links: [],
        data: { changes: 3, stillThere: 2, undone: 1, toConfirm: 0 },
      }),
    ];

    const step: HTMLElement = await drawn();

    expect(lines(step)).toEqual([
      [
        StepCheckFactMark.NotDone,
        "The role backdoor the attack made is still in AWS.",
      ],
      [
        "",
        "The role backdoor trusts 444455556666, an AWS account outside 123456789012.",
      ],
      [
        StepCheckFactMark.NotDone,
        "The role Deploy still has the trust policy the attack set in AWS.",
      ],
      [
        "",
        "The role Deploy trusts 3 AWS accounts outside 123456789012, 444455556666 among them.",
      ],
      [
        StepCheckFactMark.Done,
        "The role Deploy no longer has the policy AdministratorAccess in AWS.",
      ],
    ]);

    // The line under a role has no icon of its own: it says more of the line above.
    const drawnLines: Array<HTMLElement> = within(step).getAllByTestId(
      SECURITY_CASE_RESPONSE_TEST_IDS.checkFact,
    );

    expect(drawnLines[1]!.querySelector("svg")).toBeNull();
    expect(drawnLines[0]!.querySelector("svg")).not.toBeNull();
  });

  test("every AWS account trusted is said as anyone in AWS", async () => {
    stepChecks = [
      check(SecurityCaseStepCheckState.NotDone, {
        sentence: {
          template: CHECK_ACCOUNT_CHANGES_STILL_THERE,
          values: {},
          count: 1,
        },
        facts: [
          {
            template: CHECK_ACCOUNT_CHANGE_ROLE_MADE_STILL,
            values: { account: "backdoor", object: "", provider: "AWS" },
            mark: StepCheckFactMark.NotDone,
          },
          {
            template: CHECK_ACCOUNT_CHANGE_TRUSTS_EVERY_ACCOUNT,
            values: { account: "backdoor" },
          },
        ],
        links: [],
        data: { changes: 1, stillThere: 1, undone: 0, toConfirm: 0 },
      }),
    ];

    const step: HTMLElement = await drawn();

    expect(lines(step)[1]).toEqual([
      "",
      "Anyone in AWS may assume the role backdoor: its trust policy trusts every AWS account.",
    ]);
  });
});

describe("the Google Workspace line links to its connection under Security Events > Connections (#11376)", () => {
  const GOOGLE_CONNECTION_ID: string = "9a7e6c5d-0000-4000-8000-0000000060a1";
  const SECURITY_CONNECTIONS_PAGE: string = `/dashboard/${PROJECT_ID}/security-events/connections`;
  const GOOGLE_LINE: string = `To read Google Workspace groups back, add the scope ${SCOPE} to the domain-wide delegation of the Google Workspace connection under Security Events → Connections, for an administrator who may read groups.`;
  const WITH_GOOGLE_LINK: SecurityCaseStepCheckEvidence = {
    sentence: {
      template: CHECK_ACCOUNT_CHANGES_CANNOT_READ,
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
        template: CHECK_ACCOUNT_CHANGES_FACT_GOOGLE_GROUPS_SCOPE,
        values: { scope: SCOPE },
        mark: StepCheckFactMark.HowToCheck,
        link: {
          kind: ResponseLinkKind.OpenSecurityEventConnection,
          connectionId: GOOGLE_CONNECTION_ID,
        },
      },
      {
        template: CHECK_ACCOUNT_CHANGES_FACT_NO_CONNECTION,
        values: { provider: "Okta" },
        mark: StepCheckFactMark.HowToCheck,
        link: { kind: ResponseLinkKind.OpenSecurityEventConnection },
      },
    ],
    links: [],
    docsPath: "/telemetry/security-cases#how-oneuptime-checks-a-step",
    data: { changes: 2, stillThere: 0, undone: 0, toConfirm: 2 },
  };

  test("a reader who may change the connection - a Security Admin: its form, and the page to connect Okta", async () => {
    readAs([Permission.SecurityAdmin]);
    stepChecks = [
      check(SecurityCaseStepCheckState.CannotTell, WITH_GOOGLE_LINK),
    ];

    const step: HTMLElement = await drawn();

    expect(factLinks(step)).toEqual([
      [
        "Edit Connection",
        `${SECURITY_CONNECTIONS_PAGE}?connection=${GOOGLE_CONNECTION_ID}`,
      ],
      ["Open Security Event Connections", SECURITY_CONNECTIONS_PAGE],
    ]);
    // After the words of its own line, which say where the connection is.
    expect(lines(step)[1]).toEqual([
      StepCheckFactMark.HowToCheck,
      `${GOOGLE_LINE} Edit Connection`,
    ]);
  });

  test("a reader who may see connections but not change them - a Security Member: the page, where Edit says what it takes", async () => {
    stepChecks = [
      check(SecurityCaseStepCheckState.CannotTell, WITH_GOOGLE_LINK),
    ];

    const step: HTMLElement = await drawn();

    expect(factLinks(step)).toEqual([
      ["Open Security Event Connections", SECURITY_CONNECTIONS_PAGE],
      ["Open Security Event Connections", SECURITY_CONNECTIONS_PAGE],
    ]);
  });

  test("a reader who may not see Security Events > Connections gets no link: the words say where, for someone who may", async () => {
    jest.spyOn(PermissionUtil, "getAllPermissions").mockImplementation(() => {
      return [Permission.ProjectMember];
    });
    PermissionGate.clearPermissionPropsCache();
    stepChecks = [
      check(SecurityCaseStepCheckState.CannotTell, WITH_GOOGLE_LINK),
    ];

    const step: HTMLElement = await drawn();

    expect(factLinks(step)).toEqual([]);
    expect(lines(step)[1]).toEqual([StepCheckFactMark.HowToCheck, GOOGLE_LINE]);
  });

  test("a Project Admin may change both kinds: each line links to its own page", async () => {
    readAs([Permission.ProjectAdmin]);
    stepChecks = [
      check(SecurityCaseStepCheckState.CannotTell, {
        ...WITH_GOOGLE_LINK,
        facts: [
          ...WITH_GOOGLE_LINK.facts.slice(0, 2),
          {
            template: CHECK_ACCOUNT_CHANGES_FACT_AWS_NOT_GRANTED,
            values: { cloudAccount: "123456789012" },
            mark: StepCheckFactMark.HowToCheck,
            link: {
              kind: ResponseLinkKind.OpenCloudConnection,
              connectionId: CONNECTION_ID,
            },
          },
        ],
      }),
    ];

    const step: HTMLElement = await drawn();

    expect(factLinks(step)).toEqual([
      [
        "Edit Connection",
        `${SECURITY_CONNECTIONS_PAGE}?connection=${GOOGLE_CONNECTION_ID}`,
      ],
      ["Edit Connection", `${CONNECT_PAGE}?connection=${CONNECTION_ID}`],
    ]);
  });
});

describe("a way in open to anyone, under its role (#11378)", () => {
  const OPEN_ROLE: SecurityCaseStepCheckEvidence = {
    sentence: {
      template: CHECK_ACCOUNT_CHANGES_STILL_THERE,
      values: {},
      count: 1,
    },
    facts: [
      {
        template: CHECK_ACCOUNT_CHANGE_ROLE_MADE_STILL,
        values: { account: "backdoor", object: "", provider: "AWS" },
        mark: StepCheckFactMark.NotDone,
      },
      {
        template: CHECK_ACCOUNT_CHANGE_TRUSTS_EVERY_ACCOUNT,
        values: { account: "backdoor" },
        mark: StepCheckFactMark.Exposed,
      },
      {
        template: CHECK_ACCOUNT_CHANGE_PROVIDER_ANY_ORGANIZATION,
        values: {
          account: "backdoor",
          provider: "token.actions.githubusercontent.com",
          claim: "sub",
        },
        mark: StepCheckFactMark.Exposed,
      },
      {
        template: CHECK_ACCOUNT_CHANGE_PROVIDER_HELD,
        values: {
          account: "backdoor",
          provider: "accounts.google.com",
          claim: "aud",
          value: "666777888999000",
        },
      },
      {
        template: CHECK_ACCOUNT_CHANGE_PROVIDER_SAML,
        values: { account: "backdoor", provider: "Okta" },
      },
    ],
    links: [],
    data: { changes: 1, stillThere: 1, undone: 0, toConfirm: 0 },
  };

  test("each line under the role says plainly whom it lets in; the open ones are marked", async () => {
    stepChecks = [check(SecurityCaseStepCheckState.NotDone, OPEN_ROLE)];

    const step: HTMLElement = await drawn();

    expect(lines(step)).toEqual([
      [
        StepCheckFactMark.NotDone,
        "The role backdoor the attack made is still in AWS.",
      ],
      [
        StepCheckFactMark.Exposed,
        "Anyone in AWS may assume the role backdoor: its trust policy trusts every AWS account.",
      ],
      [
        StepCheckFactMark.Exposed,
        "Anyone with a token from token.actions.githubusercontent.com, in any organization, may assume the role backdoor: its trust policy does not limit the token's sub.",
      ],
      [
        "",
        "Tokens from accounts.google.com may assume the role backdoor when their aud matches 666777888999000.",
      ],
      [
        "",
        "The SAML provider Okta may sign people in to AWS as the role backdoor.",
      ],
    ]);
  });

  test("an open one starts where the role's words do, its own mark there, so it reads as part of the role", async () => {
    stepChecks = [check(SecurityCaseStepCheckState.NotDone, OPEN_ROLE)];

    const step: HTMLElement = await drawn();
    const drawnLines: Array<HTMLElement> = within(step).getAllByTestId(
      SECURITY_CASE_RESPONSE_TEST_IDS.checkFact,
    );
    const role: HTMLElement = drawnLines[0]!;
    const open: HTMLElement = drawnLines[1]!;
    const held: HTMLElement = drawnLines[3]!;

    // The role's line: its mark first, then its words.
    expect(role.children).toHaveLength(2);
    expect(role.children[0]!.querySelector("svg")).not.toBeNull();
    // The open line: the room of the role's mark, then its own, then its words.
    expect(open.children).toHaveLength(3);
    expect(open.children[0]!.tagName.toLowerCase()).toBe("span");
    expect(open.children[0]!.getAttribute("aria-hidden")).toBe("true");
    expect(open.children[0]!.querySelector("svg")).toBeNull();
    expect(
      open.children[1]!.querySelector("svg")?.getAttribute("class"),
    ).toContain("text-orange-600");
    expect(open.children[2]!.getAttribute("class")).toContain("text-gray-700");
    // A held one is a plain line under the role: no mark of its own.
    expect(held.querySelector("svg")).toBeNull();
    expect(held.children[0]!.getAttribute("aria-hidden")).toBe("true");
  });

  test("its mark is its own: an icon and a colour no other mark has", async () => {
    stepChecks = [
      check(SecurityCaseStepCheckState.NotDone, {
        ...OPEN_ROLE,
        facts: [...OPEN_ROLE.facts.slice(0, 2), ...LOOKS_DONE_TO_CONFIRM.facts],
      }),
    ];

    const step: HTMLElement = await drawn();
    const byMark: Map<string, string> = new Map();

    for (const line of within(step).getAllByTestId(
      SECURITY_CASE_RESPONSE_TEST_IDS.checkFact,
    )) {
      const mark: string = line.getAttribute("data-fact-mark") || "";
      const icon: Element | null = line.querySelector("svg");

      if (mark && icon) {
        byMark.set(mark, `${icon.getAttribute("class")} ${icon.innerHTML}`);
      }
    }

    expect([...byMark.keys()].sort()).toEqual(
      [
        StepCheckFactMark.Confirm,
        StepCheckFactMark.Done,
        StepCheckFactMark.Exposed,
        StepCheckFactMark.HowToCheck,
        StepCheckFactMark.NotDone,
      ].sort(),
    );
    expect(new Set(byMark.values()).size).toBe(byMark.size);
  });
});
