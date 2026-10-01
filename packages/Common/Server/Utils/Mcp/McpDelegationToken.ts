import McpOAuthConfig from "./McpOAuthConfig";
import McpOAuthSignedToken, {
  McpOAuthSignedTokenPurpose,
} from "./McpOAuthSignedToken";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

/*
 * The credential the MCP server presents to the OneUptime API when it runs a
 * tool for a client that signed in with OAuth.
 *
 * WHY THE CLIENT'S OWN TOKEN IS NOT FORWARDED
 *
 * An API key travels from the MCP server to the API unchanged, because an API
 * key is an API credential. An OAuth access token is not: it was issued for
 * the MCP endpoint (its audience) and for a read-only or read-and-write use
 * of the MCP tools (its scope). If the API accepted it directly, anyone
 * holding one could skip the MCP server and call every endpoint the member
 * can reach - team membership, API keys, billing - with the scope checked by
 * nothing. So the MCP server is the only thing that accepts the access token.
 * Having checked it, it mints one of these, and this is what the API sees:
 * "the MCP server vouches that this request is being made for this member, in
 * this project, through this grant".
 *
 * WHAT STOPS ANYBODY ELSE MINTING ONE
 *
 * It is signed with a key derived from EncryptionSecret under a label used
 * for nothing else (McpOAuthSignedToken), which only the server holds. It
 * lives for a minute, because it is minted per tool call and used at once. A
 * stolen access token is therefore worth exactly what the MCP tools can do
 * with it, and no more.
 *
 * WHAT IT DOES NOT CARRY
 *
 * Permissions. The API works those out itself from the member's teams, on
 * every request, so a role change or a removal from the project takes effect
 * immediately rather than when a token expires. And never master-admin
 * authority, whoever the member is.
 *
 * WHAT IT DOES CARRY, BESIDES WHO
 *
 * Whether the grant may change anything. The MCP server already refuses the
 * tools that write for a client its user authorized as read-only; the flag
 * lets the API refuse the write as well, so that promise does not depend on
 * every tool being classified correctly.
 */

export interface McpDelegationClaims {
  userId: ObjectID;
  userEmail: Email;
  userName: string;
  projectId: ObjectID;
  grantId: ObjectID;

  // Shown in audit logs: which connected client made the change.
  clientId: string;
  clientName: string;

  // False for a grant that carries read access only.
  canWrite: boolean;
}

const PURPOSE: McpOAuthSignedTokenPurpose = {
  keyDerivationLabel: "oneuptime:mcp:oauth:api-delegation-token:v1",
  maxLength: 4096,
};

export default class McpDelegationToken {
  // Lower case: Node lower-cases header names on the way in.
  public static readonly HEADER_NAME: string = "x-oneuptime-mcp-delegation";

  public static sign(
    claims: McpDelegationClaims,
    now?: Date | undefined,
  ): string {
    const token: string | null = McpOAuthSignedToken.sign({
      purpose: PURPOSE,
      claims: {
        u: claims.userId.toString(),
        e: claims.userEmail.toString(),
        n: claims.userName,
        p: claims.projectId.toString(),
        g: claims.grantId.toString(),
        ci: claims.clientId,
        cn: claims.clientName,
        w: claims.canWrite === true,
      },
      expiresInSeconds: McpOAuthConfig.DELEGATION_TOKEN_TTL_SECONDS,
      now,
    });

    if (!token) {
      /*
       * Every field is bounded where it was stored (a client id is at most
       * 500 characters, a name 100), so this is unreachable short of a bug.
       */
      throw new Error("MCP delegation token could not be created.");
    }

    return token;
  }

  // NEVER throws: anything that is not a valid, current token is null.
  public static verify(
    token: unknown,
    now?: Date | undefined,
  ): McpDelegationClaims | null {
    const claims: JSONObject | null = McpOAuthSignedToken.verify({
      purpose: PURPOSE,
      token,
      now,
    });

    if (!claims) {
      return null;
    }

    const userId: unknown = claims["u"];
    const userEmail: unknown = claims["e"];
    const userName: unknown = claims["n"];
    const projectId: unknown = claims["p"];
    const grantId: unknown = claims["g"];
    const clientId: unknown = claims["ci"];
    const clientName: unknown = claims["cn"];
    const canWrite: unknown = claims["w"];

    if (
      typeof userId !== "string" ||
      typeof projectId !== "string" ||
      typeof grantId !== "string" ||
      !ObjectID.isValidUUID(userId) ||
      !ObjectID.isValidUUID(projectId) ||
      !ObjectID.isValidUUID(grantId)
    ) {
      return null;
    }

    if (typeof userEmail !== "string" || !Email.isValid(userEmail)) {
      return null;
    }

    if (
      typeof userName !== "string" ||
      typeof clientId !== "string" ||
      typeof clientName !== "string" ||
      !clientId
    ) {
      return null;
    }

    /*
     * A token that does not say is not a token that may write: the claim is
     * required, so nothing can come to mean "read and write" by omission.
     */
    if (typeof canWrite !== "boolean") {
      return null;
    }

    return {
      userId: new ObjectID(userId),
      userEmail: new Email(userEmail),
      userName,
      projectId: new ObjectID(projectId),
      grantId: new ObjectID(grantId),
      clientId,
      clientName,
      canWrite,
    };
  }
}
