import {
  ComposedValue,
  PluralTemplate,
  SentenceOptions,
  TemplateValues,
  translationKey,
  Translator,
} from "../../Types/Translator";
import { formatDurationInUnit } from "../Milliseconds";

/*
 * WHY A PROBE'S CHECK FAILED, WITH THE VALUES IT FOUND, IN THE READER'S
 * LANGUAGE (#8267).
 *
 * Besides its timeout sentence (ProbeFailureReading) and what a failed
 * request means (RequestFailureDescriptions), a probe writes OneUptime's
 * own sentences about a failed check with the values it found in them: an
 * NTP server that did not answer in time, a name that did not resolve, a
 * probe that could not open an IPv6 connection, a connect whose every
 * attempt failed. A monitor summary draws one as the check's Error, an
 * attempt's line and an incident's root cause after **Cause**, and every
 * one read English on every page.
 *
 * The probe keeps storing the same English - an "Error contains"
 * criterion, a root cause or a log line may compare it - so each sentence
 * is written from this one table, byte for byte as it was written by hand
 * (writeProbeFailureCause): by the NTP check, by ProbeNetworkFailureUtil's
 * describe() (the Website, API, Port, Ping, SSL and NTP checks' probe-side
 * failures), and by the four checks whose connect can fail on every
 * address at once (AggregateError). The views read it back here, only when
 * the whole text is one of the table's (readProbeFailureCause), and draw it
 * in the reader's language (wordProbeFailureCause). Anything else - a
 * message a newer probe writes, a sentence inside a longer text - stays as
 * written.
 *
 * A value stays as the probe found it: a host, an address and its port, an
 * error code, the operating system's own words, a packet the probe
 * ignored, the runtime's message. A timeout the probe wrote in seconds is
 * written again in the reader's language and digits, and so is a count;
 * a sentence the probe put inside another - "{{cause}} Tried 3 times.",
 * the cause after "Request failed with AggregateError" - is read back and
 * drawn in the reader's language too.
 *
 * Reading a sentence with several values takes time that grows with its
 * length: no regular expression reads the stored text. The text is split
 * at the template's fixed pieces, matched from its two ends - the first
 * and the last piece pinned to the text's start and end - and from the
 * side whose value can hold no piece: a host, an address, a code, a count
 * or a duration holds no space, so the piece after it is the first one
 * found, and the piece before it the last one. Each value is checked for
 * what it is (digits for a count, a code's letters, a duration the probe
 * could have written), and a value used twice ("so {{host}} was never
 * contacted ... whether {{host}} is up") must be the same both times.
 *
 * The English are translation keys: the Dashboard's npm run i18n:extract
 * reads this directory.
 */

export enum ProbeFailureCause {
  // NtpMonitor: the lookup and the query of an NTP server.
  NtpLookupTimedOut = "NtpLookupTimedOut",
  NtpNoReply = "NtpNoReply",
  NtpNoReplyIgnoredPackets = "NtpNoReplyIgnoredPackets",
  NtpNameDidNotResolve = "NtpNameDidNotResolve",
  NtpPortUnreachable = "NtpPortUnreachable",
  NtpRequestFailedWithCode = "NtpRequestFailedWithCode",
  NtpRequestFailed = "NtpRequestFailed",
  /*
   * NtpMonitor: an attempt's cause, after every attempt failed. Dataverse's
   * client (DataverseApi) says it of a request it asked again, too.
   */
  TriedTimes = "TriedTimes",

  // ProbeNetworkFailureUtil.describe: a failure on the probe's own side.
  ProbeCouldNotOpenIPv6Connection = "ProbeCouldNotOpenIPv6Connection",
  ProbeCannotSendIPv6 = "ProbeCannotSendIPv6",
  ProbeCouldNotReachOverIPv6 = "ProbeCouldNotReachOverIPv6",
  ProbeMayHaveNoRoute = "ProbeMayHaveNoRoute",
  ProbeHasNoRoute = "ProbeHasNoRoute",
  ProbeCouldNotSendTraffic = "ProbeCouldNotSendTraffic",

  // A connect whose every attempt failed: Website, API, Ping and Port.
  AllConnectionAttemptsFailedWithAttempts = "AllConnectionAttemptsFailedWithAttempts",
  AllConnectionAttemptsFailed = "AllConnectionAttemptsFailed",

