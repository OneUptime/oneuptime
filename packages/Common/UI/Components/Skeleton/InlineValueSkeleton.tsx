import SkeletonStatus, { SKELETON_BAR_CLASS_NAME } from "./SkeletonStatus";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What a value shows while it loads inside a field or a line of text: one
 * bar on the 24px line the value (a row of pills, a name, a state) will
 * take (#9220). A field that read its teams or labels drew ComponentLoader,
 * a box as tall as an empty card, inside a detail card's one-line field.
 */

export const INLINE_VALUE_SKELETON_TEST_ID: string = "inline-value-skeleton";

export interface ComponentProps {
  // The bar's width, as the value it stands in for is about as wide.
  widthClassName?: string | undefined;
  className?: string | undefined;
}

const InlineValueSkeleton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <SkeletonStatus
      dataTestId={INLINE_VALUE_SKELETON_TEST_ID}
      className={props.className}
    >
      <div className="flex h-6 items-center">
        <div
          className={`h-4 ${props.widthClassName || "w-32"} ${SKELETON_BAR_CLASS_NAME}`}
        />
      </div>
    </SkeletonStatus>
  );
};

export default InlineValueSkeleton;
