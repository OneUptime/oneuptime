import ExternalMcpToolReadOnlyMarkService, {
  EXTERNAL_MCP_TOOL_MARK_NEEDS_A_PERSON_MESSAGE,
  EXTERNAL_MCP_TOOL_MARK_SERVER_NOT_FOUND_MESSAGE,
  EXTERNAL_MCP_TOOL_MARK_SERVER_REQUIRED_MESSAGE,
  EXTERNAL_MCP_TOOL_MARK_TOOL_REQUIRED_MESSAGE,
  describeExternalMcpToolMarkRefusal,
  getExternalMcpToolNotFingerprintedMessage,
  getExternalMcpToolNotReadMessage,
  getExternalMcpToolReadsOnlyMessage,
  getExternalMcpToolServerMarksChangeMessage,
} from "../../../Server/Services/ExternalMcpToolReadOnlyMarkService";
import ExternalMcpServerService from "../../../Server/Services/ExternalMcpServerService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import ProjectReferenceCheck from "../../../Server/Utils/Database/ProjectReferenceCheck";
import ExternalMcpServerCheck from "../../../Server/Utils/AI/Mcp/ExternalMcpServerCheck";
import {
  McpToolDescription,
  readMcpToolDescription,
} from "../../../Server/Utils/AI/Mcp/McpClient";
import logger from "../../../Server/Utils/Logger";
import ExternalMcpServer from "../../../Models/DatabaseModels/ExternalMcpServer";
import ExternalMcpToolReadOnlyMark from "../../../Models/DatabaseModels/ExternalMcpToolReadOnlyMark";
import { ExternalMcpServerTool } from "../../../Types/AI/ExternalMcpServer/ExternalMcpServerTool";
import { ExternalMcpToolMarkRefusalKind } from "../../../Types/AI/ExternalMcpServer/ExternalMcpToolReadOnlyMark";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import UserType from "../../../Types/UserType";
import {
  KAgentToolsVersion,
  readKAgentToolsRecording,
} from "../../Helpers/KAgentToolRecordings";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * ISSUE #11081: HOW A PROJECT ADMIN'S READ-ONLY MARK IS MADE.
 *
 * Through the mark's own create, one tool a request, by a person signed in
 * (an API key, a workflow and OneUptime itself never mark a tool), for a
 * tool OneUptime read on a server of the project, that its server says
 * nothing about and nothing refuses - kAgent's tools as recorded, stored
 * the way Test connection stores them. The mark holds the tool's
 * fingerprint from what OneUptime read, never from the request, and
 * marking a tool again takes its earlier marks away as the same person.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11081000-0000-4000-8000-0000000000e1",
);
const SERVER_ID: ObjectID = new ObjectID(
  "11081000-0000-4000-8000-0000000000e2",
);
const PERSON_ID: ObjectID = new ObjectID(
  "11081000-0000-4000-8000-0000000000e3",
);

type Hooks = {
  onBeforeCreate: (
    createBy: CreateBy<ExternalMcpToolReadOnlyMark>,
  ) => Promise<OnCreate<ExternalMcpToolReadOnlyMark>>;
  onCreateSuccess: (
    onCreate: OnCreate<ExternalMcpToolReadOnlyMark>,
    createdItem: ExternalMcpToolReadOnlyMark,
  ) => Promise<ExternalMcpToolReadOnlyMark>;
};

const service: Hooks = ExternalMcpToolReadOnlyMarkService as unknown as Hooks;

// kAgent's tools, stored as Test connection stores them.
function storedToolsOf(
  version: KAgentToolsVersion,
): Array<ExternalMcpServerTool> {
  return ExternalMcpServerCheck.toStoredTools(
    readKAgentToolsRecording({ version }).tools.map(
      (raw: JSONObject): McpToolDescription => {
        return readMcpToolDescription(raw)!;
      },
    ),
  );
}

function storedServer(
  tools: Array<ExternalMcpServerTool> | JSONArray | undefined,
): ExternalMcpServer {
  const server: ExternalMcpServer = new ExternalMcpServer();
  server.id = SERVER_ID;
  server.projectId = PROJECT_ID;

  if (tools !== undefined) {
    server.tools = tools as unknown as JSONArray;
  }

  return server;
}

function personProps(): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT_ID,
    userId: PERSON_ID,
    userType: UserType.User,
  } as DatabaseCommonInteractionProps;
}

function createBy(
  data: JSONObject,
  props: DatabaseCommonInteractionProps = personProps(),
): CreateBy<ExternalMcpToolReadOnlyMark> {
  const mark: ExternalMcpToolReadOnlyMark = new ExternalMcpToolReadOnlyMark();
  Object.assign(mark, { externalMcpServerId: SERVER_ID, ...data });

  return { data: mark, props } as CreateBy<ExternalMcpToolReadOnlyMark>;
}

