/*
 * CHARACTER CLASSES OF A REGULAR EXPRESSION, READ AS THE RUNTIME READS THEM.
 *
 * The code scanning guards read patterns the way code scanning (CodeQL)
 * does, and a class's ranges are where js/overly-large-range looks: two
 * ranges that share characters, a range that shares them with \d, \w or
 * \s, a range from letters into punctuation. This reads every class of a
 * pattern's source - its ranges, its single characters, its class and
 * property escapes - with the u flag by code point and without it by UTF-16
 * code unit, as the runtime does, escapes included (\x41, \u0041,
 * \u{1F600}, \cJ, legacy octal).
 *
 * Read by the docs tests' guard (App/Tests/FeatureSet/Docs/DocsCodeScanning)
 * and the product code guard (CodeScanning, ProductCodeScanningGuard). It
 * imports nothing.
 */

// A range of a character class: its first and last character, as numbers.
export interface ClassRange {
  low: number;
  high: number;
  // As the pattern writes it, e.g. "a-z" or "\u{3000}-\u{303F}".
  text: string;
}

export interface CharacterClass {
  // As the pattern writes it, brackets included.
  text: string;
  negated: boolean;
  ranges: Array<ClassRange>;
  // The single characters it lists, as numbers.
  characters: Array<number>;
  // The class escapes it holds: "d", "w", "s" and their capitals.
  classEscapes: Array<string>;
  // The property escapes it holds, such as "\p{Script=Han}".
  propertyEscapes: Array<string>;
}

type ClassAtom =
  | { kind: "character"; value: number }
  | { kind: "class escape"; name: string }
  | { kind: "property escape"; text: string };

const HEX_DIGITS: RegExp = /^[0-9A-Fa-f]+$/;
const OCTAL_DIGIT: RegExp = /^[0-7]$/;
const DECIMAL_DIGIT: RegExp = /^[0-9]$/;
const CONTROL_LETTER: RegExp = /^[A-Za-z]$/;
// What a class may also take after \c without the u flag (Annex B).
const CLASS_CONTROL_CHARACTER: RegExp = /^[0-9_]$/;
const CLASS_ESCAPE_NAMES: string = "dDwWsS";
const BACKSLASH: string = "\\";

// The escapes that stand for one control character.
export const CONTROL_ESCAPES: Readonly<Record<string, number>> = {
  b: 0x08,
  t: 0x09,
  n: 0x0a,
  v: 0x0b,
  f: 0x0c,
  r: 0x0d,
};

// The character at `at`, by code point with the u flag, by code unit without.
function characterAt(
  source: string,
  at: number,
  unicode: boolean,
): { value: number; next: number } {
  const value: number = unicode
    ? (source.codePointAt(at) as number)
    : source.charCodeAt(at);

  return { value: value, next: at + (value > 0xffff ? 2 : 1) };
}

// The escape that starts at `at` (a backslash) inside a character class.
function readClassEscape(
  source: string,
  at: number,
  unicode: boolean,
): { atom: ClassAtom; next: number } {
  const name: string = source.charAt(at + 1);

  if (CLASS_ESCAPE_NAMES.includes(name)) {
    return { atom: { kind: "class escape", name: name }, next: at + 2 };
  }

  if (unicode && (name === "p" || name === "P")) {
    const close: number = source.indexOf("}", at);

    return {
      atom: { kind: "property escape", text: source.slice(at, close + 1) },
      next: close + 1,
    };
  }

  if (CONTROL_ESCAPES[name] !== undefined) {
    return {
      atom: { kind: "character", value: CONTROL_ESCAPES[name] as number },
      next: at + 2,
    };
  }

  if (name === "x" && HEX_DIGITS.test(source.slice(at + 2, at + 4))) {
    if (source.slice(at + 2, at + 4).length === 2) {
      return {
        atom: {
          kind: "character",
          value: parseInt(source.slice(at + 2, at + 4), 16),
        },
        next: at + 4,
      };
    }
  }

  if (name === "u") {
    if (unicode && source.charAt(at + 2) === "{") {
      const close: number = source.indexOf("}", at);

      return {
        atom: {
          kind: "character",
          value: parseInt(source.slice(at + 3, close), 16),
        },
        next: close + 1,
      };
    }

    const digits: string = source.slice(at + 2, at + 6);

    if (digits.length === 4 && HEX_DIGITS.test(digits)) {
      const value: number = parseInt(digits, 16);
      const low: string = source.slice(at + 8, at + 12);

      // With the u flag, an escaped surrogate pair is one character.
      if (
        unicode &&
        value >= 0xd800 &&
        value <= 0xdbff &&
        source.slice(at + 6, at + 8) === `${BACKSLASH}u` &&
        low.length === 4 &&
        HEX_DIGITS.test(low) &&
        parseInt(low, 16) >= 0xdc00 &&
        parseInt(low, 16) <= 0xdfff
      ) {
        return {
          atom: {
            kind: "character",
            value:
              0x10000 + ((value - 0xd800) << 10) + (parseInt(low, 16) - 0xdc00),
          },
          next: at + 12,
        };
      }

      return { atom: { kind: "character", value: value }, next: at + 6 };
    }
  }

  if (name === "c") {
    const letter: string = source.charAt(at + 2);

    if (
      CONTROL_LETTER.test(letter) ||
      (!unicode && CLASS_CONTROL_CHARACTER.test(letter))
    ) {
      return {
        atom: { kind: "character", value: letter.charCodeAt(0) % 32 },
        next: at + 3,
      };
    }

    // Without the u flag, a "\c" that controls nothing is a backslash.
    return { atom: { kind: "character", value: 0x5c }, next: at + 1 };
  }

  if (name === "0" && !DECIMAL_DIGIT.test(source.charAt(at + 2))) {
    return { atom: { kind: "character", value: 0 }, next: at + 2 };
  }

  // Without the u flag, a backslash and octal digits are a legacy octal escape.
  if (!unicode && OCTAL_DIGIT.test(name)) {
    const longest: number = name <= "3" ? 3 : 2;
    let digits: string = name;

    while (
      digits.length < longest &&
      OCTAL_DIGIT.test(source.charAt(at + 1 + digits.length))
    ) {
      digits += source.charAt(at + 1 + digits.length);
    }

    return {
      atom: { kind: "character", value: parseInt(digits, 8) },
      next: at + 1 + digits.length,
    };
  }

  // Any other escaped character stands for itself.
  const escaped: { value: number; next: number } = characterAt(
    source,
    at + 1,
    unicode,
  );

  return {
    atom: { kind: "character", value: escaped.value },
    next: escaped.next,
  };
}

