/*
 * WHERE A BROWSER DRAWS EACH CHARACTER OF A LINE.
 *
 * A test's copy of the Unicode Bidirectional Algorithm (UAX #9) for one
 * line of text in a paragraph of a given direction, as a page with
 * dir="rtl" (or "ltr") lays it out: isolates (LRI, RLI, FSI ... PDI), the
 * weak types (W1-W7), paired brackets and neutrals (N0-N2), the implicit
 * levels (I1-I2) and the reordering (L1-L2). Embeddings and overrides
 * (LRE, RLE, LRO, RLO, PDF), which no locale file holds, are left out as
 * the algorithm leaves out what it removes (X9).
 *
 * Each character's bidi class is read from its script and its category
 * (getBidiClass) - close enough for the letters, digits and signs of a
 * sentence; the reading-direction E2E suite draws the same sentences in
 * Chromium.
 *
 * It answers one question a test asks: is this piece of a line - a path,
 * a function, a flag - drawn as it is written (isDrawnAsWritten)?
 */

export type BidiClass =
  | "L"
  | "R"
  | "AL"
  | "EN"
  | "ES"
  | "ET"
  | "AN"
  | "CS"
  | "NSM"
  | "BN"
  | "B"
  | "S"
  | "WS"
  | "ON"
  | "LRI"
  | "RLI"
  | "FSI"
  | "PDI";

export type ParagraphDirection = "ltr" | "rtl";

// European separators: a plus or a minus between two digits joins them.
const EUROPEAN_SEPARATORS: ReadonlySet<string> = new Set<string>([
  "+",
  "-",
  "\u{2212}",
  "\u{207A}",
  "\u{207B}",
  "\u{208A}",
  "\u{208B}",
  "\u{FB29}",
  "\u{FE62}",
  "\u{FE63}",
  "\u{FF0B}",
  "\u{FF0D}",
]);

// Common separators: between two numbers of a kind, part of the number.
const COMMON_SEPARATORS: ReadonlySet<string> = new Set<string>([
  ",",
  ".",
  "/",
  ":",
  "\u{00A0}",
  "\u{060C}",
  "\u{202F}",
  "\u{2044}",
  "\u{FE50}",
  "\u{FE52}",
  "\u{FE55}",
  "\u{FF0C}",
  "\u{FF0E}",
  "\u{FF0F}",
  "\u{FF1A}",
]);

// European terminators, beside currency signs: "#12", "90%", "21°".
const EUROPEAN_TERMINATORS: ReadonlySet<string> = new Set<string>([
  "#",
  "%",
  "\u{00B0}",
  "\u{00B1}",
  "\u{0609}",
  "\u{060A}",
  "\u{066A}",
  "\u{2030}",
  "\u{2031}",
  "\u{2032}",
  "\u{2033}",
  "\u{2034}",
  "\u{2213}",
  "\u{212E}",
  "\u{FE5F}",
  "\u{FE69}",
  "\u{FF03}",
  "\u{FF05}",
]);

const CURRENCY_REGEX: RegExp = /^\p{Sc}$/u;

const MARK_REGEX: RegExp = /^[\p{Mn}\p{Me}]$/u;

const LETTER_REGEX: RegExp = /^[\p{L}\p{Mc}\p{Nd}\p{Nl}]$/u;

const SPACE_REGEX: RegExp = /^\p{Zs}$/u;

// Scripts whose letters the algorithm calls Arabic (AL).
const ARABIC_LETTER_REGEX: RegExp =
  /^[\p{Script_Extensions=Arabic}\p{Script_Extensions=Syriac}\p{Script_Extensions=Thaana}\p{Script_Extensions=Hanifi_Rohingya}]$/u;

// Scripts whose letters the algorithm calls right-to-left (R).
const RIGHT_TO_LEFT_LETTER_REGEX: RegExp =
  /^[\p{Script_Extensions=Hebrew}\p{Script_Extensions=Nko}\p{Script_Extensions=Adlam}\p{Script_Extensions=Mandaic}\p{Script_Extensions=Samaritan}]$/u;

