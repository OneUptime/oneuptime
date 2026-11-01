/*
 * How a button that cannot be pressed looks - a locked action, a Next with
 * nothing chosen yet - whatever its style: faded as a whole, with the
 * not-allowed cursor, and no hover (the style leaves its hover classes off).
 * Before, a disabled plain or outline button looked exactly like one that
 * works until it was hovered, so a locked action looked pressable ("Turn
 * monitoring on", a viewer's Triage again, a Reset the reader may not make),
 * and the three styles that had a disabled look swapped their fill for a
 * paler one - indigo-300, red-300 - which in the dark theme was a bright
 * block brighter than the button it stood for, and on SECONDARY darker than
 * its own light fill. A loading button is busy, not locked: it keeps its
 * look and shows its spinner.
 *
 * React-free, so a module of class names for buttons drawn by hand (an event
 * header's, a security case's) can take its locked look from here and still
 * be read by the App's tests, which load no React.
 */

// The cursor of anything locked: a button, its tooltip wrapper, a choice.
export const BUTTON_DISABLED_CURSOR_CLASS_NAME: string = "cursor-not-allowed";

/*
 * The fade alone: half its strength, in its own colours. For the parts of
 * a locked tile or row that do not say why it is locked - the reason it
 * holds ("Already in episode AE-11", "GitHub is not set up on this server")
 * stays as easy to read as any other line.
 */
export const BUTTON_DISABLED_FADE_CLASS_NAME: string = "opacity-50";

export const BUTTON_DISABLED_CLASS_NAME: string = `${BUTTON_DISABLED_CURSOR_CLASS_NAME} ${BUTTON_DISABLED_FADE_CLASS_NAME}`;

export interface HandDrawnButtonState {
  // It cannot be pressed: a locked action, nothing to act on yet.
  isLocked?: boolean | undefined;
  /*
   * It is working - refreshing, loading more, saving - and cannot be pressed
   * again until it is done. Busy is not locked, even when it is locked too.
   */
  isBusy?: boolean | undefined;
  /*
   * What it does under the pointer while it can be pressed (hover:bg-gray-50
   * hover:text-gray-900): left off while it is locked or busy, as Button
   * leaves its own off.
   */
  hoverClassName?: string | undefined;
  /*
   * It holds the reason it is locked, in words of its own: locked, it takes
   * the not-allowed cursor only, and its other parts fade
   * (BUTTON_DISABLED_FADE_CLASS_NAME) while the reason does not.
   */
  holdsItsReason?: boolean | undefined;
}

/*
 * The state classes of a <button> drawn by hand - a tile, a chip, a
 * segmented control, a toolbar's or a player's control, a link that loads
 * more - so it looks the way a Button in that state does:
 *
 *   - it can be pressed: its hover;
 *   - locked: faded, with the not-allowed cursor, and no hover
 *     (BUTTON_DISABLED_CLASS_NAME);
 *   - busy: its own look, no hover - a busy Button keeps its look beside its
 *     spinner, so a Refresh that turns while it works is not mistaken for
 *     one that is turned off.
 *
 * Its `disabled` attribute stays the button's own (disabled={isLocked ||
 * isBusy}). Each such button used to say "disabled" in a look of its own -
 * faded to 40%, 60% or 70%, its words grey or a pale indigo, a wait or an
 * arrow cursor - and kept its hover wash when it could not be pressed
 * (HandDrawnButtonLockedLookGuard holds every frontend to this one).
 */
export const getHandDrawnButtonStateClassName: (
  state: HandDrawnButtonState,
) => string = (state: HandDrawnButtonState): string => {
  if (state.isBusy) {
    return "";
  }

  if (state.isLocked) {
    return state.holdsItsReason
      ? BUTTON_DISABLED_CURSOR_CLASS_NAME
      : BUTTON_DISABLED_CLASS_NAME;
  }

  return state.hoverClassName || "";
};

/*
 * A part of a locked button that holds its reason (holdsItsReason): faded
 * while locked, unless it is the reason. Nothing while it can be pressed or
 * is busy.
 */
export const getLockedPartClassName: (data: {
  isLocked?: boolean | undefined;
  isBusy?: boolean | undefined;
}) => string = (data: {
  isLocked?: boolean | undefined;
  isBusy?: boolean | undefined;
}): string => {
  return data.isLocked && !data.isBusy ? BUTTON_DISABLED_FADE_CLASS_NAME : "";
};

const CLASS_SEPARATOR: RegExp = /\s+/u;

// hover, group-hover, peer-hover, group-hover/row: the pointer's variants.
const HOVER_VARIANT: RegExp = /^(?:[\w-]+-)?hover(?:\/[\w-]+)?$/u;

/*
 * A look written with its hover in it ("cursor-pointer text-gray-600
 * hover:bg-gray-100 hover:text-gray-900"), at rest: every class that
 * answers the pointer (hover:, group-hover:, dark:hover:...) left out, and
 * its own cursor, which a control that cannot be pressed does not show. A
 * locked or busy control keeps its colours and gives no hover - the dark
 * theme's hover rules are !important, so a hover class left on would light
 * it up.
 */
