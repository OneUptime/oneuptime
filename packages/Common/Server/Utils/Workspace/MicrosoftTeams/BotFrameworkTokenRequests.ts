import http from "http";
import https from "https";
import {
  AuthError,
  ConfidentialClientApplication,
  type INetworkModule,
  type NetworkRequestOptions,
  type NetworkResponse,
} from "@azure/msal-node";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { OutboundProxyRefusal } from "../../OutboundFetch";
import OutboundProxyAgents from "../../OutboundProxyAgents";
import {
  ConfigurationServiceClientCredentialFactory,
  ConfigurationServiceClientCredentialFactoryOptions,
  MicrosoftAppCredentials,
  MsalAppCredentials,
  type ServiceClientCredentials,
  type ServiceClientCredentialsFactory,
} from "./Botbuilder";

/*
 * THE TOKENS THE TEAMS BOT SENDS WITH, ASKED FOR ON THE OUTBOUND PROXY'S
 * ROUTE (issue #10763).
 *
 * Every reply and proactive message the bot sends carries a token for the
 * Bot Framework, which the SDK asks Microsoft Entra ID for with
 * @azure/msal-node (MsalAppCredentials): a client credentials grant, posted
 * to https://login.microsoftonline.com/<tenant>/oauth2/v2.0/token, or
 * login.microsoftonline.us for a bot in Azure Government. MSAL's own
 * network client sends on Node's https with no proxy at all. Its
 * system.proxyUrl is no way out: it takes the proxy's host and port and
 * no user name or password, and writes the request into the CONNECT
 * tunnel as plain text, so a TLS endpoint never reads it.
 *
 * BotFrameworkCredentialsFactory hands the SDK credentials whose MSAL
 * client sends on BotFrameworkTokenNetwork instead: Node's http and https,
 * on the agent OutboundProxyAgents routes the request's URL on (the
 * outbound proxy getProxyFor decides for it, NO_PROXY included, its user
 * name and password decoded, the target's certificate checked inside the
 * tunnel), or directly. Which credentials, for which authority and scope,
 * is still the SDK's own choice (ConfigurationServiceClientCredentialFactory,
 * from the bot's settings): only the client they get their tokens with is
 * OneUptime's.
 *
 * A tunnel the proxy refuses, and a 407 to a request it forwards, fail as
 * an MSAL AuthError worded as OutboundProxyRefusal words a refusal: where
 * the request was going and what the proxy answered, never the proxy.
 * MSAL hands on an AuthError as it is; any other error of its network it
 * turns into its own "network_error", so a refusal in any other shape
 * would lose what it says. The same holds for a proxy setting this server
 * cannot use, in OutboundProxyAgents' words, which name no password.
 */

// What MSAL makes of a response it cannot read, as its own network does.
function parseBody(data: {
  statusCode: number;
  statusMessage: string | undefined;
  headers: http.IncomingHttpHeaders;
  body: string;
}): unknown {
  try {
    return JSON.parse(data.body);
  } catch {
    const kind: string =
      data.statusCode >= 400 && data.statusCode < 500
        ? "client"
        : data.statusCode >= 500 && data.statusCode < 600
          ? "server"
          : "unknown";
    const who: string =
      kind === "client"
        ? "A client"
        : kind === "server"
          ? "A server"
          : "An unknown";

    return {
      error: `${kind}_error`,
      error_description: `${who} error occured.\nHttp status code: ${data.statusCode}\nHttp status message: ${data.statusMessage || "Unknown"}\nHeaders: ${JSON.stringify(data.headers)}`,
    };
  }
}

/*
 * An error MSAL hands on as it is (an AuthError) for one that would lose
 * its words to MSAL's own "network_error": the proxy's refusal, with what
 * ProxyTunnelRefusal reads from one, and a proxy setting this server
 * cannot use. Any other error is left as it is.
 */
function asTokenRequestError(error: unknown): unknown {
  if (error instanceof OutboundProxyRefusal) {
    return Object.assign(new AuthError(error.code, error.message), {
      message: error.message,
      code: error.code,
      destination: error.destination,
      statusCode: error.statusCode,
      reason: error.reason,
    });
  }

  if (error instanceof BadDataException) {
    return Object.assign(
      new AuthError("outbound_proxy_setting", error.message),
      {
        message: error.message,
      },
    );
  }

  return error;
}

/*
 * MSAL's network for the bot's token requests: what its own network client
 * sends, sent on the outbound proxy's route.
 */
export class BotFrameworkTokenNetwork implements INetworkModule {
  public async sendGetRequestAsync<T>(
    url: string,
    options?: NetworkRequestOptions,
    timeout?: number,
  ): Promise<NetworkResponse<T>> {
    return await BotFrameworkTokenNetwork.send<T>({
      url: url,
      method: "GET",
      options: options,
      timeout: timeout,
    });
  }

  public async sendPostRequestAsync<T>(
    url: string,
    options?: NetworkRequestOptions,
  ): Promise<NetworkResponse<T>> {
    return await BotFrameworkTokenNetwork.send<T>({
      url: url,
      method: "POST",
      options: options,
    });
  }

