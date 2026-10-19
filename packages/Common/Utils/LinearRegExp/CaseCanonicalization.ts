import CharacterSet, { MAX_CODE_UNIT } from "./CharacterSet";

/*
 * WHICH CODE UNITS A CASE-INSENSITIVE PATTERN TAKES FOR ONE ANOTHER.
 *
 * JavaScript without the u flag compares two code units under the i flag by
 * their canonical forms (ECMAScript, "Canonicalize"): a code unit's
 * upper-case form when that is one code unit, except that a code unit at or
 * above 128 never becomes one below it - so "ſ" (U+017F), whose upper case is
 * "S", stays apart from "s", and the Kelvin sign stays apart from "k". Two
 * code units with the same canonical form match each other, and a character
 * class matches a code unit when any of its members has that code unit's
 * canonical form.
 *
 * The table is computed once, from String.prototype.toUpperCase - the same
 * Unicode Default Case Conversion the specification names - so it holds the
 * case pairs of the Unicode version the running engine carries.
 */

let canonicalForms: Uint16Array | null = null;

// Every code unit, ordered by canonical form; equal forms sit together.
let orbitMembers: Uint16Array | null = null;
// orbitStart[form] .. orbitStart[form + 1]: where that form's members are.
let orbitStart: Int32Array | null = null;
// The code units that share their canonical form with another, ascending.
let codeUnitsWithCaseVariants: Uint16Array | null = null;

function computeTables(): void {
  const forms: Uint16Array = new Uint16Array(MAX_CODE_UNIT + 1);

  for (let codeUnit: number = 0; codeUnit <= MAX_CODE_UNIT; codeUnit++) {
    const upper: string = String.fromCharCode(codeUnit).toUpperCase();

    if (upper.length !== 1) {
      forms[codeUnit] = codeUnit;
      continue;
    }

    const upperCodeUnit: number = upper.charCodeAt(0);

    forms[codeUnit] =
      codeUnit >= 128 && upperCodeUnit < 128 ? codeUnit : upperCodeUnit;
  }

  const counts: Int32Array = new Int32Array(MAX_CODE_UNIT + 2);

  for (let codeUnit: number = 0; codeUnit <= MAX_CODE_UNIT; codeUnit++) {
    counts[forms[codeUnit]! + 1] = counts[forms[codeUnit]! + 1]! + 1;
  }

  const start: Int32Array = new Int32Array(MAX_CODE_UNIT + 2);

  for (let form: number = 1; form <= MAX_CODE_UNIT + 1; form++) {
    start[form] = start[form - 1]! + counts[form]!;
  }

  const members: Uint16Array = new Uint16Array(MAX_CODE_UNIT + 1);
  const filled: Int32Array = start.slice(0, MAX_CODE_UNIT + 1);

  for (let codeUnit: number = 0; codeUnit <= MAX_CODE_UNIT; codeUnit++) {
    const form: number = forms[codeUnit]!;

    members[filled[form]!] = codeUnit;
    filled[form] = filled[form]! + 1;
  }

  const withVariants: Array<number> = [];

  for (let codeUnit: number = 0; codeUnit <= MAX_CODE_UNIT; codeUnit++) {
    const form: number = forms[codeUnit]!;

    if (start[form + 1]! - start[form]! > 1) {
      withVariants.push(codeUnit);
    }
  }

  canonicalForms = forms;
  orbitMembers = members;
  orbitStart = start;
  codeUnitsWithCaseVariants = Uint16Array.from(withVariants);
}

function getCanonicalForms(): Uint16Array {
  if (!canonicalForms) {
    computeTables();
  }

  return canonicalForms!;
}

// The canonical form of a code unit under the i flag, without the u flag.
export function canonicalize(codeUnit: number): number {
  return getCanonicalForms()[codeUnit]!;
}

// Every code unit a case-insensitive pattern takes for this one, itself too.
export function getCaseVariants(codeUnit: number): Array<number> {
  const form: number = canonicalize(codeUnit);
  const variants: Array<number> = [];

  for (
    let index: number = orbitStart![form]!;
    index < orbitStart![form + 1]!;
    index++
  ) {
    variants.push(orbitMembers![index]!);
  }

  return variants;
}

/*
 * Every code unit a case-insensitive class of these members matches: each
 * member, and every code unit that shares a member's canonical form.
 */
export function closeOverCase(set: CharacterSet): CharacterSet {
  getCanonicalForms();

  const variants: Uint16Array = codeUnitsWithCaseVariants!;
  const pairs: Array<number> = [...set.ranges];

  for (let index: number = 0; index < set.ranges.length; index += 2) {
    const first: number = set.ranges[index]!;
    const last: number = set.ranges[index + 1]!;

    // The first code unit with case variants at or after `first`.
    let low: number = 0;
    let high: number = variants.length;

    while (low < high) {
      const middle: number = (low + high) >>> 1;

      if (variants[middle]! < first) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }

    for (
      let position: number = low;
      position < variants.length && variants[position]! <= last;
      position++
    ) {
      for (const variant of getCaseVariants(variants[position]!)) {
        pairs.push(variant, variant);
      }
    }
  }

  return CharacterSet.fromPairs(pairs);
}
