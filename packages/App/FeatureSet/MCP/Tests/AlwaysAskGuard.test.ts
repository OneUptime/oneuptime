/**
 * NO TOOL OF THIS SERVER MAKES A CHANGE ONEUPTIME ASKS A PERSON BEFORE
 * (#11177).
 *
 * Every list in OneUptime that says a change asks a person in every mode
 * is read here: Ask AI's actions, its setup actions and its calls to a
 * project's external MCP servers; what OneUptime AI asks before whatever
 * its rules say in Security Events, Data Security and cloud savings; the
 * commands a remediation policy keeps for a human; a playbook's
 * containment, and a public note's approval. Each entry is one of three:
 *
 *   - held: one of Common's always-ask changes (Types/AI/AIAlwaysAskChanges),
 *     whose every record write a generated tool could send is sent through
 *     that tool here, as a signed-in member and as an API key, and must be
 *     refused with nothing reaching the API;
 *   - no tool here: what makes it - its record, its route - is no tool's on
 *     this server, which is asserted, so the day one gets a tool this fails;
 *   - run here by a decision, named with its reason and held to it.
 *
 * An entry added to any of those lists, an action that starts to ask, a
 * change whose record gains a tool, a way to the API besides
 * OneUptimeApiService: each fails here until it is one of the three. The
 * negative controls at the end show the guard failing on each.
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

import * as fs from "fs";
import * as path from "path";
import {
  ConnectedClient,
  FakeOneUptimeApi,
  ToolAnswer,
  projectApiKey,
  readFailure,
  signedInMember,
} from "./AlwaysAskHarness";
import {
  AlwaysAskFixture,
  MAKES_THE_CHANGE,
  fixtureKey,
} from "./AlwaysAskFixtures";
import OneUptimeApiService from "../Services/OneUptimeApiService";
import * as AlwaysAskWritesModule from "../Tools/AlwaysAskWrites";
import { RecordWrite } from "../Tools/AlwaysAskWrites";
import {
  SETUP_TOOL_DEFINITIONS,
  SetupToolDefinition,
} from "../Tools/SetupTools";
import { generateAllTools } from "../Tools/ToolGenerator";
import { McpCredential } from "../Types/McpCredential";
import { McpToolInfo } from "../Types/McpTypes";
import ModelType from "../Types/ModelType";
import OneUptimeOperation from "../Types/OneUptimeOperation";
import DatabaseModels from "Common/Models/DatabaseModels/Index";
import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AIToolbox from "Common/Server/Utils/AI/Toolbox/Index";
import { ObservabilityTool } from "Common/Server/Utils/AI/Toolbox/ToolTypes";
import {
  ALWAYS_ASK_ACTIONS,
  ALWAYS_ASK_CHANGES,
  AlwaysAskChange,
  AlwaysAskRecordWrite,
  AlwaysAskWrite,
  isStepGuardedByApproval,
} from "Common/Types/AI/AIAlwaysAskChanges";
import {
  ASKS_IN_EVERY_MODE_REFUSAL_PREFIX,
  FIX_DATA_SECURITY_ISSUE_WITH_AI_TOOL_NAME,
} from "Common/Types/AI/AIDataSecurityActions";
import {
  CALL_MCP_TOOL_TOOL_NAME,
  CALL_MCP_TOOL_WITH_APPROVAL_TOOL_NAME,
  LIST_MCP_TOOLS_TOOL_NAME,
} from "Common/Types/AI/ExternalMcpServer/ExternalMcpToolNames";
import { AI_SETUP_ACTION_TOOL_NAMES } from "Common/Types/AI/AISetupActions";
import {
  KUBECTL_ALWAYS_ASKS_SUMMARY,
  RESOURCE_ALWAYS_ASKS_SUMMARY,
} from "Common/Types/AutoRemediation/AiRemediationCommandPlan";
import { CloudSavingsAiReason } from "Common/Types/Cloud/CloudSavingsAi";
import {
  DATA_SECURITY_AI_ALWAYS_ASKS,
  DATA_SECURITY_AI_PROPOSAL_KINDS,
  DataSecurityAiChangeSafety,
  DataSecurityAiProposalKind,
  DataSecurityAiProposalKindDefinition,
} from "Common/Types/DataSecurity/DataSecurityAi";
import {
  SECURITY_CASE_AI_ALWAYS_ASKS,
  SecurityCaseAiActionKind,
} from "Common/Types/SecurityCase/SecurityCaseAi";
import {
  SECURITY_PLAYBOOK_ACTIONS,
  SecurityPlaybookActionDefinition,
} from "Common/Types/SecurityPlaybook/SecurityPlaybookAction";

const tools: Array<McpToolInfo> = generateAllTools();

const OPERATION_OF_WRITE: Record<AlwaysAskWrite, OneUptimeOperation> = {
  [AlwaysAskWrite.Create]: OneUptimeOperation.Create,
  [AlwaysAskWrite.Update]: OneUptimeOperation.Update,
  [AlwaysAskWrite.Delete]: OneUptimeOperation.Delete,
};

// The generated tool that sends this write of this record, if this server has one.
function generatedToolOf(
  tableName: string,
  write: AlwaysAskWrite,
): McpToolInfo | undefined {
  return tools.find((tool: McpToolInfo): boolean => {
    return (
      tool.modelType === ModelType.Database &&
      tool.tableName === tableName &&
      tool.operation === OPERATION_OF_WRITE[write]
    );
  });
}

function hasToolsHere(tableName: string): boolean {
  return tools.some((tool: McpToolInfo): boolean => {
    return tool.tableName === tableName;
  });
}

function apiPathOf(tableName: string): string {
  return (
    tools.find((tool: McpToolInfo): boolean => {
      return tool.tableName === tableName;
    })?.apiPath || ""
  );
}

const MODEL_TABLES: Set<string> = new Set(
  DatabaseModels.map((ModelClass: { new (): DatabaseBaseModel }): string => {
    return new ModelClass().tableName || ModelClass.name;
  }),
);

// A record that makes a change and has no tool here: asserted, so a tool added to it fails.
function expectNoToolHere(tableNames: ReadonlyArray<string>): void {
  for (const tableName of tableNames) {
    expect({ tableName, isATable: MODEL_TABLES.has(tableName) }).toEqual({
      tableName,
      isATable: true,
    });
    expect({ tableName, hasTools: hasToolsHere(tableName) }).toEqual({
      tableName,
      hasTools: false,
    });
  }
}

// Every change's every record write a generated tool could send.
interface ToolPath {
  change: AlwaysAskChange;
  record: AlwaysAskRecordWrite;
  write: AlwaysAskWrite;
  tool: McpToolInfo;
  key: string;
}

function getToolPaths(
  changes: ReadonlyArray<AlwaysAskChange>,
): Array<ToolPath> {
  const paths: Array<ToolPath> = [];

  for (const change of changes) {
    for (const record of change.records) {
      for (const write of record.writes) {
        const tool: McpToolInfo | undefined = generatedToolOf(
          record.tableName,
          write,
        );

        if (tool) {
          paths.push({
            change,
            record,
            write,
            tool,
            key: fixtureKey({
              change: change.name,
              tableName: record.tableName,
              write,
            }),
          });
        }
      }
    }
  }

  return paths;
}

// Paths whose fixture is missing: a change no tool is tested through.
function getPathsWithoutAFixture(
  paths: ReadonlyArray<ToolPath>,
  fixtures: Record<string, AlwaysAskFixture>,
): Array<string> {
  return paths
    .filter((each: ToolPath): boolean => {
      return !fixtures[each.key];
    })
    .map((each: ToolPath): string => {
      return `${each.key} (${each.tool.name})`;
    });
}

let api: FakeOneUptimeApi;

/*
 * Calls each path's tool with the arguments that make its change, as this
 * credential, and names every one that was not refused, or whose write
 * reached the API anyway. Empty when every path is held.
 */