async function refusal(
  work: Promise<unknown>,
  type: typeof BadDataException | typeof NotAuthorizedException,
): Promise<string> {
  try {
    await work;
  } catch (error) {
    expect(error).toBeInstanceOf(type);
    return (error as Error).message;
  }

  throw new Error("Expected a refusal.");
}

let findServer: SpyInstance<typeof ExternalMcpServerService.findOneBy>;
let references: SpyInstance<typeof ProjectReferenceCheck.validateCreate>;

beforeEach(() => {
  references = jest
    .spyOn(ProjectReferenceCheck, "validateCreate")
    .mockResolvedValue(undefined as never);
  findServer = jest
    .spyOn(ExternalMcpServerService, "findOneBy")
    .mockResolvedValue(storedServer(storedToolsOf("0.3.2")));
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a Project Admin marks one tool", () => {
  test("a tool its server says nothing about: the mark holds the tool as OneUptime read it", async () => {
    const tools: Array<ExternalMcpServerTool> = storedToolsOf("0.3.2");
    const stored: ExternalMcpServerTool = tools.find(
      (tool: ExternalMcpServerTool): boolean => {
        return tool.name === "k8s_get_resources";
      },
    )!;

    const onCreate: OnCreate<ExternalMcpToolReadOnlyMark> =
      await service.onBeforeCreate(createBy({ toolName: "k8s_get_resources" }));

    expect(onCreate.createBy.data.toolName).toBe("k8s_get_resources");
    expect(onCreate.createBy.data.toolFingerprint).toBe(stored.fingerprint);
    expect(onCreate.createBy.data.externalMcpServerId?.toString()).toBe(
      SERVER_ID.toString(),
    );
  });

  test("the references are checked first, as every service of the project's records checks them", async () => {
    await service.onBeforeCreate(createBy({ toolName: "k8s_get_resources" }));

    expect(references).toHaveBeenCalledTimes(1);
    expect(references.mock.invocationCallOrder[0]!).toBeLessThan(
      findServer.mock.invocationCallOrder[0]!,
    );
  });

  test("a fingerprint the request sends is replaced: the definition is OneUptime's to take", async () => {
    const onCreate: OnCreate<ExternalMcpToolReadOnlyMark> =
      await service.onBeforeCreate(
        createBy({
          toolName: "k8s_get_resources",
          toolFingerprint: "0".repeat(64),
        }),
      );

    expect(onCreate.createBy.data.toolFingerprint).not.toBe("0".repeat(64));
  });

  test("the tool is named as the server names it: spaces around it are not part of it", async () => {
    const onCreate: OnCreate<ExternalMcpToolReadOnlyMark> =
      await service.onBeforeCreate(
        createBy({ toolName: "  k8s_get_resources " }),
      );

    expect(onCreate.createBy.data.toolName).toBe("k8s_get_resources");
  });

  test("the server is read as OneUptime, held to the project of the request", async () => {
    await service.onBeforeCreate(createBy({ toolName: "k8s_get_resources" }));

    const query: JSONObject = findServer.mock.calls[0]![0].query as JSONObject;
    expect(String(query["_id"])).toBe(SERVER_ID.toString());
    expect(String(query["projectId"])).toBe(PROJECT_ID.toString());
    expect(findServer.mock.calls[0]![0].props).toEqual({ isRoot: true });
  });

  test("a server id sent as text is read as the id", async () => {
    const onCreate: OnCreate<ExternalMcpToolReadOnlyMark> =
      await service.onBeforeCreate(
        createBy({
          toolName: "k8s_get_resources",
          externalMcpServerId: SERVER_ID.toString() as never,
        }),
      );

    expect(onCreate.createBy.data.externalMcpServerId).toBeInstanceOf(ObjectID);
  });
});

describe("only a person signed in marks a tool", () => {
  test.each([
    [
      "an API key",
      {
        tenantId: PROJECT_ID,
        userType: UserType.API,
      } as DatabaseCommonInteractionProps,
    ],
    ["OneUptime itself", { isRoot: true, tenantId: PROJECT_ID }],
    [
      "a workflow",
      {
        isRoot: true,
        tenantId: PROJECT_ID,
        userType: UserType.Workflow,
      } as DatabaseCommonInteractionProps,
    ],
  ])(
    "%s never does",
    async (_who: string, props: DatabaseCommonInteractionProps) => {
      expect(
        await refusal(
          service.onBeforeCreate(
            createBy({ toolName: "k8s_get_resources" }, props),
          ),
          NotAuthorizedException,
        ),
      ).toBe(EXTERNAL_MCP_TOOL_MARK_NEEDS_A_PERSON_MESSAGE);
      expect(findServer).not.toHaveBeenCalled();
    },
  );
});

