import { refusedValue } from "../../Utils/RefusedValue";

/*
 * WHAT CARRIES THE ONEUPTIME SERVER'S SMS AND CALLS: TWILIO, OR A GATEWAY.
 *
 * The server's own Twilio account (Admin Dashboard > Settings > Call and
 * SMS) is what every installation sent through before the choice, and what
 * the column starts with (GlobalConfig.callAndSmsProvider). An installation
 * that may not use Twilio - its rules send every message through its own
 * provider, or through a proxy that scrubs it first - sends through its own
 * gateway instead: a URL OneUptime posts each SMS and call to, signed with a
 * secret, as it posts to a custom channel (CallAndSmsGatewayPayload). The
 * gateway delivers them however the installation does.
 *
 * Only what would go through the server's own account: a project with a
 * Twilio config of its own (Dashboard > Project Settings > Call & SMS) still
 * sends through that config, as it did. Whatever carries a message, the
 * project's switches and balance are checked the same way first.
 *
 * Kept free of server and React code: the server, the Admin Dashboard and
 * the tests read the same rules.
 */
export enum CallAndSmsProvider {
  Twilio = "Twilio",
  Gateway = "Gateway",
}

// In the order the form offers them: what every installation had, first.
export const CALL_AND_SMS_PROVIDERS: ReadonlyArray<CallAndSmsProvider> = [
  CallAndSmsProvider.Twilio,
  CallAndSmsProvider.Gateway,
];

/*
 * What a server that says nothing sends through: Twilio, as every
 * installation did before the choice - and what the column starts with.
 */
export const DEFAULT_CALL_AND_SMS_PROVIDER: CallAndSmsProvider =
  CallAndSmsProvider.Twilio;

// The titles of the columns, as the form and the API reference name them.
export const CALL_AND_SMS_PROVIDER_TITLE: string = "Send SMS and Calls Through";
export const CALL_AND_SMS_GATEWAY_URL_TITLE: string = "Gateway URL";

// The gateway a server sends through, once it has one.
export interface CallAndSmsGateway {
  url: string;
  secret: string;
}

export default class CallAndSmsProviders {
  public static isProvider(value: unknown): value is CallAndSmsProvider {
    return (
      typeof value === "string" &&
      (CALL_AND_SMS_PROVIDERS as ReadonlyArray<string>).includes(value)
    );
  }

  /*
   * What a stored value says the server sends through. Unset - every
   * installation before the choice - is Twilio, and so is a value that is
   * not a provider: the writes that store one refuse it
   * (getProviderError), so only a row edited by hand can hold one, and it
   * keeps sending as every installation did.
   */
  public static getProvider(value: unknown): CallAndSmsProvider {
    return CallAndSmsProviders.isProvider(value)
      ? value
      : DEFAULT_CALL_AND_SMS_PROVIDER;
  }

  // Whether a server whose column holds this sends through its own gateway.
  public static isGateway(value: unknown): boolean {
    return (
      CallAndSmsProviders.getProvider(value) === CallAndSmsProvider.Gateway
    );
  }

  /*
   * What is wrong with a value a write gives for what the server sends
   * through, or null when it is one of the providers - or not given at all:
   * the column then keeps, or starts with, what it holds.
   */
  public static getProviderError(value: unknown): string | null {
    if (value === undefined || value === null) {
      return null;
    }

    if (CallAndSmsProviders.isProvider(value)) {
      return null;
    }

    const choices: string = `${CALL_AND_SMS_PROVIDER_TITLE} must be "${CallAndSmsProvider.Twilio}" or "${CallAndSmsProvider.Gateway}"`;

    // A text is repeated, as far as a refusal repeats one; anything else is not text.
    return typeof value === "string"
      ? `${choices}, not "${refusedValue(value)}".`
      : `${choices}.`;
  }

  /*
   * The gateway the server sends through, or null when it sends through
   * Twilio - or is set to the gateway without a URL to post to, which the
   * write refuses (GlobalConfigService), so only a row edited by hand holds
   * it. Such a server has nothing to send through, and says so as a server
   * without a Twilio account does.
   */
  public static getGateway(config: {
    callAndSmsProvider?: unknown;
    callAndSmsGatewayUrl?: unknown;
    callAndSmsGatewaySecret?: unknown;
  }): CallAndSmsGateway | null {
    if (!CallAndSmsProviders.isGateway(config.callAndSmsProvider)) {
      return null;
    }

    const url: string =
      typeof config.callAndSmsGatewayUrl === "string"
        ? config.callAndSmsGatewayUrl.trim()
        : "";

    if (!url) {
      return null;
    }

    return {
      url: url,
      secret:
        typeof config.callAndSmsGatewaySecret === "string"
          ? config.callAndSmsGatewaySecret
          : "",
    };
  }
}
