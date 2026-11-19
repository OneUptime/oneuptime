import DataSourceHttpFetch, {
  DataSourceHttpResponse,
} from "./DataSource/HttpFetch";
import logger from "./Logger";
import type DatabaseService from "../Services/DatabaseService";
import UpdateBy from "../Types/Database/UpdateBy";
import type BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import BadDataException from "../../Types/Exception/BadDataException";
import { isUsableEndSessionEndpoint } from "../../Types/SSO/IdentityProviderSignOut";

/*
 * A PROVIDER THAT CANNOT SIGN PEOPLE OUT SAYS SO WHERE THE SWITCH IS TURNED ON,
 * NOT AT THE SIGN-OUT (#9535).
 *
 * "Sign out of the identity provider too" (signOutOfIdentityProvider, on a
 * Global OIDC or Project OIDC provider) sends the browser, once OneUptime
 * has signed it out, to the provider's end_session_endpoint (OpenID Connect
 * RP-Initiated Logout 1.0), which its discovery document names. Google
 * names none, and neither does a provider that does not do RP-initiated
 * logout: there the switch could only fail later, quietly, at someone's
 * sign-out. So turning it on - creating a provider with it on, switching it
 * on, or moving a provider that has it on to another discovery URL - reads
 * the discovery document first, through the egress guard every request to
 * a configured address goes through (DataSourceHttpFetch), and is refused,
 * in words the provider form shows, when the document names no usable
 * end_session_endpoint or cannot be read. A save that leaves it as it was
 * reads nothing.
 */

// How long the discovery document is waited for: a save is a person waiting.
export const DISCOVERY_READ_TIMEOUT_IN_MS: number = 10_000;

export const NO_END_SESSION_ENDPOINT_MESSAGE: string =
  "This identity provider cannot sign people out: its discovery document names no end_session_endpoint, where an OpenID Connect provider ends its sessions. Leave Sign out of the identity provider too off for this provider, or check its discovery URL.";

export const DISCOVERY_UNREADABLE_MESSAGE: string =
  "OneUptime could not read this identity provider's discovery document, so it cannot tell whether the provider can sign people out. Check the discovery URL and try again, or leave Sign out of the identity provider too off.";

// The provider columns this check reads and writes.
interface ProviderSignOutColumns {
  _id?: unknown;
  discoveryURL?: unknown;
  signOutOfIdentityProvider?: unknown;
}

export default class IdentityProviderSignOutCheck {
  /*
   * The end_session_endpoint the discovery document at `discoveryURL`
   * names, or null when it names none OneUptime may send a browser to.
   * Throws when the document cannot be read, or is not a JSON object.
   */
  public static async readEndSessionEndpoint(
    discoveryURL: string,
  ): Promise<string | null> {
    const response: DataSourceHttpResponse = await DataSourceHttpFetch.fetch({
      method: "GET",
      url: discoveryURL,
      headers: { Accept: "application/json" },
      timeoutInMs: DISCOVERY_READ_TIMEOUT_IN_MS,
    });

    const document: unknown = JSON.parse(response.bodyText);

    if (!document || typeof document !== "object" || Array.isArray(document)) {
      throw new BadDataException(
        "The discovery document is not a JSON object.",
      );
    }

    const endSessionEndpoint: unknown = (document as Record<string, unknown>)[
      "end_session_endpoint"
    ];

    return isUsableEndSessionEndpoint(endSessionEndpoint)
      ? endSessionEndpoint
      : null;
  }

  /*
   * Refuses, with what to do, a provider whose discovery document names no
   * end_session_endpoint, or cannot be read.
   */
  public static async assertProviderSignsOut(
    discoveryURL: unknown,
  ): Promise<void> {
    const address: string = IdentityProviderSignOutCheck.toText(discoveryURL);

    if (!address) {
      throw new BadDataException(DISCOVERY_UNREADABLE_MESSAGE);
    }

    let endSessionEndpoint: string | null = null;

    try {
      endSessionEndpoint =
        await IdentityProviderSignOutCheck.readEndSessionEndpoint(address);
    } catch (err) {
      logger.warn(
        "Could not read an OIDC discovery document to check that the provider can sign people out.",
      );
      logger.warn(err);
      throw new BadDataException(DISCOVERY_UNREADABLE_MESSAGE);
    }

    if (!endSessionEndpoint) {
      throw new BadDataException(NO_END_SESSION_ENDPOINT_MESSAGE);
    }
  }

  // A create with the switch on: its discovery URL is asked.
  public static async beforeCreate(data: unknown): Promise<void> {
    const provider: ProviderSignOutColumns = (data ||
      {}) as ProviderSignOutColumns;

    if (provider.signOutOfIdentityProvider !== true) {
      return;
    }

    await IdentityProviderSignOutCheck.assertProviderSignsOut(
      provider.discoveryURL,
    );
  }

  /*
   * An update that leaves the switch on for a provider with a discovery URL
   * not yet asked: one that turns it on, or one that moves a provider that
   * has it on to another discovery URL. Each provider the update reaches is
   * read as it is now, so a save that sends the switch back as it was - an
   * edit form sends every field it shows - asks nothing.
   */
  public static async beforeUpdate<TBaseModel extends BaseModel>(data: {
    service: DatabaseService<TBaseModel>;
    updateBy: UpdateBy<TBaseModel>;
  }): Promise<void> {
    const written: ProviderSignOutColumns = (data.updateBy.data ||
      {}) as ProviderSignOutColumns;

    const turnsOn: boolean = written.signOutOfIdentityProvider === true;
    const movesDiscovery: boolean = written.discoveryURL !== undefined;
    const turnsOff: boolean = written.signOutOfIdentityProvider === false;

    if ((!turnsOn && !movesDiscovery) || turnsOff) {
      return;
    }

    /*
     * The providers the update writes, with the update held to them, so the
     * providers asked about are the providers written, and no others
     * (findRowsAndHoldUpdateToThem).
     */
    const providers: Array<TBaseModel> =
      await data.service.findRowsAndHoldUpdateToThem(data.updateBy, {
        _id: true,
        discoveryURL: true,
        signOutOfIdentityProvider: true,
      } as never);

    for (const row of providers) {
      const provider: ProviderSignOutColumns =
        row as unknown as ProviderSignOutColumns;

      const wasOn: boolean = provider.signOutOfIdentityProvider === true;
      const willBeOn: boolean = turnsOn || wasOn;

      if (!willBeOn) {
        continue;
      }

      const discoveryURL: string = IdentityProviderSignOutCheck.toText(
        movesDiscovery ? written.discoveryURL : provider.discoveryURL,
      );

      // On already, with this very discovery URL: asked when it was turned on.
      if (
        wasOn &&
        discoveryURL ===
          IdentityProviderSignOutCheck.toText(provider.discoveryURL)
      ) {
        continue;
      }

      await IdentityProviderSignOutCheck.assertProviderSignsOut(discoveryURL);
    }
  }

  // A discovery URL as text: a URL column holds a URL, a write may hold text.
  private static toText(value: unknown): string {
    if (value === null || value === undefined) {
      return "";
    }

    return String(value).trim();
  }
}