describe("what can never be marked", () => {
  test("a tool its server marks read-only already needs no mark", async () => {
    const tools: Array<ExternalMcpServerTool> = [
      {
        name: "get_pod_status",
        readsOnly: true,
        fingerprint: "c".repeat(64),
      },
    ];
    findServer.mockResolvedValue(storedServer(tools));

    expect(
      await refusal(
        service.onBeforeCreate(createBy({ toolName: "get_pod_status" })),
        BadDataException,
      ),
    ).toBe(getExternalMcpToolReadsOnlyMessage("get_pod_status"));
  });

  test("kAgent 0.2 (mcp-go): every tool says it may destroy something, so k8s_get_resources cannot be marked", async () => {
    findServer.mockResolvedValue(storedServer(storedToolsOf("0.2.1")));

    expect(
      await refusal(
        service.onBeforeCreate(createBy({ toolName: "k8s_get_resources" })),
        BadDataException,
      ),
    ).toBe(getExternalMcpToolServerMarksChangeMessage("k8s_get_resources"));
  });

  test.each([
    [
      "k8s_delete_resource",
      `k8s_delete_resource cannot be marked read-only: "delete" in its name says it changes something.`,
    ],
    [
      "cilium_fqdn_cache",
      "cilium_fqdn_cache cannot be marked read-only: it runs what it is given in its command argument.",
    ],
    [
      "argo_verify_gateway_plugin",
      "argo_verify_gateway_plugin cannot be marked read-only: its should_install argument can make it change something.",
    ],
    [
      "k8s_rollout",
      "k8s_rollout cannot be marked read-only: its action argument can make it change something.",
    ],
    [
      "shell",
      `shell cannot be marked read-only: "shell" in its name says it changes something.`,
    ],
  ])(
    "kAgent 0.3's %s, whose name or arguments say it changes something",
    async (toolName: string, message: string) => {
      expect(
        await refusal(
          service.onBeforeCreate(createBy({ toolName })),
          BadDataException,
        ),
      ).toBe(message);
    },
  );

  test("a tool OneUptime has not read on the server", async () => {
    expect(
      await refusal(
        service.onBeforeCreate(createBy({ toolName: "k8s_get_secrets" })),
        BadDataException,
      ),
    ).toBe(getExternalMcpToolNotReadMessage("k8s_get_secrets"));
  });

  test("a server whose tools OneUptime never read", async () => {
    findServer.mockResolvedValue(storedServer(undefined));

    expect(
      await refusal(
        service.onBeforeCreate(createBy({ toolName: "k8s_get_resources" })),
        BadDataException,
      ),
    ).toBe(getExternalMcpToolNotReadMessage("k8s_get_resources"));
  });

  test("a tool read before marks existed: its connection is tested again first", async () => {
    findServer.mockResolvedValue(
      storedServer([
        {
          name: "k8s_get_resources",
          description: "List Kubernetes resources with kubectl.",
          readsOnly: false,
        },
      ]),
    );

    expect(
      await refusal(
        service.onBeforeCreate(createBy({ toolName: "k8s_get_resources" })),
        BadDataException,
      ),
    ).toBe(getExternalMcpToolNotFingerprintedMessage("k8s_get_resources"));
  });

  test("a server that is not the project's, or not at all", async () => {
    findServer.mockResolvedValue(null);

    expect(
      await refusal(
        service.onBeforeCreate(createBy({ toolName: "k8s_get_resources" })),
        BadDataException,
      ),
    ).toBe(EXTERNAL_MCP_TOOL_MARK_SERVER_NOT_FOUND_MESSAGE);
  });

  test("a server read back from another project is not this one's", async () => {
    const other: ExternalMcpServer = storedServer(storedToolsOf("0.3.2"));
    other.projectId = ObjectID.generate();
    findServer.mockResolvedValue(other);

    expect(
      await refusal(
        service.onBeforeCreate(createBy({ toolName: "k8s_get_resources" })),
        BadDataException,
      ),
    ).toBe(EXTERNAL_MCP_TOOL_MARK_SERVER_NOT_FOUND_MESSAGE);
  });

  test.each([
    [
      { externalMcpServerId: undefined },
      EXTERNAL_MCP_TOOL_MARK_SERVER_REQUIRED_MESSAGE,
    ],
    [
      { externalMcpServerId: "not-an-id" },
      EXTERNAL_MCP_TOOL_MARK_SERVER_NOT_FOUND_MESSAGE,
    ],
    [{ toolName: undefined }, EXTERNAL_MCP_TOOL_MARK_TOOL_REQUIRED_MESSAGE],
    [{ toolName: "   " }, EXTERNAL_MCP_TOOL_MARK_TOOL_REQUIRED_MESSAGE],
    [{ toolName: 12 }, EXTERNAL_MCP_TOOL_MARK_TOOL_REQUIRED_MESSAGE],
  ])(
    "a request that names no server or tool: %j",
    async (data: JSONObject, message: string) => {
      expect(
        await refusal(
          service.onBeforeCreate(
            createBy({ toolName: "k8s_get_resources", ...data }),
          ),
          BadDataException,
        ),
      ).toBe(message);
    },
  );

  test("a tool name longer than any tool's is no tool of the server's", async () => {
    const name: string = `k8s_${"x".repeat(200)}`;

    expect(
      await refusal(
        service.onBeforeCreate(createBy({ toolName: name })),
        BadDataException,
      ),
    ).toBe(getExternalMcpToolNotReadMessage(name));
  });

  test("every refusal kind says why in its own words", () => {
    expect(
      describeExternalMcpToolMarkRefusal({
        toolName: "kubernetes",
        refusal: {
          kind: ExternalMcpToolMarkRefusalKind.ArgumentCanChange,
          word: "delete",
          argument: "operation",
        },
      }),
    ).toBe(
      `kubernetes cannot be marked read-only: its operation argument can ask it to "delete".`,
    );
  });
});

