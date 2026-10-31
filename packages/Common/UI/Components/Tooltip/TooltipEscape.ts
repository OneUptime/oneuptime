import { Instance, LifecycleHooks, Plugin } from "tippy.js";
import { wasLastInputFromKeyboard } from "../../Utils/InputModality";

/*
 * ESCAPE PUTS A TOOLTIP AWAY.
 *
 * What a pointer or the keyboard brings up has to be dismissible without
 * moving either (WCAG 1.4.13, content on hover or focus): a tooltip can
 * cover what someone is reading, and a person who zooms in, or who cannot
 * aim a pointer finely, cannot always move off it. So every tooltip of the
 * shared Tooltip closes on Escape, however it was opened - by hover, by
 * the keyboard's focus or by a press (a tap on a phone) - and the focus
 * stays where it was: on the trigger, or brought back to the trigger from
 * inside a tooltip that held it.
 *
 * The Escape that closed a tooltip the person brought up is spent: one
 * Escape never does two things. A dialog, a menu or a panel around the
 * tooltip's trigger does not close on the same press as well, and nothing
 * else that listens for Escape hears it - Modal, MoreMenu and the others
 * hear it on the document or on themselves, and the playlist player and a
 * dashboard widget's drag on the window, all after the one listener here,
 * which the window has before any of them (listenForTooltipEscape). A
 * second Escape is theirs.
 *
 * Two tooltips close on Escape and let it go on, since the Escape was not
 * for them:
 *
 *   - one left behind the frontmost dialog or menu, its trigger outside it
 *     (a button whose tooltip was still up when the dialog it opened came
 *     over it);
 *   - one a script brought up by moving the focus after a click, which the
 *     person neither pointed at nor tabbed to: a dialog opened with the
 *     mouse focuses its first field, and a field's (i) there opened as the
 *     dialog did. Escape still closes that dialog at once, as before.
 *
 * Kept apart from Tooltip.tsx so the rule is unit-testable on its own.
 */

/*
 * What stands in front of the page and closes on Escape: dialogs, modal or
 * not, and menus. The frontmost is the last one in the document: each is
 * portalled to the end of the body as it opens.
 */
export const ESCAPE_LAYER_SELECTOR: string = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[aria-modal="true"]',
  "dialog[open]",
  '[role="menu"]',
].join(", ");

// Drawn, as far as the browser can tell; jsdom draws nothing, so all of it.
const isRendered: (element: Element) => boolean = (
  element: Element,
): boolean => {
  const withVisibility: Element & { checkVisibility?: () => boolean } =
    element as Element & { checkVisibility?: () => boolean };

  return (
    typeof withVisibility.checkVisibility !== "function" ||
    withVisibility.checkVisibility()
  );
};

// The frontmost dialog or menu on the page, if one is open.
export const getFrontmostEscapeLayer: (
  ownerDocument: Document,
) => Element | null = (ownerDocument: Document): Element | null => {
  const layers: Array<Element> = Array.from(
    ownerDocument.querySelectorAll(ESCAPE_LAYER_SELECTOR),
  ).filter((layer: Element): boolean => {
    // A tooltip's own content is never a layer of the page.
    return !layer.closest("[data-tippy-root]") && isRendered(layer);
  });

  return layers[layers.length - 1] || null;
};

/*
 * Whether a tooltip's trigger is in front: on the page with nothing open
 * over it, or inside the frontmost dialog or menu.
 */
export const isInFrontmostEscapeLayer: (reference: Element) => boolean = (
  reference: Element,
): boolean => {
  const layer: Element | null = getFrontmostEscapeLayer(
    reference.ownerDocument,
  );

  return !layer || layer.contains(reference);
};

/*
 * A shown tooltip's answer to an Escape: it closes, and says whether the
 * key was its to spend.
 */
type EscapeHandler = () => boolean;

// The tooltips that are showing, or starting to.
const shownTooltips: Set<EscapeHandler> = new Set<EscapeHandler>();

let isListeningForEscape: boolean = false;

const onWindowKeyDown: (event: KeyboardEvent) => void = (
  event: KeyboardEvent,
): void => {
  if (
    shownTooltips.size === 0 ||
    event.key !== "Escape" ||
    // Escape while composing text cancels the composition, not a tooltip.
    event.isComposing
  ) {
    return;
  }

  let isSpent: boolean = false;

  // A copy: each tooltip leaves the set as it hides.
  for (const handler of Array.from(shownTooltips)) {
    if (handler()) {
      isSpent = true;
    }
  }

  if (isSpent) {
    event.preventDefault();
    // Every listener after this one, the window's own included.
    event.stopImmediatePropagation();
  }
};

