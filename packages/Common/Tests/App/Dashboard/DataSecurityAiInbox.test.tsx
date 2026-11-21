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
import React from "react";
import { MemoryRouter } from "react-router-dom";
import DataSecurityAiPage from "../../../../App/FeatureSet/Dashboard/src/Pages/DataSecurity/AI";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  DATA_SECURITY_AI_SWITCHES_TEST_ID,
  getProjectAiSwitchTestId,
  PROJECT_AI_NOTICE_CONTEXT_COPY,
  PROJECT_AI_OFF_NOTICE_TEST_ID,
  ProjectAiNoticeContext,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/ProjectAiSettingsCopy";
import {
  DATA_SECURITY_AI_ASK_REASON_SENTENCES,
  DATA_SECURITY_AI_REASON_LINES,
  DATA_SECURITY_AI_SKIP_SENTENCES,
  DataSecurityAiPageCopy,
  DataSecurityAiRulesCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/DataSecurityAiCopy";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AutoRemediationRule from "../../../Models/DatabaseModels/AutoRemediationRule";
import DataSecurityAiDecision from "../../../Models/DatabaseModels/DataSecurityAiDecision";
import DataSecurityAiProposal from "../../../Models/DatabaseModels/DataSecurityAiProposal";
import DataSecurityIssue from "../../../Models/DatabaseModels/DataSecurityIssue";
import Project from "../../../Models/DatabaseModels/Project";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { DATA_SECURITY_API_ROUTES } from "../../../Types/DataSecurity/DataSecurityApiTypes";
import AutoRemediationTriggerEntity from "../../../Types/AutoRemediation/AutoRemediationTriggerEntity";
import {
  DataSecurityAiAskReason,
  DataSecurityAiAutonomy,
  DataSecurityAiProposalKind,
  DataSecurityAiProposalStatus,
  DataSecurityAiWork,
  getDataSecurityAiPlanFingerprint,
} from "../../../Types/DataSecurity/DataSecurityAi";
import {
  DataSecurityAiDecisionReason,
  DataSecurityAiIssueSkipReason,
} from "../../../Types/DataSecurity/DataSecurityAiDecision";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { REFRESH_SIDEBAR_COUNT_EVENT } from "../../../UI/Components/SideMenu/CountModelSideMenuItem";
import API from "../../../UI/Utils/API/API";
import GlobalEvents from "../../../UI/Utils/GlobalEvents";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import User from "../../../UI/Utils/User";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

// The proposal's text as the viewer is handed it, and whether it is drawn safely.
jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: {
      text: string;
      safeMode?: boolean;
    }): React.ReactElement => {
      return React.createElement(
        "div",
        {
          "data-testid": "markdown",
          "data-safe-mode": String(Boolean(props.safeMode)),
        },
        props.text,
      );
    },
  };
});

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

/*
 * DATA SECURITY → AI (#10364), rendered for real with only the network and
 * the permission snapshot stubbed:
 *   - the AI notice and the one switch, Work on new issues, come first;
 *   - Waiting for you lists the proposals that wait, riskiest first.
 *     Approve opens the proposal - what will change, why, how it is proven
 *     and how to undo it, and why it asks - and approves the plan it shows
 *     (its fingerprint), through Data Security's own route; a refusal stays
 *     in the dialog in the server's words; a proposal approved once says it
 *     waits for someone else;
 *   - Dismiss proposal asks why, and sends the reason;
 *   - Done by AI lists what was made without asking, each with Undo, which
 *     asks first;
 *   - Why AI did not act says why, in a sentence, and what each kind of
 *     work did.
 */

configure({ asyncUtilTimeout: 15000 });

const ISSUE_ID: string = "7c7c7c7c-0000-4000-8000-000000000007";
const OTHER_ISSUE_ID: string = "7c7c7c7c-0000-4000-8000-000000000008";
const FIRST_APPROVER_ID: string = "5e5e5e5e-0000-4000-8000-000000000005";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard"),
  currentProject: null,
  hasPaymentMethod: true,
};

