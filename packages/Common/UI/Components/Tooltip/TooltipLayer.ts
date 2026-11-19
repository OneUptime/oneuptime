import { Instance, LifecycleHooks, Plugin } from "tippy.js";
import { isRendered } from "./TooltipEscape";

/*
 * WHERE A TOOLTIP IS DRAWN, AND HOW THE KEYBOARD GOES THROUGH IT.
 *
 * Every tooltip of the shared Tooltip is drawn on the page's <body>, over
 * everything, and placed against its trigger from there: it opens on the
 * side it asks for and flips to the other side, or slides along, where the
 * window's edge leaves it no room. Nothing its trigger is in can cut it off.
 * Tippy draws an interactive tooltip - a rich one, by default - inside its
 * trigger's parent instead, so that Tab reaches what is in it, and there a
 * table's cell (which clips its value across, TableLayout), a list that
 * scrolls sideways or a card that rounds its corners cut it off: the owner
 * avatars of the first row of the Monitors list showed a tooltip with its
 * left and top missing (#9769). Popper, which places it, cannot see an
 * `overflow: clip` box, so it never moved it away from that edge either.
 *
 * From the body it still follows its trigger as the page or a box around
 * the trigger scrolls, and it goes when its trigger is scrolled out of
 * sight (Tooltip.css). The keyboard goes through one with links or buttons
 * in it (a day's incidents on an uptime bar) as if it sat right after its
 * trigger (keepTabOrder, below).
 *
 * A menu or a panel that opens from a control - a toolbar's Columns, the
 * Copy attributes menu - is drawn on the same layer, the same way
 * (LayeredPopover), and the glossary's definitions too (DefinedTerm).
 *
 * Kept apart from Tooltip.tsx so the rules are unit-testable on their own.
 */

/*
 * Tippy's appendTo: the body of the trigger's own document - or, while the
 * part of the page the trigger is in is shown full screen (a dashboard's
 * canvas, a session replay), that part. Full screen shows only the element
 * it was asked for, so a tooltip drawn on the body would not be seen at all
 * there (MoreMenu and SideOver portal into it for the same reason).
 */
export const getTooltipLayer: (reference: Element) => Element = (
  reference: Element,
): Element => {
  const fullscreenElement: Element | null =
    reference.ownerDocument.fullscreenElement || null;

  if (
    fullscreenElement &&
    fullscreenElement !== reference &&
    fullscreenElement.contains(reference)
  ) {
    return fullscreenElement;
  }

  return reference.ownerDocument.body;
};

// What a press of Tab can land on.
const TABBABLE_SELECTOR: string = [
  "a[href]",
  "area[href]",
  "button",
  "input",
  "select",
  "textarea",
  "iframe",
  "summary",
  "audio[controls]",
  "video[controls]",
  "[contenteditable]",
  "[tabindex]",
].join(", ");

// What Tab goes through in a tooltip, in the order it goes.
export const getTabbableElements: (container: Element) => Array<HTMLElement> = (
  container: Element,
): Array<HTMLElement> => {
  return Array.from(
    container.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR),
  ).filter((element: HTMLElement): boolean => {
    return (
      element.tabIndex >= 0 &&
      !element.matches(":disabled") &&
      !(element instanceof HTMLInputElement && element.type === "hidden") &&
      !element.closest("[inert]") &&
      isRendered(element)
    );
  });
};

// Tab or Shift+Tab, and nothing else has made it its own.
const isTabPress: (event: KeyboardEvent) => boolean = (
  event: KeyboardEvent,
): boolean => {
  return (
    event.key === "Tab" &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.isComposing &&
    !event.defaultPrevented
  );
};

/*
 * A TOOLTIP DRAWN ON THE BODY KEEPS ITS PLACE IN THE TAB ORDER.
 *
 * Drawn at the end of the page, a tooltip's links and buttons would come
 * after everything else on it - or, inside a dialog, never: the dialog
 * keeps Tab among its own controls. So while an interactive tooltip with
 * something to press in it shows:
 *
 *   - Tab on its trigger goes to the tooltip's first link or button;
 *   - Tab and Shift+Tab go through the tooltip's own, in order;
 *   - Shift+Tab on its first goes back to the trigger;
 *   - Tab on its last puts the tooltip away and goes on to what comes after
 *     the trigger. The browser moves on from the trigger itself, so a
 *     dialog that keeps Tab among its own controls (Modal) still decides
 *     where it goes, as it does from the trigger;
 *   - the focus leaving it for anything but its trigger puts it away.
 *
 * A tooltip with nothing to press in it, or one that is not interactive,
 * is not in the Tab order at all, and Tab goes on as if it were not there.
 * What the focus is on inside one that Tab never stops at - a menu's item,
 * reached with the arrow keys (LayeredPopover) - is past its last: Tab goes
 * on from the trigger, Shift+Tab back to it. Without that, Tab from a menu
 * drawn at the end of the page went on from the end of the page.
 *
 * Tab is answered before anything inside hears it (a capturing listener), so
 * a menu that closes itself on Tab, as the Copy attributes menu does, has
 * already handed the focus back to its trigger when it goes.
 */
