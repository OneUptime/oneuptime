import tippy, { Instance, Placement, PopperElement, Props } from "tippy.js";
import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  RefObject,
  useEffect,
  useInsertionEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import DROPDOWN_MENU_Z_INDEX from "../Dropdown/DropdownMenuZIndex";
import { consumePressForAnchoredPopup } from "../../Types/LayeredDismissal";
import { isInsideComponent } from "../../Types/UseComponentOutsideClick";
import { isInFrontmostEscapeLayer } from "./TooltipEscape";
import { getTooltipLayer, keepTabOrder } from "./TooltipLayer";
import "./Tooltip.css";

/*
 * A MENU OR A PANEL THAT OPENS FROM A CONTROL, DRAWN ON THE TOOLTIP LAYER.
 *
 * A toolbar's Columns, Export or time range, a saved views list, the Copy
 * attributes menu: each drew its open menu inside the box its control sat
 * in, `absolute` under it, and never moved. Where that box clips - a list's
 * card with rounded corners, a table that scrolls sideways (which clips up
 * and down too), a side panel's scrolling body - the menu's foot was cut
 * off whenever the box ended before the menu did: Columns over a trace's
 * empty logs (#9859), Copy attributes on the last expanded log or near a
 * span panel's foot (#9861).
 *
 * Drawn here, on the page's body as every tooltip is (TooltipLayer), nothing
 * the control is in can cut it off, and it is placed against the window:
 *
 *   - under its control, its start edge on the control's start edge (or its
 *     end on its end, `align`), in the line's direction: a page read right
 *     to left mirrors it;
 *   - above its control when there is no room for it under it but there is
 *     above, and on the side with the more room when neither has it all -
 *     cut down to that room, its content scrolling inside it, so all of it
 *     can be reached;
 *   - slid along to stay 8px inside the window's sides;
 *   - following its control as the page, or a box around the control,
 *     scrolls, and hidden while the control is scrolled out of sight
 *     (Tooltip.css), as a tooltip is.
 *
 * And it keeps what a menu drawn right after its control had:
 *
 *   - Tab: from the control into it, through it, and on from the control
 *     past its last - from an item reached with the arrow keys too
 *     (keepTabOrder); the focus leaving it for anything else closes it;
 *   - Escape closes it, hands the focus back to the control when it was in
 *     the menu, and is spent there: the dialog or the panel the control is
 *     in does not close on the same press. A dialog opened over it hears
 *     its own Escape (isInFrontmostEscapeLayer);
 *   - a press outside it and its control closes it, and is not also a press
 *     on a dialog's backdrop behind it (LayeredDismissal). A press inside it
 *     - or in a tooltip drawn from something in it - is the menu's own, and
 *     a component around the control that closes on a press outside still
 *     counts it as inside (isInsideComponent);
 *   - React's events still go up its tree to the control's component, so a
 *     click on an item does not also open the row the control sits in.
 *
 * Drawn only while it is open: its owner renders it with the menu's
 * content as its child, which carries the menu's own look (its border,
 * shadow and width - no wider than the window, max-w-[calc(100vw-1rem)]).
 * A menu as wide as its control - a search's suggestions, which hung from
 * edge to edge of the search box - takes its control's width from the
 * layer (LAYERED_POPOVER_AS_WIDE_AS_ANCHOR_CLASS_NAME).
 *
 * THE POPUP OF A FIELD (isFieldPopup).
 *
 * A search's suggestions and its syntax help are a combobox's popups: the
 * focus stays in the field the person types in, the field's own keys move
 * through the suggestions and close them, and the field's owner closes them
 * on a press outside the field and them (#9909). Taking Tab and Escape as a
 * menu does would take them from the field: Tab in the search would jump
 * into the suggestions instead of on to its Clear button, and Escape would
 * never reach the field. So a field's popup is drawn and placed here as a
 * menu is - on the layer, against the window, following its field - and
 * nothing else: Tab, Escape and a press are the field's, as they were while
 * the popup was drawn in place. A press in it is still a press inside the
 * field's owner (isInsideComponent), which is how the owner tells it from a
 * press outside.
 */

export type LayeredPopoverAlignment = "start" | "end";

export type LayeredPopoverSide = "bottom" | "top";

