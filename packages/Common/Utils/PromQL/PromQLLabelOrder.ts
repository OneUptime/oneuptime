import { PromQLLabels, promQLLabelValue } from "./PromQLLabels";

/*
 * The orders Prometheus puts label values and label sets in, for
 * sort_by_label() and sort_by_label_desc() (funcSortByLabel and
 * funcSortByLabelDesc in promql/functions.go): label values in natural order
 * (github.com/facette/natsort), and samples whose named labels are all equal
 * by their whole label sets (labels.Compare).
 *
 * Go compares strings byte by byte in UTF-8, which is code point order.
 * JavaScript's < compares UTF-16 code units, which puts U+10000 and above
 * (written as surrogates, D800-DFFF) before U+E000-U+FFFF, so "😀" < "�"
 * in JavaScript and the other way round in Go. Every comparison of text here
 * is in code point order, as Go's.
 */

const SURROGATE_START: number = 0xd800;
const PRIVATE_USE_START: number = 0xe000;

/*
 * Where a UTF-16 code unit sits in code point order: surrogates, which
 * write U+10000 and above, after every other code unit.
 */
const codeUnitRank: (unit: number) => number = (unit: number): number => {
  if (unit < SURROGATE_START) {
    return unit;
  }

  return unit >= PRIVATE_USE_START ? unit - 0x800 : unit + 0x2000;
};

// Go's strings.Compare: -1, 0 or 1, in code point order.
export const comparePromQLText: (a: string, b: string) => number = (
  a: string,
  b: string,
): number => {
  const shared: number = Math.min(a.length, b.length);

  for (let index: number = 0; index < shared; index++) {
    const unitA: number = a.charCodeAt(index);
    const unitB: number = b.charCodeAt(index);

    if (unitA !== unitB) {
      return codeUnitRank(unitA) < codeUnitRank(unitB) ? -1 : 1;
    }
  }

  return Math.sign(a.length - b.length);
};

// natsort's chunkify, `(\d+|\D+)`: runs of ASCII digits and runs of the rest.
const CHUNK_REGEX: RegExp = /\d+|\D+/g;

const DIGITS_REGEX: RegExp = /^\d+$/;

const LEADING_ZEROS_REGEX: RegExp = /^0+(?=\d)/;

// The largest int, on the 64-bit machines Prometheus runs on.
const INT64_MAX: string = "9223372036854775807";

const chunksOf: (text: string) => Array<string> = (
  text: string,
): Array<string> => {
  return text.match(CHUNK_REGEX) || [];
};

/*
 * strconv.Atoi of a chunk, as the digits of its value without leading zeros:
 * undefined for a chunk that is not a number, and for one past int64, which
 * Atoi refuses as out of range.
 */
const intOf: (chunk: string) => string | undefined = (
  chunk: string,
): string | undefined => {
  if (!DIGITS_REGEX.test(chunk)) {
    return undefined;
  }

  const digits: string = chunk.replace(LEADING_ZEROS_REGEX, "");

  if (
    digits.length > INT64_MAX.length ||
    (digits.length === INT64_MAX.length && digits > INT64_MAX)
  ) {
    return undefined;
  }

  return digits;
};

// Two numbers' digits, leading zeros dropped, compared as the numbers.
const compareInts: (a: string, b: string) => number = (
  a: string,
  b: string,
): number => {
  if (a.length !== b.length) {
    return a.length < b.length ? -1 : 1;
  }

  return a < b ? -1 : a > b ? 1 : 0;
};

/*
 * natsort.Compare: whether a comes before b in natural order. The two are
 * read chunk by chunk; two numbers compare as numbers, anything else as
 * text, and when every chunk so far is equal the string that runs out of
 * chunks first comes first.
 *
 * A port, quirks and all. A number past int64 compares as text, so
 * "10000000000000000000000" comes before "5". And it answers false both ways
 * round for "" and any other value, and true both ways round for values that
 * differ only in leading zeros ("01" and "1"): comparePromQLLabelValues says
 * what OneUptime does then.
 */
export const promQLNaturalLess: (a: string, b: string) => boolean = (
  a: string,
  b: string,
): boolean => {
  const chunksA: Array<string> = chunksOf(a);
  const chunksB: Array<string> = chunksOf(b);

  for (let index: number = 0; index < chunksA.length; index++) {
    if (index >= chunksB.length) {
      return false;
    }

    const chunkA: string = chunksA[index]!;
    const chunkB: string = chunksB[index]!;
    const intA: string | undefined = intOf(chunkA);
    const intB: string | undefined = intOf(chunkB);
    const order: number =
      intA !== undefined && intB !== undefined
        ? compareInts(intA, intB)
        : comparePromQLText(chunkA, chunkB);

    if (order !== 0) {
      return order < 0;
    }

    if (index === chunksA.length - 1) {
      // a has run out: b is after it.
      return true;
    }

    if (index === chunksB.length - 1) {
      // b has run out: a is after it.
      return false;
    }
  }

  return false;
};

