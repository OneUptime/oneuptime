import { KeyboardEventProp } from "../../Types/HtmlEvents";
import Icon, { SizeProp } from "../Icon/Icon";
import ShortcutKey from "../ShortcutKey/ShortcutKey";
import ButtonType from "./ButtonTypes";
import IconProp from "../../../Types/Icon/IconProp";
import useTranslateValue from "../../Utils/Translation";
import { withProductText } from "../../Utils/ProductText";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
} from "react";
import Tooltip from "../Tooltip/Tooltip";
import { GetReactElementFunction } from "../../Types/FunctionTypes";
import {
  BUTTON_DISABLED_CLASS_NAME,
  BUTTON_DISABLED_CURSOR_CLASS_NAME,
  getHandDrawnButtonStateClassName,
  getInertButtonFocusRingClassName,
  getInertButtonWrapperClassName,
  HandDrawnButtonState,
  INERT_BUTTON_WRAPPER_FOCUS_CLASS_NAME,
} from "./ButtonStates";

/*
 * How soon after a press a button that goes busy (or locked) counts as made
 * so by the press, and keeps the keyboard's place (see Button).
 */
export const FOCUS_KEEPING_PRESS_MS: number = 2000;

/*
 * Each style has one job (Docs/ux/README.md#one-control-for-one-job). The
 * filled indigo-100 SECONDARY, the filled green SUCCESS and the filled and
 * outlined yellow WARNING and WARNING_OUTLINE are gone: a page used SUCCESS
 * once (a playbook run's Approve, now PRIMARY) and nothing used the rest,
 * so they were four more looks for jobs the main styles already do (#9195).
 * ICON_LIGHT (ICON in a lighter grey) and HOVER_SUCCESS_OUTLINE (the plain
 * button tinted green under the pointer) went the same way: no page used
 * them (#9296). ICON and HOVER_PRIMARY_OUTLINE do their jobs.
 */
export enum ButtonStyleType {
  PRIMARY,
  OUTLINE,
  NORMAL,
  DANGER,
  DANGER_OUTLINE,
  SUCCESS_OUTLINE,
  LINK,
  SECONDARY_LINK,
  ICON,
  HOVER_DANGER_OUTLINE,
  HOVER_PRIMARY_OUTLINE,
}

export enum ButtonSize {
  Normal = "px-3 py-2",
  Small = "px-2 py-1",
  Large = "px-4 py-2",
  ExtraSmall = "px-0 py-0",
}

/*
 * How a button that cannot be pressed looks, whatever its style - faded,
 * with the not-allowed cursor and no hover - and how a busy one does, kept
 * React-free in ButtonStates so a button drawn by hand takes the same look
 * (getHandDrawnButtonStateClassName).
 */
export {
  BUTTON_DISABLED_CLASS_NAME,
  BUTTON_DISABLED_CURSOR_CLASS_NAME,
  getHandDrawnButtonStateClassName,
};
export type { HandDrawnButtonState };

/*
 * SECONDARY_LINK's words, and its words under the pointer: a muted link that
 * still meets WCAG's 4.5:1 for text on the light cards it sits on, and on
 * the dark theme's (Theme.css maps gray-600 to its muted text, and the hover
 * to its primary text).
 */
export const SECONDARY_LINK_TEXT_CLASS_NAME: string = "text-sm text-gray-600";
export const SECONDARY_LINK_HOVER_CLASS_NAME: string = "hover:text-gray-900";

/*
 * The frame every button with a box is drawn in, whatever its colour:
 * the same border width, corners, words, weight, shadow, alignment and
 * focus ring, at every width, so two buttons side by side are the same
 * height (their padding is the size's: ButtonSize). A button carries no
 * margin and no width of its own: the gap between buttons and a phone's
 * full-width row come from the box that holds them - a dialog's footer
 * (ModalFooter), a card header's actions, a form's footer, or a row with
 * `gap-3` (#9128).
 *
 * The filled buttons and the red, green and yellow outlined ones used to
 * take the whole width of their row below md, in larger words, and step
 * 12px in from md up (`w-full md:w-auto md:ml-3`), while OUTLINE, which
 * looked the same as NORMAL, did neither: whether a button filled a phone's
 * row or sat 12px in depended on which of two alike styles a page picked.
 * 118 places took the margin back with `ml-0`, and boxes pulled their
 * buttons left with `md:-ml-3`; on a 390px phone the Test SMS and calls
 * card put Send test SMS and Make test call on a line each (#9100).
 */