  /*
   * NtpMonitorUtil.describeWhyNotSynchronized: a server that answered, but
   * is not serving synchronized time (#8656).
   */
  NtpKissOfDeath = "NtpKissOfDeath",
  NtpUnknownKissCode = "NtpUnknownKissCode",
  NtpStratumZero = "NtpStratumZero",
  NtpNoUsableTime = "NtpNoUsableTime",
  NtpLeapAlarm = "NtpLeapAlarm",
  NtpStratumTooHigh = "NtpStratumTooHigh",
  NtpNotSynchronized = "NtpNotSynchronized",

  // A Website or API attempt that the server answered with an error.
  ServerReturned = "ServerReturned",

  /*
   * PingMonitor: why a host did not answer, and the message the check
   * throws around it (stored as the thrown error's text, "Error: ...").
   */
  PingIcmpNotUsable = "PingIcmpNotUsable",
  PingCouldNotResolve = "PingCouldNotResolve",
  PingNoEchoReply = "PingNoEchoReply",
  PingUnableToReachHost = "PingUnableToReachHost",
  PingProbeSide = "PingProbeSide",
  ThrownError = "ThrownError",

  /*
   * NetworkPathMonitor: a traceroute that could not run, and
   * ProbeNetworkFailureUtil.describeClause's clauses it says why with.
   */
  TracerouteCouldNotRun = "TracerouteCouldNotRun",
  ClauseCannotSendIPv6 = "ClauseCannotSendIPv6",
  ClauseNoIPv6Route = "ClauseNoIPv6Route",
  ClauseHasNoRoute = "ClauseHasNoRoute",
  ClauseMayHaveNoRoute = "ClauseMayHaveNoRoute",
  ClauseCouldNotSendTraffic = "ClauseCouldNotSendTraffic",
}

/*
 * What a kiss code means, after "The server answered with a kiss-o'-death
 * (RATE): " - the codes RFC 5905 (section 7.4) names. A clause of
 * OneUptime's, so a translation key; the code is the server's.
 */
export const NTP_KISS_CODE_MEANINGS: Readonly<Record<string, string>> = {
  ACST: translationKey("the association belongs to a unicast server"),
  AUTH: translationKey("server authentication failed"),
  AUTO: translationKey("the Autokey sequence failed"),
  BCST: translationKey("the association belongs to a broadcast server"),
  CRYP: translationKey("cryptographic authentication or identification failed"),
  DENY: translationKey("the server denies access to this probe"),
  DROP: translationKey("the server lost the association"),
  RSTR: translationKey("the server's access rules refuse this probe"),
  INIT: translationKey(
    "the server has not synchronized its clock for the first time yet",
  ),
  MCST: translationKey(
    "the association belongs to a dynamically discovered server",
  ),
  NKEY: translationKey("no authentication key was found for this probe"),
  NTSN: translationKey(
    "the server refused the Network Time Security (NTS) cookie",
  ),
  RATE: translationKey(
    "the server is rate-limiting this probe and asks it to poll less often",
  ),
  RMOT: translationKey("the association was altered by a remote host"),
  STEP: translationKey(
    "the server's clock was just stepped and has not resynchronized yet",
  ),
};

const KISS_CODE_MEANING_SET: ReadonlySet<string> = new Set<string>(
  Object.values(NTP_KISS_CODE_MEANINGS),
);

/*
 * The one sentence a count-dependent cause is written as for a count of
 * one, beside its general sentence (PluralTemplate): "a packet" for one,
 * "{{count}} packets" for more.
 */
export const NTP_NO_REPLY_IGNORED_PACKETS: PluralTemplate = {
  // Stored under the general sentence's key plus "_one", never on its own.
  one: "No NTP reply from {{target}} within {{seconds}}. The probe ignored a packet that did not answer its request: {{reply}}.",
  other: translationKey(
    "No NTP reply from {{target}} within {{seconds}}. The probe ignored {{count}} packets that did not answer its request: {{reply}}.",
  ),
};

