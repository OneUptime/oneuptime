import ObjectID from "../../../Types/ObjectID";

/*
 * SPELLINGS OF ONE ID.
 *
 * Postgres reads a uuid written in upper, lower or mixed case, in braces,
 * without hyphens, or with a hyphen after any four of its digits, as the
 * same uuid, and OneUptime takes every one of those wherever an id is given
 * (UUIDColumnFilter.isUUIDText). So a request may name a record - its
 * project, in the tenant header or in its data - by any of them, and
 * anything keyed by an id's text rather than by the uuid sees a different
 * key for each.
 *
 * Two shapes of spelling are told apart here:
 *
 *  - CASE spellings keep the canonical 8-4-4-4-12 hyphenation and change
 *    only letter case. These pass every check a create makes on the way to
 *    its INSERT - the project-scoped reference check lower-cases before it
 *    compares (ProjectScopedReferenceRefusal.normalizeReferenceId), and the
 *    id validators take any case - so a create that names its project this
 *    way reaches the table. caseSpellingsOf and spellingsOf give these.
 *
 *  - The EXOTIC spellings (braces, no hyphens, a hyphen after every four
 *    digits) Postgres still reads as the uuid, but a create that names its
 *    project by one is refused earlier, by the reference check or an id
 *    validator, before the limit is reached. The lock keys them to the
 *    same project all the same (ProjectLimitLock.getProjectKey), so nothing
 *    rests on where that refusal happens. exoticSpellingsOf gives these,
 *    for the key's own test.
 */

// A group of four hex digits of an id.
const FOUR_DIGITS: RegExp = /[0-9a-f]{4}/g;

// A hex digit written as a letter, whose case a spelling can turn.
const HEX_LETTER: RegExp = /[a-f]/;

// How many spellingsOf / caseSpellingsOf give by default.
export const SPELLINGS_PER_ID: number = 12;

/*
 * A new id with letters at both ends, so that case spellings of it are
 * texts of their own: an id all of whose digits are 0-9 has only the one
 * case.
 */
export function generateIdWithLetters(): ObjectID {
  const generated: string = ObjectID.generate().toString();

  return new ObjectID(`ab${generated.slice(2, -2)}cd`);
}

/*
 * `count` case spellings of `id`, canonically hyphenated, each a different
 * text: its own, then the next with one more of its letters upper-cased, so
 * a create that names its project by any of them reaches the table. Throws
 * when `id` has too few letters to make `count` of them (give one from
 * generateIdWithLetters).
 */
export function caseSpellingsOf(
  id: ObjectID,
  count: number = SPELLINGS_PER_ID,
): Array<ObjectID> {
  const canonical: string = id.toString().toLowerCase();
  const letterPositions: Array<number> = [];

  for (let index: number = 0; index < canonical.length; index++) {
    if (HEX_LETTER.test(canonical.charAt(index))) {
      letterPositions.push(index);
    }
  }

  if (1 << letterPositions.length < count) {
    throw new Error(
      `Cannot make ${count} case spellings of ${canonical}: it has only ${letterPositions.length} letters. Use generateIdWithLetters.`,
    );
  }

  const spellings: Array<ObjectID> = [];

  for (let variant: number = 0; variant < count; variant++) {
    const characters: Array<string> = canonical.split("");

    for (let bit: number = 0; bit < letterPositions.length; bit++) {
      if (variant & (1 << bit)) {
        const position: number = letterPositions[bit]!;
        characters[position] = characters[position]!.toUpperCase();
      }
    }

    spellings.push(new ObjectID(characters.join("")));
  }

  if (
    new Set(
      spellings.map((one: ObjectID): string => {
        return one.toString();
      }),
    ).size !== count
  ) {
    throw new Error(`Case spellings of ${canonical} were not all distinct.`);
  }

  return spellings;
}

// spellingsOf is caseSpellingsOf: the spellings a racing create may use.
export function spellingsOf(
  id: ObjectID,
  count: number = SPELLINGS_PER_ID,
): Array<ObjectID> {
  return caseSpellingsOf(id, count);
}

function firstLetterUp(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/*
 * Every exotic spelling of `id` Postgres still reads as the uuid: upper
 * case, braces, no hyphens, a hyphen after every four digits, and mixes of
 * them. For the lock key's own test, which keys them all to one project.
 */
export function exoticSpellingsOf(id: ObjectID): Array<ObjectID> {
  const canonical: string = id.toString().toLowerCase();
  const digits: string = canonical.split("-").join("");
  const everyFour: string = (digits.match(FOUR_DIGITS) || []).join("-");

  const texts: Array<string> = [
    canonical,
    canonical.toUpperCase(),
    `{${canonical}}`,
    `{${canonical.toUpperCase()}}`,
    digits,
    digits.toUpperCase(),
    everyFour,
    everyFour.toUpperCase(),
    `{${digits}}`,
    firstLetterUp(canonical),
    `{${firstLetterUp(everyFour)}}`,
  ];

  return texts.map((text: string): ObjectID => {
    return new ObjectID(text);
  });
}