export const keepTabOrder: Plugin = {
  name: "keepTabOrder",
  defaultValue: true,
  fn: (instance: Instance): Partial<LifecycleHooks> => {
    /*
     * Whether the keyboard goes through the tooltip from here: it shows, it
     * can be used, and it is drawn away from its trigger. One drawn right
     * after its trigger (appendTo "parent") is in the Tab order where it is.
     */
    const isDrawnAwayFromTrigger: () => boolean = (): boolean => {
      const triggerParent: Node | null = instance.reference.parentNode;

      return Boolean(
        instance.props.interactive &&
          instance.state.isVisible &&
          !instance.state.isDestroyed &&
          !(triggerParent && triggerParent.contains(instance.popper)),
      );
    };

    // What Tab goes through in the tooltip while it shows.
    const getTabbables: () => Array<HTMLElement> = (): Array<HTMLElement> => {
      if (!isDrawnAwayFromTrigger()) {
        return [];
      }

      return getTabbableElements(instance.popper);
    };

    const focusTrigger: () => void = (): void => {
      const trigger: Element = instance.reference;

      if (trigger instanceof HTMLElement || trigger instanceof SVGElement) {
        trigger.focus({ preventScroll: true });
      }
    };

    const onTriggerKeyDown: (event: KeyboardEvent) => void = (
      event: KeyboardEvent,
    ): void => {
      if (
        !isTabPress(event) ||
        event.shiftKey ||
        event.target !== instance.reference
      ) {
        return;
      }

      const first: HTMLElement | undefined = getTabbables()[0];

      if (!first) {
        return;
      }

      event.preventDefault();
      first.focus();
    };

    const onTooltipKeyDown: (event: KeyboardEvent) => void = (
      event: KeyboardEvent,
    ): void => {
      if (!isTabPress(event) || !isDrawnAwayFromTrigger()) {
        return;
      }

      /*
       * None at all, and the focus is still in here: on something Tab never
       * stops at, a menu's item. It goes on as from past the last.
       */
      const tabbables: Array<HTMLElement> = getTabbables();
      const from: Node = event.target as Node;

      /*
       * Where Tab goes from what has the focus: the next of the tooltip's
       * own after it, or before it with Shift - found by place, so a press
       * on the tooltip's frame or a line of its text goes on from there.
       */
      const next: HTMLElement | undefined = event.shiftKey
        ? tabbables
            .slice()
            .reverse()
            .find((element: HTMLElement): boolean => {
              return Boolean(
                from.compareDocumentPosition(element) &
                  Node.DOCUMENT_POSITION_PRECEDING,
              );
            })
        : tabbables.find((element: HTMLElement): boolean => {
            return Boolean(
              from.compareDocumentPosition(element) &
                Node.DOCUMENT_POSITION_FOLLOWING,
            );
          });

      if (next) {
        event.preventDefault();
        next.focus();
        return;
      }

      if (event.shiftKey) {
        event.preventDefault();
        focusTrigger();
        return;
      }

      /*
       * Past the last: from the trigger, with the tooltip put away first so
       * its own links are not where the browser goes next - and the show
       * the trigger's focus asked for dropped. Not prevented: the browser's
       * own Tab moves on from the trigger.
       */
      focusTrigger();
      instance.clearDelayTimeouts();
      instance.hide();
    };

    const onTooltipFocusOut: (event: FocusEvent) => void = (
      event: FocusEvent,
    ): void => {
      const to: EventTarget | null = event.relatedTarget;

      /*
       * Only for somewhere else on the page: the focus leaving the window
       * (another tab, another app) says nothing about the tooltip.
       */
      if (
        !(to instanceof Node) ||
        instance.popper.contains(to) ||
        instance.reference.contains(to) ||
        !instance.state.isVisible
      ) {
        return;
      }

      instance.hide();
    };

    const stopListening: () => void = (): void => {
      instance.reference.removeEventListener(
        "keydown",
        onTriggerKeyDown as EventListener,
      );
      instance.popper.removeEventListener("keydown", onTooltipKeyDown, true);
      instance.popper.removeEventListener("focusout", onTooltipFocusOut);
    };

    return {
      onCreate: (): void => {
        instance.reference.addEventListener(
          "keydown",
          onTriggerKeyDown as EventListener,
        );
        // Before what is inside hears it.
        instance.popper.addEventListener("keydown", onTooltipKeyDown, true);
        instance.popper.addEventListener("focusout", onTooltipFocusOut);
      },
      onDestroy: stopListening,
    };
  },
};
