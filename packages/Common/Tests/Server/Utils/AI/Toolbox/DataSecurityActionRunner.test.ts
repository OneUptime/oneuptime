import DataSecurityAiProposalService from "../../../../../Server/Services/DataSecurityAiProposalService";
import DataSecurityIssueFeedService from "../../../../../Server/Services/DataSecurityIssueFeedService";
import DataSecurityIssueService from "../../../../../Server/Services/DataSecurityIssueService";
import DataStoreFeedService from "../../../../../Server/Services/DataStoreFeedService";
import DataStoreService from "../../../../../Server/Services/DataStoreService";
import DatabaseService from "../../../../../Server/Services/DatabaseService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import DataSecurityActionRunner, {
  READ_ONLY_DATA_SECURITY_CONNECTION_REFUSAL,
  getAsksInEveryModeRefusal,
} from "../../../../../Server/Utils/AI/Toolbox/DataSecurityActionRunner";
import ProjectReferenceCheck from "../../../../../Server/Utils/Database/ProjectReferenceCheck";
import * as DataSecurityJobs from "../../../../../Server/Utils/DataSecurity/DataSecurityJobs";
import DataSecurityResponse from "../../../../../Server/Utils/DataSecurity/DataSecurityResponse";
import ServerProducts from "../../../../../Server/Utils/ServerProducts/ServerProducts";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  ASKS_IN_EVERY_MODE_REFUSAL_PREFIX,
  DATA_SECURITY_ACTIONS_RUN_OUTSIDE_CHAT,
  DataSecurityActionRunResult,
  getDataSecurityActionApiKeyRefusal,
} from "../../../../../Types/AI/AIDataSecurityActions";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { DataSecurityResponseAction } from "../../../../../Types/DataSecurity/DataSecurityResponseAction";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import ForbiddenException from "../../../../../Types/Exception/ForbiddenException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import ProductKey from "../../../../../Types/Product/ProductKey";
import UserType from "../../../../../Types/UserType";
import { customDomainCaller } from "../../../API/CustomDomainCallers";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../../../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../../../TestingUtils/RequestPlan";
import { everyServerProductIsOn } from "../../../TestingUtils/ServerProductsOn";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ASK AI'S DATA SECURITY ACTIONS, ONE CALL EACH, FOR THE MCP SERVER (#10378).
 *
 * DataSecurityActionRunner runs the very tool Ask AI runs, through the same
 * prepare, checks and execute, as the caller:
 *
 *   - An action Ask AI asks a person about in every mode is refused: the
 *     refusal says why, in the card's own words, and the page in OneUptime
 *     where the person makes the change - and nothing changes.
 *   - An action that follows the mode runs, as the caller, and answers with
 *     the card's words in English.
 *   - A connection authorized as read-only, and a project API key, are
 *     refused every change before anything is read for it; a key may read.
 *   - What the checks refuse is refused - a missing reason, an issue the
 *     caller may not read, Data Security switched off - with the words Ask
 *     AI's turn tells the model.
 */

afterEach(() => {
  jest.restoreAllMocks();
});

const PROJECT_ID: ObjectID = new ObjectID(
  "10378000-0000-4000-8000-000000000101",
);
const BUCKET_ID: string = "10378000-0000-4000-8000-0000000001b1";
const OPEN_ISSUE_ID: string = "10378000-0000-4000-8000-0000000001c1";
const RESOLVED_ISSUE_ID: string = "10378000-0000-4000-8000-0000000001c2";

const asService: <T extends BaseModel>(
  service: unknown,
) => DatabaseService<T> = <T extends BaseModel>(
  service: unknown,
): DatabaseService<T> => {
  return service as DatabaseService<T>;
};