async function getPathsNotRefused(
  paths: ReadonlyArray<ToolPath>,
  credential: McpCredential,
  fixtures: Record<string, AlwaysAskFixture> = MAKES_THE_CHANGE,
): Promise<Array<string>> {
  const notRefused: Array<string> = [];

  for (const each of paths) {
    const fixture: AlwaysAskFixture | undefined = fixtures[each.key];

    if (!fixture) {
      notRefused.push(`${each.key}: no fixture`);
      continue;
    }

    api.reset();
    fixture.prepare?.(api, apiPathOf);

    const connected: ConnectedClient = new ConnectedClient();

    await connected.connect(tools, credential);

    const answer: ToolAnswer = await connected.call(
      each.tool.name,
      fixture.args,
    );

    await connected.close();

    const wrote: boolean = api
      .writesSent()
      .some((write: RecordWrite): boolean => {
        return write.tableName === each.record.tableName;
      });

    if (
      answer.isError !== true ||
      !readFailure(answer).error.startsWith(
        ASKS_IN_EVERY_MODE_REFUSAL_PREFIX,
      ) ||
      wrote
    ) {
      notRefused.push(`${each.key} (${each.tool.name})`);
    }
  }

  return notRefused;
}

// What makes a value of an always-ask list here: held by the list, no tool here, or run here by decision.
type Classification =
  | { held: ReadonlyArray<string> }
  | { noToolHere: ReadonlyArray<string>; why: string }
  | { runHereByDecision: string };

