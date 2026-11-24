import crypto from "crypto";
import OutboundFetch from "../../OutboundFetch";
import {
  AuthenticationConstants,
  AuthenticationError,
  GovernmentConstants,
  JwtTokenExtractor,
  StatusCodes,
} from "./Botbuilder";

/*
 * THE KEYS THE TEAMS BOT CHECKS EACH INCOMING MESSAGE WITH, FETCHED ON THE
 * OUTBOUND PROXY'S ROUTE (issue #10763).
 *
 * Every activity Microsoft Teams posts to the bot carries a token the Bot
 * Framework signed, and the Bot Framework SDK (botframework-connector)
 * checks it against the keys the Bot Framework publishes: an OpenID
 * configuration document, such as
 * https://login.botframework.com/v1/.well-known/openidconfiguration in
 * Azure's public cloud, and the key set its jwks_uri names. The SDK's own
 * OpenIdMetadata fetches both with node-fetch, through a proxy only when
 * it is handed proxySettings, and then by the proxy's host and port alone:
 * never the proxy the environment names, never NO_PROXY, never a user name
 * or password. So on a server that reaches the internet only through an
 * outbound proxy, every message from Teams failed its token check, and the
 * bot answered none of them.
 *
 * The SDK keeps one OpenID metadata per document URL, in
 * JwtTokenExtractor's cache, and every token check reads its keys from
 * there: a channel's, the Emulator's, a skill's and an App Service
 * Environment's alike. routeEveryDocument() puts one of these there for
 * each document the SDK's two clouds (Azure's public cloud and Azure
 * Government) name, before the bot's adapter checks a token, so both
 * documents are fetched with OutboundFetch: on the route
 * OutboundProxyAgents.getProxyFor decides for their URL, NO_PROXY
 * included, signed in to the proxy with its user name and password
 * decoded, and refused, when the proxy refuses them, in words that never
 * name the proxy. The check itself - the issuer, the audience, the
 * endorsements, the service URL claim, the signing algorithms - is the
 * SDK's own, untouched.
 *
 * Why this, and not the SDK's other ways in: its proxySettings carry a
 * host and a port and nothing else, so a proxy that checks a password
 * refuses every fetch, and they would send every document through the one
 * proxy whatever NO_PROXY says; and a BotFrameworkAuthentication of
 * OneUptime's own would mean writing the SDK's token checks again, to
 * change the one line that fetches.
 *
 * getKey answers as the SDK's OpenIdMetadata answers: the keys are fetched
 * again once they are 24 hours old, and for a key they do not hold at most
 * once an hour; a key without an RSA modulus and exponent is none; a key's
 * endorsements are handed on as published; a document that does not load
 * fails the check with the SDK's words (AuthenticationError, 500).
 * Requests that need the keys at the same moment wait for one fetch.
 */

// A key of a key set, as the Bot Framework publishes it (RFC 7517).
interface PublishedKey {
  kid?: unknown;
  n?: unknown;
  e?: unknown;
  endorsements?: unknown;
}

// What the SDK's token check reads for a key: as its OpenIdMetadata gives it.
export interface BotFrameworkSigningKey {
  // The public key, as PEM.
  key: string;
  // The channels the key may sign for ("msteams"), as published.
  endorsements?: Array<string> | undefined;
}

// What the SDK's token check asks of a document's metadata, and no more.
export interface OpenIdMetadataLike {
  getKey: (keyId: string) => Promise<BotFrameworkSigningKey | null>;
}

const HOUR_IN_MS: number = 60 * 60 * 1000;

// The SDK's default: the keys are fetched again once a day.
const DEFAULT_REFRESH_INTERVAL_IN_HOURS: number = 24;

export default class BotFrameworkOpenIdMetadata implements OpenIdMetadataLike {
  public readonly url: string;

  private readonly refreshIntervalInHours: number;
  private keys: Array<PublishedKey> | null = null;
  // When the keys were last fetched, in milliseconds; 0 for never.
  private lastUpdated: number = 0;
  private refreshing: Promise<void> | null = null;

  public constructor(
    url: string,
    refreshIntervalInHours: number = DEFAULT_REFRESH_INTERVAL_IN_HOURS,
  ) {
    this.url = url;
    this.refreshIntervalInHours = refreshIntervalInHours;
  }

  /*
   * The OpenID configuration documents the SDK reads its keys from, in
   * either cloud: a channel's tokens (Teams'), and the Emulator's, which
   * skill and App Service Environment tokens are checked against too.
   */
  public static getDocumentUrls(): Array<string> {
    return [
      AuthenticationConstants.ToBotFromChannelOpenIdMetadataUrl,
      AuthenticationConstants.ToBotFromEmulatorOpenIdMetadataUrl,
      GovernmentConstants.ToBotFromChannelOpenIdMetadataUrl,
      GovernmentConstants.ToBotFromEmulatorOpenIdMetadataUrl,
    ];
  }