interface LayeredPopoverPlacementProps {
  /*
   * The control it opens from: it is placed against it, Tab goes on from
   * it, and a press on it is the control's own (it opens and closes it).
   * A control with a Tooltip of its own works too. A field's popup hangs
   * from the field's box.
   */
  anchorRef: RefObject<HTMLElement | null>;
  /*
   * The rest of the control, where a press is not a press outside either -
   * the split button the anchor is one half of.
   */
  ownerRef?: RefObject<HTMLElement | null> | undefined;
  // The menu or the panel, with its own look.
  children: ReactNode;
  /*
   * The anchor's edge its own lines up with, in the line's direction: its
   * start (the default) or its end. "end" suits a control at the end of a
   * toolbar, whose menu hangs back over the toolbar.
   */
  align?: LayeredPopoverAlignment | undefined;
  // The side it opens on when it has the room there: under its control.
  side?: LayeredPopoverSide | undefined;
  // Between the control and the menu, in pixels.
  gap?: number | undefined;
  dataTestId?: string | undefined;
}

// A menu or a panel a press opens: Tab, Escape and a press outside are its.
export interface LayeredMenuProps extends LayeredPopoverPlacementProps {
  isFieldPopup?: false | undefined;
  // Asked to close: Escape, a press outside, the focus leaving it.
  onClose: () => void;
}

/*
 * The popup of a field the person types in: Tab, Escape and a press outside
 * stay the field's, so it is never asked to close - its field's owner
 * closes it, as it did while the popup was drawn in place.
 */
export interface LayeredFieldPopupProps extends LayeredPopoverPlacementProps {
  isFieldPopup: true;
  onClose?: undefined;
}

export type ComponentProps = LayeredMenuProps | LayeredFieldPopupProps;

// Kept this far inside the window's edges, as every portalled menu is.
export const LAYERED_POPOVER_WINDOW_PADDING_PX: number = 8;
const DEFAULT_GAP_PX: number = 4;
/*
 * A menu cut down to the room it has keeps at least this much, so a list
 * shows a few of its rows even in a window too short for it.
 */
export const LAYERED_POPOVER_MIN_HEIGHT_PX: number = 120;

// On the layer's own element, the one Popper places (Tooltip.css).
export const LAYERED_POPOVER_CLASS_NAME: string = "layered-popover";

/*
 * The width of the control a menu hangs from, on the layer's element as a
 * custom property its menu can size itself by - kept up to date as the
 * control's width changes, and set before the menu is first measured.
 */
export const LAYERED_POPOVER_ANCHOR_WIDTH_PROPERTY: string =
  "--layered-popover-anchor-width";

/*
 * A menu exactly as wide as its control, its own class: a search's
 * suggestions, which hung from edge to edge of the search box
 * (`left-0 right-0`) while they were drawn in place.
 */
export const LAYERED_POPOVER_AS_WIDE_AS_ANCHOR_CLASS_NAME: string =
  "w-[var(--layered-popover-anchor-width)]";

// Popper's modifier, as tippy's options type it.
type PopperModifier = NonNullable<
  NonNullable<Props["popperOptions"]>["modifiers"]
>[number];

type PopperState = Parameters<NonNullable<PopperModifier["fn"]>>[0]["state"];

type TippyElement = Element & { _tippy?: Instance | undefined };

/*
 * The side and the edge Popper places it on. Popper's start and end are the
 * left and the right; on a page read right to left the line starts at the
 * right, so they swap.
 */
export const getLayeredPopoverPlacement: (data: {
  side: LayeredPopoverSide;
  align: LayeredPopoverAlignment;
  isRightToLeft: boolean;
}) => Placement = (data: {
  side: LayeredPopoverSide;
  align: LayeredPopoverAlignment;
  isRightToLeft: boolean;
}): Placement => {
  const isLeftEdge: boolean = (data.align === "start") !== data.isRightToLeft;

  return `${data.side}-${isLeftEdge ? "start" : "end"}` as Placement;
};

/*
 * The side it opens on: the one it asks for while all of it fits there,
 * the other while all of it fits there instead, and otherwise the one with
 * the more room - a menu as tall as the window opened from a control at
 * its foot went down, into a sliver.
 */