// The bidi class of one character (a whole code point).
export const getBidiClass: (character: string) => BidiClass = (
  character: string,
): BidiClass => {
  const codePoint: number = character.codePointAt(0) ?? 0;

  switch (codePoint) {
    case 0x2066:
      return "LRI";
    case 0x2067:
      return "RLI";
    case 0x2068:
      return "FSI";
    case 0x2069:
      return "PDI";
    case 0x200e:
      return "L";
    case 0x200f:
      return "R";
    /*
     * The Arabic letter mark, semicolon and question mark and the Tatweel:
     * Arabic letters to the algorithm, though N'Ko, Adlam or Mandaic - whose
     * letters are right-to-left (R) - use them too.
     */
    case 0x061b:
    case 0x061c:
    case 0x061f:
    case 0x0640:
      return "AL";
    case 0x200b:
    case 0x200c:
    case 0x200d:
    case 0x00ad:
    case 0x2060:
    case 0xfeff:
      return "BN";
    case 0x0a:
    case 0x0d:
    case 0x1c:
    case 0x1d:
    case 0x1e:
    case 0x85:
    case 0x2029:
      return "B";
    case 0x09:
    case 0x0b:
    case 0x1f:
      return "S";
    case 0x0c:
    case 0x2028:
      return "WS";
    default:
      break;
  }

  // Embeddings and overrides: removed, as X9 removes them.
  if (codePoint >= 0x202a && codePoint <= 0x202e) {
    return "BN";
  }

  if (
    (codePoint >= 0x30 && codePoint <= 0x39) ||
    (codePoint >= 0x6f0 && codePoint <= 0x6f9) ||
    codePoint === 0xb2 ||
    codePoint === 0xb3 ||
    codePoint === 0xb9 ||
    codePoint === 0x2070 ||
    (codePoint >= 0x2074 && codePoint <= 0x2079) ||
    (codePoint >= 0x2080 && codePoint <= 0x2089)
  ) {
    return "EN";
  }

  if (
    (codePoint >= 0x660 && codePoint <= 0x669) ||
    codePoint === 0x66b ||
    codePoint === 0x66c ||
    (codePoint >= 0x600 && codePoint <= 0x605) ||
    codePoint === 0x6dd ||
    codePoint === 0x8e2
  ) {
    return "AN";
  }

  if (EUROPEAN_SEPARATORS.has(character)) {
    return "ES";
  }

  if (COMMON_SEPARATORS.has(character)) {
    return "CS";
  }

  if (EUROPEAN_TERMINATORS.has(character) || CURRENCY_REGEX.test(character)) {
    return "ET";
  }

  if (MARK_REGEX.test(character)) {
    return "NSM";
  }

  if (RIGHT_TO_LEFT_LETTER_REGEX.test(character)) {
    return "R";
  }

  if (ARABIC_LETTER_REGEX.test(character)) {
    return "AL";
  }

  if (LETTER_REGEX.test(character)) {
    return "L";
  }

  if (SPACE_REGEX.test(character)) {
    return "WS";
  }

  return "ON";
};

// The brackets the algorithm pairs (BD14-BD16), opening to closing.
const CLOSING_BRACKET_OF: Readonly<Record<string, string>> = {
  "(": ")",
  "[": "]",
  "{": "}",
  "\u{2045}": "\u{2046}",
  "\u{207D}": "\u{207E}",
  "\u{208D}": "\u{208E}",
  "\u{2329}": "\u{232A}",
  "\u{3008}": "\u{3009}",
  "\u{FF08}": "\u{FF09}",
  "\u{FF3B}": "\u{FF3D}",
};

const CLOSING_BRACKETS: ReadonlySet<string> = new Set<string>(
  Object.values(CLOSING_BRACKET_OF),
);

// How deep brackets pair (BD16's stack).
const MOST_OPEN_BRACKETS: number = 63;

const isIsolateInitiator: (bidiClass: BidiClass) => boolean = (
  bidiClass: BidiClass,
): boolean => {
  return bidiClass === "LRI" || bidiClass === "RLI" || bidiClass === "FSI";
};

const isIsolateControl: (bidiClass: BidiClass) => boolean = (
  bidiClass: BidiClass,
): boolean => {
  return isIsolateInitiator(bidiClass) || bidiClass === "PDI";
};

// A neutral or an isolate control (NI): it takes its neighbours' direction.
const isNeutral: (bidiClass: BidiClass) => boolean = (
  bidiClass: BidiClass,
): boolean => {
  return (
    bidiClass === "B" ||
    bidiClass === "S" ||
    bidiClass === "WS" ||
    bidiClass === "ON" ||
    isIsolateControl(bidiClass)
  );
};