  private static async send<T>(data: {
    url: string;
    method: "GET" | "POST";
    options?: NetworkRequestOptions | undefined;
    // For a GET alone, as MSAL's own network times one out.
    timeout?: number | undefined;
  }): Promise<NetworkResponse<T>> {
    const target: URL = new URL(data.url);
    const destination: string = OutboundProxyRefusal.destinationOf(target);
    let proxy: URL | null;
    let agent: http.Agent;

    try {
      proxy = OutboundProxyAgents.getProxyFor(target);
      agent = OutboundProxyAgents.getSharedAgentFor(target);
    } catch (error) {
      throw asTokenRequestError(error);
    }

    const body: string = data.options?.body || "";
    const headers: http.OutgoingHttpHeaders = {
      ...(data.options?.headers || {}),
      ...(data.method === "POST"
        ? { "Content-Length": Buffer.byteLength(body) }
        : {}),
    };
    const timeout: number | undefined =
      data.method === "GET" && data.timeout ? data.timeout : undefined;

    return await new Promise<NetworkResponse<T>>(
      (
        resolve: (response: NetworkResponse<T>) => void,
        reject: (error: unknown) => void,
      ): void => {
        const request: http.ClientRequest = (
          target.protocol === "https:" ? https : http
        ).request(target, {
          method: data.method,
          headers: headers,
          agent: agent,
          ...(timeout ? { timeout: timeout } : {}),
        });

        request.on("timeout", (): void => {
          request.destroy();
          reject(new Error("Request time out"));
        });

        request.on("error", (error: Error): void => {
          reject(
            asTokenRequestError(
              OutboundProxyRefusal.fromTunnelError(error, destination) || error,
            ),
          );
        });

        request.on("response", (response: http.IncomingMessage): void => {
          const chunks: Array<Buffer> = [];

          response.on("data", (chunk: Buffer): void => {
            chunks.push(chunk);
          });

          response.on("error", (error: Error): void => {
            reject(error);
          });

          response.on("end", (): void => {
            const statusCode: number = response.statusCode || 0;

            // A request the proxy forwards (http) is refused with a 407 answer.
            if (proxy && target.protocol === "http:" && statusCode === 407) {
              reject(
                asTokenRequestError(
                  new OutboundProxyRefusal({
                    destination: destination,
                    statusCode: statusCode,
                  }),
                ),
              );
              return;
            }

            resolve({
              headers: response.headers as Record<string, string>,
              body: parseBody({
                statusCode: statusCode,
                statusMessage: response.statusMessage,
                headers: response.headers,
                body: Buffer.concat(chunks).toString(),
              }) as T,
              status: statusCode,
            });
          });
        });

        if (data.method === "POST") {
          request.write(body);
        }

        request.end();
      },
    );
  }
}

/*
 * The bot's credentials, as the SDK's own factory chooses them from the
 * bot's settings, with their tokens asked for on BotFrameworkTokenNetwork.
 */
export default class BotFrameworkCredentialsFactory
  implements ServiceClientCredentialsFactory
{
  private readonly configured: ConfigurationServiceClientCredentialFactory;
  private readonly network: BotFrameworkTokenNetwork =
    new BotFrameworkTokenNetwork();
  // One MSAL client per authority, as MSAL keeps what it learns per client.
  private readonly clients: Map<string, ConfidentialClientApplication> =
    new Map<string, ConfidentialClientApplication>();

  public constructor(
    options: ConfigurationServiceClientCredentialFactoryOptions,
  ) {
    this.configured = new ConfigurationServiceClientCredentialFactory(options);
  }

  public async isValidAppId(appId: string): Promise<boolean> {
    return await this.configured.isValidAppId(appId);
  }

  public async isAuthenticationDisabled(): Promise<boolean> {
    return await this.configured.isAuthenticationDisabled();
  }

  /*
   * The credentials the SDK's factory makes for these arguments - for the
   * authority (oAuthEndpoint) and scope (oAuthScope) it chooses - asking
   * for their tokens on the outbound proxy's route. An app password's
   * credentials are the only ones that ask for tokens here; credentials
   * that ask for none (no app id, authentication off) are handed on as
   * they are.
   */
  public async createCredentials(
    appId: string,
    audience: string | undefined,
    loginEndpoint: string,
    validateAuthority: boolean,
  ): Promise<ServiceClientCredentials> {
    const credentials: ServiceClientCredentials =
      await this.configured.createCredentials(
        appId,
        // Its types ask for a string; it reads none as its default scope.
        audience as string,
        loginEndpoint,
        validateAuthority,
      );

    if (credentials instanceof MicrosoftAppCredentials && credentials.appId) {
      const routed: MsalAppCredentials = new MsalAppCredentials(
        this.getClient(credentials),
        credentials.appId,
        credentials.oAuthEndpoint,
        credentials.oAuthScope,
      );

      /*
       * What it signs in at, for whoever reads it: handed a client of its
       * own, MsalAppCredentials says the default tenant's sign-in.
       */
      routed.oAuthEndpoint = credentials.oAuthEndpoint;

      return routed;
    }

    if ((credentials as { appId?: unknown }).appId) {
      throw new BadDataException(
        "The Microsoft Teams bot signs in to Microsoft Entra ID with its app password alone: credentials of another kind would ask for their tokens past the outbound proxy.",
      );
    }

    return credentials;
  }

  private getClient(
    credentials: MicrosoftAppCredentials,
  ): ConfidentialClientApplication {
    const key: string = `${credentials.oAuthEndpoint}\n${credentials.appId}`;
    let client: ConfidentialClientApplication | undefined =
      this.clients.get(key);

    if (!client) {
      // As MsalAppCredentials makes its own, with the route's network.
      client = new ConfidentialClientApplication({
        auth: {
          clientId: credentials.appId,
          clientSecret: credentials.appPassword,
          authority: credentials.oAuthEndpoint,
        },
        system: { networkClient: this.network },
      });
      this.clients.set(key, client);
    }

    return client;
  }
}