export const chooseLayeredPopoverSide: (data: {
  preferred: LayeredPopoverSide;
  roomAbove: number;
  roomBelow: number;
  height: number;
}) => LayeredPopoverSide = (data: {
  preferred: LayeredPopoverSide;
  roomAbove: number;
  roomBelow: number;
  height: number;
}): LayeredPopoverSide => {
  const other: LayeredPopoverSide =
    data.preferred === "bottom" ? "top" : "bottom";
  const roomOn: (side: LayeredPopoverSide) => number = (
    side: LayeredPopoverSide,
  ): number => {
    return side === "bottom" ? data.roomBelow : data.roomAbove;
  };

  if (roomOn(data.preferred) >= data.height) {
    return data.preferred;
  }

  if (roomOn(other) >= data.height) {
    return other;
  }

  return roomOn(other) > roomOn(data.preferred) ? other : data.preferred;
};

// Whether the control reads right to left: its menu lines up from its right.
export const isReadRightToLeft: (element: Element) => boolean = (
  element: Element,
): boolean => {
  const view: Window | null = element.ownerDocument.defaultView;
  const direction: string = view
    ? view.getComputedStyle(element).direction
    : "";

  if (direction === "rtl" || direction === "ltr") {
    return direction === "rtl";
  }

  // A layout that computes no direction (jsdom): the nearest dir says.
  return element.closest("[dir]")?.getAttribute("dir")?.toLowerCase() === "rtl";
};

// The window's height, as Popper reads it (the page's viewport).
const getWindowHeight: (element: Element) => number = (
  element: Element,
): number => {
  const document: Document = element.ownerDocument;

  return (
    document.documentElement.clientHeight ||
    document.defaultView?.innerHeight ||
    0
  );
};

// The menu: the layer's one child.
const getMenu: (popper: HTMLElement) => HTMLElement | null = (
  popper: HTMLElement,
): HTMLElement | null => {
  const menu: Element | null = popper.firstElementChild;

  return menu instanceof HTMLElement ? menu : null;
};

/*
 * The menu's height as it draws itself, with its own border: all of it,
 * even while the max-height this layer gives it (APPLY_MAX_HEIGHT_MODIFIER)
 * cuts it short, and no more than a max-height of its own lets it be. A
 * menu that scrolls inside its own cap - a search's eight suggestions in
 * their 14rem, a busy day's sixty events in their 20rem - needs room for
 * the cap, not for all it holds: measured by all it holds, it opened above
 * its control where it fitted under it, and was given a max-height taller
 * than its own.
 */
export const getLayeredMenuHeight: (menu: HTMLElement) => number = (
  menu: HTMLElement,
): number => {
  const cut: string = menu.style.maxHeight;

  if (!cut) {
    return menu.offsetHeight;
  }

  // Measured without this layer's cut, then cut again.
  menu.style.maxHeight = "";
  const height: number = menu.offsetHeight;
  menu.style.maxHeight = cut;

  return height;
};

const getMenuHeight: (state: PopperState) => number = (
  state: PopperState,
): number => {
  const menu: HTMLElement | null = getMenu(state.elements.popper);

  if (!menu) {
    return state.rects.popper.height;
  }

  return getLayeredMenuHeight(menu);
};

// The control's width, on the layer's element for its menu to size itself by.
const setAnchorWidth: (popper: HTMLElement, width: number) => void = (
  popper: HTMLElement,
  width: number,
): void => {
  const value: string = `${width}px`;

  if (
    popper.style.getPropertyValue(LAYERED_POPOVER_ANCHOR_WIDTH_PROPERTY) !==
    value
  ) {
    popper.style.setProperty(LAYERED_POPOVER_ANCHOR_WIDTH_PROPERTY, value);
  }
};

/*
 * Keeps the control's width on the layer as Popper places it again - a
 * search box that grows with its toolbar. The first placement is measured
 * with it already set (LayeredPopover sets it as it opens).
 */
const ANCHOR_WIDTH_MODIFIER: PopperModifier = {
  name: "layeredPopoverAnchorWidth",
  enabled: true,
  phase: "write",
  fn: ({ state }: { state: PopperState }): void => {
    setAnchorWidth(state.elements.popper, state.rects.reference.width);
  },
};

const FIT_TO_WINDOW_MODIFIER_NAME: string = "layeredPopoverFitToWindow";

/*
 * Picks its side by the room the window leaves above and below its control
 * (chooseLayeredPopoverSide), in place of Popper's flip, and works out the
 * height it may take there.
 */
