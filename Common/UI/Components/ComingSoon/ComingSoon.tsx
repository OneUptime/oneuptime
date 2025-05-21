import EmptyState from "../EmptyState/EmptyState";
import IconProp from "../../../Types/Icon/IconProp";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  title?: string | undefined;
  description?: string | undefined;
}

const ComingSoon: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <EmptyState
      id="coming-soon"
      icon={IconProp.CursorArrowRays}
      title={props.title || "Coming soon!"}
      description={
        props.description ||
        "We will be launching this feature very soon. Stay Tuned!"
      }
    />
  );
};

export default ComingSoon;
