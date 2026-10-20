import { ExternalMcpServerFailureKind } from "../../../../Types/AI/ExternalMcpServer/ExternalMcpServerConnectionCheck";

/*
 * Why talking to an external MCP server failed: one sentence for people
 * (and for OneUptime AI, which reads it as a tool's error), and the kind of
 * failure, which decides what the Dashboard suggests doing about it.
 *
 * The message never holds a secret: the client removes its sign-in values
 * from anything a server or a socket said before it is put in one
 * (McpClient.redact).
 */
export default class McpClientError extends Error {
  public readonly kind: ExternalMcpServerFailureKind;
  // The HTTP status the server answered with, when it answered.
  public readonly status: number | undefined;
  // The JSON-RPC error code the server answered with, when it did.
  public readonly rpcCode: number | undefined;

  public constructor(data: {
    kind: ExternalMcpServerFailureKind;
    message: string;
    status?: number | undefined;
    rpcCode?: number | undefined;
  }) {
    super(data.message);
    this.name = "McpClientError";
    this.kind = data.kind;
    this.status = data.status;
    this.rpcCode = data.rpcCode;
  }
}