function readClassAtom(
  source: string,
  at: number,
  unicode: boolean,
): { atom: ClassAtom; next: number } {
  if (source.charAt(at) === BACKSLASH) {
    return readClassEscape(source, at, unicode);
  }

  const character: { value: number; next: number } = characterAt(
    source,
    at,
    unicode,
  );

  return {
    atom: { kind: "character", value: character.value },
    next: character.next,
  };
}

// The character class that opens at `at` (its "["), and where it ends.
function readClass(
  source: string,
  at: number,
  unicode: boolean,
): { characterClass: CharacterClass; next: number } {
  const characterClass: CharacterClass = {
    text: "",
    negated: false,
    ranges: [],
    characters: [],
    classEscapes: [],
    propertyEscapes: [],
  };
  let index: number = at + 1;

  if (source.charAt(index) === "^") {
    characterClass.negated = true;
    index++;
  }

  const add: (atom: ClassAtom) => void = (atom: ClassAtom): void => {
    if (atom.kind === "character") {
      characterClass.characters.push(atom.value);
    } else if (atom.kind === "class escape") {
      characterClass.classEscapes.push(atom.name);
    } else {
      characterClass.propertyEscapes.push(atom.text);
    }
  };

  while (index < source.length && source.charAt(index) !== "]") {
    const start: number = index;
    const first: { atom: ClassAtom; next: number } = readClassAtom(
      source,
      index,
      unicode,
    );

    // "a-b" is a range when both ends are characters and "-" is not last.
    if (
      first.atom.kind === "character" &&
      source.charAt(first.next) === "-" &&
      first.next + 1 < source.length &&
      source.charAt(first.next + 1) !== "]"
    ) {
      const second: { atom: ClassAtom; next: number } = readClassAtom(
        source,
        first.next + 1,
        unicode,
      );

      if (second.atom.kind === "character") {
        characterClass.ranges.push({
          low: first.atom.value,
          high: second.atom.value,
          text: source.slice(start, second.next),
        });
        index = second.next;
        continue;
      }

      // Next to a class escape, the "-" is a character of its own.
      add(first.atom);
      characterClass.characters.push(0x2d);
      add(second.atom);
      index = second.next;
      continue;
    }

    add(first.atom);
    index = first.next;
  }

  characterClass.text = source.slice(at, index + 1);

  return { characterClass: characterClass, next: index + 1 };
}

/*
 * Every character class of a pattern, read as the runtime reads it: with
 * the u flag a character is a code point, without it a UTF-16 code unit.
 * A pattern with the v flag, whose classes nest, is not read: none.
 */
export function characterClassesOf(
  source: string,
  flags: string,
): Array<CharacterClass> {
  if (flags.includes("v")) {
    return [];
  }

  const unicode: boolean = flags.includes("u");
  const classes: Array<CharacterClass> = [];
  let at: number = 0;

  while (at < source.length) {
    const character: string = source.charAt(at);

    if (character === BACKSLASH) {
      at += 2;
      continue;
    }

    if (character !== "[") {
      at++;
      continue;
    }

    const read: { characterClass: CharacterClass; next: number } = readClass(
      source,
      at,
      unicode,
    );

    classes.push(read.characterClass);
    at = read.next;
  }

  return classes;
}