// A strong direction, numbers counting as right-to-left (N0, N1).
const getStrongDirection: (bidiClass: BidiClass) => "L" | "R" | null = (
  bidiClass: BidiClass,
): "L" | "R" | null => {
  if (bidiClass === "L") {
    return "L";
  }

  if (
    bidiClass === "R" ||
    bidiClass === "AL" ||
    bidiClass === "EN" ||
    bidiClass === "AN"
  ) {
    return "R";
  }

  return null;
};

const directionOfLevel: (level: number) => "L" | "R" = (
  level: number,
): "L" | "R" => {
  return level % 2 === 0 ? "L" : "R";
};

export interface DrawnLine {
  // The line's text, one entry per UTF-16 unit.
  units: Array<string>;
  // Each unit's bidi class (a low surrogate: BN, it goes with its high one).
  classes: Array<BidiClass>;
  // Each unit's resolved embedding level.
  levels: Array<number>;
  // The units from left to right as drawn: visualOrder[x] is a unit's index.
  visualOrder: Array<number>;
  // Where each unit is drawn: the inverse of visualOrder.
  drawnAt: Array<number>;
}

/*
 * The weak, neutral and implicit rules on one isolating run sequence: the
 * units at `sequence`, read at `level`, between sos and eos.
 */
const resolveSequence: (
  units: ReadonlyArray<string>,
  classes: ReadonlyArray<BidiClass>,
  levels: Array<number>,
  sequence: ReadonlyArray<number>,
  level: number,
  sos: "L" | "R",
  eos: "L" | "R",
) => void = (
  units: ReadonlyArray<string>,
  classes: ReadonlyArray<BidiClass>,
  levels: Array<number>,
  sequence: ReadonlyArray<number>,
  level: number,
  sos: "L" | "R",
  eos: "L" | "R",
): void => {
  const types: Array<BidiClass> = sequence.map((index: number): BidiClass => {
    return classes[index] as BidiClass;
  });
  const count: number = types.length;
  const embedding: "L" | "R" = directionOfLevel(level);

  // W1: a mark takes the type of what it is on.
  for (let at: number = 0; at < count; at++) {
    if (types[at] === "NSM") {
      const before: BidiClass | undefined = types[at - 1];

      types[at] =
        before === undefined ? sos : isIsolateControl(before) ? "ON" : before;
    }
  }

  // The last strong type before `at` (L, R or AL), or sos.
  const lastStrongBefore: (at: number) => BidiClass = (
    at: number,
  ): BidiClass => {
    for (let back: number = at - 1; back >= 0; back--) {
      const type: BidiClass = types[back] as BidiClass;

      if (type === "L" || type === "R" || type === "AL") {
        return type;
      }
    }

    return sos;
  };

  // W2: a European number after Arabic letters is an Arabic number.
  for (let at: number = 0; at < count; at++) {
    if (types[at] === "EN" && lastStrongBefore(at) === "AL") {
      types[at] = "AN";
    }
  }

  // W3: Arabic letters are right-to-left.
  for (let at: number = 0; at < count; at++) {
    if (types[at] === "AL") {
      types[at] = "R";
    }
  }

  // W4: one separator between two numbers of a kind joins them.
  for (let at: number = 1; at < count - 1; at++) {
    const before: BidiClass = types[at - 1] as BidiClass;
    const after: BidiClass = types[at + 1] as BidiClass;

    if (types[at] === "ES" && before === "EN" && after === "EN") {
      types[at] = "EN";
    } else if (types[at] === "CS" && before === "EN" && after === "EN") {
      types[at] = "EN";
    } else if (types[at] === "CS" && before === "AN" && after === "AN") {
      types[at] = "AN";
    }
  }

  // W5: terminators beside a European number join it.
  for (let at: number = 0; at < count; at++) {
    if (types[at] !== "ET") {
      continue;
    }

    let end: number = at;

    while (end < count && types[end] === "ET") {
      end++;
    }

    if (types[at - 1] === "EN" || types[end] === "EN") {
      for (let joined: number = at; joined < end; joined++) {
        types[joined] = "EN";
      }
    }

    at = end - 1;
  }

  // W6: the separators and terminators left are neutral.
  for (let at: number = 0; at < count; at++) {
    const type: BidiClass = types[at] as BidiClass;

    if (type === "ES" || type === "ET" || type === "CS") {
      types[at] = "ON";
    }
  }

  // W7: a European number after left-to-right letters is left-to-right.
  for (let at: number = 0; at < count; at++) {
    if (types[at] === "EN" && lastStrongBefore(at) === "L") {
      types[at] = "L";
    }
  }

  // N0: paired brackets (BD16), in the order they open.
  const pairs: Array<[number, number]> = [];
  const opened: Array<{ at: number; closing: string }> = [];

  for (let at: number = 0; at < count; at++) {
    if (types[at] !== "ON") {
      continue;
    }

    const character: string = units[sequence[at] as number] as string;
    const closing: string | undefined = CLOSING_BRACKET_OF[character];

    if (closing !== undefined) {
      if (opened.length === MOST_OPEN_BRACKETS) {
        break;
      }

      opened.push({ at, closing });
      continue;
    }

    if (CLOSING_BRACKETS.has(character)) {
      for (let depth: number = opened.length - 1; depth >= 0; depth--) {
        if (opened[depth]?.closing === character) {
          pairs.push([opened[depth]?.at as number, at]);
          opened.length = depth;
          break;
        }
      }
    }
  }

  pairs.sort((one: [number, number], other: [number, number]): number => {
    return one[0] - other[0];
  });

  for (const [open, close] of pairs) {
    let hasEmbedding: boolean = false;
    let hasOpposite: boolean = false;

    for (let at: number = open + 1; at < close; at++) {
      const direction: "L" | "R" | null = getStrongDirection(
        types[at] as BidiClass,
      );

      if (direction === embedding) {
        hasEmbedding = true;
        break;
      }

      if (direction !== null) {
        hasOpposite = true;
      }
    }

    let resolved: "L" | "R" | null = null;

    if (hasEmbedding) {
      resolved = embedding;
    } else if (hasOpposite) {
      let context: "L" | "R" = sos;

      for (let back: number = open - 1; back >= 0; back--) {
        const direction: "L" | "R" | null = getStrongDirection(
          types[back] as BidiClass,
        );

        if (direction !== null) {
          context = direction;
          break;
        }
      }

      resolved = context !== embedding ? context : embedding;
    }

    if (resolved === null) {
      continue;
    }

    for (const bracket of [open, close]) {
      types[bracket] = resolved;

      // A mark on the bracket goes with it.
      for (
        let after: number = bracket + 1;
        after < count && classes[sequence[after] as number] === "NSM";
        after++
      ) {
        types[after] = resolved;
      }
    }
  }

  // N1, N2: a run of neutrals between two of a direction takes it, else the embedding's.
  for (let at: number = 0; at < count; at++) {
    if (!isNeutral(types[at] as BidiClass)) {
      continue;
    }

    let end: number = at;

    while (end < count && isNeutral(types[end] as BidiClass)) {
      end++;
    }

    const before: "L" | "R" =
      at === 0
        ? sos
        : getStrongDirection(types[at - 1] as BidiClass) ?? embedding;
    const after: "L" | "R" =
      end === count
        ? eos
        : getStrongDirection(types[end] as BidiClass) ?? embedding;
    const resolved: "L" | "R" = before === after ? before : embedding;

    for (let neutral: number = at; neutral < end; neutral++) {
      types[neutral] = resolved;
    }

    at = end - 1;
  }

  // I1, I2: the implicit levels.
  for (let at: number = 0; at < count; at++) {
    const type: BidiClass = types[at] as BidiClass;
    let resolvedLevel: number = level;

    if (level % 2 === 0) {
      if (type === "R") {
        resolvedLevel = level + 1;
      } else if (type === "AN" || type === "EN") {
        resolvedLevel = level + 2;
      }
    } else if (type === "L" || type === "EN" || type === "AN") {
      resolvedLevel = level + 1;
    }

    levels[sequence[at] as number] = resolvedLevel;
  }
};