// Each cause, as the probe stores it: its English, a translation key.
export const PROBE_FAILURE_CAUSES: Readonly<Record<ProbeFailureCause, string>> =
  {
    [ProbeFailureCause.NtpLookupTimedOut]: translationKey(
      "Looking up {{host}} did not finish within {{seconds}}.",
    ),
    [ProbeFailureCause.NtpNoReply]: translationKey(
      "No NTP reply from {{target}} within {{seconds}}.",
    ),
    [ProbeFailureCause.NtpNoReplyIgnoredPackets]:
      NTP_NO_REPLY_IGNORED_PACKETS.other,
    [ProbeFailureCause.NtpNameDidNotResolve]: translationKey(
      "Could not resolve {{host}} ({{code}}).",
    ),
    [ProbeFailureCause.NtpPortUnreachable]: translationKey(
      "{{target}} refused the request: nothing is listening for NTP on UDP port {{port}} there (ICMP port unreachable).",
    ),
    [ProbeFailureCause.NtpRequestFailedWithCode]: translationKey(
      "The NTP request to {{target}} failed: {{message}} ({{code}}).",
    ),
    [ProbeFailureCause.NtpRequestFailed]: translationKey(
      "The NTP request to {{target}} failed: {{message}}.",
    ),
    [ProbeFailureCause.TriedTimes]: translationKey(
      "{{cause}} Tried {{count}} times.",
    ),

    [ProbeFailureCause.ProbeCouldNotOpenIPv6Connection]: translationKey(
      "This probe could not open an IPv6 connection from its own side ({{detail}}), so {{host}} was never contacted. This usually means the probe has no usable IPv6 address or route (less often, that it has run out of local ports); this says nothing about whether {{host}} is up. Monitor IPv6 destinations from a probe that has IPv6 connectivity.",
    ),
    [ProbeFailureCause.ProbeCannotSendIPv6]: translationKey(
      "This probe cannot send IPv6 traffic ({{detail}}), so {{host}} was never contacted. The probe has no usable IPv6 address or route; this says nothing about whether {{host}} is up. Monitor IPv6 destinations from a probe that has IPv6 connectivity.",
    ),
    [ProbeFailureCause.ProbeCouldNotReachOverIPv6]: translationKey(
      "This probe could not reach {{host}} over IPv6 ({{detail}}). Most likely this probe has no IPv6 route rather than {{host}} being down. Monitor IPv6 destinations from a probe that has IPv6 connectivity.",
    ),
    [ProbeFailureCause.ProbeMayHaveNoRoute]: translationKey(
      "This probe may have no route to {{host}} ({{detail}}); {{host}} itself may also be down.",
    ),
    [ProbeFailureCause.ProbeHasNoRoute]: translationKey(
      "This probe has no route to {{host}}: {{detail}}.",
    ),
    [ProbeFailureCause.ProbeCouldNotSendTraffic]: translationKey(
      "This probe could not send traffic to {{host}} ({{detail}}), so {{host}} was never contacted. The failure is on the probe, not on {{host}}.",
    ),

    [ProbeFailureCause.AllConnectionAttemptsFailedWithAttempts]: translationKey(
      "Request failed with AggregateError (all connection attempts failed). {{error}}. Attempts: {{attempts}}",
    ),
    [ProbeFailureCause.AllConnectionAttemptsFailed]: translationKey(
      "Request failed with AggregateError (all connection attempts failed). {{error}}",
    ),

    [ProbeFailureCause.NtpKissOfDeath]: translationKey(
      "The server answered with a kiss-o'-death ({{kissCode}}): {{meaning}}.",
    ),
    [ProbeFailureCause.NtpUnknownKissCode]: translationKey(
      "The server answered with a kiss-o'-death ({{kissCode}}): the server answered with the kiss code {{kissCode}} instead of the time.",
    ),
    [ProbeFailureCause.NtpStratumZero]: translationKey(
      "The server answered with stratum 0: it does not know its stratum, so it is not synchronized.",
    ),
    [ProbeFailureCause.NtpNoUsableTime]: translationKey(
      "The server answered, but its reply carried no usable time.",
    ),
    [ProbeFailureCause.NtpLeapAlarm]: translationKey(
      "The server reports its clock as not synchronized (leap indicator 3, alarm).",
    ),
    [ProbeFailureCause.NtpStratumTooHigh]: translationKey(
      "The server reports stratum {{stratum}}: it is not synchronized to a time source.",
    ),
    [ProbeFailureCause.NtpNotSynchronized]: translationKey(
      "The server is not synchronized.",
    ),

    [ProbeFailureCause.ServerReturned]: translationKey(
      "Server returned {{status}}",
    ),

    [ProbeFailureCause.PingIcmpNotUsable]: translationKey(
      "ICMP ping is not usable on this probe: {{output}}",
    ),
    [ProbeFailureCause.PingCouldNotResolve]: translationKey(
      "This probe could not resolve {{host}}: {{output}}",
    ),
    [ProbeFailureCause.PingNoEchoReply]: translationKey(
      "No ICMP echo reply from {{host}} ({{count}} sent)",
    ),
    [ProbeFailureCause.PingUnableToReachHost]: translationKey(
      "Unable to reach host {{host}}. {{cause}} Monitor ID: {{monitorId}}",
    ),
    [ProbeFailureCause.PingProbeSide]: translationKey(
      "{{cause}} Monitor ID: {{monitorId}}",
    ),
    // What the runtime writes for a thrown error: its name, then its message.
    [ProbeFailureCause.ThrownError]: translationKey("Error: {{cause}}"),

    [ProbeFailureCause.TracerouteCouldNotRun]: translationKey(
      "Traceroute could not run: {{clause}}.",
    ),
    [ProbeFailureCause.ClauseCannotSendIPv6]: translationKey(
      "this probe cannot send IPv6 traffic ({{detail}})",
    ),
    [ProbeFailureCause.ClauseNoIPv6Route]: translationKey(
      "this probe most likely has no IPv6 route ({{detail}})",
    ),
    [ProbeFailureCause.ClauseHasNoRoute]: translationKey(
      "this probe has no route to {{host}} ({{detail}})",
    ),
    [ProbeFailureCause.ClauseMayHaveNoRoute]: translationKey(
      "this probe may have no route to {{host}} ({{detail}}); {{host}} itself may also be down",
    ),
    [ProbeFailureCause.ClauseCouldNotSendTraffic]: translationKey(
      "this probe could not send traffic to {{host}} ({{detail}})",
    ),
  };

