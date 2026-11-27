/**
 * A WRITE THAT MAKES A CHANGE ONEUPTIME ASKS A PERSON BEFORE IS NEVER SENT
 * (#11177).
 *
 * change_data_security_issue's Accept Risk is refused on this server: Ask
 * AI asks a person before it in every mode, and no card can be shown here.
 * update_data_security_issue sent the very write that button sends - status
 * "Accepted", a reason, a date - with nobody asked. Now every write the
 * server sends is read first against Common's one list
 * (Types/AI/AIAlwaysAskChanges), the way the record's route reads it, and
 * refused before anything is sent where it makes such a change - in the
 * Data Security tools' own sentence, with the page where the person makes
 * it, and a suggestion not to retry nor route around it. Every other write
 * of the same records goes on as it did.
 *
 * Each test calls a tool the way a client does - the SDK's Client, an
 * in-memory transport, the server's own handlers - and asks the stand-in
 * API (AlwaysAskHarness) what reached it.
 */

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

jest.mock("Common/Server/Utils/Logger", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/Logger",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      trace: jest.fn(),
    },
  };
});
jest.mock("../Utils/MCPLogger");

import {
  ConnectedClient,
  DASHBOARD,
  FakeOneUptimeApi,
  PROJECT_ID,
  SentRequest,
  ToolAnswer,
  projectApiKey,
  readFailure,
  signedInMember,
} from "./AlwaysAskHarness";
import {
  FINDING_ID,
  ISSUE_ID,
  NOTE_STEP,
  ORDINARY_WRITES,
  OrdinaryWrite,
  PLAYBOOK_ID,
  RULE_ID,
  SETTING_ID,
  STORE_ID,
  pagesForCriticalIssues,
  pagesNobody,
  suspendStep,
} from "./AlwaysAskFixtures";
import { getAsksAPersonSuggestion } from "../Handlers/ToolHandler";
import OneUptimeApiService, {
  OneUptimeApiError,
} from "../Services/OneUptimeApiService";
import * as AlwaysAskWritesModule from "../Tools/AlwaysAskWrites";
import {
  AsksAPersonFirstError,
  describeWritesThatAskAPerson,
  findAlwaysAskChangeOfWrite,
  readId,
  readRecordWriteOfRequest,
  RecordWrite,
} from "../Tools/AlwaysAskWrites";
import { describeResource } from "../Tools/DescribeResource";
import * as ToolGenerator from "../Tools/ToolGenerator";
import { applyWritePolicy, generateAllTools } from "../Tools/ToolGenerator";
import { McpCredential } from "../Types/McpCredential";
import { McpToolInfo } from "../Types/McpTypes";
import ModelType from "../Types/ModelType";
import OneUptimeOperation from "../Types/OneUptimeOperation";
import {
  ALWAYS_ASK_CHANGES,
  AlwaysAskChange,
  AlwaysAskWrite,
  getAsksInEveryModeRefusal,
} from "Common/Types/AI/AIAlwaysAskChanges";
import {
  ASKS_IN_EVERY_MODE_REFUSAL_PREFIX,
  ASKS_IN_EVERY_MODE_SUGGESTION,
  getDataSecurityActionApiKeyRefusal,
} from "Common/Types/AI/AIDataSecurityActions";
import { AI_DATA_SECURITY_ACTION_ASKS_BECAUSE } from "Common/Types/AI/AIDataSecurityActionWords";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";

const tools: Array<McpToolInfo> = generateAllTools();

function toolOf(tableName: string, operation: OneUptimeOperation): McpToolInfo {
  const tool: McpToolInfo | undefined = tools.find(
    (candidate: McpToolInfo): boolean => {
      return (
        candidate.tableName === tableName &&
        candidate.operation === operation &&
        candidate.modelType === ModelType.Database
      );
    },
  );

  if (!tool) {
    throw new Error(`No ${operation} tool for ${tableName}.`);
  }

  return tool;
}

function apiPathOf(tableName: string): string {
  return toolOf(tableName, OneUptimeOperation.Read).apiPath || "";
}

function reasonOf(name: string): string {
  return (
    ALWAYS_ASK_CHANGES.find((change: AlwaysAskChange): boolean => {
      return change.name === name;
    })?.asksBecause || ""
  );
}

const UPDATE_ISSUE: McpToolInfo = toolOf(
  "DataSecurityIssue",
  OneUptimeOperation.Update,
);
const UPDATE_FINDING: McpToolInfo = toolOf(
  "DataStoreFinding",
  OneUptimeOperation.Update,
);

let api: FakeOneUptimeApi;
let connected: ConnectedClient;

// The API this test runs against: a test made in a loop reads it through this.
function getApi(): FakeOneUptimeApi {
  return api;
}

beforeAll(() => {
  OneUptimeApiService.initialize({ url: "https://oneuptime.example.com" });
});

beforeEach(() => {
  api = new FakeOneUptimeApi();
  api.install();
  connected = new ConnectedClient();
});

afterEach(async () => {
  await connected.close();
  jest.restoreAllMocks();
});

