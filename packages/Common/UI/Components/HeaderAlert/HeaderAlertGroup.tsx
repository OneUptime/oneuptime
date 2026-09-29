import React, { ReactElement } from "react";

export interface ComponentProps {
  children: Array<ReactElement | false>;
}

const HeaderAlertGroup: (props: ComponentProps) => ReactElement = (
  props: ComponentProps,
): ReactElement => {
  let children: Array<ReactElement | false> = props.children || [];

  children = children.filter((child: ReactElement | false) => {
    if (!child) {
      return false;
    }

    // check if this child has inner div.
    if (child.props.children) {
      return true;
    }

    return true;
  });

  if (!children || children.length === 0) {
    return <></>;
  }

  const className: string = "flex items-center gap-1 ml-4";

  return (
    <div className={className}>
      {children.map((child: ReactElement | false, index: number) => {
        return (
          <div key={index} className="flex">
            {child}
          </div>
        );
      })}
    </div>
  );
};

export default HeaderAlertGroup;
