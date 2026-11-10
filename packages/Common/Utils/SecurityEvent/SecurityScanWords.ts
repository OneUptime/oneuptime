import {
  SECURITY_LOG_PREFILTER,
  SecurityLogPrefilterGroup,
  matchesSecurityLogPrefilter,
} from "./LogParsers/SecurityLogParser";
import {
  CLOUD_METADATA_MARKERS,
  PROMPT_INJECTION_PHRASES,
  squashWhiteSpace,
} from "./TelemetryScan/TraceSignals";

/*
 * THE WORDS the security scans find in a log line or a span wherever they
 * are, lowercased: an attack string in a request, the start of an SSH
 * sign-in, a sudo command, a cloud metadata address, a prompt-injection
 * phrase.
 *
 * A scan asks the database for the rows that hold these words, so its
 * own query holds them. A database writes down the queries it runs: when
 * a query fails, ClickHouse logs its text with the parameters filled in,
 * and keeps it in system.query_log. If that log is collected like any
 * other (OneUptime's Kubernetes agent reads every pod's), the scan reads
 * its own query back as the attack its words spell (issue #6419). So a
 * statement sends any text that holds one of these words hex encoded
 * (Server/Utils/AnalyticsDatabase/Statement.ts), and what ClickHouse
 * writes down is hex.
 */
export const SECURITY_SCAN_WORDS: ReadonlyArray<string> = Array.from(
  new Set<string>(
    [
      ...SECURITY_LOG_PREFILTER.anyOf,
      ...CLOUD_METADATA_MARKERS,
      ...PROMPT_INJECTION_PHRASES,
    ].map((word: string): string => {
      return word.toLowerCase();
    }),
  ),
);

function holdsAnyScanWord(lowerText: string): boolean {
  for (const word of SECURITY_SCAN_WORDS) {
    if (lowerText.indexOf(word) !== -1) {
      return true;
    }
  }

  return false;
}

/*
 * A PLAIN TEXT - letters, digits and "._-" alone: an id, a name, an
 * attribute's key, most of what a statement sends. It reads the same in
 * every form below (no white space to squash, nothing a URL encodes), so
 * only a word made of those characters can be in it, and only a prefilter
 * group whose required word and one of whose other words are. Reading it
 * through those alone gives the same answer as reading it whole, and ids
 * by the thousand in one IN list are read quickly.
 */
function isPlainText(text: string): boolean {
  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);

    if (
      !(
        (code >= 97 && code <= 122) ||
        (code >= 65 && code <= 90) ||
        (code >= 48 && code <= 57) ||
        code === 46 ||
        code === 95 ||
        code === 45
      )
    ) {
      return false;
    }
  }

  return true;
}

const PLAIN_SCAN_WORDS: ReadonlyArray<string> =
  SECURITY_SCAN_WORDS.filter(isPlainText);

const PLAIN_GROUP_REQUIRES: ReadonlyArray<string> =
  SECURITY_LOG_PREFILTER.groups
    .filter((group: SecurityLogPrefilterGroup): boolean => {
      return isPlainText(group.requires) && group.anyOf.some(isPlainText);
    })
    .map((group: SecurityLogPrefilterGroup): string => {
      return group.requires.toLowerCase();
    });

function holdsPlainScanWord(text: string, lower: string): boolean {
  for (const word of PLAIN_SCAN_WORDS) {
    if (lower.indexOf(word) !== -1) {
      return true;
    }
  }

  for (const requires of PLAIN_GROUP_REQUIRES) {
    if (lower.indexOf(requires) !== -1) {
      return matchesSecurityLogPrefilter(text);
    }
  }

  return false;
}

/*
 * A text as a URL's query string carries it (application/x-www-form-urlencoded):
 * how the ClickHouse client sends a parameter, and so how a proxy's access
 * log or a span's url.full writes it down.
 */
function asUrlQueryValue(text: string): string {
  return new URLSearchParams([["v", text]]).toString().slice("v=".length);
}

/*
 * Whether a text a query sends would read as a security record wherever the
 * query is written down. That is when it holds a scan word in one of these
 * forms:
 *
 * - as written;
 * - with its white space squashed, which is how a prompt is read;
 * - URL-encoded, the way the client sends it.
 *
 * It is also when the text would pass the log scan's prefilter on its own,
 * as a search for a whole sign-in line does.
 */
export function holdsSecurityScanWord(text: string): boolean {
  if (!text) {
    return false;
  }

  const lower: string = text.toLowerCase();

  if (isPlainText(text)) {
    return holdsPlainScanWord(text, lower);
  }

  if (holdsAnyScanWord(lower)) {
    return true;
  }

  const squashed: string = squashWhiteSpace(lower);

  if (squashed !== lower && holdsAnyScanWord(squashed)) {
    return true;
  }

  const urlEncoded: string = asUrlQueryValue(text).toLowerCase();

  if (urlEncoded !== lower && holdsAnyScanWord(urlEncoded)) {
    return true;
  }

  return matchesSecurityLogPrefilter(text);
}