export const getRestingClassName: (className: string) => string = (
  className: string,
): string => {
  return className
    .split(CLASS_SEPARATOR)
    .filter((token: string): boolean => {
      if (!token) {
        return false;
      }

      const parts: Array<string> = token.split(":");
      const utility: string = parts[parts.length - 1] || "";

      // A cursor of its own, at rest or under a press (active:cursor-grabbing).
      if (utility.startsWith("cursor-")) {
        return false;
      }

      return !parts.slice(0, -1).some((variant: string): boolean => {
        return HOVER_VARIANT.test(variant);
      });
    })
    .join(" ");
};

/*
 * A class that sets where a button sits in its row - its width, its share
 * of a flex row, its place in a grid, an auto margin that pushes it to an
 * end - read from the utility itself, whatever variants come before it.
 */
const ROW_LAYOUT_UTILITY: RegExp =
  /^(?:w-|min-w-|max-w-|basis-|grow|shrink|self-|order-|col-span-|col-start-|col-end-|row-span-|justify-self-|flex-(?:1|auto|initial|none|\[)|(?:m|mx|ms|me|ml|mr)-auto$)/u;

const utilityOf: (token: string) => string = (token: string): string => {
  const parts: Array<string> = token.split(":");
  const utility: string = parts[parts.length - 1] || "";

  return utility.startsWith("!") ? utility.slice(1) : utility;
};

/*
 * The classes of the wrapper a locked button with a reason sits in - the
 * element that takes the pointer and the keyboard's stop, and shows the
 * reason (Button's tooltip). It takes the button's place in its row: a
 * button as wide as a phone (w-full md:w-auto, as NORMAL and PRIMARY are)
 * is wrapped in a block as wide as the phone, and the classes a caller
 * gives the button for its place in a row (flex-1, w-full, ml-auto, a grid
 * span) go on the wrapper too. The wrapper was only as wide as its words,
 * so on a phone a locked button was narrower than an unlocked one beside it.
 */
export const getInertButtonWrapperClassName: (data: {
  // Every class the button itself is drawn with.
  buttonClassName: string;
  isLocked: boolean;
}) => string = (data: {
  buttonClassName: string;
  isLocked: boolean;
}): string => {
  const tokens: Array<string> = data.buttonClassName
    .split(CLASS_SEPARATOR)
    .filter(Boolean);
  const isPhoneWide: boolean =
    tokens.includes("w-full") && tokens.includes("md:w-auto");

  const rowLayout: Array<string> = tokens.filter((token: string): boolean => {
    if (isPhoneWide && (token === "w-full" || token === "md:w-auto")) {
      return false;
    }

    return ROW_LAYOUT_UTILITY.test(utilityOf(token));
  });

  return [
    isPhoneWide ? "flex w-full md:inline-flex md:w-auto" : "inline-flex",
    ...rowLayout,
    data.isLocked ? BUTTON_DISABLED_CURSOR_CLASS_NAME : "",
  ]
    .filter(Boolean)
    .join(" ");
};

/*
 * The wrapper's part in the keyboard's focus. The wrapper takes the
 * keyboard's stop in place of the button inside it - a locked button's, to
 * say why it is locked; a busy one's, while it works - so the button's own
 * focus ring is drawn round the button whenever the wrapper has the
 * keyboard's focus (getInertButtonFocusRingClassName), and the wrapper
 * draws none of its own. The browser's outline round the wrapper was a
 * black square that took in the 12px margin a button carries from md up,
 * so it touched the Cancel beside a locked Save.
 */
export const INERT_BUTTON_WRAPPER_FOCUS_CLASS_NAME: string =
  "group/inert focus:outline-none";

const FOCUS_VISIBLE_VARIANT: string = "focus-visible:";

const INERT_WRAPPER_FOCUS_VISIBLE_VARIANT: string =
  "group-focus-visible/inert:";

/*
 * A wrapped button's focus ring: each of its focus-visible: classes, drawn
 * while its wrapper has the keyboard's focus - the same ring, in the same
 * colour, as the button draws when it has the focus itself.
 */
export const getInertButtonFocusRingClassName: (
  buttonClassName: string,
) => string = (buttonClassName: string): string => {
  return buttonClassName
    .split(CLASS_SEPARATOR)
    .filter((token: string): boolean => {
      return token.startsWith(FOCUS_VISIBLE_VARIANT);
    })
    .map((token: string): string => {
      return `${INERT_WRAPPER_FOCUS_VISIBLE_VARIANT}${token.slice(
        FOCUS_VISIBLE_VARIANT.length,
      )}`;
    })
    .join(" ");
};

/*
 * A look written with its hover in it, in a state: as written while it can
 * be pressed; at rest while it is busy; at rest and faded, with the
 * not-allowed cursor, while it is locked.
 */
export const getHandDrawnLookClassName: (data: {
  className: string;
  isLocked?: boolean | undefined;
  isBusy?: boolean | undefined;
}) => string = (data: {
  className: string;
  isLocked?: boolean | undefined;
  isBusy?: boolean | undefined;
}): string => {
  if (data.isBusy) {
    return getRestingClassName(data.className);
  }

  if (data.isLocked) {
    return `${getRestingClassName(data.className)} ${BUTTON_DISABLED_CLASS_NAME}`;
  }

  return data.className;
};