export const BOXED_BUTTON_CLASS_NAME: string =
  "inline-flex items-center justify-center rounded-md border text-sm font-medium shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

export type BoxedButtonStyleType =
  | ButtonStyleType.PRIMARY
  | ButtonStyleType.OUTLINE
  | ButtonStyleType.NORMAL
  | ButtonStyleType.DANGER
  | ButtonStyleType.DANGER_OUTLINE
  | ButtonStyleType.SUCCESS_OUTLINE
  | ButtonStyleType.HOVER_DANGER_OUTLINE
  | ButtonStyleType.HOVER_PRIMARY_OUTLINE;

// The plain button's colours: NORMAL, OUTLINE and the HOVER_* outlines.
const PLAIN_BUTTON_LOOK_CLASS_NAME: string =
  "border-gray-300 bg-white text-gray-700 focus-visible:ring-indigo-500";

// What fills each boxed style's frame: border, fill, words and focus ring.
export const BOXED_BUTTON_LOOK_CLASS_NAMES: Record<
  BoxedButtonStyleType,
  string
> = {
  [ButtonStyleType.PRIMARY]:
    "border-transparent bg-indigo-600 text-white focus-visible:ring-indigo-500",
  [ButtonStyleType.OUTLINE]: PLAIN_BUTTON_LOOK_CLASS_NAME,
  [ButtonStyleType.NORMAL]: PLAIN_BUTTON_LOOK_CLASS_NAME,
  [ButtonStyleType.DANGER]:
    "border-transparent bg-red-600 text-white focus-visible:ring-red-500",
  [ButtonStyleType.DANGER_OUTLINE]:
    "border-red-700 bg-white text-red-700 focus-visible:ring-red-500",
  [ButtonStyleType.SUCCESS_OUTLINE]:
    "border-green-700 bg-white text-green-700 focus-visible:ring-green-500",
  [ButtonStyleType.HOVER_DANGER_OUTLINE]: PLAIN_BUTTON_LOOK_CLASS_NAME,
  [ButtonStyleType.HOVER_PRIMARY_OUTLINE]: PLAIN_BUTTON_LOOK_CLASS_NAME,
};

/*
 * OUTLINE: the plain bordered button - and NORMAL, which draws exactly the
 * same button. The two differ only in what they tell a table: NORMAL is an
 * action the person came for, which a table row or header keeps in view
 * while OUTLINE's fold into its More menu first (SplitActionButtons,
 * TableHeaderControls). The HOVER_* outline styles are the same button
 * whose hover tints it with what it does.
 */
export const OUTLINE_BUTTON_CLASS_NAME: string = `${BOXED_BUTTON_CLASS_NAME} ${PLAIN_BUTTON_LOOK_CLASS_NAME}`;

export type OutlineButtonStyleType =
  | ButtonStyleType.OUTLINE
  | ButtonStyleType.NORMAL
  | ButtonStyleType.HOVER_DANGER_OUTLINE
  | ButtonStyleType.HOVER_PRIMARY_OUTLINE;

export const isOutlineButtonStyle: (
  style: ButtonStyleType,
) => style is OutlineButtonStyleType = (
  style: ButtonStyleType,
): style is OutlineButtonStyleType => {
  return (
    style === ButtonStyleType.OUTLINE ||
    style === ButtonStyleType.NORMAL ||
    style === ButtonStyleType.HOVER_DANGER_OUTLINE ||
    style === ButtonStyleType.HOVER_PRIMARY_OUTLINE
  );
};

export const isBoxedButtonStyle: (
  style: ButtonStyleType,
) => style is BoxedButtonStyleType = (
  style: ButtonStyleType,
): style is BoxedButtonStyleType => {
  return Object.prototype.hasOwnProperty.call(
    BOXED_BUTTON_LOOK_CLASS_NAMES,
    style,
  );
};

export const OUTLINE_BUTTON_HOVER_CLASS_NAMES: Record<
  OutlineButtonStyleType,
  string
