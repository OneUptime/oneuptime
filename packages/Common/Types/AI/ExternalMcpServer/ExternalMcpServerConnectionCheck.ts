import ExternalMcpServerTransport from "./ExternalMcpServerTransport";
import { ExternalMcpServerTool } from "./ExternalMcpServerTool";

/*
 * WHAT "TEST CONNECTION" FOUND: OneUptime connected to the server (or did
 * not), and which tools it offers. The server's page shows it, and the
 * same answer is kept on the server's record (lastError, tools, ...) so the
 * list says how each server is doing.
 *
 * A server that cannot be reached is the test's answer, not a failed
 * request: the API answers it like any other result.
 *
 * Shared by the server and the Dashboard, so it imports nothing but types.
 */

// Why a connection failed, for the words the Dashboard puts beside it.
export enum ExternalMcpServerFailureKind {
  // OneUptime may not reach the address (a private or internal address).
  AddressNotAllowed = "AddressNotAllowed",
  // No answer at all: a name that does not resolve, a refused connection, TLS.
  Unreachable = "Unreachable",
  // The server refused the sign-in (HTTP 401 or 403).
  SignInRefused = "SignInRefused",
  // The OAuth token URL did not hand out a token.
  TokenRequestFailed = "TokenRequestFailed",
  // Something answered, but not as an MCP server does.
  NotAnMcpServer = "NotAnMcpServer",
  // The server took longer than OneUptime waits.
  TimedOut = "TimedOut",
  // The answer was larger than OneUptime reads.
  TooLarge = "TooLarge",
  // The server answered with an error of its own.
  ServerError = "ServerError",
  Other = "Other",
}

export interface ExternalMcpServerConnectionCheck {
  isConnected: boolean;
  // One plain sentence: what happened.
  message: string;
  failureKind?: ExternalMcpServerFailureKind | undefined;
  transport?: ExternalMcpServerTransport | undefined;
  // What the server calls itself (its serverInfo), when it says.
  serverName?: string | undefined;
  serverVersion?: string | undefined;
  protocolVersion?: string | undefined;
  tools: Array<ExternalMcpServerTool>;
  // Tools past MAX_EXTERNAL_MCP_SERVER_TOOLS, which are not offered.
  toolsLeftOut: number;
  durationInMs: number;
}

export function isExternalMcpServerFailureKind(
  value: unknown,
): value is ExternalMcpServerFailureKind {
  return (
    typeof value === "string" &&
    Object.values(ExternalMcpServerFailureKind).includes(
      value as ExternalMcpServerFailureKind,
    )
  );
}