async function call(
  tool: McpToolInfo | string,
  args: JSONObject,
  credential: McpCredential = signedInMember(),
): Promise<ToolAnswer> {
  await connected.connect(tools, credential);

  return await connected.call(
    typeof tool === "string" ? tool : tool.name,
    args,
  );
}

// The record writes of this table that reached the API.
function writesTo(tableName: string): Array<RecordWrite> {
  return api.writesSent().filter((write: RecordWrite): boolean => {
    return write.tableName === tableName;
  });
}

describe("the bypass: a record tool could make what the Data Security tools refuse", () => {
  it("update_data_security_issue is offered, and takes the very columns Accept Risk writes", () => {
    const properties: Record<string, unknown> =
      UPDATE_ISSUE.inputSchema.properties || {};

    expect(UPDATE_ISSUE.name).toBe("update_data_security_issue");
    expect(Object.keys(properties)).toEqual(
      expect.arrayContaining(["status", "acceptedReason", "acceptedUntil"]),
    );
  });

  it("was answered with success, and the write sent, before this change - as it is with the hold taken away", async () => {
    // The server as it was: nothing read a write before it was sent.
    jest
      .spyOn(AlwaysAskWritesModule, "refuseWriteThatAsksAPerson")
      .mockResolvedValue(undefined);

    const answer: ToolAnswer = await call(UPDATE_ISSUE, {
      id: ISSUE_ID,
      status: "Accepted",
      acceptedReason: "A compensating control covers it.",
      acceptedUntil: "2027-01-31T23:59:59.999Z",
    });

    expect(answer.isError).toBeFalsy();
    expect(writesTo("DataSecurityIssue")).toEqual([
      {
        tableName: "DataSecurityIssue",
        write: AlwaysAskWrite.Update,
        id: ISSUE_ID,
        data: {
          status: "Accepted",
          acceptedReason: "A compensating control covers it.",
          acceptedUntil: "2027-01-31T23:59:59.999Z",
        },
      },
    ]);
  });

  it("is refused now, with nothing sent", async () => {
    const answer: ToolAnswer = await call(UPDATE_ISSUE, {
      id: ISSUE_ID,
      status: "Accepted",
      acceptedReason: "A compensating control covers it.",
      acceptedUntil: "2027-01-31T23:59:59.999Z",
    });

    expect(answer.isError).toBe(true);
    expect(writesTo("DataSecurityIssue")).toEqual([]);
  });
});