const getFitToWindowModifier: (data: {
  preferred: LayeredPopoverSide;
  gap: number;
}) => PopperModifier = (data: {
  preferred: LayeredPopoverSide;
  gap: number;
}): PopperModifier => {
  return {
    name: FIT_TO_WINDOW_MODIFIER_NAME,
    enabled: true,
    phase: "main",
    requiresIfExists: ["offset"],
    fn: ({ state }: { state: PopperState }): void => {
      const reference: Element = state.elements.reference as Element;
      const box: DOMRect = reference.getBoundingClientRect();
      const roomAbove: number =
        box.top - data.gap - LAYERED_POPOVER_WINDOW_PADDING_PX;
      const roomBelow: number =
        getWindowHeight(reference) -
        box.bottom -
        data.gap -
        LAYERED_POPOVER_WINDOW_PADDING_PX;
      const side: LayeredPopoverSide = chooseLayeredPopoverSide({
        preferred: data.preferred,
        roomAbove: roomAbove,
        roomBelow: roomBelow,
        height: getMenuHeight(state),
      });
      const edge: string | undefined = state.options.placement.split("-")[1];
      const placement: Placement = (
        edge ? `${side}-${edge}` : side
      ) as Placement;

      if (state.placement !== placement) {
        state.placement = placement;
        state.reset = true;
        return;
      }

      state.modifiersData[FIT_TO_WINDOW_MODIFIER_NAME] = {
        maxHeight: Math.max(
          LAYERED_POPOVER_MIN_HEIGHT_PX,
          Math.floor(side === "bottom" ? roomBelow : roomAbove),
        ),
      };
    },
  };
};

/*
 * Cuts the menu down to the room its side has, and it scrolls inside
 * itself, only while it is taller than that room. A menu with all its room
 * keeps its own height and overflow - its own max-height too - so nothing
 * of it is cut or clipped that was not before.
 */
const APPLY_MAX_HEIGHT_MODIFIER: PopperModifier = {
  name: "layeredPopoverMaxHeight",
  enabled: true,
  phase: "write",
  requires: [FIT_TO_WINDOW_MODIFIER_NAME],
  fn: ({ state }: { state: PopperState }): void => {
    const menu: HTMLElement | null = getMenu(state.elements.popper);
    const fit: { maxHeight?: number } | undefined =
      state.modifiersData[FIT_TO_WINDOW_MODIFIER_NAME];

    if (!menu || !fit || fit.maxHeight === undefined) {
      return;
    }

    const isCutShort: boolean = getMenuHeight(state) > fit.maxHeight;

    menu.style.maxHeight = isCutShort ? `${fit.maxHeight}px` : "";
    menu.style.overflowY = isCutShort ? "auto" : "";
  },
};

