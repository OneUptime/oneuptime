import { describe, expect, test } from "@jest/globals";
import {
  MCP_ACCESS_READ_AND_WRITE,
  MCP_ACCESS_READ_ONLY,
  getMcpAccessLabel,
  getMcpClientHost,
} from "../../FeatureSet/Dashboard/src/Utils/McpClientAuthorization";
import McpOAuthScope, {
  McpOAuthScopeUtil,
} from "Common/Types/Mcp/McpOAuthScope";

/*
 * What a row of Settings -> MCP Server -> Connected MCP Clients says about a
 * client: what it may do, and where it is published.
 *
 * Both are read by a person deciding whether to disconnect something, so both
 * have a wrong direction that matters:
 *
 *  - ACCESS. The row says "Read and write" only when the grant's stored scope
 *    really includes write. Anything the table cannot make sense of reads as
 *    "Read only" - never the other way round by accident, and never blank.
 *  - HOST. A host is shown only for a client whose id is the https URL of a
 *    metadata document, because only then is the host something the client
 *    did not simply type. A client that registered itself has an opaque id;
 *    printing anything under its name would dress a self-chosen name up as a
 *    verified one.
 */

describe("the access a connected client has", () => {
  test("the two labels are the ones the table prints", () => {
    expect(MCP_ACCESS_READ_AND_WRITE).toBe("Read and write");
    expect(MCP_ACCESS_READ_ONLY).toBe("Read only");
  });

  test.each([
    ["the scope a read and write grant stores", "mcp:read mcp:write"],
    ["write on its own, which implies read", "mcp:write"],
    ["write with a refresh scope", "mcp:read mcp:write offline_access"],
    ["write named first", "mcp:write mcp:read"],
    ["write named last", "offline_access mcp:read mcp:write"],
    ["write repeated", "mcp:write mcp:write"],
    ["write among scopes this version does not know", "openid mcp:write email"],
    ["write with stray spaces around it", "  mcp:write   mcp:read "],
  ])("%s is read and write", (_label: string, scope: string) => {
    expect(getMcpAccessLabel(scope)).toBe("Read and write");
  });

  test.each([
    ["the scope a read-only grant stores", "mcp:read"],
    ["read with a refresh scope", "mcp:read offline_access"],
    ["a refresh scope alone", "offline_access"],
    ["no scope", ""],
    ["only spaces", "   "],
    ["a scope this version does not know", "admin"],
    ["several unknown scopes", "openid profile email"],
    ["a longer word that starts like write", "mcp:writer"],
    ["a shorter word", "mcp:writ"],
    ["write without its prefix", "write"],
    ["write in capitals", "MCP:WRITE"],
    ["write with a comma stuck to it", "mcp:write,"],
    ["comma-separated scopes", "mcp:read,mcp:write"],
    ["tab-separated scopes", "mcp:read\tmcp:write"],
    ["line-separated scopes", "mcp:read\nmcp:write"],
    ["a quoted scope", '"mcp:write"'],
    ["the label itself", "Read and write"],
  ])("%s is read only", (_label: string, scope: string) => {
    expect(getMcpAccessLabel(scope)).toBe("Read only");
  });

  test("a row with no scope at all is read only", () => {
    expect(getMcpAccessLabel(undefined)).toBe("Read only");
  });

  test("a value that is not text is read only, and does not throw", () => {
    /*
     * The column comes off the wire. The table must render whatever arrives,
     * and render it as the narrower access.
     */
    for (const value of [null, 3, true, {}, ["mcp:write"]]) {
      expect(getMcpAccessLabel(value as unknown as string)).toBe("Read only");
    }
  });

  test("the label agrees with what the server stores for each access level", () => {
    /*
     * The grant's scope is written by McpOAuthScopeUtil on the server: a
     * read and write grant is stored normalized, write spelled out as read +
     * write. This is that round trip.
     */
    const stored: (scopes: Array<McpOAuthScope>) => string = (
      scopes: Array<McpOAuthScope>,
    ): string => {
      return McpOAuthScopeUtil.toString(McpOAuthScopeUtil.normalize(scopes));
    };

    expect(getMcpAccessLabel(stored([McpOAuthScope.Write]))).toBe(
      "Read and write",
    );
    expect(
      getMcpAccessLabel(stored([McpOAuthScope.Read, McpOAuthScope.Write])),
    ).toBe("Read and write");
    expect(
      getMcpAccessLabel(
        stored([
          McpOAuthScope.Read,
          McpOAuthScope.Write,
          McpOAuthScope.OfflineAccess,
        ]),
      ),
    ).toBe("Read and write");
    expect(getMcpAccessLabel(stored([McpOAuthScope.Read]))).toBe("Read only");
    expect(
      getMcpAccessLabel(
        stored([McpOAuthScope.Read, McpOAuthScope.OfflineAccess]),
      ),
    ).toBe("Read only");
    expect(getMcpAccessLabel(stored([]))).toBe("Read only");
  });
});

describe("the host a connected client is published at", () => {
  test.each([
    [
      "a metadata document URL",
      "https://claude.ai/oauth/mcp-oauth-client-metadata",
      "claude.ai",
    ],
    [
      "a URL on a subdomain",
      "https://mcp.client.example.com/client.json",
      "mcp.client.example.com",
    ],
    [
      "a URL with a port",
      "https://client.example.com:8443/client.json",
      "client.example.com:8443",
    ],
    [
      "a URL that spells out the default port",
      "https://client.example.com:443/client.json",
      "client.example.com",
    ],
    [
      "a URL with a query",
      "https://client.example.com/client.json?v=2",
      "client.example.com",
    ],
    [
      "a URL whose host is in capitals",
      "https://Client.Example.COM/client.json",
      "client.example.com",
    ],
    [
      "a URL on an IPv6 literal",
      "https://[2001:db8::1]:9443/client.json",
      "[2001:db8::1]:9443",
    ],
    [
      "an internationalised host in punycode",
      "https://xn--bcher-kva.example/client.json",
      "xn--bcher-kva.example",
    ],
  ])("%s shows its host", (_label: string, clientId: string, host: string) => {
    expect(getMcpClientHost(clientId)).toBe(host);
  });

  test("only the host is shown, never the path the document lives at", () => {
    const host: string | null = getMcpClientHost(
      "https://client.example.com/trusted-by-oneuptime/client.json",
    );

    expect(host).toBe("client.example.com");
    expect(host).not.toContain("trusted");
    expect(host).not.toContain("/");
  });

  test.each([
    [
      "the id of a client that registered itself",
      "0b2f8c0e-7c1f-4c62-9b3a-0d6f4a3d2e11",
    ],
    ["a plain http URL", "http://client.example.com/client.json"],
    ["an https URL in capitals", "HTTPS://client.example.com/client.json"],
    ["a URL with a space before it", " https://client.example.com/client.json"],
    ["another scheme", "ftp://client.example.com/client.json"],
    ["an app scheme", "cursor://anysphere.cursor-retrieval/oauth"],
    ["a script URL", "javascript:alert(1)"],
    ["a bare host", "client.example.com"],
    ["a host that looks like a URL without a scheme", "//client.example.com/x"],
    ["https with nothing after it", "https://"],
    ["https with a space in the host", "https://client example.com/x"],
    ["words", "Claude Code"],
    ["the empty string", ""],
  ])("%s shows no host", (_label: string, clientId: string) => {
    expect(getMcpClientHost(clientId)).toBeNull();
  });

  test("a row with no client id shows no host", () => {
    expect(getMcpClientHost(undefined)).toBeNull();
  });
});