/*
 * One line of `text` laid out in a paragraph read `direction`: each unit's
 * level, and the order the units are drawn in from left to right.
 */
export const drawLine: (
  text: string,
  direction: ParagraphDirection,
) => DrawnLine = (text: string, direction: ParagraphDirection): DrawnLine => {
  const units: Array<string> = text.split("");
  const count: number = units.length;
  const paragraphLevel: number = direction === "rtl" ? 1 : 0;

  const classes: Array<BidiClass> = units.map(
    (unit: string, index: number): BidiClass => {
      const codeUnit: number = unit.charCodeAt(0);

      // A surrogate pair is one character: its class is read once, on its first unit.
      if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
        return "BN";
      }

      if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
        return getBidiClass(String.fromCodePoint(text.codePointAt(index) ?? 0));
      }

      return getBidiClass(unit);
    },
  );

  // BD9: each isolate initiator and the PDI that closes it.
  const closingOf: Array<number> = new Array<number>(count).fill(-1);
  const openingOf: Array<number> = new Array<number>(count).fill(-1);
  const initiators: Array<number> = [];

  for (let index: number = 0; index < count; index++) {
    const bidiClass: BidiClass = classes[index] as BidiClass;

    if (isIsolateInitiator(bidiClass)) {
      initiators.push(index);
    } else if (bidiClass === "PDI" && initiators.length > 0) {
      const opener: number = initiators.pop() as number;

      closingOf[opener] = index;
      openingOf[index] = opener;
    }
  }

  // The direction an FSI's text takes: its first strong letter's (P2, P3).
  const isFirstStrongRightToLeft: (from: number, to: number) => boolean = (
    from: number,
    to: number,
  ): boolean => {
    for (let index: number = from; index < to; index++) {
      const bidiClass: BidiClass = classes[index] as BidiClass;

      if (bidiClass === "L") {
        return false;
      }

      if (bidiClass === "R" || bidiClass === "AL") {
        return true;
      }

      if (isIsolateInitiator(bidiClass)) {
        const closing: number = closingOf[index] as number;

        index = closing === -1 ? to : closing;
      }
    }

    return false;
  };

  // X5a-X6a: the explicit levels, of isolates only.
  const levels: Array<number> = new Array<number>(count).fill(paragraphLevel);
  const levelStack: Array<number> = [];
  let level: number = paragraphLevel;

  for (let index: number = 0; index < count; index++) {
    const bidiClass: BidiClass = classes[index] as BidiClass;

    if (isIsolateInitiator(bidiClass)) {
      levels[index] = level;

      const closing: number = closingOf[index] as number;
      const isRightToLeft: boolean =
        bidiClass === "RLI" ||
        (bidiClass === "FSI" &&
          isFirstStrongRightToLeft(
            index + 1,
            closing === -1 ? count : closing,
          ));

      levelStack.push(level);
      level = isRightToLeft
        ? level + (level % 2 === 0 ? 1 : 2)
        : level + (level % 2 === 0 ? 2 : 1);
      continue;
    }

    if (bidiClass === "PDI" && openingOf[index] !== -1) {
      level = levelStack.pop() as number;
    }

    levels[index] = level;
  }

  /*
   * BD13: the isolating run sequences. With isolates only, each is the
   * text of one isolate (or of the line) without the isolates inside it,
   * whose initiator and PDI it keeps.
   */
  const sequences: Array<Array<number>> = [];
  const collect: (from: number, to: number) => void = (
    from: number,
    to: number,
  ): void => {
    const sequence: Array<number> = [];

    for (let index: number = from; index < to; index++) {
      if (classes[index] !== "BN") {
        sequence.push(index);
      }

      if (isIsolateInitiator(classes[index] as BidiClass)) {
        const closing: number = closingOf[index] as number;
        const end: number = closing === -1 ? count : closing;

        collect(index + 1, end);
        index = end - 1;
      }
    }

    if (sequence.length > 0) {
      sequences.push(sequence);
    }
  };

  collect(0, count);

  const explicitLevels: Array<number> = [...levels];

  // The explicit level of the unit before or after one, past what X9 removed (BD13).
  const explicitLevelBeside: (index: number, step: number) => number = (
    index: number,
    step: number,
  ): number => {
    for (
      let beside: number = index + step;
      beside >= 0 && beside < count;
      beside += step
    ) {
      if (classes[beside] !== "BN") {
        return explicitLevels[beside] as number;
      }
    }

    return paragraphLevel;
  };

  for (const sequence of sequences) {
    const first: number = sequence[0] as number;
    const last: number = sequence[sequence.length - 1] as number;
    const sequenceLevel: number = explicitLevels[first] as number;

    const before: number = Math.max(
      sequenceLevel,
      first === 0 ? paragraphLevel : explicitLevelBeside(first, -1),
    );
    const after: number = Math.max(
      sequenceLevel,
      isIsolateInitiator(classes[last] as BidiClass)
        ? paragraphLevel
        : explicitLevelBeside(last, 1),
    );

    resolveSequence(
      units,
      classes,
      levels,
      sequence,
      sequenceLevel,
      directionOfLevel(before),
      directionOfLevel(after),
    );
  }

  // What X9 removed takes the level of the unit before it.
  for (let index: number = 0; index < count; index++) {
    if (classes[index] === "BN") {
      levels[index] =
        index === 0 ? paragraphLevel : (levels[index - 1] as number);
    }
  }

  // L1: spaces and isolate controls at the line's end, and before a tab, take the paragraph's level.
  let trailing: boolean = true;

  for (let index: number = count - 1; index >= 0; index--) {
    const bidiClass: BidiClass = classes[index] as BidiClass;
    const isSpaceLike: boolean =
      bidiClass === "WS" || bidiClass === "BN" || isIsolateControl(bidiClass);

    if (bidiClass === "S" || bidiClass === "B") {
      levels[index] = paragraphLevel;
      trailing = true;
      continue;
    }

    if (trailing && isSpaceLike) {
      levels[index] = paragraphLevel;
      continue;
    }

    trailing = false;
  }

  // L2: from the highest level to the lowest odd one, each run at it or higher is reversed.
  const visualOrder: Array<number> = units.map(
    (_unit: string, index: number): number => {
      return index;
    },
  );
  const highest: number = Math.max(paragraphLevel, ...levels);
  const lowestOdd: number = Math.min(
    ...levels.map((each: number): number => {
      return each % 2 === 1 ? each : each + 1;
    }),
    paragraphLevel % 2 === 1 ? paragraphLevel : paragraphLevel + 1,
  );

  for (let reversed: number = highest; reversed >= lowestOdd; reversed--) {
    let at: number = 0;

    while (at < count) {
      if ((levels[visualOrder[at] as number] as number) < reversed) {
        at++;
        continue;
      }

      let end: number = at;

      while (
        end < count &&
        (levels[visualOrder[end] as number] as number) >= reversed
      ) {
        end++;
      }

      const run: Array<number> = visualOrder.slice(at, end).reverse();

      visualOrder.splice(at, run.length, ...run);
      at = end;
    }
  }

  const drawnAt: Array<number> = new Array<number>(count).fill(0);

  visualOrder.forEach((index: number, position: number): void => {
    drawnAt[index] = position;
  });

  return { units, classes, levels, visualOrder, drawnAt };
};

