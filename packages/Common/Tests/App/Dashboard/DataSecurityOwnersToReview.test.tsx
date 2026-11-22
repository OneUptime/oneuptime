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
import OwnersToReview from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/OwnersToReview";
import {
  DataSecurityAiPageCopy,
  OwnersToReviewCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/DataSecurityAiCopy";
import {
  canChangeOwnersFirst,
  getOwnerConfidenceChip,
  getOwnerProposalRoute,
  readOwnerProposalView,
  rulesFirst,
  toOwnerChanges,
  toOwnersFormValues,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/OwnersToReviewData";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DataSecurityAiProposal from "../../../Models/DatabaseModels/DataSecurityAiProposal";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Includes from "../../../Types/BaseDatabase/Includes";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { DATA_SECURITY_API_ROUTES } from "../../../Types/DataSecurity/DataSecurityApiTypes";
import {
  DATA_SECURITY_AI_OWNER_PROPOSAL_KINDS,
  DataSecurityAiAskReason,
  DataSecurityAiChangeSafety,
  DataSecurityAiProposalKind,
  DataSecurityAiProposalStatus,
  DataSecurityAiWork,
  getDataSecurityAiPlanFingerprint,
} from "../../../Types/DataSecurity/DataSecurityAi";
import {
  DataStoreOwnerConfidence,
  DataStoreOwnerEvidenceSource,
  DataStoreOwnerKind,
  DataStoreOwnerRulePlan,
  DataStoreOwnersPlan,
} from "../../../Types/DataSecurity/DataStoreOwnerProposal";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { PillTone } from "../../../UI/Components/Pill/PillTone";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import User from "../../../UI/Utils/User";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): React.ReactElement => {
      return React.createElement(
        "div",
        { "data-testid": "markdown" },
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
 * OWNERS TO REVIEW (#10374), on Data Security → AI and Data Stores, drawn
 * for real with only the network and the permission snapshot stubbed:
 *
 *   - while no owner proposal waits - AI off, or nothing proposed - it is
 *     not drawn, and no list is read;
 *   - it says how many stores and rules wait, and lists them riskiest
 *     first: each store's owners, how sure OneUptime AI is, why, and where
 *     the evidence disagrees; an owner who cannot open the store says so;
 *     each rule says whom it adds to how many stores;
 *   - Approve shows the whole proposal, then approves the plan it shows;
 *   - Change and Approve - a store's only - approves the owners the person
 *     picked instead, through the same route;
 *   - a bulk Approve takes the rules first.
 */

configure({ asyncUtilTimeout: 15000 });

const PAYMENTS_ID: string = "10374000-0000-4000-8000-0000000000c1";
const PERSON_ID: string = "10374000-0000-4000-8000-0000000000a1";
const STORE_ID: string = "10374000-0000-4000-8000-000000000101";
const OTHER_STORE_ID: string = "10374000-0000-4000-8000-000000000102";

const OWNER: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectUser,
  Permission.ProjectOwner,
];

function storePlan(values: Partial<DataStoreOwnersPlan>): DataStoreOwnersPlan {
  const payments: DataStoreOwnersPlan["owners"][number] = {
    kind: DataStoreOwnerKind.Team,
    id: PAYMENTS_ID,
    ref: "T1",
    name: "Payments",
    evidenceIds: ["E1"],
    canOpenStore: true,
  };

  return {
    dataStoreId: STORE_ID,
    dataStoreName: "payments-ledger",
    owners: [payments],
    confidence: DataStoreOwnerConfidence.High,
    reason: "The team tag names Payments.",
    disagreement: "",
    restsOn: ["E1"],
    evidence: [
      {
        id: "E1",
        source: DataStoreOwnerEvidenceSource.CloudTag,
        tagKey: "team",
        tagValue: "payments",
        owners: [{ kind: DataStoreOwnerKind.Team, id: PAYMENTS_ID }],
      },
    ],
    candidates: [payments],
    ruleFacts: [{ kind: "CloudTag", key: "team", value: "payments" }],
    isSensitive: true,
    ...values,
  };
}

const RULE_PLAN: DataStoreOwnerRulePlan = {
  fact: { kind: "CloudTag", key: "team", value: "payments" },
  ruleName: "Payments owns stores tagged team=payments",
  cloudTagPattern: "^team=payments$",
  owners: [
    { kind: DataStoreOwnerKind.Team, id: PAYMENTS_ID, name: "Payments" },
  ],
  dataStoreIds: [
    STORE_ID,
    OTHER_STORE_ID,
    "10374000-0000-4000-8000-000000000103",
  ],
  preview: {
    matchingStores: 4,
    alreadyOwned: 1,
    storeNames: ["payments-ledger"],
    previewedAt: "2026-11-21T00:00:00.000Z",
  },
};

function proposal(values: Record<string, unknown>): DataSecurityAiProposal {
  const row: DataSecurityAiProposal = new DataSecurityAiProposal();

  Object.assign(row, {
    projectId: new ObjectID(PROJECT_ID),
    work: DataSecurityAiWork.Judge,
    safety: DataSecurityAiChangeSafety.ChangesWhoIsTold,
    status: DataSecurityAiProposalStatus.Proposed,
    askReason: DataSecurityAiAskReason.AlwaysAsks,
    createdAt: new Date("2026-11-21T10:00:00.000Z"),
    ...values,
  });

  return row;
}

const LEDGER: DataSecurityAiProposal = proposal({
  _id: "1b1b1b1b-0000-4000-8000-000000000001",
  kind: DataSecurityAiProposalKind.SetStoreOwners,
  dataStoreId: new ObjectID(STORE_ID),
  riskScore: 80,
  title: "Make Payments the owner of payments-ledger",
  plan: storePlan({}) as unknown as JSONObject,
  changeMarkdown: "- **Payments** becomes an owner of **payments-ledger**.",
  reasonMarkdown: "The team tag names Payments.",
  proofMarkdown: "The store's check, Nobody owns this sensitive store, passes.",
  undoMarkdown: "Undo removes the owners this added.",
});

const EXPORTS: DataSecurityAiProposal = proposal({
  _id: "1b1b1b1b-0000-4000-8000-000000000002",
  kind: DataSecurityAiProposalKind.SetStoreOwners,
  dataStoreId: new ObjectID(OTHER_STORE_ID),
  riskScore: 0,
  title: "Make Ada Lovelace the owner of card-exports",
  plan: storePlan({
    dataStoreId: OTHER_STORE_ID,
    dataStoreName: "card-exports",
    owners: [
      {
        kind: DataStoreOwnerKind.User,
        id: PERSON_ID,
        ref: "P1",
        name: "Ada Lovelace",
        evidenceIds: ["E1"],
        canOpenStore: false,
      },
    ],
    confidence: DataStoreOwnerConfidence.Low,
    reason: "Ada changed it most in the last 90 days.",
    disagreement: "Its team tag names Platform.",
  }) as unknown as JSONObject,
});

const RULE: DataSecurityAiProposal = proposal({
  _id: "1b1b1b1b-0000-4000-8000-000000000003",
  kind: DataSecurityAiProposalKind.CreateOwnerRule,
  riskScore: 4,
  title: "Make Payments the owner of every store tagged team=payments",
  plan: RULE_PLAN as unknown as JSONObject,
});

interface ListCall {
  model: string;
  query: Record<string, unknown>;
  sort: Record<string, unknown>;
}

interface PostCall {
  path: string;
  data: JSONObject;
}

let proposals: Array<DataSecurityAiProposal> = [];
let listCalls: Array<ListCall> = [];
let posts: Array<PostCall> = [];

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

// The proposals a query asks for, as the server answers it.
function matching(
  query: Record<string, unknown>,
): Array<DataSecurityAiProposal> {
  return proposals.filter((row: DataSecurityAiProposal): boolean => {
    if (query["status"] && row.status !== query["status"]) {
      return false;
    }

    const kind: unknown = query["kind"];

    if (kind instanceof Includes) {
      return kind.values.includes(row.kind as never);
    }

    return !kind || row.kind === kind;
  });
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  PermissionGate.clearPermissionPropsCache();
  grant(OWNER);
  goTo(`/dashboard/${PROJECT_ID}/data-security/ai`);

  proposals = [LEDGER, EXPORTS, RULE];
  listCalls = [];
  posts = [];

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

        const rows: Array<BaseModel> =
          request.modelType === DataSecurityAiProposal
            ? [...matching(query)].sort(
                (
                  left: DataSecurityAiProposal,
                  right: DataSecurityAiProposal,
                ): number => {
                  return (right.riskScore || 0) - (left.riskScore || 0);
                },
              )
            : [];

        return { data: rows, count: rows.length, skip: 0, limit: 10 };
      },
    );

  jest
    .spyOn(ModelAPI, "count")
    .mockImplementation(async (data: unknown): Promise<number> => {
      const request: { query?: Record<string, unknown> } = data as {
        query?: Record<string, unknown>;
      };

      return matching(request.query || {}).length;
    });

  jest.spyOn(API, "post").mockImplementation(async (options: unknown) => {
    const request: { url: { toString: () => string }; data?: JSONObject } =
      options as { url: { toString: () => string }; data?: JSONObject };

    posts.push({
      path: new URL(request.url.toString()).pathname,
      data: request.data || {},
    });

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

async function draw(): Promise<void> {
  render(
    <MemoryRouter
      initialEntries={[`/dashboard/${PROJECT_ID}/data-security/ai`]}
    >
      <OwnersToReview />
    </MemoryRouter>,
  );

  await settle();
}

// The card, once a row with this text is drawn.
async function card(rowText: string): Promise<HTMLElement> {
  let found: HTMLElement | null = null;

  await waitFor(() => {
    const heading: HTMLElement | undefined = screen
      .getAllByTestId("card-details-heading")
      .find((candidate: HTMLElement): boolean => {
        return (
          (candidate.textContent || "").trim() === OwnersToReviewCopy.title
        );
      });

    found = (heading?.closest('[data-testid="card"]') as HTMLElement) || null;

    expect(found).toHaveTextContent(rowText);
  });

  return found as unknown as HTMLElement;
}

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

function approvals(): Array<PostCall> {
  return posts.filter((post: PostCall): boolean => {
    return post.path.endsWith("/approve");
  });
}

describe("Owners to review", () => {
  test("is not drawn while no owner proposal waits, and reads no list", async () => {
    proposals = [];

    await draw();

    expect(screen.queryByText(OwnersToReviewCopy.title)).toBeNull();
    expect(
      listCalls.filter((call: ListCall): boolean => {
        return call.model === "DataSecurityAiProposal";
      }),
    ).toEqual([]);
  });

  test("a reader who may not read proposals sees nothing of it", async () => {
    jest.spyOn(ModelAPI, "count").mockRejectedValue(new Error("Forbidden"));

    await draw();

    expect(screen.queryByText(OwnersToReviewCopy.title)).toBeNull();
  });

  test("says how many stores and rules wait, and lists the owner proposals riskiest first", async () => {
    await draw();

    const list: HTMLElement = await card(LEDGER.title!);

    expect(screen.getByTestId("owners-to-review-counts")).toHaveTextContent(
      "OneUptime AI proposes owners for 2 stores. It also proposes 1 owner rule, which keeps stores like them owned.",
    );

    const read: ListCall | undefined = listCalls.find(
      (call: ListCall): boolean => {
        return call.model === "DataSecurityAiProposal";
      },
    );

    expect(read?.query["status"]).toBe(DataSecurityAiProposalStatus.Proposed);
    expect((read?.query["kind"] as Includes).values).toEqual([
      ...DATA_SECURITY_AI_OWNER_PROPOSAL_KINDS,
    ]);
    expect(read?.sort).toEqual({ riskScore: SortOrder.Descending });

    // A store: who, how sure, and why.
    const ledger: HTMLElement = rowOf(list, LEDGER.title!);

    expect(ledger).toHaveTextContent("Payments");
    expect(ledger).toHaveTextContent(OwnersToReviewCopy.sure);
    expect(ledger).toHaveTextContent("The team tag names Payments.");
    expect(ledger).not.toHaveTextContent(OwnersToReviewCopy.evidenceDisagrees);

    // Where the evidence disagrees, it says so, and is not sure.
    const exports: HTMLElement = rowOf(list, EXPORTS.title!);

    expect(exports).toHaveTextContent("Ada Lovelace");
    expect(exports).toHaveTextContent(OwnersToReviewCopy.notSure);
    expect(exports).toHaveTextContent(
      `${OwnersToReviewCopy.evidenceDisagrees} Its team tag names Platform.`,
    );

    // A rule: whom it adds, and to how many stores.
    const rule: HTMLElement = rowOf(list, RULE.title!);

    expect(rule).toHaveTextContent(
      "This rule would add these owners to 4 stores. 1 of them already has owners.",
    );
    expect(rule).not.toHaveTextContent(OwnersToReviewCopy.sure);

    // Nothing is approved by drawing it.
    expect(posts).toEqual([]);
  });

  test("Approve shows the whole proposal first, then approves the plan it shows", async () => {
    await draw();

    const list: HTMLElement = await card(LEDGER.title!);

    fireEvent.click(
      within(rowOf(list, LEDGER.title!)).getByRole("button", {
        name: DataSecurityAiPageCopy.approve,
      }),
    );

    const review: HTMLElement = await screen.findByTestId(
      "data-security-ai-proposal-review",
    );

    expect(
      within(review)
        .getAllByTestId("markdown")
        .map((part: HTMLElement): string => {
          return part.textContent || "";
        }),
    ).toEqual([
      LEDGER.changeMarkdown,
      LEDGER.reasonMarkdown,
      LEDGER.proofMarkdown,
      LEDGER.undoMarkdown,
    ]);
    // Why it waits: an owner is one of the changes that always ask.
    expect(review).toHaveTextContent(
      "A change that deletes data, pages people or adds an owner always waits for a person.",
    );
    expect(approvals()).toEqual([]);

    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: DataSecurityAiPageCopy.approve,
      }),
    );

    await waitFor(() => {
      expect(approvals()).toHaveLength(1);
    });

    expect(approvals()[0]).toEqual({
      path: DATA_SECURITY_API_ROUTES.approveAiProposal(LEDGER._id!),
      data: {
        expectedPlanFingerprint: getDataSecurityAiPlanFingerprint({
          kind: LEDGER.kind,
          plan: LEDGER.plan,
        }),
      },
    });
  });

  test("Change and Approve is a store's only, and approves the owners the person keeps", async () => {
    await draw();

    const list: HTMLElement = await card(LEDGER.title!);

    // A rule is approved as it was proposed: its menu has no Change and Approve.
    fireEvent.click(
      within(rowOf(list, RULE.title!)).getByTestId("row-actions-more-button"),
    );
    await screen.findByRole("menuitem", {
      name: DataSecurityAiPageCopy.dismiss,
    });
    expect(
      screen.queryByRole("menuitem", {
        name: OwnersToReviewCopy.changeAndApprove,
      }),
    ).toBeNull();
    fireEvent.keyDown(document.activeElement || document.body, {
      key: "Escape",
    });

    fireEvent.click(
      within(rowOf(list, LEDGER.title!)).getByTestId("row-actions-more-button"),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: OwnersToReviewCopy.changeAndApprove,
      }),
    );

    const modal: HTMLElement = await screen.findByTestId("modal");

    expect(modal).toHaveTextContent(OwnersToReviewCopy.changeTitle);
    expect(modal).toHaveTextContent(OwnersToReviewCopy.changeDescription);

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(modal).getByRole("button", {
          name: DataSecurityAiPageCopy.approve,
        }),
      );
    });

    await waitFor(() => {
      expect(approvals()).toHaveLength(1);
    });

    expect(approvals()[0]).toEqual({
      path: DATA_SECURITY_API_ROUTES.approveAiProposal(LEDGER._id!),
      data: {
        expectedPlanFingerprint: getDataSecurityAiPlanFingerprint({
          kind: LEDGER.kind,
          plan: LEDGER.plan,
        }),
        changes: {
          owners: [{ kind: DataStoreOwnerKind.Team, id: PAYMENTS_ID }],
        },
      },
    });
  });
});

