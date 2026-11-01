import Tippy from "@tippyjs/react";
import { Placement } from "tippy.js";
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
import useTranslateValue from "../../Utils/Translation";
import { wasLastInputFromKeyboard } from "../../Utils/InputModality";
import { TOOLTIP_PLUGINS } from "./TooltipEscape";

export interface ComponentProps {
  text?: string | undefined;
  children: ReactElement;
  richContent?: ReactElement | undefined;
  // Large collections can wait to create a tooltip until first opened.
  lazy?: boolean | undefined;
  /*
   * Rich tooltips are interactive by default, and Tippy mounts an interactive
   * tooltip inside the trigger's parent - where an overflow-clipped ancestor
   * (a scrolling grid, say) cuts it off. Pass false for rich content that has
   * nothing to click: it then mounts on <body> and hides on mouse-out.
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
    <span>{translateString(props.text) ?? props.text}</span>
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
       * or panel around its trigger (TooltipEscape, WCAG 1.4.13).
       */
      plugins={TOOLTIP_PLUGINS}
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