/*
 * How sort_by_label() orders two values of a label it sorts by: -1, 0 or 1.
 * Equal values tie, and the next label decides. Otherwise natural order, as
 * Prometheus sorts, wherever natsort answers one way round: "a9" before
 * "a10", "B" before "a" (an upper-case letter is a smaller byte), "1.9"
 * before "1.10".
 *
 * Where natsort gives the same answer both ways round, an empty value (a
 * missing label) against any other and "01" against "1", Prometheus' own
 * order is the order the series happened to come in, which no query can
 * know. There, OneUptime compares the values as text, as Go would: a
 * missing label first ("" before anything), "001" before "01" before "1".
 * So a query gives the same order every time.
 */
export const comparePromQLLabelValues: (a: string, b: string) => number = (
  a: string,
  b: string,
): number => {
  if (a === b) {
    return 0;
  }

  const aFirst: boolean = promQLNaturalLess(a, b);
  const bFirst: boolean = promQLNaturalLess(b, a);

  if (aFirst !== bFirst) {
    return aFirst ? -1 : 1;
  }

  return comparePromQLText(a, b);
};

/*
 * A label set's names in the order Prometheus keeps them, by code point.
 * A label with an empty value is not a label (PromQLLabels).
 */
const namesInOrder: (labels: PromQLLabels) => Array<string> = (
  labels: PromQLLabels,
): Array<string> => {
  return Object.keys(labels)
    .filter((name: string): boolean => {
      return promQLLabelValue(labels, name) !== "";
    })
    .sort(comparePromQLText);
};

const compareNamedLabelSets: (
  a: PromQLLabels,
  namesA: Array<string>,
  b: PromQLLabels,
  namesB: Array<string>,
) => number = (
  a: PromQLLabels,
  namesA: Array<string>,
  b: PromQLLabels,
  namesB: Array<string>,
): number => {
  const shared: number = Math.min(namesA.length, namesB.length);

  for (let index: number = 0; index < shared; index++) {
    const nameA: string = namesA[index]!;
    const nameB: string = namesB[index]!;
    const nameOrder: number = comparePromQLText(nameA, nameB);

    if (nameOrder !== 0) {
      return nameOrder;
    }

    const valueOrder: number = comparePromQLText(
      promQLLabelValue(a, nameA),
      promQLLabelValue(b, nameB),
    );

    if (valueOrder !== 0) {
      return valueOrder;
    }
  }

  return Math.sign(namesA.length - namesB.length);
};

/*
 * Prometheus' labels.Compare: -1, 0 or 1. Label by label in name order, the
 * metric name among them: a smaller name first, then a smaller value; when
 * one set runs out with every label so far the same, the shorter set first.
 * So {a="z", g="1"} comes before {b="a", g="1"}: the names differ before the
 * values are read.
 */
export const comparePromQLLabelSets: (
  a: PromQLLabels,
  b: PromQLLabels,
) => number = (a: PromQLLabels, b: PromQLLabels): number => {
  return compareNamedLabelSets(a, namesInOrder(a), b, namesInOrder(b));
};

/*
 * sort_by_label(): the items by the values of the named labels, the first
 * label first, and items equal on all of them by their whole label sets.
 * sort_by_label_desc() is the same order backwards, its ties included, as
 * Prometheus sorts them (-labels.Compare).
 */
export const sortPromQLByLabels: <T extends { labels: PromQLLabels }>(
  items: ReadonlyArray<T>,
  names: ReadonlyArray<string>,
  descending: boolean,
) => Array<T> = <T extends { labels: PromQLLabels }>(
  items: ReadonlyArray<T>,
  names: ReadonlyArray<string>,
  descending: boolean,
): Array<T> => {
  const direction: number = descending ? -1 : 1;

  interface Entry {
    item: T;
    values: Array<string>;
    names: Array<string>;
  }

  return items
    .map((item: T): Entry => {
      return {
        item,
        values: names.map((name: string): string => {
          return promQLLabelValue(item.labels, name);
        }),
        names: namesInOrder(item.labels),
      };
    })
    .sort((a: Entry, b: Entry): number => {
      for (let index: number = 0; index < a.values.length; index++) {
        const order: number = comparePromQLLabelValues(
          a.values[index]!,
          b.values[index]!,
        );

        if (order !== 0) {
          return order * direction;
        }
      }

      return (
        compareNamedLabelSets(a.item.labels, a.names, b.item.labels, b.names) *
        direction
      );
    })
    .map((entry: Entry): T => {
      return entry.item;
    });
};
