import ExternalStatusPageMonitorResponse from "../../Types/Monitor/ExternalStatusPageMonitor/ExternalStatusPageMonitorResponse";
import ProbeAttempt from "../../Types/Probe/ProbeAttempt";
import ProbeMonitorResponse from "../../Types/Probe/ProbeMonitorResponse";
import RequestFailedDetails from "../../Types/Probe/RequestFailedDetails";

/*
 * A MONITOR'S URL AS WHAT ITS CHECK REPORTS NAMES IT (OneUptime issues
 * #10785, #10782).
 *
 * The server fills a monitor's secrets into its URL before it hands the
 * check to the probe: https://api.example.com/v1?key={{monitorSecrets.ApiKey}}
 * arrives with the key itself in it, and so does every text that names the
 * URL a request went to - "Request failed to https://...?key=...", the
 * refusal of an address that is no URL, quoted whole. What an API, Website
 * or External Status Page check reports - its failure cause, each
 * attempt's, why its request failed - is shown on the monitor's page and
 * summary, written into an incident's root cause and the notifications a
 * template writes, for everyone who can read the monitor; and the probe's
 * log lines say the same.
 *
 * So a URL in any of them is named by its scheme, host and port alone
 * (https://api.example.com, http://10.0.0.5:8080): a secret can sit in the
 * path (a webhook's token), the query, the fragment or the credentials
 * before the host, and neither the probe nor the server can tell which part
 * was filled in. The host says which server did not answer - after a
 * redirect, which hop - and the monitor's page shows its URL as it was
 * written, {{monitorSecrets.NAME}} by name.
 *
 * The probe writes what it reports so (it knows each URL it sent, and finds
 * those exactly first), and the server writes what any probe reports so
 * again as it takes it in (writeProbeResponse), for a custom probe from
 * before this was so.
 */

// What a text says for an address that is not a URL: never the text itself.
export const NOT_A_URL: string = "(an address that is not a URL)";

/*
 * An http or https URL in a text: up to a space, a quote, an angle bracket
 * or a backtick, which no URL a request is sent to holds as they are.
 */