describe("what Owners to review reads of a proposal", () => {
  test("a store's owners, how sure, why and where the evidence disagrees", () => {
    expect(readOwnerProposalView(EXPORTS)).toEqual({
      kind: "store",
      dataStoreId: OTHER_STORE_ID,
      dataStoreName: "card-exports",
      owners: [
        {
          kind: DataStoreOwnerKind.User,
          id: PERSON_ID,
          name: "Ada Lovelace",
          canOpenStore: false,
        },
      ],
      confidence: DataStoreOwnerConfidence.Low,
      reason: "Ada changed it most in the last 90 days.",
      disagreement: "Its team tag names Platform.",
    });
  });

  test("a rule's owners and what the rule engine said it would do", () => {
    expect(readOwnerProposalView(RULE)).toEqual({
      kind: "rule",
      owners: [
        {
          kind: DataStoreOwnerKind.Team,
          id: PAYMENTS_ID,
          name: "Payments",
          canOpenStore: true,
        },
      ],
      ruleName: "Payments owns stores tagged team=payments",
      matchingStores: 4,
      alreadyOwned: 1,
    });
  });

  test("a plan it cannot read, or a kind that is not an owner's, is nothing", () => {
    expect(
      readOwnerProposalView({
        kind: DataSecurityAiProposalKind.SetStoreOwners,
        plan: { owners: "Payments" },
      }),
    ).toBeNull();
    expect(
      readOwnerProposalView({
        kind: DataSecurityAiProposalKind.ScrubTelemetry,
        plan: storePlan({}),
      }),
    ).toBeNull();
  });

  test.each<[DataStoreOwnerConfidence, string, PillTone]>([
    [DataStoreOwnerConfidence.High, OwnersToReviewCopy.sure, PillTone.Success],
    [
      DataStoreOwnerConfidence.Medium,
      OwnersToReviewCopy.fairlySure,
      PillTone.Info,
    ],
    [
      DataStoreOwnerConfidence.Low,
      OwnersToReviewCopy.notSure,
      PillTone.Warning,
    ],
  ])(
    "how sure %s reads %s",
    (confidence: DataStoreOwnerConfidence, text: string, tone: PillTone) => {
      expect(getOwnerConfidenceChip(confidence)).toEqual({ text, tone });
    },
  );

  test("a store's row opens its Owners page; a rule's, Owner Rules", () => {
    expect(getOwnerProposalRoute(LEDGER).toString()).toContain(
      `/data-security/stores/${STORE_ID}/owners`,
    );
    expect(getOwnerProposalRoute(RULE).toString()).toContain(
      "/data-security/settings/owner-rules",
    );
  });

  test("only a store's owners may be changed before approving", () => {
    expect(canChangeOwnersFirst(LEDGER)).toBe(true);
    expect(canChangeOwnersFirst(RULE)).toBe(false);
  });

  test("the owners picked are sent as the route takes them, teams and people", () => {
    expect(
      toOwnerChanges({
        ownerTeams: [{ _id: PAYMENTS_ID }],
        ownerUsers: [PERSON_ID, "not an id"],
      }),
    ).toEqual({
      owners: [
        { kind: DataStoreOwnerKind.Team, id: PAYMENTS_ID },
        { kind: DataStoreOwnerKind.User, id: PERSON_ID },
      ],
    });
    expect(
      toOwnersFormValues([
        {
          kind: DataStoreOwnerKind.Team,
          id: PAYMENTS_ID,
          name: "Payments",
          canOpenStore: true,
        },
        {
          kind: DataStoreOwnerKind.User,
          id: PERSON_ID,
          name: "Ada Lovelace",
          canOpenStore: false,
        },
      ]),
    ).toEqual({ ownerTeams: [PAYMENTS_ID], ownerUsers: [PERSON_ID] });
  });

  test("a bulk Approve takes the rules first, each kind in the order picked", () => {
    expect(
      rulesFirst([LEDGER, RULE, EXPORTS]).map(
        (item: DataSecurityAiProposal): string => {
          return item._id!.toString();
        },
      ),
    ).toEqual([RULE._id, LEDGER._id, EXPORTS._id]);
  });
});