/*
 * The values a cause carries, as the probe has them. A timeout is in
 * milliseconds (the probe writes it in seconds, writeProbeSeconds); every
 * other value is written as it is.
 */
export interface ProbeFailureCauseValues {
  host?: string | undefined;
  target?: string | undefined;
  timeoutInMs?: number | undefined;
  code?: string | undefined;
  port?: number | string | undefined;
  count?: number | undefined;
  detail?: string | undefined;
  message?: string | undefined;
  reply?: string | undefined;
  error?: string | undefined;
  attempts?: string | undefined;
  cause?: string | undefined;
  kissCode?: string | undefined;
  meaning?: string | undefined;
  stratum?: number | undefined;
  status?: number | string | undefined;
  output?: string | undefined;
  monitorId?: string | undefined;
  clause?: string | undefined;
}

// A cause read back: its values as stored.
export interface ProbeFailureCauseReading {
  cause: ProbeFailureCause;
  // The count-dependent cause's count of one, written as its one sentence.
  isOne?: boolean | undefined;
  values: Record<string, string>;
}

/*
 * What a value can hold, which says how a stored text is split round it:
 *
 *   - "token": a host, an address with its port - no space, so no piece;
 *   - "code": an error code as Node writes one (ENOTFOUND, EAI_AGAIN);
 *   - "digits": a count or a port, Latin digits as String() writes them;
 *   - "seconds": a timeout as writeProbeSeconds wrote it ("2.5 seconds");
 *   - "kiss meaning": what a kiss code means, one of NTP_KISS_CODE_MEANINGS;
 *   - "text": anything - the operating system's or the runtime's words, a
 *     packet, another sentence.
 */
enum ValueKind {
  Token = "token",
  Code = "code",
  Digits = "digits",
  Seconds = "seconds",
  KissMeaning = "kiss meaning",
  // Anything: detail, message, reply, error, attempts, cause, output, clause.
  Text = "text",
}

// What the value a placeholder names can hold.
const kindOf: (name: string) => ValueKind = (name: string): ValueKind => {
  switch (name) {
    case "host":
    case "target":
    case "kissCode":
    case "monitorId":
      return ValueKind.Token;
    case "code":
      return ValueKind.Code;
    case "port":
    case "count":
    case "stratum":
    case "status":
      return ValueKind.Digits;
    case "meaning":
      return ValueKind.KissMeaning;
    case "seconds":
      return ValueKind.Seconds;
    default:
      return ValueKind.Text;
  }
};

// The longest value of a kind other than text the probe could write.
const MAX_TOKEN_LENGTH: number = 1000;

const WHITESPACE: RegExp = /\s/;
const ERROR_CODE: RegExp = /^[A-Z][A-Z0-9_]{0,63}$/;
const DIGITS: RegExp = /^[0-9]{1,9}$/;
const SECONDS: RegExp = /^([0-9]{1,9}(?:\.[0-9])?) seconds?$/;

/*
 * A timeout in seconds, as the probe writes it in a cause: rounded to a
 * tenth, "1 second", "2.5 seconds" - word for word the English NtpMonitor
 * wrote by hand.
 */
export const writeProbeSeconds: (milliseconds: number) => string = (
  milliseconds: number,
): string => {
  const seconds: number = Math.round((milliseconds / 1000) * 10) / 10;

  return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
};

