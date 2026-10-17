import { IdentityRoute } from "Common/ServiceRoute";
import { Host, HttpProtocol } from "Common/Server/EnvironmentConfig";
import ObjectID from "Common/Types/ObjectID";

/*
 * ---------------------------------------------------------------------------
 * WHAT ONEUPTIME TELLS AN IDENTITY PROVIDER ABOUT ONE OF ITS SAML PROVIDERS.
 *
 * Setting up SAML, an admin gives their identity provider two values for the
 * provider - its Identifier (Entity ID) and its Reply URL (Assertion Consumer
 * Service URL) - copied from OneUptime's SSO configuration dialog (project
 * and status page providers) or the Identity Provider URLs card (Global SSO).
 * The identity provider writes them back into every response it makes for
 * that application: the Entity ID as the <Audience>, the Reply URL as the
 * <Recipient> and the <Destination>.
 *
 * So these values are what a response must name for this provider to accept
 * it (SSOUtil.getSamlResponseFromXML), and the same values go into the
 * AuthnRequest a sign-in starts with. One builder for both, so the address a
 * request names and the address a response is checked against can never
 * drift apart.
 *
 * They are built exactly as the dialogs show them: the Dashboard and the
 * Admin Dashboard build them from the same HOST and HTTP_PROTOCOL
 * (Settings/SSO.tsx, StatusPages/View/SSO.tsx, Settings/GlobalSSO/View.tsx).
 * ---------------------------------------------------------------------------
 */
export interface SamlServiceProvider {
  // The Identifier (Entity ID): what the provider is called.
  entityId: string;

  // The Reply URL (Assertion Consumer Service URL): where responses go.
  replyUrl: string;

  /*
   * This server's address alone. Until May 2024 OneUptime showed it as the
   * Entity ID of every project and status page provider, so identity
   * providers set up then still send it as their Audience. It names no
   * provider in particular; a response carrying it is held to this provider
   * by its Recipient, which has always been the provider's own Reply URL.
   */
  serverAddress: string;
}

// A URL longer than this is not one OneUptime gave anybody.
const MAX_ADDRESS_LENGTH: number = 2048;

export default class SamlServiceProviders {
  public static forProjectSso(data: {
    projectId: ObjectID | string;
    projectSsoId: ObjectID | string;
  }): SamlServiceProvider {
    const projectId: string = data.projectId.toString();
    const projectSsoId: string = data.projectSsoId.toString();

    return {
      entityId: `${SamlServiceProviders.getServerAddress()}/${projectId}/${projectSsoId}`,
      replyUrl: `${SamlServiceProviders.getIdentityAddress()}/idp-login/${projectId}/${projectSsoId}`,
      serverAddress: SamlServiceProviders.getServerAddress(),
    };
  }

  public static forStatusPageSso(data: {
    statusPageId: ObjectID | string;
    statusPageSsoId: ObjectID | string;
  }): SamlServiceProvider {
    const statusPageId: string = data.statusPageId.toString();
    const statusPageSsoId: string = data.statusPageSsoId.toString();

    return {
      entityId: `${SamlServiceProviders.getServerAddress()}/${statusPageId}/${statusPageSsoId}`,
      replyUrl: `${SamlServiceProviders.getIdentityAddress()}/status-page-idp-login/${statusPageId}/${statusPageSsoId}`,
      serverAddress: SamlServiceProviders.getServerAddress(),
    };
  }

  public static forGlobalSso(data: {
    globalSsoId: ObjectID | string;
  }): SamlServiceProvider {
    const globalSsoId: string = data.globalSsoId.toString();

    return {
      entityId: `${SamlServiceProviders.getServerAddress()}/global-sso/${globalSsoId}`,
      replyUrl: `${SamlServiceProviders.getIdentityAddress()}/global-idp-login/${globalSsoId}`,
      serverAddress: SamlServiceProviders.getServerAddress(),
    };
  }

  /*
   * Does `candidate`, an address a response carries, name the same place as
   * `expected`, one of the addresses above?
   *
   * The same host (and port) and the same path. Three differences that do
   * not change where a request lands are let through, because identity
   * provider admins type these values in by hand:
   *
   *   - http and https. A server behind a proxy that ends TLS may know itself
   *     as http:// while its admins, and identity providers that refuse plain
   *     http Reply URLs, write https://.
   *   - Upper and lower case. Host names are case-insensitive, and so are
   *     OneUptime's routes, ids included.
   *   - A trailing slash.
   *
   * A query string or fragment is ignored: no provider address has one, and
   * the routes do not read them. Anything that is not an http(s) URL names
   * nothing, and neither does one carrying a user name or password: no
   * provider address has those either.
   */
  public static isSameAddress(candidate: string, expected: string): boolean {
    const candidateUrl: globalThis.URL | null =
      SamlServiceProviders.parseAddress(candidate);
    const expectedUrl: globalThis.URL | null =
      SamlServiceProviders.parseAddress(expected);

    if (!candidateUrl || !expectedUrl) {
      return false;
    }

    if (
      candidateUrl.username ||
      candidateUrl.password ||
      expectedUrl.username ||
      expectedUrl.password
    ) {
      return false;
    }

    return (
      candidateUrl.hostname === expectedUrl.hostname &&
      candidateUrl.port === expectedUrl.port &&
      SamlServiceProviders.getComparablePath(candidateUrl) ===
        SamlServiceProviders.getComparablePath(expectedUrl)
    );
  }

  private static getServerAddress(): string {
    return `${HttpProtocol}${Host}`;
  }

  private static getIdentityAddress(): string {
    return `${SamlServiceProviders.getServerAddress()}${IdentityRoute.toString()}`;
  }

  private static parseAddress(value: string): globalThis.URL | null {
    if (typeof value !== "string") {
      return null;
    }

    const trimmed: string = value.trim();

    if (trimmed === "" || trimmed.length > MAX_ADDRESS_LENGTH) {
      return null;
    }

    let url: globalThis.URL;

    try {
      url = new globalThis.URL(trimmed);
    } catch {
      return null;
    }

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }

    return url;
  }

  // The path in lower case, without trailing slashes ("/" becomes "").
  private static getComparablePath(url: globalThis.URL): string {
    const path: string = url.pathname.toLowerCase();
    let end: number = path.length;

    while (end > 0 && path.charAt(end - 1) === "/") {
      end--;
    }

    return path.substring(0, end);
  }
}