> = {
  [ButtonStyleType.OUTLINE]: "hover:bg-gray-50",
  [ButtonStyleType.NORMAL]: "hover:bg-gray-50",
  [ButtonStyleType.HOVER_DANGER_OUTLINE]: "hover:bg-red-50 hover:text-red-700",
  [ButtonStyleType.HOVER_PRIMARY_OUTLINE]:
    "hover:bg-indigo-50 hover:text-indigo-700",
};

// Each boxed style's hover, left off while it is locked or busy.
export const BOXED_BUTTON_HOVER_CLASS_NAMES: Record<
  BoxedButtonStyleType,
  string
> = {
  ...OUTLINE_BUTTON_HOVER_CLASS_NAMES,
  [ButtonStyleType.PRIMARY]: "hover:bg-indigo-700",
  [ButtonStyleType.DANGER]: "hover:bg-red-700",
  [ButtonStyleType.DANGER_OUTLINE]: "hover:bg-red-50",
  [ButtonStyleType.SUCCESS_OUTLINE]: "hover:bg-green-50",
};

/*
 * The styles that fill their box with a colour, white words on it: a key
 * hint inside one is a pale chip on the fill, inside any other a grey one.
 */
export const FILLED_BUTTON_STYLES: ReadonlyArray<ButtonStyleType> = [
  ButtonStyleType.PRIMARY,
  ButtonStyleType.DANGER,
];

/*
 * The key a button answers to, in a chip after its words (shortcutHint):
 * on a filled button a pale chip on its fill, on a plain one a grey one.
 * Never on a phone, which has no keyboard to tell about.
 */
export const BUTTON_KEY_HINT_CLASS_NAMES: {
  filled: string;
  plain: string;
} = {
  filled:
    "ms-2 rounded bg-white/15 px-1.5 py-0.5 font-sans text-[11px] font-medium leading-4 text-indigo-50 max-sm:hidden",
  plain:
    "ms-2 rounded border border-gray-200 px-1.5 font-sans text-[11px] font-medium leading-4 text-gray-500 max-sm:hidden",
};

/*
 * A button whose words go on a phone (isTitleHiddenOnPhone): below sm they
 * are read out but not drawn, and the button is a square round its icon,
 * as a button with no words is at every width.
 */
export const BUTTON_TITLE_HIDDEN_ON_PHONE_CLASS_NAME: string = "max-sm:sr-only";
export const BUTTON_ICON_GAP_HIDDEN_ON_PHONE_CLASS_NAME: string = "max-sm:me-0";
export const BUTTON_SQUARE_ON_PHONE_CLASS_NAMES: Record<ButtonSize, string> = {
  [ButtonSize.Normal]: "max-sm:p-2",
  [ButtonSize.Small]: "max-sm:p-1",
  [ButtonSize.Large]: "max-sm:p-2",
  [ButtonSize.ExtraSmall]: "max-sm:p-0",
};

/*
 * A boxed button with an icon and no words - a phone's menu toggle, a
 * row's trash can, a composer's Send - is a square around its icon: the
 * padding of the size's height on every side. With a label's sideways
 * padding it was a wide box whose icon sat off its middle.
 */
export const ICON_ONLY_OUTLINE_BUTTON_SIZE_CLASS_NAMES: Record<
  ButtonSize,
  string
> = {
  [ButtonSize.Normal]: "p-2",
  [ButtonSize.Small]: "p-1",
  [ButtonSize.Large]: "p-2",
  [ButtonSize.ExtraSmall]: "p-0",
};
/* Defining the props that the component will take. */

