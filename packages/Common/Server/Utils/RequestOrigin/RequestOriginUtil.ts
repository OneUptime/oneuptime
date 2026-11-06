import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import RequestOrigin from "../../../Types/RequestOrigin";
import Timezone from "../../../Types/Timezone";
import {
  TrustedGeoCityHeader,
  TrustedGeoCountryHeader,
  TrustedGeoRegionHeader,
} from "../../EnvironmentConfig";
import { ClientIpRequestLike, resolveClientIp } from "../ClientIp";
import RequestLocation, { TrustedGeoHeaderNames } from "./RequestLocation";
import UserAgentDevice, { UserAgentRequestHeaders } from "./UserAgentDevice";

/*
 * WHERE A REQUEST CAME FROM, FOR THE EMAIL IT CAUSES.
 *
 * The emails that tell an account's owner something just happened to their
 * account - a password reset was asked for, the password changed, a backup
 * code was spent, wrong two factor codes were entered - say when, from which
 * address, roughly where and on which device (issue #5599). Most of them go
 * out because of a request somebody else could have made, and these four
 * lines are what let the owner tell their own request from a stranger's:
 * "Chrome 130 on macOS, Berlin, Germany" is them on their laptop at home;
 * "curl" from another continent is not.
 *
 * Each email lays the lines out in its detail card: its own row for the time
 * ("Requested at:", "Changed at:"), then Partials/RequestOriginFields.hbs for
 * the address, place and device. A row with nothing to say does not show -
 * no place is named until the operator names the CDN headers that carry it
 * (RequestLocation) - and an email sent without a request behind it shows
 * the time alone.
 *
 * What each line is made of, and why none of it is the caller's writing:
 *
 *  - the address is the one ClientIp trusts, counted in from our own end of
 *    X-Forwarded-For;
 *  - the place is what a header the operator named says, and nothing when
 *    none is named (RequestLocation);
 *  - the device is built only of names UserAgentDevice spells out, so a
 *    User-Agent of "Call this number" is "Unknown device" in the email.
 */

/*
 * The device line for a request whose headers name no browser or program
 * this knows. Saying so is itself worth reading: an owner who signs in with
 * a browser has never seen it on their own requests.
 */
export const UNKNOWN_DEVICE: string = "Unknown device";

/*
 * The time line's zone when the recipient has not chosen one: the email
 * names its zone either way ("2:15 PM UTC"), so it is never ambiguous.
 */
export const DEFAULT_EMAIL_TIMEZONE: Timezone = Timezone.UTC;

export type RequestOriginRequestLike = ClientIpRequestLike;

export interface RequestOriginEmailVars extends Dictionary<string> {
  // When it happened: "Nov 3, 2026, 2:15 PM CET".
  requestedAt: string;
  requestIpAddress: string;
  requestLocation: string;
  requestDevice: string;
}

export default class RequestOriginUtil {
  public static fromRequest(
    req: RequestOriginRequestLike,
    options?: { trustedGeoHeaders?: TrustedGeoHeaderNames | undefined },
  ): RequestOrigin {
    const headers: UserAgentRequestHeaders = (req.headers ||
      {}) as UserAgentRequestHeaders;

    return {
      ipAddress: resolveClientIp(req),
      location: RequestLocation.fromHeaders({
        headers: headers,
        headerNames:
          options?.trustedGeoHeaders ||
          RequestOriginUtil.getTrustedGeoHeaders(),
      }),
      device: UserAgentDevice.describeRequest(headers),
    };
  }

  // The headers TRUSTED_GEO_*_HEADER name (EnvironmentConfig).
  public static getTrustedGeoHeaders(): TrustedGeoHeaderNames {
    return {
      country: TrustedGeoCountryHeader,
      region: TrustedGeoRegionHeader,
      city: TrustedGeoCityHeader,
    };
  }

  /*
   * The variables an email's request rows read. requestedAt is the moment -
   * now, unless `at` says otherwise - in the recipient's own time zone when
   * they chose one. The others are empty when they are not known, and all
   * three are when there is no request to describe, so their rows hide.
   */
  public static getEmailVars(data: {
    origin?: RequestOrigin | undefined;
    at?: Date | undefined;
    timezone?: Timezone | null | undefined;
  }): RequestOriginEmailVars {
    return {
      requestedAt: OneUptimeDate.getDateAsFormattedStringInTimezone({
        date: data.at || OneUptimeDate.getCurrentDate(),
        timezone: data.timezone || DEFAULT_EMAIL_TIMEZONE,
      }),
      requestIpAddress: data.origin?.ipAddress || "",
      requestLocation: data.origin?.location || "",
      requestDevice: data.origin ? data.origin.device || UNKNOWN_DEVICE : "",
    };
  }
}
