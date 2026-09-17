import React, { FunctionComponent, ReactElement } from "react";

/*
 * Width variants for skeleton lines. Cycled by index (never Math.random) so
 * the shimmer is stable across re-renders - random widths re-roll on every
 * render, which reads as flicker - and so tests can assert exact widths.
 */
const WIDTH_VARIANTS: Array<string> = ["w-3/4", "w-1/2", "w-2/3"];

export type GetSkeletonWidthClassFunction = (index: number) => string;

export const getSkeletonWidthClass: GetSkeletonWidthClassFunction = (
  index: number,
): string => {
  return WIDTH_VARIANTS[Math.abs(index) % WIDTH_VARIANTS.length] as string;
};

export interface ComponentProps {
  className?: string | undefined;
  /*
   * When set, a deterministic width variant (w-3/4 / w-1/2 / w-2/3, cycling)
   * is appended so a stack of lines looks like ragged text instead of a
   * uniform block. Leave undefined when className already sizes the block.
   */
  widthVariantIndex?: number | undefined;
  dataTestId?: string | undefined;
}

/*
 * A single pulsing placeholder block. Purely decorative - the wrapper that
 * composes skeletons into a loading state owns the role="status" / sr-only
 * announcement, so each block hides itself from the accessibility tree.
 */
const Skeleton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const widthClass: string =
    props.widthVariantIndex === undefined
      ? ""
      : ` ${getSkeletonWidthClass(props.widthVariantIndex)}`;

  return (
    <div
      data-testid={props.dataTestId || "skeleton"}
      aria-hidden={true}
      className={`animate-pulse rounded bg-gray-200${
        props.className ? ` ${props.className}` : ""
      }${widthClass}`}
    ></div>
  );
};

export default Skeleton;
