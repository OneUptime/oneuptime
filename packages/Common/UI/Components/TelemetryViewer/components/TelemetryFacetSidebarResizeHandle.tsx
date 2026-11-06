import React, {
  FunctionComponent,
  ReactElement,
  useRef,
  useState,
} from "react";
import { Translator } from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";

export const FACET_SIDEBAR_RESIZE_HANDLE_TEST_ID: string =
  "facet-sidebar-resize-handle";
export const FACET_SIDEBAR_KEYBOARD_STEP_PX: number = 16;

export interface TelemetryFacetSidebarResizeHandleProps {
  width: number;
  minWidth: number;
  maxWidth: number;
  onResize: (width: number) => void;
  onResizeEnd: (width: number) => void;
  onReset: () => void;
}

interface DragState {
  pointerId: number;
  startX: number;
  startWidth: number;
  currentWidth: number;
}

const TelemetryFacetSidebarResizeHandle: FunctionComponent<
  TelemetryFacetSidebarResizeHandleProps
> = (props: TelemetryFacetSidebarResizeHandleProps): ReactElement => {
  const translator: Translator = useTranslator();
  const dragRef: React.MutableRefObject<DragState | null> =
    useRef<DragState | null>(null);
  const [isHovered, setIsHovered] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const clamp: (width: number) => number = (width: number): number => {
    return Math.round(
      Math.min(props.maxWidth, Math.max(props.minWidth, width)),
    );
  };

  const handlePointerDown: (e: React.PointerEvent<HTMLDivElement>) => void = (
    e: React.PointerEvent<HTMLDivElement>,
  ): void => {
    // Only primary mouse button (or single touch)
    if (e.button !== 0) {
      return;
    }

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore if pointer capture is not supported
    }

    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startWidth: props.width,
      currentWidth: props.width,
    };

    setIsDragging(true);
  };

  const handlePointerMove: (e: React.PointerEvent<HTMLDivElement>) => void = (
    e: React.PointerEvent<HTMLDivElement>,
  ): void => {
    const drag: DragState | null = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) {
      return;
    }

    const deltaX: number = e.clientX - drag.startX;
    const nextWidth: number = clamp(drag.startWidth + deltaX);
    drag.currentWidth = nextWidth;
    props.onResize(nextWidth);
  };

  const handlePointerUp: (e: React.PointerEvent<HTMLDivElement>) => void = (
    e: React.PointerEvent<HTMLDivElement>,
  ): void => {
    const drag: DragState | null = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) {
      return;
    }

    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore
    }

    const finalWidth: number = drag.currentWidth;
    dragRef.current = null;
    setIsDragging(false);

    props.onResizeEnd(finalWidth);
  };

  const handleKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void = (
    e: React.KeyboardEvent<HTMLDivElement>,
  ): void => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      const next: number = clamp(props.width - FACET_SIDEBAR_KEYBOARD_STEP_PX);
      props.onResize(next);
      props.onResizeEnd(next);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      const next: number = clamp(props.width + FACET_SIDEBAR_KEYBOARD_STEP_PX);
      props.onResize(next);
      props.onResizeEnd(next);
    } else if (e.key === "Home") {
      e.preventDefault();
      props.onResize(props.minWidth);
      props.onResizeEnd(props.minWidth);
    } else if (e.key === "End") {
      e.preventDefault();
      props.onResize(props.maxWidth);
      props.onResizeEnd(props.maxWidth);
    }
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={translator.translateText("Resize filter sidebar")}
      aria-valuenow={props.width}
      aria-valuemin={props.minWidth}
      aria-valuemax={props.maxWidth}
      data-testid={FACET_SIDEBAR_RESIZE_HANDLE_TEST_ID}
      className="group absolute -right-2 top-0 bottom-0 z-10 hidden w-3.5 cursor-col-resize touch-none select-none items-center justify-center focus:outline-none md:flex"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={props.onReset}
      onKeyDown={handleKeyDown}
      onMouseEnter={() => {
        setIsHovered(true);
      }}
      onMouseLeave={() => {
        setIsHovered(false);
      }}
    >
      <div
        className={`h-8 w-1 rounded-full transition-colors ${
          isDragging || isHovered
            ? "bg-indigo-500"
            : "bg-gray-300 group-hover:bg-indigo-400 group-focus:bg-indigo-500"
        }`}
      />
    </div>
  );
};

export default TelemetryFacetSidebarResizeHandle;
