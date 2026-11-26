import DataConfidence, {
  DATA_CONFIDENCE_RANK,
} from "../../Types/DataSecurity/DataConfidence";
import { CONTEXT_AFTER, CONTEXT_BEFORE, DataTypeDetector } from "./Detector";
import BUILT_IN_DETECTORS from "./Detectors/Index";
import {
  confidenceOfScore,
  isRecognizedTestValue,
  keywordsOf,
  normalizeRecognizedValue,
  RecognizedEntity,
} from "./Model/RecognizedEntity";
import { readableForModel } from "./Model/ModelTextReading";
import {
  findQueryStringNames,
  QUERY_NAME_DATA_TYPE_ID,
} from "./QueryStringNames";
import { TextReading, TextReadings } from "./TextReadings";

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
 * (Docs/notifications/README.md, "Megabyte-long values"), and
 * MAX_SCANNED_TEXT_LENGTH bounds the work one value can ask for.
 *
 * A detector that reads percent-encoded text (readsPercentEncoded - the IP
 * address and email ones, #10467, #10935) also reads each window with its
 * escapes read, and one that reads every script's digits
 * (readsDigitsOfEveryScript - the card ones, #10960) with each script's
 * digits read by their values (TextReadings): a candidate found there is
 * validated as it reads and placed on the characters it is written with, so
 * it is judged by the words around it as written, and kept by the window it
 * starts in like any other.
 *
 * A person's name has no pattern: it is found by the names-and-addresses
 * model in what it read (`recognized`), and - in a scan that runs every
 * built-in detector - by the name of a URL's query parameter that holds it,
 * full_name=Jos%C3%A9%20Garc%C3%ADa, as a field's name finds it in a column
 * (QueryStringNames, #11034).
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
  /*
   * The pattern the candidates come from, as the project wrote it: what a
   * database search narrows by (DetectorPrefilter). Never run here.
   */
  patternSource?: { source: string; flags: string } | undefined;
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
  /*
   * Whether a person's name a URL's query parameter names is found too
   * (QueryStringNames, #11034). When absent, a scan that runs every
   * built-in detector reads them and one that runs some alone does not; a
   * read of a person's name finding's own records - which runs no detector
   * of its own, a name having none - says so.
   */
  readsQueryStringNames?: boolean | undefined;
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
  /*
   * Found by the names-and-addresses model (Model/RecognizedEntity.ts), not
   * a detector's pattern: masked as a name-found value is, and never
   * fingerprinted - a name is too common to say two stores hold the same
   * data.
   */
  fromModel?: boolean | undefined;
  /*
   * Found by the name of the field that holds it inside the text - a URL's
   * query parameter named for a person's name (QueryStringNames, #11034):
   * masked as its name-found type is, and never fingerprinted either.
   */
  fromFieldName?: boolean | undefined;
}

// How far around a model's finding its context words are looked for.
const MODEL_CONTEXT_BEFORE: number = CONTEXT_BEFORE;
const MODEL_CONTEXT_AFTER: number = CONTEXT_AFTER;

/*
 * A model's findings in a text as candidates, judged by the same rules as a
 * detector's (RecognizedEntity.ts): a type the project turned off is
 * skipped, a value it allows is no finding, the field's name or the words
 * around a value raise its confidence a level, and a placeholder is a test
 * value. They then compete with the detectors' candidates for the same
 * characters like any other (resolveOverlaps), as the least specific kind.
 */
function modelCandidates(
  text: string,
  recognized: ReadonlyArray<RecognizedEntity>,
  options: TextScanOptions,
): Array<Candidate> {
  const candidates: Array<Candidate> = [];

  for (const entity of recognized) {
    if (
      !Number.isInteger(entity.start) ||
      !Number.isInteger(entity.end) ||
      entity.start < 0 ||
      entity.end > text.length ||
      entity.start >= entity.end ||
      options.disabledDataTypeIds?.has(entity.dataTypeId)
    ) {
      continue;
    }

    // As the model read it: a name in a URL is allowed, or a placeholder, as it reads (#11034).
    const normalized: string = normalizeRecognizedValue(
      readableForModel(text.slice(entity.start, entity.end)),
    );

    if (
      normalized.length === 0 ||
      options.allowedValues?.has(normalized.toLowerCase())
    ) {
      continue;
    }

    const contextStart: number = Math.max(
      0,
      entity.start - MODEL_CONTEXT_BEFORE,
    );
    const around: string = text
      .slice(
        contextStart,
        Math.min(text.length, entity.end + MODEL_CONTEXT_AFTER),
      )
      .toLowerCase();
    const hasContext: boolean =
      Boolean(options.hintedDataTypeIds?.has(entity.dataTypeId)) ||
      anyWordNear(
        around,
        entity.start - contextStart,
        entity.end - contextStart,
        keywordsOf(entity.dataTypeId),
        MODEL_CONTEXT_BEFORE,
        MODEL_CONTEXT_AFTER,
      );
    let confidence: DataConfidence = confidenceOfScore(entity.score);

    if (hasContext) {
      confidence = raise(confidence);
    }

    candidates.push({
      dataTypeId: entity.dataTypeId,
      start: entity.start,
      end: entity.end,
      normalized,
      confidence,
      isTestValue: isRecognizedTestValue(entity.dataTypeId, normalized),
      fromModel: true,
      score: DATA_CONFIDENCE_RANK[confidence] * 100 + (hasContext ? 10 : 0) + 1,
    });
  }

  return candidates;
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

// Whether a detector's quick check lets a text through: always, without one.
function passesQuickCheck(
  detector: ScanDetector,
  text: string,
  lowerText: () => string,
): boolean {
  return (
    !detector.quickCheck ||
    detector.quickCheck(detector.quickCheckLowerCase ? lowerText() : text)
  );
}

/*
 * A candidate placed on the characters the window writes it with, and the
 * reading it was found in, with where in that reading it sits: its words
 * are read there too.
 */
interface WindowCandidate {
  start: number;
  end: number;
  value: string;
  reading: TextReading;
  readingStart: number;
  readingEnd: number;
}

/*
 * A detector's candidates in a window: as it is written and in each
 * reading it asks for - with its percent-escapes read, with every script's
 * digits read by their values - placed on the characters they are written
 * with. `readings` reads the window once for every detector that asks.
 */
function windowCandidates(
  detector: ScanDetector,
  readings: TextReadings,
  lowerOf: (reading: TextReading) => string,
): Array<WindowCandidate> {
  const found: Array<WindowCandidate> = [];

  for (const reading of readings.readingsFor(detector)) {
    if (
      !passesQuickCheck(detector, reading.text, (): string => {
        return lowerOf(reading);
      })
    ) {
      continue;
    }

    for (const raw of rawCandidates(detector, reading.text)) {
      found.push({
        start: reading.toWritten(raw.start),
        end: reading.toWritten(raw.end),
        value: raw.value,
        reading,
        readingStart: raw.start,
        readingEnd: raw.end,
      });
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
  // The window's readings, each read the first time a detector asks for it.
  const readings: TextReadings = new TextReadings(window);
  // Each reading in lower case, made the first time its words are read.
  const lowerReadings: Map<TextReading, string> = new Map([
    [readings.written, lowerWindow],
  ]);
  const lowerOf: (reading: TextReading) => string = (
    reading: TextReading,
  ): string => {
    let lower: string | undefined = lowerReadings.get(reading);

    if (lower === undefined) {
      lower = reading.text.toLowerCase();
      lowerReadings.set(reading, lower);
    }

    return lower;
  };

  /*
   * Whether words sit near a candidate: in the window as written, or in
   * the reading it was found in - "aws%20secret%20access%20key%3A" reads
   * "aws secret access key:" (#11031).
   */
  const isNear: (
    raw: WindowCandidate,
    words: ReadonlyArray<string> | undefined,
    before: number,
    after: number,
  ) => boolean = (
    raw: WindowCandidate,
    words: ReadonlyArray<string> | undefined,
    before: number,
    after: number,
  ): boolean => {
    return (
      anyWordNear(lowerWindow, raw.start, raw.end, words, before, after) ||
      (raw.reading !== readings.written &&
        anyWordNear(
          lowerOf(raw.reading),
          raw.readingStart,
          raw.readingEnd,
          words,
          before,
          after,
        ))
    );
  };

  for (const detector of detectors) {
    if (options.disabledDataTypeIds?.has(detector.dataTypeId)) {
      continue;
    }

    const hinted: boolean = Boolean(
      options.hintedDataTypeIds?.has(detector.dataTypeId),
    );
    const decoded: TextReading | null = detector.readsPercentEncoded
      ? readings.getPercentDecoded()
      : null;

    // A type that needs context, in a window holding none of its words, as written or decoded.
    if (
      detector.requiresContext &&
      !hinted &&
      !anyWordIn(lowerWindow, detector.keywords) &&
      !(decoded && anyWordIn(lowerOf(decoded), detector.keywords))
    ) {
      continue;
    }

    for (const raw of windowCandidates(detector, readings, lowerOf)) {
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
        hinted || isNear(raw, detector.keywords, before, after);

      if (detector.requiresContext && !hasContext) {
        continue;
      }

      let confidence: DataConfidence = detector.confidenceWithoutContext;

      if (hasContext) {
        confidence = raise(confidence);
      }

      if (
        isNear(raw, detector.negativeKeywords, CONTEXT_BEFORE, CONTEXT_AFTER)
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
      const match: TextMatch = {
        dataTypeId: candidate.dataTypeId,
        start: candidate.start,
        end: candidate.end,
        normalized: candidate.normalized,
        confidence: candidate.confidence,
        isTestValue: candidate.isTestValue,
      };

      if (candidate.fromModel) {
        match.fromModel = true;
      }

      if (candidate.fromFieldName) {
        match.fromFieldName = true;
      }

      kept.push(match);
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

/*
 * `recognized` is what the names-and-addresses model found in this same
 * text, for a value it read (Model/RecognizedEntity.ts): its findings join
 * the detectors' before overlaps are settled.
 */
export function findSensitiveValues(
  text: string,
  options: TextScanOptions = {},
  recognized?: ReadonlyArray<RecognizedEntity> | undefined,
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

  if (recognized && recognized.length > 0) {
    for (const candidate of modelCandidates(bounded, recognized, options)) {
      candidates.push(candidate);
    }
  }

  if (
    (options.readsQueryStringNames ?? readsEveryBuiltInDetector(detectors)) &&
    !options.disabledDataTypeIds?.has(QUERY_NAME_DATA_TYPE_ID)
  ) {
    for (const candidate of queryNameCandidates(bounded, options)) {
      candidates.push(candidate);
    }
  }

  return resolveOverlaps(candidates);
}

/*
 * Whether a scan's detectors are every built-in one - the project's own
 * types after them, as every scan lists them - so it reads what the
 * catalog's rules find beside the detectors: a person's name a query
 * parameter names (#11034). A caller that runs some detectors alone, to
 * judge one type, reads only theirs.
 */
function readsEveryBuiltInDetector(
  detectors: ReadonlyArray<ScanDetector>,
): boolean {
  const last: number = BUILT_IN_DETECTORS.length - 1;

  return (
    detectors === BUILT_IN_DETECTORS ||
    (detectors.length > last &&
      detectors[0] === BUILT_IN_DETECTORS[0] &&
      detectors[last] === BUILT_IN_DETECTORS[last])
  );
}

/*
 * The person's names a text's URLs hold under a parameter named for one
 * (QueryStringNames, #11034), as candidates: High - the parameter's name
 * says what its value is, and the value has a name's shape - competing for
 * their characters like any other, as the least specific kind.
 */
function queryNameCandidates(
  text: string,
  options: TextScanOptions,
): Array<Candidate> {
  const candidates: Array<Candidate> = [];

  for (const name of findQueryStringNames(text)) {
    if (options.allowedValues?.has(name.normalized.toLowerCase())) {
      continue;
    }

    candidates.push({
      dataTypeId: QUERY_NAME_DATA_TYPE_ID,
      start: name.start,
      end: name.end,
      normalized: name.normalized,
      confidence: DataConfidence.High,
      isTestValue: name.isTestValue,
      fromFieldName: true,
      score: DATA_CONFIDENCE_RANK[DataConfidence.High] * 100 + 10 + 1,
    });
  }

  return candidates;
}
