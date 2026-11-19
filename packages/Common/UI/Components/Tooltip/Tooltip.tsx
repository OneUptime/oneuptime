import Tippy from "@tippyjs/react";
import { Placement, Plugin } from "tippy.js";
import React, {
  cloneElement,
  FunctionComponent,
  ReactElement,
  useRef,
  useState,
} from "react";
import "tippy.js/dist/tippy.css";
import "tippy.js/themes/light-border.css";
import "tippy.js/animations/shift-away-subtle.css";
import "./Tooltip.css";
import useTranslateValue from "../../Utils/Translation";
import { wasLastInputFromKeyboard } from "../../Utils/InputModality";
import { TOOLTIP_PLUGINS } from "./TooltipEscape";
import { getTooltipLayer, keepTabOrder } from "./TooltipLayer";

export interface ComponentProps {
  // In English, looked up here - unless one of the two flags below is set.
  text?: string | undefined;
  /*
   * The text is in the reader's words already: a sentence the page built
   * around a value, a front end's own keyed text, or words a control looked
   * up itself and hands on (Button's tooltip). Drawn as given, never looked
   * up again (#8226): looked up again, a translation that is also an
   * English key reads as another word, as the Spanish "Red" (Network) read
   * "Rojo". The looked-up-once guard (PlaceholderLookedUpOnceEverywhere)
   * holds every <Tooltip text> to this flag.
   */
  isTextTranslated?: boolean | undefined;
  /*
   * The text is words someone wrote - a label's description reads as its
   * owner wrote it (#8067) - drawn as given, never looked up: a
   * description that is also an English key read as another word. A
   * badge's hover tip marked as written (Pill's isTooltipUserContent) comes
   * here too.
   */
  isTextUserContent?: boolean | undefined;
  children: ReactElement;
  richContent?: ReactElement | undefined;
  // Large collections can wait to create a tooltip until first opened.
  lazy?: boolean | undefined;
  /*
   * Rich tooltips are interactive by default: the pointer can move onto one
   * to read, select or press what is in it, and Tab goes through its links
   * and buttons as if it sat right after its trigger (TooltipLayer's
   * keepTabOrder). Pass false for rich content with nothing to click or
   * select: it then hides as the pointer leaves its trigger. Interactive or
   * not, every tooltip is drawn on the page's body, where no table cell,
   * scrolling list or card its trigger is in can cut it off (#9769).
   */
  interactive?: boolean | undefined;
  /*
   * The trigger already points aria-describedby at this same text, which it
   * does when the text must be announced whether or not the tooltip is showing
   * (a locked menu item saying why it is locked). Tippy's own describedby would
   * then have it read twice, so leave it off.
   */
  isTriggerAlreadyDescribed?: boolean | undefined;
  /*
   * Show on focus only when the keyboard moved it there; hover still shows
   * it. For a trigger a script focuses after a click: a menu opened with the
   * mouse focuses its first item, so that item's tooltip popped up at once,
   * unasked, over whatever was under it - and, drawn before the menu had
   * settled, beside the place the menu opened from rather than the item.
   * From the keyboard it still shows the moment the item takes focus.
   */
  isShownOnKeyboardFocusOnly?: boolean | undefined;
  /*
   * Which side of its trigger the tooltip opens on: "top" unless given.
   * fallbackPlacements are the sides it may move to, in order, when that one
   * has no room. An item of a menu opens to the side, so the reason a locked
   * item gives never covers the items above it (MoreMenuItem).
   */
  placement?: Placement | undefined;
  fallbackPlacements?: Array<Placement> | undefined;
  /*
   * A press - a click, or a tap - shows it and keeps it shown until the
   * trigger is pressed again, whatever the pointer does in between. For a
   * trigger whose press does nothing else, such as a locked menu item: on a
   * phone nothing hovers, and the tap is how a person asks why it is locked.
   * Hover alone was not enough there - a tap ends with the pointer leaving
   * (Chrome sends mouseleave the moment the finger lifts), which hid the
   * reason again before it could be read.
   */
  isShownOnPress?: boolean | undefined;
}

interface PopupProps extends ComponentProps {
  reference?: HTMLElement | undefined;
}

// What a focus-triggered show says it was triggered by (Tippy's onTrigger).
const FOCUS_TRIGGERS: Array<string> = ["focus", "focusin"];

/*
 * Escape puts it away (TooltipEscape), and drawn on the body it keeps its
 * place in the Tab order (TooltipLayer).
 */
const SHARED_TOOLTIP_PLUGINS: Array<Plugin> = [
  ...TOOLTIP_PLUGINS,
  keepTabOrder,
];