describe("the refusal is the Data Security tools' own", () => {
  it("says why as the card does, names the tool, and names the issue's page", async () => {
    const answer: ToolAnswer = await call(UPDATE_ISSUE, {
      id: ISSUE_ID,
      status: "Accepted",
      acceptedReason: "x",
      acceptedUntil: "2027-01-31",
    });
    const { error, suggestion }: { error: string; suggestion: string } =
      readFailure(answer);

    expect(error).toBe(
      getAsksInEveryModeRefusal({
        action: "update_data_security_issue",
        reason: AI_DATA_SECURITY_ACTION_ASKS_BECAUSE.acceptRisk,
        pageUrl: `http://localhost${DASHBOARD}/${PROJECT_ID}/data-security/issues/${ISSUE_ID}`,
      }),
    );
    expect(error.startsWith(ASKS_IN_EVERY_MODE_REFUSAL_PREFIX)).toBe(true);
    expect(suggestion).toBe(ASKS_IN_EVERY_MODE_SUGGESTION);
  });

  it("a signed-in member's page needs no read: the project is the sign-in's", async () => {
    await call(UPDATE_ISSUE, { id: ISSUE_ID, status: "Not an issue" });

    expect(api.sent).toEqual([]);
  });

  it("with an API key, the issue's project is read, as the key, for its page", async () => {
    api.holds("/data-security-issue", ISSUE_ID, { projectId: PROJECT_ID });

    const answer: ToolAnswer = await call(
      UPDATE_ISSUE,
      { id: ISSUE_ID, status: "Not an issue" },
      projectApiKey(),
    );

    expect(readFailure(answer).error).toContain(
      `${DASHBOARD}/${PROJECT_ID}/data-security/issues/${ISSUE_ID}`,
    );
    expect(
      api.readsSent().map((request: SentRequest): string => {
        return request.path;
      }),
    ).toEqual([`/api/data-security-issue/${ISSUE_ID}/get-item`]);
    expect(api.readsSent()[0]?.headers["APIKey"]).toBeDefined();
    expect(writesTo("DataSecurityIssue")).toEqual([]);
  });

  it("an API key whose read of the record fails is still refused, and sent to the project's own page", async () => {
    api.refusedReads.push("/api/data-security-issue/");
    api.lists.set("/project", [{ _id: PROJECT_ID }]);

    const answer: ToolAnswer = await call(
      UPDATE_ISSUE,
      { id: ISSUE_ID, status: "Accepted" },
      projectApiKey(),
    );

    expect(answer.isError).toBe(true);
    expect(readFailure(answer).error).toContain(
      `${DASHBOARD}/${PROJECT_ID}/data-security/issues/${ISSUE_ID}`,
    );
    expect(writesTo("DataSecurityIssue")).toEqual([]);
  });

  it("where no page can be read, it is refused all the same, and names Data Security's button", async () => {
    api.refusedReads.push("/api/");

    const answer: ToolAnswer = await call(
      UPDATE_ISSUE,
      { id: ISSUE_ID, status: "Accepted" },
      projectApiKey(),
    );

    expect(readFailure(answer).error).toBe(
      getAsksInEveryModeRefusal({
        action: "update_data_security_issue",
        reason: AI_DATA_SECURITY_ACTION_ASKS_BECAUSE.acceptRisk,
        pageUrl: null,
      }),
    );
    expect(writesTo("DataSecurityIssue")).toEqual([]);
  });

  it("Not Sensitive names the finding's store's findings, read as the caller", async () => {
    api.holds("/data-store-finding", FINDING_ID, {
      projectId: PROJECT_ID,
      dataStoreId: STORE_ID,
    });

    const answer: ToolAnswer = await call(UPDATE_FINDING, {
      id: FINDING_ID,
      isSuppressed: true,
      suppressedReason: "Synthetic data.",
    });

    expect(readFailure(answer).error).toBe(
      getAsksInEveryModeRefusal({
        action: UPDATE_FINDING.name,
        reason: AI_DATA_SECURITY_ACTION_ASKS_BECAUSE.notSensitive,
        pageUrl: `http://localhost${DASHBOARD}/${PROJECT_ID}/data-security/stores/${STORE_ID}/inside`,
      }),
    );
    expect(writesTo("DataStoreFinding")).toEqual([]);
  });

  it("a rule saved names the residency rules' page, and a key's project is read for it", async () => {
    api.lists.set("/project", [{ _id: PROJECT_ID }]);

    const answer: ToolAnswer = await call(
      toolOf("DataSecurityResidencyRule", OneUptimeOperation.Create),
      { name: "EU data", allowedRegions: ["eu-*"] },
      projectApiKey(),
    );

    expect(readFailure(answer).error).toContain(
      `${DASHBOARD}/${PROJECT_ID}/data-security/settings/residency`,
    );
    expect(readFailure(answer).error).toContain(
      AI_DATA_SECURITY_ACTION_ASKS_BECAUSE.rule,
    );
    expect(writesTo("DataSecurityResidencyRule")).toEqual([]);
  });

  it("a data type turned off names Data Types, a place left out the store's Settings, a playbook its own page", async () => {
    api.holds(apiPathOf("DataSecuritySetting"), SETTING_ID, {
      disabledDataTypeIds: [],
    });
    api.holds(apiPathOf("DataStore"), STORE_ID, { scanExclusions: [] });
    api.holds(apiPathOf("SecurityPlaybook"), PLAYBOOK_ID, { steps: [] });

    const setting: ToolAnswer = await call(
      toolOf("DataSecuritySetting", OneUptimeOperation.Update),
      { id: SETTING_ID, disabledDataTypeIds: ["credit-card"] },
    );
    await connected.close();
    const store: ToolAnswer = await call(
      toolOf("DataStore", OneUptimeOperation.Update),
      { id: STORE_ID, scanExclusions: ["exports/"] },
    );
    await connected.close();
    const playbook: ToolAnswer = await call(
      toolOf("SecurityPlaybook", OneUptimeOperation.Update),
      { id: PLAYBOOK_ID, steps: [suspendStep("suspend", false)] },
    );

    expect(readFailure(setting).error).toContain(
      `${DASHBOARD}/${PROJECT_ID}/data-security/settings/data-types`,
    );
    expect(readFailure(setting).error).toContain(
      reasonOf("A data type turned off"),
    );
    expect(readFailure(store).error).toContain(
      `${DASHBOARD}/${PROJECT_ID}/data-security/stores/${STORE_ID}/settings`,
    );
    expect(readFailure(playbook).error).toContain(
      `${DASHBOARD}/${PROJECT_ID}/security-events/playbooks/${PLAYBOOK_ID}`,
    );
    expect(readFailure(playbook).error).toContain(
      reasonOf(
        "A playbook's containment or store response run with nobody's approval",
      ),
    );
    expect(api.writesSent()).toEqual([]);
  });

  it("a new playbook that would contain on its own is sent to the playbooks", async () => {
    const answer: ToolAnswer = await call(
      toolOf("SecurityPlaybook", OneUptimeOperation.Create),
      { name: "Contain", steps: [suspendStep("suspend", false)] },
    );

    expect(readFailure(answer).error).toContain(
      `${DASHBOARD}/${PROJECT_ID}/security-events/playbooks,`,
    );
    expect(writesTo("SecurityPlaybook")).toEqual([]);
  });
});

