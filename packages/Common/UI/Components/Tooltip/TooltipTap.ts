import { Instance, LifecycleHooks, Plugin } from "tippy.js";

/*
 * ON A TOUCH SCREEN, THE FIRST TAP ON A TRIGGER SAYS WHAT IT IS.
 *
 * A trigger drawn inside something that opens on a tap - an owner's
 * avatar in a list's card, which opens the record - had its tooltip only
 * under a pointer that hovers. A finger does not hover: on a tablet, where
 * a list draws its rows as cards with their owners, a tap on an owner was a
 * tap on the card, and the card opened the record. The list never said who
 * owned a row (#9866).
 *
 * With this plugin, a tap on the trigger - a finger's or a pen's - shows
 * its tooltip, and that tap is the tooltip's alone: the card around it does
 * not hear it as a click (the click's default is prevented, which a row
 * that opens on a click reads: Table/RowClick). The tooltip stays once the
 * finger lifts. A second tap on the trigger while it shows goes on to the
 * card as before, and so does a tap anywhere else on the card, which puts
 * the tooltip away (Tooltip's isShownOnFirstTap shows on a press, and puts
 * it away on a press elsewhere).
 *
 * A mouse's click is untouched: it hovered first, and its click goes on to
 * the card as it always did.
 *
 * Kept apart from Tooltip.tsx so the rule is unit-testable on its own.
 */

// A finger or a pen: what has no hover to show a tooltip with.
export const isTouchPointer: (pointerType: string) => boolean = (
  pointerType: string,
): boolean => {
  return pointerType === "touch" || pointerType === "pen";
};

export const showOnFirstTap: Plugin = {
  name: "showOnFirstTap",
  defaultValue: true,
  fn: (instance: Instance): Partial<LifecycleHooks> => {
    // What pressed the trigger last: "mouse", "touch" or "pen".
    let lastPointerType: string = "";
    // Shown by a tap of its own: the next tap on the trigger goes on.
    let isShownByTap: boolean = false;

    const onPointerDown: (event: PointerEvent) => void = (
      event: PointerEvent,
    ): void => {
      lastPointerType = event.pointerType || "";
    };

    const onClick: (event: MouseEvent) => void = (event: MouseEvent): void => {
      const pointerType: string = lastPointerType;
      lastPointerType = "";

      if (!isTouchPointer(pointerType)) {
        return;
      }

      // The second tap: the tooltip has said what it had to.
      if (isShownByTap && instance.state.isVisible) {
        isShownByTap = false;
        return;
      }

      // The first: the tooltip's own, and it shows (Tippy's click trigger).
      event.preventDefault();
      isShownByTap = true;
    };

    const stopListening: () => void = (): void => {
      instance.reference.removeEventListener(
        "pointerdown",
        onPointerDown as EventListener,
        true,
      );
      instance.reference.removeEventListener(
        "click",
        onClick as EventListener,
        true,
      );
    };

    return {
      onCreate: (): void => {
        /*
         * Captured, so the decision is made before the trigger's own click
         * handlers - and Tippy's - hear the press.
         */
        instance.reference.addEventListener(
          "pointerdown",
          onPointerDown as EventListener,
          true,
        );
        instance.reference.addEventListener(
          "click",
          onClick as EventListener,
          true,
        );
      },
      // However it went - a tap elsewhere, Escape - the next tap shows it.
      onHide: (): void => {
        isShownByTap = false;
      },
      onDestroy: stopListening,
    };
  },
};
