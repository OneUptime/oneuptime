import {
  getReadingDirection,
  POP_DIRECTIONAL_ISOLATE,
  ReadingDirection,
  RIGHT_TO_LEFT,
  setApartInSentence,
} from "./ReadingDirection";

/*
 * AN ARROW THAT POINTS THE WAY ITS LINE IS READ.
 *
 * A browser turns a bracket, ">" and "›" round on a line read from the
 * right, but draws "→" and "←" as they are written. So an arrow a
 * component wrote into its line pointed back on an Arabic or Persian page:
 * between two values ("Declared → Acknowledged", "12.5% → 15.0%") from the
 * second to the first, after a link's words ("Show on map →") back into
 * them. Those languages write such an arrow "←" (the Dashboard's
 * Locales/ARABIC.md), and so do the Persian docs.
 *
 * A component takes its arrow from here, for the language its line is
 * read in, and never writes one itself:
 *
 *   - getArrowOn: to what comes next - the second of two values, where a
 *     link leads. "→", and "←" in a language read from the right.
 *   - getArrowBack: to what came before - "← Back", a field that takes an
 *     answer's value ("Severity ← from answer"). "←", and "→".
 *   - joinWithArrowsOn: values in the order they are read, with the arrow
 *     on between each two. Each value is set apart where it could move the
 *     arrow (setApartInSentence): between two names in Latin letters the
 *     bidi algorithm would draw an arrow from the left on a Persian page,
 *     between two Persian ones from the right on an English page. Set
 *     apart, each value reads its own way and the arrow is the line's.
 *   - joinWithArrowsInDirection: the same in a line read one way on every
 *     page, as the names of a diagram drawn from the left everywhere are.
 *
 * Common/UI's DirectionArrow draws the arrow in a component.
 * ComponentArrowsInRightToLeftPages (Common/Tests/App) fails on an arrow
 * written into the Dashboard's or the shared UI's components instead.
 */

export const RIGHTWARDS_ARROW: string = "→";

export const LEFTWARDS_ARROW: string = "←";

// The arrow to what comes next, in a line read `direction`.
const getArrowOnInDirection: (direction: ReadingDirection) => string = (
  direction: ReadingDirection,
): string => {
  return direction === RIGHT_TO_LEFT ? LEFTWARDS_ARROW : RIGHTWARDS_ARROW;
};

// The arrow to what comes next, in a line read in `language`.
export const getArrowOn: (language: string | null | undefined) => string = (
  language: string | null | undefined,
): string => {
  return getArrowOnInDirection(getReadingDirection(language));
};

// The arrow to what came before, in a line read in `language`.
export const getArrowBack: (language: string | null | undefined) => string = (
  language: string | null | undefined,
): string => {
  return getReadingDirection(language) === RIGHT_TO_LEFT
    ? RIGHTWARDS_ARROW
    : LEFTWARDS_ARROW;
};

// RIGHT-TO-LEFT ISOLATE: what follows it, up to its PDI, reads from the right.
const RIGHT_TO_LEFT_ISOLATE: string = String.fromCharCode(0x2067);

/*
 * "first → second → third" in a line read `direction`: the values in
 * the order they are read, each set apart where it could move the arrow.
 * Read from the left, two names in Latin letters are written exactly as
 * they were joined before ("m5.2xlarge → m5.xlarge").
 *
 * Read from the right, the whole is set apart once more, right to left
 * (RLI ... PDI). A sentence that takes it as one of its values may set
 * that value apart (setsValuesApart), and an isolate with no letter of its
 * own outside the values it sets apart reads from the left: every arrow
 * in it would point back again.
 *
 * A line takes its direction from the language its page reads
 * (joinWithArrowsOn), except the names of a diagram drawn from the left on
 * every page: the user flow map's bands run left to right on an Arabic
 * page too, so a band is named the map's way there, "/home → /cart".
 */
export const joinWithArrowsInDirection: (
  values: ReadonlyArray<string>,
  direction: ReadingDirection,
) => string = (
  values: ReadonlyArray<string>,
  direction: ReadingDirection,
): string => {
  const joined: string = values
    .map((value: string): string => {
      return setApartInSentence(value, direction);
    })
    .join(` ${getArrowOnInDirection(direction)} `);

  return direction === RIGHT_TO_LEFT && values.length > 1
    ? `${RIGHT_TO_LEFT_ISOLATE}${joined}${POP_DIRECTIONAL_ISOLATE}`
    : joined;
};

// The same, in a line read in `language`: the way its page reads.
export const joinWithArrowsOn: (
  values: ReadonlyArray<string>,
  language: string | null | undefined,
) => string = (
  values: ReadonlyArray<string>,
  language: string | null | undefined,
): string => {
  return joinWithArrowsInDirection(values, getReadingDirection(language));
};
