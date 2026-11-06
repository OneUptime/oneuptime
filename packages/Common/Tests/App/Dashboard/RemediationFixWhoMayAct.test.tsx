import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
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
import fs from "fs";
import i18next from "i18next";
import path from "path";
import * as React from "react";
import { initReactI18next } from "react-i18next";

// Only rendered when a fix's reasoning is opened; keep the lazy import out.
jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return React.createElement("div", { "data-testid": "markdown" });
    },
  };
});

import RemediationStep from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStep";
import {
  getRemediationFixActGate,
  getRemediationFixWhoMayAct,
  REMEDIATION_FIX_WHO_MAY_ACT,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationFixActGate";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import RunbookExecution from "../../../Models/DatabaseModels/RunbookExecution";
import { AiRemediationCommandPolicyVerdict } from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import { RemediationTrackRecordOutcome } from "../../../Types/AutoRemediation/RemediationTrackRecord";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import HeldPermissionsUtil from "../../../Types/HeldPermissions";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import { RUNBOOK_RUN_PERMISSIONS } from "../../../Types/Runbook/RunbookRunPermissions";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import {
  assertCanDismissFixes,
  assertCanExecuteRunbooks,
  RUNBOOK_EXECUTE_PERMISSIONS,
} from "../../../Server/Utils/Runbook/RunbookExecutePermission";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import User from "../../../UI/Utils/User";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * FIX BUTTONS FOR PEOPLE WHO MAY ACT (#5715's follow-up).
 *
 * The AI card's Remediation step showed Approve & Run, Dry run and Dismiss
 * fix to everyone who could read a fix, and the server then refused a
 * Viewer's press: all three ask permission to start runbook executions
 * (RunbookExecution's create list), on the card as in Slack and Microsoft
 * Teams. Now the step asks the reader's permission snapshot first, the way
 * Try again is offered only to someone who may change the record: a reader
 * it certainly refuses sees none of them - nor Review and approve, which
 * leads to them - and a quiet line in their place saying who may act and
 * what would let them. While the snapshot is on its way, the buttons stay
 * and the server decides. The card and the server ask exactly the same
 * question, and a matrix below holds them to it, permission by permission.
 */

const INCIDENT_ID: ObjectID = new ObjectID(
  "0193c0de-3333-4aaa-8bbb-0000000000a1",
);
const SUGGESTION_ID: string = "0193c0de-6666-4aaa-8bbb-0000000000a2";
const RUNBOOK_ID: string = "0193c0de-7777-4aaa-8bbb-0000000000a3";
const RUN_ID: string = "0193c0de-8888-4aaa-8bbb-0000000000a4";
const ACCOUNT_ID: string = "0193c0de-9999-4aaa-8bbb-0000000000a5";
const AGENT_ID: string = "0193c0de-aaaa-4aaa-8bbb-0000000000a6";
const EARLIER_INCIDENT_ID: string = "0193c0de-bbbb-4aaa-8bbb-0000000000a7";
const ECS: string = "arn:aws:ecs:us-east-1:123456789012:service/prod/web";

// The line for a fix that waits for approval, as the card writes it.
const APPROVE_OR_DISMISS_LINE: string =
  "Only someone who may start runbook executions can approve or dismiss this fix. You need this permission: Create Runbook Execution.";
// The line for a fix that can only be dismissed.
const DISMISS_LINE: string =
  "Only someone who may start runbook executions can dismiss this fix. You need this permission: Create Runbook Execution.";

const BUTTON_TEST_IDS: ReadonlyArray<string> = [
  "remediation-approve-button",
  "remediation-dry-run-button",
  "remediation-dismiss-button",
  "remediation-fix-details-toggle",
];

function runbookFix(
  overrides: Partial<Record<string, unknown>> = {},
): AutoRemediationSuggestion {
  return Object.assign(new AutoRemediationSuggestion(), {
    _id: SUGGESTION_ID,
    status: AutoRemediationSuggestionStatus.Suggested,
    suggestionType: AutoRemediationSuggestionType.Runbook,
    ruleNameSnapshot: "Restart checkout",
    runbookNameSnapshot: "Restart the checkout pods",
    runbookId: new ObjectID(RUNBOOK_ID),
    runbookTrackRecord: {
      workedCount: 1,
      didNotWorkCount: 0,
      runs: [
        {
          subjectKind: "incident",
          subjectId: EARLIER_INCIDENT_ID,
          subjectNumber: "INC-41",
          ranAt: "2026-10-28T10:00:00.000Z",
          outcome: RemediationTrackRecordOutcome.Worked,
        },
      ],
    } as unknown as JSONObject,
    createdAt: new Date("2026-11-03T10:00:00Z"),
    ...overrides,
  });
}

function planCommand(
  overrides: Partial<Record<string, unknown>> = {},
): JSONObject {
  return {
    sequence: 1,
    stepType: RunbookStepType.ResourceCommand,
    runnerId: AGENT_ID,
    runnerNameSnapshot: "Cloud AI agent",
    resourceType: AiResourceType.AwsAccount,
    resourceId: ACCOUNT_ID,
    resourceNameSnapshot: "prod",
    resourceCommandTier: "SafeWrite",
    command: `cloud scale-out ${ECS} --count 4`,
    timeoutInMs: 60000,
    rationale: "Tasks are saturated.",
    expectedEffect: "Latency drops.",
    policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
    ...overrides,
  } as JSONObject;
}

// A fix that changes a cloud account: it can be dry-run before approval.
function cloudFix(
  overrides: Partial<Record<string, unknown>> = {},
): AutoRemediationSuggestion {
  return Object.assign(new AutoRemediationSuggestion(), {
    _id: SUGGESTION_ID,
    status: AutoRemediationSuggestionStatus.Suggested,
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    ruleNameSnapshot: 'AI remediation for AWS account "prod"',
    resourceType: AiResourceType.AwsAccount,
    resourceId: new ObjectID(ACCOUNT_ID),
    commandPlan: { commands: [planCommand()] } as JSONObject,
    createdAt: new Date("2026-11-03T10:00:00Z"),
    ...overrides,
  });
}

// A plan composed before runbook credentials were removed: only dismissed.
function sshFix(): AutoRemediationSuggestion {
  return cloudFix({
    resourceType: undefined,
    resourceId: undefined,
    ruleNameSnapshot: "Restart API pods",
    commandPlan: {
      commands: [
        planCommand({
          stepType: RunbookStepType.SSH,
          resourceType: undefined,
          resourceId: undefined,
          resourceNameSnapshot: undefined,
          resourceCommandTier: undefined,
          command: "systemctl restart api",
        }),
      ],
    } as JSONObject,
  });
}

let served: Array<AutoRemediationSuggestion> = [];
let postSpy: ReturnType<typeof jest.spyOn>;

function row(permission: Permission, isBlock: boolean = false): UserPermission {
  return {
    _type: "UserPermission",
    permission,
    labelIds: [],
    isBlockPermission: isBlock,
  };
}

/*
 * The reader's permission snapshot, as the API's response headers leave it
 * in storage: their rows in the project, and what they hold of them.
 */
function asReader(rows: Array<UserPermission>): void {
  jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue({
    _type: "UserTenantAccessPermission",
    projectId: new ObjectID(PROJECT_ID),
    permissions: rows,
    isBlockPermission: false,
  } as unknown as UserTenantAccessPermission);
  jest
    .spyOn(PermissionUtil, "getAllPermissions")
    .mockReturnValue(
      HeldPermissionsUtil.getUnblockedPermissions(
        HeldPermissionsUtil.fromRows({ rows, globalPermissions: [] }),
      ),
    );
}

// A reader holding these permissions, and nothing blocked.
function holding(...permissions: Array<Permission>): void {
  asReader(
    permissions.map((permission: Permission): UserPermission => {
      return row(permission);
    }),
  );
}

async function renderStep(
  rows: Array<AutoRemediationSuggestion>,
): Promise<HTMLElement> {
  served = rows;
  render(
    <RemediationStep investigationStage="reported" incidentId={INCIDENT_ID} />,
  );

  return await screen.findByTestId("remediation-fix");
}

function buttonsIn(fix: HTMLElement): Array<string> {
  return BUTTON_TEST_IDS.filter((testId: string): boolean => {
    return within(fix).queryByTestId(testId) !== null;
  });
}

function whoMayActLine(fix: HTMLElement): HTMLElement | null {
  return within(fix).queryByTestId("remediation-fix-who-may-act");
}

// Opens a fix's plan step on its own line, as a reader may without Review and approve.
function openPlanStep(fix: HTMLElement): void {
  const plan: HTMLElement | undefined = within(fix)
    .getAllByTestId("remediation-fix-step")
    .find((step: HTMLElement): boolean => {
      return step.getAttribute("data-step") === "plan";
    });

  fireEvent.click(within(plan!).getByTestId("remediation-fix-step-toggle"));
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/incidents/${INCIDENT_ID.toString()}`);
  served = [];
  jest.spyOn(ModelAPI, "getList").mockImplementation((async (data: {
    modelType: unknown;
  }): Promise<ListResult<AutoRemediationSuggestion>> => {
    // The step reads its decisions beside its fixes: none here.
    if (data.modelType !== AutoRemediationSuggestion) {
      return { data: [], count: 0, skip: 0, limit: 5 };
    }

    return { data: served, count: served.length, skip: 0, limit: 10 };
  }) as never);
  postSpy = jest.spyOn(API, "post");
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a runbook fix that waits for approval", () => {
  test.each([
    ["Project Owner", Permission.ProjectOwner],
    ["Project Admin", Permission.ProjectAdmin],
    ["Project Member", Permission.ProjectMember],
    ["Runbook Admin", Permission.RunbookAdmin],
    ["Runbook Member", Permission.RunbookMember],
    ["Create Runbook Execution", Permission.CreateRunbookExecution],
  ])(
    "someone holding %s, who may start runbook executions, is offered Approve & Run and Dismiss fix",
    async (_name: string, permission: Permission) => {
      holding(permission);
      const fix: HTMLElement = await renderStep([runbookFix()]);

      expect(
        within(fix).getByTestId("remediation-approve-button"),
      ).toHaveTextContent("Approve & Run");
      expect(
        within(fix).getByTestId("remediation-dismiss-button"),
      ).toHaveTextContent("Dismiss fix");
      expect(
        within(fix).getByTestId("remediation-approval-note"),
      ).toBeInTheDocument();
      expect(whoMayActLine(fix)).toBeNull();
    },
  );

  test.each([
    ["Viewer", Permission.Viewer],
    ["Runbook Viewer", Permission.RunbookViewer],
    ["Incident Member", Permission.IncidentMember],
    ["Incident Admin", Permission.IncidentAdmin],
    // Moves a run along, and starts none.
    ["Edit Runbook Execution", Permission.EditRunbookExecution],
    ["Read Runbook Execution", Permission.ReadRunbookExecution],
  ])(
    "someone holding %s alone sees no button, and a quiet line saying who may act in their place",
    async (_name: string, permission: Permission) => {
      holding(permission);
      const fix: HTMLElement = await renderStep([runbookFix()]);

      expect(buttonsIn(fix)).toEqual([]);
      expect(within(fix).queryByTestId("remediation-approval-note")).toBeNull();
      expect(whoMayActLine(fix)).toHaveTextContent(APPROVE_OR_DISMISS_LINE);
      // Where the buttons would be: under the fix's approval step.
      expect(
        whoMayActLine(fix)?.closest("[data-testid='remediation-fix-step']"),
      ).toHaveAttribute("data-step", "approval");
      // The record of how the runbook went is still there to read.
      expect(
        within(fix).getByTestId("remediation-runbook-track-record"),
      ).toBeInTheDocument();
      // Nothing is asked of the server for them.
      expect(postSpy).not.toHaveBeenCalled();
    },
  );

  test("the line is quiet: a lock and small grey words, never a button or an alert", async () => {
    holding(Permission.Viewer);
    const fix: HTMLElement = await renderStep([runbookFix()]);
    const line: HTMLElement = whoMayActLine(fix)!;

    expect(line).toHaveClass("text-xs", "text-gray-500");
    expect(line.querySelector("svg")).not.toBeNull();
    expect(line).not.toHaveAttribute("role");
    expect(within(line).queryByRole("button")).toBeNull();
  });

  test("a team's block of the permission stops them, and the line names the block", async () => {
    asReader([
      row(Permission.ProjectMember),
      row(Permission.CreateRunbookExecution, true),
    ]);
    const fix: HTMLElement = await renderStep([runbookFix()]);

    expect(buttonsIn(fix)).toEqual([]);
    expect(whoMayActLine(fix)).toHaveTextContent(
      "Only someone who may start runbook executions can approve or dismiss this fix. A team you are on blocks Create Runbook Execution.",
    );
  });

  test("before the permission snapshot lands, the buttons stay and the server decides", async () => {
    jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue(null);
    jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue([]);
    const fix: HTMLElement = await renderStep([runbookFix()]);

    expect(buttonsIn(fix)).toEqual([
      "remediation-approve-button",
      "remediation-dismiss-button",
    ]);
    expect(whoMayActLine(fix)).toBeNull();
  });

  test("a master admin, who may do everything, is offered them with no permission of their own", async () => {
    jest.spyOn(User, "isMasterAdmin").mockReturnValue(true);
    holding(Permission.Viewer);
    const fix: HTMLElement = await renderStep([runbookFix()]);

    expect(buttonsIn(fix)).toEqual([
      "remediation-approve-button",
      "remediation-dismiss-button",
    ]);
    expect(whoMayActLine(fix)).toBeNull();
  });
});

describe("a cloud fix that waits for approval", () => {
  test("someone who may act opens it with Review and approve, to Approve & Run, Dry run and Dismiss fix", async () => {
    holding(Permission.RunbookMember);
    const fix: HTMLElement = await renderStep([cloudFix()]);

    expect(buttonsIn(fix)).toEqual(["remediation-fix-details-toggle"]);

    fireEvent.click(within(fix).getByTestId("remediation-fix-details-toggle"));

    await waitFor(() => {
      expect(buttonsIn(fix)).toEqual([
        "remediation-approve-button",
        "remediation-dry-run-button",
        "remediation-dismiss-button",
        "remediation-fix-details-toggle",
      ]);
    });
    expect(whoMayActLine(fix)).toBeNull();
  });

  test("someone who may not act has no Review and approve; the plan opens on its own line, with no button under it", async () => {
    holding(Permission.Viewer);
    const fix: HTMLElement = await renderStep([cloudFix()]);

    expect(buttonsIn(fix)).toEqual([]);
    expect(whoMayActLine(fix)).toHaveTextContent(APPROVE_OR_DISMISS_LINE);

    // What it would change is still theirs to read.
    openPlanStep(fix);

    expect(
      await within(fix).findByTestId("remediation-fix-step-details"),
    ).toBeInTheDocument();
    expect(fix).toHaveTextContent(`cloud scale-out ${ECS} --count 4`);
    expect(buttonsIn(fix)).toEqual([]);
    expect(whoMayActLine(fix)).toHaveTextContent(APPROVE_OR_DISMISS_LINE);
    expect(postSpy).not.toHaveBeenCalled();
  });
});

describe("a fix that can only be dismissed", () => {
  test("one still being worked out: Dismiss fix for someone who may act", async () => {
    holding(Permission.ProjectMember);
    const fix: HTMLElement = await renderStep([
      runbookFix({
        status: AutoRemediationSuggestionStatus.Planning,
        runbookNameSnapshot: undefined,
        runbookId: undefined,
        runbookTrackRecord: undefined,
      }),
    ]);

    expect(buttonsIn(fix)).toEqual(["remediation-dismiss-button"]);
    expect(whoMayActLine(fix)).toBeNull();
  });

  test("one still being worked out: the line says only someone who may start runbook executions can dismiss it", async () => {
    holding(Permission.Viewer);
    const fix: HTMLElement = await renderStep([
      runbookFix({
        status: AutoRemediationSuggestionStatus.Planning,
        runbookNameSnapshot: undefined,
        runbookId: undefined,
        runbookTrackRecord: undefined,
      }),
    ]);

    expect(buttonsIn(fix)).toEqual([]);
    expect(whoMayActLine(fix)).toHaveTextContent(DISMISS_LINE);
  });

  test("a plan that can no longer be approved keeps its own note, and says who may dismiss it", async () => {
    holding(Permission.Viewer);
    const fix: HTMLElement = await renderStep([sshFix()]);

    expect(
      within(fix).getByTestId("remediation-removed-ssh-note"),
    ).toBeInTheDocument();
    expect(buttonsIn(fix)).toEqual([]);
    expect(whoMayActLine(fix)).toHaveTextContent(DISMISS_LINE);
  });
});

describe("a fix with nothing left to decide", () => {
  test("an approved runbook fix says nothing about who may act, and still opens its run", async () => {
    holding(Permission.Viewer);
    const fix: HTMLElement = await renderStep([
      runbookFix({
        status: AutoRemediationSuggestionStatus.Approved,
        runbookExecutionId: new ObjectID(RUN_ID),
        approvedAt: new Date("2026-11-03T10:05:00Z"),
      }),
    ]);

    expect(whoMayActLine(fix)).toBeNull();
    expect(buttonsIn(fix)).toEqual([]);
    expect(within(fix).getByText("View Execution")).toBeInTheDocument();
  });

  test.each([
    AutoRemediationSuggestionStatus.Dismissed,
    AutoRemediationSuggestionStatus.AutoExecuted,
    AutoRemediationSuggestionStatus.NoneApplicable,
  ])("a fix whose status is %s: no line, no button", async (status: string) => {
    holding(Permission.Viewer);
    const fix: HTMLElement = await renderStep([
      runbookFix({
        status: status as AutoRemediationSuggestionStatus,
        runbookTrackRecord: undefined,
      }),
    ]);

    expect(whoMayActLine(fix)).toBeNull();
    expect(buttonsIn(fix)).toEqual([]);
  });
});

/*
 * THE CARD AND THE SERVER ASK THE SAME QUESTION. The server refuses a fix's
 * approval, dry run and dismissal to whoever holds none of the run list
 * (RemediationApproval: assertCanExecuteRunbooks, assertCanDismissFixes),
 * the chats ask RunbookExecution's create list (WorkspaceRemediationActions),
 * and the card's gate reads the same list. Here, for every permission there
 * is - held alone, held and blocked, held beside a block of each run
 * permission - the card offers the buttons exactly when the server would
 * let the press through.
 */
describe("the card's gate and the server's check agree", () => {
  const PROJECT: ObjectID = new ObjectID(PROJECT_ID);

  function serverProps(
    rows: Array<UserPermission>,
  ): DatabaseCommonInteractionProps {
    return {
      tenantId: PROJECT,
      userId: new ObjectID("0193c0de-cccc-4aaa-8bbb-0000000000a8"),
      userTenantAccessPermission: {
        [PROJECT_ID]: {
          _type: "UserTenantAccessPermission",
          projectId: PROJECT,
          permissions: rows,
          isBlockPermission: false,
        } as unknown as UserTenantAccessPermission,
      },
    } as DatabaseCommonInteractionProps;
  }

  function serverAllows(
    check: (props: DatabaseCommonInteractionProps, projectId: ObjectID) => void,
    rows: Array<UserPermission>,
  ): boolean {
    try {
      check(serverProps(rows), PROJECT);
      return true;
    } catch {
      return false;
    }
  }

  function cardAllows(rows: Array<UserPermission>): boolean {
    const held: ReturnType<typeof HeldPermissionsUtil.fromRows> =
      HeldPermissionsUtil.fromRows({ rows, globalPermissions: [] });

    for (const act of ["approveOrDismiss", "dismiss"] as const) {
      const gate: ReturnType<typeof getRemediationFixActGate> =
        getRemediationFixActGate(act, { held });

      // A snapshot that holds something is a snapshot: never "not landed".
      expect(getRemediationFixWhoMayAct(gate) === undefined).toBe(
        gate.isAllowed,
      );
    }

    return getRemediationFixActGate("approveOrDismiss", { held }).isAllowed;
  }

  function expectAgreement(rows: Array<UserPermission>): void {
    const card: boolean = cardAllows(rows);
    const context: string = JSON.stringify(
      rows.map((candidate: UserPermission): string => {
        return `${candidate.isBlockPermission ? "block" : "allow"} ${candidate.permission}`;
      }),
    );

    expect({
      context,
      approve: serverAllows(assertCanExecuteRunbooks, rows),
    }).toEqual({ context, approve: card });
    expect({
      context,
      dismiss: serverAllows(assertCanDismissFixes, rows),
    }).toEqual({ context, dismiss: card });
  }

  test("every permission held alone", () => {
    for (const permission of Object.values(Permission)) {
      expectAgreement([row(permission as Permission)]);
    }
  });

  test("every run permission held beside a block of each one", () => {
    for (const held of RUNBOOK_RUN_PERMISSIONS) {
      for (const blocked of RUNBOOK_RUN_PERMISSIONS) {
        expectAgreement([row(held), row(blocked, true)]);
      }
    }
  });

  test("a block of a permission the action does not ask leaves a run permission working", () => {
    expectAgreement([
      row(Permission.RunbookMember),
      row(Permission.EditIncident, true),
    ]);
    expect(
      cardAllows([
        row(Permission.RunbookMember),
        row(Permission.EditIncident, true),
      ]),
    ).toBe(true);
  });

  test("one list: the server's, the chats' (RunbookExecution's create list) and the card's", () => {
    const sorted: (list: ReadonlyArray<Permission>) => Array<Permission> = (
      list: ReadonlyArray<Permission>,
    ): Array<Permission> => {
      return [...list].sort();
    };

    expect(sorted(RUNBOOK_EXECUTE_PERMISSIONS)).toEqual(
      sorted(RUNBOOK_RUN_PERMISSIONS),
    );
    expect(sorted(new RunbookExecution().getCreatePermissions())).toEqual(
      sorted(RUNBOOK_RUN_PERMISSIONS),
    );
  });

  test("the line's first sentence for each act is its own key", () => {
    expect(REMEDIATION_FIX_WHO_MAY_ACT.approveOrDismiss).toBe(
      "Only someone who may start runbook executions can approve or dismiss this fix.",
    );
    expect(REMEDIATION_FIX_WHO_MAY_ACT.dismiss).toBe(
      "Only someone who may start runbook executions can dismiss this fix.",
    );
  });
});

/*
 * IN THE READER'S LANGUAGE. The line is one sentence of its own in every
 * language, then the product's own sentence for what would let the reader
 * (the permission's title, as every lock names it). Last in the file: it
 * leaves i18next set up, in English.
 */
describe("the line in the reader's language", () => {
  const LOCALES_DIR: string = path.resolve(
    __dirname,
    "../../../../App/FeatureSet/Dashboard/src/Locales",
  );
  const LANGUAGES: Array<string> = ["en", "de", "fa", "ja", "ru"];

  function readLocale(language: string): Record<string, string> {
    return JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
    ) as Record<string, string>;
  }

  // What the locale says: its sentence, then what would let the reader.
  function expectedLine(language: string, firstSentence: string): string {
    const locale: Record<string, string> = readLocale(language);
    const needs: string = locale["You need this permission: {{permission}}."]!;

    return `${locale[firstSentence]} ${needs.replace(
      "{{permission}}",
      "Create Runbook Execution",
    )}`;
  }

  beforeAll(async () => {
    await i18next.use(initReactI18next).init({
      lng: "en",
      fallbackLng: "en",
      resources: Object.fromEntries(
        LANGUAGES.map((language: string) => {
          return [language, { translation: readLocale(language) }];
        }),
      ),
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
  });

  afterAll(async () => {
    await i18next.changeLanguage("en");
  });

  test.each(["de", "fa", "ja", "ru"])(
    "%s: a fix that waits for approval",
    async (language: string) => {
      await i18next.changeLanguage(language);
      holding(Permission.Viewer);
      const fix: HTMLElement = await renderStep([runbookFix()]);

      const line: string = withoutIsolateMarks(
        whoMayActLine(fix)?.textContent || "",
      );

      expect(line).toBe(
        expectedLine(language, REMEDIATION_FIX_WHO_MAY_ACT.approveOrDismiss),
      );
      // Its own words, never the English sentence.
      expect(line).not.toContain("Only someone");
    },
  );

  test.each(["de", "fa", "ja", "ru"])(
    "%s: a fix that can only be dismissed",
    async (language: string) => {
      await i18next.changeLanguage(language);
      holding(Permission.Viewer);
      const fix: HTMLElement = await renderStep([sshFix()]);

      expect(withoutIsolateMarks(whoMayActLine(fix)?.textContent || "")).toBe(
        expectedLine(language, REMEDIATION_FIX_WHO_MAY_ACT.dismiss),
      );
    },
  );

  test("English reads as the key, word for word", async () => {
    await i18next.changeLanguage("en");
    holding(Permission.Viewer);
    const fix: HTMLElement = await renderStep([runbookFix()]);

    expect(whoMayActLine(fix)).toHaveTextContent(APPROVE_OR_DISMISS_LINE);
  });
});