export interface ComponentProps {
  // In English, looked up here - unless isTitleTranslated says otherwise.
  title?: undefined | string;
  /*
   * The title is in the reader's words already: a sentence the page builds
   * around a count or a name ("Show 20 more of 45"), or a front end's own
   * keyed text. Drawn as given, never looked up again (#8633). Left unset,
   * it is English, looked up here.
   */
  isTitleTranslated?: boolean | undefined;
  onClick?: undefined | (() => void);
  /*
   * Called as the pointer goes down, before the press: a button inside an
   * open list (a label picker's Apply) calls preventDefault here so the
   * search field it sits under keeps the focus, and the list stays open.
   */
  onMouseDown?:
    | undefined
    | ((event: React.MouseEvent<HTMLButtonElement>) => void);
  disabled?: undefined | boolean;
  id?: undefined | string;
  shortcutKey?: undefined | ShortcutKey;
  type?: undefined | ButtonType;
  isLoading?: undefined | boolean;
  style?: undefined | React.CSSProperties;
  icon?: undefined | IconProp;
  iconSize?: undefined | SizeProp;
  buttonStyle?: undefined | ButtonStyleType;
  buttonSize?: ButtonSize | undefined;
  dataTestId?: string | undefined;
  className?: string | undefined;
  tooltip?: string | undefined;
  ariaLabel?: string | undefined;
  /*
   * The aria label is in the reader's words already: a sentence the page
   * builds around a value, or a front end's own keyed text. Said as given,
   * never looked up again (#7790). Left unset, it is English, looked up here.
   */
  isAriaLabelTranslated?: boolean | undefined;
  ariaExpanded?: boolean | undefined;
  ariaHaspopup?:
    | "menu"
    | "listbox"
    | "dialog"
    | "tree"
    | "grid"
    | "true"
    | "false"
    | undefined;
  ariaControls?: string | undefined;
  /*
   * The keys that press it, said in a chip after its words ("⌘ Enter"):
   * only said, never listened for - the page owns the shortcut, as a note
   * composer's form does. shortcutKey both says and listens for one key.
   * Hidden on a phone.
   */
  shortcutHint?: string | undefined;
  /*
   * On a phone the words are read out but not drawn, and the button is a
   * square round its icon: a composer's Send beside its pickers keeps them
   * on one line. Needs an icon.
   */
  isTitleHiddenOnPhone?: boolean | undefined;
  /*
   * What state the button is in, for a test or a stylesheet to read
   * (data-state): a player's Play is "playing" or "paused".
   */
  dataState?: string | undefined;
}

