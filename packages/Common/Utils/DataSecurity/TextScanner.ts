import DataConfidence, {
  DATA_CONFIDENCE_RANK,
} from "../../Types/DataSecurity/DataConfidence";
import { CONTEXT_AFTER, CONTEXT_BEFORE, DataTypeDetector } from "./Detector";
import BUILT_IN_DETECTORS from "./Detectors/Index";

/*
 * FINDING SENSITIVE VALUES IN TEXT.
 *
 * Every scan - a log line, a CSV cell, a field of a database row, the first
 * 64 KB of an object - comes down to this: run each detector over the text,
 * keep the candidates its validator accepts, judge each by the words around
 * it, and when two types claim the same characters keep the surer one.
 *
 * Text is read in windows of WINDOW_SIZE characters that overlap by
 * WINDOW_OVERLAP, so a value no longer than the overlap is found whole
 * wherever it sits, and a match is kept only by the window it starts in, so
 * none is counted twice. Windows bound what one regular expression sees,
 * which keeps V8's backtracking shallow however long the text is
 * (AGENTS.md, "Megabyte-long values"), and MAX_SCANNED_TEXT_LENGTH bounds
 * the work one value can ask for.
 */

export const WINDOW_SIZE: number = 65_536;
export const WINDOW_OVERLAP: number = 4_096;

/*
 * How much of the text before its own part a window after the first also
 * reads, keeping no match that starts there: a pattern's look-behind and a
 * type's context words (CONTEXT_BEFORE) see the same text at the start of
 * a window as anywhere else, so "card: " just before a window still
 * confirms the card number after it, and 9 before a window still makes
 * 94111111111111111 one longer token.
 */
export const WINDOW_LEAD: number = 256;

// The most of one value that is read. A sample is bounded long before this.
export const MAX_SCANNED_TEXT_LENGTH: number = 4 * 1024 * 1024;

// The most candidates one detector keeps in one window.
const MAX_CANDIDATES_PER_DETECTOR: number = 512;

/*
 * A detector whose candidates come from code rather than a native regular
 * expression: a project's custom data type, matched by LinearRegExp
 * (CustomDataTypeDetector.ts) so a pattern a person wrote can never hold a
 * worker.
 */
export interface CandidateFinder {
  findCandidates: (
    text: string,
  ) => Array<{ start: number; end: number; value: string }>;
}

export type ScanDetector =
  | DataTypeDetector
  | (Omit<DataTypeDetector, "pattern"> & CandidateFinder);

export interface TextScanOptions {
  // The detectors to run; every built-in one when absent.
  detectors?: ReadonlyArray<ScanDetector> | undefined;
  // Types the field's name hints at: for them the name is context.
  hintedDataTypeIds?: ReadonlySet<string> | undefined;
  // Types the project turned off.
  disabledDataTypeIds?: ReadonlySet<string> | undefined;
  // Values the project says are never sensitive, normalized and lower-cased.
  allowedValues?: ReadonlySet<string> | undefined;
}

export interface TextMatch {
  dataTypeId: string;
  // Where the value starts and ends in the text.
  start: number;
  end: number;
  // The value as its detector normalized it. Never leaves the scan.
  normalized: string;
  confidence: DataConfidence;
  isTestValue: boolean;
}

interface Candidate extends TextMatch {
  score: number;
}

function raise(confidence: DataConfidence): DataConfidence {
  return confidence === DataConfidence.Low
    ? DataConfidence.Medium
    : DataConfidence.High;
}

function lower(confidence: DataConfidence): DataConfidence {
  return confidence === DataConfidence.High
    ? DataConfidence.Medium
    : DataConfidence.Low;
}

function isWordCharacter(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 97 && code <= 122) ||
    (code >= 65 && code <= 90)
  );
}

/*
 * Whether `word` appears in `text` as a word: not inside a longer one, so
 * "pan" is found in "card pan:" and not in "company". Both are lower case.
 */