function unclassified<T extends string>(
  values: ReadonlyArray<T>,
  classification: Partial<Record<T, unknown>>,
): Array<T> {
  return values.filter((value: T): boolean => {
    return !classification[value];
  });
}

function heldChangesExist(names: ReadonlyArray<string>): void {
  for (const name of names) {
    expect({
      name,
      listed: ALWAYS_ASK_CHANGES.some((change: AlwaysAskChange): boolean => {
        return change.name === name;
      }),
    }).toEqual({ name, listed: true });
  }
}

function holdClassification(
  classification: Partial<Record<string, Classification>>,
): void {
  for (const each of Object.values(classification)) {
    if (!each) {
      continue;
    }

    if ("held" in each) {
      heldChangesExist(each.held);
    } else if ("noToolHere" in each) {
      expect(each.why.length).toBeGreaterThan(0);
      expectNoToolHere(each.noToolHere);
    } else {
      expect(each.runHereByDecision.length).toBeGreaterThan(0);
    }
  }
}

/*
 * ASK AI'S ACTIONS THAT ASK IN EVERY MODE (Server/Utils/AI/Toolbox):
 * each is in Common's list, or a setup action - run as a tool of its own
 * here by decision - or Fix with AI, which asks only when its card could
 * not be prepared: nothing it makes asks.
 */
export function getUnclassifiedAskAiActions(
  toolbox: ReadonlyArray<ObservabilityTool>,
): Array<string> {
  return toolbox
    .filter((tool: ObservabilityTool): boolean => {
      return Boolean(
        tool.isMutation && (tool.setupAction || tool.asksInEveryMode),
      );
    })
    .map((tool: ObservabilityTool): string => {
      return tool.name;
    })
    .filter((name: string): boolean => {
      return (
        !ALWAYS_ASK_ACTIONS.includes(name) &&
        !AI_SETUP_ACTION_TOOL_NAMES.includes(name) &&
        name !== FIX_DATA_SECURITY_ISSUE_WITH_AI_TOOL_NAME
      );
    });
}

// OneUptime AI in Security Events: what it asks before whatever its setting says.
const SECURITY_CASE_AI: Partial<
  Record<SecurityCaseAiActionKind, Classification>
> = {
  [SecurityCaseAiActionKind.DeclareIncident]: {
    /*
     * An incident opened is what create_incident makes - here, and in Ask
     * AI, whose create_incident follows the conversation's mode. The
     * Security Case AI asks because it declares one on its own, from what
     * an attacker's events say; an agent declaring one acts for the
     * person who connected it, as Ask AI does (held below: Ask AI's
     * create_incident does not ask in every mode).
     */
    runHereByDecision:
      "An incident opened is create_incident's, here as in Ask AI, which follows the mode for it; the Security Case AI asks because it declares one on its own.",
  },
  [SecurityCaseAiActionKind.OfferRuleException]: {
    noToolHere: ["DetectionRuleException", "DetectionRule"],
    why: "A rule's exception is made only by approving OneUptime AI's offer (SecurityCaseResponseDecisions), and no record of it has a tool here.",
  },
};

// OneUptime AI in Data Security: what never runs without asking (DATA_SECURITY_AI_ALWAYS_ASKS).
const DATA_SECURITY_AI_SAFETIES: Partial<
  Record<DataSecurityAiChangeSafety, Classification>
