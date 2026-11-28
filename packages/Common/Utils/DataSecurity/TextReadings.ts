import { anyWordIn, anyWordNear } from "./ContextWords";
import { CONTEXT_AFTER, CONTEXT_BEFORE, DataTypeDetector } from "./Detector";
import { readDigitsOfEveryScript } from "./DigitReadings";
import { readFullwidthForms } from "./FullwidthForms";
import PercentDecodedText from "./PercentDecodedText";
import PlusAsSpaceText from "./PlusAsSpaceText";

/*
 * THE WAYS ONE TEXT IS READ, AND WHERE A MATCH IN EACH IS WRITTEN.
 *
 * A detector reads a text as it is written. One that asks also reads it
 * with its percent-escapes read (readsPercentEncoded, #10467: an address in
 * an encoded URL; a character's UTF-8 bytes each escaped too, #11032), or
 * with every script's digits read by their values (readsDigitsOfEveryScript,
 * #10960: a card in fullwidth or Arabic-Indic digits) - and one that asks
 * for both, with every script's digits read in the text as its escapes
 * read as well (a fullwidth digit escaped, %EF%BC%94). One that reads a
 * value written in groups, or the words before one, also reads the text
 * as a URL's query string reads it: a "+" for the space a form writes it
 * as, its escapes read (readsPlusAsSpace, #11199:
 * card=4111+1111+1111+1111, PlusAsSpaceText) - with every script's digits
 * read there too when it reads them. A detector of a number also reads
 * each of those with a number's fullwidth signs and separators read as
 * their ASCII characters, as Japanese and Chinese text types one
 * (readsFullwidthForms, #11115: ＋８１ ３－１２３４－５６７８,
 * FullwidthForms) - with every script's digits read in that too. A match
 * found in a reading is placed on the characters the text writes it with,
 * so what it finds - and what a scrub rule hides - is the value as
 * written, escapes and "+"s and fullwidth forms and all.
 *
 * Data Security's scanner (TextScanner.ts) reads each window so, for the
 * detectors that ask; and every scrub rule built on the detectors finds its
 * matches through findDetectorRanges here: the IP Address rule
 * (Utils/Telemetry/ScrubIpAddress.ts), the Email Address, Credit Card,
 * Phone Number and SSN rules (Utils/Telemetry/ScrubBuiltInPatterns.ts) and
 * a metric pipeline rule's Matches Pattern Type filter, which compiles
 * those (Server/Utils/Telemetry/MetricPipelineEngine.ts). A detector whose
 * type is one only beside its words (requiresContext: a national phone
 * number, nine digits beside "SSN", #11114) finds a value there only with
 * one of its words near it, as the scanner judges it (isWordNear). So a
 * finding and the rule that covers it read a text the same ways, in every
 * place a rule runs.
 *
 * Each reading is made the first time a detector asks for it, once a text,
 * in one pass (PercentDecodedText, PlusAsSpaceText, DigitReadings,
 * FullwidthForms): in time in line with the text's length.
 */

// A range of a text: [start, end).
export type TextRange = [number, number];

// A text as a detector reads it, and where each of its positions is written.
export interface TextReading {
  text: string;
  // Where a position of the reading - a character's start, or its end - is written.
  toWritten: (position: number) => number;
}

// What a detector asks to be read in, beside the text as written.
export interface ReadingNeeds {
  readsPercentEncoded?: boolean | undefined;
  readsDigitsOfEveryScript?: boolean | undefined;
  readsPlusAsSpace?: boolean | undefined;
  readsFullwidthForms?: boolean | undefined;
}

function samePosition(position: number): number {
  return position;
}

/*
 * The readings of one text, each made the first time it is asked for: the
 * text as written, as its percent-escapes read, as a URL's query string
 * reads it, with every script's digits read by their values, and each of
 * the first three with a number's fullwidth signs and separators read as
 * ASCII.
 */