export function containsWord(text: string, word: string): boolean {
  let from: number = 0;

  for (;;) {
    const index: number = text.indexOf(word, from);

    if (index < 0) {
      return false;
    }

    const before: number = index > 0 ? text.charCodeAt(index - 1) : 32;
    const afterIndex: number = index + word.length;
    const after: number =
      afterIndex < text.length ? text.charCodeAt(afterIndex) : 32;
    const wordStartsWithLetter: boolean = isWordCharacter(word.charCodeAt(0));
    const wordEndsWithLetter: boolean = isWordCharacter(
      word.charCodeAt(word.length - 1),
    );

    if (
      (!wordStartsWithLetter || !isWordCharacter(before)) &&
      (!wordEndsWithLetter || !isWordCharacter(after))
    ) {
      return true;
    }

    from = index + 1;
  }
}

function anyWordNear(
  lowerText: string,
  start: number,
  end: number,
  words: ReadonlyArray<string> | undefined,
  before: number,
  after: number,
): boolean {
  if (!words || words.length === 0) {
    return false;
  }

  const around: string = lowerText.slice(
    Math.max(0, start - before),
    Math.min(lowerText.length, end + after),
  );

  for (const word of words) {
    if (containsWord(around, word)) {
      return true;
    }
  }

  return false;
}

function anyWordIn(
  lowerText: string,
  words: ReadonlyArray<string> | undefined,
): boolean {
  if (!words) {
    return false;
  }

  for (const word of words) {
    if (lowerText.includes(word)) {
      return true;
    }
  }

  return false;
}

function rawCandidates(
  detector: ScanDetector,
  text: string,
): Array<{ start: number; end: number; value: string }> {
  if ("findCandidates" in detector) {
    return detector.findCandidates(text).slice(0, MAX_CANDIDATES_PER_DETECTOR);
  }

  const found: Array<{ start: number; end: number; value: string }> = [];
  const pattern: RegExp = detector.pattern;

  pattern.lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    const group: number = detector.valueGroup || 0;
    const value: string | undefined = match[group];

    if (value === undefined || match.index === undefined) {
      continue;
    }

    // Where the value starts: the group's own place inside the whole match.
    const offset: number = group === 0 ? 0 : match[0].indexOf(value);
    const start: number = match.index + Math.max(0, offset);

    found.push({ start, end: start + value.length, value });

    if (found.length >= MAX_CANDIDATES_PER_DETECTOR) {
      break;
    }
  }

  return found;
}

function scanWindow(
  window: string,
  offset: number,
  acceptFrom: number,
  acceptBefore: number,
  options: TextScanOptions,
  detectors: ReadonlyArray<ScanDetector>,
): Array<Candidate> {
  const lowerWindow: string = window.toLowerCase();
  const candidates: Array<Candidate> = [];

  for (const detector of detectors) {
    if (options.disabledDataTypeIds?.has(detector.dataTypeId)) {
      continue;
    }

    const hinted: boolean = Boolean(
      options.hintedDataTypeIds?.has(detector.dataTypeId),
    );

    // A type that needs context, in a window holding none of its words.
    if (
      detector.requiresContext &&
      !hinted &&
      !anyWordIn(lowerWindow, detector.keywords)
    ) {
      continue;
    }

    if (
      detector.quickCheck &&
      !detector.quickCheck(detector.quickCheckLowerCase ? lowerWindow : window)
    ) {
      continue;
    }

    for (const raw of rawCandidates(detector, window)) {
      if (raw.start < acceptFrom || raw.start >= acceptBefore) {
        continue;
      }

      const normalized: string = detector.normalize
        ? detector.normalize(raw.value)
        : raw.value;

      if (detector.validate && !detector.validate(normalized, raw.value)) {
        continue;
      }

      if (options.allowedValues?.has(normalized.toLowerCase())) {
        continue;
      }

      const before: number = detector.contextBefore ?? CONTEXT_BEFORE;
      const after: number = detector.contextAfter ?? CONTEXT_AFTER;
      const hasContext: boolean =
        hinted ||
        anyWordNear(
          lowerWindow,
          raw.start,
          raw.end,
          detector.keywords,
          before,
          after,
        );

      if (detector.requiresContext && !hasContext) {
        continue;
      }

      let confidence: DataConfidence = detector.confidenceWithoutContext;

      if (hasContext) {
        confidence = raise(confidence);
      }

      if (
        anyWordNear(
          lowerWindow,
          raw.start,
          raw.end,
          detector.negativeKeywords,
          CONTEXT_BEFORE,
          CONTEXT_AFTER,
        )
      ) {
        confidence = lower(confidence);
      }

      candidates.push({
        dataTypeId: detector.dataTypeId,
        start: offset + raw.start,
        end: offset + raw.end,
        normalized,
        confidence,
        isTestValue: Boolean(detector.isTestValue?.(normalized)),
        // Confidence first, then whether its own words confirm it, then specificity.
        score:
          DATA_CONFIDENCE_RANK[confidence] * 100 +
          (hasContext ? 10 : 0) +
          detector.specificity,
      });
    }
  }

  return candidates;
}