// Drawn with no width: isolates' marks, LRM, RLM and what X9 removes.
const isInvisible: (line: DrawnLine, index: number) => boolean = (
  line: DrawnLine,
  index: number,
): boolean => {
  const bidiClass: BidiClass = line.classes[index] as BidiClass;
  const unit: string = line.units[index] as string;

  return (
    bidiClass === "BN" ||
    isIsolateControl(bidiClass) ||
    unit === "\u{200E}" ||
    unit === "\u{200F}" ||
    unit === "\u{061C}"
  );
};

/*
 * Whether units [from, to) of a line are drawn as they are written: from
 * left to right, side by side with nothing else between them, and at a
 * left-to-right level, so that no bracket among them is drawn mirrored.
 */
export const isDrawnAsWritten: (
  line: DrawnLine,
  from: number,
  to: number,
) => boolean = (line: DrawnLine, from: number, to: number): boolean => {
  const drawn: Array<number> = [];

  for (let index: number = from; index < to; index++) {
    if (isInvisible(line, index)) {
      continue;
    }

    if ((line.levels[index] as number) % 2 === 1) {
      return false;
    }

    drawn.push(line.drawnAt[index] as number);
  }

  for (let at: number = 1; at < drawn.length; at++) {
    if ((drawn[at] as number) <= (drawn[at - 1] as number)) {
      return false;
    }
  }

  if (drawn.length === 0) {
    return true;
  }

  // Nothing of the line's own is drawn between them.
  const left: number = drawn[0] as number;
  const right: number = drawn[drawn.length - 1] as number;

  for (let position: number = left; position <= right; position++) {
    const index: number = line.visualOrder[position] as number;

    if ((index < from || index >= to) && !isInvisible(line, index)) {
      return false;
    }
  }

  return true;
};

// The line as it is drawn, left to right, without what has no width.
export const getDrawnText: (line: DrawnLine) => string = (
  line: DrawnLine,
): string => {
  return line.visualOrder
    .filter((index: number): boolean => {
      return !isInvisible(line, index);
    })
    .map((index: number): string => {
      return line.units[index] as string;
    })
    .join("");
};