describe("a value is read as the route stores it", () => {
  it("a switch sent as text or a number is the switch the database stores", async () => {
    for (const on of [true, "true", "yes", "on", 1, "1", " TRUE "]) {
      api.sent = [];
      await connected.close();
      const answer: ToolAnswer = await call(UPDATE_FINDING, {
        id: FINDING_ID,
        isSuppressed: on,
      } as JSONObject);

      expect({ on, refused: answer.isError === true }).toEqual({
        on,
        refused: true,
      });
      expect(writesTo("DataStoreFinding")).toEqual([]);
    }
  });

  it("a switch turned off is sent", async () => {
    for (const off of [false, "false", "no", 0]) {
      api.sent = [];
      await connected.close();
      const answer: ToolAnswer = await call(UPDATE_FINDING, {
        id: FINDING_ID,
        isSuppressed: off,
      } as JSONObject);

      expect({ off, refused: answer.isError === true }).toEqual({
        off,
        refused: false,
      });
      expect(writesTo("DataStoreFinding")).toHaveLength(1);
    }
  });

  it("a status sent as a name's object, or in another case, is the status it saves", async () => {
    for (const status of [
      { _type: "Name", value: "Accepted" },
      " accepted ",
      "NOT AN ISSUE",
    ]) {
      api.sent = [];
      await connected.close();
      const answer: ToolAnswer = await call(UPDATE_ISSUE, {
        id: ISSUE_ID,
        status,
      } as JSONObject);

      expect({ status, refused: answer.isError === true }).toEqual({
        status,
        refused: true,
      });
      expect(writesTo("DataSecurityIssue")).toEqual([]);
    }
  });

  it("the columns are read as the route reads them, and as sent where they cannot be", () => {
    expect(
      findAlwaysAskChangeOfWrite({
        tableName: "DataSecurityIssue",
        write: AlwaysAskWrite.Update,
        id: ISSUE_ID,
        data: { status: { _type: "Name", value: "Accepted" } },
      })?.change.name,
    ).toBe("Accept Risk");
    expect(
      findAlwaysAskChangeOfWrite({
        tableName: "DataStoreFinding",
        write: AlwaysAskWrite.Update,
        id: FINDING_ID,
        data: { isSuppressed: "yes" },
      })?.change.name,
    ).toBe("Not Sensitive");
  });
});

describe("Confirm asks where a Critical issue pages someone, as the card reads it", () => {
  it("where Data Security raises an alert, or declares an incident, for one: refused", async () => {
    pagesForCriticalIssues(api);

    const raised: ToolAnswer = await call(UPDATE_FINDING, {
      id: FINDING_ID,
      isConfirmed: true,
    });

    expect(readFailure(raised).error).toContain(
      AI_DATA_SECURITY_ACTION_ASKS_BECAUSE.confirmCanPage,
    );

    api.lists.set("/data-security-setting", [
      {
        raiseAlertsForCriticalIssues: false,
        declareIncidentsForCriticalIssues: true,
      },
    ]);
    await connected.close();
    const declared: ToolAnswer = await call(UPDATE_FINDING, {
      id: FINDING_ID,
      isConfirmed: true,
    });

    expect(declared.isError).toBe(true);
    expect(writesTo("DataStoreFinding")).toEqual([]);
  });

  it("where it pages nobody, or Data Security has no setting yet: sent", async () => {
    pagesNobody(api);

    expect(
      (await call(UPDATE_FINDING, { id: FINDING_ID, isConfirmed: true }))
        .isError,
    ).toBeFalsy();

    api.lists.set("/data-security-setting", []);
    await connected.close();

    expect(
      (await call(UPDATE_FINDING, { id: FINDING_ID, isConfirmed: true }))
        .isError,
    ).toBeFalsy();
    expect(writesTo("DataStoreFinding")).toHaveLength(2);
  });

  it("where the setting cannot be read: refused, never made unseen", async () => {
    api.refusedReads.push("/api/data-security-setting/");

    const answer: ToolAnswer = await call(
      UPDATE_FINDING,
      { id: FINDING_ID, isConfirmed: true },
      projectApiKey(),
    );

    expect(answer.isError).toBe(true);
    expect(writesTo("DataStoreFinding")).toEqual([]);
  });

  it("the setting is read as the caller", async () => {
    pagesNobody(api);

    await call(
      UPDATE_FINDING,
      { id: FINDING_ID, isConfirmed: true },
      projectApiKey(),
    );

    const read: SentRequest | undefined = api.sent.find(
      (request: SentRequest): boolean => {
        return request.path === "/api/data-security-setting/get-list";
      },
    );

    expect(read?.headers["APIKey"]).toBeDefined();
    expect(read?.body?.["select"]).toEqual({
      raiseAlertsForCriticalIssues: true,
      declareIncidentsForCriticalIssues: true,
    });
  });
});