> = {
  [DataSecurityAiChangeSafety.ChangesWhoIsTold]: {
    held: ["A store's owners", "A rule saved"],
  },
  [DataSecurityAiChangeSafety.ChangesCloudSettings]: {
    held: [
      "A response on a store",
      "A playbook's containment or store response run with nobody's approval",
    ],
  },
  [DataSecurityAiChangeSafety.ChangesWhatScansLookFor]: {
    held: ["A data type turned off", "A place left out of a store's scans"],
  },
  [DataSecurityAiChangeSafety.Deletes]: {
    noToolHere: ["DataSecurityAiProposal"],
    why: "No proposal kind deletes anything (asserted below), and a proposal has no tool here.",
  },
  [DataSecurityAiChangeSafety.Pages]: {
    noToolHere: ["DataSecurityAiProposal"],
    why: "No proposal kind pages anyone (asserted below), and a proposal has no tool here.",
  },
};

// Each proposal kind that never runs without asking: the change its approval makes.
const DATA_SECURITY_AI_KINDS: Partial<
  Record<DataSecurityAiProposalKind, Classification>
> = {
  [DataSecurityAiProposalKind.SetStoreOwners]: { held: ["A store's owners"] },
  [DataSecurityAiProposalKind.CreateOwnerRule]: { held: ["A rule saved"] },
  [DataSecurityAiProposalKind.TurnOffDataType]: {
    held: ["A data type turned off"],
  },
  [DataSecurityAiProposalKind.AddScanExclusion]: {
    held: ["A place left out of a store's scans"],
  },
  [DataSecurityAiProposalKind.FixIssueGroupInCloud]: {
    held: [
      "A response on a store",
      "A playbook's containment or store response run with nobody's approval",
    ],
  },
};

// Cloud savings: which of OneUptime AI's reasons is a person always approving.
const CLOUD_SAVINGS_REASONS: Record<CloudSavingsAiReason, "asks" | "rule"> = {
  [CloudSavingsAiReason.Defaults]: "rule",
  [CloudSavingsAiReason.NoMatchingRule]: "rule",
  [CloudSavingsAiReason.RuleSaysOff]: "rule",
  [CloudSavingsAiReason.RuleSaysSuggest]: "rule",
  [CloudSavingsAiReason.Production]: "asks",
  [CloudSavingsAiReason.EnvironmentNotKnown]: "asks",
  [CloudSavingsAiReason.CannotBeUndone]: "asks",
  [CloudSavingsAiReason.OverLimit]: "rule",
  [CloudSavingsAiReason.CircuitBreaker]: "rule",
  [CloudSavingsAiReason.RuleAllows]: "rule",
};

beforeAll(() => {
  OneUptimeApiService.initialize({ url: "https://oneuptime.example.com" });
});