// The seconds a stored timeout names, when the probe could have written it.
const readSeconds: (text: string) => number | null = (
  text: string,
): number | null => {
  if (text.length > 24) {
    return null;
  }

  const match: RegExpExecArray | null = SECONDS.exec(text);

  if (!match) {
    return null;
  }

  const seconds: number = Number(match[1]);

  return Number.isFinite(seconds) && writeProbeSeconds(seconds * 1000) === text
    ? seconds
    : null;
};

const isValueOfKind: (kind: ValueKind, value: string) => boolean = (
  kind: ValueKind,
  value: string,
): boolean => {
  if (!value.trim()) {
    return false;
  }

  switch (kind) {
    case ValueKind.Token:
      return value.length <= MAX_TOKEN_LENGTH && !WHITESPACE.test(value);
    case ValueKind.Code:
      return ERROR_CODE.test(value);
    case ValueKind.Digits:
      return DIGITS.test(value);
    case ValueKind.Seconds:
      return readSeconds(value) !== null;
    case ValueKind.KissMeaning:
      return KISS_CODE_MEANING_SET.has(value);
    case ValueKind.Text:
      return true;
  }
};

// A template, split at its placeholders: the fixed pieces round each value.
interface SplitTemplate {
  pieces: Array<string>;
  names: Array<string>;
}

const PLACEHOLDER: RegExp = /\{\{(\w+)\}\}/g;

const splitTemplate: (template: string) => SplitTemplate = (
  template: string,
): SplitTemplate => {
  const pieces: Array<string> = [];
  const names: Array<string> = [];
  let at: number = 0;

  for (const match of template.matchAll(PLACEHOLDER)) {
    pieces.push(template.slice(at, match.index));
    names.push(match[1] as string);
    at = (match.index as number) + match[0].length;
  }

  pieces.push(template.slice(at));

  return { pieces, names };
};

// A value that holds no fixed piece: the piece beside it is the nearest one.
const holdsNoPiece: (name: string) => boolean = (name: string): boolean => {
  return kindOf(name) !== ValueKind.Text;
};

/*
 * The values `stored` holds as `template` writes them, or null when it is
 * not that template. Matched from both ends, in time that grows with the
 * text's length (see the head of this file).
 */
export const matchProbeFailureTemplate: (
  stored: string,
  template: string,
) => Record<string, string> | null = (
  stored: string,
  template: string,
): Record<string, string> | null => {
  const { pieces, names } = splitTemplate(template);
  const first: string = pieces[0] as string;
  const last: string = pieces[pieces.length - 1] as string;

  if (names.length === 0) {
    return stored === template ? {} : null;
  }

  if (
    stored.length < first.length + last.length ||
    !stored.startsWith(first) ||
    !stored.endsWith(last)
  ) {
    return null;
  }

  // Where each value starts and ends in the stored text.
  const starts: Array<number> = new Array<number>(names.length).fill(-1);
  const ends: Array<number> = new Array<number>(names.length).fill(-1);

  starts[0] = first.length;
  ends[names.length - 1] = stored.length - last.length;

  let low: number = 0;
  let high: number = names.length - 1;

  while (low < high) {
    const lowStart: number = starts[low] as number;
    const highEnd: number = ends[high] as number;

    if (
      holdsNoPiece(names[low] as string) ||
      !holdsNoPiece(names[high] as string)
    ) {
      // The piece after the value at `low`: the first one after it.
      const piece: string = pieces[low + 1] as string;
      const at: number = stored.indexOf(piece, lowStart);

      if (at === -1 || at + piece.length > highEnd) {
        return null;
      }

      ends[low] = at;
      starts[low + 1] = at + piece.length;
      low += 1;
    } else {
      // The piece before the value at `high`: the last one before it.
      const piece: string = pieces[high] as string;
      const at: number = stored.lastIndexOf(piece, highEnd - piece.length);

      if (at === -1 || at < lowStart) {
        return null;
      }

      starts[high] = at + piece.length;
      ends[high - 1] = at;
      high -= 1;
    }
  }

  const values: Record<string, string> = {};

  for (let index: number = 0; index < names.length; index++) {
    const name: string = names[index] as string;
    const start: number = starts[index] as number;
    const end: number = ends[index] as number;

    if (start < 0 || end < start) {
      return null;
    }

    const value: string = stored.slice(start, end);

    if (!isValueOfKind(kindOf(name), value)) {
      return null;
    }

    // A value written twice is the same value both times.
    if (
      Object.prototype.hasOwnProperty.call(values, name) &&
      values[name] !== value
    ) {
      return null;
    }

    values[name] = value;
  }

  return values;
};

