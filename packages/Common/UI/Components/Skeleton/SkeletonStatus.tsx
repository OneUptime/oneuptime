import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

/*
 * The wrapper every content skeleton draws its bars in (#9220): it tells a
 * screen reader, once, that the region is busy loading, and hides the bars
 * themselves, which say nothing. The bars pulse only for a reader who has
 * not asked for less motion (motion-safe): under prefers-reduced-motion a
 * skeleton is a still grey shape.
 */

// The bars' fill: the grey PageSkeleton and DetailSkeleton draw, in both themes.
export const SKELETON_BAR_CLASS_NAME: string = "max-w-full rounded bg-gray-100";

// How a skeleton's bars move: a pulse, unless the reader asked for less motion.
export const SKELETON_MOTION_CLASS_NAME: string = "motion-safe:animate-pulse";

export interface ComponentProps {
  children: ReactNode;
  dataTestId: string;
  className?: string | undefined;
  // Take the whole height of the box it is drawn in.
  fillsHeight?: boolean | undefined;
}

const SkeletonStatus: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy={true}
      aria-label={translator.translateText("Loading")}
      data-testid={props.dataTestId}
      className={`w-full min-w-0${props.fillsHeight ? " h-full" : ""}${
        props.className ? ` ${props.className}` : ""
      }`}
    >
      <div
        aria-hidden="true"
        className={`${SKELETON_MOTION_CLASS_NAME}${props.fillsHeight ? " h-full" : ""}`}
      >
        {props.children}
      </div>
      <span className="sr-only">{translator.translateText("Loading...")}</span>
    </div>
  );
};

export default SkeletonStatus;