  /*
   * The SDK's cache of OpenID metadata, one per document URL, which every
   * token check reads its keys from. JwtTokenExtractor keeps it to itself
   * (private static in its types); botbuilder 4.23.3 is the last release
   * there will be, and BotFrameworkRoutingGuard holds it to what this reads.
   */
  public static getSdkCache(): Map<string, unknown> {
    return (
      JwtTokenExtractor as unknown as {
        openIdMetadataCache: Map<string, unknown>;
      }
    ).openIdMetadataCache;
  }

  /*
   * Puts metadata of this kind in the SDK's cache for each of its
   * documents, in place of the SDK's own, so every token check fetches its
   * keys on the outbound proxy's route. Run before the bot's adapter checks
   * a token; running it again changes nothing.
   */
  public static routeEveryDocument(): void {
    const cache: Map<string, unknown> =
      BotFrameworkOpenIdMetadata.getSdkCache();

    for (const url of BotFrameworkOpenIdMetadata.getDocumentUrls()) {
      if (!(cache.get(url) instanceof BotFrameworkOpenIdMetadata)) {
        cache.set(url, new BotFrameworkOpenIdMetadata(url));
      }
    }
  }

  // The key a token names, or null when the key set holds no usable one.
  public async getKey(keyId: string): Promise<BotFrameworkSigningKey | null> {
    if (
      this.lastUpdated <
      Date.now() - this.refreshIntervalInHours * HOUR_IN_MS
    ) {
      await this.refresh();

      return this.findKey(keyId);
    }

    const key: BotFrameworkSigningKey | null = this.findKey(keyId);

    // A key the set does not hold yet: fetched again, at most once an hour.
    if (!key && this.lastUpdated < Date.now() - HOUR_IN_MS) {
      await this.refresh();

      return this.findKey(keyId);
    }

    return key;
  }

  private async refresh(): Promise<void> {
    if (!this.refreshing) {
      this.refreshing = this.load().finally((): void => {
        this.refreshing = null;
      });
    }

    await this.refreshing;
  }

  private async load(): Promise<void> {
    const configuration: unknown = await BotFrameworkOpenIdMetadata.fetchJson(
      this.url,
      "openID config",
    );
    const keySetUrl: unknown = (configuration as { jwks_uri?: unknown } | null)
      ?.jwks_uri;

    if (typeof keySetUrl !== "string" || !keySetUrl) {
      throw new AuthenticationError(
        "Failed to load Keys: the OpenID configuration names no jwks_uri",
        StatusCodes.INTERNAL_SERVER_ERROR,
      );
    }

    const keySet: unknown = await BotFrameworkOpenIdMetadata.fetchJson(
      keySetUrl,
      "Keys",
    );
    const keys: unknown = (keySet as { keys?: unknown } | null)?.keys;

    this.keys = Array.isArray(keys) ? (keys as Array<PublishedKey>) : [];
    this.lastUpdated = Date.now();
  }

  /*
   * A document, fetched on its route. One that does not load fails as the
   * SDK fails it: "Failed to load openID config: 404". A refusal of the
   * outbound proxy's fails with OutboundFetch's OutboundProxyRefusal.
   */
  private static async fetchJson(url: string, what: string): Promise<unknown> {
    const response: Response = await OutboundFetch.fetch(url);

    if (!response.ok) {
      throw new AuthenticationError(
        `Failed to load ${what}: ${response.status}`,
        StatusCodes.INTERNAL_SERVER_ERROR,
      );
    }

    return await response.json();
  }

  /*
   * The first key of the set with the token's key id, as PEM: null when
   * there is none, or when that key has no RSA modulus and exponent, or
   * they are no key at all.
   */
  private findKey(keyId: string): BotFrameworkSigningKey | null {
    const key: PublishedKey | undefined = (this.keys || []).find(
      (candidate: PublishedKey): boolean => {
        return candidate && candidate.kid === keyId;
      },
    );

    if (
      !key ||
      typeof key.n !== "string" ||
      typeof key.e !== "string" ||
      !key.n ||
      !key.e
    ) {
      return null;
    }

    let pem: string;

    try {
      pem = crypto
        .createPublicKey({
          key: { kty: "RSA", n: key.n, e: key.e },
          format: "jwk",
        })
        .export({ type: "spki", format: "pem" })
        .toString();
    } catch {
      return null;
    }

    return {
      key: pem,
      endorsements: key.endorsements as Array<string> | undefined,
    };
  }
}