// describe()'s sentences: a failure on the probe's own side.
const PROBE_SIDE_CAUSES: ReadonlyArray<ProbeFailureCause> = [
  ProbeFailureCause.ProbeCouldNotOpenIPv6Connection,
  ProbeFailureCause.ProbeCannotSendIPv6,
  ProbeFailureCause.ProbeCouldNotReachOverIPv6,
  ProbeFailureCause.ProbeMayHaveNoRoute,
  ProbeFailureCause.ProbeHasNoRoute,
  ProbeFailureCause.ProbeCouldNotSendTraffic,
];

// describeClause's clauses: only ever inside the traceroute's sentence.
const CLAUSES: ReadonlyArray<ProbeFailureCause> = [
  ProbeFailureCause.ClauseCannotSendIPv6,
  ProbeFailureCause.ClauseNoIPv6Route,
  ProbeFailureCause.ClauseHasNoRoute,
  ProbeFailureCause.ClauseMayHaveNoRoute,
  ProbeFailureCause.ClauseCouldNotSendTraffic,
];

/*
 * A cause that holds another, by the placeholder it holds it in, and the
 * causes it may hold - the ones the check writes there. The cause it
 * holds must be one of them, so a held sentence is read only where the
 * probe writes one: "Error: " before anything else is a runtime's error,
 * not one of OneUptime's.
 */
interface HeldCause {
  name: string;
  causes: ReadonlyArray<ProbeFailureCause>;
}

const HELD_CAUSES: Partial<Record<ProbeFailureCause, HeldCause>> = {
  // NtpMonitor's attempt error, after every attempt failed.
  [ProbeFailureCause.TriedTimes]: {
    name: "cause",
    causes: [
      ProbeFailureCause.NtpLookupTimedOut,
      ProbeFailureCause.NtpNoReplyIgnoredPackets,
      ProbeFailureCause.NtpNoReply,
      ProbeFailureCause.NtpNameDidNotResolve,
      ProbeFailureCause.NtpPortUnreachable,
      ProbeFailureCause.NtpRequestFailedWithCode,
      ProbeFailureCause.NtpRequestFailed,
      ...PROBE_SIDE_CAUSES,
    ],
  },
  // PingMonitor's message about a host that did not answer.
  [ProbeFailureCause.PingUnableToReachHost]: {
    name: "cause",
    causes: [
      ProbeFailureCause.PingCouldNotResolve,
      ProbeFailureCause.PingNoEchoReply,
      ...PROBE_SIDE_CAUSES,
    ],
  },
  // PingMonitor's message when the probe itself could not ping.
  [ProbeFailureCause.PingProbeSide]: {
    name: "cause",
    causes: [ProbeFailureCause.PingIcmpNotUsable, ...PROBE_SIDE_CAUSES],
  },
  // The Ping monitor stores its thrown message with the error's name.
  [ProbeFailureCause.ThrownError]: {
    name: "cause",
    causes: [
      ProbeFailureCause.PingUnableToReachHost,
      ProbeFailureCause.PingProbeSide,
    ],
  },
  [ProbeFailureCause.TracerouteCouldNotRun]: {
    name: "clause",
    causes: CLAUSES,
  },
};

/*
 * The order a stored text is read in: a cause that holds another first -
 * "<an NTP cause> Tried 3 times." is that, not an NTP cause whose packet
 * or message ends in "Tried 3 times" - and a sentence with a value more
 * before the same sentence without it (", ... Attempts: ...", "(CODE)").
 */
const READING_ORDER: ReadonlyArray<ProbeFailureCause> = [
  ProbeFailureCause.ThrownError,
  ProbeFailureCause.PingUnableToReachHost,
  ProbeFailureCause.PingProbeSide,
  ProbeFailureCause.TriedTimes,
  ProbeFailureCause.TracerouteCouldNotRun,
  ProbeFailureCause.AllConnectionAttemptsFailedWithAttempts,
  ProbeFailureCause.AllConnectionAttemptsFailed,
  ProbeFailureCause.NtpLookupTimedOut,
  ProbeFailureCause.NtpNoReplyIgnoredPackets,
  ProbeFailureCause.NtpNoReply,
  ProbeFailureCause.NtpNameDidNotResolve,
  ProbeFailureCause.NtpPortUnreachable,
  ProbeFailureCause.NtpRequestFailedWithCode,
  ProbeFailureCause.NtpRequestFailed,
  ProbeFailureCause.NtpUnknownKissCode,
  ProbeFailureCause.NtpKissOfDeath,
  ProbeFailureCause.NtpStratumZero,
  ProbeFailureCause.NtpNoUsableTime,
  ProbeFailureCause.NtpLeapAlarm,
  ProbeFailureCause.NtpStratumTooHigh,
  ProbeFailureCause.NtpNotSynchronized,
  ProbeFailureCause.ServerReturned,
  ProbeFailureCause.PingIcmpNotUsable,
  ProbeFailureCause.PingCouldNotResolve,
  ProbeFailureCause.PingNoEchoReply,
  ...PROBE_SIDE_CAUSES,
  ...CLAUSES,
];