export class TextReadings {
  public readonly written: TextReading;
  private percentDecoded: TextReading | null | undefined = undefined;
  private plusAsSpace: TextReading | null | undefined = undefined;
  // Whether a form wrote the text: a "+" written in it is a space (PlusAsSpaceText).
  private isFormWritten: boolean = false;
  private plusAsSpaceDigitReadings: Array<TextReading> | undefined = undefined;
  private digitReadings: Array<TextReading> | undefined = undefined;
  private decodedDigitReadings: Array<TextReading> | undefined = undefined;
  // Each reading's fullwidth reading (FullwidthForms), or null for none.
  private readonly fullwidthOf: Map<TextReading, TextReading | null> = new Map<
    TextReading,
    TextReading | null
  >();
  // The digit readings of each fullwidth reading.
  private readonly fullwidthDigitsOf: Map<TextReading, Array<TextReading>> =
    new Map<TextReading, Array<TextReading>>();
  // Each reading in lower case, made the first time its words are read.
  private readonly lowerCase: Map<TextReading, string> = new Map<
    TextReading,
    string
  >();

  public constructor(text: string) {
    this.written = { text: text, toWritten: samePosition };
  }

  /*
   * A reading in lower case, where the words around a value are looked
   * for (isWordNear): made once a reading, whoever asks.
   */
  public lowerCaseOf(reading: TextReading): string {
    let lower: string | undefined = this.lowerCase.get(reading);

    if (lower === undefined) {
      lower = reading.text.toLowerCase();
      this.lowerCase.set(reading, lower);
    }

    return lower;
  }

  /*
   * A reading of the text - as written, with its escapes read, or as a
   * query string reads it - with a number's fullwidth signs and separators
   * read as ASCII (FullwidthForms, #11115): ＋８１ ３－１２３４－５６７８ as
   * +８１ ３-１２３４-５６７８, whose digits every script's digit readings then
   * read. Null when the reading holds no such form beside a digit. As long
   * as the reading it folds, so placed as that one places it.
   */
  public getFullwidthFormsOf(base: TextReading): TextReading | null {
    let folded: TextReading | null | undefined = this.fullwidthOf.get(base);

    if (folded === undefined) {
      const text: string | null = readFullwidthForms(base.text);

      folded = text === null ? null : { text, toWritten: base.toWritten };
      this.fullwidthOf.set(base, folded);
    }

    return folded;
  }

  // The text as written with its fullwidth forms read, or null (getFullwidthFormsOf).
  public getFullwidthForms(): TextReading | null {
    return this.getFullwidthFormsOf(this.written);
  }

  /*
   * A fullwidth reading with each script's digits read alone, then all of
   * them together, as getDigitsOfEveryScript reads the text: a number
   * typed wholly in fullwidth, its digits and its separators (#11115).
   * Placed as the fullwidth reading places it.
   */
  public getDigitsOfEveryScriptOfFullwidth(
    folded: TextReading,
  ): Array<TextReading> {
    let readings: Array<TextReading> | undefined =
      this.fullwidthDigitsOf.get(folded);

    if (readings === undefined) {
      readings = readDigitsOfEveryScript(folded.text).map(
        (reading: string): TextReading => {
          return { text: reading, toWritten: folded.toWritten };
        },
      );
      this.fullwidthDigitsOf.set(folded, readings);
    }

    return readings;
  }

  // The text with its percent-escapes read, or null when it holds none.
  public getPercentDecoded(): TextReading | null {
    if (this.percentDecoded === undefined) {
      const decoded: PercentDecodedText | null = PercentDecodedText.read(
        this.written.text,
      );

      this.percentDecoded = decoded
        ? {
            text: decoded.readable,
            toWritten: (position: number): number => {
              return decoded.toWritten(position);
            },
          }
        : null;
    }

    return this.percentDecoded;
  }

  /*
   * The text as a URL's query string reads it - each "+" a form wrote for
   * a space a space, its escapes read, and an escaped "+" between two
   * characters of a value a space too (PlusAsSpaceText, #11199) - or null
   * when it holds no such "+": then it reads as its escapes read, which
   * getPercentDecoded is.
   */
  public getPlusAsSpace(): TextReading | null {
    if (this.plusAsSpace === undefined) {
      const read: PlusAsSpaceText | null = PlusAsSpaceText.read(
        this.written.text,
      );

      this.isFormWritten = Boolean(read?.isFormWritten);
      this.plusAsSpace = read
        ? {
            text: read.readable,
            toWritten: (position: number): number => {
              return read.toWritten(position);
            },
          }
        : null;
    }

    return this.plusAsSpace;
  }

