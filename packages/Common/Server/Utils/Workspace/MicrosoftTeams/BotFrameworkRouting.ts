import BotConnectorHttpClient from "./BotConnectorHttpClient";
import BotFrameworkOpenIdMetadata from "./BotFrameworkOpenIdMetadata";
import BotFrameworkCredentialsFactory from "./BotFrameworkTokenRequests";
import {
  ConfigurationBotFrameworkAuthentication,
  ConfigurationBotFrameworkAuthenticationOptions,
  ConnectorClient,
  TeamDetails,
  TeamsConnectorClient,
  TurnContext,
  type ConnectorClientOptions,
} from "./Botbuilder";

/*
 * THE MICROSOFT TEAMS BOT'S REQUESTS, EACH ON THE OUTBOUND PROXY'S ROUTE
 * (issue #10763).
 *
 * The bot sends with the Bot Framework SDK's own HTTP clients, three of
 * them, and none took the route every other request of the server takes
 * (OutboundProxyAgents.getProxyFor: HTTPS_PROXY, HTTP_PROXY or ALL_PROXY,
 * apart from the hosts NO_PROXY names, signed in with the proxy's user
 * name and password decoded). Where the internet is reachable only
 * through a proxy, the bot failed every message from Teams at its token
 * check. Each one is routed here, through the SDK's own ways in:
 *
 *   1. The token check of every incoming activity: the Bot Framework's
 *      OpenID metadata and signing keys, which the SDK fetched with
 *      node-fetch. Its cache of them is handed metadata fetched with
 *      OutboundFetch (BotFrameworkOpenIdMetadata).
 *   2. The bot's tokens, from Microsoft Entra ID, which the SDK asked for
 *      with @azure/msal-node's own network. Its credentials come from a
 *      factory whose MSAL client sends on OutboundProxyAgents
 *      (BotFrameworkTokenRequests).
 *   3. Its replies and everything else it sends to the Bot Connector,
 *      which the SDK sent with @azure/core-rest-pipeline on its own proxy
 *      policy. Its connector clients are given an HttpClient on
 *      OutboundProxyAgents (BotConnectorHttpClient), through the
 *      ConnectorClientOptions the authentication hands every client it
 *      makes; the TeamsConnectorClient botbuilder's TeamsInfo makes for
 *      itself takes none, so the one TeamsInfo call that makes one is made
 *      here instead (getTeamDetails).
 *
 * The SDK's Skills client (botFrameworkClientFetch, axios) is not routed:
 * OneUptime never calls another bot. BotFrameworkRoutingGuard holds the
 * bot to all of this: the adapter is made from createAuthentication, and
 * nothing makes a client of the SDK's another way.
 *
 * With no proxy set at all, every request goes directly, as it did.
 */
export default class BotFrameworkRouting {
  private static httpClient: BotConnectorHttpClient | null = null;

  /*
   * The Bot Framework authentication the bot's adapter is made from: the
   * SDK's ConfigurationBotFrameworkAuthentication, for the settings given,
   * with each of its requests routed.
   */
  public static createAuthentication(
    options: ConfigurationBotFrameworkAuthenticationOptions,
  ): ConfigurationBotFrameworkAuthentication {
    BotFrameworkOpenIdMetadata.routeEveryDocument();

    return new ConfigurationBotFrameworkAuthentication(
      options,
      new BotFrameworkCredentialsFactory(options),
      // The SDK's own: no endorsements of its own, no claims checked.
      undefined,
      // Skills, which OneUptime never calls.
      undefined,
      BotFrameworkRouting.getConnectorClientOptions(),
    );
  }

  // What every connector client of the bot is made with: its HttpClient.
  public static getConnectorClientOptions(): ConnectorClientOptions {
    return { httpClient: BotFrameworkRouting.getHttpClient() };
  }

  public static getHttpClient(): BotConnectorHttpClient {
    if (!BotFrameworkRouting.httpClient) {
      BotFrameworkRouting.httpClient = new BotConnectorHttpClient();
    }

    return BotFrameworkRouting.httpClient;
  }

  /*
   * TeamsInfo.getTeamDetails, on the bot's HttpClient: the team this turn's
   * activity came from (its channelData.team.id), or the one named, read
   * from the Bot Connector with the turn's own credentials. TeamsInfo makes
   * a TeamsConnectorClient of its own for it, with no options to route.
   */
  public static async getTeamDetails(
    turnContext: TurnContext,
    teamId?: string | undefined,
  ): Promise<TeamDetails> {
    const team: unknown = (
      turnContext.activity.channelData as
        | { team?: { id?: unknown } }
        | undefined
    )?.team?.id;
    const id: string | undefined =
      teamId || (typeof team === "string" ? team : undefined);

    if (!id) {
      throw new Error(
        "This method is only valid within the scope of a MS Teams Team.",
      );
    }

    const connector: ConnectorClient | undefined = turnContext.turnState.get(
      turnContext.adapter.ConnectorClientKey,
    );

    if (!connector) {
      throw new Error("This method requires a connector client.");
    }

    const client: TeamsConnectorClient = new TeamsConnectorClient(
      connector.credentials,
      {
        baseUri: turnContext.activity.serviceUrl,
        ...BotFrameworkRouting.getConnectorClientOptions(),
      },
    );

    return await client.teams.fetchTeamDetails(id);
  }
}