// A text stored on its own: every cause but a clause, which only a sentence holds.
const STANDING_ALONE: ReadonlyArray<ProbeFailureCause> = READING_ORDER.filter(
  (cause: ProbeFailureCause): boolean => {
    return !CLAUSES.includes(cause);
  },
);
/*
 * The text the probe stores for `cause` - word for word the English it
 * wrote by hand: the English with each value put in as it is (a timeout in
 * seconds, writeProbeSeconds; a count and a port as String() writes them),
 * however many braces or dollar signs a value holds. The count-dependent
 * cause writes its one sentence for a count of one.
 */
export const writeProbeFailureCause: (
  cause: ProbeFailureCause,
  values?: ProbeFailureCauseValues,
) => string = (
  cause: ProbeFailureCause,
  values?: ProbeFailureCauseValues,
): string => {
  const template: string =
    cause === ProbeFailureCause.NtpNoReplyIgnoredPackets && values?.count === 1
      ? NTP_NO_REPLY_IGNORED_PACKETS.one
      : PROBE_FAILURE_CAUSES[cause];
  const { pieces, names } = splitTemplate(template);
  const given: Record<string, unknown> = (values || {}) as Record<
    string,
    unknown
  >;

  // As the template literal the probe wrote did: `${value}`, piece by piece.
  return pieces
    .map((piece: string, index: number): string => {
      const name: string | undefined = names[index];

      if (name === undefined) {
        return piece;
      }

      const value: string =
        name === "seconds"
          ? writeProbeSeconds(values?.timeoutInMs as number)
          : String(given[name]);

      return `${piece}${value}`;
    })
    .join("");
};

// The checks a cause's values must pass beyond their kinds.
const isReadingOfItsCause: (reading: ProbeFailureCauseReading) => boolean = (
  reading: ProbeFailureCauseReading,
): boolean => {
  const values: Record<string, string> = reading.values;
  const held: HeldCause | undefined = HELD_CAUSES[reading.cause];

  // A cause that holds another holds one the check writes there.
  if (
    held &&
    readProbeFailureCause(values[held.name] || "", { among: held.causes }) ===
      null
  ) {
    return false;
  }

  switch (reading.cause) {
    case ProbeFailureCause.NtpNoReplyIgnoredPackets:
      // "a packet" is the one sentence; the general one counts two or more.
      return reading.isOne === true || Number(values["count"]) >= 2;
    case ProbeFailureCause.TriedTimes:
      // One attempt adds nothing: the probe writes this from two on.
      return Number(values["count"]) >= 2;
    case ProbeFailureCause.NtpRequestFailedWithCode:
      // The probe writes the code only where the message does not hold it.
      return !(values["message"] || "").includes(values["code"] || "");
    default:
      return true;
  }
};

/*
 * The cause a stored text is, when the text is exactly one of the table's
 * (space round it aside), with the values it carries; null for any other
 * text - one close to a cause but not the same, a cause inside a longer
 * text, a newer probe's own - which stays as written. `among` keeps the
 * reading to the causes another one holds.
 */
export const readProbeFailureCause: (
  text: string | null | undefined,
  options?: { among?: ReadonlyArray<ProbeFailureCause> | undefined },
) => ProbeFailureCauseReading | null = (
  text: string | null | undefined,
  options?: { among?: ReadonlyArray<ProbeFailureCause> | undefined },
): ProbeFailureCauseReading | null => {
  const stored: string = typeof text === "string" ? text.trim() : "";

  if (!stored) {
    return null;
  }

  const among: ReadonlyArray<ProbeFailureCause> =
    options?.among || STANDING_ALONE;

  for (const cause of READING_ORDER) {
    if (!among.includes(cause)) {
      continue;
    }

    const templates: Array<{ template: string; isOne: boolean }> =
      cause === ProbeFailureCause.NtpNoReplyIgnoredPackets
        ? [
            { template: NTP_NO_REPLY_IGNORED_PACKETS.one, isOne: true },
            { template: NTP_NO_REPLY_IGNORED_PACKETS.other, isOne: false },
          ]
        : [{ template: PROBE_FAILURE_CAUSES[cause], isOne: false }];

    for (const candidate of templates) {
      const values: Record<string, string> | null = matchProbeFailureTemplate(
        stored,
        candidate.template,
      );

      if (!values) {
        continue;
      }

      const reading: ProbeFailureCauseReading = {
        cause: cause,
        values: values,
      };

      if (candidate.isOne) {
        reading.isOne = true;
      }

      if (isReadingOfItsCause(reading)) {
        return reading;
      }
    }
  }

  return null;
};