beforeEach(() => {
  api = new FakeOneUptimeApi();
  api.install();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("every generated tool that could make an always-ask change refuses it", () => {
  const paths: Array<ToolPath> = getToolPaths(ALWAYS_ASK_CHANGES);

  it("finds the paths the issue named and more: an issue, a finding, a rule, a setting, a store, a playbook", () => {
    expect(
      Array.from(
        new Set(
          paths.map((each: ToolPath): string => {
            return each.tool.name;
          }),
        ),
      ).sort(),
    ).toEqual(
      expect.arrayContaining([
        "update_data_security_issue",
        "update_data_store_finding",
      ]),
    );
    expect(
      new Set(
        paths.map((each: ToolPath): string => {
          return each.record.tableName;
        }),
      ),
    ).toEqual(
      new Set([
        "DataSecurityIssue",
        "DataStoreFinding",
        "DataSecurityResidencyRule",
        "DataSecuritySetting",
        "DataStore",
        "SecurityPlaybook",
      ]),
    );
  });

  it("each has the arguments that make its change, and no fixture names a path there is not", () => {
    expect(getPathsWithoutAFixture(paths, MAKES_THE_CHANGE)).toEqual([]);

    const keys: Set<string> = new Set(
      paths.map((each: ToolPath): string => {
        return each.key;
      }),
    );

    expect(
      Object.keys(MAKES_THE_CHANGE).filter((key: string): boolean => {
        return !keys.has(key);
      }),
    ).toEqual([]);
  });

  it("refuses each, with nothing sent, for a member signed in with OAuth", async () => {
    expect(await getPathsNotRefused(paths, signedInMember())).toEqual([]);
  });

  it("refuses each, with nothing sent, for a project API key", async () => {
    expect(await getPathsNotRefused(paths, projectApiKey())).toEqual([]);
  });

  it("a record write no generated tool can send has no tool here at all", () => {
    for (const change of ALWAYS_ASK_CHANGES) {
      for (const record of change.records) {
        for (const write of record.writes) {
          if (!generatedToolOf(record.tableName, write)) {
            /*
             * The record has no tool of this kind: either none at all, or
             * this kind is not generated for it (a finding is never
             * created by a person, an issue never deleted through here).
             */
            const hasThisKind: boolean = tools.some(
              (tool: McpToolInfo): boolean => {
                return (
                  tool.tableName === record.tableName &&
                  tool.operation === OPERATION_OF_WRITE[write]
                );
              },
            );

            expect({ table: record.tableName, write, hasThisKind }).toEqual({
              table: record.tableName,
              write,
              hasThisKind: false,
            });
          }
        }
      }
    }
  });

  it("the records Ask AI's always-ask actions write that have no tool here are named, so one gaining a tool is held already", () => {
    expectNoToolHere([
      "DataStoreOwnerUser",
      "DataStoreOwnerTeam",
      "DataStoreOwnerRule",
      "DataStoreLabelRule",
      "DataSecurityAiProposal",
      "LogScrubRule",
      "TraceScrubRule",
    ]);
  });
});

describe("Ask AI's actions that ask in every mode", () => {
  const toolbox: Array<ObservabilityTool> = AIToolbox.getTools();

  it("are each held, a setup action, or Fix with AI", () => {
    expect(getUnclassifiedAskAiActions(toolbox)).toEqual([]);
  });

  it("the setup actions are run here as tools of their own, by decision (#7241, #10041), and say what they make", () => {
    /*
     * Ask AI asks before a setup action in every mode because its card is
     * how the chat shows what it makes. This server offers each as a tool
     * of its own, which an MCP client confirms before it runs (it is not
     * read-only), and each says what it makes: a monitor, who is paged, a
     * status page, an invitation. What they make adds to what watches the
     * project; none of it is a change OneUptime refuses here.
     */
    const setupTools: Array<string> = SETUP_TOOL_DEFINITIONS.map(
      (definition: SetupToolDefinition): string => {
        return definition.name;
      },
    );

    for (const name of AI_SETUP_ACTION_TOOL_NAMES) {
      expect({ name, offeredHere: setupTools.includes(name) }).toEqual({
        name,
        offeredHere: true,
      });

      const definition: SetupToolDefinition | undefined =
        SETUP_TOOL_DEFINITIONS.find(
          (candidate: SetupToolDefinition): boolean => {
            return candidate.name === name;
          },
        );

      expect({ name, readOnly: definition?.readOnly }).toEqual({
        name,
        readOnly: false,
      });
    }
  });

  it("Ask AI's own incident and alert follow the mode, as an incident declared here does", () => {
    for (const name of ["create_incident", "create_alert"]) {
      const tool: ObservabilityTool | undefined = AIToolbox.getToolByName(name);

      expect({ name, isMutation: tool?.isMutation }).toEqual({
        name,
        isMutation: true,
      });
      expect({
        name,
        asks: Boolean(tool?.asksInEveryMode || tool?.setupAction),
      }).toEqual({
        name,
        asks: false,
      });
    }
  });

  it("a call to a project's external MCP servers, which always asks in Ask AI, has no tool here", () => {
    const names: Array<string> = tools.map((tool: McpToolInfo): string => {
      return tool.name;
    });

    for (const name of [
      CALL_MCP_TOOL_WITH_APPROVAL_TOOL_NAME,
      CALL_MCP_TOOL_TOOL_NAME,
      LIST_MCP_TOOLS_TOOL_NAME,
    ]) {
      expect(names).not.toContain(name);
    }

    expectNoToolHere(["ExternalMcpServer"]);
  });
});

describe("what OneUptime AI asks before whatever its rules say", () => {
  it("in Security Events: every kind that always asks is classified", () => {
    expect(
      unclassified(SECURITY_CASE_AI_ALWAYS_ASKS, SECURITY_CASE_AI),
    ).toEqual([]);
    holdClassification(SECURITY_CASE_AI);
    // What stands for the Security Case AI's waiting actions has no tool here either.
    expectNoToolHere(["SecurityCaseAiAction", "SecurityPlaybookRun"]);
  });

  it("in Data Security: every safety that never runs without asking is classified", () => {
    expect(
      unclassified(DATA_SECURITY_AI_ALWAYS_ASKS, DATA_SECURITY_AI_SAFETIES),
    ).toEqual([]);
    holdClassification(DATA_SECURITY_AI_SAFETIES);
  });

  it("in Data Security: no proposal kind deletes or pages, and every kind that asks is classified", () => {
    const kinds: Array<DataSecurityAiProposalKindDefinition> = Object.values(
      DATA_SECURITY_AI_PROPOSAL_KINDS,
    );

    expect(
      kinds.filter((kind: DataSecurityAiProposalKindDefinition): boolean => {
        return (
          kind.safety === DataSecurityAiChangeSafety.Deletes ||
          kind.safety === DataSecurityAiChangeSafety.Pages
        );
      }),
    ).toEqual([]);

    const asking: Array<DataSecurityAiProposalKind> = kinds
      .filter((kind: DataSecurityAiProposalKindDefinition): boolean => {
        return DATA_SECURITY_AI_ALWAYS_ASKS.includes(kind.safety);
      })
      .map((kind: DataSecurityAiProposalKindDefinition) => {
        return kind.kind;
      });

    expect(unclassified(asking, DATA_SECURITY_AI_KINDS)).toEqual([]);
    holdClassification(DATA_SECURITY_AI_KINDS);
  });

  it("in cloud savings: every reason is classified, and a change a person approves has no tool here", () => {
    expect(
      unclassified(Object.values(CloudSavingsAiReason), CLOUD_SAVINGS_REASONS),
    ).toEqual([]);
    // The reasons a person always approves are the three the savings engine asks for.
    expect(
      Object.values(CloudSavingsAiReason).filter(
        (reason: CloudSavingsAiReason): boolean => {
          return CLOUD_SAVINGS_REASONS[reason] === "asks";
        },
      ),
    ).toEqual([
      CloudSavingsAiReason.Production,
      CloudSavingsAiReason.EnvironmentNotKnown,
      CloudSavingsAiReason.CannotBeUndone,
    ]);

    // Every saving is made through its action's row and the cloud's API: neither is a tool's here.
    expectNoToolHere(["CloudSavingsAction"]);
    expect(
      tools.filter((tool: McpToolInfo): boolean => {
        return (tool.apiPath || "").startsWith("/cloud-savings");
      }),
    ).toEqual([]);
  });

  it("in remediation: the commands a policy keeps for a human have no tool here", () => {
    expect(KUBECTL_ALWAYS_ASKS_SUMMARY.length).toBeGreaterThan(0);
    expect(RESOURCE_ALWAYS_ASKS_SUMMARY.length).toBeGreaterThan(0);

    // A command is proposed in a suggestion, run through an AI run: neither is a tool's here.
    expectNoToolHere([
      "AutoRemediationSuggestion",
      "AutoRemediationRule",
      "AIRun",
    ]);
    expect(
      tools.filter((tool: McpToolInfo): boolean => {
        return (tool.apiPath || "").startsWith("/auto-remediation");
      }),
    ).toEqual([]);
  });

  it("in a playbook: every containment step waits for approval, and saving one that does not is held", () => {
    for (const action of SECURITY_PLAYBOOK_ACTIONS.filter(
      (each: SecurityPlaybookActionDefinition): boolean => {
        return each.isDisruptive;
      },
    )) {
      expect({
        action: action.type,
        guarded: isStepGuardedByApproval({ action: action.type }),
      }).toEqual({ action: action.type, guarded: true });
    }

    heldChangesExist([
      "A playbook's containment or store response run with nobody's approval",
    ]);
    expect(hasToolsHere("SecurityPlaybook")).toBe(true);
  });

  it("a public note waits for its approver: no write of one publishes it", () => {
    for (const ModelClass of DatabaseModels) {
      const model: DatabaseBaseModel = new ModelClass();

      if (
        !model.enableMCP ||
        !model.getTableColumnMetadata("isPublished") ||
        !(model.tableName || "").endsWith("PublicNote")
      ) {
        continue;
      }

      const access: { create?: Array<unknown>; update?: Array<unknown> } =
        (model.getColumnAccessControlFor("isPublished") || {}) as {
          create?: Array<unknown>;
          update?: Array<unknown>;
        };

      expect({
        table: model.tableName,
        create: access.create || [],
        update: access.update || [],
      }).toEqual({ table: model.tableName, create: [], update: [] });
    }
  });
});

describe("every way this server reaches the API is held", () => {
  const MCP_ROOT: string = path.resolve(__dirname, "..");

  function sourceFiles(directory: string): Array<string> {
    const files: Array<string> = [];

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (entry.name !== "Tests" && entry.name !== "node_modules") {
          files.push(...sourceFiles(full));
        }
      } else if (entry.name.endsWith(".ts")) {
        files.push(full);
      }
    }

    return files;
  }

  const files: Array<string> = sourceFiles(MCP_ROOT);

  function relative(file: string): string {
    return path.relative(MCP_ROOT, file).split(path.sep).join("/");
  }

  // What a file that sends requests imports or calls.
  const SENDS_REQUESTS: ReadonlyArray<RegExp> = [
    /from "Common\/Utils\/API"/,
    /\bfetch\(/,
    /from "(axios|node-fetch|undici|got)"/,
    /require\("(http|https)"\)|from "(http|https)"/,
  ];
  const SENDS_A_CREDENTIAL: RegExp = /McpCredential|getApiHeaders|APIKey/;
  const WRITES: RegExp = /API\.(put|delete)\(/;
  const API_ROUTE: RegExp = /`\/api\/[^`]*`/g;

  it("only OneUptimeApiService sends a request with the caller's credential", () => {
    const sendsRequests: Array<string> = files
      .filter((file: string): boolean => {
        const text: string = fs.readFileSync(file, "utf8");

        return SENDS_REQUESTS.some((pattern: RegExp): boolean => {
          return pattern.test(text);
        });
      })
      .map(relative)
      .sort();

    expect(sendsRequests).toEqual(
      [
        // The caller's requests: every write is held here (Tools/AlwaysAskWrites).
        "Services/OneUptimeApiService.ts",
        // A client's own metadata document, fetched before any sign-in.
        "OAuth/ClientIdMetadataDocument.ts",
        // A public status page, read with no credential.
        "Tools/PublicStatusPageTools.ts",
      ].sort(),
    );
  });

  it("the public status page tools and the client metadata send no credential, and only read", () => {
    for (const file of [
      "Tools/PublicStatusPageTools.ts",
      "OAuth/ClientIdMetadataDocument.ts",
    ]) {
      const text: string = fs.readFileSync(path.join(MCP_ROOT, file), "utf8");

      expect({
        file,
        credential: SENDS_A_CREDENTIAL.test(text),
      }).toEqual({
        file,
        credential: false,
      });
      expect({ file, writes: WRITES.test(text) }).toEqual({
        file,
        writes: false,
      });
    }

    const publicTools: string = fs.readFileSync(
      path.join(MCP_ROOT, "Tools/PublicStatusPageTools.ts"),
      "utf8",
    );
    const routes: Array<string> = publicTools.match(API_ROUTE) || [];

    expect(routes.length).toBeGreaterThan(0);

    for (const route of routes) {
      expect(route.startsWith("`/api/status-page/")).toBe(true);
    }
  });

  it("both of OneUptimeApiService's ways to send hold every write", () => {
    const service: string = fs.readFileSync(
      path.join(MCP_ROOT, "Services/OneUptimeApiService.ts"),
      "utf8",
    );

    const executeOperation: string =
      service
        .split("public static async executeOperation(")[1]
        ?.split("public static async makeAuthenticatedApiCall(")[0] || "";
    const makeAuthenticatedApiCall: string =
      service
        .split("public static async makeAuthenticatedApiCall(")[1]
        ?.split("private static readsAs(")[0] || "";

    for (const [name, body] of [
      ["executeOperation", executeOperation],
      ["makeAuthenticatedApiCall", makeAuthenticatedApiCall],
    ] as Array<[string, string]>) {
      const holds: number = body.indexOf("refuseWriteThatAsksAPerson(");
      // The first request it could send.
      const sends: number = Math.min(
        ...[
          "makeApiRequestWithSelectRetry(",
          "API.post(",
          "API.put(",
          "API.delete(",
        ]
          .map((call: string): number => {
            return body.indexOf(call);
          })
          .filter((index: number): boolean => {
            return index >= 0;
          }),
      );

      expect({ name, holds: holds >= 0, beforeItSends: holds < sends }).toEqual(
        { name, holds: true, beforeItSends: true },
      );
    }
  });
});

