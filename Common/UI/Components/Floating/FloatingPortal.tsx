import { ModalStackValue, useModalStack } from "../Modal/ModalStackContext";
import React, {
  CSSProperties,
  FunctionComponent,
  ReactElement,
  ReactNode,
  RefObject,
  useLayoutEffect,
  useState,
} from "react";
import { createPortal } from "react-dom";

interface FloatingPosition {
  bottom?: number;
  left: number;
  maxHeight: number;
  top?: number;
  width: number;
}

export interface ComponentProps {
  anchorRef: RefObject<HTMLElement>;
  ariaLabel?: string | undefined;
  children: ReactNode;
  className?: string | undefined;
  floatingRef?: RefObject<HTMLDivElement> | undefined;
  id?: string | undefined;
  matchAnchorWidth?: boolean | undefined;
  maxHeight?: number | undefined;
  onEscape?: (() => void) | undefined;
  role?: React.AriaRole | undefined;
  width?: number | undefined;
}

const viewportMargin: number = 8;

const FloatingPortal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const modalStack: ModalStackValue = useModalStack();
  const [position, setPosition] = useState<FloatingPosition | null>(null);

  useLayoutEffect(() => {
    const updatePosition: () => void = (): void => {
      const anchor: HTMLElement | null = props.anchorRef.current;
      if (!anchor) {
        return;
      }

      const anchorRect: DOMRect = anchor.getBoundingClientRect();
      const requestedWidth: number = props.matchAnchorWidth
        ? anchorRect.width
        : props.width || anchorRect.width;
      const width: number = Math.min(
        requestedWidth,
        window.innerWidth - viewportMargin * 2,
      );
      const left: number = Math.min(
        Math.max(viewportMargin, anchorRect.left),
        window.innerWidth - width - viewportMargin,
      );
      const availableBelow: number =
        window.innerHeight - anchorRect.bottom - viewportMargin;
      const availableAbove: number = anchorRect.top - viewportMargin;
      const desiredMaxHeight: number = props.maxHeight || 384;
      const shouldOpenAbove: boolean =
        availableBelow < Math.min(desiredMaxHeight, 240) &&
        availableAbove > availableBelow;
      const availableHeight: number = shouldOpenAbove
        ? availableAbove
        : availableBelow;
      const maxHeight: number = Math.max(
        80,
        Math.min(desiredMaxHeight, availableHeight),
      );

      setPosition({
        ...(shouldOpenAbove
          ? { bottom: window.innerHeight - anchorRect.top + 4 }
          : { top: anchorRect.bottom + 4 }),
        left,
        maxHeight,
        width,
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [props.anchorRef, props.matchAnchorWidth, props.maxHeight, props.width]);

  const style: CSSProperties = {
    position: "fixed",
    zIndex: 50 + modalStack.depth * 20,
    ...(position || {
      left: 0,
      maxHeight: 0,
      top: 0,
      visibility: "hidden",
      width: 0,
    }),
  };
  const floatingElement: ReactElement = (
    <div
      ref={props.floatingRef}
      id={props.id}
      role={props.role}
      aria-label={props.ariaLabel}
      className={props.className}
      style={style}
      data-floating-portal="true"
      data-floating-modal-depth={modalStack.depth}
      data-floating-modal-owner={modalStack.ownerId || undefined}
      onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>): void => {
        if (event.key !== "Escape" || !props.onEscape) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        props.onEscape();
      }}
    >
      {props.children}
    </div>
  );

  if (typeof document === "undefined") {
    return floatingElement;
  }

  return createPortal(floatingElement, document.body);
};

export default FloatingPortal;