  /*
   * The text with each script's digits read alone, then all of them
   * together: none when it holds no digit beyond ASCII. Each is as long as
   * the text, so a position is where it is written.
   */
  public getDigitsOfEveryScript(): Array<TextReading> {
    if (this.digitReadings === undefined) {
      this.digitReadings = readDigitsOfEveryScript(this.written.text).map(
        (reading: string): TextReading => {
          return { text: reading, toWritten: samePosition };
        },
      );
    }

    return this.digitReadings;
  }

  /*
   * The text with its percent-escapes read, then each script's digits read
   * as getDigitsOfEveryScript reads them: a digit of another script
   * escaped in UTF-8 (%EF%BC%94 is ４, #11032) is read by its value too.
   * None when the reading holds no digit beyond ASCII. Each placed as the
   * reading of the escapes places it.
   */
  public getDigitsOfEveryScriptPercentDecoded(): Array<TextReading> {
    if (this.decodedDigitReadings === undefined) {
      const decoded: TextReading | null = this.getPercentDecoded();

      this.decodedDigitReadings = decoded
        ? readDigitsOfEveryScript(decoded.text).map(
            (reading: string): TextReading => {
              return { text: reading, toWritten: decoded.toWritten };
            },
          )
        : [];
    }

    return this.decodedDigitReadings;
  }

  /*
   * The text as a URL's query string reads it, then each script's digits
   * read as getDigitsOfEveryScript reads them: a card in Arabic-Indic
   * digits typed into a form, its groups joined by "+" (#11199). None
   * when the text holds no "+" a query string means a space by, or that
   * reading no digit beyond ASCII. Each placed as that reading places it.
   */
  public getDigitsOfEveryScriptPlusAsSpace(): Array<TextReading> {
    if (this.plusAsSpaceDigitReadings === undefined) {
      const spaced: TextReading | null = this.getPlusAsSpace();

      this.plusAsSpaceDigitReadings = spaced
        ? readDigitsOfEveryScript(spaced.text).map(
            (reading: string): TextReading => {
              return { text: reading, toWritten: spaced.toWritten };
            },
          )
        : [];
    }

    return this.plusAsSpaceDigitReadings;
  }

  /*
   * The readings that read a text's words and signs differently, of those
   * a detector reads: as written, with its escapes read, as a query string
   * reads it.
   */
  private baseReadingsFor(needs: ReadingNeeds): Array<TextReading> {
    const readings: Array<TextReading> = [this.written];

    if (needs.readsPercentEncoded) {
      const decoded: TextReading | null = this.getPercentDecoded();

      if (decoded) {
        readings.push(decoded);
      }
    }

    if (needs.readsPlusAsSpace) {
      const spaced: TextReading | null = this.getPlusAsSpace();

      if (spaced) {
        readings.push(spaced);
      }
    }

    return readings;
  }

  // The fullwidth readings of the base readings a detector reads, for one that asks.
  private fullwidthReadingsFor(
    needs: ReadingNeeds,
    bases: ReadonlyArray<TextReading>,
  ): Array<TextReading> {
    const readings: Array<TextReading> = [];

    if (!needs.readsFullwidthForms) {
      return readings;
    }

    for (const base of bases) {
      const folded: TextReading | null = this.getFullwidthFormsOf(base);

      if (folded) {
        readings.push(folded);
      }
    }

    return readings;
  }

  /*
   * Every reading a detector reads, the text as written first, and the
   * fullwidth ones last, so a detector that does not read them reads what
   * it always has, in the order it always has.
   */
  public readingsFor(needs: ReadingNeeds): Array<TextReading> {
    const readings: Array<TextReading> = this.baseReadingsFor(needs);
    const folded: Array<TextReading> = this.fullwidthReadingsFor(
      needs,
      readings,
    );

    if (needs.readsDigitsOfEveryScript) {
      for (const reading of this.getDigitsOfEveryScript()) {
        readings.push(reading);
      }
    }

    if (needs.readsPercentEncoded && needs.readsDigitsOfEveryScript) {
      for (const reading of this.getDigitsOfEveryScriptPercentDecoded()) {
        readings.push(reading);
      }
    }

    if (needs.readsPlusAsSpace && needs.readsDigitsOfEveryScript) {
      for (const reading of this.getDigitsOfEveryScriptPlusAsSpace()) {
        readings.push(reading);
      }
    }

    for (const reading of folded) {
      readings.push(reading);
    }

    if (needs.readsDigitsOfEveryScript) {
      for (const reading of folded) {
        for (const digits of this.getDigitsOfEveryScriptOfFullwidth(reading)) {
          readings.push(digits);
        }
      }
    }

    return readings;
  }

