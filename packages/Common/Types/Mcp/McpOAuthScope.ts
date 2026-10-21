/*
 * What an MCP client that signed in with OAuth may do.
 *
 * Two levels, because that is the one distinction every MCP tool already
 * declares about itself (readOnlyHint): a client holding `mcp:read` can call
 * the get/list/count tools and nothing else; `mcp:write` adds the tools that
 * create, update, delete, acknowledge and resolve.
 *
 * WRITE IMPLIES READ
 *
 * A client that steps up after an `insufficient_scope` challenge is allowed
 * to request only the scope the challenge named (the MCP TypeScript SDK does
 * exactly that), so a token carrying `mcp:write` alone has to keep reading.
 * The specification asks resource servers to honour such hierarchies; here it
 * is also the only reading that makes sense - nothing can sensibly resolve an
 * incident it is not allowed to look at.
 *
 * NEITHER SCOPE IS A PERMISSION
 *
 * A scope narrows what the token may be used for. What the caller may touch
 * is still decided, on every request, by the permissions the signed-in user
 * holds in the project - a read-and-write token for a user whose teams grant
 * Monitor Viewer and nothing else can still only view monitors.
 *
 * `offline_access` is accepted because clients that follow OpenID Connect
 * convention ask for it to get a refresh token. It changes nothing: a refresh
 * token is issued with every authorization.
 */
enum McpOAuthScope {
  Read = "mcp:read",
  Write = "mcp:write",
  OfflineAccess = "offline_access",
}

export default McpOAuthScope;

export interface ParsedMcpOAuthScope {
  scopes: Array<McpOAuthScope>;

  /* Tokens in the request that this server does not issue. */
  unknownScopes: Array<string>;
}

/*
 * The order scopes are written in, everywhere: stored on a grant, returned by
 * the token endpoint, named in a challenge. One order means two grants with
 * the same access always carry the same string.
 */
const CANONICAL_ORDER: Array<McpOAuthScope> = [
  McpOAuthScope.Read,
  McpOAuthScope.Write,
  McpOAuthScope.OfflineAccess,
];

/* RFC 6749 section 3.3: scope-token = 1*( %x21 / %x23-5B / %x5D-7E ). */
const SCOPE_TOKEN_PATTERN: RegExp = /^[\x21\x23-\x5B\x5D-\x7E]+$/;

export class McpOAuthScopeUtil {
  /* The scopes a resource owner is asked about. `offline_access` is not one. */
  public static readonly ACCESS_SCOPES: Array<McpOAuthScope> = [
    McpOAuthScope.Read,
    McpOAuthScope.Write,
  ];

  public static readonly ALL_SCOPES: Array<McpOAuthScope> = [
    ...CANONICAL_ORDER,
  ];

  /*
   * Splits a space-delimited scope string. Never throws: a value that is not
   * a string, or is empty, is simply no scopes. Duplicates collapse.
   */
  public static parse(value: unknown): ParsedMcpOAuthScope {
    const scopes: Array<McpOAuthScope> = [];
    const unknownScopes: Array<string> = [];

    if (typeof value !== "string") {
      return { scopes, unknownScopes };
    }

    for (const token of value.split(" ")) {
      if (!token) {
        continue;
      }

      const known: McpOAuthScope | undefined = CANONICAL_ORDER.find(
        (scope: McpOAuthScope) => {
          return scope === token;
        },
      );

      if (known) {
        if (!scopes.includes(known)) {
          scopes.push(known);
        }
        continue;
      }

      if (!unknownScopes.includes(token)) {
        unknownScopes.push(token);
      }
    }

    return {
      scopes: McpOAuthScopeUtil.sort(scopes),
      unknownScopes,
    };
  }

  /* Whether every token in the string is syntactically a scope token. */
  public static isWellFormed(value: string): boolean {
    return value.split(" ").every((token: string) => {
      return token.length > 0 && SCOPE_TOKEN_PATTERN.test(token);
    });
  }

  public static sort(scopes: Array<McpOAuthScope>): Array<McpOAuthScope> {
    return CANONICAL_ORDER.filter((scope: McpOAuthScope) => {
      return scopes.includes(scope);
    });
  }

  public static toString(scopes: Array<McpOAuthScope>): string {
    return McpOAuthScopeUtil.sort(scopes).join(" ");
  }

  /*
   * The set a grant stores: write is spelled out as read + write so that the
   * string on the grant, in the token response and on the consent screen all
   * say the same thing, whichever of the two the client asked for.
   */
  public static normalize(scopes: Array<McpOAuthScope>): Array<McpOAuthScope> {
    const normalized: Array<McpOAuthScope> = [...scopes];

    if (
      normalized.includes(McpOAuthScope.Write) &&
      !normalized.includes(McpOAuthScope.Read)
    ) {
      normalized.push(McpOAuthScope.Read);
    }

    return McpOAuthScopeUtil.sort(normalized);
  }

  public static canRead(scopes: Array<McpOAuthScope>): boolean {
    return (
      scopes.includes(McpOAuthScope.Read) ||
      scopes.includes(McpOAuthScope.Write)
    );
  }

  public static canWrite(scopes: Array<McpOAuthScope>): boolean {
    return scopes.includes(McpOAuthScope.Write);
  }

  /* Whether `granted` covers everything in `required`, hierarchy included. */
  public static satisfies(
    granted: Array<McpOAuthScope>,
    required: Array<McpOAuthScope>,
  ): boolean {
    return required.every((scope: McpOAuthScope) => {
      if (scope === McpOAuthScope.Read) {
        return McpOAuthScopeUtil.canRead(granted);
      }

      return granted.includes(scope);
    });
  }

  /*
   * True when `candidate` asks for nothing `granted` does not already cover.
   * Used by the refresh grant, which may narrow a token but never widen it.
   */
  public static isSubset(
    candidate: Array<McpOAuthScope>,
    granted: Array<McpOAuthScope>,
  ): boolean {
    return McpOAuthScopeUtil.satisfies(granted, candidate);
  }
}