describe("a change judged against what the record holds now", () => {
  it("a data type added to the list is refused, read as the caller first", async () => {
    api.holds(apiPathOf("DataSecuritySetting"), SETTING_ID, {
      disabledDataTypeIds: ["email"],
    });

    const answer: ToolAnswer = await call(
      toolOf("DataSecuritySetting", OneUptimeOperation.Update),
      { id: SETTING_ID, disabledDataTypeIds: ["email", "credit-card"] },
    );

    expect(answer.isError).toBe(true);
    expect(api.readsSent()[0]?.path).toBe(
      `/api${apiPathOf("DataSecuritySetting")}/${SETTING_ID}/get-item`,
    );
    expect(api.readsSent()[0]?.body?.["select"]).toEqual({
      disabledDataTypeIds: true,
    });
    expect(writesTo("DataSecuritySetting")).toEqual([]);
  });

  it("the list written as it is, or one shorter, is sent", async () => {
    api.holds(apiPathOf("DataSecuritySetting"), SETTING_ID, {
      disabledDataTypeIds: ["email", "iban"],
    });

    for (const ids of [["email", "iban"], ["iban"], []]) {
      api.sent = [];
      await connected.close();
      const answer: ToolAnswer = await call(
        toolOf("DataSecuritySetting", OneUptimeOperation.Update),
        { id: SETTING_ID, disabledDataTypeIds: ids },
      );

      expect({ ids, refused: answer.isError === true }).toEqual({
        ids,
        refused: false,
      });
      expect(writesTo("DataSecuritySetting")).toHaveLength(1);
    }
  });

  it("a setting that cannot be read is refused a longer list", async () => {
    api.refusedReads.push(`/api${apiPathOf("DataSecuritySetting")}/`);

    const answer: ToolAnswer = await call(
      toolOf("DataSecuritySetting", OneUptimeOperation.Update),
      { id: SETTING_ID, disabledDataTypeIds: ["email"] },
    );

    expect(answer.isError).toBe(true);
    expect(writesTo("DataSecuritySetting")).toEqual([]);
  });

  it("a write that could make no change reads nothing at all", async () => {
    await call(toolOf("DataSecuritySetting", OneUptimeOperation.Update), {
      id: SETTING_ID,
      keepMaskedSamples: true,
    });

    expect(api.readsSent()).toEqual([]);
    expect(writesTo("DataSecuritySetting")).toHaveLength(1);
  });

  it("a playbook step kept as the person left it is sent; one turned off is refused", async () => {
    api.holds(apiPathOf("SecurityPlaybook"), PLAYBOOK_ID, {
      steps: [suspendStep("suspend", false), NOTE_STEP],
    });

    const kept: ToolAnswer = await call(
      toolOf("SecurityPlaybook", OneUptimeOperation.Update),
      { id: PLAYBOOK_ID, steps: [suspendStep("suspend", false), NOTE_STEP] },
    );

    expect(kept.isError).toBeFalsy();

    api.holds(apiPathOf("SecurityPlaybook"), PLAYBOOK_ID, {
      steps: [suspendStep("suspend", true), NOTE_STEP],
    });
    await connected.close();
    const turnedOff: ToolAnswer = await call(
      toolOf("SecurityPlaybook", OneUptimeOperation.Update),
      { id: PLAYBOOK_ID, steps: [suspendStep("suspend", false), NOTE_STEP] },
    );

    expect(turnedOff.isError).toBe(true);
    expect(writesTo("SecurityPlaybook")).toHaveLength(1);
  });

  it("a playbook that contains on its own, turned on or given a new trigger, is refused", async () => {
    api.holds(apiPathOf("SecurityPlaybook"), PLAYBOOK_ID, {
      steps: [suspendStep("suspend", false)],
    });

    for (const args of [
      { isEnabled: true },
      { trigger: "Case Opened" },
      { detectionRuleIds: [ISSUE_ID] },
    ] as Array<JSONObject>) {
      api.sent = [];
      await connected.close();
      const answer: ToolAnswer = await call(
        toolOf("SecurityPlaybook", OneUptimeOperation.Update),
        { id: PLAYBOOK_ID, ...args },
      );

      expect({ args, refused: answer.isError === true }).toEqual({
        args,
        refused: true,
      });
      expect(writesTo("SecurityPlaybook")).toEqual([]);
    }
  });
});

describe("the person's own edits of the same records go on as they did", () => {
  for (const ordinary of ORDINARY_WRITES) {
    it(`${ordinary.label} reaches the API`, async () => {
      const theApi: FakeOneUptimeApi = getApi();

      ordinary.prepare?.(theApi, apiPathOf);

      const operation: OneUptimeOperation =
        ordinary.operation === "create"
          ? OneUptimeOperation.Create
          : ordinary.operation === "update"
            ? OneUptimeOperation.Update
            : OneUptimeOperation.Delete;
      const answer: ToolAnswer = await call(
        toolOf(ordinary.tableName, operation),
        ordinary.args,
      );

      expect({
        label: ordinary.label,
        refused: answer.isError === true,
      }).toEqual({ label: ordinary.label, refused: false });
      expect(writesTo(ordinary.tableName)).toHaveLength(1);
    });
  }

  it("a record no change is about is written as it always was, with nothing read", async () => {
    const answer: ToolAnswer = await call(
      toolOf("Incident", OneUptimeOperation.Update),
      { id: ISSUE_ID, title: "Checkout is down" },
    );

    expect(answer.isError).toBeFalsy();
    expect(writesTo("Incident")).toHaveLength(1);
    expect(api.readsSent()).toEqual([]);
  });

  it("every record whose writes are held has an ordinary edit that is not", () => {
    const held: Set<string> = new Set();

    for (const change of ALWAYS_ASK_CHANGES) {
      for (const record of change.records) {
        if (
          tools.some((tool: McpToolInfo): boolean => {
            return tool.tableName === record.tableName;
          }) &&
          record.columns
        ) {
          held.add(record.tableName);
        }
      }
    }

    for (const tableName of held) {
      expect({
        tableName,
        hasAnOrdinaryEdit: ORDINARY_WRITES.some(
          (ordinary: OrdinaryWrite): boolean => {
            return ordinary.tableName === tableName;
          },
        ),
      }).toEqual({ tableName, hasAnOrdinaryEdit: true });
    }
  });
});

