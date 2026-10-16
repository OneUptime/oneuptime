/*
 * How a sign-in page draws its other ways in - "Sign in with SSO", "Sign in
 * with Microsoft", "Sign in with a passkey" - under an "or" divider below the
 * page's one filled button. Each is a normal button: full width, white and
 * outlined, as tall as the filled button above it (the same padding and type
 * size as Button's PRIMARY), with an icon before its words. They used to be
 * centred text links, one per line beside a bordered Microsoft button, and
 * read as small print rather than as choices.
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
 * from md, font-medium, rounded-md and a one-pixel border.
 */
export const SIGN_IN_OPTION_LAYOUT_CLASS: string =
  "flex w-full items-center justify-center gap-2 rounded-md border px-3 py-2 text-center text-base font-medium md:text-sm transition-colors duration-150 ease-out motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

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

// The icon before the words: the size of the label's line, never squeezed.
export const SIGN_IN_OPTION_ICON_CLASS: string = "h-5 w-5 shrink-0";

type GetSignInOptionClassNameFunction = (state?: SignInOptionState) => string;

export const getSignInOptionClassName: GetSignInOptionClassNameFunction = (
  state: SignInOptionState = "ready",
): string => {
  return `${SIGN_IN_OPTION_LAYOUT_CLASS} ${SIGN_IN_OPTION_LOOK_CLASS[state]}`;
};
