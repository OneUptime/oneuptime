import crypto from "crypto";
import { EncryptionSecret } from "../../EnvironmentConfig";
import { getServerTwilioEnvironment } from "../ServerTwilioConfig";
import CallAndSmsProviders, {
  CallAndSmsGateway,
} from "../../../Types/CallAndSMS/CallAndSmsProvider";
import { ServerTwilioEnvironmentReading } from "../../../Types/CallAndSMS/ServerTwilioEnvironment";
import TwilioConfigUses from "../../../Types/CallAndSMS/TwilioConfigUse";
import {
  ServerSendingChannel,
  ServerSendingSettingsFingerprints,
} from "../../../Types/ServerSending/ServerSendingStatus";

/*
 * WHICH SETTINGS THE SERVER'S OWN SENDS GO THROUGH, AS FINGERPRINTS (#7736).
 *
 * What the server remembers of its own sends (GlobalConfig.
 * serverSendingHealth) was learned with the settings it sent with. Saving a
 * channel's settings in the Admin Dashboard forgets it (GlobalConfigService
 * .forgetServerSendingHealthOf). But SMS and calls can change without a
 * save: once GLOBAL_TWILIO_ACCOUNT_SID is set, the Twilio account is the
 * one the GLOBAL_TWILIO_ environment variables describe (#7515), and it
 * changes when they do and OneUptime restarts. A fixed auth token would
 * otherwise go on showing as "failing since..." until the next SMS
 * happened to go out, and an account nobody has tried as working.
 *
 * So an SMS or call entry is marked with a fingerprint of the route it was
 * learned with - the gateway, or the Twilio account - and one learned with
 * another route is read as untested (ServerSendingStatusUtil.
 * getCurrentEntry). The route is read as the senders take it: the gateway
 * when one is chosen and has an address, which carries both kinds of
 * message whatever the variables say (ServerChannelSetup.
 * getTwilioSetUpProblem); else the account the variables set, once
 * GLOBAL_TWILIO_ACCOUNT_SID is; else the saved account.
 *
 * Entries written before there were fingerprints were learned with the
 * saved settings, the only ones there were: they count as the saved
 * route's (`unmarked`), so an upgrade alone forgets nothing, and setting
 * the variables does.
 *
 * A fingerprint is an HMAC-SHA256 under the server's ENCRYPTION_SECRET of
 * the whole route - an auth token or a gateway secret changed is another
 * route - so it says nothing of the settings to anyone without the secret,
 * and the same settings give another fingerprint on another server. Email
 * and push have none: their settings change only when they are saved.
 */

const FINGERPRINT_SCHEME: string = "server-sending-settings:v1";

// The columns of the Twilio account, as the row holds them and the variables give them.
interface TwilioAccountColumns {
  twilioUsedFor?: unknown;
  twilioAccountSID?: unknown;
  twilioAuthToken?: unknown;
  twilioPrimaryPhoneNumber?: unknown;
  twilioSecondaryPhoneNumbers?: unknown;
  twilioSmsPhoneNumbers?: unknown;
}

// What the fingerprints read of the settings row.
export interface ServerSendingSettingsRow extends TwilioAccountColumns {
  callAndSmsProvider?: unknown;
  callAndSmsGatewayUrl?: unknown;
  callAndSmsGatewaySecret?: unknown;
}

// A value as text: a phone number by its number, nothing as nothing.
const asText: (value: unknown) => string = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
};

// A comma-separated list of numbers, however it was spaced.
const asList: (value: unknown) => string = (value: unknown): string => {
  return asText(value)
    .split(",")
    .map((item: string) => {
      return item.trim();
    })
    .filter((item: string) => {
      return item.length > 0;
    })
    .join(",");
};

export default class ServerSendingSettings {
  // The channels whose settings can change without a save, and so carry fingerprints.
  public static hasFingerprints(channel: ServerSendingChannel): boolean {
    return (
      channel === ServerSendingChannel.SMS ||
      channel === ServerSendingChannel.Call
    );
  }

  /*
   * The fingerprints of the settings a channel sends with now, or null for a
   * channel without them. Never throws: a row it cannot read is described
   * by what it holds.
   */
  public static getFingerprints(
    channel: ServerSendingChannel,
    row: ServerSendingSettingsRow | null | undefined,
  ): ServerSendingSettingsFingerprints | null {
    if (!ServerSendingSettings.hasFingerprints(channel)) {
      return null;
    }

    const saved: Array<string> = ServerSendingSettings.describeRoute(row, null);

    const environment: ServerTwilioEnvironmentReading =
      getServerTwilioEnvironment();

    const current: Array<string> = environment.isSet
      ? ServerSendingSettings.describeRoute(row, environment.account || {})
      : saved;

    return {
      current: ServerSendingSettings.fingerprint(current),
      unmarked: ServerSendingSettings.fingerprint(saved),
    };
  }

  /*
   * The route SMS and calls take, as a list of texts: the gateway when one
   * is chosen with an address, else the Twilio account - the one the
   * variables give, or the saved one when they give none. The same account
   * reads the same wherever it was set, so variables that repeat the saved
   * account keep what was learned with it.
   */
  public static describeRoute(
    row: ServerSendingSettingsRow | null | undefined,
    environmentAccount: TwilioAccountColumns | null,
  ): Array<string> {
    const gateway: CallAndSmsGateway | null = row
      ? CallAndSmsProviders.getGateway(row)
      : null;

    if (gateway) {
      return ["gateway", gateway.url, gateway.secret];
    }

    const account: TwilioAccountColumns = environmentAccount || row || {};

    return [
      "twilio",
      asText(account.twilioAccountSID),
      asText(account.twilioAuthToken),
      TwilioConfigUses.getUse(account.twilioUsedFor),
      asText(account.twilioPrimaryPhoneNumber),
      asList(account.twilioSecondaryPhoneNumbers),
      asList(account.twilioSmsPhoneNumbers),
    ];
  }

  // A keyed hash of a route: each part length-prefixed, so no two routes read alike.
  public static fingerprint(route: Array<string>): string {
    const message: string = [FINGERPRINT_SCHEME, ...route]
      .map((part: string) => {
        return `${part.length}:${part}`;
      })
      .join("");

    return crypto
      .createHmac("sha256", EncryptionSecret.toString())
      .update(message)
      .digest("hex");
  }
}
