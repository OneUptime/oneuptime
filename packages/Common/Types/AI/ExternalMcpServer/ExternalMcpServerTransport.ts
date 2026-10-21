/*
 * How an external MCP server talks, as OneUptime found out when it last
 * connected (ExternalMcpServer.transport).
 *
 * A person never chooses: they paste the server's address and OneUptime
 * works it out the way the MCP specification tells a client to. It first
 * POSTs its InitializeRequest to the address - a server that answers speaks
 * Streamable HTTP (protocol 2025-03-26 and later). One that refuses with a
 * 4xx is asked again with a GET that opens an event stream - a server that
 * answers it with an `endpoint` event speaks the older HTTP+SSE transport
 * (protocol 2024-11-05).
 *
 * Shared by the server and the Dashboard, so it imports nothing.
 */
enum ExternalMcpServerTransport {
  StreamableHttp = "StreamableHttp",
  Sse = "Sse",
}

export default ExternalMcpServerTransport;

// What the Dashboard calls each one.
export const EXTERNAL_MCP_SERVER_TRANSPORT_TITLES: Record<
  ExternalMcpServerTransport,
  string
> = {
  [ExternalMcpServerTransport.StreamableHttp]: "Streamable HTTP",
  [ExternalMcpServerTransport.Sse]: "SSE",
};

export function isExternalMcpServerTransport(
  value: unknown,
): value is ExternalMcpServerTransport {
  return (
    value === ExternalMcpServerTransport.StreamableHttp ||
    value === ExternalMcpServerTransport.Sse
  );
}
