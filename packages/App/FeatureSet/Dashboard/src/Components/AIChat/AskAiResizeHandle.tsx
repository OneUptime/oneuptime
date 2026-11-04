import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useRef,
  useState,
} from "react";
import { ASK_AI_PANEL_RESIZE_KEY_STEP } from "./AskAiPanelLayout";

export interface ComponentProps {
  width: number;
  minWidth: number;
  maxWidth: number;
  // While the edge moves: the panel and the page follow it.
  onResize: (width: number) => void;
  // Once it has stopped: the width to keep.
  onResizeEnd: (width: number) => void;
  // A double click puts it back at the width it opens at.
  onReset: () => void;
}

interface Drag {
  pointerId: number;
  startX: number;
  startWidth: number;
  // The width it has reached.
  width: number;
  // Which way a move to the right takes the panel's edge.
  direction: 1 | -1;
}

/*
 * The edge between Ask AI and the page, to drag to whatever width the work in
 * hand needs: wider for a table, narrower for the page beside it. It reads as
 * the panel's border until it is pointed at.
 *
 * A window splitter (the separator role, focusable and with its value) for the
 * keyboard: the arrow keys move the edge the way they point, Home and End take
 * it to the narrowest and the widest.
 *
 * While it moves, the width goes straight to the page (onResize), and this
 * component alone draws again: the conversation beside it is not redrawn for
 * every pixel of a drag.
 */
const AskAiResizeHandle: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const dragRef: React.MutableRefObject<Drag | null> = useRef<Drag | null>(
    null,
  );
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const shownWidth: number = dragWidth ?? props.width;

  const clamp: (width: number) => number = (width: number): number => {
    return Math.round(
      Math.min(props.maxWidth, Math.max(props.minWidth, width)),
    );
  };

  const endDrag: (
    event: React.PointerEvent<HTMLDivElement>,
    isCancelled: boolean,
  ) => void = (
    event: React.PointerEvent<HTMLDivElement>,
    isCancelled: boolean,
  ): void => {
    const drag: Drag | null = dragRef.current;

    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    dragRef.current = null;
    setDragWidth(null);

    if (isCancelled) {
      props.onResize(drag.startWidth);
      return;
    }

    // A press that moved nothing chose nothing: a window's clamp stays a clamp.
    if (drag.width !== drag.startWidth) {
      props.onResizeEnd(drag.width);
    }
  };

  const moveByKey: (width: number) => void = (width: number): void => {
    const next: number = clamp(width);
    props.onResize(next);
    props.onResizeEnd(next);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={translator.translateText("Resize Ask AI")}
      aria-valuenow={shownWidth}
      aria-valuemin={props.minWidth}
      aria-valuemax={props.maxWidth}
      tabIndex={0}
      title={translator.translateText("Drag to resize")}
      data-testid="ask-ai-resize"
      data-dragging={dragWidth !== null ? "true" : undefined}
      // The press starts a drag, not a text selection across the page.
      onMouseDown={(event: React.MouseEvent<HTMLDivElement>) => {
        event.preventDefault();
      }}
      onPointerDown={(event: React.PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) {
          return;
        }

        const handle: HTMLDivElement = event.currentTarget;

        dragRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startWidth: props.width,
          width: props.width,
          direction:
            window.getComputedStyle(handle).direction === "rtl" ? 1 : -1,
        };

        /*
         * Every move comes here until the button is let go, wherever the
         * pointer has wandered: over a chart, or out of the window.
         */
        if (typeof handle.setPointerCapture === "function") {
          handle.setPointerCapture(event.pointerId);
        }

        setDragWidth(props.width);
      }}
      onPointerMove={(event: React.PointerEvent<HTMLDivElement>) => {
        const drag: Drag | null = dragRef.current;

        if (!drag || drag.pointerId !== event.pointerId) {
          return;
        }

        const next: number = clamp(
          drag.startWidth + (event.clientX - drag.startX) * drag.direction,
        );

        drag.width = next;
        setDragWidth(next);
        props.onResize(next);
      }}
      onPointerUp={(event: React.PointerEvent<HTMLDivElement>) => {
        endDrag(event, false);
      }}
      onPointerCancel={(event: React.PointerEvent<HTMLDivElement>) => {
        endDrag(event, true);
      }}
      onDoubleClick={props.onReset}
      onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
        const isRtl: boolean =
          window.getComputedStyle(event.currentTarget).direction === "rtl";
        const wider: string = isRtl ? "ArrowRight" : "ArrowLeft";
        const narrower: string = isRtl ? "ArrowLeft" : "ArrowRight";

        if (event.key === wider) {
          event.preventDefault();
          moveByKey(shownWidth + ASK_AI_PANEL_RESIZE_KEY_STEP);
        } else if (event.key === narrower) {
          event.preventDefault();
          moveByKey(shownWidth - ASK_AI_PANEL_RESIZE_KEY_STEP);
        } else if (event.key === "Home") {
          event.preventDefault();
          moveByKey(props.minWidth);
        } else if (event.key === "End") {
          event.preventDefault();
          moveByKey(props.maxWidth);
        }
      }}
      className="group absolute inset-y-0 -start-1 z-10 flex w-2 cursor-col-resize touch-none select-none justify-center focus:outline-none"
    >
      {/*
       * The line it lights up: the panel's border widened to two pixels, on
       * the pointer or the keyboard's focus, and while it moves.
       */}
      <span
        aria-hidden="true"
        className={`h-full w-0.5 transition-colors duration-150 group-hover:bg-indigo-500 group-focus-visible:bg-indigo-500 motion-reduce:transition-none ${
          dragWidth !== null ? "bg-indigo-500" : "bg-transparent"
        }`}
      ></span>
    </div>
  );
};

export default AskAiResizeHandle;
