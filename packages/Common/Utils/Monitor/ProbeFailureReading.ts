import { RequestFailedPhase } from "../../Types/Probe/RequestFailedDetails";
import {
  fillTemplate,
  PluralTemplate,
  translationKey,
  Translator,
} from "../../Types/Translator";

/*
 * WHY A PROBE'S CHECK FAILED, READ IN THE READER'S LANGUAGE.
 *
 * A failed check stores why in the probe's English: its failure cause (the
 * summary's Error) and, for a request, the phase it broke in (Failed
 * Phase).
 * Monitor criteria, incident root causes and logs compare that English, so
 * it is stored as it always was. The monitor summaries read it back here
 * and draw OneUptime's own words in the reader's language; anything else -
 * the network's, the runtime's or a server's own message - stays as
 * written (and is drawn in its own direction on an Arabic or Persian page).
 *
 * The words are translation keys: the Dashboard's npm run i18n:extract
 * reads this directory.
 */

/*
 * THE PROBE'S TIMEOUT SENTENCE.
 *
 * When every attempt of a check timed out, the probe of each monitor type
 * that retries - Website, API, Ping, SSL Certificate, DNS, Domain, SNMP
 * and External Status Page - writes one sentence as the check's failure
 * cause: "Request was tried 3 times and it timed out." The probe writes it
 * with writeProbeTimeoutFailureCause, always in the general form with the
 * count in digits ("1 times" too), exactly as it did before the sentence
 * became a key: an "Error contains" criterion, a root cause or a log line
 * written against that English still finds it.
 *
 * Drawn for a reader, it is a count-dependent sentence: "once" for one
 * try, and each language's own plural forms, with the count in the
 * reader's digits (getProbeFailureCauseText).
 */
export const PROBE_TIMEOUT_FAILURE_CAUSE: PluralTemplate = {
  // Stored under the general sentence's key plus "_one", never on its own.
  one: "Request was tried once and it timed out.",
  other: translationKey("Request was tried {{count}} times and it timed out."),
};

// The stored sentence's words before and after its count.
const TIMEOUT_COUNT_PLACEHOLDER: string = "{{count}}";

const TIMEOUT_BEFORE_COUNT: string = PROBE_TIMEOUT_FAILURE_CAUSE.other.slice(
  0,
  PROBE_TIMEOUT_FAILURE_CAUSE.other.indexOf(TIMEOUT_COUNT_PLACEHOLDER),
);

const TIMEOUT_AFTER_COUNT: string = PROBE_TIMEOUT_FAILURE_CAUSE.other.slice(
  PROBE_TIMEOUT_FAILURE_CAUSE.other.indexOf(TIMEOUT_COUNT_PLACEHOLDER) +
    TIMEOUT_COUNT_PLACEHOLDER.length,
);

/*
 * A count the probe writes: Latin digits only, as String(number) writes a
 * whole number, and no longer than any count of tries could be. Anchored
 * and with no repeat beside another, so it reads any text in time that
 * grows with its length.
 */
const STORED_COUNT_PATTERN: RegExp = /^[0-9]{1,9}$/;

/*
 * The failure cause the probe stores when every one of `triedCount`
 * attempts timed out - word for word the English it always wrote with
 * "Request was tried " + count + " times and it timed out.", the count
 * written by String() as that concatenation did.
 */
export const writeProbeTimeoutFailureCause: (
  triedCount: number | undefined,
) => string = (triedCount: number | undefined): string => {
  return fillTemplate(PROBE_TIMEOUT_FAILURE_CAUSE.other, {
    count: String(triedCount),
  });
};

/*
 * The count of tries a stored failure cause names, when the cause is
 * exactly the probe's timeout sentence (space round it aside); null for any
 * other cause - a sentence close to it but not the same, the sentence
 * inside a longer message, the network's or a server's own words - which
 * stays as written.
 */
export const readProbeTimeoutFailureCause: (
  failureCause: string | null | undefined,
) => number | null = (
  failureCause: string | null | undefined,
): number | null => {
  const text: string =
    typeof failureCause === "string" ? failureCause.trim() : "";

  if (
    text.length <= TIMEOUT_BEFORE_COUNT.length + TIMEOUT_AFTER_COUNT.length ||
    !text.startsWith(TIMEOUT_BEFORE_COUNT) ||
    !text.endsWith(TIMEOUT_AFTER_COUNT)
  ) {
    return null;
  }

  const count: string = text.slice(
    TIMEOUT_BEFORE_COUNT.length,
    text.length - TIMEOUT_AFTER_COUNT.length,
  );

  if (!STORED_COUNT_PATTERN.test(count)) {
    return null;
  }

  return Number.parseInt(count, 10);
};

/*
 * A check's failure cause - or any message of the probe's - as a summary
 * draws it: the probe's timeout sentence in the reader's language, with
 * the count in the reader's digits; anything else as written, trimmed.
 */
export const getProbeFailureCauseText: (data: {
  translator: Translator;
  failureCause: string | null | undefined;
}) => string = (data: {
  translator: Translator;
  failureCause: string | null | undefined;
}): string => {
  const text: string =
    typeof data.failureCause === "string" ? data.failureCause.trim() : "";
  const triedCount: number | null = readProbeTimeoutFailureCause(text);

  if (triedCount === null) {
    return text;
  }

  return data.translator.translatePlural(
    PROBE_TIMEOUT_FAILURE_CAUSE,
    triedCount,
  );
};

/*
 * WHERE A REQUEST BROKE.
 *
 * Each phase a request can fail in (RequestFailedDetails' failedPhase, the
 * summary's Failed Phase) by its English words, a translation key. The probe
 * stores the enum's value, which is these words; criteria may compare it,
 * so it never changes.
 */
export const REQUEST_FAILED_PHASE_WORDS: Readonly<
  Record<RequestFailedPhase, string>
> = {
  [RequestFailedPhase.DNSResolution]: translationKey("DNS Resolution"),
  [RequestFailedPhase.TCPConnection]: translationKey("TCP Connection"),
  [RequestFailedPhase.TLSHandshake]: translationKey("TLS Handshake"),
  [RequestFailedPhase.RequestTimeout]: translationKey("Request Timeout"),
  [RequestFailedPhase.ServerResponse]: translationKey("Server Response"),
  [RequestFailedPhase.RequestAborted]: translationKey("Request Aborted"),
  [RequestFailedPhase.NetworkError]: translationKey("Network Error"),
  [RequestFailedPhase.CertificateError]: translationKey("Certificate Error"),
  [RequestFailedPhase.TargetResolution]: translationKey("Target Resolution"),
  [RequestFailedPhase.Unknown]: translationKey("Unknown"),
};

const isRequestFailedPhase: (value: string) => value is RequestFailedPhase = (
  value: string,
): value is RequestFailedPhase => {
  return Object.prototype.hasOwnProperty.call(
    REQUEST_FAILED_PHASE_WORDS,
    value,
  );
};

/*
 * The phase a request failed in, as the summary's Failed Phase draws it: the
 * reader's word for a phase the probe names; a value no probe writes today
 * (a newer probe's) as written, trimmed; "" for none.
 */
export const getRequestFailedPhaseText: (data: {
  translator: Translator;
  failedPhase: string | null | undefined;
}) => string = (data: {
  translator: Translator;
  failedPhase: string | null | undefined;
}): string => {
  const phase: string =
    typeof data.failedPhase === "string" ? data.failedPhase.trim() : "";

  if (!phase || !isRequestFailedPhase(phase)) {
    return phase;
  }

  const words: string = REQUEST_FAILED_PHASE_WORDS[phase];

  return data.translator.translateText(words) || words;
};
