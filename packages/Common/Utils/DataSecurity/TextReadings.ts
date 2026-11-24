import { DataTypeDetector } from "./Detector";
import { readDigitsOfEveryScript } from "./DigitReadings";
import PercentDecodedText from "./PercentDecodedText";

/*
 * THE WAYS ONE TEXT IS READ, AND WHERE A MATCH IN EACH IS WRITTEN.
 *
 * A detector reads a text as it is written. One that asks also reads it
 * with its percent-escapes read (readsPercentEncoded, #10467: an address in
 * an encoded URL), or with every script's digits read by their values
 * (readsDigitsOfEveryScript, #10960: a card in fullwidth or Arabic-Indic
 * digits). A match found in a reading is placed on the characters the text
 * writes it with, so what it finds - and what a scrub rule hides - is the
 * value as written, escapes and all.
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
 * in one pass (PercentDecodedText, DigitReadings): in time in line with the
 * text's length.
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
}

function samePosition(position: number): number {
  return position;
}

/*
 * The readings of one text, each made the first time it is asked for: the
 * text as written, as its percent-escapes read, and with every script's
 * digits read by their values.
 */
export class TextReadings {
  public readonly written: TextReading;
  private percentDecoded: TextReading | null | undefined = undefined;
  private digitReadings: Array<TextReading> | undefined = undefined;

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

  // Every reading a detector reads, the text as written first.
  public readingsFor(needs: ReadingNeeds): Array<TextReading> {
    const readings: Array<TextReading> = [this.written];

    if (needs.readsPercentEncoded) {
      const decoded: TextReading | null = this.getPercentDecoded();

      if (decoded) {
        readings.push(decoded);
      }
    }

    if (needs.readsDigitsOfEveryScript) {
      for (const reading of this.getDigitsOfEveryScript()) {
        readings.push(reading);
      }
    }

    return readings;
  }
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
    for (const reading of readings.readingsFor(detector)) {
      for (const [start, end] of acceptedRangesIn(detector, reading.text)) {
        found.push([reading.toWritten(start), reading.toWritten(end)]);
      }
    }
  }

  return mergeRanges(found);
}
