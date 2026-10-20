import ExternalMcpServer from "../../../../Models/DatabaseModels/ExternalMcpServer";
import {
  ExternalMcpServerConnectionCheck,
  ExternalMcpServerFailureKind,
} from "../../../../Types/AI/ExternalMcpServer/ExternalMcpServerConnectionCheck";
import {
  ExternalMcpServerTool,
  countExternalMcpServerReadOnlyTools,
  readExternalMcpServerTools,
} from "../../../../Types/AI/ExternalMcpServer/ExternalMcpServerTool";
import { EXTERNAL_MCP_SERVER_TRANSPORT_TITLES } from "../../../../Types/AI/ExternalMcpServer/ExternalMcpServerTransport";
import OneUptimeDate from "../../../../Types/Date";
import { JSONArray } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import ExternalMcpServerService from "../../../Services/ExternalMcpServerService";
import logger from "../../Logger";
import ExternalMcpServerConnection from "./ExternalMcpServerConnection";
import {
  McpServerHandshake,
  McpToolDescription,
  McpToolList,
} from "./McpClient";
import McpClientError from "./McpClientError";
import { McpHttpTransport } from "./McpHttpTransport";

/*
 * "TEST CONNECTION": connect to a server, read its tools, and say what was
 * found - kept on the server's record too (lastError, tools, ...), so the
 * list of servers says how each one is doing, and OneUptime AI's runs keep
 * it up to date the same way (recordConnection).
 *
 * The test changes nothing on the server: it opens a session, lists the
 * tools and closes the session. It calls no tool.
 */
export default class ExternalMcpServerCheck {
  // The tools as the record keeps them: no schemas, every text held to its length.
  public static toStoredTools(
    tools: Array<McpToolDescription>,
  ): Array<ExternalMcpServerTool> {
    return readExternalMcpServerTools(
      tools.map((tool: McpToolDescription) => {
        return {
          name: tool.name,
          title: tool.title,
          description: tool.description,
          readsOnly: tool.readsOnly,
        };
      }),
    );
  }

  // What the check found, in one sentence.
  public static describeConnected(data: {
    handshake: McpServerHandshake;
    tools: Array<ExternalMcpServerTool>;
  }): string {
    const server: string = data.handshake.serverName
      ? `"${data.handshake.serverName}"`
      : "the server";
    const transport: string =
      EXTERNAL_MCP_SERVER_TRANSPORT_TITLES[data.handshake.transport];
    const readOnly: number = countExternalMcpServerReadOnlyTools(data.tools);

    if (data.tools.length === 0) {
      return `Connected to ${server} over ${transport}. It offers no tools.`;
    }

    return `Connected to ${server} over ${transport}. It offers ${data.tools.length} ${
      data.tools.length === 1 ? "tool" : "tools"
    }, ${readOnly} of them only ${readOnly === 1 ? "reads" : "read"}.`;
  }

  public static async run(data: {
    server: ExternalMcpServer;
    transport?: McpHttpTransport | undefined;
  }): Promise<ExternalMcpServerConnectionCheck> {
    const startedAtMs: number = Date.now();
    const connection: ExternalMcpServerConnection =
      ExternalMcpServerConnection.fromServer(data.server, {
        transport: data.transport,
      });

    try {
      const handshake: McpServerHandshake = await connection.connect();
      const list: McpToolList = await connection.listTools();
      const tools: Array<ExternalMcpServerTool> =
        ExternalMcpServerCheck.toStoredTools(list.tools);

      return {
        isConnected: true,
        message: ExternalMcpServerCheck.describeConnected({
          handshake,
          tools,
        }),
        transport: handshake.transport,
        serverName: handshake.serverTitle || handshake.serverName,
        serverVersion: handshake.serverVersion,
        protocolVersion: handshake.protocolVersion,
        tools,
        toolsLeftOut: list.leftOut,
        durationInMs: Date.now() - startedAtMs,
      };
    } catch (error) {
      const failure: McpClientError =
        error instanceof McpClientError
          ? error
          : new McpClientError({
              kind: ExternalMcpServerFailureKind.Other,
              message: connection.redact(
                error instanceof Error ? error.message : String(error),
              ),
            });

      return {
        isConnected: false,
        message: connection.redact(failure.message),
        failureKind: failure.kind,
        tools: [],
        toolsLeftOut: 0,
        durationInMs: Date.now() - startedAtMs,
      };
    } finally {
      await connection.close();
    }
  }

  /*
   * Keeps what a connection found on the server's record: on success the
   * transport, the server's name and version and its tools, with the last
   * error cleared; on failure the error, with what was found before kept.
   * Never throws: a record that cannot be written leaves the check's
   * answer as it is.
   */
  public static async recordConnection(data: {
    serverId: ObjectID;
    check: ExternalMcpServerConnectionCheck;
  }): Promise<void> {
    const now: Date = OneUptimeDate.getCurrentDate();

    try {
      await ExternalMcpServerService.updateOneById({
        id: data.serverId,
        data: data.check.isConnected
          ? {
              lastCheckedAt: now,
              lastConnectedAt: now,
              lastError: null,
              transport: data.check.transport,
              serverName: data.check.serverName || null,
              serverVersion: data.check.serverVersion || null,
              protocolVersion: data.check.protocolVersion || null,
              tools: data.check.tools as unknown as JSONArray,
            }
          : {
              lastCheckedAt: now,
              lastError: data.check.message,
            },
        props: { isRoot: true },
      } as never);
    } catch (error) {
      logger.error(
        `External MCP server ${data.serverId.toString()}: could not record its connection check: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