const TooltipPopup: FunctionComponent<PopupProps> = (
  props: PopupProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  // The event that last asked this tooltip to show.
  const lastTriggerRef: React.MutableRefObject<string> = useRef<string>("");

  if (!props.text && !props.richContent) {
    return props.children;
  }

  const tooltipContent: ReactElement = props.richContent ? (
    props.richContent
  ) : (
    <span>
      {props.isTextTranslated || props.isTextUserContent
        ? props.text
        : translateString(props.text) ?? props.text}
    </span>
  );

  const isRich: boolean = Boolean(props.richContent);

  const themeProps: { theme: string } | Record<string, never> = isRich
    ? { theme: "light-border" }
    : {};

  const animationProps: { animation: string } | Record<string, never> = isRich
    ? { animation: "shift-away-subtle" }
    : {};

  const keyboardFocusOnlyProps:
    | {
        onTrigger: (instance: unknown, event: Event) => void;
        onShow: () => false | undefined;
      }
    | Record<string, never> = props.isShownOnKeyboardFocusOnly
    ? {
        onTrigger: (_instance: unknown, event: Event): void => {
          lastTriggerRef.current = event.type;
        },
        onShow: (): false | undefined => {
          if (
            FOCUS_TRIGGERS.includes(lastTriggerRef.current) &&
            !wasLastInputFromKeyboard()
          ) {
            return false;
          }

          return undefined;
        },
      }
    : {};

  return (
    <Tippy
      /*
       * Deliberately no key. This used to carry key={Math.random()}, which
       * gives the element a different identity on every render and so unmounts
       * and remounts the child each time the parent re-renders. Tippy updates
       * its content from props perfectly well without that, and the remount
       * had two costs worth naming: a page that re-renders on a timer tore
       * down and rebuilt every tooltipped element under it (a status page
       * draws ninety of them per resource), and anything focused inside one
       * lost focus on every tick - which makes a keyboard-navigable widget
       * impossible to build under it.
       */
      content={tooltipContent}
      /*
       * Escape closes it, however it was opened, and leaves the focus where
       * it was; the Escape that closed it does not also close a dialog, menu
       * or panel around its trigger (TooltipEscape, WCAG 1.4.13). Tab goes
       * through what it holds as if it sat right after its trigger
       * (TooltipLayer).
       */
      plugins={SHARED_TOOLTIP_PLUGINS}
      /*
       * Drawn on the page's body, interactive or not - never inside its
       * trigger's parent, Tippy's own place for an interactive one, where a
       * table's cell, a list that scrolls sideways or a card cut it off
       * (#9769). Placed from there against the window's edges: it flips to
       * the other side, or slides along, where it has no room.
       */
      appendTo={getTooltipLayer}
      {...(props.reference
        ? { reference: props.reference, showOnCreate: true }
        : { children: props.children })}
      interactive={props.interactive ?? isRich}
      /*
       * A press shows it and keeps it until the next press (see
       * isShownOnPress); everything else shows on hover and focus.
       */
      trigger={
        props.isShownOnPress ? "mouseenter focus click" : "mouseenter focus"
      }
      hideOnClick={props.isShownOnPress ? "toggle" : false}
      maxWidth={isRich ? 380 : 350}
      delay={isRich ? [120, 80] : [0, 0]}
      duration={[200, 150]}
      placement={props.placement || "top"}
      {...(props.fallbackPlacements && props.fallbackPlacements.length > 0
        ? {
            popperOptions: {
              modifiers: [
                {
                  name: "flip",
                  options: {
                    fallbackPlacements: props.fallbackPlacements,
                  },
                },
              ],
            },
          }
        : {})}
      {...themeProps}
      {...animationProps}
      {...keyboardFocusOnlyProps}
      aria={{
        content: props.isTriggerAlreadyDescribed ? null : "describedby",
        /*
         * Tippy's default ("auto") stamps aria-expanded onto the trigger, but our
         * triggers are often plain non-interactive elements (e.g. uptime bars) whose
         * role does not support aria-expanded (WCAG 4.1.2). Disable it.
         */
        expanded: false,
      }}
    />
  );
};

const Tooltip: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [reference, setReference] = useState<HTMLElement | null>(null);

  if (!props.lazy || (!props.text && !props.richContent)) {
    return <TooltipPopup {...props} />;
  }

  /*
   * Keep the trigger in the same place before and after opening. Wrapping it
   * in Tippy on first interaction would replace the DOM node and lose focus.
   * Tippy attaches its normal hover, focus and interactive-hide handlers to
   * this external reference once, when the visitor first uses the tooltip.
   */
  const child: ReactElement<React.HTMLAttributes<HTMLElement>> = props.children;

  return (
    <>
      {cloneElement(child, {
        onMouseEnter: (event: React.MouseEvent<HTMLElement>) => {
          child.props.onMouseEnter?.(event);
          setReference(event.currentTarget);
        },
        onFocus: (event: React.FocusEvent<HTMLElement>) => {
          child.props.onFocus?.(event);
          setReference(event.currentTarget);
        },
      })}
      {reference && <TooltipPopup {...props} reference={reference} />}
    </>
  );
};

export default Tooltip;