describe("marking a tool again", () => {
  function onCreateOf(
    props: DatabaseCommonInteractionProps,
  ): OnCreate<ExternalMcpToolReadOnlyMark> {
    return {
      createBy: createBy(
        { toolName: "k8s_get_resources", toolFingerprint: "d".repeat(64) },
        props,
      ),
      carryForward: undefined,
    };
  }

  test("takes the tool's earlier marks away, as the same person, so the audit log has both", async () => {
    const deleteBy: SpyInstance<
      typeof ExternalMcpToolReadOnlyMarkService.deleteBy
    > = jest
      .spyOn(ExternalMcpToolReadOnlyMarkService, "deleteBy")
      .mockResolvedValue(1 as never);
    const created: ExternalMcpToolReadOnlyMark =
      new ExternalMcpToolReadOnlyMark();
    created.id = ObjectID.generate();
    const props: DatabaseCommonInteractionProps = personProps();

    const result: ExternalMcpToolReadOnlyMark = await service.onCreateSuccess(
      onCreateOf(props),
      created,
    );

    expect(result).toBe(created);
    expect(deleteBy).toHaveBeenCalledTimes(1);
    const call: JSONObject = deleteBy.mock
      .calls[0]![0] as unknown as JSONObject;
    const query: JSONObject = call["query"] as JSONObject;
    expect(String(query["externalMcpServerId"])).toBe(SERVER_ID.toString());
    expect(query["toolName"]).toBe("k8s_get_resources");
    // Every mark but the new one.
    expect(JSON.stringify(query["_id"])).toContain(created.id.toString());
    expect(call["props"]).toBe(props);
  });

  test("a failure to take them away is said in the logs, and the new mark stays", async () => {
    jest
      .spyOn(ExternalMcpToolReadOnlyMarkService, "deleteBy")
      .mockRejectedValue(new Error("connection reset"));
    const errorSpy: SpyInstance<typeof logger.error> = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {});
    const created: ExternalMcpToolReadOnlyMark =
      new ExternalMcpToolReadOnlyMark();
    created.id = ObjectID.generate();

    await expect(
      service.onCreateSuccess(onCreateOf(personProps()), created),
    ).resolves.toBe(created);
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain(
      "could not take away the earlier read-only marks of k8s_get_resources",
    );
  });
});

describe("a run's read of a server's marks", () => {
  test("is a read as OneUptime, of the run's project and that server, of what a mark holds", async () => {
    const findBy: SpyInstance<
      typeof ExternalMcpToolReadOnlyMarkService.findBy
    > = jest
      .spyOn(ExternalMcpToolReadOnlyMarkService, "findBy")
      .mockResolvedValue([]);

    await ExternalMcpToolReadOnlyMarkService.findMarksOfServer({
      projectId: PROJECT_ID,
      externalMcpServerId: SERVER_ID,
    });

    const call: JSONObject = findBy.mock.calls[0]![0] as unknown as JSONObject;
    const query: JSONObject = call["query"] as JSONObject;
    expect(String(query["projectId"])).toBe(PROJECT_ID.toString());
    expect(String(query["externalMcpServerId"])).toBe(SERVER_ID.toString());
    expect(call["select"]).toMatchObject({
      toolName: true,
      toolFingerprint: true,
    });
    expect(call["props"]).toEqual({ isRoot: true });
  });
});