const Button: FunctionComponent<ComponentProps> = ({
  title,
  isTitleTranslated,
  onClick,
  onMouseDown,
  disabled,
  id,
  shortcutKey,
  type = ButtonType.Button,
  isLoading = false,
  style,
  icon,
  iconSize,
  buttonStyle = ButtonStyleType.NORMAL,
  buttonSize = ButtonSize.Normal,
  dataTestId,
  className,
  tooltip,
  ariaLabel,
  isAriaLabelTranslated,
  ariaExpanded,
  ariaHaspopup,
  ariaControls,
  shortcutHint,
  isTitleHiddenOnPhone,
  dataState,
}: ComponentProps): ReactElement => {
  const { translateString } = useTranslateValue();
  // Looked up once: English here, a title in the reader's words as given.
  const translatedTitle: string | undefined = isTitleTranslated
    ? title
    : translateString(title);
  const translatedTooltip: string | undefined = translateString(tooltip);
  useEffect(() => {
    if (!shortcutKey) {
      return undefined;
    }

    /*
     * One stable function for the whole subscription. The previous version
     * passed a fresh arrow function to removeEventListener, which never
     * matches the one that was added — every render leaked a live keydown
     * listener for the lifetime of the page.
     */
    const onKeyDown: (event: KeyboardEventProp) => void = (
      event: KeyboardEventProp,
    ): void => {
      return handleKeyboard(event);
    };

    window.addEventListener(`keydown`, onKeyDown);

    return () => {
      window.removeEventListener(`keydown`, onKeyDown);
    };
  }, [shortcutKey, onClick]);

  type HandleKeyboardFunction = (event: KeyboardEventProp) => void;

  const handleKeyboard: HandleKeyboardFunction = (
    event: KeyboardEventProp,
  ): void => {
    if (event.target instanceof HTMLBodyElement && event.key && shortcutKey) {
      switch (event.key) {
        case shortcutKey.toUpperCase():
        case shortcutKey.toLowerCase():
          if (onClick) {
            onClick();
          }
          return;
        default:
          return;
      }
    }
  };

  /*
   * Locked - it cannot be pressed - or busy, which cannot be pressed while
   * it works: neither answers the pointer with a hover. Only a locked one
   * fades (BUTTON_DISABLED_CLASS_NAME). A busy one keeps its look beside
   * its spinner, also when its caller locks it for as long as it works
   * (disabled={isSaving} with isLoading={isSaving}): faded, a Test or a
   * Save that had just been pressed looked as if it had been turned off.
   */
  const isInert: boolean = Boolean(disabled || isLoading);
  const isLocked: boolean = Boolean(disabled) && !isLoading;

  const buttonRef: React.RefObject<HTMLButtonElement> =
    useRef<HTMLButtonElement>(null);
  const wrapperRef: React.RefObject<HTMLSpanElement> =
    useRef<HTMLSpanElement>(null);
  // When the button was last pressed while it had the focus.
  const focusedPressAtRef: React.MutableRefObject<number | null> = useRef<
    number | null
  >(null);
  // Whether it went busy (or locked) because of that press.
  const keepsFocusRef: React.MutableRefObject<boolean> = useRef<boolean>(false);

  /*
   * A button pressed from the keyboard keeps the keyboard's place while it
   * works. A busy or locked button is disabled, and the browser moves the
   * focus off a disabled control - to the page itself - and the reason a
   * locked one gives sits in a wrapper of its own, which the button is
   * moved into: Enter on a Save or a Refresh left the reader at the top of
   * the page, with Tab starting over. Now, if that press made it busy:
   *
   *   - while it works, the wrapper that says why takes the focus, where
   *     there is one;
   *   - when it is done, the button takes the focus back.
   *
   * Only while the focus is lost (on the page itself): someone who moved
   * on keeps their place. And only for a press that made it busy - a
   * button that goes busy on its own (an automatic refresh) never pulls
   * the focus to itself.
   */
  useEffect(() => {
    const activeElement: Element | null = document.activeElement;
    const isFocusLost: boolean =
      !activeElement || activeElement === document.body;

    if (isInert) {
      const pressedAt: number | null = focusedPressAtRef.current;

      keepsFocusRef.current =
        pressedAt !== null && Date.now() - pressedAt < FOCUS_KEEPING_PRESS_MS;

      if (keepsFocusRef.current && isFocusLost && wrapperRef.current) {
        wrapperRef.current.focus({ preventScroll: true });
      }

      return;
    }

    if (keepsFocusRef.current && isFocusLost && buttonRef.current) {
      buttonRef.current.focus({ preventScroll: true });
    }

    keepsFocusRef.current = false;
    focusedPressAtRef.current = null;
  }, [isInert]);

  /*
   * The focus ring is for keyboard focus only (focus-visible). Drawn on every
   * :focus it also ringed whatever a script focused: a dialog opened with a
   * click put its initial focus on Cancel, and the ring made Cancel the most
   * prominent button on the dialog - a plain button wearing the highlight the
   * action should have. The browser still draws it for anyone moving through
   * the page with the keyboard, which is who it is for.
   */
  let buttonStyleCssClass: string = "";

  // Words after the icon: the title, which an ICON button never draws.
  const hasWords: boolean =
    Boolean(translatedTitle) && buttonStyle !== ButtonStyleType.ICON;

  /*
   * The gap between an icon (or a spinner) and the words is on the words'
   * side in either direction: margin-inline-end, not margin-right. In
   * Persian a button's icon sits to the right of its words, and a right
   * margin left it touching them, with the gap on the button's edge. A
   * button with no words has no gap to keep: its icon sits in its middle.
   */
  let loadingIconClassName: string = hasWords
    ? `w-5 h-5 -ms-1 me-3 animate-spin`
    : `w-5 h-5 animate-spin`;
  let iconClassName: string = `w-5 h-5`;

  if (buttonStyle !== ButtonStyleType.ICON) {
    if (hasWords) {
      iconClassName += ` me-1`;

      if (isTitleHiddenOnPhone) {
        iconClassName += ` ${BUTTON_ICON_GAP_HIDDEN_ON_PHONE_CLASS_NAME}`;
      }
    }
  } else {
    iconClassName += ` m-1`;
  }

  /*
   * Every boxed style is the one frame with its own colours
   * (BOXED_BUTTON_CLASS_NAME): no width and no margin of its own.
   */
  if (isBoxedButtonStyle(buttonStyle)) {
    buttonStyleCssClass = `${BOXED_BUTTON_CLASS_NAME} ${BOXED_BUTTON_LOOK_CLASS_NAMES[buttonStyle]}`;

    if (!isInert) {
      buttonStyleCssClass += ` ${BOXED_BUTTON_HOVER_CLASS_NAMES[buttonStyle]}`;
    }
  }

  if (buttonStyle === ButtonStyleType.PRIMARY) {
    loadingIconClassName += ` text-indigo-100`;
  }

  /*
   * A link's icon - or its spinner while it is busy - sits on its words'
   * line: drawn as a block, the spinner pushed the words onto a line of
   * their own.
   */
  if (buttonStyle === ButtonStyleType.LINK) {
    buttonStyleCssClass = `text-indigo-600 ${
      isInert ? "" : "hover:text-indigo-900"
    } space-x-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2`;

    if (icon || isLoading) {
      buttonStyleCssClass += ` flex`;
    }
  }

  /*
   * A quieter link than LINK - Show More Details, Clear Filters - but one
   * that reads as a link that works: gray-600 is 7.6:1 on a white card (and
   * Theme.css draws it in the dark theme's muted text). It was gray-400,
   * 2.5:1, under WCAG's 4.5:1 for text, and read as switched off.
   */
  if (buttonStyle === ButtonStyleType.SECONDARY_LINK) {
    buttonStyleCssClass = `${SECONDARY_LINK_TEXT_CLASS_NAME} ${
      isInert ? "" : SECONDARY_LINK_HOVER_CLASS_NAME
    } space-x-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2`;

    if (icon || isLoading) {
      buttonStyleCssClass += ` flex`;
    }
  }

  if (buttonStyle === ButtonStyleType.ICON) {
    buttonStyleCssClass = `rounded-md bg-transparent text-gray-600 ${
      isInert ? "" : "hover:text-gray-900"
    }  focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2`;
  }

  // Locked: faded as a whole, whatever the style. Busy is not locked.
  if (isLocked) {
    buttonStyleCssClass += ` ${BUTTON_DISABLED_CLASS_NAME}`;
  }

  // Center the icon on the words' line (the boxed frame already does).
  if (!isBoxedButtonStyle(buttonStyle)) {
    buttonStyleCssClass += ` items-center`;
  }

  /*
   * The one shared point every variant funnels through: hover/focus colour
   * changes ease in instead of snapping, at the same 150ms the other
   * primitives use.
   */
  buttonStyleCssClass += ` transition-colors duration-150 ease-out`;

  // A boxed button that is only its icon is a square round it.
  const isIconOnlyBox: boolean =
    isBoxedButtonStyle(buttonStyle) &&
    !hasWords &&
    !shortcutKey &&
    Boolean(icon || isLoading);

  buttonStyleCssClass +=
    ` ` +
    (isIconOnlyBox
      ? ICON_ONLY_OUTLINE_BUTTON_SIZE_CLASS_NAMES[buttonSize]
      : buttonSize);

  // Its words go on a phone: a square round its icon there.
  const isTitleShownOnlyFromSm: boolean = Boolean(
    isTitleHiddenOnPhone && hasWords && (icon || isLoading),
  );

  if (isTitleShownOnlyFromSm && isBoxedButtonStyle(buttonStyle)) {
    buttonStyleCssClass += ` ${BUTTON_SQUARE_ON_PHONE_CLASS_NAMES[buttonSize]}`;
  }

  /*
   * A disabled <button> swallows the pointer without dispatching anything, so
   * the hover never reaches the wrapper that carries the tooltip. Taking the
   * button out of hit-testing hands the pointer to that wrapper instead. Only
   * applied when there is a tooltip to show, so nothing else changes.
   */
  if (isInert && translatedTooltip) {
    buttonStyleCssClass += ` pointer-events-none`;
  }

  if (className) {
    buttonStyleCssClass += ` ` + className;
  }

  /*
   * Wrapped - a locked or busy button with a reason - the button's own
   * focus ring is drawn round it while the wrapper, which takes the
   * keyboard's stop in its place, has the keyboard's focus.
   */
  if (isInert && translatedTooltip) {
    buttonStyleCssClass += ` ${getInertButtonFocusRingClassName(
      buttonStyleCssClass,
    )}`;
  }

  /*
   * An icon button, or any button with no words (a phone's menu toggle, a
   * row's trash can), is named by its title or else its tooltip.
   */
  const computedAriaLabel: string | undefined =
    (isAriaLabelTranslated ? ariaLabel : translateString(ariaLabel)) ||
    (buttonStyle === ButtonStyleType.ICON || !hasWords
      ? translatedTitle || translatedTooltip
      : undefined);

  const getButton: GetReactElementFunction = (): ReactElement => {
    return (
      <button
        ref={buttonRef}
        style={style}
        id={id}
        onMouseDown={onMouseDown}
        onClick={() => {
          // A press from where the focus is: it is kept if the press makes it busy.
          focusedPressAtRef.current =
            document.activeElement === buttonRef.current ? Date.now() : null;

          if (onClick) {
            onClick();
          }
        }}
        data-testid={dataTestId}
        data-state={dataState}
        type={type}
        disabled={isInert}
        /*
         * A button's label is the product's own words, readable in a
         * recording of the Dashboard's setup pages (Utils/ProductText).
         */
        className={withProductText(buttonStyleCssClass)}
        aria-label={computedAriaLabel}
        aria-disabled={isInert}
        aria-expanded={ariaExpanded}
        aria-haspopup={ariaHaspopup}
        aria-controls={ariaControls}
      >
        {isLoading && buttonStyle !== ButtonStyleType.ICON && (
          <Icon icon={IconProp.Spinner} className={loadingIconClassName} />
        )}

        {!isLoading && icon && (
          <Icon
            icon={icon}
            className={iconClassName}
            size={iconSize || undefined}
          />
        )}

        {translatedTitle && buttonStyle !== ButtonStyleType.ICON ? (
          isTitleShownOnlyFromSm ? (
            <span className={BUTTON_TITLE_HIDDEN_ON_PHONE_CLASS_NAME}>
              {translatedTitle}
            </span>
          ) : (
            translatedTitle
          )
        ) : (
          ``
        )}

        {shortcutHint && (
          <kbd
            className={
              FILLED_BUTTON_STYLES.includes(buttonStyle)
                ? BUTTON_KEY_HINT_CLASS_NAMES.filled
                : BUTTON_KEY_HINT_CLASS_NAMES.plain
            }
          >
            {shortcutHint}
          </kbd>
        )}

        {shortcutKey && (
          <div className="ms-2">
            <kbd className="inline-flex items-center rounded border border-gray-200 px-2 font-sans text-sm font-medium text-gray-500">
              {shortcutKey}
            </kbd>
          </div>
        )}
      </button>
    );
  };

  if (translatedTooltip) {
    /*
     * Tippy makes its child the trigger element, and a disabled control is
     * both unhoverable and unfocusable - tippy.js even bails out of show()
     * when the trigger has a `disabled` attribute. Explaining WHY a button is
     * disabled is exactly when the tooltip matters most, so wrap the disabled
     * button in an element that can still be hovered and tabbed to.
     */
    if (isInert) {
      return (
        /*
         * A locked button's reason shows on a press too - a tap, or a click
         * - and stays until the next one: on a phone nothing hovers, and a
         * tap showed the reason only until the finger lifted (Chrome sends
         * mouseleave then), so a locked action never said why. Pressing a
         * locked button does nothing else. A busy one (isLoading) is not
         * locked: it is about to answer, so its tooltip stays hover only.
         */
        <Tooltip
          text={translatedTooltip}
          isTextTranslated={true}
          isShownOnPress={isLocked}
        >
          <span
            ref={wrapperRef}
            /*
             * The button takes no pointer here (see above), so the
             * not-allowed cursor of a locked one is this wrapper's. It
             * takes the button's place in its row - as wide as a phone,
             * where the button is - not only as wide as its words.
             */
            className={`${getInertButtonWrapperClassName({
              buttonClassName: buttonStyleCssClass,
              isLocked: isLocked,
            })} ${INERT_BUTTON_WRAPPER_FOCUS_CLASS_NAME}`}
            tabIndex={0}
            data-testid={
              dataTestId ? `${dataTestId}-disabled-wrapper` : undefined
            }
          >
            {getButton()}
          </span>
        </Tooltip>
      );
    }

    return (
      <Tooltip text={translatedTooltip} isTextTranslated={true}>
        {getButton()}
      </Tooltip>
    );
  }
  return getButton();
};

export default Button;
