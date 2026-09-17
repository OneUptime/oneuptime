import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  className?: string | undefined;
}

/*
 * A single shimmering placeholder block.
 *
 * Skeletons are decoration: the surrounding region carries the
 * role="status"/aria-busy and the "Loading..." text for assistive tech, so each
 * block is hidden from the accessibility tree. Otherwise a screen reader would
 * walk a dozen meaningless empty nodes before reaching the announcement.
 */
const Skeleton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-md bg-gray-200/80 ${props.className || ""}`.trim()}
    />
  );
};

export default Skeleton;
