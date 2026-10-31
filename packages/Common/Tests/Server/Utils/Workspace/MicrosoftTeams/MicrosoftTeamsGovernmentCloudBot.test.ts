import { afterEach, describe, expect, jest, test } from "@jest/globals";
import crypto from "crypto";

/*
 * THE TEAMS BOT IN A US GOVERNMENT CLOUD, THROUGH THE REAL BOT FRAMEWORK SDK.
 *
 * A Teams bot for GCC High or DoD is registered in Azure Government, and
 * every request Teams sends it carries a token Azure Government's Bot
 * Framework signed (issuer https://api.botframework.us), checked against
 * its keys at login.botframework.azure.us; the bot sends with tokens from
 * login.microsoftonline.us for https://api.botframework.us. The commercial
 * cloud's settings refuse all of that. With MICROSOFT_TEAMS_CLOUD set to
 * gcc-high or dod, OneUptime gives the SDK the Bot Framework's US
 * Government channel (MicrosoftTeamsUtil.getBotAuthenticationOptions), and
 * the SDK takes its government settings from it.
 *
 * Here, with the real botbuilder (RealBotbuilder): the options for each
 * cloud; the settings the SDK reads from them, held to the Bot Framework
 * discovery documents each cloud answered with (MicrosoftCloudRecordedAnswers);
 * a request signed as Azure Government's Bot Framework signs one, accepted
 * in GCC High and DoD and refused by a commercial bot - and the other way
 * round; and where the bot gets its tokens to send. Nothing leaves the
 * process: the signing keys are this test's own, put where the SDK keeps
 * the keys it fetched.
 */

jest.mock("botbuilder", () => {
  return (
    jest.requireActual("../../../../Helpers/RealBotbuilder") as {
      loadRealBotbuilder: (fromFile: string) => unknown;
    }
  ).loadRealBotbuilder(__filename);
});

const APP_ID: string = "3f1a8c52-7d0e-4b9a-9d61-2c4b5e6f7a80";
const APP_TENANT_ID: string = "0d3b1c0e-58f1-4bd1-8bb0-2b0f6f3f6c11";

const environment: Record<string, string | null> = {
  MicrosoftTeamsAppClientId: APP_ID,
  MicrosoftTeamsAppClientSecret: "teams-client-secret",
  MicrosoftTeamsAppTenantId: APP_TENANT_ID,
  MicrosoftTeamsCloudSetting: null,
};

jest.mock("../../../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  return new Proxy(actual, {
    get: (target: Record<string, unknown>, key: string | symbol): unknown => {
      if (typeof key === "string" && key in environment) {
        return environment[key];
      }

      return target[key as string];
    },
  });
});

import MicrosoftTeamsUtil from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import { getNativeRequire } from "../../../../Helpers/RealBotbuilder";
import {
  RECORDED_BOT_FRAMEWORK_DISCOVERY,
  RecordedBotFrameworkDiscovery,
} from "../../../../Types/Workspace/MicrosoftCloudRecordedAnswers";
import { ConfigurationBotFrameworkAuthentication } from "botbuilder";

// The real Bot Framework connector, from the same loader as the real botbuilder.
const nativeRequire: NodeJS.Require = getNativeRequire(__filename);

interface GovernmentConstantsShape {
  ChannelService: string;
  ToChannelFromBotOAuthScope: string;
  ToBotFromChannelTokenIssuer: string;
  ToBotFromChannelOpenIdMetadataUrl: string;
}

const connector: {
  GovernmentConstants: GovernmentConstantsShape;
  AuthenticationConstants: {
    ToChannelFromBotOAuthScope: string;
    ToBotFromChannelTokenIssuer: string;
    ToBotFromChannelOpenIdMetadataUrl: string;
  };
} = nativeRequire("botframework-connector") as never;

// Where the SDK keeps the signing keys it fetched, one entry per metadata URL.
const openIdMetadataCache: Map<string, unknown> = (
  nativeRequire("botframework-connector/lib/auth/jwtTokenExtractor") as {
    JwtTokenExtractor: { openIdMetadataCache: Map<string, unknown> };
  }
).JwtTokenExtractor.openIdMetadataCache;