const OWNER: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectUser,
  Permission.ProjectOwner,
];

const SCRUB_PLAN: JSONObject = {
  places: [
    {
      signal: "Logs",
      dataTypeId: "card-number",
      location: "log.body",
    },
  ],
};

function proposal(values: Record<string, unknown>): DataSecurityAiProposal {
  const row: DataSecurityAiProposal = new DataSecurityAiProposal();

  Object.assign(row, {
    projectId: new ObjectID(PROJECT_ID),
    kind: DataSecurityAiProposalKind.ScrubTelemetry,
    work: DataSecurityAiWork.Contain,
    plan: SCRUB_PLAN,
    dataSecurityIssueId: new ObjectID(ISSUE_ID),
    createdAt: new Date("2026-11-19T10:00:00.000Z"),
    ...values,
  });

  return row;
}

const WAITING: DataSecurityAiProposal = proposal({
  _id: "1a1a1a1a-0000-4000-8000-000000000001",
  status: DataSecurityAiProposalStatus.Proposed,
  riskScore: 82,
  title: "Scrub Card number in 1 place of checkout-api's logs",
  changeMarkdown: "A log scrub rule that masks **Card number** in `log.body`.",
  reasonMarkdown: "Card numbers were found in 1 place in the last 7 days.",
  proofMarkdown: "The issue's own check decides.",
  undoMarkdown: "Undo deletes the scrub rule this made.",
  askReason: DataSecurityAiAskReason.NotProvenSafe,
  autoRemediationRuleName: "Production stores",
});

const APPROVED_ONCE: DataSecurityAiProposal = proposal({
  _id: "1a1a1a1a-0000-4000-8000-000000000002",
  status: DataSecurityAiProposalStatus.Proposed,
  riskScore: 40,
  title: "Scrub Email address in 2 places of payments-api's logs",
  changeMarkdown: "Two log scrub rules that mask **Email address**.",
  askReason: DataSecurityAiAskReason.TwoApprovals,
  firstApprovedByUserId: new ObjectID(FIRST_APPROVER_ID),
  dataSecurityIssueId: new ObjectID(OTHER_ISSUE_ID),
});

const MADE: DataSecurityAiProposal = proposal({
  _id: "1a1a1a1a-0000-4000-8000-000000000003",
  status: DataSecurityAiProposalStatus.AppliedWithoutAsking,
  title: "Scrubbed Password in 1 place of auth-api's traces",
  appliedAt: new Date("2026-11-19T11:00:00.000Z"),
});

function decision(): DataSecurityAiDecision {
  const row: DataSecurityAiDecision = new DataSecurityAiDecision();
  const issue: DataSecurityIssue = new DataSecurityIssue();

  issue._id = OTHER_ISSUE_ID;
  issue.title = "Email addresses in payments-api's logs";

  Object.assign(row, {
    _id: "2b2b2b2b-0000-4000-8000-000000000001",
    projectId: new ObjectID(PROJECT_ID),
    dataSecurityIssueId: new ObjectID(OTHER_ISSUE_ID),
    dataSecurityIssue: issue,
    didAct: false,
    skipReason: DataSecurityAiIssueSkipReason.NoRuleMatched,
    entries: [
      {
        work: DataSecurityAiWork.Analyze,
        reason: DataSecurityAiDecisionReason.WorkOff,
      },
    ],
    createdAt: new Date("2026-11-19T09:00:00.000Z"),
  });

  return row;
}

function rule(): AutoRemediationRule {
  const row: AutoRemediationRule = new AutoRemediationRule();

  Object.assign(row, {
    _id: "3c3c3c3c-0000-4000-8000-000000000001",
    projectId: new ObjectID(PROJECT_ID),
    name: "Production stores",
    triggerEntityType: AutoRemediationTriggerEntity.DataSecurityIssue,
    isEnabled: true,
    dataSecurityAnalyze: DataSecurityAiAutonomy.WithoutAsking,
    dataSecurityContain: DataSecurityAiAutonomy.Suggest,
    dataSecurityFix: DataSecurityAiAutonomy.Off,
    dataSecurityJudge: DataSecurityAiAutonomy.Suggest,
  });

  return row;
}