const LayeredPopover: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement | null => {
  // The layer's element: Tippy places it, and the menu is drawn in it.
  const [popper] = useState<HTMLDivElement | null>(
    (): HTMLDivElement | null => {
      if (typeof document === "undefined") {
        return null;
      }

      const element: HTMLDivElement = document.createElement("div");
      element.className = LAYERED_POPOVER_CLASS_NAME;

      return element;
    },
  );

  const instanceRef: React.MutableRefObject<Instance | null> =
    useRef<Instance | null>(null);
  const onCloseRef: React.MutableRefObject<(() => void) | undefined> = useRef<
    (() => void) | undefined
  >(props.onClose);
  onCloseRef.current = props.onClose;

  /*
   * A field's popup leaves Tab, Escape and a press to its field (#9909). A
   * popup is one or the other for as long as it is open; were it to change,
   * the layer's listeners would be set up again for what it is now.
   */
  const isFieldPopup: boolean = props.isFieldPopup === true;

  /*
   * Asked once: one gesture can close it twice - a press outside takes the
   * focus out of it too - and an owner that toggles its menu would open it
   * again on the second.
   */
  const hasAskedToCloseRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);
  const closeRef: React.MutableRefObject<() => void> = useRef<() => void>(
    (): void => {
      if (hasAskedToCloseRef.current) {
        return;
      }

      hasAskedToCloseRef.current = true;
      onCloseRef.current?.();
    },
  );

  const side: LayeredPopoverSide = props.side || "bottom";
  const align: LayeredPopoverAlignment = props.align || "start";
  const gap: number = props.gap ?? DEFAULT_GAP_PX;

  /*
   * Where it goes, as Tippy's props: read as it opens, and handed to it
   * again when its owner changes the side or the edge (a time range picker
   * that measured no room to hang from its start edge). Placed again, never
   * made again: made again, it would leave the page for a moment, and with
   * it the focus on an item in it.
   */
  const getPlacementProps: (anchor: HTMLElement) => Partial<Props> = (
    anchor: HTMLElement,
  ): Partial<Props> => {
    return {
      offset: [0, gap],
      placement: getLayeredPopoverPlacement({
        side: side,
        align: align,
        isRightToLeft: isReadRightToLeft(anchor),
      }),
      popperOptions: {
        modifiers: [
          // In its place: the side with the room (getFitToWindowModifier).
          { name: "flip", enabled: false },
          {
            name: "preventOverflow",
            options: {
              padding: LAYERED_POPOVER_WINDOW_PADDING_PX,
              altAxis: false,
            },
          },
          getFitToWindowModifier({ preferred: side, gap: gap }),
          APPLY_MAX_HEIGHT_MODIFIER,
          ANCHOR_WIDTH_MODIFIER,
        ],
      },
    };
  };

  const getPlacementPropsRef: React.MutableRefObject<
    (anchor: HTMLElement) => Partial<Props>
  > = useRef<(anchor: HTMLElement) => Partial<Props>>(getPlacementProps);
  getPlacementPropsRef.current = getPlacementProps;

  useEffect(() => {
    if (!popper) {
      return;
    }

    if (props.dataTestId) {
      popper.setAttribute("data-testid", props.dataTestId);
    } else {
      popper.removeAttribute("data-testid");
    }
  }, [popper, props.dataTestId]);

  /*
   * On the page before what it holds is: a field in it that focuses itself
   * as it is drawn (autoFocus - the security events' column search) takes
   * the focus as React commits it, before this component's own layout
   * effects run, and a field off the page cannot take the focus. Held at
   * the window's top corner until Popper places it a moment later, in the
   * same frame: a focus there scrolls nothing. On the full-screen part of
   * the page when there is one, as getTooltipLayer would put it.
   */
  useInsertionEffect(() => {
    if (!popper || popper.isConnected || typeof document === "undefined") {
      return undefined;
    }

    popper.style.position = "fixed";
    popper.style.top = "0px";
    popper.style.left = "0px";
    (document.fullscreenElement || document.body).appendChild(popper);

    return () => {
      popper.remove();
    };
  }, [popper]);

  // Opens it against its control, once the control is on the page.
  useLayoutEffect(() => {
    const anchor: HTMLElement | null = props.anchorRef.current;

    if (!popper || !anchor) {
      return undefined;
    }

    /*
     * Closed by its owner - drawn no more - is not a close to report: only
     * a close this layer decides (the focus leaving it) is told.
     */
    let isLettingGo: boolean = false;

    // A Tooltip of the control's own stays the one the control names.
    const tooltipOfControl: Instance | undefined = (anchor as TippyElement)
      ._tippy;

    const instance: Instance = tippy(anchor, {
      // Headless: the menu draws its own look.
      render: (): { popper: PopperElement } => {
        return { popper: popper as PopperElement };
      },
      appendTo: getTooltipLayer,
      interactive: true,
      trigger: "manual",
      hideOnClick: false,
      animation: false,
      duration: 0,
      zIndex: DROPDOWN_MENU_Z_INDEX,
      ...getPlacementPropsRef.current(anchor),
      // The control says it opens a menu, and whether it is open, itself.
      aria: { content: null, expanded: false },
      /*
       * A field's popup is not in the Tab order from its field: Tab in a
       * search goes on to its Clear button, as it did while the popup was
       * drawn in place, and the field's leaving closes it (its owner).
       */
      plugins: isFieldPopup ? [] : [keepTabOrder],
      onHide: (): void => {
        if (!isLettingGo) {
          closeRef.current();
        }
      },
    });

    if (tooltipOfControl) {
      (anchor as TippyElement)._tippy = tooltipOfControl;
    }

    instanceRef.current = instance;

    // Measured from its first placement at the width its control has now.
    setAnchorWidth(popper, anchor.getBoundingClientRect().width);
    instance.show();

    /*
     * Placed now, not a moment later as Popper would: its owner may move
     * the focus into it as it opens (Copy attributes focuses the shape in
     * use), and until it is placed it sits at the top of the page - the
     * focus would scroll the page up to it, and its control out of sight.
     */
    instance.popperInstance?.forceUpdate();

    /*
     * Placed again whenever its size or its control's changes: a list that
     * fills in, a search that narrows it, and the Tailwind the Dashboard
     * writes as a class is first used, which can style the menu a moment
     * after it was first measured.
     */
    let resizeObserver: ResizeObserver | null = null;

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver((): void => {
        // A menu as wide as its control is measured at the new width.
        setAnchorWidth(popper, anchor.getBoundingClientRect().width);
        void instance.popperInstance?.update();
      });
      resizeObserver.observe(anchor);

      const menu: HTMLElement | null = getMenu(popper);

      if (menu) {
        resizeObserver.observe(menu);
      }
    }

    return () => {
      isLettingGo = true;
      resizeObserver?.disconnect();
      instanceRef.current = null;
      instance.destroy();

      if (tooltipOfControl && !tooltipOfControl.state.isDestroyed) {
        (anchor as TippyElement)._tippy = tooltipOfControl;
      }
    };
  }, [popper, props.anchorRef, isFieldPopup]);

  // Its side or its edge changed while it is open: placed there.
  const isFirstPlacementRef: React.MutableRefObject<boolean> =
    useRef<boolean>(true);

  useLayoutEffect(() => {
    if (isFirstPlacementRef.current) {
      isFirstPlacementRef.current = false;
      return;
    }

    const instance: Instance | null = instanceRef.current;

    if (instance && !instance.state.isDestroyed) {
      instance.setProps(
        getPlacementPropsRef.current(instance.reference as HTMLElement),
      );
    }
  }, [side, align, gap]);

  // Placed again as what it shows changes.
  useEffect(() => {
    void instanceRef.current?.popperInstance?.update();
  });

  // Escape closes it, and is spent - a field's popup's Escape is its field's.
  useEffect(() => {
    if (!popper || isFieldPopup) {
      return undefined;
    }

    const onKeyDown: (event: KeyboardEvent) => void = (
      event: KeyboardEvent,
    ): void => {
      const anchor: HTMLElement | null = props.anchorRef.current;

      if (
        event.key !== "Escape" ||
        event.isComposing ||
        event.defaultPrevented ||
        !anchor ||
        // A dialog opened over it hears its own Escape.
        !isInFrontmostEscapeLayer(anchor)
      ) {
        return;
      }

      const target: EventTarget | null = event.target;

      // Something open inside it - a picker's list - closes first, itself.
      if (
        target instanceof Element &&
        popper.contains(target) &&
        target.getAttribute("aria-expanded") === "true"
      ) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();

      const focused: Element | null = anchor.ownerDocument.activeElement;

      /*
       * Back to the control, from the menu - or from nowhere (a menu opened
       * with the mouse leaves the focus on the page in Safari and Firefox) -
       * never from wherever the person moved it.
       */
      if (
        !focused ||
        focused === anchor.ownerDocument.body ||
        popper.contains(focused)
      ) {
        anchor.focus({ preventScroll: true });
      }

      closeRef.current();
    };

    /*
     * On the window as the key goes down, after a tooltip's own Escape
     * (TooltipEscape, which the window hears first): a tooltip open in the
     * menu closes on the first Escape, the menu on the next.
     */
    window.addEventListener("keydown", onKeyDown, true);

    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [popper, props.anchorRef, isFieldPopup]);

  /*
   * A press outside it, and outside its control, closes it. A field's
   * popup is closed by its field's owner, which tells a press in it from
   * one outside (isInsideComponent) - and spends no press: a press on a
   * dialog's backdrop behind a search's suggestions closes the dialog too,
   * as it did while they were drawn in place.
   */
  useEffect(() => {
    if (!popper || isFieldPopup) {
      return undefined;
    }

    const onPress: (event: MouseEvent) => void = (event: MouseEvent): void => {
      const isInside: boolean = [
        popper,
        props.anchorRef.current,
        props.ownerRef?.current,
      ].some((component: Element | null | undefined): boolean => {
        return isInsideComponent(component, event.target);
      });

      if (isInside) {
        return;
      }

      // Spent on the menu: not also a press on a dialog's backdrop behind it.
      consumePressForAnchoredPopup(event);
      closeRef.current();
    };

    document.addEventListener("mousedown", onPress, true);

    return () => {
      document.removeEventListener("mousedown", onPress, true);
    };
  }, [popper, props.anchorRef, props.ownerRef, isFieldPopup]);

  if (!popper) {
    return null;
  }

  return createPortal(props.children, popper);
};

export default LayeredPopover;
