import URL from "Common/Types/API/URL";
import MonitorUrlInText from "Common/Utils/Monitor/MonitorUrlInText";

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
 *
 * What a check reports names a URL the same way (#10785): both are
 * Common's MonitorUrlInText, which the server applies to what it takes in
 * too.
 */
export default class MonitorLogUrl {
  public static write(url: URL | string | undefined | null): string {
    return MonitorUrlInText.write(url);
  }

  /*
   * A text for a log line - an error, a response written as JSON - with
   * every URL in it written as write() writes it: an error a request
   * throws says the whole URL it was sent to ("Request failed to
   * https://...?key=..."), secrets and all, and so may a redirect's next
   * hop. `sent` are the URLs the check sent, found exactly first
   * (MonitorUrlInText.writeUrls). Read in time in line with the text's
   * length.
   */
  public static scrub(
    text: string,
    sent?: ReadonlyArray<string | undefined | null> | undefined,
  ): string {
    return MonitorUrlInText.writeUrls(text, sent);
  }
}
