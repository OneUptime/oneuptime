import crypto from "crypto";
import ExternalMcpServer from "../../../../Models/DatabaseModels/ExternalMcpServer";
import ExternalMcpServerAuthType, {
  readExternalMcpServerAuthType,
} from "../../../../Types/AI/ExternalMcpServer/ExternalMcpServerAuthType";
import { ExternalMcpServerFailureKind } from "../../../../Types/AI/ExternalMcpServer/ExternalMcpServerConnectionCheck";
import { JSONObject } from "../../../../Types/JSON";
import Select from "../../../Types/Database/Select";
import { AppVersion } from "../../../EnvironmentConfig";
import OutboundUserAgent from "../../OutboundUserAgent";
import ProductBrandingText from "../../ProductBrandingText";
import McpClient, {
  McpServerHandshake,
  McpToolCallResultJson,
  McpToolList,
} from "./McpClient";
import McpClientError from "./McpClientError";
import { McpHttpTransport } from "./McpHttpTransport";
import McpSignIn, { McpSignInSettings } from "./McpSignIn";

/*
 * ONE PROJECT'S EXTERNAL MCP SERVER, READY TO USE: the stored server (read
 * as OneUptime, its secrets included) turned into an MCP client that signs
 * in the way its Authentication says.
 *
 * A server whose OAuth token was refused (revoked, or expired early) is
 * given one more try with a new token; any other refusal is the answer.
 *
 * Built per run (an investigation, a fix, a connection test) and closed at
 * its end, so a session never outlives what it was opened for, and one
 * project's server is only ever reached from that project's own runs: the
 * callers read servers by project (ExternalMcpServerService.findForRun).
 */

// What a connection needs of a server, read as OneUptime.
export const EXTERNAL_MCP_SERVER_CONNECTION_SELECT: Select<ExternalMcpServer> =
  {
    _id: true,
    projectId: true,
    name: true,
    description: true,
    url: true,
    authType: true,
    bearerToken: true,
    headers: true,
    oauthTokenUrl: true,
    oauthClientId: true,
    oauthClientSecret: true,
    oauthScope: true,
    oauthAudience: true,
    isEnabled: true,
  };

// The client OneUptime presents itself as, in its InitializeRequest.
export const MCP_CLIENT_NAME: string = "oneuptime-ai";

function getClientVersion(): string {
  return OutboundUserAgent.sanitizeVersion(AppVersion) || "1.0.0";
}

export default class ExternalMcpServerConnection {
  public readonly serverId: string;
  public readonly name: string;
  public readonly description: string | undefined;
  private readonly signIn: McpSignIn;
  private readonly authType: ExternalMcpServerAuthType;
  private readonly createClient: () => McpClient;
  private client: McpClient;

  private constructor(data: {
    serverId: string;
    name: string;
    description?: string | undefined;
    signIn: McpSignIn;
    authType: ExternalMcpServerAuthType;
    createClient: () => McpClient;
  }) {
    this.serverId = data.serverId;
    this.name = data.name;
    this.description = data.description;
    this.signIn = data.signIn;
    this.authType = data.authType;
    this.createClient = data.createClient;
    this.client = data.createClient();
  }

  /*
   * A connection to a stored server. `transport` is for tests: production
   * reaches every server through GuardedMcpHttpTransport.
   */
  public static fromServer(
    server: ExternalMcpServer,
    options?: { transport?: McpHttpTransport | undefined },
  ): ExternalMcpServerConnection {
    const serverId: string = server.id?.toString() || "";
    const authType: ExternalMcpServerAuthType = readExternalMcpServerAuthType(
      server.authType,
    );

    const settings: McpSignInSettings = {
      authType,
      bearerToken: server.bearerToken || undefined,
      headers: server.headers || undefined,
      oauth:
        authType === ExternalMcpServerAuthType.OAuthClientCredentials
          ? {
              tokenUrl: server.oauthTokenUrl || "",
              clientId: server.oauthClientId || "",
              clientSecret: server.oauthClientSecret || "",
              scope: server.oauthScope || undefined,
              audience: server.oauthAudience || undefined,
            }
          : undefined,
    };

    const signIn: McpSignIn = new McpSignIn({
      settings,
      cacheKey: ExternalMcpServerConnection.getTokenCacheKey(
        serverId,
        settings,
      ),
      transport: options?.transport,
    });

    const createClient: () => McpClient = (): McpClient => {
      return new McpClient({
        url: (server.url || "").trim(),
        getSignInHeaders: async (): Promise<Record<string, string>> => {
          return await signIn.getHeaders();
        },
        getSecretValues: (): Array<string> => {
          return signIn.getSecretValues();
        },
        clientInfo: {
          name: MCP_CLIENT_NAME,
          title: `${ProductBrandingText.getProductName()} AI`,
          version: getClientVersion(),
        },
        userAgent: OutboundUserAgent.get(),
        transport: options?.transport,
      });
    };

    return new ExternalMcpServerConnection({
      serverId,
      name: server.name || "MCP server",
      description: server.description || undefined,
      signIn,
      authType,
      createClient,
    });
  }

  /*
   * Which held OAuth token belongs to this server and these settings: the
   * server's id and a digest of everything the token was asked with, so
   * changing the client, the secret, the scope or the token URL asks for a
   * new one. The digest is one-way: no secret is kept in the key.
   */
  public static getTokenCacheKey(
    serverId: string,
    settings: McpSignInSettings,
  ): string {
    const digest: string = crypto
      .createHash("sha256")
      .update(
        JSON.stringify([
          settings.oauth?.tokenUrl || "",
          settings.oauth?.clientId || "",
          settings.oauth?.clientSecret || "",
          settings.oauth?.scope || "",
          settings.oauth?.audience || "",
        ]),
        "utf8",
      )
      .digest("hex");

    return `${serverId}:${digest}`;
  }

  public redact(text: string, maxChars?: number | undefined): string {
    return this.client.redact(text, maxChars);
  }

  public async connect(): Promise<McpServerHandshake> {
    return await this.withFreshTokenOnRefusal(async () => {
      return await this.client.connect();
    });
  }

  public async listTools(): Promise<McpToolList> {
    return await this.withFreshTokenOnRefusal(async () => {
      return await this.client.listTools();
    });
  }

  public async callTool(data: {
    name: string;
    arguments: JSONObject;
    timeoutMs?: number | undefined;
  }): Promise<McpToolCallResultJson> {
    return await this.withFreshTokenOnRefusal(async () => {
      return await this.client.callTool(data);
    });
  }

  public async close(): Promise<void> {
    await this.client.close();
  }

  /*
   * An OAuth token the server refused is dropped, and the request is sent
   * once more over a new session with a new token.
   */
  private async withFreshTokenOnRefusal<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (
        this.authType !== ExternalMcpServerAuthType.OAuthClientCredentials ||
        !(error instanceof McpClientError) ||
        error.kind !== ExternalMcpServerFailureKind.SignInRefused
      ) {
        throw error;
      }

      this.signIn.forgetAccessToken();
      await this.client.close();
      this.client = this.createClient();

      return await work();
    }
  }
}
