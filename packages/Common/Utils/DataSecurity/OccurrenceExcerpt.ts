import {
  DataSecurityOccurrenceExcerpt,
  DataSecurityOccurrenceExcerptPart,
  DataSecurityOccurrenceExcerptPartKind,
} from "../../Types/DataSecurity/DataSecurityApiTypes";
import BUILT_IN_DETECTORS, { getBuiltInDetectorsOf } from "./Detectors/Index";
import { getHintedDataTypeIds } from "./FieldNameHints";
import { maskValue } from "./Masking";
import { findSensitiveValues, ScanDetector, TextMatch } from "./TextScanner";

/*
 * A RECORD'S VALUE, AROUND THE DATA A FINDING IS ABOUT, MASKED.
 *
 * "Show maybe actual log lines where things are found and highlight
 * sections" (issue #9549). The value a telemetry record holds at a
 * finding's location - a log line, an exception's message, an attribute, a
 * prompt - cut to the part around the finding's data, so a person sees
 * what the line was doing with it: "Ping to 34.***.***.*** took 120 ms".
 *
 *  - The finding's own data is found with its own detectors, as the scan
 *    found it (the project's hints, turned-off types and allowed values),
 *    and marked. A value found by its shape or its field's name alone - a
 *    cvv field's "123", a first name - is the whole value, masked.
 *  - Every other sensitive value any detector finds in it is masked too, so
 *    the excerpt never shows a raw value of any type, whatever the project
 *    turned off.
 *  - Masking is a finding's samples' (Masking.ts). The text in between is
 *    the record's own, shown only to someone who may read that telemetry,
 *    with control characters (a terminal's colour codes) taken out.
 *  - The cut never falls inside a sensitive value: a value the edge would
 *    cut is taken whole, so half of one is never shown unmasked.
 */

// How much of the value before the finding's data, and after it, is kept.
export const EXCERPT_CONTEXT_BEFORE: number = 80;
export const EXCERPT_CONTEXT_AFTER: number = 160;

// How far an edge may move to fall between words instead of inside one.
const WORD_EDGE_REACH: number = 16;

export interface OccurrenceExcerptOptions {
  // The project's own types, compiled.
  customDetectors?: ReadonlyArray<ScanDetector> | undefined;
  extraHints?:
    | ReadonlyArray<{ dataTypeId: string; hints: ReadonlyArray<string> }>
    | undefined;
  disabledDataTypeIds?: ReadonlySet<string> | undefined;
  allowedValues?: ReadonlySet<string> | undefined;
}

interface MarkedMatch {
  start: number;
  end: number;
  dataTypeId: string;
  kind: DataSecurityOccurrenceExcerptPartKind;
}

function isWhitespace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

// An edge moved back or on to the nearest space within reach, if there is one.
function toWordEdge(
  value: string,
  edge: number,
  direction: 1 | -1,
  limit: number,
): number {
  for (let step: number = 0; step <= WORD_EDGE_REACH; step++) {
    const position: number = edge + step * direction;

    if (direction === 1 ? position >= limit : position <= limit) {
      break;
    }

    if (
      isWhitespace(value.charCodeAt(direction === 1 ? position - 1 : position))
    ) {
      return position;
    }
  }

  return edge;
}

/*
 * The record's own text between sensitive values, as a page can draw it:
 * one kind of line break, no control characters, no terminal escapes.
 */
export function toReadableText(text: string): string {
  let readable: string = "";
  let index: number = 0;

  while (index < text.length) {
    const code: number = text.charCodeAt(index);

    // A terminal's escape: ESC [ ... a letter.
    if (code === 0x1b) {
      let end: number = index + 1;

      if (text[end] === "[") {
        end++;

        while (end < text.length && end - index < 32) {
          const inner: number = text.charCodeAt(end);
          end++;

          if ((inner >= 0x40 && inner <= 0x7e) || inner < 0x20) {
            break;
          }
        }
      }

      index = end;
      continue;
    }

    if (code === 0x0d) {
      readable += "\n";
      index += text[index + 1] === "\n" ? 2 : 1;
      continue;
    }

    if ((code < 0x20 && code !== 0x0a && code !== 0x09) || code === 0x7f) {
      index++;
      continue;
    }

    readable += text[index];
    index++;
  }

  return readable;
}

function withoutOverlaps(
  kept: ReadonlyArray<MarkedMatch>,
  candidates: ReadonlyArray<MarkedMatch>,
): Array<MarkedMatch> {
  return candidates.filter((candidate: MarkedMatch): boolean => {
    return !kept.some((match: MarkedMatch): boolean => {
      return candidate.start < match.end && match.start < candidate.end;
    });
  });
}

/*
 * The excerpt of `value`, the value a record holds at `location`, around
 * the first place it holds `dataTypeId`.
 */
