import { UserAgentRequestHeaders } from "./UserAgentDevice";

/*
 * ROUGHLY WHERE A REQUEST CAME FROM, AS THE CDN IN FRONT OF ONEUPTIME SAYS.
 *
 * A security email says where a request came from - "Berlin, Germany" - so
 * an owner can tell their own reset from somebody else's. There is no IP
 * geolocation database in this deployment (SessionReplayIngest says why), but
 * the CDN or load balancer in front of an installation usually knows: it
 * looks the visitor's address up at the edge and can pass the answer on in a
 * request header. Cloudflare sends cf-ipcountry, and cf-region and cf-ipcity
 * once its "Add visitor location headers" transform is on; CloudFront,
 * Vercel, a Google Cloud load balancer and nginx's GeoIP2 module each have
 * their own. TRUSTED_GEO_COUNTRY_HEADER, TRUSTED_GEO_REGION_HEADER and
 * TRUSTED_GEO_CITY_HEADER name the headers to read (EnvironmentConfig).
 *
 * NONE IS READ UNLESS ITS NAME IS SET, and none is set by default. A request
 * header is the caller's own writing unless something in front of OneUptime
 * overwrites it, and nothing in our Nginx strips cf-ipcity: on an install
 * that is not behind Cloudflare, reading it would let anybody who asks for a
 * stranger's password reset choose the place its owner reads. An email
 * without a location says less; one with a location the requester chose
 * says something false.
 *
 * What a header says is still cleaned before it is used: decoded the way
 * CDNs encode it, held to MAX_PLACE_NAME_LENGTH characters of the kind
 * place names are written in, and a country code is turned into its name.
 */

export interface TrustedGeoHeaderNames {
  // Lowercased request header names; an empty one is not read.
  country?: string | undefined;
  region?: string | undefined;
  city?: string | undefined;
}

// No country, region or city name is longer than this.
export const MAX_PLACE_NAME_LENGTH: number = 64;

/*
 * More of a header than this is never decoded: a percent-encoded place name
 * of MAX_PLACE_NAME_LENGTH characters fits in it with room to spare.
 */
const MAX_HEADER_VALUE_LENGTH: number = 512;

/*
 * What a place name is written with, in any script: letters and their
 * marks, digits, spaces, and the punctuation of names such as "St. John's",
 * "Saint-Étienne" or "Washington, D.C." - nothing markup or a link is made of.
 */
const PLACE_NAME: RegExp = /^[\p{L}\p{M}\p{N} .,'’()-]+$/u;

const CONTROL_CHARACTERS: RegExp = /[\p{Cc}\p{Cf}]/gu;

const WHITESPACE_RUN: RegExp = /\s+/g;

const TWO_LETTERS: RegExp = /^[A-Z]{2}$/;

const PERCENT_ENCODED_BYTE: RegExp = /%[0-9A-Fa-f]{2}/;

// What a byte that is not UTF-8 decodes to.
const REPLACEMENT_CHARACTER: string = String.fromCharCode(0xfffd);

/*
 * Country codes that are not a country. Cloudflare sends XX for an address
 * it cannot place and T1 for Tor; CLDR's ZZ is "Unknown Region".
 */
const UNKNOWN_COUNTRY_CODES: Array<string> = ["XX", "ZZ"];

const TOR_COUNTRY_CODE: string = "T1";

/*
 * The text a header carries. Vercel percent-encodes a city ("S%C3%A3o%20
 * Paulo"), and a CDN that sends the UTF-8 bytes of "München" reaches Node,
 * which reads every header byte as Latin-1, as "MÃ¼nchen".
 */
/*
 * Whether every character is one a Latin-1 byte reads as, and one at least
 * is past ASCII: what UTF-8 bytes look like once Node has read them.
 */
type IsReadAsLatin1Function = (text: string) => boolean;

const isReadAsLatin1: IsReadAsLatin1Function = (text: string): boolean => {
  let isPastAscii: boolean = false;

  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);

    if (code > 0xff) {
      return false;
    }

    if (code >= 0x80) {
      isPastAscii = true;
    }
  }

  return isPastAscii;
};