describe("a hand-written tool's request to a record's route is held as a generated one is", () => {
  const credential: McpCredential = signedInMember();

  async function send(data: {
    method: "POST" | "PUT" | "DELETE";
    path: string;
    body?: JSONObject;
  }): Promise<unknown> {
    return await OneUptimeApiService.makeAuthenticatedApiCall({
      ...data,
      credential,
      toolName: "a_hand_written_tool",
    }).catch((error: unknown) => {
      return error;
    });
  }

  it("PUT and POST update-item that accept a risk are refused, with nothing sent", async () => {
    for (const path of [
      `/api/data-security-issue/${ISSUE_ID}/`,
      `/api/data-security-issue/${ISSUE_ID}`,
    ]) {
      const refused: unknown = await send({
        method: "PUT",
        path,
        body: { data: { status: "Accepted" } },
      });

      expect(refused).toBeInstanceOf(AsksAPersonFirstError);
      expect((refused as Error).message).toContain(
        "so a_hand_written_tool is not run here",
      );
    }

    const updateItem: unknown = await send({
      method: "POST",
      path: `/api/data-security-issue/${ISSUE_ID}/update-item`,
      body: { data: { status: "Not an issue" } },
    });

    expect(updateItem).toBeInstanceOf(AsksAPersonFirstError);
    expect(api.writesSent()).toEqual([]);
  });

  it("a store's owner, which has no tool of its own here, is refused every write", async () => {
    for (const request of [
      {
        method: "POST" as const,
        path: "/api/data-store-owner-user",
        body: { data: { dataStoreId: STORE_ID, userId: ISSUE_ID } },
      },
      {
        method: "DELETE" as const,
        path: `/api/data-store-owner-team/${ISSUE_ID}`,
      },
      {
        method: "POST" as const,
        path: `/api/data-store-owner-user/${ISSUE_ID}/delete-item`,
      },
    ]) {
      expect(await send(request)).toBeInstanceOf(AsksAPersonFirstError);
    }

    expect(api.writesSent()).toEqual([]);
  });

  it("a list changed beside the data is held as a write of that list", async () => {
    const refused: unknown = await send({
      method: "POST",
      path: `/api/data-store-owner-rule/${RULE_ID}/update-item`,
      body: { addToList: { ownerUsers: [ISSUE_ID] } },
    });

    expect(refused).toBeInstanceOf(AsksAPersonFirstError);
    expect(api.writesSent()).toEqual([]);
  });

  it("reads, counts, moves in a list and the action routes go through untouched", async () => {
    for (const request of [
      {
        method: "POST" as const,
        path: "/api/data-security-issue/get-list",
        body: { query: { status: "Accepted" } },
      },
      {
        method: "POST" as const,
        path: "/api/data-security-issue/count",
        body: { query: {} },
      },
      {
        method: "POST" as const,
        path: `/api/data-security-issue/${ISSUE_ID}/get-item`,
        body: { select: { status: true } },
      },
      {
        method: "POST" as const,
        path: `/api/incident-severity/move-in-list/${ISSUE_ID}`,
        body: { placeOfId: RULE_ID },
      },
      {
        method: "POST" as const,
        path: "/api/data-security-actions/run",
        body: {
          action: "change_data_security_issue",
          arguments: { change: "accept-risk" },
        },
      },
      {
        method: "POST" as const,
        path: "/api/setup-actions/run",
        body: { action: "set_up_paging", arguments: {} },
      },
    ]) {
      expect(await send(request)).not.toBeInstanceOf(AsksAPersonFirstError);
    }

    expect(api.sent).toHaveLength(6);
  });

  it("an ordinary write through a hand-written tool is sent", async () => {
    expect(
      await send({
        method: "POST",
        path: "/api/incident-internal-note",
        body: { data: { note: "Looking.", incidentId: ISSUE_ID } },
      }),
    ).not.toBeInstanceOf(AsksAPersonFirstError);
    expect(api.writesSent()).toHaveLength(1);
  });
});

