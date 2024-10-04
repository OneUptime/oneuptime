import React, { ReactElement } from "react";

export interface ComponentProps {
  children: Array<ReactElement>;
}

const HeaderAlertGroup: (props: ComponentProps) => ReactElement = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div className="rounded-lg m-2 flex border-2 border-gray-200">
      {props.children &&
        props.children
          .filter((child: ReactElement) => {
            // does this child has children?;
            return true;
          })
          .map((child: ReactElement, index: number) => {
            const isLastElement: boolean = index === props.children.length - 1;

            return (
              <div key={index} className="p-4 flex">
                {child}
                {!isLastElement && (
                  <div className="border-r-2 border-gray-200"></div>
                )}
              </div>
            );
          })}
    </div>
  );
};

export default HeaderAlertGroup;