  /*
   * The readings a detector's candidates are found in (findDetectorRanges,
   * TextScanner): those it reads (readingsFor), but for a detector that
   * reads a text as a URL's query string reads it, not the one with its
   * escapes read alone where a form wrote the text (#11199): there a "+"
   * written is a space, and read as a "+" it makes a number of what is
   * none - "(718) 487-63058", which a form writes %28718%29+487-63058,
   * read so holds the international number +487-63058. The query
   * string's reading reads every escape that one does, an escaped "+" as
   * the "+" it is. The same holds of the escapes' reading with its
   * fullwidth forms read (#11115), and its digits. A rule's own pattern
   * still reads every reading (findInEveryReading), so it hides at least
   * what a finding is.
   */
  public detectorReadingsFor(needs: ReadingNeeds): Array<TextReading> {
    const readings: Array<TextReading> = this.readingsFor(needs);

    if (
      !needs.readsPlusAsSpace ||
      this.getPlusAsSpace() === null ||
      !this.isFormWritten
    ) {
      return readings;
    }

    const decoded: TextReading | null = this.getPercentDecoded();
    const decodedDigits: Array<TextReading> =
      this.getDigitsOfEveryScriptPercentDecoded();
    const decodedFolded: TextReading | null = decoded
      ? this.fullwidthOf.get(decoded) ?? null
      : null;
    const decodedFoldedDigits: Array<TextReading> = decodedFolded
      ? this.fullwidthDigitsOf.get(decodedFolded) || []
      : [];

    return readings.filter((reading: TextReading): boolean => {
      return (
        reading !== decoded &&
        reading !== decodedFolded &&
        !decodedDigits.includes(reading) &&
        !decodedFoldedDigits.includes(reading)
      );
    });
  }

  /*
   * The readings that read a text's words differently, of those a
   * detector reads: as written, with its escapes read, as a query string
   * reads it, and each of those with its fullwidth forms read - an
   * ideographic space between two words is a space (#11115) - for a
   * detector that reads them; every script's digits change no word. Where
   * the words a candidate needs around it are looked for: date%20of%20birth
   * and date+of+birth are the words date of birth (#11199).
   */
  public wordReadingsFor(needs: ReadingNeeds): Array<TextReading> {
    return this.readingsFor({
      readsPercentEncoded: needs.readsPercentEncoded,
      readsPlusAsSpace: needs.readsPlusAsSpace,
      readsFullwidthForms: needs.readsFullwidthForms,
    });
  }
}

const PERCENT_CODE: number = 0x25;

function isHexDigitAt(text: string, at: number): boolean {
  const code: number = text.charCodeAt(at);

  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x46) ||
    (code >= 0x61 && code <= 0x66)
  );
}

// Whether `at` is one of a "%XX" escape's hex digits.
function isInsideAnEscape(text: string, at: number): boolean {
  return (
    (at >= 1 &&
      text.charCodeAt(at - 1) === PERCENT_CODE &&
      isHexDigitAt(text, at) &&
      isHexDigitAt(text, at + 1)) ||
    (at >= 2 &&
      text.charCodeAt(at - 2) === PERCENT_CODE &&
      isHexDigitAt(text, at - 1) &&
      isHexDigitAt(text, at))
  );
}

/*
 * Whether a range of a text starts or ends inside a "%XX" escape: what a
 * detector finds in it as written, gluing an escape's hex digits to the
 * characters beside it - %2212345678901%22 written in a URL holds
 * 2212345678901 as written, its quote's "22" first (#11199).
 */
export function cutsAnEscape(
  text: string,
  start: number,
  end: number,
): boolean {
  return isInsideAnEscape(text, start) || isInsideAnEscape(text, end);
}