describe("which request writes which record", () => {
  function read(
    method: "POST" | "PUT" | "DELETE",
    path: string,
    body?: JSONObject,
  ): RecordWrite | null {
    return readRecordWriteOfRequest({ method, path, body });
  }

  it("reads BaseAPI's routes: create, update and delete, by PUT, DELETE or their POST forms", () => {
    expect(read("POST", "/api/data-store", { data: { name: "x" } })).toEqual({
      tableName: "DataStore",
      write: AlwaysAskWrite.Create,
      data: { name: "x" },
    });
    expect(
      read("PUT", `/api/data-store/${STORE_ID}/`, { data: { name: "x" } }),
    ).toEqual({
      tableName: "DataStore",
      write: AlwaysAskWrite.Update,
      id: STORE_ID,
      data: { name: "x" },
    });
    expect(read("POST", `/api/data-store/${STORE_ID}/update-item`)?.write).toBe(
      AlwaysAskWrite.Update,
    );
    expect(read("DELETE", `/api/data-store/${STORE_ID}`)?.write).toBe(
      AlwaysAskWrite.Delete,
    );
    expect(read("POST", `/api/data-store/${STORE_ID}/delete-item`)?.write).toBe(
      AlwaysAskWrite.Delete,
    );
  });

  it("tells a record's route from a longer one that starts the same", () => {
    expect(
      read("PUT", `/api/data-store-finding/${FINDING_ID}`)?.tableName,
    ).toBe("DataStoreFinding");
    expect(read("POST", "/api/data-store-owner-user")?.tableName).toBe(
      "DataStoreOwnerUser",
    );
    expect(read("PUT", `/api/data-store/${STORE_ID}`)?.tableName).toBe(
      "DataStore",
    );
  });

  it("is no write for a read, a count, a move, another route, or an id that is not one", () => {
    expect(read("POST", "/api/data-store/get-list")).toBeNull();
    expect(read("POST", "/api/data-store/count")).toBeNull();
    expect(read("POST", `/api/data-store/${STORE_ID}/get-item`)).toBeNull();
    expect(
      read("POST", `/api/incident-severity/move-in-list/${STORE_ID}`),
    ).toBeNull();
    expect(read("POST", "/api/data-security-actions/run")).toBeNull();
    expect(read("PUT", "/api/data-store/not-an-id")).toBeNull();
    expect(read("PUT", "/api/data-store")).toBeNull();
    expect(read("DELETE", "/api/data-store")).toBeNull();
    expect(read("POST", `/api/data-store/${STORE_ID}`)).toBeNull();
    expect(read("POST", "/api/no-such-record")).toBeNull();
  });

  it("reads the path without its query, its trailing slash or the API's prefix", () => {
    expect(
      read("PUT", `/api/data-security-issue/${ISSUE_ID}/?dryRun=true`)?.id,
    ).toBe(ISSUE_ID);
    expect(read("POST", "/data-store/")?.write).toBe(AlwaysAskWrite.Create);
  });

  it("takes a request's data, and the lists it changes beside it", () => {
    expect(
      read("POST", `/api/data-store-owner-rule/${RULE_ID}/update-item`, {
        data: { name: "x" },
        addToList: { ownerUsers: [ISSUE_ID] },
        removeFromList: { ownerTeams: [RULE_ID] },
      })?.data,
    ).toEqual({ name: "x", ownerUsers: [ISSUE_ID], ownerTeams: [RULE_ID] });
    expect(
      read("PUT", `/api/data-store/${STORE_ID}`, {})?.data,
    ).toBeUndefined();
  });

  it("reads an id the API answers with, however it comes", () => {
    expect(readId(STORE_ID)).toBe(STORE_ID);
    expect(readId(new ObjectID(STORE_ID))).toBe(STORE_ID);
    expect(readId({ _type: "ObjectID", value: STORE_ID })).toBe(STORE_ID);
    expect(readId("not-an-id")).toBeNull();
    expect(readId(undefined)).toBeNull();
  });
});

describe("what keeps working", () => {
  it("MCP_READ_ONLY still takes every write tool away, so a held write is an unknown tool", () => {
    const readOnly: Array<McpToolInfo> = applyWritePolicy(tools, {
      readOnly: true,
      allowDestructive: true,
    });

    expect(
      readOnly.some((tool: McpToolInfo): boolean => {
        return tool.name === UPDATE_ISSUE.name;
      }),
    ).toBe(false);
  });

  it("MCP_ALLOW_DESTRUCTIVE=false still takes the delete tools away, and keeps the updates that are held", () => {
    const noDeletes: Array<McpToolInfo> = applyWritePolicy(tools, {
      readOnly: false,
      allowDestructive: false,
    });

    expect(
      noDeletes.some((tool: McpToolInfo): boolean => {
        return tool.operation === OneUptimeOperation.Delete;
      }),
    ).toBe(false);
    expect(
      noDeletes.some((tool: McpToolInfo): boolean => {
        return tool.name === UPDATE_ISSUE.name;
      }),
    ).toBe(true);
  });

  it("a read-only sign-in is refused a write as it was, before anything is judged", async () => {
    const answer: ToolAnswer = await call(
      UPDATE_ISSUE,
      { id: ISSUE_ID, status: "Accepted" },
      signedInMember([]),
    );

    expect(readFailure(answer).error).toContain("authorized as read-only");
    expect(api.sent).toEqual([]);
  });

  it("a project API key is still refused the Data Security actions, before anything is sent", async () => {
    const answer: ToolAnswer = await call(
      "change_data_security_issue",
      { dataSecurityIssueId: ISSUE_ID, change: "accept-risk", reason: "x" },
      projectApiKey(),
    );

    expect(readFailure(answer).error).toBe(
      getDataSecurityActionApiKeyRefusal("change_data_security_issue"),
    );
    expect(api.sent).toEqual([]);
  });

  it("the write policy the server runs with is the one it always was", () => {
    expect(ToolGenerator.getWritePolicy({})).toEqual({
      readOnly: false,
      allowDestructive: true,
    });
  });
});

