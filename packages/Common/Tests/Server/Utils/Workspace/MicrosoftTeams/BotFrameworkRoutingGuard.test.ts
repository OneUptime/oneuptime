import {
  PACKAGES_ROOT,
  codeOf,
  relative,
  serverSourceFiles,
} from "../../../TestingUtils/ServerSourceFiles";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE TEAMS BOT'S REQUESTS STAY ON THE OUTBOUND PROXY'S ROUTE (issue
 * #10763).
 *
 * The Bot Framework SDK sends with three HTTP stacks of its own - node-fetch
 * for the keys it checks each incoming message's token with, msal-node for
 * the bot's tokens, @azure/core-rest-pipeline for everything it sends the
 * Bot Connector - and none took the route every other request of the
 * server takes. BotFrameworkRouting hands the SDK a routed piece for each,
 * through the SDK's own ways in, and the bot's adapter is made from it.
 * This reads the server's code and fails on:
 *
 *   - the bot's adapter made from anything but
 *     BotFrameworkRouting.createAuthentication;
 *   - the SDK's authentication, credentials, token clients or connector
 *     clients made anywhere but the routing's own files, where they are
 *     made routed;
 *   - a TeamsInfo method that makes a TeamsConnectorClient for itself,
 *     with no options to route, called anywhere: read from botbuilder's own
 *     teamsInfo.js, so a method of that kind is never missed;
 *   - one of the routing's hooks gone from its file.
 *
 * And it reads the SDK where the routing reaches into it, so a botbuilder
 * that no longer reads what it is handed fails here first: botbuilder
 * 4.23.3 is the last release there will be (Microsoft archived
 * botbuilder-js in January 2026), so a change would be a fork's or a
 * patch's. The suites in App/Tests/OutboundProxy send the bot's requests
 * through real proxies.
 */

const SERVER_FILES: Array<string> = serverSourceFiles();

const TEAMS_FOLDER: string =
  "packages/Common/Server/Utils/Workspace/MicrosoftTeams";
const ROUTING: string = `${TEAMS_FOLDER}/BotFrameworkRouting.ts`;
const TOKEN_REQUESTS: string = `${TEAMS_FOLDER}/BotFrameworkTokenRequests.ts`;
const OPEN_ID_METADATA: string = `${TEAMS_FOLDER}/BotFrameworkOpenIdMetadata.ts`;
const CONNECTOR_HTTP_CLIENT: string = `${TEAMS_FOLDER}/BotConnectorHttpClient.ts`;
const MICROSOFT_TEAMS: string = `${TEAMS_FOLDER}/MicrosoftTeams.ts`;

const COMMON_NODE_MODULES: string = path.join(
  PACKAGES_ROOT,
  "Common",
  "node_modules",
);

/*
 * What the SDK's pieces are made with, and the only files that may make
 * them: each there routed. Anything made elsewhere would send on the SDK's
 * own stack.
 */
const MADE_ONLY_IN: Record<string, Array<string>> = {
  "new ConfigurationBotFrameworkAuthentication(": [ROUTING],
  "new CloudAdapter(": [MICROSOFT_TEAMS],
  "new ConnectorClient(": [],
  "new TeamsConnectorClient(": [ROUTING],
  "new TokenApiClient(": [],
  "new BotFrameworkAdapter(": [],
  "new BotFrameworkHttpClient(": [],
  "new ConfigurationServiceClientCredentialFactory(": [TOKEN_REQUESTS],
  "new PasswordServiceClientCredentialFactory(": [],
  "new MsalServiceClientCredentialsFactory(": [],
  "new MicrosoftAppCredentials(": [],
  "new MicrosoftGovernmentAppCredentials(": [],
  "new MsalAppCredentials(": [TOKEN_REQUESTS],
  "new ConfidentialClientApplication(": [TOKEN_REQUESTS],
};

// How each hook of the routing reads in its file.
const HOOKS: Record<string, Array<string>> = {
  [MICROSOFT_TEAMS]: [
    "BotFrameworkRouting.createAuthentication(",
    "const adapter: CloudAdapter = new CloudAdapter(botFrameworkAuthentication);",
    "await BotFrameworkRouting.getTeamDetails(",
  ],
  [ROUTING]: [
    "BotFrameworkOpenIdMetadata.routeEveryDocument();",
    "new BotFrameworkCredentialsFactory(options),",
    "BotFrameworkRouting.getConnectorClientOptions(),",
    "return { httpClient: BotFrameworkRouting.getHttpClient() };",
    "...BotFrameworkRouting.getConnectorClientOptions(),",
  ],
  [OPEN_ID_METADATA]: [
    "cache.set(url, new BotFrameworkOpenIdMetadata(url));",
    "await OutboundFetch.fetch(url);",
  ],
  [TOKEN_REQUESTS]: [
    "agent = OutboundProxyAgents.getSharedAgentFor(target);",
    "system: { networkClient: this.network },",
    "OutboundProxyRefusal.fromTunnelError(error, destination)",
  ],
  [CONNECTOR_HTTP_CLIENT]: [
    "request.agent = OutboundProxyAgents.getSharedAgentFor(url);",
    "OutboundProxyRefusal.fromTunnelError(error, destination)",
  ],
};

function read(file: string): string {
  return fs.readFileSync(file, "utf8");
}

function readLibrary(relativePath: string): string {
  return read(path.join(COMMON_NODE_MODULES, relativePath));
}

/*
 * The static methods of botbuilder's TeamsInfo that make a
 * TeamsConnectorClient of their own (this.getTeamsConnectorClient), from
 * its source.
 */
function teamsInfoMethodsWithTheirOwnClient(source: string): Array<string> {
  const method: RegExp = /^ {4}static (\w+)\(/gm;
  const starts: Array<{ name: string; at: number }> = [];
  let match: RegExpExecArray | null = method.exec(source);

  while (match) {
    starts.push({ name: match[1]!, at: match.index });
    match = method.exec(source);
  }

  return starts
    .filter((start: { name: string; at: number }, index: number): boolean => {
      const body: string = source.slice(
        start.at,
        index + 1 < starts.length ? starts[index + 1]!.at : source.length,
      );

      return (
        start.name !== "getTeamsConnectorClient" &&
        body.includes("this.getTeamsConnectorClient(")
      );
    })
    .map((start: { name: string; at: number }): string => {
      return start.name;
    });
}

describe("the Teams bot is made of the routed stacks", () => {
  test("the search reads the server's code, the Teams integration among it", () => {
    const files: Array<string> = SERVER_FILES.map(relative);

    expect(SERVER_FILES.length).toBeGreaterThan(1000);

    for (const file of [
      MICROSOFT_TEAMS,
      ROUTING,
      TOKEN_REQUESTS,
      OPEN_ID_METADATA,
      CONNECTOR_HTTP_CLIENT,
    ]) {
      expect(files).toContain(file);
    }
  });

  test("the SDK's authentication, credentials and clients are made only where they are made routed", () => {
    const madeElsewhere: Array<string> = [];
    const madeWhere: Record<string, Array<string>> = {};

    for (const file of SERVER_FILES) {
      const text: string = read(file);

      if (!text.includes("new ")) {
        continue;
      }

      const code: string = codeOf(text);

      for (const [made, allowed] of Object.entries(MADE_ONLY_IN)) {
        if (!code.includes(made)) {
          continue;
        }

        madeWhere[made] = [...(madeWhere[made] || []), relative(file)];

        if (!allowed.includes(relative(file))) {
          madeElsewhere.push(`${relative(file)}: ${made}`);
        }
      }
    }

    expect({
      madeElsewhere,
      fix: "Make the bot's authentication with BotFrameworkRouting.createAuthentication, and a connector client of the SDK's with BotFrameworkRouting.getConnectorClientOptions(): the SDK's own send around the outbound proxy.",
    }).toEqual({
      madeElsewhere: [],
      fix: "Make the bot's authentication with BotFrameworkRouting.createAuthentication, and a connector client of the SDK's with BotFrameworkRouting.getConnectorClientOptions(): the SDK's own send around the outbound proxy.",
    });

    // Each piece the routing makes is still made where it is listed.
    for (const [made, allowed] of Object.entries(MADE_ONLY_IN)) {
      expect({ made, where: (madeWhere[made] || []).sort() }).toEqual({
        made,
        where: [...allowed].sort(),
      });
    }
  });

  test("no file calls a TeamsInfo method that makes a TeamsConnectorClient of its own", () => {
    const ownClient: Array<string> = teamsInfoMethodsWithTheirOwnClient(
      readLibrary("botbuilder/lib/teamsInfo.js"),
    );

    // The detector reads botbuilder's methods: getTeamDetails among them.
    expect(ownClient).toEqual(
      expect.arrayContaining([
        "getTeamDetails",
        "getTeamChannels",
        "getMeetingInfo",
        "getMeetingParticipant",
        "sendMessageToListOfUsers",
      ]),
    );
    expect(ownClient).not.toContain("getPagedMembers");

    const calls: Array<string> = SERVER_FILES.flatMap(
      (file: string): Array<string> => {
        const text: string = read(file);

        if (!text.includes("TeamsInfo.")) {
          return [];
        }

        const code: string = codeOf(text);

        return ownClient
          .filter((name: string): boolean => {
            return code.includes(`TeamsInfo.${name}(`);
          })
          .map((name: string): string => {
            return `${relative(file)}: TeamsInfo.${name}`;
          });
      },
    );

    expect({
      calls,
      fix: "TeamsInfo makes a TeamsConnectorClient of its own for these, with no HttpClient to route: make one with BotFrameworkRouting.getConnectorClientOptions(), as BotFrameworkRouting.getTeamDetails does.",
    }).toEqual({
      calls: [],
      fix: "TeamsInfo makes a TeamsConnectorClient of its own for these, with no HttpClient to route: make one with BotFrameworkRouting.getConnectorClientOptions(), as BotFrameworkRouting.getTeamDetails does.",
    });
  });

  test("each hook of the routing is where it routes", () => {
    for (const [file, hooks] of Object.entries(HOOKS)) {
      const code: string = codeOf(read(path.join(PACKAGES_ROOT, "..", file)));

      for (const hook of hooks) {
        expect({ file, hook, present: code.includes(hook) }).toEqual({
          file,
          hook,
          present: true,
        });
      }
    }
  });
});

describe("the SDK still reads what the routing hands it", () => {
  test("botbuilder and botframework-connector are 4.23.3, the release these were read from", () => {
    for (const name of ["botbuilder", "botframework-connector"]) {
      expect({
        name,
        version: (
          JSON.parse(readLibrary(`${name}/package.json`)) as {
            version: string;
          }
        ).version,
      }).toEqual({ name, version: "4.23.3" });
    }
  });

  test("every token check reads its keys from the cache, one OpenID metadata per document URL", () => {
    const extractor: string = readLibrary(
      "botframework-connector/lib/auth/jwtTokenExtractor.js",
    );

    expect(extractor).toContain(
      "this.openIdMetadata = JwtTokenExtractor.getOrAddOpenIdMetadata(metadataUrl, proxySettings, tokenRefreshInterval);",
    );
    expect(extractor).toContain(
      "let metadata = this.openIdMetadataCache.get(metadataUrl);",
    );
    expect(extractor).toContain(
      "const metadata = yield this.openIdMetadata.getKey(keyId);",
    );
    expect(extractor).toContain(
      "JwtTokenExtractor.openIdMetadataCache = new Map();",
    );
  });

  test("the bot's credentials come from the factory it is handed, and MSAL's client from the credentials", () => {
    const authentication: string = readLibrary(
      "botbuilder-core/lib/configurationBotFrameworkAuthentication.js",
    );
    const credentials: string = readLibrary(
      "botframework-connector/lib/auth/msalAppCredentials.js",
    );

    expect(authentication).toContain(
      "credentialsFactory !== null && credentialsFactory !== void 0 ? credentialsFactory : new configurationServiceClientCredentialFactory_1.ConfigurationServiceClientCredentialFactory(typedBotFrameworkAuthConfig)",
    );
    expect(credentials).toContain(
      "this.clientApplication = maybeClientApplicationOrAppId;",
    );
  });

  test("every connector client the SDK makes is handed the ConnectorClientOptions, and takes their HttpClient", () => {
    const factory: string = readLibrary(
      "botframework-connector/lib/auth/connectorFactoryImpl.js",
    );
    const userTokens: string = readLibrary(
      "botframework-connector/lib/auth/userTokenClientImpl.js",
    );
    const context: string = readLibrary(
      "botbuilder-stdlib/lib/azureCoreHttpCompat/serviceClientContext.js",
    );
    const nodeClient: string = readLibrary(
      "@typespec/ts-http-runtime/dist/commonjs/nodeHttpClient.js",
    );

    expect(factory).toContain(
      "const options = Object.assign(Object.assign({}, this.connectorClientOptions)",
    );
    expect(userTokens).toContain(
      "Object.assign({ baseUri: oauthEndpoint }, connectorClientOptions)",
    );
    expect(context).toContain(
      "httpClient: httpClient ? (0, core_http_compat_1.convertHttpClient)(httpClient) : undefined,",
    );
    // The agent set on a request is the one it is sent on.
    expect(nodeClient).toContain(
      "const agent = request.agent ?? this.getOrCreateAgent(request, isInsecure);",
    );
  });

  test("TeamsInfo's own TeamsConnectorClient takes no options: why getTeamDetails is made here", () => {
    expect(readLibrary("botbuilder/lib/teamsInfo.js")).toContain(
      "return new botframework_connector_1.TeamsConnectorClient(connectorClient.credentials, { baseUri: context.activity.serviceUrl });",
    );
  });
});