interface ListCall {
  model: string;
  query: Record<string, unknown>;
  sort: Record<string, unknown>;
}

interface PostCall {
  path: string;
  data: JSONObject;
}

let project: Record<string, unknown> = {};
let proposals: Array<DataSecurityAiProposal> = [];
let decisions: Array<DataSecurityAiDecision> = [];
let rules: Array<AutoRemediationRule> = [];
let listCalls: Array<ListCall> = [];
let posts: Array<PostCall> = [];
// What Data Security's routes answer to a press, when they refuse it.
let refusal: string | null = null;

function grant(permissions: Array<Permission>): void {
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
  jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue(permissions);
  jest.spyOn(PermissionUtil, "getGlobalPermissions").mockReturnValue(null);
  jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue({
    projectId: new ObjectID(PROJECT_ID),
    userId: ObjectID.generate(),
    permissions: permissions.map((permission: Permission) => {
      return {
        permission: permission,
        labelIds: [],
        _type: "UserPermission",
      };
    }),
    _type: "UserTenantAccessPermission",
  } as unknown as ReturnType<typeof PermissionUtil.getProjectPermissions>);
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  PermissionGate.clearPermissionPropsCache();
  grant(OWNER);

  project = {
    _id: PROJECT_ID,
    enableAi: true,
    enableAutomaticDataSecurityAi: true,
  };
  proposals = [WAITING, APPROVED_ONCE, MADE];
  decisions = [decision()];
  rules = [rule()];
  listCalls = [];
  posts = [];
  refusal = null;

  jest
    .spyOn(ModelAPI, "getItem")
    .mockImplementation(async (): Promise<Project> => {
      return Object.assign(new Project(), project);
    });

  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(
      async (data: unknown): Promise<ListResult<BaseModel>> => {
        const request: {
          modelType: { new (): BaseModel; name: string };
          query?: Record<string, unknown>;
          sort?: Record<string, unknown>;
        } = data as {
          modelType: { new (): BaseModel; name: string };
          query?: Record<string, unknown>;
          sort?: Record<string, unknown>;
        };
        const query: Record<string, unknown> = request.query || {};

        listCalls.push({
          model: request.modelType.name,
          query,
          sort: request.sort || {},
        });

        let rows: Array<BaseModel> = [];

        if (request.modelType === DataSecurityAiProposal) {
          rows = proposals.filter((row: DataSecurityAiProposal): boolean => {
            return row.status === query["status"];
          });
        }

        if (request.modelType === AutoRemediationRule) {
          rows = rules.filter((row: AutoRemediationRule): boolean => {
            return row.triggerEntityType === query["triggerEntityType"];
          });
        }

        if (request.modelType === DataSecurityAiDecision) {
          rows = decisions.filter((row: DataSecurityAiDecision): boolean => {
            return row.didAct === query["didAct"];
          });
        }

        return { data: rows, count: rows.length, skip: 0, limit: 10 };
      },
    );

  jest
    .spyOn(ModelAPI, "count")
    .mockImplementation(async (): Promise<number> => {
      return 0;
    });

  jest.spyOn(API, "post").mockImplementation(async (options: unknown) => {
    const request: { url: { toString: () => string }; data?: JSONObject } =
      options as { url: { toString: () => string }; data?: JSONObject };
    const path: string = new URL(request.url.toString()).pathname;

    posts.push({ path, data: request.data || {} });

    if (path.endsWith("/ai-chat/providers")) {
      return new HTTPResponse<JSONObject>(
        200,
        {
          isAIEnabledForProject: true,
          defaultProviderId: "9d9d9d9d-0000-4000-8000-000000000001",
          providers: [
            {
              id: "9d9d9d9d-0000-4000-8000-000000000001",
              name: "OneUptime AI",
              isGlobal: true,
              isDefault: false,
            },
          ],
        },
        {},
      ) as unknown as never;
    }

    if (refusal) {
      return new HTTPErrorResponse(
        400,
        { message: refusal },
        {},
      ) as unknown as never;
    }

    return new HTTPResponse<JSONObject>(
      200,
      { status: DataSecurityAiProposalStatus.Applied },
      {},
    ) as unknown as never;
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function settle(): Promise<void> {
  await act(async (): Promise<void> => {
    for (let i: number = 0; i < 6; i++) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    }
  });
}

async function openPage(): Promise<void> {
  const path: string = `/dashboard/${PROJECT_ID}/data-security/ai`;

  goTo(path);

  render(
    <MemoryRouter initialEntries={[path]}>
      <DataSecurityAiPage {...PAGE_PROPS} />
    </MemoryRouter>,
  );

  await settle();
}

// One of the page's lists - its card, found by its title - once its rows are drawn.
async function list(title: string, rowText: string): Promise<HTMLElement> {
  let found: HTMLElement | null = null;

  await waitFor(() => {
    const heading: HTMLElement | undefined = screen
      .getAllByTestId("card-details-heading")
      .find((candidate: HTMLElement): boolean => {
        return (candidate.textContent || "").trim() === title;
      });

    found = (heading?.closest('[data-testid="card"]') as HTMLElement) || null;

    expect(found).toHaveTextContent(rowText);
  });

  return found as unknown as HTMLElement;
}

// The row of a list that holds this text.
function rowOf(table: HTMLElement, text: string): HTMLElement {
  const row: HTMLElement | undefined = Array.from(
    table.querySelectorAll<HTMLElement>("tr, [role='row'], li"),
  ).find((candidate: HTMLElement): boolean => {
    return (candidate.textContent || "").includes(text);
  });

  if (!row) {
    throw new Error(`No row with "${text}".`);
  }

  return row;
}

function dialog(): HTMLElement {
  return screen.getByRole("dialog");
}

function postsTo(suffix: string): Array<PostCall> {
  return posts.filter((post: PostCall): boolean => {
    return post.path.endsWith(suffix);
  });
}

describe("Data Security → AI", () => {
  test("starts with the notice and its one switch, Work on new issues, on as the project has it", async () => {
    await openPage();

    const control: HTMLElement = await screen.findByTestId(
      getProjectAiSwitchTestId("enableAutomaticDataSecurityAi"),
    );

    expect(control).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByTestId(DATA_SECURITY_AI_SWITCHES_TEST_ID),
    ).toHaveTextContent("Work on new issues");
  });

  test("with AI off for the project, it says Data Security works as it always does", async () => {
    project = { ...project, enableAi: false };

    await openPage();

    expect(
      await screen.findByTestId(PROJECT_AI_OFF_NOTICE_TEST_ID),
    ).toHaveTextContent(
      "Data Security works as it always does, but OneUptime AI works on no issue.",
    );
    expect(
      PROJECT_AI_NOTICE_CONTEXT_COPY[ProjectAiNoticeContext.DataSecurity]
        .aiOffDescription,
    ).toContain("Data Security works as it always does");
  });

  test("Waiting for you lists what waits, riskiest first; Done by AI what was made; Why AI did not act what it left alone", async () => {
    await openPage();

    const waiting: HTMLElement = await list(
      DataSecurityAiPageCopy.waitingTitle,
      WAITING.title!,
    );

    expect(waiting).toHaveTextContent(APPROVED_ONCE.title!);
    expect(waiting).not.toHaveTextContent(MADE.title!);
    expect(waiting).toHaveTextContent("Contain");
    // Which rule decided each: one by name, the other the project's defaults.
    expect(waiting).toHaveTextContent("Production stores");
    expect(waiting).toHaveTextContent(DataSecurityAiRulesCopy.projectDefaults);

    const done: HTMLElement = await list(
      DataSecurityAiPageCopy.doneTitle,
      MADE.title!,
    );

    expect(done).not.toHaveTextContent(WAITING.title!);

    const proposalReads: Array<ListCall> = listCalls.filter(
      (call: ListCall): boolean => {
        return call.model === "DataSecurityAiProposal";
      },
    );

    expect(
      proposalReads.some((call: ListCall): boolean => {
        return (
          call.query["status"] === DataSecurityAiProposalStatus.Proposed &&
          JSON.stringify(call.sort).includes("riskScore")
        );
      }),
    ).toBe(true);
    expect(
      proposalReads.some((call: ListCall): boolean => {
        return (
          call.query["status"] ===
            DataSecurityAiProposalStatus.AppliedWithoutAsking &&
          JSON.stringify(call.sort).includes("appliedAt")
        );
      }),
    ).toBe(true);

    const skipped: HTMLElement = await list(
      DataSecurityAiPageCopy.skippedTitle,
      "Email addresses in payments-api's logs",
    );

    expect(skipped).toHaveTextContent(
      DATA_SECURITY_AI_SKIP_SENTENCES[
        DataSecurityAiIssueSkipReason.NoRuleMatched
      ],
    );
    expect(skipped).toHaveTextContent(
      `Analyze: ${DATA_SECURITY_AI_REASON_LINES[DataSecurityAiDecisionReason.WorkOff]}`,
    );
    expect(
      listCalls.some((call: ListCall): boolean => {
        return (
          call.model === "DataSecurityAiDecision" &&
          call.query["didAct"] === false
        );
      }),
    ).toBe(true);
  });

  test("AI Rules lists Data Security's rules only, each with what every kind of work may do", async () => {
    await openPage();

    const card: HTMLElement = await list(
      DataSecurityAiRulesCopy.title,
      "Production stores",
    );

    expect(card).toHaveTextContent("Analyze: Without asking");
    expect(card).toHaveTextContent("Contain: Suggest");
    expect(card).toHaveTextContent("Fix: Off");
    expect(card).toHaveTextContent("Judge: Suggest");
    expect(
      listCalls.some((call: ListCall): boolean => {
        return (
          call.model === "AutoRemediationRule" &&
          call.query["triggerEntityType"] ===
            AutoRemediationTriggerEntity.DataSecurityIssue
        );
      }),
    ).toBe(true);
  });

  test("Create AI Rule starts from the project's defaults, and saves a Data Security rule that starts on", async () => {
    const saved: Array<AutoRemediationRule> = [];

    jest
      .spyOn(ModelAPI, "createOrUpdate")
      .mockImplementation(async (data: unknown): Promise<never> => {
        const model: AutoRemediationRule = (
          data as { model: AutoRemediationRule }
        ).model;

        saved.push(model);

        return {
          data: Object.assign(new AutoRemediationRule(), {
            _id: "3c3c3c3c-0000-4000-8000-000000000002",
            name: model.name,
          }),
        } as never;
      });

    await openPage();

    const card: HTMLElement = await list(
      DataSecurityAiRulesCopy.title,
      "Production stores",
    );

    fireEvent.click(
      within(card)
        .getAllByTestId("card-button")
        .find((button: HTMLElement): boolean => {
          return (button.textContent || "").includes("Create AI Rule");
        })!,
    );

    const modal: HTMLElement = await screen.findByTestId("modal");
    const name: HTMLElement = await within(modal).findByPlaceholderText(
      DataSecurityAiRulesCopy.namePlaceholder,
    );

    // A rule starts on: its Enabled switch is on the edit form only.
    expect(modal).not.toHaveTextContent("Enable or disable this rule.");
    expect(modal).toHaveTextContent(DataSecurityAiRulesCopy.worksSection);
    expect(modal).toHaveTextContent(DataSecurityAiRulesCopy.matchSection);

    fireEvent.change(name, { target: { value: "Telemetry" } });

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(modal).getByRole("button", { name: "Create AI Rule" }),
      );
    });

    await waitFor(() => {
      expect(saved).toHaveLength(1);
    });

    expect(saved[0]!.name).toBe("Telemetry");
    expect(saved[0]!.triggerEntityType).toBe(
      AutoRemediationTriggerEntity.DataSecurityIssue,
    );
    expect(saved[0]!.dataSecurityAnalyze).toBe(
      DataSecurityAiAutonomy.WithoutAsking,
    );
    expect(saved[0]!.dataSecurityContain).toBe(DataSecurityAiAutonomy.Suggest);
    expect(saved[0]!.dataSecurityFix).toBe(DataSecurityAiAutonomy.Suggest);
    expect(saved[0]!.dataSecurityJudge).toBe(DataSecurityAiAutonomy.Suggest);
    expect(saved[0]!.isEnabled).not.toBe(false);
  });

  test("a Security Viewer reads what waits, but not the project's AI rules, which take the AI rule permissions", async () => {
    grant([
      Permission.Public,
      Permission.User,
      Permission.CurrentUser,
      Permission.ProjectUser,
      Permission.SecurityViewer,
    ]);
    PermissionGate.clearPermissionPropsCache();

    await openPage();

    await list(DataSecurityAiPageCopy.waitingTitle, WAITING.title!);
    expect(
      screen
        .getAllByTestId("card-details-heading")
        .map((heading: HTMLElement): string => {
          return (heading.textContent || "").trim();
        }),
    ).not.toContain(DataSecurityAiRulesCopy.title);
    expect(
      listCalls.some((call: ListCall): boolean => {
        return call.model === "AutoRemediationRule";
      }),
    ).toBe(false);
  });

  test("Approve shows what will change, why, how it is proven, how to undo it and why it asks - then approves that plan", async () => {
    await openPage();

    const waiting: HTMLElement = await list(
      DataSecurityAiPageCopy.waitingTitle,
      WAITING.title!,
    );

    fireEvent.click(
      within(rowOf(waiting, WAITING.title!)).getByRole("button", {
        name: DataSecurityAiPageCopy.approve,
      }),
    );

    const review: HTMLElement = await screen.findByTestId(
      "data-security-ai-proposal-review",
    );

    for (const heading of [
      DataSecurityAiPageCopy.whatWillChange,
      DataSecurityAiPageCopy.why,
      DataSecurityAiPageCopy.howItIsProven,
      DataSecurityAiPageCopy.howToUndoIt,
      DataSecurityAiPageCopy.whyItAsks,
    ]) {
      expect(within(review).getByText(heading)).toBeInTheDocument();
    }

    const parts: Array<HTMLElement> = within(review).getAllByTestId("markdown");

    expect(
      parts.map((part: HTMLElement): string => {
        return part.textContent || "";
      }),
    ).toEqual([
      WAITING.changeMarkdown,
      WAITING.reasonMarkdown,
      WAITING.proofMarkdown,
      WAITING.undoMarkdown,
    ]);

    // Written by OneUptime from the issue: drawn as markdown, never as HTML.
    for (const part of parts) {
      expect(part).toHaveAttribute("data-safe-mode", "true");
    }
    expect(review).toHaveTextContent("Undo deletes the scrub rule this made.");
    expect(review).toHaveTextContent(
      DATA_SECURITY_AI_ASK_REASON_SENTENCES[
        DataSecurityAiAskReason.NotProvenSafe
      ],
    );
    expect(review).not.toHaveTextContent(DataSecurityAiPageCopy.approvedOnce);
    expect(postsTo("/approve")).toEqual([]);

    const readsBefore: number = listCalls.length;
    const menuRefreshes: ReturnType<typeof jest.spyOn> = jest.spyOn(
      GlobalEvents,
      "dispatchEvent",
    );

    fireEvent.click(
      within(dialog()).getByRole("button", {
        name: DataSecurityAiPageCopy.approve,
      }),
    );

    await waitFor(() => {
      expect(postsTo("/approve")).toHaveLength(1);
    });

    expect(postsTo("/approve")[0]).toEqual({
      path: DATA_SECURITY_API_ROUTES.approveAiProposal(WAITING._id!),
      data: {
        expectedPlanFingerprint: getDataSecurityAiPlanFingerprint({
          kind: WAITING.kind,
          plan: WAITING.plan,
        }),
      },
    });

    // The dialog closes, the lists are read again, and so is the menu's count.
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(listCalls.length).toBeGreaterThan(readsBefore);
    });
    expect(menuRefreshes).toHaveBeenCalledWith(REFRESH_SIDEBAR_COUNT_EVENT);
  });

  test("a refusal stays in the dialog, in the server's words, and nothing is read again", async () => {
    refusal =
      "You need permission to create log scrub rules to approve this change.";

    await openPage();

    const waiting: HTMLElement = await list(
      DataSecurityAiPageCopy.waitingTitle,
      WAITING.title!,
    );

    fireEvent.click(
      within(rowOf(waiting, WAITING.title!)).getByRole("button", {
        name: DataSecurityAiPageCopy.approve,
      }),
    );
    await screen.findByTestId("data-security-ai-proposal-review");

    const readsBefore: number = listCalls.length;

    fireEvent.click(
      within(dialog()).getByRole("button", {
        name: DataSecurityAiPageCopy.approve,
      }),
    );

    expect(await within(dialog()).findByText(refusal)).toBeInTheDocument();
    await settle();
    expect(listCalls.length).toBe(readsBefore);
  });

  test("a proposal approved once says it is made when someone else approves it too", async () => {
    await openPage();

    const waiting: HTMLElement = await list(
      DataSecurityAiPageCopy.waitingTitle,
      APPROVED_ONCE.title!,
    );

    fireEvent.click(
      within(rowOf(waiting, APPROVED_ONCE.title!)).getByRole("button", {
        name: DataSecurityAiPageCopy.approve,
      }),
    );

    const review: HTMLElement = await screen.findByTestId(
      "data-security-ai-proposal-review",
    );

    expect(review).toHaveTextContent(DataSecurityAiPageCopy.approvedOnce);
    expect(review).toHaveTextContent(
      DATA_SECURITY_AI_ASK_REASON_SENTENCES[
        DataSecurityAiAskReason.TwoApprovals
      ],
    );
  });

  test("Dismiss proposal asks why, and sends the reason", async () => {
    await openPage();

    const waiting: HTMLElement = await list(
      DataSecurityAiPageCopy.waitingTitle,
      WAITING.title!,
    );

    fireEvent.click(
      within(rowOf(waiting, WAITING.title!)).getByTestId(
        "row-actions-more-button",
      ),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: DataSecurityAiPageCopy.dismiss,
      }),
    );

    const form: HTMLElement = dialog();

    expect(form).toHaveTextContent(DataSecurityAiPageCopy.dismissDescription);

    fireEvent.change(within(form).getByRole("textbox"), {
      target: { value: "Our support team searches logs by this field." },
    });
    fireEvent.click(
      within(form).getByRole("button", {
        name: DataSecurityAiPageCopy.dismiss,
      }),
    );

    await waitFor(() => {
      expect(postsTo("/dismiss")).toHaveLength(1);
    });

    expect(postsTo("/dismiss")[0]).toEqual({
      path: DATA_SECURITY_API_ROUTES.dismissAiProposal(WAITING._id!),
      data: { reason: "Our support team searches logs by this field." },
    });
  });

  test("Done by AI offers Undo, which asks first, then takes the change back", async () => {
    await openPage();

    const done: HTMLElement = await list(
      DataSecurityAiPageCopy.doneTitle,
      MADE.title!,
    );

    fireEvent.click(
      within(rowOf(done, MADE.title!)).getByRole("button", {
        name: DataSecurityAiPageCopy.undo,
      }),
    );

    expect(dialog()).toHaveTextContent(DataSecurityAiPageCopy.undoDescription);
    expect(postsTo("/undo")).toEqual([]);

    fireEvent.click(
      within(dialog()).getByRole("button", {
        name: DataSecurityAiPageCopy.undo,
      }),
    );

    await waitFor(() => {
      expect(postsTo("/undo")).toHaveLength(1);
    });

    expect(postsTo("/undo")[0]?.path).toBe(
      DATA_SECURITY_API_ROUTES.undoAiProposal(MADE._id!),
    );
  });
});
