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
   * each of these URLs in it written as write() writes it: an error a
   * request throws says the whole URL it was sent to ("Request failed to
   * https://...?key=..."), secrets and all.
   */
  public static scrub(
    text: string,
    urls: Array<URL | string | undefined | null>,
  ): string {
    let scrubbed: string = text;

    for (const url of urls) {
      const whole: string = url ? String(url) : "";

      if (!whole) {
        continue;
      }

      const written: string = MonitorLogUrl.write(whole);

      // As it is, and as JSON writes it inside a string.
      for (const form of [whole, JSON.stringify(whole).slice(1, -1)]) {
        scrubbed = scrubbed.split(form).join(written);
      }
    }

    return scrubbed;
  }
}