const recordedBotFramework: (
  origin: string,
) => RecordedBotFrameworkDiscovery = (
  origin: string,
): RecordedBotFrameworkDiscovery => {
  const recorded: RecordedBotFrameworkDiscovery | undefined =
    RECORDED_BOT_FRAMEWORK_DISCOVERY.find(
      (discovery: RecordedBotFrameworkDiscovery): boolean => {
        return new URL(discovery.source).origin === origin;
      },
    );

  expect(recorded).toBeDefined();

  return recorded!;
};

const COMMERCIAL_BOT_FRAMEWORK: RecordedBotFrameworkDiscovery =
  recordedBotFramework("https://login.botframework.com");
const GOVERNMENT_BOT_FRAMEWORK: RecordedBotFrameworkDiscovery =
  recordedBotFramework("https://login.botframework.azure.us");

// The SDK's settings, read where it keeps them.
interface SdkSettings {
  toChannelFromBotLoginUrl: string;
  toChannelFromBotOAuthScope: string;
  toBotFromChannelTokenIssuer: string;
  toBotFromChannelOpenIdMetadataUrl: string;
  callerId: string;
}

const setCloud: (value: string | null) => void = (
  value: string | null,
): void => {
  environment["MicrosoftTeamsCloudSetting"] = value;
};

const authenticationFor: (
  cloud: string | null,
) => ConfigurationBotFrameworkAuthentication = (
  cloud: string | null,
): ConfigurationBotFrameworkAuthentication => {
  setCloud(cloud);

  return new ConfigurationBotFrameworkAuthentication(
    MicrosoftTeamsUtil.getBotAuthenticationOptions(),
  );
};

const settingsOf: (
  authentication: ConfigurationBotFrameworkAuthentication,
) => SdkSettings = (
  authentication: ConfigurationBotFrameworkAuthentication,
): SdkSettings => {
  return (authentication as unknown as { inner: SdkSettings }).inner;
};

// ---- A Bot Framework of this test's own, signing as each cloud's does ----

const KEY_ID: string = "oneuptime-test-key";
const keys: { publicKey: crypto.KeyObject; privateKey: crypto.KeyObject } =
  crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });

const base64url: (value: Buffer | string) => string = (
  value: Buffer | string,
): string => {
  return Buffer.from(value).toString("base64url");
};

/*
 * A token as a cloud's Bot Framework signs one for a request from Teams:
 * its issuer, for this bot, naming the service the request came from.
 */
const signedRequestToken: (data: {
  issuer: string;
  serviceUrl: string;
  audience?: string | undefined;
}) => string = (data: {
  issuer: string;
  serviceUrl: string;
  audience?: string | undefined;
}): string => {
  const nowInSeconds: number = Math.floor(Date.now() / 1000);
  const header: string = base64url(
    JSON.stringify({ alg: "RS256", typ: "JWT", kid: KEY_ID }),
  );
  const payload: string = base64url(
    JSON.stringify({
      iss: data.issuer,
      aud: data.audience || APP_ID,
      serviceurl: data.serviceUrl,
      nbf: nowInSeconds - 60,
      exp: nowInSeconds + 3600,
    }),
  );
  const signature: string = base64url(
    crypto.sign(
      "RSA-SHA256",
      Buffer.from(`${header}.${payload}`),
      keys.privateKey,
    ),
  );

  return `${header}.${payload}.${signature}`;
};

/*
 * This test's signing key, put where the SDK keeps the keys it fetched for
 * each cloud's metadata - endorsed for Teams, as Microsoft's keys are - so
 * the SDK checks requests against it and fetches nothing.
 */
const trustTestKeyAt: (metadataUrl: string) => void = (
  metadataUrl: string,
): void => {
  const publicKey: string = keys.publicKey
    .export({ type: "spki", format: "pem" })
    .toString();

  openIdMetadataCache.set(metadataUrl, {
    getKey: async (
      keyId: string,
    ): Promise<{ key: string; endorsements: Array<string> } | null> => {
      return keyId === KEY_ID
        ? { key: publicKey, endorsements: ["msteams"] }
        : null;
    },
  });
};

const teamsActivity: (serviceUrl: string) => Record<string, unknown> = (
  serviceUrl: string,
): Record<string, unknown> => {
  return {
    type: "message",
    id: "activity-1",
    channelId: "msteams",
    serviceUrl: serviceUrl,
    from: {
      id: "29:person",
      aadObjectId: "a0a0a0a0-0000-4000-8000-000000000001",
    },
    recipient: { id: `28:${APP_ID}` },
    conversation: { id: "a:conversation", tenantId: APP_TENANT_ID },
    text: "help",
  };
};