type DecodeHeaderTextFunction = (value: string) => string;

const decodeHeaderText: DecodeHeaderTextFunction = (value: string): string => {
  let text: string = value;

  if (PERCENT_ENCODED_BYTE.test(text)) {
    try {
      text = decodeURIComponent(text);
    } catch {
      // A "%" that was not percent-encoding: the text is kept as it came.
    }
  }

  if (isReadAsLatin1(text)) {
    const utf8: string = Buffer.from(text, "latin1").toString("utf8");

    if (!utf8.includes(REPLACEMENT_CHARACTER)) {
      text = utf8;
    }
  }

  return text;
};

type FirstHeaderValueFunction = (
  value: string | Array<string> | undefined,
) => string | undefined;

const firstHeaderValue: FirstHeaderValueFunction = (
  value: string | Array<string> | undefined,
): string | undefined => {
  const first: string | undefined = Array.isArray(value) ? value[0] : value;

  return typeof first === "string" ? first : undefined;
};

/*
 * A place name as a header gives it, cleaned, or undefined when there is
 * none or what is there is not written like one.
 */
type ReadPlaceNameFunction = (
  value: string | Array<string> | undefined,
) => string | undefined;

const readPlaceName: ReadPlaceNameFunction = (
  value: string | Array<string> | undefined,
): string | undefined => {
  const raw: string | undefined = firstHeaderValue(value);

  if (!raw) {
    return undefined;
  }

  const text: string = decodeHeaderText(raw.slice(0, MAX_HEADER_VALUE_LENGTH))
    .replace(CONTROL_CHARACTERS, " ")
    .replace(WHITESPACE_RUN, " ")
    .trim();

  if (!text || text.length > MAX_PLACE_NAME_LENGTH || !PLACE_NAME.test(text)) {
    return undefined;
  }

  return text;
};

type CountryNameFunction = (code: string) => string | undefined;

// "Germany" for DE, in English: the language every security email is in.
const countryName: CountryNameFunction = (code: string): string | undefined => {
  try {
    const name: string | undefined = new Intl.DisplayNames(["en"], {
      type: "region",
    }).of(code);

    return name && name !== code ? name : undefined;
  } catch {
    // A runtime without Intl.DisplayNames, or a code it refuses.
    return undefined;
  }
};

export default class RequestLocation {
  /*
   * "Berlin, Germany" - the city, region and country the named headers
   * carry, each once, in that order - or undefined when none says anything.
   */
  public static fromHeaders(data: {
    headers: UserAgentRequestHeaders | undefined;
    headerNames: TrustedGeoHeaderNames;
  }): string | undefined {
    const headers: UserAgentRequestHeaders = data.headers || {};

    const read: (name: string | undefined) => string | undefined = (
      name: string | undefined,
    ): string | undefined => {
      return name ? readPlaceName(headers[name]) : undefined;
    };

    const parts: Array<string> = [];

    for (const part of [
      read(data.headerNames.city),
      read(data.headerNames.region),
      RequestLocation.describeCountry(read(data.headerNames.country)),
    ]) {
      if (!part) {
        continue;
      }

      const alreadyNamed: boolean = parts.some((named: string): boolean => {
        return named.toLowerCase() === part.toLowerCase();
      });

      // "Singapore, Singapore" says nothing twice; "Singapore" says it once.
      if (!alreadyNamed) {
        parts.push(part);
      }
    }

    return parts.length > 0 ? parts.join(", ") : undefined;
  }

  /*
   * A country header's value as a person reads it: a two-letter code
   * becomes the country's name ("DE" is "Germany"), Tor's code says Tor,
   * and a code for no country is nothing. A name is kept as it is.
   */
  public static describeCountry(value: string | undefined): string | undefined {
    if (!value) {
      return undefined;
    }

    const code: string = value.toUpperCase();

    // Before the letters test: Tor's code has a digit in it.
    if (code === TOR_COUNTRY_CODE) {
      return "Tor network";
    }

    if (!TWO_LETTERS.test(code)) {
      return value;
    }

    if (UNKNOWN_COUNTRY_CODES.includes(code)) {
      return undefined;
    }

    return countryName(code) || code;
  }
}