const URL_IN_TEXT: RegExp = /\bhttps?:\/\/[^\s"'<>`]+/gi;

// What ends a sentence after a URL rather than the URL itself.
const TRAILING_PUNCTUATION: ReadonlySet<string> = new Set<string>([
  ".",
  ",",
  ";",
  ":",
  "!",
  "?",
  ")",
  "]",
  "}",
]);

/*
 * A closing bracket the URL opened is the URL's own - the "]" of an IPv6
 * host above all ("https://[2001:db8::1]."): only one it did not open ends
 * the sentence instead.
 */
const OPENING_BRACKETS: Readonly<Record<string, string>> = {
  ")": "(",
  "]": "[",
  "}": "{",
};

export default class MonitorUrlInText {
  /*
   * A URL by its scheme, host and port: never its path, query, fragment or
   * credentials, where a secret goes.
   */
  public static write(url: unknown): string {
    try {
      const parsed: globalThis.URL = new globalThis.URL(
        String(url ?? "").trim(),
      );

      if (!parsed.host) {
        return NOT_A_URL;
      }

      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      // Never the text itself: it may be a secret's value.
      return NOT_A_URL;
    }
  }

  /*
   * A text with every URL in it written as write() writes it, the sentence
   * around it kept. `sent` are the URLs the check sent - the monitor's own
   * and each hop's, as they were sent: each is found exactly first, so a
   * URL whose end no pattern can tell (a query value that ends in a dot or
   * holds a backslash, an address that is no URL at all, quoted whole) is
   * never cut in two. Every other http or https URL is found after that.
   */
  public static writeUrls(
    text: string,
    sent?: ReadonlyArray<string | undefined | null> | undefined,
  ): string {
    if (typeof text !== "string" || !text) {
      return text;
    }

    let written: string = text;

    for (const url of MonitorUrlInText.longestFirst(sent)) {
      if (written.includes(url)) {
        written = written.split(url).join(MonitorUrlInText.write(url));
      }
    }

    // Read in time in line with the text's length, however it is made.
    return written.replace(URL_IN_TEXT, (match: string): string => {
      const end: number = MonitorUrlInText.endOfUrl(match);

      return `${MonitorUrlInText.write(match.slice(0, end))}${match.slice(end)}`;
    });
  }

  /*
   * Where a URL found in a text ends: before the sentence marks after it,
   * but never before a closing bracket the URL itself opened. Each
   * bracket is counted once, so the time is in line with the URL's length.
   */
  private static endOfUrl(match: string): number {
    const open: Record<string, number> = { "(": 0, "[": 0, "{": 0 };
    const close: Record<string, number> = { ")": 0, "]": 0, "}": 0 };

    for (const character of match) {
      if (character in open) {
        open[character] = (open[character] as number) + 1;
      } else if (character in close) {
        close[character] = (close[character] as number) + 1;
      }
    }

    let end: number = match.length;

    while (end > 0 && TRAILING_PUNCTUATION.has(match.charAt(end - 1))) {
      const character: string = match.charAt(end - 1);
      const opening: string | undefined = OPENING_BRACKETS[character];

      // Taken off, this one would leave a bracket the URL opened unclosed.
      if (
        opening &&
        (open[opening] as number) >= (close[character] as number)
      ) {
        break;
      }

      if (opening) {
        close[character] = (close[character] as number) - 1;
      }

      end--;
    }

    return end;
  }

  // Each attempt with its failure cause written so; a copy.
  public static writeAttempts(
    attempts: Array<ProbeAttempt> | undefined,
    sent?: ReadonlyArray<string | undefined | null> | undefined,
  ): Array<ProbeAttempt> | undefined {
    if (!Array.isArray(attempts)) {
      return attempts;
    }

    return attempts.map((attempt: ProbeAttempt): ProbeAttempt => {
      if (!attempt || typeof attempt.failureCause !== "string") {
        return attempt;
      }

      return {
        ...attempt,
        failureCause: MonitorUrlInText.writeUrls(attempt.failureCause, sent),
      };
    });
  }

  // Why a request failed, its texts written so; a copy.
  public static writeRequestFailedDetails(
    details: RequestFailedDetails,
    sent?: ReadonlyArray<string | undefined | null> | undefined,
  ): RequestFailedDetails;
  public static writeRequestFailedDetails(
    details: RequestFailedDetails | undefined,
    sent?: ReadonlyArray<string | undefined | null> | undefined,
  ): RequestFailedDetails | undefined;
  public static writeRequestFailedDetails(
    details: RequestFailedDetails | undefined,
    sent?: ReadonlyArray<string | undefined | null> | undefined,
  ): RequestFailedDetails | undefined {
    if (!details || typeof details !== "object") {
      return details;
    }

    const written: RequestFailedDetails = {
      ...details,
      errorDescription:
        typeof details.errorDescription === "string"
          ? MonitorUrlInText.writeUrls(details.errorDescription, sent)
          : details.errorDescription,
    };

    if (typeof details.rawErrorMessage === "string") {
      written.rawErrorMessage = MonitorUrlInText.writeUrls(
        details.rawErrorMessage,
        sent,
      );
    }

    return written;
  }

  /*
   * What a probe reports of a check: its failure cause, each attempt's, why
   * its request failed, and an External Status Page check's own, with every
   * URL written so; a copy, everything else as it was. The server takes
   * every report in so (a custom probe from before this wrote the URL
   * whole, secrets and all), and the probe writes its debug log of a step
   * so.
   */
  public static writeProbeResponse(
    response: ProbeMonitorResponse,
    sent?: ReadonlyArray<string | undefined | null> | undefined,
  ): ProbeMonitorResponse {
    if (!response || typeof response !== "object") {
      return response;
    }

    const written: ProbeMonitorResponse = { ...response };

    if (typeof response.failureCause === "string") {
      written.failureCause = MonitorUrlInText.writeUrls(
        response.failureCause,
        sent,
      );
    }

    if (response.probeAttempts) {
      written.probeAttempts = MonitorUrlInText.writeAttempts(
        response.probeAttempts,
        sent,
      );
    }

    if (response.requestFailedDetails) {
      written.requestFailedDetails =
        MonitorUrlInText.writeRequestFailedDetails(
          response.requestFailedDetails,
          sent,
        );
    }

    const externalStatusPage: ExternalStatusPageMonitorResponse | undefined =
      response.externalStatusPageResponse;

    if (externalStatusPage && typeof externalStatusPage === "object") {
      const writtenPage: ExternalStatusPageMonitorResponse = {
        ...externalStatusPage,
      };

      if (typeof externalStatusPage.failureCause === "string") {
        writtenPage.failureCause = MonitorUrlInText.writeUrls(
          externalStatusPage.failureCause,
          sent,
        );
      }

      if (externalStatusPage.probeAttempts) {
        writtenPage.probeAttempts = MonitorUrlInText.writeAttempts(
          externalStatusPage.probeAttempts,
          sent,
        );
      }

      written.externalStatusPageResponse = writtenPage;
    }

    return written;
  }

  // The URLs sent, each once, the longest first: one never cuts another.
  private static longestFirst(
    sent: ReadonlyArray<string | undefined | null> | undefined,
  ): Array<string> {
    const urls: Array<string> = [];

    for (const url of sent || []) {
      if (typeof url === "string" && url && !urls.includes(url)) {
        urls.push(url);
      }
    }

    return urls.sort((a: string, b: string): number => {
      return b.length - a.length;
    });
  }
}