/*
 * THE GUARD FAILS WHERE IT SHOULD. Each control feeds it what a future
 * change could bring - an action that starts to ask, a hold taken away, a
 * change with no fixture, a new entry in another product's list - and
 * shows the guard naming it.
 */
describe("negative controls: the guard fails on what it is for", () => {
  it("a new Ask AI action that asks in every mode, held by nothing, is named", () => {
    const newAction: ObservabilityTool = {
      ...(AIToolbox.getToolByName(
        "change_data_security_issue",
      ) as ObservabilityTool),
      name: "make_every_store_public",
      asksInEveryMode: (): boolean => {
        return true;
      },
    };

    expect(
      getUnclassifiedAskAiActions([...AIToolbox.getTools(), newAction]),
    ).toEqual(["make_every_store_public"]);
  });

  it("with the hold taken away, as on main before this change, every path is named", async () => {
    jest
      .spyOn(AlwaysAskWritesModule, "refuseWriteThatAsksAPerson")
      .mockResolvedValue(undefined);

    const paths: Array<ToolPath> = getToolPaths(ALWAYS_ASK_CHANGES);
    const notRefused: Array<string> = await getPathsNotRefused(
      paths,
      signedInMember(),
    );

    expect(notRefused).toHaveLength(paths.length);
    expect(notRefused).toContain(
      "Accept Risk|DataSecurityIssue|update (update_data_security_issue)",
    );
  });

  it("a new change on a record with tools and no fixture is named", () => {
    const newChange: AlwaysAskChange = {
      name: "An incident's title rewritten",
      action: "change_data_security_issue",
      madeByEveryCall: false,
      card: "a card",
      product: "Data Security",
      records: [
        {
          tableName: "Incident",
          writes: [AlwaysAskWrite.Update],
          columns: ["title"],
          makesIt: (): boolean => {
            return true;
          },
          written: "an update of title",
          page: ALWAYS_ASK_CHANGES[0]!.records[0]!.page,
        },
      ],
      asksBecause: "Asks first in every mode: a test.",
    };

    expect(
      getPathsWithoutAFixture(getToolPaths([newChange]), MAKES_THE_CHANGE),
    ).toEqual([
      "An incident's title rewritten|Incident|update (update_incident)",
    ]);
  });

  it("a change whose record gains a tool, with no hold, is a path the guard calls and names", async () => {
    const unheld: AlwaysAskChange = {
      ...ALWAYS_ASK_CHANGES[0]!,
      name: "A monitor's title rewritten",
      records: [
        {
          tableName: "Monitor",
          writes: [AlwaysAskWrite.Update],
          columns: ["name"],
          makesIt: (): boolean => {
            return true;
          },
          written: "an update of name",
          page: ALWAYS_ASK_CHANGES[0]!.records[0]!.page,
        },
      ],
    };
    const paths: Array<ToolPath> = getToolPaths([unheld]);

    expect(paths).toHaveLength(1);
    // Not in Common's list, so nothing refuses it: called, it is sent, and the guard names it.
    expect(
      await getPathsNotRefused(paths, signedInMember(), {
        [paths[0]!.key]: {
          args: { id: "11177000-0000-4000-8000-000000000021", name: "x" },
        },
      }),
    ).toEqual([
      `A monitor's title rewritten|Monitor|update (${paths[0]!.tool.name})`,
    ]);
    expect(api.writesSent()).toHaveLength(1);
  });

  it("a new kind in another product's always-ask list is named", () => {
    expect(
      unclassified(
        [
          ...SECURITY_CASE_AI_ALWAYS_ASKS,
          "WipeTheLaptop" as SecurityCaseAiActionKind,
        ],
        SECURITY_CASE_AI,
      ),
    ).toEqual(["WipeTheLaptop"]);
    expect(
      unclassified(
        [
          ...DATA_SECURITY_AI_ALWAYS_ASKS,
          "ChangesRetention" as DataSecurityAiChangeSafety,
        ],
        DATA_SECURITY_AI_SAFETIES,
      ),
    ).toEqual(["ChangesRetention"]);
  });

  it("a record named as having no tool here, that has one, fails", () => {
    expect(() => {
      expectNoToolHere(["DataSecurityIssue"]);
    }).toThrow();
  });
});