/*
 * Whether a candidate of a number's detector - one that reads a text as a
 * URL's query string reads it (readsPlusAsSpace) - is a run of digits
 * glued to an escape's hex digits as written (cutsAnEscape): no number,
 * nor the value's either. The escape is one character, and the text as
 * its escapes read holds the value without it, placed on the characters
 * it is written with, which the detector reads too. The scanner and the
 * rules built on the detectors (findDetectorRanges) both leave such a
 * candidate, so a finding and its rule agree. An IP address detector's,
 * which reads no query string's "+", is taken as it always was, and its
 * rule hides it too: 99%2001::1 may be a percent sign glued to an address
 * as much as an escape.
 */
export function isGluedToAnEscape(
  detector: ReadingNeeds,
  text: string,
  start: number,
  end: number,
): boolean {
  return Boolean(detector.readsPlusAsSpace) && cutsAnEscape(text, start, end);
}

/*
 * Ranges sorted, and those that overlap made one: what two readings or two
 * detectors share is one range, so a value is hidden whole.
 */
export function mergeRanges(ranges: Array<TextRange>): Array<TextRange> {
  if (ranges.length < 2) {
    return ranges.map((range: TextRange): TextRange => {
      return [range[0], range[1]];
    });
  }

  const sorted: Array<TextRange> = ranges
    .map((range: TextRange): TextRange => {
      return [range[0], range[1]];
    })
    .sort((a: TextRange, b: TextRange): number => {
      return a[0] - b[0] || b[1] - a[1];
    });
  const merged: Array<TextRange> = [sorted[0]!];

  for (let index: number = 1; index < sorted.length; index++) {
    const range: TextRange = sorted[index]!;
    const last: TextRange = merged[merged.length - 1]!;

    if (range[0] < last[1]) {
      last[1] = Math.max(last[1], range[1]);
    } else {
      merged.push(range);
    }
  }

  return merged;
}

/*
 * Where a finder's matches are in a text, read in each of the readings
 * `needs` names - as written, and as its escapes or its digits read - each
 * placed on the characters the text writes it with, those that overlap made
 * one.
 */
export function findInEveryReading(data: {
  text: string;
  needs: ReadingNeeds;
  findIn: (reading: string) => Array<TextRange>;
  readings?: TextReadings | undefined;
}): Array<TextRange> {
  if (!data.text) {
    return [];
  }

  const readings: TextReadings = data.readings || new TextReadings(data.text);
  const found: Array<TextRange> = [];

  for (const reading of readings.readingsFor(data.needs)) {
    for (const [start, end] of data.findIn(reading.text)) {
      found.push([reading.toWritten(start), reading.toWritten(end)]);
    }
  }

  return mergeRanges(found);
}

// Whether a detector's quick check lets a text through: always, without one.
export function passesQuickCheck(
  detector: Pick<DataTypeDetector, "quickCheck" | "quickCheckLowerCase">,
  text: string,
): boolean {
  return (
    !detector.quickCheck ||
    detector.quickCheck(
      detector.quickCheckLowerCase ? text.toLowerCase() : text,
    )
  );
}

/*
 * Where one detector's accepted candidates are in one reading, as the
 * scanner judges them: its quick check, its pattern, and its validator on
 * the value as normalized.
 */
export function acceptedRangesIn(
  detector: DataTypeDetector,
  text: string,
): Array<TextRange> {
  const ranges: Array<TextRange> = [];

  if (!text || !passesQuickCheck(detector, text)) {
    return ranges;
  }

  const pattern: RegExp = detector.pattern;

  pattern.lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    const group: number = detector.valueGroup || 0;
    const value: string | undefined = match[group];

    if (value === undefined || match.index === undefined || value === "") {
      continue;
    }

    const offset: number = group === 0 ? 0 : match[0].indexOf(value);
    const start: number = match.index + Math.max(0, offset);
    const normalized: string = detector.normalize
      ? detector.normalize(value)
      : value;

    if (detector.validate && !detector.validate(normalized, value)) {
      continue;
    }

    ranges.push([start, start + value.length]);
  }

  return ranges;
}

// What a detector's words are, and how far around a candidate they are looked for.
export interface ContextOfDetector extends ReadingNeeds {
  keywords?: ReadonlyArray<string> | undefined;
  contextBefore?: number | undefined;
  contextAfter?: number | undefined;
}

// How far before and after a candidate its detector's words are looked for.
export function contextReachOf(detector: ContextOfDetector): {
  before: number;
  after: number;
} {
  return {
    before: detector.contextBefore ?? CONTEXT_BEFORE,
    after: detector.contextAfter ?? CONTEXT_AFTER,
  };
}