/*
 * When candidates claim overlapping characters, the surer one wins - higher
 * confidence, then the one its own words confirm (a Danish CPR number next
 * to "cpr" over a Bulgarian EGN its digits also pass), then the more
 * specific detector, then the longer match - and the others give way.
 * Candidates that overlap nothing all stay.
 */
export function resolveOverlaps(
  candidates: Array<Candidate>,
): Array<TextMatch> {
  const sorted: Array<Candidate> = [...candidates].sort(
    (a: Candidate, b: Candidate) => {
      return a.start - b.start || b.end - a.end;
    },
  );

  const kept: Array<TextMatch> = [];
  let cluster: Array<Candidate> = [];
  let clusterEnd: number = -1;

  const settle: () => void = (): void => {
    const byScore: Array<Candidate> = [...cluster].sort(
      (a: Candidate, b: Candidate) => {
        return b.score - a.score || b.end - b.start - (a.end - a.start);
      },
    );
    const accepted: Array<Candidate> = [];

    for (const candidate of byScore) {
      const overlaps: boolean = accepted.some((other: Candidate) => {
        return candidate.start < other.end && other.start < candidate.end;
      });

      if (!overlaps) {
        accepted.push(candidate);
      }
    }

    for (const candidate of accepted) {
      kept.push({
        dataTypeId: candidate.dataTypeId,
        start: candidate.start,
        end: candidate.end,
        normalized: candidate.normalized,
        confidence: candidate.confidence,
        isTestValue: candidate.isTestValue,
      });
    }

    cluster = [];
  };

  for (const candidate of sorted) {
    if (cluster.length > 0 && candidate.start >= clusterEnd) {
      settle();
    }

    if (cluster.length === 0) {
      clusterEnd = candidate.end;
    }

    cluster.push(candidate);
    clusterEnd = Math.max(clusterEnd, candidate.end);
  }

  if (cluster.length > 0) {
    settle();
  }

  return kept.sort((a: TextMatch, b: TextMatch) => {
    return a.start - b.start;
  });
}

export function findSensitiveValues(
  text: string,
  options: TextScanOptions = {},
): Array<TextMatch> {
  if (!text) {
    return [];
  }

  const detectors: ReadonlyArray<ScanDetector> =
    options.detectors || BUILT_IN_DETECTORS;
  const bounded: string =
    text.length > MAX_SCANNED_TEXT_LENGTH
      ? text.slice(0, MAX_SCANNED_TEXT_LENGTH)
      : text;
  const step: number = WINDOW_SIZE - WINDOW_OVERLAP;
  const candidates: Array<Candidate> = [];

  for (let start: number = 0; start < bounded.length; start += step) {
    // The text just before the window's own part, read for context only.
    const lead: number = Math.min(WINDOW_LEAD, start);
    const window: string = bounded.slice(start - lead, start + WINDOW_SIZE);
    const isLast: boolean = start + WINDOW_SIZE >= bounded.length;

    // One at a time: a window can hold more candidates than a spread takes.
    for (const candidate of scanWindow(
      window,
      start - lead,
      lead,
      isLast ? Number.MAX_SAFE_INTEGER : lead + step,
      options,
      detectors,
    )) {
      candidates.push(candidate);
    }

    if (isLast) {
      break;
    }
  }

  return resolveOverlaps(candidates);
}
