import URL from "Common/Types/API/URL";

/*
 * A MONITOR'S URL AS A LOG LINE WRITES IT (#10782).
 *
 * The server fills a monitor's secrets into its URL before it hands the
 * check to the probe: https://api.example.com/v1?key={{monitorSecrets.ApiKey}}
 * arrives with the key itself in it, and the logger's redaction
 * (Common/Server/Utils/LogRedaction) knows a secret only by the name of
 * the field that holds it or by a few shapes of its own. So a log line
 * names a monitor's URL by its scheme, host and port alone - never its
 * path, query, fragment or credentials, where a secret goes. The monitor
 * id beside it says which monitor it is.
 */

// An http or https URL in a text, up to a space, a quote or a backslash.
const URL_IN_TEXT: RegExp = /\bhttps?:\/\/[^\s"'<>\\]+/gi;

// What ends a sentence after a URL rather than the URL itself.
const TRAILING_PUNCTUATION: RegExp = /[.,;:!?)\]}]+$/;

export default class MonitorLogUrl {
  public static write(url: URL | string | undefined | null): string {
    try {
      const parsed: globalThis.URL = new globalThis.URL(String(url ?? ""));

      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      // Never the text itself: it may be a secret's value.
      return "(an address that is not a URL)";
    }
  }

  /*
   * A text for a log line - an error, a response written as JSON - with
   * every URL in it written as write() writes it: an error a request
   * throws says the whole URL it was sent to ("Request failed to
   * https://...?key=..."), secrets and all, and so may a redirect's next
   * hop. Read in time in line with the text's length.
   */
  public static scrub(text: string): string {
    return text.replace(URL_IN_TEXT, (match: string): string => {
      const trailing: string = TRAILING_PUNCTUATION.exec(match)?.[0] || "";
      const url: string = trailing ? match.slice(0, -trailing.length) : match;

      return `${MonitorLogUrl.write(url)}${trailing}`;
    });
  }
}