const GOVERNMENT_SERVICE_URL: string =
  "https://smba.infra.gov.teams.microsoft.us/teams/";
const DOD_SERVICE_URL: string =
  "https://smba.infra.dod.teams.microsoft.us/teams/";
const COMMERCIAL_SERVICE_URL: string = "https://smba.trafficmanager.net/teams/";

afterEach(() => {
  setCloud(null);
  openIdMetadataCache.clear();
  jest.restoreAllMocks();
});

describe("the bot's options, cloud by cloud", () => {
  test("Commercial and GCC: no channel named, so the SDK uses Azure's public cloud, as before", () => {
    for (const cloud of [null, "commercial", "gcc"]) {
      setCloud(cloud);

      const options: Record<string, unknown> =
        MicrosoftTeamsUtil.getBotAuthenticationOptions();

      expect(options).toEqual({
        MicrosoftAppId: APP_ID,
        MicrosoftAppPassword: "teams-client-secret",
        MicrosoftAppType: "SingleTenant",
        MicrosoftAppTenantId: APP_TENANT_ID,
      });
      expect("ChannelService" in options).toBe(false);
    }
  });

  test("GCC High and DoD: the Bot Framework's US Government channel - the SDK's own constant for it", () => {
    for (const cloud of ["gcc-high", "dod"]) {
      setCloud(cloud);

      expect(MicrosoftTeamsUtil.getBotAuthenticationOptions()).toEqual({
        MicrosoftAppId: APP_ID,
        MicrosoftAppPassword: "teams-client-secret",
        MicrosoftAppType: "SingleTenant",
        MicrosoftAppTenantId: APP_TENANT_ID,
        ChannelService: connector.GovernmentConstants.ChannelService,
      });
    }
  });

  test("a setting that names no cloud builds no options at all: nothing is configured to send anywhere", () => {
    setCloud("gov");

    expect(() => {
      MicrosoftTeamsUtil.getBotAuthenticationOptions();
    }).toThrow(
      'MICROSOFT_TEAMS_CLOUD is "gov", which names no Microsoft cloud.',
    );
  });
});

describe("the settings the real SDK takes from them, held to what each cloud's Bot Framework answered", () => {
  test("Commercial: requests checked against login.botframework.com's keys for api.botframework.com", () => {
    const settings: SdkSettings = settingsOf(authenticationFor(null));

    expect(settings.toBotFromChannelTokenIssuer).toBe(
      COMMERCIAL_BOT_FRAMEWORK.issuer,
    );
    expect(settings.toBotFromChannelOpenIdMetadataUrl).toBe(
      COMMERCIAL_BOT_FRAMEWORK.source,
    );
    expect(settings.toChannelFromBotOAuthScope).toBe(
      "https://api.botframework.com",
    );
    expect(settings.callerId).toBe("urn:botframework:azure");
  });

  test.each(["gcc-high", "dod"])(
    "%s: requests checked against login.botframework.azure.us's keys for api.botframework.us, and tokens to send from login.microsoftonline.us",
    (cloud: string) => {
      const settings: SdkSettings = settingsOf(authenticationFor(cloud));

      expect(settings.toBotFromChannelTokenIssuer).toBe(
        GOVERNMENT_BOT_FRAMEWORK.issuer,
      );
      expect(settings.toBotFromChannelOpenIdMetadataUrl).toBe(
        GOVERNMENT_BOT_FRAMEWORK.source,
      );
      expect(new URL(settings.toChannelFromBotLoginUrl).origin).toBe(
        "https://login.microsoftonline.us",
      );
      expect(settings.toChannelFromBotOAuthScope).toBe(
        "https://api.botframework.us",
      );
      expect(settings.callerId).toBe("urn:botframework:azureusgov");
    },
  );
});