/*
 * Whether a text holds any of a detector's words, in a reading that reads
 * its words (wordReadingsFor) - as written, with its escapes read, as a
 * query string reads it, its fullwidth forms read: the scanner reads no
 * candidate of a type that needs its words in a text that holds none, nor
 * do the rules built on the detectors.
 */
export function holdsWordsOf(
  readings: TextReadings,
  detector: ContextOfDetector,
): boolean {
  return readings
    .wordReadingsFor(detector)
    .some((reading: TextReading): boolean => {
      return anyWordIn(readings.lowerCaseOf(reading), detector.keywords);
    });
}

/*
 * WHETHER A DETECTOR'S WORDS SIT NEAR A CANDIDATE, AS THE SCANNER JUDGES
 * IT (#11114).
 *
 * A candidate found in a reading of a text - [start, end) of that reading
 * - has its words near it when one is a word of the text as written, from
 * `before` characters before where it is written to `after` characters
 * after, or of the reading it was found in, around it there:
 * "aws%20secret%20access%20key%3A" reads "aws secret access key:"
 * (#11031). The scanner judges every candidate so (TextScanner.scanWindow),
 * and the rules built on the detectors judge a candidate of a type that is
 * one only beside its words so too (findDetectorRanges): "tel 0201234567"
 * is a phone number, "order 0201234567" is none.
 */
export function isWordNear(data: {
  readings: TextReadings;
  // The reading the candidate was found in, and where in it.
  reading: TextReading;
  start: number;
  end: number;
  words: ReadonlyArray<string> | undefined;
  before: number;
  after: number;
}): boolean {
  const readings: TextReadings = data.readings;

  return (
    anyWordNear(
      readings.lowerCaseOf(readings.written),
      data.reading.toWritten(data.start),
      data.reading.toWritten(data.end),
      data.words,
      data.before,
      data.after,
    ) ||
    (data.reading !== readings.written &&
      anyWordNear(
        readings.lowerCaseOf(data.reading),
        data.start,
        data.end,
        data.words,
        data.before,
        data.after,
      ))
  );
}

/*
 * THE ONE FUNCTION A RULE BUILT ON THE DETECTORS FINDS ITS MATCHES WITH.
 *
 * Where the detectors find their data type in a text: [start, end) ranges,
 * left to right, none overlapping. Each detector reads the text as written,
 * and in each reading it asks for, placed on the written characters; what
 * two detectors or two readings share is one range.
 *
 * A detector of a type that is one only beside a word that names it
 * (requiresContext) finds a value only with one of its words near it, as
 * the scanner judges it (isWordNear, #11114): a national phone number of
 * no other shape beside "tel", nine digits in a row beside "SSN". So a rule
 * hides what Data Security finds in the value it reads, words and all, and
 * never a run of digits no word names. The field's name the scanner also
 * counts as a word (hintedDataTypeIds) is not the value's, and a rule
 * reads the value alone.
 */
export function findDetectorRanges(
  detectors: ReadonlyArray<DataTypeDetector>,
  text: string,
  // The text's readings, when another finder reads them too.
  readingsOfText?: TextReadings | undefined,
): Array<TextRange> {
  if (!text) {
    return [];
  }

  const readings: TextReadings = readingsOfText || new TextReadings(text);
  const found: Array<TextRange> = [];

  for (const detector of detectors) {
    if (detector.requiresContext && !holdsWordsOf(readings, detector)) {
      continue;
    }

    const reach: { before: number; after: number } = contextReachOf(detector);

    for (const reading of readings.detectorReadingsFor(detector)) {
      for (const [start, end] of acceptedRangesIn(detector, reading.text)) {
        const writtenStart: number = reading.toWritten(start);
        const writtenEnd: number = reading.toWritten(end);

        if (
          isGluedToAnEscape(detector, text, writtenStart, writtenEnd) ||
          (detector.requiresContext &&
            !isWordNear({
              readings,
              reading,
              start,
              end,
              words: detector.keywords,
              before: reach.before,
              after: reach.after,
            }))
        ) {
          continue;
        }

        found.push([writtenStart, writtenEnd]);
      }
    }
  }

  return mergeRanges(found);
}
