import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { SpyInstance } from "jest-mock";
import * as React from "react";
import DeclaredCodeChangeLine from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/DeclaredCodeChangeLine";
import DeclaredCodeChangeDialog, {
  readDeclaredCodeOwner,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/DeclaredCodeChangeDialog";
import {
  DECLARED_CODE_DIALOG_WHO_SEES,
  DECLARED_CODE_DIALOG_WHO_SEES_PRIVATE_ALERT,
  DECLARED_CODE_DIALOG_WHO_SEES_PRIVATE_INCIDENT,
  getDeclaredCodeWhoSeesNote,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/DeclaredCodeChangeWords";
import RemediationCodeFix from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationCodeFix";
import { REMEDIATION_FIX_PULL_REQUEST_WHO_MAY_OPEN } from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationFixActGate";
import { REMEDIATION_CODE_FIX_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStepCopy";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import {
  AiRemediationCommand,
  AiRemediationCommandPolicyVerdict,
} from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import { HeldPermissions } from "../../../Types/HeldPermissions";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import {
  PrivateRecordScope,
  PrivateRecordScopeContext,
} from "../../../UI/Utils/PrivateRecordScope";
import {
  DeclaredCodeChangeState,
  DeclaredCodeKind,
  DeclaredCodeOwnerJSON,
  DeclaredCodeOwnerReason,
} from "../../../Utils/AiRemediation/DeclaredCodeChange";
import {
  InvestigationCodeFixSuggestion,
  NO_INVESTIGATION_CODE_FIX_SUGGESTION,
} from "../../../Utils/Suggestions/InvestigationCodeFixSuggestion";
import SuggestionOffer from "../../../Utils/Suggestions/SuggestionOffer";
import { keepProjectPermissionsInTab } from "../../Helpers/TabProjectPermissions";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * OPENING A PULL REQUEST FROM A PRIVATE INCIDENT OR ALERT IS LOCKED FOR
 * THOSE ITS OWNERS DO NOT LET (#9106, #9165).
 *
 * On the Remediation step of a private record's AI card, Open fix pull
 * request (the fix in the code its investigation recommends) and Open a pull
 * request to the code (under a fix's step, with its Try again) take what
 * approving one of the record's fixes takes, through the teams that own it,
 * as the server asks (RemediationApproval.assertReachesFixSubject). So they
 * are locked as Approve & Run is: in their place, a lock and why, with the
 * record's reason - for a reader whose team that owns it may only view it,
 * though another team of theirs may change Code and run fixes. Offered once
 * that team may approve its fixes, and on a record that is not private.
 *
 * And the dialog that asks before opening a pull request to the code says
 * who reads it: everyone with access to the repository, with the change
 * and its description - and, for a private record's fix, that it leaves the
 * record out.
 *
 * The REAL components, under the scope a private record's layout provides
 * and the reader's REAL permission snapshot - the rows the API's headers
 * leave in storage. Only the network is stubbed.
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

const SUBJECT_ID: string = "0193c0de-1111-4aaa-8bbb-000000000201";
const RUN_ID: string = "0193c0de-2222-4aaa-8bbb-000000000202";
const SUGGESTION_ID: string = "0193c0de-3333-4aaa-8bbb-000000000203";
const TASK_ID: string = "0193c0de-4444-4aaa-8bbb-000000000204";
const REPOSITORY_ID: string = "0193c0de-5555-4aaa-8bbb-000000000205";
const TEAM_1: string = "0193c0de-6666-4aaa-8bbb-0000000002a1";
const TEAM_2: string = "0193c0de-7777-4aaa-8bbb-0000000002a2";
const ECS: string = "arn:aws:ecs:us-east-1:123456789012:service/prod/web";

// What the record's layout says after a lock's first sentence.
const REASON: string =
  "This incident is private, so it is changed only with the permissions of the teams that own it, and Team 2, your team that owns it, may not do this.";

function row(permission: Permission, teamId?: string): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: [],
    isBlockPermission: false,
    ...(teamId ? { teamId: new ObjectID(teamId) } : {}),
  };
}

/*
 * The reader: Team 1 may change everything - Code included - and Team 2,
 * the only team that owns the private record, may only view it.
 */
const READER_ROWS: Array<UserPermission> = [
  row(Permission.CurrentUser),
  row(Permission.ProjectUser),
  row(Permission.ProjectMember, TEAM_1),
  row(Permission.Viewer, TEAM_2),
];

function store(rows: Array<UserPermission>): void {
  PermissionUtil.setGlobalPermissions({
    _type: "UserGlobalAccessPermission",
    globalPermissions: [Permission.Public, Permission.User],
    projectIds: [new ObjectID(PROJECT_ID)],
  });
  keepProjectPermissionsInTab({
    _type: "UserTenantAccessPermission",
    projectId: new ObjectID(PROJECT_ID),
    permissions: rows,
  });
}

// What a private incident's layout provides: what the reader holds on it, by Team 2.
function privateIncident(): PrivateRecordScope {
  const held: HeldPermissions | null = PermissionGate.getHeldOnPrivateRecord({
    isPrivate: true,
    isOwnedByReader: false,
    owningTeamIds: [TEAM_2],
  });

  expect(held).not.toBeNull();

  return { tableName: "Incident", held: held!, reason: REASON };
}

function command(): AiRemediationCommand {
  return {
    sequence: 1,
    stepType: RunbookStepType.ResourceCommand,
    runnerId: ObjectID.generate().toString(),
    runnerNameSnapshot: "Cloud AI agent",
    resourceType: AiResourceType.AwsAccount,
    resourceId: "0193c0de-8888-4aaa-8bbb-000000000208",
    resourceNameSnapshot: "prod",
    resourceCommandTier: ResourceCommandTier.SafeWrite,
    managedAsCode: "Terraform",
    command: `cloud scale-out ${ECS} --count 4`,
    timeoutInMs: 60000,
    rationale: "Too few tasks.",
    expectedEffect: "Latency falls.",
    policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
  } as AiRemediationCommand;
}

const OWNER: DeclaredCodeOwnerJSON = {
  sequence: 1,
  managedAsCode: "Terraform",
  codeKind: DeclaredCodeKind.Terraform,
  sentence: "Scale the ECS service web out to 4 tasks",
  target: { resourceType: "aws_ecs_service", attribute: "desired_count" },
  candidates: [
    {
      repositoryId: REPOSITORY_ID,
      name: "platform",
      fullName: "acme/platform",
      reason: DeclaredCodeOwnerReason.HasNamedFile,
      matchedPaths: ["envs/prod/web/main.tf"],
      isBest: true,
      canAsk: true,
    },
  ],
};

let changesAnswer: JSONObject;
let ownerAnswer: JSONObject;
let postSpy: SpyInstance<typeof API.post>;

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

async function under(
  scope: PrivateRecordScope | null,
  element: React.ReactElement,
): Promise<void> {
  await act(async () => {
    render(
      <PrivateRecordScopeContext.Provider value={scope}>
        {element}
      </PrivateRecordScopeContext.Provider>,
    );
  });
  await flush();
}

function codeFix(
  // The repositories to pick from, when the step asks which (#11209).
  repositories: Array<{ id: string; name: string }> = [],
): React.ReactElement {
  const suggestion: InvestigationCodeFixSuggestion = {
    ...NO_INVESTIGATION_CODE_FIX_SUGGESTION,
    offer: SuggestionOffer.Act,
    repositories,
  };

  return (
    <RemediationCodeFix
      signal="incident"
      subjectId={SUBJECT_ID}
      investigationRunId={RUN_ID}
      suggestion={suggestion}
      onChanged={() => {
        return;
      }}
    />
  );
}

function declaredCodeLine(): React.ReactElement {
  return (
    <DeclaredCodeChangeLine suggestionId={SUGGESTION_ID} command={command()} />
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  PermissionGate.clearPermissionPropsCache();
  goTo(`/dashboard/${PROJECT_ID}/incidents/${SUBJECT_ID}`);
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
  changesAnswer = { changes: [] };
  ownerAnswer = OWNER as unknown as JSONObject;
  postSpy = jest.spyOn(API, "post").mockImplementation((async (
    request: unknown,
  ): Promise<unknown> => {
    const url: string = String((request as JSONObject)["url"]);

    if (url.endsWith("/auto-remediation/declared-code-owner")) {
      return new HTTPResponse<JSONObject>(200, ownerAnswer, {});
    }

    if (url.endsWith("/auto-remediation/declared-code-changes")) {
      return new HTTPResponse<JSONObject>(200, changesAnswer, {});
    }

    return new HTTPResponse<JSONObject>(200, {}, {});
  }) as never) as unknown as SpyInstance<typeof API.post>;
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  jest.restoreAllMocks();
});

describe("Open fix pull request, on a private incident's AI card", () => {
  test("a reader whose team that owns it may only view it: locked in its place, saying why, and nothing asked", async () => {
    store(READER_ROWS);
    await under(privateIncident(), codeFix());

    expect(
      screen.queryByTestId("remediation-code-fix-open"),
    ).not.toBeInTheDocument();

    const lock: HTMLElement = screen.getByTestId("remediation-code-fix-locked");

    expect(lock).toHaveTextContent(REMEDIATION_FIX_PULL_REQUEST_WHO_MAY_OPEN);
    expect(lock.textContent!.endsWith(REASON)).toBe(true);
    expect(postSpy).not.toHaveBeenCalled();
  });

  test("a reader it is locked from is asked no repository to pick: the lock is the step", async () => {
    store(READER_ROWS);
    await under(
      privateIncident(),
      codeFix([
        { id: "51000000-0000-4000-8000-000000000001", name: "checkout-api" },
        { id: "51000000-0000-4000-8000-000000000002", name: "billing" },
      ]),
    );

    expect(screen.getByTestId("remediation-code-fix-locked")).toHaveTextContent(
      REMEDIATION_FIX_PULL_REQUEST_WHO_MAY_OPEN,
    );
    expect(
      screen.queryByTestId("remediation-code-fix-repository"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("remediation-code-fix-open"),
    ).not.toBeInTheDocument();
  });

  test("once the team that owns it may approve its fixes, it is offered", async () => {
    store([...READER_ROWS, row(Permission.RunbookMember, TEAM_2)]);
    await under(privateIncident(), codeFix());

    expect(screen.getByTestId("remediation-code-fix-open")).toHaveTextContent(
      REMEDIATION_CODE_FIX_COPY.openPullRequest,
    );
    expect(
      screen.queryByTestId("remediation-code-fix-locked"),
    ).not.toBeInTheDocument();
  });

  test("on a record that is not private, it is offered as before", async () => {
    store(READER_ROWS);
    await under(null, codeFix());

    expect(screen.getByTestId("remediation-code-fix-open")).toBeInTheDocument();
    expect(
      screen.queryByTestId("remediation-code-fix-locked"),
    ).not.toBeInTheDocument();
  });

  test("before the permission snapshot lands, it is offered, the server keeping the last word", async () => {
    await under(privateIncident(), codeFix());

    expect(screen.getByTestId("remediation-code-fix-open")).toBeInTheDocument();
  });
});

describe("Open a pull request to the code, under a private incident's fix", () => {
  test("a reader whose team that owns it may only view it: locked in its place, saying why", async () => {
    store(READER_ROWS);
    await under(privateIncident(), declaredCodeLine());

    const line: HTMLElement = screen.getByTestId("declared-code-change");

    expect(line).toHaveAttribute("data-state", "locked");
    expect(
      screen.queryByTestId("declared-code-change-ask"),
    ).not.toBeInTheDocument();

    const lock: HTMLElement = screen.getByTestId("declared-code-change-locked");

    expect(lock).toHaveTextContent(REMEDIATION_FIX_PULL_REQUEST_WHO_MAY_OPEN);
    expect(lock.textContent!.endsWith(REASON)).toBe(true);
  });

  test("its failed pull request offers no Try again to such a reader, and says why", async () => {
    store(READER_ROWS);
    changesAnswer = {
      changes: [
        {
          sequence: 1,
          taskId: TASK_ID,
          repositoryName: "acme/platform",
          state: DeclaredCodeChangeState.Failed,
        },
      ],
    };
    await under(privateIncident(), declaredCodeLine());

    expect(screen.getByTestId("declared-code-change")).toHaveAttribute(
      "data-state",
      DeclaredCodeChangeState.Failed,
    );
    expect(
      screen.queryByTestId("declared-code-change-try-again"),
    ).not.toBeInTheDocument();
    // The task stays one click away: reading it is not acting on the record.
    expect(screen.getByTestId("declared-code-change-task")).toBeInTheDocument();
    expect(
      screen
        .getByTestId("declared-code-change-locked")
        .textContent!.endsWith(REASON),
    ).toBe(true);
  });

  test("once the team that owns it may approve its fixes, both are offered", async () => {
    store([...READER_ROWS, row(Permission.RunbookMember, TEAM_2)]);
    await under(privateIncident(), declaredCodeLine());

    expect(screen.getByTestId("declared-code-change")).toHaveAttribute(
      "data-state",
      "offered",
    );
    expect(screen.getByTestId("declared-code-change-ask")).toBeInTheDocument();
  });

  test("on a record that is not private, it is offered as before", async () => {
    store(READER_ROWS);
    await under(null, declaredCodeLine());

    expect(screen.getByTestId("declared-code-change-ask")).toBeInTheDocument();
    expect(
      screen.queryByTestId("declared-code-change-locked"),
    ).not.toBeInTheDocument();
  });
});

describe("the dialog that asks before opening a pull request to the code", () => {
  async function whoSees(): Promise<HTMLElement> {
    await under(
      null,
      <DeclaredCodeChangeDialog
        suggestionId={SUGGESTION_ID}
        command={command()}
        onClose={() => {
          return;
        }}
        onAsked={() => {
          return;
        }}
      />,
    );

    return await screen.findByTestId("declared-code-dialog-who-sees");
  }

  test("says that everyone with access to the repository can see the pull request, with the change and its description", async () => {
    const note: HTMLElement = await whoSees();

    expect(note).toHaveTextContent(DECLARED_CODE_DIALOG_WHO_SEES);
    expect(note).toHaveAttribute("data-private-record", "");
    expect(note).not.toHaveTextContent("private");
  });

  test.each([
    ["incident", DECLARED_CODE_DIALOG_WHO_SEES_PRIVATE_INCIDENT],
    ["alert", DECLARED_CODE_DIALOG_WHO_SEES_PRIVATE_ALERT],
  ])(
    "for a private %s's fix, says it leaves the record out",
    async (kind: string, words: string) => {
      ownerAnswer = { ...OWNER, privateRecord: kind } as unknown as JSONObject;

      const note: HTMLElement = await whoSees();

      expect(note).toHaveTextContent(words);
      expect(note).toHaveAttribute("data-private-record", kind);
    },
  );

  test("the owner route's answer is read with the kind of private record, and only a kind it knows", () => {
    for (const kind of ["incident", "alert"]) {
      expect(
        readDeclaredCodeOwner({ ...OWNER, privateRecord: kind })!.privateRecord,
      ).toBe(kind);
    }

    for (const value of ["episode", true, 1, null]) {
      expect(
        readDeclaredCodeOwner({ ...OWNER, privateRecord: value }),
      ).not.toHaveProperty("privateRecord");
    }

    expect(readDeclaredCodeOwner(OWNER)).not.toHaveProperty("privateRecord");
  });

  test("each of the three sentences is one whole sentence, one for each case", () => {
    expect(getDeclaredCodeWhoSeesNote(undefined)).toBe(
      DECLARED_CODE_DIALOG_WHO_SEES,
    );
    expect(getDeclaredCodeWhoSeesNote("incident")).toBe(
      DECLARED_CODE_DIALOG_WHO_SEES_PRIVATE_INCIDENT,
    );
    expect(getDeclaredCodeWhoSeesNote("alert")).toBe(
      DECLARED_CODE_DIALOG_WHO_SEES_PRIVATE_ALERT,
    );
    expect(DECLARED_CODE_DIALOG_WHO_SEES_PRIVATE_INCIDENT).toContain(
      DECLARED_CODE_DIALOG_WHO_SEES,
    );
  });
});