function caller(
  permissions: Array<Permission> = [Permission.ProjectOwner],
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

// A project API key: the project's permissions, and no person.
function apiKey(): DatabaseCommonInteractionProps {
  return {
    ...caller(),
    userType: UserType.API,
    userId: undefined,
    apiKeyId: new ObjectID("10378000-0000-4000-8000-0000000001d1"),
  };
}

const BUCKET: StoredRow = {
  _id: BUCKET_ID,
  projectId: PROJECT_ID.toString(),
  name: "website-assets",
  kind: "AWS S3 Bucket",
  provider: "aws",
  region: "us-east-1",
  exposure: "Public",
  sensitivity: "Confidential",
  dataTypeIds: ["email-address"],
  isArchived: false,
  cloudConnectionId: "10378000-0000-4000-8000-0000000001a1",
};

function issue(id: string, status: string): StoredRow {
  return {
    _id: id,
    projectId: PROJECT_ID.toString(),
    title:
      status === "Open"
        ? "Anyone on the internet can read it"
        : "Versioning is off",
    checkId: status === "Open" ? "public-read" : "versioning-off",
    severity: "Critical",
    status,
    dataStoreId: BUCKET_ID,
    dataStore: BUCKET,
  };
}

let issues: InMemoryTable;
let respond: jest.SpyInstance;
// As the helper types it: jest-mock's spy of ServerProducts.getOff.
let productsOff: ReturnType<typeof everyServerProductIsOn>;

beforeEach(() => {
  productsOff = everyServerProductIsOn();
  useInMemoryTable(asService(DataStoreService), [BUCKET]);
  issues = useInMemoryTable(asService(DataSecurityIssueService), [
    issue(OPEN_ISSUE_ID, "Open"),
    issue(RESOLVED_ISSUE_ID, "Resolved"),
  ]);
  useInMemoryTable(asService(DataSecurityAiProposalService), []);
  jest
    .spyOn(ProjectReferenceCheck, "validateUpdate")
    .mockResolvedValue(undefined as never);
  jest.spyOn(ProjectService, "findOneById").mockResolvedValue(null as never);
  jest
    .spyOn(DataSecurityIssueFeedService, "createDataSecurityIssueFeedItem")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(DataStoreFeedService, "createDataStoreFeedItem")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(DataSecurityJobs, "queueDataSecurityEvaluation")
    .mockResolvedValue(undefined as never);
  jest.spyOn(DataSecurityResponse, "getAvailability").mockResolvedValue({
    actions: [
      {
        action: DataSecurityResponseAction.BlockPublicAccess,
        isAvailable: true,
      },
    ],
  } as never);
  respond = jest
    .spyOn(DataSecurityResponse, "run")
    .mockResolvedValue({ status: "Succeeded" } as never);
});

async function run(data: {
  action: string;
  args: unknown;
  props?: DatabaseCommonInteractionProps;
}): Promise<DataSecurityActionRunResult> {
  return await DataSecurityActionRunner.run({
    action: data.action,
    args: data.args,
    ctx: { projectId: PROJECT_ID, props: data.props || caller() },
  });
}

async function refusalOf(
  promise: Promise<unknown>,
): Promise<{ type: string; message: string }> {
  try {
    await promise;
  } catch (error) {
    return {
      type: (error as Error).constructor.name,
      message: (error as Error).message,
    };
  }

  throw new Error("It ran.");
}

const RESPOND_ARGS: Record<string, string> = {
  dataStoreId: BUCKET_ID,
  action: DataSecurityResponseAction.BlockPublicAccess,
  dataSecurityIssueId: OPEN_ISSUE_ID,
};

describe("what the runner takes", () => {
  test("only the actions the MCP server offers, by name", async () => {
    const refused: { type: string; message: string } = await refusalOf(
      run({ action: "delete_everything", args: {} }),
    );

    expect(refused.type).toBe(BadDataException.name);
    expect(refused.message).toContain(
      'Unknown Data Security action "delete_everything"',
    );

    for (const action of DATA_SECURITY_ACTIONS_RUN_OUTSIDE_CHAT) {
      expect(refused.message).toContain(action);
    }
  });

  test.each([null, "reopen", ["reopen"], 42])(
    "arguments that are not a JSON object (%p) are refused before anything is read",
    async (args: unknown) => {
      const refused: { type: string; message: string } = await refusalOf(
        run({ action: "change_data_security_issue", args }),
      );

      expect(refused).toEqual({
        type: BadDataException.name,
        message:
          "The arguments of change_data_security_issue must be a JSON object.",
      });
    },
  );
});

describe("who may change Data Security through the MCP server", () => {
  test("a connection authorized as read-only is refused every change, and nothing changes", async () => {
    const props: DatabaseCommonInteractionProps = {
      ...caller(),
      isReadOnlyCredential: true,
    } as DatabaseCommonInteractionProps;

    const refused: { type: string; message: string } = await refusalOf(
      run({
        action: "change_data_security_issue",
        args: { dataSecurityIssueId: RESOLVED_ISSUE_ID, change: "reopen" },
        props,
      }),
    );

    expect(refused).toEqual({
      type: ForbiddenException.name,
      message: READ_ONLY_DATA_SECURITY_CONNECTION_REFUSAL,
    });
    expect(issues.get(RESOLVED_ISSUE_ID)?.["status"]).toBe("Resolved");
  });

  test("a project API key is refused every change, in words that say why and what to do", async () => {
    const refused: { type: string; message: string } = await refusalOf(
      run({
        action: "change_data_security_issue",
        args: { dataSecurityIssueId: RESOLVED_ISSUE_ID, change: "reopen" },
        props: apiKey(),
      }),
    );

    expect(refused).toEqual({
      type: ForbiddenException.name,
      message: getDataSecurityActionApiKeyRefusal("change_data_security_issue"),
    });
    expect(issues.get(RESOLVED_ISSUE_ID)?.["status"]).toBe("Resolved");
  });

  test("a project API key may still read what OneUptime AI proposes", async () => {
    const result: DataSecurityActionRunResult = await run({
      action: "query_data_security_proposals",
      args: {},
      props: apiKey(),
    });

    expect(result.action).toBe("query_data_security_proposals");
    expect(result.title).toBeUndefined();
    expect(result.changes).toEqual([]);
  });
});

describe("an action Ask AI asks about in every mode is refused, with why and where", () => {
  test("a response on a store: the card's reason, the store's page, and the cloud is never touched", async () => {
    const refused: { type: string; message: string } = await refusalOf(
      run({ action: "respond_on_data_store", args: RESPOND_ARGS }),
    );

    expect(refused.type).toBe(ForbiddenException.name);
    expect(refused.message.startsWith(ASKS_IN_EVERY_MODE_REFUSAL_PREFIX)).toBe(
      true,
    );
    // Why, in the card's words.
    expect(refused.message).toContain(
      "Asks first in every mode: it changes the store in its cloud, and what reads it may stop working.",
    );
    // Where: the page its button is on - the issue it is run from, for this project.
    expect(refused.message).toContain(
      `/dashboard/${PROJECT_ID.toString()}/data-security/issues/${OPEN_ISSUE_ID}`,
    );
    expect(refused.message).toContain("respond_on_data_store is not run here");
    expect(respond).not.toHaveBeenCalled();
  });

  test("a response with no issue named sends the person to the store's page", async () => {
    const refused: { type: string; message: string } = await refusalOf(
      run({
        action: "respond_on_data_store",
        args: {
          dataStoreId: BUCKET_ID,
          action: DataSecurityResponseAction.BlockPublicAccess,
        },
      }),
    );

    expect(refused.message).toContain(
      `/dashboard/${PROJECT_ID.toString()}/data-security/stores/${BUCKET_ID}`,
    );
    expect(respond).not.toHaveBeenCalled();
  });

  test("Accept Risk, with its reason: refused, and the issue still counts", async () => {
    const refused: { type: string; message: string } = await refusalOf(
      run({
        action: "change_data_security_issue",
        args: {
          dataSecurityIssueId: OPEN_ISSUE_ID,
          change: "accept-risk",
          reason: "It is our CDN origin.",
        },
      }),
    );

    expect(refused.type).toBe(ForbiddenException.name);
    expect(refused.message).toContain(
      "Asks first in every mode: it stops an issue counting.",
    );
    expect(refused.message).toContain(
      `/dashboard/${PROJECT_ID.toString()}/data-security/issues/${OPEN_ISSUE_ID}`,
    );
    expect(issues.get(OPEN_ISSUE_ID)?.["status"]).toBe("Open");
  });

  test("the refusal without a page still says where: Data Security's own button, or Ask AI", () => {
    expect(
      getAsksInEveryModeRefusal({
        action: "decide_data_security_proposal",
        reason: undefined,
        pageUrl: null,
      }),
    ).toBe(
      `${ASKS_IN_EVERY_MODE_REFUSAL_PREFIX} An MCP client shows no card OneUptime can wait on, so decide_data_security_proposal is not run here. Do it in OneUptime, with Data Security's own button or with Ask AI, which shows the change on a card for the person to approve.`,
    );
  });
});

describe("an action that follows the mode runs, as the caller", () => {
  test("Reopen: the issue counts again, and the answer says what changed in the card's words", async () => {
    const result: DataSecurityActionRunResult = await run({
      action: "change_data_security_issue",
      args: { dataSecurityIssueId: RESOLVED_ISSUE_ID, change: "reopen" },
    });

    expect(issues.get(RESOLVED_ISSUE_ID)?.["status"]).toBe("Open");
    expect(result.title).toBe('Reopen "Versioning is off" on "website-assets"');
    expect(result.changes).toEqual([
      "The issue is open again and counts again. If its check passes now, it resolves on its own.",
    ]);
    expect(result.message).toContain("reopen");
    expect(result.record).toEqual({
      type: "DataSecurityIssueView",
      params: { dataSecurityIssueId: RESOLVED_ISSUE_ID },
    });
  });

  test("what the schema does not take is dropped: a prepared key passed by the agent is never the action's", async () => {
    await run({
      action: "change_data_security_issue",
      args: {
        dataSecurityIssueId: RESOLVED_ISSUE_ID,
        change: "reopen",
        // A key the prepare writes, never the caller's.
        assigneeTeamId: "10378000-0000-4000-8000-0000000001f9",
      },
    });

    expect(issues.get(RESOLVED_ISSUE_ID)?.["assignedToTeamId"]).toBeUndefined();
  });
});

describe("what the checks refuse is refused, and nothing changes", () => {
  test("Accept Risk without a reason: the person's own words are asked for", async () => {
    const refused: { type: string; message: string } = await refusalOf(
      run({
        action: "change_data_security_issue",
        args: { dataSecurityIssueId: OPEN_ISSUE_ID, change: "accept-risk" },
      }),
    );

    expect(refused.type).toBe(BadDataException.name);
    expect(refused.message).toContain("this takes a reason");
    expect(issues.get(OPEN_ISSUE_ID)?.["status"]).toBe("Open");
  });

  test("an issue the caller may not read is not found", async () => {
    const refused: { type: string; message: string } = await refusalOf(
      run({
        action: "change_data_security_issue",
        args: {
          dataSecurityIssueId: "10378000-0000-4000-8000-0000000001c9",
          change: "reopen",
        },
      }),
    );

    expect(refused.message).toContain("the issue was not found");
  });

  test("a role without Data Security's permissions is refused, and the issue stays as it was", async () => {
    const refused: { type: string; message: string } = await refusalOf(
      run({
        action: "change_data_security_issue",
        args: { dataSecurityIssueId: RESOLVED_ISSUE_ID, change: "reopen" },
        props: caller([Permission.ReadDataStore]),
      }),
    );

    expect(refused.type).toBe(ForbiddenException.name);
    expect(issues.get(RESOLVED_ISSUE_ID)?.["status"]).toBe("Resolved");
  });

  test("Data Security switched off on the server: refused, and the issue stays as it was", async () => {
    productsOff.mockResolvedValue({
      [ProductKey.DataSecurity]: "SwitchedOff",
    } as never);

    const refused: { type: string; message: string } = await refusalOf(
      run({
        action: "change_data_security_issue",
        args: { dataSecurityIssueId: RESOLVED_ISSUE_ID, change: "reopen" },
      }),
    );

    expect(refused.type).toBe(ForbiddenException.name);
    expect(issues.get(RESOLVED_ISSUE_ID)?.["status"]).toBe("Resolved");
    expect(ServerProducts.getOff).toHaveBeenCalled();
  });
});
