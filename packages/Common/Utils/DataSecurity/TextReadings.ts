import { DataTypeDetector } from "./Detector";
import { readDigitsOfEveryScript } from "./DigitReadings";
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
 * read there too when it reads them. A match found in a reading is placed
 * on the characters the text writes it with, so what it finds - and what a
 * scrub rule hides - is the value as written, escapes and "+"s and all.
 *
 * Data Security's scanner (TextScanner.ts) reads each window so, for the
 * detectors that ask; and every scrub rule built on the detectors finds its
 * matches through findDetectorRanges here: the IP Address rule
 * (Utils/Telemetry/ScrubIpAddress.ts), the Email Address and Credit Card
 * rules (Utils/Telemetry/ScrubBuiltInPatterns.ts), and a metric pipeline
 * rule's Holds Data Type filter (Server/Utils/Telemetry/
 * MetricPipelineEngine.ts). So a finding and the rule that covers it read a
 * text the same ways, in every place a rule runs.
 *
 * Each reading is made the first time a detector asks for it, once a text,
 * in one pass (PercentDecodedText, PlusAsSpaceText, DigitReadings): in time
 * in line with the text's length.
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
}

function samePosition(position: number): number {
  return position;
}

/*
 * The readings of one text, each made the first time it is asked for: the
 * text as written, as its percent-escapes read, as a URL's query string
 * reads it, and with every script's digits read by their values.
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

  public constructor(text: string) {
    this.written = { text: text, toWritten: samePosition };
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

  // Every reading a detector reads, the text as written first.
  public readingsFor(needs: ReadingNeeds): Array<TextReading> {
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
   * the "+" it is. A rule's own pattern still reads every reading
   * (findInEveryReading), so it hides at least what a finding is.
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

    return readings.filter((reading: TextReading): boolean => {
      return reading !== decoded && !decodedDigits.includes(reading);
    });
  }

  /*
   * The readings that read a text's words differently, of those a
   * detector reads: as written, with its escapes read, as a query string
   * reads it - every script's digits change no word. Where the words a
   * candidate needs around it are looked for: date%20of%20birth and
   * date+of+birth are the words date of birth (#11199).
   */
  public wordReadingsFor(needs: ReadingNeeds): Array<TextReading> {
    return this.readingsFor({
      readsPercentEncoded: needs.readsPercentEncoded,
      readsPlusAsSpace: needs.readsPlusAsSpace,
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

/*
 * THE ONE FUNCTION A RULE BUILT ON THE DETECTORS FINDS ITS MATCHES WITH.
 *
 * Where the detectors find their data type in a text: [start, end) ranges,
 * left to right, none overlapping. Each detector reads the text as written,
 * and in each reading it asks for, placed on the written characters; what
 * two detectors or two readings share is one range.
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
    for (const reading of readings.detectorReadingsFor(detector)) {
      for (const [start, end] of acceptedRangesIn(detector, reading.text)) {
        const writtenStart: number = reading.toWritten(start);
        const writtenEnd: number = reading.toWritten(end);

        if (!isGluedToAnEscape(detector, text, writtenStart, writtenEnd)) {
          found.push([writtenStart, writtenEnd]);
        }
      }
    }
  }

  return mergeRanges(found);
}