/*
 * One listener for every tooltip, on the window, as the key goes down -
 * added as this module loads, which is before any component that listens
 * on the window too has mounted (the playlist player, a widget being
 * dragged): listeners of one target run in the order they were added, so
 * a tooltip hears Escape before any of them.
 *
 * Only on a window that can be listened to. Code runs without a DOM too -
 * App's node tests import page code after standing a bare `window` in (a
 * location and a history, no addEventListener), and every one of them
 * failed on this module's import while it took any `window` for a
 * browser's. A tooltip that starts to show asks again, so a window that
 * can be listened to by then is.
 */
export const listenForTooltipEscape: () => void = (): void => {
  if (
    isListeningForEscape ||
    typeof window === "undefined" ||
    typeof window.addEventListener !== "function"
  ) {
    return;
  }

  isListeningForEscape = true;
  window.addEventListener("keydown", onWindowKeyDown, true);
};

listenForTooltipEscape();

// What brought a tooltip up, as far as its trigger's events tell.
interface OpenedBy {
  // The pointer went over its trigger (a tap counts: it sends a mouseenter).
  pointer: boolean;
  // A press - a click or a tap - opened it.
  press: boolean;
  // The keyboard moved the focus to its trigger.
  keyboardFocus: boolean;
  // Any trigger event at all; a tooltip made on first use shows without one.
  anyEvent: boolean;
}

export const hideOnEscape: Plugin = {
  name: "hideOnEscape",
  defaultValue: true,
  fn: (instance: Instance): Partial<LifecycleHooks> => {
    const openedBy: OpenedBy = {
      pointer: false,
      press: false,
      keyboardFocus: false,
      anyEvent: false,
    };

    // Whether the person brought it up, rather than a script's focus.
    const isThePersonsOwn: () => boolean = (): boolean => {
      return openedBy.pointer || openedBy.press || openedBy.keyboardFocus;
    };

    // Its answer to an Escape (onWindowKeyDown asks only on Escape).
    const onEscape: EscapeHandler = (): boolean => {
      /*
       * Listening starts as the tooltip starts to show; a show the
       * tooltip's own rules turned down leaves nothing to close.
       */
      if (!instance.state.isVisible || instance.state.isDestroyed) {
        shownTooltips.delete(onEscape);
        return false;
      }

      const reference: Element = instance.reference;
      const activeElement: Element | null =
        reference.ownerDocument.activeElement;
      const hadFocusInside: boolean = Boolean(
        activeElement && instance.popper.contains(activeElement),
      );
      const isSpent: boolean =
        isThePersonsOwn() && isInFrontmostEscapeLayer(reference);

      /*
       * An interactive tooltip's own button can hold the focus; closing
       * the tooltip would drop it on the page. It goes back to the
       * trigger, where it was before the tooltip took it - first, while
       * the tooltip is still up, so the trigger's focus does not open it
       * again; a show that focus scheduled is dropped.
       */
      if (hadFocusInside && reference instanceof HTMLElement) {
        reference.focus({ preventScroll: true });
        instance.clearDelayTimeouts();
      }

      instance.hide();

      return isSpent;
    };

    const stopListening: () => void = (): void => {
      shownTooltips.delete(onEscape);
    };

    return {
      onTrigger: (_instance: Instance, event: Event): void => {
        openedBy.anyEvent = true;

        if (event.type === "mouseenter") {
          openedBy.pointer = true;
        } else if (event.type === "click") {
          openedBy.press = true;
        } else if (event.type === "focus" || event.type === "focusin") {
          openedBy.keyboardFocus = wasLastInputFromKeyboard();
        }
      },
      onUntrigger: (_instance: Instance, event: Event): void => {
        if (event.type === "mouseleave") {
          openedBy.pointer = false;
        } else if (event.type === "blur" || event.type === "focusout") {
          openedBy.keyboardFocus = false;
        }
      },
      onShow: (): void => {
        /*
         * A tooltip made on first use (Tooltip's lazy) shows as it is made,
         * without a trigger event: the focus on its trigger says it was a
         * focus, and whose; otherwise it was the pointer.
         */
        if (!openedBy.anyEvent) {
          const reference: Element = instance.reference;

          if (reference.ownerDocument.activeElement === reference) {
            openedBy.keyboardFocus = wasLastInputFromKeyboard();
          } else {
            openedBy.pointer = true;
          }
        }

        /*
         * From the moment it starts to show - before it is placed, which
         * waits a frame - until it hides.
         */
        listenForTooltipEscape();
        shownTooltips.add(onEscape);
      },
      onHide: (): void => {
        openedBy.press = false;
        stopListening();
      },
      onDestroy: stopListening,
    };
  },
};

// Every shared tooltip's plugins.
export const TOOLTIP_PLUGINS: Array<Plugin> = [hideOnEscape];