export function buildOccurrenceExcerpt(data: {
  value: string;
  dataTypeId: string;
  location: string;
  field?: string | undefined;
  event?: string | undefined;
  options?: OccurrenceExcerptOptions | undefined;
}): DataSecurityOccurrenceExcerpt {
  const value: string = data.value;
  const options: OccurrenceExcerptOptions = data.options || {};
  const customDetectors: ReadonlyArray<ScanDetector> =
    options.customDetectors || [];
  const hinted: Set<string> = getHintedDataTypeIds(
    data.location,
    options.extraHints,
  );
  const builtIn: ReadonlyArray<ScanDetector> = getBuiltInDetectorsOf(
    data.dataTypeId,
  );
  const ownDetectors: ReadonlyArray<ScanDetector> =
    builtIn.length > 0
      ? builtIn
      : customDetectors.filter((detector: ScanDetector): boolean => {
          return detector.dataTypeId === data.dataTypeId;
        });

  const named: (
    parts: Array<DataSecurityOccurrenceExcerptPart>,
  ) => DataSecurityOccurrenceExcerpt = (
    parts: Array<DataSecurityOccurrenceExcerptPart>,
  ): DataSecurityOccurrenceExcerpt => {
    const excerpt: DataSecurityOccurrenceExcerpt = {
      parts,
      isCutAtStart: false,
      isCutAtEnd: false,
    };

    if (data.field) {
      excerpt.field = data.field;
    }

    if (data.event) {
      excerpt.event = data.event;
    }

    return excerpt;
  };

  // The finding's own data, found as the scan found it.
  const own: Array<MarkedMatch> =
    ownDetectors.length > 0
      ? findSensitiveValues(value, {
          detectors: ownDetectors,
          hintedDataTypeIds: hinted,
          disabledDataTypeIds: options.disabledDataTypeIds,
          allowedValues: options.allowedValues,
        })
          .filter((match: TextMatch): boolean => {
            return match.dataTypeId === data.dataTypeId && !match.isTestValue;
          })
          .map((match: TextMatch): MarkedMatch => {
            return {
              start: match.start,
              end: match.end,
              dataTypeId: match.dataTypeId,
              kind: DataSecurityOccurrenceExcerptPartKind.Match,
            };
          })
      : [];

  if (own.length === 0) {
    // Found by its shape or its field's name: the whole value is the data.
    return named([
      {
        kind: DataSecurityOccurrenceExcerptPartKind.Match,
        text: maskValue(data.dataTypeId, value.trim()),
      },
    ]);
  }

  // Every other sensitive value, of any type, whatever the project turned off.
  const others: Array<MarkedMatch> = withoutOverlaps(
    own,
    findSensitiveValues(value, {
      detectors:
        customDetectors.length > 0
          ? [...BUILT_IN_DETECTORS, ...customDetectors]
          : BUILT_IN_DETECTORS,
      hintedDataTypeIds: hinted,
    }).map((match: TextMatch): MarkedMatch => {
      return {
        start: match.start,
        end: match.end,
        dataTypeId: match.dataTypeId,
        kind: DataSecurityOccurrenceExcerptPartKind.Masked,
      };
    }),
  );
  const matches: Array<MarkedMatch> = [...own, ...others].sort(
    (a: MarkedMatch, b: MarkedMatch): number => {
      return a.start - b.start;
    },
  );
  const anchor: MarkedMatch = own[0]!;

  let start: number = Math.max(0, anchor.start - EXCERPT_CONTEXT_BEFORE);
  let end: number = Math.min(value.length, anchor.end + EXCERPT_CONTEXT_AFTER);

  if (start > 0) {
    start = toWordEdge(value, start, 1, anchor.start);
  }

  if (end < value.length) {
    end = toWordEdge(value, end, -1, anchor.end);
  }

  // A sensitive value the edges would cut is taken whole.
  for (const match of matches) {
    if (match.start < start && match.end > start) {
      start = match.start;
    }

    if (match.start < end && match.end > end) {
      end = match.end;
    }
  }

  // Never half of a character beyond U+FFFF.
  if (start > 0 && isLowSurrogate(value.charCodeAt(start))) {
    start--;
  }

  if (end < value.length && isLowSurrogate(value.charCodeAt(end))) {
    end++;
  }

  const parts: Array<DataSecurityOccurrenceExcerptPart> = [];
  let position: number = start;

  const addText: (text: string) => void = (text: string): void => {
    const readable: string = toReadableText(text);

    if (!readable) {
      return;
    }

    const last: DataSecurityOccurrenceExcerptPart | undefined =
      parts[parts.length - 1];

    if (last?.kind === DataSecurityOccurrenceExcerptPartKind.Text) {
      last.text += readable;
    } else {
      parts.push({
        kind: DataSecurityOccurrenceExcerptPartKind.Text,
        text: readable,
      });
    }
  };

  for (const match of matches) {
    if (match.end <= start || match.start >= end) {
      continue;
    }

    addText(value.slice(position, match.start));
    parts.push({
      kind: match.kind,
      text: maskValue(match.dataTypeId, value.slice(match.start, match.end)),
    });
    position = match.end;
  }

  addText(value.slice(position, end));

  const excerpt: DataSecurityOccurrenceExcerpt = named(parts);

  excerpt.isCutAtStart = start > 0;
  excerpt.isCutAtEnd = end < value.length;

  return excerpt;
}
