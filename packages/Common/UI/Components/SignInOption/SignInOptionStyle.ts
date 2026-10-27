/*
 * How a sign-in page draws its other ways in - "Sign in with SSO", "Sign in
 * with Microsoft", "Sign in with a passkey" - under an "or" divider below the
 * page's one filled button. Each is a normal button: full width, white and
 * outlined, as tall as the filled button above it (the same padding and type
 * size as Button's PRIMARY), with an icon before its words. They used to be
 * centred text links, one per line beside a bordered Microsoft button, and
 * read as small print rather than as choices. SignInOptionLabel draws the
 * words and their icon.
 *
 * One look per state, and a state's classes never set a property another
 * class in the list also sets: Tailwind decides such a tie by the order of
 * its stylesheet, not by the order of the class list, so a "ready" border
 * left next to an "unavailable" one would win or lose by accident.
 *
 *  - ready: a normal button, with a hover;
 *  - busy: the option's own attempt is running (a passkey prompt is open). It
 *    stays at full strength, without a hover, and its words say what it is
 *    waiting for;
 *  - paused: another sign-in is running (the password form is submitting).
 *    Faded, like the form a passkey attempt pauses, and without a hover;
 *  - unavailable: this browser cannot use it, and the page has said so. A
 *    disabled-looking button that can still hold keyboard focus, with words
 *    dark enough to read.
 */
export type SignInOptionState = "ready" | "busy" | "paused" | "unavailable";

export const SIGN_IN_OPTION_STATES: ReadonlyArray<SignInOptionState> = [
  "ready",
  "busy",
  "paused",
  "unavailable",
];

/*
 * The box, the type and the keyboard focus ring, the same in every state.
 * Shared with Button's PRIMARY: px-3 py-2, text-base under md and text-sm
 * from md, font-medium, rounded-md and a one-pixel border. Its one child is
 * the label (SIGN_IN_OPTION_LABEL_CLASS), centred.
 */
export const SIGN_IN_OPTION_LAYOUT_CLASS: string =
  "flex w-full items-center justify-center rounded-md border px-3 py-2 text-center text-base font-medium md:text-sm transition-colors duration-150 ease-out motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

export const SIGN_IN_OPTION_LOOK_CLASS: Readonly<
  Record<SignInOptionState, string>
> = {
  ready:
    "cursor-pointer border-gray-300 bg-white text-gray-700 shadow-sm hover:bg-gray-50",
  busy: "cursor-default border-gray-300 bg-white text-gray-700 shadow-sm",
  paused:
    "cursor-default border-gray-300 bg-white text-gray-700 shadow-sm opacity-50",
  unavailable: "cursor-default border-gray-200 bg-gray-50 text-gray-500",
};

/*
 * The words, with their icon at the start of the first line, laid out by
 * their own direction (dir="auto"). A label too long for one line - Spanish
 * "Iniciar sesión con una clave de acceso" on a phone - wraps into balanced
 * lines, and its icon stays beside the words it belongs to. With the icon
 * and the words as two flex items, the words took the whole width once they
 * wrapped and left the icon at the button's edge.
 */
export const SIGN_IN_OPTION_LABEL_CLASS: string =
  "min-w-0 break-words text-balance";

/*
 * The icon's place at the start of the words: in the line, with a gap before
 * the first word (on its left in a right-to-left label). It sits on the
 * baseline, which centres a 20px icon on the words, and its negative margins
 * keep the line - and so the button - exactly as tall as one without an icon.
 */
export const SIGN_IN_OPTION_ICON_SLOT_CLASS: string =
  "-my-1 me-2 inline-block align-baseline";

// The icon itself: the height of the label's line.
export const SIGN_IN_OPTION_ICON_CLASS: string = "h-5 w-5";

/*
 * The one way in, filled: a sign-in page whose only way in is one single
 * sign-on provider (while the server requires SSO) draws it as the page's
 * filled button - the box above, filled like Button's PRIMARY, with its
 * hover - rather than as an outlined option under a filled button the page
 * does not have.
 */
export const SIGN_IN_OPTION_PRIMARY_LOOK_CLASS: string =
  "cursor-pointer border-transparent bg-indigo-600 text-white shadow-sm hover:bg-indigo-700";

export const SIGN_IN_OPTION_PRIMARY_CLASS: string = `${SIGN_IN_OPTION_LAYOUT_CLASS} ${SIGN_IN_OPTION_PRIMARY_LOOK_CLASS}`;

type GetSignInOptionClassNameFunction = (state?: SignInOptionState) => string;

export const getSignInOptionClassName: GetSignInOptionClassNameFunction = (
  state: SignInOptionState = "ready",
): string => {
  return `${SIGN_IN_OPTION_LAYOUT_CLASS} ${SIGN_IN_OPTION_LOOK_CLASS[state]}`;
};