describe("a request from Teams, signed as each cloud's Bot Framework signs one", () => {
  test.each([
    ["gcc-high", GOVERNMENT_SERVICE_URL],
    ["dod", DOD_SERVICE_URL],
  ])(
    "%s: Azure Government's request is taken, and answered with tokens Azure Government issues",
    async (cloud: string, serviceUrl: string) => {
      trustTestKeyAt(GOVERNMENT_BOT_FRAMEWORK.source);

      const authentication: ConfigurationBotFrameworkAuthentication =
        authenticationFor(cloud);
      const result: {
        claimsIdentity: { isAuthenticated: boolean };
        callerId: string;
        audience: string;
        connectorFactory: {
          create: (
            serviceUrl: string,
            audience: string,
          ) => Promise<{ credentials: unknown }>;
        };
      } = (await authentication.authenticateRequest(
        teamsActivity(serviceUrl) as never,
        `Bearer ${signedRequestToken({
          issuer: GOVERNMENT_BOT_FRAMEWORK.issuer,
          serviceUrl: serviceUrl,
        })}`,
      )) as never;

      expect(result.claimsIdentity.isAuthenticated).toBe(true);
      expect(result.callerId).toBe("urn:botframework:azureusgov");
      expect(result.audience).toBe("https://api.botframework.us");

      // Answering: the token for it is asked from Azure Government's sign-in.
      const client: { credentials: unknown } =
        await result.connectorFactory.create(serviceUrl, result.audience);
      const credentials: { oAuthEndpoint: string; oAuthScope: string } =
        client.credentials as { oAuthEndpoint: string; oAuthScope: string };

      expect(credentials.oAuthEndpoint).toBe(
        `https://login.microsoftonline.us/${APP_TENANT_ID}`,
      );
      expect(credentials.oAuthScope).toBe("https://api.botframework.us");
    },
  );

  test("a commercial bot refuses Azure Government's request: its issuer is not the commercial Bot Framework", async () => {
    jest.spyOn(console, "error").mockImplementation((): void => {
      return undefined;
    });
    trustTestKeyAt(COMMERCIAL_BOT_FRAMEWORK.source);
    trustTestKeyAt(GOVERNMENT_BOT_FRAMEWORK.source);

    await expect(
      authenticationFor(null).authenticateRequest(
        teamsActivity(GOVERNMENT_SERVICE_URL) as never,
        `Bearer ${signedRequestToken({
          issuer: GOVERNMENT_BOT_FRAMEWORK.issuer,
          serviceUrl: GOVERNMENT_SERVICE_URL,
        })}`,
      ),
    ).rejects.toThrow("Unauthorized");
  });

  test("a GCC High bot refuses the commercial cloud's request", async () => {
    jest.spyOn(console, "error").mockImplementation((): void => {
      return undefined;
    });
    trustTestKeyAt(COMMERCIAL_BOT_FRAMEWORK.source);
    trustTestKeyAt(GOVERNMENT_BOT_FRAMEWORK.source);

    await expect(
      authenticationFor("gcc-high").authenticateRequest(
        teamsActivity(COMMERCIAL_SERVICE_URL) as never,
        `Bearer ${signedRequestToken({
          issuer: COMMERCIAL_BOT_FRAMEWORK.issuer,
          serviceUrl: COMMERCIAL_SERVICE_URL,
        })}`,
      ),
    ).rejects.toThrow("Unauthorized");
  });

  test("a commercial bot still takes the commercial cloud's request, as before", async () => {
    trustTestKeyAt(COMMERCIAL_BOT_FRAMEWORK.source);

    const result: { claimsIdentity: { isAuthenticated: boolean } } =
      (await authenticationFor(null).authenticateRequest(
        teamsActivity(COMMERCIAL_SERVICE_URL) as never,
        `Bearer ${signedRequestToken({
          issuer: COMMERCIAL_BOT_FRAMEWORK.issuer,
          serviceUrl: COMMERCIAL_SERVICE_URL,
        })}`,
      )) as never;

    expect(result.claimsIdentity.isAuthenticated).toBe(true);
  });

  test("in GCC High, a request signed for another bot is refused", async () => {
    jest.spyOn(console, "error").mockImplementation((): void => {
      return undefined;
    });
    trustTestKeyAt(GOVERNMENT_BOT_FRAMEWORK.source);

    await expect(
      authenticationFor("gcc-high").authenticateRequest(
        teamsActivity(GOVERNMENT_SERVICE_URL) as never,
        `Bearer ${signedRequestToken({
          issuer: GOVERNMENT_BOT_FRAMEWORK.issuer,
          serviceUrl: GOVERNMENT_SERVICE_URL,
          audience: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
        })}`,
      ),
    ).rejects.toThrow("Unauthorized");
  });
});