describe("the agent is told not to retry, nor to make the change another way", () => {
  it("after a record tool's refusal", async () => {
    const answer: ToolAnswer = await call(UPDATE_ISSUE, {
      id: ISSUE_ID,
      status: "Accepted",
    });

    expect(readFailure(answer).suggestion).toBe(ASKS_IN_EVERY_MODE_SUGGESTION);
  });

  it("after the API's refusal of a Data Security action, as it reaches this server over HTTP", async () => {
    const refusal: string = getAsksInEveryModeRefusal({
      action: "respond_on_data_store",
      reason: AI_DATA_SECURITY_ACTION_ASKS_BECAUSE.respond,
      pageUrl: `http://localhost${DASHBOARD}/${PROJECT_ID}/data-security/stores/${STORE_ID}`,
    });

    api.answerOther = (): HTTPErrorResponse => {
      return new HTTPErrorResponse(403, { message: refusal }, {});
    };

    const answer: ToolAnswer = await call("respond_on_data_store", {
      dataStoreId: STORE_ID,
      action: "Block public access",
    });
    const failure: { error: string; suggestion: string } = readFailure(answer);

    // The API's words arrive wrapped: the suggestion is read through them.
    expect(failure.error).toBe(`API request failed: 403 - ${refusal}`);
    expect(failure.suggestion).toBe(ASKS_IN_EVERY_MODE_SUGGESTION);
  });

  it("reads the refusal at the start of the message or after the API's wrapper, and nowhere else", () => {
    const refusal: string = `${ASKS_IN_EVERY_MODE_REFUSAL_PREFIX} An MCP client shows no card.`;

    expect(getAsksAPersonSuggestion(new Error(refusal))).toBe(
      ASKS_IN_EVERY_MODE_SUGGESTION,
    );
    expect(
      getAsksAPersonSuggestion(
        new OneUptimeApiError(`API request failed: 403 - ${refusal}`, 403),
      ),
    ).toBe(ASKS_IN_EVERY_MODE_SUGGESTION);
    expect(
      getAsksAPersonSuggestion(
        new OneUptimeApiError(
          "API request failed: 403 - You do not have permission to update this.",
          403,
        ),
      ),
    ).toBeUndefined();
    expect(
      getAsksAPersonSuggestion(new Error(`Something else first. ${refusal}`)),
    ).toBeUndefined();
    expect(getAsksAPersonSuggestion("not an error")).toBeUndefined();
  });
});

describe("oneuptime_describe_resource says what a resource's tools refuse", () => {
  function usageOf(name: string, singularName: string): JSONObject {
    return (
      JSON.parse(
        describeResource({
          name,
          singularName,
          modelType: ModelType.Database,
          tools: {},
        }),
      ) as JSONObject
    )["usage"] as JSONObject;
  }

  it("an issue's: Accept Risk and Not an Issue, by the status each writes", () => {
    const asks: string = String(
      usageOf("DataSecurityIssue", "Data Security Issue")["asksAPerson"],
    );

    expect(asks).toContain(
      'Accept Risk: an update that sets status to "Accepted"',
    );
    expect(asks).toContain(
      'Not an Issue: an update that sets status to "Not an issue"',
    );
    expect(asks).toContain("do not retry one or make it another way");
  });

  it("a playbook's, a store's and a setting's", () => {
    expect(
      String(usageOf("SecurityPlaybook", "Security Playbook")["asksAPerson"]),
    ).toContain("without requiresApproval");
    expect(String(usageOf("DataStore", "Data Store")["asksAPerson"])).toContain(
      "scanExclusions",
    );
    expect(
      String(
        usageOf("DataSecuritySetting", "Data Security Setting")["asksAPerson"],
      ),
    ).toContain("disabledDataTypeIds");
  });

  it("says nothing for a resource none of whose writes ask", () => {
    expect(usageOf("Incident", "Incident")["asksAPerson"]).toBeUndefined();
    expect(describeWritesThatAskAPerson("Monitor")).toBeNull();
  });
});