/*
 * A sentence another cause holds, as the sentence round it draws it: in
 * the reader's language when it is one of the table's and the language
 * words it, as written otherwise.
 */
const heldCause: (
  text: string,
  among: ReadonlyArray<ProbeFailureCause> | undefined,
  options: SentenceOptions | undefined,
) => ComposedValue = (
  text: string,
  among: ReadonlyArray<ProbeFailureCause> | undefined,
  options: SentenceOptions | undefined,
): ComposedValue => {
  return {
    compose: (translator: Translator): string => {
      return (
        wordProbeFailureCause({
          translator: translator,
          failureCause: text,
          options: options,
          among: among,
        }) ?? text.trim()
      );
    },
  };
};

// A timeout in seconds, in the reader's language and digits.
const secondsInReadersWords: (seconds: number) => ComposedValue = (
  seconds: number,
): ComposedValue => {
  return {
    compose: (translator: Translator): string => {
      return formatDurationInUnit(translator, seconds, "second", {
        decimals: 1,
        dropTrailingZeros: true,
        english: writeProbeSeconds(seconds * 1000),
      });
    },
  };
};

// What a kiss code means, in the reader's words.
const kissCodeMeaning: (meaning: string) => ComposedValue = (
  meaning: string,
): ComposedValue => {
  return {
    compose: (translator: Translator): string => {
      return translator.translateText(meaning) || meaning;
    },
  };
};

// The values a view draws in the reader's digits: OneUptime's counts.
const COUNTED: ReadonlySet<string> = new Set<string>(["count", "stratum"]);

/*
 * A stored cause as a view draws it: in the reader's language when the
 * text is one of the table's and the language words it, each value as the
 * probe found it (set apart from the reader's words when the options ask,
 * for a text drawn on the page), a timeout and a count in the reader's
 * words and digits; null for any other text, and for a cause the reader's
 * language does not word yet, which the caller draws as stored. A status
 * code and a port are codes, and stay as written.
 */
export const wordProbeFailureCause: (data: {
  translator: Translator;
  failureCause: string | null | undefined;
  options?: SentenceOptions | undefined;
  among?: ReadonlyArray<ProbeFailureCause> | undefined;
}) => string | null = (data: {
  translator: Translator;
  failureCause: string | null | undefined;
  options?: SentenceOptions | undefined;
  among?: ReadonlyArray<ProbeFailureCause> | undefined;
}): string | null => {
  const reading: ProbeFailureCauseReading | null = readProbeFailureCause(
    data.failureCause,
    { among: data.among },
  );

  if (!reading) {
    return null;
  }

  const english: string = PROBE_FAILURE_CAUSES[reading.cause];

  if (!data.translator.hasTranslation(english)) {
    return null;
  }

  const isPlural: boolean =
    reading.cause === ProbeFailureCause.NtpNoReplyIgnoredPackets;
  const held: HeldCause | undefined = HELD_CAUSES[reading.cause];
  const values: TemplateValues = {};

  for (const name of Object.keys(reading.values)) {
    const value: string = reading.values[name] as string;

    if (name === "seconds") {
      values[name] = secondsInReadersWords(readSeconds(value) as number);
    } else if (held && name === held.name) {
      values[name] = heldCause(value, held.causes, data.options);
    } else if (name === "error") {
      // The AggregateError's own text, or a sentence of the table's.
      values[name] = heldCause(value, undefined, data.options);
    } else if (name === "meaning") {
      values[name] = kissCodeMeaning(value);
    } else if (COUNTED.has(name)) {
      // A plural writes its own count, in the reader's digits.
      if (!isPlural) {
        values[name] = data.translator.formatNumber(Number(value));
      }
    } else {
      values[name] = value;
    }
  }

  if (isPlural) {
    return data.translator.translatePlural(
      NTP_NO_REPLY_IGNORED_PACKETS,
      reading.isOne ? 1 : Number(reading.values["count"]),
      values,
      data.options,
    );
  }

  return data.translator.translateTemplate(english, values, data.options);
};
